// Fast source-level checks for engine ownership rules that are easy to break
// without producing a compiler error. This runs before tests and production
// builds; it reads sources only and never rebuilds the committed WASM.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const engineDir = resolve(root, 'src/sand/cpp/engine');

const fail = (message) => {
  console.error(`sand contract: ${message}`);
  process.exitCode = 1;
};
const sourceWithoutComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');
const lineOf = (source, index) => source.slice(0, index).split('\n').length;
const functionBody = (source, signature) => {
  const start = source.indexOf(signature);
  if (start < 0) return null;
  const open = source.indexOf('{', start + signature.length);
  if (open < 0) return null;
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}' && --depth === 0)
      return source.slice(open + 1, index);
  }
  return null;
};

// Only top-level phase coordinators may deliberately leave a different active
// layer selected. Subsystems and ABI entry points must use ActiveLayerScope or
// address an explicit Layer instead.
const rawLayerAllow = new Map([
  ['members.inc', {
    count: 2,
    lines: new Set([
      'inline void useLayer(Layer* lay) { L = lay; }',
      'useLayer(&fg);',
    ]),
  }],
  ['step.inc', {
    count: 6,
    lines: new Set([
      'useLayer(layer);',
      'useLayer(&fg);',
      'if (!fgA && !bgA) { useLayer(&fg); perfStepMs = 0; return false; }',
      'useLayer(&fg); comps.moveRigidAssemblies();',
      'useLayer(&bg); comps.moveRigidAssemblies();',
    ]),
  }],
]);
for (const entry of readdirSync(engineDir, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(?:hpp|inc)$/.test(entry.name)) continue;
  const path = resolve(engineDir, entry.name);
  const source = sourceWithoutComments(readFileSync(path, 'utf8'));
  const matches = [...source.matchAll(/\buseLayer\s*\(/g)];
  const allowance = rawLayerAllow.get(entry.name);
  if (allowance && matches.length !== allowance.count) {
    fail(`${relative(root, path)} has ${matches.length} raw layer transitions; expected ${allowance.count} coordinator transitions`);
  }
  for (const match of matches) {
    const line = source.slice(source.lastIndexOf('\n', match.index) + 1,
      source.indexOf('\n', match.index) < 0 ? source.length : source.indexOf('\n', match.index)).trim();
    if (allowance?.lines.has(line)) continue;
    fail(`${relative(root, path)}:${lineOf(source, match.index)} uses raw useLayer(); use ActiveLayerScope or an explicit Layer&`);
  }
  if (entry.name !== 'members.inc') {
    for (const match of source.matchAll(/(?<![.>\w])L\s*=(?!=)/g)) {
      fail(`${relative(root, path)}:${lineOf(source, match.index)} assigns the ambient layer pointer; use ActiveLayerScope`);
    }
  }
}

// These subsystem fragments declare composition only. Callers name the owning
// subsystem directly, which keeps a new method from requiring a matching Engine
// declaration and forwarding body.
const compositionOnly = new Map([
  ['tools.inc', 'tools'], ['inventory.inc', 'inv'], ['components.inc', 'comps'],
  ['rigid.inc', 'rigid'], ['explosives.inc', 'explosives'],
  ['crafting.inc', 'crafting'], ['creatures.inc', 'creatures'],
  ['items.inc', 'itemsys'], ['gl.inc', 'glp'],
  ['player.inc', 'psys'],
]);
for (const [file, member] of compositionOnly) {
  const path = resolve(engineDir, file);
  const source = sourceWithoutComments(readFileSync(path, 'utf8'));
  if (new RegExp(`\\b${member}\\.\\w+\\s*\\(`).test(source)) {
    fail(`${relative(root, path)} must contain composition declarations, not Engine forwarding methods`);
  }
}

// Pure Engine-to-subsystem delegates recreate the declaration/call/body sync
// surface that subsystem composition removes. Camera aim adapters are
// coordinators because they translate camera state into tool coordinates.
const engineFragments = readdirSync(engineDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.inc')
    && !entry.name.endsWith('_impl.inc'));
const subsystemMembers = new Set(['cam']);
for (const entry of engineFragments) {
  const source = sourceWithoutComments(readFileSync(resolve(engineDir, entry.name), 'utf8'));
  for (const match of source.matchAll(/\b[A-Z]\w*(?:<[^;{}]+>)?\s+(\w+)\s*\{\s*\*this\s*\};/g)) {
    subsystemMembers.add(match[1]);
  }
}
const pureForwardAllow = new Set([
  'camera.inc:pointerDraftAtAim',
  'camera.inc:pointerDownAtAim',
]);
const memberAlternation = [...subsystemMembers].sort().join('|');
const pureForwardPattern = new RegExp(
  `^[ \\t]*(?:inline[ \\t]+)?[A-Za-z_]`+
    `[A-Za-z0-9_:<>,*& \\t]*[ \\t]+(\\w+)\\([^{};\\n]*\\)[ \\t]*`+
    `\\{[ \\t\\r\\n]*(?:return[ \\t]+)?(?:${memberAlternation})`+
    `\\.\\w+\\([^{};]*\\);[ \\t\\r\\n]*\\}`,
  'gm',
);
for (const entry of engineFragments) {
  const path = resolve(engineDir, entry.name);
  const source = sourceWithoutComments(readFileSync(path, 'utf8'));
  for (const match of source.matchAll(pureForwardPattern)) {
    const key = `${entry.name}:${match[1]}`;
    if (pureForwardAllow.has(key)) continue;
    fail(`${relative(root, path)}:${lineOf(source, match.index)} is a pure subsystem forwarding method; call the owner directly`);
  }
}

const streamingPath = resolve(engineDir, 'world_streaming.inc');
const streamingSource = sourceWithoutComments(readFileSync(streamingPath, 'utf8'));
const prefetchScopeStart = streamingSource.indexOf('struct PrefetchGenerationScope {');
const prefetchScopeEnd = streamingSource.indexOf('\n  };', prefetchScopeStart);
const activeAliases = [...streamingSource.matchAll(/\bLayer\s*\*&\s+active\b|\bactive\s*=(?!=)/g)];
if (prefetchScopeStart < 0 || prefetchScopeEnd < 0 || activeAliases.length !== 3
    || activeAliases.some((match) => match.index < prefetchScopeStart
      || match.index > prefetchScopeEnd)) {
  fail('world prefetch may redirect the ambient layer only inside PrefetchGenerationScope');
}

// The material grid and every persistent per-cell side channel advance as one
// transaction. A direct pointer swap can silently put a newly-added channel one
// tick out of phase.
const stepPath = resolve(engineDir, 'step.inc');
const stepSource = sourceWithoutComments(readFileSync(stepPath, 'utf8'));
if (!stepSource.includes('swapSimulationBuffers()')) {
  fail(`${relative(root, stepPath)} must advance cell state through Layer::swapSimulationBuffers()`);
}
const layerSource = readFileSync(resolve(engineDir, 'layer.hpp'), 'utf8');
if (!layerSource.includes('SAND_PERSISTENT_CELL_CHANNELS')
    || !layerSource.includes('PingPongCellState')) {
  fail('Layer persistent side channels must use the declarative PingPongCellState profile');
}
const vacatedCellBody = functionBody(
  sourceWithoutComments(layerSource), 'void clearVacatedCellPhases(');
if (vacatedCellBody === null
    || !vacatedCellBody.includes('grid[index] = next[index] = EMPTY')
    || !vacatedCellBody.includes('SAND_PERSISTENT_CELL_CHANNELS')
    || !vacatedCellBody.includes('bodyOwner[index] = -1')) {
  fail('Layer vacated-cell cleanup must release both materials, body ownership, and every persistent channel phase');
}
for (const entry of readdirSync(engineDir, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(?:hpp|inc)$/.test(entry.name) || entry.name === 'layer.hpp') continue;
  const path = resolve(engineDir, entry.name);
  const source = sourceWithoutComments(readFileSync(path, 'utf8'));
  for (const match of source.matchAll(/std::swap\s*\([^;]*(?:grid|fallSpeed|liquidVel)[^;]*\)/g)) {
    fail(`${relative(root, path)}:${lineOf(source, match.index)} swaps persistent cell buffers outside Layer`);
  }
}

// Persistent channel motion is registry-driven at every ownership boundary.
// These coordinator hooks keep a declared channel attached to its cell during
// ordinary movement, settled swaps, cross-layer transfer, and rigid stamping.
const persistentMotionHooks = new Map([
  ['members.inc', [
    'SAND_CLEAR_NEXT_CHANNEL_SPAN',
    'clearPersistentCurrentState',
    'carryPersistentStateToNext',
    'mirrorCurrentCellToNext',
  ]],
  ['core.inc', [
    'capturePersistentCurrentState',
    'restorePersistentCurrentState',
    'restorePersistentNextState',
  ]],
  ['step.inc', [
    'capturePersistentCurrentState',
    'restorePersistentCurrentState',
  ]],
  ['forces_impl.inc', ['PCSO_FORCE_PARK']],
  ['components_impl.inc', ['mirrorCurrentCellToNext']],
  ['worldgen_caves.inc', ['mirrorCurrentCellToNext']],
  ['rigid_impl.inc', [
    'clearPersistentCurrentState',
    'PCSO_BODY_DISPLACE',
    'PCSO_BODY_MOTION',
  ]],
]);
for (const [file, hooks] of persistentMotionHooks) {
  const path = resolve(engineDir, file);
  const source = sourceWithoutComments(readFileSync(path, 'utf8'));
  for (const hook of hooks) {
    if (!source.includes(hook)) {
      fail(`${relative(root, path)} must route persistent cell state through ${hook}`);
    }
  }
}
for (const entry of readdirSync(engineDir, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(?:hpp|inc)$/.test(entry.name)) continue;
  const path = resolve(engineDir, entry.name);
  const source = sourceWithoutComments(readFileSync(path, 'utf8'));
  for (const match of source.matchAll(
    /(?:\bL->|\b\w+\.)?next\s*\[[^\]]+\]\s*=\s*(?:\bL->|\b\w+\.)?grid\s*\[/g)) {
    fail(`${relative(root, path)}:${lineOf(source, match.index)} mirrors material phases without registered cell state`);
  }
}
{
  const path = resolve(engineDir, 'rigid_impl.inc');
  const source = sourceWithoutComments(readFileSync(path, 'utf8'));
  const spill = functionBody(
    source, 'void RigidBodySystem::spillDisplacedBodyMaterial(');
  const move = functionBody(source, 'void RigidBodySystem::moveBodies(');
  const relax = functionBody(source, 'void RigidBodySystem::relaxWorldContacts(');
  const restamp = functionBody(
    source, 'void RigidBodySystem::restampBodiesAfterStream(');
  if (!spill || [...spill.matchAll(/state,\s*operation\)/g)].length < 2
      || !move?.includes('PCSO_BODY_MOTION')
      || !relax?.includes('PCSO_BODY_MOTION')
      || !restamp?.includes('stampJointFollower(body, operation)')) {
    fail(`${relative(root, path)} must keep static footprint displacement distinct from per-tick body motion`);
  }
  const staticRestamps = [...streamingSource.matchAll(
    /restampBodiesAfterStream\(PCSO_BODY_DISPLACE\)/g)];
  if (staticRestamps.length !== 4) {
    fail(`${relative(root, streamingPath)} must restore streamed body footprints with static displacement policy`);
  }
}
{
  const path = resolve(engineDir, 'members.inc');
  const body = functionBody(
    sourceWithoutComments(readFileSync(path, 'utf8')),
    'void moveMaterialInto(');
  if (!body?.includes('toX == fromX && persistentLooseState(m)')) {
    fail(`${relative(root, path)} moveMaterialInto must restrict fall-speed acceleration to accepted materials`);
  }
}
if (/shift(?:RowMajor|BufV)(?:U8|U32|I32)\b/.test(streamingSource)) {
  fail('persistent cell-state streaming shifts must remain scalar-type generic');
}

