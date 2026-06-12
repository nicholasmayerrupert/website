// Deterministic benchmark for the falling-sand engine (src/sand/engine.js).
//
// Usage:
//   node scripts/bench-sand.mjs                         # run all scenarios, print table
//   node scripts/bench-sand.mjs --json bench/baseline.json
//   node scripts/bench-sand.mjs --compare bench/baseline.json
//   node scripts/bench-sand.mjs --scenario water-heavy --size 240x120
//   node scripts/bench-sand.mjs --rng math              # Math.random (no checksums)
//   node scripts/bench-sand.mjs --seed 3735928559
//
// Methodology: each scenario×size runs twice with identical seeds — once
// unmeasured to warm the JIT, once measured. The simulated clock is
// tick*16ms so emitter timing is deterministic.

import { createEngine, MAT } from '../src/sand/engine.js';
import { makeColorLUT, fillPixelSpan } from '../src/sand/renderCore.js';
import { mulberry32, hashGrid } from '../src/sand/rng.js';
import fs from 'node:fs';
import path from 'node:path';

const MAT_NAMES = Object.fromEntries(Object.entries(MAT).map(([k, v]) => [v, k]));

// ---------- scenarios ----------
// Every action is keyed to exact tick numbers; positions derive from cols/rows.

const scenarios = [
  {
    name: 'settle',
    steps: 600,
    seedInitial: true,
    setup() {},
    onTick() {},
  },
  {
    name: 'water-heavy',
    steps: 600,
    seedInitial: true,
    setup() {},
    onTick(eng, tick) {
      const { cols } = eng;
      eng.paintDisc((cols * 0.25) | 0, 5, 2, MAT.WATER, false);
      eng.paintDisc((cols * 0.50) | 0, 5, 2, MAT.WATER, false);
      eng.paintDisc((cols * 0.75) | 0, 5, 2, MAT.WATER, false);
    },
  },
  {
    name: 'sand-water',
    steps: 600,
    seedInitial: true,
    setup(eng) {
      const { cols, rows } = eng;
      const top = (rows * 0.7) | 0;
      for (let y = top; y < rows - 1; y += 2) {
        for (let x = 2; x < cols - 2; x += 2) {
          eng.paintDisc(x, y, 1, MAT.WATER, true);
        }
      }
    },
    onTick(eng, tick) {
      if (tick % 2 === 0) eng.paintDisc((eng.cols * 0.5) | 0, 5, 2, MAT.SAND, false);
    },
  },
  {
    name: 'oil-fire-steam',
    steps: 900,
    seedInitial: true,
    setup(eng) {
      const { cols, rows } = eng;
      const waterTop = (rows * 0.8) | 0;
      const oilTop = (rows * 0.7) | 0;
      for (let y = waterTop; y < rows - 1; y += 2) {
        for (let x = 2; x < cols - 2; x += 2) {
          eng.paintDisc(x, y, 1, MAT.WATER, true);
        }
      }
      for (let y = oilTop; y < waterTop; y += 2) {
        for (let x = 2; x < cols - 2; x += 2) {
          eng.paintDisc(x, y, 1, MAT.OIL, true);
        }
      }
    },
    onTick(eng, tick) {
      const { cols, rows } = eng;
      if (tick === 60) {
        const y = ((rows * 0.7) | 0) - 1;
        eng.paintDisc((cols * 0.3) | 0, y, 1, MAT.FIRE, true);
        eng.paintDisc((cols * 0.6) | 0, y, 1, MAT.FIRE, true);
      }
      if (tick % 3 === 0) eng.paintDisc((cols * 0.45) | 0, 4, 1, MAT.OIL, false);
    },
  },
  {
    name: 'dense-chaos',
    steps: 600,
    seedInitial: false,
    setup(eng) {
      const { cols, rows } = eng;
      const top = (rows * 0.3) | 0;
      const mats = [MAT.SAND, MAT.WATER, MAT.OIL];
      for (let y = top; y < rows - 1; y += 2) {
        for (let x = 2; x < cols - 2; x += 2) {
          const band = ((x / 12) | 0) % 3;
          eng.paintDisc(x, y, 1, mats[band], true);
        }
      }
      for (let i = 0; i < 4; i++) {
        const cx = ((cols * (i + 1)) / 5) | 0;
        const cy = (rows * 0.15) | 0;
        eng.addDiscToStoneDraft(cx, cy, 3);
        eng.addDiscToStoneDraft(cx + 3, cy, 3);
        eng.finalizeStoneDraft();
        eng.clearStoneDraft();
      }
    },
    onTick(eng, tick) {
      const { cols, rows } = eng;
      if (tick === 30) {
        eng.paintDisc((cols * 0.4) | 0, (rows * 0.35) | 0, 1, MAT.FIRE, true);
        eng.paintDisc((cols * 0.7) | 0, (rows * 0.5) | 0, 1, MAT.FIRE, true);
      }
    },
  },
  {
    name: 'plant-growth',
    steps: 1800,
    seedInitial: false,
    setup(eng) {
      const { cols, rows } = eng;
      const bedTop = (rows * 0.85) | 0;
      for (let y = bedTop; y < rows - 1; y += 2) {
        for (let x = 2; x < cols - 2; x += 2) {
          eng.paintDisc(x, y, 1, MAT.SAND, true);
        }
      }
      for (const fx of [0.25, 0.5, 0.75]) {
        eng.placeSeedAt(((cols * fx) | 0), bedTop - 4);
      }
    },
    onTick(eng, tick) {
      if (tick % 4 !== 0) return;
      const { cols, rows } = eng;
      const y = ((rows * 0.85) | 0) - 10;
      for (const fx of [0.25, 0.5, 0.75]) {
        eng.paintDisc(((cols * fx) | 0) + 4, y, 1, MAT.WATER, false);
      }
    },
  },
];

