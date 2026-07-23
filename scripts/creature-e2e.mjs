// Browser regression for creature visibility. It verifies that /fps does not
// naturally populate retired fauna, /game still populates the armed roster,
// and debug hitboxes alter rendered pixels around an active enemy.
//
//   node scripts/creature-e2e.mjs
//   node scripts/creature-e2e.mjs --png /tmp/creatures-fps.png

import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { getAvailablePort } from './test-port.mjs';

const PORT = await getAvailablePort();
const NPM = process.platform === 'win32' ? process.execPath : 'npm';
const NPM_ARGS = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : [];
const pngArg = process.argv.indexOf('--png');
const pngPath = pngArg >= 0 ? process.argv[pngArg + 1] : null;
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
  } catch { /* already stopped */ }
};
const waitForServer = () => new Promise((resolve, reject) => {
  let buf = '', done = false;
  const finish = () => { if (done) return; done = true; clearTimeout(timeout); clearInterval(poll); resolve(); };
  const fail = (err) => { if (done) return; done = true; clearTimeout(timeout); clearInterval(poll); killServer(); reject(err); };
  const timeout = setTimeout(() => fail(new Error('dev server timeout')), 60000);
  const poll = setInterval(async () => { try { if ((await fetch(baseURL)).ok) finish(); } catch {} }, 500);
  server.stdout.on('data', (d) => { buf += d.toString(); if (new RegExp(`localhost:${PORT}`).test(buf)) finish(); });
  server.stderr.on('data', (d) => { const s = d.toString(); if (/error|in use/i.test(s)) fail(new Error('dev server: ' + s.trim())); });
});

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  await page.goto(`${baseURL}fps`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sandTest?.getCreatures, null, { timeout: 30000 });
  await page.waitForTimeout(1500);

  console.log('/fps creature presentation');
  const initial = await page.evaluate(() => {
    const host = document.querySelector('sand-game');
    const creatures = window.__sandTest.getCreatures().filter((c) => c.alive);
    const hud = [...host.shadowRoot.querySelectorAll('span')].map((x) => x.textContent);
    return { creatures, debugAttr: host.hasAttribute('debug-hitboxes'), hud };
  });
  const species = new Set(initial.creatures.map((c) => c.species));
  check('retired fauna and survival enemies stay absent from /fps natural spawns',
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].every((id) => !species.has(id)));
  check('/fps enables debug hitboxes', initial.debugAttr);
  check('/fps HUD reports creatures', initial.hud.includes('creatures'));

  // The survival route is the real gameplay entry point. It should enable the
  // five armed enemies without depending on /fps's diagnostics flag, with an
  // armed enemy in the current camera view.
  await page.goto(`${baseURL}game`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sandTest?.getCreatures, null, { timeout: 30000 });
  await page.waitForFunction(() => {
    const species = new Set(window.__sandTest.getCreatures().filter((c) => c.alive).map((c) => c.species));
    return [7, 8, 9, 10, 11].every((id) => species.has(id));
  }, null, { timeout: 12000 });
  const survival = await page.evaluate(() => {
    const T = window.__sandTest, info = T.info();
    const visible = (c) => {
      const r = T.cellRect(c.x, c.y);
      return r.x + c.w * r.size > 0 && r.y + c.h * r.size > 0 && r.x < info.canvasW && r.y < info.canvasH;
    };
    const host = document.querySelector('sand-game');
    const population = T.getCreatures().filter((c) => c.alive);
    return {
      species: population.map((c) => c.species),
      enemyVisible: population.some((c) => c.species >= 7 && visible(c)),
      debugAttr: host.hasAttribute('debug-hitboxes'),
    };
  });
  console.log('\n/game creature spawning');
  check('survival spawns all five armed enemies',
    [7, 8, 9, 10, 11].every((id) => survival.species.includes(id)));
  check('survival keeps moles and other retired natural populations absent',
    [0, 1, 2, 3, 4, 5, 6].every((id) => !survival.species.includes(id)));
  check('a survival enemy is in the camera view', survival.enemyVisible);
  // Exact spawn coordinates are covered synchronously by creature-test.mjs.
  // Live browser actors can move before their mirrored snapshot is inspected.
  check('hitboxes remain an /fps diagnostic', !survival.debugAttr);

  // Freeze world/actor updates so the only pixel difference is the hitbox
  // overlay, then probe the naturally spawned minigunner.
  const hitboxResult = await page.evaluate(() => {
    const T = window.__sandTest;
    T.setPaused(true);
    const c = T.getCreatures().find((x) => x.alive && x.species === 11);
    const info = T.info();
    T.setCam(c.x + c.w / 2 - info.viewCols / 2, c.y + c.h / 2 - info.viewRows / 2);
    T.setHitboxes(true); T.render();
    const r = T.cellRect(c.x, c.y);
    const x = Math.max(0, Math.floor(r.x - 2));
    const y = Math.max(0, Math.floor(r.y - 2));
    const w = Math.min(info.canvasW - x, Math.ceil(c.w * r.size + 4));
    const h = Math.min(info.canvasH - y, Math.ceil(c.h * r.size + 4));
    const on = T.readPixels(x, y, w, h);
    T.setHitboxes(false); T.render();
    const off = T.readPixels(x, y, w, h);
    let changed = 0;
    for (let i = 0; i < on.length; i += 4) {
      if (on[i] !== off[i] || on[i + 1] !== off[i + 1] || on[i + 2] !== off[i + 2]) changed++;
    }
    return { changed };
  });
  check(`minigunner sprite + hitbox rendered (${hitboxResult.changed} changed pixels)`,
    hitboxResult.changed > 0);

  if (pngPath) {
    await page.screenshot({ path: pngPath });
    console.log(`  screenshot ${pngPath}`);
  }

  const playerLight = await page.evaluate(() => {
    const T = window.__sandTest, info = T.info();
    T.setPaused(true);
    const p = T.getPlayer();
    T.setCam(p.x + p.w / 2 - info.viewCols / 2, p.y + p.h / 2 - info.viewRows / 2);
    T.setSkyLight(255);
    const sky = T.actorLight(p.x, p.y, p.w, p.h);
    T.setSkyLight(0);
    const dark = T.actorLight(p.x, p.y, p.w, p.h);
    T.setSkyLight(255);
    T.setPaused(false);
    return { sky, dark };
  });
  check(`player responds to world light (sky ${playerLight.sky.toFixed(2)} -> dark ${playerLight.dark.toFixed(2)})`,
    playerLight.sky > 0 && playerLight.dark < playerLight.sky * 0.75);
} catch (err) {
  console.error('creature e2e error:', err.stack || err.message);
  failures++;
} finally {
  if (browser) await browser.close().catch(() => {});
  killServer();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
