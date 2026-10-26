// Deskmate application controller: wires the game model, board, clocks, live rooms, storage and UI.
import { Game, TIME_CONTROLS, timeControl, checkSquare, captures, type Color, type GameData, type AiSeat } from './game.ts';
import { Board } from './board.ts';
import { storage } from './storage.ts';
import { sound } from './sound.ts';
import { confetti } from './confetti.ts';
import { packMoves, unpackMoves } from './remote.ts';
import { Room, newRoomCode, parseRoomCode, formatRoomCode } from './live.ts';
import { Engine, type Eval } from './engine.ts';
import { standings } from './office.ts';
import { loadOpenings, openingName } from './openings.ts';
import { summarize, winPct, formatEval, MARKS } from './analysis.ts';
import { Chess } from '../vendor/chess.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
const colorName = (c) => (c === 'w' ? 'White' : 'Black');

const settings = storage.loadSettings();
if (!['ember', 'stone', 'green'].includes(settings.theme)) settings.theme = 'ember';
if (!settings.pid) {
  settings.pid = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(36).padStart(2, '0')).join('');
  storage.saveSettings(settings);
}

let game = restoreGame();
let viewPly = game.length;
let review = null; // a read-only Game opened from saved games / import
// a same-laptop timed game resumes paused after a reload; live games keep running
let paused = game.hasClock && game.length > 0 && !game.over && !game.remote;
let lastTick = Date.now();
let flipTimer = null;
let room = null; // live connection for game.remote.room
let relaysUp = 0; // relays the room is connected to right now
let joining = null; // { code, name, timer } while waiting for a room's first snapshot
let an = null; // post-game analysis: { game, evals[], summary, done }
let view = 'game'; // 'home' | 'game'
let engine = null;
let aiEngine = null; // Stockfish as an opponent; a separate worker from the analysis one
let aiTurn = 0; // bumped whenever a pending computer move must be thrown away

const board = new Board($('#board'), { onMove });

function restoreGame() {
  const saved = storage.loadCurrent();
  if (saved) {
    try { return new Game(saved); } catch { /* corrupt save: start fresh */ }
  }
  return new Game({ white: settings.white, black: settings.black, tc: settings.tc });
}

const active = () => review || game;
const isLive = () => !review && viewPly === game.length;
const clockRunning = () => !review && game.hasClock && !game.over && game.length > 0 && !paused;
const seated = (color) => !game.remote || !!(color === 'w' ? game.remote.pw : game.remote.pb);
// a live game starts once both seats are taken; this browser moves only its own colour
const bothSeated = () => seated('w') && seated('b');
const myTurn = () => (game.ai ? game.turn !== game.ai.color : !game.remote || (game.turn === game.remote.me && bothSeated()));
const homeOrientation = () => (game.ai ? other(game.ai.color) : game.remote ? game.remote.me || 'w' : settings.autoFlip ? game.turn : 'w');

/* ---------------- rendering ---------------- */

function render() {
  const g = active();
  const fen = g.fenAt(viewPly);
  const canMove = isLive() && !g.over && myTurn();
  board.set({
    fen,
    lastMove: g.lastMoveAt(viewPly),
    check: checkSquare(fen),
    dests: canMove ? g.dests() : new Map(),
    movable: canMove ? g.turn : null,
  });
  renderPlayers();
  renderMoves();
  renderStatus();
  renderControls();
  renderAnalysis();
  applyFocus();
  scheduleWinBar();
}

function renderPlayers() {
  const g = active();
  const fen = g.fenAt(viewPly);
  const mat = captures(fen);
  const bottom = board.orientation, top = other(bottom);
  const turn = fen.split(' ')[1];
  const atEnd = viewPly === g.length;
  const inCheck = !!checkSquare(fen);
  for (const [id, color] of [['#player-top', top], ['#player-bottom', bottom]] as const) {
    const card = $(id);
    const here = review || seated(color);
    card.dataset.color = color;
    card.querySelector('[data-name]').textContent =
      (here ? g.nameOf(color) || colorName(color) : 'Opponent') + (!review && g.remote?.me === color ? ' (you)' : '');
    // pieces this player has taken, grouped by kind like chess.com, then the points lead
    const m = mat[color];
    const groups = [];
    for (const r of m.pieces) (groups.at(-1)?.[0] === r ? groups.at(-1) : groups[groups.push([]) - 1]).push(r);
    card.querySelector('[data-material]').innerHTML =
      groups.map((grp) => `<span class="cap">${grp.map((r) => `<i class="pc ${other(color)}${r.toUpperCase()}"></i>`).join('')}</span>`).join('') +
      (m.score ? `<b>+${m.score}</b>` : '');
    const toMove = !g.over && turn === color && atEnd && here;
    const won = g.result === (color === 'w' ? '1-0' : '0-1');
    const offers = !g.over && g.remote?.offer === color;
    card.classList.toggle('to-move', toMove);
    card.classList.toggle('winner', won);
    card.classList.toggle('offer', offers);
    card.querySelector('[data-status]').textContent =
      playerStatus(g, color, { here, toMove, won, offers, inCheck: inCheck && turn === color });
  }
  renderClocks();
}

/** One short line under a player's name. */
function playerStatus(g, color, { here, toMove, won, offers, inCheck }) {
  if (g.result) return won ? '♛ Won' : g.result === '1/2-1/2' ? '½ Draw' : '';
  const r = !review && g.remote;
  if (r && !here) return `Waiting to join · code ${formatRoomCode(r.room)}`;
  if (r && color !== r.me && relaysUp === 0) return 'Reconnecting…';
  if (offers) return 'Offers a draw';
  if (inCheck && toMove) return 'Check!';
  // whose turn it is only needs saying when two people share one laptop
  if (!toMove || r || g.ai) return '';
  return 'To move';
}

function fmtClock(ms) {
  ms = Math.max(0, ms);
  if (ms < 10000) return `0:0${(ms / 1000).toFixed(1)}`.replace(/0(\d\d)/, '$1');
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : m) + ':' + String(sec).padStart(2, '0');
}

function renderClocks() {
  const g = active();
  const bottom = board.orientation;
  for (const [sel, color] of [['#clock-top', other(bottom)], ['#clock-bottom', bottom]]) {
    const clock = $(sel);
    clock.parentElement.classList.toggle('hidden', !g.hasClock);

    const time = clock.querySelector('[data-time]');
    clock.classList.toggle('active', !g.over && !review && viewPly === g.length && g.turn === color && bothSeated());
    clock.classList.toggle('unlimited', !g.hasClock);
    clock.setAttribute('aria-label', `${g.nameOf(color) || colorName(color)}'s clock`);
    if (!g.hasClock) {
      time.textContent = '∞';
      clock.classList.remove('running', 'low', 'paused');
      continue;
    }
    // replaying: the clocks as they stood after the move on the board
    const past = review || viewPly < g.length;
    const ms = past ? g.clocksAt(viewPly)[color] : g.clocks[color];
    time.textContent = fmtClock(ms);
    clock.classList.toggle('running', !past && clockRunning() && game.turn === color);
    clock.classList.toggle('low', ms < 20000 && !past);
    clock.classList.toggle('paused', !review && paused && game.turn === color && game.length > 0 && !game.over);
  }
}

/** One line of moves (top right), like chess.com's analysis strip; marks come from the analysis. */
function renderMoves() {
  const g = active();
  const marks = an && an.game === g ? an.summary?.moves || [] : [];
  const parts = [];
  g.plies.forEach((p, i) => {
    if (i % 2 === 0) parts.push(`<span class="ml-num">${i / 2 + 1}.</span>`);
    const m = marks[i]?.kind;
    parts.push(`<button class="mv${viewPly === i + 1 ? ' active' : ''}${m ? ` ${m}` : ''}" data-ply="${i + 1}">${san(p.san)}${m ? `<span class="mark">${MARKS[m]}</span>` : ''}</button>`);
  });
  if (!g.plies.length) parts.push('<span class="empty">No moves yet</span>');
  const list = $('#moves');
  list.innerHTML = parts.join('');
  // keep the current move in view by scrolling the strip itself (never the page)
  const act = list.querySelector('.active');
  if (act) {
    const l = act.offsetLeft - list.offsetLeft, r = l + act.offsetWidth;
    if (l < list.scrollLeft + 20) list.scrollLeft = l - 40;
    else if (r > list.scrollLeft + list.clientWidth - 20) list.scrollLeft = r - list.clientWidth + 40;
  } else if (viewPly === 0) list.scrollLeft = 0;
  else list.scrollLeft = list.scrollWidth;

  renderAnMoves();
  renderOpening(g);
  $('#tc-label').textContent = g.tcInfo.base ? g.tcInfo.label.replace(/ /g, '') : '';

  const rl = $('#result-line');
  rl.classList.toggle('hidden', !g.result);
  if (g.result) rl.innerHTML = `<strong>${g.result.replace(/1\/2/g, '½')}</strong><span>${g.termination} · ${g.winnerText()}</span>`;
}

