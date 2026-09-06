import { MATERIALS, MAT_FLAGS, MF } from '../materials.generated.js';
import { POOL_ACTION } from '../wasmBridge/abi.generated.js';
import { packedToRgb } from './uiShared.js';

export const POOL_NAMES = ['', 'Building materials', 'Powders', 'Liquids'];
const names = new Map(MATERIALS.map((m) => [m.id, m.name.toLowerCase().replaceAll('_', ' ')]));
const number = new Intl.NumberFormat();
const materials = new Map(MATERIALS.map((m) => [m.id, m]));

export function poolIcon(pool, size = 30) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  const color = ['#ccc', '#d2b68b', '#e7cc74', '#70cfe8'][pool];
  const bag = document.createElementNS(ns, 'path');
  bag.setAttribute('d', 'M5 1h6l-1 3 4 4v6l-2 1H4l-2-1V8l4-4z');
  bag.setAttribute('fill', '#353d43'); bag.setAttribute('stroke', color);
  const tie = document.createElementNS(ns, 'path');
  tie.setAttribute('d', 'M5 4h6'); tie.setAttribute('stroke', color);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('fill', color);
  path.setAttribute('transform', 'translate(3.2 5) scale(.6)');
  path.setAttribute('d', [
    '',
    'M3 4h4v4H3z M9 4h4v4H9z M6 9h4v4H6z',
    'M7 3h2v2H7z M4 7h2v2H4z M10 7h2v2h-2z M2 11h2v2H2z M7 11h2v2H7z M12 11h2v2h-2z',
    'M8 2L3 9v3l2 2h6l2-2V9z',
  ][pool] || '');
  svg.append(bag, tie, path);
  return svg;
}

