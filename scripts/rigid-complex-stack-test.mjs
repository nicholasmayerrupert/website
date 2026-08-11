// Massive irregular foreground and cross-layer bodies must transmit support
// through a deep pile without entering terrain, intersecting, or chattering.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { performance } from 'node:perf_hooks';

await initSandWasm();

const COLS = 960;
const ROWS = 1440;
const FLOOR_Y = 1360;
const STEPS = Number.parseInt(process.env.STEPS ?? '620', 10);
const SOLVER_MODE = Number.parseInt(process.env.RIGID_SOLVER_MODE ?? '2', 10);
const SOLVER_TOLERANCE = Number.parseFloat(
  process.env.RIGID_SOLVER_TOLERANCE ?? '0.0001');
const SOLVER_MIN_ITERS = Number.parseInt(
  process.env.RIGID_SOLVER_MIN_ITERS ?? '4', 10);
const PEER_BIAS_SCALE = Number.parseFloat(
  process.env.PEER_BIAS_SCALE ?? '1');
const WORLD_POSITION_LIMIT = Number.parseFloat(
  process.env.WORLD_POSITION_LIMIT ?? '0.5');
const TRACE_EVERY = Number.parseInt(process.env.TRACE_EVERY ?? '0', 10);
const TRACE_START = Number.parseInt(process.env.TRACE_START ?? '0', 10);
const TRACE_CONTACTS = process.env.TRACE_CONTACTS === '1';
const TAIL_TICKS = 60;
const SEEDS = (process.env.SEEDS ?? '7,19')
  .split(',').map(Number).filter(Number.isFinite);

const randomFor = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const makeShape = (width, height, seed, kind) => {
  const random = randomFor(seed);
  const cells = new Map();
  const put = (x, y) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && x < width && y >= 0 && y < height)
      cells.set(`${x},${y}`, [x, y]);
  };
  const disc = (cx, cy, radius) => {
    const r2 = radius * radius;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++)
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) put(x, y);
  };
  const line = (x0, y0, x1, y1, radius) => {
    const count = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let step = 0; step <= count; step++) {
      const t = step / Math.max(1, count);
      disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius);
    }
  };
  const cx = width * (0.42 + random() * 0.16);
  const cy = height * (0.42 + random() * 0.16);
  const rib = 2 + kind % 4;
  disc(cx, cy, 6 + kind % 4);

  if (kind % 4 === 0) {
    // A long cave-like shelf with offset forks and hanging teeth.
    line(4, height * 0.62, width - 5, height * 0.68, rib + 1);
    for (let branch = 0; branch < 15; branch++) {
      const x = 10 + random() * (width - 20);
      const y = branch & 1 ? 5 + random() * cy : cy + random() * (height - cy - 5);
      line(cx, cy, x, y, rib + branch % 3);
    }
  } else if (kind % 4 === 1) {
    // Hollow roof/truss: strongly concave with several long lever arms.
    line(3, height - 6, width - 4, height - 6, rib + 2);
    line(3, height - 6, width * 0.5, 4, rib + 1);
    line(width * 0.5, 4, width - 4, height - 6, rib + 1);
    for (let brace = 0; brace < 7; brace++) {
      const x0 = brace * width / 7;
      const x1 = (brace + 1) * width / 7;
      line(x0, height - 8, x1, height * (0.24 + 0.12 * (brace & 1)), rib);
    }
  } else if (kind % 4 === 2) {
    // Bent, oblong spine with alternating deep hooks.
    let previousX = 4;
    let previousY = height * 0.48;
    for (let segment = 1; segment <= 9; segment++) {
      const x = 4 + segment * (width - 8) / 9;
      const y = height * (0.38 + 0.20 * Math.sin(segment * 1.7 + seed));
      line(previousX, previousY, x, y, rib + 1);
      if (segment % 2 === 0)
        line(x, y, x + (random() - 0.5) * width * 0.12,
          segment % 4 ? 4 : height - 5, rib);
      previousX = x;
      previousY = y;
    }
  } else {
    // A broad ring with broken-looking internal spokes, all still connected.
    line(5, 5, width - 6, 5, rib);
    line(width - 6, 5, width - 6, height - 6, rib);
    line(width - 6, height - 6, 5, height - 6, rib);
    line(5, height - 6, 5, 5, rib);
    for (let spoke = 0; spoke < 10; spoke++) {
      const phase = spoke * Math.PI * 2 / 10 + random() * 0.2;
      line(cx, cy,
        cx + Math.cos(phase) * width * (0.40 + random() * 0.08),
        cy + Math.sin(phase) * height * (0.38 + random() * 0.09), rib);
    }
  }
  const pending = new Set(cells.keys());
  let largest = [];
  while (pending.size) {
    const first = pending.values().next().value;
    pending.delete(first);
    const queue = [cells.get(first)];
    const component = [];
    for (let index = 0; index < queue.length; index++) {
      const [x, y] = queue[index];
      component.push([x, y]);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const key = `${x + ox},${y + oy}`;
          if (!pending.delete(key)) continue;
          queue.push(cells.get(key));
        }
      }
    }
    if (component.length > largest.length) largest = component;
  }
  return largest;
};

