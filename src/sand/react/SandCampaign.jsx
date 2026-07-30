import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SandGame } from './SandGame';
import {
  AGENCY,
  CAMPAIGN_MISSIONS,
  LOADOUT_SUPPLIES,
  RECOVERABLE_WEAPONS,
  SHIP_NAME,
  buildMissionLoadout,
  getCampaignMission,
  getNextCampaignMission,
  getRecoverableWeapon,
  loadoutSelectionCost,
} from '../campaign/missions.js';
import {
  CAMPAIGN_STORAGE_KEY,
  abandonCampaignRun,
  beginCampaignRun,
  completeCampaignMission,
  firstIncompleteMission,
  isCampaignMissionUnlocked,
  loadoutForCampaignMission,
  readCampaignSave,
  setCampaignLoadout,
  updateCampaignSave,
} from '../campaign/campaignSave.js';

const PANEL = 'border-[3px] border-[#080a0c] bg-[#171c21]/95 shadow-[inset_0_0_0_2px_#4b555e,7px_7px_0_rgba(0,0,0,.5)]';
const BUTTON = 'border-[3px] border-[#080a0c] font-mono text-[10px] font-black uppercase tracking-[.14em] shadow-[inset_0_0_0_2px_rgba(255,255,255,.18),4px_4px_0_#080a0c] transition enabled:hover:-translate-x-px enabled:hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40';

function randomSeed() {
  const values = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
    return values[0];
  }
  return (Math.random() * 0x100000000) >>> 0;
}

