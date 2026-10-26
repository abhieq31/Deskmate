import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, newRoomCode, parseRoomCode, formatRoomCode, CODE_LENGTH } from '../src/live.ts';

test('room codes are short, readable and forgiving to type', () => {
  for (let i = 0; i < 200; i++) {
    const code = newRoomCode();
    assert.equal(code.length, CODE_LENGTH);
    assert.match(code, /^[A-HJ-KM-NP-Z2-9]+$/);
    assert.equal(parseRoomCode(formatRoomCode(code).toLowerCase()), code);
  }
  assert.equal(parseRoomCode('https://abhieq31.com/deskmate#k7q-m2x'), 'K7QM2X');
  assert.equal(parseRoomCode('K7QM2'), null); // too short
  assert.equal(parseRoomCode('K7QM2O'), null); // O is not in the alphabet
});

// An in-memory relay with the behaviour that matters: keep the newest event per room,
// replay it to new subscribers, forward new events to everyone subscribed.
class FakeRelay {
  constructor() { this.stored = null; this.clients = new Set(); }
}
function fakeWebSocket(relay) {
  return class {
    static OPEN = 1;
    constructor() {
      this.readyState = 0;
      setTimeout(() => { this.readyState = 1; relay.clients.add(this); this.onopen?.(); });
    }
    send(raw) {
      const msg = JSON.parse(raw);
      if (msg[0] === 'REQ') {
        this.sub = msg[1];
        if (relay.stored) this.onmessage?.({ data: JSON.stringify(['EVENT', this.sub, relay.stored]) });
      } else if (msg[0] === 'EVENT') {
        if (!relay.stored || msg[1].created_at >= relay.stored.created_at) relay.stored = msg[1];
        for (const c of relay.clients) if (c.sub) c.onmessage?.({ data: JSON.stringify(['EVENT', c.sub, msg[1]]) });
      }
    }
    close() { this.readyState = 3; relay.clients.delete(this); }
  };
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

test('two rooms with the same code exchange signed snapshots; a late joiner gets the latest', async () => {
  const relay = new FakeRelay();
  globalThis.WebSocket = fakeWebSocket(relay);
  const code = newRoomCode();
  const got = { a: [], b: [], c: [] };
  const a = new Room(code, { relays: ['x'], onSnapshot: (s) => got.a.push(s) });
  const b = new Room(code, { relays: ['x'], onSnapshot: (s) => got.b.push(s) });
  await a.connect(); await b.connect(); await tick();
  await a.publish({ n: 1 }); await tick(50);
  await b.publish({ n: 2 }); await tick(50);
  assert.deepEqual(got.a, [{ n: 2 }]); // own events are not echoed back
  assert.deepEqual(got.b, [{ n: 1 }]);
  const c = new Room(code, { relays: ['x'], onSnapshot: (s) => got.c.push(s) });
  await c.connect(); await tick(50);
  assert.deepEqual(got.c, [{ n: 2 }]);

  // a forged event (wrong signature) is ignored
  const forged = { ...relay.stored, id: 'ab'.repeat(32), content: JSON.stringify({ n: 99 }) };
  for (const cl of relay.clients) cl.onmessage({ data: JSON.stringify(['EVENT', 'dm', forged]) });
  await tick(50);
  assert.deepEqual(got.c, [{ n: 2 }]);
  a.close(); b.close(); c.close();
});