// SAN with figurine piece letters
const FIG = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const san = (s: string) => (settings.notation === 'letter' ? s : s.replace(/[KQRBN]/g, (c) => `<span class="fig">${FIG[c]}</span>`));

const tcText = (tc) => (tc.base ? `${tc.label} · ${tc.kind}` : 'Unlimited');

function renderStatus() {
  const g = active();
  $('#tc-badge').textContent = tcText(g.tcInfo);
  document.title = g.result ? `${g.winnerText()} · Deskmate` : review ? 'Review · Deskmate' : `${colorName(game.turn)} to move · Deskmate`;

  const banner = $('#review-banner');
  const showBanner = !an && (!!review || viewPly !== game.length);
  banner.classList.toggle('hidden', !showBanner);
  if (review) $('#review-text').textContent = `Reviewing ${review.white} vs ${review.black}${review.result ? ` · ${review.result}` : ''}`;
  else if (showBanner) $('#review-text').textContent = `Viewing move ${Math.ceil(viewPly / 2) || 0}${viewPly % 2 ? '' : viewPly ? '…' : ''}`;
  $('#review-exit').textContent = review ? 'Back to live game' : 'Back to current move';
}

const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg><span>Pause</span>';
const ICON_RESUME = '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg><span>Resume</span>';

function renderControls() {
  const g = active();
  for (const b of [$('#nav-first'), $('#nav-prev'), $('[data-nav="prev"]'), $('#focus-prev')]) b.disabled = viewPly === 0;
  for (const b of [$('#nav-last'), $('#nav-next'), $('[data-nav="next"]'), $('#focus-next')]) b.disabled = viewPly === g.length;
  const liveGame = !review;
  $('#btn-undo').disabled = !liveGame || game.length === 0 || !!game.remote;
  const noActions = !liveGame || game.over || (game.remote ? !bothSeated() : game.length === 0);
  const theyOffer = !!game.remote && !game.over && game.remote.offer === other(game.remote.me);
  for (const b of $$('.act-draw')) {
    b.disabled = noActions;
    b.classList.toggle('offer', theyOffer);
    b.title = game.remote ? (theyOffer ? 'Accept the draw offer' : 'Offer a draw') : 'Agree to a draw';
  }
  for (const b of $$('.act-resign')) b.disabled = noActions;
  // while a game is on: Draw / Resign. Once it is over: Analyse.
  const finished = !!g.result || (!!review && g.length > 0);
  for (const b of $$('.act-draw, .act-resign')) b.classList.toggle('hidden', finished);
  for (const b of $$('.act-draw')) if (game.ai && !review) b.classList.add('hidden'); // the computer plays on
  for (const b of $$('.act-analyse')) b.classList.toggle('hidden', !finished || !!an);
  // once it's over: start another, or the same again with colours swapped
  for (const b of $$('.act-newgame')) b.classList.toggle('hidden', !finished);
  for (const b of $$('.act-rematch')) b.classList.toggle('hidden', !finished || !!review);
  $('#btn-sound').classList.toggle('off', !settings.sound);
  $('.game').classList.toggle('analysing', !!an);
  for (const b of $$('.act-pause')) {
    b.classList.toggle('hidden', !game.hasClock || !liveGame || !!game.remote);
    b.disabled = game.over || game.length === 0;
    b.innerHTML = paused ? ICON_RESUME : ICON_PAUSE;
    b.title = paused ? 'Resume clocks (Space)' : 'Pause clocks (Space)';
  }
}

/** The opening's name above the moves, from lichess's open data set (loaded once, on first use). */
let openings = null;
function renderOpening(g) {
  const el = $('#opening');
  if (!g.length) { el.textContent = 'Starting position'; return; }
  if (!openings) {
    loadOpenings().then((t) => { openings = t; renderOpening(active()); }).catch(() => {});
    return;
  }
  const fens = [];
  for (let i = 1; i <= Math.min(viewPly || g.length, g.length); i++) fens.push(g.fenAt(i));
  el.textContent = openingName(openings, fens) || el.textContent;
}

/* ---------------- moves ---------------- */

async function onMove(from, to) {
  if (!isLive() || game.over || !myTurn()) return;
  let promotion;
  if (game.isPromotion(from, to)) {
    promotion = settings.autoQueen ? 'q' : await board.askPromotion(to, game.turn);
    if (!promotion) { render(); return; }
  }
  if (!applyMove(from, to, promotion)) render();
}

/** Plays a move on the live game (from either player or the computer): clocks, sound, save, sync. */
function applyMove(from, to, promotion) {
  const mover = game.turn;
  const now = Date.now();
  const ply = game.move(from, to, promotion);
  if (!ply) return null;

  if (game.remote) game.remote.offer = null; // moving declines a pending offer
  if (game.hasClock) {
    if (game.length > 1 && !paused) game.clocks[mover] -= now - lastTick;
    if (game.length > 1) game.clocks[mover] += game.tcInfo.inc * 1000;
    ply.clock = game.clocks[mover];
    paused = false;
    lastTick = now;
  }
  viewPly = game.length;
  if (ply.captured) sound.capture();

  persist();
  publish();
  render();
  if (game.over) onGameOver();
  else { scheduleFlip(); computerMove(); }
  return ply;
}

/* ---------------- win chances during the game ---------------- */

// A slim bar by the board with each side's chances (lichess's win% from a short Stockfish search),
// refreshed after every move. Quiet on purpose: no numbers in the move list, no best move, no arrows.
const WIN_LIMITS = { wasm: { depth: 12, movetime: 350 }, asm: { depth: 8, movetime: 300 } };
let liveEngine = null;
let liveTurn = 0;
const liveEvals = new Map(); // fen → evaluation, so stepping back and forth costs nothing

function winBarWanted() {
  return settings.winBar && view === 'game' && !an && !review && game.length > 0;
}

async function scheduleWinBar() {
  if (!winBarWanted()) return renderWinBar();
  const fen = game.fenAt(viewPly);
  if (liveEvals.has(fen)) return renderWinBar();
  const turn = ++liveTurn;
  try {
    liveEngine = liveEngine || new Engine();
    const flavor = await liveEngine.start();
    if (turn !== liveTurn) return;
    const ev = terminalEval(fen) || await liveEngine.analyse(fen, WIN_LIMITS[flavor]);
    if (ev) liveEvals.set(fen, ev);
  } catch { return; } // no engine in this browser: no bar, nothing else changes
  if (turn === liveTurn) renderWinBar();
}

function renderWinBar() {
  const bar = $('#evalbar');
  const ev = winBarWanted() && liveEvals.get(game.fenAt(viewPly));
  if (an && an.game === active()) return; // the analysis owns the bar
  bar.classList.toggle('hidden', !ev);
  if (!ev) return;
  const white = winPct(ev);
  bar.style.setProperty('--w', `${white}%`);
  bar.classList.toggle('flip', board.orientation === 'b');
  bar.classList.toggle('black-better', white < 50);
  const top = other(board.orientation);
  const pct = (c) => `${Math.round(c === 'w' ? white : 100 - white)}%`;
  $('#wb-top').textContent = pct(top);
  $('#wb-bot').textContent = pct(board.orientation);
  bar.title = `Winning chances: White ${Math.round(white)}%, Black ${Math.round(100 - white)}%`;
}

/* ---------------- playing the computer ---------------- */

// Stockfish 11 Skill Level 0–20 plus a search limit per level; lower skill makes it pick
// weaker moves on purpose. Roughly: Easy loses to a beginner who is careful, Hard is club strength+.
const AI_LEVELS = {
  easy: { label: 'Easy', skill: 0, depth: 2, movetime: 150 },
  medium: { label: 'Medium', skill: 7, depth: 7, movetime: 400 },
  hard: { label: 'Hard', skill: 16, depth: 14, movetime: 1200 },
};
const aiName = (level) => `Stockfish · ${AI_LEVELS[level]?.label || 'Medium'}`;

