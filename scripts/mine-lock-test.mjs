// Hold-to-mine lock: while LMB/RMB is held the footprint origin stays fixed even
// if aim moves. The lock releases when the locked area is empty or the button
// is released. Run: node scripts/mine-lock-test.mjs

import { initSandWasm, createEngineWasm, INPUT } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('mine hold-lock');

const COLS = 120, ROWS = 100, FLOOR = 70;

function survival() {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 11, sinksOn: false, infinite: false });
  e.setSurvivalInventory(true);
  for (let x = 10; x < COLS - 10; x++) for (let y = FLOOR; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
  return e;
}

// 1) Holding primary while aim moves keeps mining the original cell.
{
  const e = survival();
  const id = e.spawnPlayer(50, FLOOR - 8);
  e.setSelectedSlot(id, 0); // dig tool
  e.setSelectedFootprint(id, 0); // 1x1
  const x0 = 55, y0 = FLOOR;
  // Neighbour cell that must stay untouched while aim wanders onto it.
  const x1 = 58, y1 = FLOOR;
  check('start cells are stone', e.getGrid()[y0 * COLS + x0] === MAT.STONE && e.getGrid()[y1 * COLS + x1] === MAT.STONE);

  let steps = 0;
  while (e.getGrid()[y0 * COLS + x0] === MAT.STONE && steps < 200) {
    // Aim jumps to the neighbour after the first hit — lock must ignore that.
    const aimX = steps === 0 ? x0 : x1;
    const aimY = steps === 0 ? y0 : y1;
    e.setPlayerInput(id, { bits: INPUT.PRIMARY, aimX, aimY, tool: 0, seq: steps });
    e.step(steps * 16);
    steps++;
  }
  check(`locked origin eventually mined (${steps} steps)`, e.getGrid()[y0 * COLS + x0] === MAT.EMPTY);
  check('neighbour untouched while aim wandered onto it', e.getGrid()[y1 * COLS + x1] === MAT.STONE);
  e.destroy();
}

// 2) After the locked area is cleared, a new hold can lock the neighbour.
{
  const e = survival();
  const id = e.spawnPlayer(50, FLOOR - 8);
  e.setSelectedSlot(id, 0);
  e.setSelectedFootprint(id, 0);
  const x0 = 55, y0 = FLOOR;
  const x1 = 58, y1 = FLOOR;

  // Clear the first cell while aiming at the second (lock stays on first).
  let steps = 0;
  while (e.getGrid()[y0 * COLS + x0] === MAT.STONE && steps < 200) {
    e.setPlayerInput(id, { bits: INPUT.PRIMARY, aimX: steps === 0 ? x0 : x1, aimY: y0, tool: 0, seq: steps });
    e.step(steps * 16);
    steps++;
  }
  check('first cell cleared', e.getGrid()[y0 * COLS + x0] === MAT.EMPTY);

  // Still held with aim on neighbour — should re-lock and mine it.
  let steps2 = 0;
  while (e.getGrid()[y1 * COLS + x1] === MAT.STONE && steps2 < 200) {
    e.setPlayerInput(id, { bits: INPUT.PRIMARY, aimX: x1, aimY: y1, tool: 0, seq: steps + steps2 });
    e.step((steps + steps2) * 16);
    steps2++;
  }
  check(`neighbour mined after re-lock (${steps2} steps)`, e.getGrid()[y1 * COLS + x1] === MAT.EMPTY);
  e.destroy();
}

// 3) Releasing primary clears the lock so a later press mines at the new aim.
{
  const e = survival();
  const id = e.spawnPlayer(50, FLOOR - 8);
  e.setSelectedSlot(id, 0);
  e.setSelectedFootprint(id, 0);
  const x0 = 55, y0 = FLOOR;
  const x1 = 58, y1 = FLOOR;

  // Start mining x0 for a few ticks (not enough to finish).
  for (let i = 0; i < 3; i++) {
    e.setPlayerInput(id, { bits: INPUT.PRIMARY, aimX: x0, aimY: y0, tool: 0, seq: i });
    e.step(i * 16);
  }
  check('partial mine left origin stone', e.getGrid()[y0 * COLS + x0] === MAT.STONE);

  // Release.
  e.setPlayerInput(id, { bits: 0, aimX: x1, aimY: y1, tool: 0, seq: 10 });
  e.step(200);

  // Press again on neighbour — must dig neighbour, not resume a lock on x0.
  let steps = 0;
  while (e.getGrid()[y1 * COLS + x1] === MAT.STONE && steps < 200) {
    e.setPlayerInput(id, { bits: INPUT.PRIMARY, aimX: x1, aimY: y1, tool: 0, seq: 20 + steps });
    e.step((20 + steps) * 16);
    steps++;
  }
  check(`post-release mines new aim (${steps} steps)`, e.getGrid()[y1 * COLS + x1] === MAT.EMPTY);
  check('old origin still stone (not auto-finished)', e.getGrid()[y0 * COLS + x0] === MAT.STONE);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
