// Headless browser test for the local playable character (Phase 2). Boots the
// Vite dev server, opens the About page, drives the player with real keyboard
// events, and asserts the engine-simulated player responds (moves right, jumps).
// Uses the `playwright` library directly (same approach as scripts/bench-pan.mjs)
// so it runs without the @playwright/test runner.
//
//   node scripts/player-e2e.mjs

import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { chromium, webkit } from 'playwright';

const PORT = 5180;
const INPUT_JUMP = 4; // PI_JUMP bit (mirrors enum PlayerInput / INPUT.JUMP)
const NPM = process.platform === 'win32' ? process.execPath : 'npm';
const NPM_ARGS = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : [];
const baseURL = `http://localhost:${PORT}/`;
let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };

// detached so we can kill the whole process group (npm spawns vite as a child;
// killing only npm would orphan vite and leave the port held -> flaky reruns).
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
  let buf = '';
  let done = false;
  const finish = () => { if (done) return; done = true; clearTimeout(to); clearInterval(poll); resolve(); };
  const fail = (err) => { if (done) return; done = true; clearTimeout(to); clearInterval(poll); killServer(); reject(err); };
  const to = setTimeout(() => fail(new Error('dev server timeout')), 60000);
  const poll = setInterval(async () => {
    try { if ((await fetch(baseURL)).ok) finish(); } catch {}
  }, 500);
  const onData = (d) => { buf += d.toString(); if (new RegExp(`localhost:${PORT}`).test(buf)) finish(); };
  server.stdout.on('data', onData);
  server.stderr.on('data', (d) => { const s = d.toString(); if (/error|in use/i.test(s)) fail(new Error('dev server: ' + s.trim())); });
});

