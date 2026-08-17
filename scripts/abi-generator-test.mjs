import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ABI_FINGERPRINT, ACTOR_WIRE_FINGERPRINT, NETWORK_CATALOGUE_FINGERPRINT,
  CREATURE, CREATURE_CREATIVE_ENTRIES, CREATURE_MAX_DIMENSION,
  CREATURE_MAX_RECORDS, CREATURE_SPECIES_DEFS, OFF, RECORD_CODECS,
  SNAPSHOT_CODECS, SOUND_EVENT_MAX_RECORDS, STRIDES,
  writeGlPlayerExtSnapshot,
} from '../src/sand/wasmBridge/abi.generated.js';
import { unpackSnapshotRecordAt } from '../src/sand/wasmBridge/recordCodec.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const generator = resolve(root, 'scripts/generate-abi.mjs');
const sourceSchema = JSON.parse(readFileSync(
  resolve(root, 'src/sand/abi.schema.json'), 'utf8'));
const sourceMaterialsSchema = JSON.parse(readFileSync(
  resolve(root, 'src/sand/materials.schema.json'), 'utf8'));
const sourceBiomesSchema = JSON.parse(readFileSync(
  resolve(root, 'src/sand/biomes.schema.json'), 'utf8'));
const sourceReactionsSchema = JSON.parse(readFileSync(
  resolve(root, 'src/sand/reactions.schema.json'), 'utf8'));
const sourceBehaviorProfiles = readFileSync(
  resolve(root, 'src/sand/cpp/engine/creature_behavior_profiles.def'), 'utf8');
const sourceBehaviorPolicies = readFileSync(
  resolve(root, 'src/sand/cpp/engine/creature_behavior_policies.def'), 'utf8');
const sourceRenderProfiles = readFileSync(
  resolve(root, 'src/sand/cpp/engine/creature_render_profiles.def'), 'utf8');
const temp = mkdtempSync(resolve(tmpdir(), 'sand-abi-generator-'));
let failures = 0;
const check = (name, passed) => {
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${name}`);
  if (!passed) failures++;
};

const run = (name, mutate, expectedMessage = '', options = {}) => {
  const schema = structuredClone(sourceSchema);
  mutate(schema);
  const path = resolve(temp, `${name.replaceAll(' ', '-')}.json`);
  writeFileSync(path, `${JSON.stringify(schema, null, 2)}\n`);
  const behaviorPath = resolve(temp, `${name.replaceAll(' ', '-')}-behavior.def`);
  const behaviorPoliciesPath = resolve(
    temp, `${name.replaceAll(' ', '-')}-behavior-policies.def`);
  const renderPath = resolve(temp, `${name.replaceAll(' ', '-')}-render.def`);
  if (options.behaviorProfiles) writeFileSync(behaviorPath, options.behaviorProfiles);
  if (options.behaviorPolicies !== undefined)
    writeFileSync(behaviorPoliciesPath, options.behaviorPolicies);
  if (options.renderProfiles) writeFileSync(renderPath, options.renderProfiles);
  const result = spawnSync(process.execPath, [
    generator, '--validate-only',
    ...(options.creatureContract ? ['--print-creature-contract'] : []),
  ], {
    cwd: root,
    env: {
      ...process.env,
      SAND_ABI_SCHEMA_PATH: path,
      ...(options.behaviorProfiles ? {
        SAND_CREATURE_BEHAVIOR_PROFILES_PATH: behaviorPath,
      } : {}),
      ...(options.behaviorPolicies !== undefined ? {
        SAND_CREATURE_BEHAVIOR_POLICIES_PATH: behaviorPoliciesPath,
      } : {}),
      ...(options.renderProfiles ? {
        SAND_CREATURE_RENDER_PROFILES_PATH: renderPath,
      } : {}),
    },
    encoding: 'utf8',
  });
  let passed = expectedMessage
    ? result.status !== 0 && result.stderr.includes(expectedMessage)
    : result.status === 0;
  if (passed && options.creatureContract) {
    const line = result.stdout.split(/\r?\n/)
      .find((entry) => entry.startsWith('CREATURE_CONTRACT='));
    passed = !!line && options.creatureContract(
      JSON.parse(line.slice('CREATURE_CONTRACT='.length)));
  }
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${name}`);
  if (!passed) {
    failures++;
    console.error(result.stderr || result.stdout);
  }
};

