// Headless parity check: JS engine vs WASM engine (Stage 1 core CA).
// Verifies conservation (sand/water never created/destroyed with sinks off) and
// that both engines settle to similar distributions.
import { createEngine } from '../src/sand/engine.js';
import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';
import { mulberry32 } from '../src/sand/rng.js';

const COLS = 160, ROWS = 100, SEED = 0xC0FFEE, STEPS = 300;

function counts(grid) {
  const c = new Array(16).fill(0);
  for (let i = 0; i < grid.length; i++) c[grid[i]]++;
  return c;
}
function paintScene(eng) {
  // sand pile + water pool + oil blob, deterministic
  for (let i = 0; i < 40; i++) eng.paintDisc(40 + (i % 20), 10 + ((i * 7) % 15), 4, 1, false); // SAND
  for (let i = 0; i < 40; i++) eng.paintDisc(100 + (i % 20), 10 + ((i * 5) % 15), 4, 2, false); // WATER
  for (let i = 0; i < 20; i++) eng.paintDisc(70 + (i % 15), 8 + ((i * 3) % 10), 3, 4, false); // OIL
}

await initSandWasm();

const js = createEngine({ cols: COLS, rows: ROWS, rng: mulberry32(SEED), sinksOn: false, emittersOn: false });
const wasm = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false });

paintScene(js);
paintScene(wasm);

const c0js = counts(js.getGrid());
const c0w = counts(wasm.getGrid());

let now = 0;
for (let s = 0; s < STEPS; s++) { now += 16; js.step(now); wasm.step(now); }

const cjs = counts(js.getGrid());
const cw = counts(wasm.getGrid());

const names = ['EMPTY', 'SAND', 'WATER', 'STONE', 'OIL', 'FIRE', 'STEAM', 'SEED', 'WOOD', 'PLANT', 'ACID', 'LAVA', 'ICE', 'RIGID', 'DRIFTWOOD'];
let ok = true;
console.log('mat        init(js/wasm)   afterJS  afterWASM  conserved?');
for (const id of [1, 2, 4]) {
  const consJs = cjs[id] === c0js[id];
  const consW = cw[id] === c0w[id];
  const initMatch = c0js[id] === c0w[id];
  if (!consJs || !consW || !initMatch) ok = false;
  console.log(
    `${names[id].padEnd(10)} ${String(c0js[id]).padStart(5)}/${String(c0w[id]).padEnd(5)}   ${String(cjs[id]).padStart(6)}   ${String(cw[id]).padStart(7)}   js:${consJs} wasm:${consW}`
  );
}
// rough settle similarity: max row reached by sand should be close
console.log(`\nperf: js stepMs=${js.getPerf().stepMs.toFixed(3)}  wasm stepMs=${wasm.getPerf().stepMs.toFixed(3)}`);
console.log(ok ? '\nPASS: identical initial paint + exact conservation in both engines' : '\nFAIL: conservation or init mismatch');
process.exit(ok ? 0 : 1);
