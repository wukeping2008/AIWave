using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using JYUSB1601;

namespace Usb1601Bridge
{
    internal static class Program
    {
        private sealed class Options
        {
            public string DeviceName { get; set; } = "USBDev0";
            public int Port { get; set; } = 8787;
            public double SampleRate { get; set; } = 1000;
            public double LowRange { get; set; } = -10;
            public double HighRange { get; set; } = 10;
            public List<int> Channels { get; set; } = new List<int> { 0 };
            public int BlockMs { get; set; } = 20;

            // High-rate support:
            // - raw: send full samples (OK for low rates)
            // - features: send envelope/level only (recommended for >= 10kHz)
            // - auto: raw for low rates, features for high rates
            public string Mode { get; set; } = "auto";

            // When true, generates a synthetic signal (no DAQ hardware required).
            public bool Mock { get; set; } = false;
        }

        private static int Main(string[] args)
        {
            try
            {
                var opt = ParseArgs(args);
                Run(opt).GetAwaiter().GetResult();
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex);
                return 1;
            }
        }

        private static async Task Run(Options opt)
        {
            Console.WriteLine("USB-1601 bridge (WebSocket) starting...");
            Console.WriteLine($"Device={opt.DeviceName}  Rate={opt.SampleRate}Hz  Range=[{opt.LowRange},{opt.HighRange}]V  Channels=[{string.Join(",", opt.Channels)}]  Block={opt.BlockMs}ms");
            Console.WriteLine($"Mode={opt.Mode}  Mock={opt.Mock}");
            Console.WriteLine($"WebSocket: ws://localhost:{opt.Port}/ws");

            using (var cts = new CancellationTokenSource())
            {
                Console.CancelKeyPress += (s, e) =>
                {
                    e.Cancel = true;
                    cts.Cancel();
                };

                var clients = new ConcurrentDictionary<Guid, WebSocket>();

                var listener = new HttpListener();
                // Note: we use localhost to avoid requiring admin rights for http://+ bindings.
                listener.Prefixes.Add($"http://localhost:{opt.Port}/ws/");
                listener.Start();

                var wsAcceptLoop = Task.Run(() => AcceptLoop(listener, clients, cts.Token));

                JYUSB1601AITask? aiTask = null;
                try
                {
                    var mode = ResolveMode(opt);

                    int channelCount;
                    if (!opt.Mock)
                    {
                        aiTask = new JYUSB1601AITask(opt.DeviceName);
                        foreach (var ch in opt.Channels.Distinct().OrderBy(v => v))
                        {
                            aiTask.AddChannel(ch, opt.LowRange, opt.HighRange);
                        }

                        aiTask.Mode = AIMode.Continuous;
                        aiTask.SampleRate = opt.SampleRate;
                        aiTask.Start();
                        channelCount = aiTask.Channels.Count;
                    }
                    else
                    {
                        channelCount = Math.Max(1, opt.Channels.Distinct().Count());
                    }

                    await BroadcastAsync(clients, MakeHelloJson(opt), cts.Token);

                    // Periodic heartbeat helps with classroom/demo liveness checks.
                    var heartbeatAt = DateTimeOffset.UtcNow;

                    var blockSamples = Math.Max(1, (int)Math.Round(opt.SampleRate * (opt.BlockMs / 1000.0)));
                    var buffer = new double[blockSamples, channelCount];

                    var rng = new Random(1234);
                    var mockPhase = 0.0;
                    var mockT = 0.0;
                    var mockBurst = 0.0;

                    var levelEma = 0.0;

                    while (!cts.IsCancellationRequested)
                    {
                        if ((DateTimeOffset.UtcNow - heartbeatAt).TotalMilliseconds >= 1000)
                        {
                            heartbeatAt = DateTimeOffset.UtcNow;
                            await BroadcastAsync(clients, MakeHeartbeatJson(), cts.Token);
                        }

                        // Wait until we have enough samples per channel.
                        if (!opt.Mock)
                        {
                            var startWait = DateTime.UtcNow;
                            while (aiTask != null && aiTask.AvailableSamples < (ulong)blockSamples && !cts.IsCancellationRequested)
                            {
                                if ((DateTime.UtcNow - startWait).TotalMilliseconds > 500)
                                {
                                    // keep loop responsive; try reading anyway.
                                    break;
                                }
                                Thread.Sleep(2);
                            }

                            aiTask?.ReadData(ref buffer, blockSamples, -1);
                        }
                        else
                        {
                            FillMock(buffer, opt, rng, ref mockPhase, ref mockT, ref mockBurst);
                            // Pace the loop roughly in real-time.
                            Thread.Sleep(Math.Max(0, opt.BlockMs));
                        }

                        if (mode == "raw")
                        {
                            var payload = MakeSamplesJson(buffer, opt);
                            await BroadcastAsync(clients, payload, cts.Token);
                        }
                        else
                        {
                            ComputeLevel(buffer, opt, out var rms, out var peak, out var level);
                            levelEma = levelEma * 0.85 + level * 0.15;
                            var payload = MakeFeaturesJson(opt, rms, peak, levelEma);
                            await BroadcastAsync(clients, payload, cts.Token);
                        }
                    }
                }
                catch (JYDriverException ex)
                {
                    Console.Error.WriteLine("JY driver error:");
                    Console.Error.WriteLine(ex.Message);
                    await BroadcastAsync(clients, MakeErrorJson(ex.Message), cts.Token);
                }
                finally
                {
                    try { aiTask?.Stop(); } catch { }

                    try { listener.Stop(); } catch { }
                    try { listener.Close(); } catch { }

                    foreach (var kv in clients)
                    {
                        try { kv.Value.Abort(); } catch { }
                    }

                    try { await wsAcceptLoop; } catch { }
                }
            }
        }

