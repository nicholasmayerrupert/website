// src/TileGrid.jsx
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Lottie from 'react-lottie';
import animation1 from './chess.json';
import animation2 from './grabby2.json';
import animation3 from './fire.json';
import animation4 from './whitelife.json';

// Reduced-motion hook
function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mq.matches);
    const onChange = () => setPrefersReducedMotion(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);
  return prefersReducedMotion;
}

// Responsive Lottie (square)
function ResponsiveLottie({ animationData }) {
  const containerRef = useRef(null);
  const [size, setSize] = useState(300);
  const prefersReducedMotion = usePrefersReducedMotion();

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => {
      const w = el.getBoundingClientRect().width || 300;
      const clamped = Math.max(160, Math.min(420, Math.floor(w)));
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
  <div ref={containerRef} className="w-full aspect-square grid place-items-center">
    {/* This box gets the computed square size and is centered */}
    <div style={{ width: size, height: size }}>
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
        style={{ display: 'block' }} // avoid extra inline gaps
      />
    </div>
  </div>
);
}

/* ---------- Snake backdrop (autopilot + player takeover) ---------- */
function SnakeBackdrop() {
  const overlayRef = useRef(null);
  const canvasRef = useRef(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const rmRef = useRef(false);
  useEffect(() => { rmRef.current = prefersReducedMotion; }, [prefersReducedMotion]);

  useEffect(() => {
    if (!overlayRef.current || !canvasRef.current) return;

    const wrapper = overlayRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const setCanvasSize = () => {
      const { width, height } = wrapper.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(300, Math.floor(width * dpr));
      canvas.height = Math.max(200, Math.floor(height * dpr));
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    setCanvasSize();

    const world = () => {
      const r = wrapper.getBoundingClientRect();
      return { w: r.width || 600, h: r.height || 400 };
    };

    const pickGrid = () => {
      const { w, h } = world();
      const cell = Math.max(12, Math.min(26, Math.floor(w / 36)));
      const cols = Math.max(24, Math.floor(w / cell));
      const rows = Math.max(14, Math.floor(h / cell));
      return { cell, cols, rows, w, h };
    };

    let { cell, cols, rows, w, h } = pickGrid();
    const inside = (x, y) => x >= 0 && x < cols && y >= 0 && y < rows;

    let snake = [];
    let dir = { x: 1, y: 0 };
    let nextDir = { x: 1, y: 0 };
    let food = { x: 0, y: 0 };

    const collideSelf = (x, y) =>
      snake.some((s, i) => i < snake.length - 1 && s.x === x && s.y === y);

    const spawnFood = () => {
      let fx, fy, tries = 0;
      do {
        fx = Math.floor(Math.random() * cols);
        fy = Math.floor(Math.random() * rows);
        tries++;
      } while ((collideSelf(fx, fy) || (snake[0] && snake[0].x === fx && snake[0].y === fy)) && tries < 500);
      return { x: fx, y: fy };
    };

    const BASE_STEP_MS = 110;
    const MIN_STEP_MS = 70;
    const SPEEDUP = 0.98;
    let stepMs = BASE_STEP_MS;

    let controlMode = 'auto';
    const PLAYER_TIMEOUT_MS = 7000;
    let lastInputAt = performance.now();

    const resetGame = () => {
      const cx = Math.floor(cols / 3);
      const cy = Math.floor(rows / 2);
      snake = [
        { x: cx, y: cy },
        { x: cx - 1, y: cy },
        { x: cx - 2, y: cy },
      ];
      dir = { x: 1, y: 0 };
      nextDir = { x: 1, y: 0 };
      lastInputAt = performance.now();
      controlMode = 'auto';
      food = spawnFood();
      stepMs = BASE_STEP_MS;
    };
    resetGame();

    // Keyboard: take control (Arrow/WASD). Prevent page scroll for arrow keys.
    const onKey = (e) => {
      let nd = null;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { nd = { x: 0, y: -1 }; e.preventDefault(); }
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') { nd = { x: 0, y: 1 }; e.preventDefault(); }
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { nd = { x: -1, y: 0 }; e.preventDefault(); }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { nd = { x: 1, y: 0 }; e.preventDefault(); }
      if (!nd) return;
      if (nd.x === -dir.x && nd.y === -dir.y) return; // no 180s
      nextDir = nd;
      controlMode = 'player';
      lastInputAt = performance.now();
    };
    window.addEventListener('keydown', onKey);

    const ro = new ResizeObserver(() => {
      setCanvasSize();
      const g = pickGrid();
      cell = g.cell; cols = g.cols; rows = g.rows; w = g.w; h = g.h;
      resetGame();
      draw();
    });
    ro.observe(wrapper);

    const dirs = [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ];
    const stepAuto = () => {
      const order = [...dirs].sort((a, b) => {
        const da = Math.abs(food.x - (snake[0].x + a.x)) + Math.abs(food.y - (snake[0].y + a.y));
        const db = Math.abs(food.x - (snake[0].x + b.x)) + Math.abs(food.y - (snake[0].y + b.y));
        return da - db;
      });
      for (const d of order) {
        if (d.x === -dir.x && d.y === -dir.y) continue;
        const nx = snake[0].x + d.x;
        const ny = snake[0].y + d.y;
        if (!inside(nx, ny)) continue;
        if (collideSelf(nx, ny)) continue;
        nextDir = d;
        return;
      }
      nextDir = dir;
    };

    let raf = 0;
    let lastTick = performance.now();

    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      // faint grid for depth
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      const step = Math.max(18, cell);
      for (let x = 0; x <= w; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y <= h; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      // body tiles (transparent)
      ctx.fillStyle = 'rgba(126, 255, 114, 0.25)';
      for (let i = snake.length - 1; i >= 1; i--) {
        const s = snake[i];
        ctx.fillRect(s.x * cell, s.y * cell, cell - 1, cell - 1);
      }

      // head (slightly less transparent)
      ctx.fillStyle = 'rgba(96, 255, 78, 0.35)';
      ctx.fillRect(snake[0].x * cell, snake[0].y * cell, cell - 1, cell - 1);

      // food
      ctx.fillStyle = 'rgba(255,100,100,0.42)';
      const fx = food.x * cell, fy = food.y * cell;
      const r = Math.max(3, Math.floor(cell * 0.28));
      ctx.beginPath();
      ctx.arc(fx + cell / 2, fy + cell / 2, r, 0, Math.PI * 2);
      ctx.fill();
    };

    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (rmRef.current) return; // respect reduced motion

      const dt = now - lastTick;
      if (dt >= stepMs) {
        lastTick = now;

        if (controlMode === 'player' && now - lastInputAt > PLAYER_TIMEOUT_MS) {
          controlMode = 'auto';
        }
        if (controlMode === 'auto') stepAuto();

        dir = nextDir;

        const nx = snake[0].x + dir.x;
        const ny = snake[0].y + dir.y;

        if (!inside(nx, ny) || collideSelf(nx, ny)) {
          resetGame();
          draw();
          return;
        }

        snake.unshift({ x: nx, y: ny });

        if (nx === food.x && ny === food.y) {
          food = spawnFood();
          stepMs = Math.max(MIN_STEP_MS, stepMs * SPEEDUP);
        } else {
          snake.pop();
        }

        draw();
      }
    };

    draw();
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={overlayRef} className="absolute inset-0 z-0" aria-hidden="true">
      {/* Transparent, non-interactive canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        role="img"
        aria-label="Snake backdrop"
      />
    </div>
  );
}

/* ---------- Page ---------- */
export default function TileGrid() {
  const [revealedTiles, setRevealedTiles] = useState([]);

  const handleTileClick = (index) => {
    setRevealedTiles((prev) => (prev.includes(index) ? [] : [index]));
  };

  const tiles = [
    {
      animation: animation1,
      title: 'Chess Engine',
      content: 'Software Project',
      description: 'A decent chess engine built using C++.',
      features: ['AI opponent from terminal', 'Move analysis', 'Plays at ~1200 ELO'],
    },
    {
      animation: animation2,
      title: 'Grabby - OCR + Snipping Tool',
      content: 'Software Project',
      description: 'A versatile tool combining OCR and snipping capabilities.',
      features: ['Text extraction from images', 'Snipping tool integration', 'Multi-language support'],
    },
    {
      animation: animation3,
      title: 'Forest Fire Modelling',
      content: 'Data Science Project',
      description:
        'A series of models designed to examine which factors predispose areas to forest fires most.',
      features: [
        'Analyzed causes of spread rates',
        'Determined the most predictive factor extractable from public data to be humidity',
        'Discovered weather to be a poor predictor of forest fires - likely due to data chunking',
      ],
    },
    {
      animation: animation4,
      title: '3D Game of Life',
      content: 'Scroll up :P',
      description: 'A 3D implementation of the classic cellular automaton.',
      features: [
        'Stores previous cycles on the y-axis',
        'Real-time 3D rendering',
        'Shows how the game evolves over time',
      ],
    },
  ];

  return (
    <section className="relative bg-dark min-h-screen">
      {/* Background Snake */}
      <SnakeBackdrop />

      {/* Foreground content */}
      <div className="relative z-10 pt-24 sm:pt-28 pb-12">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-white font-bold tracking-tight mb-8 sm:mb-12 text-4xl sm:text-6xl md:text-7xl">
            MY PROJECTS
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 md:gap-8">
            {tiles.map((tile, index) => {
              const isOpen = revealedTiles.includes(index);
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => handleTileClick(index)}
                  aria-pressed={isOpen}
                  aria-label={`${isOpen ? 'Hide' : 'Show'} details for ${tile.title}`}
                  className="group relative w-full text-left rounded-2xl bg-gray-900/60 shadow-lg ring-1 ring-white/10 hover:ring-white/20 transition
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900
                             overflow-hidden hover:scale-[1.02] active:scale-[0.99] duration-200"
                >
                  {isOpen ? (
                    <div className="p-4 sm:p-6">
                      <h3 className="text-2xl font-bold text-white text-center mb-2">{tile.title}</h3>
                      <p className="text-center text-gray-300 mb-4">{tile.content}</p>
                      <p className="text-gray-200 mb-4">{tile.description}</p>
                      <ul className="list-disc pl-5 space-y-1 text-gray-200">
                        {tile.features.map((feature, idx) => (
                          <li key={idx}>{feature}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="relative">
                        <div className="p-3">
                          <ResponsiveLottie animationData={tile.animation} />
                        </div>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <h3 className="inline-block rounded-full bg-black/45 text-white font-bold py-2 px-4 text-lg sm:text-xl backdrop-blur-md">
                          {tile.title}
                        </h3>
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
