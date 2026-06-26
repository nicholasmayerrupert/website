// Deterministic regression tests for hand-drawn rigid-body collisions.
//
//   node scripts/rigid-collision-test.mjs
//
// Focus: thin shapes must not pass through one another, off-centre impacts must
// use surface-appropriate (mask-derived) normals rather than a centre-to-centre
// normal, fast/rotating thin bodies must not tunnel, and resting contacts must
// stay stable for long simulations — at several timestep groupings.

import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';

const COLS = 200, ROWS = 140, SEED = 0xC0FFEE, STONE = 3, RIGID = 13;
await initSandWasm();
const mk = (opts = {}) => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, ...opts });

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };

// Drive `steps` ticks; dtGroup lets a test advance the clock in coarser jumps to
// vary the per-tick substep grouping without changing the number of ticks.
const run = (e, steps, t0 = 0, dtGroup = 16) => { let t = t0; for (let i = 0; i < steps; i++) { t += dtGroup; e.step(t); } return t; };

// Solid stone shelf/pillars the bodies can rest on (static terrain).
const stoneRect = (e, x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) e.paintDisc(x, y, 0, STONE, true); };
const vbarCells = (cx, yTop, len) => { const c = []; for (let y = 0; y < len; y++) c.push([cx, yTop + y]); return c; };
const hbarCells = (xLeft, cy, len) => { const c = []; for (let x = 0; x < len; x++) c.push([xLeft + x, cy]); return c; };
const rigidBottom = (g) => { let b = -1; for (let i = 0; i < g.length; i++) if (g[i] === RIGID) b = Math.max(b, (i / COLS) | 0); return b; };

// ---------------------------------------------------------------------------
// Two horizontal pillars with an open gap between them, a thin horizontal bar
// bridging across the top resting on the pillars, and a thin vertical bar
// dropped onto the bridge over the gap. If the vertical bar tunnels through the
// bridge it falls into the gap and lands on the deep floor; if collisions work
// it comes to rest on the bridge well above the floor.
function bridgeScene(e, { dropX = 100, dropVy = 0 } = {}) {
  const L = 70, R = 130, bridgeY = 50, pillarTop = bridgeY + 1, floorY = ROWS - 2;
  stoneRect(e, 0, floorY, COLS - 1, ROWS - 1);              // deep floor
  stoneRect(e, L - 2, pillarTop, L + 1, floorY - 1);         // left pillar
  stoneRect(e, R - 1, pillarTop, R + 2, floorY - 1);         // right pillar
  e.syncComponents();
  e.spawnBody(hbarCells(L - 4, bridgeY, R - L + 9));        // bridge bar spans both pillars (idx 0)
  run(e, 200);                                              // let the bridge settle
  const vIdx = e._bodyCount();
  e.spawnBody(vbarCells(dropX, bridgeY - 22, 18));          // dropper bar
  if (dropVy) e._setBodyMotion(vIdx, 0, dropVy, 0);
  return { vIdx, bridgeY, floorY };
}

// 1. Vertical bar dropped centred onto a horizontal bridge — at several dt groups.
for (const dt of [16, 8, 33, 50]) {
  console.log(`vertical-on-horizontal bridge (dt=${dt})`);
  const e = mk();
  const { vIdx, bridgeY, floorY } = bridgeScene(e);
  let t = 200 * 16;
  t = run(e, 500, t, dt);
  const v = e._bodyState(vIdx);
  check(`dropper did not tunnel into the gap (py ${v.py.toFixed(1)} << floor ${floorY})`, v.py < bridgeY + 6);
  check(`dropper came to rest (|vy| ${Math.abs(v.vy).toFixed(3)})`, Math.abs(v.vy) < 0.05);
  e.destroy();
}

// 2. Off-centre landing: the vertical bar lands near the bridge end. It must not
//    tunnel and must not be flung sideways by a bogus diagonal normal.
{
  console.log('off-centre vertical-on-horizontal');
  const e = mk();
  const { vIdx, bridgeY, floorY } = bridgeScene(e, { dropX: 88 });
  let t = 200 * 16;
  const x0 = e._bodyState(vIdx).px;
  t = run(e, 500, t, 16);
  const v = e._bodyState(vIdx);
  check(`off-centre dropper did not tunnel (py ${v.py.toFixed(1)})`, v.py < bridgeY + 6);
  check(`off-centre dropper not flung sideways (|dx| ${Math.abs(v.px - x0).toFixed(1)})`, Math.abs(v.px - x0) < 12);
  e.destroy();
}

