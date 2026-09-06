// Headless Chromium benchmark for sub-cell pan instability and frame timing.
// Absolute software-GL frame times are relative; instability should remain near 0.
//
//   node scripts/bench-pan.mjs                      # print results
//   node scripts/bench-pan.mjs --update bench/pan-baseline.json
//   node scripts/bench-pan.mjs --compare bench/pan-baseline.json
//   node scripts/bench-pan.mjs --png bench/         # also dump downscaled frames

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { comparePanResults } from './bench-pan-compare.mjs';

const NPM = process.platform === 'win32' ? process.execPath : 'npm';
const NPM_ARGS = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : [];
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const comparePath = flag('--compare');
const updatePath = flag('--update');
const pngDir = flag('--png');
const WORLD_SEED = 0xC0FFEE;

// --- start dev server ---
const server = spawn(NPM, [...NPM_ARGS, 'run', 'dev', '--', '--port', '5179', '--strictPort'], {
  cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
});
const baseURL = 'http://localhost:5179/';
const waitForServer = () => new Promise((resolve, reject) => {
  let buf = '';
  let done = false;
  const finish = () => { if (done) return; done = true; clearTimeout(to); clearInterval(poll); resolve(); };
  const fail = (err) => { if (done) return; done = true; clearTimeout(to); clearInterval(poll); server.kill('SIGKILL'); reject(err); };
  const to = setTimeout(() => fail(new Error('dev server timeout')), 60000);
  const poll = setInterval(async () => {
    try { if ((await fetch(baseURL)).ok) finish(); } catch {}
  }, 500);
  const onData = (d) => { buf += d.toString(); if (/localhost:5179/.test(buf)) finish(); };
  server.stdout.on('data', onData);
  server.stderr.on('data', (d) => { const s = d.toString(); if (/error|in use/i.test(s)) fail(new Error('dev server: ' + s.trim())); });
});
await waitForServer();

// --- in-page flicker probe (runs entirely in the browser) ---
// Sweep one cell of camera movement. After compensating for the best integer
// pixel shift, residual luma change is the instability score (0..255).
const PROBE = ({ subSteps, noSnap, axis }) => {
  const T = window.__sandTest;
  const cv = document.querySelector('sand-game')?.shadowRoot?.getElementById('sand-main') || document.getElementById('sand-main');
  const W = cv.width, H = cv.height;
  const stride = 1; // full res: a clean 1-device-px pan must be exactly compensatable
  const sw = Math.floor(W / stride), sh = Math.floor(H / stride);
  const grab = () => {
    // The main canvas is WebGL now; read pixels back through the engine
    // (glReadPixels, top-down RGBA) instead of a 2D context.
    const d = T.readPixels(0, 0, W, H);
    const luma = new Float32Array(sw * sh);
    for (let y = 0; y < sh; y++) {
      const sy = y * stride;
      for (let x = 0; x < sw; x++) {
        const p = (sy * W + x * stride) * 4;
        luma[y * sw + x] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
      }
    }
    return luma;
  };
  // mean-abs residual of B vs A shifted along the pan axis, min over shifts.
  const minResid = (A, B) => {
    let best = Infinity, bestShift = 0;
    for (const shift of [-2, -1, 0, 1, 2]) {
      let sum = 0, n = 0;
      const m = 3;
      for (let y = m; y < sh - m; y++) {
        const row = y * sw;
        for (let x = m; x < sw - m; x++) {
          const xa = axis === 'x' ? x + shift : x;
          const ya = axis === 'y' ? y + shift : y;
          sum += Math.abs(B[row + x] - A[ya * sw + xa]); n++;
        }
      }
      const mean = sum / n;
      if (mean < best) { best = mean; bestShift = shift; }
    }
    return { best, bestShift };
  };

  T.setPaused(true); // freeze the sim so we measure pan jitter, not animation
  if (T.setGutter) T.setGutter(true); // measure the real grid path (now content-locked)
  if (T.setSnap && noSnap) T.setSnap(false); // A/B: validate metric catches the buggy path
  const cam0 = T.getCam();
  let prev = grab();
  let instability = 0, worst = 0;
  const dbg = [];
  for (let s = 1; s <= subSteps; s++) {
    T.setCam(cam0.x + (axis === 'x' ? s / subSteps : 0),
             cam0.y + (axis === 'y' ? s / subSteps : 0));
    const cur = grab();
    const r = minResid(prev, cur);
    instability += r.best; if (r.best > worst) worst = r.best;
    if (s <= 14) {
      const cam = axis === 'x' ? cam0.x + s / subSteps : cam0.y + s / subSteps;
      const off = T.off();
      dbg.push(`${cam.toFixed(3)}:${r.best.toFixed(1)}/sh${r.bestShift}/o${axis}${axis === 'x' ? off.offX : off.offY}`);
    }
    prev = cur;
  }
  T.setCam(cam0.x, cam0.y);
  if (T.setGutter) T.setGutter(true);
  if (T.setSnap) T.setSnap(true);
  T.setPaused(false);
  return { axis, subSteps, cam0: axis === 'x' ? cam0.x : cam0.y, instability: +instability.toFixed(3), perStep: +(instability / subSteps).toFixed(4), worst: +worst.toFixed(4), dbg };
};

