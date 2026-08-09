// Browser regression for creature visibility. It verifies that /fps remains
// unpopulated, /game paces its ambient and armed populations, and debug
// hitboxes alter rendered pixels around an active enemy.
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
const WORLD_SEED = 0xD1EC70;
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
  // Keep viewport-dependent population and pixel probes on one terrain fixture;
  // the headless creature suites cover spawning across varied world seeds.
  await page.addInitScript((seed) => { Math.random = () => seed / 0x100000000; }, WORLD_SEED);
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
  check('natural fauna and survival enemies stay absent from /fps',
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].every((id) => !species.has(id)));
  check('/fps enables debug hitboxes', initial.debugAttr);
  check('/fps HUD reports creatures', initial.hud.includes('creatures'));

  const humanSprite = await page.evaluate(() => {
    const T = window.__sandTest, info = T.info(), cam = T.getCam();
    T.setPaused(true);
    T.setHitboxes(false);
    T.render();
    const before = T.readPixels(0, 0, info.canvasW, info.canvasH);
    const id = T.spawnCreature(
      19,
      cam.x + info.viewCols * 0.5 - 2,
      cam.y + info.viewRows * 0.5 - 4,
    );
    T.render();
    const after = T.readPixels(0, 0, info.canvasW, info.canvasH);
    let changed = 0, minX = info.canvasW, minY = info.canvasH;
    let maxX = -1, maxY = -1;
    for (let i = 0; i < before.length; i += 4) {
      if (before[i] === after[i]
          && before[i + 1] === after[i + 1]
          && before[i + 2] === after[i + 2]
          && before[i + 3] === after[i + 3]) continue;
      const pixel = i / 4;
      const x = pixel % info.canvasW;
      const y = Math.floor(pixel / info.canvasW);
      changed++;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    T.setPaused(false);
    return {
      id,
      changed,
      width: maxX >= minX ? maxX - minX + 1 : 0,
      height: maxY >= minY ? maxY - minY + 1 : 0,
    };
  });
  check(`human NPC sprite is visibly tall and narrow (${humanSprite.width}x${humanSprite.height})`,
    humanSprite.id > 0 && humanSprite.changed > 0
      && humanSprite.height > humanSprite.width * 1.2);

  // The survival route is the real gameplay entry point. Its encounter director
  // should begin with one armed reservation rather than all five species popping
  // into view at once.
  await page.goto(`${baseURL}game?sandbox`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sandTest?.getCreatures, null, { timeout: 30000 });
  // The presentation engine installs the test hook before its independently
  // initialized authority worker receives a viewport and starts actor time.
  await page.waitForFunction(() => window.__sandPerf().actorTick > 0,
    null, { timeout: 60000 });
  const survivalHandle = await page.waitForFunction(() => {
    const T = window.__sandTest;
    const host = document.querySelector('sand-game');
    const population = T.getCreatures().filter((c) => c.alive || c.spawnProgress > 0);
    const armed = population.filter((c) => c.species >= 7 && c.species <= 11);
    if (!armed.length) return false;
    return {
      species: population.map((c) => c.species),
      armed: armed.length,
      ambient: population.filter((c) => c.species <= 6).length,
      debugAttr: host.hasAttribute('debug-hitboxes'),
    };
  }, null, { timeout: 30000 });
  // Keep every population assertion on the same qualifying worker snapshot.
  const survival = await survivalHandle.jsonValue();
  await survivalHandle.dispose();
  console.log('\n/game creature spawning');
  check(`survival begins with a paced armed encounter (${survival.armed} reserved)`,
    survival.armed >= 1 && survival.armed < 5);
  check(`survival keeps ambient wildlife within its reserved cap (${survival.ambient}/3)`,
    survival.ambient <= 3);
  check('hitboxes remain an /fps diagnostic', !survival.debugAttr);

  // Force the director's habitat-valid visible fallback through its DEV-only
  // test hook, then inspect the replicated warning and its portal pixels.
  // Freeze the authority first so the short warning cannot materialize between
  // the async worker snapshot and the render probe.
  await page.evaluate(() => {
    window.__sandTest.setCreatureRuntime(true, false);
    window.__sandTest.setPaused(true);
    // This zero-step authority command is ordered before every spawn request and
    // atomically takes ownership of the worker actor clock.
    window.__sandTest.stepAuthorityActors(0);
  });
  const existingSpecies = new Set(survival.species);
  const breachChoices = [7, 9, 10, 8, 11].filter((id) => !existingSpecies.has(id));
  let portal = null;
  for (let i = 0; i < breachChoices.length && !portal; i++) {
    for (let attempt = 0; attempt < 6 && !portal; attempt++) {
      await page.evaluate(({ species, salt }) => {
        window.__sandTest.spawnNatural(species, salt, true);
      }, { species: breachChoices[i], salt: 700 + i * 997 + attempt * 131 });
      await page.waitForFunction((species) => window.__sandTest.getCreatures()
        .some((c) => c.species === species && c.spawnProgress > 0),
      breachChoices[i], { timeout: 2000 }).catch(() => null);
      portal = await page.evaluate((species) => window.__sandTest.getCreatures()
        .find((c) => c.species === species && c.spawnProgress > 0) || null,
      breachChoices[i]);
    }
  }
  if (portal) {
    // Advance by an exact count into the readable middle of the portal. Every
    // warning lasts at least 54 actor turns, so 24 cannot materialize it.
    const initialProgress = portal.spawnProgress;
    await page.evaluate(() => window.__sandTest.stepAuthorityActors(24));
    const progressedHandle = await page.waitForFunction(({ id, progress }) => {
      const c = window.__sandTest.getCreatures()
        .find((candidate) => candidate.id === id && candidate.spawnProgress > progress);
      return c && !c.alive ? c : false;
    }, { id: portal.id, progress: initialProgress }, { timeout: 5000 });
    portal = await progressedHandle.jsonValue();
    await progressedHandle.dispose();
  }
  const portalPixels = await page.evaluate((portalId) => {
    const T = window.__sandTest, info = T.info();
    const c = T.getCreatures().find((x) => x.id === portalId && x.spawnProgress > 0);
    if (!c) {
      return { visible: false, colored: 0, id: 0, progress: 0 };
    }
    T.render();
    const r = T.cellRect(c.x, c.y);
    const pad = Math.ceil(r.size * 7);
    const x = Math.max(0, Math.floor(r.x - pad));
    const y = Math.max(0, Math.floor(r.y - pad));
    const w = Math.max(0, Math.min(info.canvasW - x, Math.ceil(c.w * r.size + pad * 2)));
    const h = Math.max(0, Math.min(info.canvasH - y, Math.ceil(c.h * r.size + pad * 2)));
    const pixels = w && h ? T.readPixels(x, y, w, h) : [];
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const red = pixels[i], green = pixels[i + 1], blue = pixels[i + 2];
      if ((blue > 175 && blue > red * 1.25 && green > 65) ||
          (blue > 220 && green > 190 && red < 225)) colored++;
    }
    return {
      visible: r.x + c.w * r.size > 0 && r.y + c.h * r.size > 0 &&
        r.x < info.canvasW && r.y < info.canvasH,
      colored, id: c.id, progress: c.spawnProgress,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.size)],
    };
  }, portal?.id || 0);
  check(`visible fallback is replicated as a non-materialized portal (progress ${portalPixels.progress.toFixed(2)}, rect ${portalPixels.rect?.join(',') || 'none'})`,
    !!portal && !portal.alive && portal.spawnProgress > 0 && portalPixels.visible);
  check(`breach portal renders its cyan/violet pixel animation (${portalPixels.colored} pixels)`,
    portalPixels.colored > 0);

  let portalMaterialized = false;
  if (portalPixels.id) {
    await page.evaluate(() => window.__sandTest.stepAuthorityActors(90));
    await page.waitForFunction((id) => window.__sandTest.getCreatures()
      .some((c) => c.id === id && c.alive && c.spawnProgress === 0),
    portalPixels.id, { timeout: 5000 }).catch(() => null);
    portalMaterialized = await page.evaluate((id) => window.__sandTest.getCreatures()
      .some((c) => c.id === id && c.alive && c.spawnProgress === 0),
    portalPixels.id);
  }
  check('breach materializes the same reserved enemy id', portalMaterialized);

  // Freeze world/actor updates so the only pixel difference is the hitbox
  // overlay, then probe the newly materialized enemy.
  const hitboxResult = await page.evaluate((materializedId) => {
    const T = window.__sandTest;
    T.setPaused(true);
    const c = T.getCreatures().find((x) => x.id === materializedId && x.alive) ||
      T.getCreatures().find((x) =>
        x.alive && x.species >= 7 && x.species <= 11);
    if (!c) { T.setPaused(false); return { changed: 0 }; }
    const info = T.info();
    T.setCam(c.x + c.w / 2 - info.viewCols / 2, c.y + c.h / 2 - info.viewRows / 2);
    T.setHitboxes(true); T.render();
    const r = T.cellRect(c.x, c.y);
    const x = Math.min(info.canvasW, Math.max(0, Math.floor(r.x - 2)));
    const y = Math.min(info.canvasH, Math.max(0, Math.floor(r.y - 2)));
    const w = Math.max(0, Math.min(info.canvasW - x, Math.ceil(c.w * r.size + 4)));
    const h = Math.max(0, Math.min(info.canvasH - y, Math.ceil(c.h * r.size + 4)));
    const on = T.readPixels(x, y, w, h);
    T.setHitboxes(false); T.render();
    const off = T.readPixels(x, y, w, h);
    let changed = 0;
    for (let i = 0; i < on.length; i += 4) {
      if (on[i] !== off[i] || on[i + 1] !== off[i + 1] || on[i + 2] !== off[i + 2]) changed++;
    }
    return { changed };
  }, portalPixels.id);
  check(`materialized enemy sprite + hitbox rendered (${hitboxResult.changed} changed pixels)`,
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
