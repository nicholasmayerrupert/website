import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startTestServer } from './browser-harness.mjs';
const dir=resolve(process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts/frost-giant');mkdirSync(dir,{recursive:true});
const server=await startTestServer();let browser;
try{
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/frost-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0;background:#17262d;color:#ddf5ef;font:16px monospace"></body>'}));
 await page.goto(`${server.baseURL}/frost-fixture`);
 const captures=await page.evaluate(async()=>{
  const [{initSandWasm,createEngineWasm,MAT,PLANET},{CREATURE,CREATURE_ATTACK_STATE:A,OFF,STRIDES,PROJECTILE_KIND:K},{default:art}]=await Promise.all([import('/src/sand/wasmBridge/engineFactory.js'),import('/src/sand/wasmBridge/abi.generated.js'),import('/src/sand/content/creatureArt.js')]);
  await initSandWasm();const results=[],pictures=[];
  const sprite=art.FROST_GIANT, rows=[];
  for(const [state,clip]of Object.entries(sprite.clips)) {
   const grouped=['windup','attack','recover'].includes(state),count=grouped?clip.frames.length/3:clip.frames.length;
   for(let group=0;group<(grouped?3:1);group++)rows.push({label:state.toUpperCase()+(grouped?' · '+['BREATH','SMASH','SPEAR'][group]:''),frames:clip.frames.slice(group*count,(group+1)*count)});
  }
  const sheet=document.createElement('canvas');sheet.width=1088;sheet.height=rows.length*208;const ctx=sheet.getContext('2d');
  ctx.fillStyle='#202e39';ctx.fillRect(0,0,sheet.width,sheet.height);
  for(let row=0;row<rows.length;row++){
   ctx.fillStyle='#c7e8ef';ctx.font='14px monospace';ctx.fillText(rows[row].label,12,row*208+18);
   for(let f=0;f<rows[row].frames.length;f++)for(let y=0;y<sprite.height;y++)for(let x=0;x<sprite.width;x++){
    const pixel=rows[row].frames[f][y][x];if(pixel==='.')continue;ctx.fillStyle=sprite.palette[pixel];ctx.fillRect(f*136+x*2,row*208+26+y*2,2,2);
   }
  }
  const atlas=sheet.toDataURL();
  for(const [pattern,label]of [[0,'WINTERBREATH'],[1,'GLACIER SMASH'],[2,'ICE SPEAR']]){
   const e=createEngineWasm({cols:192,rows:140,worldSeed:73,sinksOn:false,planetId:PLANET.FRONTIER});
   e.setCreatureRuntime(false,false);e.setSurvivalInventory(true);
   for(let x=0;x<192;x++)for(let y=108;y<140;y++)e.paintDisc(x,y,0,MAT.STONE,true);
   if(pattern!==1)for(let x=142;x<150;x++)for(let y=74;y<108;y++)e.paintDisc(x,y,0,MAT.STONE,true);
   e.syncComponents();e.spawnPlayer(25,100);
   const cid=e.spawnScriptedCreature(CREATURE.FROST_GIANT,68,89);
   const pose=(state,progress)=>{
    const data=e.getCreatureSnapshotData().slice(),o=OFF.creatureSnapshot;
    for(let at=0;at<data.length;at+=STRIDES.creatureSnapshot)if(data[at+o.id]===cid){
     data[at+o.x]=68;data[at+o.y]=89;data[at+o.facing]=1;data[at+o.attackPattern]=pattern;
     data[at+o.attackState]=state;data[at+o.attackProgress]=progress;
     data[at+o.aimX]=pattern===1?86:148;data[at+o.aimY]=pattern===1?110:101;
    }
    e.setMirrorCreatures(data,0,0);
   };
   const canvas=document.createElement('canvas');canvas.width=1400;canvas.height=600;document.body.append(canvas);
   e.glInit(canvas);e.glResize(1400,600);e.setViewport(1,10,140,60);e.cameraSet(25,60);e.glSetFlags(false,false,true);e.setSkyLight(205);
   const present=()=>{e.glSetCreatures(e.getCreatureSnapshotData().slice());e.glSetProjectiles(e.getProjectileSnapshotData().slice());e.glRenderFrame(true);};
   pose(A.CHARGING,.85);present();pictures.push({label:label+' · WINDUP',image:canvas.toDataURL()});
   pose(A.FIRING,1);e.setCreatureRuntime(true,false);
   const steps=pattern===0?38:pattern===1?20:10;
   for(let i=0;i<steps;i++){e.stepActors();e.stepWorld();}present();
   pictures.push({label:label+' · RELEASE',image:canvas.toDataURL()});
   const shots=e.getProjectiles();results.push({pattern,breath:shots.filter(p=>p.kind===K.FROST_BREATH).length,shards:shots.filter(p=>p.kind===K.ICE_SHARD).length,particles:e.getItems().length});
   if(pattern===0){for(let i=0;i<52;i++){e.stepActors();e.stepWorld();}present();pictures.push({label:'WINTERBREATH · FROZEN SURFACES',image:canvas.toDataURL()});}
   e.destroy();canvas.remove();
  }
  document.body.innerHTML='<h1 style="margin:24px 28px 8px;font-size:24px">THE FROST GIANT</h1><p style="margin:0 28px 20px;color:#8faeb7">Windup, impact, and the terrain left behind · live engine captures</p><main style="display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:0 24px 24px"></main>';
  for(const picture of pictures){const figure=document.createElement('figure');figure.style='margin:0;background:#223740;border:1px solid #395560';const caption=document.createElement('figcaption');caption.style='padding:12px;color:#c3e8eb;font-size:13px';caption.textContent=picture.label;const image=document.createElement('img');image.src=picture.image;image.style='display:block;width:100%;image-rendering:pixelated';figure.append(caption,image);document.querySelector('main').append(figure);}
  return {results,atlas};
 });
 const {results,atlas}=captures;
 assert.ok(results.find(r=>r.pattern===0).breath>=8,'a continuous stream is replicated and rendered');
 assert.ok(results.find(r=>r.pattern===1).particles>=24,'the smash produces a debris fan');
 assert.ok(results.find(r=>r.pattern===2).shards===1,'a full-size spear is replicated and rendered');
 assert.deepEqual(errors,[]);await page.screenshot({path:resolve(dir,'frost-giant.png'),fullPage:true});
 writeFileSync(resolve(dir,'sprite-atlas.png'),Buffer.from(atlas.split(',')[1],'base64'));
 writeFileSync(resolve(dir,'state.json'),JSON.stringify({results,errors},null,2));
 console.log(`ok: frost giant windups, stream, ground smash, ice spear and aftermath (${dir})`);
}finally{await browser?.close();await server.close();}
