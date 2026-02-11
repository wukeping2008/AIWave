import * as Tone from 'tone';

// DOM Elements
const playStopBtn = document.getElementById('play-stop-btn');
const bpmInput = document.getElementById('bpm-input');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const presetSelect = document.getElementById('preset-select');
const saveBtn = document.getElementById('save-btn');
const loadBtn = document.getElementById('load-btn');
const loadFileInput = document.getElementById('load-file');
const statusEl = document.getElementById('status');
const masterVolumeEl = document.getElementById('master-volume');
const masterVolumeValEl = document.getElementById('val-master-volume');
const masterReverbEl = document.getElementById('master-reverb');
const masterReverbValEl = document.getElementById('val-master-reverb');
// Simulation Slider (Offline Mode)
const simSliderEl = document.getElementById('sim-slider');
const simSliderValEl = document.getElementById('val-sim-slider');

const helpBtn = document.getElementById('help-btn');
const helpModal = document.getElementById('help-modal');
const closeModal = document.querySelector('.close-modal');

const visualizerCanvas = document.getElementById('visualizer');
const canvasCtx = visualizerCanvas.getContext('2d');

const controlBarEl = document.getElementById('control-bar');

function syncControlBarHeight() {
  if (!controlBarEl) return;
  const h = Math.ceil(controlBarEl.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--control-bar-h', `${h}px`);
}

// Editable inputs
const editables = {
  acidPattern: document.getElementById('acid-pattern'),
  acidScale: document.getElementById('acid-scale'),
  bassPattern: document.getElementById('bass-pattern'),
  bassScale: document.getElementById('bass-scale'),
  kickPattern: document.getElementById('kick-pattern'),
  hatPattern: document.getElementById('hat-pattern'),
  snarePattern: document.getElementById('snare-pattern'),
  hatGain: document.getElementById('hat-gain'),
  snareGain: document.getElementById('snare-gain'),
};

// Sliders and Values
const sliders = {
  acidCutoff: { el: document.getElementById('acid-cutoff'), val: document.getElementById('val-acid-cutoff') },
  acidLpf: { el: document.getElementById('acid-lpf'), val: document.getElementById('val-acid-lpf') },
  acidDelay: { el: document.getElementById('acid-delay'), val: document.getElementById('val-acid-delay') },
  acidGain: { el: document.getElementById('acid-gain'), val: document.getElementById('val-acid-gain') },
  bassDuck: { el: document.getElementById('bass-duck'), val: document.getElementById('val-bass-duck') },
  kickShape: { el: document.getElementById('kick-shape'), val: document.getElementById('val-kick-shape') },
  kickLpf: { el: document.getElementById('kick-lpf'), val: document.getElementById('val-kick-lpf') },
  kickGain: { el: document.getElementById('kick-gain'), val: document.getElementById('val-kick-gain') },
};

// Update number displays
Object.values(sliders).forEach(s => {
  s.el.addEventListener('input', (e) => {
    s.val.textContent = e.target.value;
  });
});

const STORAGE_KEY = 'livecodemusic:v1';

function setStatus(message, { isError = false, timeoutMs = 2500 } = {}) {
  if (!statusEl) return;
  statusEl.textContent = message || '';
  statusEl.style.color = isError ? '#fecaca' : '#cbd5e1';
  if (timeoutMs > 0 && message) {
    window.clearTimeout(setStatus._t);
    setStatus._t = window.setTimeout(() => {
      statusEl.textContent = '';
      statusEl.style.color = '#cbd5e1';
    }, timeoutMs);
  }
}

// Ensure modal never blocks the page on load
if (helpModal) {
  helpModal.classList.add('hidden');
}

// Debug: show topmost clicked element in the status bar (helps detect overlays)
const DEBUG_HIT_TEST = false;
if (DEBUG_HIT_TEST) {
  document.addEventListener('pointerdown', (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    const id = el.id ? `#${el.id}` : '';
    const cls = el.classList?.length ? `.${Array.from(el.classList).slice(0, 2).join('.')}` : '';
    setStatus(`Hit: ${el.tagName.toLowerCase()}${id}${cls}`, { timeoutMs: 900 });
  }, { capture: true });
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return true;
  if (target.isContentEditable) return true;
  return false;
}

function clamp01(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function clamp(v, min, max) {
  const n = Number(v);
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// --- USB-1601 REAL SIGNAL INPUT (optional) ---
// Browser cannot access USB DAQ directly; a local bridge streams samples via WebSocket.
// Start the bridge (see usb1601-bridge/) and the demo will automatically connect.

const USB1601_WS_URL = 'ws://localhost:8787/ws';
let usb1601Ws = null;
let usb1601ReconnectTimer = null;
let usb1601BackoffMs = 500;

let usb1601LevelEma = 0; // 0..1
let usb1601LastStatusAt = 0;
let usb1601LastBlockAt = 0;
let usb1601SignalActive = false;

function computeRmsFromFlattened(block, channelIndex, channelCount) {
  // block: flattened row-major [s0c0,s0c1,...,s1c0,...]
  let sumSq = 0;
  let n = 0;
  for (let i = channelIndex; i < block.length; i += channelCount) {
    const v = Number(block[i]);
    if (!Number.isFinite(v)) continue;
    sumSq += v * v;
    n++;
  }
  if (n === 0) return 0;
  return Math.sqrt(sumSq / n);
}

function connectUsb1601() {
  if (usb1601ReconnectTimer) {
    window.clearTimeout(usb1601ReconnectTimer);
    usb1601ReconnectTimer = null;
  }

  try {
    usb1601Ws = new WebSocket(USB1601_WS_URL);
  } catch {
    scheduleUsb1601Reconnect();
    return;
  }

  usb1601Ws.addEventListener('open', () => {
    usb1601BackoffMs = 500;
    setStatus('USB-1601 bridge connected', { timeoutMs: 1600 });
  });

  usb1601Ws.addEventListener('message', (ev) => {
    const msg = safeJsonParse(ev.data);
    if (!msg || !msg.type) return;

    if (msg.type === 'usb1601.error') {
      setStatus(`USB-1601 error: ${msg.message || 'unknown'}`, { isError: true, timeoutMs: 3000 });
      return;
    }

    if (msg.type === 'usb1601.heartbeat') {
      // keep-alive (no UI spam)
      return;
    }

    if (msg.type === 'usb1601.features') {
      usb1601LastBlockAt = performance.now();
      usb1601SignalActive = true;
      const level = clamp01(msg.level);
      // Faster response than raw mode; server already smooths.
      usb1601LevelEma = usb1601LevelEma * 0.75 + level * 0.25;

      const now = performance.now();
      if (now - usb1601LastStatusAt > 900) {
        usb1601LastStatusAt = now;
        setStatus(`USB-1601 lvl=${usb1601LevelEma.toFixed(3)} (features)`, { timeoutMs: 800 });
      }
      return;
    }

    if (msg.type !== 'usb1601.samples') return;

    usb1601LastBlockAt = performance.now();
    usb1601SignalActive = true;

    const data = Array.isArray(msg.data) ? msg.data : null;
    const c = Number(msg.c);
    const low = Number(msg.low);
    const high = Number(msg.high);
    if (!data || !Number.isFinite(c) || c <= 0) return;

    // Use channel 0 (first column) as the control signal by default.
    const rms = computeRmsFromFlattened(data, 0, c);

    // Normalize by voltage range (assume symmetric-ish ranges like ±10V).
    const range = Math.max(Math.abs(low), Math.abs(high), 1);
    const level = clamp01(rms / range);

    // EMA smoothing for musical control.
    usb1601LevelEma = usb1601LevelEma * 0.85 + level * 0.15;

    // Throttled status updates (for debugging/demo).
    const now = performance.now();
    if (now - usb1601LastStatusAt > 900) {
      usb1601LastStatusAt = now;
      setStatus(`USB-1601 lvl=${usb1601LevelEma.toFixed(3)}`, { timeoutMs: 800 });
    }
  });

  const onCloseOrError = () => {
    try { usb1601Ws?.close(); } catch { }
    usb1601Ws = null;
    scheduleUsb1601Reconnect();
  };

  usb1601Ws.addEventListener('close', onCloseOrError);
  usb1601Ws.addEventListener('error', onCloseOrError);
}

function scheduleUsb1601Reconnect() {
  if (usb1601ReconnectTimer) return;
  usb1601ReconnectTimer = window.setTimeout(() => {
    usb1601ReconnectTimer = null;
    connectUsb1601();
  }, usb1601BackoffMs);
  usb1601BackoffMs = Math.min(8000, Math.floor(usb1601BackoffMs * 1.6));
}

// Apply the signal level to synth parameters (runs even when disconnected; it just no-ops).
window.setInterval(() => {
  if (!audioInitialized) return;
  if (!acidFilter || !acidSynth || !bassGain || !masterReverb || !acidGainNode || !acidDelay || !kickDist) return;

  // Important: if the backend is not running (or no fresh blocks) AND no simulation, do NOT override manual UI edits.
  // This keeps the standalone frontend live-edit experience working.
  const now = performance.now();

  const simValue = parseFloat(simSliderEl?.value || 0);
  const isSimActive = simValue > 0.01;

  if ((!usb1601SignalActive || !usb1601LastBlockAt || (now - usb1601LastBlockAt > 2000)) && !isSimActive) {
    usb1601SignalActive = false;
    return;
  }

  // If the bridge is disconnected for a while, slowly fall back toward neutral.
  if (usb1601SignalActive && usb1601LastBlockAt && now - usb1601LastBlockAt > 1200) {
    usb1601LevelEma *= 0.97;
  }

  // Combine real signal and simulation (Sim overrides if higher, allowing testing)
  const rawLevel = usb1601SignalActive ? Math.max(usb1601LevelEma, simValue) : simValue;

  // Boost mid-levels so the effect is clearly audible.
  const level = clamp01(Math.pow(clamp01(rawLevel), 0.6));

  // Mapping (simple + stable)::
  // - ACID filter frequency opens with signal level
  // - ACID filter envelope gets wider
  // - Reverb wet gets slightly higher
  // - Bass gain nudges for energy
  const acidHz = 220 + level * 11500;
  acidFilter.frequency.rampTo(acidHz, 0.06);
  acidFilter.Q.rampTo(3 + level * 12, 0.08);

  acidSynth.filterEnvelope.octaves = 1.2 + level * 6.0;
  acidGainNode.gain.rampTo(0.45 + level * 1.15, 0.08);

  // Make movement very obvious in space + grit.
  masterReverb.wet.rampTo(clamp01(0.06 + level * 0.55), 0.18);
  acidDelay.feedback.rampTo(clamp01(0.18 + level * 0.62), 0.15);
  kickDist.distortion = clamp01(0.05 + level * 0.85);

  // Energy lift (keep bounded)
  bassGain.gain.rampTo(0.75 + level * 0.70, 0.12);
}, 50);

// Start connecting right away (bridge might come online later; we reconnect automatically).
connectUsb1601();

function parseStepPattern(patternStr, steps = 16) {
  const clean = String(patternStr ?? '').replace(/\u00A0/g, ' ').trim();
  if (!clean) return null;
  const chars = clean.replace(/\s+/g, '');
  const out = [];
  for (const ch of chars) {
    if (out.length >= steps) break;
    if (ch === 'x' || ch === 'X' || ch === '1') out.push(true);
    else if (ch === '-' || ch === '.' || ch === '0' || ch === '_') out.push(false);
  }
  if (!out.length) return null;
  while (out.length < steps) out.push(false);
  return out;
}

// --- CONTROLS ---

// BPM
bpmInput.addEventListener('change', (e) => {
  Tone.Transport.bpm.value = parseFloat(e.target.value);
});

// Fullscreen
fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {
      setStatus('Fullscreen blocked by browser', { isError: true });
    });
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
});