/** If it's the computer's turn in the live game, think and play. */
async function computerMove() {
  if (!game.ai || game.over || review || game.turn !== game.ai.color) return;
  const g = game, turn = ++aiTurn, fen = game.fenAt(game.length);
  const started = Date.now();
  let uci = null;
  try {
    aiEngine = aiEngine || new Engine();
    uci = await aiEngine.play(fen, AI_LEVELS[g.ai.level] || AI_LEVELS.medium);
  } catch {
    if (turn === aiTurn) toast('Stockfish could not start in this browser. Try reloading the page.');
    return;
  }
  // never instant: a short beat makes the reply readable
  const wait = 350 - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  if (turn !== aiTurn || game !== g || g.over || review || g.fenAt(g.length) !== fen || !uci) return;
  if (paused) { paused = false; lastTick = Date.now(); }
  viewPly = g.length;
  applyMove(uci.slice(0, 2), uci.slice(2, 4), uci[4]);
}

/** Same-laptop games: after a move, show the board from the side of whoever moves next. */
function scheduleFlip(delay = 300) {
  clearTimeout(flipTimer);
  if (!settings.autoFlip || review || game.remote || game.ai) return;
  flipTimer = setTimeout(() => {
    if (review || game.remote || !settings.autoFlip || !isLive() || board.orientation === game.turn) return;
    board.flip();
    renderPlayers();
    renderAnalysis();
  }, delay);
}

function onGameOver() {
  persist();
  storage.archive(game.toJSON());
  render();
  const g = game;
  $('#over-title').textContent = g.winnerText();
  $('#over-reason').textContent = g.termination;
  $('#dlg-over').classList.toggle('drawn', g.result === '1/2-1/2');
  $('#dlg-over .over-crown').textContent = g.result === '1-0' ? '♔' : g.result === '0-1' ? '♚' : '½';
  setTimeout(() => {
    if (game !== g || !g.over) return;
    openDialog('#dlg-over');
    if (g.result !== '1/2-1/2' && settings.celebration !== 'none') confetti();
  }, 650);
}

function persist() {
  storage.saveCurrent(game.toJSON());
}

/* ---------------- clocks ---------------- */

setInterval(() => {
  const now = Date.now();
  if (clockRunning()) {
    const c = game.turn;
    game.clocks[c] -= now - lastTick;
    if (game.clocks[c] <= 0) {
      game.clocks[c] = 0;
      game.flag(c);
      publish();
      onGameOver();
    }
    renderClocks();
  }
  lastTick = now;
}, 100);

setInterval(() => { if (clockRunning()) persist(); }, 3000);
addEventListener('pagehide', persist);
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

function togglePause() {
  if (review || game.remote || !game.hasClock || game.over || game.length === 0) return;
  paused = !paused;
  lastTick = Date.now();
  persist();
  render();
  toast(paused ? 'Clocks paused' : 'Clocks running');
}

/* ---------------- game lifecycle ---------------- */

interface NewGame { white: string; black: string; tc: string; remote?: GameData['remote']; ai?: AiSeat | null; id?: string; startedAt?: number }

function startGame({ white, black, tc, remote = null, ai = null, id, startedAt }: NewGame) {
  if (game.length && !game.over) storage.archive(game.toJSON()); // keep unfinished games too
  clearTimeout(flipTimer);
  if (!remote || remote.room !== room?.code) leaveRoom();
  stopAnalysis();
  aiTurn++;
  game = new Game({ white, black, tc, remote, ai, id, startedAt });
  if (remote) { game.white = white; game.black = black; } // an empty seat keeps an empty name
  review = null;
  viewPly = 0;
  paused = false;
  lastTick = Date.now();
  if (!remote && !ai) Object.assign(settings, { white, black, tc });
  storage.saveSettings(settings);
  persist();
  board.setOrientation(homeOrientation());
  setView('game');
  requestWakeLock();
  computerMove();
}

function takeback() {
  if (review || !game.length || game.remote) return;
  clearTimeout(flipTimer);
  aiTurn++;
  game.undo();
  // against the computer, take back its reply too, so it's your move again
  if (game.ai && game.length && game.turn === game.ai.color) game.undo();
  viewPly = game.length;
  lastTick = Date.now();
  persist();
  render();
  scheduleFlip(0);
  toast('Move taken back');
}

function openReview(data) {
  stopAnalysis();
  review = data instanceof Game ? data : new Game(data);
  viewPly = review.length;
  clearTimeout(flipTimer);
  board.setOrientation('w');
  closeDialogs();
  setView('game');
}

function exitReview() {
  stopAnalysis();
  review = null;
  viewPly = game.length;
  board.setOrientation(homeOrientation());
  render();
  computerMove();
}

function goto(ply) {
  const g = active();
  viewPly = Math.max(0, Math.min(g.length, ply));
  render();
  if (isLive()) scheduleFlip(0);
}

/* ---------------- live remote games ---------------- */

/** The full state of the game as the other laptop needs it. */
function snapshot() {
  const r = game.remote;
  return {
    v: 1, g: game.id, st: game.startedAt, tc: game.tc,
    w: game.white, b: game.black, pw: r.pw || '', pb: r.pb || '',
    m: packMoves(game.plies.map((p) => p.san)),
    c: [Math.round(game.clocks.w), Math.round(game.clocks.b)],
    r: game.result, t: game.termination, o: r.offer || null,
  };
}

function publish() {
  if (room && game.remote?.room === room.code) room.publish(snapshot());
}

function connectRoom(code) {
  if (room?.code === code) return;
  leaveRoom();
  room = new Room(code, {
    onSnapshot: onRoomSnapshot,
    onStatus: (n) => { relaysUp = n; renderPlayers(); renderStatus(); renderRoomStatus(); },
  });
  room.connect();
}

function leaveRoom() {
  room?.close();
  room = null;
  relaysUp = 0;
}

function onRoomSnapshot(snap) {
  if (!snap || snap.v !== 1 || !snap.g) return;
  let moves;
  try { moves = unpackMoves(snap.m || ''); } catch { return; }
  if (joining) completeJoin(snap, moves);
  else applySnapshot(snap, moves);
}

const seatOf = (snap) => (snap.pw === settings.pid ? 'w' : snap.pb === settings.pid ? 'b' : null);

/** First snapshot after "Join": take the free seat and set up the game locally. */
function completeJoin(snap, moves) {
  const { code, name } = joining;
  clearTimeout(joining.timer);
  joining = null;
  const me = seatOf(snap) || (!snap.pw ? 'w' : !snap.pb ? 'b' : null);
  if (!me) {
    joinFailed('This game already has two players.');
    return;
  }
  startGame({
    id: snap.g, startedAt: snap.st, tc: snap.tc,
    white: me === 'w' ? name : snap.w, black: me === 'b' ? name : snap.b,
    remote: {
      room: code, me, offer: snap.o || null,
      pw: me === 'w' ? settings.pid : snap.pw, pb: me === 'b' ? settings.pid : snap.pb,
    },
  });
  for (const san of moves) game.moveSan(san);
  if (snap.r && !game.result) game.finish(snap.r, snap.t || 'Game over');
  if (game.hasClock && snap.c) game.clocks = { w: snap.c[0], b: snap.c[1] };
  viewPly = game.length;
  lastTick = Date.now();
  persist();
  publish(); // tells the other laptop we are here, with our name
  closeDialogs();
  render();
  toast(`You play ${colorName(me).toLowerCase()} against ${game.nameOf(other(me)) || 'your colleague'}`);
}

