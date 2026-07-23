// Data-driven mining speed: material durability is base hardness, while the
// held tool class/tier scales progress per hit. Drop gating is tested separately.

import { initSandWasm, createEngineWasm, INPUT } from '../src/sand/wasmBridge/engineFactory.js';
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

// Dig tool: flat class speed — stone/sand/wood take hits proportional to durability only.
const digStone = hitsToBreak(MAT.STONE, TC.dig, TT.wood);
const digSand = hitsToBreak(MAT.SAND, TC.dig, TT.wood);
const digWood = hitsToBreak(MAT.WOOD, TC.dig, TT.wood);
check(`dig tool: stone harder than sand (${digStone} > ${digSand})`, digStone > digSand);
check(`dig tool: wood between sand and stone (${digSand} < ${digWood} && ${digWood} < ${digStone})`, digSand < digWood && digWood < digStone);
// Same hardness materials dig at the same rate regardless of preferred tool class.
const digDirt = hitsToBreak(MAT.DIRT, TC.dig, TT.wood); // durability 2, shovel-class
check(`dig tool ignores material type at equal hardness (sand=${digSand}, dirt=${digDirt})`, digSand === digDirt);

// Exercise the real survival path: selected Mining Tool + held input + engine
// steps. The universal tool receives its survival-only 13x boost; bare hand and
// the classed speed table retain their exact previous timings.
function survivalStepsToBreakStone(toolClass, toolTier) {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 7, sinksOn: false, infinite: false });
  for (let x = 30; x < 90; x++) for (let y = 70; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  e.setSurvivalInventory(true);
  const id = e.spawnPlayer(55, 62);
  // This suite isolates mining speed from the player-facing default footprint.
  e.setSelectedFootprint(id, 2);
  const slot = toolClass === TC.dig
    ? e.getInventory(id).slots.findIndex((candidate) => candidate.isTool)
    : 3;
  e.setSelectedSlot(id, slot);
  if (toolClass !== TC.dig) e.setPlayerTool(id, toolClass, toolTier);
  // Keep a 3x3 footprint: its nine-cell work scaling makes the iron starter
  // tool's stone timing easy to distinguish from hands and classed picks.
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

const survivalDig = survivalStepsToBreakStone(TC.dig, TT.iron);
const survivalHand = survivalStepsToBreakStone(TC.hand, TT.hand);
const survivalWoodPick = survivalStepsToBreakStone(TC.pickaxe, TT.wood);
check(`iron inventory dig tool combines its tier with the universal boost (48 -> ${survivalDig.steps})`,
  survivalDig.broke && survivalDig.steps === 3);
check(`bare-hand stone timing is unchanged (${survivalHand.steps})`,
  survivalHand.broke && survivalHand.steps === 144);
check(`classed wood-pickaxe stone timing is unchanged (${survivalWoodPick.steps})`,
  survivalWoodPick.broke && survivalWoodPick.steps === 18);

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
