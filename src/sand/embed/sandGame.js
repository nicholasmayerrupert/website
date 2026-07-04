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

import { initSandWasm } from '../engineWasm';
import { createSandGame } from '../game/createSandGame';
import { createToolPalette } from './toolPalette';
import { createInventoryHud } from './inventoryHud';
import { createFootprintMenu } from './footprintMenu';
import { createConnectPanel } from './connectPanel';

const HOST_CSS = `
:host { position: absolute; inset: 0; display: block; pointer-events: none; }
.sg-sim { position: absolute; inset: 0; overflow: hidden; }
.sg-dpad { position: absolute; right: 8px; bottom: calc(10px + env(safe-area-inset-bottom, 0px)); z-index: 68;
  display: grid; grid-template-columns: repeat(3, 28px); grid-template-rows: repeat(3, 28px); gap: 4px;
  pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  padding: 6px; border-radius: 8px;
  background: rgba(17,24,39,.3); box-shadow: 0 10px 15px -3px rgba(0,0,0,.3); backdrop-filter: blur(4px); }
.sg-dpad button { border: 1px solid rgba(255,255,255,.22); border-radius: 10px;
  position: relative; background: rgba(255,255,255,.06); color: #fff; font-size: 0; user-select: none;
  -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
.sg-dpad button::before { content: ""; position: absolute; left: 50%; top: 50%; width: 0; height: 0; transform: translate(-50%, -50%); }
.sg-dpad .up::before { border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 9px solid currentColor; }
.sg-dpad .left::before { border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-right: 9px solid currentColor; }
.sg-dpad .right::before { border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-left: 9px solid currentColor; }
.sg-dpad .down::before { border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 9px solid currentColor; }
.sg-dpad button:active, .sg-dpad button.pressed { background: rgba(255,255,255,.82); color: #000; }
.sg-dpad .up { grid-column: 2; grid-row: 1; }
.sg-dpad .left { grid-column: 1; grid-row: 2; }
.sg-dpad .right { grid-column: 3; grid-row: 2; }
.sg-dpad .down { grid-column: 2; grid-row: 3; }
.sg-zoom { position: absolute; left: 12px; bottom: calc(12px + env(safe-area-inset-bottom, 0px)); z-index: 71;
  display: flex; flex-direction: column; gap: 6px; pointer-events: auto; touch-action: manipulation;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.sg-zoom button { width: 40px; height: 40px; border: 1px solid rgba(255,255,255,.22); border-radius: 10px;
  background: rgba(17,24,39,.5); color: #fff; font-size: 22px; line-height: 1; font-weight: 600; cursor: pointer;
  backdrop-filter: blur(4px); box-shadow: 0 10px 15px -3px rgba(0,0,0,.3);
  -webkit-tap-highlight-color: transparent; }
.sg-zoom button:active { background: rgba(255,255,255,.82); color: #000; }
`;

function createMobileDpad(root, game) {
  const wrap = document.createElement('div');
  wrap.className = 'sg-dpad';
  wrap.setAttribute('aria-label', 'Movement controls');

  const buttons = [
    { cls: 'up', label: 'Up', code: 2 },
    { cls: 'left', label: 'Left', code: 0 },
    { cls: 'right', label: 'Right', code: 1 },
    { cls: 'down', label: 'Down', code: 3 },
  ];
  const release = (button, code, pointerId) => {
    button.classList.remove('pressed');
    game.inputKey(code, false);
    try { button.releasePointerCapture?.(pointerId); } catch (_) {}
  };

  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = b.cls;
    btn.setAttribute('aria-label', b.label);
    btn.addEventListener('pointerdown', (e) => {
      btn.classList.add('pressed');
      btn.setPointerCapture?.(e.pointerId);
      game.inputKey(b.code, true);
      e.preventDefault();
      e.stopPropagation();
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      btn.addEventListener(ev, (e) => {
        release(btn, b.code, e.pointerId);
        e.preventDefault();
        e.stopPropagation();
      });
    }
    wrap.appendChild(btn);
  }

  root.appendChild(wrap);
  return {
    destroy() {
      for (const b of buttons) game.inputKey(b.code, false);
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

    const initialTool = this.getAttribute('initial-tool') || 'cube';
    // 'survival' (default): player character + reach-limited tools, camera
    // follows. 'creative': free camera, draw anywhere, no character.
    const mode = this.getAttribute('mode') === 'creative' ? 'creative' : 'survival';
    let cancelled = false;

    initSandWasm()
      .then(() => {
        if (cancelled || !this.isConnected) return;
        const game = createSandGame(sim, {
          initialTool,
          mode,
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
        if (coarse) this._dpad = createMobileDpad(root, game);
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
    this._dpad?.destroy();
    this._zoom?.destroy();
    setPageScrollLocked(false);
    this._game = this._palette = this._hud = this._sizeMenu = this._mp = this._dpad = this._zoom = null;
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
