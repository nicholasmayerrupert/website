// Headless tests for the C++ player physics. Run with:
//   node scripts/player-test.mjs
// Covers spawn/snapshot, gravity, landing/grounded, thin-floor and wall
// collision, jump-only-when-grounded, run+friction, and fixed-input determinism.

import { initSandWasm, createEngineWasm, INPUT } from '../src/sand/engineWasm.js';
import { runSteps, approxEqual } from './sand-test-util.mjs';

const COLS = 200, ROWS = 120, SEED = 0xC0FFEE;
await initSandWasm();
const mk = (opts = {}) => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, ...opts });

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };

// Paint a solid stone block (component-aware) spanning [x0,x1) x [y0,y1).
// Blocks that don't reach the bottom row are ungrounded and fall as a rigid
// component, so test terrain must extend to ROWS to stay put.
const stoneBlock = (e, x0, x1, y0, y1) => {
  for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) e.addDiscToStoneDraft(x, y, 0);
  e.finalizeStoneDraft();
};
// A grounded floor: solid from `top` down to the bottom of the world.
const stoneFloor = (e, x0, x1, top) => stoneBlock(e, x0, x1, top, ROWS);

// 1. spawn returns a valid id and the snapshot reports the spawn position.
{
  console.log('spawn / snapshot');
  const e = mk();
  const id = e.spawnPlayer(100, 20);
  check(`spawn returns id (${id})`, id >= 1);
  check(`player count is 1 (${e.playerCount()})`, e.playerCount() === 1);
  const p = e.getPlayer(id);
  check(`snapshot has spawn position (${p && p.x},${p && p.y})`, p && approxEqual(p.x, 100) && approxEqual(p.y, 20));
  check('player is active and alive', p && p.active && p.alive);
  e.destroy();
}

// 2. gravity pulls a player down in empty space.
{
  console.log('gravity');
  const e = mk();
  const id = e.spawnPlayer(100, 10);
  const y0 = e.getPlayer(id).y;
  runSteps(e, 20);
  const y1 = e.getPlayer(id).y;
  check(`player fell (${y0.toFixed(1)} -> ${y1.toFixed(1)})`, y1 > y0 + 5);
  check('not grounded mid-air', !e.getPlayer(id).grounded);
  e.destroy();
}

// 3. player lands on a stone floor and becomes grounded.
{
  console.log('landing / grounded');
  const e = mk();
  stoneFloor(e, 80, 140, 90);
  const id = e.spawnPlayer(100, 60);
  runSteps(e, 120);
  const p = e.getPlayer(id);
  const feet = p.y + p.h;
  check(`landed on floor (feet ${feet.toFixed(1)} ~ 90)`, feet > 88 && feet <= 91);
  check('grounded after landing', p.grounded);
  e.destroy();
}

// 4. a player falling at terminal velocity cannot tunnel through a one-cell-thick
//    floor (substep collision). The shelf is held up by a thin grounded pillar.
{
  console.log('thin floor');
  const e = mk();
  stoneBlock(e, 80, 140, 100, 101); // 1-row shelf
  stoneBlock(e, 80, 82, 101, ROWS); // pillar grounds the shelf so it won't fall
  const id = e.spawnPlayer(110, 5);  // far from the pillar; long drop -> max fall speed
  runSteps(e, 200);
  const p = e.getPlayer(id);
  const feet = p.y + p.h;
  check(`stopped on thin shelf (feet ${feet.toFixed(1)} ~ 100, no tunnel)`, feet > 98 && feet <= 101 && p.grounded);
  e.destroy();
}

