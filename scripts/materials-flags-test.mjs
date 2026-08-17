// Pins the stable compatibility prefix and validates generated flags, classes,
// and transparency for every material.

import { MAT } from '../src/sand/materials.js';
import {
  MATERIALS, MATERIAL_BY_ID, MATERIAL_COUNT, TABLE_SIZE, DEFINED_MATERIAL_IDS,
  MAT_DEFINED, KIND, MAT_CLASS, MAT_FLAGS, MAT_CRAFT_FLAGS, MAT_TRANSPARENCY,
  MAT_GAS_PROFILE, MAT_EXPLOSIVE_PROFILE, MAT_HEAT_SENSITIVE_EXPLOSIVE,
  MAT_REACTION_PROFILE, MATERIAL_REACTION_PROFILE_COUNT, MRP,
  MAT_LIQUID_PROFILE, MAT_EMISSION, MAT_EMISSION_PROFILE,
  MAT_CONTACT_HAZARD_PROFILE, CONTACT_HAZARD_PLAYER_DAMAGE,
  CONTACT_HAZARD_CREATURE_DAMAGE, CONTACT_HAZARD_CADENCE,
  CONTACT_HAZARD_PRIORITY,
  MAT_HABITAT_PROFILE, MAT_AQUATIC_HABITAT, HABITAT_AQUATIC, HP,
  MAT_AMBIENCE_PROFILE, MAT_AMBIENCE_GROUP, AMBIENCE_PROFILE_GROUP,
  AMBIENCE_GROUP, AMBIENCE_GROUP_COUNT, AMBIENCE_GROUP_MIXER,
  AMBIENCE_SAMPLE_FIELD, AMBIENCE_SAMPLE_STRIDE, NO_AMBIENCE_GROUP,
  MAT_LIGHT_TRANSPARENT, MAT_LIGHT_LOSS, MC, MF, GP, XP, LMP, EP,
  PLANT_SPECIES, PLANT_SEED_MATERIAL, PLANT_WOOD_MATERIAL,
  PLANT_LEAF_MATERIAL, MAT_PLANT_SPECIES, NO_PLANT_SPECIES,
  PALETTE_MAIN_ORDER, PALETTE_SECTIONS,
} from '../src/sand/materials.generated.js';
import { makeChecker } from './sand-test-util.mjs';

const { check, done } = makeChecker('materials flags/class round-trip');

// Compatibility sets for the stable material-id prefix.
const EXPECTED = {
  flammable:    ['OIL', 'SEED', 'WOOD', 'PLANT', 'DRIFTWOOD'],
  dissolvable:  ['SAND', 'STONE', 'WOOD', 'PLANT', 'SEED', 'DRIFTWOOD'],
  rigid:        ['STONE', 'WOOD', 'PLANT', 'SEED', 'ICE', 'RIGID', 'DRIFTWOOD'],
  bearing:      ['SAND', 'STONE', 'WOOD', 'PLANT', 'SEED', 'ICE', 'RIGID', 'DRIFTWOOD'],
  plantFamily:  ['SEED', 'WOOD', 'PLANT', 'DRIFTWOOD'],
  spawnHazard:  ['OIL', 'FIRE', 'ACID', 'LAVA'],
  heatSource:   ['FIRE', 'LAVA'],
};

// Additional materials may add flags; the compatibility prefix retains these sets.
const COMPATIBILITY_PREFIX = ['EMPTY', 'SAND', 'WATER', 'STONE', 'OIL', 'FIRE', 'STEAM', 'SEED', 'WOOD', 'PLANT', 'ACID', 'LAVA', 'ICE', 'RIGID', 'DRIFTWOOD'];
const ids = new Set(COMPATIBILITY_PREFIX.map((n) => MAT[n]));
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
  check(`flag ${flag} matches the stable-id compatibility set`, okFlag);
}

