import { runBrowserCases } from './browser-harness.mjs';
import { mkdirSync } from 'node:fs';
const artifacts='.sand-artifacts/status-browser';mkdirSync(artifacts,{recursive:true});
process.exitCode=await runBrowserCases({ 'status-render':async({page,baseURL,check})=>{
 await page.route('**/status-render-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0;background:#171f1b;color:#eee;font:13px monospace"></body>'}));
 await page.goto(baseURL+'/status-render-fixture');
 const results=await page.evaluate(async()=>{
  const {initSandWasm,createEngineWasm}=await import('/src/sand/wasmBridge/engineFactory.js');
  const {STATUS_ACTOR:A,STATUS_EFFECT_DEFS,CREATURE,OFF,PLANET,STRIDES}=await import('/src/sand/wasmBridge/abi.generated.js');
  await initSandWasm();
  const e=createEngineWasm({cols:256,rows:160,infinite:false,sinksOn:false,worldSeed:7,planetId:PLANET.FRONTIER});
  const canvas=document.createElement('canvas');canvas.width=960;canvas.height=360;document.body.append(canvas);
  const p=e.spawnPlayer(20,35),c=e.spawnScriptedCreature(CREATURE.BRIAR_WOLF,20,72);
  e.setCreatureRuntime(false,false);e.syncActorTick(40);e.glInit(canvas);e.glResize(960,360);
  e.setViewport(1,4,240,90);e.cameraSet(0,0);e.setSkyLight(255);e.glSetFlags(false,false,true);
  e.glSetItems(new Float32Array(0));e.glSetProjectiles(new Float32Array(0));
  const players=new Float32Array(8*STRIDES.glPlayerExt),creatures=new Float32Array(8*STRIDES.creatureSnapshot);
  const defs=STATUS_EFFECT_DEFS.slice(1),results=[];
  for(let i=0;i<8;i++){
   e.cleanseStatusEffects(A.PLAYER,p);e.cleanseStatusEffects(A.CREATURE,c);
   e.applyStatusEffect(A.PLAYER,p,defs[i].id,600);e.applyStatusEffect(A.CREATURE,c,defs[i].id,600);
   const player=e.getPlayer(p),creature=e.getCreatures().find(a=>a.id===c),x=16+i*29;
   if(!player.statusVisuals||player.statusVisuals!==creature.statusVisuals)throw new Error('missing authoritative visual mask');
   for(const [field,offset]of Object.entries(OFF.glPlayerExt))players[i*STRIDES.glPlayerExt+offset]=Number(player[field]??0);
   players[i*STRIDES.glPlayerExt+OFF.glPlayerExt.x]=x;
   creatures.set(e.getCreatureSnapshotData(),i*STRIDES.creatureSnapshot);creatures[i*STRIDES.creatureSnapshot+OFF.creatureSnapshot.x]=x;
   const label=document.createElement('div');label.textContent=defs[i].name;label.style.cssText=`position:absolute;top:12px;left:${x*4-26}px;color:${defs[i].color}`;document.body.append(label);
  }
  const clear=()=>{const ps=players.slice(),cs=creatures.slice();for(let i=0;i<8;i++){ps[i*STRIDES.glPlayerExt+OFF.glPlayerExt.statusVisuals]=0;cs[i*STRIDES.creatureSnapshot+OFF.creatureSnapshot.statusVisuals]=0;}e.glSetPlayers(true,ps,p);e.glSetCreatures(cs);e.glRenderFrame(true);};
  clear();const before=e.glReadPixels(0,0,960,360);
  e.glSetPlayers(true,players,p);e.glSetCreatures(creatures);e.glRenderFrame(true);const after=e.glReadPixels(0,0,960,360);
  for(let i=0;i<8;i++)for(const [actor,y0,y1]of [['player',30,180],['creature',180,340]]){
   const center=(16+i*29)*4;let changed=0;
   for(let y=y0;y<y1;y++)for(let x=Math.max(0,center-38);x<Math.min(960,center+60);x++){
    const at=(y*960+x)*4;if(before[at]!==after[at]||before[at+1]!==after[at+1]||before[at+2]!==after[at+2])changed++;
   }
   results.push({name:`${defs[i].name} is visible on ${actor}`,ok:changed>20,detail:`${changed} changed pixels`});
  }
  clear();const cleared=e.glReadPixels(0,0,960,360);results.push({name:'removing statuses removes all visual cues',ok:cleared.every((v,i)=>v===before[i])});
  e.glSetPlayers(true,players,p);e.glSetCreatures(creatures);e.glRenderFrame(true);
  // Readback provides a stable gallery after the WebGL context is destroyed.
  const rgba=e.glReadPixels(0,0,960,360),imageCanvas=document.createElement('canvas');imageCanvas.width=960;imageCanvas.height=360;
  imageCanvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba),960,360),0,0);
  canvas.replaceWith(imageCanvas);e.destroy();return results;
 });
 await page.screenshot({path:artifacts+'/status-entity-gallery.png'});
 for(const r of results)check(r.name,r.ok,r.detail);
}});
