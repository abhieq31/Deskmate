import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standings } from '../js/office.js';

test('office table counts wins, draws and losses per person', () => {
  const t = standings([
    { white: 'Asha', black: 'Ben', result: '1-0' },
    { white: 'ben ', black: 'asha', result: '1/2-1/2' },
    { white: 'Ben', black: 'Chen', result: '0-1' },
    { white: 'Asha', black: 'White', result: '0-1' }, // placeholder name: only Asha counts
    { white: 'Asha', black: 'Ben', result: null }, // unfinished: ignored
  ]);
  assert.deepEqual(t.map((r) => [r.name, r.played, r.won, r.drawn, r.lost, r.score]), [
    ['Asha', 3, 1, 1, 1, 1.5],
    ['Chen', 1, 1, 0, 0, 1],
    ['Ben', 3, 0, 1, 2, 0.5],
  ]);
});