// 5. a player cannot walk through a vertical stone wall.
{
  console.log('wall collision');
  const e = mk();
  stoneFloor(e, 60, 140, 90);            // grounded floor
  stoneBlock(e, 120, 124, 70, 90);       // wall standing on the floor (one component)
  const id = e.spawnPlayer(100, 80);
  runSteps(e, 30); // settle on ground
  for (let i = 0; i < 120; i++) { e.setPlayerInput(id, { bits: INPUT.RIGHT }); e.step(16 * i); }
  const p = e.getPlayer(id);
  // Collision is forgiving (blocked only when >half the lower body is solid), so
  // the player sinks up to ~half his width into the wall face but can NOT tunnel
  // through a wall thicker than that: his CENTER stays at/before the wall (x=120).
  check(`stopped at wall, no tunnel (x ${p.x.toFixed(1)}, center ${(p.x + p.w / 2).toFixed(1)})`, p.x + p.w / 2 <= 121 && p.x > 110);
  e.destroy();
}

// 6. jump only works when grounded (no mid-air double jump).
{
  console.log('jump gating');
  const e = mk();
  stoneFloor(e, 60, 140, 90);
  const id = e.spawnPlayer(100, 80);
  runSteps(e, 40); // land + settle
  check('grounded before jump', e.getPlayer(id).grounded);
  const yGround = e.getPlayer(id).y;
  // press jump (edge): rises
  e.setPlayerInput(id, { bits: INPUT.JUMP }); e.step(0);
  let minY = e.getPlayer(id).y;
  for (let i = 1; i < 40; i++) {
    // keep holding jump: must NOT re-jump mid-air (edge-trigger)
    e.setPlayerInput(id, { bits: INPUT.JUMP }); e.step(16 * i);
    minY = Math.min(minY, e.getPlayer(id).y);
  }
  check(`jumped upward (${yGround.toFixed(1)} -> peak ${minY.toFixed(1)})`, minY < yGround - 4);
  // let it land again
  for (let i = 0; i < 80; i++) { e.setPlayerInput(id, { bits: 0 }); e.step(16 * i); }
  const landed = e.getPlayer(id);
  check(`landed back on ground (y ${landed.y.toFixed(1)} ~ ${yGround.toFixed(1)})`, approxEqual(landed.y, yGround, 1.5) && landed.grounded);
  // a fresh jump press while airborne must NOT trigger a second jump. Without a
  // double jump, gravity keeps decelerating the rise (vy grows toward 0); a
  // double jump would reset vy back to the launch impulse (more negative).
  e.setPlayerInput(id, { bits: INPUT.JUMP }); e.step(0); // launch
  for (let i = 1; i < 6; i++) { e.setPlayerInput(id, { bits: 0 }); e.step(16 * i); } // release while rising
  const airborneVy = e.getPlayer(id).vy;
  e.setPlayerInput(id, { bits: INPUT.JUMP }); e.step(0); // press again, mid-air
  check('no mid-air double jump', e.getPlayer(id).vy > airborneVy && !e.getPlayer(id).grounded);
  e.destroy();
}

// 7. holding RIGHT moves right; releasing input slows to a stop (friction).
{
  console.log('run + friction');
  const e = mk();
  stoneFloor(e, 40, 180, 90);
  const id = e.spawnPlayer(100, 80);
  runSteps(e, 30);
  const x0 = e.getPlayer(id).x;
  for (let i = 0; i < 60; i++) { e.setPlayerInput(id, { bits: INPUT.RIGHT }); e.step(16 * i); }
  const xMoved = e.getPlayer(id).x;
  check(`moved right (${x0.toFixed(1)} -> ${xMoved.toFixed(1)})`, xMoved > x0 + 10);
  check('has rightward velocity', e.getPlayer(id).vx > 0.1);
  // release: friction brings vx to ~0
  for (let i = 0; i < 40; i++) { e.setPlayerInput(id, { bits: 0 }); e.step(16 * i); }
  check(`friction stopped player (vx ${e.getPlayer(id).vx.toFixed(3)})`, Math.abs(e.getPlayer(id).vx) < 0.05);
  e.destroy();
}

