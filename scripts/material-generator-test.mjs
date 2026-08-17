// Exercise the generator with a real sparse stable-id fixture. This catches a
// catalogue length accidentally being reused as the valid material-id range.

import {
  copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildAmbienceVoiceSpecs } from '../src/sand/audio/sandAudio.js';
import { makeChecker } from './sand-test-util.mjs';

const { check, done } = makeChecker('sparse material registry generator');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'sand-material-generator-'));

try {
  mkdirSync(join(fixtureRoot, 'scripts'), { recursive: true });
  mkdirSync(join(fixtureRoot, 'src/sand/cpp/engine'), { recursive: true });
  copyFileSync(join(root, 'scripts/generate-materials.mjs'),
    join(fixtureRoot, 'scripts/generate-materials.mjs'));
  copyFileSync(join(root, 'scripts/schema-json.mjs'),
    join(fixtureRoot, 'scripts/schema-json.mjs'));

  const schema = JSON.parse(readFileSync(
    join(root, 'src/sand/materials.schema.json'), 'utf8'));
  const moved = schema.materials.at(-1);
  const movedOriginalId = moved.id;
  const occupiedIds = new Set(schema.materials.map((material) => material.id));
  const sparseId = Array.from(
    { length: schema.tableSize }, (_, index) => schema.tableSize - index - 1)
    .find((id) => !occupiedIds.has(id));
  if (sparseId === undefined)
    throw new Error('material table needs a free high id for the sparse fixture');
  moved.id = sparseId;
  schema.materials.sort((a, b) => a.id - b.id);
  writeFileSync(join(fixtureRoot, 'src/sand/materials.schema.json'),
    `${JSON.stringify(schema, null, 2)}\n`);

  const generated = spawnSync(process.execPath,
    ['scripts/generate-materials.mjs'], {
      cwd: fixtureRoot,
      encoding: 'utf8',
    });
  check('synthetic sparse schema generates', generated.status === 0);
  if (generated.status !== 0) process.stderr.write(generated.stderr);

  const jsSource = readFileSync(
    join(fixtureRoot, 'src/sand/materials.generated.js'), 'utf8');
  const registry = await import(
    `data:text/javascript;base64,${Buffer.from(jsSource).toString('base64')}`);
  check('catalogue stays compact', registry.MATERIAL_COUNT === schema.materials.length
    && registry.MATERIALS.length === schema.materials.length);
  check('vacated id is undefined by id',
    registry.MATERIAL_BY_ID[movedOriginalId] === null
      && registry.MAT_DEFINED[movedOriginalId] === 0
      && !registry.isMaterialId(movedOriginalId));
  check('high sparse id remains valid',
    registry.MATERIAL_BY_ID[sparseId]?.name === moved.name
      && registry.MAT_DEFINED[sparseId] === 1
      && registry.isMaterialId(sparseId));

  const hpp = readFileSync(
    join(fixtureRoot, 'src/sand/cpp/engine/materials.generated.hpp'), 'utf8');
  check('C++ emits bitmap validation instead of a dense count check',
    hpp.includes('MAT_DEFINED[TABLE]')
      && hpp.includes('static constexpr bool isMaterialId(int material)')
      && hpp.includes(`MATERIAL_ID_LIMIT = ${sparseId + 1}`)
      && hpp.includes('DEFINED_MATERIAL_IDS[MATERIAL_COUNT]'));

  const extensionSchema = structuredClone(schema);
  const standard = extensionSchema.plantSpecies.find(
    (species) => species.name === 'STANDARD');
  extensionSchema.plantSpecies.push({
    ...structuredClone(standard),
    id: extensionSchema.plantSpecies.length,
    name: 'FIXTURE_STANDARD',
    label: 'Fixture Standard',
  });
  const fixtureAmbienceGroup = Object.keys(extensionSchema.ambienceGroups).length;
  extensionSchema.ambienceGroups.fixture = {
    id: fixtureAmbienceGroup,
    gain: 0.08,
    noise: 'white',
    filterType: 'highpass',
    frequency: 1200,
    q: 0.25,
  };
  extensionSchema.ambienceProfiles.fixture = {
    id: Object.keys(extensionSchema.ambienceProfiles).length,
    group: 'fixture',
  };
  extensionSchema.gasProfiles.fixture = {
    id: Object.keys(extensionSchema.gasProfiles).length,
    decay: 0.025,
    trappedDecay: 0.125,
    upChance: 0.6,
    sideChance: 0.4,
    persistent: false,
    ceilingRoute: false,
  };
  extensionSchema.liquidMovementProfiles.fixture = {
    id: Object.keys(extensionSchema.liquidMovementProfiles).length,
    mobilityGated: false,
    straightFallIgnoresMobility: false,
    fixedFallCap: 0,
  };
  const transientGas = structuredClone(extensionSchema.materials.find(
    (material) => material.name === 'STEAM'));
  transientGas.id = movedOriginalId;
  transientGas.name = 'FIXTURE_TRANSIENT_GAS';
  transientGas.gasProfile = 'fixture';
  transientGas.ambienceProfile = 'fixture';
  extensionSchema.materials.push(transientGas);
  const extensionIds = new Set(
    extensionSchema.materials.map((material) => material.id));
  const allocateExtensionId = (label) => {
    const id = Array.from(
      { length: extensionSchema.tableSize }, (_, candidate) => candidate)
      .find((candidate) => !extensionIds.has(candidate));
    if (id === undefined)
      throw new Error(`material table needs a free id for the ${label} fixture`);
    extensionIds.add(id);
    return id;
  };
  const aquaticId = allocateExtensionId('habitat');
  const aquaticMaterial = structuredClone(extensionSchema.materials.find(
    (material) => material.name === 'WATER'));
  aquaticMaterial.id = aquaticId;
  aquaticMaterial.name = 'FIXTURE_AQUATIC';
  aquaticMaterial.liquidMovementProfile = 'fixture';
  extensionSchema.materials.push(aquaticMaterial);
  const fuseExplosive = structuredClone(extensionSchema.materials.find(
    (material) => material.name === 'TNT'));
  fuseExplosive.id = allocateExtensionId('fuse explosive');
  fuseExplosive.name = 'FIXTURE_FUSE_EXPLOSIVE';
  extensionSchema.materials.push(fuseExplosive);
  const pocketExplosive = structuredClone(extensionSchema.materials.find(
    (material) => material.name === 'METHANE'));
  pocketExplosive.id = allocateExtensionId('pocket explosive');
  pocketExplosive.name = 'FIXTURE_POCKET_EXPLOSIVE';
  extensionSchema.materials.push(pocketExplosive);
  const reactionMaterials = ['FIRE', 'ACID', 'LAVA'].map((name) => {
    const material = structuredClone(extensionSchema.materials.find(
      (candidate) => candidate.name === name));
    material.id = allocateExtensionId(`${name.toLowerCase()} reaction`);
    material.name = `FIXTURE_${name}_REACTION`;
    extensionSchema.materials.push(material);
    return material;
  });
  extensionSchema.materials.sort((a, b) => a.id - b.id);
  const defaultedMaterial = extensionSchema.materials.find(
    (material) => material.name === 'SAND');
  delete defaultedMaterial.textureAmp;
  delete defaultedMaterial.durability;
  writeFileSync(join(fixtureRoot, 'src/sand/materials.schema.json'),
    `${JSON.stringify(extensionSchema, null, 2)}\n`);
  const extensionGenerated = spawnSync(process.execPath,
    ['scripts/generate-materials.mjs'], { cwd: fixtureRoot, encoding: 'utf8' });
  check('species reusing existing growth/worldgen profiles is one record',
    extensionGenerated.status === 0);
  if (extensionGenerated.status !== 0)
    process.stderr.write(extensionGenerated.stderr);
  if (extensionGenerated.status === 0) {
    const extensionJsSource = readFileSync(
      join(fixtureRoot, 'src/sand/materials.generated.js'), 'utf8');
    const extensionRegistry = await import(
      `data:text/javascript;base64,${Buffer.from(extensionJsSource).toString('base64')}`);
    const fixtureSpecies = extensionRegistry.PLANT_SPECIES.at(-1);
    check('synthetic species inherits explicit reusable policies',
      fixtureSpecies.name === 'FIXTURE_STANDARD'
        && fixtureSpecies.growthProfile === extensionRegistry.PGR.STANDARD
        && fixtureSpecies.worldgenProfile === extensionRegistry.PWG.BROADLEAF);
    const generatedSand = extensionRegistry.MATERIAL_BY_ID[defaultedMaterial.id];
    check('optional texture/durability fields emit normalized zero defaults',
      generatedSand.textureAmp === 0 && generatedSand.durability === 0
        && !extensionJsSource.includes('undefined'));
    const generatedGas = extensionRegistry.MATERIAL_BY_ID[transientGas.id];
    check('synthetic transient gas selects non-persistent generated behavior',
      generatedGas.name === transientGas.name
        && extensionRegistry.MAT_GAS_PROFILE[transientGas.id]
          === extensionRegistry.GP.FIXTURE
        && extensionRegistry.GAS_PERSISTENT[generatedGas.gasProfile] === 0);
    const voiceSpecs = buildAmbienceVoiceSpecs(
      extensionRegistry.AMBIENCE_GROUP_MIXER);
    check('synthetic ambience group reaches dynamic browser voice construction',
      voiceSpecs.length === fixtureAmbienceGroup + 1
        && voiceSpecs[fixtureAmbienceGroup].gain === 0.08
        && voiceSpecs[fixtureAmbienceGroup].noise === 'white'
        && extensionRegistry.MAT_AMBIENCE_GROUP[transientGas.id]
          === fixtureAmbienceGroup);
    check('synthetic registry emits the shared ambience snapshot shape',
      extensionRegistry.AMBIENCE_SAMPLE_STRIDE
        === Object.keys(extensionRegistry.AMBIENCE_SAMPLE_FIELD).length
        && Object.values(extensionRegistry.AMBIENCE_SAMPLE_FIELD)
          .every((offset, index) => offset === index));
    const generatedAquatic = extensionRegistry.MATERIAL_BY_ID[aquaticId];
    check('appended material reuses habitat and ambience policies in one record',
      generatedAquatic.name === aquaticMaterial.name
        && generatedAquatic.habitatProfile === extensionRegistry.HP.AQUATIC
        && generatedAquatic.liquidMovementProfile
          === extensionRegistry.LMP.FIXTURE
        && extensionRegistry.MAT_AQUATIC_HABITAT[aquaticId] === 1
        && generatedAquatic.ambienceProfile === extensionRegistry.AP.WATER
        && extensionRegistry.MAT_AMBIENCE_GROUP[aquaticId]
          === extensionRegistry.AMBIENCE_GROUP.WATER);
    const generatedFuse = extensionRegistry.MATERIAL_BY_ID[fuseExplosive.id];
    const generatedPocket = extensionRegistry.MATERIAL_BY_ID[pocketExplosive.id];
    check('appended materials reuse generated explosive handlers in one record',
      generatedFuse.explosiveProfile === extensionRegistry.XP.TNT_FUSE
        && generatedPocket.explosiveProfile
          === extensionRegistry.XP.METHANE_POCKET
        && extensionRegistry.MAT_HEAT_SENSITIVE_EXPLOSIVE[fuseExplosive.id] === 1
        && extensionRegistry.MAT_HEAT_SENSITIVE_EXPLOSIVE[pocketExplosive.id] === 1);
    check('appended materials reuse reaction and erosion handlers in one record',
      reactionMaterials.every((material) => {
        const profileName = material.name
          .replace('FIXTURE_', '').replace('_REACTION', '');
        return extensionRegistry.MATERIAL_BY_ID[material.id].reactionProfile
            === extensionRegistry.MRP[profileName]
          && extensionRegistry.MAT_REACTION_PROFILE[material.id]
            === extensionRegistry.MRP[profileName];
      }));
  }

  const rejection = (name, mutate, message) => {
    const invalid = structuredClone(schema);
    mutate(invalid);
    writeFileSync(join(fixtureRoot, 'src/sand/materials.schema.json'),
      `${JSON.stringify(invalid, null, 2)}\n`);
    const result = spawnSync(process.execPath,
      ['scripts/generate-materials.mjs'], { cwd: fixtureRoot, encoding: 'utf8' });
    check(name, result.status !== 0 && result.stderr.includes(message));
  };
  rejection('component without rigid flag is rejected', (invalid) => {
    invalid.materials.find((m) => m.name === 'STONE').flags = ['dissolvable', 'bearing'];
  }, 'K_COMPONENT requires rigid class and rigid flag');
  rejection('non-empty NONE kind is rejected', (invalid) => {
    invalid.materials.find((m) => m.name === 'SAND').kind = 'NONE';
  }, 'K_NONE is reserved for EMPTY');
  rejection('component without rigid class is rejected', (invalid) => {
    invalid.materials.find((m) => m.name === 'STONE').materialClass = 'solid';
  }, 'K_COMPONENT requires rigid class and rigid flag');
  rejection('plant family outside component topology is rejected', (invalid) => {
    invalid.materials.find((m) => m.name === 'GLOWSHROOM').kind = 'FREE_RIGID';
  }, 'plantFamily requires a rigid component');
  rejection('plant role without plant family is rejected', (invalid) => {
    const pine = invalid.materials.find((m) => m.name === 'PINE_WOOD');
    pine.flags = pine.flags.filter((flag) => flag !== 'plantFamily');
  }, 'plantWood/plantLeaf require plantFamily');
  rejection('conflicting plant roles are rejected', (invalid) => {
    invalid.materials.find((m) => m.name === 'PINE_WOOD').flags.push('plantLeaf');
  }, 'plantWood and plantLeaf are mutually exclusive roles');
  rejection('contact hazard without spawn exclusion is rejected', (invalid) => {
    invalid.materials.find((m) => m.name === 'FIRE').flags = ['heatSource'];
  }, 'contact hazards must also be spawn hazards');
  rejection('contact hazard profile damage needs cadence', (invalid) => {
    invalid.contactHazardProfiles.fire.cadence = 0;
  }, 'damage requires cadence and priority');
  rejection('contact hazard priorities are unambiguous', (invalid) => {
    invalid.contactHazardProfiles.fire.priority =
      invalid.contactHazardProfiles.acid.priority;
  }, 'priority 2 is duplicated');
  rejection('unknown habitat profiles are rejected', (invalid) => {
    invalid.materials.find((m) => m.name === 'WATER').habitatProfile = 'missing';
  }, 'unknown habitatProfile missing');
  rejection('aquatic habitat is restricted to liquids', (invalid) => {
    invalid.materials.find((m) => m.name === 'SAND').habitatProfile = 'aquatic';
  }, 'aquatic habitat requires a liquid material');
  rejection('unknown ambience profiles are rejected', (invalid) => {
    invalid.materials.find((m) => m.name === 'WATER').ambienceProfile = 'missing';
  }, 'unknown ambienceProfile missing');
  rejection('ambience groups require complete mixer metadata', (invalid) => {
    delete invalid.ambienceGroups.water.gain;
  }, 'ambienceGroups.water has invalid mixer metadata');
  rejection('unknown explosive profiles are rejected', (invalid) => {
    invalid.materials.find((m) => m.name === 'TNT').explosiveProfile = 'missing';
  }, 'unknown explosiveProfile missing');
  rejection('fuse explosive profiles require component topology', (invalid) => {
    invalid.materials.find((m) => m.name === 'TNT').kind = 'FREE_RIGID';
  }, 'explosive profile requires kind COMPONENT');
  rejection('explosive profiles require safe-spawn exclusion', (invalid) => {
    const methane = invalid.materials.find((m) => m.name === 'METHANE');
    methane.flags = methane.flags.filter((flag) => flag !== 'spawnHazard');
  }, 'explosive profiles must also be spawn hazards');
  rejection('unknown reaction profiles are rejected', (invalid) => {
    invalid.materials.find((m) => m.name === 'ACID').reactionProfile = 'missing';
  }, 'unknown reactionProfile missing');
  rejection('reaction profiles require their implemented material kind', (invalid) => {
    invalid.materials.find((m) => m.name === 'WATER').reactionProfile = 'fire';
  }, 'reaction profile requires kind GAS');
  rejection('reaction profiles require safe-spawn exclusion', (invalid) => {
    invalid.materials.find((m) => m.name === 'STEAM').reactionProfile = 'fire';
  }, 'reaction profiles must also be spawn hazards');
  rejection('hot reaction profiles require heat-source liveness', (invalid) => {
    const steam = invalid.materials.find((m) => m.name === 'STEAM');
    steam.reactionProfile = 'fire';
    steam.flags.push('spawnHazard');
  }, 'hot reaction profiles require heatSource');
  rejection('custom explosive profiles require an implemented handler', (invalid) => {
    invalid.explosiveProfiles.fixture = {
      id: 3, heatSensitive: true, requiredKind: 'GAS',
    };
  }, 'explosiveProfiles contains an unimplemented selector');
  rejection('custom reaction profiles require an implemented handler', (invalid) => {
    invalid.reactionProfiles.fixture = { id: 4, requiredKind: 'LIQUID' };
  }, 'reactionProfiles contains an unimplemented selector');
  rejection('ambience snapshot fields require implemented consumers', (invalid) => {
    invalid.ambienceSampleFields.fixture = 3;
  }, 'ambienceSampleFields contains an unimplemented selector');
  rejection('custom render animations require an implemented handler', (invalid) => {
    invalid.renderAnims.fixture = 9;
  }, 'renderAnims contains an unimplemented selector');
  rejection('custom emission patterns require an implemented handler', (invalid) => {
    invalid.emissionProfiles.fixture = 4;
  }, 'emissionProfiles contains an unimplemented selector');
  rejection('custom render-detail patterns require an implemented handler', (invalid) => {
    invalid.renderDetailPatterns.fixture = 4;
  }, 'renderDetailPatterns contains an unimplemented selector');
  rejection('custom material kinds require implemented routing', (invalid) => {
    invalid.kinds.FIXTURE = 6;
  }, 'kinds contains an unimplemented selector');
  rejection('custom material classes require implemented routing', (invalid) => {
    invalid.materialClasses.fixture = 5;
  }, 'materialClasses contains an unimplemented selector');
  rejection('custom placement policies require implemented routing', (invalid) => {
    invalid.placementProfiles.fixture = 3;
  }, 'placementProfiles contains an unimplemented selector');
  rejection('kind placement maps reject unconsumed keys', (invalid) => {
    invalid.kindPlacementProfiles.FIXTURE = 'paint';
  }, 'kindPlacementProfiles contains an unimplemented selector');
  rejection('custom behavior flags require an implemented predicate', (invalid) => {
    invalid.flagBits.fixture = 11;
  }, 'flagBits contains an unimplemented selector');
  rejection('custom tool classes require implemented inventory routing', (invalid) => {
    invalid.toolClasses.fixture = 6;
  }, 'toolClasses contains an unimplemented selector');
  rejection('custom tool tiers require implemented inventory routing', (invalid) => {
    invalid.toolTiers.fixture = 5;
  }, 'toolTiers contains an unimplemented selector');
  rejection('unknown plant growth profiles are rejected', (invalid) => {
    invalid.plantSpecies.find((species) => species.name === 'OAK').growthProfile = 'missing';
  }, 'growthProfile names unknown profile');
  rejection('uint8-backed profile catalogues reject id overflow', (invalid) => {
    invalid.gasProfiles.fixture = {
      ...structuredClone(invalid.gasProfiles.vapor), id: 256,
    };
  }, 'must be an integer in 0..255');
  rejection('uint8-backed array profile catalogues reject count overflow', (invalid) => {
    const profile = invalid.plantGrowthProfiles.find(
      (candidate) => candidate.name === 'standard');
    invalid.plantGrowthProfiles = Array.from({ length: 257 }, (_, id) => ({
      ...structuredClone(profile), id, name: `fixtureProfile${id}`,
    }));
  }, 'cannot exceed 256 uint8-backed profiles');
  rejection('plant species reserve the byte sentinel', (invalid) => {
    const species = invalid.plantSpecies.find(
      (candidate) => candidate.name === 'STANDARD');
    for (let id = invalid.plantSpecies.length; id < 256; id++) {
      invalid.plantSpecies.push({
        ...structuredClone(species), id,
        name: `FIXTURE_SPECIES_${id}`, label: `Fixture Species ${id}`,
      });
    }
  }, 'cannot exceed 255 entries because id 255 is reserved');
  rejection('sentinel-backed ambience groups reject reserved id 255', (invalid) => {
    invalid.ambienceGroups.fixture = {
      ...structuredClone(invalid.ambienceGroups.water), id: 255,
    };
  }, 'must be an integer in 0..254');
  rejection('unknown plant worldgen profiles are rejected', (invalid) => {
    invalid.plantSpecies.find((species) => species.name === 'OAK').worldgenProfile = 'missing';
  }, 'worldgenProfile names unknown profile');
  rejection('worldgen profile reach must contain its topology', (invalid) => {
    invalid.plantWorldgenProfiles.find((profile) => profile.name === 'willow').horizontalReach = 1;
  }, 'reach cannot contain its worldgen topology');

  const fullSchema = structuredClone(schema);
  const fullIds = new Set(fullSchema.materials.map((material) => material.id));
  const filler = fullSchema.materials.find((material) => material.name === 'SAND');
  for (let id = 0; id < fullSchema.tableSize; id++) {
    if (fullIds.has(id)) continue;
    fullSchema.materials.push({
      ...structuredClone(filler),
      id,
      name: `FIXTURE_${id}`,
    });
  }
  fullSchema.materials.sort((a, b) => a.id - b.id);
  writeFileSync(join(fixtureRoot, 'src/sand/materials.schema.json'),
    `${JSON.stringify(fullSchema, null, 2)}\n`);
  const fullGenerated = spawnSync(process.execPath,
    ['scripts/generate-materials.mjs'], { cwd: fixtureRoot, encoding: 'utf8' });
  check('full byte-wide catalogue generates', fullGenerated.status === 0);
  if (fullGenerated.status !== 0) process.stderr.write(fullGenerated.stderr);
  if (fullGenerated.status === 0) {
    const fullJsSource = readFileSync(
      join(fixtureRoot, 'src/sand/materials.generated.js'), 'utf8');
    const fullRegistry = await import(
      `data:text/javascript;base64,${Buffer.from(fullJsSource).toString('base64')}`);
    check('full catalogue has no undefined byte sentinel',
      fullRegistry.MATERIAL_COUNT === fullSchema.tableSize
        && fullRegistry.MATERIAL_ID_LIMIT === fullSchema.tableSize
        && fullRegistry.FIRST_UNDEFINED_MATERIAL_ID === -1
        && fullRegistry.MAT_DEFINED.every((defined) => defined === 1));
    check('full catalogue accepts every byte and rejects the integer boundary',
      Array.from({ length: fullSchema.tableSize }, (_, id) => id)
        .every((id) => fullRegistry.isMaterialId(id))
        && !fullRegistry.isMaterialId(fullSchema.tableSize));
  }
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

const failures = done();
if (failures) process.exit(1);
console.log('\nall checks passed');
