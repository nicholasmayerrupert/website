import { useLayoutEffect, useRef } from 'react';
import {
  DEFAULT_DAY_PHASE,
  sampleDayNight,
} from '../game/dayNightCycle.js';
import {
  SURFACE_CAM_Y,
  createParallaxBackground,
} from '../game/parallaxBackground.js';
import {
  getWeatherProfile,
  DEFAULT_WEATHER_ID,
  resolveWeatherId,
} from '../game/weather.js';

const INITIAL_DAY_NIGHT = sampleDayNight(DEFAULT_DAY_PHASE);
const WEATHER_VISUAL_STEP_MS = 50;

export function SandBackground({ className = '', weather = DEFAULT_WEATHER_ID }) {
  const containerRef = useRef(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const weatherId = resolveWeatherId(weather);
    const animatesRain = getWeatherProfile(weatherId).precipitation?.kind === 'rain';
    const background = createParallaxBackground(container);
    let weatherVisualKey = 0;
    let weatherVisualBucket = 0;
    let animationFrame = 0;
    const draw = () => {
      background.draw({
        camY: SURFACE_CAM_Y,
        dayNight: INITIAL_DAY_NIGHT,
        dayVisualKey: 'hero',
        weatherId,
        weatherVisualKey,
      });
    };
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      background.resize(width, height);
      draw();
    };
    const resizeObserver = new ResizeObserver(resize);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const animate = (now) => {
      if (reducedMotion?.matches) {
        animationFrame = 0;
        return;
      }
      const bucket = Math.floor(now / WEATHER_VISUAL_STEP_MS);
      if (bucket !== weatherVisualBucket) {
        weatherVisualBucket = bucket;
        weatherVisualKey = bucket;
        draw();
      }
      animationFrame = requestAnimationFrame(animate);
    };
    const updateMotionPreference = () => {
      if (!animatesRain) return;
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      if (!reducedMotion?.matches) animationFrame = requestAnimationFrame(animate);
    };

    resize();
    resizeObserver.observe(container);
    if (reducedMotion?.addEventListener) {
      reducedMotion.addEventListener('change', updateMotionPreference);
    } else {
      reducedMotion?.addListener?.(updateMotionPreference);
    }
    updateMotionPreference();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      if (reducedMotion?.removeEventListener) {
        reducedMotion.removeEventListener('change', updateMotionPreference);
      } else {
        reducedMotion?.removeListener?.(updateMotionPreference);
      }
      background.destroy();
    };
  }, [weather]);

  return <div ref={containerRef} className={className} aria-hidden="true" />;
}
