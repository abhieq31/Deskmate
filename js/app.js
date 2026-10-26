// Deskmate application controller: wires the game model, board, clocks, storage and UI.
import { Game, TIME_CONTROLS, checkSquare, material } from './game.js';
import { Board } from './board.js';
import { storage } from './storage.js';
import { sound } from './sound.js';
import { confetti } from './confetti.js';
import { encodeCode, decodeCode, compareToLocal, hasCode } from './remote.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const other = (c) => (c === 'w' ? 'b' : 'w');
const colorName = (c) => (c === 'w' ? 'White' : 'Black');

const settings = storage.loadSettings();
let game = restoreGame();
let viewPly = game.length;
let review = null; // a read-only Game opened from saved games / import
let paused = game.hasClock && game.length > 0 && !game.over; // resume deliberately after a reload
let lastTick = Date.now();
let flipTimer = null;

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
// in a remote game this browser only moves its own colour
const myTurn = () => !game.remote || game.turn === game.remote.me;
const homeOrientation = () => (game.remote ? game.remote.me : settings.autoFlip ? game.turn : 'w');

/* ---------------- rendering ---------------- */

function render() {
  const g = active();
  const fen = g.fenAt(viewPly);
  const live = isLive();
  board.set({
    fen,
    lastMove: g.lastMoveAt(viewPly),
    check: checkSquare(fen),
    dests: live && !g.over && myTurn() ? g.dests() : new Map(),
    movable: live && !g.over && myTurn() ? g.turn : null,
  });
  renderPlayers();
  renderMoves();
  renderStatus();
  renderControls();
}

function renderPlayers() {
  const g = active();
  const fen = g.fenAt(viewPly);
  const mat = material(fen);
  const bottom = board.orientation, top = other(bottom);
  const turn = fen.split(' ')[1];
  const atEnd = viewPly === g.length;
  const inCheck = !!checkSquare(fen);
  for (const [id, color] of [['#player-top', top], ['#player-bottom', bottom]]) {
    const card = $(id);
    card.dataset.color = color;
    card.querySelector('[data-name]').textContent = g.nameOf(color) + (g.remote?.me === color ? ' (you)' : '');
    const m = mat[color];
    card.querySelector('[data-material]').innerHTML =
      m.pieces.map((r) => `<i class="pc ${other(color)}${r.toUpperCase()}"></i>`).join('') +
      (m.score ? `<b>+${m.score}</b>` : '');
    const toMove = !g.over && turn === color && atEnd;
    const won = g.result === (color === 'w' ? '1-0' : '0-1');
    const offers = !g.over && g.remote?.offer === color;
    card.classList.toggle('to-move', toMove);
    card.classList.toggle('winner', won);
    card.classList.toggle('offer', offers);
    card.querySelector('[data-status]').textContent = playerStatus(g, color, { toMove, won, offers, inCheck: inCheck && turn === color });
  }
  renderClocks();
}

/** One short line under a player's name: whose turn it is, check, draw offers, the result. */
function playerStatus(g, color, { toMove, won, offers, inCheck }) {
  if (g.result) return won ? `♛ Won · ${g.termination}` : g.result === '1/2-1/2' ? `½ Draw · ${g.termination}` : '';
  if (offers) return 'Offers a draw';
  if (inCheck && toMove) return 'Check!';
  if (!toMove) return '';
  if (!g.remote || review) return 'To move';
  return color === g.remote.me ? 'Your move' : 'Waiting for their code…';
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
    const time = clock.querySelector('[data-time]');
    clock.dataset.color = color;
    clock.classList.toggle('active', !g.over && g.turn === color);
    clock.classList.toggle('unlimited', !g.hasClock);
    clock.setAttribute('aria-label', `${g.nameOf(color)}'s clock`);
    if (!g.hasClock) {
      time.textContent = '∞';
      clock.classList.remove('running', 'low', 'paused');
      continue;
    }
    const ms = g.clocks[color];
    time.textContent = fmtClock(ms);
    clock.classList.toggle('running', !review && clockRunning() && game.turn === color);
    clock.classList.toggle('low', ms < 20000 && !review);
    clock.classList.toggle('paused', !review && paused && game.turn === color && game.length > 0 && !game.over);
  }
}

