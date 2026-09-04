import { performance } from 'node:perf_hooks';
import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { paintPerforatedPlate } from './sand-fixtures.mjs';
import { CREATIVE_KIND } from '../src/sand/wasmBridge/abi.generated.js';

export async function placement({ sizes = [40, 80], seed = 1, report }) {
  await initSandWasm();
  for (const size of sizes) {
    for (const moving of [false, true]) {
      const cols = size + 40, rows = size + 60;
      const engine = attachTestHooks(createEngineWasm({
        cols, rows, worldSeed: seed, sinksOn: false,
        infinite: false, storageRole: 'authority',
      }));
      try {
        report({ phase: 'fixture', size, moving });
        paintPerforatedPlate(engine, { size, anchored: !moving });
        engine.stepWorld();
        const bodiesBefore = engine._bodyCount();
        if (bodiesBefore !== (moving ? 1 : 0))
          throw new Error(`Unexpected fixture topology: ${bodiesBefore} bodies`);
        const idBefore = moving ? engine._bodyIdLayer(0, 0) : null;
        const tickBefore = engine.getTick();

        engine.setCreativeMaterial(CREATIVE_KIND.MATERIAL, MAT.TNT);
        const draftStarted = performance.now();
        let first = true;
        for (let y = 22; y < 18 + size; y += 3) {
          const endpoints = y % 2 ? [22, 17 + size] : [17 + size, 22];
          for (const x of endpoints) {
            if (first) {
              engine.pointerDown(x, y, 0);
              first = false;
            } else engine.pointerDraft(x, y);
          }
        }
        const draftMs = performance.now() - draftStarted;
        const draftCells = engine.getStoneDraftCells().length;
        report({ size, moving, draftCells, phase: 'release' });
        const releaseStarted = performance.now();
        engine.pointerUp(0);
        const releaseMs = performance.now() - releaseStarted;
        const bodiesAfter = engine._bodyCount();
        const idAfter = moving && bodiesAfter === 1 ? engine._bodyIdLayer(0, 0) : null;
        let tntCells = 0;
        for (const cell of engine.getGrid()) if (cell === MAT.TNT) tntCells++;
        if (bodiesAfter !== bodiesBefore || engine.getTick() !== tickBefore
            || tntCells !== draftCells)
          throw new Error('Placement changed the fixture topology, tick, or cell count unexpectedly.');
        if (moving && idAfter - idBefore !== 1)
          throw new Error('One placement gesture reconstructed the same body more than once.');
        report({
          size, moving, draftCells, tntCells, bodiesBefore, bodiesAfter,
          bodyReplacements: moving ? idAfter - idBefore : 0,
          draftMs, releaseMs,
        });
      } finally {
        engine.destroy();
      }
    }
  }
}

export async function aftermath({ steps = 92, seed = 1401181199, report }) {
  const COLS = 1024, ROWS = 768;
  await initSandWasm();
  const engine = attachTestHooks(createEngineWasm({
    cols: COLS, rows: ROWS, worldSeed: seed,
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
    report({ cols: COLS, rows: ROWS, seed, steps, phase: 'setup-complete' });
    for (let tick = 0; tick < steps; tick++) {
      for (let i = tick * 5; i < Math.min(sites.length, (tick + 1) * 5); i++) {
        report({ phase: 'detonate', tick, site: sites[i] });
        const start = performance.now();
        engine._detonateTnt(...sites[i]);
        const ms = performance.now() - start;
        if (ms > peakDetonation.ms) peakDetonation = { tick, site: sites[i], ms };
      }
      report({ phase: 'draft', tick });
      engine.pointerDraft(
        (COLS >> 1) + Math.round(80 * Math.sin(tick * 0.05)),
        top + Math.round(30 * Math.cos(tick * 0.08)),
      );
      report({ phase: 'step-actors', tick });
      engine.stepActors();
      report({ phase: 'step-world', tick });
      const start = performance.now();
      engine.stepWorld();
      const ms = performance.now() - start;
      if (ms > peakWorld.ms)
        peakWorld = { tick, ms, phases: engine.getStepPerf() };
      const bodyStates = [0, 1].map((layer) =>
        Array.from({ length: engine._bodyCountLayer(layer) }, (_, body) => ({
          id: engine._bodyIdLayer(layer, body),
          awake: engine._bodyAwakeLayer(layer, body),
          role: engine._bodyJointRoleLayer(layer, body),
          ...engine._bodyStateLayer(layer, body),
        })));
      report({ tick, worldMs: ms, peakWorldMs: peakWorld.ms,
        gridHash: engine.gridHash(), bodyStates });
    }
    report({
      peakWorld, peakDetonation,
      tick: engine.getTick(), draftCells: engine.getStoneDraftCells().length,
      bodies: engine._bodyCountLayer(0) + engine._bodyCountLayer(1),
    });
  } finally {
    engine.destroy();
  }
}
