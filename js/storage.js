// localStorage persistence. Everything stays in this browser; nothing is sent anywhere.
const KEYS = { current: 'deskmate:current', archive: 'deskmate:archive', settings: 'deskmate:settings' };
const ARCHIVE_LIMIT = 300;

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
  theme: 'green',
  focus: true, // during a game: only the board, the players and the clocks
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
};
