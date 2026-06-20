// Framework-free survival inventory HUD for the sand game. Like toolPalette.js it
// builds plain DOM into a host root (the Web Component's shadow root) with a single
// injected <style> — no React, no Tailwind. It owns NO game state: the inventory is
// authoritative in the C++ engine. The HUD only renders the packed snapshot passed
// to update() and forwards intents (select a slot, move a slot) via callbacks; the
// caller wires those to the engine. An always-visible hotbar plus a key-toggled
// grid (the rest of the slots), Minecraft/Terraria style.

import { MATERIALS } from '../materials.generated.js';

const HOTBAR = 9; // mirrors INV_HOTBAR in cpp/engine/common.hpp
const SLOTS = 36; // mirrors INV_SLOTS

// Per-material css color, derived from the packed 0xAABBGGRR material color (R is the
// low byte) so the swatch matches the in-world pixel exactly.
const COLOR = {};
const NAME = {};
for (const m of MATERIALS) {
  const c = m.color >>> 0;
  COLOR[m.id] = `rgb(${c & 0xff},${(c >> 8) & 0xff},${(c >> 16) & 0xff})`;
  NAME[m.id] = m.name;
}
// Tool glyphs by ToolClass id (mirrors enum ToolClass: 1 pick, 2 axe, 3 shovel, 4
// hand). Letters render reliably across fonts where a shovel emoji does not.
const TOOL_GLYPH = { 1: 'P', 2: 'A', 3: 'S', 4: 'H' };
const TOOL_NAME = { 1: 'Pickaxe', 2: 'Axe', 3: 'Shovel', 4: 'Hand' };
const TIER_NAME = ['Hand', 'Wood', 'Stone', 'Iron', 'Gold'];

const STYLE = `
.inv-hud { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 72;
  display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none;
  font-family: ui-sans-serif, system-ui, sans-serif; max-width: calc(100vw - 1rem); }
.inv-grid { display: none; grid-template-columns: repeat(9, 1fr); gap: 4px; padding: 8px; pointer-events: auto;
  background: rgba(3,7,18,.82); border: 1px solid rgba(255,255,255,.15); border-radius: 8px;
  box-shadow: 0 20px 25px -5px rgba(0,0,0,.5); backdrop-filter: blur(4px); }
.inv-hud.open .inv-grid { display: grid; }
.inv-bar { display: grid; grid-template-columns: repeat(9, 1fr); gap: 4px; padding: 6px; pointer-events: auto;
  background: rgba(17,24,39,.42); border-radius: 8px; backdrop-filter: blur(4px);
  box-shadow: 0 10px 15px -3px rgba(0,0,0,.3); }
.inv-slot { position: relative; width: 40px; height: 40px; box-sizing: border-box; border-radius: 6px;
  border: 1px solid rgba(255,255,255,.16); background: rgba(10,14,22,.55); cursor: pointer;
  display: flex; align-items: center; justify-content: center; overflow: hidden; user-select: none; }
.inv-slot:hover { border-color: rgba(255,255,255,.4); }
.inv-slot.selected { border-color: #fde68a; box-shadow: 0 0 0 2px rgba(253,230,138,.55) inset; }
.inv-swatch { width: 26px; height: 26px; border-radius: 4px; box-shadow: inset 2px 2px 0 rgba(255,255,255,.18); }
.inv-tool { width: 26px; height: 26px; border-radius: 4px; display: flex; align-items: center; justify-content: center;
  font-size: 15px; font-weight: 800; color: #f1f5f9; background: rgba(120,130,150,.5);
  box-shadow: inset 2px 2px 0 rgba(255,255,255,.18); }
.inv-count { position: absolute; right: 2px; bottom: 1px; font-size: 11px; font-weight: 700; color: #fff;
  text-shadow: 0 1px 2px #000, 0 0 2px #000; pointer-events: none; }
.inv-num { position: absolute; left: 3px; top: 1px; font-size: 9px; font-weight: 700; color: rgba(255,255,255,.6);
  text-shadow: 0 1px 2px #000; pointer-events: none; }
.inv-tier { position: absolute; right: 2px; bottom: 1px; font-size: 9px; font-weight: 700; color: #cbd5e1;
  text-shadow: 0 1px 2px #000; pointer-events: none; }
.inv-hint { font-size: 10px; color: rgba(229,231,235,.7); text-shadow: 0 1px 2px #000; }
.inv-hud.open .inv-hint { color: rgba(229,231,235,.95); }
`;

