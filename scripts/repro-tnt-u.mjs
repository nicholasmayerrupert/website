// Reproduce the manual large-U TNT workflow in untouched procedural terrain.
// The trace follows a natural cell near the middle of the enclosed mass, then
// measures the complete foreground/background-connected assembly around it.
//
//   MAX_CASES=24 node scripts/repro-tnt-u.mjs
//   CASE_INDEX=7 node scripts/repro-tnt-u.mjs
/* global process */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = process.env.SAND_ROOT
  ? path.resolve(process.env.SAND_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const factory = await import(pathToFileURL(path.join(repoRoot, 'src/sand/wasmBridge/engineFactory.js')));
const hooks = await import(pathToFileURL(path.join(repoRoot, 'src/sand/wasmBridge/testHooks.js')));
const materials = await import(pathToFileURL(path.join(repoRoot, 'src/sand/materials.js')));
const { initSandWasm, createEngineWasm: createEngineWasmRaw } = factory;
const { attachTestHooks } = hooks;
const { KIND, MATERIALS, MAT } = materials;
const terrainRoot = process.env.TERRAIN_ROOT ? path.resolve(process.env.TERRAIN_ROOT) : repoRoot;
const terrainFactory = terrainRoot === repoRoot
  ? factory
  : await import(pathToFileURL(path.join(terrainRoot, 'src/sand/wasmBridge/engineFactory.js')));

const COLS = 512;
const ROWS = 384;
const MAX_TICKS = 360;
const STRUCTURAL = new Uint8Array(64);
for (const material of MATERIALS) {
  if (material.kind === KIND.COMPONENT) STRUCTURAL[material.id] = 1;
}

await initSandWasm();
if (terrainFactory !== factory) await terrainFactory.initSandWasm();
const createEngineWasm = (options) => attachTestHooks(createEngineWasmRaw(options));

function linePoints(x0, y0, x1, y1, spacing) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const count = Math.max(1, Math.ceil(steps / spacing));
  const out = [];
  for (let i = 0; i <= count; i++) {
    const a = i / count;
    out.push([Math.round(x0 + (x1 - x0) * a), Math.round(y0 + (y1 - y0) * a)]);
  }
  return out;
}

function uPoints(left, right, top, bottom, spacing) {
  return [
    ...linePoints(left, top, left, bottom, spacing),
    ...linePoints(left, bottom, right, bottom, spacing).slice(1),
    ...linePoints(right, bottom, right, top, spacing).slice(1),
  ];
}

function isStaticStructure(grid, owners, k) {
  return owners[k] < 0 && STRUCTURAL[grid[k]] !== 0 && grid[k] !== MAT.TNT;
}

function makeWorkspace(cellCount) {
  return {
    seen: new Int32Array(cellCount * 2),
    queue: new Int32Array(cellCount * 2),
    generation: 0,
  };
}

function floodAssembly(views, start, workspace, crossLayer) {
  const { grids, owners, grounded, cols, rows } = views;
  const n = cols * rows;
  let generation = ++workspace.generation;
  if (generation === 0x7fffffff) {
    workspace.seen.fill(0);
    generation = workspace.generation = 1;
  }
  let head = 0;
  let tail = 0;
  const add = (node) => {
    if (workspace.seen[node] === generation) return;
    const layer = node >= n ? 1 : 0;
    const k = node - layer * n;
    if (!isStaticStructure(grids[layer], owners[layer], k)) return;
    workspace.seen[node] = generation;
    workspace.queue[tail++] = node;
  };
  add(start);
  let groundedCells = 0;
  let touchesGroundSeed = false;
  let foregroundCells = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = cols;
  let minY = rows;
  let maxX = -1;
  let maxY = -1;
  const materialKinds = new Set();
  while (head < tail) {
    const node = workspace.queue[head++];
    const layer = node >= n ? 1 : 0;
    const k = node - layer * n;
    const x = k % cols;
    const y = Math.floor(k / cols);
    if (grounded[layer][k]) groundedCells++;
    if (y === rows - 1 || x === 1 || x === cols - 2 || y === 1) touchesGroundSeed = true;
    if (layer === 0) {
      foregroundCells++;
      sumX += x;
      sumY += y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      materialKinds.add(grids[0][k]);
    }
    for (let oy = -1; oy <= 1; oy++) {
      const ny = y + oy;
      if (ny <= 0 || ny >= rows) continue;
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = x + ox;
        if (nx <= 0 || nx >= cols - 1) continue;
        add(layer * n + ny * cols + nx);
      }
    }
    if (crossLayer) {
      const peer = layer ^ 1;
      const ownIce = grids[layer][k] === MAT.ICE;
      const peerIce = grids[peer][k] === MAT.ICE;
      if (ownIce === peerIce) add(peer * n + k);
    }
  }
  return {
    workspace,
    generation,
    size: tail,
    foregroundCells,
    groundedCells,
    touchesGroundSeed,
    meanX: foregroundCells ? sumX / foregroundCells : -1,
    meanY: foregroundCells ? sumY / foregroundCells : -1,
    minX,
    minY,
    maxX,
    maxY,
    materialKinds: materialKinds.size,
  };
}

