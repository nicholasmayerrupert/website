import {readFileSync,writeFileSync} from 'node:fs';
import createModule from '../src/sand3d/wasm/voxelDemo.js';
const e=await createModule({wasmBinary:readFileSync('src/sand3d/wasm/voxelDemo.wasm')});
const stats=()=>Array.from(e.HEAPF32.subarray(e._demo_stats()/4,e._demo_stats()/4+36));
const summary=a=>{a.sort((a,b)=>a-b);return {p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a[Math.floor(a.length*.99)],max:a.at(-1)};};
e._demo_create(0);
try {
 const results={};
 for(const [name,tool] of [['water',5],['acid',6]]) {
  e._demo_reset();e._demo_tool(tool);e._demo_brush(12);
  e._demo_camera(.03125,3,4.03125,0,-Math.PI/2);
  const times=[],reactionTimes=[];
  for(let i=0;i<600;++i) {
   if(i<90&&i%12===0)e._demo_use();
   const start=performance.now();e._demo_step(1/60);const elapsed=performance.now()-start;
   times.push(elapsed);if(i%6===0)reactionTimes.push(elapsed);
  }
  const s=stats();results[name]={stepMs:summary(times),reactionStepMs:summary(reactionTimes),bodies:s[1],reactions:s[35],liquids:s.slice(28,35)};
 }
 console.log(JSON.stringify(results,null,2));
 const flag=process.argv.indexOf('--json');if(flag>=0)writeFileSync(process.argv[flag+1],JSON.stringify(results,null,2)+'\n');
}finally{e._demo_destroy();}
