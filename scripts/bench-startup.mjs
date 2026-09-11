// Production startup: cold browser per sample, compressed shared-bandwidth HTTP,
// fixed seeds, real biome/terrain milestones, and a worker-confirmed paint action.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { cpus, platform, arch } from 'node:os';
import { chromium } from 'playwright';
import { MAT } from '../src/sand/materials.js';

const args = process.argv.slice(2);
const flag = key => args.includes(key) ? args[args.indexOf(key) + 1] : null;
const root = resolve(flag('--site') || 'dist');
const repeats = Number(flag('--repeat') || 2);
assert.ok(Number.isInteger(repeats) && repeats > 0);
const seeds = [0xc0ffee, 12345, 987654321];
const profiles = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, mbps: 20, latency: 40 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, mbps: 5, latency: 80 },
};
const only = (flag('--only') || 'desktop,mobile').split(',');
only.forEach(name => assert.ok(profiles[name], `unknown profile ${name}`));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const assets = new Map();
async function collect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) { await collect(path); continue; }
    const raw = await readFile(path);
    const compressed = /\.(html|js|css|wasm|bin|svg)$/.test(path);
    assets.set('/' + path.slice(root.length + 1).replaceAll('\\', '/'), {
      body: compressed ? brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }) : raw,
      compressed, rawBytes: raw.length, type: mime[extname(path)] || 'application/octet-stream',
    });
  }
}
await collect(root);
let profile, requests, streams = [];
// Apply one shared download budget to page and worker requests alike.
const pump = setInterval(() => {
  let budget = (profile?.mbps || 20) * 125000 * .01;
  streams = streams.filter(s => !s.response.destroyed && s.offset < s.body.length);
  for (const s of streams) {
    const size = Math.min(Math.ceil(budget / streams.length), s.body.length - s.offset);
    s.response.write(s.body.subarray(s.offset, s.offset + size)); s.offset += size;
    if (s.offset === s.body.length) s.response.end();
  }
}, 10);
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  const asset = assets.get(path);
  if (!asset) { response.writeHead(404).end(); return; }
  requests.push({ path, bytes: asset.body.length, decodedBytes: asset.rawBytes });
  setTimeout(() => {
    if (response.destroyed) return;
    response.writeHead(200, {
      'content-type': asset.type, 'content-length': asset.body.length,
      'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...(asset.compressed ? { 'content-encoding': 'br' } : {}),
    });
    streams.push({ response, body: asset.body, offset: 0 });
  }, profile.latency);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;