function bodyKinds(engine, layer) {
  const kinds = new Map();
  const count = engine._bodyCountLayer(layer);
  for (let i = 0; i < count; i++) {
    kinds.set(engine._bodyIdLayer(layer, i), engine._bodyBlastDebrisLayer(layer, i) === 1);
  }
  return kinds;
}

function contactStats(engine, views, assembly) {
  const { grids, owners, cols, rows } = views;
  const n = cols * rows;
  const kinds = [bodyKinds(engine, 0), bodyKinds(engine, 1)];
  const contacts = {
    tnt: new Set(),
    debris: new Set(),
    otherBody: new Set(),
    static: new Set(),
    loose: new Set(),
    gas: new Set(),
    tntDown: new Set(),
    debrisDown: new Set(),
    otherBodyDown: new Set(),
    staticDown: new Set(),
    looseDown: new Set(),
    gasDown: new Set(),
  };
  const classify = (layer, k, down) => {
    const key = layer * n + k;
    const suffix = down ? 'Down' : '';
    const material = grids[layer][k];
    const owner = owners[layer][k];
    if (material === MAT.TNT) contacts[`tnt${suffix}`].add(key);
    else if (owner >= 0) {
      const kind = kinds[layer].get(owner) ? 'debris' : 'otherBody';
      contacts[`${kind}${suffix}`].add(key);
    } else if (STRUCTURAL[material]) contacts[`static${suffix}`].add(key);
    else if (material !== MAT.EMPTY && MATERIALS[material]?.kind === KIND.GAS) {
      contacts[`gas${suffix}`].add(key);
    } else if (material !== MAT.EMPTY) {
      contacts[`loose${suffix}`].add(key);
    }
  };
  for (let i = 0; i < assembly.size; i++) {
    const node = assembly.workspace.queue[i];
    const layer = node >= n ? 1 : 0;
    const k = node - layer * n;
    const x = k % cols;
    const y = Math.floor(k / cols);
    const neighbours = [
      [x - 1, y, false],
      [x + 1, y, false],
      [x, y - 1, false],
      [x, y + 1, true],
    ];
    for (const [nx, ny, down] of neighbours) {
      if (nx <= 0 || nx >= cols - 1 || ny <= 0 || ny >= rows) continue;
      const nk = ny * cols + nx;
      const neighbourNode = layer * n + nk;
      if (assembly.workspace.seen[neighbourNode] === assembly.generation) continue;
      classify(layer, nk, false);
      if (down) classify(layer, nk, true);
    }
  }
  return Object.fromEntries(Object.entries(contacts).map(([name, cells]) => [name, cells.size]));
}

