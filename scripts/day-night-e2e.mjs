import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { NOON_SKY_LIGHT, SUNRISE_PHASE, SUNSET_PHASE } from '../src/sand/game/dayNightCycle.js';
import { SURFACE_CAM_Y } from '../src/sand/game/parallaxBackground.js';
import { makeChecker } from './sand-test-util.mjs';
import { getAvailablePort } from './test-port.mjs';

const PORT = await getAvailablePort();
const URL = `http://127.0.0.1:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
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
  else {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already stopped */ }
  }
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
  // Celestial bodies intentionally leave the viewport underground. Sample the
  // settled authority frame from the backdrop's canonical surface camera.
  await page.waitForFunction(() => {
    const test = window.__sandTest;
    return test?.info().cols > 0 && test.materialCount(3) > 0 &&
      window.__sandPerf?.().mirrorPacketType === 'full';
  }, null, { timeout: 60000 });
  await page.evaluate((surfaceCamY) => {
    const test = window.__sandTest;
    test.setPaused(true);
    const camera = test.getCam();
    const offset = test.worldOffset();
    test.setCam(camera.x, surfaceCamY - offset.y);
  }, SURFACE_CAM_Y);

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
      stars: exactColorCount(225, 241, 243) + exactColorCount(249, 231, 183) + exactColorCount(185, 220, 255),
      sun: exactColorCount(255, 227, 154),
      moon: exactColorCount(244, 251, 255),
    };
  }, phase);

  const midnight = await sample(0);
  const sunrise = await sample(SUNRISE_PHASE);
  const noon = await sample(0.5);
  const sunset = await sample(SUNSET_PHASE);

  check(`night stars render and disappear by noon (${midnight.stars} -> ${noon.stars})`, midnight.stars > 8 && noon.stars === 0);
  check(`moon and sun render in their respective skies (${midnight.moon}, ${noon.sun})`, midnight.moon > 10 && noon.sun > 10);
  check(`noon sky is brighter than midnight (${midnight.skyLuma.toFixed(1)} -> ${noon.skyLuma.toFixed(1)})`, noon.skyLuma > midnight.skyLuma + 45);
  check(`mountains lighten during the day (${midnight.ridgeLuma.toFixed(1)} -> ${noon.ridgeLuma.toFixed(1)})`, noon.ridgeLuma > midnight.ridgeLuma + 25);
  check('sunrise and sunset retain partial stars while both horizon bodies meet',
    sunrise.state.starOpacity > 0 && sunrise.state.starOpacity < 1 && sunset.state.starOpacity > 0 && sunset.state.starOpacity < 1 &&
    sunrise.state.sunVisible && sunrise.state.moonVisible && sunset.state.sunVisible && sunset.state.moonVisible);

  await page.evaluate(() => window.__sandTest.setDayPhase(0.5));
  const backgroundHash = () => page.evaluate(() => {
    const bg = document.querySelector('sand-game')?.shadowRoot?.querySelector('.sand-parallax-bg');
    const pixels = bg.getContext('2d').getImageData(0, 0, bg.width, bg.height).data;
    let hash = 2166136261;
    for (let i = 0; i < pixels.length; i += 16) hash = Math.imul(hash ^ pixels[i], 16777619);
    return hash >>> 0;
  });
  const cloudFrameA = await backgroundHash();
  await page.waitForTimeout(1300);
  const cloudFrameB = await backgroundHash();
  check('clouds hold still when manual time and camera are held still', cloudFrameA === cloudFrameB);
  await page.evaluate(() => window.__sandTest.setDayPhase(0.62));
  const cloudFrameC = await backgroundHash();
  await page.evaluate(() => window.__sandTest.setDayPhase(0.5));
  const cloudFrameA2 = await backgroundHash();
  check('clouds move with manual time and return deterministically', cloudFrameC !== cloudFrameA && cloudFrameA2 === cloudFrameA);

  await page.evaluate(() => window.__sandTest.clearDayPhase());
  const desktopTime = page.locator('sand-game').locator('.sg-time');
  const desktopRange = desktopTime.locator('.sg-time-range');
  const desktopAutoButton = desktopTime.locator('.sg-time-auto');
  await page.waitForFunction(() => document.querySelector('sand-game')?.shadowRoot?.querySelector('.sg-time')?.dataset.mode === 'auto');
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

  const liveInput = await desktopRange.evaluate(async (el) => {
    el.value = '0.63';
    const started = performance.now();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    let frames = 0;
    while (frames < 8) {
      await new Promise(requestAnimationFrame);
      frames++;
      const state = window.__sandTest.getDayNight();
      if (state.overridden && Math.abs(state.phase - 0.63) < 1e-6) {
        return { applied: true, frames, elapsed: performance.now() - started };
      }
    }
    return { applied: false, frames, elapsed: performance.now() - started };
  });
  check(`desktop slider applies during drag (${liveInput.frames} frame, ${liveInput.elapsed.toFixed(1)}ms)`,
    liveInput.applied && liveInput.frames <= 2);

  // Reproduce the old failure: several drag samples are queued, then Auto is
  // selected before the animation-frame update. No delayed noon sample may pin
  // the renderer after the live dawn phase has been restored.
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

  const mobileContext = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(URL, { waitUntil: 'domcontentloaded' });
  await mobilePage.waitForFunction(() => window.__sandTest?.info().cols > 0, null, { timeout: 60000 });
  const mobileGame = mobilePage.locator('sand-game');
  await mobileGame.locator('.sg-start').tap();
  const mobileTime = mobileGame.locator('.sg-time');
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
  const spacing = await mobilePage.locator('sand-game').evaluate((host) => {
    const root = host.shadowRoot;
    const palette = root.querySelector('.sg-palette').getBoundingClientRect();
    const zoom = root.querySelector('.sg-zoom').getBoundingClientRect();
    const stick = root.querySelector('.sg-stick').getBoundingClientRect();
    return { zoom: zoom.top - palette.bottom, stick: stick.top - palette.bottom };
  });
  check(`narrow mobile side controls clear the center palette (${spacing.zoom.toFixed(1)}px/${spacing.stick.toFixed(1)}px)`,
    spacing.zoom >= 6 && spacing.stick >= 6);
  await mobileContext.close();
} finally {
  await browser?.close().catch(() => {});
  shutdownServer();
}

const failures = done();
process.exit(failures === 0 ? 0 : 1);
