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
.sg-swatch { width: 36px; height: 36px; flex: none; border-radius: 6px; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(255,255,255,.18); background: rgba(10,14,22,.55); }
.sg-swatch.sm { width: 28px; height: 28px; }
.sg-mark { position: relative; display: inline-block; }
.sg-swatch.sm .sg-mark { transform: scale(.8); }
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

// A little built-up SHAPE per material (ported from the old React ToolPalette's
// renderToolMark, translated from Tailwind utilities to plain DOM + inline
// styles): a pile of sand grains, a teardrop for liquids, layered flames, a
// chipped stone, a sprouting seed, etc. — so the selector reads as the material
// rather than a flat color square. Built from absolutely-positioned spans inside
// a fixed-size relative box.
function renderToolMark(id) {
  const box = document.createElement('span');
  box.className = 'sg-mark';
  const size = (w, h) => { box.style.width = w + 'px'; box.style.height = h + 'px'; };
  const part = (css) => { const s = document.createElement('span'); s.style.cssText = 'position:absolute;display:block;' + css; box.appendChild(s); return s; };
  const drop = (w, h, bg, glow, ring) =>
    part(`inset:0;width:${w}px;height:${h}px;border-radius:60% 60% 70% 70%;background:${bg};transform:rotate(45deg);`
      + `box-shadow:inset 3px 4px 0 rgba(255,255,255,.26),0 0 8px ${glow}${ring ? ',0 0 0 1px ' + ring : ''};`);
  const flame = (bg, mid, hot, glow) => {
    part(`left:4px;bottom:0;width:16px;height:20px;border-radius:70% 30% 70% 40%;background:${bg};transform:rotate(45deg);box-shadow:0 0 9px ${glow};`);
    part(`left:7px;bottom:8px;width:12px;height:16px;border-radius:70% 30% 70% 40%;background:${mid};transform:rotate(45deg);`);
    part(`left:5px;bottom:13px;width:9px;height:11px;border-radius:70% 30% 70% 40%;background:${hot};transform:rotate(45deg);`);
  };
  switch (id) {
    case 'sand': {
      size(28, 24);
      const dot = (l, b, c) => part(`left:${l}px;bottom:${b}px;width:6px;height:6px;border-radius:9999px;background:${c};`);
      dot(4, 4, 'rgba(254,240,138,.9)'); dot(12, 4, 'rgba(252,211,77,.9)'); dot(20, 4, 'rgba(253,224,71,.8)');
      dot(8, 7, 'rgba(253,224,71,.9)'); dot(16, 7, 'rgba(254,240,138,.85)'); dot(12, 13, 'rgba(254,249,195,.9)');
      part('left:0;bottom:0;width:28px;height:2px;border-radius:9999px;background:rgba(161,98,7,.45);');
      break;
    }
    case 'water': size(20, 24); drop(20, 24, 'rgba(96,165,250,.8)', 'rgba(96,165,250,.35)'); break;
    case 'oil': size(20, 24); drop(20, 24, 'rgba(69,26,3,.9)', 'rgba(120,53,15,.35)', 'rgba(180,83,9,.4)'); break;
    case 'acid': size(20, 24); drop(20, 24, 'rgba(163,230,53,.85)', 'rgba(132,204,22,.45)', 'rgba(190,242,100,.4)'); break;
    case 'fire': size(20, 28); flame('rgba(249,115,22,.9)', 'rgba(253,224,71,.9)', 'rgba(239,68,68,.75)', 'rgba(251,146,60,.45)'); break;
    case 'lava': size(20, 28); flame('rgba(220,38,38,.9)', 'rgba(251,146,60,.9)', 'rgba(253,224,71,.8)', 'rgba(239,68,68,.5)'); break;
    case 'stone':
      size(24, 24);
      part('left:4px;bottom:4px;width:20px;height:16px;border-radius:4px;background:rgba(156,163,175,.85);box-shadow:inset 2px 2px 0 rgba(255,255,255,.18);transform:rotate(-8deg);');
      part('left:9px;bottom:5px;width:3px;height:3px;border-radius:9999px;background:rgba(55,65,81,.35);');
      part('left:5px;bottom:11px;width:6px;height:2px;border-radius:9999px;background:rgba(243,244,246,.25);');
      break;
    case 'cube':
      size(24, 24);
      part('left:4px;bottom:4px;width:16px;height:16px;border-radius:3px;background:rgba(214,211,209,.85);box-shadow:inset 2px 2px 0 rgba(255,255,255,.28),0 0 6px rgba(168,162,158,.35);transform:rotate(18deg);');
      part('left:7px;bottom:10px;width:7px;height:2px;border-radius:9999px;background:rgba(255,255,255,.3);transform:rotate(18deg);');
      break;
    case 'seed':
      size(24, 24);
      part('left:8px;bottom:4px;width:16px;height:12px;border-radius:55% 45% 55% 45%;background:rgba(120,53,15,.85);box-shadow:inset 2px 2px 0 rgba(255,255,255,.16);transform:rotate(-20deg);');
      part('left:12px;bottom:12px;width:8px;height:12px;border-radius:9999px;background:rgba(74,222,128,.8);transform:rotate(45deg);');
      part('left:9px;bottom:15px;width:6px;height:8px;border-radius:9999px;background:rgba(190,242,100,.75);transform:rotate(-35deg);');
      break;
    case 'driftwood':
      size(24, 24);
      part('left:0;bottom:8px;width:24px;height:8px;border-radius:3px;background:rgba(120,113,108,.85);box-shadow:inset 2px 2px 0 rgba(255,255,255,.18);transform:rotate(-10deg);');
      part('left:4px;bottom:11px;width:16px;height:2px;border-radius:9999px;background:rgba(214,211,209,.35);transform:rotate(-10deg);');
      part('left:8px;bottom:7px;width:12px;height:2px;border-radius:9999px;background:rgba(41,37,36,.35);transform:rotate(-10deg);');
      break;
    case 'ice':
      size(24, 24);
      part('left:4px;bottom:4px;width:16px;height:16px;border-radius:4px;background:rgba(165,243,252,.85);box-shadow:inset 2px 2px 0 rgba(255,255,255,.4),0 0 7px rgba(103,232,249,.4);transform:rotate(12deg);');
      part('left:6px;bottom:7px;width:7px;height:2px;border-radius:9999px;background:rgba(255,255,255,.55);transform:rotate(12deg);');
      part('left:8px;bottom:11px;width:2px;height:6px;border-radius:9999px;background:rgba(255,255,255,.45);transform:rotate(12deg);');
      break;
    case 'eraser':
      size(24, 24);
      part('left:4px;bottom:8px;width:20px;height:14px;border-radius:4px;background:rgba(254,205,211,.9);box-shadow:inset 2px 2px 0 rgba(255,255,255,.35);transform:rotate(-28deg);');
      part('left:13px;bottom:10px;width:2px;height:14px;border-radius:9999px;background:rgba(244,63,94,.45);transform:rotate(-28deg);');
      part('left:4px;bottom:4px;width:20px;height:2px;border-radius:9999px;background:rgba(255,255,255,.35);');
      break;
    default:
      size(22, 22);
      part(`inset:0;width:22px;height:22px;border-radius:6px;background:${(TOOLS.find((t) => t.id === id) || {}).color || '#888'};`);
  }
  return box;
}

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
  // Don't let palette pointer events reach the window-level game input handlers.
  // pointermove MUST be included: when a press starts on a palette button the
  // browser implicitly captures the pointer to that button, so every move (and the
  // closing pointerup) is delivered to the button — inside `wrap` — until release.
  // If pointermove were allowed through, dragging off the open dropdown onto the
  // canvas while still holding would hit the window's onPointerMove, which does
  // `mouseButtons |= e.buttons` and latches the LMB bit. The matching pointerup is
  // captured back to the button and stopped here, so that latch is never cleared —
  // leaving PI_PRIMARY stuck on, which makes a freshly-selected paint/eraser tool
  // act as if the mouse is held. Stopping pointermove too closes that gap.
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'click', 'contextmenu']) {
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
    selBtn.querySelector('.sg-swatch').replaceChildren(renderToolMark(selected));
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
      const sw = document.createElement('span');
      sw.className = 'sg-swatch sm';
      sw.appendChild(renderToolMark(t.id));
      const lbl = document.createElement('span');
      lbl.textContent = t.label;
      opt.append(sw, lbl);
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
