import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createModule from '../src/sand3d/wasm/voxelDemo.js';

const e = await createModule({ wasmBinary: readFileSync('src/sand3d/wasm/voxelDemo.wasm') });
const put = (x, y, z, m) => e._demo_edit((x + .5) / 16, (y + .5) / 16, (z + .5) / 16, m);
const state = slot => { const p = e._demo_body_stats(slot) / 4; return [...e.HEAPF32.subarray(p, p + 18)]; };
const count = m => e._demo_material_count(m);
const step = n => { for (let i = 0; i < n; ++i) e._demo_step(1 / 60); };
function pool(material = 8, depth = 16) {
  e._demo_reset(); e._demo_pause(0);
  for (let z = 64; z < 96; ++z) for (let x = 0; x < 32; ++x) for (let y = -2; y < 48; ++y)
    put(x, y, z, y < 0 || x === 0 || x === 31 || z === 64 || z === 95 ? 2 : y < depth ? material : 0);
  step(2);
}
assert.equal(e._demo_create(0), 1);
try {
  for (const [name, material] of [['wood', 4], ['stone', 3]]) {
    pool();
    const water = count(8), slot = e._demo_body_box(10 / 16, 24 / 16, 74 / 16, 12, 12, 12, material);
    const times = [], heights = [];
    for (let i = 0; i < 360; ++i) {
      const start = performance.now(); step(1); times.push(performance.now() - start);
      assert.equal(count(8), water, `${name} displacement conserves every water cell`);
      assert.equal(e._demo_loose_overlap(), 0, `${name} and liquid occupy separate cells`);
      assert.ok(state(slot).every(Number.isFinite), `${name} pressure and torque stay finite`);
      if (i % 30 === 0) heights.push(state(slot)[2]);
    }
    const result = state(slot); times.sort((a, b) => a - b);
    console.log(name, { heights, result, p50: times[180], p95: times[342] });
    assert.equal(result[15], 1728, `${name} retains its rigid volume`);
    assert.ok(result[16] > 0, `${name} displaces water while entering`);
    if (material === 4) {
      assert.ok(result[2] > .4 && result[2] < 1.3, 'timber floats partially submerged');
      assert.ok(Math.abs(result[9]) < .25, 'floating timber settles instead of gaining energy');
    } else assert.ok(result[2] < .15, 'stone sinks and rests on the pool floor');
  }
  // Dry grains support a dense object, and the object must push them aside.
  pool(1);
  const sand = count(1), rock = e._demo_body_box(10 / 16, 24 / 16, 74 / 16, 12, 12, 12, 3);
  for (let i = 0; i < 240; ++i) {
    step(1);assert.equal(count(1), sand, 'rigid/grain displacement conserves sand');
    assert.equal(e._demo_loose_overlap(), 0, 'grains do not remain inside a rigid body');
  }
  console.log('sand support', state(rock));
  assert.ok(state(rock)[2] > .65, 'a settled sand bed supports stone instead of letting it sink to the floor');

  // A load on a floating platform changes its equilibrium and follows its motion.
  pool();
  const raft = e._demo_body_box(8 / 16, 18 / 16, 72 / 16, 16, 4, 16, 4);
  step(240);let unloaded=0;for(let i=0;i<120;++i){step(1);unloaded+=state(raft)[2]/120;}
  const beforeLoad = count(1);
  const r = state(raft);
  for (let x = 0; x < 10; ++x) for (let z = 0; z < 10; ++z)
    e._demo_edit(r[1] + (x + 3.5) / 16, r[2] + 6.5 / 16, r[3] + (z + 3.5) / 16, 1);
  step(240);let loaded=0;for(let i=0;i<120;++i){step(1);loaded+=state(raft)[2]/120;}
  console.log('loaded raft', { unloaded, loaded, state: state(raft) });
  assert.equal(count(1), beforeLoad + 100, 'a moving support preserves its grain load');
  assert.ok(loaded < unloaded - .015, 'sand weight lowers a floating raft');
  assert.equal(e._demo_loose_overlap(), 0);

  // The same lateral throw travels less far in water, while its wake moves water.
  const travel = [];
  for (const wet of [false, true]) {
    pool(wet ? 8 : 0, 32);
    const water = count(8), body = e._demo_body_box(4 / 16, 8 / 16, 76 / 16, 8, 8, 8, 4);
    e._demo_body_velocity(body, 1.2, 0, 0, 0, 0, 0);step(20);
    const s = state(body);travel.push(s[1]);
    assert.equal(count(8), water, 'a sideways sweep conserves fluid');
    assert.equal(e._demo_loose_overlap(), 0);
    console.log('lateral', { wet, state: s });
  }
  assert.ok(travel[1] < travel[0] - .08, 'fluid drag resists a lateral throw');

  // A spinning body keeps its volume separate from liquid throughout its sweep.
  pool();
  const rotating = e._demo_body_box(10 / 16, 12 / 16, 74 / 16, 12, 4, 12, 4), water = count(8);
  e._demo_body_velocity(rotating, .2, -.2, 0, 1.5, .7, 2);
  for (let i = 0; i < 180; ++i) {
    step(1);assert.equal(count(8), water, 'rotation conserves displaced water');
    assert.equal(e._demo_loose_overlap(), 0, 'rotated body occupancy has no liquid leaks');
    assert.ok(state(rotating).every(Number.isFinite));
  }
  assert.ok(Math.hypot(...state(rotating).slice(11, 14)) < 2.4, 'fluid drag damps angular motion');

  // Reaction bubbles transmit pressure through liquid instead of pinning bodies.
  pool();put(16,8,80,14);
  const bubbleWater=count(8),bubbleGas=count(14),bubbleBody=e._demo_body_box(12/16,7/16,76/16,8,8,8,3);
  const random=Math.random;
  try {
    Math.random=()=>.5;
    for(let i=0;i<30;++i) {
      step(1);assert.equal(count(8),bubbleWater);assert.equal(count(14),bubbleGas);
      assert.equal(e._demo_loose_overlap(),0,'venting a bubble keeps gas and liquid outside the body');
    }
  } finally {Math.random=random;}
  assert.ok(state(bubbleBody)[2]<.2,'a submerged bubble does not suspend a sinking rigid body');
  assert.equal(state(bubbleBody)[17],0,'a vented bubble does not trigger incompressible rollback');

  // Water filling a rigid-walled chamber has nowhere to go. A piston cannot
  // enter it, and another body outside that chamber must continue falling.
  pool(8, 16);
  for (let z = 65; z < 95; ++z) for (let x = 1; x < 31; ++x) put(x, 16, z, 2);
  for (let z = 76; z < 84; ++z) for (let x = 12; x < 20; ++x) put(x, 16, z, 0);
  const piston = e._demo_body_box(12 / 16, 16 / 16, 76 / 16, 8, 8, 8, 3);
  const free = e._demo_body_box(-2, 4, 4, 4, 4, 4, 3), sealedWater = count(8);
  step(90);
  console.log('sealed piston', { piston: state(piston), free: state(free) });
  assert.equal(count(8), sealedWater, 'a sealed chamber loses no water');
  assert.equal(e._demo_loose_overlap(), 0, 'sealed water excludes a moving piston');
  assert.ok(state(piston)[2] > .95, 'incompressible water blocks the piston');
  assert.ok(state(piston)[17] > 0, 'the sealed-volume constraint is exercised');
  assert.ok(state(free)[2] < 1, 'a blocked piston does not freeze unrelated bodies');

  for (const material of [1, 8]) {
    pool(0);
    const target = e._demo_body_box(16 / 16, 8 / 16, 76 / 16, 4, 12, 8, 4);
    for (let x = 8; x < 12; ++x) for (let y = 10; y < 14; ++y) for (let z = 78; z < 82; ++z) {
      put(x, y, z, material);
      e._demo_loose_velocity((x + .5) / 16, (y + .5) / 16, (z + .5) / 16, 3, 0, 0);
    }
    const volume = count(material);step(12);
    console.log('material impact', material, state(target));
    assert.ok(state(target)[8] > .05, 'an incoming material stream transfers momentum into a rigid body');
    assert.equal(count(material), volume, 'impact preserves material volume');
    assert.equal(e._demo_loose_overlap(), 0);
  }

  pool(0);
  for (let z = 70; z < 90; ++z) for (let y = 8; y < 24; ++y) put(16, y, z, 8);
  const fastWater = count(8), fast = e._demo_body_box(.5, .75, 4.75, 1, 4, 4, 3);
  e._demo_body_velocity(fast, 20, 0, 0, 0, 0, 0);step(3);
  assert.ok(state(fast)[16] > 0, 'a fast thin body cannot skip a one-cell liquid sheet');
  assert.equal(count(8), fastWater);assert.equal(e._demo_loose_overlap(), 0);

  // A closed hollow body keeps its dry cavity while translating and rotating underwater.
  pool(8, 28);
  for (let x = 8; x < 24; ++x) for (let y = 4; y < 20; ++y) for (let z = 72; z < 88; ++z)
    put(x, y, z, x === 8 || x === 23 || y === 4 || y === 19 || z === 72 || z === 87 ? 4 : 0);
  step(2);const vesselWater = count(8);
  e._demo_body_velocity(0, .1, 0, .1, .5, .2, .4);
  const rotate = (v, q) => {
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const t = cross(q, v).map(x => 2 * x), second = cross(q, t);
    return v.map((x, i) => x + q[3] * t[i] + second[i]);
  };
  for (let frame = 0; frame < 90; ++frame) {
    step(1);const s = state(0);assert.equal(s[0], 1, 'the hollow vessel remains one rigid body');
    for (const x of [5, 8, 11]) for (const y of [5, 8, 11]) for (const z of [5, 8, 11]) {
      const p = rotate([x / 16, y / 16, z / 16], s.slice(4, 8));
      assert.equal(e._demo_cell(s[1] + p[0], s[2] + p[1], s[3] + p[2]), 0, `a moving sealed cavity stays dry (frame ${frame}, local ${x},${y},${z})`);
    }
    assert.equal(count(8), vesselWater);assert.equal(e._demo_loose_overlap(), 0);
  }
  console.log('3D rigid/material coupling checks passed.');
} finally { e._demo_destroy(); }
