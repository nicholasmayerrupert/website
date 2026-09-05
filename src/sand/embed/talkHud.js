import {
  CREATURE,
  PLANET,
  PLANET_GAMEPLAY_FLAG,
  planetHasGameplayFlag,
} from '../wasmBridge/abi.generated.js';

const TALKABLES = Object.freeze({
  [CREATURE.SURVEYOR]: {
    name: 'IRIS Surveyor',
    dialogue: 'Hold the rescue beam (3) on me.',
    shipDialogue: 'Three researchers are trapped at Greenfall Relay.',
  },
  [CREATURE.IRIS_COMMANDER]: {
    name: 'Commander Vale',
    dialogue: 'Earth: extract three researchers from Greenfall Relay.',
    action: 'Earth mission',
  },
  [CREATURE.IRIS_ENGINEER]: {
    name: 'Engineer Osei',
    dialogue: 'Hold F to block; release to fire. Hold Space to thrust.',
  },
});

export function recoveryBeamIsActive(
  planetId,
  playerWorldY,
  hasGameplayFlag = planetHasGameplayFlag,
) {
  return (
    Number.isFinite(playerWorldY) &&
    playerWorldY > 48 &&
    hasGameplayFlag(planetId, PLANET_GAMEPLAY_FLAG.VOID_RECOVERY)
  );
}

const STYLE = `
.sg-talk-layer { position:absolute; inset:0; z-index:78; overflow:hidden; pointer-events:none;
  font-family:'Sand Pixel',monospace; }
.sg-talk-button { position:absolute; left:0; top:0; pointer-events:auto; transform:translate(-50%,-100%);
  min-width:46px; border:2px solid #080a0c; padding:5px 8px; cursor:pointer; background:#f0d465; color:#17140a;
  box-shadow:inset 0 0 0 1px #fff1a0,3px 3px 0 #080a0c; font:900 8px/1 inherit;
  letter-spacing:.16em; text-transform:uppercase; white-space:nowrap; }
.sg-talk-button::after { content:""; position:absolute; left:50%; bottom:-7px; width:8px; height:8px;
  border-right:2px solid #080a0c; border-bottom:2px solid #080a0c; background:#f0d465;
  transform:translateX(-50%) rotate(45deg); }
.sg-talk-button:hover, .sg-talk-button:focus-visible { background:#fff1a0; outline:2px solid #fff; outline-offset:2px; }
.sg-quest-marker { position:absolute; left:0; top:0; display:grid; justify-items:center; min-width:9px;
  color:#f0d465; filter:drop-shadow(2px 2px 0 #080a0c); will-change:transform; }
.sg-quest-marker[hidden] { display:none; }
.sg-quest-marker-icon { width:0; height:0; border-top:5px solid transparent; border-bottom:5px solid transparent;
  border-left:9px solid currentColor; transform-origin:center; }
.sg-quest-marker.onscreen .sg-quest-marker-icon { width:9px; height:9px; box-sizing:border-box;
  border:2px solid currentColor; background:rgba(240,212,101,.2); transform:rotate(45deg)!important; }
.sg-place-sign { position:absolute; transform:translate(-50%,-50%); color:#d8e5cf; opacity:.72; white-space:nowrap; font:10px/1.2 ui-monospace,monospace; letter-spacing:.14em; text-shadow:0 1px 3px #000; }
.sg-place-sign[hidden] { display:none; }
.sg-dialogue { position:absolute; left:50%; bottom:58px; z-index:79; width:min(560px,calc(100% - 24px));
  box-sizing:border-box; transform:translateX(-50%); border:3px solid #080a0c; padding:14px;
  pointer-events:auto; background:rgba(17,23,29,.97); color:#fff;
  box-shadow:inset 0 0 0 2px #4b555e,6px 6px 0 rgba(0,0,0,.55); }
.sg-dialogue[hidden] { display:none; }
.sg-dialogue-name { margin:-10px -10px 12px; padding:8px 10px; background:#71312f; color:#fff; font-size:18px; line-height:1; }
.sg-dialogue-copy { margin:9px 0 0; color:#d4d9de; font-size:17px; line-height:1.4; }
.sg-dialogue-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
.sg-dialogue-actions button { border:2px solid #080a0c; padding:8px 11px; cursor:pointer;
  background:#252b31; color:#fff; box-shadow:inset 0 0 0 1px #59636c,3px 3px 0 #080a0c;
  font:16px/1 'Sand Pixel',monospace; }
.sg-dialogue-actions .primary { background:#4c7131; color:#fff; box-shadow:inset 1px 1px #94b35d,inset -1px -1px #293e1a; }
.sg-ship-recovery-beam { position:absolute; left:0; top:0; width:42px; height:150px; opacity:0;
  transform:translate(-50%,-44%); background:linear-gradient(90deg,transparent,rgba(91,241,255,.38),#f6ffff,rgba(91,241,255,.38),transparent);
  filter:drop-shadow(0 0 12px #62ecff); transition:opacity .16s ease; }
.sg-ship-recovery-beam.on { opacity:.92; animation:sg-recovery-pulse .58s ease-in-out infinite alternate; }
@keyframes sg-recovery-pulse {
  from { width:28px; filter:drop-shadow(0 0 8px #62ecff); }
  to { width:52px; filter:drop-shadow(0 0 22px #62ecff); }
}
@media (max-width:640px) {
  .sg-dialogue { bottom:122px; padding:12px; }
  .sg-dialogue-copy { font-size:10px; }
}
`;

