import { ARMOR_SETS, EQUIPMENT_BY_ID, EQUIPMENT_SLOTS } from '../content/equipment.js';
import { PLAYER_ART } from '../content/catalog.js';
import { gearIcon } from './gearIcon.js';

export function createAdventureEquipment(game, inventory) {
  const section = document.createElement('section'); section.className = 'ad-equipment';
  const title = document.createElement('h2'); title.textContent = 'Equipment';
  const doll = document.createElement('div'); doll.className = 'ad-paperdoll';
  const preview = document.createElement('canvas'); preview.className = 'ad-character';
  preview.width = PLAYER_ART.width; preview.height = PLAYER_ART.height;
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
    const next = JSON.stringify([gear.map(item => item.definitionId), hero?.health, hero?.mana, carried]);
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
    for (const [label, value] of [['Health', `${Math.ceil(hero?.health || 0)} / 100`], ['Mana', `${Math.floor(hero?.mana || 0)} / 100`], ['Damage reduction', `${defense}%`]]) {
      const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; stats.append(dt, dd);
    }
    const ctx = preview.getContext('2d'); ctx.clearRect(0, 0, preview.width, preview.height);
    const palette = Object.keys(PLAYER_ART.palette);
    PLAYER_ART.clips.idle.frames[0].forEach((row, y) => [...row].forEach((pixel, x) => {
      if (pixel === '.') return;
      const index = palette.indexOf(pixel);
      const part = index === 3 || index === 4 ? 5 : y < 12 ? 0 : y < 28 ? 1 : y < 38 ? 3 : 4;
      const armor = EQUIPMENT_BY_ID[gear[part]?.definitionId];
      let color = PLAYER_ART.palette[pixel];
      if (armor?.style && index !== 1 && !(index >= 10 && index <= 12)) {
        const shade = index === 2 || index === 7 ? .5 : [4, 6, 9].includes(index) ? 1.2 : .85;
        const hex = ARMOR_SETS[armor.style - 1].color.slice(1);
        color = `rgb(${[0, 2, 4].map(at => Math.min(255, Math.round(parseInt(hex.slice(at, at + 2), 16) * shade))).join(',')})`;
      }
      ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1);
    }));
    inventory.tooltips.refresh();
  }
  return { el: section, refresh };
}
