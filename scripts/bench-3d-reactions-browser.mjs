import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startTestServer } from './browser-harness.mjs';

const server=await startTestServer({production:process.argv.includes('--production')});
let browser;
try {
  browser=await chromium.launch({headless:true,args:process.platform==='win32'?['--use-angle=d3d11']:[]});
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on('console',message=>{if(message.type()==='log')console.log(message.text());});
  await page.goto(`${server.baseURL}/3d?test`);
  await page.waitForSelector('#voxel-canvas[data-ready="true"]',{timeout:60000});
  const only=process.argv.indexOf('--only');
  const scenarios=only<0?['acidBox','fireFall','burningTree','burningCrown']:process.argv[only+1].split(',');
  const results=await page.evaluate(async(scenarios)=>{
    const d=window.__voxelDemo,gl=document.getElementById('voxel-canvas').getContext('webgl2');
    const summary=a=>{a.sort((a,b)=>a-b);return {p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a[Math.floor(a.length*.99)],max:a.at(-1)};};
    const report={renderer:gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),samples:{}};
    for(const scenario of scenarios) {
      const prepare=()=>{
      d.menu(true);d.reset();d.pause(false);
      if(scenario==='acidBox'){d.camera(0,3,-6,0,-Math.PI/2);d.tool(4);d.use();}
      else if(scenario==='fireFall') {
        d.camera(.03125,5,4.03125,0,-Math.PI/2);d.tool(8);
        const brush=document.getElementById('brush');brush.value='16';brush.dispatchEvent(new Event('input'));d.use();d.tool(4);d.use();
      }
      else {
        let tree;
        for(let z=-17;z<18&&!tree;z+=.125)for(let x=-17;x<18&&!tree;x+=.125)
          if(Math.max(Math.abs(x),Math.abs(z))>7&&d.cell(x,2,z)===4)tree={x,z};
        if(!tree)throw Error('Missing tree fixture');
        let y=2;while(d.cell(tree.x,y-1/16,tree.z)===4)y-=1/16;
        d.camera(tree.x,y+1,tree.z+3,0,0);d.tool(8);
        const brush=document.getElementById('brush');brush.value='16';brush.dispatchEvent(new Event('input'));d.use();
        if(scenario==='burningCrown')for(let z=tree.z-.5;z<=tree.z+.5;z+=1/16)for(let x=tree.x-.5;x<=tree.x+.5;x+=1/16)
          if(d.cell(x,y+.5,z)===4)d.edit(x,y+.5,z,12);
      }
      };
      prepare();
      d.render();gl.finish();await new Promise(requestAnimationFrame);
      const rows=[],gaps=[];let previous=0;
      for(let tick=0;tick<900;++tick) {
        const now=await new Promise(requestAnimationFrame);if(previous)gaps.push(now-previous);previous=now;
        if(scenario.startsWith('burning')&&tick>0&&tick<120&&tick%30===0)d.use();
        const begin=performance.now();d.step(1);const stepped=performance.now();d.render();const rendered=performance.now();gl.finish();const end=performance.now();
        const s=d.stats();rows.push({tick,step:stepped-begin,render:rendered-stepped,complete:end-begin,bodies:s[1],cells:s[11],reactions:s[35],phases:d.reactionTimes()});
      }
      report.samples[scenario]={stepMs:summary(rows.map(r=>r.step)),renderMs:summary(rows.map(r=>r.render)),completeMs:summary(rows.map(r=>r.complete)),frameGapMs:summary(gaps),worstSteps:[...rows].sort((a,b)=>b.step-a.step).slice(0,6),worstRenders:[...rows].sort((a,b)=>b.render-a.render).slice(0,6),final:rows.at(-1)};
      prepare();d.render();const initialTick=d.stats()[0];d.menu(false);
      const normal=[];let last=performance.now();
      for(let frame=0;frame<(scenario.startsWith('burning')?900:300);++frame) {
        const now=await new Promise(requestAnimationFrame);normal.push(now-last);last=now;
        if(scenario.startsWith('burning')&&frame>0&&frame<120&&frame%30===0)d.use();
      }
      d.menu(true);report.samples[scenario].normalFrameGapMs=summary(normal);report.samples[scenario].normalTicks=d.stats()[0]-initialTick;
      console.log(scenario,JSON.stringify(report.samples[scenario]));
    }
    report.glError=gl.getError();return report;
  },scenarios);
  assert.equal(results.glError,0);for(const value of Object.values(results.samples))assert.ok(value.final.reactions>0);
  const flag=process.argv.indexOf('--json');if(flag>=0)writeFileSync(process.argv[flag+1],JSON.stringify(results,null,2)+'\n');
}finally{await browser?.close();await server.close();}