const results = { version: 1, environment: { cpu: cpus()[0].model, platform: platform(), arch: arch(), angle: flag('--angle') || 'default' }, config: { repeats, seeds, profiles: Object.fromEntries(only.map(k => [k, profiles[k]])), compression: 'brotli-6', cache: 'fresh-browser-per-sample' }, samples: [], summary: {} };
try {
  for (const name of only) for (let run = 0; run < repeats; run++) for (const seed of seeds) {
    profile = profiles[name]; requests = [];
    const browser = await chromium.launch({ headless: true, args: flag('--angle') ? [`--use-angle=${flag('--angle')}`] : [] });
    try {
      results.environment.browser = browser.version();
      const { mbps, latency, ...device } = profile;
      const page = await browser.newPage(device);
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(({ seed }) => {
        const audit = window.__startupAudit = { longTasks: [], milestones: {}, edges: 0 };
        new PerformanceObserver(list => { for (const e of list.getEntries()) audit.longTasks.push({ at: e.startTime, duration: e.duration }); }).observe({ type: 'longtask', buffered: true });
        for (const name of ['backgroundready', 'terrainready', 'ready']) window.addEventListener(`sand:${name}`, event => {
          audit.milestones[name] ||= { at: performance.now(), detail: event.detail };
        });
        const define = customElements.define.bind(customElements);
        customElements.define = (name, ctor, options) => {
          if (name === 'sand-game') {
            const connected = ctor.prototype.connectedCallback;
            ctor.prototype.connectedCallback = function () { this.setAttribute('world-seed', String(seed)); return connected.call(this); };
          }
          return define(name, ctor, options);
        };
        const WorkerBase = window.Worker;
        window.Worker = class extends WorkerBase {
          constructor(...args) {
            super(...args); audit.workerStarted = performance.now();
            this.addEventListener('message', event => {
              const data = event.data;
              if (data.type === 'full' && !audit.snapshot) {
                const bytes = new Uint8Array(data.data); let hash = 2166136261;
                for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
                audit.snapshot = { at: performance.now(), bytes: bytes.length, hash: hash >>> 0, cols: data.cols, rows: data.rows, x: data.worldOffsetX, y: data.worldOffsetY };
              }
              audit.edges = Math.max(audit.edges, data.perf?.edgesProcessed || 0);
            });
          }
        };
      }, { seed });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__startupAudit.milestones.terrainready, null, { timeout: 60000 });
      const downloads = [...requests];
      const metrics = await page.evaluate(() => {
        const audit = window.__startupAudit;
        const host = document.querySelector('sand-game');
        const gl = host.shadowRoot.getElementById('sand-main').getContext('webgl2');
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return { ...audit, startup: host._game.getStartupTimings(), renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
      });
      if (profile.isMobile) await page.locator('sand-game').locator('.sg-start').click();
      await page.evaluate(sand => {
        const game = document.querySelector('sand-game')._game;
        game.setAudioEnabled(false); game.setCreativeMaterial(0, sand);
      }, MAT.SAND);
      const actionStart = Date.now();
      await page.mouse.move(profile.viewport.width * .55, profile.viewport.height * .14);
      await page.mouse.down();
      await page.waitForTimeout(250);
      await page.mouse.move(profile.viewport.width * .6, profile.viewport.height * .16, { steps: 5 });
      await page.mouse.up();
      await page.waitForFunction(() => window.__startupAudit.edges >= 2, null, { timeout: 10000 });
      await page.mouse.up();
      assert.deepEqual(errors, [], 'browser exceptions');
      const background = metrics.startup.backgroundready;
      assert.equal(background.seed, seed);
      assert.ok(background.biomeWeights && Math.abs(background.biomeWeights.reduce((a, b) => a + b, 0) - 1) < 1e-6);
      assert.ok(metrics.snapshot?.bytes > 0, 'nonempty first authority snapshot');
      const sample = { profile: name, run, seed, backgroundMs: background.at, terrainMs: metrics.startup.terrainready.at,
        actionMs: Date.now() - actionStart, bytes: downloads.reduce((n, r) => n + r.bytes, 0),
        blockingMs: metrics.longTasks.filter(e => e.at < metrics.startup.terrainready.at).reduce((n, e) => n + Math.max(0, e.duration - 50), 0),
        ...metrics, downloads };
      results.samples.push(sample);
      console.log(`${name} seed=${seed} background=${sample.backgroundMs.toFixed(0)}ms terrain=${sample.terrainMs.toFixed(0)}ms transfer=${(sample.bytes / 1024).toFixed(0)}KiB input=verified`);
    } finally { await browser.close(); streams = []; }
  }
  for (const name of only) {
    const samples = results.samples.filter(s => s.profile === name);
    const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
    results.summary[name] = Object.fromEntries(['backgroundMs', 'terrainMs', 'blockingMs', 'bytes'].map(key => [key, { median: percentile(samples.map(s => s[key]), .5), worst: Math.max(...samples.map(s => s[key])) }]));
  }
  if (flag('--compare')) {
    const before = JSON.parse(readFileSync(flag('--compare'), 'utf8'));
    assert.deepEqual(results.environment, before.environment, 'compare on the same host/browser/renderer');
    assert.deepEqual(results.config, before.config, 'compare identical benchmark settings');
    for (const sample of results.samples) {
      const old = before.samples.find(s => s.profile === sample.profile && s.seed === sample.seed && s.run === sample.run);
      assert.equal(sample.renderer, old.renderer, 'compare the same graphics renderer');
      assert.deepEqual(sample.snapshot && { ...sample.snapshot, at: 0 }, old.snapshot && { ...old.snapshot, at: 0 }, 'initial world must match');
      assert.deepEqual({ ...sample.startup.backgroundready, at: 0 }, { ...old.startup.backgroundready, at: 0 }, 'initial camera and biome must match');
    }
    results.changePercent = Object.fromEntries(only.map(name => [name, Object.fromEntries(Object.entries(results.summary[name]).map(([key, value]) => [key, +((value.median / before.summary[name][key].median - 1) * 100).toFixed(1)]))]));
    console.log('Median change (%)', JSON.stringify(results.changePercent));
    const target = flag('--target') === null ? -10 : Number(flag('--target'));
    assert.ok(Number.isFinite(target) && target >= -100 && target < 100);
    for (const name of only) for (const key of ['backgroundMs', 'terrainMs'])
      assert.ok(results.changePercent[name][key] <= -target,
        `${name} ${key}: expected at least ${target}% improvement (negative permits regression)`);
  }
  console.log(JSON.stringify(results.summary, null, 2));
} finally {
  clearInterval(pump); server.closeAllConnections(); await new Promise(done => server.close(done));
  if (flag('--json')) { mkdirSync(dirname(resolve(flag('--json'))), { recursive: true }); writeFileSync(flag('--json'), JSON.stringify(results, null, 2) + '\n'); }
}
