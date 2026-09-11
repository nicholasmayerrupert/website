import { useCallback, useEffect, useRef, useState } from "react";
import SplitText from "./SplitText";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { SandGame } from "./sand/react/SandGame";

// /fps renders the normal portfolio but flips the hero's sand game into a
// performance-monitoring view (fps / tickrate / timings in the top-right).
const PERF_ROUTE = typeof window !== 'undefined' &&
  window.location.pathname.replace(/\/+$/, '') === '/fps';
const MOBILE_UI_QUERY = '(max-width: 767px), (pointer: coarse)';
const NAME_IDLE_MS = 10_000;

const Hero = ({ onDrawModeChange }) => {
  const nameTimerRef = useRef(0);
  const [drawModeActive, setDrawModeActive] = useState(false);
  const [nameHidden, setNameHidden] = useState(false);
  const mobileUi = useMediaQuery(MOBILE_UI_QUERY);
  const [sandReady, setSandReady] = useState(false);

  const handleDrawModeChange = (active) => {
    setDrawModeActive(active);
    onDrawModeChange?.(active);
  };

  const noteGameInteraction = useCallback(() => {
    if (mobileUi) return;
    setNameHidden(true);
    clearTimeout(nameTimerRef.current);
    nameTimerRef.current = window.setTimeout(() => {
      nameTimerRef.current = 0;
      setNameHidden(false);
    }, NAME_IDLE_MS);
  }, [mobileUi]);

  const handleSandReady = useCallback(() => {
    setSandReady(true);
  }, []);

  useEffect(() => () => {
    clearTimeout(nameTimerRef.current);
  }, []);

  useEffect(() => {
    if (!mobileUi) return;
    clearTimeout(nameTimerRef.current);
    nameTimerRef.current = 0;
    setNameHidden(false);
  }, [mobileUi]);

  const desktopNameHidden = !mobileUi && nameHidden;
  const mobileNameDimmed = mobileUi && drawModeActive;

  return (
    <section className="relative h-[100svh] overflow-hidden bg-[#222222] md:h-[100dvh]">
      <div className="absolute inset-0 z-10">
        <SandGame
          mode="creative"
          onDrawModeChange={handleDrawModeChange}
          onInteraction={noteGameInteraction}
          onReady={handleSandReady}
          perfHud={PERF_ROUTE}
          debugHitboxes={PERF_ROUTE}
        />
      </div>

      {/* Text block */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-20 px-6 text-center text-white transition-opacity duration-500 sm:px-12 md:top-36 lg:top-40 ${
          desktopNameHidden
            ? 'z-20 opacity-0'
            : mobileNameDimmed
              ? 'z-0 opacity-20'
              : 'z-20 opacity-100'
        }`}
        aria-hidden={desktopNameHidden || mobileNameDimmed}
      >
        <SplitText
          text="NICHOLAS MAYER-RUPERT"
          className="max-w-full text-[clamp(1.9rem,9.5vw,3rem)] sm:text-6xl md:text-7xl lg:text-8xl font-bold mb-4 md:mb-6 leading-tight md:leading-none"
        />
      </div>

      {/* Fades: above simulation, below text */}
      <div className="pointer-events-none absolute top-0 left-0 w-full h-[18svh] md:h-[20vh] bg-gradient-to-b from-[#121212] to-transparent z-10" />
      <div className="pointer-events-none absolute bottom-0 left-0 w-full h-[8svh] md:h-[10vh] bg-gradient-to-t from-[#050506] to-transparent z-10" />

      {mobileUi && !sandReady && (
        <button
          type="button"
          className="absolute bottom-[calc(24px+env(safe-area-inset-bottom,0px))] left-1/2 z-30 h-14 w-[min(72vw,320px)] -translate-x-1/2 rounded-2xl border border-white/30 bg-slate-950/65 text-[15px] font-bold tracking-[.12em] text-white shadow-2xl backdrop-blur-md transition active:bg-white active:text-slate-900 disabled:cursor-wait disabled:text-white/70"
          disabled
          aria-busy={!sandReady}
        >
          LOADING…
        </button>
      )}
    </section>
  );
};

export default Hero;
