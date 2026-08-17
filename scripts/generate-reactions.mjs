// Generates fixed C++/JS reaction plans from the declarative reaction schema.
//
//   node scripts/generate-reactions.mjs
//   node scripts/generate-reactions.mjs --check

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readSchemaJson } from './schema-json.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = process.env.SAND_REACTION_SCHEMA_PATH
  ? resolve(process.env.SAND_REACTION_SCHEMA_PATH)
  : resolve(root, 'src/sand/reactions.schema.json');
const materialsPath = process.env.SAND_REACTION_MATERIALS_PATH
  ? resolve(process.env.SAND_REACTION_MATERIALS_PATH)
  : resolve(root, 'src/sand/materials.schema.json');
const hppPath = process.env.SAND_REACTION_HPP_PATH
  ? resolve(process.env.SAND_REACTION_HPP_PATH)
  : resolve(root, 'src/sand/cpp/engine/reactions.generated.hpp');
const stateHppPath = process.env.SAND_REACTION_STATE_HPP_PATH
  ? resolve(process.env.SAND_REACTION_STATE_HPP_PATH)
  : resolve(root, 'src/sand/cpp/engine/reaction_state.generated.hpp');
const jsPath = process.env.SAND_REACTION_JS_PATH
  ? resolve(process.env.SAND_REACTION_JS_PATH)
  : resolve(root, 'src/sand/wasmBridge/reactions.generated.js');

const schema = readSchemaJson(schemaPath);
const materialsSchema = readSchemaJson(materialsPath);
if (schema.version !== 1) throw new Error('reactions.schema version must be 1');

const materialByName = new Map(materialsSchema.materials.map((material) => [material.name, material]));
const materialClasses = materialsSchema.materialClasses ?? {};
const materialFlags = materialsSchema.flags ?? {};
const reactionProfiles = materialsSchema.reactionProfiles ?? {};
const kinds = materialsSchema.kinds ?? {};
const placementByKind = Object.fromEntries(Object.entries(materialsSchema.kindPlacementProfiles ?? {})
  .map(([kind, profile]) => [kind, materialsSchema.placementProfiles?.[profile]]));
const tableSize = materialsSchema.tableSize;
if (!Number.isInteger(tableSize) || tableSize < 1 || tableSize > 256)
  throw new Error('materials tableSize must be in 1..256');

const TOPOLOGY = { loose: 1, component: 2, body: 4, any: 7 };
const MATCH = { any: 'ReactionMatchKind::ANY', material: 'ReactionMatchKind::MATERIAL', flag: 'ReactionMatchKind::FLAG', materialClass: 'ReactionMatchKind::CLASS', reactionProfile: 'ReactionMatchKind::PROFILE' };
const TRIGGER = { self: 'ReactionTriggerKind::SELF', contact: 'ReactionTriggerKind::CONTACT', target: 'ReactionTriggerKind::TARGET', layerOverlap: 'ReactionTriggerKind::LAYER_OVERLAP', bodyContact: 'ReactionTriggerKind::BODY_CONTACT' };
const DIRECTION = { self: 'ReactionDirection::SELF', cardinal: 'ReactionDirection::CARDINAL', above: 'ReactionDirection::ABOVE', below: 'ReactionDirection::BELOW', left: 'ReactionDirection::LEFT', right: 'ReactionDirection::RIGHT', overlap: 'ReactionDirection::OVERLAP' };
const LAYER = { current: 'ReactionLayerPolicy::CURRENT_LAYER', overlap: 'ReactionLayerPolicy::LAYER_OVERLAP' };
const OP = { replace: 'ReactionEffectOp::REPLACE', place: 'ReactionEffectOp::PLACE', remove: 'ReactionEffectOp::REMOVE', spawnBody: 'ReactionEffectOp::SPAWN_BODY', detach: 'ReactionEffectOp::DETACH', applyImpulse: 'ReactionEffectOp::APPLY_IMPULSE' };
const SUBJECT = { source: 'ReactionSubjectSlot::SOURCE', target: 'ReactionSubjectSlot::TARGET' };
const POLICY = { auto: 'ReactionTopologyPolicy::AUTO', preserveOwner: 'ReactionTopologyPolicy::PRESERVE_OWNER', static: 'ReactionTopologyPolicy::STATIC', body: 'ReactionTopologyPolicy::BODY' };
const SCOPE = { cell: 'ReactionEffectScope::CELL', owner: 'ReactionEffectScope::OWNER' };
const SHAPE = { none: 'ReactionBodyShape::NONE', singleCell: 'ReactionBodyShape::SINGLE_CELL', disc: 'ReactionBodyShape::DISC', box: 'ReactionBodyShape::BOX' };

