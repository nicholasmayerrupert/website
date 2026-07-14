// Framework-agnostic falling-sand game runtime.
//
// `createSandGame(container, opts)` boots the whole interactive simulation into
// a host element using nothing but the DOM — no React. It returns a small
// handle to drive it from the outside:
//
//   const game = createSandGame(el, { initialTool: 'sand' });
//   game.setTool('water');
//   game.setDrawMode(true);
//   game.destroy();
//
// The runtime is composed from focused modules that share one mutable state
// object (`ctx`) owned here:
//
//   engineLifecycle.js  viewport fit, engine construction/wiring, zoom, DPR watch
//   inputBindings.js    window pointer/keyboard/wheel listeners
//   gameLoop.js         render, input/prediction clock, RAF loop, perf samples
//   netGlue.js          multiplayer join/disconnect/status (gameNet lives on ctx.net)
//   devHooks.js         DEV-only window.__sandPerf/__sandTest/__sandNet
//
// The React component in ../react/SandGame.jsx is a thin wrapper over this. The
// simulation runs in the WebAssembly engine (../wasmBridge/engineFactory.js);
// initSandWasm() must have resolved before createSandGame() is called.
//
// Browser-side tunables live in runtimeConfig.js. The simulation, rendering,
// camera (pan/follow/bounds), pointer→aim mapping, player physics, tool policy,
// and terrain all live in the C++ engine (cpp/engine/); JS forwards raw events
// and drives the presentation RAF and input/prediction clock.

import { BUTTON_BITS, DEFAULT_TOOL, SIZING, TOOL_IDS } from './runtimeConfig';
import { createParallaxBackground } from './parallaxBackground';
import { createEngineLifecycle } from './engineLifecycle';
import { createInputBindings } from './inputBindings';
import { createGameLoop } from './gameLoop';
import { createNetGlue } from './netGlue';
import { installDevHooks } from './devHooks';
import { applyCreatureRuntimePolicy } from './creatureRuntimePolicy';
import { createWorldWorkerClient } from '../worker/worldWorkerClient.js';

export function computeThreadWorkerBudgets() {
  const hardwareWorkers = Math.max(0, Math.min(7, ((globalThis.navigator?.hardwareConcurrency || 4) | 0) - 2));
  const threadParam = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('sandThreads') : null;
  const threadOverride = threadParam === null ? NaN : Number(threadParam);
  const requestedWorkers = Number.isFinite(threadOverride) ? Math.max(0, Math.min(7, (threadOverride | 0) - 1)) : null;
  const mainThreadWorkers = requestedWorkers ?? Math.floor(hardwareWorkers / 2);
  const worldThreadWorkers = requestedWorkers ?? Math.max(0, hardwareWorkers - mainThreadWorkers);
  return { mainThreadWorkers, worldThreadWorkers };
}

