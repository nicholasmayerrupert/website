// Fullscreen Earth expedition and direct survival sandbox entry.

import { lazy, Suspense, useEffect } from 'react';
const GameStudio = import.meta.env.DEV ? lazy(() => import('./sand/studio/GameStudio.jsx')) : null;
import { useMediaQuery } from './hooks/useMediaQuery';
import { SandGame } from './sand/react/SandGame';
import { SandCampaign } from './sand/react/SandCampaign';

const MOBILE_QUERY = '(max-width: 767px)';
const GAME_QUERY = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search)
  : new URLSearchParams();
const PERF_GAME = GAME_QUERY.has('perf');
const DIRECT_SANDBOX = GAME_QUERY.has('sandbox') || PERF_GAME;

function ControlChip({ keys, children, accent = false }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <kbd className={`border px-1.5 py-1 font-mono text-[14px] font-black leading-none shadow-[2px_2px_0_#080a0c] ${
        accent
          ? 'border-[#e7ca5c] bg-[#4a4020] text-[#ffe783]'
          : 'border-[#65717b] bg-[#13171b] text-white'
      }`}>
        {keys}
      </kbd>
      <span className="text-[14px] font-bold tracking-[.1em] text-[#b9c1c8]">{children}</span>
    </span>
  );
}

export default function GamePage() {
  const isMobile = useMediaQuery(MOBILE_QUERY);

  useEffect(() => {
    const prev = document.title;
    document.title = DIRECT_SANDBOX
      ? 'Explosive Survival — Nicholas Mayer-Rupert'
      : 'Aster — Earth Expedition';
    return () => { document.title = prev; };
  }, []);

  if (import.meta.env.DEV && GAME_QUERY.has('studio')) return <Suspense fallback={null}><GameStudio /></Suspense>;
  if (!DIRECT_SANDBOX) return <SandCampaign />;

  if (isMobile) {
    return (
      <div className="sandbox-experience relative flex min-h-[100svh] w-full items-center justify-center bg-dark px-6 py-6 text-center">
        <div className="max-w-sm">
          <div className="mb-4 text-5xl">🖥️</div>
          <h1 className="mb-3 text-xl font-semibold text-white">
            Explosive Survival is desktop-only for now
          </h1>
          <p className="text-sm leading-relaxed text-white/70">
            Open this page on a larger screen with a mouse and keyboard to mine, build, fight, and tear through the simulated world.
          </p>
          <a
            href="/"
            className="mt-6 inline-flex min-h-11 items-center rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white/85 backdrop-blur transition hover:bg-white/10 hover:text-white"
          >
            ← back to site
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="sandbox-experience relative h-screen w-full overflow-hidden bg-dark">
      <SandGame mode="survival" perfHud={PERF_GAME} />

      {/* Back to the portfolio */}
      <a
        href="/"
        className="group pointer-events-auto absolute left-3 top-3 z-[80] flex items-center border-[3px] border-[#080a0c] bg-[#252b31] p-1 font-mono text-[14px] font-black uppercase tracking-[.12em] text-white shadow-[inset_0_0_0_2px_#59636c,5px_5px_0_rgba(0,0,0,.45)]"
      >
        <span className="mr-2 grid h-7 w-7 place-items-center bg-[#f0d465] text-base text-[#17140a] shadow-[inset_-2px_-2px_0_#b89d3f] transition-colors group-hover:bg-[#ffe783]">←</span>
        <span className="pr-2 transition-colors group-hover:text-[#f0d465]">Portfolio</span>
      </a>

      {/* Controls hint */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-[80] flex -translate-x-1/2 flex-col items-center font-mono uppercase">
        <div className="flex items-center gap-3 border-[3px] border-[#080a0c] bg-[#1b2025]/95 px-3 py-2 shadow-[inset_0_0_0_1px_#48515a,5px_5px_0_rgba(0,0,0,.38)]">
          <ControlChip keys="WASD">Move</ControlChip>
          <ControlChip keys="SPACE">Jump / thrust</ControlChip>
          <ControlChip keys="LMB" accent>Use / fire</ControlChip>
          <ControlChip keys="1—9">Loadout</ControlChip>
          <ControlChip keys="E" accent>Inventory</ControlChip>
          <ControlChip keys="Q">Tool size</ControlChip>
        </div>
      </div>
    </div>
  );
}
