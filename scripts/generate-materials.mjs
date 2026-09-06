// Code generator for the shared material registry.
//
//   node scripts/generate-materials.mjs            # regenerate
//   node scripts/generate-materials.mjs --check     # fail if outputs are stale
//
// Reads src/sand/materials.schema.json (the single source of truth) and emits:
//   src/sand/materials.generated.js          (JS constants: KIND, MATERIALS, ...)
//   src/sand/cpp/engine/materials.generated.hpp (C++ enums + flat lookup tables)
// Both are committed; this keeps material ids/properties in exactly one place.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readSchemaJson } from './schema-json.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const schemaPath = resolve(root, 'src/sand/materials.schema.json');
const jsPath = resolve(root, 'src/sand/materials.generated.js');
const hppPath = resolve(root, 'src/sand/cpp/engine/materials.generated.hpp');

const schema = readSchemaJson(schemaPath);
const {
  tableSize, kinds, materialClasses, renderAnims, gasProfiles,
  explosiveProfiles, reactionProfiles,
  contactHazardProfiles,
  habitatProfiles, ambienceSampleFields, ambienceGroups, ambienceProfiles,
  liquidMovementProfiles, emissionProfiles, lightTransmissionProfiles,
  materialClassLightProfiles, renderDetailPatterns, renderDetailProfiles,
  flagBits, toolClasses, toolTiers, miningSpeed,
  placementProfiles, kindPlacementProfiles,
  plantGrowthProfiles, plantWorldgenProfiles, plantSpecies,
  palette, materials,
  animColors,
} = schema;

// These selectors name runtime branches or cross-cutting semantics rather than
// pure generated lookup data. Schema additions fail here until their code-owned
// implementation is registered in the same reviewable gate.
const codeOwnedSelectorKeys = Object.freeze({
  kinds: ['NONE', 'POWDER', 'LIQUID', 'GAS', 'COMPONENT', 'FREE_RIGID'],
  materialClasses: ['none', 'gas', 'solid', 'rigid', 'liquid'],
  renderAnims: ['none', 'fire', 'steam', 'smoke', 'water', 'oil', 'acid', 'lava', 'methane'],
  explosiveProfiles: ['none', 'tntFuse', 'methanePocket'],
  reactionProfiles: ['none', 'fire', 'acid', 'lava'],
  ambienceSampleFields: ['amount', 'worldX', 'worldY'],
  emissionProfiles: ['none', 'uniform', 'crystalQuarter', 'myceliumSparse'],
  renderDetailPatterns: ['none', 'hashMask', 'myceliumNodule', 'always'],
  flagBits: [
    'flammable', 'dissolvable', 'rigid', 'bearing', 'plantFamily',
    'quenchesLava', 'relaxesGaps', 'plantWood', 'plantLeaf',
    'spawnHazard', 'heatSource',
  ],
  toolClasses: ['none', 'pickaxe', 'axe', 'shovel', 'hand', 'dig'],
  toolTiers: ['hand', 'wood', 'stone', 'iron', 'gold'],
  placementProfiles: ['erase', 'paint', 'structure'],
  kindPlacementProfiles: ['NONE', 'POWDER', 'LIQUID', 'GAS', 'COMPONENT', 'FREE_RIGID'],
});

const assertEnum = (name, values, max = 255) => {
  if (!values || typeof values !== 'object' || Array.isArray(values))
    throw new Error(`schema must define ${name}`);
  const seen = new Set();
  for (const [key, value] of Object.entries(values)) {
    if (!Number.isInteger(value) || value < 0 || value > max)
      throw new Error(`${name}.${key} must be an integer in 0..${max}`);
    if (seen.has(value)) throw new Error(`${name} reuses numeric value ${value}`);
    seen.add(value);
  }
};
const assertImplementedKeys = (name, values, implemented) => {
  const keys = Object.keys(values ?? {});
  if (keys.length !== implemented.length
      || keys.some((key) => !implemented.includes(key)))
    throw new Error(`${name} contains an unimplemented selector; supported values: ${implemented.join(', ')}`);
};

if (!Number.isInteger(tableSize) || tableSize < 1 || tableSize > 256)
  throw new Error('tableSize must be an integer in 1..256 (material ids are bytes)');
assertEnum('kinds', kinds);
assertImplementedKeys('kinds', kinds,
  codeOwnedSelectorKeys.kinds);
assertEnum('materialClasses', materialClasses);
assertImplementedKeys('materialClasses', materialClasses,
  codeOwnedSelectorKeys.materialClasses);
assertEnum('renderAnims', renderAnims);
assertImplementedKeys('renderAnims', renderAnims,
  codeOwnedSelectorKeys.renderAnims);
if (!gasProfiles || typeof gasProfiles !== 'object' || !gasProfiles.none
    || gasProfiles.none.id !== 0) throw new Error('gasProfiles must define none with id 0');
assertEnum('gasProfiles ids', Object.fromEntries(
  Object.entries(gasProfiles).map(([name, profile]) => [name, profile.id])));
const gasProfileList = Object.values(gasProfiles).sort((a, b) => a.id - b.id);
for (let id = 0; id < gasProfileList.length; id++) {
  if (gasProfileList[id].id !== id)
    throw new Error('gasProfiles ids must be dense from 0 for indexed behavior tables');
}
for (const [name, profile] of Object.entries(gasProfiles)) {
  for (const field of ['decay', 'trappedDecay', 'upChance', 'sideChance']) {
    if (!Number.isFinite(profile[field]) || profile[field] < 0 || profile[field] > 1)
      throw new Error(`gasProfiles.${name}.${field} must be in 0..1`);
  }
  if (typeof profile.persistent !== 'boolean' || typeof profile.ceilingRoute !== 'boolean')
    throw new Error(`gasProfiles.${name} persistent/ceilingRoute must be boolean`);
}
if (!explosiveProfiles?.none || explosiveProfiles.none.id !== 0)
  throw new Error('explosiveProfiles must define none with id 0');
assertEnum('explosiveProfiles ids', Object.fromEntries(
  Object.entries(explosiveProfiles).map(([name, profile]) => [name, profile.id])));
const explosiveProfileList = Object.values(explosiveProfiles)
  .sort((a, b) => a.id - b.id);
assertImplementedKeys('explosiveProfiles', explosiveProfiles,
  codeOwnedSelectorKeys.explosiveProfiles);
for (let id = 0; id < explosiveProfileList.length; id++) {
  const profile = explosiveProfileList[id];
  if (profile.id !== id)
    throw new Error('explosiveProfiles ids must be dense from 0');
  if (typeof profile.heatSensitive !== 'boolean')
    throw new Error(`explosiveProfiles id ${id} heatSensitive must be boolean`);
  if (id === 0) {
    if (profile.heatSensitive || profile.requiredKind !== null)
      throw new Error('explosiveProfiles.none must be inert and kind-agnostic');
  } else if (!profile.heatSensitive || !(profile.requiredKind in kinds)) {
    throw new Error(`explosiveProfiles id ${id} must be heat-sensitive and name a requiredKind`);
  }
}
if (!reactionProfiles?.none || reactionProfiles.none.id !== 0)
  throw new Error('reactionProfiles must define none with id 0');
assertEnum('reactionProfiles ids', Object.fromEntries(
  Object.entries(reactionProfiles).map(([name, profile]) => [name, profile.id])));
const reactionProfileList = Object.values(reactionProfiles)
  .sort((a, b) => a.id - b.id);
assertImplementedKeys('reactionProfiles', reactionProfiles,
  codeOwnedSelectorKeys.reactionProfiles);
for (let id = 0; id < reactionProfileList.length; id++) {
  const profile = reactionProfileList[id];
  if (profile.id !== id)
    throw new Error('reactionProfiles ids must be dense from 0');
  if (id === 0) {
    if (profile.requiredKind !== null)
      throw new Error('reactionProfiles.none must be kind-agnostic');
  } else if (!(profile.requiredKind in kinds)) {
    throw new Error(`reactionProfiles id ${id} must name a requiredKind`);
  }
}
if (!contactHazardProfiles?.none || contactHazardProfiles.none.id !== 0)
  throw new Error('contactHazardProfiles must define none with id 0');
assertEnum('contactHazardProfiles ids', Object.fromEntries(
  Object.entries(contactHazardProfiles).map(([name, profile]) => [name, profile.id])));
const contactHazardProfileList = Object.values(contactHazardProfiles)
  .sort((a, b) => a.id - b.id);
const contactHazardPriorities = new Set();
for (let id = 0; id < contactHazardProfileList.length; id++) {
  const profile = contactHazardProfileList[id];
  if (profile.id !== id)
    throw new Error('contactHazardProfiles ids must be dense from 0');
  for (const field of ['playerDamage', 'creatureDamage', 'cadence', 'priority'])
    if (!Number.isInteger(profile[field]) || profile[field] < 0
        || profile[field] > 255)
      throw new Error(`contactHazardProfiles id ${id} has invalid ${field}`);
  const damaging = profile.playerDamage > 0 || profile.creatureDamage > 0;
  if ((id === 0) !== !damaging)
    throw new Error('only contactHazardProfiles.none may be harmless');
  if (damaging !== (profile.cadence > 0) || damaging !== (profile.priority > 0))
    throw new Error(`contactHazardProfiles id ${id} damage requires cadence and priority`);
  if (damaging && contactHazardPriorities.has(profile.priority))
    throw new Error(`contactHazardProfiles priority ${profile.priority} is duplicated`);
  if (damaging) contactHazardPriorities.add(profile.priority);
}
if (!habitatProfiles?.none || habitatProfiles.none.id !== 0)
  throw new Error('habitatProfiles must define none with id 0');
assertEnum('habitatProfiles ids', Object.fromEntries(
  Object.entries(habitatProfiles).map(([name, profile]) => [name, profile.id])));
const habitatProfileList = Object.values(habitatProfiles)
  .sort((a, b) => a.id - b.id);
for (let id = 0; id < habitatProfileList.length; id++) {
  const profile = habitatProfileList[id];
  if (profile.id !== id)
    throw new Error('habitatProfiles ids must be dense from 0');
  if (typeof profile.aquatic !== 'boolean')
    throw new Error(`habitatProfiles id ${id} aquatic must be boolean`);
  if (id === 0 && profile.aquatic)
    throw new Error('habitatProfiles.none cannot be aquatic');
}
assertEnum('ambienceSampleFields', ambienceSampleFields);
assertImplementedKeys('ambienceSampleFields', ambienceSampleFields,
  codeOwnedSelectorKeys.ambienceSampleFields);
const ambienceSampleFieldEntries = Object.entries(ambienceSampleFields)
  .sort((a, b) => a[1] - b[1]);