function renderMoves() {
  const g = active();
  const list = $('#moves');
  const parts = [];
  for (let i = 0; i < g.plies.length; i += 2) {
    const w = g.plies[i], b = g.plies[i + 1];
    parts.push(`<li><span class="idx">${i / 2 + 1}</span>` +
      `<button class="mv${viewPly === i + 1 ? ' active' : ''}" data-ply="${i + 1}">${san(w.san)}</button>` +
      (b ? `<button class="mv${viewPly === i + 2 ? ' active' : ''}" data-ply="${i + 2}">${san(b.san)}</button>` : '<span></span>') +
      '</li>');
  }
  if (!g.plies.length) parts.push('<li class="empty">Make the first move, White. Good luck!</li>');
  list.innerHTML = parts.join('');
  const act = list.querySelector('.active');
  if (act) act.scrollIntoView({ block: 'nearest' });
  else if (viewPly === 0) list.scrollTop = 0;

  const rl = $('#result-line');
  rl.classList.toggle('hidden', !g.result);
  if (g.result) rl.innerHTML = `<strong>${g.result.replace('1/2', '½').replace('1/2', '½')}</strong><span>${g.termination} · ${g.winnerText()}</span>`;
}

// SAN with figurine piece letters, like lichess's "figurine notation"
const FIG = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const san = (s) => s.replace(/[KQRBN]/g, (c) => `<span class="fig">${FIG[c]}</span>`);

