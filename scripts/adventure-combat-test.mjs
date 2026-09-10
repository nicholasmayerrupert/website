import { equipWandSpell } from './magic-fixtures.mjs';
import assert from 'node:assert/strict';
import { initSandWasm, createEngineWasm, MAT, PLANET, INPUT } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { CREATURE, PLAYER_ANIMATION, OFF, STRIDES, SOUND_EVENT } from '../src/sand/wasmBridge/abi.generated.js';
await initSandWasm();
const arena=()=>{
 const e=attachTestHooks(createEngineWasm({cols:200,rows:128,worldSeed:73,sinksOn:false,planetId:PLANET.FRONTIER}));
 e.setSurvivalInventory(true);e.setCreatureRuntime(false,false);
 for(let x=0;x<200;x++)for(let y=96;y<128;y++)e.paintDisc(x,y,0,MAT.STONE,true);
 e.syncComponents();const id=e.spawnPlayer(55,88);return {e,id};
};
function run(label,fn){const a=arena();try{fn(a.e,a.id);console.log('ok:',label);}finally{a.e.destroy();}}
const tick=(e,n=1)=>{for(let i=0;i<n;i++)e.stepActors();};
const hold=(e,id,bits,aimX=110,aimY=91)=>e.setPlayerInput(id,{bits,aimX,aimY});
const soundTypes=e=>{
 const events=e.drainSoundEvents(),types=[];
 for(let i=0;i<events.length;i+=STRIDES.soundEvent)types.push(events[i+OFF.soundEvent.type]);
 return types;
};
run('a sword cuts the air without inventing a contact sound',(e,id)=>{
 e.drainSoundEvents();hold(e,id,INPUT.PRIMARY,90,84);tick(e,1);hold(e,id,0);tick(e,12);
 const sounds=soundTypes(e);
 assert.ok(sounds.includes(SOUND_EVENT.SWING));
 assert.ok(!sounds.includes(SOUND_EVENT.IMPACT)&&!sounds.includes(SOUND_EVENT.MELEE_HIT),'a miss has no impact thud');
});

