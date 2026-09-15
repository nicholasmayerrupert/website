// Record the shipping solver's complete per-tick public body state and raster
// hashes. A comparison also produces a synchronized before/after filmstrip.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { trackRigidMotion } from './rigid-motion-metrics.mjs';

const args = process.argv.slice(2);
assert.ok(args.length === 2 && ['--record', '--compare', '--review'].includes(args[0]),
  'Usage: node scripts/rigid-motion-audit.mjs --record FILE | --compare FILE | --review FILE');
const referencePath = resolve(args[1]);
const outputPath = args[0] === '--record' ? referencePath
  : resolve(process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts/rigid-motion', 'candidate.json');
mkdirSync(dirname(outputPath), { recursive: true });
const cols = 320, rows = 320, floor = 300, steps = 600;
const rect = (x, y, w, h) => Array.from({ length: w * h }, (_, k) =>
  [x + k % w, y + Math.floor(k / w)]);
const digest = (array) => createHash('sha256').update(new Uint8Array(
  array.buffer, array.byteOffset, array.byteLength)).digest('hex');

function pivot(engine, size, offset, removeSupportFrom = null) {
  const thick = Math.max(3, Math.round(size / 8));
  const cells = rect(0, 0, size, size).filter(([x, y]) =>
    x < thick || x >= size - thick || y < thick || y >= size - thick);
  const grid = engine.getGrid();
  for (const [x, y] of rect(159, 200, 3, 100)) grid[y * cols + x] = MAT.STONE;
  engine.syncComponents();
  engine.spawnBody(cells.map(([x, y]) => [x + 160 - size / 2 + offset, y + 200 - size]));
  return (tick) => {
    if (removeSupportFrom === null || tick !== 60) return;
    for (let y = 200; y < floor; y++)
      for (let x = removeSupportFrom; x <= 161; x++) engine.eraseDisc(x, y, 0);
    engine.syncComponents();
  };
}
const cases = [
  ...[32, 128].flatMap((size) => [-1, 0, 1].map((side) => ({
    name: `pivot-${size}-${side}`, setup: (e) => pivot(e, size, side * Math.max(3, size / 16)),
  }))),
  { name: 'support-narrowing', setup: (e) => pivot(e, 128, 1, 160) },
  { name: 'support-removal', setup: (e) => pivot(e, 128, 0, 159), verify(ticks) {
    const resting = ticks[59].bodies[0];
    const released = ticks[60].bodies.find((body) => body.id === resting.id);
    const falling = ticks[100].bodies.find((body) => body.id === resting.id);
    assert.equal(resting.awake, 0, 'support-removal must release a sleeping body');
    assert.ok(released?.awake, 'removing the support must wake the body');
    assert.ok(falling && falling.py > resting.py + 10,
      'the released body must fall instead of sleeping in midair');
  } },
  { name: 'thin-rotating-beam', setup(e) {
    e.spawnBody(rect(50, 180, 200, 3));
    e._setBodyMotion(0, 0.4, 0.5, 0.035);
    e.spawnBody(rect(185, 260, 60, 5));
  } },
  { name: 'stack', setup(e) {
    for (let i = 0; i < 16; i++) e.spawnBody(rect(145, floor - 6 - i * 9, 30, 6));
  } },
  { name: 'floating-wood', setup(e) {
    const grid = e.getGrid();
    for (const [x, y] of rect(1, 230, cols - 2, floor - 230)) grid[y * cols + x] = MAT.WATER;
    e.spawnBox(160, 190, 20, 8, MAT.WOOD);
  } },
  { name: 'cross-layer-contact', layers: 2, setup(e) {
    // Component-aware placement joins the two material masks into one body.
    const masks = [rect(80, 180, 140, 6), rect(100, 180, 100, 10)];
    for (let layer = 0; layer < 2; layer++) {
      const grid = layer ? e.getGridBg() : e.getGrid();
      for (const [x, y] of masks[layer].slice(1)) grid[y * cols + x] = MAT.BRICK;
      e.syncComponentsLayer(layer);
    }
    for (let layer = 0; layer < 2; layer++)
      e.paintDiscLayer(layer, ...masks[layer][0], 0, MAT.BRICK, true);
    e.stepWorld();
    assert.ok(Array.from({ length: e._bodyCountLayer(0) }, (_, i) =>
      e._bodyJointRoleLayer(0, i)).includes(1), 'audit must exercise a joint body');
    e.spawnBody(rect(170, 270, 80, 8));
    e._setBodyMotion(0, 0.3, 0.4, 0.01);
  } },
];

function rasterFrame(engine, layerCount) {
  return Array.from({ length: layerCount }, (_, layer) => {
    const grid = layer ? engine.getGridBg() : engine.getGrid();
    const owners = engine._bodyOwnerGrid(layer);
    const runs = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols;) {
      const k = y * cols + x, material = grid[k], owner = owners[k];
      if (!material) { x++; continue; }
      const start = x++;
      while (x < cols && grid[y * cols + x] === material && owners[y * cols + x] === owner) x++;
      runs.push([start, y, x - start, material, owner]);
    }
    return runs;
  });
}

