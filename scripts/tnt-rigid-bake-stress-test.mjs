// Repeated blasts exercise foreground/background destruction, rubble motion,
// and the conversion of several resting rigid bodies in one world step.
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
