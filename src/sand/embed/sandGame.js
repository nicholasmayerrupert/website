// <sand-game> — a drop-in Web Component for the falling-sand simulation.
//
// Self-contained: the WebAssembly engine (simulation + WebGL rendering) is
// embedded in the bundle, so any page can use it with no framework and no build
// step:
//
//   <script type="module" src="sand-game.js"></script>
//   <sand-game initial-tool="sand"></sand-game>
//
// The element owns a shadow root holding the simulation canvas and a vanilla
// tool palette. It fills its host box (default: absolutely positioned to cover a
// positioned ancestor). Draw-mode changes are surfaced as a DOM event:
//
//   el.addEventListener('sand:drawmodechange', (e) => { e.detail.on });
//
// `composed: true` lets the event cross the shadow boundary so any host (React,
// vanilla, another framework) can listen.

import { initSandWasm } from '../wasmBridge/engineFactory.js';
import { computeThreadWorkerBudgets, createSandGame } from '../game/createSandGame';
import { DEFAULT_TOOL } from '../game/runtimeConfig';
import { createToolPalette } from './toolPalette';
import { createInventoryHud } from './inventoryHud';
import { createFootprintMenu } from './footprintMenu';
import { createConnectPanel } from './connectPanel';

const HOST_CSS = `
:host { position: absolute; inset: 0; display: block; pointer-events: none;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent; }
/* Keep text-entry controls (search, multiplayer IP, etc.) selectable/editable. */
input, textarea { user-select: text; -webkit-user-select: text; -webkit-touch-callout: default; }
.sg-sim { position: absolute; inset: 0; overflow: hidden; }
.sg-stick { position: absolute; right: 10px; bottom: calc(12px + env(safe-area-inset-bottom, 0px)); z-index: 68;
  width: 118px; height: 118px; border-radius: 50%; pointer-events: auto; touch-action: none;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;
  background: rgba(17,24,39,.3); box-shadow: 0 10px 15px -3px rgba(0,0,0,.3); backdrop-filter: blur(4px);
  border: 1px solid rgba(255,255,255,.14); }
.sg-stick .sg-knob { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px;
  border-radius: 50%; background: rgba(255,255,255,.24); border: 1px solid rgba(255,255,255,.5);
  box-shadow: 0 4px 10px rgba(0,0,0,.35); transition: transform .08s ease-out; will-change: transform; }
.sg-stick.active .sg-knob { transition: none; background: rgba(255,255,255,.82); }
.sg-zoom { position: absolute; left: 12px; bottom: calc(12px + env(safe-area-inset-bottom, 0px)); z-index: 71;
  display: flex; flex-direction: column; gap: 6px; pointer-events: auto; touch-action: manipulation;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.sg-zoom button { width: 40px; height: 40px; border: 1px solid rgba(255,255,255,.22); border-radius: 10px;
  background: rgba(17,24,39,.5); color: #fff; font-size: 22px; line-height: 1; font-weight: 600; cursor: pointer;
  backdrop-filter: blur(4px); box-shadow: 0 10px 15px -3px rgba(0,0,0,.3);
  -webkit-tap-highlight-color: transparent; }
.sg-zoom button:active { background: rgba(255,255,255,.82); color: #000; }
.sg-perf { position: absolute; top: 64px; right: 12px; z-index: 72; pointer-events: none;
  min-width: 150px; padding: 8px 10px; border-radius: 8px; font-size: 11px; line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #e5e7eb;
  background: rgba(17,24,39,.55); border: 1px solid rgba(255,255,255,.14);
  box-shadow: 0 10px 15px -3px rgba(0,0,0,.3); backdrop-filter: blur(4px); }
.sg-perf .sg-perf-title { display: block; font-size: 9px; letter-spacing: .08em; text-transform: uppercase;
  color: #9ca3af; margin-bottom: 4px; }
.sg-perf .sg-perf-row { display: flex; justify-content: space-between; gap: 12px; white-space: nowrap; }
.sg-perf .sg-perf-row span:last-child { color: #fff; font-variant-numeric: tabular-nums; }
`;

