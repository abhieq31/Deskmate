// Game codes for remote play: the whole game is packed into a short text code
// that players paste to each other in any chat tool. No server is involved.
//
// Code = "OBC1-" + base64url(JSON payload). Moves are stored as one byte each:
// the index of the move in the position's legal moves, sorted by from+to+promotion,
// so the encoding doesn't depend on the move order of any particular chess library.
import { Chess } from '../vendor/chess.js';

export const CODE_PREFIX = 'OBC1-';

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

export function unpackMoves(packed) {
  const chess = new Chess();
  return [...fromB64url(packed)].map((i) => {
    const m = sortedMoves(chess)[i];
    if (!m) throw new Error('corrupt move data');
    chess.move(m.san);
    return m.san;
  });
}

/**
 * @param {{ id: string, white: string, black: string, moves: string[], sender: 'w'|'b',
 *           result?: string|null, termination?: string|null, offer?: 'w'|'b'|null }} g
 */
export function encodeCode(g) {
  const payload = { i: g.id, w: g.white, b: g.black, s: g.sender, m: packMoves(g.moves) };
  if (g.result) { payload.r = g.result; payload.t = g.termination || ''; }
  if (g.offer) payload.o = g.offer;
  const utf8 = new TextEncoder().encode(JSON.stringify(payload));
  return CODE_PREFIX + toB64url(utf8);
}

/** Extract and decode a code from arbitrary pasted text (a bare code, a chat message or a link). */
export function decodeCode(text) {
  const match = /OBC1-[A-Za-z0-9_-]+/.exec(String(text));
  if (!match) throw new Error('No OBChess game code found.');
  let p;
  try {
    p = JSON.parse(new TextDecoder().decode(fromB64url(match[0].slice(CODE_PREFIX.length))));
  } catch {
    throw new Error('This code is damaged — ask your opponent to copy it again.');
  }
  if (!p || typeof p.i !== 'string' || !['w', 'b'].includes(p.s)) throw new Error('This is not a valid game code.');
  let moves;
  try { moves = unpackMoves(p.m || ''); } catch { throw new Error('This code contains illegal moves.'); }
  return {
    id: p.i,
    white: String(p.w || 'White').slice(0, 24),
    black: String(p.b || 'Black').slice(0, 24),
    sender: p.s,
    moves,
    result: ['1-0', '0-1', '1/2-1/2'].includes(p.r) ? p.r : null,
    termination: p.r ? String(p.t || '').slice(0, 60) : null,
    offer: ['w', 'b'].includes(p.o) ? p.o : null,
  };
}

/**
 * Decide how an incoming code relates to the local game.
 * @returns {'new' | 'same' | 'update' | 'conflict'}
 */
export function compareToLocal(local, incoming) {
  if (!local || local.id !== incoming.id) return 'new';
  const mine = local.moves;
  const theirs = incoming.moves;
  const prefix = (a, b) => a.every((s, i) => s === b[i]);
  if (theirs.length < mine.length) return prefix(theirs, mine) ? 'same' : 'conflict';
  if (!prefix(mine, theirs)) return 'conflict';
  const changed = theirs.length > mine.length || incoming.result !== (local.result || null) ||
    incoming.offer !== (local.offer || null);
  return changed ? 'update' : 'same';
}
