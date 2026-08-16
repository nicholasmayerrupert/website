// Browser benchmark for the expensive extreme-zoom workload. It exercises the
// real creative world worker, pans, then paints
// water while reporting sustained world TPS and worker step latency.
//
//   node scripts/bench-zoomed-out.mjs
//   node scripts/bench-zoomed-out.mjs --cols 1120 --rows 1056
//   node scripts/bench-zoomed-out.mjs --case water --pan
//   node scripts/bench-zoomed-out.mjs --case fire --pan-diagonal

import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : fallback; };
const stringFlag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? String(args[i + 1]) : fallback; };
const hasFlag = (name) => args.includes(name);
const targetCols = flag('--cols', 1120), targetRows = flag('--rows', 1056);
const selectedCase = stringFlag('--case', 'default');
const diagonalPanDuringCase = hasFlag('--pan-diagonal');
const panDuringCase = hasFlag('--pan') || diagonalPanDuringCase;
if (!['default', 'pan', 'water', 'fire', 'acid', 'all'].includes(selectedCase)) throw new Error(`unknown --case ${selectedCase}`);
const NPM = process.platform === 'win32' ? process.execPath : 'npm';
const NPM_ARGS = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : [];
const server = spawn(NPM, [...NPM_ARGS, 'run', 'dev', '--', '--port', '5181', '--strictPort'], {
  cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
});
const cleanup = async (browser, page) => {
  // Let <sand-game> terminate its worker before closing Chromium.
  await page?.evaluate(() => document.querySelector('sand-game')?.remove()).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 250));
  await Promise.race([
    page?.close({ runBeforeUnload: false }).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  await Promise.race([
    browser?.close().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (process.platform === 'win32' && server.pid) spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
  else server.kill('SIGKILL');
};
const waitForServer = async () => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) { try { if ((await fetch('http://localhost:5181/')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('dev server timeout');
};
const summarize = (samples) => {
  const values = (key) => samples.map((s) => s[key]).filter(Number.isFinite).sort((a, b) => a - b);
  const median = (a) => a.length ? a[Math.floor(a.length / 2)] : 0;
  const first = samples[0], last = samples[samples.length - 1];
  const measuredTps = first && last && last.at > first.at ? (last.worldTick - first.worldTick) * 1000 / (last.at - first.at) : 0;
  const writes = first && last ? (last.workerToolWrites || 0) - (first.workerToolWrites || 0) : 0;
  return {
    tps: +measuredTps.toFixed(2), reportedTps: +median(values('worldTps')).toFixed(2),
    stepMs: median(values('stepMs')), frameMs: median(values('avgFrameMs')),
    groundingMs: median(values('groundingMs')),
    assemblyMs: median(values('assemblyUnionMs')),
    carryMs: median(values('carryMs')), bodyMs: median(values('bodyMs')),
    sandMs: median(values('sandMs')), liquidMs: median(values('liquidMs')),
    reactMs: median(values('reactMs')), tailMs: median(values('tailMs')),
    layersMs: median(values('layersMs')), crossMs: median(values('crossMs')),
    dirtyCells: median(values('dirtyCells')),
    componentCells: median(values('componentCellCount')),
    renderMs: median(values('renderMs')), lightMs: median(values('lightMs')),
    fillMs: median(values('fillMs')), uploadMs: median(values('uploadMs')),
    mirrorApplyMs: median(values('mirrorApplyMs')),
    toolWrites: writes, toolWritesTotal: last?.workerToolWrites || 0,
  };
};

let browser, page, failure = null;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'no-preference' });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const preparePage = async (reload = false) => {
    if (reload) await page.reload({ waitUntil: 'networkidle' });
    else {
      const query = new URLSearchParams();
      await page.goto(`http://localhost:5181/fps${query.size ? `?${query}` : ''}`, { waitUntil: 'networkidle' });
    }
    await page.waitForFunction(() => window.__sandTest?.info().cols > 0 && window.__sandPerf?.().worldTick > 0, null, { timeout: 60000 });
    await page.locator('sand-game').evaluate((host) => host.shadowRoot.querySelector('.sg-sim').focus({ preventScroll: true }));
    for (let i = 0; i < 40; i++) {
      const current = await page.evaluate(() => window.__sandTest.info());
      if (current.cols >= targetCols && current.rows >= targetRows) break;
      await page.keyboard.press('-');
      await page.waitForTimeout(180);
    }
    await page.waitForFunction(() => !window.__sandPerf().workerResizePending,
      null, { timeout: 60000 });
    const warmTick = await page.evaluate(() => window.__sandPerf().worldTick);
    await page.waitForFunction((tick) => window.__sandPerf().worldTick >= tick + 8,
      warmTick, { timeout: 60000 });
    return page.evaluate(() => window.__sandTest.info());
  };
  let info = await preparePage();

  const sampleFor = async (ms) => {
    const out = [], end = Date.now() + ms;
    while (Date.now() < end) { out.push({ ...(await page.evaluate(() => window.__sandPerf())), at: Date.now() }); await page.waitForTimeout(250); }
    return out;
  };
  const sampleCase = async (ms) => {
    if (panDuringCase) {
      await page.keyboard.down('d');
      if (diagonalPanDuringCase) await page.keyboard.down('s');
    }
    try { return await sampleFor(ms); }
    finally {
      if (diagonalPanDuringCase) await page.keyboard.up('s');
      if (panDuringCase) await page.keyboard.up('d');
    }
  };
  console.log(`zoomed-out browser benchmark (${info.cols}x${info.rows}, target ${targetCols}x${targetRows})`);
  if (selectedCase === 'default' || selectedCase === 'pan' || selectedCase === 'all') {
    await page.keyboard.down('d');
    const pan = await sampleFor(5000);
    await page.keyboard.up('d');
    console.log('  pan   ', summarize(pan));
  }
  if (selectedCase === 'default' || selectedCase === 'water' || selectedCase === 'all') {
    await page.evaluate(() => {
      const { cols, rows } = window.__sandTest.info();
      // Several separated reservoirs keep a broad liquid frontier active without
      // depending on synthetic pointer timing or the palette DOM.
      for (let i = 0; i < 20; i++) window.__sandTest.paintWorker(2, Math.floor(cols * (0.25 + (i % 5) * 0.1)), Math.floor(rows * (0.12 + Math.floor(i / 5) * 0.035)), 10);
    });
    const waterSummary = summarize(await sampleCase(7000));
    console.log('  water ', waterSummary);
    if (waterSummary.toolWritesTotal <= 0) throw new Error('water stroke produced no worker tool writes');
  }
  if (hasFlag('--reactions') || selectedCase === 'fire' || selectedCase === 'acid' || selectedCase === 'all') {
    if (selectedCase === 'fire' || selectedCase === 'acid' || selectedCase === 'all') info = await preparePage(true);
    if (selectedCase !== 'acid') {
      await page.evaluate(() => window.__sandTest.seedWorkerReaction(5, 1200, 0));
      await page.waitForTimeout(250);
      console.log('  fire  ', summarize(await sampleCase(7000)));
    }
    if (selectedCase !== 'fire') {
      info = await preparePage(true);
      await page.evaluate(() => window.__sandTest.seedWorkerReaction(10, 2400, 0));
      await page.waitForTimeout(250);
      const acid = summarize(await sampleCase(7000));
      console.log('  acid  ', acid);
      if (acid.toolWritesTotal <= 0) throw new Error('acid injection produced no worker tool writes');
    }
  }
  if (errors.length) throw new Error(`browser errors:\n${errors.join('\n')}`);
} catch (error) {
  failure = error;
} finally {
  await cleanup(browser, page);
}
if (failure) console.error(failure);
// This is a standalone benchmark CLI, so finish with the scenario's explicit
// status after cleanup.
process.exit(failure ? 1 : 0);