// Mobile-only analog thumbstick. Maps the knob offset to the same four movement
// keys the d-pad drove (left=0, right=1, up=2, down=3), engaging a direction once
// the stick passes a per-axis deadzone. Diagonals fall out naturally by holding
// two keys at once, matching how WASD/arrows behave on desktop.
function createMobileJoystick(root, game) {
  const CODE = { left: 0, right: 1, up: 2, down: 3 };
  const DEADZONE = 0.32; // fraction of max travel before an axis engages

  const wrap = document.createElement('div');
  wrap.className = 'sg-stick';
  wrap.setAttribute('aria-label', 'Movement joystick');
  const knob = document.createElement('div');
  knob.className = 'sg-knob';
  wrap.appendChild(knob);

  const held = { 0: false, 1: false, 2: false, 3: false };
  let pointerId = null;
  let maxTravel = 33; // recomputed from real geometry on each press

  const setDir = (code, on) => {
    if (held[code] === on) return;
    held[code] = on;
    game.inputKey(code, on);
  };
  const releaseAll = () => {
    for (const code of [CODE.left, CODE.right, CODE.up, CODE.down]) setDir(code, false);
  };

  const apply = (dx, dy) => {
    // Clamp the knob inside the ring, then map its position to the axes.
    const dist = Math.hypot(dx, dy);
    const scale = dist > maxTravel ? maxTravel / dist : 1;
    const kx = dx * scale;
    const ky = dy * scale;
    knob.style.transform = `translate(${kx}px, ${ky}px)`;
    const nx = kx / maxTravel;
    const ny = ky / maxTravel;
    setDir(CODE.left, nx < -DEADZONE);
    setDir(CODE.right, nx > DEADZONE);
    setDir(CODE.up, ny < -DEADZONE);
    setDir(CODE.down, ny > DEADZONE);
  };

  const fromCenter = (e) => {
    const r = wrap.getBoundingClientRect();
    return [e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)];
  };

  const onDown = (e) => {
    pointerId = e.pointerId;
    wrap.classList.add('active');
    wrap.setPointerCapture?.(e.pointerId);
    maxTravel = wrap.getBoundingClientRect().width / 2 - knob.offsetWidth / 2;
    apply(...fromCenter(e));
    e.preventDefault();
    e.stopPropagation();
  };
  const onMove = (e) => {
    if (e.pointerId !== pointerId) return;
    apply(...fromCenter(e));
    e.preventDefault();
    e.stopPropagation();
  };
  const onUp = (e) => {
    if (pointerId !== null && e.pointerId !== pointerId) return;
    pointerId = null;
    wrap.classList.remove('active');
    knob.style.transform = 'translate(0px, 0px)';
    releaseAll();
    try { wrap.releasePointerCapture?.(e.pointerId); } catch { /* capture already gone */ }
    e.preventDefault();
    e.stopPropagation();
  };

  wrap.addEventListener('pointerdown', onDown);
  wrap.addEventListener('pointermove', onMove);
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    wrap.addEventListener(ev, onUp);
  }

  root.appendChild(wrap);
  return {
    destroy() {
      releaseAll();
      wrap.remove();
    },
  };
}

// Mobile-only on-screen zoom control, sitting to the left of the creative palette.
// Desktop uses the +/- keyboard shortcuts instead (createSandGame.onKeyDown).
function createZoomButtons(root, game) {
  const wrap = document.createElement('div');
  wrap.className = 'sg-zoom';
  wrap.setAttribute('aria-label', 'Zoom controls');
  const mk = (label, aria, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-label', aria);
    // Act on pointerdown and swallow it so the press never reaches the sim canvas
    // (which would otherwise start placing/mining under the button).
    b.addEventListener('pointerdown', (e) => { fn(); e.preventDefault(); e.stopPropagation(); });
    for (const ev of ['pointerup', 'pointermove', 'click']) b.addEventListener(ev, (e) => e.stopPropagation());
    wrap.appendChild(b);
    return b;
  };
  mk('+', 'Zoom in', () => game.zoomIn());
  mk('−', 'Zoom out', () => game.zoomOut());
  root.appendChild(wrap);
  return { destroy() { wrap.remove(); } };
}

