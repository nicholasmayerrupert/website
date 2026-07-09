// src/TileGrid.jsx
// Project cards with flip-for-details. Art is custom SVG (ProjectArt.jsx).
// Perf: one art mount per card (front only), no GSAP particles/tilt/spotlight,
// snake canvas pauses off-screen and only repaints on step.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import ReactCardFlip from 'react-card-flip';
import { ChessArt, SandSimArt, WildfireArt, LifeArt } from './ProjectArt';
import './MagicBento.css';
import { usePrefersReducedMotion } from './hooks/useMediaQuery';

/* ---------- Snake backdrop (cheap, visibility-gated) ---------- */
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

    let visible = true;
    let raf = 0;
    let lastTick = performance.now();

    const setCanvasSize = () => {
      const { width, height } = wrapper.getBoundingClientRect();
      // Cap DPR at 1 — backdrop is subtle; 2x pixels cost 4x fill.
      const dpr = 1;
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
      // Larger cells → fewer rects.
      const cell = Math.max(18, Math.min(32, Math.floor(w / 28)));
      const cols = Math.max(16, Math.floor(w / cell));
      const rows = Math.max(10, Math.floor(h / cell));
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

    // Slower step = less CPU while looking similar.
    const BASE_STEP_MS = 160;
    let stepMs = BASE_STEP_MS;

    let controlMode = 'auto';
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

    const onKey = (e) => {
      let nd = null;
      if (e.code === 'ArrowUp') { nd = { x: 0, y: -1 }; e.preventDefault(); }
      else if (e.code === 'ArrowDown') { nd = { x: 0, y: 1 }; e.preventDefault(); }
      else if (e.code === 'ArrowLeft') { nd = { x: -1, y: 0 }; e.preventDefault(); }
      else if (e.code === 'ArrowRight') { nd = { x: 1, y: 0 }; e.preventDefault(); }
      if (!nd) return;
      if (nd.x === -dir.x && nd.y === -dir.y) return;
      nextDir = nd;
      controlMode = 'player';
      lastInputAt = performance.now();
    };
    window.addEventListener('keydown', onKey);

    const dirs = [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ];

    const stepAuto = () => {
      const head = snake[0];
      const order = [...dirs].sort((a, b) => {
        const da = Math.abs(food.x - (head.x + a.x)) + Math.abs(food.y - (head.y + a.y));
        const db = Math.abs(food.x - (head.x + b.x)) + Math.abs(food.y - (head.y + b.y));
        return da - db;
      });
      for (const d of order) {
        if (d.x === -dir.x && d.y === -dir.y) continue;
        const nx = head.x + d.x;
        const ny = head.y + d.y;
        if (!inside(nx, ny)) continue;
        if (collideSelf(nx, ny)) continue;
        nextDir = d;
        return;
      }
      nextDir = dir;
    };

    // Grid lines cached offscreen; snake/food redrawn only on step.
    const gridCanvas = document.createElement('canvas');
    const paintGrid = () => {
      gridCanvas.width = Math.max(1, canvas.width);
      gridCanvas.height = Math.max(1, canvas.height);
      const gctx = gridCanvas.getContext('2d');
      if (!gctx) return;
      gctx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
      gctx.strokeStyle = 'rgba(255,255,255,0.05)';
      gctx.lineWidth = 1;
      const step = Math.max(22, cell);
      for (let x = 0; x <= w; x += step) {
        gctx.beginPath(); gctx.moveTo(x, 0); gctx.lineTo(x, h); gctx.stroke();
      }
      for (let y = 0; y <= h; y += step) {
        gctx.beginPath(); gctx.moveTo(0, y); gctx.lineTo(w, y); gctx.stroke();
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      if (gridCanvas.width && gridCanvas.height) {
        ctx.drawImage(gridCanvas, 0, 0, w, h);
      }

      ctx.fillStyle = 'rgba(126, 255, 114, 0.22)';
      for (let i = snake.length - 1; i >= 1; i--) {
        const s = snake[i];
        ctx.fillRect(s.x * cell, s.y * cell, cell - 1, cell - 1);
      }

      ctx.fillStyle = 'rgba(96, 255, 78, 0.32)';
      ctx.fillRect(snake[0].x * cell, snake[0].y * cell, cell - 1, cell - 1);

      ctx.fillStyle = 'rgba(255,100,100,0.4)';
      const fx = food.x * cell;
      const fy = food.y * cell;
      const r = Math.max(3, Math.floor(cell * 0.28));
      ctx.beginPath();
      ctx.arc(fx + cell / 2, fy + cell / 2, r, 0, Math.PI * 2);
      ctx.fill();
    };

    const tick = (now) => {
      if (!visible) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
      if (rmRef.current) return;

      const dt = now - lastTick;
      if (dt < stepMs) return;
      lastTick = now;

      if (controlMode === 'player' && now - lastInputAt > 7000) {
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
        stepMs = Math.max(110, stepMs * 0.98);
      } else {
        snake.pop();
      }

      draw();
    };

    const ro = new ResizeObserver(() => {
      setCanvasSize();
      const g = pickGrid();
      cell = g.cell; cols = g.cols; rows = g.rows; w = g.w; h = g.h;
      paintGrid();
      resetGame();
      draw();
    });
    ro.observe(wrapper);

    // Pause RAF when the section is off-screen.
    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(
          ([entry]) => {
            visible = entry.isIntersecting;
            if (visible && !raf) {
              lastTick = performance.now();
              raf = requestAnimationFrame(tick);
            }
          },
          { rootMargin: '100px 0px' },
        )
      : null;
    io?.observe(wrapper);

    paintGrid();
    draw();
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      ro.disconnect();
      io?.disconnect();
    };
  }, []);

  return (
    <div ref={overlayRef} className="absolute inset-0 z-0" aria-hidden="true">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        role="img"
        aria-label="Snake backdrop"
      />
    </div>
  );
}

