import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5198;
const baseURL = `http://localhost:${PORT}`;
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
};

const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT)], {
  cwd: new URL('..', import.meta.url), stdio: 'ignore', detached: true,
});
const killServer = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} };

async function waitForServer() {
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    try { if ((await fetch(baseURL)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('dev server timeout');
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('console', (msg) => { if (msg.type() === 'error') console.error('browser:', msg.text()); });
  page.on('pageerror', (error) => console.error('pageerror:', error));
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sandTest && window.__sandPerf, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__sandPerf().worldTps > 0, null, { timeout: 30000 });
  const countRaf = (ms) => page.evaluate((duration) => new Promise((resolve) => {
    let n = 0;
    const started = performance.now();
    const frame = () => {
      n++;
      if (performance.now() - started >= duration) resolve(n);
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), ms);

  // Paint into an empty upper-view region through real DOM input; the worker is
  // the only code allowed to mutate the creative world.
  const target = await page.evaluate(() => {
    const t = window.__sandTest;
    t.setPlayMode(false);
    t.setDrawMode(true);
    t.setCreativeMaterial(0, 1); // SAND
    const info = t.info();
    const rect = document.querySelector('sand-game').shadowRoot.querySelector('#sand-main').getBoundingClientRect();
    const localX = Math.floor(rect.width * 0.5);
    const localY = Math.floor(rect.height * 0.18);
    const [cx, cy] = t.cellAt(localX, localY);
    return { x: rect.left + localX, y: rect.top + localY, cx, cy, before: t.materialCount(1) };
  });
  await page.mouse.move(target.x, target.y);
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(350);
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => window.__sandTest.materialCount(1));
  check('worker-owned creative paint reaches the render mirror', after > target.before, `${target.before} -> ${after}`);
  if (after <= target.before) console.log('  worker input debug', await page.evaluate(() => window.__sandPerf()));
  const fallingHash0 = await page.evaluate(() => window.__sandTest.gridHash());
  await page.waitForTimeout(350);
  const fallingHash1 = await page.evaluate(() => window.__sandTest.gridHash());
  check('world keeps advancing after a replication packet is consumed', fallingHash1 !== fallingHash0, `${fallingHash0} -> ${fallingHash1}`);

  // Component drafts are non-grid state, so verify their explicit preview mirror
  // and the worker-owned finalize edge separately.
  const stoneBefore = await page.evaluate(() => {
    window.__sandTest.setCreativeMaterial(0, 3); // STONE
    return window.__sandTest.materialCount(3);
  });
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(target.x + 24, target.y, { steps: 6 });
  await page.waitForTimeout(250);
  const draftCount = await page.evaluate(() => window.__sandTest.draftCount());
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(500);
  const stoneAfter = await page.evaluate(() => window.__sandTest.materialCount(3));
  check('worker draft preview is mirrored to WebGL state', draftCount > 0, `${draftCount} cells`);
  check('worker release finalizes the connected component', stoneAfter > stoneBefore, `${stoneBefore} -> ${stoneAfter}`);

  // Put the camera at the loaded-window edge and verify the worker streams and
  // re-anchors the main mirror without changing the absolute camera location.
  const stream0 = await page.evaluate(() => {
    const t = window.__sandTest, info = t.info(), cam = t.getCam(), off = t.worldOffset();
    t.setCam(info.cols - info.viewCols - 2, cam.y);
    const moved = t.getCam();
    return { offX: off.x, absX: off.x + moved.x };
  });
  await page.waitForFunction((oldX) => window.__sandTest.worldOffset().x !== oldX, stream0.offX, { timeout: 10000 });
  const stream1 = await page.evaluate(() => { const t = window.__sandTest, off = t.worldOffset(), cam = t.getCam(); return { offX: off.x, absX: off.x + cam.x }; });
  check('worker owns horizontal streaming', stream1.offX !== stream0.offX, `${stream0.offX} -> ${stream1.offX}`);
  check('stream snapshot preserves absolute camera position', Math.abs(stream1.absX - stream0.absX) < 2, `${stream0.absX.toFixed(1)} -> ${stream1.absX.toFixed(1)}`);

  // Force each worker world turn over budget. The main thread should continue
  // receiving ~60 RAF callbacks and pan the camera on its actor clock while the
  // worker naturally drops below 60 TPS.
  // Reload to isolate scheduling from the intentionally active sand scene above;
  // the delay hook itself consumes no CPU and represents an over-budget world turn.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sandTest && window.__sandPerf && window.__sandPerf().worldTps > 0, null, { timeout: 30000 });
  await page.evaluate(() => window.__sandTest.setPlayMode(false));
  const baselineRafHz = await countRaf(1000);
  await page.evaluate(() => window.__sandTest.setWorldDelay(22));
  const cam0 = await page.evaluate(() => window.__sandTest.getCam().x);
  const rafFrames = await countRaf(2000);
  await page.keyboard.down('d');
  await page.waitForTimeout(750);
  await page.keyboard.up('d');
  const result = await page.evaluate(() => ({ perf: window.__sandPerf(), camX: window.__sandTest.getCam().x }));
  const rafHz = rafFrames / 2;
  check('main-thread RAF remains independent of the slow world', rafHz >= baselineRafHz * 0.8, `${baselineRafHz.toFixed(1)} -> ${rafHz.toFixed(1)} Hz; apply ${result.perf.mirrorApplyMs?.toFixed(1)}ms, render ${result.perf.renderMs?.toFixed(1)}ms, packet ${result.perf.mirrorPacketBytes}`);
  check('stress hook reduced worker world TPS', result.perf.worldTps < 55, `${result.perf.worldTps.toFixed(1)} TPS`);
  check('creative camera keeps moving while world is slow', result.camX > cam0 + 50, `${cam0.toFixed(1)} -> ${result.camX.toFixed(1)}`);
  await page.evaluate(() => window.__sandTest.setWorldDelay(0));
} catch (error) {
  console.error(error);
  failures++;
} finally {
  await browser?.close();
  killServer();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
