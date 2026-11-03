import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, level, pickMove, thinkTime, mateScore } from '../src/levels.ts';

// a repeatable "random" sequence
const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };
const cands = [{ uci: 'e2e4', score: 30 }, { uci: 'd2d4', score: 25 }, { uci: 'g1f3', score: -300 }];

test('levels run weakest to strongest and old saves map onto them', () => {
  assert.deepEqual(LEVELS.map((l) => l.id), ['beginner', 'casual', 'club', 'expert', 'master', 'grandmaster', 'immortal']);
  for (let i = 1; i < LEVELS.length; i++) {
    assert.ok(LEVELS[i].depth > LEVELS[i - 1].depth, 'deeper');
    assert.ok(LEVELS[i].temperature < LEVELS[i - 1].temperature, 'sharper');
  }
  assert.equal(level('easy').id, 'casual');
  assert.equal(level('medium').id, 'club');
  assert.equal(level('hard').id, 'expert');
  assert.equal(level('nonsense').id, 'club');
});

test('Immortal always plays the best move', () => {
  for (const r of [0, 0.5, 0.999]) assert.equal(pickMove(cands, level('immortal'), () => r), 'e2e4');
});

test('a human level mostly plays good moves but can pick a worse one', () => {
  const lv = level('beginner');
  const picks = new Map();
  for (let i = 0; i < 1000; i++) { const m = pickMove(cands, lv, () => i / 1000); picks.set(m, (picks.get(m) || 0) + 1); }
  assert.ok(picks.get('e2e4') > picks.get('g1f3'), 'the best move is likelier than a blunder');
  assert.ok(picks.get('g1f3') > 0, 'a beginner sometimes blunders');
  const gm = new Map();
  for (let i = 0; i < 1000; i++) { const m = pickMove(cands, level('grandmaster'), () => i / 1000); gm.set(m, (gm.get(m) || 0) + 1); }
  assert.equal(gm.get('g1f3') || 0, 0, 'a grandmaster never drops a piece like that');
});

test('no level walks past a mate it has seen', () => {
  const withMate = [{ uci: 'h5f7', score: mateScore(1) }, ...cands];
  assert.equal(pickMove(withMate, level('beginner'), () => 0.99), 'h5f7');
});

test('obvious moves are quick, close choices take longer, a clock caps it', () => {
  const one = thinkTime([{ uci: 'e1f1', score: 0 }], level('club'), null, seq(0.5));
  const close = thinkTime([{ uci: 'a', score: 10 }, { uci: 'b', score: 5 }, { uci: 'c', score: 0 }], level('club'), null, seq(0.5));
  assert.ok(one < close);
  assert.equal(thinkTime(cands, level('club'), 3000, seq(0.99)), 250, '3 s left: move almost at once');
  assert.equal(pickMove([], level('club')), null);
});
