// Framework-free survival inventory HUD. C++ owns every slot/cursor mutation;
// this module renders snapshots and forwards user intent.

import { MATERIALS, MAT_FLAGS, MF } from '../materials.generated.js';
import { MAT } from '../materials.js';
import { CRAFT_INGREDIENT, ITEM_KIND, INV_HOTBAR, INV_SLOTS } from '../wasmBridge/abi.generated.js';
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
const TOOL_NAME = { 1: 'Mining Tool', 2: 'Mining Tool', 3: 'Mining Tool', 5: 'Mining Tool' };
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

const SPECIAL_ART = {
  [ITEM_KIND.BOW]: [
    '...WW.......','..WW.S......','.WW..S......','WW...S......','W....S......','W.....S.....',
    'W.....S.....','W....S......','WW...S......','.WW..S......','..WW.S......','...WW.......',
  ],
  [ITEM_KIND.ARROW]: [
    '............','.........M..','..........M.','...........M','HHHHHHHHMMMM','HHHHHHHHMMMM',
    'HHHHHHHHMMMM','HHHHHHHHMMMM','...........M','..........M.','.........M..','............',
  ],
  [ITEM_KIND.BLAST_GUN]: [
    '............','..DDDDDD....','.DGGGGGGDDD.','DGGGGGGGGGDD','DGGSSGGGGGDD','.DDDDDDDDDD.',
    '....DDDD....','....DWW.....','....WWW.....','....WWW.....','.....WW.....','............',
  ],
  [ITEM_KIND.DYNAMITE_SATCHEL]: [
    '............','....FF......','...FSS......','..RRRRRR....','.RCCCCCCR...','.RCRCCRCR...',
    '.RCCCCCCR...','.RRRRRRRR...','...HHHH.....','..HH..HH....','..HH..HH....','............',
  ],
  [ITEM_KIND.BORE_CANNON]: [
    '............','..NNNNNNN...','.NAAAAAAANN.','NNAAIIIINNN.','.NNNNNNNNN..','...NNNNN....',
    '....NHH.....','....HHH.....','....HH......','.....H......','............','............',
  ],
  [ITEM_KIND.ACID_MORTAR]: [
    '............','....PPPPPP..','...PAAAAAAP.','..PPAAAAAPP.','.PPPPPPPPP..','...PPPPP....',
    '....PHH.....','....HHH.....','....HH......','.....H......','............','............',
  ],
  [ITEM_KIND.CLUSTER_LAUNCHER]: [
    '............','...BBBBBBB..','..BOOOOOOBB.','.BBOOOOOBBB.','..BBBBBBBB..','....BBBB....',
    '....BHH.....','....HHH.....','....HH......','.....H......','............','............',
  ],
  [ITEM_KIND.MINIGUN]: [
    '............','....NNNN....','..NNGGGGNN..','.NNGGGGNNMMM','NNGGGGNNMMMM','.NNNNNNNMMM.',
    '...NNHH.....','....HH......','....HH......','.....H......','............','............',
  ],
};
const SPECIAL_COLOR = {
  H: '#9b6a39', W: '#9b6a39', S: '#f8e7a1', M: '#c9d0d6',
  D: '#26313b', G: '#e3a83c', R: '#5d211f', C: '#d94a37',
  F: '#ff9f32', N: '#273b48', A: '#3dd5cd', I: '#d9fff5',
  P: '#324737', B: '#3e315c', O: '#f2a63d',
};
const isSpecialKind = (kind) => kind === ITEM_KIND.BOW || kind === ITEM_KIND.ARROW
  || kind === ITEM_KIND.BLAST_GUN || kind === ITEM_KIND.DYNAMITE_SATCHEL
  || kind === ITEM_KIND.BORE_CANNON || kind === ITEM_KIND.ACID_MORTAR
  || kind === ITEM_KIND.CLUSTER_LAUNCHER || kind === ITEM_KIND.MINIGUN;
function specialIcon(kind, sizePx) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12'); svg.setAttribute('width', String(sizePx)); svg.setAttribute('height', String(sizePx));
  svg.setAttribute('shape-rendering', 'crispEdges'); svg.style.display = 'block';
  const grid = SPECIAL_ART[kind] || [];
  for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[r].length; c++) {
    const ch = grid[r][c]; if (ch === '.') continue;
    const rect = document.createElementNS(SVG_NS, 'rect'); rect.setAttribute('x', String(c)); rect.setAttribute('y', String(r));
    rect.setAttribute('width', '1.02'); rect.setAttribute('height', '1.02');
    rect.setAttribute('fill', SPECIAL_COLOR[ch] || '#9b6a39'); svg.appendChild(rect);
  }
  return svg;
}

