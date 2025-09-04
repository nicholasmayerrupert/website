import React, { useEffect, useRef, useState } from 'react';
import { FaGithub, FaLinkedin } from 'react-icons/fa';

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


/* ---------- PONG OVERLAY (half-activation AI; left starts AI, switches to player on input) ---------- */
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

    let { w, h } = world();
    const PAD_W = 12;
    const PAD_H = Math.max(60, Math.min(160, h * 0.22));
    const PAD_MARGIN = 18;
    const BALL_R = 8;

    const PADDLE_SPEED = 520;
    const AI_SPEED = 420;
    const AI_IDLE_SPEED = 280; // gentle drift back to center when inactive
    const BALL_SPEED = 360;
    const BALL_SPEED_MAX = 780;
    const BALL_SPEED_INC = 1.05;

    const left = { x: PAD_MARGIN, y: (h - PAD_H) / 2, vy: 0 };
    const right = { x: w - PAD_MARGIN - PAD_W, y: (h - PAD_H) / 2, vy: 0 };
    const ball = { x: w / 2, y: h / 2, vx: BALL_SPEED, vy: BALL_SPEED * 0.35 };
    if (Math.random() < 0.5) ball.vx *= -1;
    if (Math.random() < 0.5) ball.vy *= -1;

    // left starts AI, flips to player on first input
    let leftMode = 'auto'; // 'auto' | 'player'

    let last = performance.now();
    let anim = 0;

    // Keyboard
    const keys = new Set();
    const onKey = (e) => {
      if (e.type === 'keydown') {
        if (e.code === 'Space') { e.preventDefault(); setPaused(p => !p); return; }
        keys.add(e.code);
        if (e.code === 'KeyW' || e.code === 'KeyS' || e.code === 'ArrowUp' || e.code === 'ArrowDown') {
          leftMode = 'player';
        }
      } else {
        keys.delete(e.code);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    // Pointer controls (left region only)
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
      leftMode = 'player';
      dragging = true;
      if (e.pointerType === 'touch') {
        mode = 'relative';
        startTouchY = getYWithinOverlay(e);
        startPaddleY = left.y;
        e.preventDefault();
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

    const ctrlEl = ctrlRef.current;
    if (!ctrlEl) return;
    ctrlEl.addEventListener('pointerdown', onCtrlPointerDown, { passive: false });
    ctrlEl.addEventListener('pointermove', onCtrlPointerMove,  { passive: false });
    ctrlEl.addEventListener('pointerup',   onCtrlPointerUp,    { passive: false });
    ctrlEl.addEventListener('pointercancel', onCtrlPointerUp,  { passive: false });
    ctrlEl.addEventListener('pointerleave',  onCtrlPointerUp,  { passive: false });

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
    const centerY = (h - PAD_H) / 2;

    // AI driver
    const drivePaddleAI = (pad, targetX, dt) => {
      const goingTowardPad = (targetX > ball.x && ball.vx > 0) || (targetX < ball.x && ball.vx < 0);
      const travelTime = goingTowardPad ? Math.min(0.2, Math.abs(targetX - ball.x) / Math.max(Math.abs(ball.vx), 1e-3)) : 0.06;
      const aimYCenter = ball.y + ball.vy * travelTime;
      const aimTop = clamp(aimYCenter - PAD_H / 2, 0, h - PAD_H);
      const dy = aimTop - pad.y;
      pad.y = clamp(pad.y + clamp(dy, -AI_SPEED * dt, AI_SPEED * dt), 0, h - PAD_H);
    };

    const relaxToCenter = (pad, dt) => {
      const dy = centerY - pad.y;
      pad.y = clamp(pad.y + clamp(dy, -AI_IDLE_SPEED * dt, AI_IDLE_SPEED * dt), 0, h - PAD_H);
    };

    // Loop
    const step = (now) => {
      anim = requestAnimationFrame(step);
      let dt = (now - last) / 1000;
      if (dt > 0.033) dt = 0.033;
      last = now;

      const actuallyPaused = pausedRef.current || rmRef.current;
      if (!actuallyPaused) {
        // Activation band around center to avoid both paddles moving
        const MID = w / 2;
        const BAND = Math.max(40, w * 0.04); // a little hysteresis so both don't trigger

        const leftActive  = (ball.vx < 0 && ball.x <= MID + BAND);  // ball moving left and on/near left half
        const rightActive = (ball.vx > 0 && ball.x >= MID - BAND); // ball moving right and on/near right half

        // LEFT paddle
        if (leftMode === 'player') {
          const keyboardVy =
            (keys.has('KeyW') || keys.has('ArrowUp') ? -PADDLE_SPEED : 0) +
            (keys.has('KeyS') || keys.has('ArrowDown') ? PADDLE_SPEED : 0);
          if (keyboardVy !== 0) left.y = clamp(left.y + keyboardVy * dt, 0, h - PAD_H);
          // pointer drag already updates left.y
        } else {
          if (leftActive) drivePaddleAI(left, left.x + PAD_W / 2, dt);
          else relaxToCenter(left, dt);
        }

        // RIGHT paddle (always AI, but only when active)
        if (rightActive) drivePaddleAI(right, right.x + PAD_W / 2, dt);
        else relaxToCenter(right, dt);

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

      // Draw
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
      ctrlEl.removeEventListener('pointerdown', onCtrlPointerDown);
      ctrlEl.removeEventListener('pointermove', onCtrlPointerMove);
      ctrlEl.removeEventListener('pointerup', onCtrlPointerUp);
      ctrlEl.removeEventListener('pointercancel', onCtrlPointerUp);
      ctrlEl.removeEventListener('pointerleave', onCtrlPointerUp);
      ro.disconnect();
    };
  }, []);

    return (
    <div
        ref={overlayRef}
        className="absolute inset-0 z-30 pointer-events-none" // <-- ignore clicks by default
        aria-hidden="false"
    >
        <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        role="img"
        aria-label="Pong overlay"
        />
        {/* Left control strip only (captures touch/mouse) */}
        <div
        ref={ctrlRef}
        className="absolute inset-y-0 left-0 pointer-events-auto touch-none select-none
                    w-24 sm:w-40 md:w-56 lg:w-64" // <-- much narrower than 65%
        style={{ touchAction: 'none', WebkitUserSelect: 'none' }}
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
      <PongOverlay />




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