/** Any later snapshot: a move, a draw offer, a result, the colleague joining, or a rematch. */
function applySnapshot(snap, moves) {
  if (!game.remote) return;
  const me = seatOf(snap);
  if (snap.g !== game.id) {
    // a new game in this room (rematch); ignore old snapshots of earlier games
    if (!me || (snap.st || 0) <= game.startedAt) return;
    const r = game.remote;
    startGame({ id: snap.g, startedAt: snap.st, tc: snap.tc, white: snap.w, black: snap.b, remote: { room: r.room, me, pw: snap.pw, pb: snap.pb } });
    toast(`Rematch! You play ${colorName(me).toLowerCase()}.`);
  }
  const r = game.remote;
  const someoneJoined = (!r.pw && snap.pw) || (!r.pb && snap.pb);
  if (snap.pw) r.pw = snap.pw;
  if (snap.pb) r.pb = snap.pb;
  if (snap.w && r.me !== 'w') game.white = snap.w; // the colleague's name; ours stays ours
  if (snap.b && r.me !== 'b') game.black = snap.b;

  const local = game.plies.map((p) => p.san);
  // The game ended on the other laptop (their clock saw ours run out, or they resigned or
  // agreed a draw) while a move of ours was still on its way: the result stands, and the
  // moves we made after it are taken back, so both laptops end on the same position.
  if (snap.r && !game.result && moves.length < local.length && moves.every((s, i) => s === local[i])) {
    while (game.length > moves.length) game.undo();
    game.finish(snap.r, snap.t || 'Game over');
    if (game.hasClock && snap.c) game.clocks = { w: snap.c[0], b: snap.c[1] };
    viewPly = game.length;
    persist();
    publish();
    onGameOver();
    return;
  }
  if (!local.every((s, i) => s === moves[i])) { render(); return; } // an older snapshot: ours is newer
  const wasAtEnd = viewPly === game.length;
  const wasOver = game.over;
  let last = null;
  for (const san of moves.slice(local.length)) last = game.moveSan(san) || last;
  if (snap.r && !game.result) game.finish(snap.r, snap.t || 'Game over');
  r.offer = snap.o || null;
  if (game.hasClock && snap.c && (last || snap.r)) {
    game.clocks = { w: snap.c[0], b: snap.c[1] };
    if (last) last.clock = game.clocks[last.color];
    lastTick = Date.now();
  }
  if (wasAtEnd) viewPly = game.length;
  if (last?.captured) sound.capture();
  persist();
  render();
  if (someoneJoined && r.me) {
    $('#dlg-remote').close(); // the board is what matters now
    toast(`${game.nameOf(other(r.me)) || 'Your colleague'} joined${myTurn() ? '. Your move!' : ''}`);
  }
  if (game.over && !wasOver) onGameOver();
}

/* the "Play a colleague" dialog */

const REMOTE_TCS = ['none', '3+2', '5+0', '10+0', '15+10'];
const shareLink = (code) =>
  /^https?:$/.test(location.protocol) ? `${location.origin}${location.pathname}#${code}` : null;

function setRemotePane(pane) {
  $$('#dlg-remote [data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== pane));
  $$('#remote-tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === pane)));
  $('#remote-tabs').classList.toggle('hidden', pane === 'invite');
  $('#remote-title').textContent = pane === 'invite' ? 'Share this code' : 'Play a colleague';
}
$$('#remote-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => setRemotePane(b.dataset.tab)));

function openRemote(pane = 'create', code = '') {
  $('#remote-create-name').value = $('#remote-join-name').value = settings.myName || '';
  $('#remote-join-code').value = code ? formatRoomCode(code) : '';
  $('#remote-join-error').classList.add('hidden');
  $('#remote-join-btn').disabled = false;
  $('#remote-join-btn').textContent = 'Join game';
  const tc = settings.remoteTc || 'none';
  $('#remote-tc').innerHTML = REMOTE_TCS.map((id) => {
    const t = timeControl(id);
    return `<label class="chip"><input type="radio" name="remote-tc" value="${id}"${id === tc ? ' checked' : ''} /><span>${t.base ? t.label : 'No clock'}</span></label>`;
  }).join('');
  setRemotePane(pane);
  openDialog('#dlg-remote');
  (pane === 'join' && code ? $('#remote-join-name') : pane === 'join' ? $('#remote-join-code') : $('#remote-create-name')).focus();
}

function showInvite() {
  const code = game.remote.room;
  $('#room-code').textContent = formatRoomCode(code);
  $('#room-copy-link').classList.toggle('hidden', !shareLink(code));
  renderRoomStatus();
  setRemotePane('invite');
  if (!$('#dlg-remote').open) openDialog('#dlg-remote');
}

function renderRoomStatus() {
  const el = $('#room-status');
  if (!el || !game.remote) return;
  el.className = 'room-status';
  if (bothSeated()) { el.classList.add('ok'); el.textContent = 'Connected. Game on!'; return; }
  el.innerHTML = relaysUp
    ? '<span class="pulse"></span>Waiting for your colleague…'
    : '<span class="pulse"></span>Connecting…';
}

$('#form-remote-create').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#remote-create-name').value.trim();
  if (!name) return $('#remote-create-name').focus();
  let color = (document.querySelector<HTMLInputElement>('input[name="remote-color"]:checked')?.value || 'w') as Color | 'random';
  if (color === 'random') color = Math.random() < 0.5 ? 'w' : 'b';
  const tc = document.querySelector<HTMLInputElement>('input[name="remote-tc"]:checked')?.value || 'none';
  Object.assign(settings, { myName: name, remoteTc: tc });
  const code = newRoomCode();
  const pid = settings.pid;
  connectRoom(code);
  startGame({
    tc, white: color === 'w' ? name : '', black: color === 'b' ? name : '',
    remote: { room: code, me: color, pw: color === 'w' ? pid : '', pb: color === 'b' ? pid : '' },
  });
  publish();
  showInvite();
});

$('#form-remote-join').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = parseRoomCode($('#remote-join-code').value);
  const name = $('#remote-join-name').value.trim();
  if (!code) return joinError('A code has 6 letters and digits, like K7Q-M2X.');
  if (!name) return $('#remote-join-name').focus();
  if (game.remote?.room === code) { closeDialogs(); return toast('You are already in this game'); }
  settings.myName = name;
  storage.saveSettings(settings);
  $('#remote-join-error').classList.add('hidden');
  $('#remote-join-btn').disabled = true;
  $('#remote-join-btn').textContent = 'Connecting…';
  joining = {
    code, name,
    timer: setTimeout(() => joinFailed(relaysUp
      ? 'No game found with this code. Check it, and ask your colleague to keep Deskmate open.'
      : "Couldn't reach the game servers from this network."), 12000),
  };
  connectRoom(code);
});

function joinError(msg) {
  const err = $('#remote-join-error');
  err.textContent = msg;
  err.classList.remove('hidden');
  $('#remote-join-btn').disabled = false;
  $('#remote-join-btn').textContent = 'Join game';
}

function joinFailed(msg) {
  if (joining) clearTimeout(joining.timer);
  joining = null;
  // go back to the room of the game on the board, if it is a live one
  if (game.remote) connectRoom(game.remote.room); else leaveRoom();
  joinError(msg);
}

$('#room-copy').addEventListener('click', () => copy(formatRoomCode(game.remote.room), 'Code'));
$('#room-copy-link').addEventListener('click', () => copy(shareLink(game.remote.room), 'Link'));
$('#btn-remote').addEventListener('click', () => (game.remote && !game.over && !bothSeated() ? showInvite() : openRemote()));

/* ---------------- post-game analysis (Stockfish) ---------------- */

// depth 16 or one second per position on WebAssembly; the plain-JS fallback is ~25x slower,
// so it gets less depth and less time (a 40-move game then takes about a minute)
const AN_LIMITS = {
  fast: { wasm: { depth: 12, movetime: 400 }, asm: { depth: 9, movetime: 350 } },
  balanced: { wasm: { depth: 16, movetime: 1000 }, asm: { depth: 12, movetime: 700 } },
  deep: { wasm: { depth: 20, movetime: 2500 }, asm: { depth: 14, movetime: 1500 } },
};

/** A finished position needs no engine: mate or draw on the board. */
function terminalEval(fen) {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { mate: 0, winner: c.turn() === 'w' ? 'b' : 'w', pv: [] };
  if (c.isStalemate() || c.isInsufficientMaterial()) return { cp: 0, pv: [], draw: true };
  return null;
}

