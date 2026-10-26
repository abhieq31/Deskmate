// Tiny synthesized sound set (Web Audio) — no audio files to download or license.
let ctx = null;
let enabled = true;

const audio = () => {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};

/** Short filtered noise burst: sounds like wood on wood. */
function knock(freq, gain, dur = 0.09, when = 0) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + when;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 1.4;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(bp).connect(g).connect(a.destination);
  src.start(t);
}

function tone(freq, dur, when = 0, gain = 0.12, type = 'sine') {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + when;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sound = {
  setEnabled(v) { enabled = v; },
  move() { if (enabled) knock(1800, 1.2); },
  capture() { if (enabled) { knock(900, 1.6, 0.12); knock(2400, 0.6, 0.06, 0.03); } },
  check() { if (enabled) { knock(1800, 1.0); tone(880, 0.18, 0.02, 0.06, 'triangle'); } },
  end() { if (enabled) [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.6, i * 0.09, 0.08)); },
  lowTime() { if (enabled) tone(1320, 0.12, 0, 0.05, 'square'); },
};