// Topology rollback, streaming, and stale-raster carry cleanup must not clear
// both material phases while leaving a registered side channel behind.
for (const file of ['rigid_impl.inc', 'world_streaming.inc', 'step.inc']) {
  const path = resolve(engineDir, file);
  const source = sourceWithoutComments(readFileSync(path, 'utf8'));
  if (/\bgrid\s*\[[^\]]+\]\s*=\s*EMPTY\s*;[\s\S]{0,120}\bnext\s*\[[^\]]+\]\s*=\s*EMPTY\s*;/.test(source))
    fail(`${relative(root, path)} must clear paired material phases through Layer::clearVacatedCellPhases`);
  if (!source.includes('clearVacatedCellPhases'))
    fail(`${relative(root, path)} must use Layer::clearVacatedCellPhases for vacated topology rasters`);
}
{
  const path = resolve(engineDir, 'rigid_fluid_writeback.inc');
  const source = sourceWithoutComments(readFileSync(path, 'utf8'));
  if (!source.includes('persistentLiquidState(node.layer->grid[node.cell])')
      || !source.includes('persistentLiquidState(node.layer->next[node.cell])')) {
    fail(`${relative(root, path)} must filter projected liquid velocity by each material phase`);
  }
}

// Destructive tool and blast paths reset the material plus every registered
// current/alternate cell-state phase before releasing body ownership.
for (const [file, signature] of [
  ['tools_impl.inc', 'void ToolSystem::destroyCellAt('],
  ['explosives_impl.inc', 'void ExplosivesSystem::applyBlastCuts('],
]) {
  const path = resolve(engineDir, file);
  const body = functionBody(
    sourceWithoutComments(readFileSync(path, 'utf8')), signature);
  if (body === null) {
    fail(`${relative(root, path)} must define ${signature}`);
    continue;
  }
  if (!body.includes('writeGridIndexUnsafe') || !body.includes('clearMotionSpan'))
    fail(`${relative(root, path)} ${signature} must reset all registered cell-state phases`);
  if (/\bgrid\s*\[[^\]]+\]\s*=\s*EMPTY\b/.test(body))
    fail(`${relative(root, path)} ${signature} must not clear material state directly`);
  if (body.includes('bodyOwner[k] = -1')
      && !/clearCellState\(k\);\s*E\.L->bodyOwner\[k\]\s*=\s*-1/.test(body)) {
    fail(`${relative(root, path)} ${signature} must clear cell state before body ownership`);
  }
}