await initSandWasm();
const scenes = [];
for (const spec of cases) {
  const e = attachTestHooks(createEngineWasm({ cols, rows, worldSeed: 7, infinite: false, sinksOn: false }));
  const layers = spec.layers || 1;
  e.setBgEnabled(layers === 2);
  for (let layer = 0; layer < layers; layer++) {
    const grid = layer ? e.getGridBg() : e.getGrid();
    for (const [x, y] of rect(0, floor, cols, rows - floor)) grid[y * cols + x] = MAT.STONE;
    e.syncComponentsLayer(layer);
  }
  const action = spec.setup(e);
  const tracker = trackRigidMotion(e, 0, e._bodyIdLayer(0, 0));
  const ticks = [], frames = [];
  for (let tick = 0; tick < steps; tick++) {
    action?.(tick);
    e.stepWorld();
    tracker.sample(tick);
    const bodies = [], rasters = [];
    for (let layer = 0; layer < layers; layer++) {
      rasters.push({ grid: digest(layer ? e.getGridBg() : e.getGrid()), owner: digest(e._bodyOwnerGrid(layer)) });
      for (let i = 0; i < e._bodyCountLayer(layer); i++) {
        const state = e._bodyStateLayer(layer, i);
        assert.ok(Object.values(state).every((value) => typeof value !== 'number' || Number.isFinite(value)),
          `${spec.name}: finite state at ${tick}`);
        bodies.push({ layer, id: e._bodyIdLayer(layer, i), role: e._bodyJointRoleLayer(layer, i),
          awake: e._bodyAwakeLayer(layer, i), ...state });
      }
    }
    ticks.push({ tick, worldTick: e.getTick(), bodies, rasters });
    if (tick % 10 === 0 || tick === steps - 1) frames.push({ tick, layers: rasterFrame(e, layers) });
  }
  spec.verify?.(ticks);
  const motion = tracker.summary();
  scenes.push({ name: spec.name, ticks, frames, motion });
  console.log(`${spec.name}: ${ticks.length} ticks; max correction ${motion.maxCorrection.toFixed(6)}`);
  e.destroy();
}
const recording = { version: 1, cols, rows, steps, scenes };
writeFileSync(outputPath, JSON.stringify(recording));

function quality(scene) {
  const watched = scene.ticks[0].bodies[0];
  let first45 = -1, firstSleep = -1, maxAngle = 0, latePointSpeed = 0;
  for (const frame of scene.ticks) {
    const body = frame.bodies.find((b) => b.id === watched.id && b.layer === watched.layer);
    if (body) {
      const angle = Math.abs(body.angle) * 180 / Math.PI;
      maxAngle = Math.max(maxAngle, angle);
      if (first45 < 0 && angle >= 45) first45 = frame.tick;
      if (firstSleep < 0 && !body.awake) firstSleep = frame.tick;
    }
    if (frame.tick >= steps - 120)
      for (const b of frame.bodies)
        latePointSpeed = Math.max(latePointSpeed, Math.hypot(b.vx, b.vy) + Math.abs(b.omega) * b.maxR);
  }
  return { first45, firstSleep, maxAngle, latePointSpeed,
    finalAwake: scene.ticks.at(-1).bodies.filter((b) => b.role !== 2 && b.awake).length,
    maxCorrection: scene.motion.maxCorrection };
}

