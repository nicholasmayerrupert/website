import { useCallback, useRef } from 'react';
import { SandGame } from './SandGame';
import './frontierCampaign.css';

// Site mounting and studio integration; adventure presentation belongs to the embed.
export function SandCampaign({ onRuntimeReady, worldSeed }) {
  const host = useRef(null);
  const onReady = useCallback(() => {
    onRuntimeReady?.(host.current);
  }, [onRuntimeReady]);
  return <main className="frontier-experience">
    <SandGame mode="survival" planet="frontier" mission="frontier"
      worldSeed={worldSeed} hostRef={host} onReady={onReady} />
  </main>;
}