const PARALLAX_RIGIDITY_PROBE = ({ axis }) => {
  const T = window.__sandTest;
  // Hold one scenery profile so this probe measures camera rigidity through
  // terrain boundaries independently of the biome crossfade.
  T.setBackgroundBiome(1);
  const canvas = document.querySelector('sand-game')?.shadowRoot?.querySelector('.sand-parallax-bg');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const stride = 4;
  const grab = () => ctx.getImageData(0, 0, W, H).data;
  const rgb = (hex) => Number.parseInt(hex.slice(1), 16);
  // Exact biome ridge fills isolate the four scenery layers from clouds, facets,
  // and lighting so the comparison measures shape changes rather than motion.
  const ridgeColors = () => {
    const palette = T.backgroundPalette();
    return ['ridgeFar', 'ridgeMid', 'ridgeNear', 'ridgeDeep'].map((key) => rgb(palette[key]));
  };
  const matches = (pixels, index, color) =>
    ((pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2]) === color;

  T.setPaused(true);
  T.setDayPhase(0.5);
  const cam0 = T.getCam();
  if (axis === 'y') {
    const info = T.info();
    const worldOffset = T.worldOffset();
    // Keep the vertical sample at one absolute surface coordinate even if the
    // authority has already rebased its loaded window.
    const targetCamY = Math.max(0, Math.min(info.rows - info.viewRows - 2, -96 - worldOffset.y));
    T.setCam(cam0.x, targetCamY);
  }
  const probeCam = T.getCam();
  const before = grab();
  const target = ridgeColors();
  T.setCam(probeCam.x + (axis === 'x' ? 2 : 0),
           probeCam.y + (axis === 'y' ? 2 : 0));
  const after = grab();
  const afterTarget = ridgeColors();

  const layers = target.map((color, layer) => {
    let best = Infinity, bestShift = 0;
    for (let shift = -12; shift <= 12; shift++) {
      let changed = 0, covered = 0;
      for (let y = 12; y < H - 12; y += stride) for (let x = 12; x < W - 12; x += stride) {
        const ax = axis === 'x' ? x + shift : x;
        const ay = axis === 'y' ? y + shift : y;
        if (ax < 0 || ax >= W || ay < 0 || ay >= H) continue;
        const a = matches(before, (ay * W + ax) * 4, color);
        const b = matches(after, (y * W + x) * 4, afterTarget[layer]);
        if (!a && !b) continue;
        covered++;
        if (a !== b) changed++;
      }
      const ratio = covered ? changed / covered : 0;
      if (ratio < best) { best = ratio; bestShift = shift; }
    }
    return { mismatch: +best.toFixed(5), shift: bestShift };
  });

  T.setCam(cam0.x, cam0.y);
  T.clearDayPhase();
  T.setBackgroundBiome(null);
  T.setPaused(false);
  return {
    axis,
    worst: Math.max(...layers.map((layer) => layer.mismatch)),
    layers,
  };
};

