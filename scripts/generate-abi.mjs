// Code generator for the shared JS<->WASM ABI manifest.
//
//   node scripts/generate-abi.mjs           # regenerate
//   node scripts/generate-abi.mjs --check   # fail if outputs are stale
//
// Reads src/sand/abi.schema.json plus referenced generated catalogues and emits:
//   src/sand/cpp/engine/abi.generated.hpp   (stride constants + field-offset enums)
//   src/sand/wasmBridge/abi.generated.js    (same, plus named enum objects)
// Both are committed. C++ snapshot builders write fields by named offset and
// JS reads them by the same names, so a layout change is one schema edit + a
// version bump — never a silent positional shift.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readSchemaJson } from './schema-json.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const schemaPath = process.env.SAND_ABI_SCHEMA_PATH
  ? resolve(process.env.SAND_ABI_SCHEMA_PATH)
  : resolve(root, 'src/sand/abi.schema.json');
const materialsSchemaPath = process.env.SAND_MATERIALS_SCHEMA_PATH
  ? resolve(process.env.SAND_MATERIALS_SCHEMA_PATH)
  : resolve(root, 'src/sand/materials.schema.json');
const biomesSchemaPath = process.env.SAND_BIOMES_SCHEMA_PATH
  ? resolve(process.env.SAND_BIOMES_SCHEMA_PATH)
  : resolve(root, 'src/sand/biomes.schema.json');
const abiSourcePath = resolve(root, 'src/sand/cpp/engine/abi.inc');
const hppPath = resolve(root, 'src/sand/cpp/engine/abi.generated.hpp');
const jsPath = resolve(root, 'src/sand/wasmBridge/abi.generated.js');
const creaturesHppPath = resolve(root, 'src/sand/cpp/engine/creatures.generated.hpp');
const creatureBehaviorProfilesPath = process.env.SAND_CREATURE_BEHAVIOR_PROFILES_PATH
  ? resolve(process.env.SAND_CREATURE_BEHAVIOR_PROFILES_PATH)
  : resolve(root, 'src/sand/cpp/engine/creature_behavior_profiles.def');
const creatureBehaviorPoliciesPath = process.env.SAND_CREATURE_BEHAVIOR_POLICIES_PATH
  ? resolve(process.env.SAND_CREATURE_BEHAVIOR_POLICIES_PATH)
  : resolve(root, 'src/sand/cpp/engine/creature_behavior_policies.def');
const creatureRenderProfilesPath = process.env.SAND_CREATURE_RENDER_PROFILES_PATH
  ? resolve(process.env.SAND_CREATURE_RENDER_PROFILES_PATH)
  : resolve(root, 'src/sand/cpp/engine/creature_render_profiles.def');
const bridgePaths = [
  resolve(root, 'src/sand/wasmBridge/engineFactory.js'),
  resolve(root, 'src/sand/wasmBridge/testHooks.js'),
];

const schema = readSchemaJson(schemaPath);
const materialsSchema = readSchemaJson(materialsSchemaPath);
const biomesSchema = readSchemaJson(biomesSchemaPath);
const {
  abiVersion, objectWires: declaredObjectWires = {}, structs,
  wireEnums = [], enums, constants,
  creatureBehaviorProfiles = {}, creatureRenderProfiles = {},
} = schema;
if (!Number.isInteger(abiVersion) || abiVersion < 1) throw new Error('abiVersion must be a positive integer');
const enumSources = {
  surfaceBiomes: biomesSchema.surfaceBiomes,
  caveBiomes: biomesSchema.caveBiomes,
};
for (const [name, definition] of Object.entries(enums)) {
  if (definition.valuesFrom) {
    if (definition.values || definition.descriptors) {
      throw new Error(`${name} cannot combine valuesFrom with values or descriptors`);
    }
    const records = enumSources[definition.valuesFrom];
    if (!Array.isArray(records) || !records.length) {
      throw new Error(`${name}.valuesFrom references unknown or empty catalogue ${definition.valuesFrom}`);
    }
    const symbols = records.map((record) => record.symbol);
    const ids = records.map((record) => record.id);
    if (symbols.some((symbol) => typeof symbol !== 'string')
        || new Set(symbols).size !== symbols.length) {
      throw new Error(`${name} catalogue requires unique string symbols`);
    }
    if (ids.some((id) => !Number.isInteger(id) || id < 0)
        || new Set(ids).size !== ids.length) {
      throw new Error(`${name} catalogue requires unique non-negative integer ids`);
    }
    const sorted = records.slice().sort((a, b) => a.id - b.id);
    if (sorted.some((record, index) => record.id !== index)) {
      throw new Error(`${name} catalogue ids must be dense from zero`);
    }
    definition.values = Object.fromEntries(sorted.map((record) => [record.symbol, record.id]));
  }
  if (!definition.descriptors) continue;
  if (definition.values) throw new Error(`${name} cannot declare both values and descriptors`);
  if (!Array.isArray(definition.descriptors) || !definition.descriptors.length) {
    throw new Error(`${name}.descriptors must be a non-empty array`);
  }
  const keys = definition.descriptors.map((descriptor) => descriptor.key);
  if (keys.some((key) => typeof key !== 'string') || new Set(keys).size !== keys.length) {
    throw new Error(`${name}.descriptors require unique string keys`);
  }
  const ids = definition.descriptors.map((descriptor) => descriptor.id);
  if (ids.some((id) => !Number.isInteger(id) || id < 0)
      || new Set(ids).size !== ids.length) {
    throw new Error(`${name}.descriptors require unique non-negative integer ids`);
  }
  const sortedIds = ids.slice().sort((a, b) => a - b);
  if (sortedIds.some((id, index) => id !== index)) {
    throw new Error(`${name}.descriptors must be dense from id 0`);
  }
  definition.values = Object.fromEntries(definition.descriptors
    .map((descriptor) => [descriptor.key, descriptor.id]));
}

const sortedDenseMap = (label, values) => {
  const entries = Object.entries(values).sort((a, b) => a[1] - b[1]);
  if (!entries.length || entries.some(([, id], index) => id !== index))
    throw new Error(`${label} must be non-empty and dense from zero`);
  return entries;
};
const behaviorProfiles = sortedDenseMap(
  'creatureBehaviorProfiles', creatureBehaviorProfiles);
const renderProfiles = sortedDenseMap(
  'creatureRenderProfiles', creatureRenderProfiles);
const creatureEnum = enums.CreatureSpecies;
if (!Array.isArray(creatureEnum?.descriptors))
  throw new Error('CreatureSpecies must use descriptor records');
const creatureDescriptors = creatureEnum.descriptors
  .slice().sort((a, b) => a.id - b.id);
if (creatureDescriptors.length > 32)
  throw new Error('CreatureSpecies supports at most 32 descriptors because preyMask is uint32');

const behaviorPolicySpecs = [
  { field: 'attack', macro: 'SAND_CREATURE_ATTACK_POLICY', prefix: 'CAH_', enumName: 'CreatureAttackHandler', countName: 'CAH_COUNT' },
  { field: 'telegraph', macro: 'SAND_CREATURE_TELEGRAPH_POLICY', prefix: 'CTH_', enumName: 'CreatureTelegraphHandler', countName: 'CTH_COUNT' },
  { field: 'animation', macro: 'SAND_CREATURE_ANIMATION_POLICY', prefix: 'CAP_', enumName: 'CreatureAnimationProfile', countName: 'CAP_COUNT' },
  { field: 'flying', macro: 'SAND_CREATURE_FLYING_POLICY', prefix: 'CFM_', enumName: 'CreatureFlyingMovement', countName: 'CFM_COUNT' },
  { field: 'weaponOverlay', macro: 'SAND_CREATURE_WEAPON_OVERLAY_POLICY', prefix: 'CWO_', enumName: 'CreatureWeaponOverlay', countName: 'CWO_COUNT' },
];
const behaviorPolicyRows = Object.fromEntries(
  behaviorPolicySpecs.map((spec) => [spec.field, []]));
const behaviorPolicyPattern = /^([A-Z0-9_]+)\(\s*([A-Z][A-Z0-9_]*)\s*,\s*(\d+)\s*\)$/;
for (const [lineIndex, line] of readFileSync(
  creatureBehaviorPoliciesPath, 'utf8').split(/\r?\n/)
  .map((entry) => entry.trim())
  .filter((entry) => entry && !entry.startsWith('//')).entries()) {
  const match = line.match(behaviorPolicyPattern);
  const spec = behaviorPolicySpecs.find((candidate) => candidate.macro === match?.[1]);
  if (!match || !spec || !match[2].startsWith(spec.prefix))
    throw new Error(`invalid creature behavior policy row ${lineIndex + 1}: ${line}`);
  const rows = behaviorPolicyRows[spec.field];
  const id = Number(match[3]);
  if (id !== rows.length || rows.some(({ symbol }) => symbol === match[2]))
    throw new Error(`${spec.field} behavior policy ids must be unique and dense in source order`);
  rows.push({ symbol: match[2], id });
}
for (const spec of behaviorPolicySpecs)
  if (behaviorPolicyRows[spec.field].length === 0)
    throw new Error(`${spec.field} behavior policies must be non-empty`);
const behaviorPolicyValues = Object.fromEntries(behaviorPolicySpecs.map((spec) => [
  spec.field,
  new Set(behaviorPolicyRows[spec.field].map(({ symbol }) => symbol)),
]));

