// Framework-free survival inventory HUD. C++ owns every slot/cursor mutation;
// this module renders snapshots and forwards user intent.

import { EQUIPMENT_BY_ID } from '../content/equipment.js';
import { gearIcon } from './gearIcon.js';
import { MATERIALS, MAT_CRAFT_FLAGS, MF } from '../materials.generated.js';
import { CRAFT_INGREDIENT, ITEM_KIND, INV_HOTBAR, INV_SLOTS } from '../wasmBridge/abi.generated.js';
import { injectStyleOnce, packedToRgb, swallowEvents } from './uiShared.js';
import { createInventoryPools, POOL_NAMES, poolIcon } from './inventoryPools.js';
import { createItemTooltip } from './itemTooltip.js';
import { gearDetails } from './gearDetails.js';

const HOTBAR = INV_HOTBAR;
const SLOTS = INV_SLOTS;

// Per-material css color + name so a swatch matches the in-world pixel exactly.
const COLOR = {};
const NAME = {};
for (const m of MATERIALS) {
  COLOR[m.id] = packedToRgb(m.color >>> 0);
  NAME[m.id] = m.name === 'TNT' ? 'TNT' : m.name.toLowerCase().replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
}
// Tool names/tier letters by ToolClass id (mirrors enum ToolClass: 1 pick, 2 axe,
// 3 shovel, 5 dig). There is no hand tool item — bare hand is an empty slot.
const TOOL_NAME = { 1: 'Mining Tool', 2: 'Mining Tool', 3: 'Mining Tool', 5: 'Mining Tool' };
const TIER = ['', 'W', 'S', 'I', 'G'];
const TIER_NAME = ['', 'Wood', 'Stone', 'Iron', 'Gold'];

// Tool icons use tier-tinted metal, handle, dark casing, and cyan emitters.
// Crisp SVG pixels keep silhouettes legible at hotbar size.
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
  5: [ // mining emitter with paired rails and a pistol grip
    '............',
    '..DDDD......',
    '.DMMMMDDCCC.',
    '.DMMMMMDD.CC',
    '.DMMMMMDD.CC',
    '..DDDDDDCCC.',
    '...DDDD.....',
    '...DDD......',
    '...DDD......',
    '....DD......',
    '............',
    '............',
  ],
};
const TOOL_HANDLE = '#9b6a39'; // wood
// Metal-head tint indexed by toolTier (0 = generic, 1 wood, 2 stone, 3 iron, 4 gold).
const TOOL_HEAD = ['#c9ccd4', '#b07a44', '#9aa0a8', '#dfe4ec', '#f2c734'];

const SVG_NS = 'http://www.w3.org/2000/svg';
const _toolIconCache = new Map();
function buildToolIcon(toolClass, toolTier, sizePx) {
  const grid = toolClass === 5 ? PICKAXE_ART : TOOL_ART[toolClass];
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
      if (!'HMDC'.includes(ch)) continue;
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(c));
      rect.setAttribute('y', String(r));
      // Bleed each cell by a hair so crisp-edges scaling never leaves seams.
      rect.setAttribute('width', '1.02');
      rect.setAttribute('height', '1.02');
      rect.setAttribute('fill', ch === 'H' ? TOOL_HANDLE : ch === 'D' ? '#263b48' : ch === 'C' ? '#78eeee' : head);
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
  [ITEM_KIND.RESCUE_BEAM]: [
    '............','...NNNNNN...','..NAAAAAANN.','.NNAAIIAANNN','..NNNNNNNN..','....NNNN....',
    '....NHH.....','....HHH.....','....HH......','.....H......','............','............',
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
  || kind === ITEM_KIND.CLUSTER_LAUNCHER || kind === ITEM_KIND.MINIGUN
  || kind === ITEM_KIND.RESCUE_BEAM;
const isFiniteAmmoKind = (kind) => kind === ITEM_KIND.DYNAMITE_SATCHEL
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
  background:radial-gradient(circle at 50% 55%,rgba(8,11,14,.44),rgba(0,0,0,.78)); pointer-events:auto;
  backdrop-filter:blur(2px); }
.inv-backdrop.open { display: block; }
.inv-hud { position:absolute; left:50%; bottom:14px; transform:translateX(-50%); z-index:72;
  display:flex; flex-direction:column; align-items:center; gap:6px; pointer-events:none;
  font-family: ui-monospace,"SFMono-Regular",Menlo,monospace; max-width: calc(100vw - 1rem); }
