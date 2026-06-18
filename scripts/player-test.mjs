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

// Bury the bottom `depth` pixel-rows of the player's box with grounded stone
// (simulates sand piling INTO him from the feet up). Connects to the floor below.
const buryFeet = (e, p, depth) => {
  const x0 = Math.floor(p.x), x1 = Math.floor(p.x + p.w - 1e-6);
  const bottom = Math.floor(p.y + p.h - 1e-6);
  for (let row = bottom; row > bottom - depth; row--) for (let x = x0; x <= x1; x++) e.addDiscToStoneDraft(x, row, 0);
  e.finalizeStoneDraft();
};

// N1. rests cleanly ON TOP of the floor — no sinking.
{
  console.log('survival: rest on floor without sinking');
  const e = mk();
  stoneFloor(e, 60, 140, 90);
  const id = e.spawnPlayer(100, 70);
  runSteps(e, 120);
  const p = e.getPlayer(id);
  const feet = p.y + p.h;
  check(`feet rest on top, no sink (feet ${feet.toFixed(2)} ~ 90)`, feet > 89 && feet <= 90.5 && p.grounded);
  e.destroy();
}

// N2. shallowly buried (3px of sand in the feet) -> can still JUMP OUT.
{
  console.log('survival: jump out when shallowly buried (3px)');
  const e = mk();
  stoneFloor(e, 60, 140, 90);
  const id = e.spawnPlayer(100, 70);
  runSteps(e, 120);
  buryFeet(e, e.getPlayer(id), 3);
  const y0 = e.getPlayer(id).y;
  let minY = y0;
  e.setPlayerInput(id, { bits: INPUT.JUMP }); e.step(0);
  for (let i = 1; i < 40; i++) { e.setPlayerInput(id, { bits: INPUT.JUMP }); e.step(16 * i); minY = Math.min(minY, e.getPlayer(id).y); }
  check(`shallow-buried player jumped out (y ${y0.toFixed(1)} -> peak ${minY.toFixed(1)})`, minY < y0 - 2);
  e.destroy();
}

// N3. deeply buried (6px) -> jump is DENIED; he must dig out.
{
  console.log('survival: jump denied when deeply buried (6px)');
  const e = mk();
  stoneFloor(e, 60, 140, 90);
  const id = e.spawnPlayer(100, 70);
  runSteps(e, 120);
  buryFeet(e, e.getPlayer(id), 6);
  const y0 = e.getPlayer(id).y;
  let minY = y0;
  for (let i = 0; i < 25; i++) { e.setPlayerInput(id, { bits: INPUT.JUMP }); e.step(16 * i); minY = Math.min(minY, e.getPlayer(id).y); }
  check(`deep-buried player cannot jump (y ${y0.toFixed(1)}, minY ${minY.toFixed(1)})`, minY >= y0 - 1);
  // ...but after digging out the sand, he CAN jump again.
  e.eraseDisc(Math.floor(e.getPlayer(id).x + 0.5), y0 + 7, 3); runSteps(e, 5);
  const y1 = e.getPlayer(id).y; let minY2 = y1;
  e.setPlayerInput(id, { bits: 0 }); e.step(0); // release to re-arm
  for (let i = 1; i < 30; i++) { e.setPlayerInput(id, { bits: INPUT.JUMP }); e.step(16 * i); minY2 = Math.min(minY2, e.getPlayer(id).y); }
  check(`after digging out he can jump (y ${y1.toFixed(1)} -> peak ${minY2.toFixed(1)})`, minY2 < y1 - 2);
  e.destroy();
}

// N4. walks OVER a 1px bump without sticking (the original 1px-stick must not regress).
{
  console.log('survival: walk over a 1px bump');
  const e = mk();
  stoneFloor(e, 40, 180, 90);
  stoneBlock(e, 118, 121, 89, 90); // a 1px-tall bump on the floor surface
  const id = e.spawnPlayer(95, 80);
  runSteps(e, 30);
  const x0 = e.getPlayer(id).x;
  for (let i = 0; i < 140; i++) { e.setPlayerInput(id, { bits: INPUT.RIGHT }); e.step(16 * i); }
  const p = e.getPlayer(id);
  check(`walked PAST the 1px bump (x ${x0.toFixed(1)} -> ${p.x.toFixed(1)})`, p.x > 125);
  e.destroy();
}

