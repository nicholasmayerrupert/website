// The sand runtime's frame/step core: present one frame (render), run one
// fixed simulation step (doFixedStep), the RAF loop with fixed-timestep
// catch-up, camera follow, and the rolling perf samples.
//
// All mutable runtime state lives on the shared `ctx` object owned by
// createSandGame.js.

import { SIZING, STEP_MS, TOOL_IDS } from './runtimeConfig';
import { OFF } from '../wasmBridge/abi.generated.js';

const DEFAULT_MAX_CATCHUP_STEPS = 2;
const catchupStepCap = () => {
  const n = Math.floor(Number(SIZING.maxCatchupSteps));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_CATCHUP_STEPS;
};

export function createGameLoop(ctx, { fit, parallaxCamera, updatePointer, updateMineProgress, onInventory }) {
  const maxCatchupSteps = catchupStepCap();
  const maxCatchupDebtMs = STEP_MS * maxCatchupSteps;
  ctx.catchupStats = {
    maxSteps: maxCatchupSteps,
    stepsThisFrame: 0,
    debtMs: 0,
    droppedDebtMs: 0,
    clamped: false,
  };

  // Rolling perf samples for window.__sandPerf / perfStats()
  const PERF_SAMPLES = 120;
  const perfStepSamples = new Float32Array(PERF_SAMPLES);
  const perfRenderSamples = new Float32Array(PERF_SAMPLES);
  let perfSampleIdx = 0;
  let perfSampleCount = 0;
  // avg + p95 of the sampled step+render frame cost (shared by both perf surfaces).
  const perfFrameSummary = () => {
    const n = perfSampleCount;
    if (!n) return { avg: 0, p95: 0, samples: 0 };
    const sums = [];
    for (let i = 0; i < n; i++) sums.push(perfStepSamples[i] + perfRenderSamples[i]);
    sums.sort((a, b) => a - b);
    return {
      avg: sums.reduce((a, b) => a + b, 0) / n,
      p95: sums[Math.min(n - 1, Math.floor(n * 0.95))],
      samples: n,
    };
  };

  // ---- local player + input helpers ----
  const localPlayer = () => (ctx.engine && ctx.localPlayerId ? ctx.engine.getPlayer(ctx.localPlayerId) : null);
  // Normalized local input each step — the engine builds the bitmask (held keys
  // + mouse-as-primary/secondary) and the aim cell from the forwarded pointer.
  // The net layer sends this to the host.
  const currentLocalInput = () => {
    const a = ctx.engine ? ctx.engine.getAim() : { x: 0, y: 0 };
    return { bits: ctx.engine ? ctx.engine.localInputBits() : 0, aimX: a.x, aimY: a.y, tool: TOOL_IDS[ctx.currentToolName] ?? 0 };
  };
  // Glide the camera toward the followed player's center (clamp + lerp in C++).
  // On a client the followed player is our host-authoritative snapshot entity.
  // Runs every frame, so the local read reuses one scratch object.
  const followScratch = {};
  const followCamera = () => {
    const p = ctx.netClientReady()
      ? ctx.net.getOwnPlayer()
      : (ctx.engine && ctx.localPlayerId ? ctx.engine.getPlayer(ctx.localPlayerId, followScratch) : null);
    if (!p || !ctx.engine) return;
    ctx.engine.cameraFollowTo(p.x + p.w / 2, p.y + p.h / 2);
  };
  const playersForRender = () => (ctx.netClientReady() ? ctx.net.getPlayersForRender() : ctx.engine.getPlayers());

  // ---- present one frame ----
  // The engine owns the whole compositing pipeline: it reads its own camera
  // (camera.inc), uploads the cells whose contents changed (dirty-rect
  // glTexSubImage2D), nearest-upscales the visible window onto the canvas,
  // draws the 1px gutter grid, the player overlay, and the draft preview — all
  // in C++/WebGL. JS only hands it the player set to draw. The sub-cell pan
  // offset is snapped to whole device px inside the engine (the documented
  // bright-block-flicker fix); the snap/gutter A/B flags live there too.
  let packScratch = new Float32Array(0); // grow-only packing buffer (client player upload)
  const render = (full = false) => {
    const engine = ctx.engine;
    if (!engine) return;
    const renderStart = performance.now();
    // Players to overlay. A client renders host-authoritative snapshot players;
    // host/local renders the engine's own players (own = the local id, blue).
    // While the bench is paused we draw none (an empty external set) so the
    // flicker probe sees only the cell grid.
    if (ctx.testPaused) {
      engine.glSetPlayers(true, null, 0);
    } else if (ctx.netClientReady()) {
      const ps = ctx.net.getPlayersForRender();
      const stride = engine.getRenderStrides().player;
      const G = OFF.glPlayerExt;
      const floats = ps.length * stride;
      if (packScratch.length < floats) packScratch = new Float32Array(floats);
      const packed = packScratch.subarray(0, floats);
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i], o = i * stride;
        packed[o + G.x] = p.x; packed[o + G.y] = p.y; packed[o + G.w] = p.w; packed[o + G.h] = p.h;
        packed[o + G.facing] = p.facing; packed[o + G.own] = p.id === ctx.net.ownPlayerId ? 1 : 0;
        packed[o + G.animState] = p.animState || 0; packed[o + G.animFrame] = p.animFrame || 0;
      }
      engine.glSetPlayers(true, packed, ctx.net.ownPlayerId);
    } else {
      engine.glSetPlayers(false, null, ctx.localPlayerId);
    }
    // Dropped items: a client draws the server's authoritative items; host/local
    // (and single-player) draws the engine's own (null = engine-owned).
    engine.glSetItems(ctx.netClientReady() ? ctx.net.getItemsForRender() : null);
    engine.glRenderFrame(full || ctx.forceFullRender);
    ctx.forceFullRender = false;
    ctx.previewDirty = false;
    const cam = engine.getCam();
    ctx.parallax.draw(parallaxCamera(cam));
    ctx.lastCamX = cam.x;
    ctx.lastCamY = cam.y;
    ctx.perfRenderMs = performance.now() - renderStart;
  };

  // ---- one fixed simulation step ----
  // World-shift + input/tool + multiplayer pump + engine.step. Extracted so the
  // main loop AND the deterministic test hook (tickSteps) can drive it
  // identically — the test path is immune to RAF throttling (which otherwise
  // makes two-context multiplayer timing flaky).
  const doFixedStep = (now) => {
    // A server-side close clears the transactional net state. Recreate the
    // local world/player on the next tick just as an explicit Disconnect does.
    if (ctx.survival && !ctx.net.connected && !ctx.localPlayerId) { ctx.cols = 0; ctx.rows = 0; fit(); }
    const engine = ctx.engine;
    if (!engine) return false;
    const isClient = ctx.netClientReady();
    // A client doesn't stream or simulate the shared world — the host is
    // authoritative and replicates it via diffs (applied in net.update()).
    // streamWorld() slides the buffer, the cell texture, and the camera in
    // lockstep.
    if (!isClient) engine.streamWorld();
    // Apply this frame's local input: feed the player (play mode) or run the
    // active tool at the aim cell (draw mode). The engine decides which.
    if (!isClient) {
      if (engine.applyLocalInput(ctx.localPlayerId, now, ++ctx.inputSeq)) ctx.previewDirty = true;
    }
    if (ctx.net.connected) ctx.net.update();
    const didStep = isClient ? false : engine.step(now);
    if (didStep) {
      perfStepSamples[perfSampleIdx] = engine.getPerf().stepMs;
      perfRenderSamples[perfSampleIdx] = ctx.perfRenderMs;
      perfSampleIdx = (perfSampleIdx + 1) % PERF_SAMPLES;
      if (perfSampleCount < PERF_SAMPLES) perfSampleCount++;
    }
    return didStep;
  };

  // ---- main loop ----
  let raf = 0;
  let lastStep = performance.now();
  let lastFrame = performance.now();
  const loop = (now) => {
    raf = requestAnimationFrame(loop);

    // Keep the engine's pointer fresh as the page scrolls under a static cursor
    // (re-derives inside/aim from the new canvas bounds).
    if (ctx.clientX >= 0 && ctx.clientY >= 0) updatePointer(ctx.clientX, ctx.clientY);

    // Per-frame camera pan (free-camera mode): the engine pans from held keys,
    // scaled by real frame time so motion is smooth at any refresh rate. Frame
    // dt is clamped so a long stall (e.g. tab refocus) can't produce a big
    // jump. In play mode the keys drive the player and the camera follows it.
    const frameDt = Math.min(SIZING.maxFrameDtMs, now - lastFrame);
    lastFrame = now;
    ctx.engine?.cameraPanFrame(frameDt);

    // Fixed-timestep simulation with catch-up: world-shift + tool application +
    // engine.step run at STEP_MS for determinism, independent of the per-frame
    // pan above. We run as many steps as the elapsed real time owes (advancing
    // lastStep by STEP_MS each, so the sub-step remainder is preserved) — a
    // frame that runs long no longer permanently drops a step's worth of time,
    // which is what made the survival character crawl under load. Capped at
    // maxCatchupSteps so a long stall (tab refocus) or sustained overload sheds
    // its backlog instead of avalanching; past the cap the sim degrades to
    // slow-motion rather than freezing. A network client never steps the world
    // locally (the host is authoritative), so it just pumps the net at STEP_MS
    // cadence as before.
    //
    // prefers-reduced-motion pauses the ambient simulation (no local stepping)
    // but keeps presenting, so the game reads as paused rather than broken and
    // user-driven pan/aim still works. A connected client keeps pumping the
    // net (the server is authoritative either way).
    let stepped = false;
    if (ctx.reduced && !ctx.netClientReady()) {
      ctx.catchupStats = { maxSteps: maxCatchupSteps, stepsThisFrame: 0, debtMs: 0, droppedDebtMs: 0, clamped: false };
      lastStep = now; // no debt accrues while paused
    } else if (!ctx.testPaused) {
      const debtMs = Math.max(0, now - lastStep);
      let stepsThisFrame = 0;
      let droppedDebtMs = 0;
      let clamped = false;
      if (ctx.netClientReady()) {
        if (debtMs >= STEP_MS) { doFixedStep(now); lastStep = now; stepsThisFrame = 1; }
      } else {
        if (debtMs > maxCatchupDebtMs) {
          droppedDebtMs = debtMs - maxCatchupDebtMs;
          clamped = true;
          lastStep = now - maxCatchupDebtMs;
        }
        while (now - lastStep >= STEP_MS) {
          if (doFixedStep(now)) stepped = true;
          stepsThisFrame++;
          lastStep += STEP_MS;
        }
      }
      ctx.catchupStats = { maxSteps: maxCatchupSteps, stepsThisFrame, debtMs, droppedDebtMs, clamped };
    } else {
      ctx.catchupStats = { maxSteps: maxCatchupSteps, stepsThisFrame: 0, debtMs: 0, droppedDebtMs: 0, clamped: false };
    }

    // Refresh the survival HUD: from the server's inventory when connected as a
    // client (only when it changed), else from the local engine's authoritative
    // snapshot when the sim advanced (pickups/placement happen in steps).
    if (ctx.survival && onInventory) {
      if (ctx.netClientReady()) {
        if (ctx.net.consumeInventoryDirty()) { const inv = ctx.net.getOwnInventory(); if (inv) onInventory(inv); }
      } else if (stepped && ctx.localPlayerId) {
        // Only rebuild + push the snapshot when it actually changed (the hash
        // reads the packed floats without allocating slot objects).
        const h = ctx.engine.inventoryHash(ctx.localPlayerId);
        if (h !== ctx.lastInvHash) { ctx.lastInvHash = h; onInventory(ctx.engine.getInventory(ctx.localPlayerId)); }
      }
    }
    updateMineProgress();

    // Camera follows the local player each frame (smooth at any refresh rate).
    // Skipped while paused so the headless pan/flicker bench keeps full control.
    if (ctx.playMode && !ctx.testPaused) followCamera();

    // Present every frame the camera moved or the sim changed. A camera-only
    // frame is a cheap GPU blit (render() does no CPU pixel work when content
    // is unchanged), so this is safe to run at the display refresh rate.
    const cam = ctx.engine ? ctx.engine.getCam() : { x: ctx.lastCamX, y: ctx.lastCamY };
    const camMoved = cam.x !== ctx.lastCamX || cam.y !== ctx.lastCamY;
    // A connected client animates remote players from snapshots even when its
    // own grid is static, so keep presenting. previewDirty forces a present
    // when a fresh draft overlay appears with no camera/step change.
    if (stepped || camMoved || ctx.previewDirty || ctx.netClientReady()) render(false);
  };

  const start = () => { raf = requestAnimationFrame(loop); };
  const stop = () => cancelAnimationFrame(raf);

  return {
    render,
    doFixedStep,
    localPlayer,
    currentLocalInput,
    followCamera,
    playersForRender,
    perfFrameSummary,
    start,
    stop,
  };
}
