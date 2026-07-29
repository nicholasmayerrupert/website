import { ITEM_KIND } from '../wasmBridge/abi.generated.js';
import { injectStyleOnce, swallowEvents } from './uiShared.js';

const STYLE = `
.survival-vitals { position:absolute; left:50%; bottom:118px; z-index:70; width:min(724px,calc(100vw - 32px));
  transform:translateX(-50%); pointer-events:none; color:#fff;
  font:800 10px/1 ui-monospace,"SFMono-Regular",Menlo,monospace;
  text-shadow:2px 2px 0 #090b0e; }
.survival-objective { position:relative; width:max-content; max-width:calc(100% - 64px); margin:0 auto 7px;
  display:flex; align-items:center; justify-content:center; gap:9px; box-sizing:border-box; padding:7px 13px 7px 10px;
  color:#e4e8eb; letter-spacing:.08em; background:rgba(23,27,32,.94); border:2px solid #090b0e;
  box-shadow:inset 0 0 0 1px #59636c,4px 4px 0 rgba(0,0,0,.42); }
.survival-objective::before,.survival-objective::after { content:''; position:absolute; top:50%; width:24px; height:2px;
  background:#d6b94e; box-shadow:0 4px 0 #090b0e; }
.survival-objective::before { right:100%; }.survival-objective::after { left:100%; }
.survival-objective-kicker { margin:-7px 0 -7px -10px; padding:7px 9px; color:#17140a;
  background:#f0d465; text-shadow:none; letter-spacing:.13em; }
.survival-objective-copy { white-space:nowrap; }
.survival-stats { display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; padding:6px;
  background:rgba(13,16,19,.92); border:3px solid #080a0c;
  box-shadow:inset 0 0 0 2px #49525b,6px 6px 0 rgba(0,0,0,.42); }
.survival-stat { position:relative; min-width:0; padding:8px 9px 7px; overflow:hidden;
  background:linear-gradient(#252b31,#171b20); border:2px solid #0b0d10;
  box-shadow:inset 2px 2px 0 #3f4851,inset -2px -2px 0 #111418; }
.survival-stat::after { content:''; position:absolute; left:8px; right:8px; bottom:3px; height:1px;
  background:rgba(255,255,255,.08); }
.survival-stat-head { display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:17px; margin-bottom:5px;
  color:#b9c1c8; font-size:9px; letter-spacing:.14em; }
.survival-stat-name { display:flex; align-items:center; gap:6px; white-space:nowrap; }
.survival-stat-emblem { position:relative; display:block; width:12px; height:12px; flex:none; background:currentColor; }
.survival-stat-emblem.heart { color:#ed5d59;
  clip-path:polygon(0 17%,17% 17%,17% 0,42% 0,42% 17%,58% 17%,58% 0,83% 0,83% 17%,100% 17%,100% 58%,83% 58%,83% 75%,67% 75%,67% 92%,58% 92%,58% 100%,42% 100%,42% 92%,33% 92%,33% 75%,17% 75%,17% 58%,0 58%); }
.survival-stat-emblem.shield { color:#70d9f5;
  clip-path:polygon(8% 0,92% 0,92% 10%,100% 10%,100% 52%,92% 52%,92% 68%,75% 68%,75% 84%,58% 84%,58% 100%,42% 100%,42% 84%,25% 84%,25% 68%,8% 68%,8% 52%,0 52%,0 10%,8% 10%); }
.survival-stat-emblem.bolt { color:#f4c653;
  clip-path:polygon(42% 0,92% 0,92% 17%,75% 17%,75% 33%,100% 33%,100% 50%,83% 50%,83% 67%,67% 67%,67% 83%,50% 83%,50% 100%,8% 100%,8% 83%,25% 83%,25% 67%,0 67%,0 50%,17% 50%,17% 33%,25% 33%,25% 17%,42% 17%); }
.survival-stat-value { color:#fff; font-size:12px; letter-spacing:.04em; }
.survival-stat-key { display:inline-grid; place-items:center; min-width:16px; height:14px; padding:0 3px; margin-left:4px;
  box-sizing:border-box; border:1px solid #68737d; background:#101317; color:#d7dde2;
  box-shadow:1px 1px 0 #050607; font-family:inherit; font-size:8px; font-weight:800; line-height:1;
  letter-spacing:.04em; text-shadow:none; }
.survival-shield-label.active { color:#bcefff; }
.survival-health,.survival-shield,.survival-fuel { display:grid; width:max-content; max-width:100%; box-sizing:border-box;
  align-items:center; justify-content:center; margin:auto; padding:4px; background:#101317; border:2px solid #080a0c; }
.survival-health { grid-template-columns:repeat(10,18px); gap:2px; box-shadow:inset 0 0 0 1px #49272b; }
.survival-heart { position:relative; display:block; width:18px; height:17px; overflow:hidden; background:#49262a;
  clip-path:polygon(0 18%,11% 18%,11% 6%,22% 6%,22% 0,39% 0,39% 6%,50% 6%,50% 18%,61% 18%,61% 6%,78% 6%,78% 0,89% 0,89% 6%,100% 6%,100% 53%,89% 53%,89% 65%,78% 65%,78% 76%,67% 76%,67% 88%,56% 88%,56% 100%,44% 100%,44% 88%,33% 88%,33% 76%,22% 76%,22% 65%,11% 65%,11% 53%,0 53%); }
.survival-heart::before { content:''; position:absolute; inset:auto 0 0; height:var(--fill,0%);
  background:#da4549; box-shadow:inset 3px 3px 0 #ff7b68,inset -2px -2px 0 #962d38; }
.survival-heart::after { content:''; position:absolute; left:4px; top:3px; width:3px; height:3px; background:rgba(255,224,207,.55); }
.survival-health.low { box-shadow:inset 0 0 0 1px #9d3038,0 0 10px rgba(220,55,61,.35); }
.survival-shield { grid-template-columns:repeat(10,18px); gap:2px; box-shadow:inset 0 0 0 1px #264a59; }
.survival-shield > i { position:relative; display:block; width:18px; height:19px; overflow:hidden; background:#293b44;
  clip-path:polygon(6% 0,94% 0,94% 8%,100% 8%,100% 50%,94% 50%,94% 66%,78% 66%,78% 82%,61% 82%,61% 100%,39% 100%,39% 82%,22% 82%,22% 66%,6% 66%,6% 50%,0 50%,0 8%,6% 8%); }
.survival-shield > i::before { content:''; position:absolute; inset:auto 0 0; height:var(--fill,0%);
  background:#3fa9cc; box-shadow:inset 3px 3px 0 #a2ebff,inset -2px -2px 0 #28728d; }
.survival-shield > i::after { content:''; position:absolute; left:4px; top:3px; width:7px; height:2px; background:rgba(220,249,255,.5); }
.survival-shield.active { box-shadow:inset 0 0 0 1px #8de9ff,0 0 12px rgba(89,213,255,.58); }
.survival-shield.active > i::before { background:#65d9f4; box-shadow:inset 3px 3px 0 #e1fbff,inset -2px -2px 0 #3598b8; }
.survival-shield.depleted > i { background:#352d3b; }
.survival-fuel { grid-template-columns:repeat(12,11px); gap:2px; box-shadow:inset 0 0 0 1px #4a4126; }
.survival-fuel > i { position:relative; display:block; width:11px; height:19px; overflow:hidden; background:#3d392d;
  clip-path:polygon(36% 0,100% 0,100% 16%,82% 16%,82% 32%,64% 32%,64% 42%,100% 42%,100% 58%,82% 58%,82% 68%,64% 68%,64% 84%,45% 84%,45% 100%,0 100%,0 84%,18% 84%,18% 68%,36% 68%,36% 58%,0 58%,0 42%,18% 42%,18% 32%,36% 32%); }
.survival-fuel > i::before { content:''; position:absolute; inset:auto 0 0; height:0; background:#e8b53e;
  box-shadow:inset 2px 2px 0 #ffe99c,inset -2px -2px 0 #a77223; }
.survival-fuel > i.full::before { height:100%; }
.survival-fuel.active { box-shadow:inset 0 0 0 1px #ffc65a,0 0 11px rgba(244,161,56,.42); }
.survival-fuel.active > i.full::before { background:#f19439; box-shadow:inset 2px 2px 0 #ffe3a2,inset -2px -2px 0 #b35b22; }
.survival-fuel.low { box-shadow:inset 0 0 0 1px #b56a31,0 0 9px rgba(232,154,56,.25); }
.survival-charge { display:none; position:absolute; left:50%; bottom:calc(100% + 7px); width:max-content; box-sizing:border-box;
  padding:4px; transform:translateX(-50%); grid-template-columns:repeat(12,10px); gap:2px; background:#101317;
  border:2px solid #090b0e; box-shadow:inset 0 0 0 1px #51482b,4px 4px 0 rgba(0,0,0,.38); }
.survival-charge::after { content:'WEAPON CHARGE'; position:absolute; right:100%; top:50%; padding-right:8px;
  transform:translateY(-50%); color:#e9c75b; white-space:nowrap; font-size:8px; letter-spacing:.1em; }
.survival-charge.show { display:grid; }
.survival-charge > i { display:block; width:10px; height:7px; background:#303840;
  clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%); }
.survival-charge > i.full { background:#e9c75b; filter:drop-shadow(0 0 2px #fff0a0); }
.survival-charge.bore > i.full { background:#43d3c9; filter:drop-shadow(0 0 2px #c9fff5); }
.survival-death { position:fixed; inset:0; z-index:76; display:none; place-items:center; pointer-events:auto;
  background:radial-gradient(circle,rgba(52,9,12,.38),rgba(18,3,5,.82)); color:#fff;
  font-family:ui-monospace,"SFMono-Regular",Menlo,monospace; backdrop-filter:blur(2px); }
.survival-death.show { display:grid; }
.survival-death-card { position:relative; min-width:min(340px,calc(100vw - 48px)); padding:30px 28px 26px; text-align:center;
  background:linear-gradient(#282126,#171519); border:4px solid #090b0e;
  box-shadow:inset 0 0 0 3px #583038,10px 10px 0 rgba(0,0,0,.55); }
.survival-death-card::before { content:'MISSION FAILED'; display:block; margin-bottom:9px; color:#b88080;
  font-size:9px; font-weight:800; letter-spacing:.22em; }
.survival-death-title { margin:0 0 10px; color:#f06a63; font-size:28px; letter-spacing:.08em; text-shadow:3px 3px 0 #671d26; }
.survival-death-note { min-height:22px; color:#cbd0d6; font-size:11px; letter-spacing:.08em; }
.survival-respawn { margin-top:15px; padding:10px 18px; border:3px solid #090b0e; border-radius:0;
  background:#697d45; color:#fff; box-shadow:inset 0 0 0 2px #9bab66,4px 4px 0 #090b0e;
  font:800 12px/1 ui-monospace,monospace; letter-spacing:.1em; cursor:pointer; }
.survival-respawn:hover:not(:disabled) { background:#829b52; transform:translate(-1px,-1px); box-shadow:inset 0 0 0 2px #b8ca79,5px 5px 0 #090b0e; }
.survival-respawn:disabled { background:#303840; color:#77808a; box-shadow:inset 0 0 0 2px #454e57,4px 4px 0 #090b0e; cursor:default; }
@media (prefers-reduced-motion:no-preference) {
  .survival-health.low,.survival-fuel.low { animation:survival-warning 1.1s steps(2,end) infinite; }
  @keyframes survival-warning { 50% { filter:brightness(1.25); } }
}
@media (max-width:760px) {
  .survival-vitals { bottom:94px; width:calc(100vw - 16px); transform:translateX(-50%) scale(.82); transform-origin:center bottom; }
}
`;

