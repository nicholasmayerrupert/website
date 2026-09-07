// Contact torque must start rotation from rest, including on sparse shapes with
// roughly square bounds. Balanced bodies must still settle on the same support.
import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { makeChecker } from './sand-test-util.mjs';
await initSandWasm();
const { check, done } = makeChecker('off-centre rigid pivots');
const cols = 640, rows = 480, postX = 320, postY = 300;
function scene(shape, size, offset, drop = 0, dynamicSupport = false) {
  const e = attachTestHooks(createEngineWasm({ cols, rows, worldSeed: 7, sinksOn: false, infinite: false }));
  e.setBgEnabled(false);
  e._setRigidSolverOptions(Number(process.env.RIGID_SOLVER_MODE ?? 45));
  const grid = e.getGrid();
  for (let y = 460; y < rows; y++) for (let x = 0; x < cols; x++) grid[y * cols + x] = MAT.STONE;
  const post = [];
  for (let y = postY; y < (dynamicSupport ? 460 : rows); y++) for (let x = postX - 1; x <= postX + 1; x++) {
    if (dynamicSupport) post.push([x, y]);
    else grid[y * cols + x] = MAT.STONE;
  }
  e.syncComponents();
  if (dynamicSupport) e.spawnBody(post);
  const points = [], thick = Math.max(3, Math.round(size / 8));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (shape === 'L' ? x < thick || y >= size - thick
      : x < thick || x >= size - thick || y < thick || y >= size - thick) points.push([x, y]);
  }
  const meanX = points.reduce((sum, p) => sum + p[0] + .5, 0) / points.length;
  const shiftX = Math.round(postX + offset - meanX);
  const index = e._bodyCount();
  e.spawnBody(points.map(([x, y]) => [x + shiftX, y + postY - size - drop]));
  return { e, index };
}
function measure(e, index, steps = 600) {
  const id = e._bodyIdLayer(0, index);
  let maxAngle = 0, first45 = -1, first45Sign = 0, sleep = -1, blocked = 0;
  for (let tick = 0; tick < steps; tick++) {
    e.stepWorld();
    index = -1;
    for (let i = 0; i < e._bodyCount(); i++) if (e._bodyIdLayer(0, i) === id) index = i;
    const state = index >= 0 ? e._bodyState(index) : null;
    if (!state) throw new Error('pivot body unexpectedly disappeared');
    const angle = state.angle * 180 / Math.PI;
    maxAngle = Math.max(maxAngle, Math.abs(angle));
    if (Math.abs(angle) >= 45 && first45 < 0) { first45 = tick; first45Sign = Math.sign(angle); }
    if (!e._bodyAwake(index) && sleep < 0) sleep = tick;
    blocked = Math.max(blocked, e._bodyTerrainBlocked(index));
  }
  return { maxAngle, first45, first45Sign, sleep, blocked };
}
function tipping(shape, size, offset, drop = 0, dynamicSupport = false) {
  const { e, index } = scene(shape, size, offset, drop, dynamicSupport);
  const r = measure(e, index);
  const label = `${shape} ${size}, offset ${offset}, drop ${drop}, ${dynamicSupport ? 'body' : 'terrain'} support`;
  check(`${label}: topples toward its weight before sleeping (${r.first45}, sleep ${r.sleep})`,
    r.first45 >= 0 && r.first45 < 300 && r.first45Sign === Math.sign(offset)
      && r.sleep > r.first45);
  check(`${label}: remains outside terrain (${r.blocked})`, r.blocked === 0);
  e.destroy();
}
for (const shape of ['L', 'frame']) for (const size of [32, 64, 128]) {
  for (const sign of [-1, 1]) tipping(shape, size, sign * Math.max(3, Math.round(size * .08)));
}
for (const sign of [-1, 1]) tipping('frame', 64, sign * 5, 1);
tipping('frame', 256, 20);
tipping('frame', 64, 5, 1, true);
for (const shape of ['L', 'frame']) for (const size of [32, 128]) {
  const { e, index } = scene(shape, size, 0);
  const r = measure(e, index);
  check(`balanced ${shape} ${size} stays upright and sleeps (${r.maxAngle.toFixed(3)}°, ${r.sleep})`,
    r.maxAngle < 5 && r.sleep >= 0 && r.blocked === 0);
  e.destroy();
}
{
  const { e, index } = scene('frame', 128, 1);
  for (let tick = 0; tick < 60; tick++) e.stepWorld();
  check('support-removal fixture begins asleep', !e._bodyAwake(index));
  for (let y = postY; y < 460; y++) for (let x = postX; x <= postX + 1; x++) e.eraseDisc(x, y, 0);
  e.syncComponents();
  const r = measure(e, index);
  check(`removing one side of the support wakes and tips the body (${r.first45}, ${r.maxAngle.toFixed(3)}°)`,
    r.first45 >= 0 && r.first45Sign === 1 && r.blocked === 0);
  e.destroy();
}
process.exitCode = done();