if (args[0] !== '--record') {
  const reference = JSON.parse(readFileSync(referencePath, 'utf8'));
  assert.deepEqual([reference.version, reference.cols, reference.rows, reference.steps], [1, cols, rows, steps]);
  assert.deepEqual(reference.scenes.map((s) => s.name), scenes.map((s) => s.name));
  const differences = [];
  for (let i = 0; i < scenes.length; i++) {
    const before = reference.scenes[i], after = scenes[i];
    const first = after.ticks.findIndex((tick, j) => JSON.stringify(tick) !== JSON.stringify(before.ticks[j]));
    const motionMatches = JSON.stringify(before.motion) === JSON.stringify(after.motion);
    if (first >= 0 || !motionMatches) differences.push({ scene: after.name, firstDifferentTick: first, motionMatches });
  }
  const metrics = scenes.map((scene, i) => ({ scene: scene.name,
    before: quality(reference.scenes[i]), after: quality(scene) }));
  const summary = { identical: !differences.length, scenes: scenes.length,
    ticks: scenes.length * steps, differences, metrics };
  writeFileSync(resolve(dirname(outputPath), 'comparison.json'), JSON.stringify(summary, null, 2));
  const visual = [reference, recording].map((r) => r.scenes.map(({ name, frames }) => ({ name, frames })));
  const data = JSON.stringify(visual).replaceAll('<', '\\u003c');
  const metricRows = metrics.map(({ scene, before, after }) => `<tr><td>${scene}</td>`
    + ['first45', 'firstSleep', 'latePointSpeed', 'finalAwake', 'maxCorrection']
      .map((key) => `<td>${before[key].toFixed(3)} → ${after[key].toFixed(3)}</td>`).join('') + '</tr>').join('');
  writeFileSync(resolve(dirname(outputPath), 'comparison.html'), `<!doctype html><meta charset="utf-8">
<title>Rigid motion comparison</title><style>body{background:#14212e;color:#eee;font:16px system-ui;margin:24px}canvas{width:42vw;max-width:640px;image-rendering:pixelated;background:#101820}section{display:flex;gap:24px}select,input,button{margin:12px}p{max-width:900px}</style>
<h1>Rigid motion comparison</h1><p>${summary.identical ? 'All per-tick body states, material/ownership hashes, and motion summaries match exactly.' : 'Motion differs. Compare toppling, settling, late movement, and correction travel alongside the regression suites; different motion alone is not a failure.'} Frames are sampled every 10 ticks. Colors distinguish moving body ownership from static terrain.</p>
<select id="scene"></select><button id="play">Play</button><input id="time" type="range" min="0" max="60" value="0"><span id="tick"></span>
<section><div><h2>Before</h2><canvas id="before" width="320" height="320"></canvas></div><div><h2>After</h2><canvas id="after" width="320" height="320"></canvas></div></section>
<p>Values show before → after. −1 means the event was not observed. First sleep can precede a later support removal; correction tracks the selected body and reports net travel per stage.</p>
<table cellpadding="8"><tr><th>Scene</th><th>First 45° tick</th><th>First sleep tick</th><th>Late point speed</th><th>Final awake</th><th>Max correction</th></tr>${metricRows}</table>
<script>
const data = ${data};
const scene = document.querySelector('#scene');
const time = document.querySelector('#time');
const play = document.querySelector('#play');
data[0].forEach((s, i) => scene.add(new Option(s.name, i)));
function draw() {
  for (let side = 0; side < 2; side++) {
    const frame = data[side][scene.value].frames[time.value];
    const context = document.querySelector(side ? '#after' : '#before').getContext('2d');
    context.clearRect(0, 0, 320, 320);
    for (let layer = frame.layers.length - 1; layer >= 0; layer--) {
      context.globalAlpha = layer ? 0.45 : 1;
      for (const [x, y, width, material, owner] of frame.layers[layer]) {
        context.fillStyle = owner >= 0 ? 'hsl(' + ((owner * 67) % 360) + ' 65% 65%)'
          : material === ${MAT.WATER} ? '#337abc' : '#77858e';
        context.fillRect(x, y, width, 1);
      }
    }
    document.querySelector('#tick').textContent = 'Tick ' + frame.tick;
  }
}
scene.onchange = time.oninput = draw;
let timer;
play.onclick = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
    play.textContent = 'Play';
  } else {
    play.textContent = 'Pause';
    timer = setInterval(() => {
      time.value = (+time.value + 1) % data[0][scene.value].frames.length;
      draw();
    }, 167);
  }
};
draw();
</script>`);
  console.log(JSON.stringify(summary, null, 2));
  if (differences.length && args[0] === '--compare') process.exitCode = 1;
}
