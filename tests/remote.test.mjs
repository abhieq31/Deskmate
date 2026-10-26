import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCode, decodeCode, packMoves, unpackMoves, compareToLocal } from '../js/remote.js';

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

test('code round trip with unicode names, result and draw offer', () => {
  const code = encodeCode({
    id: 'abc123', white: 'Ananya ♛', black: 'Bo "Bishop"', sender: 'b',
    moves: ['d4', 'd5'], offer: 'b',
  });
  assert.match(code, /^OBC1-[A-Za-z0-9_-]+$/);
  const d = decodeCode(`Your move! ${code} (paste into OBChess)`);
  assert.equal(d.id, 'abc123');
  assert.equal(d.white, 'Ananya ♛');
  assert.equal(d.black, 'Bo "Bishop"');
  assert.equal(d.sender, 'b');
  assert.deepEqual(d.moves, ['d4', 'd5']);
  assert.equal(d.offer, 'b');
  assert.equal(d.result, null);

  const done = decodeCode(encodeCode({ id: 'x', white: 'A', black: 'B', sender: 'w', moves: opera, result: '1-0', termination: 'Checkmate' }));
  assert.equal(done.result, '1-0');
  assert.equal(done.termination, 'Checkmate');
});

test('rejects junk and damaged codes', () => {
  assert.throws(() => decodeCode('hello'), /No OBChess game code/);
  assert.throws(() => decodeCode('OBC1-!!!!'), /No OBChess|damaged/);
  assert.throws(() => decodeCode('OBC1-AAAA'), /damaged|not a valid/);
  const code = encodeCode({ id: 'x', white: 'A', black: 'B', sender: 'w', moves: ['e4'] });
  assert.throws(() => decodeCode(code.slice(0, -6)), /damaged|not a valid|illegal/);
});

test('compareToLocal classifies incoming codes', () => {
  const local = { id: 'g', moves: ['e4', 'e5'], result: null, offer: null };
  assert.equal(compareToLocal(null, { id: 'g', moves: [] }), 'new');
  assert.equal(compareToLocal(local, { id: 'other', moves: [] }), 'new');
  assert.equal(compareToLocal(local, { id: 'g', moves: ['e4', 'e5'], result: null, offer: null }), 'same');
  assert.equal(compareToLocal(local, { id: 'g', moves: ['e4'], result: null, offer: null }), 'same');
  assert.equal(compareToLocal(local, { id: 'g', moves: ['e4', 'e5', 'Nf3'], result: null, offer: null }), 'update');
  assert.equal(compareToLocal(local, { id: 'g', moves: ['e4', 'e5'], result: '0-1', offer: null }), 'update');
  assert.equal(compareToLocal(local, { id: 'g', moves: ['d4', 'e5', 'Nf3'], result: null, offer: null }), 'conflict');
});
