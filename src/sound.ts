// The only sound: a water drop when a piece is captured. Synthesized with Web Audio,
// so there is no audio file to download or license. Ordinary moves are silent.
let ctx = null;
let enabled = true;

const audio = () => {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};

/** A drop: a sine "bloop" whose pitch rises quickly as it fades, plus a softer echo. */
function drop(when, from, to, gain, dur) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + when;
  const o = a.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.6);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sound = {
  setEnabled(v) { enabled = v; },
  capture() {
    if (!enabled) return;
    drop(0, 420, 1250, 0.32, 0.16);
    drop(0.07, 650, 1500, 0.09, 0.12);
  },
};