const browser = await chromium.launch({ headless: true });
// Tear down the browser and the dev server. taskkill on Windows (npm spawns
// vite as a child; killing only npm orphans vite and holds the port); SIGTERM
// elsewhere. Destroying the stdio pipes + unref lets Node's event loop drain
// and exit cleanly on both platforms instead of hanging on the live child.
const shutdown = async () => {
  await browser.close().catch(() => {});
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
  else server.kill('SIGTERM');
  server.stdout.destroy();
  server.stderr.destroy();
  server.unref();
};
let result;
try {
  const dsf = Number(process.env.DSF) || 1; // emulate browser zoom: <1 = zoomed out
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: dsf, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  // Set the embed seed before React connects the element. The simulation keeps
  // its normal RNG; only the procedural world is fixed for comparable workloads.
  await page.addInitScript((seed) => {
    const createElement = Document.prototype.createElement;
    Document.prototype.createElement = function (...args) {
      const element = createElement.apply(this, args);
      if (element.localName === 'sand-game') element.setAttribute('world-seed', String(seed));
      return element;
    };
  }, WORLD_SEED);
  await page.goto(baseURL, { waitUntil: 'load' });
  // The game mounts after WASM init; wait for the hooks + a fitted engine.
  await page.locator('sand-game').scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForFunction(() => window.__sandTest && window.__sandTest.info().cols > 0, null, { timeout: 30000 });
  // Let the world settle a bit so terrain (not falling sand) dominates.
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const value = window.__sandTest.info();
    const canvas = document.querySelector('sand-game')?.shadowRoot?.getElementById('sand-main') || document.getElementById('sand-main');
    const gl = canvas?.getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      ...value,
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : (gl?.getParameter(gl.RENDERER) || 'unknown'),
    };
  });

  // Pointer round-trip: a cursor at a cell's rendered center must map back to
  // that cell. Catches brush/cursor offset bugs across zoom levels. Reports the
  // worst |Δcell| over a grid of visible cells (must be 0).
  const cursor = await page.evaluate(() => {
    const T = window.__sandTest, i = T.info(), cam = T.getCam();
    const camCol = Math.floor(cam.x), camRow = Math.floor(cam.y);
    let worst = 0;
    for (let gx = 4; gx < i.viewCols - 4; gx += 7) for (let gy = 4; gy < i.viewRows - 4; gy += 7) {
      const cx = camCol + gx, cy = camRow + gy;
      const r = T.cellRect(cx, cy);                 // device-px top-left
      const pxCss = (r.x + r.size / 2) / i.dpr;      // cell center in canvas CSS px
      const pyCss = (r.y + r.size / 2) / i.dpr;
      const [bx, by] = T.cellAt(pxCss, pyCss);
      worst = Math.max(worst, Math.abs(bx - cx), Math.abs(by - cy));
    }
    return { worstCellErr: worst };
  });

  // Sub-cell pan instability (root-cause flicker metric).
  const flicker = await page.evaluate(PROBE, { axis: 'x', subSteps: 24, noSnap: !!process.env.NO_SNAP });
  const verticalFlicker = await page.evaluate(PROBE, { axis: 'y', subSteps: 24, noSnap: !!process.env.NO_SNAP });
  const parallaxHorizontal = await page.evaluate(PARALLAX_RIGIDITY_PROBE, { axis: 'x' });
  const parallaxVertical = await page.evaluate(PARALLAX_RIGIDITY_PROBE, { axis: 'y' });

  // Optionally dump downscaled frames at two sub-cell pan phases so the moiré
  // banding (what the user sees) is visible to the eye.
  if (pngDir) {
    const dump = async (frac, name) => {
      const dataUrl = await page.evaluate((f) => {
        const T = window.__sandTest; T.setPaused(true); const cam = T.getCam();
        T.setCam(Math.floor(cam.x) + f, cam.y);
        const cv = document.querySelector('sand-game')?.shadowRoot?.getElementById('sand-main') || document.getElementById('sand-main');
        // crop a small full-res region so the grid/content shift is visible
        const off = document.createElement('canvas');
        off.width = 160; off.height = 120;
        const o = off.getContext('2d'); o.imageSmoothingEnabled = false;
        o.drawImage(cv, 200, 200, 160, 120, 0, 0, 160, 120);
        const url = off.toDataURL('image/png'); T.setCam(cam.x, cam.y); return url;
      }, frac);
      writeFileSync(`${pngDir.replace(/\/$/, '')}/${name}`, Buffer.from(dataUrl.split(',')[1], 'base64'));
    };
    await dump(0.125, 'pan-flipA.png'); // offX 0
    await dump(0.167, 'pan-flipB.png'); // offX -1
    await page.screenshot({ path: `${pngDir.replace(/\/$/, '')}/pan-full.png` }); // sanity: whole frame renders
  }

  // Frame timing during a real held-key pan (relative-only on headless GL).
  await page.waitForFunction(() => {
    const surface = document.querySelector('sand-game')?.shadowRoot?.querySelector('.sg-sim');
    if (!surface) return false;
    surface.focus({ preventScroll: true });
    return surface.getRootNode().activeElement === surface;
  }, null, { timeout: 10000 });
  await page.keyboard.down('d');
  await page.waitForTimeout(2500);
  const perf = await page.evaluate(() => window.__sandPerf());
  await page.keyboard.up('d');

  result = {
    meta: {
      worldSeed: WORLD_SEED,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      browser: browser.version(),
      deviceScaleFactor: dsf,
      renderer: info.renderer,
    },
    info,
    cursor,
    flicker,
    verticalFlicker,
    parallaxHorizontal,
    parallaxVertical,
    perf,
  };
} catch (err) {
  await shutdown();
  console.error(err);
  process.exit(1);
}

