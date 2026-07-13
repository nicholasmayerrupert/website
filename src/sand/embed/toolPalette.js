// Framework-free, searchable "spawn anything" palette for the sand game. Builds
// plain DOM into a host root (a Web Component's shadow root) with a single
// injected <style> — no React and no Tailwind on the host page. Pure callbacks
// out: it owns the visible UI state (selected entry, draw on/off, layout,
// expanded/collapsed) and calls onSelectCreative / onToggleDrawMode; the caller
// wires those into the runtime.
//
// To keep it small the palette is COLLAPSED by default: it shows only a compact
// bar (the selected swatch + name, an Expand button, and the Draw On/Off toggle).
// The full searchable grid is built lazily and only mounted while
// expanded, so the heavy list never takes space (or DOM) until the user asks for
// it. Picking an entry collapses back to the bar.
//
// Every entry resolves to a creative pick {kind, value} matching the engine's
// CreativeKind enum (consumed by game.setCreativeMaterial):
//   CK_MATERIAL = 0  -> value = material id
//   CK_SEED     = 1  -> value = species index (0..5)
//   CK_ERASER   = 2  -> value = 0
//   CK_CUBE     = 3  -> value = 0
//   CK_CREATURE = 4  -> value = creature species id
// Entries: every MATERIALS row except EMPTY, one seed per plant species, an
// eraser, a tumbling rigid cube, then all seven creature spawn eggs. The default
// selection is the Cube.

import { MATERIALS } from '../materials.generated.js';
import { CREATURE } from '../wasmBridge/abi.generated.js';
import { injectStyleOnce, packedToRgb, swallowEvents } from './uiShared.js';

const CK_MATERIAL = 0;
const CK_SEED = 1;
const CK_ERASER = 2;
const CK_CUBE = 3;
const CK_CREATURE = 4;

// Species order mirrors the engine's seed-species indices.
const SEED_SPECIES = ['Oak', 'Pine', 'Willow', 'Cactus', 'Mushroom', 'Bush'];

const SEED_SWATCH = 'rgb(120,190,100)';
const ERASER_SWATCH = 'rgb(254,205,211)';
const CUBE_SWATCH = 'rgb(214,211,209)';

// Kept separate from the material/tool list so these always form the final
// seven entries in the creative menu. Layered gradients make the compact
// swatches read as patterned eggs without adding image assets.
const CREATURE_EGGS = [
  ['Minnow', CREATURE.MINNOW, '#9de2c9', '#256f89'],
  ['Pike', CREATURE.PIKE, '#97bc5c', '#2e5b3a'],
  ['Fox', CREATURE.FOX, '#f49a46', '#7b3420'],
  ['Hare', CREATURE.HARE, '#edcfa6', '#835e48'],
  ['Crawler', CREATURE.CRAWLER, '#9f6ea9', '#3d2b4c'],
  ['Mole', CREATURE.MOLE, '#ba997e', '#4b3b3a'],
  ['Bird', CREATURE.BIRD, '#aedaf0', '#3663a0'],
];

// Most-used builders float to the top of the list so they aren't buried under
// the long tail of exotic materials. Matched against the lowercased entry label.
const PRIORITY_LABELS = ['cube', 'eraser', 'rigid', 'stone', 'crystal', 'water', 'lava', 'acid', 'tnt', 'oil', 'brine', 'seed', 'mycelium_spore', 'glowberry', 'glowshroom'];


// Build the full entry list: materials (minus EMPTY), 6 seeds, eraser, cube.
// Each entry is { key, label, color, kind, value } where `color` is a css color
// string used as the swatch background. Entries are then reordered so the common
// builders in PRIORITY_LABELS lead, in that exact order, with everything else
// following in its natural order.
export function buildEntries() {
  const entries = [];
  for (const m of MATERIALS) {
    if (m.id === 0) continue; // EMPTY
    entries.push({
      key: `mat-${m.id}`,
      label: m.name.toLowerCase(),
      color: packedToRgb(m.color),
      kind: CK_MATERIAL,
      value: m.id,
    });
  }
  SEED_SPECIES.forEach((name, i) => {
    entries.push({
      key: `seed-${i}`,
      label: `${name} Seed`,
      color: SEED_SWATCH,
      kind: CK_SEED,
      value: i,
    });
  });
  // Labels are lowercase to match the materials above (m.name.toLowerCase()) so
  // they display consistently AND match the lowercased search query / the
  // lowercase PRIORITY_LABELS lookup (otherwise 'cube' never leads and neither
  // tool can be found by typing its name).
  entries.push({ key: 'eraser', label: 'eraser', color: ERASER_SWATCH, kind: CK_ERASER, value: 0 });
  entries.push({ key: 'cube', label: 'cube', color: CUBE_SWATCH, kind: CK_CUBE, value: 0 });

  const lead = [];
  for (const want of PRIORITY_LABELS) {
    const hit = entries.find((e) => e.label === want);
    if (hit) lead.push(hit);
  }
  const rest = entries.filter((e) => !lead.includes(e));
  const eggs = CREATURE_EGGS.map(([name, value, light, dark]) => ({
    key: `creature-${value}`,
    label: `${name} Spawn Egg`,
    color: `radial-gradient(circle at 35% 28%, #fff 0 7%, ${dark} 8% 18%, ${light} 19% 61%, ${dark} 62% 72%, ${light} 73%)`,
    kind: CK_CREATURE,
    value,
    egg: true,
  }));
  return [...lead, ...rest, ...eggs];
}

