// Browser test for VERTICAL world streaming: a world shift must be SEAMLESS — the
// player sees the same thing before/after, because the camera pulls back exactly
// as the world slides. Verifies worldOffsetY advances AND the GL vertical slide is
// correct (frame before == frame after a triggered down-shift).
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
const PORT = 5184; const baseURL = `http://localhost:${PORT}/`;
const NPM = process.platform === 'win32' ? process.execPath : 'npm';
const NPM_ARGS = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : [];
let failures = 0; const check = (l, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}`); };
const vite = spawn(NPM, [...NPM_ARGS, 'run', 'dev', '--', '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const kill = () => {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(vite.pid), '/t', '/f'], { stdio: 'ignore' });
    else process.kill(-vite.pid, 'SIGKILL');
  } catch {}
};
const waitUp = () => new Promise((res, rej) => {
  let b = '', done = false;
  const finish = () => { if (done) return; done = true; clearTimeout(to); clearInterval(poll); res(); };
  const fail = (err) => { if (done) return; done = true; clearTimeout(to); clearInterval(poll); kill(); rej(err); };
  const to = setTimeout(() => fail(new Error('timeout')), 60000);
  const poll = setInterval(async () => { try { if ((await fetch(baseURL)).ok) finish(); } catch {} }, 500);
  vite.stdout.on('data', d => { b += d; if (new RegExp(`localhost:${PORT}`).test(b)) finish(); });
  vite.stderr.on('data', d => { if (/in use/i.test(d.toString())) fail(new Error('port in use')); });
});
let browser;
try {
  await waitUp();
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--disable-background-timer-throttling'] });
  const page = await browser.newPage();
  await page.goto(`${baseURL}game`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sandTest && window.__sandTest.info().cols > 0, null, { timeout: 30000 });
  await page.waitForTimeout(800);

  const r = await page.evaluate(() => {
    const T = window.__sandTest, i = T.info();
    T.setPaused(true);
    // park the camera near the BOTTOM edge (integer cell, no sub-cell offset) so a
    // stream pass triggers a downward vertical shift.
    const cx = Math.floor((i.cols - i.viewCols) / 2);
    const cy = i.rows - i.viewRows - 5;
    T.setCam(cx, cy); T.render();
    const before = Array.from(T.readPixels(0, 0, i.canvasW, i.canvasH));
    const oy0 = T.worldOffset().y;
    T.streamWorldTest(); // should vertical-shift (world up, camera pulled back)
    const oy1 = T.worldOffset().y;
    T.render();
    const after = Array.from(T.readPixels(0, 0, i.canvasW, i.canvasH));
    // compare the inner region (avoid the freshly-exposed band edge): mean abs luma diff
    let diff = 0, n = 0; const W = i.canvasW, H = i.canvasH;
    for (let y = 8; y < H - 8; y++) for (let x = 8; x < W - 8; x++) { const k = (y * W + x) * 4; diff += Math.abs(before[k] - after[k]) + Math.abs(before[k+1] - after[k+1]) + Math.abs(before[k+2] - after[k+2]); n += 3; }
    return { oy0, oy1, meanDiff: diff / n, W, H };
  });
  console.log(`  worldOffsetY ${r.oy0} -> ${r.oy1}, frame meanDiff ${r.meanDiff.toFixed(2)} (canvas ${r.W}x${r.H})`);
  check(`vertical shift advanced worldOffsetY (${r.oy0} -> ${r.oy1})`, r.oy1 > r.oy0);
  check(`world shift is SEAMLESS on screen (meanDiff ${r.meanDiff.toFixed(2)} < 6)`, r.meanDiff < 6);
  await browser.close();
} catch (e) { console.error('vstream-e2e error:', e.message); failures++; }
finally { if (browser) await browser.close().catch(() => {}); kill(); }
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} failed`);
process.exit(failures ? 1 : 0);
