// Repro for the "stable acid-in-ice tub + acid boring stone elsewhere = super-linear
// lag" bug. A big inert ice tub costs ~nothing on its own, but while acid bores stone
// elsewhere the boring keeps the LAYER active every step, and the global grounding
// pass (indexComponents + reflood) re-scans the whole layer INCLUDING the untouched
// ice tub on every dissolve step -> cost grows with tub size.
//
// Measures per-step time for (a) ice tub alone, (b) boring stone alone, (c) both, over
// a range of tub sizes, and reports total grounding cost (getStepPerf().joint =
// groundingMs + crossLayerGroundingMs) which is the least noisy signal on a shared
// host. Run on the committed tree to see the blowup, and after the fix to see it
// shrink (esp. for a NARROW bore).
//
//   node scripts/acid-ice-lag-bench.mjs            (wide flat acid lake = worst case)
//   node scripts/acid-ice-lag-bench.mjs --narrow   (narrow dropped-blob bore = typical)
import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';

const COLS = 420, ROWS = 280, STEPS = 240, WARM = 60;
const NARROW = process.argv.includes('--narrow');
await initSandWasm();

const fresh = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 7, sinksOn: false, infinite: false });

function buildIceTub(e, side) {
  if (side <= 0) return;
  const x0 = 6, x1 = x0 + side - 1, y1 = ROWS - 3, y0 = y1 - side + 1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) e.placeMaterial(x, y, 0, MAT.ICE);
  const cx = (x0 + x1) >> 1; // a small carved hollow holding a little acid (settles inert in warmup)
  for (let y = y0 + 1; y <= y0 + 4; y++) for (let x = cx - 2; x <= cx + 2; x++) e.placeMaterial(x, y, 0, MAT.EMPTY);
  for (let x = cx - 2; x <= cx + 2; x++) e.placeMaterial(x, y0 + 2, 0, MAT.ACID);
}
const SX0 = 300, SX1 = 400, SY0 = 120, SY1 = 250;
function buildStoneSlab(e) { for (let y = SY0; y <= SY1; y++) for (let x = SX0; x <= SX1; x++) e.placeMaterial(x, y, 0, MAT.STONE); }
function dropAcid(e) {
  const y = SY0 - 4;
  if (NARROW) { const cx = (SX0 + SX1) >> 1; for (let x = cx - 3; x <= cx + 3; x++) e.placeMaterial(x, y, 0, MAT.ACID); }
  else for (let x = SX0 + 10; x <= SX1 - 10; x++) e.placeMaterial(x, y, 0, MAT.ACID);
}

function measure(build, boring) {
  const e = fresh();
  build(e);
  for (let i = 0; i < WARM; i++) e.step((i + 1) * 16);
  if (boring) dropAcid(e);
  const wall = [], ground = [], baseG = [], xlayerG = [], idx = [];
  let t = WARM * 16;
  for (let i = 0; i < STEPS; i++) {
    if (boring && i % 18 === 0) dropAcid(e);
    t += 16;
    const a = performance.now(); e.step(t); wall.push(performance.now() - a);
    const p = e.getStepPerf();
    // Total joint grounding (base floods + bond/UF); also track the fine split.
    ground.push(p.joint ?? ((p.groundingMs || 0) + (p.crossLayerGroundingMs || 0)));
    baseG.push(p.groundingMs ?? p.ground ?? 0);
    xlayerG.push(p.crossLayerGroundingMs ?? 0);
    idx.push(p.componentIndexMs ?? 0);
  }
  e.destroy();
  const sum = (arr) => arr.reduce((s, v) => s + v, 0);
  const sorted = [...wall].sort((x, y) => x - y);
  return {
    wallMedian: sorted[sorted.length >> 1],
    groundTot: sum(ground),
    groundMean: sum(ground) / STEPS,
    baseMean: sum(baseG) / STEPS,
    xlayerMean: sum(xlayerG) / STEPS,
    indexMean: sum(idx) / STEPS,
  };
}

const f = (x, n = 3) => x.toFixed(n);
console.log(`grid ${COLS}x${ROWS}, ${STEPS} steps (after ${WARM} warmup), front=${NARROW ? 'NARROW bore' : 'WIDE lake'}\n`);
console.log('side  scenario       wallMed  groundTot  groundMean  baseMean  xlayerMean  indexMean');
for (const side of [0, 60, 90, 120, 150]) {
  const a = side > 0 ? measure((e) => buildIceTub(e, side), false) : null;
  const b = measure((e) => buildStoneSlab(e), true);
  const c = measure((e) => { buildIceTub(e, side); buildStoneSlab(e); }, true);
  const row = (label, r) => console.log(
    `${String(side).padEnd(5)} ${label.padEnd(14)} ${f(r.wallMedian).padStart(7)}  ${f(r.groundTot).padStart(9)}  ${f(r.groundMean).padStart(10)}  ${f(r.baseMean).padStart(8)}  ${f(r.xlayerMean).padStart(10)}  ${f(r.indexMean).padStart(9)}`,
  );
  if (a) row('a:ice', a);
  row('b:stone', b);
  row('c:both', c);
  // The ice tub's grounding overhead while boring = c.groundMean - b.groundMean. If it
  // grows with side, that is the super-linear blowup; the fix keeps it ~flat (narrow).
  console.log(`        ice-tub ground overhead while boring = c-b = ${f(c.groundMean - b.groundMean)} ms/step\n`);
}
