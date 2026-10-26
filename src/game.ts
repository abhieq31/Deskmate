// Game model: wraps chess.js with ply history, results, clocks state and PGN I/O.
// Pure logic, no DOM — this file is covered by tests/game.test.mjs.
import { Chess, DEFAULT_POSITION, type Move } from '../vendor/chess.js';

export type Color = 'w' | 'b';
export type Result = '1-0' | '0-1' | '1/2-1/2';
export type Role = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Clocks = Record<Color, number>;

export interface TimeControl { id: string; label: string; base: number; inc: number; kind?: string; moment: string }

/** One half-move as Deskmate keeps it. `clock`: ms left on the mover's clock after it. */
export interface Ply {
  san: string; from: string; to: string; color: Color; piece: string;
  captured: string | null; promotion: string | null; fen: string; clock?: number;
}

/** A live game with a colleague: room code, this browser's colour, each seat's player id, a pending offer. */
export interface RemoteSeat { room: string; me: Color | null; pw: string | null; pb: string | null; offer: Color | null }
/** A game against the computer: the colour it plays and how strong. */
export interface AiSeat { color: Color; level: 'easy' | 'medium' | 'hard' }

/** A game as saved in the browser and passed between laptops. */
export interface GameData {
  id?: string; white?: string; black?: string; tc?: string;
  startedAt?: number; endedAt?: number | null; result?: Result | null; termination?: string | null;
  clocks?: Clocks; moves?: string[]; clk?: (number | null)[];
  remote?: Partial<RemoteSeat> | null; ai?: AiSeat | null;
}

export const START_FEN = DEFAULT_POSITION;

// `moment`: the desk-sized break each one fits in
export const TIME_CONTROLS: TimeControl[] = [
  { id: 'none', label: 'Unlimited', base: 0, inc: 0, moment: 'No clock' },
  { id: '1+0', label: '1 + 0', base: 1, inc: 0, kind: 'Bullet', moment: 'Lift ride' },
  { id: '3+0', label: '3 + 0', base: 3, inc: 0, kind: 'Blitz', moment: 'Printer queue' },
  { id: '3+2', label: '3 + 2', base: 3, inc: 2, kind: 'Blitz', moment: 'Coffee break' },
  { id: '5+0', label: '5 + 0', base: 5, inc: 0, kind: 'Blitz', moment: 'Tea break' },
  { id: '5+3', label: '5 + 3', base: 5, inc: 3, kind: 'Blitz', moment: 'After stand-up' },
  { id: '10+0', label: '10 + 0', base: 10, inc: 0, kind: 'Rapid', moment: 'Build running' },
  { id: '10+5', label: '10 + 5', base: 10, inc: 5, kind: 'Rapid', moment: 'Lunch' },
  { id: '15+10', label: '15 + 10', base: 15, inc: 10, kind: 'Rapid', moment: 'Long lunch' },
  { id: '30+0', label: '30 + 0', base: 30, inc: 0, kind: 'Classical', moment: 'Friday, 5 pm' },
];

export const timeControl = (id: string): TimeControl => TIME_CONTROLS.find((t) => t.id === id) || TIME_CONTROLS[0];

const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Parse the piece placement field of a FEN into Map<square, 'wP' | 'bK' | ...>. */
export function fenPieces(fen: string): Map<string, string> {
  const map = new Map<string, string>();
  const rows = fen.split(' ')[0].split('/');
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      map.set('abcdefgh'[f] + (8 - r), color + ch.toUpperCase());
      f++;
    }
  });
  return map;
}

/** Square of the king of the side to move if that side is in check, else null. */
export function checkSquare(fen: string): string | null {
  const c = new Chess(fen);
  if (!c.inCheck()) return null;
  const turn = c.turn();
  for (const [sq, code] of fenPieces(fen)) if (code === turn + 'K') return sq;
  return null;
}

