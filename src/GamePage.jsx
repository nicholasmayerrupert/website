// Fullscreen survival entry. Small/coarse-pointer devices do not mount the heavy
// engine because the survival UI still requires desktop input.

import { useEffect } from 'react';
import './sand/embed/sandGame'; // registers the <sand-game> custom element
import { useMediaQuery } from './hooks/useMediaQuery';

const MOBILE_QUERY = '(max-width: 767px), (pointer: coarse)';
const PERF_GAME = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('perf');

export default function GamePage() {
  const isMobile = useMediaQuery(MOBILE_QUERY);

  useEffect(() => {
    const prev = document.title;
    document.title = 'Explosive Survival — Nicholas Mayer-Rupert';
    return () => { document.title = prev; };
  }, []);

  if (isMobile) {
    return (
      <div className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-dark px-6 text-center">
        <div className="max-w-sm">
          <div className="mb-4 text-5xl">🖥️</div>
          <h1 className="mb-3 text-xl font-semibold text-white">
            Explosive Survival is desktop-only for now
          </h1>
          <p className="text-sm leading-relaxed text-white/70">
            Visit on a larger screen with a mouse and keyboard to mine, build,
            fight, and tear through the simulated world. Touch controls are coming later.
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
      <sand-game mode="survival" perf-hud={PERF_GAME ? '' : undefined} />

      {/* Back to the portfolio */}
      <a
        href="/"
        className="pointer-events-auto absolute left-3 top-3 z-[80] border-2 border-black bg-[#252b31] px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider text-white shadow-[inset_0_0_0_1px_#59636c,4px_4px_0_rgba(0,0,0,.4)] hover:text-[#f0d465]"
      >
        ← back to site
      </a>

      {/* Controls hint */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-[80] -translate-x-1/2 border-2 border-black bg-[#252b31] px-4 py-2 text-center font-mono text-[10px] font-bold uppercase tracking-wide text-white/75 shadow-[inset_0_0_0_1px_#59636c,4px_4px_0_rgba(0,0,0,.4)] sm:text-xs">
        <div className="mb-1 text-[#f0d465]">Explosive Survival · work in progress</div>
        <div className="whitespace-nowrap">
          <span className="font-semibold text-white/90">WASD</span> move ·{' '}
          <span className="font-semibold text-white/90">Space</span> jump / jetpack ·{' '}
          <span className="font-semibold text-white/90">Mouse</span> aim ·{' '}
          <span className="font-semibold text-white/90">1–9</span> hotbar
        </div>
        <div className="mt-1 whitespace-nowrap">
          <span className="font-semibold text-[#f0d465]">LMB</span> use / fire ·{' '}
          <span className="font-semibold text-white/90">RMB</span> alternate layer ·{' '}
          <span className="font-semibold text-[#f0d465]">E</span> inventory + craft ·{' '}
          <span className="font-semibold text-white/90">Q</span> tool size
        </div>
        <div className="mt-1 text-[9px] tracking-[.12em] text-[#f08a6a] sm:text-[10px]">
          Objective: survive the demolition crews. Destroy everything in your way.
        </div>
      </div>
    </div>
  );
}