// 8. a fixed input stream with a fixed seed produces a stable final position.
{
  console.log('determinism');
  const inputs = [];
  for (let i = 0; i < 200; i++) {
    let bits = INPUT.RIGHT;
    if (i % 25 === 0) bits |= INPUT.JUMP;
    if (i > 120) bits = INPUT.LEFT;
    inputs.push(bits);
  }
  const replay = () => {
    const e = mk();
    stoneFloor(e, 20, 190, 90);
    const id = e.spawnPlayer(100, 80);
    for (let i = 0; i < inputs.length; i++) { e.setPlayerInput(id, { bits: inputs[i] }); e.step(16 * i); }
    const p = e.getPlayer(id);
    e.destroy();
    return p;
  };
  const a = replay(), b = replay();
  check(`final x stable (${a.x.toFixed(4)} == ${b.x.toFixed(4)})`, a.x === b.x);
  check(`final y stable (${a.y.toFixed(4)} == ${b.y.toFixed(4)})`, a.y === b.y);
  check('final velocities stable', a.vx === b.vx && a.vy === b.vy);
}

// 9. removing a player and re-spawning does not corrupt wrapper state.
{
  console.log('remove / respawn');
  const e = mk();
  const a = e.spawnPlayer(50, 50);
  const b = e.spawnPlayer(60, 50);
  check(`two players (${e.playerCount()})`, e.playerCount() === 2);
  e.removePlayer(a);
  check(`one player after remove (${e.playerCount()})`, e.playerCount() === 1);
  check('remaining player is b', e.getPlayer(b) && !e.getPlayer(a));
  const c = e.spawnPlayer(70, 50);
  check(`respawn gets a fresh id (${c})`, c !== a && c !== b && e.playerCount() === 2);
  e.destroy();
}

// ---- Phase 3: player-mediated tool use (dig / build) ----
const T = { cube: 0, sand: 1, water: 2, stone: 3, oil: 4, fire: 5, acid: 6, lava: 7, ice: 8, seed: 9, driftwood: 10, eraser: 11 };
const countMat = (g, m) => { let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === m) n++; return n; };

// 10. primary action with the eraser mines reachable stone.
{
  console.log('tool: mine reachable stone');
  const e = mk();
  stoneFloor(e, 60, 140, 90);
  const id = e.spawnPlayer(100, 80);
  runSteps(e, 30); // land
  const p = e.getPlayer(id);
  const before = countMat(e.getGrid(), 3);
  // aim a few cells to the right at the stone surface, within reach
  for (let i = 0; i < 20; i++) {
    e.setPlayerInput(id, { bits: INPUT.PRIMARY, tool: T.eraser, aimX: p.x + 4, aimY: 92 });
    e.step(16 * i);
  }
  const after = countMat(e.getGrid(), 3);
  check(`stone mined (${before} -> ${after})`, after < before);
  e.destroy();
}

// 11. an aim beyond reach mines nothing.
{
  console.log('tool: reach limit');
  const e = mk();
  stoneFloor(e, 20, 190, 90);
  const id = e.spawnPlayer(100, 80);
  runSteps(e, 30);
  const p = e.getPlayer(id);
  const before = countMat(e.getGrid(), 3);
  for (let i = 0; i < 20; i++) {
    e.setPlayerInput(id, { bits: INPUT.PRIMARY, tool: T.eraser, aimX: p.x + 60, aimY: 92 }); // far away
    e.step(16 * i);
  }
  check(`nothing mined out of reach (${before} == ${countMat(e.getGrid(), 3)})`, countMat(e.getGrid(), 3) === before);
  e.destroy();
}

// 12. primary with stone places solid stone within reach.
{
  console.log('tool: place stone');
  const e = mk();
  stoneFloor(e, 60, 140, 100);
  const id = e.spawnPlayer(100, 90);
  runSteps(e, 30);
  const p = e.getPlayer(id);
  const before = countMat(e.getGrid(), 3);
  for (let i = 0; i < 8; i++) {
    e.setPlayerInput(id, { bits: INPUT.PRIMARY, tool: T.stone, aimX: p.x + 8, aimY: p.y - 2 });
    e.step(16 * i);
  }
  check(`stone placed within reach (${before} -> ${countMat(e.getGrid(), 3)})`, countMat(e.getGrid(), 3) > before);
  e.destroy();
}

