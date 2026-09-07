import { useCallback, useRef } from 'react';
import { SandGame } from './SandGame';
import { GAME_WORLD } from '../content/catalog.js';
import './frontierCampaign.css';

// Site mounting and studio integration; adventure presentation belongs to the embed.
export function SandCampaign({ onRuntimeReady }) {
  const host = useRef(null);
  const onReady = useCallback(() => {
    host.current?._game?.setDayPhase(.2);
    onRuntimeReady?.(host.current);
  }, [onRuntimeReady]);
  return <main className="frontier-experience">
    <SandGame mode="survival" planet="frontier" mission="frontier"
      worldSeed={GAME_WORLD.seed} hostRef={host} onReady={onReady} />
  </main>;
}
