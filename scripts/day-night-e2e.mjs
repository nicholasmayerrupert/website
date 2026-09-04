import { chromium } from 'playwright';
import { NOON_SKY_LIGHT, SUNRISE_PHASE, SUNSET_PHASE } from '../src/sand/game/dayNightCycle.js';
import { SURFACE_CAM_Y } from '../src/sand/game/parallaxBackground.js';
import { makeChecker } from './sand-test-util.mjs';
import { startTestServer } from './browser-harness.mjs';

const { baseURL: URL, close: stopServer } = await startTestServer();

const { check, done } = makeChecker('day/night browser rendering');
let browser;
try {
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

  const skyPan = await page.evaluate(() => {
    const T = window.__sandTest;
    const bg = document.querySelector('sand-game')?.shadowRoot?.querySelector('.sand-parallax-bg');
    const context = bg.getContext('2d');
    const originalCam = T.getCam();
    const info = T.info();
    const shiftedY = originalCam.y >= 8
      ? originalCam.y - 8
      : Math.min(info.rows - info.viewRows, originalCam.y + 8);
    const rgb = (hex) => Number.parseInt(hex.slice(1), 16);
    const pixelSet = (colors) => {
      const targets = new Set(colors.map(rgb));
      const pixels = context.getImageData(0, 0, bg.width, bg.height).data;
      const matches = new Set();
      for (let i = 0; i < pixels.length; i += 4) {
        const color = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
        if (targets.has(color)) matches.add(i / 4);
      }
      return matches;
    };
    const overlap = (a, b) => {
      let shared = 0;
      for (const pixel of a) if (b.has(pixel)) shared++;
      return shared / Math.max(1, Math.min(a.size, b.size));
    };
    const pair = (phase, colors) => {
      T.setDayPhase(phase);
      T.setCam(originalCam.x, originalCam.y);
      const before = pixelSet(colors);
      T.setCam(originalCam.x, shiftedY);
      const after = pixelSet(colors);
      return { overlap: overlap(before, after), before: before.size, after: after.size };
    };

    const stars = pair(0, ['#e1f1f3', '#f9e7b7', '#b9dcff']);
    const moon = pair(0, ['#f4fbff']);
    const sun = pair(0.5, ['#ffe39a']);
    const clouds = pair(0.5, ['#b8cdd5', '#edf4f2']);
    T.setCam(originalCam.x, originalCam.y);
    return { cameraDelta: Math.abs(shiftedY - originalCam.y), stars, moon, sun, clouds };
  });
  check(`celestial pixels stay screen-fixed across a vertical camera pan (stars ${(skyPan.stars.overlap * 100).toFixed(1)}%, moon ${(skyPan.moon.overlap * 100).toFixed(1)}%, sun ${(skyPan.sun.overlap * 100).toFixed(1)}%)`,
    skyPan.cameraDelta >= 7.9 && skyPan.stars.before > 8 && skyPan.moon.before > 10 && skyPan.sun.before > 10 &&
    skyPan.stars.overlap > 0.94 && skyPan.moon.overlap > 0.94 && skyPan.sun.overlap > 0.94);
  check(`clouds retain vertical parallax (${(skyPan.clouds.overlap * 100).toFixed(1)}% fixed pixels)`,
    skyPan.clouds.before > 20 && skyPan.clouds.after > 20 && skyPan.clouds.overlap < 0.9);

  const cloudPan = await page.evaluate(async (surfaceCamY) => {
    const { createParallaxBackground } = await import('/src/sand/game/parallaxBackground.js');
    const { sampleDayNight } = await import('/src/sand/game/dayNightCycle.js');
    const host = document.createElement('div');
    const background = createParallaxBackground(host);
    background.resize(640, 360);
    const canvas = host.querySelector('canvas');
    const context = canvas.getContext('2d');
    let visualKey = 0;

    const largestLightCloudCenter = () => {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const matches = new Uint8Array(canvas.width * canvas.height);
      for (let i = 0; i < matches.length; i++) {
        const p = i * 4;
        matches[i] = pixels[p] === 237 && pixels[p + 1] === 244 && pixels[p + 2] === 242 ? 1 : 0;
      }
      let best = null;
      const stack = [];
      for (let start = 0; start < matches.length; start++) {
        if (!matches[start]) continue;
        matches[start] = 0;
        stack.push(start);
        let count = 0, sumX = 0, sumY = 0;
        while (stack.length) {
          const cell = stack.pop();
          const x = cell % canvas.width;
          const y = Math.floor(cell / canvas.width);
          count++;
          sumX += x;
          sumY += y;
          const left = cell - 1, right = cell + 1;
          const up = cell - canvas.width, down = cell + canvas.width;
          if (x > 0 && matches[left]) { matches[left] = 0; stack.push(left); }
          if (x + 1 < canvas.width && matches[right]) { matches[right] = 0; stack.push(right); }
          if (y > 0 && matches[up]) { matches[up] = 0; stack.push(up); }
          if (y + 1 < canvas.height && matches[down]) { matches[down] = 0; stack.push(down); }
        }
        if (!best || count > best.count) best = { count, x: sumX / count, y: sumY / count };
      }
      return best;
    };

    const sample = (camX, camY) => {
      background.draw({
        camX,
        camY,
        dayNight: sampleDayNight(0.5),
        dayVisualKey: ++visualKey,
      });
      return largestLightCloudCenter();
    };
    const axis = (horizontal) => {
      const centers = [];
      const distance = horizontal ? 12 : 4;
      for (let offset = 0; offset <= distance; offset += 0.25) {
        centers.push(sample(horizontal ? offset : 0, horizontal ? surfaceCamY : surfaceCamY + offset));
      }
      const values = centers.map((center) => horizontal ? center.x : center.y);
      let maxStep = 0;
      for (let i = 1; i < values.length; i++) maxStep = Math.max(maxStep, Math.abs(values[i] - values[i - 1]));
      return { maxStep, travel: Math.abs(values.at(-1) - values[0]), count: Math.min(...centers.map((center) => center.count)) };
    };
    const horizontal = axis(true);
    const vertical = axis(false);
    background.destroy();
    return { horizontal, vertical };
  }, SURFACE_CAM_Y);
  check(`cloud camera motion advances by single screen pixels in both axes (max step ${cloudPan.horizontal.maxStep.toFixed(2)}x, ${cloudPan.vertical.maxStep.toFixed(2)}y)`,
    cloudPan.horizontal.count > 20 && cloudPan.vertical.count > 20
      && cloudPan.horizontal.travel >= 4 && cloudPan.vertical.travel >= 6
      && cloudPan.horizontal.maxStep <= 1.01 && cloudPan.vertical.maxStep <= 1.01);

  const altitudeSky = await page.evaluate(async () => {
    const { createParallaxBackground, SURFACE_CAM_Y } =
      await import('/src/sand/game/parallaxBackground.js');
    const { sampleDayNight } = await import('/src/sand/game/dayNightCycle.js');
    const host = document.createElement('div');
    const background = createParallaxBackground(host);
    background.resize(1280, 720);
    const canvas = host.querySelector('canvas');
    const context = canvas.getContext('2d');
    const rgb = (hex) => Number.parseInt(hex.slice(1), 16);
    const stats = (colors) => {
      const targets = new Set(colors.map(rgb));
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0, sumY = 0, minY = canvas.height, maxY = -1;
      for (let i = 0; i < pixels.length; i += 4) {
        const color = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
        if (!targets.has(color)) continue;
        const y = Math.floor(i / 4 / canvas.width);
        count++;
        sumY += y;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      return { count, minY, maxY, meanY: count ? sumY / count : -1 };
    };
    let visualKey = 0;
    const sample = (camY, phase) => {
      background.draw({
        camY,
        dayNight: sampleDayNight(phase),
        dayVisualKey: ++visualKey,
      });
      return {
        stars: stats(['#e1f1f3', '#f9e7b7', '#b9dcff']),
        sun: stats(['#ffe39a', '#ffd489', '#fff1c1']),
        moon: stats(['#f4fbff']),
      };
    };
    const surfaceNight = sample(SURFACE_CAM_Y, 0);
    const highNight = sample(SURFACE_CAM_Y - 144, 0);
    const spaceNight = sample(SURFACE_CAM_Y - 320, 0);
    const surfaceNoon = sample(SURFACE_CAM_Y, 0.5);
    const highNoon = sample(SURFACE_CAM_Y - 144, 0.5);
    const spaceNoon = sample(SURFACE_CAM_Y - 320, 0.5);
    const spaceHorizon = sample(SURFACE_CAM_Y - 320, 0.8);
    background.destroy();
    return {
      height: canvas.height,
      surfaceNight,
      highNight,
      spaceNight,
      surfaceNoon,
      highNoon,
      spaceNoon,
      spaceHorizon,
    };
  });
  check(`the star boundary expands toward the bottom with altitude (${altitudeSky.surfaceNight.stars.maxY} -> ${altitudeSky.highNight.stars.maxY} -> ${altitudeSky.spaceNight.stars.maxY})`,
    altitudeSky.surfaceNight.stars.count > 8
      && altitudeSky.highNight.stars.maxY > altitudeSky.surfaceNight.stars.maxY + altitudeSky.height * 0.25
      && altitudeSky.spaceNight.stars.maxY > altitudeSky.height * 0.85);
  check(`the moon remains screen-fixed and visible in space (${altitudeSky.surfaceNight.moon.meanY.toFixed(1)} -> ${altitudeSky.highNight.moon.meanY.toFixed(1)} -> ${altitudeSky.spaceNight.moon.meanY.toFixed(1)})`,
    altitudeSky.surfaceNight.moon.count > 10 && altitudeSky.highNight.moon.count > 10
      && altitudeSky.spaceNight.moon.count > 10
      && Math.abs(altitudeSky.highNight.moon.meanY - altitudeSky.surfaceNight.moon.meanY) < 1
      && Math.abs(altitudeSky.spaceNight.moon.meanY - altitudeSky.surfaceNight.moon.meanY) < 1);
  check(`the sun remains screen-fixed and visible in space (${altitudeSky.surfaceNoon.sun.meanY.toFixed(1)} -> ${altitudeSky.highNoon.sun.meanY.toFixed(1)} -> ${altitudeSky.spaceNoon.sun.meanY.toFixed(1)})`,
    altitudeSky.surfaceNoon.sun.count > 10 && altitudeSky.highNoon.sun.count > 10
      && altitudeSky.spaceNoon.sun.count > 10
      && Math.abs(altitudeSky.highNoon.sun.meanY - altitudeSky.surfaceNoon.sun.meanY) < 1
      && Math.abs(altitudeSky.spaceNoon.sun.meanY - altitudeSky.surfaceNoon.sun.meanY) < 1);
  check(`sun and moon meet the bottom edge in open space (sun ${altitudeSky.spaceHorizon.sun.count}@${altitudeSky.spaceHorizon.sun.meanY.toFixed(1)}, moon ${altitudeSky.spaceHorizon.moon.count}@${altitudeSky.spaceHorizon.moon.meanY.toFixed(1)})`,
    altitudeSky.spaceHorizon.sun.count > 10
      && altitudeSky.spaceHorizon.moon.count > 10
      && altitudeSky.spaceHorizon.sun.meanY > altitudeSky.height * 0.9
      && altitudeSky.spaceHorizon.moon.meanY > altitudeSky.height * 0.9);

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
  stopServer();
}

const failures = done();
process.exit(failures === 0 ? 0 : 1);
