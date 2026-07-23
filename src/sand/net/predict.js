// Local-player prediction and server reconciliation. Deterministic player physics
// allows unacknowledged inputs to be replayed after each authoritative correction
// without advancing the world simulation.

export class Predictor {
  constructor(engine, playerId) {
    this.engine = engine;
    this.id = playerId;
    this.pending = [];   // unacknowledged local inputs: { seq, input }
    this.lastAck = -1;
    // render smoothing: a decaying offset applied to the predicted state so a
    // correction is eased in rather than snapped.
    this.smoothX = 0; this.smoothY = 0;
    this.currentInput = null;
    this.currentInputSeq = 0;
  }

  // Apply one local input and predict forward immediately.
  predict(seq, input) {
    this.engine.setPlayerInput(this.id, { ...input, seq });
    this.engine.stepPlayerOnly(this.id);
    this.pending.push({ seq, input });
    this.currentInput = input;
    this.currentInputSeq = seq;
  }

  // Translate prediction into a new buffer-local coordinate frame while
  // retaining unacknowledged inputs and correction smoothing. `dx`/`dy` are the
  // direct translation applied to local coordinates (normally oldOffset-newOffset).
  rebase(dx, dy) {
    if ((!dx && !dy) || !Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    const state = this.state();
    if (!state) return false;
    const mapInput = (input) => ({
      ...input,
      aimX: Number.isFinite(input?.aimX) ? input.aimX + dx : input?.aimX,
      aimY: Number.isFinite(input?.aimY) ? input.aimY + dy : input?.aimY,
    });
    this.pending = this.pending.map(({ seq, input }) => ({ seq, input: mapInput(input) }));
    if (this.currentInput) this.currentInput = mapInput(this.currentInput);
    this.engine.setPlayerState(this.id, { ...state, x: state.x + dx, y: state.y + dy });
    // setPlayerState intentionally owns only physics fields. Restore the latest
    // translated aim/input too, so held tools remain pointed at the same world cell.
    if (this.currentInput) {
      this.engine.setPlayerInput(this.id, { ...this.currentInput, seq: this.currentInputSeq });
    }
    return true;
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

  // Advance correction easing exactly once per presentation frame. Keeping this
  // separate from renderState() makes camera, audio, HUD, and sprite reads agree
  // even when they all sample the player during one RAF.
  advanceRenderSmoothing(snapThreshold = 16, ease = 0.25) {
    if (Math.hypot(this.smoothX, this.smoothY) > snapThreshold) {
      this.smoothX = 0; this.smoothY = 0;
      return;
    }
    this.smoothX *= (1 - ease); this.smoothY *= (1 - ease);
    if (Math.abs(this.smoothX) < 0.01) this.smoothX = 0;
    if (Math.abs(this.smoothY) < 0.01) this.smoothY = 0;
  }

  // Pure presentation read. A large correction renders authoritative truth
  // immediately; advanceRenderSmoothing() clears that stale offset this frame.
  renderState(snapThreshold = 16) {
    const s = this.state();
    if (!s) return null;
    if (Math.hypot(this.smoothX, this.smoothY) > snapThreshold) return { ...s };
    return { ...s, x: s.x + this.smoothX, y: s.y + this.smoothY };
  }
}
