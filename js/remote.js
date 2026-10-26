// Compact move encoding for live game snapshots: one byte per move, base64url.
// Each byte is the index of the move among the position's legal moves, sorted by
// from+to+promotion, so the encoding doesn't depend on any chess library's move order.
import { Chess } from '../vendor/chess.js';

const sortedMoves = (chess) =>
  chess.moves({ verbose: true })
    .map((m) => ({ key: m.from + m.to + (m.promotion || ''), san: m.san }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

const toB64url = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64url = (str) => {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export function packMoves(sans) {
  const chess = new Chess();
  const bytes = sans.map((san) => {
    const list = sortedMoves(chess);
    const i = list.findIndex((m) => m.san === san);
    if (i < 0) throw new Error(`illegal move ${san}`);
    chess.move(san);
    return i;
  });
  return toB64url(bytes);
}

/** Throws on data that does not decode to legal moves. */
export function unpackMoves(packed) {
  const chess = new Chess();
  return [...fromB64url(packed)].map((i) => {
    const m = sortedMoves(chess)[i];
    if (!m) throw new Error('corrupt move data');
    chess.move(m.san);
    return m.san;
  });
}
