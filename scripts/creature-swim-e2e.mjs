import{resolve}from'node:path';import{mkdirSync,writeFileSync}from'node:fs';import{runBrowserCases}from'./browser-harness.mjs';
const dir=resolve(process.env.SAND_TEST_ARTIFACTS||'.sand-artifacts/creature-swim/browser');mkdirSync(dir,{recursive:true});
process.exitCode=await runBrowserCases({swimming:async({page,baseURL,check})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(baseURL+'/game?creature=VILLAGE_GUARD&swim');await page.waitForFunction(()=>window.__creatureViewer);
 const result=await page.evaluate(async()=>{
  const {CREATURE_ROSTER}=await import('/src/sand/studio/creatureViewerRuntime.js');
  const {default:art}=await import('/src/sand/content/creatureArt.js');
  const api=window.__creatureViewer,c=document.querySelector('[aria-label="Live creature preview"]');api.pause();
  const rows=[];
  for(const d of CREATURE_ROSTER.filter(d=>d.stats.locomotion==='CL_AMPHIBIOUS')){
   const clip=art[d.key].clips.swim,tests=[];
   const sheet=document.createElement('canvas');sheet.width=1440;sheet.height=440;const ctx=sheet.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.fillStyle='#182c35';ctx.fillRect(0,0,1440,440);
   for(const facing of[1,-1])for(const swimMotion of['horizontal','rise','still']){
    api.select({creature:d.key,mode:'swim',swimMotion,facing,travel:false});const images=[];
    for(let f=0;f<clip.frames.length;f++){
     if(f)api.step(clip.ticks*(swimMotion==='still'?2:1));images.push(c.toDataURL());
     if(facing===1&&swimMotion==='horizontal')ctx.drawImage(c,200,30,800,540,f*1440/clip.frames.length,30,1440/clip.frames.length,400);
    }
    tests.push({facing,swimMotion,unique:new Set(images).size,swimming:api.inspect().actor.swimming});
   }
   ctx.fillStyle='#f4eace';ctx.font='20px sans-serif';ctx.fillText(d.name+' · reach / pull / recover',12,24);
   rows.push({key:d.key,tests,image:sheet.toDataURL()});
  }
  api.select({creature:'VILLAGE_GUARD',water:'shallow',mode:'move'});const shallow=api.inspect().actor.swimming;
  api.select({water:'deep',swimMotion:'still'});const deep=api.inspect().actor.swimming;
  api.select({water:'dry'});const dry=api.inspect().actor.swimming;
  api.select({water:'deep',swimMotion:'horizontal',travel:false});api.play();
  return {rows,shallow,deep,dry};
 });
 for(const row of result.rows){
  check(`${row.key}: distinct strokes moving, rising and treading, both facings`,row.tests.every(t=>t.unique===3&&t.swimming===1),JSON.stringify(row.tests));
  writeFileSync(resolve(dir,row.key.toLowerCase()+'.png'),Buffer.from(row.image.split(',')[1],'base64'));delete row.image;
 }
 check('shallow/deep/dry preview transitions',result.shallow===0&&result.deep===1&&result.dry===0);
 check('no browser errors',!errors.length,errors.join('; '));
 writeFileSync(resolve(dir,'review.json'),JSON.stringify(result,null,2));
 await page.screenshot({path:resolve(dir,'workbench.png'),fullPage:true});
}},undefined,{swimming:{viewport:{width:1440,height:1000}}});
