// Test/diagnostic hooks for the sand engine — imported ONLY by scripts/ (tests
// and benches), never by the browser bundle. The C ABI names carry an
// engine_test_ prefix so the test surface is distinguishable from the
// production API.
//
//   import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
//   const e = attachTestHooks(createEngineWasm({...}));
//   e._bodyState(0); e.setGroundingDebug(true, false); ...

import { _wasmInternals } from './engineFactory.js';
import { STRIDES } from './abi.generated.js';
import { unpackSnapshotRecordAt } from './recordCodec.js';

let T = null; // lazily cwrapped test-ABI table
function table() {
  if (T) return T;
  const M = _wasmInternals();
  if (!M) throw new Error('initSandWasm() must resolve before attachTestHooks()');
  const c = (name, ret, args) => M.mod.cwrap(name, ret, args);
  T = {
    mod: M.mod,
    bodyCount: c('engine_test_body_count', 'number', ['number']),
    worldDirtyTileCount: c('engine_test_world_dirty_tile_count', 'number', ['number']),
    componentStateCount: c('engine_test_component_state_count', 'number',
      ['number', 'number']),
    componentCount: c('engine_test_component_count', 'number', ['number', 'number']),
    componentId: c('engine_test_component_id', 'number', ['number', 'number', 'number']),
    replaceAttached: c('engine_test_replace_attached', 'number',
      ['number', 'number', 'number', 'number', 'number', 'number']),
    replaceAttachedAfterLoose: c('engine_test_replace_attached_after_loose',
      'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number']),
    replaceAttachedPair: c('engine_test_replace_attached_pair', 'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']),
    bodyBlocked: c('engine_test_body_blocked', 'number', ['number', 'number']),
    bodyTerrainBlocked: c('engine_test_body_terrain_blocked', 'number', ['number', 'number']),
    bodyBlockedLayer: c('engine_test_body_blocked_layer', 'number',
      ['number', 'number', 'number']),
    bodyTerrainBlockedLayer: c('engine_test_body_terrain_blocked_layer',
      'number', ['number', 'number', 'number']),
    bodyTerrainBlocker: c('engine_test_body_terrain_blocker', 'number',
      ['number', 'number', 'number', 'number']),
    bodyOwnerBlockedGrid: c('engine_test_body_owner_blocked_grid', 'number',
      ['number', 'number', 'number', 'number']),
    bodyPrimaryBlocker: c('engine_test_body_primary_blocker', 'number',
      ['number', 'number', 'number', 'number', 'number']),
    worldContactCount: c('engine_test_world_contact_count', 'number', ['number']),
    worldContactState: c('engine_test_world_contact_state', 'number',
      ['number', 'number', 'number']),
    bodyAwake: c('engine_test_body_awake', 'number', ['number', 'number']),
    bodyAwakeLayer: c('engine_test_body_awake_layer', 'number',
      ['number', 'number', 'number']),
    forceDiag: c('engine_test_force_diag', 'number', ['number', 'number']),
    bodyMaterial: c('engine_test_body_material', 'number', ['number', 'number']),
    bodyChildCount: c('engine_test_body_child_count', 'number', ['number', 'number']),
    bodyBlastDebris: c('engine_test_body_blast_debris', 'number', ['number', 'number']),
    bodyCountLayer: c('engine_test_body_count_layer', 'number', ['number', 'number']),
    bodyIdLayer: c('engine_test_body_id_layer', 'number', ['number', 'number', 'number']),
    bodyBlastDebrisLayer: c('engine_test_body_blast_debris_layer', 'number', ['number', 'number', 'number']),
    bodyJointRoleLayer: c('engine_test_body_joint_role_layer', 'number', ['number', 'number', 'number']),
    bodyLookupPreservesPoseCache: c('engine_test_body_lookup_preserves_pose_cache', 'number',
      ['number', 'number', 'number']),
    bodyStateLayer: c('engine_test_body_state_layer', 'number', ['number', 'number', 'number', 'number']),
    spawnBoxLayer: c('engine_test_spawn_box_layer', 'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number']),
    activeLayer: c('engine_test_active_layer', 'number', ['number']),
    layerBuffersValid: c('engine_test_layer_buffers_valid', 'number',
      ['number', 'number']),
    layerBufferPhase: c('engine_test_layer_buffer_phase', 'number',
      ['number', 'number']),
    setMotionSentinel: c('engine_test_set_motion_sentinel', 'number',
      ['number', 'number', 'number', 'number']),
    motionCellZero: c('engine_test_motion_cell_zero', 'number',
      ['number', 'number', 'number']),
    motionChannelCount: c('engine_test_motion_channel_count', 'number', []),
    motionCellState: c('engine_test_motion_cell_state', 'number',
      ['number', 'number', 'number', 'number']),
    groundedPtr: c('engine_test_grounded_ptr', 'number', ['number', 'number']),
    bodyOwnerPtr: c('engine_test_body_owner_ptr', 'number', ['number', 'number']),
    fallSpeedPtr: c('engine_test_fall_speed_ptr', 'number', ['number', 'number']),
    liquidVelocityPtr: c('engine_test_liquid_velocity_ptr', 'number',
      ['number', 'number']),
    resetTopology: c('engine_test_reset_topology', null, ['number']),
    dropJointBondCache: c('engine_test_drop_joint_bond_cache', null, ['number']),
    setBodyBlastDebris: c('engine_test_set_body_blast_debris', 'number', ['number', 'number', 'number']),
    detonateTnt: c('engine_test_detonate_tnt', null, ['number', 'number', 'number']),
    applyBlastImpulse: c('engine_test_apply_blast_impulse', 'number',
      ['number', 'number', 'number', 'number', 'number', 'number']),
    damagePlayer: c('engine_test_damage_player', 'number',
      ['number', 'number', 'number', 'number', 'number']),
    collectDynamicLights: c('engine_test_collect_dynamic_lights', 'number', ['number']),
    applyCatalystProducts: c('engine_test_apply_catalyst_products', 'number',
      ['number', 'number', 'number', 'number', 'number']),
    reactionFixture: c('engine_test_reaction_fixture', 'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number']),
    reactionFixtureCount: c('engine_test_reaction_fixture_count', 'number', []),
    reactionContactCount: c('engine_test_reaction_contact_count', 'number',
      ['number']),
    spawnWorldAllowed: c('engine_test_spawn_world_allowed', 'number',
      ['number', 'number', 'number', 'number']),
    spawnWorldWeight: c('engine_test_spawn_world_weight', 'number',
      ['number', 'number', 'number', 'number']),
    spawnNaturalAt: c('engine_test_spawn_natural_at', 'number',
      ['number', 'number', 'number', 'number']),
    bodyState: c('engine_test_body_state', 'number', ['number', 'number', 'number']),
    setBodyMotion: c('engine_test_set_body_motion', 'number', ['number', 'number', 'number', 'number', 'number']),
    setBodySleeping: c('engine_test_set_body_sleeping', 'number', ['number', 'number']),
    freezeBodyCell: c('engine_test_freeze_body_cell', 'number',
      ['number', 'number', 'number', 'number', 'number', 'number']),
    setLiquidVelocity: c('engine_test_set_liquid_velocity', 'number',
      ['number', 'number', 'number', 'number', 'number', 'number']),
    rigidRejected: c('engine_test_rigid_rejected', 'number', ['number']),
    rigidDepen: c('engine_test_rigid_depen', 'number', ['number']),
    rigidSolverDiag: c('engine_test_rigid_solver_diag', 'number', ['number', 'number']),
    setRigidSolverOptions: c('engine_test_set_rigid_solver_options', null,
      ['number', 'number', 'number', 'number']),
    setRigidForceFullSolveBodies: c(
      'engine_test_set_rigid_force_full_solve_bodies', null,
      ['number', 'number']),
    setRigidWorldPositionLimit: c(
      'engine_test_set_rigid_world_position_limit', null,
      ['number', 'number']),
    setRigidPeerBiasScale: c('engine_test_set_rigid_peer_bias_scale', null,
      ['number', 'number']),
    setRigidTraceBody: c('engine_test_set_rigid_trace_body', null,
      ['number', 'number', 'number']),
    rigidTraceState: c('engine_test_rigid_trace_state', 'number',
      ['number', 'number']),
    rigidSpillProbe: c('engine_test_rigid_spill_probe', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']),
    setGroundingDebug: c('engine_test_set_grounding_debug', null, ['number', 'number', 'number']),
    groundingMismatches: c('engine_test_grounding_mismatches', 'number', ['number']),
    groundingDiag: c('engine_test_grounding_diag', 'number', ['number', 'number']),
    spawnParticle: c('engine_test_spawn_particle', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number']),
  };
  return T;
}

