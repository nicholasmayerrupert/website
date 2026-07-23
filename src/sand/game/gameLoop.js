// Frame and simulation loop: rendering, split actor/world clocks, camera follow,
// and rolling performance samples.
//
// All mutable runtime state lives on the shared `ctx` object owned by
// createSandGame.js.

import { TOOL_IDS } from './runtimeConfig.js';
import { ITEM_KIND, OFF } from '../wasmBridge/abi.generated.js';
import { createFixedRateClock } from '../timing/fixedRateClock.js';
import {
  DAY_CYCLE_MS,
  DAY_VISUAL_STEP_MS,
  DEFAULT_DAY_PHASE,
  dayPhaseAt,
  normalizeDayPhase,
  sampleDayNight,
} from './dayNightCycle.js';

export function createGameLoop(ctx, { fit, parallaxCamera, updatePointer, updateMineProgress, onInventory, onPlayerState }) {
  ctx.timingStats = { actorSteps: 0, actorDebtMs: 0, actorDroppedMs: 0, worldStepped: false };

  // Presentation-only wall clock. Deriving phase from elapsed time lets a
  // backgrounded tab resume at the current point instead of replaying frames.
  const dayCycleStart = performance.now();
  let dayVisualBucket = 0;
  ctx.dayNight = sampleDayNight(DEFAULT_DAY_PHASE);
  ctx.dayVisualKey = 0;

  const applyDayPhase = (phase, visualKey) => {
    ctx.dayNight = sampleDayNight(phase);
    ctx.dayVisualKey = visualKey;
    if (ctx.engine) {
      // Always resend the sampled value. This keeps rapid manual changes and
      // Auto resumption from trusting a stale JS cache; the C++ presenter still
      // compares against its last value and skips redundant lighting solves.
      ctx.engine.setSkyLight(ctx.dayNight.skyLight);
      ctx.appliedSkyLight = ctx.dayNight.skyLight;
    }
    return true;
  };

  const updateDayNight = (now) => {
    if (ctx.testPaused || ctx.reduced || ctx.dayPhaseOverride !== null) return false;
    const elapsed = Math.max(0, now - dayCycleStart);
    const bucket = Math.floor(elapsed / DAY_VISUAL_STEP_MS);
    if (bucket === dayVisualBucket) return false;
    dayVisualBucket = bucket;
    return applyDayPhase(dayPhaseAt(elapsed), bucket);
  };

  const setDayPhase = (phase) => {
    const p = normalizeDayPhase(phase);
    ctx.dayPhaseOverride = p;
    return applyDayPhase(p, `forced:${p.toFixed(6)}`);
  };

  const clearDayPhase = () => {
    ctx.dayPhaseOverride = null;
    const elapsed = Math.max(0, performance.now() - dayCycleStart);
    dayVisualBucket = Math.floor(elapsed / DAY_VISUAL_STEP_MS);
    return applyDayPhase(dayPhaseAt(elapsed), dayVisualBucket);
  };

  // Rolling perf samples for window.__sandPerf / perfStats()
  const PERF_SAMPLES = 120;
  const perfRafSamples = new Float32Array(PERF_SAMPLES);
  let perfSampleIdx = 0;
  let perfSampleCount = 0;
  let lastRafNow = 0;
  let currentRafMs = 0;
  const perfPeaks = {
    rafMs: 0, stepMs: 0, renderMs: 0, lightMs: 0, fillMs: 0, uploadMs: 0,
  };
  // Actual requestAnimationFrame interval, rather than adding the authority
  // worker's concurrent step time to main-thread render time.
  const perfFrameSummary = () => {
    const n = perfSampleCount;
    if (!n) return { avg: 0, p95: 0, samples: 0 };
    const frames = Array.from(perfRafSamples.subarray(0, n)).sort((a, b) => a - b);
    return {
      avg: frames.reduce((a, b) => a + b, 0) / n,
      p95: frames[Math.min(n - 1, Math.floor(n * 0.95))],
      samples: n,
    };
  };

  // ---- local player + input helpers ----
  const localPlayer = () => ctx.netClientReady()
    ? ctx.net.getOwnPlayer()
    : ctx.worldWorker?.getOwnPlayer() || null;
  // Normalized local input each step — the engine builds the bitmask (held keys
  // + mouse-as-primary/secondary) and the aim cell from the forwarded pointer.
  // The net layer sends this to the host.
  const currentLocalInput = () => {
    const a = ctx.engine ? ctx.engine.getAim() : { x: 0, y: 0 };
    const input = { bits: ctx.engine ? ctx.engine.localInputBits() : 0, aimX: a.x, aimY: a.y, tool: TOOL_IDS[ctx.currentToolName] ?? 0 };
    if (Math.abs(ctx.stickX) > 1e-6 || Math.abs(ctx.stickY) > 1e-6) {
      input.moveX = ctx.stickX;
      input.moveY = ctx.stickY;
    }
    return input;
  };
  // Glide the camera toward the followed player's center (clamp + lerp in C++).
  // On a client the followed player is our host-authoritative snapshot entity.
  // Runs every frame, so the local read reuses one scratch object.
  const followCamera = () => {
    const p = localPlayer();
    if (!p || !ctx.engine) return;
    ctx.engine.cameraFollowTo(p.x + p.w / 2, p.y + p.h / 2);
  };
  const playersForRender = () => ctx.netClientReady()
    ? ctx.net.getPlayersForRender()
    : ctx.worldWorker?.getPlayersForRender() || [];

  const audioListener = () => {
    const engine = ctx.engine;
    if (!engine) return null;
    const player = ctx.survival ? localPlayer() : null;
    const cam = engine.getCam();
    const x = player ? player.x + player.w * 0.5 : cam.x + ctx.viewCols * 0.5;
    const y = player ? player.y + player.h * 0.5 : cam.y + ctx.viewRows * 0.5;
    return {
      localX: x, localY: y,
      x: engine.getWorldOffsetX() + x,
      y: engine.getWorldOffsetY() + y,
      viewWidth: ctx.viewCols,
    };
  };

  // ---- present one frame ----
  // The engine owns the whole compositing pipeline: it reads its own camera
  // (camera.inc), uploads the cells whose contents changed (dirty-rect
  // glTexSubImage2D), nearest-upscales the visible window onto the canvas,
  // draws the 1px gutter grid, actor overlays, and the draft preview — all
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
    } else {
      const ps = playersForRender();
      const stride = engine.getRenderStrides().player;
      const G = OFF.glPlayerExt;
      const ownId = ctx.netClientReady() ? ctx.net.ownPlayerId : ctx.worldWorker?.ownPlayerId || 0;
      const liveAim = engine.getAim();
      const floats = ps.length * stride;
      if (packScratch.length < floats) packScratch = new Float32Array(floats);
      const packed = packScratch.subarray(0, floats);
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i], o = i * stride;
        packed[o + G.x] = p.x; packed[o + G.y] = p.y; packed[o + G.w] = p.w; packed[o + G.h] = p.h;
        packed[o + G.facing] = p.facing; packed[o + G.own] = p.id === ownId ? 1 : 0;
        packed[o + G.animState] = p.animState || 0; packed[o + G.animFrame] = p.animFrame || 0;
        packed[o + G.alive] = p.alive === false ? 0 : 1;
        packed[o + G.heldItemKind] = p.heldItemKind || 0; packed[o + G.bowCharge] = p.bowCharge || 0;
        packed[o + G.aimX] = p.id === ownId ? liveAim.x : (p.aimX ?? p.x + p.w * .5 + p.facing);
        packed[o + G.aimY] = p.id === ownId ? liveAim.y : (p.aimY ?? p.y + p.h * .42);
      }
      engine.glSetPlayers(true, packed, ownId);
    }
    // The authority owns inventory selection and mining lock state. Send only
    // the resulting presentation facts to the mirror so its hover footprint
    // matches the size/tool that will actually act on the world.
    if (ctx.survival) {
      const inventory = ctx.netClientReady() ? ctx.net.getOwnInventory() : ctx.worldWorker?.getInventory();
      const ownPlayer = localPlayer();
      const selected = inventory?.slots?.[inventory.selected];
      const erasing = !selected || selected.itemKind === ITEM_KIND.MINING_TOOL || selected.count <= 0;
      const mineTarget = ctx.netClientReady() ? null : ctx.worldWorker?.getMineTarget();
      const usable = !selected || selected.count <= 0 || selected.itemKind === ITEM_KIND.MATERIAL || selected.itemKind === ITEM_KIND.MINING_TOOL;
      engine.glSetSurvivalPreview(ownPlayer?.alive !== false && usable, inventory?.selectedFootprint ?? 2, erasing, mineTarget);
    } else {
      engine.glSetSurvivalPreview(false, 0, false, null);
    }
    // Dropped items: a client draws the server's authoritative items; host/local
    // (and single-player) draws the engine's own (null = engine-owned).
    engine.glSetItems(ctx.netClientReady() ? ctx.net.getItemsForRender() : ctx.worldWorker?.getItemsForRender() || null);
    engine.glSetProjectiles(ctx.netClientReady() ? ctx.net.getProjectilesForRender() : ctx.worldWorker?.getProjectilesForRender() || null);
    engine.glSetCreatures(ctx.netClientReady() ? ctx.net.getCreaturesForRender() : null);
    engine.glRenderFrame(full || ctx.forceFullRender);
    ctx.forceFullRender = false;
    ctx.previewDirty = false;
    const cam = engine.getCam();
    ctx.parallax.draw(parallaxCamera(cam));
    ctx.lastCamX = cam.x;
    ctx.lastCamY = cam.y;
    ctx.perfRenderMs = performance.now() - renderStart;
  };

  const samplePerf = () => {
    const engine = ctx.engine;
    if (!engine) return;
    const perf = engine.getPerf();
    const authorityPerf = ctx.worldWorker?.state || perf;
    perfRafSamples[perfSampleIdx] = currentRafMs;
    perfSampleIdx = (perfSampleIdx + 1) % PERF_SAMPLES;
    if (perfSampleCount < PERF_SAMPLES) perfSampleCount++;
    perfPeaks.rafMs = Math.max(perfPeaks.rafMs, currentRafMs);
    perfPeaks.stepMs = Math.max(perfPeaks.stepMs, authorityPerf.stepMs || 0);
    perfPeaks.renderMs = Math.max(perfPeaks.renderMs, ctx.perfRenderMs || 0);
    perfPeaks.lightMs = Math.max(perfPeaks.lightMs, perf.lightMs || 0);
    perfPeaks.fillMs = Math.max(perfPeaks.fillMs, perf.fillMs || 0);
    perfPeaks.uploadMs = Math.max(perfPeaks.uploadMs, perf.uploadMs || 0);
  };

  // The browser never advances authoritative actors or cells. Its fixed clock
  // sends normalized input to the active authority and predicts only the local
  // survival player; creative uses the same mirror clock for free-camera pan.
  const doActorStep = () => {
    const engine = ctx.engine;
    if (!engine) return false;
    if (!ctx.playMode) engine.cameraPanTick();
    if (ctx.net.connected) ctx.net.update();
    if (ctx.netClientReady() && ctx.worldWorker) ctx.stopLocalAuthority();
    if (ctx.survival && !ctx.net.connected && !ctx.worldWorker) {
      ctx.cols = 0; ctx.rows = 0; fit(); ctx.startLocalAuthority();
    }
    if (!ctx.netClientReady() && ctx.worldWorker && ctx.playMode) {
      ctx.worldWorker.sendInput(currentLocalInput(), ++ctx.inputSeq);
    }
    if (ctx.playMode) followCamera();
    return ctx.playMode || !!ctx.net.connected;
  };

  // Compatibility hook for browser tests: pump one replica/input tick.
  const doFixedStep = (now) => {
    return doActorStep(now);
  };

  // ---- main loop ----
  let raf = 0;
  const clockStart = performance.now();
  const actorClock = createFixedRateClock({ now: clockStart });
  let workerPaused = null;
  let running = false;
  let viewportPaused = false;
  let lastAmbienceSample = -Infinity;
  let lastPlayerStateSignature = '';
  const shouldPauseWorker = () => ctx.testPaused || (ctx.reduced && !ctx.netClientReady());
  const loop = (now) => {
    if (!running || viewportPaused) return;
    raf = requestAnimationFrame(loop);
    const rafDelta = lastRafNow ? now - lastRafNow : 0;
    // Ignore tab suspension and debugger pauses while retaining ordinary slow
    // frames below 100 ms.
    currentRafMs = rafDelta > 0 && rafDelta < 100 ? rafDelta : 0;
    lastRafNow = now;
    const dayChanged = updateDayNight(now);

    // Keep the engine's pointer fresh as the page scrolls under a static cursor
    // (re-derives inside/aim from the new canvas bounds).
    if (ctx.clientX >= 0 && ctx.clientY >= 0) updatePointer(ctx.clientX, ctx.clientY);

    let actorChanged = false;
    let worldChanged = !ctx.netClientReady() && (ctx.worldWorker?.applyPending() || false);
    let timing = { steps: 0, debtMs: 0, droppedDebtMs: 0 };
    const pauseWorker = shouldPauseWorker();
    if (ctx.worldWorker && pauseWorker !== workerPaused) {
      workerPaused = pauseWorker;
      ctx.worldWorker.config({ paused: pauseWorker });
    }
    if (ctx.testPaused) {
      actorClock.reset(now);
    } else if (ctx.reduced && !ctx.netClientReady()) {
      // Preserve the existing local-simulation pause, but keep user-driven free
      // camera motion on the fixed clock.
      timing = actorClock.advance(now, () => ctx.engine?.cameraPanTick());
    } else {
      timing = actorClock.advance(now, () => { if (doActorStep(now)) actorChanged = true; });
      ctx.worldWorker?.updateControl();
    }
    ctx.timingStats = {
      actorSteps: timing.steps,
      actorDebtMs: timing.debtMs,
      actorDroppedMs: timing.droppedDebtMs,
      worldStepped: false,
    };
    const stepped = actorChanged || worldChanged;

    // Events are authority-owned and consumed exactly once. Continuous beds are
    // a cheap fixed-radius presentation query at 8 Hz, independent of zoom and
    // total grid size.
    const listener = audioListener();
    if (listener) {
      const soundEvents = ctx.netClientReady()
        ? ctx.net.consumeSoundEvents()
        : ctx.worldWorker?.consumeSoundEvents();
      if (soundEvents?.length) ctx.audio.playEvents(soundEvents, listener);
      if (ctx.audio.enabled && !ctx.audio.muted && now - lastAmbienceSample >= 125) {
        lastAmbienceSample = now;
        ctx.audio.updateAmbience(ctx.engine.sampleAmbience(listener.localX, listener.localY, 64), listener);
      }
    }

    // Refresh the survival HUD from the active authority only when its inventory
    // revision changes: the server in multiplayer, otherwise the local worker.
    if (ctx.survival && onInventory) {
      if (ctx.netClientReady()) {
        if (ctx.net.consumeInventoryDirty()) { const inv = ctx.net.getOwnInventory(); if (inv) onInventory(inv); }
      } else if (ctx.worldWorker?.consumeInventoryDirty()) {
        const inv = ctx.worldWorker.getInventory();
        if (inv) onInventory(inv);
      }
    }
    if (ctx.survival && onPlayerState) {
      const player = localPlayer();
      const signature = player ? `${player.id}:${player.health}:${player.alive}:${player.deathTicks}:${player.respawnReady}:${player.bowCharge}:${player.heldItemKind}` : '';
      if (signature !== lastPlayerStateSignature) {
        lastPlayerStateSignature = signature;
        onPlayerState(player);
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
    // The local authority's first full snapshot is the first useful cell frame.
    // Until it exists, the parallax canvas is already visible; presenting the
    // empty mirror would perform a full lighting/upload pass that is immediately
    // discarded and can monopolize the page during cold-history restoration.
    const localAuthorityReady = !!ctx.worldWorker?.state?.ready;
    const presentationReady = !ctx.worldWorker || localAuthorityReady || ctx.netClientReady();
    if (presentationReady &&
        (dayChanged || stepped || camMoved || ctx.previewDirty || (!ctx.testPaused && ctx.netClientReady()) || localAuthorityReady)) {
      render(false);
      samplePerf();
    }
  };

  const start = () => {
    if (running) return;
    running = true;
    if (!viewportPaused) raf = requestAnimationFrame(loop);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
  const setViewportPaused = (paused) => {
    const next = !!paused;
    if (next === viewportPaused) return;
    viewportPaused = next;
    const now = performance.now();
    actorClock.reset(now);
    lastRafNow = 0;
    if (next) {
      cancelAnimationFrame(raf);
      if (ctx.worldWorker && workerPaused !== true) {
        workerPaused = true;
        ctx.worldWorker.config({ paused: true });
      }
    } else if (running) {
      // Restore the ordinary reduced-motion/test policy before doing any work.
      // Resetting the fixed clock prevents the offscreen interval from becoming
      // simulation debt.
      const pauseWorker = shouldPauseWorker();
      workerPaused = pauseWorker;
      ctx.worldWorker?.config({ paused: pauseWorker });
      raf = requestAnimationFrame(loop);
    }
  };

  return {
    render,
    doFixedStep,
    localPlayer,
    currentLocalInput,
    followCamera,
    playersForRender,
    perfFrameSummary,
    perfPeaks: () => ({ ...perfPeaks }),
    setDayPhase,
    clearDayPhase,
    getDayNight: () => ({ ...ctx.dayNight, cycleMs: DAY_CYCLE_MS, overridden: ctx.dayPhaseOverride !== null }),
    setViewportPaused,
    start,
    stop,
  };
}
