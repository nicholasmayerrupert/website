import process from 'node:process';
import { resolve } from 'node:path';
import { runBrowserCases } from './browser-harness.mjs';

const failures = await runBrowserCases({
  'independent-parallax': async ({ page, baseURL, check }) => {
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    const travel = await page.evaluate(async () => {
      document.querySelectorAll('sand-game').forEach((host) => host.remove());
      const { createParallaxBackground, SURFACE_CAM_Y } = await import('/src/sand/game/parallaxBackground.js');
      const { sampleDayNight } = await import('/src/sand/game/dayNightCycle.js');
      const host = document.createElement('div');
      document.body.appendChild(host);
      const background = createParallaxBackground(host);
      background.resize(600, 480);
      const context = host.querySelector('canvas').getContext('2d');
      const gradient = context.createLinearGradient;
      let starts = [];
      context.createLinearGradient = function (...args) {
        if (new Error().stack.includes('drawRidge')) starts.push(args[0]);
        return gradient.apply(this, args);
      };
      let previous = null;
      const travel = [0, 0, 0, 0];
      for (let frame = 0; frame <= 40; frame++) {
        starts = [];
        background.draw({ camX: frame / 4, camY: SURFACE_CAM_Y,
          dayNight: sampleDayNight(0.5), biomeWeights: [0, 1, 0, 0, 0, 0, 0, 0] });
        if (previous) for (let layer = 0; layer < 4; layer++) {
          let delta = starts[layer] - previous[layer];
          // Unwrap the four-pixel surface sampling lattice at the viewport edge.
          if (delta > 2) delta -= 4;
          travel[layer] -= delta;
        }
        previous = starts;
      }
      return travel;
    });
    check('all four terrain layers move independently, with nearer scenery moving faster',
      travel.every((distance, layer) => Number.isFinite(distance) && distance > 0
        && (layer === 0 || distance > travel[layer - 1])), JSON.stringify(travel));
  },
  'eye-stalk-pan': async ({ page, baseURL, check }) => {
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    const result = await page.evaluate(async () => {
      document.querySelectorAll('sand-game').forEach((host) => host.remove());
      const { createParallaxBackground, SURFACE_CAM_Y } = await import('/src/sand/game/parallaxBackground.js');
      const { sampleDayNight } = await import('/src/sand/game/dayNightCycle.js');
      const { BIOME, SURFACE_BIOME_COUNT } = await import('/src/sand/wasmBridge/abi.generated.js');
      const host = document.createElement('div');
      document.body.appendChild(host);
      const background = createParallaxBackground(host);
      background.resize(600, 480);
      const canvas = host.querySelector('canvas'), context = canvas.getContext('2d');
      const isolated = document.createElement('canvas');
      isolated.width = canvas.width;
      isolated.height = canvas.height;
      const ink = isolated.getContext('2d');
      const fillRect = context.fillRect;
      context.fillRect = function (...args) {
        if (/drawEyeGrove|drawBoneField/.test(new Error().stack)) {
          ink.setTransform(this.getTransform());
          ink.fillRect(...args);
        }
        return fillRect.apply(this, args);
      };
      let selectedBiome = BIOME.WATCHWOOD;
      const draw = (x, y, scale) => {
        ink.resetTransform();
        ink.clearRect(0, 0, isolated.width, isolated.height);
        background.draw({
          camX: x, camY: SURFACE_CAM_Y + y, scale, dayNight: sampleDayNight(0.5),
          biomeWeights: Array.from({ length: SURFACE_BIOME_COUNT }, (_, id) => Number(id === selectedBiome)),
        });
        return ink.getImageData(0, 0, isolated.width, isolated.height).data;
      };
      let mismatches = 0, pixels = 0;
      for (const biome of [BIOME.WATCHWOOD, BIOME.ROCKY]) for (const scale of [1, 0.75]) {
        selectedBiome = biome;
        const before = draw(0, 0, scale);
        for (const [x, y] of [[0.25, 0], [0.5, 0], [1, 0], [2, 0], [0, 0.25], [0, 0.5], [0, 1], [0, 2]]) {
          const after = draw(x, y, scale);
          const dx = Math.round(x * 0.52 * 4 * scale);
          const dy = Math.round(y * 0.55 * 1.52 * 4 * scale);
          for (let py = 64; py < isolated.height - 64; py++) {
            for (let px = 64; px < isolated.width - 64; px++) {
              const a = before[((py + dy) * isolated.width + px + dx) * 4 + 3];
              const b = after[(py * isolated.width + px) * 4 + 3];
              if (a !== b) mismatches++;
              if (a || b) pixels++;
            }
          }
        }
      }
      return { mismatches, pixels };
    });
    check('eye trees and fossils translate without changing pixels during horizontal and vertical pans',
      result.pixels > 1000 && result.mismatches === 0, JSON.stringify(result));
  },
  'fixed-biome-scenery': async ({ page, baseURL, check }) => {
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    const result = await page.evaluate(async () => {
      document.querySelectorAll('sand-game').forEach((host) => host.remove());
      document.body.innerHTML = '';
      document.body.style.margin = '0';
      const { createParallaxBackground, SURFACE_CAM_Y } = await import('/src/sand/game/parallaxBackground.js');
      const { createBiomeScenerySampler } = await import('/src/sand/game/biomeBackground.js');
      const { SURFACE_REGION_WIDTH } = await import('/src/sand/wasmBridge/biomes.generated.js');
      const { sampleDayNight } = await import('/src/sand/game/dayNightCycle.js');
      const { BIOME, SURFACE_BIOME_COUNT } = await import('/src/sand/wasmBridge/abi.generated.js');
      const host = document.createElement('div');
      host.style.cssText = 'position:relative;width:1200px;height:760px';
      document.body.appendChild(host);
      const background = createParallaxBackground(host);
      background.resize(1200, 760);
      const canvas = host.querySelector('canvas'), context = canvas.getContext('2d');
      const pure = (id) => Array.from({ length: SURFACE_BIOME_COUNT }, (_, i) => Number(i === id));
      const field = createBiomeScenerySampler()({ worldBiomeAt: (x) => x < 0 ? BIOME.PLAINS : BIOME.ROCKY });
      const draw = (x, sky = BIOME.PLAINS, sampler = field, scale = 1) => background.draw({
        camX: x, camY: SURFACE_CAM_Y, scale, dayNight: sampleDayNight(0.5),
        biomeWeights: pure(sky), biomeSceneryAt: sampler,
      });
      const terrain = () => context.getImageData(0, 400, canvas.width, canvas.height - 400).data;
      draw(0);
      const before = terrain();
      draw(240, BIOME.ROCKY);
      draw(-240);
      draw(0, BIOME.ROCKY);
      const after = terrain();
      const stable = before.every((value, i) => value === after[i]);
      const fillRect = context.fillRect;
      const plantCalls = {};
      let translucent = 0;
      context.fillRect = function (...args) {
        const caller = new Error().stack.match(/drawForest|drawEyeGrove|drawBoneField|drawBiomePlants/)?.[0];
        if (caller) {
          plantCalls[caller] = (plantCalls[caller] ?? 0) + 1;
          if (this.globalAlpha !== 1) translucent++;
        }
        return fillRect.apply(this, args);
      };
      const grove = createBiomeScenerySampler()({
        worldBiomeAt: (x) => ((Math.floor(x / SURFACE_REGION_WIDTH) % SURFACE_BIOME_COUNT) + SURFACE_BIOME_COUNT) % SURFACE_BIOME_COUNT,
      });
      for (let biome = 0; biome < SURFACE_BIOME_COUNT; biome++) draw((biome + 0.5) * SURFACE_REGION_WIDTH, biome, grove);
      context.fillRect = fillRect;
      draw(0, BIOME.PLAINS, field, 0.75);
      draw(0, BIOME.PLAINS);
      const resized = terrain();
      const zoomStable = before.every((value, i) => value === resized[i]);
      return { stable, zoomStable, plantCalls, translucent };
    });
    check('terrain pixels remain identical after crossing, reversing, and changing the player biome mix', result.stable);
    check('zooming out and back preserves the landscape', result.zoomStable);
    check('trees, fossils, and other biome scenery all render fully opaque',
      ['drawForest', 'drawEyeGrove', 'drawBoneField', 'drawBiomePlants'].every((name) => result.plantCalls[name] > 0)
        && result.translucent === 0, JSON.stringify(result));
    await page.screenshot({ path: resolve(process.env.SAND_TEST_ARTIFACTS, 'fixed-biome-boundary.png') });
  },
});
process.exitCode = failures ? 1 : 0;
