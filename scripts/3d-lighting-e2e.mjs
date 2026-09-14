import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startTestServer } from './browser-harness.mjs';

const server = await startTestServer({ production: !process.argv.includes('--dev') });
const artifacts = resolve(process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts/3d-lighting');
mkdirSync(artifacts, { recursive: true });
let browser;
try {
  const hardware = process.platform === 'win32' && !process.argv.includes('--software');
  browser = await chromium.launch({ headless: true, args: [hardware ? '--use-angle=d3d11' : '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || /GL_INVALID|Error compiling.*executable/.test(message.text())) errors.push(message.text());
  });
  await page.addInitScript(() => {
    // Hold albedo constant to isolate lighting from body-local material textures.
    // The geometry, normals, lighting, and traversal are the compiled WASM shader.
    const original = WebGL2RenderingContext.prototype.shaderSource;
    WebGL2RenderingContext.prototype.shaderSource = function (shader, source) {
      if (source.includes('uniform usampler3D terrain;')) {
        const modified = source.replace(/vec3 base=materialAlbedo\([^;]+;/, 'vec3 base=vec3(.55);')
          .replace('uniform int lightCount;', 'uniform int lightingDebug;\nuniform int lightCount;')
          .replace('vec3 p=eye+d*best;', `vec3 p=eye+d*best;
            if(lightingDebug==1){color=vec4(bestN*.5+.5,1);return;}
            if(lightingDebug==2){color=vec4(sceneIllumination(p,bestN,hitSlot,localP,bestN)*.5,1);return;}`)
          .replace('if(target.w>0.0 &&', 'if(false &&');
        window.__lightingShaderPatched = modified !== source;
        source = modified;
      }
      return original.call(this, shader, source);
    };
  });
  await page.goto(`${server.baseURL}/3d?test`);
  await page.waitForFunction(() => document.querySelector('#voxel-canvas').dataset.ready === 'true'
    || !document.querySelector('#retry').hidden, {}, { timeout: 60000 });
  assert.deepEqual(errors, [], 'native shader compiles and draws');
  assert.equal(await page.locator('#voxel-canvas').getAttribute('data-ready'), 'true');
  assert.equal(await page.evaluate(() => window.__lightingShaderPatched), true);
  await page.locator('#intro').evaluate(element => { element.hidden = true; });
  await page.locator('#brush').evaluate(element => {
    element.value = '.5'; element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => {
    const d = window.__voxelDemo; d.pause(true); d.tool(0);
    for (let x = 32; x < 56; ++x) for (let z = 48; z < 72; ++z) for (let y = 24; y < 28; ++y)
      d.edit(x / 16, y / 16, z / 16, 4);
    for (let y = -1; y < 24; ++y) d.edit(2, y / 16, 3, 4);
    for (let x = 28; x < 60; ++x) for (let y = 0; y < 24; ++y) d.edit(x / 16, y / 16, 46 / 16, 3);
    d.camera(2.75, .85, 6, 0, .03); d.render();
  });
  const capture = () => page.evaluate(() => {
    const d = window.__voxelDemo; d.render();
    const canvas = document.querySelector('#voxel-canvas'), gl = canvas.getContext('webgl2');
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { pixels: [...pixels], stats: d.stats(), count: canvas.width * canvas.height, error: gl.getError() };
  });
  const before = await capture();
  await page.screenshot({ path: resolve(artifacts, 'static-roof.png') });
  await page.evaluate(() => {
    const d = window.__voxelDemo;
    d.camera(2.03125, 1.28125, 4.5, 0, 0); d.use();
    d.camera(2.75, .85, 6, 0, .03); d.render();
  });
  const after = await capture();
  await page.screenshot({ path: resolve(artifacts, 'rigid-roof.png') });
  assert.equal(before.stats[1], 0);
  assert.equal(after.stats[1], 1, 'cutting the narrow support transfers the roof to one rigid body');
  assert.equal(after.stats[3] - before.stats[3], 1, 'only one support voxel changes');
  assert.equal(after.stats[0], before.stats[0], 'physics stays paused so the roof retains its exact pose');
  let changed = 0, total = 0;
  for (let i = 0; i < before.pixels.length; i += 4) {
    let delta = 0;
    for (let channel = 0; channel < 3; ++channel)
      delta = Math.max(delta, Math.abs(before.pixels[i + channel] - after.pixels[i + channel]));
    if (delta > 2) ++changed;
    total += delta;
  }
  const result = { changed, changedFraction: changed / before.count, meanDifference: total / before.count };
  writeFileSync(resolve(artifacts, 'continuity.json'), JSON.stringify(result, null, 2));
  // The removed support cell and its small shadow legitimately change a few pixels.
  assert.ok(result.changedFraction < .001, 'static-to-rigid transfer preserves lighting on the roof and its surroundings');
  assert.ok(result.meanDifference < .02, 'transfer does not change overall illumination');
  assert.equal(after.error, 0); assert.deepEqual(errors, []);
  console.log('3D lighting continuity:', result);
  const transitions = await page.evaluate(() => {
    const d = window.__voxelDemo, canvas = document.querySelector('#voxel-canvas');
    const gl = canvas.getContext('webgl2'), pixel = new Uint8Array(4);
    const debug = gl.getUniformLocation(gl.getParameter(gl.CURRENT_PROGRAM), 'lightingDebug');
    d.reset(); d.pause(true);
    const samples = [];
    for (const height of [4, 8, 12, 16, 20, 24, 30, 40, 50, 60]) {
      d.camera(.03125, height, 5.03125 + height * .5, 0, -Math.atan2(1, .5));
      const sample = { height };
      for (const [mode, name] of [[1, 'normal'], [2, 'illumination']]) {
        gl.uniform1i(debug, mode); d.render();
        gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        sample[name] = [...pixel].slice(0, 3);
      }
      samples.push(sample);
    }
    gl.uniform1i(debug, 0);
    return samples;
  });
  writeFileSync(resolve(artifacts, 'lod-transitions.json'), JSON.stringify(transitions, null, 2));
  for (const sample of transitions) {
    assert.ok(sample.normal.every((v, i) => Math.abs(v - [128, 255, 128][i]) <= 1),
      `unobstructed ground keeps its upward normal at ${sample.height} m: ${sample.normal}`);
    assert.ok(sample.illumination.every((v, i) => Math.abs(v - transitions[0].illumination[i]) <= 3),
      `unobstructed ground stays sunlit across LOD transitions at ${sample.height} m: ${sample.illumination}`);
  }
  assert.deepEqual(errors, []);
  console.log('3D LOD lighting:', transitions);
} finally {
  await browser?.close();
  server.close();
}
