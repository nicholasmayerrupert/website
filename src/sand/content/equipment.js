// Stable item identities are shared by content compilation, authority, and UI.
export const EQUIPMENT_SLOTS = ['Head', 'Torso', 'Hands', 'Legs', 'Boots', 'Cloak', 'Offhand', 'Charm I', 'Charm II'];
export const GEAR_FAMILY = { sword: 1, axe: 2, spear: 3, bow: 4, staff: 5, armor: 6, shield: 7, charm: 8, spell: 9, potion: 10, relic: 11, trophy: 12 };
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
  ['sword', ['Traveller’s sword', 'Briar sabre', 'Oathblade'], [18, 26, 35], 18, 28, 17],
  ['axe', ['Woodcutter’s axe', 'Cinder cleaver', 'Kingsfall'], [25, 36, 48], 28, 44, 10],
  ['spear', ['Ashwood spear', 'Reedwarden’s pike', 'Dawn lance'], [16, 25, 34], 16, 34, 18],
  ['bow', ['Yew bow', 'Thornstring', 'Starfall bow'], [20, 30, 42], 10, 34, 60],
  ['staff', ['Hearth staff', 'Tideglass staff', 'Bellwood staff'], [16, 25, 34], 0, 36, 52],
].forEach(([family, names, powers, stamina, cooldown, reach], familyIndex) => names.forEach((name, tier) =>
  add(1 + familyIndex * 3 + tier, name, family, { power: powers[tier], stamina, cooldown, reach,
    mana: family === 'staff' ? 12 : 0, spell: family === 'staff' ? tier + 1 : 0, style: tier + 1,
    price: 30 + tier * 90, description: `${name}. ${family === 'axe' ? 'A weighty, sweeping blow; breaks timber and brittle stone.' : family === 'spear' ? 'A precise thrust with generous reach.' : family === 'bow' ? 'Hold to draw, release to loose an arrow.' : family === 'staff' ? (tier === 0 ? 'Fires an explosive ember that blasts terrain and nearby foes.' : 'Channels a spell toward your aim.') : 'A quick, dependable cutting edge.'}` })));
ARMOR_SETS.forEach((set, index) => EQUIPMENT_SLOTS.slice(0, 6).forEach((slot, part) =>
  add(100 + index * 6 + part, `${set.name} ${['hood', 'coat', 'gloves', 'leggings', 'boots', 'cloak'][part]}`, 'armor',
    { slot: part, style: index + 1, defense: set.defense, price: 15 + index * 35, description: set.lore })));
['Oak buckler', 'Hearthguard shield', 'Dawnward'].forEach((name, i) => add(200 + i, name, 'shield',
  { slot: 6, defense: 3 + i * 3, style: i + 1, price: 40 + i * 70, description: 'Hold F toward danger to interrupt your action and block the forward half-circle. A well-timed raise costs less stamina; stronger shields block more efficiently.' }));
['Amber acorn', 'Hearthstone', 'Moonlit reed', 'Iron oath', 'Swift feather', 'Bell fragment'].forEach((name, i) => add(220 + i, name, 'charm',
  { slot: 7, style: i + 1, price: 60 + i * 25, description: ['Slowly replenishes health outside combat.', 'Increases spell recovery.', 'Softens falling damage.', 'Strengthens your armor.', 'Reduces the cost of dodging.', 'Strengthens every weapon.'][i] }));
['Ember', 'Rime', 'Gale', 'Stonebreak', 'Briar', 'Lumen'].forEach((name, i) => add(300 + i, `${name} rune`, 'spell',
  { spell: i + 1, power: [22, 18, 12, 32, 16, 0][i], mana: [18, 20, 16, 32, 22, 28][i], cooldown: [36, 42, 30, 60, 48, 90][i], reach: [48, 44, 36, 30, 40, 0][i], style: i + 1, price: 80,
    description: ['An explosive ember blasts terrain, ignites dry wood, and scatters foes.', 'Cold gathers around the target, stilling foes and freezing water.', 'A gust pushes creatures and loose terrain.', 'Shatters a pocket of stone, opening a path through the world.', 'Roots slow enemies and mend the living world.', 'A gentle light restores health.'][i] }));
add(306, 'Prism Choir rune', 'spell', { spell: 7, power: 14, mana: 24, cooldown: 48, reach: 90, style: 1, price: 60,
  description: 'Five singing crystal shards fan outward. Each ricochets twice, chipping walls and catching foes around corners.' });
add(307, 'Hollow Star rune', 'spell', { spell: 8, power: 38, mana: 42, cooldown: 100, reach: 64, style: 2, price: 100,
  description: 'Place a hungry violet star at your aim. It draws in foes and debris for a heartbeat, then collapses into a shattering crater. Its caster is immune to the pull.' });
