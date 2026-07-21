// Fullscreen survival sand game at /game. The player character moves with WASD,
// jumps with Space, and uses reach-limited survival actions from the selected
// inventory slot — the camera follows. It's the same
// <sand-game> Web Component as the About background, in survival mode, given the
// whole viewport.
//
// DESKTOP-ONLY for now. The sandbox needs a mouse + keyboard, and the WASM
// engine is heavy, so on small / coarse-pointer devices we render a friendly
// message and never mount <sand-game> (so the engine never loads). The NavBar's
// PLAY button is also hidden on mobile, but this gate also covers anyone who
// hand-types /game.
//
// ─── Future: mobile creative controls (notes only) ───────────────────────────
// The current touch experience fights page scrolling and has tiny targets.
// A real mobile creative mode would want:
//   • A bottom touch toolbar with large tap targets (mine / place / select).
//   • Tap-to-place and drag-to-paint, with an explicit "draw vs scroll" toggle so
//     the page can still scroll when the user isn't actively painting.
//   • A floating action button (FAB) that opens the material picker as a
//     bottom sheet instead of the cramped left rail.
//   • Pinch-to-zoom + two-finger pan for camera control (one finger = paint).
//   • Haptic tap feedback and a small undo button, since misfires are common.
// Until that exists, mobile stays gated to the message below.

import React, { useEffect } from 'react';
import './sand/embed/sandGame'; // registers the <sand-game> custom element
import { useMediaQuery } from './hooks/useMediaQuery';

// Treat narrow viewports OR coarse-only pointers (phones/tablets) as "mobile".
const MOBILE_QUERY = '(max-width: 767px), (pointer: coarse)';
const PERF_GAME = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('perf');

export default function GamePage() {
  const isMobile = useMediaQuery(MOBILE_QUERY);

  useEffect(() => {
    const prev = document.title;
    document.title = 'Sand Game — Nicholas Mayer-Rupert';
    return () => { document.title = prev; };
  }, []);

  if (isMobile) {
    return (
      <div className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-dark px-6 text-center">
        <div className="max-w-sm">
          <div className="mb-4 text-5xl">🖥️</div>
          <h1 className="mb-3 text-xl font-semibold text-white">
            The sandbox is desktop-only for now
          </h1>
          <p className="text-sm leading-relaxed text-white/70">
            Visit on a larger screen with a mouse and keyboard to dig, build, and
            explore. Touch controls are coming later.
          </p>
          <a
            href="/"
            className="mt-6 inline-flex rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white/85 backdrop-blur transition hover:bg-white/10 hover:text-white"
          >
            ← back to site
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-dark">
      <sand-game mode="survival" initial-tool="stone" perf-hud={PERF_GAME ? '' : undefined} />

      {/* Back to the portfolio */}
      <a
        href="/"
        className="pointer-events-auto absolute left-3 top-3 z-[80] border-2 border-black bg-[#252b31] px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider text-white shadow-[inset_0_0_0_1px_#59636c,4px_4px_0_rgba(0,0,0,.4)] hover:text-[#f0d465]"
      >
        ← back to site
      </a>

      {/* Controls hint */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-[80] -translate-x-1/2 border-2 border-black bg-[#252b31] px-4 py-2 text-center font-mono text-[10px] font-bold uppercase tracking-wide text-white/75 shadow-[inset_0_0_0_1px_#59636c,4px_4px_0_rgba(0,0,0,.4)] sm:text-xs">
        <span className="font-semibold text-white/90">WASD</span> move ·{' '}
        <span className="font-semibold text-white/90">Space</span> jump ·{' '}
        <span className="font-semibold text-[#f0d465]">E</span> inventory + craft ·{' '}
        LMB use / charge · RMB alternate layer
      </div>
    </div>
  );
}