// ---------- measurement ----------

function fnv1aStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function makeRng(kind, seed, scenarioName) {
  if (kind === 'math') return Math.random;
  return mulberry32((seed ^ fnv1aStr(scenarioName)) >>> 0);
}

function runScenario(scenario, cols, rows, rngKind, seed, { measure }) {
  const eng = createEngine({
    cols,
    rows,
    rng: makeRng(rngKind, seed, scenario.name),
    seedInitial: scenario.seedInitial,
  });
  scenario.setup(eng);
  const times = measure ? new Float64Array(scenario.steps) : null;
  for (let tick = 0; tick < scenario.steps; tick++) {
    scenario.onTick(eng, tick);
    if (measure) {
      const t0 = performance.now();
      eng.step(tick * 16);
      times[tick] = performance.now() - t0;
    } else {
      eng.step(tick * 16);
    }
  }
  return { eng, times };
}

function stats(times) {
  const sorted = Float64Array.from(times).sort();
  const sum = times.reduce((a, b) => a + b, 0);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return {
    steps: times.length,
    avgMs: sum / times.length,
    p50Ms: pick(0.5),
    p95Ms: pick(0.95),
    maxMs: sorted[sorted.length - 1],
    stepsPerSec: 1000 / (sum / times.length),
  };
}

function materialCounts(grid) {
  const counts = {};
  for (let i = 0; i < grid.length; i++) {
    const m = grid[i];
    if (m === MAT.EMPTY) continue;
    const name = MAT_NAMES[m] || String(m);
    counts[name] = (counts[name] || 0) + 1;
  }
  return counts;
}

// ---------- CLI ----------

const args = process.argv.slice(2);
const getFlag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

const jsonOut = getFlag('json');
const comparePath = getFlag('compare');
const onlyScenario = getFlag('scenario');
const onlySize = getFlag('size');
const seed = Number(getFlag('seed') ?? 0xdeadbeef) >>> 0;
const rngKind = getFlag('rng') ?? 'mulberry';

const sizes = onlySize
  ? [onlySize.split('x').map(Number)]
  : [[240, 120], [384, 216]];

