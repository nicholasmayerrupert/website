import { useState } from "react";
import SplitText from "./SplitText";
import { SandGame } from "./sand/react/SandGame";

const Hero = () => {
  const [drawModeActive, setDrawModeActive] = useState(false);

  return (
    <section className="relative h-[100dvh] overflow-hidden bg-[#222222]">
      <div className="absolute inset-0 z-10">
        <SandGame mode="creative" onDrawModeChange={setDrawModeActive} />
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
      <div className="pointer-events-none absolute top-0 left-0 w-full h-[18vh] md:h-[20vh] bg-gradient-to-b from-[#121212] to-transparent z-10" />
      <div className="pointer-events-none absolute bottom-0 left-0 w-full h-[18vh] md:h-[20vh] bg-gradient-to-t from-[#121212] to-transparent z-10" />
    </section>
  );
};

export default Hero;