/** Lichess-style material imbalance: surplus pieces per side and the point lead. */
export function material(fen: string) {
  const count: Record<Color, Record<string, number>> = { w: {}, b: {} };
  for (const code of fenPieces(fen).values()) {
    const c = code[0], role = code[1].toLowerCase();
    count[c][role] = (count[c][role] || 0) + 1;
  }
  const out: Record<Color, { pieces: string[]; score: number }> = { w: { pieces: [], score: 0 }, b: { pieces: [], score: 0 } };
  let diff = 0;
  for (const role of ['q', 'r', 'b', 'n', 'p']) {
    const d = (count.w[role] || 0) - (count.b[role] || 0);
    diff += d * VALUES[role];
    const side = d > 0 ? 'w' : 'b';
    for (let i = 0; i < Math.abs(d); i++) out[side].pieces.push(role);
  }
  if (diff > 0) out.w.score = diff;
  if (diff < 0) out.b.score = -diff;
  return out;
}

const START: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };

/**
 * Pieces each side has captured (the opponent's missing pieces, pawns first) and the points
 * lead, as chess.com shows them next to the player names.
 */
export function captures(fen: string) {
  const count: Record<Color, Record<string, number>> = { w: {}, b: {} };
  for (const code of fenPieces(fen).values()) {
    const c = code[0], role = code[1].toLowerCase();
    count[c][role] = (count[c][role] || 0) + 1;
  }
  const out: Record<Color, { pieces: string[]; score: number }> = { w: { pieces: [], score: 0 }, b: { pieces: [], score: 0 } };
  const points: Record<Color, number> = { w: 0, b: 0 };
  for (const c of ['w', 'b'] as const) {
    const o = c === 'w' ? 'b' : 'w';
    for (const role of ['p', 'b', 'n', 'r', 'q']) {
      for (let i = (count[o][role] || 0); i < START[role]; i++) out[c].pieces.push(role);
      points[c] += (count[c][role] || 0) * VALUES[role];
    }
  }
  const diff = points.w - points.b;
  if (diff > 0) out.w.score = diff;
  if (diff < 0) out.b.score = -diff;
  return out;
}

/** True if `color` has only a bare king (cannot ever deliver mate). */
function bareKing(fen: string, color: Color): boolean {
  for (const code of fenPieces(fen).values()) if (code[0] === color && code[1] !== 'K') return false;
  return true;
}

export class Game {
  id: string;
  white: string;
  black: string;
  tc: string;
  startedAt: number;
  endedAt: number | null;
  result: Result | null;
  termination: string | null;
  clocks: Clocks;
  remote: RemoteSeat | null;
  ai: AiSeat | null;
  chess: Chess;
  plies: Ply[];

  constructor(data: GameData = {}) {
    this.id = data.id || uid();
    this.white = data.white || 'White';
    this.black = data.black || 'Black';
    this.tc = data.tc || 'none';
    this.startedAt = data.startedAt || Date.now();
    this.endedAt = data.endedAt || null;
    this.result = data.result || null; // '1-0' | '0-1' | '1/2-1/2' | null
    this.termination = data.termination || null; // human readable reason
    const tc = timeControl(this.tc);
    this.clocks = data.clocks || { w: tc.base * 60000, b: tc.base * 60000 };
    // live remote games: room code, the colour this browser plays, the player id in each
    // colour's seat (empty until someone sits there) and a pending draw offer
    this.remote = data.remote ? { room: '', me: null, pw: null, pb: null, offer: null, ...data.remote } : null;
    // games against the computer: the colour it plays and how strong ('easy' | 'medium' | 'hard')
    this.ai = data.ai ? { color: data.ai.color, level: data.ai.level } : null;
    this.chess = new Chess();
    this.plies = [];
    for (const san of data.moves || []) this._push(this.chess.move(san));
    // time left on the mover's clock after each move (ms), when the game had a clock
    (data.clk || []).forEach((ms, i) => { if (this.plies[i] && ms != null) this.plies[i].clock = ms; });
  }

