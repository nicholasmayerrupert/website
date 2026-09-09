import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startTestServer } from './browser-harness.mjs';
const dir=resolve(process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts/dinosaur');mkdirSync(dir,{recursive:true});
const server=await startTestServer();let browser;
try {
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/dinosaur-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0;background:#191b1e;color:#f0ddaf;font:16px monospace"></body>'}));
 await page.goto(`${server.baseURL}/dinosaur-fixture`);
 const results=await page.evaluate(async()=>{
  const [{initSandWasm,createEngineWasm,MAT,PLANET},{CREATURE,CREATURE_ATTACK_STATE:A,OFF,STRIDES,PROJECTILE_KIND:K},{default:art}]=await Promise.all([import('/src/sand/wasmBridge/engineFactory.js'),import('/src/sand/wasmBridge/abi.generated.js'),import('/src/sand/content/creatureArt.js')]);
  await initSandWasm();const results=[],pictures=[];
  const sprite=art.BONE_DINOSAUR;
  const sheet=document.createElement('canvas');sheet.width=1344;sheet.height=8*150;const ctx=sheet.getContext('2d');
  ctx.fillStyle='#202329';ctx.fillRect(0,0,sheet.width,sheet.height);
  for(const [row,[state,clip]]of Object.entries(Object.entries(sprite.clips))){
   ctx.fillStyle='#e9d4a6';ctx.font='14px monospace';ctx.fillText(state.toUpperCase(),12,Number(row)*150+18);
   for(let f=0;f<clip.frames.length;f++)for(let y=0;y<sprite.height;y++)for(let x=0;x<sprite.width;x++){
    const pixel=clip.frames[f][y][x];if(pixel==='.')continue;ctx.fillStyle=sprite.palette[pixel];ctx.fillRect(f*168+x,Number(row)*150+28+y,1,1);
   }
  }
  const atlas=sheet.toDataURL();
  for(const [pattern,label]of [[0,'BONECRUSHER BITE'],[1,'PREDATOR RUSH'],[2,'FURNACE BREATH']]){
   const e=createEngineWasm({cols:240,rows:160,worldSeed:73,sinksOn:false,planetId:PLANET.FRONTIER});
   e.setCreatureRuntime(false,false);e.setSurvivalInventory(true);
   for(let x=0;x<240;x++)for(let y=120;y<160;y++)e.paintDisc(x,y,0,MAT.STONE,true);
   if(pattern===2)for(let x=178;x<186;x++)for(let y=86;y<120;y++)e.paintDisc(x,y,0,MAT.WOOD,true);
   e.syncComponents();e.spawnPlayer(pattern===2?24:99,112);
   const cid=e.spawnScriptedCreature(CREATURE.BONE_DINOSAUR,68,98);
   const pose=(state,progress)=>{
    const data=e.getCreatureSnapshotData().slice(),o=OFF.creatureSnapshot;
    for(let at=0;at<data.length;at+=STRIDES.creatureSnapshot)if(data[at+o.id]===cid){
     data[at+o.x]=68;data[at+o.y]=98;data[at+o.facing]=1;data[at+o.attackPattern]=pattern;
     data[at+o.attackState]=state;data[at+o.attackProgress]=progress;
     data[at+o.aimX]=pattern===2?182:101;data[at+o.aimY]=pattern===2?110:115;
    }
    e.setMirrorCreatures(data,0,0);
   };
   const canvas=document.createElement('canvas');canvas.width=1400;canvas.height=560;document.body.append(canvas);
   e.glInit(canvas);e.glResize(1400,560);e.setViewport(1,10,140,56);e.cameraSet(45,73);e.glSetFlags(false,false,true);e.setSkyLight(215);
   const present=()=>{e.glSetCreatures(e.getCreatureSnapshotData().slice());e.glSetProjectiles(e.getProjectileSnapshotData().slice());e.glRenderFrame(true);};
   pose(A.CHARGING,.85);present();pictures.push({label:label+' · WINDUP',image:canvas.toDataURL()});
   pose(A.FIRING,1);e.setCreatureRuntime(true,false);
   const hp=e.getPlayers()[0].health,steps=pattern===2?44:pattern===1?19:9;
   for(let i=0;i<steps;i++){e.stepActors();e.stepWorld();}present();
   pictures.push({label:label+' · RELEASE',image:canvas.toDataURL()});
   results.push({pattern,breath:e.getProjectiles().filter(p=>p.kind===K.FIRE_BREATH).length,damage:hp-e.getPlayers()[0].health,x:e.getCreatures().find(c=>c.id===cid)?.x});
   if(pattern===2){for(let i=0;i<52;i++){e.stepActors();e.stepWorld();}present();pictures.push({label:'FURNACE BREATH · BURNING TERRAIN',image:canvas.toDataURL()});}
   e.destroy();canvas.remove();
  }
  document.body.innerHTML='<h1 style="margin:24px 28px 8px;font-size:26px">CINDERJAW TYRANT</h1><p style="margin:0 28px 20px;color:#ae9680">The fossil king of the bone highlands · live engine captures</p><main style="display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:0 24px 24px"></main>';
  for(const picture of pictures){const figure=document.createElement('figure');figure.style='margin:0;background:#25272b;border:1px solid #51483c';const caption=document.createElement('figcaption');caption.style='padding:12px;color:#e8c689;font-size:13px';caption.textContent=picture.label;const image=document.createElement('img');image.src=picture.image;image.style='display:block;width:100%;image-rendering:pixelated';figure.append(caption,image);document.querySelector('main').append(figure);}
  return {results,atlas};
 });
 assert.ok(results.results.find(r=>r.pattern===2).breath>=10,'slow overlapping flame packets form a sustained stream');
 assert.ok(results.results.find(r=>r.pattern===0).damage>0,'the bite lands at the jaw closure');
 assert.ok(results.results.find(r=>r.pattern===1).x>80,'the rush moves the body forward');
 assert.deepEqual(errors,[]);
 await page.screenshot({path:resolve(dir,'dinosaur.png'),fullPage:true});
 writeFileSync(resolve(dir,'sprite-atlas.png'),Buffer.from(results.atlas.split(',')[1],'base64'));
 writeFileSync(resolve(dir,'state.json'),JSON.stringify({results:results.results,errors},null,2));
 console.log(`ok: dinosaur articulated clips, melee attacks, continuous fire breath and burning terrain (${dir})`);
} finally {await browser?.close();await server.close();}
