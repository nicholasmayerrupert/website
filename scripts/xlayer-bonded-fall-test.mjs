// A cross-layer-bonded rigid shell filled with lighter powder or liquid must
// displace that content and fall instead of treating its contents as support.

import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 30, ROWS = 36;
await initSandWasm();
const { check, done } = makeChecker('cross-layer bonded sand-filled shell falls');

const run = (e, n) => { let t = 0; for (let i = 0; i < n; i++) { t += 16; e.step(t); } };
const cnt = (g, m) => { let n = 0; for (const v of g) if (v === m) n++; return n; };
const lowestStone = (g) => { let lo = -1; for (let y = 0; y < ROWS - 1; y++) for (let x = 0; x < COLS; x++) if (g[y * COLS + x] === MAT.STONE) lo = Math.max(lo, y); return lo; };

// hollow stone box outline filled with sand, in `layer`
function ring(e, x0, y0, x1, y1, layer) {
  for (let x = x0; x <= x1; x++) { e.placeMaterial(x, y0, 0, MAT.STONE, layer); e.placeMaterial(x, y1, 0, MAT.STONE, layer); }
  for (let y = y0; y <= y1; y++) { e.placeMaterial(x0, y, 0, MAT.STONE, layer); e.placeMaterial(x1, y, 0, MAT.STONE, layer); }
  for (let y = y0 + 1; y <= y1 - 1; y++) for (let x = x0 + 1; x <= x1 - 1; x++) e.placeMaterial(x, y, 0, MAT.SAND, layer);
}

const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 1, sinksOn: false, infinite: false });
e.setBgEnabled(true);
for (let x = 0; x < COLS; x++) { e.placeMaterial(x, ROWS - 1, 0, MAT.STONE, 0); e.placeMaterial(x, ROWS - 1, 0, MAT.STONE, 1); }
ring(e, 10, 6, 18, 12, 0);
ring(e, 10, 6, 18, 12, 1);
run(e, 2);

const fg0 = e.getGrid(), bg0 = e.getGridBg();
const s0 = { stone: cnt(fg0, MAT.STONE), sand: cnt(fg0, MAT.SAND), bgStone: cnt(bg0, MAT.STONE), bgSand: cnt(bg0, MAT.SAND) };
const start = lowestStone(fg0);
run(e, 400);
const fg1 = e.getGrid(), bg1 = e.getGridBg();
const end = lowestStone(fg1);

check(`fg ring fell toward the floor (lowest stone ${start} -> ${end}, floor ${ROWS - 1})`, end >= ROWS - 3);
check('bg ring fell in lockstep (layers byte-symmetric)', fg1.every((v, i) => v === bg1[i]));
check(`stone conserved (fg ${s0.stone} bg ${s0.bgStone})`, cnt(fg1, MAT.STONE) === s0.stone && cnt(bg1, MAT.STONE) === s0.bgStone);
check(`sand conserved (fg ${s0.sand} bg ${s0.bgSand})`, cnt(fg1, MAT.SAND) === s0.sand && cnt(bg1, MAT.SAND) === s0.bgSand);
e.destroy();

// A GROUNDED sand-filled ring (its base sits on the floor in both layers) must NOT
// spuriously sink — the displacement path only fires for ungrounded assemblies.
const e2 = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 1, sinksOn: false, infinite: false });
e2.setBgEnabled(true);
for (let x = 0; x < COLS; x++) { e2.placeMaterial(x, ROWS - 1, 0, MAT.STONE, 0); e2.placeMaterial(x, ROWS - 1, 0, MAT.STONE, 1); }
ring(e2, 10, ROWS - 8, 18, ROWS - 2, 0); // bottom arc at ROWS-2, directly on the floor
ring(e2, 10, ROWS - 8, 18, ROWS - 2, 1);
run(e2, 202);
const g2 = e2.getGrid();
let topRow = ROWS;
for (let y = 0; y < ROWS - 1; y++) for (let x = 0; x < COLS; x++) if (g2[y * COLS + x] === MAT.STONE) { topRow = Math.min(topRow, y); }
check(`grounded ring stays put (top stone row ${topRow} ~ ${ROWS - 8})`, topRow <= ROWS - 7);
e2.destroy();

// Structural motion must not change when the loaded window crosses the
// historical 900,000-cell performance threshold. Both halves of this
// cross-layer assembly should fall exactly one row per world tick.
const fallTrace = (cols) => {
  const rows = 1000, cx = cols >> 1;
  const engine = createEngineWasm({ cols, rows, worldSeed: 1, sinksOn: false, infinite: false });
  engine.setBgEnabled(true);
  for (const [layer, material] of [[0, MAT.BRICK], [1, MAT.STONE]]) {
    for (let y = 100; y < 105; y++) for (let x = cx - 2; x <= cx + 2; x++) {
      engine.paintDiscLayer(layer, x, y, 0, material, true);
    }
    engine.syncComponentsLayer(layer);
  }
  const top = (grid, material) => {
    for (let y = 90; y < 140; y++) for (let x = cx - 4; x <= cx + 4; x++) {
      if (grid[y * cols + x] === material) return y;
    }
    return -1;
  };
  const fg = [], bg = [];
  for (let i = 0; i < 12; i++) {
    engine.stepWorld();
    fg.push(top(engine.getGrid(), MAT.BRICK));
    bg.push(top(engine.getGridBg(), MAT.STONE));
  }
  engine.destroy();
  return { fg, bg };
};

