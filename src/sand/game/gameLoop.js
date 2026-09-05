// Frame and simulation loop: rendering, split actor/world clocks, camera follow,
// and rolling performance samples.
//
// All mutable runtime state lives on the shared `ctx` object owned by
// createSandGame.js.

import { TOOL_IDS } from './runtimeConfig.js';
import { ITEM_KIND, WEATHER, writeGlPlayerExtSnapshot } from '../wasmBridge/abi.generated.js';
import { createFixedRateClock } from '../timing/fixedRateClock.js';
import {
  DAY_CYCLE_MS,
  DAY_VISUAL_STEP_MS,
  DEFAULT_DAY_PHASE,
  dayPhaseAt,
  normalizeDayPhase,
  sampleDayNight,
} from './dayNightCycle.js';
import { sampleAutoWeather, weatherSkyLight } from './weather.js';

const WEATHER_VISUAL_STEP_MS = 50;

/** @param {import('./runtimeContext.js').SandRuntimeContext} ctx */
export function createGameLoop(ctx, {
  parallaxCamera,
  updatePointer,
  updateMineProgress,
  onInventory,
  onPlayerState,
  onMission,
}) {
  ctx.timingStats = { actorSteps: 0, actorDebtMs: 0, actorDroppedMs: 0, worldStepped: false };

  // Presentation-only wall clock. Deriving phase from elapsed time lets a
  // backgrounded tab resume at the current point instead of replaying frames.
  const dayCycleStart = performance.now();
  const weatherCycleStart = dayCycleStart;
  ctx.weatherCycleStart = weatherCycleStart;
  let dayVisualBucket = 0;
  let weatherVisualBucket = 0;
  let weatherMixBucket = Math.round((ctx.weatherMix ?? 0) * 16);
  ctx.dayNight = sampleDayNight(DEFAULT_DAY_PHASE);
  ctx.dayVisualKey = 0;
  ctx.weatherVisualKey = 0;
  const animatesRain = () => (ctx.weatherMix ?? 0) > 0.02;

  const applyDayPhase = (phase, visualKey) => {
    ctx.dayNight = sampleDayNight(phase);
    ctx.dayVisualKey = visualKey;
    if (ctx.engine) {
      // Always resend the sampled value. This keeps rapid manual changes and
      // Auto resumption from trusting a stale JS cache; the C++ presenter still
      // compares against its last value and skips redundant lighting solves.
      const skyLight = weatherSkyLight(
        ctx.dayNight.skyLight, WEATHER.RAIN, ctx.weatherMix ?? 0,
      );
      ctx.engine.setSkyLight(skyLight);
      ctx.appliedSkyLight = skyLight;
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

  const updateWeatherVisual = (now) => {
    if (ctx.testPaused || ctx.reduced) return false;
    let changed = false;
    if (ctx.weatherMode === 'auto') {
      // The cycle is a pure function of elapsed wall clock (like day/night).
      // The discrete kind flip is mirrored to the authority via a journaled
      // weather message; everything visual interpolates on the mix.
      const sample = sampleAutoWeather(now - weatherCycleStart);
      const bucket = Math.round(sample.mix * 16);
      if (bucket !== weatherMixBucket) {
        weatherMixBucket = bucket;
        ctx.weatherMix = bucket / 16;
        changed = true;
        if (ctx.engine) {
          const skyLight = weatherSkyLight(
            ctx.dayNight.skyLight, WEATHER.RAIN, ctx.weatherMix,
          );
          ctx.engine.setSkyLight(skyLight);
          ctx.appliedSkyLight = skyLight;
        }
      }
      if (sample.id !== ctx.weatherId) {
        ctx.weatherId = sample.id;
        changed = true;
        ctx.worldWorker?.sendWeather?.(sample.id);
        ctx.engine?.setWeather(sample.id);
      }
    }
    if (!animatesRain()) return changed;
    const bucket = Math.floor(Math.max(0, now) / WEATHER_VISUAL_STEP_MS);
    if (bucket === weatherVisualBucket) return changed;
    weatherVisualBucket = bucket;
    ctx.weatherVisualKey = bucket;
    return true;
  };

  const setWeatherOverride = (id) => {
    // id: WEATHER.RAIN, WEATHER.CLEAR, or null to resume the auto cycle.
    if (id === null || id === undefined) {
      ctx.weatherMode = 'auto';
      const sample = sampleAutoWeather(performance.now() - weatherCycleStart);
      weatherMixBucket = Math.round(sample.mix * 16);
      ctx.weatherMix = weatherMixBucket / 16;
      if (sample.id !== ctx.weatherId) {
        ctx.weatherId = sample.id;
        ctx.worldWorker?.sendWeather?.(sample.id);
      }
    } else {
      const next = id === WEATHER.RAIN ? WEATHER.RAIN : WEATHER.CLEAR;
      ctx.weatherMode = 'pin';
      weatherMixBucket = next === WEATHER.RAIN ? 16 : 0;
      ctx.weatherMix = weatherMixBucket / 16;
      if (ctx.weatherId !== next) {
        ctx.worldWorker?.sendWeather?.(next);
      }
      ctx.weatherId = next;
    }
    if (ctx.engine) {
      ctx.engine.setWeather(ctx.weatherId);
      const skyLight = weatherSkyLight(
        ctx.dayNight.skyLight, WEATHER.RAIN, ctx.weatherMix,
      );
      ctx.engine.setSkyLight(skyLight);
      ctx.appliedSkyLight = skyLight;
    }
    return true;
  };

  const setDayPhase = (phase) => {
    const p = normalizeDayPhase(phase);
    ctx.dayPhaseOverride = p;
    recordDayPhase(true);
    return applyDayPhase(p, `forced:${p.toFixed(6)}`);
  };

  const clearDayPhase = () => {
    ctx.dayPhaseOverride = null;
    const elapsed = Math.max(0, performance.now() - dayCycleStart);
    dayVisualBucket = Math.floor(elapsed / DAY_VISUAL_STEP_MS);
    const changed = applyDayPhase(dayPhaseAt(elapsed), dayVisualBucket);
    recordDayPhase(false);
    return changed;
  };

  const applyReplayDayPhase = ({ phase, overridden }) => {
    if (overridden) {
      const p = normalizeDayPhase(phase);
      ctx.dayPhaseOverride = p;
      return applyDayPhase(p, `forced:${p.toFixed(6)}`);
    }
    ctx.dayPhaseOverride = null;
    const elapsed = Math.max(0, performance.now() - dayCycleStart);
    dayVisualBucket = Math.floor(elapsed / DAY_VISUAL_STEP_MS);
    return applyDayPhase(dayPhaseAt(elapsed), dayVisualBucket);
  };

  const recordDayPhase = (overridden) => {
    if (ctx.worldWorker?.state?.replayPlaying) return;
    ctx.worldWorker?.sendDayPhase?.({
      phase: overridden ? ctx.dayPhaseOverride : ctx.dayNight.phase,
      overridden,
    });
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
  const localPlayer = () => ctx.worldWorker?.getOwnPlayer() || null;
  // Normalized local input each step — the engine builds the bitmask (held keys
  // + mouse-as-primary/secondary) and the aim cell from the forwarded pointer.
  // The authority worker consumes this normalized input.
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
  // Runs every frame, so the local read reuses one scratch object.
  const followCamera = () => {
    const p = localPlayer();
    if (!p || !ctx.engine) return;
    ctx.engine.cameraFollowTo(p.x + p.w / 2, p.y + p.h / 2);
  };
  const playersForRender = () => ctx.worldWorker?.getPlayersForRender() || [];

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
  let packScratch = new Float32Array(0); // grow-only player upload buffer
  const unsetRenderSource = Symbol('unset-render-source');
  let lastWorkerItems = unsetRenderSource;
  let lastWorkerProjectiles = unsetRenderSource;
  const render = (full = false) => {
    const engine = ctx.engine;
    if (!engine) return;
    const renderStart = performance.now();
    // Players to overlay come from authority-worker snapshots (own = blue).
    // While the bench is paused we draw none (an empty external set) so the
    // flicker probe sees only the cell grid.
    if (ctx.testPaused) {
      engine.glSetPlayers(true, null, 0);
    } else {
      const ps = playersForRender();
      const stride = engine.getRenderStrides().player;
      const ownId = ctx.worldWorker?.ownPlayerId || 0;
      const liveAim = engine.getAim();
      const floats = ps.length * stride;
      if (packScratch.length < floats) packScratch = new Float32Array(floats);
      const packed = packScratch.subarray(0, floats);
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i], o = i * stride;
        const own = p.id === ownId;
        writeGlPlayerExtSnapshot(
          packed, o, p, own, p.animState || 0, p.animFrame || 0,
          p.alive !== false, p.heldItemKind || 0, p.bowCharge || 0,
          own ? liveAim.x : (p.aimX ?? p.x + p.w * .5 + p.facing),
          own ? liveAim.y : (p.aimY ?? p.y + p.h * .42),
          p.jetpackFuel ?? 1, !!p.jetpackActive,
          p.shieldHealth ?? 200, !!p.shieldActive,
          p.weaponKick || 0, p.hurtCooldown || 0,
        );
      }
      engine.glSetPlayers(true, packed, ownId);
    }
    // The authority owns inventory selection and mining lock state. Send only
    // the resulting presentation facts to the mirror so its hover footprint
    // matches the size/tool that will actually act on the world.
    if (ctx.survival) {
      const inventory = ctx.worldWorker?.getInventory();
      const ownPlayer = localPlayer();
      const selected = inventory?.slots?.[inventory.selected];
      const erasing = !selected || selected.itemKind === ITEM_KIND.MINING_TOOL || selected.count <= 0;
      const mineTarget = ctx.worldWorker?.getMineTarget();
      const usable = !selected || selected.count <= 0 || selected.itemKind === ITEM_KIND.MATERIAL || selected.itemKind === ITEM_KIND.MINING_TOOL;
      engine.glSetSurvivalPreview(ownPlayer?.alive !== false && usable, inventory?.selectedFootprint ?? 2, erasing, mineTarget);
    } else {
      engine.glSetSurvivalPreview(false, 0, false, null);
    }
    // Dropped items and projectiles come from the authority worker.
    if (full || ctx.forceFullRender) {
      lastWorkerItems = unsetRenderSource;
      lastWorkerProjectiles = unsetRenderSource;
    }
    const nextItems = ctx.worldWorker?.getItemsForRender() || null;
    const nextProjectiles = ctx.worldWorker?.getProjectilesForRender() || null;
    if (nextItems !== lastWorkerItems) {
      engine.glSetItems(nextItems);
      lastWorkerItems = nextItems;
    }
    if (nextProjectiles !== lastWorkerProjectiles) {
      engine.glSetProjectiles(nextProjectiles);
      lastWorkerProjectiles = nextProjectiles;
    }
    engine.glSetCreatures(null);
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
    const replayPlaying = !!ctx.worldWorker?.state?.replayPlaying;
    if (!ctx.playMode && !replayPlaying) engine.cameraPanTick();
    if (!replayPlaying && ctx.worldWorker && ctx.playMode) {
      ctx.worldWorker.sendInput(currentLocalInput(), ++ctx.inputSeq);
    }
    if (ctx.playMode && !replayPlaying) followCamera();
    return ctx.playMode;
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
  const shouldPauseWorker = () => ctx.testPaused || ctx.reduced;
  const loop = (now) => {
    if (!running || viewportPaused) return;
    raf = requestAnimationFrame(loop);
    const rafDelta = lastRafNow ? now - lastRafNow : 0;
    // Ignore tab suspension and debugger pauses while retaining ordinary slow
    // frames below 100 ms.
    currentRafMs = rafDelta > 0 && rafDelta < 100 ? rafDelta : 0;
    lastRafNow = now;
    const dayChanged = updateDayNight(now);
    const weatherChanged = updateWeatherVisual(now);

    // Keep the engine's pointer fresh as the page scrolls under a static cursor
    // (re-derives inside/aim from the new canvas bounds).
    if (ctx.clientX >= 0 && ctx.clientY >= 0) updatePointer(ctx.clientX, ctx.clientY);

    let actorChanged = false;
    let worldChanged = ctx.worldWorker?.applyPending() || false;
    // Advance correction easing once before any camera/audio/HUD/render reads.
    // renderState() is otherwise pure, so every consumer in this RAF sees one
    // consistent player pose even if the fixed clock runs multiple steps.
    ctx.worldWorker?.advancePresentation?.();
    let timing = { steps: 0, debtMs: 0, droppedDebtMs: 0 };
    const pauseWorker = shouldPauseWorker();
    if (ctx.worldWorker && pauseWorker !== workerPaused) {
      workerPaused = pauseWorker;
      ctx.worldWorker.config({ paused: pauseWorker });
    }
    if (ctx.testPaused) {
      actorClock.reset(now);
    } else if (ctx.reduced) {
      // Preserve the existing local-simulation pause, but keep user-driven free
      // camera motion on the fixed clock.
      timing = actorClock.advance(now, () => ctx.engine?.cameraPanTick());
    } else {
      timing = actorClock.advance(now, () => { if (doActorStep(now)) actorChanged = true; });
      if (!ctx.worldWorker?.state?.replayPlaying) ctx.worldWorker?.updateControl();
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
      ctx.audio.updatePlayerEffects(ctx.survival ? localPlayer() : null);
      const soundEvents = ctx.worldWorker?.consumeSoundEvents();
      if (soundEvents?.length) ctx.audio.playEvents(soundEvents, listener);
      if (ctx.audio.enabled && !ctx.audio.muted && now - lastAmbienceSample >= 125) {
        lastAmbienceSample = now;
        ctx.audio.updateAmbience(ctx.engine.sampleAmbience(listener.localX, listener.localY, 64), listener);
      }
    }

    // Refresh the survival HUD only when the authority inventory revision changes.
    if (ctx.survival && onInventory) {
      if (ctx.worldWorker?.consumeInventoryDirty()) {
        const inv = ctx.worldWorker.getInventory();
        if (inv) onInventory(inv);
      }
    }
    if (ctx.survival && onPlayerState) {
      const player = localPlayer();
      const signature = player ? `${player.id}:${player.health}:${player.alive}:${player.deathTicks}:${player.respawnReady}:${player.bowCharge}:${player.heldItemKind}:${player.jetpackFuel}:${player.jetpackActive}:${player.shieldHealth}:${player.shieldActive}` : '';
      if (signature !== lastPlayerStateSignature) {
        lastPlayerStateSignature = signature;
        onPlayerState(player);
      }
    }
    if (onMission && ctx.worldWorker?.consumeMissionDirty()) {
      const mission = ctx.worldWorker.getMission();
      if (mission) onMission(mission);
    }
    updateMineProgress();

    // Present every frame the camera moved or the sim changed. A camera-only
    // frame is a cheap GPU blit (render() does no CPU pixel work when content
    // is unchanged), so this is safe to run at the display refresh rate.
    const cam = ctx.engine ? ctx.engine.getCam() : { x: ctx.lastCamX, y: ctx.lastCamY };
    const camMoved = cam.x !== ctx.lastCamX || cam.y !== ctx.lastCamY;
    // previewDirty forces a present when a fresh draft overlay appears with no
    // camera/step change.
    // The local authority's first full snapshot is the first useful cell frame.
    // Until it exists, the parallax canvas is already visible; presenting the
    // empty mirror would perform a full lighting/upload pass that is immediately
    // discarded and can monopolize the page during cold-history restoration.
    const localAuthorityReady = !!ctx.worldWorker?.state?.ready;
    const presentationReady = !ctx.worldWorker || localAuthorityReady;
    if (presentationReady &&
        (dayChanged || weatherChanged || stepped || camMoved || ctx.previewDirty || localAuthorityReady)) {
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
    localPlayer,
    currentLocalInput,
    followCamera,
    playersForRender,
    perfFrameSummary,
    perfPeaks: () => ({ ...perfPeaks }),
    setDayPhase,
    clearDayPhase,
    applyReplayDayPhase,
    getDayNight: () => ({ ...ctx.dayNight, cycleMs: DAY_CYCLE_MS, overridden: ctx.dayPhaseOverride !== null }),
    setWeatherOverride,
    getWeatherState: () => ({
      id: ctx.weatherId,
      mode: ctx.weatherMode,
      overridden: ctx.weatherMode === 'pin',
      rain: ctx.weatherId === WEATHER.RAIN,
    }),
    setViewportPaused,
    start,
    stop,
  };
}
