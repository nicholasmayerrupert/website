import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Lottie from 'react-lottie';
import animationData from './laptop.json';

// Lottie that scales to its container (keeps a square)
function ResponsiveLottie({ animationData }) {
  const containerRef = useRef(null);
  const [size, setSize] = useState(320);
  const prefersReducedMotion = usePrefersReducedMotion();

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => {
      const w = el.getBoundingClientRect().width || 320;
      const clamped = Math.max(200, Math.min(560, Math.floor(w)));
      setSize(clamped);
    };
    update();

    let ro;
    if ('ResizeObserver' in window) {
      ro = new ResizeObserver(update);
      ro.observe(el);
    } else {
      window.addEventListener('resize', update);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', update);
    };
  }, []);

  return (
    <div ref={containerRef} className="w-full aspect-square">
      <Lottie
        options={{
          loop: !prefersReducedMotion,
          autoplay: !prefersReducedMotion,
          animationData,
          rendererSettings: { preserveAspectRatio: 'xMidYMid slice' },
        }}
        height={size}
        width={size}
        isClickToPauseDisabled
      />
    </div>
  );
}

// Respect the user's reduced-motion setting
function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mq.matches);
    const handler = () => setPrefersReducedMotion(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else mq.removeListener(handler);
    };
  }, []);
  return prefersReducedMotion;
}