const makePeerShape = (cells, width, height, seed) => {
  const random = randomFor(seed);
  const result = new Map(cells.map(([x, y]) => [`${x},${y}`, [x, y]]));
  const put = (x, y) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && x < width && y >= 0 && y < height)
      result.set(`${x},${y}`, [x, y]);
  };
  const disc = (cx, cy, radius) => {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++)
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) put(x, y);
  };
  const line = (x0, y0, x1, y1, radius) => {
    const count = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let step = 0; step <= count; step++) {
      const t = step / Math.max(1, count);
      disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius);
    }
  };
  const center = cells.reduce((sum, [x, y]) =>
    [sum[0] + x / cells.length, sum[1] + y / cells.length], [0, 0]);
  for (let branch = 0; branch < 3; branch++) {
    const edgeX = branch === 0 ? width - 3
      : branch === 1 ? 3 : width * (0.25 + random() * 0.5);
    const edgeY = branch === 2 ? 3 : height * (0.2 + random() * 0.6);
    line(center[0], center[1], edgeX, edgeY, 2 + branch);
  }
  return [...result.values()];
};

const paintCells = (engine, layer, cells, ox, oy, material) => {
  for (const [x, y] of cells)
    engine.paintDiscLayer(layer, x + ox, y + oy, 0, material, true);
};

