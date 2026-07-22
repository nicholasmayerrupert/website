// Real-browser acid cutting benchmark. It loads the creative game with a fixed
// world seed, selects acid, and paints through the normal pointer/worker path.
// This exercises the same two-layer simulation, scheduling, replication, and
// rendering used by the site instead of only timing a synthetic engine scene.
//
//   node scripts/acid-cut-e2e.mjs

import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { getAvailablePort } from './test-port.mjs';

const PORT = await getAvailablePort();
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
});
const stop = () => {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
    else process.kill(-server.pid, 'SIGTERM');
  } catch { /* already stopped */ }
};
const waitForServer = async () => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('dev server timeout');
};

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // createSandGame samples Math.random once for its world seed. Fix that sample
  // so the generated terrain and the acid/stone contacts are reproducible.
  await page.addInitScript(() => { Math.random = () => 0x5eed1234 / 0x100000000; });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sandTest && window.__sandPerf().worldTick > 5);
  await page.evaluate(() => {
    window.__sandTest.setCreativeMaterial(0, 10); // MAT.ACID
    window.__sandTest.setDrawMode(true);
  });

  // Paint a broad cloud above the generated surface using real DOM pointer
  // events. It falls into/cuts the terrain while the worker owns simulation.
  for (let row = 0; row < 4; row++) {
    const y = 205 + row * 14;
    await page.mouse.move(360, y);
    await page.mouse.down();
    // The engine interpolates a held brush between pointer samples. A dozen
    // real moves still exercises the DOM -> worker path and paints the whole
    // stroke; 70 redundant CDP round trips per row can take minutes while the
    // software-rendered acid reaction is already saturating the browser.
    await page.mouse.move(920, y, { steps: 12 });
    await page.mouse.up();
  }

  const samples = [];
  // Six seconds is long enough for the acid to reach/cut the terrain and gives
  // a useful 24-sample p95 without making this required smoke test a soak test.
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(250);
    samples.push(await page.evaluate(() => window.__sandPerf()));
  }
  const active = samples.filter((s) => s.worldTick > samples[0].worldTick);
  const sorted = active.map((s) => s.stepMs).sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0;
  const max = sorted.at(-1) || 0;
  const minTps = Math.min(...active.map((s) => s.worldTps).filter((v) => v > 0));
  const acidLeft = await page.evaluate(() => window.__sandTest.materialCount(10));
  console.log(`fixed seed 0x5eed1234, samples ${active.length}, acid visible ${acidLeft}`);
  console.log(`worker step p95 ${p95.toFixed(2)}ms, max ${max.toFixed(2)}ms, min reported tickrate ${minTps.toFixed(1)} TPS`);
  if (active.length < 8) throw new Error('acid cutting did not collect enough active world samples');
  if (acidLeft === 0) throw new Error('acid pointer path did not reach the game');
  if (process.env.REQUIRE_BROWSER_PERF === '1') {
    if (p95 > 16.67 || minTps < 45) throw new Error('acid cutting missed its real-game performance budget');
  } else {
    console.log('performance budget diagnostic only (set REQUIRE_BROWSER_PERF=1 to enforce)');
  }
} finally {
  await browser?.close();
  stop();
}