// Live performance overlay (the /fps route). A tiny top-right panel that polls
// game.perfStats() and derives fps (its own rAF cadence) + tickrate (sim-step
// delta) over a rolling ~500ms window. Read-only, pointer-events: none.
function createPerfHud(root, game) {
  const wrap = document.createElement('div');
  wrap.className = 'sg-perf';
  const title = document.createElement('span');
  title.className = 'sg-perf-title';
  title.textContent = 'Performance';
  wrap.appendChild(title);

  const rows = {};
  const addRow = (key, label) => {
    const row = document.createElement('div');
    row.className = 'sg-perf-row';
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('span');
    v.textContent = '–';
    row.append(l, v);
    wrap.appendChild(row);
    rows[key] = v;
  };
  addRow('fps', 'fps');
  addRow('actorTps', 'actor/s');
  addRow('worldTps', 'world/s');
  addRow('actor', 'actor ms');
  addRow('step', 'step ms');
  addRow('render', 'render ms');
  addRow('light', 'light ms');
  addRow('fill', 'fill ms');
  addRow('upload', 'upload ms');
  addRow('grounding', 'grounding ms');
  addRow('xlayerG', 'x-layer ground');
  addRow('compIdx', 'comp index ms');
  addRow('assembly', 'assembly ms');
  addRow('carry', 'carry ms');
  addRow('body', 'body ms');
  addRow('sand', 'sand ms');
  addRow('liquid', 'liquid ms');
  addRow('gas', 'gas ms');
  addRow('react', 'react ms');
  addRow('tail', 'tail ms');
  addRow('frame', 'frame p95');
  addRow('timing', 'actor debt');
  addRow('dirty', 'dirty chunks');
  addRow('dirtyRows', 'dirty rows');
  addRow('dirtyCells', 'dirty cells');
  addRow('comps', 'components');
  addRow('compCells', 'comp cells');
  addRow('xBonds', 'cross bonds');
  addRow('creatures', 'creatures');
  addRow('shifts', 'world shifts');
  addRow('heap', 'heap MB');
  addRow('grid', 'grid');
  addRow('tick', 'tick');
  root.appendChild(wrap);

  let raf = 0;
  let frames = 0;
  let winStart = performance.now();
  let lastActorTick = null;
  let lastWorldTick = null;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    frames++;
    const now = performance.now();
    const dt = now - winStart;
    if (dt < 500) return;
    const s = game.perfStats ? game.perfStats() : null;
    const fps = (frames * 1000) / dt;
    let actorTps = 0;
    let worldTps = 0;
    if (s) {
      if (lastActorTick !== null) actorTps = ((s.actorTick - lastActorTick) * 1000) / dt;
      if (lastWorldTick !== null) worldTps = ((s.worldTick - lastWorldTick) * 1000) / dt;
      lastActorTick = s.actorTick;
      lastWorldTick = s.worldTick;
    }
    frames = 0;
    winStart = now;
    if (!s) return;
    const f2 = (v) => (v || 0).toFixed(2);
    rows.fps.textContent = fps.toFixed(0);
    rows.actorTps.textContent = actorTps.toFixed(0);
    rows.worldTps.textContent = worldTps.toFixed(0);
    rows.actor.textContent = f2(s.actorMs);
    rows.step.textContent = f2(s.stepMs);
    rows.render.textContent = f2(s.renderMs);
    rows.light.textContent = f2(s.lightMs);
    rows.fill.textContent = f2(s.fillMs);
    rows.upload.textContent = f2(s.uploadMs);
    rows.grounding.textContent = f2(s.groundingMs);
    rows.xlayerG.textContent = f2(s.crossLayerGroundingMs);
    rows.compIdx.textContent = f2(s.componentIndexMs);
    rows.assembly.textContent = f2(s.assemblyUnionMs);
    rows.carry.textContent = f2(s.carryMs);
    rows.body.textContent = f2(s.bodyMs);
    rows.sand.textContent = f2(s.sandMs);
    rows.liquid.textContent = f2(s.liquidMs);
    rows.gas.textContent = f2(s.gasMs);
    rows.react.textContent = f2(s.reactMs);
    rows.tail.textContent = f2(s.tailMs);
    rows.frame.textContent = f2(s.p95FrameMs);
    rows.timing.textContent = `${f2(s.actorDebtMs)} / ${f2(s.actorDroppedMs)}`;
    rows.dirty.textContent = String(s.dirtyChunks || 0);
    rows.dirtyRows.textContent = String(s.dirtyRows || 0);
    rows.dirtyCells.textContent = String(s.dirtyCells || 0);
    rows.comps.textContent = String(s.componentCount || 0);
    rows.compCells.textContent = String(s.componentCellCount || 0);
    rows.xBonds.textContent = String(s.crossBondCount || 0);
    rows.creatures.textContent = String(s.creatureCount || 0);
    rows.shifts.textContent = String(s.worldShifts);
    rows.heap.textContent = s.heapMB.toFixed(1);
    rows.grid.textContent = `${s.cols}×${s.rows}`;
    rows.tick.textContent = `${s.actorTick}/${s.worldTick}`;
  };
  raf = requestAnimationFrame(tick);

  return { destroy() { cancelAnimationFrame(raf); wrap.remove(); } };
}