const enumSymbol = (prefix, name) => `${prefix}_${name.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
const stableHash = (value) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 1;
};
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const cppFloat = (value) => Number.isInteger(value) ? `${value}.0f` : `${value}f`;
const cppDouble = (value) => Number.isInteger(value) ? `${value}.0` : `${value}`;
const cppString = (value) => JSON.stringify(value);

function assertKeys(value, allowed, label) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`${label} has unknown field ${key}`);
}

assertKeys(schema, ['$comment', 'version', 'rules', 'fixtures'], 'reactions.schema');
if (!Array.isArray(schema.rules) || !Array.isArray(schema.fixtures ?? []))
  throw new Error('reactions.schema rules and fixtures must be arrays');

function materialSymbol(name, label) {
  if (!materialByName.has(name)) throw new Error(`${label} references unknown material ${name}`);
  return name;
}

function selector(raw, label, allowAny = false) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error(`${label} must be an object`);
  assertKeys(raw, [
    'material', 'flag', 'materialClass', 'reactionProfile', 'anyOf', 'topology',
  ], label);
  const keys = ['material', 'flag', 'materialClass', 'reactionProfile', 'anyOf']
    .filter((key) => raw[key] !== undefined);
  if (keys.length === 0 && !allowAny) throw new Error(`${label} needs one selector`);
  if (keys.length > 1) throw new Error(`${label} must use exactly one selector`);
  const topology = raw.topology ?? 'any';
  if (!(topology in TOPOLOGY)) throw new Error(`${label}.topology is unknown: ${topology}`);
  if (keys[0] === 'anyOf') {
    if (!Array.isArray(raw.anyOf) || raw.anyOf.length < 2 || raw.anyOf.length > 16)
      throw new Error(`${label}.anyOf must contain 2..16 selectors`);
    const alternatives = raw.anyOf.map((entry, index) => {
      if (entry?.topology !== undefined)
        throw new Error(`${label}.anyOf[${index}] topology belongs on the union`);
      return selector(entry, `${label}.anyOf[${index}]`);
    });
    return {
      kind: 'anyOf', cppKind: MATCH.any, value: '0',
      jsValue: alternatives.map(({ kind, jsValue }) => ({ match: kind, value: jsValue })),
      topology, topologyMask: TOPOLOGY[topology], alternatives,
    };
  }
  let kind = 'any', value = '0', jsValue = null;
  if (keys.length) {
    kind = keys[0];
    const selected = raw[kind];
    if (typeof selected !== 'string' || !selected)
      throw new Error(`${label}.${kind} must be a non-empty string`);
    jsValue = selected;
    if (kind === 'material') value = materialSymbol(selected, label);
    else if (kind === 'flag') {
      if (!(selected in materialFlags)) throw new Error(`${label} references unknown flag ${selected}`);
      value = enumSymbol('MF', selected);
    } else if (kind === 'materialClass') {
      if (!(selected in materialClasses)) throw new Error(`${label} references unknown materialClass ${selected}`);
      value = enumSymbol('MC', selected);
    } else {
      if (!(selected in reactionProfiles) || reactionProfiles[selected].id === 0)
        throw new Error(`${label} references unknown/none reactionProfile ${selected}`);
      value = enumSymbol('MRP', selected);
    }
  }
  return { kind, cppKind: MATCH[kind], value, jsValue, topology, topologyMask: TOPOLOGY[topology] };
}

function selectorMaterials(compiled) {
  if (compiled.kind === 'anyOf') {
    const ids = new Set(compiled.alternatives.flatMap((alternative) =>
      selectorMaterials(alternative).map((material) => material.id)));
    return materialsSchema.materials.filter((material) => ids.has(material.id));
  }
  return materialsSchema.materials.filter((material) => {
    if (compiled.kind === 'any') return true;
    if (compiled.kind === 'material') return material.name === compiled.jsValue;
    if (compiled.kind === 'flag') return material.flags?.includes(compiled.jsValue);
    if (compiled.kind === 'materialClass') return material.materialClass === compiled.jsValue;
    return (material.reactionProfile ?? 'none') === compiled.jsValue;
  });
}

function compileEffect(raw, label) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !(raw.op in OP))
    throw new Error(`${label}.op is unknown`);
  assertKeys(raw, [
    'op', 'subject', 'scope', 'topology', 'material', 'shape', 'radius',
    'halfWidth', 'halfHeight', 'impulse',
  ], label);
  const subject = raw.subject ?? 'target';
  if (!(subject in SUBJECT)) throw new Error(`${label}.subject is unknown: ${subject}`);
  const scope = raw.scope ?? 'cell';
  if (!(scope in SCOPE)) throw new Error(`${label}.scope is unknown: ${scope}`);
  const topology = raw.topology ?? 'auto';
  if (!(topology in POLICY)) throw new Error(`${label}.topology is unknown: ${topology}`);
  const shape = raw.shape
    ?? (raw.op === 'spawnBody' || topology === 'body' ? 'singleCell' : 'none');
  if (!(shape in SHAPE)) throw new Error(`${label}.shape is unknown: ${shape}`);
  const radius = raw.radius ?? 0;
  if (!integer(radius, 0, 32)) throw new Error(`${label}.radius must be an integer in 0..32`);
  const halfWidth = raw.halfWidth ?? 0;
  const halfHeight = raw.halfHeight ?? 0;
  if (!integer(halfWidth, 0, 32) || !integer(halfHeight, 0, 32))
    throw new Error(`${label} body half extents must be integers in 0..32`);
  if (raw.impulse !== undefined
      && (!raw.impulse || typeof raw.impulse !== 'object'
          || Array.isArray(raw.impulse)))
    throw new Error(`${label}.impulse must be an object`);
  if (raw.impulse) assertKeys(raw.impulse, ['x', 'y', 'normal'], `${label}.impulse`);
  const impulseX = raw.impulse?.x ?? 0;
  const impulseY = raw.impulse?.y ?? 0;
  const impulseNormal = raw.impulse?.normal ?? 0;
  if (!finite(impulseX) || !finite(impulseY) || !finite(impulseNormal))
    throw new Error(`${label}.impulse must be finite`);
  const needsMaterial = raw.op === 'replace' || raw.op === 'place' || raw.op === 'spawnBody';
  if (needsMaterial !== (raw.material !== undefined))
    throw new Error(`${label} ${needsMaterial ? 'requires' : 'cannot declare'} material`);
  const material = needsMaterial ? materialSymbol(raw.material, label) : 'EMPTY';
  const materialRecord = materialByName.get(raw.material);
  if (raw.op === 'spawnBody' && placementByKind[materialRecord.kind] !== materialsSchema.placementProfiles.structure)
    throw new Error(`${label} spawnBody material must use structural placement`);
  if (topology === 'static' && (!materialRecord || materialRecord.kind !== 'COMPONENT'))
    throw new Error(`${label} static placement requires a COMPONENT material`);
  if (topology === 'body'
      && (!materialRecord
          || placementByKind[materialRecord.kind] !== materialsSchema.placementProfiles.structure))
    throw new Error(`${label} body placement requires a structural material`);
  if (topology === 'preserveOwner'
      && (!materialRecord
          || placementByKind[materialRecord.kind] !== materialsSchema.placementProfiles.structure))
    throw new Error(`${label} preserveOwner requires a structural material`);
  const createsBody = raw.op === 'spawnBody' || topology === 'body';
  if (!createsBody && shape !== 'none')
    throw new Error(`${label}.shape is only valid for body creation`);
  if ((!createsBody || shape === 'singleCell')
      && (radius !== 0 || halfWidth !== 0 || halfHeight !== 0))
    throw new Error(`${label} single-cell/non-body effects cannot declare dimensions`);
  if (shape === 'disc'
      && (radius === 0 || halfWidth !== 0 || halfHeight !== 0))
    throw new Error(`${label} disc requires only a positive radius`);
  if (shape === 'box'
      && (radius !== 0 || halfWidth === 0 || halfHeight === 0))
    throw new Error(`${label} box requires positive halfWidth and halfHeight`);
  if (raw.op !== 'applyImpulse'
      && (impulseX !== 0 || impulseY !== 0 || impulseNormal !== 0))
    throw new Error(`${label}.impulse is only valid for applyImpulse`);
  if (raw.op === 'applyImpulse'
      && impulseX === 0 && impulseY === 0 && impulseNormal === 0)
    throw new Error(`${label}.impulse must contain a non-zero component`);
  return {
    op: raw.op, subject, scope, topology, material, shape, radius,
    halfWidth, halfHeight,
    impulseX, impulseY, impulseNormal,
  };
}

function compileRule(raw, fixture, index) {
  const label = `${fixture ? 'fixtures' : 'rules'}[${index}]`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} must be an object`);
  assertKeys(raw, [
    'id', 'source', 'trigger', 'schedule', 'effects', 'layer', 'priority',
  ], label);
  if (typeof raw.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(raw.id))
    throw new Error(`${label}.id must be lower_snake_case`);
  const source = selector(raw.source, `${label}.source`);
  const trigger = raw.trigger;
  if (!trigger || typeof trigger !== 'object' || !(trigger.type in TRIGGER))
    throw new Error(`${label}.trigger.type is unknown`);
  assertKeys(trigger, [
    'type', 'direction', 'target', 'minimumAge', 'minimumImpact',
  ], `${label}.trigger`);
  const defaultDirection = trigger.type === 'self' ? 'self'
    : trigger.type === 'layerOverlap' ? 'overlap' : 'cardinal';
  const direction = trigger.direction ?? defaultDirection;
  if (!(direction in DIRECTION)) throw new Error(`${label}.trigger.direction is unknown: ${direction}`);
  if (trigger.type === 'self' && direction !== 'self') throw new Error(`${label} self trigger must use self direction`);
  if (trigger.type !== 'self' && trigger.type !== 'bodyContact'
      && direction === 'self')
    throw new Error(`${label} only self triggers use self direction`);
  if (trigger.type === 'layerOverlap' && direction !== 'overlap') throw new Error(`${label} layerOverlap trigger must use overlap direction`);
  if (trigger.type !== 'layerOverlap' && direction === 'overlap')
    throw new Error(`${label} only layerOverlap triggers use overlap direction`);
  if (trigger.type === 'bodyContact' && trigger.direction !== undefined)
    throw new Error(`${label} bodyContact does not use a grid direction`);
  const needsTarget = trigger.type !== 'self';
  if (needsTarget !== (trigger.target !== undefined))
    throw new Error(`${label} ${needsTarget ? 'requires' : 'cannot declare'} trigger.target`);
  const target = needsTarget
    ? selector(trigger.target, `${label}.trigger.target`, false)
    : selector({ topology: 'any' }, `${label}.trigger.target`, true);
  const minimumAge = trigger.minimumAge ?? 0;
  if (!integer(minimumAge, 0, 0xffffffff))
    throw new Error(`${label}.trigger.minimumAge must be uint32`);
  const minimumImpact = trigger.minimumImpact ?? 0;
  if (!finite(minimumImpact) || minimumImpact < 0)
    throw new Error(`${label}.trigger.minimumImpact must be non-negative`);
  if (minimumImpact && trigger.type !== 'bodyContact')
    throw new Error(`${label}.trigger.minimumImpact is only valid for bodyContact`);
  if (minimumAge && source.topology !== 'loose')
    throw new Error(`${label} age rules currently require loose topology`);
  const schedule = raw.schedule ?? {};
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule))
    throw new Error(`${label}.schedule must be an object`);
  assertKeys(schedule, ['every', 'probability'], `${label}.schedule`);
  const every = schedule.every ?? 1;
  const probability = schedule.probability ?? 1;
  if (!integer(every, 1, 0xffffffff)) throw new Error(`${label}.schedule.every must be positive uint32`);
  if (!finite(probability) || probability <= 0 || probability > 1)
    throw new Error(`${label}.schedule.probability must be in (0,1]`);
  if (!Array.isArray(raw.effects) || raw.effects.length < 1 || raw.effects.length > 4)
    throw new Error(`${label}.effects must contain 1..4 entries`);
  const effects = raw.effects.map((effect, effectIndex) =>
    compileEffect(effect, `${label}.effects[${effectIndex}]`));
  const layer = raw.layer ?? 'current';
  if (!(layer in LAYER)) throw new Error(`${label}.layer is unknown: ${layer}`);
  if ((trigger.type === 'layerOverlap') !== (layer === 'overlap'))
    throw new Error(`${label} layerOverlap trigger and overlap layer policy must be used together`);
  if (!integer(raw.priority, 0, 255)) throw new Error(`${label}.priority must be in 0..255`);
  const sourceMaterials = selectorMaterials(source);
  const targetMaterials = selectorMaterials(target);
  if (!sourceMaterials.length || (needsTarget && !targetMaterials.length))
    throw new Error(`${label} contains an unreachable material selector`);
  if (source.topology === 'loose'
      && sourceMaterials.some((material) => placementByKind[material.kind] !== materialsSchema.placementProfiles.paint))
    throw new Error(`${label}.source loose selector includes a structural material`);
  if (source.topology === 'component'
      && sourceMaterials.some((material) => material.kind !== 'COMPONENT'))
    throw new Error(`${label}.source component selector includes a non-component material`);
  if (source.topology === 'body'
      && sourceMaterials.some((material) => placementByKind[material.kind] !== materialsSchema.placementProfiles.structure))
    throw new Error(`${label}.source body selector includes a non-structural material`);
  if (needsTarget && target.topology === 'loose'
      && targetMaterials.some((material) => material.name !== 'EMPTY'
        && placementByKind[material.kind] !== materialsSchema.placementProfiles.paint))
    throw new Error(`${label}.trigger.target loose selector includes a structural material`);
  if (needsTarget && target.topology === 'component'
      && targetMaterials.some((material) => material.kind !== 'COMPONENT'))
    throw new Error(`${label}.trigger.target component selector includes a non-component material`);
  if (needsTarget && target.topology === 'body'
      && targetMaterials.some((material) => placementByKind[material.kind] !== materialsSchema.placementProfiles.structure))
    throw new Error(`${label}.trigger.target body selector includes a non-structural material`);
  if (trigger.type === 'bodyContact'
      && (!(source.topology === 'body' || source.topology === 'any')
          || !(target.topology === 'body' || target.topology === 'any')))
    throw new Error(`${label} bodyContact requires body-capable source and target topology`);
  const topologyMutationBySubject = new Set();
  const impulseBySubject = new Set();
  const mutationEffectBySubject = new Map();
  for (const effect of effects) {
    const subjectKey = trigger.type === 'self' ? 'source' : effect.subject;
    const selected = effect.subject === 'source' || trigger.type === 'self'
      ? source : target;
    const selectedMaterials = selectorMaterials(selected);
    if (effect.op === 'place'
        && selectedMaterials.some((material) => material.name !== 'EMPTY'))
      throw new Error(`${label} place effects require an EMPTY subject selector`);
    if (effect.op === 'spawnBody'
        && (selected.topology !== 'loose'
            || selectedMaterials.some((material) => material.name !== 'EMPTY')))
      throw new Error(`${label} spawnBody effects require an EMPTY loose subject`);
    if (effect.op === 'detach' && selected.topology !== 'component')
      throw new Error(`${label} detach effects require component topology`);
    if (effect.op === 'applyImpulse' && selected.topology !== 'body')
      throw new Error(`${label} applyImpulse effects require body topology`);
    if (effect.topology === 'preserveOwner'
        && selected.topology !== 'component' && selected.topology !== 'body')
      throw new Error(`${label} preserveOwner requires component or body topology`);
    if (effect.scope === 'owner'
        && selected.topology !== 'component' && selected.topology !== 'body')
      throw new Error(`${label} owner scope requires component or body topology`);
    if (effect.op === 'applyImpulse') {
      if (impulseBySubject.has(subjectKey))
        throw new Error(`${label} has multiple impulses for ${subjectKey}`);
      impulseBySubject.add(subjectKey);
    } else {
      if (topologyMutationBySubject.has(subjectKey))
        throw new Error(`${label} has multiple topology mutations for ${subjectKey}`);
      topologyMutationBySubject.add(subjectKey);
      mutationEffectBySubject.set(subjectKey, effect);
    }
  }
  for (const subjectKey of impulseBySubject) {
    const mutation = mutationEffectBySubject.get(subjectKey);
    if (mutation && !(mutation.op === 'replace'
        && mutation.topology === 'preserveOwner'))
      throw new Error(`${label} cannot impulse an owner removed by another effect`);
  }
  return {
    id: raw.id, fixture, source, trigger: trigger.type, target, direction,
    minimumAge, minimumImpact, every, probability, effects, layer,
    priority: raw.priority, stableChannel: stableHash(raw.id),
  };
}

