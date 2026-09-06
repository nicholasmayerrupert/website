// Authored cave rooms retain their silhouette, entrances, and supports after
// simulation, and reproduce in both layers at streaming boundaries.
import { initSandWasm, createEngineWasm, WORLD_FEATURE, WORLD_AREA } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { MAT_FLAGS, MF } from '../src/sand/materials.generated.js';
import { makeChecker } from './sand-test-util.mjs';
await initSandWasm();
const {check,done}=makeChecker('cave architecture');
const names=['cistern','waystation','prism chapel','lapidary','apothecary','spore bells','root cloister','nursery','furnace cathedral','chain foundry','pumping hall','astral sanctuary','geode organ','lens bridge','leviathan excavation','ossuary','dig camp','hanging archive','fungal village','root engine'];
// Visually inspected generation-16 examples: kind, seed, world X, world Y.
const scenes = [
  [0, 7, 4392.5, 413],
  [1, 7, -4983, 61.5],
  [2, 7, 3033, 277.5],
  [3, 7, 3368.5, 535],
  [4, 7, 182.5, 111.5],
  [5, 7, -6023.5, 49.5],
  [6, 7, -5185, 334.5],
  [7, 7, -46, 285.5],
  [8, 7, -5673, 827],
  [9, 7, 1357, 733.5],
  [10, 7, 5091, 757.5],
  [11, 7, -3965, 828],
  [12, 7, 1802, 857],
  [13, 7, 2992.5, 863],
  [14, 7, 355.5, 993],
  [15, 7, 3514, 895],
  [16, 7, -2084, 860],
  [17, 7, 4173, 1031],
  [18, 7, 5660, 921.5],
  [19, 7, -4695.5, 1065],
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
 for(let wy=top+12;wy<floor;wy++)for(let wx=nl+3;wx<nr-2;wx++){
  open+=cell(e,0,wx,wy)===MAT.EMPTY;
  lights+=cell(e,1,wx,wy)===MAT.LIGHT;
  for(let layer=0;layer<2;layer++){
   const m=cell(e,layer,wx,wy),f=MAT_FLAGS[m];
   if((f&MF.rigid)&&(f&MF.bearing)&&!(f&MF.plantLeaf))anchors.push([layer,wx,wy,m]);
  }
 }
 for(const wx of [nl,nr])for(let wy=floor-11;wy<floor-1;wy++)doors&&=cell(e,0,wx,wy)===MAT.EMPTY;
 check(`${names[kind]}: generous usable interior and two clear doors`,open>(nr-nl)*(floor-top)*.35&&doors);
 check(`${names[kind]}: lit, substantial rear architecture`,lights>0&&anchors.length>(nr-nl)*8);
 for(let tick=0;tick<100;tick++)e.stepWorld();
 const moved=anchors.filter(([layer,wx,wy,m])=>cell(e,layer,wx,wy)!==m);
 check(`${names[kind]}: structural details remain anchored (${moved.length}/${anchors.length})`,moved.length===0);
 if(moved.length)console.log('displaced',moved.slice(0,12));
 e.destroy();
}
process.exitCode=done()?1:0;
