// A cross-layer-bonded rigid shell filled with lighter powder or liquid must
// displace that content and fall instead of treating its contents as support.

import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 30, ROWS = 36;
await initSandWasm();
const { check, done } = makeChecker('cross-layer bonded sand-filled shell falls');

const run = (e, n) => { let t = 0; for (let i = 0; i < n; i++) { t += 16; e.step(t); } };
const cnt = (g, m) => { let n = 0; for (const v of g) if (v === m) n++; return n; };
const lowestStone = (g) => { let lo = -1; for (let y = 0; y < ROWS - 1; y++) for (let x = 0; x < COLS; x++) if (g[y * COLS + x] === MAT.STONE) lo = Math.max(lo, y); return lo; };

// A missing transient bond cache must be repaired before either layer enters
// the ordinary single-layer detacher.
{
  const engine = attachTestHooks(createEngineWasm({
    cols: COLS, rows: ROWS, worldSeed: 1, sinksOn: false, infinite: false,
  }));
  engine.setBgEnabled(true);
  for (let layer = 0; layer <= 1; layer++) {
    for (let y = 6; y <= 10; y++) for (let x = 11; x <= 17; x++)
      engine.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
    engine.syncComponentsLayer(layer);
  }
  engine._dropJointBondCache();
  engine.stepWorld();
  check('missing bond cache is repaired as one foreground/background body',
    engine._bodyCountLayer(0) === 1
      && engine._bodyCountLayer(1) === 1
      && engine._bodyJointRoleLayer(0, 0) === 1
      && engine._bodyJointRoleLayer(1, 0) === 2);
  engine.destroy();
}

// Acid can erode either material half of a moving joint body. Both live owner
// rasters remain visible to the joint splitter while it rebuilds the result.
for (const [acidLayer, layerName] of [[0, 'foreground'], [1, 'background']]) {
  const cols = 48, rows = 80;
  const engine = attachTestHooks(createEngineWasm({
    cols, rows, worldSeed: 1, sinksOn: false, infinite: false,
  }));
  engine.setBgEnabled(true);
  for (let layer = 0; layer <= 1; layer++) {
    const minX = layer ? 23 : 12;
    const maxX = layer ? 35 : 24;
    for (let y = 8; y <= 19; y++) for (let x = minX; x <= maxX; x++)
      engine.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
    engine.syncComponentsLayer(layer);
  }
  engine.stepWorld();
  const layerGrid = () => acidLayer ? engine.getGridBg() : engine.getGrid();
  const jointLeader = () => {
    for (let body = 0; body < engine._bodyCountLayer(0); body++) {
      if (engine._bodyJointRoleLayer(0, body) === 1)
        return engine._bodyStateLayer(0, body);
    }
    return null;
  };
  const cellsAtBirth = jointLeader()?.nPts ?? 0;
  let eroded = false, jointAfterErosion = false, erosionDetail = '';
  for (let step = 0; step < 24 && !eroded; step++) {
    const owner = engine._bodyOwnerGrid(acidLayer);
    const peerOwner = engine._bodyOwnerGrid(acidLayer ? 0 : 1);
    const grid = layerGrid();
    let placed = 0;
    for (let k = 0; k < owner.length && placed < 24; k++) {
      if (owner[k] < 0 || peerOwner[k] >= 0) continue;
      const y = Math.floor(k / cols), x = k - y * cols;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx <= 0 || nx >= cols - 1 || ny <= 0 || ny >= rows - 1) continue;
        const nk = ny * cols + nx;
        if (owner[nk] >= 0 || grid[nk] !== MAT.EMPTY) continue;
        engine.paintDiscLayer(acidLayer, nx, ny, 0, MAT.ACID, false);
        placed++;
        break;
      }
    }
    engine.stepWorld();
    const leader = jointLeader();
    if (leader && leader.nPts >= cellsAtBirth) continue;
    eroded = true;
    const fgRoles = Array.from(
      { length: engine._bodyCountLayer(0) },
      (_, i) => engine._bodyJointRoleLayer(0, i),
    );
    const bgRoles = Array.from(
      { length: engine._bodyCountLayer(1) },
      (_, i) => engine._bodyJointRoleLayer(1, i),
    );
    jointAfterErosion = fgRoles.includes(1) && bgRoles.includes(2);
    erosionDetail = `step ${step}; cells ${cellsAtBirth}->${leader?.nPts ?? 0}; roles ${fgRoles.join(',')}/${bgRoles.join(',')}`;
  }
  check(`${layerName} acid erodes a moving joint body`, eroded);
  check(`${layerName} acid erosion preserves the joint body (${erosionDetail})`, jointAfterErosion);
  engine.destroy();
}

