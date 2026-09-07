// A shared tooltip surface for inventory slots, equipment, loot, and recipes.
export function createItemTooltip(root, { carrying = () => false } = {}) {
  const entries = new WeakMap();
  const tip = document.createElement('div');
  tip.className = 'item-tooltip'; tip.id = 'sand-item-tooltip';
  tip.setAttribute('role', 'tooltip'); tip.hidden = true;
  const style = document.createElement('style');
  style.textContent = `
    .item-tooltip {position:fixed;z-index:2000;width:260px;max-width:calc(100vw - 24px);box-sizing:border-box;
      padding:15px 17px;border:1px solid #a99568;background:#121c18;color:#e5e1d2;
      box-shadow:0 10px 28px #0009,inset 0 0 0 3px #ffffff04;pointer-events:none;font:14px/1.5 'Sand Pixel',monospace}
    .item-tooltip[hidden]{display:none}.item-tooltip strong{display:block;font:20px/1.25 'Sand Pixel',monospace;color:#e6cf98}
    .item-tooltip small{display:block;color:#acb5a7;margin-top:4px}.item-tooltip p{margin:10px 0 0}
    .item-tooltip dl{display:grid;grid-template-columns:1fr auto;gap:4px 18px;margin:12px 0 0;padding-top:10px;border-top:1px solid #c8b57830}
    .item-tooltip dt{color:#b9c2b3}.item-tooltip dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
    .item-tooltip .positive{color:#b0d491}.item-tooltip .negative{color:#eea698}
    .item-tooltip .item-action{border-top:1px solid #c8b57830;padding-top:10px;color:#bfc3b5;font-size:12px;white-space:pre-line}
  `;
  root.append(style, tip);
  let anchor = null, point = null, signature = '', touchTarget = null, suppressClick = null;
  const node = (tag, text, className) => {
    const item = document.createElement(tag); item.textContent = text;
    if (className) item.className = className; return item;
  };
  function hide() {
    anchor?.removeAttribute('aria-describedby'); anchor = null; point = null;
    signature = ''; tip.hidden = true;
  }
  function place() {
    if (!anchor || tip.hidden) return;
    const box = anchor.getBoundingClientRect(), bounds = tip.getBoundingClientRect();
    const width = document.documentElement.clientWidth, height = window.innerHeight;
    let x = point ? point.x + 18 : box.right + 12;
    let y = point ? point.y + 18 : box.top;
    if (x + bounds.width > width - 12) x = (point ? point.x : box.left) - bounds.width - 14;
    if (y + bounds.height > height - 12) y = (point ? point.y : box.top) - bounds.height - 12;
    tip.style.left = `${Math.max(12, Math.min(x, width - bounds.width - 12))}px`;
    tip.style.top = `${Math.max(12, Math.min(y, height - bounds.height - 12))}px`;
  }
  function refresh() {
    if (!anchor) return;
    if (!anchor.isConnected || !anchor.getClientRects().length) { hide(); return; }
    const data = entries.get(anchor)?.();
    if (!data) { hide(); return; }
    const next = JSON.stringify(data);
    if (next !== signature) {
      signature = next;
      tip.replaceChildren(node('strong', data.name));
      if (data.type) tip.append(node('small', data.type));
      if (data.stats?.length) {
        const list = document.createElement('dl');
        for (const stat of data.stats) list.append(node('dt', stat.label), node('dd', String(stat.value), stat.tone));
        tip.append(list);
      }
      if (data.description) tip.append(node('p', data.description));
      if (data.comparison) tip.append(node('p', data.comparison.text, data.comparison.tone));
      if (data.action) tip.append(node('p', touchTarget === anchor && data.touchAction ? data.touchAction : data.action, 'item-action'));
    }
    tip.hidden = false; place();
  }
  function show(target, position = null) {
    if (anchor !== target) { hide(); anchor = target; }
    point = position; anchor.setAttribute('aria-describedby', tip.id); refresh();
  }
  const targetOf = event => event.composedPath().find(target => entries.has(target));
  const over = event => {
    if (event.pointerType === 'touch') return;
    const target = targetOf(event);
    if (target) show(target, { x: event.clientX, y: event.clientY }); else hide();
  };
  const move = event => {
    if (anchor && event.pointerType !== 'touch') { point = { x: event.clientX, y: event.clientY }; place(); }
  };
  const out = event => { if (event.pointerType !== 'touch' && anchor && !anchor.contains(event.relatedTarget)) hide(); };
  const focus = event => { const target = targetOf(event); if (target) show(target); else hide(); };
  const down = event => {
    const target = targetOf(event);
    if (event.pointerType === 'touch' && target && entries.get(target)?.()?.inspectTouch && !carrying()) {
      if (touchTarget !== target) {
        touchTarget = target; suppressClick = target; signature = '';
        event.preventDefault(); event.stopImmediatePropagation(); show(target); return;
      }
    }
    touchTarget = null; suppressClick = null; hide();
  };
  const click = event => {
    if (suppressClick && targetOf(event) === suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); }
    suppressClick = null;
  };
  const events = { pointerover: over, pointermove: move, pointerout: out, focusin: focus, focusout: hide, pointerdown: down, click };
  for (const [name, handler] of Object.entries(events)) root.addEventListener(name, handler, true);
  root.addEventListener('scroll', hide, true); window.addEventListener('resize', hide);
  return {
    bind(target, describe) { entries.set(target, describe); target.removeAttribute('title'); },
    refresh, hide,
    destroy() {
      hide(); for (const [name, handler] of Object.entries(events)) root.removeEventListener(name, handler, true);
      root.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); tip.remove(); style.remove();
    },
  };
}
