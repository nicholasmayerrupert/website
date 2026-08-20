// Searchable framework-free creative palette. Entries map to the generated
// CreativeKind ABI and are forwarded through `setCreativeMaterial`.

import {
  MATERIALS, MAT_PALETTE_HIDDEN, PALETTE_MAIN_ORDER,
  PALETTE_SECTIONS as GENERATED_PALETTE_SECTIONS, PLANT_SPECIES,
} from '../materials.generated.js';
import {
  CREATIVE_KIND, CREATURE_CREATIVE_ENTRIES,
} from '../wasmBridge/abi.generated.js';
import { DEFAULT_DAY_PHASE } from '../game/dayNightCycle.js';
import { injectStyleOnce, packedToRgb, swallowEvents } from './uiShared.js';

const CK_MATERIAL = CREATIVE_KIND.MATERIAL;
const CK_SEED = CREATIVE_KIND.SEED;
const CK_ERASER = CREATIVE_KIND.ERASER;
const CK_CUBE = CREATIVE_KIND.CUBE;
const CK_CREATURE = CREATIVE_KIND.CREATURE;

const ERASER_SWATCH = 'rgb(254,205,211)';
const CUBE_SWATCH = 'rgb(214,211,209)';

const PALETTE_KIND = { seed: CK_SEED, creature: CK_CREATURE };
const PALETTE_SECTIONS = GENERATED_PALETTE_SECTIONS.map((section) => ({
  ...section,
  kinds: section.entryKinds?.map((kind) => PALETTE_KIND[kind]),
}));

const entryInSection = (entry, section) =>
  section.all || section.labels?.includes(entry.label) || section.kinds?.includes(entry.kind);


// Build materials (minus EMPTY), seeds, eraser, cube, and creature eggs. Entries
// not named in the curated order retain schema order.
export function buildEntries() {
  const entries = [];
  for (const m of MATERIALS) {
    if (m.id === 0 || MAT_PALETTE_HIDDEN[m.id]) continue;
    entries.push({
      key: `mat-${m.id}`,
      label: m.name.toLowerCase(),
      color: packedToRgb(m.color),
      textureAmp: m.textureAmp,
      animated: m.renderAnim !== 'none',
      kind: CK_MATERIAL,
      value: m.id,
    });
  }
  PLANT_SPECIES.filter((species) => species.palette).forEach(({ id, label, colors, pixels }) => {
    entries.push({
      key: `seed-${id}`,
      label: `${label} Seed`,
      color: colors[0],
      seedColors: colors,
      seedPixels: pixels,
      kind: CK_SEED,
      value: id,
    });
  });
  // Tool labels stay lowercase to match material labels and search queries.
  entries.push({ key: 'eraser', label: 'eraser', color: ERASER_SWATCH, textureAmp: 0, kind: CK_ERASER, value: 0 });
  entries.push({ key: 'cube', label: 'cube', color: CUBE_SWATCH, textureAmp: 8, kind: CK_CUBE, value: 0 });

  const ordered = [];
  for (const want of PALETTE_MAIN_ORDER) {
    const hit = entries.find((e) => e.label.toLowerCase() === want);
    if (hit) ordered.push(hit);
  }
  const rest = entries.filter((e) => !ordered.includes(e));
  const eggs = CREATURE_CREATIVE_ENTRIES.map(({ id, label, colors }) => ({
    key: `creature-${id}`,
    label,
    color: `radial-gradient(circle at 35% 28%, #fff 0 7%, ${colors[1]} 8% 18%, ${colors[0]} 19% 61%, ${colors[1]} 62% 72%, ${colors[0]} 73%)`,
    eggColors: colors,
    kind: CK_CREATURE,
    value: id,
    egg: true,
  }));
  return [...ordered, ...rest, ...eggs];
}

