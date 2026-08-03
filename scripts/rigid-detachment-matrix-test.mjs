// Deterministic structural-detachment matrix. Fixtures start as grounded or
// baked component terrain, lose the support they require, and must become an
// accelerating body instead of remaining as an unsupported static component.

import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { KIND, MATERIALS, MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 132;
const ROWS = 190;
const FLOOR_Y = ROWS - 3;
const CAP_Y0 = 28;
const CAP_Y1 = 52;
const CUT_Y = 105;

await initSandWasm();
const createEngineWasm = (options) => attachTestHooks(createEngineWasmRaw(options));
const { check, done } = makeChecker('rigid detachment matrix');
const isComponentMaterial = (material) => MATERIALS[material]?.kind === KIND.COMPONENT;

const CASES = [
  { name: 'thin neck', supports: [{ x: 66, width: 1 }] },
  { name: 'three-cell neck', supports: [{ x: 66, width: 3 }] },
  { name: 'seven-cell neck', supports: [{ x: 66, width: 7 }] },
  { name: 'eleven-cell neck', supports: [{ x: 66, width: 11 }] },
  { name: 'offset neck', supports: [{ x: 41, width: 5 }], shape: 'offset' },
  { name: 'stepped island', supports: [{ x: 72, width: 5 }], shape: 'steps' },
  { name: 'hollow island', supports: [{ x: 66, width: 5 }], shape: 'hollow' },
  { name: 'bridged lobes', supports: [{ x: 66, width: 5 }], shape: 'lobes' },
  { name: 'brick island', supports: [{ x: 66, width: 5 }], material: MAT.BRICK },
  { name: 'clay island', supports: [{ x: 66, width: 5 }], material: MAT.CLAY },
  { name: 'sandstone island', supports: [{ x: 66, width: 5 }], material: MAT.SANDSTONE },
  { name: 'deepstone island', supports: [{ x: 66, width: 5 }], material: MAT.DEEPSTONE },
  { name: 'ice island', supports: [{ x: 66, width: 5 }], material: MAT.ICE },
  {
    name: 'mixed-material island',
    supports: [{ x: 66, width: 5 }],
    materials: [MAT.STONE, MAT.BRICK, MAT.IRON_ORE, MAT.CLAY, MAT.SANDSTONE],
  },
  { name: 'one dirt cargo row', supports: [{ x: 66, width: 5 }], cargo: [[MAT.DIRT, 1]] },
  { name: 'deep dirt cargo', supports: [{ x: 66, width: 5 }], cargo: [[MAT.DIRT, 10]] },
  {
    name: 'mixed powder cargo',
    supports: [{ x: 66, width: 5 }],
    cargo: [[MAT.MUD, 3], [MAT.SAND, 3], [MAT.DIRT, 3]],
  },
  { name: 'snow cargo', supports: [{ x: 66, width: 5 }], cargo: [[MAT.SNOW, 12]] },
  { name: 'water cargo', supports: [{ x: 66, width: 5 }], cargo: [[MAT.WATER, 8]] },
  { name: 'oil cargo', supports: [{ x: 66, width: 5 }], cargo: [[MAT.OIL, 8]] },
  {
    name: 'two supports, sequential blasts',
    supports: [{ x: 43, width: 5 }, { x: 89, width: 5 }],
    stepBetweenCuts: 3,
  },
  {
    name: 'two supports, atomic blasts',
    supports: [{ x: 43, width: 5 }, { x: 89, width: 5 }],
  },
  {
    name: 'two supports, direct cuts',
    supports: [{ x: 43, width: 5 }, { x: 89, width: 5 }],
    cut: 'direct',
    stepBetweenCuts: 3,
  },
  {
    name: 'long-idle support cache',
    supports: [{ x: 66, width: 5 }],
    idleSteps: 80,
    cargo: [[MAT.DIRT, 4]],
  },
  {
    name: 'unrelated blast before support cut',
    supports: [{ x: 82, width: 5 }],
    preBlast: { x: 25, y: CUT_Y },
  },
  { name: 'background-only island', supports: [{ x: 66, width: 5 }], layers: [1] },
  {
    name: 'aligned cross-layer island',
    supports: [{ x: 66, width: 5 }],
    layers: [0, 1],
    requireJoint: true,
  },
  {
    name: 'offset cross-layer masks',
    supports: [{ x: 43, width: 5 }, { x: 89, width: 5 }],
    layers: [0, 1],
    layerShapes: ['offset', 'steps'],
    requireJoint: true,
  },
  {
    name: 'mixed cross-layer materials',
    supports: [{ x: 43, width: 5 }, { x: 89, width: 5 }],
    layers: [0, 1],
    layerMaterials: [MAT.IRON_ORE, MAT.BRICK],
    requireJoint: true,
  },
  {
    name: 'dirt-loaded cross-layer island',
    supports: [{ x: 66, width: 5 }],
    layers: [0, 1],
    cargo: [[MAT.DIRT, 8]],
    requireJoint: true,
  },
  {
    name: 'cross-layer sequential support loss',
    supports: [{ x: 43, width: 5 }, { x: 89, width: 5 }],
    layers: [0, 1],
    stepBetweenCuts: 4,
    requireJoint: true,
  },
];

const REBAKE_CASES = [
  { name: 'rebaked island over dirt pad', powder: MAT.DIRT },
  { name: 'rebaked island over sand pad', powder: MAT.SAND },
  { name: 'rebaked island over mud pad', powder: MAT.MUD },
  { name: 'rebaked island over snow pad', powder: MAT.SNOW },
  { name: 'rebaked island after direct support cut', powder: MAT.DIRT, cut: 'direct' },
  { name: 'long-idle rebaked island', powder: MAT.DIRT, idleSteps: 100 },
  {
    name: 'rebaked cross-layer island over dirt',
    powder: MAT.DIRT,
    layers: [0, 1],
    requireJoint: true,
  },
  {
    name: 'rebaked cross-layer island after direct cut',
    powder: MAT.MUD,
    layers: [0, 1],
    cut: 'direct',
    requireJoint: true,
  },
];

const DRAINED_SUPPORT_CASES = [
  { name: 'baked body after dirt drains', powder: MAT.DIRT },
  { name: 'baked body after sand drains', powder: MAT.SAND },
  { name: 'baked body after mud drains', powder: MAT.MUD },
  { name: 'baked body after snow drains', powder: MAT.SNOW, material: MAT.PLANT },
];

function paintCell(engine, layer, x, y, material) {
  engine.paintDiscLayer(layer, x, y, 0, material, true);
}

function paintRect(engine, layer, x0, y0, x1, y1, material) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      paintCell(engine, layer, x, y, material);
}

