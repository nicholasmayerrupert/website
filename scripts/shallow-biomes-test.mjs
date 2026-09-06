// Surface geology persists below the soil without changing cave topology.
import { readFileSync } from 'node:fs';
import { initSandWasm, createEngineWasm, MAT, WORLD_FEATURE } from '../src/sand/wasmBridge/engineFactory.js';
import { makeChecker } from './sand-test-util.mjs';
await initSandWasm();
const { check, done } = makeChecker('shallow biome geology');
const defs=JSON.parse(readFileSync(new URL('../src/sand/biomes.schema.json',import.meta.url))).surfaceBiomes;
const rocks=new Set(['STONE','SHALE','SLATE','ROOTSTONE','VEIN_ROCK','SANDSTONE','PALESTONE','BONE'].map(k=>MAT[k]));
const foliage=new Set([MAT.RUST_BRAMBLE,MAT.OCHRE_REED,MAT.TEAL_LICHEN,MAT.VIOLET_FROND,MAT.EYE_WOOD,MAT.EYE_IRIS,MAT.EYE_SCLERA,MAT.EYE_PUPIL]);
const make=(cols=384)=>createEngineWasm({cols,rows:352,worldSeed:7,infinite:true,sinksOn:false});
function move(e,x,y) {
  const ox=Math.floor((x-e.cols/2)/32)*32,oy=Math.floor((y-e.rows/2)/32)*32;
  while(e.getWorldOffsetX()!==ox)e.shiftWorldXY(Math.max(32-e.cols,Math.min(e.cols-32,ox-e.getWorldOffsetX())),0);
  while(e.getWorldOffsetY()!==oy)e.shiftWorldXY(0,Math.max(32-e.rows,Math.min(e.rows-32,oy-e.getWorldOffsetY())));
}
const probe=make(96), centers=new Map();
for(let d=0;d<32000&&centers.size<defs.length;d+=96)for(const x of [d,-d]) {
  const b=probe.worldBiomeAt(x);
  if(!centers.has(b)&&[-128,128].every(dx=>probe.worldBiomeAt(x+dx)===b))centers.set(b,x);
}
// A broad natural bone cave, outside the nearby ruin reservation.
if ([4096,4224,4352].every(x=>probe.worldBiomeAt(x)===3)) centers.set(3,4224);
probe.destroy();
check('all surface biomes have testable continuous cores',centers.size===defs.length);
for(const def of defs) {
  if(!centers.has(def.id))continue;
  const e=make(),x=centers.get(def.id),surface=e.worldSurfaceAbsAt(x),y=surface+128;
  move(e,x,y);
  const area={left:x-100,right:x+100,top:e.getWorldOffsetY()+24,bottom:e.getWorldOffsetY()+e.rows-24};
  const fg=e.getGrid(),bg=e.getGridBg(),expected=new Set([MAT[def.undergroundRock],MAT[def.undergroundAccent]]);
  if(def.key==='ROCKY')expected.add(MAT.BONE);
  const anchors=[];let total=0,themed=0,shared=0,disagree=0,deepThemed=0,deepTotal=0;
  for(let wx=area.left;wx<area.right;wx++)for(let wy=area.top;wy<area.bottom;wy++) {
    const depth=wy-e.worldSurfaceAbsAt(wx);
    if(depth<28||![WORLD_FEATURE.NONE,WORLD_FEATURE.OUTCROP].includes(e.worldContextAt(wx,wy).featureKind))continue;
    const k=(wy-e.getWorldOffsetY())*e.cols+wx-e.getWorldOffsetX();
    if(depth<=85) {
      if(rocks.has(fg[k])){total++;if(expected.has(fg[k]))themed++;}
      if(rocks.has(fg[k])&&rocks.has(bg[k])&&!e.worldIsCaveAt(0,wx,wy)&&!e.worldIsCaveAt(1,wx,wy)) {shared++;if(fg[k]!==bg[k])disagree++;}
    }
    if(depth>=def.undergroundDepth+40&&rocks.has(bg[k])){deepTotal++;if(expected.has(bg[k]))deepThemed++;}
    if(depth>32&&foliage.has(bg[k])&&e.worldIsCaveAt(0,wx,wy))anchors.push([wx,wy,bg[k]]);
  }
  console.log('scene',JSON.stringify({biome:def.key,seed:7,x,y:surface+65,total,themed,shared,disagree,deepThemed,deepTotal,flora:anchors.length}));
  check(`${def.name}: distinctive bedrock below the soil`,total>200&&themed/total>.65);
  check(`${def.name}: matching geology in both layers`,shared>100&&disagree/shared<.025);
  check(`${def.name}: independent cave rock resumes below the root zone`,deepTotal>100&&deepThemed/deepTotal<.08);
  const capture=en=>{
    const out=[];
    for(const g of [en.getGrid(),en.getGridBg()])for(let wy=area.top;wy<area.bottom;wy++)for(let wx=area.left;wx<area.right;wx++)
      out.push(g[(wy-en.getWorldOffsetY())*en.cols+wx-en.getWorldOffsetX()]);
    return out;
  };
  const before=capture(e),wide=make(512);move(wide,x,y);
  const wideCells=capture(wide);
  check(`${def.name}: geology and roots ignore viewport width`,before.every((m,i)=>m===wideCells[i]));
  wide.destroy();
  e.shiftWorldXY(0,320);e.shiftWorldXY(0,320);e.shiftWorldXY(0,-320);e.shiftWorldXY(0,-320);
  const after=capture(e);
  check(`${def.name}: vertical streaming restores geology and roots`,before.every((m,i)=>m===after[i]));
  if(def.key==='ROCKY'||def.key==='WATCHWOOD') {
    check(`${def.name}: matching cave growth is present`,anchors.length>20);
    for(let i=0;i<120;i++)e.stepWorld();
    const moved=anchors.filter(([wx,wy,m])=>e.getGridBg()[(wy-e.getWorldOffsetY())*e.cols+wx-e.getWorldOffsetX()]!==m);
    check(`${def.name}: cave growth stays attached (${moved.length}/${anchors.length} moved)`,moved.length===0);
    if(moved.length)console.log('moved',moved.slice(0,12));
  }
  e.destroy();
}
process.exitCode=done()?1:0;