const selected = scenarios.filter(s => !onlyScenario || s.name === onlyScenario);
if (selected.length === 0) {
  console.error(`Unknown scenario "${onlyScenario}". Available: ${scenarios.map(s => s.name).join(', ')}`);
  process.exit(1);
}

const results = [];
for (const [cols, rows] of sizes) {
  for (const scenario of selected) {
    // Warmup run (same seed), then measured run on a fresh engine.
    runScenario(scenario, cols, rows, rngKind, seed, { measure: false });
    const { eng, times } = runScenario(scenario, cols, rows, rngKind, seed, { measure: true });
    const grid = eng.getGrid();
    // Full-grid pixel fill cost (the CPU part of rendering).
    const pixels = new Uint32Array(cols * rows);
    const lut = makeColorLUT();
    const fillRng = makeRng(rngKind, seed, `${scenario.name}-fill`);
    for (let i = 0; i < 20; i++) fillPixelSpan(pixels, grid, cols, 0, 0, cols - 1, rows - 1, lut, fillRng);
    const fillT0 = performance.now();
    for (let i = 0; i < 100; i++) fillPixelSpan(pixels, grid, cols, 0, 0, cols - 1, rows - 1, lut, fillRng);
    const renderFillMs = (performance.now() - fillT0) / 100;
    const result = {
      scenario: scenario.name,
      size: `${cols}x${rows}`,
      ...stats(times),
      renderFillMs,
      checksum: rngKind === 'mulberry' ? hashGrid(grid) : null,
      counts: materialCounts(grid),
    };
    results.push(result);
    const r = result;
    console.log(
      `${r.scenario.padEnd(16)} ${r.size.padEnd(9)} ` +
      `avg ${r.avgMs.toFixed(3)}ms  p50 ${r.p50Ms.toFixed(3)}ms  p95 ${r.p95Ms.toFixed(3)}ms  ` +
      `max ${r.maxMs.toFixed(3)}ms  fill ${r.renderFillMs.toFixed(3)}ms  ${r.checksum ? `hash ${r.checksum}` : '(math rng)'}`
    );
  }
}

if (jsonOut) {
  const payload = {
    meta: {
      date: new Date().toISOString(),
      node: process.version,
      seed,
      rng: rngKind,
    },
    results,
  };
  fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
  fs.writeFileSync(jsonOut, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${jsonOut}`);
}

if (comparePath) {
  const base = JSON.parse(fs.readFileSync(comparePath, 'utf8'));
  console.log(`\n=== Comparison vs ${comparePath} (recorded ${base.meta.date}) ===`);
  let checksumMismatch = false;
  for (const r of results) {
    const b = base.results.find(x => x.scenario === r.scenario && x.size === r.size);
    if (!b) { console.log(`${r.scenario} ${r.size}: no baseline entry`); continue; }
    const d = (cur, prev) => `${(((cur - prev) / prev) * 100).toFixed(1)}%`;
    const hashNote = r.checksum && b.checksum
      ? (r.checksum === b.checksum ? 'hash OK' : `HASH MISMATCH (${b.checksum} -> ${r.checksum})`)
      : 'hash n/a';
    if (r.checksum && b.checksum && r.checksum !== b.checksum) checksumMismatch = true;
    console.log(
      `${r.scenario.padEnd(16)} ${r.size.padEnd(9)} ` +
      `avg ${r.avgMs.toFixed(3)}ms (${d(r.avgMs, b.avgMs)})  ` +
      `p95 ${r.p95Ms.toFixed(3)}ms (${d(r.p95Ms, b.p95Ms)})  ` +
      `max ${r.maxMs.toFixed(3)}ms (${d(r.maxMs, b.maxMs)})  ${hashNote}`
    );
  }
  if (checksumMismatch) {
    console.log('\nNote: checksum mismatches are expected for rng-stream-changing optimizations;');
    console.log('they MUST match for pure refactors.');
  }
}