document.addEventListener('fullscreenchange', () => {
  const isFull = Boolean(document.fullscreenElement);
  fullscreenBtn.textContent = isFull ? 'EXIT FULL ⛶' : 'FULLSCREEN ⛶';
  syncControlBarHeight();
});

// Help Modal
helpBtn.addEventListener('click', () => helpModal.classList.remove('hidden'));
closeModal.addEventListener('click', () => helpModal.classList.add('hidden'));
helpModal.addEventListener('click', (e) => {
  if (e.target === helpModal) helpModal.classList.add('hidden');
});

function toggleHelp() {
  if (!helpModal) return;
  helpModal.classList.toggle('hidden');
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Space') {
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    playStopBtn.click();
    return;
  }

  if (e.key === 'h' || e.key === 'H' || e.key === '?') {
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    toggleHelp();
    return;
  }

  if (e.key === 'Escape') {
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
});

window.addEventListener('resize', syncControlBarHeight);
window.addEventListener('load', syncControlBarHeight);
syncControlBarHeight();


// --- SCALES & PARSING ---

// Expanded Scale Map
const SCALES = {
  "a:minor": { root: "A", intervals: [0, 2, 3, 5, 7, 8, 10] },
  "c:major": { root: "C", intervals: [0, 2, 4, 5, 7, 9, 11] },
  "g:minor": { root: "G", intervals: [0, 2, 3, 5, 7, 8, 10] },
  "d:dorian": { root: "D", intervals: [0, 2, 3, 5, 7, 9, 10] },
  "e:phrygian": { root: "E", intervals: [0, 1, 3, 5, 7, 8, 10] },
  "f:lydian": { root: "F", intervals: [0, 2, 4, 6, 7, 9, 11] },
  "b:locrian": { root: "B", intervals: [0, 1, 3, 5, 6, 8, 10] },
  "chromatic": { root: "C", intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }
};

