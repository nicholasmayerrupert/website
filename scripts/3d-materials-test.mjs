import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import createModule from '../src/sand3d/wasm/voxelDemo.js';

const e=await createModule({wasmBinary:readFileSync('src/sand3d/wasm/voxelDemo.wasm')});
const V=1/16, M={air:0,sand:1,bedrock:2,stone:3,wood:4,water:8,acid:9,lava:10,steam:11,fire:12,dust:13,smoke:14};
const put=(x,y,z,m)=>e._demo_edit(x,y,z,m),get=(x,y,z)=>e._demo_cell(x,y,z);
const count=m=>e._demo_material_count(m);
const step=n=>{for(let i=0;i<n;++i)e._demo_step(1/60);};
const stats=()=>Array.from(e.HEAPF32.subarray(e._demo_stats()/4,e._demo_stats()/4+36));
const cell=(x,y,z)=>[(x+.5)*V,(y+.5)*V,(z+.5)*V];
function box(x,z,size=16) {
  for(let k=0;k<size;++k)for(let i=0;i<size;++i)for(let j=-48;j<36;++j)
    put(...cell(x+i,j,z+k),j<0||i===0||k===0||i===size-1||k===size-1?M.bedrock:M.air);
}
assert.equal(e._demo_create(0),1);
try {
  assert.ok(count(M.water)>1000&&count(M.acid)>1000&&count(M.lava)>1000,'spawn has three working material trays');
  for(const x of [128,160,192,224])box(x,160);
  step(2);
  const before=count(M.water);
  e._demo_brush(3);e._demo_tool(5);e._demo_camera(8.5,2,10.5,0,-Math.PI/2);e._demo_use();
  const poured=count(M.water);assert.ok(poured>before,'water tool adds actual liquid cells');
  const times=[];
  for(let i=0;i<120;++i){const start=performance.now();step(1);times.push(performance.now()-start);}
  assert.equal(count(M.water),poured,'falling and lateral water motion conserve volume');
  assert.equal(get(...cell(136,0,168)),M.water,'water falls to the tray floor');
  assert.ok([[130,168],[140,168],[136,162],[136,172]].some(([x,z])=>get(...cell(x,0,z))===M.water),'water spreads laterally across the floor');
  const surface=()=>{const cells=[];for(let z=161;z<175;++z)for(let x=129;x<143;++x)for(let y=0;y<6;++y)cells.push(get(...cell(x,y,z)));return cells;};
  step(180);const settled=surface();step(120);
  assert.deepEqual(surface(),settled,'a settled liquid surface does not jiggle sideways');

  // A sleeping droplet has no local diagonal opening; a distant drain must
  // wake it and use the wider downhill search without moving on level ground.
  box(-160,160,24);
  for(let z=161;z<183;++z)for(let x=-159;x<-137;++x)put(...cell(x,0,z),M.bedrock);
  put(...cell(-148,1,172),M.water);step(60);
  assert.equal(get(...cell(-148,1,172)),M.water,'an isolated droplet stays cohesive on a level shelf');
  put(...cell(-156,0,172),M.air);step(2);
  assert.equal(get(...cell(-149,1,172)),M.water,'a draining droplet moves into the next shelf cell');
  assert.equal(get(...cell(-156,0,172)),M.air,'downhill lookahead does not teleport water over a dry shelf');
  step(30);
  assert.equal(get(...cell(-156,0,172)),M.water,'opening a drain eight cells away wakes and drains a sleeping surface');
  assert.equal(get(...cell(-148,1,172)),M.air,'downhill motion conserves the source cell');

  // Diagonal searches must not pass through the corner between solid walls.
  put(...cell(-148,1,172),M.water);
  put(...cell(-147,1,172),M.bedrock);put(...cell(-148,1,173),M.bedrock);
  put(...cell(-147,0,173),M.air);step(8);
  assert.equal(get(...cell(-148,1,172)),M.water,'liquid cannot squeeze through a closed diagonal corner');
  put(...cell(-147,1,172),M.air);put(...cell(-148,1,173),M.air);step(4);
  assert.equal(get(...cell(-147,0,173)),M.water,'an open diagonal path drains normally');
  put(...cell(-152,1,176),M.bedrock);put(...cell(-156,0,176),M.air);
  put(...cell(-148,1,176),M.water);step(60);
  assert.equal(get(...cell(-148,1,176)),M.water,'a wall blocks the wider downhill search');
  put(...cell(-152,1,176),M.air);step(32);
  assert.equal(get(...cell(-156,0,176)),M.water,'opening a distant wall wakes the surface behind it');

  // A one-cell-wide terraced channel checks the complete route of a stream.
  // The high inlet is fed continuously, so every flat shelf must carry water.
  box(-224,160,32);
  const shelfHeight=x=>x<-215?4:x<-207?3:x<-199?2:1;
  for(let x=-223;x<-193;++x)for(let z=161;z<191;++z)for(let y=0;y<12;++y)
    put(...cell(x,y,z),z!==176||y<shelfHeight(x)?M.bedrock:M.air);
  const wet=new Set(),streamBefore=count(M.water);let supplied=0;
  for(let frame=0;frame<100;++frame) {
    if(frame<48&&get(...cell(-222,7,176))===M.air){put(...cell(-222,7,176),M.water);++supplied;}
    step(2);
    for(let x=-222;x<-194;++x)for(let y=shelfHeight(x);y<10;++y)
      if(get(...cell(x,y,176))===M.water)wet.add(x);
  }
  for(let x=-222;x<-195;++x)assert.ok(wet.has(x),`flow wets terrace cell ${x} instead of skipping it`);
  assert.equal(count(M.water),streamBefore+supplied,'continuous terrace flow conserves every poured cell');

  // Flow beside an acid contact must not suppress that contact's reaction.
  box(-256,160);
  put(...cell(-251,0,166),M.stone);step(2);
  while(stats()[0]%6!==0)step(1);
  put(...cell(-252,3,166),M.water);put(...cell(-251,1,166),M.acid);
  const contactRandom=Math.random;
  try {Math.random=()=>0;step(1);} finally {Math.random=contactRandom;}
  assert.notEqual(get(...cell(-251,0,166)),M.stone,'neighboring liquid movement cannot skip acid corrosion');

  // Acid rolling down a step reacts at its destination between six-tick bursts.
  for(let x=-254;x<=-242;++x)for(let z=169;z<=171;++z)for(let y=0;y<8;++y)put(...cell(x,y,z),M.bedrock);
  for(const p of [[-250,5,170],[-249,5,170],[-249,4,170]])put(...cell(...p),M.air);
  put(...cell(-249,4,171),M.stone);
  while(stats()[0]%6!==2)step(1);
  put(...cell(-250,5,170),M.acid);
  try {Math.random=()=>0.5;step(1);} finally {Math.random=contactRandom;}
  assert.equal(get(...cell(-249,4,170)),M.acid,'acid rolls down the step');
  assert.equal(get(...cell(-249,4,171)),M.air,'rolling acid corrodes its new contact on the same step');

  // More simultaneous contacts than one edit budget must all keep progressing.
  box(128,208,32);
  for(let x=129;x<159;++x)for(let z=209;z<239;++z)put(...cell(x,0,z),M.bedrock);
  const contacts=[];
  for(let x=131;x<155;x+=3)for(let z=211;z<235;z+=3) {
    contacts.push([x,0,z]);put(...cell(x,0,z),M.stone);put(...cell(x,1,z),M.acid);
  }
  try {Math.random=()=>0.5;step(20);} finally {Math.random=contactRandom;}
  assert.ok(contacts.every(p=>get(...cell(...p))!==M.stone),'the corrosion budget reaches every resting contact');

  // Acid reacts with material on an inert foundation and consumes itself.
  for(let x=165;x<169;++x)for(let z=165;z<169;++z)for(let y=0;y<4;++y)put(...cell(x,y,z),M.wood);
  for(let z=165;z<169;++z)for(let y=0;y<4;++y)put(...cell(164,y,z),M.acid);
  const acid=count(M.acid),reactionStart=stats()[35],random=Math.random;
  // Exercise both probabilistic erosion and consumption on every contact.
  try {Math.random=()=>0.1;step(180);} finally {Math.random=random;}
  let wood=0;for(let x=165;x<169;++x)for(let z=165;z<169;++z)for(let y=0;y<4;++y)wood+=get(...cell(x,y,z))===M.wood;
  assert.ok(wood<64,'acid erodes timber');assert.ok(count(M.acid)<acid,'acid is consumed while dissolving material');
  assert.ok(stats()[35]>reactionStart,'erosion reports material reactions');
  assert.equal(get(...cell(164,-1,165)),M.bedrock,'acid leaves resistant tray material intact');

  const dust=count(M.dust),vapor=count(M.steam);
  put(...cell(198,0,166),M.water);put(...cell(199,0,166),M.lava);step(2);
  assert.ok(count(M.dust)>dust,'water quenches lava into loose stone dust');
  assert.ok(count(M.steam)>vapor,'quenching produces steam');
  const acidQuench=count(M.dust);
  put(...cell(200,0,170),M.acid);put(...cell(201,0,170),M.lava);step(2);
  assert.ok(count(M.dust)>acidQuench,'acid also quenches lava, matching the 2D rule');

  for(let z=164;z<168;++z)for(let x=228;x<232;++x)for(let y=0;y<5;++y)put(...cell(x,y,z),M.wood);
  for(let z=164;z<168;++z)for(let y=0;y<5;++y)put(...cell(227,y,z),M.lava);
  const fireReactions=stats()[35];step(60);
  assert.ok(stats()[35]>fireReactions,'lava ignites flammable material');
  let timber=0;for(let z=164;z<168;++z)for(let x=228;x<232;++x)for(let y=0;y<5;++y)timber+=get(...cell(x,y,z))===M.wood;
  assert.ok(timber<80,'combustion consumes wood');
  const extinguished=stats()[35];put(...cell(230,20,172),M.fire);put(...cell(230,21,172),M.water);step(2);
  assert.ok(stats()[35]>extinguished,'water extinguishes fire');

  // A physical block contacts acid in a larger tray; erosion rebuilds its hull.
  box(272,160,32);step(2);
  for(let z=163;z<189;++z)for(let x=275;x<301;++x)for(let y=0;y<8;++y)put(...cell(x,y,z),M.acid);
  e._demo_camera(18,3,11,0,-Math.PI/2);e._demo_tool(4);e._demo_use();
  const bodyVoxels=stats()[11];assert.ok(bodyVoxels>=4096);step(120);
  assert.ok(stats()[11]<bodyVoxels,'acid erodes Box3D voxel bodies as well as static terrain');
  assert.ok(stats().every(Number.isFinite),'reaction-driven fracture keeps physics finite');

  // Modified fluid cells survive complete streaming eviction.
  e._demo_pause(1);
  const persisted=[M.water,M.acid,M.lava,M.steam,M.fire,M.dust,M.smoke];
  persisted.forEach((m,i)=>put(...cell(130+i,20,167),m));
  e._demo_camera(200,5,200,0,0);e._demo_camera(0,4,8,0,0);
  assert.deepEqual(persisted.map((_,i)=>get(...cell(130+i,20,167))),persisted,'every new material restores after unloading its chunk');
  times.sort((a,b)=>a-b);
  console.log(`3D material checks passed: flow, volume, erosion, quenching, combustion, bodies, and persistence. Fluid step p50 ${times[60].toFixed(2)} ms, p95 ${times[114].toFixed(2)} ms.`);
} finally {e._demo_destroy();}
