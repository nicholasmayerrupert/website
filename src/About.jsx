import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Lottie from 'react-lottie';
import animationData from './laptop.json';

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

/* ---------- PONG OVERLAY (left = player, right = AI) ---------- */
function PongOverlay() {
  const overlayRef = useRef(null);
  const canvasRef = useRef(null);
  const ctrlRef = useRef(null); // left-side control region

  const [paused, setPaused] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();

  const pausedRef = useRef(false);
  const rmRef = useRef(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { rmRef.current = prefersReducedMotion; }, [prefersReducedMotion]);

  useEffect(() => {
    if (!overlayRef.current || !canvasRef.current || !ctrlRef.current) return;

    const wrapper = overlayRef.current; // absolute, fills the section
    const canvas = canvasRef.current;
    const ctrl = ctrlRef.current;       // only this area consumes touch
    const ctx = canvas.getContext('2d', { alpha: true }); // transparent

    // Size canvas to wrapper (entire section)
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

    // World dims (CSS pixels)
    const world = () => {
      const r = wrapper.getBoundingClientRect();
      return { w: r.width || 600, h: r.height || 400 };
    };

    // Game objects
    let { w, h } = world();
    const PAD_W = 12;
    const PAD_H = Math.max(60, Math.min(160, h * 0.22));
    const PAD_MARGIN = 18;
    const BALL_R = 8;
    const PADDLE_SPEED = 520;
    const AI_SPEED = 420;
    const BALL_SPEED = 360;
    const BALL_SPEED_MAX = 780;
    const BALL_SPEED_INC = 1.05;

    const left = { x: PAD_MARGIN, y: (h - PAD_H) / 2, vy: 0 };
    const right = { x: w - PAD_MARGIN - PAD_W, y: (h - PAD_H) / 2, vy: 0 };
    const ball = { x: w / 2, y: h / 2, vx: BALL_SPEED, vy: BALL_SPEED * 0.35 };
    if (Math.random() < 0.5) ball.vx *= -1;
    if (Math.random() < 0.5) ball.vy *= -1;

    let last = performance.now();
    let anim = 0;

    // Keyboard (optional)
    const keys = new Set();
    const onKey = (e) => {
      if (e.type === 'keydown') {
        if (e.code === 'Space') { e.preventDefault(); setPaused(p => !p); return; }
        keys.add(e.code);
      } else {
        keys.delete(e.code);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    // Left-side input only
    // Touch: relative drag inside control region (thumb-friendly)
    // Mouse: absolute drag
    let dragging = false;
    let mode = 'absolute';
    const TOUCH_SENSITIVITY = 1.25;
    let startTouchY = 0;
    let startPaddleY = 0;

    const getYWithinOverlay = (evt) => {
      const rect = overlayRef.current.getBoundingClientRect();
      const t = evt.touches && evt.touches[0];
      const clientY = t ? t.clientY : evt.clientY;
      return clientY - rect.top;
    };

    const onCtrlPointerDown = (e) => {
      // Only this left control area has touch-action:none, so it won’t scroll
      dragging = true;
      if (e.pointerType === 'touch') {
        mode = 'relative';
        startTouchY = getYWithinOverlay(e);
        startPaddleY = left.y;
        e.preventDefault();
        // capture subsequent moves on this element
        if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
      } else {
        mode = 'absolute';
        const y = getYWithinOverlay(e);
        left.y = Math.max(0, Math.min(h - PAD_H, y - PAD_H / 2));
      }
    };

    const onCtrlPointerMove = (e) => {
      if (!dragging) return;
      if (e.pointerType === 'touch') e.preventDefault();
      const y = getYWithinOverlay(e);
      if (mode === 'relative') {
        const dy = (y - startTouchY) * TOUCH_SENSITIVITY;
        left.y = Math.max(0, Math.min(h - PAD_H, startPaddleY + dy));
      } else {
        left.y = Math.max(0, Math.min(h - PAD_H, y - PAD_H / 2));
      }
    };

    const onCtrlPointerUp = (e) => {
      dragging = false;
      if (e.currentTarget.releasePointerCapture) {
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      }
    };

    // Attach handlers to LEFT control region only
    ctrl.addEventListener('pointerdown', onCtrlPointerDown, { passive: false });
    ctrl.addEventListener('pointermove', onCtrlPointerMove,  { passive: false });
    ctrl.addEventListener('pointerup',   onCtrlPointerUp,    { passive: false });
    ctrl.addEventListener('pointercancel', onCtrlPointerUp,  { passive: false });
    ctrl.addEventListener('pointerleave',  onCtrlPointerUp,  { passive: false });

    // Resize
    const ro = new ResizeObserver(() => {
      setCanvasSize();
      const dim = world();
      w = dim.w; h = dim.h;
      right.x = w - PAD_MARGIN - PAD_W;
      left.y = Math.max(0, Math.min(h - PAD_H, left.y));
      right.y = Math.max(0, Math.min(h - PAD_H, right.y));
      ball.x = Math.max(BALL_R, Math.min(w - BALL_R, ball.x));
      ball.y = Math.max(BALL_R, Math.min(h - BALL_R, ball.y));
    });
    ro.observe(wrapper);

    const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

    // Loop
    const step = (now) => {
      anim = requestAnimationFrame(step);
      let dt = (now - last) / 1000;
      if (dt > 0.033) dt = 0.033;
      last = now;

      const actuallyPaused = pausedRef.current || rmRef.current;

      const upL = keys.has('KeyW');
      const downL = keys.has('KeyS');

      if (!actuallyPaused) {
        // Keyboard nudges add on top of touch/drag
        const keyboardVy = (upL ? -PADDLE_SPEED : 0) + (downL ? PADDLE_SPEED : 0);
        if (keyboardVy !== 0) {
          left.y = clamp(left.y + keyboardVy * dt, 0, h - PAD_H);
        }

        // Ball
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;

        // Top/bottom
        if (ball.y < BALL_R) { ball.y = BALL_R; ball.vy *= -1; }
        if (ball.y > h - BALL_R) { ball.y = h - BALL_R; ball.vy *= -1; }

        // Collision
        const collidePaddle = (pad) => {
          const withinY = ball.y > pad.y && ball.y < pad.y + PAD_H;
          if (!withinY) return false;
          const rel = (ball.y - (pad.y + PAD_H / 2)) / (PAD_H / 2);
          ball.vx *= -1;
          ball.vx = clamp(ball.vx * BALL_SPEED_INC, -BALL_SPEED_MAX, BALL_SPEED_MAX);
          ball.vy = clamp((ball.vy + rel * 240) * 1.01, -BALL_SPEED_MAX, BALL_SPEED_MAX);
          return true;
        };

        if (ball.x - BALL_R <= left.x + PAD_W) {
          if (collidePaddle(left)) ball.x = left.x + PAD_W + BALL_R + 0.5;
        }

        // AI (right)
        const goingRight = ball.vx > 0;
        const lookahead = goingRight ? Math.min(0.2, (right.x - ball.x) / Math.abs(ball.vx)) : 0.06;
        const targetYCenter = ball.y + ball.vy * lookahead;
        const targetY = clamp(targetYCenter - PAD_H / 2, 0, h - PAD_H);
        const dy = targetY - right.y;
        right.y = clamp(right.y + clamp(dy, -AI_SPEED * dt, AI_SPEED * dt), 0, h - PAD_H);

        if (ball.x + BALL_R >= right.x) {
          if (collidePaddle(right)) ball.x = right.x - BALL_R - 0.5;
        }

        // Reset if out of bounds
        const reset = (dir) => {
          ball.x = w / 2; ball.y = h / 2;
          const angle = (Math.random() * 0.6 - 0.3) * Math.PI / 3;
          const speed = BALL_SPEED;
          ball.vx = Math.cos(angle) * speed * dir;
          ball.vy = Math.sin(angle) * speed;
        };
        if (ball.x < -40) reset(1);
        if (ball.x > w + 40) reset(-1);
      }

      // Draw (transparent)
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.fillRect(left.x, left.y, PAD_W, PAD_H);
      ctx.fillRect(right.x, right.y, PAD_W, PAD_H);
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
    };

    anim = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(anim);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      ctrl.removeEventListener('pointerdown', onCtrlPointerDown);
      ctrl.removeEventListener('pointermove', onCtrlPointerMove);
      ctrl.removeEventListener('pointerup', onCtrlPointerUp);
      ctrl.removeEventListener('pointercancel', onCtrlPointerUp);
      ctrl.removeEventListener('pointerleave', onCtrlPointerUp);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-30"
      aria-hidden="false"
    >
      {/* Full-bleed game canvas (does not block scroll) */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        role="img"
        aria-label="Pong overlay"
      />

      {/* Left-side control region only (captures touch; right side scrolls) */}
      <div
        ref={ctrlRef}
        className="absolute inset-y-0 left-0 w-[65%] pointer-events-auto touch-none select-none"
        style={{ touchAction: 'none', WebkitUserSelect: 'none' }}
        aria-hidden="true"
      />
    </div>
  );
}


/* ---------- PAGE ---------- */
export default function About() {
  return (
    <section className="relative bg-dark">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-24 sm:pt-32 pb-12">
        <div className="flex flex-col-reverse md:flex-row items-center md:items-start gap-8 md:gap-10">
          {/* Right-aligned Text on desktop; centered on mobile */}
          <div className="w-full md:w-1/2">
            <h2 className="text-white font-bold tracking-tight text-center md:text-right text-4xl sm:text-6xl md:text-7xl">
              SKILLS & <br className="hidden sm:block" /> EXPERIENCE
            </h2>

            <div className="mt-6 md:mt-8 md:ml-auto md:max-w-xl space-y-6">
              {/* Programming Languages */}
              <div className="bg-gray-900 rounded-lg p-4 sm:p-6 shadow-lg overflow-x-auto">
                <pre className="text-sm sm:text-base text-left text-white whitespace-pre">
                  <code>
                    <span className="text-blue-400">// Define a dictionary with the languages I know</span>{'\n'}
                    <span className="text-red-500">const</span> <span className="text-purple-300">programmingLanguages</span> = {'{\n'}
                    <span className="text-yellow-500">    languages</span>: ['<span className="text-green-500">C++</span>', '<span className="text-green-500">Python</span>', '<span className="text-green-500">Java</span>'],{'\n'}
                    {'};'}{'\n'}
                  </code>
                </pre>
              </div>

              {/* Frameworks and Libraries */}
              <div className="bg-gray-900 rounded-lg p-4 sm:p-6 shadow-lg overflow-x-auto">
                <pre className="text-sm sm:text-base text-left text-white whitespace-pre">
                  <code>
                    <span className="text-blue-400">// Frameworks and libraries I've worked with</span>{'\n'}
                    <span className="text-red-500">const</span> <span className="text-purple-300">frameworksAndLibraries</span> = {'{\n'}
                    <span className="text-yellow-500">    frameworks</span>: ['<span className="text-green-500">React</span>', '<span className="text-green-500">Node.js</span>'],{'\n'}
                    <span className="text-yellow-500">    libraries</span>: ['<span className="text-green-500">Pandas</span>','<span className="text-green-500">Matplotlib</span>','<span className="text-green-500">NumPy</span>', '<span className="text-green-500">OpenCV</span>'],{'\n'}
                    {'};'}{'\n'}
                  </code>
                </pre>
              </div>

              {/* Additional Skills */}
              <div className="bg-gray-900 rounded-lg p-4 sm:p-6 shadow-lg overflow-x-auto">
                <pre className="text-sm sm:text-base text-left text-white whitespace-pre">
                  <code>
                    <span className="text-blue-400">// Additional skills I've developed</span>{'\n'}
                    <span className="text-red-500">const</span> <span className="text-purple-300">additionals</span> = ['<span className="text-green-500">Chess</span>', '<span className="text-green-500">Pixel Art</span>', '<span className="text-green-500">Data Science</span>'];{'\n'}
                  </code>
                </pre>
              </div>
            </div>
          </div>

          {/* Left column: Lottie */}
          <div className="w-full md:w-1/2 flex flex-col items-center md:items-start gap-6">
            <div className="w-full max-w-md sm:max-w-lg md:max-w-none">
              <div style={{ transform: 'scaleX(-1)' }}>
                <ResponsiveLottie animationData={animationData} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Full-section Pong overlay */}
      <PongOverlay />
    </section>
  );
}