// Acid cutting matching foreground/background supports must create the falling
// slab as a joint body on its first dynamic tick.
{
  const cols = 64, rows = 80;
  const engine = attachTestHooks(createEngineWasm({
    cols, rows, worldSeed: 1, sinksOn: false, infinite: false,
  }));
  engine.setBgEnabled(true);
  for (let layer = 0; layer <= 1; layer++) {
    for (let y = 15; y <= 30; y++) for (let x = 14; x <= 49; x++)
      engine.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
    for (let y = 31; y < rows; y++) for (let x = 31; x <= 32; x++)
      engine.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
    engine.syncComponentsLayer(layer);
  }
  for (let i = 0; i < 4; i++) engine.stepWorld();
  for (let layer = 0; layer <= 1; layer++) for (let y = 38; y <= 55; y++) {
    engine.paintDiscLayer(layer, 30, y, 0, MAT.ACID, true);
    engine.paintDiscLayer(layer, 33, y, 0, MAT.ACID, true);
  }
  let born = false, jointAtBirth = false, birthDetail = '';
  for (let i = 0; i < 500; i++) {
    engine.stepWorld();
    if (engine._bodyCountLayer(0) === 0 && engine._bodyCountLayer(1) === 0) continue;
    born = true;
    const fgCount = engine._bodyCountLayer(0), bgCount = engine._bodyCountLayer(1);
    const describe = (layer, count) => Array.from({ length: count }, (_, b) =>
      `${engine._bodyJointRoleLayer(layer, b)}:${engine._bodyStateLayer(layer, b)?.nPts ?? 0}`);
    const fgBodies = describe(0, fgCount), bgBodies = describe(1, bgCount);
    birthDetail = `tick ${i}; role:cells ${fgBodies.join(',')}/${bgBodies.join(',')}`;
    jointAtBirth = engine._bodyCountLayer(0) === 1
      && engine._bodyCountLayer(1) === 1
      && engine._bodyJointRoleLayer(0, 0) === 1
      && engine._bodyJointRoleLayer(1, 0) === 2;
    break;
  }
  check('aligned acid cut produces a body', born);
  check(`aligned acid-cut body contains both layers at birth (${birthDetail})`, jointAtBirth);
  for (let layer = 0; layer <= 1; layer++) {
    const grid = layer ? engine.getGridBg() : engine.getGrid();
    for (let k = 0; k < grid.length; k++) if (grid[k] === MAT.ACID)
      engine.paintDiscLayer(layer, k % cols, Math.floor(k / cols), 0, MAT.EMPTY, true);
  }
  const bgStoneAtBirth = cnt(engine.getGridBg(), MAT.STONE);
  let minBgStone = bgStoneAtBirth, maxRejected = 0;
  for (let i = 0; i < 24; i++) {
    engine.stepWorld();
    minBgStone = Math.min(minBgStone, cnt(engine.getGridBg(), MAT.STONE));
    maxRejected = Math.max(maxRejected, engine.getRigidDebug().rejectedCells);
  }
  check(`acid-cut follower raster remains materialized (${bgStoneAtBirth} -> ${minBgStone}; rejected ${maxRejected})`,
    minBgStone >= bgStoneAtBirth - 2);
  engine.destroy();
}

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

