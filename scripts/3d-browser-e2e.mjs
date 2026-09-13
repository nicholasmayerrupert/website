import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startTestServer } from './browser-harness.mjs';

const server = await startTestServer({ production: !process.argv.includes('--dev') });
const artifacts = resolve(process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts/3d-browser');
mkdirSync(artifacts, { recursive: true });
let browser;
const hardware = process.argv.includes('--hardware') || (process.platform === 'win32' && !process.argv.includes('--software'));
try {
  browser = await chromium.launch({ headless: true, args: hardware ? ['--use-angle=d3d11'] : ['--use-angle=swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || /GL_INVALID|Error compiling.*executable/.test(message.text())) errors.push(message.text());
  });
  page.on('request', request => requests.push(request.url()));
  await page.goto(`${server.baseURL}/`, { waitUntil: 'networkidle' });
  assert.ok(!requests.some(url => /voxelDemo|sand3d/.test(url)), 'home does not request any 3D code or WASM');
  assert.equal(await page.evaluate(() => window.__voxelDemo), undefined);
  console.log('Home: no 3D requests or runtime.');
  requests.length = 0; errors.length = 0;
  await page.goto(`${server.baseURL}/3d?test`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#voxel-canvas[data-ready="true"]', { timeout: 60000 });
  const renderer = await page.evaluate(() => {
    const gl = document.getElementById('voxel-canvas').getContext('webgl2');
    return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
  });
  if (hardware) assert.match(renderer, /Direct3D11/, 'hardware regression runs on the D3D11 backend');
  console.log(`Renderer: ${renderer}`);
  assert.ok(requests.some(url => /voxelDemo.*\.wasm/.test(url)), '3D navigation loads its WASM');
  assert.ok(!requests.some(url => /sandEngine.*\.wasm|worldWorker/.test(url)), '3D does not start the 2D engine');
  await page.screenshot({ path: resolve(artifacts, 'desktop-intro.png') });
  await page.locator('#enter').click();
  await page.waitForFunction(() => window.__voxelDemo.stats()[0] > 5);
  const before = await page.evaluate(() => window.__voxelDemo.stats());
  await page.keyboard.down('KeyW'); await page.waitForTimeout(400); await page.keyboard.up('KeyW');
  assert.ok((await page.evaluate(() => window.__voxelDemo.stats()))[7] < before[7] - 0.3, 'keyboard moves the camera');
  const colors = await page.evaluate(() => {
    window.__voxelDemo.render();
    const canvas = document.getElementById('voxel-canvas');
    const gl = canvas.getContext('webgl2');
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const distinct = new Set();
    for (let i = 0; i < pixels.length; i += 128) distinct.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    return { count: distinct.size, error: gl.getError() };
  });
  assert.equal(colors.error, 0, 'drawing and readback succeed on the selected graphics backend');
  assert.ok(colors.count > 50, 'raycaster renders a non-uniform material scene');
  await page.screenshot({ path: resolve(artifacts, 'desktop-quarry.png') });
  await page.keyboard.press('Digit5');
  await page.mouse.down(); await page.waitForTimeout(200); await page.mouse.up();
  await page.waitForFunction(() => window.__voxelDemo.stats()[1] > 0);
  console.log('Desktop: camera, tool selection, and throwing work through DOM input.');

  await page.evaluate(() => {
    const d = window.__voxelDemo; d.menu(true); d.reset(); d.tool(0);
    // Two repeated cuts with the default brush make a complete gap in each support.
    for (const x of [24.5, 25.5, 38.5, 39.5]) {
      d.camera(x, 10, 35, 0, 0); d.use(); d.use(); d.use();
    }
    d.pause(false); d.step(120); d.pause(true); d.render();
  });
  const mined = await page.evaluate(() => window.__voxelDemo.stats());
  assert.ok(mined[3] > 0 && mined[1] > 0, 'mining detaches structures in the browser');
  await page.evaluate(() => { const d = window.__voxelDemo; d.camera(32, 18, 55, 0, -0.23); d.render(); });
  await page.locator('#intro').evaluate(el => { el.hidden = true; });
  await page.screenshot({ path: resolve(artifacts, 'desktop-mined.png') });
  await page.evaluate(() => window.__voxelDemo.menu(true));
  const paused = await page.evaluate(() => window.__voxelDemo.stats()[0]);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.__voxelDemo.stats()[0]), paused);
  assert.equal(await page.evaluate(() => window.__voxelDemo.running), false, 'menu cancels RAF processing');
  await page.screenshot({ path: resolve(artifacts, 'desktop-paused.png') });
  assert.deepEqual(errors, [], `browser errors: ${errors.join('\n')}`);
  await page.evaluate(() => document.getElementById('voxel-canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await page.waitForFunction(() => !document.getElementById('retry').hidden);
  assert.equal(await page.evaluate(() => window.__voxelDemo.running), false, 'context loss stops processing and offers recovery');
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const touch = await mobile.newPage();
  const mobileErrors = [];
  touch.on('pageerror', error => mobileErrors.push(error.message));
  await touch.goto(`${server.baseURL}/3d/?test`);
  await touch.waitForSelector('#voxel-canvas[data-ready="true"]', { timeout: 60000 });
  await touch.locator('#enter').tap();
  await touch.waitForFunction(() => window.__voxelDemo.stats()[0] > 2);
  assert.equal(await touch.locator('#touch-controls').isVisible(), true);
  await touch.locator('[data-tool="1"]').tap();
  assert.equal(await touch.locator('#touch-use').textContent(), 'POUR');
  const initialSand = await touch.evaluate(() => window.__voxelDemo.stats()[4]);
  // Hold and cancel a touch using DOM pointer events; cancellation must release input.
  const client = await mobile.newCDPSession(touch);
  const useBounds = await touch.locator('#touch-use').boundingBox();
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: useBounds.x + useBounds.width / 2, y: useBounds.y + useBounds.height / 2 }] });
  await touch.waitForTimeout(300);
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  assert.ok((await touch.evaluate(() => window.__voxelDemo.stats()))[4] > initialSand, 'touch tool pours sand');
  await touch.waitForTimeout(100);
  const stoppedSand = await touch.evaluate(() => window.__voxelDemo.stats()[4]);
  await touch.waitForTimeout(250);
  assert.equal(await touch.evaluate(() => window.__voxelDemo.stats()[4]), stoppedSand, 'cancel releases the tool');
  await touch.screenshot({ path: resolve(artifacts, 'mobile-quarry.png') });
  assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile controls fit');
  await touch.locator('#menu').tap();
  assert.equal(await touch.evaluate(() => window.__voxelDemo.running), false);
  assert.deepEqual(mobileErrors, []);
  await mobile.close();
  console.log(`3D browser checks passed. Screenshots: ${artifacts}`);
} finally { await browser?.close(); server.close(); }