  get tcInfo(): TimeControl { return timeControl(this.tc); }
  get hasClock() { return this.tcInfo.base > 0; }
  get turn(): Color { return this.chess.turn(); }
  get over() { return !!this.result; }
  get length() { return this.plies.length; }

  _push(m: Move) {
    this.plies.push({
      san: m.san, from: m.from, to: m.to, color: m.color as Color, piece: m.piece,
      captured: m.captured || null, promotion: m.promotion || null, fen: m.after,
    });
  }

  fenAt(ply: number): string { return ply === 0 ? START_FEN : this.plies[ply - 1].fen; }
  lastMoveAt(ply: number): [string, string] | null { return ply === 0 ? null : [this.plies[ply - 1].from, this.plies[ply - 1].to]; }

  /** Map<from, to[]> of legal moves in the live position. */
  dests(): Map<string, string[]> {
    const d = new Map<string, string[]>();
    if (this.over) return d;
    for (const m of this.chess.moves({ verbose: true })) {
      if (!d.has(m.from)) d.set(m.from, []);
      if (!d.get(m.from).includes(m.to)) d.get(m.from).push(m.to);
    }
    return d;
  }

  isPromotion(from: string, to: string): boolean {
    return this.chess.moves({ square: from, verbose: true }).some((m) => m.to === to && m.promotion);
  }

  /** Play a move given in SAN (used when applying an opponent's code). */
  moveSan(san: string): Ply | null {
    if (this.over) return null;
    let m;
    try { m = this.chess.move(san); } catch { return null; }
    this._push(m);
    this._detectEnd();
    return this.plies[this.plies.length - 1];
  }

  /** Play a move; returns the ply record or null if illegal. */
  move(from: string, to: string, promotion?: string): Ply | null {
    if (this.over) return null;
    let m;
    try { m = this.chess.move({ from, to, promotion: promotion || 'q' }); } catch { return null; }
    this._push(m);
    this._detectEnd();
    return this.plies[this.plies.length - 1];
  }

  _detectEnd() {
    const c = this.chess;
    if (c.isCheckmate()) this.finish(c.turn() === 'w' ? '0-1' : '1-0', 'Checkmate');
    else if (c.isStalemate()) this.finish('1/2-1/2', 'Stalemate');
    else if (c.isInsufficientMaterial()) this.finish('1/2-1/2', 'Insufficient material');
    else if (c.isThreefoldRepetition()) this.finish('1/2-1/2', 'Threefold repetition');
    else if (c.isDrawByFiftyMoves()) this.finish('1/2-1/2', 'Fifty-move rule');
  }

  finish(result: Result, termination: string) {
    this.result = result;
    this.termination = termination;
    this.endedAt = Date.now();
  }

  resign(color: Color) { this.finish(color === 'w' ? '0-1' : '1-0', `${this.nameOf(color)} resigned`); }
  agreeDraw() { this.finish('1/2-1/2', 'Draw by agreement'); }
  flag(color: Color) {
    const other: Color = color === 'w' ? 'b' : 'w';
    if (bareKing(this.chess.fen(), other)) this.finish('1/2-1/2', 'Time out vs insufficient material');
    else this.finish(color === 'w' ? '0-1' : '1-0', `${this.nameOf(color)} ran out of time`);
  }

  /**
   * What each clock showed with `ply` moves played: the time its player had left after their
   * last move up to that point, or the starting time before their first move.
   */
  clocksAt(ply: number): Clocks {
    const out: Clocks = { w: this.tcInfo.base * 60000, b: this.tcInfo.base * 60000 };
    for (let i = 0; i < ply && i < this.plies.length; i++) {
      const p = this.plies[i];
      if (p.clock != null) out[p.color] = p.clock;
    }
    return out;
  }

  undo() {
    if (!this.plies.length) return false;
    this.chess.undo();
    this.plies.pop();
    this.result = this.termination = this.endedAt = null;
    return true;
  }

