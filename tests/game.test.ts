import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, fenPieces, checkSquare, material, captures } from '../src/game.ts';

test('plays legal moves and rejects illegal ones', () => {
  const g = new Game();
  assert.ok(g.move('e2', 'e4'));
  assert.equal(g.move('e2', 'e4'), null);
  assert.equal(g.turn, 'b');
  assert.deepEqual(g.lastMoveAt(1), ['e2', 'e4']);
  assert.ok(g.dests().get('g8').includes('f6'));
});

test("fool's mate ends the game with checkmate", () => {
  const g = new Game();
  for (const [f, t] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) g.move(f, t);
  assert.equal(g.result, '0-1');
  assert.equal(g.termination, 'Checkmate');
  assert.equal(checkSquare(g.fenAt(4)), 'e1');
  assert.equal(g.dests().size, 0);
  assert.equal(g.move('a2', 'a3'), null);
});

test('undo reopens a finished game', () => {
  const g = new Game({ moves: ['f3', 'e5', 'g4', 'Qh4#'], result: '0-1', termination: 'Checkmate' });
  assert.ok(g.over);
  g.undo();
  assert.ok(!g.over);
  assert.equal(g.length, 3);
});

test('promotion detection and under-promotion', () => {
  const g = new Game({ moves: ['a4', 'h5', 'a5', 'h4', 'a6', 'h3', 'axb7', 'hxg2'] });
  assert.ok(g.isPromotion('b7', 'a8'));
  assert.ok(!g.isPromotion('b1', 'c3'));
  const p = g.move('b7', 'a8', 'n');
  assert.equal(p.san, 'bxa8=N');
});

test('PGN round trip keeps players, moves and result', () => {
  const g = new Game({ white: 'Asha "A"', black: 'Ben', tc: '5+3' });
  for (const [f, t] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3']]) g.move(f, t);
  g.resign('b');
  const back = Game.fromPGN(g.pgn());
  assert.equal(back.white, "Asha 'A'");
  assert.equal(back.black, 'Ben');
  assert.equal(back.tc, '5+3');
  assert.equal(back.result, '1-0');
  assert.deepEqual(back.toJSON().moves, ['e4', 'e5', 'Nf3']);
});

test('JSON round trip restores the live position', () => {
  const g = new Game({ tc: '3+2' });
  g.move('d2', 'd4');
  const back = new Game(JSON.parse(JSON.stringify(g)));
  assert.equal(back.chess.fen(), g.chess.fen());
  assert.equal(back.clocks.w, 180000);
});

test('flag against a bare king is a draw', () => {
  const g = new Game();
  g.chess.load('8/8/8/4k3/8/8/8/3QK3 b - - 0 1');
  g.flag('b');
  assert.equal(g.result, '1-0');
  const h = new Game();
  h.chess.load('8/8/8/4k3/8/8/8/3QK3 w - - 0 1');
  h.flag('w');
  assert.equal(h.result, '1/2-1/2');
});

test('material imbalance', () => {
  const m = material('rnb1kbnr/pppppppp/8/8/8/8/PPPPPPP1/RNBQKBNR w KQkq - 0 1');
  assert.equal(m.w.score, 8);
  assert.deepEqual(m.w.pieces, ['q']);
  assert.deepEqual(m.b.pieces, ['p']);
  assert.equal(fenPieces('8/8/8/8/8/8/8/4K3 w - - 0 1').get('e1'), 'wK');
});

test('captured pieces and points, chess.com style', () => {
  const g = new Game({ moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qxg2'] });
  const c = captures(g.chess.fen());
  assert.deepEqual(c.w.pieces, ['p']);
  assert.deepEqual(c.b.pieces, ['p', 'p']);
  assert.equal(c.b.score, 1);
  assert.equal(c.w.score, 0);
});

test('clock times per move: replay, JSON and PGN [%clk]', () => {
  const g = new Game({ tc: '3+2' });
  g.move('e2', 'e4').clock = 180000;
  g.move('e7', 'e5').clock = 176500;
  g.move('g1', 'f3').clock = 170200;
  assert.deepEqual(g.clocksAt(0), { w: 180000, b: 180000 });
  assert.deepEqual(g.clocksAt(2), { w: 180000, b: 176500 });
  assert.deepEqual(g.clocksAt(3), { w: 170200, b: 176500 });
  const back = new Game(JSON.parse(JSON.stringify(g)));
  assert.deepEqual(back.clocksAt(3), { w: 170200, b: 176500 });
  assert.match(g.pgn(), /1\. e4 \{\[%clk 0:03:00\]\} e5 \{\[%clk 0:02:57\]\}/);
  const imported = Game.fromPGN(g.pgn());
  assert.equal(imported.clocksAt(3).w, 170000);
});
