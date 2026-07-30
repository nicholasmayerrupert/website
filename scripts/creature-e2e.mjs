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
const waitForWorkerPause = async (page) => {
  let lastTick = -1, stableSamples = 0;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    const tick = await page.evaluate(() => window.__sandPerf().worldTick);
    stableSamples = tick === lastTick ? stableSamples + 1 : 0;
    if (stableSamples >= 2) return;
    lastTick = tick;
  }
  throw new Error('world worker did not pause');
};

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

  // The survival route is the real gameplay entry point. Its encounter director
  // should begin with one armed reservation rather than all five species popping
  // into view at once.
  await page.goto(`${baseURL}game?sandbox`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sandTest?.getCreatures, null, { timeout: 30000 });
  await page.waitForFunction(() => {
    return window.__sandTest.getCreatures().some((c) =>
      c.species >= 7 && (c.alive || c.spawnProgress > 0));
  }, null, { timeout: 12000 });
  const survival = await page.evaluate(() => {
    const T = window.__sandTest;
    const host = document.querySelector('sand-game');
    const population = T.getCreatures().filter((c) => c.alive || c.spawnProgress > 0);
    return {
      species: population.map((c) => c.species),
      armed: population.filter((c) => c.species >= 7).length,
      debugAttr: host.hasAttribute('debug-hitboxes'),
    };
  });
  console.log('\n/game creature spawning');
  check(`survival begins with a paced armed encounter (${survival.armed} reserved)`,
    survival.armed >= 1 && survival.armed < 5);
  check('survival keeps moles and other retired natural populations absent',
    [0, 1, 2, 3, 4, 5, 6].every((id) => !survival.species.includes(id)));
  check('hitboxes remain an /fps diagnostic', !survival.debugAttr);

  // Force the director's habitat-valid visible fallback through its DEV-only
  // test hook, then inspect the replicated warning and its portal pixels.
  // Freeze the authority first so the short warning cannot materialize between
  // the async worker snapshot and the render probe.
  await page.evaluate(() => {
    window.__sandTest.setCreatureRuntime(true, false);
    window.__sandTest.setPaused(true);
  });
  await waitForWorkerPause(page);
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
      breachChoices[i], { timeout: 250 }).catch(() => null);
      portal = await page.evaluate((species) => window.__sandTest.getCreatures()
        .find((c) => c.species === species && c.spawnProgress > 0) || null,
      breachChoices[i]);
    }
  }
  if (portal) {
    // Advance into the readable middle of the portal animation, then freeze
    // again before sampling pixels. Its minimum 54-tick warning cannot finish
    // during this short window.
    await page.evaluate(() => window.__sandTest.setPaused(false));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__sandTest.setPaused(true));
    await waitForWorkerPause(page);
  }
  const portalPixels = await page.evaluate((portalId) => {
    const T = window.__sandTest, info = T.info();
    const c = T.getCreatures().find((x) => x.id === portalId && x.spawnProgress > 0);
    if (!c) {
      T.setPaused(false);
      return { visible: false, colored: 0, id: 0 };
    }
    T.setPaused(true); T.render();
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
    T.setPaused(false);
    return {
      visible: r.x + c.w * r.size > 0 && r.y + c.h * r.size > 0 &&
        r.x < info.canvasW && r.y < info.canvasH,
      colored, id: c.id,
    };
  }, portal?.id || 0);
  check('visible fallback is replicated as a non-materialized portal',
    !!portal && !portal.alive && portal.spawnProgress > 0 && portalPixels.visible);
  check(`breach portal renders its cyan/violet pixel animation (${portalPixels.colored} pixels)`,
    portalPixels.colored > 0);

  let portalMaterialized = false;
  if (portalPixels.id) {
    await page.waitForFunction((id) => window.__sandTest.getCreatures()
      .some((c) => c.id === id && c.alive && c.spawnProgress === 0),
    portalPixels.id, { timeout: 2500 }).catch(() => null);
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
      T.getCreatures().find((x) => x.alive && x.species >= 7);
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