if (ambienceSampleFieldEntries.some((entry, offset) => entry[1] !== offset))
  throw new Error('ambienceSampleFields offsets must be dense from 0');
const ambienceSampleStride = ambienceSampleFieldEntries.length;
if (!ambienceGroups || typeof ambienceGroups !== 'object'
    || Array.isArray(ambienceGroups))
  throw new Error('schema must define ambienceGroups');
assertEnum('ambienceGroups ids', Object.fromEntries(
  Object.entries(ambienceGroups).map(([name, group]) => [name, group.id])), 254);
const ambienceGroupEntries = Object.entries(ambienceGroups)
  .sort((a, b) => a[1].id - b[1].id);
if (ambienceGroupEntries.length === 0
    || ambienceGroupEntries.some((entry, id) => entry[1].id !== id))
  throw new Error('ambienceGroups ids must be dense from 0');
const ambienceNoiseKinds = new Set(['white', 'brown', 'crackle']);
const ambienceFilterTypes = new Set(['lowpass', 'bandpass', 'highpass']);
for (const [name, group] of ambienceGroupEntries) {
  if (!Number.isFinite(group.gain) || group.gain < 0 || group.gain > 1
      || !ambienceNoiseKinds.has(group.noise)
      || !ambienceFilterTypes.has(group.filterType)
      || !Number.isFinite(group.frequency) || group.frequency <= 0
      || !Number.isFinite(group.q) || group.q < 0)
    throw new Error(`ambienceGroups.${name} has invalid mixer metadata`);
}
if (!ambienceProfiles?.none || ambienceProfiles.none.id !== 0)
  throw new Error('ambienceProfiles must define none with id 0');
assertEnum('ambienceProfiles ids', Object.fromEntries(
  Object.entries(ambienceProfiles).map(([name, profile]) => [name, profile.id])));
const ambienceProfileList = Object.values(ambienceProfiles)
  .sort((a, b) => a.id - b.id);
const usedAmbienceGroups = new Set();
for (let id = 0; id < ambienceProfileList.length; id++) {
  const profile = ambienceProfileList[id];
  if (profile.id !== id)
    throw new Error('ambienceProfiles ids must be dense from 0');
  if (id === 0) {
    if (profile.group !== null)
      throw new Error('ambienceProfiles.none must have a null group');
  } else {
    if (!(profile.group in ambienceGroups))
      throw new Error(`ambienceProfiles id ${id} names unknown group ${profile.group}`);
    usedAmbienceGroups.add(profile.group);
  }
}
if (usedAmbienceGroups.size !== ambienceGroupEntries.length)
  throw new Error('every ambienceGroups entry needs an ambience profile');
if (!liquidMovementProfiles?.none || liquidMovementProfiles.none.id !== 0)
  throw new Error('liquidMovementProfiles must define none with id 0');
assertEnum('liquidMovementProfiles ids', Object.fromEntries(
  Object.entries(liquidMovementProfiles).map(([name, profile]) => [name, profile.id])));
const liquidProfileList = Object.values(liquidMovementProfiles).sort((a, b) => a.id - b.id);
for (let id = 0; id < liquidProfileList.length; id++) {
  const profile = liquidProfileList[id];
  if (profile.id !== id)
    throw new Error('liquidMovementProfiles ids must be dense from 0');
  if (typeof profile.mobilityGated !== 'boolean'
      || typeof profile.straightFallIgnoresMobility !== 'boolean'
      || !Number.isInteger(profile.fixedFallCap) || profile.fixedFallCap < 0
      || profile.fixedFallCap > 255)
    throw new Error(`liquidMovementProfiles id ${id} has invalid movement fields`);
  if (profile.straightFallIgnoresMobility && !profile.mobilityGated)
    throw new Error(`liquidMovementProfiles id ${id} cannot bypass a disabled mobility gate`);
}
assertEnum('emissionProfiles', emissionProfiles);
if (emissionProfiles.none !== 0) throw new Error('emissionProfiles.none must be 0');
assertImplementedKeys('emissionProfiles', emissionProfiles,
  codeOwnedSelectorKeys.emissionProfiles);
assertEnum('renderDetailPatterns', renderDetailPatterns);
if (renderDetailPatterns.none !== 0) throw new Error('renderDetailPatterns.none must be 0');
assertImplementedKeys('renderDetailPatterns', renderDetailPatterns,
  codeOwnedSelectorKeys.renderDetailPatterns);
if (!renderDetailProfiles?.none || renderDetailProfiles.none.id !== 0)
  throw new Error('renderDetailProfiles must define none with id 0');
assertEnum('renderDetailProfiles ids', Object.fromEntries(
  Object.entries(renderDetailProfiles).map(([name, profile]) => [name, profile.id])));
const renderDetailProfileList = Object.values(renderDetailProfiles).sort((a, b) => a.id - b.id);
for (let id = 0; id < renderDetailProfileList.length; id++) {
  const profile = renderDetailProfileList[id];
  if (profile.id !== id) throw new Error('renderDetailProfiles ids must be dense from 0');
  if (!(profile.pattern in renderDetailPatterns)
      || !Number.isInteger(profile.mask) || profile.mask < 0
      || !Number.isInteger(profile.match) || profile.match < 0
      || (profile.color !== null && !(profile.color in animColors)))
    throw new Error(`renderDetailProfiles id ${id} has invalid pattern/color fields`);
}
if (!lightTransmissionProfiles || typeof lightTransmissionProfiles !== 'object')
  throw new Error('schema must define lightTransmissionProfiles');
assertEnum('lightTransmissionProfiles ids', Object.fromEntries(
  Object.entries(lightTransmissionProfiles).map(([name, profile]) => [name, profile.id])));
for (const [name, profile] of Object.entries(lightTransmissionProfiles)) {
  if (typeof profile.transparent !== 'boolean' || typeof profile.faceLit !== 'boolean'
      || !Number.isInteger(profile.loss) || profile.loss < 0 || profile.loss > 255)
    throw new Error(`lightTransmissionProfiles.${name} has invalid light fields`);
}
if (!materialClassLightProfiles || typeof materialClassLightProfiles !== 'object')
  throw new Error('schema must define materialClassLightProfiles');
for (const materialClass of Object.keys(materialClasses)) {
  if (!(materialClassLightProfiles[materialClass] in lightTransmissionProfiles))
    throw new Error(`materialClassLightProfiles.${materialClass} must name a light profile`);
}
assertEnum('flagBits', flagBits, 31);
assertImplementedKeys('flagBits', flagBits, codeOwnedSelectorKeys.flagBits);
assertEnum('toolClasses', toolClasses);
assertImplementedKeys('toolClasses', toolClasses,
  codeOwnedSelectorKeys.toolClasses);
assertEnum('toolTiers', toolTiers);
assertImplementedKeys('toolTiers', toolTiers,
  codeOwnedSelectorKeys.toolTiers);
assertEnum('placementProfiles', placementProfiles);
assertImplementedKeys('placementProfiles', placementProfiles,
  codeOwnedSelectorKeys.placementProfiles);
if (!kindPlacementProfiles || typeof kindPlacementProfiles !== 'object')
  throw new Error('schema must define kindPlacementProfiles');
assertImplementedKeys('kindPlacementProfiles', kindPlacementProfiles,
  codeOwnedSelectorKeys.kindPlacementProfiles);
for (const kind of Object.keys(kinds)) {
  const profile = kindPlacementProfiles[kind];
  if (!(profile in placementProfiles))
    throw new Error(`kindPlacementProfiles.${kind} must name a placementProfiles entry`);
}

if (!renderAnims || renderAnims.none !== 0) throw new Error('schema must define renderAnims with none = 0');
const toolClassCount = Math.max(...Object.values(toolClasses)) + 1;
const toolTierCount = Math.max(...Object.values(toolTiers)) + 1;
if (!miningSpeed || miningSpeed.classPercent?.length !== toolClassCount || miningSpeed.classPercent.some((r) => r.length !== toolClassCount)) throw new Error('miningSpeed.classPercent must be a square tool-class matrix');
if (miningSpeed.tierPercent?.length !== toolTierCount) throw new Error('miningSpeed.tierPercent must have one entry per tool tier');
if (!Number.isInteger(miningSpeed.progressDivisor) || miningSpeed.progressDivisor < 1) throw new Error('miningSpeed.progressDivisor must be a positive integer');
const maxToolTier = Math.max(...Object.values(toolTiers));

