// Powder materials settle without churn, and structural components retain their
// material while grounding or falling.

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 160, ROWS = 120, SEED = 0xC0FFEE;
await initSandWasm();
const mk = (opts = {}) => attachTestHooks(createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: false, ...opts }));
const { check, done } = makeChecker('material behavior');

const count = (g, m) => { let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === m) n++; return n; };
const minRow = (g, m) => { let r = ROWS; for (let i = 0; i < g.length; i++) if (g[i] === m) r = Math.min(r, (i / COLS) | 0); return r; };
const maxRow = (g, m) => { let r = -1; for (let i = 0; i < g.length; i++) if (g[i] === m) r = Math.max(r, (i / COLS) | 0); return r; };
const fillDisc = (e, cx, cy, r, mat) => e.placeMaterial(cx, cy, r, mat);

// Declarative sources are collected on every active row, including the bottom.
{
  const e = mk();
  e.paintDisc(80, ROWS - 1, 0, MAT.SALT, true);
  e.paintDisc(81, ROWS - 1, 0, MAT.WATER, true);
  e.step(16);
  check('simple material rule reacts on the bottom row',
    count(e.getGrid(), MAT.BRINE) === 2);
  e.destroy();
}

// The low-level public paint ABI is topology-safe on its own. Component
// products remain registered without a separate syncComponents call.
{
  const e = mk();
  const ORE = MAT.COPPER_ORE;
  const painted = e.paintDisc(COLS / 2, ROWS - 7, 5, ORE, true);
  const before = count(e.getGrid(), ORE);
  for (let i = 0; i < 12; i++) e.step((i + 1) * 16);
  check('public component paint registers topology without explicit sync',
    painted > 0 && before > 0 && count(e.getGrid(), ORE) === before);
  e.destroy();
}

// Adjacent structural brush stamps extend one persistent component in place.
// The indexed ownership path must not create one component per public call.
{
  const e = mk();
  const ORE = MAT.COPPER_ORE;
  let componentId = -1;
  let stable = true;
  for (let x = 30; x <= 90; x++) {
    e.paintDisc(x, 24, 0, ORE, true);
    if (componentId < 0) componentId = e._componentId(0, 0);
    stable = stable && e._componentCount(0) === 1
      && e._componentId(0, 0) === componentId;
  }
  const before = count(e.getGrid(), ORE);
  e.step(16);
  check('repeated adjacent component paint preserves one stable component id',
    stable && componentId > 0 && before === 61);
  check('repeated adjacent component paint leaves no orphan cells',
    count(e.getGrid(), ORE) === before);
  e.destroy();
}

// A new stamp can join two compatible components. The first component keeps
// its identity while the second membership is folded into it exactly once.
{
  const e = mk();
  const ORE = MAT.COPPER_ORE;
  e.paintDisc(50, 24, 0, ORE, true);
  const firstId = e._componentId(0, 0);
  e.paintDisc(54, 24, 0, ORE, true);
  const separate = e._componentCount(0) === 2
    && e._componentId(0, 1) !== firstId;
  for (let x = 51; x <= 53; x++) e.paintDisc(x, 24, 0, ORE, true);
  const merged = e._componentCount(0) === 1
    && e._componentId(0, 0) === firstId;
  const before = count(e.getGrid(), ORE);
  e.step(16);
  check('component bridge merges memberships and preserves the first id',
    separate && merged && before === 5);
  check('component bridge leaves no orphan cells',
    count(e.getGrid(), ORE) === before);
  e.destroy();
}

// Attached mutations preserve exclusive component ownership. Restoring a
// member in one batch cancels its pending removal without changing its id.
{
  const e = mk();
  e.paintDisc(40, 24, 1, MAT.COPPER_ORE, true);
  const componentId = e._componentId(0, 0);
  const result = e._replaceAttachedAfterLoose(
    0, 40, 24, MAT.WATER, MAT.IRON_ORE, 0);
  const cell = 24 * COLS + 40;
  const stableBeforeStep = e.getGrid()[cell] === MAT.IRON_ORE
    && e._componentId(0, 0) === componentId;
  const before = count(e.getGrid(), MAT.COPPER_ORE)
    + count(e.getGrid(), MAT.IRON_ORE);
  e.step(16);
  check('same-owner attached replacement cancels pending removal',
    result === 3 && stableBeforeStep);
  check('same-owner attached replacement remains topology-backed',
    count(e.getGrid(), MAT.COPPER_ORE) + count(e.getGrid(), MAT.IRON_ORE)
      === before);
  e.destroy();
}

// Cross-owner, body-owned, and mixed topology-role cells are rejected before
// either the grid or component roster changes.
{
  const e = mk();
  e.paintDisc(30, 24, 0, MAT.COPPER_ORE, true);
  e.paintDisc(40, 24, 0, MAT.COPPER_ORE, true);
  const firstId = e._componentId(0, 0), secondId = e._componentId(0, 1);
  const crossOwner = e._replaceAttached(0, 30, 24, MAT.IRON_ORE, 1);
  const mixedRole = e._replaceAttached(0, 30, 24, MAT.OAK_WOOD, 0);
  e.spawnBox(70, 24, 1, 1, MAT.RIGID);
  const bodyCell = 24 * COLS + 70;
  const bodyMaterial = e.getGrid()[bodyCell];
  const bodyCount = e._bodyCount();
  const bodyOwned = e._replaceAttached(0, 70, 24, MAT.IRON_ORE, 0);
  check('attached mutation rejects cross-component ownership',
    crossOwner === 0 && e.getGrid()[24 * COLS + 30] === MAT.COPPER_ORE
      && e._componentCount(0) === 2
      && e._componentId(0, 0) === firstId
      && e._componentId(0, 1) === secondId);
  check('attached mutation rejects mixed plant/non-plant topology roles',
    mixedRole === 0 && e.getGrid()[24 * COLS + 30] === MAT.COPPER_ORE);
  check('attached mutation rejects body ownership without changing the body',
    bodyOwned === 0 && e.getGrid()[bodyCell] === bodyMaterial
      && e._bodyCount() === bodyCount);
  e.destroy();
}