.inv-modal { display:none; position:relative; grid-template-columns:auto minmax(210px,260px); gap:8px; align-items:stretch;
  padding:8px; pointer-events:auto; background:#101317; border:3px solid #080a0c;
  box-shadow:inset 0 0 0 2px #4c5660,8px 8px 0 rgba(0,0,0,.52); }
.inv-title { grid-column:1/-1; justify-self:start; padding:6px 10px;
  color:#17140a; background:#f0d465; border:2px solid #080a0c;
  font-size:9px; font-weight:900; letter-spacing:.14em; text-shadow:none; }
.inv-hud.open .inv-modal { display:grid; }
.inv-grid { display:grid; grid-template-columns:repeat(9,1fr); gap:5px; padding:10px; align-content:center;
  background:#252b31; border:2px solid #0a0c0f; border-radius:0;
  box-shadow:inset 0 0 0 2px #59636c; }
.inv-bar { position:relative; display:grid; grid-template-columns:repeat(9,1fr); gap:5px; padding:8px; pointer-events:auto;
  background:linear-gradient(#30373e,#22282e); border:3px solid #080a0c; border-radius:0;
  box-shadow:inset 0 0 0 2px #64707a,6px 6px 0 rgba(0,0,0,.48); }
.inv-bar::after { content:''; position:absolute; left:50%; top:-3px; width:34px; height:3px;
  transform:translateX(-50%); background:#f0d465; box-shadow:0 0 7px rgba(240,212,101,.35); }
.inv-slot { position:relative; width:46px; height:46px; box-sizing:border-box; border-radius:0;
  border:2px solid #0b0e11; background:linear-gradient(135deg,#1c2227,#111519); box-shadow:inset 2px 2px 0 #414b54; cursor:pointer;
  display: flex; align-items: center; justify-content: center; overflow: hidden; user-select: none;
  padding:0; color:inherit; font:inherit; }
.inv-slot::after { content:''; position:absolute; left:4px; right:4px; bottom:3px; height:1px; background:rgba(255,255,255,.07); }
.inv-slot > * { pointer-events:none; }
.inv-slot:hover { border-color:#9ba5ae; background:#22292f; transform:translateY(-1px); }
.inv-slot:focus-visible,.craft-recipe:focus-visible { outline:3px solid #fff; outline-offset:2px; }
.inv-slot.selected { z-index:1; border-color:#f0d465; transform:translateY(-2px);
  background:#292a24; box-shadow:inset 2px 2px 0 #fff1a0,0 0 0 1px #17140a,0 4px 10px rgba(240,212,101,.2); }
.inv-slot.inv-bag { border-color:#ad9860; background:#292b24; box-shadow:inset 0 0 0 1px #534d35,0 0 7px #d4b55530; }
.inv-slot.inv-bag:hover,.inv-slot.inv-bag.selected { border-color:#ffe589; box-shadow:inset 0 0 0 1px #b5a16b,0 0 10px #e1c66755; }
.inv-bag-label { position:absolute; bottom:2px; left:3px; font-size:7px; color:#e7d79c; }
.inv-swatch { width:30px; height:30px; border-radius:0;
  box-shadow:inset 3px 3px 0 rgba(255,255,255,.2),inset -3px -3px 0 rgba(0,0,0,.24),2px 2px 0 #090b0e; }
.inv-count { position:absolute; right:3px; bottom:2px; z-index:2; font-size:11px; font-weight:800; color:#fff;
  text-shadow: 0 1px 2px #000, 0 0 2px #000; pointer-events: none; }
.inv-num { position:absolute; left:3px; top:2px; z-index:2; min-width:11px; height:11px; display:grid; place-items:center;
  font-size:8px; font-weight:900; color:rgba(255,255,255,.72); background:rgba(4,6,8,.52);
  text-shadow: 0 1px 2px #000; pointer-events: none; }
.inv-tier { position:absolute; right:3px; bottom:2px; z-index:2; font-size:9px; font-weight:800; color:#cbd5e1;
  text-shadow: 0 1px 2px #000; pointer-events: none; }
.inv-hint { padding:3px 8px; font-size:9px; color:rgba(229,231,235,.7); background:rgba(9,12,15,.58);
  border-left:2px solid rgba(240,212,101,.48); border-right:2px solid rgba(240,212,101,.48);
  text-shadow:2px 2px 0 #000; letter-spacing:.06em; }
.inv-hud.open .inv-hint { color: rgba(229,231,235,.95); }
.inv-toast { position:absolute; left:50%; bottom:118px; transform:translateX(-50%); pointer-events:none; padding:6px 11px;
  border-radius:0; border:2px solid #090b0e; white-space:nowrap;
  background: rgba(3,7,18,.78); color: #fff; font-size: 12px; font-weight: 600; line-height: 1.2;
  text-shadow:0 1px 2px #000; box-shadow:inset 0 0 0 1px #4c5660,4px 4px 0 rgba(0,0,0,.4);
  opacity: 0; transition: opacity .4s ease; }
.inv-toast.show { opacity: 1; transition: none; }
.inv-hud.open .inv-toast { display:none; }
.craft-panel { min-width:0; max-height:238px; overflow:auto; padding:10px; color:#fff; background:#252b31;
  border:2px solid #0a0c0f; box-shadow:inset 0 0 0 2px #59636c; }
.craft-title { margin:1px 2px 9px; padding-bottom:7px; border-bottom:1px solid #59636c;
  font-size:11px; letter-spacing:.16em; color:#f0d465; }
.craft-list { display:grid; gap:6px; }
.craft-recipe { display:grid; grid-template-columns:34px minmax(0,1fr) auto; gap:7px; align-items:center; padding:6px;
  border:2px solid #0c0e11; border-radius:0; background:#171b20; color:#fff; text-align:left; cursor:pointer;
  box-shadow:inset 2px 2px 0 #3f474f; font:700 10px/1.15 ui-monospace,monospace; }
.craft-recipe:hover:not(:disabled) { border-color:#e5ca63; background:#2c322f; }
.craft-recipe:disabled { color:#777f87; cursor:default; filter:saturate(.4); }
.craft-output { width:30px; height:30px; display:grid; place-items:center; background:#0e1114; border:2px solid #08090b; }
.craft-name,.craft-cost { display:block; }.craft-name { color:inherit; }.craft-cost { margin-top:3px; color:#aeb5bc; font-size:8px; font-weight:600; }
.craft-recipe:disabled .craft-cost { color:#686f76; }.craft-count { color:#f0d465; font-size:9px; }
.inv-pools { grid-column:1/-1; min-width:0; padding:10px; color:#e7edf0; background:#252b31; border:2px solid #0a0c0f; }
.pool-controls[hidden],.pool-sorting[hidden],.pool-summary[hidden],.pool-empty[hidden] { display:none; }
.pool-heading-row { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.pool-sorting { margin-top:12px; font-size:12px; }.pool-sorting summary { cursor:pointer; padding:8px 0; }
.pool-sorting label { display:inline-flex; align-items:center; gap:8px; margin-right:8px; }
.pool-tabs,.pool-controls { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:8px; }
.inv-pools button,.inv-pools select { border:1px solid #59636c; background:#171b20; color:#e7edf0; padding:5px 7px; font:inherit; font-size:11px; cursor:pointer; }
.pool-tabs button { display:flex; gap:5px; align-items:center; }
.pool-tabs button[aria-pressed=true] { border-color:#f0d465; color:#f0d465; }
.inv-pools :disabled { opacity:.4; cursor:default; }
.inv-pools :focus-visible { outline:2px solid #f0d465; outline-offset:2px; }
.pool-help { margin:4px 0 8px; color:#b8c1c8; font-size:10px; line-height:1.5; }
.pool-controls { justify-content:space-between; font-size:11px; }
.pool-list { max-height:200px; overflow:auto; }
.pool-row { display:grid; grid-template-columns:20px 78px 18px minmax(110px,1fr) auto 28px 28px 45px; gap:6px; align-items:center; padding:7px 4px; font-size:11px; }
.pool-heading { margin:10px 0 5px; font-size:17px; color:#f0d465; }
.pool-summary { color:#b8c1c8; font-size:11px; margin:0 0 14px; }
.pool-status { display:flex; align-items:center; gap:3px; font-size:9px; color:#c5dfa1; }
.pool-excluded .pool-status { color:#abb1ba; }
.pool-rank { color:#d4bb73; text-align:center; }.pool-swatch { width:16px; height:16px; border:1px solid #111; }
.pool-properties { display:block; font-size:9px; color:#abb1ba; margin-top:4px; line-height:1.5; }
.inv-modal-header { grid-column:1/-1; display:flex; justify-content:space-between; gap:12px; align-items:center; }
.inv-modal-header button,.inv-open-button { color:#f0d465; background:#20252b; border:1px solid #887849; padding:6px 10px; font:inherit; font-size:11px; cursor:pointer; pointer-events:auto; }
.inv-bag-back { display:none; }.bag-open .inv-bag-back { display:block; }
.bag-open .inv-grid,.bag-open .craft-panel { display:none; }
.bag-open .inv-modal { width:min(760px,calc(100vw - 32px)); box-sizing:border-box; grid-template-columns:minmax(0,1fr); }
.bag-open .pool-list { max-height:min(340px,40vh); }
.pool-row button { padding:4px; }.pool-count { font-variant-numeric:tabular-nums; }
.pool-excluded .pool-material { color:#929ca5; }.pool-current { background:#383b30; }
.pool-row input { accent-color:#f0d465; }.inv-pool-mark { position:absolute; right:2px; top:1px; font-size:8px; color:#f0d465; }
.inv-pool-active { max-width:100%; color:#f0d465; background:#101317; padding:4px 8px; font-size:10px; text-align:center; }
.inv-hud.open { max-height:calc(100vh - 60px); }.inv-hud.open .inv-modal { min-height:0; overflow:auto; }
@media (max-width:800px) {
  .inv-modal { grid-template-columns:minmax(0,1fr); width:calc(100vw - 24px); box-sizing:border-box; max-height:62vh; overflow:auto; }
  .inv-grid { grid-template-columns:repeat(9,minmax(0,1fr)); gap:3px; padding:6px; min-width:0; }
  .inv-grid .inv-slot { width:100%; height:auto; aspect-ratio:1; }
  .inv-bar { gap:3px; padding:6px; }
  .craft-panel { max-height:155px; }
  .inv-slot { width:34px; height:34px; }
}
@media (max-width:380px) { .inv-slot { width:30px; height:30px; } .inv-grid { gap:2px; padding:6px; } .inv-bar { gap:2px; padding:5px; } }
`;

export function createInventoryHud(root, { selectSlot, cursorPick, throwFromCursor, getCursor, recipes = [], craft, poolAction, onOpenChange, managed = false } = {}) {
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
  let dragBag = false;
  let pressedBag = 0, clickedBag = null;
  // Latest pointer position prevents a newly carried stack flashing at (0,0).
  let ptrX = 0, ptrY = 0;
  let selectedSlot = 0;
  let snapshot = null;
  const tooltips = createItemTooltip(root, { carrying: () => !!getCursor?.() });
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
  const title = document.createElement('div'); title.className = 'inv-title'; title.textContent = 'FIELD INVENTORY';
  const header = document.createElement('div'); header.className = 'inv-modal-header';
  const back = document.createElement('button'); back.type = 'button'; back.className = 'inv-bag-back'; back.textContent = '← Inventory';
  back.addEventListener('click', () => { hud.classList.remove('bag-open'); title.textContent = 'FIELD INVENTORY'; slots[selectedSlot]?.focus(); });
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close ×'; close.setAttribute('aria-label', 'Close inventory');
  close.addEventListener('click', () => setOpen(false));
  header.append(back, title, close); modal.append(header);
  const craftPanel = document.createElement('div'); craftPanel.className = 'craft-panel';
  const craftTitle = document.createElement('div'); craftTitle.className = 'craft-title'; craftTitle.textContent = 'Crafting';
  const craftList = document.createElement('div'); craftList.className = 'craft-list';
  craftPanel.append(craftTitle, craftList); modal.append(grid, craftPanel);
  const pools = createInventoryPools({ root, poolAction, tooltips }); modal.append(pools.el);
  if (managed) {
    const bagBack = document.createElement('button'); bagBack.type = 'button'; bagBack.className = 'inv-bag-return'; bagBack.textContent = '← Back to items';
    bagBack.addEventListener('click', () => { hud.classList.remove('bag-open'); slots[selectedSlot]?.focus(); });
    pools.el.prepend(bagBack);
  }
  const bar = document.createElement('div');
  bar.className = 'inv-bar';
  bar.setAttribute('aria-label', 'Player loadout');
  const hint = document.createElement('div');
  hint.className = 'inv-hint';
  const closedHint = 'Double-click a bag to open · E — inventory · 1—9 — select';
  const openHint = 'Double-click bag — open · Click / drag — move · Esc — close';
  hint.textContent = closedHint;
  // Minecraft-style "selected item name" label: fades in above the hotbar on a
  // selection change, then fades out after ~2s. Sits between the grid and the bar so
  // it reads as floating just above the hotbar.
  const toast = document.createElement('div');
  toast.className = 'inv-toast';
  toast.setAttribute('aria-live', 'polite');
  const poolActive = document.createElement('div'); poolActive.className = 'inv-pool-active'; poolActive.hidden = true;
  const openButton = document.createElement('button'); openButton.type = 'button'; openButton.className = 'inv-open-button';
  openButton.textContent = 'Inventory · E'; openButton.addEventListener('click', () => setOpen(!open));
  hud.append(modal, toast, poolActive, bar, openButton, hint);
  const packHeading = document.createElement('div'); packHeading.className = 'inv-pack-heading';
  const packTitle = document.createElement('h2'); packTitle.textContent = 'Items';
  const capacity = document.createElement('span'); capacity.className = 'inv-capacity';
  packHeading.append(packTitle, capacity);
  if (managed) hud.prepend(packHeading);
  if (managed) {
    const bags = document.createElement('div'); bags.className = 'inv-bag-shortcuts';
    for (const [index, name] of ['Materials', 'Powders', 'Liquids'].entries()) {
      const button = document.createElement('button'); button.type = 'button';
      button.append(poolIcon(index + 1, 18), document.createTextNode(name));
      button.setAttribute('aria-label', `Open ${name.toLowerCase()} bag`);
      button.addEventListener('click', () => openBag(index + 1)); bags.append(button);
    }
    hud.append(bags);
  }

  // Append the carried stack to document.body so fixed positioning stays relative
  // to the viewport even when the Web Component has a transformed ancestor. It
  // uses inline styles because shadow-root styles cannot reach it.
  const cursorItem = document.createElement('div');
  cursorItem.className = 'inv-cursor'; cursorItem.setAttribute('aria-hidden', 'true');
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
    tooltips.bind(el, () => describeSlot(index));
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
    if (s.pool) {
      el.append(poolIcon(s.pool));
      const mark = document.createElement('span'); mark.className = 'inv-pool-mark'; mark.textContent = '∞'; el.append(mark);
      if (s.count > 0) {
        const c = document.createElement('span'); c.className = 'inv-count';
        c.textContent = s.count >= 10000 ? `${Math.floor(s.count / 1000)}k` : String(s.count); el.append(c);
      }
    } else if (s.itemKind === ITEM_KIND.GEAR && s.count) {
      el.append(gearIcon(s.definitionId));
      if (s.count > 1) {
        const count = document.createElement('span'); count.className = 'inv-count'; count.textContent = s.count; el.append(count);
      }
    } else if (isSpecialKind(s.itemKind)) {
      el.appendChild(specialIcon(s.itemKind, 32));
      if (s.count > 1 || isFiniteAmmoKind(s.itemKind)) {
        const c = document.createElement('span'); c.className = 'inv-count';
        c.textContent = String(s.count); el.appendChild(c);
      }
    } else if (s.isTool || s.itemKind === ITEM_KIND.MINING_TOOL) {
      el.appendChild(toolIcon(s.toolClass, s.toolTier, 32));
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
    if (s.pool) {
      cursorItem.append(poolIcon(s.pool));
    } else if (s.itemKind === ITEM_KIND.GEAR && s.count) {
      cursorItem.append(gearIcon(s.definitionId, 32));
      if (s.count > 1) {
        const count = document.createElement('span'); count.textContent = s.count;
        Object.assign(count.style, { position: 'absolute', right: '-2px', bottom: '-2px', color: '#fff', font: 'bold 12px system-ui', textShadow: '0 1px 3px #000' });
        cursorItem.append(count);
      }
    } else if (isSpecialKind(s.itemKind)) {
      cursorItem.appendChild(specialIcon(s.itemKind, 30));
      if (s.count > 1 || isFiniteAmmoKind(s.itemKind)) {
        const c = document.createElement('span');
        Object.assign(c.style, {
          position: 'absolute', right: '-2px', bottom: '-2px', fontSize: '12px', fontWeight: '700',
          color: '#fff', textShadow: '0 1px 2px #000, 0 0 2px #000',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        });
        c.textContent = String(s.count);
        cursorItem.appendChild(c);
      }
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
  function describeSlot(index) {
    const stack = index < SLOTS ? snapshot?.slots?.[index] : snapshot?.equipment?.[index - SLOTS];
    const equipmentSlot = index >= SLOTS ? index - SLOTS : -1;
    const data = stack?.definitionId ? gearDetails(stack.definitionId, snapshot?.equipment, equipmentSlot) : null;
    const holding = hasCursor();
    const quick = equipmentSlot >= 0 ? 'Shift-click to unequip' : data && EQUIPMENT_BY_ID[stack.definitionId].slot >= 0 ? 'Shift-click to equip' : 'Shift-click to transfer';
    const action = !open ? 'Click to select' : holding ? 'Click to place or swap\nRight-click to place one'
      : stack?.pool ? 'Double-click to open bag\nClick or drag to move' : `Click or drag to move${stack?.count > 1 ? '\nRight-click to split' : ''}${managed ? `\n${quick}` : ''}`;
    if (managed && stack?.isTool) return { name: slotName(stack), type: 'Pickaxe',
      description: 'Hold to mine. Right-click to mine background walls.\nA red outline requires a stronger pickaxe.',
      action, inspectTouch: open, touchAction: 'Tap again to pick up' };
    if (data) return { ...data, action, inspectTouch: open, touchAction: 'Tap again to pick up' };
    if (stack?.pool) return { name: `${POOL_NAMES[stack.pool]} bag`, type: 'Material storage',
      stats: [{ label: 'Stored', value: (snapshot?.pools?.find(p => p.id === stack.pool)?.entries || []).reduce((sum, entry) => sum + entry.count, 0).toLocaleString() }], action, inspectTouch: open, touchAction: 'Tap again to pick up · Use the bag buttons to open' };
    if (!stack?.count) return holding ? { name: equipmentSlot >= 0 ? 'Equipment slot' : 'Empty slot', action } : null;
    return { name: slotName(stack), type: stack.isTool ? `${TIER_NAME[stack.toolTier]} tool` : stack.itemKind === ITEM_KIND.ARROW ? 'Ammunition' : stack.itemKind === ITEM_KIND.MATERIAL ? 'Material' : 'Equipment',
      stats: stack.count > 1 ? [{ label: 'Quantity', value: stack.count.toLocaleString() }] : [], action, inspectTouch: open, touchAction: 'Tap again to pick up' };
  }
  function quickMove(index) {
    if (!managed || hasCursor()) return false;
    const stack = index < SLOTS ? snapshot?.slots?.[index] : snapshot?.equipment?.[index - SLOTS];
    if (!stack?.count && !stack?.pool) return true;
    const definition = EQUIPMENT_BY_ID[stack.definitionId];
    let target = -1;
    if (index < SLOTS && definition?.slot >= 0) {
      let part = definition.slot;
      if (part === 7 && snapshot.equipment?.[7]?.count && !snapshot.equipment?.[8]?.count) part = 8;
      target = SLOTS + part;
    } else {
      const candidates = index >= SLOTS ? [...Array(SLOTS).keys()].sort((a,b) => (a < HOTBAR) - (b < HOTBAR))
        : [...Array(index < HOTBAR ? SLOTS - HOTBAR : HOTBAR).keys()].map(i => i + (index < HOTBAR ? HOTBAR : 0));
      target = candidates.find(i => !snapshot.slots[i]?.count && !snapshot.slots[i]?.pool) ?? -1;
    }
    if (target >= 0) {
      cursorPick?.(index, false); cursorPick?.(target, false);
      if (index < SLOTS && target >= SLOTS) cursorPick?.(index, false);
    }
    return true;
  }
  const openBag = (pool, restored = false) => {
    if (!pool || (hasCursor() && !restored)) return;
    hud.classList.add('bag-open');
    title.textContent = 'MATERIAL BAG';
    setOpen(true);
    pools.open(pool);
  };
  const onWindowKeyDown = (e) => {
    if (!open || e.repeat || (e.key !== 'Escape' && e.key.toLowerCase() !== 'e')) return;
    if (e.composedPath().some((node) => /^(SELECT|INPUT|TEXTAREA)$/.test(node.tagName) || (node.getAttribute?.('role') === 'combobox' && (node.getAttribute('aria-expanded') === 'true' || e.key !== 'Escape')))) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
  };

  // --- Pointer routing -------------------------------------------------------
  // Inventory presses pick up stacks immediately. Two presses on the same bag
  // pick it up and put it back; the double-click then opens its contents.

  hud.addEventListener('contextmenu', (e) => e.preventDefault());
  backdrop.addEventListener('contextmenu', (e) => e.preventDefault());

  hud.addEventListener('pointerdown', (e) => {
    dragBag = false;
    const i = idxOf(e.target);
    pressedBag = i >= 0 && !hasCursor() ? Number(slots[i].dataset.pool || 0) : 0;
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
    if (e.shiftKey && quickMove(i)) { downSlot = -1; downOnSlot = false; return; }
    downSlot = i;
    downOnSlot = true;
    dragBag = !!pressedBag;
    ptrX = e.clientX; ptrY = e.clientY; // so the chip appears under the cursor at once
    const half = e.button === 2;
    cursorPick?.(i, half);
    refreshCursor();
  });

  // Pointer actions run on pointerdown; click handles keyboard/programmatic use.
  hud.addEventListener('click', (e) => {
    const i = idxOf(e.target);
    if (i < 0) return;
    if (e.detail === 1) clickedBag = pressedBag ? { slot: i, pool: pressedBag } : null;
    if (e.detail === 0 && slots[i].dataset.pool && !hasCursor() && !e.shiftKey) {
      openBag(Number(slots[i].dataset.pool)); return;
    }
    if (!open) {
      if (i < HOTBAR) {
        // Pointer selection already ran on pointerdown. Reassert focus at the
        // end of the complete click sequence because browsers may transfer it
        // to the button after that earlier focus() call.
        if (e.detail === 0) selectSlot?.(i);
        focusSurface();
      }
      return;
    }
    if (e.detail !== 0) return;
    if (e.shiftKey && quickMove(i)) return;
    cursorPick?.(i, e.shiftKey);
    refreshCursor();
  });

  hud.addEventListener('dblclick', (e) => {
    const i = idxOf(e.target);
    if (i < 0 || e.button !== 0) return;
    const restored = open && clickedBag?.slot === i;
    const pool = restored ? clickedBag.pool : Number(slots[i].dataset.pool || 0);
    clickedBag = null;
    if (!pool) return;
    e.preventDefault(); e.stopPropagation();
    openBag(pool, restored);
  });

  hud.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.target.getAttribute('role') === 'combobox') return;
    if (e.key === 'Escape' || (e.key.toLowerCase() === 'e' && e.target.tagName !== 'SELECT')) {
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
    const index = idxOf(e.target);
    const stride = index >= SLOTS ? 1 : HOTBAR;
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -stride, ArrowDown: stride }[e.key];
    if (index >= 0 && offset) {
      e.preventDefault();
      const first = index >= SLOTS ? SLOTS : 0, last = index >= SLOTS ? slots.length - 1 : SLOTS - 1;
      slots[Math.max(first, Math.min(last, index + offset))]?.focus({ preventScroll: true });
      return;
    }
    if (e.key !== 'Tab' || managed) return;
    const focusable = [...hud.querySelectorAll('button:not(:disabled), select:not(:disabled), input:not(:disabled)')].filter((el) => el.getClientRects().length);
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
    if (!open) {
      const i = idxOf(e.target);
      if (i >= 0 && i < HOTBAR) focusSurface();
      downSlot = -1; downOnSlot = false;
      return;
    }
    const to = idxOf(e.target);
    const from = downSlot;
    const movingBag = dragBag; dragBag = false;
    downSlot = -1; downOnSlot = false;
    // A press that started on slot `from` and released on a DIFFERENT slot `to`,
    // while carrying, places/swaps onto `to` (press-drag-release). Same-slot
    // releases were already handled by the pointerdown pick, so skip them.
    if (to < 0 || from < 0 || to === from) return;
    if (movingBag) {
      cursorPick?.(to, false); refreshCursor(); return;
    }
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
    if (s.itemKind === ITEM_KIND.GEAR && s.count) return EQUIPMENT_BY_ID[s.definitionId]?.name || 'Relic';
    if (s.pool) return `${POOL_NAMES[s.pool]} pool${s.count > 0 ? ` · ${(NAME[s.material] || '').toLowerCase()}` : ' · empty'}`;
    if (s.itemKind === ITEM_KIND.DYNAMITE_SATCHEL) return 'Dynamite Satchel';
    if (s.itemKind === ITEM_KIND.BORE_CANNON) return 'Bore Cannon';
    if (s.itemKind === ITEM_KIND.ACID_MORTAR) return 'Acid Mortar';
    if (s.itemKind === ITEM_KIND.CLUSTER_LAUNCHER) return 'Cluster Launcher';
    if (s.itemKind === ITEM_KIND.MINIGUN) return 'Minigun';
    if (s.itemKind === ITEM_KIND.RESCUE_BEAM) return 'Rescue Beam';
    if (s.itemKind === ITEM_KIND.BLAST_GUN) return 'Blast Gun';
    if (s.itemKind === ITEM_KIND.BOW) return 'Bow';
    if (s.itemKind === ITEM_KIND.ARROW) return 'Arrow';
    if (s.isTool) return `${TIER_NAME[s.toolTier] || ''} ${managed ? 'Pickaxe' : TOOL_NAME[s.toolClass] || 'Tool'}`.trim();
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

  let station = 0, abilities = 0;
  const recipeName = (r) => {
    if (r.outputKind === ITEM_KIND.GEAR) return EQUIPMENT_BY_ID[r.outputDefinition]?.name || 'Equipment';
    if (r.outputKind === ITEM_KIND.MINING_TOOL) return `${TIER_NAME[r.outputTier] || ''} ${managed ? 'Pickaxe' : 'Mining Tool'}`.trim();
    if (r.outputKind === ITEM_KIND.DYNAMITE_SATCHEL) return 'Dynamite Satchel';
    if (r.outputKind === ITEM_KIND.BORE_CANNON) return 'Bore Cannon';
    if (r.outputKind === ITEM_KIND.ACID_MORTAR) return 'Acid Mortar';
    if (r.outputKind === ITEM_KIND.CLUSTER_LAUNCHER) return 'Cluster Launcher';
    if (r.outputKind === ITEM_KIND.MINIGUN) return 'Minigun';
    if (r.outputKind === ITEM_KIND.RESCUE_BEAM) return 'Rescue Beam';
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
  const available = (inv, ingredient) => [
    ...(inv?.slots || []).filter((slot) => !slot.pool),
    ...(inv?.pools || []).flatMap((pool) => pool.entries.map((entry) => ({ ...entry, itemKind: ITEM_KIND.MATERIAL }))),
  ].reduce((sum, slot) => {
    if (!slot?.count || slot.itemKind !== ITEM_KIND.MATERIAL) return sum;
    if (ingredient.kind === CRAFT_INGREDIENT.MATERIAL) return sum + (slot.material === ingredient.value ? slot.count : 0);
    return sum + ((MAT_CRAFT_FLAGS[slot.material] & ingredient.value) !== 0 ? slot.count : 0);
  }, 0);
  const recipeEls = recipes.map((recipe) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'craft-recipe';
    const output = document.createElement('span'); output.className = 'craft-output';
    renderStack(output, { definitionId: recipe.outputDefinition, itemKind: recipe.outputKind, material: recipe.outputMaterial, toolClass: 5, toolTier: recipe.outputTier, isTool: recipe.outputKind === ITEM_KIND.MINING_TOOL, count: recipe.outputCount });
    const text = document.createElement('span');
    const name = document.createElement('span'); name.className = 'craft-name'; name.textContent = recipeName(recipe);
    const cost = document.createElement('span'); cost.className = 'craft-cost';
    cost.textContent = recipe.ingredients.map((i) => `${i.count} ${ingredientName(i)}`).join(' + ');
    text.append(name, cost);
    const count = document.createElement('span'); count.className = 'craft-count'; count.textContent = 'MAKE';
    button.append(output, text, count);
    button.addEventListener('click', (event) => { if (button.getAttribute('aria-disabled') !== 'true') craft?.(recipe.id, event.shiftKey); });
    tooltips.bind(button, () => {
      const details = gearDetails(recipe.outputDefinition, snapshot?.equipment) || { name: recipeName(recipe), type: 'Recipe' };
      return { ...details,
        stats: [...(details.stats || []), ...recipe.ingredients.map(ingredient => ({ label: ingredientName(ingredient),
          value: `${available(snapshot, ingredient)} / ${ingredient.count}`, tone: available(snapshot, ingredient) < ingredient.count ? 'negative' : 'positive' }))],
        action: button.getAttribute('aria-disabled') === 'true' ? 'Missing materials' : 'Click to craft\nShift-click to craft all', inspectTouch: true,
        touchAction: button.getAttribute('aria-disabled') === 'true' ? 'Missing materials' : 'Tap again to craft' };
    });
    craftList.appendChild(button);
    return { recipe, button, count };
  });

  function update(inv) {
    snapshot = inv;
    if (inv && inv.slots) {
      capacity.textContent = `${inv.slots.filter(slot => slot.count || slot.pool).length} / ${SLOTS}`;
      const sel = inv.selected;
      selectedSlot = sel;
      if (lastSelected >= 0 && sel !== lastSelected) showToast(slotName(inv.slots[sel]));
      lastSelected = sel;
      const held = inv.slots[sel];
      const pool = inv.pools?.find((p) => p.id === held?.pool);
      poolActive.hidden = !pool;
      if (pool) {
        const queue = pool.exactMaterial ? pool.entries.filter((row) => row.material === pool.exactMaterial)
          : pool.entries.filter((row) => row.enabled && row.count > 0).slice(0, 2);
        poolActive.textContent = `${POOL_NAMES[pool.id]} · ${pool.exactMaterial ? 'Exact' : 'Auto'} · ${queue.map((row) => `${(NAME[row.material] || '').toLowerCase()} ${row.count.toLocaleString()}`).join(' → ') || 'no enabled materials'}`;
      }
      for (let i = 0; i < SLOTS; i++) {
        const el = slots[i];
        if (!el) continue;
        const s = inv.slots[i] || { material: 0, isTool: false, count: 0 };
        el.classList.toggle('selected', i === inv.selected);
        el.classList.toggle('inv-bag', !!s.pool);
        if (s.pool) { el.dataset.pool = String(s.pool); el.setAttribute('aria-haspopup', 'dialog'); }
        else { delete el.dataset.pool; el.removeAttribute('aria-haspopup'); }
        if (i < HOTBAR) el.setAttribute('aria-pressed', String(i === inv.selected));
        const contents = i >= HOTBAR && !s.count && !s.pool ? 'Empty' : slotName(s);
        const countLabel = isFiniteAmmoKind(s.itemKind)
          ? `, ${s.count} ammo` : (s.count > 1 ? `, ${s.count}` : '');
        el.setAttribute('aria-label', `${i < HOTBAR ? `Hotbar ${i + 1}` : `Inventory slot ${i + 1}`}: ${contents}${countLabel}${i === inv.selected ? ', selected' : ''}`);
        const sig = `${s.definitionId | 0}:${s.pool | 0}:${s.itemKind | 0}:${s.isTool ? 1 : 0}:${s.material | 0}:${s.toolClass | 0}:${s.toolTier | 0}:${s.count | 0}`;
        if (sig === slotSig[i]) continue;
        slotSig[i] = sig;
        el.replaceChildren();
        if (i < HOTBAR) {
          const n = document.createElement('span'); n.className = 'inv-num';
          n.textContent = String(i + 1); el.appendChild(n);
        }
        renderStack(el, s);
        if (s.pool) {
          const label = document.createElement('span'); label.className = 'inv-bag-label'; label.textContent = 'BAG'; el.append(label);
        }
      }
      for (const row of recipeEls) {
        row.button.hidden = !!row.recipe.npcId && row.recipe.npcId !== station;
        row.button.hidden ||= (abilities & row.recipe.ability) !== row.recipe.ability;
        const can = row.recipe.ingredients.every((ingredient) => available(inv, ingredient) >= ingredient.count);
        row.button.disabled = !managed && !can;
        row.button.setAttribute('aria-disabled', String(!can));
        row.count.textContent = can ? 'Craft' : 'Missing';
      }
      pools.update(inv);
    }
    refreshCursor();
    tooltips.refresh();
  }

  const setOpen = (v) => {
    const next = !!v;
    if (next === open) return;
    if (next) previousFocus = root.activeElement || document.activeElement;
    open = next;
    tooltips.hide();
    hud.classList.toggle('open', open);
    backdrop.classList.toggle('open', open);
    hint.textContent = open ? openHint : closedHint;
    if (open && !managed) {
      hud.setAttribute('role', 'dialog');
      hud.setAttribute('aria-modal', 'true');
      hud.setAttribute('aria-label', 'Inventory and crafting');
    } else {
      hud.removeAttribute('role');
      hud.removeAttribute('aria-modal');
      hud.removeAttribute('aria-label');
    }
    if (!open) {
      downSlot = -1; downOnSlot = false; dragBag = false;
      hud.classList.remove('bag-open'); title.textContent = 'FIELD INVENTORY';
    }
    openButton.hidden = open;
    if (open) {
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('keydown', onWindowKeyDown);
    } else {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('keydown', onWindowKeyDown);
    }
    refreshCursor();
    if (open) {
      slots[selectedSlot]?.focus({ preventScroll: true });
    } else if (previousFocus?.isConnected) {
      previousFocus.focus?.({ preventScroll: true });
      previousFocus = null;
    }
    onOpenChange?.(open);
  };

  // cursorItem is intentionally NOT appended here — it lives on document.body.
  root.append(backdrop, hud);
  return {
    el: hud,
    tooltips,
    registerEquipmentSlot(index, element) {
      element.classList.add('inv-slot'); element.dataset.index = String(SLOTS + index);
      slots[SLOTS + index] = element;
      tooltips.bind(element, () => describeSlot(SLOTS + index) || { name: element.getAttribute('aria-label'), action: 'Click a matching item, then this slot.' });
    },
    update,
    setOpen,
    setStation(id, earned = 0) { station = id; abilities = earned; craftTitle.textContent = id === 7 ? 'Barter · Copper' : id ? 'Workbench' : 'Crafting'; },
    toggleOpen() { setOpen(!open); },
    isOpen() { return open; },
    destroy() {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('keydown', onWindowKeyDown);
      if (toastTimer) { clearTimeout(toastTimer); toastTimer = 0; }
      backdrop.remove();
      hud.remove();
      cursorItem.remove();
      tooltips.destroy();
      pools.destroy();
    },
  };
}
