import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {runBrowserCases} from './browser-harness.mjs';
const dir=resolve(process.env.SAND_TEST_ARTIFACTS||'.sand-artifacts/player-layers');mkdirSync(dir,{recursive:true});
process.exitCode=await runBrowserCases({layers:async({page,baseURL,check})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(baseURL+'/game?player');await page.waitForFunction(()=>window.__playerViewer);
 const result=await page.evaluate(async()=>{
  const {default:art}=await import('/src/sand/content/player.js');
  const api=window.__playerViewer,canvas=document.querySelector('canvas');api.pause();
  api.select({styles:Array(6).fill(0),state:'idle',weapon:0,shield:false});const bare=canvas.toDataURL(),slots=[];
  for(let style=1;style<=6;style++)for(let slot=0;slot<6;slot++){
   const styles=Array(6).fill(0);styles[slot]=style;api.select({styles});
   slots.push({style,slot,changed:canvas.toDataURL()!==bare});
  }
  const images=[];
  for(const state of Object.keys(art.clips))for(const facing of [1,-1]){
   api.select({styles:[3,1,4,2,4,5],state,facing,weapon:13,shield:state.startsWith('guard')});
   api.seek(art.clips[state].frames.length-1);images.push(canvas.toDataURL());
  }
  const swimCanvas=document.createElement('canvas');swimCanvas.width=1600;swimCanvas.height=1280;
  const swimCtx=swimCanvas.getContext('2d');swimCtx.imageSmoothingEnabled=false;
  const swimFrames=[];
  for(const facing of [1,-1])for(let frame=0;frame<8;frame++){
   api.select({state:'swim',styles:Array(6).fill(1),weapon:0,shield:false,facing});api.seek(frame);
   swimFrames.push(canvas.toDataURL());
   swimCtx.drawImage(canvas,280,100,400,320,frame%4*400,(Math.floor(frame/4)+(facing<0?2:0))*320,400,320);
  }
  const swimGallery=swimCanvas.toDataURL();
  const gallery=document.createElement('canvas');gallery.width=1200;gallery.height=900;const ctx=gallery.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.fillStyle='#1d303b';ctx.fillRect(0,0,1200,900);
  const cases=[['Wayfarer coat',{styles:[0,1,0,0,0,0],state:'idle',shield:false,weapon:0}],['Wayfarer shield',{styles:Array(6).fill(1),state:'guard',shield:true}],['Plate shield',{styles:Array(6).fill(4),state:'guard',shield:true}],['Walk contact',{styles:Array(6).fill(1),state:'walk',shield:false}],['Walk passing',{state:'walk',frame:2}],['Walk opposite',{state:'walk',frame:4}],['Dash right',{state:'dash',facing:1,weapon:1}],['Dash left',{state:'dash',facing:-1}],['Mixed mage / plate',{styles:[3,3,4,3,4,3],state:'cast',facing:1,weapon:13}]];
  cases.forEach(([label,c],i)=>{api.select({...c,facing:c.facing||1});api.seek(c.frame||0);ctx.drawImage(canvas,280,120,400,320,i%3*400,Math.floor(i/3)*300+25,400,275);ctx.fillStyle='#e0e6dc';ctx.font='16px sans-serif';ctx.fillText(label,i%3*400+10,Math.floor(i/3)*300+20);});
  api.select({state:'walk',styles:Array(6).fill(1),weapon:0,shield:false});api.play();
  return {slots,poseCount:images.length,distinct:new Set(images).size,gallery:gallery.toDataURL(),swimGallery,swimDistinct:new Set(swimFrames).size};
 });
 check('all 36 armor items visibly change their worn slot',result.slots.every(s=>s.changed),JSON.stringify(result.slots.filter(s=>!s.changed)));
 check('all 29 states render in both facings',result.poseCount===58&&result.distinct>30);
 check('eight distinct swim poses in both facings',result.swimDistinct===16,String(result.swimDistinct));
 writeFileSync(resolve(dir,'swimming.png'),Buffer.from(result.swimGallery.split(',')[1],'base64'));
 writeFileSync(resolve(dir,'player-armor.png'),Buffer.from(result.gallery.split(',')[1],'base64'));
 for(const state of ['walk','guard','dash','swim']){
  await page.getByLabel('Pose',{exact:true}).selectOption(state);
  await page.evaluate(state=>window.__playerViewer.select({shield:state==='guard'}),state);
  await page.waitForTimeout(1200);
 }
 await page.screenshot({path:resolve(dir,'workbench.png'),fullPage:true});
 check('player workbench has no browser errors',errors.length===0,errors.join('; '));
}},undefined,{layers:{viewport:{width:1200,height:1000},recordVideo:{dir,size:{width:1200,height:1000}}}});
