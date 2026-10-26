import { test } from 'node:test';
import assert from 'node:assert/strict';
import { winPct, classify, moveAccuracy, summarize, formatEval } from '../src/analysis.ts';

test('win chances follow the lichess curve', () => {
  assert.equal(Math.round(winPct({ cp: 0 })), 50);
  assert.ok(winPct({ cp: 300 }) > 75 && winPct({ cp: 300 }) < 76);
  assert.equal(winPct({ mate: 3 }), 100);
  assert.equal(winPct({ mate: -1 }), 0);
  assert.equal(winPct({ mate: 0, winner: 'b' }), 0);
});

test('classification is from the mover’s side', () => {
  assert.equal(classify({ cp: 0 }, { cp: -500 }, 'w').kind, 'blunder');
  assert.equal(classify({ cp: 0 }, { cp: -500 }, 'b').kind, null); // good for Black
  assert.equal(classify({ cp: 0 }, { cp: -100 }, 'w').kind, 'inaccuracy');
  assert.equal(classify({ cp: 50 }, { cp: 40 }, 'w').kind, null);
});

test('accuracy: a perfect move is ~100, a big loss is low', () => {
  assert.ok(moveAccuracy(0) > 99.9);
  assert.ok(moveAccuracy(30) < 30);
  const s = summarize([{ cp: 20 }, { cp: 25 }, { cp: -600 }, { cp: -580 }], 3);
  assert.equal(s.b.blunder, 0);
  assert.equal(s.moves[1].kind, null); // 1... the move that took advantage of nothing was fine
  assert.equal(s.w.blunder, 0);
  assert.ok(s.w.accuracy > 90);
});

test('formatting', () => {
  assert.equal(formatEval({ cp: 134 }), '+1.3');
  assert.equal(formatEval({ cp: -40 }), '-0.4');
  assert.equal(formatEval({ mate: -2 }), '-M2');
  assert.equal(formatEval({ mate: 0, winner: 'w' }), '1-0');
});

test('the engine\'s own best move is never marked, whatever the next search says', () => {
  // ply 1 loses 20 win% by the numbers, but it is exactly the move the engine chose
  const evals = [{ cp: 300, pv: ['e2e4'] }, { cp: -60, pv: [] }];
  assert.equal(summarize(evals, 1).moves[0].kind, 'blunder');
  assert.equal(summarize(evals, 1, ['e2e4']).moves[0].kind, null);
  assert.equal(summarize(evals, 1, ['d2d4']).moves[0].kind, 'blunder');
});
