// Generates complete C++/JS biome catalogues from one set of stable records.
//
//   node scripts/generate-biomes.mjs
//   node scripts/generate-biomes.mjs --check

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readSchemaJson } from './schema-json.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = process.env.SAND_BIOME_SCHEMA_PATH
  ? resolve(process.env.SAND_BIOME_SCHEMA_PATH)
  : resolve(root, 'src/sand/biomes.schema.json');
const caveProfileHandlersPath = process.env.SAND_CAVE_PROFILE_HANDLERS_PATH
  ? resolve(process.env.SAND_CAVE_PROFILE_HANDLERS_PATH)
  : resolve(root, 'src/sand/cpp/engine/cave_profile_handlers.def');
const caveHandlerPoliciesPath = process.env.SAND_CAVE_HANDLER_POLICIES_PATH
  ? resolve(process.env.SAND_CAVE_HANDLER_POLICIES_PATH)
  : resolve(root, 'src/sand/cpp/engine/cave_handler_policies.def');
const materialsPath = resolve(root, 'src/sand/materials.schema.json');
const abiPath = resolve(root, 'src/sand/abi.schema.json');
const hppPath = resolve(root, 'src/sand/cpp/engine/biomes.generated.hpp');
const jsPath = resolve(root, 'src/sand/wasmBridge/biomes.generated.js');

const schema = readSchemaJson(schemaPath);
const materials = readSchemaJson(materialsPath);
const abi = readSchemaJson(abiPath);
const materialNames = new Set(materials.materials.map((entry) => entry.name));
const materialByName = new Map(
  materials.materials.map((entry) => [entry.name, entry]));
const isLoadBearingMaterial = (name) => {
  const material = materialByName.get(name);
  return material
    && materials.kindPlacementProfiles?.[material.kind] === 'structure'
    && material.flags?.includes('bearing');
};
const plantNames = new Set(materials.plantSpecies.map((entry) => `PT_${entry.name}`));

function assertDenseRecords(label, records) {
  if (!Array.isArray(records) || records.length === 0)
    throw new Error(`${label} must be a non-empty array`);
  const ids = new Set();
  const keys = new Set();
  const symbols = new Set();
  for (const record of records) {
    if (!Number.isInteger(record.id) || record.id < 0 || ids.has(record.id))
      throw new Error(`${label} has an invalid or duplicate id ${record.id}`);
    if (typeof record.key !== 'string' || keys.has(record.key))
      throw new Error(`${label} has an invalid or duplicate key ${record.key}`);
    if (typeof record.symbol !== 'string' || symbols.has(record.symbol))
      throw new Error(`${label} has an invalid or duplicate symbol ${record.symbol}`);
    ids.add(record.id);
    keys.add(record.key);
    symbols.add(record.symbol);
  }
  for (let id = 0; id < records.length; id++)
    if (!ids.has(id)) throw new Error(`${label} must exhaust every id through ${records.length - 1}`);
}

function sortedDenseEnum(label, values) {
  const entries = Object.entries(values ?? {}).sort((a, b) => a[1] - b[1]);
  if (entries.length === 0 || entries.some(([, id], index) => id !== index))
    throw new Error(`${label} values must be unique and dense from zero`);
  if (new Set(entries.map(([name]) => name)).size !== entries.length)
    throw new Error(`${label} names must be unique`);
  return entries;
}

assertDenseRecords('surfaceBiomes', schema.surfaceBiomes);
assertDenseRecords('caveBiomes', schema.caveBiomes);
const caveProfiles = sortedDenseEnum('caveProfiles', schema.caveProfiles);
const structureStyles = sortedDenseEnum('surfaceStructureStyles', schema.surfaceStructureStyles);
const cavePolicySpecs = [
  { field: 'upper', macro: 'SAND_CAVE_UPPER_DRESSING_POLICY', prefix: 'CUDH_', enumName: 'CaveUpperDressingHandler', countName: 'CUDH_COUNT' },
  { field: 'deep', macro: 'SAND_CAVE_DEEP_DRESSING_POLICY', prefix: 'CDDH_', enumName: 'CaveDeepDressingHandler', countName: 'CDDH_COUNT' },
  { field: 'structure', macro: 'SAND_CAVE_DEEP_STRUCTURE_POLICY', prefix: 'CDSH_', enumName: 'CaveDeepStructureHandler', countName: 'CDSH_COUNT' },
  { field: 'floor', macro: 'SAND_CAVE_DEEP_FLOOR_POLICY', prefix: 'CDFP_', enumName: 'CaveDeepFloorPolicy', countName: 'CDFP_COUNT' },
];
const cavePolicyRows = Object.fromEntries(
  cavePolicySpecs.map((spec) => [spec.field, []]));
const cavePolicyPattern = /^([A-Z0-9_]+)\(\s*([A-Z][A-Z0-9_]*)\s*,\s*(\d+)\s*\)$/;
for (const [lineIndex, line] of readFileSync(
  caveHandlerPoliciesPath, 'utf8').split(/\r?\n/)
  .map((entry) => entry.trim())
  .filter((entry) => entry && !entry.startsWith('//')).entries()) {
  const match = line.match(cavePolicyPattern);
  const spec = cavePolicySpecs.find((candidate) => candidate.macro === match?.[1]);
  if (!match || !spec || !match[2].startsWith(spec.prefix))
    throw new Error(`invalid cave handler policy row ${lineIndex + 1}: ${line}`);
  const rows = cavePolicyRows[spec.field];
  const id = Number(match[3]);
  if (id !== rows.length || rows.some(({ symbol }) => symbol === match[2]))
    throw new Error(`${spec.field} cave policy ids must be unique and dense in source order`);
  rows.push({ symbol: match[2], id });
}
for (const spec of cavePolicySpecs)
  if (cavePolicyRows[spec.field].length === 0)
    throw new Error(`${spec.field} cave policies must be non-empty`);
