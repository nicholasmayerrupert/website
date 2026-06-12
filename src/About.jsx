import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* -------------------- SAND OVERLAY -------------------- */
function SandOverlay({ onDrawModeChange }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const uiRef = useRef(null);

  // UI state
  const [selectedTool, setSelectedTool] = useState('sand'); // 'sand' | 'water' | 'stone' | 'oil' | 'fire' | 'seed'
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
    if (!wrap || !canvas) return;

    const cellCanvas = document.createElement('canvas');
    const cellCtx = cellCanvas.getContext('2d', { alpha: true });
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx || !cellCtx) return;

    // ---- Tunables ----
    const CELL_PX = 5;
    const SAND_BRUSH_RADIUS = 2;
    const WATER_BRUSH_RADIUS = 2;
    const STONE_BRUSH_RADIUS = 2;
    const OIL_BRUSH_RADIUS = 2;
    const FIRE_BRUSH_RADIUS = 1;
    const ERASE_BRUSH_RADIUS = 3;
    const SEED_SIZE = 2;
    const EMIT_INTERVAL_MS = 18;
    const STEP_MS = 16;
    const MAX_WATER_FLOW = 10;
    const STEAM_DECAY_P = 0.018;
    const FIRE_DECAY_P = 0.006;
    const OIL_IGNITE_P = 0.25;
    const PLANT_IGNITE_P = OIL_IGNITE_P * 0.67;
    const FIRE_SPREAD_P = 0.11;
    const TOOL_COLLAPSE_W = 1300; // px: move toolbar to bottom if wrapper width < this

    // Colors
    const SAND_COLOR = 'rgba(230, 200, 120, 0.475)';
    const WATER_COLOR = 'rgba(120, 170, 255, 0.40)';
    const STONE_COLOR = 'rgba(140, 140, 150, 0.70)';
    const OIL_COLOR = 'rgba(105, 72, 28, 0.55)';
    const FIRE_COLOR = 'rgba(255, 108, 34, 0.72)';
    const FIRE_HOT_COLOR = 'rgba(255, 205, 80, 0.62)';
    const STEAM_COLOR = 'rgba(210, 230, 255, 0.26)';
    const SEED_COLOR = 'rgba(88, 46, 22, 0.78)';
    const WOOD_COLOR = 'rgba(128, 76, 35, 0.76)';
    const PLANT_COLOR = 'rgba(91, 170, 84, 0.64)';
    const STONE_PREVIEW_COLOR = 'rgba(160,160,170,0.40)';
    const SEED_PREVIEW_COLOR = 'rgba(120, 190, 100, 0.32)';

    // Side-sink settings (bottom is NOT a sink)
    const SINK_STRIP_W = 2;
    const INNER_STRIP_W = 1;
    const SINK_WATER_P = 0.85;
    const SINK_OIL_P = 0.85;
    const SINK_SAND_P  = 0.35;
    const INNER_WATER_P = 0.35;
    const INNER_OIL_P = 0.35;
    const INNER_SAND_P  = 0.10;

    // Emitters (normalized positions) + buffers
    const emitterDefs = [
      { type: 'sand',  rateMs: 120, pos: { x: 0.12, y: 0.14 }, r: 2 },
      { type: 'water', rateMs:  90, pos: { x: 0.88, y: 0.14 }, r: 2 },
    ];
    const EMITTER_EDGE_BUFFER = 3; // cells from side
    const EMITTER_TOP_BUFFER  = 3; // cells from top
    const CHUNK_SIZE = 32;
    const DIRTY_PAD_X = MAX_WATER_FLOW + 2;
    const DIRTY_PAD_Y = 2;

    // Materials
    const EMPTY = 0;
    const SAND = 1;
    const WATER = 2;
    const STONE = 3;
    const OIL = 4;
    const FIRE = 5;
    const STEAM = 6;
    const SEED = 7;
    const WOOD = 8;
    const PLANT = 9;

    // Grid
    let cols = 0, rows = 0, cellSize = CELL_PX;
    let viewWidth = 0, viewHeight = 0;
    let wrapBounds = { left: 0, right: 0, top: 0, bottom: 0 };
    let gridA = new Uint8Array(0);
    let gridB = new Uint8Array(0);
    let grid = gridA, next = gridB;
    let imageData = null;
    let pixels = new Uint32Array(0);
    let chunkCols = 0, chunkRows = 0;
    let dirtyCurrent = new Uint8Array(0);
    let dirtyNext = new Uint8Array(0);
    let dirtyRender = new Uint8Array(0);
    let dirtyCurrentMinX = new Int32Array(0);
    let dirtyCurrentMaxX = new Int32Array(0);
    let dirtyCurrentMinY = new Int32Array(0);
    let dirtyCurrentMaxY = new Int32Array(0);
    let dirtyNextMinX = new Int32Array(0);
    let dirtyNextMaxX = new Int32Array(0);
    let dirtyNextMinY = new Int32Array(0);
    let dirtyNextMaxY = new Int32Array(0);
    let activeRowMin = new Int32Array(0);
    let activeRowMax = new Int32Array(0);
    let reactionFlags = new Uint8Array(0);
    let reactionSteam = new Int32Array(0);
    let reactionFires = new Int32Array(0);
    let reactionIgnite = new Int32Array(0);
    let forceFullRender = true;
    let dirtyRenderCount = 0;
    let tick = 0;
    let perfStepMs = 0;
    let perfRenderMs = 0;
    let perfDirtyChunks = 0;
    const I = (x, y) => y * cols + x;
    const XY = (k) => [k % cols, Math.floor(k / cols)];
    const DIRS_LEFT_FIRST = [-1, 1];
    const DIRS_RIGHT_FIRST = [1, -1];
    const PACKED_SAND = 0x79_78_c8_e6;
    const PACKED_WATER = 0x66_ff_aa_78;
    const PACKED_STONE = 0xb3_96_8c_8c;
    const PACKED_OIL = 0x8c_1c_48_69;
    const PACKED_FIRE = 0xb8_22_6c_ff;
    const PACKED_FIRE_HOT = 0x9e_50_cd_ff;
    const PACKED_STEAM = 0x42_ff_e6_d2;
    const PACKED_SEED = 0xc7_16_2e_58;
    const PACKED_WOOD = 0xc2_23_4c_80;
    const PACKED_PLANT = 0xa3_54_aa_5b;
    const MAX_WOOD_CELLS = 120;
    const MAX_LEAF_CELLS = 105;
    const GROWTH_P = 0.58;
    const LEAF_GROWTH_P = 0.54;
    const WATER_PER_GROWTH = 2;
    const TRUNK_THICKEN_UNTIL_WOOD = 52;
    const TRUNK_SIDE_FILL_P = 0.96;
    const TRUNK_DOUBLE_SIDE_FILL_P = 0.78;
    const TRUNK_WIDE_SIDE_FILL_P = 0.34;
    const FULL_RENDER_DIRTY_CHUNK_RATIO = 0.38;

    // Stone components (rigid bodies)
    /** @type {Array<{id:number,cells:Set<number>,yMax:number}>} */
    let stoneComponents = [];
    let nextStoneId = 1;
    /** @type {Array<{id:number,cells:Set<number>,yMax:number,woodCount:number,leafCount:number,age:number,cacheDirty?:boolean,woodCells?:number[],seedWoodCells?:number[]}>} */
    let plantComponents = [];
    let nextPlantId = 1;

    // Drafting state for stone (while holding LMB)
    let isDraftingStone = false;
    /** @type {Set<number>} */
    let stoneDraft = new Set();
    let isDraftingSeed = false;
    let seedDraftOrigin = null;

    // Emitters (grid coords with timing)
    let emitters = [];

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

    // Fit grid/canvas
    const seedInitialSand = () => {
      const band = Math.max(3, Math.floor(rows * 0.10));
      for (let y = rows - 1; y >= rows - band; y--) {
        const t = (y - (rows - band)) / Math.max(1, band - 1);
        const p = 0.05 + t * 0.35;
        for (let x = 1; x < cols - 1; x++) {
          if (Math.random() < p) grid[I(x, y)] = SAND;
        }
      }
      const seedX = Math.floor(cols / 2 - SEED_SIZE / 2);
      const seedY = rows - band - SEED_SIZE;
      placeSeedAt(seedX, seedY);
    };

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const resetDirtyRectAt = (minX, maxX, minY, maxY, k) => {
      minX[k] = cols;
      maxX[k] = -1;
      minY[k] = rows;
      maxY[k] = -1;
    };
    const resetDirtyRectArrays = (minX, maxX, minY, maxY) => {
      minX.fill(cols);
      maxX.fill(-1);
      minY.fill(rows);
      maxY.fill(-1);
    };
    const markDirtyRect = (x0, y0, x1, y1, target = dirtyNext) => {
      if (!target.length || cols <= 0 || rows <= 0) return;
      const minX = clamp(x0 - DIRTY_PAD_X, 0, cols - 1);
      const maxX = clamp(x1 + DIRTY_PAD_X, 0, cols - 1);
      const minY = clamp(y0 - DIRTY_PAD_Y, 0, rows - 1);
      const maxY = clamp(y1 + DIRTY_PAD_Y, 0, rows - 1);
      const c0 = Math.floor(minX / CHUNK_SIZE);
      const c1 = Math.floor(maxX / CHUNK_SIZE);
      const r0 = Math.floor(minY / CHUNK_SIZE);
      const r1 = Math.floor(maxY / CHUNK_SIZE);
      let rectMinX = null;
      let rectMaxX = null;
      let rectMinY = null;
      let rectMaxY = null;
      if (target === dirtyCurrent) {
        rectMinX = dirtyCurrentMinX;
        rectMaxX = dirtyCurrentMaxX;
        rectMinY = dirtyCurrentMinY;
        rectMaxY = dirtyCurrentMaxY;
      } else if (target === dirtyNext) {
        rectMinX = dirtyNextMinX;
        rectMaxX = dirtyNextMaxX;
        rectMinY = dirtyNextMinY;
        rectMaxY = dirtyNextMaxY;
      }
      for (let cy = r0; cy <= r1; cy++) {
        const row = cy * chunkCols;
        const chunkY0 = cy * CHUNK_SIZE;
        const chunkY1 = Math.min(rows - 1, chunkY0 + CHUNK_SIZE - 1);
        for (let cx = c0; cx <= c1; cx++) {
          const k = row + cx;
          if (target === dirtyRender && !target[k]) dirtyRenderCount++;
          target[k] = 1;
          if (rectMinX) {
            const chunkX0 = cx * CHUNK_SIZE;
            const chunkX1 = Math.min(cols - 1, chunkX0 + CHUNK_SIZE - 1);
            const rx0 = Math.max(minX, chunkX0);
            const rx1 = Math.min(maxX, chunkX1);
            const ry0 = Math.max(minY, chunkY0);
            const ry1 = Math.min(maxY, chunkY1);
            if (rx0 < rectMinX[k]) rectMinX[k] = rx0;
            if (rx1 > rectMaxX[k]) rectMaxX[k] = rx1;
            if (ry0 < rectMinY[k]) rectMinY[k] = ry0;
            if (ry1 > rectMaxY[k]) rectMaxY[k] = ry1;
          }
        }
      }
    };
    const markDirtyIndex = (k, target = dirtyNext) => {
      const x = k % cols;
      const y = Math.floor(k / cols);
      markDirtyRect(x, y, x, y, target);
    };
    const markAllDirty = (target = dirtyCurrent) => {
      if (target.length) target.fill(1);
      if (target === dirtyRender) dirtyRenderCount = target.length;
      let rectMinX = null;
      let rectMaxX = null;
      let rectMinY = null;
      let rectMaxY = null;
      if (target === dirtyCurrent) {
        rectMinX = dirtyCurrentMinX;
        rectMaxX = dirtyCurrentMaxX;
        rectMinY = dirtyCurrentMinY;
        rectMaxY = dirtyCurrentMaxY;
      } else if (target === dirtyNext) {
        rectMinX = dirtyNextMinX;
        rectMaxX = dirtyNextMaxX;
        rectMinY = dirtyNextMinY;
        rectMaxY = dirtyNextMaxY;
      }
      if (!rectMinX) return;
      for (let cy = 0; cy < chunkRows; cy++) {
        const y0 = cy * CHUNK_SIZE;
        const y1 = Math.min(rows - 1, y0 + CHUNK_SIZE - 1);
        for (let cx = 0; cx < chunkCols; cx++) {
          const k = cy * chunkCols + cx;
          rectMinX[k] = cx * CHUNK_SIZE;
          rectMaxX[k] = Math.min(cols - 1, rectMinX[k] + CHUNK_SIZE - 1);
          rectMinY[k] = y0;
          rectMaxY[k] = y1;
        }
      }
    };
    const buildActiveRows = () => {
      activeRowMin.fill(cols);
      activeRowMax.fill(-1);

      let hasActive = false;
      perfDirtyChunks = 0;
      for (let cy = 0; cy < chunkRows; cy++) {
        for (let cx = 0; cx < chunkCols; cx++) {
          const chunkIndex = cy * chunkCols + cx;
          if (!dirtyCurrent[chunkIndex]) continue;
          hasActive = true;
          perfDirtyChunks++;
          const x0 = dirtyCurrentMinX[chunkIndex];
          const x1 = dirtyCurrentMaxX[chunkIndex];
          const y0 = dirtyCurrentMinY[chunkIndex];
          const y1 = dirtyCurrentMaxY[chunkIndex];
          if (x1 < x0 || y1 < y0) continue;
          for (let y = y0; y <= y1; y++) {
            if (x0 < activeRowMin[y]) activeRowMin[y] = x0;
            if (x1 > activeRowMax[y]) activeRowMax[y] = x1;
          }
        }
      }
      return hasActive;
    };
    const beginStepDirty = () => {
      for (let i = 0; i < dirtyNext.length; i++) {
        if (dirtyNext[i]) {
          dirtyCurrent[i] = 1;
          if (dirtyNextMinX[i] < dirtyCurrentMinX[i]) dirtyCurrentMinX[i] = dirtyNextMinX[i];
          if (dirtyNextMaxX[i] > dirtyCurrentMaxX[i]) dirtyCurrentMaxX[i] = dirtyNextMaxX[i];
          if (dirtyNextMinY[i] < dirtyCurrentMinY[i]) dirtyCurrentMinY[i] = dirtyNextMinY[i];
          if (dirtyNextMaxY[i] > dirtyCurrentMaxY[i]) dirtyCurrentMaxY[i] = dirtyNextMaxY[i];
          if (!dirtyRender[i]) {
            dirtyRender[i] = 1;
            dirtyRenderCount++;
          }
        }
        dirtyNext[i] = 0;
        resetDirtyRectAt(dirtyNextMinX, dirtyNextMaxX, dirtyNextMinY, dirtyNextMaxY, i);
      }
      const hasActive = buildActiveRows();
      dirtyCurrent.fill(0);
      resetDirtyRectArrays(dirtyCurrentMinX, dirtyCurrentMaxX, dirtyCurrentMinY, dirtyCurrentMaxY);
      return hasActive;
    };
    const prepareNextBuffer = () => {
      // Only active spans need claim clearing. Inactive spans already match across
      // buffers once their dirty chunk has settled.
      for (let y = 0; y < rows; y++) {
        const rowStart = y * cols;
        const minX = activeRowMin[y];
        const maxX = activeRowMax[y];
        if (maxX >= minX) next.fill(EMPTY, rowStart + minX, rowStart + maxX + 1);
      }
    };
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
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // Decide UI placement based on available horizontal space
      setUiAtBottom(width < TOOL_COLLAPSE_W);

      cellSize = CELL_PX;
      cols = Math.max(60, Math.floor(width / cellSize));
      rows = Math.max(28, Math.floor(height / cellSize));
      cellCanvas.width = cols;
      cellCanvas.height = rows;
      cellCtx.imageSmoothingEnabled = false;
      ctx.imageSmoothingEnabled = false;
      imageData = cellCtx.createImageData(cols, rows);
      pixels = new Uint32Array(imageData.data.buffer);

      gridA = new Uint8Array(cols * rows);
      gridB = new Uint8Array(cols * rows);
      grid = gridA; next = gridB;
      chunkCols = Math.ceil(cols / CHUNK_SIZE);
      chunkRows = Math.ceil(rows / CHUNK_SIZE);
      dirtyCurrent = new Uint8Array(chunkCols * chunkRows);
      dirtyNext = new Uint8Array(chunkCols * chunkRows);
      dirtyRender = new Uint8Array(chunkCols * chunkRows);
      dirtyCurrentMinX = new Int32Array(chunkCols * chunkRows);
      dirtyCurrentMaxX = new Int32Array(chunkCols * chunkRows);
      dirtyCurrentMinY = new Int32Array(chunkCols * chunkRows);
      dirtyCurrentMaxY = new Int32Array(chunkCols * chunkRows);
      dirtyNextMinX = new Int32Array(chunkCols * chunkRows);
      dirtyNextMaxX = new Int32Array(chunkCols * chunkRows);
      dirtyNextMinY = new Int32Array(chunkCols * chunkRows);
      dirtyNextMaxY = new Int32Array(chunkCols * chunkRows);
      resetDirtyRectArrays(dirtyCurrentMinX, dirtyCurrentMaxX, dirtyCurrentMinY, dirtyCurrentMaxY);
      resetDirtyRectArrays(dirtyNextMinX, dirtyNextMaxX, dirtyNextMinY, dirtyNextMaxY);
      activeRowMin = new Int32Array(rows);
      activeRowMax = new Int32Array(rows);
      reactionFlags = new Uint8Array(cols * rows);
      reactionSteam = new Int32Array(cols * rows);
      reactionFires = new Int32Array(cols * rows);
      reactionIgnite = new Int32Array(cols * rows);

      stoneComponents = [];
      nextStoneId = 1;
      plantComponents = [];
      nextPlantId = 1;
      stoneDraft.clear();
      isDraftingSeed = false;
      seedDraftOrigin = null;

      seedInitialSand();
      markAllDirty();

      // Prepare emitters with edge/top buffers
      emitters = emitterDefs.map(e => {
        const rawX = Math.floor(e.pos.x * cols);
        const rawY = Math.floor(e.pos.y * rows);
        const gx = clamp(rawX, 1 + EMITTER_EDGE_BUFFER, cols - 2 - EMITTER_EDGE_BUFFER);
        const gy = clamp(rawY, 1 + EMITTER_TOP_BUFFER,  rows - 2 - EMITTER_EDGE_BUFFER);
        return { ...e, gx, gy, last: 0 };
      });

      pixels.fill(0);
      forceFullRender = true;
      dirtyRenderCount = 0;
      ctx.clearRect(0, 0, width, height);
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

    // Global listeners so canvas can stay pointer-events:none
    const onPointerMove = (e) => {
      updatePointer(e.clientX, e.clientY);
      if (e.buttons === 0) {
        overrideToolRef.current = null;
        lmbDown = false;
      }
      if (!drawModeOnRef.current) return;
      if (isDraftingStone && inside) {
        addDiscToDraft(Math.floor(px / cellSize), Math.floor(py / cellSize), STONE_BRUSH_RADIUS);
      }
      if (isDraftingSeed && inside) {
        seedDraftOrigin = getSeedOrigin(Math.floor(px / cellSize), Math.floor(py / cellSize));
      }
    };
    const onTouchMove = (e) => {
      if (!drawModeOnRef.current) return;
      if (!e.touches || e.touches.length === 0) return;
      const t = e.touches[0];
      updatePointer(t.clientX, t.clientY);
      if (isDraftingStone && inside) {
        addDiscToDraft(Math.floor(px / cellSize), Math.floor(py / cellSize), STONE_BRUSH_RADIUS);
      }
      if (isDraftingSeed && inside) {
        seedDraftOrigin = getSeedOrigin(Math.floor(px / cellSize), Math.floor(py / cellSize));
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
          addDiscToDraft(Math.floor(px / cellSize), Math.floor(py / cellSize), STONE_BRUSH_RADIUS);
          e.preventDefault();
          return;
        }
        if (activeTool === 'seed') {
          isDraftingSeed = true;
          seedDraftOrigin = getSeedOrigin(Math.floor(px / cellSize), Math.floor(py / cellSize));
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
          finalizeStoneDraft();
          isDraftingStone = false;
          stoneDraft.clear();
        }
        if (isDraftingSeed) {
          if (seedDraftOrigin) placeSeedAt(seedDraftOrigin[0], seedDraftOrigin[1]);
          isDraftingSeed = false;
          seedDraftOrigin = null;
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

    const onKeyDown = (e) => {
      if (e.repeat) return;
      if (e.key === 'e' || e.key === 'E') {
        setEmittersOn(v => { emittersOnRef.current = !v; return !v; });
      }
      if (e.key === 's' || e.key === 'S') {
        setSinksOn(v => { sinksOnRef.current = !v; return !v; });
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('keydown', onKeyDown);

    // --- Draft helpers for stone ---
    function addDiscToDraft(cx, cy, radius) {
      let changed = false;
      for (let oy = -radius; oy <= radius; oy++) {
        const yy = cy + oy;
        if (yy <= 0 || yy >= rows - 1) continue;
        for (let ox = -radius; ox <= radius; ox++) {
          if (ox * ox + oy * oy > radius * radius) continue;
          const xx = cx + ox;
          if (xx <= 0 || xx >= cols - 1) continue;
          const k = I(xx, yy);
          if (grid[k] === EMPTY) {
            stoneDraft.add(k);
            changed = true;
          }
        }
      }
      if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    }

    function finalizeStoneDraft() {
      if (stoneDraft.size === 0) return;

      const cells = new Set();
      let yMax = 0;

      for (const k of stoneDraft) {
        if (grid[k] === EMPTY) {
          grid[k] = STONE;
          markDirtyIndex(k);
          cells.add(k);
          const [, y] = XY(k);
          if (y > yMax) yMax = y;
        }
      }
      if (cells.size === 0) return;

      // Merge with adjacent existing stone chunks if touching
      const touchingComponentIds = new Set();
      for (const k of cells) {
        const [x, y] = XY(k);
        const nks = neighborIndices8(x, y)
          .filter(nk => nk >= 0 && nk < grid.length && grid[nk] === STONE && !cells.has(nk));
        for (const nk of nks) {
          for (const comp of stoneComponents) {
            if (comp.cells.has(nk)) { touchingComponentIds.add(comp.id); break; }
          }
        }
      }

      let newComp = { id: nextStoneId++, cells, yMax };
      if (touchingComponentIds.size > 0) {
        const keep = [];
        for (const comp of stoneComponents) {
          if (touchingComponentIds.has(comp.id)) {
            for (const k of comp.cells) {
              newComp.cells.add(k);
              const [, y] = XY(k);
              if (y > newComp.yMax) newComp.yMax = y;
            }
          } else {
            keep.push(comp);
          }
        }
        stoneComponents = keep;
      }
      stoneComponents.push(newComp);
    }

    function isPlantMaterial(material) {
      return material === SEED || material === WOOD || material === PLANT;
    }

    function getSeedOrigin(cx, cy) {
      const x0 = Math.floor(cx - SEED_SIZE / 2);
      const y0 = Math.floor(cy - SEED_SIZE / 2);
      if (x0 <= 0 || y0 <= 0 || x0 + SEED_SIZE >= cols || y0 + SEED_SIZE >= rows) return null;
      return [x0, y0];
    }

    function canPlaceSeedAt(x0, y0) {
      if (x0 == null || y0 == null) return false;
      if (x0 <= 0 || y0 <= 0 || x0 + SEED_SIZE >= cols || y0 + SEED_SIZE >= rows) return false;
      for (let y = y0; y < y0 + SEED_SIZE; y++) {
        for (let x = x0; x < x0 + SEED_SIZE; x++) {
          if (grid[I(x, y)] !== EMPTY) return false;
        }
      }
      return true;
    }

    function placeSeedAt(x0, y0) {
      if (!canPlaceSeedAt(x0, y0)) return false;
      const cells = new Set();
      let yMax = 0;
      for (let y = y0; y < y0 + SEED_SIZE; y++) {
        for (let x = x0; x < x0 + SEED_SIZE; x++) {
          const k = I(x, y);
          grid[k] = SEED;
          cells.add(k);
          if (y > yMax) yMax = y;
        }
      }
      plantComponents.push({
        id: nextPlantId++,
        cells,
        yMax,
        woodCount: 0,
        leafCount: 0,
        age: 0,
        cacheDirty: true,
      });
      markDirtyRect(x0, y0, x0 + SEED_SIZE - 1, y0 + SEED_SIZE - 1);
      return true;
    }

    function splitComponentsAfterErase(components, allowedMaterial) {
      const updated = [];
      for (const comp of components) {
        const remaining = new Set();
        let reusedOriginalId = false;
        for (const k of comp.cells) {
          if (allowedMaterial(grid[k])) remaining.add(k);
        }
        while (remaining.size > 0) {
          const [start] = remaining;
          const queue = [start];
          const part = new Set([start]);
          remaining.delete(start);
          while (queue.length) {
            const cur = queue.shift();
            const [x, y] = XY(cur);
            const neigh = neighborIndices8(x, y);
            for (const nk of neigh) {
              if (remaining.has(nk)) {
                remaining.delete(nk);
                part.add(nk);
                queue.push(nk);
              }
            }
          }
          let yMax = 0;
          let woodCount = 0;
          let leafCount = 0;
          for (const k of part) {
            const [, y] = XY(k);
            if (y > yMax) yMax = y;
            if (grid[k] === WOOD) woodCount++;
            else if (grid[k] === PLANT) leafCount++;
          }
          updated.push({
            id: reusedOriginalId ? nextPlantId++ : comp.id,
            cells: part,
            yMax,
            woodCount,
            leafCount,
            age: comp.age ?? 0,
            cacheDirty: true,
          });
          reusedOriginalId = true;
        }
      }
      return updated;
    }

    // Brushes (for sand, water, RMB eraser)
    const paintDisc = (cx, cy, radius, material, overwrite = false) => {
      let changed = false;
      for (let oy = -radius; oy <= radius; oy++) {
        const yy = cy + oy;
        if (yy <= 0 || yy >= rows - 1) continue;
        for (let ox = -radius; ox <= radius; ox++) {
          if (ox * ox + oy * oy > radius * radius) continue;
          const xx = cx + ox;
          if (xx <= 0 || xx >= cols - 1) continue;
          const k = I(xx, yy);
          if ((overwrite || grid[k] === EMPTY) && grid[k] !== material) {
            grid[k] = material;
            changed = true;
          }
        }
      }
      if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
    };

    const eraseDisc = (cx, cy, radius) => {
      const erasedStoneCells = [];
      let erasedPlant = false;
      let changed = false;
      for (let oy = -radius; oy <= radius; oy++) {
        const yy = cy + oy;
        if (yy <= 0 || yy >= rows - 1) continue;
        for (let ox = -radius; ox <= radius; ox++) {
          if (ox * ox + oy * oy > radius * radius) continue;
          const xx = cx + ox;
          if (xx <= 0 || xx >= cols - 1) continue;
          const k = I(xx, yy);
          if (grid[k] !== EMPTY) {
            if (grid[k] === STONE) erasedStoneCells.push(k);
            if (isPlantMaterial(grid[k])) erasedPlant = true;
            grid[k] = EMPTY;
            changed = true;
          }
          if (stoneDraft.has(k)) stoneDraft.delete(k);
        }
      }
      if (changed) markDirtyRect(cx - radius, cy - radius, cx + radius, cy + radius);
      if (erasedStoneCells.length > 0 && stoneComponents.length > 0) {
        // Remove erased cells from chunks and split if needed
        const updated = [];
        for (const comp of stoneComponents) {
          let changed = false;
          for (const k of erasedStoneCells) {
            if (comp.cells.delete(k)) changed = true;
          }
          if (!changed) { updated.push(comp); continue; }
          if (comp.cells.size === 0) continue;

          const remaining = new Set(comp.cells);
          while (remaining.size > 0) {
            const [start] = remaining;
            const queue = [start];
            const part = new Set([start]);
            remaining.delete(start);
            while (queue.length) {
              const cur = queue.shift();
              const [x, y] = XY(cur);
              const neigh = neighborIndices8(x, y);
              for (const nk of neigh) {
                if (remaining.has(nk)) {
                  remaining.delete(nk);
                  part.add(nk);
                  queue.push(nk);
                }
              }
            }
            let yMax = 0;
            for (const k of part) { const [, y] = XY(k); if (y > yMax) yMax = y; }
            updated.push({ id: nextStoneId++, cells: part, yMax });
          }
        }
        stoneComponents = updated;
      }
      if (erasedPlant && plantComponents.length > 0) {
        plantComponents = splitComponentsAfterErase(plantComponents, isPlantMaterial);
      }
    };

    // Emission controller
    let lastEmit = 0;
    const emitAtPointer = (now) => {
      if (!inside) return;

      const rmbHeld = overrideToolRef.current === 'eraser';
      const activeTool = rmbHeld ? 'eraser' : toolRef.current;

      // Stone: handled by draft logic, not here
      if (activeTool === 'stone') return;
      if (!drawModeOnRef.current) return;

      // Paint only while LMB is down (or RMB for eraser)
      const shouldEmit =
        rmbHeld ? true :
        (activeTool === 'sand' || activeTool === 'water' || activeTool === 'oil' || activeTool === 'fire') ? lmbDown : false;

      if (!shouldEmit) return;
      if (now - lastEmit < EMIT_INTERVAL_MS) return;

      const cx = Math.floor(px / cellSize);
      const cy = Math.floor(py / cellSize);
      if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) return;

      if (activeTool === 'eraser') {
        eraseDisc(cx, cy, ERASE_BRUSH_RADIUS);
        lastEmit = now; return;
      }
      if (activeTool === 'water') {
        paintDisc(cx, cy, WATER_BRUSH_RADIUS, WATER, false);
        lastEmit = now; return;
      }
      if (activeTool === 'oil') {
        paintDisc(cx, cy, OIL_BRUSH_RADIUS, OIL, false);
        lastEmit = now; return;
      }
      if (activeTool === 'fire') {
        paintDisc(cx, cy, FIRE_BRUSH_RADIUS, FIRE, false);
        lastEmit = now; return;
      }
      // sand
      if (grid[I(cx, cy)] !== EMPTY) { lastEmit = now; return; }
      paintDisc(cx, cy, SAND_BRUSH_RADIUS, SAND, false);
      lastEmit = now;
    };

    // --- Emitters ---
    const applyEmitters = (now) => {
      if (!emittersOnRef.current) return;
      for (const e of emitters) {
        if (now - e.last < e.rateMs) continue;
        e.last = now;
        const mat = e.type === 'water' ? WATER : SAND;
        paintDisc(e.gx, e.gy, e.r, mat, false);
      }
    };

    // Helpers
    const emptyAt = (x, y) =>
      x >= 0 && x < cols && y >= 0 && y < rows && grid[I(x, y)] === EMPTY && next[I(x, y)] === EMPTY;
    const canWaterEnter = (x, y) =>
      x >= 0 && x < cols && y >= 0 && y < rows && (grid[I(x, y)] === EMPTY || grid[I(x, y)] === OIL) && next[I(x, y)] === EMPTY;
    const supportsWater = (material) =>
      material !== EMPTY && material !== WATER && material !== OIL && material !== STEAM && material !== FIRE;
    const touchesGridEmpty = (k) => {
      const x = k % cols;
      const y = Math.floor(k / cols);
      return (
        (x > 1 && grid[k - 1] === EMPTY) ||
        (x < cols - 2 && grid[k + 1] === EMPTY) ||
        (y > 1 && grid[k - cols] === EMPTY) ||
        (y < rows - 2 && grid[k + cols] === EMPTY)
      );
    };
    const writeGridIndex = (k, material) => {
      if (grid[k] === material) return;
      grid[k] = material;
      markDirtyIndex(k);
    };
    const writeNextIndex = (k, material) => {
      if (next[k] === material) return;
      next[k] = material;
      if (
        grid[k] !== material ||
        material === FIRE ||
        material === STEAM ||
        (material === WATER && touchesGridEmpty(k))
      ) {
        markDirtyIndex(k);
      }
    };
    const moveWaterInto = (fromK, x, y) => {
      const toK = I(x, y);
      const displaced = grid[toK];
      writeNextIndex(toK, WATER);
      if (displaced === OIL && next[fromK] === EMPTY) writeNextIndex(fromK, OIL);
    };
    const moveOilIntoWater = (fromK, x, y) => {
      const toK = I(x, y);
      writeNextIndex(toK, OIL);
      if (next[fromK] === EMPTY) writeNextIndex(fromK, WATER);
    };
    const isInBounds = (x, y) => x > 0 && x < cols - 1 && y > 0 && y < rows - 1;
    const neighbors4 = (x, y) => [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ].filter(([nx, ny]) => isInBounds(nx, ny));
    const neighborIndices8 = (x, y) => {
      const indices = [];
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (isInBounds(nx, ny)) indices.push(I(nx, ny));
        }
      }
      return indices;
    };

    // --- Cohesive STONE chunks ---
    function moveStoneComponentsDown() {
      if (stoneComponents.length === 0) return;

      for (const comp of stoneComponents) {
        let ym = 0;
        for (const k of comp.cells) { const [, y] = XY(k); if (y > ym) ym = y; }
        comp.yMax = ym;
      }
      stoneComponents.sort((a, b) => b.yMax - a.yMax);

      for (const comp of stoneComponents) {
        let canMove = true;

        for (const k of comp.cells) {
          const [x, y] = XY(k);
          const ny = y + 1;
          if (ny >= rows) { canMove = false; break; }
          const belowK = I(x, ny);
          if (comp.cells.has(belowK)) continue;
          const mat = grid[belowK];
          if (mat !== EMPTY && mat !== WATER && mat !== OIL) { canMove = false; break; }
        }
        if (!canMove) continue;

        // Track displaced liquids to bubble up
        const liquidSwaps = [];
        for (const k of comp.cells) {
          const [x, y] = XY(k);
          const belowK = I(x, y + 1);
          const below = grid[belowK];
          if (!comp.cells.has(belowK) && (below === WATER || below === OIL)) {
            liquidSwaps.push([belowK, k, below]); // [liquidIndexBelow, stoneOriginIndex, material]
          }
        }

        // Clear old stones
        for (const k of comp.cells) writeGridIndex(k, EMPTY);

        // Bubble displaced liquids up into vacated cells
        for (const [liquidIdx, originIdx, material] of liquidSwaps) {
          writeGridIndex(originIdx, material);
          markDirtyIndex(liquidIdx);
        }

        // Move stones down
        const newCells = new Set();
        for (const k of comp.cells) {
          const [x, y] = XY(k);
          const nk = I(x, y + 1);
          newCells.add(nk);
        }
        for (const nk of newCells) writeGridIndex(nk, STONE);

        comp.cells = newCells;
        comp.yMax = Math.min(rows - 1, comp.yMax + 1);
      }
    }

    function movePlantComponentsDown() {
      if (plantComponents.length === 0) return;

      for (const comp of plantComponents) {
        let ym = 0;
        for (const k of comp.cells) { const [, y] = XY(k); if (y > ym) ym = y; }
        comp.yMax = ym;
      }
      plantComponents.sort((a, b) => b.yMax - a.yMax);

      for (const comp of plantComponents) {
        let canMove = true;

        for (const k of comp.cells) {
          const [x, y] = XY(k);
          const ny = y + 1;
          if (ny >= rows) { canMove = false; break; }
          const belowK = I(x, ny);
          if (comp.cells.has(belowK)) continue;
          const mat = grid[belowK];
          if (mat !== EMPTY && mat !== WATER && mat !== OIL) { canMove = false; break; }
        }
        if (!canMove) continue;

        const displacedLiquids = [];
        const vacatedCells = [];
        const movedCells = [];
        for (const k of comp.cells) {
          const [x, y] = XY(k);
          const belowK = I(x, y + 1);
          const below = grid[belowK];
          if (!comp.cells.has(belowK) && (below === WATER || below === OIL)) {
            displacedLiquids.push([belowK, below]);
          }
          if (!comp.cells.has(k - cols)) vacatedCells.push(k);
          movedCells.push([k + cols, grid[k]]);
        }

        for (const k of comp.cells) writeGridIndex(k, EMPTY);

        const newCells = new Set();
        let woodCount = 0;
        let leafCount = 0;
        for (const [nk, material] of movedCells) {
          writeGridIndex(nk, material);
          newCells.add(nk);
          if (material === WOOD) woodCount++;
          else if (material === PLANT) leafCount++;
        }

        vacatedCells.sort((a, b) => Math.floor(a / cols) - Math.floor(b / cols));
        for (let i = 0; i < displacedLiquids.length && i < vacatedCells.length; i++) {
          const [liquidIdx, material] = displacedLiquids[i];
          writeGridIndex(vacatedCells[i], material);
          markDirtyIndex(liquidIdx);
        }

        comp.cells = newCells;
        comp.woodCount = woodCount;
        comp.leafCount = leafCount;
        comp.cacheDirty = true;
        comp.yMax = Math.min(rows - 1, comp.yMax + 1);
      }
    }

    function findWaterTouchingComponent(comp, count = 1) {
      const candidates = [];
      const consider = (nk) => {
        if (grid[nk] !== WATER) return;
        if (!candidates.includes(nk)) candidates.push(nk);
      };
      for (const k of comp.cells) {
        const material = grid[k];
        if (material !== SEED && material !== WOOD) continue;
        const x = k % cols;
        const y = Math.floor(k / cols);
        if (x < cols - 2) consider(k + 1);
        if (x > 1) consider(k - 1);
        if (y < rows - 2) consider(k + cols);
        if (y > 1) consider(k - cols);
      }
      if (candidates.length < count) return null;
      const picked = [];
      while (picked.length < count && candidates.length > 0) {
        const i = Math.floor(Math.random() * candidates.length);
        const [k] = candidates.splice(i, 1);
        picked.push(k);
      }
      return picked.length === count ? picked : null;
    }

    function refreshPlantCache(comp) {
      if (!comp.cacheDirty && comp.woodCells && comp.seedWoodCells) return;
      const woodCells = [];
      const seedWoodCells = [];
      for (const k of comp.cells) {
        const material = grid[k];
        if (material === WOOD) {
          woodCells.push(k);
          seedWoodCells.push(k);
        } else if (material === SEED) {
          seedWoodCells.push(k);
        }
      }
      woodCells.sort((a, b) => Math.floor(a / cols) - Math.floor(b / cols));
      seedWoodCells.sort((a, b) => Math.floor(a / cols) - Math.floor(b / cols));
      comp.woodCells = woodCells;
      comp.seedWoodCells = seedWoodCells;
      comp.cacheDirty = false;
    }

    function tryGrowWood(comp, reserved = new Set()) {
      refreshPlantCache(comp);
      const sources = comp.woodCells.length > 0 ? comp.woodCells : comp.seedWoodCells;

      for (const source of sources) {
        const [x, y] = XY(source);
        const branchReady = comp.woodCount > 16;
        const branchDir = Math.random() < 0.5 ? -1 : 1;
        const candidates = branchReady && Math.random() < 0.55
          ? [
              [x + branchDir, y - 1],
              [x + branchDir * 2, y - 1],
              [x + branchDir, y],
              [x, y - 1],
              [x - branchDir, y - 1],
            ]
          : [
              [x, y - 1],
              [x - 1, y - 1],
              [x + 1, y - 1],
              [x - 1, y],
              [x + 1, y],
            ];

        for (const [tx, ty] of candidates) {
          if (!isInBounds(tx, ty)) continue;
          const tk = I(tx, ty);
          if (grid[tk] === EMPTY && !reserved.has(tk)) return tk;
        }
      }
      return -1;
    }

    function addWoodIfOpen(k, growth, reserved) {
      if (k < 0 || k >= grid.length || grid[k] !== EMPTY || reserved.has(k)) return false;
      growth.push([k, WOOD]);
      reserved.add(k);
      return true;
    }

    function thickenTrunkAround(k, comp, growth, reserved) {
      if (comp.woodCount >= TRUNK_THICKEN_UNTIL_WOOD || Math.random() > TRUNK_SIDE_FILL_P) return;
      const [x, y] = XY(k);
      const dirs = Math.random() < 0.5 ? DIRS_LEFT_FIRST : DIRS_RIGHT_FIRST;

      for (const dx of dirs) {
        const tx = x + dx;
        if (!isInBounds(tx, y)) continue;
        if (addWoodIfOpen(I(tx, y), growth, reserved)) break;
      }

      if (Math.random() > TRUNK_DOUBLE_SIDE_FILL_P) return;
      for (const dx of dirs) {
        const tx = x - dx;
        if (!isInBounds(tx, y)) continue;
        if (addWoodIfOpen(I(tx, y), growth, reserved)) break;
      }

      if (Math.random() > TRUNK_WIDE_SIDE_FILL_P) return;
      for (const dx of dirs) {
        const tx = x + dx * 2;
        if (!isInBounds(tx, y)) continue;
        if (addWoodIfOpen(I(tx, y), growth, reserved)) break;
      }
    }

    function tryGrowLeaf(comp, reserved = new Set()) {
      refreshPlantCache(comp);
      const woodCells = comp.woodCells;
      if (woodCells.length === 0) return -1;

      for (const source of woodCells) {
        const [x, y] = XY(source);
        const candidates = [
          [x, y - 1],
          [x - 1, y],
          [x + 1, y],
          [x - 1, y - 1],
          [x + 1, y - 1],
          [x - 2, y],
          [x + 2, y],
          [x - 2, y - 1],
          [x + 2, y - 1],
          [x - 3, y],
          [x + 3, y],
        ];
        const start = Math.floor(Math.random() * candidates.length);
        const step = Math.random() < 0.5 ? 1 : -1;

        for (let i = 0; i < candidates.length; i++) {
          const [tx, ty] = candidates[(start + i * step + candidates.length) % candidates.length];
          if (!isInBounds(tx, ty)) continue;
          const tk = I(tx, ty);
          if (grid[tk] === EMPTY && !reserved.has(tk)) return tk;
        }
      }
      return -1;
    }

    function growPlantComponents() {
      if (plantComponents.length === 0) return;

      for (const comp of plantComponents) {
        comp.age = (comp.age ?? 0) + 1;
        const waterCells = findWaterTouchingComponent(comp, WATER_PER_GROWTH);
        if (!waterCells) continue;
        for (const waterK of waterCells) markDirtyIndex(waterK);
        if (Math.random() > GROWTH_P) continue;

        const growth = [];
        const reserved = new Set();
        const shouldGrowWood = comp.woodCount < MAX_WOOD_CELLS && (comp.woodCount < 18 || Math.random() > LEAF_GROWTH_P);
        if (shouldGrowWood) {
          const firstWood = tryGrowWood(comp, reserved);
          if (firstWood >= 0 && addWoodIfOpen(firstWood, growth, reserved)) {
            thickenTrunkAround(firstWood, comp, growth, reserved);
          }

          const extraWood = tryGrowWood(comp, reserved);
          if (extraWood >= 0 && Math.random() < 0.72) {
            addWoodIfOpen(extraWood, growth, reserved);
          }
        }
        if (growth.length === 0 && comp.woodCount >= 6 && comp.leafCount < MAX_LEAF_CELLS) {
          const leafCount = Math.random() < 0.35 ? 2 : 1;
          for (let i = 0; i < leafCount; i++) {
            const leafK = tryGrowLeaf(comp, reserved);
            if (leafK >= 0) {
              growth.push([leafK, PLANT]);
              reserved.add(leafK);
            }
          }
        }
        if (growth.length === 0) continue;

        for (const waterK of waterCells) writeGridIndex(waterK, EMPTY);
        for (const [targetK, material] of growth) {
          if (grid[targetK] !== EMPTY) continue;
          writeGridIndex(targetK, material);
          comp.cells.add(targetK);
          const [, y] = XY(targetK);
          if (y > comp.yMax) comp.yMax = y;
          if (material === WOOD) comp.woodCount++;
          else comp.leafCount++;
          comp.cacheDirty = true;
        }
      }
    }

    // Sand physics
    const settleSand = (x, y) => {
      const k = I(x, y);
      if (grid[k] !== SAND) return;

      const belowK = k + cols;
      if (y + 1 < rows && grid[belowK] === EMPTY && next[belowK] === EMPTY) {
        writeNextIndex(belowK, SAND); return;
      }
      if (y + 1 < rows && grid[belowK] === WATER && next[belowK] === EMPTY) {
        writeNextIndex(belowK, SAND);
        if (next[k] === EMPTY) writeNextIndex(k, WATER);
        return;
      }
      if (y + 1 < rows && grid[belowK] === OIL && next[belowK] === EMPTY) {
        writeNextIndex(belowK, SAND);
        if (next[k] === EMPTY) writeNextIndex(k, OIL);
        return;
      }

      const firstDx = Math.random() < 0.5 ? -1 : 1;
      const secondDx = -firstDx;
      for (let i = 0; i < 2; i++) {
        const dx = i === 0 ? firstDx : secondDx;
        const nx = x + dx;
        if (nx <= 0 || nx >= cols - 1 || y + 1 >= rows) continue;
        const ik = belowK + dx;
        const material = grid[ik];
        if (material === EMPTY && next[ik] === EMPTY) { writeNextIndex(ik, SAND); return; }
        if (material === WATER && next[ik] === EMPTY) {
          writeNextIndex(ik, SAND); if (next[k] === EMPTY) writeNextIndex(k, WATER); return;
        }
        if (material === OIL && next[ik] === EMPTY) {
          writeNextIndex(ik, SAND); if (next[k] === EMPTY) writeNextIndex(k, OIL); return;
        }
      }

      if (next[k] === EMPTY) writeNextIndex(k, SAND);
    };

    // Water physics
    const settleWater = (x, y) => {
      const k = I(x, y);
      if (grid[k] !== WATER) return;
      if (next[k] !== EMPTY) return;

      const belowK = k + cols;
      if (y + 1 < rows && grid[belowK] === EMPTY && next[belowK] === EMPTY) {
        writeNextIndex(belowK, WATER); return;
      }
      if (y + 1 < rows && grid[belowK] === OIL && next[belowK] === EMPTY) {
        moveWaterInto(k, x, y + 1);
        return;
      }

      const dirs = Math.random() < 0.5 ? DIRS_LEFT_FIRST : DIRS_RIGHT_FIRST;
      for (const dx of dirs) {
        const nx = x + dx, ny = y + 1;
        if (nx <= 0 || nx >= cols - 1 || ny >= rows) continue;
        const ik = I(nx, ny);
        if (grid[ik] === EMPTY && next[ik] === EMPTY) { writeNextIndex(ik, WATER); return; }
        if (grid[ik] === OIL && next[ik] === EMPTY) {
          moveWaterInto(k, nx, ny);
          return;
        }
      }

      let flow = 0;
      const firstFlowDir = Math.random() < 0.5 ? 1 : -1;
      for (let dirIndex = 0; dirIndex < 2 && flow === 0; dirIndex++) {
        const sgn = dirIndex === 0 ? firstFlowDir : -firstFlowDir;
        for (let d = 1; d <= MAX_WATER_FLOW; d++) {
          const nx = x + sgn * d;
          if (nx <= 0 || nx >= cols - 1) break;
          const sideK = k + sgn * d;
          if (grid[sideK] !== EMPTY && grid[sideK] !== OIL) break;
          if (next[sideK] !== EMPTY) break;
          if (y + 1 < rows) {
            const lowerK = sideK + cols;
            if ((grid[lowerK] === EMPTY || grid[lowerK] === OIL) && next[lowerK] === EMPTY) {
              const stepK = k + sgn;
              if ((grid[stepK] === EMPTY || grid[stepK] === OIL) && next[stepK] === EMPTY) flow = sgn;
              break;
            }
          }
        }
      }
      if (flow !== 0) {
        const stepX = x + flow;
        if (canWaterEnter(stepX, y)) { moveWaterInto(k, stepX, y); return; }
      }

      if (y + 1 < rows && supportsWater(grid[belowK])) {
        const aboveK = k - cols;
        if (y > 1 && grid[aboveK] === WATER) {
          for (const dx of dirs) {
            const sideK = k + dx;
            if (x + dx <= 0 || x + dx >= cols - 1) continue;
            if (grid[sideK] === EMPTY && next[sideK] === EMPTY && supportsWater(grid[sideK + cols])) {
              writeNextIndex(sideK, WATER);
              return;
            }
          }
        }
        if (next[k] === EMPTY) writeNextIndex(k, WATER);
        return;
      }

      for (const dx of dirs) {
        if (canWaterEnter(x + dx, y)) { moveWaterInto(k, x + dx, y); return; }
      }

      if (next[k] === EMPTY) writeNextIndex(k, WATER);
    };

    const settleOil = (x, y) => {
      const k = I(x, y);
      if (grid[k] !== OIL) return;
      if (next[k] !== EMPTY) return;

      const aboveK = k - cols;
      const belowK = k + cols;
      if (y - 1 > 0 && grid[aboveK] === WATER && next[aboveK] === EMPTY) {
        moveOilIntoWater(k, x, y - 1);
        return;
      }

      const riseDirs = Math.random() < 0.5 ? DIRS_LEFT_FIRST : DIRS_RIGHT_FIRST;
      for (const dx of riseDirs) {
        const nx = x + dx, ny = y - 1;
        if (nx <= 0 || nx >= cols - 1 || ny <= 0) continue;
        if (grid[I(nx, ny)] === WATER && next[I(nx, ny)] === EMPTY) {
          moveOilIntoWater(k, nx, ny);
          return;
        }
      }

      if (y + 1 < rows && grid[belowK] === EMPTY && next[belowK] === EMPTY) {
        writeNextIndex(belowK, OIL); return;
      }

      const dirs = Math.random() < 0.5 ? DIRS_LEFT_FIRST : DIRS_RIGHT_FIRST;
      for (const dx of dirs) {
        const nx = x + dx, ny = y + 1;
        if (nx <= 0 || nx >= cols - 1 || ny >= rows) continue;
        const ik = I(nx, ny);
        if (grid[ik] === EMPTY && next[ik] === EMPTY && grid[belowK] !== WATER) { writeNextIndex(ik, OIL); return; }
      }

      let flow = 0;
      const firstFlowDir = Math.random() < 0.5 ? 1 : -1;
      for (let dirIndex = 0; dirIndex < 2 && flow === 0; dirIndex++) {
        const sgn = dirIndex === 0 ? firstFlowDir : -firstFlowDir;
        for (let d = 1; d <= MAX_WATER_FLOW; d++) {
          const nx = x + sgn * d;
          if (nx <= 0 || nx >= cols - 1) break;
          const sideK = k + sgn * d;
          if (grid[sideK] !== EMPTY || next[sideK] !== EMPTY) break;
          const below = y + 1 < rows ? grid[sideK + cols] : STONE;
          if (below === EMPTY) {
            const stepK = k + sgn;
            if (grid[stepK] === EMPTY && next[stepK] === EMPTY) flow = sgn;
            break;
          }
        }
      }
      if (flow !== 0) {
        const stepX = x + flow;
        if (emptyAt(stepX, y)) { writeNextIndex(I(stepX, y), OIL); return; }
      }

      const jiggle = Math.random() < 0.5 ? -1 : 1;
      if (emptyAt(x + jiggle, y)) { writeNextIndex(I(x + jiggle, y), OIL); return; }

      if (next[k] === EMPTY) writeNextIndex(k, OIL);
    };

    const relaxLiquidGaps = () => {
      for (let pass = 0; pass < 2; pass++) {
        for (let y = rows - 2; y > 0; y--) {
          const minX = Math.max(1, activeRowMin[y]);
          const maxX = Math.min(cols - 2, activeRowMax[y]);
          if (maxX < minX) continue;
          const ltr = Math.random() < 0.5;
          const start = ltr ? minX : maxX;
          const end = ltr ? maxX + 1 : minX - 1;
          const stepX = ltr ? 1 : -1;

          for (let x = start; x !== end; x += stepX) {
            const k = I(x, y);
            if (grid[k] !== EMPTY) continue;

            const below = grid[I(x, y + 1)];
            if (below === EMPTY) continue;

            const dirs = Math.random() < 0.5 ? DIRS_LEFT_FIRST : DIRS_RIGHT_FIRST;
            for (const dx of dirs) {
              const sx = x + dx;
              if (sx <= 0 || sx >= cols - 1) continue;
              const sk = I(sx, y);
              const side = grid[sk];
              if (side !== WATER && side !== OIL) continue;
              writeGridIndex(k, side);
              writeGridIndex(sk, EMPTY);
              if (grid[k] !== EMPTY) break;
            }

            if (grid[k] !== EMPTY) continue;

            const aboveK = I(x, y - 1);
            const above = grid[aboveK];
            if (above !== WATER && above !== OIL) continue;

            const left = grid[I(x - 1, y)];
            const right = grid[I(x + 1, y)];
            if (left === above || right === above || below === above) {
              writeGridIndex(k, above);
              writeGridIndex(aboveK, EMPTY);
            }
          }
        }
      }
    };

    const sealWaterPockets = () => {
      for (let pass = 0; pass < 2; pass++) {
        for (let y = rows - 2; y > 0; y--) {
          const minX = Math.max(1, activeRowMin[y]);
          const maxX = Math.min(cols - 2, activeRowMax[y]);
          if (maxX < minX) continue;
          const ltr = (y & 1) === 0;
          const start = ltr ? minX : maxX;
          const end = ltr ? maxX + 1 : minX - 1;
          const stepX = ltr ? 1 : -1;

          for (let x = start; x !== end; x += stepX) {
            const k = I(x, y);
            if (grid[k] !== EMPTY) continue;

            const below = grid[I(x, y + 1)];
            if (below === EMPTY) continue;

            const aboveK = I(x, y - 1);
            if (grid[aboveK] !== WATER || below !== WATER) continue;
            writeGridIndex(k, WATER);
            writeGridIndex(aboveK, EMPTY);
          }
        }
      }
    };

    const separateLiquidsByDensity = () => {
      const parity = Math.random() < 0.5 ? 0 : 1;
      for (let y = 1; y < rows - 1; y++) {
        const minX = Math.max(1, activeRowMin[y]);
        const maxX = Math.min(cols - 2, activeRowMax[y]);
        if (maxX < minX) continue;
        const ltr = y % 2 === 0;
        const start = ltr ? minX : maxX;
        const end = ltr ? maxX + 1 : minX - 1;
        const stepX = ltr ? 1 : -1;

        for (let x = start; x !== end; x += stepX) {
          if ((x + y) % 2 !== parity) continue;
          const k = I(x, y);
          if (grid[k] !== OIL) continue;

          const aboveK = I(x, y - 1);
          if (grid[aboveK] === WATER) {
            writeGridIndex(aboveK, OIL);
            writeGridIndex(k, WATER);
          }
        }
      }
    };

    const riseSteam = (x, y) => {
      const k = I(x, y);
      if (grid[k] !== STEAM) return;
      if (next[k] !== EMPTY) return;
      if (Math.random() < STEAM_DECAY_P || y <= 1) {
        markDirtyIndex(k);
        return;
      }

      const up = I(x, y - 1);
      if (grid[up] === EMPTY && next[up] === EMPTY && Math.random() < 0.72) {
        writeNextIndex(up, STEAM); return;
      }

      const dirs = Math.random() < 0.5 ? DIRS_LEFT_FIRST : DIRS_RIGHT_FIRST;
      for (const dx of dirs) {
        const nx = x + dx;
        const ny = y - 1;
        if (!isInBounds(nx, ny)) continue;
        const ik = I(nx, ny);
        if (grid[ik] === EMPTY && next[ik] === EMPTY) { writeNextIndex(ik, STEAM); return; }
      }

      if (Math.random() < 0.65) {
        for (const dx of dirs) {
          if (emptyAt(x + dx, y)) { writeNextIndex(I(x + dx, y), STEAM); return; }
        }
      }

      if (next[k] === EMPTY) writeNextIndex(k, STEAM);
    };

    const riseFire = (x, y) => {
      const k = I(x, y);
      if (grid[k] !== FIRE) return;
      if (next[k] !== EMPTY) return;
      if (Math.random() < FIRE_DECAY_P || y <= 1) {
        markDirtyIndex(k);
        return;
      }

      const dirs = Math.random() < 0.5 ? DIRS_LEFT_FIRST : DIRS_RIGHT_FIRST;
      if (Math.random() < 0.36) {
        const up = I(x, y - 1);
        if (grid[up] === EMPTY && next[up] === EMPTY) { writeNextIndex(up, FIRE); return; }
      }

      for (const dx of dirs) {
        const nx = x + dx;
        const ny = Math.random() < 0.55 ? y - 1 : y;
        if (!isInBounds(nx, ny)) continue;
        const ik = I(nx, ny);
        if (grid[ik] === EMPTY && next[ik] === EMPTY) { writeNextIndex(ik, FIRE); return; }
      }

      if (next[k] === EMPTY) writeNextIndex(k, FIRE);
    };

    const applyReactions = () => {
      let steamCount = 0;
      let fireCount = 0;
      let igniteCount = 0;
      let plantBurned = false;

      for (let y = 1; y < rows - 1; y++) {
        const minX = Math.max(1, activeRowMin[y]);
        const maxX = Math.min(cols - 2, activeRowMax[y]);
        if (maxX < minX) continue;
        for (let x = minX; x <= maxX; x++) {
          const k = I(x, y);
          if (grid[k] !== WATER) continue;

          let nk = k + 1;
          if (grid[nk] !== FIRE) nk = k - 1;
          if (grid[nk] !== FIRE) nk = k + cols;
          if (grid[nk] !== FIRE) nk = k - cols;
          if (grid[nk] === FIRE) {
            reactionSteam[steamCount++] = k;
            if (!reactionFlags[nk]) {
              reactionFlags[nk] = 1;
              reactionFires[fireCount++] = nk;
            }
          }
        }
      }

      for (let y = 1; y < rows - 1; y++) {
        const minX = Math.max(1, activeRowMin[y]);
        const maxX = Math.min(cols - 2, activeRowMax[y]);
        if (maxX < minX) continue;
        for (let x = minX; x <= maxX; x++) {
          const k = I(x, y);
          if (grid[k] !== FIRE || reactionFlags[k]) continue;

          for (let i = 0; i < 4; i++) {
            const nk = i === 0 ? k + 1 : i === 1 ? k - 1 : i === 2 ? k + cols : k - cols;
            if (grid[nk] === OIL) {
              if (Math.random() > OIL_IGNITE_P) continue;
              if (igniteCount < reactionIgnite.length) reactionIgnite[igniteCount++] = nk;
              if (Math.random() < FIRE_SPREAD_P) {
                for (let j = 0; j < 4; j++) {
                  const ok = j === 0 ? nk + 1 : j === 1 ? nk - 1 : j === 2 ? nk + cols : nk - cols;
                  if (grid[ok] === OIL && Math.random() < 0.12 && igniteCount < reactionIgnite.length) reactionIgnite[igniteCount++] = ok;
                }
              }
            } else if (isPlantMaterial(grid[nk]) && Math.random() < PLANT_IGNITE_P) {
              if (igniteCount < reactionIgnite.length) reactionIgnite[igniteCount++] = nk;
            }
          }
        }
      }

      for (let i = 0; i < fireCount; i++) {
        const k = reactionFires[i];
        if (grid[k] === FIRE) writeGridIndex(k, EMPTY);
        reactionFlags[k] = 0;
      }
      for (let i = 0; i < steamCount; i++) {
        const k = reactionSteam[i];
        if (grid[k] === WATER) writeGridIndex(k, STEAM);
      }
      for (let i = 0; i < igniteCount; i++) {
        const k = reactionIgnite[i];
        if (grid[k] === OIL || isPlantMaterial(grid[k])) {
          plantBurned = plantBurned || isPlantMaterial(grid[k]);
          writeGridIndex(k, FIRE);
        }
      }
      if (plantBurned) plantComponents = splitComponentsAfterErase(plantComponents, isPlantMaterial);
    };

    // --- Side sinks only (bottom preserved) ---
    const applySideSinks = () => {
      if (!sinksOnRef.current) return;
      if (cols < 6) return;

      const leftStart  = 1;
      const leftEnd    = leftStart + SINK_STRIP_W - 1;
      const rightStart = cols - 2 - (SINK_STRIP_W - 1);
      const rightEnd   = cols - 2;

      const innerLeftStart  = leftEnd + 1;
      const innerLeftEnd    = innerLeftStart + INNER_STRIP_W - 1;
      const innerRightEnd   = rightStart - 1;
      const innerRightStart = innerRightEnd - (INNER_STRIP_W - 1);

      for (let y = 1; y < rows - 1; y++) {
        // hard sinks near the side walls
        for (let x = leftStart; x <= leftEnd; x++) {
          const k = I(x, y);
          const m = grid[k];
          if (m === WATER) { if (Math.random() < SINK_WATER_P) writeGridIndex(k, EMPTY); }
          else if (m === OIL) { if (Math.random() < SINK_OIL_P) writeGridIndex(k, EMPTY); }
          else if (m === SAND) { if (Math.random() < SINK_SAND_P) writeGridIndex(k, EMPTY); }
        }
        for (let x = rightStart; x <= rightEnd; x++) {
          const k = I(x, y);
          const m = grid[k];
          if (m === WATER) { if (Math.random() < SINK_WATER_P) writeGridIndex(k, EMPTY); }
          else if (m === OIL) { if (Math.random() < SINK_OIL_P) writeGridIndex(k, EMPTY); }
          else if (m === SAND) { if (Math.random() < SINK_SAND_P) writeGridIndex(k, EMPTY); }
        }

        // gentle inner relief (helps sand/water reach the sink)
        for (let x = innerLeftStart; x <= innerLeftEnd; x++) {
          const k = I(x, y);
          const m = grid[k];
          if (m === WATER) { if (Math.random() < INNER_WATER_P) writeGridIndex(k, EMPTY); }
          else if (m === OIL) { if (Math.random() < INNER_OIL_P) writeGridIndex(k, EMPTY); }
          else if (m === SAND) { if (Math.random() < INNER_SAND_P) writeGridIndex(k, EMPTY); }
        }
        for (let x = innerRightStart; x <= innerRightEnd; x++) {
          const k = I(x, y);
          const m = grid[k];
          if (m === WATER) { if (Math.random() < INNER_WATER_P) writeGridIndex(k, EMPTY); }
          else if (m === OIL) { if (Math.random() < INNER_OIL_P) writeGridIndex(k, EMPTY); }
          else if (m === SAND) { if (Math.random() < INNER_SAND_P) writeGridIndex(k, EMPTY); }
        }
      }
    };

    // Physics step
    const step = () => {
      if (!beginStepDirty()) return false;
      const stepStart = performance.now();
      tick++;

      // 1) Move rigid bodies first, directly on grid
      moveStoneComponentsDown();
      movePlantComponentsDown();

      // 2) Grow plants and apply material reactions directly on grid
      growPlantComponents();
      applyReactions();

      // 3) Prepare next buffer & carry stones forward
      prepareNextBuffer();
      for (const comp of stoneComponents) {
        for (const k of comp.cells) next[k] = STONE;
      }
      for (const comp of plantComponents) {
        for (const k of comp.cells) next[k] = grid[k];
      }

      // 4) Dense falling material. Sand gets first claim on water/oil swaps so
      // stationary liquid claims cannot block density displacement.
      for (let y = rows - 1; y >= 0; y--) {
        const minX = activeRowMin[y];
        const maxX = activeRowMax[y];
        if (maxX < minX) continue;
        const ltr = (y & 1) === 0;
        if (ltr) {
          for (let x = minX; x <= maxX; x++) {
            if (grid[I(x, y)] === SAND) settleSand(x, y);
          }
        } else {
          for (let x = maxX; x >= minX; x--) {
            if (grid[I(x, y)] === SAND) settleSand(x, y);
          }
        }
      }

      // 5) Liquids
      for (let y = rows - 1; y >= 0; y--) {
        const minX = activeRowMin[y];
        const maxX = activeRowMax[y];
        if (maxX < minX) continue;
        const ltr = (y & 1) === 0;
        if (ltr) {
          for (let x = minX; x <= maxX; x++) {
            const material = grid[I(x, y)];
            if (material === WATER) settleWater(x, y);
            else if (material === OIL) settleOil(x, y);
          }
        } else {
          for (let x = maxX; x >= minX; x--) {
            const material = grid[I(x, y)];
            if (material === WATER) settleWater(x, y);
            else if (material === OIL) settleOil(x, y);
          }
        }
      }

      // 6) Rising materials
      for (let y = 0; y < rows; y++) {
        const minX = activeRowMin[y];
        const maxX = activeRowMax[y];
        if (maxX < minX) continue;
        const ltr = (y & 1) === 0;
        if (ltr) {
          for (let x = minX; x <= maxX; x++) {
            const material = grid[I(x, y)];
            if (material === FIRE) riseFire(x, y);
            else if (material === STEAM) riseSteam(x, y);
          }
        } else {
          for (let x = maxX; x >= minX; x--) {
            const material = grid[I(x, y)];
            if (material === FIRE) riseFire(x, y);
            else if (material === STEAM) riseSteam(x, y);
          }
        }
      }

      // 7) Flip
      const tmp = grid; grid = next; next = tmp;

      // 8) Collapse small liquid air pockets
      if ((tick & 1) === 0) {
        relaxLiquidGaps();
        sealWaterPockets();
      }

      // 9) Let buried oil bubble up through water after crowded movement claims settle
      if (tick % 3 === 0) separateLiquidsByDensity();

      // 10) Side sinks (stones unaffected)
      applySideSinks();
      perfStepMs = performance.now() - stepStart;
      return true;
    };

    const render = (full = false) => {
      if (!imageData) return;

      const renderStart = performance.now();
      const drawPixelRect = (x0, y0, x1, y1) => {
        for (let y = y0; y <= y1; y++) {
          pixels.fill(0, y * cols + x0, y * cols + x1 + 1);
        }
      };
      const clearCellGutters = (x0, y0, x1, y1) => {
        const destX = x0 * cellSize;
        const destY = y0 * cellSize;
        const destW = Math.min(canvas.width, (x1 + 1) * cellSize) - destX;
        const destH = Math.min(canvas.height, (y1 + 1) * cellSize) - destY;
        for (let x = x0; x <= x1; x++) {
          const gx = x * cellSize + cellSize - 1;
          if (gx < canvas.width) ctx.clearRect(gx, destY, 1, destH);
        }
        for (let y = y0; y <= y1; y++) {
          const gy = y * cellSize + cellSize - 1;
          if (gy < canvas.height) ctx.clearRect(destX, gy, destW, 1);
        }
      };
      const drawCell = (x, y, color) => {
        pixels[y * cols + x] = color;
      };
      const drawGridCell = (x, y) => {
        switch (grid[I(x, y)]) {
          case SAND:
            drawCell(x, y, PACKED_SAND);
            break;
          case WATER:
            drawCell(x, y, PACKED_WATER);
            break;
          case OIL:
            drawCell(x, y, PACKED_OIL);
            break;
          case STEAM:
            if (Math.random() > 0.18) drawCell(x, y, PACKED_STEAM);
            break;
          case FIRE:
            drawCell(x, y, Math.random() < 0.35 ? PACKED_FIRE_HOT : PACKED_FIRE);
            break;
          case STONE:
            drawCell(x, y, PACKED_STONE);
            break;
          case SEED:
            drawCell(x, y, PACKED_SEED);
            break;
          case WOOD:
            drawCell(x, y, PACKED_WOOD);
            break;
          case PLANT:
            drawCell(x, y, PACKED_PLANT);
            break;
          default:
            break;
        }
      };

      let pendingDirtyCount = dirtyRenderCount;
      for (let i = 0; i < dirtyNext.length; i++) {
        if (dirtyNext[i] && !dirtyRender[i]) pendingDirtyCount++;
      }
      const shouldFullRender =
        full ||
        forceFullRender ||
        pendingDirtyCount > dirtyRender.length * FULL_RENDER_DIRTY_CHUNK_RATIO;
      if (shouldFullRender) {
        pixels.fill(0);
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) drawGridCell(x, y);
        }
        cellCtx.putImageData(imageData, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(cellCanvas, 0, 0, cols, rows, 0, 0, cols * cellSize, rows * cellSize);
        clearCellGutters(0, 0, cols - 1, rows - 1);
        forceFullRender = false;
        dirtyRender.fill(0);
        dirtyRenderCount = 0;
      } else {
        for (let cy = 0; cy < chunkRows; cy++) {
          const y0 = cy * CHUNK_SIZE;
          const y1 = Math.min(rows - 1, y0 + CHUNK_SIZE - 1);
          let cx = 0;
          while (cx < chunkCols) {
            const chunkIndex = cy * chunkCols + cx;
            if (!dirtyNext[chunkIndex] && !dirtyRender[chunkIndex]) {
              cx++;
              continue;
            }
            const startCx = cx;
            while (cx + 1 < chunkCols) {
              const nextChunkIndex = cy * chunkCols + cx + 1;
              if (!dirtyNext[nextChunkIndex] && !dirtyRender[nextChunkIndex]) break;
              cx++;
            }
            const endCx = cx;
            const x0 = startCx * CHUNK_SIZE;
            const x1 = Math.min(cols - 1, (endCx + 1) * CHUNK_SIZE - 1);
            drawPixelRect(x0, y0, x1, y1);
            for (let y = y0; y <= y1; y++) {
              for (let x = x0; x <= x1; x++) drawGridCell(x, y);
            }
            const sourceW = x1 - x0 + 1;
            const sourceH = y1 - y0 + 1;
            const destX = x0 * cellSize;
            const destY = y0 * cellSize;
            const destW = Math.min(canvas.width, (x1 + 1) * cellSize) - destX;
            const destH = Math.min(canvas.height, (y1 + 1) * cellSize) - destY;
            cellCtx.putImageData(
              imageData,
              0,
              0,
              x0,
              y0,
              sourceW,
              sourceH
            );
            ctx.clearRect(destX, destY, destW, destH);
            ctx.drawImage(cellCanvas, x0, y0, sourceW, sourceH, destX, destY, destW, destH);
            clearCellGutters(x0, y0, x1, y1);
            cx++;
          }
        }
        dirtyRender.fill(0);
        dirtyRenderCount = 0;
      }

      // stone preview
      if (stoneDraft.size > 0) {
        ctx.fillStyle = STONE_PREVIEW_COLOR;
        const previewSize = cellSize;
        for (const k of stoneDraft) {
          const [x, y] = XY(k);
          ctx.fillRect(x * cellSize, y * cellSize, previewSize, previewSize);
        }
      }

      if (isDraftingSeed && seedDraftOrigin) {
        const [x0, y0] = seedDraftOrigin;
        const valid = canPlaceSeedAt(x0, y0);
        ctx.fillStyle = valid ? SEED_PREVIEW_COLOR : 'rgba(255, 80, 80, 0.24)';
        const previewSize = cellSize;
        for (let y = y0; y < y0 + SEED_SIZE; y++) {
          for (let x = x0; x < x0 + SEED_SIZE; x++) {
            ctx.fillRect(x * cellSize, y * cellSize, previewSize, previewSize);
          }
        }
      }
      perfRenderMs = performance.now() - renderStart;
    };

    if (import.meta.env?.DEV && typeof window !== 'undefined') {
      window.__sandPerf = () => ({
        stepMs: Number(perfStepMs.toFixed(2)),
        renderMs: Number(perfRenderMs.toFixed(2)),
        dirtyChunks: perfDirtyChunks,
        chunks: dirtyCurrent.length,
        rows,
        cols,
      });
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
        if (isDraftingStone && inside) {
          addDiscToDraft(Math.floor(px / cellSize), Math.floor(py / cellSize), STONE_BRUSH_RADIUS);
        }
        if (isDraftingSeed && inside) {
          seedDraftOrigin = getSeedOrigin(Math.floor(px / cellSize), Math.floor(py / cellSize));
        }

        emitAtPointer(now);
        applyEmitters(now);
        const didStep = step();
        const hasDraftPreview = stoneDraft.size > 0 || isDraftingSeed;
        if (didStep || hasDraftPreview) render(hasDraftPreview);
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
    };
  }, []); // IMPORTANT: single mount

  const toolButtons = [
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
  ];

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
      default:
        return null;
    }
  };

  // IMPORTANT: make UI a sibling of the canvas wrapper so it can sit ABOVE page content.
