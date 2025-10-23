// src/TileGrid.jsx
// Notes for future devs:
// - SnakeBackdrop remains untouched.
// - Bento-style grid with hover spotlight/particles.
// - Each card flips in 3D on click (front: Lottie + title chip; back: details).
// - We trigger the flip immediately on click (no waiting for ripple).
// - While flipping, we blur/dim the front (Lottie) and hide the title chip to reduce visual clutter.

import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { gsap } from 'gsap';
import Lottie from 'react-lottie';
import animation1 from './chess.json';
import animation2 from './grabby2.json';
import animation3 from './fire.json';
import animation4 from './whitelife.json';
import './MagicBento.css';

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

/* ---------- Responsive Lottie (square) ---------- */
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
          style={{ display: 'block' }}
        />
      </div>
    </div>
  );
}

/* ---------- Snake backdrop (unchanged) ---------- */
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

    const onKey = (e) => {
      let nd = null;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { nd = { x: 0, y: -1 }; e.preventDefault(); }
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') { nd = { x: 0, y: 1 }; e.preventDefault(); }
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { nd = { x: -1, y: 0 }; e.preventDefault(); }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { nd = { x: 1, y: 0 }; e.preventDefault(); }
      if (!nd) return;
      if (nd.x === -dir.x && nd.y === -dir.y) return;
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

      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      const step = Math.max(18, cell);
      for (let x = 0; x <= w; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y <= h; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      ctx.fillStyle = 'rgba(126, 255, 114, 0.25)';
      for (let i = snake.length - 1; i >= 1; i--) {
        const s = snake[i];
        ctx.fillRect(s.x * cell, s.y * cell, cell - 1, cell - 1);
      }

      ctx.fillStyle = 'rgba(96, 255, 78, 0.35)';
      ctx.fillRect(snake[0].x * cell, snake[0].y * cell, cell - 1, cell - 1);

      ctx.fillStyle = 'rgba(255,100,100,0.42)';
      const fx = food.x * cell, fy = food.y * cell;
      const r = Math.max(3, Math.floor(cell * 0.28));
      ctx.beginPath();
      ctx.arc(fx + cell / 2, fy + cell / 2, r, 0, Math.PI * 2);
      ctx.fill();
    };

    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (rmRef.current) return;

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
          stepMs = Math.max(MIN_STEP_MS, stepMs * 0.98);
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
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        role="img"
        aria-label="Snake backdrop"
      />
    </div>
  );
}

/* ---------- Bento helpers ---------- */
const DEFAULT_PARTICLE_COUNT = 12;
const DEFAULT_SPOTLIGHT_RADIUS = 300;
const DEFAULT_GLOW_COLOR = '132, 0, 255';
const MOBILE_BREAKPOINT = 768;

const createParticleElement = (x, y, color = DEFAULT_GLOW_COLOR) => {
  const el = document.createElement('div');
  el.className = 'particle';
  el.style.cssText = `
    position: absolute;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: rgba(${color}, 1);
    box-shadow: 0 0 6px rgba(${color}, 0.6);
    pointer-events: none;
    z-index: 100;
    left: ${x}px;
    top: ${y}px;
  `;
  return el;
};

const calculateSpotlightValues = (radius) => ({
  proximity: radius * 0.5,
  fadeDistance: radius * 0.75,
});

const updateCardGlowProperties = (card, mouseX, mouseY, glow, radius) => {
  const rect = card.getBoundingClientRect();
  const relativeX = ((mouseX - rect.left) / rect.width) * 100;
  const relativeY = ((mouseY - rect.top) / rect.height) * 100;
  card.style.setProperty('--glow-x', `${relativeX}%`);
  card.style.setProperty('--glow-y', `${relativeY}%`);
  card.style.setProperty('--glow-intensity', glow.toString());
  card.style.setProperty('--glow-radius', `${radius}px`);
};

const useMobileDetection = () => {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
};