/** Engine line in readable notation: "14. Nf3 Nc6 15. Bb5 …". */
function pvSan(fen, pv, max = 8) {
  const c = new Chess(fen);
  let n = +fen.split(' ')[5];
  let white = fen.split(' ')[1] === 'w';
  const out = [];
  for (const u of pv.slice(0, max)) {
    let m;
    try { m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { break; }
    out.push(white ? `${n}. ${m.san}` : out.length ? m.san : `${n}… ${m.san}`);
    if (!white) n++;
    white = !white;
  }
  return out.join(' ');
}

async function startAnalysis() {
  setView('game');
  const g = active();
  if (!g.length) return toast('Play some moves first');
  // no engine help while a game is still being played
  if (!g.result && !review) return toast('Analysis opens once the game is over');
  if (an?.game === g) return;
  stopAnalysis();
  const run: { game: Game; evals: Eval[]; summary: ReturnType<typeof summarize> | null; done: boolean; flavor?: string } = { game: g, evals: [], summary: null, done: false };
  an = run;
  render();
  let limits;
  try {
    engine = engine || new Engine();
    limits = (AN_LIMITS[settings.anDepth] || AN_LIMITS.balanced)[await engine.start()];
  } catch {
    if (an === run) { an = null; render(); }
    return toast(location.protocol === 'file:'
      ? 'Analysis needs the hosted page (e.g. abhieq31.com/deskmate), not a downloaded file.'
      : 'Stockfish could not start in this browser (blocked download?). Try reloading the page.');
  }
  if (an !== run) return;
  run.flavor = engine.flavor;
  // the position on screen first, then the whole game from the start
  const order = [viewPly, ...Array.from({ length: g.length + 1 }, (_, i) => i).filter((i) => i !== viewPly)];
  for (const i of order) {
    if (an !== run) return;
    const fen = g.fenAt(i);
    run.evals[i] = terminalEval(fen) || await engine.analyse(fen, limits) || { cp: 0, pv: [], depth: 0 };
    if (an !== run) return;
    run.summary = summarize(run.evals, g.length, g.plies.map((p) => p.from + p.to + (p.promotion || '')));
    renderMoves();
    renderAnalysis();
  }
  run.done = true;
  renderAnalysis();
}

function stopAnalysis() {
  if (!an) return;
  an = null;
  engine?.terminate(); // quickest way to drop a search in progress
  engine = null;
  board.setAutoShapes([]);
}

function renderAnalysis() {
  const g = active();
  const on = !!an && an.game === g;
  $('#analysis').classList.toggle('hidden', !on);
  $('#evalbar').classList.toggle('quiet', !on);
  $$('#board .sq-glyph').forEach((e) => e.remove());
  $('#an-acc').classList.toggle('hidden', !on);
  if (!on) { board.setAutoShapes([]); renderWinBar(); return; }
  $('#evalbar').classList.toggle('hidden', !settings.evalBar);
  const ev = an.evals[viewPly];
  const white = winPct(ev);

  // eval bar: White's share, White's end at White's side of the board
  const bar = $('#evalbar');
  bar.style.setProperty('--w', `${ev ? white : 50}%`);
  bar.classList.toggle('flip', board.orientation === 'b');
  bar.classList.toggle('black-better', white < 50);
  $('#evalbar-num').textContent = ev ? formatEval(ev).replace(/^\+/, '') : '';

  const evEl = $('#an-eval');
  evEl.textContent = formatEval(ev);
  evEl.classList.toggle('black', !!ev && white < 50);
  const fen = g.fenAt(viewPly);
  const evalsDone = an.evals.filter(Boolean).length;
  $('#an-line').textContent = !ev ? `Stockfish is thinking… ${evalsDone}/${g.length + 1}` : ev.pv?.length ? pvSan(fen, ev.pv) : g.result && viewPly === g.length ? g.termination : '';
  const best = ev?.pv?.[0];
  board.setAutoShapes(best && settings.bestArrow ? [{ from: best.slice(0, 2), to: best.slice(2, 4) }] : []);

  // chess.com-style verdict on the move that led here: "Nf6 is a blunder. Best was Qe7."
  const played = g.plies[viewPly - 1];
  const before = an.evals[viewPly - 1];
  const kind = an.summary?.moves[viewPly - 1]?.kind;
  let verdict = '';
  if (played && before && ev) {
    const bestUci = before.pv?.[0];
    const bestSan = bestUci ? pvSan(g.fenAt(viewPly - 1), [bestUci]).replace(/^\d+(\.|…) /, '') : '';
    const isBest = bestUci && bestUci === played.from + played.to + (played.promotion || '');
    const name = esc(played.san);
    if (played.san.endsWith('#')) verdict = `<b class="k-best">${name}</b> is checkmate.`;
    else if (kind) verdict = `<b class="k-${kind}">${name}${MARKS[kind]}</b> is ${kind === 'inaccuracy' ? 'an' : 'a'} ${kind}.${bestSan ? ` Best was <b>${esc(bestSan)}</b>.` : ''}`;
    else if (isBest) verdict = `<b class="k-best">${name}</b> is the best move.`;
    else verdict = `<b>${name}</b> is a good move.${bestSan ? ` The engine prefers <b>${esc(bestSan)}</b>.` : ''}`;
  }
  $('#an-verdict').innerHTML = verdict;
  if (played && kind) {
    const sq = $(`#board .sq[data-sq="${played.to}"]`);
    sq?.insertAdjacentHTML('beforeend', `<span class="sq-glyph k-${kind}">${MARKS[kind]}</span>`);
  }

  renderGraph(g);

  const done = an.evals.filter(Boolean).length;
  $('#an-progress').classList.toggle('done', an.done);
  $('#an-progress span').style.width = `${(done / (g.length + 1)) * 100}%`;

  const sum = an.summary;
  const card = (c) => {
    const s = sum?.[c];
    const acc = s?.accuracy == null ? '…' : `${s.accuracy.toFixed(1)}%`;
    // each count jumps to that player's next move of that kind
    const tally = s ? [['blunder', '??'], ['mistake', '?'], ['inaccuracy', '?!']].map(([k, m]) =>
      `<button class="tk k-${k}" data-color="${c}" data-kind="${k}" ${s[k] ? '' : 'disabled'} title="Next ${k}">${s[k]}${m}</button>`).join('') : '';
    return `<div><small>${esc(g.nameOf(c) || colorName(c))}</small><b>${acc}</b><span class="tally">${tally}</span></div>`;
  };
  $('#an-acc').innerHTML = card('w') + card('b');
}

/** The whole game in the panel, two moves a row, with the analysis marks once there are some. */
function renderAnMoves() {
  const g = active();
  const marks = an && an.game === g ? an.summary?.moves || [] : [];
  const rows = [];
  for (let i = 0; i < g.length; i += 2) {
    const cell = (j) => {
      const p = g.plies[j];
      if (!p) return '<span></span>';
      const k = marks[j]?.kind;
      return `<button class="mv${viewPly === j + 1 ? ' active' : ''}${k ? ` ${k}` : ''}" data-ply="${j + 1}">${san(p.san)}${k ? `<span class="mark">${MARKS[k]}</span>` : ''}</button>`;
    };
    rows.push(`<span class="an-num">${i / 2 + 1}.</span>${cell(i)}${cell(i + 1)}`);
  }
  const list = $('#an-moves');
  list.innerHTML = rows.join('') || '<span class="an-empty">No moves yet</span>';
  // keep the current move in view by scrolling the list itself (never the page)
  const act = list.querySelector('.active');
  if (act) {
    // offsets relative to the list itself (it is positioned), so this never scrolls the page
    const t = act.offsetTop;
    if (t < list.scrollTop) list.scrollTop = t - 8;
    else if (t + act.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = t + act.offsetHeight - list.clientHeight + 8;
  } else if (viewPly === g.length) list.scrollTop = list.scrollHeight;
}

$('#an-moves').addEventListener('click', (e) => { const b = e.target.closest('[data-ply]'); if (b) goto(+b.dataset.ply); });
$('#an-acc').addEventListener('click', (e) => {
  const b = e.target.closest('[data-kind]');
  if (!b || !an?.summary) return;
  const moves = an.summary.moves;
  const mine = (j) => moves[j]?.kind === b.dataset.kind && (j % 2 === 0 ? 'w' : 'b') === b.dataset.color;
  // next one after the move on screen, wrapping round to the first
  let j = moves.findIndex((_, k) => k >= viewPly && mine(k));
  if (j < 0) j = moves.findIndex((_, k) => mine(k));
  if (j >= 0) goto(j + 1);
});

/**
 * The evaluation graph: White's winning chances move by move (white area = White better), drawn at
 * the panel's real pixel size so the marks are round. Coloured dots mark ?? / ? / ?!, the red
 * line is the move on the board; hover shows a move and its evaluation, click jumps to it.
 */
const GRAPH_H = 96;
const MARK_COLOR = { blunder: '#ca3431', mistake: '#e58f2a', inaccuracy: '#f7c045' };
function renderGraph(g: Game) {
  const svg = $('#an-graph') as SVGSVGElement;
  const W = Math.max(120, Math.round(svg.clientWidth || 300)), H = GRAPH_H, n = Math.max(1, g.length);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const x = (i: number) => (i / n) * W;
  const y = (ev: Eval) => H - (winPct(ev) / 100) * (H - 4) - 2; // 2px inset so 0% and 100% stay visible
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= g.length; i++) if (an.evals[i]) pts.push([x(i), y(an.evals[i]), i]);
  const marks = an.summary?.moves || [];
  svg.innerHTML =
    (pts.length > 1 ? `<path class="area" d="M${pts[0][0]},${H} ${pts.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join(' ')} L${pts.at(-1)[0].toFixed(1)},${H} Z"/>` : '') +
    `<line class="mid" x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"/>` +
    `<line class="cur" x1="${x(viewPly)}" y1="0" x2="${x(viewPly)}" y2="${H}"/>` +
    pts.filter(([, , i]) => marks[i - 1]?.kind).map(([px, py, i]) =>
      `<circle class="dot" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="${MARK_COLOR[marks[i - 1].kind]}"/>`).join('') +
    '<line class="hov" x1="-9" y1="0" x2="-9" y2="' + H + '"/>';
}

const graphPly = (e: MouseEvent) => {
  const r = (e.currentTarget as Element).getBoundingClientRect();
  return Math.max(0, Math.min(active().length, Math.round(((e.clientX - r.left) / r.width) * active().length)));
};
$('#an-graph').addEventListener('click', (e: MouseEvent) => goto(graphPly(e)));
$('#an-graph').addEventListener('mousemove', (e: MouseEvent) => {
  if (!an) return;
  const g = active(), i = graphPly(e), ev = an.evals[i];
  const hov = $('#an-graph .hov');
  const px = (i / Math.max(1, g.length)) * Math.max(120, Math.round($('#an-graph').clientWidth || 300));
  hov?.setAttribute('x1', String(px)); hov?.setAttribute('x2', String(px));
  const p = g.plies[i - 1], kind = an.summary?.moves[i - 1]?.kind;
  $('#an-tip').textContent = i === 0 ? `Start · ${formatEval(ev)}` :
    `${Math.ceil(i / 2)}${i % 2 ? '.' : '…'} ${p.san}${kind ? MARKS[kind] : ''} · ${ev ? formatEval(ev) : '…'}`;
});
$('#an-graph').addEventListener('mouseleave', () => { $('#an-tip').textContent = ''; $('#an-graph .hov')?.setAttribute('x1', '-9'); $('#an-graph .hov')?.setAttribute('x2', '-9'); });
addEventListener('resize', () => { if (an) renderAnalysis(); });

/* ---------------- dialogs ---------------- */

function openDialog(sel) {
  const d = $(sel);
  setSidebar(false);
  if (!d.open) d.showModal();
}
function closeDialogs() { $$('dialog[open]').forEach((d) => d.close()); }

$$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
// click on the backdrop closes a dialog
$$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

function openNewGame(prefill?: { white: string; black: string; tc: string }) {
  const p = prefill || (game.remote ? { white: settings.white, black: settings.black, tc: settings.tc } : { white: game.white, black: game.black, tc: game.tc });
  $('#new-white').value = p.white;
  $('#new-black').value = p.black;
  const grid = $('#tc-grid');
  grid.innerHTML = TIME_CONTROLS.map((t) => `
    <label class="tc${t.id === p.tc ? ' checked' : ''}">
      <input type="radio" name="tc" value="${t.id}"${t.id === p.tc ? ' checked' : ''} />
      <strong>${t.base ? t.label : '∞'}</strong><small>${t.moment}</small>
    </label>`).join('');
  openDialog('#dlg-new');
}

$('#tc-grid').addEventListener('change', (e) => {
  $$('#tc-grid .tc').forEach((l) => l.classList.toggle('checked', l.querySelector('input') === e.target));
});
$('#new-swap').addEventListener('click', () => {
  const w = $('#new-white').value;
  $('#new-white').value = $('#new-black').value;
  $('#new-black').value = w;
});
$('#form-new').addEventListener('submit', () => {
  startGame({
    white: $('#new-white').value.trim() || 'White',
    black: $('#new-black').value.trim() || 'Black',
    tc: document.querySelector<HTMLInputElement>('#tc-grid input:checked')?.value || 'none',
  });
});

function renderArchive() {
  const list = storage.loadArchive();
  const ul = $('#archive-list');
  if (!list.length) {
    ul.innerHTML = '<li class="empty">No saved games yet. Finished games appear here automatically.</li>';
    return;
  }
  ul.innerHTML = list.map((g) => {
    const d = new Date(g.endedAt || g.startedAt);
    const res = g.result ? g.result.replace(/1\/2/g, '½') : 'unfinished';
    const cls = g.result === '1-0' ? 'w' : g.result === '0-1' ? 'b' : g.result ? 'd' : 'u';
    return `<li data-id="${g.id}">
      <span class="res ${cls}">${res}</span>
      <span class="who"><strong>${esc(g.white || '?')}</strong> vs <strong>${esc(g.black || '?')}</strong>
        <small>${esc(g.termination || 'In progress')} · ${Math.ceil(g.moves.length / 2)} moves · ${d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</small></span>
      <span class="acts">
        ${g.result ? '' : '<button class="btn small" data-act="resume">Resume</button>'}
        <button class="btn small" data-act="review">Review</button>
        <button class="btn small icon-only" data-act="pgn" title="Download PGN" aria-label="Download PGN"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></button>
        <button class="btn small icon-only danger ghost" data-act="del" title="Delete" aria-label="Delete"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg></button>
      </span></li>`;
  }).join('');
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

$('#archive-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('li').dataset.id;
  const data = storage.loadArchive().find((g) => g.id === id);
  if (!data) return;
  const act = btn.dataset.act;
  if (act === 'review') openReview(data);
  else if (act === 'pgn') download(new Game(data));
  else if (act === 'del') { storage.removeFromArchive(id); renderArchive(); }
  else if (act === 'resume') {
    if (game.length && !game.over && game.id !== id) storage.archive(game.toJSON());
    storage.removeFromArchive(id);
    game = new Game(data);
    review = null;
    viewPly = game.length;
    paused = game.hasClock && game.length > 0 && !game.remote;
    if (game.remote) connectRoom(game.remote.room); else leaveRoom();
    persist();
    closeDialogs();
    board.setOrientation(homeOrientation());
    setView('game');
  }
});

$('#archive-clear').addEventListener('click', () => {
  if (confirm('Delete all saved games from this browser?')) { storage.clearArchive(); renderArchive(); }
});
$('#archive-export').addEventListener('click', () => {
  const list = storage.loadArchive();
  if (!list.length) return toast('Nothing to export');
  saveFile(`deskmate-games-${Date.now()}.pgn`, list.map((g) => new Game(g).pgn()).join('\n'));
});

/* ---------------- export helpers ---------------- */

function saveFile(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-chess-pgn' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function download(g) {
  const slug = (s) => (s || '').replace(/[^\w-]+/g, '_').slice(0, 20);
  saveFile(`${slug(g.white)}_vs_${slug(g.black)}_${new Date(g.startedAt).toISOString().slice(0, 10)}.pgn`, g.pgn());
}

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch {
    prompt(`Copy the ${what}:`, text); // clipboard blocked: let the user copy by hand
  }
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------------- wake lock: keep the screen on during a game ---------------- */

let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock && !document.hidden) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* not allowed: fine */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) requestWakeLock(); });

