// Spawns many irregular hand-drawn bodies (bars, L/T/U hooks, discs, blobs) that
// fall and pile up, then reports rigid-body and total step timing.

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));

const COLS = 240, ROWS = 180, SEED = 0xBEEF, STONE = 3;
await initSandWasm();
const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false });

const stoneRect = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) e.paintDisc(x, y, 0, STONE, true); };
// container: floor + side walls so bodies pile up and keep touching each other
stoneRect(0, ROWS - 3, COLS - 1, ROWS - 1);
stoneRect(20, ROWS - 60, 22, ROWS - 4);
stoneRect(COLS - 23, ROWS - 60, COLS - 21, ROWS - 4);
e.syncComponents();

// Deterministic LCG so the scene is reproducible run-to-run.
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ri = (a, b) => a + ((rnd() * (b - a + 1)) | 0);

function irregular(cx, cy) {
  const cells = new Set();
  const add = (x, y) => cells.add(`${x},${y}`);
  const kind = ri(0, 4);
  if (kind === 0) { const n = ri(10, 24); for (let i = 0; i < n; i++) add(cx + i, cy); }              // h-bar
  else if (kind === 1) { const n = ri(10, 24); for (let i = 0; i < n; i++) add(cx, cy + i); }           // v-bar
  else if (kind === 2) { const n = ri(8, 16); for (let i = 0; i < n; i++) { add(cx, cy + i); add(cx + i, cy + n - 1); } } // L
  else if (kind === 3) { const r = ri(4, 7); for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) add(cx + dx, cy + dy); } // disc
  else { const w = ri(6, 12), h = ri(4, 9); for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (rnd() > 0.25) add(cx + dx, cy + dy); } // blob
  return [...cells].map((s) => s.split(',').map(Number));
}

const N = 60;
let spawned = 0;
const steps = 700;
const rigidMs = [], assemblyMs = [], bodyMs = [], stepMs = [];
let t = 0;
const t0 = Date.now();
for (let i = 0; i < steps; i++) {
  // trickle bodies in over the first half so they keep colliding as they pile
  if (spawned < N && i % 6 === 0) { const cells = irregular(ri(30, COLS - 40), ri(8, 30)); if (cells.length) { e.spawnBody(cells); spawned++; } }
  t += 16;
  e.step(t);
  const p = e.getStepPerf();
  rigidMs.push(p.rigid);
  assemblyMs.push(p.assemblyUnionMs ?? 0);
  bodyMs.push(p.bodyMs ?? 0);
  stepMs.push(e.getPerf().stepMs);
}
const wall = Date.now() - t0;

const sort = (a) => [...a].sort((x, y) => x - y);
const pct = (s, q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
const sum = (a) => a.reduce((x, y) => x + y, 0);
const report = (label, arr) => {
  const s = sort(arr);
  console.log(`${label.padEnd(14)}: p50 ${pct(s, 0.5).toFixed(3)}  p95 ${pct(s, 0.95).toFixed(3)}  max ${s[s.length - 1].toFixed(3)}  mean ${(sum(s) / s.length).toFixed(3)}`);
};
console.log(`bodies spawned : ${spawned}, alive ${e._bodyCount()}`);
console.log(`steps          : ${steps}`);
report('rigid ms', rigidMs);
report('  assembly', assemblyMs);
report('  body', bodyMs);
report('step wall', stepMs);
console.log(`total rigid ms : ${sum(rigidMs).toFixed(1)}`);
console.log(`wall clock     : ${wall} ms (${(wall / steps).toFixed(3)} ms/step incl. world)`);
e.destroy();