const atThreshold = fallTrace(900);
const aboveThreshold = fallTrace(901);
check('component fall trace is cell-count invariant',
  JSON.stringify(aboveThreshold) === JSON.stringify(atThreshold),
  `(900k ${atThreshold.fg.join(',')}; 901k ${aboveThreshold.fg.join(',')})`);
check('large cross-layer assembly falls every tick',
  aboveThreshold.fg.every((y, i) => y === 101 + i)
    && aboveThreshold.bg.every((y, i) => y === 101 + i));

// A descending component can catch a free body inside it. The component and
// body must translate as one occupancy union, displacing trapped liquid/powder
// into their combined trailing vacancies. Treating the body's leading medium
// as hard terrain pins the whole unsupported shell.
const bodyPushTrace = (medium) => {
  const cols = 96, rows = 120;
  const engine = createEngineWasm({ cols, rows, worldSeed: 123, sinksOn: false, infinite: false });
  const shell = (x0, y0, x1, y1) => {
    for (let x = x0; x <= x1; x++) {
      engine.paintDiscLayer(0, x, y0, 0, MAT.BRICK, true);
      engine.paintDiscLayer(0, x, y1, 0, MAT.BRICK, true);
    }
    for (let y = y0 + 1; y < y1; y++) {
      engine.paintDiscLayer(0, x0, y, 0, MAT.BRICK, true);
      engine.paintDiscLayer(0, x1, y, 0, MAT.BRICK, true);
    }
  };
  const top = () => {
    const grid = engine.getGrid();
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (grid[y * cols + x] === MAT.BRICK) return y;
    }
    return -1;
  };
  const count = () => cnt(engine.getGrid(), medium);

  shell(28, 17, 58, 35);
  engine.spawnBox(45, 22, 4, 3, MAT.RIGID);
  engine.syncComponentsLayer(0);
  engine.stepWorld(); // stamp the body and move the empty shell to y=18..36
  for (let y = 19; y < 36; y++) for (let x = 29; x < 58; x++) {
    if (engine.getGrid()[y * cols + x] === MAT.EMPTY)
      engine.paintDiscLayer(0, x, y, 0, medium, true);
  }

  const volume = count(), start = top(), trace = [];
  for (let i = 0; i < 30; i++) { engine.stepWorld(); trace.push(top()); }
  const endVolume = count();
  engine.destroy();
  return { start, trace, volume, endVolume };
};

for (const [name, medium] of [['water', MAT.WATER], ['sand', MAT.SAND]]) {
  const result = bodyPushTrace(medium);
  check(`shell pushes a body through trapped ${name} every tick`,
    result.trace.every((y, i) => y === result.start + i + 1),
    `(trace ${result.trace.join(',')})`);
  check(`body-push ${name} volume is conserved (${result.volume} -> ${result.endVolume})`,
    result.endVolume === result.volume);
}

// Full reported composition: offset foreground/background shells, foreground
// sand, background water, and a foreground free body. One failed layer-local
// body push used to stall the bonded pair on ticks 2-4, 6-9, ... and delay its
// floor contact from tick 74 to tick 105.
{
  const cols = 96, rows = 120, floorY = 110;
  const engine = createEngineWasm({ cols, rows, worldSeed: 123, sinksOn: false, infinite: false });
  engine.setBgEnabled(true);
  const rect = (layer, x0, y0, x1, y1, material) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
      engine.paintDiscLayer(layer, x, y, 0, material, true);
  };
  const shell = (layer, x0, x1, material) => {
    for (let x = x0; x <= x1; x++) {
      engine.paintDiscLayer(layer, x, 17, 0, material, true);
      engine.paintDiscLayer(layer, x, 35, 0, material, true);
    }
    for (let y = 18; y < 35; y++) {
      engine.paintDiscLayer(layer, x0, y, 0, material, true);
      engine.paintDiscLayer(layer, x1, y, 0, material, true);
    }
  };
  const top = (grid, material) => {
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (grid[y * cols + x] === material) return y;
    }
    return -1;
  };
  const total = (material) => cnt(engine.getGrid(), material) + cnt(engine.getGridBg(), material);

  rect(0, 0, floorY, cols - 1, rows - 1, MAT.STONE);
  rect(1, 0, floorY, cols - 1, rows - 1, MAT.STONE);
  shell(0, 28, 58, MAT.BRICK);
  shell(1, 38, 68, MAT.CLAY);
  rect(0, 29, 26, 57, 34, MAT.SAND);
  rect(1, 39, 18, 67, 34, MAT.WATER);
  engine.spawnBox(45, 22, 4, 3, MAT.RIGID);
  engine.syncComponentsLayer(0);
  engine.syncComponentsLayer(1);

  const sand0 = total(MAT.SAND), water0 = total(MAT.WATER), fg = [], bg = [];
  for (let i = 0; i < 74; i++) {
    engine.stepWorld();
    fg.push(top(engine.getGrid(), MAT.BRICK));
    bg.push(top(engine.getGridBg(), MAT.CLAY));
  }
  check('full composite island falls in lockstep every tick',
    fg.every((y, i) => y === 18 + i) && bg.every((y, i) => y === 18 + i));
  check('full composite island reaches the floor on tick 74', fg.at(-1) === 91 && bg.at(-1) === 91);
  check(`full composite loose media are conserved (sand ${sand0} -> ${total(MAT.SAND)}, water ${water0} -> ${total(MAT.WATER)})`,
    total(MAT.SAND) === sand0 && total(MAT.WATER) === water0);
  engine.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
