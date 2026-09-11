// Verify emitted content bytes, production startup/retry, deferred UI, and the
// self-contained embed against the authored content and real worker/renderer.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { GAME_CONTENT } from '../src/sand/content/catalog.js';
import { startTestServer } from './browser-harness.mjs';

const files = await readdir('dist/assets');
const binaries = files.filter(name => /^sand-content-.*\.bin$/.test(name));
assert.equal(binaries.length, 1);
const binary = await readFile(`dist/assets/${binaries[0]}`);
assert.deepEqual(binary, Buffer.from(GAME_CONTENT.packed.buffer), 'compiled packet must be byte-identical to the authoring compiler');
assert.deepEqual(await readdir('dist-embed'), ['sand-game.js'], 'embed must remain self-contained');
const server = await startTestServer({ production: true });
const browser = await chromium.launch({ headless: true });
const ready = page => page.waitForFunction(() => document.querySelector('sand-game')?._ready, null, { timeout: 60000 });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const requested = [], errors = [];
  page.on('request', request => requested.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  console.log('checking production creative startup');
  await page.goto(server.baseURL);
  await ready(page);
  assert.ok(!requested.some(url => /survivalUi-|replayPanel-|PixelifySans/.test(url)), 'creative startup must defer unused UI/font');
  console.log('creative ready; checking replay');
  const startup = await page.evaluate(() => document.querySelector('sand-game')._game.getStartupTimings());
  assert.ok(startup.backgroundready.at < startup.terrainready.at);
  assert.ok(startup.backgroundready.biomeWeights);
  await page.waitForFunction(() => document.querySelector('sand-game')._game.perfStats().actorTick > 2, null, { timeout: 10000 });
  await page.evaluate(() => document.querySelector('sand-game')._game.openReplayPanel());
  await page.getByRole('dialog', { name: 'Authority logs' }).waitFor({ state: 'visible' });
  assert.ok(requested.some(url => /replayPanel-/.test(url)), 'opening replay loads its interface');
  await page.getByRole('button', { name: 'Resume & close' }).click();
  assert.deepEqual(errors, []);
  await page.close();
  console.log('ok compiled bytes, creative milestones, and deferred replay');

  const survival = await browser.newPage();
  await survival.goto(`${server.baseURL}/game?nosave`);
  await ready(survival);
  await survival.waitForFunction(() => document.querySelector('sand-game')._game.getPlayer());
  assert.ok(await survival.evaluate(() => document.querySelector('sand-game')._game.getInventory().slots.length > 0));
  await survival.close();
  console.log('ok production survival and inventory');

  const retry = await browser.newPage();
  let allowContent = false;
  await retry.route('**/sand-content-*.bin', route => allowContent ? route.continue() : route.fulfill({ status: 200, body: 'bad content' }));
  await retry.goto(server.baseURL);
  const failure = retry.locator('sand-game').locator('.sg-init-failure');
  await failure.waitFor({ state: 'visible' });
  allowContent = true;
  await failure.getByRole('button', { name: 'Retry' }).click();
  await ready(retry);
  await retry.close();
  console.log('ok corrupt content fails visibly and retries');

  const cancel = await browser.newPage();
  const cancelledWorkers = [];
  cancel.on('worker', worker => cancelledWorkers.push(new Promise(done => worker.once('close', done))));
  await cancel.addInitScript(() => {
    window.addEventListener('sand:backgroundready', () => {
      const host = document.querySelector('sand-game');
      window.detachedSand = host;
      host.remove();
    }, { once: true });
  });
  await cancel.goto(server.baseURL);
  await cancel.waitForFunction(() => window.detachedSand && !window.detachedSand._game);
  await Promise.all(cancelledWorkers);
  assert.equal(await cancel.locator('sand-game').count(), 0);
  await cancel.close();
  console.log('ok teardown between backdrop and renderer initialization');

  const embed = await browser.newPage();
  const embedRequests = [], embedErrors = [];
  embed.on('request', request => embedRequests.push(new URL(request.url()).pathname));
  embed.on('pageerror', error => embedErrors.push(error.message));
  await embed.route('**/embed-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><sand-game mode="creative" world-seed="12345"></sand-game><script type="module" src="/standalone.js"></script>' }));
  await embed.route('**/standalone.js', route => route.fulfill({ contentType: 'text/javascript', path: resolve('dist-embed/sand-game.js') }));
  await embed.goto(`${server.baseURL}/embed-test`);
  await ready(embed);
  assert.deepEqual(embedErrors, []);
  assert.ok(!embedRequests.some(path => path.startsWith('/assets/')), 'standalone has no child asset requests');
  await embed.close();
  console.log('ok standalone embed content and inline worker');
} finally { await browser.close(); server.close(); }