const runRaw = (name, source, expectedMessage) => {
  const path = resolve(temp, `${name.replaceAll(' ', '-')}.json`);
  writeFileSync(path, source);
  const result = spawnSync(process.execPath, [generator, '--validate-only'], {
    cwd: root,
    env: { ...process.env, SAND_ABI_SCHEMA_PATH: path },
    encoding: 'utf8',
  });
  const passed = result.status !== 0 && result.stderr.includes(expectedMessage);
  check(name, passed);
  if (!passed) console.error(result.stderr || result.stdout);
};

const readFingerprints = (name, mutate = {}) => {
  const schema = structuredClone(sourceSchema);
  const materials = structuredClone(sourceMaterialsSchema);
  const biomes = structuredClone(sourceBiomesSchema);
  const reactions = structuredClone(sourceReactionsSchema);
  mutate.schema?.(schema);
  mutate.materials?.(materials);
  mutate.biomes?.(biomes);
  mutate.reactions?.(reactions);
  const stem = name.replaceAll(' ', '-');
  const schemaPath = resolve(temp, `${stem}-abi.json`);
  const materialsPath = resolve(temp, `${stem}-materials.json`);
  const biomesPath = resolve(temp, `${stem}-biomes.json`);
  const reactionsPath = resolve(temp, `${stem}-reactions.json`);
  writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
  writeFileSync(materialsPath, `${JSON.stringify(materials, null, 2)}\n`);
  writeFileSync(biomesPath, `${JSON.stringify(biomes, null, 2)}\n`);
  writeFileSync(reactionsPath, `${JSON.stringify(reactions, null, 2)}\n`);
  const result = spawnSync(process.execPath, [
    generator, '--validate-only', '--print-fingerprints',
  ], {
    cwd: root,
    env: {
      ...process.env,
      SAND_ABI_SCHEMA_PATH: schemaPath,
      SAND_MATERIALS_SCHEMA_PATH: materialsPath,
      SAND_BIOMES_SCHEMA_PATH: biomesPath,
      SAND_REACTIONS_SCHEMA_PATH: reactionsPath,
    },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    return null;
  }
  const line = result.stdout.split(/\r?\n/)
    .find((entry) => entry.startsWith('FINGERPRINTS='));
  return line ? JSON.parse(line.slice('FINGERPRINTS='.length)) : null;
};

console.log('ABI snapshot writer generator');
run('declared producer sources generate', () => {});
run('new packed field without a producer source is rejected', (schema) => {
  schema.structs.playerSnapshot.fields.push({ name: 'fixture', kind: 'number' });
}, 'needs exactly one of member, parameter, or literal');
run('missing producer source is rejected', (schema) => {
  delete schema.structs.itemSnapshot.fields[0].snapshotMember;
}, 'needs exactly one of member, parameter, or literal');
run('ambiguous producer source is rejected', (schema) => {
  schema.structs.projectileSnapshot.fields[0].snapshotParameter = true;
}, 'needs exactly one of member, parameter, or literal');
run('variant source typo is rejected', (schema) => {
  schema.structs.creatureSnapshot.snapshotWriters[1].sources.fixture = {
    literal: 0,
  };
}, 'sources references unknown fields: fixture');
run('literal kind mismatch is rejected', (schema) => {
  schema.structs.creatureSnapshot.snapshotWriters[1].sources.alive = {
    literal: 0,
  };
}, 'boolean snapshot literal must be boolean');
run('int32 writer field without a source is rejected', (schema) => {
  schema.structs.perfSnapshot.fields.push({ name: 'fixture', kind: 'number' });
}, 'needs exactly one of member, parameter, or literal');
run('JS writer field without a source is rejected', (schema) => {
  schema.structs.glPlayerExt.fields.push({ name: 'fixture', kind: 'number' });
}, 'needs exactly one of member, parameter, or literal');
run('test body added field without a source is rejected', (schema) => {
  schema.structs.testBodyState.fields.push({ name: 'fixture', kind: 'number' });
}, 'needs exactly one of member, parameter, or literal');
run('test body field reordering remains schema-owned', (schema) => {
  const fields = schema.structs.testBodyState.fields;
  fields.unshift(fields.pop());
});
run('unknown snapshot storage is rejected', (schema) => {
  schema.structs.soundEvent.snapshotStorage = 'float16';
}, 'snapshotStorage must be float, double, or int32');
run('unknown writer language is rejected', (schema) => {
  schema.structs.glPlayerExt.snapshotWriters[0].language = 'typescript';
}, 'language must be cpp or js');
run('synthetic passive species is a one-record extension', (schema) => {
  const descriptors = schema.enums.CreatureSpecies.descriptors;
  const fixture = structuredClone(descriptors[0]);
  fixture.id = descriptors.length;
  fixture.key = 'CREATURE_FIXTURE_PASSIVE';
  fixture.cSymbol = 'CS_FIXTURE_PASSIVE';
  fixture.name = 'fixture passive';
  delete fixture.creative;
  fixture.stats.prey = [];
  fixture.world = {
    requiredTags: ['WA_SURFACE'],
    excludedTags: ['WA_INDOOR'],
    allowedSurfaceBiomes: ['BIOME_PLAINS'],
    allowedCaveBiomes: [],
    preferredSurfaceBiomes: ['BIOME_PLAINS'],
    minDepth: -20,
    maxDepth: 20,
    baseWeight: 0,
    preferredBonus: 7,
  };
  descriptors.push(fixture);
}, '', { creatureContract: (contract) => {
  const fixture = contract.species.find(
    ({ cSymbol }) => cSymbol === 'CS_FIXTURE_PASSIVE');
  return contract.count === 21
    && contract.ambient.at(-1) === 'CS_FIXTURE_PASSIVE'
    && fixture?.behaviorProfile === 'CRBH_GENERIC'
    && fixture?.renderProfile === 'CRP_MINNOW';
} });
run('unknown species behavior profile is rejected', (schema) => {
  schema.enums.CreatureSpecies.descriptors[0].behaviorProfile = 'CRBH_MISSING';
}, 'behaviorProfile is unknown');
run('new behavior profile without a handler is rejected', (schema) => {
  schema.creatureBehaviorProfiles.CRBH_FIXTURE =
    Object.keys(schema.creatureBehaviorProfiles).length;
}, 'exactly one row per behavior profile');
run('duplicate behavior handler row is rejected', () => {},
  'duplicate profile row', {
    behaviorProfiles: sourceBehaviorProfiles.replace(
      /^SAND_CREATURE_BEHAVIOR_PROFILE\(CRBH_REACTOR_WARDEN,.*$/m,
      sourceBehaviorProfiles.match(
        /^SAND_CREATURE_BEHAVIOR_PROFILE\(CRBH_GENERIC,.*$/m)[0]),
  });
run('missing creature attack policy is rejected', () => {},
  'behavior policy ids must be unique and dense in source order', {
    behaviorPolicies: sourceBehaviorPolicies.replace(
      /^SAND_CREATURE_ATTACK_POLICY\(CAH_GENERIC, 0\)\n/m, ''),
  });
run('duplicate creature policy ids are rejected', () => {},
  'behavior policy ids must be unique and dense in source order', {
    behaviorPolicies: sourceBehaviorPolicies.replace(
      'SAND_CREATURE_ATTACK_POLICY(CAH_BOSS, 6)',
      'SAND_CREATURE_ATTACK_POLICY(CAH_BOSS, 5)'),
  });
run('reordered creature policies are rejected', () => {},
  'behavior policy ids must be unique and dense in source order', {
    behaviorPolicies: sourceBehaviorPolicies.replace(
      'SAND_CREATURE_ATTACK_POLICY(CAH_GENERIC, 0)\nSAND_CREATURE_ATTACK_POLICY(CAH_DYNAMITEER, 1)',
      'SAND_CREATURE_ATTACK_POLICY(CAH_DYNAMITEER, 1)\nSAND_CREATURE_ATTACK_POLICY(CAH_GENERIC, 0)'),
  });
run('new render profile without a handler is rejected', (schema) => {
  schema.creatureRenderProfiles.CRP_FIXTURE =
    Object.keys(schema.creatureRenderProfiles).length;
}, 'exactly one row per render profile');
run('duplicate render handler row is rejected', () => {},
  'duplicate profile row', {
    renderProfiles: sourceRenderProfiles.replace(
      /^SAND_CREATURE_RENDER_PROFILE\(CRP_VILLAGER,.*$/m,
      sourceRenderProfiles.match(
        /^SAND_CREATURE_RENDER_PROFILE\(CRP_MINNOW,.*$/m)[0]),
  });
run('unspawnable ambient species is rejected', (schema) => {
  schema.enums.CreatureSpecies.descriptors[0].population.maxActive = 0;
}, 'unusable spawn band or cap');
run('creature dimensions must be positive', (schema) => {
  schema.enums.CreatureSpecies.descriptors[0].stats.w = 0;
}, 'stats.w must be an integer in 1..CREATURE_MAX_DIMENSION');
run('creature dimensions share the network maximum', (schema) => {
  schema.enums.CreatureSpecies.descriptors[0].stats.h =
    schema.constants.CREATURE_MAX_DIMENSION + 1;
}, 'stats.h must be an integer in 1..CREATURE_MAX_DIMENSION');
run('creature health must be positive', (schema) => {
  schema.enums.CreatureSpecies.descriptors[0].stats.maxHealth = 0;
}, 'stats.maxHealth must be a positive integer');
run('creature fluid thresholds are normalized coverage', (schema) => {
  schema.enums.CreatureSpecies.descriptors[0].stats.fluidThreshold = 1.01;
}, 'stats.fluidThreshold must be in 0..1');
run('aquatic locomotion requires water habitat', (schema) => {
  schema.enums.CreatureSpecies.descriptors[0].population.habitat = 'CH_SURFACE';
}, 'aquatic locomotion requires water habitat');
run('water habitat cannot accept a dry box', (schema) => {
  schema.enums.CreatureSpecies.descriptors[0].stats.fluidThreshold = 0;
}, 'water habitat requires a positive fluidThreshold');
run('creative creature metadata requires a complete icon', (schema) => {
  schema.enums.CreatureSpecies.descriptors[0].creative.colors.pop();
}, 'needs a non-negative order and two hex colors');
run('creative creature ordering is unambiguous', (schema) => {
  schema.enums.CreatureSpecies.descriptors[2].creative.order = 0;
}, 'creative orders must be unique and dense from zero');
run('creature world numeric fields require int32 values', (schema) => {
  schema.enums.CreatureSpecies.descriptors[0].world.baseWeight = '10';
}, 'world.baseWeight must be an int32');
run('creature world weight ranges are bounded', (schema) => {
  schema.enums.CreatureSpecies.descriptors[0].world.preferredBonus = -1;
}, 'world.preferredBonus must be an int32 in 0..2147483647');
run('creature world weight sums cannot overflow', (schema) => {
  const world = schema.enums.CreatureSpecies.descriptors[0].world;
  world.baseWeight = 2147483647;
  world.preferredBonus = 1;
}, 'world spawn weights exceed int32 range');
run('creature roster weight sums cannot overflow', (schema) => {
  const ambient = schema.enums.CreatureSpecies.descriptors
    .filter((descriptor) => descriptor.population.profile === 'CPOP_AMBIENT');
  ambient[0].world.baseWeight = 1100000000;
  ambient[0].world.preferredBonus = 0;
  ambient[1].world.baseWeight = 1100000000;
  ambient[1].world.preferredBonus = 0;
}, 'CPOP_AMBIENT aggregate spawn weights exceed int32 range');
run('creature world required and excluded tags are disjoint', (schema) => {
  const world = schema.enums.CreatureSpecies.descriptors[2].world;
  world.requiredTags = ['WA_SURFACE'];
  world.excludedTags = ['WA_SURFACE'];
}, 'world requires and excludes WA_SURFACE');
run('surface habitat needs a reachable surface biome', (schema) => {
  schema.enums.CreatureSpecies.descriptors[2].world.allowedSurfaceBiomes = [];
}, 'world has no habitat-compatible biome reach');
run('cave habitat needs a reachable cave biome', (schema) => {
  schema.enums.CreatureSpecies.descriptors[4].world.allowedCaveBiomes = [];
}, 'world has no habitat-compatible biome reach');
run('water habitat needs a reachable biome realm', (schema) => {
  const world = schema.enums.CreatureSpecies.descriptors[0].world;
  world.allowedSurfaceBiomes = [];
  world.allowedCaveBiomes = [];
}, 'world has no habitat-compatible biome reach');
run('creature world depth range must be ordered', (schema) => {
  const world = schema.enums.CreatureSpecies.descriptors[2].world;
  world.minDepth = 5;
  world.maxDepth = 4;
}, 'world minDepth must not exceed maxDepth');
run('natural creature needs positive reachable spawn weight', (schema) => {
  const world = schema.enums.CreatureSpecies.descriptors[2].world;
  world.baseWeight = 0;
  world.preferredBonus = 0;
  world.preferredTags = [];
  world.preferredSurfaceBiomes = [];
}, 'world has no positive reachable spawn weight');
run('natural creature preferences must intersect its reach', (schema) => {
  const world = schema.enums.CreatureSpecies.descriptors[2].world;
  world.baseWeight = 0;
  world.preferredBonus = 5;
  world.allowedSurfaceBiomes = ['BIOME_PLAINS'];
  world.preferredSurfaceBiomes = ['BIOME_DESERT'];
  world.preferredTags = [];
}, 'world has no positive reachable spawn weight');
run('prey mask descriptor cap is enforced', (schema) => {
  const descriptors = schema.enums.CreatureSpecies.descriptors;
  while (descriptors.length <= 32) {
    const fixture = structuredClone(descriptors[0]);
    fixture.id = descriptors.length;
    fixture.key = `CREATURE_FIXTURE_${fixture.id}`;
    fixture.cSymbol = `CS_FIXTURE_${fixture.id}`;
    fixture.name = `fixture ${fixture.id}`;
    fixture.stats.prey = [];
    descriptors.push(fixture);
  }
}, 'at most 32 descriptors');
run('world area tags must remain independent bits', (schema) => {
  schema.enums.WorldAreaTag.values.WA_SURFACE = 3;
}, 'WorldAreaTag values must be unique nonzero one-hot uint32 bits');
run('planet terrain profiles require compatible material profiles', (schema) => {
  const moon = schema.enums.PlanetId.descriptors.find(
    (descriptor) => descriptor.generationProfile === 'PGP_MOON');
  moon.offworldMaterialProfile = 'OWMP_NONE';
}, 'generation/offworld material profiles are incompatible');
run('facility shells must remain load-bearing structures', (schema) => {
  schema.enums.PlanetId.descriptors[0].facilityShell = 'WATER';
}, 'facilityShell must be a load-bearing structure material');
run('creature snapshot limit must stay positive', (schema) => {
  schema.constants.CREATURE_MAX_RECORDS = 0;
}, 'creatureSnapshot.wireCodec record limit must resolve to a positive integer');
run('sound snapshot limit must stay positive', (schema) => {
  schema.constants.SOUND_EVENT_MAX_RECORDS = 0;
}, 'soundEvent.wireCodec record limit must resolve to a positive integer');

runRaw('nested duplicate JSON keys are rejected',
  '{"outer":{"same":1,"same":2}}\n',
  'duplicate JSON key "same"');
runRaw('escaped duplicate JSON keys are rejected',
  '{"outer":{"same":1,"s\\u0061me":2}}\n',
  'duplicate JSON key "same"');

const baselineFingerprints = readFingerprints('baseline fingerprints');
const materialFingerprints = readFingerprints('material fingerprint mutation', {
  materials: (materials) => {
    materials.materials.find(({ name }) => name === 'SAND').density += 0.01;
  },
});
const biomeFingerprints = readFingerprints('biome fingerprint mutation', {
  biomes: (biomes) => { biomes.surfaceBiomes[0].soilAdd += 1; },
});
const reactionFingerprints = readFingerprints('reaction fingerprint mutation', {
  reactions: (reactions) => { reactions.rules[0].schedule.every += 1; },
});
const reactionFixtureFingerprints = readFingerprints(
  'reaction fixture fingerprint mutation', {
    reactions: (reactions) => { reactions.fixtures[0].schedule.every += 1; },
  },
);
const protocolEnumFingerprints = readFingerprints(
  'protocol enum fingerprint mutation', {
    schema: (schema) => {
      const values = schema.enums.Tool.values;
      values.T_FIXTURE = Math.max(...Object.values(values)) + 1;
    },
  },
);
check('generated fingerprint exports match the canonical source contracts',
  baselineFingerprints
    && Number.parseInt(baselineFingerprints.abi, 16) === ABI_FINGERPRINT
    && Number.parseInt(baselineFingerprints.actorWire, 16)
      === ACTOR_WIRE_FINGERPRINT
    && Number.parseInt(baselineFingerprints.networkCatalogue, 16)
      === NETWORK_CATALOGUE_FINGERPRINT);
check('material semantics invalidate runtime and network catalogues',
  materialFingerprints
    && materialFingerprints.abi !== baselineFingerprints?.abi
    && materialFingerprints.networkCatalogue
      !== baselineFingerprints?.networkCatalogue
    && materialFingerprints.actorWire === baselineFingerprints?.actorWire);
check('biome semantics invalidate runtime and network catalogues',
  biomeFingerprints
    && biomeFingerprints.abi !== baselineFingerprints?.abi
    && biomeFingerprints.networkCatalogue !== baselineFingerprints?.networkCatalogue
    && biomeFingerprints.actorWire === baselineFingerprints?.actorWire);
check('reaction semantics invalidate runtime and network catalogues',
  reactionFingerprints
    && reactionFingerprints.abi !== baselineFingerprints?.abi
    && reactionFingerprints.networkCatalogue
      !== baselineFingerprints?.networkCatalogue
    && reactionFingerprints.actorWire === baselineFingerprints?.actorWire);
check('test-only reaction fixtures do not invalidate runtime catalogues',
  reactionFixtureFingerprints
    && reactionFixtureFingerprints.abi === baselineFingerprints?.abi
    && reactionFixtureFingerprints.networkCatalogue
      === baselineFingerprints?.networkCatalogue
    && reactionFixtureFingerprints.actorWire === baselineFingerprints?.actorWire);
check('every generated protocol enum participates in peer compatibility',
  protocolEnumFingerprints
    && protocolEnumFingerprints.abi !== baselineFingerprints?.abi
    && protocolEnumFingerprints.networkCatalogue
      !== baselineFingerprints?.networkCatalogue
    && protocolEnumFingerprints.actorWire === baselineFingerprints?.actorWire);

const glRecord = { x: 1, y: 2, w: 3, h: 4, facing: -1 };
const glPacked = new Float32Array(STRIDES.glPlayerExt);
writeGlPlayerExtSnapshot(
  glPacked, 0, glRecord, true, 5, 6, true, 7, 0.8, 9, 10,
  0.7, true, 123, false,
);
check('generated JS writer follows generated field order',
  glPacked[OFF.glPlayerExt.x] === 1
    && glPacked[OFF.glPlayerExt.own] === 1
    && glPacked[OFF.glPlayerExt.animState] === 5
    && glPacked[OFF.glPlayerExt.aimY] === 10
    && glPacked[OFF.glPlayerExt.shieldHealth] === 123
    && glPacked[OFF.glPlayerExt.shieldActive] === 0);

const bodyCodec = SNAPSHOT_CODECS.testBodyState;
const bodyPacked = new Float64Array(STRIDES.testBodyState);
for (let i = 0; i < bodyPacked.length; i++) bodyPacked[i] = 1000 + i;
bodyPacked[OFF.testBodyState.hadContact] = 1;
const bodyState = unpackSnapshotRecordAt(bodyPacked, 'testBodyState', 0);
check('generated test body codec follows schema names, kinds, and stride',
  JSON.stringify(bodyCodec.fields) === JSON.stringify(
    sourceSchema.structs.testBodyState.fields.map(({ name }) => name),
  )
    && bodyCodec.storage === 'double'
    && bodyPacked.length === bodyCodec.fields.length
    && bodyState.px === bodyPacked[OFF.testBodyState.px]
    && bodyState.worldStillTicks
      === (bodyPacked[OFF.testBodyState.worldStillTicks] >>> 0)
    && bodyState.hadContact === true);
let omittedRejected = false;
try {
  writeGlPlayerExtSnapshot(
    glPacked, 0, glRecord, true, 5, 6, true, 7, 0.8, 9, 10,
    0.7, true, 123,
  );
} catch (error) {
  omittedRejected = error instanceof TypeError;
}
check('generated JS writer rejects an omitted semantic parameter', omittedRejected);
let reorderedRejected = false;
try {
  writeGlPlayerExtSnapshot(
    glPacked, 0, glRecord, 5, true, 6, true, 7, 0.8, 9, 10,
    0.7, true, 123, false,
  );
} catch (error) {
  reorderedRejected = error instanceof TypeError;
}
check('generated JS writer rejects reordered semantic parameter kinds',
  reorderedRejected);

const generatedHeader = readFileSync(
  resolve(root, 'src/sand/cpp/engine/abi.generated.hpp'), 'utf8');
check('generated C++ semantic parameters are named required wrappers',
  generatedHeader.includes('WriteCreatureSnapshotX() = delete;')
    && generatedHeader.includes('const WriteCreatureSnapshotParameters& values')
    && generatedHeader.includes('values.aimY.value'));
const generatedCreatures = readFileSync(
  resolve(root, 'src/sand/cpp/engine/creatures.generated.hpp'), 'utf8');
const creatureHeader = readFileSync(
  resolve(root, 'src/sand/cpp/engine/creatures.hpp'), 'utf8');
const creatureImplementation = readFileSync(
  resolve(root, 'src/sand/cpp/engine/creatures_impl.inc'), 'utf8');
const creatureRenderer = readFileSync(
  resolve(root, 'src/sand/cpp/engine/glpresenter_impl.inc'), 'utf8');
check('empty external player and item snapshots avoid null pointer ranges',
  creatureRenderer.includes('if (glUseExtPlayers && data && count > 0)')
    && creatureRenderer.includes('if (glUseExtItems && data && count > 0)'));
check('creature ids and descriptor order preserve the stable ABI',
  CREATURE.MINNOW === 0
    && CREATURE.DYNAMITEER === 7
    && CREATURE.VILLAGER === 19
    && CREATURE_SPECIES_DEFS.length === 20
    && CREATURE_SPECIES_DEFS[19].key === 'villager');
const sourceCreativeSpecies = sourceSchema.enums.CreatureSpecies.descriptors
  .filter((descriptor) => descriptor.creative !== undefined)
  .sort((a, b) => a.creative.order - b.creative.order);
check('creative spawn eggs derive availability, order, and icon from species rows',
  CREATURE_MAX_DIMENSION === sourceSchema.constants.CREATURE_MAX_DIMENSION
    && CREATURE_MAX_RECORDS === sourceSchema.constants.CREATURE_MAX_RECORDS
    && RECORD_CODECS.creatureSnapshot.maxRecords === CREATURE_MAX_RECORDS
    && RECORD_CODECS.soundEvent.maxRecords === SOUND_EVENT_MAX_RECORDS
    && CREATURE_CREATIVE_ENTRIES.length === sourceCreativeSpecies.length
    && CREATURE_CREATIVE_ENTRIES.every((entry, index) =>
      entry.id === sourceCreativeSpecies[index].id
        && entry.colors.join('/')
          === sourceCreativeSpecies[index].creative.colors.join('/')));
check('generated creature registries own species, population, and render sync',
  creatureHeader.includes('#include "creatures.generated.hpp"')
    && !creatureHeader.includes('static const CreatureSpecies')
    && generatedCreatures.includes('AMBIENT_CREATURE_SPECIES')
    && generatedCreatures.includes('ENCOUNTER_CREATURE_SPECIES')
    && generatedCreatures.includes('CREATURE_RENDER_PROFILES')
    && generatedCreatures.includes('creatureRegistriesAreComplete'));
check('specialized creature dispatch no longer uses species allowlists',
  !creatureImplementation.includes('ambientRoster')
    && !creatureImplementation.includes('static const uint8_t roster')
    && !creatureImplementation.includes('c.species == CS_DYNAMITEER')
    && !creatureRenderer.includes('speciesId == CS_'));
const renderAssetOrder = [...sourceRenderProfiles.matchAll(
  /^SAND_CREATURE_RENDER_PROFILE\([^,]+,\s*(CRA_[A-Z0-9_]+)\)$/gm,
)].map((match) => match[1]);
check('renderer pins every named asset to its authored palette and sprite row',
  renderAssetOrder.length === 20
    && renderAssetOrder.every((asset, index) =>
      creatureRenderer.includes(`${asset} == ${index}`)));

rmSync(temp, { recursive: true, force: true });
console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
