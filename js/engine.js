// Stockfish in a Web Worker, spoken to over UCI. Loaded only when someone asks for an analysis.

/** Where the app lives, so the engine is found next to it on any host (…/deskmate, …/Deskmate/, file). */
function appBase() {
  const p = location.pathname;
  if (p.endsWith('/')) return p;
  const last = p.slice(p.lastIndexOf('/') + 1);
  return last.includes('.') ? p.slice(0, p.lastIndexOf('/') + 1) : `${p}/`;
}
export const engineUrl = () => new URL(`${appBase()}vendor/stockfish/stockfish.js`, location.href).href;

export class Engine {
  constructor(url = engineUrl()) {
    this.url = url;
    this.listeners = new Set();
    this.busy = Promise.resolve();
  }

  _send(cmd) { this.worker.postMessage(cmd); }

  _waitFor(prefix) {
    return new Promise((resolve) => {
      const l = (line) => { if (line.startsWith(prefix)) { this.listeners.delete(l); resolve(line); } };
      this.listeners.add(l);
    });
  }

  /** Starts the worker once; rejects if the browser can't run it (e.g. opened from a file). */
  start() {
    if (!this.ready) {
      this.ready = new Promise((resolve, reject) => {
        try { this.worker = new Worker(this.url); } catch (e) { reject(e); return; }
        this.worker.onmessage = (e) => { for (const l of [...this.listeners]) l(String(e.data)); };
        this.worker.onerror = (e) => reject(new Error(e.message || 'engine failed to load'));
        const ok = this._waitFor('uciok').then(() => {
          this._send('setoption name Hash value 32');
          // Stockfish 11 "contempt" makes it rate positions in favour of the side it analyses for
          // (to avoid draws when it plays); for an even-handed analysis it must be off
          this._send('setoption name Contempt value 0');
          this._send('setoption name Analysis Contempt value Off');
          this._send('isready');
          return this._waitFor('readyok');
        });
        this._send('uci');
        ok.then(resolve, reject);
      });
    }
    return this.ready;
  }

  /**
   * Evaluate a position. Resolves to { cp | mate, pv: ['e2e4', …], depth }, scored from White's
   * side. Calls are queued, one search at a time.
   */
  analyse(fen, depth, onInfo) {
    const run = async () => {
      await this.start();
      const whiteToMove = fen.split(' ')[1] === 'w';
      let best = null;
      const done = new Promise((resolve) => {
        const l = (line) => {
          if (line.startsWith('info') && line.includes(' pv ') && !/ (upper|lower)bound /.test(line)) {
            const m = / depth (\d+) .*score (cp|mate) (-?\d+) .* pv (.+)$/.exec(line);
            if (m && !/ multipv [2-9]/.test(line)) {
              const v = +m[3] * (whiteToMove ? 1 : -1);
              // the line is UCI moves; this build appends extra tokens ("bmc 0.0003") after it
              const pv = [];
              for (const t of m[4].trim().split(/\s+/)) { if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t)) break; pv.push(t); }
              best = { depth: +m[1], pv, ...(m[2] === 'cp' ? { cp: v } : { mate: v }) };
              onInfo?.(best);
            }
          } else if (line.startsWith('bestmove')) {
            this.listeners.delete(l);
            resolve(best);
          }
        };
        this.listeners.add(l);
      });
      this._send(`position fen ${fen}`);
      this._send(`go depth ${depth}`);
      return done;
    };
    const result = this.busy.then(run, run);
    this.busy = result.catch(() => {});
    return result;
  }

  stop() { this.worker?.postMessage('stop'); }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.listeners.clear();
  }
}
