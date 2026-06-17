// Fullscreen survival sand game at /game. The player character moves with WASD,
// jumps with Space, and uses reach-limited/cooldown tools (mine with RMB, place
// with the selected material via LMB) — the camera follows. It's the same
// <sand-game> Web Component as the About background, in survival mode, given the
// whole viewport.

import React, { useEffect } from 'react';
import './sand/embed/sandGame'; // registers the <sand-game> custom element

export default function GamePage() {
  useEffect(() => {
    const prev = document.title;
    document.title = 'Sand Game — Nicholas Mayer-Rupert';
    return () => { document.title = prev; };
  }, []);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-dark">
      <sand-game mode="survival" initial-tool="stone" />

      {/* Back to the portfolio */}
      <a
        href="/"
        className="pointer-events-auto absolute left-3 top-3 z-[80] rounded-full border border-white/20 bg-black/45 px-3 py-1.5 text-sm font-medium text-white/85 backdrop-blur hover:bg-black/65 hover:text-white"
      >
        ← back to site
      </a>

      {/* Controls hint */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-[80] -translate-x-1/2 rounded-full border border-white/15 bg-black/45 px-4 py-1.5 text-center text-xs text-white/75 backdrop-blur sm:text-sm">
        <span className="font-semibold text-white/90">WASD</span> move ·{' '}
        <span className="font-semibold text-white/90">Space</span> jump ·{' '}
        click to mine / build (LMB places, RMB mines) · pick a material on the left
      </div>
    </div>
  );
}
