// Interactive chessboard: rendering, click & drag moves, legal-move hints,
// last-move/check highlights, right-click arrows and an animated board flip.
import { fenPieces } from './game.js';

const FILES = 'abcdefgh';
const ROLE_NAMES = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };

const el = (tag, cls, parent) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
};

const reflow = (e) => void e.offsetWidth;

export class Board {
  /**
   * @param {HTMLElement} root
   * @param {{ onMove: (from: string, to: string) => void }} opts
   */
  constructor(root, opts) {
    this.root = root;
    this.onMove = opts.onMove;
    this.orientation = 'w';
    this.state = { fen: '8/8/8/8/8/8/8/8', lastMove: null, check: null, dests: new Map(), movable: null };
    this.prefs = { showDests: true, coords: true };
    this.pieces = new Map(); // square -> { el, code }
    this.selected = null;
    this.drag = null;
    this.shapes = []; // { from, to } arrows, from === to is a circle
    this.drawing = null;
    this.busy = false;

    root.classList.add('board');
    this.inner = el('div', 'board-inner', root);
    this.squaresEl = el('div', 'squares', this.inner);
    this.squareEls = [];
    for (let i = 0; i < 64; i++) this.squareEls.push(el('div', 'sq', this.squaresEl));
    this.piecesEl = el('div', 'pieces', this.inner);
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'arrows');
    this.svg.setAttribute('viewBox', '0 0 8 8');
    this.svg.innerHTML = `<defs><marker id="ah" orient="auto" markerWidth="4" markerHeight="8" refX="2.05" refY="2.01">
      <path d="M0,0 V4 L3,2 Z" fill="currentColor"/></marker></defs><g></g>`;
    this.inner.appendChild(this.svg);
    this.promoEl = el('div', 'promo hidden', root);

