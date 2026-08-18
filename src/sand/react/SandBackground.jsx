import { useLayoutEffect, useRef } from 'react';
import {
  DEFAULT_DAY_PHASE,
  sampleDayNight,
} from '../game/dayNightCycle.js';
import {
  SURFACE_CAM_Y,
  createParallaxBackground,
} from '../game/parallaxBackground.js';

const INITIAL_DAY_NIGHT = sampleDayNight(DEFAULT_DAY_PHASE);

export function SandBackground({ className = '' }) {
  const containerRef = useRef(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const background = createParallaxBackground(container);
    const draw = () => {
      const { width, height } = container.getBoundingClientRect();
      background.resize(width, height);
      background.draw({
        camY: SURFACE_CAM_Y,
        dayNight: INITIAL_DAY_NIGHT,
      });
    };
    const resizeObserver = new ResizeObserver(draw);

    draw();
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      background.destroy();
    };
  }, []);

  return <div ref={containerRef} className={className} aria-hidden="true" />;
}
