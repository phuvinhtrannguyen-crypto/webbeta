// Cu Bung Poker — audio engine.
//
// All sound effects are synthesized on-the-fly via Web Audio API so we don't
// need to ship any audio assets. Background music is a synthesized lo-fi
// chord loop. Voice prompts ("Tăng cược", "All in", "Fold") use the browser's
// Web Speech API (speechSynthesis) so we don't need a TTS API key.
//
// Volume model (multiplicative):
//   final = master * categoryGain
// Categories: music, sfx, tts.
// Voice (WebRTC) audio is handled separately via per-peer <audio>.volume —
// the mixer reads/writes those values directly. See `useVoiceChat`.

const STORAGE_KEY = 'cu-bung-audio-mixer:v1';
const DEFAULT_VOLUMES = {
  master: 0.9,
  music: 0.35,
  sfx: 0.8,
  tts: 0.9,
};

let ctx = null;
let masterGain = null;
let musicGain = null;
let sfxGain = null;
// Music graph nodes so we can stop/reuse.
let musicSources = [];
let musicLoopHandle = null;
let listenersUserGestureUnlock = [];
const subscribers = new Set();

let volumes = { ...DEFAULT_VOLUMES };
let muted = { music: false, sfx: false, tts: false, master: false };
// Per-peer voice volume (peerId -> 0..1 multiplier on element.volume).
let peerVolumes = {};
// Registered <audio> elements for remote voice peers.
const peerEls = new Map();

try {
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (raw && typeof raw === 'object') {
    if (raw.volumes) volumes = { ...DEFAULT_VOLUMES, ...raw.volumes };
    if (raw.muted) muted = { ...muted, ...raw.muted };
    if (raw.peerVolumes) peerVolumes = { ...raw.peerVolumes };
  }
} catch {}

function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ volumes, muted, peerVolumes }),
    );
  } catch {}
}

function notify() {
  for (const cb of subscribers) {
    try {
      cb(getMixerState());
    } catch {}
  }
}

export function subscribe(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function getMixerState() {
  return {
    volumes: { ...volumes },
    muted: { ...muted },
    peerVolumes: { ...peerVolumes },
  };
}

function applyMixer() {
  if (!ctx) return;
  const m = muted.master ? 0 : volumes.master;
  masterGain.gain.setTargetAtTime(m, ctx.currentTime, 0.05);
  if (musicGain)
    musicGain.gain.setTargetAtTime(
      muted.music ? 0 : volumes.music,
      ctx.currentTime,
      0.05,
    );
  if (sfxGain)
    sfxGain.gain.setTargetAtTime(
      muted.sfx ? 0 : volumes.sfx,
      ctx.currentTime,
      0.05,
    );
  // Voice (peer) elements are HTMLAudioElement.volume — apply directly.
  for (const [id, el] of peerEls) {
    if (!el) continue;
    const peer = peerVolumes[id] ?? 1;
    const finalV = (muted.master ? 0 : volumes.master) * peer;
    el.volume = Math.max(0, Math.min(1, finalV));
    el.muted = muted.master;
  }
}

export function setVolume(category, value) {
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  volumes[category] = v;
  persist();
  applyMixer();
  notify();
}

export function setMuted(category, val) {
  muted[category] = !!val;
  persist();
  applyMixer();
  notify();
}

export function setPeerVolume(peerId, value) {
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  peerVolumes[peerId] = v;
  persist();
  applyMixer();
  notify();
}

export function getPeerVolume(peerId) {
  return peerVolumes[peerId] ?? 1;
}

export function registerPeerAudioEl(peerId, el) {
  peerEls.set(peerId, el);
  applyMixer();
}

export function unregisterPeerAudioEl(peerId) {
  peerEls.delete(peerId);
}

// Lazy-init audio context after the first user gesture (browser policy).
export function ensureContext() {
  if (ctx && ctx.state === 'running') return ctx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx) {
    ctx = new AudioCtx();
    masterGain = ctx.createGain();
    masterGain.gain.value = volumes.master;
    masterGain.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = muted.music ? 0 : volumes.music;
    musicGain.connect(masterGain);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = muted.sfx ? 0 : volumes.sfx;
    sfxGain.connect(masterGain);
  }
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  applyMixer();
  return ctx;
}

// Wire up first-gesture unlock so SFX work after a click/tap.
export function attachUnlock() {
  const handler = () => {
    ensureContext();
    listenersUserGestureUnlock.forEach(({ ev, fn }) =>
      window.removeEventListener(ev, fn, true),
    );
    listenersUserGestureUnlock = [];
  };
  ['click', 'touchstart', 'keydown'].forEach((ev) => {
    const fn = () => handler();
    listenersUserGestureUnlock.push({ ev, fn });
    window.addEventListener(ev, fn, { once: true, capture: true });
  });
}

// ---------- SFX synthesis ----------

function envelope(node, t0, attack, hold, release, peakGain) {
  const g = node.gain;
  g.cancelScheduledValues(t0);
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(peakGain, t0 + attack);
  g.setValueAtTime(peakGain, t0 + attack + hold);
  g.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
}