function capBounds(shape) {
  if (shape === 'offset') return { x0: 17, x1: 91 };
  return { x0: 26, x1: 105 };
}

function paintCap(engine, layer, shape, materials) {
  const bounds = capBounds(shape);
  let cells = 0;
  const write = (x, y) => {
    const material = materials[(x * 3 + y * 5) % materials.length];
    paintCell(engine, layer, x, y, material);
    cells++;
  };
  for (let y = CAP_Y0; y <= CAP_Y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      let include = true;
      if (shape === 'steps') {
        const inset = Math.floor((CAP_Y1 - y) / 4);
        include = x >= bounds.x0 + inset && x <= bounds.x1 - Math.floor(inset / 2);
      } else if (shape === 'hollow') {
        include = y <= CAP_Y0 + 3 || y >= CAP_Y1 - 3
          || x <= bounds.x0 + 3 || x >= bounds.x1 - 3
          || (x >= 63 && x <= 69);
      } else if (shape === 'lobes') {
        include = x <= 57 || x >= 75 || y >= CAP_Y1 - 3;
      }
      if (include) write(x, y);
    }
  }
  return { ...bounds, cells };
}

function largestStructuralBody(engine, layer, minimumCells) {
  let largest = null;
  for (let i = 0; i < engine._bodyCountLayer(layer); i++) {
    if (engine._bodyBlastDebrisLayer(layer, i)) continue;
    const state = engine._bodyStateLayer(layer, i);
    if (!state || state.nPts < minimumCells) continue;
    if (!largest || state.nPts > largest.state.nPts) largest = { index: i, state };
  }
  return largest;
}

function countUnsupportedStatic(engine, layer) {
  const grid = layer ? engine.getGridBg() : engine.getGrid();
  const owner = engine._bodyOwnerGrid(layer);
  const grounded = engine._groundedGrid(layer);
  let cells = 0;
  for (let k = 0; k < grid.length; k++)
    if (owner[k] < 0 && !grounded[k] && isComponentMaterial(grid[k])) cells++;
  return cells;
}