const STYLE = `
.sg-palette { position: absolute; z-index: 70; box-sizing: border-box;
  font-family: ui-monospace, "SFMono-Regular", "Cascadia Mono", "Roboto Mono", "Courier New", monospace;
  font-weight: 700; letter-spacing: .035em; text-rendering: geometricPrecision;
  -webkit-font-smoothing: none; font-smooth: never;
  background: rgba(12,18,28,.52); border: 1px solid rgba(255,255,255,.13); border-radius: 9px; padding: 8px;
  backdrop-filter: blur(7px); box-shadow: 0 12px 26px -8px rgba(0,0,0,.58); pointer-events: auto;
  max-width: calc(100vw - 1.5rem); user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent; touch-action: auto; }
.sg-palette.side { left: 16px; top: 50%; transform: translateY(-50%); }
.sg-palette.bottom { bottom: 12px; left: 50%; transform: translateX(-50%); }
.sg-palette[hidden] { display: none; }
.sg-col { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.sg-cap { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: .12em; color: #cbd5e1; }

/* Compact selected-material field with a separate pixel-arrow close control. */
.sg-bar { display: flex; align-items: stretch; gap: 5px; }
.sg-current { display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1 1 auto;
  border: 1px solid rgba(255,255,255,.19); background: rgba(255,255,255,.07); border-radius: 6px;
  padding: 5px 7px; font: inherit; font-size: 10px; line-height: 1.15; text-transform: uppercase; color: #f8fafc;
  cursor: pointer; overflow: hidden; touch-action: manipulation; transition: background .14s ease, border-color .14s ease; }
.sg-current:hover { background: rgba(255,255,255,.13); border-color: rgba(255,255,255,.3); }
.sg-current.locked { opacity: .55; cursor: not-allowed; }
.sg-current.locked:hover { background: rgba(255,255,255,.07); }
.sg-current .sg-name { min-width: 0; flex: 1 1 auto; white-space: nowrap; overflow: hidden; }
.sg-current .sg-name-track { display: inline-block; white-space: nowrap; }
.sg-current .sg-name.scrolling .sg-name-track { animation: sg-name-pan 3.6s steps(24, end) infinite alternate; }
@keyframes sg-name-pan {
  0%, 18% { transform: translateX(0); }
  82%, 100% { transform: translateX(var(--sg-name-shift)); }
}
.sg-expand { position: relative; flex: none; width: 31px; min-height: 31px; border-radius: 6px; padding: 0;
  border: 1px solid rgba(255,255,255,.19); background: rgba(255,255,255,.09); color: #fff; cursor: pointer;
  touch-action: manipulation; transition: background .14s ease, border-color .14s ease; }
.sg-expand::before { content: ''; position: absolute; left: 10px; top: 10px; width: 9px; height: 9px;
  border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(45deg);
  transition: transform .2s steps(4, end), top .2s steps(4, end); }
.sg-palette.expanded .sg-expand::before { top: 13px; transform: rotate(225deg); }
.sg-expand:hover { background: rgba(255,255,255,.19); border-color: rgba(255,255,255,.32); }
.sg-expand.locked { opacity: .55; cursor: not-allowed; }

/* The material list is a true dropdown. It remains open on desktop until the
   field/arrow is pressed again; mobile selection closes it after the pick. */
.sg-dropdown { transform-origin: top left; opacity: 0; transform: translateY(-7px) scale(.985); pointer-events: none; }
.sg-palette.expanded .sg-dropdown { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto;
  animation: sg-dropdown-in .22s cubic-bezier(.2,.8,.2,1) both; }
.sg-palette.closing .sg-dropdown { animation: sg-dropdown-out .2s cubic-bezier(.4,0,1,1) both; }
.sg-dropdown-shell { display: flex; flex-direction: column; gap: 6px; padding: 6px;
  border: 1px solid rgba(255,255,255,.15); border-radius: 7px; background: rgba(5,10,18,.82);
  box-shadow: 0 14px 30px -10px rgba(0,0,0,.72); backdrop-filter: blur(9px); overflow: hidden; }
@keyframes sg-dropdown-in {
  from { opacity: 0; transform: translateY(-7px) scale(.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes sg-dropdown-out {
  from { opacity: 1; transform: translateY(0) scale(1); }
  to { opacity: 0; transform: translateY(-5px) scale(.975); }
}
.sg-search { width: 100%; box-sizing: border-box; border-radius: 5px; padding: 7px 8px; font: inherit;
  font-size: 10px; text-transform: uppercase; letter-spacing: .05em; border: 1px solid rgba(255,255,255,.18);
  background: rgba(3,7,18,.72); color: #fff; outline: none; user-select: text; -webkit-user-select: text;
  -webkit-touch-callout: default; }
.sg-search::placeholder { color: #94a3b8; }
.sg-search:focus { border-color: rgba(255,255,255,.48); box-shadow: 0 0 0 1px rgba(255,255,255,.08); }
.sg-sections { display: flex; gap: 4px; width: 224px; max-width: calc(100vw - 2.5rem); padding: 1px 1px 3px;
  overflow-x: auto; overscroll-behavior-x: contain; touch-action: pan-x; scrollbar-width: none; }
.sg-sections::-webkit-scrollbar { display: none; }
.sg-section { --sg-accent: #cbd5e1; display: flex; flex: 0 0 auto; align-items: center; gap: 5px; min-height: 27px;
  border: 1px solid rgba(255,255,255,.12); border-radius: 5px; padding: 4px 6px; background: rgba(255,255,255,.035);
  color: #aebbc9; font: inherit; font-size: 8px; line-height: 1; text-transform: uppercase; cursor: pointer;
  touch-action: manipulation; transition: color .12s ease, border-color .12s ease, background .12s ease; }
.sg-section:hover { color: #fff; border-color: rgba(255,255,255,.28); background: rgba(255,255,255,.08); }
.sg-section.active { color: #fff; border-color: var(--sg-accent); background: rgba(255,255,255,.1); }
.sg-folder { position: relative; width: 13px; height: 9px; flex: none; box-sizing: border-box; margin-top: 2px;
  border: 1px solid currentColor; background: var(--sg-accent); box-shadow: inset 0 0 0 3px rgba(5,10,18,.58); }
.sg-folder::before { content: ''; position: absolute; left: -1px; top: -4px; width: 6px; height: 4px; box-sizing: border-box;
  border: 1px solid currentColor; border-bottom: 0; background: var(--sg-accent); }
.sg-list-head { display: flex; align-items: baseline; justify-content: space-between; min-height: 11px; padding: 0 2px;
  color: #e5edf6; font-size: 8px; text-transform: uppercase; letter-spacing: .11em; }
.sg-list-count { color: #8391a3; font-variant-numeric: tabular-nums; }
.sg-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; width: 224px;
  max-width: calc(100vw - 2.5rem); max-height: 240px; overflow-y: auto; overscroll-behavior-y: contain;
  touch-action: pan-y; -webkit-overflow-scrolling: touch; padding: 1px 3px 1px 1px;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.34) transparent; }
.sg-list::-webkit-scrollbar { width: 5px; }
.sg-list::-webkit-scrollbar-thumb { border-radius: 0; background: rgba(255,255,255,.3); }
.sg-palette.bottom .sg-dropdown { position: absolute; left: 50%; bottom: calc(100% + 8px); transform-origin: bottom center;
  transform: translate(-50%, 7px) scale(.985); }
.sg-palette.bottom.expanded .sg-dropdown { transform: translate(-50%, 0) scale(1); animation-name: sg-dropdown-mobile-in; }
.sg-palette.bottom.closing .sg-dropdown { animation-name: sg-dropdown-mobile-out; }
.sg-palette.bottom .sg-list { grid-template-columns: repeat(2, minmax(0, 1fr)); width: min(340px, calc(100vw - 2.5rem));
  max-height: min(34svh, 230px); }
.sg-palette.bottom .sg-sections { width: min(340px, calc(100vw - 2.5rem)); }
@media (max-width: 400px) {
  .sg-palette.bottom { bottom: calc(138px + env(safe-area-inset-bottom, 0px)); }
}
@keyframes sg-dropdown-mobile-in {
  from { opacity: 0; transform: translate(-50%, 7px) scale(.985); }
  to { opacity: 1; transform: translate(-50%, 0) scale(1); }
}
@keyframes sg-dropdown-mobile-out {
  from { opacity: 1; transform: translate(-50%, 0) scale(1); }
  to { opacity: 0; transform: translate(-50%, 5px) scale(.975); }
}
.sg-opt { display: flex; align-items: center; gap: 7px; min-width: 0; min-height: 39px;
  border: 1px solid transparent; background: rgba(255,255,255,.035); border-radius: 5px; padding: 5px;
  text-align: left; font: inherit; font-size: 9px; line-height: 1.2; text-transform: uppercase; color: #dbe4ef;
  cursor: pointer; overflow: hidden; transition: background .12s ease, border-color .12s ease, transform .12s ease; }
.sg-opt[hidden] { display: none; }
.sg-palette.expanded .sg-opt { animation: sg-option-in .18s cubic-bezier(.2,.8,.2,1) both;
  animation-delay: min(calc(var(--sg-index) * 9ms), 150ms); }
@keyframes sg-option-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: translateY(0); } }
.sg-opt:hover { background: rgba(255,255,255,.1); transform: translateY(-1px); }
.sg-opt.active { background: rgba(255,255,255,.14); border-color: rgba(255,255,255,.42); color: #fff; }
.sg-opt .sg-name { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sg-swatch { width: 27px; height: 27px; flex: none; border-radius: 2px; border: 1px solid rgba(255,255,255,.28);
  background: #111827; image-rendering: pixelated; image-rendering: crisp-edges; box-shadow: 2px 2px 0 rgba(0,0,0,.32); }
.sg-swatch.animated { animation: sg-pixel-glow 1.15s steps(2, end) infinite alternate; }
@keyframes sg-pixel-glow { from { filter: brightness(.92); } to { filter: brightness(1.18); } }
.sg-empty { grid-column: 1 / -1; padding: 12px 6px; font-size: 9px; color: #94a3b8; text-align: center;
  text-transform: uppercase; }
.sg-toggle { border-radius: 6px; padding: 4px 8px; font-size: 10px; font-weight: 600; border: 0; cursor: pointer;
  background: rgba(255,255,255,.1); color: #fff; touch-action: manipulation; }
.sg-toggle:hover { background: rgba(255,255,255,.2); }
.sg-toggle.on { background: rgba(255,255,255,.8); color: #000; }
.sg-toggle.on:hover { background: #fff; }
.sg-time { width: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 3px;
  border-radius: 6px; padding: 4px 7px 5px; font-size: 10px; font-weight: 600; border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.08); color: #fff; }
.sg-time-head { display: flex; align-items: center; min-width: 0; gap: 6px; }
.sg-time-icon { width: 12px; height: 12px; flex: none; border-radius: 50%; border: 1px solid rgba(255,255,255,.35);
  background: linear-gradient(90deg, #dceaf0 50%, #283548 50%); box-shadow: 0 0 6px rgba(220,234,240,.3); }
.sg-time.dawn .sg-time-icon { background: linear-gradient(#f5c28d 48%, #9a5965 52%); box-shadow: 0 0 7px rgba(245,194,141,.45); }
.sg-time.noon .sg-time-icon { background: #ffe39a; box-shadow: 0 0 7px rgba(255,227,154,.65); }
.sg-time.dusk .sg-time-icon { background: linear-gradient(#cf795d 48%, #472c4c 52%); box-shadow: 0 0 7px rgba(207,121,93,.45); }
.sg-time.night .sg-time-icon { background: #f4fbff; box-shadow: 0 0 7px rgba(223,244,255,.55); }
.sg-time-value { min-width: 0; flex: 1 1 auto; white-space: nowrap; color: #f3f4f6; font-variant-numeric: tabular-nums; }
.sg-time-auto { flex: none; border: 0; border-radius: 4px; padding: 2px 5px; font: inherit; color: #d1d5db;
  background: rgba(255,255,255,.08); cursor: pointer; touch-action: manipulation; }
.sg-time-auto:hover { background: rgba(255,255,255,.18); color: #fff; }
.sg-time-auto.active { background: rgba(255,255,255,.78); color: #111827; }
.sg-time-range { width: 100%; height: 14px; margin: 0; padding: 0; appearance: none; -webkit-appearance: none;
  background: transparent; cursor: pointer; touch-action: pan-x; }
.sg-time-range::-webkit-slider-runnable-track { height: 4px; border-radius: 999px;
  background: linear-gradient(90deg, #172033, #e6a075 25%, #ffe39a 50%, #cf795d 75%, #172033); }
.sg-time-range::-webkit-slider-thumb { width: 14px; height: 14px; margin-top: -5px; border: 1px solid rgba(255,255,255,.85);
  border-radius: 50%; appearance: none; -webkit-appearance: none; background: #f8fafc; box-shadow: 0 2px 5px rgba(0,0,0,.45); }
.sg-time-range::-moz-range-track { height: 4px; border: 0; border-radius: 999px;
  background: linear-gradient(90deg, #172033, #e6a075 25%, #ffe39a 50%, #cf795d 75%, #172033); }
.sg-time-range::-moz-range-thumb { width: 14px; height: 14px; border: 1px solid rgba(255,255,255,.85);
  border-radius: 50%; background: #f8fafc; box-shadow: 0 2px 5px rgba(0,0,0,.45); }
@media (prefers-reduced-motion: reduce) {
  .sg-current .sg-name.scrolling .sg-name-track, .sg-palette.expanded .sg-dropdown,
  .sg-palette.closing .sg-dropdown,
  .sg-palette.expanded .sg-opt, .sg-swatch.animated { animation: none; }
  .sg-expand::before { transition: none; }
}
@media (pointer: coarse) {
  /* Mobile browsers magnify focused form controls whose text is below 16px. */
  .sg-search { font-size: 16px; }
}
`;

