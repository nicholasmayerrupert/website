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

const HOST_CSS = `
:host { position: absolute; inset: 0; display: block; pointer-events: none; }
.sg-sim { position: absolute; inset: 0; overflow: hidden; }
`;

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
    let cancelled = false;

    initSandWasm()
      .then(() => {
        if (cancelled || !this.isConnected) return;
        const game = createSandGame(sim, {
          initialTool,
          onLayoutChange: ({ uiAtBottom }) => this._palette?.setLayout(uiAtBottom),
        });
        this._game = game;
        this._palette = createToolPalette(root, {
          initialTool,
          onSelectTool: (id) => game.setTool(id),
          onToggleDrawMode: (on) => {
            game.setDrawMode(on);
            this.dispatchEvent(new CustomEvent('sand:drawmodechange', {
              detail: { on }, bubbles: true, composed: true,
            }));
          },
        });
        // Coarse-pointer (touch) devices keep draw off by default so the page
        // can still scroll; the palette toggle opts in.
        if (typeof window !== 'undefined' && window.matchMedia &&
            window.matchMedia('(pointer: coarse)').matches) {
          game.setDrawMode(false);
          this._palette.setDrawMode(false);
        }
      })
      .catch((e) => { console.error('sand-game: engine failed to init; staying blank', e); });

    this._cancel = () => { cancelled = true; };
  }

  disconnectedCallback() {
    this._cancel?.();
    this._game?.destroy();
    this._palette?.destroy();
    this._game = this._palette = null;
    this._mounted = false;
  }

  attributeChangedCallback(name, _old, value) {
    if (name === 'initial-tool' && value && this._game) {
      this._game.setTool(value);
      this._palette?.setTool(value);
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('sand-game')) {
  customElements.define('sand-game', SandGameElement);
}

export { SandGameElement };
