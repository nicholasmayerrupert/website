// Repeated blasts exercise foreground/background destruction, rubble motion,
// and the conversion of several resting rigid bodies in one world step.
import { performance } from 'node:perf_hooks';
import {
  initSandWasm, createEngineWasm as createEngineWasmRaw, MAT,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { CREATIVE_KIND } from '../src/sand/wasmBridge/abi.generated.js';

const COLS = 384;
const ROWS = 288;
const BLASTS = 10;
const STEPS_PER_BLAST = 75;

await initSandWasm();

// A fast TNT fragment can reach terrain through the swept-contact manifold,
// whose optional peer body is absent for terrain contacts.
{
  const sweptContactEngine = attachTestHooks(createEngineWasmRaw({
    cols: 512,
    rows: 384,
    worldSeed: 1401181199,
    sinksOn: false,
    infinite: true,
    storageRole: 'authority',
  }));
  sweptContactEngine.setBgEnabled(true);
  sweptContactEngine.setCreativeMaterial(CREATIVE_KIND.MATERIAL, MAT.TNT);
  const cx = 165, cy = 191, halfWidth = 45, halfHeight = 25;
  sweptContactEngine.pointerDown(cx, cy, 0);
  for (let point = 1; point < 15; point++) {
    const angle = point * Math.PI * 2 / 15;
    sweptContactEngine.pointerDraft(
      Math.round(cx + Math.cos(angle) * halfWidth),
      Math.round(cy + Math.sin(angle) * halfHeight),
    );
  }
  sweptContactEngine.pointerUp(0);
  sweptContactEngine.pointerButtons(0);
  sweptContactEngine.paintDiscLayer(0, 118, 166, 2, MAT.FIRE, false);
  for (let step = 0; step < 12; step++) {
    sweptContactEngine.stepActors();
    sweptContactEngine.stepWorld();
  }
  if (sweptContactEngine.getTick() !== 12)
    throw new Error(`swept TNT contact stopped at tick ${sweptContactEngine.getTick()} of 12`);
  sweptContactEngine.destroy();
}

// A component body resting on another free body remains dynamic. Nearby static
// terrain is not its load-bearing support, even while a live TNT body enables
// the accelerated rubble-bake path.
{
  const cols = 140, rows = 140;
  const supportEngine = attachTestHooks(createEngineWasmRaw({
    cols,
    rows,
    worldSeed: 1,
    sinksOn: false,
    infinite: false,
    storageRole: 'authority',
  }));
  supportEngine.setBgEnabled(true);
  for (let y = 40; y < rows; y++)
    for (let x = 29; x <= 31; x++)
      supportEngine.paintDisc(x, y, 0, MAT.STONE, true);
  for (let y = 130; y < rows; y++)
    for (let x = 0; x < cols; x++)
      supportEngine.paintDisc(x, y, 0, MAT.STONE, true);
  supportEngine.syncComponents();
  supportEngine.stepWorld();
  supportEngine.spawnBox(38, 126, 4, 4, MAT.RIGID);
  for (let tick = 0; tick < 80; tick++) supportEngine.stepWorld();
  supportEngine.spawnBox(38, 90, 4, 4, MAT.STONE);
  supportEngine.spawnBox(120, 20, 1, 1, MAT.TNT);

  const findBody = (material) => {
    for (let body = 0; body < supportEngine._bodyCount(); body++)
      if (supportEngine._bodyMaterial(body) === material) return body;
    return -1;
  };
  let unsupportedStaticCells = 0;
  for (let tick = 0; tick < 180; tick++) {
    const tnt = findBody(MAT.TNT);
    if (tnt >= 0) supportEngine._setBodyMotion(tnt, 0, 0, 0);
    supportEngine.stepWorld();
    const grid = supportEngine.getGrid();
    const owners = supportEngine._bodyOwnerGrid();
    const grounded = supportEngine._groundedGrid();
    for (let y = 100; y < 125; y++) {
      for (let x = 34; x <= 41; x++) {
        const cell = y * cols + x;
        if (grid[cell] === MAT.STONE && owners[cell] < 0 && !grounded[cell])
          unsupportedStaticCells++;
      }
    }
  }
  const stone = findBody(MAT.STONE);
  if (unsupportedStaticCells !== 0 || stone < 0
      || supportEngine._bodyAwake(stone) !== 0) {
    throw new Error(
      `body-supported stone baked without static support: `
      + `${unsupportedStaticCells} unsupported samples, body ${stone}`,
    );
  }
  console.log('ok - body-supported TNT rubble remained a sleeping body');
  supportEngine.destroy();
}

// A live TNT body lets supported rubble bake as soon as it sleeps. All fragments
// reach that transition together so the bake pass must handle a dense roster in
// one bounded world turn.
{
  const cols = 512, rows = 600;
  const rubbleCount = 800, halfSize = 6;
  const firstShelf = 30, shelfGap = 22;
  const bodySpacing = 14, bodiesPerShelf = 35;
  const bakeLimitMs = 250;
  const bakeEngine = attachTestHooks(createEngineWasmRaw({
    cols,
    rows,
    worldSeed: 1,
    sinksOn: false,
    infinite: false,
    storageRole: 'authority',
  }));
  const grid = bakeEngine.getGrid();
  for (let y = firstShelf; y < rows; y++) grid[y * cols + 1] = MAT.STONE;
  for (let shelf = 0; shelf < Math.ceil(rubbleCount / bodiesPerShelf); shelf++) {
    const y = firstShelf + shelf * shelfGap;
    for (let x = 1; x < cols - 1; x++) grid[y * cols + x] = MAT.STONE;
  }
  for (let x = 1; x < cols - 1; x++) grid[(rows - 1) * cols + x] = MAT.STONE;
  bakeEngine.syncComponents();

  for (let body = 0; body < rubbleCount; body++) {
    const shelf = Math.floor(body / bodiesPerShelf);
    const column = body % bodiesPerShelf;
    bakeEngine.spawnBox(
      10 + column * bodySpacing,
      firstShelf + shelf * shelfGap - halfSize,
      halfSize,
      halfSize,
      MAT.STONE,
    );
    if (!bakeEngine._setBodyBlastDebris(body, true))
      throw new Error(`could not mark rubble body ${body}`);
  }
  bakeEngine.spawnBox(cols - 6, 5, 1, 1, MAT.TNT);

  let transition = null;
  for (let tick = 0; tick < 30; tick++) {
    let tntBody = -1;
    for (let body = 0; body < bakeEngine._bodyCount(); body++) {
      if (bakeEngine._bodyMaterial(body) === MAT.TNT) {
        tntBody = body;
        break;
      }
    }
    if (tntBody < 0 || !bakeEngine._setBodyMotion(tntBody, 0, 0, 0))
      throw new Error(`live TNT body was lost before bake tick ${tick}`);
    const before = bakeEngine._bodyCount();
    const started = performance.now();
    bakeEngine.stepWorld();
    const elapsed = performance.now() - started;
    const after = bakeEngine._bodyCount();
    if (after < before) {
      transition = {
        tick,
        before,
        after,
        elapsed,
        bakedCells: bakeEngine.getRigidSolverDebug().rigidBakedCells,
      };
      break;
    }
  }

  const expectedBakedCells = rubbleCount * halfSize * 2 * halfSize * 2;
  if (!transition || transition.before !== rubbleCount + 1
      || transition.after !== 1
      || transition.bakedCells !== expectedBakedCells) {
    throw new Error(`TNT rubble batch did not bake completely: ${JSON.stringify(transition)}`);
  }
  if (transition.elapsed >= bakeLimitMs) {
    throw new Error(
      `TNT rubble batch bake took ${transition.elapsed.toFixed(1)}ms `
      + `(limit ${bakeLimitMs}ms)`,
    );
  }
  console.log(
    `ok - ${rubbleCount} TNT rubble bodies baked in `
    + `${transition.elapsed.toFixed(1)}ms at tick ${transition.tick}`,
  );
  bakeEngine.destroy();
}

const engine = attachTestHooks(createEngineWasmRaw({
  cols: COLS,
  rows: ROWS,
  worldSeed: (0x9e3779b9 * 2) >>> 0,
  sinksOn: false,
  infinite: true,
}));
engine.setBgEnabled(true);
engine.setCreativeMaterial(CREATIVE_KIND.MATERIAL, MAT.TNT);

let random = (0x85ebca6b ^ 1) >>> 0;
const next = () => {
  random ^= random << 13;
  random ^= random >>> 17;
  random ^= random << 5;
  return random >>> 0;
};

for (let blast = 0; blast < BLASTS; blast++) {
  const x = 40 + next() % (COLS - 80);
  const y = 70 + next() % (ROWS - 120);
  const button = next() % 5 === 0 ? 2 : 0;
  const points = 4 + next() % 10;
  engine.pointerDown(x, y, button);
  for (let point = 1; point < points; point++) {
    const angle = point * Math.PI * 2 / points;
    const radius = 12 + next() % 58;
    engine.pointerDraft(
      Math.max(2, Math.min(COLS - 3,
        Math.round(x + Math.cos(angle) * radius))),
      Math.max(2, Math.min(ROWS - 3,
        Math.round(y + Math.sin(angle) * radius))),
    );
  }
  engine.pointerUp(button);
  engine.pointerButtons(0);
  engine.paintDiscLayer(button === 2 ? 1 : 0,
    x - 8, y, 4, MAT.FIRE, false);
  for (let step = 0; step < STEPS_PER_BLAST; step++) {
    engine.stepActors();
    engine.stepWorld();
  }
}

const expectedTick = BLASTS * STEPS_PER_BLAST;
if (engine.getTick() !== expectedTick) {
  throw new Error(`world stopped at tick ${engine.getTick()} of ${expectedTick}`);
}
console.log(`ok - repeated TNT rubble baked through tick ${expectedTick}`);
engine.destroy();
