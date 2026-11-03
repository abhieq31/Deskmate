// How the computer plays at each level. Pure logic, no DOM or engine — covered by tests/levels.test.ts.
//
// A person doesn't play "the best move, sometimes a random one". They look a few moves ahead,
// weigh a handful of candidates, and pick one that looks good to them; the weaker the player,
// the shallower the look and the less the difference between a good and a bad move registers.
// So each level searches to a fixed depth with several candidate lines (MultiPV), then picks
// among them with a softmax over how much worse each one is than the best: P ∝ exp(−loss / T).
// Small T: almost always the best move it saw. Large T: near-misses and the odd hanging piece.
//
// The weakest levels also don't see the whole board: each move they notice only `sees` of the
// legal moves, at random, and pick among those. That is what a newcomer does — they miss the
// piece you left hanging as often as they miss their own — and an engine that weighs every
// move never does, which is why even a sloppy one is hard for a casual player to beat.
//
// Immortal skips all of that and plays Stockfish's own best move at full strength.

export type LevelId = 'newcomer' | 'beginner' | 'casual' | 'club' | 'expert' | 'master' | 'grandmaster' | 'immortal';

export interface Level {
  id: LevelId;
  label: string;
  /** rating the level plays at, on the same scale as the players' (see rating.ts and the README) */
  rating: number;
  /** search depth for the candidate moves */
  depth: number;
  /** how many candidate moves the engine scores */
  multipv: number;
  /** how many of them it notices each move, at random; 0 = all of them */
  sees: number;
  /** softmax temperature in centipawns; 0 = always the best candidate */
  temperature: number;
  /** cap on the search, ms */
  movetime: number;
}

// Measured by self-play in the browser build (see README, "How strong is the computer?").
export const LEVELS: Level[] = [
  { id: 'newcomer', label: 'Newcomer', rating: 250, depth: 1, multipv: 60, sees: 2, temperature: 30, movetime: 300 },
  { id: 'beginner', label: 'Beginner', rating: 500, depth: 2, multipv: 60, sees: 4, temperature: 30, movetime: 300 },
  { id: 'casual', label: 'Casual', rating: 800, depth: 2, multipv: 60, sees: 8, temperature: 40, movetime: 300 },
  { id: 'club', label: 'Club', rating: 1100, depth: 2, multipv: 40, sees: 0, temperature: 80, movetime: 300 },
  { id: 'expert', label: 'Expert', rating: 1400, depth: 4, multipv: 24, sees: 0, temperature: 30, movetime: 400 },
  { id: 'master', label: 'Master', rating: 1900, depth: 9, multipv: 8, sees: 0, temperature: 15, movetime: 700 },
  { id: 'grandmaster', label: 'Grandmaster', rating: 2300, depth: 12, multipv: 5, sees: 0, temperature: 9, movetime: 1000 },
  { id: 'immortal', label: 'Immortal', rating: 3000, depth: 22, multipv: 1, sees: 0, temperature: 0, movetime: 2500 },
];

/** Earlier saves name the old three levels. */
const OLD: Record<string, LevelId> = { easy: 'beginner', medium: 'casual', hard: 'club' };

export function level(id: string | undefined): Level {
  const key = OLD[id] || id;
  return LEVELS.find((l) => l.id === key) || LEVELS[2];
}

/** One move the engine weighed: UCI, and its score in centipawns from the mover's side. */
export interface Candidate { uci: string; score: number }

/** Mate in n for the mover → a score above any material count, shorter mates higher. */
export const mateScore = (n: number) => (n > 0 ? 100000 - n * 100 : -100000 - n * 100);

/** The `n` candidates a level notices this move, at random (all of them when n is 0 or more than there are). */
function noticed(cands: Candidate[], n: number, rnd: () => number): Candidate[] {
  if (!n || n >= cands.length) return cands;
  const pool = cands.slice();
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rnd() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/** Picks a move among the candidates (best first or not). `rnd` returns [0, 1). */
export function pickMove(cands: Candidate[], lv: Level, rnd: () => number = Math.random): string | null {
  if (!cands.length) return null;
  const seen = noticed(cands, lv.sees, rnd);
  const best = Math.max(...seen.map((c) => c.score));
  if (lv.temperature <= 0) return seen.find((c) => c.score === best).uci;
  // a forced mate stays forced: no level walks past a mate it has noticed
  if (best >= 50000) return seen.find((c) => c.score === best).uci;
  const w = seen.map((c) => Math.exp(-Math.min(best - c.score, 3000) / lv.temperature));
  let r = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < seen.length; i++) { r -= w[i]; if (r <= 0) return seen[i].uci; }
  return seen[seen.length - 1].uci;
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
