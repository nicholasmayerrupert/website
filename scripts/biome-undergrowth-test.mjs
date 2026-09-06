// Biome undergrowth fills wilderness, stays rooted, and survives streamed seams.
import { initSandWasm, createEngineWasm, BIOME, MAT, WORLD_FEATURE } from '../src/sand/wasmBridge/engineFactory.js';
import { makeChecker } from './sand-test-util.mjs';
await initSandWasm();
const { check, done } = makeChecker('biome undergrowth');
const foliage = new Set([MAT.RUST_BRAMBLE, MAT.OCHRE_REED, MAT.TEAL_LICHEN, MAT.VIOLET_FROND]);
const make = (seed, cols=384) => createEngineWasm({cols, rows:320, worldSeed:seed, infinite:true, sinksOn:false});
function move(e,x,y) {
  const ox=Math.floor((x-e.cols/2)/32)*32,oy=Math.floor((y-e.rows/2)/32)*32;
  while(e.getWorldOffsetX()!==ox)e.shiftWorldXY(Math.max(32-e.cols,Math.min(e.cols-32,ox-e.getWorldOffsetX())),0);
  while(e.getWorldOffsetY()!==oy)e.shiftWorldXY(0,Math.max(32-e.rows,Math.min(e.rows-32,oy-e.getWorldOffsetY())));
}
const same=(a,b)=>a.length===b.length&&a.every((m,i)=>m===b[i]);
for(const seed of [7,14,31])for(const biome of [BIOME.ROCKY,BIOME.WATCHWOOD]) {
  const e=make(seed);let center;
  for(let d=0;d<24000 && center===undefined;d+=96)for(const x of [d,-d]) {
    if(e.worldBiomeAt(x)!==biome)continue;
    let wild=true;
    for(let dx=-128;dx<=128;dx+=16) {
      const c=e.worldContextAt(x+dx,e.worldSurfaceAbsAt(x+dx));
      if(c.surfaceBiome!==biome || ![WORLD_FEATURE.NONE,WORLD_FEATURE.OUTCROP].includes(c.featureKind))wild=false;
    }
    if(wild){center=x;break;}
  }
  const label=`seed ${seed}, ${biome===BIOME.ROCKY?'bone':'eye'}`;
  check(`${label}: continuous wilderness is available`,center!==undefined);
  if(center===undefined){e.destroy();continue;}
  move(e,center,e.worldSurfaceAbsAt(center));
  const bounds={left:center-128,right:center+128,top:e.getWorldOffsetY()+24,bottom:e.getWorldOffsetY()+e.rows-24};
  const capture=en=>{
    const out=[];
    for(const g of [en.getGrid(),en.getGridBg()])for(let y=bounds.top;y<bounds.bottom;y++)for(let x=bounds.left;x<=bounds.right;x++)
      out.push(g[(y-en.getWorldOffsetY())*en.cols+x-en.getWorldOffsetX()]);
    return out;
  };
  const before=capture(e),anchors=[],colors=new Set(),columns=new Set();
  for(let x=bounds.left;x<=bounds.right;x++)for(let y=bounds.top;y<bounds.bottom;y++) {
    const m=e.getGridBg()[(y-e.getWorldOffsetY())*e.cols+x-e.getWorldOffsetX()];
    if(y<e.worldSurfaceAbsAt(x) && (foliage.has(m) || (biome===BIOME.WATCHWOOD && [MAT.EYE_IRIS,MAT.EYE_WOOD].includes(m))))colors.add(m);
    if(foliage.has(m)) {
      anchors.push([x,y,m]);
      if(y<e.worldSurfaceAbsAt(x)){colors.add(m);columns.add(x);}
    }
  }
  console.log('scene',JSON.stringify({seed,biome,x:center,y:e.worldSurfaceAbsAt(center),cells:anchors.length,colors:[...colors],columns:columns.size}));
  check(`${label}: colored undergrowth fills the gaps`,anchors.length>120 && columns.size>45 && colors.size>=2);
  check(`${label}: foreground travel remains clear of undergrowth`,!e.getGrid().some(m=>foliage.has(m)));
  const wide=make(seed,512);move(wide,center,e.worldSurfaceAbsAt(center));
  check(`${label}: identical roots and foliage at another viewport width`,same(before,capture(wide)));wide.destroy();
  e.shiftWorldXY(352,0);e.shiftWorldXY(352,0);e.shiftWorldXY(-352,0);e.shiftWorldXY(-352,0);
  check(`${label}: horizontal streaming restores the whole patch`,same(before,capture(e)));
  e.shiftWorldXY(0,288);e.shiftWorldXY(0,288);e.shiftWorldXY(0,-288);e.shiftWorldXY(0,-288);
  check(`${label}: vertical streaming restores the whole patch`,same(before,capture(e)));
  for(let i=0;i<120;i++)e.stepWorld();
  const moved=anchors.filter(([x,y,m])=>e.getGridBg()[(y-e.getWorldOffsetY())*e.cols+x-e.getWorldOffsetX()]!==m);
  check(`${label}: foliage stays rooted (${moved.length}/${anchors.length} moved)`,moved.length===0);
  if(moved.length)console.log('moved',moved.slice(0,12));
  e.destroy();
}
process.exitCode=done()?1:0;
