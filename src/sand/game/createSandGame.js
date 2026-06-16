// Framework-agnostic falling-sand game runtime.
//
// `createSandGame(container, opts)` boots the whole interactive simulation into
// a host element using nothing but the DOM — no React. It owns its canvases,
// the render pipeline, all input, the RAF loop, world streaming, and the
// engine wiring, and returns a small handle to drive it from the outside:
//
//   const game = createSandGame(el, { initialTool: 'sand' });
//   game.setTool('water');
//   game.setDrawMode(true);
//   game.destroy();
//
// The React component in ../react/SandGame.jsx is a thin wrapper over this. The
// simulation runs in the WebAssembly engine (../engineWasm.js); initSandWasm()
// must have resolved before createSandGame() is called.

import { createEngineWasm, MAT, CHUNK_SIZE, SEED_SIZE } from '../engineWasm';
import { makeColorLUT, makeTexture, fillPixelSpan } from '../renderCore';
import { createCamera } from '../camera';

export function createSandGame(container, opts = {}) {
  const {
    initialTool = 'cube',
    onLayoutChange,
    reducedMotion,
  } = opts;

  // --- Host canvases (created and owned here) ---
  const canvas = document.createElement('canvas');
  canvas.id = 'sand-main'; // stable selector for the headless pan/flicker bench
  const previewCanvas = document.createElement('canvas');
  for (const c of [canvas, previewCanvas]) {
    c.style.position = 'absolute';
    c.style.inset = '0';
    c.style.width = '100%';
    c.style.height = '100%';
    c.style.pointerEvents = 'none';
    c.style.userSelect = 'none';
    c.setAttribute('aria-hidden', 'true');
    container.appendChild(c);
  }
  const cellCanvas = document.createElement('canvas');
  const cellCtx = cellCanvas.getContext('2d', { alpha: true });
  const ctx = canvas.getContext('2d', { alpha: true });
  const previewCtx = previewCanvas.getContext('2d', { alpha: true });
  if (!ctx || !cellCtx || !previewCtx) {
    return { setTool() {}, setDrawMode() {}, getDrawMode: () => false, destroy() {} };
  }

  // Mutable runtime flags (replace the React refs the old useEffect read).
  let currentTool = initialTool;
  let drawModeOn = false;
  let overrideTool = null; // 'eraser' while RMB held

  // One seed per mount so resizing regenerates the *same* infinite world.
  const worldSeed = (Math.random() * 4294967296) >>> 0;

  // ---- Tunables (render/UI side; physics tunables live in the C++ engine) ----
  const CELL_PX = 4;
  // Cap the simulation cell count so very large viewports (e.g. 1440p/4K
  // monitors) don't blow the per-step CPU budget on slow processors; cells
  // grow slightly instead.
  const MAX_CELLS = 130000;
  const SAND_BRUSH_RADIUS = 2;
  const WATER_BRUSH_RADIUS = 2;
  const STONE_BRUSH_RADIUS = 2;
  const OIL_BRUSH_RADIUS = 2;
  const FIRE_BRUSH_RADIUS = 1;
  const ACID_BRUSH_RADIUS = 2;
  const LAVA_BRUSH_RADIUS = 2;
  const ICE_BRUSH_RADIUS = 2;
  const DRIFTWOOD_BRUSH_RADIUS = 1; // small brush; drafts a shape, drops on release
  const ERASE_BRUSH_RADIUS = 3;
  const CUBE_HALF = 6; // half-extent of the rigid cube body (cells)
  const EMIT_INTERVAL_MS = 18;
  const STEP_MS = 16;
  const TOOL_COLLAPSE_W = 1300; // px: move toolbar to bottom if wrapper width < this
  const FULL_RENDER_DIRTY_CHUNK_RATIO = 0.38;
  // World/camera: the simulation buffer is bigger than the viewport. It is the
  // full (fixed) world height and a horizontal window a margin wider than the
  // view; the camera pans within it (WASD/arrows). Horizontal streaming that
  // slides the window comes in a later phase.
  const WORLD_HEIGHT_FACTOR = 2.5; // world is this many viewports tall
  const BUF_MARGIN_COLS = 128;     // extra buffer columns on each side of the view
  const BUFFER_MAX_CELLS = 520000; // cap so the per-step budget stays bounded
  const PAN_CELLS_PER_SEC = 100;   // camera pan speed while a key is held
  const MAX_FRAME_DT = 50;         // ms; clamp so a stall can't produce a big jump
  // Horizontal streaming: slide the world by SHIFT_COLS when the camera comes
  // within SHIFT_EDGE_MARGIN of a buffer edge, so it always has room to pan.
  const SHIFT_COLS = 128;
  const SHIFT_EDGE_MARGIN = 40;

  // Colors
  const STONE_PREVIEW_COLOR = 'rgba(160,160,170,0.40)';
  const DRIFTWOOD_PREVIEW_COLOR = 'rgba(140,125,110,0.45)';
  const ICE_PREVIEW_COLOR = 'rgba(150, 225, 240, 0.40)';
  const SEED_PREVIEW_COLOR = 'rgba(120, 190, 100, 0.32)';
  const colorLUT = makeColorLUT();
  const colorTexture = makeTexture(colorLUT);

  // Simulation engine (recreated on resize)
  // cols/rows are the BUFFER (world) dimensions, larger than the viewport;
  // viewCols/viewRows are the visible cell window the camera shows.
  let engine = null;
  let cols = 0, rows = 0, cellSize = CELL_PX;
  // cellSize is CSS px per cell (drives the cell budget, appearance, and pointer
  // math). cellDev is the integer DEVICE px per cell used for all canvas drawing.
  // Sizing the backing store to device px and snapping the pan offset to whole
  // device px keeps cell edges + the 1px gutter grid on exact device pixels, so
  // the compositor never resamples them — that resampling (at browser zoom < 100%,
  // where devicePixelRatio drops below 1) is what caused the bright-block flicker.
  let dpr = 1, cellDev = CELL_PX;
  let viewCols = 0, viewRows = 0;
  const camera = createCamera();
  let lastCamX = NaN, lastCamY = NaN; // detect camera movement (incl. sub-cell) to redraw
  let testPaused = false;             // DEV-only: freeze stepping for the flicker bench
  let gutterOn = true;                // DEV-only: toggle the grid for flicker A/B
  let lastOffX = 0, lastOffY = 0;     // DEV-only: last snapped present offset
  let snapOff = false;                // DEV-only: disable offset snapping for A/B
  const pressedKeys = new Set();         // held WASD/arrow keys for panning
  let wrapBounds = { left: 0, right: 0, top: 0, bottom: 0 };
  let imageData = null;
  let pixels = new Uint32Array(0);
  let forceFullRender = true;
  let perfRenderMs = 0;
  let previewDirty = false;
  let previewVisible = false;

  // Rolling perf samples for window.__sandPerf
  const PERF_SAMPLES = 120;
  const perfStepSamples = new Float32Array(PERF_SAMPLES);
  const perfRenderSamples = new Float32Array(PERF_SAMPLES);
  let perfSampleIdx = 0;
  let perfSampleCount = 0;

  // Drafting state (data lives in the engine; UI flags live here)
  let isDraftingStone = false;
  let isDraftingSeed = false;
  let isDraftingIce = false;
  // Driftwood reuses the stone draft buffer; this flag picks the smaller brush
  // and the driftwood finalize on release.
  let draftIsDriftwood = false;
  let seedDraftOrigin = null;

  // Pointer tracking
  let clientX = -1, clientY = -1;
  let px = -1, py = -1;
  let inside = false;
  let lmbDown = false;

  // Reduced motion
  let reduced = false;
  let mqReduced = null;
  let onReducedChange = null;
  if (reducedMotion !== undefined) {
    reduced = reducedMotion;
  } else if (typeof window !== 'undefined' && window.matchMedia) {
    mqReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mqReduced.matches;
    onReducedChange = () => (reduced = mqReduced.matches);
    mqReduced.addEventListener?.('change', onReducedChange);
    mqReduced.addListener?.(onReducedChange);
  }

  const refreshBounds = () => {
    const rect = container.getBoundingClientRect();
    wrapBounds = {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    };
    return rect;
  };

  const fit = () => {
    const { width, height } = refreshBounds();
    // CSS-px size of the canvas element, and its DEVICE-px backing store. dpr < 1
    // when the browser is zoomed out; sizing the backing store to device px makes
    // it 1:1 with the screen so the compositor never resamples (no moiré).
    dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(300, Math.floor(width));
    const cssH = Math.max(200, Math.floor(height));
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    previewCanvas.style.width = '100%';
    previewCanvas.style.height = '100%';
    // Decide UI placement based on available horizontal space
    onLayoutChange?.({ uiAtBottom: width < TOOL_COLLAPSE_W });

    cellSize = CELL_PX;
    while (
      Math.ceil(cssW / cellSize) * Math.ceil(cssH / cellSize) > MAX_CELLS
    ) {
      cellSize++;
    }
    cellDev = Math.max(1, Math.round(cellSize * dpr)); // integer device px per cell
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    previewCanvas.width = canvas.width;
    previewCanvas.height = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    previewCtx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    previewCtx.imageSmoothingEnabled = false;

    // Visible window (cells on screen) vs. the larger simulation buffer.
    viewCols = Math.max(60, Math.ceil(cssW / cellSize));
    viewRows = Math.max(28, Math.ceil(cssH / cellSize));
    // Buffer: full world height (taller than the view) + horizontal margin,
    // both rounded up to whole render chunks. Shrink the height factor if the
    // cell budget would be exceeded.
    const roundChunks = (n) => Math.ceil(n / CHUNK_SIZE) * CHUNK_SIZE;
    let bufCols = roundChunks(viewCols + BUF_MARGIN_COLS * 2);
    let heightFactor = WORLD_HEIGHT_FACTOR;
    let worldRows = roundChunks(Math.round(viewRows * heightFactor));
    while (bufCols * worldRows > BUFFER_MAX_CELLS && heightFactor > 1) {
      heightFactor -= 0.25;
      worldRows = roundChunks(Math.max(viewRows, Math.round(viewRows * heightFactor)));
    }

    // The simulation buffer depends only on CSS size + cellSize, not on dpr. So a
    // pure zoom change (dpr only) keeps the same world: just repaint at the new
    // device resolution instead of destroying and regenerating the engine.
    if (engine && cols === bufCols && rows === worldRows) {
      forceFullRender = true;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      previewDirty = false;
      previewVisible = false;
      return;
    }
    cols = bufCols;
    rows = worldRows;

    cellCanvas.width = cols;
    cellCanvas.height = rows;
    cellCtx.imageSmoothingEnabled = false;
    imageData = cellCtx.createImageData(cols, rows);
    pixels = new Uint32Array(imageData.data.buffer);

    if (engine && engine.destroy) engine.destroy(); // free a prior (e.g. WASM) engine on resize
    engine = createEngineWasm({
      cols,
      rows,
      infinite: true,
      worldSeed,
      emittersOn: false, // taps/sinks are obsolete in the streaming world
      sinksOn: false,
    });
    // Camera spans the buffer minus the visible window. Start centered
    // horizontally and just above the surface so the spawn view shows ground.
    camera.setBounds(cols - viewCols, rows - viewRows);
    const spawnWorldX = engine.getWorldOffsetX() + Math.floor(cols / 2);
    const spawnRow = engine.worldSurfaceAt(spawnWorldX);
    camera.set((cols - viewCols) / 2, spawnRow - Math.floor(viewRows * 0.4));
    lastCamX = NaN;
    lastCamY = NaN;
    isDraftingStone = false;
    isDraftingSeed = false;
    isDraftingIce = false;
    draftIsDriftwood = false;
    seedDraftOrigin = null;

    pixels.fill(0);
    forceFullRender = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewDirty = false;
    previewVisible = false;
  };

  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(container);

  // Re-fit when devicePixelRatio changes (browser zoom). The ResizeObserver only
  // watches the CSS box, which is unchanged by zoom, so it wouldn't fire here;
  // fit() rebuilds the device-px backing store at the new ratio (and, since the
  // CSS-derived world dims are unchanged, keeps the running simulation).
  let mqDpr = null;
  const onDprChange = () => { fit(); watchDpr(); };
  function watchDpr() {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    mqDpr?.removeEventListener?.('change', onDprChange);
    mqDpr = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mqDpr.addEventListener?.('change', onDprChange);
  }
  watchDpr();

  // Pointer helpers
  const updatePointer = (cx, cy) => {
    clientX = cx; clientY = cy;
    inside = cx >= wrapBounds.left && cx <= wrapBounds.right && cy >= wrapBounds.top && cy <= wrapBounds.bottom;
    px = cx - wrapBounds.left;
    py = cy - wrapBounds.top;
  };
  // Screen pixel (canvas-relative) -> buffer cell, through the camera offset.
  // Pointer (CSS px) -> cell, inverting the render mapping exactly: cells are
  // drawn at cellDev DEVICE px, so convert the cursor to device px (* dpr) and
  // divide by cellDev. Using cellSize (CSS) here drifts whenever cellSize*dpr
  // isn't integer (cellDev = round(cellSize*dpr)), offsetting the brush from the
  // cursor by an amount that grows with distance and flips sign around 100% zoom.
  const toCellX = () => Math.floor(camera.x + (px * dpr) / cellDev);
  const toCellY = () => Math.floor(camera.y + (py * dpr) / cellDev);
  const updateSeedDraft = () => {
    const prevX = seedDraftOrigin ? seedDraftOrigin[0] : null;
    const prevY = seedDraftOrigin ? seedDraftOrigin[1] : null;
    const nextOrigin = engine.getSeedOrigin(toCellX(), toCellY());
    const nextX = nextOrigin ? nextOrigin[0] : null;
    const nextY = nextOrigin ? nextOrigin[1] : null;
    const changed = prevX !== nextX || prevY !== nextY;
    seedDraftOrigin = nextOrigin;
    if (changed) previewDirty = true;
  };

  // Global listeners so canvas can stay pointer-events:none
  const onPointerMove = (e) => {
    updatePointer(e.clientX, e.clientY);
    if (e.buttons === 0) {
      overrideTool = null;
      lmbDown = false;
    }
    if (!drawModeOn) return;
    if (isDraftingStone && inside) {
      if (engine.addDiscToStoneDraft(toCellX(), toCellY(), draftIsDriftwood ? DRIFTWOOD_BRUSH_RADIUS : STONE_BRUSH_RADIUS)) previewDirty = true;
    }
    if (isDraftingIce && inside) {
      if (engine.addDiscToIceDraft(toCellX(), toCellY(), ICE_BRUSH_RADIUS)) previewDirty = true;
    }
    if (isDraftingSeed && inside) {
      updateSeedDraft();
    }
  };
  const onTouchMove = (e) => {
    if (!drawModeOn) return;
    if (!e.touches || e.touches.length === 0) return;
    const t = e.touches[0];
    updatePointer(t.clientX, t.clientY);
    if (isDraftingStone && inside) {
      if (engine.addDiscToStoneDraft(toCellX(), toCellY(), draftIsDriftwood ? DRIFTWOOD_BRUSH_RADIUS : STONE_BRUSH_RADIUS)) previewDirty = true;
    }
    if (isDraftingIce && inside) {
      if (engine.addDiscToIceDraft(toCellX(), toCellY(), ICE_BRUSH_RADIUS)) previewDirty = true;
    }
    if (isDraftingSeed && inside) {
      updateSeedDraft();
    }
  };

  // LMB:
  // - sand/water: paint while held
  // - stone: hold to draft; release to drop
  const onPointerDown = (e) => {
    if (!drawModeOn) return;
    updatePointer(e.clientX, e.clientY);
    if (!inside) return;

    if (e.button === 0) {
      lmbDown = true;
      const rmbHeld = overrideTool === 'eraser';
      const activeTool = rmbHeld ? 'eraser' : currentTool;

      if (activeTool === 'stone') {
        isDraftingStone = true;
        if (engine.addDiscToStoneDraft(toCellX(), toCellY(), draftIsDriftwood ? DRIFTWOOD_BRUSH_RADIUS : STONE_BRUSH_RADIUS)) previewDirty = true;
        e.preventDefault();
        return;
      }
      if (activeTool === 'driftwood') {
        // Hold-to-draft like stone, but dropped as driftwood on release.
        isDraftingStone = true;
        draftIsDriftwood = true;
        if (engine.addDiscToStoneDraft(toCellX(), toCellY(), DRIFTWOOD_BRUSH_RADIUS)) previewDirty = true;
        e.preventDefault();
        return;
      }
      if (activeTool === 'ice') {
        isDraftingIce = true;
        if (engine.addDiscToIceDraft(toCellX(), toCellY(), ICE_BRUSH_RADIUS)) previewDirty = true;
        e.preventDefault();
        return;
      }
      if (activeTool === 'seed') {
        isDraftingSeed = true;
        updateSeedDraft();
        e.preventDefault();
        return;
      }
      if (activeTool === 'cube') {
        const cx = toCellX();
        const cy = toCellY();
        const cells = [];
        for (let dx = -CUBE_HALF; dx < CUBE_HALF; dx++) {
          for (let dy = -CUBE_HALF; dy < CUBE_HALF; dy++) {
            const x = cx + dx, y = cy + dy;
            if (x >= 1 && x < cols - 1 && y >= 1 && y < rows - 1) cells.push([x, y]);
          }
        }
        if (cells.length) engine.spawnBody(cells);
        e.preventDefault();
        return;
      }
      e.preventDefault();
    }

    if (e.button === 2) {
      overrideTool = 'eraser'; // momentary while RMB held
      e.preventDefault();
    }
  };

  const onPointerUp = (e) => {
    if (e.button === 2 || e.buttons === 0) {
      overrideTool = null;
    }
    if (e.button === 0) {
      lmbDown = false;
      if (isDraftingStone) {
        if (draftIsDriftwood) engine.finalizeDriftwoodDraft();
        else engine.finalizeStoneDraft();
        isDraftingStone = false;
        draftIsDriftwood = false;
        engine.clearStoneDraft();
        previewDirty = true;
      }
      if (isDraftingIce) {
        engine.finalizeIceDraft();
        isDraftingIce = false;
        engine.clearIceDraft();
        previewDirty = true;
      }
      if (isDraftingSeed) {
        if (seedDraftOrigin) engine.placeSeedAt(seedDraftOrigin[0], seedDraftOrigin[1]);
        isDraftingSeed = false;
        seedDraftOrigin = null;
        previewDirty = true;
      }
    }
  };

  const onContextMenu = (e) => {
    if (drawModeOn && inside) e.preventDefault();
  };

  const onScroll = () => {
    refreshBounds();
    if (clientX >= 0 && clientY >= 0) updatePointer(clientX, clientY);
  };

  // Camera pan keys: WASD and arrows. Held keys live in `pressedKeys` and are
  // applied each step in the loop so panning is smooth and diagonal.
  const PAN_KEYS = {
    w: [0, -1], arrowup: [0, -1],
    s: [0, 1], arrowdown: [0, 1],
    a: [-1, 0], arrowleft: [-1, 0],
    d: [1, 0], arrowright: [1, 0],
  };
  // Only TEXT-entry controls should swallow the WASD/arrow keys. A checkbox or
  // button keeps focus after a click, so treating every <input> as editable
  // would silently disable camera panning.
  const TEXT_INPUT_TYPES = new Set([
    'text', 'search', 'email', 'password', 'number', 'url', 'tel',
  ]);
  const isEditableTarget = (t) => {
    if (!t) return false;
    if (t.isContentEditable) return true;
    const tag = t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return TEXT_INPUT_TYPES.has((t.type || 'text').toLowerCase());
    return false;
  };

  const onKeyDown = (e) => {
    if (isEditableTarget(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
    const key = e.key.toLowerCase();
    if (PAN_KEYS[key]) {
      pressedKeys.add(key);
      e.preventDefault(); // keep arrow keys from scrolling the page while panning
      return;
    }
  };
  const onKeyUp = (e) => {
    const key = e.key.toLowerCase();
    if (PAN_KEYS[key]) pressedKeys.delete(key);
  };
  const onBlur = () => pressedKeys.clear(); // avoid keys "sticking" on focus loss

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // Emission controller
  let lastEmit = 0;
  const emitAtPointer = (now) => {
    if (!inside) return;

    const rmbHeld = overrideTool === 'eraser';
    const activeTool = rmbHeld ? 'eraser' : currentTool;

    // Stone, ice and driftwood: handled by draft logic, not here
    if (activeTool === 'stone' || activeTool === 'ice' || activeTool === 'driftwood') return;
    if (!drawModeOn) return;

    // Paint only while LMB is down (or RMB for eraser)
    const shouldEmit =
      rmbHeld ? true :
      activeTool === 'eraser' ? lmbDown :
      (activeTool === 'sand' || activeTool === 'water' || activeTool === 'oil' || activeTool === 'fire' ||
       activeTool === 'acid' || activeTool === 'lava') ? lmbDown : false;

    if (!shouldEmit) return;
    if (now - lastEmit < EMIT_INTERVAL_MS) return;

    const cx = toCellX();
    const cy = toCellY();
    if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) return;

    if (activeTool === 'eraser') {
      engine.eraseDisc(cx, cy, ERASE_BRUSH_RADIUS);
      lastEmit = now; return;
    }
    if (activeTool === 'water') {
      engine.paintDisc(cx, cy, WATER_BRUSH_RADIUS, MAT.WATER, false);
      lastEmit = now; return;
    }
    if (activeTool === 'oil') {
      engine.paintDisc(cx, cy, OIL_BRUSH_RADIUS, MAT.OIL, false);
      lastEmit = now; return;
    }
    if (activeTool === 'fire') {
      engine.paintDisc(cx, cy, FIRE_BRUSH_RADIUS, MAT.FIRE, false);
      lastEmit = now; return;
    }
    if (activeTool === 'acid') {
      engine.paintDisc(cx, cy, ACID_BRUSH_RADIUS, MAT.ACID, false);
      lastEmit = now; return;
    }
    if (activeTool === 'lava') {
      engine.paintDisc(cx, cy, LAVA_BRUSH_RADIUS, MAT.LAVA, false);
      lastEmit = now; return;
    }
    // sand
    if (engine.getGrid()[cy * cols + cx] !== MAT.EMPTY) { lastEmit = now; return; }
    engine.paintDisc(cx, cy, SAND_BRUSH_RADIUS, MAT.SAND, false);
    lastEmit = now;
  };

  const render = (full = false) => {
    if (!imageData || !engine) return;

    const renderStart = performance.now();
    const grid = engine.getGrid();
    const { dirtyRender, dirtyRenderCount, chunkCols, chunkRows } = engine.getRenderDirty();

    // Visible buffer-cell window under the camera. Nothing outside it is ever
    // filled or blitted — that's the viewport culling. A buffer cell (bx,by)
    // maps to canvas pixels ((bx-camCol)*cellSize, (by-camRow)*cellSize), and a
    // fractional canvas translate below shifts everything by the sub-cell
    // remainder so panning is smooth rather than snapping cell-to-cell.
    const camCol = Math.floor(camera.x);
    const camRow = Math.floor(camera.y);
    // Sub-cell shift, snapped to whole DEVICE px. Snapping is what keeps cell
    // edges + the gutter grid on exact device pixels every frame, so panning no
    // longer re-quantizes them sub-pixel (the source of the bright-block flicker).
    const offX = snapOff ? -(camera.x - camCol) * cellDev : Math.round(-(camera.x - camCol) * cellDev);
    const offY = snapOff ? -(camera.y - camRow) * cellDev : Math.round(-(camera.y - camRow) * cellDev);
    lastOffX = offX; lastOffY = offY;
    const visX0 = camCol;
    const visY0 = camRow;
    const visX1 = Math.min(cols - 1, camCol + viewCols + 1); // +1 covers the shift
    const visY1 = Math.min(rows - 1, camRow + viewRows + 1);

    // Refill one buffer-cell rect's pixels into the persistent cellCanvas
    // (1px per cell, sized to the whole buffer). This is the only CPU pixel
    // work; it depends on grid contents, not the camera, so panning alone
    // never triggers it.
    const blitContent = (x0, y0, x1, y1) => {
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      fillPixelSpan(pixels, grid, cols, x0, y0, x1, y1, colorLUT, colorTexture);
      cellCtx.putImageData(imageData, 0, 0, x0, y0, w, h);
    };

    // Bring cellCanvas in sync with the grid for cells whose contents changed.
    // Processes dirty chunks across the WHOLE buffer (not clipped to the
    // visible window) so off-screen changes are correct when they later scroll
    // into view on a present-only frame.
    const syncCellCanvas = (fullSync) => {
      // When most chunks are dirty (or a full repaint is forced), one
      // buffer-wide fill + a single upload beats many small putImageData calls.
      if (fullSync || forceFullRender ||
          dirtyRenderCount > dirtyRender.length * FULL_RENDER_DIRTY_CHUNK_RATIO) {
        blitContent(0, 0, cols - 1, rows - 1);
        forceFullRender = false;
        return;
      }
      for (let cy = 0; cy < chunkRows; cy++) {
        const cy0 = cy * CHUNK_SIZE;
        const cy1 = Math.min(rows - 1, cy0 + CHUNK_SIZE - 1);
        let cx = 0;
        while (cx < chunkCols) {
          const chunkIndex = cy * chunkCols + cx;
          if (!dirtyRender[chunkIndex]) {
            cx++;
            continue;
          }
          const startCx = cx;
          while (cx + 1 < chunkCols) {
            if (!dirtyRender[cy * chunkCols + cx + 1]) break;
            cx++;
          }
          const endCx = cx;
          const cx0 = startCx * CHUNK_SIZE;
          const cx1 = Math.min(cols - 1, (endCx + 1) * CHUNK_SIZE - 1);
          blitContent(cx0, cy0, cx1, cy1);
          cx++;
        }
      }
    };

    // Present the visible window from cellCanvas onto the main canvas. Pure
    // GPU: a single upscaling drawImage plus the gutter erase, riding the
    // sub-cell translate. This is the cheap path that runs every camera-moved
    // frame without any CPU pixel work.
    const present = () => {
      const vw = visX1 - visX0 + 1;
      const vh = visY1 - visY0 + 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (vw <= 0 || vh <= 0) return;
      const w = vw * cellDev, h = vh * cellDev;
      // Riding the snapped sub-cell translate: a single nearest-neighbour upscale
      // of the visible window, then the 1px grid erased on cell boundaries. Both
      // are under the same integer-device-px transform, so they translate in
      // lockstep and land on exact device pixels (no sub-pixel re-quantization,
      // no compositor resample) -> no bright-block flicker while panning.
      ctx.setTransform(1, 0, 0, 1, offX, offY);
      ctx.drawImage(cellCanvas, visX0, visY0, vw, vh, 0, 0, w, h);
      if (gutterOn) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#000';
        for (let gx = cellDev; gx <= w; gx += cellDev) ctx.fillRect(gx - 1, 0, 1, h);
        for (let gy = cellDev; gy <= h; gy += cellDev) ctx.fillRect(0, gy - 1, w, 1);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0); // reset so other passes draw in screen space
    };

    const camMoved = camera.x !== lastCamX || camera.y !== lastCamY;
    const contentChanged = full || forceFullRender || dirtyRenderCount > 0;
    if (contentChanged) syncCellCanvas(full);
    if (contentChanged || camMoved) present();

    lastCamX = camera.x;
    lastCamY = camera.y;
    engine.clearRenderDirty();
    perfRenderMs = performance.now() - renderStart;
  };

  const renderPreview = () => {
    if (!engine || !previewDirty) return;
    previewCtx.setTransform(1, 0, 0, 1, 0, 0);
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewVisible = false;
    // Match the main canvas's sub-cell camera offset so drafts align with cells.
    const camCol = Math.floor(camera.x);
    const camRow = Math.floor(camera.y);
    previewCtx.setTransform(1, 0, 0, 1, Math.round(-(camera.x - camCol) * cellDev), Math.round(-(camera.y - camRow) * cellDev));

    const stoneDraft = engine.getStoneDraftCells();
    if (stoneDraft.size > 0) {
      previewCtx.fillStyle = draftIsDriftwood ? DRIFTWOOD_PREVIEW_COLOR : STONE_PREVIEW_COLOR;
      const previewSize = cellDev;
      for (const k of stoneDraft) {
        const y = (k / cols) | 0;
        const x = k - y * cols;
        previewCtx.fillRect((x - camera.colX) * cellDev, (y - camera.colY) * cellDev, previewSize, previewSize);
      }
      previewVisible = true;
    }

    const iceDraft = engine.getIceDraftCells();
    if (iceDraft.size > 0) {
      previewCtx.fillStyle = ICE_PREVIEW_COLOR;
      const previewSize = cellDev;
      for (const k of iceDraft) {
        const y = (k / cols) | 0;
        const x = k - y * cols;
        previewCtx.fillRect((x - camera.colX) * cellDev, (y - camera.colY) * cellDev, previewSize, previewSize);
      }
      previewVisible = true;
    }

    if (isDraftingSeed && seedDraftOrigin) {
      const [x0, y0] = seedDraftOrigin;
      const valid = engine.canPlaceSeedAt(x0, y0);
      previewCtx.fillStyle = valid ? SEED_PREVIEW_COLOR : 'rgba(255, 80, 80, 0.24)';
      const previewSize = cellDev;
      for (let y = y0; y < y0 + SEED_SIZE; y++) {
        for (let x = x0; x < x0 + SEED_SIZE; x++) {
          previewCtx.fillRect((x - camera.colX) * cellDev, (y - camera.colY) * cellDev, previewSize, previewSize);
        }
      }
      previewVisible = true;
    }
    previewCtx.setTransform(1, 0, 0, 1, 0, 0);
    previewDirty = false;
  };

  if (import.meta.env?.DEV && typeof window !== 'undefined') {
    window.__sandPerf = () => {
      const n = perfSampleCount;
      const sums = [];
      for (let i = 0; i < n; i++) sums.push(perfStepSamples[i] + perfRenderSamples[i]);
      sums.sort((a, b) => a - b);
      const avg = n > 0 ? sums.reduce((a, b) => a + b, 0) / n : 0;
      const p95 = n > 0 ? sums[Math.min(n - 1, Math.floor(n * 0.95))] : 0;
      const perf = engine ? engine.getPerf() : { stepMs: 0, dirtyChunks: 0 };
      return {
        stepMs: Number(perf.stepMs.toFixed(2)),
        renderMs: Number(perfRenderMs.toFixed(2)),
        avgFrameMs: Number(avg.toFixed(3)),
        p95FrameMs: Number(p95.toFixed(3)),
        samples: n,
        dirtyChunks: perf.dirtyChunks,
        rows,
        cols,
      };
    };
    // Deterministic hooks for the headless pan/flicker benchmark
    // (scripts/bench-pan.mjs). DEV-only, same guard as __sandPerf above.
    window.__sandTest = {
      setCam(x, y) { camera.set(x, y); render(false); },
      getCam() { return { x: camera.x, y: camera.y }; },
      render() { render(false); },
      setPaused(v) { testPaused = !!v; }, // freeze the sim so the flicker probe sees only pan changes
      setGutter(v) { gutterOn = !!v; render(false); },
      off() { return { offX: lastOffX, offY: lastOffY }; },
      setSnap(v) { snapOff = !v; render(false); },
      info() { return { cols, rows, cellSize, cellDev, viewCols, viewRows, dpr: window.devicePixelRatio || 1, canvasW: canvas.width, canvasH: canvas.height }; },
      // cursor (canvas-relative CSS px) -> cell, same mapping as the real input path
      cellAt(pxCss, pyCss) { return [Math.floor(camera.x + (pxCss * dpr) / cellDev), Math.floor(camera.y + (pyCss * dpr) / cellDev)]; },
      // device-px top-left where a cell renders (for round-trip verification)
      cellRect(cx, cy) { const camCol = Math.floor(camera.x), camRow = Math.floor(camera.y); return { x: (cx - camCol) * cellDev + lastOffX, y: (cy - camRow) * cellDev + lastOffY, size: cellDev }; },
    };
  }

  // Slide the persistent cellCanvas horizontally to mirror engine.shiftWorld, so
  // streaming the world is a single cheap GPU copy instead of repainting the
  // whole buffer (the old forceFullRender path — a ~per-cell fillPixelSpan over
  // the entire buffer every ~second of panning, which caused the periodic stutter
  // and made rigid bodies blink during the slow frame). The freshly exposed band
  // is left stale here and repainted by syncCellCanvas from the engine's dirty
  // chunks (shiftWorld marks that band dirty). drawImage onto the same canvas is
  // well-defined for overlapping regions (it copies from a snapshot).
  const shiftCellCanvas = (dx) => {
    if (!dx) return;
    if (dx > 0) {
      if (cols - dx > 0) cellCtx.drawImage(cellCanvas, dx, 0, cols - dx, rows, 0, 0, cols - dx, rows);
    } else {
      const s = -dx;
      if (cols - s > 0) cellCtx.drawImage(cellCanvas, 0, 0, cols - s, rows, s, 0, cols - s, rows);
    }
  };

  // Main loop
  let raf = 0;
  let lastStep = performance.now();
  let lastFrame = performance.now();
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (reduced) return;

    if (clientX >= 0 && clientY >= 0) {
      inside = clientX >= wrapBounds.left && clientX <= wrapBounds.right && clientY <= wrapBounds.bottom && clientY >= wrapBounds.top;
      px = clientX - wrapBounds.left; py = clientY - wrapBounds.top;
    }

    // Per-frame camera pan: scaled by real frame time so motion is smooth at any
    // refresh rate, independent of the fixed sim step. Sign-normalized so
    // opposite keys cancel and WASD+arrows don't double-speed. Frame dt is
    // clamped so a long stall (e.g. tab refocus) can't produce a big jump.
    const frameDt = Math.min(MAX_FRAME_DT, now - lastFrame);
    lastFrame = now;
    let panX = 0, panY = 0;
    for (const k of pressedKeys) { const d = PAN_KEYS[k]; panX += d[0]; panY += d[1]; }
    if (panX || panY) {
      const dist = PAN_CELLS_PER_SEC * (frameDt / 1000);
      camera.panBy(Math.sign(panX) * dist, Math.sign(panY) * dist);
      previewDirty = previewVisible; // re-place any draft overlay at the new offset
    }

    // Fixed-timestep simulation: world-shift + drafts + emit + engine.step run
    // at STEP_MS for determinism, independent of the per-frame pan above.
    let stepped = false;
    if (now - lastStep >= STEP_MS && !testPaused) {
      // Stream the infinite world: when the camera nears a horizontal buffer
      // edge, slide the loaded window and pull the camera back so the view is
      // unchanged but there's room to keep panning. Fresh terrain is generated
      // (or, in a later phase, restored) on the newly exposed side.
      const maxCamX = cols - viewCols;
      if (camera.colX >= maxCamX - SHIFT_EDGE_MARGIN) {
        engine.shiftWorld(SHIFT_COLS);
        shiftCellCanvas(SHIFT_COLS); // cheap GPU slide; new band repaints from dirty chunks
        camera.set(camera.x - SHIFT_COLS, camera.y);
      } else if (camera.colX <= SHIFT_EDGE_MARGIN) {
        engine.shiftWorld(-SHIFT_COLS);
        shiftCellCanvas(-SHIFT_COLS);
        camera.set(camera.x + SHIFT_COLS, camera.y);
      }

      if (isDraftingStone && inside) {
        if (engine.addDiscToStoneDraft(toCellX(), toCellY(), draftIsDriftwood ? DRIFTWOOD_BRUSH_RADIUS : STONE_BRUSH_RADIUS)) previewDirty = true;
      }
      if (isDraftingIce && inside) {
        if (engine.addDiscToIceDraft(toCellX(), toCellY(), ICE_BRUSH_RADIUS)) previewDirty = true;
      }
      if (isDraftingSeed && inside) {
        updateSeedDraft();
      }

      emitAtPointer(now);
      stepped = engine.step(now);
      if (stepped) {
        perfStepSamples[perfSampleIdx] = engine.getPerf().stepMs;
        perfRenderSamples[perfSampleIdx] = perfRenderMs;
        perfSampleIdx = (perfSampleIdx + 1) % PERF_SAMPLES;
        if (perfSampleCount < PERF_SAMPLES) perfSampleCount++;
      }
      lastStep = now;
    }

    // Present every frame the camera moved or the sim changed. A camera-only
    // frame is a cheap GPU blit (render() does no CPU pixel work when content
    // is unchanged), so this is safe to run at the display refresh rate.
    const camMoved = camera.x !== lastCamX || camera.y !== lastCamY;
    if (stepped || camMoved) render(false);
    if (previewDirty || previewVisible) renderPreview();
  };
  raf = requestAnimationFrame(loop);

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    mqDpr?.removeEventListener?.('change', onDprChange);
    if (engine && engine.destroy) engine.destroy();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    if (mqReduced && onReducedChange) {
      mqReduced.removeEventListener?.('change', onReducedChange);
      mqReduced.removeListener?.(onReducedChange);
    }
    canvas.remove();
    previewCanvas.remove();
  };

  return {
    setTool(id) { currentTool = id; },
    setDrawMode(on) { drawModeOn = !!on; },
    getDrawMode() { return drawModeOn; },
    destroy,
  };
}
