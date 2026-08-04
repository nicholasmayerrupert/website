// Dropped-item and particle entity physics. Nearby compatible materials
// coagulate; remaining actors overlap, move more slowly in liquid, and rest
// capped, remap on world shift, and never perturb the sim RNG (determinism).
// Run: node scripts/item-test.mjs

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));
import { MAT } from '../src/sand/materials.js';
import { OFF, PROJECTILE_KIND, STRIDES } from '../src/sand/wasmBridge/abi.generated.js';
import { makeChecker, gridHash } from './sand-test-util.mjs';

const COLS = 160, ROWS = 120, FLOOR = 90;
await initSandWasm();
const { check, done } = makeChecker('dropped items + particles');

// A solid stone floor from row FLOOR down, so items have something to rest on.
function withFloor(opts = {}) {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 5, sinksOn: false, infinite: false, ...opts });
  for (let x = 5; x < COLS - 5; x++) for (let y = FLOOR; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  return e;
}
const run = (e, n) => { let t = 0; for (let i = 0; i < n; i++) { t += 16; e.step(t); } };

// 1) Falls and rests ON TOP of the floor — never clips through it.
{
  const e = withFloor();
  e.spawnItem(MAT.WOOD, 1, 70, 20, 0, 0);
  run(e, 200);
  const it = e.getItems();
  check(`one item survives the fall (count ${e.itemCount()})`, e.itemCount() === 1 && it.length === 1);
  check(`item rests above the floor, no clip (y ${it[0]?.y.toFixed(2)})`, it[0] && it[0].y > FLOOR - 4 && it[0].y < FLOOR);
  e.destroy();
}

// 2) Falls SLOWER in liquid than in air (same start height, few steps).
{
  const e = withFloor();
  for (let x = 60; x <= 82; x++) for (let y = 20; y <= 86; y++) e.paintDisc(x, y, 0, MAT.WATER, true);
  e.spawnItem(MAT.WOOD, 1, 71, 20, 0, 0);  // inside the water column
  e.spawnItem(MAT.WOOD, 1, 120, 20, 0, 0); // in open air
  run(e, 6);
  const items = e.getItems();
  const wet = items.find((i) => Math.round(i.x) === 71) || items[0];
  const dry = items.find((i) => Math.round(i.x) === 120) || items[1];
  check(`item in air falls farther than item in liquid (air y ${dry.y.toFixed(2)} > wet y ${wet.y.toFixed(2)})`, dry.y > wet.y + 1.0);
  e.destroy();
}

// 3) Compatible nearby materials coagulate into one conserved stack actor.
{
  const e = withFloor();
  for (let i = 0; i < 3; i++) e.spawnItem(MAT.STONE, 1, 40, 20, 0, 0);
  run(e, 220);
  const items = e.getItems();
  check(`three nearby stone drops coagulate (${items.length} actor)`, items.length === 1);
  check(`coagulation conserves the stack count (${items[0]?.count})`, items[0]?.count === 3);
  check('the coagulated stack rests above the floor', items[0]?.y < FLOOR && items[0]?.y > FLOOR - 3);
  e.spawnItem(MAT.WOOD, 1, 40, 20, 0, 0);
  e.spawnItem(MAT.STONE, 1, 55, 20, 0, 0);
  check('different materials and distant matches stay independent', e.itemCount() === 3);
  e.destroy();
}

// 3a) Coagulation respects the inventory stack cap without losing resources.
{
  const e = withFloor();
  for (let i = 0; i < 1000; i++) e.spawnItem(MAT.WOOD, 1, 40, 20, 0, 0);
  const stacks = e.getItems();
  check(`a 1000-item pile uses two capped actors (${stacks.length})`, stacks.length === 2);
  check('coagulation conserves all 1000 units',
    stacks.reduce((count, item) => count + item.count, 0) === 1000 &&
    stacks.every((item) => item.count <= 999));
  e.destroy();
}

// 3b) Magnet: an item within magnet range flies to the player and is collected.
{
  const e = withFloor();
  const id = e.spawnPlayer(40, FLOOR - 8);
  e.spawnItem(MAT.WOOD, 1, 48, FLOOR - 6, 0, 0); // ~8 cells away, inside the magnet radius
  run(e, 40);
  check(`item magnets to the player and is collected (count ${e.itemCount()})`, e.itemCount() === 0);
  const inv = e.getInventory(id);
  check('collected wood landed in inventory', inv.slots.some((s) => !s.isTool && s.material === MAT.WOOD && s.count >= 1));
  e.destroy();
}

