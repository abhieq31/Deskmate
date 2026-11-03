// How the computer plays at each level. Pure logic, no DOM or engine — covered by tests/levels.test.ts.
//
// A person doesn't play "the best move, sometimes a random one". They look a few moves ahead,
// weigh a handful of candidates, and pick one that looks good to them; the weaker the player,
// the shallower the look and the less the difference between a good and a bad move registers.
// So each level searches to a fixed depth with several candidate lines (MultiPV), then picks
// among them with a softmax over how much worse each one is than the best: P ∝ exp(−loss / T).
// Small T: almost always the best move it saw. Large T: near-misses and the odd hanging piece.
// Immortal skips all of that and plays Stockfish's own best move at full strength.

export type LevelId = 'beginner' | 'casual' | 'club' | 'expert' | 'master' | 'grandmaster' | 'immortal';

export interface Level {
  id: LevelId;
  label: string;
  /** search depth for the candidate moves */
  depth: number;
  /** how many candidate moves it weighs */
  multipv: number;
  /** softmax temperature in centipawns; 0 = always the best candidate */
  temperature: number;
  /** cap on the search, ms */
  movetime: number;
}

// Measured by self-play in the browser build (see README, "How strong is the computer?").
export const LEVELS: Level[] = [
  { id: 'beginner', label: 'Beginner', depth: 2, multipv: 40, temperature: 80, movetime: 300 },
  { id: 'casual', label: 'Casual', depth: 4, multipv: 24, temperature: 30, movetime: 400 },
  { id: 'club', label: 'Club', depth: 6, multipv: 12, temperature: 20, movetime: 500 },
  { id: 'expert', label: 'Expert', depth: 9, multipv: 8, temperature: 15, movetime: 700 },
  { id: 'master', label: 'Master', depth: 12, multipv: 5, temperature: 9, movetime: 1000 },
  { id: 'grandmaster', label: 'Grandmaster', depth: 15, multipv: 3, temperature: 4, movetime: 1500 },
  { id: 'immortal', label: 'Immortal', depth: 22, multipv: 1, temperature: 0, movetime: 2500 },
];

/** Earlier saves name the old three levels. */
const OLD: Record<string, LevelId> = { easy: 'casual', medium: 'club', hard: 'expert' };

export function level(id: string | undefined): Level {
  const key = OLD[id] || id;
  return LEVELS.find((l) => l.id === key) || LEVELS[2];
}

/** One move the engine weighed: UCI, and its score in centipawns from the mover's side. */
export interface Candidate { uci: string; score: number }

/** Mate in n for the mover → a score above any material count, shorter mates higher. */
export const mateScore = (n: number) => (n > 0 ? 100000 - n * 100 : -100000 - n * 100);

/** Picks a move among the candidates (best first or not). `rnd` returns [0, 1). */
export function pickMove(cands: Candidate[], lv: Level, rnd: () => number = Math.random): string | null {
  if (!cands.length) return null;
  const best = Math.max(...cands.map((c) => c.score));
  if (lv.temperature <= 0) return cands.find((c) => c.score === best).uci;
  // a forced mate stays forced: no level walks past a mate it has already seen
  if (best >= 50000) return cands.find((c) => c.score === best).uci;
  const w = cands.map((c) => Math.exp(-Math.min(best - c.score, 3000) / lv.temperature));
  let r = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < cands.length; i++) { r -= w[i]; if (r <= 0) return cands[i].uci; }
  return cands[cands.length - 1].uci;
}

/**
 * How long to "think" before the move appears, in ms. A person plays an obvious move (the only
 * legal one, a recapture everyone sees) quickly and stops to think when several moves are
 * close; on a clock they never spend more than a small slice of what they have left.
 */
export function thinkTime(cands: Candidate[], lv: Level, clockMs: number | null, rnd: () => number = Math.random): number {
  if (lv.id === 'immortal') return 300;
  const sorted = cands.map((c) => c.score).sort((a, b) => b - a);
  const close = sorted.filter((s) => sorted[0] - s <= 40).length; // moves within 0.4 pawns of the best
  const obvious = sorted.length === 1 || sorted[0] - (sorted[1] ?? -Infinity) >= 200;
  const base = obvious ? 600 : 900 + 450 * Math.min(close, 4);
  let ms = base * (0.6 + 0.8 * rnd());
  if (clockMs != null) ms = Math.min(ms, clockMs / 30);
  return Math.max(250, Math.round(ms));
}
