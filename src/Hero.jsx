import { useState } from "react";
import SplitText from "./SplitText";
import { SandGame } from "./sand/react/SandGame";

// /fps renders the normal portfolio but flips the hero's sand game into a
// performance-monitoring view (fps / tickrate / timings in the top-right).
const PERF_ROUTE = typeof window !== 'undefined' &&
  window.location.pathname.replace(/\/+$/, '') === '/fps';

const Hero = ({ onDrawModeChange }) => {
  const [drawModeActive, setDrawModeActive] = useState(false);
  const handleDrawModeChange = (active) => {
    setDrawModeActive(active);
    onDrawModeChange?.(active);
  };

  return (
    <section className="relative h-[100svh] overflow-hidden bg-[#222222] md:h-[100dvh]">
      <div className="absolute inset-0 z-10">
        <SandGame mode="creative" onDrawModeChange={handleDrawModeChange} perfHud={PERF_ROUTE} debugHitboxes={PERF_ROUTE} />
      </div>

      {/* Text block */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-16 px-6 text-center text-white transition-opacity duration-500 sm:top-20 sm:px-12 md:top-36 lg:top-40 ${
          drawModeActive ? 'z-0 opacity-20' : 'z-20 opacity-100'
        }`}
        aria-hidden={drawModeActive}
      >
        <SplitText
          text="NICHOLAS MAYER-RUPERT"
          className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold mb-4 md:mb-6 leading-tight md:leading-none"
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
    </section>
  );
};

export default Hero;
