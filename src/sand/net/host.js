// Host-authoritative game host. One peer (the host browser, or a Node test) owns
// the real engine; remote clients send input and receive snapshots. The Host is
// transport-agnostic: feed it decoded/encoded messages via receive(), drive it
// with step(), and read snapshot(). The WebSocket relay (dev-multiplayer-server)
// and the browser client wire a transport around this; none of that logic lives
// here, so it unit-tests in Node without a socket.

import { decode, makeSnapshot, MSG, INPUT_BITS_MAX, TOOL_MAX } from './protocol.js';
import { SequenceTracker } from './client.js';
import { gridHashU8 } from './hash.js';

export class Host {
  constructor({ engine, roomId = 'local', maxPlayers = 8, maxInputRate = 90, inputBurst = 30, now = () => Date.now() } = {}) {
    if (!engine) throw new Error('Host requires an engine');
    this.engine = engine;
    this.roomId = roomId;
    this.maxPlayers = maxPlayers;
    this.maxInputRate = maxInputRate; // inputs/sec/client (token bucket)
    this.inputBurst = inputBurst;     // max burst tokens
    this.now = now;                   // injectable clock (tests)
    this.clients = new Map();   // clientId -> { playerId, tracker, tokens, lastInput }
    this.tick = 0;
    this.droppedInputs = 0;     // diagnostics (rate-limited / invalid)
  }

  hasRoom() { return this.clients.size < this.maxPlayers; }

  // Register a client and spawn its authoritative player. Returns the playerId,
  // or null if the room is full. `spawn` is { x, y } in buffer-local cells.
  addClient(clientId, spawn = { x: 0, y: 0 }) {
    if (this.clients.has(clientId)) return this.clients.get(clientId).playerId;
    if (this.clients.size >= this.maxPlayers) return null; // room full
    const playerId = this.engine.spawnPlayer(spawn.x, spawn.y);
    this.clients.set(clientId, { playerId, tracker: new SequenceTracker(), tokens: this.inputBurst, lastInput: this.now() });
    return playerId;
  }

  removeClient(clientId) {
    const c = this.clients.get(clientId);
    if (!c) return;
    this.engine.removePlayer(c.playerId);
    this.clients.delete(clientId);
  }

  playerIdFor(clientId) { return this.clients.get(clientId)?.playerId ?? 0; }

  // Ingest one message (raw JSON string or already-decoded object). Inputs are
  // applied to the sender's player through a per-client sequence gate so
  // reordered-late / duplicate packets are dropped. Returns the handled message
  // type, or null if it was malformed/ignored.
  receive(raw) {
    const m = typeof raw === 'string' ? decode(raw) : raw;
    if (!m) return null;
    switch (m.t) {
      case MSG.INPUT: return this.applyInput(m) ? MSG.INPUT : null;
      case MSG.LEAVE: this.removeClient(m.client); return MSG.LEAVE;
      default: return null; // join/snapshot/ping handled by the transport layer
    }
  }

  applyInput(m) {
    const c = this.clients.get(m.client);
    if (!c) return false;                  // unknown client -> reject
    if (!c.tracker.accept(m.seq)) return false; // out-of-order / duplicate -> drop
    // Defense in depth: never trust a peer's fields even post-decode.
    if (!Number.isInteger(m.bits) || m.bits < 0 || m.bits > INPUT_BITS_MAX ||
        !Number.isInteger(m.tool) || m.tool < 0 || m.tool > TOOL_MAX ||
        !Number.isFinite(m.aimX) || !Number.isFinite(m.aimY)) { this.droppedInputs++; return false; }
    // Per-client rate limit (token bucket): a flood is dropped, not simulated.
    const t = this.now();
    c.tokens = Math.min(this.inputBurst, c.tokens + ((t - c.lastInput) / 1000) * this.maxInputRate);
    c.lastInput = t;
    if (c.tokens < 1) { this.droppedInputs++; return false; }
    c.tokens -= 1;
    // Clamp the aim into the buffer (+small margin); reach is enforced in C++.
    const aimX = Math.max(-1, Math.min(this.engine.cols, m.aimX | 0));
    const aimY = Math.max(-1, Math.min(this.engine.rows, m.aimY | 0));
    this.engine.setPlayerInput(c.playerId, { bits: m.bits & INPUT_BITS_MAX, aimX, aimY, tool: m.tool, seq: m.seq });
    return true;
  }

  step(now = this.tick * 16) { this.engine.step(now); this.tick++; return this.tick; }

  // Authoritative snapshot of all players. `withHash` includes a world hash so
  // clients can detect divergence / request a resync (Phase 6).
  snapshot({ withHash = false } = {}) {
    const hash = withHash ? gridHashU8(this.engine.getGrid()) : null;
    return makeSnapshot(this.tick, this.engine.getPlayers(), hash);
  }
}
