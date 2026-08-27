// Replay the captured TNT cut that left a dual-layer island hanging in mid-air.
// The capsule is the original creative session (seed, strokes, camera, gates).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initSandWasm,
  createEngineWasm as createEngineWasmRaw,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { CREATIVE_KIND } from '../src/sand/wasmBridge/abi.generated.js';
import { MAT_CLASS, MC } from '../src/sand/materials.js';
import {
  decodeReplayCapsule,
  replayAbiMatches,
} from '../src/sand/game/replayCapsule.js';
import { SIM_STEP_MS } from '../src/sand/timing/fixedRateClock.js';
import { makeChecker } from './sand-test-util.mjs';

const CAPSULE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'tnt-floating-island.sand-replay',
);
const STREAM_MARGIN = 40;
const LIVE_SIM_COLS = 512;
const LIVE_SIM_ROWS = 352;
const REPLAY_GATE_AWAITING_ACK = 1;
const SAMPLE_TURNS = [610, 692, 955, 1012, 1200, 1280, 1330];
const LARGE_JOINT_CELLS = 800;
const AIR_BAND_WORLD_Y = 80;

await initSandWasm();
const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));
const { check, done } = makeChecker('TNT-cut island falls instead of hanging');

const capsule = await decodeReplayCapsule(
  readFileSync(CAPSULE_PATH, 'utf8').trim(),
);
check('capsule ABI matches this engine', replayAbiMatches(capsule));

const init = capsule.init;
const engine = createEngineWasm({
  cols: init.cols,
  rows: init.rows,
  worldSeed: init.worldSeed >>> 0,
  infinite: true,
  sinksOn: false,
  storageRole: 'authority',
  planetId: init.planetId,
  gravityScale: init.gravityScale,
});
engine.setWeather(init.weatherId | 0);
engine.setPlayMode(!!init.survival);
engine.setSurvivalInventory(!!init.survival);
engine.setDrawMode(!!init.drawMode);
engine.setCreativeMaterial(init.creativeKind | 0, init.creativeValue | 0);
engine.setTool(init.tool | 0);
const creatureSimulationRequested = (init.creativeKind | 0) === CREATIVE_KIND.CREATURE;
engine.setCreatureRuntime(
  !!init.creatureNaturalSpawning || creatureSimulationRequested,
  !!init.creatureNaturalSpawning,
);

let control = null;
let liveSimulationFocus = null;
let edges = [];
let workerButtons = 0;
let eventIndex = 0;
let gateIndex = 0;

const toLocal = (worldX, worldY) => ({
  x: Math.floor(worldX - engine.getWorldOffsetX()),
  y: Math.floor(worldY - engine.getWorldOffsetY()),
});

const simulationFocusRect = () => {
  const width = Math.min(engine.cols, LIVE_SIM_COLS);
  const height = Math.min(engine.rows, LIVE_SIM_ROWS);
  const worldOffsetX = engine.getWorldOffsetX();
  const worldOffsetY = engine.getWorldOffsetY();
  const centerX = Math.floor(control.camWorldX + control.viewCols * 0.5);
  const centerY = Math.floor(control.camWorldY + control.viewRows * 0.5);
  const worldX0 = Math.max(
    worldOffsetX,
    Math.min(worldOffsetX + engine.cols - width, centerX - Math.floor(width / 2)),
  );
  const worldY0 = Math.max(
    worldOffsetY,
    Math.min(worldOffsetY + engine.rows - height, centerY - Math.floor(height / 2)),
  );
  return { x0: worldX0, y0: worldY0, x1: worldX0 + width, y1: worldY0 + height };
};

const activateWorldRect = (rect) => {
  const offsetX = engine.getWorldOffsetX();
  const offsetY = engine.getWorldOffsetY();
  engine.activateSimulationRect(
    rect.x0 - offsetX, rect.y0 - offsetY,
    rect.x1 - offsetX, rect.y1 - offsetY,
  );
};

const refreshSimulationFocus = (reset = false, preserveReplicaDirty = false) => {
  if (!control) return;
  const next = simulationFocusRect();
  const previous = liveSimulationFocus;
  if (reset || !previous) {
    engine.resetSimulationActivity(preserveReplicaDirty);
    activateWorldRect(next);
  } else if (next.x0 !== previous.x0 || next.y0 !== previous.y0
      || next.x1 !== previous.x1 || next.y1 !== previous.y1) {
    const ix0 = Math.max(previous.x0, next.x0);
    const iy0 = Math.max(previous.y0, next.y0);
    const ix1 = Math.min(previous.x1, next.x1);
    const iy1 = Math.min(previous.y1, next.y1);
    if (ix0 >= ix1 || iy0 >= iy1) {
      activateWorldRect(next);
    } else {
      activateWorldRect({ x0: next.x0, y0: next.y0, x1: next.x1, y1: iy0 });
      activateWorldRect({ x0: next.x0, y0: iy1, x1: next.x1, y1: next.y1 });
      activateWorldRect({ x0: next.x0, y0: iy0, x1: ix0, y1: iy1 });
      activateWorldRect({ x0: ix1, y0: iy0, x1: next.x1, y1: iy1 });
    }
  }
  liveSimulationFocus = next;
};

