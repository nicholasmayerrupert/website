import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import createModule from '../src/sand3d/wasm/voxelDemo.js';

const engine = await createModule({ wasmBinary: readFileSync('src/sand3d/wasm/voxelDemo.wasm') });
const snapshot = () => Array.from(engine.HEAPF32.subarray(engine._demo_stats() / 4, engine._demo_stats() / 4 + 28));
const step = n => { for (let i = 0; i < n; ++i) engine._demo_step(1 / 60); };
assert.equal(engine._demo_create(0), 1);
try {
  const initial = snapshot();
  assert.ok(initial[4] > 100, 'the scene starts with loose sand');
  const initialZ = initial[7];
  engine._demo_key(0, 1); step(30); engine._demo_clear_input();
  assert.ok(snapshot()[7] < initialZ - 1.5, 'W moves the camera forward');
  engine._demo_reset();

  // Both gantry supports must be cut before the stone span is disconnected.
  engine._demo_brush(10); engine._demo_tool(0);
  for (const x of [-1.75, 1.75]) {
    engine._demo_camera(x, 1, 2, 0, 0);
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
  assert.ok(resting[12] < originalBodyY - 0.5, 'Box3D gravity moves the detached span');
  assert.ok(resting[12] > -0.1, 'terrain collision holds the span above the quarry floor');
  assert.equal(resting[11], detached[11], 'physics preserves body voxel count');
  assert.equal(resting[4], initial[4], 'sand motion preserves material count');

  engine._demo_pause(1);const paused = snapshot();step(60);
  assert.equal(snapshot()[0], paused[0], 'pause stops simulation ticks');
  engine._demo_pause(0);
  engine._demo_reset();engine._demo_tool(2);engine._demo_camera(0.03125, 2, 3.03125, 0, -Math.PI / 2);
  engine._demo_use();
  assert.equal(engine._demo_cell(0.03125, 0.03125, 3.03125), 3, 'stone placement attaches directly to terrain');
  assert.equal(snapshot()[1], 0, 'supported placement remains terrain');

  engine._demo_tool(1);engine._demo_camera(0, 4, 4, 0, 0);engine._demo_use();
  const poured = snapshot()[4]; assert.ok(poured > initial[4], 'sand tool adds material');
  step(120);assert.equal(snapshot()[4], poured, 'poured sand is conserved');

  engine._demo_reset();engine._demo_tool(4);engine._demo_camera(0, 5, 4, 0, 0);engine._demo_use();
  const thrown = snapshot();assert.equal(thrown[1], 1);assert.equal(thrown[11], 4096);
  engine._demo_tool(0);engine._demo_brush(0.5);engine._demo_use();
  const chipped = snapshot();assert.ok(chipped[11] < 4096, 'mining hits a moving voxel object');
  assert.ok(chipped[11] > 0, 'mining preserves the rest of the object');
  step(180);assert.ok(snapshot().every(Number.isFinite), 'rotation and collisions stay finite');

  // A single microvoxel can be edited independently and survives complete eviction.
  engine._demo_reset();engine._demo_tool(0);engine._demo_brush(0.5);
  engine._demo_camera(0.03125,2,3.03125,0,-Math.PI/2);
  const neighboring=engine._demo_cell(0.09375,-0.03125,3.03125);
  assert.equal(engine._demo_cell(0.03125,-0.03125,3.03125),5);
  engine._demo_use();
  assert.equal(engine._demo_cell(0.03125,-0.03125,3.03125),0);
  assert.equal(engine._demo_cell(0.09375,-0.03125,3.03125),neighboring,'adjacent 6.25 cm voxel is preserved');
  const sample=()=>{let h=2166136261;for(let z=-2;z<5;z+=0.25)for(let y=-1;y<4;y+=0.25)for(let x=-3;x<4;x+=0.25)h=Math.imul(h^engine._demo_cell(x,y,z),16777619);return h>>>0;};
  const checksum=sample();
  for(const [x,y,z] of [[160,5,160],[-160,5,-160],[0,80,0],[0,-80,0],[1048576,8,-1048576]]) {
    engine._demo_camera(x,y,z,0,0);
    assert.equal(snapshot()[25],4608,'resident terrain remains bounded');
    assert.ok(snapshot().every(Number.isFinite));
  }
  engine._demo_camera(0,4,8,0,-0.18);
  assert.equal(sample(),checksum,'modified and procedural cells restore identically across all three axes');
  assert.ok(snapshot()[20]>0,'edited chunks restore from the cache');
  assert.equal(snapshot()[17],0.0625,'simulation voxels are sixteen times smaller per axis');

  engine._demo_reset();engine._demo_tool(4);engine._demo_camera(0,5,4,0,0);engine._demo_use();
  const beforeArchive=snapshot()[11];
  engine._demo_camera(200,5,200,0,0);
  assert.equal(snapshot()[1],0);assert.equal(snapshot()[24],1,'distant rigid body is archived');
  engine._demo_camera(0,5,4,0,0);
  assert.equal(snapshot()[11],beforeArchive,'body voxel shape restores after a round trip');
  assert.equal(snapshot()[24],0);

  // Continuous fast diagonal flight uses the frame-budgeted path, not teleport hooks.
  engine._demo_reset();engine._demo_camera(0,6,8,0,0);engine._demo_key(0,1);engine._demo_key(3,1);engine._demo_key(6,1);
  const travel=[];let minMargin=Infinity;
  for(let i=0;i<1200;++i){const start=performance.now();step(1);travel.push(performance.now()-start);minMargin=Math.min(minMargin,snapshot()[27]);}
  engine._demo_clear_input();
  assert.ok(snapshot()[5]>150&&snapshot()[7]<-140,'flight continues beyond the initial world in both axes');
  assert.ok(snapshot()[18]>20,'new terrain windows are streamed during flight');
  assert.ok(minMargin>2,`preparation keeps the camera safely within resident terrain throughout flight (${minMargin.toFixed(2)} m minimum)`);
  travel.sort((a,b)=>a-b);
  console.log(`Streaming flight: p50 ${travel[600].toFixed(2)} ms, p95 ${travel[1140].toFixed(2)} ms, p99 ${travel[1188].toFixed(2)} ms, max ${travel.at(-1).toFixed(2)} ms; heap ${(engine.HEAPU8.length/1048576).toFixed(1)} MiB.`);

  engine._demo_reset(); engine._demo_tool(4);
  for (let i = 0; i < 36; ++i) engine._demo_use();
  assert.equal(snapshot()[1], 32, 'the dynamic body pool is bounded');
  assert.ok(snapshot()[13] > 0, 'the body limit is reported to the interface');

  engine._demo_reset();assert.equal(snapshot()[1], 0);assert.equal(snapshot()[3], 0);
  assert.equal(snapshot()[4], initial[4], 'reset restores the authored scene');
  times.sort((a, b) => a - b);
  console.log(`3D engine checks passed. Detached-span step: p50 ${times[120].toFixed(2)} ms, p95 ${times[228].toFixed(2)} ms, max ${times.at(-1).toFixed(2)} ms.`);
} finally { engine._demo_destroy(); }