export function createInventoryHud(root, { onSelect, onMove } = {}) {
  if (!root.querySelector('style[data-sand-inventory]')) {
    const s = document.createElement('style');
    s.setAttribute('data-sand-inventory', '');
    s.textContent = STYLE;
    root.appendChild(s);
  }

  let open = false;
  let dragFrom = -1;

  const hud = document.createElement('div');
  hud.className = 'inv-hud';
  // Stop HUD pointer events from reaching the window-level game input (which would
  // latch mouse buttons / mine through the panel) — same guard as toolPalette.
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'click', 'contextmenu', 'wheel']) {
    hud.addEventListener(ev, (e) => e.stopPropagation());
  }

  const grid = document.createElement('div');
  grid.className = 'inv-grid';
  const bar = document.createElement('div');
  bar.className = 'inv-bar';
  const hint = document.createElement('div');
  hint.className = 'inv-hint';
  hint.textContent = 'E — inventory · 1–9 / scroll — select';
  hud.append(grid, bar, hint);

  // Build the 36 slot elements once; update() refills them. Bar = slots 0..8 (the
  // hotbar), grid = slots 9..35. The grid renders top-to-bottom but indexes the
  // upper slots, matching the engine's slot ordering.
  const slots = [];
  const makeSlot = (index, parent) => {
    const el = document.createElement('div');
    el.className = 'inv-slot';
    el.dataset.index = String(index);
    parent.appendChild(el);
    slots[index] = el;
  };
  for (let i = HOTBAR; i < SLOTS; i++) makeSlot(i, grid);
  for (let i = 0; i < HOTBAR; i++) makeSlot(i, bar);

  const idxOf = (target) => {
    const el = target.closest && target.closest('.inv-slot');
    return el ? (el.dataset.index | 0) : -1;
  };
  // pointerdown picks up a slot (for drag-move); pointerup resolves it. A same-slot
  // press = a click: select that hotbar slot. Otherwise move from -> to.
  hud.addEventListener('pointerdown', (e) => { dragFrom = idxOf(e.target); });
  hud.addEventListener('pointerup', (e) => {
    const to = idxOf(e.target);
    const from = dragFrom; dragFrom = -1;
    if (to < 0) return;
    if (from === to || from < 0) { if (to < HOTBAR) onSelect?.(to); return; }
    onMove?.(from, to);
  });

  function update(inv) {
    if (!inv || !inv.slots) return;
    for (let i = 0; i < SLOTS; i++) {
      const el = slots[i];
      if (!el) continue;
      const s = inv.slots[i] || { material: 0, isTool: false, count: 0 };
      el.classList.toggle('selected', i === inv.selected);
      el.replaceChildren();
      if (i < HOTBAR) { const n = document.createElement('span'); n.className = 'inv-num'; n.textContent = String(i + 1); el.appendChild(n); }
      if (s.isTool) {
        const g = document.createElement('span'); g.className = 'inv-tool';
        g.textContent = TOOL_GLYPH[s.toolClass] || '·';
        el.appendChild(g);
        if (s.toolTier > 0) { const t = document.createElement('span'); t.className = 'inv-tier'; t.textContent = TIER_NAME[s.toolTier]?.[0] || ''; el.appendChild(t); }
        el.title = `${TIER_NAME[s.toolTier] || ''} ${TOOL_NAME[s.toolClass] || 'Tool'}`.trim();
      } else if (s.count > 0) {
        const sw = document.createElement('span'); sw.className = 'inv-swatch';
        sw.style.background = COLOR[s.material] || '#888';
        el.appendChild(sw);
        const c = document.createElement('span'); c.className = 'inv-count'; c.textContent = String(s.count);
        el.appendChild(c);
        el.title = `${(NAME[s.material] || '').toLowerCase()} ×${s.count}`;
      } else {
        el.title = '';
      }
    }
  }

  const setOpen = (v) => { open = !!v; hud.classList.toggle('open', open); };

  root.appendChild(hud);
  return {
    el: hud,
    update,
    setOpen,
    toggleOpen() { setOpen(!open); },
    isOpen() { return open; },
    destroy() { hud.remove(); },
  };
}
