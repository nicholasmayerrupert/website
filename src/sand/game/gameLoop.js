// The sand runtime's frame/step core: present one frame (render), run one
// fixed simulation steps, the split actor/world clocks, camera follow, and the
// rolling perf samples.
//
// All mutable runtime state lives on the shared `ctx` object owned by
// createSandGame.js.

import { STEP_MS, TOOL_IDS } from './runtimeConfig';
import { OFF } from '../wasmBridge/abi.generated.js';
import { createFixedRateClock, createNoCatchupGate } from '../timing/fixedRateClock.js';

export function createGameLoop(ctx, { fit, parallaxCamera, updatePointer, updateMineProgress, onInventory }) {
  ctx.timingStats = { actorSteps: 0, actorDebtMs: 0, actorDroppedMs: 0, worldStepped: false };

  // Rolling perf samples for window.__sandPerf / perfStats()
  const PERF_SAMPLES = 120;
  const perfStepSamples = new Float32Array(PERF_SAMPLES);
  const perfActorSamples = new Float32Array(PERF_SAMPLES);
  const perfRenderSamples = new Float32Array(PERF_SAMPLES);
  let perfSampleIdx = 0;
  let perfSampleCount = 0;
  // avg + p95 of the sampled step+render frame cost (shared by both perf surfaces).
  const perfFrameSummary = () => {
    const n = perfSampleCount;
    if (!n) return { avg: 0, p95: 0, samples: 0 };
    const sums = [];
    for (let i = 0; i < n; i++) sums.push(perfActorSamples[i] + perfStepSamples[i] + perfRenderSamples[i]);
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

  // ---- split fixed simulation phases ----
  const ensureOfflinePlayer = () => {
    // A server-side close clears the transactional net state. Recreate the
    // local world/player on the next tick just as an explicit Disconnect does.
    if (ctx.survival && !ctx.net.connected && !ctx.localPlayerId) { ctx.cols = 0; ctx.rows = 0; fit(); }
  };

  const samplePerf = () => {
    const engine = ctx.engine;
    if (!engine) return;
    const perf = engine.getPerf();
    perfActorSamples[perfSampleIdx] = perf.actorMs || 0;
    perfStepSamples[perfSampleIdx] = perf.stepMs || 0;
    perfRenderSamples[perfSampleIdx] = ctx.perfRenderMs;
    perfSampleIdx = (perfSampleIdx + 1) % PERF_SAMPLES;
    if (perfSampleCount < PERF_SAMPLES) perfSampleCount++;
  };

  // Cheap deterministic actor tick: input/prediction, players, items, camera.
  const doActorStep = (now) => {
    ensureOfflinePlayer();
    const engine = ctx.engine;
    if (!engine) return false;
    const isClient = ctx.netClientReady();
    engine.cameraPanTick();
    if (!isClient && ctx.playMode) engine.applyLocalInput(ctx.localPlayerId, now, ++ctx.inputSeq);
    if (ctx.net.connected) ctx.net.update();
    // net.update may apply the initial authoritative world and transition this
    // frame into client mode; do not then also advance the mirror's players.
    const changed = ctx.netClientReady() ? true : engine.stepActors();
    if (ctx.playMode) followCamera();
    return changed;
  };

  // Expensive cellular world phase. The live loop calls this at most once per
  // RAF; creative tools remain world-bound while survival tools live with actors.
  const doWorldStep = (now) => {
    const engine = ctx.engine;
    if (!engine || ctx.netClientReady() || ctx.worldWorker) return false;
    engine.streamWorld();
    if (!ctx.playMode && engine.applyLocalInput(ctx.localPlayerId, now, ++ctx.inputSeq)) ctx.previewDirty = true;
    return engine.stepWorld();
  };

  // Compatibility hook for deterministic browser tests: one actor tick followed
  // by one world tick, matching Engine::step().
  const doFixedStep = (now) => {
    const actors = doActorStep(now);
    const world = doWorldStep(now);
    return actors || world;
  };

  // ---- main loop ----
  let raf = 0;
  const clockStart = performance.now();
  const actorClock = createFixedRateClock({ now: clockStart });
  const worldGate = createNoCatchupGate({ stepMs: STEP_MS, now: clockStart });
  let workerPaused = null;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);

    // Keep the engine's pointer fresh as the page scrolls under a static cursor
    // (re-derives inside/aim from the new canvas bounds).
    if (ctx.clientX >= 0 && ctx.clientY >= 0) updatePointer(ctx.clientX, ctx.clientY);

    let actorChanged = false;
    let worldChanged = ctx.worldWorker?.applyPending() || false;
    let worldStepped = false;
    let timing = { steps: 0, debtMs: 0, droppedDebtMs: 0 };
    const pauseWorker = ctx.testPaused || (ctx.reduced && !ctx.netClientReady());
    if (ctx.worldWorker && pauseWorker !== workerPaused) {
      workerPaused = pauseWorker;
      ctx.worldWorker.config({ paused: pauseWorker });
    }
    if (ctx.testPaused) {
      actorClock.reset(now);
      worldGate.reset(now);
    } else if (ctx.reduced && !ctx.netClientReady()) {
      // Preserve the existing local-simulation pause, but keep user-driven free
      // camera motion on the fixed clock.
      timing = actorClock.advance(now, () => ctx.engine?.cameraPanTick());
      worldGate.reset(now);
    } else {
      timing = actorClock.advance(now, () => { if (doActorStep(now)) actorChanged = true; });
      ctx.worldWorker?.updateControl();
      if (ctx.netClientReady() || ctx.worldWorker) {
        worldGate.reset(now);
      } else if (worldGate.take(now)) {
        worldStepped = true;
        worldChanged = doWorldStep(now);
      }
    }
    ctx.timingStats = {
      actorSteps: timing.steps,
      actorDebtMs: timing.debtMs,
      actorDroppedMs: timing.droppedDebtMs,
      worldStepped,
    };
    const stepped = actorChanged || worldChanged;

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

    // Present every frame the camera moved or the sim changed. A camera-only
    // frame is a cheap GPU blit (render() does no CPU pixel work when content
    // is unchanged), so this is safe to run at the display refresh rate.
    const cam = ctx.engine ? ctx.engine.getCam() : { x: ctx.lastCamX, y: ctx.lastCamY };
    const camMoved = cam.x !== ctx.lastCamX || cam.y !== ctx.lastCamY;
    // A connected client animates remote players from snapshots even when its
    // own grid is static, so keep presenting. previewDirty forces a present
    // when a fresh draft overlay appears with no camera/step change.
    if (stepped || camMoved || ctx.previewDirty || ctx.netClientReady()) {
      render(false);
      samplePerf();
    }
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