const creatureBehaviorPattern = /^SAND_CREATURE_BEHAVIOR_PROFILE\(\s*(CRBH_[A-Z0-9_]+)\s*,\s*(CAH_[A-Z0-9_]+)\s*,\s*(CTH_[A-Z0-9_]+)\s*,\s*(IK_[A-Z0-9_]+)\s*,\s*(CAP_[A-Z0-9_]+)\s*,\s*(CFM_[A-Z0-9_]+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(CWO_[A-Z0-9_]+)\s*,\s*(true|false)\s*\)$/;
const creatureBehaviorRows = readFileSync(creatureBehaviorProfilesPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('//'))
  .map((line, index) => {
    const match = line.match(creatureBehaviorPattern);
    if (!match) throw new Error(
      `invalid creature behavior handler row ${index + 1}: ${line}`);
    return {
      profile: match[1], attack: match[2], telegraph: match[3],
      dropItem: match[4], animation: match[5], flying: match[6],
      nearRange: Number(match[7]), farRange: Number(match[8]),
      weaponOverlay: match[9], initialPattern: match[10] === 'true',
    };
  });
if (creatureBehaviorRows.length !== behaviorProfiles.length)
  throw new Error('creature behavior handler registry must contain exactly one row per behavior profile');
if (new Set(creatureBehaviorRows.map(({ profile }) => profile)).size
    !== creatureBehaviorRows.length)
  throw new Error('creature behavior handler registry contains a duplicate profile row');
const itemValues = new Set(Object.keys(enums.InventoryItemKind.values));
for (let index = 0; index < behaviorProfiles.length; index++) {
  const expected = behaviorProfiles[index][0];
  const row = creatureBehaviorRows[index];
  if (row.profile !== expected)
    throw new Error(`creature behavior handler row ${index + 1} must implement ${expected} in id order`);
  for (const field of Object.keys(behaviorPolicyValues))
    if (!behaviorPolicyValues[field].has(row[field]))
      throw new Error(`${expected} has unknown ${field} policy ${row[field]}`);
  if (!itemValues.has(row.dropItem))
    throw new Error(`${expected} has unknown drop item ${row.dropItem}`);
  if ((row.nearRange === 0) !== (row.farRange === 0)
      || row.nearRange > row.farRange)
    throw new Error(`${expected} has invalid ranged movement band`);
}

const creatureRenderPattern = /^SAND_CREATURE_RENDER_PROFILE\(\s*(CRP_[A-Z0-9_]+)\s*,\s*(CRA_[A-Z0-9_]+)\s*\)$/;
const creatureRenderRows = readFileSync(creatureRenderProfilesPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('//'))
  .map((line, index) => {
    const match = line.match(creatureRenderPattern);
    if (!match) throw new Error(
      `invalid creature render profile row ${index + 1}: ${line}`);
    return { profile: match[1], asset: match[2] };
  });
if (creatureRenderRows.length !== renderProfiles.length)
  throw new Error('creature render profile registry must contain exactly one row per render profile');
if (new Set(creatureRenderRows.map(({ profile }) => profile)).size
    !== creatureRenderRows.length)
  throw new Error('creature render profile registry contains a duplicate profile row');
if (new Set(creatureRenderRows.map(({ asset }) => asset)).size
    !== creatureRenderRows.length)
  throw new Error('creature render asset rows must be unique');
for (let index = 0; index < renderProfiles.length; index++)
  if (creatureRenderRows[index].profile !== renderProfiles[index][0])
    throw new Error(`creature render profile row ${index + 1} must implement ${renderProfiles[index][0]} in id order`);

const creatureSymbolByKey = new Map(
  creatureDescriptors.map((descriptor) => [descriptor.key, descriptor.cSymbol]));
const requireUniqueKnownList = (label, value, known) => {
  if (!Array.isArray(value) || new Set(value).size !== value.length
      || value.some((entry) => !known.has(entry)))
    throw new Error(`${label} must contain unique known symbols`);
};
const locomotions = new Set(['CL_AQUATIC', 'CL_AMPHIBIOUS', 'CL_FLYING', 'CL_STATIONARY']);
const habitats = new Set(['CH_WATER', 'CH_SURFACE', 'CH_CAVE', 'CH_AIR']);
const populationProfiles = new Set(['CPOP_AMBIENT', 'CPOP_ENCOUNTER', 'CPOP_SCRIPTED']);
const targetValues = new Set(['CT_PLAYER', 'CT_PREY']);
const bobProfiles = new Set(['CRB_NONE', 'CRB_WALKER', 'CRB_AQUATIC', 'CRB_BIRD', 'CRB_WASP', 'CRB_HARE']);
const protections = new Set(['CPROT_NONE', 'CPROT_ALWAYS', 'CPROT_PROTECTED_CREW']);
const behaviorProfileNames = new Set(behaviorProfiles.map(([name]) => name));
const renderProfileNames = new Set(renderProfiles.map(([name]) => name));
const worldTagValues = new Set(Object.keys(enums.WorldAreaTag.values));
const worldTagBits = Object.values(enums.WorldAreaTag.values);
if (!worldTagBits.length || worldTagBits.some((value) =>
  !Number.isInteger(value) || value <= 0 || value > 0xffffffff
    || (value & (value - 1)) !== 0)) {
  throw new Error('WorldAreaTag values must be unique nonzero one-hot uint32 bits');
}
const surfaceBiomeValues = new Set(Object.keys(enums.SurfaceBiome.values));
const caveBiomeValues = new Set(Object.keys(enums.CaveBiome.values));
const creatureKeys = new Set(creatureDescriptors.map(({ key }) => key));
const creatureMaxDimension = constants.CREATURE_MAX_DIMENSION;
if (!Number.isInteger(creatureMaxDimension) || creatureMaxDimension <= 0) {
  throw new Error('CREATURE_MAX_DIMENSION must be a positive integer');
}
const creativeCreatureDescriptors = creatureDescriptors
  .filter((descriptor) => descriptor.creative !== undefined);
for (const descriptor of creativeCreatureDescriptors) {
  const label = `CreatureSpecies.${descriptor.key}.creative`;
  if (!descriptor.creative || typeof descriptor.creative !== 'object'
      || Array.isArray(descriptor.creative)
      || !Number.isInteger(descriptor.creative.order)
      || descriptor.creative.order < 0
      || !Array.isArray(descriptor.creative.colors)
      || descriptor.creative.colors.length !== 2
      || descriptor.creative.colors.some((color) =>
        typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color))) {
    throw new Error(`${label} needs a non-negative order and two hex colors`);
  }
}
creativeCreatureDescriptors.sort(
  (a, b) => a.creative.order - b.creative.order);
if (creativeCreatureDescriptors.some((descriptor, index) =>
  descriptor.creative.order !== index)) {
  throw new Error('CreatureSpecies creative orders must be unique and dense from zero');
}
if (new Set(creativeCreatureDescriptors.map((descriptor) =>
  descriptor.creative.colors.join('/'))).size !== creativeCreatureDescriptors.length) {
  throw new Error('CreatureSpecies creative icon color pairs must be unique');
}
const worldIntegerDefaults = {
  minDepth: -2147483648,
  maxDepth: 2147483647,
  baseWeight: 10,
  preferredBonus: 20,
};
const surfaceOnlyTags = new Set(['WA_SURFACE', 'WA_SETTLEMENT']);
const caveOnlyTags = new Set(['WA_UNDERGROUND', 'WA_DEEP', 'WA_MINE']);
const statNumbers = [
  'w', 'h', 'maxHealth', 'walkSpeed', 'swimSpeed', 'accel', 'gravity',
  'jumpSpeed', 'fluidThreshold', 'sightRange', 'attackRange', 'damage',
  'attackCooldown', 'scanInterval', 'hopPeriod',
];
const statIntegers = new Set([
  'w', 'h', 'maxHealth', 'damage', 'attackCooldown', 'scanInterval', 'hopPeriod',
]);
const populationNumbers = [
  'encounterCost', 'maxActive', 'densityRadius', 'densityCap',
  'minPlayerDistance', 'maxPlayerDistance',
];
for (const descriptor of creatureDescriptors) {
  const label = `CreatureSpecies.${descriptor.key}`;
  if (!/^CREATURE_[A-Z0-9_]+$/.test(descriptor.key)
      || !/^CS_[A-Z0-9_]+$/.test(descriptor.cSymbol)
      || typeof descriptor.name !== 'string' || !descriptor.name.length)
    throw new Error(`${label} requires stable key, cSymbol, and name`);
  if (!locomotions.has(descriptor.stats?.locomotion))
    throw new Error(`${label}.stats.locomotion is unknown`);
  for (const field of statNumbers) {
    const value = descriptor.stats?.[field];
    if (field === 'w' || field === 'h') {
      if (!Number.isInteger(value) || value < 1
          || value > creatureMaxDimension) {
        throw new Error(`${label}.stats.${field} must be an integer in 1..CREATURE_MAX_DIMENSION`);
      }
      continue;
    }
    if (field === 'maxHealth') {
      if (!Number.isInteger(value) || value <= 0)
        throw new Error(`${label}.stats.maxHealth must be a positive integer`);
      continue;
    }
    if (field === 'fluidThreshold') {
      if (!Number.isFinite(value) || value < 0 || value > 1)
        throw new Error(`${label}.stats.fluidThreshold must be in 0..1`);
      continue;
    }
    if (!Number.isFinite(value) || value < 0
        || (statIntegers.has(field) && !Number.isInteger(value)))
      throw new Error(`${label}.stats.${field} must be a non-negative ${statIntegers.has(field) ? 'integer' : 'number'}`);
  }
  requireUniqueKnownList(`${label}.stats.targets`, descriptor.stats.targets, targetValues);
  requireUniqueKnownList(`${label}.stats.prey`, descriptor.stats.prey, creatureKeys);
  if (typeof descriptor.stats.hostile !== 'boolean')
    throw new Error(`${label}.stats.hostile must be boolean`);
  const population = descriptor.population;
  if (!populationProfiles.has(population?.profile)
      || !habitats.has(population?.habitat))
    throw new Error(`${label}.population has an unknown profile or habitat`);
  if (descriptor.stats.locomotion === 'CL_AQUATIC'
      && population.habitat !== 'CH_WATER') {
    throw new Error(`${label} aquatic locomotion requires water habitat`);
  }
  if (population.habitat === 'CH_WATER'
      && descriptor.stats.fluidThreshold <= 0) {
    throw new Error(`${label} water habitat requires a positive fluidThreshold`);
  }
  for (const field of populationNumbers)
    if (!Number.isInteger(population[field]) || population[field] < 0)
      throw new Error(`${label}.population.${field} must be a non-negative integer`);
  if (typeof population.countsTowardNaturalCap !== 'boolean')
    throw new Error(`${label}.population.countsTowardNaturalCap must be boolean`);
  if (population.profile === 'CPOP_ENCOUNTER' && population.encounterCost <= 0)
    throw new Error(`${label} encounter species needs a positive encounterCost`);
  if (population.profile !== 'CPOP_SCRIPTED'
      && (population.maxActive <= 0 || population.densityRadius <= 0
        || population.densityCap <= 0
        || population.maxPlayerDistance <= population.minPlayerDistance))
    throw new Error(`${label} naturally spawned population has an unusable spawn band or cap`);
  if (!behaviorProfileNames.has(descriptor.behaviorProfile))
    throw new Error(`${label}.behaviorProfile is unknown`);
  if (!renderProfileNames.has(descriptor.render?.profile)
      || !bobProfiles.has(descriptor.render?.bob)
      || typeof descriptor.render?.humanNpc !== 'boolean'
      || typeof descriptor.render?.stationaryCycle !== 'boolean')
    throw new Error(`${label}.render metadata is invalid`);
  if (!protections.has(descriptor.protection))
    throw new Error(`${label}.protection is unknown`);
  const world = descriptor.world;
  if (!world || typeof world !== 'object' || Array.isArray(world))
    throw new Error(`${label}.world must be an object`);
  const worldList = (field, known) => {
    const value = world[field] === undefined ? [] : world[field];
    requireUniqueKnownList(`${label}.world.${field}`, value, known);
    return value;
  };
  const requiredTags = worldList('requiredTags', worldTagValues);
  const excludedTags = worldList('excludedTags', worldTagValues);
  const preferredTags = worldList('preferredTags', worldTagValues);
  const allowedSurfaceBiomes = world.allowedSurfaceBiomes === undefined
    ? [...surfaceBiomeValues]
    : worldList('allowedSurfaceBiomes', surfaceBiomeValues);
  const allowedCaveBiomes = world.allowedCaveBiomes === undefined
    ? [...caveBiomeValues]
    : worldList('allowedCaveBiomes', caveBiomeValues);
  const preferredSurfaceBiomes = worldList(
    'preferredSurfaceBiomes', surfaceBiomeValues);
  const preferredCaveBiomes = worldList(
    'preferredCaveBiomes', caveBiomeValues);
  const worldNumbers = {};
  for (const [field, fallback] of Object.entries(worldIntegerDefaults)) {
    const value = world[field] === undefined ? fallback : world[field];
    if (!Number.isInteger(value) || value < -2147483648
        || value > 2147483647
        || ((field === 'baseWeight' || field === 'preferredBonus') && value < 0))
      throw new Error(`${label}.world.${field} must be an int32${field === 'baseWeight' || field === 'preferredBonus' ? ' in 0..2147483647' : ''}`);
    worldNumbers[field] = value;
  }
  if (worldNumbers.baseWeight + worldNumbers.preferredBonus * 2 > 2147483647)
    throw new Error(`${label}.world spawn weights exceed int32 range`);
  if (worldNumbers.minDepth > worldNumbers.maxDepth)
    throw new Error(`${label}.world minDepth must not exceed maxDepth`);
  const excludedSet = new Set(excludedTags);
  const overlappingTags = requiredTags.filter((tag) => excludedSet.has(tag));
  if (overlappingTags.length)
    throw new Error(`${label}.world requires and excludes ${overlappingTags.join(', ')}`);

  if (population.profile !== 'CPOP_SCRIPTED') {
    const requiresSurface = requiredTags.some((tag) => surfaceOnlyTags.has(tag));
    const requiresCave = requiredTags.some((tag) => caveOnlyTags.has(tag));
    const surfaceReachable = allowedSurfaceBiomes.length > 0
      && !requiresCave && !excludedSet.has('WA_SURFACE');
    const caveReachable = allowedCaveBiomes.length > 0
      && !requiresSurface && !excludedSet.has('WA_UNDERGROUND');
    const habitatAllowsSurface = population.habitat === 'CH_SURFACE'
      || population.habitat === 'CH_AIR' || population.habitat === 'CH_WATER';
    const habitatAllowsCave = population.habitat === 'CH_CAVE'
      || population.habitat === 'CH_WATER';
    const reachableSurface = habitatAllowsSurface && surfaceReachable;
    const reachableCave = habitatAllowsCave && caveReachable;
    if (!reachableSurface && !reachableCave)
      throw new Error(`${label}.world has no habitat-compatible biome reach`);

    const allowedSurfaceSet = new Set(allowedSurfaceBiomes);
    const allowedCaveSet = new Set(allowedCaveBiomes);
    const preferredBiomeReachable =
      (reachableSurface
        && preferredSurfaceBiomes.some((biome) => allowedSurfaceSet.has(biome)))
      || (reachableCave
        && preferredCaveBiomes.some((biome) => allowedCaveSet.has(biome)));
    const preferredTagReachable = preferredTags.some((tag) => {
      if (excludedSet.has(tag)) return false;
      if (surfaceOnlyTags.has(tag)) return reachableSurface;
      if (caveOnlyTags.has(tag)) return reachableCave;
      return reachableSurface || reachableCave;
    });
    if (worldNumbers.baseWeight === 0
        && (worldNumbers.preferredBonus === 0
            || (!preferredBiomeReachable && !preferredTagReachable)))
      throw new Error(`${label}.world has no positive reachable spawn weight`);
  }
}
if (new Set(creatureDescriptors.map(({ cSymbol }) => cSymbol)).size
    !== creatureDescriptors.length)
  throw new Error('CreatureSpecies cSymbol values must be unique');
