# USB-1601 → LiveCodeMusic Bridge

This folder contains a small local WebSocket server that reads samples from a **JYTEK / 简仪科技 USB-1601** DAQ and streams them to the browser.

## What it does

- Opens `JYUSB1601AITask` (device name like `USBDev0`)
- Runs continuous acquisition at a chosen sample rate
- Broadcasts sample blocks over WebSocket: `ws://localhost:8787/ws`

## Prerequisites

- Install the USB-1601 driver (JYUSB1601) so the device shows up as `USBDev0` (or similar)
- Ensure the vendor `JYUSB1601.dll` is available
  - This repo references the DLL at:
    - `JYUSB-1601.Examples/New Winform 4.7.1/bin/Debug/JYUSB1601.dll`

## Build & run

From Git Bash:

```bash
cd "/d/Documents/AI Wave/LiveCodeMusic-USB1601/usb1601-bridge/Usb1601Bridge"
# Build
dotnet build -c Release

# Run (defaults: device USBDev0, rate 1000 Hz, channel 0, range ±10V)
dotnet run -c Release -- --device USBDev0 --rate 1000 --channels 0 --low -10 --high 10 --blockMs 20
```

If `dotnet` is not found, install the .NET SDK (or build with Visual Studio).

## High sample rates (e.g. 100 kHz)

Sending full raw samples as JSON will quickly become too heavy at high rates.

Use `--mode features` (or leave `--mode auto`, which switches to features at >= 10kHz):

```bash
dotnet run -c Release -- --device USBDev0 --rate 100000 --channels 0 --low -10 --high 10 --blockMs 10 --mode features
```

## Mock mode (no hardware)

For classroom demos, you can generate a synthetic signal:

```bash
dotnet run -c Release -- --mock --rate 100000 --channels 0 --low -10 --high 10 --blockMs 10 --mode features
```

## Message format

The server sends JSON text frames:

- `usb1601.hello`
- `usb1601.heartbeat`
- `usb1601.samples` (raw)
- `usb1601.features` (envelope/level)

`usb1601.samples` payload fields:

- `ts`: Unix ms
- `sampleRate`: Hz
- `n`: samples per channel in this block
- `c`: channel count
- `low` / `high`: configured voltage range
- `channels`: the requested channel indices
- `data`: flattened row-major array of `n*c` doubles

`usb1601.features` payload fields:

- `level`: 0..1 normalized envelope (smoothed)
- `rms`: RMS of the control channel for this block
- `peak`: absolute peak of the control channel for this block

