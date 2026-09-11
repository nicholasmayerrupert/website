import { runBrowserCases } from './browser-harness.mjs';
import { mkdirSync } from 'node:fs';
import process from 'node:process';
const artifacts='.sand-artifacts/status-browser';mkdirSync(artifacts,{recursive:true});
process.exitCode=await runBrowserCases({ 'status-render':async({page,baseURL,check})=>{
 await page.route('**/status-render-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><body style="margin:0;background:#171f1b;color:#eee;font:13px monospace"></body>'}));
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
}, 'hurt-render': async ({ page, baseURL, check }) => {
 await page.route('**/hurt-render-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body style="margin:16px;background:#171f1b;color:#eee;font:13px monospace"><h2>Impact and electrical stun</h2><p>Normal · impact · recovery · shocked</p><main></main></body>' }));
 await page.goto(baseURL + '/hurt-render-fixture');
 const results = await page.evaluate(async () => {
  const { initSandWasm, createEngineWasm } = await import('/src/sand/wasmBridge/engineFactory.js');
  const { CREATURE, CREATURE_SPECIES_DEFS, STATUS_VISUAL, OFF, PLANET, STRIDES } = await import('/src/sand/wasmBridge/abi.generated.js');
  await initSandWasm();
  const e = createEngineWasm({ cols: 160, rows: 120, infinite: false, sinksOn: false, worldSeed: 7, planetId: PLANET.FRONTIER });
  const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 220; document.body.append(canvas);
  e.glInit(canvas); e.glResize(300, 220); e.setViewport(1, 5, 60, 44); e.cameraSet(0, 0); e.setSkyLight(255); e.glSetFlags(false, false, true);
  e.glSetItems(new Float32Array(0)); e.glSetProjectiles(new Float32Array(0));
  const same = (a, b) => a.every((v, i) => v === b[i]);
  const changes = (a, b) => a.reduce((n, v, i) => n + (i % 4 === 0 && (v !== b[i] || a[i+1] !== b[i+1] || a[i+2] !== b[i+2]) ? 1 : 0), 0);
  const results = [], gallery = new Set([-1, CREATURE.BRIAR_WOLF, CREATURE.BELL_BAT, CREATURE.MINNOW, CREATURE.FROST_GIANT, CREATURE.LAVA_TOAD, CREATURE.BONE_DINOSAUR]);
  const creatureSizes = (await (await fetch('/src/sand/abi.schema.json')).json()).enums.CreatureSpecies.descriptors;
  const subjects = [{ id: -1, name: 'Player', w: 4, h: 9 }, ...CREATURE_SPECIES_DEFS];
  for (const subject of subjects) {
   const player = subject.id === -1, offsets = player ? OFF.glPlayerExt : OFF.creatureSnapshot;
   const size = player ? subject : creatureSizes.find(c => c.id === subject.id).stats;
   const record = new Float32Array(player ? STRIDES.glPlayerExt : STRIDES.creatureSnapshot);
   const set = (name, value) => { record[offsets[name]] = value; };
   const id = subject.id + 2;
   set('id', id); set('x', (60 - size.w) / 2); set('y', 38 - size.h); set('w', size.w); set('h', size.h);
   set('health', 90); set('alive', 1); set('facing', 1);
   if (!player) { set('species', subject.id); set('maxHealth', 100); }
   const render = () => {
    e.glSetPlayers(true, player ? record : new Float32Array(0), 1);
    e.glSetCreatures(player ? new Float32Array(0) : record);
    e.glRenderFrame(true); return e.glReadPixels(0, 0, 300, 220).slice();
   };
   const tick = 200 + id * 100; e.syncActorTick(tick);
   const normal = render();
   set('hurtCooldown', 120); const immunity = render();
   results.push({ name: `${subject.name}: immunity alone does not fake a hit`, ok: same(normal, immunity) });
   set('health', 100); render(); set('health', 90);
   const impact = render(), repeated = render();
   results.push({ name: `${subject.name}: health loss produces visible hurt pose`, ok: changes(normal, impact) > 8 });
   results.push({ name: `${subject.name}: paused hit pose is stable`, ok: same(impact, repeated) });
   e.syncActorTick(tick + 7); const recovery = render();
   results.push({ name: `${subject.name}: recoil recovers after the impact`, ok: changes(impact, recovery) > 8 });
   e.syncActorTick(tick + 16); const recovered = render();
   set('id', id + 10000); const fresh = render();
   results.push({ name: `${subject.name}: hurt ends independently of immunity`, ok: same(recovered, fresh) });
   set('statusVisuals', STATUS_VISUAL.SHOCK); set('statusControls', 0); const electrified = render();
   set('statusControls', 3); const shocked = render();
   results.push({ name: `${subject.name}: electrical stun changes the body pose`, ok: changes(electrified, shocked) > 8 });
   set('statusControls', 0); const released = render();
   results.push({ name: `${subject.name}: ending stun releases the pose while electricity lingers`, ok: same(electrified, released) });
   if (gallery.has(subject.id)) {
    const row = document.createElement('section'); row.style.cssText = 'display:flex;gap:8px;position:relative;padding-top:22px';
    const title = document.createElement('b'); title.textContent = subject.name; title.style.cssText = 'position:absolute;top:2px'; row.append(title);
    for (const pixels of [normal, impact, recovery, shocked]) {
     const image = document.createElement('canvas'); image.width = 300; image.height = 220; image.style.cssText = 'width:240px;height:176px;image-rendering:pixelated';
     image.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), 300, 220), 0, 0); row.append(image);
    }
    document.querySelector('main').append(row);
   }
  }
  canvas.remove(); e.destroy(); return results;
 });
 await page.screenshot({ path: artifacts + '/hurt-entity-gallery.png', fullPage: true });
 for (const r of results) check(r.name, r.ok, r.detail);
}
});
