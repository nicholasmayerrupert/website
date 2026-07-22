// Mining tool classes and tiers. Materials declare which tool class drops
// them and the minimum tool TIER required (generated from materials.schema.json
// into MAT_TOOLCLASS / MAT_TOOLTIER). This pins the gate so a schema typo or a
// codegen regression can't silently change what drops from what.
// Run: node scripts/tooltier-test.mjs

import { MAT } from '../src/sand/materials.js';
import { MAT_TOOLCLASS, MAT_TOOLTIER, TOOL_CLASS_SPEED, TOOL_TIER_SPEED, TC, TT, TABLE_SIZE } from '../src/sand/materials.generated.js';
import { makeChecker } from './sand-test-util.mjs';

const { check, done } = makeChecker('material tool classes/tiers');

// Table shape: one entry per slot, power-of-two headroom over the live ids
// (TABLE_SIZE is generated from the schema's tableSize — don't hardcode it).
check(`MAT_TOOLCLASS has TABLE_SIZE entries (${MAT_TOOLCLASS.length}/${TABLE_SIZE})`, MAT_TOOLCLASS.length === TABLE_SIZE);
check(`MAT_TOOLTIER has TABLE_SIZE entries (${MAT_TOOLTIER.length}/${TABLE_SIZE})`, MAT_TOOLTIER.length === TABLE_SIZE);
check('mining speed tables cover every class/tier', TOOL_CLASS_SPEED.length === 36 && TOOL_TIER_SPEED.length === 5);

// Enums exported for both sides.
check('TC enum present', TC.none === 0 && TC.pickaxe === 1 && TC.axe === 2 && TC.shovel === 3 && TC.hand === 4 && TC.dig === 5);
check('TT enum present', TT.hand === 0 && TT.wood === 1 && TT.stone === 2 && TT.iron === 3 && TT.gold === 4);

// Class assignments: stone/ores -> pickaxe, plant family -> axe, soils -> shovel.
const cls = (n) => MAT_TOOLCLASS[MAT[n]];
const tier = (n) => MAT_TOOLTIER[MAT[n]];
check(`STONE is pickaxe (${cls('STONE')})`, cls('STONE') === TC.pickaxe);
check(`COPPER_ORE/IRON_ORE/GOLD_ORE are pickaxe`, cls('COPPER_ORE') === TC.pickaxe && cls('IRON_ORE') === TC.pickaxe && cls('GOLD_ORE') === TC.pickaxe);
check(`WOOD/PINE_WOOD/CACTUS are axe`, cls('WOOD') === TC.axe && cls('PINE_WOOD') === TC.axe && cls('CACTUS') === TC.axe);
check(`DIRT/SAND/SNOW/MUD/GRASS are shovel`, cls('DIRT') === TC.shovel && cls('SAND') === TC.shovel && cls('SNOW') === TC.shovel && cls('MUD') === TC.shovel && cls('GRASS') === TC.shovel);

// Tier ladder: common stone is wood-tier, iron needs stone, gold needs iron.
check(`STONE tier is wood (${tier('STONE')})`, tier('STONE') === TT.wood);
check(`IRON_ORE tier is stone (${tier('IRON_ORE')})`, tier('IRON_ORE') === TT.stone);
check(`GOLD_ORE tier is iron (${tier('GOLD_ORE')})`, tier('GOLD_ORE') === TT.iron);
check(`DIRT tier is hand/0 (${tier('DIRT')})`, tier('DIRT') === TT.hand);
const N = 6; // TOOL_CLASS_COUNT
check('correct classes are faster than wrong classes', TOOL_CLASS_SPEED[TC.pickaxe * N + TC.pickaxe] > TOOL_CLASS_SPEED[TC.shovel * N + TC.pickaxe]);
check('dig tool is flat across material classes',
  TOOL_CLASS_SPEED[TC.dig * N + TC.pickaxe] === TOOL_CLASS_SPEED[TC.dig * N + TC.axe]
  && TOOL_CLASS_SPEED[TC.dig * N + TC.axe] === TOOL_CLASS_SPEED[TC.dig * N + TC.shovel]);
check('higher tiers increase mining power', TOOL_TIER_SPEED[TT.wood] < TOOL_TIER_SPEED[TT.stone] && TOOL_TIER_SPEED[TT.stone] < TOOL_TIER_SPEED[TT.iron]);

// Non-droppable: liquids/gas/free-rigid never drop (class none).
check('WATER/OIL/LAVA/ACID are none', cls('WATER') === TC.none && cls('OIL') === TC.none && cls('LAVA') === TC.none && cls('ACID') === TC.none);
check('FIRE/STEAM are none', cls('FIRE') === TC.none && cls('STEAM') === TC.none);
check('RIGID is none', cls('RIGID') === TC.none);
check('EMPTY is none', cls('EMPTY') === TC.none);

const failures = done();
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
