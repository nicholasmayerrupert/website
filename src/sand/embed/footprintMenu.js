import { injectStyleOnce, swallowEvents } from './uiShared.js';

const STYLE = `
.fp-backdrop { position: fixed; inset: 0; z-index: 73; display: none; pointer-events: auto; }
.fp-backdrop.open { display: block; }
.fp-wrap { position: absolute; right: 14px; bottom: 14px; z-index: 74; pointer-events: none;
  font-family: ui-sans-serif, system-ui, sans-serif; }
.fp-panel { display: none; width: 196px; padding: 10px; border-radius: 8px;
  background: rgba(3,7,18,.84); border: 1px solid rgba(255,255,255,.14);
  box-shadow: 0 18px 28px -10px rgba(0,0,0,.55); backdrop-filter: blur(4px);
  pointer-events: auto; }
.fp-panel.open { display: block; }
.fp-head { margin: 0 0 8px; font-size: 11px; font-weight: 700; letter-spacing: 0; color: rgba(226,232,240,.8); }
.fp-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.fp-btn { min-height: 34px; border: 1px solid rgba(255,255,255,.12); border-radius: 6px;
  background: rgba(15,23,42,.72); color: #e2e8f0; font-size: 13px; font-weight: 700; cursor: pointer; }
.fp-btn:hover { border-color: rgba(255,255,255,.35); background: rgba(30,41,59,.86); }
.fp-btn.sel { border-color: #93c5fd; box-shadow: inset 0 0 0 1px rgba(147,197,253,.45); background: rgba(30,41,59,.95); color: #eff6ff; }
`;

export function createFootprintMenu(root, { selectFootprint } = {}) {
  injectStyleOnce(root, 'data-sand-footprints', STYLE);

  let open = false;
  let options = [];
  let selected = 0;
  let signature = '';

  const backdrop = document.createElement('div');
  backdrop.className = 'fp-backdrop';

  const wrap = document.createElement('div');
  wrap.className = 'fp-wrap';

  const panel = document.createElement('div');
  panel.className = 'fp-panel';

  const head = document.createElement('div');
  head.className = 'fp-head';
  head.textContent = 'Mining / Place Size';

  const list = document.createElement('div');
  list.className = 'fp-list';
  panel.append(head, list);
  wrap.appendChild(panel);

  swallowEvents(panel);
  swallowEvents(backdrop);
  panel.addEventListener('contextmenu', (e) => e.preventDefault());
  backdrop.addEventListener('contextmenu', (e) => e.preventDefault());
  backdrop.addEventListener('pointerdown', () => setOpen(false));

  function render() {
    list.replaceChildren();
    for (const fp of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fp-btn' + (fp.id === selected ? ' sel' : '');
      btn.textContent = `${fp.width}x${fp.height}`;
      btn.addEventListener('click', () => {
        selected = fp.id;
        signature = '';
        render();
        selectFootprint?.(fp.id);
        setOpen(false);
      });
      list.appendChild(btn);
    }
  }

  function setOpen(next) {
    open = !!next;
    panel.classList.toggle('open', open);
    backdrop.classList.toggle('open', open);
  }

  root.append(backdrop, wrap);
  return {
    update(nextOptions, nextSelected) {
      const nextOpts = Array.isArray(nextOptions) ? nextOptions : options;
      const nextSel = nextSelected ?? selected;
      const nextSig = `${nextSel}|${nextOpts.map((fp) => `${fp.id}:${fp.width}x${fp.height}:${fp.cellCount}`).join(',')}`;
      if (nextSig === signature) return;
      signature = nextSig;
      options = nextOpts;
      selected = nextSel;
      render();
    },
    setOpen,
    toggleOpen() { setOpen(!open); },
    isOpen() { return open; },
    destroy() {
      backdrop.remove();
      wrap.remove();
    },
  };
}
