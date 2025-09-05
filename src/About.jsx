import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* -------------------- SAND OVERLAY -------------------- */
function SandOverlay() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const uiRef = useRef(null);

  // UI state
  const [selectedTool, setSelectedTool] = useState('sand'); // 'sand' | 'water' | 'stone'
  const [emittersOn, setEmittersOn] = useState(true);
  const [sinksOn, setSinksOn] = useState(true);
  const [uiAtBottom, setUiAtBottom] = useState(false); // auto-place toolbar when cramped

  // Refs read by the simulation loop
  const toolRef = useRef('sand');
  const emittersOnRef = useRef(true);
  const sinksOnRef = useRef(true);
  const overrideToolRef = useRef(null); // 'eraser' while RMB held

  useEffect(() => { toolRef.current = selectedTool; }, [selectedTool]);
  useEffect(() => { emittersOnRef.current = emittersOn; }, [emittersOn]);
  useEffect(() => { sinksOnRef.current = sinksOn; }, [sinksOn]);

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
    const ERASE_BRUSH_RADIUS = 3;
    const EMIT_INTERVAL_MS = 18;
    const STEP_MS = 1;
    const MAX_WATER_FLOW = 10;
    const TOOL_COLLAPSE_W = 1300; // px: move toolbar to bottom if wrapper width < this

    // Colors
    const SAND_COLOR = 'rgba(230, 200, 120, 0.475)';
    const WATER_COLOR = 'rgba(120, 170, 255, 0.40)';
    const STONE_COLOR = 'rgba(140, 140, 150, 0.70)';
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

    // Materials
    const EMPTY = 0;
    const SAND = 1;
    const WATER = 2;
    const STONE = 3;

    // Grid
    let cols = 0, rows = 0, cellSize = CELL_PX;
    let gridA = new Uint8Array(0);
    let gridB = new Uint8Array(0);
    let grid = gridA, next = gridB;
    const I = (x, y) => y * cols + x;
    const XY = (k) => [k % cols, Math.floor(k / cols)];

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

    const fit = () => {
      const { width, height } = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.max(300, Math.floor(width * dpr));
      canvas.height = Math.max(200, Math.floor(height * dpr));
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Decide UI placement based on available horizontal space
      setUiAtBottom(width < TOOL_COLLAPSE_W);

      cellSize = CELL_PX;
      cols = Math.max(60, Math.floor(width / cellSize));
      rows = Math.max(28, Math.floor(height / cellSize));

      gridA = new Uint8Array(cols * rows);
      gridB = new Uint8Array(cols * rows);
      grid = gridA; next = gridB;

      stoneComponents = [];
      nextStoneId = 1;
      stoneDraft.clear();

      seedInitialSand();

      // Prepare emitters with edge/top buffers
      emitters = emitterDefs.map(e => {
        const rawX = Math.floor(e.pos.x * cols);
        const rawY = Math.floor(e.pos.y * rows);
        const gx = clamp(rawX, 1 + EMITTER_EDGE_BUFFER, cols - 2 - EMITTER_EDGE_BUFFER);
        const gy = clamp(rawY, 1 + EMITTER_TOP_BUFFER,  rows - 2 - EMITTER_EDGE_BUFFER);
        return { ...e, gx, gy, last: 0 };
      });

      ctx.clearRect(0, 0, width, height);
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);

    // Pointer helpers
    const updatePointer = (cx, cy) => {
      clientX = cx; clientY = cy;
      const r = wrap.getBoundingClientRect();
      inside = cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
      px = cx - r.left;
      py = cy - r.top;
    };

    // Global listeners so canvas can stay pointer-events:none
    const onPointerMove = (e) => {
      updatePointer(e.clientX, e.clientY);
      if (e.buttons === 0) {
        overrideToolRef.current = null;
        lmbDown = false;
      }
      if (isDraftingStone && inside) {
        addDiscToDraft(Math.floor(px / cellSize), Math.floor(py / cellSize), STONE_BRUSH_RADIUS);
      }
    };
    const onTouchMove = (e) => {
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
      if (inside && !overUI) e.preventDefault();
    };

    const onScroll = () => {
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
      for (let oy = -radius; oy <= radius; oy++) {
        const yy = cy + oy;
        if (yy <= 0 || yy >= rows - 1) continue;
        for (let ox = -radius; ox <= radius; ox++) {
          if (ox * ox + oy * oy > radius * radius) continue;
          const xx = cx + ox;
          if (xx <= 0 || xx >= cols - 1) continue;
          const k = I(xx, yy);
          if (grid[k] === EMPTY) stoneDraft.add(k);
        }
      }
    }

    function finalizeStoneDraft() {
      if (stoneDraft.size === 0) return;

      const cells = new Set();
      let yMax = 0;

      for (const k of stoneDraft) {
        if (grid[k] === EMPTY) {
          grid[k] = STONE;
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
      for (let oy = -radius; oy <= radius; oy++) {
        const yy = cy + oy;
        if (yy <= 0 || yy >= rows - 1) continue;
        for (let ox = -radius; ox <= radius; ox++) {
          if (ox * ox + oy * oy > radius * radius) continue;
          const xx = cx + ox;
          if (xx <= 0 || xx >= cols - 1) continue;
          const k = I(xx, yy);
          if (overwrite || grid[k] === EMPTY) grid[k] = material;
        }
      }
    };

    const eraseDisc = (cx, cy, radius) => {
      const erasedStoneCells = [];
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
          }
          if (stoneDraft.has(k)) stoneDraft.delete(k);
        }
      }
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

      // Paint only while LMB is down (or RMB for eraser)
      const shouldEmit =
        rmbHeld ? true :
        (activeTool === 'sand' || activeTool === 'water') ? lmbDown : false;

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
          if (mat !== EMPTY && mat !== WATER) { canMove = false; break; }
        }
        if (!canMove) continue;

        // Track water to bubble up
        const waterSwaps = [];
        for (const k of comp.cells) {
          const [x, y] = XY(k);
          const belowK = I(x, y + 1);
          if (!comp.cells.has(belowK) && grid[belowK] === WATER) {
            waterSwaps.push([belowK, k]); // [waterIndexBelow, stoneOriginIndex]
          }
        }

        // Clear old stones
        for (const k of comp.cells) grid[k] = EMPTY;

        // Bubble water up into vacated cells
        for (const [waterIdx, originIdx] of waterSwaps) {
          grid[originIdx] = WATER;
        }

        // Move stones down
        const newCells = new Set();
        for (const k of comp.cells) {
          const [x, y] = XY(k);
          const nk = I(x, y + 1);
          newCells.add(nk);
        }
        for (const nk of newCells) grid[nk] = STONE;

        comp.cells = newCells;
        comp.yMax = Math.min(rows - 1, comp.yMax + 1);
      }
    }

    // Sand physics
    const settleSand = (x, y) => {
      const k = I(x, y);
      if (grid[k] !== SAND) return;

      if (y + 1 < rows && grid[I(x, y + 1)] === EMPTY && next[I(x, y + 1)] === EMPTY) {
        next[I(x, y + 1)] = SAND; return;
      }
      if (y + 1 < rows && grid[I(x, y + 1)] === WATER && next[I(x, y + 1)] === EMPTY) {
        next[I(x, y + 1)] = SAND;
        if (next[k] === EMPTY) next[k] = WATER;
        return;
      }

      const leftFirst = Math.random() < 0.5;
      const tryDiag = (dx) => {
        const nx = x + dx, ny = y + 1;
        if (nx <= 0 || nx >= cols - 1 || ny >= rows) return false;
        const ik = I(nx, ny);
        if (grid[ik] === EMPTY && next[ik] === EMPTY) { next[ik] = SAND; return true; }
        if (grid[ik] === WATER && next[ik] === EMPTY) {
          next[ik] = SAND; if (next[k] === EMPTY) next[k] = WATER; return true;
        }
        return false;
      };
      if ((leftFirst && tryDiag(-1)) || (!leftFirst && tryDiag(1)) || tryDiag(-1) || tryDiag(1)) return;

      if (next[k] === EMPTY) next[k] = SAND;
    };

    // Water physics
    const settleWater = (x, y) => {
      const k = I(x, y);
      if (grid[k] !== WATER) return;
      if (next[k] !== EMPTY) return;

      if (y + 1 < rows && grid[I(x, y + 1)] === EMPTY && next[I(x, y + 1)] === EMPTY) {
        next[I(x, y + 1)] = WATER; return;
      }

      const dirs = Math.random() < 0.5 ? [-1, 1] : [1, -1];
      for (const dx of dirs) {
        const nx = x + dx, ny = y + 1;
        if (nx <= 0 || nx >= cols - 1 || ny >= rows) continue;
        const ik = I(nx, ny);
        if (grid[ik] === EMPTY && next[ik] === EMPTY) { next[ik] = WATER; return; }
      }

      const findFlowDir = () => {
        const dirPref = Math.random() < 0.5 ? [1, -1] : [-1, 1];
        for (const sgn of dirPref) {
          for (let d = 1; d <= MAX_WATER_FLOW; d++) {
            const nx = x + sgn * d;
            if (nx <= 0 || nx >= cols - 1) break;
            if (grid[I(nx, y)] !== EMPTY || next[I(nx, y)] !== EMPTY) break;
            if (y + 1 < rows && grid[I(nx, y + 1)] === EMPTY && next[I(nx, y + 1)] === EMPTY) {
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
        if (emptyAt(stepX, y)) { next[I(stepX, y)] = WATER; return; }
      }

      const jiggle = Math.random() < 0.5 ? -1 : 1;
      if (emptyAt(x + jiggle, y)) { next[I(x + jiggle, y)] = WATER; return; }

      if (next[k] === EMPTY) next[k] = WATER;
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
          if (m === WATER) { if (Math.random() < SINK_WATER_P) grid[k] = EMPTY; }
          else if (m === SAND) { if (Math.random() < SINK_SAND_P) grid[k] = EMPTY; }
        }
        for (let x = rightStart; x <= rightEnd; x++) {
          const k = I(x, y);
          const m = grid[k];
          if (m === WATER) { if (Math.random() < SINK_WATER_P) grid[k] = EMPTY; }
          else if (m === SAND) { if (Math.random() < SINK_SAND_P) grid[k] = EMPTY; }
        }

        // gentle inner relief (helps sand/water reach the sink)
        for (let x = innerLeftStart; x <= innerLeftEnd; x++) {
          const k = I(x, y);
          const m = grid[k];
          if (m === WATER) { if (Math.random() < INNER_WATER_P) grid[k] = EMPTY; }
          else if (m === SAND) { if (Math.random() < INNER_SAND_P) grid[k] = EMPTY; }
        }
        for (let x = innerRightStart; x <= innerRightEnd; x++) {
          const k = I(x, y);
          const m = grid[k];
          if (m === WATER) { if (Math.random() < INNER_WATER_P) grid[k] = EMPTY; }
          else if (m === SAND) { if (Math.random() < INNER_SAND_P) grid[k] = EMPTY; }
        }
      }
    };

    // Physics step
    const step = () => {
      // 1) Move rigid stones first, directly on grid
      moveStoneComponentsDown();

      // 2) Prepare next buffer & carry stones forward
      next.fill(0);
      for (let k = 0; k < grid.length; k++) {
        if (grid[k] === STONE) next[k] = STONE;
      }

      // 3) Sand settle
      for (let y = rows - 1; y >= 0; y--) {
        const ltr = (y & 1) === 0;
        if (ltr) { for (let x = 0; x < cols; x++) settleSand(x, y); }
        else     { for (let x = cols - 1; x >= 0; x--) settleSand(x, y); }
      }

      // 4) Water settle
      for (let y = rows - 1; y >= 0; y--) {
        const ltr = (y & 1) === 0;
        if (ltr) { for (let x = 0; x < cols; x++) settleWater(x, y); }
        else     { for (let x = cols - 1; x >= 0; x--) settleWater(x, y); }
      }

      // 5) Flip
      const tmp = grid; grid = next; next = tmp;

      // 6) Side sinks (stones unaffected)
      applySideSinks();
    };

    const render = () => {
      const { width, height } = wrap.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);

      // sand
      ctx.fillStyle = SAND_COLOR;
      for (let y = 0; y < rows; y++) {
        const yy = y * cellSize;
        for (let x = 0; x < cols; x++) {
          if (grid[I(x, y)] === SAND) ctx.fillRect(x * cellSize, yy, cellSize - 1, cellSize - 1);
        }
      }
      // water
      ctx.fillStyle = WATER_COLOR;
      for (let y = 0; y < rows; y++) {
        const yy = y * cellSize;
        for (let x = 0; x < cols; x++) {
          if (grid[I(x, y)] === WATER) ctx.fillRect(x * cellSize, yy, cellSize - 1, cellSize - 1);
        }
      }
      // stone
      ctx.fillStyle = STONE_COLOR;
      for (let y = 0; y < rows; y++) {
        const yy = y * cellSize;
        for (let x = 0; x < cols; x++) {
          if (grid[I(x, y)] === STONE) ctx.fillRect(x * cellSize, yy, cellSize - 1, cellSize - 1);
        }
      }
      // stone preview
      if (stoneDraft.size > 0) {
        ctx.fillStyle = STONE_PREVIEW_COLOR;
        for (const k of stoneDraft) {
          const [x, y] = XY(k);
          ctx.fillRect(x * cellSize, y * cellSize, cellSize - 1, cellSize - 1);
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
        const r = wrap.getBoundingClientRect();
        inside = clientX >= r.left && clientX <= r.right && clientY <= r.bottom && clientY >= r.top;
        px = clientX - r.left; py = clientY - r.top;
      }

      if (now - lastStep >= STEP_MS) {
        if (isDraftingStone && inside) {
          addDiscToDraft(Math.floor(px / cellSize), Math.floor(py / cellSize), STONE_BRUSH_RADIUS);
        }

        emitAtPointer(now);
        applyEmitters(now);
        step();
        render();
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
        <div className={`flex ${uiAtBottom ? 'flex-row' : 'flex-col'} gap-2`}>
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
  return (
    <section className="relative bg-dark">
      {/* Content */}
      <div className="relative z-[1] mx-auto max-w-6xl px-4 sm:px-6 pt-12 sm:pt-28 pb-48">
        <h2 className="text-white font-bold tracking-tight text-center text-3xl sm:text-5xl md:text-6xl">
          SKILLS & <br className="hidden sm:block" /> EXPERIENCE
        </h2>

        {/* Cards: stacked on mobile, side-by-side on md+; equal height & width */}
        <div className="mt-6 md:mt-16">
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
      <SandOverlay />
    </section>
  );
}
