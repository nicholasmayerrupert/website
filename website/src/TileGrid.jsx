import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Lottie from 'react-lottie';
import animation1 from './chess.json';
import animation2 from './grabby2.json';
import animation3 from './fire.json';
import animation4 from './whitelife.json';

// Hook: respects the user's reduced motion setting
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

// Component: makes Lottie responsive to its container width (keeps a square)
function ResponsiveLottie({ animationData }) {
  const containerRef = useRef(null);
  const [size, setSize] = useState(300);
  const prefersReducedMotion = usePrefersReducedMotion();

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => {
      const w = el.getBoundingClientRect().width || 300;
      // Clamp to avoid extreme sizes on ultra-small/large screens
      const clamped = Math.max(160, Math.min(420, Math.floor(w)));
      setSize(clamped);
    };
    update();

    // Observe container size changes
    let ro;
    if ('ResizeObserver' in window) {
      ro = new ResizeObserver(update);
      ro.observe(el);
    } else {
      // Fallback
      window.addEventListener('resize', update);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', update);
    };
  }, []);

  return (
    <div ref={containerRef} className="w-full aspect-square">
      <Lottie
        options={{
          loop: !prefersReducedMotion,
          autoplay: !prefersReducedMotion,
          animationData,
          rendererSettings: { preserveAspectRatio: 'xMidYMid slice' },
        }}
        height={size}
        width={size}
        isClickToPauseDisabled
      />
    </div>
  );
}

export default function TileGrid() {
  const [revealedTiles, setRevealedTiles] = useState([]);

  const handleTileClick = (index) => {
    setRevealedTiles((prev) => (prev.includes(index) ? [] : [index]));
  };

  const tiles = [
    {
      animation: animation1,
      title: 'Chess Engine',
      content: 'Software Project',
      description: 'A decent chess engine built using C++.',
      features: ['AI opponent from terminal', 'Move analysis', 'Plays at ~1200 ELO'],
    },
    {
      animation: animation2,
      title: 'Grabby - OCR + Snipping Tool',
      content: 'Software Project',
      description: 'A versatile tool combining OCR and snipping capabilities.',
      features: ['Text extraction from images', 'Snipping tool integration', 'Multi-language support'],
    },
    {
      animation: animation3,
      title: 'Forest Fire Modelling',
      content: 'Data Science Project',
      description:
        'A series of models designed to examine which factors predispose areas to forest fires most.',
      features: [
        'Analyzed causes of spread rates',
        'Determined the most predictive factor extractable from public data to be humidity',
        'Discovered weather to be a poor predictor of forest fires - likely due to data chunking',
      ],
    },
    {
      animation: animation4,
      title: '3D Game of Life',
      content: 'Scroll up :P',
      description: 'A 3D implementation of the classic cellular automaton.',
      features: [
        'Stores previous cycles on the y-axis',
        'Real-time 3D rendering',
        'Shows how the game evolves over time',
      ],
    },
  ];

  return (
    <div className="bg-dark pt-24 sm:pt-28 pb-12 min-h-screen">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <h2 className="text-center text-white font-bold tracking-tight mb-8 sm:mb-12 text-4xl sm:text-6xl md:text-7xl">
          MY PROJECTS
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 md:gap-8">
          {tiles.map((tile, index) => {
            const isOpen = revealedTiles.includes(index);
            return (
              <button
                key={index}
                type="button"
                onClick={() => handleTileClick(index)}
                aria-pressed={isOpen}
                aria-label={`${isOpen ? 'Hide' : 'Show'} details for ${tile.title}`}
                className="group relative w-full text-left rounded-2xl bg-gray-900/95 shadow-lg ring-1 ring-white/10 hover:ring-white/20 transition
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900
                           overflow-hidden hover:scale-[1.02] active:scale-[0.99] duration-200"
              >
                {isOpen ? (
                  <div className="p-4 sm:p-6">
                    <h3 className="text-2xl font-bold text-white text-center mb-2">{tile.title}</h3>
                    <p className="text-center text-gray-300 mb-4">{tile.content}</p>
                    <p className="text-gray-200 mb-4">{tile.description}</p>
                    <ul className="list-disc pl-5 space-y-1 text-gray-200">
                      {tile.features.map((feature, idx) => (
                        <li key={idx}>{feature}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="px-3 pt-3">
                      <ResponsiveLottie animationData={tile.animation} />
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <h3 className="inline-block rounded-full bg-black/50 text-white font-bold py-2 px-4 text-lg sm:text-xl backdrop-blur-md">
                        {tile.title}
                      </h3>
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
