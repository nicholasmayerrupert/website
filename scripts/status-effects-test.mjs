import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { initSandWasm, createEngineWasm, PLANET, MAT, INPUT } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { STATUS_ACTOR as A, STATUS_EFFECT as S, STATUS_RESULT as R, STATUS_TAG as T, CREATURE, MISSION } from '../src/sand/wasmBridge/abi.generated.js';
import { compileStatusEffects } from './status-effect-schema.mjs';
await initSandWasm();
const options={cols:200,rows:128,worldSeed:73,sinksOn:false,planetId:PLANET.FRONTIER};
const tick=(e,n=1)=>{for(let i=0;i<n;i++)e.stepActors();};
const statuses=(e,id=1,kind=A.PLAYER)=>e.getStatusEffects().filter(s=>s.actorKind===kind&&s.actorId===id);
function run(name,fn,extra={}){
 const e=attachTestHooks(createEngineWasm({...options,...extra}));
 try{
  e.setSurvivalInventory(true);e.setCreatureRuntime(false,false);
  for(let x=0;x<200;x++)for(let y=96;y<128;y++)e.paintDisc(x,y,0,MAT.STONE,true);
  e.syncComponents();const id=e.spawnPlayer(55,88);
  fn(e,id,(effect,ticks=0,strength=1)=>e.applyStatusEffect(A.PLAYER,id,effect,ticks,strength));
  console.log('ok:',name);
 }finally{e.destroy();}
}
run('refresh preserves pulse progress and expiry; damage ignores strike immunity',(e,id,apply)=>{
 assert.equal(apply(S.BURNING,60),R.APPLIED);e._damagePlayer(id,1);tick(e,20);
 assert.equal(apply(S.BURNING,40),R.REFRESHED);tick(e,9);assert.equal(e.getPlayer(id).health,99);
 tick(e);assert.equal(e.getPlayer(id).health,96);tick(e,30);
 assert.equal(e.getPlayer(id).health,93);assert.deepEqual(statuses(e),[]);assert.equal(e.getPlayer(id).statusVisuals,0);
});
run('independent stacks expire separately, reject overflow, and cleanse together',(e,id,apply)=>{
 apply(S.POISONED,120);tick(e,30);apply(S.POISONED,120);tick(e,30);
 assert.equal(e.getPlayer(id).health,98);assert.equal(statuses(e)[0].stacks,2);
 tick(e,60);assert.equal(statuses(e)[0].stacks,1);assert.equal(statuses(e)[0].remainingTicks,30);
 for(let i=0;i<4;i++)assert.equal(apply(S.POISONED),R.APPLIED);
 assert.equal(apply(S.POISONED),R.FULL);apply(S.HASTE);
 assert.equal(e.cleanseStatusEffects(A.PLAYER,id,T.HARMFUL),5);
 assert.deepEqual(statuses(e).map(s=>s.effect),[S.HASTE]);
});
run('strength, extension caps, invalid input and water immunity',(e,id,apply)=>{
 assert.equal(apply(-1),R.INVALID);assert.equal(apply(S.BURNING,-1),R.INVALID);
 assert.equal(apply(S.CHILLED,60,2),R.APPLIED);assert.equal(apply(S.CHILLED,600,1),R.WEAKER);
 assert.equal(statuses(e)[0].remainingTicks,60);e.cleanseStatusEffects(A.PLAYER,id);
 for(let i=0;i<9;i++)apply(S.HASTE,600);
 assert.equal(statuses(e)[0].remainingTicks,1800);
 apply(S.BURNING);apply(S.WET);
 assert.ok(!statuses(e).some(s=>s.effect===S.BURNING));assert.equal(apply(S.BURNING),R.IMMUNE);
 e.removeStatusEffect(A.PLAYER,id,S.WET);assert.equal(apply(S.BURNING),R.APPLIED);
 const toad=e.spawnScriptedCreature(CREATURE.LAVA_TOAD,110+e.getWorldOffsetX(),80+e.getWorldOffsetY());
 assert.equal(e.applyStatusEffect(A.CREATURE,toad,S.BURNING),R.IMMUNE);
});
run('movement modifiers reconcile and restore; rooting blocks committed attacks',(e,id,apply)=>{
 tick(e,5);apply(S.CHILLED,90);assert.ok(Math.abs(e.getPlayer(id).statusMoveScale-.35)<1e-6);
 e.setPlayerState(id,{...e.getPlayer(id),statusMoveScale:1});assert.ok(e.getPlayer(id).statusMoveScale<.36);
 e.setPlayerInput(id,{bits:INPUT.RIGHT|INPUT.PRIMARY,aimX:90,aimY:90});tick(e);
 apply(S.ROOTED,20);const x=e.getPlayer(id).x;tick(e,19);
 assert.equal(e.getPlayer(id).x,x);assert.equal(e.getPlayer(id).actionTicks,0);
 tick(e);assert.equal(e.getPlayer(id).statusControls,0);
 e.cleanseStatusEffects(A.PLAYER,id);assert.equal(e.getPlayer(id).statusMoveScale,1);
 const mirror=createEngineWasm(options);
 try{
  const mid=mirror.spawnPlayer(55,88);apply(S.HASTE);const authoritative=e.getPlayer(id);
  mirror.setPlayerState(mid,authoritative);mirror.stepPlayerOnly(mid);
  assert.equal(mirror.getPlayer(mid).statusMoveScale,1.25);assert.deepEqual(mirror.getStatusEffects(),[]);
 }finally{mirror.destroy();}
});
run('tonics use normal inventory consumption and data-defined effects',(e,id,apply)=>{
 for(const [gear,effect] of [[322,S.REGENERATION],[323,S.HASTE],[324,null]]){
  if(gear===324)apply(S.POISONED);
  e.addGear(id,gear,1);const slot=e.getInventory(id).slots.findIndex(s=>s.definitionId===gear);
  assert.ok(slot>=0);e.setSelectedSlot(id,slot);
  e.setPlayerInput(id,{bits:INPUT.PRIMARY,aimX:90,aimY:90});tick(e);e.setPlayerInput(id,{bits:0,aimX:90,aimY:90});tick(e,65);
  assert.ok(!e.getInventory(id).slots.some(s=>s.definitionId===gear&&s.count>0));
  if(effect)assert.ok(statuses(e).some(s=>s.effect===effect));else assert.ok(!statuses(e).some(s=>s.effect===S.POISONED));
 }
});
run('save restores independent timers and periodic phase deterministically',(e,id,apply)=>{
 assert.ok(e.startMission(MISSION.FRONTIER,id));apply(S.POISONED,240);tick(e,17);apply(S.POISONED,180);apply(S.REGENERATION,500);
 const restored=createEngineWasm(options);
 try{
  assert.ok(restored.readCheckpoint(e.writeCheckpoint()));assert.deepEqual(statuses(restored),statuses(e));
  for(let i=0;i<220;i++){tick(e);tick(restored);assert.equal(restored.getPlayer(id).health,e.getPlayer(id).health);assert.deepEqual(statuses(restored),statuses(e));}
 }finally{restored.destroy();}
});
run('environment applies lingering fire and immersion extinguishes it',(e,id)=>{
 const p=e.getPlayer(id);
 e.paintDisc(Math.floor(p.x+2),Math.floor(p.y+3),3,MAT.FIRE,true);tick(e,6);
 assert.ok(statuses(e).some(s=>s.effect===S.BURNING));
 const current=e.getPlayer(id);e.paintDisc(Math.floor(current.x+2),Math.floor(current.y+3),8,MAT.WATER,true);tick(e,6);
 assert.ok(statuses(e).some(s=>s.effect===S.WET));assert.ok(!statuses(e).some(s=>s.effect===S.BURNING));
});
run('creature effects pause during hibernation and retain identity through saves',(e,id)=>{
 e.startMission(MISSION.FRONTIER,id);
 const c=e.spawnScriptedCreature(CREATURE.SHIELD_ANCHOR,110+e.getWorldOffsetX(),70+e.getWorldOffsetY());
 e.applyStatusEffect(A.CREATURE,c,S.POISONED,300,2,A.PLAYER,id);
 const original=statuses(e,c,A.CREATURE);e.shiftWorldXY(128,0);e.shiftWorldXY(128,0);e.setCreatureRuntime(true,false);tick(e);
 assert.deepEqual(statuses(e,c,A.CREATURE),[]);tick(e,80);
 const restored=createEngineWasm({...options,infinite:true});
 try{
  assert.ok(restored.readCheckpoint(e.writeCheckpoint()));
  restored.shiftWorldXY(-128,0);restored.shiftWorldXY(-128,0);restored.setCreatureRuntime(true,false);tick(restored);
  original[0].remainingTicks--;
  assert.deepEqual(statuses(restored,c,A.CREATURE),original);
 }finally{restored.destroy();}
},{infinite:true});
run('death clears effects and healing cannot revive a lethal periodic hit',(e,id,apply)=>{
 e._damagePlayer(id,90);apply(S.BURNING,60,8);apply(S.REGENERATION,60,8);tick(e,60);
 assert.equal(e.getPlayer(id).alive,false);assert.deepEqual(statuses(e),[]);
});
{
 const e=createEngineWasm({cols:160,rows:128,worldSeed:7,sinksOn:false,planetId:PLANET.FRONTIER});
 try{
  assert.ok(e.readCheckpoint(gunzipSync(readFileSync(new URL('./fixtures/status-v7.bin.gz',import.meta.url)))),'version 7 checkpoint loads');
  assert.deepEqual(statuses(e),[]);const effects=e.getStatusEffects();assert.ok(effects.some(s=>s.actorKind===A.CREATURE&&s.effect===S.BURNING&&s.remainingTicks===120));
  console.log('ok: legacy version 7 burning timer migrates to the status system');
 }finally{e.destroy();}
}
const schema=JSON.parse(readFileSync(new URL('../src/sand/abi.schema.json',import.meta.url),'utf8'));
for(const change of [d=>d.stacking='bad',d=>d.tags=['bad'],d=>d.maxStacks=50,d=>d.periodTicks=0,d=>d.movementScale=NaN]){
 const invalid=structuredClone(schema);change(invalid.enums.StatusEffect.descriptors[1]);assert.throws(()=>compileStatusEffects(invalid),/StatusEffect/);
}
console.log('ok: invalid status definitions fail generation');