// 2b. Surface-normal correctness: a thin vertical bar dropped well off-centre onto
//     a wide horizontal platform body must receive an ~upward (mask-derived) normal.
//     A centre-to-centre normal would instead shove the bar sideways and spin it.
{
  console.log('off-centre impact uses an upward surface normal');
  const e = mk();
  stoneRect(e, 0, ROWS - 2, COLS - 1, ROWS - 1);
  e.syncComponents();
  // wide platform body (40 x 3) resting on the floor
  const plat = [];
  for (let x = 0; x < 40; x++) for (let y = 0; y < 3; y++) plat.push([60 + x, ROWS - 6 + y]);
  e.spawnBody(plat);
  run(e, 150);
  // vertical bar dropped near the platform's left end (well off the platform centre ~x80)
  const vIdx = e._bodyCount();
  e.spawnBody(vbarCells(66, ROWS - 30, 14));
  const x0 = e._bodyState(vIdx).px;
  let t = 150 * 16, peakVx = 0;
  for (let i = 0; i < 400; i++) { t += 16; e.step(t); const s = e._bodyState(vIdx); peakVx = Math.max(peakVx, Math.abs(s.vx)); }
  const v = e._bodyState(vIdx);
  // With an upward normal the bar barely gains horizontal speed and barely rotates.
  check(`bar not accelerated sideways by impact (peak|vx| ${peakVx.toFixed(3)})`, peakVx < 0.5);
  check(`bar barely rotated (|angle| ${Math.abs(v.angle).toFixed(3)})`, Math.abs(v.angle) < 0.25);
  check(`bar rests on the platform, not pushed off (|dx| ${Math.abs(v.px - x0).toFixed(2)})`, Math.abs(v.px - x0) < 4);
  e.destroy();
}

// 3. Fast thin body crossing another thin body. A horizontal bar is fired at high
//    speed toward a thin vertical wall body; it must be stopped, not tunnel past.
{
  console.log('fast thin body crossing a thin wall');
  const e = mk();
  stoneRect(e, 0, ROWS - 2, COLS - 1, ROWS - 1);
  e.syncComponents();
  // Tall thin vertical wall, supported on the floor (stays put as a heavy body).
  const wallIdx = e._bodyCount();
  e.spawnBody(vbarCells(120, ROWS - 40, 36));
  run(e, 150); // settle the wall on the floor
  // Horizontal bar to the left of the wall, fired rightward fast.
  const projIdx = e._bodyCount();
  const wy = (ROWS - 40 + 18) | 0;
  e.spawnBody(hbarCells(70, wy, 16));
  e._setBodyMotion(projIdx, 6.0, 0, 0); // well above R_MAX_SPEED; engine clamps
  let t = 150 * 16;
  t = run(e, 120, t, 16);
  const p = e._bodyState(projIdx), w = e._bodyState(wallIdx);
  // The projectile's right edge must not have crossed past the wall centre.
  check(`fast projectile stopped at the wall (proj.px ${p.px.toFixed(1)} < wall.px ${w.px.toFixed(1)})`, p.px + 8 < w.px + 4);
  e.destroy();
}

// 4. A long rotating bar striking another body with its endpoint (angular tip
//    speed, not centre speed). The spinning bar must not tunnel its tip through
//    a small target resting just within its sweep.
{
  console.log('rotating bar endpoint strike');
  const e = mk();
  stoneRect(e, 0, ROWS - 2, COLS - 1, ROWS - 1);
  // Pedestal + small target box resting on it, below the bar's right endpoint.
  stoneRect(e, 112, 70, 116, ROWS - 3);
  e.syncComponents();
  const targetIdx = e._bodyCount();
  e.spawnBody([[113, 67], [114, 67], [113, 68], [114, 68]]);
  run(e, 60);
  // Long horizontal bar (centre ~x100,y60). Spun so its right tip sweeps down
  // through the target. Tip speed (|omega|*maxR) is what must drive the substeps;
  // the bar's centre barely moves, so a centre-velocity scheme would tunnel it.
  const barIdx = e._bodyCount();
  e.spawnBody(hbarCells(85, 60, 30)); // spans x 85..114, centre ~99.5
  e._setBodyMotion(barIdx, 0, 0, 0.2);
  const before = e._bodyState(targetIdx);
  let t = 60 * 16;
  t = run(e, 25, t, 16);
  const after = e._bodyState(targetIdx);
  // The target must have been disturbed (struck), proving the tip didn't tunnel
  // straight through it without generating contact.
  const moved = Math.hypot(after.px - before.px, after.py - before.py) + Math.abs(after.angle - before.angle);
  check(`rotating tip transferred contact to the target (moved ${moved.toFixed(3)})`, moved > 0.02);
  e.destroy();
}

