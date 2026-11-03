import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rate, resultOf, expected, playerKey, START_RATING, type RatedResult } from '../src/rating.ts';

const g = (id: string, at: number, white: string, black: string, result: RatedResult['result'], extra = {}): RatedResult => ({ id, at, white, black, result, ...extra });

test('even players: the winner gains what the loser drops, 20 points while new', () => {
  const { players, changes } = rate([g('1', 1, 'Asha', 'Ben', '1-0')]);
  assert.equal(players.get('asha').rating, START_RATING + 20);
  assert.equal(players.get('ben').rating, START_RATING - 20);
  assert.deepEqual(changes.get('1').w, { name: 'Asha', before: 800, after: 820 });
  assert.equal(expected(1200, 800).toFixed(2), '0.91');
});

test('beating a stronger computer is worth more; it is never listed as a player', () => {
  const beatNewcomer = rate([resultOf({ id: 'a', white: 'Abhi', black: 'Stockfish · Newcomer', result: '1-0', endedAt: 1, ai: { color: 'b', level: 'newcomer' } })]);
  const beatClub = rate([resultOf({ id: 'a', white: 'Abhi', black: 'Stockfish · Club', result: '1-0', endedAt: 1, ai: { color: 'b', level: 'club' } })]);
  assert.ok(beatClub.players.get('abhi').rating - START_RATING > beatNewcomer.players.get('abhi').rating - START_RATING);
  assert.equal(beatClub.players.size, 1);
  assert.equal(beatNewcomer.players.get('abhi').rating, 802, 'a 550-point favourite gains almost nothing');
});

test('a colleague’s rating from their laptop is used as is, and only remembered', () => {
  const r = resultOf({ id: 'live', white: 'Asha', black: 'Ben', result: '0-1', endedAt: 5, remote: { room: 'X', me: 'b', or: 1200 } });
  const { players } = rate([r]);
  assert.equal(players.get('asha').rating, 1200);
  assert.equal(players.get('asha').games, 0);
  assert.equal(players.get('ben').rating, 800 + Math.round(40 * (1 - expected(800, 1200))));
});

test('names match regardless of case and spacing; placeholders and unfinished games are not rated', () => {
  const { players } = rate([g('1', 1, 'Asha ', 'ben', '1-0'), g('2', 2, ' asha', 'Ben', '1/2-1/2'), g('3', 3, 'Asha', 'White', '1-0')]);
  assert.deepEqual([...players.keys()].sort(), ['asha', 'ben']);
  assert.equal(players.get('asha').games, 2);
  assert.equal(playerKey('Black'), null);
  assert.equal(resultOf({ id: 'x', white: 'A', black: 'B', result: null }), null);
});

test('order is by time, so replaying the log always gives the same numbers; settled players move slower', () => {
  const log = Array.from({ length: 30 }, (_, i) => g(String(i), i, 'Asha', 'Ben', i % 3 ? '1-0' : '0-1'));
  const a = rate(log), b = rate([...log].reverse());
  assert.equal(a.players.get('asha').rating, b.players.get('asha').rating);
  const last = a.changes.get('29').w;
  assert.ok(Math.abs(last.after - last.before) <= 20, 'K = 20 after 20 games');
});
