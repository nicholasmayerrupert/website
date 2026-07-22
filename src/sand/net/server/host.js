// Host-authoritative game host. One peer (the host browser, or a Node test) owns
// the real engine; remote clients send input and receive snapshots. The Host is
// transport-agnostic: feed it decoded/encoded messages via receive(), drive it
// with step(), and read snapshot(). The WebSocket relay (dev-multiplayer-server)
// and the browser client wire a transport around this; none of that logic lives
// here, so it unit-tests in Node without a socket.

import { decode, makeSnapshot, MSG, INPUT_BITS_MAX, TOOL_MAX } from '../protocol.js';
import { SequenceTracker } from './sequencing.js';
import { gridHashU8 } from '../hash.js';

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
    this.actorTick = engine.getActorTick?.() || 0;
    this.worldTick = engine.getTick?.() || 0;
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
  receive(raw, senderClientId = null) {
    const m = typeof raw === 'string' ? decode(raw) : raw;
    if (!m) return null;
    switch (m.t) {
      case MSG.INPUT: return this.applyInput(m, senderClientId ?? m.client) ? MSG.INPUT : null;
      case MSG.LEAVE:
        if (senderClientId !== null && m.client !== senderClientId) return null;
        this.removeClient(m.client); return MSG.LEAVE;
      default: return null; // join/snapshot/ping handled by the transport layer
    }
  }

  applyInput(m, senderClientId = m.client) {
    if (m.client !== senderClientId || m.room !== this.roomId) return false;
    const c = this.clients.get(senderClientId);
    if (!c) return false;                  // unknown client -> reject
    if (m.player !== c.playerId) return false;
    // Defense in depth: never trust a peer's fields even post-decode.
    if (!Number.isInteger(m.seq) || m.seq < 0 || m.seq <= c.tracker.latest ||
        !Number.isInteger(m.bits) || m.bits < 0 || m.bits > INPUT_BITS_MAX ||
        !Number.isInteger(m.tool) || m.tool < 0 || m.tool > TOOL_MAX ||
        !Number.isFinite(m.aimX) || !Number.isFinite(m.aimY) ||
        ((m.moveX !== undefined) !== (m.moveY !== undefined)) ||
        (m.moveX !== undefined && (!Number.isFinite(m.moveX) || !Number.isFinite(m.moveY) || Math.hypot(m.moveX, m.moveY) > 1.000001))) { this.droppedInputs++; return false; }
    // Per-client rate limit (token bucket): a flood is dropped, not simulated.
    const t = this.now();
    c.tokens = Math.min(this.inputBurst, c.tokens + ((t - c.lastInput) / 1000) * this.maxInputRate);
    c.lastInput = t;
    if (c.tokens < 1) { this.droppedInputs++; return false; }
    c.tokens -= 1;
    // Commit sequence progress only after identity, fields, and rate limits all
    // pass. A forged or throttled high sequence cannot lock out later input.
    if (!c.tracker.accept(m.seq)) return false;
    // Aim is world-space so an authority-window shift cannot redirect a held
    // tool while its full snapshot is in flight. Physics still consumes local cells.
    const aimX = Math.max(-1, Math.min(this.engine.cols, (m.aimX - this.engine.getWorldOffsetX()) | 0));
    const aimY = Math.max(-1, Math.min(this.engine.rows, (m.aimY - this.engine.getWorldOffsetY()) | 0));
    this.engine.setPlayerInput(c.playerId, {
      bits: m.bits & INPUT_BITS_MAX, aimX, aimY, tool: m.tool, seq: m.seq,
      moveX: m.moveX, moveY: m.moveY,
    });
    return true;
  }

  stepActors(now = this.actorTick * 16) {
    this.engine.stepActors(now);
    this.actorTick = this.engine.getActorTick();
    return this.actorTick;
  }

  stepWorld() {
    this.engine.stepWorld();
    this.worldTick = this.engine.getTick();
    return this.worldTick;
  }

  // Compatibility path used by deterministic host tests.
  step(now = this.actorTick * 16) {
    this.stepActors(now);
    this.stepWorld();
    return this.actorTick;
  }

  get tick() { return this.actorTick; }

  // Authoritative snapshot of all players. `withHash` includes a world hash so
  // clients can detect divergence / request a resync (Phase 6).
  snapshot({ withHash = false } = {}) {
    const hash = withHash ? gridHashU8(this.engine.getGrid()) : null;
    return makeSnapshot(this.actorTick, this.engine.getPlayers(), hash);
  }
}
