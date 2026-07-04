// DEV-only window hooks for the headless benchmarks and Playwright tests:
// __sandPerf (perf snapshot), __sandTest (deterministic pan/flicker + gameplay
// hooks), __sandNet (two-context multiplayer hooks). Installed only under
// import.meta.env.DEV; every dependency is passed in explicitly so the hooks
// can't silently reach into shell closures.

import { ITEM_FIELDS } from '../net/protocol.js';
import { TOOL_IDS } from './runtimeConfig';

export function installDevHooks(ctx, {
  render,
  doFixedStep,
  localPlayer,
  playersForRender,
  currentLocalInput,
  perfFrameSummary,
  netJoin,
  netDisconnect,
  netStatus,
}) {
  const engine = () => ctx.engine;

  window.__sandPerf = () => {
    const { avg, p95, samples } = perfFrameSummary();
    const perf = engine() ? engine().getPerf() : { stepMs: 0, dirtyChunks: 0 };
    return {
      stepMs: Number(perf.stepMs.toFixed(2)),
      renderMs: Number(ctx.perfRenderMs.toFixed(2)),
      lightMs: Number((perf.lightMs || 0).toFixed(3)),
      fillMs: Number((perf.fillMs || 0).toFixed(3)),
      uploadMs: Number((perf.uploadMs || 0).toFixed(3)),
      avgFrameMs: Number(avg.toFixed(3)),
      p95FrameMs: Number(p95.toFixed(3)),
      samples,
      dirtyChunks: perf.dirtyChunks,
      worldShifts: engine() ? engine().getWorldShiftCount() : 0,
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
    setPaused(v) { ctx.testPaused = !!v; }, // freeze the sim so the flicker probe sees only pan changes
    setGutter(v) { ctx.gutterOn = !!v; engine()?.glSetFlags(ctx.gutterOn, ctx.snapOff); render(false); },
    off() { return engine() ? engine().glGetOffset() : { offX: 0, offY: 0 }; },
    setSnap(v) { ctx.snapOff = !v; engine()?.glSetFlags(ctx.gutterOn, ctx.snapOff); render(false); },
    info() { return { cols: ctx.cols, rows: ctx.rows, cellSize: ctx.cellSize, cellDev: ctx.cellDev, viewCols: ctx.viewCols, viewRows: ctx.viewRows, dpr: window.devicePixelRatio || 1, canvasW: ctx.canvas.width, canvasH: ctx.canvas.height }; },
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
    getPlayers() { return engine() ? engine().getPlayers() : []; },
    renderedPlayers() { return playersForRender(); },
    localInput() { return currentLocalInput(); },
    heldKeys() { return engine() ? engine().getHeldKeys() : 0; },
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
    setTool(name) { ctx.currentToolName = name; engine()?.setTool(TOOL_IDS[name] ?? 0); },
    setDrawMode(v) { ctx.drawModeOn = !!v; engine()?.setDrawMode(ctx.drawModeOn); },
    addInventory(material, count) { return ctx.localPlayerId && engine() ? engine().addToInventory(ctx.localPlayerId, material | 0, count | 0) : false; },
    selectSlot(i) { if (ctx.localPlayerId) engine()?.setSelectedSlot(ctx.localPlayerId, i | 0); },
    actionCount() { return engine() ? engine().getPlayerActionCount() : 0; },
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
    // dropped-item count (client: from the server snapshot; else the engine).
    items: () => (ctx.netClientReady() ? ctx.net.getItemsForRender().length / ITEM_FIELDS : (ctx.engine ? ctx.engine.itemCount() : 0)),
    ownInventory: () => (ctx.netClientReady() ? ctx.net.getOwnInventory() : (ctx.localPlayerId && ctx.engine ? ctx.engine.getInventory(ctx.localPlayerId) : null)),
    ownCursor: () => (ctx.netClientReady() ? ctx.net.getOwnCursor() : (ctx.localPlayerId && ctx.engine ? ctx.engine.getCursor(ctx.localPlayerId) : null)),
    // survival intents routed to the server (used by the mp e2e test).
    select: (slot) => ctx.net.sendSelect(slot),
    pick: (slot, half) => ctx.net.sendPick(slot, half),
    throwCursor: (whole) => ctx.net.sendThrow(whole),
    debug: () => ctx.net.debug,
    // Drive N fixed sim steps synchronously (RAF-throttling-immune) so the
    // two-context multiplayer test is deterministic.
    tickSteps: (n = 1) => { for (let i = 0; i < n; i++) doFixedStep(performance.now()); render(false); },
  };

  return function uninstallDevHooks() {
    delete window.__sandPerf;
    delete window.__sandTest;
    delete window.__sandNet;
  };
}
