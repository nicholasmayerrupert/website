// Finite-mass actor contacts, rigid-driven movement, and support-cut regressions.
import {
  initSandWasm, createEngineWasm as createEngineWasmRaw, MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { CREATURE } from '../src/sand/wasmBridge/abi.generated.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('actor / rigid-body interactions');
const COLS = 300, ROWS = 220;
const mk = () => attachTestHooks(createEngineWasmRaw({
  cols: COLS, rows: ROWS, worldSeed: 0xA670, sinksOn: false, infinite: false,
}));
const rect = (e, x0, y0, x1, y1, material = MAT.STONE, layer = 0) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++)
    e.paintDiscLayer(layer, x, y, 0, material, true);
  e.syncComponentsLayer(layer);
};
const turn = (e) => { e.stepActors(); e.stepWorld(); };
const creature = (e, id) => e.getCreatures().find((c) => c.id === id);
const overlaps = (e, actor, w = actor.w ?? 4, h = actor.h ?? 8) => {
  const grid = e.getGrid();
  for (let y = Math.floor(actor.y); y < Math.ceil(actor.y + h - 1e-5); y++)
    for (let x = Math.floor(actor.x); x < Math.ceil(actor.x + w - 1e-5); x++)
      if (x >= 0 && x < COLS && y >= 0 && y < ROWS
          && [MAT.STONE, MAT.RIGID].includes(grid[y * COLS + x])) return true;
  return false;
};

const cutSlab = (mode, paired = false) => {
  const e = mk();
  if (paired) e.setBgEnabled(true);
  for (let layer = 0; layer <= Number(paired); layer++) {
    rect(e, 0, 208, COLS, ROWS, MAT.STONE, layer);
    rect(e, 148, 80, 152, 208, MAT.STONE, layer);
    rect(e, 70, 60, 230, 80, MAT.STONE, layer);
  }
  e.stepWorld();
  check(`${mode}: slab begins supported`, e._bodyCount() === 0);
  const wasp = mode.includes('wasp') ? e.spawnCreature(CREATURE.CLUSTER_WASP, 130, 88) : null;
  const villager = mode.includes('rider') ? e.spawnCreature(CREATURE.VILLAGER, 175, 52) : null;
  check(`${mode}: requested actors spawn`, (wasp === null || wasp > 0)
    && (villager === null || villager > 0));
  e.setCreatureRuntime(true, false);
  for (let layer = 0; layer <= Number(paired); layer++)
    rect(e, 148, 80, 152, 208, MAT.EMPTY, layer);
  let maxAngle = 0, maxDrift = 0, maxOverlap = 0, at40, waspDrop = 0, jointLocked = true;
  const trace = [];
  for (let t = 0; t < 140; t++) {
    turn(e);
    const b = e._bodyState(0);
    if (t === 40) at40 = b;
    if (b && t < 60) {
      maxAngle = Math.max(maxAngle, Math.abs(b.angle));
      maxDrift = Math.max(maxDrift, Math.abs(b.px - 150));
    }
    if (wasp !== null && t === 40) waspDrop = creature(e, wasp).y - 88;
    if (villager !== null) maxOverlap += Number(overlaps(e, creature(e, villager)));
    if (paired && b) {
      const bg = e._bodyStateLayer(1, 0);
      jointLocked &&= !!bg && Math.abs(bg.px - b.px) < 1e-9
        && Math.abs(bg.py - b.py) < 1e-9 && Math.abs(bg.angle - b.angle) < 1e-9;
    }
    if (t % 20 === 0) trace.push([b && [b.px, b.py, b.vx, b.vy, b.angle],
      e.getCreatures().map((c) => [c.x, c.y, c.vx, c.vy, c.health])]);
  }
  const settled = !e._bodyState(0) || !e._bodyAwake(0);
  const result = { maxAngle, maxDrift, maxOverlap, at40, waspDrop, settled, jointLocked, trace };
  e.destroy();
  return result;
};
const control = cutSlab('empty');
const jointControl = cutSlab('empty joint', true);
for (const [mode, paired] of [['wasp', false], ['rider', false], ['wasp+rider', false], ['wasp+rider joint', true]]) {
  const result = cutSlab(mode, paired);
  check(`${mode}: actors cannot steer a 3,200-cell landmass `
    + `(drift ${result.maxDrift.toFixed(3)}, angle ${result.maxAngle.toFixed(3)})`,
  result.maxDrift < 1 && result.maxAngle < 0.03);
  check(`${mode}: terrain keeps falling (${result.at40?.py.toFixed(2)})`,
    result.at40 && Math.abs(result.at40.py - (paired ? jointControl : control).at40.py) < 2);
  check(`${mode}: land settles`, result.settled);
  if (mode.includes('wasp')) check(`${mode}: slab pushes flyer downward`, result.waspDrop > 30);
  if (mode.includes('rider')) check(`${mode}: rider stays outside terrain (${result.maxOverlap})`, result.maxOverlap === 0);
  if (paired) check('actor contacts preserve the shared foreground/background pose', result.jointLocked);
}