// Explicit paint is a state reset, while a same-material reaction product is
// state-neutral. Keeping these boundaries distinct protects repaint controls
// and catalyst reactions at the same time.
{
  const toolsPath = resolve(engineDir, 'tools_impl.inc');
  const paintBody = functionBody(sourceWithoutComments(
    readFileSync(toolsPath, 'utf8')), 'int ToolSystem::paintDisc(');
  if (paintBody === null
      || !/old\s*==\s*material[\s\S]*?writeGridIndexUnsafe\(k, material\)[\s\S]*?clearMotionSpan\(\(size_t\)k, 1\)/.test(paintBody))
    fail(`${relative(root, toolsPath)} explicit same-material paint must reset every cell-state phase`);

  const mutationsPath = resolve(engineDir, 'cell_mutations_impl.inc');
  const replaceBody = functionBody(sourceWithoutComments(
    readFileSync(mutationsPath, 'utf8')), 'bool CellMutationBatch::replaceImpl(');
  const sameStart = replaceBody?.indexOf('if (oldMaterial == material)') ?? -1;
  const detachStart = replaceBody?.indexOf('detachOldTopology') ?? -1;
  if (sameStart < 0 || detachStart < 0 || sameStart >= detachStart
      || replaceBody.slice(sameStart, detachStart).includes('writeGridIndexUnsafe'))
    fail(`${relative(root, mutationsPath)} same-material mutation products must preserve cell state`);
}