const applyMessage = (data) => {
  if (data.type === 'control') {
    control = data;
    refreshSimulationFocus();
  } else if (data.type === 'edge') {
    edges.push(data);
  } else if (data.type === 'config') {
    if (data.tool !== undefined) engine.setTool(data.tool | 0);
    if (data.drawMode !== undefined) engine.setDrawMode(!!data.drawMode);
    if (data.creativeKind !== undefined) {
      engine.setCreativeMaterial(data.creativeKind | 0, data.creativeValue | 0);
    }
  } else if (data.type === 'weather') {
    engine.setWeather(data.weatherId | 0);
  }
};

const applyEventsAt = (turn) => {
  while (eventIndex < capsule.events.length
      && capsule.events[eventIndex].tick === turn) {
    applyMessage(capsule.events[eventIndex].message);
    eventIndex++;
  }
};

const applyGate = (turn) => {
  while (gateIndex < capsule.gates.length
      && capsule.gates[gateIndex].end <= turn) gateIndex++;
  const gate = capsule.gates[gateIndex];
  return gate && gate.start <= turn && turn < gate.end ? gate.flags : 0;
};

const streamForControl = (blockedByTransport) => {
  if (!control || control.suspendStreaming || blockedByTransport) return false;
  if (control.viewCols + STREAM_MARGIN * 2 > engine.cols
      || control.viewRows + STREAM_MARGIN * 2 > engine.rows) return false;
  const localX = Math.floor(control.camWorldX - engine.getWorldOffsetX());
  const localY = Math.floor(control.camWorldY - engine.getWorldOffsetY());
  engine.prefetchAdvance(localX, localY, control.viewCols, control.viewRows);
  const dx = engine.maybeShiftWorld(localX, control.viewCols, STREAM_MARGIN);
  const dy = engine.maybeShiftWorldV(localY, control.viewRows, STREAM_MARGIN);
  return !!(dx || dy);
};

const applyEdges = () => {
  for (const edge of edges) {
    if (edge.button !== 0 && edge.button !== 2) continue;
    const p = toLocal(edge.worldX, edge.worldY);
    if (control) {
      control.worldX = edge.worldX;
      control.worldY = edge.worldY;
      control.buttons = edge.buttons | 0;
      control.inside = !!edge.inside;
      control.drawMode = !!edge.drawMode;
    }
    if (edge.kind === 'down') {
      workerButtons |= edge.button === 2 ? 2 : 1;
      engine.pointerDown(p.x, p.y, edge.button);
    } else {
      engine.pointerDraft(p.x, p.y);
      engine.pointerUp(edge.button);
      workerButtons &= ~(edge.button === 2 ? 2 : 1);
    }
  }
  edges = [];
};

const applyContinuous = (now) => {
  if (!control) return;
  const released = workerButtons & ~(control.buttons | 0);
  if (released & 1) engine.pointerUp(0);
  if (released & 2) engine.pointerUp(2);
  workerButtons = control.buttons | 0;
  engine.pointerButtons(control.buttons | 0);
  const p = toLocal(control.worldX, control.worldY);
  engine.pointerDraft(p.x, p.y);
  engine.applyTool(p.x, p.y, now, !!control.inside, !!control.drawMode);
};

const executeTurn = (flags) => {
  const shifted = streamForControl(!!(flags & REPLAY_GATE_AWAITING_ACK));
  if (shifted) refreshSimulationFocus(true, true);
  if (control && Number.isFinite(control.camWorldX)
      && Number.isFinite(control.camWorldY)) {
    const viewCols = Math.max(1, Math.min(engine.cols, control.viewCols | 0));
    const viewRows = Math.max(1, Math.min(engine.rows, control.viewRows | 0));
    engine.setViewport(1, 1, viewCols, viewRows);
    engine.cameraSet(
      control.camWorldX - engine.getWorldOffsetX(),
      control.camWorldY - engine.getWorldOffsetY(),
    );
  }
  applyEdges();
  applyContinuous(engine.getTick() * SIM_STEP_MS);
  engine.stepActors();
  engine.stepWorld();
};

const largestJointLeader = () => {
  let best = null;
  for (let i = 0; i < engine._bodyCountLayer(0); i++) {
    if (engine._bodyJointRoleLayer(0, i) !== 1) continue;
    const state = engine._bodyStateLayer(0, i);
    if (!state || state.nPts < LARGE_JOINT_CELLS) continue;
    if (!best || state.nPts > best.nPts) {
      best = {
        id: engine._bodyIdLayer(0, i),
        index: i,
        nPts: state.nPts,
        maxR: state.maxR,
        px: state.px,
        py: state.py,
        worldX: state.px + engine.getWorldOffsetX(),
        worldY: state.py + engine.getWorldOffsetY(),
        offsetX: engine.getWorldOffsetX(),
        offsetY: engine.getWorldOffsetY(),
        vx: state.vx,
        vy: state.vy,
        awake: !!engine._bodyAwakeLayer(0, i),
        stillTicks: state.stillTicks,
        sleepSupports: state.sleepSupports,
      };
    }
  }
  return best;
};

