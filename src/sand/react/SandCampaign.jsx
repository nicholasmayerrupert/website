import { useCallback, useEffect, useRef, useState } from 'react';
import { SandGame } from './SandGame';
import {
  buildMissionLoadout,
  defaultLoadoutSelection,
} from '../campaign/missions.js';
import {
  abandonCampaignRun,
  beginCampaignRun,
  completeCampaignMission,
  readCampaignSave,
  updateCampaignSave,
} from '../campaign/campaignSave.js';
import './earthCampaign.css';
import { OBJECTIVE_STATE } from '../wasmBridge/abi.generated.js';

const MISSION_ID = 'greenfall-recovery';
const EARTH_SEED = 0x1a15beef;
const formatTime = (ticks) =>
  `${Math.floor((ticks || 0) / 3600)}:${String(Math.floor((ticks || 0) / 60) % 60).padStart(2, '0')}`;
function Modal({ children, label, onClose, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const prior = document.activeElement;
    const node = ref.current;
    node?.querySelector('button')?.focus();
    const key = (event) => {
      if (event.key === 'Escape' && onClose) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if (event.key !== 'Tab') return;
      const controls = [
        ...node.querySelectorAll('button:not(:disabled),a[href],input'),
      ];
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    node?.addEventListener('keydown', key);
    return () => {
      node?.removeEventListener('keydown', key);
      if (prior?.isConnected) prior.focus();
    };
  }, [onClose]);
  return (
    <div className={`iris-modal ${className}`}>
      <section ref={ref} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </section>
    </div>
  );
}

