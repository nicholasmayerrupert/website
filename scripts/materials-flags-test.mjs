// Pins compatibility for the original material IDs and validates generated
// flags, classes, and transparency for every material.

import { MAT } from '../src/sand/materials.js';
import { MATERIALS, KIND, MAT_CLASS, MAT_FLAGS, MAT_TRANSPARENCY, MC, MF } from '../src/sand/materials.generated.js';
import { makeChecker } from './sand-test-util.mjs';

const { check, done } = makeChecker('materials flags/class round-trip');

// Compatibility sets for the original materials.
const EXPECTED = {
  flammable:    ['OIL', 'SEED', 'WOOD', 'PLANT', 'DRIFTWOOD'],
  dissolvable:  ['SAND', 'STONE', 'WOOD', 'PLANT', 'SEED', 'DRIFTWOOD'],
  rigid:        ['STONE', 'WOOD', 'PLANT', 'SEED', 'ICE', 'RIGID', 'DRIFTWOOD'],
  bearing:      ['SAND', 'STONE', 'WOOD', 'PLANT', 'SEED', 'ICE', 'RIGID', 'DRIFTWOOD'],
  plantFamily:  ['SEED', 'WOOD', 'PLANT', 'DRIFTWOOD'],
};

// Newer materials may add flags; the original IDs must retain these sets.
const LEGACY = ['EMPTY', 'SAND', 'WATER', 'STONE', 'OIL', 'FIRE', 'STEAM', 'SEED', 'WOOD', 'PLANT', 'ACID', 'LAVA', 'ICE', 'RIGID', 'DRIFTWOOD'];
const ids = new Set(LEGACY.map((n) => MAT[n]));
const has = (id, bit) => (MAT_FLAGS[id] & bit) !== 0;

for (const [flag, names] of Object.entries(EXPECTED)) {
  const want = new Set(names.map((n) => MAT[n]));
  const bit = MF[flag];
  let okFlag = bit !== undefined;
  for (const id of ids) {
    const expected = want.has(id);
    if (has(id, bit) !== expected) {
      okFlag = false;
      console.log(`    flag ${flag}: id ${id} expected ${expected}, got ${has(id, bit)}`);
    }
  }
  check(`flag ${flag} matches historical id set`, okFlag);
}

// Broad material classes. These are the gameplay/physics buckets above exact
// material ids and below traits.
const CLASS_EXPECTED = {
  NONE: ['EMPTY'],
  GAS: ['FIRE', 'STEAM', 'ACRID_SMOKE', 'METHANE'],
  LIQUID: ['WATER', 'OIL', 'ACID', 'LAVA', 'BRINE'],
  SOLID: ['SAND', 'DIRT', 'SNOW', 'MUD', 'SALT', 'GUNPOWDER', 'GRASS'],
  RIGID: [
    'STONE', 'CLAY', 'SANDSTONE', 'MOSS', 'COPPER_ORE', 'IRON_ORE', 'COAL_ORE', 'GOLD_ORE', 'BRICK', 'DEBRIS',
    'CRYSTAL', 'MYCELIUM', 'MYCELIUM_SPORE',
    'ICE', 'RIGID', 'TNT', 'DEEPSTONE', 'GLASS',
    'SEED', 'WOOD', 'PLANT', 'DRIFTWOOD', 'PINE_WOOD', 'CACTUS', 'MUSH_STEM', 'MUSH_CAP', 'VINE',
    'GLOWBERRY', 'GLOWSHROOM', 'PINE_NEEDLES', 'WILLOW_LEAF', 'BUSH_LEAF',
  ],
};
const liveIds = new Set(MATERIALS.map((m) => m.id));
check('transparency table covers every material slot', MAT_TRANSPARENCY.length >= Math.max(...liveIds) + 1);
check('material transparency is normalized', MATERIALS.every((m) => m.transparency >= 0 && m.transparency <= 1 && MAT_TRANSPARENCY[m.id] === m.transparency));
check('selected liquids, vapors, and glass are explicitly translucent',
  [2, 6, 10, 31, 33, 43, MAT.GLASS]
    .every((id) => MAT_TRANSPARENCY[id] > 0 && MAT_TRANSPARENCY[id] < 1));