function getNotesFromPattern(patternStr, scaleStr, baseOctave) {
  // Determine Transpose based on context (Acid vs Bass) using the new DOM IDs
  let trans = 0;
  if (baseOctave === 3) { // Acid
    const el = document.getElementById('acid-trans');
    trans = el ? (parseInt(el.textContent) || -12) : -12;
  } else { // Bass
    const el = document.getElementById('bass-trans');
    trans = el ? (parseInt(el.textContent) || -24) : -24;
  }

  const cleanPattern = patternStr.replace(/\u00A0/g, ' ').trim();
  const cleanScale = scaleStr.replace(/\u00A0/g, ' ').trim();

  const nums = cleanPattern.split(/\s+/).map(s => parseInt(s));
  const scaleKey = cleanScale.toLowerCase();

  // Robust Scale Lookup
  let scaleIntervals = SCALES["a:minor"].intervals;
  let rootNoteStr = "A";

  if (SCALES[scaleKey]) {
    scaleIntervals = SCALES[scaleKey].intervals;
    rootNoteStr = SCALES[scaleKey].root;
  } else {
    // Fallback: try to guess root from first letter
    const firstChar = scaleKey.charAt(0).toUpperCase();
    if (["C", "D", "E", "F", "G", "A", "B"].includes(firstChar)) {
      rootNoteStr = firstChar;
    }
  }

  if (!SCALES[scaleKey] && scaleKey) {
    setStatus(`Unknown scale "${cleanScale}" → using ${rootNoteStr}`, { timeoutMs: 1500 });
  }

  return nums.map(num => {
    if (isNaN(num)) return null;
    const octaveShift = Math.floor(num / 7);
    const degree = ((num % 7) + 7) % 7;
    const semitone = scaleIntervals[degree];

    // Calculate final note
    return Tone.Frequency(rootNoteStr + baseOctave)
      .transpose(semitone + trans + (octaveShift * 12))
      .toNote();
  }).filter(n => n !== null);
}

// --- AUDIO ENGINE ---

let audioInitialized = false;
let acidSynth, bassSynth, kickSynth, hatSynth, snareSynth;
let acidFilter, bassFilter, kickFilter;
let acidDelay, kickDist, kickGain, bassGain, acidGainNode;
let hatGain, snareGain;
let masterGain, masterCompressor, masterReverb;
let acidSeq, bassSeq, kickSeq, duckLoop, hatSeq, snareSeq;

async function initAudio() {
  if (audioInitialized) return;
  await Tone.start();

  // --- MASTER BUS ---
  masterGain = new Tone.Gain(1.0);
  masterCompressor = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.01, release: 0.2 });
  masterReverb = new Tone.Reverb({ decay: 2.2, preDelay: 0.01, wet: clamp01(masterReverbEl?.value ?? 0.15) });
  masterGain.connect(masterCompressor);
  masterCompressor.connect(masterReverb);
  masterReverb.connect(Tone.Destination);

  applyMasterVolume();

  // --- KICK SYSTEM ---
  kickDist = new Tone.Distortion(0).connect(masterGain);
  kickFilter = new Tone.Filter(3000, "lowpass").connect(kickDist);
  kickGain = new Tone.Gain(1.0).connect(kickFilter);
  kickSynth = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 4,
    oscillator: { type: "sine" },
    envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4, attackCurve: "exponential" }
  }).connect(kickGain);

  // --- BASS SYSTEM ---
  bassGain = new Tone.Gain(0.95).connect(masterGain);
  bassFilter = new Tone.Filter(260, "lowpass").connect(bassGain);
  bassSynth = new Tone.Synth({
    oscillator: { type: "fmsine", modulationType: "sine", modulationIndex: 3, harmonicity: 3.4 },
    envelope: { attack: 0.001, decay: 0.1, sustain: 0.5, release: 0.1 }
  }).connect(bassFilter);

  // --- ACID SYSTEM ---
  acidDelay = new Tone.FeedbackDelay("8n.", 0.5).connect(masterGain);
  acidGainNode = new Tone.Gain(0.6).connect(acidDelay);
  acidFilter = new Tone.Filter(3000, "lowpass", -24).connect(acidGainNode);
  acidSynth = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.5 },
    filterEnvelope: { attack: 0.001, decay: 0.1, sustain: 0.1, octaves: 2, baseFrequency: 200 }
  }).connect(acidFilter);
  acidFilter.Q.value = 5;

  // --- SIMPLE DRUM ADD-ONS (HAT + SNARE) ---
  const initialHatGain = clamp(editables.hatGain?.textContent ?? 0.15, 0, 1.5);
  const initialSnareGain = clamp(editables.snareGain?.textContent ?? 0.22, 0, 1.5);
  hatGain = new Tone.Gain(initialHatGain).connect(masterGain);
  snareGain = new Tone.Gain(initialSnareGain).connect(masterGain);
  hatSynth = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0.0, release: 0.02 }
  }).connect(hatGain);
  snareSynth = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.001, decay: 0.12, sustain: 0.0, release: 0.05 }
  }).connect(snareGain);

  // --- VISUALIZATION SETUP ---
  const waveform = new Tone.Waveform(2048);
  const fft = new Tone.FFT(128);
  Tone.Destination.connect(waveform);
  Tone.Destination.connect(fft);

  startVisualizer(waveform, fft);

  audioInitialized = true;
  console.log("Audio Engine Initialized");
}

function applyMasterVolume() {
  const v = clamp01(masterVolumeEl?.value ?? 0.9);
  if (masterVolumeValEl) masterVolumeValEl.textContent = String(v);
  if (!masterGain) return;
  // Map 0..1 to -60..0 dB (perceptual-ish)
  const db = v <= 0.0001 ? -60 : Tone.gainToDb(v);
  masterGain.gain.rampTo(Tone.dbToGain(db), 0.05);
}

function applyMasterReverb() {
  const wet = clamp01(masterReverbEl?.value ?? 0.15);
  if (masterReverbValEl) masterReverbValEl.textContent = String(wet);
  if (masterReverb) masterReverb.wet.rampTo(wet, 0.1);
}

