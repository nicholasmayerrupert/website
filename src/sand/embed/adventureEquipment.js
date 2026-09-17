import { EQUIPMENT_BY_ID, EQUIPMENT_SLOTS } from '../content/equipment.js';
import { PLAYER_PREVIEW } from '../content/catalog.js';
import { equippedPlayerPreview } from '../content/playerLayers.js';
import { gearIcon } from './gearIcon.js';

export function createAdventureEquipment(game, inventory) {
  const section = document.createElement('section'); section.className = 'ad-equipment';
  const title = document.createElement('h2'); title.textContent = 'Equipment';
  const doll = document.createElement('div'); doll.className = 'ad-paperdoll';
  const preview = document.createElement('canvas'); preview.className = 'ad-character';
  preview.width = PLAYER_PREVIEW.width; preview.height = PLAYER_PREVIEW.height;
  preview.setAttribute('role', 'img'); preview.setAttribute('aria-label', 'Character with equipped armor');
  doll.append(preview);
  const places = ['head', 'torso', 'hands', 'legs', 'boots', 'cloak', 'offhand', 'charm1', 'charm2'];
  const buttons = EQUIPMENT_SLOTS.map((name, index) => {
    const wrap = document.createElement('div'); wrap.className = `ad-gear-slot ad-gear-${places[index]}`;
    const label = document.createElement('span'); label.textContent = name;
    const button = document.createElement('button'); button.type = 'button';
    wrap.append(button, label); doll.append(wrap); inventory.registerEquipmentSlot(index, button); return button;
  });
  const stats = document.createElement('dl'); stats.className = 'ad-character-stats';
  section.append(title, doll, stats);
  let signature = '';
  function refresh() {
    const gear = game.getInventory().equipment || [], hero = game.getPlayer(), carried = game.getCursor();
    const next = JSON.stringify([gear.map(item => item.definitionId), hero?.health, hero?.mana, hero?.manaMax, carried]);
    if (signature === next) return; signature = next;
    buttons.forEach((button, index) => {
      const definition = EQUIPMENT_BY_ID[gear[index]?.definitionId];
      button.replaceChildren(gearIcon(definition?.id || (index < 6 ? 100 + index : index === 6 ? 200 : 220), 36));
      button.classList.toggle('ad-empty-gear', !definition);
      const slot = EQUIPMENT_BY_ID[carried?.definitionId]?.slot;
      button.classList.toggle('ad-can-equip', !!carried && (slot === index || slot === 7 && index === 8));
      button.setAttribute('aria-label', `${EQUIPMENT_SLOTS[index]}: ${definition?.name || 'Unequipped'}`);
    });
    const defense = Math.min(45, gear.reduce((sum, item) => sum + (EQUIPMENT_BY_ID[item.definitionId]?.defense || 0), 0)
      + (gear.slice(7).some(item => item.definitionId === 223) ? 4 : 0));
    stats.replaceChildren();
    for (const [label, value] of [['Health', `${Math.ceil(hero?.health || 0)} / 100`], ['Mana', `${Math.floor(hero?.mana || 0)} / ${hero?.manaMax || 100}`], ['Damage reduction', `${defense}%`]]) {
      const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; stats.append(dt, dd);
    }
    const ctx = preview.getContext('2d'); ctx.clearRect(0, 0, preview.width, preview.height);
    const styles = Array.from({ length: 6 }, (_, slot) => EQUIPMENT_BY_ID[gear[slot]?.definitionId]?.style || 0);
    equippedPlayerPreview(styles).forEach((color, at) => {
      if (!color) return;
      ctx.fillStyle = `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
      ctx.fillRect(at % preview.width, Math.floor(at / preview.width), 1, 1);
    });
    inventory.tooltips.refresh();
  }
  return { el: section, refresh };
}
