// Thin React wrapper that mounts the framework-agnostic <sand-game> Web Component
// (../embed/sandGame.js) and bridges its draw-mode CustomEvent to a React prop:
//
//   <SandGame onDrawModeChange={setFaded} />
//
// The simulation, WebGL rendering, input, world streaming, and the tool palette
// all live in the element now (and in the C++/WASM engine it drives). React only
// places the element and listens for its draw-mode event. Any non-React page can
// use <sand-game> directly — see ../embed/sandGame.js.

import React, { useEffect, useRef } from 'react';

export function SandGame({ initialTool = 'cube', mode = 'survival', onDrawModeChange }) {
  const ref = useRef(null);
  useEffect(() => {
    import('../embed/sandGame'); // registers the <sand-game> custom element (idempotent)
    const el = ref.current;
    if (!el) return undefined;
    const onChange = (e) => onDrawModeChange?.(e.detail.on);
    el.addEventListener('sand:drawmodechange', onChange);
    return () => el.removeEventListener('sand:drawmodechange', onChange);
  }, [onDrawModeChange]);

  return <sand-game ref={ref} initial-tool={initialTool} mode={mode} />;
}