// --- report ---
const report = [
  '',
  `pan/flicker benchmark  (canvas ${result.info.canvasW}x${result.info.canvasH}, cellSize ${result.info.cellSize}, dpr ${result.info.dpr})`,
  `  cursor->cell round-trip worst error: ${result.cursor.worstCellErr} cells (must be 0)`,
  `  horizontal sub-cell instability (luma 0..255; lower is better): total ${result.flicker.instability}  perStep ${result.flicker.perStep}  worst ${result.flicker.worst}`,
  `  vertical sub-cell instability: total ${result.verticalFlicker.instability}  perStep ${result.verticalFlicker.perStep}  worst ${result.verticalFlicker.worst}`,
  `  horizontal parallax rigidity: worst ${(result.parallaxHorizontal.worst * 100).toFixed(3)}% mismatch; layers ${result.parallaxHorizontal.layers.map((layer) => `${(layer.mismatch * 100).toFixed(3)}%/shift${layer.shift}`).join('  ')}`,
  `  vertical parallax rigidity: worst ${(result.parallaxVertical.worst * 100).toFixed(3)}% mismatch; layers ${result.parallaxVertical.layers.map((layer) => `${(layer.mismatch * 100).toFixed(3)}%/shift${layer.shift}`).join('  ')}`,
];
if (result.flicker.dbg) report.push(`  horizontal dbg cam0=${result.flicker.cam0} steps(resid/shift): ${result.flicker.dbg.join('  ')}`);
if (result.verticalFlicker.dbg) report.push(`  vertical dbg cam0=${result.verticalFlicker.cam0} steps(resid/shift): ${result.verticalFlicker.dbg.join('  ')}`);
report.push(`  frame: avg ${result.perf.avgFrameMs}ms  p95 ${result.perf.p95FrameMs}ms  step ${result.perf.stepMs}ms  render ${result.perf.renderMs}ms  dirtyChunks ${result.perf.dirtyChunks}`);
report.push(`  render CPU phases: light ${result.perf.lightMs ?? '-'}ms  fill ${result.perf.fillMs ?? '-'}ms  upload ${result.perf.uploadMs ?? '-'}ms`);
// Fine step breakdown (same fields as headless bench-sand / __sandPerf).
const stepParts = [
  ['grounding', result.perf.groundingMs],
  ['xlayerG', result.perf.crossLayerGroundingMs],
  ['compIdx', result.perf.componentIndexMs],
  ['assembly', result.perf.assemblyUnionMs],
  ['carry', result.perf.carryMs],
  ['body', result.perf.bodyMs],
  ['sand', result.perf.sandMs],
  ['liquid', result.perf.liquidMs],
  ['gas', result.perf.gasMs],
  ['react', result.perf.reactMs],
  ['tail', result.perf.tailMs],
  ['layers', result.perf.layersMs],
  ['cross', result.perf.crossMs],
].filter(([, v]) => v != null);
if (stepParts.length) {
  report.push(`  step phases (ms): ${stepParts.map(([k, v]) => `${k} ${Number(v).toFixed(2)}`).join('  ')}`);
}
const volParts = [
  ['dirtyRows', result.perf.dirtyRows],
  ['dirtyCells', result.perf.dirtyCells],
  ['comps', result.perf.componentCount],
  ['compCells', result.perf.componentCellCount],
  ['xBonds', result.perf.crossBondCount],
].filter(([, v]) => v != null);
if (volParts.length) {
  report.push(`  step volume: ${volParts.map(([k, v]) => `${k} ${v}`).join('  ')}`);
}