function runCase(spec, caseIndex) {
  const layers = spec.layers ?? [0];
  const engine = createEngineWasm({
    cols: COLS,
    rows: ROWS,
    worldSeed: 0xD370 + caseIndex,
    sinksOn: false,
    infinite: false,
  });
  if (layers.includes(1)) engine.setBgEnabled(true);

  const caps = new Map();
  for (const layer of layers) {
    const shape = spec.layerShapes?.[layer] ?? spec.shape ?? 'rect';
    const material = spec.layerMaterials?.[layer] ?? spec.material ?? MAT.STONE;
    const materials = spec.materials ?? [material];
    paintRect(engine, layer, 0, FLOOR_Y, COLS - 1, ROWS - 1, MAT.STONE);
    const cap = paintCap(engine, layer, shape, materials);
    caps.set(layer, cap);
    for (const support of spec.supports) {
      const x0 = support.x - Math.floor(support.width / 2);
      const x1 = x0 + support.width - 1;
      paintRect(engine, layer, x0, CAP_Y1, x1, FLOOR_Y - 1, MAT.STONE);
    }
    let cargoTop = CAP_Y0 - 1;
    for (const [cargoMaterial, depth] of spec.cargo ?? []) {
      paintRect(engine, layer, cap.x0, cargoTop - depth + 1, cap.x1, cargoTop, cargoMaterial);
      cargoTop -= depth;
    }
    engine.syncComponentsLayer(layer);
  }

  engine.stepWorld();
  for (let i = 0; i < (spec.idleSteps ?? 0); i++) engine.stepWorld();
  const initiallyStatic = layers.every((layer) => engine._bodyCountLayer(layer) === 0);
  const initiallyGrounded = layers.every((layer) => {
    const cap = caps.get(layer);
    return engine._groundedGrid(layer)[CAP_Y1 * COLS + Math.floor((cap.x0 + cap.x1) / 2)] === 1;
  });

  if (spec.preBlast) {
    engine._detonateTnt(spec.preBlast.x, spec.preBlast.y);
    engine.stepWorld();
  }
  for (let i = 0; i < spec.supports.length; i++) {
    const support = spec.supports[i];
    if (spec.cut === 'direct') {
      const x0 = support.x - Math.floor(support.width / 2) - 1;
      const x1 = x0 + support.width + 1;
      for (const layer of layers) {
        paintRect(engine, layer, x0, CUT_Y - 15, x1, CUT_Y + 15, MAT.EMPTY);
        engine.syncComponentsLayer(layer);
      }
    } else {
      engine._detonateTnt(support.x, CUT_Y);
    }
    if (i + 1 < spec.supports.length)
      for (let s = 0; s < (spec.stepBetweenCuts ?? 0); s++) engine.stepWorld();
  }
  engine.stepWorld();
  engine.stepWorld();

  const minimumByLayer = new Map();
  const starts = new Map();
  for (const layer of layers) {
    const minimum = Math.max(24, Math.floor(caps.get(layer).cells * 0.45));
    minimumByLayer.set(layer, minimum);
    starts.set(layer, largestStructuralBody(engine, layer, minimum));
  }
  const unsupported = layers.reduce((sum, layer) => sum + countUnsupportedStatic(engine, layer), 0);

  for (let i = 0; i < 18; i++) engine.stepWorld();
  const ends = new Map();
  for (const layer of layers)
    ends.set(layer, largestStructuralBody(engine, layer, minimumByLayer.get(layer)));

  const bodiesSpawned = layers.every((layer) => starts.get(layer)?.state && ends.get(layer)?.state);
  const falling = layers.every((layer) => {
    const start = starts.get(layer)?.state;
    const end = ends.get(layer)?.state;
    return start && end && end.py - start.py > 3 && end.vy > 0.1;
  });
  let joint = true;
  if (spec.requireJoint) {
    const fg = starts.get(0);
    const bg = starts.get(1);
    joint = !!fg && !!bg
      && engine._bodyJointRoleLayer(0, fg.index) === 1
      && engine._bodyJointRoleLayer(1, bg.index) === 2
      && Math.abs(ends.get(0).state.py - ends.get(1).state.py) < 1e-9
      && Math.abs(ends.get(0).state.vy - ends.get(1).state.vy) < 1e-9;
  }

  const detail = [
    initiallyStatic ? null : 'body existed before cut',
    initiallyGrounded ? null : 'cap was not initially grounded',
    unsupported ? `${unsupported} unsupported static cells` : null,
    bodiesSpawned ? null : 'structural body missing',
    falling ? null : `body did not keep falling (${[...layers].map((layer) => {
      const start = starts.get(layer)?.state;
      const end = ends.get(layer)?.state;
      return start && end
        ? `L${layer} dy=${(end.py - start.py).toFixed(2)} vy=${end.vy.toFixed(2)}`
        : `L${layer} missing`;
    }).join(', ')})`,
    joint ? null : 'cross-layer body was not joint',
  ].filter(Boolean).join(', ');
  engine.destroy();
  return {
    ok: initiallyStatic && initiallyGrounded && unsupported === 0
      && bodiesSpawned && falling && joint,
    detail,
  };
}

