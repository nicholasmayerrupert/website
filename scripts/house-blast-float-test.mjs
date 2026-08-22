// A shallow blast under this generated house leaves small background bodies
// inside its fall path. They must receive dynamic impulses rather than acting
// as immovable peer-layer terrain.

import { initSandWasm, createEngineWasm as createEngineWasmRaw, MAT } from '../src/sand/wasmBridge/engineFactory.js';
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

// A large cross-layer structure and a small background body form one dynamic
// contact island. Exact raster assignment chooses their cell poses after the
// shared velocity solve, without an additional peer-layer position bias.
{
  const cols = 100, rows = 200;
  const peerEngine = createEngineWasm({
    cols, rows, worldSeed: 1, sinksOn: false, infinite: false,
  });
  peerEngine.setBgEnabled(true);
  for (let y = 27; y <= 42; y++) for (let x = 34; x <= 65; x++)
    peerEngine.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
  for (let y = 27; y <= 32; y++) for (let x = 34; x <= 40; x++)
    peerEngine.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
  peerEngine.syncComponentsLayer(0);
  peerEngine.syncComponentsLayer(1);
  peerEngine.stepWorld();

  let leaderIndex = -1;
  for (let i = 0; i < peerEngine._bodyCountLayer(0); i++)
    if (peerEngine._bodyJointRoleLayer(0, i) === 1) leaderIndex = i;
  const leaderId = leaderIndex >= 0
    ? peerEngine._bodyIdLayer(0, leaderIndex) : -1;
  const findBody = (layer, id) => {
    for (let i = 0; i < peerEngine._bodyCountLayer(layer); i++)
      if (peerEngine._bodyIdLayer(layer, i) === id)
        return { index: i, state: peerEngine._bodyStateLayer(layer, i) };
    return null;
  };
  peerEngine.paintDiscLayer(1, 50, 41, 0, MAT.STONE, true);
  peerEngine.paintDiscLayer(1, 51, 41, 0, MAT.STONE, true);
  peerEngine.syncComponentsLayer(1);
  peerEngine.stepWorld();
  let fragmentId = -1;
  for (let i = 0; i < peerEngine._bodyCountLayer(1); i++) {
    const state = peerEngine._bodyStateLayer(1, i);
    if (peerEngine._bodyJointRoleLayer(1, i) === 0 && state?.nPts === 2)
      fragmentId = peerEngine._bodyIdLayer(1, i);
  }
  const startLeader = findBody(0, leaderId)?.state;
  const startFragment = findBody(1, fragmentId)?.state;
  let contacted = false;
  for (let step = 0; step < 30; step++) {
    peerEngine.stepWorld();
    contacted = contacted || peerEngine._worldContacts().some(
      (contact) => contact.aLayer === 0 && contact.aId === leaderId
        && contact.bLayer === 1 && contact.bId === fragmentId,
    );
  }
  const endLeader = findBody(0, leaderId);
  const endFragment = findBody(1, fragmentId);
  const leaderFall = startLeader && endLeader
    ? endLeader.state.py - startLeader.py : 0;
  const fragmentFall = startFragment && endFragment
    ? endFragment.state.py - startFragment.py : 0;

  check('large structure contacted the small background body', contacted);
  check(`unanchored structure kept falling after peer contact (${leaderFall.toFixed(2)} cells)`,
    leaderFall >= 20 && endLeader
      && peerEngine._bodyTerrainBlockedLayer(0, endLeader.index) === 0);
  check(`background fragment kept falling (${fragmentFall.toFixed(2)} cells)`,
    fragmentFall >= 20);
  peerEngine.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
