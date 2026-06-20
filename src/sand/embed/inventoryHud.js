// Framework-free survival inventory HUD for the sand game. Like toolPalette.js it
// builds plain DOM into a host root (the Web Component's shadow root) with a single
// injected <style> — no React, no Tailwind. It owns NO inventory state: the slots,
// the carried "cursor" stack, and ALL pick/place/swap/merge/throw logic are
// authoritative in the C++ engine. The HUD only renders the snapshot passed to
// update() (plus the carried stack read via getCursor()) and forwards player intent
// via callbacks; the caller wires those into the engine.
//
// Minecraft-style: an always-visible hotbar (slots 0..8) bottom-center, plus a
// key-toggled grid (slots 9..35) above it with a darkened full-window backdrop.
// While the grid is open the carried item follows the pointer and clicks pick /
// place / swap / merge; clicks on the backdrop throw the carried stack out.

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
// Tool letters by ToolClass id (mirrors enum ToolClass: 1 pick, 2 axe, 3 shovel).
// There is no hand tool anymore — the bare hand is implicit (empty slot).
const TOOL_GLYPH = { 1: 'P', 2: 'A', 3: 'S' };
const TOOL_NAME = { 1: 'Pickaxe', 2: 'Axe', 3: 'Shovel' };
const TIER = ['', 'W', 'S', 'I', 'G'];
const TIER_NAME = ['', 'Wood', 'Stone', 'Iron', 'Gold'];

const STYLE = `
.inv-backdrop { position: fixed; inset: 0; z-index: 71; display: none;
  background: rgba(0,0,0,.45); pointer-events: auto; }
.inv-backdrop.open { display: block; }
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
.inv-cursor-item { position: fixed; z-index: 90; display: none; pointer-events: none;
  width: 34px; height: 34px; margin: -17px 0 0 -17px; align-items: center; justify-content: center;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,.6)); }
.inv-cursor-item.show { display: flex; }
.inv-cursor-item .inv-swatch, .inv-cursor-item .inv-tool { width: 30px; height: 30px; }
.inv-cursor-item .inv-count { right: -2px; bottom: -2px; font-size: 12px; }
`;