export function createTalkHud(root, game, onAction) {
  const style = document.createElement('style');
  style.dataset.sandTalkStyle = '';
  style.textContent = STYLE;
  const layer = document.createElement('div');
  layer.className = 'sg-talk-layer';
  const recoveryBeam = document.createElement('div');
  recoveryBeam.className = 'sg-ship-recovery-beam';
  layer.appendChild(recoveryBeam);
  const questMarker = document.createElement('div');
  questMarker.className = 'sg-quest-marker';
  questMarker.hidden = true;
  questMarker.setAttribute('role', 'img');
  questMarker.setAttribute('aria-label', 'Mission coordinator Commander Vale');
  const questMarkerIcon = document.createElement('span');
  questMarkerIcon.className = 'sg-quest-marker-icon';
  questMarker.appendChild(questMarkerIcon);
  layer.appendChild(questMarker);

  const dialogue = document.createElement('section');
  dialogue.className = 'sg-dialogue';
  dialogue.hidden = true;
  dialogue.setAttribute('role', 'dialog');
  dialogue.setAttribute('aria-label', 'Conversation');
  const name = document.createElement('div');
  name.className = 'sg-dialogue-name';
  const copy = document.createElement('p');
  copy.className = 'sg-dialogue-copy';
  const actions = document.createElement('div');
  actions.className = 'sg-dialogue-actions';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'primary';
  actions.append(close, primary);
  dialogue.append(name, copy, actions);
  layer.appendChild(dialogue);

  const signs = game.getPlanetState?.().id === PLANET.FRONTIER ? [
    [-116, -55, 'OBSERVATION'], [104, -55, 'CREW QUARTERS'],
    [-150, -18, 'COMMAND / FIELD OPERATIONS'], [182, -18, 'WORKSHOP / STORES'],
    [-145, 30, 'MEDBAY'], [154, 30, 'HYDROPONICS'],
    [-144, 83, 'RESEARCH ARCHIVE'], [158, 83, 'TOOL RANGE'],
    [-142, 133, 'ENGINEERING'], [133, 133, 'POWER / COOLANT'],
    [-248, 165, '← CAVE ACCESS'],
  ].map(([x, y, label]) => {
    const node = document.createElement('span');
    node.className = 'sg-place-sign'; node.textContent = label;
    layer.appendChild(node); return { x, y, node };
  }) : [];
  const buttons = new Map();
  let activeActor = null;
  let nearestActor = null;
  let actors = [];
  let lastActorRead = -Infinity;
  let raf = 0;

  const closeDialogue = (restoreFocus = true) => {
    dialogue.hidden = true;
    activeActor = null;
    if (restoreFocus)
      root.querySelector('.sg-sim')?.focus({ preventScroll: true });
  };
  close.addEventListener('click', () => closeDialogue());
  primary.addEventListener('click', () => {
    if (!activeActor) return;
    onAction?.({ action: activeActor.species === CREATURE.IRIS_ENGINEER ? 'repair-base' : 'mission-console', actor: activeActor });
    closeDialogue(false);
  });

  const openDialogue = (actor) => {
    let policy = TALKABLES[actor.species];
    if (!policy) return;
    if (game.getPlanetState?.().id === PLANET.FRONTIER) {
      if (actor.species === CREATURE.IRIS_COMMANDER) policy = { ...policy, dialogue: 'Welcome to Aster. The railway is buried, the archive is underwater, and Windward is above the clouds. Pick a direction. Make your own way there.', action: 'Field journal' };
      if (actor.species === CREATURE.IRIS_ENGINEER) policy = { ...policy, dialogue: 'This whole station can be rebuilt. Try your tools, move a wall, make a mess. Come back to me when you want the original plans restored.', action: 'Repair the station' };
      if (actor.species === CREATURE.SURVEYOR) policy = { ...policy, dialogue: 'There is a dry cavern under the flooded archive. If you can give that water somewhere to go, the records might still be recoverable.' };
    }
    activeActor = actor;
    name.textContent = policy.name;
    copy.textContent =
      game.getPlanetState?.().id === PLANET.SHIP
        ? policy.shipDialogue || policy.dialogue
        : actor.shelterCharge > 0 ? 'The jammer has us locked in. Shut it down.' : policy.dialogue;
    primary.hidden = !policy.action;
    primary.textContent = policy.action || '';
    dialogue.hidden = false;
    (policy.action ? primary : close).focus({ preventScroll: true });
  };

  const sync = (now) => {
    raf = requestAnimationFrame(sync);
    const view = game.getMissionView?.();
    if (now - lastActorRead >= 100) {
      actors = game.getTalkableActors?.() || [];
      lastActorRead = now;
    }
    const width = root.host?.clientWidth || 0;
    const height = root.host?.clientHeight || 0;
    if (!view || !width || !height || !view.viewCols || !view.viewRows) return;

    for (const sign of signs) {
      const x = (sign.x - view.cameraWorldX) / view.viewCols * width;
      const y = (sign.y - view.cameraWorldY) / view.viewRows * height;
      sign.node.hidden = x < 50 || x > width - 50 || y < 80 || y > height - 80;
      sign.node.style.left = `${x}px`; sign.node.style.top = `${y}px`;
    }
    const activeIds = new Set();
    nearestActor = null;
    let nearestDistance = Infinity;
    for (const actor of actors) {
      const rawX = ((actor.worldX - view.cameraWorldX) / view.viewCols) * width;
      const rawY =
        ((actor.worldY - view.cameraWorldY) / view.viewRows) * height;
      const distance = Number.isFinite(view.playerWorldX)
        ? Math.hypot(
            actor.worldX - view.playerWorldX,
            actor.worldY - view.playerWorldY,
          )
        : Infinity;
      const visible =
        actor.alive &&
        distance <= 28 &&
        rawX >= 24 &&
        rawX <= width - 24 &&
        rawY >= 30 &&
        rawY <= height - 24;
      if (!visible) continue;
      if (distance < nearestDistance) {
        nearestActor = actor;
        nearestDistance = distance;
      }
      activeIds.add(actor.id);
      let button = buttons.get(actor.id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'sg-talk-button';
        button.textContent = 'Talk';
        button.setAttribute(
          'aria-label',
          `Talk to ${TALKABLES[actor.species].name}`,
        );
        button.addEventListener('click', () => openDialogue(actor));
        layer.appendChild(button);
        buttons.set(actor.id, button);
      }
      button.style.transform = `translate(${Math.round(rawX)}px,${Math.round(rawY - 8)}px) translate(-50%,-100%)`;
    }
    for (const [id, button] of buttons) {
      button.hidden = id !== nearestActor?.id;
      button.textContent = id === nearestActor?.id ? 'T · Talk' : 'Talk';
      if (activeIds.has(id)) continue;
      button.remove();
      buttons.delete(id);
      if (activeActor?.id === id) closeDialogue();
    }

    const commander = actors.find(
      ({ species, alive }) => species === CREATURE.IRIS_COMMANDER && alive,
    );
    if (!commander) {
      questMarker.hidden = true;
    } else {
      const rawX =
        ((commander.worldX - view.cameraWorldX) / view.viewCols) * width;
      const rawY =
        ((commander.worldY - view.cameraWorldY) / view.viewRows) * height;
      const distance = Number.isFinite(view.playerWorldX)
        ? Math.hypot(
            commander.worldX - view.playerWorldX,
            commander.worldY - view.playerWorldY,
          )
        : Infinity;
      const talkVisible =
        distance <= 28 &&
        rawX >= 24 &&
        rawX <= width - 24 &&
        rawY >= 30 &&
        rawY <= height - 24;
      questMarker.hidden = talkVisible;
      if (!talkVisible) {
        const x = Math.max(26, Math.min(width - 26, rawX));
        const y = Math.max(54, Math.min(height - 64, rawY));
        const onscreen =
          rawX >= 26 && rawX <= width - 26 && rawY >= 54 && rawY <= height - 64;
        const angle = Math.atan2(rawY - height * 0.5, rawX - width * 0.5);
        questMarker.classList.toggle('onscreen', onscreen);
        questMarker.style.transform = `translate(${Math.round(x)}px,${Math.round(y - 12)}px) translate(-50%,-100%)`;
        questMarkerIcon.style.transform = `rotate(${angle}rad)`;
      }
    }

    const recovering = recoveryBeamIsActive(
      game.getPlanetState?.().id,
      view.playerWorldY,
    );
    const playerX =
      ((view.playerWorldX - view.cameraWorldX) / view.viewCols) * width;
    const playerY =
      ((view.playerWorldY - view.cameraWorldY) / view.viewRows) * height;
    recoveryBeam.classList.toggle('on', recovering);
    if (recovering) {
      recoveryBeam.style.transform = `translate(${Math.round(playerX)}px,${Math.round(playerY)}px) translate(-50%,-44%)`;
    }
  };

  const onKey = (event) => {
    if (event.repeat) return;
    if (!dialogue.hidden && (event.key === 'Escape' || event.code === 'KeyT')) {
      event.preventDefault();
      event.stopPropagation();
      closeDialogue();
    } else if (
      event.code === 'KeyT' &&
      nearestActor &&
      root.activeElement?.classList.contains('sg-sim')
    ) {
      event.preventDefault();
      event.stopPropagation();
      openDialogue(nearestActor);
    }
  };
  root.addEventListener('keydown', onKey, true);
  root.append(style, layer);
  raf = requestAnimationFrame(sync);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      root.removeEventListener('keydown', onKey, true);
      layer.remove();
      style.remove();
    },
  };
}
