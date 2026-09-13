import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import createModule from '../src/sand3d/wasm/voxelDemo.js';

const engine = await createModule({ wasmBinary: readFileSync('src/sand3d/wasm/voxelDemo.wasm') });
const snapshot = () => Array.from(engine.HEAPF32.subarray(engine._demo_stats() / 4, engine._demo_stats() / 4 + 17));
const step = n => { for (let i = 0; i < n; ++i) engine._demo_step(1 / 60); };
assert.equal(engine._demo_create(0), 1);
try {
  const initial = snapshot();
  assert.ok(initial[4] > 100, 'the scene starts with loose sand');
  const initialZ = initial[7];
  engine._demo_key(0, 1); step(30); engine._demo_clear_input();
  assert.ok(snapshot()[7] < initialZ - 4, 'W moves the camera forward');
  engine._demo_reset();

  // Both gantry supports must be cut before the stone span is disconnected.
  engine._demo_brush(3.5); engine._demo_tool(0);
  for (const x of [25, 39]) {
    engine._demo_camera(x, 10, 35, 0, 0);
    engine._demo_use();
  }
  const detached = snapshot();
  assert.ok(detached[3] > 0, 'mining removes actual material');
  assert.ok(detached[1] > 0, 'unsupported material creates Box3D bodies');
  assert.ok(detached[11] > 100, 'the detached body retains its voxels');
  const originalBodyY = detached[12];
  const times = [];
  for (let i = 0; i < 240; ++i) {
    const start = performance.now(); step(1); times.push(performance.now() - start);
  }
  const resting = snapshot();
  assert.ok(resting[12] < originalBodyY - 2, 'Box3D gravity moves the detached span');
  assert.ok(resting[12] > 5, 'terrain collision holds the span above the quarry floor');
  assert.equal(resting[11], detached[11], 'physics preserves body voxel count');
  assert.equal(resting[4], initial[4], 'sand motion preserves material count');

  engine._demo_pause(1);const paused = snapshot();step(60);
  assert.equal(snapshot()[0], paused[0], 'pause stops simulation ticks');
  engine._demo_pause(0);
  engine._demo_reset();engine._demo_tool(2);engine._demo_camera(30.5, 10, 40.5, 0, -Math.PI / 2);
  engine._demo_use();
  assert.equal(engine._demo_cell(30, 7, 40), 3, 'stone placement attaches directly to terrain');
  assert.equal(snapshot()[1], 0, 'supported placement remains terrain');

  engine._demo_tool(1);engine._demo_camera(30, 18, 40, 0, 0);engine._demo_use();
  const poured = snapshot()[4]; assert.ok(poured > initial[4], 'sand tool adds material');
  step(120);assert.equal(snapshot()[4], poured, 'poured sand is conserved');

  engine._demo_reset();engine._demo_tool(4);engine._demo_camera(32, 24, 45, 0, 0);engine._demo_use();
  const thrown = snapshot();assert.equal(thrown[1], 1);assert.equal(thrown[11], 27);
  engine._demo_tool(0);engine._demo_brush(0.5);engine._demo_use();
  const chipped = snapshot();assert.ok(chipped[11] < 27, 'mining hits a moving voxel object');
  assert.ok(chipped[11] > 0, 'mining preserves the rest of the object');
  step(180);assert.ok(snapshot().every(Number.isFinite), 'rotation and collisions stay finite');

  engine._demo_reset(); engine._demo_tool(4);
  for (let i = 0; i < 36; ++i) engine._demo_use();
  assert.equal(snapshot()[1], 32, 'the dynamic body pool is bounded');
  assert.ok(snapshot()[13] > 0, 'the body limit is reported to the interface');

  engine._demo_reset();assert.equal(snapshot()[1], 0);assert.equal(snapshot()[3], 0);
  assert.equal(snapshot()[4], initial[4], 'reset restores the authored scene');
  times.sort((a, b) => a - b);
  console.log(`3D engine checks passed. Detached-span step: p50 ${times[120].toFixed(2)} ms, p95 ${times[228].toFixed(2)} ms, max ${times.at(-1).toFixed(2)} ms.`);
} finally { engine._demo_destroy(); }
