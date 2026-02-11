# LiveCodeMusic-USB1601

A browser-based live-coding music demo built with Vite + Tone.js.

This fork adds an **optional real-signal input path** via a local USB-1601 WebSocket bridge.

## Run

```bash
cd "/d/Documents/AI Wave/LiveCodeMusic-USB1601"
npm install
npm run dev
```

Open the URL shown (usually `http://localhost:5173/`).

## USB-1601 (real signal) bridge

Browsers can’t talk to USB DAQ devices directly. This project expects a **local bridge** that reads USB-1601 samples and streams them to the page via WebSocket.

- Bridge URL (default): `ws://localhost:8787/ws`
- Frontend behavior: auto-connect + auto-reconnect; if bridge is missing, the demo still works (pure Tone.js).

### Start the bridge

In a second terminal:

```bash
cd "/d/Documents/AI Wave/LiveCodeMusic-USB1601/usb1601-bridge/Usb1601Bridge"
dotnet build -c Release
dotnet run -c Release -- --device USBDev0 --rate 1000 --channels 0 --low -10 --high 10 --blockMs 20
```

If your device name differs (e.g. `USBDev1`), change `--device`.

## Controls

- `PLAY / STOP`: starts/stops Tone.Transport (audio + visuals).
- `BPM`: tempo.
- `Preset`: loads a curated state (and updates all editable fields/sliders).
- `Vol / Rev`: master volume + master reverb.
- `EXPORT / IMPORT`: save/load a JSON snapshot.
- `FULLSCREEN`: demo mode.
- `SOURCE & GUIDE`: in-app guide (draggable).

## Live Editing (the “code” area)

### ACID / BASS

- `n("...")`: space-separated degrees.
  - `0` = root, `2` = 3rd, `4` = 5th.
  - Negative values go down.
  - Example: `0 2 4 7 9 7 4 2`
- `scale("...")`: `a:minor`, `c:major`, `d:dorian`, `chromatic`, etc.
- `trans(...)`: semitone transpose (Acid usually `-12`, Bass `-24`).
- `s("...")`: oscillator type.
  - Acid: `sawtooth`, `square`, `sine`, `triangle`
  - Bass: `sawtooth`, `square`, `sine`, `triangle`, `fmsine`

### DRUMS (16-step patterns)

Each bar is 16 characters:

- `x` = hit
- `-` = rest

Examples:

- Four-on-the-floor kick: `x---x---x---x---`
- Offbeat hats (8ths): `x-x-x-x-x-x-x-x-`
- Snare on beats 2 & 4: `----x-------x---`

You can also live-edit `hat gain` and `snare gain` as numbers.

## Shortcuts

- `Space`: play/stop (when you’re not typing in an input/editable field)
- `H` or `?`: toggle guide
- `Esc`: exit fullscreen

## 2-minute demo script

1. Pick a `Preset` and press `PLAY`.
2. Move `BPM` (slow → fast) and point out Transport-driven scheduling.
3. Edit `ACID n("...")` and show how the NOTES overlay changes.
4. Edit `scale("...")` and `trans(...)` to shift the harmonic center.
5. Edit DRUM patterns (kick/hat/snare) to show groove control.
6. Toggle `FULLSCREEN`.
7. `EXPORT` to capture the current “performance state”.

---

## 5分钟讲师操作清单（面向：有编程 + 信号处理基础）

目标：用“输入参数 → 可观测输出(声/谱/波形/音符轨迹) → 可导出状态(JSON) → 可用于数据采集/AI任务”的闭环讲清楚。

### 课前 60 秒（开讲前自检）

- [ ] 浏览器用 Chrome/Edge；连接音箱/耳机；系统音量正常。
- [ ] 启动：`npm install`（首次）→ `npm run dev` → 打开 `http://localhost:5173/`。
- [ ] 先点一次页面任意处，再点 `PLAY ▶️`（避免浏览器自动播放策略导致无声）。
- [ ] `Preset` 先切到 `Techno`（稳定、响度足够），确认底部面板有频谱/波形在动。
- [ ] 备份：准备一次 `EXPORT`（下载 JSON）作为“现场恢复点”。

### 讲授流程 5:00（按时间点照做）

**0:00–0:30 开场 + 解锁音频**
- [ ] 点击 `PLAY ▶️`（或按 `Space`）开始。
- [ ] 口播要点：这是 Tone.js 调度的“可重复实验系统”，不是随机生成。

**0:30–1:20 观测：频谱/波形/音符轨迹 = 信号视角**
- [ ] 指向底部 `SPECTRUM • WAVE • NOTES` 面板。
- [ ] 快速改 `BPM`：`110 → 150`（或反过来），让大家看到“同一算法，不同时间尺度”的输出变化。
- [ ] 口播要点（信号处理语境）：波形≈时域，频谱≈频域，NOTES≈事件层（离散符号）。

**1:20–2:10 输入：ACID 的离散序列（符号→声音）**
- [ ] 在 ACID 的 `n("...")` 里把一段替换成：`0 2 4 7 9 7 4 2`。
- [ ] 观察：音高轨迹/NOTES 点列随之变化。
- [ ] 口播要点：这相当于把“离散 token 序列”映射到合成器参数与音高事件。

**2:10–2:50 结构：scale / trans（同一序列，不同坐标系）**
- [ ] 把 `scale("a:minor")` 改成 `scale("c:major")`。
- [ ] 把 `trans(-12)` 改成 `trans(0)`（或 `-12 ↔ -24` 对比）。
- [ ] 口播要点：这是“同一个 token 序列”在不同音阶/平移下的解释（特征空间变换的直觉类比）。

**2:50–3:40 鼓：16-step pattern（离散节奏字符串）**
- [ ] 在 DRUMS：
  - Kick 保持 `x---x---x---x---`
  - Hat 改成更稀疏：`x---x---x---x---`
  - Snare 保持 `----x-------x---`
- [ ] 口播要点：这就是最小可用的数据结构——固定长度字符串（易存、易比较、易训练）。

**3:40–4:20 连续参数：滤波/延迟/失真 = 连续控制量**
- [ ] 缓慢推 `acid lpf`（例如 `1200 → 6000`），再推 `acid delay`（例如 `0.2 → 0.5`）。
- [ ] 口播要点：离散(序列/节奏) + 连续(滤波/混响/增益) → 混合参数空间，适合做回归/强化学习示例。

**4:20–4:45 数据采集动作：导出一次“状态快照”**
- [ ] 点击 `EXPORT` 下载 JSON。
- [ ] 口播要点：这份 JSON 是“可复现实验配置”，可作为每条样本的元数据（label/参数/上下文）。

**4:45–5:00 演示模式收尾**
- [ ] 点击 `FULLSCREEN ⛶`（或不进全屏，视现场投影而定）。
- [ ] 按 `Space` 停止，结束。

### 事故预案（现场 10 秒解决）

- **没声音**：先停再播（`Space` 两次）→ 确保点过页面 → 检查系统音量/输出设备。
- **音爆/太响**：先把 `Vol` 拉到 `0.6` 左右，再继续。
- **卡顿**：把 `Rev` 拉低（≤ `0.1`），避免浏览器回响计算开销。

### 建议采集字段（讲完可布置作业/实验）

- [ ] `EXPORT` 的 JSON（核心）
- [ ] 演示时的时间戳（开始/结束）+ `BPM` + `Preset`
- [ ] 可选：屏幕录制（含底部谱/波形）作为“弱标签”对齐