function setPageScrollLocked(lock) {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  const body = document.body;
  if (!html || !body) return;
  if (lock) {
    if (!body.dataset.sandPrevOverflow) body.dataset.sandPrevOverflow = body.style.overflow || ' ';
    if (!html.dataset.sandPrevOverflow) html.dataset.sandPrevOverflow = html.style.overflow || ' ';
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
  } else {
    if (body.dataset.sandPrevOverflow !== undefined) {
      body.style.overflow = body.dataset.sandPrevOverflow === ' ' ? '' : body.dataset.sandPrevOverflow;
      delete body.dataset.sandPrevOverflow;
    }
    if (html.dataset.sandPrevOverflow !== undefined) {
      html.style.overflow = html.dataset.sandPrevOverflow === ' ' ? '' : html.dataset.sandPrevOverflow;
      delete html.dataset.sandPrevOverflow;
    }
  }
}

class SandGameElement extends HTMLElement {
  static get observedAttributes() { return ['initial-tool']; }

  connectedCallback() {
    if (this._mounted) return;
    this._mounted = true;
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = HOST_CSS;
    root.appendChild(style);

    const sim = document.createElement('div');
    sim.className = 'sg-sim';
    root.appendChild(sim);

    const initialTool = this.getAttribute('initial-tool') || DEFAULT_TOOL;
    // 'survival' (default): player character + reach-limited tools, camera
    // follows. 'creative': free camera, draw anywhere, no character.
    const mode = this.getAttribute('mode') === 'creative' ? 'creative' : 'survival';
    const debugHitboxes = this.hasAttribute('debug-hitboxes');
    let cancelled = false;

    // The threaded module prewarms its browser-worker pool during init. Publish
    // this engine's share before init so creative's render mirror and world
    // worker do not each allocate the full hardware budget.
    globalThis.__sandPthreadPoolSize = computeThreadWorkerBudgets(mode === 'survival').mainThreadWorkers;

    initSandWasm()
      .then(() => {
        if (cancelled || !this.isConnected) return;
        const game = createSandGame(sim, {
          initialTool,
          mode,
          debugHitboxes,
          onLayoutChange: ({ uiAtBottom }) => this._palette?.setLayout(uiAtBottom),
          // Survival inventory HUD wiring (the engine owns the inventory state).
          onInventory: (inv) => {
            this._hud?.update(inv);
            this._sizeMenu?.update(this._game?.getSurvivalFootprints?.() || [], inv.selectedFootprint);
          },
          onToggleInventory: () => this._hud?.toggleOpen(),
          onToggleFootprintMenu: () => this._sizeMenu?.toggleOpen(),
        });
        this._game = game;
        const coarse = typeof window !== 'undefined' && window.matchMedia &&
          window.matchMedia('(pointer: coarse)').matches;
        if (mode === 'survival') {
          // Survival uses the inventory HUD (hotbar + openable grid) with the full
          // Minecraft cursor model. All state is authoritative in the engine; the HUD
          // forwards intents (select, pick/place the carried stack, throw out).
          this._hud = createInventoryHud(root, {
            selectSlot: (i) => game.selectSlot(i),
            cursorPick: (slot, half) => game.cursorPick(slot, half),
            throwFromCursor: (whole) => game.throwFromCursor(whole),
            getCursor: () => game.getCursor(),
          });
          this._sizeMenu = createFootprintMenu(root, {
            selectFootprint: (id) => game.setSelectedFootprint(id),
          });
          this._hud.update(game.getInventory());
          this._sizeMenu.update(game.getSurvivalFootprints(), game.getInventory().selectedFootprint);
          // Multiplayer connect panel (collapsed): join an authoritative server
          // by IP:port. Survival-only; single-player UI is unchanged at rest.
          this._mp = createConnectPanel(root, {
            join: (url, room) => game.netJoin(url, room),
            disconnect: () => game.netDisconnect(),
            getStatus: () => game.netStatus(),
          });
        } else {
          // Creative uses the searchable "spawn anything" palette: every material +
          // a seed per species + eraser + cube, routed through setCreativeMaterial.
          this._palette = createToolPalette(root, {
            showDrawToggle: coarse,
            onSelectCreative: ({ kind, value }) => game.setCreativeMaterial(kind, value),
            onToggleDrawMode: (on) => {
              game.setDrawMode(on);
              if (coarse) setPageScrollLocked(on);
              this.dispatchEvent(new CustomEvent('sand:drawmodechange', {
                detail: { on }, bubbles: true, composed: true,
              }));
            },
          });
          // Touch has no +/- keys, so give mobile an on-screen zoom control beside
          // the palette (desktop zooms via the keyboard).
          if (coarse) this._zoom = createZoomButtons(root, game);
        }
        // Default draw state: fine pointers are always draw-enabled. Coarse
        // pointers start off so touch pages can scroll until the user opts in.
        const drawDefault = !coarse;
        game.setDrawMode(drawDefault);
        this._palette?.setDrawMode(drawDefault);
        if (coarse) this._stick = createMobileJoystick(root, game);
        // Perf overlay (opt-in via the `perf-hud` attribute — the /fps route sets it).
        if (this.hasAttribute('perf-hud')) this._perfHud = createPerfHud(root, game);
      })
      .catch((e) => { console.error('sand-game: engine failed to init; staying blank', e); });

    this._cancel = () => { cancelled = true; };
  }

  disconnectedCallback() {
    this._cancel?.();
    this._game?.destroy();
    this._palette?.destroy();
    this._hud?.destroy();
    this._sizeMenu?.destroy();
    this._mp?.destroy();
    this._stick?.destroy();
    this._zoom?.destroy();
    this._perfHud?.destroy();
    setPageScrollLocked(false);
    this._game = this._palette = this._hud = this._sizeMenu = this._mp = this._stick = this._zoom = this._perfHud = null;
    this._mounted = false;
  }

  attributeChangedCallback(name, _old, value) {
    if (name === 'initial-tool' && value && this._game) {
      this._game.setTool(value);
      this._palette?.setTool?.(value);
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('sand-game')) {
  customElements.define('sand-game', SandGameElement);
}

export { SandGameElement };