let oneClassOk = true;
for (const m of MATERIALS) {
  const cls = MAT_CLASS[m.id];
  if (![MC.NONE, MC.GAS, MC.SOLID, MC.RIGID, MC.LIQUID].includes(cls)) oneClassOk = false;
}
check('every material has exactly one materialClass', oneClassOk && MATERIALS.length === liveIds.size);
for (const [clsName, names] of Object.entries(CLASS_EXPECTED)) {
  const want = new Set(names.map((n) => MAT[n]));
  let okClass = true;
  for (const m of MATERIALS) {
    const expected = want.has(m.id);
    if ((MAT_CLASS[m.id] === MC[clsName]) !== expected) {
      okClass = false;
      console.log(`    class ${clsName}: id ${m.id} expected ${expected}, got ${MAT_CLASS[m.id]}`);
    }
  }
  check(`materialClass ${clsName} matches expected id set`, okClass);
}

const isGas = (id) => MAT_CLASS[id] === MC.GAS;
const isLiquid = (id) => MAT_CLASS[id] === MC.LIQUID;
const isLooseSolid = (id) => MAT_CLASS[id] === MC.SOLID;
const isRigid = (id) => MAT_CLASS[id] === MC.RIGID;
const isBlastDamageable = (id) => MAT_CLASS[id] !== MC.NONE && MAT_CLASS[id] !== MC.GAS;
const isBlockingForPlayer = (id) => MAT_CLASS[id] !== MC.NONE && MAT_CLASS[id] !== MC.GAS && MAT_CLASS[id] !== MC.LIQUID;

check('every structural component material is rigid class',
  MATERIALS.every((m) => m.kind !== KIND.COMPONENT || isRigid(m.id)));
check('every rigid-flag material is rigid class', MATERIALS.every((m) => (MAT_FLAGS[m.id] & MF.rigid) === 0 || isRigid(m.id)));
check('every gas is non-blocking and not blast-damageable', MATERIALS.every((m) => !isGas(m.id) || (!isBlockingForPlayer(m.id) && !isBlastDamageable(m.id))));
check('every liquid is non-rigid and non-structural',
  MATERIALS.every((m) => !isLiquid(m.id) || (!isRigid(m.id) && m.kind !== KIND.COMPONENT)));
check('every loose solid is solid class and non-structural',
  MATERIALS.every((m) => !isLooseSolid(m.id) || (MAT_CLASS[m.id] === MC.SOLID && m.kind !== KIND.COMPONENT)));
check('every plant/wood material is a flagged rigid component',
  ['SEED', 'WOOD', 'PLANT', 'DRIFTWOOD', 'PINE_WOOD', 'CACTUS', 'MUSH_STEM', 'MUSH_CAP', 'VINE',
    'GLOWBERRY', 'PINE_NEEDLES', 'WILLOW_LEAF', 'BUSH_LEAF']
    .every((n) => isRigid(MAT[n])
      && MATERIALS.find((m) => m.id === MAT[n])?.kind === KIND.COMPONENT
      && (MAT_FLAGS[MAT[n]] & MF.plantFamily) !== 0));
check('class table agrees with legacy kind buckets for gas/liquid/powder routing',
  MATERIALS.every((m) =>
    (m.kind !== KIND.GAS || MAT_CLASS[m.id] === MC.GAS) &&
    (m.kind !== KIND.LIQUID || MAT_CLASS[m.id] === MC.LIQUID) &&
    (m.kind !== KIND.POWDER || MAT_CLASS[m.id] === MC.SOLID)));

const failures = done();
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
