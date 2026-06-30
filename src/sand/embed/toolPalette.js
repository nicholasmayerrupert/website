// Framework-free, searchable "spawn anything" palette for the sand game. Builds
// plain DOM into a host root (a Web Component's shadow root) with a single
// injected <style> — no React and no Tailwind on the host page. Pure callbacks
// out: it owns the visible UI state (selected entry, draw on/off, layout,
// expanded/collapsed) and calls onSelectCreative / onToggleDrawMode; the caller
// wires those into the runtime.
//
// To keep it small the palette is COLLAPSED by default: it shows only a compact
// bar (the selected swatch + name, an Expand button, and the Draw On/Off toggle).
// The full ~38-entry searchable grid is built lazily and only mounted while
// expanded, so the heavy list never takes space (or DOM) until the user asks for
// it. Picking an entry collapses back to the bar.
//
// Every entry resolves to a creative pick {kind, value} matching the engine's
// CreativeKind enum (consumed by game.setCreativeMaterial):
//   CK_MATERIAL = 0  -> value = material id
//   CK_SEED     = 1  -> value = species index (0..5)
//   CK_ERASER   = 2  -> value = 0
//   CK_CUBE     = 3  -> value = 0
// Entries: every MATERIALS row except EMPTY, one seed per plant species, plus an
// eraser and a tumbling rigid cube. The default selection is the Cube.

import { MATERIALS } from '../materials.generated';

const CK_MATERIAL = 0;
const CK_SEED = 1;
const CK_ERASER = 2;
const CK_CUBE = 3;

// Species order mirrors the engine's seed-species indices.
const SEED_SPECIES = ['Oak', 'Pine', 'Willow', 'Cactus', 'Mushroom', 'Bush'];

const SEED_SWATCH = 'rgb(120,190,100)';
const ERASER_SWATCH = 'rgb(254,205,211)';
const CUBE_SWATCH = 'rgb(214,211,209)';

// Most-used builders float to the top of the list so they aren't buried under
// the long tail of exotic materials. Matched against the lowercased entry label.
const PRIORITY_LABELS = ['cube', 'stone', 'dirt', 'sand', 'water', 'tnt', 'gunpowder', 'salt', 'brine'];

// packed ABGR number -> css rgb(...) using the low 24 bits (r,g,b).
function packedToRgb(c) {
  return `rgb(${c & 0xff},${(c >> 8) & 0xff},${(c >> 16) & 0xff})`;
}

// Build the full entry list: materials (minus EMPTY), 6 seeds, eraser, cube.
// Each entry is { key, label, color, kind, value } where `color` is a css color
// string used as the swatch background. Entries are then reordered so the common
// builders in PRIORITY_LABELS lead, in that exact order, with everything else
// following in its natural order.
function buildEntries() {
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
  return [...lead, ...rest];
}

const STYLE = `
.sg-palette { position: absolute; z-index: 70; box-sizing: border-box; font-family: ui-sans-serif, system-ui, sans-serif;
  background: rgba(17,24,39,.3); border-radius: 8px; padding: 8px; backdrop-filter: blur(4px);
  box-shadow: 0 10px 15px -3px rgba(0,0,0,.3); pointer-events: auto; max-width: calc(100vw - 1.5rem); }
.sg-palette.side { left: 16px; top: 50%; transform: translateY(-50%); }
.sg-palette.bottom { bottom: 12px; left: 50%; transform: translateX(-50%); }
.sg-col { display: flex; flex-direction: column; gap: 8px; }
.sg-cap { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #d1d5db; }

/* Collapsed bar: selected entry preview + expand control, side by side. */
.sg-bar { display: flex; align-items: center; gap: 6px; }
.sg-current { display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1 1 auto;
  border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.06); border-radius: 6px;
  padding: 5px 7px; font-size: 12px; line-height: 1.15; color: #f3f4f6; cursor: pointer; overflow: hidden; }
.sg-current:hover { background: rgba(255,255,255,.12); }
.sg-current.locked { opacity: .55; cursor: not-allowed; }
.sg-current.locked:hover { background: rgba(255,255,255,.06); }
.sg-current .sg-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sg-expand { flex: none; border-radius: 6px; padding: 5px 9px; font-size: 11px; font-weight: 600;
  border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.1); color: #fff; cursor: pointer; }
.sg-expand:hover { background: rgba(255,255,255,.2); }
.sg-expand.locked { opacity: .55; cursor: not-allowed; }
.sg-expand.locked:hover { background: rgba(255,255,255,.1); }

.sg-search { width: 100%; box-sizing: border-box; border-radius: 6px; padding: 6px 8px; font-size: 13px;
  border: 1px solid rgba(255,255,255,.18); background: rgba(3,7,18,.6); color: #fff; outline: none; }
.sg-search::placeholder { color: #9ca3af; }
.sg-search:focus { border-color: rgba(255,255,255,.4); }
.sg-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; width: 220px;
  max-width: calc(100vw - 2.5rem); max-height: 240px; overflow-y: auto; scroll-behavior: smooth;
  overscroll-behavior: contain; padding: 2px; border-radius: 6px; background: rgba(3,7,18,.35); }
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
.sg-empty { padding: 10px 6px; font-size: 12px; color: #9ca3af; text-align: center; }
.sg-toggle { border-radius: 6px; padding: 4px 8px; font-size: 10px; font-weight: 600; border: 0; cursor: pointer;
  background: rgba(255,255,255,.1); color: #fff; }
.sg-toggle:hover { background: rgba(255,255,255,.2); }
.sg-toggle.on { background: rgba(255,255,255,.8); color: #000; }
.sg-toggle.on:hover { background: #fff; }
`;