/* ---------- ParticleCard (hover effects + immediate click flip) ---------- */
function ParticleCard({
  children,
  className = '',
  disableAnimations = false,
  style,
  particleCount = DEFAULT_PARTICLE_COUNT,
  glowColor = DEFAULT_GLOW_COLOR,
  enableTilt = true,
  clickEffect = true,
  enableMagnetism = true,
  onClick,
  role,
  tabIndex,
  'aria-pressed': ariaPressed,
}) {
  const cardRef = useRef(null);
  const particlesRef = useRef([]);
  const timeoutsRef = useRef([]);
  const memoizedParticles = useRef([]);
  const particlesInitialized = useRef(false);
  const magnetismAnimationRef = useRef(null);
  const isHoveredRef = useRef(false);

  const initializeParticles = useCallback(() => {
    if (particlesInitialized.current || !cardRef.current) return;
    const { width, height } = cardRef.current.getBoundingClientRect();
    memoizedParticles.current = Array.from({ length: particleCount }, () =>
      createParticleElement(Math.random() * width, Math.random() * height, glowColor)
    );
    particlesInitialized.current = true;
  }, [particleCount, glowColor]);

  const clearAllParticles = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    magnetismAnimationRef.current?.kill();
    particlesRef.current.forEach((p) => {
      gsap.to(p, {
        scale: 0, opacity: 0, duration: 0.3, ease: 'back.in(1.7)',
        onComplete: () => p.parentNode?.removeChild(p),
      });
    });
    particlesRef.current = [];
  }, []);

  const animateParticles = useCallback(() => {
    if (!cardRef.current || !isHoveredRef.current) return;
    if (!particlesInitialized.current) initializeParticles();
    memoizedParticles.current.forEach((particle, index) => {
      const timeoutId = setTimeout(() => {
        if (!isHoveredRef.current || !cardRef.current) return;
        const clone = particle.cloneNode(true);
        cardRef.current.appendChild(clone);
        particlesRef.current.push(clone);
        gsap.fromTo(clone, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(1.7)' });
        gsap.to(clone, {
          x: (Math.random() - 0.5) * 100,
          y: (Math.random() - 0.5) * 100,
          rotation: Math.random() * 360,
          duration: 2 + Math.random() * 2,
          ease: 'none',
          repeat: -1,
          yoyo: true,
        });
        gsap.to(clone, { opacity: 0.3, duration: 1.5, ease: 'power2.inOut', repeat: -1, yoyo: true });
      }, index * 100);
      timeoutsRef.current.push(timeoutId);
    });
  }, [initializeParticles]);

  useEffect(() => {
    if (disableAnimations || !cardRef.current) return;
    const el = cardRef.current;

    const handleMouseEnter = () => {
      isHoveredRef.current = true;
      animateParticles();
      if (enableTilt) {
        gsap.to(el, { rotateX: 5, rotateY: 5, duration: 0.3, ease: 'power2.out', transformPerspective: 1000 });
      }
    };
    const handleMouseLeave = () => {
      isHoveredRef.current = false;
      clearAllParticles();
      if (enableTilt) gsap.to(el, { rotateX: 0, rotateY: 0, duration: 0.3, ease: 'power2.out' });
      if (enableMagnetism) gsap.to(el, { x: 0, y: 0, duration: 0.3, ease: 'power2.out' });
    };
    const handleMouseMove = (e) => {
      if (!enableTilt && !enableMagnetism) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      if (enableTilt) {
        const rotateX = ((y - centerY) / centerY) * -10;
        const rotateY = ((x - centerX) / centerX) * 10;
        gsap.to(el, { rotateX, rotateY, duration: 0.1, ease: 'power2.out', transformPerspective: 1000 });
      }
      if (enableMagnetism) {
        const magnetX = (x - centerX) * 0.05;
        const magnetY = (y - centerY) * 0.05;
        magnetismAnimationRef.current = gsap.to(el, { x: magnetX, y: magnetY, duration: 0.3, ease: 'power2.out' });
      }
    };
    const handleClick = (e) => {
      // Flip immediately; ripple runs in parallel so click works even while hovering.
      onClick?.(e);

      if (!clickEffect) return;

      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const maxDistance = Math.max(
        Math.hypot(x, y),
        Math.hypot(x - rect.width, y),
        Math.hypot(x, y - rect.height),
        Math.hypot(x - rect.width, y - rect.height)
      );
      const ripple = document.createElement('div');
      ripple.style.cssText = `
        position: absolute;
        width: ${maxDistance * 2}px;
        height: ${maxDistance * 2}px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(${DEFAULT_GLOW_COLOR}, 0.4) 0%, rgba(${DEFAULT_GLOW_COLOR}, 0.2) 30%, transparent 70%);
        left: ${x - maxDistance}px;
        top: ${y - maxDistance}px;
        pointer-events: none;
        z-index: 1000;
      `;
      el.appendChild(ripple);
      gsap.fromTo(ripple, { scale: 0, opacity: 1 }, {
        scale: 1, opacity: 0, duration: 0.8, ease: 'power2.out',
        onComplete: () => ripple.remove()
      });
    };

    el.addEventListener('mouseenter', handleMouseEnter);
    el.addEventListener('mouseleave', handleMouseLeave);
    el.addEventListener('mousemove', handleMouseMove);
    el.addEventListener('click', handleClick);

    return () => {
      isHoveredRef.current = false;
      el.removeEventListener('mouseenter', handleMouseEnter);
      el.removeEventListener('mouseleave', handleMouseLeave);
      el.removeEventListener('mousemove', handleMouseMove);
      el.removeEventListener('click', handleClick);
      clearAllParticles();
    };
  }, [animateParticles, clearAllParticles, disableAnimations, enableTilt, enableMagnetism, clickEffect, onClick]);

  return (
    <div
      ref={cardRef}
      className={`${className} particle-container`}
      style={{ ...style, position: 'relative', overflow: 'hidden', cursor: 'pointer' }}
      role={role}
      tabIndex={tabIndex}
      aria-pressed={ariaPressed}
    >
      {children}
    </div>
  );
}

