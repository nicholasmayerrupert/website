import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { CREATURE, ITEM_KIND } from '../src/sand/wasmBridge/abi.generated.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('survival crafting, combat, and death');
const COLS = 120, ROWS = 100, FLOOR = 92;

function world() {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 17, sinksOn: false, infinite: false });
  e.setSurvivalInventory(true);
  for (let x = 2; x < COLS - 2; x++) for (let y = FLOOR; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  return e;
}

// Recipes are engine-authored and crafting is atomic.
{
  const e = world(); const p = e.spawnPlayer(30, FLOOR - 8);
  const recipes = e.getCraftingRecipes();
  check('recipe catalog includes tools, bow, arrows, and building materials', recipes.length === 8);
  e.addToInventory(p, MAT.WOOD, 23);
  check('insufficient ingredients craft nothing', e.craft(p, 0) === 0);
  check('failed crafting consumes nothing', e.getInventory(p).slots.reduce((n, s) => n + (s.material === MAT.WOOD ? s.count : 0), 0) === 23);
  e.addToInventory(p, MAT.WOOD, 1);
  check('24 wood crafts the universal mining tool', e.craft(p, 0) === 1 && e.getInventory(p).slots.some((s) => s.itemKind === ITEM_KIND.MINING_TOOL));
  e.destroy();
}

// A fully charged bow consumes one arrow and damages a creature along a swept path.
{
  const e = world(); const p = e.spawnPlayer(30, FLOOR - 8);
  const creature = e.spawnCreature(CREATURE.FOX, 65, FLOOR - 4);
  e.addToInventory(p, MAT.WOOD, 30);
  e.addToInventory(p, MAT.PLANT, 12);
  e.addToInventory(p, MAT.STONE, 4);
  check('bow and eight arrows craft from wood, fiber, and stone', e.craft(p, 4) === 1 && e.craft(p, 5) === 1);
  const bowSlot = e.getInventory(p).slots.findIndex((s) => s.itemKind === ITEM_KIND.BOW);
  const arrowCount = () => e.getInventory(p).slots.filter((s) => s.itemKind === ITEM_KIND.ARROW).reduce((n, s) => n + s.count, 0);
  e.setSelectedSlot(p, bowSlot);
  let seq = 0;
  for (let i = 0; i < 48; i++) {
    e.setPlayerInput(p, { bits: 16, aimX: 66, aimY: FLOOR - 4, seq: ++seq });
    e.stepActors();
  }
  check('held primary reaches full bow charge', e.getPlayer(p).bowCharge === 1);
  e.setPlayerInput(p, { bits: 0, aimX: 66, aimY: FLOOR - 4, seq: ++seq });
  e.stepActors();
  check('release spawns an arrow and spends one ammo', e.getProjectiles().length === 1 && arrowCount() === 7);
  const before = e.getCreatures().find((c) => c.id === creature)?.health;
  for (let i = 0; i < 20; i++) e.stepActors();
  const after = e.getCreatures().find((c) => c.id === creature)?.health;
  check(`charged arrow damages the creature (${before} -> ${after})`, after < before);
  e.destroy();
}

