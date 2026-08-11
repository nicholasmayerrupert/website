// A closed TNT cut through untouched two-layer cave terrain creates the same
// large, hollow, irregular rubble seen after a creative-mode cave demolition.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = Number.parseInt(process.env.COLS ?? '640', 10);
const ROWS = Number.parseInt(process.env.ROWS ?? '480', 10);
const STEPS = Number.parseInt(process.env.STEPS ?? '900', 10);
const SEED = Number.parseInt(process.env.SEED ?? '2667084199', 10) >>> 0;
const SOLVER_MODE = Number.parseInt(
  process.env.RIGID_SOLVER_MODE ?? '2', 10);
const WORLD_POSITION_LIMIT = Number.parseFloat(
  process.env.WORLD_POSITION_LIMIT ?? '0.5');
const PEER_BIAS_SCALE = Number.parseFloat(
  process.env.PEER_BIAS_SCALE ?? '1');
const CAPTURE_DIR = process.env.CAPTURE_DIR
  ? resolve(process.env.CAPTURE_DIR) : '';
const OWNER_DIAGNOSTICS = process.env.OWNER_DIAGNOSTICS === '1';
const FOCUS_BODY = process.env.FOCUS_BODY ?? '';
const CAPTURE_TICKS = new Set((process.env.CAPTURE_TICKS ?? '')
  .split(',').map((value) => Number.parseInt(value, 10))
  .filter(Number.isFinite));