function renderStatus() {
  const g = active();
  const tc = g.tcInfo;
  $('#tc-badge').textContent = tc.base ? `${tc.label} · ${tc.kind}` : 'Unlimited';
  $('#game-date').textContent = new Date(g.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  let title, sub;
  if (g.result) {
    title = g.winnerText();
    sub = g.termination;
  } else if (review) {
    title = 'Reviewing game';
    sub = `${g.white} vs ${g.black}`;
  } else if (game.remote) {
    const me = game.remote.me, opp = game.nameOf(other(me));
    if (game.turn === me) {
      title = game.chess.inCheck() ? 'Check! Your move' : 'Your move';
      sub = game.remote.offer === other(me)
        ? `${opp} offers a draw: accept with ½, or decline by making a move.`
        : `You play ${colorName(me).toLowerCase()}. Make your move, then send the code to ${opp}.`;
    } else {
      title = `Waiting for ${opp}`;
      sub = `When ${opp} sends a code, paste it anywhere on this page (Ctrl+V).`;
    }
  } else {
    const turn = game.turn;
    title = `${game.nameOf(turn)} to move`;
    if (game.chess.inCheck()) title = `Check! ${title}`;
    sub = paused && game.length > 0 && game.hasClock
      ? 'Clocks paused — make a move or press Space to resume.'
      : settings.autoFlip ? 'Pass the device: the board turns to face whoever is to move.' : `Playing as ${colorName(turn).toLowerCase()}.`;
  }
  $('#status-text').textContent = title;
  $('#status-sub').textContent = sub;
  document.title = g.result ? `${g.winnerText()} · Deskmate` : review ? 'Review · Deskmate' : `${colorName(game.turn)} to move · Deskmate`;

  const banner = $('#review-banner');
  const showBanner = !!review || viewPly !== game.length;
  banner.classList.toggle('hidden', !showBanner);
  if (review) $('#review-text').textContent = `Reviewing ${review.white} vs ${review.black}${review.result ? ` · ${review.result}` : ''}`;
  else if (showBanner) $('#review-text').textContent = `Viewing move ${Math.ceil(viewPly / 2) || 0}${viewPly % 2 ? '' : viewPly ? '…' : ''} — the game is paused here`;
  $('#review-exit').textContent = review ? 'Back to live game' : 'Back to current move';
}

const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg><span>Pause</span>';
const ICON_RESUME = '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg><span>Resume</span>';

function renderControls() {
  const g = active();
  $('#nav-first').disabled = $('#nav-prev').disabled = viewPly === 0;
  $('#nav-next').disabled = $('#nav-last').disabled = viewPly === g.length;
  const liveGame = !review;
  $('#btn-undo').disabled = !liveGame || game.length === 0 || !!game.remote;
  const noActions = !liveGame || game.over || game.length === 0;
  const theyOffer = game.remote && !game.over && game.remote.offer === other(game.remote.me);
  const drawTitle = game.remote ? (theyOffer ? 'Accept the draw offer' : 'Offer a draw') : 'Agree to a draw';
  // the right column has Draw/Resign; on phones the toolbar carries copies of them
  for (const id of ['#btn-draw', '#tb-draw']) {
    $(id).disabled = noActions;
    $(id).classList.toggle('offer', !!theyOffer);
    $(id).title = drawTitle;
  }
  $('#btn-resign').disabled = $('#tb-resign').disabled = noActions;
  renderRemoteCard();
  const pauseBtn = $('#btn-pause');
  pauseBtn.classList.toggle('hidden', !game.hasClock || !liveGame || !!game.remote);
  pauseBtn.disabled = game.over || game.length === 0;
  pauseBtn.innerHTML = paused ? ICON_RESUME : ICON_PAUSE;
  pauseBtn.title = paused ? 'Resume clocks (Space)' : 'Pause clocks (Space)';
  const codeBtn = $('#btn-code');
  codeBtn.classList.toggle('hidden', !game.remote || !liveGame);
  codeBtn.classList.toggle('attn', !!game.remote && !game.over && !myTurn());
}

/* ---------------- moves ---------------- */

async function onMove(from, to) {
  if (!isLive() || game.over) return;
  let promotion;
  if (game.isPromotion(from, to)) {
    promotion = await board.askPromotion(to, game.turn);
    if (!promotion) { render(); return; }
  }
  const mover = game.turn;
  const now = Date.now();
  const ply = game.move(from, to, promotion);
  if (!ply) { render(); return; }

  if (game.remote) game.remote.offer = null; // moving declines a pending offer
  if (game.hasClock) {
    if (game.length > 1 && !paused) game.clocks[mover] -= now - lastTick;
    if (game.length > 1) game.clocks[mover] += game.tcInfo.inc * 1000;
    paused = false;
    lastTick = now;
  }
  viewPly = game.length;

  if (game.over) sound.end();
  else if (ply.san.includes('+')) sound.check();
  else if (ply.captured) sound.capture();
  else sound.move();

  persist();
  render();
  if (game.over) onGameOver(true);
  else if (game.remote) openSend();
  else scheduleFlip();
}

function scheduleFlip(delay = 380) {
  clearTimeout(flipTimer);
  if (!settings.autoFlip || review || game.remote) return;
  flipTimer = setTimeout(async () => {
    if (review || game.remote || !settings.autoFlip || board.orientation === game.turn) return;
    if (board.busy) return scheduleFlip(200);
    await board.flip();
    renderPlayers();
  }, delay);
}

/** @param {boolean} [byMe] the game ended by an action in this browser (matters for remote games) */
function onGameOver(byMe = false) {
  persist();
  storage.archive(game.toJSON());
  render();
  const g = game;
  $('#over-code').classList.toggle('hidden', !g.remote);
  if (g.remote && byMe) {
    // the opponent only learns the result from our code, so lead with that
    openSend();
    if (g.result !== '1/2-1/2') confetti();
    return;
  }
  $('#over-title').textContent = g.winnerText();
  $('#over-reason').textContent = g.termination;
  $('#dlg-over').classList.toggle('drawn', g.result === '1/2-1/2');
  $('#dlg-over .over-crown').textContent = g.result === '1-0' ? '♔' : g.result === '0-1' ? '♚' : '½';
  setTimeout(() => {
    if (game !== g || !g.over) return;
    openDialog('#dlg-over');
    if (g.result !== '1/2-1/2') confetti();
  }, 650);
}

function persist() {
  storage.saveCurrent(game.toJSON());
}

/* ---------------- clocks ---------------- */

let lowWarned = { w: false, b: false };
setInterval(() => {
  const now = Date.now();
  if (clockRunning()) {
    const c = game.turn;
    game.clocks[c] -= now - lastTick;
    if (game.clocks[c] < 10000 && !lowWarned[c]) { lowWarned[c] = true; sound.lowTime(); }
    if (game.clocks[c] <= 0) {
      game.clocks[c] = 0;
      game.flag(c);
      sound.end();
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
  if (review || !game.hasClock || game.over || game.length === 0) return;
  paused = !paused;
  lastTick = Date.now();
  persist();
  render();
  toast(paused ? 'Clocks paused' : 'Clocks running');
}

/* ---------------- game lifecycle ---------------- */

function startGame({ white, black, tc, remote = null, id }) {
  if (game.length && !game.over) storage.archive(game.toJSON()); // keep unfinished games too
  clearTimeout(flipTimer);
  game = new Game({ white, black, tc, remote, id });
  review = null;
  viewPly = 0;
  paused = false;
  lowWarned = { w: false, b: false };
  lastTick = Date.now();
  if (!remote) Object.assign(settings, { white, black, tc });
  storage.saveSettings(settings);
  persist();
  board.setOrientation(homeOrientation());
  render();
  requestWakeLock();
}

function takeback() {
  if (review || !game.length) return;
  if (game.remote) return toast('Takebacks are not available in remote games');
  clearTimeout(flipTimer);
  game.undo();
  viewPly = game.length;
  lastTick = Date.now();
  persist();
  render();
  scheduleFlip(120);
  toast('Move taken back');
}

function openReview(data) {
  review = data instanceof Game ? data : new Game(data);
  viewPly = review.length;
  clearTimeout(flipTimer);
  board.setOrientation('w');
  closeDialogs();
  render();
}

function exitReview() {
  review = null;
  viewPly = game.length;
  board.setOrientation(game.remote || settings.autoFlip ? homeOrientation() : board.orientation);
  render();
}

function goto(ply) {
  const g = active();
  viewPly = Math.max(0, Math.min(g.length, ply));
  render();
  if (isLive()) scheduleFlip(60);
}

/* ---------------- dialogs ---------------- */

function openDialog(sel) {
  const d = $(sel);
  if (!d.open) d.showModal();
}
function closeDialogs() { $$('dialog[open]').forEach((d) => d.close()); }

$$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
// click on the backdrop closes a dialog
$$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

function openNewGame(prefill) {
  const p = prefill || { white: game.white, black: game.black, tc: game.tc };
  $('#new-white').value = p.white;
  $('#new-black').value = p.black;
  const grid = $('#tc-grid');
  grid.innerHTML = TIME_CONTROLS.map((t) => `
    <label class="tc${t.id === p.tc ? ' checked' : ''}">
      <input type="radio" name="tc" value="${t.id}"${t.id === p.tc ? ' checked' : ''} />
      <strong>${t.base ? t.label : '∞'}</strong><small>${t.kind || 'No clock'}</small>
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
    tc: (document.querySelector('#tc-grid input:checked') || {}).value || 'none',
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
      <span class="who"><strong>${esc(g.white)}</strong> vs <strong>${esc(g.black)}</strong>
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
    paused = game.hasClock && game.length > 0;
    persist();
    closeDialogs();
    board.setOrientation(homeOrientation());
    render();
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

$('#form-import').addEventListener('submit', (e) => {
  const text = $('#import-text').value.trim();
  const err = $('#import-error');
  try {
    if (!text) throw new Error('Paste a PGN first.');
    const g = Game.fromPGN(text);
    if (!g.length) throw new Error('No moves found in this PGN.');
    storage.archive(g.toJSON());
    err.classList.add('hidden');
    $('#import-text').value = '';
    openReview(g);
    toast('Game imported and saved');
  } catch (ex) {
    e.preventDefault();
    err.textContent = `Could not read PGN: ${ex.message}`;
    err.classList.remove('hidden');
  }
});
$('#import-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) $('#import-text').value = await f.text();
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
  const slug = (s) => s.replace(/[^\w-]+/g, '_').slice(0, 20);
  saveFile(`${slug(g.white)}_vs_${slug(g.black)}_${new Date(g.startedAt).toISOString().slice(0, 10)}.pgn`, g.pgn());
}

async function copy(text, what, quiet = false) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch {
    if (!quiet) prompt(`Copy the ${what}:`, text); // clipboard blocked: let the user copy by hand
  }
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
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
$('#btn-options').addEventListener('click', () => {
  openDialog('#dlg-options');
  $('#moves .active')?.scrollIntoView({ block: 'nearest' });
});
$('#tb-draw').addEventListener('click', () => $('#btn-draw').click());
$('#tb-resign').addEventListener('click', () => $('#btn-resign').click());
$('#btn-flip').addEventListener('click', async () => { clearTimeout(flipTimer); await board.flip(); renderPlayers(); });
$('#btn-undo').addEventListener('click', takeback);
$('#btn-pause').addEventListener('click', togglePause);
$('#btn-draw').addEventListener('click', () => openDialog('#dlg-draw'));
$('#btn-draw').addEventListener('click', () => {
  const r = game.remote;
  const opp = r && game.nameOf(other(r.me));
  const theyOffer = r && r.offer === other(r.me);
  $('#draw-title').textContent = !r ? 'Agree to a draw?' : theyOffer ? `Accept ${opp}'s draw offer?` : `Offer ${opp} a draw?`;
  $('#draw-sub').textContent = !r ? 'Both players should agree before confirming.'
    : theyOffer ? 'The game ends as a draw. Send the code so they see it.'
    : 'The offer goes into the code you send. They can accept it, or decline by moving.';
  $('#draw-confirm').textContent = r && !theyOffer ? 'Offer draw' : 'Draw';
  openDialog('#dlg-draw');
});
$('#draw-confirm').addEventListener('click', () => {
  $('#dlg-draw').close();
  if (game.over) return;
  const r = game.remote;
  if (r && r.offer !== other(r.me)) {
    r.offer = r.me;
    persist();
    render();
    openSend();
    return;
  }
  game.agreeDraw();
  sound.end();
  onGameOver(true);
});
$('#btn-resign').addEventListener('click', () => {
  $('#resign-w span').textContent = `${game.white} resigns`;
  $('#resign-b span').textContent = `${game.black} resigns`;
  // in a remote game you can only resign for yourself
  $('#resign-w').classList.toggle('hidden', game.remote?.me === 'b');
  $('#resign-b').classList.toggle('hidden', game.remote?.me === 'w');
  openDialog('#dlg-resign');
});
for (const c of ['w', 'b']) {
  $(`#resign-${c}`).addEventListener('click', () => {
    $('#dlg-resign').close();
    if (game.over) return;
    game.resign(c);
    sound.end();
    onGameOver(true);
  });
}

$('#over-rematch').addEventListener('click', () => {
  $('#dlg-over').close();
  if (game.remote) {
    startGame({ white: game.black, black: game.white, tc: 'none', remote: { me: other(game.remote.me) } });
    if (game.remote.me === 'b') openSend();
    else toast('You have white now. Make your first move, then send the code.');
    return;
  }
  startGame({ white: game.black, black: game.white, tc: game.tc });
  toast('Colours swapped. Good luck!');
});
$('#over-code').addEventListener('click', () => { $('#dlg-over').close(); openSend(); });
$('#over-new').addEventListener('click', () => { $('#dlg-over').close(); openNewGame(); });
$('#over-review').addEventListener('click', () => { $('#dlg-over').close(); goto(0); toast('Use ← → to step through the game'); });
$('#over-pgn').addEventListener('click', () => download(game));

$('#nav-first').addEventListener('click', () => goto(0));
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
$('#btn-import').addEventListener('click', () => { $('#import-error').classList.add('hidden'); openDialog('#dlg-import'); });

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea') || $$('dialog[open]').length) return;
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
  else if (k === 'o' || k === 'O') $('#btn-options').click();
  else if (k === '?') openDialog('#dlg-help');
  else return;
  e.preventDefault();
});

/* ---------------- settings ---------------- */

const bindSwitch = (sel, key, after) => {
  const input = $(sel);
  input.checked = settings[key];
  input.addEventListener('change', () => {
    settings[key] = input.checked;
    storage.saveSettings(settings);
    after?.();
  });
};
bindSwitch('#set-autoflip', 'autoFlip', () => { render(); if (settings.autoFlip) scheduleFlip(50); });
bindSwitch('#set-dests', 'showDests', applyPrefs);
bindSwitch('#set-coords', 'coords', applyPrefs);
bindSwitch('#set-sound', 'sound', applyPrefs);

$$('.swatch').forEach((s) => s.addEventListener('click', () => {
  settings.theme = s.dataset.theme;
  storage.saveSettings(settings);
  applyPrefs();
}));

function applyPrefs() {
  board.setPrefs({ showDests: settings.showDests, coords: settings.coords });
  sound.setEnabled(settings.sound);
  $('#board').dataset.theme = settings.theme;
  $$('.swatch').forEach((s) => s.setAttribute('aria-checked', String(s.dataset.theme === settings.theme)));
}

/* ---------------- remote play (game codes) ---------------- */

const shareLink = (code) =>
  /^https?:$/.test(location.protocol) ? `${location.origin}${location.pathname}#${code}` : null;

function currentCode() {
  return encodeCode({
    id: game.id, white: game.white, black: game.black, sender: game.remote.me,
    moves: game.plies.map((p) => p.san), result: game.result, termination: game.termination,
    offer: game.remote.offer,
  });
}

function renderRemoteCard() {
  if (!game.remote) return;
  const opp = game.nameOf(other(game.remote.me));
  $('#remote-who').textContent = `You play ${colorName(game.remote.me).toLowerCase()} against ${opp}`;
  $('#remote-paste').placeholder = `Paste ${opp}'s code here…`;
}

/** Show the code for the opponent and try to put it on the clipboard right away. */
function openSend() {
  const r = game.remote;
  const opp = game.nameOf(other(r.me));
  const code = currentCode();
  const link = shareLink(code);
  let title;
  if (game.over) title = `${game.winnerText()}. Send ${opp} the final code`;
  else if (!game.length) title = `Invite ${opp}`;
  else if (r.offer === r.me) title = `Draw offer ready for ${opp}`;
  else title = `Your move is ready. Send it to ${opp}`;
  $('#send-title').textContent = title;
  $('#send-code').value = code;
  $('#send-link').classList.toggle('hidden', !link);
  $('#send-hint').textContent = game.over
    ? 'Once they paste it, the game is over on their screen too.'
    : `Send this in Teams, Slack, email or any chat. When ${opp} replies with a code, paste it anywhere on this page.`;
  openDialog('#dlg-send');
  copy(code, 'Code', true);
}

function joinOrUpdate(text) {
  let d;
  try { d = decodeCode(text); } catch (e) { toast(e.message); return false; }

  // the code may belong to a game that is in saved games, not on the board
  let base = game.id === d.id ? game : null;
  if (!base) {
    const saved = storage.loadArchive().find((g) => g.id === d.id);
    if (saved) base = new Game(saved);
  }
  const local = base && { id: base.id, moves: base.plies.map((p) => p.san), result: base.result, offer: base.remote?.offer };
  const kind = compareToLocal(local, d);
  if (kind === 'same') { toast('You already have this move'); return true; }
  if (kind === 'conflict') { toast('This code is from a different line of this game. Ask for their latest code.'); return false; }
  if (base?.remote && d.sender === base.remote.me) { toast('That is your own code. Send it to your opponent.'); return false; }

  closeDialogs();
  const before = base ? base.length : 0;
  if (kind === 'new') {
    startGame({ id: d.id, white: d.white, black: d.black, tc: 'none', remote: { me: other(d.sender) } });
  } else if (base !== game) {
    if (game.length && !game.over) storage.archive(game.toJSON());
    storage.removeFromArchive(base.id);
    game = base;
    review = null;
    board.setOrientation(homeOrientation());
  }
  if (!game.remote) game.remote = { me: other(d.sender), offer: null };
  // show the position before their move first, so their move animates in
  for (const san of d.moves.slice(game.length, Math.max(before, d.moves.length - 1))) game.moveSan(san);
  viewPly = game.length;
  render();
  setTimeout(() => {
    const fresh = d.moves.slice(game.length);
    let last = null;
    for (const san of fresh) last = game.moveSan(san) || last;
    game.remote.offer = d.offer;
    if (d.result && !game.result) game.finish(d.result, d.termination || 'Game over');
    viewPly = game.length;
    persist();
    render();
    if (last) {
      if (game.over) sound.end();
      else if (last.san.includes('+')) sound.check();
      else if (last.captured) sound.capture();
      else sound.move();
    }
    if (game.over) onGameOver(false);
    else if (kind === 'new' && !game.length) toast(`Joined: you play white against ${game.black}. Your move!`);
    else if (kind === 'new') toast(`Joined: you play ${colorName(game.remote.me).toLowerCase()} against ${game.nameOf(other(game.remote.me))}`);
    else if (d.offer && d.offer !== game.remote.me) toast(`${game.nameOf(d.offer)} offers a draw`);
    else if (last) toast(`${game.nameOf(other(game.remote.me))} played ${last.san}`);
  }, 350);
  return true;
}

function applyFromHash() {
  const text = decodeURIComponent(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
  joinOrUpdate(text);
}
addEventListener('hashchange', () => { if (hasCode(location.hash)) applyFromHash(); });

// paste a code anywhere on the page
document.addEventListener('paste', (e) => {
  if (e.target.closest('input, textarea')) return;
  const text = e.clipboardData?.getData('text') || '';
  if (!hasCode(text)) return;
  e.preventDefault();
  joinOrUpdate(text);
});

function openRemote(tab = 'create') {
  $('#remote-my-name').value = settings.myName || '';
  $('#remote-opp-name').value = settings.oppName || '';
  $('#remote-join-text').value = '';
  setRemoteTab(tab);
  openDialog('#dlg-remote');
}

function setRemoteTab(tab) {
  $$('#dlg-remote [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $$('#dlg-remote [data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== tab));
}
$$('#dlg-remote [data-tab]').forEach((b) => b.addEventListener('click', () => setRemoteTab(b.dataset.tab)));

$('#form-remote-create').addEventListener('submit', () => {
  const me = $('#remote-my-name').value.trim() || 'Me';
  const opp = $('#remote-opp-name').value.trim() || 'Opponent';
  let color = (document.querySelector('input[name="remote-color"]:checked') || {}).value || 'w';
  if (color === 'random') color = Math.random() < 0.5 ? 'w' : 'b';
  Object.assign(settings, { myName: me, oppName: opp });
  startGame({
    white: color === 'w' ? me : opp, black: color === 'w' ? opp : me,
    tc: 'none', remote: { me: color },
  });
  if (color === 'b') openSend();
  else toast(`You play white. Make your first move, then send the code to ${opp}.`);
});

$('#form-remote-join').addEventListener('submit', (e) => {
  if (!joinOrUpdate($('#remote-join-text').value)) e.preventDefault();
});

$('#remote-apply').addEventListener('click', () => {
  if (joinOrUpdate($('#remote-paste').value)) $('#remote-paste').value = '';
});
$('#remote-copy').addEventListener('click', () => { $('#dlg-code').close(); openSend(); });
$('#btn-code').addEventListener('click', () => { $('#remote-paste').value = ''; openDialog('#dlg-code'); });
$('#send-copy').addEventListener('click', () => copy($('#send-code').value, 'Code'));
$('#send-link').addEventListener('click', () => copy(shareLink($('#send-code').value), 'Link'));
$('#send-code').addEventListener('focus', (e) => e.target.select());
$('#btn-remote').addEventListener('click', () => openRemote());

/* ---------------- boot ---------------- */

applyPrefs();
// the offline download link only makes sense on the hosted site
if (!/^https?:$/.test(location.protocol)) $('.offline-dl')?.remove();
board.setOrientation(homeOrientation());
render();
if (hasCode(location.hash)) applyFromHash();
if (paused) toast('Game restored — clocks paused');
else if (game.length) toast('Game restored');

// the single-file build (deskmate.html) has no sw.js next to it, wherever it is hosted
const singleFile = document.documentElement.hasAttribute('data-single-file');
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !singleFile) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