const rules = (schema.rules ?? []).map((rule, index) => compileRule(rule, false, index));
const fixtures = (schema.fixtures ?? []).map((rule, index) => compileRule(rule, true, index));
if (!rules.length) throw new Error('reactions.schema rules must be non-empty');
const allRules = [...rules, ...fixtures];
const ids = new Set();
const channels = new Set();
for (const rule of allRules) {
  if (ids.has(rule.id)) throw new Error(`duplicate reaction id ${rule.id}`);
  if (channels.has(rule.stableChannel)) throw new Error(`reaction hash collision for ${rule.id}`);
  ids.add(rule.id);
  channels.add(rule.stableChannel);
}
for (let i = 0; i < rules.length; i++) for (let j = 0; j < i; j++) {
  const a = rules[j], b = rules[i];
  if (a.layer !== b.layer || a.priority !== b.priority) continue;
  const overlap = selectorMaterials(a.source).some((material) =>
    selectorMaterials(b.source).some((other) => material.id === other.id));
  if (overlap) throw new Error(`${a.id} and ${b.id} need distinct priority because their source selectors overlap`);
}

const effectCpp = (effect) => `{${OP[effect.op]}, ${SUBJECT[effect.subject]}, ${POLICY[effect.topology]}, ${SCOPE[effect.scope]}, ${effect.material}, ${SHAPE[effect.shape]}, ${effect.radius}, ${effect.halfWidth}, ${effect.halfHeight}, ${cppDouble(effect.impulseX)}, ${cppDouble(effect.impulseY)}, ${cppDouble(effect.impulseNormal)}}`;
const selectorCpp = (value) => {
  const words = [0n, 0n, 0n, 0n];
  for (const material of selectorMaterials(value))
    words[material.id >> 6] |= 1n << BigInt(material.id & 63);
  return `{{${words.map((word) => `0x${word.toString(16)}ULL`).join(', ')}}, ${value.topologyMask}}`;
};
const ruleCpp = (rule) => {
  const effects = [...rule.effects.map(effectCpp)];
  while (effects.length < 4) effects.push('{}');
  return `  {${cppString(rule.id)}, 0x${rule.stableChannel.toString(16)}u, ${selectorCpp(rule.source)}, ${TRIGGER[rule.trigger]}, ${selectorCpp(rule.target)}, ${DIRECTION[rule.direction]}, ${LAYER[rule.layer]}, ${rule.priority}, ${rule.every}u, ${cppFloat(rule.probability)}, ${rule.minimumAge}u, ${cppDouble(rule.minimumImpact)}, {{${effects.join(', ')}}}, ${rule.effects.length}}`;
};
const ageMaterialIds = new Set();
for (const rule of rules) if (rule.minimumAge && rule.source.topology === 'loose')
  for (const material of selectorMaterials(rule.source)) ageMaterialIds.add(material.id);
