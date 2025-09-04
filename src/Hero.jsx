import GameOfLife3D from "./GameOfLife3D";

const Hero = () => {
  return (
    <section className="relative flex h-[100dvh] flex-col md:flex-row overflow-hidden bg-[#222222]">
      {/* Text block (top-most) */}
      <div className="relative z-20 order-1 md:order-1 w-full md:w-1/2 lg:w-1/3 text-white px-6 sm:px-12 md:pl-24 pt-16 sm:pt-20 md:pt-28">
        <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold mb-4 md:mb-6 leading-tight md:leading-none md:whitespace-nowrap">
          NICHOLAS <br className="hidden md:block" /> MAYER-RUPERT
        </h1>
        <p className="text-xl sm:text-2xl md:text-3xl md:ml-16">
          COMPUTER SCIENCE STUDENT AT SFU. SOFTWARE ENGINEERING ENJOYER.
        </p>
      </div>

      {/* 3D scene (bottom layer) */}
      <div className="relative z-0 order-2 md:order-2 w-full md:w-1/2 h-[40dvh] md:h-auto pointer-events-none mt-6 md:mt-0 md:ml-[10vw] lg:ml-[14vw] xl:ml-[18vw]">
        <GameOfLife3D className="absolute inset-0 w-full h-full z-0" />
      </div>

      {/* Fades: above 3D, below text */}
      <div className="pointer-events-none absolute top-0 left-0 w-full h-[18vh] md:h-[20vh] bg-gradient-to-b from-[#121212] to-transparent z-10" />
      <div className="pointer-events-none absolute bottom-0 left-0 w-full h-[18vh] md:h-[20vh] bg-gradient-to-t from-[#121212] to-transparent z-10" />
    </section>
  );
};

export default Hero;
