// Stable item identities are shared by content compilation, authority, and UI.
export const EQUIPMENT_SLOTS = ['Head', 'Torso', 'Hands', 'Legs', 'Boots', 'Cloak', 'Offhand', 'Charm I', 'Charm II'];
export const GEAR_FAMILY = { sword: 1, axe: 2, spear: 3, bow: 4, staff: 5, armor: 6, shield: 7, charm: 8, spell: 9, potion: 10, relic: 11 };
export const ARMOR_SETS = [
  { name: 'Wayfarer', color: '#82906a', trim: '#c4a978', defense: 1, lore: 'Waxed linen and worn leather, stitched for the long road.' },
  { name: 'Briarbound', color: '#506f49', trim: '#c7ab68', defense: 2, lore: 'Living bark carries the quiet strength of Watchwood.' },
  { name: 'Hedgeweaver', color: '#8470a0', trim: '#dab57a', defense: 1, lore: 'Silver-threaded wool holds a little warmth from every spell.' },
  { name: 'Hearthguard', color: '#998d78', trim: '#b66c48', defense: 4, lore: 'Hammered iron, lined with the red of the village hearth.' },
  { name: 'Mistweaver', color: '#658d96', trim: '#c1d3ca', defense: 2, lore: 'Water beads on these robes like stars on a still lake.' },
  { name: 'Oathkeeper', color: '#adad99', trim: '#d7b76a', defense: 5, lore: 'An old oath, made bright again by the hands that keep it.' },
];
const gear = [];
function add(id, name, family, details = {}) {
  gear.push({ id, name, family: GEAR_FAMILY[family], slot: -1, power: 0, defense: 0, stamina: 0, mana: 0,
    cooldown: 30, reach: 10, spell: 0, style: 0, price: 20, description: '', ...details });
}
[
  ['sword', ['Traveller’s sword', 'Briar sabre', 'Oathblade'], [18, 26, 35], 18, 28, 11],
  ['axe', ['Woodcutter’s axe', 'Cinder cleaver', 'Kingsfall'], [25, 36, 48], 28, 44, 10],
  ['spear', ['Ashwood spear', 'Reedwarden’s pike', 'Dawn lance'], [16, 25, 34], 16, 34, 18],
  ['bow', ['Yew bow', 'Thornstring', 'Starfall bow'], [20, 30, 42], 10, 34, 60],
  ['staff', ['Hearth staff', 'Tideglass staff', 'Bellwood staff'], [16, 25, 34], 0, 36, 52],
].forEach(([family, names, powers, stamina, cooldown, reach], familyIndex) => names.forEach((name, tier) =>
  add(1 + familyIndex * 3 + tier, name, family, { power: powers[tier], stamina, cooldown, reach,
    mana: family === 'staff' ? 12 : 0, spell: family === 'staff' ? tier + 1 : 0, style: tier + 1,
    price: 30 + tier * 90, description: `${name}. ${family === 'axe' ? 'A weighty, sweeping blow; breaks timber and brittle stone.' : family === 'spear' ? 'A precise thrust with generous reach.' : family === 'bow' ? 'Hold to draw, release to loose an arrow.' : family === 'staff' ? 'Channels a spell toward your aim.' : 'A quick, dependable cutting edge.'}` })));
ARMOR_SETS.forEach((set, index) => EQUIPMENT_SLOTS.slice(0, 6).forEach((slot, part) =>
  add(100 + index * 6 + part, `${set.name} ${['hood', 'coat', 'gloves', 'leggings', 'boots', 'cloak'][part]}`, 'armor',
    { slot: part, style: index + 1, defense: set.defense, price: 15 + index * 35, description: set.lore })));
['Oak buckler', 'Hearthguard shield', 'Dawnward'].forEach((name, i) => add(200 + i, name, 'shield',
  { slot: 6, defense: 3 + i * 3, style: i + 1, price: 40 + i * 70, description: 'Face an incoming strike and hold F to guard. Blocking consumes stamina.' }));
['Amber acorn', 'Hearthstone', 'Moonlit reed', 'Iron oath', 'Swift feather', 'Bell fragment'].forEach((name, i) => add(220 + i, name, 'charm',
  { slot: 7, style: i + 1, price: 60 + i * 25, description: ['Slowly replenishes health outside combat.', 'Increases spell recovery.', 'Softens falling damage.', 'Strengthens your armor.', 'Reduces the cost of dodging.', 'Strengthens every weapon.'][i] }));
['Ember', 'Rime', 'Gale', 'Stonebreak', 'Briar', 'Lumen'].forEach((name, i) => add(300 + i, `${name} rune`, 'spell',
  { spell: i + 1, power: [22, 18, 12, 32, 16, 0][i], mana: [18, 20, 16, 32, 22, 28][i], cooldown: [36, 42, 30, 60, 48, 90][i], reach: [48, 44, 36, 30, 40, 0][i], style: i + 1, price: 80,
    description: ['A burning spark ignites dry wood and scatters foes.', 'Cold gathers around the target, stilling foes and freezing water.', 'A gust pushes creatures and loose terrain.', 'Shatters a pocket of stone, opening a path through the world.', 'Roots slow enemies and mend the living world.', 'A gentle light restores health.'][i] }));
add(320, 'Red cordial', 'potion', { power: 45, cooldown: 90, price: 15, description: 'Restores 45 health. Drink with the primary action.' });
add(321, 'Blue cordial', 'potion', { power: 55, cooldown: 90, price: 15, description: 'Restores 55 mana. Drink with the primary action.' });
['Gale Step', 'Windmantle', 'The lost verse', 'Bell clapper'].forEach((name, i) => add(340 + i, name, 'relic', { style: i + 1, price: 0, description: ['An earned breath of wind. Dodge in midair to dash once before landing.', 'Hold jump while falling to ride a gentle current.', 'The words that can wake the Hollow Bell.', 'A forged heart for the silent bell.'][i] }));
export const EQUIPMENT = Object.freeze(gear);
export const EQUIPMENT_BY_ID = Object.freeze(Object.fromEntries(gear.map(item => [item.id, item])));