const ageTable = Array.from({ length: tableSize }, (_, id) => ageMaterialIds.has(id) ? 1 : 0);
const rulesUseAge = ageMaterialIds.size > 0;

const stateHpp = `#pragma once
// Generated by scripts/generate-reactions.mjs from reactions.schema.json.
// The persistent age channel exists only when a production rule consumes it.

#define SAND_HAS_REACTION_AGE_CHANNEL ${rulesUseAge ? 1 : 0}
#if SAND_HAS_REACTION_AGE_CHANNEL
#define SAND_REACTION_AGE_CHANNEL(X) \\
  X(reactionAge, uint32_t, 0, reactionAgeStore, encodeVelocityTile, decodeVelocityTile, persistentReactionAgeState, PCSO_STATIONARY | PCSO_MOVE | PCSO_SWAP | PCSO_CROSS_LAYER | PCSO_FORCE_PARK | PCSO_BODY_DISPLACE)
#else
#define SAND_REACTION_AGE_CHANNEL(X)
#endif
`;

const hpp = `#pragma once
// Generated by scripts/generate-reactions.mjs from reactions.schema.json.
// Edit the schema and run npm run generate.

static constexpr GeneratedReactionRule GENERATED_REACTION_RULES[] = {
${rules.map(ruleCpp).join(',\n')}
};
static constexpr size_t GENERATED_REACTION_RULE_COUNT = sizeof(GENERATED_REACTION_RULES) / sizeof(GENERATED_REACTION_RULES[0]);

static constexpr GeneratedReactionRule GENERATED_REACTION_FIXTURES[] = {
${fixtures.map(ruleCpp).join(',\n')}
};
static constexpr size_t GENERATED_REACTION_FIXTURE_COUNT = sizeof(GENERATED_REACTION_FIXTURES) / sizeof(GENERATED_REACTION_FIXTURES[0]);

static constexpr uint8_t MAT_REACTION_AGE_ENABLED[TABLE] = {${ageTable.join(', ')}};
static constexpr bool GENERATED_REACTIONS_HAVE_BODY_CONTACT = ${rules.some((rule) => rule.trigger === 'bodyContact') ? 'true' : 'false'};
static constexpr bool GENERATED_REACTION_FIXTURES_HAVE_BODY_CONTACT = ${fixtures.some((rule) => rule.trigger === 'bodyContact') ? 'true' : 'false'};
`;

