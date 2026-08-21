import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { getAvailablePort } from './test-port.mjs';

const port = await getAvailablePort();
const requestedWorkers = Math.max(1, Number(process.env.LIFE_TEST_WORKERS || 999) | 0);
const holdMs = Math.max(0, Number(process.env.LIFE_TEST_HOLD_MS || 0) | 0);
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: new URL('..', import.meta.url),
  stdio: 'ignore',
});

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch (_) {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Life search test server did not start');
}

async function numericSibling(page, label) {
  return page.getByText(label, { exact: true }).evaluate((element) => {
    const value = element.nextElementSibling?.textContent || '0';
    return Number(value.replace(/[^0-9.-]/g, '')) || 0;
  });
}

async function waitForValue(page, label, predicate) {
  for (let i = 0; i < 100; i++) {
    const value = await numericSibling(page, label);
    if (predicate(value)) return value;
    await page.waitForTimeout(100);
  }
  throw new Error(`${label} did not update`);
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/#projects`, { waitUntil: 'networkidle' });

  await page.getByLabel('Game of Life board size').scrollIntoViewIfNeeded();
  await page.getByLabel('Game of Life board size').fill('8');

  await page.getByRole('tab', { name: 'Soup' }).click();
  const workerLimit = Number(await page.getByLabel('Workers').getAttribute('max'));
  assert.ok(workerLimit >= 1 && workerLimit <= 16, 'worker input exposes the hardware-aware safety cap');
  const expectedWorkers = Math.min(workerLimit, requestedWorkers);
  await page.getByLabel('Workers').fill(String(requestedWorkers));
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  let soups = await waitForValue(page, 'Soups', (value) => value > 0);
  assert.ok(soups > 0, 'soup worker reports completed soups');
  const workers = await page.getByText('Workers', { exact: true }).last().evaluate((element) =>
    Number(element.nextElementSibling?.textContent || 0));
  assert.equal(workers, expectedWorkers, 'soup progress clamps oversized worker requests');
  assert.equal(await page.getByText('Length', { exact: true }).count(), 1);
  assert.equal(await page.getByText('Exact toroidal period', { exact: true }).count(), 1);
  soups = await waitForValue(page, 'Soups', (value) => value > soups);
  if (holdMs) {
    await page.waitForTimeout(holdMs);
    const laterSoups = await numericSibling(page, 'Soups');
    assert.ok(laterSoups > soups, 'soup count advances while the pool is running');
    soups = laterSoups;
  }
  const reportedRate = await numericSibling(page, 'Rate');
  assert.ok(reportedRate > 0, 'worker pool reports end-to-end throughput');
  const previousRunSoups = soups;
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  soups = await waitForValue(page, 'Soups', (value) => value < previousRunSoups);
  soups = await waitForValue(page, 'Soups', (value) => value > soups);
  const stopElapsedMs = await page.getByRole('button', { name: 'Stop', exact: true })
    .evaluate((button) => {
      const startedAt = performance.now();
      button.click();
      return performance.now() - startedAt;
    });
  assert.ok(stopElapsedMs < 2000, `Stop remains responsive under load (${Math.round(stopElapsedMs)} ms)`);
  const stoppedSoups = await numericSibling(page, 'Soups');
  await page.waitForTimeout(150);
  assert.equal(await numericSibling(page, 'Soups'), stoppedSoups, 'soup count stops with the pool');

  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await waitForValue(page, 'Soups', (value) => value > stoppedSoups);
  await page.getByRole('button', { name: 'Close Game of Life controls' }).click();
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: 'Open Game of Life controls' }).click();
  const closedSoups = await numericSibling(page, 'Soups');
  await page.waitForTimeout(150);
  assert.equal(await numericSibling(page, 'Soups'), closedSoups, 'closing controls stops the pool');

  await page.getByRole('tab', { name: 'Simulate' }).click();
  assert.equal(await page.getByLabel('Editable toroidal view of the current Game of Life layer').count(), 1);
  await page.getByRole('button', { name: 'Close Game of Life controls' }).click();
  await page.waitForTimeout(100);
  const canvasSizing = await page.getByRole('button', { name: 'Open Game of Life controls' }).evaluate((button) => {
    const canvas = button.parentElement?.querySelector('canvas');
    const host = canvas?.parentElement;
    return {
      canvasWidth: canvas?.getBoundingClientRect().width || 0,
      hostWidth: host?.getBoundingClientRect().width || 0,
    };
  });
  assert.ok(canvasSizing.hostWidth > 0, '3D canvas host has a width');
  assert.ok(
    Math.abs(canvasSizing.canvasWidth - canvasSizing.hostWidth) < 1,
    '3D canvas expands back to the full host width after closing controls'
  );
  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  console.log(`life soup search e2e: ${soups} soups across ${workers} workers (${reportedRate}/s)`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
