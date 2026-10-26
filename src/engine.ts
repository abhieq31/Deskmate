// Stockfish in a Web Worker, spoken to over UCI. Loaded only when someone asks for an analysis.

/** Where the app lives, so the engine is found next to it on any host (…/deskmate, …/Deskmate/, file). */
function appBase() {
  const p = location.pathname;
  if (p.endsWith('/')) return p;
  const last = p.slice(p.lastIndexOf('/') + 1);
  return last.includes('.') ? p.slice(0, p.lastIndexOf('/') + 1) : `${p}/`;
}
/** URL of a file under vendor/, next to the app on any host. */
export const vendorUrl = (path) => new URL(`${appBase()}vendor/${path}`, location.href).href;
const engineFile = (file) => vendorUrl(`stockfish/${file}`);
export const engineUrl = () => engineFile('stockfish.js');

/**
 * Engine builds to try, fastest first. The WebAssembly build is ~25x faster, but some company
 * laptops run Chrome with the JIT switched off by policy, which removes WebAssembly entirely;
 * the asm.js build is plain JavaScript and runs anywhere.
 */
export function engineCandidates(): Candidate[] {
  let wasm = false;
  try { wasm = typeof WebAssembly === 'object' && WebAssembly.validate(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0)); } catch { /* no wasm */ }
  return [...(wasm ? [{ url: engineFile('stockfish.js'), flavor: 'wasm' as const }] : []), { url: engineFile('stockfish.asm.js'), flavor: 'asm' as const }];
}

// a build that has not said "uciok" by then is treated as broken (blocked download, no wasm…)
const LOAD_TIMEOUT = 25000;

/** One evaluation, from White's side: centipawns or moves to mate, and the engine's line in UCI. */
export interface Eval { cp?: number; mate?: number; pv: string[]; depth?: number; winner?: 'w' | 'b'; draw?: boolean }
export interface Limits { depth: number; movetime: number }
interface Candidate { url: string; flavor: 'wasm' | 'asm' }
type Listener = (line: string) => void;

export class Engine {
  candidates: Candidate[];
  listeners: Set<Listener>;
  busy: Promise<unknown>;
  worker: Worker | null = null;
  flavor: Candidate['flavor'] | null = null;
  ready: Promise<Candidate['flavor']> | null = null;

  hash: number;

  /** `hash`: Stockfish's table size in MB; small for the always-on engines, so three can run at once. */
  constructor(candidates: Candidate[] = engineCandidates(), hash = 32) {
    this.hash = hash;
    this.candidates = candidates;
    this.listeners = new Set();
    this.busy = Promise.resolve();
  }

  _send(cmd: string) { this.worker.postMessage(cmd); }

  _waitFor(prefix: string): Promise<string> {
    return new Promise((resolve) => {
      const l = (line) => { if (line.startsWith(prefix)) { this.listeners.delete(l); resolve(line); } };
      this.listeners.add(l);
    });
  }

  /** Boots one build; rejects on a worker error or if it never answers. */
  _boot({ url, flavor }: Candidate): Promise<void> {
    return new Promise((resolve, reject) => {
      let worker;
      try { worker = new Worker(url); } catch (e) { reject(e); return; }
      this.worker = worker;
      this.flavor = flavor;
      const fail = (msg) => { clearTimeout(timer); worker.terminate(); this.listeners.clear(); reject(new Error(msg)); };
      const timer = setTimeout(() => fail(`${flavor} engine did not start`), LOAD_TIMEOUT);
      worker.onmessage = (e) => { for (const l of [...this.listeners]) l(String(e.data)); };
      worker.onerror = (e) => { e.preventDefault?.(); fail(e.message || `${flavor} engine failed to load`); };
      this._waitFor('uciok').then(() => {
        clearTimeout(timer);
        this._send(`setoption name Hash value ${this.hash}`);
        // Stockfish 11 "contempt" makes it rate positions in favour of the side it analyses for
        // (to avoid draws when it plays); for an even-handed analysis it must be off
        this._send('setoption name Contempt value 0');
        this._send('setoption name Analysis Contempt value Off');
        this._send('isready');
        return this._waitFor('readyok');
      }).then(() => resolve());
      this._send('uci');
    });
  }

