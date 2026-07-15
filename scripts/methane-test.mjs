// Methane: persistent cave gas, connected ignition, and bounded weak blasts.
// Run: node scripts/methane-test.mjs
import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('methane');
const count = (g, m) => { let n = 0; for (const v of g) if (v === m) n++; return n; };
const countRect = (g, cols, m, x0, y0, x1, y1) => {
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (g[y * cols + x] === m) n++;
  return n;
};
const mk = (cols = 160, rows = 120, infinite = false) =>
  attachTestHooks(createEngineWasmRaw({ cols, rows, worldSeed: 0xC0FFEE, sinksOn: false, infinite }));

// A sealed, grounded cave retains every methane cell indefinitely. Movement is
// allowed; disappearance is not.
{
  const e = mk();
  for (let x = 20; x <= 140; x++) { e.placeMaterial(x, 20, 0, MAT.STONE); e.placeMaterial(x, 100, 0, MAT.STONE); }
  for (let y = 20; y < 120; y++) e.placeMaterial(20, y, 0, MAT.STONE);
  for (let y = 20; y <= 100; y++) e.placeMaterial(140, y, 0, MAT.STONE);
  for (let y = 55; y <= 72; y++) for (let x = 55; x <= 104; x++) e.placeMaterial(x, y, 0, MAT.METHANE);
  e.syncComponents();
  const before = count(e.getGrid(), MAT.METHANE);
  let settledAt = -1;
  for (let i = 0; i < 360; i++) if (!e.stepWorld() && settledAt < 0) settledAt = i;
  const after = count(e.getGrid(), MAT.METHANE);
  check(`sealed methane does not decay (${before} -> ${after})`, before > 500 && after === before);
  check(`sealed methane settles and lets the layer sleep (tick ${settledAt})`, settledAt > 0 && settledAt < 360);
  e.destroy();
}

// Steam and smoke are lighter than methane, so they exchange upward through a
// packed methane layer instead of treating it as a solid ceiling.
for (const [name, gas] of [['steam', MAT.STEAM], ['acrid smoke', MAT.ACRID_SMOKE]]) {
  const e = mk();
  const x0 = 51, x1 = 78, ceiling = 30, split = 45, floor = 61;
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    e.placeMaterial(x, ceiling, 0, MAT.STONE);
    e.placeMaterial(x, floor, 0, MAT.STONE);
  }
  for (let y = ceiling; y <= floor; y++) {
    e.placeMaterial(x0 - 1, y, 0, MAT.STONE);
    e.placeMaterial(x1 + 1, y, 0, MAT.STONE);
  }
  for (let y = ceiling + 1; y <= split; y++) for (let x = x0; x <= x1; x++) e.placeMaterial(x, y, 0, MAT.METHANE);
  for (let y = split + 1; y < floor; y++) for (let x = x0; x <= x1; x++) e.placeMaterial(x, y, 0, gas);
  e.syncComponents();
  for (let i = 0; i < 6; i++) e.stepWorld();
  const grid = e.getGrid();
  const lighterAbove = countRect(grid, 160, gas, x0, ceiling + 1, x1, split);
  const methaneBelow = countRect(grid, 160, MAT.METHANE, x0, split + 1, x1, floor - 1);
  check(`${name} rises through heavier methane (${lighterAbove} above, ${methaneBelow} methane below)`, lighterAbove > 0 && methaneBelow > 0);
  e.destroy();
}

// A wisp flashes into fire but is too small to produce a pressure blast.
{
  const e = mk();
  for (let x = 70; x < 75; x++) e.placeMaterial(x, 55, 0, MAT.METHANE);
  e.placeMaterial(69, 55, 0, MAT.FIRE);
  e.step(0);
  check(`small methane wisp ignites as one connected volume`, count(e.getGrid(), MAT.METHANE) === 0);
  check(`small methane wisp leaves flame`, count(e.getGrid(), MAT.FIRE) > 0);
  e.destroy();
}

// A large pocket flashes all at once and its capped pressure fronts tear a soft
// wood wall. The gas itself contributes no generic rubble body.
{
  const e = mk();
  for (let x = 20; x <= 140; x++) e.placeMaterial(x, 100, 0, MAT.STONE);
  for (let y = 45; y < 120; y++) e.placeMaterial(106, y, 0, MAT.WOOD);
  for (let y = 45; y <= 68; y++) for (let x = 55; x <= 104; x++) e.placeMaterial(x, y, 0, MAT.METHANE);
  e.placeMaterial(105, 56, 0, MAT.FIRE);
  e.syncComponents();
  const wood0 = count(e.getGrid(), MAT.WOOD);
  e.step(0);
  const wood1 = count(e.getGrid(), MAT.WOOD);
  const acrid = count(e.getGrid(), MAT.ACRID_SMOKE);
  const steam = count(e.getGrid(), MAT.STEAM);
  let genericDebris = false;
  for (let i = 0; i < e._bodyCount(); i++) if (e._bodyMaterial(i) === MAT.DEBRIS) genericDebris = true;
  check(`large methane pocket is consumed in one tick`, count(e.getGrid(), MAT.METHANE) === 0);
  check(`methane pressure damages wood (${wood0} -> ${wood1})`, wood1 < wood0);
  check(`methane creates no generic debris bodies`, !genericDebris);
  check(`large methane pocket leaves a fiery visible front`, count(e.getGrid(), MAT.FIRE) + count(e.getGrid(), MAT.ACRID_SMOKE) > 20);
  check(`methane blast emits acrid smoke (${acrid})`, acrid > 0);
  check(`methane blast emits steam (${steam})`, steam > 0);
  e.destroy();
}

// In a stone-lined chamber, methane fractures the wall and throws STONE itself.
// This is materially sourced rubble, never the generic DEBRIS material.
{
  const e = mk();
  for (let y = 45; y <= 78; y++) for (let x = 58; x <= 102; x++) {
    if (x <= 63 || x >= 97 || y <= 50 || y >= 73) e.placeMaterial(x, y, 0, MAT.STONE);
  }
  for (let y = 78; y < 120; y++) e.placeMaterial(58, y, 0, MAT.STONE);
  for (let y = 51; y < 73; y++) for (let x = 65; x < 97; x++) e.placeMaterial(x, y, 0, MAT.METHANE);
  e.placeMaterial(64, 60, 0, MAT.FIRE);
  e.syncComponents();
  const stone0 = count(e.getGrid(), MAT.STONE);
  e.step(0);
  const stone1 = count(e.getGrid(), MAT.STONE);
  let stoneBodies = 0, genericBodies = 0;
  for (let i = 0; i < e._bodyCount(); i++) {
    if (e._bodyMaterial(i) === MAT.STONE) stoneBodies++;
    if (e._bodyMaterial(i) === MAT.DEBRIS) genericBodies++;
  }
  check(`enclosed methane fractures stone (${stone0} -> ${stone1})`, stone1 < stone0);
  check(`enclosed methane fills most of its real-stone debris budget (${stoneBodies})`, stoneBodies >= 8);
  check(`enclosed methane still throws no generic debris (${genericBodies})`, genericBodies === 0);
  e.destroy();
}

// The material is part of world generation rather than creative-only.
{
  const e = mk(768, 320, true);
  const natural = count(e.getGrid(), MAT.METHANE);
  check(`procedural caves contain natural methane (${natural} cells)`, natural > 0);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