function schedulePatterns() {
  // Dispose previous loop/seq objects (Transport.cancel() does not free them)
  try { kickSeq?.dispose(); } catch { }
  try { hatSeq?.dispose(); } catch { }
  try { snareSeq?.dispose(); } catch { }
  try { acidSeq?.dispose(); } catch { }
  try { bassSeq?.dispose(); } catch { }
  try { duckLoop?.dispose(); } catch { }

  kickSeq = null;
  hatSeq = null;
  snareSeq = null;
  acidSeq = null;
  bassSeq = null;
  duckLoop = null;

  // Clear previous schedules
  Tone.Transport.cancel();
  Tone.Transport.bpm.value = parseFloat(bpmInput.value) || 135;

  // 1. Drums (16-step patterns)
  const kickPattern = parseStepPattern(editables.kickPattern?.textContent, 16) ?? parseStepPattern('x---x---x---x---', 16);
  const hatPattern = parseStepPattern(editables.hatPattern?.textContent, 16) ?? parseStepPattern('x-x-x-x-x-x-x-x-', 16);
  const snarePattern = parseStepPattern(editables.snarePattern?.textContent, 16) ?? parseStepPattern('----x-------x---', 16);

  kickSeq = new Tone.Sequence((time, hit) => {
    if (!hit) return;
    kickSynth.triggerAttackRelease("C1", "8n", time);
    Tone.Draw.schedule(() => recordKickPulse(), time);
  }, kickPattern, '16n').start(0);

  hatSeq = new Tone.Sequence((time, hit) => {
    if (!hit) return;
    hatSynth.triggerAttackRelease('16n', time, 0.6);
  }, hatPattern, '16n').start(0);

  snareSeq = new Tone.Sequence((time, hit) => {
    if (!hit) return;
    snareSynth.triggerAttackRelease('16n', time, 0.75);
  }, snarePattern, '16n').start(0);

  // 2. Bass Sequence
  const bassNotes = getNotesFromPattern(editables.bassPattern.textContent, editables.bassScale.textContent, 1);
  bassSeq = new Tone.Sequence((time, note) => {
    bassSynth.triggerAttackRelease(note, "16n", time);
    Tone.Draw.schedule(() => recordNoteEvent('bass', note), time);
  }, bassNotes.length ? bassNotes : ["A1"], "4n").start(0);

  // 3. Bass Ducking
  duckLoop = new Tone.Loop(time => {
    const duckVal = parseFloat(sliders.bassDuck.el.value);
    if (duckVal > 0) {
      bassGain.gain.setValueAtTime(1 - duckVal, time);
      bassGain.gain.linearRampToValueAtTime(0.95, time + 0.1);
    }
  }, "4n").start(0);

  // 4. Acid Sequence
  const acidNotes = getNotesFromPattern(editables.acidPattern.textContent, editables.acidScale.textContent, 3);
  acidSeq = new Tone.Sequence((time, note) => {
    const vel = Math.random() > 0.8 ? 0.9 : 0.5;
    acidSynth.triggerAttackRelease(note, "16n", time, vel);
    Tone.Draw.schedule(() => recordNoteEvent('acid', note), time);
  }, acidNotes.length ? acidNotes : ["A3"], "16n").start(0);
}

// --- CONTROLS & STATE ---

// Strict Toggle Logic
playStopBtn.addEventListener('click', async () => {
  // 1. Initial Setup
  if (!audioInitialized) {
    try {
      await initAudio();
    } catch (err) {
      console.error(err);
      setStatus('Audio init failed (check browser permissions)', { isError: true, timeoutMs: 4000 });
      return;
    }
  }

  // 2. Resume browser context
  if (Tone.context.state !== 'running') {
    await Tone.context.resume();
  }

  // 3. Toggle State based on Transport
  if (Tone.Transport.state === 'started') {
    // --- STOPPING ---
    console.log("Stopping...");
    Tone.Transport.stop();

    // Update UI
    playStopBtn.textContent = "PLAY ▶️";
    playStopBtn.classList.remove('active'); // CSS handles Blue color

    stopVisualizerAnimation();
    setStatus('Stopped');
  } else {
    // --- STARTING ---
    console.log("Starting...");
    schedulePatterns(); // Load latest code
    Tone.Transport.start();

    // Update UI
    playStopBtn.textContent = "STOP ⬛";
    playStopBtn.classList.add('active'); // CSS handles Red color

    startVisualizerAnimation();
    setStatus('Playing');
  }
});

// Update Listeners
function updateParams() {
  if (!audioInitialized) return;

  // Drum gains (editable numeric)
  if (hatGain && editables.hatGain) {
    const v = clamp(editables.hatGain.textContent, 0, 1.5);
    hatGain.gain.rampTo(v, 0.05);
  }
  if (snareGain && editables.snareGain) {
    const v = clamp(editables.snareGain.textContent, 0, 1.5);
    snareGain.gain.rampTo(v, 0.05);
  }

  // Drum patterns (16-step)
  if (kickSeq && editables.kickPattern) {
    const p = parseStepPattern(editables.kickPattern.textContent, 16);
    if (p) kickSeq.events = p;
  }
  if (hatSeq && editables.hatPattern) {
    const p = parseStepPattern(editables.hatPattern.textContent, 16);
    if (p) hatSeq.events = p;
  }
  if (snareSeq && editables.snarePattern) {
    const p = parseStepPattern(editables.snarePattern.textContent, 16);
    if (p) snareSeq.events = p;
  }

  // Acid Updates
  const acidEl = document.getElementById('acid-pattern');
  const acidScaleEl = document.getElementById('acid-scale');
  if (acidEl && acidScaleEl) {
    const acidNotes = getNotesFromPattern(acidEl.textContent, acidScaleEl.textContent, 3);
    if (acidSeq) acidSeq.events = acidNotes.length ? acidNotes : ["A3"];
  }

  // Synth Type Update (Acid)
  const acidTypeEl = document.getElementById('acid-synth-type');
  if (acidSynth && acidTypeEl) {
    const type = acidTypeEl.textContent.trim();
    if (["sawtooth", "square", "sine", "triangle"].includes(type)) {
      acidSynth.oscillator.type = type;
    }
  }

  // Bass Updates
  const bassEl = document.getElementById('bass-pattern');
  const bassScaleEl = document.getElementById('bass-scale');
  if (bassEl && bassScaleEl) {
    const bassNotes = getNotesFromPattern(bassEl.textContent, bassScaleEl.textContent, 1);
    if (bassSeq) bassSeq.events = bassNotes.length ? bassNotes : ["A1"];
  }

  // Synth Type Update (Bass)
  const bassTypeEl = document.getElementById('bass-synth-type');
  if (bassSynth && bassTypeEl) {
    const type = bassTypeEl.textContent.trim();
    if (["sawtooth", "square", "sine", "triangle", "fmsine"].includes(type)) {
      bassSynth.oscillator.type = type;
    } else if (type) {
      setStatus(`Unknown bass osc "${type}"`, { isError: true, timeoutMs: 1500 });
    }
  }
}

