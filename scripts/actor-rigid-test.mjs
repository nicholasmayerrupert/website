// Deterministic player/creature interaction tests for free rigid bodies.
//
//   node scripts/actor-rigid-test.mjs
//
// Rigid poses are authoritative inputs here: actors may be swept, pushed, or
// crushed, but never feed a correction or impulse back into a body.

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
const bodyOverlaps = (e, actor) => {
  const owners = e._bodyOwnerGrid();
  const x0 = Math.floor(actor.x), x1 = Math.floor(actor.x + actor.w - 1e-6);
  const y0 = Math.floor(actor.y), y1 = Math.floor(actor.y + actor.h - 1e-6);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
    if (x >= 0 && x < COLS && y >= 0 && y < ROWS && owners[y * COLS + x] >= 0)
      return true;
  return false;
};
const bodyInvadesCollider = (e, actor, skin = 0.35) => {
  const owners = e._bodyOwnerGrid();
  const x0 = Math.floor(actor.x - skin);
  const x1 = Math.floor(actor.x + actor.w + skin - 1e-6);
  const y0 = Math.floor(actor.y - skin);
  const y1 = Math.floor(actor.y + actor.h + skin - 1e-6);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
    if (x >= 0 && x < COLS && y >= 0 && y < ROWS &&
        owners[y * COLS + x] >= 0 &&
        actor.x - skin < x + 1 && actor.x + actor.w + skin > x &&
        actor.y - skin < y + 1 && actor.y + actor.h + skin > y)
      return true;
  return false;
};
const creature = (e, id) => e.getCreatures().find((entry) => entry.id === id);
const stepWorld = (e, count) => {
  for (let i = 0; i < count; i++) e.stepWorld();
};

// A fast body must sweep the player's AABB instead of passing completely
// through it between final raster poses.
{
  const e = mk();
  const id = e.spawnPlayer(82, 58);
  e.spawnBox(58, 62, 1, 6, MAT.RIGID);
  e._setBodyMotion(0, 50, 0, 0);
  let everOverlapped = false;
  for (let i = 0; i < 18; i++) {
    e.stepWorld();
    everOverlapped ||= bodyOverlaps(e, e.getPlayer(id));
  }
  const p = e.getPlayer(id);
  check(`fast thin body pushes player instead of tunneling (x ${p.x.toFixed(1)})`,
    p.alive && p.x > 98 && !everOverlapped);
  e.destroy();
}

// An ordinary side contact carries velocity into the actor and leaves it on the
// leading face rather than embedded in the body.
{
  const e = mk();
  const id = e.spawnPlayer(82, 58);
  e.spawnBox(68, 62, 4, 5, MAT.RIGID);
  e._setBodyMotion(0, 3, 0, 0);
  stepWorld(e, 8);
  const p = e.getPlayer(id);
  check(`player's padded rigid collider is pushed in free space (x ${p.x.toFixed(1)}, vx ${p.vx.toFixed(2)})`,
    p.alive && p.x > 90 && p.vx > 0 &&
      !bodyOverlaps(e, p) && !bodyInvadesCollider(e, p));
  e.destroy();
}

// Pure angular motion has a local swept direction even when the body's center
// barely translates. The actor follows the rotating tip without body overlap.
{
  const e = mk();
  const beam = [];
  for (let x = 50; x <= 110; x++) beam.push([x, 70], [x, 71]);
  e.spawnBody(beam);
  const id = e.spawnPlayer(102, 56);
  e._setBodyMotion(0, 0, -0.06, -0.25);
  let everOverlapped = false;
  for (let i = 0; i < 8; i++) {
    e.stepWorld();
    everOverlapped ||= bodyOverlaps(e, e.getPlayer(id));
  }
  const p = e.getPlayer(id);
  check(`rotating beam pushes player along its swept tip (${p.x.toFixed(1)},${p.y.toFixed(1)})`,
    p.alive && p.y < 52 && p.x < 100 && !everOverlapped);
  e.destroy();
}