const STYLE = `
.inv-backdrop { position: fixed; inset: 0; z-index: 71; display: none;
  background: rgba(0,0,0,.55); pointer-events: auto; }
.inv-backdrop.open { display: block; }
.inv-hud { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 72;
  display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none;
  font-family: ui-monospace,"SFMono-Regular",Menlo,monospace; max-width: calc(100vw - 1rem); }
.inv-modal { display:none; grid-template-columns:auto minmax(190px,250px); gap:8px; align-items:stretch; pointer-events:auto; }
.inv-hud.open .inv-modal { display:grid; }
.inv-grid { display:grid; grid-template-columns: repeat(9, 1fr); gap: 4px; padding: 10px; align-content:center;
  background:#252b31; border:3px solid #0a0c0f; border-radius:0;
  box-shadow:inset 0 0 0 2px #59636c,6px 6px 0 rgba(0,0,0,.45); }
.inv-bar { display: grid; grid-template-columns: repeat(9, 1fr); gap: 4px; padding: 6px; pointer-events: auto;
  background:#252b31; border:3px solid #0a0c0f; border-radius:0;
  box-shadow:inset 0 0 0 2px #59636c,5px 5px 0 rgba(0,0,0,.35); }
.inv-slot { position: relative; width: 40px; height: 40px; box-sizing: border-box; border-radius:0;
  border:2px solid #0d1013; background:#161a1e; box-shadow:inset 2px 2px 0 #3c444b; cursor:pointer;
  display: flex; align-items: center; justify-content: center; overflow: hidden; user-select: none;
  padding:0; color:inherit; font:inherit; }
.inv-slot:hover { border-color:#9ba5ae; }
.inv-slot:focus-visible,.craft-recipe:focus-visible { outline:3px solid #fff; outline-offset:2px; }
.inv-slot.selected { border-color:#f0d465; box-shadow:inset 2px 2px 0 #fff1a0,0 0 0 1px #17140a; }
.inv-swatch { width:26px; height:26px; border-radius:0; box-shadow:inset 3px 3px 0 rgba(255,255,255,.18),inset -3px -3px 0 rgba(0,0,0,.2); }
.inv-count { position: absolute; right: 2px; bottom: 1px; font-size: 11px; font-weight: 700; color: #fff;
  text-shadow: 0 1px 2px #000, 0 0 2px #000; pointer-events: none; }
.inv-num { position: absolute; left: 3px; top: 1px; font-size: 9px; font-weight: 700; color: rgba(255,255,255,.6);
  text-shadow: 0 1px 2px #000; pointer-events: none; }
.inv-tier { position: absolute; right: 2px; bottom: 1px; font-size: 9px; font-weight: 700; color: #cbd5e1;
  text-shadow: 0 1px 2px #000; pointer-events: none; }
.inv-hint { font-size:10px; color:rgba(229,231,235,.75); text-shadow:2px 2px 0 #000; letter-spacing:.04em; }
.inv-hud.open .inv-hint { color: rgba(229,231,235,.95); }
.inv-toast { position: relative; pointer-events: none; padding:5px 10px; border-radius:0; border:2px solid #090b0e;
  background: rgba(3,7,18,.78); color: #fff; font-size: 12px; font-weight: 600; line-height: 1.2;
  text-shadow: 0 1px 2px #000; box-shadow: 0 4px 6px -1px rgba(0,0,0,.4);
  opacity: 0; transition: opacity .4s ease; }
.inv-toast.show { opacity: 1; transition: none; }
.craft-panel { min-width:190px; max-height:210px; overflow:auto; padding:9px; color:#fff; background:#252b31;
  border:3px solid #0a0c0f; box-shadow:inset 0 0 0 2px #59636c,6px 6px 0 rgba(0,0,0,.45); }
.craft-title { margin:1px 2px 8px; font-size:11px; letter-spacing:.16em; color:#f0d465; }
.craft-list { display:grid; gap:6px; }
.craft-recipe { display:grid; grid-template-columns:34px 1fr auto; gap:7px; align-items:center; padding:6px;
  border:2px solid #0c0e11; border-radius:0; background:#171b20; color:#fff; text-align:left; cursor:pointer;
  box-shadow:inset 2px 2px 0 #3f474f; font:700 10px/1.15 ui-monospace,monospace; }
.craft-recipe:hover:not(:disabled) { border-color:#e5ca63; background:#2c322f; }
.craft-recipe:disabled { color:#777f87; cursor:default; filter:saturate(.4); }
.craft-output { width:30px; height:30px; display:grid; place-items:center; background:#0e1114; border:2px solid #08090b; }
.craft-name,.craft-cost { display:block; }.craft-name { color:inherit; }.craft-cost { margin-top:3px; color:#aeb5bc; font-size:8px; font-weight:600; }
.craft-recipe:disabled .craft-cost { color:#686f76; }.craft-count { color:#f0d465; font-size:9px; }
@media (max-width:720px) {
  .inv-modal { grid-template-columns:1fr; max-height:62vh; overflow:auto; }
  .craft-panel { max-height:155px; }
  .inv-slot { width:34px; height:34px; }
}
@media (max-width:380px) { .inv-slot { width:30px; height:30px; } .inv-grid { gap:2px; padding:6px; } .inv-bar { gap:2px; padding:4px; } }
`;

