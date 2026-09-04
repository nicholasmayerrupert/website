// Browser regression for <sand-game> ownership: the same custom-element
// instance can disconnect/reconnect, final teardown releases the canvas target
// and shared WebGL context, and a transient WASM load failure exposes a retry.

import { chromium } from 'playwright';
import { startTestServer } from './browser-harness.mjs';

const { baseURL: origin, close: stopServer } = await startTestServer();
const baseURL = `${origin}/game?sandbox`;
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
};

let browser;
try {
  browser = await chromium.launch({ headless: true });

  console.log('worker teardown during startup');
  const racePage = await browser.newPage();
  const raceErrors = [];
  racePage.on('pageerror', (error) => raceErrors.push(error.message));
  let resolveWorkerStarted;
  let resolveWorkerClosed;
  const workerStarted = new Promise((resolve) => { resolveWorkerStarted = resolve; });
  const workerClosed = new Promise((resolve) => { resolveWorkerClosed = resolve; });
  racePage.once('worker', (worker) => {
    worker.once('close', resolveWorkerClosed);
    resolveWorkerStarted(worker);
  });
  const navigation = racePage.goto(baseURL, { waitUntil: 'load' });
  await workerStarted;
  await racePage.evaluate(() => {
    const host = document.querySelector('sand-game');
    const canvas = host.shadowRoot.getElementById('sand-main');
    const contextCount = window.__sandTest.sharedGlContextProbe();
    host.remove();
    window.__sandStartupTeardown = { canvas, contextCount };
  });
  await navigation;
  const workerDidClose = await Promise.race([
    workerClosed.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
  ]);
  check('startup worker closes after its host is removed', workerDidClose);
  const startupCleanup = await racePage.evaluate(() => ({
    contexts: window.__sandStartupTeardown.contextCount(),
    targetRemoved: window.__sandStartupTeardown.canvas.__sandGlKey === undefined,
  }));
  check('startup teardown releases the shared context', startupCleanup.contexts === 0, String(startupCleanup.contexts));
  check('startup teardown unregisters the canvas target', startupCleanup.targetRemoved);
  check('startup teardown produces no page exceptions', raceErrors.length === 0, raceErrors.join('; '));
  await racePage.close();

  const guardBrowserPrototypes = async (targetPage) => {
    await targetPage.addInitScript(() => {
      const webgl = WebGLRenderingContext.prototype;
      const webgl2 = WebGL2RenderingContext.prototype;
      const snapshot = {
        bufferData: webgl.bufferData,
        uniform4fv: webgl.uniform4fv,
        texSubImage2D: webgl.texSubImage2D,
        readPixels: webgl.readPixels,
        bufferData2: webgl2.bufferData,
        texSubImage2D2: webgl2.texSubImage2D,
        readPixels2: webgl2.readPixels,
        decode: TextDecoder.prototype.decode,
      };
      window.__sandBrowserPrototypesUnchanged = () =>
        webgl.bufferData === snapshot.bufferData
        && webgl.uniform4fv === snapshot.uniform4fv
        && webgl.texSubImage2D === snapshot.texSubImage2D
        && webgl.readPixels === snapshot.readPixels
        && webgl2.bufferData === snapshot.bufferData2
        && webgl2.texSubImage2D === snapshot.texSubImage2D2
        && webgl2.readPixels === snapshot.readPixels2
        && TextDecoder.prototype.decode === snapshot.decode;
    });
  };

  console.log('sand-game reconnect + WebGL cleanup');
  const page = await browser.newPage();
  await guardBrowserPrototypes(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(baseURL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sandTest?.sharedGlContexts?.() === 1, null, { timeout: 30000 });
  check('sand initialization leaves browser prototypes unchanged',
    await page.evaluate(() => window.__sandBrowserPrototypesUnchanged()));

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

  console.log('\nsand + Three.js coexistence');
  const coexistPage = await browser.newPage();
  await guardBrowserPrototypes(coexistPage);
  const coexistErrors = [];
  coexistPage.on('pageerror', (error) => coexistErrors.push(error.message));
  await coexistPage.goto(`${origin}/#projects`, { waitUntil: 'load' });
  await coexistPage.waitForFunction(() => {
    const sandCanvas = document.querySelector('sand-game')?.shadowRoot
      ?.getElementById('sand-main');
    const lifeCanvas = document.querySelector('.life-showcase__visual canvas');
    return !!sandCanvas && !!lifeCanvas
      && window.__sandTest?.sharedGlContexts?.() === 1;
  }, null, { timeout: 30000 });
  check('sand and Three.js both create canvases', true);
  check('coexisting renderers leave browser prototypes unchanged',
    await coexistPage.evaluate(() => window.__sandBrowserPrototypesUnchanged()));
  check('coexisting renderers produce no page exceptions',
    coexistErrors.length === 0, coexistErrors.join('; '));
  await coexistPage.close();

  console.log('\ninitialization failure + retry');
  const retryPage = await browser.newPage();
  await guardBrowserPrototypes(retryPage);
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
  stopServer();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
