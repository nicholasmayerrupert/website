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
import { INV_HOTBAR, INV_SLOTS } from '../wasmBridge/abi.generated.js';
import { injectStyleOnce, packedToRgb, swallowEvents } from './uiShared.js';

const HOTBAR = INV_HOTBAR;
const SLOTS = INV_SLOTS;

// Per-material css color + name so a swatch matches the in-world pixel exactly.
const COLOR = {};
const NAME = {};
for (const m of MATERIALS) {
  COLOR[m.id] = packedToRgb(m.color >>> 0);
  NAME[m.id] = m.name;
}
// Tool names/tier letters by ToolClass id (mirrors enum ToolClass: 1 pick, 2 axe,
// 3 shovel, 5 dig). There is no hand tool item — bare hand is an empty slot.
const TOOL_NAME = { 1: 'Pickaxe', 2: 'Axe', 3: 'Shovel', 5: 'Dig' };
const TIER = ['', 'W', 'S', 'I', 'G'];
const TIER_NAME = ['', 'Wood', 'Stone', 'Iron', 'Gold'];

// Tool icons as simple 12x12 pixel art. 'H' = wooden handle, 'M' = metal head
// (tinted by tier), '.' = empty. Rendered as crisp SVG so it scales without blur.
// Dig (and pickaxe): diagonal pick — solid head top-right, wood shaft bottom-left.
const PICKAXE_ART = [
  '............',
  '..MMMMMM....',
  '...MMMMMM...',
  '....MMMMMM..',
  '.....MM.MM..',
  '.....HH..M..',
  '....HH......',
  '...HH.......',
  '..HH........',
  '.HH.........',
  '............',
  '............',
];
const TOOL_ART = {
  1: PICKAXE_ART, // legacy pickaxe class (same silhouette)
  2: [ // axe — blade on the left, handle down the right
    '............',
    '...MMM......',
    '..MMMMM.....',
    '.MMMMMMM....',
    '.MMMMMMMHH..',
    '.MMMMMMMHH..',
    '.MMMMMMMHH..',
    '..MMMMM.HH..',
    '...MMM..HH..',
    '........HH..',
    '........HH..',
    '............',
  ],
  3: [ // shovel — handle on top, spade scoop at the bottom
    '............',
    '.....HH.....',
    '.....HH.....',
    '.....HH.....',
    '.....HH.....',
    '....MMMM....',
    '...MMMMMM...',
    '...MMMMMM...',
    '...MMMMMM...',
    '...MMMMMM...',
    '....MMMM....',
    '............',
  ],
  5: PICKAXE_ART, // dig — universal dig tool, pickaxe look
};
const TOOL_HANDLE = '#9b6a39'; // wood
// Metal-head tint indexed by toolTier (0 = generic, 1 wood, 2 stone, 3 iron, 4 gold).
const TOOL_HEAD = ['#c9ccd4', '#b07a44', '#9aa0a8', '#dfe4ec', '#f2c734'];