// Broad material classes. These are the gameplay/physics buckets above exact
// material ids and below traits.
const COMPATIBILITY_CLASS_EXPECTED = {
  NONE: ['EMPTY'],
  GAS: ['FIRE', 'STEAM'],
  LIQUID: ['WATER', 'OIL', 'ACID', 'LAVA'],
  SOLID: ['SAND'],
  RIGID: ['STONE', 'SEED', 'WOOD', 'PLANT', 'ICE', 'RIGID', 'DRIFTWOOD'],
};
const liveIds = new Set(MATERIALS.map((m) => m.id));
check('compact catalogue count is explicit', MATERIALS.length === MATERIAL_COUNT);
check('byte-wide id table retains full extension capacity', TABLE_SIZE === 256);
check('compact defined-id iteration exactly matches the catalogue',
  DEFINED_MATERIAL_IDS.length === MATERIAL_COUNT
    && DEFINED_MATERIAL_IDS.every((id, index) => id === MATERIALS[index].id));
check('by-id catalogue and validity bitmap agree for every slot',
  MATERIAL_BY_ID.every((entry, id) => (entry !== null) === (MAT_DEFINED[id] === 1)
    && (entry === null || entry.id === id)));
check('transparency table covers every material slot', MAT_TRANSPARENCY.length >= Math.max(...liveIds) + 1);
check('material transparency is normalized', MATERIALS.every((m) => m.transparency >= 0 && m.transparency <= 1 && MAT_TRANSPARENCY[m.id] === m.transparency));
check('selected liquids, vapors, and glass are explicitly translucent',
  [2, 6, 10, 31, 33, 43, MAT.GLASS, MAT.LIGHT]
    .every((id) => MAT_TRANSPARENCY[id] > 0 && MAT_TRANSPARENCY[id] < 1));
