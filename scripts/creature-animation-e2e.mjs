import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startTestServer } from './browser-harness.mjs';

const dir = resolve(process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts/creature-animation');
mkdirSync(dir, { recursive: true });
const server = await startTestServer();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1120, height: 1000 }, recordVideo: { dir, size: { width: 1120, height: 1000 } } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/animation-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin:24px; background:#16252d; color:#d6e6ec; font:16px system-ui; }
h1 { margin:0 0 6px; font-size:27px; } p { margin:0 0 16px; color:#a8c0ca; }
main { display:grid; gap:12px; } section { padding:12px; background:#203540; border:1px solid #38535f; }
header { display:flex; justify-content:space-between; margin-bottom:8px; } canvas { display:block; width:100%; image-rendering:pixelated; }
strong { color:#9ee6c1; } #result { margin-top:12px; }
</style></head><body><h1>Creature animation regression test</h1><p>Real game renderer · controlled movement → wall-contact pulses → movement resumes</p><main></main><div id="result">Checking native and replicated playback…</div></body></html>` }));
  await page.goto(`${server.baseURL}/animation-fixture`);
  const result = await page.evaluate(async () => {
    const [{initSandWasm,createEngineWasm,MAT,PLANET},{CREATURE,OFF},{CREATURE_ROSTER}] = await Promise.all([
      import('/src/sand/wasmBridge/engineFactory.js'), import('/src/sand/wasmBridge/abi.generated.js'), import('/src/sand/studio/creatureViewerRuntime.js'),
    ]);
    await initSandWasm();
    const scenes = [], checks = [], o = OFF.creatureSnapshot;
    for (const key of ['VILLAGE_GUARD','FROST_GIANT','BONE_DINOSAUR']) {
      const def = CREATURE_ROSTER.find(d => d.key === key), section = document.createElement('section');
      section.innerHTML = `<header><span>${def.name}</span><strong>Walking</strong></header>`;
      const canvas = document.createElement('canvas'); canvas.width = 1040; canvas.height = 208;
      section.append(canvas); document.querySelector('main').append(section);
      const e = createEngineWasm({cols:192,rows:144,worldSeed:73,sinksOn:false,planetId:PLANET.FRONTIER});
      e.setCreatureRuntime(false,false);
      for (let x = 0; x < 192; x++) for (let y = 108; y < 144; y++) e.paintDisc(x,y,0,MAT.STONE,true);
      e.syncComponents(); e.spawnScriptedCreature(CREATURE[key],65,108-def.stats.h);
      const original = e.getCreatureSnapshotData().slice();
      e.glInit(canvas); e.glResize(canvas.width,canvas.height); e.setViewport(1,6,174,35);e.cameraSet(0,77);e.glSetFlags(false,false,true);e.setSkyLight(220);
      function render(tick,vx,external=true,x=65) {
        const data = original.slice(); data[o.vx]=vx; data[o.vy]=0;data[o.x]=x;data[o.facing]=1;data[o.animFrame]=tick%4;
        e.syncActorTick(tick);e.setMirrorCreatures(data,0,0);e.glSetCreatures(external?data:null);e.glRenderFrame(true);
      }
      function hash() { const pixels=e.glReadPixels(0,0,canvas.width,canvas.height);let h=2166136261;for(const v of pixels)h=Math.imul(h^v,16777619);return h>>>0; }
      const nominal=def.stats.walkSpeed || .15;
      if (key !== 'BONE_DINOSAUR') {
        const paths=[];
        for (const external of [false,true]) {
          render(0,nominal,external);
          const walk = new Set();
          for (let tick=1;tick<=48;tick++){render(tick,nominal,external);walk.add(hash());}
          const blocked=[];
          for (let tick=49;tick<=96;tick++){render(tick,tick%2?.038:0,external);if(tick>=72)blocked.push(hash());}
          render(96,0,external); const repeated=hash();render(96,0,external);
          checks.push({creature:key,external,walkFrames:walk.size,wallStable:new Set(blocked).size===1,pauseStable:hash()===repeated});
          paths.push(blocked);
        }
        checks.push({creature:key,mirrorMatches:paths[0].every((v,i)=>v===paths[1][i])});
      }
      render(0,nominal);
      scenes.push({e,render,nominal,label:section.querySelector('strong')});
    }
    window.runAnimationDemo = async () => {
      for (let tick=0;tick<240;tick++) {
        const blocked=tick>=72&&tick<150;
        for(const scene of scenes){
          scene.label.textContent=blocked?'Blocked · settles to idle':tick<72?'Walking':'Walking resumes';
          const distance=Math.min(tick,72)*scene.nominal + Math.max(0,tick-150)*scene.nominal;
          scene.render(tick,blocked?(tick%2?.038:0):scene.nominal,true,48+distance);
        }
        await new Promise(resolve=>requestAnimationFrame(resolve));
      }
      document.querySelector('#result').textContent='PASS · distinct walk poses · stable at walls · stable when paused · native and replicated output match';
    };
    return checks;
  });
  for (const check of result) {
    if ('walkFrames' in check) {
      assert.equal(check.walkFrames,4,`${check.creature}: four walking poses`);
      assert.ok(check.wallStable,`${check.creature}: blocked velocity pulses must settle`);
      assert.ok(check.pauseStable,`${check.creature}: repeated render must not advance`);
    } else assert.ok(check.mirrorMatches,`${check.creature}: native and replicated paths match`);
  }
  await page.evaluate(()=>window.runAnimationDemo());
  assert.deepEqual(errors,[]);
  await page.screenshot({path:resolve(dir,'animation-test.png'),fullPage:true});
  writeFileSync(resolve(dir,'checks.json'),JSON.stringify(result,null,2)+'\n');
  await context.close();
  await page.video().saveAs(resolve(dir,'animation-test.webm'));
  console.log(JSON.stringify(result));
  console.log(`Visual test: ${resolve(dir,'animation-test.webm')}`);
} finally { await browser?.close(); await server.close(); }
