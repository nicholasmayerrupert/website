import { useCallback, useEffect, useRef, useState } from 'react';
import { SandCampaign } from '../react/SandCampaign.jsx';
import { GAME_SCENES, PLAYER_ART } from '../content/catalog.js';
import { ANIMATION_STATES } from '../content/compile.js';
import { createStudioRuntime } from './runtime.js';
import './studio.css';
import { BlueprintEditor, PixelEditor } from './ContentEditors.jsx';

function SpritePreview() {
  const ref = useRef(null);
  const [clip, setClip] = useState('walk');
  useEffect(() => {
    const canvas = ref.current, ctx = canvas.getContext('2d');
    const draw = () => {
      const animation = PLAYER_ART.clips[clip];
      const frame = Math.floor(performance.now() * .06 / animation.ticks) % animation.frames.length;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      animation.frames[frame].forEach((row, y) => [...row].forEach((symbol, x) => {
        if (symbol === '.') return;
        ctx.fillStyle = PLAYER_ART.palette[symbol]; ctx.fillRect(x, y, 1, 1);
      }));
    };
    draw();
    const timer = setInterval(draw, 50);
    return () => clearInterval(timer);
  }, [clip]);
  return <section className="studio-art"><canvas ref={ref} width={PLAYER_ART.width} height={PLAYER_ART.height} aria-label="Authored player animation" />
    <div><label htmlFor="studio-clip">Player animation</label><select id="studio-clip" value={clip} onChange={e => setClip(e.target.value)}>{ANIMATION_STATES.map(s => <option key={s}>{s}</option>)}</select><small>{PLAYER_ART.width} × {PLAYER_ART.height} · source pixels</small></div></section>;
}

export default function GameStudio() {
  const initial = new URLSearchParams(location.search).get('studio') || 'hearth';
  const clean = new URLSearchParams(location.search).has('capture');
  const runtime = useRef(null);
  const selectedScene = useRef(initial);
  const [scene, setScene] = useState(initial);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const load = useCallback(async (id) => {
    setLoading(true); setError('');
    try {
      await runtime.current.load(id); setScene(id); selectedScene.current = id;
      const url = new URL(location.href); url.searchParams.set('studio', id);
      history.replaceState(null, '', url);
    }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  const ready = useCallback(async (host) => {
    runtime.current = createStudioRuntime(host);
    await load(selectedScene.current);
    window.__gameStudio = runtime.current;
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => { if (runtime.current) setState(runtime.current.inspect()); }, 250);
    return () => { clearInterval(timer); delete window.__gameStudio; };
  }, []);
  return <div className={`game-studio ${clean ? 'capture' : ''}`}>
    <div className="studio-game"><SandCampaign key={revision} onRuntimeReady={ready} preview /></div>
    {!clean && <aside className="studio-panel">
      <header><span className="studio-eyebrow">ASTER / DEVELOPMENT</span><h1>World workbench</h1><p>The real game. One scene at a time.</p></header>
      <label htmlFor="studio-scene">Jump to a scene</label>
      <select id="studio-scene" value={scene} disabled={loading} onChange={e => load(e.target.value)}>{GAME_SCENES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <p className="studio-description">{GAME_SCENES.find(s => s.id === scene)?.description}</p>
      <div className="studio-actions"><button disabled={loading} onClick={() => state?.paused ? runtime.current.play() : runtime.current.pause()}>{state?.paused ? 'Play' : 'Pause'}</button><button disabled={loading} onClick={() => runtime.current.step(1)}>Step actor</button><button disabled={loading} onClick={() => { runtime.current = null; delete window.__gameStudio; setLoading(true); setRevision(r => r + 1); }}>Reset world</button></div>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Opening scene…</p>}
      <SpritePreview />
      <details><summary>Edit blueprint</summary><BlueprintEditor key={scene} scene={scene} /></details>
      <details><summary>Edit player pixels</summary><PixelEditor /></details>
      <h2>Player</h2><dl><dt>Position</dt><dd>{state?.player ? `${state.player.worldX.toFixed(1)}, ${state.player.worldY.toFixed(1)}` : '—'}</dd><dt>Animation</dt><dd>{ANIMATION_STATES[state?.player?.animState]} / {state?.player?.animFrame}</dd><dt>Health</dt><dd>{state?.player?.health}</dd><dt>Grounded</dt><dd>{state?.player?.grounded ? 'yes' : 'no'}</dd></dl>
      <h2>Objectives</h2><ol className="studio-objectives">{state?.mission?.objectives.map(o => <li key={o.id}><span>{['locked', 'active', 'complete', 'failed'][o.state]}</span>Objective {o.id + 1}<small>{o.worldX}, {o.worldY}</small></li>)}</ol>
      <h2>Runtime</h2><dl><dt>Content</dt><dd>{state?.contentHash}</dd><dt>Actor tick</dt><dd>{state?.perf?.actorTick}</dd><dt>World tick</dt><dd>{state?.perf?.worldTick}</dd><dt>Frame p95</dt><dd>{state?.perf?.p95FrameMs} ms</dd><dt>Authority</dt><dd>{state?.perf?.workerStatus}</dd></dl>
      <footer>Edit <code>src/sand/content/</code> to change this world. Content edits reload without a WASM build.</footer>
    </aside>}
  </div>;
}
