// Deterministic kinematic actor-collider tests for free rigid bodies.
//
//   node scripts/actor-rigid-test.mjs
//
// Players and creatures remain gameplay-controlled AABBs, but the rigid solver
// sees matching kinematic rectangles. Their contact normals and friction can
// stop, carry, support, and rotate dynamic bodies.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { CREATURE } from '../src/sand/wasmBridge/abi.generated.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('actor / rigid-body interactions');
const COLS = 180, ROWS = 130;
const mk = () => attachTestHooks(createEngineWasmRaw({
  cols: COLS, rows: ROWS, worldSeed: 0xA670, sinksOn: false, infinite: false,
}));
const stoneRect = (e, x0, y0, x1, y1) => {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) e.paintDisc(x, y, 0, MAT.STONE, true);
  e.syncComponents();
};
const floor = (e, top = 110) => stoneRect(e, 4, top, COLS - 4, ROWS);
const stepWorld = (e, count) => {
  for (let i = 0; i < count; i++) e.stepWorld();
};
const creature = (e, id) =>
  e.getCreatures().find((entry) => entry.id === id);

// A fast thin body must sweep into the player proxy and stop on its near face
// instead of crossing the complete actor between final raster poses.
{
  const e = mk();
  const id = e.spawnPlayer(82, 58);
  e.spawnBox(58, 62, 1, 6, MAT.RIGID);
  e._setBodyMotion(0, 50, 0, 0);
  stepWorld(e, 18);
  const body = e._bodyState(0), player = e.getPlayer(id);
  check(`fast body stops at player (x ${body.px.toFixed(2)}, vx ${body.vx.toFixed(2)})`,
    body.px < player.x && Math.abs(body.vx) < 0.05 &&
    player.x === 82 && player.alive);
  e.destroy();
}

// A centered slab has its center of mass over the actor support interval and
// should reach a quiet equilibrium on the player's head.
{
  const e = mk();
  e.spawnPlayer(82, 58);
  e.spawnBox(84, 45, 5, 3, MAT.RIGID);
  stepWorld(e, 45);
  const body = e._bodyState(0);
  check(`centered slab balances on player (${body.py.toFixed(2)}, ${body.angle.toFixed(3)} rad)`,
    body.py > 54 && body.py < 56 &&
    Math.abs(body.angle) < 0.02 && Math.abs(body.vy) < 0.01);
  e.destroy();
}

// Moving the same slab until its center of mass is outside the support interval
// must turn normal impulses into torque and let it roll off.
{
  const e = mk();
  e.spawnPlayer(82, 58);
  e.spawnBox(86, 45, 5, 3, MAT.RIGID);
  stepWorld(e, 80);
  const body = e._bodyState(0);
  check(`off-center slab rolls off player (${body.py.toFixed(2)}, ${body.angle.toFixed(2)} rad)`,
    body.py > 70 && Math.abs(body.angle) > 1);
  e.destroy();
}

// Creatures use the same exact AABB proxy. This reproduces the oblong-body case
// on the cluster wasp that motivated the kinematic contact path.
{
  const e = mk();
  const id = e.spawnCreature(CREATURE.CLUSTER_WASP, 82, 60);
  e.spawnBox(90, 48, 6, 2, MAT.RIGID);
  stepWorld(e, 80);
  const body = e._bodyState(0), wasp = creature(e, id);
  check(`oblong body clears the wasp (${body.py.toFixed(2)}, ${body.angle.toFixed(2)} rad)`,
    wasp?.alive && body.py > 75);
  e.destroy();
}

// Kinematic velocity participates in friction even though the proxy pose is not
// integrated by the rigid solver.
{
  const e = mk();
  const id = e.spawnPlayer(82, 58);
  e.setPlayerState(id, { x: 82, y: 58, vx: 0.8, vy: 0 });
  e.spawnBox(84, 50, 2, 1, MAT.RIGID);
  stepWorld(e, 20);
  const body = e._bodyState(0);
  check(`moving actor surface carries body (vx ${body.vx.toFixed(2)})`,
    body.vx > 0.55);
  e.destroy();
}

// A high-load contact against terrain damages rather than executes the player.
{
  const e = mk();
  floor(e, 105);
  const id = e.spawnPlayer(78, 97);
  e.spawnBox(80, 78, 8, 3, MAT.RIGID);
  e._setBodyMotion(0, 0, 20, 0);
  stepWorld(e, 20);
  const player = e.getPlayer(id), body = e._bodyState(0);
  check(`falling slab deals bounded crush damage (${player.health} health)`,
    player.alive && player.health === 82 &&
    body.py < player.y && Math.abs(body.vy) < 0.05);
  e.destroy();
}

// Sustained load can reduce health to one, but the crush lifecycle itself never
// kills the player.
{
  const e = mk();
  floor(e, 105);
  const id = e.spawnPlayer(78, 97);
  e.spawnBox(80, 78, 8, 3, MAT.RIGID);
  e._setBodyMotion(0, 0, 20, 0);
  for (let tick = 0; tick < 200; tick++) {
    e.stepActors();
    e.stepWorld();
  }
  const player = e.getPlayer(id);
  check(`sustained crush remains nonlethal (${player.health} health)`,
    player.alive && player.health === 1);
  e.destroy();
}

// Enemies take the same bounded damage and remain valid combat actors.
{
  const e = mk();
  floor(e);
  const id = e.spawnCreature(CREATURE.MINIGUNNER, 91, 104);
  e.spawnBox(95, 82, 8, 3, MAT.RIGID);
  e._setBodyMotion(0, 0, 20, 0);
  stepWorld(e, 20);
  const target = creature(e, id);
  check(`creature crush damage is bounded (${target?.health} health)`,
    target?.alive && target.health === target.maxHealth - 18);
  e.destroy();
}

// Fixed initial state produces identical actor and rigid-body outcomes.
{
  const replay = () => {
    const e = mk();
    floor(e, 118);
    const playerId = e.spawnPlayer(72, 67);
    const creatureId = e.spawnCreature(CREATURE.CLUSTER_WASP, 108, 74);
    e.spawnBox(50, 70, 6, 4, MAT.RIGID);
    e.spawnBox(98, 62, 5, 2, MAT.RIGID);
    e._setBodyMotion(0, 3, 0.4, 0.07);
    e._setBodyMotion(1, 1.4, 0.8, -0.04);
    stepWorld(e, 48);
    const player = e.getPlayer(playerId);
    const target = creature(e, creatureId);
    const bodies = [e._bodyState(0), e._bodyState(1)];
    const result = [
      player.x, player.y, player.health, target.x, target.y, target.health,
      ...bodies.flatMap((body) =>
        [body.px, body.py, body.angle, body.vx, body.vy, body.omega]),
    ];
    e.destroy();
    return result;
  };
  const first = replay(), second = replay();
  check('actor/body contact outcomes replay exactly',
    first.length === second.length &&
    first.every((value, index) => value === second[index]));
}

const failures = done();
if (failures) {
  console.error(`\n${failures} actor/rigid test(s) failed`);
  process.exit(1);
}
console.log('\nall actor/rigid tests passed');