// Environmental damage leads to a corpse state, drops the full inventory, and
// requires the explicit three-second respawn gate.
{
  const e = world(); const p = e.spawnPlayer(40, FLOOR - 8);
  const firstSpawn = e.getPlayer(p);
  e.addToInventory(p, MAT.WOOD, 30);
  e.setPlayerState(p, { ...firstSpawn, x: 80, y: FLOOR - 8, vx: 0, vy: 0, grounded: true });
  // Poison the exact home tile after leaving it. Respawn must find nearby
  // supported ground instead of placing the player into the hazard.
  for (let x = 40; x < 44; x++) for (let y = FLOOR - 8; y < FLOOR; y++) e.paintDisc(x, y, 0, MAT.LAVA, false);
  for (let x = 80; x < 84; x++) for (let y = FLOOR - 8; y < FLOOR; y++) e.paintDisc(x, y, 0, MAT.LAVA, false);
  let ticks = 0;
  while (e.getPlayer(p)?.alive && ticks++ < 300) e.stepActors();
  const dead = e.getPlayer(p);
  const droppedItems = e.getItems().filter((item) => item.kind === 0);
  const droppedResources = droppedItems.filter((item) => item.itemKind === ITEM_KIND.MATERIAL).reduce((n, item) => n + item.count, 0);
  check('lava can kill the player', dead?.alive === false && dead.health === 0);
  check('death drops resources and the mining tool but keeps the bound starter gun out of the world',
    droppedResources === 30
    && droppedItems.some((item) => item.itemKind === ITEM_KIND.MINING_TOOL && item.isTool)
    && !droppedItems.some((item) => item.itemKind === ITEM_KIND.BLAST_GUN)
    && e.getInventory(p).slots.every((s) => s.count === 0));
  check('respawn is rejected before three seconds', e.respawnPlayer(p) === false);
  for (let i = 0; i < 180; i++) e.stepActors();
  check('respawn becomes ready after 180 actor ticks', e.getPlayer(p)?.respawnReady === true);
  const accepted = e.respawnPlayer(p);
  const respawned = e.getPlayer(p);
  check('manual respawn restores health, play, gun, and wood mining tool',
    accepted && respawned?.alive && respawned?.health === 100
      && e.getInventory(p).slots[0].itemKind === ITEM_KIND.BLAST_GUN
      && e.getInventory(p).slots[1].itemKind === ITEM_KIND.MINING_TOOL
      && e.getInventory(p).slots[1].isTool);
  check(`respawn returns to the safe first-spawn neighborhood (${respawned?.x.toFixed(1)},${respawned?.y.toFixed(1)})`,
    Math.hypot(respawned.x - firstSpawn.x, respawned.y - firstSpawn.y) <= 20
      && respawned.y + respawned.h >= FLOOR - 1 && respawned.y + respawned.h <= FLOOR + 1
      && respawned.jetpackFuel === 1);
  const grid = e.getGrid();
  let safeBody = true;
  for (let y = Math.floor(respawned.y); y < Math.ceil(respawned.y + respawned.h); y++)
    for (let x = Math.floor(respawned.x); x < Math.ceil(respawned.x + respawned.w); x++)
      safeBody &&= ![MAT.LAVA, MAT.ACID, MAT.FIRE].includes(grid[y * COLS + x]);
  const supportY = Math.floor(respawned.y + respawned.h);
  const supported = Array.from({ length: respawned.w }, (_, dx) =>
    grid[supportY * COLS + Math.floor(respawned.x) + dx] === MAT.STONE).filter(Boolean).length >= 2;
  check('respawn body is hazard-free and immediately supported', safeBody && supported);
  for (let i = 0; i < 60; i++) e.stepActors();
  check('the old starter gun cannot return and duplicate the replacement',
    e.getInventory(p).slots.filter((s) => s.itemKind === ITEM_KIND.BLAST_GUN && s.count > 0).length === 1);
  e.destroy();
}

// The home anchor is absolute-world state, not a buffer-local death column.
// A respawn request made after multiple streamed shifts stays pending until the
// original chunks are loaded, then revives at the same safe world location.
{
  const e = createEngineWasm({ cols: 256, rows: 192, worldSeed: 0x51A7, sinksOn: false, infinite: true });
  e.setSurvivalInventory(true);
  const p = e.spawnPlayerAtSurface(128);
  const born = e.getPlayer(p);
  const home = { x: e.getWorldOffsetX() + born.x, y: e.getWorldOffsetY() + born.y };
  for (let leg = 0; leg < 2; leg++) {
    const pose = e.getPlayer(p);
    e.setPlayerState(p, { ...pose, x: 192, vx: 0, vy: 0 });
    e.shiftWorldXY(64, 0);
  }
  const far = e.getPlayer(p);
  for (let tick = 0; tick < 360 && e.getPlayer(p).alive; tick++) {
    const pose = e.getPlayer(p);
    // Keep the hazard attached to the moving fixture so procedural terrain
    // height cannot let a short loose-lava column fall away before it kills.
    for (let y = Math.floor(pose.y); y < Math.ceil(pose.y + pose.h); y++)
      for (let x = Math.floor(pose.x); x < Math.ceil(pose.x + pose.w); x++)
        e.paintDisc(x, y, 0, MAT.LAVA, false);
    e.stepActors();
  }
  check('streamed-away player can die far from home', e.getPlayer(p).alive === false);
  for (let tick = 0; tick < 180; tick++) e.stepActors();
  check('far respawn request is accepted without reviving out of bounds',
    e.respawnPlayer(p) && e.getPlayer(p).alive === false);
  const dxHome = Math.trunc(home.x - born.x - e.getWorldOffsetX());
  e.shiftWorldXY(dxHome, 0);
  e.stepActors();
  const returned = e.getPlayer(p);
  check(`pending respawn resolves at the original absolute spawn (${(e.getWorldOffsetX() + returned.x).toFixed(1)},${(e.getWorldOffsetY() + returned.y).toFixed(1)})`,
    returned.alive
      && Math.hypot(e.getWorldOffsetX() + returned.x - home.x, e.getWorldOffsetY() + returned.y - home.y) <= 8);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