const runCase = (seed) => {
  const random = randomFor(seed ^ 0x9e3779b9);
  const engine = attachTestHooks(createEngineWasmRaw({
    cols: COLS,
    rows: ROWS,
    worldSeed: seed,
    sinksOn: false,
    infinite: false,
  }));
  engine.setBgEnabled(true);
  engine._setRigidSolverOptions(
    SOLVER_MODE, SOLVER_TOLERANCE, SOLVER_MIN_ITERS);
  engine._setRigidPeerBiasScale(PEER_BIAS_SCALE);
  engine._setRigidWorldPositionLimit(WORLD_POSITION_LIMIT);
  for (let x = 0; x < COLS; x++) {
    const top = FLOOR_Y + Math.round(11 * Math.sin(x * 0.041 + seed))
      - ((x * 29 + seed) % 71 < 11 ? 19 : 0);
    for (let y = top; y < ROWS; y++) {
      engine.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
      engine.paintDiscLayer(1, x, y, 0, MAT.DEEPSTONE, true);
    }
  }
  engine.syncComponentsLayer(0);
  engine.syncComponentsLayer(1);

  const specs = [];
  let y = 20;
  for (let body = 0; body < 12; body++) {
    const width = 420 + Math.floor(random() * 390);
    const height = 62 + Math.floor(random() * 42);
    const cells = makeShape(width, height, seed * 101 + body * 17, body);
    const peerCells = makePeerShape(
      cells, width, height, seed * 131 + body * 23);
    const x = Math.max(4, Math.min(COLS - width - 4,
      Math.round((COLS - width) * 0.5 + (random() - 0.5) * 170)));
    const kind = body % 3 === 1 ? 'joint' : body % 3 === 2 ? 'bg' : 'fg';
    specs.push({ cells, peerCells, x, y, kind });
    y += height + 7 + Math.floor(random() * 9);
  }

  for (const spec of specs) {
    if (spec.kind === 'joint')
      paintCells(engine, 0, spec.cells, spec.x, spec.y, MAT.BRICK);
    if (spec.kind !== 'fg')
      paintCells(engine, 1,
        spec.kind === 'joint' ? spec.peerCells : spec.cells,
        spec.x, spec.y, MAT.IRON_ORE);
  }
  engine.syncComponentsLayer(0);
  engine.syncComponentsLayer(1);
  engine.stepWorld();

  for (const spec of specs)
    if (spec.kind === 'fg')
      engine.spawnBody(spec.cells.map(([x, y]) => [x + spec.x, y + spec.y]));

  const initialFg = engine._bodyCountLayer(0);
  const initialBg = engine._bodyCountLayer(1);
  let jointLeaders = 0;
  for (let body = 0; body < initialFg; body++) {
    if (engine._bodyJointRoleLayer(0, body) === 1) jointLeaders++;
    engine._setBodyMotion(body,
      (random() - 0.5) * 1.6,
      0.15 + random() * 0.65,
      (random() - 0.5) * 0.06);
  }

  let maxBlocked = 0;
  let maxTerrainBlocked = 0;
  let maxBackgroundBlocked = 0;
  let maxBackgroundTerrainBlocked = 0;
  let maxConflicts = 0;
  let maxRejected = 0;
  let maxRecoveries = 0;
  let totalRecoveries = 0;
  let recoveryTicks = 0;
  let maxProjections = 0;
  let maxRasterCorrections = 0;
  let maxRasterFailures = 0;
  let maxRasterDistance = 0;
  let shockFallbacks = 0;
  let maxAwake = 0;
  let maxSubsteps = 0;
  let totalContacts = 0;
  let totalWarmStarted = 0;
  let totalVelocityConstraintEvals = 0;
  let totalBiasConstraintEvals = 0;
  let maxContactDepth = 0;
  let maxVelocityResidual = 0;
  let maxBiasResidual = 0;
  let settledAt = -1;
  let latePeakPointSpeed = 0;
  let latePeakPoseSpan = 0;
  let tailPeakPointSpeed = 0;
  let tailPeakPoseSpan = 0;
  let firstBlockedTick = -1;
  let peakBlockedValue = 0;
  let peakBlockedTick = -1;
  let peakBlockedBodies = null;
  let firstBlockedBodies = null;
  let firstSevereBlockedTick = -1;
  let firstSevereBlockedBodies = null;
  let firstTerrainBlockedTick = -1;
  let firstTerrainBlocked = null;
  let firstBackgroundTerrainBlockedTick = -1;
  let firstBackgroundTerrainBlocked = null;
  let firstConflictTick = -1;
  let firstRasterFailureTick = -1;
  let firstRasterFailureBodies = null;
  let firstRecoveryTick = -1;
  let lastRecoveryTick = -1;
  let stepWallMs = 0;
  const phaseTotals = {
    pairContact: 0,
    terrainContact: 0,
    solve: 0,
    integrate: 0,
    occupancy: 0,
    cadence: 0,
    fluid: 0,
    bake: 0,
    clear: 0,
    depen: 0,
    stamp: 0,
    spill: 0,
  };
  const phaseMax = Object.fromEntries(
    Object.keys(phaseTotals).map((key) => [key, 0]));
  const lateTracks = new Map();
  const tailTracks = new Map();
  const trackMotion = (tracks, key, state) => {
    let track = tracks.get(key);
    if (!track) {
      track = { minX: state.px, maxX: state.px,
        minY: state.py, maxY: state.py };
      tracks.set(key, track);
    }
    track.minX = Math.min(track.minX, state.px);
    track.maxX = Math.max(track.maxX, state.px);
    track.minY = Math.min(track.minY, state.py);
    track.maxY = Math.max(track.maxY, state.py);
  };
  for (let tick = 0; tick < STEPS; tick++) {
    const stepStart = performance.now();
    engine.stepWorld();
    stepWallMs += performance.now() - stepStart;
    let awake = 0;
    let tickBlocked = 0;
    for (let body = 0; body < engine._bodyCountLayer(0); body++) {
      const state = engine._bodyStateLayer(0, body);
      if (!state) continue;
      const bodyAwake = engine._bodyAwake(body) > 0;
      awake += bodyAwake;
      const blocked = engine._bodyBlocked(body);
      maxBlocked = Math.max(maxBlocked, blocked);
      tickBlocked = Math.max(tickBlocked, blocked);
      const terrainBlocked = engine._bodyTerrainBlocked(body);
      maxTerrainBlocked = Math.max(maxTerrainBlocked, terrainBlocked);
      if (terrainBlocked > 0 && firstTerrainBlockedTick < 0) {
        firstTerrainBlockedTick = tick;
        firstTerrainBlocked = {
          layer: 0,
          body,
          id: engine._bodyIdLayer(0, body),
          role: engine._bodyJointRoleLayer(0, body),
          terrainBlocked,
          ...state,
        };
      }
      if (tick >= STEPS - 240 && bodyAwake) {
        const speed = Math.hypot(state.vx, state.vy)
          + Math.abs(state.omega) * state.maxR;
        latePeakPointSpeed = Math.max(latePeakPointSpeed, speed);
        const id = engine._bodyIdLayer(0, body);
        trackMotion(lateTracks, id, state);
        if (tick >= STEPS - TAIL_TICKS) {
          tailPeakPointSpeed = Math.max(tailPeakPointSpeed, speed);
          trackMotion(tailTracks, id, state);
        }
      }
    }
    for (let body = 0; body < engine._bodyCountLayer(1); body++) {
      if (engine._bodyJointRoleLayer(1, body) === 2) continue;
      const state = engine._bodyStateLayer(1, body);
      const bodyAwake = engine._bodyAwakeLayer(1, body) > 0;
      awake += bodyAwake;
      const blocked = engine._bodyBlockedLayer(1, body);
      maxBackgroundBlocked = Math.max(maxBackgroundBlocked, blocked);
      tickBlocked = Math.max(tickBlocked, blocked);
      const terrainBlocked = engine._bodyTerrainBlockedLayer(1, body);
      maxBackgroundTerrainBlocked = Math.max(
        maxBackgroundTerrainBlocked, terrainBlocked);
      if (terrainBlocked > 0 && firstBackgroundTerrainBlockedTick < 0) {
        firstBackgroundTerrainBlockedTick = tick;
        firstBackgroundTerrainBlocked = {
          layer: 1,
          body,
          id: engine._bodyIdLayer(1, body),
          role: engine._bodyJointRoleLayer(1, body),
          terrainBlocked,
          ...engine._bodyStateLayer(1, body),
        };
      }
      if (state && tick >= STEPS - 240 && bodyAwake) {
        const speed = Math.hypot(state.vx, state.vy)
          + Math.abs(state.omega) * state.maxR;
        latePeakPointSpeed = Math.max(latePeakPointSpeed, speed);
        const id = `1:${engine._bodyIdLayer(1, body)}`;
        trackMotion(lateTracks, id, state);
        if (tick >= STEPS - TAIL_TICKS) {
          tailPeakPointSpeed = Math.max(tailPeakPointSpeed, speed);
          trackMotion(tailTracks, id, state);
        }
      }
    }
    maxAwake = Math.max(maxAwake, awake);
    if (tickBlocked > peakBlockedValue) {
      peakBlockedValue = tickBlocked;
      peakBlockedTick = tick;
      peakBlockedBodies = [];
      for (let layer = 0; layer < 2; layer++) {
        for (let body = 0; body < engine._bodyCountLayer(layer); body++) {
          if (engine._bodyJointRoleLayer(layer, body) === 2) continue;
          const blocked = engine._bodyBlockedLayer(layer, body);
          if (blocked <= 0) continue;
          peakBlockedBodies.push({
            peak: tickBlocked,
            layer,
            body,
            id: engine._bodyIdLayer(layer, body),
            role: engine._bodyJointRoleLayer(layer, body),
            blocked,
            sameLayerBlocker: engine._bodyPrimaryBlocker(
              layer, body, layer),
            peerLayerBlocker: engine._bodyPrimaryBlocker(
              layer, body, 1 - layer),
            terrain: engine._bodyTerrainBlockedLayer(layer, body),
            ...engine._bodyStateLayer(layer, body),
          });
        }
      }
    }
    const solver = engine.getRigidSolverDebug();
    const rigid = engine.getRigidDebug();
    maxConflicts = Math.max(maxConflicts, solver.ownershipConflicts);
    maxRejected = Math.max(maxRejected, rigid.rejectedCells);
    maxRecoveries = Math.max(maxRecoveries, solver.recoveryBodies);
    totalRecoveries += solver.recoveryBodies;
    recoveryTicks += solver.recoveryBodies > 0;
    if (solver.recoveryBodies > 0) {
      if (firstRecoveryTick < 0) firstRecoveryTick = tick;
      lastRecoveryTick = tick;
    }
    maxProjections = Math.max(maxProjections, solver.positionCorrections);
    maxRasterCorrections = Math.max(maxRasterCorrections,
      solver.rasterCorrections);
    maxRasterFailures = Math.max(maxRasterFailures,
      solver.rasterProjectionFailures);
    if (firstRasterFailureTick < 0 && solver.rasterProjectionFailures > 0) {
      firstRasterFailureTick = tick;
      firstRasterFailureBodies = [];
      for (let layer = 0; layer < 2; layer++) {
        for (let body = 0; body < engine._bodyCountLayer(layer); body++) {
          if (engine._bodyJointRoleLayer(layer, body) === 2) continue;
          firstRasterFailureBodies.push({
            layer,
            body,
            id: engine._bodyIdLayer(layer, body),
            role: engine._bodyJointRoleLayer(layer, body),
            blocked: engine._bodyBlockedLayer(layer, body),
            terrain: engine._bodyTerrainBlockedLayer(layer, body),
            ...engine._bodyStateLayer(layer, body),
          });
        }
      }
    }
    maxRasterDistance = Math.max(maxRasterDistance,
      solver.rasterMaxCorrection);
    shockFallbacks += solver.shockFallbacks;
    if (firstBlockedTick < 0 && (maxBlocked > 0 || maxBackgroundBlocked > 0)) {
      firstBlockedTick = tick;
      firstBlockedBodies = [];
      for (let layer = 0; layer < 2; layer++) {
        for (let body = 0; body < engine._bodyCountLayer(layer); body++) {
          if (engine._bodyJointRoleLayer(layer, body) === 2) continue;
          const blocked = engine._bodyBlockedLayer(layer, body);
          if (blocked <= 0) continue;
          firstBlockedBodies.push({
            layer,
            body,
            id: engine._bodyIdLayer(layer, body),
            role: engine._bodyJointRoleLayer(layer, body),
            blocked,
            terrain: engine._bodyTerrainBlockedLayer(layer, body),
            ...engine._bodyStateLayer(layer, body),
          });
        }
      }
    }
    if (firstSevereBlockedTick < 0
        && (maxBlocked > 2 || maxBackgroundBlocked > 2)) {
      firstSevereBlockedTick = tick;
      firstSevereBlockedBodies = [];
      for (let layer = 0; layer < 2; layer++) {
        for (let body = 0; body < engine._bodyCountLayer(layer); body++) {
          if (engine._bodyJointRoleLayer(layer, body) === 2) continue;
          const blocked = engine._bodyBlockedLayer(layer, body);
          if (blocked <= 0) continue;
          firstSevereBlockedBodies.push({
            layer,
            body,
            id: engine._bodyIdLayer(layer, body),
            role: engine._bodyJointRoleLayer(layer, body),
            blocked,
            terrain: engine._bodyTerrainBlockedLayer(layer, body),
            ...engine._bodyStateLayer(layer, body),
          });
        }
      }
    }
    if (firstConflictTick < 0 && maxConflicts > 0) firstConflictTick = tick;
    maxSubsteps = Math.max(maxSubsteps, solver.substeps);
    totalContacts += solver.contacts;
    totalWarmStarted += solver.warmStarted;
    totalVelocityConstraintEvals += solver.velocityConstraintEvals;
    totalBiasConstraintEvals += solver.biasConstraintEvals;
    maxContactDepth = Math.max(maxContactDepth, solver.maxContactDepth);
    maxVelocityResidual = Math.max(
      maxVelocityResidual, solver.maxVelocityResidual);
    maxBiasResidual = Math.max(maxBiasResidual, solver.maxBiasResidual);
    const phases = {
      pairContact: solver.rigidPairContactMs,
      terrainContact: solver.rigidTerrainContactMs,
      solve: solver.rigidSolveMs,
      integrate: solver.rigidIntegrateMs,
      occupancy: solver.rigidOccupancyBuildMs,
      cadence: solver.rigidCadenceMs,
      fluid: solver.rigidFluidCoupleMs,
      bake: solver.rigidBakeMs,
      clear: solver.rigidClearMs,
      depen: solver.rigidDepenMs,
      stamp: solver.rigidStampMs,
      spill: solver.rigidSpillMs,
    };
    for (const [key, value] of Object.entries(phases)) {
      phaseTotals[key] += value;
      phaseMax[key] = Math.max(phaseMax[key], value);
    }
    if (TRACE_EVERY > 0 && tick + 1 >= TRACE_START
        && (tick + 1) % TRACE_EVERY === 0) {
      const sleepState = [];
      for (let layer = 0; layer < 2; layer++)
        for (let body = 0; body < engine._bodyCountLayer(layer); body++) {
          if (engine._bodyJointRoleLayer(layer, body) === 2) continue;
          const state = engine._bodyStateLayer(layer, body);
          if (state && (state.worldStillTicks > 0
              || engine._bodyAwakeLayer(layer, body) > 0))
            sleepState.push(`${layer}:${engine._bodyIdLayer(layer, body)}`
              + `=${state.worldStillTicks}/${state.sleepSupports}`);
        }
      console.log(`trace seed ${seed} tick ${tick + 1}: ${awake} awake, `
        + `${tickBlocked} overlap, ${solver.contacts} contacts, `
        + `${(stepWallMs / (tick + 1)).toFixed(1)} ms mean; `
        + `pair ${phases.pairContact.toFixed(1)}, `
        + `terrain ${phases.terrainContact.toFixed(1)}, `
        + `solve ${phases.solve.toFixed(1)}, `
        + `integrate ${phases.integrate.toFixed(1)}, `
        + `bake ${phases.bake.toFixed(1)}, `
        + `depen ${phases.depen.toFixed(1)}, `
        + `stamp ${phases.stamp.toFixed(1)}, `
        + `spill ${phases.spill.toFixed(1)} ms; `
        + `world-pose ${solver.worldMaxPositionTranslation.toFixed(4)}/`
        + `${solver.worldMaxPositionRotation.toFixed(6)}, `
        + `raster ${solver.rasterCorrections}/`
        + `${solver.rasterMaxCorrection.toFixed(4)}; `
        + `world-rest ${sleepState.join(',')}`);
      if (TRACE_CONTACTS) {
        const contacts = engine._worldContacts().map((contact) => ({
          pair: `${contact.aLayer}:${contact.aId}/${contact.bLayer}:${contact.bId}`,
          normal: [contact.nx, contact.ny].map((value) =>
            Number(value.toFixed(4))),
          depth: Number(contact.depth.toFixed(5)),
          normalImpulse: Number(contact.normalImpulse.toFixed(5)),
          tangentImpulse: Number(contact.tangentImpulse.toFixed(5)),
        }));
        console.log(`world contacts ${tick + 1}: ${JSON.stringify(contacts)}`);
      }
    }
    if (awake === 0 && settledAt < 0) settledAt = tick;
  }
  for (const track of lateTracks.values())
    latePeakPoseSpan = Math.max(latePeakPoseSpan,
      Math.hypot(track.maxX - track.minX, track.maxY - track.minY));
  for (const track of tailTracks.values())
    tailPeakPoseSpan = Math.max(tailPeakPoseSpan,
      Math.hypot(track.maxX - track.minX, track.maxY - track.minY));

  let finalAwake = 0;
  let finalBlocked = 0;
  const finalStates = [];
  for (let body = 0; body < engine._bodyCountLayer(0); body++) {
    finalAwake += engine._bodyAwake(body) > 0;
    finalBlocked += Math.max(0, engine._bodyBlocked(body));
    if (engine._bodyAwake(body) > 0)
      finalStates.push({
        layer: 0,
        body,
        id: engine._bodyIdLayer(0, body),
        role: engine._bodyJointRoleLayer(0, body),
        blocked: engine._bodyBlocked(body),
        terrain: engine._bodyTerrainBlocked(body),
        ...engine._bodyStateLayer(0, body),
      });
  }
  for (let body = 0; body < engine._bodyCountLayer(1); body++) {
    if (engine._bodyJointRoleLayer(1, body) === 2) continue;
    finalAwake += engine._bodyAwakeLayer(1, body) > 0;
    finalBlocked += Math.max(0, engine._bodyBlockedLayer(1, body));
    if (engine._bodyAwakeLayer(1, body) > 0)
      finalStates.push({
        layer: 1,
        body,
        id: engine._bodyIdLayer(1, body),
        role: engine._bodyJointRoleLayer(1, body),
        blocked: engine._bodyBlockedLayer(1, body),
        terrain: engine._bodyTerrainBlockedLayer(1, body),
        ...engine._bodyStateLayer(1, body),
      });
  }
  const result = {
    seed, initialFg, initialBg, jointLeaders,
    solverMode: SOLVER_MODE, peerBiasScale: PEER_BIAS_SCALE,
    maxAwake, maxSubsteps, settledAt, finalAwake,
    totalContacts, totalWarmStarted,
    warmStartRatio: totalContacts > 0 ? totalWarmStarted / totalContacts : 0,
    totalVelocityConstraintEvals, totalBiasConstraintEvals,
    maxContactDepth, maxVelocityResidual, maxBiasResidual,
    finalStates,
    maxBlocked, maxTerrainBlocked, maxBackgroundBlocked,
    maxBackgroundTerrainBlocked, finalBlocked,
    maxConflicts, maxRejected, maxRecoveries, totalRecoveries, recoveryTicks,
    firstRecoveryTick, lastRecoveryTick,
    maxProjections,
    maxRasterCorrections, maxRasterFailures, maxRasterDistance,
    shockFallbacks, firstBlockedTick, firstBlockedBodies,
    peakBlockedTick, peakBlockedBodies,
    firstSevereBlockedTick, firstSevereBlockedBodies, firstConflictTick,
    firstTerrainBlockedTick, firstTerrainBlocked,
    firstBackgroundTerrainBlockedTick, firstBackgroundTerrainBlocked,
    firstRasterFailureTick, firstRasterFailureBodies,
    latePeakPointSpeed, latePeakPoseSpan,
    tailPeakPointSpeed, tailPeakPoseSpan,
    stepMeanMs: stepWallMs / STEPS,
    phaseMeanMs: Object.fromEntries(Object.entries(phaseTotals)
      .map(([key, value]) => [key, value / STEPS])),
    phaseMaxMs: phaseMax,
  };
  engine.destroy();
  return result;
};

