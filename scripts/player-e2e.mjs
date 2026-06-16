// Headless browser test for the local playable character (Phase 2). Boots the
// Vite dev server, opens the About page, drives the player with real keyboard
// events, and asserts the engine-simulated player responds (moves right, jumps).
// Uses the `playwright` library directly (same approach as scripts/bench-pan.mjs)
// so it runs without the @playwright/test runner.
//
//   node scripts/player-e2e.mjs

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 5180;
const baseURL = `http://localhost:${PORT}/`;
let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };

// detached so we can kill the whole process group (npm spawns vite as a child;
// killing only npm would orphan vite and leave the port held -> flaky reruns).
const server = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
});
const killServer = () => { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* already gone */ } };
const waitForServer = () => new Promise((resolve, reject) => {
  let buf = '';
  const to = setTimeout(() => { killServer(); reject(new Error('dev server timeout')); }, 60000);
  const onData = (d) => { buf += d.toString(); if (new RegExp(`localhost:${PORT}`).test(buf)) { clearTimeout(to); resolve(); } };
  server.stdout.on('data', onData);
  server.stderr.on('data', (d) => { const s = d.toString(); if (/error|in use/i.test(s)) { clearTimeout(to); killServer(); reject(new Error('dev server: ' + s.trim())); } });
});

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const context = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await context.newPage();
  await page.goto(baseURL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sandTest && window.__sandTest.getPlayer && window.__sandTest.getPlayer(), null, { timeout: 30000 });

  console.log('local player');
  const getP = () => page.evaluate(() => window.__sandTest.getPlayer());

  // let the player settle onto the ground
  await page.waitForTimeout(800);
  const settled = await getP();
  check(`player spawned + grounded (y ${settled.y.toFixed(1)}, grounded ${settled.grounded})`, settled && settled.grounded);

  // hold D: input reaches the engine (facing flips right; x does not go backward).
  // Absolute displacement depends on the random terrain ahead, so the hard
  // assertion is on facing + non-regression; the distance is logged.
  const x0 = settled.x;
  await page.keyboard.down('d');
  await page.waitForTimeout(1000);
  await page.keyboard.up('d');
  const movedR = await getP();
  check(`D drives player right (facing ${movedR.facing}, x ${x0.toFixed(1)} -> ${movedR.x.toFixed(1)})`, movedR.facing === 1 && movedR.x >= x0 - 0.5);
  // hold A: facing flips left.
  await page.keyboard.down('a');
  await page.waitForTimeout(500);
  await page.keyboard.up('a');
  const movedL = await getP();
  check(`A drives player left (facing ${movedL.facing})`, movedL.facing === -1);

  // settle, then jump (space): y goes up then comes back down
  await page.waitForTimeout(600);
  const beforeJump = await getP();
  await page.keyboard.press('Space');
  // sample the apex over the next short window
  let minY = beforeJump.y;
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(40); const p = await getP(); minY = Math.min(minY, p.y); }
  check(`jumped upward (${beforeJump.y.toFixed(1)} -> peak ${minY.toFixed(1)})`, minY < beforeJump.y - 3);
  await page.waitForTimeout(900);
  const afterJump = await getP();
  check(`landed after jump (grounded ${afterJump.grounded})`, afterJump.grounded);

  // player-mediated dig: enable draw mode + eraser, hold LMB at the player's
  // own position, and assert the engine fired tool actions (mouse -> primary).
  const a0 = await page.evaluate(() => window.__sandTest.actionCount());
  const aim = await page.evaluate(() => {
    window.__sandTest.setDrawMode(true);
    window.__sandTest.setTool('eraser');
    const r = document.getElementById('sand-main').getBoundingClientRect();
    const s = window.__sandTest.playerScreen();
    return { vx: r.left + s.x, vy: r.top + s.y };
  });
  await page.mouse.move(aim.vx, aim.vy);
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(400);
  await page.mouse.up({ button: 'left' });
  const a1 = await page.evaluate(() => window.__sandTest.actionCount());
  check(`LMB drives player tool actions (${a0} -> ${a1})`, a1 > a0);
  await page.evaluate(() => window.__sandTest.setDrawMode(false));

  // camera follows: the player should remain near the viewport center
  const followInfo = await page.evaluate(() => {
    const t = window.__sandTest, i = t.info(), cam = t.getCam(), p = t.getPlayer();
    return { viewCols: i.viewCols, viewRows: i.viewRows, camX: cam.x, camY: cam.y, px: p.x, py: p.y };
  });
  const cx = followInfo.px - (followInfo.camX + followInfo.viewCols / 2);
  const cy = followInfo.py - (followInfo.camY + followInfo.viewRows / 2);
  check(`camera follows player (off-center ${cx.toFixed(1)},${cy.toFixed(1)})`, Math.abs(cx) < followInfo.viewCols * 0.35 && Math.abs(cy) < followInfo.viewRows * 0.45);

  await browser.close();
} catch (err) {
  console.error('e2e error:', err.message);
  failures++;
} finally {
  if (browser) await browser.close().catch(() => {});
  killServer();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