// Materials indexed by id, with empty slots for any gaps up to tableSize.
const byId = new Array(tableSize).fill(null);
const materialNames = new Set();
let previousId = -1;
for (const m of materials) {
  if (!Number.isInteger(m.id) || m.id < 0 || m.id >= tableSize) throw new Error(`material ${m.name} id ${m.id} out of range 0..${tableSize - 1}`);
  if (m.id <= previousId) throw new Error(`materials must be ordered by strictly increasing stable id (${m.name} follows id ${previousId})`);
  previousId = m.id;
  if (byId[m.id]) throw new Error(`duplicate material id ${m.id}`);
  if (typeof m.name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(m.name)) throw new Error(`material id ${m.id} has invalid name ${m.name}`);
  if (materialNames.has(m.name)) throw new Error(`duplicate material name ${m.name}`);
  materialNames.add(m.name);
  if (!(m.kind in kinds)) throw new Error(`material ${m.name} has unknown kind ${m.kind}`);
  if (!('materialClass' in m)) throw new Error(`material ${m.name} missing materialClass`);
  if (!(m.materialClass in materialClasses)) throw new Error(`material ${m.name} has unknown materialClass ${m.materialClass}`);
  if (!(m.renderAnim in renderAnims)) throw new Error(`material ${m.name} has unknown renderAnim ${m.renderAnim}`);
  const gasProfile = m.gasProfile ?? 'none';
  if (!(gasProfile in gasProfiles)) throw new Error(`material ${m.name} has unknown gasProfile ${gasProfile}`);
  if (m.kind === 'GAS' && gasProfile === 'none') throw new Error(`gas material ${m.name} must select a gasProfile`);
  if (m.kind !== 'GAS' && gasProfile !== 'none') throw new Error(`non-gas material ${m.name} cannot select gasProfile ${gasProfile}`);
  const explosiveProfile = m.explosiveProfile ?? 'none';
  if (!(explosiveProfile in explosiveProfiles))
    throw new Error(`material ${m.name} has unknown explosiveProfile ${explosiveProfile}`);
  const reactionProfile = m.reactionProfile ?? 'none';
  if (!(reactionProfile in reactionProfiles))
    throw new Error(`material ${m.name} has unknown reactionProfile ${reactionProfile}`);
  const contactHazardProfile = m.contactHazardProfile ?? 'none';
  if (!(contactHazardProfile in contactHazardProfiles))
    throw new Error(`material ${m.name} has unknown contactHazardProfile ${contactHazardProfile}`);
  const habitatProfile = m.habitatProfile ?? 'none';
  if (!(habitatProfile in habitatProfiles))
    throw new Error(`material ${m.name} has unknown habitatProfile ${habitatProfile}`);
  const ambienceProfile = m.ambienceProfile ?? 'none';
  if (!(ambienceProfile in ambienceProfiles))
    throw new Error(`material ${m.name} has unknown ambienceProfile ${ambienceProfile}`);
  const liquidProfile = m.liquidMovementProfile ?? 'none';
  if (!(liquidProfile in liquidMovementProfiles)) throw new Error(`material ${m.name} has unknown liquidMovementProfile ${liquidProfile}`);
  if (m.kind === 'LIQUID' && liquidProfile === 'none') throw new Error(`liquid material ${m.name} must select a liquidMovementProfile`);
  if (m.kind !== 'LIQUID' && liquidProfile !== 'none') throw new Error(`non-liquid material ${m.name} cannot select liquidMovementProfile ${liquidProfile}`);
  if (m.kind === 'LIQUID' && m.mobility < 1
      && !liquidMovementProfiles[liquidProfile].mobilityGated)
    throw new Error(`low-mobility liquid ${m.name} needs a mobility-gated movement profile`);
  const emissionProfile = m.emissionProfile ?? 'none';
  if (!(emissionProfile in emissionProfiles)) throw new Error(`material ${m.name} has unknown emissionProfile ${emissionProfile}`);
  if ((m.emission ?? 0) > 0 && emissionProfile === 'none') throw new Error(`emitting material ${m.name} must select an emissionProfile`);
  if ((m.emission ?? 0) === 0 && emissionProfile !== 'none') throw new Error(`non-emitting material ${m.name} cannot select emissionProfile ${emissionProfile}`);
  const renderDetailProfile = m.renderDetailProfile ?? 'none';
  if (!(renderDetailProfile in renderDetailProfiles)) throw new Error(`material ${m.name} has unknown renderDetailProfile ${renderDetailProfile}`);
  const lightProfile = m.lightProfile ?? materialClassLightProfiles[m.materialClass];
  if (!(lightProfile in lightTransmissionProfiles)) throw new Error(`material ${m.name} has unknown lightProfile ${lightProfile}`);
  if (!('flags' in m)) throw new Error(`material ${m.name} missing flags`);
  if (!Array.isArray(m.flags) || new Set(m.flags).size !== m.flags.length) throw new Error(`material ${m.name} flags must be a duplicate-free array`);
  for (const f of m.flags) if (!(f in flagBits)) throw new Error(`material ${m.name} has unknown flag ${f}`);
  if (m.craftingFlags !== undefined
      && (!Array.isArray(m.craftingFlags)
        || new Set(m.craftingFlags).size !== m.craftingFlags.length))
    throw new Error(`material ${m.name} craftingFlags must be a duplicate-free array`);
  for (const f of m.craftingFlags ?? []) if (!(f in flagBits)) throw new Error(`material ${m.name} has unknown crafting flag ${f}`);
  if (!('toolClass' in m)) throw new Error(`material ${m.name} missing toolClass`);
  if (!(m.toolClass in toolClasses)) throw new Error(`material ${m.name} has unknown toolClass ${m.toolClass}`);
  if (!('toolTier' in m) || !Number.isInteger(m.toolTier) || m.toolTier < 0 || m.toolTier > maxToolTier) throw new Error(`material ${m.name} has invalid toolTier ${m.toolTier}`);
  if (!Number.isFinite(m.density) || m.density < 0) throw new Error(`material ${m.name} has invalid density ${m.density}`);
  if (typeof m.looseSorted !== 'boolean') throw new Error(`material ${m.name} looseSorted must be boolean`);
  if (!Number.isFinite(m.mobility) || m.mobility < 0 || m.mobility > 1) throw new Error(`material ${m.name} has invalid mobility ${m.mobility}`);
  if ('transparency' in m && (!Number.isFinite(m.transparency) || m.transparency < 0 || m.transparency > 1)) throw new Error(`material ${m.name} has invalid transparency ${m.transparency}`);
  for (const [field, max] of [['textureAmp', 255], ['durability', 255], ['emission', 255]]) {
    const value = m[field] ?? 0;
    if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`material ${m.name} has invalid ${field} ${value}`);
  }
  if (typeof m.color !== 'string' || !/^0x[0-9a-fA-F]{8}$/.test(m.color)) throw new Error(`material ${m.name} color must be packed 0xAABBGGRR`);
  byId[m.id] = m;
}
if (!byId[0] || byId[0].name !== 'EMPTY') throw new Error('material id 0 must be EMPTY');

// Pack a material's flag-name list into a bitmask using flagBits indices.
const flagMask = (m) => m.flags.reduce((acc, f) => acc + (2 ** flagBits[f]), 0);
const craftingFlagMask = (m) => [...new Set([...m.flags, ...(m.craftingFlags ?? [])])]
  .reduce((acc, f) => acc + (2 ** flagBits[f]), 0);

const hasFlag = (m, f) => m.flags.includes(f);
const mc = (name) => materialClasses[name];
for (const m of materials) {
  const c = materialClasses[m.materialClass];
  if (m.name === 'EMPTY' && c !== mc('none')) throw new Error('EMPTY must have materialClass none');
  if ((m.kind === 'NONE') !== (m.name === 'EMPTY'))
    throw new Error(`${m.name}: K_NONE is reserved for EMPTY`);
  if (m.kind === 'GAS' && c !== mc('gas')) throw new Error(`${m.name}: K_GAS must have materialClass gas`);
  if (m.kind === 'LIQUID' && c !== mc('liquid')) throw new Error(`${m.name}: K_LIQUID must have materialClass liquid`);
  if (m.kind === 'POWDER' && c !== mc('solid')) throw new Error(`${m.name}: K_POWDER must have materialClass solid`);
  if (m.kind === 'COMPONENT' && (c !== mc('rigid') || !hasFlag(m, 'rigid'))) throw new Error(`${m.name}: K_COMPONENT requires rigid class and rigid flag`);
  if (m.kind === 'FREE_RIGID' && (c !== mc('rigid') || !hasFlag(m, 'rigid'))) throw new Error(`${m.name}: K_FREE_RIGID requires rigid class and rigid flag`);
  if (c === mc('rigid') && m.kind !== 'COMPONENT' && m.kind !== 'FREE_RIGID') throw new Error(`${m.name}: rigid class requires a structural kind`);
  if (hasFlag(m, 'rigid') && c !== mc('rigid')) throw new Error(`${m.name}: rigid flag requires materialClass rigid`);
  if (hasFlag(m, 'plantFamily') && (m.kind !== 'COMPONENT' || c !== mc('rigid') || !hasFlag(m, 'rigid'))) throw new Error(`${m.name}: plantFamily requires a rigid component`);
  if ((hasFlag(m, 'plantWood') || hasFlag(m, 'plantLeaf')) && !hasFlag(m, 'plantFamily')) throw new Error(`${m.name}: plantWood/plantLeaf require plantFamily`);
  if (hasFlag(m, 'plantWood') && hasFlag(m, 'plantLeaf')) throw new Error(`${m.name}: plantWood and plantLeaf are mutually exclusive roles`);
  if ((m.contactHazardProfile ?? 'none') !== 'none'
      && !hasFlag(m, 'spawnHazard'))
    throw new Error(`${m.name}: contact hazards must also be spawn hazards`);
  if (habitatProfiles[m.habitatProfile ?? 'none'].aquatic
      && c !== mc('liquid'))
    throw new Error(`${m.name}: aquatic habitat requires a liquid material`);
  const explosiveProfile = explosiveProfiles[m.explosiveProfile ?? 'none'];
  if (explosiveProfile.requiredKind !== null
      && m.kind !== explosiveProfile.requiredKind)
    throw new Error(`${m.name}: explosive profile requires kind ${explosiveProfile.requiredKind}`);
  if (explosiveProfile.id !== 0 && !hasFlag(m, 'spawnHazard'))
    throw new Error(`${m.name}: explosive profiles must also be spawn hazards`);
  const reactionProfile = reactionProfiles[m.reactionProfile ?? 'none'];
  if (reactionProfile.requiredKind !== null
      && m.kind !== reactionProfile.requiredKind)
    throw new Error(`${m.name}: reaction profile requires kind ${reactionProfile.requiredKind}`);
  if (reactionProfile.id !== 0 && !hasFlag(m, 'spawnHazard'))
    throw new Error(`${m.name}: reaction profiles must also be spawn hazards`);
  if ((reactionProfile.id === reactionProfiles.fire.id
       || reactionProfile.id === reactionProfiles.lava.id)
      && !hasFlag(m, 'heatSource'))
    throw new Error(`${m.name}: hot reaction profiles require heatSource`);
  if (c === mc('rigid') && !hasFlag(m, 'bearing') && m.nonBearing !== true) throw new Error(`${m.name}: non-bearing rigid materials must declare nonBearing: true`);
  if (m.nonBearing === true && (c !== mc('rigid') || hasFlag(m, 'bearing'))) throw new Error(`${m.name}: nonBearing is only valid for a rigid material without the bearing flag`);
  if (c === mc('none') && m.name !== 'EMPTY') throw new Error(`${m.name}: only EMPTY may have materialClass none`);
}

const profileCatalogue = (name, records) => {
  if (!Array.isArray(records) || records.length === 0)
    throw new Error(`schema must define ${name}`);
  if (records.length > 256)
    throw new Error(`${name} cannot exceed 256 uint8-backed profiles`);
  const sorted = [...records].sort((a, b) => a.id - b.id);
  const byName = new Map();
  for (let id = 0; id < sorted.length; id++) {
    const profile = sorted[id];
    if (profile.id !== id)
      throw new Error(`${name} ids must be dense and stable from 0`);
    if (typeof profile.name !== 'string'
        || !/^[a-z][a-zA-Z0-9]*$/.test(profile.name)
        || byName.has(profile.name))
      throw new Error(`invalid or duplicate ${name} profile ${profile.name}`);
    byName.set(profile.name, profile);
  }
  return { sorted, byName };
};
const growthCatalogue = profileCatalogue(
  'plantGrowthProfiles', plantGrowthProfiles);
const worldgenCatalogue = profileCatalogue(
  'plantWorldgenProfiles', plantWorldgenProfiles);