function whiteNoiseBuffer(duration = 1) {
  const c = ensureContext();
  if (!c) return null;
  const buf = c.createBuffer(1, c.sampleRate * duration, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buf;
}

// Shuffle: filtered burst of white noise (rasping sound).
export function playShuffle() {
  const c = ensureContext();
  if (!c) return;
  const buf = whiteNoiseBuffer(1.3);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(2200, c.currentTime);
  filter.frequency.exponentialRampToValueAtTime(1100, c.currentTime + 1.3);
  filter.Q.value = 0.8;
  const g = c.createGain();
  envelope(g, c.currentTime, 0.04, 1.05, 0.2, 0.6);
  src.connect(filter).connect(g).connect(sfxGain);
  src.start();
  src.stop(c.currentTime + 1.4);
}

// Card slam: short low boom + high noise click for the 5th community card.
export function playSlam() {
  const c = ensureContext();
  if (!c) return;
  const t0 = c.currentTime;
  // Boom
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, t0);
  osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.5);
  const g1 = c.createGain();
  envelope(g1, t0, 0.005, 0.05, 0.5, 0.95);
  osc.connect(g1).connect(sfxGain);
  osc.start(t0);
  osc.stop(t0 + 0.6);
  // Click
  const buf = whiteNoiseBuffer(0.18);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 4000;
  const g2 = c.createGain();
  envelope(g2, t0, 0.001, 0.02, 0.12, 0.55);
  src.connect(filter).connect(g2).connect(sfxGain);
  src.start(t0);
  src.stop(t0 + 0.2);
}

// Card flip: short higher click + tiny pluck. Used for hole/community card draws.
export function playCardFlip() {
  const c = ensureContext();
  if (!c) return;
  const t0 = c.currentTime;
  const buf = whiteNoiseBuffer(0.08);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 3500;
  const g = c.createGain();
  envelope(g, t0, 0.001, 0.01, 0.07, 0.35);
  src.connect(filter).connect(g).connect(sfxGain);
  src.start(t0);
  src.stop(t0 + 0.1);
}

// All-in fanfare: rising arpeggio + low rumble.
export function playAllIn() {
  const c = ensureContext();
  if (!c) return;
  const t0 = c.currentTime;
  const notes = [392, 523.25, 659.25, 783.99]; // G4 C5 E5 G5
  notes.forEach((freq, i) => {
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = c.createGain();
    envelope(g, t0 + i * 0.09, 0.005, 0.07, 0.18, 0.5);
    o.connect(g).connect(sfxGain);
    o.start(t0 + i * 0.09);
    o.stop(t0 + i * 0.09 + 0.4);
  });
  // Rumble
  const rb = whiteNoiseBuffer(1);
  const rs = c.createBufferSource();
  rs.buffer = rb;
  const rf = c.createBiquadFilter();
  rf.type = 'lowpass';
  rf.frequency.value = 180;
  const rg = c.createGain();
  envelope(rg, t0, 0.05, 0.6, 0.4, 0.45);
  rs.connect(rf).connect(rg).connect(sfxGain);
  rs.start(t0);
  rs.stop(t0 + 1.1);
}

// Raise stinger: short bright tone before TTS speaks.
export function playRaiseStinger() {
  const c = ensureContext();
  if (!c) return;
  const t0 = c.currentTime;
  const notes = [659.25, 880];
  notes.forEach((freq, i) => {
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = c.createGain();
    envelope(g, t0 + i * 0.07, 0.005, 0.04, 0.1, 0.3);
    o.connect(g).connect(sfxGain);
    o.start(t0 + i * 0.07);
    o.stop(t0 + i * 0.07 + 0.2);
  });
}

// Generic chip plink for bet/call/check.
export function playChip() {
  const c = ensureContext();
  if (!c) return;
  const t0 = c.currentTime;
  const o = c.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(880, t0);
  o.frequency.exponentialRampToValueAtTime(1320, t0 + 0.06);
  const g = c.createGain();
  envelope(g, t0, 0.002, 0.03, 0.12, 0.3);
  o.connect(g).connect(sfxGain);
  o.start(t0);
  o.stop(t0 + 0.2);
}

// Win fanfare.
export function playWin() {
  const c = ensureContext();
  if (!c) return;
  const t0 = c.currentTime;
  const seq = [523.25, 659.25, 783.99, 1046.5];
  seq.forEach((f, i) => {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = c.createGain();
    envelope(g, t0 + i * 0.12, 0.01, 0.1, 0.25, 0.45);
    o.connect(g).connect(sfxGain);
    o.start(t0 + i * 0.12);
    o.stop(t0 + i * 0.12 + 0.5);
  });
}

// ---------- Background music ----------
//
// A 4-bar lo-fi chord loop — Am7 / Fmaj7 / Cmaj7 / G7. Synthesized with
// triangle pads + a soft sine bass + a brushed-noise hat.
const CHORD_PROGRESSION = [
  // [bass freq, [chord freqs]]
  [110.0, [220.0, 261.63, 329.63, 392.0]], // Am7-ish
  [87.31, [174.61, 220.0, 261.63, 329.63]], // Fmaj7
  [65.41, [196.0, 246.94, 329.63]], // Cmaj7-ish
  [98.0, [196.0, 246.94, 293.66, 392.0]], // G7
];