add(308, 'Faultline rune', 'spell', { spell: 9, power: 22, mana: 34, cooldown: 72, reach: 48, style: 3, price: 80,
  description: 'Six travelling eruptions tear a continuous seam along your aim, breaking both terrain layers and throwing enemies upward.' });
add(320, 'Red cordial', 'potion', { power: 45, cooldown: 90, price: 15, description: 'Restores 45 health. Drink with the primary action.' });
add(321, 'Blue cordial', 'potion', { power: 55, cooldown: 90, price: 15, description: 'Restores 55 mana. Drink with the primary action.' });
['Gale Step', 'Windmantle', 'The lost verse', 'Bell clapper'].forEach((name, i) => add(340 + i, name, 'relic', { style: i + 1, price: 0, description: ['An earned breath of wind. Dodge in midair to dash once before landing.', 'Hold jump while falling to ride a gentle current.', 'The words that can wake the Hollow Bell.', 'A forged heart for the silent bell.'][i] }));
add(309, 'Winterbreath rune', 'spell', { spell: 10, power: 26, mana: 28, cooldown: 66, reach: 64, style: 2, price: 120,
  description: 'A broad cloud of frost. Chills creatures, freezes water, and coats struck surfaces in lasting ice. Recovered from frost giants.' });
add(310, 'Cindermaw rune', 'spell', { spell: 11, power: 24, mana: 32, cooldown: 72, reach: 68, style: 3, price: 140,
  description: 'Lob a molten glob that leaves a small pool of real lava. The lingering lava can burn anyone, including its caster.' });
// Signature trophies are ordinary, stackable inventory items reserved for future recipes.
const trophies = [
  [401, 'Pike tooth', 'A hooked tooth, sharp enough to score river stone.', '#d9dec8', 'fang'],
  [402, 'Fox pelt', 'Russet fur from a woodland fox.', '#c47b49', 'pelt'],
  [404, 'Crawler chitin', 'A ridged plate from a cave crawler.', '#7c9671', 'shell'],
  [407, 'Brigand insignia', 'A battered copper badge from a wandering brigand.', '#d4a76c', 'coin'],
  [408, 'Sentinel core', 'A dense stone heart scored by the sentinel’s chisel.', '#94b4bd', 'crystal'],
  [409, 'Caustic gland', 'A sealed bladder of caustic bile.', '#a4bd59', 'gland'],
  [410, 'Wasp stinger', 'A barbed, amber-tipped stinger.', '#e0bd64', 'fang'],
  [411, 'Archer fletching', 'Dark flight feathers bound with silver thread.', '#b8a29a', 'feather'],
  [414, 'Quarry seal', 'A heavy seal carried by the quarry foreman.', '#ac956b', 'coin'],
  [415, 'Warden heart', 'A smouldering heart behind a lattice of cold iron.', '#ed8d4e', 'crystal'],
  [416, 'Reactor shard', 'A fragment of the silent reactor.', '#a8d5c6', 'crystal'],
  [420, 'Thornbound antler', 'Living thorns wind around this ancient antler.', '#b9c58d', 'antler'],
  [421, 'Mire pearl', 'A cool green pearl from the heart of the fen.', '#83bfaa', 'gland'],
  [422, 'Castellan ember', 'An ember that remembers the heat of a ruined kingdom.', '#f4a45b', 'crystal'],
  [423, 'Hollow bell metal', 'Pale metal that hums long after the bell falls silent.', '#b9a3da', 'coin'],
  [424, 'Briar fang', 'A wolf’s long fang, threaded with green briar.', '#bdd19b', 'fang'],
  [425, 'Bell bat wing', 'A translucent wing patterned like a tiny stained-glass window.', '#ae8eba', 'wing'],
  [426, 'Grave sigil', 'An ivory token carried by a bone guard.', '#ddd0a4', 'coin'],
  [427, 'Wisp filament', 'A strand of marshlight caught inside a glassy coil.', '#8bdac4', 'crystal'],
  [428, 'Rootwood heart', 'The Root Knight’s tightly knotted living heart.', '#8eab70', 'antler'],
  [429, 'Glacier heart', 'A blue crystal from a frost giant. Frost feathers gather along its edges.', '#a7e7ed', 'crystal'],
  [430, 'Funerary scarab', 'A lapis scarab wrapped in a scrap of ancient linen.', '#64b8ba', 'scarab'],
  [432, 'Cinderjaw fang', 'A serrated fossil tooth with an ember trapped inside its root.', '#f3c478', 'fang'],
  [431, 'Magma bladder', 'A cooled, glassy sac from a lava toad, still glowing at its seams.', '#f09a53', 'gland'],
];
for (const [id, name, lore, color, shape] of trophies)
  add(id, name, 'trophy', { price: 0, description: `${lore} Creature trophy; keep for future crafting.`, color, shape });
export const EQUIPMENT = Object.freeze(gear);
export const EQUIPMENT_BY_ID = Object.freeze(Object.fromEntries(gear.map(item => [item.id, item])));
