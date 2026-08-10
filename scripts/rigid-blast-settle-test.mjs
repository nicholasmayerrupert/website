// TNT-cut cave debris must settle without alternating positional correction.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { KIND, MATERIALS } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 384, ROWS = 288, BLASTS = 24, STEPS = 600;
const SEEDS = [2667084199, 1026552672, 3680988441];
const STRUCTURAL = new Uint8Array(64);
for (const material of MATERIALS)
  if (material.kind === KIND.COMPONENT) STRUCTURAL[material.id] = 1;

const randomFor = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822519) >>> 0;
    state = Math.imul(state ^ (state >>> 13), 3266489917) >>> 0;
    return ((state ^= state >>> 16) >>> 0) / 4294967296;
  };
};

const caveWallCandidates = (engine) => {
  const grid = engine.getGrid();
  const owners = engine._bodyOwnerGrid(0);
  const candidates = [];
  for (let y = 24; y < ROWS - 32; y += 2) {
    for (let x = 24; x < COLS - 24; x += 2) {
      const k = y * COLS + x;
      if (!STRUCTURAL[grid[k]] || owners[k] >= 0) continue;
      let empty = 0, solid = 0;
      for (let oy = -6; oy <= 6; oy += 2) {
        for (let ox = -6; ox <= 6; ox += 2) {
          const material = grid[(y + oy) * COLS + x + ox];
          empty += material === 0;
          solid += STRUCTURAL[material] !== 0;
        }
      }
      if (empty >= 6 && solid >= 12) candidates.push([x, y]);
    }
  }
  return candidates;
};

const chooseSites = (candidates, random) => {
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const sites = [];
  for (const candidate of shuffled) {
    if (sites.every(([x, y]) =>
      Math.hypot(x - candidate[0], y - candidate[1]) >= 14))
      sites.push(candidate);
    if (sites.length === BLASTS) break;
  }
  return sites;
};

const sampleBodies = (engine, tick, tracks) => {
  for (let body = 0; body < engine._bodyCount(); body++) {
    const id = engine._bodyIdLayer(0, body);
    let samples = tracks.get(id);
    if (!samples) tracks.set(id, samples = []);
    samples.push({
      tick,
      awake: engine._bodyAwake(body) > 0,
      ...engine._bodyState(body),
    });
  }
};

const hasConfinedChatter = (samples, settleStart) => {
  const settled = samples.filter((sample) => sample.tick >= settleStart);
  for (let end = 19; end < settled.length; end++) {
    const window = settled.slice(end - 19, end + 1);
    if (window.some((sample) => !sample.awake
        || sample.px < 12 || sample.px > COLS - 12
        || sample.py < 12 || sample.py > ROWS - 12)) continue;
    const xs = window.map((sample) => sample.px);
    const ys = window.map((sample) => sample.py);
    const angles = window.map((sample) => sample.angle);
    const span = Math.hypot(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    );
    const angleSpan = Math.max(...angles) - Math.min(...angles);
    if (span > 2 || angleSpan > 0.3) continue;

    let correctionTicks = 0, reversals = 0;
    let peakCorrection = 0, peakMotion = 0, previous = null;
    for (const sample of window) {
      peakMotion = Math.max(peakMotion,
        Math.hypot(sample.vx, sample.vy)
          + Math.abs(sample.omega) * sample.maxR);
      const correction = [sample.pvx, sample.pvy, sample.pw * sample.maxR];
      const correctionSpeed = Math.hypot(...correction);
      peakCorrection = Math.max(peakCorrection, correctionSpeed);
      if (correctionSpeed < 0.01) continue;
      correctionTicks++;
      if (previous && correction[0] * previous[0]
          + correction[1] * previous[1]
          + correction[2] * previous[2] < 0) reversals++;
      previous = correction;
    }
    if (correctionTicks >= 5 && reversals >= 3
        && peakCorrection >= 0.02 && peakMotion <= 0.12) return true;
  }
  return false;
};