const caveProfileHandlerPattern = /^SAND_CAVE_PROFILE_HANDLER\(\s*(CBP_[A-Z0-9_]+)\s*,\s*(CUDH_[A-Z0-9_]+)\s*,\s*(CDDH_[A-Z0-9_]+)\s*,\s*(CDSH_[A-Z0-9_]+)\s*,\s*(CDFP_[A-Z0-9_]+)\s*\)$/;
const caveProfileHandlerLines = readFileSync(caveProfileHandlersPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('//'));
const caveProfileHandlers = caveProfileHandlerLines.map((line, index) => {
  const match = line.match(caveProfileHandlerPattern);
  if (!match)
    throw new Error(`invalid cave profile handler row ${index + 1}: ${line}`);
  return {
    profile: match[1], upper: match[2], deep: match[3],
    structure: match[4], floor: match[5],
  };
});
const caveHandlerPolicies = Object.fromEntries(cavePolicySpecs.map((spec) => [
  spec.field,
  new Set(cavePolicyRows[spec.field].map(({ symbol }) => symbol)),
]));
if (caveProfileHandlers.length !== caveProfiles.length)
  throw new Error('cave profile handler registry must contain exactly one row per caveProfiles entry');
if (new Set(caveProfileHandlers.map((handler) => handler.profile)).size
    !== caveProfileHandlers.length)
  throw new Error('cave profile handler registry contains a duplicate profile row');
for (let index = 0; index < caveProfiles.length; index++) {
  const expected = caveProfiles[index][0];
  const handler = caveProfileHandlers[index];
  if (handler.profile !== expected)
    throw new Error(`cave profile handler row ${index + 1} must implement ${expected} in id order`);
  for (const field of ['upper', 'deep', 'structure', 'floor'])
    if (!caveHandlerPolicies[field].has(handler[field]))
      throw new Error(`${expected} has unknown ${field} handler ${handler[field]}`);
}
const offworldProfiles = sortedDenseEnum(
  'offworldMaterialProfiles', schema.offworldMaterialProfiles);
const generationProfiles = sortedDenseEnum(
  'PlanetId.generationProfiles', abi.enums?.PlanetId?.generationProfiles);
const generationProfileNames = new Set(generationProfiles.map(([name]) => name));
const surfaceSelectionModes = new Map([
  ['climate', 'SBSE_CLIMATE'],
  ['regional', 'SBSE_REGIONAL'],
]);
const caveSelectionModes = new Map([
  ['blendedDepthBands', 'CBSE_BLENDED_DEPTH_BANDS'],
  ['absoluteDepthBands', 'CBSE_ABSOLUTE_DEPTH_BANDS'],
  ['fallback', 'CBSE_FALLBACK'],
]);
const profileSelectionKeys = Object.keys(schema.generationProfileSelection ?? {}).sort();
if (profileSelectionKeys.join() !== [...generationProfileNames].sort().join())
  throw new Error('generationProfileSelection must exhaust PlanetId.generationProfiles');
const generationProfileSelection = generationProfiles.map(([profile, id]) => {
  const selection = schema.generationProfileSelection[profile];
  if (!surfaceSelectionModes.has(selection?.surface))
    throw new Error(`${profile} has invalid surface selection mode ${selection?.surface}`);
  if (!caveSelectionModes.has(selection?.cave))
    throw new Error(`${profile} has invalid cave selection mode ${selection?.cave}`);
  if (typeof selection?.requiresOffworldMaterialProfile !== 'boolean')
    throw new Error(`${profile}.requiresOffworldMaterialProfile must be boolean`);
  return { profile, id, ...selection };
});
if (offworldProfiles[0][0] !== 'OWMP_NONE')
  throw new Error('offworldMaterialProfiles id 0 must be the explicit OWMP_NONE policy');

const sortedSurface = schema.surfaceBiomes.slice().sort((a, b) => a.id - b.id);
const sortedCaves = schema.caveBiomes.slice().sort((a, b) => a.id - b.id);
const selectionSurface = sortedSurface
  .filter((record) => Array.isArray(record.climate) && record.climate.length > 0)
  .sort((a, b) => a.selectionPriority - b.selectionPriority);
if (new Set(selectionSurface.map((record) => record.selectionPriority)).size
    !== selectionSurface.length
    || selectionSurface.some((record) => !Number.isFinite(record.selectionPriority)))
  throw new Error('climate-selected surface biome priorities must be numeric and unique');