// 13. cannot place a solid block overlapping the player's own AABB.
{
  console.log('tool: no self-overlap build');
  const e = mk();
  stoneFloor(e, 60, 140, 100);
  const id = e.spawnPlayer(100, 90);
  runSteps(e, 30);
  const p = e.getPlayer(id);
  const before = countMat(e.getGrid(), 3);
  for (let i = 0; i < 8; i++) {
    // aim at the player's own center -> build must be rejected
    e.setPlayerInput(id, { bits: INPUT.PRIMARY, tool: T.stone, aimX: p.x + p.w / 2, aimY: p.y + p.h / 2 });
    e.step(16 * i);
  }
  check(`no stone placed inside self (${before} == ${countMat(e.getGrid(), 3)})`, countMat(e.getGrid(), 3) === before);
  e.destroy();
}

// 14. player edits mark dirty rects and the placed material simulates afterwards.
{
  console.log('tool: edits dirty + simulate');
  const e = mk();
  stoneFloor(e, 60, 140, 100);
  const id = e.spawnPlayer(100, 90);
  runSteps(e, 30);
  const p = e.getPlayer(id);
  e.clearRenderDirty();
  // place sand above ground within reach
  e.setPlayerInput(id, { bits: INPUT.PRIMARY, tool: T.sand, aimX: p.x + 6, aimY: p.y - 4 });
  e.step(16);
  const sand0 = countMat(e.getGrid(), 1);
  const dirty = e.getRenderDirty();
  check(`sand placed (${sand0})`, sand0 > 0);
  check(`edit marked dirty (${dirty.rectCount} rects)`, dirty.rectCount > 0);
  // it should keep existing (falls / settles) after more steps
  e.setPlayerInput(id, { bits: 0 });
  runSteps(e, 60);
  check(`placed sand persists in sim (${countMat(e.getGrid(), 1)})`, countMat(e.getGrid(), 1) > 0);
  e.destroy();
}

// 15. emit policy: continuous tools (fluids/sand) throttle by the cooldown while
//     held; solids + the cube fire ONCE per press (rising edge), so holding the
//     button doesn't spam blocks/boxes.
{
  console.log('tool: continuous throttle vs single-shot');
  const e = mk();
  stoneFloor(e, 60, 140, 90);
  const id = e.spawnPlayer(100, 80);
  runSteps(e, 30); // land on the floor
  const p = e.getPlayer(id);
  // continuous: hold PRIMARY + water for 12 steps -> throttled (~3, not 12).
  const c0 = e.getPlayerActionCount();
  for (let i = 0; i < 12; i++) {
    e.setPlayerInput(id, { bits: INPUT.PRIMARY, tool: T.water, aimX: p.x + 6, aimY: p.y - 4 });
    e.step(16 * i);
  }
  const contActions = e.getPlayerActionCount() - c0;
  check(`continuous tool throttled (${contActions} of 12 steps, expect ~3)`, contActions >= 2 && contActions <= 4);
  // single-shot: release, then hold PRIMARY + cube for 12 steps -> exactly one.
  e.setPlayerInput(id, { bits: 0 }); e.step(16); // release so the next press is a rising edge
  const s0 = e.getPlayerActionCount();
  for (let i = 0; i < 12; i++) {
    e.setPlayerInput(id, { bits: INPUT.PRIMARY, tool: T.cube, aimX: p.x + 14, aimY: p.y - 4 });
    e.step(16 * i);
  }
  const cubeActions = e.getPlayerActionCount() - s0;
  check(`cube fires once per press (${cubeActions} of 12 steps, expect 1)`, cubeActions === 1);
  e.destroy();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