const CARD_FLIP_STYLES = {
  front: { height: '100%', width: '100%' },
  back: { height: '100%', width: '100%' },
};

/* ---------- Lightweight flip card (no GSAP particles/tilt) ---------- */
function ProjectCard({
  children,
  className = '',
  style,
  onClick,
  role,
  tabIndex,
  'aria-pressed': ariaPressed,
}) {
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.(e);
    }
  }, [onClick]);

  return (
    <div
      className={`${className} particle-container`}
      style={{
        ...style,
        position: 'relative',
        overflow: 'hidden',
        cursor: 'pointer',
        userSelect: 'none',
        touchAction: 'manipulation',
      }}
      role={role}
      tabIndex={tabIndex}
      aria-pressed={ariaPressed}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
}

/* ---------- Page ---------- */
export default function TileGrid() {
  const [flippedIndex, setFlippedIndex] = useState(null);
  const sectionRef = useRef(null);
  const [artActive, setArtActive] = useState(false);

  // Only run CSS art animations while the projects section is on-screen.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setArtActive(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => setArtActive(entry.isIntersecting),
      { rootMargin: '80px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const handleCardClick = (index) => {
    setFlippedIndex((prev) => (prev === index ? null : index));
  };

  const tiles = [
    {
      Art: ChessArt,
      title: 'LLM Chess Coach',
      content: 'Software Project',
      description: 'LLM-based chess assistant tool - https://github.com/nicholasmayerrupert/cmpt419chess.',
      features: ['AI opponent from terminal', 'Move analysis', 'Plays at ~1200 ELO'],
    },
    {
      Art: SandSimArt,
      title: 'Falling Sand Simulation',
      content: 'Website Centerpiece',
      description: 'The interactive pixel simulation above, built as a C++/WebAssembly falling-sand engine.',
      features: ['WebGL2 canvas rendering', 'Two simulated material layers', 'Procedural streaming terrain'],
    },
    {
      Art: WildfireArt,
      title: 'Forest Fire Modelling',
      content: 'Data Science Project',
      description:
        'A series of models designed to examine which factors predispose areas to forest fires most.',
      features: [
        'Analyzed causes of spread rates',
        'Determined humidity as most predictive',
        'Weather alone underperforms due to data chunking',
      ],
    },
    {
      Art: LifeArt,
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
    <section ref={sectionRef} className={`relative bg-dark min-h-screen bento-section${artActive ? ' bento-section--active' : ''}`}>
      <SnakeBackdrop />

      <div className="relative z-10 pt-24 sm:pt-28 pb-12">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-white font-bold tracking-tight mb-8 sm:mb-12 text-4xl sm:text-6xl md:text-7xl">
            MY PROJECTS
          </h2>

          <div className="card-grid">
            {tiles.map((tile, index) => {
              const isFlipped = flippedIndex === index;

              return (
                <ProjectCard
                  key={index}
                  className={`card card--text-autohide card--border-glow card-flip ${isFlipped ? 'card-flip--flipped' : ''}`}
                  style={{ backgroundColor: '#060010' }}
                  onClick={() => handleCardClick(index)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isFlipped}
                >
                  <ReactCardFlip
                    isFlipped={isFlipped}
                    flipDirection="horizontal"
                    containerClassName="card-flip__container"
                    cardStyles={CARD_FLIP_STYLES}
                  >
                    {/* FRONT — only place art is mounted (halves SVG cost). */}
                    <div key="front" className="card-face card-face--front">
                      <div className="card-media" aria-hidden="true">
                        <tile.Art />
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <h3 className="overlay-title inline-block rounded-full bg-black/70 text-white font-bold py-2 px-4 text-lg sm:text-xl">
                          {tile.title}
                        </h3>
                      </div>
                    </div>

                    {/* BACK — solid dim, no second animated SVG. */}
                    <div key="back" className="card-face card-face--back">
                      <div className="card-media card-media--static" aria-hidden="true" />
                      <div className="p-4 sm:p-6 h-full w-full flex flex-col">
                        <div className="card__header mb-2">
                          <div className="card__label">{tile.content}</div>
                        </div>
                        <div className="card__content">
                          <h3 className="card__title text-white text-xl mb-2">{tile.title}</h3>
                          <p className="card__description text-gray-300 mb-4">{tile.description}</p>
                          <ul className="list-disc pl-5 space-y-1 text-gray-200">
                            {tile.features.map((feature, idx) => (
                              <li key={idx}>{feature}</li>
                            ))}
                          </ul>
                          <div className="mt-auto pt-4 text-sm text-gray-400"></div>
                        </div>
                      </div>
                    </div>
                  </ReactCardFlip>
                </ProjectCard>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
