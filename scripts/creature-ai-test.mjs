import assert from 'node:assert/strict';
import { initSandWasm, createEngineWasm, MAT, PLANET } from '../src/sand/wasmBridge/engineFactory.js';
import { CREATURE, MISSION } from '../src/sand/wasmBridge/abi.generated.js';
await initSandWasm();
const options = { cols: 200, rows: 128, worldSeed: 713, sinksOn: false, infinite: false, planetId: PLANET.FRONTIER };
const rectangle = (e, x0, y0, x1, y1, mat = MAT.STONE) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) e.paintDisc(x, y, 0, mat, true);
  e.syncComponents();
};
const arena = () => {
  const e = createEngineWasm(options);
  e.setSurvivalInventory(true); e.setCreatureRuntime(true, false);
  rectangle(e, 0, 100, 200, 128);
  return e;
};
const creature = (e, id) => e.getCreatures().find(c => c.id === id);
const ticks = (e, n, before = () => {}) => { for (let i = 0; i < n; i++) { before(i); e.stepActors(); } };
function run(label, fn) { const e = arena(); try { fn(e); console.log(`ok: ${label}`); } finally { e.destroy(); } }

run('melee arrives at striking distance without walking through its target', e => {
  const p = e.spawnPlayer(100, 92), id = e.spawnScriptedCreature(CREATURE.BONE_GUARD, 62, 94);
  const positions = [], facings = [];
  ticks(e, 330, i => {
    e.setPlayerState(p, { x: 100, y: 92 });
    if (i > 270) { positions.push(creature(e, id).x); facings.push(creature(e, id).facing); }
  });
  assert.ok(Math.max(...positions) < 100, 'the guard stays on its approach side');
  assert.ok(Math.max(...positions) - Math.min(...positions) < 1, `arrival holds a stable combat position (${Math.min(...positions)}..${Math.max(...positions)})`);
  assert.equal(new Set(facings).size, 1, 'stationary combat does not alternate facing');
});

run('near-equal targets keep their incumbent instead of flipping across a blocked actor', e => {
  rectangle(e, 76, 70, 80, 100); rectangle(e, 90, 70, 94, 100);
  const left = e.spawnPlayer(42, 92), right = e.spawnPlayer(122, 92);
  const id = e.spawnScriptedCreature(CREATURE.BONE_GUARD, 80, 94);
  const facings = [];
  ticks(e, 180, i => {
    e.setPlayerState(left, { x: 42 + (i % 2), y: 92 });
    e.setPlayerState(right, { x: 122 - (i % 2), y: 92 });
    if (i > 20) facings.push(creature(e, id).facing);
  });
  assert.equal(new Set(facings).size, 1, 'target score hysteresis prevents left/right thrashing');
});

run('an unreachable wall produces a stable wait and a terrain edit reopens pursuit', e => {
  rectangle(e, 91, 40, 96, 100);
  const p = e.spawnPlayer(130, 92), id = e.spawnScriptedCreature(CREATURE.BONE_GUARD, 64, 94);
  const poses = [];
  ticks(e, 240, i => { if (i > 140) poses.push(creature(e, id)); });
  assert.equal(new Set(poses.map(c => c.facing)).size, 1);
  assert.ok(Math.max(...poses.map(c => c.y)) - Math.min(...poses.map(c => c.y)) < .5, 'unreachable walls do not trigger endless hops');
  const stopped = creature(e, id).x;
  rectangle(e, 91, 40, 96, 100, MAT.EMPTY);
  ticks(e, 180, () => e.setPlayerState(p, { x: 130, y: 92 }));
  assert.ok(creature(e, id).x > stopped + 20, 'live terrain replanning resumes movement after the wall is removed');
});

run('a walker clears a reachable ledge using its real jump arc', e => {
  rectangle(e, 84, 96, 91, 100);
  const p = e.spawnPlayer(121, 92), id = e.spawnScriptedCreature(CREATURE.BRIAR_WOLF, 62, 96);
  let highest = 96, furthest = 62;
  ticks(e, 300, () => {
    e.setPlayerState(p, { x: 121, y: 92 });
    const c = creature(e, id); highest = Math.min(highest, c.y); furthest = Math.max(furthest, c.x);
  });
  assert.ok(highest < 92, `jump lifts the body above the ledge (${highest})`);
  assert.ok(furthest > 91, `the actor progresses beyond the ledge (${furthest})`);
});

run('walkers wait at a gap wider than their jump rather than falling down it', e => {
  rectangle(e, 84, 100, 116, 128, MAT.EMPTY);
  e.spawnPlayer(132, 92);
  const id = e.spawnScriptedCreature(CREATURE.BONE_GUARD, 64, 94);
  ticks(e, 240);
  const c = creature(e, id);
  assert.ok(c.x < 84 && c.y < 95, `unreachable gap is held safely (${c.x}, ${c.y})`);
});

run('a jump retains its chosen direction when the target crosses behind the actor', e => {
  rectangle(e, 84, 96, 91, 100);
  const p = e.spawnPlayer(121, 92), id = e.spawnScriptedCreature(CREATURE.BRIAR_WOLF, 62, 96);
  let launched = null;
  for (let i = 0; i < 150; i++) {
    e.stepActors();
    const c = creature(e, id);
    if (c.vy < -.3 && c.x > 70) { launched = c; break; }
  }
  assert.ok(launched, 'the obstacle creates a planned jump');
  const velocities = [];
  ticks(e, 8, () => {
    e.setPlayerState(p, { x: 40, y: 92 });
    velocities.push(creature(e, id).vx);
  });
  assert.ok(velocities.every(vx => vx >= 0), 'pursuit cannot reverse a committed jump halfway through its arc');
});

run('an unreachable directly overhead target does not produce direction or jump thrashing', e => {
  rectangle(e, 60, 76, 105, 79);
  const p = e.spawnPlayer(81, 68), id = e.spawnScriptedCreature(CREATURE.BONE_GUARD, 79, 94);
  const poses = [];
  ticks(e, 180, i => { e.setPlayerState(p, { x: 81, y: 68 }); if (i > 60) poses.push(creature(e, id)); });
  assert.ok(new Set(poses.map(c => c.facing)).size <= 2);
  assert.ok(Math.min(...poses.map(c => c.y)) > 89, 'the blocked ceiling is not treated as a traversable jump');
});

run('navigation commitments survive a checkpoint with identical actor continuation', e => {
  rectangle(e, 84, 96, 91, 100);
  const p = e.spawnPlayer(121, 92); e.startMission(MISSION.FRONTIER, p);
  e.spawnScriptedCreature(CREATURE.BRIAR_WOLF, 70, 96);
  ticks(e, 15);
  const saved = e.writeCheckpoint(), restored = createEngineWasm(options);
  try {
    assert.ok(restored.readCheckpoint(saved)); restored.setCreatureRuntime(true, false);
    for (let i = 0; i < 90; i++) {
      e.stepActors(); restored.stepActors();
      assert.deepEqual(restored.getCreatureSnapshotData(), e.getCreatureSnapshotData(), `same movement after restore at tick ${i}`);
    }
  } finally { restored.destroy(); }
});
