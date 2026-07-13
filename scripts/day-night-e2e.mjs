import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
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
  check('creative desktop palette exposes the automatic time control', await desktopTime.textContent() === 'Time: Auto');
  await desktopTime.click();
  const desktopDawn = await page.evaluate(() => window.__sandTest.getDayNight());
  check('desktop time control selects dawn', desktopDawn.overridden && Math.abs(desktopDawn.phase - 0.25) < 1e-6 && await desktopTime.textContent() === 'Time: Dawn');
  for (let i = 0; i < 4; i++) await desktopTime.click();
  const desktopAuto = await page.evaluate(() => window.__sandTest.getDayNight());
  check('desktop time control returns to the live cycle', !desktopAuto.overridden && await desktopTime.textContent() === 'Time: Auto');

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(URL, { waitUntil: 'domcontentloaded' });
  await mobilePage.waitForFunction(() => window.__sandTest?.info().cols > 0, null, { timeout: 60000 });
  const mobileTime = mobilePage.locator('sand-game').locator('.sg-time');
  check('creative mobile palette exposes the same fitted time control', await mobileTime.isVisible() && await mobileTime.textContent() === 'Time: Auto');
  await mobileTime.tap();
  const mobileDawn = await mobilePage.evaluate(() => window.__sandTest.getDayNight());
  check('mobile time control selects dawn', mobileDawn.overridden && Math.abs(mobileDawn.phase - 0.25) < 1e-6 && await mobileTime.textContent() === 'Time: Dawn');
  await mobileContext.close();
} finally {
  await browser?.close().catch(() => {});
  shutdownServer();
}

const failures = done();
process.exit(failures === 0 ? 0 : 1);
