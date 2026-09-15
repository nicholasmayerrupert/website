import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { startTestServer } from './browser-harness.mjs';

const output = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const server = await startTestServer({ production: process.argv.includes('--production') });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: process.platform === 'win32' ? ['--use-angle=d3d11'] : [] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${server.baseURL}/3d?test`);
  await page.waitForSelector('#voxel-canvas[data-ready="true"]', { timeout: 60000 });
  const result = await page.evaluate(async coupling => {
    const d = window.__voxelDemo, canvas = document.getElementById('voxel-canvas'), gl = canvas.getContext('webgl2');
    const renderer = gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
    const summarize = values => { values.sort((a,b) => a-b); return Object.fromEntries([['p50', .5], ['p95', .95], ['p99', .99], ['max', 1]].map(([key,p]) => [key, values[Math.min(values.length-1, Math.floor(values.length*p))]])); };
    const samples = {};
    // Submit one simulated frame at a time with a GPU fence at the end. These
    // timings isolate engine and draw cost from browser display scheduling.
    for (const scenario of ['stationary', 'flight']) {
      d.reset(); d.camera(0, 6, 8, 0, -.18); d.pause(false);
      if (scenario === 'flight') {
        // Use the normal running RAF and DOM input for the travel case.
        d.menu(false);
        for (const code of ['KeyW', 'KeyD', 'ShiftLeft']) document.dispatchEvent(new KeyboardEvent('keydown', { code }));
        const gaps = []; let previous = performance.now();
        for (let i = 0; i < 300; ++i) { const now = await new Promise(requestAnimationFrame); if (i > 30) gaps.push(now - previous); previous = now; }
        const end = d.stats(); d.menu(true);
        samples.flight = { frameGapMs: summarize(gaps), position: end.slice(5,8), shifts: end[18] };
        continue;
      }
      const step = [], render = [], complete = [];
      for (let i = 0; i < 180; ++i) {
        await new Promise(requestAnimationFrame);
        const begin = performance.now(); d.step(1); const stepped = performance.now();
        d.render(); const submitted = performance.now(); gl.finish(); const finished = performance.now();
        if (i > 20) { step.push(stepped-begin); render.push(submitted-stepped); complete.push(finished-begin); }
      }
      samples.stationary = { stepMs: summarize(step), renderSubmissionMs: summarize(render), completeMs: summarize(complete) };
    }
    if (coupling) for (const scenario of ['throw', 'floating32', 'floating64']) {
      d.menu(true);d.reset();d.pause(false);
      if (scenario === 'throw') {
        d.camera(-4.5,3,-6,0,-Math.PI/2);d.tool(4);d.use();
      } else {
        const size = scenario === 'floating32' ? 32 : 64;
        for (let z=64;z<64+size;++z) for (let x=0;x<size;++x) for (let y=-2;y<48;++y)
          d.edit((x+.5)/16,(y+.5)/16,(z+.5)/16,y<0||x===0||x===size-1||z===64||z===63+size?2:y<24?8:0);
        d.step(2);const body=d.bodyBox((size/2-8)/16,2,(64+size/2-8)/16,16,16,16,4);
        d.bodyVelocity(body,.2,-2,.1,.7,.3,.9);
        d.camera(size/32,5,10+size/32,0,-.65);
      }
      const water=d.count(8),gaps=[];d.render();
      const firstTick=d.stats()[0];d.menu(false);let previous=performance.now();
      for(let i=0;i<240;++i) {
        const now=await new Promise(requestAnimationFrame);
        gaps.push(now-previous);previous=now;
      }
      d.menu(true);
      samples[scenario]={frameGapMs:summarize(gaps),ticks:d.stats()[0]-firstTick,waterBefore:water,waterAfter:d.count(8),overlap:d.looseOverlap(),displaced:d.bodyStats(0)[16]};
    }
    return { renderer, viewport: [1280,800], renderSize: [canvas.width,canvas.height], samples, glError: gl.getError() };
  }, process.argv.includes('--coupling'));
  assert.equal(result.glError, 0);
  assert.ok(result.samples.flight.shifts > 0);
  for (const name of ['throw','floating32','floating64']) if(result.samples[name]) {
    const sample=result.samples[name];assert.equal(sample.waterAfter,sample.waterBefore);assert.equal(sample.overlap,0);assert.ok(sample.displaced>0);
  }
  console.log(JSON.stringify(result, null, 2));
  if (output) { mkdirSync(dirname(resolve(output)), { recursive: true }); writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`); }
} finally { await browser?.close(); await server.close(); }
