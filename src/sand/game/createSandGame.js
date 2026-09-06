// Framework-agnostic browser runtime for the C++/WASM sand engine. It owns one
// shared `ctx`, composes lifecycle/input/loop/audio/worker modules, and
// returns the handle used by the Web Component. C++ owns simulation, rendering,
// camera, pointer mapping, actors, tools, and terrain; JS owns DOM events,
// lifecycle, audio presentation, workers, and replay.

import { BUTTON_BITS, DEFAULT_TOOL, SIZING, TOOL_IDS } from './runtimeConfig';
import { createParallaxBackground } from './parallaxBackground';
import { createEngineLifecycle } from './engineLifecycle';
import { createInputBindings } from './inputBindings';
import { createGameLoop } from './gameLoop';
import { installDevHooks } from './devHooks';
import { applyCreatureRuntimePolicy } from './creatureRuntimePolicy';
import { createWorldWorkerClient } from '../worker/worldWorkerClient.js';
import { createSandAudio } from '../audio/sandAudio.js';
import { createReplayPanel } from './replayPanel.js';
import {
  CREATIVE_KIND, CREATURE, MISSION, PLANET, WEATHER,
} from '../wasmBridge/abi.generated.js';
import { MAT } from '../materials.js';
import { resolvePlanetId } from './planetSelection.js';
import {
  DEFAULT_WEATHER_ID,
  resolveWeatherIdForPlanet,
  resolveWeatherMode,
  sampleAutoWeather,
} from './weather.js';

