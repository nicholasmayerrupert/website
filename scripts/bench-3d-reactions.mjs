import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import createModule from '../src/sand3d/wasm/voxelDemo.js';

const e=await createModule({wasmBinary:readFileSync('src/sand3d/wasm/voxelDemo.wasm')});
const stats=()=>{const p=e._demo_stats()/4;return [...e.HEAPF32.subarray(p,p+36)];};
const summary=a=>{a.sort((a,b)=>a-b);return {p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a[Math.floor(a.length*.99)],max:a.at(-1)};};
assert.equal(e._demo_create(0),1);
try {
  const results={};
  const only=process.argv.indexOf('--only');
  for(const scenario of only<0?['acidBox','acidFragments','fireFall','burningTree','burningCrown']:process.argv[only+1].split(',')) {
    e._demo_reset();e._demo_pause(0);
    if(scenario==='acidBox') {
      e._demo_camera(0,3,-6,0,-Math.PI/2);e._demo_tool(4);e._demo_use();
    }else if(scenario==='fireFall') {
      e._demo_camera(.03125,5,4.03125,0,-Math.PI/2);e._demo_brush(16);e._demo_tool(8);e._demo_use();
      e._demo_tool(4);e._demo_use();
    }else if(scenario==='acidFragments') {
      for(let z=64;z<112;++z)for(let x=0;x<48;++x)for(let y=-2;y<36;++y)
        e._demo_edit((x+.5)/16,(y+.5)/16,(z+.5)/16,y<0||x===0||x===47||z===64||z===111?2:y<16?9:0);
      e._demo_step(1/60);e._demo_step(1/60);
      for(let z=0;z<4;++z)for(let x=0;x<4;++x)e._demo_body_box((4+x*10)/16,1.1,(68+z*10)/16,8,8,8,3);
    }else {
      let tree;
      for(let z=-17;z<18&&!tree;z+=.125)for(let x=-17;x<18&&!tree;x+=.125)
        if(Math.max(Math.abs(x),Math.abs(z))>7&&e._demo_cell(x,2,z)===4)tree={x,z};
      assert.ok(tree,'the generated scene contains a tree');
      let y=2;while(e._demo_cell(tree.x,y-1/16,tree.z)===4)y-=1/16;
      e._demo_camera(tree.x,y+1,tree.z+3,0,0);e._demo_brush(16);e._demo_tool(8);e._demo_use();
      if(scenario==='burningCrown')for(let z=tree.z-.5;z<=tree.z+.5;z+=1/16)for(let x=tree.x-.5;x<=tree.x+.5;x+=1/16)
        if(e._demo_cell(x,y+.5,z)===4)e._demo_edit(x,y+.5,z,12);
      console.log('Tree fixture',tree,y);
    }
    const rows=[];
    for(let tick=0;tick<600;++tick) {
      if(scenario.startsWith('burning')&&tick>0&&tick<120&&tick%30===0)e._demo_use();
      const start=performance.now();e._demo_step(1/60);const elapsed=performance.now()-start;
      const p=e._demo_reaction_ms()/4,c=e._demo_coupling_ms()/4,s=stats();
      const phases=[...e.HEAPF32.subarray(c,c+5)];
      rows.push({tick,ms:elapsed,support:e.HEAPF32[p],rebuild:e.HEAPF32[p+1],erosion:e.HEAPF32[p+2],terrain:e.HEAPF32[p+3],loose:e.HEAPF32[p+4],coupling:phases.reduce((a,b)=>a+b,0),phases,bodies:s[1],cells:s[11],reactions:s[35]});
      assert.ok(s.every(Number.isFinite),'reactive physics remains finite');
    }
    const s=stats();assert.ok(s[35]>0,'the scenario exercises reactions');
    if(scenario==='acidFragments')assert.equal(s[11]+s[35],8192,'reactive fracture preserves every unreacted body voxel');
    if(scenario==='acidBox')assert.ok(s[11]<4096,'the thrown block dissolves in acid');
    if(scenario==='burningCrown')assert.ok(rows.some(r=>r.cells>20000),'the burning crown becomes a large dynamic body');
    if(scenario==='fireFall') {
      const p=e._demo_body_stats(0)/4;assert.equal(e.HEAPF32[p+15],4096,'stone survives fire');
      assert.ok(e.HEAPF32[p+2]<.2,'the rigid block falls through the fire');
    }
    results[scenario]={stepMs:summary(rows.map(r=>r.ms)),supportMs:summary(rows.map(r=>r.support)),rebuildMs:summary(rows.map(r=>r.rebuild)),erosionMs:summary(rows.map(r=>r.erosion)),bodies:s[1],bodyCells:s[11],reactions:s[35],worst:[...rows].sort((a,b)=>b.ms-a.ms).slice(0,8)};
    console.log(scenario,JSON.stringify(results[scenario],null,2));
  }
  const flag=process.argv.indexOf('--json');if(flag>=0)writeFileSync(process.argv[flag+1],JSON.stringify(results,null,2)+'\n');
}finally{e._demo_destroy();}
