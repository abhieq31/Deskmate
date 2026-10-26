// Live remote play. Both laptops join a "room" named by a short code; game snapshots travel
// through public Nostr relays (plain WebSockets on port 443). There is no Deskmate server and
// no account: the signing key is derived from the room code, so anyone holding the code can
// read and post snapshots for that room, and nobody else knows where to look.
import { schnorr } from '../vendor/secp256k1.js';

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://offchain.pub'];

/**
 * Relays to use. A company can run its own Nostr relay and point Deskmate at it with
 * localStorage['deskmate:relays'] = '["wss://relay.example.internal"]'.
 */
export const RELAYS: string[] = (() => {
  try {
    const custom = JSON.parse(globalThis.localStorage?.getItem('deskmate:relays') || 'null');
    if (Array.isArray(custom) && custom.length && custom.every((u) => /^wss?:\/\//.test(u))) return custom;
  } catch { /* no storage: use the defaults */ }
  return DEFAULT_RELAYS;
})();

// NIP-78 application data. It is "parameterized replaceable": per (key, d-tag) a relay keeps
// only the newest event, which is exactly "the latest state of this game".
const KIND = 30078;
// no 0/O, 1/I/L: easy to read out loud and to type
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export const newRoomCode = () =>
  [...crypto.getRandomValues(new Uint8Array(CODE_LENGTH))].map((b) => ALPHABET[b % ALPHABET.length]).join('');

/** Clean up what someone typed or pasted ("k7q-m2x", a link…); returns the code or null. */
export function parseRoomCode(text: string): string | null {
  const s = String(text).toUpperCase().replace(/^.*#/, '').replace(/[^A-Z0-9]/g, '');
  return s.length === CODE_LENGTH && [...s].every((c) => ALPHABET.includes(c)) ? s : null;
}

export const formatRoomCode = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`;

const enc = new TextEncoder();
const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => Uint8Array.from(s.match(/../g), (h) => parseInt(h, 16));
const sha256 = async (data: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest('SHA-256', data));

/** Key pair shared by both players, derived from the room code. */
async function roomKeys(code: string) {
  const secret = await sha256(enc.encode(`deskmate-room:${code}`));
  return { secret, pubkey: hex(schnorr.getPublicKey(secret)) };
}

/**
 * A connection to one room on several relays at once. Every snapshot goes to all of them and
 * duplicates are dropped on the way in, so the game keeps going while at least one relay works.
 */
/** A Nostr event as relays store it (NIP-01). */
interface NostrEvent { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }

export interface RoomOptions {
  onSnapshot: (snap: Record<string, unknown>) => void;
  onStatus?: (connectedRelays: number) => void;
  relays?: string[];
}

export class Room {
  code: string;
  dTag: string;
  onSnapshot: RoomOptions['onSnapshot'];
  onStatus: NonNullable<RoomOptions['onStatus']>;
  relays: string[];
  sockets: Map<string, WebSocket>;
  seen: Set<string>;
  lastCreated: number;
  lastEvent: NostrEvent | null;
  closed: boolean;
  keys: { secret: Uint8Array; pubkey: string };
  ready: Promise<void>;

  constructor(code: string, opts: RoomOptions) {
    this.code = code;
    this.dTag = `deskmate:${code}`;
    this.onSnapshot = opts.onSnapshot;
    this.onStatus = opts.onStatus || (() => {});
    this.relays = opts.relays || RELAYS;
    this.sockets = new Map(); // url -> WebSocket
    this.seen = new Set(); // event ids already handled
    this.lastCreated = 0; // newest created_at seen or sent, to keep timestamps increasing
    this.lastEvent = null; // re-sent to relays that (re)connect after we published
    this.closed = false;
    this.ready = roomKeys(code).then((k) => { this.keys = k; });
  }

  get connected() {
    let n = 0;
    for (const ws of this.sockets.values()) if (ws.readyState === WebSocket.OPEN) n++;
    return n;
  }

  async connect() {
    await this.ready;
    for (const url of this.relays) this._open(url, 0);
  }

  _open(url, attempt) {
    if (this.closed) return;
    let ws;
    try { ws = new WebSocket(url); } catch { return this._retry(url, attempt); }
    this.sockets.set(url, ws);
    ws.onopen = () => {
      attempt = 0;
      ws.send(JSON.stringify(['REQ', 'dm', { kinds: [KIND], authors: [this.keys.pubkey], '#d': [this.dTag] }]));
      if (this.lastEvent) ws.send(JSON.stringify(['EVENT', this.lastEvent]));
      this.onStatus(this.connected);
    };
    ws.onmessage = (msg) => this._message(msg.data);
    ws.onclose = () => {
      if (this.sockets.get(url) === ws) this.sockets.delete(url);
      this.onStatus(this.connected);
      this._retry(url, attempt + 1);
    };
    ws.onerror = () => ws.close();
  }

  _retry(url, attempt) {
    if (this.closed) return;
    setTimeout(() => this._open(url, attempt), Math.min(30000, 1000 * 2 ** attempt));
  }

  async _message(data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg[0] !== 'EVENT' || !msg[2]) return;
    const ev = msg[2];
    if (this.seen.has(ev.id) || ev.pubkey !== this.keys.pubkey || ev.kind !== KIND) return;
    // a relay could hand us anything: check the event really was signed with the room key
    try {
      const id = hex(await sha256(enc.encode(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]))));
      if (id !== ev.id || !(await schnorr.verifyAsync(unhex(ev.sig), unhex(ev.id), unhex(ev.pubkey)))) return;
    } catch { return; }
    if (this.seen.has(ev.id)) return;
    this.seen.add(ev.id);
    this.lastCreated = Math.max(this.lastCreated, ev.created_at);
    let snap;
    try { snap = JSON.parse(ev.content); } catch { return; }
    this.onSnapshot(snap);
  }

  async publish(snapshot) {
    await this.ready;
    const created_at = Math.max(Math.floor(Date.now() / 1000), this.lastCreated + 1);
    this.lastCreated = created_at;
    const tags = [['d', this.dTag]];
    const content = JSON.stringify(snapshot);
    const id = hex(await sha256(enc.encode(JSON.stringify([0, this.keys.pubkey, created_at, KIND, tags, content]))));
    const sig = hex(await schnorr.signAsync(unhex(id), this.keys.secret));
    const ev = { id, pubkey: this.keys.pubkey, created_at, kind: KIND, tags, content, sig };
    this.seen.add(id);
    this.lastEvent = ev;
    for (const ws of this.sockets.values()) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(['EVENT', ev]));
  }

  close() {
    this.closed = true;
    for (const ws of this.sockets.values()) { ws.onclose = null; ws.close(); }
    this.sockets.clear();
  }
}