const climateVariables = new Map([
  ['temperature', 'SCV_TEMPERATURE'],
  ['moisture', 'SCV_MOISTURE'],
  ['altitude', 'SCV_ALTITUDE'],
  ['rugged', 'SCV_RUGGED'],
  ['surfaceMinusSea', 'SCV_SURFACE_MINUS_SEA'],
  ['anomaly', 'SCV_ANOMALY'],
]);
const climateComparisons = new Map([
  ['<', 'SCC_LESS_THAN'],
  ['>', 'SCC_GREATER_THAN'],
]);
let climateFallbackCount = 0;
for (const record of sortedSurface) {
  if (!structureStyles.some(([name]) => name === record.structureStyle))
    throw new Error(`${record.symbol} has unknown surface structure style ${record.structureStyle}`);
  if (record.climate !== undefined && !Array.isArray(record.climate))
    throw new Error(`${record.symbol}.climate must be an OR-clause array when present`);
  if ((record.climate?.length ?? 0) > 0xff)
    throw new Error(`${record.symbol}.climate exceeds the uint8 clause count`);
  for (const [clauseIndex, clause] of (record.climate ?? []).entries()) {
    if (!Array.isArray(clause))
      throw new Error(`${record.symbol}.climate[${clauseIndex}] must be an AND-term array`);
    if (clause.length > 0xff)
      throw new Error(`${record.symbol}.climate[${clauseIndex}] exceeds the uint8 term count`);
    if (clause.length === 0) climateFallbackCount++;
    for (const term of clause) {
      if (!climateVariables.has(term?.variable)
          || !climateComparisons.has(term?.comparison)
          || !Number.isFinite(term?.value))
        throw new Error(`${record.symbol} has an invalid climate term`);
    }
  }
}
if (selectionSurface.length === 0
    || climateFallbackCount !== 1
    || selectionSurface.at(-1).climate.every((clause) => clause.length !== 0))
  throw new Error('surface selection must end in exactly one explicit fallback clause');

const surfaceFields = [
  'surfaceReliefScale', 'surfaceDetailAmplitude', 'surfaceRidgeMix', 'surfaceOffset',
  'soilScale', 'soilAdd', 'soilBaseNumerator', 'soilBaseDenominator',
  'treeProbabilityScale', 'treeFirstCut', 'treeSecondCut', 'copperRich',
  'allowsSurfaceStructures',
];
const surfaceMaterials = [
  'flatSkin', 'steepSkin', 'soilTop', 'soilBase',
  'structureWall', 'structureFoundation',
];
const offworldMaterials = [
  'surfaceFlat', 'surfaceSteep', 'shallow', 'crust', 'shallowOverride',
  'shallowPocket', 'deepPocket', 'formation', 'formationAccent', 'foundation',
];
const offworldNumbers = [
  'overrideDepth', 'deepPocketMinDepth', 'shallowPocketCut', 'deepPocketCut',
];
const materialProfileNames = offworldProfiles.slice(1).map(([name]) => name);
const materialProfileNameSet = new Set(materialProfileNames);
const defaultProfileKeys = Object.keys(schema.offworldMaterialDefaults ?? {}).sort();
if (defaultProfileKeys.join() !== materialProfileNames.slice().sort().join())
  throw new Error('offworldMaterialDefaults must exhaust named non-NONE material profiles');
const validateOffworldProfile = (owner, profile) => {
  for (const field of offworldMaterials)
    if (!materialNames.has(profile?.[field]))
      throw new Error(`${owner}.${field} references unknown material ${profile?.[field]}`);
  for (const field of offworldNumbers)
    if (!Number.isFinite(profile?.[field]))
      throw new Error(`${owner}.${field} must be numeric`);
  for (const field of ['shallowPocketAbove', 'deepPocketAbove'])
    if (typeof profile?.[field] !== 'boolean')
      throw new Error(`${owner}.${field} must be boolean`);
};
for (const profileName of materialProfileNames)
  validateOffworldProfile(
    `offworldMaterialDefaults.${profileName}`,
    schema.offworldMaterialDefaults[profileName]);

