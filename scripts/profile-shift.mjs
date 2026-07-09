// Throwaway profiler: where does shiftWorld's cost go? Sweep the shift width and
// buffer size. If cost scales with shift width -> it's the band (fillBand /
// memcpy); if it's ~flat in width -> it's fixed machinery (buffer memmove +
// component re-registration) that a smaller SHIFT_COLS won't help.
import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
const now = () => performance.now();
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

await initSandWasm();

const measure = (cols, rows, dx, reps = 24) => {
  const e = createEngineWasm({ cols, rows, worldSeed: 0xC0FFEE, sinksOn: false, infinite: true });
  for (let i = 0; i < 60; i++) e.step();
  // warm: generate terrain both directions first so we can sample miss then hit
  const miss = [], hit = [];
  for (let k = 0; k < reps; k++) { let t = now(); e.shiftWorld(dx); miss.push(now() - t); for (let i = 0; i < 2; i++) e.step(); }
  for (let k = 0; k < reps; k++) { let t = now(); e.shiftWorld(-dx); hit.push(now() - t); for (let i = 0; i < 2; i++) e.step(); }
  e.destroy();
  return { miss: +med(miss).toFixed(3), hit: +med(hit).toFixed(3) };
};

console.log('shiftWorld phase breakdown (cols=768 rows=320, dx=128, median over 20):');
{
  const e = createEngineWasm({ cols: 768, rows: 320, worldSeed: 0xC0FFEE, sinksOn: false, infinite: true });
  for (let i = 0; i < 60; i++) e.step();
  const ph = { buffers: [], translate: [], register: [], fill: [], total: [] };
  for (let k = 0; k < 20; k++) {
    const t = now(); e.shiftWorld(k % 2 ? -128 : 128); ph.total.push(now() - t);
    const p = e.getShiftPerf(); ph.buffers.push(p.buffers); ph.translate.push(p.translate); ph.register.push(p.register); ph.fill.push(p.fill);
    for (let i = 0; i < 2; i++) e.step();
  }
  for (const k of ['buffers', 'translate', 'register', 'fill', 'total']) console.log(`  ${k}: ${med(ph[k]).toFixed(3)}`);
  e.destroy();
}

console.log('shiftWorld median ms by shift width (cols=768 rows=320):');
for (const dx of [32, 64, 128, 256]) {
  const r = measure(768, 320, dx);
  console.log(`  dx=${dx}: miss ${r.miss}  hit ${r.hit}  (per-col miss ${(r.miss / dx).toFixed(4)})`);
}
console.log('shiftWorld median ms by buffer rows (dx=128 cols=768):');
for (const rows of [160, 320, 640]) {
  const r = measure(768, rows, 128);
  console.log(`  rows=${rows}: miss ${r.miss}  hit ${r.hit}`);
}
console.log('step median ms at rest vs after big paint (cols=768 rows=320):');
{
  const e = createEngineWasm({ cols: 768, rows: 320, worldSeed: 0xC0FFEE, sinksOn: false, infinite: true });
  for (let i = 0; i < 200; i++) e.step(); // let it settle
  const rest = []; for (let i = 0; i < 30; i++) { e.step(); rest.push(e.getPerf().stepMs); }
  for (let i = 0; i < 80; i++) e.paintDisc(100 + (i % 50) * 10, 30, 6, 1, false);
  const active = []; for (let i = 0; i < 30; i++) { e.step(); active.push(e.getPerf().stepMs); }
  console.log(`  rest ${med(rest).toFixed(3)}  active ${med(active).toFixed(3)}`);
  e.destroy();
}
const FINE = [
  'groundingMs', 'crossLayerGroundingMs', 'componentIndexMs',
  'assemblyUnionMs', 'carryMs', 'bodyMs',
  'sandMs', 'liquidMs', 'gasMs',
  'reactMs', 'tailMs', 'layersMs', 'crossMs',
];
const sampleStepPhases = (e, n = 30) => {
  const ph = Object.fromEntries([...FINE, 'joint', 'settle', 'rigid', 'total'].map((k) => [k, []]));
  for (let i = 0; i < n; i++) {
    e.step();
    const p = e.getStepPerf();
    const perf = e.getPerf();
    for (const k of FINE) ph[k].push(p[k] ?? 0);
    ph.joint.push(p.joint); ph.settle.push(p.settle); ph.rigid.push(p.rigid);
    ph.total.push(perf.stepMs);
  }
  return ph;
};
console.log('step phase breakdown at rest (cols=768 rows=320, median over 30):');
{
  const e = createEngineWasm({ cols: 768, rows: 320, worldSeed: 0xC0FFEE, sinksOn: false, infinite: true });
  for (let i = 0; i < 200; i++) e.step();
  const ph = sampleStepPhases(e);
  for (const k of [...FINE, 'joint', 'settle', 'rigid', 'total']) console.log(`  ${k}: ${med(ph[k]).toFixed(3)}`);
  e.destroy();
}
console.log('step phase breakdown after big paint (cols=768 rows=320, median over 30):');
{
  const e = createEngineWasm({ cols: 768, rows: 320, worldSeed: 0xC0FFEE, sinksOn: false, infinite: true });
  for (let i = 0; i < 200; i++) e.step();
  for (let i = 0; i < 80; i++) e.paintDisc(100 + (i % 50) * 10, 30, 6, 1, false);
  const ph = sampleStepPhases(e);
  for (const k of [...FINE, 'joint', 'settle', 'rigid', 'total']) console.log(`  ${k}: ${med(ph[k]).toFixed(3)}`);
  const perf = (() => { e.step(); return e.getPerf(); })();
  console.log(`  volume: dirtyChunks ${perf.dirtyChunks} dirtyRows ${perf.dirtyRows} dirtyCells ${perf.dirtyCells} comps ${perf.componentCount} compCells ${perf.componentCellCount} xBonds ${perf.crossBondCount}`);
  e.destroy();
}