// Heat-triggered explosive liveness, effects, and fuse lifecycle consume the
// generated profile predicates, so another material can reuse a handler without
// introducing an identity allowlist.
for (const [file, signature, hooks] of [
  ['reactions_impl.inc', 'void ReactionSystem::prepareActiveLists(', [
    'isHeatSensitiveExplosive',
  ]],
  ['explosives_impl.inc', 'void ExplosivesSystem::applyExplosives(', [
    'isHeatSensitiveExplosive', 'isFuseExplosive', 'isPocketExplosive',
  ]],
  ['explosives_impl.inc', 'void ExplosivesSystem::evaluateBlastPlan(', [
    'isFuseExplosive',
  ]],
]) {
  const path = resolve(engineDir, file);
  const body = functionBody(
    sourceWithoutComments(readFileSync(path, 'utf8')), signature);
  if (body === null) {
    fail(`${relative(root, path)} must define ${signature}`);
    continue;
  }
  for (const hook of hooks)
    if (!body.includes(hook))
      fail(`${relative(root, path)} ${signature} must dispatch through ${hook}`);
  if (/(?:==|!=)\s*(?:TNT|METHANE)\b|\b(?:TNT|METHANE)\s*(?:==|!=)/.test(body))
    fail(`${relative(root, path)} ${signature} must not dispatch by material identity`);
}
for (const [file, hook] of [
  ['world_streaming.inc', 'isFuseExplosive(L->grid[k])'],
  ['rigid_impl.inc', 'bodyContainsExplosiveProfile(b, XP_TNT_FUSE)'],
]) {
  const path = resolve(engineDir, file);
  const source = sourceWithoutComments(readFileSync(path, 'utf8'));
  if (!source.includes(hook))
    fail(`${relative(root, path)} must preserve fuse state through generated profiles`);
}