/* ---------- Global Spotlight ---------- */
function GlobalSpotlight({ gridRef, disableAnimations = false, enabled = true, spotlightRadius = DEFAULT_SPOTLIGHT_RADIUS }) {
  const spotlightRef = useRef(null);
  const isInsideSection = useRef(false);

  useEffect(() => {
    if (disableAnimations || !gridRef?.current || !enabled) return;

    const spotlight = document.createElement('div');
    spotlight.className = 'global-spotlight';
    spotlight.style.cssText = `
      position: fixed;
      width: 800px;
      height: 800px;
      border-radius: 50%;
      pointer-events: none;
      background: radial-gradient(circle,
        rgba(${DEFAULT_GLOW_COLOR}, 0.15) 0%,
        rgba(${DEFAULT_GLOW_COLOR}, 0.08) 15%,
        rgba(${DEFAULT_GLOW_COLOR}, 0.04) 25%,
        rgba(${DEFAULT_GLOW_COLOR}, 0.02) 40%,
        rgba(${DEFAULT_GLOW_COLOR}, 0.01) 65%,
        transparent 70%
      );
      z-index: 200;
      opacity: 0;
      transform: translate(-50%, -50%);
      mix-blend-mode: screen;
    `;
    document.body.appendChild(spotlight);
    spotlightRef.current = spotlight;

    const handleMouseMove = (e) => {
      if (!spotlightRef.current || !gridRef.current) return;
      const section = gridRef.current.closest('.bento-section');
      const rect = section?.getBoundingClientRect();
      const mouseInside =
        rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;

      isInsideSection.current = mouseInside || false;
      const cards = gridRef.current.querySelectorAll('.card');

      if (!mouseInside) {
        gsap.to(spotlightRef.current, { opacity: 0, duration: 0.3, ease: 'power2.out' });
        cards.forEach((card) => card.style.setProperty('--glow-intensity', '0'));
        return;
      }

      const { proximity, fadeDistance } = calculateSpotlightValues(spotlightRadius);
      let minDistance = Infinity;

      cards.forEach((card) => {
        const cardRect = card.getBoundingClientRect();
        const centerX = cardRect.left + cardRect.width / 2;
        const centerY = cardRect.top + cardRect.height / 2;
        const distance =
          Math.hypot(e.clientX - centerX, e.clientY - centerY) - Math.max(cardRect.width, cardRect.height) / 2;
        const effectiveDistance = Math.max(0, distance);

        minDistance = Math.min(minDistance, effectiveDistance);

        let glowIntensity = 0;
        if (effectiveDistance <= proximity) glowIntensity = 1;
        else if (effectiveDistance <= fadeDistance) glowIntensity = (fadeDistance - effectiveDistance) / (fadeDistance - proximity);

        updateCardGlowProperties(card, e.clientX, e.clientY, glowIntensity, spotlightRadius);
      });

      gsap.to(spotlightRef.current, { left: e.clientX, top: e.clientY, duration: 0.1, ease: 'power2.out' });

      const targetOpacity =
        minDistance <= proximity
          ? 0.8
          : minDistance <= fadeDistance
            ? ((fadeDistance - minDistance) / (fadeDistance - proximity)) * 0.8
            : 0;

      gsap.to(spotlightRef.current, {
        opacity: targetOpacity,
        duration: targetOpacity > 0 ? 0.2 : 0.5,
        ease: 'power2.out'
      });
    };

    const handleMouseLeave = () => {
      isInsideSection.current = false;
      gridRef.current?.querySelectorAll('.card').forEach((card) => {
        card.style.setProperty('--glow-intensity', '0');
      });
      if (spotlightRef.current) {
        gsap.to(spotlightRef.current, { opacity: 0, duration: 0.3, ease: 'power2.out' });
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      spotlightRef.current?.parentNode?.removeChild(spotlightRef.current);
    };
  }, [gridRef, disableAnimations, enabled, spotlightRadius]);

  return null;
}

/* ---------- Page (Bento + 3D flip) ---------- */
export default function TileGrid() {
  // Single flipped target; also track which card is currently animating to toggle blur/title-hiding.
  const [flippedIndex, setFlippedIndex] = useState(null);
  const [flippingIndex, setFlippingIndex] = useState(null);

  const handleCardClick = (index) => {
    // Start flip immediately (fixes "must move cursor off" issue).
    setFlippingIndex(index);
    setFlippedIndex((prev) => (prev === index ? null : index));
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
        'Determined humidity as most predictive',
        'Weather alone underperforms due to data chunking',
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

  const gridRef = useRef(null);
  const isMobile = useMobileDetection();
  const disableFancy = isMobile;

  return (
    <section className="relative bg-dark min-h-screen">
      <SnakeBackdrop />

      <div className="relative z-10 pt-24 sm:pt-28 pb-12">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-white font-bold tracking-tight mb-8 sm:mb-12 text-4xl sm:text-6xl md:text-7xl">
            MY PROJECTS
          </h2>

          <GlobalSpotlight
            gridRef={gridRef}
            disableAnimations={disableFancy}
            enabled={!disableFancy}
            spotlightRadius={DEFAULT_SPOTLIGHT_RADIUS}
          />

          <div className="card-grid bento-section" ref={gridRef}>
            {tiles.map((tile, index) => {
              const isFlipped = flippedIndex === index;
              const isFlippingNow = flippingIndex === index;

              return (
                <ParticleCard
                  key={index}
                  className={`card card--text-autohide card--border-glow flip-3d ${isFlipped ? 'flipped' : ''} ${isFlippingNow ? 'flipping' : ''}`}
                  style={{ backgroundColor: '#060010', '--glow-color': DEFAULT_GLOW_COLOR }}
                  disableAnimations={disableFancy}
                  particleCount={DEFAULT_PARTICLE_COUNT}
                  enableTilt={!disableFancy}
                  clickEffect={!disableFancy}
                  enableMagnetism={!disableFancy}
                  onClick={() => handleCardClick(index)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isFlipped}
                >
                  <div
                    className="flip-3d-inner"
                    onTransitionEnd={(e) => {
                      // Only clear when the flip rotation finishes on this card
                      if (e.propertyName === 'transform' && flippingIndex === index) {
                        setFlippingIndex(null);
                      }
                    }}
                  >
                    {/* Front face */}
                    <div className="flip-face front">
                      <div className="relative h-full w-full">
                        <div className="p-3">
                          <ResponsiveLottie animationData={tile.animation} />
                        </div>
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <h3 className="overlay-title inline-block rounded-full bg-black/45 text-white font-bold py-2 px-4 text-lg sm:text-xl backdrop-blur-md">
                            {tile.title}
                          </h3>
                        </div>
                      </div>
                    </div>

                    {/* Back face */}
                    <div className="flip-face back">
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
                          <div className="mt-auto pt-4 text-sm text-gray-400">
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </ParticleCard>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