// Structural motion stays invariant across nearby loaded-window sizes. Both
// halves of the cross-layer body accelerate together in the rigid solver.
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
check('large cross-layer assembly accelerates in layer lockstep',
  aboveThreshold.fg.every((y, i) => y === aboveThreshold.bg[i]
      && (i === 0 || y >= aboveThreshold.fg[i - 1]))
    && aboveThreshold.fg.at(-1) >= aboveThreshold.fg[0] + 4);

// A descending structural body can catch another body inside it. Their
// occupancy union displaces trapped liquid or powder into trailing vacancies.
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
  check(`shell keeps pushing a body through trapped ${name}`,
    result.trace.every((y, i) => i === 0 || y >= result.trace[i - 1])
      && result.trace.at(-1) >= result.start + 7);
  check(`body-push ${name} volume is conserved (${result.volume} -> ${result.endVolume})`,
    result.endVolume === result.volume);
}

// Offset foreground/background shells, foreground sand, background water, and
// a foreground body remain one bonded assembly through the full descent.
{
  const cols = 96, rows = 120, floorY = 110;
  const engine = attachTestHooks(createEngineWasm({
    cols, rows, worldSeed: 123, sinksOn: false, infinite: false,
  }));
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

  const jointState = (layer, role) => {
    for (let body = 0; body < engine._bodyCountLayer(layer); body++) {
      if (engine._bodyJointRoleLayer(layer, body) === role)
        return engine._bodyStateLayer(layer, body);
    }
    return null;
  };
  const samePose = (a, b) => a && b
    && ['px', 'py', 'angle', 'vx', 'vy', 'omega']
      .every((field) => Math.abs(a[field] - b[field]) <= 1e-9);

  const sand0 = total(MAT.SAND), water0 = total(MAT.WATER), fg = [], bg = [];
  let jointMismatch = null, jointSeen = false, jointSettled = false;
  for (let i = 0; i < 180; i++) {
    engine.stepWorld();
    fg.push(top(engine.getGrid(), MAT.BRICK));
    bg.push(top(engine.getGridBg(), MAT.CLAY));
    const leader = jointState(0, 1), follower = jointState(1, 2);
    if (leader && follower) {
      if (jointSettled && !jointMismatch) jointMismatch = `${i}: dynamic joint reappeared after settling`;
      jointSeen = true;
      if (!jointMismatch && !samePose(leader, follower))
        jointMismatch = `${i}: pose ${leader.py.toFixed(3)}/${follower.py.toFixed(3)}, angle ${leader.angle.toFixed(3)}/${follower.angle.toFixed(3)}`;
    } else if (leader || follower) {
      if (!jointMismatch)
        jointMismatch = `${i}: joint roles ${leader ? 'leader' : 'missing'}/${follower ? 'follower' : 'missing'}`;
    } else if (jointSeen) {
      jointSettled = true;
    }
  }
  // The joint pose is authoritative. Offset masks can expose different topmost
  // raster rows while the shared body rotates during a floor impact.
  const traceMismatch = fg.findIndex((y, i) => Math.abs(y - bg[i]) > 2);
  const traceDetail = traceMismatch < 0 ? 'none'
    : `${traceMismatch}: fg ${fg[traceMismatch]}, bg ${bg[traceMismatch]}`;
  check(`full composite island keeps one foreground/background joint until settling (${jointMismatch || 'exact shared pose'})`,
    jointSeen && jointMismatch === null);
  check(`full composite island stays raster-aligned (first mismatch ${traceDetail})`, traceMismatch < 0);
  check(`full composite island reaches the floor (fg ${fg.at(-1)}; bg ${bg.at(-1)})`,
    fg.at(-1) >= 90 && bg.at(-1) >= 90);
  check(`full composite loose media are conserved (sand ${sand0} -> ${total(MAT.SAND)}, water ${water0} -> ${total(MAT.WATER)})`,
    total(MAT.SAND) === sand0 && total(MAT.WATER) === water0);
  engine.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
