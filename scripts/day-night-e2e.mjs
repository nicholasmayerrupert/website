import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { NOON_SKY_LIGHT } from '../src/sand/game/dayNightCycle.js';
import { makeChecker } from './sand-test-util.mjs';

const PORT = 5188;
const URL = `http://localhost:${PORT}/`;
const NPM = process.platform === 'win32' ? process.execPath : 'npm';
const NPM_ARGS = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : [];
const server = spawn(NPM, [...NPM_ARGS, 'run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
});

const waitForServer = () => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('dev server timeout')), 60000);
  const poll = setInterval(async () => {
    try {
      if ((await fetch(URL)).ok) { clearTimeout(timeout); clearInterval(poll); resolve(); }
    } catch { /* still booting */ }
  }, 250);
});

const shutdownServer = () => {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
  else server.kill('SIGTERM');
  server.stdout.destroy();
  server.stderr.destroy();
};

const { check, done } = makeChecker('day/night browser rendering');
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__sandTest?.info().cols > 0 && window.__sandTest.materialCount(3) > 0, null, { timeout: 60000 });
  await page.evaluate(() => window.__sandTest.setPaused(true));

  const sample = async (phase) => page.evaluate((forcedPhase) => {
    const T = window.__sandTest;
    T.setDayPhase(forcedPhase);
    const root = document.querySelector('sand-game')?.shadowRoot;
    const bg = root?.querySelector('.sand-parallax-bg');
    const pixels = bg.getContext('2d').getImageData(0, 0, bg.width, bg.height).data;
    const luma = (x0, y0, x1, y1) => {
      let total = 0, count = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * bg.width + x) * 4;
        total += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
        count++;
      }
      return total / count;
    };
    const exactColorCount = (r, g, b) => {
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === r && pixels[i + 1] === g && pixels[i + 2] === b) count++;
      return count;
    };
    const W = bg.width, H = bg.height;
    return {
      state: T.getDayNight(),
      skyLuma: luma(0, 0, W, Math.max(1, Math.floor(H * 0.30))),
      ridgeLuma: luma(0, Math.floor(H * 0.38), W, Math.max(1, Math.floor(H * 0.58))),
      stars: exactColorCount(214, 237, 242) + exactColorCount(249, 243, 198),
      sun: exactColorCount(255, 227, 154),
      moon: exactColorCount(244, 251, 255),
    };
  }, phase);

  const midnight = await sample(0);
  const sunrise = await sample(0.25);
  const noon = await sample(0.5);
  const sunset = await sample(0.75);

  check(`night stars render and disappear by noon (${midnight.stars} -> ${noon.stars})`, midnight.stars > 8 && noon.stars === 0);
  check(`moon and sun render in their respective skies (${midnight.moon}, ${noon.sun})`, midnight.moon > 10 && noon.sun > 10);
  check(`noon sky is brighter than midnight (${midnight.skyLuma.toFixed(1)} -> ${noon.skyLuma.toFixed(1)})`, noon.skyLuma > midnight.skyLuma + 45);
  check(`mountains lighten during the day (${midnight.ridgeLuma.toFixed(1)} -> ${noon.ridgeLuma.toFixed(1)})`, noon.ridgeLuma > midnight.ridgeLuma + 25);
  check('sunrise and sunset retain partial stars while both horizon bodies meet',
    sunrise.state.starOpacity > 0 && sunrise.state.starOpacity < 1 && sunset.state.starOpacity > 0 && sunset.state.starOpacity < 1 &&
    sunrise.state.sunVisible && sunrise.state.moonVisible && sunset.state.sunVisible && sunset.state.moonVisible);

  await page.evaluate(() => window.__sandTest.clearDayPhase());
  const desktopTime = page.locator('sand-game').locator('.sg-time');
  const desktopRange = desktopTime.locator('.sg-time-range');
  const desktopAutoButton = desktopTime.locator('.sg-time-auto');
  check('creative desktop palette exposes the automatic time slider',
    await desktopTime.getAttribute('data-mode') === 'auto' && await desktopRange.isVisible());
  await desktopRange.evaluate((el) => {
    el.value = '0.5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const state = window.__sandTest.getDayNight();
    return state.overridden && Math.abs(state.phase - 0.5) < 1e-6;
  });
  check('desktop slider selects a continuous manual phase',
    await desktopTime.getAttribute('data-mode') === 'manual' && await desktopTime.locator('.sg-time-value').textContent() === '12:00 PM');

  // Reproduce the old failure: several drag samples are queued, then Auto is
  // selected before the throttle fires. No delayed noon sample may pin the
  // renderer after the live dawn phase has been restored.
  await desktopRange.evaluate((el) => {
    for (const value of ['0.2', '0.8', '0.5']) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await desktopAutoButton.click();
  await page.waitForTimeout(180);
  const desktopAuto = await page.evaluate(() => window.__sandTest.getDayNight());
  check('Auto cancels queued slider work and cannot leave noon light stuck',
    !desktopAuto.overridden && desktopAuto.skyLight < NOON_SKY_LIGHT &&
    await desktopTime.getAttribute('data-mode') === 'auto');

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(URL, { waitUntil: 'domcontentloaded' });
  await mobilePage.waitForFunction(() => window.__sandTest?.info().cols > 0, null, { timeout: 60000 });
  const mobileTime = mobilePage.locator('sand-game').locator('.sg-time');
  const mobileRange = mobileTime.locator('.sg-time-range');
  check('creative mobile palette exposes the same fitted time slider',
    await mobileTime.isVisible() && await mobileTime.getAttribute('data-mode') === 'auto');
  await mobileRange.evaluate((el) => {
    el.value = '0.75';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await mobilePage.waitForFunction(() => {
    const state = window.__sandTest.getDayNight();
    return state.overridden && Math.abs(state.phase - 0.75) < 1e-6;
  });
  check('mobile slider selects dusk', await mobileTime.locator('.sg-time-value').textContent() === '6:00 PM');
  const alignment = await mobilePage.locator('sand-game').evaluate((host) => {
    const root = host.shadowRoot;
    const center = (selector) => {
      const rect = root.querySelector(selector).getBoundingClientRect();
      return rect.top + rect.height / 2;
    };
    const palette = center('.sg-palette');
    return { zoom: center('.sg-zoom') - palette, stick: center('.sg-stick') - palette };
  });
  check(`mobile side controls align with the taller center palette (${alignment.zoom.toFixed(1)}px/${alignment.stick.toFixed(1)}px)`,
    Math.abs(alignment.zoom) <= 20 && Math.abs(alignment.stick) <= 20);
  await mobileContext.close();
} finally {
  await browser?.close().catch(() => {});
  shutdownServer();
}

const failures = done();
process.exit(failures === 0 ? 0 : 1);
