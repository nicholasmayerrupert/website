import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createEngine, MAT, CHUNK_SIZE, SEED_SIZE } from './sand/engine';
import { makeColorLUT, makeTexture, fillPixelSpan } from './sand/renderCore';
import { getScene } from './sand/scenes';
import { createCamera } from './sand/camera';

/* -------------------- SAND OVERLAY -------------------- */
function SandOverlay({ onDrawModeChange }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const uiRef = useRef(null);

  // UI state
  const [selectedTool, setSelectedTool] = useState('cube'); // 'sand' | 'water' | 'stone' | 'oil' | 'fire' | 'seed' | 'driftwood' | 'acid' | 'lava' | 'ice' | 'cube' | 'eraser'
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
  const [emittersOn, setEmittersOn] = useState(true);
  const [sinksOn, setSinksOn] = useState(true);
  const [uiAtBottom, setUiAtBottom] = useState(false); // auto-place toolbar when cramped
  const [drawModeOn, setDrawModeOn] = useState(false);

  // Refs read by the simulation loop
  const toolRef = useRef('sand');
  const emittersOnRef = useRef(true);
  const sinksOnRef = useRef(true);
  const drawModeOnRef = useRef(false);
  const overrideToolRef = useRef(null); // 'eraser' while RMB held

  useEffect(() => { toolRef.current = selectedTool; }, [selectedTool]);
  useEffect(() => { emittersOnRef.current = emittersOn; }, [emittersOn]);
  useEffect(() => { sinksOnRef.current = sinksOn; }, [sinksOn]);
  useEffect(() => {
    drawModeOnRef.current = drawModeOn;
    onDrawModeChange?.(drawModeOn);
  }, [drawModeOn, onDrawModeChange]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const shouldDefaultToScroll = window.matchMedia('(pointer: coarse)').matches;
    if (shouldDefaultToScroll) {
      drawModeOnRef.current = false;
      setDrawModeOn(false);
    }
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    if (!wrap || !canvas || !previewCanvas) return;

    const cellCanvas = document.createElement('canvas');
    const cellCtx = cellCanvas.getContext('2d', { alpha: true });
    const ctx = canvas.getContext('2d', { alpha: true });
    const previewCtx = previewCanvas.getContext('2d', { alpha: true });
    if (!ctx || !cellCtx || !previewCtx) return;

    // Pick the initial world. Defaults to the procedural landscape; `?scene=castle`
    // (or any registered key) overrides without rebuilding the UI.
    const sceneKey =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('scene')
        : null;
    const selectedScene = getScene(sceneKey);

    // ---- Tunables (render/UI side; physics tunables live in src/sand/engine.js) ----
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
    const DRIFTWOOD_BRUSH_RADIUS = 2;
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
    const BUF_MARGIN_COLS = 64;      // extra buffer columns on each side of the view
    const BUFFER_MAX_CELLS = 480000; // cap so the per-step budget stays bounded
    const PAN_CELLS_PER_STEP = 2.5;  // camera pan speed while a key is held

    // Colors
    const STONE_PREVIEW_COLOR = 'rgba(160,160,170,0.40)';
    const ICE_PREVIEW_COLOR = 'rgba(150, 225, 240, 0.40)';
    const SEED_PREVIEW_COLOR = 'rgba(120, 190, 100, 0.32)';
    const colorLUT = makeColorLUT();
    const colorTexture = makeTexture(colorLUT);

    // 1px transparent grid lines between cells, erased in a single
    // destination-out fill instead of one clearRect per row/column line.
    // Rebuilt on fit() because cellSize can grow on large viewports.
    let gutterPattern = null;
    const buildGutterPattern = (size) => {
      const tile = document.createElement('canvas');
      tile.width = size;
      tile.height = size;
      const tileCtx = tile.getContext('2d');
      tileCtx.fillStyle = '#000';
      tileCtx.fillRect(size - 1, 0, 1, size);
      tileCtx.fillRect(0, size - 1, size, 1);
      gutterPattern = ctx.createPattern(tile, 'repeat');
    };

    // Simulation engine (recreated on resize)
    // cols/rows are the BUFFER (world) dimensions, larger than the viewport;
    // viewCols/viewRows are the visible cell window the camera shows.
    let engine = null;
    let cols = 0, rows = 0, cellSize = CELL_PX;
    let viewCols = 0, viewRows = 0;
    const camera = createCamera();
    let lastCamCol = -1, lastCamRow = -1; // detect camera movement to force a redraw
    const pressedKeys = new Set();         // held WASD/arrow keys for panning
    let viewWidth = 0, viewHeight = 0;
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
    let seedDraftOrigin = null;

    // Pointer tracking
    let clientX = -1, clientY = -1;
    let px = -1, py = -1;
    let inside = false;
    let lmbDown = false;

    // Reduced motion
    let reduced = false;
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      reduced = mq.matches;
      const onChange = () => (reduced = mq.matches);
      mq.addEventListener?.('change', onChange);
      mq.addListener?.(onChange);
    }

    const refreshBounds = () => {
      const rect = wrap.getBoundingClientRect();
      viewWidth = rect.width;
      viewHeight = rect.height;
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
      canvas.width = Math.max(300, Math.floor(width));
      canvas.height = Math.max(200, Math.floor(height));
      previewCanvas.width = canvas.width;
      previewCanvas.height = canvas.height;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      previewCanvas.style.width = '100%';
      previewCanvas.style.height = '100%';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      previewCtx.setTransform(1, 0, 0, 1, 0, 0);
      // Decide UI placement based on available horizontal space
      setUiAtBottom(width < TOOL_COLLAPSE_W);

      cellSize = CELL_PX;
      while (
        Math.ceil(width / cellSize) * Math.ceil(height / cellSize) > MAX_CELLS
      ) {
        cellSize++;
      }
      // Visible window (cells on screen) vs. the larger simulation buffer.
      viewCols = Math.max(60, Math.ceil(width / cellSize));
      viewRows = Math.max(28, Math.ceil(height / cellSize));
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
      cols = bufCols;
      rows = worldRows;

      buildGutterPattern(cellSize);
      cellCanvas.width = cols;
      cellCanvas.height = rows;
      cellCtx.imageSmoothingEnabled = false;
      ctx.imageSmoothingEnabled = false;
      previewCtx.imageSmoothingEnabled = false;
      imageData = cellCtx.createImageData(cols, rows);
      pixels = new Uint32Array(imageData.data.buffer);

      engine = createEngine({
        cols,
        rows,
        initialScene: selectedScene.build,
        emitters: selectedScene.emitters,
        emittersOn: emittersOnRef.current,
        sinksOn: sinksOnRef.current,
      });
      // Camera spans the buffer minus the visible window; start centered.
      camera.setBounds(cols - viewCols, rows - viewRows);
      camera.center();
      lastCamCol = -1;
      lastCamRow = -1;
      isDraftingStone = false;
      isDraftingSeed = false;
      isDraftingIce = false;
      seedDraftOrigin = null;

      pixels.fill(0);
      forceFullRender = true;
      ctx.clearRect(0, 0, width, height);
      previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      previewDirty = false;
      previewVisible = false;
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);

    // Pointer helpers
    const updatePointer = (cx, cy) => {
      clientX = cx; clientY = cy;
      inside = cx >= wrapBounds.left && cx <= wrapBounds.right && cy >= wrapBounds.top && cy <= wrapBounds.bottom;
      px = cx - wrapBounds.left;
      py = cy - wrapBounds.top;
    };
    // Screen pixel (canvas-relative) -> buffer cell, through the camera offset.
    const toCellX = () => camera.colX + Math.floor(px / cellSize);
    const toCellY = () => camera.colY + Math.floor(py / cellSize);
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
        overrideToolRef.current = null;
        lmbDown = false;
      }
      if (!drawModeOnRef.current) return;
      if (isDraftingStone && inside) {
        if (engine.addDiscToStoneDraft(toCellX(), toCellY(), STONE_BRUSH_RADIUS)) previewDirty = true;
      }
      if (isDraftingIce && inside) {
        if (engine.addDiscToIceDraft(toCellX(), toCellY(), ICE_BRUSH_RADIUS)) previewDirty = true;
      }
      if (isDraftingSeed && inside) {
        updateSeedDraft();
      }
    };
    const onTouchMove = (e) => {
      if (!drawModeOnRef.current) return;
      if (!e.touches || e.touches.length === 0) return;
      const t = e.touches[0];
      updatePointer(t.clientX, t.clientY);
      if (isDraftingStone && inside) {
        if (engine.addDiscToStoneDraft(toCellX(), toCellY(), STONE_BRUSH_RADIUS)) previewDirty = true;
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
      if (!drawModeOnRef.current) return;
      updatePointer(e.clientX, e.clientY);
      const overUI = uiRef.current && uiRef.current.contains(e.target);
      if (!inside || overUI) return;

      if (e.button === 0) {
        lmbDown = true;
        const rmbHeld = overrideToolRef.current === 'eraser';
        const activeTool = rmbHeld ? 'eraser' : toolRef.current;

        if (activeTool === 'stone') {
          isDraftingStone = true;
          if (engine.addDiscToStoneDraft(toCellX(), toCellY(), STONE_BRUSH_RADIUS)) previewDirty = true;
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
        overrideToolRef.current = 'eraser'; // momentary while RMB held
        e.preventDefault();
      }
    };

    const onPointerUp = (e) => {
      if (e.button === 2 || e.buttons === 0) {
        overrideToolRef.current = null;
      }
      if (e.button === 0) {
        lmbDown = false;
        if (isDraftingStone) {
          engine.finalizeStoneDraft();
          isDraftingStone = false;
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
      const overUI = uiRef.current && uiRef.current.contains(e.target);
      if (drawModeOnRef.current && inside && !overUI) e.preventDefault();
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
    // button (e.g. the tap/sink toggles) keeps focus after a click, so treating
    // every <input> as editable would silently disable camera panning.
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
      if (e.repeat) return;
      if (key === 'e') {
        setEmittersOn(v => { emittersOnRef.current = !v; return !v; });
      }
      // Sinks toggle now lives on the toolbar only — 's' pans the camera down.
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

      const rmbHeld = overrideToolRef.current === 'eraser';
      const activeTool = rmbHeld ? 'eraser' : toolRef.current;

      // Stone and ice: handled by draft logic, not here
      if (activeTool === 'stone' || activeTool === 'ice') return;
      if (!drawModeOnRef.current) return;

      // Paint only while LMB is down (or RMB for eraser)
      const shouldEmit =
        rmbHeld ? true :
        activeTool === 'eraser' ? lmbDown :
        (activeTool === 'sand' || activeTool === 'water' || activeTool === 'oil' || activeTool === 'fire' ||
         activeTool === 'acid' || activeTool === 'lava' || activeTool === 'driftwood') ? lmbDown : false;

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
      if (activeTool === 'driftwood') {
        // Rigid wood-like component: paint then adopt the cells into a component
        // so they obey physics and stop flickering (see feed.js placeMaterial).
        engine.paintDisc(cx, cy, DRIFTWOOD_BRUSH_RADIUS, MAT.DRIFTWOOD, false);
        engine.syncComponents();
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
      // maps to canvas pixels ((bx-camCol)*cellSize, (by-camRow)*cellSize).
      const camCol = camera.colX;
      const camRow = camera.colY;
      const visX0 = camCol;
      const visY0 = camRow;
      const visX1 = Math.min(cols - 1, camCol + viewCols);
      const visY1 = Math.min(rows - 1, camRow + viewRows);

      const clearCellGutters = (x0, y0, x1, y1) => {
        const destX = (x0 - camCol) * cellSize;
        const destY = (y0 - camRow) * cellSize;
        const destW = (x1 - x0 + 1) * cellSize;
        const destH = (y1 - y0 + 1) * cellSize;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = gutterPattern;
        ctx.fillRect(destX, destY, destW, destH);
        ctx.globalCompositeOperation = 'source-over';
      };
      // Paint one buffer-cell rect to the canvas at the camera-relative position.
      const blit = (x0, y0, x1, y1) => {
        const w = x1 - x0 + 1;
        const h = y1 - y0 + 1;
        fillPixelSpan(pixels, grid, cols, x0, y0, x1, y1, colorLUT, colorTexture);
        cellCtx.putImageData(imageData, 0, 0, x0, y0, w, h);
        const destX = (x0 - camCol) * cellSize;
        const destY = (y0 - camRow) * cellSize;
        ctx.clearRect(destX, destY, w * cellSize, h * cellSize);
        ctx.drawImage(cellCanvas, x0, y0, w, h, destX, destY, w * cellSize, h * cellSize);
        clearCellGutters(x0, y0, x1, y1);
      };

      // Panning shifts everything on screen, so a moved camera forces a full
      // (visible-window) redraw rather than relying on per-cell dirty chunks.
      const camMoved = camCol !== lastCamCol || camRow !== lastCamRow;
      const shouldFullRender =
        full ||
        forceFullRender ||
        camMoved ||
        dirtyRenderCount > dirtyRender.length * FULL_RENDER_DIRTY_CHUNK_RATIO;
      if (shouldFullRender) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (visX1 >= visX0 && visY1 >= visY0) blit(visX0, visY0, visX1, visY1);
        forceFullRender = false;
      } else {
        for (let cy = 0; cy < chunkRows; cy++) {
          const cy0 = cy * CHUNK_SIZE;
          if (cy0 > visY1) break;
          const cy1 = Math.min(rows - 1, cy0 + CHUNK_SIZE - 1);
          if (cy1 < visY0) continue;
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
            // Clip the dirty span to the visible window, then draw only that.
            const dx0 = Math.max(cx0, visX0);
            const dx1 = Math.min(cx1, visX1);
            const dy0 = Math.max(cy0, visY0);
            const dy1 = Math.min(cy1, visY1);
            if (dx1 >= dx0 && dy1 >= dy0) blit(dx0, dy0, dx1, dy1);
            cx++;
          }
        }
      }
      lastCamCol = camCol;
      lastCamRow = camRow;
      engine.clearRenderDirty();
      perfRenderMs = performance.now() - renderStart;
    };

    const renderPreview = () => {
      if (!engine || !previewDirty) return;
      previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      previewVisible = false;

      const stoneDraft = engine.getStoneDraftCells();
      if (stoneDraft.size > 0) {
        previewCtx.fillStyle = STONE_PREVIEW_COLOR;
        const previewSize = cellSize;
        for (const k of stoneDraft) {
          const y = (k / cols) | 0;
          const x = k - y * cols;
          previewCtx.fillRect((x - camera.colX) * cellSize, (y - camera.colY) * cellSize, previewSize, previewSize);
        }
        previewVisible = true;
      }

      const iceDraft = engine.getIceDraftCells();
      if (iceDraft.size > 0) {
        previewCtx.fillStyle = ICE_PREVIEW_COLOR;
        const previewSize = cellSize;
        for (const k of iceDraft) {
          const y = (k / cols) | 0;
          const x = k - y * cols;
          previewCtx.fillRect((x - camera.colX) * cellSize, (y - camera.colY) * cellSize, previewSize, previewSize);
        }
        previewVisible = true;
      }

      if (isDraftingSeed && seedDraftOrigin) {
        const [x0, y0] = seedDraftOrigin;
        const valid = engine.canPlaceSeedAt(x0, y0);
        previewCtx.fillStyle = valid ? SEED_PREVIEW_COLOR : 'rgba(255, 80, 80, 0.24)';
        const previewSize = cellSize;
        for (let y = y0; y < y0 + SEED_SIZE; y++) {
          for (let x = x0; x < x0 + SEED_SIZE; x++) {
            previewCtx.fillRect((x - camera.colX) * cellSize, (y - camera.colY) * cellSize, previewSize, previewSize);
          }
        }
        previewVisible = true;
      }
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
    }

    // Main loop
    let raf = 0;
    let lastStep = performance.now();
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (reduced) return;

      if (clientX >= 0 && clientY >= 0) {
        inside = clientX >= wrapBounds.left && clientX <= wrapBounds.right && clientY <= wrapBounds.bottom && clientY >= wrapBounds.top;
        px = clientX - wrapBounds.left; py = clientY - wrapBounds.top;
      }

      if (now - lastStep >= STEP_MS) {
        // Pan the camera from held keys (sign-normalized so opposite keys cancel
        // and WASD+arrows don't double-speed).
        let panX = 0, panY = 0;
        for (const k of pressedKeys) { const d = PAN_KEYS[k]; panX += d[0]; panY += d[1]; }
        if (panX || panY) {
          camera.panBy(Math.sign(panX) * PAN_CELLS_PER_STEP, Math.sign(panY) * PAN_CELLS_PER_STEP);
          previewDirty = previewVisible; // re-place any draft overlay at the new offset
        }

        if (isDraftingStone && inside) {
          if (engine.addDiscToStoneDraft(toCellX(), toCellY(), STONE_BRUSH_RADIUS)) previewDirty = true;
        }
        if (isDraftingIce && inside) {
          if (engine.addDiscToIceDraft(toCellX(), toCellY(), ICE_BRUSH_RADIUS)) previewDirty = true;
        }
        if (isDraftingSeed && inside) {
          updateSeedDraft();
        }

        emitAtPointer(now);
        engine.setEmittersOn(emittersOnRef.current);
        engine.setSinksOn(sinksOnRef.current);
        const didStep = engine.step(now);
        const camMoved = camera.colX !== lastCamCol || camera.colY !== lastCamRow;
        if (didStep || camMoved) render(false);
        if (previewDirty || previewVisible) renderPreview();
        if (didStep) {
          perfStepSamples[perfSampleIdx] = engine.getPerf().stepMs;
          perfRenderSamples[perfSampleIdx] = perfRenderMs;
          perfSampleIdx = (perfSampleIdx + 1) % PERF_SAMPLES;
          if (perfSampleCount < PERF_SAMPLES) perfSampleCount++;
        }
        lastStep = now;
      }
    };
    raf = requestAnimationFrame(loop);

    // Cleanup
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []); // IMPORTANT: single mount
  const toolButtons = [
    {
      id: 'cube',
      title: 'Cube (click to drop a tumbling rigid body)',
      activeClass: 'bg-stone-600/50 ring-stone-300/35 text-stone-100',
      idleClass: 'text-stone-400/85 bg-stone-400/10',
    },
    {
      id: 'sand',
      title: 'Sand (hold LMB)',
      activeClass: 'bg-yellow-600/50 ring-yellow-300/35 text-yellow-200',
      idleClass: 'text-yellow-400/75 bg-yellow-400/10',
    },
    {
      id: 'water',
      title: 'Water (hold LMB)',
      activeClass: 'bg-blue-600/50 ring-blue-300/35 text-blue-100',
      idleClass: 'text-blue-400/75 bg-blue-400/10',
    },
    {
      id: 'oil',
      title: 'Oil (hold LMB)',
      activeClass: 'bg-amber-900/60 ring-amber-300/35 text-amber-200',
      idleClass: 'text-amber-900/85 bg-amber-900/10',
    },
    {
      id: 'fire',
      title: 'Fire (hold LMB)',
      activeClass: 'bg-orange-600/55 ring-orange-200/35 text-orange-100',
      idleClass: 'text-orange-400/80 bg-orange-400/10',
    },
    {
      id: 'stone',
      title: 'Stone (hold to draft, release to drop)',
      activeClass: 'bg-gray-600/50 ring-white/25 text-gray-100',
      idleClass: 'text-gray-400/85 bg-gray-400/10',
    },
    {
      id: 'seed',
      title: 'Seed (hold to place, release to drop)',
      activeClass: 'bg-green-700/50 ring-green-200/35 text-green-100',
      idleClass: 'text-green-400/80 bg-green-400/10',
    },
    {
      id: 'driftwood',
      title: 'Driftwood (hold LMB) — wood-like, does not grow',
      activeClass: 'bg-stone-600/50 ring-stone-300/35 text-stone-100',
      idleClass: 'text-stone-400/80 bg-stone-400/10',
    },
    {
      id: 'acid',
      title: 'Acid (hold LMB)',
      activeClass: 'bg-lime-600/50 ring-lime-300/35 text-lime-100',
      idleClass: 'text-lime-400/80 bg-lime-400/10',
    },
    {
      id: 'lava',
      title: 'Lava (hold LMB)',
      activeClass: 'bg-red-700/55 ring-orange-300/35 text-orange-100',
      idleClass: 'text-red-400/80 bg-red-500/10',
    },
    {
      id: 'ice',
      title: 'Ice (hold to draft, release to drop)',
      activeClass: 'bg-cyan-600/50 ring-cyan-200/35 text-cyan-50',
      idleClass: 'text-cyan-300/80 bg-cyan-400/10',
    },
    {
      id: 'eraser',
      title: 'Eraser (hold LMB, or hold RMB anytime)',
      activeClass: 'bg-rose-600/50 ring-rose-200/35 text-rose-100',
      idleClass: 'text-rose-300/80 bg-rose-400/10',
    },
  ];

  const selectedToolButton = toolButtons.find(({ id }) => id === selectedTool) ?? toolButtons[0];
  const toolLabel = (id) => id.charAt(0).toUpperCase() + id.slice(1);

  const renderToolMark = (id) => {
    switch (id) {
      case 'sand':
        return (
          <div className="relative h-6 w-7" aria-hidden="true">
            <span className="absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full bg-yellow-200/90" />
            <span className="absolute bottom-1 left-3 h-1.5 w-1.5 rounded-full bg-amber-300/90" />
            <span className="absolute bottom-1 left-5 h-1.5 w-1.5 rounded-full bg-yellow-300/80" />
            <span className="absolute bottom-[7px] left-2 h-1.5 w-1.5 rounded-full bg-yellow-300/90" />
            <span className="absolute bottom-[7px] left-4 h-1.5 w-1.5 rounded-full bg-amber-200/85" />
            <span className="absolute bottom-[13px] left-3 h-1.5 w-1.5 rounded-full bg-yellow-100/90" />
            <span className="absolute bottom-0 left-0 h-[2px] w-7 rounded-full bg-yellow-700/45" />
          </div>
        );
      case 'water':
        return (
          <div
            className="h-6 w-5 rounded-[60%_60%_70%_70%] bg-blue-400/80 shadow-[inset_3px_4px_0_rgba(255,255,255,0.25),0_0_8px_rgba(96,165,250,0.35)] rotate-45"
            aria-hidden="true"
          />
        );
      case 'oil':
        return (
          <div
            className="h-6 w-5 rounded-[60%_60%_70%_70%] bg-amber-950/90 ring-1 ring-amber-700/40 shadow-[inset_3px_4px_0_rgba(245,158,11,0.22),0_0_7px_rgba(120,53,15,0.35)] rotate-45"
            aria-hidden="true"
          />
        );
      case 'fire':
        return (
          <div className="relative h-7 w-5" aria-hidden="true">
            <span className="absolute bottom-0 left-1 h-5 w-4 rounded-[70%_30%_70%_40%] bg-orange-500/90 rotate-45 shadow-[0_0_9px_rgba(251,146,60,0.45)]" />
            <span className="absolute bottom-2 left-[7px] h-4 w-3 rounded-[70%_30%_70%_40%] bg-yellow-300/90 rotate-45" />
            <span className="absolute bottom-4 left-[4px] h-3 w-2.5 rounded-[70%_30%_70%_40%] bg-red-500/75 rotate-45" />
          </div>
        );
      case 'stone':
        return (
          <div className="relative h-6 w-6" aria-hidden="true">
            <span className="absolute bottom-1 left-1 h-4 w-5 rounded-[4px] bg-gray-400/85 shadow-[inset_2px_2px_0_rgba(255,255,255,0.18)] rotate-[-8deg]" />
            <span className="absolute bottom-[5px] left-[9px] h-[3px] w-[3px] rounded-full bg-gray-700/35" />
            <span className="absolute bottom-[11px] left-[5px] h-[2px] w-[6px] rounded-full bg-gray-100/25" />
          </div>
        );
      case 'seed':
        return (
          <div className="relative h-6 w-6" aria-hidden="true">
            <span className="absolute bottom-1 left-2 h-3 w-4 rounded-[55%_45%_55%_45%] bg-amber-900/85 rotate-[-20deg] shadow-[inset_2px_2px_0_rgba(255,255,255,0.16)]" />
            <span className="absolute bottom-3 left-3 h-3 w-2 rounded-full bg-green-400/80 rotate-45" />
            <span className="absolute bottom-[15px] left-[9px] h-2 w-1.5 rounded-full bg-lime-300/75 rotate-[-35deg]" />
          </div>
        );
      case 'driftwood':
        return (
          <div className="relative h-6 w-6" aria-hidden="true">
            <span className="absolute bottom-2 left-0 h-2 w-6 rounded-[3px] bg-stone-500/85 rotate-[-10deg] shadow-[inset_2px_2px_0_rgba(255,255,255,0.18)]" />
            <span className="absolute bottom-[11px] left-1 h-[2px] w-4 rounded-full bg-stone-300/35 rotate-[-10deg]" />
            <span className="absolute bottom-[7px] left-2 h-[2px] w-3 rounded-full bg-stone-800/35 rotate-[-10deg]" />
          </div>
        );
      case 'acid':
        return (
          <div
            className="h-6 w-5 rounded-[60%_60%_70%_70%] bg-lime-400/85 ring-1 ring-lime-300/40 shadow-[inset_3px_4px_0_rgba(255,255,255,0.28),0_0_8px_rgba(132,204,22,0.45)] rotate-45"
            aria-hidden="true"
          />
        );
      case 'lava':
        return (
          <div className="relative h-7 w-5" aria-hidden="true">
            <span className="absolute bottom-0 left-1 h-5 w-4 rounded-[70%_30%_70%_40%] bg-red-600/90 rotate-45 shadow-[0_0_9px_rgba(239,68,68,0.5)]" />
            <span className="absolute bottom-2 left-[7px] h-4 w-3 rounded-[70%_30%_70%_40%] bg-orange-400/90 rotate-45" />
            <span className="absolute bottom-3 left-[5px] h-2.5 w-2 rounded-[70%_30%_70%_40%] bg-yellow-300/80 rotate-45" />
          </div>
        );
      case 'ice':
        return (
          <div className="relative h-6 w-6" aria-hidden="true">
            <span className="absolute bottom-1 left-1 h-4 w-4 rounded-[4px] bg-cyan-200/85 rotate-[12deg] shadow-[inset_2px_2px_0_rgba(255,255,255,0.4),0_0_7px_rgba(103,232,249,0.4)]" />
            <span className="absolute bottom-[7px] left-[6px] h-[2px] w-[7px] rounded-full bg-white/55 rotate-[12deg]" />
            <span className="absolute bottom-[11px] left-[8px] h-[6px] w-[2px] rounded-full bg-white/45 rotate-[12deg]" />
          </div>
        );
      case 'cube':
        return (
          <div className="relative h-6 w-6" aria-hidden="true">
            <span className="absolute bottom-1 left-1 h-4 w-4 rounded-[3px] bg-stone-300/85 rotate-[18deg] shadow-[inset_2px_2px_0_rgba(255,255,255,0.28),0_0_6px_rgba(168,162,158,0.35)]" />
            <span className="absolute bottom-[10px] left-[7px] h-[2px] w-[7px] rounded-full bg-white/30 rotate-[18deg]" />
          </div>
        );
      case 'eraser':
        return (
          <div className="relative h-6 w-6" aria-hidden="true">
            <span className="absolute bottom-2 left-1 h-3.5 w-5 rounded-[4px] bg-rose-200/90 rotate-[-28deg] shadow-[inset_2px_2px_0_rgba(255,255,255,0.35)]" />
            <span className="absolute bottom-[10px] left-[13px] h-3.5 w-[2px] rounded-full bg-rose-500/45 rotate-[-28deg]" />
            <span className="absolute bottom-1 left-1 h-[2px] w-5 rounded-full bg-white/35" />
          </div>
        );
      default:
        return null;
    }
  };

  // IMPORTANT: make UI a sibling of the canvas wrapper so it can sit ABOVE page content.
return (
  <>
    {/* Simulation layer — sits BEHIND page content so the code stays readable */}
    <div ref={wrapRef} className="absolute inset-0 z-0 pointer-events-none">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        aria-hidden="true"
      />
      <canvas
        ref={previewCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        aria-hidden="true"
      />
    </div>

    {/* UI layer — sits ABOVE page content, scoped to the section bounds */}
    <div className="absolute inset-0 z-[60] pointer-events-none">
    {/* Tool + toggles (adaptive placement) — high z-index and clickable */}
    <div
      ref={uiRef}
      className={`absolute ${
        uiAtBottom
          ? 'bottom-3 left-1/2 -translate-x-1/2'
          : 'left-4 top-1/2 -translate-y-1/2'
      } z-[70] bg-gray-900/30 rounded-lg p-2 backdrop-blur-sm shadow-lg pointer-events-auto max-w-[calc(100vw-1.5rem)]`}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className={`flex ${uiAtBottom ? 'flex-col items-stretch' : 'flex-col'} gap-2`}>
        <div className={`relative ${drawModeOn ? '' : 'opacity-45'}`}>
          <button
            type="button"
            onClick={() => setToolPickerOpen(v => !v)}
            className={`w-48 max-w-[calc(100vw-2.5rem)] rounded-md p-2 text-left transition ring-1 ${
              drawModeOn ? 'bg-gray-800/70 hover:bg-gray-800/85 ring-white/15' : 'bg-gray-800/45 ring-white/10'
            }`}
            title={selectedToolButton.title}
            aria-haspopup="listbox"
            aria-expanded={toolPickerOpen}
          >
            <span className="block text-[10px] uppercase tracking-wide text-gray-300">
              Currently selected material
            </span>
            <span className="mt-1 flex items-center gap-2 text-sm font-semibold text-white">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ring-1 ${selectedToolButton.activeClass}`}>
                {renderToolMark(selectedTool)}
              </span>
              {toolLabel(selectedTool)}
              <span className="ml-auto text-gray-300" aria-hidden="true">v</span>
            </span>
          </button>

          {toolPickerOpen && (
            <div
              className={`absolute z-[80] w-48 max-w-[calc(100vw-2.5rem)] rounded-md bg-gray-950/95 p-1 shadow-xl ring-1 ring-white/15 backdrop-blur-sm ${
                uiAtBottom ? 'bottom-full mb-2 left-0' : 'left-0 top-full mt-2'
              }`}
              role="listbox"
              aria-label="Select material"
            >
              {toolButtons.map(({ id, title, activeClass, idleClass }) => {
                const active = selectedTool === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setSelectedTool(id);
                      setToolPickerOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition ${
                      active
                        ? 'bg-white/15 text-white'
                        : 'text-gray-200 hover:bg-white/10'
                    }`}
                    title={title}
                    role="option"
                    aria-selected={active}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ring-1 ${
                      active ? activeClass : `ring-white/10 ${idleClass}`
                    }`}>
                      {renderToolMark(id)}
                    </span>
                    <span>{toolLabel(id)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Toggles */}
        <div className={`flex ${uiAtBottom ? 'flex-row justify-center' : 'flex-col'} gap-2 ${uiAtBottom ? 'w-full' : ''}`}>
          <label className={`flex items-center gap-2 text-xs text-gray-200 ${uiAtBottom ? '' : 'mt-1'}`}>
            <input
              type="checkbox"
              className="accent-yellow-400"
              checked={emittersOn}
              onChange={() => setEmittersOn(v => !v)}
            />
            Taps
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-200">
            <input
              type="checkbox"
              className="accent-blue-400"
              checked={sinksOn}
              onChange={() => setSinksOn(v => !v)}
            />
            Sinks
          </label>
        </div>

        <button
          type="button"
          onClick={() => setDrawModeOn(v => !v)}
          className={`rounded-md px-2 py-1 text-[10px] font-semibold transition ${
            drawModeOn
              ? 'bg-white/80 text-black hover:bg-white'
              : 'bg-white/10 text-white hover:bg-white/20'
          }`}
          title={drawModeOn ? 'Disable drawing so the page scrolls normally' : 'Enable drawing in the physics simulation'}
          aria-pressed={drawModeOn}
        >
          Draw {drawModeOn ? 'On' : 'Off'}
        </button>

      </div>
    </div>
    </div>
  </>
);



}

/* -------------------- PAGE -------------------- */
export default function About() {
  const [drawModeActive, setDrawModeActive] = useState(false);

  return (
    <section className="relative bg-dark">
      {/* Content */}
      <div className="relative z-[1] mx-auto max-w-6xl px-4 sm:px-6 pt-12 sm:pt-6 pb-48">
        <h2 className="text-white font-bold tracking-tight text-center text-3xl sm:text-5xl md:text-6xl">
          SKILLS & <br className="hidden sm:block" /> EXPERIENCE
        </h2>

        {/* Cards: stacked on mobile, side-by-side on md+; equal height & width */}
        <div
          className={`mt-6 md:mt-16 transition duration-300 ${
            drawModeActive ? 'opacity-0 pointer-events-none select-none' : 'opacity-100'
          }`}
          aria-hidden={drawModeActive}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 items-stretch">
            {/* Experience (LHS) */}
            <div className="w-full h-full bg-gray-900/90 rounded-xl p-4 sm:p-5 shadow-lg ring-1 ring-white/15 overflow-hidden min-h-[360px] flex">
              <pre className="font-mono text-xs sm:text-sm leading-6 text-left text-white whitespace-pre-wrap break-words [word-break:break-word] grow">
                <code>
                  <span className="text-blue-400">// Internship experience</span>{'\n'}
                  <span className="text-red-500">const</span> <span className="text-purple-300">connectionLab</span> {'= {'}{'\n'}
                  {'    '}<span className="text-yellow-500">role</span>{": '"}<span className="text-green-500">Full-Stack Developer Intern</span>{"',"}{'\n'}
                  {'    '}<span className="text-yellow-500">stack</span>{': {'}{'\n'}
                  {'        '}<span className="text-yellow-500">frontend</span>{": ['"}<span className="text-green-500">JavaScript</span>{"', '"}<span className="text-green-500">Handlebars</span>{"'],"}{'\n'}
                  {'        '}<span className="text-yellow-500">backend</span>{": ['"}<span className="text-green-500">Node.js</span>{"'],"}{'\n'}
                  {'        '}<span className="text-yellow-500">database</span>{": ['"}<span className="text-green-500">SQL</span>{"']"}{'\n'}
                  {'    '}{'},'}{'\n'}
                  {'    '}<span className="text-yellow-500">contributions</span>{": ["}{'\n'}
                  {'        '}{"\""}<span className="text-green-500">Built a production website end-to-end (frontend & backend)</span>{"\","}{'\n'}
                  {'        '}{"\""}<span className="text-green-500">Designed REST APIs and integrated client-side views</span>{"\","}{'\n'}
                  {'        '}{"\""}<span className="text-green-500">Managed migrations and optimized queries</span>{"\","}{'\n'}
                  {'        '}{"\""}<span className="text-green-500">Implemented auth, validation, and robust error handling</span>{"\""}{'\n'}
                  {'    '}{"]"}{'\n'}
                  {'}'}{';'}{'\n'}
                </code>
              </pre>
            </div>

            {/* Tech stack (RHS, concise & balanced) */}
            <div className="w-full h-full bg-gray-900/90 rounded-xl p-4 sm:p-5 shadow-lg ring-1 ring-white/15 overflow-hidden min-h-[360px] flex">
              <pre className="font-mono text-xs sm:text-sm leading-6 text-left text-white whitespace-pre-wrap break-words [word-break:break-word] grow">
                <code>
                  <span className="text-blue-400">// Languages + back-end profile</span>{'\n'}
                  <span className="text-red-500">const</span> <span className="text-purple-300">techStack</span> {'= {'}{'\n'}
                  {'    '}<span className="text-yellow-500">languages</span>{": ['"}
                  <span className="text-green-500">C++</span>{"', '"}
                  <span className="text-green-500">Python</span>{"', '"}
                  <span className="text-green-500">JavaScript (ES6+)</span>{"', '"}
                  <span className="text-green-500">SQL</span>{"'],"}{'\n'}
                  {'    '}<span className="text-yellow-500">backend</span>{': {'}{'\n'}
                  {'        '}<span className="text-yellow-500">strengths</span>{": ['"}
                  <span className="text-green-500">REST APIs</span>{"', '"}
                  <span className="text-green-500">Auth/sessions</span>{"', '"}
                  <span className="text-green-500">Schema design</span>{"'],"}{'\n'}
                  {'        '}<span className="text-yellow-500">summary</span>{": '"}
                  <span className="text-green-500">Builds secure, documented services.</span>{"'"}{'\n'}
                  {'    '}{'},'}{'\n'}
                  {'    '}<span className="text-yellow-500">databases</span>{": ['"}
                  <span className="text-green-500">PostgreSQL</span>{"', '"}
                  <span className="text-green-500">MySQL</span>{"'],"}{'\n'}
                  {'    '}<span className="text-yellow-500">tools</span>{": ['"}
                  <span className="text-green-500">Git</span>{"', '"}
                  <span className="text-green-500">Node.js</span>{"', '"}
                  <span className="text-green-500">Vite</span>{"']"}{'\n'}
                  {'}'}{';'}{'\n'}
                </code>
              </pre>
            </div>
          </div>
        </div>
      </div>

      {/* Full-section Sand overlay */}
      <SandOverlay onDrawModeChange={setDrawModeActive} />
    </section>
  );
}
