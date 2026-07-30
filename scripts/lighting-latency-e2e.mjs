// WebGL regression for presentation-mirror lighting cadence. Two authoritative
// diffs are presented back-to-back, well inside the periodic full-light interval;
// both must update a distant skylight shadow immediately.

import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { makeChecker } from './sand-test-util.mjs';
import { getAvailablePort } from './test-port.mjs';

const PORT = await getAvailablePort();
const URL = `http://127.0.0.1:${PORT}/`;
const server = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js',
  '--host', '127.0.0.1',
  '--port', String(PORT),
  '--strictPort',
], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
const stopServer = () => {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      process.kill(-server.pid, 'SIGKILL');
    }
  } catch { /* already stopped */ }
};
const waitForServer = () => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('dev server timeout')), 60000);
  const poll = setInterval(async () => {
    try {
      if ((await fetch(URL)).ok) {
        clearTimeout(timeout);
        clearInterval(poll);
        resolve();
      }
    } catch { /* still starting */ }
  }, 250);
});

const { check, done } = makeChecker('presentation lighting latency');
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const [{ initSandWasm, createEngineWasm }, { MAT }] = await Promise.all([
      import('/src/sand/wasmBridge/engineFactory.js'),
      import('/src/sand/materials.js'),
    ]);
    await initSandWasm();
    const cols = 128, rows = 128;
    const source = createEngineWasm({
      cols, rows, infinite: false, sinksOn: false, storageRole: 'authority', worldSeed: 7,
    });
    const mirror = createEngineWasm({
      cols, rows, infinite: false, sinksOn: false, storageRole: 'presentation', worldSeed: 7,
    });
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    document.body.append(canvas);
    mirror.glInit(canvas);
    mirror.glResize(cols, rows);
    mirror.setViewport(1, 1, cols, rows);
    mirror.cameraSet(0, 0);
    mirror.glSetFlags(false, false, true);
    source.setSkyLight(255);
    mirror.setSkyLight(255);

    // A narrow open shaft isolates the sampled floor from light entering from
    // adjacent columns. The temporary crossbar is far above that floor.
    for (let y = 8; y <= 112; y++) {
      source.paintDisc(55, y, 0, MAT.STONE, true);
      source.paintDisc(72, y, 0, MAT.STONE, true);
    }
    for (let x = 55; x <= 72; x++) source.paintDisc(x, 112, 0, MAT.STONE, true);
    source.syncComponents();
    mirror.applyWorldMirror(source.serializeWorld(), 0, 0);
    source.resetDirty();
    mirror.glRenderFrame(true);

    const brightness = (x, y) => {
      const p = mirror.glReadPixels(x, y, 1, 1);
      return (p[0] + p[1] + p[2]) / 3;
    };
    const open = brightness(63, 112);

    for (let x = 56; x <= 71; x++) source.paintDisc(x, 48, 0, MAT.STONE, true);
    source.syncComponents();
    mirror.applyDiffMirror(source.serializeDiff());
    source.resetDirty();
    mirror.setMirrorWorldTick(1);
    mirror.glRenderFrame(false);
    const blocked = brightness(63, 112);
    const blockLightMs = mirror.getPerf().lightMs;

    for (let x = 56; x <= 71; x++) source.eraseDisc(x, 48, 0);
    source.syncComponents();
    mirror.applyDiffMirror(source.serializeDiff());
    source.resetDirty();
    mirror.setMirrorWorldTick(2);
    mirror.glRenderFrame(false);
    const reopened = brightness(63, 112);
    const eraseLightMs = mirror.getPerf().lightMs;

    // A user-authored loose edit is urgent, while later autonomous churn remains
    // on the periodic catch-up path.
    source.paintDisc(24, 24, 3, MAT.WATER, true);
    mirror.applyDiffMirror(source.serializeDiff(), 20, 28);
    source.resetDirty();
    mirror.setMirrorWorldTick(3);
    mirror.glRenderFrame(false);
    const editedWaterLightMs = mirror.getPerf().lightMs;
    source.paintDisc(34, 30, 2, MAT.WATER, true);
    mirror.applyDiffMirror(source.serializeDiff());
    source.resetDirty();
    mirror.setMirrorWorldTick(4);
    mirror.glRenderFrame(false);
    const flowingWaterLightMs = mirror.getPerf().lightMs;

    source.destroy();
    mirror.destroy();
    canvas.remove();
    return {
      open, blocked, reopened, blockLightMs, eraseLightMs,
      editedWaterLightMs, flowingWaterLightMs,
    };
  });

  check(`a new blocker darkens its distant shadow in the same frame (${result.open.toFixed(1)} -> ${result.blocked.toFixed(1)})`,
    result.blocked < result.open - 12);
  check(`an immediate erase restores the light in the same frame (${result.blocked.toFixed(1)} -> ${result.reopened.toFixed(1)})`,
    result.reopened > result.blocked + 12 && Math.abs(result.reopened - result.open) < 8);
  check(`both back-to-back diffs ran lighting repairs (${result.blockLightMs.toFixed(3)}ms, ${result.eraseLightMs.toFixed(3)}ms)`,
    result.blockLightMs > 0 && result.eraseLightMs > 0);
  check(`a user-authored water edit repairs lighting immediately (${result.editedWaterLightMs.toFixed(3)}ms)`,
    result.editedWaterLightMs > 0);
  check(`autonomous water churn stays on the throttled catch-up path (${result.flowingWaterLightMs.toFixed(3)}ms)`,
    result.flowingWaterLightMs === 0);
} finally {
  await browser?.close();
  stopServer();
}

const failures = done();
process.exit(failures === 0 ? 0 : 1);