const STYLE = `
.sg-palette { position: absolute; z-index: 70; box-sizing: border-box; font-family: ui-sans-serif, system-ui, sans-serif;
  background: rgba(17,24,39,.3); border-radius: 8px; padding: 8px; backdrop-filter: blur(4px);
  box-shadow: 0 10px 15px -3px rgba(0,0,0,.3); pointer-events: auto; max-width: calc(100vw - 1.5rem);
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent; touch-action: auto; }
.sg-palette.side { left: 16px; top: 50%; transform: translateY(-50%); }
.sg-palette.bottom { bottom: 12px; left: 50%; transform: translateX(-50%); }
.sg-col { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.sg-cap { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #d1d5db; }

/* Collapsed bar: selected entry preview + expand control, side by side. */
.sg-bar { display: flex; align-items: center; gap: 6px; }
.sg-current { display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1 1 auto;
  border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.06); border-radius: 6px;
  padding: 5px 7px; font-size: 12px; line-height: 1.15; color: #f3f4f6; cursor: pointer; overflow: hidden;
  touch-action: manipulation; }
.sg-current:hover { background: rgba(255,255,255,.12); }
.sg-current.locked { opacity: .55; cursor: not-allowed; }
.sg-current.locked:hover { background: rgba(255,255,255,.06); }
.sg-current .sg-name { min-width: 0; flex: 1 1 auto; white-space: nowrap; overflow: hidden; }
.sg-current .sg-name-track { display: inline-block; white-space: nowrap; }
.sg-current .sg-name.scrolling .sg-name-track { animation: sg-name-pan 3.6s ease-in-out infinite alternate; }
@keyframes sg-name-pan {
  0%, 18% { transform: translateX(0); }
  82%, 100% { transform: translateX(var(--sg-name-shift)); }
}
.sg-expand { flex: none; border-radius: 6px; padding: 5px 9px; font-size: 11px; font-weight: 600;
  border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.1); color: #fff; cursor: pointer;
  touch-action: manipulation; }
.sg-expand:hover { background: rgba(255,255,255,.2); }
.sg-expand.locked { opacity: .55; cursor: not-allowed; }
.sg-expand.locked:hover { background: rgba(255,255,255,.1); }

.sg-search { width: 100%; box-sizing: border-box; border-radius: 6px; padding: 6px 8px; font-size: 13px;
  border: 1px solid rgba(255,255,255,.18); background: rgba(3,7,18,.6); color: #fff; outline: none;
  user-select: text; -webkit-user-select: text; -webkit-touch-callout: default; }
.sg-search::placeholder { color: #9ca3af; }
.sg-search:focus { border-color: rgba(255,255,255,.4); }
.sg-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; width: 220px;
  max-width: calc(100vw - 2.5rem); max-height: 240px; overflow-y: auto;
  overscroll-behavior-y: contain; touch-action: pan-y; -webkit-overflow-scrolling: touch;
  padding: 2px; border-radius: 6px; background: rgba(3,7,18,.35); }
.sg-palette.bottom .sg-list { grid-template-columns: repeat(3, 1fr); width: 340px; max-height: 200px; }
.sg-opt { display: flex; align-items: center; gap: 7px;
  border: 1px solid transparent; background: rgba(255,255,255,.04); border-radius: 6px; padding: 6px;
  text-align: left; font-size: 12px; line-height: 1.15; color: #e5e7eb; cursor: pointer; overflow: hidden;
  min-height: 38px; }
.sg-opt:hover { background: rgba(255,255,255,.1); }
.sg-opt.active { background: rgba(255,255,255,.15); border-color: rgba(255,255,255,.35); color: #fff; }
.sg-opt .sg-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sg-swatch { width: 26px; height: 26px; flex: none; border-radius: 6px;
  border: 1px solid rgba(255,255,255,.18); box-shadow: inset 2px 2px 0 rgba(255,255,255,.14); }
.sg-swatch.egg { width: 22px; margin: 0 2px; border-radius: 50% 50% 46% 46% / 58% 58% 42% 42%; }
.sg-empty { padding: 10px 6px; font-size: 12px; color: #9ca3af; text-align: center; }
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
  .sg-current .sg-name.scrolling .sg-name-track { animation: none; }
}
`;

// Decorative color swatch for an entry (a flat rounded square in the entry's
// color).
function renderSwatch(color, egg = false) {
  const sw = document.createElement('span');
  sw.className = `sg-swatch${egg ? ' egg' : ''}`;
  sw.style.background = color;
  return sw;
}