const SVG_NS = 'http://www.w3.org/2000/svg';
const _toolIconCache = new Map();
function buildToolIcon(toolClass, toolTier, sizePx) {
  const grid = TOOL_ART[toolClass];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('width', String(sizePx));
  svg.setAttribute('height', String(sizePx));
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.style.display = 'block';
  if (!grid) return svg; // unknown tool class -> empty icon
  const head = TOOL_HEAD[toolTier] || TOOL_HEAD[0];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch !== 'H' && ch !== 'M') continue;
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(c));
      rect.setAttribute('y', String(r));
      // Bleed each cell by a hair so crisp-edges scaling never leaves seams.
      rect.setAttribute('width', '1.02');
      rect.setAttribute('height', '1.02');
      rect.setAttribute('fill', ch === 'H' ? TOOL_HANDLE : head);
      svg.appendChild(rect);
    }
  }
  return svg;
}
// Cached per (class, tier, size); cloned per use so the same icon can live in many slots.
function toolIcon(toolClass, toolTier, sizePx) {
  const key = toolClass + ':' + toolTier + ':' + sizePx;
  let icon = _toolIconCache.get(key);
  if (!icon) { icon = buildToolIcon(toolClass, toolTier, sizePx); _toolIconCache.set(key, icon); }
  return icon.cloneNode(true);
}

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
.inv-count { position: absolute; right: 2px; bottom: 1px; font-size: 11px; font-weight: 700; color: #fff;
  text-shadow: 0 1px 2px #000, 0 0 2px #000; pointer-events: none; }
.inv-num { position: absolute; left: 3px; top: 1px; font-size: 9px; font-weight: 700; color: rgba(255,255,255,.6);
  text-shadow: 0 1px 2px #000; pointer-events: none; }
.inv-tier { position: absolute; right: 2px; bottom: 1px; font-size: 9px; font-weight: 700; color: #cbd5e1;
  text-shadow: 0 1px 2px #000; pointer-events: none; }
.inv-hint { font-size: 10px; color: rgba(229,231,235,.7); text-shadow: 0 1px 2px #000; }
.inv-hud.open .inv-hint { color: rgba(229,231,235,.95); }
.inv-toast { position: relative; pointer-events: none; padding: 3px 10px; border-radius: 999px;
  background: rgba(3,7,18,.78); color: #fff; font-size: 12px; font-weight: 600; line-height: 1.2;
  text-shadow: 0 1px 2px #000; box-shadow: 0 4px 6px -1px rgba(0,0,0,.4);
  opacity: 0; transition: opacity .4s ease; }
.inv-toast.show { opacity: 1; transition: none; }
`;

export function createInventoryHud(root, { selectSlot, cursorPick, throwFromCursor, getCursor } = {}) {
  injectStyleOnce(root, 'data-sand-inventory', STYLE);

  let open = false;
  // Last-seen selected slot index + a fade timer, for the name-on-select label. -1
  // (no prior render) suppresses the label on the very first update().
  let lastSelected = -1;
  let toastTimer = 0;
  // The slot a pointerdown started on, so a press-drag-release can place onto a
  // DIFFERENT slot (and we avoid double-firing when down/up land on the same slot).
  let downSlot = -1;
  let downOnSlot = false; // did the active press start on a slot (vs the backdrop)?
  // Latest pointer position, kept current so the carried chip can be placed the
  // instant it appears — a freshly picked stack must not flash at (0,0) before the
  // first move. Updated by onMove and by the pick pointerdown.
  let ptrX = 0, ptrY = 0;

  // Darkened full-window backdrop BEHIND the panels (Minecraft style). Clicking it
  // while carrying throws the carried stack out into the world.
  const backdrop = document.createElement('div');
  backdrop.className = 'inv-backdrop';

  const hud = document.createElement('div');
  hud.className = 'inv-hud';

  // Stop HUD pointer events from reaching the window-level game input (which would
  // latch mouse buttons / mine through the panel) — same guard as toolPalette. The
  // backdrop stops them too: its clicks are throws, not game actions.
  swallowEvents(hud);
  swallowEvents(backdrop);

  const grid = document.createElement('div');
  grid.className = 'inv-grid';
  const bar = document.createElement('div');
  bar.className = 'inv-bar';
  const hint = document.createElement('div');
  hint.className = 'inv-hint';
  hint.textContent = 'E — inventory · Q — size · 1–9 / scroll — select';
  // Minecraft-style "selected item name" label: fades in above the hotbar on a
  // selection change, then fades out after ~2s. Sits between the grid and the bar so
  // it reads as floating just above the hotbar.
  const toast = document.createElement('div');
  toast.className = 'inv-toast';
  hud.append(grid, toast, bar, hint);

  // The carried stack, rendered as a small floating swatch/chip that follows the
  // pointer while the grid is open. It is appended to document.body (NOT the shadow
  // root) so position:fixed anchors to the real viewport — a CSS transform/filter on
  // the <sand-game> host or an ancestor would otherwise capture position:fixed and
  // strand it in the top-left, decoupled from clientX/clientY. Because it lives
  // outside the shadow root the injected <style> can't reach it, so it is styled with
  // INLINE styles only.
  const cursorItem = document.createElement('div');
  Object.assign(cursorItem.style, {
    position: 'fixed', left: '0', top: '0', zIndex: '2147483646', display: 'none',
    pointerEvents: 'none', width: '32px', height: '32px', marginLeft: '-16px', marginTop: '-16px',
    alignItems: 'center', justifyContent: 'center',
    filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.6))',
  });
  document.body.appendChild(cursorItem);

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
      el.appendChild(toolIcon(s.toolClass, s.toolTier, 28));
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

  // Render the carried stack into the body-appended floating element using INLINE
  // styles (the shadow <style> can't reach an element outside the shadow root). Mirrors
  // renderStack's swatch/count + tool-chip layout, just self-styled.
  function renderCursorInline(s) {
    if (!s) return;
    if (s.isTool) {
      cursorItem.appendChild(toolIcon(s.toolClass, s.toolTier, 30));
      if (s.toolTier > 0) {
        const t = document.createElement('span');
        Object.assign(t.style, {
          position: 'absolute', right: '-2px', bottom: '-2px', fontSize: '11px', fontWeight: '700',
          color: '#cbd5e1', textShadow: '0 1px 2px #000',
        });
        t.textContent = TIER[s.toolTier] || '';
        cursorItem.appendChild(t);
      }
    } else if (s.count > 0) {
      const sw = document.createElement('span');
      Object.assign(sw.style, {
        width: '28px', height: '28px', borderRadius: '4px',
        background: COLOR[s.material] || '#888', boxShadow: 'inset 2px 2px 0 rgba(255,255,255,.18)',
      });
      cursorItem.appendChild(sw);
      if (s.count > 1) {
        const c = document.createElement('span');
        Object.assign(c.style, {
          position: 'absolute', right: '-2px', bottom: '-2px', fontSize: '12px', fontWeight: '700',
          color: '#fff', textShadow: '0 1px 2px #000, 0 0 2px #000',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        });
        c.textContent = String(s.count);
        cursorItem.appendChild(c);
      }
    }
  }

  // Re-read the carried stack from the engine and refresh the floating element.
  // Called from update() and right after every action so the cursor stays in sync.
  function refreshCursor() {
    const c = getCursor?.() || null;
    cursorItem.replaceChildren();
    if (open && c) {
      renderCursorInline(c);
      cursorItem.style.left = ptrX + 'px';
      cursorItem.style.top = ptrY + 'px';
      cursorItem.style.display = 'flex';
    } else {
      cursorItem.style.display = 'none';
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
    ptrX = e.clientX; ptrY = e.clientY; // so the chip appears under the cursor at once
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

  // The carried element follows the pointer whenever the grid is open. Registered in
  // the CAPTURE phase (see setOpen): while open, the full-window backdrop and the hud
  // call stopPropagation() on every pointer event — including pointermove — so a
  // bubble-phase window listener would never fire and the chip would stay stranded at
  // (0,0). Capture runs top-down before the target's stopPropagation, so it still sees
  // every move.
  const onMove = (e) => {
    ptrX = e.clientX; ptrY = e.clientY;
    if (!open) return;
    cursorItem.style.left = ptrX + 'px';
    cursorItem.style.top = ptrY + 'px';
  };

  // The display name of a slot's contents: "Wood Pickaxe" for tools, "copper ore" for
  // materials, "Hand" for an empty slot (the implicit bare hand).
  const slotName = (s) => {
    if (!s) return 'Hand';
    if (s.isTool) return `${TIER_NAME[s.toolTier] || ''} ${TOOL_NAME[s.toolClass] || 'Tool'}`.trim();
    if (s.count > 0) return (NAME[s.material] || '').toLowerCase();
    return 'Hand';
  };

  // Flash the selected item's name above the hotbar, then fade it out after ~2s. The
  // .show class snaps it to full opacity (transition:none); dropping .show after the
  // timer lets the base .4s opacity transition fade it back out.
  function showToast(name) {
    toast.textContent = name;
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.classList.remove('show'); toastTimer = 0; }, 2000);
  }

  // Per-slot content signature so update() only rebuilds the slots whose stack
  // actually changed (selection highlight is a cheap class toggle either way).
  const slotSig = new Array(SLOTS).fill(null);

  function update(inv) {
    if (inv && inv.slots) {
      const sel = inv.selected;
      if (lastSelected >= 0 && sel !== lastSelected) showToast(slotName(inv.slots[sel]));
      lastSelected = sel;
      for (let i = 0; i < SLOTS; i++) {
        const el = slots[i];
        if (!el) continue;
        const s = inv.slots[i] || { material: 0, isTool: false, count: 0 };
        el.classList.toggle('selected', i === inv.selected);
        const sig = `${s.isTool ? 1 : 0}:${s.material | 0}:${s.toolClass | 0}:${s.toolTier | 0}:${s.count | 0}`;
        if (sig === slotSig[i]) continue;
        slotSig[i] = sig;
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
    if (open) window.addEventListener('pointermove', onMove, true);
    else window.removeEventListener('pointermove', onMove, true);
    refreshCursor();
  };

  // cursorItem is intentionally NOT appended here — it lives on document.body (see above).
  root.append(backdrop, hud);
  return {
    el: hud,
    update,
    setOpen,
    toggleOpen() { setOpen(!open); },
    isOpen() { return open; },
    destroy() {
      window.removeEventListener('pointermove', onMove, true);
      if (toastTimer) { clearTimeout(toastTimer); toastTimer = 0; }
      backdrop.remove();
      hud.remove();
      cursorItem.remove(); // removes it from document.body
    },
  };
}
