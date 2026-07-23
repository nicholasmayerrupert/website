import { injectStyleOnce, swallowEvents } from './uiShared.js';

const STYLE = `
.fp-backdrop { position: fixed; inset: 0; z-index: 73; display: none; pointer-events: auto; }
.fp-backdrop.open { display: block; }
.fp-wrap { position: absolute; right: 14px; bottom: 14px; z-index: 74; pointer-events: none;
  font-family: ui-monospace,"SFMono-Regular",Menlo,monospace; }
.fp-panel { display: none; width: 196px; padding: 10px; border-radius:0;
  background:#252b31; border:3px solid #0a0c0f;
  box-shadow:inset 0 0 0 2px #59636c,6px 6px 0 rgba(0,0,0,.45);
  pointer-events: auto; }
.fp-panel.open { display: block; }
.fp-head { margin:0 0 8px; font-size:10px; font-weight:800; letter-spacing:.12em; color:#f0d465; }
.fp-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.fp-btn { min-height:34px; border:2px solid #0d1013; border-radius:0;
  background:#161a1e; box-shadow:inset 2px 2px 0 #3c444b; color:#e2e8f0; font:800 12px ui-monospace,monospace; cursor:pointer; }
.fp-btn:hover { border-color:#9ba5ae; background:#22282d; }
.fp-btn.sel { border-color:#f0d465; box-shadow:inset 2px 2px 0 #fff1a0; color:#fff7c4; }
`;

export function createFootprintMenu(root, { selectFootprint } = {}) {
  injectStyleOnce(root, 'data-sand-footprints', STYLE);

  let open = false;
  let options = [];
  let selected = 0;
  let signature = '';
  let previousFocus = null;

  const backdrop = document.createElement('div');
  backdrop.className = 'fp-backdrop';

  const wrap = document.createElement('div');
  wrap.className = 'fp-wrap';

  const panel = document.createElement('div');
  panel.className = 'fp-panel';

  const head = document.createElement('div');
  head.className = 'fp-head';
  head.textContent = 'TOOL SIZE';

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
    const nextOpen = !!next;
    if (nextOpen === open) return;
    if (nextOpen) previousFocus = root.activeElement || document.activeElement;
    open = nextOpen;
    panel.classList.toggle('open', open);
    backdrop.classList.toggle('open', open);
    if (!open) {
      const target = previousFocus?.isConnected ? previousFocus : root.querySelector('.sg-sim');
      previousFocus = null;
      target?.focus?.({ preventScroll: true });
    }
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