function runRebakeCase(spec, caseIndex) {
  const cols = 132;
  const rows = 220;
  const floorY = rows - 3;
  const layers = spec.layers ?? [0];
  const engine = createEngineWasm({
    cols,
    rows,
    worldSeed: 0xB4CE + caseIndex,
    sinksOn: false,
    infinite: false,
  });
  if (layers.includes(1)) engine.setBgEnabled(true);
  for (const layer of layers) {
    paintRect(engine, layer, 0, floorY, cols - 1, rows - 1, MAT.STONE);
    // Main island support. The separate shelf leaves one loose-material row
    // between itself and the island, so it is physical support but not a rigid
    // path into the grounding graph.
    paintRect(engine, layer, 35, 100, 97, 104, MAT.STONE);
    paintRect(engine, layer, 64, 104, 68, floorY - 1, MAT.STONE);
    paintRect(engine, layer, 39, 106, 47, 108, MAT.STONE);
    paintRect(engine, layer, 42, 108, 44, floorY - 1, MAT.STONE);
    paintRect(engine, layer, 40, 105, 46, 105, spec.powder);
    engine.syncComponentsLayer(layer);
  }
  engine.stepWorld();
  for (const layer of layers)
    engine._spawnBoxLayer(layer, 66, 70, 10, 8, MAT.STONE);

  let bakedAt = -1;
  for (let i = 0; i < 800; i++) {
    engine.stepWorld();
    if (layers.every((layer) => engine._bodyCountLayer(layer) === 0)) {
      bakedAt = i;
      break;
    }
  }
  for (let i = 0; i < (spec.idleSteps ?? 0); i++) engine.stepWorld();

  if (spec.cut === 'direct') {
    for (const layer of layers) {
      paintRect(engine, layer, 55, 135, 77, 166, MAT.EMPTY);
      engine.syncComponentsLayer(layer);
    }
  } else {
    engine._detonateTnt(66, 150);
  }
  engine.stepWorld();
  engine.stepWorld();

  const starts = new Map();
  for (const layer of layers)
    starts.set(layer, largestStructuralBody(engine, layer, 300));
  const unsupported = layers.reduce(
    (sum, layer) => sum + countUnsupportedStatic(engine, layer), 0);

  for (let i = 0; i < 18; i++) engine.stepWorld();
  const ends = new Map();
  for (const layer of layers)
    ends.set(layer, largestStructuralBody(engine, layer, 300));
  const spawned = layers.every((layer) => starts.get(layer)?.state && ends.get(layer)?.state);
  const falling = layers.every((layer) => {
    const start = starts.get(layer)?.state;
    const end = ends.get(layer)?.state;
    return start && end && end.py - start.py > 3 && end.vy > 0.25;
  });
  let joint = true;
  if (spec.requireJoint) {
    const fg = starts.get(0);
    const bg = starts.get(1);
    joint = !!fg && !!bg
      && engine._bodyJointRoleLayer(0, fg.index) === 1
      && engine._bodyJointRoleLayer(1, bg.index) === 2
      && Math.abs(ends.get(0).state.py - ends.get(1).state.py) < 1e-9;
  }
  const detail = [
    bakedAt >= 0 ? null : 'first body never baked',
    unsupported ? `${unsupported} unsupported static cells` : null,
    spawned ? null : 're-detached body missing',
    falling ? null : 're-detached body did not fall',
    joint ? null : 're-detached layers were not joint',
  ].filter(Boolean).join(', ');
  engine.destroy();
  return {
    ok: bakedAt >= 0 && unsupported === 0 && spawned && falling && joint,
    detail,
  };
}

