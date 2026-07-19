import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 4187;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)], {
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
  await page.getByLabel('Workers').fill('9');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const soups = await waitForValue(page, 'Soups', (value) => value > 0);
  assert.ok(soups > 0, 'soup worker reports completed soups');
  const workers = await page.getByText('Workers', { exact: true }).last().evaluate((element) =>
    Number(element.nextElementSibling?.textContent || 0));
  assert.equal(workers, 9, 'soup progress supports and aggregates more than eight workers');
  assert.equal(await page.getByText('Length', { exact: true }).count(), 1);
  assert.equal(await page.getByText('Repeat period', { exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();

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
  console.log(`life soup search e2e: ${soups} soups observed across ${workers} workers`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