// Attach listeners to everything with class 'editable'
document.querySelectorAll('.editable').forEach(el => {
  el.addEventListener('input', updateParams);
  // Also trigger on 'blur' to be safe
  el.addEventListener('blur', updateParams);
});

// Master control bindings
masterVolumeEl?.addEventListener('input', () => {
  if (masterVolumeValEl) masterVolumeValEl.textContent = masterVolumeEl.value;
  if (audioInitialized) applyMasterVolume();
  scheduleSaveState();
});

masterReverbEl?.addEventListener('input', () => {
  if (masterReverbValEl) masterReverbValEl.textContent = masterReverbEl.value;
  if (audioInitialized) applyMasterReverb();
  scheduleSaveState();
});

simSliderEl?.addEventListener('input', () => {
  if (simSliderValEl) simSliderValEl.textContent = parseFloat(simSliderEl.value).toFixed(2);
});


// Draggable Modal
const modalContent = document.querySelector('.modal-content');
let isDragging = false;
let currentX;
let currentY;
let initialX;
let initialY;
let xOffset = 0;
let yOffset = 0;

modalContent.addEventListener("mousedown", dragStart);
document.addEventListener("mouseup", dragEnd);
document.addEventListener("mousemove", drag);

function dragStart(e) {
  initialX = e.clientX - xOffset;
  initialY = e.clientY - yOffset;
  if (e.target === modalContent || e.target.tagName === 'H2') { // Header or background
    isDragging = true;
  }
}

function dragEnd(e) {
  initialX = currentX;
  initialY = currentY;
  isDragging = false;
}

function drag(e) {
  if (isDragging) {
    e.preventDefault();
    currentX = e.clientX - initialX;
    currentY = e.clientY - initialY;
    xOffset = currentX;
    yOffset = currentY;
    setTranslate(currentX, currentY, modalContent);
  }
}

function setTranslate(xPos, yPos, el) {
  el.style.transform = "translate3d(" + xPos + "px, " + yPos + "px, 0)";
}


// --- CLUB VISUALIZER ---
let animationId;
let visualizerFunction;
let visWidth = 0;
let visHeight = 0;
let visDpr = 1;
let visGradient = null;

const VISUALIZER_HEIGHT_PX = 260;

// Note-event visualization (shows melodic changes when editing patterns)
const noteEvents = [];
const NOTE_EVENT_MAX = 200;

function recordNoteEvent(track, note) {
  if (!note) return;
  let midi;
  try {
    midi = Tone.Frequency(note).toMidi();
  } catch {
    return;
  }
  noteEvents.push({ t: performance.now(), track, midi });
  if (noteEvents.length > NOTE_EVENT_MAX) {
    noteEvents.splice(0, noteEvents.length - NOTE_EVENT_MAX);
  }
}

let kickPulseT = 0;
function recordKickPulse() {
  kickPulseT = performance.now();
}

function resizeVisualizer() {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const cssW = window.innerWidth;
  const cssH = VISUALIZER_HEIGHT_PX;

  if (cssW === visWidth && cssH === visHeight && dpr === visDpr) return;
  visWidth = cssW;
  visHeight = cssH;
  visDpr = dpr;

  visualizerCanvas.style.width = cssW + 'px';
  visualizerCanvas.style.height = cssH + 'px';
  visualizerCanvas.width = Math.floor(cssW * dpr);
  visualizerCanvas.height = Math.floor(cssH * dpr);
  canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Rebuild gradient on resize
  visGradient = canvasCtx.createLinearGradient(0, cssH, 0, 0);
  visGradient.addColorStop(0, '#3b82f6');
  visGradient.addColorStop(0.5, '#8b5cf6');
  visGradient.addColorStop(1, '#d946ef');
}