  nameOf(color: Color): string { return color === 'w' ? this.white : this.black; }

  winnerText() {
    if (this.result === '1-0') return `${this.white} wins`;
    if (this.result === '0-1') return `${this.black} wins`;
    if (this.result === '1/2-1/2') return 'Draw';
    return '';
  }

  toJSON(): GameData {
    return {
      id: this.id, white: this.white, black: this.black, tc: this.tc,
      startedAt: this.startedAt, endedAt: this.endedAt, result: this.result,
      termination: this.termination, clocks: this.clocks, moves: this.plies.map((p) => p.san),
      clk: this.plies.some((p) => p.clock != null) ? this.plies.map((p) => (p.clock == null ? null : Math.round(p.clock))) : undefined,
      remote: this.remote,
      ai: this.ai || undefined,
    };
  }

  pgn() {
    const d = new Date(this.startedAt);
    const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    const tc = this.tcInfo;
    // chess.js's PGN parser does not accept escaped quotes, so swap them for apostrophes
    const esc = (s: string) => String(s).replace(/[\\"]/g, "'");
    const headers = [
      ['Event', this.remote ? 'Casual remote game' : this.ai ? 'Casual game against Stockfish' : 'Casual over-the-board game'], ['Site', 'Deskmate'], ['Date', date],
      ['White', this.white], ['Black', this.black], ['Result', this.result || '*'],
      ['TimeControl', tc.base ? `${tc.base * 60}+${tc.inc}` : '-'],
    ];
    if (this.termination) headers.push(['Termination', this.termination]);
    let text = headers.map(([k, v]) => `[${k} "${esc(v)}"]`).join('\n') + '\n\n';
    const parts: string[] = [];
    const clk = (ms: number) => {
      const t = Math.max(0, Math.round(ms / 1000));
      return `{[%clk ${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}]}`;
    };
    this.plies.forEach((p, i) => {
      if (i % 2 === 0) parts.push(`${i / 2 + 1}.`);
      parts.push(p.san);
      if (p.clock != null) parts.push(clk(p.clock));
    });
    parts.push(this.result || '*');
    // wrap movetext at ~80 chars as PGN export format recommends
    let line = '';
    for (const tok of parts) {
      if ((line + ' ' + tok).trim().length > 80) { text += line.trim() + '\n'; line = ''; }
      line += ' ' + tok;
    }
    return text + line.trim() + '\n';
  }

  /** Build a Game from PGN text; throws on invalid PGN. */
  static fromPGN(text: string): Game {
    const c = new Chess();
    c.loadPgn(text);
    const h = c.getHeaders();
    const tcHeader = h.TimeControl && /^(\d+)\+(\d+)$/.exec(h.TimeControl);
    const tcId = tcHeader ? `${+tcHeader[1] / 60}+${tcHeader[2]}` : 'none';
    const g = new Game({
      white: h.White && h.White !== '?' ? h.White : 'White',
      black: h.Black && h.Black !== '?' ? h.Black : 'Black',
      tc: timeControl(tcId).id,
      moves: c.history(),
    });
    // clock times from [%clk h:mm:ss] comments (lichess and chess.com both write them)
    const clocks = new Map(c.getComments().map(({ fen, comment }) => {
      const m = /\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/.exec(comment || '');
      return [fen, m ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 : null];
    }));
    g.plies.forEach((p) => { if (clocks.get(p.fen) != null) p.clock = clocks.get(p.fen); });
    const date = h.Date && /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(h.Date);
    if (date) g.startedAt = new Date(+date[1], +date[2] - 1, +date[3]).getTime();
    if (['1-0', '0-1', '1/2-1/2'].includes(h.Result)) {
      g.result = h.Result as Result;
      g.termination = h.Termination || g.termination || 'Imported';
    } else if (!g.result) {
      g._detectEnd();
    }
    return g;
  }
}
