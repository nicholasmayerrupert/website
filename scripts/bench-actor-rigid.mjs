// Player/creature actor cadence plus dense one-way rigid sweep interactions.
//
//   node scripts/bench-actor-rigid.mjs
//   node scripts/bench-actor-rigid.mjs --compare bench/actor-rigid-baseline.json
//   node scripts/bench-actor-rigid.mjs --update bench/actor-rigid-baseline.json

import { readFileSync, writeFileSync } from 'node:fs';
import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { CREATURE } from '../src/sand/wasmBridge/abi.generated.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const comparePath = valueAfter('--compare');
const updatePath = valueAfter('--update');
if ((args.includes('--compare') && !comparePath) || (args.includes('--update') && !updatePath))
  throw new Error('--compare and --update require a path');

await initSandWasm();
const COLS = 320, ROWS = 260, REPEATS = 5;
const create = () => attachTestHooks(createEngineWasmRaw({
  cols: COLS, rows: ROWS, worldSeed: 0xA670B3, sinksOn: false, infinite: false,
}));
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
};
const stats = (values) => ({
  p50: percentile(values, 0.50),
  p95: percentile(values, 0.95),
  mean: values.reduce((sum, value) => sum + value, 0) / values.length,
});
const hashNumber = (state, value) => {
  let bits = Math.round(value * 10000) | 0;
  for (let byte = 0; byte < 4; byte++) {
    state.value ^= (bits >>> (byte * 8)) & 0xff;
    state.value = Math.imul(state.value, 0x01000193) >>> 0;
  }
};
const hashActorsAndBodies = (e) => {
  const state = { value: 0x811c9dc5 };
  for (const p of e.getPlayers())
    for (const value of [p.id, p.x, p.y, p.vx, p.vy, p.health, p.alive ? 1 : 0])
      hashNumber(state, value);
  for (const c of e.getCreatures())
    for (const value of [c.id, c.species, c.x, c.y, c.vx, c.vy, c.health, c.alive ? 1 : 0])
      hashNumber(state, value);
  for (let i = 0; i < e._bodyCount(); i++) {
    const b = e._bodyState(i);
    for (const value of [b.px, b.py, b.angle, b.vx, b.vy, b.omega])
      hashNumber(state, value);
  }
  return state.value >>> 0;
};

const runActorCadence = () => {
  const samples = [];
  let checksum = 0;
  for (let repeat = 0; repeat < REPEATS; repeat++) {
    const e = create();
    for (let y = 230; y < ROWS; y++)
      for (let x = 4; x < COLS - 4; x++) e.paintDisc(x, y, 0, MAT.STONE, true);
    e.syncComponents();
    for (let i = 0; i < 64; i++) e.spawnPlayer(12 + (i % 32) * 9, 214 - ((i / 32) | 0) * 12);
    for (let i = 0; i < 64; i++)
      e.spawnCreature(CREATURE.BIRD, 10 + (i % 32) * 9, 40 + ((i / 32) | 0) * 34);
    e.setCreatureRuntime(true, false);
    for (let tick = 0; tick < 240; tick++) {
      e.stepActors();
      if (tick >= 20) samples.push(e.getPerf().actorMs);
    }
    checksum ^= hashActorsAndBodies(e);
    e.destroy();
  }
  return { samples, checksum: checksum >>> 0, actors: 128 };
};

const runRigidSweeps = () => {
  const bodySamples = [], wallSamples = [];
  let checksum = 0;
  const lanes = 14, actorsPerLane = 10;
  for (let repeat = 0; repeat < REPEATS; repeat++) {
    const e = create();
    for (let lane = 0; lane < lanes; lane++) {
      const cy = 20 + lane * 16;
      e.spawnBox(20, cy, 3, 5, MAT.RIGID);
      e._setBodyMotion(lane, 30, 0, lane % 2 ? 0.015 : -0.015);
      for (let column = 0; column < actorsPerLane; column++) {
        const x = 52 + column * 24;
        if ((lane + column) & 1) e.spawnPlayer(x, cy - 4);
        else e.spawnCreature(CREATURE.BIRD, x, cy - 2);
      }
    }
    for (let tick = 0; tick < 96; tick++) {
      const started = performance.now();
      e.stepWorld();
      wallSamples.push(performance.now() - started);
      bodySamples.push(e.getStepPerf().bodyMs);
    }
    checksum ^= hashActorsAndBodies(e);
    e.destroy();
  }
  return {
    bodySamples, wallSamples, checksum: checksum >>> 0,
    actors: lanes * actorsPerLane, bodies: lanes,
  };
};

const actor = runActorCadence();
const sweep = runRigidSweeps();
const result = {
  scene: {
    repeats: REPEATS,
    actorCadence: { actors: actor.actors, ticks: 240 },
    rigidSweeps: { actors: sweep.actors, bodies: sweep.bodies, ticks: 96 },
  },
  checksum: {
    actorCadence: `0x${actor.checksum.toString(16).padStart(8, '0')}`,
    rigidSweeps: `0x${sweep.checksum.toString(16).padStart(8, '0')}`,
  },
  actorMs: stats(actor.samples),
  rigidActorBodyMs: stats(sweep.bodySamples),
  rigidActorWallMs: stats(sweep.wallSamples),
};

const format = (metric) =>
  `p50 ${metric.p50.toFixed(3)}  p95 ${metric.p95.toFixed(3)}  mean ${metric.mean.toFixed(3)}`;
console.log('actor / rigid interaction benchmark');
console.log(`  actor cadence : ${result.scene.actorCadence.actors} actors x ${result.scene.actorCadence.ticks} ticks`);
console.log(`  rigid sweeps  : ${result.scene.rigidSweeps.bodies} bodies through ${result.scene.rigidSweeps.actors} actors x ${result.scene.rigidSweeps.ticks} ticks`);
console.log(`  checksums     : actors ${result.checksum.actorCadence}  sweeps ${result.checksum.rigidSweeps}`);
console.log(`  actor ms      : ${format(result.actorMs)}`);
console.log(`  body phase ms : ${format(result.rigidActorBodyMs)}`);
console.log(`  sweep wall ms : ${format(result.rigidActorWallMs)}`);

if (updatePath) {
  writeFileSync(updatePath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`\nupdated baseline ${updatePath}`);
}

if (comparePath) {
  const baseline = JSON.parse(readFileSync(comparePath, 'utf8'));
  const failures = [];
  for (const key of Object.keys(result.checksum))
    if (result.checksum[key] !== baseline.checksum[key])
      failures.push(`${key} checksum ${baseline.checksum[key]} -> ${result.checksum[key]}`);
  for (const [key, label] of [
    ['actorMs', 'actor cadence'],
    ['rigidActorBodyMs', 'body phase'],
    ['rigidActorWallMs', 'sweep wall'],
  ]) {
    for (const metricName of ['p50', 'mean']) {
      const before = baseline[key][metricName], after = result[key][metricName];
      const absoluteMargin = metricName === 'p50' ? 0.15 : 0.30;
      const limit = Math.max(before * 1.50, before + absoluteMargin);
      if (after > limit)
        failures.push(`${label} ${metricName} ${before.toFixed(3)} -> ${after.toFixed(3)} (limit ${limit.toFixed(3)})`);
    }
  }
  console.log(`\ncompare vs ${comparePath}`);
  console.log(failures.length ? failures.map((failure) => `  REGRESSION: ${failure}`).join('\n') : '  regression gate: pass');
  if (failures.length) process.exitCode = 1;
}
