import { BESTIARY } from '../content/bestiary.js';
import { EQUIPMENT_BY_ID } from '../content/equipment.js';
import { gearIcon } from './gearIcon.js';
import { GAME_CONTENT, GAME_JOBS, GAME_WORLD } from '../content/catalog.js';
import { MATERIAL_BY_ID } from '../materials.generated.js';
import { OBJECTIVE_STATE } from '../wasmBridge/abi.generated.js';
import { ADVENTURE_STYLE } from './adventureStyle.js';
import { ADVENTURE_INVENTORY_STYLE } from './adventureInventoryStyle.js';
import { createAdventureEquipment } from './adventureEquipment.js';
import { gearDetails } from './gearDetails.js';
import { createGameSelect } from './gameSelect.js';

const ICONS = {
  map: '<path d="m2 5 6-3 8 3 6-3v17l-6 3-8-3-6 3Z M8 2v17 M16 5v17"/>',
  journal: '<path d="M5 3h14v18H5c-3 0-3-4 0-4h14 M5 3v14 M9 7h6 M9 10h5"/>',
  inventory: '<path d="M7 7V5a5 5 0 0 1 10 0v2 M5 7h14l2 14H3Z M8 7v4 M16 7v4"/>',
};
const LABELS = { map: 'Map', journal: 'Journal', inventory: 'Inventory' };
const KEYS = { map: 'M', journal: 'J', inventory: 'I' };
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (text, action, className) => {
  const node = el('button', className, text); node.type = 'button';
  node.addEventListener('click', action); return node;
};

