// Cutting a large cross-layer body scales with the roster and erased regions.

import { performance } from 'node:perf_hooks';
import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
  MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { gridHash, makeChecker } from './sand-test-util.mjs';

const COLS = 420, ROWS = 390;
const CX = 210, CY = 175, RADIUS = 160;
const ERASE_RADIUS = 40;
const REPEATS = 3;

await initSandWasm();
const { check, done } = makeChecker('large joint-body batch erase scaling');

const ownedCells = (owners) => {
  let count = 0;
  for (const owner of owners) if (owner >= 0) count++;
  return count;
};

const runErase = (joint) => {
  const engine = attachTestHooks(createEngineWasmRaw({
    cols: COLS,
    rows: ROWS,
    worldSeed: 0x51a7,
    sinksOn: false,
    infinite: false,
  }));
  engine.setBgEnabled(true);
  for (const layer of joint ? [0, 1] : [1]) {
    engine.paintDiscLayer(layer, CX, CY, RADIUS, MAT.WOOD, true);
    engine.syncComponentsLayer(layer);
  }
  engine.stepWorld();

  const before = ownedCells(engine._bodyOwnerGrid(1));
  const start = performance.now();
  engine.eraseDiscLayer(1, CX, CY, ERASE_RADIUS);
  const elapsed = performance.now() - start;
  const after = ownedCells(engine._bodyOwnerGrid(1));
  const result = {
    elapsed,
    before,
    removed: before - after,
    backgroundHash: gridHash(engine.getGridBg()),
    ordinaryPresent: joint || Array.from(
      { length: engine._bodyCountLayer(1) },
      (_, body) => engine._bodyJointRoleLayer(1, body),
    ).includes(0),
    leaderPresent: !joint || Array.from(
      { length: engine._bodyCountLayer(0) },
      (_, body) => engine._bodyJointRoleLayer(0, body),
    ).includes(1),
    followerPresent: !joint || Array.from(
      { length: engine._bodyCountLayer(1) },
      (_, body) => engine._bodyJointRoleLayer(1, body),
    ).includes(2),
  };
  engine.destroy();
  return result;
};

const ordinary = [], joint = [];
for (let repeat = 0; repeat < REPEATS; repeat++) {
  ordinary.push(runErase(false));
  joint.push(runErase(true));
}

const minMs = (runs) => Math.min(...runs.map((run) => run.elapsed));
const ordinaryMs = minMs(ordinary), jointMs = minMs(joint);
const stable = (runs, field) => runs.every((run) => run[field] === runs[0][field]);

check(`fixture creates a large owned footprint (${joint[0].before} cells)`,
  joint[0].before >= 75_000 && stable(joint, 'before'));
check(`batch erases a broad background cut (${joint[0].removed} cells)`,
  joint[0].removed >= 5_000 && stable(joint, 'removed'));
check('ordinary and joint cuts retain the expected body roles',
  ordinary.every((run) => run.ordinaryPresent)
    && joint.every((run) => run.leaderPresent && run.followerPresent));
check('batch erase result remains deterministic across repetitions',
  stable(ordinary, 'backgroundHash')
    && stable(joint, 'backgroundHash')
    && ordinary[0].backgroundHash === joint[0].backgroundHash);
check(`joint cut stays near the equivalent single-layer cost `
    + `(${jointMs.toFixed(1)} ms vs ${ordinaryMs.toFixed(1)} ms)`,
  jointMs <= ordinaryMs * 4 + 20);

const runManyJointCut = (withDistantBody) => {
  const cols = 700, rows = 420;
  const engine = attachTestHooks(createEngineWasmRaw({
    cols,
    rows,
    worldSeed: 0x7711,
    sinksOn: false,
    infinite: false,
  }));
  engine.setBgEnabled(true);
  if (withDistantBody)
    for (const layer of [0, 1])
      engine.paintDiscLayer(layer, 190, 190, 170, MAT.WOOD, true);
  for (const layer of [0, 1]) {
    const grid = layer ? engine.getGridBg() : engine.getGrid();
    for (let y = 120; y <= 240; y += 4)
      for (let x = 440; x <= 560; x += 4)
        grid[y * cols + x] = MAT.WOOD;
    engine.syncComponentsLayer(layer);
  }
  engine.stepWorld();
  const before = ownedCells(engine._bodyOwnerGrid(1));
  const countsBefore = [
    engine._bodyCountLayer(0),
    engine._bodyCountLayer(1),
  ];
  const start = performance.now();
  engine.eraseDiscLayer(1, 500, 180, 100);
  const elapsed = performance.now() - start;
  const roles = (layer, role) => Array.from(
    { length: engine._bodyCountLayer(layer) },
    (_, body) => engine._bodyJointRoleLayer(layer, body),
  ).filter((value) => value === role).length;
  const result = {
    elapsed,
    before,
    after: ownedCells(engine._bodyOwnerGrid(1)),
    countsBefore,
    countsAfter: [engine._bodyCountLayer(0), engine._bodyCountLayer(1)],
    ordinaryForeground: roles(0, 0),
    jointForeground: roles(0, 1),
    jointBackground: roles(1, 2),
    foregroundHash: gridHash(engine.getGrid()),
    backgroundHash: gridHash(engine.getGridBg()),
  };
  engine.destroy();
  return result;
};

const localCuts = [], paddedCuts = [];
for (let repeat = 0; repeat < 3; repeat++) {
  localCuts.push(runManyJointCut(false));
  paddedCuts.push(runManyJointCut(true));
}
const localCut = localCuts[0], paddedCut = paddedCuts[0];
check('mass-cut fixture creates the expected joint bodies and passive cells',
  localCut.before === 961
    && paddedCut.before === 91_746
    && localCut.countsBefore[0] === 961
    && localCut.countsBefore[1] === 961
    && paddedCut.countsBefore[0] === 962
    && paddedCut.countsBefore[1] === 962);
check('mass cut retires 961 followers without disturbing the distant joint',
  localCut.after === 0
    && paddedCut.after === 90_785
    && localCut.countsAfter[0] === 961
    && localCut.countsAfter[1] === 0
    && paddedCut.countsAfter[0] === 962
    && paddedCut.countsAfter[1] === 1
    && localCut.ordinaryForeground === 961
    && paddedCut.ordinaryForeground === 961
    && paddedCut.jointForeground === 1
    && paddedCut.jointBackground === 1);
check('mass-cut roster indexing preserves the deterministic result',
  localCut.foregroundHash === 4_017_653_261
    && localCut.backgroundHash === 2_253_962_373
    && paddedCut.foregroundHash === 4_290_173_093
    && paddedCut.backgroundHash === 355_798_861);
const localCutMs = Math.min(...localCuts.map((run) => run.elapsed));
const paddedCutMs = Math.min(...paddedCuts.map((run) => run.elapsed));
check(`mass-cut work is independent of unrelated joint cells `
    + `(${paddedCutMs.toFixed(1)} ms vs ${localCutMs.toFixed(1)} ms)`,
  paddedCutMs <= localCutMs * 3 + 100);

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
