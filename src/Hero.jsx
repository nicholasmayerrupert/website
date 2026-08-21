import { useCallback, useEffect, useRef, useState } from "react";
import SplitText from "./SplitText";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { SandBackground } from "./sand/react/SandBackground";
import { SandGame } from "./sand/react/SandGame";

// /fps renders the normal portfolio but flips the hero's sand game into a
// performance-monitoring view (fps / tickrate / timings in the top-right).
const PERF_ROUTE = typeof window !== 'undefined' &&
  window.location.pathname.replace(/\/+$/, '') === '/fps';
const DEFER_SAND_QUERY = '(max-width: 767px), (pointer: coarse)';
const NAME_IDLE_MS = 10_000;

const Hero = ({ onDrawModeChange }) => {
  const nameTimerRef = useRef(0);
  const fallbackTimerRef = useRef(0);
  const [drawModeActive, setDrawModeActive] = useState(false);
  const [nameHidden, setNameHidden] = useState(false);
  const deferSand = useMediaQuery(DEFER_SAND_QUERY);
  const [sandRequested, setSandRequested] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return !window.matchMedia(DEFER_SAND_QUERY).matches;
  });
  const [startRequested, setStartRequested] = useState(false);
  const [sandReady, setSandReady] = useState(false);
  const [fallbackMounted, setFallbackMounted] = useState(true);

  useEffect(() => {
    if (!deferSand) {
      setSandRequested(true);
      return undefined;
    }
    if (sandRequested) return undefined;

    let idle = 0;
    let timer = 0;
    const frame = requestAnimationFrame(() => {
      if (typeof window.requestIdleCallback === 'function') {
        idle = window.requestIdleCallback(
          () => setSandRequested(true),
          { timeout: 1200 },
        );
      } else {
        timer = window.setTimeout(() => setSandRequested(true), 400);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      if (idle) window.cancelIdleCallback?.(idle);
      if (timer) clearTimeout(timer);
    };
  }, [deferSand, sandRequested]);

  const requestSandStart = () => {
    setStartRequested(true);
    setSandRequested(true);
  };

  const handleDrawModeChange = (active) => {
    setDrawModeActive(active);
    onDrawModeChange?.(active);
  };

  const noteGameInteraction = useCallback(() => {
    if (deferSand) return;
    setNameHidden(true);
    clearTimeout(nameTimerRef.current);
    nameTimerRef.current = window.setTimeout(() => {
      nameTimerRef.current = 0;
      setNameHidden(false);
    }, NAME_IDLE_MS);
  }, [deferSand]);

  const handleSandReady = useCallback(() => {
    setSandReady(true);
    clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = window.setTimeout(() => {
      fallbackTimerRef.current = 0;
      setFallbackMounted(false);
    }, 500);
  }, []);

  useEffect(() => () => {
    clearTimeout(nameTimerRef.current);
    clearTimeout(fallbackTimerRef.current);
  }, []);

  useEffect(() => {
    if (!deferSand) return;
    clearTimeout(nameTimerRef.current);
    nameTimerRef.current = 0;
    setNameHidden(false);
  }, [deferSand]);

  const desktopNameHidden = !deferSand && nameHidden;
  const mobileNameDimmed = deferSand && drawModeActive;

  return (
    <section className="relative h-[100svh] overflow-hidden bg-[#222222] md:h-[100dvh]">
      {deferSand && fallbackMounted && (
        <SandBackground
          className={`absolute inset-0 overflow-hidden transition-opacity duration-500 ${
            sandReady ? 'opacity-0' : 'opacity-100'
          }`}
        />
      )}

      {sandRequested && (
        <div className="absolute inset-0 z-10">
          <SandGame
            mode="creative"
            autoStart={startRequested}
            onDrawModeChange={handleDrawModeChange}
            onInteraction={noteGameInteraction}
            onReady={handleSandReady}
            perfHud={PERF_ROUTE}
            debugHitboxes={PERF_ROUTE}
          />
        </div>
      )}

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
          tag="h1"
          textAlign="center"
          splitType="words,chars"
          delay={30}
          duration={0.3}
        />
      </div>

      {/* Fades: above simulation, below text */}
      <div className="pointer-events-none absolute top-0 left-0 w-full h-[18svh] md:h-[20vh] bg-gradient-to-b from-[#121212] to-transparent z-10" />
      <div className="pointer-events-none absolute bottom-0 left-0 w-full h-[8svh] md:h-[10vh] bg-gradient-to-t from-[#050506] to-transparent z-10" />

      {deferSand && !sandReady && (
        <button
          type="button"
          className="absolute bottom-[calc(24px+env(safe-area-inset-bottom,0px))] left-1/2 z-30 h-14 w-[min(72vw,320px)] -translate-x-1/2 rounded-2xl border border-white/30 bg-slate-950/65 text-[15px] font-bold tracking-[.12em] text-white shadow-2xl backdrop-blur-md transition active:bg-white active:text-slate-900 disabled:cursor-wait disabled:text-white/70"
          onClick={requestSandStart}
          disabled={sandRequested}
          aria-busy={sandRequested}
        >
          {sandRequested ? 'LOADING…' : 'START'}
        </button>
      )}
    </section>
  );
};

export default Hero;
