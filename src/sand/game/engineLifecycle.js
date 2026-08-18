// Engine lifecycle for the sand runtime: viewport fitting, engine
// construction/wiring (one build path shared by resize and the multiplayer
// dims-rebuild), runtime zoom, and the devicePixelRatio watch.
//
// All mutable runtime state lives on the shared `ctx` object owned by
// createSandGame.js; this module only reads/writes ctx and drives the engine.

import { createEngineWasm } from '../wasmBridge/engineFactory.js';
import { SIZING, TOOL_IDS } from './runtimeConfig';
import { applyCreatureRuntimePolicy } from './creatureRuntimePolicy';
import { chooseStableCssSize, computeViewportSizing, shouldResizeBuffer } from './viewportSizing';
import { NIGHT_SKY_LIGHT } from './dayNightCycle.js';

/** @param {import('./runtimeContext.js').SandRuntimeContext} ctx */
export function createEngineLifecycle(ctx, { onLayoutChange }) {
  const { canvas, container, parallax } = ctx;

  const refreshBounds = () => {
    const rect = container.getBoundingClientRect();
    ctx.wrapBounds = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    return rect;
  };

  const parallaxCamera = (cam = ctx.engine?.getCam()) => {
    if (!ctx.engine || !cam) return undefined;
    const worldX = ctx.engine.getWorldOffsetX() + cam.x + ctx.viewCols * 0.5;
    const worldY = ctx.engine.getWorldOffsetY() + cam.y + ctx.viewRows * 0.5;
    return {
      // Anchor horizontal parallax to the view center. Runtime zoom preserves
      // this world point while moving the top-left camera by half the changing
      // viewport width; using that top-left value made the backdrop appear to
      // race sideways even though the camera center had not moved.
      camX: worldX,
      camY: ctx.engine.getWorldOffsetY() + cam.y,
      scale: ctx.bgZoomScale(),
      dayNight: ctx.dayNight,
      biomeSample: ctx.engine.worldBiomeSample(worldX, worldY),
    };
  };

  // Construct a presentation engine and reapply all runtime state.
  const buildEngine = ({ cols = ctx.cols, rows = ctx.rows } = {}) => {
    const previous = ctx.engine;
    let e = null;
    try {
      e = createEngineWasm({
        cols,
        rows,
        infinite: true,
        storageRole: 'presentation',
        worldSeed: ctx.worldSeed,
        sinksOn: false, // taps/sinks are obsolete in the streaming world
        planetId: ctx.planetId,
        gravityScale: ctx.gravityScale,
      });
      const resolvedGravityScale = e.getGravityScale();
      if (!e.glInit(canvas)) throw new Error('The sand renderer could not initialize WebGL2.');
      const gl = canvas.getContext('webgl2');
      const reportedTextureSize = gl?.getParameter(gl.MAX_TEXTURE_SIZE);
      const maxTextureSize = Number.isFinite(reportedTextureSize) && reportedTextureSize > 0
        ? reportedTextureSize
        : ctx.maxTextureSize;
      const skyLight = ctx.dayNight?.skyLight ?? NIGHT_SKY_LIGHT;
      e.glResize(canvas.width, canvas.height);
      e.setSkyLight(skyLight);
      e.setTool(TOOL_IDS[ctx.currentToolName] ?? 0);   // re-apply the selected tool
      e.setCreativeMaterial(ctx.creativeKind, ctx.creativeValue);
      e.setViewport(ctx.dpr, ctx.cellDev, ctx.viewCols, ctx.viewRows);
      e.setPlayMode(ctx.playMode);
      e.setDrawMode(ctx.drawModeOn);
      e.inputStick(ctx.stickX, ctx.stickY);
      e.glSetFlags(ctx.gutterOn, ctx.snapOff, ctx.reduced);
      e.glSetDebugHitboxes(ctx.debugHitboxes);
      applyCreatureRuntimePolicy(ctx, e);

      previous?.destroy?.();
      ctx.engine = e;
      ctx.cols = cols;
      ctx.rows = rows;
      // The compiled engine owns planet defaults; retain its resolved value for
      // the authority worker and later presentation-engine rebuilds.
      ctx.gravityScale = resolvedGravityScale;
      ctx.maxTextureSize = maxTextureSize;
      ctx.appliedSkyLight = skyLight;
      ctx.forceFullRender = true;
      ctx.previewDirty = false;
      return e;
    } catch (error) {
      e?.destroy({ releaseGlTarget: !previous });
      throw error;
    }
  };

  const fit = () => {
    // ResizeObserver/visualViewport fits can interleave with the delayed mobile
    // zoom action. Anchor every fit, not just explicit zoom, so neither a new
    // viewport nor the authority resize snapshot can move the visible world.
    const before = ctx.engine?.getCam();
    const worldCenter = before ? {
      x: ctx.engine.getWorldOffsetX() + before.x + ctx.viewCols * 0.5,
      y: ctx.engine.getWorldOffsetY() + before.y + ctx.viewRows * 0.5,
    } : null;
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

    const sizing = computeViewportSizing(
      cssW, cssH, ctx.dpr, SIZING, ctx.zoomFactor(), ctx.baselineDpr, ctx.maxTextureSize,
    );
    ctx.zoom = sizing.zoom;
    ctx.cellSize = sizing.cellSize;
    ctx.cellDev = sizing.cellDev;
    canvas.width = sizing.canvasW;
    canvas.height = sizing.canvasH;
    ctx.viewCols = sizing.viewCols;
    ctx.viewRows = sizing.viewRows;
    ctx.requestedViewCols = sizing.viewCols;
    ctx.requestedViewRows = sizing.viewRows;
    ctx.requestedBufferCols = sizing.bufCols;
    ctx.requestedBufferRows = sizing.worldRows;
    let bufCols = sizing.bufCols;
    let worldRows = sizing.worldRows;

    // As a connected multiplayer client the simulation buffer is the SERVER's
    // (diffs are authored in its cols/rows); never rebuild it to window dims on
    // resize — only resize the GL backing store + viewport (view-only zoom).
    // Clamp the visible window so it never exceeds the host buffer.
    if (ctx.netClientReady() && ctx.engine) {
      bufCols = ctx.cols;
      worldRows = ctx.rows;
      ctx.viewCols = Math.min(ctx.viewCols, ctx.cols);
      ctx.viewRows = Math.min(ctx.viewRows, ctx.rows);
    }

    const applyViewOnly = () => {
      // View must fit the live buffer (camera clamp / stream assume this).
      ctx.viewCols = Math.min(ctx.viewCols, ctx.cols);
      ctx.viewRows = Math.min(ctx.viewRows, ctx.rows);
      ctx.engine.glResize(canvas.width, canvas.height);
      ctx.engine.setViewport(ctx.dpr, ctx.cellDev, ctx.viewCols, ctx.viewRows);
      if (worldCenter) {
        ctx.engine.cameraSet(
          worldCenter.x - ctx.engine.getWorldOffsetX() - ctx.viewCols * 0.5,
          worldCenter.y - ctx.engine.getWorldOffsetY() - ctx.viewRows * 0.5,
        );
      }
      parallax.draw(parallaxCamera());
      ctx.forceFullRender = true;
      ctx.previewDirty = false;
    };

    // Live engine, same desired buffer (or current shared client dims): pure view update.
    if (ctx.engine && ctx.cols === bufCols && ctx.rows === worldRows) {
      applyViewOnly();
      return;
    }

    // Live local (non-client) engine: prefer world-preserving resize over destroy.
    // Hysteresis may keep the old buffer — then fall through to view-only.
    if (ctx.engine && !ctx.netClientReady()) {
      if (shouldResizeBuffer(ctx.cols, ctx.rows, bufCols, worldRows, ctx.viewCols, ctx.viewRows, SIZING)) {
        if (ctx.engine.resizeLoadedWindow(bufCols, worldRows)) {
          ctx.cols = bufCols;
          ctx.rows = worldRows;
          ctx.worldWorker?.resize(ctx.cols, ctx.rows, worldCenter);
        }
      }
      applyViewOnly();
      ctx.lastCamX = NaN;
      ctx.lastCamY = NaN;
      return;
    }

    // First build (or multiplayer client path that still needs a fresh engine).
    const engine = buildEngine({ cols: bufCols, rows: worldRows });
    const spawnCol = Math.floor(ctx.cols / 2);
    const spawnRow = engine.worldSurfaceAt(engine.getWorldOffsetX() + spawnCol);
    // The browser engine is always a presentation replica. Offline players are
    // spawned by the local authority worker; multiplayer players live on the
    // headless server. The mirror only creates a prediction body after the
    // first authoritative player snapshot arrives.
    // Start centered horizontally, with roughly one third of the view underground.
    engine.cameraSet((ctx.cols - ctx.viewCols) / 2, spawnRow - Math.floor(ctx.viewRows * (2 / 3)));
    parallax.draw(parallaxCamera());
    ctx.lastCamX = NaN;
    ctx.lastCamY = NaN;
  };

  // Rebuild the local render engine to the authoritative server's buffer dims
  // so world diffs apply 1:1 (a connected client renders the server's shared
  // streamed window, never its own). Keeps the current view metrics; does
  // NOT spawn a local player (the server owns it). Called by the net layer on
  // the first WORLD message.
  const rebuildEngineForDims = (netCols, netRows) => {
    if (ctx.engine && ctx.cols === netCols && ctx.rows === netRows) {
      if (ctx.localPlayerId) ctx.engine.removePlayer(ctx.localPlayerId);
      ctx.localPlayerId = 0;
      return ctx.engine;
    }
    const previousViewCols = ctx.viewCols;
    const previousViewRows = ctx.viewRows;
    ctx.viewCols = Math.min(ctx.requestedViewCols || ctx.viewCols || netCols, netCols);
    ctx.viewRows = Math.min(ctx.requestedViewRows || ctx.viewRows || netRows, netRows);
    let engine;
    try {
      engine = buildEngine({ cols: netCols, rows: netRows });
    } catch (error) {
      ctx.viewCols = previousViewCols;
      ctx.viewRows = previousViewRows;
      throw error;
    }
    ctx.localPlayerId = 0; // client: the server owns our player; render from snapshots
    engine.cameraSet((ctx.cols - ctx.viewCols) / 2, Math.max(0, (ctx.rows - ctx.viewRows) / 2));
    return engine;
  };

  // ---- runtime zoom (view + loaded window; world preserved via resize) ----
  // Re-fit at a new zoom factor and keep the same world point centered.
  const clampZoom = (z) => {
    const lo = SIZING.zoomOutMin ?? 0.05;
    const hi = SIZING.zoomInMax ?? 8;
    if (!(z > 0) || Number.isNaN(z)) return SIZING.zoomDefault ?? 1;
    return Math.min(hi, Math.max(lo, z));
  };

  const applyZoom = (nextZoom) => {
    const clamped = clampZoom(nextZoom);
    if (!ctx.engine) return;
    if (Math.abs(clamped - ctx.zoom) < 1e-9) return;
    ctx.zoom = clamped;
    fit();
    ctx.lastCamX = NaN;
    ctx.lastCamY = NaN;
    ctx.forceFullRender = true;
    ctx.fns.render?.(true);
  };
  // delta > 0 = zoom in (fewer cells). Multiplicative steps. Coalesce key
  // repeat / rapid mobile taps so one gesture performs one loaded-window +
  // three-texture resize; allocating every intermediate size can temporarily
  // exhaust Chrome's GPU resources even when the final size is legal.
  let zoomTimer = 0;
  let queuedZoom = ctx.zoom;
  const zoomBy = (delta) => {
    const f = SIZING.zoomStepFactor ?? 1.15;
    const base = zoomTimer ? queuedZoom : ctx.zoom;
    queuedZoom = delta > 0 ? base * f : base / f;
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      zoomTimer = 0;
      applyZoom(queuedZoom);
      queuedZoom = ctx.zoom;
    }, 100);
  };
  const resetZoom = () => {
    clearTimeout(zoomTimer);
    zoomTimer = 0;
    queuedZoom = SIZING.zoomDefault ?? 1;
    applyZoom(queuedZoom);
  };

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
  const unwatchDpr = () => {
    mqDpr?.removeEventListener?.('change', onDprChange);
    mqDpr = null;
    clearTimeout(zoomTimer);
    zoomTimer = 0;
  };

  const onContextLost = (event) => {
    // Asking WebGL to restore is safe because all context-owned objects are
    // rebuilt below. Clear every held input immediately so a lost canvas can
    // never leave the camera/player racing while Safari recovers the device.
    event.preventDefault();
    ctx.stickX = ctx.stickY = 0;
    ctx.mouseButtons = 0;
    ctx.engine?.inputClearKeys();
    ctx.engine?.inputStick(0, 0);
    ctx.engine?.pointerButtons(0);
    ctx.engine?.inputPointer(ctx.px, ctx.py, 0, ctx.inside);
    ctx.forceFullRender = true;
  };
  const onContextRestored = () => {
    const engine = ctx.engine;
    if (!engine?.glRestore()) return;
    engine.glResize(canvas.width, canvas.height);
    engine.setViewport(ctx.dpr, ctx.cellDev, ctx.viewCols, ctx.viewRows);
    engine.glSetFlags(ctx.gutterOn, ctx.snapOff, ctx.reduced);
    engine.glSetDebugHitboxes(ctx.debugHitboxes);
    ctx.forceFullRender = true;
    ctx.fns.render?.(true);
  };
  const watchContext = () => {
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
  };
  const unwatchContext = () => {
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
  };

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
    watchContext,
    unwatchContext,
  };
}
