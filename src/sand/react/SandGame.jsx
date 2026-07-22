// React shim for the framework-free <sand-game> element and its draw-mode event.

import { useEffect, useRef } from 'react';

// The Web Component attributes are the runtime schema; keep this shim free of
// a second prop-types dependency that could drift from that public API.
// eslint-disable-next-line react/prop-types
export function SandGame({ initialTool = 'cube', mode = 'survival', onDrawModeChange, perfHud = false, debugHitboxes = false }) {
  const ref = useRef(null);
  useEffect(() => {
    import('../embed/sandGame'); // registers the <sand-game> custom element (idempotent)
    const el = ref.current;
    if (!el) return undefined;
    const onChange = (e) => onDrawModeChange?.(e.detail.on);
    el.addEventListener('sand:drawmodechange', onChange);
    return () => el.removeEventListener('sand:drawmodechange', onChange);
  }, [onDrawModeChange]);

  // `perf-hud` is a presence attribute read once when the element mounts, so it
  // must be set before connectedCallback — pass it inline (undefined omits it).
  return <sand-game ref={ref} initial-tool={initialTool} mode={mode} perf-hud={perfHud ? '' : undefined} debug-hitboxes={debugHitboxes ? '' : undefined} />;
}
