// React shim for the framework-free <sand-game> element and its draw-mode event.

import { useCallback, useEffect, useRef } from 'react';

// The Web Component attributes are the runtime schema; keep this shim free of
// a second prop-types dependency that could drift from that public API.
// eslint-disable-next-line react/prop-types
export function SandGame({
  initialTool = 'cube',
  mode = 'survival',
  autoStart = false,
  onDrawModeChange,
  onInteraction,
  onReady,
  planet,
  weather,
  mission,
  worldSeed,
  loadout,
  onMissionUpdate,
  onMissionComplete,
  onMissionFailed,
  onTalkAction,
  onError,
  hostRef,
  perfHud = false,
  debugHitboxes = false,
}) {
  const ref = useRef(null);
  const readyElementRef = useRef(null);
  const setHostRef = useCallback((node) => {
    ref.current = node;
    if (typeof hostRef === 'function') hostRef(node);
    else if (hostRef) hostRef.current = node;
  }, [hostRef]);
  useEffect(() => {
    import('../embed/sandGame'); // registers the <sand-game> custom element (idempotent)
    const el = ref.current;
    if (!el) return undefined;
    const onChange = (e) => onDrawModeChange?.(e.detail.on);
    const onGameInteraction = () => onInteraction?.();
    const onGameReady = () => {
      if (readyElementRef.current === el) return;
      readyElementRef.current = el;
      onReady?.();
    };
    const onMissionState = (e) => onMissionUpdate?.(e.detail);
    const onMissionDone = (e) => onMissionComplete?.(e.detail);
    const onMissionFailure = (e) => onMissionFailed?.(e.detail);
    const onTalk = (e) => onTalkAction?.(e.detail);
    const onGameError = (e) => onError?.(e.detail);
    el.addEventListener('sand:drawmodechange', onChange);
    el.addEventListener('sand:interaction', onGameInteraction);
    el.addEventListener('sand:ready', onGameReady);
    el.addEventListener('sand:missionupdate', onMissionState);
    el.addEventListener('sand:missioncomplete', onMissionDone);
    el.addEventListener('sand:missionfailed', onMissionFailure);
    el.addEventListener('sand:talkaction', onTalk);
    el.addEventListener('sand:error', onGameError);
    if (el._ready) onGameReady();
    return () => {
      el.removeEventListener('sand:drawmodechange', onChange);
      el.removeEventListener('sand:interaction', onGameInteraction);
      el.removeEventListener('sand:ready', onGameReady);
      el.removeEventListener('sand:missionupdate', onMissionState);
      el.removeEventListener('sand:missioncomplete', onMissionDone);
      el.removeEventListener('sand:missionfailed', onMissionFailure);
      el.removeEventListener('sand:talkaction', onTalk);
      el.removeEventListener('sand:error', onGameError);
    };
  }, [
    onError,
    onDrawModeChange,
    onInteraction,
    onMissionComplete,
    onMissionFailed,
    onMissionUpdate,
    onTalkAction,
    onReady,
  ]);

  // `perf-hud` is a presence attribute read once when the element mounts, so it
  // must be set before connectedCallback — pass it inline (undefined omits it).
  const encodedLoadout = loadout === undefined ? undefined : JSON.stringify(loadout);
  return (
    <sand-game
      ref={setHostRef}
      initial-tool={initialTool}
      mode={mode}
      auto-start={autoStart ? '' : undefined}
      planet={planet}
      weather={weather}
      mission={mission}
      world-seed={Number.isFinite(worldSeed) ? String(worldSeed >>> 0) : undefined}
      loadout={encodedLoadout}
      perf-hud={perfHud ? '' : undefined}
      debug-hitboxes={debugHitboxes ? '' : undefined}
    />
  );
}
