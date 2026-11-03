// localStorage persistence. Everything stays in this browser; nothing is sent anywhere.
import { resultOf, type RatedResult } from './rating.ts';

const KEYS = { current: 'deskmate:current', archive: 'deskmate:archive', settings: 'deskmate:settings', results: 'deskmate:results' };
const ARCHIVE_LIMIT = 300;
// results behind the ratings: ~100 bytes each, kept far longer than the full games
const RESULTS_LIMIT = 5000;

// the app used to be called OBChess: carry its saved data over once
try {
  for (const [name, key] of Object.entries(KEYS)) {
    const legacy = `obchess:${name}`;
    const old = localStorage.getItem(legacy);
    if (old !== null && localStorage.getItem(key) === null) localStorage.setItem(key, old);
    if (old !== null) localStorage.removeItem(legacy);
  }
} catch { /* storage unavailable */ }

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // private mode or quota exceeded: the app keeps working in memory
  }
};

export const DEFAULT_SETTINGS = {
  autoFlip: true,
  sound: true,
  showDests: true,
  coords: true,
  theme: 'ember',
  focus: true, // during a game: only the board, the players and the clocks
  winBar: true, // a slim bar by the board with each side's winning chances
  overtime: true, // out of time: give up your best piece for another minute instead of losing
  notation: 'figurine', // moves as ♘f3, or Nf3 with 'letter'
  animation: 'medium', // piece slides: 'none' | 'fast' | 'medium' | 'slow'
  celebration: 'confetti', // or 'none'
  moveMethod: 'both', // 'both' | 'drag' | 'click'
  highlightLast: true,
  autoQueen: false, // promote without asking
  anDepth: 'balanced', // analysis: 'fast' | 'balanced' | 'deep'
  bestArrow: true, // analysis: the engine's move as an arrow
  evalBar: true, // analysis: the bar beside the board
  boardSize: 0, // px the player dragged the board to with the corner handle; 0 = as large as fits
  white: 'White',
  black: 'Black',
  tc: 'none',
  myName: '',
  remoteTc: 'none',
  // anonymous id for this browser: tells the two laptops in a live game which seat is whose
  pid: '',
};

export const storage = {
  loadSettings: () => ({ ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) }),
  saveSettings: (s) => write(KEYS.settings, s),

  loadCurrent: () => read(KEYS.current, null),
  saveCurrent: (game) => write(KEYS.current, game),

  loadArchive: () => read(KEYS.archive, []),
  /** Insert or replace a game in the archive (newest first). */
  archive(game) {
    const list = read(KEYS.archive, []).filter((g) => g.id !== game.id);
    list.unshift(game);
    write(KEYS.archive, list.slice(0, ARCHIVE_LIMIT));
  },
  removeFromArchive(id) {
    write(KEYS.archive, read(KEYS.archive, []).filter((g) => g.id !== id));
  },
  clearArchive: () => write(KEYS.archive, []),

  /** Every rated result, oldest first. The first time, it starts from the saved games. */
  loadResults(): RatedResult[] {
    const list = read(KEYS.results, null);
    if (list) return list;
    const seeded = read(KEYS.archive, []).map(resultOf).filter(Boolean).reverse();
    write(KEYS.results, seeded);
    return seeded;
  },
  /** Insert or replace one game's result (a takeback can change it). */
  saveResult(r: RatedResult) {
    const list = storage.loadResults().filter((x) => x.id !== r.id);
    list.push(r);
    write(KEYS.results, list.slice(-RESULTS_LIMIT));
  },
};
