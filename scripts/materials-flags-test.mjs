// Regression guard for the flag/class-based materials refactor (Phase 0).
//
// The engine's behavior predicates (isFlammable / isDissolvable / isRigidMaterial
// / isBearingMaterial / isPlantMaterial) and its seeded-component registration are
// now generated from materials.schema.json `flags` / `componentGroup` instead of
// hand-written id lists. This test pins the generated MAT_FLAGS / MAT_CGROUP tables
// to the EXACT id sets the hand-written predicates used, so the refactor can never
// silently change which materials are flammable/rigid/etc.

import { MAT } from '../src/sand/materials.js';
import { MATERIALS, KIND, MAT_CLASS, MAT_FLAGS, MAT_CGROUP, MC, MF, CG } from '../src/sand/materials.generated.js';
import { makeChecker } from './sand-test-util.mjs';

const { check, done } = makeChecker('materials flags/componentGroup round-trip');

// The historical hand-written predicate id sets (pre-refactor, members.inc).
const EXPECTED = {
  flammable:    ['OIL', 'SEED', 'WOOD', 'PLANT', 'DRIFTWOOD'],
  dissolvable:  ['SAND', 'STONE', 'WOOD', 'PLANT', 'SEED', 'DRIFTWOOD'],
  rigid:        ['STONE', 'WOOD', 'PLANT', 'SEED', 'ICE', 'RIGID', 'DRIFTWOOD'],
  bearing:      ['SAND', 'STONE', 'WOOD', 'PLANT', 'SEED', 'ICE', 'RIGID', 'DRIFTWOOD'],
  plantFamily:  ['SEED', 'WOOD', 'PLANT', 'DRIFTWOOD'],
};

// Pin only the ORIGINAL 15 materials (ids 0-14): this guards that the flag/class
// refactor reproduced the historical hand-written predicate sets exactly. Newer
// materials (id >= 15) legitimately add flags and are validated by the schema
// generator, not here.
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

// componentGroup membership.
const GROUPS = {
  stone: ['STONE'],
  plant: ['SEED', 'WOOD', 'PLANT', 'DRIFTWOOD'],
  ice: ['ICE'],
};
for (const [group, names] of Object.entries(GROUPS)) {
  const want = new Set(names.map((n) => MAT[n]));
  const gid = CG[group];
  let okGroup = gid !== undefined;
  for (const id of ids) {
    const expected = want.has(id);
    if ((MAT_CGROUP[id] === gid) !== expected) {
      okGroup = false;
      console.log(`    group ${group}: id ${id} expected ${expected}, got cgroup ${MAT_CGROUP[id]}`);
    }
  }
  check(`componentGroup ${group} matches historical id set`, okGroup);
}

// Every material not in stone/plant/ice must be CG_NONE.
let noneOk = true;
const grouped = new Set([...GROUPS.stone, ...GROUPS.plant, ...GROUPS.ice].map((n) => MAT[n]));
for (const id of ids) if (!grouped.has(id) && MAT_CGROUP[id] !== CG.none) noneOk = false;
check('all other materials are componentGroup none', noneOk);

// Broad material classes. These are the gameplay/physics buckets above exact
// material ids and below traits/component storage.
const CLASS_EXPECTED = {
  NONE: ['EMPTY'],
  GAS: ['FIRE', 'STEAM', 'ACRID_SMOKE'],
  LIQUID: ['WATER', 'OIL', 'ACID', 'LAVA', 'BRINE'],
  SOLID: ['SAND', 'DIRT', 'SNOW', 'MUD', 'SALT', 'GUNPOWDER'],
  RIGID: [
    'STONE', 'CLAY', 'SANDSTONE', 'MOSS', 'COPPER_ORE', 'IRON_ORE', 'COAL_ORE', 'GOLD_ORE', 'BRICK', 'DEBRIS',
    'ICE', 'RIGID', 'TNT',
    'SEED', 'WOOD', 'PLANT', 'DRIFTWOOD', 'PINE_WOOD', 'CACTUS', 'MUSH_STEM', 'MUSH_CAP', 'VINE',
  ],
};
const liveIds = new Set(MATERIALS.map((m) => m.id));
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

check('every componentGroup material is rigid class', MATERIALS.every((m) => MAT_CGROUP[m.id] === CG.none || isRigid(m.id)));
check('every rigid-flag material is rigid class', MATERIALS.every((m) => (MAT_FLAGS[m.id] & MF.rigid) === 0 || isRigid(m.id)));
check('every gas is non-blocking and not blast-damageable', MATERIALS.every((m) => !isGas(m.id) || (!isBlockingForPlayer(m.id) && !isBlastDamageable(m.id))));
check('every liquid is non-rigid and not component-registered', MATERIALS.every((m) => !isLiquid(m.id) || (!isRigid(m.id) && MAT_CGROUP[m.id] === CG.none)));
check('every loose solid is solid class and componentGroup none', MATERIALS.every((m) => !isLooseSolid(m.id) || (MAT_CLASS[m.id] === MC.SOLID && MAT_CGROUP[m.id] === CG.none)));
check('every plant/wood material is rigid class and plant componentGroup',
  ['SEED', 'WOOD', 'PLANT', 'DRIFTWOOD', 'PINE_WOOD', 'CACTUS', 'MUSH_STEM', 'MUSH_CAP', 'VINE']
    .every((n) => isRigid(MAT[n]) && MAT_CGROUP[MAT[n]] === CG.plant));
check('class table agrees with legacy kind buckets for gas/liquid/powder routing',
  MATERIALS.every((m) =>
    (m.kind !== KIND.GAS || MAT_CLASS[m.id] === MC.GAS) &&
    (m.kind !== KIND.LIQUID || MAT_CLASS[m.id] === MC.LIQUID) &&
    (m.kind !== KIND.POWDER || MAT_CLASS[m.id] === MC.SOLID)));

const failures = done();
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
