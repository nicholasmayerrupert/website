import { injectStyleOnce, swallowEvents } from './uiShared.js';

let nextId = 0;
const STYLE = `
.game-select {position:relative;display:inline-block;min-width:130px}
.game-select>button {display:flex;align-items:center;justify-content:space-between;gap:18px;width:100%;padding:7px 10px!important;border:1px solid #737652!important;background:#18271e!important;color:#dce1cc!important;font:14px 'Sand Pixel',monospace!important;text-align:left;cursor:pointer}
.game-select>button::after {content:'⌄';color:#d5bd83}.game-select>button:disabled{opacity:.45;cursor:default}
.game-select-menu {pointer-events:auto;position:fixed;z-index:2100;box-sizing:border-box;overflow:auto;max-height:260px;min-width:160px;padding:5px;border:1px solid #b19b69;background:#14231b;box-shadow:0 8px 24px #0008;scrollbar-color:#7f8058 #14231b}
.game-select-menu[hidden]{display:none}.game-select-menu [role=option] {display:block;width:100%;border:0;background:none;color:#dce1cc;padding:8px 10px;text-align:left;font:14px/1.4 'Sand Pixel',monospace!important;cursor:pointer}
.game-select-menu [role=option][aria-selected=true] {color:#ecd598}.game-select-menu [role=option].highlighted,.game-select-menu [role=option]:hover{background:#3b4b2e;outline:0}.game-select-menu [role=option]:disabled{opacity:.45;cursor:default}
`;

export function createGameSelect(root, { label, options = [], onChange } = {}) {
  injectStyleOnce(root, 'data-game-select', STYLE);
  const el = document.createElement('span'); el.className = 'game-select';
  const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'combobox');
  button.setAttribute('aria-label', label); button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div'); menu.className = 'game-select-menu'; menu.hidden = true;
  menu.id = `game-select-${++nextId}`; menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', label);
  button.setAttribute('aria-controls', menu.id); el.append(button); root.append(menu); swallowEvents(menu);
  let items = [], value = '', highlighted = 0, query = '', queryAt = 0;
  function close() { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); button.removeAttribute('aria-activedescendant'); }
  function mark(index) {
    highlighted = index;
    [...menu.children].forEach((node, i) => node.classList.toggle('highlighted', i === index));
    if (menu.children[index]) {
      button.setAttribute('aria-activedescendant', menu.children[index].id);
      menu.children[index].scrollIntoView({ block: 'nearest' });
    }
  }
  function choose(index) {
    if (items[index]?.disabled) return;
    api.value = items[index].value; close(); button.focus({ preventScroll: true }); onChange?.(value);
  }
  function show() {
    if (button.disabled) return;
    menu.hidden = false; button.setAttribute('aria-expanded', 'true');
    const box = button.getBoundingClientRect();
    menu.style.width = `${Math.min(Math.max(box.width, 190), innerWidth - 24)}px`;
    menu.style.maxHeight = `${Math.min(260, Math.max(box.top - 12, innerHeight - box.bottom - 12))}px`;
    const height = menu.getBoundingClientRect().height;
    menu.style.left = `${Math.max(12, Math.min(box.left, innerWidth - menu.offsetWidth - 12))}px`;
    menu.style.top = `${box.bottom + height + 6 < innerHeight ? box.bottom + 5 : Math.max(12, box.top - height - 5)}px`;
    mark(Math.max(0, items.findIndex(item => item.value === value)));
  }
  button.addEventListener('click', () => menu.hidden ? show() : close());
  button.addEventListener('keydown', event => {
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'Escape') { if (!menu.hidden) { event.preventDefault(); event.stopPropagation(); close(); } return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (menu.hidden) { show(); return; }
      if (event.key === 'Enter' || event.key === ' ') { choose(highlighted); return; }
      const dir = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1;
      let index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (highlighted + dir + items.length) % items.length;
      for (let i = 0; i < items.length && items[index]?.disabled; i++) index = (index + dir + items.length) % items.length;
      mark(index);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      event.preventDefault(); event.stopPropagation();
      query = performance.now() - queryAt > 600 ? event.key : query + event.key; queryAt = performance.now();
      if (menu.hidden) show();
      const index = items.findIndex(item => !item.disabled && item.label.toLowerCase().startsWith(query.toLowerCase()));
      if (index >= 0) mark(index);
    }
  });
  const outside = event => { if (!event.composedPath().includes(el) && !event.composedPath().includes(menu)) close(); };
  const scrolled = event => { if (!menu.contains(event.target)) close(); };
  root.addEventListener('pointerdown', outside, true); root.addEventListener('scroll', scrolled, true); window.addEventListener('resize', close);
  const api = {
    el, close,
    get value() { return value; },
    set value(next) {
      value = String(next); button.dataset.value = value;
      button.textContent = items.find(item => item.value === value)?.label || label;
      [...menu.children].forEach((node, index) => node.setAttribute('aria-selected', String(items[index].value === value)));
    },
    set disabled(next) { button.disabled = next; if (next) close(); },
    focus() { button.focus({ preventScroll: true }); },
    setOptions(next) {
      close(); items = next.map(item => ({ ...item, value: String(item.value) }));
      menu.replaceChildren(...items.map((item, index) => {
        const option = document.createElement('button'); option.type = 'button'; option.tabIndex = -1;
        option.id = `${menu.id}-${index}`; option.setAttribute('role', 'option'); option.textContent = item.label; option.disabled = !!item.disabled;
        option.addEventListener('pointerdown', event => event.preventDefault()); option.addEventListener('click', () => choose(index)); return option;
      }));
      api.value = items.some(item => item.value === value) ? value : items[0]?.value || '';
    },
    destroy() { root.removeEventListener('pointerdown', outside, true); root.removeEventListener('scroll', scrolled, true); window.removeEventListener('resize', close); menu.remove(); el.remove(); },
  };
  api.setOptions(options); return api;
}
