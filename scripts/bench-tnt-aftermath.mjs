// Script broad TNT cuts through procedural terrain while a new draft stays held.
// Usage: node scripts/bench-tnt-aftermath.mjs
// Reports detonation and world-step time separately; this fixture can take a minute.
import { performance } from 'node:perf_hooks';
import {
  initSandWasm, createEngineWasm, MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { CREATIVE_KIND } from '../src/sand/wasmBridge/abi.generated.js';

const COLS = 1024, ROWS = 768, SEED = 1401181199, STEPS = 92;
await initSandWasm();
const engine = attachTestHooks(createEngineWasm({
  cols: COLS, rows: ROWS, worldSeed: SEED,
  sinksOn: false, infinite: true, storageRole: 'authority',
}));
try {
  engine.setBgEnabled(true);
  const left = Math.round(COLS * 0.13), right = COLS - left;
  const top = Math.max(144, Math.round(ROWS * 0.31)), bottom = ROWS - 112;
  const sites = [];
  const line = (x0, y0, x1, y1) => {
    const count = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 7);
    for (let i = 0; i <= count; i++)
      sites.push([
        Math.round(x0 + (x1 - x0) * i / count),
        Math.round(y0 + (y1 - y0) * i / count),
      ]);
  };
  line(left, top, right, top);
  line(right, top, right, bottom);
  line(right, bottom, left, bottom);
  line(left, bottom, left, top);
  line(left, top, right, bottom);
  line(right, top, left, bottom);
  for (const [x, y] of sites) engine.paintDiscLayer(0, x, y, 2, MAT.TNT, false);

  engine.setCreativeMaterial(CREATIVE_KIND.MATERIAL, MAT.TNT);
  engine.pointerDown(COLS >> 1, top, 0);
  let peakWorld = { ms: 0 }, peakDetonation = { ms: 0 };
  console.log(JSON.stringify({ cols: COLS, rows: ROWS, seed: SEED, steps: STEPS }));
  for (let tick = 0; tick < STEPS; tick++) {
    for (let i = tick * 5; i < Math.min(sites.length, (tick + 1) * 5); i++) {
      const start = performance.now();
      engine._detonateTnt(...sites[i]);
      const ms = performance.now() - start;
      if (ms > peakDetonation.ms) peakDetonation = { tick, site: sites[i], ms };
    }
    engine.pointerDraft(
      (COLS >> 1) + Math.round(80 * Math.sin(tick * 0.05)),
      top + Math.round(30 * Math.cos(tick * 0.08)),
    );
    engine.stepActors();
    const start = performance.now();
    engine.stepWorld();
    const ms = performance.now() - start;
    if (ms > peakWorld.ms)
      peakWorld = { tick, ms, phases: engine.getStepPerf() };
    if (tick % 10 === 0)
      console.log(JSON.stringify({ tick, worldMs: ms, peakWorldMs: peakWorld.ms }));
  }
  console.log(JSON.stringify({
    peakWorld, peakDetonation,
    tick: engine.getTick(), draftCells: engine.getStoneDraftCells().length,
    bodies: engine._bodyCountLayer(0) + engine._bodyCountLayer(1),
  }));
} finally {
  engine.destroy();
}
