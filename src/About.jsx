import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* -------------------- SAND OVERLAY -------------------- */
function SandOverlay({ onDrawModeChange }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const uiRef = useRef(null);

  // UI state
  const [selectedTool, setSelectedTool] = useState('sand'); // 'sand' | 'water' | 'stone' | 'oil' | 'fire'
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

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // ---- Tunables ----
    const CELL_PX = 5;
    const SAND_BRUSH_RADIUS = 2;
    const WATER_BRUSH_RADIUS = 2;
    const STONE_BRUSH_RADIUS = 2;
    const OIL_BRUSH_RADIUS = 2;
    const FIRE_BRUSH_RADIUS = 1;
    const ERASE_BRUSH_RADIUS = 3;
    const EMIT_INTERVAL_MS = 18;
    const STEP_MS = 1;
    const MAX_WATER_FLOW = 10;
    const STEAM_DECAY_P = 0.018;
    const FIRE_DECAY_P = 0.006;
    const OIL_IGNITE_P = 0.25;
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
    const STONE_PREVIEW_COLOR = 'rgba(160,160,170,0.40)';

    // Side-sink settings (bottom is NOT a sink)
    const SINK_STRIP_W = 2;
    const INNER_STRIP_W = 1;
    const SINK_WATER_P = 0.85;
    const SINK_SAND_P  = 0.35;
    const INNER_WATER_P = 0.35;
    const INNER_SAND_P  = 0.10;

    // Emitters (normalized positions) + buffers
    const emitterDefs = [
      { type: 'sand',  rateMs: 120, pos: { x: 0.12, y: 0.14 }, r: 2 },
      { type: 'water', rateMs:  90, pos: { x: 0.88, y: 0.14 }, r: 2 },
    ];
    const EMITTER_EDGE_BUFFER = 3; // cells from side
    const EMITTER_TOP_BUFFER  = 3; // cells from top
    const CHUNK_SIZE = 64;
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
    let activeRowMin = new Int32Array(0);
    let activeRowMax = new Int32Array(0);
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

    // Stone components (rigid bodies)
    /** @type {Array<{id:number,cells:Set<number>,yMax:number}>} */
    let stoneComponents = [];
    let nextStoneId = 1;

    // Drafting state for stone (while holding LMB)
    let isDraftingStone = false;
    /** @type {Set<number>} */
    let stoneDraft = new Set();

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
    };

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
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
      for (let cy = r0; cy <= r1; cy++) {
        const row = cy * chunkCols;
        for (let cx = c0; cx <= c1; cx++) target[row + cx] = 1;
      }
    };
    const markDirtyIndex = (k, target = dirtyNext) => {
      const x = k % cols;
      const y = Math.floor(k / cols);
      markDirtyRect(x, y, x, y, target);
    };
    const markAllDirty = (target = dirtyCurrent) => {
      if (target.length) target.fill(1);
    };
    const buildActiveRows = () => {
      activeRowMin.fill(cols);
      activeRowMax.fill(-1);

      let hasActive = false;
      for (let cy = 0; cy < chunkRows; cy++) {
        const y0 = cy * CHUNK_SIZE;
        const y1 = Math.min(rows - 1, y0 + CHUNK_SIZE - 1);
        for (let cx = 0; cx < chunkCols; cx++) {
          if (!dirtyCurrent[cy * chunkCols + cx]) continue;
          hasActive = true;
          const x0 = cx * CHUNK_SIZE;
          const x1 = Math.min(cols - 1, x0 + CHUNK_SIZE - 1);
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
        if (dirtyNext[i]) dirtyCurrent[i] = 1;
        dirtyNext[i] = 0;
      }
      const hasActive = buildActiveRows();
      dirtyCurrent.fill(0);
      return hasActive;
    };
    const prepareNextBuffer = () => {
      next.fill(0);
      for (let y = 0; y < rows; y++) {
        const rowStart = y * cols;
        const rowEnd = rowStart + cols;
        const minX = activeRowMin[y];
        const maxX = activeRowMax[y];
        if (maxX < minX) {
          next.set(grid.subarray(rowStart, rowEnd), rowStart);
          continue;
        }
        if (minX > 0) next.set(grid.subarray(rowStart, rowStart + minX), rowStart);
        if (maxX < cols - 1) {
          next.set(grid.subarray(rowStart + maxX + 1, rowEnd), rowStart + maxX + 1);
        }
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
      imageData = ctx.createImageData(canvas.width, canvas.height);
      pixels = new Uint32Array(imageData.data.buffer);

      // Decide UI placement based on available horizontal space
      setUiAtBottom(width < TOOL_COLLAPSE_W);

      cellSize = CELL_PX;
      cols = Math.max(60, Math.floor(width / cellSize));
      rows = Math.max(28, Math.floor(height / cellSize));

      gridA = new Uint8Array(cols * rows);
      gridB = new Uint8Array(cols * rows);
      grid = gridA; next = gridB;
      chunkCols = Math.ceil(cols / CHUNK_SIZE);
      chunkRows = Math.ceil(rows / CHUNK_SIZE);
      dirtyCurrent = new Uint8Array(chunkCols * chunkRows);
      dirtyNext = new Uint8Array(chunkCols * chunkRows);
      activeRowMin = new Int32Array(rows);
      activeRowMax = new Int32Array(rows);

      stoneComponents = [];
      nextStoneId = 1;
      stoneDraft.clear();

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
    };
    const onTouchMove = (e) => {
      if (!drawModeOnRef.current) return;
      if (!e.touches || e.touches.length === 0) return;
      const t = e.touches[0];
      updatePointer(t.clientX, t.clientY);
      if (isDraftingStone && inside) {
        addDiscToDraft(Math.floor(px / cellSize), Math.floor(py / cellSize), STONE_BRUSH_RADIUS);
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
        const nks = [I(x+1,y), I(x-1,y), I(x,y+1), I(x,y-1)]
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
              const neigh = [I(x+1,y), I(x-1,y), I(x,y+1), I(x,y-1)];
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

    // Sand physics
    const settleSand = (x, y) => {
      const k = I(x, y);
      if (grid[k] !== SAND) return;

      if (y + 1 < rows && grid[I(x, y + 1)] === EMPTY && next[I(x, y + 1)] === EMPTY) {
        writeNextIndex(I(x, y + 1), SAND); return;
      }
      if (y + 1 < rows && grid[I(x, y + 1)] === WATER && next[I(x, y + 1)] === EMPTY) {
        writeNextIndex(I(x, y + 1), SAND);
        if (next[k] === EMPTY) writeNextIndex(k, WATER);
        return;
      }
      if (y + 1 < rows && grid[I(x, y + 1)] === OIL && next[I(x, y + 1)] === EMPTY) {
        writeNextIndex(I(x, y + 1), SAND);
        if (next[k] === EMPTY) writeNextIndex(k, OIL);
        return;
      }

      const leftFirst = Math.random() < 0.5;
      const tryDiag = (dx) => {
        const nx = x + dx, ny = y + 1;
        if (nx <= 0 || nx >= cols - 1 || ny >= rows) return false;
        const ik = I(nx, ny);
        if (grid[ik] === EMPTY && next[ik] === EMPTY) { writeNextIndex(ik, SAND); return true; }
        if (grid[ik] === WATER && next[ik] === EMPTY) {
          writeNextIndex(ik, SAND); if (next[k] === EMPTY) writeNextIndex(k, WATER); return true;
        }
        if (grid[ik] === OIL && next[ik] === EMPTY) {
          writeNextIndex(ik, SAND); if (next[k] === EMPTY) writeNextIndex(k, OIL); return true;
        }
        return false;
      };
      if ((leftFirst && tryDiag(-1)) || (!leftFirst && tryDiag(1)) || tryDiag(-1) || tryDiag(1)) return;

      if (next[k] === EMPTY) writeNextIndex(k, SAND);
    };

    // Water physics
    const settleWater = (x, y) => {
      const k = I(x, y);
      if (grid[k] !== WATER) return;
      if (next[k] !== EMPTY) return;

      if (y + 1 < rows && grid[I(x, y + 1)] === EMPTY && next[I(x, y + 1)] === EMPTY) {
        writeNextIndex(I(x, y + 1), WATER); return;
      }
      if (y + 1 < rows && grid[I(x, y + 1)] === OIL && next[I(x, y + 1)] === EMPTY) {
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

      const findFlowDir = () => {
        const dirPref = Math.random() < 0.5 ? DIRS_RIGHT_FIRST : DIRS_LEFT_FIRST;
        for (const sgn of dirPref) {
          for (let d = 1; d <= MAX_WATER_FLOW; d++) {
            const nx = x + sgn * d;
            if (nx <= 0 || nx >= cols - 1) break;
            if (!canWaterEnter(nx, y)) break;
            if (y + 1 < rows && canWaterEnter(nx, y + 1)) {
              const stepX = x + sgn;
              if (canWaterEnter(stepX, y)) return sgn;
            }
          }
        }
        return 0;
      };

      const flow = findFlowDir();
      if (flow !== 0) {
        const stepX = x + flow;
        if (canWaterEnter(stepX, y)) { moveWaterInto(k, stepX, y); return; }
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

      if (y - 1 > 0 && grid[I(x, y - 1)] === WATER && next[I(x, y - 1)] === EMPTY) {
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

      if (y + 1 < rows && grid[I(x, y + 1)] === EMPTY && next[I(x, y + 1)] === EMPTY) {
        writeNextIndex(I(x, y + 1), OIL); return;
      }

      const dirs = Math.random() < 0.5 ? DIRS_LEFT_FIRST : DIRS_RIGHT_FIRST;
      for (const dx of dirs) {
        const nx = x + dx, ny = y + 1;
        if (nx <= 0 || nx >= cols - 1 || ny >= rows) continue;
        const ik = I(nx, ny);
        if (grid[ik] === EMPTY && next[ik] === EMPTY && grid[I(x, y + 1)] !== WATER) { writeNextIndex(ik, OIL); return; }
      }

      const findFlowDir = () => {
        const dirPref = Math.random() < 0.5 ? DIRS_RIGHT_FIRST : DIRS_LEFT_FIRST;
        for (const sgn of dirPref) {
          for (let d = 1; d <= MAX_WATER_FLOW; d++) {
            const nx = x + sgn * d;
            if (nx <= 0 || nx >= cols - 1) break;
            if (grid[I(nx, y)] !== EMPTY || next[I(nx, y)] !== EMPTY) break;
            const below = y + 1 < rows ? grid[I(nx, y + 1)] : STONE;
            if (below === EMPTY) {
              const stepX = x + sgn;
              if (grid[I(stepX, y)] === EMPTY && next[I(stepX, y)] === EMPTY) return sgn;
            }
          }
        }
        return 0;
      };

      const flow = findFlowDir();
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
      const toSteam = new Set();
      const extinguishedFires = new Set();
      const toFire = new Set();

      for (let y = 1; y < rows - 1; y++) {
        const minX = Math.max(1, activeRowMin[y]);
        const maxX = Math.min(cols - 2, activeRowMax[y]);
        if (maxX < minX) continue;
        for (let x = minX; x <= maxX; x++) {
          const k = I(x, y);
          if (grid[k] !== WATER) continue;

          for (const [nx, ny] of neighbors4(x, y)) {
            const nk = I(nx, ny);
            if (grid[nk] === FIRE) {
              toSteam.add(k);
              extinguishedFires.add(nk);
              break;
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
          if (grid[k] !== FIRE || extinguishedFires.has(k)) continue;

          for (const [nx, ny] of neighbors4(x, y)) {
            const nk = I(nx, ny);
            if (grid[nk] === OIL) {
              if (Math.random() > OIL_IGNITE_P) continue;
              toFire.add(nk);
              if (Math.random() < FIRE_SPREAD_P) {
                for (const [ox, oy] of neighbors4(nx, ny)) {
                  const ok = I(ox, oy);
                  if (grid[ok] === OIL && Math.random() < 0.12) toFire.add(ok);
                }
              }
            }
          }
        }
      }

      for (const k of extinguishedFires) if (grid[k] === FIRE) writeGridIndex(k, EMPTY);
      for (const k of toSteam) if (grid[k] === WATER) writeGridIndex(k, STEAM);
      for (const k of toFire) if (grid[k] === OIL) writeGridIndex(k, FIRE);
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
          else if (m === SAND) { if (Math.random() < SINK_SAND_P) writeGridIndex(k, EMPTY); }
        }
        for (let x = rightStart; x <= rightEnd; x++) {
          const k = I(x, y);
          const m = grid[k];
          if (m === WATER) { if (Math.random() < SINK_WATER_P) writeGridIndex(k, EMPTY); }
          else if (m === SAND) { if (Math.random() < SINK_SAND_P) writeGridIndex(k, EMPTY); }
        }

        // gentle inner relief (helps sand/water reach the sink)
        for (let x = innerLeftStart; x <= innerLeftEnd; x++) {
          const k = I(x, y);
          const m = grid[k];
          if (m === WATER) { if (Math.random() < INNER_WATER_P) writeGridIndex(k, EMPTY); }
          else if (m === SAND) { if (Math.random() < INNER_SAND_P) writeGridIndex(k, EMPTY); }
        }
        for (let x = innerRightStart; x <= innerRightEnd; x++) {
          const k = I(x, y);
          const m = grid[k];
          if (m === WATER) { if (Math.random() < INNER_WATER_P) writeGridIndex(k, EMPTY); }
          else if (m === SAND) { if (Math.random() < INNER_SAND_P) writeGridIndex(k, EMPTY); }
        }
      }
    };

    // Physics step
    const step = () => {
      if (!beginStepDirty()) return false;

      // 1) Move rigid stones first, directly on grid
      moveStoneComponentsDown();

      // 2) Apply material reactions directly on grid
      applyReactions();

      // 3) Prepare next buffer & carry stones forward
      prepareNextBuffer();
      for (const comp of stoneComponents) {
        for (const k of comp.cells) next[k] = STONE;
      }

      // 4) Sand settle
      for (let y = rows - 1; y >= 0; y--) {
        const minX = activeRowMin[y];
        const maxX = activeRowMax[y];
        if (maxX < minX) continue;
        const ltr = (y & 1) === 0;
        if (ltr) { for (let x = minX; x <= maxX; x++) settleSand(x, y); }
        else     { for (let x = maxX; x >= minX; x--) settleSand(x, y); }
      }

      // 5) Water settle
      for (let y = rows - 1; y >= 0; y--) {
        const minX = activeRowMin[y];
        const maxX = activeRowMax[y];
        if (maxX < minX) continue;
        const ltr = (y & 1) === 0;
        if (ltr) { for (let x = minX; x <= maxX; x++) settleWater(x, y); }
        else     { for (let x = maxX; x >= minX; x--) settleWater(x, y); }
      }

      // 6) Oil settle
      for (let y = rows - 1; y >= 0; y--) {
        const minX = activeRowMin[y];
        const maxX = activeRowMax[y];
        if (maxX < minX) continue;
        const ltr = (y & 1) === 0;
        if (ltr) { for (let x = minX; x <= maxX; x++) settleOil(x, y); }
        else     { for (let x = maxX; x >= minX; x--) settleOil(x, y); }
      }

      // 7) Fire rise
      for (let y = 0; y < rows; y++) {
        const minX = activeRowMin[y];
        const maxX = activeRowMax[y];
        if (maxX < minX) continue;
        const ltr = (y & 1) === 0;
        if (ltr) { for (let x = minX; x <= maxX; x++) riseFire(x, y); }
        else     { for (let x = maxX; x >= minX; x--) riseFire(x, y); }
      }

      // 8) Steam rise
      for (let y = 0; y < rows; y++) {
        const minX = activeRowMin[y];
        const maxX = activeRowMax[y];
        if (maxX < minX) continue;
        const ltr = (y & 1) === 0;
        if (ltr) { for (let x = minX; x <= maxX; x++) riseSteam(x, y); }
        else     { for (let x = maxX; x >= minX; x--) riseSteam(x, y); }
      }

      // 9) Flip
      const tmp = grid; grid = next; next = tmp;

      // 10) Collapse small liquid air pockets
      relaxLiquidGaps();
      sealWaterPockets();

      // 11) Let buried oil bubble up through water after crowded movement claims settle
      separateLiquidsByDensity();

      // 12) Side sinks (stones unaffected)
      applySideSinks();
      return true;
    };

    const render = () => {
      if (!imageData) return;
      pixels.fill(0);

      const canvasWidth = canvas.width;
      const drawSize = cellSize - 1;
      const drawCell = (x, y, color) => {
        const startX = x * cellSize;
        const startY = y * cellSize;
        const endX = Math.min(canvasWidth, startX + drawSize);
        const endY = Math.min(canvas.height, startY + drawSize);
        for (let py = startY; py < endY; py++) {
          pixels.fill(color, py * canvasWidth + startX, py * canvasWidth + endX);
        }
      };

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
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
            default:
              break;
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);

      // stone preview
      if (stoneDraft.size > 0) {
        ctx.fillStyle = STONE_PREVIEW_COLOR;
        const previewSize = cellSize - 1;
        for (const k of stoneDraft) {
          const [x, y] = XY(k);
          ctx.fillRect(x * cellSize, y * cellSize, previewSize, previewSize);
        }
      }
    };

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

        emitAtPointer(now);
        applyEmitters(now);
        const didStep = step();
        if (didStep || stoneDraft.size > 0) render();
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
      } z-[70] bg-gray-900/30 rounded-lg p-2 backdrop-blur-sm shadow-lg pointer-events-auto`}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className={`flex ${uiAtBottom ? 'flex-row items-center' : 'flex-col'} gap-2`}>
        <div className={`flex ${uiAtBottom ? 'flex-row' : 'flex-col'} gap-2 ${drawModeOn ? '' : 'opacity-45'}`}>
          <button
    onClick={() => setSelectedTool('sand')}
    className={`w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-md flex items-center justify-center transition
      ${selectedTool === 'sand'
        ? 'bg-yellow-600/55 ring-1 ring-yellow-300/30 shadow-lg scale-105'
        : 'bg-gray-700/35 hover:bg-gray-700/55 ring-1 ring-white/10'
      }`}
    title="Sand (hold LMB)"
  >
    <div className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 bg-yellow-400/70 rounded-sm" />
      </button>

      <button
        onClick={() => setSelectedTool('water')}
        className={`w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-md flex items-center justify-center transition
          ${selectedTool === 'water'
            ? 'bg-blue-600/55 ring-1 ring-blue-300/30 shadow-lg scale-105'
            : 'bg-gray-700/35 hover:bg-gray-700/55 ring-1 ring-white/10'
          }`}
        title="Water (hold LMB)"
      >
        <div className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 bg-blue-400/70 rounded-full" />
      </button>

      <button
        onClick={() => setSelectedTool('oil')}
        className={`w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-md flex items-center justify-center transition
          ${selectedTool === 'oil'
            ? 'bg-amber-900/65 ring-1 ring-amber-300/30 shadow-lg scale-105'
            : 'bg-gray-700/35 hover:bg-gray-700/55 ring-1 ring-white/10'
          }`}
        title="Oil (hold LMB)"
      >
        <div className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 bg-amber-950/80 rounded-full" />
      </button>

      <button
        onClick={() => setSelectedTool('fire')}
        className={`w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-md flex items-center justify-center transition
          ${selectedTool === 'fire'
            ? 'bg-orange-600/60 ring-1 ring-orange-200/35 shadow-lg scale-105'
            : 'bg-gray-700/35 hover:bg-gray-700/55 ring-1 ring-white/10'
          }`}
        title="Fire (hold LMB)"
      >
        <div className="h-5 w-4 sm:h-6 sm:w-5 md:h-7 md:w-5 rounded-full bg-orange-400/85 shadow-[0_0_10px_rgba(251,146,60,0.45)]" />
      </button>

      <button
        onClick={() => setSelectedTool('stone')}
        className={`w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-md flex items-center justify-center transition
          ${selectedTool === 'stone'
            ? 'bg-gray-600/55 ring-1 ring-white/20 shadow-lg scale-105'
            : 'bg-gray-700/35 hover:bg-gray-700/55 ring-1 ring-white/10'
          }`}
        title="Stone (hold to draft, release to drop)"
      >
        <div className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 bg-gray-400/75 rounded-[3px]" />
      </button>
        </div>

        {/* Toggles */}
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
