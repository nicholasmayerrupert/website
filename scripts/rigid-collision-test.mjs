// Deterministic regression tests for hand-drawn rigid-body collisions.
//
//   node scripts/rigid-collision-test.mjs
//
// Focus: thin shapes must not pass through one another, off-centre impacts must
// use surface-appropriate (mask-derived) normals rather than a centre-to-centre
// normal, fast/rotating thin bodies must not tunnel, and resting contacts must
// stay stable for long simulations — at several timestep groupings. The loaded
// buffer rim also acts as a wall so a body's own motion can't carry it off the
// simulated window (where its raster is clipped away and it vanishes).

import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';

const COLS = 200, ROWS = 140, SEED = 0xC0FFEE, STONE = 3, RIGID = 13, DRIFTWOOD = 14;
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

// 7. Render-boundary wall: a body driven off the loaded buffer by its own motion
// must stop at the rim and keep all its cells, not silently vanish (its raster
// would otherwise be clipped away the moment it leaves the simulated window).
{
  console.log('render boundary acts as a wall');
  // Rightward: clear open air toward the +x edge — no terrain involved.
  {
    const e = mk();
    const idx = e._bodyCount();
    e.spawnBody(hbarCells(COLS - 30, 30, 12));   // thin bar near the right edge
    e._setBodyMotion(idx, 6.0, 0, 0);            // hurl it at the rim (fast → would tunnel a naive check)
    run(e, 400);
    const s = e._bodyState(idx);
    check(`body stopped inside the right rim (px ${s.px.toFixed(1)} < ${COLS})`, s && s.px < COLS);
    check(`body still present at the rim (${s ? s.nPts : -1}/12)`, s && s.nPts === 12);
    e.destroy();
  }
  // Downward: nothing painted below — without the wall it falls past ROWS and dies.
  {
    const e = mk();
    const idx = e._bodyCount();
    e.spawnBody(vbarCells(20, 20, 12));          // bar near the left, high up
    e._setBodyMotion(idx, 0, 6.0, 0);            // drive it straight down hard
    run(e, 400);
    const s = e._bodyState(idx);
    check(`body did not fall through the bottom rim (py ${s ? s.py.toFixed(1) : 'gone'} <= ${ROWS})`, s && s.py <= ROWS);
    check(`body still present after the drop (${s ? s.nPts : -1}/12)`, s && s.nPts === 12);
    e.destroy();
  }
}

// 8. Buoyancy: a body lighter than the fluid part-submerges and floats (it no
//    longer rests on top of a denser fluid as if it were solid); a body denser
//    than the fluid sinks through to the floor. Fluid mass is conserved.
{
  const WATER = 2, WOOD = 8;                                 // water density 1.0, wood 0.6
  const x0 = 40, x1 = 160, yTop = 50, yBot = 110;            // walled pool with a stone floor
  const buildPool = (e) => {
    for (let y = yTop - 1; y <= yBot + 1; y++) { e.paintDisc(x0 - 1, y, 0, STONE, true); e.paintDisc(x1 + 1, y, 0, STONE, true); }
    for (let x = x0 - 1; x <= x1 + 1; x++) e.paintDisc(x, yBot + 1, 0, STONE, true);
    e.syncComponents();
    for (let y = yTop; y <= yBot; y++) for (let x = x0; x <= x1; x++) e.paintDisc(x, y, 0, WATER, true);
  };
  const waterCount = (e) => { const g = e.getGrid(); let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === WATER) n++; return n; };
  // Bodies stamp their REAL material into the grid now, so track each body by the
  // material it was spawned with (a WOOD body reads WOOD, a RIGID body reads RIGID).
  const bodyBottom = (e, mat) => { const g = e.getGrid(); let b = -1; for (let i = 0; i < g.length; i++) if (g[i] === mat) b = Math.max(b, (i / COLS) | 0); return b; };
  const surfaceY = (e) => { const g = e.getGrid(); for (let i = 0; i < g.length; i++) if (g[i] === WATER) return (i / COLS) | 0; return ROWS; };

  { // Light body (wood) floats part-submerged and stays put.
    console.log('light body part-submerges in a denser fluid');
    const e = mk();
    buildPool(e);
    run(e, 120);                                            // settle the pool
    const idx = e._bodyCount();
    e.spawnBox(100, 35, 8, 5, WOOD);                        // 16x10 wood box dropped above the pool
    run(e, 400);                                            // let it plunge and find its float depth
    const water1 = waterCount(e);
    run(e, 400);                                            // float undisturbed
    const s = e._bodyState(idx), bot = bodyBottom(e, WOOD), surf = surfaceY(e), water2 = waterCount(e);
    check(`wood did not sink to the floor (bottom ${bot} < ${yBot - 2})`, bot >= 0 && bot < yBot - 2);
    check(`wood is partially submerged, not resting on top (bottom ${bot} > surface ${surf})`, bot > surf + 1);
    check(`wood came to rest while floating (|vy| ${Math.abs(s.vy).toFixed(3)})`, Math.abs(s.vy) < 0.1);
    check(`no ongoing fluid leak once floating (${water2} == ${water1})`, water2 === water1);
    e.destroy();
  }
  { // Heavy body (default rigid) sinks through the fluid to the floor.
    console.log('heavy body sinks through a lighter fluid');
    const e = mk();
    buildPool(e);
    run(e, 120);
    const idx = e._bodyCount();
    e.spawnBox(100, 35, 8, 5, RIGID);                       // density 1.4 > water 1.0
    run(e, 700);
    const bot = bodyBottom(e, RIGID);
    check(`rigid body sank to the pool floor (bottom ${bot} >= ${yBot - 4})`, bot >= yBot - 4);
    e.destroy();
  }
}

