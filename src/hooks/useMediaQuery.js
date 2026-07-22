import { useEffect, useState } from 'react';

const readMediaQuery = (query) =>
  typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;

// Read during the browser's initial render so a media-gated component cannot
// briefly mount with the wrong state. The server fallback remains `false`.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => readMediaQuery(query));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    if (mq.addEventListener) mq.addEventListener('change', update);
    else mq.addListener(update);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', update);
      else mq.removeListener(update);
    };
  }, [query]);
  return matches;
}

export function usePrefersReducedMotion() {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}
