// Headless browser test for runtime zoom. Boots Vite, checks that +/- resize the
// visible and loaded windows without losing the world, then drives zoom far past
// its safe floor and verifies that both WebGL layers keep rendering.
//
//   node scripts/zoom-e2e.mjs
//   BROWSER=webkit node scripts/zoom-e2e.mjs

import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { getAvailablePort } from './test-port.mjs';

const PORT = await getAvailablePort();
const NPM = process.platform === 'win32' ? process.execPath : 'npm';
const NPM_ARGS = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : [];
const baseURL = `http://localhost:${PORT}/`;
let failures = 0;
const browserType = process.env.BROWSER === 'webkit' ? webkit : chromium;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };

const server = spawn(NPM, [...NPM_ARGS, 'run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
});
const killServer = () => {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
    else process.kill(-server.pid, 'SIGKILL');
  } catch { /* already gone */ }
};
const waitForServer = () => new Promise((resolve, reject) => {
  let done = false;
  const finish = () => { if (done) return; done = true; clearTimeout(to); clearInterval(poll); resolve(); };
  const fail = (err) => { if (done) return; done = true; clearTimeout(to); clearInterval(poll); killServer(); reject(err); };
  const to = setTimeout(() => fail(new Error('dev server timeout')), 60000);
  const poll = setInterval(async () => { try { if ((await fetch(baseURL)).ok) finish(); } catch {} }, 500);
  server.stderr.on('data', (d) => { const s = d.toString(); if (/error|in use/i.test(s)) fail(new Error('dev server: ' + s.trim())); });
});