export function startMusic() {
  const c = ensureContext();
  if (!c) return;
  if (musicLoopHandle) return; // already playing
  const BAR_SEC = 2.4; // each chord lasts ~2.4s
  let idx = 0;
  function scheduleBar(when) {
    const [bass, chord] = CHORD_PROGRESSION[idx % CHORD_PROGRESSION.length];
    // Bass
    const bo = c.createOscillator();
    bo.type = 'sine';
    bo.frequency.value = bass;
    const bg = c.createGain();
    envelope(bg, when, 0.05, BAR_SEC - 0.4, 0.3, 0.35);
    bo.connect(bg).connect(musicGain);
    bo.start(when);
    bo.stop(when + BAR_SEC + 0.2);
    musicSources.push(bo);
    // Pad
    chord.forEach((f) => {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const og = c.createGain();
      envelope(og, when, 0.4, BAR_SEC - 0.7, 0.4, 0.12);
      o.connect(og).connect(musicGain);
      o.start(when);
      o.stop(when + BAR_SEC + 0.2);
      musicSources.push(o);
    });
    // Soft hat
    const buf = whiteNoiseBuffer(0.05);
    [0.5, 1.5].forEach((b) => {
      const s = c.createBufferSource();
      s.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 6000;
      const g = c.createGain();
      envelope(g, when + b, 0.001, 0.01, 0.04, 0.15);
      s.connect(f).connect(g).connect(musicGain);
      s.start(when + b);
      s.stop(when + b + 0.06);
      musicSources.push(s);
    });
    idx += 1;
  }
  let next = c.currentTime + 0.05;
  // Schedule the first 2 bars immediately, then keep scheduling ahead.
  scheduleBar(next);
  scheduleBar(next + BAR_SEC);
  next += BAR_SEC * 2;
  musicLoopHandle = setInterval(() => {
    if (!musicGain) return;
    while (next < c.currentTime + 1.5) {
      scheduleBar(next);
      next += BAR_SEC;
    }
    // GC old sources.
    musicSources = musicSources.filter((s) => {
      try {
        return s.context && (s.context.currentTime || 0) - 1 < (s.endTime || Infinity);
      } catch {
        return false;
      }
    });
  }, 600);
}

export function stopMusic() {
  if (musicLoopHandle) {
    clearInterval(musicLoopHandle);
    musicLoopHandle = null;
  }
  for (const s of musicSources) {
    try {
      s.stop();
    } catch {}
  }
  musicSources = [];
}

export function isMusicPlaying() {
  return !!musicLoopHandle;
}

// ---------- TTS ----------
let ttsVoice = null;
function pickVoice() {
  if (typeof speechSynthesis === 'undefined') return null;
  if (ttsVoice) return ttsVoice;
  const voices = speechSynthesis.getVoices() || [];
  // Prefer a Vietnamese voice.
  ttsVoice =
    voices.find((v) => /vi[-_]/i.test(v.lang)) ||
    voices.find((v) => /vi/i.test(v.lang)) ||
    voices.find((v) => /Google/i.test(v.name)) ||
    voices[0] ||
    null;
  return ttsVoice;
}
if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.onvoiceschanged = () => {
    ttsVoice = null;
    pickVoice();
  };
}

export function speak(text, opts = {}) {
  if (typeof speechSynthesis === 'undefined') return;
  if (muted.master || muted.tts || volumes.tts <= 0) return;
  try {
    // Cancel any in-flight utterance so announcements don't pile up.
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = (v && v.lang) || 'vi-VN';
    u.volume = Math.max(0, Math.min(1, (volumes.master || 1) * (volumes.tts || 1)));
    u.rate = opts.rate ?? 1.05;
    u.pitch = opts.pitch ?? 1.1;
    speechSynthesis.speak(u);
  } catch {}
}

// Convenient announcement helpers.
export function announceRaise(amount) {
  playRaiseStinger();
  speak(`Tăng cược ${formatChips(amount)} búng`);
}
export function announceAllIn(name) {
  playAllIn();
  if (name) speak(`${name} đã tất tay`);
  else speak('Tất tay');
}
export function announceFold(name) {
  if (name) speak(`${name} bỏ bài`);
}
export function announceCheck(name) {
  if (name) speak(`${name} tố thử`, { pitch: 1.0 });
}
export function announceCall(amount) {
  speak(`Theo cược ${formatChips(amount)} búng`);
}
export function announceWinner(name, amount) {
  playWin();
  if (name) speak(`${name} thắng ${formatChips(amount)} búng`);
}

function formatChips(n) {
  if (n == null || Number.isNaN(Number(n))) return '';
  const v = Number(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} triệu`;
  if (v >= 1000) return `${(v / 1000).toFixed(0)} ngàn`;
  return String(v);
}
