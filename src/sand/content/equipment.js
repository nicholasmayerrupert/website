import { GEAR_FAMILY, WAND_UPGRADE, STATUS_EFFECT, STATUS_TAG } from '../wasmBridge/abi.generated.js';
export { GEAR_FAMILY };

// Stable item identities are shared by content compilation, authority, and UI.
export const EQUIPMENT_SLOTS = ['Head', 'Torso', 'Hands', 'Legs', 'Boots', 'Cloak', 'Offhand', 'Charm I', 'Charm II'];
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
  gear.push({ id, name, family: GEAR_FAMILY[family.toUpperCase()], slot: -1, power: 0, defense: 0, stamina: 0, mana: 0,
    cooldown: 30, reach: 10, spell: 0, style: 0, price: 20, description: '', ...details });
}
[
  ['sword', ['Traveller’s sword', 'Briar sabre', 'Oathblade'], [18, 26, 35], 18, 28, 17],
  ['axe', ['Woodcutter’s axe', 'Cinder cleaver', 'Kingsfall'], [25, 36, 48], 28, 44, 10],
  ['spear', ['Ashwood spear', 'Reedwarden’s pike', 'Dawn lance'], [16, 25, 34], 16, 34, 18],
  ['bow', ['Yew bow', 'Thornstring', 'Starfall bow'], [20, 30, 42], 10, 34, 60],
].forEach(([family, names, powers, stamina, cooldown, reach], familyIndex) => names.forEach((name, tier) =>
  add(1 + familyIndex * 3 + tier, name, family, { power: powers[tier], stamina, cooldown, reach,
    style: tier + 1,
    price: 30 + tier * 90, description: `${name}. ${family === 'axe' ? 'A weighty, sweeping blow; breaks timber and brittle stone.' : family === 'spear' ? 'A precise thrust with generous reach.' : family === 'bow' ? 'Hold to draw, release to loose an arrow.' : 'Hold or time three cuts in sequence; the finishing blow deals extra damage and knockback.'}` })));
[
  { id: 13, name: 'Hearth wand', spellSlots: 3, upgradeSlots: 2, initialSpell: 300, cooldown: 36, style: 1, price: 30 },
  { id: 14, name: 'Tideglass wand', spellSlots: 4, upgradeSlots: 3, initialSpell: 301, cooldown: 30, style: 2, price: 120 },
  { id: 15, name: 'Bellwood wand', spellSlots: 5, upgradeSlots: 4, initialSpell: 302, cooldown: 24, style: 3, price: 210 },
].forEach(({ id, name, ...wand }) => add(id, name, 'wand', { ...wand,
  description: `${wand.spellSlots} spell sockets and ${wand.upgradeSlots} upgrade sockets. Each press casts the next spell in order using your mana; hold continuous spells to sustain them. Arrange its runes in Wandcraft.` }));
ARMOR_SETS.forEach((set, index) => EQUIPMENT_SLOTS.slice(0, 6).forEach((slot, part) =>
  add(100 + index * 6 + part, `${set.name} ${['hood', 'coat', 'gloves', 'leggings', 'boots', 'cloak'][part]}`, 'armor',
    { slot: part, style: index + 1, defense: set.defense, price: 15 + index * 35, description: set.lore })));
['Oak buckler', 'Hearthguard shield', 'Dawnward'].forEach((name, i) => add(200 + i, name, 'shield',
  { slot: 6, defense: 3 + i * 3, style: i + 1, price: 40 + i * 70, description: 'Hold F toward danger to interrupt your action and block the forward half-circle. A well-timed raise costs less stamina; stronger shields block more efficiently.' }));
['Amber acorn', 'Hearthstone', 'Moonlit reed', 'Iron oath', 'Swift feather', 'Bell fragment'].forEach((name, i) => add(220 + i, name, 'charm',
  { slot: 7, style: i + 1, price: 60 + i * 25, description: ['Slowly replenishes health outside combat.', 'Increases spell recovery.', 'Softens falling damage.', 'Strengthens your armor.', 'Reduces the cost of dodging.', 'Strengthens every weapon.'][i] }));
['Ember', 'Rime', 'Gale', 'Stonebreak', 'Briar', 'Lumen'].forEach((name, i) => add(300 + i, `${name} rune`, 'spell',
  { spell: i + 1, power: [22, 18, 12, 32, 16, 0][i], mana: [18, 20, 16, 32, 22, 28][i], cooldown: [36, 42, 30, 60, 48, 90][i], reach: [160, 144, 112, 104, 128, 0][i], style: i + 1, price: 80,
    description: ['An explosive ember blasts terrain, ignites dry wood, and scatters foes.', 'Cold gathers around the target, stilling foes and freezing water.', 'A gust pushes creatures and loose terrain.', 'Shatters a pocket of stone, opening a path through the world.', 'Roots slow enemies and mend the living world.', 'A gentle light restores health.'][i] }));
add(306, 'Prism Choir rune', 'spell', { spell: 7, power: 14, mana: 24, cooldown: 48, reach: 168, style: 1, price: 60,
  description: 'Five singing crystal shards fan outward. Each ricochets twice, chipping walls and catching foes around corners.' });
