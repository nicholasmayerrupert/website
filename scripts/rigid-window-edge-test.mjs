// Two small debris bodies at the bottom loaded-window boundary must settle
// without a late overlap or a penetration rebound loop.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const COLS = 384;
const ROWS = 288;
const STEPS = 240;
const SETTLE_START = 120;

const engine = attachTestHooks(createEngineWasmRaw({
  cols: COLS,
  rows: ROWS,
  worldSeed: 1026552672,
  sinksOn: false,
  infinite: true,
}));

const four = [];
for (let y = 0; y < 2; y++)
  for (let x = 0; x < 2; x++) four.push([58 + x, 270 + y]);
const three = [[61, 270], [62, 270], [61, 271]];
engine.spawnBody(four);
engine.spawnBody(three);
engine._setBodyMotion(0, 0.2, 3, 0.05);
engine._setBodyMotion(1, -0.15, 3, -0.04);

// Procedural terrain may detach unrelated fragments while the fixture runs.
const debrisCells = new Map([
  [engine._bodyIdLayer(0, 0), four.length],
  [engine._bodyIdLayer(0, 1), three.length],
]);
const tracks = new Map();
let latePeakBodyBlocked = 0;
let finalBodyBlocked = 0;
for (let tick = 0; tick < STEPS; tick++) {
  engine.stepWorld();
  for (let i = 0; i < engine._bodyCount(); i++) {
    const id = engine._bodyIdLayer(0, i);
    if (!debrisCells.has(id)) continue;
    const state = engine._bodyState(i);
    if (!state) continue;
    let samples = tracks.get(id);
    if (!samples) tracks.set(id, samples = []);
    const blocked = Math.max(0, engine._bodyBlocked(i));
    samples.push({
      tick,
      blocked,
      vy: state.vy,
      px: state.px,
      py: state.py,
      nPts: state.nPts,
    });
    if (tick >= SETTLE_START)
      latePeakBodyBlocked = Math.max(latePeakBodyBlocked, blocked);
    if (tick === STEPS - 1)
      finalBodyBlocked = Math.max(finalBodyBlocked, blocked);
  }
}

let penetrationRebounds = 0;
for (const samples of tracks.values()) {
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].tick < SETTLE_START) continue;
    if (samples[i - 1].blocked > 0 && samples[i].vy < -0.025)
      penetrationRebounds++;
  }
}

const { check, done } = makeChecker(
  '4-cell/3-cell debris settles at the bottom loaded-window boundary');
check(`both debris bodies remain intact for all ${STEPS} ticks`,
  debrisCells.size === 2 && [...debrisCells].every(([id, cells]) => {
    const samples = tracks.get(id);
    return samples?.length === STEPS
      && samples.every((sample) => sample.nPts === cells);
  }));
check(`late body overlap clears (${latePeakBodyBlocked})`,
  latePeakBodyBlocked === 0);
check(`final body overlap clears (${finalBodyBlocked})`,
  finalBodyBlocked === 0);
check(`no penetration rebound loop (${penetrationRebounds})`,
  penetrationRebounds === 0);

engine.destroy();

// An airborne body reaching any loaded-window edge may freeze at its latest
// valid pose, but must never rewind its accumulated travel to the spawn pose.
for (const background of [false, true]) {
  const e = attachTestHooks(createEngineWasmRaw({
    cols: COLS, rows: ROWS, worldSeed: 7, sinksOn: false, infinite: true,
  }));
  e.setBgEnabled(background);
  for (let band = 0; band < 4; band++) e.shiftWorldXY(0, -128);
  e.spawnBox(180, 90, 8, 3);
  let prior = e._bodyState(0);
  let maxJump = 0, minY = prior.py;
  for (let tick = 0; tick < 60; tick++) {
    e._setBodyMotion(0, 0, -3, 0);
    e.stepWorld();
    const body = e._bodyState(0);
    maxJump = Math.max(maxJump, Math.hypot(body.px - prior.px, body.py - prior.py));
    minY = Math.min(minY, body.py);
    prior = body;
  }
  check(`airborne boundary recovery stays local (background=${background}, jump=${maxJump}, y=${prior.py})`,
    minY < 8 && maxJump <= 3.1 && prior.py < 8);
  e.destroy();
}
const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
