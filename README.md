# LiveCodeMusic-USB1601

> 浏览器端 Live Coding 音乐演示（Vite + Tone.js），并可选接入 USB-1601 实时信号（WebSocket 桥接）。  
> Browser-based live-coding music demo (Vite + Tone.js) with optional real-time USB-1601 signal input via a local WebSocket bridge.

---

## 中文说明（简体）

### 1) 项目简介

本项目是一个可在浏览器中实时编辑并播放的电子音乐 Demo，核心能力：

- 实时编辑 ACID / BASS / DRUMS（16-step）模式；
- Tone.js 音频引擎驱动，支持预设、导入导出 JSON、全屏展示；
- 底部实时可视化（频谱 / 波形 / 音符事件）；
- 可选接入 **JYTEK USB-1601** 采集卡信号，通过本地 C# WebSocket Bridge 发送到前端；
- 前端自动重连桥接服务，桥接未启动时也可作为纯音乐 Demo 正常运行。

### 2) 目录结构

```text
.
├─ index.html                 # 页面与交互控件
├─ main.js                    # 音频引擎、参数映射、USB-1601 WS接入、可视化逻辑
├─ style.css                  # 样式
├─ package.json               # 前端依赖（Vite + Tone）
├─ usb1601-bridge/
│  ├─ README.md               # 桥接服务说明
│  └─ Usb1601Bridge/
│     ├─ Program.cs           # C# WebSocket桥接服务
│     └─ Usb1601Bridge.csproj
└─ JYUSB-1601.Examples/       # 厂商示例与 DLL 参考
```

### 3) 前端运行

```bash
npm install
npm run dev
```

启动后打开终端给出的地址（通常是 `http://localhost:5173/`）。

### 4) USB-1601 实时信号桥接（可选）

浏览器不能直接读 USB 采集卡，因此需要本地桥接程序：

```bash
cd "usb1601-bridge/Usb1601Bridge"
dotnet build -c Release
dotnet run -c Release -- --device USBDev0 --rate 1000 --channels 0 --low -10 --high 10 --blockMs 20
```

- 默认前端连接地址：`ws://localhost:8787/ws`
- 若设备名不是 `USBDev0`（例如 `USBDev1`），请修改 `--device`
- 高采样率建议使用 features 模式：

```bash
dotnet run -c Release -- --device USBDev0 --rate 100000 --channels 0 --low -10 --high 10 --blockMs 10 --mode features
```

- 无硬件教学演示可用 Mock：

```bash
dotnet run -c Release -- --mock --rate 100000 --channels 0 --low -10 --high 10 --blockMs 10 --mode features
```

### 5) 主要功能与操作

- `PLAY / STOP`：播放与停止（Tone.Transport）
- `BPM`：速度控制
- `Preset`：快速切换演示状态（Techno/House/Ambient）
- `Vol / Rev`：总线音量与混响
- `EXPORT / IMPORT`：导出/导入当前 JSON 快照
- `FULLSCREEN`：全屏演示模式
- `SOURCE & GUIDE`：内置可拖拽使用说明

快捷键：

- `Space`：播放 / 停止（不在输入焦点时）
- `H` 或 `?`：开关帮助面板
- `Esc`：退出全屏

### 6) 开发依赖

- Node.js + npm（前端）
- .NET SDK（桥接服务）
- USB-1601 驱动与 `JYUSB1601.dll`（仅硬件模式需要）

### 7) 已确认的当前项目状态

- 前端为 **Vite + Tone.js** 单页应用；
- USB-1601 接入方式为本地 C# WebSocket 桥接（`usb1601-bridge`）；
- 项目中存在 `electron/` 目录但当前无实际 Electron 文件；
- 前端具备断开桥接时的降级能力（保持纯 Tone.js 可用）。

---

## English README

### 1) Overview

This project is a browser-based live-coding music demo with editable ACID/BASS/DRUM patterns and real-time visualization.

Key capabilities:

- Live edit melodic and drum patterns;
- Tone.js-powered audio engine with presets and JSON import/export;
- Realtime spectrum / waveform / note-event visualizer;
- Optional **JYTEK USB-1601** real-signal input via a local C# WebSocket bridge;
- Frontend auto-reconnects to bridge and still works in standalone mode if bridge is offline.

### 2) Project Structure

```text
.
├─ index.html                 # UI and control panel
├─ main.js                    # Audio engine, params, WS bridge client, visualization
├─ style.css                  # Styling
├─ package.json               # Frontend deps (Vite + Tone)
├─ usb1601-bridge/
│  ├─ README.md               # Bridge details
│  └─ Usb1601Bridge/
│     ├─ Program.cs           # C# local WebSocket server
│     └─ Usb1601Bridge.csproj
└─ JYUSB-1601.Examples/       # Vendor examples / DLL reference
```

### 3) Run Frontend

```bash
npm install
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173/`).

### 4) USB-1601 Bridge (Optional)

Run in another terminal:

```bash
cd "usb1601-bridge/Usb1601Bridge"
dotnet build -c Release
dotnet run -c Release -- --device USBDev0 --rate 1000 --channels 0 --low -10 --high 10 --blockMs 20
```

- Default frontend bridge URL: `ws://localhost:8787/ws`
- If your device is not `USBDev0`, change `--device`
- For high sample rates, prefer features mode:

```bash
dotnet run -c Release -- --device USBDev0 --rate 100000 --channels 0 --low -10 --high 10 --blockMs 10 --mode features
```

- For no-hardware demos, use mock mode:

```bash
dotnet run -c Release -- --mock --rate 100000 --channels 0 --low -10 --high 10 --blockMs 10 --mode features
```

### 5) Controls

- `PLAY / STOP` — start or stop transport/audio
- `BPM` — tempo
- `Preset` — load curated states
- `Vol / Rev` — master volume and reverb
- `EXPORT / IMPORT` — save/load JSON snapshot
- `FULLSCREEN` — presentation mode
- `SOURCE & GUIDE` — built-in draggable guide

Shortcuts:

- `Space` — play/stop (when not typing)
- `H` / `?` — toggle guide
- `Esc` — exit fullscreen

### 6) Requirements

- Node.js + npm (frontend)
- .NET SDK (bridge)
- USB-1601 driver + `JYUSB1601.dll` (hardware mode only)

### 7) Current Snapshot of This Repository

- Frontend is a Vite + Tone.js SPA.
- USB-1601 integration is implemented through `usb1601-bridge`.
- `electron/` directory exists but currently contains no active Electron source files.
- Frontend gracefully degrades when bridge is unavailable.
