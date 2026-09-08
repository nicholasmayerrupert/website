// Same-host actor/world timings for adventure combat, with deterministic state checks.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import process from 'node:process';
import { initSandWasm, createEngineWasm, MAT, PLANET, INPUT } from '../src/sand/wasmBridge/engineFactory.js';
import { CREATURE, OFF, STRIDES } from '../src/sand/wasmBridge/abi.generated.js';

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1];
};
const repeats = Number(flag('--repeat') || 3);
assert.ok(Number.isInteger(repeats) && repeats > 0, '--repeat must be a positive integer');
const ticks = Number(flag('--ticks') || 120);
assert.ok(Number.isInteger(ticks) && ticks > 0, '--ticks must be a positive integer');
const scenes = {
  creative: [],
  idle: [],
  walking: [],
  charges: Array(6).fill(CREATURE.BONE_GUARD),
  shockwaves: Array(3).fill(CREATURE.HOLLOW_BELLKEEPER),
  volleys: [CREATURE.MIRE_MATRON, CREATURE.CINDER_CASTELLAN, CREATURE.FEN_WISP, CREATURE.MINIGUNNER],
  prisms: Array(3).fill(CREATURE.FEN_WISP),
  stars: Array(3).fill(CREATURE.HOLLOW_BELLKEEPER),
  faultlines: Array(3).fill(CREATURE.ROOT_KNIGHT),
  crossfire: [CREATURE.BONE_GUARD, CREATURE.ROOT_KNIGHT, CREATURE.HOLLOW_BELLKEEPER,
    CREATURE.MIRE_MATRON, CREATURE.CINDER_CASTELLAN, CREATURE.FEN_WISP, CREATURE.MINIGUNNER],
};
const selected = flag('--only') ? flag('--only').split(',') : Object.keys(scenes);
const summary = samples => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    p50: at(.5), p95: at(.95), p99: at(.99), max: at(1),
  };
};
const fingerprint = e => {
  let hash = e.gridHash();
  for (const data of [e.getCreatureSnapshotData(), e.getProjectileSnapshotData(), e.getItemSnapshotData(), e.getDiscovery()]) {
    for (const value of new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
      hash = Math.imul(hash ^ value, 16777619) >>> 0;
  }
  for (const p of e.getPlayers()) for (const value of [p.x, p.y, p.vx, p.vy, p.health])
    hash = Math.imul(hash ^ Math.round(value * 10000), 16777619) >>> 0;
  return hash.toString(16);
};
await initSandWasm();
const session = flag('--profile') ? new Session() : null;
const post = (method, params = {}) => new Promise((resolve, reject) =>
  session.post(method, params, (error, value) => error ? reject(error) : resolve(value)));
if (session) {
  session.connect();
  await post('Profiler.enable');
  await post('Profiler.setSamplingInterval', { interval: 100 });
}
const result = {
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  config: { cols: 768, rows: 352, ticks, repeats, worldStepsPerActor: 1 },
  scenes: {},
};
for (const name of selected) {
  assert.ok(Object.hasOwn(scenes, name), `unknown scene ${name}`);
  const actor = [], world = [], turn = [], checksums = [], worstTurns = [];
  let overBudgetTurns = 0, sleepingWorldTurns = 0;
  for (let repeat = 0; repeat < repeats; repeat++) {
    const e = createEngineWasm({ cols: 768, rows: 352, worldSeed: 73,
      sinksOn: false, infinite: true, planetId: PLANET.FRONTIER });
    try {
      e.setSurvivalInventory(name !== 'creative');
      e.setCreatureRuntime(true, false);
      const cx = 384, cy = 180;
      for (let layer = 0; layer < 2; layer++) {
        e.eraseDiscLayer(layer, cx, cy - 28, 70);
        e.syncComponentsLayer(layer);
      }
      for (let layer = 0; layer < 2; layer++) {
        for (let y = cy + 24; y < cy + 48; y++) for (let x = cx - 75; x < cx + 75; x++)
          e.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
        e.syncComponentsLayer(layer);
      }
      e.stepWorld();
      const player = name === 'creative' ? 0 : e.spawnPlayer(cx - 45, cy + 16);
      for (let i = 0; i < scenes[name].length; i++)
        e.spawnScriptedCreature(scenes[name][i], cx - 15 + i * 18 + e.getWorldOffsetX(), cy + e.getWorldOffsetY());
      const snapshot = e.getCreatureSnapshotData(), o = OFF.creatureSnapshot;
      for (let i = 0; i < snapshot.length; i += STRIDES.creatureSnapshot) {
        snapshot[i + o.y] = cy + 24 - snapshot[i + o.h];
        snapshot[i + o.facing] = -1;
        snapshot[i + o.attackState] = 2;
        snapshot[i + o.attackPattern] = ['volleys', 'prisms', 'stars', 'faultlines', 'crossfire'].includes(name) ? 1 : 0;
        snapshot[i + o.attackProgress] = 1;
        snapshot[i + o.aimX] = cx - 45;
        snapshot[i + o.aimY] = cy + 20;
      }
      e.setMirrorCreatures(snapshot, e.getWorldOffsetX(), e.getWorldOffsetY());
      if (session) await post('Profiler.start');
      for (let tick = 0; tick < result.config.ticks; tick++) {
        if (name === 'walking') e.setPlayerInput(player, {
          bits: tick < 60 ? INPUT.RIGHT : INPUT.LEFT, aimX: cx, aimY: cy,
        });
        e.stepActors();
        // Match the worker's coherent actor/world turn, including quiet-world skips.
        const worldAdvanced = e.stepWorld();
        const perf = e.getPerf();
        const totalMs = perf.actorMs + perf.stepMs;
        actor.push(perf.actorMs); world.push(perf.stepMs); turn.push(totalMs);
        if (totalMs > 1000 / 60) overBudgetTurns++;
        if (!worldAdvanced) sleepingWorldTurns++;
        if (worldAdvanced && (worstTurns.length < 8 || totalMs > worstTurns.at(-1).totalMs)) {
          worstTurns.push({ repeat, tick, totalMs, ...perf });
          worstTurns.sort((a, b) => b.totalMs - a.totalMs);
          worstTurns.length = Math.min(8, worstTurns.length);
        }
        e.drainSoundEvents();
        if (player && !e.getPlayer(player).alive) e.respawnPlayer(player);
      }
      if (session) {
        const { profile } = await post('Profiler.stop');
        writeFileSync(`${flag('--profile')}-${name}-${repeat}.cpuprofile`, JSON.stringify(profile));
      }
      checksums.push(fingerprint(e));
    } finally { e.destroy(); }
  }
  assert.equal(new Set(checksums).size, 1, `${name} is deterministic`);
  const scene = { actor: summary(actor), world: summary(world), turn: summary(turn),
    overBudgetTurns, sleepingWorldTurns, checksum: checksums[0], worstTurns };
  result.scenes[name] = scene;
  console.log(name, JSON.stringify({ ...scene, worstTurns: undefined }));
}
session?.disconnect();
if (flag('--json')) writeFileSync(flag('--json'), JSON.stringify(result, null, 2) + '\n');
if (flag('--compare')) {
  const baseline = JSON.parse(readFileSync(flag('--compare'), 'utf8'));
  assert.equal(result.config.worldStepsPerActor, baseline.config.worldStepsPerActor,
    'world/actor cadence must match; record a baseline with the current benchmark');
  for (const key of ['cols', 'rows', 'ticks']) assert.equal(result.config[key], baseline.config[key], `${key} must match`);
  for (const [name, current] of Object.entries(result.scenes)) {
    const before = baseline.scenes[name];
    assert.ok(before, `baseline has no ${name} scene`);
    assert.equal(current.checksum, before.checksum, `${name} state changed`);
    console.log(`${name}: actor mean ${(current.actor.mean / before.actor.mean * 100 - 100).toFixed(1)}%, p95 ${(current.actor.p95 / before.actor.p95 * 100 - 100).toFixed(1)}%; world mean ${(current.world.mean / before.world.mean * 100 - 100).toFixed(1)}%`);
    const beforeRate = before.overBudgetTurns / (baseline.config.ticks * baseline.config.repeats) * 100;
    const currentRate = current.overBudgetTurns / (result.config.ticks * result.config.repeats) * 100;
    console.log(`${name}: turn p95 ${before.turn.p95.toFixed(3)} -> ${current.turn.p95.toFixed(3)} ms; p99 ${before.turn.p99.toFixed(3)} -> ${current.turn.p99.toFixed(3)} ms; over-budget ${beforeRate.toFixed(2)}% -> ${currentRate.toFixed(2)}%`);
  }
}