const resolvedOffworldProfiles = new Map();
for (const record of sortedSurface) {
  if (!/^#[0-9a-f]{6}$/i.test(record.atlasColor))
    throw new Error(`${record.symbol}.atlasColor must be a six-digit hex color`);
  for (const field of surfaceFields)
    if (record[field] === undefined) throw new Error(`${record.symbol} is missing ${field}`);
  for (const field of ['surfaceReliefScale', 'surfaceDetailAmplitude', 'surfaceRidgeMix', 'surfaceOffset'])
    if (!Number.isFinite(record[field])) throw new Error(`${record.symbol}.${field} must be numeric`);
  if (record.surfaceReliefScale < 0 || record.surfaceDetailAmplitude < 0
      || record.surfaceRidgeMix < 0 || record.surfaceRidgeMix > 1)
    throw new Error(`${record.symbol} has invalid surface-shape proportions`);
  for (const field of [
    'soilScale', 'soilAdd', 'soilBaseNumerator', 'soilBaseDenominator',
  ]) if (!Number.isInteger(record[field]))
    throw new Error(`${record.symbol}.${field} must be an integer`);
  if (record.soilScale < 0 || record.soilAdd < 0
      || record.soilBaseDenominator <= 0
      || record.soilBaseNumerator < 0
      || record.soilBaseNumerator > record.soilBaseDenominator)
    throw new Error(`${record.symbol} has invalid soil-depth proportions`);
  if (!Number.isFinite(record.treeProbabilityScale)
      || record.treeProbabilityScale < 0
      || !Number.isFinite(record.treeFirstCut)
      || !Number.isFinite(record.treeSecondCut)
      || record.treeFirstCut < 0
      || record.treeFirstCut > record.treeSecondCut
      || record.treeSecondCut > 1)
    throw new Error(`${record.symbol} has invalid tree selection probabilities`);
  if (typeof record.copperRich !== 'boolean')
    throw new Error(`${record.symbol}.copperRich must be boolean`);
  if (typeof record.allowsSurfaceStructures !== 'boolean')
    throw new Error(`${record.symbol}.allowsSurfaceStructures must be boolean`);
  for (const field of surfaceMaterials)
    if (!materialNames.has(record[field]))
      throw new Error(`${record.symbol}.${field} references unknown material ${record[field]}`);
  for (const field of ['structureWall', 'structureFoundation'])
    if (!isLoadBearingMaterial(record[field]))
      throw new Error(`${record.symbol}.${field} must be a load-bearing structure material`);
  for (const field of ['treeFirst', 'treeSecond', 'treeThird'])
    if (!plantNames.has(record[field]))
      throw new Error(`${record.symbol}.${field} references unknown plant ${record[field]}`);
  for (const [profileName, selection] of Object.entries(record.profileSelection ?? {})) {
    if (!generationProfileNames.has(profileName))
      throw new Error(`${record.symbol}.profileSelection has unknown ${profileName}`);
    if (!Number.isInteger(selection.ordinal) || selection.ordinal < 0
        || !Number.isInteger(selection.slots) || selection.slots <= 0)
      throw new Error(`${record.symbol}.${profileName} needs non-negative ordinal and positive integer slots`);
  }
  const profileKeys = Object.keys(record.offworld ?? {});
  if (profileKeys.some((profileName) => !materialProfileNameSet.has(profileName)))
    throw new Error(`${record.symbol}.offworld has an unknown material profile`);
  const resolved = {};
  for (const profileName of materialProfileNames) {
    const override = record.offworld?.[profileName] ?? {};
    const knownFields = new Set([
      ...offworldMaterials, ...offworldNumbers,
      'shallowPocketAbove', 'deepPocketAbove',
    ]);
    if (Object.keys(override).some((field) => !knownFields.has(field)))
      throw new Error(`${record.symbol}.${profileName} has an unknown field`);
    resolved[profileName] = {
      ...schema.offworldMaterialDefaults[profileName],
      ...override,
    };
    validateOffworldProfile(
      `${record.symbol}.${profileName}`, resolved[profileName]);
  }
  resolvedOffworldProfiles.set(record.symbol, resolved);
  if ((record.climate?.length ?? 0) === 0
      && Object.keys(record.profileSelection ?? {}).length === 0)
    throw new Error(`${record.symbol} is unreachable from every generation profile`);
}

const surfaceProfilePools = generationProfiles.map(([profile, id]) => {
  const entries = sortedSurface.flatMap((record) => {
    const selection = record.profileSelection?.[profile];
    return selection ? [{ record, ...selection }] : [];
  }).sort((a, b) => a.ordinal - b.ordinal);
  if (entries.some((entry, index) => entry.ordinal !== index))
    throw new Error(`${profile} surface selection ordinals must be dense from zero`);
  return {
    profile,
    id,
    biomes: entries.flatMap(({ record, slots }) =>
      Array.from({ length: slots }, () => record.symbol)),
  };
});
for (const pool of surfaceProfilePools) {
  const mode = schema.generationProfileSelection[pool.profile].surface;
  if ((mode === 'regional') !== (pool.biomes.length > 0))
    throw new Error(`${pool.profile} ${mode} surface selection has an inconsistent regional pool`);
}

const caveMaterials = [
  'wallAccent', 'wallTendrilMaterial', 'embeddedVeinMaterial',
  'monumentWall', 'monumentAccent',
];
for (const record of sortedCaves) {
  if (!/^#[0-9a-f]{6}$/i.test(record.atlasColor))
    throw new Error(`${record.symbol}.atlasColor must be a six-digit hex color`);
  if (!Object.hasOwn(schema.caveProfiles, record.profile))
    throw new Error(`${record.symbol} has unknown profile ${record.profile}`);
  for (const field of caveMaterials)
    if (!materialNames.has(record[field]))
      throw new Error(`${record.symbol}.${field} references unknown material ${record[field]}`);
  if (!isLoadBearingMaterial(record.monumentWall))
    throw new Error(`${record.symbol}.monumentWall must be a load-bearing structure material`);
  for (const field of [
    'lavaHazard', 'methaneHazard', 'wallAccentCut', 'crystalCut',
    'wallTendrilDetailCut', 'wallTendrilNoiseCut', 'embeddedVeinCut',
  ]) if (!Number.isFinite(record[field]))
    throw new Error(`${record.symbol}.${field} must be numeric`);
  if (typeof record.deep !== 'boolean')
    throw new Error(`${record.symbol}.deep must be boolean`);
  for (const [profileName, entries] of Object.entries(record.profileSelection ?? {})) {
    if (!generationProfileNames.has(profileName) || !Array.isArray(entries))
      throw new Error(`${record.symbol}.profileSelection has invalid ${profileName}`);
    for (const entry of entries) {
      if ((entry.band === 'deep') !== record.deep
          || !Number.isInteger(entry.ordinal) || entry.ordinal < 0
          || !Number.isFinite(entry.weight) || entry.weight <= 0)
        throw new Error(`${record.symbol}.${profileName} has an invalid selection segment`);
    }
  }
}
const caveProfilePools = generationProfiles.map(([profile, id]) => {
  const makeBand = (band) => {
    const entries = sortedCaves.flatMap((record) =>
      (record.profileSelection?.[profile] ?? [])
        .filter((entry) => entry.band === band)
        .map((entry) => ({ record, ...entry })))
      .sort((a, b) => a.ordinal - b.ordinal);
    if (entries.some((entry, index) => entry.ordinal !== index))
      throw new Error(`${profile} ${band} cave selection ordinals must be dense from zero`);
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    let cumulative = 0;
    let previousCut = 0;
    return entries.map((entry, index) => {
      cumulative += entry.weight;
      const cut = index + 1 === entries.length
        ? 1 : Number((cumulative / total).toFixed(12));
      if (!(cut > previousCut && cut <= 1))
        throw new Error(`${profile} ${band} cave selection has an unrepresentable weight`);
      previousCut = cut;
      return {
        biome: entry.record.symbol,
        cut,
      };
    });
  };
  return { profile, id, shallow: makeBand('shallow'), deep: makeBand('deep') };
});
for (const pool of caveProfilePools) {
  const mode = schema.generationProfileSelection[pool.profile].cave;
  const hasBothBands = pool.shallow.length > 0 && pool.deep.length > 0;
  if (mode === 'fallback'
    ? pool.shallow.length > 0 || pool.deep.length > 0
    : !hasBothBands)
    throw new Error(`${pool.profile} ${mode} cave selection has inconsistent band pools`);
}
for (const record of sortedCaves) {
  const reachable = caveProfilePools.some((pool) =>
    [...pool.shallow, ...pool.deep].some((segment) =>
      segment.biome === record.symbol));
  if (!reachable)
    throw new Error(`${record.symbol} is unreachable from every generation profile`);
}
const earthCavePools = caveProfilePools.find((pool) => pool.profile === 'PGP_EARTH');
if (!earthCavePools?.shallow.length || !earthCavePools.deep.length)
  throw new Error('PGP_EARTH needs shallow and deep cave selection pools');
const shallowCaves = earthCavePools.shallow;
const deepCaves = earthCavePools.deep;

const climateTerms = [];
const climateClauses = [];
const climateRanges = new Map();
for (const record of sortedSurface) {
  const clauseOffset = climateClauses.length;
  for (const clause of record.climate ?? []) {
    const termOffset = climateTerms.length;
    climateTerms.push(...clause);
    climateClauses.push({ termOffset, termCount: clause.length });
  }
  climateRanges.set(record.symbol, {
    clauseOffset,
    clauseCount: record.climate?.length ?? 0,
  });
}
if (climateTerms.length > 0xffff || climateClauses.length > 0xffff)
  throw new Error('surface climate catalogue exceeds 16-bit generated offsets');

function flattenProfilePools(pools, field) {
  const entries = [];
  const ranges = pools.map((pool) => {
    const offset = entries.length;
    entries.push(...pool[field]);
    return { offset, count: pool[field].length };
  });
  if (entries.length > 0xffff || ranges.some((range) => range.count > 0xff))
    throw new Error(`${field} biome selection catalogue exceeds generated offsets`);
  return { entries, ranges };
}
const flatSurfacePools = flattenProfilePools(surfaceProfilePools, 'biomes');
const flatShallowCavePools = flattenProfilePools(caveProfilePools, 'shallow');
const flatDeepCavePools = flattenProfilePools(caveProfilePools, 'deep');

const n = (value) => `${value}`;
const b = (value) => value ? 'true' : 'false';
const offworldCpp = (profile) => [
  profile.surfaceFlat, profile.surfaceSteep, profile.shallow, profile.crust,
  profile.shallowOverride, profile.shallowPocket, profile.deepPocket,
  profile.formation, profile.formationAccent, profile.foundation,
  n(profile.overrideDepth), n(profile.deepPocketMinDepth),
  n(profile.shallowPocketCut), n(profile.deepPocketCut),
  b(profile.shallowPocketAbove), b(profile.deepPocketAbove),
].join(', ');

const surfaceRows = sortedSurface.map((record) => {
  const climate = climateRanges.get(record.symbol);
  return `  {${record.symbol}, ${JSON.stringify(record.name)}, ${record.selectionPriority}, ${climate.clauseOffset}, ${climate.clauseCount},\n`
  + `   ${n(record.surfaceReliefScale)}, ${n(record.surfaceDetailAmplitude)}, ${n(record.surfaceRidgeMix)}, ${n(record.surfaceOffset)},\n`
  + `   ${record.soilScale}, ${record.soilAdd}, ${record.flatSkin}, ${record.steepSkin}, ${record.soilTop}, ${record.soilBase},\n`
  + `   ${record.soilBaseNumerator}, ${record.soilBaseDenominator}, ${n(record.treeProbabilityScale)},\n`
  + `   ${record.treeFirst}, ${record.treeSecond}, ${record.treeThird}, ${n(record.treeFirstCut)}, ${n(record.treeSecondCut)},\n`
  + `   ${record.structureStyle}, ${record.structureWall}, ${record.structureFoundation}, ${b(record.copperRich)}, ${b(record.allowsSurfaceStructures)}},`;
}).join('\n');
const climateTermRows = climateTerms.map((term) =>
  `  {${climateVariables.get(term.variable)}, ${climateComparisons.get(term.comparison)}, ${n(term.value)}},`)
  .join('\n');
const climateClauseRows = climateClauses.map((clause) =>
  `  {${clause.termOffset}, ${clause.termCount}},`).join('\n');
const offworldRows = offworldProfiles.map(([profileName]) => {
  const cells = profileName === 'OWMP_NONE'
    ? sortedSurface.map(() => '    {}')
    : sortedSurface.map((record) =>
      `    {${offworldCpp(resolvedOffworldProfiles.get(record.symbol)[profileName])}}`);
  return `  {{\n${cells.join(',\n')}\n  }}`;
}).join(',\n');
const caveRows = sortedCaves.map((record) =>
  `  {${record.symbol}, ${JSON.stringify(record.name)}, ${record.profile}, ${b(record.deep)},\n`
  + `   ${n(record.lavaHazard)}, ${n(record.methaneHazard)}, ${record.wallAccent},\n`
  + `   ${n(record.wallAccentCut)}, ${n(record.crystalCut)}, ${record.wallTendrilMaterial},\n`
  + `   ${n(record.wallTendrilDetailCut)}, ${n(record.wallTendrilNoiseCut)},\n`
  + `   ${record.embeddedVeinMaterial}, ${n(record.embeddedVeinCut)},\n`
  + `   ${record.monumentWall}, ${record.monumentAccent}},`).join('\n');
const profileSelectionRows = generationProfileSelection.map((selection) =>
  `  {${surfaceSelectionModes.get(selection.surface)}, ${caveSelectionModes.get(selection.cave)}, ${b(selection.requiresOffworldMaterialProfile)}},`)
  .join('\n');
const rangeRows = (ranges) => ranges.map((range) =>
  `  {${range.offset}, ${range.count}},`).join('\n');
const caveSegmentRows = (segments) => segments.map((segment) =>
  `  {${segment.biome}, ${n(segment.cut)}},`).join('\n');
const cavePolicyEnums = cavePolicySpecs.map((spec) => {
  const rows = cavePolicyRows[spec.field];
  return `enum ${spec.enumName} : uint8_t {\n`
    + rows.map(({ symbol, id }) => `  ${symbol} = ${id},`).join('\n')
    + `\n  ${spec.countName} = ${rows.length},\n};`;
}).join('\n\n');

const hpp = `// Generated by scripts/generate-biomes.mjs from src/sand/biomes.schema.json.
// Do not edit by hand.
#pragma once

enum SurfaceBiomeSelectionMode : uint8_t {
  SBSE_CLIMATE = 0,
  SBSE_REGIONAL = 1,
};

enum CaveBiomeSelectionMode : uint8_t {
  CBSE_BLENDED_DEPTH_BANDS = 0,
  CBSE_ABSOLUTE_DEPTH_BANDS = 1,
  CBSE_FALLBACK = 2,
};

struct BiomeGenerationProfileSelection {
  SurfaceBiomeSelectionMode surfaceMode;
  CaveBiomeSelectionMode caveMode;
  bool requiresOffworldMaterialProfile;
};

static_assert(PLANET_GENERATION_PROFILE_COUNT == ${generationProfiles.length}
              && PLANET_GENERATION_PROFILE_COUNT <= 32,
              "Biome generation profiles must stay exhaustive and mask-safe");
inline constexpr std::array<BiomeGenerationProfileSelection,
                            PLANET_GENERATION_PROFILE_COUNT>
    BIOME_GENERATION_PROFILE_SELECTION = {{
${profileSelectionRows}
}};

inline const BiomeGenerationProfileSelection& biomeGenerationProfileSelection(
    PlanetGenerationProfile profile) {
  if ((unsigned)profile < BIOME_GENERATION_PROFILE_SELECTION.size())
    return BIOME_GENERATION_PROFILE_SELECTION[(size_t)profile];
  assert(false && "invalid planet generation profile");
  return BIOME_GENERATION_PROFILE_SELECTION[(size_t)PGP_EARTH];
}

enum SurfaceClimateVariable : uint8_t {
${[...climateVariables.values()].map((name, id) => `  ${name} = ${id},`).join('\n')}
  SCV_COUNT = ${climateVariables.size},
};

enum SurfaceClimateComparison : uint8_t {
  SCC_LESS_THAN = 0,
  SCC_GREATER_THAN = 1,
};

enum CaveBiomeProfile : uint8_t {
${caveProfiles.map(([name, id]) => `  ${name} = ${id},`).join('\n')}
  CBP_COUNT = ${caveProfiles.length},
};

${cavePolicyEnums}

struct OffworldBiomeDef {
  uint8_t surfaceFlat, surfaceSteep, shallow, crust;
  uint8_t shallowOverride, shallowPocket, deepPocket;
  uint8_t formation, formationAccent, foundation;
  int overrideDepth, deepPocketMinDepth;
  double shallowPocketCut, deepPocketCut;
  bool shallowPocketAbove, deepPocketAbove;
};

struct SurfaceClimateTerm {
  SurfaceClimateVariable variable;
  SurfaceClimateComparison comparison;
  double threshold;
};

struct SurfaceClimateClause {
  uint16_t termOffset;
  uint8_t termCount;
};

enum SurfaceStructureStyle : uint8_t {
${structureStyles.map(([name, id]) => `  ${name} = ${id},`).join('\n')}
};

struct SurfaceBiomeDef {
  Biome id;
  const char* name;
  int selectionPriority;
  uint16_t climateClauseOffset;
  uint8_t climateClauseCount;
  double surfaceReliefScale, surfaceDetailAmplitude, surfaceRidgeMix, surfaceOffset;
  int soilScale, soilAdd;
  uint8_t flatSkin, steepSkin, soilTop, soilBase;
  int soilBaseNumerator, soilBaseDenominator;
  double treeProbabilityScale;
  uint8_t treeFirst, treeSecond, treeThird;
  double treeFirstCut, treeSecondCut;
  SurfaceStructureStyle structureStyle;
  uint8_t structureWall, structureFoundation;
  bool copperRich;
  bool allowsSurfaceStructures;
};

inline constexpr std::array<SurfaceClimateTerm, ${climateTerms.length}>
    SURFACE_CLIMATE_TERMS = {{
${climateTermRows}
}};

inline constexpr std::array<SurfaceClimateClause, ${climateClauses.length}>
    SURFACE_CLIMATE_CLAUSES = {{
${climateClauseRows}
}};

inline constexpr std::array<SurfaceBiomeDef, SURFACE_BIOME_COUNT> SURFACE_BIOMES = {{
${surfaceRows}
}};

static_assert(OFFWORLD_MATERIAL_PROFILE_COUNT == ${offworldProfiles.length},
              "Biome and ABI offworld material profiles must stay exhaustive");
inline constexpr std::array<std::array<OffworldBiomeDef, SURFACE_BIOME_COUNT>,
                            OFFWORLD_MATERIAL_PROFILE_COUNT> OFFWORLD_BIOME_PROFILES = {{
${offworldRows}
}};

inline constexpr std::array<Biome, ${selectionSurface.length}> SURFACE_BIOME_SELECTION_ORDER = {{
  ${selectionSurface.map((record) => record.symbol).join(', ')}
}};
inline constexpr Biome SURFACE_BIOME_FALLBACK = ${selectionSurface.at(-1).symbol};

struct BiomeSelectionRange {
  uint16_t offset;
  uint8_t count;
};

inline constexpr std::array<Biome, ${flatSurfacePools.entries.length}>
    REGIONAL_SURFACE_BIOME_SELECTION = {{
  ${flatSurfacePools.entries.join(', ')}
}};
inline constexpr std::array<BiomeSelectionRange, PLANET_GENERATION_PROFILE_COUNT>
    REGIONAL_SURFACE_BIOME_PROFILE_POOLS = {{
${rangeRows(flatSurfacePools.ranges)}
}};

inline Biome selectRegionalSurfaceBiome(PlanetGenerationProfile profile,
                                        double pick) {
  if ((unsigned)profile >= REGIONAL_SURFACE_BIOME_PROFILE_POOLS.size()) {
    assert(false && "invalid regional surface biome profile");
    return SURFACE_BIOME_FALLBACK;
  }
  const BiomeSelectionRange& pool =
    REGIONAL_SURFACE_BIOME_PROFILE_POOLS[(size_t)profile];
  if (pool.count == 0) {
    assert(false && "surface biome profile has no regional selection pool");
    return SURFACE_BIOME_FALLBACK;
  }
  int index = (int)(pick * pool.count);
  if (index < 0) index = 0;
  if (index >= pool.count) index = pool.count - 1;
  return REGIONAL_SURFACE_BIOME_SELECTION[(size_t)pool.offset + (size_t)index];
}

struct CaveBiomeDef {
  CaveBiome id;
  const char* name;
  CaveBiomeProfile profile;
  bool deep;
  double lavaHazard, methaneHazard;
  uint8_t wallAccent;
  double wallAccentCut, crystalCut;
  uint8_t wallTendrilMaterial;
  double wallTendrilDetailCut, wallTendrilNoiseCut;
  uint8_t embeddedVeinMaterial;
  double embeddedVeinCut;
  uint8_t monumentWall, monumentAccent;
};

inline constexpr std::array<CaveBiomeDef, CAVE_BIOME_COUNT> CAVE_BIOMES = {{
${caveRows}
}};

struct CaveBiomeSelectionSegment {
  CaveBiome biome;
  double cut;
};

inline constexpr std::array<CaveBiomeSelectionSegment,
                            ${flatShallowCavePools.entries.length}>
    SHALLOW_CAVE_BIOME_PROFILE_SEGMENTS = {{
${caveSegmentRows(flatShallowCavePools.entries)}
}};
inline constexpr std::array<CaveBiomeSelectionSegment,
                            ${flatDeepCavePools.entries.length}>
    DEEP_CAVE_BIOME_PROFILE_SEGMENTS = {{
${caveSegmentRows(flatDeepCavePools.entries)}
}};
inline constexpr std::array<BiomeSelectionRange, PLANET_GENERATION_PROFILE_COUNT>
    SHALLOW_CAVE_BIOME_PROFILE_POOLS = {{
${rangeRows(flatShallowCavePools.ranges)}
}};
inline constexpr std::array<BiomeSelectionRange, PLANET_GENERATION_PROFILE_COUNT>
    DEEP_CAVE_BIOME_PROFILE_POOLS = {{
${rangeRows(flatDeepCavePools.ranges)}
}};

inline constexpr std::array<CaveBiome, ${shallowCaves.length}> SHALLOW_CAVE_BIOME_SELECTION_ORDER = {{
  ${shallowCaves.map((segment) => segment.biome).join(', ')}
}};
inline constexpr std::array<CaveBiome, ${deepCaves.length}> DEEP_CAVE_BIOME_SELECTION_ORDER = {{
  ${deepCaves.map((segment) => segment.biome).join(', ')}
}};
inline constexpr CaveBiome CAVE_BIOME_FALLBACK = ${shallowCaves[0].biome};

constexpr bool surfaceBiomeTableIsComplete() {
  for (int i = 0; i < SURFACE_BIOME_COUNT; i++)
    if ((int)SURFACE_BIOMES[i].id != i
        || (size_t)SURFACE_BIOMES[i].climateClauseOffset
             + SURFACE_BIOMES[i].climateClauseCount
           > SURFACE_CLIMATE_CLAUSES.size()) return false;
  return true;
}
constexpr bool caveBiomeTableIsComplete() {
  for (int i = 0; i < CAVE_BIOME_COUNT; i++)
    if ((int)CAVE_BIOMES[i].id != i) return false;
  return true;
}
static_assert(SURFACE_BIOME_COUNT <= 32 && surfaceBiomeTableIsComplete(),
              "Surface biome descriptors must be dense and exhaustive");
static_assert(CAVE_BIOME_COUNT <= 32 && caveBiomeTableIsComplete(),
              "Cave biome descriptors must be dense and exhaustive");

inline bool surfaceBiomeClimateMatches(
    const SurfaceBiomeDef& biome, double temperature, double moisture,
    double altitude, double rugged, double surfaceMinusSea, double anomaly) {
  const std::array<double, SCV_COUNT> values = {{
    temperature, moisture, altitude, rugged, surfaceMinusSea, anomaly,
  }};
  for (uint16_t clauseIndex = 0; clauseIndex < biome.climateClauseCount;
       clauseIndex++) {
    const SurfaceClimateClause& clause = SURFACE_CLIMATE_CLAUSES[
      (size_t)biome.climateClauseOffset + clauseIndex];
    bool matches = true;
    for (uint16_t termIndex = 0; termIndex < clause.termCount; termIndex++) {
      const SurfaceClimateTerm& term = SURFACE_CLIMATE_TERMS[
        (size_t)clause.termOffset + termIndex];
      double value = values[(size_t)term.variable];
      bool termMatches = term.comparison == SCC_LESS_THAN
        ? value < term.threshold : value > term.threshold;
      if (!termMatches) { matches = false; break; }
    }
    if (matches) return true;
  }
  return false;
}

inline CaveBiome selectCaveBiome(PlanetGenerationProfile profile,
                                 bool deep, double pick) {
  const BiomeGenerationProfileSelection& selection =
    biomeGenerationProfileSelection(profile);
  if (selection.caveMode == CBSE_FALLBACK) return CAVE_BIOME_FALLBACK;
  const CaveBiomeSelectionSegment* segments = deep
    ? DEEP_CAVE_BIOME_PROFILE_SEGMENTS.data()
    : SHALLOW_CAVE_BIOME_PROFILE_SEGMENTS.data();
  const auto& pools = deep ? DEEP_CAVE_BIOME_PROFILE_POOLS
                           : SHALLOW_CAVE_BIOME_PROFILE_POOLS;
  const BiomeSelectionRange& pool = pools[(size_t)profile];
  if (pool.count == 0) {
    assert(false && "cave biome profile has no selection pool");
    return CAVE_BIOME_FALLBACK;
  }
  for (uint16_t index = 0; index < pool.count; index++) {
    const CaveBiomeSelectionSegment& segment =
      segments[(size_t)pool.offset + index];
    if (pick < segment.cut || index + 1 == pool.count) return segment.biome;
  }
  __builtin_unreachable();
}

inline const SurfaceBiomeDef& surfaceBiomeDef(int biome) {
  if ((unsigned)biome < SURFACE_BIOMES.size()) return SURFACE_BIOMES[(size_t)biome];
  assert(false && "invalid surface biome id");
  return SURFACE_BIOMES[(size_t)SURFACE_BIOME_FALLBACK];
}
inline const OffworldBiomeDef& offworldBiomeDef(OffworldMaterialProfile profile,
                                                int biome) {
  if ((unsigned)profile < OFFWORLD_BIOME_PROFILES.size()
      && profile != OWMP_NONE
      && (unsigned)biome < SURFACE_BIOME_COUNT)
    return OFFWORLD_BIOME_PROFILES[(size_t)profile][(size_t)biome];
  assert(false && "invalid offworld biome material profile or biome id");
  return OFFWORLD_BIOME_PROFILES[(size_t)OWMP_LUNAR][(size_t)SURFACE_BIOME_FALLBACK];
}
inline const CaveBiomeDef& caveBiomeDef(int biome) {
  if ((unsigned)biome < CAVE_BIOMES.size()) return CAVE_BIOMES[(size_t)biome];
  assert(false && "invalid cave biome id");
  return CAVE_BIOMES[(size_t)CAVE_BIOME_FALLBACK];
}
`;

const publicSurface = sortedSurface.map(({
  id, key, name, symbol, atlasColor, selectionPriority, climate, profileSelection,
  allowsSurfaceStructures,
}) => ({
  id, key: key.toLowerCase(), name, symbol, atlasColor,
  selectionPriority, climate, profileSelection, allowsSurfaceStructures,
}));
const publicCaves = sortedCaves.map(({
  id, key, name, symbol, atlasColor, profile, deep, profileSelection,
}) => ({
  id, key: key.toLowerCase(), name, symbol, atlasColor, profile,
  deep, profileSelection,
}));
const publicProfiles = offworldProfiles.map(([symbol, id]) => ({
  id, symbol, key: symbol.slice('OWMP_'.length).toLowerCase(),
}));
const js = `// Generated by scripts/generate-biomes.mjs from src/sand/biomes.schema.json.
// Do not edit by hand.
export const SURFACE_BIOME_DEFS = Object.freeze(${JSON.stringify(publicSurface, null, 2)});
export const CAVE_BIOME_DEFS = Object.freeze(${JSON.stringify(publicCaves, null, 2)});
export const OFFWORLD_MATERIAL_PROFILE_DEFS = Object.freeze(${JSON.stringify(publicProfiles, null, 2)});
export const BIOME_GENERATION_PROFILE_SELECTION = Object.freeze(${JSON.stringify(generationProfileSelection, null, 2)});
export const SURFACE_BIOME_SELECTION_ORDER = Object.freeze(${JSON.stringify(selectionSurface.map((record) => record.id))});
export const SHALLOW_CAVE_BIOME_SELECTION_ORDER = Object.freeze(${JSON.stringify(shallowCaves.map((segment) => sortedCaves.find((record) => record.symbol === segment.biome).id))});
export const DEEP_CAVE_BIOME_SELECTION_ORDER = Object.freeze(${JSON.stringify(deepCaves.map((segment) => sortedCaves.find((record) => record.symbol === segment.biome).id))});
`;

const outputs = [[hppPath, hpp], [jsPath, js]];
if (process.argv.includes('--validate-only')) {
  console.log(`validated ${schemaPath}`);
  process.exit(0);
}
const check = process.argv.includes('--check');
let stale = false;
for (const [path, contents] of outputs) {
  if (check) {
    let current = '';
    try { current = readFileSync(path, 'utf8'); } catch {}
    if (current !== contents) {
      console.error(`stale: ${path}`);
      stale = true;
    }
  } else {
    writeFileSync(path, contents);
    console.log(`wrote ${path}`);
  }
}
if (stale) process.exit(1);