// A falling slab cannot move a player through the solid floor. The blocked
// downward sweep damages the player without killing or rescue-teleporting them.
{
  const e = mk();
  floor(e, 105);
  const id = e.spawnPlayer(78, 97);
  e.spawnBox(80, 78, 8, 3, MAT.RIGID);
  e._setBodyMotion(0, 0, 20, 0);
  let maxY = e.getPlayer(id).y;
  for (let i = 0; i < 16 && e.getPlayer(id).alive; i++) {
    e.stepWorld();
    maxY = Math.max(maxY, e.getPlayer(id).y);
  }
  const p = e.getPlayer(id);
  check(`falling slab nonlethally crushes player against terrain (y ${p.y.toFixed(1)}, health ${p.health})`,
    p.alive && p.health > 0 && p.health < 100 && maxY < 105);
  e.destroy();
}

// The same sandwich along X must keep the player on the approach side of the
// wall instead of selecting a distant escape face.
{
  const e = mk();
  floor(e);
  stoneRect(e, 104, 88, 112, 110);
  const id = e.spawnPlayer(100, 102);
  e.spawnBox(88, 106, 4, 4, MAT.RIGID);
  e._setBodyMotion(0, 20, 0, 0);
  stepWorld(e, 8);
  const p = e.getPlayer(id);
  check(`side push nonlethally crushes player against solid wall (x ${p.x.toFixed(1)}, health ${p.health})`,
    p.alive && p.health > 0 && p.health < 100 && p.x < 104);
  e.destroy();
}

// Crush damage cannot deliver a killing blow, including when the actor was
// already at low health before the body arrived.
{
  const e = mk();
  floor(e);
  stoneRect(e, 104, 88, 112, 110);
  const id = e.spawnPlayer(100, 102);
  e._damagePlayer(id, 90);
  e.stepActors();
  e.spawnBox(88, 106, 4, 4, MAT.RIGID);
  e._setBodyMotion(0, 20, 0, 0);
  stepWorld(e, 8);
  const p = e.getPlayer(id);
  check(`crush damage leaves a low-health player at 1 HP (health ${p.health})`,
    p.alive && p.health === 1 && p.x < 104);
  e.destroy();
}

// A loose chip smaller than half an actor is not a cave collapse. If it cannot
// displace the player, it stays pinned without executing or teleporting them.
{
  const e = mk();
  floor(e);
  stoneRect(e, 104, 88, 112, 110);
  const id = e.spawnPlayer(100, 102);
  e.spawnBox(97, 105, 1, 2, MAT.RIGID);
  e._setBodyMotion(0, 20, 0, 0);
  stepWorld(e, 8);
  const p = e.getPlayer(id);
  check(`small trapped rubble pins without becoming a lethal slab (x ${p.x.toFixed(1)})`,
    p.alive && p.health === 100 && p.x < 104);
  e.destroy();
}

// All body stamps are absent during the solver step, so this guards the direct
// final-footprint query that makes the second rigid an obstacle.
{
  const e = mk();
  const id = e.spawnPlayer(60, 46);
  e.spawnBox(53, 50, 3, 5, MAT.RIGID);
  e.spawnBox(68, 50, 3, 5, MAT.RIGID);
  e._setBodyMotion(0, 5, 0, 0);
  stepWorld(e, 8);
  const p = e.getPlayer(id);
  check(`rigid/player/rigid sandwich damages without crossing the blocker (x ${p.x.toFixed(1)}, health ${p.health})`,
    p.alive && p.health > 0 && p.health < 100 && p.x < 65);
  e.destroy();
}

// Walkers and flyers share the same no-tunneling contract despite using
// different locomotion code on their actor ticks.
for (const [label, species, y] of [
  ['walker', CREATURE.DYNAMITEER, 105],
  ['flyer', CREATURE.BIRD, 60],
]) {
  const e = mk();
  if (label === 'walker') floor(e);
  const id = e.spawnCreature(species, 82, y);
  e.spawnBox(68, y + 2, 4, 3, MAT.RIGID);
  e._setBodyMotion(0, 30, 0, 0);
  let everOverlapped = false;
  for (let i = 0; i < 10; i++) {
    e.stepWorld();
    everOverlapped ||= bodyOverlaps(e, creature(e, id));
  }
  const c = creature(e, id);
  check(`${label} creature collider is pushed and remains outside the body (x ${c.x.toFixed(1)})`,
    c.alive && c.x > 94 && c.vx > 0 &&
      !everOverlapped && !bodyInvadesCollider(e, c));
  e.destroy();
}