const samples = new Map();
const jointsAt1012 = [];
applyEventsAt(0);
for (let turn = 0; turn < capsule.turns; turn++) {
  applyEventsAt(turn);
  executeTurn(applyGate(turn));
  if (SAMPLE_TURNS.includes(turn + 1)) samples.set(turn + 1, largestJointLeader());
  if (turn + 1 === 1012) {
    for (let i = 0; i < engine._bodyCountLayer(0); i++) {
      if (engine._bodyJointRoleLayer(0, i) !== 1) continue;
      const state = engine._bodyStateLayer(0, i);
      if (!state || state.nPts < LARGE_JOINT_CELLS) continue;
      jointsAt1012.push({
        id: engine._bodyIdLayer(0, i),
        nPts: state.nPts,
        awake: !!engine._bodyAwakeLayer(0, i),
        sleepSupports: state.sleepSupports,
      });
    }
  }
}
applyEventsAt(capsule.turns);

const midReplayBodies = SAMPLE_TURNS
  .filter((turn) => turn < capsule.turns)
  .map((turn) => samples.get(turn))
  .filter(Boolean);
for (const turn of SAMPLE_TURNS) {
  const body = samples.get(turn);
  if (!body) continue;
  check(`${turn}: id=${body.id} nPts=${body.nPts} local=(${body.px.toFixed(1)},${body.py.toFixed(1)}) worldY=${body.worldY.toFixed(1)} offset=(${body.offsetX},${body.offsetY}) vy=${body.vy.toFixed(2)} awake=${body.awake} supports=${body.sleepSupports} still=${body.stillTicks}`,
    true);
}

check('replay produced a large dual-layer cut body', midReplayBodies.length > 0);

const at1012 = samples.get(1012);
const at1200 = samples.get(1200);
const at1280 = samples.get(1280);
const at1330 = samples.get(1330);

if (at1012) {
  check(`cut island is not asleep without supports at 1012 (awake=${at1012.awake}, supports=${at1012.sleepSupports})`,
    at1012.awake || at1012.sleepSupports > 0);
}
for (const body of jointsAt1012) {
  check(`1012 joint id=${body.id} nPts=${body.nPts} is not asleep without supports (awake=${body.awake}, supports=${body.sleepSupports})`,
    body.awake || body.sleepSupports > 0);
}

if (at1200 && at1280
    && at1200.id === at1280.id
    && at1200.nPts >= LARGE_JOINT_CELLS) {
  const frozenPose = Math.abs(at1280.worldY - at1200.worldY) < 0.25
    && Math.abs(at1200.vy) > 1;
  check(`cut island is not frozen in place while reporting fall speed (Δy=${(at1280.worldY - at1200.worldY).toFixed(2)}, vy=${at1200.vy.toFixed(2)})`,
    !frozenPose);
}

const airborneRigidCells = () => {
  let count = 0;
  const offsetY = engine.getWorldOffsetY();
  for (const layer of [0, 1]) {
    const grid = layer ? engine.getGridBg() : engine.getGrid();
    const grounded = engine._groundedGrid(layer);
    const owners = engine._bodyOwnerGrid(layer);
    for (let y = 0; y < engine.rows; y++) {
      if (y + offsetY >= AIR_BAND_WORLD_Y) continue;
      for (let x = 0; x < engine.cols; x++) {
        const k = y * engine.cols + x;
        if (MAT_CLASS[grid[k]] !== MC.RIGID) continue;
        if (grounded[k] || owners[k] >= 0) continue;
        count++;
      }
    }
  }
  return count;
};

if (at1330) {
  const hung = at1330.worldY < AIR_BAND_WORLD_Y
    && (at1330.sleepSupports === 0)
    && (at1330.stillTicks >= 20 || !at1330.awake
      || (Math.abs(at1330.vy) > 1 && at1200
        && at1200.id === at1330.id
        && Math.abs(at1330.worldY - at1200.worldY) < 8));
  check(`cut island is not parked in mid-air at 1330 (worldY=${at1330.worldY.toFixed(1)}, awake=${at1330.awake})`,
    !hung);
} else {
  check('cut island left the solver by landing or breaking up', true);
}

const bakedAir = airborneRigidCells();
check(`cut island did not bake into floating terrain (${bakedAir} ungrounded rigid cells above y=${AIR_BAND_WORLD_Y})`,
  bakedAir < 400);

engine.destroy();
const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