export function createSurvivalStatus(root, { respawn } = {}) {
  injectStyleOnce(root, 'data-sand-survival-status', STYLE);
  const vitals = document.createElement('div');
  vitals.className = 'survival-vitals';
  const objective = document.createElement('div');
  objective.className = 'survival-objective';
  const objectiveKicker = document.createElement('span');
  objectiveKicker.className = 'survival-objective-kicker';
  objectiveKicker.textContent = 'MISSION';
  const objectiveCopy = document.createElement('span');
  objectiveCopy.className = 'survival-objective-copy';
  objectiveCopy.textContent = 'SURVIVE THE DEMOLITION CREWS';
  objective.append(objectiveKicker, objectiveCopy);
  const stats = document.createElement('div');
  stats.className = 'survival-stats';
  const makeStat = (tone, labelClass, icon, name, key) => {
    const stat = document.createElement('section');
    stat.className = `survival-stat ${tone}`;
    const head = document.createElement('div');
    head.className = 'survival-stat-head';
    const label = document.createElement('div');
    label.className = `${labelClass} survival-stat-name`;
    const emblem = document.createElement('i');
    emblem.className = `survival-stat-emblem ${icon}`;
    emblem.setAttribute('aria-hidden', 'true');
    const nameText = document.createElement('span');
    nameText.textContent = name;
    if (key) {
      const keycap = document.createElement('kbd');
      keycap.className = 'survival-stat-key';
      keycap.textContent = key;
      label.append(emblem, nameText, keycap);
    } else {
      label.append(emblem, nameText);
    }
    const value = document.createElement('strong');
    value.className = 'survival-stat-value';
    head.append(label, value);
    stat.appendChild(head);
    return { stat, label, value };
  };
  const healthStat = makeStat('health', 'survival-vitals-label', 'heart', 'HEALTH');
  const shieldStat = makeStat('ward', 'survival-shield-label', 'shield', 'WARD', 'F');
  const fuelStat = makeStat('fuel', 'survival-fuel-label', 'bolt', 'JETPACK', 'SPACE');
  const health = document.createElement('div'); health.className = 'survival-health';
  health.setAttribute('role', 'meter'); health.setAttribute('aria-label', 'Player health');
  health.setAttribute('aria-valuemin', '0'); health.setAttribute('aria-valuemax', '100');
  const hearts = Array.from({ length: 10 }, () => {
    const el = document.createElement('i'); el.className = 'survival-heart'; health.appendChild(el); return el;
  });
  const shieldLabel = shieldStat.label;
  const shield = document.createElement('div'); shield.className = 'survival-shield';
  shield.setAttribute('role', 'meter'); shield.setAttribute('aria-label', 'Ward shield health');
  shield.setAttribute('aria-valuemin', '0'); shield.setAttribute('aria-valuemax', '200');
  const shieldCells = Array.from({ length: 10 }, () => {
    const el = document.createElement('i'); shield.appendChild(el); return el;
  });
  const charge = document.createElement('div'); charge.className = 'survival-charge';
  const chargeCells = Array.from({ length: 12 }, () => {
    const el = document.createElement('i'); charge.appendChild(el); return el;
  });
  const fuelLabel = fuelStat.label;
  const fuel = document.createElement('div'); fuel.className = 'survival-fuel';
  fuel.setAttribute('role', 'meter'); fuel.setAttribute('aria-label', 'Jetpack fuel');
  fuel.setAttribute('aria-valuemin', '0'); fuel.setAttribute('aria-valuemax', '100');
  const fuelCells = Array.from({ length: 12 }, () => {
    const el = document.createElement('i'); fuel.appendChild(el); return el;
  });
  healthStat.stat.append(health);
  healthStat.value.textContent = '100';
  shieldStat.stat.append(shield);
  fuelStat.stat.append(fuel);
  stats.append(healthStat.stat, shieldStat.stat, fuelStat.stat);
  vitals.append(objective, stats, charge);

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
    health.classList.toggle('low', hp <= 30);
    healthStat.value.textContent = String(hp);
    const shieldHealth = Math.max(0, Math.min(200, player?.shieldHealth ?? 200));
    const shieldActive = !!player && player.alive !== false && !!player.shieldActive && shieldHealth > 0;
    for (let i = 0; i < shieldCells.length; i++) {
      const fill = Math.max(0, Math.min(20, shieldHealth - i * 20)) * 5;
      shieldCells[i].style.setProperty('--fill', `${fill}%`);
    }
    shield.classList.toggle('active', shieldActive);
    shield.classList.toggle('depleted', shieldHealth <= 0);
    shield.setAttribute('aria-valuenow', String(shieldHealth));
    shield.setAttribute('aria-valuetext', `${shieldHealth} of 200, ${shieldActive ? 'active' : 'inactive'}`);
    shieldStat.value.textContent = String(shieldHealth);
    shieldLabel.classList.toggle('active', shieldActive);
    shieldLabel.querySelector('span').textContent = shieldActive ? 'WARD ACTIVE' : 'WARD · HOLD ';
    const bow = !!player && player.alive !== false && player.heldItemKind === ITEM_KIND.BOW;
    const bore = !!player && player.alive !== false && player.heldItemKind === ITEM_KIND.BORE_CANNON;
    const level = Math.round(Math.max(0, Math.min(1, player?.bowCharge || 0)) * chargeCells.length);
    charge.classList.toggle('show', (bow || bore) && level > 0);
    charge.classList.toggle('bore', bore);
    for (let i = 0; i < chargeCells.length; i++) chargeCells[i].classList.toggle('full', i < level);
    const fuelLevel = Math.max(0, Math.min(1, player?.jetpackFuel ?? 1));
    const filledFuel = Math.ceil(fuelLevel * fuelCells.length);
    fuel.classList.toggle('active', !!player?.jetpackActive);
    fuel.classList.toggle('low', fuelLevel <= .25);
    fuel.setAttribute('aria-valuenow', String(Math.round(fuelLevel * 100)));
    fuelStat.value.textContent = `${Math.round(fuelLevel * 100)}%`;
    fuelLabel.querySelector('span').textContent = player?.jetpackActive ? 'THRUST' : 'JETPACK · ';
    for (let i = 0; i < fuelCells.length; i++) fuelCells[i].classList.toggle('full', i < filledFuel);

    const dead = !!player && player.alive === false;
    ready = dead && !!player.respawnReady;
    death.classList.toggle('show', dead);
    death.setAttribute('aria-hidden', String(!dead));
    if (dead) death.setAttribute('aria-modal', 'true');
    else death.removeAttribute('aria-modal');
    button.disabled = !ready;
    if (dead) {
      const message = ready ? 'PRESS ENTER OR CLICK BELOW' : 'RETURNING TO SPAWN';
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