return (
  // Overlay container sits ABOVE section content but stays scoped to the section bounds
  <div className="absolute inset-0 z-[60] pointer-events-none">
    {/* Simulation layer (kept behind content) */}
    <div ref={wrapRef} className="absolute inset-0 z-0">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        aria-hidden="true"
      />
    </div>

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
      <div className={`flex ${uiAtBottom ? 'flex-col items-center' : 'flex-col'} gap-2`}>
        <div className={`${uiAtBottom ? 'grid grid-cols-3 grid-rows-2' : 'flex flex-col'} gap-2 ${drawModeOn ? '' : 'opacity-45'}`}>
          {toolButtons.map(({ id, title, activeClass, idleClass }) => {
            const active = selectedTool === id;
            return (
              <button
                key={id}
                onClick={() => setSelectedTool(id)}
                className={`w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-md flex items-center justify-center transition ring-1
                  ${active
                    ? `${activeClass} shadow-md`
                    : `bg-gray-700/30 hover:bg-gray-700/50 ring-white/10 ${idleClass}`
                }`}
                title={title}
              >
                {renderToolMark(id)}
              </button>
            );
          })}
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

        {!uiAtBottom && (
          <div className="hidden sm:block text-[10px] text-gray-300 mt-1 leading-tight">
            RMB=erase
          </div>
        )}
      </div>
    </div>
  </div>
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
            <div className="w-full h-full bg-gray-900/80 rounded-xl p-4 sm:p-5 shadow-lg ring-1 ring-white/15 overflow-hidden min-h-[360px] flex">
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
            <div className="w-full h-full bg-gray-900/80 rounded-xl p-4 sm:p-5 shadow-lg ring-1 ring-white/15 overflow-hidden min-h-[360px] flex">
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