export function createSandGame(container, opts = {}) {
  const {
    initialTool = DEFAULT_TOOL,
    onLayoutChange,
    reducedMotion,
    // 'survival' (default): a player character with reach/cooldown-restricted
    // tools, camera follows. 'creative': free camera (WASD pans the infinite
    // world), draw tools place/erase anywhere with no reach limit, no character.
    mode = 'survival',
    // /fps enables engine-owned creature actors plus AABB outlines while
    // retaining creative controls and the performance HUD.
    debugHitboxes = false,
    // Survival inventory hooks: onInventory(snapshot) feeds the HUD when it
    // changes; onToggleInventory() opens/closes the grid (the E key). The
    // inventory itself is authoritative in the engine — these only move
    // snapshots out and intents in.
    onInventory = null,
    onToggleInventory = null,
    onToggleFootprintMenu = null,
  } = opts;
  const survival = mode === 'survival';
  const { mainThreadWorkers, worldThreadWorkers } = computeThreadWorkerBudgets();

  // --- Host canvas (created and owned here). The WASM engine owns a WebGL2
  // context on it and composites everything (engine.glRenderFrame). ---
  const parallax = createParallaxBackground(container);

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

  // --- Shared runtime state. Every module reads/writes this one object; the
  // fields are grouped by owner. ctx.fns holds late-bound cross-module calls
  // (set after the owning module is created). ---
  const ctx = {
    container, canvas, parallax, survival, debugHitboxes: !!debugHitboxes,
    mainThreadWorkers, worldThreadWorkers,
    // One seed per mount so resizing regenerates the *same* infinite world.
    worldSeed: (Math.random() * 4294967296) >>> 0,
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
    dayPhaseOverride: null,
    appliedSkyLight: -1,

    // mode + player. Tool name is kept only so it can be re-sent to a
    // recreated engine; all tool policy lives in C++.
    currentToolName: initialTool,
    drawModeOn: false,
    playMode: survival,
    localPlayerId: 0,
    worldWorker: null,
    creativeKind: 0,
    creativeValue: 0,
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

    // multiplayer (netGlue) + reduced motion
    net: null,
    reduced: false,

    netClientReady: () => !!ctx.net && ctx.net.role === 'client' && ctx.net.connected && ctx.net.worldReady,
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
      threadWorkers: ctx.worldThreadWorkers,
    });
    applyCreatureRuntimePolicy(ctx);
    return authority;
  };
  ctx.stopLocalAuthority = () => {
    const authority = ctx.worldWorker;
    ctx.worldWorker = null;
    authority?.destroy();
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

  // Mining-progress pill (a tiny DOM overlay next to the cursor).
  const mineProgress = document.createElement('div');
  mineProgress.style.position = 'absolute';
  mineProgress.style.width = '5px';
  mineProgress.style.height = '42px';
  mineProgress.style.border = '1px solid rgba(255,255,255,.55)';
  mineProgress.style.borderRadius = '999px';
  mineProgress.style.background = 'rgba(3,7,18,.58)';
  mineProgress.style.boxShadow = '0 6px 14px rgba(0,0,0,.35)';
  mineProgress.style.pointerEvents = 'none';
  mineProgress.style.zIndex = '69';
  mineProgress.style.overflow = 'hidden';
  mineProgress.style.display = 'none';
  const mineProgressFill = document.createElement('div');
  mineProgressFill.style.position = 'absolute';
  mineProgressFill.style.left = '0';
  mineProgressFill.style.right = '0';
  mineProgressFill.style.bottom = '0';
  mineProgressFill.style.height = '0%';
  mineProgressFill.style.background = '#f8fafc';
  mineProgressFill.style.boxShadow = '0 0 8px rgba(248,250,252,.85)';
  mineProgress.appendChild(mineProgressFill);
  container.appendChild(mineProgress);

  const updateMineProgress = () => {
    if (!survival || !ctx.engine || !ctx.localPlayerId || !ctx.inside || !(ctx.mouseButtons & (BUTTON_BITS[0] | BUTTON_BITS[2]))) {
      mineProgress.style.display = 'none';
      return;
    }
    const progress = ctx.netClientReady()
      ? ctx.engine.getPlayerMineProgress?.(ctx.localPlayerId) || 0
      : ctx.worldWorker?.getMineProgress() || 0;
    const target = ctx.netClientReady()
      ? ctx.engine.getPlayerMineTarget?.(ctx.localPlayerId)
      : ctx.worldWorker?.getMineTarget();
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

  // --- Compose the modules (order matters only for the initial fit/attach). ---
  const lifecycle = createEngineLifecycle(ctx, { onLayoutChange });
  const inputs = createInputBindings(ctx, {
    refreshBounds: lifecycle.refreshBounds,
    zoomBy: lifecycle.zoomBy,
    resetZoom: lifecycle.resetZoom,
    onToggleInventory,
    onToggleFootprintMenu,
  });
  const loop = createGameLoop(ctx, {
    fit: lifecycle.fit,
    parallaxCamera: lifecycle.parallaxCamera,
    updatePointer: inputs.updatePointer,
    updateMineProgress,
    onInventory,
  });
  ctx.fns.render = loop.render;
  const netGlue = createNetGlue(ctx, {
    fit: lifecycle.fit,
    rebuildEngineForDims: lifecycle.rebuildEngineForDims,
    currentLocalInput: loop.currentLocalInput,
  });

  let uninstallDevHooks = null;
  if (import.meta.env?.DEV && typeof window !== 'undefined') {
    uninstallDevHooks = installDevHooks(ctx, {
      render: loop.render,
      doFixedStep: loop.doFixedStep,
      localPlayer: loop.localPlayer,
      playersForRender: loop.playersForRender,
      currentLocalInput: loop.currentLocalInput,
      perfFrameSummary: loop.perfFrameSummary,
      setDayPhase: loop.setDayPhase,
      clearDayPhase: loop.clearDayPhase,
      getDayNight: loop.getDayNight,
      netJoin: netGlue.netJoin,
      netDisconnect: netGlue.netDisconnect,
      netStatus: netGlue.netStatus,
    });
  }

  // --- Boot: size + build the engine, then start listening and looping. ---
  lifecycle.fit();
  ctx.startLocalAuthority();
  const ro = new ResizeObserver(lifecycle.fit);
  ro.observe(container);
  lifecycle.watchDpr();
  const onVisualViewportResize = () => lifecycle.fit();
  window.visualViewport?.addEventListener?.('resize', onVisualViewportResize);
  inputs.attach();
  loop.start();

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    loop.stop();
    mineProgress.remove();
    authorityFailure.remove();
    ro.disconnect();
    lifecycle.unwatchDpr();
    window.visualViewport?.removeEventListener?.('resize', onVisualViewportResize);
    ctx.net?.disconnect();
    ctx.stopLocalAuthority();
    if (ctx.engine && ctx.engine.destroy) ctx.engine.destroy();
    parallax.destroy();
    inputs.detach();
    if (mqReduced && onReducedChange) {
      mqReduced.removeEventListener?.('change', onReducedChange);
      mqReduced.removeListener?.(onReducedChange);
    }
    uninstallDevHooks?.();
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
    // Survival inventory intents. When connected as a client they go to the
    // authoritative server; offline they go to the local authority worker.
    isSurvival() { return survival; },
    selectSlot(i) {
      if (ctx.netClientReady()) ctx.net.sendSelect(i | 0);
      else ctx.worldWorker?.intent('select', { slot: i | 0 });
    },
    setSelectedFootprint(i) {
      if (ctx.netClientReady()) ctx.net.sendSize(i | 0);
      else ctx.worldWorker?.intent('size', { footprint: i | 0 });
    },
    getSurvivalFootprints() { return ctx.engine?.getSurvivalFootprints?.() || []; },
    moveSlot(from, to) {
      if (ctx.netClientReady()) ctx.net.sendMove(from | 0, to | 0);
      else ctx.worldWorker?.intent('move', { from: from | 0, to: to | 0 });
    },
    getInventory() {
      if (ctx.netClientReady()) return ctx.net.getOwnInventory() || { slots: [], selected: 0, selectedFootprint: 0 };
      return ctx.worldWorker?.getInventory() || { slots: [], selected: 0, selectedFootprint: 0 };
    },
    // Minecraft cursor model (carried stack) + throw-out (facing direction).
    cursorPick(slot, half) {
      if (ctx.netClientReady()) ctx.net.sendPick(slot | 0, half);
      else ctx.worldWorker?.intent('pick', { slot: slot | 0, half: !!half });
    },
    throwFromCursor(whole) {
      if (ctx.netClientReady()) ctx.net.sendThrow(whole);
      else ctx.worldWorker?.intent('throw', { whole: !!whole });
    },
    getCursor() {
      if (ctx.netClientReady()) return ctx.net.getOwnCursor();
      return ctx.worldWorker?.getCursor() || null;
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
    // Creative palette selection (material/seed/eraser/cube/creature).
    setCreativeMaterial(kind, value) {
      ctx.creativeKind = kind | 0;
      ctx.creativeValue = value | 0;
      ctx.engine?.setCreativeMaterial(ctx.creativeKind, ctx.creativeValue);
      applyCreatureRuntimePolicy(ctx);
      ctx.worldWorker?.config({ creativeKind: ctx.creativeKind, creativeValue: ctx.creativeValue });
    },
    // Live performance snapshot for the on-screen perf HUD (the /fps route).
    // Mirrors the DEV-only window.__sandPerf but is always available. fps/
    // tickrate are left to the caller to derive from wall-clock deltas of
    // `tick` + its own frames.
    perfStats() {
      const { avg, p95 } = loop.perfFrameSummary();
      const perf = ctx.engine ? ctx.engine.getPerf() : { stepMs: 0, dirtyChunks: 0 };
      const workerState = ctx.worldWorker?.state;
      const timing = ctx.timingStats || {};
      return {
        stepMs: workerState?.stepMs ?? perf.stepMs,
        actorMs: workerState?.actorMs ?? perf.actorMs ?? 0,
        renderMs: ctx.perfRenderMs,
        lightMs: perf.lightMs || 0,
        fillMs: perf.fillMs || 0,
        uploadMs: perf.uploadMs || 0,
        groundingMs: perf.groundingMs || 0,
        crossLayerGroundingMs: perf.crossLayerGroundingMs || 0,
        componentIndexMs: perf.componentIndexMs || 0,
        assemblyUnionMs: perf.assemblyUnionMs || 0,
        carryMs: perf.carryMs || 0,
        bodyMs: perf.bodyMs || 0,
        sandMs: perf.sandMs || 0,
        liquidMs: perf.liquidMs || 0,
        gasMs: perf.gasMs || 0,
        reactMs: perf.reactMs || 0,
        tailMs: perf.tailMs || 0,
        layersMs: perf.layersMs || 0,
        crossMs: perf.crossMs || 0,
        avgFrameMs: avg,
        p95FrameMs: p95,
        dirtyChunks: perf.dirtyChunks || 0,
        dirtyRows: perf.dirtyRows || 0,
        dirtyCells: perf.dirtyCells || 0,
        componentCount: perf.componentCount || 0,
        componentCellCount: perf.componentCellCount || 0,
        crossBondCount: perf.crossBondCount || 0,
        creatureCount: workerState?.creatureCount ?? (ctx.engine ? ctx.engine.creatureCount() : 0),
        tick: ctx.engine ? ctx.engine.getTick() : 0,
        actorTick: workerState?.actorTick ?? (ctx.engine ? ctx.engine.getActorTick() : 0),
        worldTick: workerState?.worldTick ?? (ctx.engine ? ctx.engine.getTick() : 0),
        worldTps: workerState?.worldTps ?? 0,
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
    netJoin(url, room) { return netGlue.netJoin(url, room); },
    netDisconnect() { netGlue.netDisconnect(); },
    netStatus() { return netGlue.netStatus(); },
    destroy,
  };
}
