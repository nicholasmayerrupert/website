// Deterministic structural mutation stress. Dev WASM builds run the C++
// invariant validator after every destructive/rigid phase; the JS checks keep
// owner rosters and cross-layer joint poses observable in production builds.

import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';
import { gridHash, makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('seeded structural mutation stress');

const seeded = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const exactPose = (a, b) => a && b
  && a.px === b.px && a.py === b.py && a.angle === b.angle
  && a.vx === b.vx && a.vy === b.vy && a.omega === b.omega
  && a.nPts === b.nPts && a.maxR === b.maxR;

function assertStructuralView(engine) {
  const rosters = [new Map(), new Map()];
  for (let layer = 0; layer < 2; layer++) {
    for (let index = 0; index < engine._bodyCountLayer(layer); index++) {
      const id = engine._bodyIdLayer(layer, index);
      if (rosters[layer].has(id))
        throw new Error(`duplicate body id ${id} in layer ${layer}`);
      rosters[layer].set(id, {
        role: engine._bodyJointRoleLayer(layer, index),
        state: engine._bodyStateLayer(layer, index),
      });
    }
    const owners = engine._bodyOwnerGrid(layer);
    for (let k = 0; k < owners.length; k++)
      if (owners[k] >= 0 && !rosters[layer].has(owners[k]))
        throw new Error(`orphan owner ${owners[k]} at ${layer}:${k}`);
  }
  for (const [id, leader] of rosters[0]) {
    if (leader.role !== 1) continue;
    const follower = rosters[1].get(id);
    if (!follower || follower.role !== 2 || !exactPose(leader.state, follower.state))
      throw new Error(`joint ${id} lost its exact follower pose`);
  }
  for (const [id, follower] of rosters[1])
    if (follower.role === 2 && rosters[0].get(id)?.role !== 1)
      throw new Error(`joint follower ${id} has no leader`);
}

function run(seed) {
  const random = seeded(seed);
  const engine = attachTestHooks(createEngineWasmRaw({
    cols: 256, rows: 192, worldSeed: seed,
    sinksOn: false, infinite: true,
  }));
  engine.setBgEnabled(true);

  // Start with aligned unsupported masses so the run always exercises joint
  // creation before randomized cuts, welding, blasts, forces, and streaming.
  for (let layer = 0; layer < 2; layer++) {
    for (let y = 18; y <= 34; y++)
      for (let x = 82; x <= 126; x++)
        engine.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
    engine.syncComponentsLayer(layer);
  }

  const structural = [
    MAT.STONE, MAT.WOOD, MAT.ICE, MAT.BRICK,
    MAT.COPPER_ORE, MAT.NEUTRONIUM,
  ];
  const loose = [MAT.WATER, MAT.SAND, MAT.ACID, MAT.LAVA, MAT.TNT];
  const sizes = [[256, 192], [288, 224], [224, 160]];
  let resizeSlot = 0;
  for (let tick = 0; tick < 220; tick++) {
    const cols = engine.cols, rows = engine.rows;
    const layer = random() < 0.5 ? 0 : 1;
    const x = 12 + Math.floor(random() * (cols - 24));
    const y = 10 + Math.floor(random() * (rows - 28));
    const operation = Math.floor(random() * 8);
    if (operation <= 1) {
      const material = structural[Math.floor(random() * structural.length)];
      engine.paintDiscLayer(layer, x, y, 1 + Math.floor(random() * 3), material, true);
      engine.syncComponentsLayer(layer);
    } else if (operation === 2) {
      engine.eraseDiscLayer(layer, x, y, 1 + Math.floor(random() * 4));
    } else if (operation === 3) {
      const material = loose[Math.floor(random() * loose.length)];
      const radius = 1 + Math.floor(random() * 3);
      if (material === MAT.TNT) engine.placeMaterial(x, y, radius, material, layer);
      else engine.paintDiscLayer(layer, x, y, radius, material, true);
    } else if (operation === 4) {
      engine._spawnBoxLayer(layer, x, y, 1 + Math.floor(random() * 4),
        1 + Math.floor(random() * 3),
        structural[Math.floor(random() * structural.length)]);
    } else if (operation === 5) {
      engine._detonateTnt(x, y);
    } else if (operation === 6) {
      engine.paintDiscLayer(layer, x, y, 2, MAT.FIRE, false);
    } else {
      engine.paintDiscLayer(layer, x, y, 2, MAT.ACID, false);
    }

    if (tick > 0 && tick % 37 === 0) {
      const direction = ((tick / 37) & 1) ? 32 : -32;
      engine.shiftWorldXY(direction, 0);
    }
    if (tick > 0 && tick % 71 === 0) {
      resizeSlot = (resizeSlot + 1) % sizes.length;
      engine.resizeLoadedWindow(...sizes[resizeSlot]);
    }
    engine.stepWorld();
    assertStructuralView(engine);
  }
  const result = {
    fg: gridHash(engine.getGrid()),
    bg: gridHash(engine.getGridBg()),
    bodies: [engine._bodyCountLayer(0), engine._bodyCountLayer(1)],
  };
  engine.destroy();
  return result;
}

let first = null, second = null, survived = true;
try {
  first = run(0x51a7c0de);
  second = run(0x51a7c0de);
} catch (error) {
  survived = false;
  console.error(error);
}
check('mixed two-layer mutation/stream/resize run preserves structural invariants', survived);
check(`seeded run is deterministic (${first?.fg ?? 'failed'}/${first?.bg ?? 'failed'})`,
  survived && first.fg === second.fg && first.bg === second.bg
    && first.bodies[0] === second.bodies[0]
    && first.bodies[1] === second.bodies[1]);

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