// Equal approach speeds produce mass-dependent exchanges of momentum.
const impact = (halfW, halfH, species = null) => {
  const e = mk();
  const id = species === null ? e.spawnPlayer(100, 80) : e.spawnCreature(species, 100, 80);
  e.setCreatureRuntime(true, false);
  e.spawnBox(96 - halfW, 84, halfW, halfH, MAT.RIGID);
  e._setBodyMotion(0, 3, 0, 0);
  let maxVx = 0;
  for (let t = 0; t < 8; t++) {
    turn(e);
    maxVx = Math.max(maxVx, species === null ? e.getPlayer(id).vx : creature(e, id).vx);
  }
  const actor = species === null ? e.getPlayer(id) : creature(e, id);
  const body = e._bodyState(0);
  const result = { actor, body, maxVx, overlap: overlaps(e, actor, species === null ? 4 : 7, species === null ? 8 : 5) };
  e.destroy();
  return result;
};
const small = impact(2, 2), large = impact(18, 8), flyer = impact(18, 8, CREATURE.CLUSTER_WASP);
check(`rigid impulse moves the player (${large.actor.x.toFixed(2)}, peak vx ${large.maxVx.toFixed(2)})`,
  large.actor.x > 108 && large.maxVx > 1.5);
check('heavier bodies retain more of their incoming motion', large.body.vx > small.body.vx + 0.3);
check('rigid impulse moves flyers', flyer.actor.x > 108 && flyer.maxVx > 1.5);
check('swept impacts do not pass through actors', !large.overlap && !flyer.overlap);

// A moving/rotating surface transports its rider at the contact point.
for (const rotating of [false, true]) {
  const e = mk();
  e.spawnBox(120, 90, 30, 4, MAT.RIGID);
  const id = e.spawnPlayer(rotating ? 138 : 110, 78);
  e._setBodyMotion(0, rotating ? 0 : 1, 0, rotating ? 0.03 : 0);
  let blocked = false, maxGap = 0;
  for (let t = 0; t < 25; t++) {
    turn(e);
    const p = e.getPlayer(id), b = e._bodyState(0);
    blocked ||= overlaps(e, p);
    const dx = p.x + 2 - b.px, dy = p.y + 8 - b.py;
    const localY = -dx * Math.sin(b.angle) + dy * Math.cos(b.angle);
    maxGap = Math.max(maxGap, Math.abs(localY + 4));
  }
  const p = e.getPlayer(id), b = e._bodyState(0);
  check(`${rotating ? 'rotating' : 'translating'} platform carries rider (gap ${maxGap.toFixed(2)})`,
    maxGap < 2 && !blocked && (rotating ? b.angle > 0.2 : p.x > 130));
  e.destroy();
}

// A rotating tip must hit an actor even with no centre translation.
{
  const e = mk();
  const id = e.spawnCreature(CREATURE.CLUSTER_WASP, 143, 94);
  e.spawnBox(120, 90, 30, 2, MAT.RIGID);
  e._setBodyMotion(0, 0, 0, 0.04);
  for (let t = 0; t < 8; t++) e.stepWorld();
  const target = creature(e, id);
  check(`rotating edge pushes flyer (${target.y.toFixed(2)}, vy ${target.vy.toFixed(2)})`,
    target.y > 96 && target.vy > 0.2);
  e.destroy();
}

