import { EQUIPMENT_BY_ID, GEAR_FAMILY } from '../content/equipment.js';

const node = (tag, className, text) => {
  const el = document.createElement(tag); el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};
const button = (text, action) => {
  const el = node('button', '', text); el.type = 'button'; el.addEventListener('click', action); return el;
};

// The pack keeps its engine slot order; filters only change visual emphasis.
export function createInventoryWorkspace(inventory, game, { equipment, wands, footprint, chest }) {
  const smallScreen = matchMedia('(max-width: 760px)');
  const hud = inventory.el, find = selector => hud.querySelector(selector);
  const pack = node('section', 'inv-pack'), work = node('section', 'inv-work');
  pack.setAttribute('aria-label', 'Pack and quickbar');
  const navigation = node('nav', 'inv-work-tabs'); navigation.setAttribute('aria-label', 'Inventory sections');
  const panels = {
    chest: node('div', 'inv-work-panel'), equipment: node('div', 'inv-work-panel'), wands: node('div', 'inv-work-panel'),
    craft: node('div', 'inv-work-panel'), materials: node('div', 'inv-work-panel'),
  };
  panels.chest.append(chest);
  panels.equipment.append(equipment);
  const wandEmpty = node('p', 'inv-work-empty', 'Find a wand to start arranging spells and upgrades.');
  panels.wands.append(wands, wandEmpty);
  panels.craft.append(find('.craft-panel'));
  panels.materials.append(find('.inv-pools'), footprint);
  const tabs = {};
  let active = smallScreen.matches ? 'pack' : 'equipment', inspected = -1, chestOpen = false;
  for (const [id, label] of Object.entries({ pack: 'Pack', chest: 'Chest', equipment: 'Equipment', wands: 'Wands', craft: 'Crafting', materials: 'Materials' })) {
    const tab = button(label, () => show(id)); tab.dataset.section = id;
    tab.setAttribute('aria-controls', `inv-view-${id}`); tabs[id] = tab; navigation.append(tab);
    if (panels[id]) { panels[id].id = `inv-view-${id}`; work.append(panels[id]); }
  }
  tabs.chest.hidden = true;
  pack.id = 'inv-view-pack';
  const searchRow = node('div', 'inv-search-row');
  const search = node('input', 'inv-search'); search.type = 'search'; search.placeholder = 'Find an item…'; search.setAttribute('aria-label', 'Search inventory');
  const clear = button('×', () => { search.value = ''; category = 'all'; refresh(); search.focus(); }); clear.setAttribute('aria-label', 'Clear item filters');
  searchRow.append(search, clear);
  const filters = node('div', 'inv-filters'); filters.setAttribute('aria-label', 'Item filters');
  let category = 'all';
  const filterButtons = {};
  for (const [id, label] of Object.entries({ all: 'All', gear: 'Gear', runes: 'Runes', supplies: 'Supplies' })) {
    const item = button(label, () => { category = id; refresh(); }); filterButtons[id] = item; filters.append(item);
  }
  const result = node('span', 'inv-search-result'); result.setAttribute('role', 'status'); filters.append(result);
  const quickHeading = node('div', 'inv-quick-heading'); quickHeading.append(node('h3', '', 'Quickbar'), node('span', '', smallScreen.matches ? 'Swipe · 9 slots' : '1–9 · Ready to use'));
  pack.append(find('.inv-pack-heading'), searchRow, filters, find('.inv-grid'), quickHeading, find('.inv-bar'));
  const shortcuts = find('.inv-bag-shortcuts');
  shortcuts.prepend(node('span', '', 'Material bags')); pack.append(shortcuts);
  const inspector = node('section', 'inv-inspector'); inspector.setAttribute('aria-label', 'Selected item');
  const itemIcon = node('div', 'inv-inspect-icon'), itemText = node('div', 'inv-inspect-text');
  const itemName = node('strong', '', 'Inspect an item'), itemStats = node('p', '', 'Hover or tap an item to inspect it.');
  itemText.append(itemName, itemStats);
  const actions = node('div', 'inv-item-actions');
  const transfer = button('Move to quickbar', () => { inventory.quickMove(inspected); refresh(); });
  const split = button('Split stack', () => { inventory.pickSlot(inspected, true); refresh(); });
  const pickup = button('Pick up', () => {
    const stack = game.getInventory().slots[inspected];
    if (stack?.pool) inventory.openBag(stack.pool); else inventory.pickSlot(inspected);
    refresh();
  });
  actions.append(transfer, split, pickup); inspector.append(itemIcon, itemText, actions);
  const drop = find('.inv-drop-zone');
  hud.append(navigation, pack, work, inspector, drop);
  const craftSearch = node('input', 'inv-search'); craftSearch.type = 'search'; craftSearch.placeholder = 'Find a recipe…'; craftSearch.setAttribute('aria-label', 'Search recipes');
  const craftControls = node('div', 'inv-craft-controls'), craftToggle = node('input', ''); craftToggle.type = 'checkbox';
  const craftLabel = node('label', ''); craftLabel.append(craftToggle, document.createTextNode('Ready to craft'));
  const craftEmpty = node('p', 'inv-work-empty', 'No recipes match. Try another search or turn off “Ready to craft”.');
  craftControls.append(craftSearch, craftLabel); find('.craft-title').after(craftControls); find('.craft-list').after(craftEmpty);
  const recipeVisibility = new WeakMap();
  const recipeButtons = [...find('.craft-list').children];
  function filterRecipes() {
    let count = 0;
    for (const el of recipeButtons) {
      el.hidden = recipeVisibility.get(el) || !el.querySelector('.craft-name').textContent.toLowerCase().includes(craftSearch.value.trim().toLowerCase())
        || craftToggle.checked && el.getAttribute('aria-disabled') === 'true';
      if (!el.hidden) count++;
    }
    craftEmpty.hidden = count > 0;
  }
  function show(id) {
    if (id === 'pack' && !smallScreen.matches) id = 'equipment';
    active = id; hud.dataset.section = id;
    for (const [key, tab] of Object.entries(tabs)) tab.setAttribute('aria-pressed', String(key === id));
    for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== id;
    inventory.tooltips.hide();
    if (id === 'materials') hud.classList.add('bag-open'); else hud.classList.remove('bag-open');
    refresh();
  }
  function refresh() {
    const inv = game.getInventory(), cursor = game.getCursor();
    let matches = 0;
    const query = search.value.trim().toLowerCase(), filtering = !!query || category !== 'all';
    for (const el of pack.querySelectorAll('.inv-slot')) {
      const stack = inv.slots[Number(el.dataset.index)], gear = EQUIPMENT_BY_ID[stack?.definitionId];
      const filled = !!(stack?.count || stack?.pool);
      const group = gear && [GEAR_FAMILY.SPELL, GEAR_FAMILY.UPGRADE].includes(gear.family) ? 'runes' : gear && gear.family !== GEAR_FAMILY.POTION || stack?.isTool ? 'gear' : 'supplies';
      const match = filled && (!query || inventory.stackName(stack).toLowerCase().includes(query)) && (category === 'all' || category === group);
      el.classList.toggle('inv-filter-dim', filtering && filled && !match);
      el.classList.toggle('inv-filter-match', filtering && match);
      if (match) matches++;
    }
    for (const [id, el] of Object.entries(filterButtons)) el.setAttribute('aria-pressed', String(category === id));
    result.textContent = filtering ? `${matches} ${matches === 1 ? 'match' : 'matches'}` : '';
    clear.hidden = !filtering;
    wandEmpty.hidden = !wands.hidden;
    const stack = inspected >= 36 ? inv.equipment?.[inspected - 36] : inv.slots[inspected];
    const details = inventory.describeSlot(inspected);
    const gear = EQUIPMENT_BY_ID[stack?.definitionId];
    const hasItem = inspected >= 0 && !!(stack?.count || stack?.pool);
    const name = cursor ? inventory.stackName(cursor) : details?.name;
    itemName.textContent = cursor ? `Carrying ${name}${cursor.count > 1 ? ` × ${cursor.count}` : ''}` : name || 'Inspect an item';
    itemStats.textContent = cursor ? 'Choose a destination slot. Switch sections to equip or install.' : details ? [details.type, ...(details.stats || []).slice(0, 3).map(stat => `${stat.label} ${stat.value}`), details.comparison?.text].filter(Boolean).join(' · ') : 'Hover or tap an item to inspect it.';
    const iconSignature = JSON.stringify(cursor || (hasItem ? stack : null));
    if (itemIcon.dataset.signature !== iconSignature) { itemIcon.dataset.signature = iconSignature; itemIcon.replaceChildren(); inventory.renderStack(itemIcon, cursor || (hasItem ? stack : null)); }
    actions.hidden = !!cursor || !hasItem;
    transfer.textContent = chestOpen && inspected < 36 ? 'Move to chest' : stack?.pool ? 'Open bag' : inspected >= 36 ? 'Unequip' : gear?.slot >= 0 ? 'Equip' : inspected < 9 ? 'Move to pack' : 'Move to quickbar';
    transfer.hidden = !!stack?.pool;
    split.hidden = !hasItem || stack.count < 2 || !!stack.pool;
    pickup.textContent = stack?.pool ? 'Open bag' : 'Pick up';
    inspector.classList.toggle('carrying', !!cursor);
    for (const el of hud.querySelectorAll('.inv-slot[data-index]')) el.classList.toggle('inv-inspected', Number(el.dataset.index) === inspected);
  }
  const inspect = event => {
    const target = event.target.closest?.('.inv-slot[data-index]');
    if (!target) return;
    inspected = Number(target.dataset.index); refresh();
  };
  hud.addEventListener('item:inspect', inspect);
  hud.addEventListener('pointerover', inspect); hud.addEventListener('focusin', inspect);
  const updated = () => { for (const el of recipeButtons) recipeVisibility.set(el, el.hidden); filterRecipes(); refresh(); };
  const openMaterials = () => show('materials'), openPack = () => show('pack');
  hud.addEventListener('inventory:update', updated); hud.addEventListener('inventory:bag', openMaterials); hud.addEventListener('inventory:pack', openPack);
  search.addEventListener('input', refresh); craftSearch.addEventListener('input', filterRecipes); craftToggle.addEventListener('change', filterRecipes);
  for (const input of [search, craftSearch]) input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (input.value) { input.value = ''; refresh(); filterRecipes(); } else tabs[active].focus(); }
  });
  for (const el of recipeButtons) recipeVisibility.set(el, el.hidden);
  const resized = () => { quickHeading.lastChild.textContent = smallScreen.matches ? 'Swipe · 9 slots' : '1–9 · Ready to use'; show(active); }; smallScreen.addEventListener('change', resized);
  show(active); filterRecipes();
  return { show, refresh, setChest(value) {
    if (chestOpen === value) return;
    chestOpen = value; tabs.chest.hidden = !value;
    if (value) show('chest'); else if (active === 'chest') show(smallScreen.matches ? 'pack' : 'equipment');
  }, destroy() { smallScreen.removeEventListener('change', resized); hud.removeEventListener('item:inspect', inspect); } };
}
