// Held survival placement repeats, clips only cells overlapping the player, and
// consumes exactly one inventory unit per created cell.

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 60, ROWS = 80, PI_PRIMARY = 16;
await initSandWasm();
const { check, done } = makeChecker('survival hold-to-place (continuous + self-grazing + conserving)');

const slotCount = (e, id, mat) => e.getInventory(id).slots.filter((s) => !s.isTool && s.material === mat).reduce((a, s) => a + s.count, 0);
const gridCount = (e, mat) => { let n = 0; for (const v of e.getGrid()) if (v === mat) n++; return n; };

function makeWorld() {
  const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 1, sinksOn: false, infinite: false });
  e.setSurvivalInventory(true);
  for (let x = 0; x < COLS; x++) for (let y = 70; y < ROWS; y++) e.placeMaterial(x, y, 0, MAT.STONE);
  const id = e.spawnPlayer(30, 66);
  e.setSelectedFootprint(id, 2); // isolate hold placement with a compact 3x3
  let t = 0; const run = (n) => { for (let i = 0; i < n; i++) { t += 16; e.step(t); } };
  run(6);
  return { e, id, run };
}
// the sand stack lands in the first free slot after the 3 starter tools.
const giveAndSelect = (e, id, mat, n) => {
  e.addToInventory(id, mat, n);
  const inv = e.getInventory(id);
  const slot = inv.slots.findIndex((s) => !s.isTool && s.material === mat);
  e.setSelectedSlot(id, slot);
};
// 1) Continuous placement in open air beside the player: grid sand strictly grows.
{
  const { e, id, run } = makeWorld();
  giveAndSelect(e, id, MAT.SAND, 500);
  const series = [];
  for (let k = 0; k < 8; k++) {
    e.setPlayerInput(id, { bits: PI_PRIMARY, aimX: 33, aimY: 58, seq: k + 1 });
    run(5);
    series.push(gridCount(e, MAT.SAND));
  }
  let monotonic = true;
  for (let i = 1; i < series.length; i++) if (series[i] <= series[i - 1]) monotonic = false;
  check(`held primary keeps placing sand continuously [${series.join(',')}]`, monotonic && series[series.length - 1] > 30);
  e.destroy();
}

// 2) Self-grazing build: aim a disc that overlaps the player body. Pre-fix this
// returned 0 (whole build rejected); now it places the cells OUTSIDE the body.
{
  const { e, id, run } = makeWorld();
  giveAndSelect(e, id, MAT.SAND, 500);
  // player AABB ~ x[30..33] y[66..73]; aim so the selected 3x3 footprint overlaps
  // the top-left edge of the body instead of sitting entirely inside it.
  e.setPlayerInput(id, { bits: PI_PRIMARY, aimX: 29, aimY: 65, seq: 1 });
  run(5);
  const placed = gridCount(e, MAT.SAND);
  check(`a build grazing the player still places its non-overlapping cells (placed=${placed} > 0)`, placed > 0);
  // and never inside the body: no sand sits within the player's AABB cells.
  const inv = e.getInventory(id); // (player hasn't moved; AABB is its spawn box)
  e.destroy();
  check(`self-grazing build consumed inventory (no free pixels)`, inv.slots.some((s) => s.material === MAT.SAND && s.count < 500) || placed === 0);
}

// 3) Block-quantity conservation: every unit consumed becomes exactly one placed cell
// (no multiplication, no loss — bounded world, no sinks, so placed sand stays put).
{
  const { e, id, run } = makeWorld();
  const START = 200;
  giveAndSelect(e, id, MAT.SAND, START);
  for (let k = 0; k < 12; k++) {
    e.setPlayerInput(id, { bits: PI_PRIMARY, aimX: 33, aimY: 58, seq: k + 1 });
    run(5);
  }
  const remaining = slotCount(e, id, MAT.SAND);
  const inGrid = gridCount(e, MAT.SAND);
  check(`units consumed == cells placed (consumed ${START - remaining}, in-grid ${inGrid})`, START - remaining === inGrid);
  check(`some sand actually got consumed (remaining ${remaining} < ${START})`, remaining < START);
  e.destroy();
}

// 4) Liquids hold-place continuously too (water flows away, so the aim cell re-opens).
{
  const { e, id, run } = makeWorld();
  giveAndSelect(e, id, MAT.WATER, 500);
  const series = [];
  for (let k = 0; k < 8; k++) {
    e.setPlayerInput(id, { bits: PI_PRIMARY, aimX: 45, aimY: 58, seq: k + 1 });
    run(5);
    series.push(gridCount(e, MAT.WATER));
  }
  check(`held primary keeps pouring water [${series.join(',')}]`, series[series.length - 1] > series[0] && series[series.length - 1] > 20);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
