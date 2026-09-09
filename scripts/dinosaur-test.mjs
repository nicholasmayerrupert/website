import assert from 'node:assert/strict';
import { initSandWasm,createEngineWasm,MAT,PLANET,BIOME } from '../src/sand/wasmBridge/engineFactory.js';
import { CREATURE,CREATURE_ATTACK_STATE as A,PROJECTILE_KIND as K,OFF,STRIDES,MISSION } from '../src/sand/wasmBridge/abi.generated.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
await initSandWasm();
const options={cols:240,rows:160,worldSeed:73,sinksOn:false,planetId:PLANET.FRONTIER};
const tick=(e,n=1)=>{for(let i=0;i<n;i++)e.stepActors();};
function arena(name,fn){
 const e=attachTestHooks(createEngineWasm(options));
 try{e.setCreatureRuntime(false,false);e.setSurvivalInventory(true);
  for(let x=0;x<240;x++)for(let y=120;y<160;y++)e.paintDisc(x,y,0,MAT.STONE,true);
  e.syncComponents();const id=e.spawnPlayer(28,112);fn(e,id);console.log('ok:',name);
 }finally{e.destroy();}
}
function dinosaur(e,{x=90,pattern=2,state=A.FIRING,aimX=200,aimY=110}={}){
 const id=e.spawnScriptedCreature(CREATURE.BONE_DINOSAUR,x,98),data=e.getCreatureSnapshotData().slice(),o=OFF.creatureSnapshot;
 for(let at=0;at<data.length;at+=STRIDES.creatureSnapshot)if(data[at+o.id]===id){
  data[at+o.y]=98;data[at+o.attackState]=state;data[at+o.attackPattern]=pattern;data[at+o.attackProgress]=state===A.FIRING?1:0;
  data[at+o.aimX]=aimX;data[at+o.aimY]=aimY;data[at+o.facing]=aimX>=x+12?1:-1;
 }
 e.setMirrorCreatures(data,0,0);e.setCreatureRuntime(true,false);return id;
}
arena('a full exhalation emits 32 slow pulses, locks facing and leaves a recovery opening',e=>{
 const id=dinosaur(e),seen=new Set();
 for(let i=0;i<96;i++){
  tick(e);const c=e.getCreatures().find(c=>c.id===id);
  assert.equal(c.facing,1,'a player behind the dinosaur cannot rotate the stream');assert.ok(Math.abs(c.x-90)<.1);
  for(const p of e.getProjectiles())if(p.kind===K.FIRE_BREATH){seen.add(p.id);assert.ok(Math.hypot(p.vx,p.vy)>1.4&&Math.hypot(p.vx,p.vy)<1.7);assert.equal(p.owner,-id);}
 }
 assert.equal(seen.size,32);const c=e.getCreatures().find(c=>c.id===id);assert.equal(c.attackState,A.RECOVERING);assert.equal(c.attackPattern,0);assert.equal(c.health,320);
});
for(const pattern of [0,1])arena(`melee pattern ${pattern} damages nearby players without projectiles`,(e,id)=>{
 e.setPlayerState(id,{x:119,y:112,vx:0,vy:0});dinosaur(e,{pattern,aimX:122,aimY:115});const hp=e.getPlayer(id).health;
 tick(e,pattern===0?9:25);assert.ok(e.getPlayer(id).health<hp);assert.equal(e.getProjectiles().length,0);
});
arena('stone blocks the bite and survives repeated flame impacts',e=>{
 for(let x=119;x<126;x++)for(let y=80;y<120;y++)e.paintDisc(x,y,0,MAT.STONE,true);
 e.syncComponents();const id=e.getPlayers()[0].id;e.setPlayerState(id,{x:129,y:112,vx:0,vy:0});
 dinosaur(e,{pattern:0,aimX:130,aimY:115});const hp=e.getPlayer(id).health;tick(e,10);assert.equal(e.getPlayer(id).health,hp);
 e.setMirrorCreatures(new Float32Array(),0,0);dinosaur(e,{x:64,aimX:150,aimY:110});
 const stone=e.getGrid().filter(m=>m===MAT.STONE).length;tick(e,96);
 assert.equal(e.getGrid().filter(m=>m===MAT.STONE).length,stone,'breath cannot excavate solid stone');assert.ok(e.getGrid().includes(MAT.FIRE),'the flame ignites open air at the impact');
});
arena('flame impacts ignite and consume a wooden surface',e=>{
 for(let x=170;x<178;x++)for(let y=86;y<120;y++)e.paintDisc(x,y,0,MAT.WOOD,true);
 e.syncComponents();const before=e.getGrid().filter(m=>m===MAT.WOOD).length;
 dinosaur(e,{aimX:176,aimY:110});
 for(let i=0;i<110;i++){tick(e);e.stepWorld();}
 assert.ok(e.getGrid().filter(m=>m===MAT.WOOD).length<before,'ordinary fire reactions consume the wall');
});
arena('fire breath damages its target while the caster survives its own flames',(e,id)=>{
 e.setPlayerState(id,{x:145,y:112,vx:0,vy:0});const cid=dinosaur(e,{aimX:148,aimY:115});const hp=e.getPlayer(id).health;
 for(let i=0;i<90;i++){tick(e);e.stepWorld();}
 assert.ok(e.getPlayer(id).health<hp);assert.equal(e.getCreatures().find(c=>c.id===cid).health,320);
});
arena('fire pulses and creature identity survive a checkpoint with deterministic continuation',(e,id)=>{
 e.startMission(MISSION.FRONTIER,id);const cid=dinosaur(e);tick(e,16);e.setCreatureRuntime(false,false);
 const restored=createEngineWasm(options);
 try{assert.ok(restored.readCheckpoint(e.writeCheckpoint()));restored.setCreatureRuntime(false,false);
  assert.deepEqual(restored.getProjectiles(),e.getProjectiles());assert.ok(restored.getCreatures().some(c=>c.id===cid&&c.species===CREATURE.BONE_DINOSAUR));
  tick(e,65);tick(restored,65);assert.equal(restored.gridHash(),e.gridHash());assert.deepEqual(restored.getProjectiles(),e.getProjectiles());
 }finally{restored.destroy();}
});
{
 const e=attachTestHooks(createEngineWasm({...options,cols:512,rows:352,infinite:true,worldSeed:0xC0FFEE}));
 try{
  let bone,plains;
  for(let x=0;x<12000;x+=32){const y=e.worldSurfaceAbsAt(x)-24,c=e.worldContextAt(x,y);
   if(!bone&&c.surfaceBiome===BIOME.ROCKY&&e._spawnWorldWeight(CREATURE.BONE_DINOSAUR,x,y)>0)bone=[x,y];
   if(!plains&&c.surfaceBiome===BIOME.PLAINS)plains=[x,y];if(bone&&plains)break;
  }
  assert.ok(bone&&plains);assert.equal(e._spawnWorldWeight(CREATURE.BONE_DINOSAUR,...plains),0);
  const ox=Math.floor((bone[0]-256)/32)*32,oy=Math.floor((bone[1]-176)/32)*32;
  while(e.getWorldOffsetX()!==ox){const d=ox-e.getWorldOffsetX();e.shiftWorldXY(Math.sign(d)*Math.min(256,Math.abs(d)),0);}
  while(e.getWorldOffsetY()!==oy){const d=oy-e.getWorldOffsetY();e.shiftWorldXY(0,Math.sign(d)*Math.min(128,Math.abs(d)));}
  e.setMirrorCreatures(new Float32Array(),ox,oy);e.setCreatureRuntime(true,false);
  const px=bone[0]-ox,py=bone[1]-oy;e.spawnPlayer(px,py);e.setViewport(1,1,64,64);e.cameraSet(px-32,py-32);
  let spawned=false;for(let salt=0;salt<160&&!spawned;salt++)spawned=e._spawnNearFocus(CREATURE.BONE_DINOSAUR,salt*997+51);
  assert.ok(spawned,`the large body fits a real bone-highlands habitat near ${bone}`);
  const c=e.getCreatures().find(c=>c.species===CREATURE.BONE_DINOSAUR&&c.alive);
  assert.ok(e._spawnWorldAllowed(c.species,ox+c.x+c.w*.5,oy+c.y+c.h*.5));
  assert.equal(e._spawnNaturalAt(c.species,ox+c.x+50,oy+c.y),0,'one tyrant fills the local species cap');
  for(let i=0;i<5;i++)e.shiftWorldXY(128,0);tick(e);for(let i=0;i<5;i++)e.shiftWorldXY(-128,0);tick(e);
  assert.equal(e.getCreatures().filter(a=>a.id===c.id).length,1,'streaming restores the same tyrant');
  console.log(`ok: bone-only natural spawning, large-body habitat, population cap and streaming identity (${bone})`);
 }finally{e.destroy();}
}