if (updatePath) { writeFileSync(updatePath, JSON.stringify(result, null, 2)); report.push('', `updated baseline ${updatePath}`); }

let exit = 0;
if (comparePath) {
  const base = JSON.parse(readFileSync(comparePath, 'utf8'));
  report.push('', `compare vs ${comparePath}`);
  const d = result.flicker.instability - base.flicker.instability;
  const tag = d > 0.5 ? ' WORSE' : d < -0.5 ? ' better' : '';
  report.push(`  instability: ${base.flicker.instability} -> ${result.flicker.instability}  (${d >= 0 ? '+' : ''}${d.toFixed(2)})${tag}`);
  if (base.verticalFlicker && base.parallaxVertical?.layers?.[2]) {
    report.push(`  vertical instability: ${base.verticalFlicker.instability} -> ${result.verticalFlicker.instability}`);
    report.push(`  vertical near-ridge mismatch: ${(base.parallaxVertical.layers[2].mismatch * 100).toFixed(3)}% -> ${(result.parallaxVertical.layers[2].mismatch * 100).toFixed(3)}%`);
  }
  const fd = result.perf.avgFrameMs - base.perf.avgFrameMs;
  report.push(`  frame avg: ${base.perf.avgFrameMs} -> ${result.perf.avgFrameMs}ms  (${fd >= 0 ? '+' : ''}${fd.toFixed(1)})`);
  const comparison = comparePanResults(result, base);
  if (!comparison.perfEnvironment.compatible) {
    report.push(`  timing gate skipped: ${comparison.perfEnvironment.reason}`);
  } else {
    report.push(`  timing limits: avg ${comparison.perfLimits.avgFrameMs.toFixed(3)}ms  p95 ${comparison.perfLimits.p95FrameMs.toFixed(3)}ms`);
  }
  if (comparison.failures.length) {
    exit = 1;
    report.push(...comparison.failures.map((failure) => `  REGRESSION: ${failure}`));
  } else report.push('  regression gate: pass');
}
writeSync(1, `${report.join('\n')}\n`);
await shutdown();
process.exitCode = exit;