        private static string ResolveMode(Options opt)
        {
            var m = (opt.Mode ?? "auto").Trim().ToLowerInvariant();
            if (m == "raw" || m == "features") return m;
            // auto
            // At high sample rates, sending JSON arrays explodes bandwidth/CPU.
            return opt.SampleRate >= 10000 ? "features" : "raw";
        }

        private static void ComputeLevel(double[,] block, Options opt, out double rms, out double peak, out double level)
        {
            var n = block.GetLength(0);
            var c = block.GetLength(1);
            if (n <= 0 || c <= 0)
            {
                rms = 0;
                peak = 0;
                level = 0;
                return;
            }

            // Use first column as the control channel.
            double sumSq = 0;
            double maxAbs = 0;
            for (var i = 0; i < n; i++)
            {
                var v = block[i, 0];
                sumSq += v * v;
                var a = Math.Abs(v);
                if (a > maxAbs) maxAbs = a;
            }

            rms = Math.Sqrt(sumSq / Math.Max(1, n));
            peak = maxAbs;

            var range = Math.Max(Math.Abs(opt.LowRange), Math.Abs(opt.HighRange));
            if (range <= 0.000001) range = 1;
            level = rms / range;
            if (level < 0) level = 0;
            if (level > 1) level = 1;
        }

        private static void FillMock(double[,] buffer, Options opt, Random rng, ref double phase, ref double t, ref double burst)
        {
            var n = buffer.GetLength(0);
            var c = buffer.GetLength(1);
            if (n <= 0 || c <= 0) return;

            var range = Math.Max(Math.Abs(opt.LowRange), Math.Abs(opt.HighRange));
            if (range <= 0.000001) range = 1;

            var dt = 1.0 / Math.Max(1.0, opt.SampleRate);

            // Slow modulation + occasional bursts to make audio mapping obvious.
            var lfoHz = 0.7;
            var baseHz = 23.0;

            for (var i = 0; i < n; i++)
            {
                t += dt;

                // Burst envelope (randomly triggered)
                if (rng.NextDouble() < (dt * 2.5))
                {
                    burst = 1.0;
                }
                burst *= 0.997;

                var lfo = 0.5 + 0.5 * Math.Sin(2 * Math.PI * lfoHz * t);
                var freq = baseHz + 90.0 * lfo;
                phase += 2 * Math.PI * freq * dt;
                if (phase > 1e9) phase = 0;

                var sine = Math.Sin(phase);
                var noise = (rng.NextDouble() * 2.0 - 1.0);

                // Compose within DAQ range
                var v = (0.12 * range) * sine + (0.02 * range) * noise + (0.35 * range) * burst * Math.Sign(sine);

                for (var ch = 0; ch < c; ch++)
                {
                    buffer[i, ch] = v;
                }
            }
        }

