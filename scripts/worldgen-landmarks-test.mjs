// Biome landmarks must be discoverable, grounded, and identical through streaming.
import { initSandWasm, createEngineWasm, WORLD_FEATURE, BIOME } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT_FLAGS, MF } from '../src/sand/materials.generated.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';
await initSandWasm();
const { check, done } = makeChecker('biome landmarks');
const make = (cols = 384, seed = 7) => createEngineWasm({cols, rows:320, worldSeed:seed, infinite:true, sinksOn:false});
const kindOf = c => {
  if(c.surfaceBiome === BIOME.TUNDRA && (c.featureId >>> 4) % 3 === 0) return 16;
  if(c.surfaceBiome === BIOME.ROCKY && (c.featureId & 1) && (c.featureId & 48)) return c.featureId & 16 ? 17 : 18;
  return c.surfaceBiome * 2 + (c.featureId & 1);
};
const scenes=new Map();
let steepCamp;
for (let seed = 0; seed < 32; seed++) {
  const scout=make(96,seed);
  for(let d=0;d<=20000;d+=64) for(const x of [d,-d]) {
    const c=scout.worldContextAt(x,scout.worldSurfaceAbsAt(x));
    if(c.featureKind===WORLD_FEATURE.LANDMARK && kindOf(c)===17 && !steepCamp) {
      const heights=[];
      for(let sx=c.bounds.left;sx<=c.bounds.right;sx+=4)heights.push(scout.worldSurfaceAbsAt(sx));
      if(Math.max(...heights)-Math.min(...heights)>50)steepCamp={...c,seed};
    }
    if(c.featureKind===WORLD_FEATURE.LANDMARK && (!scenes.has(kindOf(c)) || Math.abs(x) < Math.abs((scenes.get(kindOf(c)).bounds.left + scenes.get(kindOf(c)).bounds.right) / 2))) scenes.set(kindOf(c),{...c,seed});
  }
  scout.destroy();
}
const scout=make(96);
check('all 19 landmark families have valid sites in their biomes',scenes.size===19);
let landmarks=0,villages=0,wild=0;
for(let x=-30000;x<=30000;x+=32){
  const c=scout.worldContextAt(x,scout.worldSurfaceAbsAt(x));
  landmarks+=c.featureKind===WORLD_FEATURE.LANDMARK;
  villages+=[WORLD_FEATURE.VILLAGE,WORLD_FEATURE.VILLAGE_BUILDING].includes(c.featureKind);
  wild+=c.featureKind===WORLD_FEATURE.NONE;
}
check('landmarks coexist with ordinary settlements and broad wilderness',landmarks>40 && villages>20 && wild>landmarks*2);
function move(e,x,y){
 const ox=Math.floor((x-e.cols/2)/32)*32,oy=Math.floor((y-e.rows/2)/32)*32;
 while(e.getWorldOffsetX()!==ox)e.shiftWorldXY(Math.max(32-e.cols,Math.min(e.cols-32,ox-e.getWorldOffsetX())),0);
 while(e.getWorldOffsetY()!==oy)e.shiftWorldXY(0,Math.max(32-e.rows,Math.min(e.rows-32,oy-e.getWorldOffsetY())));
}
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const cases = [...scenes];
// A steep camp exercises palisade feet beside the huts' excavated approaches.
check('a steep bone camp is available for the grounding regression', !!steepCamp);
if(steepCamp)cases.push([17,steepCamp]);
for(const [kind,c] of cases){
 const {left,top,right,bottom}=c.bounds,cx=(left+right)/2,cy=(top+bottom)/2;
 const e=make(384,c.seed);move(e,cx,cy);
 let coherent=true;
 for(let x=left;x<=right;x+=8)coherent&&=e.worldBiomeAt(x)===c.surfaceBiome;
 check(`family ${kind}: entire footprint stays within its biome`,coherent);
 const capture=en=>{
   const cells=[];for(const g of [en.getGrid(),en.getGridBg()])
   for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)cells.push(g[(y-en.getWorldOffsetY())*en.cols+x-en.getWorldOffsetX()]);
   return cells;
 };
 if([3,13,15].includes(kind)) {
   const levels=[];
   for(let x=left+2;x<=right-2;x+=4)levels.push(e.worldSurfaceAbsAt(x));
   levels.sort((a,b)=>a-b);
   const floor=kind===13?Math.min(levels[0]-2,11):levels[Math.floor(levels.length/2)]-1;
   const span=kind===3?[-78,43,-67,-30]:kind===13?[-53,53,-56,-25]:[3,77,-78,-40];
   let continuous=true;
   for(let x=span[0];x<=span[1];x++) {
     let roofing=0;
     for(let y=span[2];y<=span[3];y++) {
       const m=e.getGrid()[(floor+y-e.getWorldOffsetY())*e.cols+cx+x-e.getWorldOffsetX()];
       if((MAT_FLAGS[m]&MF.rigid) && (MAT_FLAGS[m]&MF.bearing))roofing++;
     }
     continuous&&=roofing>=2;
   }
   check(`family ${kind}: roof has no missing vertical sections`,continuous);
 }
 const initial=capture(e),wide=make(512,c.seed);move(wide,cx,cy);
 check(`family ${kind}: both layers reproduce at another viewport size`,same(initial,capture(wide)));wide.destroy();
 e.shiftWorldXY(352,0);e.shiftWorldXY(352,0);e.shiftWorldXY(-352,0);e.shiftWorldXY(-352,0);
 check(`family ${kind}: streaming restores the exact landmark`,same(initial,capture(e)));
 const anchors=[];let rooms=0,lights=0;
 for(const layer of [0,1]){
  const g=layer?e.getGridBg():e.getGrid();
  for(let y=top;y<=bottom;y++)for(let x=left+2;x<=right-2;x++){
   const k=(y-e.getWorldOffsetY())*e.cols+x-e.getWorldOffsetX(),m=g[k];
   if(y<e.worldSurfaceAbsAt(x)-2 && (MAT_FLAGS[m]&MF.rigid) && (MAT_FLAGS[m]&MF.bearing) && !(MAT_FLAGS[m]&MF.plantLeaf))anchors.push([layer,k,m]);
   if(!layer&&m===MAT.EMPTY&&e.getGridBg()[k]!==MAT.EMPTY)rooms++;
   lights+=m===MAT.LIGHT;
  }
 }
 check(`family ${kind}: substantial structure and usable interior/openings`,anchors.length>100 && (kind===6||kind===1||rooms>100));
 if(kind!==6&&kind!==1)check(`family ${kind}: interior lighting is present`,lights>0);
 for(let t=0;t<100;t++)e.stepWorld();
 const moved=anchors.filter(([layer,k,m])=>(layer?e.getGridBg():e.getGrid())[k]!==m);
 check(`family ${kind}: structural cells stay anchored (${moved.length}/${anchors.length} moved)`,moved.length===0);
 if(moved.length)console.log('  displaced sample',c.seed,cx,cy,moved.slice(0,12).map(([layer,k,m])=>({layer,x:k%e.cols+e.getWorldOffsetX(),y:Math.floor(k/e.cols)+e.getWorldOffsetY(),m})));
 e.destroy();
}
scout.destroy();
process.exitCode=done()?1:0;
