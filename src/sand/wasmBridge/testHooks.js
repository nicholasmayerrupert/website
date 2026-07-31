// Test/diagnostic hooks for the sand engine — imported ONLY by scripts/ (tests
// and benches), never by the browser bundle. The C ABI names carry an
// engine_test_ prefix so the test surface is distinguishable from the
// production API.
//
//   import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
//   const e = attachTestHooks(createEngineWasm({...}));
//   e._bodyState(0); e.setGroundingDebug(true, false); ...

import { _wasmInternals } from './engineFactory.js';

let T = null; // lazily cwrapped test-ABI table
function table() {
  if (T) return T;
  const M = _wasmInternals();
  if (!M) throw new Error('initSandWasm() must resolve before attachTestHooks()');
  const c = (name, ret, args) => M.mod.cwrap(name, ret, args);
  T = {
    mod: M.mod,
    bodyCount: c('engine_test_body_count', 'number', ['number']),
    bodyBlocked: c('engine_test_body_blocked', 'number', ['number', 'number']),
    bodyAwake: c('engine_test_body_awake', 'number', ['number', 'number']),
    bodyMaterial: c('engine_test_body_material', 'number', ['number', 'number']),
    bodyChildCount: c('engine_test_body_child_count', 'number', ['number', 'number']),
    bodyBlastDebris: c('engine_test_body_blast_debris', 'number', ['number', 'number']),
    bodyCountLayer: c('engine_test_body_count_layer', 'number', ['number', 'number']),
    bodyIdLayer: c('engine_test_body_id_layer', 'number', ['number', 'number', 'number']),
    bodyBlastDebrisLayer: c('engine_test_body_blast_debris_layer', 'number', ['number', 'number', 'number']),
    bodyJointRoleLayer: c('engine_test_body_joint_role_layer', 'number', ['number', 'number', 'number']),
    bodyStateLayer: c('engine_test_body_state_layer', 'number', ['number', 'number', 'number', 'number']),
    spawnBoxLayer: c('engine_test_spawn_box_layer', 'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number']),
    groundedPtr: c('engine_test_grounded_ptr', 'number', ['number', 'number']),
    bodyOwnerPtr: c('engine_test_body_owner_ptr', 'number', ['number', 'number']),
    fallSpeedPtr: c('engine_test_fall_speed_ptr', 'number', ['number', 'number']),
    resetTopology: c('engine_test_reset_topology', null, ['number']),
    dropJointBondCache: c('engine_test_drop_joint_bond_cache', null, ['number']),
    setBodyBlastDebris: c('engine_test_set_body_blast_debris', 'number', ['number', 'number', 'number']),
    detonateTnt: c('engine_test_detonate_tnt', null, ['number', 'number', 'number']),
    damagePlayer: c('engine_test_damage_player', 'number',
      ['number', 'number', 'number', 'number', 'number']),
    collectDynamicLights: c('engine_test_collect_dynamic_lights', 'number', ['number']),
    spawnNearFocus: c('engine_test_spawn_near_focus', 'number',
      ['number', 'number', 'number']),
    spawnWorldAllowed: c('engine_test_spawn_world_allowed', 'number',
      ['number', 'number', 'number', 'number']),
    spawnWorldWeight: c('engine_test_spawn_world_weight', 'number',
      ['number', 'number', 'number', 'number']),
    spawnNaturalAt: c('engine_test_spawn_natural_at', 'number',
      ['number', 'number', 'number', 'number']),
    bodyState: c('engine_test_body_state', 'number', ['number', 'number', 'number']),
    setBodyMotion: c('engine_test_set_body_motion', 'number', ['number', 'number', 'number', 'number', 'number']),
    setLiquidVelocity: c('engine_test_set_liquid_velocity', 'number',
      ['number', 'number', 'number', 'number', 'number', 'number']),
    rigidRejected: c('engine_test_rigid_rejected', 'number', ['number']),
    rigidDepen: c('engine_test_rigid_depen', 'number', ['number']),
    rigidSolverDiag: c('engine_test_rigid_solver_diag', 'number', ['number', 'number']),
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
  engine._bodyCount = () => t.bodyCount(ptr);
  engine._bodyBlocked = (i) => t.bodyBlocked(ptr, i);
  engine._bodyAwake = (i) => t.bodyAwake(ptr, i);
  engine._bodyMaterial = (i) => t.bodyMaterial(ptr, i);
  engine._bodyChildCount = (i) => t.bodyChildCount(ptr, i);
  engine._bodyBlastDebris = (i) => t.bodyBlastDebris(ptr, i);
  engine._bodyCountLayer = (layer = 0) => t.bodyCountLayer(ptr, layer ? 1 : 0);
  engine._bodyIdLayer = (layer, i) => t.bodyIdLayer(ptr, layer ? 1 : 0, i);
  engine._bodyBlastDebrisLayer = (layer, i) => t.bodyBlastDebrisLayer(ptr, layer ? 1 : 0, i);
  engine._bodyJointRoleLayer = (layer, i) => t.bodyJointRoleLayer(ptr, layer ? 1 : 0, i);
  engine._groundedGrid = (layer = 0) =>
    new Uint8Array(mod.HEAPU8.buffer, t.groundedPtr(ptr, layer ? 1 : 0), engine.cols * engine.rows);
  engine._bodyOwnerGrid = (layer = 0) =>
    new Int32Array(mod.HEAP32.buffer, t.bodyOwnerPtr(ptr, layer ? 1 : 0), engine.cols * engine.rows);
  engine._fallSpeedGrid = (layer = 0) =>
    new Uint8Array(mod.HEAPU8.buffer, t.fallSpeedPtr(ptr, layer ? 1 : 0), engine.cols * engine.rows);
  engine._resetTopology = () => t.resetTopology(ptr);
  engine._dropJointBondCache = () => t.dropJointBondCache(ptr);
  engine._setBodyBlastDebris = (i, enabled = true) =>
    t.setBodyBlastDebris(ptr, i | 0, enabled ? 1 : 0) > 0;
  engine._detonateTnt = (cx, cy) => t.detonateTnt(ptr, cx | 0, cy | 0);
  engine._damagePlayer = (id, damage, sourceX = NaN, sourceY = NaN) =>
    t.damagePlayer(ptr, id | 0, damage | 0, sourceX, sourceY);
  engine._collectDynamicLights = () => t.collectDynamicLights(ptr);
  engine._spawnNearFocus = (species, salt = 0) =>
    t.spawnNearFocus(ptr, species | 0, salt | 0) === 1;
  engine._spawnWorldAllowed = (species, worldX, worldY) =>
    t.spawnWorldAllowed(ptr, species | 0, worldX, worldY) === 1;
  engine._spawnWorldWeight = (species, worldX, worldY) =>
    t.spawnWorldWeight(ptr, species | 0, worldX, worldY);
  engine._spawnNaturalAt = (species, worldX, worldY) =>
    t.spawnNaturalAt(ptr, species | 0, worldX, worldY);
  // Continuous pose/motion of body i: { px, py, angle, vx, vy, omega, nPts, maxR } or null.
  engine._bodyState = (i) => {
    const buf = mod._malloc(8 * 8);
    const ok = t.bodyState(ptr, i | 0, buf);
    if (!ok) { mod._free(buf); return null; }
    const base = buf >> 3;
    const s = {
      px: mod.HEAPF64[base], py: mod.HEAPF64[base + 1], angle: mod.HEAPF64[base + 2],
      vx: mod.HEAPF64[base + 3], vy: mod.HEAPF64[base + 4], omega: mod.HEAPF64[base + 5],
      nPts: mod.HEAPF64[base + 6], maxR: mod.HEAPF64[base + 7],
    };
    mod._free(buf);
    return s;
  };
  engine._bodyStateLayer = (layer, i) => {
    const buf = mod._malloc(8 * 8);
    const ok = t.bodyStateLayer(ptr, layer ? 1 : 0, i | 0, buf);
    if (!ok) { mod._free(buf); return null; }
    const base = buf >> 3;
    const s = {
      px: mod.HEAPF64[base], py: mod.HEAPF64[base + 1], angle: mod.HEAPF64[base + 2],
      vx: mod.HEAPF64[base + 3], vy: mod.HEAPF64[base + 4], omega: mod.HEAPF64[base + 5],
      nPts: mod.HEAPF64[base + 6], maxR: mod.HEAPF64[base + 7],
    };
    mod._free(buf);
    return s;
  };
  engine._spawnBoxLayer = (layer, cx, cy, halfW, halfH, material) =>
    t.spawnBoxLayer(ptr, layer ? 1 : 0, cx | 0, cy | 0, halfW | 0, halfH | 0, material | 0);
  engine._setBodyMotion = (i, vx, vy, omega = 0) => t.setBodyMotion(ptr, i | 0, vx, vy, omega) > 0;
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
  });
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