// N5. deeply buried (> P_BURY_JUMP_MAX) -> cannot WALK side-to-side out either; he
//     must dig free (same cap that denies the jump). Bury the bottom rows deep AND
//     wall off both sides so the leading edge is solid sand on contact, with open
//     space a couple cells away that he must NOT be able to reach by walking.
{
  console.log('survival: deeply buried cannot walk out (must dig)');
  const e = mk();
  stoneFloor(e, 60, 140, 90);
  const id = e.spawnPlayer(100, 70);
  runSteps(e, 120);
  const p = e.getPlayer(id);
  // Bury the feet 6px deep (> P_BURY_JUMP_MAX = 4) so the jump/walk gate engages.
  buryFeet(e, e.getPlayer(id), 6);
  // Wall off both sides of the lower body so any horizontal step pushes the leading
  // edge INTO solid stone. The box spans [x0,x1]; put a 2px-thick wall just outside
  // each side, full body height, leaving genuine open air a couple cells beyond.
  const x0 = Math.floor(p.x), x1 = Math.floor(p.x + p.w - 1e-6);
  const top = Math.floor(p.y), bot = Math.floor(p.y + p.h - 1e-6);
  for (let y = top; y <= bot; y++) {
    e.addDiscToStoneDraft(x0 - 1, y, 0); e.addDiscToStoneDraft(x0 - 2, y, 0);
    e.addDiscToStoneDraft(x1 + 1, y, 0); e.addDiscToStoneDraft(x1 + 2, y, 0);
  }
  e.finalizeStoneDraft();
  const startX = e.getPlayer(id).x;
  // Sustained RIGHT input for many steps: he must stay put (can't walk out).
  for (let i = 0; i < 120; i++) { e.setPlayerInput(id, { bits: INPUT.RIGHT }); e.step(16 * i); }
  const afterRight = e.getPlayer(id).x;
  check(`buried player can't walk RIGHT out (x ${startX.toFixed(1)} -> ${afterRight.toFixed(1)})`, Math.abs(afterRight - startX) < 1.0);
  // And sustained LEFT input: also stuck.
  for (let i = 0; i < 120; i++) { e.setPlayerInput(id, { bits: INPUT.LEFT }); e.step(16 * i); }
  const afterLeft = e.getPlayer(id).x;
  check(`buried player can't walk LEFT out (x ${startX.toFixed(1)} -> ${afterLeft.toFixed(1)})`, Math.abs(afterLeft - startX) < 1.0);
  e.destroy();
}

// N6. control / regression guard: a SHALLOWLY buried (<= P_BURY_JUMP_MAX) player
//     still walks horizontally with the same input — the gate must not over-block.
{
  console.log('survival: shallow-buried player still walks (regression)');
  const e = mk();
  stoneFloor(e, 40, 180, 90);
  const id = e.spawnPlayer(100, 70);
  runSteps(e, 120);
  buryFeet(e, e.getPlayer(id), 3); // 3px <= P_BURY_JUMP_MAX -> must still walk
  const x0 = e.getPlayer(id).x;
  for (let i = 0; i < 120; i++) { e.setPlayerInput(id, { bits: INPUT.RIGHT }); e.step(16 * i); }
  const p = e.getPlayer(id);
  check(`shallow-buried player walks right (x ${x0.toFixed(1)} -> ${p.x.toFixed(1)})`, p.x > x0 + 8);
  e.destroy();
}

// 15. eraser SWEEPS from in front of the player toward the cursor (not a disc at the
//     aim): cells on the player-side, well short of the cursor, get carved.
{
  console.log('tool: eraser sweeps toward the cursor');
  const e = mk();
  stoneFloor(e, 60, 170, 90);
  const id = e.spawnPlayer(100, 80);
  runSteps(e, 30);
  const p = e.getPlayer(id);
  const aimX = Math.floor(p.x) + 16;
  for (let i = 0; i < 6; i++) { e.setPlayerInput(id, { bits: INPUT.PRIMARY, tool: T.eraser, aimX, aimY: 92 }); e.step(16 * i); }
  const g = e.getGrid();
  const empty = (x, y) => g[y * COLS + x] === 0;
  // a cell ~8 cells in front of the player (far from the cursor) is carved -> the carve
  // originates at the player and sweeps outward, unlike the old disc-at-aim eraser.
  const nearX = Math.floor(p.x) + 8;
  check(`carve reaches the player side (x=${nearX} cleared, cursor x=${aimX})`, empty(nearX, 91) && nearX < aimX - 4);
  e.destroy();
}

