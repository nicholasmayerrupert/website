// A stone slab released by burning timber must fall without a solver launch.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { startTestServer } from './browser-harness.mjs';
import { decodeReplayCapsule } from '../src/sand/game/replayCapsule.js';

const capsule = await decodeReplayCapsule(readFileSync(
  new URL('./rigid-burning-support.sand-replay', import.meta.url), 'utf8'));
const artifacts = resolve(process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts/burning-support');
mkdirSync(artifacts, { recursive: true });
const server = await startTestServer();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
  await page.goto(server.baseURL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sandReplayMicroscope);
  await page.evaluate((value) => window.__sandReplayMicroscope.open(value), capsule);
  const samples = await page.evaluate(async (end) => {
    const result = [];
    for (let turn = 950; turn <= end; turn++) {
      const frame = await window.__sandReplayMicroscope.seek(turn);
      // Burning can split or rebuild the joint body, changing its id.
      const slab = frame.bodies.find((b) => b.layer === 0 && b.state.nPts > 2000);
      result.push({ turn, slab, solver: frame.solver });
    }
    return result;
  }, capsule.turns);
  writeFileSync(join(artifacts, 'motion.json'), JSON.stringify(samples, null, 2));
  const released = samples.filter((s) => s.slab);
  assert.ok(released.length > 200, 'the replay exercises the released stone slab');
  const first = released[0].slab;
  const last = released.at(-1).slab;
  const peakRise = first.worldY - Math.min(...released.map((s) => s.slab.worldY));
  let peakUpwardStep = 0;
  for (let i = 1; i < released.length; i++)
    peakUpwardStep = Math.max(peakUpwardStep,
      released[i - 1].slab.worldY - released[i].slab.worldY);
  const summary = { samples: released.length, peakRise, peakUpwardStep,
    fall: last.worldY - first.worldY, finalCells: last.state.nPts };
  console.log(JSON.stringify(summary, null, 2));
  assert.ok(peakRise <= 2, `support loss cannot launch the slab upward (${peakRise} cells)`);
  assert.ok(peakUpwardStep <= 1,
    `collision response cannot jump the slab upward (${peakUpwardStep} cells/tick)`);
  assert.ok(summary.fall > 20, 'the unsupported slab continues falling');
  assert.ok(released.every((s) => s.slab.state.nPts >= 2300),
    'the stone survives the burning support and fall');
  // Ownership is checked during the slab's motion; unrelated tiny burning
  // fragments can share lattice cells after the slab has baked into terrain.
  for (const sample of released)
    assert.equal(sample.solver.ownershipConflicts, 0, `ownership at turn ${sample.turn}`);
  for (const sample of samples) {
    assert.equal(sample.solver.rasterProjectionFailures, 0, `raster at turn ${sample.turn}`);
  }
} finally {
  await browser?.close();
  server.close();
}
