import assert from 'node:assert/strict';
import { initSandWasm, createEngineWasm, MAT, PLANET, INPUT, BIOME, CAVE_BIOME, WORLD_FEATURE } from '../src/sand/wasmBridge/engineFactory.js';
import { CREATURE, MISSION, CREATURE_ATTACK_STATE, PLAYER_ANIMATION, PROJECTILE_KIND, OFF, STRIDES } from '../src/sand/wasmBridge/abi.generated.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { EQUIPMENT_BY_ID } from '../src/sand/content/equipment.js';
await initSandWasm();
const options={cols:240,rows:160,worldSeed:73,sinksOn:false,planetId:PLANET.FRONTIER};
const tick=(e,n=1)=>{for(let i=0;i<n;i++)e.stepActors();};
function arena(name,fn){
 const e=attachTestHooks(createEngineWasm(options));
 try{
  e.setSurvivalInventory(true);e.setCreatureRuntime(false,false);
  for(let x=0;x<240;x++)for(let y=120;y<160;y++)e.paintDisc(x,y,0,MAT.STONE,true);
  e.syncComponents();const id=e.spawnPlayer(35,112);fn(e,id);console.log('ok:',name);
 }finally{e.destroy();}
}
function enemy(e,species,{x=90,pattern=0,state=CREATURE_ATTACK_STATE.FIRING,aimX=36,aimY=115}={}){
 const id=e.spawnScriptedCreature(species,x+e.getWorldOffsetX(),80+e.getWorldOffsetY());
 const data=e.getCreatureSnapshotData(),o=OFF.creatureSnapshot;
 for(let at=0;at<data.length;at+=STRIDES.creatureSnapshot)if(data[at+o.id]===id){
  data[at+o.y]=120-data[at+o.h];data[at+o.attackState]=state;data[at+o.attackPattern]=pattern;
  data[at+o.attackProgress]=state===CREATURE_ATTACK_STATE.FIRING?1:0;
  data[at+o.aimX]=aimX;data[at+o.aimY]=aimY;data[at+o.facing]=aimX>=x?1:-1;
 }
 e.setMirrorCreatures(data,e.getWorldOffsetX(),e.getWorldOffsetY());e.setCreatureRuntime(true,false);return id;
}
const hold=(e,id,bits,aimX=110,aimY=115)=>e.setPlayerInput(id,{bits,aimX,aimY});
for(const species of [CREATURE.PIKE,CREATURE.CRAWLER,CREATURE.BRIAR_WOLF,CREATURE.BELL_BAT,CREATURE.MUMMY,CREATURE.BONE_GUARD]){
 arena(`physical species ${species} never conjures a fireball`,e=>{
  const id=enemy(e,species),before=e.gridHash();tick(e,18);
  assert.equal(e.getProjectiles().length,0);
  assert.equal(e.gridHash(),before,'ordinary physical attacks leave terrain intact');
  assert.equal(e.getCreatures().find(c=>c.id===id)?.attackState,CREATURE_ATTACK_STATE.RECOVERING);
 });
}
arena('shield cancels a committed sword before its damage frame',(e,id)=>{
 const foe=e.spawnScriptedCreature(CREATURE.MUMMY,47,110),hp=e.getCreatures().find(c=>c.id===foe).health;
 hold(e,id,INPUT.PRIMARY,50,115);tick(e,2);
 assert.equal(e.getPlayer(id).actionState,PLAYER_ANIMATION.SWORD);
 hold(e,id,INPUT.PRIMARY|INPUT.SHIELD,70,115);tick(e);
 assert.equal(e.getPlayer(id).shieldActive,true);
 assert.equal(e.getPlayer(id).actionState,PLAYER_ANIMATION.GUARD_RAISE);
 tick(e,24);assert.equal(e.getCreatures().find(c=>c.id===foe).health,hp,'cancelled sword never lands');
});
arena('shield cancels spells and bows without releasing stored attacks',(e,id)=>{
 e.setSelectedSlot(id,e.getInventory(id).slots.findIndex(s=>s.definitionId===300));
 hold(e,id,INPUT.PRIMARY);tick(e,2);hold(e,id,INPUT.SHIELD);tick(e,30);
 assert.equal(e.getProjectiles().length,0,'cancelled spell never launches');
 hold(e,id,0);tick(e,12);e.addGear(id,10,1);
 e.setSelectedSlot(id,e.getInventory(id).slots.findIndex(s=>s.definitionId===10));
 hold(e,id,INPUT.PRIMARY);tick(e,20);assert.ok(e.getPlayer(id).bowCharge>0);
 hold(e,id,INPUT.PRIMARY|INPUT.SHIELD);tick(e);
 assert.equal(e.getPlayer(id).bowCharge,0);assert.ok(e.getPlayer(id).shieldActive);
 hold(e,id,0);tick(e,12);assert.equal(e.getProjectiles().length,0);
});
arena('guard covers overhead strikes, sustains combat and recovers stamina',(e,id)=>{
 hold(e,id,INPUT.SHIELD,90,115);tick(e,12);
 const before=e.getPlayer(id);e._damagePlayer(id,30,38,90);
 const after=e.getPlayer(id);assert.equal(after.health,before.health);assert.ok(before.stamina-after.stamina<=15);
 tick(e,150);assert.ok(e.getPlayer(id).stamina>after.stamina,'held guard recovers during a lull');
 e._damagePlayer(id,30,10,115);assert.ok(e.getPlayer(id).health<before.health,'unguarded rear remains vulnerable');
});
arena('frost giant exhales a sustained stream and then exposes a recovery window',e=>{
 const id=enemy(e,CREATURE.FROST_GIANT),seen=new Set();
 for(let i=0;i<90;i++){
  tick(e);
  const caster=e.getCreatures().find(c=>c.id===id);
  if(i<89){assert.ok(Math.abs(caster.x-90)<.1,'the caster plants its feet');assert.equal(caster.facing,-1,'breath follows the committed facing');}
  for(const p of e.getProjectiles())if(p.kind===PROJECTILE_KIND.FROST_BREATH){
   seen.add(p.id);assert.equal(p.fuse,309);assert.ok(Math.hypot(p.vx,p.vy)>1.5);
  }
 }
 assert.equal(seen.size,30,'breath continues throughout the active phase');
 assert.equal(e.getCreatures().find(c=>c.id===id).attackState,CREATURE_ATTACK_STATE.RECOVERING);
});
arena('frost giant smash excavates the ground and ejects debris',e=>{
 enemy(e,CREATURE.FROST_GIANT,{pattern:1,aimX:78,aimY:122});
 const before=e.getGrid().filter(m=>m===MAT.STONE).length;tick(e,11);
 const removed=before-e.getGrid().filter(m=>m===MAT.STONE).length;
 assert.ok(removed>80,`smash breaks real terrain (${removed} stone cells)`);
 assert.ok(e.getItems().length>=24,'the strike ejects a visible debris fan');
 assert.ok(e._bodyCount()>0,'excavated chunks become physical debris');
 assert.ok(e.getProjectiles().some(p=>p.kind===PROJECTILE_KIND.RUNE_BURST&&p.rotation===22));
});
function iceWall(e){
 for(let x=130;x<138;x++)for(let y=80;y<120;y++)e.paintDisc(x,y,0,MAT.STONE,true);
 e.syncComponents();
}
arena('frost breath coats dry surfaces with persistent, bounded ice',e=>{
 iceWall(e);const giant=enemy(e,CREATURE.FROST_GIANT,{aimX:155,aimY:112});tick(e,45);
 assert.equal(e.getCreatures().find(c=>c.id===giant).facing,1,'moving targets cannot turn a committed stream');tick(e,45);
 const ice=e.getGrid().filter(m=>m===MAT.ICE).length;assert.ok(ice>=12,`dry wall is iced (${ice} cells)`);
 assert.ok(ice<180,'a stream leaves a surface skin rather than filling the room');
 for(let y=90;y<116;y++)assert.equal(e.getGrid()[y*e.cols+130],MAT.STONE,'the underlying wall is preserved');
 for(let i=0;i<8;i++)e.stepWorld();
 assert.ok(e.getGrid().filter(m=>m===MAT.ICE).length>=ice*.8,'component-backed ice survives simulation');
});
arena('frost giant launches a large shard which shatters and freezes its crater',e=>{
 iceWall(e);enemy(e,CREATURE.FROST_GIANT,{pattern:2,aimX:155,aimY:112});tick(e,4);
 const shot=e.getProjectiles().find(p=>p.kind===PROJECTILE_KIND.ICE_SHARD);
 assert.ok(shot);assert.ok(Math.hypot(shot.vx,shot.vy)>3);
 const before=e.getGrid().filter(m=>m===MAT.STONE).length;tick(e,20);
 assert.ok(e.getGrid().filter(m=>m===MAT.STONE).length<before,'shard fractures the wall');
 assert.ok(e.getGrid().includes(MAT.ICE),'shard impact leaves ice');
});
arena('frost projectiles preserve their phases and ice deposits through checkpoints',(e,id)=>{
 e.startMission(MISSION.FRONTIER,id);iceWall(e);
 enemy(e,CREATURE.FROST_GIANT,{aimX:155,aimY:112});
 enemy(e,CREATURE.FROST_GIANT,{x:100,pattern:2,aimX:155,aimY:112});tick(e,4);
 e.setCreatureRuntime(false,false);const restored=createEngineWasm(options);
 try{
  assert.ok(restored.readCheckpoint(e.writeCheckpoint()));restored.setCreatureRuntime(false,false);
  assert.deepEqual(restored.getProjectiles(),e.getProjectiles());
  tick(e,60);tick(restored,60);assert.equal(restored.gridHash(),e.gridHash());
 }finally{restored.destroy();}
});
function cast(e,id,gear,aimX,aimY){
 e.addGear(id,gear,1);e.setSelectedSlot(id,e.getInventory(id).slots.findIndex(s=>s.definitionId===gear));
 hold(e,id,INPUT.PRIMARY,aimX,aimY);tick(e);hold(e,id,0,aimX,aimY);tick(e,24);
}
arena('Winterbreath freezes real water and the ice survives a world tick',(e,id)=>{
 for(let y=104;y<120;y++)for(let x=64;x<74;x++)e.paintDisc(x,y,0,MAT.WATER,true);
 cast(e,id,309,70,114);tick(e,60);
 assert.ok(e.getGrid().includes(MAT.ICE));e.stepWorld();assert.ok(e.getGrid().includes(MAT.ICE));
});
arena('Cindermaw creates a bounded patch of lava and preserves projectile checkpoints',(e,id)=>{
 assert.ok(e.startMission(MISSION.FRONTIER,id));
 cast(e,id,310,92,118);
 const shot=e.getProjectiles().find(p=>p.kind===PROJECTILE_KIND.RUNE);assert.equal(shot.fuse,310);
 const restored=createEngineWasm(options);
 try{assert.ok(restored.readCheckpoint(e.writeCheckpoint()));tick(e,70);tick(restored,70);assert.equal(restored.gridHash(),e.gridHash());}finally{restored.destroy();}
 const lava=e.getGrid().filter(m=>m===MAT.LAVA).length;
 assert.ok(lava>0&&lava<=40,`bounded lava deposit (${lava})`);
});
for(const [species,trophy]of [[CREATURE.BRIAR_WOLF,424],[CREATURE.BELL_BAT,425],[CREATURE.BONE_GUARD,426],[CREATURE.FEN_WISP,427],[CREATURE.FROST_GIANT,429],[CREATURE.MUMMY,430],[CREATURE.LAVA_TOAD,431],[CREATURE.BONE_DINOSAUR,432]]){
 arena(`species ${species} guarantees its own collectable trophy`,(e,id)=>{
  assert.ok(e.startMission(MISSION.FRONTIER,id));
  const cid=enemy(e,species);e.setCreatureRuntime(false,false);
  const c=e.getCreatures().find(c=>c.id===cid);e.damageCreatures(Math.floor(c.x+c.w/2),Math.floor(c.y+c.h/2),2,10000);
  e.setCreatureRuntime(true,false);tick(e);e.setCreatureRuntime(false,false);
  const drop=e.getItems().find(i=>i.definitionId===trophy);assert.ok(drop,`signature ${trophy}`);
  assert.equal(EQUIPMENT_BY_ID[trophy].family,12);assert.equal(drop.count,1);
  e.addGear(id,trophy,3);e.addGear(id,trophy,4);
  assert.equal(e.getInventory(id).slots.find(s=>s.definitionId===trophy).count,7,'trophies stack');
  const restored=createEngineWasm(options);
  try{assert.ok(restored.readCheckpoint(e.writeCheckpoint()));assert.ok(restored.getItems().some(i=>i.definitionId===trophy));}finally{restored.destroy();}
 });
}
for(const species of [CREATURE.VILLAGE_GUARD,CREATURE.VILLAGE_HUNTER]){
 arena(`resident ${species} defends against hostiles without hurting the traveller`,(e,id)=>{
  const foe=enemy(e,CREATURE.MUMMY,{x:62,state:CREATURE_ATTACK_STATE.IDLE});
  const ally=enemy(e,species,{x:54,aimX:65,aimY:115});
  const hp=e.getPlayer(id).health,before=e.getCreatures().find(c=>c.id===foe).health;
  tick(e,10);assert.equal(e.getPlayer(id).health,hp);
  assert.ok(e.getCreatures().find(c=>c.id===foe).health<before,'defender damages a hostile');
  assert.ok(e.getCreatures().find(c=>c.id===ally).alive);
 });
}
{
 const e=attachTestHooks(createEngineWasm({...options,infinite:true,worldSeed:0xC0FFEE}));
 try{
  const found={};
  for(let x=-20000;x<=20000;x+=24){
   const surface=e.worldSurfaceAbsAt(x);
   for(let d=-72;d<1200;d+=24){
    const y=surface+d,c=e.worldContextAt(x,y);
    if(c.surfaceBiome===BIOME.TUNDRA&&d<0&&e._spawnWorldWeight(CREATURE.FROST_GIANT,x,y)>0)found.frost=[x,y];
    if(c.surfaceBiome===BIOME.DESERT&&c.featureKind===WORLD_FEATURE.LANDMARK&&e._spawnWorldWeight(CREATURE.MUMMY,x,y)>0)found.mummy=[x,y];
    if(c.caveBiome===CAVE_BIOME.DEEP_MAGMA&&d>100&&e._spawnWorldWeight(CREATURE.LAVA_TOAD,x,y)>0)found.lava=[x,y];
    if(c.surfaceBiome===BIOME.PLAINS&&d<0&&c.featureKind===WORLD_FEATURE.NONE)found.plains=[x,y];
   }
   if(Object.keys(found).length===4)break;
  }
  assert.equal(Object.keys(found).length,4,'all climate/structure fixtures found');
  for(const species of [CREATURE.FROST_GIANT,CREATURE.MUMMY,CREATURE.LAVA_TOAD])assert.equal(e._spawnWorldWeight(species,...found.plains),0);
  assert.equal(e._spawnWorldWeight(CREATURE.FROST_GIANT,...found.mummy),0);
  assert.equal(e._spawnWorldWeight(CREATURE.MUMMY,...found.frost),0);
  console.log('ok: frost giants, pyramid mummies and magma toads have exclusive habitats');
 }finally{e.destroy();}
}
// Real generated habitats, including a pyramid room above the natural surface.
{
 const e=attachTestHooks(createEngineWasm({...options,cols:512,rows:352,infinite:true,worldSeed:0xC0FFEE}));
 try {
  function moveTo(x,y){
   const ox=Math.floor((x-256)/32)*32,oy=Math.floor((y-176)/32)*32;
   while(e.getWorldOffsetX()!==ox){const d=ox-e.getWorldOffsetX();e.shiftWorldXY(Math.sign(d)*Math.min(256,Math.abs(d)),0);}
   while(e.getWorldOffsetY()!==oy){const d=oy-e.getWorldOffsetY();e.shiftWorldXY(0,Math.sign(d)*Math.min(128,Math.abs(d)));}
  }
  for(const [species,x,y]of [[CREATURE.FROST_GIANT,-1472,-25],[CREATURE.MUMMY,-4048,-88],[CREATURE.LAVA_TOAD,1136,686]]){
   moveTo(x,y);const ox=e.getWorldOffsetX(),oy=e.getWorldOffsetY(),context=e.worldContextAt(x,y);
   e.setMirrorCreatures(new Float32Array(0),ox,oy);e.setCreatureRuntime(true,false);
   const px=(species===CREATURE.MUMMY?context.bounds.left-28:x-70)-ox,py=y-oy;
   const id=e.getPlayers()[0]?.id||e.spawnPlayer(px,py);e.setPlayerState(id,{x:px,y:py,vx:0,vy:0});
   e.setViewport(1,1,64,64);e.cameraSet(px-30,py-36);
   let spawned=false;for(let salt=0;salt<80&&!spawned;salt++)spawned=e._spawnNearFocus(species,salt*997+51);
   assert.ok(spawned,`species ${species} finds a real habitat`);
   const c=e.getCreatures().find(c=>c.species===species&&c.alive),cam=e.getCam();
   assert.ok(c.x+c.w<=cam.x-20||c.x>=cam.x+84||c.y+c.h<=cam.y-20||c.y>=cam.y+84,'actual creature bounds clear the whole expanded viewport');
   assert.ok(e._spawnWorldAllowed(species,ox+c.x+c.w*.5,oy+c.y+c.h*.5));
   const absolute=[c.x+ox,c.y+oy];
   // Hibernation preserves identity instead of duplicating an encounter on return.
   for(let i=0;i<5;i++)e.shiftWorldXY(128,0);tick(e);
   for(let i=0;i<5;i++)e.shiftWorldXY(-128,0);tick(e);
   const restored=e.getCreatures().filter(a=>a.id===c.id);
   assert.equal(restored.length,1);assert.ok(Math.abs(restored[0].x+e.getWorldOffsetX()-absolute[0])<2);
   e.setMirrorCreatures(new Float32Array(0),e.getWorldOffsetX(),e.getWorldOffsetY());
   for(let i=0;i<4;i++)e.spawnScriptedCreature(CREATURE.FOX,e.getWorldOffsetX()+20+i*12,e.getWorldOffsetY()+40);
   assert.equal(e._spawnNaturalAt(species,...absolute),0,'four living hostiles suppress additional natural combatants');
   e.setMirrorCreatures(new Float32Array(0),e.getWorldOffsetX(),e.getWorldOffsetY());
   for(let i=0;i<2;i++)e.spawnScriptedCreature(CREATURE.FROST_GIANT,e.getWorldOffsetX()+20+i*24,e.getWorldOffsetY()+40);
   assert.equal(e._spawnNaturalAt(species,...absolute),0,'expensive living enemies exhaust the active threat allowance');
   console.log(`ok: natural species ${species} enters offscreen, retains streamed identity and obeys population pressure`);
  }
 }finally{e.destroy();}
}