/* ---------------- buttons & keyboard ---------------- */

$('#btn-new').addEventListener('click', () => openNewGame());
$('#btn-archive').addEventListener('click', () => { renderArchive(); openDialog('#dlg-archive'); });
$('#btn-help').addEventListener('click', () => openDialog('#dlg-help'));
$('#btn-settings').addEventListener('click', openSettings);
$('#btn-analyse').addEventListener('click', () => startAnalysis());
$$('.act-analyse').forEach((b) => b.addEventListener('click', () => startAnalysis()));
$('#over-analyse').addEventListener('click', () => { $('#dlg-over').close(); startAnalysis(); });
$('[data-nav="prev"]').addEventListener('click', () => goto(viewPly - 1));
$('[data-nav="next"]').addEventListener('click', () => goto(viewPly + 1));
$$('.act-pause').forEach((b) => b.addEventListener('click', togglePause));
$('#btn-flip2').addEventListener('click', () => $('#btn-flip').click());
$('#btn-flip3').addEventListener('click', () => $('#btn-flip').click());
$('#btn-sound').addEventListener('click', () => {
  settings.sound = !settings.sound;
  storage.saveSettings(settings);
  applyPrefs();
  renderControls();
  toast(settings.sound ? 'Sound on' : 'Sound off');
});
$('#focus-close').addEventListener('click', toggleFocus);
$$('.act-newgame').forEach((b) => b.addEventListener('click', () => {
  if (review) exitReview();
  if (game.ai) openComputer(); else if (game.remote) openRemote('create'); else openNewGame();
}));
$$('.act-rematch').forEach((b) => b.addEventListener('click', () => $('#over-rematch').click()));

