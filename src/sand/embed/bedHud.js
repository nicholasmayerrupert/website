import { BED_RESULT, ITEM_KIND } from '../wasmBridge/abi.generated.js';

const MESSAGES = {
  [BED_RESULT.DAYTIME]: 'Respawn point set. You can sleep here at night.',
  [BED_RESULT.SPAWN_SET]: 'Respawn point set.',
  [BED_RESULT.SLEEPING]: 'Respawn point set. Resting until morning…',
  [BED_RESULT.OCCUPIED]: 'This bed is occupied.',
  [BED_RESULT.UNSAFE]: 'You cannot rest while hurt, in danger, or near monsters.',
  [BED_RESULT.OBSTRUCTED]: 'This bed is obstructed or has no safe support.',
  [BED_RESULT.TOO_FAR]: 'Move closer to the bed.',
  [BED_RESULT.AWAKE]: 'You left the bed.',
  [BED_RESULT.MORNING]: 'A new morning. Your respawn point is set.',
  [BED_RESULT.SPAWN_LOST]: 'Your bed is missing or obstructed. Respawn point reset to the starting area.',
};

export function createBedHud(root, game, { blocked }) {
  const style = document.createElement('style');
  style.textContent = `
    .bed-prompt {pointer-events:auto;position:absolute;z-index:76;transform:translate(-50%,-100%);padding:8px 12px;border:1px solid #d8c28c;background:#17271eed;color:#eddfb5;font:13px 'Sand Pixel',monospace;cursor:pointer;white-space:nowrap}
    .bed-notice {position:absolute;z-index:110;left:50%;bottom:135px;transform:translateX(-50%);max-width:calc(100% - 32px);width:max-content;box-sizing:border-box;padding:12px 16px;border:1px solid #9d9569;background:#14231ef0;color:#e3d8b9;font:14px/1.5 'Sand Pixel',monospace;text-align:center;pointer-events:none}
    .bed-sleep {pointer-events:auto;position:absolute;inset:0;z-index:130;background:#101c2b66;display:flex;align-items:center;justify-content:flex-end;flex-direction:column;padding:24px 16px 130px;box-sizing:border-box;color:#e9debd;font:15px/1.5 'Sand Pixel',monospace;text-shadow:1px 2px #102014}
    .bed-sleep h2 {font:26px 'Sand Pixel',monospace;margin:0 0 8px}.bed-sleep p{margin:0 0 18px}.bed-sleep button{padding:12px 22px;border:1px solid #c1b078;background:#283e30;color:#efe2b7;font:14px 'Sand Pixel',monospace;cursor:pointer}
    .bed-prompt:focus-visible,.bed-sleep button:focus-visible {outline:2px solid #ffe4a2;outline-offset:3px}
    .bed-prompt[hidden],.bed-notice[hidden],.bed-sleep[hidden]{display:none}
    @media(max-width:600px){.bed-notice{bottom:165px;font-size:12px}.bed-prompt{font-size:12px}.bed-sleep{padding-bottom:170px}}
  `;
  const prompt = document.createElement('button'); prompt.type = 'button'; prompt.className = 'bed-prompt'; prompt.hidden = true;
  prompt.setAttribute('aria-label', 'Use bed (E)');
  const notice = document.createElement('div'); notice.className = 'bed-notice'; notice.setAttribute('role', 'status'); notice.hidden = true;
  const sleep = document.createElement('section'); sleep.className = 'bed-sleep'; sleep.hidden = true;
  sleep.setAttribute('role', 'dialog'); sleep.setAttribute('aria-modal', 'true'); sleep.setAttribute('aria-label', 'Sleeping');
  const heading = document.createElement('h2'); heading.textContent = 'Sleeping…';
  const text = document.createElement('p'); text.textContent = 'Resting until morning';
  const leave = document.createElement('button'); leave.type = 'button'; leave.textContent = 'Leave bed';
  sleep.append(heading, text, leave); root.append(style, prompt, notice, sleep);
  let nearest = null, wasSleeping = false, revision = 0, noticeUntil = 0, frame = 0, bounds = null;
  const focusGame = () => root.querySelector('.sg-sim')?.focus({ preventScroll: true });
  const use = () => { if (nearest) { game.clearInput(); game.useBed(nearest.id); focusGame(); } };
  const wake = () => { game.clearInput(); game.useBed(0); };
  prompt.addEventListener('click', use); leave.addEventListener('click', wake);
  for (const el of [prompt, sleep]) for (const type of ['pointerdown', 'pointerup', 'wheel']) el.addEventListener(type, event => event.stopPropagation());
  const update = () => {
    const player = game.getPlayer(), view = game.getMissionView(), isSleeping = !!player?.sleepingBed;
    nearest = null; bounds = null;
    if (player?.alive && view && !blocked() && !isSleeping) {
      let distance = 18;
      for (const bed of game.getBeds()) {
        const d = Math.hypot(bed.worldX - view.playerWorldX, bed.worldY - view.playerWorldY);
        if (d < distance) { nearest = bed; distance = d; }
      }
    }
    prompt.hidden = !nearest;
    if (nearest) {
      const a = game.worldToScreen(nearest.worldX - 5, nearest.worldY - 1), b = game.worldToScreen(nearest.worldX + 6, nearest.worldY + 4);
      bounds = { left: a.x, right: b.x, top: a.y, bottom: b.y };
      prompt.style.left = `${Math.max(85, Math.min(root.host.clientWidth - 85, (a.x + b.x) / 2))}px`;
      prompt.style.top = `${Math.max(40, a.y - 8)}px`;
      const phase = game.getDayNight().phase, night = phase < .2 || phase >= .8;
      prompt.textContent = nearest.sleeper ? 'E · Bed occupied' : night ? 'E · Sleep / Set spawn' : 'E · Set respawn point';
    }
    if (player && player.bedRevision !== revision) {
      revision = player.bedRevision; notice.textContent = MESSAGES[player.bedStatus] || '';
      noticeUntil = performance.now() + 4500;
    }
    notice.hidden = !notice.textContent || performance.now() > noticeUntil || isSleeping || blocked();
    sleep.hidden = !isSleeping;
    if (isSleeping && !wasSleeping) leave.focus({ preventScroll: true });
    if (!isSleeping && wasSleeping) focusGame();
    wasSleeping = isSleeping; frame = requestAnimationFrame(update);
  };
  const key = event => {
    if (event.repeat || event.composedPath().some(node => /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName))) return;
    if (wasSleeping) {
      if (['Escape', 'KeyE'].includes(event.code)) { event.preventDefault(); event.stopImmediatePropagation(); wake(); }
      else if (event.key === 'Tab') { event.preventDefault(); event.stopImmediatePropagation(); leave.focus(); }
      else if (['KeyM', 'KeyJ', 'KeyI'].includes(event.code)) { event.preventDefault(); event.stopImmediatePropagation(); }
      return;
    }
    if (event.code !== 'KeyE' || !nearest || blocked() || root.activeElement !== root.querySelector('.sg-sim')
      || root.querySelector('.ad-chest-prompt:not([hidden])')) return;
    event.preventDefault(); event.stopImmediatePropagation(); use();
  };
  const clickWorld = event => {
    if (!bounds || event.button !== 0 || blocked() || event.composedPath().some(node => /^(BUTTON|INPUT|A)$/.test(node.tagName))) return;
    if (game.getPlayer()?.heldItemKind === ITEM_KIND.MINING_TOOL) return;
    const canvas = root.host.getBoundingClientRect();
    if (!canvas) return;
    const x = event.clientX - canvas.left, y = event.clientY - canvas.top;
    if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
      event.preventDefault(); event.stopImmediatePropagation(); use();
    }
  };
  root.addEventListener('keydown', key, true); window.addEventListener('pointerdown', clickWorld, true);
  frame = requestAnimationFrame(update);
  return { destroy() { cancelAnimationFrame(frame); root.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', clickWorld, true); style.remove(); prompt.remove(); notice.remove(); sleep.remove(); } };
}
