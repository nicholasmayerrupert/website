import { ITEM_KIND } from '../wasmBridge/abi.generated.js';
import { injectStyleOnce, swallowEvents } from './uiShared.js';

const STYLE = `
.survival-vitals { position:absolute; left:14px; bottom:72px; z-index:70; pointer-events:none;
  color:#fff; font:700 10px/1 ui-monospace,"SFMono-Regular",Menlo,monospace;
  text-shadow:2px 2px 0 #111; }
.survival-objective { margin:0 0 8px; padding:5px 7px; color:#f0d465; letter-spacing:.09em;
  background:rgba(23,27,32,.88); border:2px solid #090b0e;
  box-shadow:inset 0 0 0 1px #59636c,3px 3px 0 rgba(0,0,0,.35); }
.survival-vitals-label { margin:0 0 5px 2px; letter-spacing:.14em; }
.survival-health { display:grid; grid-template-columns:repeat(10,14px); gap:2px; padding:4px;
  background:#171b20; border:2px solid #090b0e; box-shadow:inset 0 0 0 2px #3d4650,4px 4px 0 rgba(0,0,0,.3); }
.survival-heart { position:relative; width:14px; height:12px; box-sizing:border-box; overflow:hidden;
  background:#3c2527; border:2px solid #261619; }
.survival-heart::before { content:''; position:absolute; inset:0 auto 0 0; width:var(--fill,0%);
  background:#d94848; box-shadow:inset 2px 2px 0 #f07868; }
.survival-charge { display:none; margin-top:7px; padding:4px; background:#171b20; border:2px solid #090b0e;
  grid-template-columns:repeat(12,10px); gap:2px; box-shadow:inset 0 0 0 2px #3d4650; }
.survival-charge.show { display:grid; }
.survival-charge > i { display:block; width:10px; height:6px; background:#303840; }
.survival-charge > i.full { background:#e9c75b; box-shadow:inset 2px 2px 0 #fff0a0; }
.survival-charge.bore > i.full { background:#43d3c9; box-shadow:inset 2px 2px 0 #c9fff5; }
.survival-fuel-label { margin:7px 0 4px 2px; color:#cdeaf7; letter-spacing:.12em; }
.survival-fuel { display:grid; padding:4px; background:#171b20; border:2px solid #090b0e;
  grid-template-columns:repeat(12,10px); gap:2px; box-shadow:inset 0 0 0 2px #3d4650; }
.survival-fuel > i { display:block; width:10px; height:6px; background:#303840; }
.survival-fuel > i.full { background:#58b9e9; box-shadow:inset 2px 2px 0 #bdeaff; }
.survival-fuel.active > i.full { background:#f0a542; box-shadow:inset 2px 2px 0 #ffe3a2; }
.survival-death { position:fixed; inset:0; z-index:76; display:none; place-items:center; pointer-events:auto;
  background:rgba(52,9,12,.55); color:#fff; font-family:ui-monospace,"SFMono-Regular",Menlo,monospace; }
.survival-death.show { display:grid; }
.survival-death-card { min-width:min(320px,calc(100vw - 48px)); padding:24px; text-align:center;
  background:#171b20; border:4px solid #090b0e; box-shadow:inset 0 0 0 3px #4b2529,8px 8px 0 rgba(0,0,0,.45); }
.survival-death-title { margin:0 0 10px; color:#f06a63; font-size:28px; letter-spacing:.08em; text-shadow:3px 3px 0 #671d26; }
.survival-death-note { min-height:22px; color:#cbd0d6; font-size:11px; letter-spacing:.08em; }
.survival-respawn { margin-top:15px; padding:10px 18px; border:3px solid #090b0e; border-radius:0;
  background:#697d45; color:#fff; box-shadow:inset 0 0 0 2px #9bab66,4px 4px 0 #090b0e;
  font:800 12px/1 ui-monospace,monospace; letter-spacing:.1em; cursor:pointer; }
.survival-respawn:disabled { background:#303840; color:#77808a; box-shadow:inset 0 0 0 2px #454e57,4px 4px 0 #090b0e; cursor:default; }
@media (max-width:640px) { .survival-vitals { left:8px; bottom:66px; transform:scale(.86); transform-origin:left bottom; } }
`;

