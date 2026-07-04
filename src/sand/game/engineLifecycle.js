// Engine lifecycle for the sand runtime: viewport fitting, engine
// construction/wiring (one build path shared by resize and the multiplayer
// dims-rebuild), runtime zoom, and the devicePixelRatio watch.
//
// All mutable runtime state lives on the shared `ctx` object owned by
// createSandGame.js; this module only reads/writes ctx and drives the engine.

import { createEngineWasm } from '../wasmBridge/engineFactory.js';
import { SIZING, TOOL_IDS } from './runtimeConfig';
import { chooseStableCssSize, computeViewportSizing } from './viewportSizing';

export function createEngineLifecycle(ctx, { onLayoutChange, onInventory }) {
  const { canvas, container, parallax } = ctx;

  const refreshBounds = () => {
    const rect = container.getBoundingClientRect();
    ctx.wrapBounds = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    return rect;
  };

  const parallaxCamera = (cam = ctx.engine?.getCam()) => {
    if (!ctx.engine || !cam) return undefined;
    return {
      camX: ctx.engine.getWorldOffsetX() + cam.x,
      camY: ctx.engine.getWorldOffsetY() + cam.y,
      scale: ctx.bgZoomScale(),
    };
  };

  // Construct + wire a fresh engine at ctx.cols × ctx.rows. This is the ONE
  // build path (the old fit()/rebuildEngineForDims() duplicated it); every
  // knob the engine forgets on recreation is re-applied here.
  const buildEngine = () => {
    if (ctx.engine && ctx.engine.destroy) ctx.engine.destroy();
    const e = createEngineWasm({
      cols: ctx.cols,
      rows: ctx.rows,
      infinite: true,
      worldSeed: ctx.worldSeed,
      sinksOn: false, // taps/sinks are obsolete in the streaming world
    });
    ctx.engine = e;
    e.glInit(canvas);                                // WebGL2 context on our canvas
    e.glResize(canvas.width, canvas.height);
    e.setTool(TOOL_IDS[ctx.currentToolName] ?? 0);   // re-apply the selected tool
    e.setViewport(ctx.dpr, ctx.cellDev, ctx.viewCols, ctx.viewRows);
    e.setPlayMode(ctx.playMode);
    e.setDrawMode(ctx.drawModeOn);
    e.glSetFlags(ctx.gutterOn, ctx.snapOff);
    if (ctx.survival) e.setSurvivalInventory(true);  // mining->drops->inventory
    ctx.forceFullRender = true;
    ctx.previewDirty = false;
    return e;
  };

  const fit = () => {
    const { width, height } = refreshBounds();
    // The visible cell count is chosen from the PHYSICAL-pixel box (cssW*dpr,
    // corrected against the load-time dpr in computeViewportSizing), so neither
    // the device pixel ratio nor browser page zoom changes how many cells are
    // shown — only the container size and the in-game zoom do.
    ctx.dpr = window.devicePixelRatio || 1;
    ctx.stableCssSize = chooseStableCssSize(width, height, ctx.stableCssSize);
    const cssW = ctx.stableCssSize.width;
    const cssH = ctx.stableCssSize.height;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    // Size the parallax off the same zoom-corrected box as the sim so it, too,
    // ignores browser page zoom and stays in sync with the visible cells.
    const pageZoom = ctx.dpr / (ctx.baselineDpr > 0 ? ctx.baselineDpr : ctx.dpr);
    parallax.resize(cssW * pageZoom, cssH * pageZoom);
    parallax.draw(parallaxCamera());
    // Decide UI placement based on available horizontal space
    onLayoutChange?.({ uiAtBottom: width < SIZING.toolCollapseWidth });

    const sizing = computeViewportSizing(cssW, cssH, ctx.dpr, SIZING, ctx.zoomFactor(), ctx.minZoomFactor(), ctx.baselineDpr);
    ctx.cellSize = sizing.cellSize;
    ctx.cellDev = sizing.cellDev;
    canvas.width = sizing.canvasW;
    canvas.height = sizing.canvasH;
    ctx.viewCols = sizing.viewCols;
    ctx.viewRows = sizing.viewRows;
    let bufCols = sizing.bufCols;
    let worldRows = sizing.worldRows;

    // As a connected multiplayer client the simulation buffer is the SERVER's
    // (diffs are authored in its cols/rows); never rebuild it to window dims on
    // resize — only resize the GL backing store + viewport (the pure-zoom path).
    if (ctx.netClientReady() && ctx.engine) { bufCols = ctx.cols; worldRows = ctx.rows; }

    // The simulation buffer depends on logical CSS viewport cells, not on dpr.
    // So a pure zoom/display-scale change keeps the same world and only
    // repaints at the new device resolution.
    if (ctx.engine && ctx.cols === bufCols && ctx.rows === worldRows) {
      ctx.engine.glResize(canvas.width, canvas.height);
      ctx.engine.setViewport(ctx.dpr, ctx.cellDev, ctx.viewCols, ctx.viewRows);
      parallax.draw(parallaxCamera());
      ctx.forceFullRender = true;
      ctx.previewDirty = false;
      return;
    }
    ctx.cols = bufCols;
    ctx.rows = worldRows;

    const engine = buildEngine();
    const spawnCol = Math.floor(ctx.cols / 2);
    const spawnRow = engine.worldSurfaceAt(engine.getWorldOffsetX() + spawnCol);
    // Spawn the local player on the surface in survival mode (unless a client,
    // where the host owns it — it gets removed and re-rendered from snapshots
    // when joining). Creative mode has no character.
    if (ctx.survival && !ctx.netClientReady()) {
      ctx.localPlayerId = engine.spawnPlayerAtSurface(spawnCol);
      onInventory?.(engine.getInventory(ctx.localPlayerId)); // initial HUD fill
      ctx.lastInvHash = engine.inventoryHash(ctx.localPlayerId);
    }
    // Start centered horizontally, with roughly one third of the view underground.
    engine.cameraSet((ctx.cols - ctx.viewCols) / 2, spawnRow - Math.floor(ctx.viewRows * (2 / 3)));
    parallax.draw(parallaxCamera());
    ctx.lastCamX = NaN;
    ctx.lastCamY = NaN;
  };

  // Rebuild the local render engine to the authoritative server's buffer dims
  // so world diffs apply 1:1 (a connected client renders the server's
  // bounded-arena world, never its own). Keeps the current view metrics; does
  // NOT spawn a local player (the server owns it). Called by the net layer on
  // the first WORLD message.
  const rebuildEngineForDims = (netCols, netRows) => {
    if (ctx.engine && ctx.cols === netCols && ctx.rows === netRows) {
      if (ctx.localPlayerId) ctx.engine.removePlayer(ctx.localPlayerId);
      ctx.localPlayerId = 0;
      return ctx.engine;
    }
    ctx.cols = netCols;
    ctx.rows = netRows;
    const engine = buildEngine();
    ctx.localPlayerId = 0; // client: the server owns our player; render from snapshots
    engine.cameraSet((ctx.cols - ctx.viewCols) / 2, Math.max(0, (ctx.rows - ctx.viewRows) / 2));
    return engine;
  };

  // ---- runtime zoom (view-only; the buffer is fixed, so no world rebuild) ----
  // Re-fit at a new zoom index and keep the same world point centered (fit()'s
  // fast path leaves the camera's top-left fixed, which would drift the view as
  // the window resizes, so we recenter around the pre-zoom center).
  const applyZoom = (nextIndex) => {
    const clamped = Math.max(0, Math.min(SIZING.zoomSteps.length - 1, nextIndex | 0));
    if (clamped === ctx.zoomIndex || !ctx.engine) return;
    const cam = ctx.engine.getCam();
    const centerX = cam.x + ctx.viewCols / 2;   // buffer-cell center BEFORE the zoom
    const centerY = cam.y + ctx.viewRows / 2;
    ctx.zoomIndex = clamped;
    fit();                                      // buffer dims unchanged -> fast path (keeps the world)
    ctx.engine.cameraSet(centerX - ctx.viewCols / 2, centerY - ctx.viewRows / 2);
    ctx.lastCamX = NaN;
    ctx.lastCamY = NaN;
    ctx.forceFullRender = true;
    ctx.fns.render?.(true);
  };
  const zoomBy = (delta) => applyZoom(ctx.zoomIndex + delta);
  const resetZoom = () => applyZoom(SIZING.zoomDefaultIndex);

  // Re-fit when devicePixelRatio changes (browser zoom). The ResizeObserver
  // only watches the CSS box, which is unchanged by zoom, so it wouldn't fire
  // here; fit() rebuilds the device-px backing store at the new ratio (and,
  // since the CSS-derived world dims are unchanged, keeps the running sim).
  let mqDpr = null;
  const onDprChange = () => { fit(); watchDpr(); };
  function watchDpr() {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    mqDpr?.removeEventListener?.('change', onDprChange);
    mqDpr = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mqDpr.addEventListener?.('change', onDprChange);
  }
  const unwatchDpr = () => { mqDpr?.removeEventListener?.('change', onDprChange); mqDpr = null; };

  return {
    refreshBounds,
    parallaxCamera,
    buildEngine,
    fit,
    rebuildEngineForDims,
    applyZoom,
    zoomBy,
    resetZoom,
    watchDpr,
    unwatchDpr,
  };
}
