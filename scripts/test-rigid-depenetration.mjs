// Deterministic scenarios for the post-solve raster overlap validator
// (depenetrateBodyRaster in src/sand/engine.js). A rigid body must never come
// to rest with its rasterized footprint overlapping terrain, and must not hover
// visibly above the ground.
//
// Usage: node scripts/test-rigid-depenetration.mjs
//
// Exits non-zero if any scenario fails.

import { createEngine, MAT } from '../src/sand/engine.js';
import { mulberry32 } from '../src/sand/rng.js';

const COLS = 64;
const ROWS = 80;

// Build an engine with no emitters and a deterministic RNG.
function makeEngine() {
  return createEngine({
    cols: COLS,
    rows: ROWS,
    rng: mulberry32(0xC0FFEE),
    emittersOn: false,
    sinksOn: false,
  });
}

// Paint a column of STONE [x, yTop..bottom) and keep it alive as a component.
function fillStone(eng, cells) {
  const grid = eng.getGrid();
  for (const [x, y] of cells) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) continue;
    grid[y * COLS + x] = MAT.STONE;
  }
  eng.syncComponents();
}

// A solid stone floor spanning the full width at rows [yTop, ROWS).
function flatFloor(eng, yTop) {
  const cells = [];
  for (let y = yTop; y < ROWS; y++) for (let x = 0; x < COLS; x++) cells.push([x, y]);
  fillStone(eng, cells);
  return cells;
}

// A rectangular body of integer cells at the given top-left, w x h.
function rectCells(x0, y0, w, h) {
  const cells = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) cells.push([x, y]);
  return cells;
}

// True if dropping the body by `dy` would push its footprint into terrain —
// i.e. the body is genuinely resting on the ground, not hovering above it.
function restingOnTerrain(eng, b, dy = 1.0) {
  const py = b.py;
  b.py = py + dy;
  const blocked = eng.bodyFootprintBlocked(b);
  b.py = py;
  return blocked > 0;
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  const tag = cond ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function runScenario(name, { buildTerrain, bodyCells, opts = {}, postSpawn, steps = 500 }) {
  console.log(`\n# ${name}`);
  const eng = makeEngine();
  buildTerrain(eng);
  const b = eng.spawnBody(bodyCells, opts);
  if (postSpawn) postSpawn(b);
  for (let i = 0; i < steps; i++) eng.step(16);

  const blocked = eng.bodyFootprintBlocked(b);
  const dbg = eng.getRigidDebug();
  check(`${name}: footprint not overlapping terrain`, blocked === 0, `blocked=${blocked}`);
  check(`${name}: not hovering (rests on terrain)`, restingOnTerrain(eng, b), `py=${b.py.toFixed(2)}`);
  check(`${name}: body settled (asleep)`, b.awake === false, `awake=${b.awake}, stillTicks=${b.stillTicks}`);
  check(`${name}: final raster rejected ~0 cells`, dbg.rejectedCells === 0, `rejectedCells=${dbg.rejectedCells}`);
}

// 1) Flat floor.
runScenario('flat-floor', {
  buildTerrain: (eng) => flatFloor(eng, 60),
  bodyCells: rectCells(28, 18, 5, 5),
});

// 2) One-cell ledge: floor with a single raised step under the body.
runScenario('one-cell-ledge', {
  buildTerrain: (eng) => {
    flatFloor(eng, 60);
    // a one-cell-high ledge across the left portion
    const cells = [];
    for (let x = 0; x < 34; x++) cells.push([x, 59]);
    fillStone(eng, cells);
  },
  bodyCells: rectCells(28, 18, 6, 4),
});

// 3) Sloped / jagged staircase pile.
runScenario('jagged-pile', {
  buildTerrain: (eng) => {
    // Jagged but level-on-average surface (fixed bump pattern) so a resting
    // body settles into it rather than sliding down a continuous slope.
    const bumps = [0, 1, 0, 2, 1, 0, 2, 1, 0, 1];
    const cells = [];
    for (let x = 0; x < COLS; x++) {
      const top = 60 - bumps[x % bumps.length];
      for (let y = top; y < ROWS; y++) cells.push([x, y]);
    }
    fillStone(eng, cells);
  },
  bodyCells: rectCells(28, 14, 5, 5),
});

// 4) Rotated rectangle dropped onto a flat floor.
runScenario('rotated-rect', {
  buildTerrain: (eng) => flatFloor(eng, 60),
  bodyCells: rectCells(28, 16, 8, 3),
  postSpawn: (b) => { b.angle = Math.PI / 5; },
});

// 5) Body dropped with a large downward velocity (forces deep one-step
//    penetration so the binary-search path of the validator is exercised).
runScenario('downward-velocity', {
  buildTerrain: (eng) => flatFloor(eng, 60),
  bodyCells: rectCells(28, 14, 5, 5),
  opts: { vy: 40 },
});

// 6) Tip / roll off a ledge. A cube spawned overhanging a platform edge must
//    rotate and topple off (the validator must NOT freeze the rotation), then
//    land without deep clipping. Regression guard for over-strict validation.
(() => {
  const name = 'ledge-tip';
  console.log(`\n# ${name}`);
  const eng = makeEngine();
  // Platform: solid stone, left portion, top at y=50. Floor below at y=72.
  const cells = [];
  for (let x = 0; x <= 30; x++) for (let y = 50; y < ROWS; y++) cells.push([x, y]);
  for (let x = 0; x < COLS; x++) for (let y = 72; y < ROWS; y++) cells.push([x, y]);
  fillStone(eng, cells);
  // 6x6 cube overhanging the right edge (cols 28..33; edge at col 30 -> COM
  // beyond the support, so it must tip clockwise).
  const b = eng.spawnBody(rectCells(28, 43, 6, 6));
  let maxAbsAngle = 0;
  let everBlockedDeep = 0;
  for (let i = 0; i < 700; i++) {
    eng.step(16);
    if (Math.abs(b.angle) > maxAbsAngle) maxAbsAngle = Math.abs(b.angle);
    const blk = eng.bodyFootprintBlocked(b);
    if (blk > everBlockedDeep) everBlockedDeep = blk;
  }
  const tol = Math.max(1, Math.floor(Math.min(b.w, b.h) * 0.34));
  check(`${name}: cube tipped (rotation not frozen)`, maxAbsAngle > 0.5,
    `maxAbsAngle=${maxAbsAngle.toFixed(3)}rad`);
  check(`${name}: never deeply clipped during roll`, everBlockedDeep <= tol,
    `maxBlocked=${everBlockedDeep}, tol=${tol}`);
  check(`${name}: final footprint within tolerance`, eng.bodyFootprintBlocked(b) <= tol,
    `blocked=${eng.bodyFootprintBlocked(b)}`);
})();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.log('FAILURES:');
  for (const r of failed) console.log(`  - ${r.name}: ${r.detail}`);
  process.exit(1);
}
console.log('All raster-overlap validator checks passed.');