function assemblyTrackingCell(assembly, cellCount) {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < assembly.size; i++) {
    const node = assembly.workspace.queue[i];
    if (node >= cellCount) continue;
    const x = node % COLS;
    const y = Math.floor(node / COLS);
    const distance = Math.abs(x - assembly.meanX) + Math.abs(y - assembly.meanY);
    if (distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

function countMaterial(grid, material) {
  let count = 0;
  for (const value of grid) if (value === material) count++;
  return count;
}

function countStaticStructure(grid, owners) {
  let count = 0;
  for (let k = 0; k < grid.length; k++) {
    if (isStaticStructure(grid, owners, k)) count++;
  }
  return count;
}

function behaviorFingerprint(trace) {
  const rows = trace.map((row) => ({
    tick: row.tick,
    trackingY: row.trackingY,
    dMeanY: row.dMeanY,
    disconnected: row.disconnected,
    grounded: row.grounded,
    edge: row.edge,
    cells: row.cells,
    fgCells: row.fgCells,
    meanY: row.meanY,
    minY: row.minY,
    maxY: row.maxY,
    tnt: row.tnt,
    bodies: row.bodies,
    contacts: row.contacts,
    componentCells: row.componentCells,
    gridComponentCells: row.gridComponentCells,
    dirtyCells: row.dirtyCells,
  }));
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function findTrackingCell(grid, owners, expectedX, expectedY) {
  let best = -1;
  let bestDistance = Infinity;
  for (let y = Math.max(2, expectedY - 12); y <= Math.min(ROWS - 2, expectedY + 12); y++) {
    for (let x = Math.max(2, expectedX - 12); x <= Math.min(COLS - 3, expectedX + 12); x++) {
      const k = y * COLS + x;
      if (!isStaticStructure(grid, owners, k)) continue;
      const distance = Math.abs(x - expectedX) + Math.abs(y - expectedY);
      if (distance < bestDistance) {
        best = k;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function currentViews(engine) {
  return {
    cols: COLS,
    rows: ROWS,
    grids: [engine.getGrid(), engine.getGridBg()],
    owners: [engine._bodyOwnerGrid(0), engine._bodyOwnerGrid(1)],
    grounded: [engine._groundedGrid(0), engine._groundedGrid(1)],
  };
}

function chooseTrackingCell(views, workspace, left, right, center, surface, bottom) {
  const { grids, owners } = views;
  const classified = new Uint8Array(COLS * ROWS);
  const targetY = Math.min(bottom - 32, surface + Math.floor((bottom - surface) * 0.42));
  let best = -1;
  let bestSize = 0;
  let bestDistance = Infinity;
  for (let y = Math.max(2, surface - 8); y <= bottom - 8; y++) {
    for (let x = left + 4; x <= right - 4; x++) {
      const k = y * COLS + x;
      if (classified[k] || !isStaticStructure(grids[0], owners[0], k)) continue;
      const candidate = floodAssembly(views, k, workspace, false);
      let candidateTrackingCell = -1;
      let candidateDistance = Infinity;
      for (let i = 0; i < candidate.size; i++) {
        const cell = candidate.workspace.queue[i];
        classified[cell] = 1;
        const cx = cell % COLS;
        const cy = Math.floor(cell / COLS);
        if (cx <= left + 8 || cx >= right - 8 || cy >= bottom - 16) continue;
        const distance = Math.abs(cx - center) + Math.abs(cy - targetY);
        if (distance < candidateDistance) {
          candidateTrackingCell = cell;
          candidateDistance = distance;
        }
      }
      if (candidate.touchesGroundSeed || candidateTrackingCell < 0) continue;
      if (candidate.foregroundCells > bestSize
          || (candidate.foregroundCells === bestSize && candidateDistance < bestDistance)) {
        best = candidateTrackingCell;
        bestSize = candidate.foregroundCells;
        bestDistance = candidateDistance;
      }
    }
  }
  return best;
}

const seeds = [
  0x00c0ffee, 7, 19, 0x5157, 0x0b1057, 0x5eed1234,
  0xdecafbad, 0x12345678, 0x31415926, 0xabcdef01,
];
const variants = [
  { width: 164, depth: 132, centerOffset: 0 },
  { width: 196, depth: 152, centerOffset: -34 },
  { width: 196, depth: 152, centerOffset: 34 },
  { width: 228, depth: 170, centerOffset: 0 },
  { width: 244, depth: 188, centerOffset: -28 },
  { width: 244, depth: 188, centerOffset: 28 },
];
const cases = [];
for (const seed of seeds) for (const variant of variants) cases.push({ seed, ...variant });

async function runCase(testCase, caseIndex) {
  const engine = createEngineWasm({
    cols: COLS,
    rows: ROWS,
    worldSeed: testCase.seed,
    sinksOn: false,
    infinite: true,
  });
  let source = null;
  let sourceSurfaces = null;
  if (terrainFactory !== factory) {
    source = terrainFactory.createEngineWasm({
      cols: COLS,
      rows: ROWS,
      worldSeed: testCase.seed,
      sinksOn: false,
      infinite: true,
    });
    const sourceOffsetX = source.getWorldOffsetX();
    sourceSurfaces = new Int32Array(COLS);
    for (let x = 0; x < COLS; x++) sourceSurfaces[x] = source.worldSurfaceAt(sourceOffsetX + x);
    const snapshot = source.serializeWorld();
    engine._resetTopology();
    engine.applyWorld(snapshot);
  }
  const center = Math.round(COLS / 2 + testCase.centerOffset);
  const left = Math.round(center - testCase.width / 2);
  const right = Math.round(center + testCase.width / 2);
  const offsetX = engine.getWorldOffsetX();
  const surfaceAt = sourceSurfaces
    ? (x) => sourceSurfaces[x]
    : (x) => engine.worldSurfaceAt(offsetX + x);
  let minSurface = ROWS;
  let maxSurface = 0;
  for (let x = left; x <= right; x += 4) {
    minSurface = Math.min(minSurface, surfaceAt(x));
    maxSurface = Math.max(maxSurface, surfaceAt(x));
  }
  const top = Math.max(5, minSurface - 14);
  const bottom = Math.min(ROWS - 38, maxSurface + testCase.depth);
  const path = uPoints(left, right, top, bottom, 3);

  for (const [x, y] of path) engine.eraseDiscLayer(0, x, y, 3);
  engine.syncComponentsLayer(0);
  let views = currentViews(engine);
  const foregroundWorkspace = makeWorkspace(COLS * ROWS);
  const unionWorkspace = makeWorkspace(COLS * ROWS);
  const trackingSource = chooseTrackingCell(
    views,
    foregroundWorkspace,
    left,
    right,
    center,
    surfaceAt(center),
    bottom,
  );
  if (trackingSource < 0) {
    source?.destroy();
    engine.destroy();
    return { skipped: 'no enclosed tracking cell' };
  }
  const trackingX = trackingSource % COLS;
  const trackingY = Math.floor(trackingSource / COLS);
  const before = floodAssembly(views, trackingSource, foregroundWorkspace, false);
  const bboxArea = Math.max(1, (before.maxX - before.minX + 1) * (before.maxY - before.minY + 1));
  const topology = {
    cells: before.foregroundCells,
    materials: before.materialKinds,
    fill: before.foregroundCells / bboxArea,
    bbox: [before.minX, before.minY, before.maxX, before.maxY],
  };
  if (before.foregroundCells < 3500 || before.touchesGroundSeed) {
    source?.destroy();
    engine.destroy();
    return { skipped: `unsuitable enclosed mass (${before.foregroundCells} cells, edge=${before.touchesGroundSeed})`, topology };
  }

  for (const [x, y] of path) engine.paintDiscLayer(0, x, y, 2, MAT.TNT, false);
  engine.syncComponentsLayer(0);
  const initialTnt = countMaterial(engine.getGrid(), MAT.TNT);
  let expectedTrackingX = trackingX;
  let expectedTrackingY = trackingY;
  let previousMeanY = null;
  let explosionStarted = false;
  let disconnectedTicks = 0;
  let everDisconnected = false;
  let landedTicks = 0;
  let fallingTicks = 0;
  let pendingPause = null;
  let reproduction = null;
  const trace = [];

  for (let tick = 0; tick < MAX_TICKS; tick++) {
    if (tick < 70) engine.paintDiscLayer(0, left, top - 4, 1, MAT.FIRE, false);
    engine.step();
    views = currentViews(engine);
    const trackingCell = findTrackingCell(
      views.grids[0],
      views.owners[0],
      expectedTrackingX,
      expectedTrackingY,
    );
    if (trackingCell < 0) {
      if (process.env.TRACE === '1') {
        const expected = expectedTrackingY * COLS + expectedTrackingX;
        console.error(JSON.stringify({
          lostTrackingCellAtTick: tick,
          expected: [expectedTrackingX, expectedTrackingY],
          material: views.grids[0][expected],
          owner: views.owners[0][expected],
        }));
      }
      break;
    }
    const tx = trackingCell % COLS;
    const ty = Math.floor(trackingCell / COLS);
    const tnt = countMaterial(views.grids[0], MAT.TNT) + countMaterial(views.grids[1], MAT.TNT);
    if (tnt < initialTnt) explosionStarted = true;
    const assembly = floodAssembly(views, trackingCell, unionWorkspace, true);
    const contacts = contactStats(engine, views, assembly);
    const disconnected = explosionStarted && assembly.groundedCells === 0 && !assembly.touchesGroundSeed;
    if (disconnected) {
      everDisconnected = true;
      landedTicks = 0;
    } else if (everDisconnected && assembly.groundedCells > 0) {
      landedTicks++;
    }
    const dMeanY = disconnected && previousMeanY !== null
      ? assembly.meanY - previousMeanY
      : 0;
    previousMeanY = disconnected ? assembly.meanY : null;
    if (disconnected) {
      const nextSeed = assemblyTrackingCell(assembly, COLS * ROWS);
      expectedTrackingX = nextSeed % COLS;
      expectedTrackingY = Math.floor(nextSeed / COLS) + 1;
    } else {
      expectedTrackingX = tx;
      expectedTrackingY = ty;
    }
    disconnectedTicks = disconnected ? disconnectedTicks + 1 : 0;
    if (disconnected && dMeanY > 0.75) fallingTicks++;
    const perf = engine.getPerf();
    const row = {
      tick,
      trackingY: ty,
      dMeanY: Number(dMeanY.toFixed(4)),
      disconnected,
      grounded: assembly.groundedCells,
      edge: assembly.touchesGroundSeed,
      cells: assembly.size,
      fgCells: assembly.foregroundCells,
      meanY: Number(assembly.meanY.toFixed(4)),
      minY: assembly.minY,
      maxY: assembly.maxY,
      tnt,
      bodies: engine._bodyCountLayer(0) + engine._bodyCountLayer(1),
      contacts,
      components: perf.componentCount,
      componentCells: perf.componentCellCount,
      gridComponentCells: countStaticStructure(views.grids[0], views.owners[0])
        + countStaticStructure(views.grids[1], views.owners[1]),
      stepMs: Number(perf.stepMs.toFixed(3)),
      dirtyCells: perf.dirtyCells,
      groundingMs: Number(perf.groundingMs.toFixed(3)),
      crossLayerGroundingMs: Number(perf.crossLayerGroundingMs.toFixed(3)),
      componentIndexMs: Number(perf.componentIndexMs.toFixed(3)),
      assemblyUnionMs: Number(perf.assemblyUnionMs.toFixed(3)),
      carryMs: Number(perf.carryMs.toFixed(3)),
      sandMs: Number(perf.sandMs.toFixed(3)),
      liquidMs: Number(perf.liquidMs.toFixed(3)),
      gasMs: Number(perf.gasMs.toFixed(3)),
      reactMs: Number(perf.reactMs.toFixed(3)),
      tailMs: Number(perf.tailMs.toFixed(3)),
      layersMs: Number(perf.layersMs.toFixed(3)),
      crossMs: Number(perf.crossMs.toFixed(3)),
      bodyMs: Number(perf.bodyMs.toFixed(3)),
    };
    trace.push(row);

    const ordinaryBlocker = contacts.staticDown > 0 || contacts.otherBodyDown > 0;
    if (disconnectedTicks >= 2 && fallingTicks >= 3 && dMeanY < 0.25 && !ordinaryBlocker && !pendingPause) {
      pendingPause = row;
    }
    if (pendingPause && dMeanY > 0.75) {
      reproduction = { pause: pendingPause, resume: row };
      break;
    }
    if (pendingPause && tick - pendingPause.tick > 80) pendingPause = null;
    if (disconnected && assembly.maxY >= ROWS - 25) break;
    if (landedTicks >= 3) break;
  }
  if (!reproduction && pendingPause) {
    reproduction = { pause: pendingPause, resume: null };
  }

  source?.destroy();
  engine.destroy();
  return {
    caseIndex,
    geometry: { ...testCase, left, right, top, bottom, trackingSeed: [trackingX, trackingY], initialTnt },
    topology,
    reproduction,
    trace,
  };
}

const requested = process.env.CASE_INDEX === undefined ? -1 : Number(process.env.CASE_INDEX);
const maxCases = Number(process.env.MAX_CASES || 30);
const expectReproduction = process.env.EXPECT_REPRO === '1';
const first = requested >= 0 ? requested : 0;
const last = requested >= 0 ? Math.min(cases.length, requested + 1) : Math.min(cases.length, maxCases);
let found = null;
let lastResult = null;
let verifiedCases = 0;
for (let index = first; index < last; index++) {
  const result = await runCase(cases[index], index);
  lastResult = result;
  if (result.skipped) {
    console.log(`case ${index}: skip — ${result.skipped}`);
    continue;
  }
  const moved = result.trace.filter((row) => row.dMeanY > 0.75).length;
  const disconnected = result.trace.filter((row) => row.disconnected).length;
  const peakBodies = Math.max(0, ...result.trace.map((row) => row.bodies));
  if (peakBodies > 0) verifiedCases++;
  console.log(
    `case ${index}: seed=${result.geometry.seed >>> 0} U=${result.geometry.width}x${result.geometry.depth}`
    + ` natural=${result.topology.cells} fill=${result.topology.fill.toFixed(3)} mats=${result.topology.materials}`
    + ` disconnectedTicks=${disconnected} movedTicks=${moved} peakBodies=${peakBodies}`
    + ` ${result.reproduction ? 'REPRODUCED' : 'no pause/resume'}`,
  );
  if (process.env.TRACE_WORST === '1') {
    const worst = result.trace
      .filter((row) => row.tnt < result.geometry.initialTnt)
      .sort((a, b) => b.stepMs - a.stepMs)
      .slice(0, 3);
    console.log(JSON.stringify({ worstExplosionTicks: worst }));
  }
  if (process.env.TRACE_FINGERPRINT === '1') {
    console.log(JSON.stringify({ behaviorFingerprint: behaviorFingerprint(result.trace) }));
  }
  if (result.reproduction) {
    found = result;
    break;
  }
}

if (!found) {
  if (process.env.TRACE === '1' && lastResult?.trace) {
    const rows = process.env.TRACE_ALL === '1'
      ? lastResult.trace
      : lastResult.trace.filter((row) => row.disconnected);
    console.log(JSON.stringify(rows, null, 2));
  }
  console.log(`no reproduction in cases [${first}, ${last})`);
  const requiredCases = requested >= 0 ? 1 : Math.min(6, last - first);
  if (verifiedCases < requiredCases) {
    console.error(`insufficient rigid detachments: verified ${verifiedCases}, required ${requiredCases}`);
    process.exit(1);
  }
  process.exit(expectReproduction ? 2 : 0);
}

const pauseTick = found.reproduction.pause.tick;
const resumeTick = found.reproduction.resume?.tick ?? pauseTick + 10;
const excerpt = found.trace.filter((row) => row.tick >= pauseTick - 8 && row.tick <= resumeTick + 5);
console.log(JSON.stringify({
  caseIndex: found.caseIndex,
  geometry: found.geometry,
  topology: found.topology,
  pause: found.reproduction.pause,
  resume: found.reproduction.resume,
  trace: excerpt,
}, null, 2));
process.exit(expectReproduction ? 0 : 1);