function startVisualizer(waveform, fft) {
  resizeVisualizer();
  window.addEventListener('resize', resizeVisualizer);

  visualizerFunction = function draw() {
    animationId = requestAnimationFrame(draw);

    resizeVisualizer();

    // Dimensions (CSS pixels)
    const w = visWidth;
    const h = visHeight;
    const cx = w / 2;
    const cy = h / 2;

    canvasCtx.clearRect(0, 0, w, h);

    // Dark base to boost contrast
    canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    canvasCtx.fillRect(0, 0, w, h);

    // Kick pulse glow near bottom
    const pulseAge = (performance.now() - kickPulseT) / 260;
    const pulse = Math.max(0, 1 - pulseAge);
    if (pulse > 0) {
      const r = 70 + pulse * 160;
      const g = canvasCtx.createRadialGradient(cx, h - 18, 10, cx, h - 18, r);
      g.addColorStop(0, `rgba(217, 70, 239, ${0.28 * pulse})`);
      g.addColorStop(1, 'rgba(217, 70, 239, 0)');
      canvasCtx.fillStyle = g;
      canvasCtx.fillRect(0, 0, w, h);
    }

    // 1. SHADOW / GLOW EFFECT
    canvasCtx.shadowBlur = 18;
    canvasCtx.shadowColor = "#d946ef";

    // 2. MIRRORED SPECTRUM (CLUBSTYLE)
    const fftValues = fft.getValue();
    // We want to draw from center out
    const barWidth = (w / fftValues.length);

    canvasCtx.fillStyle = visGradient || '#3b82f6';

    for (let i = 0; i < fftValues.length; i++) {
      const val = Tone.dbToGain(fftValues[i]);
      // Enhance Highs
      const boost = 1 + (i / fftValues.length) * 2;
      const barHeight = Math.min(val * h * 6 * boost, h);
      const bw = Math.max(1, barWidth - 1);

      // Draw Left
      canvasCtx.fillRect(cx - (i * barWidth) - barWidth, h - barHeight, bw, barHeight);
      // Draw Right
      canvasCtx.fillRect(cx + (i * barWidth), h - barHeight, bw, barHeight);
    }

    // 3. OSCILLOSCOPE LINE OVERLAY
    canvasCtx.shadowBlur = 12;
    canvasCtx.shadowColor = "#3b82f6";
    const waveValues = waveform.getValue();
    canvasCtx.lineWidth = 3;
    canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    canvasCtx.beginPath();

    const sliceWidth = w * 1.0 / waveValues.length;
    let x = 0;
    for (let i = 0; i < waveValues.length; i++) {
      const v = waveValues[i] * 4.5;
      const y = cy + (v * 70);
      if (i === 0) canvasCtx.moveTo(x, y);
      else canvasCtx.lineTo(x, y);
      x += sliceWidth;
    }
    canvasCtx.stroke();

    // 4. NOTE EVENT GRID + TRAILS (Acid/Bass)
    const now = performance.now();
    const windowMs = 9000;
    const xPad = 18;
    const yTop = 14;
    const yBottom = h - 14;
    const midiMin = 30;
    const midiMax = 84;

    // Musical grid: vertical beat lines + subtle pitch guides
    canvasCtx.save();
    canvasCtx.globalCompositeOperation = 'lighter';
    canvasCtx.lineWidth = 1;
    for (let i = 0; i <= 16; i++) {
      const xx = xPad + (i / 16) * (w - xPad * 2);
      const a = (i % 4 === 0) ? 0.18 : 0.08;
      canvasCtx.strokeStyle = `rgba(255, 255, 255, ${a})`;
      canvasCtx.beginPath();
      canvasCtx.moveTo(xx, yTop);
      canvasCtx.lineTo(xx, yBottom);
      canvasCtx.stroke();
    }
    for (let j = 0; j <= 6; j++) {
      const yy = yTop + (j / 6) * (yBottom - yTop);
      canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      canvasCtx.beginPath();
      canvasCtx.moveTo(xPad, yy);
      canvasCtx.lineTo(w - xPad, yy);
      canvasCtx.stroke();
    }
    canvasCtx.restore();

    canvasCtx.shadowBlur = 0;
    const lastByTrack = new Map();
    for (let i = noteEvents.length - 1; i >= 0; i--) {
      const ev = noteEvents[i];
      const age = now - ev.t;
      if (age > windowMs) break;
      const t = age / windowMs; // 0 = newest, 1 = oldest
      const a = 1 - t;
      const xx = (w - xPad) - (t * (w - xPad * 2));
      const midiNorm = (ev.midi - midiMin) / (midiMax - midiMin);
      const yy = yBottom - Math.max(0, Math.min(1, midiNorm)) * (yBottom - yTop);
      const r = ev.track === 'acid' ? 4.5 : 3.5;
      const color = ev.track === 'acid'
        ? `rgba(210, 168, 255, ${0.9 * a})`
        : `rgba(121, 192, 255, ${0.9 * a})`;

      const prev = lastByTrack.get(ev.track);
      if (prev && (prev.x > xx)) {
        canvasCtx.strokeStyle = ev.track === 'acid'
          ? `rgba(210, 168, 255, ${0.35 * a})`
          : `rgba(121, 192, 255, ${0.32 * a})`;
        canvasCtx.lineWidth = ev.track === 'acid' ? 2.2 : 2.0;
        canvasCtx.beginPath();
        canvasCtx.moveTo(prev.x, prev.y);
        canvasCtx.lineTo(xx, yy);
        canvasCtx.stroke();
      }
      lastByTrack.set(ev.track, { x: xx, y: yy });

      canvasCtx.fillStyle = color;
      canvasCtx.beginPath();
      canvasCtx.arc(xx, yy, r, 0, Math.PI * 2);
      canvasCtx.fill();
    }

    // Reset Shadow for performance?
    canvasCtx.shadowBlur = 0;
  };
}

function startVisualizerAnimation() {
  if (visualizerFunction && !animationId) {
    visualizerFunction();
  }
}

function stopVisualizerAnimation() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
    canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
  }
}

// Slider Bindings (Moved to bottom to ensure vars exist)
sliders.kickShape.el.addEventListener('input', e => { if (kickDist) kickDist.distortion = parseFloat(e.target.value); });
sliders.kickLpf.el.addEventListener('input', e => { if (kickFilter) kickFilter.frequency.rampTo(parseFloat(e.target.value), 0.1); });
sliders.kickGain.el.addEventListener('input', e => { if (kickGain) kickGain.gain.rampTo(parseFloat(e.target.value), 0.1); });

sliders.acidCutoff.el.addEventListener('input', e => {
  if (acidSynth) acidSynth.filterEnvelope.octaves = parseFloat(e.target.value) * 5 + 1;
});
sliders.acidLpf.el.addEventListener('input', e => { if (acidFilter) acidFilter.frequency.rampTo(parseFloat(e.target.value), 0.1); });
sliders.acidDelay.el.addEventListener('input', e => { if (acidDelay) acidDelay.wet.rampTo(parseFloat(e.target.value), 0.1); });
sliders.acidGain.el.addEventListener('input', e => { if (acidGainNode) acidGainNode.gain.rampTo(parseFloat(e.target.value), 0.1); });

// --- PRESETS + STATE ---
const PRESETS = {
  techno: {
    bpm: 135,
    acidPattern: '0 2 4 7 9 7 4 2 0 2 5 9 12 9 5 2',
    acidScale: 'a:minor',
    acidTrans: '-12',
    acidType: 'sawtooth',
    bassPattern: '0 0 0 -3',
    bassScale: 'a:minor',
    bassTrans: '-24',
    bassType: 'square',
    drums: {
      kickPattern: 'x---x---x---x---',
      hatPattern: 'x-x-x-x-x-x-x-x-',
      snarePattern: '----x-------x---',
      hatGain: '0.15',
      snareGain: '0.22'
    },
    sliders: { acidCutoff: 0.4, acidLpf: 2500, acidDelay: 0.4, acidGain: 0.6, bassDuck: 0.4, kickShape: 0.2, kickLpf: 3000, kickGain: 1.0 },
    master: { volume: 0.9, reverb: 0.12 }
  },
  house: {
    bpm: 124,
    acidPattern: '0 2 4 5 7 9 7 5',
    acidScale: 'c:major',
    acidTrans: '-12',
    acidType: 'triangle',
    bassPattern: '0 0 -3 -3',
    bassScale: 'c:major',
    bassTrans: '-24',
    bassType: 'fmsine',
    drums: {
      kickPattern: 'x---x---x---x---',
      hatPattern: 'x-x-x-x-x-x-x-x-',
      snarePattern: '----x-------x---',
      hatGain: '0.13',
      snareGain: '0.20'
    },
    sliders: { acidCutoff: 0.28, acidLpf: 1800, acidDelay: 0.25, acidGain: 0.55, bassDuck: 0.55, kickShape: 0.1, kickLpf: 2500, kickGain: 1.05 },
    master: { volume: 0.9, reverb: 0.18 }
  },
  ambient: {
    bpm: 88,
    acidPattern: '0 4 7 9 7 4',
    acidScale: 'd:dorian',
    acidTrans: '-12',
    acidType: 'sine',
    bassPattern: '0 -3 0 -5',
    bassScale: 'd:dorian',
    bassTrans: '-24',
    bassType: 'sine',
    drums: {
      kickPattern: 'x---x---x---x---',
      hatPattern: 'x---x---x---x---',
      snarePattern: '----x-------x---',
      hatGain: '0.10',
      snareGain: '0.16'
    },
    sliders: { acidCutoff: 0.15, acidLpf: 1200, acidDelay: 0.55, acidGain: 0.4, bassDuck: 0.15, kickShape: 0.05, kickLpf: 1800, kickGain: 0.85 },
    master: { volume: 0.8, reverb: 0.45 }
  }
};