  /** Starts the first build that works; rejects if none does (e.g. the page was opened from a file). */
  start() {
    if (!this.ready) {
      this.ready = (async () => {
        let err;
        for (const c of this.candidates) {
          try { await this._boot(c); return this.flavor; } catch (e) { err = e; }
        }
        this.worker = null;
        throw err || new Error('no engine');
      })();
      this.ready.catch(() => { this.ready = null; });
    }
    return this.ready;
  }

  /**
   * Evaluate a position. Resolves to { cp | mate, pv: ['e2e4', …], depth }, scored from White's
   * side. Calls are queued, one search at a time. The search ends at `depth` or after `movetime`
   * ms, whichever comes first, so a slow laptop still finishes a whole game in reasonable time.
   */
  analyse(fen: string, { depth, movetime }: Limits, onInfo?: (e: Eval) => void): Promise<Eval | null> {
    const run = async () => {
      await this.start();
      const whiteToMove = fen.split(' ')[1] === 'w';
      let best: Eval | null = null;
      const done = new Promise<Eval | null>((resolve) => {
        const l = (line: string) => {
          if (line.startsWith('info') && line.includes(' pv ') && !/ (upper|lower)bound /.test(line)) {
            const m = / depth (\d+) .*score (cp|mate) (-?\d+) .* pv (.+)$/.exec(line);
            if (m && !/ multipv [2-9]/.test(line)) {
              const v = +m[3] * (whiteToMove ? 1 : -1);
              // the line is UCI moves; this build appends extra tokens ("bmc 0.0003") after it
              const pv: string[] = [];
              for (const t of m[4].trim().split(/\s+/)) { if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t)) break; pv.push(t); }
              best = { depth: +m[1], pv, ...(m[2] === 'cp' ? { cp: v } : { mate: v }) };
              onInfo?.(best);
            }
          } else if (line.startsWith('bestmove')) {
            this.listeners.delete(l);
            clearTimeout(watchdog);
            resolve(best);
          }
        };
        this.listeners.add(l);
        // never wait forever: ask it to stop, then take what it has
        const watchdog = setTimeout(() => {
          this._send('stop');
          setTimeout(() => { if (this.listeners.delete(l)) resolve(best); }, 3000);
        }, movetime + 4000);
      });
      this._send(`position fen ${fen}`);
      this._send(`go depth ${depth} movetime ${movetime}`);
      return done;
    };
    const result = this.busy.then(run, run);
    this.busy = result.catch(() => {});
    return result;
  }

  /**
   * Choose a move to play, for games against the computer. `skill` is Stockfish's Skill Level
   * (0–20): below 20 it deliberately picks weaker moves now and then, which is what makes the
   * easy levels beatable. Resolves to a UCI move ("e2e4", "e7e8q") or null.
   */
  play(fen: string, { skill, depth, movetime }: Limits & { skill: number }): Promise<string | null> {
    const run = async () => {
      await this.start();
      const done = new Promise<string | null>((resolve) => {
        const l = (line: string) => {
          if (!line.startsWith('bestmove')) return;
          this.listeners.delete(l);
          clearTimeout(watchdog);
          const m = /^bestmove ([a-h][1-8][a-h][1-8][qrbn]?)/.exec(line);
          resolve(m ? m[1] : null);
        };
        this.listeners.add(l);
        const watchdog = setTimeout(() => {
          this._send('stop');
          setTimeout(() => { if (this.listeners.delete(l)) resolve(null); }, 3000);
        }, movetime + 4000);
      });
      this._send(`setoption name Skill Level value ${skill}`);
      this._send(`position fen ${fen}`);
      this._send(`go depth ${depth} movetime ${movetime}`);
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
