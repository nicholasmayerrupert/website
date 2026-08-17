// TNT-cut cave debris must settle without alternating positional correction.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { KIND, MATERIALS, MAT, TABLE_SIZE } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';

const COLS = Number.parseInt(process.env.COLS ?? '384', 10);
const ROWS = Number.parseInt(process.env.ROWS ?? '288', 10);
const BLASTS = Number.parseInt(process.env.BLASTS ?? '24', 10);
const STEPS = Number.parseInt(process.env.STEPS ?? '600', 10);
const SOLVER_MODE = Number.parseInt(
  process.env.RIGID_SOLVER_MODE ?? '2', 10);
const SEEDS = (process.env.SEEDS ?? '2667084199,1026552672,3680988441')
  .split(',').map(Number).filter(Number.isFinite);
const CAPTURE_DIR = process.env.CAPTURE_DIR
  ? resolve(process.env.CAPTURE_DIR) : '';
const GOLDEN = process.env.GOLDEN === '1';
const STRUCTURAL = new Uint8Array(TABLE_SIZE);
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
  const name = Buffer.from(type);
  const body = Buffer.concat([name, data]);
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
    pngChunk('IDAT', deflateSync(rows, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

const captureFrame = (engine, seed, tick) => {
  if (!CAPTURE_DIR) return;
  engine.renderFullLayer(1);
  const background = engine.getRenderPixelsLayer(1).slice();
  engine.renderFullLayer(0);
  const foreground = engine.getRenderPixelsLayer(0);
  const fgGrid = engine.getGrid();
  const output = Buffer.from(background);
  for (let cell = 0; cell < COLS * ROWS; cell++) {
    const pixel = cell * 4;
    if (fgGrid[cell] !== 0) {
      output[pixel] = foreground[pixel];
      output[pixel + 1] = foreground[pixel + 1];
      output[pixel + 2] = foreground[pixel + 2];
    } else {
      output[pixel] = Math.round(output[pixel] * 0.58);
      output[pixel + 1] = Math.round(output[pixel + 1] * 0.58);
      output[pixel + 2] = Math.round(output[pixel + 2] * 0.58);
    }
    output[pixel + 3] = 255;
  }
  mkdirSync(CAPTURE_DIR, { recursive: true });
  const name = `${seed}-${String(tick).padStart(4, '0')}.png`;
  writeFileSync(resolve(CAPTURE_DIR, name), encodePng(COLS, ROWS, output));
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
  let pool = shuffled;
  if (GOLDEN && shuffled.length) {
    let anchor = shuffled[0], bestCount = 0;
    const stride = Math.max(1, Math.floor(shuffled.length / 48));
    for (let i = 0; i < shuffled.length; i += stride) {
      const candidate = shuffled[i];
      const count = shuffled.reduce((total, other) => total
        + (Math.abs(other[0] - candidate[0]) <= 240
          && Math.abs(other[1] - candidate[1]) <= 180), 0);
      if (count > bestCount) { bestCount = count; anchor = candidate; }
    }
    pool = shuffled.filter((candidate) =>
      Math.abs(candidate[0] - anchor[0]) <= 240
      && Math.abs(candidate[1] - anchor[1]) <= 180);
  }
  const sites = [];
  for (const candidate of pool) {
    if (sites.every(([x, y]) =>
      Math.hypot(x - candidate[0], y - candidate[1]) >= (GOLDEN ? 10 : 14)))
      sites.push(candidate);
    if (sites.length === BLASTS) break;
  }
  return sites;
};

const sampleBodies = (engine, tick, tracks) => {
  for (let layer = 0; layer < 2; layer++)
    for (let body = 0; body < engine._bodyCountLayer(layer); body++) {
      if (engine._bodyJointRoleLayer(layer, body) === 2) continue;
      const id = `${layer}:${engine._bodyIdLayer(layer, body)}`;
      let samples = tracks.get(id);
      if (!samples) tracks.set(id, samples = []);
      samples.push({
        tick,
        awake: engine._bodyAwakeLayer(layer, body) > 0,
        blocked: Math.max(0, engine._bodyBlockedLayer(layer, body)),
        terrainBlocked: Math.max(0,
          engine._bodyTerrainBlockedLayer(layer, body)),
        ...engine._bodyStateLayer(layer, body),
      });
    }
};

const visibleJitter = (samples, settleStart) => {
  const settled = samples.filter((sample) => sample.tick >= settleStart);
  let penetrationRebounds = 0;
  for (let index = 1; index < settled.length; index++) {
    const sample = settled[index];
    const previous = settled[index - 1];
    if ((previous.blocked > 0 || previous.terrainBlocked > 0)
        && sample.vy < -0.025) penetrationRebounds++;
  }
  for (let end = 59; end < settled.length; end++) {
    const window = settled.slice(end - 59, end + 1);
    if (window.filter((sample) => sample.awake).length < 45) continue;
    const xs = window.map((sample) => sample.px);
    const ys = window.map((sample) => sample.py);
    const span = Math.hypot(Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys));
    if (span < 0.75 || span > 16) continue;
    let reversals = 0;
    for (let index = 2; index < window.length; index++) {
      const a = window[index - 1], b = window[index];
      if (a.vx * b.vx + a.vy * b.vy
          + a.omega * b.omega * a.maxR * b.maxR < -0.0004)
        reversals++;
    }
    if (reversals >= 3) return { visible: true, penetrationRebounds };
  }
  return { visible: false, penetrationRebounds };
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
  engine._setRigidSolverOptions(SOLVER_MODE);
  engine.setBgEnabled(true);
  const sites = chooseSites(caveWallCandidates(engine), randomFor(seed ^ 0x51a7e));
  if (GOLDEN) {
    for (let index = 0; index < sites.length; index++) {
      const [x, y] = sites[index];
      engine.paintDiscLayer(index % 4 === 0 ? 1 : 0,
        x, y, 2, MAT.TNT, true);
    }
    engine.syncComponentsLayer(0);
    engine.syncComponentsLayer(1);
  }
  const tracks = new Map();
  let maxRejected = 0, maxDepenetrations = 0, maxOwnershipConflicts = 0;
  let maxRecoveryBodies = 0;
  let maxCells = 0, maxRadius = 0, structureBodies = 0;
  let stepWallMs = 0;
  let maxBodyBlocked = 0;
  let latePeakBodyBlocked = 0;
  let latePeakTerrainBlocked = 0;
  for (let tick = 0; tick < STEPS; tick++) {
    const blastCadence = GOLDEN ? 6 : 8;
    if (tick % blastCadence === 0
        && tick / blastCadence < sites.length) {
      const [x, y] = sites[tick / blastCadence];
      engine._detonateTnt(x, y);
    }
    const stepStart = performance.now();
    engine.stepWorld();
    stepWallMs += performance.now() - stepStart;
    if (CAPTURE_DIR && (tick === 0 || tick === STEPS - 1
        || tick % 60 === 59)) captureFrame(engine, seed, tick);
    sampleBodies(engine, tick, tracks);
    if (tick === STEPS - 1) {
      for (const samples of tracks.values()) {
        const state = samples.at(-1);
        maxCells = Math.max(maxCells, state.nPts);
        maxRadius = Math.max(maxRadius, state.maxR);
        structureBodies += state.nPts >= 1000;
      }
    }
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
  const visible = [...tracks.entries()].map(([id, samples]) => ({
    id,
    ...visibleJitter(samples, settleStart),
    final: samples.at(-1),
  }));
  const visibleJitterBodies = visible.filter((value) => value.visible).length;
  const penetrationRebounds = visible.reduce((sum, value) =>
    sum + value.penetrationRebounds, 0);
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
    chatter, visibleJitterBodies, penetrationRebounds,
    maxRejected, maxDepenetrations,
    maxBodyBlocked, latePeakBodyBlocked, finalBodyBlocked,
    latePeakTerrainBlocked, finalTerrainBlocked, finalAwake, finalOverlaps,
    maxOwnershipConflicts, maxRecoveryBodies,
    maxCells, maxRadius, structureBodies,
    visibleBodies: visible.filter((value) => value.visible),
    stepMeanMs: stepWallMs / STEPS,
  });
  engine.destroy();
}