// 3c) Never buried: an item covered by a freshly placed solid rises to the surface.
{
  const e = withFloor();
  e.spawnItem(MAT.STONE, 1, 70, FLOOR - 1, 0, 0);
  run(e, 5); // settle on the floor
  e.placeMaterial(70, FLOOR - 2, 2, MAT.STONE); // bury it under stone
  run(e, 40);
  const it = e.getItems()[0];
  check(`buried item rose back to the surface (y ${it?.y.toFixed(1)})`, it && it.y < FLOOR - 2);
  e.destroy();
}

// 4) Hard cap: particles do not coagulate, so spawning past IT_MAX_ITEMS still
//    evicts the oldest and never exceeds the cap.
{
  const e = withFloor();
  for (let i = 0; i < 1034; i++) e.spawnParticle(MAT.SAND, 20 + (i % 100), 10, 0, 0, 100);
  check(`item count capped at 1024 (got ${e.itemCount()})`, e.itemCount() === 1024);
  e.destroy();
}

// 5) Particles are cosmetic + expire: a particle with a short life is culled.
{
  const e = withFloor();
  e.spawnParticle(MAT.STONE, 50, 20, 0, -0.5, 8);
  check('particle present after spawn', e.itemCount() === 1);
  const packed = e.getItemSnapshotData();
  check('packed presentation snapshot includes the cosmetic particle',
    packed.length === STRIDES.itemSnapshot &&
    packed[OFF.itemSnapshot.kind] === 1 &&
    packed[OFF.itemSnapshot.material] === MAT.STONE);
  run(e, 12);
  check(`particle culled after its life expires (count ${e.itemCount()})`, e.itemCount() === 0);
  e.destroy();
}

// 6) World shift: items remap by the shift delta and persist off-buffer.
{
  const e = createEngineWasm({ cols: 220, rows: 160, worldSeed: 9, sinksOn: false, infinite: true });
  e.spawnItem(MAT.WOOD, 1, 150, 30, 0, 0);
  e.shiftWorldXY(40, 0); // 150 -> 110, stays in buffer
  let it = e.getItems();
  check(`item remaps with the world shift (x ${it[0]?.x.toFixed(1)})`, e.itemCount() === 1 && Math.abs(it[0].x - 110) < 1.5);
  e.shiftWorldXY(128, 0); // 110 -> -18, off buffer -> tile store
  check(`item leaves the live actor set off-buffer (count ${e.itemCount()})`, e.itemCount() === 0);
  e.shiftWorldXY(-128, 0);
  it = e.getItems();
  check(`stored item returns at its world position (x ${it[0]?.x.toFixed(1)})`,
    e.itemCount() === 1 && Math.abs(it[0].x - 110) < 1.5);
  e.destroy();
}

// 7) World shift: live projectiles retain their actor state while off-buffer.
{
  const e = createEngineWasm({ cols: 220, rows: 160, worldSeed: 9, sinksOn: false, infinite: true });
  e.setSurvivalInventory(true);
  const player = e.spawnPlayer(150, 30);
  e.setPlayerInput(player, { bits: 16, aimX: 210, aimY: 32, seq: 1 });
  e.stepActors();
  const before = e.getProjectiles().find((value) =>
    value.kind === PROJECTILE_KIND.BLAST_ROUND);
  e.shiftWorldXY(192, 0);
  check('projectile leaves the live actor set off-buffer',
    before && e.getProjectiles().length === 0);
  e.shiftWorldXY(-192, 0);
  const after = e.getProjectiles().find((value) => value.id === before?.id);
  check('stored projectile returns with its exact motion state', after
    && after.x === before.x && after.y === before.y
    && after.vx === before.vx && after.vy === before.vy
    && after.charge === before.charge && after.fuse === before.fuse
    && after.rotation === before.rotation);
  e.destroy();
}

// 8) Determinism: items must not perturb the sim RNG. Same seed + same sand, one
//    engine also spawns/updates items — the grids must hash identically.
{
  const mk = () => { const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 123, sinksOn: false, infinite: false }); e.paintDisc(80, 30, 6, MAT.SAND, false); return e; };
  const a = mk(), b = mk();
  for (let i = 0; i < 4; i++) a.spawnItem(MAT.WOOD, 1, 40 + i * 5, 10, 0.3 * (i - 2), 0);
  let t = 0;
  for (let i = 0; i < 150; i++) { t += 16; a.step(t); b.step(t); }
  check(`items do not perturb the simulation (hash ${gridHash(a.getGrid()) === gridHash(b.getGrid()) ? 'match' : 'DIFFER'})`, gridHash(a.getGrid()) === gridHash(b.getGrid()));
  a.destroy(); b.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