// Source-side fire, acid, and lava chemistry is selected by the generated
// material reaction profile. Exact ids remain valid only for canonical products.
for (const [file, signature, hooks] of [
  ['reactions_impl.inc', 'void ReactionSystem::applyFireAndWater(', [
    'activeProfileCells(MRP_FIRE)', 'hasMaterialReactionProfile',
  ]],
  ['reactions_impl.inc', 'void ReactionSystem::applyAcid(', [
    'activeProfileCells(MRP_ACID)', 'hasMaterialReactionProfile',
  ]],
  ['reactions_impl.inc', 'void ReactionSystem::applyLava(', [
    'activeProfileCells(MRP_LAVA)', 'hasMaterialReactionProfile',
  ]],
  ['reactions_impl.inc', 'void ReactionSystem::applyCrossLayerMaterialContact(', [
    'hasMaterialReactionProfile',
  ]],
  ['rigid_impl.inc', 'double RigidBodySystem::rigidErodeProbabilityAt(', [
    'materialReactionProfile',
  ]],
  ['rigid_impl.inc', 'void RigidBodySystem::erodeBodies(', [
    'hasMaterialReactionProfile',
  ]],
]) {
  const path = resolve(engineDir, file);
  const body = functionBody(
    sourceWithoutComments(readFileSync(path, 'utf8')), signature);
  if (body === null) {
    fail(`${relative(root, path)} must define ${signature}`);
    continue;
  }
  for (const hook of hooks)
    if (!body.includes(hook))
      fail(`${relative(root, path)} ${signature} must dispatch through ${hook}`);
  if (/(?:==|!=)\s*(?:FIRE|ACID|LAVA)\b|\b(?:FIRE|ACID|LAVA)\s*(?:==|!=)/.test(body))
    fail(`${relative(root, path)} ${signature} must not dispatch chemistry by material identity`);
}

