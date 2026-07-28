// A shallow blast under this generated house leaves small background bodies
// inside its fall path. They must receive dynamic impulses rather than acting
// as immovable peer-layer terrain.

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 320, ROWS = 240, SEED = 3059;
const TARGET_OFFSET_X = -160, TARGET_OFFSET_Y = -64;
const TARGET_MIN_CELLS = 800;

await initSandWasm();
const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));
const { check, done } = makeChecker('TNT-detached house clears peer-layer rigid fragments');
const engine = createEngineWasm({
  cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: true,
});
engine.shiftWorldXY(
  TARGET_OFFSET_X - engine.getWorldOffsetX(),
  TARGET_OFFSET_Y - engine.getWorldOffsetY(),
);

for (const x of [193, 211, 229, 247, 265, 266])
  engine._detonateTnt(x, 54);

const bodyIndex = (layer, id) => {
  for (let i = 0; i < engine._bodyCountLayer(layer); i++)
    if (engine._bodyIdLayer(layer, i) === id) return i;
  return -1;
};
const largestJointLeader = () => {
  let best = null;
  for (let i = 0; i < engine._bodyCountLayer(0); i++) {
    if (engine._bodyJointRoleLayer(0, i) !== 1
        || engine._bodyBlastDebrisLayer(0, i)) continue;
    const state = engine._bodyStateLayer(0, i);
    if (state && (!best || state.nPts > best.state.nPts))
      best = { id: engine._bodyIdLayer(0, i), state };
  }
  return best;
};
const adjacentPeerIds = (targetId) => {
  const owners = engine._bodyOwnerGrid(1);
  const ids = new Set();
  for (let k = 0; k < owners.length; k++) {
    if (owners[k] !== targetId) continue;
    const x = k % COLS, y = (k / COLS) | 0;
    for (const neighbor of [
      x > 0 ? k - 1 : -1,
      x + 1 < COLS ? k + 1 : -1,
      y > 0 ? k - COLS : -1,
      y + 1 < ROWS ? k + COLS : -1,
    ]) {
      if (neighbor >= 0 && owners[neighbor] >= 0
          && owners[neighbor] !== targetId)
        ids.add(owners[neighbor]);
    }
  }
  return ids;
};

let targetId = -1;
const targetSamples = [];
const peerTracks = new Map();
const contactedPeerIds = new Set();
for (let step = 0; step < 100; step++) {
  engine.stepWorld();
  for (let i = 0; i < engine._bodyCountLayer(1); i++) {
    if (engine._bodyJointRoleLayer(1, i) !== 0) continue;
    const id = engine._bodyIdLayer(1, i);
    const state = engine._bodyStateLayer(1, i);
    if (!state) continue;
    let track = peerTracks.get(id);
    if (!track) {
      track = { x: state.px, y: state.py, maxDistance: 0 };
      peerTracks.set(id, track);
    }
    track.maxDistance = Math.max(
      track.maxDistance, Math.hypot(state.px - track.x, state.py - track.y));
  }

  if (targetId < 0) {
    const target = largestJointLeader();
    if (target?.state.nPts >= TARGET_MIN_CELLS) targetId = target.id;
  }
  if (targetId < 0) continue;
  const index = bodyIndex(0, targetId);
  if (index < 0) continue;
  const state = engine._bodyStateLayer(0, index);
  if (!state) continue;
  targetSamples.push({ step, ...state });
  for (const id of adjacentPeerIds(targetId)) contactedPeerIds.add(id);
  if (process.env.TRACE === '1')
    console.log(`step=${step} py=${state.py.toFixed(4)}`
      + ` vy=${state.vy.toFixed(4)} angle=${state.angle.toFixed(4)}`);
}

const first = targetSamples[0];
const firstWindow = first
  ? targetSamples.filter((sample) => sample.step <= first.step + 60)
  : [];
const fallDistance = first && firstWindow.length
  ? firstWindow.at(-1).py - first.py : 0;
let peerDistance = 0;
for (const id of contactedPeerIds)
  peerDistance = Math.max(peerDistance, peerTracks.get(id)?.maxDistance ?? 0);

check(`large generated house became a joint body (${first?.nPts ?? 0} cells)`,
  !!first && first.nPts >= TARGET_MIN_CELLS);
check(`house contacted ordinary background bodies (${[...contactedPeerIds].join(',')})`,
  contactedPeerIds.size > 0);
check(`house continued falling after contact (${fallDistance.toFixed(2)} cells)`,
  fallDistance >= 5);
check(`peer bodies were displaced by the impact (${peerDistance.toFixed(2)} cells)`,
  peerDistance >= 1);

engine.destroy();
const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
