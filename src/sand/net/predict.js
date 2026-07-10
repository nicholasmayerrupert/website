// Client-side prediction + server reconciliation for the local player. Because
// the player physics is deterministic (same inputs + same world -> same state),
// the client can simulate its own player immediately (no input lag) and, when the
// host's authoritative state arrives, snap to it and replay the inputs the host
// hasn't processed yet. With no divergence the replay reproduces the prediction
// exactly; on a mismatch it converges in one correction.
//
// The predictor drives one player in a (client-owned) engine via stepPlayerOnly /
// setPlayerState, so it never runs the host-authoritative world simulation.

export class Predictor {
  constructor(engine, playerId) {
    this.engine = engine;
    this.id = playerId;
    this.pending = [];   // unacknowledged local inputs: { seq, input }
    this.lastAck = -1;
    // render smoothing: a decaying offset applied to the predicted state so a
    // correction is eased in rather than snapped.
    this.smoothX = 0; this.smoothY = 0;
  }

  // Apply one local input and predict forward immediately.
  predict(seq, input) {
    this.engine.setPlayerInput(this.id, { ...input, seq });
    this.engine.stepPlayerOnly(this.id);
    this.pending.push({ seq, input });
  }

  // Authoritative correction: `authState` is the host's state for our player and
  // `ackedSeq` the last input seq the host processed. Reorders are ignored.
  // Returns the post-correction error (cells) the smoother will absorb.
  reconcile(authState, ackedSeq, actorTick = 0) {
    if (ackedSeq < this.lastAck) return 0; // stale/reordered correction -> ignore
    this.lastAck = ackedSeq;
    const before = this.engine.getPlayer(this.id);
    // drop acknowledged inputs, snap to authority, replay the rest.
    this.pending = this.pending.filter((e) => e.seq > ackedSeq);
    this.engine.syncActorTick(actorTick);
    this.engine.setPlayerState(this.id, authState);
    for (const e of this.pending) {
      this.engine.setPlayerInput(this.id, { ...e.input, seq: e.seq });
      this.engine.stepPlayerOnly(this.id);
    }
    const after = this.engine.getPlayer(this.id);
    // accumulate the visual error into the smoothing offset (so the camera/sprite
    // glides to the corrected position instead of teleporting).
    const ex = (before ? before.x : after.x) - after.x;
    const ey = (before ? before.y : after.y) - after.y;
    this.smoothX += ex; this.smoothY += ey;
    return Math.hypot(ex, ey);
  }

  // Authoritative state of the predicted player.
  state() { return this.engine.getPlayer(this.id); }

  // Render state with the correction error eased in (call once per frame). Hard
  // snaps when the error is large so it never lags far behind the truth.
  renderState(snapThreshold = 16, ease = 0.25) {
    const s = this.state();
    if (!s) return null;
    if (Math.hypot(this.smoothX, this.smoothY) > snapThreshold) { this.smoothX = 0; this.smoothY = 0; }
    this.smoothX *= (1 - ease); this.smoothY *= (1 - ease);
    if (Math.abs(this.smoothX) < 0.01) this.smoothX = 0;
    if (Math.abs(this.smoothY) < 0.01) this.smoothY = 0;
    return { ...s, x: s.x + this.smoothX, y: s.y + this.smoothY };
  }
}