for (const profile of ['CPOP_AMBIENT', 'CPOP_ENCOUNTER']) {
  const maximumRosterWeight = creatureDescriptors
    .filter((descriptor) => descriptor.population.profile === profile)
    .reduce((sum, descriptor) => sum
      + (descriptor.world.baseWeight ?? worldIntegerDefaults.baseWeight)
      + 2 * (descriptor.world.preferredBonus
        ?? worldIntegerDefaults.preferredBonus), 0);
  if (maximumRosterWeight > 2147483647)
    throw new Error(`${profile} aggregate spawn weights exceed int32 range`);
}

const normalizeType = (value) => value
  .replace(/\s+/g, ' ')
  .replace(/\s*([*&])\s*/g, '$1')
  .trim();
const splitArgs = (raw) => raw.split(',').map((arg) => arg.trim()).filter(Boolean);
const argumentType = (declaration) => normalizeType(
  declaration.replace(/\s+[A-Za-z_]\w*(?:\s*\[\s*\])?$/, ''),
);
const cwrapType = (cppType, isReturn = false) => {
  if (isReturn && cppType === 'void') return null;
  if (!isReturn && cppType === 'const char*') return 'string';
  const numeric = new Set([
    'Engine*', 'double', 'double*', 'float', 'float*', 'int', 'int*',
    'int32_t*', 'uint32_t', 'uint32_t*', 'uint8_t*',
  ]);
  if (numeric.has(cppType)) return 'number';
  throw new Error(`Unsupported exported ABI type: ${cppType}`);
};
const abiSource = readFileSync(abiSourcePath, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/.*$/gm, ' ');
const exportPattern = /EMSCRIPTEN_KEEPALIVE\s+([A-Za-z_][\w\s:*&<>]*?)\s+(engine_\w+)\s*\(([\s\S]*?)\)\s*\{/g;
const abiExports = [];
let exportMatch;
while ((exportMatch = exportPattern.exec(abiSource))) {
  const cppReturn = normalizeType(exportMatch[1]);
  const cppArgs = splitArgs(exportMatch[3]).map(argumentType);
  abiExports.push({
    name: exportMatch[2],
    cppReturn,
    cppArgs,
    returnType: cwrapType(cppReturn, true),
    argTypes: cppArgs.map((type) => cwrapType(type)),
  });
}
if (!abiExports.length) throw new Error('No EMSCRIPTEN_KEEPALIVE engine exports found in abi.inc');
const exportByName = new Map();
for (const entry of abiExports) {
  if (exportByName.has(entry.name)) throw new Error(`Duplicate C ABI export: ${entry.name}`);
  exportByName.set(entry.name, entry);
}

// Every C export must be cwrapped exactly once across the production bridge and
// test hooks, and the handwritten alias must use the generated C++ signature.
// This keeps the readable JS adapter while making signature drift a generator
// error instead of a runtime memory-corruption bug.
const bindings = new Map();
const cwrapPattern = /\bc\(\s*'([^']+)'\s*,\s*(null|'[^']+')\s*,\s*\[([^\]]*)\]\s*\)/g;
for (const path of bridgePaths) {
  const source = readFileSync(path, 'utf8');
  let binding;
  while ((binding = cwrapPattern.exec(source))) {
    const name = binding[1];
    const returnType = binding[2] === 'null' ? null : binding[2].slice(1, -1);
    const argTypes = [...binding[3].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    const expected = exportByName.get(name);
    if (!expected) throw new Error(`${path}: cwraps unknown export ${name}`);
    if (returnType !== expected.returnType
        || JSON.stringify(argTypes) !== JSON.stringify(expected.argTypes)) {
      throw new Error(`${path}: ${name} cwrap signature is ${returnType}(${argTypes.join(',')}); expected ${expected.returnType}(${expected.argTypes.join(',')})`);
    }
    if (bindings.has(name)) {
      throw new Error(`${name} is cwrapped more than once (${bindings.get(name)} and ${path})`);
    }
    bindings.set(name, path);
  }
}
const unboundExports = abiExports.filter(({ name }) => !bindings.has(name));
if (unboundExports.length) {
  throw new Error(`C ABI exports missing JS bindings: ${unboundExports.map(({ name }) => name).join(', ')}`);
}

const contractOnly = (value) => {
  if (Array.isArray(value)) return value.map(contractOnly);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith('$'))
      .map(([key, child]) => [key, contractOnly(child)]),
  );
  return value;
};