let browser;
try {
  await waitForServer();
  browser = await browserType.launch();
  const context = await browser.newContext({ reducedMotion: 'no-preference', viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${baseURL}game?sandbox`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sandTest && window.__sandTest.info && window.__sandTest.info().viewCols > 0, null, { timeout: 30000 });
  await page.waitForFunction(() => !!window.__sandTest.getPlayer?.(), null, { timeout: 30000 });
  const focusGame = () => page.locator('sand-game').evaluate((host) => host.shadowRoot.querySelector('.sg-sim').focus({ preventScroll: true }));
  await focusGame();

  const info = () => page.evaluate(() => window.__sandTest.info());
  const base = await info();
  console.log(`base view ${base.viewCols}x${base.viewRows}, buffer ${base.cols}x${base.rows}, cellDev ${base.cellDev}`);
  check(`WebGL texture limit detected (${base.maxTextureSize})`, base.maxTextureSize >= 2048);

  // Zoom IN twice: fewer visible cells, bigger device cells, buffer unchanged.
  await focusGame();
  await page.keyboard.press('=');
  await page.keyboard.press('=');
  await page.waitForFunction((cols) => window.__sandTest.info().viewCols < cols, base.viewCols);
  const zin = await info();
  check(`zoom in reduces visible cells (${base.viewCols} -> ${zin.viewCols})`, zin.viewCols < base.viewCols && zin.viewRows < base.viewRows);
  check(`zoom in enlarges device cell size (${base.cellDev} -> ${zin.cellDev})`, zin.cellDev > base.cellDev);
  check(`zoom in shrinks the loaded buffer (${base.cols}x${base.rows} -> ${zin.cols}x${zin.rows})`, zin.cols <= base.cols && zin.rows <= base.rows);

  // Reset with 0.
  await focusGame();
  await page.keyboard.press('0');
  await page.waitForFunction((cols) => window.__sandTest.info().viewCols === cols, base.viewCols);
  const reset = await info();
  check(`0 resets to default view (${reset.viewCols} == ${base.viewCols})`, reset.viewCols === base.viewCols && reset.viewRows === base.viewRows);

  // Zoom OUT from default: more visible cells and a larger loaded buffer.
  await focusGame();
  await page.keyboard.press('-');
  await page.waitForFunction((cols) => window.__sandTest.info().viewCols > cols, base.viewCols);
  const zout = await info();
  check(`zoom out increases visible cells (${base.viewCols} -> ${zout.viewCols})`, zout.viewCols > base.viewCols && zout.viewRows > base.viewRows);
  check(`zoom out grows the loaded buffer (${base.cols}x${base.rows} -> ${zout.cols}x${zout.rows})`, zout.cols >= base.cols && zout.rows >= base.rows);
  check(`visible window always fits the buffer (${zout.viewCols} <= ${zout.cols})`, zout.viewCols <= zout.cols && zout.viewRows <= zout.rows);

  // Engine kept simulating throughout (player still present in survival).
  const alive = await page.evaluate(() => !!window.__sandTest.getPlayer?.());
  check('world/player survived the zoom changes', alive);

  // Safari may reset WebGL under memory pressure. Exercise the same browser
  // event path deliberately: held movement must clear, and both layer textures
  // plus the compositor must be rebuilt when the context returns.
  const recovery = await page.evaluate(async () => {
    const canvas = document.querySelector('sand-game').shadowRoot.querySelector('#sand-main');
    const gl = canvas.getContext('webgl2');
    const ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) return { supported: false };
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    const restored = new Promise((resolve) => canvas.addEventListener('webglcontextrestored', resolve, { once: true }));
    ext.loseContext();
    setTimeout(() => ext.restoreContext(), 100);
    await restored;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const i = window.__sandTest.info();
    const pixels = window.__sandTest.readPixels(Math.floor(i.canvasW / 2) - 8, 0, 16, i.canvasH);
    let rendered = false;
    for (let p = 3; p < pixels.length; p += 4) if (pixels[p] > 0) { rendered = true; break; }
    return { supported: true, heldKeys: window.__sandTest.heldKeys(), contextLost: gl.isContextLost(), rendered };
  });
  check('WebGL context restore clears held movement and redraws the world',
    !recovery.supported || (!recovery.contextLost && recovery.heldKeys === 0 && recovery.rendered));

  // Keep zooming out far past the former failure point. Fitting may stop only
  // at the device's texture-dimension limit; the composited canvas must stay alive.
  await focusGame();
  for (let i = 0; i < 24; i++) {
    if ((await info()).cols * (await info()).rows > 1_200_000) break;
    await page.keyboard.press('-');
    await page.waitForTimeout(50);
    // Each resize is authoritative-worker owned. Finish it before sending the
    // next zoom command so rapid input cannot outrun the resize transaction.
    await page.waitForFunction(() => !window.__sandPerf().workerResizePending,
      null, { timeout: 30000 });
  }
  await page.waitForFunction(() => window.__sandTest.info().cols * window.__sandTest.info().rows > 1_200_000,
    null, { timeout: 30000 });
  // Resizing this much reallocates and mirrors a million-cell world in the
  // authority worker. Wait for that transaction instead of sampling after an
  // arbitrary delay while the old and new buffers can still be in flight.
  await page.waitForFunction(() => !window.__sandPerf().workerResizePending,
    null, { timeout: 30000 });
  await page.evaluate(() => window.__sandTest.render(true));
  await page.waitForTimeout(100);
  const extreme = await info();
  // A completed worker resize and its first texture upload can land on adjacent
  // frames. Poll the actual compositor result instead of sampling that boundary
  // once. Render/read must remain in the same task because the context does not
  // preserve its drawing buffer after presentation.
  const rendered = await page.waitForFunction(() => {
    const t = window.__sandTest, i = t.info();
    t.render(true);
    const width = Math.min(16, i.canvasW);
    for (const fraction of [0.25, 0.5, 0.75]) {
      const x = Math.max(0, Math.min(i.canvasW - width,
        Math.floor(i.canvasW * fraction - width * 0.5)));
      const pixels = t.readPixels(x, 0, width, i.canvasH);
      for (let p = 3; p < pixels.length; p += 4) if (pixels[p] > 0) return true;
    }
    return false;
  }, null, { timeout: 15000, polling: 500 }).then(() => true, () => false);
  if (!rendered) console.log('  extreme debug', await page.evaluate(() => {
    const t = window.__sandTest, canvas = document.querySelector('sand-game').shadowRoot.querySelector('#sand-main');
    const gl = canvas.getContext('webgl2');
    return {
      info: t.info(), cam: t.getCam(), offset: t.worldOffset(), player: t.getPlayer(),
      fgStone: t.materialCount(3), bgStone: t.materialCountBg(3), contextLost: gl.isContextLost(), glError: gl.getError(),
      perf: window.__sandPerf(),
    };
  }));
  check(`extreme zoom respects GPU dimensions (${extreme.cols}x${extreme.rows} <= ${extreme.maxTextureSize})`,
    extreme.cols <= extreme.maxTextureSize && extreme.rows <= extreme.maxTextureSize);
  check(`extreme zoom exceeds the former fixed cell ceiling (${extreme.cols * extreme.rows})`,
    extreme.cols * extreme.rows > 1200000);
  check('foreground/background compositor still renders after extreme zoom', rendered);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser?.close();
  killServer();
}
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