function formatMissionTime(ticks) {
  if (!(ticks > 0)) return '—';
  const seconds = Math.floor(ticks / 60);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function PlanetBadge({ mission, locked, completed, selected, onSelect }) {
  return (
    <button
      type="button"
      disabled={locked}
      onClick={onSelect}
      aria-pressed={selected}
      className={`group relative min-w-0 flex-1 border-[3px] px-3 py-3 text-left font-mono transition ${
        selected
          ? 'border-[#f0d465] bg-[#2b2b25] shadow-[inset_0_0_0_2px_#736a3f,5px_5px_0_#080a0c]'
          : 'border-[#080a0c] bg-[#20262b] shadow-[inset_0_0_0_2px_#4b555e,4px_4px_0_rgba(0,0,0,.45)] enabled:hover:bg-[#293138]'
      } disabled:cursor-not-allowed disabled:saturate-0`}
    >
      <span
        className="mb-2 block h-1.5 w-10"
        style={{ background: locked ? '#59616a' : mission.accent }}
      />
      <span className="block text-[8px] font-black uppercase tracking-[.18em] text-[#8f9aa4]">
        {locked ? 'Locked' : completed ? 'Complete' : `Mission ${mission.order + 1}`}
      </span>
      <span className="mt-1 block truncate text-[12px] font-black uppercase tracking-[.08em] text-white">
        {mission.planetName}
      </span>
      <span className="mt-1 block truncate text-[8px] font-bold uppercase tracking-[.08em] text-[#b7c0c8]">
        {locked ? 'Awaiting clearance' : mission.title}
      </span>
      {completed && (
        <span className="absolute right-2 top-2 text-[12px] text-[#75d39a]" aria-label="Complete">✓</span>
      )}
    </button>
  );
}

function SupplyControl({ supply, packs, budgetLeft, onChange }) {
  const canAdd = packs < supply.maxPacks && budgetLeft >= supply.packCost;
  return (
    <div className="grid grid-cols-[36px_1fr_auto] items-center gap-3 border-2 border-[#0a0c0f] bg-[#20262b] p-2 shadow-[inset_2px_2px_0_#3e474f]">
      <span
        className="h-8 w-8 border-2 border-[#090b0d] shadow-[inset_3px_3px_0_rgba(255,255,255,.2),inset_-3px_-3px_0_rgba(0,0,0,.25)]"
        style={{ background: supply.color }}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="block font-mono text-[10px] font-black uppercase tracking-[.08em] text-white">
          {supply.name}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[8px] text-[#8f9aa4]">
          {supply.packSize} units · {supply.packCost} capacity
        </span>
      </span>
      <span className="flex items-center gap-1">
        <button
          type="button"
          disabled={packs <= 0}
          onClick={() => onChange(packs - 1)}
          className="grid h-7 w-7 place-items-center border-2 border-[#080a0c] bg-[#303840] font-mono text-sm font-black text-white shadow-[inset_0_0_0_1px_#59636c] disabled:opacity-30"
          aria-label={`Remove one ${supply.name} pack`}
        >
          −
        </button>
        <output className="w-5 text-center font-mono text-[11px] font-black text-[#f0d465]">
          {packs}
        </output>
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => onChange(packs + 1)}
          className="grid h-7 w-7 place-items-center border-2 border-[#080a0c] bg-[#4d6041] font-mono text-sm font-black text-white shadow-[inset_0_0_0_1px_#788d65] disabled:opacity-30"
          aria-label={`Add one ${supply.name} pack`}
        >
          +
        </button>
      </span>
    </div>
  );
}

function ShipHub({
  focusRef,
  save,
  mission,
  selection,
  onSelectMission,
  onChangeSelection,
  onDeploy,
  onRetryInterrupted,
}) {
  const [terminalOpen, setTerminalOpen] = useState(false);
  const terminalButtonRef = useRef(null);
  const cost = loadoutSelectionCost(selection);
  const budgetLeft = mission.loadoutBudget - cost;
  const unlockedWeapons = RECOVERABLE_WEAPONS.filter(({ itemKind }) =>
    save.unlockedWeapons.includes(itemKind));
  const best = save.bestTimes[mission.id];

  const closeTerminal = useCallback(() => {
    setTerminalOpen(false);
    requestAnimationFrame(() => terminalButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!terminalOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeTerminal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeTerminal, terminalOpen]);

  const updatePacks = (id, packs) => {
    onChangeSelection({
      ...selection,
      packs: { ...selection.packs, [id]: packs },
    });
  };

  return (
    <main
      ref={focusRef}
      tabIndex={-1}
      aria-label={`${SHIP_NAME} mission deck`}
      className="relative h-screen overflow-hidden bg-[#02040a] px-4 py-4 text-white"
    >
      <SandGame mode="survival" planet="ship" worldSeed={0x4b455354} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-[#b5573f] shadow-[0_3px_0_#080a0c,0_6px_0_#283039]" />
      <div className="pointer-events-none absolute bottom-20 left-5 z-[79] hidden max-w-xs border-l-4 border-[#f0d465] bg-[#0a0d12]/72 p-3 font-mono md:block">
        <p className="text-[8px] font-black uppercase tracking-[.18em] text-[#f0d465]">
          Walkable ship
        </p>
        <p className="mt-1 text-[9px] leading-4 text-[#d4d9de]">
          Move through the Kestrel with WASD. Commander Vale, Engineer Osei,
          the transporter, armory, and observation deck are physically aboard.
          Open the mission console when you are ready to deploy.
        </p>
      </div>
      <div className="absolute right-4 top-4 z-[80] flex items-stretch gap-2 font-mono">
        <button
          ref={terminalButtonRef}
          type="button"
          aria-expanded={terminalOpen}
          aria-controls="kestrel-mission-console"
          onClick={() => setTerminalOpen(true)}
          className={`${BUTTON} bg-[#d4b94d] px-4 py-3 text-left text-[#17140a] shadow-[inset_0_0_0_2px_#fff1a0,5px_5px_0_#080a0c]`}
        >
          <span className="block text-[7px] tracking-[.2em]">Field Ship {SHIP_NAME}</span>
          <span className="mt-1 block text-[10px]">Open mission console</span>
        </button>
        <a
          href="/"
          className={`${BUTTON} grid place-items-center bg-[#252b31] px-3 py-2 text-white hover:text-[#f0d465]`}
        >
          ← Portfolio
        </a>
      </div>
      {terminalOpen && (
      <div className="absolute inset-0 z-[85] bg-[#02040a]/48 p-2 backdrop-blur-[1px] md:p-4">
      <section
        id="kestrel-mission-console"
        role="dialog"
        aria-modal="true"
        aria-label={`${SHIP_NAME} mission console`}
        className="pointer-events-none ml-auto flex h-full min-h-0 w-full max-w-[760px] flex-col overflow-hidden"
      >
        <header className="pointer-events-auto mb-3 flex flex-col gap-3 border-[3px] border-[#080a0c] bg-[#11171d]/92 p-3 font-mono shadow-[inset_0_0_0_1px_#4b555e,5px_5px_0_rgba(0,0,0,.5)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center border-[3px] border-[#080a0c] bg-[#f0d465] text-[13px] font-black tracking-[-.05em] text-[#17140a] shadow-[inset_0_0_0_2px_#fff1a0,4px_4px_0_#080a0c]">
              IRIS
            </span>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[.2em] text-[#f0d465]">{AGENCY.name}</p>
              <h1 className="mt-1 text-[17px] font-black uppercase tracking-[.12em]">Field Ship {SHIP_NAME}</h1>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto] items-center gap-2">
            <button
              type="button"
              onClick={onDeploy}
              className={`${BUTTON} bg-[#d4b94d] px-4 py-3 text-[#17140a] shadow-[inset_0_0_0_2px_#fff1a0,4px_4px_0_#080a0c]`}
            >
              Beam down to {mission.planetName}
            </button>
            <button
              type="button"
              autoFocus
              onClick={closeTerminal}
              aria-label="Close mission console"
              className={`${BUTTON} bg-[#252b31] px-3 py-3 text-white hover:text-[#f0d465]`}
            >
              × Close
            </button>
          </div>
        </header>

        <div className="pointer-events-auto min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2">
        {save.interruptedRun && (
          <section className={`${PANEL} mb-3 flex items-center justify-between gap-4 border-l-[#d48755] px-4 py-3 font-mono`}>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[.16em] text-[#dca071]">Interrupted deployment</p>
              <p className="mt-1 text-[9px] text-[#b7c0c8]">
                Terrain progress was not saved. Kestrel can rebuild the same mission and loadout.
              </p>
            </div>
            <button
              type="button"
              onClick={onRetryInterrupted}
              className={`${BUTTON} shrink-0 bg-[#815436] px-4 py-2 text-white`}
            >
              Retry
            </button>
          </section>
        )}

        <nav className="mb-3 grid grid-cols-3 gap-2" aria-label="Campaign missions">
          {CAMPAIGN_MISSIONS.map((entry, order) => (
            <PlanetBadge
              key={entry.id}
              mission={{ ...entry, order }}
              locked={!isCampaignMissionUnlocked(save, entry.id)}
              completed={save.completedMissionIds.includes(entry.id)}
              selected={mission.id === entry.id}
              onSelect={() => onSelectMission(entry.id)}
            />
          ))}
        </nav>

        <div className="grid min-h-0 grid-cols-1 gap-3">
          <section className={`${PANEL} relative overflow-hidden p-5`}>
            <div
              className="absolute inset-x-0 top-0 h-28 opacity-45"
              style={{ background: mission.sky }}
            />
            <div className="relative">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[9px] font-black uppercase tracking-[.2em]" style={{ color: mission.accent }}>
                    {mission.operation}
                  </p>
                  <h2 className="mt-2 font-mono text-3xl font-black uppercase tracking-[.06em] text-white">
                    {mission.title}
                  </h2>
                  <p className="mt-1 font-mono text-[9px] uppercase tracking-[.12em] text-[#c0c8cf]">
                    {mission.coordinates}
                  </p>
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-px border-2 border-[#080a0c] bg-[#080a0c] text-center font-mono">
                  <span className="bg-[#252b31] px-3 py-2">
                    <small className="block text-[7px] uppercase tracking-[.14em] text-[#87919a]">Gravity</small>
                    <strong className="mt-1 block text-[11px] text-white">{mission.gravityLabel}</strong>
                  </span>
                  <span className="bg-[#252b31] px-3 py-2">
                    <small className="block text-[7px] uppercase tracking-[.14em] text-[#87919a]">Window</small>
                    <strong className="mt-1 block text-[11px] text-white">{mission.duration}</strong>
                  </span>
                </div>
              </div>

              <div className="border-l-4 border-[#f0d465] bg-[#101419]/90 p-4">
                <p className="font-mono text-[8px] font-black uppercase tracking-[.18em] text-[#f0d465]">
                  Commander&apos;s briefing
                </p>
                <p className="mt-2 max-w-3xl text-[13px] leading-6 text-[#d4d9de]">{mission.briefing}</p>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto]">
                <div>
                  <h3 className="font-mono text-[9px] font-black uppercase tracking-[.18em] text-[#9fa8b0]">Mission sequence</h3>
                  <ol className="mt-3 space-y-2">
                    {mission.objectives.map((objective, index) => (
                      <li key={objective} className="flex gap-3 border-2 border-[#0a0c0f] bg-[#20262b] p-3">
                        <span className="grid h-6 w-6 shrink-0 place-items-center bg-[#f0d465] font-mono text-[10px] font-black text-[#17140a]">
                          {index + 1}
                        </span>
                        <span className="text-[11px] leading-5 text-[#d4d9de]">{objective}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <aside className="min-w-40 border-2 border-[#0a0c0f] bg-[#20262b] p-3 font-mono">
                  <h3 className="text-[8px] font-black uppercase tracking-[.18em] text-[#d48755]">Hazards</h3>
                  <ul className="mt-2 space-y-2 text-[8px] font-bold uppercase tracking-[.08em] text-[#b7c0c8]">
                    {mission.hazards.map((hazard) => <li key={hazard}>▸ {hazard}</li>)}
                  </ul>
                  <p className="mt-4 border-t border-[#4b555e] pt-3 text-[8px] uppercase tracking-[.1em] text-[#87919a]">
                    Best extraction<br />
                    <strong className="mt-1 block text-[12px] text-white">{formatMissionTime(best)}</strong>
                  </p>
                </aside>
              </div>
            </div>
          </section>

          <section className={`${PANEL} flex min-h-0 flex-col p-4`}>
            <div className="mb-3 flex items-end justify-between gap-3 border-b-2 border-[#4b555e] pb-3 font-mono">
              <div>
                <p className="text-[8px] font-black uppercase tracking-[.18em] text-[#f0d465]">Kestrel armory</p>
                <h2 className="mt-1 text-[15px] font-black uppercase tracking-[.1em]">Field loadout</h2>
              </div>
              <div className="text-right">
                <p className="text-[7px] uppercase tracking-[.13em] text-[#87919a]">Capacity</p>
                <p className={`mt-1 text-[13px] font-black ${budgetLeft ? 'text-white' : 'text-[#f0d465]'}`}>
                  {cost}/{mission.loadoutBudget}
                </p>
              </div>
            </div>

            <p className="mb-3 font-mono text-[8px] leading-4 text-[#9fa8b0]">
              Blast gun and IRIS mining manipulator are standard issue. Choose bounded mission supplies below.
            </p>

            <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
              {LOADOUT_SUPPLIES.map((supply) => (
                <SupplyControl
                  key={supply.id}
                  supply={supply}
                  packs={selection.packs[supply.id] || 0}
                  budgetLeft={budgetLeft}
                  onChange={(packs) => updatePacks(supply.id, packs)}
                />
              ))}
            </div>

            <div className="mt-3 border-2 border-[#0a0c0f] bg-[#20262b] p-3 font-mono">
              <label htmlFor="campaign-weapon" className="block text-[8px] font-black uppercase tracking-[.16em] text-[#9fa8b0]">
                Recovered weapon
              </label>
              <select
                id="campaign-weapon"
                value={selection.weaponItemKind ?? ''}
                onChange={(event) => onChangeSelection({
                  ...selection,
                  weaponItemKind: event.target.value === '' ? null : Number(event.target.value),
                })}
                className="mt-2 w-full border-2 border-[#080a0c] bg-[#101419] px-3 py-2 font-mono text-[10px] font-bold text-white outline-none focus:border-[#f0d465]"
              >
                <option value="">Standard blast gun only</option>
                {unlockedWeapons.map((weapon) => (
                  <option key={weapon.itemKind} value={weapon.itemKind}>
                    {weapon.name} · {weapon.ammo} ammo
                  </option>
                ))}
              </select>
              {!unlockedWeapons.length && (
                <p className="mt-2 text-[8px] leading-4 text-[#78838c]">
                  Extract enemy equipment to register it with the Kestrel armory.
                </p>
              )}
            </div>

          </section>
        </div>
        </div>
      </section>
      </div>
      )}
    </main>
  );
}

function DeploymentOverlay({ mission }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[95] grid place-items-center bg-[#080b10] font-mono text-white">
      <div className="text-center">
        <div className="mx-auto mb-5 h-24 w-1 bg-[#f0d465] shadow-[0_0_12px_3px_#f0d465,0_0_60px_22px_rgba(240,212,101,.28)]" />
        <p className="text-[9px] font-black uppercase tracking-[.26em] text-[#f0d465]">Kestrel transporter locked</p>
        <h2 className="mt-3 text-xl font-black uppercase tracking-[.12em]">{mission.operation}</h2>
        <p className="mt-2 text-[9px] uppercase tracking-[.14em] text-[#8f9aa4]">Materializing field agent…</p>
      </div>
    </div>
  );
}

function DeploymentFailure({ mission, onRetry, onReturn }) {
  return (
    <div className="absolute inset-0 z-[96] grid place-items-center bg-[#080b10]/95 p-6 font-mono text-white" role="alert">
      <section className={`${PANEL} w-full max-w-lg p-7 text-center`}>
        <p className="text-[9px] font-black uppercase tracking-[.22em] text-[#dc7657]">
          Transporter link failed
        </p>
        <h2 className="mt-3 text-xl font-black uppercase tracking-[.1em]">{mission.operation}</h2>
        <p className="mt-3 text-[10px] leading-5 text-[#b7c0c8]">
          Kestrel could not initialize the field simulation. Retry the beam sequence or return to the mission deck.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" onClick={onReturn} className={`${BUTTON} bg-[#252b31] px-5 py-3 text-white`}>
            Return to {SHIP_NAME}
          </button>
          <button type="button" onClick={onRetry} autoFocus className={`${BUTTON} bg-[#815436] px-5 py-3 text-white`}>
            Retry deployment
          </button>
        </div>
      </section>
    </div>
  );
}

function Debrief({ mission, result, newlyRecovered, failed, onContinue, onRetry }) {
  const next = getNextCampaignMission(mission.id);
  const report = (
      <section className={`${PANEL} w-full max-w-2xl p-7 font-mono ${
        failed ? 'bg-[#171c21]/78 backdrop-blur-[2px]' : ''
      }`}>
        <div className={`mb-5 inline-block px-3 py-2 text-[9px] font-black uppercase tracking-[.2em] text-[#111] ${
          failed ? 'bg-[#dc7657]' : 'bg-[#75d39a]'
        }`}>
          {failed ? 'Mission interrupted' : 'Extraction confirmed'}
        </div>
        <p className="text-[8px] font-black uppercase tracking-[.2em] text-[#8f9aa4]">{mission.operation}</p>
        <h1 className="mt-2 text-3xl font-black uppercase tracking-[.07em]">
          {failed ? 'Agent signal lost' : 'Welcome back aboard'}
        </h1>
        <p className="mt-3 text-[11px] leading-6 text-[#c3cbd2]">
          {failed
            ? 'No field progress was committed. Kestrel can rebuild the deployment from its original seed and loadout.'
            : `${mission.title} is complete. IRIS has archived the mission report and cleared recovered equipment for future deployments.`}
        </p>

        {!failed && (
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="border-2 border-[#080a0c] bg-[#20262b] p-4 shadow-[inset_2px_2px_0_#46515a]">
              <span className="text-[8px] uppercase tracking-[.16em] text-[#8f9aa4]">Mission time</span>
              <strong className="mt-2 block text-xl text-white">{formatMissionTime(result?.elapsedTicks)}</strong>
            </div>
            <div className="border-2 border-[#080a0c] bg-[#20262b] p-4 shadow-[inset_2px_2px_0_#46515a]">
              <span className="text-[8px] uppercase tracking-[.16em] text-[#8f9aa4]">New armory records</span>
              <strong className="mt-2 block text-xl text-white">{newlyRecovered.length}</strong>
            </div>
          </div>
        )}

        {!!newlyRecovered.length && (
          <div className="mt-4 border-l-4 border-[#f0d465] bg-[#20262b] p-4">
            <p className="text-[8px] font-black uppercase tracking-[.16em] text-[#f0d465]">Recovered equipment</p>
            <p className="mt-2 text-[10px] text-white">
              {newlyRecovered.map((kind) => getRecoverableWeapon(kind)?.name).filter(Boolean).join(' · ')}
            </p>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          {failed && (
            <button type="button" onClick={onRetry} className={`${BUTTON} bg-[#815436] px-5 py-3 text-white`}>
              Retry mission
            </button>
          )}
          <button type="button" onClick={onContinue} className={`${BUTTON} bg-[#d4b94d] px-5 py-3 text-[#17140a]`}>
            {failed ? `Return to ${SHIP_NAME}` : next ? `Brief ${next.planetName}` : 'Return to mission deck'}
          </button>
        </div>
      </section>
  );
  if (failed) {
    return (
      <div className="absolute inset-0 z-[98] grid place-items-center bg-transparent p-6 text-white">
        {report}
      </div>
    );
  }
  return (
    <main className="relative h-screen overflow-hidden bg-[#02040a] text-white">
      <SandGame mode="survival" planet="ship" worldSeed={0x4b455354} />
      <div className="absolute inset-0 z-[90] grid place-items-center bg-[#02040a]/28 p-6 backdrop-blur-[1px]">
        {report}
      </div>
    </main>
  );
}

function BeamUpOverlay({ mission }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[97] overflow-hidden font-mono text-white">
      <style>{`
        @keyframes iris-beam-column {
          0% { opacity: 0; transform: scaleX(.12); }
          18% { opacity: .96; transform: scaleX(1); }
          72% { opacity: .92; transform: scaleX(.72); }
          100% { opacity: 0; transform: scaleX(.04); }
        }
        @keyframes iris-beam-rings {
          from { opacity: .9; transform: translate(-50%,-50%) scale(.2); }
          to { opacity: 0; transform: translate(-50%,-50%) scale(2.8); }
        }
      `}</style>
      <div className="absolute inset-y-0 left-1/2 w-24 -translate-x-1/2 animate-[iris-beam-column_1.55s_ease-in-out_forwards] bg-[linear-gradient(90deg,transparent,rgba(91,241,255,.48),#f6ffff,rgba(91,241,255,.48),transparent)] shadow-[0_0_45px_18px_rgba(86,229,255,.44)]" />
      {[0, 1, 2, 3].map((ring) => (
        <span
          key={ring}
          className="absolute left-1/2 top-1/2 h-14 w-14 rounded-full border-4 border-[#a8fbff] shadow-[0_0_18px_#62ecff]"
          style={{
            animation: `iris-beam-rings .82s ${ring * .18}s ease-out both`,
          }}
        />
      ))}
      <div className="absolute inset-x-0 top-8 text-center">
        <p className="text-[9px] font-black uppercase tracking-[.28em] text-[#a8fbff]">
          Extraction lock confirmed
        </p>
        <h2 className="mt-2 text-lg font-black uppercase tracking-[.12em]">
          Beaming to {SHIP_NAME} · {mission.operation}
        </h2>
      </div>
    </div>
  );
}

export function SandCampaign() {
  const [save, setSave] = useState(() => readCampaignSave());
  const saveRef = useRef(save);
  const shipFocusRef = useRef(null);
  const focusShipOnMountRef = useRef(false);
  const [selectedMissionId, setSelectedMissionId] = useState(() =>
    readCampaignSave().selectedMissionId);
  const [selection, setSelection] = useState(() => {
    const initial = readCampaignSave();
    return loadoutForCampaignMission(initial, initial.selectedMissionId);
  });
  const [run, setRun] = useState(null);
  const [phase, setPhase] = useState('ship');
  const [debrief, setDebrief] = useState(null);
  const [missionUpdate, setMissionUpdate] = useState(null);
  const mission = getCampaignMission(run?.missionId || selectedMissionId);

  const commitSave = useCallback((update) => {
    const stored = updateCampaignSave(saveRef.current, update);
    saveRef.current = stored;
    setSave(stored);
    return stored;
  }, []);

  useEffect(() => {
    if (phase !== 'ship' || !focusShipOnMountRef.current) return undefined;
    focusShipOnMountRef.current = false;
    const frame = requestAnimationFrame(() => shipFocusRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  useEffect(() => {
    const syncExternalSave = (event) => {
      if (event.key !== CAMPAIGN_STORAGE_KEY) return;
      const next = readCampaignSave();
      saveRef.current = next;
      setSave(next);
      if (phase !== 'ship') return;
      setSelectedMissionId((current) => {
        const missionId = isCampaignMissionUnlocked(next, current)
          ? current
          : next.selectedMissionId;
        setSelection(loadoutForCampaignMission(next, missionId));
        return missionId;
      });
    };
    window.addEventListener('storage', syncExternalSave);
    return () => window.removeEventListener('storage', syncExternalSave);
  }, [phase]);

  const selectMission = useCallback((missionId) => {
    const nextSave = commitSave((current) => isCampaignMissionUnlocked(current, missionId)
      ? { ...current, selectedMissionId: missionId }
      : current);
    if (nextSave.selectedMissionId !== missionId) return;
    setSelectedMissionId(missionId);
    setSelection(loadoutForCampaignMission(nextSave, missionId));
  }, [commitSave]);

  const changeSelection = useCallback((nextSelection) => {
    const nextSave = commitSave((current) =>
      setCampaignLoadout(current, selectedMissionId, nextSelection));
    setSelection(loadoutForCampaignMission(nextSave, selectedMissionId));
  }, [commitSave, selectedMissionId]);

  const deploy = useCallback((missionId, worldSeed, selectedLoadout) => {
    const nextSave = commitSave((current) =>
      beginCampaignRun(current, missionId, worldSeed, selectedLoadout));
    const normalized = loadoutForCampaignMission(nextSave, missionId);
    setSelection(normalized);
    setMissionUpdate(null);
    setRun({
      missionId,
      planet: getCampaignMission(missionId).planet,
      worldSeed: worldSeed >>> 0,
      loadout: buildMissionLoadout(missionId, normalized, nextSave.unlockedWeapons),
      attempt: 0,
    });
    setPhase('deploying');
  }, [commitSave]);

  const beginDeployment = useCallback(() => {
    deploy(selectedMissionId, randomSeed(), selection);
  }, [deploy, selectedMissionId, selection]);

  const retryInterrupted = useCallback(() => {
    const interrupted = save.interruptedRun;
    if (!interrupted) return;
    setSelectedMissionId(interrupted.missionId);
    setSelection(interrupted.loadout);
    deploy(interrupted.missionId, interrupted.worldSeed, interrupted.loadout);
  }, [deploy, save.interruptedRun]);

  const finishMission = useCallback((result = {}) => {
    if (!run) return;
    let priorWeapons = new Set();
    const nextSave = commitSave((current) => {
      priorWeapons = new Set(current.unlockedWeapons);
      return completeCampaignMission(current, run.missionId, result);
    });
    setDebrief({
      missionId: run.missionId,
      result,
      newlyRecovered: nextSave.unlockedWeapons.filter((kind) => !priorWeapons.has(kind)),
      failed: false,
    });
    setPhase('beam-up');
  }, [commitSave, run]);

  const failMission = useCallback((result = {}) => {
    if (!run) return;
    setDebrief({
      missionId: run.missionId,
      result,
      newlyRecovered: [],
      failed: true,
      retryRun: run,
    });
    setPhase('failed');
  }, [run]);

  useEffect(() => {
    if (phase !== 'beam-up') return undefined;
    const timer = window.setTimeout(() => {
      setRun(null);
      setPhase('debrief');
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const returnToShip = useCallback(() => {
    const nextSave = commitSave((current) => abandonCampaignRun(current));
    const nextMission = firstIncompleteMission(nextSave);
    setSelectedMissionId(nextMission.id);
    setSelection(loadoutForCampaignMission(nextSave, nextMission.id));
    setRun(null);
    setDebrief(null);
    setMissionUpdate(null);
    focusShipOnMountRef.current = true;
    setPhase('ship');
  }, [commitSave]);

  const retryFailed = useCallback(() => {
    const retryRun = debrief?.retryRun;
    if (!retryRun) return;
    setDebrief(null);
    deploy(
      retryRun.missionId,
      retryRun.worldSeed,
      loadoutForCampaignMission(saveRef.current, retryRun.missionId),
    );
  }, [debrief, deploy]);

  const retryInitialization = useCallback(() => {
    setRun((current) => current ? { ...current, attempt: current.attempt + 1 } : current);
    setPhase('deploying');
  }, []);

  const missionLoadout = useMemo(() => run?.loadout || [], [run]);

  if (phase === 'debrief' && debrief) {
    return (
      <Debrief
        mission={getCampaignMission(debrief.missionId)}
        result={debrief.result}
        newlyRecovered={debrief.newlyRecovered}
        failed={debrief.failed}
        onContinue={returnToShip}
        onRetry={retryFailed}
      />
    );
  }

  if (run) {
    return (
      <main className="relative h-screen w-full overflow-hidden bg-[#080b10]">
        <SandGame
          key={`${run.missionId}-${run.worldSeed}-${run.attempt}`}
          mode="survival"
          planet={run.planet}
          mission={run.missionId}
          worldSeed={run.worldSeed}
          loadout={missionLoadout}
          onReady={() => setPhase('mission')}
          onMissionUpdate={setMissionUpdate}
          onMissionComplete={finishMission}
          onMissionFailed={failMission}
          onError={() => setPhase('deployment-error')}
        />
        {phase === 'deploying' && <DeploymentOverlay mission={mission} />}
        {phase === 'deployment-error' && (
          <DeploymentFailure
            mission={mission}
            onRetry={retryInitialization}
            onReturn={returnToShip}
          />
        )}
        {phase === 'beam-up' && <BeamUpOverlay mission={mission} />}
        {phase === 'failed' && debrief && (
          <Debrief
            mission={mission}
            result={debrief.result}
            newlyRecovered={[]}
            failed
            onContinue={returnToShip}
            onRetry={retryFailed}
          />
        )}
        {phase === 'mission' && (
          <div className="pointer-events-none absolute left-3 top-3 z-[82] flex items-center gap-2 font-mono">
            <button
              type="button"
              onClick={returnToShip}
              className={`${BUTTON} pointer-events-auto bg-[#252b31] px-3 py-2 text-white hover:text-[#f0d465]`}
            >
              ↑ Abort to {SHIP_NAME}
            </button>
            {missionUpdate?.stageLabel && (
              <span className="border-2 border-[#080a0c] bg-[#171c21]/90 px-3 py-2 text-[8px] font-black uppercase tracking-[.12em] text-[#d4d9de] shadow-[inset_0_0_0_1px_#4b555e]">
                {missionUpdate.stageLabel}
              </span>
            )}
          </div>
        )}
      </main>
    );
  }

  return (
    <ShipHub
      focusRef={shipFocusRef}
      save={save}
      mission={mission}
      selection={selection}
      onSelectMission={selectMission}
      onChangeSelection={changeSelection}
      onDeploy={beginDeployment}
      onRetryInterrupted={retryInterrupted}
    />
  );
}