export function createInventoryHud(root, { selectSlot, cursorPick, throwFromCursor, getCursor } = {}) {
  if (!root.querySelector('style[data-sand-inventory]')) {
    const s = document.createElement('style');
    s.setAttribute('data-sand-inventory', '');
    s.textContent = STYLE;
    root.appendChild(s);
  }

  let open = false;
  // The slot a pointerdown started on, so a press-drag-release can place onto a
  // DIFFERENT slot (and we avoid double-firing when down/up land on the same slot).
  let downSlot = -1;
  let downOnSlot = false; // did the active press start on a slot (vs the backdrop)?

  // Darkened full-window backdrop BEHIND the panels (Minecraft style). Clicking it
  // while carrying throws the carried stack out into the world.
  const backdrop = document.createElement('div');
  backdrop.className = 'inv-backdrop';

  const hud = document.createElement('div');
  hud.className = 'inv-hud';

  // Stop HUD pointer events from reaching the window-level game input (which would
  // latch mouse buttons / mine through the panel) — same guard as toolPalette. The
  // backdrop stops them too: its clicks are throws, not game actions.
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'click', 'contextmenu', 'wheel']) {
    hud.addEventListener(ev, (e) => e.stopPropagation());
    backdrop.addEventListener(ev, (e) => e.stopPropagation());
  }

  const grid = document.createElement('div');
  grid.className = 'inv-grid';
  const bar = document.createElement('div');
  bar.className = 'inv-bar';
  const hint = document.createElement('div');
  hint.className = 'inv-hint';
  hint.textContent = 'E — inventory · 1–9 / scroll — select';
  hud.append(grid, bar, hint);

  // The carried stack, rendered as a small floating swatch/chip that follows the
  // pointer while the grid is open. Lives at the root so it can sit above the panels.
  const cursorItem = document.createElement('div');
  cursorItem.className = 'inv-cursor-item';

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
    const el = target && target.closest && target.closest('.inv-slot');
    return el ? (el.dataset.index | 0) : -1;
  };

  // Render a stack (slot snapshot or the carried cursor stack) into a container as a
  // swatch+count or a tool chip. Returns nothing; mutates `el`.
  function renderStack(el, s) {
    if (!s) return;
    if (s.isTool) {
      const g = document.createElement('span'); g.className = 'inv-tool';
      g.textContent = TOOL_GLYPH[s.toolClass] || '·';
      el.appendChild(g);
      if (s.toolTier > 0) {
        const t = document.createElement('span'); t.className = 'inv-tier';
        t.textContent = TIER[s.toolTier] || '';
        el.appendChild(t);
      }
    } else if (s.count > 0) {
      const sw = document.createElement('span'); sw.className = 'inv-swatch';
      sw.style.background = COLOR[s.material] || '#888';
      el.appendChild(sw);
      if (s.count > 1) {
        const c = document.createElement('span'); c.className = 'inv-count';
        c.textContent = String(s.count);
        el.appendChild(c);
      }
    }
  }

  // Re-read the carried stack from the engine and refresh the floating element.
  // Called from update() and right after every action so the cursor stays in sync.
  function refreshCursor() {
    const c = getCursor?.() || null;
    cursorItem.replaceChildren();
    if (open && c) {
      renderStack(cursorItem, c);
      cursorItem.classList.add('show');
    } else {
      cursorItem.classList.remove('show');
    }
  }

  const hasCursor = () => !!(getCursor?.());

  // --- Pointer routing -------------------------------------------------------
  // CLOSED: left-click a hotbar slot just selects it.
  // OPEN: pointerdown on a slot = cursorPick(slot, half); a drag releasing on a
  //   DIFFERENT slot also picks/places there. pointerdown on the backdrop (or a
  //   drag releasing on it) while carrying = throwFromCursor.

  hud.addEventListener('contextmenu', (e) => e.preventDefault());
  backdrop.addEventListener('contextmenu', (e) => e.preventDefault());

  hud.addEventListener('pointerdown', (e) => {
    const i = idxOf(e.target);
    if (i < 0) return;
    if (!open) {
      // Closed hotbar: a click selects. Record nothing for drag.
      downSlot = -1; downOnSlot = false;
      if (i < HOTBAR && e.button === 0) selectSlot?.(i);
      return;
    }
    e.preventDefault();
    downSlot = i;
    downOnSlot = true;
    const half = e.button === 2;
    cursorPick?.(i, half);
    refreshCursor();
  });

  hud.addEventListener('pointerup', (e) => {
    if (!open) { downSlot = -1; downOnSlot = false; return; }
    const to = idxOf(e.target);
    const from = downSlot;
    downSlot = -1; downOnSlot = false;
    // A press that started on slot `from` and released on a DIFFERENT slot `to`,
    // while carrying, places/swaps onto `to` (press-drag-release). Same-slot
    // releases were already handled by the pointerdown pick, so skip them.
    if (to < 0 || from < 0 || to === from) return;
    if (!hasCursor()) return;
    const half = e.button === 2;
    cursorPick?.(to, half);
    refreshCursor();
  });

  // Throw out: a press directly on the backdrop while carrying ejects the stack.
  backdrop.addEventListener('pointerdown', (e) => {
    downSlot = -1; downOnSlot = false;
    if (!open || !hasCursor()) return;
    e.preventDefault();
    throwFromCursor?.(e.button === 2 ? false : true); // left = whole, right = one
    refreshCursor();
  });

  // A drag that STARTED on a slot but releases over the backdrop throws the whole
  // stack (Minecraft drops the carried stack when you release outside the window).
  backdrop.addEventListener('pointerup', () => {
    const startedOnSlot = downOnSlot;
    downSlot = -1; downOnSlot = false;
    if (!open || !startedOnSlot || !hasCursor()) return;
    throwFromCursor?.(true);
    refreshCursor();
  });

  // The carried element follows the pointer whenever the grid is open.
  const onMove = (e) => {
    if (!open) return;
    cursorItem.style.left = e.clientX + 'px';
    cursorItem.style.top = e.clientY + 'px';
  };

  function update(inv) {
    if (inv && inv.slots) {
      for (let i = 0; i < SLOTS; i++) {
        const el = slots[i];
        if (!el) continue;
        const s = inv.slots[i] || { material: 0, isTool: false, count: 0 };
        el.classList.toggle('selected', i === inv.selected);
        el.replaceChildren();
        if (i < HOTBAR) {
          const n = document.createElement('span'); n.className = 'inv-num';
          n.textContent = String(i + 1); el.appendChild(n);
        }
        renderStack(el, s);
        if (s.isTool) {
          el.title = `${TIER_NAME[s.toolTier] || ''} ${TOOL_NAME[s.toolClass] || 'Tool'}`.trim();
        } else if (s.count > 0) {
          el.title = `${(NAME[s.material] || '').toLowerCase()} ×${s.count}`;
        } else {
          el.title = '';
        }
      }
    }
    refreshCursor();
  }

  const setOpen = (v) => {
    open = !!v;
    hud.classList.toggle('open', open);
    backdrop.classList.toggle('open', open);
    if (!open) { downSlot = -1; downOnSlot = false; }
    if (open) window.addEventListener('pointermove', onMove);
    else window.removeEventListener('pointermove', onMove);
    refreshCursor();
  };

  root.append(backdrop, hud, cursorItem);
  return {
    el: hud,
    update,
    setOpen,
    toggleOpen() { setOpen(!open); },
    isOpen() { return open; },
    destroy() {
      window.removeEventListener('pointermove', onMove);
      backdrop.remove();
      hud.remove();
      cursorItem.remove();
    },
  };
}
