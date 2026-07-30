import { CREATURE, PLANET } from '../wasmBridge/abi.generated.js';

const TALKABLES = Object.freeze({
  [CREATURE.SURVEYOR]: {
    name: 'IRIS Surveyor',
    dialogue: 'The structure is stable enough to shelter in, but the surrounding terrain is not. Stay inside the marked rooms when the ground starts moving.',
  },
  [CREATURE.IRIS_COMMANDER]: {
    name: 'Commander Vale',
    dialogue: 'Agent, I have three live operation files ready for review. We can select your destination and field loadout when you are ready.',
    action: 'Review missions',
  },
  [CREATURE.IRIS_ENGINEER]: {
    name: 'Engineer Osei',
    dialogue: 'I keep the transporter, armory, and hull systems running. The central deck is clear—nothing aboard should obstruct your movement.',
  },
});

const STYLE = `
.sg-talk-layer { position:absolute; inset:0; z-index:78; overflow:hidden; pointer-events:none;
  font-family:ui-monospace,"SFMono-Regular","Cascadia Mono","Roboto Mono","Courier New",monospace; }
.sg-talk-button { position:absolute; left:0; top:0; pointer-events:auto; transform:translate(-50%,-100%);
  min-width:46px; border:2px solid #080a0c; padding:5px 8px; cursor:pointer; background:#f0d465; color:#17140a;
  box-shadow:inset 0 0 0 1px #fff1a0,3px 3px 0 #080a0c; font:900 8px/1 inherit;
  letter-spacing:.16em; text-transform:uppercase; white-space:nowrap; }
.sg-talk-button::after { content:""; position:absolute; left:50%; bottom:-7px; width:8px; height:8px;
  border-right:2px solid #080a0c; border-bottom:2px solid #080a0c; background:#f0d465;
  transform:translateX(-50%) rotate(45deg); }
.sg-talk-button:hover, .sg-talk-button:focus-visible { background:#fff1a0; outline:2px solid #fff; outline-offset:2px; }
.sg-quest-marker { position:absolute; left:0; top:0; display:grid; justify-items:center; min-width:68px;
  color:#f0d465; filter:drop-shadow(2px 2px 0 #080a0c); will-change:transform; }
.sg-quest-marker[hidden] { display:none; }
.sg-quest-marker-icon { width:0; height:0; border-top:6px solid transparent; border-bottom:6px solid transparent;
  border-left:10px solid currentColor; transform-origin:center; }
.sg-quest-marker-label { margin-top:4px; padding:3px 5px; background:rgba(8,10,12,.84);
  font:900 8px/1 inherit; letter-spacing:.12em; white-space:nowrap; }
.sg-quest-marker.onscreen .sg-quest-marker-icon { display:grid; place-items:center; width:16px; height:16px;
  box-sizing:border-box; border:2px solid currentColor; background:#342f18; transform:rotate(45deg)!important; }
.sg-quest-marker.onscreen .sg-quest-marker-icon::before { content:"!"; color:#fff1a0;
  font:900 10px/1 inherit; transform:rotate(-45deg); }
.sg-dialogue { position:absolute; left:50%; bottom:58px; z-index:79; width:min(560px,calc(100% - 24px));
  box-sizing:border-box; transform:translateX(-50%); border:3px solid #080a0c; padding:14px;
  pointer-events:auto; background:rgba(17,23,29,.97); color:#fff;
  box-shadow:inset 0 0 0 2px #4b555e,6px 6px 0 rgba(0,0,0,.55); }
.sg-dialogue[hidden] { display:none; }
.sg-dialogue-name { color:#f0d465; font-size:9px; line-height:1; font-weight:900; letter-spacing:.18em; text-transform:uppercase; }
.sg-dialogue-copy { margin:9px 0 0; color:#d4d9de; font-size:11px; line-height:1.65; }
.sg-dialogue-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
.sg-dialogue-actions button { border:2px solid #080a0c; padding:8px 11px; cursor:pointer;
  background:#252b31; color:#fff; box-shadow:inset 0 0 0 1px #59636c,3px 3px 0 #080a0c;
  font:900 8px/1 inherit; letter-spacing:.12em; text-transform:uppercase; }
.sg-dialogue-actions .primary { background:#d4b94d; color:#17140a; box-shadow:inset 0 0 0 1px #fff1a0,3px 3px 0 #080a0c; }
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
  const questMarkerLabel = document.createElement('span');
  questMarkerLabel.className = 'sg-quest-marker-label';
  questMarkerLabel.textContent = 'Missions';
  questMarker.append(questMarkerIcon, questMarkerLabel);
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
  close.textContent = 'End conversation';
  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'primary';
  actions.append(close, primary);
  dialogue.append(name, copy, actions);
  layer.appendChild(dialogue);

  const buttons = new Map();
  let activeActor = null;
  let actors = [];
  let lastActorRead = -Infinity;
  let raf = 0;

  const closeDialogue = (restoreFocus = true) => {
    dialogue.hidden = true;
    activeActor = null;
    if (restoreFocus) root.querySelector('.sg-sim')?.focus({ preventScroll: true });
  };
  close.addEventListener('click', () => closeDialogue());
  primary.addEventListener('click', () => {
    if (!activeActor) return;
    onAction?.({ action: 'mission-console', actor: activeActor });
    closeDialogue(false);
  });

  const openDialogue = (actor) => {
    const policy = TALKABLES[actor.species];
    if (!policy) return;
    activeActor = actor;
    name.textContent = policy.name;
    copy.textContent = policy.dialogue;
    primary.hidden = !policy.action;
    primary.textContent = policy.action || '';
    dialogue.hidden = false;
    close.focus({ preventScroll: true });
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

    const activeIds = new Set();
    for (const actor of actors) {
      const rawX = (actor.worldX - view.cameraWorldX) / view.viewCols * width;
      const rawY = (actor.worldY - view.cameraWorldY) / view.viewRows * height;
      const distance = Number.isFinite(view.playerWorldX)
        ? Math.hypot(actor.worldX - view.playerWorldX, actor.worldY - view.playerWorldY)
        : Infinity;
      const visible = actor.alive && distance <= 28 &&
        rawX >= 24 && rawX <= width - 24 && rawY >= 30 && rawY <= height - 24;
      if (!visible) continue;
      activeIds.add(actor.id);
      let button = buttons.get(actor.id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'sg-talk-button';
        button.textContent = 'Talk';
        button.setAttribute('aria-label', `Talk to ${TALKABLES[actor.species].name}`);
        button.addEventListener('click', () => openDialogue(actor));
        layer.appendChild(button);
        buttons.set(actor.id, button);
      }
      button.style.transform = `translate(${Math.round(rawX)}px,${Math.round(rawY - 8)}px) translate(-50%,-100%)`;
    }
    for (const [id, button] of buttons) {
      if (activeIds.has(id)) continue;
      button.remove();
      buttons.delete(id);
      if (activeActor?.id === id) closeDialogue();
    }

    const commander = actors.find(({ species, alive }) =>
      species === CREATURE.IRIS_COMMANDER && alive);
    if (!commander) {
      questMarker.hidden = true;
    } else {
      const rawX = (commander.worldX - view.cameraWorldX) / view.viewCols * width;
      const rawY = (commander.worldY - view.cameraWorldY) / view.viewRows * height;
      const distance = Number.isFinite(view.playerWorldX)
        ? Math.hypot(
          commander.worldX - view.playerWorldX,
          commander.worldY - view.playerWorldY,
        )
        : Infinity;
      const talkVisible = distance <= 28 &&
        rawX >= 24 && rawX <= width - 24 && rawY >= 30 && rawY <= height - 24;
      questMarker.hidden = talkVisible;
      if (!talkVisible) {
        const x = Math.max(34, Math.min(width - 34, rawX));
        const y = Math.max(54, Math.min(height - 64, rawY));
        const onscreen = rawX >= 34 && rawX <= width - 34 &&
          rawY >= 54 && rawY <= height - 64;
        const angle = Math.atan2(rawY - height * 0.5, rawX - width * 0.5);
        questMarker.classList.toggle('onscreen', onscreen);
        questMarker.style.transform =
          `translate(${Math.round(x)}px,${Math.round(y - 12)}px) translate(-50%,-100%)`;
        questMarkerIcon.style.transform = `rotate(${angle}rad)`;
      }
    }

    const recovering = game.getPlanetState?.().id === PLANET.SHIP &&
      Number.isFinite(view.playerWorldY) && view.playerWorldY > 48;
    const playerX = (view.playerWorldX - view.cameraWorldX) / view.viewCols * width;
    const playerY = (view.playerWorldY - view.cameraWorldY) / view.viewRows * height;
    recoveryBeam.classList.toggle('on', recovering);
    if (recovering) {
      recoveryBeam.style.transform =
        `translate(${Math.round(playerX)}px,${Math.round(playerY)}px) translate(-50%,-44%)`;
    }
  };

  root.append(style, layer);
  raf = requestAnimationFrame(sync);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      layer.remove();
      style.remove();
    },
  };
}
