// Data-driven mining speed: material durability is base hardness, while the
// held tool class/tier scales progress per hit. Drop gating is tested separately.

import { initSandWasm, createEngineWasm, INPUT } from '../src/sand/engineWasm.js';
import { MAT } from '../src/sand/materials.js';
import { TC, TT } from '../src/sand/materials.generated.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('mining speed');
const COLS = 120, ROWS = 100, X = 60, Y = 50;

function hitsToBreak(mat, toolClass, toolTier) {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 7, sinksOn: false, infinite: false });
  const id = e.spawnPlayer(40, 40);
  e.setPlayerTool(id, toolClass, toolTier);
  e.placeMaterial(X, Y, 0, mat);
  let hits = 0;
  while (e.getGrid()[Y * COLS + X] !== MAT.EMPTY && hits < 1000) {
    e.playerMine(id, X, Y);
    hits++;
  }
  e.destroy();
  return hits;
}

const handStone = hitsToBreak(MAT.STONE, TC.hand, TT.hand);
const woodPickStone = hitsToBreak(MAT.STONE, TC.pickaxe, TT.wood);
check(`wood pickaxe beats hand on stone (${woodPickStone} < ${handStone})`, woodPickStone < handStone);

const shovelSand = hitsToBreak(MAT.SAND, TC.shovel, TT.wood);
const pickSand = hitsToBreak(MAT.SAND, TC.pickaxe, TT.wood);
const handSand = hitsToBreak(MAT.SAND, TC.hand, TT.hand);
check(`shovel beats pickaxe on sand (${shovelSand} < ${pickSand})`, shovelSand < pickSand);
check(`shovel beats hand on sand (${shovelSand} < ${handSand})`, shovelSand < handSand);

const axeWood = hitsToBreak(MAT.WOOD, TC.axe, TT.wood);
const pickWood = hitsToBreak(MAT.WOOD, TC.pickaxe, TT.wood);
check(`axe beats pickaxe on wood (${axeWood} < ${pickWood})`, axeWood < pickWood);

const stonePickStone = hitsToBreak(MAT.STONE, TC.pickaxe, TT.stone);
const ironPickStone = hitsToBreak(MAT.STONE, TC.pickaxe, TT.iron);
check(`stone pickaxe beats wood tier (${stonePickStone} < ${woodPickStone})`, stonePickStone < woodPickStone);
check(`iron pickaxe beats stone tier (${ironPickStone} < ${stonePickStone})`, ironPickStone < stonePickStone);

// Exercise the real survival path: starter inventory selection + held input +
// engine steps. Wrong tools and hand must still break stone, just more slowly.
function survivalStepsToBreakStone(slot) {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 7, sinksOn: false, infinite: false });
  for (let x = 30; x < 90; x++) for (let y = 70; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  e.setSurvivalInventory(true);
  const id = e.spawnPlayer(55, 62);
  e.setSelectedSlot(id, slot);
  e.setSelectedFootprint(id, 0); // isolate tool-class speed from area scaling
  let steps = 0;
  while (e.getGrid()[70 * COLS + 60] !== MAT.EMPTY && steps < 500) {
    e.setPlayerInput(id, { bits: INPUT.PRIMARY, aimX: 60, aimY: 70, tool: 0, seq: steps });
    e.step(steps * 16);
    steps++;
  }
  const broke = e.getGrid()[70 * COLS + 60] === MAT.EMPTY;
  e.destroy();
  return { steps, broke };
}

const survivalPick = survivalStepsToBreakStone(0);
const survivalAxe = survivalStepsToBreakStone(1);
const survivalHand = survivalStepsToBreakStone(3);
check(`inventory pickaxe is faster on stone (${survivalPick.steps} < ${survivalAxe.steps})`, survivalPick.broke && survivalPick.steps < survivalAxe.steps);
check(`wrong inventory tool still breaks stone (${survivalAxe.steps} steps)`, survivalAxe.broke);
check(`bare hand still breaks stone (${survivalHand.steps} steps)`, survivalHand.broke);

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