function runDrainedSupportCase(spec, caseIndex) {
  const cols = 100;
  const rows = 170;
  const engine = createEngineWasm({
    cols,
    rows,
    worldSeed: 0xD2A1 + caseIndex,
    sinksOn: false,
    infinite: false,
  });
  paintRect(engine, 0, 0, rows - 3, cols - 1, rows - 1, MAT.STONE);
  paintRect(engine, 0, 20, 125, 80, 128, MAT.STONE);
  paintRect(engine, 0, 48, 128, 52, rows - 4, MAT.STONE);
  paintRect(engine, 0, 25, 105, 75, 124, spec.powder);
  engine.syncComponents();
  engine.stepWorld();
  engine._spawnBoxLayer(0, 50, 70, 3, 3, spec.material ?? MAT.WOOD);

  let bakedAt = -1;
  for (let i = 0; i < 800; i++) {
    engine.stepWorld();
    if (engine._bodyCount() === 0) {
      bakedAt = i;
      break;
    }
  }
  const grid = engine.getGrid();
  for (let y = 90; y < 125; y++)
    for (let x = 15; x < 85; x++)
      if (grid[y * cols + x] === spec.powder)
        engine.paintDisc(x, y, 0, MAT.EMPTY, true);
  engine.syncComponents();
  engine.stepWorld();
  const start = largestStructuralBody(engine, 0, 20);
  for (let i = 0; i < 14; i++) engine.stepWorld();
  const end = largestStructuralBody(engine, 0, 20);
  const unsupported = countUnsupportedStatic(engine, 0);
  const falling = start?.state && end?.state
    && end.state.py - start.state.py > 2 && end.state.vy > 0.2;
  const detail = [
    bakedAt >= 0 ? null : 'body never baked on powder',
    unsupported ? `${unsupported} unsupported static cells` : null,
    start?.state && end?.state ? null : 'body was not restored after powder drained',
    falling ? null : 'restored body did not accelerate',
  ].filter(Boolean).join(', ');
  engine.destroy();
  return {
    ok: bakedAt >= 0 && unsupported === 0 && !!start?.state && !!end?.state && !!falling,
    detail,
  };
}

function runOverloadAdmissionCase() {
  const cols = 220;
  const rows = 80;
  const engine = createEngineWasm({
    cols,
    rows,
    worldSeed: 0xB0D1,
    sinksOn: false,
    infinite: false,
  });
  for (let body = 0; body < 160; body++) {
    const x = 5 + (body % 40) * 5;
    const y = 5 + Math.floor(body / 40) * 15;
    paintRect(engine, 0, x, y, x + 1, y + 1, MAT.STONE);
  }
  engine.syncComponents();
  engine.stepWorld();
  const bodies = engine._bodyCount();
  const waitingCells = countUnsupportedStatic(engine, 0);
  engine.destroy();
  return { bodies, waitingCells };
}

for (let i = 0; i < CASES.length; i++) {
  const spec = CASES[i];
  const result = runCase(spec, i);
  check(`${spec.name}${result.detail ? ` — ${result.detail}` : ''}`, result.ok);
}
for (let i = 0; i < REBAKE_CASES.length; i++) {
  const spec = REBAKE_CASES[i];
  const result = runRebakeCase(spec, i);
  check(`${spec.name}${result.detail ? ` — ${result.detail}` : ''}`, result.ok);
}
for (let i = 0; i < DRAINED_SUPPORT_CASES.length; i++) {
  const spec = DRAINED_SUPPORT_CASES[i];
  const result = runDrainedSupportCase(spec, i);
  check(`${spec.name}${result.detail ? ` — ${result.detail}` : ''}`, result.ok);
}

const overload = runOverloadAdmissionCase();
check(`mass detachment admits 128 bodies and queues the remaining cells `
    + `(${overload.bodies} bodies, ${overload.waitingCells} waiting cells)`,
  overload.bodies === 128 && overload.waitingCells === 128);

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