export function createSurvivalStatus(root, { respawn } = {}) {
  injectStyleOnce(root, 'data-sand-survival-status', STYLE);
  const vitals = document.createElement('div');
  vitals.className = 'survival-vitals';
  const objective = document.createElement('div');
  objective.className = 'survival-objective';
  objective.textContent = 'OBJECTIVE  SURVIVE THE DEMOLITION CREWS';
  const label = document.createElement('div');
  label.className = 'survival-vitals-label'; label.textContent = 'HEALTH';
  const health = document.createElement('div'); health.className = 'survival-health';
  health.setAttribute('role', 'meter'); health.setAttribute('aria-label', 'Player health');
  health.setAttribute('aria-valuemin', '0'); health.setAttribute('aria-valuemax', '100');
  const hearts = Array.from({ length: 10 }, () => {
    const el = document.createElement('i'); el.className = 'survival-heart'; health.appendChild(el); return el;
  });
  const charge = document.createElement('div'); charge.className = 'survival-charge';
  const chargeCells = Array.from({ length: 12 }, () => {
    const el = document.createElement('i'); charge.appendChild(el); return el;
  });
  const fuelLabel = document.createElement('div');
  fuelLabel.className = 'survival-fuel-label'; fuelLabel.textContent = 'JETPACK  SPACE';
  const fuel = document.createElement('div'); fuel.className = 'survival-fuel';
  fuel.setAttribute('role', 'meter'); fuel.setAttribute('aria-label', 'Jetpack fuel');
  fuel.setAttribute('aria-valuemin', '0'); fuel.setAttribute('aria-valuemax', '100');
  const fuelCells = Array.from({ length: 12 }, () => {
    const el = document.createElement('i'); fuel.appendChild(el); return el;
  });
  vitals.append(objective, label, health, charge, fuelLabel, fuel);

  const death = document.createElement('div'); death.className = 'survival-death';
  const card = document.createElement('div'); card.className = 'survival-death-card';
  const title = document.createElement('h2'); title.className = 'survival-death-title'; title.textContent = 'YOU DIED';
  const note = document.createElement('div'); note.className = 'survival-death-note';
  const button = document.createElement('button'); button.type = 'button'; button.className = 'survival-respawn'; button.textContent = 'RESPAWN';
  title.id = 'sand-survival-death-title'; note.id = 'sand-survival-death-note';
  note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite'); note.setAttribute('aria-atomic', 'true');
  death.tabIndex = -1; death.setAttribute('role', 'dialog'); death.setAttribute('aria-hidden', 'true');
  death.setAttribute('aria-labelledby', title.id); death.setAttribute('aria-describedby', note.id);
  card.append(title, note, button); death.appendChild(card);
  swallowEvents(death);
  root.append(vitals, death);

  let ready = false, wasDead = false, wasReady = false, previousFocus = null;
  const request = () => { if (ready) respawn?.(); };
  button.addEventListener('click', request);
  const onKey = (event) => {
    if (!death.classList.contains('show')) return;
    if (event.key === 'Tab') {
      event.preventDefault(); event.stopImmediatePropagation();
      (ready ? button : death).focus({ preventScroll: true });
    } else if (event.code === 'Enter') {
      event.preventDefault(); event.stopImmediatePropagation(); request();
    }
  };
  window.addEventListener('keydown', onKey, true);

  const update = (player) => {
    const hp = Math.max(0, Math.min(100, player?.health ?? 100));
    for (let i = 0; i < hearts.length; i++) {
      const fill = Math.max(0, Math.min(10, hp - i * 10)) * 10;
      hearts[i].style.setProperty('--fill', `${fill}%`);
    }
    health.setAttribute('aria-valuenow', String(hp));
    label.textContent = `HEALTH  ${hp}`;
    const bow = !!player && player.alive !== false && player.heldItemKind === ITEM_KIND.BOW;
    const bore = !!player && player.alive !== false && player.heldItemKind === ITEM_KIND.BORE_CANNON;
    const level = Math.round(Math.max(0, Math.min(1, player?.bowCharge || 0)) * chargeCells.length);
    charge.classList.toggle('show', (bow || bore) && level > 0);
    charge.classList.toggle('bore', bore);
    for (let i = 0; i < chargeCells.length; i++) chargeCells[i].classList.toggle('full', i < level);
    const fuelLevel = Math.max(0, Math.min(1, player?.jetpackFuel ?? 1));
    const filledFuel = Math.ceil(fuelLevel * fuelCells.length);
    fuel.classList.toggle('active', !!player?.jetpackActive);
    fuel.setAttribute('aria-valuenow', String(Math.round(fuelLevel * 100)));
    fuelLabel.textContent = player?.jetpackActive ? 'JETPACK  FIRING' : 'JETPACK  SPACE';
    for (let i = 0; i < fuelCells.length; i++) fuelCells[i].classList.toggle('full', i < filledFuel);

    const dead = !!player && player.alive === false;
    ready = dead && !!player.respawnReady;
    death.classList.toggle('show', dead);
    death.setAttribute('aria-hidden', String(!dead));
    if (dead) death.setAttribute('aria-modal', 'true');
    else death.removeAttribute('aria-modal');
    button.disabled = !ready;
    if (dead) {
      const remaining = Math.max(0, Math.ceil((180 - (player.deathTicks || 0)) / 60));
      const message = ready ? 'PRESS ENTER OR CLICK BELOW' : `RESPAWN AVAILABLE IN ${remaining}`;
      if (note.textContent !== message) note.textContent = message;
      if (!wasDead) {
        previousFocus = root.activeElement || document.activeElement;
        death.focus({ preventScroll: true });
      } else if (ready && !wasReady) button.focus({ preventScroll: true });
    } else if (wasDead) {
      if (previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true });
      previousFocus = null;
    }
    wasDead = dead; wasReady = ready;
  };

  return {
    update,
    destroy() { window.removeEventListener('keydown', onKey, true); vitals.remove(); death.remove(); },
  };
}