const plantGrowthProfileList = growthCatalogue.sorted;
const plantWorldgenProfileList = worldgenCatalogue.sorted;
const plantGrowthProfileByName = growthCatalogue.byName;
const plantWorldgenProfileByName = worldgenCatalogue.byName;
const plantWoodTopologies = {
  generic: 0, vine: 1, oak: 2, pine: 3, willow: 4, cactus: 5, eye: 6,
};
const plantLeafTopologies = {
  generic: 0, mushroom: 1, vine: 2, willow: 3, pine: 4, oak: 5,
};
const plantTrunkProfiles = { none: 0, generic: 1, tree: 2 };
const plantLeafBurstProfiles = { default: 0, single: 1, pine: 2 };
const plantWorldgenTopologies = {
  broadleaf: 0, pine: 1, willow: 2, cactus: 3, bush: 4, eye: 5,
};
const plantWorldgenMinimumReach = {
  broadleaf: { horizontal: 9, crownAboveTop: 7 },
  pine: { horizontal: 10, crownAboveTop: 2 },
  willow: { horizontal: 14, crownAboveTop: 7 },
  cactus: { horizontal: 2, crownAboveTop: 0 },
  bush: { horizontal: 5, crownAboveTop: 7 },
  eye: { horizontal: 20, crownAboveTop: 8 },
};
const probability = (owner, field) => {
  const value = owner[field];
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new Error(`${owner.name}.${field} must be in 0..1`);
};
for (const profile of plantGrowthProfileList) {
  if (!(profile.woodTopology in plantWoodTopologies)
      || !(profile.leafTopology in plantLeafTopologies)
      || !(profile.trunkProfile in plantTrunkProfiles)
      || !(profile.leafBurst in plantLeafBurstProfiles))
    throw new Error(`${profile.name} has an unknown plant growth topology`);
  for (const field of [
    'maxWoodBase', 'maxWoodVariation', 'maxLeafBase', 'maxLeafVariation',
    'leafStart', 'thickenHeight', 'wideBaseHeight',
  ]) {
    if (!Number.isInteger(profile[field]) || profile[field] < 0
        || profile[field] > 65535)
      throw new Error(`${profile.name}.${field} must be an integer in 0..65535`);
  }
  for (const field of [
    'straight', 'leaves', 'variedTree', 'finishStemFirst', 'extraWood',
    'gravityRecovery',
  ]) if (typeof profile[field] !== 'boolean')
    throw new Error(`${profile.name}.${field} must be boolean`);
  for (const field of [
    'woodLeafChance', 'vineBerriesChance', 'foliageAlongsideWoodChance',
    'oppositeChance', 'wideBaseChance',
  ]) probability(profile, field);
  if (profile.trunkProfile !== 'tree'
      && (profile.thickenHeight || profile.wideBaseHeight
          || profile.oppositeChance || profile.wideBaseChance))
    throw new Error(`${profile.name} has tree thickening parameters without the tree trunk profile`);
}
for (const profile of plantWorldgenProfileList) {
  if (!(profile.topology in plantWorldgenTopologies))
    throw new Error(`${profile.name}.topology is unknown`);
  for (const field of [
    'heightBase', 'heightVariation', 'horizontalReach', 'upwardReach',
  ])
    if (!Number.isInteger(profile[field]) || profile[field] < 0
        || profile[field] > 255)
      throw new Error(`${profile.name}.${field} must be an integer in 0..255`);
  const minimum = plantWorldgenMinimumReach[profile.topology];
  const tallest = profile.heightBase + Math.max(0, profile.heightVariation - 1);
  if (profile.horizontalReach < minimum.horizontal
      || profile.upwardReach < tallest + minimum.crownAboveTop)
    throw new Error(`${profile.name} reach cannot contain its worldgen topology`);
}

if (!Array.isArray(plantSpecies) || plantSpecies.length === 0)
  throw new Error('schema must define plantSpecies');
if (plantSpecies.length > 255)
  throw new Error('plantSpecies cannot exceed 255 entries because id 255 is reserved');
