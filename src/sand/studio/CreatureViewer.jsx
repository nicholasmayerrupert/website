import { useEffect, useMemo, useRef, useState } from 'react';
import creatureArt from '../content/creatureArt.js';
import { ATTACK_NAMES, CREATURE_ROSTER, PREVIEW_MODES, createCreatureViewer, previewClip, drawCreatureFrame } from './creatureViewerRuntime.js';
import './creatureViewer.css';

const LABELS = { idle: 'Idle', move: 'Walk / move', swim: 'Swim', windup: 'Windup', attack: 'Attack', recover: 'Recovery', hurt: 'Hurt', death: 'Death', special: 'Special', simulation: 'Live encounter' };
function FrameStrip({ creature, mode, pattern, facing, frame, onSelect }) {
  const ref = useRef(null), art = creatureArt[creature];
  const clip = useMemo(() => previewClip(creature, mode, pattern), [creature, mode, pattern]);
  const cell = art.width * 2 + 16;
  useEffect(() => {
    const ctx = ref.current.getContext('2d');
    ctx.fillStyle = '#182832'; ctx.fillRect(0, 0, ref.current.width, ref.current.height);
    clip.frames.forEach((pose, i) => {
      ctx.fillStyle = i === frame ? '#9bdded' : '#8aa6b2'; ctx.font = '12px monospace'; ctx.fillText(String(i + 1).padStart(2, '0'), i * cell + 8, 17);
      if (i === frame) { ctx.strokeStyle = '#9bdded'; ctx.strokeRect(i * cell + .5, 24.5, cell - 1, art.height * 2 + 5); }
      drawCreatureFrame(ctx, creature, pose, i * cell + 8, 27, 2, facing);
    });
  }, [creature, mode, pattern, facing, frame, art, cell, clip]);
  return <div className="creature-viewer-strip"><canvas ref={ref} width={cell * clip.frames.length} height={art.height * 2 + 36}
    aria-label="Animation frame strip" onClick={e => onSelect(Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / cell))} /></div>;
}
export default function CreatureViewer() {
  const game = useRef(null), source = useRef(null), runtime = useRef(null);
  const [state, setState] = useState(null), [error, setError] = useState(''), [view, setView] = useState('game');
  useEffect(() => {
    let cancelled = false, timer;
    const requested = new URLSearchParams(location.search).get('creature')?.toUpperCase();
    const creature = CREATURE_ROSTER.some(d => d.key === requested) ? requested : 'FROST_GIANT';
    createCreatureViewer(game.current, source.current, { creature, ...(new URLSearchParams(location.search).has('swim')?{mode:'swim',water:'deep'}:{}) }).then(api => {
      if (cancelled) { api.dispose(); return; }
      runtime.current = api; window.__creatureViewer = api; setState(api.inspect());
      timer = setInterval(() => setState(api.inspect()), 100);
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; clearInterval(timer); runtime.current?.dispose(); runtime.current = null; delete window.__creatureViewer; };
  }, []);
  useEffect(() => {
    if (!state) return;
    const url = new URL(location.href); url.searchParams.set('creature', state.creature); history.replaceState(null, '', url);
    document.title = `${CREATURE_ROSTER.find(d => d.key === state.creature).name} · Creature workbench`;
  }, [state?.creature]);
  const change = next => {
    try { setState(runtime.current.select(next)); setError(''); }
    catch (e) { setError(e.message); }
  };
  const action = fn => { fn(runtime.current); setState(runtime.current.inspect()); };
  const creature = state?.creature || 'FROST_GIANT', art = creatureArt[creature];
  const definition = CREATURE_ROSTER.find(d => d.key === creature);
  const sourceOnly = state?.mode === 'special';
  const showSource = (view === 'source' && state?.mode !== 'simulation') || sourceOnly;
  return <main className="creature-viewer">
    <header><div><span className="creature-viewer-eyebrow">ASTER / CREATURE WORKBENCH</span><h1>{definition.name}</h1><p>Inspect the artwork. Watch it move. Test it in the game.</p></div><a href="/game?studio=hearth">World workbench ↗</a></header>
    {error && <p role="alert">{error}</p>}
    {!state && !error && <p role="status">Loading the game renderer…</p>}
    <div className="creature-viewer-controls">
      <label>Creature<select aria-label="Creature" value={creature} disabled={!state} onChange={e => change({ creature: e.target.value, pattern: 0 })}>{CREATURE_ROSTER.map(d => <option value={d.key} key={d.key}>{d.name}</option>)}</select></label>
      <label>Attack pattern<select aria-label="Attack pattern" value={state?.pattern || 0} disabled={!state} onChange={e => change({ pattern: Number(e.target.value) })}>{(ATTACK_NAMES[creature] || ['Pattern 1', 'Pattern 2', 'Pattern 3']).map((name, i) => <option value={i} key={i}>{name}</option>)}</select></label>
      <label>Facing<select aria-label="Facing" value={state?.facing || 1} disabled={!state} onChange={e => change({ facing: Number(e.target.value) })}><option value="1">Right</option><option value="-1">Left</option></select></label>
      <label className="creature-viewer-check"><input type="checkbox" checked={state?.travel ?? true} disabled={!state} onChange={e => change({ travel: e.target.checked })} />Travel through scene</label>
      <label>Water<select aria-label="Water" value={state?.water || 'dry'} disabled={!state} onChange={e=>change({water:e.target.value})}><option value="dry">Dry ground</option><option value="shallow">Shallow water</option><option value="deep">Deep water</option></select></label>
      <label>Swim motion<select aria-label="Swim motion" value={state?.swimMotion || 'horizontal'} disabled={!state || state.water!=='deep'} onChange={e=>change({swimMotion:e.target.value})}><option value="horizontal">Forward</option><option value="rise">Straight upward</option><option value="still">Tread water</option></select></label>
    </div>
    <nav aria-label="Animation">{PREVIEW_MODES.map(mode => <button key={mode} disabled={!state} aria-pressed={state?.mode === mode} onClick={() => change({ mode })}>{LABELS[mode]}</button>)}</nav>
    <div className="creature-viewer-stage">
      <div className="creature-viewer-stage-bar"><span>{showSource ? 'SOURCE PIXELS' : 'GAME RENDERER'}</span><div><button disabled={sourceOnly} aria-pressed={!showSource} onClick={() => setView('game')}>In game</button><button disabled={state?.mode === 'simulation'} aria-pressed={showSource} onClick={() => setView('source')}>Source pixels</button></div></div>
      <canvas ref={game} width="1440" height="600" aria-label="Live creature preview" hidden={showSource} />
      <canvas ref={source} width="720" height="300" aria-label="Source animation preview" hidden={!showSource} />
    </div>
    <div className="creature-viewer-playback">
      <button disabled={!state} onClick={() => action(api => state.paused ? api.play() : api.pause())}>{state?.paused ? 'Play' : 'Pause'}</button>
      <button disabled={!state} onClick={() => action(api => api.step())}>Step tick</button>
      <button disabled={!state || state.mode === 'simulation'} onClick={() => action(api => api.seekFrame((state.frame + 1) % state.frames))}>Next frame</button>
      <button disabled={!state} onClick={() => action(api => api.restart())}>Restart</button>
      <label>Speed<select aria-label="Playback speed" value={state?.speed || 1} disabled={!state} onChange={e => action(api => api.setSpeed(Number(e.target.value)))}><option value="0.25">¼×</option><option value="0.5">½×</option><option value="1">1×</option><option value="2">2×</option></select></label>
      <output aria-label="Playback status">{state ? `Tick ${state.tick} · ${state.mode === 'simulation' ? 'simulation' : `frame ${state.frame + 1} / ${state.frames}`}` : 'Loading…'}</output>
    </div>
    <p className="creature-viewer-note">{sourceOnly ? 'Special is shown as source artwork; its in-game trigger varies by creature. Use Live encounter to see the actual behavior.' : state?.mode === 'simulation' ? 'Live encounter runs the real AI, attacks, projectiles and terrain. Restarts every four seconds. Some creatures do not attack.' : 'Controlled poses use the game renderer with AI paused. Travel reveals sliding; turn it off to study the cycle in place. Water and swim motion controls compare paddling, rising, and treading water.'}</p>
    {state && state.mode !== 'simulation' && <>
      <div className="creature-viewer-frame-header"><h2>Source frames</h2><span>{art.width} × {art.height} · {state.frames} poses</span></div>
      <label className="creature-viewer-scrubber">Frame<input aria-label="Animation frame" type="range" min="0" max={state.frames - 1} value={state.frame} onChange={e => action(api => api.seekFrame(Number(e.target.value)))} /><span>{state.frame + 1}</span></label>
      <FrameStrip {...state} onSelect={frame => action(api => api.seekFrame(frame))} />
    </>}
    <footer>All {CREATURE_ROSTER.length} creatures use the current game content. This development viewer is available at <code>/game?creature={creature}</code>.</footer>
  </main>;
}
