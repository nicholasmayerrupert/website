import { STATUS_ACTOR, STATUS_EFFECT_DEFS, STATUS_TAG } from '../wasmBridge/abi.generated.js';

export function createStatusEffectHud(root) {
  const style = document.createElement('style');
  style.textContent = `
    .status-effects{position:absolute;right:22px;top:80px;z-index:78;display:flex;justify-content:flex-end;flex-wrap:wrap;gap:6px;max-width:min(520px,calc(100% - 44px));font:12px 'Sand Pixel',monospace}
    .status-effect{position:relative;pointer-events:auto;display:flex;align-items:center;gap:7px;min-height:36px;box-sizing:border-box;padding:6px 9px 8px;color:#e7dfbe;background:#17251ef2;border:1px solid #a5ab7866;font:inherit;cursor:help}
    .status-effect[data-harmful=true]{background:#34221ff2;border-color:#cb8f6c88}
    .status-effect:focus-visible{outline:2px solid #f0d891;outline-offset:2px}.status-effect-glyph{font-size:11px;color:var(--effect-color);border:1px solid currentColor;padding:3px;line-height:1}
    .status-effect-time{color:#b8c7b2;font-variant-numeric:tabular-nums;min-width:25px;text-align:right}.status-effect-bar{position:absolute;bottom:0;left:0;height:2px;background:var(--effect-color);width:var(--remaining)}
    .status-effect-tip{position:absolute;z-index:145;pointer-events:none;box-sizing:border-box;width:min(280px,calc(100% - 24px));padding:12px 14px;color:#e8dfbf;background:#15231cfa;border:1px solid #b6a573;box-shadow:0 5px 18px #0006;font:13px/1.5 'Sand Pixel',monospace}
    .status-effect-tip strong{font-size:15px;font-weight:normal}.status-effect-tip p{margin:6px 0 0;color:#bfcbb7}
    .status-effects[hidden],.status-effect-tip[hidden]{display:none}
    @media(max-width:600px){.status-effects{top:140px;right:12px;max-width:calc(100% - 24px);gap:4px;font-size:11px}.status-effect{min-height:44px;padding:6px 7px 8px;gap:5px}}
  `;
  const list = document.createElement('div'); list.className = 'status-effects'; list.hidden = true;
  list.setAttribute('role', 'list'); list.setAttribute('aria-label', 'Active status effects');
  const tip = document.createElement('div'); tip.className = 'status-effect-tip'; tip.hidden = true;
  tip.setAttribute('role', 'tooltip'); tip.id = 'sand-status-effect-tip';
  const title = document.createElement('strong'), description = document.createElement('p'); tip.append(title, description);
  root.append(style, list, tip);
  const entries = new Map();
  let shown = null, pinned = false;
  const hide = () => {
    shown?.button.removeAttribute('aria-describedby'); shown = null; pinned = false; tip.hidden = true;
  };
  const show = entry => {
    if (shown !== entry) hide();
    shown = entry;
    title.textContent = entry.def.name; description.textContent = entry.def.description;
    entry.button.setAttribute('aria-describedby', tip.id); tip.hidden = false;
    const box = entry.button.getBoundingClientRect(), host = root.host.getBoundingClientRect();
    tip.style.left = `${Math.max(12, Math.min(host.width - tip.offsetWidth - 12, box.right - host.left - tip.offsetWidth))}px`;
    tip.style.top = `${Math.min(host.height - tip.offsetHeight - 12, box.bottom - host.top + 7)}px`;
  };
  const outside = event => { if (!event.composedPath().includes(list)) hide(); };
  const key = event => { if (event.code === 'Escape' && shown) { event.preventDefault(); event.stopImmediatePropagation(); hide(); } };
  root.addEventListener('pointerdown', outside, true); root.addEventListener('keydown', key, true);
  const update = (player, effects) => {
    const active = player?.alive ? effects.filter(effect => effect.actorKind === STATUS_ACTOR.PLAYER && effect.actorId === player.id) : [];
    const ids = new Set(active.map(effect => effect.effect));
    for (const [id, entry] of entries) if (!ids.has(id)) {
      if (shown === entry) hide();
      entry.item.remove(); entries.delete(id);
    }
    list.hidden = !active.length;
    for (const effect of active) {
      const def = STATUS_EFFECT_DEFS[effect.effect];
      if (!def) continue;
      let entry = entries.get(effect.effect);
      if (!entry) {
        const item = document.createElement('div'); item.setAttribute('role', 'listitem');
        const button = document.createElement('button'); button.type = 'button'; button.className = 'status-effect';
        button.dataset.effect = String(effect.effect); button.dataset.harmful = String(!!(def.tags & STATUS_TAG.HARMFUL));
        button.style.setProperty('--effect-color', def.color);
        const glyph = document.createElement('span'); glyph.className = 'status-effect-glyph'; glyph.textContent = def.glyph; glyph.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span'), time = document.createElement('span'), bar = document.createElement('i');
        time.className = 'status-effect-time'; bar.className = 'status-effect-bar'; bar.setAttribute('aria-hidden', 'true');
        button.append(glyph, name, time, bar); item.append(button); list.append(item);
        entry = { item, button, name, time, def }; entries.set(effect.effect, entry);
        button.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse' && !pinned) show(entry); });
        button.addEventListener('pointerleave', () => { if (!pinned && root.activeElement !== button) hide(); });
        button.addEventListener('focus', () => show(entry));
        button.addEventListener('blur', () => { if (!pinned) hide(); });
        button.addEventListener('click', event => { event.stopPropagation(); show(entry); pinned = true; });
        for (const type of ['pointerdown', 'pointerup', 'wheel']) button.addEventListener(type, event => event.stopPropagation());
      }
      entry.name.textContent = `${def.name}${effect.stacks > 1 ? ` ×${effect.stacks}` : effect.strength > 1 ? ` ${effect.strength}` : ''}`;
      entry.time.textContent = `${Math.ceil(effect.remainingTicks / 60)}s`;
      entry.button.style.setProperty('--remaining', `${Math.min(100, effect.remainingTicks / Math.max(1, effect.durationTicks) * 100)}%`);
      entry.button.setAttribute('aria-label', `${entry.name.textContent}, ${Math.ceil(effect.remainingTicks / 60)} seconds remaining`);
    }
  };
  return { update, destroy() { root.removeEventListener('pointerdown', outside, true); root.removeEventListener('keydown', key, true); style.remove(); list.remove(); tip.remove(); } };
}
