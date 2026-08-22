import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { npmInvocation, normalizedCwd, stopDetachedProcess } from './local-vite-process.mjs';
import { getAvailablePort } from './test-port.mjs';

const port = await getAvailablePort();
const baseURL = `http://127.0.0.1:${port}`;
const npm = npmInvocation();
const server = spawn(npm.command, [
  ...npm.args, 'run', 'dev', '--', '--host', '127.0.0.1',
  '--port', String(port), '--strictPort',
], {
  cwd: normalizedCwd(new URL('..', import.meta.url)),
  stdio: 'ignore', detached: true,
});
let browser = null;
let failures = 0;

const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
};
const stopServer = () => {
  try { stopDetachedProcess(server.pid); } catch {}
};
const waitForServer = async () => {
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    try { if ((await fetch(baseURL)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('dev server timeout');
};

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__sandReplayMicroscope && window.__sandPerf?.().worldTick > 20,
    null, { timeout: 30000 },
  );
  const initialDims = await page.evaluate(() => {
    const perf = window.__sandPerf();
    return { cols: perf.cols, rows: perf.rows };
  });
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.waitForFunction(({ cols, rows }) => {
    const perf = window.__sandPerf?.();
    return perf && (perf.cols !== cols || perf.rows !== rows);
  }, initialDims, { timeout: 30000 });
  await page.evaluate(() => document.querySelector('sand-game').shadowRoot
    .querySelector('.sg-sim').focus({ preventScroll: true }));
  await page.keyboard.press('l');
  await page.waitForFunction(() => document.querySelector('sand-game').shadowRoot
    .querySelector('textarea[aria-label="Replay capsule text"]')?.value
    .startsWith('SAND-REPLAY-3:'), null, { timeout: 30000 });
  const capsuleText = await page.evaluate(() => document.querySelector('sand-game').shadowRoot
    .querySelector('textarea[aria-label="Replay capsule text"]').value);
  const opened = await page.evaluate((text) => window.__sandReplayMicroscope.open(text), capsuleText);
  check('microscope opens at the initialized frame', opened.turn === 0 && opened.tick === 0,
    `turn ${opened.turn}, tick ${opened.tick}`);
  check('initial seek rebuilds the original grid dimensions',
    opened.cols === initialDims.cols && opened.rows === initialDims.rows,
    `${opened.cols}x${opened.rows} vs ${initialDims.cols}x${initialDims.rows}`);
  const turns = await page.evaluate(() => window.__sandReplayMicroscope.timeline().turns);
  const middle = Math.max(1, Math.floor(turns / 2));
  const middleFrame = await page.evaluate((turn) => window.__sandReplayMicroscope.seek(turn), middle);
  check('forward seek reaches an arbitrary authority turn', middleFrame.turn === middle,
    `${middleFrame.turn}/${middle}`);
  const stepped = await page.evaluate(() => window.__sandReplayMicroscope.step(1));
  check('single-step advances exactly one turn', stepped.turn === middle + 1,
    `${middle} -> ${stepped.turn}`);
  const rewound = await page.evaluate(() => window.__sandReplayMicroscope.seek(2));
  check('backward seek reconstructs an earlier frame', rewound.turn === 2,
    String(rewound.turn));
  const cell = await page.evaluate(() => {
    const frame = window.__sandReplayMicroscope.frame();
    return window.__sandReplayMicroscope.inspectCell(
      frame.worldOffset.x + Math.floor(frame.camera.x),
      frame.worldOffset.y + Math.floor(frame.camera.y),
    );
  });
  check('cell inspection reports both simulated layers',
    cell?.inside && cell.layers?.length === 2, JSON.stringify(cell));
  const endpoint = await page.evaluate((turn) => window.__sandReplayMicroscope.seek(turn), turns);
  const exact = await page.evaluate(() => {
    const microscope = window.__sandReplayMicroscope;
    const frame = microscope.frame();
    const timeline = microscope.timeline();
    const overlay = document.querySelector('sand-game').shadowRoot
      .querySelector('[data-replay-microscope-overlay]');
    return {
      endpoint: frame.replayState,
      turns: timeline.turns,
      markerArray: Array.isArray(timeline.markers),
      overlay: !!overlay && overlay.width > 0 && overlay.height > 0,
    };
  });
  const expected = await page.evaluate(async (text) => {
    const { decodeReplayCapsule } = await import('/src/sand/game/replayCapsule.js');
    return (await decodeReplayCapsule(text)).final;
  }, capsuleText);
  const fields = [
    'tick', 'actorTick', 'gridHash', 'worldOffsetX', 'worldOffsetY',
    'cols', 'rows', 'componentCount', 'componentCellCount', 'crossBondCount',
    'playerCount', 'itemCount', 'creatureCount', 'projectileCount',
  ];
  check('endpoint seek reproduces the captured authority state',
    endpoint.turn === turns && fields.every((field) => exact.endpoint[field] === expected[field]),
    `${endpoint.turn}/${turns}, hash ${exact.endpoint.gridHash}/${expected.gridHash}`);
  check('timeline exposes markers and a screenshot-visible overlay',
    exact.markerArray && exact.overlay);
} catch (error) {
  console.error(error);
  failures++;
} finally {
  await browser?.close().catch(() => {});
  stopServer();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