// Aquatic agents use the identical body sweep while surrounded by a fluid
// pressure domain; fluid coupling may slow the body but cannot disable pushing.
{
  const e = mk();
  for (let y = 38; y < 102; y++)
    for (let x = 4; x < COLS - 4; x++) e.paintDisc(x, y, 0, MAT.WATER, true);
  const id = e.spawnCreature(CREATURE.MINNOW, 82, 60);
  e.spawnBox(68, 61, 4, 2, MAT.RIGID);
  e._setBodyMotion(0, 30, 0, 0);
  let everOverlapped = false;
  for (let i = 0; i < 12; i++) {
    e.stepWorld();
    everOverlapped ||= bodyOverlaps(e, creature(e, id));
  }
  const c = creature(e, id);
  check(`aquatic creature is pushed in a live fluid domain (x ${c.x.toFixed(1)})`,
    c.alive && c.x > 86 && !everOverlapped);
  e.destroy();
}

// Terrain and body sandwiches use the same nonlethal crush rule for creatures.
{
  const e = mk();
  floor(e);
  stoneRect(e, 100, 88, 108, 110);
  const id = e.spawnCreature(CREATURE.MINIGUNNER, 91, 104);
  e.spawnBox(79, 107, 4, 3, MAT.RIGID);
  e._setBodyMotion(0, 30, 0, 0);
  stepWorld(e, 10);
  const c = creature(e, id);
  check(`rigid/creature/terrain sandwich damages without crossing wall (x ${c.x.toFixed(1)}, health ${c.health})`,
    c.alive && c.health > 0 && c.health < c.maxHealth && c.x < 100);
  e.destroy();
}
{
  const e = mk();
  floor(e);
  const id = e.spawnCreature(CREATURE.DYNAMITEER, 60, 105);
  e.spawnBox(52, 107, 3, 3, MAT.RIGID);
  e.spawnBox(72, 107, 3, 3, MAT.RIGID);
  e._setBodyMotion(0, 30, 0, 0);
  stepWorld(e, 10);
  const c = creature(e, id);
  check(`rigid/creature/rigid sandwich damages without far-side teleport (x ${c.x.toFixed(1)}, health ${c.health})`,
    c.alive && c.health > 0 && c.health < c.maxHealth && c.x < 69);
  e.destroy();
}

// Body-to-actor displacement is one-way. A free body's pose and velocity remain
// identical while it pushes an actor because no actor impulse is applied to it.
{
  const setup = (withActor) => {
    const e = mk();
    e.spawnBox(50, 66, 6, 4, MAT.RIGID);
    e._setBodyMotion(0, 3, 0, 0);
    if (withActor) e.spawnPlayer(72, 67);
    return e;
  };
  const control = setup(false), actors = setup(true);
  let identical = true;
  for (let tick = 0; tick < 12; tick++) {
    control.stepWorld();
    actors.stepWorld();
    const a = control._bodyState(0), b = actors._bodyState(0);
    identical &&= a.px === b.px && a.py === b.py && a.angle === b.angle &&
      a.vx === b.vx && a.vy === b.vy && a.omega === b.omega;
  }
  check('actor displacement applies no direct impulse or correction to a free body', identical);
  control.destroy();
  actors.destroy();
}

// Fixed initial state produces the same actor outcomes exactly.
{
  const replay = () => {
    const e = mk();
    floor(e);
    stoneRect(e, 104, 88, 112, 110);
    const playerId = e.spawnPlayer(100, 102);
    const creatureId = e.spawnCreature(CREATURE.DYNAMITEER, 82, 105);
    e.spawnBox(68, 106, 4, 4, MAT.RIGID);
    e._setBodyMotion(0, 30, 0, 0);
    stepWorld(e, 16);
    const p = e.getPlayer(playerId), c = creature(e, creatureId);
    const result = [p.x, p.y, p.vx, p.vy, p.health, p.alive,
      c.x, c.y, c.vx, c.vy, c.health, c.alive];
    e.destroy();
    return result;
  };
  const a = replay(), b = replay();
  check('actor/body push and crush outcomes replay exactly',
    a.length === b.length && a.every((value, i) => value === b[i]));
}

const failures = done();
if (failures) {
  console.error(`\n${failures} actor/rigid test(s) failed`);
  process.exit(1);
}
console.log('\nall actor/rigid tests passed');