    root.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._move(e));
    window.addEventListener('pointerup', (e) => this._up(e));
    window.addEventListener('pointercancel', () => this._cancelDrag());
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    this._layoutSquares();
  }

  /* ---------- geometry ---------- */

  /** Visual (col,row) for a square under the current orientation. */
  _pos(sq) {
    const f = FILES.indexOf(sq[0]), r = +sq[1] - 1;
    return this.orientation === 'w' ? [f, 7 - r] : [7 - f, r];
  }

  _squareAt(col, row) {
    return this.orientation === 'w' ? FILES[col] + (8 - row) : FILES[7 - col] + (row + 1);
  }

  _eventSquare(e) {
    const rect = this.inner.getBoundingClientRect();
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * 8);
    const row = Math.floor(((e.clientY - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return this._squareAt(col, row);
  }

  _layoutSquares() {
    this.squareEls.forEach((s, i) => {
      const col = i % 8, row = Math.floor(i / 8);
      const sq = this._squareAt(col, row);
      s.dataset.sq = sq;
      s.classList.toggle('light', (col + row) % 2 === 0);
      s.classList.toggle('dark', (col + row) % 2 === 1);
      s.innerHTML = '';
      if (col === 0) el('span', 'coord rank', s).textContent = sq[1];
      if (row === 7) el('span', 'coord file', s).textContent = sq[0];
    });
    this._sqByName = new Map(this.squareEls.map((s) => [s.dataset.sq, s]));
  }

  _place(pieceEl, sq) {
    const [c, r] = this._pos(sq);
    pieceEl.style.transform = `translate(${c * 100}%, ${r * 100}%) rotate(var(--counter, 0deg))`;
  }

  /* ---------- public API ---------- */

  setPrefs(prefs) {
    Object.assign(this.prefs, prefs);
    this.root.classList.toggle('no-coords', !this.prefs.coords);
    this._highlight();
  }

  /** Update position & highlights. Pieces that moved glide to their new square. */
  set(state) {
    const posChanged = state.fen !== this.state.fen;
    this.state = { ...this.state, ...state };
    if (posChanged) {
      this.shapes = [];
      this._renderShapes();
    }
    if (this.selected && !(this.state.dests.get(this.selected) && this.state.movable)) this.selected = null;
    this._syncPieces();
    this._highlight();
  }

  setOrientation(color) {
    if (color === this.orientation) return;
    this.orientation = color;
    this._layoutSquares();
    for (const [sq, p] of this.pieces) this._place(p.el, sq);
    this._renderShapes();
    this._highlight();
  }

  /** Spin the board 180° (pieces counter-rotate so they stay upright), then swap orientation. */
  flip(animate = true) {
    const target = this.orientation === 'w' ? 'b' : 'w';
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.setOrientation(target);
      return Promise.resolve();
    }
    this._cancelDrag();
    this.busy = true;
    return new Promise((resolve) => {
      const done = () => {
        this.inner.removeEventListener('transitionend', onEnd);
        clearTimeout(timer);
        this.root.classList.add('no-anim');
        this.root.classList.remove('flipping');
        this.inner.style.removeProperty('--rot');
        this.inner.style.removeProperty('--counter');
        this.setOrientation(target);
        reflow(this.root);
        this.root.classList.remove('no-anim');
        this.busy = false;
        resolve();
      };
      const onEnd = (e) => { if (e.target === this.inner && e.propertyName === 'transform') done(); };
      const timer = setTimeout(done, 1200);
      this.inner.addEventListener('transitionend', onEnd);
      this.root.classList.add('flipping');
      reflow(this.inner);
      this.inner.style.setProperty('--rot', '180deg');
      this.inner.style.setProperty('--counter', '-180deg');
    });
  }

  /** Show the promotion picker over the target file; resolves to 'q'|'r'|'b'|'n' or null. */
  askPromotion(to, color) {
    return new Promise((resolve) => {
      const [col, row] = this._pos(to);
      const fromTop = row === 0;
      this.promoEl.innerHTML = '';
      this.promoEl.classList.remove('hidden');
      const close = (v) => {
        this.promoEl.classList.add('hidden');
        this.promoEl.innerHTML = '';
        resolve(v);
      };
      ['q', 'n', 'r', 'b'].forEach((role, i) => {
        const b = el('button', 'promo-choice', this.promoEl);
        b.style.left = `${col * 12.5}%`;
        b.style.top = `${(fromTop ? i : 7 - i) * 12.5}%`;
        b.setAttribute('aria-label', `Promote to ${ROLE_NAMES[role.toUpperCase()]}`);
        el('span', `piece-img ${color}${role.toUpperCase()}`, b);
        b.addEventListener('pointerdown', (e) => { e.stopPropagation(); close(role); });
      });
      this.promoEl.onpointerdown = (e) => { e.stopPropagation(); close(null); };
    });
  }

  /* ---------- pieces ---------- */

  _syncPieces() {
    const next = fenPieces(this.state.fen);
    const removed = [];
    for (const [sq, p] of this.pieces) {
      if (next.get(sq) !== p.code) { removed.push({ sq, ...p }); this.pieces.delete(sq); }
    }
    const added = [];
    for (const [sq, code] of next) if (!this.pieces.has(sq)) added.push({ sq, code });

    for (const a of added) {
      // reuse the nearest vanished piece of the same kind so it glides across the board
      let best = -1, bestD = Infinity;
      removed.forEach((r, i) => {
        if (r.code !== a.code) return;
        const [c1, r1] = this._pos(r.sq), [c2, r2] = this._pos(a.sq);
        const d = Math.hypot(c1 - c2, r1 - r2);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best >= 0) {
        const [r] = removed.splice(best, 1);
        r.el.classList.add('moving');
        this._place(r.el, a.sq);
        setTimeout(() => r.el.classList.remove('moving'), 260);
        this.pieces.set(a.sq, { el: r.el, code: a.code });
      } else {
        const p = el('div', `piece piece-img ${a.code} appear`, this.piecesEl);
        p.setAttribute('aria-label', `${a.code[0] === 'w' ? 'white' : 'black'} ${ROLE_NAMES[a.code[1]]} on ${a.sq}`);
        this._place(p, a.sq);
        setTimeout(() => p.classList.remove('appear'), 260);
        this.pieces.set(a.sq, { el: p, code: a.code });
      }
    }
    for (const r of removed) {
      r.el.classList.add('fade');
      setTimeout(() => r.el.remove(), 220);
    }
    for (const [sq, p] of this.pieces) p.el.setAttribute('aria-label',
      `${p.code[0] === 'w' ? 'white' : 'black'} ${ROLE_NAMES[p.code[1]]} on ${sq}`);
  }

  /* ---------- highlights ---------- */

  _highlight() {
    const { lastMove, check, dests, movable } = this.state;
    const sel = this.selected;
    const targets = sel ? dests.get(sel) || [] : [];
    const occupied = fenPieces(this.state.fen);
    for (const s of this.squareEls) {
      const sq = s.dataset.sq;
      s.classList.toggle('last-move', !!lastMove && lastMove.includes(sq));
      s.classList.toggle('selected', sel === sq);
      s.classList.toggle('check', check === sq);
      const isDest = this.prefs.showDests && targets.includes(sq);
      s.classList.toggle('move-dest', isDest && !occupied.has(sq));
      s.classList.toggle('capture-dest', isDest && occupied.has(sq));
      s.classList.toggle('hover', !!this.drag?.started && this.drag.over === sq && targets.includes(sq));
    }
    this.root.classList.toggle('movable', !!movable);
  }

  /* ---------- input ---------- */

  _canMoveFrom(sq) {
    const { movable, dests } = this.state;
    const p = this.pieces.get(sq);
    return !!movable && !!p && p.code[0] === movable && dests.has(sq);
  }

  _down(e) {
    if (this.busy) return;
    const sq = this._eventSquare(e);
    if (!sq) return;
    if (e.button === 2) {
      this.drawing = { from: sq };
      return;
    }
    if (e.button !== 0) return;
    if (this.shapes.length) { this.shapes = []; this._renderShapes(); }

    const targets = this.selected ? this.state.dests.get(this.selected) || [] : [];
    if (this.selected && targets.includes(sq)) {
      const from = this.selected;
      this.selected = null;
      this._highlight();
      this.onMove(from, sq);
      return;
    }
    if (this._canMoveFrom(sq)) {
      e.preventDefault();
      const wasSelected = this.selected === sq;
      this.selected = sq;
      const rect = this.inner.getBoundingClientRect();
      this.drag = { from: sq, el: this.pieces.get(sq).el, x: e.clientX, y: e.clientY, rect, started: false, wasSelected, over: sq };
      this._highlight();
    } else if (this.selected) {
      this.selected = null;
      this._highlight();
    }
  }

  _move(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.started && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
    if (!d.started) {
      d.started = true;
      d.el.classList.add('dragging');
    }
    const size = d.rect.width / 8;
    const x = e.clientX - d.rect.left - size / 2, y = e.clientY - d.rect.top - size / 2;
    // the board may be visually rotated mid-flip; drags are blocked then, so plain px works
    d.el.style.transform = `translate(${x}px, ${y}px) scale(1.12)`;
    const over = this._eventSquare(e);
    if (over !== d.over) { d.over = over; this._highlight(); }
  }

  _up(e) {
    if (this.drawing) {
      const to = this._eventSquare(e);
      if (to) this._toggleShape(this.drawing.from, to);
      this.drawing = null;
      return;
    }
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const to = this._eventSquare(e);
    const targets = this.state.dests.get(d.from) || [];
    if (d.started) {
      d.el.classList.remove('dragging');
      if (to && to !== d.from && targets.includes(to)) {
        // drop the piece instantly on its target, then let the app play the move
        this.root.classList.add('no-anim');
        const { code } = this.pieces.get(d.from);
        const captured = this.pieces.get(to);
        if (captured) captured.el.remove();
        this.pieces.delete(d.from);
        this.pieces.set(to, { el: d.el, code });
        this._place(d.el, to);
        reflow(d.el);
        this.root.classList.remove('no-anim');
        this.selected = null;
        this._highlight();
        this.onMove(d.from, to);
        return;
      }
      this._place(d.el, d.from);
    } else if (d.wasSelected) {
      this.selected = null;
    }
    this._highlight();
  }

  _cancelDrag() {
    if (!this.drag) return;
    this.drag.el.classList.remove('dragging');
    this._place(this.drag.el, this.drag.from);
    this.drag = null;
    this.selected = null;
    this._highlight();
  }

  /* ---------- arrows & circles ---------- */

  _toggleShape(from, to) {
    const i = this.shapes.findIndex((s) => s.from === from && s.to === to);
    if (i >= 0) this.shapes.splice(i, 1);
    else this.shapes.push({ from, to });
    this._renderShapes();
  }

  _renderShapes() {
    const g = this.svg.querySelector('g');
    g.innerHTML = '';
    const ns = 'http://www.w3.org/2000/svg';
    for (const { from, to } of this.shapes) {
      const [c1, r1] = this._pos(from), [c2, r2] = this._pos(to);
      if (from === to) {
        const c = document.createElementNS(ns, 'circle');
        c.setAttribute('cx', c1 + 0.5); c.setAttribute('cy', r1 + 0.5); c.setAttribute('r', 0.45);
        c.setAttribute('class', 'shape-circle');
        g.appendChild(c);
        continue;
      }
      const x1 = c1 + 0.5, y1 = r1 + 0.5, x2 = c2 + 0.5, y2 = r2 + 0.5;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const shorten = 0.3; // leave room for the arrow head
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2 - ((x2 - x1) / len) * shorten);
      line.setAttribute('y2', y2 - ((y2 - y1) / len) * shorten);
      line.setAttribute('class', 'shape-arrow');
      line.setAttribute('marker-end', 'url(#ah)');
      g.appendChild(line);
    }
  }
}