// Structure kind IDs, planning metadata, and stamp callback names live in one
// registry. Named switch cases consume the rows without positional dispatch.
const archetypeRegistryPath = resolve(engineDir, 'worldgen_structure_archetypes.def');
const archetypeRegistry = readFileSync(archetypeRegistryPath, 'utf8');
const assertDenseArchetypeRows = (macro) => {
  const ids = [...archetypeRegistry.matchAll(
    new RegExp(`${macro}\\(\\w+,\\s*(\\d+)`, 'g'))]
    .map((match) => Number(match[1]));
  if (ids.length === 0 || ids.some((id, index) => id !== index))
    fail(`${relative(root, archetypeRegistryPath)} ${macro} IDs must be dense and stable`);
};
assertDenseArchetypeRows('WORLDGEN_FACILITY_ARCHETYPE');
assertDenseArchetypeRows('WORLDGEN_RUIN_ARCHETYPE');
for (const [file, positionalTable] of [
  ['worldgen_offworld.inc', 'facilityStamps'],
  ['worldgen_surface_structures.inc', 'ruinStamps'],
]) {
  const source = readFileSync(resolve(engineDir, file), 'utf8');
  if (!source.includes('#include "worldgen_structure_archetypes.def"')
      || source.includes(positionalTable)) {
    fail(`${file} must dispatch structure stamps from the named archetype registry`);
  }
}

