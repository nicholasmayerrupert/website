import { EQUIPMENT_BY_ID, GEAR_FAMILY } from '../content/equipment.js';
import { WAND_SOCKET, WAND_UPGRADE, SPELL_EFFECT } from '../wasmBridge/abi.generated.js';
import { gearIcon } from './gearIcon.js';
import { createGameSelect } from './gameSelect.js';

const name = id => EQUIPMENT_BY_ID[id]?.name.replace(/ rune$/, '') || 'Empty';
const connectionNames = { [WAND_UPGRADE.TOGETHER]: 'together', [WAND_UPGRADE.IMPACT]: 'on impact', [WAND_UPGRADE.TIMER]: 'after 0.4s' };

export function createWandEditor(root, game, inventory) {
  const el = document.createElement('section'); el.className = 'ad-wands';
  el.setAttribute('aria-label', 'Wand spell and upgrade sockets');
  const header = document.createElement('div'); header.className = 'wand-header';
  const title = document.createElement('h2'); title.textContent = 'Wandcraft';
  const picker = createGameSelect(root, { label: 'Wand to edit', onChange: () => { signature = ''; refresh(); } });
  header.append(title, picker.el);
  const mana = document.createElement('p'); mana.className = 'wand-mana';
  const hint = document.createElement('p'); hint.className = 'wand-help';
  hint.textContent = 'Move runes from your inventory into sockets. Spells cast from left to right; upgrades affect compatible spells.';
  const spellLabel = document.createElement('h3'); spellLabel.textContent = 'Spells';
  const spells = document.createElement('div'); spells.className = 'wand-spells';
  const upgradeLabel = document.createElement('h3'); upgradeLabel.textContent = 'Upgrades';
  const upgrades = document.createElement('div'); upgrades.className = 'wand-upgrades';
  const preview = document.createElement('p'); preview.className = 'wand-preview';
  el.append(header, mana, hint, spellLabel, spells, upgradeLabel, upgrades, preview);
  let signature = '', optionsKey = '', selected = -1, current = null, lastHeldSlot = -1;

  const rows = [5, 4].map((count, kind) => Array.from({ length: count }, (_, index) => {
    const wrap = document.createElement('div'); wrap.className = 'wand-place';
    const button = document.createElement('button'); button.type = 'button'; button.className = `wand-socket ${kind ? 'upgrade' : 'spell'}`;
    button.dataset.wandKind = String(kind); button.dataset.wandIndex = String(index);
    const icon = document.createElement('span'); icon.className = 'wand-icon';
    const number = document.createElement('small'); number.textContent = String(index + 1);
    const label = document.createElement('span'); label.className = 'wand-socket-name';
    button.append(number, icon, label); wrap.append(button);
    let down = false;
    const use = () => {
      if (!button.disabled) game.wandSocket(selected, kind, index);
    };
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); down = true; use(); inventory.beginExternalDrag();
    });
    button.addEventListener('pointerup', event => {
      if (event.button === 0 && !down && game.getCursor()?.count) use();
      down = false;
    });
    button.addEventListener('pointerleave', () => { down = false; });
    button.addEventListener('click', event => { if (event.detail === 0) use(); });
    button.addEventListener('contextmenu', event => event.preventDefault());
    let link = null;
    if (kind) {
      link = createGameSelect(root, { label: `Connect from spell for upgrade ${index + 1}`,
        onChange: value => game.wandSocket(selected, WAND_SOCKET.CONNECTION, index, Number(value)) });
      wrap.append(link.el);
    }
    inventory.tooltips.bind(button, () => {
      const id = kind ? current?.upgrades[index] : current?.spells[index];
      return { name: id ? name(id) : `Empty ${kind ? 'upgrade' : 'spell'} socket`,
        description: EQUIPMENT_BY_ID[id]?.description || `Accepts ${kind ? 'wand upgrades' : 'spell runes'}.`,
        action: 'Click a rune, then a matching socket. Click a filled socket to take it out.' };
    });
    (kind ? upgrades : spells).append(wrap);
    return { wrap, button, icon, label, link, id: -1 };
  }));

  function refresh() {
    const inv = game.getInventory(), hero = game.getPlayer(), cursor = game.getCursor();
    const wands = (inv.slots || []).map((item, slot) => ({ ...item, slot })).filter(item => item.count && EQUIPMENT_BY_ID[item.definitionId]?.family === GEAR_FAMILY.WAND && item.wand);
    el.hidden = !wands.length;
    if (!wands.length) { close(); return; }
    const key = wands.map(item => `${item.slot}:${item.definitionId}`).join(',');
    if (key !== optionsKey) {
      optionsKey = key;
      picker.setOptions(wands.map(item => ({ value: item.slot,
        label: `Editing ${name(item.definitionId)} · ${item.slot < 9 ? `quickbar ${item.slot + 1}` : `bag ${item.slot - 8}`}` })));
    }
    if (lastHeldSlot !== inv.selected) {
      lastHeldSlot = inv.selected;
      if (wands.some(item => item.slot === inv.selected)) picker.value = String(inv.selected);
    }
    selected = Number(picker.value);
    const item = wands.find(wand => wand.slot === selected) || wands[0]; selected = item.slot;
    current = item.wand;
    const locked = (hero?.actionTicks || 0) > 0 || (hero?.spellCharge || 0) > 0;
    const cost = inv.selected === selected ? hero?.manaCastCost ?? current.manaCost : current.manaCost;
    mana.textContent = `Your mana ${hero?.mana ?? 0}/${hero?.manaMax ?? 100} · Next cast ${cost}${cost > (hero?.mana || 0) ? ' · Needs more mana' : ''}`;
    mana.classList.toggle('blocked', cost > (hero?.mana || 0));
    const next = JSON.stringify([selected, current, locked, cursor?.definitionId, cursor?.count]);
    if (next === signature) return;
    signature = next;
    hint.textContent = locked ? 'Finish casting before changing sockets.'
      : `${selected >= 9 ? 'Move this wand to the quickbar to cast. ' : ''}Move runes into sockets. Spells cast from left to right; upgrades affect compatible spells.`;
    rows.forEach((group, kind) => group.forEach((row, index) => {
      const ids = kind ? current.upgrades : current.spells, id = ids[index] || 0;
      row.wrap.hidden = index >= ids.length;
      if (row.id !== id) { row.icon.replaceChildren(...(id ? [gearIcon(id, 32)] : [])); row.id = id; }
      row.label.textContent = id ? name(id) : kind ? 'Upgrade' : 'Spell';
      row.button.classList.toggle('empty', !id);
      const nextSpell = current.spells.findIndex((spell, i) => i >= current.next && spell);
      row.button.classList.toggle('next', !kind && index === (nextSpell < 0 ? current.spells.findIndex(Boolean) : nextSpell));
      const compatible = !cursor?.count || EQUIPMENT_BY_ID[cursor.definitionId]?.family === (kind ? GEAR_FAMILY.UPGRADE : GEAR_FAMILY.SPELL);
      row.button.disabled = locked || !compatible;
      row.button.classList.toggle('accepts', !!cursor?.count && compatible && !locked);
      row.button.setAttribute('aria-label', `${kind ? 'Upgrade' : 'Spell'} socket ${index + 1}: ${name(id)}`);
      if (row.link) {
        row.link.el.hidden = !connectionNames[id];
        row.link.disabled = locked;
        row.link.setOptions(current.spells.slice(0, -1).map((spell, i) => ({ value: i, label: `From ${i + 1}: ${name(spell)}`,
          disabled: !spell || !current.spells.slice(i + 1).some(Boolean) ||
            (EQUIPMENT_BY_ID[spell]?.spell === SPELL_EFFECT.LUMEN && id !== WAND_UPGRADE.TOGETHER) || current.upgrades.some((upgrade, j) => j !== index && connectionNames[upgrade] && current.links[j] === i) })));
        row.link.value = String(current.links[index] || 0);
      }
    }));
    const sequence = current.spells.flatMap((id, index) => {
      if (!id) return [];
      const linkIndex = current.upgrades.findIndex((upgrade, i) => connectionNames[upgrade] && current.links[i] === index);
      const hasNext = current.spells.slice(index + 1).some(Boolean);
      const connection = hasNext && linkIndex >= 0 && (EQUIPMENT_BY_ID[id]?.spell !== SPELL_EFFECT.LUMEN || current.upgrades[linkIndex] === WAND_UPGRADE.TOGETHER) ? connectionNames[current.upgrades[linkIndex]] : 'then';
      return [name(id), ...(hasNext ? [connection === 'then' ? '→' : `— ${connection} →`] : [])];
    });
    preview.textContent = sequence.length ? `${sequence.join(' ')}. Repeats in this order.` : 'Add a spell to begin.';
  }
  function close() { picker.close(); for (const row of rows[1]) row.link.close(); }
  return { el, refresh, close, destroy() { picker.destroy(); for (const row of rows[1]) row.link.destroy(); } };
}
