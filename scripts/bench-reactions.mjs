// Deterministic 1000x1000 stress benchmark for the two reaction paths that most
// often create structural work: fire consuming plant components and acid boring
// generated terrain. Injection happens outside the timed engine step.

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { MAT_FLAGS, MF } from '../src/sand/materials.generated.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const cols = Math.max(64, Number(flag('--cols', 1000)) | 0);
const rows = Math.max(64, Number(flag('--rows', 1000)) | 0);
const steps = Math.max(30, Number(flag('--steps', 180)) | 0);
const selected = flag('--case', 'all');
const cases = selected === 'all' ? ['fire', 'acid'] : [selected];
const materialFlags = MAT_FLAGS;

const pct = (values, p) => {
  const a = [...values].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * p))] || 0;
};
const checksum = (grid) => {
  let h = 0x811c9dc5;
  for (const m of grid) { h ^= m; h = Math.imul(h, 0x01000193); }
  return `0x${(h >>> 0).toString(16).padStart(8, '0')}`;
};

await initSandWasm();

function injectAtInterfaces(e, kind, phase, cap = 600) {
  const grid = e.getGrid();
  const sourceFlag = kind === 'fire' ? MF.flammable : MF.dissolvable;
  const injected = kind === 'fire' ? MAT.FIRE : MAT.ACID;
  let count = 0;
  // Rotate the scan origin so replenishment follows a moving reaction front.
  const yStart = 2 + (phase * 97) % Math.max(1, rows - 4);
  for (let yo = 0; yo < rows - 4 && count < cap; yo++) {
    const y = 2 + ((yStart - 2 + yo) % (rows - 4));
    const rb = y * cols;
    for (let x = 2 + ((phase * 53 + y * 7) % 11); x < cols - 2 && count < cap; x += 11) {
      const k = rb + x;
      if (grid[k] !== MAT.EMPTY) continue;
      const neighbors = [k - 1, k + 1, k - cols, k + cols];
      if (!neighbors.some((q) => (materialFlags[grid[q]] & sourceFlag) !== 0)) continue;
      if (e.paintDisc(x, y, 0, injected, false)) count++;
    }
  }
  return count;
}

function run(kind) {
  const e = createEngineWasm({ cols, rows, worldSeed: 0xC0FFEE, sinksOn: false, infinite: true });
  let injected = injectAtInterfaces(e, kind, 0, 1200);
  const stepMs = [], reactMs = [], groundMs = [], jointMs = [], dirtyCells = [];
  const phaseKeys = ['componentIndexMs', 'carryMs', 'sandMs', 'liquidMs', 'gasMs', 'tailMs', 'layersMs', 'crossMs'];
  const phaseSamples = Object.fromEntries(phaseKeys.map((key) => [key, []]));
  for (let i = 0; i < steps; i++) {
    if (i > 0 && i % 12 === 0) injected += injectAtInterfaces(e, kind, i / 12, 600);
    e.stepWorld();
    const perf = e.getPerf(), phases = e.getStepPerf();
    stepMs.push(perf.stepMs); reactMs.push(phases.reactMs); groundMs.push(phases.groundingMs);
    jointMs.push(phases.crossLayerGroundingMs); dirtyCells.push(perf.dirtyCells);
    for (const key of phaseKeys) phaseSamples[key].push(phases[key]);
  }
  const result = {
    case: kind, size: `${cols}x${rows}`, injected, checksum: checksum(e.getGrid()),
    step: { p50: pct(stepMs, 0.5), p95: pct(stepMs, 0.95), max: Math.max(...stepMs) },
    react: { p50: pct(reactMs, 0.5), p95: pct(reactMs, 0.95) },
    grounding: { p50: pct(groundMs, 0.5), p95: pct(groundMs, 0.95) },
    joint: { p50: pct(jointMs, 0.5), p95: pct(jointMs, 0.95) },
    phases: Object.fromEntries(phaseKeys.map((key) => [key, { p50: pct(phaseSamples[key], 0.5), p95: pct(phaseSamples[key], 0.95) }])),
    dirtyCells: { p50: pct(dirtyCells, 0.5), p95: pct(dirtyCells, 0.95) },
  };
  console.log(JSON.stringify(result, null, 2));
  e.destroy();
}

for (const kind of cases) run(kind);