// Trapping against terrain damages and displaces actors without making them
// immovable anchors. Protected crew retain their existing protection policy.
for (const species of [null, CREATURE.MINIGUNNER, CREATURE.IRIS_COMMANDER]) {
  const e = mk();
  rect(e, 0, 105, COLS, ROWS);
  const id = species === null ? e.spawnPlayer(78, 97) : e.spawnCreature(species, 78, species === CREATURE.MINIGUNNER ? 99 : 97);
  check(`crush target ${species} spawns`, id > 0);
  e.spawnBox(80, 78, 8, 3, MAT.RIGID);
  e._setBodyMotion(0, 0, 20, 0);
  for (let t = 0; t < 45; t++) turn(e);
  const actor = species === null ? e.getPlayer(id) : creature(e, id);
  const b = e._bodyState(0);
  check(`crush target ${species} yields to falling slab`, actor?.alive && !overlaps(e, actor, species === CREATURE.MINIGUNNER ? 9 : 4, species === CREATURE.MINIGUNNER ? 6 : 8) && b.py > 100);
  check(`crush target ${species} keeps bounded damage`, actor.health >= 1
    && (species === CREATURE.IRIS_COMMANDER ? actor.health === actor.maxHealth : actor.health < (actor.maxHealth ?? 100)));
  e.destroy();
}

{
  const e = mk();
  const id = e.spawnPlayer(100, 80);
  e.setPlayerState(id, { x: 100, y: 80, vx: 2.5, vy: 0 });
  e.stepActors();
  check('player control does not instantly erase collision momentum', e.getPlayer(id).vx > 2);
  e.destroy();
}

// The actor phase remains the only source of unforced actor motion, and a
// background-only body cannot collide with foreground actors.
{
  const e = mk();
  e.setBgEnabled(true);
  const id = e.spawnPlayer(100, 80);
  e.setPlayerState(id, { x: 100, y: 80, vx: 1, vy: 0 });
  e._spawnBoxLayer(1, 102, 75, 8, 6, MAT.RIGID);
  e.spawnBox(220, 50, 4, 4, MAT.RIGID);
  for (let t = 0; t < 10; t++) e.stepWorld();
  const p = e.getPlayer(id);
  check('no duplicate actor integration or background collision', p.x === 100 && p.y === 80 && p.vx === 1);
  e.destroy();
}

// A joint body's background-only extension is invisible to actor collision,
// while its smaller foreground footprint still pushes actors.
{
  const e = mk();
  e.setBgEnabled(true);
  for (let layer = 0; layer < 2; layer++) {
    rect(e, layer ? 70 : 100, 60, layer ? 230 : 120, 80, MAT.STONE, layer);
    rect(e, 108, 80, 112, ROWS, MAT.STONE, layer);
  }
  e.stepWorld();
  const backgroundActor = e.spawnCreature(CREATURE.CLUSTER_WASP, 180, 88);
  const foregroundActor = e.spawnCreature(CREATURE.CLUSTER_WASP, 101, 88);
  check('joint foreground/background contact targets spawn', backgroundActor > 0 && foregroundActor > 0);
  for (let layer = 0; layer < 2; layer++)
    rect(e, 108, 80, 112, ROWS, MAT.EMPTY, layer);
  for (let t = 0; t < 40; t++) e.stepWorld();
  const background = creature(e, backgroundActor), foreground = creature(e, foregroundActor);
  check('background-only joint footprint cannot move actors',
    background.x === 180 && background.y === 88 && background.vx === 0 && background.vy === 0);
  check('foreground inside the joint outline still pushes actors', foreground.y > 89 && foreground.vy > 0.5);
  e.destroy();
}

const first = cutSlab('wasp+rider replay'), second = cutSlab('wasp+rider replay');
check('actor/body outcomes replay exactly', JSON.stringify(first.trace) === JSON.stringify(second.trace));
const failures = done();
if (failures) process.exitCode = 1;
