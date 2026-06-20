// Regression guard for the flag/class-based materials refactor (Phase 0).
//
// The engine's behavior predicates (isFlammable / isDissolvable / isRigidMaterial
// / isBearingMaterial / isPlantMaterial) and its seeded-component registration are
// now generated from materials.schema.json `flags` / `componentGroup` instead of
// hand-written id lists. This test pins the generated MAT_FLAGS / MAT_CGROUP tables
// to the EXACT id sets the hand-written predicates used, so the refactor can never
// silently change which materials are flammable/rigid/etc.

import { MAT } from '../src/sand/materials.js';
import { MAT_FLAGS, MAT_CGROUP, MF, CG } from '../src/sand/materials.generated.js';
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

const ids = new Set(Object.values(MAT));
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

const failures = done();
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