const normalizeTimePhase = (phase) => ((phase % 1) + 1) % 1;
const timeTone = (phase) => {
  if (phase < 0.125 || phase >= 0.875) return 'night';
  if (phase < 0.375) return 'dawn';
  if (phase < 0.625) return 'noon';
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
  let drawOn = false;
  let atBottom = false;
  let expanded = false;
  let collapsedWidth = 0;
  let nameMotionFrame = 0;
  let timeAuto = true;
  let timePhase = 0.25;
  let timeApplyTimer = 0;
  let timePollTimer = 0;

  const wrap = document.createElement('div');
  wrap.className = 'sg-palette side';
  // Don't let palette pointer events reach the window-level game input handlers.
  // pointermove MUST be included: when a press starts on a palette button the
  // browser implicitly captures the pointer to that button, so every move (and the
  // closing pointerup) is delivered to the button — inside `wrap` — until release.
  // If pointermove were allowed through, dragging off a button onto the canvas
  // while still holding would hit the window's onPointerMove, which does
  // `mouseButtons |= e.buttons` and latches the LMB bit. The matching pointerup is
  // captured back to the button and stopped here, so that latch is never cleared —
  // leaving PI_PRIMARY stuck on, which makes a freshly-selected paint/eraser tool
  // act as if the mouse is held. Stopping pointermove too closes that gap.
  // The search input is a normal text field, so keystrokes stay local; only its
  // pointer events need the same guard, which it inherits from this wrap.
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
  const currentSwatch = renderSwatch(selected.color, selected.egg);
  const currentName = document.createElement('span');
  currentName.className = 'sg-name';
  const currentNameTrack = document.createElement('span');
  currentNameTrack.className = 'sg-name-track';
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
  expandBtn.addEventListener('click', toggleExpandedFromButton);

  bar.append(current, expandBtn);
  col.appendChild(bar);

  // --- Expanded panel: search + scrollable list (mounted only when open) ----
  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'sg-search';
  search.placeholder = 'Search materials or creatures…';
  search.setAttribute('aria-label', 'Search spawnable materials and creatures');
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); renderList(); });

  const list = document.createElement('div');
  list.className = 'sg-list';

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
    clearTimeout(timeApplyTimer);
    timeApplyTimer = 0;
    onSetTime?.(timePhase);
  };
  const queueTimePhase = () => {
    clearTimeout(timeApplyTimer);
    timeApplyTimer = setTimeout(flushTimePhase, 90);
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
    clearTimeout(timeApplyTimer);
    timeApplyTimer = 0;
    timeAuto = true;
    onSetTime?.(null);
    syncTimeState();
  });
  col.appendChild(timeControl);

  function setExpanded(next) {
    const changed = expanded !== !!next;
    expanded = !!next;
    if (expanded) {
      // Keep search + materials above the compact controls in both layouts.
      const controls = toggle || timeControl;
      col.insertBefore(search, controls);
      col.insertBefore(list, controls);
      renderList();
      if (!showDrawToggle) search.focus();
    } else {
      query = '';
      search.value = '';
      search.remove();
      list.remove();
      list.replaceChildren();
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
    wrap.className = `sg-palette ${atBottom ? 'bottom' : 'side'} ${expanded ? 'expanded' : 'collapsed'}`;
    wrap.style.width = !expanded && collapsedWidth ? `${collapsedWidth}px` : '';
    current.className = `sg-current${locked ? ' locked' : ''}`;
    current.disabled = locked;
    currentSwatch.className = `sg-swatch${selected.egg ? ' egg' : ''}`;
    currentSwatch.style.background = selected.color;
    currentNameTrack.textContent = selected.label;
    current.title = `Selected: ${selected.label} — click to ${expanded ? 'collapse' : 'change'}`;
    expandBtn.textContent = expanded ? 'Close' : 'Expand';
    expandBtn.className = `sg-expand${locked ? ' locked' : ''}`;
    expandBtn.disabled = locked;
    expandBtn.title = locked ? 'Turn Draw On to select materials' : '';
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
    if (timeApplyTimer) return;
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
    selected = entry;
    onSelectCreative?.({ kind: entry.kind, value: entry.value });
    // Collapsing after a pick keeps the footprint small.
    setExpanded(false);
  }

  function renderList() {
    list.replaceChildren();
    const shown = query ? entries.filter((e) => e.label.toLowerCase().includes(query)) : entries;
    if (shown.length === 0) {
      const none = document.createElement('div');
      none.className = 'sg-empty';
      none.textContent = 'No matches';
      list.appendChild(none);
      return;
    }
    for (const e of shown) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = `sg-opt${e.key === selected.key ? ' active' : ''}`;
      opt.title = e.label;
      const lbl = document.createElement('span');
      lbl.className = 'sg-name';
      lbl.textContent = e.label;
      opt.append(renderSwatch(e.color, e.egg), lbl);
      opt.addEventListener('click', () => pick(e));
      list.appendChild(opt);
    }
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
    setLayout(uiAtBottom) { atBottom = !!uiAtBottom; renderState(); if (expanded) renderList(); },
    destroy() {
      cancelAnimationFrame(nameMotionFrame);
      clearTimeout(timeApplyTimer);
      clearInterval(timePollTimer);
      wrap.remove();
    },
  };
}
