// Player ratings: Elo, worked out from the results saved on this laptop. Pure logic, no DOM —
// covered by tests/rating.test.ts.
//
// Ratings are never stored, only results are (storage.ts, "deskmate:results"), and the ratings
// are replayed from them in order. So a takeback that changes a result, a deleted saved game or
// a reload can't leave a rating counted twice or out of step with the games behind it.
import type { Color, GameData } from './game.ts';
import { level } from './levels.ts';

/** Everyone starts here: about where someone who knows the rules plays. */
export const START_RATING = 800;

// placeholder names that say nothing about who played (as in the office table)
const ANON = new Set(['', '?', 'white', 'black', 'opponent', 'player 1', 'player 2']);

/** The key a name is rated under: case and spacing don't matter. Null for a placeholder name. */
export function playerKey(name: string | null | undefined): string | null {
  const key = String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  return ANON.has(key) ? null : key;
}

/** One finished game, as far as ratings care. */
export interface RatedResult {
  id: string;
  at: number;
  white: string;
  black: string;
  result: '1-0' | '0-1' | '1/2-1/2';
  /** a side whose rating comes from elsewhere and isn't changed here: the computer's level, or a colleague's rating from their own laptop */
  fixed?: { w?: number; b?: number };
  /** the side the computer played: never listed as a player */
  bot?: Color;
}

export interface Rating { name: string; rating: number; games: number }
/** A side's rating before and after one game. */
export type Change = { name: string; before: number; after: number };

/** Chance of scoring for a player rated `a` against one rated `b`. */
export const expected = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400));

// a new player's rating moves fast, a settled one slowly (FIDE-style)
const K = (games: number) => (games < 20 ? 40 : 20);

/** The result entry for a finished game, or null if it isn't one. */
export function resultOf(g: GameData): RatedResult | null {
  if (!g.id || !['1-0', '0-1', '1/2-1/2'].includes(g.result)) return null;
  const fixed: RatedResult['fixed'] = {};
  let bot: Color | undefined;
  if (g.ai) { bot = g.ai.color; fixed[bot] = level(g.ai.level).rating; }
  const r = g.remote as { me?: Color | null; or?: number | null } | null;
  if (r?.me && r.or) fixed[r.me === 'w' ? 'b' : 'w'] = r.or;
  return {
    id: g.id, at: g.endedAt || g.startedAt || 0, white: g.white || '', black: g.black || '',
    result: g.result as RatedResult['result'], ...(Object.keys(fixed).length ? { fixed } : {}), ...(bot ? { bot } : {}),
  };
}

/** Replays the results in order: everyone's rating now, and what each game changed. */
export function rate(results: RatedResult[]) {
  const players = new Map<string, Rating>();
  const changes = new Map<string, Partial<Record<Color, Change>>>();
  const ordered = [...results].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  for (const g of ordered) {
    const side = (c: Color) => {
      const name = c === 'w' ? g.white : g.black;
      const key = c === g.bot ? null : playerKey(name);
      const fixed = g.fixed?.[c];
      if (key && !players.has(key)) players.set(key, { name: name.trim().replace(/\s+/g, ' '), rating: START_RATING, games: 0 });
      return { key, fixed, rating: fixed ?? (key ? players.get(key).rating : null) };
    };
    const w = side('w'), b = side('b');
    if (w.rating == null || b.rating == null) continue; // a placeholder opponent: nothing to rate against
    const score = g.result === '1-0' ? 1 : g.result === '0-1' ? 0 : 0.5;
    const out: Partial<Record<Color, Change>> = {};
    for (const [c, me, them, s] of [['w', w, b, score], ['b', b, w, 1 - score]] as const) {
      if (!me.key) continue;
      const p = players.get(me.key);
      if (me.fixed != null) { p.rating = me.fixed; continue; } // a colleague's own number: just remember it
      const after = Math.max(100, Math.round(me.rating + K(p.games) * (s - expected(me.rating, them.rating))));
      out[c] = { name: p.name, before: me.rating, after };
    }
    for (const c of ['w', 'b'] as const) {
      const ch = out[c];
      if (!ch) continue;
      const p = players.get((c === 'w' ? w : b).key);
      p.rating = ch.after;
      p.games++;
    }
    changes.set(g.id, out);
  }
  return { players, changes };
}
