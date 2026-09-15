// The recorded joint roof must settle without correction-driven jumps.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { startTestServer } from './browser-harness.mjs';
import { rigidCorrectionStages } from './rigid-motion-metrics.mjs';
import { decodeReplayCapsule } from '../src/sand/game/replayCapsule.js';

const capsule = await decodeReplayCapsule(readFileSync(
  new URL('./rigid-roof-motion.sand-replay', import.meta.url), 'utf8'));
// Extra quiet turns allow a corrected trajectory to reach rest.
capsule.turns += 240;
const artifacts = resolve(process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts/roof-motion');
mkdirSync(artifacts, { recursive: true });
const server = await startTestServer();
let browser;
const frames = [];
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
  await page.goto(server.baseURL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sandReplayMicroscope);
  await page.evaluate((value) => window.__sandReplayMicroscope.open(value, {
    body: { layer: 0, id: 15 }, traceBody: { layer: 0, id: 15 }, focus: 'body',
  }), capsule);
  for (let turn = 745; turn <= 840; turn++) {
    const frame = await page.evaluate((target) => window.__sandReplayMicroscope.seek(target), turn);
    frames.push(frame);
    if (turn === 765 || turn === 766)
      await page.locator('sand-game').locator('.sg-sim').screenshot({
        path: join(artifacts, `tick-${frame.tick}.png`),
      });
  }
  const end = await page.evaluate((target) => window.__sandReplayMicroscope.seek(target), capsule.turns);
  writeFileSync(join(artifacts, 'frames.json'), JSON.stringify({ frames, end }));
  await page.locator('sand-game').locator('.sg-sim').screenshot({ path: join(artifacts, 'settled.png') });

  const samples = frames.flatMap((frame) => {
    const body = frame.bodies.find((b) => b.layer === 0 && b.id === 15);
    if (!body || !(frame.trace.mask & (1 << 6))) return [];
    const stages = rigidCorrectionStages(frame.trace, 0, body.state.maxR);
    return [{ turn: frame.turn, tick: frame.tick, body, stages,
      correction: Object.values(stages).reduce((a, b) => a + b, 0) }];
  });
  assert.ok(samples.length >= 15, 'fixture exercises the detached roof for multiple ticks');
  const maxCorrection = Math.max(...samples.map((s) => s.correction));
  const first = samples[0].body;
  const last = samples.at(-1).body;
  const travel = Math.hypot(last.worldX - first.worldX, last.worldY - first.worldY);
  const summary = { samples: samples.length, maxCorrection, travel,
    worst: samples.reduce((a, b) => a.correction > b.correction ? a : b),
    endBodies: end.bodies.map((b) => ({ layer: b.layer, id: b.id, cells: b.state.nPts, awake: b.awake })) };
  writeFileSync(join(artifacts, 'motion.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  assert.ok(maxCorrection <= 0.75, `correction travel stays below 0.75 cells (${maxCorrection})`);
  assert.ok(travel > 0.5, `roof continues moving (${travel} cells)`);
  for (const frame of frames) {
    assert.equal(frame.solver.ownershipConflicts, 0, `ownership at tick ${frame.tick}`);
    assert.equal(frame.solver.rasterProjectionFailures, 0, `raster assignment at tick ${frame.tick}`);
    for (const body of frame.bodies.filter((b) => b.id === 15))
      assert.equal(body.terrainBlocked, false, `roof terrain clearance at tick ${frame.tick}, layer ${body.layer}`);
  }
  assert.ok(!end.bodies.some((b) => b.state.nPts >= 100 && b.awake),
    'roof and any substantial fragments reach rest or bake');
  assert.ok(end.replayState.componentCellCount > frames[0].replayState.componentCellCount + 2000,
    'roof material survives as settled structure');
  assert.equal(end.actorTick, capsule.turns, 'authority completes the extended replay');
} finally {
  await browser?.close();
  server.close();
}
