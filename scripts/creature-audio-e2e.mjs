// Decode and render every species through the production Web Audio mixer.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startTestServer } from './browser-harness.mjs';
const dir=resolve(process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts/creature-audio');mkdirSync(dir,{recursive:true});
const server=await startTestServer();let browser;
try {
 browser=await chromium.launch({headless:true});const page=await browser.newPage();
 await page.goto(`${server.baseURL}/src/sand/audio/creatureVoices.js`);
 const result=await page.evaluate(async()=>{
  const [{createSandAudio},{AUDIO_ASSET_URLS},{CREATURE,OFF,STRIDES,SOUND_EVENT:S},{creatureSoundSpec},{BESTIARY}]=await Promise.all([
   import('/src/sand/audio/sandAudio.js'),import('/src/sand/audio/audioAssets.js'),import('/src/sand/wasmBridge/abi.generated.js'),
   import('/src/sand/audio/creatureVoices.js'),import('/src/sand/content/bestiary.js')]);
  const species=Object.entries(CREATURE),seconds=7.5,rate=32000,ctx=new OfflineAudioContext(2,rate*(seconds*species.length+2),rate);
  Object.defineProperty(ctx,'state',{get:()=> 'running'});ctx.close=async()=>{};
  ctx.createOscillator=()=>{throw new Error('Creature voices must use recordings');};
  const starts=[],makeSource=ctx.createBufferSource.bind(ctx);ctx.createBufferSource=()=>{
   const source=makeSource(),start=source.start.bind(source);source.start=(...args)=>{starts.push({source,at:args[0]});start(...args);};return source;
  };
  let decoded=0;const decode=ctx.decodeAudioData.bind(ctx);ctx.decodeAudioData=async(...args)=>{const b=await decode(...args);decoded++;return b;};
  window.AudioContext=function(){return ctx;};const mixer=createSandAudio();mixer.setMuted(false);await mixer.unlock();await mixer.assetsReady;
  if(decoded!==Object.keys(AUDIO_ASSET_URLS).length)throw new Error(`Only ${decoded} recordings decoded`);
  const event=(type,id,x=0)=>{const a=new Float32Array(STRIDES.soundEvent);a[OFF.soundEvent.type]=type;a[OFF.soundEvent.material]=id;a[OFF.soundEvent.intensity]=1;a[OFF.soundEvent.x]=x;return a;};
  const listener={x:0,y:0,viewWidth:120},types=[S.CREATURE_CALL,S.CREATURE_ATTACK,S.CREATURE,S.CREATURE_DEATH];
  const cases=species.flatMap(([key,id],index)=>types.map((type,phase)=>({key,id,type,phase,at:.1+index*seconds+phase*1.75})));
  const pauses=cases.map(c=>ctx.suspend(c.at)),rendering=ctx.startRendering();
  for(let i=0;i<cases.length;i++){
   await pauses[i];const c=cases[i],before=starts.length;
   mixer.playEvents(event(c.type,c.id),listener);
   const voices=starts.slice(before).filter(v=>!v.source.loop);
   if(!voices.length)throw new Error(`${c.key}/${c.phase} was silent`);
   if(voices.length>2)throw new Error(`${c.key} allocated too many layers`);
   c.voices=voices.length;
   await ctx.resume();
  }
  const rendered=await rendering,left=rendered.getChannelData(0),right=rendered.getChannelData(1),levels=[];
  for(const c of cases){
   let peak=0,sum=0;const start=Math.floor(c.at*rate),end=Math.min(left.length,start+rate);
   for(let i=start;i<end;i++){const v=(left[i]+right[i])*.5;if(!Number.isFinite(v))throw new Error('Nonfinite voice');peak=Math.max(peak,Math.abs(v));sum+=v*v;}
   const rms=Math.sqrt(sum/(end-start));if(peak<.002||peak>=1)throw new Error(`${c.key}/${c.phase} silent or clipped: ${peak}`);
   levels.push({species:c.key,phase:creatureSoundSpec(c.id,c.type).phase,peak,rms,voices:c.voices});
  }
  const bytes=new Uint8Array(species.length*seconds*rate*2),view=new DataView(bytes.buffer);
  for(let i=0;i<bytes.length/2;i++)view.setInt16(i*2,Math.round(Math.max(-1,Math.min(1,(left[i]+right[i])*.5))*32767),true);
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  mixer.destroy();
  // A packed crowd cannot monopolize the mix; different species remain independent.
  const crowd=new OfflineAudioContext(2,32000,32000);Object.defineProperty(crowd,'state',{get:()=> 'running'});crowd.close=async()=>{};
  const crowdStarts=[],makeCrowdSource=crowd.createBufferSource.bind(crowd);crowd.createBufferSource=()=>{const s=makeCrowdSource(),start=s.start.bind(s);s.start=(...args)=>{if(!s.loop)crowdStarts.push(s);start(...args);};return s;};
  window.AudioContext=function(){return crowd;};const crowded=createSandAudio();crowded.setMuted(false);await crowded.unlock();await crowded.assetsReady;
  const packet=new Float32Array(species.length*STRIDES.soundEvent);species.forEach(([,id],i)=>packet.set(event(S.CREATURE_ALERT,id),i*STRIDES.soundEvent));
  crowded.playEvents(packet,listener);const voiceCount=crowdStarts.length;
  if(voiceCount<4||voiceCount>8)throw new Error(`Crowd voice budget: ${voiceCount}`);
  crowded.setMuted(true);crowded.playEvents(event(S.CREATURE_DEATH,CREATURE.BONE_DINOSAUR),listener);
  if(crowdStarts.length!==voiceCount)throw new Error('Muted creature created audio');
  await crowd.startRendering();crowded.destroy();
  return {levels,decoded,voiceCount,seconds,rate,pcm:btoa(binary),species:species.map(([key,id])=>({key,id,name:BESTIARY[id]?.name||key.toLowerCase().replaceAll('_',' ')}))};
 });
 assert.equal(result.levels.length,140);
 const pcm=Buffer.from(result.pcm,'base64'),length=result.seconds*result.rate*2;
 for(let i=0;i<result.species.length;i++){
  const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(result.rate,24);header.writeUInt32LE(result.rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(length,40);
  writeFileSync(resolve(dir,`species-${result.species[i].id}.wav`),Buffer.concat([header,pcm.subarray(i*length,(i+1)*length)]));
 }
 writeFileSync(resolve(dir,'levels.json'),JSON.stringify({levels:result.levels,decoded:result.decoded,crowdVoices:result.voiceCount},null,2));
 writeFileSync(resolve(dir,'index.html'),`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Creature voices</title><style>body{margin:32px;background:#191e22;color:#ebdfc4;font:16px system-ui;max-width:1100px}h1{font-size:32px}p{color:#aeb8b5}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}article{padding:18px;border:1px solid #46514e;border-radius:8px;background:#232b2d}h2{font-size:18px;margin:0 0 12px}audio{width:100%}</style><h1>Creature voices</h1><p>All 35 species · recorded through the game mixer<br>Each clip plays: quiet call → attack → hurt → death.</p><main>${result.species.map(s=>`<article><h2>${s.name}</h2><audio controls preload="none" src="species-${s.id}.wav"></audio></article>`).join('')}</main><script>document.addEventListener('play',e=>{for(const a of document.querySelectorAll('audio'))if(a!==e.target)a.pause()},true)</script>`);
 console.log(`ok: ${result.species.length} species, ${result.levels.length} live voice cues, ${result.decoded} decoded recordings; crowd bounded to ${result.voiceCount} voices (${dir})`);
}finally{await browser?.close();await server.close();}