function commitEnemy(e,species,pattern=0){
 e.setCreatureRuntime(true,false);
 const enemy=e.spawnScriptedCreature(species,88+e.getWorldOffsetX(),80+e.getWorldOffsetY());
 const snapshot=e.getCreatureSnapshotData(),o=OFF.creatureSnapshot;
 snapshot[o.attackState]=2;snapshot[o.attackPattern]=pattern;snapshot[o.attackProgress]=1;
 snapshot[o.y]=96-snapshot[o.h];
 snapshot[o.aimX]=55;snapshot[o.aimY]=92;snapshot[o.facing]=-1;
 e.setMirrorCreatures(snapshot,e.getWorldOffsetX(),e.getWorldOffsetY());
 return enemy;
}
const stoneCount=grid=>grid.filter(m=>m===MAT.STONE).length;
function backgroundFloor(e){
 e.setBgEnabled(true);
 for(let x=0;x<200;x++)for(let y=96;y<128;y++)e.paintDiscLayer(1,x,y,0,MAT.STONE,true);
 e.syncComponentsLayer(1);
}
for(const species of [CREATURE.ROOT_KNIGHT,CREATURE.HOLLOW_BELLKEEPER]){
 run(`enemy ${species} fractures terrain in both layers without blast damage to itself`,(e)=>{
  backgroundFloor(e);const enemy=commitEnemy(e,species);
  const hp=e.getCreatures().find(c=>c.id===enemy).health;
  const before=[stoneCount(e.getGrid()),stoneCount(e.getGridBg())];
  tick(e,12);
  [e.getGrid(),e.getGridBg()].forEach((grid,i)=>assert.ok(before[i]-stoneCount(grid)>10,`layer ${i} has a real crater`));
  assert.equal(e.getCreatures().find(c=>c.id===enemy).health,hp,'terrain fracture does not hurt the attacker');
  assert.ok(e.getItems().some(item=>item.material===MAT.ICE),'impact throws bright flecks');
  assert.ok(soundTypes(e).includes(species===CREATURE.HOLLOW_BELLKEEPER?SOUND_EVENT.SHOCKWAVE:SOUND_EVENT.HEAVY_IMPACT),'physical impacts have their own sound');
  for(let i=0;i<3;i++)e.stepWorld();
  assert.equal(e.getGrid()[120*200+15],MAT.STONE,'undamaged stone survives component repair');
 });
}
run('an enemy spell damages the player only when its projectile arrives',(e,id)=>{
 commitEnemy(e,CREATURE.FEN_WISP);const before=e.getPlayer(id).health;
 tick(e);assert.equal(e.getPlayer(id).health,before);
 e.setCreatureRuntime(false,false);tick(e,24);
 assert.ok(e.getPlayer(id).health<before,'the traveling attack deals damage on contact');
 assert.ok(soundTypes(e).includes(SOUND_EVENT.SPELL_IMPACT));
});
for(const species of [CREATURE.FEN_WISP,CREATURE.MIRE_MATRON,CREATURE.CINDER_CASTELLAN,CREATURE.MINIGUNNER]){
 run(`enemy ${species} launches a visible shot that carves the first wall`,(e,id)=>{
  backgroundFloor(e);
  for(let layer=0;layer<2;layer++){
   for(let x=74;x<=80;x++)for(let y=50;y<96;y++)e.paintDiscLayer(layer,x,y,0,MAT.STONE,true);
   e.syncComponentsLayer(layer);
  }
  commitEnemy(e,species);const hp=e.getPlayer(id).health;
  const before=[stoneCount(e.getGrid()),stoneCount(e.getGridBg())];
  tick(e);
  assert.ok(e.getProjectiles().some(p=>p.owner<0),'the attack has a traveling projectile');
  assert.equal(e.getPlayer(id).health,hp,'the target is not hit at launch');
  e.setCreatureRuntime(false,false);tick(e,14);
  [e.getGrid(),e.getGridBg()].forEach((grid,i)=>assert.ok(before[i]-stoneCount(grid)>15,`projectile excavates layer ${i}`));
  assert.equal(e.getPlayer(id).health,hp,'the wall intercepts the shot');
 });
}
run('sword windup, stamina cost, one strike, and blocking terrain',(e,id)=>{
 const target=e.spawnScriptedCreature(CREATURE.BONE_GUARD,64+e.getWorldOffsetX(),88+e.getWorldOffsetY()),health=()=>e.getCreatures().find(c=>c.id===target).health;
 const initial=health();hold(e,id,INPUT.PRIMARY,70,91);tick(e,2);
 assert.equal(health(),initial,'windup does not deal immediate damage');assert.ok(e.getPlayer(id).stamina<100);
 hold(e,id,0);tick(e,15);assert.ok(health()<initial,'committed strike lands');
 const after=health();tick(e,30);assert.equal(health(),after,'release does not repeat attacks');
 for(let x=60;x<63;x++)for(let y=80;y<96;y++)e.paintDisc(x,y,0,MAT.STONE,true);e.syncComponents();
 hold(e,id,INPUT.PRIMARY,70,91);tick(e,1);hold(e,id,0);tick(e,16);assert.equal(health(),after,'melee cannot reach through a wall');
});
run('sword catches distant and off-axis foes in one swing',(e,id)=>{
 const ids=[[72,88],[55,75]].map(([x,y])=>e.spawnScriptedCreature(CREATURE.BONE_GUARD,x+e.getWorldOffsetX(),y+e.getWorldOffsetY()));
 const health=()=>ids.map(id=>e.getCreatures().find(c=>c.id===id).health);
 const before=health();hold(e,id,INPUT.PRIMARY,100,91);tick(e,1);hold(e,id,0);tick(e,12);
 health().forEach((hp,i)=>assert.ok(hp<before[i],`target ${i} is inside the sword sweep`));
});
run('starter wand spends mana and blasts a cavity in stone',(e,id)=>{
 equipWandSpell(e,id,300);
 for(let y=78;y<96;y++)for(let x=80;x<95;x++)e.paintDisc(x,y,0,MAT.STONE,true);
 e.syncComponents();const before=e.getGrid().filter(m=>m===MAT.STONE).length;
 hold(e,id,INPUT.PRIMARY,85,91);tick(e,1);assert.equal(e.getPlayer(id).mana,82);hold(e,id,0);tick(e,32);
 const cleared=before-e.getGrid().filter(m=>m===MAT.STONE).length;
 assert.ok(cleared>20,`blast clears a substantial cavity (${cleared} cells)`);
});
run('guard faces the hit and armor mitigates damage',(e,id)=>{
 hold(e,id,INPUT.SHIELD,90,91);tick(e,1);
 assert.equal(e.getPlayer(id).actionState,PLAYER_ANIMATION.GUARD_RAISE);
 const before=e.getPlayer(id);e._damagePlayer(id,30,85,91);const blocked=e.getPlayer(id);
 assert.equal(blocked.actionState,PLAYER_ANIMATION.GUARD_HIT);
 tick(e,12);assert.ok(e.getPlayer(id).shieldActive,'guard remains active through impact recovery');
 assert.equal(blocked.health,before.health);assert.ok(blocked.stamina<before.stamina);
 hold(e,id,0);tick(e,1);assert.equal(e.getPlayer(id).shieldActive,false,'releasing guard stops blocking immediately');
 assert.equal(e.getPlayer(id).actionState,PLAYER_ANIMATION.GUARD_RAISE,'the raise clip reverses to lower the shield');
 tick(e,34);e._damagePlayer(id,30,30,91);assert.ok(e.getPlayer(id).health>70 && e.getPlayer(id).health<100);
});
run('dodge immunity and earned air movement',(e,id)=>{
 hold(e,id,0);tick(e,2);hold(e,id,INPUT.DOWN);tick(e,1);
 assert.equal(e.getPlayer(id).actionState,PLAYER_ANIMATION.DODGE);
 e._damagePlayer(id,40);assert.equal(e.getPlayer(id).health,100);
 const p=e.getPlayer(id);e.setPlayerState(id,{...p,x:55,y:55,grounded:false,actionTicks:0,dodgeCooldown:0,movementPrevInput:0,abilities:0,stamina:100});
 hold(e,id,INPUT.DOWN);tick(e,1);assert.notEqual(e.getPlayer(id).actionState,PLAYER_ANIMATION.DASH,'air dash is not a starting ability');
 e.setPlayerState(id,{...e.getPlayer(id),abilities:3,movementPrevInput:0,dodgeCooldown:0,actionTicks:0});hold(e,id,INPUT.DOWN);tick(e,1);
 assert.equal(e.getPlayer(id).actionState,PLAYER_ANIMATION.DASH);
 e.setPlayerState(id,{...e.getPlayer(id),actionTicks:0,vy:2});hold(e,id,INPUT.JUMP);tick(e,4);assert.ok(e.getPlayer(id).vy<.5,'Windmantle limits falling speed');
});
run('Rime travels and freezes water using persistent components',(e,id)=>{
 equipWandSpell(e,id,301);
 for(let x=78;x<88;x++)for(let y=86;y<96;y++)e.paintDisc(x,y,0,MAT.WATER,true);
 hold(e,id,INPUT.PRIMARY,82,91);tick(e,1);hold(e,id,0);tick(e,30);
 assert.ok(e.getPlayer(id).mana<100);assert.ok(e.getGrid().some(m=>m===MAT.ICE),'the spell freezes water');
 e.stepWorld();assert.ok(e.getGrid().some(m=>m===MAT.ICE),'ice remains component-backed after simulation');
});
run('crafting requires the named workshop and is atomic',(e,id)=>{
 e.addToInventory(id,MAT.IRON_ORE,200);e.addToInventory(id,MAT.OAK_WOOD,200);
 const before=e.getInventory(id);assert.equal(e.craft(id,1004,false),0);assert.deepEqual(e.getInventory(id),before);
});
run('death preserves armor, weapons and relics',(e,id)=>{
 e.addGear(id,342,1);e.addGear(id,343,1);e.addToInventory(id,MAT.IRON_ORE,100);
 e._damagePlayer(id,1000);assert.equal(e.getPlayer(id).alive,false);
 assert.ok(e.getInventory(id).slots.some(s=>s.definitionId===342));assert.equal(e.getInventory(id).equipment[0].definitionId,100);
 assert.ok(e.getChests().some(c=>c.id>=8000000),'recoverable materials are kept in a Hearthwood coffer');
 assert.ok(e.respawnPlayer(id));assert.equal(e.getPlayer(id).alive,true);assert.ok(e.getInventory(id).slots.some(s=>s.definitionId===343));
});
for(const species of [CREATURE.THORNBOUND_HART,CREATURE.MIRE_MATRON,CREATURE.CINDER_CASTELLAN,CREATURE.HOLLOW_BELLKEEPER]){
 run(`boss ${species} commits a warning, strikes, and leaves a recovery window`,(e,id)=>{
  e.setCreatureRuntime(true,false);
  const boss=e.spawnScriptedCreature(species,100+e.getWorldOffsetX(),70+e.getWorldOffsetY());
  const actor=()=>e.getCreatures().find(c=>c.id===boss);
  for(let i=0;i<180&&actor().attackState!==1;i++)tick(e);
  assert.equal(actor().attackState,1,'boss enters a visible windup');
  const aim=[actor().aimX,actor().aimY],pattern=actor().attackPattern;
  e.setPlayerState(id,{...e.getPlayer(id),x:25,y:88,vx:0,vy:0});tick(e,10);
  assert.deepEqual([actor().aimX,actor().aimY],aim,'warning does not follow a dodging player');
  for(let i=0;i<80&&actor().attackState!==2;i++)tick(e);
  assert.equal(actor().attackState,2,'windup resolves into an attack');
  for(let i=0;i<60&&actor().attackState!==0;i++)tick(e);
  assert.equal(actor().attackState,0,'attack has a recovery window');
  assert.equal(actor().attackPattern,(pattern+1)%3,'next attack changes the pattern');
 });
}
run('swimming remains responsive along a partially wet bank',(e,id)=>{
 e.setPlayerState(id,{...e.getPlayer(id),x:55,y:80,grounded:false});
 for(let y=68;y<95;y++)e.paintDisc(55,y,0,MAT.WATER,true);
 hold(e,id,INPUT.JUMP);tick(e,6);
 assert.ok(e.getPlayer(id).y<79,'holding jump rises even when the bank occupies part of the body width');
});
run('spare equipment can be dropped but story relics stay with the traveller',(e,id)=>{
 e.addGear(id,106,1);let slot=e.getInventory(id).slots.findIndex(s=>s.definitionId===106);
 e.inventoryCursorPick(id,slot,false);assert.ok(e.throwFromCursor(id,true));assert.equal(e.getCursor(id),null);
 e.addGear(id,342,1);slot=e.getInventory(id).slots.findIndex(s=>s.definitionId===342);
 e.inventoryCursorPick(id,slot,false);assert.equal(e.throwFromCursor(id,true),false);assert.equal(e.getCursor(id).definitionId,342);
});