let oneClassOk = true;
for (const m of MATERIALS) {
  const cls = MAT_CLASS[m.id];
  if (![MC.NONE, MC.GAS, MC.SOLID, MC.RIGID, MC.LIQUID].includes(cls)) oneClassOk = false;
}
check('every material has exactly one materialClass', oneClassOk && MATERIALS.length === liveIds.size);
for (const [clsName, names] of Object.entries(COMPATIBILITY_CLASS_EXPECTED)) {
  const want = new Set(names.map((n) => MAT[n]));
  let okClass = true;
  for (const id of ids) {
    const expected = want.has(id);
    if ((MAT_CLASS[id] === MC[clsName]) !== expected) {
      okClass = false;
      console.log(`    class ${clsName}: id ${id} expected ${expected}, got ${MAT_CLASS[id]}`);
    }
  }
  check(`materialClass ${clsName} matches the stable-id compatibility set`, okClass);
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
check('every plant-family material is a rigid component',
  MATERIALS.every((m) => (MAT_FLAGS[m.id] & MF.plantFamily) === 0
    || (isRigid(m.id) && m.kind === KIND.COMPONENT)));
check('every gas selects an explicit generated behavior profile',
  MATERIALS.every((m) => (m.kind === KIND.GAS) === (MAT_GAS_PROFILE[m.id] !== GP.NONE)));
check('explosive heat sensitivity derives from one generated profile',
  MATERIALS.every((m) => MAT_HEAT_SENSITIVE_EXPLOSIVE[m.id]
    === (MAT_EXPLOSIVE_PROFILE[m.id] === XP.NONE ? 0 : 1)));
check('explosive compatibility profiles preserve fuse and pocket dispatch',
  MAT_EXPLOSIVE_PROFILE[MAT.TNT] === XP.TNT_FUSE
    && MAT_EXPLOSIVE_PROFILE[MAT.METHANE] === XP.METHANE_POCKET
    && MAT_HEAT_SENSITIVE_EXPLOSIVE[MAT.TNT] === 1
    && MAT_HEAT_SENSITIVE_EXPLOSIVE[MAT.METHANE] === 1);
check('reaction profile table is bounded and defined for every material',
  MATERIALS.every((m) => MAT_REACTION_PROFILE[m.id] >= MRP.NONE
    && MAT_REACTION_PROFILE[m.id] < MATERIAL_REACTION_PROFILE_COUNT));
check('compatibility chemistry sources select reusable generated handlers',
  MAT_REACTION_PROFILE[MAT.FIRE] === MRP.FIRE
    && MAT_REACTION_PROFILE[MAT.ACID] === MRP.ACID
    && MAT_REACTION_PROFILE[MAT.LAVA] === MRP.LAVA);
check('every liquid selects an explicit generated movement profile',
  MATERIALS.every((m) => (m.kind === KIND.LIQUID) === (MAT_LIQUID_PROFILE[m.id] !== LMP.NONE)));
check('every contact hazard has generated damage, cadence, and priority',
  MATERIALS.every((m) => {
    const profile = MAT_CONTACT_HAZARD_PROFILE[m.id];
    const damaging = CONTACT_HAZARD_PLAYER_DAMAGE[profile] > 0
      || CONTACT_HAZARD_CREATURE_DAMAGE[profile] > 0;
    return damaging === (CONTACT_HAZARD_CADENCE[profile] > 0)
      && damaging === (CONTACT_HAZARD_PRIORITY[profile] > 0)
      && (!damaging || (MAT_FLAGS[m.id] & MF.spawnHazard) !== 0);
  }));
check('contact hazard compatibility profiles preserve actor policy',
  CONTACT_HAZARD_PLAYER_DAMAGE[MAT_CONTACT_HAZARD_PROFILE[MAT.FIRE]] === 4
    && CONTACT_HAZARD_CADENCE[MAT_CONTACT_HAZARD_PROFILE[MAT.FIRE]] === 30
    && CONTACT_HAZARD_PLAYER_DAMAGE[MAT_CONTACT_HAZARD_PROFILE[MAT.ACID]] === 12
    && CONTACT_HAZARD_CREATURE_DAMAGE[MAT_CONTACT_HAZARD_PROFILE[MAT.ACID]] === 12
    && CONTACT_HAZARD_PLAYER_DAMAGE[MAT_CONTACT_HAZARD_PROFILE[MAT.LAVA]] === 15);
check('material habitat policy is generated consistently',
  MATERIALS.every((m) => MAT_AQUATIC_HABITAT[m.id]
    === HABITAT_AQUATIC[MAT_HABITAT_PROFILE[m.id]]));
check('aquatic compatibility policy includes water and brine only among known liquids',
  MAT_HABITAT_PROFILE[MAT.WATER] === HP.AQUATIC
    && MAT_HABITAT_PROFILE[MAT.BRINE] === HP.AQUATIC
    && [MAT.OIL, MAT.ACID, MAT.LAVA]
      .every((id) => MAT_AQUATIC_HABITAT[id] === 0));
check('material ambience policy is generated consistently',
  MATERIALS.every((m) => MAT_AMBIENCE_GROUP[m.id]
    === AMBIENCE_PROFILE_GROUP[MAT_AMBIENCE_PROFILE[m.id]]));
check('ambience snapshot fields form one dense generated record shape',
  AMBIENCE_SAMPLE_STRIDE === Object.keys(AMBIENCE_SAMPLE_FIELD).length
    && Object.values(AMBIENCE_SAMPLE_FIELD)
      .every((offset, index, offsets) => offset === index
        && offsets.indexOf(offset) === index));
check('ambience mixer metadata is dense and complete for every generated group',
  AMBIENCE_GROUP_MIXER.length === AMBIENCE_GROUP_COUNT
    && AMBIENCE_GROUP_MIXER.every((group, id) => group.id === id
      && group.gain >= 0 && group.gain <= 1
      && typeof group.noise === 'string'
      && typeof group.filterType === 'string'
      && group.frequency > 0 && group.q >= 0));
check('continuous ambience compatibility groups retain their meanings',
  MAT_AMBIENCE_GROUP[MAT.WATER] === AMBIENCE_GROUP.WATER
    && MAT_AMBIENCE_GROUP[MAT.BRINE] === AMBIENCE_GROUP.WATER
    && MAT_AMBIENCE_GROUP[MAT.FIRE] === AMBIENCE_GROUP.FIRE
    && MAT_AMBIENCE_GROUP[MAT.LAVA] === AMBIENCE_GROUP.LAVA
    && MAT_AMBIENCE_GROUP[MAT.ACID] === AMBIENCE_GROUP.ACID
    && MAT_AMBIENCE_GROUP[MAT.OIL] === NO_AMBIENCE_GROUP);
check('emission amount and pattern profile agree for every material',
  MATERIALS.every((m) => (MAT_EMISSION[m.id] > 0)
    === (MAT_EMISSION_PROFILE[m.id] !== EP.NONE)));
check('glass light transmission is schema-derived and compatible',
  MAT_LIGHT_TRANSPARENT[MAT.GLASS] === 1 && MAT_LIGHT_LOSS[MAT.GLASS] === 6
    && MAT_LIGHT_TRANSPARENT[MAT.STONE] === 0 && MAT_LIGHT_LOSS[MAT.STONE] === 24);
check('crafting equivalence extends behavior flags from one generated table',
  (MAT_CRAFT_FLAGS[MAT.DRIFTWOOD] & MF.plantWood) !== 0
    && (MAT_FLAGS[MAT.DRIFTWOOD] & MF.plantWood) === 0
    && (MAT_CRAFT_FLAGS[MAT.VINE] & MF.plantLeaf) !== 0
    && (MAT_FLAGS[MAT.VINE] & MF.plantLeaf) === 0);
const expectedPlants = [
  ['OAK', MAT.OAK_SEED, MAT.OAK_WOOD, MAT.OAK_LEAF],
  ['PINE', MAT.SEED, MAT.PINE_WOOD, MAT.PINE_NEEDLES],
  ['WILLOW', MAT.SEED, MAT.WOOD, MAT.WILLOW_LEAF],
  ['CACTUS', MAT.SEED, MAT.CACTUS, MAT.PLANT],
  ['MUSHROOM', MAT.SEED, MAT.MUSH_STEM, MAT.MUSH_CAP],
  ['BUSH', MAT.SEED, MAT.WOOD, MAT.BUSH_LEAF],
  ['VINE', MAT.SEED, MAT.VINE, MAT.GLOWBERRY],
  ['STANDARD', MAT.SEED, MAT.WOOD, MAT.PLANT],
];
check('generated plant species preserve stable ids and material mappings',
  PLANT_SPECIES.length >= expectedPlants.length && expectedPlants.every((row, id) =>
    PLANT_SPECIES[id].id === id && PLANT_SPECIES[id].name === row[0]
      && PLANT_SEED_MATERIAL[id] === row[1]
      && PLANT_WOOD_MATERIAL[id] === row[2]
      && PLANT_LEAF_MATERIAL[id] === row[3]));
check('species-specific material reverse lookup is generated',
  MAT_PLANT_SPECIES[MAT.OAK_WOOD] === 0
    && MAT_PLANT_SPECIES[MAT.PINE_NEEDLES] === 1
    && MAT_PLANT_SPECIES[MAT.WOOD] === NO_PLANT_SPECIES);
check('creative palette order and folders are schema-generated',
  PALETTE_MAIN_ORDER[0] === 'cube' && PALETTE_MAIN_ORDER.includes('oak seed')
    && PALETTE_SECTIONS.some((section) => section.id === 'flora'
      && section.entryKinds.includes('seed')));
check('class table agrees with kind buckets for gas/liquid/powder routing',
  MATERIALS.every((m) =>
    (m.kind !== KIND.GAS || MAT_CLASS[m.id] === MC.GAS) &&
    (m.kind !== KIND.LIQUID || MAT_CLASS[m.id] === MC.LIQUID) &&
    (m.kind !== KIND.POWDER || MAT_CLASS[m.id] === MC.SOLID)));

const failures = done();
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
