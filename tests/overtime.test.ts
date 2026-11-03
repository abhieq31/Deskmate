import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, forfeitSquare, OVERTIME_MS } from '../src/game.ts';
import { packMoves, unpackMoves } from '../src/remote.ts';

test('out of time with overtime on: the queen goes, a minute comes back, play goes on', () => {
  const g = new Game({ tc: '3+0', ot: true, moves: ['e4', 'e5'] });
  g.clocks.w = 0;
  assert.equal(g.forfeit('w'), 'd1');
  assert.equal(g.clocks.w, OVERTIME_MS);
  assert.equal(g.over, false);
  assert.equal(g.fenAt(2).split(' ')[0], 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNB1KBNR');
  assert.deepEqual(g.forfeitAt(2), { sq: 'd1', name: 'queen' });
  assert.ok(g.move('g1', 'f3'), 'the flagged side moves on');
  assert.equal(g.forfeit('w'), null, 'not on the other side’s turn');
});

test('overtime off, or nothing but a king left: a flag is a flag', () => {
  const off = new Game({ tc: '3+0', moves: ['e4'] });
  assert.equal(off.forfeit('b'), null);
  assert.equal(forfeitSquare('4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'w'), null);
});

test('of equal pieces the least active goes; rook before bishop; bishop and knight tie on mobility', () => {
  // White: rooks a1 (boxed in by its own pawn and knight) and h1 (open file)
  assert.equal(forfeitSquare('4k3/8/8/8/8/8/P7/RN2K2R w - - 0 1', 'w'), 'a1');
  assert.equal(forfeitSquare('4k3/8/8/8/8/8/8/2B1K2R w - - 0 1', 'w'), 'h1');
});

test('forfeits survive save, load, takeback and PGN', () => {
  const g = new Game({ tc: '3+0', ot: true, moves: ['e4', 'e5'] });
  g.forfeit('w');
  g.move('g1', 'f3');
  g.move('b8', 'c6');
  const back = new Game(g.toJSON());
  assert.equal(back.chess.fen(), g.chess.fen());
  assert.deepEqual([...back.forfeits], [[2, 'd1']]);
  back.undo(); back.undo();
  assert.equal(back.length, 2);
  assert.ok(!back.chess.fen().startsWith('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR'), 'the queen stays given up');
  assert.match(g.pgn(), /\{Overtime: White gives up the queen on d1\}/);
});

test('a forfeit that leaves the flagged side mated ends the game', () => {
  // Black's bishop on f8 blocks a rook check along the back rank; it's Black's only piece
  const g = new Game({ tc: '3+0', ot: true });
  g._replay([], [], []);
  g.chess = new (g.chess.constructor as any)('R4bk1/5ppp/8/8/8/8/8/6K1 b - - 0 1');
  g.forfeits.clear();
  g.forfeit('b');
  assert.equal(g.result, '1-0');
});

test('live games carry forfeits in the packed moves', () => {
  const moves = ['e4', 'e5', 'Nf3', 'Nc6'];
  const ff: [number, string][] = [[2, 'd1']];
  assert.deepEqual(unpackMoves(packMoves(moves, ff), ff), moves);
  // Kd1 is only legal once the queen has left d1, so decoding has to replay the forfeit
  const after = ['e4', 'e5', 'Kd1'];
  assert.deepEqual(unpackMoves(packMoves(after, [[2, 'd1']]), [[2, 'd1']]), after);
});

test('a forfeit from the other laptop slots in under a move that crossed it, if that move stays legal', () => {
  const g = new Game({ tc: '3+0', ot: true, moves: ['e4', 'e5', 'Nf3'] });
  g.mergeForfeits([[2, 'd1']]);
  assert.deepEqual(g.plies.map((p) => p.san), ['e4', 'e5', 'Nf3']);
  assert.deepEqual([...g.forfeits], [[2, 'd1']]);
  // a queen move can't survive losing the queen: the replay stops there
  const q = new Game({ tc: '3+0', ot: true, moves: ['e4', 'e5', 'Qh5'] });
  q.mergeForfeits([[2, 'd1']]);
  assert.deepEqual(q.plies.map((p) => p.san), ['e4', 'e5']);
  assert.equal(q.turn, 'w');
});
