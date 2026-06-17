// Headless pan/flicker benchmark for the sand game (Playwright + Chromium).
// Run with:
//   node scripts/bench-pan.mjs                      # print results
//   node scripts/bench-pan.mjs --update bench/pan-baseline.json
//   node scripts/bench-pan.mjs --compare bench/pan-baseline.json
//   node scripts/bench-pan.mjs --png bench/         # also dump downscaled frames
//
// It starts the Vite dev server (so the DEV-only __sandPerf / __sandTest hooks
// exist), opens the About page, then measures two things:
//
//   1. FLICKER — the bright-block flicker users see only at lower browser zoom.
//      That artifact is the GPU compositor DOWNSAMPLING our blocky+grid canvas
//      when 1 CSS px < 1 backing px (zoom < 100%). We reproduce it faithfully
//      in-page: draw the main canvas into a smaller offscreen canvas WITH
//      smoothing (what the compositor does), then pan by WHOLE cells (a pure
//      content translation), motion-compensate the exact integer pixel shift,
//      and measure the residual brightness change. On a clean renderer that
//      residual is ~0; moiré beating from sub-pixel cell/grid misalignment
//      makes large regions change brightness -> high residual. A noise-floor
//      capture (same camera twice) subtracts sim animation.
//
//   2. FRAME TIME — avg/p95 frame ms from window.__sandPerf() during a real
//      held-key pan. (Headless uses software GL, so treat absolute numbers as
//      relative-only; the flicker metric is the authoritative signal here.)

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const comparePath = flag('--compare');
const updatePath = flag('--update');
const pngDir = flag('--png');

// --- start dev server ---
const server = spawn('npm', ['run', 'dev', '--', '--port', '5179', '--strictPort'], {
  cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
});
const baseURL = 'http://localhost:5179/';
const waitForServer = () => new Promise((resolve, reject) => {
  let buf = '';
  const to = setTimeout(() => { server.kill('SIGKILL'); reject(new Error('dev server timeout')); }, 60000);
  const onData = (d) => { buf += d.toString(); if (/localhost:5179/.test(buf)) { clearTimeout(to); resolve(); } };
  server.stdout.on('data', onData);
  server.stderr.on('data', (d) => { const s = d.toString(); if (/error|in use/i.test(s)) { clearTimeout(to); server.kill('SIGKILL'); reject(new Error('dev server: ' + s.trim())); } });
});
await waitForServer();

// --- in-page flicker probe (runs entirely in the browser) ---
// Root-cause metric: as the camera pans through SUB-CELL offsets, a correct
// renderer advances the on-screen image in clean whole-device-pixel steps, so
// consecutive frames differ only by an exact integer-pixel translation. The
// current fractional-offset renderer instead re-quantizes cell/grid edges
// unevenly each frame -> a residual that no single integer shift removes. That
// residual is exactly what the compositor downscale (zoom < 100%) amplifies
// into the bright-block flicker. We sweep one full cell of panning and sum the
// per-step min-over-integer-shift residual ("instability", luma 0..255).
//   - subSteps: sub-cell sample positions across one cell.
const PROBE = ({ subSteps, noSnap }) => {
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
  // mean-abs residual of B vs A shifted by `shift` sampled-px, min over shifts.
  const minResid = (A, B) => {
    let best = Infinity, bestShift = 0;
    for (const shift of [-2, -1, 0, 1, 2]) {
      let sum = 0, n = 0;
      const m = 3;
      for (let y = m; y < sh - m; y++) {
        const row = y * sw;
        for (let x = m; x < sw - m; x++) {
          const xa = x + shift;
          sum += Math.abs(B[row + x] - A[row + xa]); n++;
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
    T.setCam(cam0.x + s / subSteps, cam0.y); // sub-cell pan (offX sweeps a full cell)
    const cur = grab();
    const r = minResid(prev, cur);
    instability += r.best; if (r.best > worst) worst = r.best;
    if (s <= 14) dbg.push(`${(cam0.x + s / subSteps).toFixed(3)}:${r.best.toFixed(1)}/sh${r.bestShift}/ox${T.off().offX}`);
    prev = cur;
  }
  T.setCam(cam0.x, cam0.y);
  if (T.setGutter) T.setGutter(true);
  if (T.setSnap) T.setSnap(true);
  T.setPaused(false);
  return { subSteps, cam0x: cam0.x, instability: +instability.toFixed(3), perStep: +(instability / subSteps).toFixed(4), worst: +worst.toFixed(4), dbg };
};

const browser = await chromium.launch({ headless: true });
let result;
try {
  const dsf = Number(process.env.DSF) || 1; // emulate browser zoom: <1 = zoomed out
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: dsf, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.goto(baseURL, { waitUntil: 'load' });
  // The game mounts after WASM init; wait for the hooks + a fitted engine.
  await page.locator('sand-game').scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForFunction(() => window.__sandTest && window.__sandTest.info().cols > 0, null, { timeout: 30000 });
  // Let the world settle a bit so terrain (not falling sand) dominates.
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => window.__sandTest.info());

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
  const flicker = await page.evaluate(PROBE, { subSteps: 24, noSnap: !!process.env.NO_SNAP });

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
  await page.evaluate(() => window.focus());
  await page.keyboard.down('d');
  await page.waitForTimeout(2500);
  const perf = await page.evaluate(() => window.__sandPerf());
  await page.keyboard.up('d');

  result = { info, cursor, flicker, perf };
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

// --- report ---
console.log(`\npan/flicker benchmark  (canvas ${result.info.canvasW}x${result.info.canvasH}, cellSize ${result.info.cellSize}, dpr ${result.info.dpr})`);
console.log(`  cursor->cell round-trip worst error: ${result.cursor.worstCellErr} cells (must be 0)`);
console.log(`  sub-cell instability (luma 0..255; lower is better): total ${result.flicker.instability}  perStep ${result.flicker.perStep}  worst ${result.flicker.worst}`);
if (result.flicker.dbg) console.log(`  dbg cam0x=${result.flicker.cam0x} steps(resid/shift): ${result.flicker.dbg.join('  ')}`);
console.log(`  frame: avg ${result.perf.avgFrameMs}ms  p95 ${result.perf.p95FrameMs}ms  step ${result.perf.stepMs}ms  render ${result.perf.renderMs}ms  dirtyChunks ${result.perf.dirtyChunks}`);

if (updatePath) { writeFileSync(updatePath, JSON.stringify(result, null, 2)); console.log(`\nupdated baseline ${updatePath}`); }

let exit = 0;
if (comparePath) {
  const base = JSON.parse(readFileSync(comparePath, 'utf8'));
  console.log(`\ncompare vs ${comparePath}`);
  const d = result.flicker.instability - base.flicker.instability;
  const tag = d > 0.5 ? ' WORSE' : d < -0.5 ? ' better' : '';
  console.log(`  instability: ${base.flicker.instability} -> ${result.flicker.instability}  (${d >= 0 ? '+' : ''}${d.toFixed(2)})${tag}`);
  const fd = result.perf.avgFrameMs - base.perf.avgFrameMs;
  console.log(`  frame avg: ${base.perf.avgFrameMs} -> ${result.perf.avgFrameMs}ms  (${fd >= 0 ? '+' : ''}${fd.toFixed(1)})`);
}
process.exit(exit);