// 9. Volume preservation: a light body plunging into a denser fluid must not
//    destroy the fluid it displaces. The displaced fluid percolates through its
//    own pool to the surface (spill BFS keyed to the fluid's density, not the
//    body's) instead of being dropped when it is boxed in by more of itself.
{
  console.log('plunge into a denser fluid conserves fluid volume');
  const LAVA = 11;                                            // density 2.8 > body 1.4
  const x0 = 70, x1 = 130, top = 20, surf = 45, yBot = 110;  // deep walled lava pool
  const e = mk();
  for (let y = top; y <= yBot + 3; y++) for (let d = 1; d <= 3; d++) { e.paintDisc(x0 - d, y, 0, STONE, true); e.paintDisc(x1 + d, y, 0, STONE, true); }
  for (let x = x0 - 3; x <= x1 + 3; x++) for (let d = 1; d <= 3; d++) e.paintDisc(x, yBot + d, 0, STONE, true);
  e.syncComponents();
  for (let y = surf; y <= yBot; y++) for (let x = x0; x <= x1; x++) e.paintDisc(x, y, 0, LAVA, true);
  run(e, 150);
  const lavaCount = () => { const g = e.getGrid(); let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === LAVA) n++; return n; };
  const before = lavaCount();
  const idx = e._bodyCount();
  e.spawnBox(100, 32, 6, 5, RIGID);
  e._setBodyMotion(idx, 0, 3.0, 0);                          // fast plunge deep into the pool
  let minLava = before;
  for (let k = 0; k < 24; k++) { run(e, 1); const l = lavaCount(); if (l < minLava) minLava = l; }
  // Lava erodes the body and can only ADD lava (never used to GAIN), so the guard
  // is the floor: the displaced lava must never be silently dropped mid-plunge.
  check(`displaced lava is never lost during the plunge (min ${minLava} >= ${before})`, minLava >= before);
  e.destroy();
}

// 9b. Gases never support (or block) a body. A body dropped over a thick pocket
//     of gas must sweep straight through it to the floor — gas is not terrain.
//     Checked for steam AND acrid smoke (id 31): support is keyed off K_GAS, so a
//     newly added gas needs no engine change to behave correctly.
{
  console.log('gases never support a body');
  const STEAM = 6, ACRID_SMOKE = 31;
  const floorY = ROWS - 2;
  const dropThroughGas = (gasId) => {
    const e = mk();
    stoneRect(e, 0, floorY, COLS - 1, ROWS - 1);             // floor only — no walls/terrain in the fall path
    e.syncComponents();
    for (let y = 50; y < floorY; y++) for (let x = 60; x <= 140; x++) e.paintDisc(x, y, 0, gasId, true);
    const idx = e._bodyCount();
    e.spawnBox(100, 30, 5, 5, RIGID);                        // dropped above the gas pocket
    run(e, 600);
    const bot = rigidBottom(e.getGrid());
    e.destroy();
    return bot;
  };
  const steamBot = dropThroughGas(STEAM);
  const acridBot = dropThroughGas(ACRID_SMOKE);
  check(`body falls through steam to the floor (bottom ${steamBot} >= ${floorY - 3})`, steamBot >= floorY - 3);
  check(`body falls through acrid smoke to the floor (bottom ${acridBot} >= ${floorY - 3})`, acridBot >= floorY - 3);
  check(`acrid smoke supports a body no more than steam does (${acridBot} ~= ${steamBot})`, Math.abs(acridBot - steamBot) <= 2);
}

