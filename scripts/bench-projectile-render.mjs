// Main-thread projectile lighting with unchanged terrain, including offscreen casts.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startTestServer } from './browser-harness.mjs';

const args = process.argv.slice(2);
const flag = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const frames = Number(flag('--frames') || 180);
const server = await startTestServer();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('**/projectile-render-fixture', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><body></body>',
  }));
  await page.goto(`${server.baseURL}/projectile-render-fixture`);
  const result = await page.evaluate(async frames => {
    const [{ initSandWasm, createEngineWasm, MAT }, { OFF, STRIDES, PROJECTILE_KIND }] = await Promise.all([
      import('/src/sand/wasmBridge/engineFactory.js'), import('/src/sand/wasmBridge/abi.generated.js'),
    ]);
    await initSandWasm();
    const engine = createEngineWasm({ cols: 1024, rows: 512, infinite: false,
      sinksOn: false, storageRole: 'presentation', worldSeed: 7 });
    const canvas = document.createElement('canvas');
    canvas.width = 912; canvas.height = 512; document.body.append(canvas);
    engine.glInit(canvas); engine.glResize(912, 512);
    engine.setViewport(2, 1, 456, 256); engine.cameraSet(284, 128);
    engine.glSetFlags(false, false, true); engine.setSkyLight(90);
    for (const layer of [0, 1]) {
      for (let x = 0; x < 1024; x++) engine.paintDiscLayer(layer, x, 320, 0, MAT.STONE, true);
      engine.syncComponentsLayer(layer);
    }
    engine.glSetPlayers(true, new Float32Array(0), 0);
    const gl = canvas.getContext('webgl2');
    let uploaded = 0;
    const upload = gl.texSubImage2D.bind(gl);
    gl.texSubImage2D = (...args) => { uploaded += args[4] * args[5]; return upload(...args); };
    const summary = values => {
      values.sort((a, b) => a - b);
      return { p50: values[Math.floor(values.length * .5)], p95: values[Math.floor(values.length * .95)],
        p99: values[Math.floor(values.length * .99)], max: values.at(-1) };
    };
    const results = {};
    try {
      for (const scene of ['idle', 'arrow', 'round', 'offscreen', 'separated', 'volley']) {
        engine.glSetProjectiles(new Float32Array(0)); engine.glRenderFrame(true);
        const hash = engine.gridHash(), timings = [], light = [], texels = [];
        let maxPixelDelta = 0;
        for (let frame = 0; frame < frames; frame++) {
          await new Promise(requestAnimationFrame);
          const count = scene === 'idle' ? 0 : scene === 'volley' ? 12 : scene === 'separated' ? 2 : 1;
          const data = new Float32Array(count * STRIDES.projectileSnapshot);
          for (let i = 0; i < count; i++) {
            const values = { id: i + 1, kind: scene === 'arrow' ? PROJECTILE_KIND.ARROW : PROJECTILE_KIND.BLAST_ROUND,
              x: scene === 'offscreen' ? 60 + frame % 60 : scene === 'separated' && i === 1 ? 930 : 350 + i * 22 + frame % 90,
              y: 270 - i * 4, vx: 1, vy: 0, charge: 1, life: 100 };
            for (const [key, value] of Object.entries(values)) data[i * STRIDES.projectileSnapshot + OFF.projectileSnapshot[key]] = value;
          }
          uploaded = 0;
          const start = performance.now();
          engine.glSetProjectiles(data); engine.glRenderFrame(false);
          timings.push(performance.now() - start); light.push(engine.getPerf().lightMs); texels.push(uploaded);
          if (frame === frames - 1) {
            const actual = engine.glReadPixels(0, 0, 912, 512);
            engine.glRenderFrame(true);
            const expected = engine.glReadPixels(0, 0, 912, 512);
            for (let i = 0; i < actual.length; i++) maxPixelDelta = Math.max(maxPixelDelta, Math.abs(actual[i] - expected[i]));
          }
        }
        results[scene] = { renderMs: summary(timings), lightMs: summary(light), uploadedTexels: summary(texels),
          maxPixelDelta, terrainUnchanged: engine.gridHash() === hash };
      }
    } finally { engine.destroy(); canvas.remove(); }
    return { frames, scenes: results };
  }, frames);
  for (const [name, scene] of Object.entries(result.scenes)) {
    console.log(name, JSON.stringify(scene));
    assert.ok(scene.terrainUnchanged, `${name}: terrain changed`);
    assert.equal(scene.maxPixelDelta, 0, `${name}: differs from full lighting`);
  }
  if (flag('--json')) writeFileSync(flag('--json'), JSON.stringify(result, null, 2) + '\n');
  if (flag('--compare')) {
    const before = JSON.parse(readFileSync(flag('--compare'), 'utf8'));
    assert.equal(result.frames, before.frames);
    for (const [name, scene] of Object.entries(result.scenes)) console.log(`${name}: render p95 ${before.scenes[name].renderMs.p95.toFixed(2)} -> ${scene.renderMs.p95.toFixed(2)} ms; lighting p95 ${before.scenes[name].lightMs.p95.toFixed(2)} -> ${scene.lightMs.p95.toFixed(2)} ms`);
  }
} finally { await browser?.close(); server.close(); }
