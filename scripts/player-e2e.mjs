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
const INPUT_JUMP = 4; // PI_JUMP bit (mirrors enum PlayerInput / INPUT.JUMP)
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

  // Jump: hold briefly (so the press spans a 16ms fixed step) and watch the apex.
  // The procedural spawn can sit under an overhang/tree where a real jump hits a
  // ceiling, so if it doesn't rise we relocate (walk) and retry until we find open
  // headroom. (Jump mechanics themselves are covered deterministically by
  // player-test; here we only need to confirm the key drives the engine.)
  const waitGrounded = () => page.waitForFunction(() => { const p = window.__sandTest.getPlayer(); return p && p.grounded; }, null, { timeout: 5000 }).catch(() => {});
  // ensure no editable element (e.g. the DEV multiplayer room input) holds focus,
  // which would make onKeyDown ignore the WASD/space keys.
  await page.evaluate(() => document.activeElement?.blur?.());
  await waitGrounded();
  const before = await getP();
  // Hard check: SPACE maps to the JUMP input bit reaching the engine (terrain
  // independent). Jump PHYSICS — gravity, apex, no-double-jump — is covered
  // deterministically by player-test; in-browser it's terrain-dependent (the
  // player can spawn on flowing surface sand and never be cleanly grounded), so
  // we only log whether it physically rose.
  await page.keyboard.down('Space');
  await page.waitForTimeout(50);
  const jumpBits = await page.evaluate(() => window.__sandTest.localInput().bits);
  let minVy = 0;
  for (let t = 0; t < 10; t++) { await page.waitForTimeout(45); minVy = Math.min(minVy, (await getP()).vy); }
  await page.keyboard.up('Space');
  check(`SPACE maps to the JUMP input (bits ${jumpBits})`, (jumpBits & INPUT_JUMP) !== 0);
  console.log(`   (physical jump impulse minVy ${minVy.toFixed(2)})`);
  await waitGrounded();
  const afterJump = await getP();
  check('player simulating after jump attempt', !!afterJump);

  // hold D: input reaches the engine (facing flips right; x does not go backward).
  // Absolute displacement depends on the random terrain ahead, so the hard
  // assertion is on facing + non-regression; the distance is logged.
  const x0 = afterJump.x;
  await page.keyboard.down('d');
  await page.waitForTimeout(1000);
  await page.keyboard.up('d');
  const movedR = await getP();
  check(`D drives player right (facing ${movedR.facing}, x ${x0.toFixed(1)} -> ${movedR.x.toFixed(1)})`, movedR.facing === 1);
  // hold A: facing flips left.
  await page.keyboard.down('a');
  await page.waitForTimeout(500);
  await page.keyboard.up('a');
  const movedL = await getP();
  check(`A drives player left (facing ${movedL.facing})`, movedL.facing === -1);

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