let failed = 0;
for (const seed of SEEDS) {
  const result = runCase(seed);
  const failedCase = result.initialFg < 8 || result.initialBg < 8
      || result.jointLeaders < 4 || result.maxSubsteps < 4
      || result.maxBlocked > 2 || result.maxTerrainBlocked !== 0
      || result.maxBackgroundBlocked > 2
      || result.maxBackgroundTerrainBlocked !== 0
      || result.finalBlocked !== 0 || result.maxConflicts > 2
      || result.maxRejected !== 0 || result.maxRecoveries > 1
      || result.recoveryTicks > 6 || result.maxRasterFailures > 1
      || result.maxRasterDistance > 2 || result.settledAt < 0
      || result.finalAwake !== 0 || result.tailPeakPointSpeed > 0.02
      || result.tailPeakPoseSpan > 0.05;
  console.log(`seed ${seed}: ${result.initialFg}/${result.initialBg} bodies, `
    + `${result.jointLeaders} joint, settled ${result.settledAt}, `
    + `${result.maxBlocked}/${result.maxBackgroundBlocked} peak overlap, `
    + `${result.maxTerrainBlocked}/${result.maxBackgroundTerrainBlocked} terrain, `
    + `${result.maxConflicts} conflicts, ${result.maxRasterCorrections} raster corrections, `
    + `${result.maxRasterFailures} failed projections, `
    + `${result.recoveryTicks} recovery ticks, `
    + `${(result.warmStartRatio * 100).toFixed(1)}% warm, `
    + `${result.tailPeakPointSpeed.toFixed(4)} tail speed, `
    + `${result.stepMeanMs.toFixed(2)} ms/step`);
  if (failedCase) {
    console.log(JSON.stringify(result));
    failed++;
  }
}
process.exitCode = failed ? 1 : 0;