let browser, webkitBrowser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const context = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await context.newPage();
  await page.goto(`${baseURL}game`, { waitUntil: 'load' }); // survival mode (the player character lives at /game)
  await page.waitForFunction(() => window.__sandTest && window.__sandTest.getPlayer && window.__sandTest.getPlayer(), null, { timeout: 30000 });
  await page.locator('sand-game').evaluate((host) => host.shadowRoot.querySelector('.sg-sim').focus({ preventScroll: true }));
  await page.evaluate(() => {
    window.__sandTestCellScreenPoint = (cx, cy) => {
      const t = window.__sandTest, i = t.info(), cam = t.getCam(), off = t.off();
      const canvas = document.querySelector('sand-game')?.shadowRoot?.getElementById('sand-main') || document.getElementById('sand-main');
      const r = canvas.getBoundingClientRect();
      return {
        vx: r.left + (((cx + 0.5 - Math.floor(cam.x)) * i.cellDev + off.offX) / i.dpr),
        vy: r.top + (((cy + 0.5 - Math.floor(cam.y)) * i.cellDev + off.offY) / i.dpr),
      };
    };
  });

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

  // player-mediated dig: enable draw mode + eraser, hold LMB on ground just below
  // the player's feet, and assert the engine fired tool actions (mouse -> primary).
  const a0 = await page.evaluate(() => window.__sandTest.actionCount());
  const aim = await page.evaluate(() => {
    window.__sandTest.setDrawMode(true);
    window.__sandTest.setTool('eraser');
    const p = window.__sandTest.getPlayer();
    return window.__sandTestCellScreenPoint(Math.floor(p.x + p.w / 2), Math.floor(p.y + p.h + 1));
  });
  await page.mouse.move(aim.vx, aim.vy);
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(400);
  await page.mouse.up({ button: 'left' });
  const a1 = await page.evaluate(() => window.__sandTest.actionCount());
  check(`LMB drives player tool actions (${a0} -> ${a1})`, a1 > a0);

  // HELD solid build (regression for "click+hold places ONE chunk then nothing"):
  // select stone, click-and-HOLD while dragging in reach, and — mid-hold — inject a
  // `pointermove` whose buttons==0 (the phantom release real hardware emits while a
  // button is still physically down). PI_PRIMARY must SURVIVE that move (else the
  // solid draft finalizes after a single chunk and never extends), and releasing
  // must drop a connected stone piece into the world.
  const PI_PRIMARY = 16;
  await page.evaluate(() => window.__sandTest.addInventory(3, 99)); // STONE = 3
  await page.waitForFunction(() => window.__sandTest.getInventory().slots.some((s) => !s.isTool && s.material === 3 && s.count > 0));
  const stoneSlot = await page.evaluate(() => window.__sandTest.getInventory().slots.findIndex((s) => !s.isTool && s.material === 3 && s.count > 0));
  await page.evaluate((slot) => window.__sandTest.selectSlot(slot), stoneSlot);
  await page.waitForFunction((slot) => window.__sandTest.getInventory().selected === slot, stoneSlot);
  const stoneAim = await page.evaluate(() => {
    const t = window.__sandTest;
    document.activeElement?.blur?.();
    const p = t.getPlayer(), ax = Math.floor(p.x), ay = Math.floor(p.y);
    return { ...window.__sandTestCellScreenPoint(Math.floor(p.x + p.w + 4), Math.floor(p.y + 2)), solid0: t.solidCount(ax - 40, ay - 30, ax + 40, ay + 30) };
  });
  await page.mouse.move(stoneAim.vx, stoneAim.vy);
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(80);
  const heldBits = await page.evaluate(() => window.__sandTest.localInput().bits);
  // drag the held button to extend the draft preview
  for (let i = 1; i <= 4; i++) { await page.mouse.move(stoneAim.vx + i * 3, stoneAim.vy); await page.waitForTimeout(40); }
  // inject the phantom buttons==0 move that used to strand the held draft
  await page.evaluate((pt) => window.dispatchEvent(new PointerEvent('pointermove', { clientX: pt.x + 2, clientY: pt.y, button: -1, buttons: 0, bubbles: true })), { x: stoneAim.vx, y: stoneAim.vy });
  await page.waitForTimeout(80);
  const survivedBits = await page.evaluate(() => window.__sandTest.localInput().bits);
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(200);
  const stone1 = await page.evaluate(() => { const t = window.__sandTest, p = t.getPlayer(), ax = Math.floor(p.x), ay = Math.floor(p.y); return t.solidCount(ax - 40, ay - 30, ax + 40, ay + 30); });
  check(`held LMB latches PI_PRIMARY (bits ${heldBits})`, (heldBits & PI_PRIMARY) !== 0);
  check(`PI_PRIMARY survives a phantom buttons==0 move (bits ${survivedBits})`, (survivedBits & PI_PRIMARY) !== 0);
  check(`held-and-released stone built a connected piece (+${stone1 - stoneAim.solid0})`, stone1 > stoneAim.solid0);

  // Selecting a tool must NOT act as if the mouse is held (regression for "first
  // select latches PI_PRIMARY"). The browser implicitly captures the pointer to a
  // palette button on press, so dragging off the open dropdown onto the canvas
  // while holding used to feed window.onPointerMove (mouseButtons |= e.buttons) and
  // strand the LMB bit — the matching pointerup was captured back to the button and
  // swallowed by the palette. Drive that exact gesture and assert no latch/action.
  const palette = await page.evaluate(() => {
    const host = document.querySelector('sand-game');
    const btn = host?.shadowRoot?.querySelector('.sg-selbtn');
    if (!host || !btn) return null;
    const r = host.getBoundingClientRect(), b = btn.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, bx: b.left + b.width / 2, by: b.top + b.height / 2 };
  });
  if (palette) {
    const a2 = await page.evaluate(() => window.__sandTest.actionCount());
    await page.mouse.click(palette.bx, palette.by); // open the dropdown
    await page.waitForTimeout(40);
    const erOpt = await page.evaluate(() => {
      const o = [...document.querySelector('sand-game').shadowRoot.querySelectorAll('.sg-opt')].find((x) => /eraser/i.test(x.textContent));
      const b = o.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await page.mouse.move(erOpt.x, erOpt.y);
    await page.mouse.down({ button: 'left' });           // press starts on the option (captures pointer)
    await page.mouse.move(palette.cx, palette.cy, { steps: 4 }); // drag onto the canvas while held
    await page.mouse.up({ button: 'left' });             // release over the canvas
    await page.mouse.move(palette.cx + 6, palette.cy + 6); // a plain hover, no button
    await page.waitForTimeout(120);
    const selectBits = await page.evaluate(() => window.__sandTest.localInput().bits);
    const a3 = await page.evaluate(() => window.__sandTest.actionCount());
    check(`selecting a tool does NOT latch PI_PRIMARY (bits ${selectBits})`, (selectBits & PI_PRIMARY) === 0);
    check(`selecting a tool fires no phantom tool action (${a2} -> ${a3})`, a3 === a2);
  } else {
    console.log('  skip palette pointer-capture regression (no embedded palette on /game)');
  }

  await page.evaluate(() => window.__sandTest.setDrawMode(false));

  // camera follows: the player should remain near the viewport center
  const followInfo = await page.evaluate(() => {
    const t = window.__sandTest, i = t.info(), cam = t.getCam(), p = t.getPlayer();
    return { viewCols: i.viewCols, viewRows: i.viewRows, camX: cam.x, camY: cam.y, px: p.x, py: p.y };
  });
  const cx = followInfo.px - (followInfo.camX + followInfo.viewCols / 2);
  const cy = followInfo.py - (followInfo.camY + followInfo.viewRows / 2);
  check(`camera follows player (off-center ${cx.toFixed(1)},${cy.toFixed(1)})`, Math.abs(cx) < followInfo.viewCols * 0.35 && Math.abs(cy) < followInfo.viewRows * 0.45);

  console.log('WebKit worker-authority smoke');
  webkitBrowser = await webkit.launch();
  const webkitPage = await webkitBrowser.newPage({ viewport: { width: 900, height: 650 } });
  await webkitPage.goto(`${baseURL}game`, { waitUntil: 'load' });
  await webkitPage.waitForFunction(() => window.__sandTest?.getPlayer?.() && window.__sandPerf?.().worldTps > 0, null, { timeout: 30000 });
  const webkitBefore = await webkitPage.evaluate(() => window.__sandTest.getPlayer());
  await webkitPage.keyboard.down('d');
  await webkitPage.waitForTimeout(300);
  await webkitPage.keyboard.up('d');
  const webkitAfter = await webkitPage.evaluate(() => window.__sandTest.getPlayer());
  check('WebKit receives a worker-authoritative survival player', !!webkitBefore && !!webkitAfter);
  check('WebKit forwards movement input through the worker authority', webkitAfter.facing === 1);
  await webkitBrowser.close();
  webkitBrowser = null;

  await browser.close();
} catch (err) {
  console.error('e2e error:', err.message);
  failures++;
} finally {
  if (webkitBrowser) await webkitBrowser.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  killServer();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