const FIELD_KINDS = new Set(['i32', 'u32', 'number', 'boolean', 'point']);
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const cppMemberPath = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const SNAPSHOT_STORAGE = Object.freeze({
  float: { cpp: 'float', one: '1.0f', zero: '0.0f' },
  double: { cpp: 'double', one: '1.0', zero: '0.0' },
  int32: { cpp: 'int32_t', one: '1', zero: '0' },
});
const SNAPSHOT_LANGUAGES = new Set(['cpp', 'js']);
const structFieldDescriptors = new Map();
const snapshotWritersByStruct = new Map();
const snapshotWriterOwners = new Map();
const normalizedStructs = {};
const resolveRecordLimit = (label, definition) => {
  const hasValue = definition.maxRecords !== undefined;
  const hasConstant = definition.maxRecordsConstant !== undefined;
  if (hasValue === hasConstant) {
    throw new Error(`${label} needs exactly one of maxRecords or maxRecordsConstant`);
  }
  const value = hasConstant ? constants[definition.maxRecordsConstant] : definition.maxRecords;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} record limit must resolve to a positive integer`);
  }
  if (hasConstant && !Object.hasOwn(constants, definition.maxRecordsConstant)) {
    throw new Error(`${label} references unknown constant ${definition.maxRecordsConstant}`);
  }
  return value;
};

const validateSnapshotSource = (label, source, kind) => {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error(`${label} snapshot source must be an object`);
  }
  const supported = new Set(['member', 'parameter', 'literal']);
  const unknown = Object.keys(source).filter((key) => !supported.has(key));
  if (unknown.length) {
    throw new Error(`${label} snapshot source has unknown keys: ${unknown.join(', ')}`);
  }
  const choices = [
    source.member !== undefined,
    source.parameter !== undefined,
    Object.hasOwn(source, 'literal'),
  ].filter(Boolean).length;
  if (choices !== 1) {
    throw new Error(`${label} snapshot source needs exactly one of member, parameter, or literal`);
  }
  if (source.member !== undefined
      && (typeof source.member !== 'string' || !cppMemberPath.test(source.member))) {
    throw new Error(`${label} snapshot member must be a dotted identifier path`);
  }
  if (source.parameter !== undefined && source.parameter !== true) {
    throw new Error(`${label} snapshot parameter must be true`);
  }
  if (!Object.hasOwn(source, 'literal')) return;
  if (kind === 'boolean') {
    if (typeof source.literal !== 'boolean') {
      throw new Error(`${label} boolean snapshot literal must be boolean`);
    }
    return;
  }
  if (typeof source.literal !== 'number' || !Number.isFinite(source.literal)) {
    throw new Error(`${label} numeric snapshot literal must be finite`);
  }
  if ((kind === 'i32' || kind === 'u32') && !Number.isInteger(source.literal)) {
    throw new Error(`${label} integer snapshot literal must be an integer`);
  }
  if (kind === 'u32' && source.literal < 0) {
    throw new Error(`${label} unsigned snapshot literal cannot be negative`);
  }
};

const objectWires = { ...declaredObjectWires };
for (const [name, definition] of Object.entries(structs)) {
  if (!Array.isArray(definition.fields) || !definition.fields.length) {
    throw new Error(`${name} struct requires fields`);
  }
  const descriptors = definition.fields.map((field) => (
    typeof field === 'string' ? { name: field } : field
  ));
  const fieldNames = descriptors.map((field) => field?.name);
  if (fieldNames.some((field) => typeof field !== 'string' || !identifier.test(field))
      || new Set(fieldNames).size !== fieldNames.length) {
    throw new Error(`${name} struct field names must be unique identifiers`);
  }
  for (const field of descriptors) {
    if (field.kind !== undefined && !FIELD_KINDS.has(field.kind)) {
      throw new Error(`${name}.${field.name} has unknown field kind ${field.kind}`);
    }
    if (field.objectWire !== undefined && typeof field.objectWire !== 'boolean') {
      throw new Error(`${name}.${field.name}.objectWire must be boolean`);
    }
    if (field.snapshotParameter !== undefined
        && typeof field.snapshotParameter !== 'boolean') {
      throw new Error(`${name}.${field.name}.snapshotParameter must be boolean`);
    }
    if (field.snapshotMember !== undefined
        && (typeof field.snapshotMember !== 'string'
          || !cppMemberPath.test(field.snapshotMember))) {
      throw new Error(`${name}.${field.name}.snapshotMember must be a dotted identifier path`);
    }
  }
  if (definition.snapshotWriter !== undefined) {
    throw new Error(`${name}.snapshotWriter is unsupported; use snapshotWriters`);
  }
  const writers = definition.snapshotWriters;
  const snapshotStorage = definition.snapshotStorage ?? 'float';
  const hasSnapshotSources = descriptors.some((field) =>
    field.snapshotMember !== undefined || field.snapshotParameter !== undefined);
  if (writers === undefined && hasSnapshotSources) {
    throw new Error(`${name} declares snapshot sources without snapshotWriters`);
  }
  if (writers !== undefined) {
    if (!Object.hasOwn(SNAPSHOT_STORAGE, snapshotStorage)) {
      throw new Error(`${name}.snapshotStorage must be float, double, or int32`);
    }
    if (!Array.isArray(writers) || !writers.length) {
      throw new Error(`${name}.snapshotWriters must be a non-empty array`);
    }
    const fieldSet = new Set(fieldNames);
    const normalizedWriters = writers.map((writer, writerIndex) => {
      const label = `${name}.snapshotWriters[${writerIndex}]`;
      if (!writer || typeof writer !== 'object' || Array.isArray(writer)) {
        throw new Error(`${label} must be an object`);
      }
      const unknownKeys = Object.keys(writer)
        .filter((key) => key !== 'name' && key !== 'sources' && key !== 'language');
      if (unknownKeys.length) {
        throw new Error(`${label} has unknown keys: ${unknownKeys.join(', ')}`);
      }
      if (typeof writer.name !== 'string' || !identifier.test(writer.name)) {
        throw new Error(`${label}.name must be a C++ identifier`);
      }
      const language = writer.language ?? 'cpp';
      if (!SNAPSHOT_LANGUAGES.has(language)) {
        throw new Error(`${label}.language must be cpp or js`);
      }
      if (snapshotWriterOwners.has(writer.name)) {
        throw new Error(`${label}.name duplicates ${snapshotWriterOwners.get(writer.name)}`);
      }
      const overrides = writer.sources === undefined ? {} : writer.sources;
      if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
        throw new Error(`${label}.sources must be an object`);
      }
      const unknownFields = Object.keys(overrides).filter((field) => !fieldSet.has(field));
      if (unknownFields.length) {
        throw new Error(`${label}.sources references unknown fields: ${unknownFields.join(', ')}`);
      }
      const sources = descriptors.map((field) => {
        const source = Object.hasOwn(overrides, field.name) ? overrides[field.name] : {
          ...(field.snapshotMember === undefined ? {} : { member: field.snapshotMember }),
          ...(field.snapshotParameter === undefined ? {} : { parameter: field.snapshotParameter }),
        };
        if (!FIELD_KINDS.has(field.kind) || field.kind === 'point') {
          throw new Error(`${label} needs a scalar kind for ${field.name}`);
        }
        validateSnapshotSource(`${label}.${field.name}`, source, field.kind);
        return source;
      });
      snapshotWriterOwners.set(writer.name, label);
      return { name: writer.name, language, sources };
    });
    snapshotWritersByStruct.set(name, normalizedWriters);
  } else if (definition.snapshotStorage !== undefined) {
    throw new Error(`${name}.snapshotStorage requires snapshotWriters`);
  }
  structFieldDescriptors.set(name, descriptors);
  const normalized = { ...definition, fields: fieldNames };
  if (definition.wireCodec) {
    normalized.wireCodec = {
      ...definition.wireCodec,
      maxRecords: resolveRecordLimit(`${name}.wireCodec`, definition.wireCodec),
    };
    delete normalized.wireCodec.maxRecordsConstant;
  }
  normalizedStructs[name] = normalized;

  if (!definition.objectWire) continue;
  const wireName = definition.objectWire.name;
  if (typeof wireName !== 'string' || !identifier.test(wireName)
      || objectWires[wireName]) {
    throw new Error(`${name}.objectWire needs a unique identifier name`);
  }
  const fields = descriptors.filter((field) => field.objectWire !== false).map((field) => {
    if (!FIELD_KINDS.has(field.kind)) {
      throw new Error(`${name}.${field.name} needs kind for object-wire projection`);
    }
    const {
      objectWire: _objectWire, snapshotMember: _snapshotMember,
      snapshotParameter: _snapshotParameter,
      ...wireField
    } = field;
    return wireField;
  });
  objectWires[wireName] = {
    sourceStruct: name,
    maxRecords: resolveRecordLimit(`${name}.objectWire`, definition.objectWire),
    fields,
  };
}

const wireStructs = Object.fromEntries(
  Object.entries(normalizedStructs).filter(([, definition]) => definition.wireCodec),
);
for (const [name, definition] of Object.entries(objectWires)) {
  if (!Number.isInteger(definition.maxRecords) || definition.maxRecords <= 0) {
    throw new Error(`${name} object wire maxRecords must be a positive integer`);
  }
  if (!Array.isArray(definition.fields) || !definition.fields.length) {
    throw new Error(`${name} object wire requires fields`);
  }
  const names = definition.fields.map((field) => field.name);
  if (names.some((field) => typeof field !== 'string')
      || new Set(names).size !== names.length) {
    throw new Error(`${name} object wire field names must be unique strings`);
  }
  for (const field of definition.fields) {
    if (!FIELD_KINDS.has(field.kind)) {
      throw new Error(`${name}.${field.name} has unknown object wire kind ${field.kind}`);
    }
    const sources = field.source === undefined ? [field.name]
      : (Array.isArray(field.source) ? field.source : [field.source]);
    if (!sources.length || sources.some((source) => typeof source !== 'string')) {
      throw new Error(`${name}.${field.name} object wire source must contain field names`);
    }
    if (field.min !== undefined && typeof field.min !== 'number') {
      throw new Error(`${name}.${field.name} min must be numeric`);
    }
    if (field.max !== undefined && typeof field.max !== 'number') {
      throw new Error(`${name}.${field.name} max must be numeric`);
    }
  }
}
for (const [name, definition] of Object.entries(wireStructs)) {
  const { fields, wireCodec } = definition;
  if (!Number.isInteger(wireCodec.maxRecords) || wireCodec.maxRecords <= 0) {
    throw new Error(`${name}.wireCodec.maxRecords must be a positive integer`);
  }
  const integers = wireCodec.integers || [];
  const unsigned = wireCodec.unsigned || [];
  const booleans = wireCodec.booleans || [];
  const descriptors = structFieldDescriptors.get(name);
  const descriptorDefaults = Object.fromEntries(descriptors
    .filter((field) => field.default !== undefined)
    .map((field) => [field.name, field.default]));
  wireCodec.defaults = { ...descriptorDefaults, ...(wireCodec.defaults || {}) };
  for (const field of [...integers, ...unsigned, ...booleans,
    ...Object.keys(wireCodec.defaults)]) {
    if (!fields.includes(field)) throw new Error(`${name}.wireCodec references unknown field ${field}`);
  }
  const typed = [...integers, ...unsigned, ...booleans];
  if (new Set(typed).size !== typed.length) {
    throw new Error(`${name}.wireCodec integer/boolean fields overlap or repeat`);
  }
  for (const descriptor of descriptors) {
    if (descriptor.kind === undefined) continue;
    if (descriptor.kind === 'point') {
      throw new Error(`${name}.${descriptor.name} point fields cannot use a packed codec`);
    }
    const listedKind = booleans.includes(descriptor.name) ? 'boolean'
      : (unsigned.includes(descriptor.name) ? 'u32'
        : (integers.includes(descriptor.name) ? 'i32' : 'number'));
    if (typed.includes(descriptor.name) && listedKind !== descriptor.kind) {
      throw new Error(`${name}.${descriptor.name} field kind conflicts with wireCodec`);
    }
  }
  for (const [field, fallback] of Object.entries(wireCodec.defaults || {})) {
    const descriptor = descriptors.find((candidate) => candidate.name === field);
    if (typeof fallback !== 'number'
        && !(typeof fallback === 'boolean' && descriptor?.kind === 'boolean')
        && !(typeof fallback === 'string' && fields.includes(fallback))) {
      throw new Error(`${name}.wireCodec default for ${field} has the wrong scalar kind`);
    }
  }
}
const missingWireEnums = wireEnums.filter((name) => !enums[name]);
if (missingWireEnums.length) {
  throw new Error(`wireEnums reference unknown enums: ${missingWireEnums.join(', ')}`);
}
const planetEnum = enums.PlanetId;
const upperSnake = (value) => value
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
const planetGameplayEntries = Object.entries(planetEnum?.gameplayFlagBits || {})
  .sort((a, b) => a[1] - b[1]);
const planetGameplayMask = (descriptor) => (descriptor.gameplayFlags || [])
  .reduce((mask, flag) => mask + (2 ** planetEnum.gameplayFlagBits[flag]), 0);
if (planetEnum?.descriptors) {
  const assertDenseValues = (label, values) => {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new Error(`${label} must be an enum object`);
    }
    const entries = Object.entries(values);
    const ids = entries.map(([, id]) => id);
    if (!entries.length || entries.some(([symbol]) => !/^[A-Z][A-Z0-9_]*$/.test(symbol))
        || ids.some((id) => !Number.isInteger(id) || id < 0)
        || new Set(ids).size !== ids.length) {
      throw new Error(`${label} must contain unique symbols and non-negative integer ids`);
    }
    const sorted = ids.slice().sort((a, b) => a - b);
    if (sorted.some((id, index) => id !== index)) {
      throw new Error(`${label} ids must be dense from zero`);
    }
    return new Set(entries.map(([symbol]) => symbol));
  };
  const generationProfiles = assertDenseValues(
    'PlanetId.generationProfiles', planetEnum.generationProfiles,
  );
  if (generationProfiles.size > 32) {
    throw new Error('PlanetId.generationProfiles supports at most 32 mask bits');
  }
  const presentationProfiles = assertDenseValues(
    'PlanetId.presentationProfiles', planetEnum.presentationProfiles,
  );
  if (!planetGameplayEntries.length
      || planetGameplayEntries.some(([name, bit]) =>
        !/^[a-z][A-Za-z0-9]*$/.test(name)
          || !Number.isInteger(bit) || bit < 0 || bit > 31)
      || new Set(planetGameplayEntries.map(([, bit]) => bit)).size
          !== planetGameplayEntries.length
      || planetGameplayEntries.some(([, bit], index) => bit !== index)) {
    throw new Error('PlanetId.gameplayFlagBits needs dense unique camel-case flags in bits 0..31');
  }
  const offworldProfiles = assertDenseValues(
    'biomes.offworldMaterialProfiles', biomesSchema.offworldMaterialProfiles,
  );
  const generationProfileSelection = biomesSchema.generationProfileSelection;
  if (!generationProfileSelection || typeof generationProfileSelection !== 'object'
      || Array.isArray(generationProfileSelection)
      || [...generationProfiles].some((profile) =>
        typeof generationProfileSelection[profile]?.requiresOffworldMaterialProfile
          !== 'boolean')) {
    throw new Error('every planet generation profile must declare requiresOffworldMaterialProfile');
  }
  const materialValues = new Set(materialsSchema.materials.map((material) => material.name));
  const materialByName = new Map(
    materialsSchema.materials.map((material) => [material.name, material]));
  const isLoadBearingMaterial = (name) => {
    const material = materialByName.get(name);
    return material
      && materialsSchema.kindPlacementProfiles?.[material.kind] === 'structure'
      && material.flags?.includes('bearing');
  };
  const identifier = /^[A-Z][A-Z0-9_]*$/;
  for (const descriptor of planetEnum.descriptors) {
    const label = `PlanetId.${descriptor.key}`;
    if (typeof descriptor.name !== 'string' || !descriptor.name.length) {
      throw new Error(`${label}.name must be non-empty`);
    }
    if (!generationProfiles.has(descriptor.generationProfile)) {
      throw new Error(`${label}.generationProfile must reference PlanetId.generationProfiles`);
    }
    if (!offworldProfiles.has(descriptor.offworldMaterialProfile)) {
      throw new Error(`${label}.offworldMaterialProfile must reference biomes.offworldMaterialProfiles`);
    }
    const requiresOffworld = generationProfileSelection[
      descriptor.generationProfile].requiresOffworldMaterialProfile;
    if ((descriptor.offworldMaterialProfile !== 'OWMP_NONE') !== requiresOffworld) {
      throw new Error(`${label} generation/offworld material profiles are incompatible`);
    }
    if (!presentationProfiles.has(descriptor.presentationProfile)) {
      throw new Error(`${label}.presentationProfile must reference PlanetId.presentationProfiles`);
    }
    if (typeof descriptor.gravity !== 'number' || descriptor.gravity <= 0) {
      throw new Error(`${label}.gravity must be positive`);
    }
    if (!Array.isArray(descriptor.gameplayFlags)
        || new Set(descriptor.gameplayFlags).size !== descriptor.gameplayFlags.length
        || descriptor.gameplayFlags.some((flag) =>
          !Object.hasOwn(planetEnum.gameplayFlagBits, flag))) {
      throw new Error(`${label}.gameplayFlags must be unique known gameplay flags`);
    }
    for (const salt of ['worldSeedSalt', 'caveBiomeSalt', 'facilitySalt', 'outcropSalt']) {
      if (!Number.isInteger(descriptor[salt]) || descriptor[salt] < 0
          || descriptor[salt] > 0xffffffff) throw new Error(`${label}.${salt} must be uint32`);
    }
    for (const field of ['facilityShell', 'facilityWall', 'facilityTrim']) {
      if (typeof descriptor[field] !== 'string' || !identifier.test(descriptor[field])
          || !materialValues.has(descriptor[field])) {
        throw new Error(`${label}.${field} must be a material symbol`);
      }
    }
    for (const field of ['facilityShell', 'facilityWall'])
      if (!isLoadBearingMaterial(descriptor[field]))
        throw new Error(`${label}.${field} must be a load-bearing structure material`);
  }
}
const actorWireContract = {
  structs: contractOnly(wireStructs),
  objects: contractOnly(objectWires),
  enums: Object.fromEntries(wireEnums.map((name) => {
    const definition = contractOnly(enums[name]);
    // Descriptor metadata is local simulation/presentation policy. Only the
    // generated stable enum values participate in the network wire contract.
    delete definition.descriptors;
    return [name, definition];
  })),
};
const wireFingerprintInput = JSON.stringify(actorWireContract);
const wireFingerprintHex = createHash('sha256')
  .update(wireFingerprintInput).digest('hex').slice(0, 12);
const fingerprintInput = JSON.stringify({
  schema: contractOnly(schema),
  materials: contractOnly(materialsSchema),
  biomes: contractOnly(biomesSchema),
  exports: abiExports.map(({ name, cppReturn, cppArgs }) => ({ name, cppReturn, cppArgs })),
});
const fingerprintHex = createHash('sha256').update(fingerprintInput).digest('hex').slice(0, 12);
const networkCatalogueInput = JSON.stringify({
  actorWire: actorWireContract,
  enums: contractOnly(enums),
  constants: contractOnly(constants),
  materials: contractOnly(materialsSchema),
  biomes: contractOnly(biomesSchema),
});
const networkCatalogueFingerprintHex = createHash('sha256')
  .update(networkCatalogueInput).digest('hex').slice(0, 12);
const abiFingerprint = Number.parseInt(fingerprintHex, 16);

const header = (comment) => `// GENERATED by scripts/generate-abi.mjs — DO NOT EDIT.\n// ${comment}\n`;
const cppTypeName = (name) => name.charAt(0).toUpperCase() + name.slice(1);