function Briefing({ ready, onClose, onDeploy }) {
  return (
    <Modal label="Earth mission" onClose={onClose} className="iris-briefing">
      <header className="iris-console-head">
        <h2>! Missions</h2>
        <button
          className="iris-icon-button"
          onClick={onClose}
          aria-label="Close mission"
        >
          ×
        </button>
      </header>
      <div className="iris-quest-layout">
        <aside className="iris-quest-list">
          <div className="iris-list-heading">Available</div>
          <div className="iris-quest-selected">
            <span className="iris-quest-icon">!</span>
            <span>
              Greenfall Relay<small>Earth · Rescue</small>
            </span>
          </div>
        </aside>
        <div className="iris-quest-detail">
          <div className="iris-orbit-art" aria-hidden="true">
            <svg viewBox="0 0 340 130" fill="none">
              <defs>
                <radialGradient id="earth-ocean" cx="30%" cy="25%">
                  <stop stopColor="#679fa8" />
                  <stop offset=".55" stopColor="#224a60" />
                  <stop offset="1" stopColor="#0b192b" />
                </radialGradient>
                <clipPath id="earth-disc">
                  <circle cx="200" cy="73" r="68" />
                </clipPath>
              </defs>
              <ellipse
                cx="200"
                cy="73"
                rx="112"
                ry="36"
                stroke="#80bbb9"
                strokeOpacity=".24"
                transform="rotate(-20 200 73)"
              />
              <circle
                cx="200"
                cy="73"
                r="72"
                stroke="#8fddd0"
                strokeOpacity=".13"
              />
              <circle cx="200" cy="73" r="68" fill="url(#earth-ocean)" />
              <g clipPath="url(#earth-disc)" fill="#699d83" opacity=".8">
                <path d="m140 25 25-12 25 8 5 17-15 6-2 17-15 4-6-13-20-8zM181 62l16 5 8 20-10 26-9-16 2-14-13-13zM223 10l31 12 9 29-19 10-12-15-15-3-5-15zM216 54l16-5 13 17-5 19-15 16-8-16-6-13z" />
                <path
                  d="M136 51q42-23 72-10t58-4M148 94q25-10 47 0t58-2"
                  fill="none"
                  stroke="#def2e3"
                  strokeWidth="4"
                  opacity=".3"
                />
              </g>
              <circle cx="163" cy="67" r="3" fill="#f0d29b" />
              <circle
                className="iris-site-pulse"
                cx="163"
                cy="67"
                r="8"
                stroke="#f0d29b"
              />
              <path
                d="M156 67H65l-12 12H25"
                stroke="#f0d29b"
                strokeOpacity=".55"
              />
              <path
                d="M23 75v8m-4-4h8M302 23v8m-4-4h8M94 24h2m203 77h2M36 33h2"
                stroke="#b4d5d5"
                strokeOpacity=".65"
              />
            </svg>
            <span>EARTH</span>
          </div>
          <p>
            Three researchers are trapped in powered shelters. Destroy the
            jammer to release them.
          </p>
          <ol className="iris-objectives">
            <li>Disable the jammer</li>
            <li>Beam out 3 researchers</li>
            <li>Return to the landing beacon</li>
          </ol>
          <p className="iris-quest-note">
            Guards patrol the relay. Fight or find a way past.
          </p>
          <button
            className="iris-button iris-primary"
            disabled={!ready}
            onClick={onDeploy}
          >
            {ready ? (
              <>
                Deploy <span aria-hidden="true">↗</span>
              </>
            ) : (
              'Loading…'
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Journal({ snapshot, save, onClose }) {
  const [tab, setTab] = useState('Active');
  const completed = save.completedMissionIds.includes(MISSION_ID);
  const visible = tab === 'Active' ? !!snapshot : completed;
  return (
    <Modal label="Quest journal" onClose={onClose} className="iris-journal">
      <header className="iris-console-head">
        <h2>Quest journal</h2>
        <button
          className="iris-icon-button"
          onClick={onClose}
          aria-label="Close journal"
        >
          ×
        </button>
      </header>
      <div className="iris-quest-layout">
        <aside className="iris-quest-list">
          <div className="iris-tabs" role="tablist" aria-label="Quests">
            {['Active', 'Completed'].map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {visible && (
            <div className="iris-quest-selected">
              <span className="iris-quest-icon">
                {tab === 'Completed' ? '✓' : '!'}
              </span>
              <span>
                Greenfall Relay<small>Earth · Rescue</small>
              </span>
            </div>
          )}
        </aside>
        <div className="iris-quest-detail" role="tabpanel" aria-label={tab}>
          {visible ? (
            <>
              <h2>Greenfall Relay</h2>
              <p>
                {tab === 'Completed'
                  ? 'All three researchers are aboard Kestrel.'
                  : 'Disable the jammer to open the shelters, then hold the rescue beam on each researcher.'}
              </p>
              <ol className="iris-objectives">
                {[
                  'Disable the jammer',
                  'Rescue the researchers',
                  'Return to the beacon',
                ].map((label, i) => {
                  const o = snapshot?.objectives[i];
                  const done =
                    tab === 'Completed' ||
                    o?.state === OBJECTIVE_STATE.COMPLETE;
                  return (
                    <li
                      key={label}
                      className={
                        done
                          ? 'complete'
                          : o?.state === OBJECTIVE_STATE.ACTIVE
                            ? 'active'
                            : ''
                      }
                    >
                      <span>{done ? '✓' : '□'}</span>
                      {label}
                      {i === 1 && tab === 'Active'
                        ? ` · ${o?.current || 0}/3`
                        : ''}
                    </li>
                  );
                })}
              </ol>
              {tab === 'Completed' ? (
                <p className="iris-quest-note">
                  Best time · {formatTime(save.bestTimes[MISSION_ID])}
                </p>
              ) : (
                <p className="iris-quest-note">
                  1 Gun · 2 Mining tool · 3 Rescue beam
                </p>
              )}
            </>
          ) : (
            <p>No {tab.toLowerCase()} quests.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function SandCampaign() {
  const [save, setSave] = useState(readCampaignSave);
  const [phase, setPhase] = useState('ship');
  const [briefing, setBriefing] = useState(false);
  const [shipReady, setShipReady] = useState(false);
  const [run, setRun] = useState(null);
  const [report, setReport] = useState(null);
  const [menu, setMenu] = useState(false);
  const [journal, setJournal] = useState(false);
  const [missionState, setMissionState] = useState(null);
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem('sand-audio-muted') === '1';
    } catch {
      return false;
    }
  });
  const host = useRef(null);
  const finishRef = useRef(false);
  const attempt = useRef(0);
  const timers = useRef(new Set());
  const schedule = useCallback((fn, ms) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);
  useEffect(
    () => () => {
      for (const id of timers.current) clearTimeout(id);
    },
    [],
  );
  const store = useCallback(
    (update) => setSave((current) => updateCampaignSave(current, update)),
    [],
  );
  const focusGame = useCallback(
    () =>
      requestAnimationFrame(() =>
        host.current?.shadowRoot?.querySelector('.sg-sim')?.focus(),
      ),
    [],
  );
  const closeBriefing = useCallback(() => {
    setBriefing(false);
    focusGame();
  }, [focusGame]);
  const closeMenu = useCallback(() => {
    setMenu(false);
    focusGame();
  }, [focusGame]);

  const closeJournal = useCallback(() => {
    setJournal(false);
    focusGame();
  }, [focusGame]);
  useEffect(() => {
    host.current?.setPaused?.(
      briefing || menu || journal || !['ship', 'field'].includes(phase),
    );
  }, [briefing, menu, journal, phase, shipReady]);
  useEffect(() => {
    host.current?._game?.setAudioMuted(muted);
  }, [muted]);
  useEffect(() => {
    if (!['ship', 'field'].includes(phase)) return undefined;
    const key = (event) => {
      if (event.repeat || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))
        return;
      if (
        event.code === 'KeyJ' &&
        !briefing &&
        !menu &&
        !host.current?._hud?.isOpen?.()
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setJournal((value) => !value);
        if (journal) focusGame();
      } else if (
        event.key === 'Escape' &&
        !journal &&
        !briefing &&
        phase === 'field'
      ) {
        if (host.current?._hud?.isOpen?.()) return;
        event.preventDefault();
        setMuted(host.current?._game?.getAudioState().muted ?? false);
        setMenu((value) => !value);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [phase, journal, briefing, menu, focusGame]);

  const launch = useCallback(() => {
    for (const id of timers.current) clearTimeout(id);
    timers.current.clear();
    setMenu(false);
    setBriefing(false);
    setReport(null);
    setJournal(false);
    setMissionState(null);
    finishRef.current = false;
    const selection = defaultLoadoutSelection(MISSION_ID);
    store((current) =>
      beginCampaignRun(current, MISSION_ID, EARTH_SEED, selection),
    );
    setRun({
      seed: EARTH_SEED,
      loadout: buildMissionLoadout(MISSION_ID, selection),
      attempt: ++attempt.current,
    });
    setPhase('descent');
  }, [store]);

  const ready = useCallback(() => {
    host.current?._game?.setDayPhase(0.2);
    if (!run) {
      setShipReady(true);
      host.current?.setPaused?.(briefing || phase !== 'ship');
      if (!briefing && phase === 'ship') focusGame();
      return;
    }
    host.current?.setPaused?.(true);
    setPhase('field');
    host.current?.setPaused?.(false);
    host.current?._game?.playBeamSound?.();
    focusGame();
  }, [briefing, focusGame, phase, run]);

  const finish = useCallback(
    (result) => {
      if (finishRef.current) return;
      finishRef.current = true;
      setReport(result);
      setPhase('extraction');
      host.current?._game?.playBeamSound?.();
      store((current) => completeCampaignMission(current, MISSION_ID, result));
      schedule(() => {
        setRun(null);
        setShipReady(false);
        setPhase('report');
      }, 500);
    },
    [schedule, store],
  );
  const fail = useCallback((result) => {
    if (finishRef.current) return;
    finishRef.current = true;
    for (const id of timers.current) clearTimeout(id);
    timers.current.clear();
    setReport(result);
    setPhase('failed');
  }, []);
  const returnToShip = useCallback(() => {
    for (const id of timers.current) clearTimeout(id);
    timers.current.clear();
    store(abandonCampaignRun);
    setRun(null);
    setReport(null);
    setJournal(false);
    setMissionState(null);
    setMenu(false);
    setBriefing(false);
    if (run) setShipReady(false);
    setPhase('ship');
    focusGame();
  }, [focusGame, run, store]);
  return (
    <main className={`iris-experience iris-phase-${phase}`}>
      <SandGame
        key={run ? `earth-${run.attempt}` : 'kestrel'}
        mode="survival"
        planet={run ? 'earth' : 'ship'}
        mission={run ? MISSION_ID : undefined}
        worldSeed={run?.seed ?? 0x4b455354}
        loadout={run?.loadout}
        hostRef={host}
        onReady={ready}
        onMissionUpdate={setMissionState}
        onMissionComplete={finish}
        onMissionFailed={fail}
        onTalkAction={({ action }) => {
          if (action === 'mission-console') setBriefing(true);
        }}
        onError={() => setPhase('error')}
      />
      {!run && (
        <header className="iris-ship-header">
          <span className="iris-location">
            <i aria-hidden="true">◇</i> Kestrel
          </span>
          <button
            className="iris-button iris-secondary"
            onClick={() => setBriefing(true)}
          >
            Earth mission
          </button>
        </header>
      )}
      {briefing && !run && (
        <Briefing ready={shipReady} onClose={closeBriefing} onDeploy={launch} />
      )}
      {phase === 'field' && (
        <header className="iris-field-header">
          <span className="iris-location">
            <i aria-hidden="true">◌</i> Earth
          </span>
          <button
            className="iris-icon-button"
            aria-label="Pause expedition"
            onClick={() => {
              setMuted(host.current?._game?.getAudioState().muted ?? false);
              setMenu(true);
            }}
          >
            Ⅱ
          </button>
        </header>
      )}
      {['ship', 'field'].includes(phase) && (
        <div className="iris-control-strip">
          <span>
            <kbd>A D</kbd> Move
          </span>
          <span>
            <kbd>SPACE</kbd> Jump / thrust
          </span>
          {run && (
            <>
              <span>
                <kbd>F</kbd> Block
              </span>
              <span>
                <kbd>1 / 2 / 3</kbd> Gun / mine / rescue
              </span>
            </>
          )}
          {!run && (
            <span>
              <kbd>T</kbd> Talk
            </span>
          )}
          <span>
            <kbd>J</kbd> Quests
          </span>
          <span>
            <kbd>E</kbd> Inventory
          </span>
        </div>
      )}
      {['descent', 'extraction'].includes(phase) && (
        <div className="iris-loading" role="status">
          {phase === 'descent' ? 'Loading Earth…' : 'Returning to ship…'}
        </div>
      )}
      {journal && (
        <Journal
          snapshot={run ? missionState : null}
          save={save}
          onClose={closeJournal}
        />
      )}
      {menu && (
        <Modal
          label="Expedition paused"
          onClose={closeMenu}
          className="iris-small-modal"
        >
          <h2>Paused</h2>
          <button className="iris-button iris-primary" onClick={closeMenu}>
            Resume
          </button>
          <button
            className="iris-button iris-secondary"
            onClick={() => setMuted((v) => !v)}
          >
            Sound {muted ? 'off' : 'on'}
          </button>
          <button className="iris-text-button" onClick={returnToShip}>
            Abandon mission
          </button>
        </Modal>
      )}
      {['report', 'failed', 'error'].includes(phase) && (
        <Modal
          label={
            phase === 'report'
              ? 'Expedition complete'
              : 'Expedition interrupted'
          }
          className="iris-report iris-small-modal"
        >
          <h2>
            {phase === 'report'
              ? 'Mission complete'
              : phase === 'error'
                ? 'Game unavailable'
                : 'Mission failed'}
          </h2>
          {phase === 'report' && (
            <p>3 rescued · {formatTime(report?.elapsedTicks)}</p>
          )}
          <button
            className="iris-button iris-primary"
            onClick={phase === 'report' ? returnToShip : launch}
          >
            {phase === 'report' ? 'Continue' : 'Retry'}
          </button>
          {phase !== 'report' && (
            <button className="iris-text-button" onClick={returnToShip}>
              Return to ship
            </button>
          )}
        </Modal>
      )}
    </main>
  );
}