const worldgenStageRegistryPath = resolve(engineDir, 'worldgen_stages.def');
const worldgenStageRegistry = readFileSync(worldgenStageRegistryPath, 'utf8');
const stageIds = [...worldgenStageRegistry.matchAll(
  /SAND_WORLDGEN_STAGE\(\w+,\s*(\d+)/g)].map((match) => Number(match[1]));
if (stageIds.length === 0 || stageIds.some((id, index) => id !== index))
  fail(`${relative(root, worldgenStageRegistryPath)} IDs must be dense and ordered`);
const worldContextHeader = readFileSync(resolve(engineDir, 'world_context.hpp'), 'utf8');
if ((worldContextHeader.match(/#include "worldgen_stages\.def"/g) ?? []).length < 3)
  fail('worldgen stage enum, declarations, and descriptors must share worldgen_stages.def');
for (const contract of [
  'validGeneratedFeatureCatalogue',
  'generatedFeatureInvalidFixturesAreRejected',
  'validWorldGenerationStages',
  'generationStageCoverageIsComplete',
  'worldGenerationStageInvalidFixturesAreRejected',
]) {
  if (!worldContextHeader.includes(contract))
    fail(`worldgen registries must retain the ${contract} compile-time contract`);
}

const abiGeneratorSource = readFileSync(
  resolve(root, 'scripts/generate-abi.mjs'), 'utf8');
const biomeGeneratorSource = readFileSync(
  resolve(root, 'scripts/generate-biomes.mjs'), 'utf8');
const caveHandlerHeader = readFileSync(
  resolve(engineDir, 'cave_profile_handlers.hpp'), 'utf8');
if (!abiGeneratorSource.includes('creature_behavior_policies.def')
    || /new Set\(\[['"]CAH_/.test(abiGeneratorSource))
  fail('creature policy validation and enums must derive from creature_behavior_policies.def');
if (!biomeGeneratorSource.includes('cave_handler_policies.def')
    || /new Set\(\[['"]CUDH_/.test(biomeGeneratorSource)
    || /\bCUDH_NONE\s*=/.test(caveHandlerHeader))
  fail('cave policy validation and enums must derive from cave_handler_policies.def');

const worldContextImplementation = readFileSync(
  resolve(engineDir, 'world_context_impl.inc'), 'utf8');
if (/\bBIOME_ROCKY\b/.test(sourceWithoutComments(worldContextImplementation)))
  fail('surface structure eligibility must use generated biome policy');

const audioHeader = readFileSync(resolve(engineDir, 'audio.hpp'), 'utf8');
if (!audioHeader.includes('MAX_EVENTS = SOUND_EVENT_MAX_RECORDS'))
  fail('engine sound capacity must use the generated ABI record limit');

const abiImplementation = sourceWithoutComments(
  readFileSync(resolve(engineDir, 'abi.inc'), 'utf8'));
for (const [signature, predicate] of [
  ['engine_spawn_creature(', 'isCreatureSpeciesAbiValue'],
  ['engine_spawn_scripted_creature(', 'isCreatureSpeciesAbiValue'],
  ['engine_place_seed_typed(', 'isPlantSpeciesId'],
  ['engine_add_special_item(', 'isInventoryItemKindValue'],
]) {
  const body = functionBody(abiImplementation, signature);
  if (!body?.includes(predicate))
    fail(`${signature.slice(0, -1)} must validate its content id before narrowing`);
}

// Packed ABI producers call schema-generated writers. This keeps field
// additions attached to one declared source instead of a parallel offset loop.
const snapshotProducerCalls = new Map([
  ['player_impl.inc', ['writePlayerSnapshot']],
  ['items_impl.inc', ['writeItemSnapshot']],
  ['creatures_impl.inc', [
    'writeCreatureSnapshot', 'writeCreatureTelegraphSnapshot',
  ]],
  ['inventory_impl.inc', ['writeInventorySlotSnapshot']],
  ['projectiles_impl.inc', ['writeProjectileSnapshot']],
  ['crafting_impl.inc', [
    'writeCraftingRecipeSnapshot', 'writeCraftingIngredientSnapshot',
  ]],
  ['tools_impl.inc', ['writeSurvivalFootprintSnapshot']],
  ['audio_impl.inc', ['writeSoundEventSnapshot']],
  ['abi.inc', ['writePerfSnapshot', 'writeTestBodyStateSnapshot']],
  ['missions_impl.inc', ['writeMissionSnapshot', 'writeObjectiveSnapshot']],
  ['world_context_impl.inc', ['writeWorldContextSnapshot']],
]);
for (const [file, writers] of snapshotProducerCalls) {
  const source = sourceWithoutComments(readFileSync(resolve(engineDir, file), 'utf8'));
  for (const writer of writers) {
    if (!new RegExp(`\\b${writer}\\s*\\(`).test(source)) {
      fail(`${file} must pack ABI records through ${writer}`);
    }
  }
}
for (const entry of readdirSync(engineDir, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(?:hpp|inc)$/.test(entry.name)
      || entry.name === 'abi.generated.hpp') continue;
  const path = resolve(engineDir, entry.name);
  const source = sourceWithoutComments(readFileSync(path, 'utf8'));
  const manualWrite = source.match(
    /\[(?:PS|IS|CSN|IVS|PRS|CR|CI|FP|SND|PF|MS|OS|WC|TBS)_[A-Z0-9_]+\]\s*=/,
  );
  if (manualWrite) {
    fail(`${relative(root, path)}:${lineOf(source, manualWrite.index)} writes a packed ABI field outside its generated writer`);
  }
}
const gameLoopPath = resolve(root, 'src/sand/game/gameLoop.js');
const gameLoopSource = sourceWithoutComments(readFileSync(gameLoopPath, 'utf8'));
if (!/\bwriteGlPlayerExtSnapshot\s*\(/.test(gameLoopSource)
    || /\bOFF\.glPlayerExt\b/.test(gameLoopSource)) {
  fail('gameLoop.js must pack external player records through writeGlPlayerExtSnapshot');
}
const abiSourceForSnapshots = sourceWithoutComments(
  readFileSync(resolve(engineDir, 'abi.inc'), 'utf8'));
if ((abiSourceForSnapshots.match(/\bwriteTestBodyStateSnapshot\s*\(/g) ?? []).length !== 2) {
  fail('both test body-state exports must use writeTestBodyStateSnapshot');
}
const testHooksSource = sourceWithoutComments(readFileSync(
  resolve(root, 'src/sand/wasmBridge/testHooks.js'), 'utf8'));
if (!/STRIDES\.testBodyState/.test(testHooksSource)
    || !/unpackSnapshotRecordAt\([\s\S]*?'testBodyState'/.test(testHooksSource)
    || /_malloc\s*\(\s*26\s*\*\s*8\s*\)/.test(testHooksSource)) {
  fail('testHooks.js must decode body state through the generated testBodyState codec');
}

if (!process.exitCode) console.log('sand engine source contracts pass');
