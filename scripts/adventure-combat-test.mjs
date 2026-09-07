import assert from 'node:assert/strict';
import { initSandWasm, createEngineWasm, MAT, PLANET, INPUT } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { CREATURE, PLAYER_ANIMATION } from '../src/sand/wasmBridge/abi.generated.js';
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
run('sword windup, stamina cost, one strike, and blocking terrain',(e,id)=>{
 const target=e.spawnScriptedCreature(CREATURE.BONE_GUARD,64+e.getWorldOffsetX(),88+e.getWorldOffsetY()),health=()=>e.getCreatures().find(c=>c.id===target).health;
 const initial=health();hold(e,id,INPUT.PRIMARY,70,91);tick(e,2);
 assert.equal(health(),initial,'windup does not deal immediate damage');assert.ok(e.getPlayer(id).stamina<100);
 hold(e,id,0);tick(e,15);assert.ok(health()<initial,'committed strike lands');
 const after=health();tick(e,30);assert.equal(health(),after,'release does not repeat attacks');
 for(let x=60;x<63;x++)for(let y=80;y<96;y++)e.paintDisc(x,y,0,MAT.STONE,true);e.syncComponents();
 hold(e,id,INPUT.PRIMARY,70,91);tick(e,1);hold(e,id,0);tick(e,16);assert.equal(health(),after,'melee cannot reach through a wall');
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
 e.addGear(id,301,1);const slot=e.getInventory(id).slots.findIndex(s=>s.definitionId===301);e.setSelectedSlot(id,slot);
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
