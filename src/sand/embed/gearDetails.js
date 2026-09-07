import { EQUIPMENT_BY_ID, EQUIPMENT_SLOTS } from '../content/equipment.js';

const FAMILIES = ['', 'Sword', 'Axe', 'Spear', 'Bow', 'Staff', 'Armor', 'Shield', 'Charm', 'Rune', 'Potion', 'Quest item'];
const EFFECTS = {
  220: 'Restores 1 health every 2 seconds after 5 seconds without taking damage.',
  221: 'Increases mana regeneration from 4 to 7.5 per second.',
  222: 'Reduces falling damage by 60%.',
  223: '+4 defense while equipped.',
  224: 'Reduces dodge stamina cost.', 225: '+5 weapon damage while equipped.',
  300: 'Ignites dry wood.', 301: 'Slows enemies and freezes water.',
  302: 'Pushes creatures and loose materials.', 303: 'Breaks stone at the target.',
  304: 'Slows enemies and grows plants.', 305: 'Restores health.',
  340: 'Dodge in midair to dash once before landing.',
  341: 'Hold jump while falling to glide.',
  342: 'Required for the Hollow Bell.', 343: 'Required for the Hollow Bell.',
};

export function gearDetails(id, equipment = [], equippedSlot = -1) {
  const gear = EQUIPMENT_BY_ID[id];
  if (!gear) return null;
  const stats = [];
  if (gear.family <= 5 || gear.family === 9) {
    if (gear.power) stats.push({ label: 'Base damage', value: gear.power });
    if (gear.stamina) stats.push({ label: 'Stamina cost', value: gear.stamina });
    if (gear.mana) stats.push({ label: 'Mana cost', value: gear.mana });
    stats.push({ label: 'Recovery', value: `${Number((gear.cooldown / 60).toFixed(2))} s` });
  }
  if (gear.defense) stats.push({ label: 'Defense', value: `+${gear.defense}` });
  if (gear.family === 10) stats.push({ label: id === 320 ? 'Health restored' : 'Mana restored', value: gear.power });
  let comparison = null;
  if (gear.slot >= 0 && equippedSlot < 0) {
    const other = EQUIPMENT_BY_ID[equipment[gear.slot]?.definitionId];
    if (gear.defense && other && other.id !== id) {
      const delta = gear.defense - other.defense;
      comparison = { text: `${delta > 0 ? '+' : ''}${delta} defense vs. ${other.name}`, tone: delta > 0 ? 'positive' : delta < 0 ? 'negative' : '' };
    }
  }
  return { name: gear.name, type: `${FAMILIES[gear.family]}${gear.slot >= 0 ? ` · ${gear.slot === 7 ? 'Charm' : EQUIPMENT_SLOTS[gear.slot]}` : ''}${equippedSlot >= 0 ? ' · Equipped' : ''}`,
    stats, comparison, description: EFFECTS[id] || (gear.family === 4 ? 'Hold attack to draw; release to fire. Requires arrows.'
      : gear.family === 7 ? 'Hold F to guard. Blocking costs stamina.' : '') };
}