export function createInventoryPools({ poolAction }) {
  const el = document.createElement('section'); el.className = 'inv-pools';
  el.setAttribute('aria-label', 'Material pools');
  const tabs = document.createElement('div'); tabs.className = 'pool-tabs';
  const heading = document.createElement('h2'); heading.className = 'pool-heading';
  const summary = document.createElement('p'); summary.className = 'pool-summary';
  const controls = document.createElement('div'); controls.className = 'pool-controls';
  const label = document.createElement('label'); label.textContent = 'Place ';
  const select = document.createElement('select'); select.setAttribute('aria-label', 'Pool placement mode');
  label.append(select);
  const deposit = document.createElement('button'); deposit.type = 'button'; deposit.textContent = 'Store stacks';
  deposit.title = 'Move matching ordinary inventory stacks into this pool';
  controls.append(label, deposit);
  const list = document.createElement('div'); list.className = 'pool-list';
  const sorting = document.createElement('div'); sorting.className = 'pool-controls';
  const sortLabel = document.createElement('label'); sortLabel.textContent = 'Sort materials ';
  const sort = document.createElement('select'); sort.setAttribute('aria-label', 'Sort materials');
  for (const [value, text] of [['queue', 'Queue order'], ['name', 'Name A–Z'], ['count', 'Amount: most first'],
    ['density', 'Density: lightest first'], ['durability', 'Hardness: softest first'], ['flammable', 'Flammable first'], ['hazard', 'Hazardous first']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = text; sort.append(option);
  }
  const applySort = document.createElement('button'); applySort.type = 'button'; applySort.textContent = 'Use as queue';
  sortLabel.append(sort); sorting.append(sortLabel, applySort);
  const empty = document.createElement('p'); empty.className = 'pool-help'; empty.textContent = 'Collect materials to fill this pool. Capacity is unlimited.';
  el.append(tabs, heading, summary, controls, sorting, empty, list);
  let inventory = null, active = 1, selectedSlot = -1, optionKey = '';
  const rows = new Map();
  const send = (action, material = 0, value = 0) => poolAction?.(active, action, material, value);
  const tabButtons = POOL_NAMES.slice(1).map((name, i) => {
    const button = document.createElement('button'); button.type = 'button';
    button.append(poolIcon(i + 1, 20), document.createTextNode(name));
    button.addEventListener('click', () => { active = i + 1; render(); });
    tabs.append(button); return button;
  });
  select.addEventListener('change', () => send(POOL_ACTION.SELECT, Number(select.value)));
  deposit.addEventListener('click', () => send(POOL_ACTION.DEPOSIT));
  sort.addEventListener('change', render);
  function sorted(entries) {
    if (sort.value === 'queue') return entries;
    const value = (entry) => {
      if (sort.value === 'count') return -entry.count;
      if (sort.value === 'flammable') return -(!!(MAT_FLAGS[entry.material] & MF.flammable));
      if (sort.value === 'hazard') return -(!!(MAT_FLAGS[entry.material] & MF.spawnHazard));
      return materials.get(entry.material)[sort.value];
    };
    return [...entries].sort((a, b) => (sort.value === 'name'
      ? names.get(a.material).localeCompare(names.get(b.material)) : value(a) - value(b)));
  }
  applySort.addEventListener('click', () => {
    const entries = inventory?.pools?.find((p) => p.id === active)?.entries || [];
    sorted(entries.filter((entry) => entry.count > 0)).forEach((entry, index) => send(POOL_ACTION.MOVE, entry.material, index));
    sort.value = 'queue'; render();
  });

  function render() {
    const pool = inventory?.pools?.find((p) => p.id === active);
    for (let i = 0; i < tabButtons.length; i++) {
      tabButtons[i].setAttribute('aria-pressed', String(active === i + 1));
      tabButtons[i].disabled = !inventory?.pools?.some((p) => p.id === i + 1);
    }
    const stored = pool?.entries || [];
    const entries = stored.filter((entry) => entry.count > 0);
    heading.textContent = `${POOL_NAMES[active]} bag`;
    summary.textContent = `${number.format(entries.reduce((n, row) => n + row.count, 0))} stored · ${entries.filter((row) => row.enabled).length} enabled / ${entries.length} materials`;
    applySort.disabled = sort.value === 'queue' || entries.length < 2;
    const depletedSelection = pool?.exactMaterial && !entries.some((entry) => entry.material === pool.exactMaterial);
    const key = `${active}:${depletedSelection ? pool.exactMaterial : 0}:${entries.map((row) => row.material).join(',')}`;
    if (key !== optionKey) {
      optionKey = key;
      select.replaceChildren();
      for (const [value, text] of [[0, 'Auto — follow queue'], ...entries.map((row) => [row.material, names.get(row.material)])]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text;
        select.append(option);
      }
      if (depletedSelection) {
        const option = document.createElement('option'); option.value = pool.exactMaterial;
        option.textContent = 'Selected material depleted'; option.disabled = true; select.append(option);
      }
    }
    select.value = String(pool?.exactMaterial || 0);
    select.disabled = !pool;
    deposit.disabled = !pool;
    empty.hidden = entries.length > 0;
    const wanted = new Set(entries.map((row) => `${active}:${row.material}`));
    for (const [id, row] of rows) if (!wanted.has(id)) { row.el.remove(); rows.delete(id); }
    const displayed = sorted(entries);
    for (let index = 0; index < displayed.length; index++) {
      const entry = displayed[index], id = `${active}:${entry.material}`;
      let row = rows.get(id);
      if (!row) {
        const item = document.createElement('div'); item.className = 'pool-row'; item.dataset.material = entry.material;
        const enabled = document.createElement('input'); enabled.type = 'checkbox';
        enabled.setAttribute('aria-label', `Use ${names.get(entry.material)} in Auto`);
        enabled.addEventListener('change', () => send(POOL_ACTION.ENABLE, entry.material, enabled.checked ? 1 : 0));
        const status = document.createElement('label'); status.className = 'pool-status';
        const state = document.createElement('span'); status.append(enabled, state);
        const rank = document.createElement('span'); rank.className = 'pool-rank';
        const name = document.createElement('span'); name.className = 'pool-material'; name.textContent = names.get(entry.material);
        const swatch = document.createElement('span'); swatch.className = 'pool-swatch';
        const material = materials.get(entry.material);
        swatch.style.background = packedToRgb(material.color);
        const properties = document.createElement('small'); properties.className = 'pool-properties';
        properties.textContent = `Density ${material.density} · Hardness ${material.durability}${MAT_FLAGS[entry.material] & MF.flammable ? ' · Flammable' : ''}${MAT_FLAGS[entry.material] & MF.spawnHazard ? ' · Hazardous' : ''}`;
        const description = document.createElement('span'); description.append(name, properties);
        const count = document.createElement('span'); count.className = 'pool-count';
        const up = document.createElement('button'); up.type = 'button'; up.textContent = '↑';
        up.setAttribute('aria-label', `Move ${names.get(entry.material)} earlier`);
        const down = document.createElement('button'); down.type = 'button'; down.textContent = '↓';
        down.setAttribute('aria-label', `Move ${names.get(entry.material)} later`);
        const withdraw = document.createElement('button'); withdraw.type = 'button'; withdraw.textContent = 'Take';
        withdraw.setAttribute('aria-label', `Withdraw ${names.get(entry.material)}`);
        withdraw.title = 'Take up to 999 into the cursor. Shift-click takes one.';
        row = { el: item, enabled, state, rank, count, up, down, withdraw, index };
        up.addEventListener('click', () => send(POOL_ACTION.MOVE, entry.material, row.upTarget));
        down.addEventListener('click', () => send(POOL_ACTION.MOVE, entry.material, row.downTarget));
        withdraw.addEventListener('click', (event) => send(POOL_ACTION.WITHDRAW, entry.material, event.shiftKey ? 1 : 999));
        item.append(rank, status, swatch, description, count, up, down, withdraw); rows.set(id, row);
      }
      row.index = entries.indexOf(entry); row.enabled.checked = entry.enabled;
      row.upTarget = stored.indexOf(entries[row.index - 1]);
      row.downTarget = stored.indexOf(entries[row.index + 1]);
      row.rank.textContent = `${row.index + 1}`;
      row.rank.title = `Queue position ${row.index + 1}`;
      row.state.textContent = entry.enabled ? 'Enabled' : 'Disabled';
      row.count.textContent = number.format(entry.count);
      row.up.disabled = row.index === 0; row.down.disabled = row.index === entries.length - 1;
      row.withdraw.disabled = entry.count <= 0;
      row.el.classList.toggle('pool-excluded', !entry.enabled);
      row.el.classList.toggle('pool-current', (pool.exactMaterial
        ? pool.exactMaterial === entry.material
        : entries.find((e) => e.enabled && e.count > 0)?.material === entry.material));
      if (list.children[index] !== row.el) list.insertBefore(row.el, list.children[index] || null);
    }
  }
  return {
    el,
    open(pool) { active = pool; sort.value = 'queue'; render(); select.focus({ preventScroll: true }); },
    update(inv) {
      inventory = inv;
      if (inv?.selected !== selectedSlot) {
        selectedSlot = inv?.selected;
        active = inv?.slots?.[selectedSlot]?.pool || active;
      }
      render();
    },
  };
}