// 16. DURABILITY gates penetration: one mine action digs FURTHER through soft sand
//     than through hard stone (same geometry, same budget).
{
  console.log('tool: durability gates mining penetration');
  const penetrate = (mat) => {
    const e = mk();
    if (mat === 3) stoneFloor(e, 110, 141, 0);                 // full-height stone wall (component)
    else for (let x = 110; x < 141; x++) for (let y = 0; y < ROWS; y++) e.paintDisc(x, y, 0, mat, true);
    const id = e.spawnPlayer(100, 80);
    runSteps(e, 30);
    const p = e.getPlayer(id);
    const before = countMat(e.getGrid(), mat);
    e.setPlayerInput(id, { bits: INPUT.PRIMARY, tool: T.eraser, aimX: 130, aimY: Math.floor(p.y) + 4 });
    e.step(16);
    const removed = before - countMat(e.getGrid(), mat);
    e.destroy();
    return removed;
  };
  const sand = penetrate(1), stone = penetrate(3);
  check(`stone is mined but limited (${stone} > 0)`, stone > 0);
  check(`soft sand digs further than hard stone (sand ${sand} > stone ${stone})`, sand > stone + 4);
}

// 17. solids HOLD-TO-DRAW: dragging draws a connected shape that STAYS when it reaches
//     grounded terrain, and FALLS when drawn in mid-air (gravity unchanged).
{
  console.log('tool: solid hold-to-draw (stays if supported)');
  const e = mk();
  stoneFloor(e, 60, 160, 100);
  const id = e.spawnPlayer(100, 90);
  runSteps(e, 30);
  const p = e.getPlayer(id);
  const before = countMat(e.getGrid(), 3);
  for (let i = 0; i < 8; i++) { e.setPlayerInput(id, { bits: INPUT.PRIMARY, tool: T.stone, aimX: Math.floor(p.x) + 6 + i, aimY: 98 }); e.step(16 * i); }
  const drawn = countMat(e.getGrid(), 3) - before;
  e.setPlayerInput(id, { bits: 0 });
  runSteps(e, 40);
  const kept = countMat(e.getGrid(), 3) - before;
  check(`drag drew a connected stone shape (${drawn} cells)`, drawn > 6);
  check(`grounded drawing stays put (${kept} == ${drawn})`, kept === drawn);
  e.destroy();
}
{
  console.log('tool: solid drawn in mid-air falls');
  const e = mk();
  stoneFloor(e, 60, 160, 112);
  const id = e.spawnPlayer(100, 100);
  runSteps(e, 30);
  const p = e.getPlayer(id);
  const before = countMat(e.getGrid(), 3);
  const topOf = () => { const g = e.getGrid(); let t = 1e9; for (let i = 0; i < g.length; i++) if (g[i] === 3) { const y = (i / COLS) | 0; if (y < t && y < 108) t = y; } return t; };
  for (let i = 0; i < 6; i++) { e.setPlayerInput(id, { bits: INPUT.PRIMARY, tool: T.stone, aimX: Math.floor(p.x) + 10, aimY: Math.floor(p.y) - 15 }); e.step(16 * i); }
  const drawn = countMat(e.getGrid(), 3) - before;
  const top0 = topOf();
  e.setPlayerInput(id, { bits: 0 });
  runSteps(e, 80);
  const top1 = topOf();
  check(`mid-air stone was drawn (${drawn} cells)`, drawn > 6);
  check(`unsupported drawing falls (top ${top0} -> ${top1})`, top1 > top0 + 5);
  e.destroy();
}

// 18. fluid/sand SPEW: scatters within reach of the cursor, sparse, and is fully
//     deterministic (same seed + inputs -> byte-identical grid; required for replay).
{
  console.log('tool: fluid spew is sparse + deterministic');
  const spew = () => {
    const e = mk();
    stoneFloor(e, 60, 160, 118);
    const id = e.spawnPlayer(100, 108);
    runSteps(e, 30);
    const p = e.getPlayer(id);
    e.setPlayerInput(id, { bits: INPUT.PRIMARY, tool: T.water, aimX: Math.floor(p.x) + 10, aimY: Math.floor(p.y) });
    e.step(16);
    const w = countMat(e.getGrid(), 2);
    const g = Array.from(e.getGrid());
    e.destroy();
    return { w, g };
  };
  const a = spew(), b = spew();
  check(`water spewed out (${a.w} cells)`, a.w > 0);
  check(`spew is sparse, not a full disc (${a.w} < 45)`, a.w < 45); // disc area ~pi*P_SPEW_R^2
  check('spew is deterministic across identical runs', a.g.length === b.g.length && a.g.every((v, i) => v === b.g[i]));
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