// the corner handle: drag to make the board smaller or larger (up to what fits), double-click to reset
{
  const handle = $('#board-resize');
  let start: { x: number; y: number; size: number } | null = null;
  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, size: $('.board-frame').getBoundingClientRect().width };
  });
  handle.addEventListener('pointermove', (e: PointerEvent) => {
    if (!start) return;
    const size = Math.round(Math.max(280, start.size + Math.max(e.clientX - start.x, e.clientY - start.y)));
    settings.boardSize = size;
    applyPrefs();
  });
  const end = () => {
    if (!start) return;
    start = null;
    // never store more than fits: past that the board just stays as large as it can be
    const fits = $('.board-frame').getBoundingClientRect().width;
    if (settings.boardSize > fits) settings.boardSize = 0;
    storage.saveSettings(settings);
    applyPrefs();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', () => { settings.boardSize = 0; storage.saveSettings(settings); applyPrefs(); });
}
$('#btn-flip').addEventListener('click', () => { clearTimeout(flipTimer); board.flip(); renderPlayers(); renderAnalysis(); });
$('#btn-undo').addEventListener('click', takeback);

$$('.act-draw').forEach((b) => b.addEventListener('click', () => {
  const r = game.remote;
  const opp = r && (game.nameOf(other(r.me)) || 'your colleague');
  const theyOffer = r && r.offer === other(r.me);
  $('#draw-title').textContent = !r ? 'Agree to a draw?' : theyOffer ? `Accept ${opp}'s draw offer?` : `Offer ${opp} a draw?`;
  $('#draw-sub').textContent = !r ? 'Both players should agree before confirming.'
    : theyOffer ? 'The game ends as a draw.' : 'They can accept it, or decline by making a move.';
  $('#draw-confirm').textContent = r && !theyOffer ? 'Offer draw' : 'Draw';
  openDialog('#dlg-draw');
}));
$('#draw-confirm').addEventListener('click', () => {
  $('#dlg-draw').close();
  if (game.over) return;
  const r = game.remote;
  if (r && r.offer !== other(r.me)) {
    r.offer = r.me;
    persist();
    publish();
    render();
    toast('Draw offered');
    return;
  }
  game.agreeDraw();
  publish();
  onGameOver();
});
$$('.act-resign').forEach((b) => b.addEventListener('click', () => {
  $('#resign-w span').textContent = `${game.white || 'White'} resigns`;
  $('#resign-b span').textContent = `${game.black || 'Black'} resigns`;
  // in a remote game, or against the computer, you can only resign for yourself
  const me = game.remote?.me || (game.ai && other(game.ai.color));
  $('#resign-w').classList.toggle('hidden', me === 'b');
  $('#resign-b').classList.toggle('hidden', me === 'w');
  openDialog('#dlg-resign');
}));
for (const c of ['w', 'b'] as const) {
  $(`#resign-${c}`).addEventListener('click', () => {
    $('#dlg-resign').close();
    if (game.over) return;
    game.resign(c);
    publish();
    onGameOver();
  });
}

$('#over-rematch').addEventListener('click', () => {
  $('#dlg-over').close();
  const r = game.remote;
  if (r && r.me) {
    // same room, colours swapped; the other laptop picks the new game up from the room
    startGame({ white: game.black, black: game.white, tc: game.tc, remote: { room: r.room, me: other(r.me), pw: r.pb, pb: r.pw } });
    publish();
    toast(`Rematch: you play ${colorName(game.remote.me).toLowerCase()}`);
    return;
  }
  const ai = game.ai && { color: other(game.ai.color), level: game.ai.level };
  startGame({ white: game.black, black: game.white, tc: game.tc, ai });
  toast('Colours swapped. Good luck!');
});
$('#over-new').addEventListener('click', () => { $('#dlg-over').close(); game.ai ? openComputer() : openNewGame(); });
$('#over-review').addEventListener('click', () => { $('#dlg-over').close(); goto(0); toast('Use ← → to step through the game'); });
$('#over-pgn').addEventListener('click', () => download(game));

$('#nav-first').addEventListener('click', () => goto(0));
$('#focus-prev').addEventListener('click', () => goto(viewPly - 1));
$('#focus-next').addEventListener('click', () => goto(viewPly + 1));
$('#nav-prev').addEventListener('click', () => goto(viewPly - 1));
$('#nav-next').addEventListener('click', () => goto(viewPly + 1));
$('#nav-last').addEventListener('click', () => goto(active().length));
$('#moves').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ply]');
  if (b) goto(+b.dataset.ply);
});
$('#review-exit').addEventListener('click', () => (review ? exitReview() : goto(game.length)));

$('#btn-pgn-copy').addEventListener('click', () => copy(active().pgn(), 'PGN'));
$('#btn-pgn-download').addEventListener('click', () => download(active()));
$('#btn-fen').addEventListener('click', () => copy(active().fenAt(viewPly), 'FEN'));

document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, textarea') || $$('dialog[open]').length) return;
  if (e.key === 'Escape') { board.cancel(); return setSidebar(false); }
  const k = e.key;
  if (k === 'ArrowLeft') goto(viewPly - 1);
  else if (k === 'ArrowRight') goto(viewPly + 1);
  else if (k === 'ArrowUp') goto(0);
  else if (k === 'ArrowDown') goto(active().length);
  else if (k === 'f' || k === 'F') $('#btn-flip').click();
  else if (k === ' ') togglePause();
  else if ((e.ctrlKey || e.metaKey) && k === 'z') takeback();
  else if (k === 'n' || k === 'N') openNewGame();
  else if (k === 'h' || k === 'H') $('#btn-archive').click();
  else if (k === 'm' || k === 'M') setSidebar(!$('#sidebar').classList.contains('open'));
  else if (k === 'z' || k === 'Z') toggleFocus();
  else if (k === '?') openDialog('#dlg-help');
  else return;
  e.preventDefault();
});

/* ---------------- settings ---------------- */

/* ---------------- settings: edited on a copy, applied on Save ---------------- */

const setInputs = () => $$('#form-settings [data-set]') as (HTMLInputElement | HTMLSelectElement)[];
let themeBefore = settings.theme; // to undo the live preview on Cancel
let settingsSaved = false;

function openSettings() {
  for (const el of setInputs()) {
    const v = settings[el.dataset.set];
    if (el instanceof HTMLInputElement) el.checked = el.hasAttribute('data-invert') ? !v : !!v;
    else el.value = String(v);
  }
  themeBefore = settings.theme;
  settingsSaved = false;
  showSettingsTab('board');
  openDialog('#dlg-settings');
}

