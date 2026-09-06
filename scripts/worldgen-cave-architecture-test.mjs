// Authored cave rooms retain their silhouette, entrances, and supports after
// simulation, and reproduce in both layers at streaming boundaries.
import { initSandWasm, createEngineWasm, WORLD_FEATURE, WORLD_AREA } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { MAT_FLAGS, MF } from '../src/sand/materials.generated.js';
import { makeChecker } from './sand-test-util.mjs';
await initSandWasm();
const {check,done}=makeChecker('cave architecture');
const names=['cistern','waystation','prism chapel','lapidary','apothecary','spore bells','root cloister','nursery','furnace cathedral','chain foundry','pumping hall','astral sanctuary','geode organ','lens bridge','leviathan excavation','ossuary','dig camp','hanging archive','fungal village','root engine'];
// Generation-21 examples: kind, seed, world X, world Y.
const scenes = [
  [0, 3053, -1706.5, 384.5],
  [1, 3053, 2176.5, 646.5],
  [2, 3053, 117.5, 450],
  [3, 3053, -118, 618],
  [4, 7, 182.5, 111.5],
  [5, 3053, -193.5, 32.5],
  [6, 7, -253.5, 354],
  [7, 7, -46, 285.5],
  [8, 3053, 92.5, 1711],
  [9, 7, -134.5, 819],
  [10, 3053, 421, 761],
  [11, 7, -777, 936],
  [12, 7, 396, 1716],
  [13, 7, -453, 1325.5],
  [14, 7, -64.5, 1747.5],
  [15, 7, 470, 1195],
  [16, 7, -1605, 1241],
  [17, 3053, -75, 861.5],
  [18, 7, -71, 1402.5],
  [19, 3053, -489, 1026.5],
];
const make=(seed,cols=384)=>createEngineWasm({cols,rows:320,worldSeed:seed,infinite:true,sinksOn:false});
function move(e,x,y){
 const ox=Math.floor((x-e.cols/2)/32)*32,oy=Math.floor((y-e.rows/2)/32)*32;
 while(e.getWorldOffsetX()!==ox)e.shiftWorldXY(Math.max(32-e.cols,Math.min(e.cols-32,ox-e.getWorldOffsetX())),0);
 while(e.getWorldOffsetY()!==oy)e.shiftWorldXY(0,Math.max(32-e.rows,Math.min(e.rows-32,oy-e.getWorldOffsetY())));
}
const same=(a,b)=>a.length===b.length&&a.every((m,i)=>m===b[i]);
check('all twenty cave designs have regression examples',scenes.length===20&&new Set(scenes.map(s=>s[0])).size===20);
for(const [kind,seed,x,y] of scenes){
 const e=make(seed);move(e,x,y);
 const sprawling=[0,1,2,5,6,9,16,18].includes(kind);
 const c=e.worldContextAt(x,y),deep=kind>=8;
 check(`${names[kind]}: planned cave structure`,c.featureKind===(deep?WORLD_FEATURE.DEEP_STRUCTURE:WORLD_FEATURE.RUIN));
 if(c.featureKind!==(deep?WORLD_FEATURE.DEEP_STRUCTURE:WORLD_FEATURE.RUIN)){e.destroy();continue;}
 const {left,top,right,bottom}=c.bounds,floor=bottom-(deep?112:32),nl=left+(deep?22:0),nr=right-(deep?22:1);
 const cell=(en,layer,wx,wy)=>(layer?en.getGridBg():en.getGrid())[(wy-en.getWorldOffsetY())*en.cols+wx-en.getWorldOffsetX()];
 const capture=en=>{
  const a=[];for(let layer=0;layer<2;layer++)for(let wy=top;wy<=bottom;wy++)for(let wx=left;wx<=right;wx++)a.push(cell(en,layer,wx,wy));return a;
 };
 check(`${names[kind]}: buried foundation is not an indoor habitat`,!(e.worldContextAt(x,floor+5).tags&WORLD_AREA.INDOOR));
 if([0,2,5,6].includes(kind))check(`${names[kind]}: a substantial upper-cave landmark`,nr-nl>=100&&floor-top>=50);
 let buried=true;for(let wx=nl;wx<=nr;wx++)buried&&=top>=e.worldSurfaceAbsAt(wx)+20;
 check(`${names[kind]}: architecture stays beneath hillside entrances`,buried);
 const initial=capture(e),wide=make(seed,512);move(wide,x,y);
 check(`${names[kind]}: viewport-independent architecture and buried feet`,same(initial,capture(wide)));wide.destroy();
 e.shiftWorldXY(352,0);e.shiftWorldXY(352,0);e.shiftWorldXY(-352,0);e.shiftWorldXY(-352,0);
 check(`${names[kind]}: exact streaming restoration`,same(initial,capture(e)));
 e.shiftWorldXY(0,288);e.shiftWorldXY(0,288);e.shiftWorldXY(0,-288);e.shiftWorldXY(0,-288);
 check(`${names[kind]}: exact vertical streaming restoration`,same(initial,capture(e)));
 let open=0,lights=0,doors=true;const anchors=[];
 let naturalGaps=0,indoor=0;
 for(let wy=top+12;wy<floor;wy++)for(let wx=nl+3;wx<nr-2;wx++){
  open+=cell(e,0,wx,wy)===MAT.EMPTY;
  if(sprawling && wx%4===0 && wy%4===0){
   if(e.worldContextAt(wx,wy).tags&WORLD_AREA.INDOOR)indoor++;
   else naturalGaps++;
  }
  lights+=cell(e,1,wx,wy)===MAT.LIGHT;
  for(let layer=0;layer<2;layer++){
   const m=cell(e,layer,wx,wy),f=MAT_FLAGS[m];
   if((f&MF.rigid)&&(f&MF.bearing)&&!(f&MF.plantLeaf))anchors.push([layer,wx,wy,m]);
  }
 }
 for(const wx of [nl,nr]) {
  let found=false;
  for(let wy=top+12;wy<=floor;wy++) {
   if(!(MAT_FLAGS[cell(e,0,wx,wy)]&MF.bearing))continue;
   let clear=true;for(let dy=1;dy<=10;dy++)clear&&=cell(e,0,wx,wy-dy)===MAT.EMPTY;
   found ||= clear;
  }
  doors &&= found;
 }
 check(`${names[kind]}: generous usable interior and two clear doors`,open>(nr-nl)*(floor-top)*(sprawling?.12:.35)&&doors);
 check(`${names[kind]}: lit, substantial rear architecture`,lights>0&&anchors.length>(nr-nl)*(sprawling?4:8));
 if(sprawling){
  check(`${names[kind]}: natural cave gaps separate the occupied wings`,naturalGaps>indoor*.25&&indoor>20);
  const w=nr-nl+1,h=floor-top+1,walk=new Uint8Array(w*h),regions=new Int32Array(w*h);let id=0;
  for(let yy=8;yy<h;yy++)for(let xx=2;xx<w-2;xx++){
   let clear=true;for(let dy=0;dy<9&&clear;dy++)for(let dx=-2;dx<=2;dx++)if(cell(e,0,nl+xx+dx,top+yy-dy)!==MAT.EMPTY){clear=false;break;}
   walk[yy*w+xx]=+clear;
  }
  for(let k=0;k<walk.length;k++)if(walk[k]&&!regions[k]){
   id++;const q=[k];regions[k]=id;
   for(let j=0;j<q.length;j++){const z=q[j],xx=z%w;for(const n of [xx?z-1:-1,xx+1<w?z+1:-1,z-w,z+w])if(n>=0&&n<walk.length&&walk[n]&&!regions[n]){regions[n]=id;q.push(n);}}
  }
  const target=new Map();let total=0;
  // Count occupiable indoor space. A foot touching a room's bounding edge
  // can otherwise misclassify an exterior rock pocket as a disconnected wing.
  for(let yy=8;yy<h;yy+=3)for(let xx=2;xx<w-2;xx+=3){
   const k=yy*w+xx;if(!walk[k])continue;
   let indoors=true;
   for(let dy=0;dy<9&&indoors;dy++)for(let dx=-2;dx<=2;dx++)
    if(!(e.worldContextAt(nl+xx+dx,top+yy-dy).tags&WORLD_AREA.INDOOR)){indoors=false;break;}
   if(indoors){total++;target.set(regions[k],(target.get(regions[k])||0)+1);}
  }
  const connected=Math.max(0,...target.values());
  check(`${names[kind]}: wings connect through player-sized passages (${connected}/${total})`,total>20&&connected>=total*.98);
 }
 for(let tick=0;tick<100;tick++)e.stepWorld();
 const moved=anchors.filter(([layer,wx,wy,m])=>cell(e,layer,wx,wy)!==m);
 check(`${names[kind]}: structural details remain anchored (${moved.length}/${anchors.length})`,moved.length===0);
 if(moved.length)console.log('displaced',moved.slice(0,12));
 e.destroy();
}
process.exitCode=done()?1:0;
