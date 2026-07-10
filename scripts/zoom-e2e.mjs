// Headless browser test for the runtime zoom (view-only). Boots Vite, opens the
// game, and asserts that +/- change the visible cell window while the simulation
// BUFFER (cols/rows) stays constant — i.e. zoom never rebuilds the world — and
// that 0 resets to the default. Mirrors scripts/player-e2e.mjs's harness.
//
//   node scripts/zoom-e2e.mjs

import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const PORT = 5182;
const NPM = process.platform === 'win32' ? process.execPath : 'npm';
const NPM_ARGS = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : [];
const baseURL = `http://localhost:${PORT}/`;
let failures = 0;
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
  browser = await chromium.launch();
  const context = await browser.newContext({ reducedMotion: 'no-preference', viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${baseURL}game`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sandTest && window.__sandTest.info && window.__sandTest.info().viewCols > 0, null, { timeout: 30000 });
  await page.evaluate(() => document.activeElement?.blur?.());

  const info = () => page.evaluate(() => window.__sandTest.info());
  const base = await info();
  console.log(`base view ${base.viewCols}x${base.viewRows}, buffer ${base.cols}x${base.rows}, cellDev ${base.cellDev}`);

  // Zoom IN twice: fewer visible cells, bigger device cells, buffer unchanged.
  await page.keyboard.press('=');
  await page.keyboard.press('=');
  await page.waitForTimeout(120);
  const zin = await info();
  check(`zoom in reduces visible cells (${base.viewCols} -> ${zin.viewCols})`, zin.viewCols < base.viewCols && zin.viewRows < base.viewRows);
  check(`zoom in enlarges device cell size (${base.cellDev} -> ${zin.cellDev})`, zin.cellDev > base.cellDev);
  check(`zoom in shrinks the loaded buffer (${base.cols}x${base.rows} -> ${zin.cols}x${zin.rows})`, zin.cols <= base.cols && zin.rows <= base.rows);

  // Reset with 0.
  await page.keyboard.press('0');
  await page.waitForTimeout(120);
  const reset = await info();
  check(`0 resets to default view (${reset.viewCols} == ${base.viewCols})`, reset.viewCols === base.viewCols && reset.viewRows === base.viewRows);

  // Zoom OUT from default: more visible cells and a larger loaded buffer.
  await page.keyboard.press('-');
  await page.waitForTimeout(120);
  const zout = await info();
  check(`zoom out increases visible cells (${base.viewCols} -> ${zout.viewCols})`, zout.viewCols > base.viewCols && zout.viewRows > base.viewRows);
  check(`zoom out grows the loaded buffer (${base.cols}x${base.rows} -> ${zout.cols}x${zout.rows})`, zout.cols >= base.cols && zout.rows >= base.rows);
  check(`visible window always fits the buffer (${zout.viewCols} <= ${zout.cols})`, zout.viewCols <= zout.cols && zout.viewRows <= zout.rows);

  // Engine kept simulating throughout (player still present in survival).
  const alive = await page.evaluate(() => !!window.__sandTest.getPlayer?.());
  check('world/player survived the zoom changes', alive);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser?.close();
  killServer();
}
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
