// Client/host-shared helpers for the multiplayer layer. Transport-agnostic and
// dependency-free so they can be tested in Node. The real WebSocket client and
// the host-authoritative loop build on these in Phase 5.

import { decode, makeInput } from '../protocol.js';

// Monotonic per-source sequence gate: accepts a strictly increasing seq and
// drops anything reordered late or duplicated. This is what makes input/snapshot
// application order-independent over an unreliable transport.
export class SequenceTracker {
  constructor() { this.last = -1; }
  // Returns true if `seq` is newer than everything seen so far (and records it).
  accept(seq) {
    if (!Number.isInteger(seq) || seq <= this.last) return false;
    this.last = seq;
    return true;
  }
  get latest() { return this.last; }
}

// Per-client outbound input numbering. Stamps a monotonically increasing seq on
// each input so the host can order/dedupe and the client can reconcile later.
export class InputSequencer {
  constructor() { this.seq = 0; }
  next(fields) { return makeInput({ ...fields, seq: this.seq++ }); }
}

// Apply a stream of (possibly reordered/duplicated/lossy) encoded input messages
// through a per-player SequenceTracker, returning the inputs that were accepted
// in arrival order. Used by the host and by the reorder/loss test harness.
export function applyInputStream(encodedMessages, trackers = new Map()) {
  const accepted = [];
  for (const raw of encodedMessages) {
    const m = typeof raw === 'string' ? decode(raw) : raw;
    if (!m) continue; // malformed -> dropped
    const key = `${m.client}:${m.player}`;
    let tr = trackers.get(key);
    if (!tr) { tr = new SequenceTracker(); trackers.set(key, tr); }
    if (tr.accept(m.seq)) accepted.push(m);
  }
  return accepted;
}