const { check, done } = makeChecker('procedural cave blast debris settling');
for (const result of results) {
  console.log(`  seed ${result.seed}: ${result.sites} blasts, `
    + `${result.bodies} bodies, ${result.chatter} chatter, `
    + `${result.visibleJitterBodies} visible jitter, ${result.penetrationRebounds} penetration rebounds, `
    + `${result.maxRejected} rejected, ${result.maxOwnershipConflicts} conflicts, `
    + `${result.maxDepenetrations} depenetrations, `
    + `${result.maxBodyBlocked}/${result.latePeakBodyBlocked}/${result.finalBodyBlocked} body overlap, `
    + `${result.latePeakTerrainBlocked}/${result.finalTerrainBlocked} late/final overlap, `
    + `${result.finalAwake} awake${result.finalOverlaps.length
      ? ` ${JSON.stringify(result.finalOverlaps)}` : ''}, `
    + `${result.maxRecoveryBodies} recoveries, `
    + `${result.structureBodies} structure bodies, max ${result.maxCells} cells/r${result.maxRadius.toFixed(1)}, `
    + `${result.stepMeanMs.toFixed(2)} ms/step`);
  if (result.visibleBodies.length)
    console.log(`    visible ${JSON.stringify(result.visibleBodies)}`);
}
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
