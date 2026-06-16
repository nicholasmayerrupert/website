// Host-authoritative game host. One peer (the host browser, or a Node test) owns
// the real engine; remote clients send input and receive snapshots. The Host is
// transport-agnostic: feed it decoded/encoded messages via receive(), drive it
// with step(), and read snapshot(). The WebSocket relay (dev-multiplayer-server)
// and the browser client wire a transport around this; none of that logic lives
// here, so it unit-tests in Node without a socket.

import { decode, makeSnapshot, MSG } from './protocol.js';
import { SequenceTracker } from './client.js';
import { gridHashU8 } from './hash.js';

export class Host {
  constructor({ engine, roomId = 'local', maxPlayers = 8 } = {}) {
    if (!engine) throw new Error('Host requires an engine');
    this.engine = engine;
    this.roomId = roomId;
    this.maxPlayers = maxPlayers;
    this.clients = new Map();   // clientId -> { playerId, tracker }
    this.tick = 0;
  }

  hasRoom() { return this.clients.size < this.maxPlayers; }

  // Register a client and spawn its authoritative player. Returns the playerId,
  // or null if the room is full. `spawn` is { x, y } in buffer-local cells.
  addClient(clientId, spawn = { x: 0, y: 0 }) {
    if (this.clients.has(clientId)) return this.clients.get(clientId).playerId;
    if (this.clients.size >= this.maxPlayers) return null;
    const playerId = this.engine.spawnPlayer(spawn.x, spawn.y);
    this.clients.set(clientId, { playerId, tracker: new SequenceTracker() });
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
    this.engine.setPlayerInput(c.playerId, {
      bits: m.bits, aimX: m.aimX, aimY: m.aimY, tool: m.tool, seq: m.seq,
    });
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
