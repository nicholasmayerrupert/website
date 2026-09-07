// Chapter progression exercises physical objectives and streaming on the real engine.
import assert from 'node:assert/strict';
import { initSandWasm, createEngineWasm, MAT, PLANET } from '../src/sand/wasmBridge/engineFactory.js';
import { GAME_WORLD, GAME_CONTENT } from '../src/sand/content/catalog.js';
import { MISSION, MISSION_PHASE, OBJECTIVE_STATE } from '../src/sand/wasmBridge/abi.generated.js';
await initSandWasm();
const e=createEngineWasm({cols:640,rows:448,worldSeed:GAME_WORLD.seed,infinite:true,sinksOn:false,planetId:PLANET.FRONTIER});
try {
 e.setSurvivalInventory(true);e.setCreatureRuntime(true,false);
 const player=e.spawnPlayerAtSurface(320);assert.ok(e.startMission(MISSION.FRONTIER,player));
 const tick=(n=12)=>{for(let i=0;i<n;i++)e.stepActors();};
 const move=(x,y)=>{
  for(let i=0;i<60;i++){
   const dx=Math.round((x-e.getWorldOffsetX()-320)/32)*32,dy=Math.round((y-e.getWorldOffsetY()-224)/32)*32;
   if(!dx&&!dy)break;
   if(dx)e.shiftWorldXY(Math.max(-128,Math.min(128,dx)),0);
   if(dy)e.shiftWorldXY(0,Math.max(-96,Math.min(96,dy)));
  }
  e.setPlayerState(player,{...e.getPlayer(player),x:x-e.getWorldOffsetX(),y:y-e.getWorldOffsetY(),vx:0,vy:0});
 };
 const at=(x,y,bg=false)=>(bg?e.getGridBg():e.getGrid())[(y-e.getWorldOffsetY())*e.cols+x-e.getWorldOffsetX()];
 const objective=key=>e.getMission().objectives[GAME_WORLD.quests.findIndex(q=>q.key===key)];
 const accept=key=>{
  const index=GAME_WORLD.quests.findIndex(q=>q.key===key),quest=GAME_WORLD.quests[index];
  if(!quest.giver)return;
  const npc=GAME_WORLD.residents.find(n=>n.id===quest.giver),anchor=GAME_CONTENT.anchors[npc.anchor];
  move(anchor.x,anchor.y+(anchor.surface===-2147483648?0:e.worldSurfaceAbsAt(anchor.surface)));tick();
  const actor=e.getCreatures().find(c=>c.npcId===quest.giver);
  assert.ok(actor,`resident ${npc.dialogue.name} spawns`);
  move(actor.x+e.getWorldOffsetX(),actor.y+e.getWorldOffsetY());
  assert.ok(e.interactFrontier(player,index),`accept ${key} from its keeper`);tick();
 };
 assert.equal(e.getMission().objectives.length,20);
 assert.equal(objective('hollow-bellkeeper').state,OBJECTIVE_STATE.LOCKED);
 accept('mill-supplies');e.addToInventory(player,MAT.IRON_ORE,31);tick();
 assert.ok(e.interactFrontier(player,0));assert.equal(objective('mill-supplies').state,OBJECTIVE_STATE.COMPLETE);
 assert.equal(e.interactFrontier(player,0),false,'rewards cannot be claimed twice');tick();
 accept('mill-bridge');move(400,3);tick();
 assert.equal(objective('mill-bridge').current,0,'background guide is not a built bridge');
 for(let x=373;x<=427;x++)e.paintDisc(x-e.getWorldOffsetX(),15-e.getWorldOffsetY(),1,MAT.PINE_WOOD);
 e.syncComponents();tick();assert.equal(objective('mill-bridge').state,OBJECTIVE_STATE.COMPLETE);
 const defeat=key=>{
  accept(key);let q=objective(key);move(q.worldX+30,q.worldY-8);e.stepWorld();tick();q=objective(key);
  let boss=e.getCreatures().find(c=>c.id===q.targetActorId);assert.ok(boss,`${key} spawns its encounter`);
  const identity=boss.id;move(0,0);tick();move(q.worldX+30,q.worldY-8);tick();
  boss=e.getCreatures().find(c=>c.id===identity);assert.ok(boss,`${key} survives streaming`);
  e.damageCreatures(boss.x+boss.w/2,boss.y+boss.h/2,16,10000);tick();
  assert.equal(objective(key).state,OBJECTIVE_STATE.COMPLETE,key);
 };
 defeat('thornbound-hart');assert.equal(e.getPlayer(player).abilities&1,1,'Hart grants Gale Step');
 accept('drowned-archive');move(-480,378);tick();
 assert.equal(objective('drowned-archive').state,OBJECTIVE_STATE.ACTIVE,'flooded reading hall stays incomplete');
 e.eraseDisc(-480-e.getWorldOffsetX(),400-e.getWorldOffsetY(),15);
 for(let turn=0;turn<3000;turn++)e.stepWorld();tick();
 assert.equal(objective('drowned-archive').state,OBJECTIVE_STATE.COMPLETE,'real drainage completes the archive');
 defeat('mire-matron');assert.equal(e.getPlayer(player).abilities&2,2,'Matron grants Windmantle');
 defeat('last-shift');
 let summit=objective('windward');move(summit.worldX,summit.worldY-3);tick();
 assert.equal(objective('windward').state,OBJECTIVE_STATE.COMPLETE);
 defeat('hollow-bellkeeper');assert.equal(e.getMission().phase,MISSION_PHASE.COMPLETE,'main story resolves independently of side quests');
 for(const key of ['old-sanctuary','archive-promise','branns-gift'])defeat(key);
 accept('buried-pass');const passFloor=e.worldSurfaceAbsAt(-790)+36;move(-860,passFloor-10);tick();
 assert.equal(objective('buried-pass').state,OBJECTIVE_STATE.ACTIVE,'walking around a rockfall does not excavate it');
 e.eraseDisc(-800-e.getWorldOffsetX(),passFloor-10-e.getWorldOffsetY(),19);tick();
 assert.equal(objective('buried-pass').state,OBJECTIVE_STATE.COMPLETE);
 move(0,8);e.eraseDiscLayer(0,-80-e.getWorldOffsetX(),17-e.getWorldOffsetY(),7);e.eraseDiscLayer(1,-80-e.getWorldOffsetX(),17-e.getWorldOffsetY(),7);
 assert.equal(at(-80,17),MAT.EMPTY);assert.equal(at(-80,17,true),MAT.EMPTY);
 assert.ok(e.repairFrontierBase(player));for(let i=0;i<3;i++)e.step();assert.notEqual(at(-80,17),MAT.EMPTY);
 move(-800,passFloor-10);assert.equal(at(-800,passFloor-10),MAT.EMPTY,'repair preserves field excavation');
 assert.equal(e.getMission().phase,MISSION_PHASE.COMPLETE);
 console.log('ok: eight main quests, three minibosses, earned traversal, physical bridge/drain/passage, streaming, and scoped repairs');
} finally {e.destroy();}