const publicRule = (rule) => ({
  id: rule.id,
  channel: rule.stableChannel,
  source: { match: rule.source.kind, value: rule.source.jsValue, topology: rule.source.topology },
  trigger: { type: rule.trigger, direction: rule.direction, target: rule.trigger === 'self' ? null : { match: rule.target.kind, value: rule.target.jsValue, topology: rule.target.topology }, minimumAge: rule.minimumAge, minimumImpact: rule.minimumImpact },
  schedule: { every: rule.every, probability: rule.probability },
  effects: rule.effects.map((effect) => ({ ...effect })),
  layer: rule.layer,
  priority: rule.priority,
});
const js = `// Generated by scripts/generate-reactions.mjs from reactions.schema.json.\n// Edit the schema and run npm run generate.\n\nexport const REACTION_SCHEMA_VERSION = ${schema.version};\nexport const REACTION_RULES = ${JSON.stringify(rules.map(publicRule), null, 2)};\nexport const REACTION_FIXTURES = ${JSON.stringify(fixtures.map(publicRule), null, 2)};\nexport const MAT_REACTION_AGE_ENABLED = [${ageTable.join(', ')}];\n`;

function writeOrCheck(path, content) {
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== content) {
      console.error(`${path} is stale; run npm run generate`);
      process.exitCode = 1;
    }
  } else {
    writeFileSync(path, content);
  }
}
writeOrCheck(hppPath, hpp);
writeOrCheck(stateHppPath, stateHpp);
writeOrCheck(jsPath, js);