await initSandWasm();
const results = [];
for (const seed of SEEDS) {
  const engine = attachTestHooks(createEngineWasmRaw({
    cols: COLS,
    rows: ROWS,
    worldSeed: seed,
    sinksOn: false,
    infinite: true,
  }));
  engine.setBgEnabled(true);
  const sites = chooseSites(caveWallCandidates(engine), randomFor(seed ^ 0x51a7e));
  const tracks = new Map();
  let maxRejected = 0, maxDepenetrations = 0, maxOwnershipConflicts = 0;
  let maxRecoveryBodies = 0;
  let maxBodyBlocked = 0;
  let latePeakBodyBlocked = 0;
  let latePeakTerrainBlocked = 0;
  for (let tick = 0; tick < STEPS; tick++) {
    if (tick % 8 === 0 && tick / 8 < sites.length) {
      const [x, y] = sites[tick / 8];
      engine._detonateTnt(x, y);
    }
    engine.stepWorld();
    sampleBodies(engine, tick, tracks);
    let terrainBlocked = 0;
    let bodyBlocked = 0;
    for (let body = 0; body < engine._bodyCount(); body++) {
      bodyBlocked = Math.max(bodyBlocked,
        Math.max(0, engine._bodyBlocked(body)));
      terrainBlocked += Math.max(0, engine._bodyTerrainBlocked(body));
    }
    maxBodyBlocked = Math.max(maxBodyBlocked, bodyBlocked);
    if (tick >= STEPS - 120) {
      latePeakBodyBlocked = Math.max(latePeakBodyBlocked, bodyBlocked);
      latePeakTerrainBlocked = Math.max(latePeakTerrainBlocked, terrainBlocked);
    }
    const rigid = engine.getRigidDebug();
    maxRejected = Math.max(maxRejected, rigid.rejectedCells);
    maxDepenetrations = Math.max(maxDepenetrations, rigid.depenetrations);
    const solver = engine.getRigidSolverDebug();
    maxOwnershipConflicts = Math.max(maxOwnershipConflicts,
      solver.ownershipConflicts);
    maxRecoveryBodies = Math.max(maxRecoveryBodies, solver.recoveryBodies);
  }
  const settleStart = (sites.length - 1) * 8 + 10;
  const chatter = [...tracks.values()].filter((samples) =>
    hasConfinedChatter(samples, settleStart)).length;
  let finalBodyBlocked = 0, finalTerrainBlocked = 0, finalAwake = 0;
  const finalOverlaps = [];
  for (let body = 0; body < engine._bodyCount(); body++) {
    finalBodyBlocked = Math.max(finalBodyBlocked,
      Math.max(0, engine._bodyBlocked(body)));
    const blocked = Math.max(0, engine._bodyTerrainBlocked(body));
    finalTerrainBlocked += blocked;
    finalAwake += engine._bodyAwake(body) > 0;
    if (blocked) finalOverlaps.push({
      id: engine._bodyIdLayer(0, body),
      jointRole: engine._bodyJointRoleLayer(0, body),
      blocked,
      awake: engine._bodyAwake(body),
      ...engine._bodyState(body),
    });
  }
  results.push({ seed, sites: sites.length, bodies: tracks.size,
    chatter, maxRejected, maxDepenetrations,
    maxBodyBlocked, latePeakBodyBlocked, finalBodyBlocked,
    latePeakTerrainBlocked, finalTerrainBlocked, finalAwake, finalOverlaps,
    maxOwnershipConflicts, maxRecoveryBodies,
  });
  engine.destroy();
}

const { check, done } = makeChecker('procedural cave blast debris settling');
for (const result of results)
  console.log(`  seed ${result.seed}: ${result.sites} blasts, `
    + `${result.bodies} bodies, ${result.chatter} chatter, `
    + `${result.maxRejected} rejected, ${result.maxOwnershipConflicts} conflicts, `
    + `${result.maxDepenetrations} depenetrations, `
    + `${result.maxBodyBlocked}/${result.latePeakBodyBlocked}/${result.finalBodyBlocked} body overlap, `
    + `${result.latePeakTerrainBlocked}/${result.finalTerrainBlocked} late/final overlap, `
    + `${result.finalAwake} awake${result.finalOverlaps.length
      ? ` ${JSON.stringify(result.finalOverlaps)}` : ''}, `
    + `${result.maxRecoveryBodies} recoveries`);
check('every cave field supplied the full blast set',
  results.every((result) => result.sites === BLASTS));
check('settling debris has no confined alternating positional correction',
  results.every((result) => result.chatter === 0));
check('settling debris has no rejected raster stamps',
  results.every((result) => result.maxRejected === 0));
check('blast debris body overlap stays within one raster alias and clears',
  results.every((result) => result.maxBodyBlocked <= 1
    && result.maxOwnershipConflicts <= 1
    && result.latePeakBodyBlocked === 0
    && result.finalBodyBlocked === 0));
check('settling debris stays clear of static terrain late in the run',
  results.every((result) => result.latePeakTerrainBlocked === 0
    && result.finalTerrainBlocked === 0));
check('terrain fallback work stays local to a small fraction of the debris',
  results.every((result) =>
    result.maxDepenetrations <= Math.ceil(result.bodies / 4)
    && result.maxRecoveryBodies <= Math.ceil(result.bodies / 8)));
process.exitCode = done();