        private static async Task AcceptLoop(HttpListener listener, ConcurrentDictionary<Guid, WebSocket> clients, CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                HttpListenerContext? ctx = null;
                try
                {
                    ctx = await listener.GetContextAsync();
                }
                catch
                {
                    if (token.IsCancellationRequested) return;
                    continue;
                }

                if (ctx == null) continue;

                if (!ctx.Request.IsWebSocketRequest)
                {
                    ctx.Response.StatusCode = 400;
                    ctx.Response.Close();
                    continue;
                }

                WebSocketContext? wsCtx = null;
                try
                {
                    wsCtx = await ctx.AcceptWebSocketAsync(subProtocol: null);
                }
                catch
                {
                    try { ctx.Response.StatusCode = 500; ctx.Response.Close(); } catch { }
                    continue;
                }

                var id = Guid.NewGuid();
                var ws = wsCtx.WebSocket;
                clients.TryAdd(id, ws);
                Console.WriteLine($"Client connected: {id} (total {clients.Count})");

                _ = Task.Run(async () =>
                {
                    var buf = new byte[1024];
                    try
                    {
                        // Keep the socket alive; we don't require client->server messages.
                        while (ws.State == WebSocketState.Open && !token.IsCancellationRequested)
                        {
                            var result = await ws.ReceiveAsync(new ArraySegment<byte>(buf), token);
                            if (result.MessageType == WebSocketMessageType.Close)
                            {
                                break;
                            }
                        }
                    }
                    catch { }
                    finally
                    {
                        clients.TryRemove(id, out _);
                        try { ws.Abort(); } catch { }
                        Console.WriteLine($"Client disconnected: {id} (total {clients.Count})");
                    }
                }, token);
            }
        }

        private static async Task BroadcastAsync(ConcurrentDictionary<Guid, WebSocket> clients, string message, CancellationToken token)
        {
            if (clients.IsEmpty) return;
            var bytes = Encoding.UTF8.GetBytes(message);
            var seg = new ArraySegment<byte>(bytes);

            foreach (var kv in clients.ToArray())
            {
                var ws = kv.Value;
                if (ws.State != WebSocketState.Open)
                {
                    clients.TryRemove(kv.Key, out _);
                    continue;
                }

                try
                {
                    await ws.SendAsync(seg, WebSocketMessageType.Text, endOfMessage: true, cancellationToken: token);
                }
                catch
                {
                    clients.TryRemove(kv.Key, out _);
                    try { ws.Abort(); } catch { }
                }
            }
        }

        private static string MakeHelloJson(Options opt)
        {
            return "{" +
                   "\"type\":\"usb1601.hello\"," +
                   "\"device\":" + JsonString(opt.DeviceName) + "," +
                   "\"sampleRate\":" + JsonNumber(opt.SampleRate) + "," +
                   "\"low\":" + JsonNumber(opt.LowRange) + "," +
                   "\"high\":" + JsonNumber(opt.HighRange) + "," +
                   "\"channels\":[" + string.Join(",", opt.Channels.Select(JsonInt)) + "]," +
                   "\"blockMs\":" + JsonInt(opt.BlockMs) + "," +
                   "\"mode\":" + JsonString(ResolveMode(opt)) + "," +
                   "\"mock\":" + (opt.Mock ? "true" : "false") +
                   "}";
        }

        private static string MakeHeartbeatJson()
        {
            return "{" +
                   "\"type\":\"usb1601.heartbeat\"," +
                   "\"ts\":" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() +
                   "}";
        }

        private static string MakeFeaturesJson(Options opt, double rms, double peak, double level)
        {
            return "{" +
                   "\"type\":\"usb1601.features\"," +
                   "\"ts\":" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + "," +
                   "\"sampleRate\":" + JsonNumber(opt.SampleRate) + "," +
                   "\"blockMs\":" + JsonInt(opt.BlockMs) + "," +
                   "\"rms\":" + JsonNumber(rms) + "," +
                   "\"peak\":" + JsonNumber(peak) + "," +
                   "\"level\":" + JsonNumber(level) + "," +
                   "\"low\":" + JsonNumber(opt.LowRange) + "," +
                   "\"high\":" + JsonNumber(opt.HighRange) + "," +
                   "\"channels\":[" + string.Join(",", opt.Channels.Select(JsonInt)) + "]" +
                   "}";
        }

        private static string MakeErrorJson(string message)
        {
            return "{" +
                   "\"type\":\"usb1601.error\"," +
                   "\"message\":" + JsonString(message) +
                   "}";
        }

        private static string MakeSamplesJson(double[,] block, Options opt)
        {
            var n = block.GetLength(0);
            var c = block.GetLength(1);

            var sb = new StringBuilder(64 + n * c * 8);
            sb.Append('{');
            sb.Append("\"type\":\"usb1601.samples\",");
            sb.Append("\"ts\":").Append(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()).Append(',');
            sb.Append("\"sampleRate\":").Append(JsonNumber(opt.SampleRate)).Append(',');
            sb.Append("\"n\":").Append(n).Append(',');
            sb.Append("\"c\":").Append(c).Append(',');
            sb.Append("\"low\":").Append(JsonNumber(opt.LowRange)).Append(',');
            sb.Append("\"high\":").Append(JsonNumber(opt.HighRange)).Append(',');
            sb.Append("\"channels\":[").Append(string.Join(",", opt.Channels.Select(JsonInt))).Append("],");
            sb.Append("\"data\":[");

            // Flatten row-major: sample0[ch0..chN], sample1[ch0..]
            for (var i = 0; i < n; i++)
            {
                for (var j = 0; j < c; j++)
                {
                    if (i != 0 || j != 0) sb.Append(',');
                    sb.Append(JsonNumber(block[i, j]));
                }
            }

            sb.Append(']');
            sb.Append('}');
            return sb.ToString();
        }

        private static Options ParseArgs(string[] args)
        {
            var opt = new Options();

            static string RequireNext(string[] argv, ref int index, string name)
            {
                if (index + 1 >= argv.Length)
                {
                    throw new ArgumentException($"{name} requires a value");
                }

                var v = argv[index + 1];
                if (string.IsNullOrWhiteSpace(v))
                {
                    throw new ArgumentException($"{name} requires a value");
                }

                index++;
                return v;
            }

            for (var i = 0; i < args.Length; i++)
            {
                var a = args[i];

                switch (a)
                {
                    case "--device":
                        opt.DeviceName = RequireNext(args, ref i, "--device");
                        break;
                    case "--port":
                        opt.Port = int.Parse(RequireNext(args, ref i, "--port"), CultureInfo.InvariantCulture);
                        break;
                    case "--rate":
                        opt.SampleRate = double.Parse(RequireNext(args, ref i, "--rate"), CultureInfo.InvariantCulture);
                        break;
                    case "--low":
                        opt.LowRange = double.Parse(RequireNext(args, ref i, "--low"), CultureInfo.InvariantCulture);
                        break;
                    case "--high":
                        opt.HighRange = double.Parse(RequireNext(args, ref i, "--high"), CultureInfo.InvariantCulture);
                        break;
                    case "--channels":
                        opt.Channels = RequireNext(args, ref i, "--channels")
                            .Split(',')
                            .Select(s => int.Parse(s.Trim(), CultureInfo.InvariantCulture))
                            .ToList();
                        break;
                    case "--blockMs":
                        opt.BlockMs = int.Parse(RequireNext(args, ref i, "--blockMs"), CultureInfo.InvariantCulture);
                        break;
                    case "--mode":
                        opt.Mode = RequireNext(args, ref i, "--mode");
                        break;
                    case "--mock":
                        opt.Mock = true;
                        break;
                    case "--help":
                    case "-h":
                        PrintHelp();
                        Environment.Exit(0);
                        break;
                }
            }

            if (opt.Channels.Count == 0) opt.Channels.Add(0);
            if (opt.SampleRate <= 0) opt.SampleRate = 1000;
            if (opt.BlockMs < 5) opt.BlockMs = 5;
            if (opt.Port <= 0) opt.Port = 8787;

            return opt;
        }

        private static void PrintHelp()
        {
            Console.WriteLine("Usb1601Bridge options:");
            Console.WriteLine("  --device USBDev0");
            Console.WriteLine("  --port 8787");
            Console.WriteLine("  --rate 1000");
            Console.WriteLine("  --low -10 --high 10");
            Console.WriteLine("  --channels 0   (or 0,1,2,3)");
            Console.WriteLine("  --blockMs 20");
            Console.WriteLine("  --mode auto|raw|features");
            Console.WriteLine("  --mock   (no hardware; generate a synthetic signal)");
        }

        private static string JsonString(string s)
        {
            // Minimal JSON string escaping.
            var sb = new StringBuilder(s.Length + 2);
            sb.Append('"');
            foreach (var ch in s)
            {
                switch (ch)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (ch < 32) sb.Append("\\u").Append(((int)ch).ToString("x4"));
                        else sb.Append(ch);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }

        private static string JsonNumber(double v)
        {
            if (double.IsNaN(v) || double.IsInfinity(v)) return "0";
            // Use invariant culture, compact.
            return v.ToString("0.################", CultureInfo.InvariantCulture);
        }

        private static string JsonInt(int v) => v.ToString(CultureInfo.InvariantCulture);
    }
}
