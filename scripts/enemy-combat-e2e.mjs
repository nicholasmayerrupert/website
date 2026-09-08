import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startTestServer } from './browser-harness.mjs';
const dir=resolve(process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts/enemy-combat');mkdirSync(dir,{recursive:true});
const server=await startTestServer();let browser;
try {
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1400,height:800}});const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/enemy-art-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><body style="margin:0;background:#1b2729;color:#dfdfc7;font:16px monospace"><p style="padding:0 24px">FROST GIANT · MUMMY · LAVA TOAD · VILLAGE GUARD · HUNTER</p></body>'}));
 await page.goto(`${server.baseURL}/enemy-art-fixture`);
 await page.evaluate(async()=>{
  const [{initSandWasm,createEngineWasm,MAT,PLANET,INPUT},{CREATURE,CREATURE_ATTACK_STATE,OFF,STRIDES,PROJECTILE_KIND}]=await Promise.all([import('/src/sand/wasmBridge/engineFactory.js'),import('/src/sand/wasmBridge/abi.generated.js')]);
  await initSandWasm();const e=createEngineWasm({cols:280,rows:160,worldSeed:73,sinksOn:false,planetId:PLANET.FRONTIER});
  e.setSurvivalInventory(true);e.setCreatureRuntime(false,false);e.setBgEnabled(true);
  for(let layer=0;layer<2;layer++){
   for(let x=0;x<280;x++)for(let y=120;y<160;y++)e.paintDiscLayer(layer,x,y,0,layer?MAT.STONE:MAT.DIRT,true);
   e.syncComponentsLayer(layer);
  }
  const id=e.spawnPlayer(16,112);
  const species=[CREATURE.FROST_GIANT,CREATURE.MUMMY,CREATURE.LAVA_TOAD,CREATURE.VILLAGE_GUARD,CREATURE.VILLAGE_HUNTER];
  for(let i=0;i<species.length;i++)e.spawnScriptedCreature(species[i],50+i*44,100);
  const data=e.getCreatureSnapshotData();
  for(let at=0;at<data.length;at+=STRIDES.creatureSnapshot){data[at+OFF.creatureSnapshot.y]=120-data[at+OFF.creatureSnapshot.h];data[at+OFF.creatureSnapshot.facing]=1;}
  e.setMirrorCreatures(data,0,0);
  const canvas=document.createElement('canvas');canvas.width=1400;canvas.height=700;document.body.append(canvas);
  e.glInit(canvas);e.glResize(1400,700);e.setViewport(1,5,280,140);e.cameraSet(0,20);e.glSetFlags(false,false,true);e.setSkyLight(150);
  window.fixture={e,id,OFF,STRIDES,CREATURE_ATTACK_STATE,PROJECTILE_KIND,INPUT};e.glRenderFrame(true);
 });
 await page.screenshot({path:resolve(dir,'roster-idle.png')});
 const changed=await page.evaluate(()=>{
  const {e,OFF:o,STRIDES:s,CREATURE_ATTACK_STATE:a}=window.fixture;
  const before=e.glReadPixels(0,0,1400,700),data=e.getCreatureSnapshotData();
  for(let at=0;at<data.length;at+=s.creatureSnapshot){data[at+o.creatureSnapshot.attackState]=a.CHARGING;data[at+o.creatureSnapshot.attackProgress]=.85;data[at+o.creatureSnapshot.aimX]=data[at+o.creatureSnapshot.x]+32;data[at+o.creatureSnapshot.aimY]=114;}
  e.setMirrorCreatures(data,0,0);e.glRenderFrame(true);const after=e.glReadPixels(0,0,1400,700);
  let count=0;for(let i=0;i<before.length;i+=4)if(before[i]!==after[i]||before[i+1]!==after[i+1]||before[i+2]!==after[i+2])count++;return count;
 });
 assert.ok(changed>1000,`windup changes silhouettes and draws visible attack cues (${changed} pixels)`);
 await page.screenshot({path:resolve(dir,'roster-windup.png')});
 await page.evaluate(()=>{
  const {e,id,OFF:o,STRIDES:s,PROJECTILE_KIND:k,CREATURE_ATTACK_STATE:a,INPUT}=window.fixture;
  const data=e.getCreatureSnapshotData();for(let at=0;at<data.length;at+=s.creatureSnapshot){data[at+o.creatureSnapshot.attackState]=a.FIRING;data[at+o.creatureSnapshot.attackProgress]=.45;}
  e.setMirrorCreatures(data,0,0);
  const shots=new Float32Array(2*s.projectileSnapshot);
  for(const [i,values]of [{id:1,kind:k.RUNE,x:77,y:108,vx:.85,vy:0,fuse:309,charge:26,life:50},{id:2,kind:k.RUNE,x:166,y:108,vx:1.5,vy:.1,fuse:310,charge:20,life:50}].entries())
   for(const [key,value]of Object.entries(values))shots[i*s.projectileSnapshot+o.projectileSnapshot[key]]=value;
  e.glSetProjectiles(shots);
  e.setPlayerInput(id,{bits:INPUT.SHIELD,aimX:60,aimY:110});e.stepActors();
  e.glRenderFrame(true);
 });
 await page.screenshot({path:resolve(dir,'roster-attacks.png')});
 await page.evaluate(()=>{
  const {e,id,OFF:o,STRIDES:s,CREATURE_ATTACK_STATE:a}=window.fixture;
  const data=e.getCreatureSnapshotData();for(let at=0;at<data.length;at+=s.creatureSnapshot){data[at+o.creatureSnapshot.attackState]=a.RECOVERING;data[at+o.creatureSnapshot.attackProgress]=.5;}
  e.setMirrorCreatures(data,0,0);e.glSetProjectiles(new Float32Array(0));
  for(const [i,trophy]of [429,430,431,424,427].entries()){
   e.setPlayerState(id,{...e.getPlayer(id),x:72+i*30,y:112});e.addGear(id,trophy,1);
   const slot=e.getInventory(id).slots.findIndex(s=>s.definitionId===trophy);e.inventoryCursorPick(id,slot,false);e.throwFromCursor(id,true);
  }
  e.setPlayerState(id,{...e.getPlayer(id),x:16,y:112});for(let i=0;i<35;i++)e.stepActors();e.glRenderFrame(true);
 });
 await page.screenshot({path:resolve(dir,'trophy-drops.png')});
 await page.evaluate(()=>window.fixture.e.destroy());
 // Verify the actual worker, presentation mirror and adventure HUD boot together.
 await page.goto(`${server.baseURL}/game?nosave`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__sandTest?.getPlayers().some(p=>p.alive),null,{timeout:60000});
 await page.waitForTimeout(1200);
 await page.screenshot({path:resolve(dir,'game.png')});
 const state=await page.evaluate(()=>({players:window.__sandTest.getPlayers(),creatures:window.__sandTest.getCreatures()}));
 writeFileSync(resolve(dir,'state.json'),JSON.stringify({changed,errors,...state},null,2));
 assert.deepEqual(errors,[],'the renderer and full worker game have no page errors');
 console.log(`ok: five species, synchronized windup, elemental shots, trophy art and live game (${dir})`);
}finally{await browser?.close();await server.close();}
