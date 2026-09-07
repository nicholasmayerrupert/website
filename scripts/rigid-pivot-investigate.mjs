// Deterministic off-centre ledge probes. Reports motion rather than imposing a
// new settling threshold; generic rigid material keeps the body observable.
import { mkdirSync, writeFileSync } from 'node:fs';
import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { trackRigidMotion } from './rigid-motion-metrics.mjs';
await initSandWasm();
const out = process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts/pivot';
mkdirSync(out, { recursive: true });
const results = [];
const modes = (process.env.PIVOT_MODES || '45').split(',').map(Number);
const sizes = (process.env.PIVOT_SIZES || '32,64,128').split(',').map(Number);
const drop = Number(process.env.PIVOT_DROP || 0);
const balance = Number(process.env.PIVOT_OFFSET || .08);
const shapes = (process.env.PIVOT_SHAPES || 'bar,l,arch').split(',');
for (const mode of modes) for (const shape of shapes) for (const size of sizes) {
  const cols = 640, rows = 480, pivotX = 320, pivotY = 300;
  const e = attachTestHooks(createEngineWasm({ cols, rows, worldSeed: 7, infinite: false, sinksOn: false }));
  e.setBgEnabled(false); e._setRigidSolverOptions(mode);
  const grid = e.getGrid();
  for (let y = 460; y < rows; y++) for (let x = 0; x < cols; x++) grid[y * cols + x] = MAT.STONE;
  for (let y = pivotY; y < rows; y++) for (let x = pivotX - 1; x <= pivotX + 1; x++) grid[y * cols + x] = MAT.STONE;
  e.syncComponents();
  const points = [], thick = Math.max(3, Math.round(size / 8));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const occupied = shape === 'bar' ? y >= size - thick
      : shape === 'l' ? x < thick || y >= size - thick
      : x < thick || x >= size - thick || y < thick || y >= size - thick;
    if (occupied) points.push([x, y]);
  }
  const meanX = points.reduce((sum, p) => sum + p[0] + .5, 0) / points.length;
  const lever = balance === 0 ? 0 : Math.max(3, Math.round(size * balance));
  const shiftX = Math.round(pivotX + lever - meanX);
  e.spawnBody(points.map(([x, y]) => [x + shiftX, y + pivotY - size - drop]));
  const initial = e._bodyState(0), id = e._bodyIdLayer(0, 0), tracker = trackRigidMotion(e, 0, id);
  let maxAngle = 0, first45 = -1, sleep = -1, blocked = 0, corrections = 0;
  const frames = [];
  for (let tick = 0; tick < 600; tick++) {
    e.stepWorld(); tracker.sample(tick);
    const state = e._bodyState(0); if (!state) break;
    if (process.env.PIVOT_SVG === '1' && [0, 19, 160, 599].includes(tick)) {
      const raster = e.getGrid(), owners = e._bodyOwnerGrid();
      const paths = { terrain: '', body: '' };
      for (let y = 120; y < rows; y++) for (let x = 160; x < 490;) {
        const k = y * cols + x;
        const kind = owners[k] === id ? 'body' : raster[k] === MAT.STONE ? 'terrain' : null;
        if (!kind) { x++; continue; }
        const start = x++;
        while (x < 490 && (kind === 'body' ? owners[y * cols + x] === id
          : raster[y * cols + x] === MAT.STONE && owners[y * cols + x] !== id)) x++;
        paths[kind] += `M${start} ${y}h${x - start}v1h-${x - start}z`;
      }
      writeFileSync(`${out}/${shape}-${size}-tick${tick}.svg`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="660" height="720" viewBox="160 120 330 360">`
        + `<rect x="160" y="120" width="330" height="360" fill="#14212e"/>`
        + `<path d="${paths.terrain}" fill="#87959c"/><path d="${paths.body}" fill="#88c9b8"/>`
        + `<circle cx="${state.px}" cy="${state.py}" r="3" fill="#ffb35c"/>`
        + `<text x="168" y="136" fill="white" font-size="9">${shape}, ${size} cells, tick ${tick}, ${e._bodyAwake(0) ? 'awake' : 'asleep'}</text></svg>`);
    }
    const angle = Math.abs(state.angle * 180 / Math.PI);
    maxAngle = Math.max(maxAngle, angle);
    if (angle >= 45 && first45 < 0) first45 = tick;
    if (!e._bodyAwake(0) && sleep < 0) sleep = tick;
    blocked = Math.max(blocked, e._bodyTerrainBlocked(0));
    corrections = Math.max(corrections, e.getRigidDebug().depenetrations);
    if (tick < 12 || tick % 10 === 0 || tick === sleep) frames.push({ tick, ...state, awake: !!e._bodyAwake(0), contacts: e.getRigidSolverDebug().contacts });
  }
  const result = { mode, shape, size, drop, balance, initial, maxAngle, first45, sleep, blocked, corrections, motion: tracker.summary(), frames };
  results.push(result);
  console.log(JSON.stringify({ mode, shape, size, cells: initial.nPts, radius: initial.maxR, lever: initial.px - pivotX, maxAngle, first45, sleep, blocked, correction: result.motion.maxCorrection }));
  e.destroy();
}
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
