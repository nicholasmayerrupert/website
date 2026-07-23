// Browser regression for creature visibility on /fps. It verifies that the
// creative performance route enables the remaining ambient cave population,
// that it spawns and moves, that retired fauna stay absent, and that debug
// hitboxes alter the rendered pixels around the active species.
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
  await page.waitForFunction(() => {
    const species = new Set(window.__sandTest.getCreatures().filter((c) => c.alive).map((c) => c.species));
    return species.has(5);
  }, null, { timeout: 12000 });

  console.log('/fps creature presentation');
  const initial = await page.evaluate(() => {
    const host = document.querySelector('sand-game');
    const creatures = window.__sandTest.getCreatures().filter((c) => c.alive);
    const hud = [...host.shadowRoot.querySelectorAll('span')].map((x) => x.textContent);
    return { creatures, debugAttr: host.hasAttribute('debug-hitboxes'), hud };
  });
  const species = new Set(initial.creatures.map((c) => c.species));
  check('mole spawned', species.has(5));
  check('retired fauna and survival enemies stay absent from /fps natural spawns',
    [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11].every((id) => !species.has(id)));
  check('/fps enables debug hitboxes', initial.debugAttr);
  check('/fps HUD reports creatures', initial.hud.includes('creatures'));

  // Freeze world/actor updates so the only pixel difference is the hitbox
  // overlay. Recenter on the mole before probing its AABB.
  await page.evaluate(() => window.__sandTest.setPaused(true));
  for (const [id, name] of [[5, 'mole']]) {
    const result = await page.evaluate((speciesId) => {
      const T = window.__sandTest;
      const c = T.getCreatures().find((x) => x.alive && x.species === speciesId);
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
      return { changed, width: w, height: h };
    }, id);
    check(`${name} sprite + hitbox rendered (${result.changed} changed pixels)`, result.changed > 0);
  }

  // Resume and observe actor state rather than relying on a timed screenshot.
  const mole0 = await page.evaluate(() => {
    window.__sandTest.setHitboxes(true);
    window.__sandTest.setPaused(false);
    const c = window.__sandTest.getCreatures().find((x) => x.alive && x.species === 5);
    const off = window.__sandTest.worldOffset();
    return { ...c, worldX: c.x + off.x, worldY: c.y + off.y };
  });
  await page.waitForFunction(({ id, worldX, worldY }) => {
    const c = window.__sandTest.getCreatures().find((x) => x.id === id);
    if (!c) return false;
    const off = window.__sandTest.worldOffset();
    return Math.hypot(c.x + off.x - worldX, c.y + off.y - worldY) > 0.1;
  }, { id: mole0.id, worldX: mole0.worldX, worldY: mole0.worldY }, { timeout: 8000 });
  const mole1 = await page.evaluate((id) => {
    const c = window.__sandTest.getCreatures().find((x) => x.id === id);
    const off = window.__sandTest.worldOffset();
    return { ...c, worldX: c.x + off.x, worldY: c.y + off.y };
  }, mole0.id);
  const moved = Math.hypot(mole1.worldX - mole0.worldX, mole1.worldY - mole0.worldY);
  check(`mole moves through its cave (${moved.toFixed(2)} cells)`, moved > 0.1);

  if (pngPath) {
    const mole = await page.evaluate(() => window.__sandTest.getCreatures().find((c) => c.alive && c.species === 5));
    await page.evaluate((c) => {
      const T = window.__sandTest, i = T.info();
      T.setCam(c.x + c.w / 2 - i.viewCols / 2, c.y + c.h / 2 - i.viewRows / 2);
      T.setHitboxes(true); T.render();
    }, mole);
    await page.screenshot({ path: pngPath });
    console.log(`  screenshot ${pngPath}`);
  }

  // The survival route is the real gameplay entry point. It should enable the
  // remaining ambient population plus all five armed enemies without depending
  // on /fps's diagnostics flag, with an armed enemy in the current camera view.
  await page.goto(`${baseURL}game`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sandTest?.getCreatures, null, { timeout: 30000 });
  await page.waitForFunction(() => {
    const species = new Set(window.__sandTest.getCreatures().filter((c) => c.alive).map((c) => c.species));
    return [5, 7, 8, 9, 10, 11].every((id) => species.has(id));
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
  check('survival spawns the mole and all five armed enemies',
    [5, 7, 8, 9, 10, 11].every((id) => survival.species.includes(id)));
  check('survival keeps retired natural populations absent',
    [0, 1, 2, 3, 4, 6].every((id) => !survival.species.includes(id)));
  check('a survival enemy is in the camera view', survival.enemyVisible);
  // Exact spawn coordinates are covered synchronously by creature-test.mjs.
  // Live browser actors can move before their mirrored snapshot is inspected.
  check('hitboxes remain an /fps diagnostic', !survival.debugAttr);
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