// 9c. Powders behave like buoyant loose media for solids. A solid heavier than the
//     powder sinks through it to the floor (like a stone in water), and the displaced
//     powder is relocated volume-preservingly by the spill BFS (spread out to the free
//     surface) instead of being deleted or piled in a column on the solid's back. A
//     solid lighter than the powder part-submerges instead of resting on the surface.
//     Density-driven (STONE 2.6 / DRIFTWOOD 0.6 vs SAND 1.6), never id-specific.
//     Checked for BOTH a free rigid body and a painted static assembly — the two paths
//     that move a solid through powder.
{
  const SAND = 1, yTop = 40, floorY = ROWS - 2, x0 = 60, x1 = 140; // SAND powder, density 1.6
  const sandCount = (e) => { const g = e.getGrid(); let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === SAND) n++; return n; };
  const surfaceY = (e) => { const g = e.getGrid(); for (let y = 0; y < ROWS; y++) for (let x = x0; x <= x1; x++) if (g[y * COLS + x] === SAND) return y; return ROWS; };
  const stoneBottomInPool = (e) => { const g = e.getGrid(); let b = -1; for (let y = 0; y < floorY; y++) for (let x = x0; x <= x1; x++) if (g[y * COLS + x] === STONE) b = Math.max(b, y); return b; };
  const matBottom = (e, mat) => { const g = e.getGrid(); let b = -1; for (let i = 0; i < g.length; i++) if (g[i] === mat) b = Math.max(b, (i / COLS) | 0); return b; };
  // A grounded walled SAND basin: the walls + floor connect to the bottom row, so the
  // basin itself stays put (grounded) while a dropped solid sinks through the sand.
  const buildSandPool = (e) => {
    stoneRect(e, 0, floorY, COLS - 1, ROWS - 1);                 // world floor (grounds the basin)
    for (let y = yTop - 1; y < floorY; y++) { e.paintDisc(x0 - 1, y, 0, STONE, true); e.paintDisc(x1 + 1, y, 0, STONE, true); }
    e.syncComponents();
    for (let y = yTop; y < floorY; y++) for (let x = x0; x <= x1; x++) e.paintDisc(x, y, 0, SAND, true);
  };

  { // Free rigid body: a STONE box (density 2.6) plunges through SAND (1.6) to the floor.
    console.log('heavy free body sinks through a deep sand pool (sand conserved)');
    const e = mk();
    buildSandPool(e);
    run(e, 200);                                                // settle the sand
    const sand0 = sandCount(e), surf0 = surfaceY(e);
    e.spawnBox(100, 22, 6, 5, STONE);                           // 12x10 stone body above the pool
    run(e, 600);                                                // let it sink and the sand re-level
    const bot = stoneBottomInPool(e), surf1 = surfaceY(e), sand1 = sandCount(e);
    check(`free body sank to the pool floor (bottom ${bot} >= ${floorY - 4})`, bot >= floorY - 4);
    check(`displaced sand conserved within impact tolerance (${sand1} in [${sand0 - 8}, ${sand0}])`, sand1 >= sand0 - 8 && sand1 <= sand0);
    check(`displaced sand raised the surface, not piled on the body (surf ${surf1} < initial ${surf0})`, surf1 < surf0);
    e.destroy();
  }
  { // Static assembly: a painted STONE block (an ungrounded component) sinks the same way.
    console.log('heavy painted block (assembly) sinks through a deep sand pool');
    const e = mk();
    buildSandPool(e);
    run(e, 200);
    const sand0 = sandCount(e), surf0 = surfaceY(e);
    for (let y = yTop - 9; y < yTop - 1; y++) for (let x = 90; x < 111; x++) e.paintDisc(x, y, 0, STONE, true);
    e.syncComponents();                                         // 21x8 ungrounded stone block floating above the sand
    run(e, 600);
    const bot = stoneBottomInPool(e), surf1 = surfaceY(e), sand1 = sandCount(e);
    check(`painted block sank to the pool floor (bottom ${bot} >= ${floorY - 4})`, bot >= floorY - 4);
    // Conserved within a tiny dynamic-surface tolerance: a few loose surface grains can
    // be lost to the base powder sim at the moment of impact; the deep sink itself loses
    // nothing. The displaced sand must NOT be dumped on the block's back (surface rises).
    check(`displaced sand conserved within impact tolerance (${sand1} in [${sand0 - 8}, ${sand0}])`, sand1 >= sand0 - 8 && sand1 <= sand0);
    check(`displaced sand raised the surface (surf ${surf1} < initial ${surf0})`, surf1 < surf0);
    e.destroy();
  }
  { // A light, tall driftwood body part-submerges in dense sand instead of being
    //   pinned to the surface by grounded powder acting as solid terrain.
    console.log('a light driftwood tower part-submerges in dense sand');
    const e = mk();
    buildSandPool(e);
    run(e, 200);
    const surf0 = surfaceY(e), idx = e._bodyCount();
    e.spawnBox(100, 30, 4, 24, DRIFTWOOD);                       // DRIFTWOOD density 0.6 < SAND 1.6
    run(e, 900);
    const s = e._bodyState(idx), bot = matBottom(e, DRIFTWOOD), surf1 = surfaceY(e);
    check(`driftwood tower stayed a free buoyant body (${e._bodyCount()} bodies, ${s ? s.nPts : -1} cells)`, e._bodyCount() === idx + 1 && s && s.nPts >= 360);
    check(`light body did not sink to the floor (bottom ${bot} < ${floorY - 30})`, bot >= 0 && bot < floorY - 30);
    check(`light body is partially buried, not resting on top (bottom ${bot} > surface ${surf1} + 6)`, bot > surf1 + 6);
    check(`displaced sand raised around the tower (surface ${surf1} < initial ${surf0})`, surf1 < surf0);
    const vy = s ? Math.abs(s.vy) : 999;
    check(`light body came to rest (|vy| ${vy.toFixed(3)})`, vy < 0.1);
    e.destroy();
  }
}

// 10. Determinism: the same scenario run twice yields identical final pose.
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