function showSettingsTab(tab: string) {
  $$('#dlg-settings [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $$('#dlg-settings [data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== tab));
}
$$('#dlg-settings [data-tab]').forEach((b) => b.addEventListener('click', () => showSettingsTab(b.dataset.tab)));

$('#form-settings').addEventListener('submit', () => {
  settingsSaved = true;
  for (const el of setInputs()) {
    const key = el.dataset.set;
    settings[key] = el instanceof HTMLInputElement ? (el.hasAttribute('data-invert') ? !el.checked : el.checked)
      : el.dataset.kind === 'bool' ? el.value === 'true' : el.value;
  }
  storage.saveSettings(settings);
  applyPrefs();
  applyFocus();
  render();
  if (settings.autoFlip) scheduleFlip(0);
});
// closed any way but Save (Cancel, Esc, a click outside): undo the colour preview
$('#set-cancel').addEventListener('click', () => $('#dlg-settings').close());
$('#dlg-settings').addEventListener('close', () => { if (!settingsSaved) { settings.theme = themeBefore; applyPrefs(); } });

// the board colours preview at once; Save keeps them, Cancel puts the old ones back
$$('.swatch').forEach((s) => s.addEventListener('click', () => {
  settings.theme = s.dataset.theme;
  applyPrefs();
}));

const ANIM_MS = { none: 0, fast: 90, medium: 150, slow: 260 };

function applyPrefs() {
  board.setPrefs({
    showDests: settings.showDests, coords: settings.coords, highlightLast: settings.highlightLast,
    moveMethod: settings.moveMethod,
  });
  $('#board').style.setProperty('--piece-ms', `${ANIM_MS[settings.animation] ?? 150}ms`);
  $('.game').style.setProperty('--board-user', settings.boardSize ? `${settings.boardSize}px` : '');
  sound.setEnabled(settings.sound);
  $('#board').dataset.theme = settings.theme;
  $$('.swatch').forEach((s) => s.setAttribute('aria-checked', String(s.dataset.theme === settings.theme)));
}


/* ---------------- sidebar ---------------- */

function setSidebar(open) {
  $('#sidebar').classList.toggle('open', open);
  $('#sb-backdrop').classList.toggle('open', open);
  $('#sb-toggle').setAttribute('aria-expanded', String(open));
  $('#sb-toggle').title = open ? 'Collapse menu' : 'Expand menu';
  $('#sb-toggle span').textContent = open ? 'Collapse' : 'Expand';
}
$('#sb-toggle').addEventListener('click', () => setSidebar(!$('#sidebar').classList.contains('open')));
$('#btn-sidebar').addEventListener('click', () => setSidebar(true));
$('#sb-backdrop').addEventListener('click', () => setSidebar(false));
// after picking something from the menu, fold it away again
$$('#sidebar .sb-item:not(.sb-toggle)').forEach((b) => b.addEventListener('click', () => setSidebar(false)));

/* ---------------- home page & focus mode ---------------- */

const inProgress = () => !game.over && (game.length > 0 || !!game.remote);

function setView(v) {
  view = v;
  document.body.dataset.view = v;
  if (v === 'home') renderHome();
  else render();
}

/** Focus mode (on by default): only the board, the players and their clocks while you play. */
function applyFocus() {
  document.body.classList.toggle('focus', view === 'game' && settings.focus && !an);
  const b = $('#btn-focus');
  b.title = settings.focus ? 'Show menu and moves (Z)' : 'Hide menu and moves (Z)';
  b.setAttribute('aria-pressed', String(!!settings.focus));
}

function toggleFocus() {
  settings.focus = !settings.focus;
  storage.saveSettings(settings);
  applyFocus();
}

function renderHome() {
  const resume = inProgress();
  $('#home-resume').classList.toggle('hidden', !resume);
  if (resume) {
    $('#home-resume-sub').textContent = `${game.white || 'White'} vs ${game.black || 'Black'}` +
      (game.remote ? ` · live, code ${formatRoomCode(game.remote.room)}` : ` · ${Math.ceil(game.length / 2)} moves`);
  }
  const list = storage.loadArchive().slice(0, 5);
  $('#home-games').innerHTML = list.length ? list.map((g) => {
    const res = g.result ? g.result.replace(/1\/2/g, '½') : 'unfinished';
    const cls = g.result === '1-0' ? 'w' : g.result === '0-1' ? 'b' : g.result ? 'd' : 'u';
    const d = new Date(g.endedAt || g.startedAt);
    return `<li data-id="${g.id}"><span class="res ${cls}">${res}</span>
      <span class="who">${esc(g.white || '?')} vs ${esc(g.black || '?')}<small>${esc(g.termination || 'In progress')} · ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small></span>
      <span class="acts"><button class="btn small" data-act="review">Review</button>${g.result ? '<button class="btn small" data-act="analyse">Analyse</button>' : ''}</span></li>`;
  }).join('') : '<li class="empty">Your finished games will appear here.</li>';
  renderOffice();
}

/** The office table: everyone who has played on this laptop, best score first. */
function renderOffice() {
  const rows = standings(storage.loadArchive()).slice(0, 8);
  $('#home-office').classList.toggle('hidden', !rows.length);
  $('#office-table').innerHTML = rows.map((r, i) => `<tr><td class="rk">${i + 1}</td><td class="nm">${esc(r.name)}</td>` +
    `<td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td class="pts">${String(r.score).replace('.5', '½')}</td></tr>`).join('');
}

$('#home-games').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const data = storage.loadArchive().find((g) => g.id === btn.closest('li').dataset.id);
  if (!data) return;
  openReview(data);
  if (btn.dataset.act === 'analyse') startAnalysis();
});
$('#home-colleague').addEventListener('click', () => openRemote('create'));
$('#home-join').addEventListener('click', () => openRemote('join'));
$('#home-local').addEventListener('click', () => openNewGame());
$('#home-resume').addEventListener('click', () => setView('game'));
$('#home-ai').addEventListener('click', openComputer);

const AI_TCS = ['none', '5+0', '10+5', '15+10'];
function openComputer() {
  $('#ai-name').value = settings.myName || '';
  const tc = settings.aiTc || 'none';
  $('#ai-tc').innerHTML = AI_TCS.map((id) => {
    const t = timeControl(id);
    return `<label class="chip"><input type="radio" name="ai-tc" value="${id}"${id === tc ? ' checked' : ''} /><span>${t.base ? t.label : 'No clock'}</span></label>`;
  }).join('');
  const lv = $(`input[name="ai-level"][value="${settings.aiLevel || 'medium'}"]`);
  if (lv) lv.checked = true;
  openDialog('#dlg-ai');
}
$('#form-ai').addEventListener('submit', () => {
  const name = $('#ai-name').value.trim() || 'You';
  const level = (document.querySelector<HTMLInputElement>('input[name="ai-level"]:checked')?.value || 'medium') as AiSeat['level'];
  const tc = document.querySelector<HTMLInputElement>('input[name="ai-tc"]:checked')?.value || 'none';
  let me = (document.querySelector<HTMLInputElement>('input[name="ai-color"]:checked')?.value || 'w') as Color | 'random';
  if (me === 'random') me = Math.random() < 0.5 ? 'w' : 'b';
  Object.assign(settings, { aiLevel: level, aiTc: tc, ...(name !== 'You' ? { myName: name } : {}) });
  const bot = aiName(level);
  startGame({ white: me === 'w' ? name : bot, black: me === 'b' ? name : bot, tc, ai: { color: other(me), level } });
});
$('#home-all').addEventListener('click', () => { renderArchive(); openDialog('#dlg-archive'); });
$('#sb-home').addEventListener('click', (e) => { e.preventDefault(); setSidebar(false); setView('home'); });
$('#btn-focus').addEventListener('click', toggleFocus);

/* ---------------- boot ---------------- */

applyPrefs();
board.setOrientation(homeOrientation());
setView(inProgress() ? 'game' : 'home');
if (game.remote) connectRoom(game.remote.room);
computerMove(); // a restored game against the computer, with the computer to move

// …/deskmate?debug-input shows the last pointer events on screen, to diagnose drag problems on a
// device we can't test (e.g. a trackpad's tap-to-drag)
if (new URLSearchParams(location.search).has('debug-input')) {
  const box = document.body.appendChild(document.createElement('pre'));
  box.className = 'input-log';
  const lines: string[] = [];
  let lastMove = '';
  const log = (e: PointerEvent | MouseEvent) => {
    const p = e as PointerEvent;
    const line = `${e.type.padEnd(18)} ${p.pointerType ?? ''} button=${e.button} buttons=${e.buttons} detail=${e.detail} ${Math.round(e.clientX)},${Math.round(e.clientY)}`;
    // moves only when something other than the position changes
    if (e.type.endsWith('move')) { const key = `${e.type} ${p.pointerType} ${e.buttons}`; if (key === lastMove) return; lastMove = key; }
    lines.push(line);
    box.textContent = lines.slice(-16).join('\n');
  };
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture', 'mousedown', 'mouseup', 'click', 'dblclick'])
    addEventListener(t, log as EventListener, true);
}

// a shared link (…/deskmate#K7QM2X) opens "Join with a code" with the code filled in
const linkCode = parseRoomCode(location.hash);
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
if (linkCode && linkCode !== game.remote?.room) openRemote('join', linkCode);
else if (paused) toast('Game restored, clocks paused');

// the single-file build (deskmate.html) has no sw.js next to it, wherever it is hosted
const singleFile = document.documentElement.hasAttribute('data-single-file');
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !singleFile) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