// Decorative color swatch for an entry (a flat rounded square in the entry's
// color).
function renderSwatch(color) {
  const sw = document.createElement('span');
  sw.className = 'sg-swatch';
  sw.style.background = color;
  return sw;
}

export function createToolPalette(root, { onSelectCreative, onToggleDrawMode, showDrawToggle = true } = {}) {
  if (!root.querySelector('style[data-sand-palette]')) {
    const s = document.createElement('style');
    s.setAttribute('data-sand-palette', '');
    s.textContent = STYLE;
    root.appendChild(s);
  }

  const entries = buildEntries();
  // Default selection is the Cube (the engine starts on the cube too).
  let selected = entries.find((e) => e.kind === CK_CUBE) || entries[0];
  let query = '';
  let drawOn = false;
  let atBottom = false;
  let expanded = false;

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
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'click', 'contextmenu']) {
    wrap.addEventListener(ev, (e) => e.stopPropagation());
  }

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
  const currentSwatch = renderSwatch(selected.color);
  const currentName = document.createElement('span');
  currentName.className = 'sg-name';
  current.append(currentSwatch, currentName);
  const canSelectMaterial = () => !showDrawToggle || drawOn;
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
  search.placeholder = 'Search materials…';
  search.setAttribute('aria-label', 'Search spawnable materials');
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

  function setExpanded(next) {
    expanded = next;
    if (expanded) {
      // Mount search + list above the Draw toggle when it exists.
      col.insertBefore(search, toggle);
      col.insertBefore(list, toggle);
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
  }

  function renderState() {
    if (toggle) {
      toggle.textContent = `Draw ${drawOn ? 'On' : 'Off'}`;
      toggle.className = `sg-toggle${drawOn ? ' on' : ''}`;
      toggle.title = drawOn ? 'Disable drawing so the page scrolls normally' : 'Enable drawing in the physics simulation';
    }
    const locked = !canSelectMaterial();
    wrap.className = `sg-palette ${atBottom ? 'bottom' : 'side'}`;
    current.className = `sg-current${locked ? ' locked' : ''}`;
    current.disabled = locked;
    currentSwatch.style.background = selected.color;
    currentName.textContent = selected.label;
    current.title = `Selected: ${selected.label} — click to ${expanded ? 'collapse' : 'change'}`;
    expandBtn.textContent = expanded ? 'Close' : 'Expand';
    expandBtn.className = `sg-expand${locked ? ' locked' : ''}`;
    expandBtn.disabled = locked;
    expandBtn.title = locked ? 'Turn Draw On to select materials' : '';
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
      opt.append(renderSwatch(e.color), lbl);
      opt.addEventListener('click', () => pick(e));
      list.appendChild(opt);
    }
  }

  root.appendChild(wrap);
  renderState();
  // Emit the initial selection so the engine starts on the cube.
  onSelectCreative?.({ kind: selected.kind, value: selected.value });

  return {
    el: wrap,
    setDrawMode(on) {
      drawOn = !!on;
      if (!drawOn && expanded) setExpanded(false);
      else renderState();
    },
    setLayout(uiAtBottom) { atBottom = !!uiAtBottom; renderState(); if (expanded) renderList(); },
    destroy() { wrap.remove(); },
  };
}