export function createSandGame(container, opts = {}) {
  const {
    initialTool = DEFAULT_TOOL,
    onLayoutChange,
    reducedMotion,
    // 'survival' (default): an armed player character and follow camera.
    // 'creative': free camera (WASD pans the infinite world), draw tools
    // place/erase anywhere with no reach limit, no character.
    mode = 'survival',
    planet = 'earth',
    // Pinned clear by default; 'auto' opts into the clear/rain cycle and
    // 'rain' pins rain. The palette's Rain button overrides at runtime.
    weather = DEFAULT_WEATHER_ID,
    gravityScale,
    mission = null,
    worldSeed,
    loadout = [],
    // /fps enables engine-owned creature actors plus AABB outlines while
    // retaining creative controls and the performance HUD.
    debugHitboxes = false,
    // Survival inventory hooks: onInventory(snapshot) feeds the hotbar/modal HUD
    // when it changes. The inventory itself is authoritative in the engine —
    // these only move snapshots out and intents in. The toggle hooks remain as
    // harmless compatibility inputs for older embeds.
    onInventory = null,
    onPlayerState = null,
    onMission = null,
    onInteraction = null,
    onToggleInventory = null,
    onToggleFootprintMenu = null,
    onEquipCreativeMaterial = null,
    onReplayUi = null,
  } = opts;
  const survival = mode === 'survival';
  const planetId = resolvePlanetId(planet);
  const weatherMode = resolveWeatherMode(weather);
  // Auto cycling needs a planet whose weather can include rain; elsewhere the
  // session stays pinned clear. The mix is 1 only for a pinned rain profile.
  const autoWeather = weatherMode === 'auto'
    && resolveWeatherIdForPlanet(WEATHER.RAIN, planetId) === WEATHER.RAIN;
  const pinnedWeatherId = weatherMode === 'pin'
    ? resolveWeatherIdForPlanet(weather, planetId)
    : DEFAULT_WEATHER_ID;
  const weatherId = autoWeather ? sampleAutoWeather(0).id : pinnedWeatherId;
  const weatherMix = autoWeather ? 0 : (weatherId === WEATHER.RAIN ? 1 : 0);
  const resolvedGravityScale = Number.isFinite(gravityScale)
    ? gravityScale
    : undefined;
  const missionId = typeof mission === 'number'
    ? mission
    : ({
      'frontier': MISSION.FRONTIER,
      'greenfall-recovery': MISSION.GREENFALL_RECOVERY,
      'silent-quarry': MISSION.SILENT_QUARRY,
      'red-furnace': MISSION.RED_FURNACE,
    }[String(mission || '').toLowerCase()] ?? MISSION.NONE);
  const missionLoadout = Array.isArray(loadout) ? loadout : [];

  // Host canvas; the WASM engine owns its WebGL2 context and compositing.
  const parallax = createParallaxBackground(container, { planetId });
  const audio = createSandAudio({
    expeditionScore: survival && (planetId === PLANET.SHIP || missionId === MISSION.GREENFALL_RECOVERY),
  });

  const canvas = document.createElement('canvas');
  canvas.id = 'sand-main'; // stable selector for the headless pan/flicker bench
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.zIndex = '1';
  canvas.style.pointerEvents = 'none';
  canvas.style.userSelect = 'none';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);

  // Shared runtime state. Every module reads/writes this one object; the
  // fields are grouped by owner. ctx.fns holds late-bound cross-module calls
  // (set after the owning module is created).
  /** @type {import('./runtimeContext.js').SandRuntimeContext} */
  const ctx = {
    container, canvas, parallax, audio, survival, debugHitboxes: !!debugHitboxes,
    planetId, weatherId, weatherMode: autoWeather ? 'auto' : 'pin', weatherMix,
    gravityScale: resolvedGravityScale, missionId,
    missionLoadout,
    // One seed per mount so resizing regenerates the *same* infinite world.
    worldSeed: Number.isFinite(worldSeed)
      ? worldSeed >>> 0
      : (Math.random() * 4294967296) >>> 0,
    // devicePixelRatio at load. Browser page zoom later changes dpr (and the
    // CSS box) together; this is the "100%" baseline so the sim ignores page zoom.
    baselineDpr: (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
    // WebGL2 guarantees at least 2048. The actual device limit replaces this
    // conservative bootstrap value as soon as the renderer creates its context.
    maxTextureSize: 2048,

    // engine + buffer/view dimensions (engineLifecycle). cols/rows are the
    // BUFFER (world) dims; viewCols/viewRows the visible window. cellSize is
    // CSS px per cell; cellDev the integer DEVICE px per cell (the backing
    // store is device-px-exact — the documented bright-block-flicker fix).
    engine: null,
    cols: 0, rows: 0,
    cellSize: SIZING.cellPx, cellDev: SIZING.cellPx, dpr: 1,
    viewCols: 0, viewRows: 0,
    requestedViewCols: 0, requestedViewRows: 0,
    requestedBufferCols: 0, requestedBufferRows: 0,
    stableCssSize: null,
    // Continuous zoom factor (1 = default density; >1 zoomed in; <1 zoomed out).
    zoom: SIZING.zoomDefault ?? 1,

    // presentation (gameLoop)
    lastCamX: NaN, lastCamY: NaN,
    forceFullRender: true,
    previewDirty: false,
    perfRenderMs: 0,
    // Render-only day/night state is initialized by gameLoop before the first
    // engine build. Engine recreation reapplies its current quantized skylight.
    dayNight: null,
    dayVisualKey: 0,
    weatherVisualKey: 0,
    dayPhaseOverride: null,
    appliedSkyLight: -1,
    // Auto weather cycle state (gameLoop). weatherMix in [0,1] continuously
    // scales every rain visual; weatherId is the discrete authority kind.
    weatherCycleStart: 0,

    // mode + player. Tool name is kept only so it can be re-sent to a
    // recreated engine; all tool policy lives in C++.
    currentToolName: initialTool,
    drawModeOn: false,
    playMode: survival,
    localPlayerId: 0,
    worldWorker: null,
    creativeKind: 0,
    creativeValue: 0,
    lastCreativeKind: CREATIVE_KIND.MATERIAL,
    lastCreativeValue: survival ? 0 : MAT.SAND,
    creatureSimulationRequested: false,
    inputSeq: 0,

    // pointer (inputBindings; see the mouseButtons ownership comment there)
    clientX: -1, clientY: -1, px: -1, py: -1,
    inside: false,
    mouseButtons: 0,
    touchButton: 0,
    stickX: 0, stickY: 0,
    wrapBounds: { left: 0, right: 0, top: 0, bottom: 0 },

    // DEV A/B flags (flicker bench)
    testPaused: false,
    gutterOn: true,
    snapOff: false,

    // presentation preferences
    reduced: false,
    viewportActive: true,
    audioEnabled: true,
    timingStats: null,

    // lifecycle callbacks are installed below before any module can invoke them.
    startLocalAuthority: null,
    stopLocalAuthority: null,
    setAuthorityError: null,
    setAuthorityStall: null,

    zoomFactor: () => ctx.zoom,
    // In-game zoom relative to the default — drives the parallax backdrop
    // scale so it grows/pans in lockstep with the sim (1 = default).
    bgZoomScale: () => ctx.zoom / (SIZING.zoomDefault || 1),
    fns: {},
  };

  ctx.startLocalAuthority = () => {
    if (ctx.worldWorker || !ctx.engine) return ctx.worldWorker;
    if (typeof Worker === 'undefined') {
      ctx.setAuthorityError?.('This browser cannot start the simulation worker.');
      return null;
    }
    const authority = createWorldWorkerClient(ctx);
    ctx.worldWorker = authority;
    authority.init({
      survival,
      creativeKind: ctx.creativeKind, creativeValue: ctx.creativeValue,
      tool: TOOL_IDS[ctx.currentToolName] ?? 0,
      creatureNaturalSpawning: ctx.debugHitboxes,
      planetId: ctx.planetId,
      weatherId: ctx.weatherId,
      dayPhase: ctx.dayNight?.phase,
      dayOverridden: ctx.dayPhaseOverride !== null,
      gravityScale: ctx.gravityScale,
      missionId: ctx.missionId,
      loadout: ctx.missionLoadout,
    });
    applyCreatureRuntimePolicy(ctx);
    return authority;
  };
  ctx.stopLocalAuthority = () => {
    const authority = ctx.worldWorker;
    ctx.worldWorker = null;
    authority?.destroy();
  };
  const applyCreativeSelection = () => {
    ctx.engine?.setCreativeMaterial(ctx.creativeKind, ctx.creativeValue);
    applyCreatureRuntimePolicy(ctx);
    ctx.worldWorker?.config({
      creativeKind: ctx.creativeKind,
      creativeValue: ctx.creativeValue,
    });
  };
  const isBootstrapCreativeSelection = (kind, value) =>
    kind === CREATIVE_KIND.MATERIAL && value === 0;
  const setCreativeSelection = (kind, value) => {
    kind |= 0;
    value |= 0;
    if (kind !== ctx.creativeKind || value !== ctx.creativeValue) {
      if (!isBootstrapCreativeSelection(ctx.creativeKind, ctx.creativeValue)) {
        ctx.lastCreativeKind = ctx.creativeKind;
        ctx.lastCreativeValue = ctx.creativeValue;
      }
    }
    ctx.creativeKind = kind;
    ctx.creativeValue = value;
    applyCreativeSelection();
  };
  const equipLastCreativeSelection = () => {
    if (ctx.lastCreativeKind === ctx.creativeKind
        && ctx.lastCreativeValue === ctx.creativeValue) return;
    if (onEquipCreativeMaterial?.(ctx.lastCreativeKind, ctx.lastCreativeValue)) return;
    setCreativeSelection(ctx.lastCreativeKind, ctx.lastCreativeValue);
  };

  const authorityFailure = document.createElement('div');
  authorityFailure.style.cssText = 'position:absolute;inset:0;z-index:80;display:none;place-items:center;background:rgba(10,12,16,.86);color:#fff;text-align:center;padding:24px;font:600 15px/1.4 system-ui,sans-serif';
  const authorityFailurePanel = document.createElement('div');
  const authorityFailureText = document.createElement('div');
  const authorityRetry = document.createElement('button');
  authorityRetry.type = 'button';
  authorityRetry.textContent = 'Retry';
  authorityRetry.style.cssText = 'margin-top:14px;border:0;border-radius:999px;padding:9px 18px;font:700 14px system-ui,sans-serif;cursor:pointer';
  authorityRetry.addEventListener('click', () => ctx.worldWorker?.retry());
  authorityFailurePanel.append(authorityFailureText, authorityRetry);
  authorityFailure.appendChild(authorityFailurePanel);
  container.appendChild(authorityFailure);
  ctx.setAuthorityError = (message) => {
    authorityFailureText.textContent = message || '';
    authorityFailure.style.display = message ? 'grid' : 'none';
  };

  const authorityStall = document.createElement('div');
  authorityStall.setAttribute('role', 'status');
  authorityStall.style.cssText = 'position:absolute;left:12px;right:12px;top:12px;z-index:79;display:none;padding:10px;background:rgba(10,12,16,.9);color:#ffca78;text-align:center;font:600 13px/1.4 system-ui,sans-serif;pointer-events:none';
  container.appendChild(authorityStall);
  ctx.setAuthorityStall = (message) => {
    authorityStall.textContent = message || '';
    authorityStall.style.display = message ? 'block' : 'none';
  };

  // Mining-progress pill (a tiny DOM overlay next to the cursor).
  const mineProgress = document.createElement('div');
  mineProgress.className = 'sand-mine-progress';
  mineProgress.style.position = 'absolute';
  mineProgress.style.width = '7px';
  mineProgress.style.height = '42px';
  mineProgress.style.border = '2px solid #090b0e';
  mineProgress.style.borderRadius = '0';
  mineProgress.style.background = '#252b31';
  mineProgress.style.boxShadow = 'inset 0 0 0 1px #59636c,3px 3px 0 rgba(0,0,0,.35)';
  mineProgress.style.pointerEvents = 'none';
  mineProgress.style.zIndex = '69';
  mineProgress.style.overflow = 'hidden';
  mineProgress.style.display = 'none';
  const mineProgressFill = document.createElement('div');
  mineProgressFill.className = 'sand-mine-progress-fill';
  mineProgressFill.style.position = 'absolute';
  mineProgressFill.style.left = '0';
  mineProgressFill.style.right = '0';
  mineProgressFill.style.bottom = '0';
  mineProgressFill.style.height = '0%';
  mineProgressFill.style.background = '#f0d465';
  mineProgress.appendChild(mineProgressFill);
  container.appendChild(mineProgress);

  const updateMineProgress = () => {
    const playerId = ctx.localPlayerId;
    if (!survival || !ctx.engine || !playerId || !ctx.inside || !(ctx.mouseButtons & (BUTTON_BITS[0] | BUTTON_BITS[2]))) {
      mineProgress.style.display = 'none';
      return;
    }
    const progress = ctx.worldWorker?.getMineProgress() || 0;
    const target = ctx.worldWorker?.getMineTarget();
    if (progress <= 0 || !target) {
      mineProgress.style.display = 'none';
      return;
    }
    // Anchor the pill to the locked mine cell (not the live cursor) so it stays
    // put while the hold-lock digs one footprint.
    const cam = ctx.engine.getCam();
    const o = ctx.engine.glGetOffset?.() || { offX: 0, offY: 0 };
    const camCol = Math.floor(cam.x), camRow = Math.floor(cam.y);
    const dpr = ctx.dpr || 1;
    const cellCss = ctx.cellDev / dpr;
    const cellLeft = ((target.x - camCol) * ctx.cellDev + o.offX) / dpr;
    const cellTop = ((target.y - camRow) * ctx.cellDev + o.offY) / dpr;
    const b = ctx.wrapBounds;
    const x = Math.max(4, Math.min(b.right - b.left - 12, cellLeft + cellCss + 6));
    const y = Math.max(8, Math.min(b.bottom - b.top - 50, cellTop + cellCss * 0.5 - 21));
    mineProgress.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    mineProgressFill.style.height = `${Math.round(progress * 100)}%`;
    mineProgress.style.display = 'block';
  };

  // Reduced motion: pauses the ambient simulation (gameLoop) rather than
  // freezing the whole game.
  let mqReduced = null;
  let onReducedChange = null;
  if (reducedMotion !== undefined) {
    ctx.reduced = reducedMotion;
  } else if (typeof window !== 'undefined' && window.matchMedia) {
    mqReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    ctx.reduced = mqReduced.matches;
    onReducedChange = () => (ctx.reduced = mqReduced.matches);
    mqReduced.addEventListener?.('change', onReducedChange);
    mqReduced.addListener?.(onReducedChange);
  }

  // Compose modules; order matters only for initial fit/attach.
  const lifecycle = createEngineLifecycle(ctx, { onLayoutChange });
  const replayPanel = createReplayPanel(ctx, { onReplayUi });
  const inputs = createInputBindings(ctx, {
    refreshBounds: lifecycle.refreshBounds,
    zoomBy: lifecycle.zoomBy,
    resetZoom: lifecycle.resetZoom,
    onInteraction,
    onToggleInventory,
    onToggleFootprintMenu,
    onEquipLastCreativeMaterial: equipLastCreativeSelection,
    onLogs: replayPanel.open,
    onReplay: replayPanel.startReplay,
    onReplayPlayback: replayPanel.togglePlayback,
    onReplayStep: replayPanel.stepPlayback,
  });
  const loop = createGameLoop(ctx, {
    parallaxCamera: lifecycle.parallaxCamera,
    updatePointer: inputs.updatePointer,
    updateMineProgress,
    onInventory,
    onPlayerState,
    onMission,
  });
  ctx.fns.render = loop.render;
  ctx.fns.rebuildEngineForReplay = lifecycle.rebuildEngineForDims;
  ctx.fns.applyReplayDayPhase = loop.applyReplayDayPhase;
  let uninstallDevHooks = null;
  if (import.meta.env?.DEV && typeof window !== 'undefined') {
    uninstallDevHooks = installDevHooks(ctx, {
      render: loop.render,
      localPlayer: loop.localPlayer,
      playersForRender: loop.playersForRender,
      currentLocalInput: loop.currentLocalInput,
      perfFrameSummary: loop.perfFrameSummary,
      setDayPhase: loop.setDayPhase,
      clearDayPhase: loop.clearDayPhase,
      getDayNight: loop.getDayNight,
    });
  }

  // Size and build the engine before attaching input and the frame loop.
  lifecycle.fit();
  ctx.startLocalAuthority();
  const ro = new ResizeObserver(lifecycle.fit);
  ro.observe(container);
  lifecycle.watchDpr();
  lifecycle.watchContext();
  const onVisualViewportResize = () => lifecycle.fit();
  window.visualViewport?.addEventListener?.('resize', onVisualViewportResize);
  inputs.attach();
  // AudioContext startup is browser-gated behind user activation. Keep the
  // unlock hook central and idempotent so Safari can also recover after an
  // interruption on the next ordinary tap/key without UI-specific workarounds.
  const unlockAudio = () => { audio.unlock(); };
  const audioGestureOptions = { capture: true, passive: true };
  window.addEventListener('pointerdown', unlockAudio, audioGestureOptions);
  window.addEventListener('touchend', unlockAudio, audioGestureOptions);
  window.addEventListener('click', unlockAudio, audioGestureOptions);
  window.addEventListener('keydown', unlockAudio, audioGestureOptions);
  window.addEventListener('pageshow', unlockAudio, audioGestureOptions);
  loop.start();

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    loop.stop();
    window.removeEventListener('pointerdown', unlockAudio, { capture: true });
    window.removeEventListener('touchend', unlockAudio, { capture: true });
    window.removeEventListener('click', unlockAudio, { capture: true });
    window.removeEventListener('keydown', unlockAudio, { capture: true });
    window.removeEventListener('pageshow', unlockAudio, { capture: true });
    mineProgress.remove();
    authorityFailure.remove();
    authorityStall.remove();
    ro.disconnect();
    lifecycle.unwatchDpr();
    lifecycle.unwatchContext();
    window.visualViewport?.removeEventListener?.('resize', onVisualViewportResize);
    ctx.stopLocalAuthority();
    // Engine rebuilds keep the canvas/context alive; this is the final runtime
    // teardown, so release the shared WebGL registry entry and canvas target.
    if (ctx.engine && ctx.engine.destroy) ctx.engine.destroy({ releaseGlTarget: true });
    ctx.engine = null;
    parallax.destroy();
    audio.destroy();
    inputs.detach();
    if (mqReduced && onReducedChange) {
      mqReduced.removeEventListener?.('change', onReducedChange);
      mqReduced.removeListener?.(onReducedChange);
    }
    uninstallDevHooks?.();
    replayPanel.destroy();
    canvas.remove();
  };

  return {
    setTool(id) { ctx.currentToolName = id; ctx.engine?.setTool(TOOL_IDS[id] ?? 0); ctx.worldWorker?.config({ tool: TOOL_IDS[id] ?? 0 }); },
    setDrawMode(on) { ctx.drawModeOn = !!on; ctx.engine?.setDrawMode(ctx.drawModeOn); ctx.worldWorker?.config({ drawMode: ctx.drawModeOn }); },
    getDrawMode() { return ctx.drawModeOn; },
    setPlayMode(on) { ctx.playMode = !!on; ctx.engine?.setPlayMode(ctx.playMode); },
    getPlayMode() { return ctx.playMode; },
    setDebugHitboxes(on) {
      ctx.debugHitboxes = !!on;
      ctx.engine?.glSetDebugHitboxes(ctx.debugHitboxes);
      applyCreatureRuntimePolicy(ctx);
      ctx.worldWorker?.config({ creatureNaturalSpawning: ctx.debugHitboxes });
    },
    inputKey(code, on) { ctx.engine?.inputKey(code | 0, on ? 1 : 0); },
    inputStick(x, y) {
      x = Number.isFinite(x) ? x : 0;
      y = Number.isFinite(y) ? y : 0;
      const mag = Math.hypot(x, y);
      if (mag > 1) { x /= mag; y /= mag; }
      ctx.stickX = x;
      ctx.stickY = y;
      ctx.engine?.inputStick(x, y);
    },
    // Mobile creative taps normally act as LMB (foreground). The on-screen
    // layer toggle switches touch pointers to RMB (background); real mice keep
    // their native buttons on hybrid devices.
    setTouchLayer(background) { ctx.touchButton = background ? 2 : 0; },
    getTouchLayer() { return ctx.touchButton === 2 ? 'background' : 'foreground'; },
    // Survival inventory intents go to the authority worker.
    isSurvival() { return survival; },
    selectSlot(i) {
      ctx.worldWorker?.intent('select', { slot: i | 0 });
    },
    setSelectedFootprint(i) {
      ctx.worldWorker?.intent('size', { footprint: i | 0 });
    },
    getSurvivalFootprints() { return ctx.engine?.getSurvivalFootprints?.() || []; },
    moveSlot(from, to) {
      ctx.worldWorker?.intent('move', { from: from | 0, to: to | 0 });
    },
    getInventory() {
      return ctx.worldWorker?.getInventory() || { slots: [], selected: 0, selectedFootprint: 0 };
    },
    getMission() { return ctx.worldWorker?.getMission() || null; },
    getTalkableActors() {
      if (!ctx.engine) return [];
      const offsetX = ctx.engine.getWorldOffsetX();
      const offsetY = ctx.engine.getWorldOffsetY();
      return ctx.engine.getCreatures()
        .filter(({ species, alive }) =>
          alive && (species === CREATURE.SURVEYOR ||
            species === CREATURE.IRIS_COMMANDER ||
            species === CREATURE.IRIS_ENGINEER))
        .map((actor) => ({
          ...actor,
          worldX: offsetX + actor.x + actor.w * 0.5,
          worldY: offsetY + actor.y,
        }));
    },
    getPlanetState() {
      return {
        id: ctx.engine?.getPlanet() ?? ctx.planetId,
        gravityScale: ctx.engine?.getGravityScale() ?? ctx.gravityScale,
      };
    },
    getMissionView() {
      if (!ctx.engine) return null;
      const cam = ctx.engine.getCam();
      const offsetX = ctx.engine.getWorldOffsetX();
      const offsetY = ctx.engine.getWorldOffsetY();
      const player = ctx.worldWorker?.getOwnPlayer() || null;
      return {
        cameraWorldX: offsetX + cam.x,
        cameraWorldY: offsetY + cam.y,
        viewCols: ctx.viewCols,
        viewRows: ctx.viewRows,
        playerWorldX: player ? offsetX + player.x + player.w * 0.5 : null,
        playerWorldY: player ? offsetY + player.y + player.h * 0.5 : null,
      };
    },
    openReplayPanel() { replayPanel.open(); },
    // Minecraft cursor model (carried stack) + throw-out (facing direction).
    cursorPick(slot, half) {
      ctx.worldWorker?.intent('pick', { slot: slot | 0, half: !!half });
    },
    throwFromCursor(whole) {
      ctx.worldWorker?.intent('throw', { whole: !!whole });
    },
    getCursor() {
      return ctx.worldWorker?.getCursor() || null;
    },
    getCraftingRecipes() { return ctx.engine?.getCraftingRecipes?.() || []; },
    craft(recipe, max = false) {
      ctx.worldWorker?.intent('craft', { recipe: recipe | 0, max: !!max });
    },
    poolAction(pool, action, material = 0, value = 0) {
      ctx.worldWorker?.intent('pool', { pool, action, material, value });
    },
    respawn() {
      ctx.worldWorker?.intent('respawn');
    },
    // Runtime zoom. Buttons/keys drive these; the loaded sim window grows/shrinks
    // with zoom (world content preserved via engine.resizeLoadedWindow).
    zoomIn() { lifecycle.zoomBy(1); },
    zoomOut() { lifecycle.zoomBy(-1); },
    resetZoom() { lifecycle.resetZoom(); },
    getZoom() {
      return {
        factor: ctx.zoomFactor(),
        default: SIZING.zoomDefault ?? 1,
        min: SIZING.zoomOutMin ?? 0.05,
        max: SIZING.zoomInMax ?? 8,
      };
    },
    // The presenter detects quantized skylight changes itself. Phase-only
    // scrubs redraw the parallax sky without forcing cell-texture rebuilds.
    setDayPhase(phase) { loop.setDayPhase(phase); loop.render(false); },
    clearDayPhase() { loop.clearDayPhase(); loop.render(false); },
    getDayNight() { return loop.getDayNight(); },
    // id: WEATHER.RAIN, WEATHER.CLEAR, or null to resume the auto cycle.
    interactQuest(objectiveId) { ctx.worldWorker?.intent('quest-interact', { objectiveId }); },
    repairBase() { ctx.worldWorker?.intent('repair-base'); },
    setWeatherOverride(id) { loop.setWeatherOverride(id); loop.render(false); },
    getWeatherState() { return loop.getWeatherState(); },
    setViewportActive(active) {
      ctx.viewportActive = !!active;
      loop.setViewportPaused(!ctx.viewportActive);
      audio.setEnabled(ctx.viewportActive && ctx.audioEnabled !== false);
    },
    setAudioEnabled(on) {
      ctx.audioEnabled = !!on;
      audio.setEnabled(ctx.audioEnabled && ctx.viewportActive !== false);
    },
    setAudioMuted(on) { audio.setMuted(!!on); },
    toggleAudioMuted() { return audio.toggleMuted(); },
    unlockAudio() { return audio.unlock(); },
    playBeamSound() { return audio.playBeam(); },
    getAudioState() {
      return {
        enabled: audio.enabled, muted: audio.muted, ready: audio.ready,
        effects: audio.playerEffects,
      };
    },
    // Creative palette selection (material/seed/eraser/cube/creature).
    setCreativeMaterial(kind, value) {
      setCreativeSelection(kind, value);
    },
    // Live performance snapshot for the on-screen perf HUD (the /fps route).
    // Mirrors the DEV-only window.__sandPerf but is always available. fps/
    // tickrate are left to the caller to derive from wall-clock deltas of
    // `tick` + its own frames.
    perfStats() {
      const { avg, p95 } = loop.perfFrameSummary();
      const peaks = loop.perfPeaks();
      const perf = ctx.engine ? ctx.engine.getPerf() : { stepMs: 0, dirtyChunks: 0 };
      const workerState = ctx.worldWorker?.state;
      const authorityPerf = workerState || perf;
      const timing = ctx.timingStats || {};
      return {
        stepMs: workerState?.stepMs ?? perf.stepMs,
        actorMs: workerState?.actorMs ?? perf.actorMs ?? 0,
        renderMs: ctx.perfRenderMs,
        lightMs: perf.lightMs || 0,
        fillMs: perf.fillMs || 0,
        uploadMs: perf.uploadMs || 0,
        groundingMs: authorityPerf.groundingMs || 0,
        crossLayerGroundingMs: authorityPerf.crossLayerGroundingMs || 0,
        componentIndexMs: authorityPerf.componentIndexMs || 0,
        assemblyUnionMs: authorityPerf.assemblyUnionMs || 0,
        carryMs: authorityPerf.carryMs || 0,
        bodyMs: authorityPerf.bodyMs || 0,
        sandMs: authorityPerf.sandMs || 0,
        liquidMs: authorityPerf.liquidMs || 0,
        gasMs: authorityPerf.gasMs || 0,
        reactMs: authorityPerf.reactMs || 0,
        tailMs: authorityPerf.tailMs || 0,
        layersMs: authorityPerf.layersMs || 0,
        crossMs: authorityPerf.crossMs || 0,
        avgFrameMs: avg,
        p95FrameMs: p95,
        peakRafMs: peaks.rafMs,
        peakStepMs: peaks.stepMs,
        peakRenderMs: peaks.renderMs,
        peakLightMs: peaks.lightMs,
        peakFillMs: peaks.fillMs,
        peakUploadMs: peaks.uploadMs,
        dirtyChunks: authorityPerf.dirtyChunks || 0,
        dirtyRows: authorityPerf.dirtyRows || 0,
        dirtyCells: authorityPerf.dirtyCells || 0,
        componentCount: authorityPerf.componentCount || 0,
        componentCellCount: authorityPerf.componentCellCount || 0,
        crossBondCount: authorityPerf.crossBondCount || 0,
        mirrorApplyMs: workerState?.mirrorApplyMs || 0,
        mirrorPacketBytes: workerState?.packetBytes || 0,
        mirrorPacketType: workerState?.packetType || '',
        mirrorShiftPackets: workerState?.shiftPacketsApplied || 0,
        mirrorShiftPacketBytes: workerState?.lastShiftPacketBytes || 0,
        mirrorPacketErrors: workerState?.mirrorPacketErrors || 0,
        lastMirrorPacketError: workerState?.lastMirrorPacketError || '',
        creatureCount: workerState?.creatureCount ?? (ctx.engine ? ctx.engine.creatureCount() : 0),
        tick: ctx.engine ? ctx.engine.getTick() : 0,
        actorTick: workerState?.actorTick ?? (ctx.engine ? ctx.engine.getActorTick() : 0),
        worldTick: workerState?.worldTick ?? (ctx.engine ? ctx.engine.getTick() : 0),
        worldTps: workerState?.worldTps ?? 0,
        workerStatus: workerState?.liveness?.status || 'unavailable',
        workerStage: workerState?.liveness?.stage || 'unavailable',
        workerStageAgeMs: workerState?.liveness?.stageAgeMs || 0,
        workerProgressAgeMs: workerState?.liveness?.progressAgeMs || 0,
        workerAwaitingAck: !!workerState?.liveness?.awaitingAck,
        workerTickLag: workerState?.liveness?.tickLag || 0,
        authorityHeapMB: (workerState?.wasmHeapBytes || 0) / (1024 * 1024),
        worldShifts: ctx.engine ? ctx.engine.getWorldShiftCount() : 0,
        actorSteps: timing.actorSteps || 0,
        actorDebtMs: timing.actorDebtMs || 0,
        actorDroppedMs: timing.actorDroppedMs || 0,
        worldStepped: !!timing.worldStepped,
        heapMB: ctx.engine ? ctx.engine.getHeapBytes() / (1024 * 1024) : 0,
        rows: ctx.rows,
        cols: ctx.cols,
      };
    },
    destroy,
  };
}
