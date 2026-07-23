// Browser regression for creature visibility on /fps. It verifies that the
// creative performance route enables the active land/cave/air populations,
// that they spawn, animate, and move, and that debug hitboxes alter the
// rendered pixels around every active ambient species.
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
    return [2, 5, 6].every((id) => species.has(id));
  }, null, { timeout: 12000 });

  console.log('/fps creature presentation');
  const initial = await page.evaluate(() => {
    const host = document.querySelector('sand-game');
    const creatures = window.__sandTest.getCreatures().filter((c) => c.alive);
    const hud = [...host.shadowRoot.querySelectorAll('span')].map((x) => x.textContent);
    return { creatures, debugAttr: host.hasAttribute('debug-hitboxes'), hud };
  });
  const species = new Set(initial.creatures.map((c) => c.species));
  check('fox and mole spawned', species.has(2) && species.has(5));
  check(`bird spawned (${initial.creatures.filter((c) => c.species === 6).length})`, species.has(6));
  check('disabled fauna and survival enemies stay absent from /fps natural spawns',
    [1, 3, 4, 7, 8, 9, 10, 11].every((id) => !species.has(id)));
  check('/fps enables debug hitboxes', initial.debugAttr);
  check('/fps HUD reports creatures', initial.hud.includes('creatures'));

  // Freeze world/actor updates so the only pixel difference is the hitbox
  // overlay. Recenter on each habitat species before probing its AABB.
  await page.evaluate(() => window.__sandTest.setPaused(true));
  for (const [id, name] of [[2, 'fox'], [5, 'mole'], [6, 'bird']]) {
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

  // Actor sprites must sample the terrain light buffer, not render as an
  // always-fullbright overlay. A bird is isolated against empty sky, so this
  // probe measures the sprite itself without terrain pixels contaminating it.
  const actorLight = await page.evaluate(() => {
    const T = window.__sandTest;
    const c = T.getCreatures().find((x) => x.alive && x.species === 6);
    const info = T.info();
    T.setCam(c.x + c.w / 2 - info.viewCols / 2, c.y + c.h / 2 - info.viewRows / 2);
    T.setHitboxes(false);
    const r = T.cellRect(c.x - 2, c.y - 1);
    const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
    const w = Math.min(info.canvasW - x, Math.ceil(9 * r.size));
    const h = Math.min(info.canvasH - y, Math.ceil(5 * r.size));
    const brightness = (pixels) => {
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
      return sum;
    };
    T.setSkyLight(255);
    const dayFactor = T.actorLight(c.x, c.y, c.w, c.h);
    const day = brightness(T.readPixels(x, y, w, h));
    T.setSkyLight(0);
    const nightFactor = T.actorLight(c.x, c.y, c.w, c.h);
    const night = brightness(T.readPixels(x, y, w, h));
    T.setSkyLight(255);
    return { day, night, dayFactor, nightFactor };
  });
  check(`actors respond to world light (${actorLight.dayFactor.toFixed(2)} day -> ${actorLight.nightFactor.toFixed(2)} dark)`,
    actorLight.day > actorLight.night && actorLight.dayFactor > 0 && actorLight.nightFactor < actorLight.dayFactor * 0.75);

  // Resume and observe actor state rather than relying on a timed screenshot:
  // the bird must advance animation frames and actually change position.
  const bird0 = await page.evaluate(() => {
    window.__sandTest.setHitboxes(true);
    window.__sandTest.setPaused(false);
    const c = window.__sandTest.getCreatures().find((x) => x.alive && x.species === 6);
    const off = window.__sandTest.worldOffset();
    return { ...c, worldX: c.x + off.x, worldY: c.y + off.y };
  });
  await page.waitForFunction(({ id, frame }) => {
    const c = window.__sandTest.getCreatures().find((x) => x.id === id);
    return c && c.animFrame !== frame;
  }, { id: bird0.id, frame: bird0.animFrame }, { timeout: 8000 });
  await page.waitForFunction(({ id, worldX, worldY }) => {
    const c = window.__sandTest.getCreatures().find((x) => x.id === id);
    if (!c) return false;
    const off = window.__sandTest.worldOffset();
    return Math.hypot(c.x + off.x - worldX, c.y + off.y - worldY) > 0.1;
  }, { id: bird0.id, worldX: bird0.worldX, worldY: bird0.worldY }, { timeout: 8000 });
  const bird1 = await page.evaluate((id) => {
    const c = window.__sandTest.getCreatures().find((x) => x.id === id);
    const off = window.__sandTest.worldOffset();
    return { ...c, worldX: c.x + off.x, worldY: c.y + off.y };
  }, bird0.id);
  const moved = Math.hypot(bird1.worldX - bird0.worldX, bird1.worldY - bird0.worldY);
  check('bird animation advances through a four-pose cycle', bird1.animFrame >= 0 && bird1.animFrame < 4);
  check(`bird flies (${moved.toFixed(2)} cells)`, moved > 0.1);

  if (pngPath) {
    const fox = await page.evaluate(() => window.__sandTest.getCreatures().find((c) => c.alive && c.species === 2));
    await page.evaluate((c) => {
      const T = window.__sandTest, i = T.info();
      T.setCam(c.x + c.w / 2 - i.viewCols / 2, c.y + c.h / 2 - i.viewRows / 2);
      T.setHitboxes(true); T.render();
    }, fox);
    await page.screenshot({ path: pngPath });
    console.log(`  screenshot ${pngPath}`);
  }

  // The survival route is the real gameplay entry point. It should enable the
  // ambient populations plus all five armed enemies without depending on
  // /fps's diagnostics flag, and an air creature should intersect the current
  // camera view.
  await page.goto(`${baseURL}game`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sandTest?.getCreatures, null, { timeout: 30000 });
  await page.waitForFunction(() => {
    const species = new Set(window.__sandTest.getCreatures().filter((c) => c.alive).map((c) => c.species));
    return [2, 5, 6, 7, 8, 9, 10, 11].every((id) => species.has(id));
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
      birdVisible: population.some((c) => c.species === 6 && visible(c)),
      debugAttr: host.hasAttribute('debug-hitboxes'),
    };
  });
  console.log('\n/game creature spawning');
  check('survival spawns enabled ambient populations and all five armed enemies',
    [2, 5, 6, 7, 8, 9, 10, 11].every((id) => survival.species.includes(id)));
  check('survival keeps disabled natural populations absent',
    [1, 3, 4].every((id) => !survival.species.includes(id)));
  check('survival bird is in the camera view', survival.birdVisible);
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