// Adds the test methods onto an engine handle (mutates + returns it).
export function attachTestHooks(engine) {
  const t = table();
  const { mod } = t;
  const ptr = engine.ptr;
  const readBodyState = (reader, ...args) => {
    const length = STRIDES.testBodyState;
    const buf = mod._malloc(length * Float64Array.BYTES_PER_ELEMENT);
    try {
      if (!reader(...args, buf)) return null;
      const base = buf / Float64Array.BYTES_PER_ELEMENT;
      return unpackSnapshotRecordAt(
        mod.HEAPF64.subarray(base, base + length), 'testBodyState', 0,
      );
    } finally {
      mod._free(buf);
    }
  };
  engine._bodyCount = () => t.bodyCount(ptr);
  engine._worldDirtyTileCount = () => t.worldDirtyTileCount(ptr);
  engine._componentStateCount = (layer = 0) =>
    t.componentStateCount(ptr, layer ? 1 : 0);
  engine._componentCount = (layer = 0) => t.componentCount(ptr, layer ? 1 : 0);
  engine._componentId = (layer, index) =>
    t.componentId(ptr, layer ? 1 : 0, index | 0);
  engine._replaceAttached = (layer, x, y, material, componentIndex) =>
    t.replaceAttached(ptr, layer ? 1 : 0, x | 0, y | 0,
      material | 0, componentIndex | 0);
  engine._replaceAttachedAfterLoose = (
    layer, x, y, looseMaterial, product, componentIndex,
  ) => t.replaceAttachedAfterLoose(ptr, layer ? 1 : 0, x | 0, y | 0,
    looseMaterial | 0, product | 0, componentIndex | 0);
  engine._replaceAttachedPair = (
    layer, x0, y0, x1, y1, material, componentIndex,
  ) => t.replaceAttachedPair(ptr, layer ? 1 : 0, x0 | 0, y0 | 0,
    x1 | 0, y1 | 0, material | 0, componentIndex | 0);
  engine._bodyBlocked = (i) => t.bodyBlocked(ptr, i);
  engine._bodyTerrainBlocked = (i) => t.bodyTerrainBlocked(ptr, i);
  engine._bodyBlockedLayer = (layer, i) =>
    t.bodyBlockedLayer(ptr, layer | 0, i | 0);
  engine._bodyTerrainBlockedLayer = (layer, i) =>
    t.bodyTerrainBlockedLayer(ptr, layer | 0, i | 0);
  engine._bodyTerrainBlocker = (layer, i) => ({
    cell: t.bodyTerrainBlocker(ptr, layer | 0, i | 0, 0),
    material: t.bodyTerrainBlocker(ptr, layer | 0, i | 0, 1),
    component: t.bodyTerrainBlocker(ptr, layer | 0, i | 0, 2),
    assembly: t.bodyTerrainBlocker(ptr, layer | 0, i | 0, 3),
  });
  engine._bodyOwnerBlockedGrid = (bodyLayer, i, probeLayer) =>
    t.bodyOwnerBlockedGrid(ptr, bodyLayer | 0, i | 0, probeLayer | 0);
  engine._bodyPrimaryBlocker = (bodyLayer, i, probeLayer) => ({
    id: t.bodyPrimaryBlocker(
      ptr, bodyLayer | 0, i | 0, probeLayer | 0, 0),
    count: t.bodyPrimaryBlocker(
      ptr, bodyLayer | 0, i | 0, probeLayer | 0, 1),
  });
  engine._worldContacts = () => Array.from(
    { length: t.worldContactCount(ptr) }, (_, i) => ({
      aLayer: t.worldContactState(ptr, i, 0),
      bLayer: t.worldContactState(ptr, i, 1),
      aId: t.worldContactState(ptr, i, 2),
      bId: t.worldContactState(ptr, i, 3),
      nx: t.worldContactState(ptr, i, 4),
      ny: t.worldContactState(ptr, i, 5),
      depth: t.worldContactState(ptr, i, 6),
      normalImpulse: t.worldContactState(ptr, i, 7),
      tangentImpulse: t.worldContactState(ptr, i, 8),
    }));
  engine._bodyAwake = (i) => t.bodyAwake(ptr, i);
  engine._bodyAwakeLayer = (layer, i) =>
    t.bodyAwakeLayer(ptr, layer | 0, i | 0);
  engine.getForceDebug = () => ({
    fullCoveragePasses: t.forceDiag(ptr, 0),
    candidateBinBuilds: t.forceDiag(ptr, 1),
    candidateCellsVisited: t.forceDiag(ptr, 2),
    staticSourceBuilds: t.forceDiag(ptr, 3),
    staticSourceReuses: t.forceDiag(ptr, 4),
    selectedBins: t.forceDiag(ptr, 5),
    neutroniumIndexBuilds: t.forceDiag(ptr, 6),
  });
  engine._bodyMaterial = (i) => t.bodyMaterial(ptr, i);
  engine._bodyChildCount = (i) => t.bodyChildCount(ptr, i);
  engine._bodyBlastDebris = (i) => t.bodyBlastDebris(ptr, i);
  engine._bodyCountLayer = (layer = 0) => t.bodyCountLayer(ptr, layer ? 1 : 0);
  engine._bodyIdLayer = (layer, i) => t.bodyIdLayer(ptr, layer ? 1 : 0, i);
  engine._bodyBlastDebrisLayer = (layer, i) => t.bodyBlastDebrisLayer(ptr, layer ? 1 : 0, i);
  engine._bodyJointRoleLayer = (layer, i) => t.bodyJointRoleLayer(ptr, layer ? 1 : 0, i);
  engine._bodyLookupPreservesPoseCache = (layer, i) =>
    t.bodyLookupPreservesPoseCache(ptr, layer ? 1 : 0, i | 0) === 1;
  engine._groundedGrid = (layer = 0) =>
    new Uint8Array(mod.HEAPU8.buffer, t.groundedPtr(ptr, layer ? 1 : 0), engine.cols * engine.rows);
  engine._bodyOwnerGrid = (layer = 0) =>
    new Int32Array(mod.HEAP32.buffer, t.bodyOwnerPtr(ptr, layer ? 1 : 0), engine.cols * engine.rows);
  engine._fallSpeedGrid = (layer = 0) =>
    new Uint8Array(mod.HEAPU8.buffer, t.fallSpeedPtr(ptr, layer ? 1 : 0), engine.cols * engine.rows);
  engine._liquidVelocityGrid = (layer = 0) =>
    new Uint32Array(mod.HEAPU8.buffer,
      t.liquidVelocityPtr(ptr, layer ? 1 : 0), engine.cols * engine.rows);
  engine._resetTopology = () => t.resetTopology(ptr);
  engine._dropJointBondCache = () => t.dropJointBondCache(ptr);
  engine._setBodyBlastDebris = (i, enabled = true) =>
    t.setBodyBlastDebris(ptr, i | 0, enabled ? 1 : 0) > 0;
  engine._detonateTnt = (cx, cy) => t.detonateTnt(ptr, cx | 0, cy | 0);
  engine._applyBlastImpulse = (body, cx, cy, radius, power) =>
    t.applyBlastImpulse(ptr, body | 0, cx | 0, cy | 0, radius | 0, power) > 0;
  engine._damagePlayer = (id, damage, sourceX = NaN, sourceY = NaN) =>
    t.damagePlayer(ptr, id | 0, damage | 0, sourceX, sourceY);
  engine._collectDynamicLights = () => t.collectDynamicLights(ptr);
  engine._applyCatalystProducts = (layer, sourceCell, neighborCell, product) =>
    t.applyCatalystProducts(ptr, layer ? 1 : 0, sourceCell | 0,
      neighborCell | 0, product | 0) === 1;
  engine._reactionFixture = (
    fixture, layer, sourceCell, targetCell = -1, sourceAge = 0, impact = 0,
  ) => t.reactionFixture(ptr, fixture | 0, layer ? 1 : 0,
    sourceCell | 0, targetCell | 0, sourceAge | 0, impact) === 1;
  engine._reactionFixtureCount = () => t.reactionFixtureCount();
  engine._reactionContactCount = () => t.reactionContactCount(ptr);
  engine._spawnNearFocus = (species, salt = 0) =>
    engine._testSpawnNearFocus(species, salt);
  engine._spawnWorldAllowed = (species, worldX, worldY) =>
    t.spawnWorldAllowed(ptr, species | 0, worldX, worldY) === 1;
  engine._spawnWorldWeight = (species, worldX, worldY) =>
    t.spawnWorldWeight(ptr, species | 0, worldX, worldY);
  engine._spawnNaturalAt = (species, worldX, worldY) =>
    t.spawnNaturalAt(ptr, species | 0, worldX, worldY);
  engine._bodyState = (i) => readBodyState(t.bodyState, ptr, i | 0);
  engine._bodyStateLayer = (layer, i) =>
    readBodyState(t.bodyStateLayer, ptr, layer ? 1 : 0, i | 0);
  engine._spawnBoxLayer = (layer, cx, cy, halfW, halfH, material) =>
    t.spawnBoxLayer(ptr, layer ? 1 : 0, cx | 0, cy | 0, halfW | 0, halfH | 0, material | 0);
  engine._activeLayer = () => t.activeLayer(ptr);
  engine._layerBuffersValid = (layer = 0) =>
    t.layerBuffersValid(ptr, layer ? 1 : 0) === 1;
  engine._layerBufferPhase = (layer = 0) =>
    t.layerBufferPhase(ptr, layer ? 1 : 0);
  engine._setMotionSentinel = (layer, cell, value = 0x5a5a5a5a) =>
    t.setMotionSentinel(ptr, layer ? 1 : 0, cell | 0, value | 0) === 1;
  engine._motionCellZero = (layer, cell) =>
    t.motionCellZero(ptr, layer ? 1 : 0, cell | 0) === 1;
  engine._motionCellState = (layer, cell) => {
    const channels = t.motionChannelCount();
    const buf = mod._malloc(channels * 2 * 8);
    const count = t.motionCellState(ptr, layer ? 1 : 0, cell | 0, buf);
    const values = count > 0
      ? Array.from(mod.HEAPF64.subarray(buf >> 3, (buf >> 3) + count)) : null;
    mod._free(buf);
    return values;
  };
  engine._setBodyMotion = (i, vx, vy, omega = 0) => t.setBodyMotion(ptr, i | 0, vx, vy, omega) > 0;
  engine._setBodySleeping = (i) => t.setBodySleeping(ptr, i | 0) > 0;
  engine._freezeBodyCell = (sourceLayer, bodyIndex, targetLayer, x, y) =>
    t.freezeBodyCell(ptr, sourceLayer ? 1 : 0, bodyIndex | 0,
      targetLayer ? 1 : 0, x | 0, y | 0) > 0;
  engine._setLiquidVelocity = (layer, x, y, vx, vy) =>
    t.setLiquidVelocity(ptr, layer ? 1 : 0, x | 0, y | 0, vx, vy) > 0;
  engine.getRigidDebug = () => ({ rejectedCells: t.rigidRejected(ptr), depenetrations: t.rigidDepen(ptr) });
  engine.getRigidSolverDebug = () => ({
    substeps: t.rigidSolverDiag(ptr, 0),
    contacts: t.rigidSolverDiag(ptr, 1),
    warmStarted: t.rigidSolverDiag(ptr, 2),
    velocityIterations: t.rigidSolverDiag(ptr, 3),
    biasIterations: t.rigidSolverDiag(ptr, 4),
    maxContactDepth: t.rigidSolverDiag(ptr, 5),
    islands: t.rigidSolverDiag(ptr, 6),
    blockSolves: t.rigidSolverDiag(ptr, 7),
    islandBodySteps: t.rigidSolverDiag(ptr, 8),
    globalBodySteps: t.rigidSolverDiag(ptr, 9),
    childPairs: t.rigidSolverDiag(ptr, 10),
    childManifolds: t.rigidSolverDiag(ptr, 11),
    sweepFallbacks: t.rigidSolverDiag(ptr, 12),
    maxChildren: t.rigidSolverDiag(ptr, 13),
    fluidNodes: t.rigidSolverDiag(ptr, 14),
    fluidFaces: t.rigidSolverDiag(ptr, 15),
    fluidIterations: t.rigidSolverDiag(ptr, 16),
    spillDisplaced: t.rigidSolverDiag(ptr, 17),
    spillVisits: t.rigidSolverDiag(ptr, 18),
    spillSearches: t.rigidSolverDiag(ptr, 19),
    fluidCorrectorPasses: t.rigidSolverDiag(ptr, 20),
    fluidInitialMs: t.rigidSolverDiag(ptr, 21),
    fluidCorrectorMs: t.rigidSolverDiag(ptr, 22),
    rigidCoreMs: t.rigidSolverDiag(ptr, 23),
    rigidClearMs: t.rigidSolverDiag(ptr, 24),
    rigidDepenMs: t.rigidSolverDiag(ptr, 25),
    rigidStampMs: t.rigidSolverDiag(ptr, 26),
    rigidSpillMs: t.rigidSolverDiag(ptr, 27),
    fluidCorrectorBodies: t.rigidSolverDiag(ptr, 28),
    fluidReferenceMs: t.rigidSolverDiag(ptr, 29),
    fluidDomainMs: t.rigidSolverDiag(ptr, 30),
    fluidMatrixMs: t.rigidSolverDiag(ptr, 31),
    fluidSolveMs: t.rigidSolverDiag(ptr, 32),
    fluidWritebackMs: t.rigidSolverDiag(ptr, 33),
    coherentIslands: t.rigidSolverDiag(ptr, 34),
    denseFallbackIslands: t.rigidSolverDiag(ptr, 35),
    maxRelativeSpeed: t.rigidSolverDiag(ptr, 36),
    terrainRiskBodies: t.rigidSolverDiag(ptr, 37),
    impactRiskBodies: t.rigidSolverDiag(ptr, 38),
    ownershipConflicts: t.rigidSolverDiag(ptr, 39),
    positionCorrections: t.rigidSolverDiag(ptr, 40),
    recoveryBodies: t.rigidSolverDiag(ptr, 41),
    terrainRecoveryBodies: t.rigidSolverDiag(ptr, 93),
    stampRecoveryBodies: t.rigidSolverDiag(ptr, 94),
    rasterPlaceholderBodies: t.rigidSolverDiag(ptr, 95),
    spawnSeparations: t.rigidSolverDiag(ptr, 96),
    spawnSeparationFailures: t.rigidSolverDiag(ptr, 97),
    spawnMaxSeparation: t.rigidSolverDiag(ptr, 98),
    rasterCorrections: t.rigidSolverDiag(ptr, 84),
    rasterProjectionFailures: t.rigidSolverDiag(ptr, 85),
    rasterMaxCorrection: t.rigidSolverDiag(ptr, 86),
    childTransforms: t.rigidSolverDiag(ptr, 42),
    velocityConstraintEvals: t.rigidSolverDiag(ptr, 43),
    biasConstraintEvals: t.rigidSolverDiag(ptr, 44),
    maxVelocityResidual: t.rigidSolverDiag(ptr, 45),
    maxBiasResidual: t.rigidSolverDiag(ptr, 46),
    maxPenetrationResidual: t.rigidSolverDiag(ptr, 47),
    shockIslands: t.rigidSolverDiag(ptr, 48),
    shockConstraintEvals: t.rigidSolverDiag(ptr, 49),
    shockFallbacks: t.rigidSolverDiag(ptr, 50),
    shockMaxLayers: t.rigidSolverDiag(ptr, 51),
    shockSkipped: t.rigidSolverDiag(ptr, 52),
    rigidPrepareMs: t.rigidSolverDiag(ptr, 53),
    rigidFinalizeMs: t.rigidSolverDiag(ptr, 54),
    rigidContactMs: t.rigidSolverDiag(ptr, 55),
    rigidSolveMs: t.rigidSolverDiag(ptr, 56),
    rigidPairContactMs: t.rigidSolverDiag(ptr, 57),
    rigidTerrainContactMs: t.rigidSolverDiag(ptr, 58),
    terrainSamples: t.rigidSolverDiag(ptr, 59),
    terrainSamplesSkipped: t.rigidSolverDiag(ptr, 60),
    granularBodiesSkipped: t.rigidSolverDiag(ptr, 61),
    rigidMotionPrepMs: t.rigidSolverDiag(ptr, 62),
    rigidIntegrateMs: t.rigidSolverDiag(ptr, 63),
    rigidStepPrepareMs: t.rigidSolverDiag(ptr, 64),
    rigidContactSetupMs: t.rigidSolverDiag(ptr, 65),
    rigidStepFinalizeMs: t.rigidSolverDiag(ptr, 66),
    rigidOccupancyBuildMs: t.rigidSolverDiag(ptr, 67),
    rigidCadenceMs: t.rigidSolverDiag(ptr, 68),
    rigidFluidCoupleMs: t.rigidSolverDiag(ptr, 69),
    rigidFluidReferenceTotalMs: t.rigidSolverDiag(ptr, 70),
    rigidFluidDomainTotalMs: t.rigidSolverDiag(ptr, 71),
    rigidFluidMatrixTotalMs: t.rigidSolverDiag(ptr, 72),
    rigidFluidSolveTotalMs: t.rigidSolverDiag(ptr, 73),
    rigidFluidWritebackTotalMs: t.rigidSolverDiag(ptr, 74),
    rigidFluidNodesTotal: t.rigidSolverDiag(ptr, 75),
    rigidFluidFacesTotal: t.rigidSolverDiag(ptr, 76),
    rigidFluidIterationsTotal: t.rigidSolverDiag(ptr, 77),
    rigidFluidDryReferencesSkipped: t.rigidSolverDiag(ptr, 78),
    rigidBakeMs: t.rigidSolverDiag(ptr, 79),
    rigidBakedCells: t.rigidSolverDiag(ptr, 80),
    rigidBakeSupportMs: t.rigidSolverDiag(ptr, 81),
    rigidBakeRasterMs: t.rigidSolverDiag(ptr, 82),
    rigidBakeRegisterMs: t.rigidSolverDiag(ptr, 83),
    worldRelaxBodies: t.rigidSolverDiag(ptr, 87),
    worldRelaxContacts: t.rigidSolverDiag(ptr, 88),
    worldPositionIterations: t.rigidSolverDiag(ptr, 89),
    worldMaxPositionTranslation: t.rigidSolverDiag(ptr, 90),
    worldMaxPositionRotation: t.rigidSolverDiag(ptr, 91),
    worldPositionLimitHits: t.rigidSolverDiag(ptr, 92),
  });
  engine._setRigidSolverOptions = (mode, residualTolerance = 1e-4,
    minIterations = 4) => t.setRigidSolverOptions(
    ptr, mode | 0, residualTolerance, minIterations | 0);
  engine._setRigidForceFullSolveBodies = (bodyCount) =>
    t.setRigidForceFullSolveBodies(ptr, bodyCount | 0);
  engine._setRigidWorldPositionLimit = (limit) =>
    t.setRigidWorldPositionLimit(ptr, limit);
  engine._setRigidPeerBiasScale = (scale) =>
    t.setRigidPeerBiasScale(ptr, scale);
  engine._setRigidTraceBody = (layer, id) =>
    t.setRigidTraceBody(ptr, layer | 0, id | 0);
  engine._rigidTracePoses = () => {
    const mask = t.rigidTraceState(ptr, 0) >>> 0;
    const poses = Array.from({ length: 10 }, (_, stage) => ({
      px: t.rigidTraceState(ptr, 1 + stage * 3),
      py: t.rigidTraceState(ptr, 2 + stage * 3),
      angle: t.rigidTraceState(ptr, 3 + stage * 3),
    }));
    const vector = (field) => ({
      dx: t.rigidTraceState(ptr, field),
      dy: t.rigidTraceState(ptr, field + 1),
      da: t.rigidTraceState(ptr, field + 2),
    });
    return {
      mask,
      poses,
      velocityMotion: vector(31),
      biasMotion: vector(34),
      projectionMotion: vector(37),
      biasByKind: {
        terrain: vector(40),
        sameLayer: vector(43),
        crossLayer: vector(46),
      },
    };
  };
  engine._rigidSpillProbe = (sourceX, sourceY, x0, y0, x1, y1, material) =>
    t.rigidSpillProbe(ptr, sourceX | 0, sourceY | 0, x0 | 0, y0 | 0, x1 | 0, y1 | 0, material | 0);
  engine.setGroundingDebug = (verify, forceFull) => t.setGroundingDebug(ptr, verify ? 1 : 0, forceFull ? 1 : 0);
  engine.groundingMismatches = () => t.groundingMismatches(ptr);
  engine.groundingDiag = () => ({
    fast: t.groundingDiag(ptr, 0), edge: t.groundingDiag(ptr, 1), powder: t.groundingDiag(ptr, 2),
    cut: t.groundingDiag(ptr, 3), span: t.groundingDiag(ptr, 4), cutCap: t.groundingDiag(ptr, 5), cutOpen: t.groundingDiag(ptr, 6),
  });
  engine.spawnParticle = (material, px, py, vx = 0, vy = 0, life = 0) => t.spawnParticle(ptr, material | 0, px, py, vx, vy, life | 0);
  return engine;
}
