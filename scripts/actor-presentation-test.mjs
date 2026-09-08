import assert from 'node:assert/strict';
import { createActorPresentation } from '../src/sand/worker/actorPresentation.js';
import { OFF, STRIDES } from '../src/sand/wasmBridge/abi.generated.js';
import { SIM_STEP_MS } from '../src/sand/timing/fixedRateClock.js';

const fields = OFF.projectileSnapshot;
const make = (...records) => {
  const data = new Float32Array(records.length * STRIDES.projectileSnapshot);
  records.forEach((record, index) => {
    for (const [key, value] of Object.entries({ id: 1, kind: 9, vx: 3, ...record }))
      data[index * STRIDES.projectileSnapshot + fields[key]] = value;
  });
  return data;
};
const create = () => createActorPresentation({ stride: STRIDES.projectileSnapshot, fields, kind: fields.kind });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);
const p = create();
const first = make({ x: 10, y: 20 });
p.push(first, 10, 0);
assert.deepEqual(p.sample(0), first, 'new projectiles appear at their confirmed location');
p.push(make({ x: 13, y: 20 }), 11, SIM_STEP_MS);
near(p.sample(SIM_STEP_MS)[fields.x], 10);
const halfway = p.sample(SIM_STEP_MS * 1.5);
near(halfway[fields.x], 11.5);
assert.equal(p.sample(SIM_STEP_MS * 1.5), halfway, 'repeated frame consumers see the same render buffer');
assert.equal(p.sample(SIM_STEP_MS * 1.5), halfway, 'repeated getters cannot cycle upload-buffer identities');
assert.notEqual(halfway, p.sample(SIM_STEP_MS * 1.75), 'moving render buffers invalidate identity-based GPU uploads');
near(p.sample(SIM_STEP_MS * 2)[fields.x], 13);
near(p.sample(10000)[fields.x], 13, 'stalled authority never extrapolates through terrain');
p.push(make({ x: 13, y: 20, charge: 7 }), 11, SIM_STEP_MS * 1.8);
near(p.sample(SIM_STEP_MS * 1.9)[fields.x], 12.7);
assert.equal(p.sample(SIM_STEP_MS * 1.9)[fields.charge], 7, 'same-tick facts refresh without restarting interpolation');
p.push(make({ x: 19, y: 20 }), 13, SIM_STEP_MS * 3);
near(p.sample(SIM_STEP_MS * 3)[fields.x], 16, 'coalesced snapshots retain only one tick of presentation delay');
near(p.sample(SIM_STEP_MS * 3.5)[fields.x], 17.5);
near(p.sample(SIM_STEP_MS * 3.5, 0, 0, false)[fields.x], 19, 'pause/replay uses exact snapshots');
near(p.sample(SIM_STEP_MS * 3.6)[fields.x], 19, 'resuming cannot rewind from the paused exact position');

const phases = create();
phases.push(make({ x: 10 }), 1, 0);
phases.push(make({ x: 12, kind: 10, vx: 0 }), 2, SIM_STEP_MS);
near(phases.sample(SIM_STEP_MS)[fields.x], 12, 'impacts and fields snap at phase changes');
phases.push(make({ id: 2, x: 30 }), 3, SIM_STEP_MS * 2);
assert.equal(phases.sample(SIM_STEP_MS * 2).length, STRIDES.projectileSnapshot);
assert.equal(phases.sample(SIM_STEP_MS * 2)[fields.id], 2, 'removed IDs never leave trailing ghosts');
near(phases.sample(SIM_STEP_MS * 2)[fields.x], 30);
phases.push(make(), 4, SIM_STEP_MS * 3);
assert.equal(phases.sample(SIM_STEP_MS * 3).length, 0);

const shifted = create();
shifted.push(make({ x: 110, y: 220 }), 1, 0, 0, 0);
shifted.push(make({ x: 13, y: 20 }), 2, SIM_STEP_MS, 100, 200);
near(shifted.sample(SIM_STEP_MS * 1.5, 100, 200)[fields.x], 11.5);
near(shifted.sample(SIM_STEP_MS * 1.5, 0, 0)[fields.x], 111.5);
near(shifted.sample(SIM_STEP_MS * 1.5, 0, 0)[fields.y], 220);
shifted.push(make({ x: 300, y: 20 }), 3, SIM_STEP_MS * 2, 100, 200);
near(shifted.sample(SIM_STEP_MS * 2, 100, 200)[fields.x], 300, 'teleports snap rather than sweeping across the world');
shifted.reset();
assert.equal(shifted.sample(100), null, 'full replacement discards interpolation history');

const cf = OFF.creatureSnapshot;
const creature = createActorPresentation({ stride: STRIDES.creatureSnapshot, fields: cf,
  kind: cf.species, extraX: [cf.aimX], extraY: [cf.aimY] });
const body = new Float32Array(STRIDES.creatureSnapshot);
body[cf.id] = 2; body[cf.species] = 3; body[cf.x] = 10; body[cf.y] = 20;
body[cf.aimX] = 30; body[cf.aimY] = 40;
creature.push(body, 1, 0, 100, 200);
body[cf.x] = -999;
const rendered = creature.sample(0, 50, 100);
assert.equal(rendered[cf.x], 60, 'presentation snapshots do not alias mutable collision mirror data');
assert.equal(rendered[cf.aimX], 80);
assert.equal(rendered[cf.aimY], 140);
console.log('actor presentation: interpolation, tick coalescing, phase/lifetime boundaries, pause, relocation and coordinate frames passed');
