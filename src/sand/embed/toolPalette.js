// Framework-free tool palette for the sand game. Builds plain DOM into a host
// root (a Web Component's shadow root) with a single injected <style> — no React
// and no Tailwind on the host page. Pure callbacks out: it owns the visible UI
// state (selected tool, draw on/off, layout) and calls onSelectTool /
// onToggleDrawMode; the caller wires those into the runtime.
//
// The 12 tools mirror `enum Tool` in cpp/engine/common.hpp (same order/ids). The
// per-tool swatch color is decorative (presentation lives in the view layer).

const TOOLS = [
  { id: 'cube', label: 'Cube', title: 'Cube (click to drop a tumbling rigid body)', color: '#d6d3d1' },
  { id: 'sand', label: 'Sand', title: 'Sand (hold LMB)', color: '#fcd34d' },
  { id: 'water', label: 'Water', title: 'Water (hold LMB)', color: '#60a5fa' },
  { id: 'oil', label: 'Oil', title: 'Oil (hold LMB)', color: '#78350f' },
  { id: 'fire', label: 'Fire', title: 'Fire (hold LMB)', color: '#f97316' },
  { id: 'stone', label: 'Stone', title: 'Stone (hold to draft, release to drop)', color: '#9ca3af' },
  { id: 'seed', label: 'Seed', title: 'Seed (hold to place, release to drop)', color: '#4ade80' },
  { id: 'driftwood', label: 'Driftwood', title: 'Driftwood (hold to draft, release to drop) — wood-like, does not grow', color: '#a8a29e' },
  { id: 'acid', label: 'Acid', title: 'Acid (hold LMB)', color: '#a3e635' },
  { id: 'lava', label: 'Lava', title: 'Lava (hold LMB)', color: '#ef4444' },
  { id: 'ice', label: 'Ice', title: 'Ice (hold to draft, release to drop)', color: '#a5f3fc' },
  { id: 'eraser', label: 'Eraser', title: 'Eraser (hold LMB, or hold RMB anytime)', color: '#fecdd3' },
];

const STYLE = `
.sg-palette { position: absolute; z-index: 70; box-sizing: border-box; font-family: ui-sans-serif, system-ui, sans-serif;
  background: rgba(17,24,39,.3); border-radius: 8px; padding: 8px; backdrop-filter: blur(4px);
  box-shadow: 0 10px 15px -3px rgba(0,0,0,.3); pointer-events: auto; max-width: calc(100vw - 1.5rem); }
.sg-palette.side { left: 16px; top: 50%; transform: translateY(-50%); }
.sg-palette.bottom { bottom: 12px; left: 50%; transform: translateX(-50%); }
.sg-col { display: flex; flex-direction: column; gap: 8px; }
.sg-selbtn { width: 192px; max-width: calc(100vw - 2.5rem); border-radius: 6px; padding: 8px; text-align: left;
  border: 1px solid rgba(255,255,255,.15); background: rgba(31,41,55,.7); color: #fff; cursor: pointer; }
.sg-selbtn:hover { background: rgba(31,41,55,.85); }
.sg-dim { opacity: .45; }
.sg-cap { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #d1d5db; }
.sg-row { margin-top: 4px; display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
.sg-swatch { width: 36px; height: 36px; flex: none; border-radius: 6px; display: inline-block;
  border: 1px solid rgba(255,255,255,.2); box-shadow: inset 2px 2px 0 rgba(255,255,255,.25); }
.sg-swatch.sm { width: 28px; height: 28px; }
.sg-caret { margin-left: auto; color: #d1d5db; }
.sg-menu { position: absolute; z-index: 80; width: 192px; max-width: calc(100vw - 2.5rem);
  border-radius: 6px; background: rgba(3,7,18,.95); padding: 4px; box-shadow: 0 20px 25px -5px rgba(0,0,0,.5);
  border: 1px solid rgba(255,255,255,.15); backdrop-filter: blur(4px); }
.sg-menu.side { left: 0; top: 100%; margin-top: 8px; }
.sg-menu.bottom { left: 0; bottom: 100%; margin-bottom: 8px; }
.sg-opt { display: flex; width: 100%; align-items: center; gap: 8px; border: 0; background: transparent;
  border-radius: 4px; padding: 6px 8px; text-align: left; font-size: 14px; color: #e5e7eb; cursor: pointer; }
.sg-opt:hover { background: rgba(255,255,255,.1); }
.sg-opt.active { background: rgba(255,255,255,.15); color: #fff; }
.sg-toggle { border-radius: 6px; padding: 4px 8px; font-size: 10px; font-weight: 600; border: 0; cursor: pointer;
  background: rgba(255,255,255,.1); color: #fff; }
.sg-toggle:hover { background: rgba(255,255,255,.2); }
.sg-toggle.on { background: rgba(255,255,255,.8); color: #000; }
.sg-toggle.on:hover { background: #fff; }
`;