add(307, 'Hollow Star rune', 'spell', { spell: 8, power: 38, mana: 42, cooldown: 100, reach: 144, style: 2, price: 100,
  description: 'Place a hungry violet star at your aim. It draws in foes and debris for a heartbeat, then collapses into a shattering crater. Its caster is immune to the pull.' });
add(308, 'Faultline rune', 'spell', { spell: 9, power: 22, mana: 34, cooldown: 72, reach: 96, style: 3, price: 80,
  description: 'Travelling eruptions tear a continuous seam along your aim, breaking both terrain layers and throwing enemies upward.' });
add(320, 'Red cordial', 'potion', { power: 45, cooldown: 90, price: 15, description: 'Restores 45 health. Drink with the primary action.' });
add(321, 'Blue cordial', 'potion', { power: 55, cooldown: 90, price: 15, description: 'Restores 55 mana. Drink with the primary action.' });
['Gale Step', 'Windmantle', 'The lost verse', 'Bell clapper'].forEach((name, i) => add(340 + i, name, 'relic', { style: i + 1, price: 0, description: ['An earned breath of wind. Dodge in midair to dash once before landing.', 'Hold jump while falling to ride a gentle current.', 'The words that can wake the Hollow Bell.', 'A forged heart for the silent bell.'][i] }));
add(309, 'Winterbreath rune', 'spell', { spell: 10, power: 8, mana: 1, cooldown: 3, reach: 80, style: 2, price: 120,
  description: 'Hold to breathe a continuous frost stream like a frost giant. Chills foes, freezes water, and coats surfaces in lasting ice. Costs 1 mana per pulse (20 per second). Release to advance to the next spell.' });
add(310, 'Cindermaw rune', 'spell', { spell: 11, power: 24, mana: 32, cooldown: 72, reach: 128, style: 3, price: 140,
  description: 'Lob a molten glob that leaves a small pool of real lava. The lingering lava can burn anyone, including its caster.' });
add(311, 'Sparks rune', 'spell', { spell: 12, power: 4, mana: 1, cooldown: 3, reach: 96, style: 2, price: 80,
  statusEffects: [{ effect: STATUS_EFFECT.SHOCKED }, { effect: STATUS_EFFECT.ELECTRIFIED }],
  description: 'Hold a focused lightning arc over a long reach. Contact stuns foes and leaves them electrified: slowed and taking damage for 2 seconds. Costs 1 mana per pulse (20 per second). Release to advance to the next spell.' });
[
  [WAND_UPGRADE.AMPLIFY, 'Amplify', 'Doubles spell damage for 15% extra base mana. Multiple Amplify upgrades multiply together.'],
  [WAND_UPGRADE.BOUNCE, 'Bounce', 'Projectiles and continuous streams ricochet twice more from solid terrain. Adds 5% of the base mana cost.'],
  [WAND_UPGRADE.CHARGE, 'Charge', 'Hold to gather up to twice the power for up to 15% extra base mana over one second; release to cast. Continuous spells stream immediately. Charging stops at what your mana can afford.'],
  [WAND_UPGRADE.DOUBLE_SHOT, 'Double Shot', 'Fires two copies of each spell for 15% extra base mana. Stacks with other Double Shot upgrades.'],
  [WAND_UPGRADE.TOGETHER, 'Cast Together', 'Joins a spell to the next occupied spell socket, casting both at once. Choose the first socket below this upgrade.'],
  [WAND_UPGRADE.IMPACT, 'On Impact', 'The linked spell carries the next spell and releases it on contact or when its effect ends. Every carried copy is paid for at launch.'],
  [WAND_UPGRADE.TIMER, 'After Delay', 'The linked spell releases the next spell after 0.4 seconds, or when it ends sooner. Every carried copy is paid for at launch.'],
  [WAND_UPGRADE.HOMING, 'Homing', 'Travelling spells curve toward nearby creatures. Adds 5% of the base mana cost.'],
  [WAND_UPGRADE.LINGER, 'Linger', 'Adds one base lifetime to spells and fields. Adds 10% of the base mana cost.'],
].forEach(([id, name, description], index) => add(id, name, 'upgrade', { price: 25 + index * 5, description }));
// Spell contact effects and consumable buffs use the same immutable definitions.
for (const [id, effect] of [[300, STATUS_EFFECT.BURNING], [301, STATUS_EFFECT.CHILLED], [304, STATUS_EFFECT.ROOTED], [309, STATUS_EFFECT.CHILLED], [310, STATUS_EFFECT.BURNING]])
  gear.find(item => item.id === id).statusEffects = [{ effect }];
add(322, 'Mending tonic', 'potion', { cooldown: 60, price: 12, style: 3,
  statusEffects: [{ effect: STATUS_EFFECT.REGENERATION }], description: 'Recover 2 health per second for 5 seconds. More doses extend the duration, up to 30 seconds.' });
add(323, 'Swiftness tonic', 'potion', { cooldown: 60, price: 20, style: 4,
  statusEffects: [{ effect: STATUS_EFFECT.HASTE }], description: 'Move 25% faster for 10 seconds. More doses extend the duration, up to 30 seconds.' });
add(324, 'Cleansing tonic', 'potion', { cooldown: 60, price: 18, style: 5,
  cleanseTags: STATUS_TAG.HARMFUL, description: 'Removes all harmful status effects, including every poison and bleeding stack. Ongoing hazards can apply them again.' });
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