const materialByName = new Map(materials.map((m) => [m.name, m]));
const plantSpeciesList = [...plantSpecies].sort((a, b) => a.id - b.id);
const plantNames = new Set();
for (let id = 0; id < plantSpeciesList.length; id++) {
  const species = plantSpeciesList[id];
  if (species.id !== id || species.id >= 255)
    throw new Error('plantSpecies ids must be dense in 0..254; id 255 is reserved');
  if (typeof species.name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(species.name)
      || plantNames.has(species.name)) throw new Error(`invalid or duplicate plant species ${species.name}`);
  plantNames.add(species.name);
  if (typeof species.label !== 'string' || !species.label) throw new Error(`${species.name} needs a label`);
  if (typeof species.palette !== 'boolean') throw new Error(`${species.name}.palette must be boolean`);
  if (!plantGrowthProfileByName.has(species.growthProfile))
    throw new Error(`${species.name}.growthProfile names unknown profile ${species.growthProfile}`);
  if (!plantWorldgenProfileByName.has(species.worldgenProfile))
    throw new Error(`${species.name}.worldgenProfile names unknown profile ${species.worldgenProfile}`);
  if (!Array.isArray(species.colors) || species.colors.length !== 2
      || species.colors.some((color) => !/^#[0-9a-fA-F]{6}$/.test(color)))
    throw new Error(`${species.name}.colors must contain two CSS hex colors`);
  if (!Array.isArray(species.pixels) || species.pixels.length !== 9
      || species.pixels.some((row) => !/^[.12]{9}$/.test(row)))
    throw new Error(`${species.name}.pixels must be a 9x9 .12 pattern`);
  for (const [field, role] of [['seedMaterial', null], ['woodMaterial', 'plantWood'], ['leafMaterial', 'plantLeaf']]) {
    const material = materialByName.get(species[field]);
    if (!material) throw new Error(`${species.name}.${field} names unknown material ${species[field]}`);
    if (!hasFlag(material, 'plantFamily') || material.kind !== 'COMPONENT'
        || material.materialClass !== 'rigid' || !hasFlag(material, 'rigid'))
      throw new Error(`${species.name}.${field} must be a rigid plant component`);
    if (role && !hasFlag(material, role)) throw new Error(`${species.name}.${field} must have ${role}`);
    if (!role && (hasFlag(material, 'plantWood') || hasFlag(material, 'plantLeaf')))
      throw new Error(`${species.name}.${field} cannot be trunk or foliage`);
  }
}
if (!plantNames.has('STANDARD')) throw new Error('plantSpecies must include STANDARD');
for (const profile of plantGrowthProfileList)
  if (!plantSpeciesList.some((species) => species.growthProfile === profile.name))
    throw new Error(`plantGrowthProfiles.${profile.name} is not used by any species`);
for (const profile of plantWorldgenProfileList)
  if (!plantSpeciesList.some((species) => species.worldgenProfile === profile.name))
    throw new Error(`plantWorldgenProfiles.${profile.name} is not used by any species`);

const plantMaterialSpecies = new Map();
for (const species of plantSpeciesList) {
  for (const field of ['seedMaterial', 'woodMaterial', 'leafMaterial']) {
    const uses = plantMaterialSpecies.get(species[field]) ?? new Set();
    uses.add(species.id);
    plantMaterialSpecies.set(species[field], uses);
  }
}
const encodedPlantSpecies = (m) => {
  const uses = plantMaterialSpecies.get(m.name);
  return uses?.size === 1 ? [...uses][0] : 255;
};
const standardPlantSpecies = plantSpeciesList.find((species) => species.name === 'STANDARD');
const genericSeedMaterial = standardPlantSpecies.seedMaterial;
const hiddenPaletteMaterials = new Set(plantSpeciesList
  .filter((species) => species.palette && species.seedMaterial !== genericSeedMaterial)
  .map((species) => species.seedMaterial));

if (!palette || !Array.isArray(palette.mainOrder) || !Array.isArray(palette.sections))
  throw new Error('schema must define palette.mainOrder and palette.sections');
const paletteLabels = new Set(materials
  .filter((m) => m.name !== 'EMPTY' && !hiddenPaletteMaterials.has(m.name))
  .map((m) => m.name.toLowerCase()));
paletteLabels.add('cube'); paletteLabels.add('eraser');
for (const species of plantSpeciesList) if (species.palette)
  paletteLabels.add(`${species.label.toLowerCase()} seed`);
for (const label of palette.mainOrder) if (!paletteLabels.has(label))
  throw new Error(`palette.mainOrder names unknown entry ${label}`);
if (new Set(palette.mainOrder).size !== palette.mainOrder.length)
  throw new Error('palette.mainOrder entries must be unique');
const paletteSectionIds = new Set();
for (const section of palette.sections) {
  if (typeof section.id !== 'string' || !section.id || paletteSectionIds.has(section.id))
    throw new Error(`invalid or duplicate palette section ${section.id}`);
  paletteSectionIds.add(section.id);
  if (typeof section.label !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(section.accent))
    throw new Error(`palette section ${section.id} needs label/accent`);
  for (const label of section.labels ?? []) if (!paletteLabels.has(label))
    throw new Error(`palette section ${section.id} names unknown entry ${label}`);
  for (const kind of section.entryKinds ?? []) if (!['seed', 'creature'].includes(kind))
    throw new Error(`palette section ${section.id} has unknown entry kind ${kind}`);
}

const materialIdLimit = Math.max(...materials.map((m) => m.id)) + 1;
const firstUndefinedMaterialId = byId.findIndex((m) => m === null);

const BANNER = (tool) => `// @generated by scripts/generate-materials.mjs from materials.schema.json\n// DO NOT EDIT BY HAND. Edit the schema, then run \`npm run generate\`.\n// (${tool})\n`;
const animKeys = Object.keys(animColors).filter((k) => !k.startsWith('$'));

// ---------------- JS ----------------
const jsKindLines = Object.entries(kinds).map(([k, v]) => `  ${k}: ${v},`).join('\n');
const jsClassLines = Object.entries(materialClasses).map(([k, v]) => `  ${k.toUpperCase()}: ${v},`).join('\n');
const jsRenderAnimLines = Object.entries(renderAnims).map(([k, v]) => `  ${k.toUpperCase()}: ${v},`).join('\n');
const jsGasProfileLines = Object.entries(gasProfiles).map(([k, v]) => `  ${k.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}: ${v.id},`).join('\n');
const enumKey = (key) => key.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
const jsExplosiveProfileLines = Object.entries(explosiveProfiles)
  .map(([k, v]) => `  ${enumKey(k)}: ${v.id},`).join('\n');
const jsReactionProfileLines = Object.entries(reactionProfiles)
  .map(([k, v]) => `  ${enumKey(k)}: ${v.id},`).join('\n');
const jsContactHazardProfileLines = Object.entries(contactHazardProfiles)
  .map(([k, v]) => `  ${enumKey(k)}: ${v.id},`).join('\n');
const jsHabitatProfileLines = Object.entries(habitatProfiles)
  .map(([k, v]) => `  ${enumKey(k)}: ${v.id},`).join('\n');
const jsAmbienceSampleFieldLines = ambienceSampleFieldEntries
  .map(([k, v]) => `  ${enumKey(k)}: ${v},`).join('\n');
const jsAmbienceProfileLines = Object.entries(ambienceProfiles)
  .map(([k, v]) => `  ${enumKey(k)}: ${v.id},`).join('\n');
const jsAmbienceGroupLines = ambienceGroupEntries
  .map(([k, v]) => `  ${enumKey(k)}: ${v.id},`).join('\n');
const ambienceGroupMixer = ambienceGroupEntries.map(([name, group]) => ({
  name, id: group.id, gain: group.gain, noise: group.noise,
  filterType: group.filterType, frequency: group.frequency, q: group.q,
}));
const jsLiquidProfileLines = Object.entries(liquidMovementProfiles).map(([k, v]) => `  ${enumKey(k)}: ${v.id},`).join('\n');
const jsEmissionProfileLines = Object.entries(emissionProfiles).map(([k, v]) => `  ${enumKey(k)}: ${v},`).join('\n');
const jsLightProfileLines = Object.entries(lightTransmissionProfiles).map(([k, v]) => `  ${enumKey(k)}: ${v.id},`).join('\n');
const jsRenderDetailPatternLines = Object.entries(renderDetailPatterns).map(([k, v]) => `  ${enumKey(k)}: ${v},`).join('\n');
const jsRenderDetailProfileLines = Object.entries(renderDetailProfiles).map(([k, v]) => `  ${enumKey(k)}: ${v.id},`).join('\n');
const jsPlacementLines = Object.entries(placementProfiles).map(([k, v]) => `  ${k.toUpperCase()}: ${v},`).join('\n');
const lightProfileFor = (m) => lightTransmissionProfiles[
  m.lightProfile ?? materialClassLightProfiles[m.materialClass]];
const habitatProfileFor = (m) => habitatProfiles[m.habitatProfile ?? 'none'];
const ambienceProfileFor = (m) => ambienceProfiles[m.ambienceProfile ?? 'none'];
const ambienceGroupFor = (m) => {
  const group = ambienceProfileFor(m).group;
  return group === null ? 255 : ambienceGroups[group].id;
};
const explosiveProfileFor = (m) => explosiveProfiles[m.explosiveProfile ?? 'none'];
const reactionProfileFor = (m) => reactionProfiles[m.reactionProfile ?? 'none'];
const jsMatLines = materials
  .map((m) => `  { id: ${m.id}, name: '${m.name}', kind: KIND.${m.kind}, placement: MP.${kindPlacementProfiles[m.kind].toUpperCase()}, gasProfile: GP.${enumKey(m.gasProfile ?? 'none')}, explosiveProfile: XP.${enumKey(m.explosiveProfile ?? 'none')}, reactionProfile: MRP.${enumKey(m.reactionProfile ?? 'none')}, contactHazardProfile: CHP.${enumKey(m.contactHazardProfile ?? 'none')}, habitatProfile: HP.${enumKey(m.habitatProfile ?? 'none')}, ambienceProfile: AP.${enumKey(m.ambienceProfile ?? 'none')}, liquidMovementProfile: LMP.${enumKey(m.liquidMovementProfile ?? 'none')}, emissionProfile: EP.${enumKey(m.emissionProfile ?? 'none')}, renderDetailProfile: RDP.${enumKey(m.renderDetailProfile ?? 'none')}, lightProfile: LTP.${enumKey(m.lightProfile ?? materialClassLightProfiles[m.materialClass])}, materialClass: MC.${m.materialClass.toUpperCase()}, density: ${m.density}, looseSorted: ${m.looseSorted}, mobility: ${m.mobility}, transparency: ${m.transparency ?? 0}, color: ${m.color}, textureAmp: ${m.textureAmp ?? 0}, durability: ${m.durability ?? 0}, emission: ${m.emission ?? 0}, renderAnim: '${m.renderAnim}' },`)
  .join('\n');
const jsAnimLines = animKeys.map((k) => `export const ${k} = ${animColors[k]};`).join('\n');
const jsFlagLines = Object.entries(flagBits).map(([k, v]) => `  ${k}: ${2 ** v},`).join('\n');
const jsToolClassLines = Object.entries(toolClasses).map(([k, v]) => `  ${k}: ${v},`).join('\n');
const jsToolTierLines = Object.entries(toolTiers).map(([k, v]) => `  ${k}: ${v},`).join('\n');
const jsArr = (pick) => byId.map((m) => (m ? pick(m) : 0)).join(', ');
const plantSpeciesJs = JSON.stringify(plantSpeciesList.map((species) => ({
  ...species,
  growthProfile: plantGrowthProfileByName.get(species.growthProfile).id,
  worldgenProfile: plantWorldgenProfileByName.get(species.worldgenProfile).id,
  seedMaterial: materialByName.get(species.seedMaterial).id,
  woodMaterial: materialByName.get(species.woodMaterial).id,
  leafMaterial: materialByName.get(species.leafMaterial).id,
})), null, 2);
const js = `${BANNER('JS module')}
// Slots in the flat lookup tables (power-of-two headroom over the live ids).
export const TABLE_SIZE = ${tableSize};
export const MATERIAL_COUNT = ${materials.length};
export const MATERIAL_ID_LIMIT = ${materialIdLimit};
export const FIRST_UNDEFINED_MATERIAL_ID = ${firstUndefinedMaterialId};

// How the engine routes a cell each tick (mirrors C++ enum Kind).
export const KIND = {
${jsKindLines}
};

// Broad gameplay/physics class (mirrors C++ enum MaterialClass / MC_*).
export const MC = {
${jsClassLines}
};

// Render-only texture animation type (mirrors C++ enum RenderAnim / RA_*).
export const RA = {
${jsRenderAnimLines}
};

export const GP = {
${jsGasProfileLines}
};

export const XP = {
${jsExplosiveProfileLines}
};
export const EXPLOSIVE_HEAT_SENSITIVE = [${explosiveProfileList.map((profile) => profile.heatSensitive ? 1 : 0).join(', ')}];

export const MRP = {
${jsReactionProfileLines}
};
export const MATERIAL_REACTION_PROFILE_COUNT = ${reactionProfileList.length};

export const CHP = {
${jsContactHazardProfileLines}
};

export const HP = {
${jsHabitatProfileLines}
};

export const AP = {
${jsAmbienceProfileLines}
};

export const AMBIENCE_SAMPLE_FIELD = Object.freeze({
${jsAmbienceSampleFieldLines}
});
export const AMBIENCE_SAMPLE_STRIDE = ${ambienceSampleStride};

export const AMBIENCE_GROUP = {
${jsAmbienceGroupLines}
};
export const AMBIENCE_GROUP_COUNT = ${ambienceGroupEntries.length};
export const NO_AMBIENCE_GROUP = 255;
export const AMBIENCE_GROUP_MIXER = Object.freeze(${JSON.stringify(ambienceGroupMixer, null, 2)});
export const HABITAT_AQUATIC = [${habitatProfileList.map((profile) => profile.aquatic ? 1 : 0).join(', ')}];
export const AMBIENCE_PROFILE_GROUP = [${ambienceProfileList.map((profile) => profile.group === null ? 255 : ambienceGroups[profile.group].id).join(', ')}];

export const LMP = {
${jsLiquidProfileLines}
};

export const EP = {
${jsEmissionProfileLines}
};

export const LTP = {
${jsLightProfileLines}
};

export const RENDER_DETAIL_PATTERN = {
${jsRenderDetailPatternLines}
};
export const RDP = {
${jsRenderDetailProfileLines}
};

// How generic tools place the material. This is derived from kind through the
// schema's kindPlacementProfiles map, so a new FREE_RIGID cannot accidentally
// fall through to raw pixel painting.
export const MP = {
${jsPlacementLines}
};

// Behavior-flag bitmasks (mirrors C++ MF_* constants). OR together per material.
export const MF = {
${jsFlagLines}
};

// Mining tool classes + tiers (mirror C++ enum ToolClass / ToolTier).
export const TC = {
${jsToolClassLines}
};
export const TT = {
${jsToolTierLines}
};

// The material registry. Each entry fully distinguishes one material across the
// whole simulation AND the renderer.
export const MATERIALS = [
${jsMatLines}
];

// Sparse id lookup kept separate from the compact authoring/palette catalogue.
// Never index MATERIALS by id: stable ids may intentionally contain gaps.
export const MATERIAL_BY_ID = [${byId.map((m) => m ? `MATERIALS[${materials.indexOf(m)}]` : 'null').join(', ')}];
export const MAT_DEFINED = [${byId.map((m) => m ? 1 : 0).join(', ')}];
export const DEFINED_MATERIAL_IDS = [${materials.map((m) => m.id).join(', ')}];
export const isMaterialId = (value) => Number.isInteger(value)
  && value >= 0 && value < TABLE_SIZE && MAT_DEFINED[value] === 1;

// Flat lookup tables indexed by material id (empty slots = 0), mirroring the C++
// MAT_CLASS / MAT_FLAGS tables.
export const MAT_CLASS = [${jsArr((m) => materialClasses[m.materialClass])}];
export const MAT_FLAGS = [${jsArr(flagMask)}];
export const MAT_CRAFT_FLAGS = [${jsArr(craftingFlagMask)}];
export const MAT_TRANSPARENCY = [${jsArr((m) => m.transparency ?? 0)}];
export const MAT_RENDER_ANIM = [${jsArr((m) => renderAnims[m.renderAnim])}];
export const MAT_PLACEMENT = [${jsArr((m) => placementProfiles[kindPlacementProfiles[m.kind]])}];
export const MAT_GAS_PROFILE = [${jsArr((m) => gasProfiles[m.gasProfile ?? 'none'].id)}];
export const MAT_EXPLOSIVE_PROFILE = [${jsArr((m) => explosiveProfileFor(m).id)}];
export const MAT_HEAT_SENSITIVE_EXPLOSIVE = [${jsArr((m) => explosiveProfileFor(m).heatSensitive ? 1 : 0)}];
export const MAT_REACTION_PROFILE = [${jsArr((m) => reactionProfileFor(m).id)}];
export const MAT_LIQUID_PROFILE = [${jsArr((m) => liquidMovementProfiles[m.liquidMovementProfile ?? 'none'].id)}];
export const LIQUID_MOBILITY_GATED = [${liquidProfileList.map((p) => p.mobilityGated ? 1 : 0).join(', ')}];
export const LIQUID_STRAIGHT_FALL = [${liquidProfileList.map((p) => p.straightFallIgnoresMobility ? 1 : 0).join(', ')}];
export const LIQUID_FIXED_FALL_CAP = [${liquidProfileList.map((p) => p.fixedFallCap).join(', ')}];
export const GAS_DECAY = [${gasProfileList.map((p) => p.decay).join(', ')}];
export const GAS_TRAPPED_DECAY = [${gasProfileList.map((p) => p.trappedDecay).join(', ')}];
export const GAS_UP_CHANCE = [${gasProfileList.map((p) => p.upChance).join(', ')}];
export const GAS_SIDE_CHANCE = [${gasProfileList.map((p) => p.sideChance).join(', ')}];
export const GAS_PERSISTENT = [${gasProfileList.map((p) => p.persistent ? 1 : 0).join(', ')}];
export const GAS_CEILING_ROUTE = [${gasProfileList.map((p) => p.ceilingRoute ? 1 : 0).join(', ')}];
export const MAT_CONTACT_HAZARD_PROFILE = [${jsArr((m) => contactHazardProfiles[m.contactHazardProfile ?? 'none'].id)}];
export const CONTACT_HAZARD_PLAYER_DAMAGE = [${contactHazardProfileList.map((p) => p.playerDamage).join(', ')}];
export const CONTACT_HAZARD_CREATURE_DAMAGE = [${contactHazardProfileList.map((p) => p.creatureDamage).join(', ')}];
export const CONTACT_HAZARD_CADENCE = [${contactHazardProfileList.map((p) => p.cadence).join(', ')}];
export const CONTACT_HAZARD_PRIORITY = [${contactHazardProfileList.map((p) => p.priority).join(', ')}];
export const MAT_HABITAT_PROFILE = [${jsArr((m) => habitatProfileFor(m).id)}];
export const MAT_AQUATIC_HABITAT = [${jsArr((m) => habitatProfileFor(m).aquatic ? 1 : 0)}];
export const MAT_AMBIENCE_PROFILE = [${jsArr((m) => ambienceProfileFor(m).id)}];
export const MAT_AMBIENCE_GROUP = [${byId.map((m) => m ? ambienceGroupFor(m) : 255).join(', ')}];
export const MAT_EMISSION_PROFILE = [${jsArr((m) => emissionProfiles[m.emissionProfile ?? 'none'])}];
export const MAT_EMISSION = [${jsArr((m) => m.emission ?? 0)}];
export const MAT_RENDER_DETAIL_PROFILE = [${jsArr((m) => renderDetailProfiles[m.renderDetailProfile ?? 'none'].id)}];
export const MAT_LIGHT_PROFILE = [${jsArr((m) => lightProfileFor(m).id)}];
export const MAT_LIGHT_TRANSPARENT = [${jsArr((m) => lightProfileFor(m).transparent ? 1 : 0)}];
export const MAT_LIGHT_LOSS = [${jsArr((m) => lightProfileFor(m).loss)}];
export const MAT_FACE_LIT = [${jsArr((m) => lightProfileFor(m).faceLit ? 1 : 0)}];

// Flora identity/material mapping and creative-palette metadata share the same
// schema records as the C++ growth/component helpers.
export const NO_PLANT_SPECIES = 255;
export const PGR = Object.freeze(${JSON.stringify(Object.fromEntries(
  plantGrowthProfileList.map((profile) => [enumKey(profile.name), profile.id])))});
export const PWG = Object.freeze(${JSON.stringify(Object.fromEntries(
  plantWorldgenProfileList.map((profile) => [enumKey(profile.name), profile.id])))});
export const PLANT_GROWTH_PROFILES = Object.freeze(${JSON.stringify(plantGrowthProfileList, null, 2)});
export const PLANT_WORLDGEN_PROFILES = Object.freeze(${JSON.stringify(plantWorldgenProfileList, null, 2)});
export const PLANT_SPECIES = ${plantSpeciesJs};
export const PLANT_SEED_MATERIAL = [${plantSpeciesList.map((s) => materialByName.get(s.seedMaterial).id).join(', ')}];
export const PLANT_WOOD_MATERIAL = [${plantSpeciesList.map((s) => materialByName.get(s.woodMaterial).id).join(', ')}];
export const PLANT_LEAF_MATERIAL = [${plantSpeciesList.map((s) => materialByName.get(s.leafMaterial).id).join(', ')}];
export const MAT_PLANT_SPECIES = [${byId.map((m) => m ? encodedPlantSpecies(m) : 255).join(', ')}];
export const MAT_IS_PLANT_SEED = [${jsArr((m) => plantSpeciesList.some((s) => s.seedMaterial === m.name) ? 1 : 0)}];
export const MAT_PALETTE_HIDDEN = [${jsArr((m) => hiddenPaletteMaterials.has(m.name) ? 1 : 0)}];
export const PALETTE_MAIN_ORDER = ${JSON.stringify(palette.mainOrder)};
export const PALETTE_SECTIONS = ${JSON.stringify(palette.sections)};

// Mining gate tables: which tool class drops a material and the min tier required.
export const MAT_TOOLCLASS = [${jsArr((m) => toolClasses[m.toolClass])}];
export const MAT_TOOLTIER = [${jsArr((m) => m.toolTier)}];
export const TOOL_CLASS_SPEED = [${miningSpeed.classPercent.flat().join(', ')}];
export const TOOL_TIER_SPEED = [${miningSpeed.tierPercent.join(', ')}];
export const MINING_PROGRESS_DIVISOR = ${miningSpeed.progressDivisor};

// Animation-only packed ABGR colors the renderer swaps in per-frame.
${jsAnimLines}
`;

// ---------------- C++ ----------------
const cppEnumMat = materials.map((m) => `${m.name} = ${m.id}`).join(', ');
const cppEnumKind = Object.entries(kinds).map(([k, v]) => `K_${k} = ${v}`).join(', ');
const cppEnumClass = Object.entries(materialClasses).map(([k, v]) => `MC_${k.toUpperCase()} = ${v}`).join(', ');
const cppEnumRenderAnim = Object.entries(renderAnims).map(([k, v]) => `RA_${k.toUpperCase()} = ${v}`).join(', ');
const cppEnumGasProfile = Object.entries(gasProfiles).map(([k, v]) => `GP_${k.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()} = ${v.id}`).join(', ');
const cppEnumExplosiveProfile = Object.entries(explosiveProfiles)
  .map(([k, v]) => `XP_${enumKey(k)} = ${v.id}`).join(', ');
const cppEnumMaterialReactionProfile = Object.entries(reactionProfiles)
  .map(([k, v]) => `MRP_${enumKey(k)} = ${v.id}`).join(', ');
const cppEnumContactHazardProfile = Object.entries(contactHazardProfiles)
  .map(([k, v]) => `CHP_${enumKey(k)} = ${v.id}`).join(', ');
const cppEnumHabitatProfile = Object.entries(habitatProfiles)
  .map(([k, v]) => `HP_${enumKey(k)} = ${v.id}`).join(', ');
const cppEnumAmbienceSampleField = ambienceSampleFieldEntries
  .map(([k, v]) => `ASF_${enumKey(k)} = ${v}`).join(', ');
const cppEnumAmbienceProfile = Object.entries(ambienceProfiles)
  .map(([k, v]) => `AP_${enumKey(k)} = ${v.id}`).join(', ');
const cppEnumAmbienceGroup = ambienceGroupEntries
  .map(([k, v]) => `AG_${enumKey(k)} = ${v.id}`).join(', ');
const cppEnumLiquidProfile = Object.entries(liquidMovementProfiles).map(([k, v]) => `LMP_${enumKey(k)} = ${v.id}`).join(', ');
const cppEnumEmissionProfile = Object.entries(emissionProfiles).map(([k, v]) => `EP_${enumKey(k)} = ${v}`).join(', ');
const cppEnumLightProfile = Object.entries(lightTransmissionProfiles).map(([k, v]) => `LTP_${enumKey(k)} = ${v.id}`).join(', ');
const cppEnumRenderDetailPattern = Object.entries(renderDetailPatterns).map(([k, v]) => `RDPAT_${enumKey(k)} = ${v}`).join(', ');
const cppEnumRenderDetailProfile = Object.entries(renderDetailProfiles).map(([k, v]) => `RDP_${enumKey(k)} = ${v.id}`).join(', ');
const cppEnumPlantType = plantSpeciesList.map((species) => `PT_${species.name} = ${species.id}`).join(', ');
const cppEnumPlantGrowthProfile = plantGrowthProfileList
  .map((profile) => `PGR_${enumKey(profile.name)} = ${profile.id}`).join(', ');
const cppEnumPlantWorldgenProfile = plantWorldgenProfileList
  .map((profile) => `PWG_${enumKey(profile.name)} = ${profile.id}`).join(', ');
const cppEnumPlantWoodTopology = Object.entries(plantWoodTopologies)
  .map(([name, id]) => `PGW_${enumKey(name)} = ${id}`).join(', ');
const cppEnumPlantLeafTopology = Object.entries(plantLeafTopologies)
  .map(([name, id]) => `PGL_${enumKey(name)} = ${id}`).join(', ');
const cppEnumPlantTrunkProfile = Object.entries(plantTrunkProfiles)
  .map(([name, id]) => `PGT_${enumKey(name)} = ${id}`).join(', ');
const cppEnumPlantLeafBurstProfile = Object.entries(plantLeafBurstProfiles)
  .map(([name, id]) => `PGB_${enumKey(name)} = ${id}`).join(', ');
const cppEnumPlantWorldgenTopology = Object.entries(plantWorldgenTopologies)
  .map(([name, id]) => `PWGT_${enumKey(name)} = ${id}`).join(', ');
const cppBool = (value) => value ? 'true' : 'false';
const cppFloat = (value) => Number.isInteger(value) ? value : `${value}f`;
const cppDouble = (value) => `${value}`;
const cppPlantGrowthProfiles = plantGrowthProfileList.map((profile) => `{
  PGR_${enumKey(profile.name)}, PGW_${enumKey(profile.woodTopology)},
  PGL_${enumKey(profile.leafTopology)}, PGT_${enumKey(profile.trunkProfile)},
  PGB_${enumKey(profile.leafBurst)},
  ${profile.maxWoodBase}, ${profile.maxWoodVariation},
  ${profile.maxLeafBase}, ${profile.maxLeafVariation}, ${profile.leafStart},
  ${profile.thickenHeight}, ${profile.wideBaseHeight},
  ${cppBool(profile.straight)}, ${cppBool(profile.leaves)},
  ${cppBool(profile.variedTree)}, ${cppBool(profile.finishStemFirst)},
  ${cppBool(profile.extraWood)}, ${cppBool(profile.gravityRecovery)},
  ${profile.variedTree ? cppDouble(profile.woodLeafChance) : cppFloat(profile.woodLeafChance)},
  ${cppDouble(profile.vineBerriesChance)},
  ${cppDouble(profile.foliageAlongsideWoodChance)},
  ${cppFloat(profile.oppositeChance)}, ${cppFloat(profile.wideBaseChance)}
}`).join(',\n');
const cppPlantWorldgenProfiles = plantWorldgenProfileList.map((profile) =>
  `{ PWG_${enumKey(profile.name)}, PWGT_${enumKey(profile.topology)}, ${profile.heightBase}, ${profile.heightVariation}, ${profile.horizontalReach}, ${profile.upwardReach} }`).join(',\n');
const maxPlantWorldgenHorizontalReach = Math.max(
  ...plantWorldgenProfileList.map((profile) => profile.horizontalReach));
const maxPlantWorldgenUpwardReach = Math.max(
  ...plantWorldgenProfileList.map((profile) => profile.upwardReach));
const cppEnumPlacement = Object.entries(placementProfiles).map(([k, v]) => `MP_${k.toUpperCase()} = ${v}`).join(', ');
const col = (pick, fmt = (v) => v) => {
  const out = [];
  for (let i = 0; i < tableSize; i++) out.push(fmt(byId[i] ? pick(byId[i]) : null));
  return out.join(', ');
};
const fnum = (v) => (v === null ? '0' : (Number.isInteger(v) ? v : `${v}f`));
const u8 = (v) => (v === null ? '0' : v);
const plantSpeciesId = (v) => (v === null ? '255' : v);
const kindVal = (m) => (m === null ? 'K_NONE' : `K_${m.kind}`);
const classVal = (m) => (m === null ? 'MC_NONE' : `MC_${m.materialClass.toUpperCase()}`);
const hexColor = (m) => (m === null ? '0x00000000u' : `${m.color}u`);
const cppAnimLines = animKeys.map((k) => `static const uint32_t ${k} = ${animColors[k]}u;`).join('\n');
const cppFlagConsts = Object.entries(flagBits).map(([k, v]) => `static const uint32_t MF_${k.toUpperCase()} = 1u << ${v};`).join('\n');
const cppEnumToolClass = Object.entries(toolClasses).map(([k, v]) => `TC_${k.toUpperCase()} = ${v}`).join(', ');
const cppEnumToolTier = Object.entries(toolTiers).map(([k, v]) => `TT_${k.toUpperCase()} = ${v}`).join(', ');
const hpp = `#pragma once
${BANNER('C++ header')}
enum Mat : uint8_t { ${cppEnumMat} };
enum Kind : uint8_t { ${cppEnumKind} };
enum MaterialClass : uint8_t { ${cppEnumClass} };
enum RenderAnim : uint8_t { ${cppEnumRenderAnim} };
enum GasProfile : uint8_t { ${cppEnumGasProfile} };
enum ExplosiveProfile : uint8_t { ${cppEnumExplosiveProfile} };
enum MaterialReactionProfile : uint8_t { ${cppEnumMaterialReactionProfile} };
enum ContactHazardProfile : uint8_t { ${cppEnumContactHazardProfile} };
enum HabitatProfile : uint8_t { ${cppEnumHabitatProfile} };
enum AmbienceSampleField : uint8_t { ${cppEnumAmbienceSampleField} };
enum AmbienceProfile : uint8_t { ${cppEnumAmbienceProfile} };
enum AmbienceGroup : uint8_t { ${cppEnumAmbienceGroup} };
enum LiquidMovementProfile : uint8_t { ${cppEnumLiquidProfile} };
enum EmissionProfile : uint8_t { ${cppEnumEmissionProfile} };
enum LightTransmissionProfile : uint8_t { ${cppEnumLightProfile} };
enum RenderDetailPattern : uint8_t { ${cppEnumRenderDetailPattern} };
enum RenderDetailProfile : uint8_t { ${cppEnumRenderDetailProfile} };
enum MaterialPlacement : uint8_t { ${cppEnumPlacement} };
enum PlantType : uint8_t { ${cppEnumPlantType} };
enum PlantGrowthProfile : uint8_t { ${cppEnumPlantGrowthProfile} };
enum PlantWorldgenProfile : uint8_t { ${cppEnumPlantWorldgenProfile} };
enum PlantWoodGrowthTopology : uint8_t { ${cppEnumPlantWoodTopology} };
enum PlantLeafGrowthTopology : uint8_t { ${cppEnumPlantLeafTopology} };
enum PlantTrunkGrowthProfile : uint8_t { ${cppEnumPlantTrunkProfile} };
enum PlantLeafBurstProfile : uint8_t { ${cppEnumPlantLeafBurstProfile} };
enum PlantWorldgenTopology : uint8_t { ${cppEnumPlantWorldgenTopology} };
// Mining tool classes + tiers (drives MAT_TOOLCLASS / MAT_TOOLTIER drop gating).
enum ToolClass : uint8_t { ${cppEnumToolClass} };
enum ToolTier : uint8_t { ${cppEnumToolTier} };
// Behavior-flag bits packed into MAT_FLAGS[]. Predicates AND against these.
${cppFlagConsts}

static const int MATERIAL_COUNT = ${materials.length};
static const int MATERIAL_ID_LIMIT = ${materialIdLimit};
static const int FIRST_UNDEFINED_MATERIAL_ID = ${firstUndefinedMaterialId};
static const int TABLE = ${tableSize};
static constexpr uint8_t MAT_DEFINED[TABLE] = {${col(() => 1, u8)}};
static constexpr uint8_t DEFINED_MATERIAL_IDS[MATERIAL_COUNT] = {${materials.map((m) => m.id).join(', ')}};
static constexpr bool isMaterialId(int material) {
  return material >= 0 && material < TABLE && MAT_DEFINED[material] != 0;
}
static const float    DENSITY[TABLE]        = {${col((m) => m.density, fnum)}};
static const uint8_t  DENSITY_SORTED[TABLE] = {${col((m) => (m.looseSorted ? 1 : 0), u8)}};
static const float    MOBILITY[TABLE]       = {${col((m) => m.mobility, fnum)}};
static constexpr uint8_t MAT_KIND[TABLE]    = {${materials.length ? col((m) => m, kindVal) : ''}};
// Broad gameplay class and trait flags per material.
static const uint8_t  MAT_CLASS[TABLE]      = {${materials.length ? col((m) => m, classVal) : ''}};
static constexpr uint32_t MAT_FLAGS[TABLE]      = {${col((m) => flagMask(m), u8)}};
static constexpr uint32_t MAT_CRAFT_FLAGS[TABLE]= {${col((m) => craftingFlagMask(m), u8)}};
static constexpr uint8_t MAT_PLACEMENT[TABLE] = {${col((m) => placementProfiles[kindPlacementProfiles[m.kind]], u8)}};
static const uint8_t  MAT_GAS_PROFILE[TABLE]= {${col((m) => gasProfiles[m.gasProfile ?? 'none'].id, u8)}};
static constexpr uint8_t MAT_EXPLOSIVE_PROFILE[TABLE] = {${col((m) => explosiveProfileFor(m).id, u8)}};
static constexpr uint8_t EXPLOSIVE_HEAT_SENSITIVE[${explosiveProfileList.length}] = {${explosiveProfileList.map((profile) => profile.heatSensitive ? 1 : 0).join(', ')}};
static constexpr uint8_t MAT_HEAT_SENSITIVE_EXPLOSIVE[TABLE] = {${col((m) => explosiveProfileFor(m).heatSensitive ? 1 : 0, u8)}};
static constexpr int MATERIAL_REACTION_PROFILE_COUNT = ${reactionProfileList.length};
static constexpr uint8_t MAT_REACTION_PROFILE[TABLE] = {${col((m) => reactionProfileFor(m).id, u8)}};
static constexpr uint8_t MAT_CONTACT_HAZARD_PROFILE[TABLE] = {${col((m) => contactHazardProfiles[m.contactHazardProfile ?? 'none'].id, u8)}};
static constexpr uint8_t MAT_HABITAT_PROFILE[TABLE] = {${col((m) => habitatProfileFor(m).id, u8)}};
static constexpr uint8_t HABITAT_AQUATIC[${habitatProfileList.length}] = {${habitatProfileList.map((profile) => profile.aquatic ? 1 : 0).join(', ')}};
static constexpr uint8_t MAT_AQUATIC_HABITAT[TABLE] = {${col((m) => habitatProfileFor(m).aquatic ? 1 : 0, u8)}};
static constexpr int AMBIENCE_SAMPLE_STRIDE = ${ambienceSampleStride};
static constexpr uint8_t NO_AMBIENCE_GROUP = 255;
static constexpr int AMBIENCE_GROUP_COUNT = ${ambienceGroupEntries.length};
static constexpr uint8_t MAT_AMBIENCE_PROFILE[TABLE] = {${col((m) => ambienceProfileFor(m).id, u8)}};
static constexpr uint8_t AMBIENCE_PROFILE_GROUP[${ambienceProfileList.length}] = {${ambienceProfileList.map((profile) => profile.group === null ? 255 : ambienceGroups[profile.group].id).join(', ')}};
static constexpr uint8_t MAT_AMBIENCE_GROUP[TABLE] = {${col(ambienceGroupFor, (v) => v === null ? 255 : v)}};
static const uint8_t  MAT_LIQUID_PROFILE[TABLE]= {${col((m) => liquidMovementProfiles[m.liquidMovementProfile ?? 'none'].id, u8)}};
static const uint8_t LIQUID_MOBILITY_GATED[${liquidProfileList.length}] = {${liquidProfileList.map((p) => p.mobilityGated ? 1 : 0).join(', ')}};
static const uint8_t LIQUID_STRAIGHT_FALL[${liquidProfileList.length}] = {${liquidProfileList.map((p) => p.straightFallIgnoresMobility ? 1 : 0).join(', ')}};
static const uint8_t LIQUID_FIXED_FALL_CAP[${liquidProfileList.length}] = {${liquidProfileList.map((p) => p.fixedFallCap).join(', ')}};
static const float GAS_DECAY[${gasProfileList.length}] = {${gasProfileList.map((p) => fnum(p.decay)).join(', ')}};
static const float GAS_TRAPPED_DECAY[${gasProfileList.length}] = {${gasProfileList.map((p) => fnum(p.trappedDecay)).join(', ')}};
static const float GAS_UP_CHANCE[${gasProfileList.length}] = {${gasProfileList.map((p) => fnum(p.upChance)).join(', ')}};
static const float GAS_SIDE_CHANCE[${gasProfileList.length}] = {${gasProfileList.map((p) => fnum(p.sideChance)).join(', ')}};
static const uint8_t GAS_PERSISTENT[${gasProfileList.length}] = {${gasProfileList.map((p) => p.persistent ? 1 : 0).join(', ')}};
static const uint8_t GAS_CEILING_ROUTE[${gasProfileList.length}] = {${gasProfileList.map((p) => p.ceilingRoute ? 1 : 0).join(', ')}};
static constexpr uint8_t CONTACT_HAZARD_PLAYER_DAMAGE[${contactHazardProfileList.length}] = {${contactHazardProfileList.map((p) => p.playerDamage).join(', ')}};
static constexpr uint8_t CONTACT_HAZARD_CREATURE_DAMAGE[${contactHazardProfileList.length}] = {${contactHazardProfileList.map((p) => p.creatureDamage).join(', ')}};
static constexpr uint8_t CONTACT_HAZARD_CADENCE[${contactHazardProfileList.length}] = {${contactHazardProfileList.map((p) => p.cadence).join(', ')}};
static constexpr uint8_t CONTACT_HAZARD_PRIORITY[${contactHazardProfileList.length}] = {${contactHazardProfileList.map((p) => p.priority).join(', ')}};
static const uint8_t MAT_EMISSION_PROFILE[TABLE] = {${col((m) => emissionProfiles[m.emissionProfile ?? 'none'], u8)}};
static const uint8_t MAT_RENDER_DETAIL_PROFILE[TABLE] = {${col((m) => renderDetailProfiles[m.renderDetailProfile ?? 'none'].id, u8)}};
static const uint8_t RENDER_DETAIL_PATTERN[${renderDetailProfileList.length}] = {${renderDetailProfileList.map((p) => renderDetailPatterns[p.pattern]).join(', ')}};
static const uint8_t RENDER_DETAIL_MASK[${renderDetailProfileList.length}] = {${renderDetailProfileList.map((p) => p.mask).join(', ')}};
static const uint8_t RENDER_DETAIL_MATCH[${renderDetailProfileList.length}] = {${renderDetailProfileList.map((p) => p.match).join(', ')}};
static const uint32_t RENDER_DETAIL_COLOR[${renderDetailProfileList.length}] = {${renderDetailProfileList.map((p) => p.color === null ? '0u' : `${animColors[p.color]}u`).join(', ')}};
static const uint8_t MAT_LIGHT_PROFILE[TABLE] = {${col((m) => lightProfileFor(m).id, u8)}};
static const uint8_t MAT_LIGHT_TRANSPARENT[TABLE] = {${col((m) => lightProfileFor(m).transparent ? 1 : 0, u8)}};
static const uint8_t MAT_LIGHT_LOSS[TABLE] = {${col((m) => lightProfileFor(m).loss, u8)}};
static const uint8_t MAT_FACE_LIT[TABLE] = {${col((m) => lightProfileFor(m).faceLit ? 1 : 0, u8)}};
static const uint8_t NO_PLANT_SPECIES = 255;
static const int PLANT_SPECIES_COUNT = ${plantSpeciesList.length};
static constexpr bool isPlantSpeciesId(int species) {
  return species >= 0 && species < PLANT_SPECIES_COUNT;
}
static const int PLANT_GROWTH_PROFILE_COUNT = ${plantGrowthProfileList.length};
static const int PLANT_WORLDGEN_PROFILE_COUNT = ${plantWorldgenProfileList.length};
struct PlantGrowthProfileDef {
  PlantGrowthProfile profile;
  PlantWoodGrowthTopology woodTopology;
  PlantLeafGrowthTopology leafTopology;
  PlantTrunkGrowthProfile trunkProfile;
  PlantLeafBurstProfile leafBurst;
  uint16_t maxWoodBase, maxWoodVariation;
  uint16_t maxLeafBase, maxLeafVariation, leafStart;
  uint16_t thickenHeight, wideBaseHeight;
  bool straight, leaves, variedTree, finishStemFirst;
  bool extraWood, gravityRecovery;
  double woodLeafChance, vineBerriesChance;
  double foliageAlongsideWoodChance;
  float oppositeChance, wideBaseChance;
};
struct PlantWorldgenProfileDef {
  PlantWorldgenProfile profile;
  PlantWorldgenTopology topology;
  uint8_t heightBase, heightVariation;
  uint8_t horizontalReach, upwardReach;
};
static constexpr PlantGrowthProfileDef PLANT_GROWTH_PROFILES[PLANT_GROWTH_PROFILE_COUNT] = {
${cppPlantGrowthProfiles}
};
static constexpr PlantWorldgenProfileDef PLANT_WORLDGEN_PROFILES[PLANT_WORLDGEN_PROFILE_COUNT] = {
${cppPlantWorldgenProfiles}
};
static constexpr int PLANT_WORLDGEN_MAX_HORIZONTAL_REACH = ${maxPlantWorldgenHorizontalReach};
static constexpr int PLANT_WORLDGEN_MAX_UPWARD_REACH = ${maxPlantWorldgenUpwardReach};
static constexpr PlantGrowthProfile PLANT_GROWTH_PROFILE_BY_SPECIES[PLANT_SPECIES_COUNT] = {${plantSpeciesList.map((species) => `PGR_${enumKey(species.growthProfile)}`).join(', ')}};
static constexpr PlantWorldgenProfile PLANT_WORLDGEN_PROFILE_BY_SPECIES[PLANT_SPECIES_COUNT] = {${plantSpeciesList.map((species) => `PWG_${enumKey(species.worldgenProfile)}`).join(', ')}};
static constexpr bool plantGrowthProfilesComplete() {
  for (int i = 0; i < PLANT_GROWTH_PROFILE_COUNT; i++)
    if ((int)PLANT_GROWTH_PROFILES[i].profile != i) return false;
  return true;
}
static constexpr bool plantWorldgenProfilesComplete() {
  for (int i = 0; i < PLANT_WORLDGEN_PROFILE_COUNT; i++)
    if ((int)PLANT_WORLDGEN_PROFILES[i].profile != i) return false;
  return true;
}
static_assert(plantGrowthProfilesComplete(),
              "Plant growth profiles must be dense and ordered by stable id");
static_assert(plantWorldgenProfilesComplete(),
              "Plant worldgen profiles must be dense and ordered by stable id");
static inline const PlantGrowthProfileDef& plantGrowthProfileForSpecies(
    uint8_t species) {
  return PLANT_GROWTH_PROFILES[PLANT_GROWTH_PROFILE_BY_SPECIES[species]];
}
static inline const PlantWorldgenProfileDef& plantWorldgenProfileForSpecies(
    uint8_t species) {
  return PLANT_WORLDGEN_PROFILES[PLANT_WORLDGEN_PROFILE_BY_SPECIES[species]];
}
static const uint8_t PLANT_SEED_MATERIAL[PLANT_SPECIES_COUNT] = {${plantSpeciesList.map((s) => materialByName.get(s.seedMaterial).id).join(', ')}};
static const uint8_t PLANT_WOOD_MATERIAL[PLANT_SPECIES_COUNT] = {${plantSpeciesList.map((s) => materialByName.get(s.woodMaterial).id).join(', ')}};
static const uint8_t PLANT_LEAF_MATERIAL[PLANT_SPECIES_COUNT] = {${plantSpeciesList.map((s) => materialByName.get(s.leafMaterial).id).join(', ')}};
static const uint8_t MAT_PLANT_SPECIES[TABLE] = {${col((m) => encodedPlantSpecies(m), plantSpeciesId)}};
static const uint8_t MAT_IS_PLANT_SEED[TABLE] = {${col((m) => plantSpeciesList.some((s) => s.seedMaterial === m.name) ? 1 : 0, u8)}};
static const uint8_t MAT_PALETTE_HIDDEN[TABLE] = {${col((m) => hiddenPaletteMaterials.has(m.name) ? 1 : 0, u8)}};
// Render transparency: 0 = opaque, 1 = invisible. Packed color alpha is ignored.
static const float    MAT_TRANSPARENCY[TABLE]= {${col((m) => m.transparency ?? 0, fnum)}};
// Mining gate: which tool class drops a material + the min tier required.
static const uint8_t  MAT_TOOLCLASS[TABLE]  = {${col((m) => toolClasses[m.toolClass], u8)}};
static const uint8_t  MAT_TOOLTIER[TABLE]   = {${col((m) => m.toolTier, u8)}};
// Mining speed percentages: held-class x preferred-class matrix, then held tier.
static const int TOOL_CLASS_COUNT = ${toolClassCount};
static const int TOOL_TIER_COUNT = ${toolTierCount};
static constexpr bool isToolClassId(int toolClass) {
  return toolClass >= 0 && toolClass < TOOL_CLASS_COUNT;
}
static constexpr bool isToolTierId(int toolTier) {
  return toolTier >= 0 && toolTier < TOOL_TIER_COUNT;
}
static const uint8_t  TOOL_CLASS_SPEED[${toolClassCount * toolClassCount}] = {${miningSpeed.classPercent.flat().join(', ')}};
static const uint8_t  TOOL_TIER_SPEED[${toolTierCount}] = {${miningSpeed.tierPercent.join(', ')}};
static const int MINING_PROGRESS_DIVISOR = ${miningSpeed.progressDivisor};
// Renderer lookup tables.
static const uint32_t MAT_COLOR[TABLE]      = {${col((m) => m, hexColor)}};
static const uint8_t  MAT_TEXTURE_AMP[TABLE]= {${col((m) => m.textureAmp ?? 0, u8)}};
static const uint8_t  MAT_RENDER_ANIM[TABLE] = {${col((m) => renderAnims[m.renderAnim], u8)}};
static const uint8_t  DURABILITY[TABLE]     = {${col((m) => m.durability ?? 0, u8)}};
// Baseline light emission per material (0 = dark); MAT_EMISSION_PROFILE selects
// any positional emission pattern in Renderer::emissionForCell.
static const uint8_t  MAT_EMISSION[TABLE]   = {${col((m) => m.emission ?? 0, u8)}};
${cppAnimLines}
`;

// ---------------- emit / check ----------------
const check = process.argv.includes('--check');
const outputs = [[jsPath, js], [hppPath, hpp]];
let stale = false;
for (const [path, content] of outputs) {
  if (check) {
    let cur = '';
    try { cur = readFileSync(path, 'utf8'); } catch { /* missing */ }
    if (cur !== content) { stale = true; console.error(`stale: ${path}`); }
  } else {
    writeFileSync(path, content);
    console.log(`wrote ${path}`);
  }
}
if (check && stale) { console.error('Generated material files are stale. Run `npm run generate`.'); process.exit(1); }
if (check) console.log('generated material files are up to date');
