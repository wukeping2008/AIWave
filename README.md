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

### 5) 主要功能与操作指南 (Operation Guide)

#### 基本控制 (Basic Controls)
- **PLAY / STOP**：启动或停止音频引擎 (Tone.js Transport)。
- **BPM**：全局速度控制。
- **Preset**：快速切换音乐风格（Techno/House/Ambient），这会重置所有参数。
- **Vol / Rev**：控制总线音量与混响效果量。
- **Sim (New!)**：**离线模拟滑杆**。当未连接 USB-1601 硬件时，拖动此滑杆可手动模拟 0-1 的信号强度。这允许你在无硬件环境下测试声音对电压信号的动态响应（如滤波器开合、包络变化、增益提升等）。

#### 音乐编程 (Live Coding)
- **ACID / BASS**：旋律与低音编辑。
  - **Pattern**：输入音程度数序列（如 `0 2 4 7`）。支持 `-`（延音）和 `.`（休止符）。
  - **Scale**：音阶调式（支持 `a:minor`, `c:major`, `d:dorian`, `f:lydian` 等）。
  - **Trans**：移调（半音单位，如 `-12` 表示低八度）。
  - **Params**：可手动调整 Cutoff, Resonance, Decay 等参数（但在有信号输入时会被信号覆盖）。
- **DRUMS**：节奏鼓组编辑。
  - 使用 `x` 表示触发，`-` 或 `.` 表示空拍。
  - 示例：`x---x---x---x---` (典型的 4/4 拍)。

#### 导入导出
- **EXPORT / IMPORT**：将当前所有音序、参数和设置导出为 JSON 文件，或从 JSON 恢复现场。
- **FULLSCREEN**：进入全屏沉浸模式。
- **SOURCE & GUIDE**：打开内置帮助面板。

#### 快捷键
- `Space`：播放 / 停止（当输入焦点不在文本框时）。
- `H` 或 `?`：开关帮助面板。
- `Esc`：退出全屏。

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

### 5) Controls & Operation Guide

#### Basic Controls
- **PLAY / STOP**: Start/Stop the audio engine.
- **BPM**: Global tempo control.
- **Preset**: Load curated styles (Techno, House, Ambient). Resets all parameters.
- **Vol / Rev**: Master volume and reverb amount.
- **Sim (New!)**: **Offline Simulation Slider**. When the USB-1601 hardware is not connected, use this slider (0-1) to simulate a voltage signal. This lets you test the dynamic response (filter opening, envelope tightening, gain boost) without the physical device.

#### Live Coding (Patterns)
- **ACID / BASS**: Melodic sequencers.
  - **Pattern**: Enter scale degrees (e.g., `0 2 4 7`). Use `-` for hold and `.` for rest.
  - **Scale**: Musical mode (e.g., `a:minor`, `c:major`, `d:dorian`).
  - **Trans**: Transpose in semitones (e.g., `-12` is one octave down).
- **DRUMS**: Rhythm sequencer.
  - Use `x` for trigger, `-` or `.` for rest.
  - Example: `x---x---x---x---` (Four-on-the-floor).

#### Integration
- **EXPORT / IMPORT**: Save/Load current state to JSON.
- **FULLSCREEN**: Presentation mode.
- **SOURCE & GUIDE**: Built-in draggable help panel.

#### Shortcuts
- `Space`: Play/Stop (when not typing).
- `H` / `?`: Toggle guide.
- `Esc`: Exit fullscreen.

### 6) Requirements

- Node.js + npm (frontend)
- .NET SDK (bridge)
- USB-1601 driver + `JYUSB1601.dll` (hardware mode only)

### 7) Current Snapshot of This Repository

- Frontend is a Vite + Tone.js SPA.
- USB-1601 integration is implemented through `usb1601-bridge`.
- `electron/` directory exists but currently contains no active Electron source files.
- Frontend gracefully degrades when bridge is unavailable.