export function createToolPalette(root, { initialTool = 'cube', onSelectTool, onToggleDrawMode } = {}) {
  if (!root.querySelector('style[data-sand-palette]')) {
    const s = document.createElement('style');
    s.setAttribute('data-sand-palette', '');
    s.textContent = STYLE;
    root.appendChild(s);
  }
  let selected = initialTool;
  let drawOn = false;
  let atBottom = false;
  let open = false;

  const tool = (id) => TOOLS.find((t) => t.id === id) || TOOLS[0];

  const wrap = document.createElement('div');
  wrap.className = 'sg-palette side';
  // Don't let palette clicks reach the window-level game input handlers.
  for (const ev of ['pointerdown', 'pointerup', 'click', 'contextmenu']) {
    wrap.addEventListener(ev, (e) => e.stopPropagation());
  }

  const col = document.createElement('div');
  col.className = 'sg-col';
  wrap.appendChild(col);

  const selWrap = document.createElement('div');
  selWrap.style.position = 'relative';
  col.appendChild(selWrap);

  const selBtn = document.createElement('button');
  selBtn.type = 'button';
  selBtn.className = 'sg-selbtn';
  selBtn.innerHTML = `<span class="sg-cap">Currently selected material</span>
    <span class="sg-row"><span class="sg-swatch"></span><span class="sg-name"></span><span class="sg-caret">v</span></span>`;
  selBtn.addEventListener('click', () => { open = !open; renderMenu(); });
  selWrap.appendChild(selBtn);

  let menu = null;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'sg-toggle';
  toggle.addEventListener('click', () => { drawOn = !drawOn; onToggleDrawMode?.(drawOn); renderState(); });
  col.appendChild(toggle);

  function renderState() {
    const t = tool(selected);
    selBtn.querySelector('.sg-swatch').style.background = t.color;
    selBtn.querySelector('.sg-name').textContent = t.label;
    selBtn.title = t.title;
    selWrap.style.opacity = drawOn ? '1' : '.45';
    toggle.textContent = `Draw ${drawOn ? 'On' : 'Off'}`;
    toggle.className = `sg-toggle${drawOn ? ' on' : ''}`;
    toggle.title = drawOn ? 'Disable drawing so the page scrolls normally' : 'Enable drawing in the physics simulation';
    wrap.className = `sg-palette ${atBottom ? 'bottom' : 'side'}`;
    col.style.flexDirection = 'column';
  }

  function renderMenu() {
    if (menu) { menu.remove(); menu = null; }
    if (!open) return;
    menu = document.createElement('div');
    menu.className = `sg-menu ${atBottom ? 'bottom' : 'side'}`;
    for (const t of TOOLS) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = `sg-opt${t.id === selected ? ' active' : ''}`;
      opt.title = t.title;
      opt.innerHTML = `<span class="sg-swatch sm" style="background:${t.color}"></span><span>${t.label}</span>`;
      opt.addEventListener('click', () => {
        selected = t.id; open = false;
        onSelectTool?.(t.id); renderState(); renderMenu();
      });
      menu.appendChild(opt);
    }
    selWrap.appendChild(menu);
  }

  root.appendChild(wrap);
  renderState();

  return {
    el: wrap,
    setTool(id) { selected = id; renderState(); renderMenu(); },
    setDrawMode(on) { drawOn = !!on; renderState(); },
    setLayout(uiAtBottom) { atBottom = !!uiAtBottom; renderState(); renderMenu(); },
    destroy() { wrap.remove(); },
  };
}