const sizeClass = (state) => {
  if (state.nPts <= 16) return 'tiny';
  if (state.nPts < 256) return 'small';
  if (state.nPts < 4096 && state.maxR < 64) return 'medium';
  return 'structure';
};

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const output = Buffer.allocUnsafe(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  body.copy(output, 4);
  output.writeUInt32BE(crc32(body), data.length + 8);
  return output;
};
const encodePng = (width, height, rgba) => {
  const stride = width * 4;
  const rows = Buffer.allocUnsafe((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    rows[row] = 0;
    rgba.copy(rows, row + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows, { level: 3 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

const capture = (engine, tick) => {
  if (!CAPTURE_DIR) return;
  engine.renderFullLayer(1);
  const background = engine.getRenderPixelsLayer(1).slice();
  engine.renderFullLayer(0);
  const foreground = engine.getRenderPixelsLayer(0);
  const fg = engine.getGrid();
  const rgba = Buffer.from(background);
  for (let cell = 0; cell < COLS * ROWS; cell++) {
    const pixel = cell * 4;
    if (fg[cell] !== MAT.EMPTY) {
      rgba[pixel] = foreground[pixel];
      rgba[pixel + 1] = foreground[pixel + 1];
      rgba[pixel + 2] = foreground[pixel + 2];
    } else {
      rgba[pixel] = Math.round(rgba[pixel] * 0.58);
      rgba[pixel + 1] = Math.round(rgba[pixel + 1] * 0.58);
      rgba[pixel + 2] = Math.round(rgba[pixel + 2] * 0.58);
    }
    rgba[pixel + 3] = 255;
  }
  mkdirSync(CAPTURE_DIR, { recursive: true });
  writeFileSync(resolve(CAPTURE_DIR,
    `${String(tick).padStart(4, '0')}.png`),
  encodePng(COLS, ROWS, rgba));
};

const perimeter = (left, top, right, bottom, spacing) => {
  const cells = [];
  for (let x = left; x <= right; x += spacing) cells.push([x, top]);
  for (let y = top + spacing; y <= bottom; y += spacing)
    cells.push([right, y]);
  for (let x = right - spacing; x >= left; x -= spacing)
    cells.push([x, bottom]);
  for (let y = bottom - spacing; y > top; y -= spacing)
    cells.push([left, y]);
  return cells;
};
const line = (x0, y0, x1, y1, spacing) => {
  const length = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const count = Math.max(1, Math.ceil(length / spacing));
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    return [Math.round(x0 + (x1 - x0) * t),
      Math.round(y0 + (y1 - y0) * t)];
  });
};

await initSandWasm();
const engine = attachTestHooks(createEngineWasmRaw({
  cols: COLS,
  rows: ROWS,
  worldSeed: SEED,
  sinksOn: false,
  infinite: true,
}));
engine.setBgEnabled(true);
engine._setRigidSolverOptions(SOLVER_MODE, 0.0001, 4);
engine._setRigidWorldPositionLimit(WORLD_POSITION_LIMIT);
engine._setRigidPeerBiasScale(PEER_BIAS_SCALE);
if (FOCUS_BODY) {
  const [focusLayer, focusId] = FOCUS_BODY.split(':').map(Number);
  engine._setRigidTraceBody(focusLayer, focusId);
}

const marginX = Math.max(64, Math.round(COLS * 0.13));
const top = Math.max(144, Math.round(ROWS * 0.31));
const bottom = Math.min(ROWS - 112, Math.round(ROWS * 0.68));
const left = marginX, right = COLS - marginX;
const width = right - left, height = bottom - top;
const rawSites = [
  ...perimeter(left, top, right, bottom, 7),
  ...line(left + Math.round(width * 0.27), top,
    left + Math.round(width * 0.40), bottom, 7),
  ...line(left + Math.round(width * 0.72), top,
    left + Math.round(width * 0.60), bottom, 7),
  ...line(left, top + Math.round(height * 0.48),
    right, top + Math.round(height * 0.60), 7),
];
const sites = [...new Map(rawSites.map(([x, y]) =>
  [`${x},${y}`, [x, y]])).values()];
for (const [x, y] of sites)
  engine.paintDiscLayer(0, x, y, 2, MAT.TNT, false);
engine.syncComponentsLayer(0);
capture(engine, 0);

const tracks = new Map();
const focusTrack = [];
let peakBodies = 0, peakJointBodies = 0;
let maxCells = 0, maxRadius = 0;
let maxBodyOverlap = 0, maxTerrainOverlap = 0;
let lateBodyOverlap = 0, lateTerrainOverlap = 0;
let latePeakOverlapTick = -1, latePeakOverlapBodies = [];
let latePeakOverlapSolver = null;
let peakOverlapTick = -1, peakTerrainTick = -1;
let peakOverlapBodies = [], peakTerrainBodies = [];
let peakOverlapSolver = null, peakTerrainSolver = null;
let maxConflicts = 0, totalRecoveries = 0, recoveryTicks = 0;
let totalTerrainRecoveries = 0, totalStampRecoveries = 0;
let totalRasterPlaceholders = 0;
let totalPositionCorrections = 0, totalRasterCorrections = 0;
let totalRasterProjectionFailures = 0, totalWorldPositionLimitHits = 0;
let maxSolverSubsteps = 0, maxContactDepth = 0;
let maxVelocityResidual = 0, maxBiasResidual = 0;
let totalVelocityConstraintEvals = 0, totalBiasConstraintEvals = 0;
let totalWorldRelaxContacts = 0, totalWorldPositionIterations = 0;
let totalShockIslands = 0, totalShockFallbacks = 0;
let maxStampRecoveryStreak = 0, maxStampRecoveryTotal = 0;
let peakStampRecoveryBodies = [];
const lateOverlapBySize = Object.fromEntries(
  ['tiny', 'small', 'medium', 'structure'].map((name) =>
    [name, { body: 0, terrain: 0 }]));
let finalAwake = 0, finalBodies = 0;
let settledAt = -1, quietTicks = 0;
let stepWallMs = 0;
let firstSevereFailure = null;
let firstStructureFailure = null;
const structureHistory = new Map();
const structureBirths = [];
const structureFailures = [];
const failedStructures = new Set();
const blastTicks = Math.ceil(sites.length / 5);

for (let tick = 0; tick < STEPS; tick++) {
  for (let index = tick * 5;
       index < Math.min(sites.length, (tick + 1) * 5); index++)
    engine._detonateTnt(sites[index][0], sites[index][1]);
  const started = performance.now();
  engine.stepWorld();
  stepWallMs += performance.now() - started;

  let bodies = 0, awake = 0, jointBodies = 0;
  const tickStates = [];
  for (let layer = 0; layer < 2; layer++) {
    for (let body = 0; body < engine._bodyCountLayer(layer); body++) {
      if (engine._bodyJointRoleLayer(layer, body) === 2) continue;
      bodies++;
      awake += engine._bodyAwakeLayer(layer, body) > 0;
      jointBodies += engine._bodyJointRoleLayer(layer, body) === 1;
      const state = engine._bodyStateLayer(layer, body);
      maxCells = Math.max(maxCells, state.nPts);
      maxRadius = Math.max(maxRadius, state.maxR);
      const blocked = engine._bodyBlockedLayer(layer, body);
      const terrain = engine._bodyTerrainBlockedLayer(layer, body);
      const ownerFg = OWNER_DIAGNOSTICS
        ? engine._bodyOwnerBlockedGrid(layer, body, 0) : -1;
      const ownerBg = OWNER_DIAGNOSTICS
        ? engine._bodyOwnerBlockedGrid(layer, body, 1) : -1;
      const blockerFg = OWNER_DIAGNOSTICS
        ? engine._bodyPrimaryBlocker(layer, body, 0) : null;
      const blockerBg = OWNER_DIAGNOSTICS
        ? engine._bodyPrimaryBlocker(layer, body, 1) : null;
      tickStates.push({ layer, body,
        id: engine._bodyIdLayer(layer, body),
        role: engine._bodyJointRoleLayer(layer, body),
        blocked, terrain, ownerFg, ownerBg, blockerFg, blockerBg,
        awake: engine._bodyAwakeLayer(layer, body) > 0,
        ...state });
      if (state.stampRecoveryStreak > maxStampRecoveryStreak) {
        maxStampRecoveryStreak = state.stampRecoveryStreak;
        peakStampRecoveryBodies = [{ layer,
          id: engine._bodyIdLayer(layer, body), ...state }];
      } else if (state.stampRecoveryStreak === maxStampRecoveryStreak
          && state.stampRecoveryStreak > 0) {
        peakStampRecoveryBodies.push({ layer,
          id: engine._bodyIdLayer(layer, body), ...state });
      }
      maxStampRecoveryTotal = Math.max(maxStampRecoveryTotal,
        state.stampRecoveryTotal);
      const id = engine._bodyIdLayer(layer, body);
      const key = `${layer}:${id}`;
      if (key === FOCUS_BODY) focusTrack.push({
        tick, role: engine._bodyJointRoleLayer(layer, body),
        blocked, terrain, ownerFg, ownerBg, blockerFg, blockerBg,
        terrainBlocker: OWNER_DIAGNOSTICS
          ? engine._bodyTerrainBlocker(layer, body) : null,
        ...state,
        phaseTrace: engine._rigidTracePoses(),
        contacts: OWNER_DIAGNOSTICS ? engine._worldContacts().filter(
          (contact) => contact.aId === id
            || contact.bId === id) : [],
      });
      let track = tracks.get(key);
      if (!track) tracks.set(key, track = []);
      if (tick >= STEPS - 240) track.push({
        tick, awake: engine._bodyAwakeLayer(layer, body) > 0,
        ...state,
      });
    }
  }
  const tickBodyOverlap = Math.max(0,
    ...tickStates.map((state) => state.blocked));
  const tickTerrainOverlap = Math.max(0,
    ...tickStates.map((state) => state.terrain));
  if (!firstSevereFailure
      && (tickBodyOverlap > 10 || tickTerrainOverlap > 3)) {
    firstSevereFailure = {
      tick,
      bodyOverlap: tickBodyOverlap,
      terrainOverlap: tickTerrainOverlap,
      bodies: tickStates.filter((state) =>
        state.blocked > 0 || state.terrain > 0),
      solver: engine.getRigidSolverDebug(),
    };
    capture(engine, tick + 1);
  }
  for (const state of tickStates) {
    if (state.nPts < 4096 && state.maxR < 64) continue;
    const key = `${state.layer}:${state.id}`;
    let history = structureHistory.get(key);
    if (!history) {
      structureHistory.set(key, history = []);
      structureBirths.push({ tick, ...state });
    }
    history.push({ tick, ...state });
    if (history.length > 4) history.shift();
    if (!firstStructureFailure
        && (state.blocked > 10 || state.terrain > 3)) {
      firstStructureFailure = {
        tick,
        key,
        history: history.slice(),
        solver: engine.getRigidSolverDebug(),
      };
      capture(engine, tick + 1);
    }
    if (!failedStructures.has(key)
        && (state.blocked > 10 || state.terrain > 3)) {
      failedStructures.add(key);
      structureFailures.push({
        tick,
        key,
        history: history.slice(),
        solver: engine.getRigidSolverDebug(),
      });
    }
  }
  if (tickBodyOverlap > maxBodyOverlap) {
    maxBodyOverlap = tickBodyOverlap;
    peakOverlapTick = tick;
    peakOverlapBodies = tickStates.filter((state) => state.blocked > 0);
    peakOverlapSolver = engine.getRigidSolverDebug();
    if (OWNER_DIAGNOSTICS)
      peakOverlapSolver.worldContacts = engine._worldContacts();
  }
  if (tickTerrainOverlap > maxTerrainOverlap) {
    maxTerrainOverlap = tickTerrainOverlap;
    peakTerrainTick = tick;
    peakTerrainBodies = tickStates.filter((state) => state.terrain > 0);
    peakTerrainSolver = engine.getRigidSolverDebug();
  }
  if (tick >= blastTicks + 60) {
    if (tickBodyOverlap > lateBodyOverlap) {
      lateBodyOverlap = tickBodyOverlap;
      latePeakOverlapTick = tick;
      latePeakOverlapBodies = tickStates.filter(
        (state) => state.blocked > 0);
      latePeakOverlapSolver = engine.getRigidSolverDebug();
      if (OWNER_DIAGNOSTICS)
        latePeakOverlapSolver.worldContacts = engine._worldContacts();
    }
    lateTerrainOverlap = Math.max(lateTerrainOverlap, tickTerrainOverlap);
    for (const state of tickStates) {
      const bucket = lateOverlapBySize[sizeClass(state)];
      bucket.body = Math.max(bucket.body, state.blocked);
      bucket.terrain = Math.max(bucket.terrain, state.terrain);
    }
  }
  peakBodies = Math.max(peakBodies, bodies);
  peakJointBodies = Math.max(peakJointBodies, jointBodies);
  const solver = engine.getRigidSolverDebug();
  maxConflicts = Math.max(maxConflicts, solver.ownershipConflicts);
  totalPositionCorrections += solver.positionCorrections;
  totalRasterCorrections += solver.rasterCorrections;
  totalRasterProjectionFailures += solver.rasterProjectionFailures;
  totalWorldPositionLimitHits += solver.worldPositionLimitHits;
  maxSolverSubsteps = Math.max(maxSolverSubsteps, solver.substeps);
  maxContactDepth = Math.max(maxContactDepth, solver.maxContactDepth);
  maxVelocityResidual = Math.max(
    maxVelocityResidual, solver.maxVelocityResidual);
  maxBiasResidual = Math.max(maxBiasResidual, solver.maxBiasResidual);
  totalVelocityConstraintEvals += solver.velocityConstraintEvals;
  totalBiasConstraintEvals += solver.biasConstraintEvals;
  totalWorldRelaxContacts += solver.worldRelaxContacts;
  totalWorldPositionIterations += solver.worldPositionIterations;
  totalShockIslands += solver.shockIslands;
  totalShockFallbacks += solver.shockFallbacks;
  if (awake > 0) {
    totalRecoveries += solver.recoveryBodies;
    totalTerrainRecoveries += solver.terrainRecoveryBodies;
    totalStampRecoveries += solver.stampRecoveryBodies;
    totalRasterPlaceholders += solver.rasterPlaceholderBodies;
    recoveryTicks += solver.recoveryBodies > 0;
  }
  if (tick >= blastTicks && awake === 0) quietTicks++;
  else quietTicks = 0;
  if (settledAt < 0 && quietTicks >= 30) settledAt = tick - 29;
  if (CAPTURE_DIR && ([59, 119, 239, 479, STEPS - 1].includes(tick)
      || CAPTURE_TICKS.has(tick)))
    capture(engine, tick + 1);
  finalAwake = awake;
  finalBodies = bodies;
}

let latePeakPointSpeed = 0, latePeakPoseSpan = 0;
const jitterTracks = [];
const recoveryTracks = [];
for (const [trackKey, samples] of tracks) {
  if (!samples.length) continue;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minAngle = Infinity, maxAngle = -Infinity, radius = 0;
  for (const state of samples) {
    if (!state.awake) continue;
    latePeakPointSpeed = Math.max(latePeakPointSpeed,
      Math.hypot(state.vx, state.vy) + Math.abs(state.omega) * state.maxR);
    minX = Math.min(minX, state.px); maxX = Math.max(maxX, state.px);
    minY = Math.min(minY, state.py); maxY = Math.max(maxY, state.py);
    minAngle = Math.min(minAngle, state.angle);
    maxAngle = Math.max(maxAngle, state.angle);
    radius = state.maxR;
  }
  if (minX < Infinity)
    latePeakPoseSpan = Math.max(latePeakPoseSpan,
      Math.hypot(maxX - minX, maxY - minY)
        + (maxAngle - minAngle) * radius);
  if (samples.length < 120) continue;
  let contactTicks = 0, awakeTicks = 0;
  let pathTravel = 0, peakPointSpeed = 0;
  let vxReversals = 0, vyReversals = 0, omegaReversals = 0;
  const sign = (value, threshold) => value > threshold ? 1
    : value < -threshold ? -1 : 0;
  for (let index = 0; index < samples.length; index++) {
    const state = samples[index];
    contactTicks += state.hadContact;
    awakeTicks += state.awake;
    peakPointSpeed = Math.max(peakPointSpeed,
      Math.hypot(state.vx, state.vy)
        + Math.abs(state.omega) * state.maxR);
    if (index === 0) continue;
    const previous = samples[index - 1];
    pathTravel += Math.hypot(state.px - previous.px,
      state.py - previous.py)
      + Math.abs(state.angle - previous.angle) * state.maxR;
    const reversal = (field, threshold) => {
      const a = sign(previous[field], threshold);
      const b = sign(state[field], threshold);
      return a !== 0 && b !== 0 && a !== b;
    };
    vxReversals += reversal('vx', 0.002);
    vyReversals += reversal('vy', 0.002);
    omegaReversals += reversal('omega', 0.0005);
  }
  const first = samples[0], last = samples.at(-1);
  const recoveryDelta = last.stampRecoveryTotal
    - first.stampRecoveryTotal;
  if (recoveryDelta > 0) {
    let recoverySamples = 0, awakeRecoverySamples = 0;
    for (let index = 1; index < samples.length; index++) {
      if (samples[index].stampRecoveryTotal
          <= samples[index - 1].stampRecoveryTotal) continue;
      recoverySamples++;
      awakeRecoverySamples += samples[index].awake;
    }
    recoveryTracks.push({
      layer: Number(trackKey.split(':')[0]),
      id: Number(trackKey.split(':')[1]),
      size: sizeClass(last),
      nPts: last.nPts,
      maxR: last.maxR,
      samples: samples.length,
      recoveryDelta,
      recoverySamples,
      awakeRecoverySamples,
      finalRecoveryStreak: last.stampRecoveryStreak,
      finalAwake: last.awake,
      finalSleepSupports: last.sleepSupports,
    });
  }
  const netTravel = Math.hypot(last.px - first.px, last.py - first.py)
    + Math.abs(last.angle - first.angle) * last.maxR;
  if (contactTicks >= samples.length * 0.75 && awakeTicks > 0)
    jitterTracks.push({
      layer: Number(trackKey.split(':')[0]),
      id: Number(trackKey.split(':')[1]),
      size: sizeClass(last),
      nPts: last.nPts,
      maxR: last.maxR,
      samples: samples.length,
      contactTicks,
      awakeTicks,
      pathTravel,
      netTravel,
      oscillationRatio: pathTravel / Math.max(0.01, netTravel),
      reversals: vxReversals + vyReversals + omegaReversals,
      peakPointSpeed,
    });
}
jitterTracks.sort((a, b) =>
  (b.pathTravel - b.netTravel) - (a.pathTravel - a.netTravel));
recoveryTracks.sort((a, b) => b.recoveryDelta - a.recoveryDelta);

const finalStates = [];
for (let layer = 0; layer < 2; layer++)
  for (let body = 0; body < engine._bodyCountLayer(layer); body++) {
    if (engine._bodyJointRoleLayer(layer, body) === 2) continue;
    finalStates.push({
      layer, body,
      id: engine._bodyIdLayer(layer, body),
      role: engine._bodyJointRoleLayer(layer, body),
      blocked: engine._bodyBlockedLayer(layer, body),
      terrain: engine._bodyTerrainBlockedLayer(layer, body),
      ownerFg: engine._bodyOwnerBlockedGrid(layer, body, 0),
      ownerBg: engine._bodyOwnerBlockedGrid(layer, body, 1),
      awake: engine._bodyAwakeLayer(layer, body) > 0,
      ...engine._bodyStateLayer(layer, body),
    });
  }
const finalAwakeBySize = Object.fromEntries(
  ['tiny', 'small', 'medium', 'structure'].map((name) => [name, 0]));
const finalBodiesBySize = Object.fromEntries(
  ['tiny', 'small', 'medium', 'structure'].map((name) => [name, 0]));
for (const state of finalStates) {
  const bucket = sizeClass(state);
  finalBodiesBySize[bucket]++;
  finalAwakeBySize[bucket] += state.awake;
}

const summary = {
  seed: SEED,
  solverMode: SOLVER_MODE,
  worldPositionLimit: WORLD_POSITION_LIMIT,
  peerBiasScale: PEER_BIAS_SCALE,
  sites: sites.length,
  blastTicks,
  peakBodies,
  peakJointBodies,
  maxCells,
  maxRadius,
  maxBodyOverlap,
  maxTerrainOverlap,
  lateBodyOverlap,
  lateTerrainOverlap,
  latePeakOverlapTick,
  latePeakOverlapBodies,
  latePeakOverlapSolver,
  lateOverlapBySize,
  peakOverlapTick,
  peakTerrainTick,
  peakOverlapBodies,
  peakTerrainBodies,
  peakOverlapSolver,
  peakTerrainSolver,
  firstSevereFailure,
  firstStructureFailure,
  structureBirths,
  structureFailures,
  maxConflicts,
  totalRecoveries,
  recoveryTicks,
  totalPositionCorrections,
  totalTerrainRecoveries,
  totalStampRecoveries,
  totalRasterPlaceholders,
  maxStampRecoveryStreak,
  maxStampRecoveryTotal,
  peakStampRecoveryBodies: peakStampRecoveryBodies.slice(-12),
  totalRasterCorrections,
  totalRasterProjectionFailures,
  totalWorldPositionLimitHits,
  maxSolverSubsteps,
  maxContactDepth,
  maxVelocityResidual,
  maxBiasResidual,
  totalVelocityConstraintEvals,
  totalBiasConstraintEvals,
  totalWorldRelaxContacts,
  totalWorldPositionIterations,
  totalShockIslands,
  totalShockFallbacks,
  settledAt,
  finalBodies,
  finalAwake,
  finalBodiesBySize,
  finalAwakeBySize,
  latePeakPointSpeed,
  latePeakPoseSpan,
  jitterTracks: jitterTracks.slice(0, 12),
  recoveryTracks: recoveryTracks.slice(0, 12),
  stepMeanMs: stepWallMs / STEPS,
  finalStates,
  ...(FOCUS_BODY ? { focusBody: FOCUS_BODY, focusTrack } : {}),
};
if (process.env.SUMMARY_ONLY) {
  const compactBody = (body) => ({
    layer: body.layer,
    id: body.id,
    role: body.role,
    blocked: body.blocked,
    terrain: body.terrain,
    awake: body.awake,
    nPts: body.nPts,
    maxR: body.maxR,
    px: body.px,
    py: body.py,
    angle: body.angle,
    vx: body.vx,
    vy: body.vy,
    omega: body.omega,
  });
  console.log(JSON.stringify({
    seed: summary.seed,
    solverMode: summary.solverMode,
    worldPositionLimit: summary.worldPositionLimit,
    peerBiasScale: summary.peerBiasScale,
    peakBodies: summary.peakBodies,
    peakJointBodies: summary.peakJointBodies,
    maxBodyOverlap: summary.maxBodyOverlap,
    maxTerrainOverlap: summary.maxTerrainOverlap,
    lateBodyOverlap: summary.lateBodyOverlap,
    lateTerrainOverlap: summary.lateTerrainOverlap,
    latePeakOverlapTick: summary.latePeakOverlapTick,
    latePeakOverlapBodies: summary.latePeakOverlapBodies.map(compactBody),
    peakTerrainTick: summary.peakTerrainTick,
    peakTerrainBodies: summary.peakTerrainBodies.map(compactBody),
    maxConflicts: summary.maxConflicts,
    totalRasterProjectionFailures: summary.totalRasterProjectionFailures,
    maxSolverSubsteps: summary.maxSolverSubsteps,
    maxContactDepth: summary.maxContactDepth,
    maxVelocityResidual: summary.maxVelocityResidual,
    maxBiasResidual: summary.maxBiasResidual,
    totalVelocityConstraintEvals: summary.totalVelocityConstraintEvals,
    totalBiasConstraintEvals: summary.totalBiasConstraintEvals,
    totalWorldRelaxContacts: summary.totalWorldRelaxContacts,
    totalWorldPositionIterations: summary.totalWorldPositionIterations,
    totalShockIslands: summary.totalShockIslands,
    totalShockFallbacks: summary.totalShockFallbacks,
    settledAt: summary.settledAt,
    finalBodies: summary.finalBodies,
    finalAwake: summary.finalAwake,
    finalBodiesBySize: summary.finalBodiesBySize,
    finalAwakeBySize: summary.finalAwakeBySize,
    lateOverlapBySize: summary.lateOverlapBySize,
    latePeakPointSpeed: summary.latePeakPointSpeed,
    latePeakPoseSpan: summary.latePeakPoseSpan,
    jitterTracks: summary.jitterTracks,
    stepMeanMs: summary.stepMeanMs,
    spawnSeparations: engine.getRigidSolverDebug().spawnSeparations,
    spawnSeparationFailures:
      engine.getRigidSolverDebug().spawnSeparationFailures,
    spawnMaxSeparation: engine.getRigidSolverDebug().spawnMaxSeparation,
    ...(summary.focusTrack ? {
      focusBody: summary.focusBody,
      focusTrack: summary.focusTrack
        .filter((sample) => sample.blocked > 0 || sample.terrain > 0
          || sample.ownerFg > 0 || sample.ownerBg > 0
          || CAPTURE_TICKS.has(sample.tick))
        .map((sample) => ({
          tick: sample.tick,
          role: sample.role,
          awake: sample.awake,
          blocked: sample.blocked,
          terrain: sample.terrain,
          ownerFg: sample.ownerFg,
          ownerBg: sample.ownerBg,
          blockerFg: sample.blockerFg,
          blockerBg: sample.blockerBg,
          terrainBlocker: sample.terrainBlocker,
          nPts: sample.nPts,
          maxR: sample.maxR,
          px: sample.px,
          py: sample.py,
          angle: sample.angle,
          vx: sample.vx,
          vy: sample.vy,
          omega: sample.omega,
          stillTicks: sample.stillTicks,
          restProbeTicks: sample.restProbeTicks,
          worldStillTicks: sample.worldStillTicks,
          hadContact: sample.hadContact,
          phaseTrace: sample.phaseTrace,
          contacts: process.env.FOCUS_CONTACTS ? sample.contacts : [],
        })),
    } : {}),
  }));
} else {
  console.log(JSON.stringify(summary));
}

const { check, done } = makeChecker('large natural cave TNT rubble');
check(`closed blast creates structure-scale rubble (${maxCells} cells, radius ${maxRadius.toFixed(1)})`,
  maxCells >= 4096 && maxRadius >= 96);
check(`closed blast exercises cross-layer bodies (${peakJointBodies})`,
  peakJointBodies > 0);
check(`settling rubble stays out of static terrain (${lateTerrainOverlap} late)`,
  lateTerrainOverlap === 0);
check(`rubble body overlap stays bounded (${maxBodyOverlap})`,
  maxBodyOverlap <= 3);
check(`rubble stamping conflicts stay bounded (${maxConflicts})`,
  maxConflicts <= 3);
check(`rubble reaches a quiet state (${finalAwake} awake, tick ${settledAt})`,
  settledAt >= 0 || (finalAwake <= 2 && latePeakPointSpeed <= 0.05));

engine.destroy();
const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