function SandOverlay() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const uiRef = useRef(null);

  // UI state
  const [selectedTool, setSelectedTool] = useState('sand'); // 'sand' | 'water' | 'eraser' | 'stone'
  const [isDrawing, setIsDrawing] = useState(true);

  // Refs read by the simulation loop
  const toolRef = useRef('sand');
  const isDrawingRef = useRef(true);
  const overrideToolRef = useRef(null); // 'eraser' while RMB held

  useEffect(() => { toolRef.current = selectedTool; }, [selectedTool]);
  useEffect(() => { isDrawingRef.current = isDrawing; }, [isDrawing]);

  // --- Simulation (mounted once; no grid reset) ---
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

    // Opacity / colors
    const SAND_COLOR = 'rgba(230, 200, 120, 0.475)';
    const WATER_COLOR = 'rgba(120, 170, 255, 0.40)';
    const STONE_COLOR = 'rgba(140, 140, 150, 0.70)';
    const STONE_PREVIEW_COLOR = 'rgba(160,160,170,0.40)';

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
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else mq.addListener(onChange);
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

    const fit = () => {
      const { width, height } = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.max(300, Math.floor(width * dpr));
      canvas.height = Math.max(200, Math.floor(height * dpr));
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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
      // While drafting stone, keep painting draft under cursor
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

    // LMB toggles draw for sand/water/eraser; for STONE it becomes hold-to-draft, release-to-drop
    const onPointerDown = (e) => {
      updatePointer(e.clientX, e.clientY);
      const overUI = uiRef.current && uiRef.current.contains(e.target);
      if (!inside || overUI) return;

      if (e.button === 0) {
        lmbDown = true;
        // If active tool (considering RMB override) is stone, start drafting instead of toggling draw
        const rmbHeld = overrideToolRef.current === 'eraser';
        const activeTool = rmbHeld ? 'eraser' : toolRef.current;

        if (activeTool === 'stone') {
          isDraftingStone = true;
          // seed first dab
          addDiscToDraft(Math.floor(px / cellSize), Math.floor(py / cellSize), STONE_BRUSH_RADIUS);
          e.preventDefault();
          return;
        }

        // Default: toggle draw
        setIsDrawing((prev) => {
          const nxt = !prev;
          isDrawingRef.current = nxt;
          return nxt;
        });
        e.preventDefault();
      }

      if (e.button === 2) {
        overrideToolRef.current = 'eraser';
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
          // finalize the stone draft into a rigid component
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

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('scroll', onScroll, { passive: true });

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
          // don't draft over existing solid to avoid fusing with old stone during preview
          if (grid[k] === EMPTY) stoneDraft.add(k);
        }
      }
    }

    function finalizeStoneDraft() {
      if (stoneDraft.size === 0) return;

      // Write the draft cells into the grid as STONE and capture component cells
      const cells = new Set();
      let yMax = 0;

      for (const k of stoneDraft) {
        // Only place into empty to avoid overwriting
        if (grid[k] === EMPTY) {
          grid[k] = STONE;
          cells.add(k);
          const [, y] = XY(k);
          if (y > yMax) yMax = y;
        }
      }

      // If nothing placed, skip
      if (cells.size === 0) return;

      // Merge with adjacent existing stone components if touching
      const touchingComponentIds = new Set();
      for (const k of cells) {
        const [x, y] = XY(k);
        const nks = [
          I(x + 1, y), I(x - 1, y), I(x, y + 1), I(x, y - 1),
        ].filter(nk => nk >= 0 && nk < grid.length && grid[nk] === STONE && !cells.has(nk));
        for (const nk of nks) {
          // find component containing nk
          for (const comp of stoneComponents) {
            if (comp.cells.has(nk)) { touchingComponentIds.add(comp.id); break; }
          }
        }
      }

      let newComp = { id: nextStoneId++, cells, yMax };
      if (touchingComponentIds.size > 0) {
        // merge all touching comps into newComp
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
      // done
    }

    // Brushes (for sand, water, eraser)
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
      // erase from grid
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
          // also erase from draft if present
          if (stoneDraft.has(k)) stoneDraft.delete(k);
        }
      }
      // update stone components if any stone was erased
      if (erasedStoneCells.length > 0 && stoneComponents.length > 0) {
        // For each component, remove erased cells and split if disconnected
        const updated = [];
        for (const comp of stoneComponents) {
          let changed = false;
          for (const k of erasedStoneCells) {
            if (comp.cells.delete(k)) changed = true;
          }
          if (!changed) { updated.push(comp); continue; }
          if (comp.cells.size === 0) continue;

          // Split into connected parts using BFS on grid adjacency among STONE cells still in comp
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
            // compute yMax
            let yMax = 0;
            for (const k of part) { const [, y] = XY(k); if (y > yMax) yMax = y; }
            updated.push({ id: nextStoneId++, cells: part, yMax });
          }
        }
        stoneComponents = updated;
      }
    };

    // Emission controller (for sand/water/eraser)
    let lastEmit = 0;
    const emitAtPointer = (now) => {
      if (!inside) return;

      // Only bypass the draw toggle when RMB override is active.
      const rmbHeld = overrideToolRef.current === 'eraser';
      const activeTool = rmbHeld ? 'eraser' : toolRef.current;

      // Stone is handled by draft logic (hold LMB to draft, release to drop)
      if (activeTool === 'stone') return;

      const shouldEmit = rmbHeld ? true : isDrawingRef.current;
      if (!shouldEmit) return;
      if (now - lastEmit < EMIT_INTERVAL_MS) return;

      const cx = Math.floor(px / cellSize);
      const cy = Math.floor(py / cellSize);
      if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) return;

      if (activeTool === 'eraser') {
        eraseDisc(cx, cy, ERASE_BRUSH_RADIUS);
        lastEmit = now;
        return;
      }
      if (activeTool === 'water') {
        paintDisc(cx, cy, WATER_BRUSH_RADIUS, WATER, false);
        lastEmit = now;
        return;
      }
      // sand
      if (grid[I(cx, cy)] !== EMPTY) { lastEmit = now; return; }
      paintDisc(cx, cy, SAND_BRUSH_RADIUS, SAND, false);
      lastEmit = now;
    };

    // Helpers
    const emptyAt = (x, y) =>
      x >= 0 && x < cols && y >= 0 && y < rows && grid[I(x, y)] === EMPTY && next[I(x, y)] === EMPTY;

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

    // --- Stone rigid-body movement (in-place on grid) ---
  function moveStoneComponentsDown() {
      if (stoneComponents.length === 0) return;

      // Recompute yMax and move lower components first
      for (const comp of stoneComponents) {
        let ym = 0;
        for (const k of comp.cells) { const [, y] = XY(k); if (y > ym) ym = y; }
        comp.yMax = ym;
      }
      stoneComponents.sort((a, b) => b.yMax - a.yMax);

      for (const comp of stoneComponents) {
        let canMove = true;

        // Check if every cell can move down by 1
        for (const k of comp.cells) {
          const [x, y] = XY(k);
          const ny = y + 1;
          if (ny >= rows) { canMove = false; break; }
          const belowK = I(x, ny);

          // If below belongs to this same component (rare on a single-step), it's fine.
          if (comp.cells.has(belowK)) continue;

          // Allow EMPTY or WATER; block on SAND or STONE from other comps
          const mat = grid[belowK];
          if (mat !== EMPTY && mat !== WATER) { canMove = false; break; }
        }
        if (!canMove) continue;

        // Build list of water swaps: water under a stone cell will rise into the stone's old cell
        /** @type {Array<[number, number]>} */ // [waterIndexBelow, stoneOriginIndex]
        const waterSwaps = [];
        for (const k of comp.cells) {
          const [x, y] = XY(k);
          const belowK = I(x, y + 1);
          if (!comp.cells.has(belowK) && grid[belowK] === WATER) {
            waterSwaps.push([belowK, k]);
          }
        }

        // 1) Clear old stone cells
        for (const k of comp.cells) grid[k] = EMPTY;

        // 2) Move water up into the vacated stone cells (1:1 swap)
        for (const [waterIdx, originIdx] of waterSwaps) {
          // Only lift if origin is still empty (it is, we just cleared stones)
          // Note: we don't need to clear waterIdx here; it will be overwritten by stone in step 3.
          grid[originIdx] = WATER;
        }

        // 3) Write new stone positions one row lower
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
    // Physics step
    const step = () => {
      // 1) Move rigid stones first, directly on grid
      moveStoneComponentsDown();

      // 2) Now compute sand/water into next buffer, and also carry stones forward
      next.fill(0);

      // Copy stones straight through so they persist (and block)
      for (let k = 0; k < grid.length; k++) {
        if (grid[k] === STONE) next[k] = STONE;
      }

      // Sand settle
      for (let y = rows - 1; y >= 0; y--) {
        const ltr = (y & 1) === 0;
        if (ltr) { for (let x = 0; x < cols; x++) settleSand(x, y); }
        else     { for (let x = cols - 1; x >= 0; x--) settleSand(x, y); }
      }

      // Water settle
      for (let y = rows - 1; y >= 0; y--) {
        const ltr = (y & 1) === 0;
        if (ltr) { for (let x = 0; x < cols; x++) settleWater(x, y); }
        else     { for (let x = cols - 1; x >= 0; x--) settleWater(x, y); }
      }

      // flip
      const tmp = grid; grid = next; next = tmp;
    };

    const render = () => {
      const { width, height } = wrap.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);

      // draw sand
      ctx.fillStyle = SAND_COLOR;
      for (let y = 0; y < rows; y++) {
        const yy = y * cellSize;
        for (let x = 0; x < cols; x++) {
          if (grid[I(x, y)] === SAND) ctx.fillRect(x * cellSize, yy, cellSize - 1, cellSize - 1);
        }
      }
      // draw water
      ctx.fillStyle = WATER_COLOR;
      for (let y = 0; y < rows; y++) {
        const yy = y * cellSize;
        for (let x = 0; x < cols; x++) {
          if (grid[I(x, y)] === WATER) ctx.fillRect(x * cellSize, yy, cellSize - 1, cellSize - 1);
        }
      }
      // draw stone
      ctx.fillStyle = STONE_COLOR;
      for (let y = 0; y < rows; y++) {
        const yy = y * cellSize;
        for (let x = 0; x < cols; x++) {
          if (grid[I(x, y)] === STONE) ctx.fillRect(x * cellSize, yy, cellSize - 1, cellSize - 1);
        }
      }
      // draw stone draft overlay (preview) on top
      if (stoneDraft.size > 0) {
        ctx.fillStyle = STONE_PREVIEW_COLOR;
        for (const k of stoneDraft) {
          const [x, y] = XY(k);
          ctx.fillRect(x * cellSize, y * cellSize, cellSize - 1, cellSize - 1);
        }
      }
    };

    // Main animation loop
    let raf = 0;
    let lastStep = performance.now();
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (reduced) return;

      if (clientX >= 0 && clientY >= 0) {
        const r = wrap.getBoundingClientRect();
        inside = clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
        px = clientX - r.left; py = clientY - r.top;
      }

      if (now - lastStep >= STEP_MS) {
        // For draft: if holding LMB in stone mode, keep adding to draft at interval (already handled on move; this throttles emission-like behavior if stationary)
        if (isDraftingStone && inside) {
          addDiscToDraft(Math.floor(px / cellSize), Math.floor(py / cellSize), STONE_BRUSH_RADIUS);
        }

        emitAtPointer(now);
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
    };
  }, []); // IMPORTANT: no deps -> simulation persists

  return (
    <div ref={wrapRef} className="absolute inset-0 z-0">
      {/* Simulation canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        aria-hidden="true"
      />

      {/* Tool Selection Bar (always vertical on mobile, smaller sizes) */}
      <div
        ref={uiRef}
        className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 z-10 bg-gray-900/80 rounded-lg sm:rounded-xl p-1.5 sm:p-2 md:p-3 backdrop-blur-sm shadow-lg"
      >
        <div className="flex flex-col items-stretch gap-1 sm:gap-2">
          <div className="text-white text-[10px] sm:text-[11px] md:text-xs font-medium"></div>

          {/* Vertical stack at all sizes (smaller on mobile) */}
          <div className="flex flex-col gap-1 sm:gap-2">
            <button
              onClick={() => setSelectedTool('sand')}
              className={`w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-md sm:rounded-lg flex items-center justify-center transition-all ${
                selectedTool === 'sand'
                  ? 'bg-yellow-600 shadow-lg scale-105'
                  : 'bg-gray-700 hover:bg-gray-600'
              }`}
              title="Sand"
            >
              <div className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 bg-yellow-400 rounded-sm opacity-80" />
            </button>

            <button
              onClick={() => setSelectedTool('water')}
              className={`w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-md sm:rounded-lg flex items-center justify-center transition-all ${
                selectedTool === 'water'
                  ? 'bg-blue-600 shadow-lg scale-105'
                  : 'bg-gray-700 hover:bg-gray-600'
              }`}
              title="Water"
            >
              <div className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 bg-blue-400 rounded-full opacity-80" />
            </button>



            <button
              onClick={() => setSelectedTool('stone')}
              className={`w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-md sm:rounded-lg flex items-center justify-center transition-all ${
                selectedTool === 'stone'
                  ? 'bg-gray-600 shadow-lg scale-105'
                  : 'bg-gray-700 hover:bg-gray-600'
              }`}
              title="Stone"
            >
              <div className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 bg-gray-400 rounded-[3px] opacity-90" />
            </button>
                        <button
              onClick={() => setSelectedTool('eraser')}
              className={`w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-md sm:rounded-lg flex items-center justify-center transition-all ${
                selectedTool === 'eraser'
                  ? 'bg-red-600 shadow-lg scale-105'
                  : 'bg-gray-700 hover:bg-gray-600'
              }`}
              title="Eraser"
            >
              <div className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 bg-red-400 rounded-lg opacity-80" />
            </button>
          </div>

          {/* (Optional) compact instructions, hidden on very small screens */}
          <div className="hidden xs:block mt-1 sm:mt-2 text-[9px] sm:text-[10px] md:text-xs leading-tight text-gray-200 space-y-0.5">
            <div>Left click: toggle draw (sand/water)</div>
            <div>Hold left: draft stone; release to drop</div>
            <div>Hold right: eraser</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- PAGE ---------- */
export default function About() {
  return (
    <section className="relative bg-dark">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-12 sm:pt-16 pb-8">
        <div className="flex flex-col-reverse md:flex-row items-center md:items-start gap-4 md:gap-6">
          {/* Right-aligned Text on desktop; centered on mobile */}
          <div className="w-full md:w-1/2">
            <h2 className="text-white font-bold tracking-tight text-center md:text-right text-3xl sm:text-5xl md:text-6xl">
              SKILLS & <br className="hidden sm:block" /> EXPERIENCE
            </h2>

            <div className="mt-4 md:mt-6 md:ml-auto md:max-w-xl space-y-4">
              {/* Experience */}
              <div className="bg-gray-900/80 rounded-md p-3 sm:p-4 shadow-md  ring-1 ring-white/10 ">
                <pre className="text-xs sm:text-sm leading-5 text-left text-white whitespace-pre-wrap break-words">
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

              {/* Tech stack */}
              <div className="bg-gray-900/80 rounded-md p-3 sm:p-4 shadow-md  ring-1 ring-white/10 ">
                <pre className="text-xs sm:text-sm leading-5 text-left text-white whitespace-pre-wrap break-words">
                  <code>
                    <span className="text-blue-400">// Languages + back-end profile</span>{'\n'}
                    <span className="text-red-500">const</span> <span className="text-purple-300">techStack</span> {'= {'}{'\n'}
                    {'    '}<span className="text-yellow-500">languages</span>{": ['"}
                    <span className="text-green-500">C++</span>{"', '"}
                    <span className="text-green-500">Python</span>{"', '"}
                    <span className="text-green-500">Java</span>{"', '"}
                    <span className="text-green-500">JavaScript (ES6+)</span>{"', '"}
                    <span className="text-green-500">SQL</span>{"'],"}{'\n'}
                    {'    '}<span className="text-yellow-500">backend</span>{': {'}{'\n'}
                    {'        '}<span className="text-yellow-500">strengths</span>{": ['"}
                    <span className="text-green-500">REST APIs</span>{"', '"}
                    <span className="text-green-500">Auth & sessions</span>{"', '"}
                    <span className="text-green-500">Schema design</span>{"', '"}
                    <span className="text-green-500">Query optimization</span>{"'],"}{'\n'}
                    {'        '}<span className="text-yellow-500">summary</span>{": '"}
                    <span className="text-green-500">Production experience building secure, well-documented services and data models.</span>{"'"}{'\n'}
                    {'    '}{"}'"},{'\n'}
                    {'    '}<span className="text-yellow-500">value</span>{": '"}
                    <span className="text-green-500">Bridges front-end and back-end to ship features quickly, safely, and with polish.</span>{"'"}{'\n'}
                    {'}'}{';'}{'\n'}
                  </code>
                </pre>
              </div>
            </div>
          </div>

          {/* Left column: Lottie */}
          <div className="w-full md:w-1/2 flex flex-col items-center md:items-start gap-4">
            <div className="w-full max-w-md sm:max-w-lg md:max-w-none">
              <div style={{ transform: 'scaleX(-1)' }}>
                <ResponsiveLottie animationData={animationData} />
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Full-section Sand overlay */}
      <SandOverlay />
    </section>
  );
}
