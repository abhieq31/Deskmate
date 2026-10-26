// Post-game analysis maths: win chances, move classification and accuracy.
// Formulas follow lichess (https://lichess.org/page/accuracy), so numbers feel familiar.

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Winning chances for White, 0–100, from an engine score { cp } or { mate } (White's side). */
export function winPct(ev) {
  if (!ev) return 50;
  if (ev.mate != null) return ev.mate > 0 || Object.is(ev.mate, 0) && ev.winner === 'w' ? 100 : ev.mate < 0 || ev.winner === 'b' ? 0 : 50;
  const cp = clamp(ev.cp, -1000, 1000);
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Win% the mover lost with a move; marks: ?? ≥15 points, ? ≥10, ?! ≥5 (lichess thresholds). */
export function classify(before, after, color) {
  const b = color === 'w' ? winPct(before) : 100 - winPct(before);
  const a = color === 'w' ? winPct(after) : 100 - winPct(after);
  const loss = Math.max(0, b - a);
  const kind = loss >= 15 ? 'blunder' : loss >= 10 ? 'mistake' : loss >= 5 ? 'inaccuracy' : null;
  return { loss, kind };
}

export const MARKS = { blunder: '??', mistake: '?', inaccuracy: '?!' };

/** Accuracy of a single move from the win% it lost. */
export const moveAccuracy = (loss) => clamp(103.1668 * Math.exp(-0.04354 * loss) - 3.1669, 0, 100);

/**
 * Summarise an analysed game. evals[i] is the evaluation after ply i (evals[0] = start).
 * Returns per-ply classifications and, per colour, accuracy and counts. `played[i]` (optional) is
 * ply i+1 in UCI: a move the engine itself chose before it is never marked (two searches of a
 * slightly different depth can otherwise disagree with each other), as on lichess.
 */
export function summarize(evals, plyCount, played: string[] = []) {
  const moves = [];
  const side = { w: { losses: [], blunder: 0, mistake: 0, inaccuracy: 0 }, b: { losses: [], blunder: 0, mistake: 0, inaccuracy: 0 } };
  for (let i = 1; i <= plyCount; i++) {
    if (!evals[i - 1] || !evals[i]) { moves.push(null); continue; }
    const color = i % 2 === 1 ? 'w' : 'b';
    const c = classify(evals[i - 1], evals[i], color);
    if (played[i - 1] && evals[i - 1].pv?.[0] === played[i - 1]) { c.kind = null; c.loss = Math.min(c.loss, 2); }
    moves.push(c);
    side[color].losses.push(c.loss);
    if (c.kind) side[color][c.kind]++;
  }
  const acc = (losses) => (losses.length ? losses.reduce((s, l) => s + moveAccuracy(l), 0) / losses.length : null);
  return {
    moves,
    w: { ...side.w, accuracy: acc(side.w.losses) },
    b: { ...side.b, accuracy: acc(side.b.losses) },
  };
}

/** "+1.3", "-0.4", "M3", "-M2", "1-0"… for display. */
export function formatEval(ev) {
  if (!ev) return '…';
  if (ev.mate != null) {
    if (ev.mate === 0) return ev.winner === 'w' ? '1-0' : ev.winner === 'b' ? '0-1' : '½-½';
    return `${ev.mate < 0 ? '-' : ''}M${Math.abs(ev.mate)}`;
  }
  const v = ev.cp / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(Math.abs(v) >= 10 ? 0 : 1)}`;
}
