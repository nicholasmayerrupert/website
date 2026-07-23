// DEV-only window hooks for the headless benchmarks and Playwright tests:
// __sandPerf (perf snapshot), __sandTest (deterministic pan/flicker + gameplay
// hooks), __sandNet (two-context multiplayer hooks). Installed only under
// import.meta.env.DEV; every dependency is passed in explicitly so the hooks
// can't silently reach into shell closures.

import { ITEM_FIELDS } from '../net/protocol.js';
import { TOOL_IDS } from './runtimeConfig';
import { applyCreatureRuntimePolicy } from './creatureRuntimePolicy';

export function installDevHooks(ctx, {
  render,
  doFixedStep,
  localPlayer,
  playersForRender,
  currentLocalInput,
  perfFrameSummary,
  setDayPhase,
  clearDayPhase,
  getDayNight,
  netJoin,
  netDisconnect,
  netStatus,
}) {
  const engine = () => ctx.engine;

  window.__sandPerf = () => {
    const { avg, p95, samples } = perfFrameSummary();
    const perf = engine() ? engine().getPerf() : { stepMs: 0, dirtyChunks: 0 };
    const workerState = ctx.worldWorker?.state;
    const timing = ctx.timingStats || {};
    const ms = (v) => Number((v || 0).toFixed(3));
    return {
      stepMs: Number(((workerState?.stepMs ?? perf.stepMs) || 0).toFixed(2)),
      actorMs: Number(((workerState?.actorMs ?? perf.actorMs) || 0).toFixed(2)),
      renderMs: Number(ctx.perfRenderMs.toFixed(2)),
      lightMs: ms(perf.lightMs),
      fillMs: ms(perf.fillMs),
      uploadMs: ms(perf.uploadMs),
      groundingMs: ms(perf.groundingMs),
      crossLayerGroundingMs: ms(perf.crossLayerGroundingMs),
      componentIndexMs: ms(perf.componentIndexMs),
      assemblyUnionMs: ms(perf.assemblyUnionMs),
      carryMs: ms(perf.carryMs),
      bodyMs: ms(perf.bodyMs),
      sandMs: ms(perf.sandMs),
      liquidMs: ms(perf.liquidMs),
      gasMs: ms(perf.gasMs),
      reactMs: ms(perf.reactMs),
      tailMs: ms(perf.tailMs),
      layersMs: ms(perf.layersMs),
      crossMs: ms(perf.crossMs),
      avgFrameMs: Number(avg.toFixed(3)),
      p95FrameMs: Number(p95.toFixed(3)),
      samples,
      dirtyChunks: perf.dirtyChunks || 0,
      dirtyRows: perf.dirtyRows || 0,
      dirtyCells: perf.dirtyCells || 0,
      componentCount: perf.componentCount || 0,
      componentCellCount: perf.componentCellCount || 0,
      crossBondCount: perf.crossBondCount || 0,
      worldShifts: engine() ? engine().getWorldShiftCount() : 0,
      actorTick: workerState?.actorTick ?? (engine() ? engine().getActorTick() : 0),
      worldTick: workerState?.worldTick ?? (engine() ? engine().getTick() : 0),
      mirrorWorldTick: engine() ? engine().getTick() : 0,
      worldTps: workerState?.worldTps || 0,
      workerControls: workerState?.controlsReceived || 0,
      workerResizePending: !!workerState?.resizePending,
      workerResizeControls: workerState?.resizeControlsSent || 0,
      workerControlWorldX: workerState?.controlWorldX || 0,
      workerControlWorldY: workerState?.controlWorldY || 0,
      workerEdges: workerState?.edgesProcessed || 0,
      workerToolWrites: workerState?.toolWrites || 0,
      mirrorApplyMs: workerState?.mirrorApplyMs || 0,
      mirrorPacketBytes: workerState?.packetBytes || 0,
      actorSteps: timing.actorSteps || 0,
      actorDebtMs: Number((timing.actorDebtMs || 0).toFixed(1)),
      actorDroppedMs: Number((timing.actorDroppedMs || 0).toFixed(1)),
      worldStepped: !!timing.worldStepped,
      wasmHeapMB: engine() ? Number((engine().getHeapBytes() / (1024 * 1024)).toFixed(1)) : 0,
      rows: ctx.rows,
      cols: ctx.cols,
    };
  };

  // Deterministic hooks for the headless pan/flicker benchmark
  // (scripts/bench-pan.mjs).
  window.__sandTest = {
    setCam(x, y) { engine()?.cameraSet(x, y); render(false); },
    getCam() { return engine() ? engine().getCam() : { x: 0, y: 0 }; },
    render() { render(false); },
    // vertical-streaming hooks (browser test): trigger a stream pass + read the
    // 2D world offset, to verify a world shift is seamless on screen.
    streamWorldTest() { if (engine()) { engine().streamWorld(); render(false); } },
    worldOffset() { return engine() ? { x: engine().getWorldOffsetX(), y: engine().getWorldOffsetY() } : { x: 0, y: 0 }; },
    setPaused(v) { ctx.testPaused = !!v; engine()?.glSetFlags(ctx.gutterOn, ctx.snapOff, ctx.testPaused || ctx.reduced); }, // freeze simulation + render-only animation
    setGutter(v) { ctx.gutterOn = !!v; engine()?.glSetFlags(ctx.gutterOn, ctx.snapOff, ctx.testPaused || ctx.reduced); render(false); },
    off() { return engine() ? engine().glGetOffset() : { offX: 0, offY: 0 }; },
    setSnap(v) { ctx.snapOff = !v; engine()?.glSetFlags(ctx.gutterOn, ctx.snapOff, ctx.testPaused || ctx.reduced); render(false); },
    info() { return { cols: ctx.cols, rows: ctx.rows, cellSize: ctx.cellSize, cellDev: ctx.cellDev, viewCols: ctx.viewCols, viewRows: ctx.viewRows, dpr: window.devicePixelRatio || 1, canvasW: ctx.canvas.width, canvasH: ctx.canvas.height, maxTextureSize: ctx.maxTextureSize }; },
    // cursor (canvas-relative CSS px) -> cell, same mapping as the real input path
    cellAt(pxCss, pyCss) { const cam = engine() ? engine().getCam() : { x: 0, y: 0 }; return [Math.floor(cam.x + (pxCss * ctx.dpr) / ctx.cellDev), Math.floor(cam.y + (pyCss * ctx.dpr) / ctx.cellDev)]; },
    // device-px top-left where a cell renders (for round-trip verification). The
    // snapped present offset lives in the engine (engine.glGetOffset()).
    cellRect(cx, cy) { const cam = engine() ? engine().getCam() : { x: 0, y: 0 }; const camCol = Math.floor(cam.x), camRow = Math.floor(cam.y); const o = engine() ? engine().glGetOffset() : { offX: 0, offY: 0 }; return { x: (cx - camCol) * ctx.cellDev + o.offX, y: (cy - camRow) * ctx.cellDev + o.offY, size: ctx.cellDev }; },
    // read back a top-down RGBA region of the GL canvas (flicker probe)
    readPixels(x, y, w, h) { return engine() ? engine().glReadPixels(x, y, w, h) : new Uint8ClampedArray(w * h * 4); },
    // player hooks for the headless gameplay test (scripts / Playwright)
    setPlayMode(v) { ctx.playMode = !!v; engine()?.setPlayMode(ctx.playMode); },
    getPlayMode() { return ctx.playMode; },
    getPlayer() { return localPlayer(); },
    getPlayers() { return playersForRender(); },
    setPlayerState(state) {
      const p = localPlayer();
      if (p) ctx.worldWorker?.intent('set-player-state', { state: { ...p, ...state } });
    },
    getCreatures() { return engine() ? engine().getCreatures() : []; },
    setHitboxes(v) { ctx.debugHitboxes = !!v; engine()?.glSetDebugHitboxes(ctx.debugHitboxes); applyCreatureRuntimePolicy(ctx); ctx.worldWorker?.config({ creatureNaturalSpawning: ctx.debugHitboxes }); render(false); },
    setSkyLight(v) { engine()?.setSkyLight(v | 0); render(true); },
    setDayPhase(v) { setDayPhase(v); render(false); },
    clearDayPhase() { clearDayPhase(); render(false); },
    getDayNight() { return getDayNight(); },
    actorLight(x, y, w, h) { return engine()?.glActorLight(x, y, w, h) ?? 1; },
    renderedPlayers() { return playersForRender(); },
    localInput() { return currentLocalInput(); },
    heldKeys() { return engine() ? engine().getHeldKeys() : 0; },
    sharedGlContexts() { return engine()?.sharedGlContextCount() ?? 0; },
    sharedGlContextProbe() {
      // Capture the wrapper, not ctx.engine: final teardown nulls ctx.engine,
      // while this probe must still read the module-global registry afterward.
      const current = engine();
      return () => current?.sharedGlContextCount() ?? 0;
    },
    // world-replication hooks (mp-e2e): edit the host world + measure a region.
    gridHash() { return engine() ? engine().gridHash() : 0; },
    erase(x, y, r) { engine()?.eraseDisc(x, y, r); },
    solidCount(x0, y0, x1, y1) {
      if (!engine()) return 0;
      const g = engine().getGrid();
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (g[y * ctx.cols + x] !== 0) n++;
      return n;
    },
    materialCount(material, x0 = 0, y0 = 0, x1 = ctx.cols, y1 = ctx.rows) {
      if (!engine()) return 0;
      const g = engine().getGrid();
      let n = 0;
      for (let y = Math.max(0, y0); y < Math.min(ctx.rows, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(ctx.cols, x1); x++) if (g[y * ctx.cols + x] === material) n++;
      }
      return n;
    },
    materialCountBg(material) {
      if (!engine()) return 0;
      const grid = engine().getGridBg();
      let n = 0;
      for (let i = 0; i < grid.length; i++) if (grid[i] === material) n++;
      return n;
    },
    materialCountBoth(material) {
      if (!engine()) return 0;
      const fg = engine().getGrid(), bg = engine().getGridBg();
      let n = 0;
      for (let i = 0; i < fg.length; i++) n += (fg[i] === material) + (bg[i] === material);
      return n;
    },
    draftCount() { return engine()?.getStoneDraftCells().length || 0; },
    setTool(name) { ctx.currentToolName = name; engine()?.setTool(TOOL_IDS[name] ?? 0); ctx.worldWorker?.config({ tool: TOOL_IDS[name] ?? 0 }); },
    setDrawMode(v) { ctx.drawModeOn = !!v; engine()?.setDrawMode(ctx.drawModeOn); ctx.worldWorker?.config({ drawMode: ctx.drawModeOn }); },
    setCreativeMaterial(kind, value) {
      ctx.creativeKind = kind | 0; ctx.creativeValue = value | 0;
      engine()?.setCreativeMaterial(ctx.creativeKind, ctx.creativeValue);
      applyCreatureRuntimePolicy(ctx);
      ctx.worldWorker?.config({ creativeKind: ctx.creativeKind, creativeValue: ctx.creativeValue });
    },
    setWorldDelay(ms) { ctx.worldWorker?.config({ artificialDelayMs: +ms || 0 }); },
    setCreatureRuntime(simulate, naturalSpawn = false) {
      engine()?.setCreatureRuntime(!!simulate, !!naturalSpawn);
      ctx.worldWorker?.testCreatureRuntime(!!simulate, !!naturalSpawn);
    },
    spawnNatural(species, salt = 0, forceBreach = false) {
      ctx.worldWorker?.testNaturalSpawn(species | 0, salt | 0, !!forceBreach);
    },
    flushAuthorityControl() { ctx.worldWorker?.updateControl(); },
    paintWorker(material, x, y, radius = 8) { ctx.worldWorker?.testPaintDisc(material, x, y, radius); },
    seedWorkerReaction(material, cap = 600, phase = 0) { ctx.worldWorker?.testSeedReaction(material, cap, phase); },
    addInventory(material, count) { ctx.worldWorker?.intent('add', { material: material | 0, count: count | 0 }); return true; },
    getInventory() { return ctx.netClientReady() ? ctx.net.getOwnInventory() : ctx.worldWorker?.getInventory() || { slots: [], selected: 0 }; },
    selectSlot(i) { if (ctx.netClientReady()) ctx.net.sendSelect(i | 0); else ctx.worldWorker?.intent('select', { slot: i | 0 }); },
    actionCount() { return ctx.worldWorker?.getActionCount() || 0; },
    // device-px center of the local player (for aiming real mouse events)
    playerScreen() {
      const p = localPlayer();
      if (!p) return null;
      const cam = engine() ? engine().getCam() : { x: 0, y: 0 };
      const camCol = Math.floor(cam.x), camRow = Math.floor(cam.y);
      const o = engine() ? engine().glGetOffset() : { offX: 0, offY: 0 };
      return {
        x: ((p.x + p.w / 2 - camCol) * ctx.cellDev + o.offX) / ctx.dpr,
        y: ((p.y + p.h / 2 - camRow) * ctx.cellDev + o.offY) / ctx.dpr,
      };
    },
  };

  // Multiplayer hooks for the two-context Playwright test.
  window.__sandNet = {
    join: (url, room) => netJoin(url, room),
    disconnect: () => netDisconnect(),
    status: () => netStatus(),
    players: () => playersForRender(),
    playerCount: () => playersForRender().length,
    ownPlayer: () => (ctx.netClientReady() ? ctx.net.getOwnPlayer() : localPlayer()),
    // Dropped-item count from whichever authority currently owns the world.
    items: () => (ctx.netClientReady() ? ctx.net.getItemsForRender() : ctx.worldWorker?.getItemsForRender() || []).length / ITEM_FIELDS,
    ownInventory: () => (ctx.netClientReady() ? ctx.net.getOwnInventory() : ctx.worldWorker?.getInventory() || null),
    ownCursor: () => (ctx.netClientReady() ? ctx.net.getOwnCursor() : ctx.worldWorker?.getCursor() || null),
    // survival intents routed to the server (used by the mp e2e test).
    select: (slot) => ctx.net.sendSelect(slot),
    pick: (slot, half) => ctx.net.sendPick(slot, half),
    throwCursor: (whole) => ctx.net.sendThrow(whole),
    debug: () => ctx.net.debug,
    // Drive N fixed sim steps synchronously (RAF-throttling-immune) so the
    // two-context multiplayer test is deterministic.
    tickSteps: (n = 1, present = true) => {
      for (let i = 0; i < n; i++) doFixedStep(performance.now());
      if (present) render(false);
    },
  };

  return function uninstallDevHooks() {
    delete window.__sandPerf;
    delete window.__sandTest;
    delete window.__sandNet;
  };
}