export function createInventoryHud(root, { selectSlot, cursorPick, throwFromCursor, getCursor, recipes = [], craft } = {}) {
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
  // Latest pointer position prevents a newly carried stack flashing at (0,0).
  let ptrX = 0, ptrY = 0;
  let selectedSlot = 0;
  let previousFocus = null;
  const focusSurface = () => root.querySelector('.sg-sim')?.focus({ preventScroll: true });

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
  const modal = document.createElement('div'); modal.className = 'inv-modal';
  const craftPanel = document.createElement('div'); craftPanel.className = 'craft-panel';
  const craftTitle = document.createElement('div'); craftTitle.className = 'craft-title'; craftTitle.textContent = 'CRAFTING';
  const craftList = document.createElement('div'); craftList.className = 'craft-list';
  craftPanel.append(craftTitle, craftList); modal.append(grid, craftPanel);
  const bar = document.createElement('div');
  bar.className = 'inv-bar';
  const hint = document.createElement('div');
  hint.className = 'inv-hint';
  hint.textContent = 'E / Esc — close · Shift+Enter — split stack · Delete — drop carried stack';
  // Minecraft-style "selected item name" label: fades in above the hotbar on a
  // selection change, then fades out after ~2s. Sits between the grid and the bar so
  // it reads as floating just above the hotbar.
  const toast = document.createElement('div');
  toast.className = 'inv-toast';
  toast.setAttribute('aria-live', 'polite');
  hud.append(modal, toast, bar, hint);

  // Append the carried stack to document.body so fixed positioning stays relative
  // to the viewport even when the Web Component has a transformed ancestor. It
  // uses inline styles because shadow-root styles cannot reach it.
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
    const el = document.createElement('button');
    el.type = 'button';
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
    if (isSpecialKind(s.itemKind)) {
      el.appendChild(specialIcon(s.itemKind, 28));
      if (s.count > 1) { const c = document.createElement('span'); c.className = 'inv-count'; c.textContent = String(s.count); el.appendChild(c); }
    } else if (s.isTool || s.itemKind === ITEM_KIND.MINING_TOOL) {
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

  // Render the body-appended carried stack with inline styles.
  function renderCursorInline(s) {
    if (!s) return;
    if (isSpecialKind(s.itemKind)) {
      cursorItem.appendChild(specialIcon(s.itemKind, 30));
    } else if (s.isTool || s.itemKind === ITEM_KIND.MINING_TOOL) {
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
      // Prevent the button's default focus transfer so WASD/hotkeys keep
      // belonging to the simulation after a mouse selection.
      e.preventDefault();
      downSlot = -1; downOnSlot = false;
      if (i < HOTBAR && e.button === 0) {
        selectSlot?.(i);
        focusSurface();
      }
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

  // Pointer actions run on pointerdown; click handles keyboard/programmatic use.
  hud.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const i = idxOf(e.target);
    if (i < 0) return;
    if (!open) {
      if (i < HOTBAR) {
        selectSlot?.(i);
        focusSurface();
      }
      return;
    }
    cursorPick?.(i, e.shiftKey);
    refreshCursor();
  });

  hud.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape' || e.key.toLowerCase() === 'e') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key === 'Delete' && hasCursor()) {
      e.preventDefault();
      throwFromCursor?.(!e.shiftKey);
      refreshCursor();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...hud.querySelectorAll('.inv-slot, .craft-recipe:not(:disabled)')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && root.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && root.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
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

  // Capture pointer movement before the HUD's propagation guards so the carried
  // element continues to follow the pointer while the grid is open.
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
    if (s.itemKind === ITEM_KIND.DYNAMITE_SATCHEL) return 'Dynamite Satchel';
    if (s.itemKind === ITEM_KIND.BORE_CANNON) return 'Bore Cannon';
    if (s.itemKind === ITEM_KIND.ACID_MORTAR) return 'Acid Mortar';
    if (s.itemKind === ITEM_KIND.CLUSTER_LAUNCHER) return 'Cluster Launcher';
    if (s.itemKind === ITEM_KIND.MINIGUN) return 'Minigun';
    if (s.itemKind === ITEM_KIND.BLAST_GUN) return 'Blast Gun';
    if (s.itemKind === ITEM_KIND.BOW) return 'Bow';
    if (s.itemKind === ITEM_KIND.ARROW) return 'Arrow';
    if (s.isTool) return `${TIER_NAME[s.toolTier] || ''} ${TOOL_NAME[s.toolClass] || 'Tool'}`.trim();
    if (s.count > 0) return (NAME[s.material] || '').toLowerCase();
    return 'Hand';
  };

  // Flash the selected item name, then let the base opacity transition fade it.
  function showToast(name) {
    toast.textContent = name;
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.classList.remove('show'); toastTimer = 0; }, 2000);
  }

  // Per-slot content signature so update() only rebuilds the slots whose stack
  // actually changed (selection highlight is a cheap class toggle either way).
  const slotSig = new Array(SLOTS).fill(null);

  const recipeName = (r) => {
    if (r.outputKind === ITEM_KIND.MINING_TOOL) return `${TIER_NAME[r.outputTier] || ''} Mining Tool`.trim();
    if (r.outputKind === ITEM_KIND.DYNAMITE_SATCHEL) return 'Dynamite Satchel';
    if (r.outputKind === ITEM_KIND.BORE_CANNON) return 'Bore Cannon';
    if (r.outputKind === ITEM_KIND.ACID_MORTAR) return 'Acid Mortar';
    if (r.outputKind === ITEM_KIND.CLUSTER_LAUNCHER) return 'Cluster Launcher';
    if (r.outputKind === ITEM_KIND.MINIGUN) return 'Minigun';
    if (r.outputKind === ITEM_KIND.BLAST_GUN) return 'Blast Gun';
    if (r.outputKind === ITEM_KIND.BOW) return 'Bow';
    if (r.outputKind === ITEM_KIND.ARROW) return `${r.outputCount} Arrows`;
    return `${r.outputCount > 1 ? `${r.outputCount} ` : ''}${NAME[r.outputMaterial] || 'Material'}`;
  };
  const ingredientName = (ingredient) => {
    if (ingredient.kind === CRAFT_INGREDIENT.MATERIAL) return NAME[ingredient.value] || 'Material';
    if (ingredient.value === MF.plantWood) return 'Wood';
    if (ingredient.value === MF.plantLeaf) return 'Fiber';
    return 'Material';
  };
  const available = (inv, ingredient) => (inv?.slots || []).reduce((sum, slot) => {
    if (!slot?.count || slot.itemKind !== ITEM_KIND.MATERIAL) return sum;
    if (ingredient.kind === CRAFT_INGREDIENT.MATERIAL) return sum + (slot.material === ingredient.value ? slot.count : 0);
    if (ingredient.value === MF.plantWood)
      return sum + (slot.material === MAT.DRIFTWOOD || (MAT_FLAGS[slot.material] & MF.plantWood) !== 0 ? slot.count : 0);
    if (ingredient.value === MF.plantLeaf)
      return sum + (slot.material === MAT.VINE || (MAT_FLAGS[slot.material] & MF.plantLeaf) !== 0 ? slot.count : 0);
    return sum + ((MAT_FLAGS[slot.material] & ingredient.value) !== 0 ? slot.count : 0);
  }, 0);
  const recipeEls = recipes.map((recipe) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'craft-recipe';
    const output = document.createElement('span'); output.className = 'craft-output';
    renderStack(output, { itemKind: recipe.outputKind, material: recipe.outputMaterial, toolClass: 5, toolTier: recipe.outputTier, isTool: recipe.outputKind === ITEM_KIND.MINING_TOOL, count: recipe.outputCount });
    const text = document.createElement('span');
    const name = document.createElement('span'); name.className = 'craft-name'; name.textContent = recipeName(recipe);
    const cost = document.createElement('span'); cost.className = 'craft-cost';
    cost.textContent = recipe.ingredients.map((i) => `${i.count} ${ingredientName(i)}`).join(' + ');
    text.append(name, cost);
    const count = document.createElement('span'); count.className = 'craft-count'; count.textContent = 'MAKE';
    button.append(output, text, count);
    button.addEventListener('click', (event) => craft?.(recipe.id, event.shiftKey));
    craftList.appendChild(button);
    return { recipe, button, count };
  });

  function update(inv) {
    if (inv && inv.slots) {
      const sel = inv.selected;
      selectedSlot = sel;
      if (lastSelected >= 0 && sel !== lastSelected) showToast(slotName(inv.slots[sel]));
      lastSelected = sel;
      for (let i = 0; i < SLOTS; i++) {
        const el = slots[i];
        if (!el) continue;
        const s = inv.slots[i] || { material: 0, isTool: false, count: 0 };
        el.classList.toggle('selected', i === inv.selected);
        if (i < HOTBAR) el.setAttribute('aria-pressed', String(i === inv.selected));
        const contents = i >= HOTBAR && !s.count ? 'Empty' : slotName(s);
        const countLabel = s.count > 1 ? `, ${s.count}` : '';
        el.setAttribute('aria-label', `${i < HOTBAR ? `Hotbar ${i + 1}` : `Inventory slot ${i + 1}`}: ${contents}${countLabel}${i === inv.selected ? ', selected' : ''}`);
        const sig = `${s.itemKind | 0}:${s.isTool ? 1 : 0}:${s.material | 0}:${s.toolClass | 0}:${s.toolTier | 0}:${s.count | 0}`;
        if (sig === slotSig[i]) continue;
        slotSig[i] = sig;
        el.replaceChildren();
        if (i < HOTBAR) {
          const n = document.createElement('span'); n.className = 'inv-num';
          n.textContent = String(i + 1); el.appendChild(n);
        }
        renderStack(el, s);
        if (s.itemKind === ITEM_KIND.DYNAMITE_SATCHEL) el.title = 'Dynamite Satchel — LMB throws a bouncing fused charge';
        else if (s.itemKind === ITEM_KIND.BORE_CANNON) el.title = 'Bore Cannon — hold LMB to charge a terrain-cutting beam';
        else if (s.itemKind === ITEM_KIND.ACID_MORTAR) el.title = 'Acid Mortar — LMB lobs a corrosive shell';
        else if (s.itemKind === ITEM_KIND.CLUSTER_LAUNCHER) el.title = 'Cluster Launcher — LMB fires a heavy bomb that splits into three mini dynamites';
        else if (s.itemKind === ITEM_KIND.MINIGUN) el.title = 'Minigun — hold LMB for a stream of tiny explosive rounds';
        else if (s.itemKind === ITEM_KIND.BLAST_GUN) el.title = 'Blast Gun — LMB fires explosive rounds';
        else if (s.itemKind === ITEM_KIND.BOW) el.title = 'Bow — hold to charge, release to fire';
        else if (s.itemKind === ITEM_KIND.ARROW) el.title = `Arrows ×${s.count}`;
        else if (s.isTool) {
          el.title = `${TIER_NAME[s.toolTier] || ''} ${TOOL_NAME[s.toolClass] || 'Tool'}`.trim();
        } else if (s.count > 0) {
          el.title = `${(NAME[s.material] || '').toLowerCase()} ×${s.count}`;
        } else {
          el.title = '';
        }
      }
      for (const row of recipeEls) {
        const can = row.recipe.ingredients.every((ingredient) => available(inv, ingredient) >= ingredient.count);
        row.button.disabled = !can;
        row.count.textContent = can ? 'MAKE' : 'NEED';
      }
    }
    refreshCursor();
  }

  const setOpen = (v) => {
    const next = !!v;
    if (next === open) return;
    if (next) previousFocus = root.activeElement || document.activeElement;
    open = next;
    hud.classList.toggle('open', open);
    backdrop.classList.toggle('open', open);
    if (open) {
      hud.setAttribute('role', 'dialog');
      hud.setAttribute('aria-modal', 'true');
      hud.setAttribute('aria-label', 'Inventory and crafting');
    } else {
      hud.removeAttribute('role');
      hud.removeAttribute('aria-modal');
      hud.removeAttribute('aria-label');
    }
    if (!open) { downSlot = -1; downOnSlot = false; }
    if (open) window.addEventListener('pointermove', onMove, true);
    else window.removeEventListener('pointermove', onMove, true);
    refreshCursor();
    if (open) {
      slots[selectedSlot]?.focus({ preventScroll: true });
    } else if (previousFocus?.isConnected) {
      previousFocus.focus?.({ preventScroll: true });
      previousFocus = null;
    }
  };

  // cursorItem is intentionally NOT appended here — it lives on document.body.
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
      cursorItem.remove();
    },
  };
}
