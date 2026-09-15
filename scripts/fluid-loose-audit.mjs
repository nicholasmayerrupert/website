// Isolated one-cell-wide, sealed columns using the engine RNG.
import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { mkdirSync, writeFileSync } from 'node:fs';
await initSandWasm();
const cols=34, rows=100, x=16, start=10, ticks=60, repeats=24;
const results=[];
for (const [name,moving,target] of [
  ['lava-sand', MAT.LAVA,MAT.SAND],
  ['lava-stone-dust',MAT.LAVA,MAT.STONE_DUST],
  ['lava-empty',MAT.LAVA,MAT.EMPTY],
  ['sand-water',MAT.SAND,MAT.WATER],
  ['brine-water',MAT.BRINE,MAT.WATER],
]) {
  const histogram={}, tick3Histogram={}; let total=0, observations=0, lost=0; const examples=[];
  for(let trial=0;trial<repeats;trial++) {
    const e=createEngineWasm({cols,rows,worldSeed:0xF100D+trial,sinksOn:false,infinite:false});
    e.setBgEnabled(false);
    for(let y=2;y<rows;y++) for(const xx of [x-1,x+1]) e.paintDisc(xx,y,0,MAT.STONE,true);
    e.paintDisc(x,2,0,MAT.STONE,true); e.paintDisc(x,rows-1,0,MAT.STONE,true); e.syncComponents();
    for(let y=start+1;y<rows-1;y++) e.paintDisc(x,y,0,target,true);
    e.paintDisc(x,start,0,moving,true);
    let old=start; const trace=[];
    for(let tick=1;tick<=ticks;tick++) {
      e.stepWorld(); const g=e.getGrid(); let y=-1,count=0;
      for(let yy=3;yy<rows-1;yy++) if(g[yy*cols+x]===moving) {y=yy;count++;}
      if(count!==1) {lost++;break;}
      const d=y-old;
      if(old<rows-3) {histogram[d]=(histogram[d]??0)+1; if(tick%3===0) tick3Histogram[d]=(tick3Histogram[d]??0)+1; total+=d;observations++;}
      trace.push(y); old=y;
    }
    if(trial===0) examples.push(trace);
    e.destroy();
  }
  results.push({name,repeats,ticks,histogram,tick3Histogram,meanCellsPerTick:total/observations,lost,examples});
}
console.log(JSON.stringify(results,null,2));
mkdirSync('.sand-artifacts', { recursive: true });
writeFileSync('.sand-artifacts/fluid-loose-audit.json',JSON.stringify(results,null,2)+'\n');