function readStateFromDom() {
  return {
    bpm: Number(bpmInput?.value ?? 135),
    preset: presetSelect?.value ?? 'custom',
    acid: {
      pattern: editables.acidPattern?.textContent ?? '',
      scale: editables.acidScale?.textContent ?? '',
      trans: document.getElementById('acid-trans')?.textContent ?? '-12',
      type: document.getElementById('acid-synth-type')?.textContent ?? 'sawtooth'
    },
    bass: {
      pattern: editables.bassPattern?.textContent ?? '',
      scale: editables.bassScale?.textContent ?? '',
      trans: document.getElementById('bass-trans')?.textContent ?? '-24',
      type: document.getElementById('bass-synth-type')?.textContent ?? 'square'
    },
    drums: {
      kickPattern: editables.kickPattern?.textContent ?? 'x---x---x---x---',
      hatPattern: editables.hatPattern?.textContent ?? 'x-x-x-x-x-x-x-x-',
      snarePattern: editables.snarePattern?.textContent ?? '----x-------x---',
      hatGain: editables.hatGain?.textContent ?? '0.15',
      snareGain: editables.snareGain?.textContent ?? '0.22'
    },
    sliders: Object.fromEntries(Object.entries(sliders).map(([k, v]) => [k, Number(v.el.value)])),
    master: {
      volume: Number(masterVolumeEl?.value ?? 0.9),
      reverb: Number(masterReverbEl?.value ?? 0.15)
    }
  };
}

function applyStateToDom(state, { setPreset = false } = {}) {
  if (!state) return;
  if (typeof state.bpm === 'number' && bpmInput) bpmInput.value = String(state.bpm);

  if (state.acid) {
    if (editables.acidPattern && typeof state.acid.pattern === 'string') editables.acidPattern.textContent = state.acid.pattern;
    if (editables.acidScale && typeof state.acid.scale === 'string') editables.acidScale.textContent = state.acid.scale;
    const acidTransEl = document.getElementById('acid-trans');
    if (acidTransEl && typeof state.acid.trans === 'string') acidTransEl.textContent = state.acid.trans;
    const acidTypeEl = document.getElementById('acid-synth-type');
    if (acidTypeEl && typeof state.acid.type === 'string') acidTypeEl.textContent = state.acid.type;
  }

  if (state.bass) {
    if (editables.bassPattern && typeof state.bass.pattern === 'string') editables.bassPattern.textContent = state.bass.pattern;
    if (editables.bassScale && typeof state.bass.scale === 'string') editables.bassScale.textContent = state.bass.scale;
    const bassTransEl = document.getElementById('bass-trans');
    if (bassTransEl && typeof state.bass.trans === 'string') bassTransEl.textContent = state.bass.trans;
    const bassTypeEl = document.getElementById('bass-synth-type');
    if (bassTypeEl && typeof state.bass.type === 'string') bassTypeEl.textContent = state.bass.type;
  }

  if (state.drums) {
    if (editables.kickPattern && typeof state.drums.kickPattern === 'string') editables.kickPattern.textContent = state.drums.kickPattern;
    if (editables.hatPattern && typeof state.drums.hatPattern === 'string') editables.hatPattern.textContent = state.drums.hatPattern;
    if (editables.snarePattern && typeof state.drums.snarePattern === 'string') editables.snarePattern.textContent = state.drums.snarePattern;
    if (editables.hatGain && typeof state.drums.hatGain === 'string') editables.hatGain.textContent = state.drums.hatGain;
    if (editables.snareGain && typeof state.drums.snareGain === 'string') editables.snareGain.textContent = state.drums.snareGain;
  }

  if (state.sliders) {
    for (const [k, v] of Object.entries(state.sliders)) {
      if (sliders[k]) {
        sliders[k].el.value = String(v);
        sliders[k].val.textContent = String(v);
      }
    }
  }

  if (state.master) {
    if (masterVolumeEl && typeof state.master.volume === 'number') {
      masterVolumeEl.value = String(state.master.volume);
      if (masterVolumeValEl) masterVolumeValEl.textContent = masterVolumeEl.value;
    }
    if (masterReverbEl && typeof state.master.reverb === 'number') {
      masterReverbEl.value = String(state.master.reverb);
      if (masterReverbValEl) masterReverbValEl.textContent = masterReverbEl.value;
    }
  }

  if (setPreset && presetSelect && typeof state.preset === 'string') {
    presetSelect.value = state.preset;
  }
}

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  applyStateToDom({
    preset: name,
    bpm: p.bpm,
    acid: { pattern: p.acidPattern, scale: p.acidScale, trans: p.acidTrans, type: p.acidType },
    bass: { pattern: p.bassPattern, scale: p.bassScale, trans: p.bassTrans, type: p.bassType },
    drums: p.drums,
    sliders: p.sliders,
    master: { volume: p.master.volume, reverb: p.master.reverb }
  }, { setPreset: true });

  if (audioInitialized) {
    applyMasterVolume();
    applyMasterReverb();
    updateParams();
    if (Tone.Transport.state === 'started') {
      schedulePatterns();
    }
  }

  setStatus(`Preset: ${name}`);
  scheduleSaveState();
}

let saveTimer = null;
function scheduleSaveState() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const state = readStateFromDom();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }, 200);
}

function loadStateFromStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  return safeJsonParse(raw);
}

// Persist changes from core inputs
['change', 'input'].forEach(evt => {
  bpmInput?.addEventListener(evt, scheduleSaveState);
});

document.querySelectorAll('.editable').forEach(el => {
  el.addEventListener('input', scheduleSaveState);
  el.addEventListener('blur', scheduleSaveState);
});