// 5. Two irregular concave hand-drawn bodies colliding keep their occupancy shape
//    (cell counts preserved) and separate rather than fusing/passing through.
{
  console.log('concave bodies collide and keep their shape');
  const e = mk();
  stoneRect(e, 0, ROWS - 2, COLS - 1, ROWS - 1);
  e.syncComponents();
  // An L / hook shape (concave) resting on the floor.
  const hook = [];
  for (let y = 0; y < 12; y++) hook.push([90, ROWS - 4 - y]);     // vertical stem
  for (let x = 1; x < 10; x++) hook.push([90 + x, ROWS - 4]);     // foot
  const hookIdx = e._bodyCount();
  e.spawnBody(hook);
  const hookCells0 = hook.length;
  run(e, 120);
  // A U / cup shape dropped onto it.
  const cup = [];
  for (let y = 0; y < 8; y++) { cup.push([80, ROWS - 30 - y]); cup.push([88, ROWS - 30 - y]); }
  for (let x = 1; x < 8; x++) cup.push([80 + x, ROWS - 30]);
  const cupIdx = e._bodyCount();
  e.spawnBody(cup);
  const cupCells0 = cup.length;
  let t = 120 * 16;
  t = run(e, 400, t, 16);
  const cnt = (id) => { const s = e._bodyState(id); return s ? s.nPts : -1; };
  check(`hook kept its cells (${cnt(hookIdx)}/${hookCells0})`, cnt(hookIdx) === hookCells0);
  check(`cup kept its cells (${cnt(cupIdx)}/${cupCells0})`, cnt(cupIdx) === cupCells0);
  check(`both concave bodies still present (${e._bodyCount()} >= 2)`, e._bodyCount() >= 2);
  e.destroy();
}

// 6. A thin body resting on another body for many ticks must not sink through or
//    drift — resting contacts stay stable for a long simulation.
{
  console.log('thin body rests on another for a long time');
  const e = mk();
  stoneRect(e, 0, ROWS - 2, COLS - 1, ROWS - 1);
  e.syncComponents();
  // A 3-thick beam resting on the floor as the support body.
  const beam = [];
  for (let x = 0; x < 24; x++) for (let y = 0; y < 3; y++) beam.push([80 + x, ROWS - 6 + y]);
  const beamIdx = e._bodyCount();
  e.spawnBody(beam);
  run(e, 150);
  // A thin horizontal bar laid on the beam.
  const barIdx = e._bodyCount();
  e.spawnBody(hbarCells(85, ROWS - 7, 14));
  let t = 150 * 16;
  t = run(e, 300, t, 16);
  const mid = e._bodyState(barIdx);
  t = run(e, 1200, t, 16); // long rest
  const end = e._bodyState(barIdx);
  check(`resting bar did not sink over time (dy ${Math.abs(end.py - mid.py).toFixed(2)})`, Math.abs(end.py - mid.py) < 1.0);
  check(`resting bar did not drift sideways (dx ${Math.abs(end.px - mid.px).toFixed(2)})`, Math.abs(end.px - mid.px) < 1.0);
  check(`resting bar kept its cells (${end.nPts}/14)`, end.nPts === 14);
  e.destroy();
}

// 7. Determinism: the same scenario run twice yields identical final pose.
{
  console.log('determinism');
  const finalPose = () => {
    const e = mk();
    const { vIdx } = bridgeScene(e);
    run(e, 500, 200 * 16, 16);
    const v = e._bodyState(vIdx);
    e.destroy();
    return v;
  };
  const a = finalPose(), b = finalPose();
  check(`deterministic px (${a.px} == ${b.px})`, a.px === b.px);
  check(`deterministic py (${a.py} == ${b.py})`, a.py === b.py);
  check(`deterministic angle`, a.angle === b.angle);
  e_done();
  function e_done() {}
}

console.log(failures ? `\n${failures} checks FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
