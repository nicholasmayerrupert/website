import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const PORT = 5198;
const baseURL = `http://localhost:${PORT}`;
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
};

const NPM = process.platform === 'win32' ? process.execPath : 'npm';
const NPM_ARGS = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : [];
const server = spawn(NPM, [...NPM_ARGS, 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT)], {
  cwd: new URL('..', import.meta.url), stdio: 'ignore', detached: true,
});
const killServer = () => {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
    else process.kill(-server.pid, 'SIGTERM');
  } catch {}
};

async function waitForServer() {
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    try { if ((await fetch(baseURL)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('dev server timeout');
}

let browser, mobileContext;
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
    const info = t.info();
    const rect = document.querySelector('sand-game').shadowRoot.querySelector('#sand-main').getBoundingClientRect();
    const localX = Math.floor(rect.width * 0.5);
    const localY = Math.floor(rect.height * 0.18);
    const [cx, cy] = t.cellAt(localX, localY);
    return { x: rect.left + localX, y: rect.top + localY, cx, cy, before: t.materialCountBoth(1) };
  });
  const defaultRigidBefore = await page.evaluate(() => window.__sandTest.materialCount(13));
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(300);
  const defaultRigidAfter = await page.evaluate(() => window.__sandTest.materialCount(13));
  check('default creative cube survives worker initialization', defaultRigidAfter > defaultRigidBefore, `${defaultRigidBefore} -> ${defaultRigidAfter}`);

  // Creature eggs are actor tools, not grid writes. Select one through the real
  // palette and click the canvas; the main actor-owning mirror must receive it
  // even though ordinary creative tools remain worker-owned.
  const foxBefore = await page.evaluate(() => window.__sandTest.getCreatures().filter((c) => c.species === 2).length);
  const game = page.locator('sand-game');
  await game.locator('.sg-expand').click();
  await game.locator('.sg-search').fill('fox spawn egg');
  await game.locator('.sg-opt', { hasText: 'Fox Spawn Egg' }).click();
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction((n) => window.__sandTest.getCreatures().filter((c) => c.species === 2).length > n, foxBefore);
  const foxAfter = await page.evaluate(() => {
    const foxes = window.__sandTest.getCreatures().filter((c) => c.species === 2);
    return { count: foxes.length, creature: foxes[foxes.length - 1] };
  });
  check('creative palette egg click spawns a visible actor', foxAfter.count === foxBefore + 1, `${foxBefore} -> ${foxAfter.count}`);
  check('creative eggs do not enable natural population spawning',
    await page.evaluate(() => window.__sandTest.getCreatures().length) === 1);

  await page.evaluate(() => window.__sandTest.setCreativeMaterial(0, 1)); // SAND
  await page.mouse.move(target.x, target.y);
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(350);
  await page.mouse.up({ button: 'left' });
  await page.waitForFunction(() => window.__sandPerf().workerEdges >= 6);
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => window.__sandTest.materialCountBoth(1));
  check('worker-owned creative paint reaches the render mirror', after > target.before, `${target.before} -> ${after}`);
  if (after <= target.before) console.log('  worker input debug', await page.evaluate(() => window.__sandPerf()));
  const fallingHash0 = await page.evaluate(() => window.__sandTest.gridHash());
  await page.waitForTimeout(350);
  const fallingHash1 = await page.evaluate(() => window.__sandTest.gridHash());
  check('world keeps advancing after a replication packet is consumed', fallingHash1 !== fallingHash0, `${fallingHash0} -> ${fallingHash1}`);
  const clocks = await page.evaluate(() => { const p = window.__sandPerf(); return [p.mirrorWorldTick, p.worldTick]; });
  check('render mirror follows the worker world clock for live lighting', clocks[0] === clocks[1] && clocks[0] > 0, `${clocks[0]} / ${clocks[1]}`);
  await page.waitForTimeout(900); // exceed queued mirror packets; prove the worker kept advancing the actor
  const movedFox = await page.evaluate((id) => window.__sandTest.getCreatures().find((c) => c.id === id), foxAfter.creature.id);
  check('egg-spawned creature keeps simulating after selecting another tool',
    movedFox && Math.hypot(movedFox.x - foxAfter.creature.x, movedFox.y - foxAfter.creature.y) > 0.1);

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

  const cubeStoneBefore = await page.evaluate(() => {
    window.__sandTest.setCreativeMaterial(3, 0); // CUBE
    return window.__sandTest.materialCount(3); // last body-capable selection was STONE
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(350);
  const cubeStoneAfter = await page.evaluate(() => window.__sandTest.materialCount(3));
  check('worker cube placement reaches the render mirror', cubeStoneAfter > cubeStoneBefore, `${cubeStoneBefore} -> ${cubeStoneAfter}`);

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

  // Runtime/browser zoom can fire several fits before the debounced worker
  // resize. A larger control viewport must never make the old worker stream on
  // every turn or let its snapshot displace the preserved world-space center.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sandTest && window.__sandPerf && window.__sandPerf().worldTps > 0, null, { timeout: 30000 });
  const zoomCenter0 = await page.evaluate(() => {
    const t = window.__sandTest, info = t.info(), cam = t.getCam(), off = t.worldOffset();
    return { x: off.x + cam.x + info.viewCols / 2, y: off.y + cam.y + info.viewRows / 2 };
  });
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('-');
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(1200);
  const zoomCenter1 = await page.evaluate(() => {
    const t = window.__sandTest, info = t.info(), cam = t.getCam(), off = t.worldOffset();
    return { x: off.x + cam.x + info.viewCols / 2, y: off.y + cam.y + info.viewRows / 2 };
  });
  check('rapid zoom keeps the worker mirror on the same world center',
    Math.abs(zoomCenter1.x - zoomCenter0.x) < 2 && Math.abs(zoomCenter1.y - zoomCenter0.y) < 2,
    `${zoomCenter0.x.toFixed(1)},${zoomCenter0.y.toFixed(1)} -> ${zoomCenter1.x.toFixed(1)},${zoomCenter1.y.toFixed(1)}`);

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

  // Mobile taps use the compact FG/BG control beside zoom to choose whether
  // they behave like left-click or right-click. Exercise real touch pointers so
  // desktop mouse semantics cannot accidentally satisfy this check.
  mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    reducedMotion: 'no-preference',
  });
  const mobile = await mobileContext.newPage();
  await mobile.goto(baseURL, { waitUntil: 'networkidle' });
  await mobile.waitForFunction(() => window.__sandTest && window.__sandPerf && window.__sandPerf().worldTps > 0, null, { timeout: 30000 });
  const mobileGame = mobile.locator('sand-game');
  await mobileGame.locator('.sg-toggle').tap(); // Draw On
  const controls = await mobileGame.locator('.sg-zoom').evaluate((wrap) => {
    const zoom = wrap.querySelector('.sg-zoom-stack').getBoundingClientRect();
    const layer = wrap.querySelector('.sg-layer').getBoundingClientRect();
    return { spaced: layer.left >= zoom.right + 6, layerLabel: wrap.querySelector('.sg-layer').textContent.trim() };
  });
  check('mobile layer toggle is spaced to the right of zoom', controls.spaced && controls.layerLabel === 'FG');
  const mobileTarget = await mobile.evaluate(() => {
    window.__sandTest.setCreativeMaterial(0, 3); // STONE
    const rect = document.querySelector('sand-game').shadowRoot.querySelector('#sand-main').getBoundingClientRect();
    return {
      x: rect.left + rect.width * 0.58, y: rect.top + rect.height * 0.18,
      fg: window.__sandTest.materialCount(3), bg: window.__sandTest.materialCountBg(3),
    };
  });
  await mobile.touchscreen.tap(mobileTarget.x, mobileTarget.y);
  await mobile.waitForFunction((before) => window.__sandTest.materialCount(3) > before, mobileTarget.fg);
  const foregroundTap = await mobile.evaluate(() => ({ fg: window.__sandTest.materialCount(3), bg: window.__sandTest.materialCountBg(3) }));
  check('mobile FG tap writes to the foreground', foregroundTap.fg > mobileTarget.fg && foregroundTap.bg === mobileTarget.bg);

  await mobileGame.locator('.sg-layer').tap();
  const layerState = await mobileGame.locator('.sg-layer').evaluate((button) => ({
    text: button.textContent.trim(), pressed: button.getAttribute('aria-pressed'),
  }));
  await mobile.touchscreen.tap(mobileTarget.x + 34, mobileTarget.y);
  await mobile.waitForFunction((before) => window.__sandTest.materialCountBg(3) > before, foregroundTap.bg);
  const backgroundTap = await mobile.evaluate(() => ({ fg: window.__sandTest.materialCount(3), bg: window.__sandTest.materialCountBg(3) }));
  check('mobile layer toggle reports the background state', layerState.text === 'BG' && layerState.pressed === 'true');
  check('mobile BG tap writes to the background', backgroundTap.bg > foregroundTap.bg && backgroundTap.fg === foregroundTap.fg,
    `fg ${foregroundTap.fg} -> ${backgroundTap.fg}, bg ${foregroundTap.bg} -> ${backgroundTap.bg}`);

  await mobileGame.locator('.sg-expand').tap();
  const openUi = await mobileGame.evaluate((host) => {
    const root = host.shadowRoot;
    const list = root.querySelector('.sg-list');
    return {
      joystickHidden: getComputedStyle(root.querySelector('.sg-stick')).display === 'none',
      controlsHidden: getComputedStyle(root.querySelector('.sg-zoom')).display === 'none',
      scrollable: list.scrollHeight > list.clientHeight,
    };
  });
  check('expanded mobile palette hides joystick and left controls', openUi.joystickHidden && openUi.controlsHidden);
  check('expanded mobile material list has scrollable overflow', openUi.scrollable);

  const listBox = await mobileGame.locator('.sg-list').boundingBox();
  const cdp = await mobileContext.newCDPSession(mobile);
  const touchX = listBox.x + listBox.width / 2;
  const touchStartY = listBox.y + listBox.height * 0.78;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchX, y: touchStartY }] });
  for (let i = 1; i <= 5; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: touchX, y: touchStartY - i * 24 }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.waitForTimeout(250);
  const scrollTop = await mobileGame.locator('.sg-list').evaluate((list) => list.scrollTop);
  check('mobile swipe scrolls the material list', scrollTop > 20, `scrollTop ${scrollTop.toFixed(0)}`);

  await mobileGame.locator('.sg-opt', { hasText: 'water' }).first().tap();
  await mobileGame.locator('.sg-list').waitFor({ state: 'detached' });
  const closedUi = await mobileGame.evaluate((host) => {
    const root = host.shadowRoot;
    return {
      joystickVisible: getComputedStyle(root.querySelector('.sg-stick')).display !== 'none',
      controlsVisible: getComputedStyle(root.querySelector('.sg-zoom')).display !== 'none',
    };
  });
  check('selecting a mobile material restores joystick and left controls', closedUi.joystickVisible && closedUi.controlsVisible);
  await mobileContext.close();
  mobileContext = null;
} catch (error) {
  console.error(error);
  failures++;
} finally {
  await mobileContext?.close().catch(() => {});
  await browser?.close();
  killServer();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