Object.values(sliders).forEach(s => {
  s.el.addEventListener('input', scheduleSaveState);
});

presetSelect?.addEventListener('change', () => {
  const v = presetSelect.value;
  if (v === 'custom') {
    scheduleSaveState();
    setStatus('Preset: custom');
    return;
  }
  applyPreset(v);
});

saveBtn?.addEventListener('click', () => {
  const state = readStateFromDom();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'livecodemusic-settings.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus('Exported settings');
});

loadBtn?.addEventListener('click', () => {
  loadFileInput?.click();
});

loadFileInput?.addEventListener('change', async () => {
  const file = loadFileInput.files?.[0];
  if (!file) return;
  const text = await file.text();
  const parsed = safeJsonParse(text);
  if (!parsed) {
    setStatus('Invalid JSON file', { isError: true });
    return;
  }
  applyStateToDom(parsed, { setPreset: true });
  presetSelect.value = 'custom';
  if (audioInitialized) {
    applyMasterVolume();
    applyMasterReverb();
    updateParams();
    if (Tone.Transport.state === 'started') schedulePatterns();
  }
  scheduleSaveState();
  setStatus('Imported settings');
  loadFileInput.value = '';
});

// On boot: restore state
const saved = loadStateFromStorage();
if (saved) {
  applyStateToDom(saved, { setPreset: true });
  if (presetSelect) presetSelect.value = 'custom';
  setStatus('Restored last session', { timeoutMs: 1500 });
}

// Keep preset in sync when user edits
function markCustomPreset() {
  if (presetSelect && presetSelect.value !== 'custom') {
    presetSelect.value = 'custom';
  }
}

document.querySelectorAll('.editable').forEach(el => {
  el.addEventListener('input', markCustomPreset);
});

Object.values(sliders).forEach(s => {
  s.el.addEventListener('input', markCustomPreset);
});

masterVolumeEl?.addEventListener('input', markCustomPreset);
masterReverbEl?.addEventListener('input', markCustomPreset);
bpmInput?.addEventListener('change', markCustomPreset);


// --- INTELLISENSE / AUTOCOMPLETE ---
const suggestionBox = document.createElement('div');
suggestionBox.className = 'suggestion-box';
document.body.appendChild(suggestionBox);

let activeSuggestionTarget = null;

// Knowledge Base
const SUGGESTIONS = {
  // Scales
  'acid-scale': Object.keys(SCALES).map(s => ({ val: s, hint: 'Scale' })),
  'bass-scale': Object.keys(SCALES).map(s => ({ val: s, hint: 'Scale' })),
  
  // Transpose
  'acid-trans': [
    { val: '-24', hint: '-2 Oct' }, { val: '-12', hint: '-1 Oct' }, 
    { val: '0', hint: 'Unison' }, { val: '12', hint: '+1 Oct' }
  ],
  'bass-trans': [
    { val: '-36', hint: '-3 Oct' }, { val: '-24', hint: '-2 Oct' }, 
    { val: '-12', hint: '-1 Oct' }
  ],

  // Synths
  'acid-synth-type': [
    { val: 'sawtooth', hint: 'Sharp' }, { val: 'square', hint: 'Retro' }, 
    { val: 'triangle', hint: 'Soft' }, { val: 'sine', hint: 'Pure' }
  ],
  'bass-synth-type': [
    { val: 'sawtooth', hint: 'Sharp' }, { val: 'square', hint: 'Retro' }, 
    { val: 'fmsine', hint: 'Deep' }, { val: 'triangle', hint: 'Soft' }
  ],

  // Snippets/Patterns
  'kick-pattern': [
    { val: 'x---x---x---x---', hint: '4-on-floor' },
    { val: 'x-x-------x-----', hint: 'Techno Break' },
    { val: 'x...x...x...x...', hint: 'Minimal' }
  ],
  'hat-pattern': [
    { val: 'x-x-x-x-x-x-x-x-', hint: '16ths' },
    { val: '--x---x---x---x-', hint: 'Offbeat' },
    { val: 'x...x...x...x...', hint: 'Eights' }
  ],
  'acid-pattern': [
    { val: '0 2 4 7 9 7 4 2', hint: 'Arpeggio UpDown' },
    { val: '0 0 12 0 0 0 12 0', hint: 'Octave Jumps' },
    { val: '0 3 7 10 12 10 7 3', hint: 'Minor 7th' }
  ]
};

function showSuggestions(target) {
  const id = target.id;
  const list = SUGGESTIONS[id];
  if (!list) return;

  activeSuggestionTarget = target;
  suggestionBox.innerHTML = '';
  
  list.forEach(item => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    div.innerHTML = `<span>${item.val}</span><span class="hint">${item.hint}</span>`;
    div.addEventListener('mousedown', (e) => { // mousedown happens before blur
      e.preventDefault(); // prevent blur
      target.textContent = item.val;
      hideSuggestions();
      updateParams(); // Trigger audio update immediately
      markCustomPreset();
    });
    suggestionBox.appendChild(div);
  });

  // Position box
  const rect = target.getBoundingClientRect();
  suggestionBox.style.left = `${rect.left}px`;
  suggestionBox.style.top = `${rect.bottom + window.scrollY + 4}px`; // slightly below
  suggestionBox.classList.add('visible');
}

function hideSuggestions() {
  suggestionBox.classList.remove('visible');
  activeSuggestionTarget = null;
}

// Attach to all editables
document.querySelectorAll('.editable').forEach(el => {
  // Show on focus/click
  el.addEventListener('focus', () => showSuggestions(el));
  el.addEventListener('click', () => showSuggestions(el));
  
  // Hide on verify blur (delayed to allow click processing)
  el.addEventListener('blur', () => {
    setTimeout(() => hideSuggestions(), 150);
  });

  // Allow navigation? (Simple version: just filter by typing not implemented for simplicity, 
  // keeping it as a "Preset Picker" behavior for now)
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      el.blur();
      hideSuggestions();
    }
  });
});


// Cleanup
window.addEventListener('beforeunload', () => {
  try {
    acidSynth?.dispose();
    bassSynth?.dispose();
    kickSynth?.dispose();
    hatSynth?.dispose();
    snareSynth?.dispose();
    acidFilter?.dispose();
    bassFilter?.dispose();
    kickFilter?.dispose();
    acidDelay?.dispose();
    kickDist?.dispose();
    kickGain?.dispose();
    bassGain?.dispose();
    acidGainNode?.dispose();
    hatGain?.dispose();
    snareGain?.dispose();
    masterReverb?.dispose();
    masterCompressor?.dispose();
    masterGain?.dispose();
  } catch {
    // ignore
  }
});
