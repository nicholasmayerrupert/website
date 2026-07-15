import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 4187;
const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)], {
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
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

  const open = page.getByRole('button', { name: 'Open Game of Life controls' });
  await open.scrollIntoViewIfNeeded();
  await open.click();
  await page.getByLabel('Game of Life board size').fill('8');

  await page.getByRole('tab', { name: 'Soup' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const soups = await waitForValue(page, 'Soups', (value) => value > 0);
  assert.ok(soups > 0, 'soup worker reports completed soups');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();

  await page.getByRole('tab', { name: 'Reverse' }).click();
  await page.getByLabel('Binary seed').fill('0'.repeat(64));
  await page.getByLabel('Workers').fill('1');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const jobs = await waitForValue(page, 'SAT jobs started', (value) => value > 0);
  assert.ok(jobs > 0, 'extension portfolio reports a SAT job');
  await page.getByText(/^Verified \+/).waitFor({ timeout: 10000 });
  assert.equal((await page.getByLabel('Binary output').inputValue()).length, 64, 'output preserves board size');

  await page.getByRole('tab', { name: 'Simulate' }).click();
  assert.equal(await page.getByLabel('Editable top layer of the Game of Life simulation').count(), 1);
  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  console.log(`life search e2e: ${soups} soups and a verified SAT extension observed`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
