import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sand-scenario-test-'));
const run = (...args) => spawnSync(process.execPath, ['scripts/scenario-runner.mjs',
  '--scenario', 'placement', '--sizes', '20', '--artifacts', directory, ...args],
{ encoding: 'utf8', timeout: 10000 });
try {
  const success = run('--repeat', '2', '--profile');
  assert.equal(success.status, 0, success.stdout + success.stderr);
  const results = JSON.parse(readFileSync(join(directory, 'results.json'), 'utf8'));
  assert.equal(results.length, 2);
  for (const result of results) {
    assert.equal(result.events.length, 2);
    const moving = result.events.find((event) => event.moving);
    assert.equal(moving.bodyReplacements, 1);
    assert.equal(moving.tntCells, moving.draftCells);
    assert.equal(result.metrics.length, 2);
  }
  const profile = JSON.parse(readFileSync(join(directory, 'placement-0.cpuprofile'), 'utf8'));
  assert.ok(profile.nodes.length > 0);
  const timeout = run('--timeout-ms', '1');
  assert.equal(timeout.status, 1, timeout.stdout + timeout.stderr);
  assert.match(timeout.stderr, /Scenario stalled/);
  const failure = JSON.parse(readFileSync(join(directory, 'failure.json'), 'utf8'));
  assert.ok(failure.last.phase);
  assert.equal(failure.config.seed, 1);
  assert.equal(failure.config.engine.variant, 'production');
  assert.equal(run('--sizes', '0').status, 1);
  console.log('scenario repetitions, profiling artifacts, validation, and worker timeout pass');
} finally { rmSync(directory, { recursive: true, force: true }); }
