import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startTestServer } from './browser-harness.mjs';

const server=await startTestServer({production:process.argv.includes('--production')});
let browser;
try {
  browser=await chromium.launch({headless:true,args:process.platform==='win32'?['--use-angle=d3d11']:[]});
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto(`${server.baseURL}/3d?test`);
  await page.waitForSelector('#voxel-canvas[data-ready="true"]',{timeout:60000});
  const results=await page.evaluate(async()=>{
    const d=window.__voxelDemo,canvas=document.getElementById('voxel-canvas'),gl=canvas.getContext('webgl2');
    const summary=a=>{a.sort((a,b)=>a-b);return {p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a[Math.floor(a.length*.99)],max:a.at(-1)};};
    const report={renderer:gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),renderSize:[canvas.width,canvas.height],samples:{}};
    document.getElementById('brush').value='12';document.getElementById('brush').dispatchEvent(new Event('input'));
    for(const [name,tool] of [['water',5],['acid',6]]) {
      d.reset();d.tool(tool);d.camera(.03125,3,4.03125,0,-Math.PI/2);d.pause(false);d.render();gl.finish();
      // Keep synchronous scene construction out of the first RAF interval.
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      const rows=[],pours=[],frameGaps=[];let previous=0;
      for(let i=0;i<600;++i) {
        const frame=await new Promise(requestAnimationFrame);if(previous)frameGaps.push(frame-previous);previous=frame;
        if(i<90&&i%12===0){const start=performance.now();d.use();pours.push(performance.now()-start);}
        const begin=performance.now();d.step(1);const stepped=performance.now();d.render();const submitted=performance.now();gl.finish();const end=performance.now();
        const s=d.stats();rows.push({tick:i,step:stepped-begin,render:submitted-stepped,complete:end-begin,bodies:s[1],awake:s[2],bodyCells:s[11],uploaded:s[23],reactions:s[35]});
      }
      const s=d.stats();report.samples[name]={stepMs:summary(rows.map(r=>r.step)),renderSubmissionMs:summary(rows.map(r=>r.render)),completeMs:summary(rows.map(r=>r.complete)),frameGapMs:summary(frameGaps),pourMs:summary(pours),reactionStepMs:summary(rows.filter(r=>r.tick%6===0).map(r=>r.step)),followingStepMs:summary(rows.filter(r=>r.tick%6===1).map(r=>r.step)),uploadedChunks:summary(rows.map(r=>r.uploaded)),bodies:s[1],reactions:s[35],liquids:s.slice(28,35),worstSteps:[...rows].sort((a,b)=>b.step-a.step).slice(0,8),worstRenders:[...rows].sort((a,b)=>b.render-a.render).slice(0,8)};
    }
    report.glError=gl.getError();return report;
  });
  assert.equal(results.glError,0);
  console.log(JSON.stringify(results,null,2));
  const flag=process.argv.indexOf('--json');if(flag>=0)writeFileSync(process.argv[flag+1],`${JSON.stringify(results,null,2)}\n`);
}finally{await browser?.close();await server.close();}
