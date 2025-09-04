import React, { useEffect, useRef, useState } from 'react';
import { FaGithub, FaLinkedin } from 'react-icons/fa';

/* ---------- Falling-sand background overlay ---------- */
function SandOverlay() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // ---- Tunables ----
    const CELL_PX = 5;               // denser grid (smaller cell size)
    const SAND_BRUSH_RADIUS = 2;     // default hover brush
    const WATER_BRUSH_RADIUS = 2;    // right-click brush
    const ERASE_BRUSH_RADIUS = 3;    // left-click brush
    const EMIT_INTERVAL_MS = 18;     // how often to drop new particles (ms)
    const STEP_MS = 8;              // physics tick (ms)
    const MAX_WATER_FLOW = 100;        // how far water searches horizontally for a drop
    const SAND_COLOR = 'rgba(230, 200, 120, 0.9)';
    const WATER_COLOR = 'rgba(120, 170, 255, 0.8)';

    // Materials
    const EMPTY = 0;
    const SAND  = 1;
    const WATER = 2;

    // Grid
    let cols = 0, rows = 0, cellSize = CELL_PX;
    let gridA = new Uint8Array(0);
    let gridB = new Uint8Array(0);
    let grid = gridA, next = gridB;
    const I = (x, y) => y * cols + x;

    // Pointer (screen coords -> local each frame)
    let clientX = -1, clientY = -1;
    let px = -1, py = -1;
    let inside = false;

    // Buttons
    let leftDown = false;   // erase
    let rightDown = false;  // water

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
    const fit = () => {
      const { width, height } = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.max(300, Math.floor(width * dpr));
      canvas.height = Math.max(200, Math.floor(height * dpr));
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      cellSize = CELL_PX;
      cols = Math.max(60, Math.floor(width / cellSize));   // more columns (denser)
      rows = Math.max(28, Math.floor(height / cellSize));  // more rows

      gridA = new Uint8Array(cols * rows);
      gridB = new Uint8Array(cols * rows);
      grid = gridA; next = gridB;

      seedInitialSand();
      ctx.clearRect(0, 0, width, height);
    };

    const seedInitialSand = () => {
      const band = Math.max(3, Math.floor(rows * 0.10)); // ~10% height bottom band
      for (let y = rows - band; y < rows; y++) {
        const t = (y - (rows - band)) / Math.max(1, band - 1); // 0..1
        const p = 0.05 + t * 0.35; // 5%..40%
        for (let x = 1; x < cols - 1; x++) {
          if (Math.random() < p) grid[I(x, y)] = SAND;
        }
      }
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

    // Global listeners (don’t block clicks on content)
    const onPointerMove = (e) => updatePointer(e.clientX, e.clientY);
    const onMouseMove   = (e) => updatePointer(e.clientX, e.clientY);
    const onTouchMove   = (e) => {
      if (!e.touches || e.touches.length === 0) return;
      const t = e.touches[0];
      updatePointer(t.clientX, t.clientY);
    };
    const onPointerDown = (e) => {
      updatePointer(e.clientX, e.clientY);
      if (inside) {
        if (e.button === 0) leftDown = true;
        if (e.button === 2) { rightDown = true; e.preventDefault(); }
      }
    };
    const onPointerUp = (e) => {
      if (e.button === 0) leftDown = false;
      if (e.button === 2) rightDown = false;
    };
    const onContextMenu = (e) => { if (inside) e.preventDefault(); };
    const onScroll = () => {
      if (clientX >= 0 && clientY >= 0) updatePointer(clientX, clientY);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('mousemove',   onMouseMove,   { passive: true });
    window.addEventListener('touchmove',   onTouchMove,   { passive: true });
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup',   onPointerUp);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('scroll',      onScroll,      { passive: true });

    // Brushes
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
      for (let oy = -radius; oy <= radius; oy++) {
        const yy = cy + oy;
        if (yy <= 0 || yy >= rows - 1) continue;
        for (let ox = -radius; ox <= radius; ox++) {
          if (ox * ox + oy * oy > radius * radius) continue;
          const xx = cx + ox;
          if (xx <= 0 || xx >= cols - 1) continue;
          grid[I(xx, yy)] = EMPTY;
        }
      }
    };

    // Emission controller
    let lastEmit = 0;
    const emitAtPointer = (now) => {
      if (!inside) return;
      if (now - lastEmit < EMIT_INTERVAL_MS) return;

      const cx = Math.floor(px / cellSize);
      const cy = Math.floor(py / cellSize);
      if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) return;

      if (leftDown) {
        eraseDisc(cx, cy, ERASE_BRUSH_RADIUS);
        lastEmit = now;
        return;
      }

      if (rightDown) {
        // Water brush; allow overwrite=false so it fills empty only
        paintDisc(cx, cy, WATER_BRUSH_RADIUS, WATER, false);
        lastEmit = now;
        return;
      }

      // Default sand emission — skip if the cursor cell is already occupied
      if (grid[I(cx, cy)] !== EMPTY) return;
      paintDisc(cx, cy, SAND_BRUSH_RADIUS, SAND, false);
      lastEmit = now;
    };

    // Physics helpers
    const emptyAt = (x, y) => x >= 0 && x < cols && y >= 0 && y < rows && grid[I(x, y)] === EMPTY && next[I(x, y)] === EMPTY;

    // Sand: falls down; swaps through water (sand sinks)
    const settleSand = (x, y) => {
      const k = I(x, y);
      if (grid[k] !== SAND) return;
      // down empty
      if (y + 1 < rows && grid[I(x, y + 1)] === EMPTY && next[I(x, y + 1)] === EMPTY) {
        next[I(x, y + 1)] = SAND; return;
      }
      // down is water -> swap so sand sinks, water rises
      if (y + 1 < rows && grid[I(x, y + 1)] === WATER && next[I(x, y + 1)] === EMPTY) {
        next[I(x, y + 1)] = SAND;
        if (next[k] === EMPTY) next[k] = WATER;
        return;
      }
      // diagonals
      const leftFirst = Math.random() < 0.5;
      const tryDiag = (dx) => {
        const nx = x + dx, ny = y + 1;
        if (nx <= 0 || nx >= cols - 1 || ny >= rows) return false;
        const ik = I(nx, ny);
        if (grid[ik] === EMPTY && next[ik] === EMPTY) { next[ik] = SAND; return true; }
        // slip over water diagonally
        if (grid[ik] === WATER && next[ik] === EMPTY) {
          next[ik] = SAND; if (next[k] === EMPTY) next[k] = WATER; return true;
        }
        return false;
      };
      if ((leftFirst && tryDiag(-1)) || (!leftFirst && tryDiag(1)) || tryDiag(-1) || tryDiag(1)) return;
      // stay put
      if (next[k] === EMPTY) next[k] = SAND;
    };

    // Water: seeks down; if blocked, diagonals; else lateral spread (search for drop); floats on sand
    const settleWater = (x, y) => {
        
      const k = I(x, y);
      if (grid[k] !== WATER) return;
      if (next[k] !== EMPTY) return;

      // down into EMPTY only (don’t pass into sand)
      if (y + 1 < rows && grid[I(x, y + 1)] === EMPTY && next[I(x, y + 1)] === EMPTY) {
        next[I(x, y + 1)] = WATER; return;
      }
      // diagonals first (prefer ones with a drop)
      const dirs = Math.random() < 0.5 ? [-1, 1] : [1, -1];
      for (const dx of dirs) {
        const nx = x + dx, ny = y + 1;
        if (nx <= 0 || nx >= cols - 1 || ny >= rows) continue;
        const ik = I(nx, ny);
        if (grid[ik] === EMPTY && next[ik] === EMPTY) { next[ik] = WATER; return; }
      }
      // lateral search for a drop within MAX_WATER_FLOW
      const findFlowDir = () => {
        const dirPref = Math.random() < 0.5 ? [1, -1] : [-1, 1];
        for (const sgn of dirPref) {
          for (let d = 1; d <= MAX_WATER_FLOW; d++) {
            const nx = x + sgn * d;
            if (nx <= 0 || nx >= cols - 1) break;
            // path cell must be empty to move toward it gradually
            if (grid[I(nx, y)] !== EMPTY || next[I(nx, y)] !== EMPTY) break;
            // if there is a drop at the end, move one step toward it
            if (y + 1 < rows && grid[I(nx, y + 1)] === EMPTY && next[I(nx, y + 1)] === EMPTY) {
              const stepX = x + sgn;
              if (grid[I(stepX, y)] === EMPTY && next[I(stepX, y)] === EMPTY) return sgn;
            }
          }
        }
        return 0;
      };
      let flow = findFlowDir();
      if (flow !== 0) {
        const stepX = x + flow;
        if (emptyAt(stepX, y)) { next[I(stepX, y)] = WATER; return; }
      }
      // small random lateral jiggle if totally trapped (helps level)
      const jiggle = Math.random() < 0.5 ? -1 : 1;
      if (emptyAt(x + jiggle, y)) { next[I(x + jiggle, y)] = WATER; return; }

      // stay put
      if (next[k] === EMPTY) next[k] = WATER;
    };

    // Step simulation: bottom-up; process sand first (so it sinks), then water
    const step = () => {
      next.fill(0);

      // SAND pass
      for (let y = rows - 1; y >= 0; y--) {
        const ltr = (y & 1) === 0;
        if (ltr) { for (let x = 0; x < cols; x++) settleSand(x, y); }
        else     { for (let x = cols - 1; x >= 0; x--) settleSand(x, y); }
      }
      // WATER pass
      for (let y = rows - 1; y >= 0; y--) {
        const ltr = (y & 1) === 0;
        if (ltr) { for (let x = 0; x < cols; x++) settleWater(x, y); }
        else     { for (let x = cols - 1; x >= 0; x--) settleWater(x, y); }
      }
      // swap
      const tmp = grid; grid = next; next = tmp;
    };

    const render = () => {
      const { width, height } = wrap.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);

      // Draw sand and water separately to avoid constant color switches per pixel
      ctx.fillStyle = SAND_COLOR;
      for (let y = 0; y < rows; y++) {
        const yy = y * cellSize;
        for (let x = 0; x < cols; x++) {
          if (grid[I(x, y)] === SAND) ctx.fillRect(x * cellSize, yy, cellSize - 1, cellSize - 1);
        }
      }
      ctx.fillStyle = WATER_COLOR;
      for (let y = 0; y < rows; y++) {
        const yy = y * cellSize;
        for (let x = 0; x < cols; x++) {
          if (grid[I(x, y)] === WATER) ctx.fillRect(x * cellSize, yy, cellSize - 1, cellSize - 1);
        }
      }
    };

    // Main loop
    let raf = 0;
    let lastStep = performance.now();
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (reduced) return;

      // Re-evaluate local coords each frame (for scroll without movement)
      if (clientX >= 0 && clientY >= 0) {
        const r = wrap.getBoundingClientRect();
        inside = clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
        px = clientX - r.left; py = clientY - r.top;
      }

      if (now - lastStep >= STEP_MS) {
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
      window.removeEventListener('mousemove',   onMouseMove);
      window.removeEventListener('touchmove',   onTouchMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup',   onPointerUp);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('scroll',      onScroll);
    };
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0 z-0">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        aria-hidden="true"
      />
    </div>
  );
}



