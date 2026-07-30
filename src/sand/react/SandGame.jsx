// React shim for the framework-free <sand-game> element and its draw-mode event.

import { useEffect, useRef } from 'react';

// The Web Component attributes are the runtime schema; keep this shim free of
// a second prop-types dependency that could drift from that public API.
// eslint-disable-next-line react/prop-types
export function SandGame({
  initialTool = 'cube',
  mode = 'survival',
  autoStart = false,
  onDrawModeChange,
  onReady,
  planet,
  mission,
  worldSeed,
  loadout,
  onMissionUpdate,
  onMissionComplete,
  onMissionFailed,
  onError,
  perfHud = false,
  debugHitboxes = false,
}) {
  const ref = useRef(null);
  useEffect(() => {
    import('../embed/sandGame'); // registers the <sand-game> custom element (idempotent)
    const el = ref.current;
    if (!el) return undefined;
    const onChange = (e) => onDrawModeChange?.(e.detail.on);
    const onGameReady = () => onReady?.();
    const onMissionState = (e) => onMissionUpdate?.(e.detail);
    const onMissionDone = (e) => onMissionComplete?.(e.detail);
    const onMissionFailure = (e) => onMissionFailed?.(e.detail);
    const onGameError = (e) => onError?.(e.detail);
    el.addEventListener('sand:drawmodechange', onChange);
    el.addEventListener('sand:ready', onGameReady);
    el.addEventListener('sand:missionupdate', onMissionState);
    el.addEventListener('sand:missioncomplete', onMissionDone);
    el.addEventListener('sand:missionfailed', onMissionFailure);
    el.addEventListener('sand:error', onGameError);
    return () => {
      el.removeEventListener('sand:drawmodechange', onChange);
      el.removeEventListener('sand:ready', onGameReady);
      el.removeEventListener('sand:missionupdate', onMissionState);
      el.removeEventListener('sand:missioncomplete', onMissionDone);
      el.removeEventListener('sand:missionfailed', onMissionFailure);
      el.removeEventListener('sand:error', onGameError);
    };
  }, [
    onError,
    onDrawModeChange,
    onMissionComplete,
    onMissionFailed,
    onMissionUpdate,
    onReady,
  ]);

  // `perf-hud` is a presence attribute read once when the element mounts, so it
  // must be set before connectedCallback — pass it inline (undefined omits it).
  const encodedLoadout = loadout === undefined ? undefined : JSON.stringify(loadout);
  return (
    <sand-game
      ref={ref}
      initial-tool={initialTool}
      mode={mode}
      auto-start={autoStart ? '' : undefined}
      planet={planet}
      mission={mission}
      world-seed={Number.isFinite(worldSeed) ? String(worldSeed >>> 0) : undefined}
      loadout={encodedLoadout}
      perf-hud={perfHud ? '' : undefined}
      debug-hitboxes={debugHitboxes ? '' : undefined}
    />
  );
}