// One presentation owner coordinates panels, focus, and pause across the embed.
export function createAdventureHud(root, game, inventory, { setPaused, closeDialogue } = {}) {
  const style = el('style'); style.textContent = ADVENTURE_STYLE + ADVENTURE_INVENTORY_STYLE;
  const nav = el('nav', 'ad-nav'); nav.setAttribute('aria-label', 'Adventure');
  const overlay = el('div', 'ad-overlay'); overlay.hidden = true;
  const sheet = el('section', 'ad-sheet'); sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
  const header = el('header');
  const wordmark = el('div', 'ad-wordmark'); wordmark.append(el('strong', '', 'ASTER'), el('span', '', 'The Hollow Bell'));
  const tabs = el('nav', 'ad-tabs'); tabs.setAttribute('aria-label', 'Adventure pages');
  header.append(wordmark, tabs, button('×', () => open(null), 'ad-close'));
  header.lastChild.setAttribute('aria-label', 'Close panel');
  const pages = {}, tabButtons = {};
  for (const name of Object.keys(LABELS)) {
    const item = button('', () => open(panel === name ? null : name));
    item.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg><span>${LABELS[name]}</span><kbd>${KEYS[name]}</kbd>`;
    item.setAttribute('aria-label', `${LABELS[name]} (${KEYS[name]})`); nav.append(item);
    const tab = button(LABELS[name], () => open(name));
    tab.setAttribute('aria-controls', `ad-${name}`); tabs.append(tab); tabButtons[name] = tab;
    const page = el('div', `ad-page ad-${name}`); page.id = `ad-${name}`; page.hidden = true; pages[name] = page;
  }
  const footer = el('footer'); footer.append(el('span', '', 'Paused'), el('span', 'ad-shortcuts', 'Esc · Close'));
  sheet.append(header, ...Object.values(pages), footer); overlay.append(sheet);
  const caption = el('div', 'ad-caption'); caption.append(el('strong', '', 'Hearthwood'), el('span', '', 'A light in the wilderness'));
  const notice = el('div', 'ad-notice'); notice.hidden = true; notice.setAttribute('role', 'status');
  const bossBar = el('div', 'ad-boss'); bossBar.hidden = true;
  const bossName = el('span'), bossHealth = el('progress'); bossHealth.setAttribute('aria-label', 'Boss health');
  bossBar.append(bossName, bossHealth);
  const trailHint = el('div', 'ad-trail-hint');
  root.append(style, nav, overlay, caption, notice, bossBar, trailHint);
  let panel = null, selected = 0, tracked = -1, mission = null, dialogueOpen = false;
  let previousFocus = null, noticeTimer = 0, lastSignature = '', destroyed = false;
  const completed = new Set(), seenCreatures = new Set();
  const journalKey = `aster-journal:3:${GAME_WORLD.seed}`;
  const keepJournal = !new URLSearchParams(location.search).has('nosave') && !new URLSearchParams(location.search).has('studio');
  if (keepJournal) try {
    const saved = JSON.parse(localStorage.getItem(journalKey) || '{}');
    tracked = GAME_JOBS.findIndex(job => job.key === saved.tracked);
    for (const id of Array.isArray(saved.seen) ? saved.seen : []) if (BESTIARY[id]) seenCreatures.add(id);
  } catch { /* The adventure remains playable when browser storage is unavailable. */ }
  function saveJournal() {
    if (keepJournal) try { localStorage.setItem(journalKey, JSON.stringify({ tracked: GAME_JOBS[tracked]?.key, seen: [...seenCreatures] })); } catch { /* Browser storage can be disabled. */ }
  }
  function anchorPosition(anchor) {
    return { worldX: anchor.x, worldY: anchor.y + (anchor.surface === -2147483648 ? 0 : game.getWorldSurfaceAt(anchor.surface)) };
  }
  function destination(index) {
    const objective = mission?.objectives[index];
    if (!objective || objective.accepted || objective.state === OBJECTIVE_STATE.COMPLETE) return objective;
    const resident = GAME_WORLD.residents.find(npc => npc.id === GAME_JOBS[index]?.giver);
    return resident ? anchorPosition(GAME_CONTENT.anchors[resident.anchor]) : objective;
  }
  const captionTimer = setTimeout(() => caption.classList.add('faded'), 7000);
  const inventoryHome = inventory.el.parentNode;
  const footprintLabel = el('label', 'ad-muted ad-footprint', 'Building footprint ');
  const footprint = createGameSelect(root, { label: 'Tool footprint', options: game.getSurvivalFootprints().map(shape => ({ value: shape.id, label: `${shape.width} × ${shape.height}` })), onChange: value => game.setSelectedFootprint(Number(value)) });
  footprint.value = game.getInventory().selectedFootprint;
  footprintLabel.append(footprint.el); inventory.el.append(footprintLabel);
  const equipment = createAdventureEquipment(game, inventory);
  inventory.el.prepend(equipment.el);
  const refreshEquipment = equipment.refresh;
  let nearChest = null, shownChest = 0, lootSignature = '', chestPointer = null;
  const chestPrompt = button('E · Open chest', () => openChest(), 'ad-chest-prompt'); chestPrompt.hidden = true; root.append(chestPrompt);
  const chestSection = el('section', 'ad-loot'); chestSection.hidden = true; pages.inventory.prepend(chestSection);
  function openChest() {
    refreshChest();
    if (!nearChest) return;
    shownChest = nearChest.id; lootSignature = '';
    game.interactChest(shownChest); open('inventory');
  }
  function refreshChest() {
    const view = game.getMissionView();
    const bounds = root.querySelector('#sand-main')?.getBoundingClientRect();
    const wx = view && bounds && chestPointer ? view.cameraWorldX + (chestPointer.x - bounds.left) / bounds.width * view.viewCols : NaN;
    const wy = view && bounds && chestPointer ? view.cameraWorldY + (chestPointer.y - bounds.top) / bounds.height * view.viewRows : NaN;
    nearChest = view && !panel && !dialogueOpen ? game.getChests().find(chest => Math.abs(wx - chest.worldX) <= 3.5
      && wy >= chest.worldY - (chest.opened ? 2 : .5) && wy <= chest.worldY + 4
      && Math.hypot(chest.worldX - view.playerWorldX, chest.worldY - view.playerWorldY) < 28) : null;
    chestPrompt.hidden = !!panel || dialogueOpen || !nearChest;
    if (nearChest && view) {
      chestPrompt.style.left = `${(nearChest.worldX-view.cameraWorldX)/view.viewCols*100}%`;
      chestPrompt.style.top = `${(nearChest.worldY-view.cameraWorldY)/view.viewRows*100}%`;
      chestPrompt.textContent = nearChest.remaining ? 'E · Open chest' : 'E · Empty chest';
    }
    chestSection.hidden = panel !== 'inventory' || !shownChest;
    const loot = game.getChestLoot();
    if (!shownChest || loot.id !== shownChest) return;
    const signature = `${loot.id}:${JSON.stringify(loot.slots)}`;
    if (lootSignature === signature) return;
    lootSignature = signature;
    chestSection.replaceChildren(el('h2', '', GAME_WORLD.chests.find(c => c.id === shownChest)?.name || (shownChest >= 8000000 ? 'Returned belongings · Hearthwood' : 'Forgotten coffer')));
    if (!loot.slots.length) chestSection.append(el('p', 'ad-muted', 'Empty'));
    for (const [index, stack] of loot.slots.entries()) {
      const item = EQUIPMENT_BY_ID[stack.definitionId];
      const row = button('', () => game.interactChest(shownChest, index));
      if (item) row.append(gearIcon(item.id));
      row.append(el('span', '', `${item?.name || MATERIAL_BY_ID[stack.material]?.name || 'Arrows'}${stack.count > 1 ? ` × ${stack.count}` : ''}`), el('span', 'ad-muted', 'Take'));
      inventory.tooltips.bind(row, () => ({ ...(gearDetails(item?.id, game.getInventory().equipment) || { name: MATERIAL_BY_ID[stack.material]?.name || 'Arrows', type: 'Material' }),
        action: `Click to take${stack.count > 1 ? ` ${stack.count}` : ''}`, inspectTouch: true, touchAction: 'Tap again to take' }));
      chestSection.append(row);
    }
    if (loot.slots.length) chestSection.append(button('Take all', () => game.interactChest(shownChest, -1), 'ad-primary'));
  }
  const focusGame = () => root.querySelector('.sg-sim')?.focus({ preventScroll: true });
  const pause = () => { game.clearInput?.(); setPaused?.(!!panel || dialogueOpen); };

  function open(name) {
    if (destroyed || panel === name) return;
    const prior = panel;
    if (!prior && name) previousFocus = root.activeElement || document.activeElement;
    panel = name;
    inventory.tooltips.hide();
    footprint.close();
    sheet.dataset.page = name || '';
    wordmark.replaceChildren(el('strong', '', name === 'inventory' ? 'Inventory' : 'ASTER'));
    footer.firstChild.textContent = name === 'inventory' ? matchMedia('(pointer: coarse)').matches ? 'Tap · Inspect     Tap again · Pick up' : 'Click / drag · Move     Shift-click · Equip / transfer     Right-click · Split' : 'Paused';
    if (!name) { shownChest = 0; chestSection.hidden = true; inventory.setStation(0, game.getPlayer()?.abilities || 0); }
    if (name) closeDialogue?.();
    dialogueOpen = false;
    if (name === 'inventory') pages.inventory.append(inventory.el);
    inventory.setOpen(name === 'inventory');
    if (name !== 'inventory') inventoryHome.append(inventory.el);
    inventory.el.hidden = !!name && name !== 'inventory';
    overlay.hidden = !name; nav.hidden = !!name;
    for (const key of Object.keys(pages)) {
      pages[key].hidden = key !== name;
      tabButtons[key].setAttribute('aria-selected', String(key === name));
    }
    if (name) {
      sheet.setAttribute('aria-label', LABELS[name]);
      if (name === 'journal') renderJournal();
      if (name === 'inventory') { refreshEquipment(); footprint.value = game.getInventory().selectedFootprint; }
      if (name === 'map' && prior !== 'map') centerMap();
      pause(); tabButtons[name].focus({ preventScroll: true });
    } else {
      pause();
      if (previousFocus?.isConnected && !overlay.contains(previousFocus)) previousFocus.focus?.({ preventScroll: true });
      else focusGame();
      previousFocus = null;
    }
  }

  const journalLayout = el('div', 'ad-journal-layout');
  const questList = el('aside', 'ad-quest-list'), detail = el('article', 'ad-detail');
  journalLayout.append(questList, detail); pages.journal.append(journalLayout);
  function renderJournal() {
    questList.replaceChildren(el('div', 'ad-eyebrow', 'Your travels'));
    GAME_JOBS.forEach((quest, index) => {
      const state = mission?.objectives[index]?.state ?? OBJECTIVE_STATE.LOCKED;
      if (state === OBJECTIVE_STATE.LOCKED) return;
      const row = button('', () => { selected = index; renderJournal(); });
      row.append(el('span', '', `${state === OBJECTIVE_STATE.COMPLETE ? '✓ ' : ''}${quest.title}`),
        el('small', '', state === OBJECTIVE_STATE.COMPLETE ? 'Completed' : state === OBJECTIVE_STATE.ACTIVE ? mission?.objectives[index]?.accepted ? 'In progress' : 'Speak to its keeper' : 'A story yet to unfold'));
      row.setAttribute('aria-pressed', String(selected === index)); questList.append(row);
    });
    if (mission?.objectives[selected]?.state === OBJECTIVE_STATE.LOCKED) selected = mission.objectives.findIndex(o => o.state !== OBJECTIVE_STATE.LOCKED);
    const quest = GAME_JOBS[selected];
    if (!quest) return;
    const objective = mission?.objectives[selected];
    const giver = GAME_WORLD.residents.find(n => n.id === quest.giver);
    detail.replaceChildren(el('div', 'ad-eyebrow', quest.place), el('h2', '', quest.title), el('p', '', quest.description));
    if (giver && !objective?.accepted) detail.append(el('p', 'ad-muted', `Speak with ${giver.dialogue.name} to begin this story.`));
    const note = el('div', 'ad-note'); note.append(el('span', 'ad-eyebrow', 'A note for the road'), el('p', '', quest.hint)); detail.append(note);
    const reward = el('div', 'ad-reward'); reward.append(el('span', 'ad-eyebrow', 'Reward'), el('p', '', quest.reward)); detail.append(reward);
    if (objective?.state === OBJECTIVE_STATE.ACTIVE) {
      detail.append(el('p', 'ad-muted', `Progress ${objective.current} / ${objective.required}`));
      detail.append(button(tracked === selected ? 'Stop tracking' : 'Track this story', () => {
        tracked = tracked === selected ? -1 : selected; root.host.dataset.trackedObjective = String(tracked); saveJournal(); renderJournal();
      }, 'ad-primary'));
      detail.append(button('Show on map', () => { const target = destination(selected); open('map'); mapX = target.worldX; mapY = target.worldY; drawMap(); }));
    }
    const fieldGuide = el('details', 'ad-settings'); fieldGuide.append(el('summary', '', 'Creatures of the valley'));
    fieldGuide.append(el('p', 'ad-muted', 'Notes appear as you encounter the valley’s creatures.'));
    for (const id of seenCreatures) { const creature = BESTIARY[id]; if (creature) { fieldGuide.append(el('h3', '', creature.name), el('p', 'ad-muted', creature.note)); } }
    detail.append(fieldGuide);
    const save = game.getSaveState();
    detail.append(el('p', 'ad-muted', save.error ? `Save needs attention: ${save.error}` : save.savedAt ? `Adventure saved ${new Date(save.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Your adventure saves automatically.'));
    const settings = el('details', 'ad-settings'); settings.append(el('summary', '', 'Settings & controls'));
    const sound = el('input'); sound.type = 'checkbox'; sound.checked = !game.getAudioState().muted;
    sound.addEventListener('change', () => game.setAudioMuted(!sound.checked));
    const soundLabel = el('label'); soundLabel.append(sound, document.createTextNode('Sound')); settings.append(soundLabel);
    settings.append(el('p', 'ad-muted', 'A / D move · Shift sprint · S dodge · Space jump · F guard · T talk · 1–9 quickbar'));
    settings.append(el('p', 'ad-muted', 'Left mouse uses your selected item. Right mouse works on the background with a tool.'));
    const link = el('a', '', 'Return to the website'); link.href = '/'; settings.append(link); detail.append(settings);
  }

  let mapX = 0, mapY = 0, mapScale = 2, drag = null;
  const mapToolbar = el('div', 'ad-map-toolbar'); mapToolbar.append(el('span', '', 'A record of the paths you have walked'));
  mapToolbar.append(button('−', () => zoomMap(.8)), button('+', () => zoomMap(1.25)), button('Find me', centerMap));
  const mapWrap = el('div', 'ad-map-wrap'), canvas = el('canvas', 'ad-map-canvas');
  canvas.tabIndex = 0; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Explored valley map. Drag to pan; plus and minus zoom; arrow keys pan.');
  mapWrap.append(canvas);
  const legend = el('div', 'ad-map-legend'); legend.append(el('span', '', '✦ You'), el('span', '', '◇ Tracked destination'), el('span', '', 'Unmarked parchment is unexplored'));
  pages.map.append(mapToolbar, mapWrap, legend);
  function centerMap() { const view = game.getMissionView(); if (view) { mapX = view.playerWorldX; mapY = view.playerWorldY; } drawMap(); }
  function zoomMap(factor) { mapScale = Math.max(.15, Math.min(8, mapScale * factor)); drawMap(); }
  function drawMap() {
    if (panel !== 'map') return;
    const box = canvas.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (!box.width || !box.height) return;
    canvas.width = Math.round(box.width * ratio); canvas.height = Math.round(box.height * ratio);
    const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#d7caa3'; ctx.fillRect(0, 0, box.width, box.height);
    ctx.strokeStyle = '#9b855522'; ctx.lineWidth = 1;
    for (let x = 0; x < box.width; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, box.height); ctx.stroke(); }
    for (let y = 0; y < box.height; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(box.width, y); ctx.stroke(); }
    const cells = game.getDiscovery(), xAt = x => (x - mapX) * mapScale + box.width / 2, yAt = y => (y - mapY) * mapScale + box.height / 2;
    for (let i = 0; i < cells.length; i += 3) {
      const x = xAt(cells[i]), y = yAt(cells[i + 1]);
      if (x < -4 * mapScale || y < -4 * mapScale || x > box.width || y > box.height) continue;
      const material = MATERIAL_BY_ID[cells[i + 2]], color = material?.color >>> 0;
      ctx.fillStyle = cells[i + 2] ? `rgb(${Math.round((color & 255) * .6 + 40)} ${Math.round(((color >>> 8) & 255) * .6 + 40)} ${Math.round(((color >>> 16) & 255) * .5 + 30)})` : '#b6b294';
      ctx.fillRect(x, y, Math.max(1, 4 * mapScale + .3), Math.max(1, 4 * mapScale + .3));
    }
    const view = game.getMissionView();
    if (view && Number.isFinite(view.playerWorldX)) {
      ctx.fillStyle = '#214c3a'; ctx.strokeStyle = '#f6edce'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(xAt(view.playerWorldX), yAt(view.playerWorldY), 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    const seen = new Set();
    for (let i = 0; i < cells.length; i += 3) seen.add(`${cells[i]},${cells[i+1]}`);
    for (const [key, anchor] of Object.entries(GAME_CONTENT.anchors)) {
      if (!key.endsWith('.spawn') && !key.endsWith('.center')) continue;
      const position = anchorPosition(anchor);
      if (!seen.has(`${Math.floor(position.worldX/4)*4},${Math.floor(position.worldY/4)*4}`)) continue;
      const x = xAt(position.worldX), y = yAt(position.worldY);
      ctx.fillStyle = '#715627'; ctx.fillRect(x-3,y-3,6,6); ctx.font = "12px 'Sand Pixel'";
      ctx.fillText(key.split('.')[0].replace(/^./, c => c.toUpperCase()),x+8,y+4);
    }
    const target = destination(tracked);
    if (target) {
      const x = xAt(target.worldX), y = yAt(target.worldY);
      ctx.strokeStyle = '#78541b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x,y-7);ctx.lineTo(x+7,y);ctx.lineTo(x,y+7);ctx.lineTo(x-7,y);ctx.closePath();ctx.stroke();
    }
    ctx.fillStyle = '#715e39'; ctx.font = "14px 'Sand Pixel'"; ctx.fillText('WEST', 16, box.height - 16); ctx.fillText('EAST', box.width - 48, box.height - 16);
  }
  canvas.addEventListener('pointerdown', event => { drag = { x:event.clientX, y:event.clientY, mapX, mapY }; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', event => { if (drag) { mapX = drag.mapX - (event.clientX-drag.x)/mapScale; mapY = drag.mapY - (event.clientY-drag.y)/mapScale; drawMap(); } });
  canvas.addEventListener('pointerup', () => { drag = null; }); canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('wheel', event => { event.preventDefault(); event.stopPropagation(); zoomMap(event.deltaY < 0 ? 1.12 : 1/1.12); }, { passive:false });
  canvas.addEventListener('keydown', event => {
    const directions = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] };
    if (directions[event.key]) { event.preventDefault(); mapX += directions[event.key][0]*30/mapScale; mapY += directions[event.key][1]*30/mapScale; drawMap(); }
    if (event.key === '+' || event.key === '=') zoomMap(1.25); if (event.key === '-') zoomMap(.8);
  });
  const onKey = event => {
    if (event.composedPath().some(node => node.getAttribute?.('role') === 'listbox' || node.getAttribute?.('role') === 'combobox' && (node.getAttribute('aria-expanded') === 'true' || event.key !== 'Escape'))) return;
    if (event.repeat || event.composedPath().some(node => /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName))) return;
    if (dialogueOpen) return;
    if (event.code === 'KeyE' && !panel && nearChest && root.activeElement === root.querySelector('.sg-sim')) {
      event.preventDefault(); event.stopImmediatePropagation(); openChest(); return;
    }
    const page = { KeyM:'map', KeyJ:'journal', KeyI:'inventory', KeyE:'inventory' }[event.code];
    if (page || event.key === 'Escape') {
      if (!panel && root.activeElement !== root.querySelector('.sg-sim')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      open(page ? panel === page ? null : page : panel ? null : 'journal'); return;
    }
    if (panel && event.key === 'Tab') {
      const targets = [...sheet.querySelectorAll('button:not(:disabled),input,select,a,summary,[tabindex="0"]')].filter(node => node.getClientRects().length);
      if (event.shiftKey && root.activeElement === targets[0]) { event.preventDefault(); targets.at(-1)?.focus(); }
      else if (!event.shiftKey && root.activeElement === targets.at(-1)) { event.preventDefault(); targets[0]?.focus(); }
    }
  };
  const onDialogue = event => { dialogueOpen = event.detail.open; pause(); };
  const pointAtChest = event => {
    const bounds = root.querySelector('#sand-main')?.getBoundingClientRect();
    const control = event.composedPath().some(node => /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(node.tagName) || node.getAttribute?.('role') === 'dialog');
    chestPointer = bounds && !control && event.clientX >= bounds.left && event.clientX <= bounds.right
      && event.clientY >= bounds.top && event.clientY <= bounds.bottom ? { x: event.clientX, y: event.clientY } : null;
    refreshChest();
  };
  const clickChest = event => {
    if (panel || dialogueOpen || event.button !== 0) return;
    pointAtChest(event);
    if (nearChest) { event.preventDefault(); event.stopImmediatePropagation(); openChest(); }
  };
  const leaveChests = () => { chestPointer = null; refreshChest(); };
  const leaveWindow = event => { if (!event.relatedTarget) leaveChests(); };
  window.addEventListener('pointermove', pointAtChest, true); window.addEventListener('pointerdown', clickChest, true);
  window.addEventListener('blur', leaveChests); window.addEventListener('pointerout', leaveWindow);
  root.addEventListener('keydown', onKey, true); root.addEventListener('sand:dialogue', onDialogue);
  overlay.addEventListener('pointerdown', event => { if (event.target === overlay) open(null); });
  overlay.addEventListener('wheel', event => event.stopPropagation());
  const observer = new ResizeObserver(drawMap); observer.observe(mapWrap);
  const refresh = setInterval(() => {
    refreshChest();
    const hero = game.getPlayer(), view = game.getMissionView();
    const bosses = {20:'Thornbound Hart',21:'Mire Matron',22:'Cinder Castellan',23:'The Hollow Bellkeeper',14:'The Stonebound',15:'Ashen Sentinel',28:'Root Knight'};
    const actors = game.getCombatActors();
    const seenCount = seenCreatures.size;
    for (const c of actors) if (hero && Math.hypot(c.x-hero.x,c.y-hero.y)<100 && BESTIARY[c.species]) seenCreatures.add(c.species);
    if (seenCreatures.size !== seenCount) saveJournal();
    const foe = actors.find(c => c.alive && bosses[c.species] && hero && Math.hypot(c.x-hero.x,c.y-hero.y)<110);
    bossBar.hidden = !!panel || dialogueOpen || !foe;
    if (foe) { bossName.textContent = bosses[foe.species]; bossHealth.max = foe.maxHealth || [420,560,680,850][foe.species-20] || 280; bossHealth.value = foe.health; }
    trailHint.hidden = !!panel || dialogueOpen;
    const target = mission?.objectives[tracked];
    if (target && target.state !== OBJECTIVE_STATE.COMPLETE) trailHint.textContent = `◇ ${GAME_JOBS[tracked].title} · ${target.current}/${target.required}`;
    else if (!mission?.objectives.some(o => o.accepted && o.state !== OBJECTIVE_STATE.LOCKED && GAME_JOBS[o.id]?.giver)) trailHint.textContent = 'A / D · Walk     Space · Jump     T · Speak to a villager';
    else trailHint.textContent = hero?.abilities & 2 ? 'S · Dodge / Gale Step     Hold Space · Windmantle     F · Guard' : hero?.abilities & 1 ? 'S · Dodge / Gale Step     F · Guard' : 'S · Dodge     F · Guard     Left mouse · Use held item';
    if (view && mission?.objectives[7]?.state === OBJECTIVE_STATE.COMPLETE && !completed.has('chapter')) {
      completed.add('chapter'); notice.replaceChildren(el('small', '', 'THE HOLLOW BELL'), el('span', '', 'Its song returns. Hearthwood remembers your kindness.'));
      notice.hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.hidden = true; }, 12000);
    }
    if (panel === 'inventory') refreshEquipment();
    const next = game.getMission(); if (next) mission = next;
    const signature = mission ? `${mission.revision}:${mission.phase}` : '';
    if (signature !== lastSignature) {
      lastSignature = signature;
      for (const objective of mission?.objectives || []) if (objective.state === OBJECTIVE_STATE.COMPLETE && !completed.has(objective.id)) {
        completed.add(objective.id); notice.replaceChildren(el('small', '', 'A story completed'), el('span', '', GAME_JOBS[objective.id]?.title || 'Quest complete'));
        notice.hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.hidden = true; }, 4500);
      }
      if (panel === 'journal') renderJournal();
    }
    if (panel === 'map') drawMap();
  }, 350);
  root.host.dataset.trackedObjective = String(tracked);
  return {
    open,
    openWorkshop(actor) { open('inventory'); inventory.setStation(actor?.npcId || 0, game.getPlayer()?.abilities || 0); inventory.update(game.getInventory()); },
    isOpen: () => !!panel,
    inventoryChanged(value) { if (value && panel !== 'inventory') open('inventory'); else if (!value && panel === 'inventory') open(null); },
    destroy() { footprint.destroy(); destroyed = true; clearInterval(refresh); clearTimeout(noticeTimer); clearTimeout(captionTimer); observer.disconnect(); window.removeEventListener('pointermove', pointAtChest, true); window.removeEventListener('pointerdown', clickChest, true); window.removeEventListener('blur', leaveChests); window.removeEventListener('pointerout', leaveWindow); root.removeEventListener('keydown', onKey, true); root.removeEventListener('sand:dialogue', onDialogue); inventoryHome.append(inventory.el); style.remove(); chestPrompt.remove(); nav.remove(); overlay.remove(); caption.remove(); notice.remove(); bossBar.remove(); trailHint.remove(); },
  };
}