// ---------------- C++ ----------------
let hpp = header('Strides + field offsets for the packed JS<->WASM snapshots, shared enums, and the ABI version.');
hpp += '#pragma once\n#include <cstdint>\n\n';
hpp += `static const int ABI_VERSION = ${abiVersion};\n\n`;
hpp += `static const uint64_t ABI_FINGERPRINT = 0x${fingerprintHex}ULL;\n\n`;
for (const [name, s] of Object.entries(normalizedStructs)) {
  const fields = s.fields;
  const strideName = `${s.cPrefix}_STRIDE`;
  hpp += `// ${name}: ${fields.join(', ')}\n`;
  hpp += `enum ${name.charAt(0).toUpperCase() + name.slice(1)}Field : int {\n`;
  hpp += fields.map((f, i) => `  ${s.cPrefix}_${f.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()} = ${i},`).join('\n');
  hpp += `\n};\nstatic const int ${strideName} = ${fields.length};\n\n`;
  const descriptors = structFieldDescriptors.get(name);
  const storage = SNAPSHOT_STORAGE[s.snapshotStorage ?? 'float'];
  for (const writer of (snapshotWritersByStruct.get(name) || [])
    .filter(({ language }) => language === 'cpp')) {
    const parameterType = (field) => field.kind === 'boolean' ? 'bool'
      : (field.kind === 'number' ? storage.cpp
        : (field.kind === 'u32' ? 'uint32_t' : 'int'));
    const parameters = descriptors.filter((_, index) =>
      writer.sources[index].parameter === true);
    const usesRecord = writer.sources.some((source) => source.member !== undefined);
    const parameterStruct = `${cppTypeName(writer.name)}Parameters`;
    for (const field of parameters) {
      const tag = `${cppTypeName(writer.name)}${cppTypeName(field.name)}`;
      const type = parameterType(field);
      hpp += `struct ${tag} {\n`;
      hpp += `  ${type} value;\n`;
      hpp += `  ${tag}() = delete;\n`;
      hpp += `  constexpr explicit ${tag}(${type} input) : value(input) {}\n`;
      hpp += '};\n';
    }
    if (parameters.length) {
      hpp += `struct ${parameterStruct} {\n`;
      for (const field of parameters) {
        const tag = `${cppTypeName(writer.name)}${cppTypeName(field.name)}`;
        hpp += `  ${tag} ${field.name};\n`;
      }
      hpp += '};\n';
    }
    const args = [
      `${storage.cpp}* out`,
      ...(usesRecord ? ['const Record& record'] : []),
      ...(parameters.length ? [`const ${parameterStruct}& values`] : []),
    ].join(', ');
    if (usesRecord) hpp += 'template <class Record>\n';
    hpp += `inline void ${writer.name}(${args}) {\n`;
    for (let i = 0; i < descriptors.length; i++) {
      const field = descriptors[i];
      const offset = `${s.cPrefix}_${field.name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;
      const sourceDefinition = writer.sources[i];
      const source = sourceDefinition.member !== undefined
        ? `record.${sourceDefinition.member}`
        : (sourceDefinition.parameter === true
          ? `values.${field.name}.value` : JSON.stringify(sourceDefinition.literal));
      const value = field.kind === 'boolean'
        ? `(${source} ? ${storage.one} : ${storage.zero})`
        : `static_cast<${storage.cpp}>(${source})`;
      hpp += `  out[${offset}] = ${value};\n`;
    }
    hpp += '}\n\n';
  }
}
for (const [name, e] of Object.entries(enums)) {
  const values = Object.values(e.values);
  if (new Set(values).size !== values.length || values.some((value) => !Number.isInteger(value))) {
    throw new Error(`${name}.values must contain unique integer values`);
  }
  hpp += `enum ${e.cName} : ${e.cType || 'int'} {\n`;
  hpp += Object.entries(e.values).map(([k, v]) => `  ${k} = ${v},`).join('\n');
  hpp += '\n};\n\n';
  hpp += `static constexpr bool is${e.cName}Value(int value) {\n  switch (value) {\n`;
  hpp += Object.keys(e.values).map((key) => `    case ${key}:`).join('\n');
  hpp += '\n      return true;\n    default: return false;\n  }\n}\n\n';
  if (e.derived) {
    const sorted = values.slice().sort((a, b) => a - b);
    if (sorted.some((value, index) => value !== index)) {
      throw new Error(`${name}.derived requires dense zero-based enum values`);
    }
    if (e.derived.count) hpp += `static const int ${e.derived.count} = ${values.length};\n`;
    if (e.derived.allMask) {
      if (values.length > 32) throw new Error(`${name}.derived.allMask supports at most 32 values`);
      const mask = values.length === 32 ? 0xffffffff : (2 ** values.length) - 1;
      hpp += `static const uint32_t ${e.derived.allMask} = 0x${mask.toString(16)}u;\n`;
    }
    hpp += '\n';
  }
}
if (planetEnum?.descriptors) {
  const descriptors = planetEnum.descriptors.slice().sort((a, b) => a.id - b.id);
  const profiles = Object.entries(planetEnum.generationProfiles).sort((a, b) => a[1] - b[1]);
  const presentationProfiles = Object.entries(planetEnum.presentationProfiles)
    .sort((a, b) => a[1] - b[1]);
  const offworldProfiles = Object.entries(biomesSchema.offworldMaterialProfiles)
    .sort((a, b) => a[1] - b[1]);
  hpp += 'enum PlanetGenerationProfile : uint8_t {\n';
  hpp += profiles.map(([profile, id]) => `  ${profile} = ${id},`).join('\n');
  hpp += '\n};\n';
  hpp += `static const int PLANET_GENERATION_PROFILE_COUNT = ${profiles.length};\n\n`;
  hpp += 'enum PlanetPresentationProfile : uint8_t {\n';
  hpp += presentationProfiles.map(([profile, id]) => `  ${profile} = ${id},`).join('\n');
  hpp += '\n};\n';
  hpp += `static const int PLANET_PRESENTATION_PROFILE_COUNT = ${presentationProfiles.length};\n\n`;
  hpp += 'enum OffworldMaterialProfile : uint8_t {\n';
  hpp += offworldProfiles.map(([profile, id]) => `  ${profile} = ${id},`).join('\n');
  hpp += '\n};\n';
  hpp += `static const int OFFWORLD_MATERIAL_PROFILE_COUNT = ${offworldProfiles.length};\n\n`;
  hpp += 'enum PlanetGameplayFlag : uint32_t {\n';
  hpp += planetGameplayEntries.map(([flag, bit]) =>
    `  PGF_${upperSnake(flag)} = 1u << ${bit},`).join('\n');
  hpp += '\n};\n';
  const allGameplayFlags = planetGameplayEntries
    .reduce((mask, [, bit]) => mask + (2 ** bit), 0) >>> 0;
  hpp += `static const uint32_t PLANET_GAMEPLAY_ALL_FLAGS = 0x${allGameplayFlags.toString(16)}u;\n\n`;
  hpp += 'struct PlanetDef {\n'
    + '  PlanetId id;\n  const char* name;\n  PlanetGenerationProfile generationProfile;\n'
    + '  OffworldMaterialProfile offworldMaterialProfile;\n'
    + '  PlanetPresentationProfile presentationProfile;\n'
    + '  double gravity;\n  uint32_t gameplayFlags;\n'
    + '  uint32_t worldSeedSalt, caveBiomeSalt, facilitySalt, outcropSalt;\n'
    + '  uint8_t facilityShell, facilityWall, facilityTrim;\n};\n\n';
  hpp += 'inline constexpr std::array<PlanetDef, PLANET_COUNT> PLANETS = {{\n';
  hpp += descriptors.map((descriptor) =>
    `  {${descriptor.key}, ${JSON.stringify(descriptor.name)}, ${descriptor.generationProfile}, ${descriptor.offworldMaterialProfile}, ${descriptor.presentationProfile}, ${descriptor.gravity}, 0x${planetGameplayMask(descriptor).toString(16)}u,\n`
      + `   ${descriptor.worldSeedSalt}u, ${descriptor.caveBiomeSalt}u, ${descriptor.facilitySalt}u, ${descriptor.outcropSalt}u,\n`
      + `   ${descriptor.facilityShell}, ${descriptor.facilityWall}, ${descriptor.facilityTrim}},`).join('\n');
  hpp += '\n}};\n\n';
  hpp += 'constexpr bool planetTableIsComplete() {\n'
    + '  for (int i = 0; i < PLANET_COUNT; i++)\n'
    + '    if ((int)PLANETS[i].id != i\n'
    + '        || (unsigned)PLANETS[i].generationProfile >= PLANET_GENERATION_PROFILE_COUNT\n'
    + '        || (unsigned)PLANETS[i].offworldMaterialProfile >= OFFWORLD_MATERIAL_PROFILE_COUNT\n'
    + '        || (unsigned)PLANETS[i].presentationProfile >= PLANET_PRESENTATION_PROFILE_COUNT\n'
    + '        || (PLANETS[i].gameplayFlags & ~PLANET_GAMEPLAY_ALL_FLAGS) != 0) return false;\n'
    + '  return true;\n}\n'
    + 'static_assert(planetTableIsComplete(), "Planet descriptors must be dense and exhaustive");\n\n'
    + 'inline const PlanetDef& planetDef(int id) {\n'
    + '  return PLANETS[(unsigned)id < PLANETS.size() ? (size_t)id : (size_t)PL_EARTH];\n}\n\n'
    + 'inline bool planetHasGameplayFlag(int id, uint32_t flag) {\n'
    + '  return (planetDef(id).gameplayFlags & flag) != 0;\n}\n\n';
}
for (const [k, v] of Object.entries(constants)) {
  if (k.startsWith('$')) continue;
  hpp += `static const int ${k} = ${v};\n`;
}

const cppMask = (values, fallback = '0u') => {
  if (values === undefined) return fallback;
  if (values.length === 0) return '0u';
  return values.map((value) => `(1u << ${value})`).join(' | ');
};
const cppFlags = (values) => values?.length ? values.join(' | ') : '0u';
const cppNumber = (value) => Number.isInteger(value) ? String(value) : String(value);
const behaviorProfileId = new Map(behaviorProfiles);
const renderProfileId = new Map(renderProfiles);
const ambientSpecies = creatureDescriptors.filter(
  ({ population }) => population.profile === 'CPOP_AMBIENT');
const encounterSpecies = creatureDescriptors.filter(
  ({ population }) => population.profile === 'CPOP_ENCOUNTER');

let creaturesHpp = header('Creature ids, simulation/population descriptors, render metadata, and exhaustive behavior policies.');
creaturesHpp += '#pragma once\n\n';
creaturesHpp += 'enum CreatureSpeciesId : uint8_t {\n';
creaturesHpp += creatureDescriptors.map((descriptor) =>
  `  ${descriptor.cSymbol} = ${descriptor.key},`).join('\n');
creaturesHpp += `\n  CS_COUNT = ${creatureDescriptors.length},\n};\n\n`;
creaturesHpp += 'enum CreaturePopulationProfile : uint8_t { CPOP_AMBIENT = 0, CPOP_ENCOUNTER, CPOP_SCRIPTED, CPOP_COUNT };\n'
  + 'enum CreatureRenderBob : uint8_t { CRB_NONE = 0, CRB_WALKER, CRB_AQUATIC, CRB_BIRD, CRB_WASP, CRB_HARE, CRB_COUNT };\n'
  + 'enum CreatureProtection : uint8_t { CPROT_NONE = 0, CPROT_ALWAYS, CPROT_PROTECTED_CREW, CPROT_COUNT };\n\n';
creaturesHpp += 'enum CreatureBehaviorProfile : uint8_t {\n';
creaturesHpp += behaviorProfiles.map(([name, id]) => `  ${name} = ${id},`).join('\n');
creaturesHpp += `\n  CRBH_COUNT = ${behaviorProfiles.length},\n};\n\n`;
creaturesHpp += 'enum CreatureRenderProfile : uint8_t {\n';
creaturesHpp += renderProfiles.map(([name, id]) => `  ${name} = ${id},`).join('\n');
creaturesHpp += `\n  CRP_COUNT = ${renderProfiles.length},\n};\n\n`;
creaturesHpp += 'enum CreatureRenderAsset : uint8_t {\n';
creaturesHpp += creatureRenderRows.map(({ asset }, id) =>
  `  ${asset} = ${id},`).join('\n');
creaturesHpp += `\n  CRA_COUNT = ${creatureRenderRows.length},\n};\n\n`;
for (const spec of behaviorPolicySpecs) {
  const rows = behaviorPolicyRows[spec.field];
  creaturesHpp += `enum ${spec.enumName} : uint8_t {\n`;
  creaturesHpp += rows.map(({ symbol, id }) => `  ${symbol} = ${id},`).join('\n');
  creaturesHpp += `\n  ${spec.countName} = ${rows.length},\n};\n`;
}
creaturesHpp += '\n';
creaturesHpp += 'struct CreatureBehaviorProfileDef {\n'
  + '  CreatureBehaviorProfile id;\n  CreatureAttackHandler attack;\n'
  + '  CreatureTelegraphHandler telegraph;\n  InventoryItemKind dropItem;\n'
  + '  CreatureAnimationProfile animation;\n  CreatureFlyingMovement flyingMovement;\n'
  + '  int nearRange, farRange;\n  CreatureWeaponOverlay weaponOverlay;\n'
  + '  bool initializeAttackPattern;\n};\n\n';
creaturesHpp += 'struct CreatureRenderProfileDef {\n'
  + '  CreatureRenderProfile id;\n  CreatureRenderAsset asset;\n};\n\n'
  + 'inline constexpr std::array<CreatureRenderProfileDef, CRP_COUNT> CREATURE_RENDER_PROFILES = {{\n';
creaturesHpp += creatureRenderRows.map(({ profile, asset }) =>
  `  {${profile}, ${asset}},`).join('\n');
creaturesHpp += '\n}};\n\n';
creaturesHpp += 'inline constexpr std::array<CreatureBehaviorProfileDef, CRBH_COUNT> CREATURE_BEHAVIOR_PROFILES = {{\n';
creaturesHpp += creatureBehaviorRows.map((row) =>
  `  {${row.profile}, ${row.attack}, ${row.telegraph}, ${row.dropItem}, ${row.animation}, ${row.flying}, ${row.nearRange}, ${row.farRange}, ${row.weaponOverlay}, ${row.initialPattern}},`).join('\n');
creaturesHpp += '\n}};\n\n';

const creatureRow = (descriptor) => {
  const stats = descriptor.stats;
  const population = descriptor.population;
  const world = descriptor.world;
  const targetMask = stats.targets.length ? stats.targets.join(' | ') : 'CT_NONE';
  const preyMask = stats.prey.length
    ? stats.prey.map((key) => `(1u << ${creatureSymbolByKey.get(key)})`).join(' | ')
    : '0u';
  return `  {${descriptor.cSymbol}, ${JSON.stringify(descriptor.name)}, ${stats.locomotion}, ${stats.w}, ${stats.h}, ${stats.maxHealth},\n`
    + `   ${cppNumber(stats.walkSpeed)}, ${cppNumber(stats.swimSpeed)}, ${cppNumber(stats.accel)}, ${cppNumber(stats.gravity)}, ${cppNumber(stats.jumpSpeed)},\n`
    + `   ${cppNumber(stats.fluidThreshold)}, ${cppNumber(stats.sightRange)}, ${cppNumber(stats.attackRange)},\n`
    + `   ${stats.damage}, ${stats.attackCooldown}, ${stats.scanInterval}, ${stats.hopPeriod},\n`
    + `   (uint8_t)(${targetMask}), ${preyMask}, ${stats.hostile},\n`
    + `   {${population.habitat}, ${population.maxActive}, ${population.densityRadius}, ${population.densityCap}, ${population.minPlayerDistance}, ${population.maxPlayerDistance}},\n`
    + `   {${cppFlags(world.requiredTags)}, ${cppFlags(world.excludedTags)}, ${cppFlags(world.preferredTags)},\n`
    + `    ${cppMask(world.allowedSurfaceBiomes, 'SURFACE_BIOME_ALL_MASK')}, ${cppMask(world.allowedCaveBiomes, 'CAVE_BIOME_ALL_MASK')},\n`
    + `    ${cppMask(world.preferredSurfaceBiomes)}, ${cppMask(world.preferredCaveBiomes)},\n`
    + `    ${world.minDepth ?? 'INT_MIN'}, ${world.maxDepth ?? 'INT_MAX'}, ${world.baseWeight ?? 10}, ${world.preferredBonus ?? 20}},\n`
    + `   ${population.profile}, ${population.encounterCost}, ${population.countsTowardNaturalCap}, ${descriptor.behaviorProfile},\n`
    + `   ${descriptor.render.profile}, ${descriptor.render.humanNpc}, ${descriptor.render.bob}, ${descriptor.render.stationaryCycle}, ${descriptor.protection}},`;
};
creaturesHpp += 'inline constexpr std::array<CreatureSpecies, CS_COUNT> CREATURE_SPECIES = {{\n';
creaturesHpp += creatureDescriptors.map(creatureRow).join('\n');
creaturesHpp += '\n}};\n\n';
const roster = (name, descriptors) => {
  let result = `inline constexpr std::array<uint8_t, ${descriptors.length}> ${name} = {{`;
  result += descriptors.length ? `\n  ${descriptors.map(({ cSymbol }) => cSymbol).join(', ')},\n` : '';
  return `${result}}};\n`;
};
creaturesHpp += roster('AMBIENT_CREATURE_SPECIES', ambientSpecies);
creaturesHpp += roster('ENCOUNTER_CREATURE_SPECIES', encounterSpecies);
creaturesHpp += '\ntemplate <size_t N>\n'
  + 'constexpr bool creatureBehaviorProfilesAreValid(\n'
  + '    const std::array<CreatureBehaviorProfileDef, N>& profiles) {\n'
  + '  if (N != CRBH_COUNT) return false;\n'
  + '  for (size_t index = 0; index < N; index++) {\n'
  + '    const CreatureBehaviorProfileDef& behavior = profiles[index];\n'
  + '    if ((size_t)behavior.id != index\n'
  + '        || (unsigned)behavior.attack >= CAH_COUNT\n'
  + '        || (unsigned)behavior.telegraph >= CTH_COUNT\n'
  + '        || (unsigned)behavior.animation >= CAP_COUNT\n'
  + '        || (unsigned)behavior.flyingMovement >= CFM_COUNT\n'
  + '        || (unsigned)behavior.weaponOverlay >= CWO_COUNT) return false;\n'
  + '  }\n  return true;\n}\n\n'
  + 'constexpr bool creatureRegistriesAreComplete() {\n'
  + '  if (!creatureBehaviorProfilesAreValid(CREATURE_BEHAVIOR_PROFILES))\n'
  + '    return false;\n'
  + '  for (size_t index = 0; index < CREATURE_RENDER_PROFILES.size(); index++) {\n'
  + '    const CreatureRenderProfileDef& render = CREATURE_RENDER_PROFILES[index];\n'
  + '    if ((size_t)render.id != index\n'
  + '        || (unsigned)render.asset >= CRA_COUNT) return false;\n'
  + '  }\n'
  + '  for (size_t index = 0; index < CREATURE_SPECIES.size(); index++) {\n'
  + '    const CreatureSpecies& species = CREATURE_SPECIES[index];\n'
  + '    if ((size_t)species.id != index\n'
  + '        || (unsigned)species.population >= CPOP_COUNT\n'
  + '        || (unsigned)species.behaviorProfile >= CRBH_COUNT\n'
  + '        || (unsigned)species.renderProfile >= CRP_COUNT\n'
  + '        || (unsigned)species.renderBob >= CRB_COUNT\n'
  + '        || (unsigned)species.protection >= CPROT_COUNT) return false;\n'
  + '  }\n  return true;\n}\n'
  + 'static_assert(creatureRegistriesAreComplete(),\n'
  + '              "Creature descriptors and behavior profiles must be dense and exhaustive");\n\n'
  + 'constexpr bool creatureBehaviorInvalidFixturesAreRejected() {\n'
  + '  auto fixture = CREATURE_BEHAVIOR_PROFILES;\n'
  + '  fixture[0].attack = (CreatureAttackHandler)CAH_COUNT;\n'
  + '  if (creatureBehaviorProfilesAreValid(fixture)) return false;\n'
  + '  fixture = CREATURE_BEHAVIOR_PROFILES;\n'
  + '  fixture[0].id = fixture[1].id;\n'
  + '  return !creatureBehaviorProfilesAreValid(fixture);\n}\n'
  + 'static_assert(creatureBehaviorInvalidFixturesAreRejected(),\n'
  + '              "Invalid creature behavior selectors must fail validation");\n\n'
  + 'inline const CreatureBehaviorProfileDef& creatureBehaviorProfile(\n'
  + '    CreatureBehaviorProfile profile) {\n'
  + '  if ((unsigned)profile < CREATURE_BEHAVIOR_PROFILES.size())\n'
  + '    return CREATURE_BEHAVIOR_PROFILES[(size_t)profile];\n'
  + '  __builtin_trap();\n}\n\n'
  + 'inline const CreatureBehaviorProfileDef& creatureBehavior(\n'
  + '    const CreatureSpecies& species) {\n'
  + '  return creatureBehaviorProfile(\n'
  + '    (CreatureBehaviorProfile)species.behaviorProfile);\n}\n\n'
  + 'inline const CreatureRenderProfileDef& creatureRenderProfile(\n'
  + '    const CreatureSpecies& species) {\n'
  + '  if ((unsigned)species.renderProfile < CREATURE_RENDER_PROFILES.size())\n'
  + '    return CREATURE_RENDER_PROFILES[(size_t)species.renderProfile];\n'
  + '  __builtin_trap();\n}\n\n'
  + 'inline bool isAmbientSpecies(uint8_t speciesId) {\n'
  + '  return speciesId < CS_COUNT\n'
  + '    && CREATURE_SPECIES[(size_t)speciesId].population == CPOP_AMBIENT;\n}\n\n'
  + 'inline bool isEncounterSpecies(uint8_t speciesId) {\n'
  + '  return speciesId < CS_COUNT\n'
  + '    && CREATURE_SPECIES[(size_t)speciesId].population == CPOP_ENCOUNTER;\n}\n';

// ---------------- JS ----------------
const jsIdent = (f) => f;
let js = header('Mirrors abi.generated.hpp: strides, named field offsets, shared enums, ABI version.');
js += `export const ABI_VERSION = ${abiVersion};\n\n`;
js += `export const ABI_FINGERPRINT = 0x${fingerprintHex};\n\n`;
js += `export const ACTOR_WIRE_FINGERPRINT = 0x${wireFingerprintHex};\n\n`;
js += `export const NETWORK_CATALOGUE_FINGERPRINT = 0x${networkCatalogueFingerprintHex};\n\n`;
for (const [name] of Object.entries(normalizedStructs)) {
  const descriptors = structFieldDescriptors.get(name);
  for (const writer of (snapshotWritersByStruct.get(name) || [])
    .filter(({ language }) => language === 'js')) {
    const parameters = descriptors.filter((_, index) =>
      writer.sources[index].parameter === true);
    const usesRecord = writer.sources.some((source) => source.member !== undefined);
    const args = [
      'out', 'offset',
      ...(usesRecord ? ['record'] : []),
      ...parameters.map((field) => `value_${field.name}`),
    ];
    js += `export function ${writer.name}(${args.join(', ')}) {\n`;
    js += `  if (arguments.length !== ${args.length}) throw new TypeError('${writer.name} requires ${args.length} arguments');\n`;
    for (const field of parameters) {
      const value = `value_${field.name}`;
      const invalid = field.kind === 'boolean'
        ? `typeof ${value} !== 'boolean'`
        : (field.kind === 'i32'
          ? `!Number.isInteger(${value}) || ${value} < -2147483648 || ${value} > 2147483647`
          : (field.kind === 'u32'
            ? `!Number.isInteger(${value}) || ${value} < 0 || ${value} > 0xffffffff`
            : `typeof ${value} !== 'number' || !Number.isFinite(${value})`));
      js += `  if (${invalid}) throw new TypeError('${writer.name}.${field.name} has invalid type');\n`;
    }
    for (let i = 0; i < descriptors.length; i++) {
      const field = descriptors[i];
      const sourceDefinition = writer.sources[i];
      const source = sourceDefinition.member !== undefined
        ? `record.${sourceDefinition.member}`
        : (sourceDefinition.parameter === true
          ? `value_${field.name}` : JSON.stringify(sourceDefinition.literal));
      const value = field.kind === 'boolean' ? `(${source} ? 1 : 0)` : source;
      js += `  out[offset + ${i}] = ${value};\n`;
    }
    js += '}\n\n';
  }
}
js += `export const OBJECT_WIRE_CODECS = Object.freeze(${JSON.stringify(contractOnly(objectWires))});\n\n`;
js += 'export const STRIDES = Object.freeze({\n';
js += Object.entries(normalizedStructs).map(([name, s]) => `  ${name}: ${s.fields.length},`).join('\n');
js += '\n});\n\n';
js += '// Declarative scalar layouts for every schema-backed packed snapshot.\n';
js += 'export const SNAPSHOT_CODECS = Object.freeze({\n';
for (const [name, definition] of Object.entries(normalizedStructs)) {
  if (!snapshotWritersByStruct.has(name)) continue;
  const kinds = structFieldDescriptors.get(name).map((field) => ({
    boolean: 'b', i32: 'i', u32: 'u', number: 'n',
  })[field.kind]).join('');
  js += `  ${name}: Object.freeze({ fields: Object.freeze(${JSON.stringify(definition.fields)}), kinds: '${kinds}', storage: '${definition.snapshotStorage ?? 'float'}' }),\n`;
}
js += '});\n\n';
js += '// Declarative codecs for packed actor records used by WASM, workers, and the network.\n';
js += 'export const RECORD_CODECS = Object.freeze({\n';
for (const [name, definition] of Object.entries(wireStructs)) {
  const fields = definition.fields;
  const integers = new Set(definition.wireCodec.integers || []);
  const unsigned = new Set(definition.wireCodec.unsigned || []);
  const booleans = new Set(definition.wireCodec.booleans || []);
  const descriptors = new Map(structFieldDescriptors.get(name)
    .map((field) => [field.name, field]));
  const kinds = fields.map((field) => {
    const declaredKind = descriptors.get(field).kind;
    if (declaredKind) return {
      boolean: 'b', i32: 'i', u32: 'u', number: 'n',
    }[declaredKind];
    return booleans.has(field) ? 'b'
      : (unsigned.has(field) ? 'u' : (integers.has(field) ? 'i' : 'n'));
  }).join('');
  const defaults = JSON.stringify(definition.wireCodec.defaults || {});
  js += `  ${name}: Object.freeze({ fields: Object.freeze(${JSON.stringify(fields)}), kinds: '${kinds}', defaults: Object.freeze(${defaults}), maxRecords: ${definition.wireCodec.maxRecords} }),\n`;
}
js += '});\n\n';
js += '// Field offset maps: OFF.<struct>.<field> is the float/int index within one record.\n';
js += 'export const OFF = Object.freeze({\n';
for (const [name, s] of Object.entries(normalizedStructs)) {
  js += `  ${name}: Object.freeze({ ${s.fields.map((f, i) => `${jsIdent(f)}: ${i}`).join(', ')} }),\n`;
}
js += '});\n\n';
for (const [name, e] of Object.entries(enums)) {
  const jsName = e.jsName || name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  const prefix = e.jsPrefix ? new RegExp(`^${e.jsPrefix}_`) : null;
  const strip = (k) => prefix ? k.replace(prefix, '') : k;
  js += `export const ${jsName} = Object.freeze({ ${Object.entries(e.values).map(([k, v]) => `${strip(k)}: ${v}`).join(', ')} });\n`;
  if (e.derived?.count) js += `export const ${e.derived.count} = ${Object.keys(e.values).length};\n`;
  if (e.derived?.allMask) {
    const count = Object.keys(e.values).length;
    const mask = count === 32 ? 0xffffffff : (2 ** count) - 1;
    js += `export const ${e.derived.allMask} = 0x${mask.toString(16)};\n`;
  }
  if (e.derived?.jsNames || e.derived?.jsByName) {
    const descriptorByKey = new Map((e.descriptors || [])
      .map((descriptor) => [descriptor.key, descriptor]));
    const namedValues = Object.entries(e.values)
      .map(([key, value]) => [
        (descriptorByKey.get(key)?.name || strip(key)).toLowerCase(), value,
      ])
      .sort((a, b) => a[1] - b[1]);
    if (new Set(namedValues.map(([label]) => label)).size !== namedValues.length) {
      throw new Error(`${name}.derived JS names must be unique`);
    }
    if (e.derived.jsNames) {
      js += `export const ${e.derived.jsNames} = Object.freeze([${namedValues.map(([label]) => `'${label}'`).join(', ')}]);\n`;
    }
    if (e.derived.jsByName) {
      js += `export const ${e.derived.jsByName} = Object.freeze({ ${namedValues.map(([label, value]) => `${label}: ${value}`).join(', ')} });\n`;
    }
  }
}
js += `export const CREATURE_BEHAVIOR_PROFILE = Object.freeze(${JSON.stringify(Object.fromEntries(behaviorProfiles.map(([name, id]) => [name.replace(/^CRBH_/, ''), id])))});\n`;
js += `export const CREATURE_RENDER_PROFILE = Object.freeze(${JSON.stringify(Object.fromEntries(renderProfiles.map(([name, id]) => [name.replace(/^CRP_/, ''), id])))});\n`;
js += `export const CREATURE_SPECIES_DEFS = Object.freeze(${JSON.stringify(creatureDescriptors.map((descriptor) => ({
  id: descriptor.id,
  key: descriptor.key.replace(/^CREATURE_/, '').toLowerCase(),
  name: descriptor.name,
  population: descriptor.population.profile.replace(/^CPOP_/, '').toLowerCase(),
  encounterCost: descriptor.population.encounterCost,
  behaviorProfile: behaviorProfileId.get(descriptor.behaviorProfile),
  renderProfile: renderProfileId.get(descriptor.render.profile),
  humanNpc: descriptor.render.humanNpc,
  creative: descriptor.creative
    ? { order: descriptor.creative.order, colors: descriptor.creative.colors }
    : null,
})), null, 2)});\n`;
js += `export const CREATURE_CREATIVE_ENTRIES = Object.freeze(${JSON.stringify(creativeCreatureDescriptors.map((descriptor) => ({
  id: descriptor.id,
  label: `${descriptor.name.replace(/\b\w/g, (character) => character.toUpperCase())} Spawn Egg`,
  colors: descriptor.creative.colors,
})), null, 2)});\n`;
if (planetEnum?.descriptors) {
  const presentationProfiles = Object.entries(planetEnum.presentationProfiles)
    .sort((a, b) => a[1] - b[1]);
  const descriptors = planetEnum.descriptors.slice().sort((a, b) => a.id - b.id);
  js += `export const PLANET_PRESENTATION = Object.freeze({ ${presentationProfiles.map(([name, id]) => `${name.replace(/^PPP_/, '')}: ${id}`).join(', ')} });\n`;
  js += `export const PLANET_PRESENTATION_PROFILE_COUNT = ${presentationProfiles.length};\n`;
  js += `export const PLANET_PRESENTATION_BY_ID = Object.freeze([${descriptors.map((descriptor) => planetEnum.presentationProfiles[descriptor.presentationProfile]).join(', ')}]);\n`;
  js += `export const PLANET_GAMEPLAY_FLAG = Object.freeze({ ${planetGameplayEntries.map(([flag, bit]) => `${upperSnake(flag)}: ${2 ** bit}`).join(', ')} });\n`;
  js += `export const PLANET_GAMEPLAY_FLAGS_BY_ID = Object.freeze([${descriptors.map(planetGameplayMask).join(', ')}]);\n`;
  js += 'export const planetHasGameplayFlag = (planetId, flag) =>\n'
    + '  ((PLANET_GAMEPLAY_FLAGS_BY_ID[Number.isInteger(planetId)\n'
    + '    && planetId >= 0 && planetId < PLANET_GAMEPLAY_FLAGS_BY_ID.length\n'
    + '    ? planetId : PLANET.EARTH] & flag) !== 0);\n';
}
js += '\n';
for (const [k, v] of Object.entries(constants)) {
  if (k.startsWith('$')) continue;
  js += `export const ${k} = ${v};\n`;
}

// ---------------- emit / check ----------------
const check = process.argv.includes('--check');
const validateOnly = process.argv.includes('--validate-only');
if (check && validateOnly) throw new Error('--check and --validate-only are mutually exclusive');
const outputs = [[hppPath, hpp], [jsPath, js], [creaturesHppPath, creaturesHpp]];
let stale = false;
for (const [path, content] of validateOnly ? [] : outputs) {
  if (check) {
    let cur = '';
    try { cur = readFileSync(path, 'utf8'); } catch { /* missing */ }
    if (cur !== content) { stale = true; console.error(`stale: ${path}`); }
  } else {
    writeFileSync(path, content);
    console.log(`wrote ${path}`);
  }
}
if (check && stale) { console.error('Generated ABI files are stale. Run `npm run generate:abi`.'); process.exit(1); }
if (check) console.log('generated ABI files are up to date');
if (validateOnly && process.argv.includes('--print-creature-contract')) {
  console.log(`CREATURE_CONTRACT=${JSON.stringify({
    count: creatureDescriptors.length,
    ambient: ambientSpecies.map(({ cSymbol }) => cSymbol),
    encounter: encounterSpecies.map(({ cSymbol }) => cSymbol),
    species: creatureDescriptors.map((descriptor) => ({
      cSymbol: descriptor.cSymbol,
      behaviorProfile: descriptor.behaviorProfile,
      renderProfile: descriptor.render.profile,
    })),
  })}`);
}
if (validateOnly && process.argv.includes('--print-fingerprints')) {
  console.log(`FINGERPRINTS=${JSON.stringify({
    abi: fingerprintHex,
    actorWire: wireFingerprintHex,
    networkCatalogue: networkCatalogueFingerprintHex,
  })}`);
}
if (validateOnly) console.log('ABI schema is valid');