const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)));
const colorChannels = (color) => {
  if (color.startsWith('#')) {
    const n = Number.parseInt(color.slice(1), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  const channels = color.match(/\d+/g)?.map(Number);
  return channels?.slice(0, 3) || [148, 163, 184];
};
const hashText = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};
const pixelNoise = (seed, x, y) => {
  let h = seed ^ Math.imul(x + 1, 0x45d9f3b) ^ Math.imul(y + 1, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
};

// A true 9x9 material sample. The stable per-entry hash gives each icon the
// same cell-like grain on every render instead of presenting materials as flat
// blocks unrelated to the world renderer.
function paintSwatch(sw, entry) {
  const ctx = sw.getContext('2d');
  ctx.clearRect(0, 0, 9, 9);
  if (entry.seedPixels) {
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        const colorIndex = Number(entry.seedPixels[y][x]) - 1;
        if (colorIndex < 0) continue;
        ctx.fillStyle = entry.seedColors[colorIndex];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return;
  }
  const seed = hashText(entry.key);
  const base = colorChannels(entry.eggColors?.[0] || entry.color);
  const dark = colorChannels(entry.eggColors?.[1] || entry.color);
  const amp = entry.textureAmp ?? 6;
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      const noise = pixelNoise(seed, x, y);
      if (entry.egg) {
        const nx = (x - 4) / (y < 3 ? 2.65 : 3.45);
        const ny = (y - 4.2) / 4.35;
        if (nx * nx + ny * ny > 1) continue;
      }
      if (entry.kind === CK_ERASER && (x + y) % 2 === 0) continue;
      let rgb = base;
      if (entry.egg && noise % 7 < 2) rgb = dark;
      const jitter = (((noise >>> 8) & 7) - 3.5) * (amp / 3.5);
      ctx.fillStyle = `rgb(${clampByte(rgb[0] + jitter)},${clampByte(rgb[1] + jitter)},${clampByte(rgb[2] + jitter)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function renderSwatch(entry) {
  const sw = document.createElement('canvas');
  sw.width = 9;
  sw.height = 9;
  sw.className = `sg-swatch${entry.animated ? ' animated' : ''}`;
  sw.setAttribute('aria-hidden', 'true');
  paintSwatch(sw, entry);
  return sw;
}

const normalizeTimePhase = (phase) => ((phase % 1) + 1) % 1;
const timeTone = (phase) => {
  if (phase < 0.12 || phase >= 0.88) return 'night';
  if (phase < 0.38) return 'dawn';
  if (phase < 0.62) return 'noon';
  return 'dusk';
};
const formatTime = (phase) => {
  const totalMinutes = Math.round(normalizeTimePhase(phase) * 24 * 60) % (24 * 60);
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = String(totalMinutes % 60).padStart(2, '0');
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minute} ${hour24 < 12 ? 'AM' : 'PM'}`;
};

export function createToolPalette(root, { onSelectCreative, onToggleDrawMode, onExpandedChange, onSetTime, getTimeState, showDrawToggle = true, requireDrawMode = showDrawToggle } = {}) {
  injectStyleOnce(root, 'data-sand-palette', STYLE);

  const entries = buildEntries();
  // Default selection is the Cube (the engine starts on the cube too).
  let selected = entries.find((e) => e.kind === CK_CUBE) || entries[0];
  let query = '';
  let activeSection = PALETTE_SECTIONS[0];
  let drawOn = false;
  let atBottom = false;
  let expanded = false;
  let closing = false;
  let collapsedWidth = 0;
  let nameMotionFrame = 0;
  let dropdownRemoveTimer = 0;
  let timeAuto = true;
  let timePhase = DEFAULT_DAY_PHASE;
  let timeApplyFrame = 0;
  let lastAppliedTimePhase = NaN;
  let timePollTimer = 0;

  const wrap = document.createElement('div');
  wrap.className = 'sg-palette side';
  // Stop all pointer events, including captured pointermove, from reaching the
  // game input latch. Search-field keyboard events remain local naturally.
  swallowEvents(wrap, ['pointerdown', 'pointermove', 'pointerup', 'click', 'contextmenu']);

  const col = document.createElement('div');
  col.className = 'sg-col';
  wrap.appendChild(col);

  const cap = document.createElement('span');
  cap.className = 'sg-cap';
  cap.textContent = 'Spawn anything';
  col.appendChild(cap);

  // --- Collapsed bar: current selection preview + expand button -------------
  const bar = document.createElement('div');
  bar.className = 'sg-bar';

  const current = document.createElement('button');
  current.type = 'button';
  current.className = 'sg-current';
  const currentSwatch = renderSwatch(selected);
  const currentName = document.createElement('span');
  currentName.className = 'sg-name';
  const currentNameTrack = document.createElement('span');
  currentNameTrack.className = 'sg-name-track';
  currentNameTrack.textContent = selected.label;
  currentName.appendChild(currentNameTrack);
  current.append(currentSwatch, currentName);
  const canSelectMaterial = () => !requireDrawMode || drawOn;
  const toggleExpandedFromButton = () => {
    if (!canSelectMaterial()) return;
    setExpanded(!expanded);
  };
  current.addEventListener('click', toggleExpandedFromButton);

  const expandBtn = document.createElement('button');
  expandBtn.type = 'button';
  expandBtn.className = 'sg-expand';
  expandBtn.setAttribute('aria-label', 'Open material picker');
  expandBtn.addEventListener('click', toggleExpandedFromButton);

  bar.append(current, expandBtn);
  col.appendChild(bar);

  // --- Animated dropdown: search + scrollable material list -----------------
  const dropdown = document.createElement('div');
  dropdown.className = 'sg-dropdown';
  dropdown.id = `sg-materials-${Math.random().toString(36).slice(2)}`;
  const dropdownShell = document.createElement('div');
  dropdownShell.className = 'sg-dropdown-shell';
  dropdown.appendChild(dropdownShell);

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'sg-search';
  search.placeholder = 'Search materials or creatures…';
  search.setAttribute('aria-label', 'Search spawnable materials and creatures');
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    list.scrollTop = 0;
    renderList();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setExpanded(false);
  });

  const list = document.createElement('div');
  list.className = 'sg-list';
  list.setAttribute('role', 'listbox');
  const sections = document.createElement('div');
  sections.className = 'sg-sections';
  sections.setAttribute('role', 'tablist');
  sections.setAttribute('aria-label', 'Material folders');
  const sectionButtons = new Map();
  for (const section of PALETTE_SECTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `sg-section${section === activeSection ? ' active' : ''}`;
    button.style.setProperty('--sg-accent', section.accent);
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(section === activeSection));
    button.setAttribute('aria-label', `${section.label} materials`);
    const icon = document.createElement('span');
    icon.className = 'sg-folder';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = section.label;
    button.append(icon, label);
    button.addEventListener('click', () => {
      activeSection = section;
      query = '';
      search.value = '';
      list.scrollTop = 0;
      renderList();
      sections.scrollTo({
        left: button.offsetLeft - (sections.clientWidth - button.offsetWidth) / 2,
        behavior: 'smooth',
      });
    });
    sectionButtons.set(section.id, button);
    sections.appendChild(button);
  }
  const listHead = document.createElement('div');
  listHead.className = 'sg-list-head';
  const listTitle = document.createElement('span');
  const listCount = document.createElement('span');
  listCount.className = 'sg-list-count';
  listHead.append(listTitle, listCount);
  dropdownShell.append(search, sections, listHead, list);
  const optionByKey = new Map();
  const empty = document.createElement('div');
  empty.className = 'sg-empty';
  empty.textContent = 'No matches';
  empty.hidden = true;
  current.setAttribute('aria-controls', dropdown.id);
  expandBtn.setAttribute('aria-controls', dropdown.id);

  const toggle = showDrawToggle ? document.createElement('button') : null;
  if (toggle) {
    toggle.type = 'button';
    toggle.className = 'sg-toggle';
    toggle.addEventListener('click', () => {
      drawOn = !drawOn;
      onToggleDrawMode?.(drawOn);
      if (!drawOn && expanded) setExpanded(false);
      else renderState();
    });
    col.appendChild(toggle);
  }

  const timeControl = document.createElement('div');
  timeControl.className = 'sg-time dawn';
  const timeHead = document.createElement('div');
  timeHead.className = 'sg-time-head';
  const timeIcon = document.createElement('span');
  timeIcon.className = 'sg-time-icon';
  timeIcon.setAttribute('aria-hidden', 'true');
  const timeValue = document.createElement('span');
  timeValue.className = 'sg-time-value';
  const timeAutoButton = document.createElement('button');
  timeAutoButton.type = 'button';
  timeAutoButton.className = 'sg-time-auto active';
  timeAutoButton.textContent = 'Auto';
  const timeRange = document.createElement('input');
  timeRange.type = 'range';
  timeRange.className = 'sg-time-range';
  timeRange.min = '0';
  timeRange.max = '0.999';
  timeRange.step = '0.001';
  timeRange.setAttribute('aria-label', 'Time of day');
  timeHead.append(timeIcon, timeValue, timeAutoButton);
  timeControl.append(timeHead, timeRange);

  const flushTimePhase = () => {
    cancelAnimationFrame(timeApplyFrame);
    timeApplyFrame = 0;
    if (timeAuto || timePhase === lastAppliedTimePhase) return;
    lastAppliedTimePhase = timePhase;
    onSetTime?.(timePhase);
  };
  const queueTimePhase = () => {
    if (timeApplyFrame) return;
    timeApplyFrame = requestAnimationFrame(flushTimePhase);
  };
  timeRange.addEventListener('input', () => {
    timeAuto = false;
    timePhase = normalizeTimePhase(Number(timeRange.value));
    renderTimeState();
    queueTimePhase();
  });
  timeRange.addEventListener('change', flushTimePhase);
  timeAutoButton.addEventListener('click', () => {
    // A queued drag sample must never fire after Auto and pin the light again.
    cancelAnimationFrame(timeApplyFrame);
    timeApplyFrame = 0;
    timeAuto = true;
    lastAppliedTimePhase = NaN;
    onSetTime?.(null);
    syncTimeState();
  });
  col.appendChild(timeControl);

  function setExpanded(next) {
    const changed = expanded !== !!next;
    expanded = !!next;
    clearTimeout(dropdownRemoveTimer);
    dropdownRemoveTimer = 0;
    if (expanded) {
      closing = false;
      // Keep the dropdown before the compact controls. Mobile positions this
      // node above the fixed center bar so opening it never moves the controls.
      const controls = toggle || timeControl;
      col.insertBefore(dropdown, controls);
      dropdown.inert = false;
      renderList();
      // Fine pointers benefit from immediate typing. On touch, focusing here
      // opens the keyboard and can zoom the whole page as soon as the selector
      // is tapped, so wait for an explicit tap in the search field instead.
      if (!showDrawToggle && !requireDrawMode) search.focus();
    } else {
      query = '';
      search.value = '';
      dropdown.inert = true;
      closing = dropdown.isConnected;
      // Keep the stable option nodes alive through the close animation. Only
      // the dropdown itself is detached afterward; reopening reuses the same
      // buttons and canvases instead of repainting the entire material tray.
      dropdownRemoveTimer = setTimeout(() => {
        dropdown.remove();
        closing = false;
        dropdownRemoveTimer = 0;
        renderState();
      }, 210);
    }
    renderState();
    if (changed) onExpandedChange?.(expanded);
  }

  function renderState() {
    if (toggle) {
      toggle.textContent = `Draw ${drawOn ? 'On' : 'Off'}`;
      toggle.className = `sg-toggle${drawOn ? ' on' : ''}`;
      toggle.title = drawOn ? 'Disable drawing so the page scrolls normally' : 'Enable drawing in the physics simulation';
    }
    renderTimeState();
    const locked = !canSelectMaterial();
    wrap.className = `sg-palette ${atBottom ? 'bottom' : 'side'} ${expanded ? 'expanded' : 'collapsed'}${closing ? ' closing' : ''}`;
    wrap.style.width = !expanded && !closing && collapsedWidth ? `${collapsedWidth}px` : '';
    current.className = `sg-current${locked ? ' locked' : ''}`;
    current.disabled = locked;
    current.title = `Selected: ${selected.label} — click to ${expanded ? 'collapse' : 'change'}`;
    expandBtn.className = `sg-expand${locked ? ' locked' : ''}`;
    expandBtn.disabled = locked;
    expandBtn.setAttribute('aria-label', expanded ? 'Close material picker' : 'Open material picker');
    current.setAttribute('aria-expanded', String(expanded));
    expandBtn.setAttribute('aria-expanded', String(expanded));
    dropdown.setAttribute('aria-hidden', String(!expanded));
    expandBtn.title = locked ? 'Turn Draw On to select materials' : (expanded ? 'Close materials' : 'Open materials');
    scheduleNameMotion();
  }

  function renderTimeState() {
    const label = formatTime(timePhase);
    timeControl.className = `sg-time ${timeTone(timePhase)}`;
    timeControl.dataset.mode = timeAuto ? 'auto' : 'manual';
    timeControl.dataset.phase = String(timePhase);
    timeValue.textContent = label;
    timeRange.value = String(Math.min(0.999, timePhase));
    timeRange.setAttribute('aria-valuetext', label);
    timeAutoButton.className = `sg-time-auto${timeAuto ? ' active' : ''}`;
    timeAutoButton.title = timeAuto ? 'Following the automatic ten-minute cycle' : 'Resume the automatic ten-minute cycle';
  }

  function syncTimeState() {
    if (timeApplyFrame) return;
    const state = getTimeState?.();
    if (!state || !Number.isFinite(state.phase)) return;
    timeAuto = !state.overridden;
    timePhase = normalizeTimePhase(state.phase);
    renderTimeState();
  }

  function scheduleNameMotion() {
    cancelAnimationFrame(nameMotionFrame);
    nameMotionFrame = requestAnimationFrame(() => {
      currentName.classList.remove('scrolling');
      currentName.style.removeProperty('--sg-name-shift');
      if (expanded) return;
      const overflow = currentNameTrack.scrollWidth - currentName.clientWidth;
      if (overflow > 1) {
        currentName.style.setProperty('--sg-name-shift', `${-overflow}px`);
        currentName.classList.add('scrolling');
      }
    });
  }

  function pick(entry) {
    if (!canSelectMaterial()) return;
    const previous = selected;
    selected = entry;
    currentSwatch.className = `sg-swatch${selected.animated ? ' animated' : ''}`;
    paintSwatch(currentSwatch, selected);
    currentNameTrack.textContent = selected.label;
    for (const candidate of [previous, selected]) {
      const opt = optionByKey.get(candidate.key);
      if (!opt) continue;
      const active = candidate.key === selected.key;
      opt.classList.toggle('active', active);
      opt.setAttribute('aria-selected', String(active));
    }
    onSelectCreative?.({ kind: entry.kind, value: entry.value });
    // Desktop is a working tray: it stays open for rapid material changes and
    // closes only when asked. Mobile closes the tray after a pick.
    if (atBottom) setExpanded(false);
    else {
      renderState();
    }
  }

  function buildListOnce() {
    if (optionByKey.size) return;
    entries.forEach((e, index) => {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = `sg-opt${e.key === selected.key ? ' active' : ''}`;
      opt.title = e.label;
      opt.setAttribute('role', 'option');
      opt.setAttribute('aria-selected', String(e.key === selected.key));
      opt.style.setProperty('--sg-index', String(index));
      const lbl = document.createElement('span');
      lbl.className = 'sg-name';
      lbl.textContent = e.label;
      opt.append(renderSwatch(e), lbl);
      opt.addEventListener('click', () => {
        // A desktop selection ends palette text entry before shortcuts resume.
        if (!atBottom) search.blur();
        pick(e);
      });
      optionByKey.set(e.key, opt);
      list.appendChild(opt);
    });
    list.appendChild(empty);
  }

  function renderList() {
    buildListOnce();
    let shown = 0;
    for (const entry of entries) {
      const visible = query
        ? entry.label.toLowerCase().includes(query)
        : entryInSection(entry, activeSection);
      optionByKey.get(entry.key).hidden = !visible;
      if (visible) shown++;
    }
    for (const section of PALETTE_SECTIONS) {
      const button = sectionButtons.get(section.id);
      const active = !query && section === activeSection;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    }
    listTitle.textContent = query ? 'Search results' : activeSection.label;
    listCount.textContent = String(shown).padStart(2, '0');
    empty.hidden = shown !== 0;
  }

  root.appendChild(wrap);
  syncTimeState();
  renderState();
  // Freeze the collapsed control at the exact width of its default Cube state.
  // Longer material names pan inside the label viewport instead of moving the
  // mobile control group or stealing canvas space.
  collapsedWidth = Math.ceil(wrap.getBoundingClientRect().width);
  wrap.style.width = `${collapsedWidth}px`;
  scheduleNameMotion();
  // Emit the initial selection so the engine starts on the cube.
  onSelectCreative?.({ kind: selected.kind, value: selected.value });
  timePollTimer = setInterval(syncTimeState, 500);

  return {
    el: wrap,
    setDrawMode(on) {
      drawOn = !!on;
      if (!drawOn && expanded) setExpanded(false);
      else renderState();
    },
    setHidden(hidden) {
      wrap.hidden = !!hidden;
      wrap.setAttribute('aria-hidden', String(!!hidden));
    },
    selectMaterial(value) {
      const entry = entries.find((candidate) =>
        candidate.kind === CK_MATERIAL && candidate.value === (value | 0));
      if (!entry || !canSelectMaterial()) return false;
      pick(entry);
      return true;
    },
    setLayout(uiAtBottom) { atBottom = !!uiAtBottom; renderState(); if (expanded) renderList(); },
    destroy() {
      cancelAnimationFrame(nameMotionFrame);
      clearTimeout(dropdownRemoveTimer);
      cancelAnimationFrame(timeApplyFrame);
      clearInterval(timePollTimer);
      wrap.remove();
    },
  };
}
