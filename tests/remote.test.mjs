import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packMoves, unpackMoves } from '../js/remote.js';

const opera = ['e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3', 'Qxf3', 'dxe5', 'Bc4', 'Nf6',
  'Qb3', 'Qe7', 'Nc3', 'c6', 'Bg5', 'b5', 'Nxb5', 'cxb5', 'Bxb5+', 'Nbd7', 'O-O-O', 'Rd8',
  'Rxd7', 'Rxd7', 'Rd1', 'Qe6', 'Bxd7+', 'Nxd7', 'Qb8+', 'Nxb8', 'Rd8#'];

test('moves pack to one byte each and round-trip', () => {
  const packed = packMoves(opera);
  assert.ok(packed.length <= Math.ceil((opera.length * 4) / 3));
  assert.deepEqual(unpackMoves(packed), opera);
  assert.deepEqual(unpackMoves(''), []);
});

test('promotion choices survive the round trip', () => {
  const moves = ['a4', 'h5', 'a5', 'h4', 'a6', 'h3', 'axb7', 'hxg2', 'bxa8=N', 'gxh1=R'];
  assert.deepEqual(unpackMoves(packMoves(moves)), moves);
});

test('rejects illegal moves and corrupt data', () => {
  assert.throws(() => packMoves(['e5']), /illegal/);
  assert.throws(() => unpackMoves('_w'), /corrupt/);
});
