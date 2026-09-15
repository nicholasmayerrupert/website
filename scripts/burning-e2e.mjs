import { runBrowserCases } from './browser-harness.mjs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const artifacts = resolve(process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts/burning-browser');
mkdirSync(artifacts, { recursive: true });
process.exitCode = await runBrowserCases({ burning: async ({ page, baseURL, check }) => {
  await page.route('**/burning-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><body style="margin:24px;background:#161b22;color:#e9dcc6;font:16px system-ui"><h2>Burning timber</h2><p>Original wood texture with a flickering ember tint</p><main style="display:flex;gap:16px"></main></body>',
  }));
  await page.goto(baseURL + '/burning-fixture');
  const result = await page.evaluate(async () => {
    const { initSandWasm, createEngineWasm, MAT } = await import('/src/sand/wasmBridge/engineFactory.js');
    await initSandWasm();
    const cols = 96, rows = 80;
    const e = createEngineWasm({ cols, rows, infinite: false, sinksOn: false, worldSeed: 7 });
    const mirror = createEngineWasm({ cols, rows, storageRole: 'presentation' });
    const canvas = document.createElement('canvas');
    canvas.width = 576; canvas.height = 480; document.body.append(canvas);
    mirror.glInit(canvas); mirror.glResize(576, 480); mirror.setViewport(1, 6, cols, rows);
    mirror.cameraSet(0, 0); mirror.setSkyLight(0); mirror.glSetFlags(true, false, false);
    for (let y = 53; y < rows; y++) for (let x = 32; x < 36; x++) e.paintDisc(x, y, 0, MAT.STONE, true);
    for (let y = 40; y < 53; y++) for (let x = 18; x < 68; x++) e.paintDisc(x, y, 0, MAT.WOOD, true);
    e.syncComponents();
    const cold = e.serializeWorld();
    for (let tick = 0; tick < 90; tick++) {
      if (tick < 40) for (let x = 22; x < 64; x += 4) e.paintDisc(x, 39, 0, MAT.FIRE, true);
      e.stepWorld();
    }
    for (let k = 0; k < cols * rows; k++)
      if (e.getGrid()[k] === MAT.FIRE) e.eraseDisc(k % cols, Math.floor(k / cols), 0);
    const warm = e.serializeWorld(), mask = e.getBurningVisual().slice();
    const lit = mask.reduce((sum, bit) => sum + bit, 0);
    const gallery = (pixels, label) => {
      const figure = document.createElement('figure'); figure.style.margin = '0';
      const image = document.createElement('canvas'); image.width = 576; image.height = 480;
      image.style.cssText = 'width:432px;height:360px;image-rendering:pixelated';
      image.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), 576, 480), 0, 0);
      const caption = document.createElement('figcaption'); caption.textContent = label;
      figure.append(image, caption); document.querySelector('main').append(figure);
    };
    mirror.applyWorldMirror(cold, 0, 0); mirror.glRenderFrame(true);
    const coldLight = mirror.glActorLight(30, 38, 1, 1);
    gallery(mirror.glReadPixels(0, 0, 576, 480), 'Unlit');
    mirror.applyWorldMirror(warm, 0, 0); mirror.glRenderFrame(true);
    const warmLight = mirror.glActorLight(30, 38, 1, 1);
    const first = mirror.glReadPixels(0, 0, 576, 480);
    gallery(first, 'Burning');
    const hash = mirror.gridHash();
    await new Promise(done => setTimeout(done, 200));
    mirror.glRenderFrame(false);
    const second = mirror.glReadPixels(0, 0, 576, 480);
    let changed = 0;
    for (let k = 0; k < mask.length; k++) if (mask[k]) {
      const x = (k % cols) * 6 + 3, y = Math.floor(k / cols) * 6 + 3;
      const p = (y * 576 + x) * 4;
      if (first[p] !== second[p] || first[p + 1] !== second[p + 1] || first[p + 2] !== second[p + 2]) changed++;
    }
    mirror.glSetFlags(true, false, true); mirror.glRenderFrame(false);
    const frozen = mirror.glReadPixels(0, 0, 576, 480);
    await new Promise(done => setTimeout(done, 200)); mirror.glRenderFrame(false);
    const paused = mirror.glReadPixels(0, 0, 576, 480);
    const result = { lit, changed, coldLight, warmLight, sameWorld: hash === mirror.gridHash(), paused: frozen.every((v, i) => v === paused[i]) };
    canvas.remove(); mirror.destroy(); e.destroy();
    return result;
  });
  await page.screenshot({ path: resolve(artifacts, 'burning-filter.png'), fullPage: true });
  check('a substantial timber surface is burning', result.lit > 100, `${result.lit} cells`);
  check('WebGL refreshes the flickering filter without new world packets', result.changed > result.lit * 0.5, `${result.changed} cells changed`);
  check('flicker preserves the replicated world', result.sameWorld);
  check('pausing freezes the filter', result.paused);
  check('burning timber casts light into its surroundings at night', result.warmLight > result.coldLight,
    `${result.coldLight} -> ${result.warmLight}`);
} });
