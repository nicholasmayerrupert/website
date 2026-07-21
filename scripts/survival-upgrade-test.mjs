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
  e.addToInventory(p, MAT.WOOD, 30);
  for (let x = 40; x < 44; x++) for (let y = FLOOR - 8; y < FLOOR; y++) e.paintDisc(x, y, 0, MAT.LAVA, false);
  let ticks = 0;
  while (e.getPlayer(p)?.alive && ticks++ < 300) e.stepActors();
  const dead = e.getPlayer(p);
  const dropped = e.getItems().filter((item) => item.kind === 0).reduce((n, item) => n + item.count, 0);
  check('lava can kill the player', dead?.alive === false && dead.health === 0);
  check('death drops the complete inventory', dropped === 30 && e.getInventory(p).slots.every((s) => s.count === 0));
  check('respawn is rejected before three seconds', e.respawnPlayer(p) === false);
  for (let i = 0; i < 180; i++) e.stepActors();
  check('respawn becomes ready after 180 actor ticks', e.getPlayer(p)?.respawnReady === true);
  check('manual respawn restores health and play', e.respawnPlayer(p) && e.getPlayer(p)?.alive && e.getPlayer(p)?.health === 100);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
