// Browser benchmark for the expensive extreme-zoom workload. It exercises the
// real creative world worker (including nested WASM pthreads), pans, then paints
// water while reporting sustained world TPS and worker step latency.
//
//   node scripts/bench-zoomed-out.mjs
//   node scripts/bench-zoomed-out.mjs --cols 1120 --rows 1056

import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : fallback; };
const targetCols = flag('--cols', 1120), targetRows = flag('--rows', 1056);
const NPM = process.platform === 'win32' ? process.execPath : 'npm';
const NPM_ARGS = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : [];
const server = spawn(NPM, [...NPM_ARGS, 'run', 'dev', '--', '--port', '5181', '--strictPort'], {
  cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
});
const cleanup = async (browser) => {
  await browser?.close().catch(() => {});
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
  return { tps: +measuredTps.toFixed(2), reportedTps: +median(values('worldTps')).toFixed(2), stepMs: median(values('stepMs')), frameMs: median(values('avgFrameMs')), toolWrites: writes, toolWritesTotal: last?.workerToolWrites || 0 };
};

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:5181/fps', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sandTest?.info().cols > 0 && window.__sandPerf?.().worldTick > 0, null, { timeout: 60000 });

  for (let i = 0; i < 40; i++) {
    const info = await page.evaluate(() => window.__sandTest.info());
    if (info.cols >= targetCols && info.rows >= targetRows) break;
    await page.keyboard.press('-');
    await page.waitForTimeout(180);
  }
  await page.waitForTimeout(3000);
  const info = await page.evaluate(() => window.__sandTest.info());

  const sampleFor = async (ms) => {
    const out = [], end = Date.now() + ms;
    while (Date.now() < end) { out.push({ ...(await page.evaluate(() => window.__sandPerf())), at: Date.now() }); await page.waitForTimeout(250); }
    return out;
  };
  await page.keyboard.down('d');
  const pan = await sampleFor(5000);
  await page.keyboard.up('d');

  await page.evaluate(() => {
    const { cols, rows } = window.__sandTest.info();
    // Several separated reservoirs keep a broad liquid frontier active without
    // depending on synthetic pointer timing or the palette DOM.
    for (let i = 0; i < 20; i++) window.__sandTest.paintWorker(2, Math.floor(cols * (0.25 + (i % 5) * 0.1)), Math.floor(rows * (0.12 + Math.floor(i / 5) * 0.035)), 10);
  });
  const water = await sampleFor(7000);

  console.log(`zoomed-out browser benchmark (${info.cols}x${info.rows}, target ${targetCols}x${targetRows})`);
  console.log('  pan   ', summarize(pan));
  const waterSummary = summarize(water);
  console.log('  water ', waterSummary);
  if (waterSummary.toolWritesTotal <= 0) throw new Error('water stroke produced no worker tool writes');
  if (errors.length) throw new Error(`browser errors:\n${errors.join('\n')}`);
} finally {
  await cleanup(browser);
}