// Positional component indexes remain stable until commit, so multiple
// ownerless products can attach through one batch without retargeting.
{
  const e = mk();
  e.paintDisc(30, 24, 0, MAT.COPPER_ORE, true);
  e.paintDisc(31, 24, 0, MAT.WATER, true);
  e.paintDisc(32, 24, 0, MAT.WATER, true);
  const componentId = e._componentId(0, 0);
  const result = e._replaceAttachedPair(
    0, 31, 24, 32, 24, MAT.IRON_ORE, 0);
  const stableBeforeStep = e._componentCount(0) === 1
    && e._componentId(0, 0) === componentId;
  const before = count(e.getGrid(), MAT.COPPER_ORE)
    + count(e.getGrid(), MAT.IRON_ORE);
  e.step(16);
  check('batched attached products retain their target index and id',
    result === 3 && stableBeforeStep && before === 3);
  check('batched attached products remain topology-backed',
    count(e.getGrid(), MAT.COPPER_ORE) + count(e.getGrid(), MAT.IRON_ORE)
      === before);
  e.destroy();
}

// A declarative catalyst can keep its source material while changing its
// neighbor without resetting the source's persistent movement channels.
{
  const e = mk();
  const sourceCell = 60 * COLS + 70;
  const neighborCell = sourceCell + 1;
  e.paintDisc(70, 60, 0, MAT.SALT, true);
  e.paintDisc(71, 60, 0, MAT.WATER, true);
  e._setMotionSentinel(0, sourceCell, 7);
  const stateBefore = e._motionCellState(0, sourceCell);
  const applied = e._applyCatalystProducts(
    0, sourceCell, neighborCell, MAT.BRINE);
  const stateAfter = e._motionCellState(0, sourceCell);
  check('declarative catalyst preserves an unchanged source product',
    applied && e.getGrid()[sourceCell] === MAT.SALT
      && e.getGrid()[neighborCell] === MAT.BRINE);
  check('unchanged catalyst product preserves persistent cell state',
    stateAfter.length === stateBefore.length
      && stateAfter.every((value, index) => value === stateBefore[index]));
  e.destroy();
}

// A transient gas that cannot vent remains scheduled until its generated
// trapped-decay policy consumes the whole pocket.
{
  const e = mk();
  const x0 = 60, x1 = 69, y0 = 42, y1 = 51;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const border = x === x0 || x === x1 || y === y0 || y === y1;
    e.paintDisc(x, y, 0, border ? MAT.STONE : MAT.ACRID_SMOKE, true);
  }
  const before = count(e.getGrid(), MAT.ACRID_SMOKE);
  for (let i = 0; i < 400; i++) e.step((i + 1) * 16);
  check('trapped acrid smoke stays live until its profile decays it',
    before === 64 && count(e.getGrid(), MAT.ACRID_SMOKE) === 0);
  e.destroy();
}

// Powders fall and settle to inert.
for (const name of ['DIRT', 'SNOW', 'MUD', 'GRASS']) {
  const e = mk();
  const mat = MAT[name];
  fillDisc(e, COLS / 2, 18, 7, mat);
  const before = count(e.getGrid(), mat);
  let t = 0, settledAt = -1;
  for (let i = 0; i < 3000; i++) { t += 16; if (!e.step(t)) { settledAt = i; break; } }
  const g = e.getGrid();
  check(`${name} powder settles to inert (step ${settledAt})`, settledAt > 0 && settledAt < 3000);
  check(`${name} conserved (${before} -> ${count(g, mat)})`, count(g, mat) === before && before > 0);
  check(`${name} fell to the floor (bottom row ${maxRow(g, mat)})`, maxRow(g, mat) >= ROWS - 4);
  e.destroy();
}

// Structural ore grounds when it rests on the floor.
{
  const e = mk();
  const ORE = MAT.COPPER_ORE;
  fillDisc(e, COLS / 2, ROWS - 8, 6, ORE); // disc whose bottom reaches the world floor
  const before = count(e.getGrid(), ORE);
  const top0 = minRow(e.getGrid(), ORE);
  let t = 0; for (let i = 0; i < 300; i++) { t += 16; e.step(t); }
  const g = e.getGrid();
  check(`COPPER_ORE registered + grounded (did not fall, top ${minRow(g, ORE)} ~ ${top0})`, minRow(g, ORE) <= top0 + 1);
  check(`COPPER_ORE conserved (${before})`, count(g, ORE) === before && before > 0);
  check(`grounded ore stayed COPPER_ORE, no STONE conjured`, count(g, MAT.STONE) === 0);
  e.destroy();
}

// A falling structural component keeps its material.
{
  const e = mk();
  const ORE = MAT.IRON_ORE;
  fillDisc(e, COLS / 2, 16, 6, ORE); // floating, nothing beneath
  const before = count(e.getGrid(), ORE);
  const top0 = minRow(e.getGrid(), ORE);
  let t = 0; for (let i = 0; i < 400; i++) { t += 16; e.step(t); }
  const g = e.getGrid();
  check(`floating IRON_ORE fell (top ${top0} -> ${minRow(g, ORE)})`, minRow(g, ORE) > top0 + 8);
  check(`fallen ore is STILL IRON_ORE, not STONE (${count(g, ORE)} ore, ${count(g, MAT.STONE)} stone)`, count(g, ORE) === before && before > 0 && count(g, MAT.STONE) === 0);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
