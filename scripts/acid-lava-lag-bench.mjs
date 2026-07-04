// Repro for "dropping acid into lava is extremely expensive".
// A pool of LAVA quenched by falling ACID hardens to STONE every step. Each harden
// batch calls registerRigidCells -> groundDirty=true -> a FULL grounding reflood on
// the next step, and rebuilds the stone owner-map over the growing stone mass. As the
// stone island grows the per-step cost climbs.
//
//   node scripts/acid-lava-lag-bench.mjs
import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';

const COLS = 420, ROWS = 280, STEPS = 300, WARM = 40;
const QUENCHER = process.argv.includes('--water') ? MAT.WATER : MAT.ACID;
const TRACE = process.argv.includes('--trace');
await initSandWasm();

const fresh = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 7, sinksOn: false, infinite: false });

// A wide lava lake sitting in a stone basin.
const LX0 = 60, LX1 = 360, LY0 = 170, LY1 = 250;
function buildLavaLake(e) {
  for (let y = LY0; y <= LY1 + 6; y++) { // basin walls + floor
    for (let x = LX0 - 4; x <= LX1 + 4; x++) {
      const wall = x < LX0 || x > LX1 || y > LY1;
      if (wall) e.placeMaterial(x, y, 0, MAT.STONE);
    }
  }
  for (let y = LY0; y <= LY1; y++) for (let x = LX0; x <= LX1; x++) e.placeMaterial(x, y, 0, MAT.LAVA);
}
function dropAcid(e) {
  const y = LY0 - 6;
  for (let x = LX0 + 10; x <= LX1 - 10; x += 3) e.placeMaterial(x, y, 0, QUENCHER);
}

function measure(withAcid) {
  const e = fresh();
  buildLavaLake(e);
  for (let i = 0; i < WARM; i++) e.step((i + 1) * 16);
  const wall = [], ground = [], react = [];
  let t = WARM * 16, worstStep = -1, worst = 0, worstP = null;
  for (let i = 0; i < STEPS; i++) {
    if (withAcid && i % 8 === 0) dropAcid(e);
    t += 16;
    const a = performance.now(); e.step(t); const dt = performance.now() - a; wall.push(dt);
    const p = e.getStepPerf();
    ground.push(p.ground); react.push(p.react);
    if (withAcid && dt > worst) { worst = dt; worstStep = i; worstP = p; }
    if (withAcid && TRACE && dt > 30) console.log(`  step ${i}: ${f(dt)}ms rigid=${f(p.rigid)} react=${f(p.react)} ground=${f(p.ground)}`);
  }
  if (withAcid && worstP) console.log(`  worst step ${worstStep}: ${f(worst)}ms  ground=${f(worstP.ground)} rigid=${f(worstP.rigid)} react=${f(worstP.react)} carry=${f(worstP.carry)} settle=${f(worstP.settle)} tail=${f(worstP.tail)} joint=${f(worstP.joint)} layers=${f(worstP.layers)} cross=${f(worstP.cross)}`);
  e.destroy();
  const sum = (arr) => arr.reduce((s, v) => s + v, 0);
  const sorted = [...wall].sort((x, y) => x - y);
  const half = (arr) => { const s = sum(arr.slice(arr.length >> 1)); return s; };
  return {
    wallMedian: sorted[sorted.length >> 1],
    wallMax: sorted[sorted.length - 1],
    groundTot: sum(ground), reactTot: sum(react),
    groundLateHalf: half(ground), // sum over 2nd half of run (island grown)
    wallTot: sum(wall),
  };
}

const f = (x, n = 2) => x.toFixed(n);
console.log(`grid ${COLS}x${ROWS}, ${STEPS} steps (after ${WARM} warmup)\n`);
const idle = measure(false);
const acid = measure(true);
console.log('scenario     wallMed  wallMax  wallTot  groundTot  groundLate½  reactTot');
const row = (label, r) => console.log(`${label.padEnd(12)} ${f(r.wallMedian).padStart(7)} ${f(r.wallMax).padStart(8)} ${f(r.wallTot).padStart(8)} ${f(r.groundTot).padStart(10)} ${f(r.groundLateHalf).padStart(11)} ${f(r.reactTot).padStart(9)}`);
row('idle lava', idle);
row('acid+lava', acid);
console.log(`\nacid overhead: wallTot +${f(acid.wallTot - idle.wallTot)}ms, groundTot +${f(acid.groundTot - idle.groundTot)}ms`);