/* ---------- Contact section with sand overlay ---------- */
const Contact = () => {
  const contactItems = [
    {
      icon: <FaGithub className="text-4xl" />,
      label: 'GitHub',
      link: 'https://github.com/nicholasmayerrupert',
    },
    {
      icon: <FaLinkedin className="text-4xl" />,
      label: 'LinkedIn',
      link: 'https://www.linkedin.com/in/nicholas-mayer-rupert/',
    },
  ];

  return (
    <div className="relative bg-dark py-12 overflow-hidden">
      {/* Falling-sand background */}
      <SandOverlay />


     {/* Background instructions (desktop only) */}
    <div className="hidden md:block pointer-events-none absolute left-4 bottom-4 z-[1]">
    <span className="font-mono text-xs text-neutral-300/80 bg-black/25 rounded-full px-3 py-1 backdrop-blur-sm">
            LMB = Erase · RMB = Water
    </span>
    </div>

      {/* Foreground content */}
      <div className="relative z-10 container mx-auto">
        <h2 className="text-4xl font-bold mb-8 text-center text-white">Contact Me</h2>

        <div className="flex justify-center">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            {contactItems.map((item, index) => (
              <a
                key={index}
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-gray-900 rounded-lg shadow-md p-6 flex flex-col items-center hover:bg-gray-800 transition duration-300"
              >
                <div className="text-blue-600 mb-4">{item.icon}</div>
                <h3 className="text-xl font-semibold text-white">{item.label}</h3>
              </a>
            ))}
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-white">Email: njmrme@gmail.com</p>
        </div>
      </div>
    </div>
  );
};

export default Contact;
