import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { stopDetachedProcess } from './local-vite-process.mjs';
import { getAvailablePort } from './test-port.mjs';

export async function startTestServer() {
  const port = await getAvailablePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js',
    '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: new URL('..', import.meta.url), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', launchError;
  const collect = (chunk) => { output = (output + chunk).slice(-8192); };
  server.stdout.on('data', collect);
  server.stderr.on('data', collect);
  server.on('error', (error) => { launchError = error; });
  const close = () => {
    try {
      stopDetachedProcess(server.pid);
    } catch { /* already exited */ }
  };
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (server.exitCode !== null) throw new Error(`Vite exited: ${output}`);
      try { if ((await fetch(baseURL, { signal: AbortSignal.timeout(1000) })).ok) return { baseURL, close }; } catch { /* starting */ }
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(`Vite startup timed out: ${output}`);
  } catch (error) { close(); throw error; }
}

export async function runBrowserCases(cases, selected = Object.keys(cases), contextOptions = {}) {
  for (const name of selected) assert.ok(cases[name], `Unknown case ${name}`);
  const server = await startTestServer();
  let browser;
  let failures = 0;
  const artifacts = resolve(process.env.SAND_TEST_ARTIFACTS || `.sand-artifacts/browser-${process.pid}`);
  try {
    browser = await chromium.launch({ headless: true });
    for (const name of selected) {
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, ...contextOptions[name] });
      const page = await context.newPage();
      page.on('console', (message) => { if (message.type() === 'error') console.error(message.text()); });
      page.on('pageerror', (error) => console.error(error));
      const check = (label, ok, detail = '') => {
        assert.ok(ok, `${label}${detail ? ` (${detail})` : ''}`);
        console.log(`  ok   ${label}`);
      };
      console.log(`CASE ${name}`);
      try {
        await cases[name]({ page, context, browser, baseURL: server.baseURL, check });
      } catch (error) {
        failures++;
        console.error(`FAIL ${name}: ${error.stack || error}`);
        mkdirSync(artifacts, { recursive: true });
        await page.screenshot({ path: resolve(artifacts, `${name}.png`) }).catch(() => {});
        const state = await page.evaluate(() => ({
          perf: window.__sandPerf?.(),
          timeline: document.querySelector('sand-game')?.shadowRoot
            ?.querySelector('[aria-label="Replay timeline"]')?.textContent,
        })).catch(() => null);
        writeFileSync(resolve(artifacts, `${name}.json`), JSON.stringify(state, null, 2));
      } finally { await context.close(); }
    }
  } finally {
    await browser?.close();
    server.close();
  }
  return failures;
}

export async function openSandPage(page, baseURL) {
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sandTest && window.__sandPerf?.().worldTps > 0,
    null, { timeout: 30000 });
  await page.locator('sand-game').evaluate((host) =>
    host.shadowRoot.querySelector('.sg-sim').focus({ preventScroll: true }));
}
