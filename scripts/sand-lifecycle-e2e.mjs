// Browser regression for <sand-game> ownership: the same custom-element
// instance can disconnect/reconnect, final teardown releases the canvas target
// and shared WebGL context, and a transient WASM load failure exposes a retry.

import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { getAvailablePort } from './test-port.mjs';

const PORT = await getAvailablePort();
const baseURL = `http://127.0.0.1:${PORT}/game`;
const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
});
const killServer = () => {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
    else process.kill(-server.pid, 'SIGKILL');
  } catch { /* already gone */ }
};
const waitForServer = () => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('dev server timeout')), 60000);
  const poll = setInterval(async () => {
    try {
      if ((await fetch(baseURL)).ok) {
        clearTimeout(timeout);
        clearInterval(poll);
        resolve();
      }
    } catch { /* server is still starting */ }
  }, 300);
});

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
};

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });

  console.log('sand-game reconnect + WebGL cleanup');
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(baseURL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sandTest?.sharedGlContexts?.() === 1, null, { timeout: 30000 });

  for (let cycle = 1; cycle <= 5; cycle++) {
    const detached = await page.evaluate(() => {
      const host = document.querySelector('sand-game');
      const parent = host.parentNode;
      const next = host.nextSibling;
      const canvas = host.shadowRoot.getElementById('sand-main');
      const contextCount = window.__sandTest.sharedGlContextProbe();
      host.remove();
      window.__sandLifecycleDetached = { host, parent, next, canvas, contextCount };
      return true;
    });
    check(`cycle ${cycle} detached`, detached);
    await page.waitForTimeout(50);
    const cleaned = await page.evaluate(() => ({
      contexts: window.__sandLifecycleDetached.contextCount(),
      targetRemoved: window.__sandLifecycleDetached.canvas.__sandGlKey === undefined,
    }));
    check(`cycle ${cycle} released shared context`, cleaned.contexts === 0, String(cleaned.contexts));
    check(`cycle ${cycle} unregistered canvas target`, cleaned.targetRemoved);

    await page.evaluate(() => {
      const { host, parent, next } = window.__sandLifecycleDetached;
      parent.insertBefore(host, next);
    });
    await page.waitForFunction(() => window.__sandTest?.sharedGlContexts?.() === 1, null, { timeout: 30000 });
    const remounted = await page.evaluate(() => {
      const host = document.querySelector('sand-game');
      return {
        canvas: !!host.shadowRoot.getElementById('sand-main'),
        styles: host.shadowRoot.querySelectorAll('style[data-sand-host-style]').length,
        sims: host.shadowRoot.querySelectorAll('.sg-sim').length,
      };
    });
    check(`cycle ${cycle} remounted the same shadow root`, remounted.canvas && remounted.styles === 1 && remounted.sims === 1,
      `${remounted.styles} styles, ${remounted.sims} sims`);
  }
  check('reconnects produce no page exceptions', pageErrors.length === 0, pageErrors.join('; '));
  await page.close();

  console.log('\ninitialization failure + retry');
  const retryPage = await browser.newPage();
  let wasmRequests = 0;
  let allowWasm = false;
  await retryPage.route('**/*.wasm*', async (route) => {
    wasmRequests++;
    if (!allowWasm) await route.abort('failed');
    else await route.continue();
  });
  await retryPage.goto(baseURL, { waitUntil: 'load' });
  const failure = retryPage.locator('sand-game').locator('.sg-init-failure');
  await failure.waitFor({ state: 'visible', timeout: 30000 });
  check('failed initialization is visible', await failure.isVisible());
  check('failure offers Retry', await failure.getByRole('button', { name: 'Retry' }).isVisible());
  allowWasm = true;
  await failure.getByRole('button', { name: 'Retry' }).click();
  await retryPage.waitForFunction(() => window.__sandTest?.sharedGlContexts?.() === 1, null, { timeout: 30000 });
  check('Retry starts a fresh WASM attempt', wasmRequests >= 2, String(wasmRequests));
  check('failure UI clears after recovery', await failure.count() === 0);
  await retryPage.close();
} finally {
  await browser?.close().catch(() => {});
  killServer();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
