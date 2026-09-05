import { useCallback, useEffect, useRef, useState } from 'react';
import { SandGame } from './SandGame';
import { FRONTIER_JOBS } from '../campaign/frontier.js';
import { OBJECTIVE_STATE, MISSION_PHASE } from '../wasmBridge/abi.generated.js';
import './frontierCampaign.css';

function FieldMap({ selected, onSelect, objectives }) {
  return (
    <svg className="frontier-map" viewBox="0 0 660 380" role="img" aria-label="Expedition sketch: railway west, archive below, observatory east">
      <defs>
        <pattern id="field-grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M30 0H0V30" fill="none" stroke="#b5c6a9" strokeOpacity=".08" />
        </pattern>
      </defs>
      <rect width="660" height="380" fill="#14231f" />
      <rect width="660" height="380" fill="url(#field-grid)" />
      <path d="M0 160 45 130 75 145 130 87 177 118 212 162 269 175 375 175 423 132 453 145 484 81 522 95 550 24 592 67 632 121 660 117V380H0Z" fill="#293b2c" />
      <path d="M0 160 45 130 75 145 130 87 177 118 212 162 269 175 375 175 423 132 453 145 484 81 522 95 550 24 592 67 632 121 660 117" fill="none" stroke="#8caa85" strokeWidth="2" />
      <path d="M345 181V235L290 254 317 278 258 292 230 310M112 190H207L269 175M375 175 455 164 484 107 545 65" fill="none" stroke="#c6b984" strokeWidth="2" strokeDasharray="4 7" />
      <path d="M35 250 120 239 169 272 145 310 201 345 330 338 375 293 440 320 524 281 616 299" fill="none" stroke="#526044" strokeWidth="14" strokeLinecap="round" />
      <text x="20" y="28">ASTER VALLEY / FIELD SKETCH</text>
      <text x="20" y="361">WEST</text><text x="599" y="361">EAST</text>
      {FRONTIER_JOBS.map((job) => {
        const done = objectives?.[job.id]?.state === OBJECTIVE_STATE.COMPLETE;
        return (
          <g key={job.id} role="button" tabIndex="0" aria-label={`Show ${job.title}`}
            className={`frontier-map-pin ${selected === job.id ? 'selected' : ''}`}
            onClick={() => onSelect(job.id)} onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(job.id); }
            }} transform={`translate(${job.mapX} ${job.mapY})`}>
            <circle r="18" fill="#11241d" stroke={job.color} strokeWidth="2" />
            <text textAnchor="middle" dy="4" fill={job.color}>{done ? '✓' : job.symbol}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function SandCampaign() {
  const host = useRef(null);
  const panel = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [menu, setMenu] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [selected, setSelected] = useState(0);
  const [tracked, setTracked] = useState(0);
  const [welcome, setWelcome] = useState(true);
  const [muted, setMuted] = useState(false);
  const [notice, setNotice] = useState(null);
  const completedRef = useRef(new Set());
  useEffect(() => {
    const completed = snapshot?.objectives?.filter(o => o.state === OBJECTIVE_STATE.COMPLETE) || [];
    const newlyCompleted = completed.find(o => !completedRef.current.has(o.id));
    for (const objective of completed) completedRef.current.add(objective.id);
    if (!newlyCompleted) return undefined;
    setNotice(FRONTIER_JOBS[newlyCompleted.id]);
    if (snapshot.objectives[tracked]?.state === OBJECTIVE_STATE.COMPLETE) {
      const next = snapshot.objectives.find(o => o.state === OBJECTIVE_STATE.ACTIVE);
      if (next) setTracked(next.id);
    }
    return undefined;
  }, [snapshot, tracked]);
  useEffect(() => {
    if (!notice) return undefined;
    const timeout = setTimeout(() => setNotice(null), 6500);
    return () => clearTimeout(timeout);
  }, [notice]);
  const focusGame = useCallback(() => requestAnimationFrame(() =>
    host.current?.shadowRoot?.querySelector('.sg-sim')?.focus()), []);
  const close = useCallback(() => { setMenu(null); focusGame(); }, [focusGame]);
  useEffect(() => {
    host.current?.setPaused?.(!!menu);
    if (!menu) return undefined;
    const previous = document.activeElement;
    panel.current?.querySelector('button')?.focus();
    const trap = (event) => {
      if (event.key !== 'Tab') return;
      const controls = [...panel.current.querySelectorAll('button:not(:disabled),[tabindex="0"]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const node = panel.current;
    node?.addEventListener('keydown', trap);
    return () => { node?.removeEventListener('keydown', trap); previous?.focus(); };
  }, [menu, ready]);
  useEffect(() => {
    if (host.current) host.current.dataset.trackedObjective = String(tracked);
  }, [tracked, ready]);
  useEffect(() => {
    const key = (event) => {
      if (event.repeat || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      if (event.code === 'KeyJ') {
        event.preventDefault(); event.stopImmediatePropagation();
        setMenu((current) => current === 'journal' ? null : 'journal');
        if (menu) focusGame();
      } else if (event.key === 'Escape' && !host.current?._hud?.isOpen?.()) {
        event.preventDefault();
        if (menu) close(); else setMenu('pause');
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [close, focusGame, menu]);
  const onReady = useCallback(() => {
    setReady(true); host.current?._game?.setDayPhase(0.20);
    for (let i = 0; i < 4; i++) host.current?._game?.zoomOut();
    focusGame();
    setMuted(host.current?._game?.getAudioState().muted ?? false);
  }, [focusGame]);
  const repairView = host.current?._game?.getMissionView?.();
  const canRepair = repairView && repairView.playerWorldX >= -320 && repairView.playerWorldX <= 319
    && repairView.playerWorldY >= -96 && repairView.playerWorldY <= 191;
  const job = FRONTIER_JOBS[selected];
  const done = snapshot?.objectives?.filter((o) => o.state === OBJECTIVE_STATE.COMPLETE).length || 0;
  const complete = snapshot?.phase === MISSION_PHASE.COMPLETE;
  return (
    <main className="frontier-experience">
      <SandGame mode="survival" planet="frontier" mission="frontier" worldSeed={0x41535452}
        hostRef={host} onReady={onReady} onMissionUpdate={setSnapshot}
        onError={() => setError(true)}
        onTalkAction={({ action }) => {
          if (action === 'mission-console') setMenu('journal');
          if (action === 'repair-base') setMenu('repair');
        }} />
      <header className="frontier-header">
        <div><span className="frontier-emblem">✳</span><span>ASTER<span className="frontier-subtitle">EARTH EXPEDITION</span></span></div>
        <nav aria-label="Expedition controls">
          <button onClick={() => setMenu('journal')}>Field journal <kbd>J</kbd><small>{done}/4</small></button>
          <button aria-label="Pause expedition" onClick={() => setMenu('pause')}>Ⅱ</button>
        </nav>
      </header>
      {ready && welcome && !menu && (
        <aside className="frontier-arrival">
          <span className="frontier-kicker">YOUR HOME IN THE WILDERNESS</span>
          <h1>Aster Station</h1>
          <p>The valley is open. Head west into the old railway, climb the eastern highlands, or follow engineering down into the caves.</p>
          <div><button onClick={() => { setWelcome(false); setMenu('journal'); }}>Open field journal ↗</button>
            <button className="frontier-quiet" onClick={() => { setWelcome(false); focusGame(); }}>Explore first</button></div>
        </aside>
      )}
      {notice && !menu && <aside className="frontier-notice" role="status"><span className="frontier-kicker">FIELD JOB COMPLETE</span><strong>{notice.title}</strong><span>{notice.reward}</span></aside>}
      {complete && !menu && <div className="frontier-complete">Expedition logged. The valley is still yours.</div>}
      <footer className="frontier-controls"><span><kbd>A D</kbd> Move</span><span><kbd>SPACE</kbd> Jump / jetpack</span><span><kbd>1 2</kbd> Blast / mine</span><span><kbd>T</kbd> Talk</span><span><kbd>E</kbd> Inventory</span></footer>
      {!ready && <div className="frontier-loading" role="status">{error ? 'Unable to open the expedition. Reload to try again.' : 'Opening Aster Valley…'}</div>}
      {menu && <div className="frontier-overlay">
        <section className={`frontier-panel ${menu === 'journal' ? 'frontier-journal' : 'frontier-small'}`} ref={panel}
          role="dialog" aria-modal="true" aria-label={menu === 'journal' ? 'Field journal' : menu === 'repair' ? 'Station repair' : 'Expedition paused'}>
          <header><div><span className="frontier-kicker">ASTER / FIELD OPERATIONS</span><h2>{menu === 'journal' ? 'A world worth getting lost in.' : menu === 'repair' ? '“We can rebuild it.”' : 'Take a breath.'}</h2></div>
            <button className="frontier-close" onClick={close} aria-label="Close panel">×</button></header>
          {menu === 'journal' ? <>
            <div className="frontier-journal-grid"><div className="frontier-chart"><FieldMap selected={selected} onSelect={setSelected} objectives={snapshot?.objectives} />
              <p>Choose your own route. Terrain, structures, and water respond to your tools.</p>
              <div className="frontier-jobs">{FRONTIER_JOBS.map((entry) => <button key={entry.id} onClick={() => setSelected(entry.id)} aria-pressed={selected === entry.id}>
                <span style={{ color: entry.color }}>{snapshot?.objectives?.[entry.id]?.state === OBJECTIVE_STATE.COMPLETE ? '✓' : entry.symbol}</span>
                <span>{entry.title}<small>{entry.place}</small></span></button>)}</div></div>
              <article className="frontier-job-detail" style={{ '--job-color': job.color }}>
                <span className="frontier-kicker">{job.place}</span><h3>{job.title}</h3><p className="frontier-job-summary">{job.summary}</p><p>{job.description}</p>
                <div className="frontier-field-note"><span>FIELD NOTE</span><p>{job.hint}</p></div>
                <div className="frontier-reward"><small>RECOVER / UNLOCK</small><p>{job.reward}</p></div>
                {snapshot?.objectives?.[selected]?.state === OBJECTIVE_STATE.COMPLETE ? <p className="frontier-finished">✓ Logged in the field</p> :
                  <button className="frontier-primary" disabled={selected === 3 && done < 3} onClick={() => { setTracked(selected); setWelcome(false); close(); }}>Track this destination ↗</button>}
              </article></div>
            <footer>Walk out, find your route, come home.</footer>
          </> : menu === 'repair' ? <>
            <p className="frontier-speaker">ENGINEER OSEI · STATION MAINTENANCE</p>
            <p>“Walls, floors, labs, the whole station. I have the plans. Give me the word.”</p>
            <p>Rebuilds the station grounds and removes rubble and anything you placed there. Your field discoveries and changes beyond the station remain.</p>
            <button className="frontier-primary" disabled={!canRepair} onClick={() => { host.current?._game?.repairBase(); close(); }}>Rebuild Aster Station</button>
            {!canRepair && <p>Return to the station grounds before the rebuild begins.</p>}
            <button className="frontier-quiet" onClick={close}>Leave it as it is</button>
          </> : <>
            <button className="frontier-primary" onClick={close}>Return to the valley</button>
            <button onClick={() => setMenu('journal')}>Field journal</button>
            <button onClick={() => setMenu('repair')}>Call station maintenance</button>
            <button onClick={() => { host.current?._game?.setAudioMuted(!muted); setMuted(!muted); }}>Sound {muted ? 'off' : 'on'}</button>
            <p className="frontier-save-note">Prototype: world changes last for this session. Reloading starts a fresh valley.</p>
          </>}
        </section>
      </div>}
    </main>
  );
}
