import { runBrowserCases } from './browser-harness.mjs';
import { mkdirSync } from 'node:fs';
import process from 'node:process';
const artifacts='.sand-artifacts/adventure-browser';mkdirSync(artifacts,{recursive:true});
process.exitCode=await runBrowserCases({adventure:async({page,baseURL,check})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(baseURL+'/game',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('sand-game')?._game?.getPlayer(),null,{timeout:60000});
 await page.evaluate(()=>document.fonts.load('16px "Sand Pixel"'));
 await page.getByRole('button',{name:'Journal (J)',exact:true}).waitFor();
 check('starts directly in the world',await page.getByRole('button',{name:'Start exploring'}).count()===0);
 await page.keyboard.press('j');await page.getByRole('dialog',{name:'Journal',exact:true}).waitFor();
 check('one main panel',await page.locator('[role=dialog]:visible').count()===1);
 await page.screenshot({path:artifacts+'/journal.png'});
 await page.getByRole('button',{name:'Inventory',exact:true}).click();
 await page.getByRole('button',{name:'Head: Wayfarer hood',exact:true}).waitFor();
 await page.getByRole('button',{name:'Head: Wayfarer hood',exact:true}).click();
 await page.getByRole('button',{name:'Head: Unequipped',exact:true}).waitFor();
 check('equipment updates while gameplay rests',true);
 await page.getByRole('button',{name:'Head: Unequipped',exact:true}).click();
 await page.getByRole('button',{name:'Head: Wayfarer hood',exact:true}).waitFor();
 await page.screenshot({path:artifacts+'/inventory.png'});
 await page.getByRole('button',{name:'Map',exact:true}).click();
 await page.screenshot({path:artifacts+'/map.png'});
 await page.keyboard.press('Escape');
 await page.locator('sand-game').evaluate(host=>host.shadowRoot.querySelector('.sg-sim').focus());
 const initial=await page.evaluate(()=>document.querySelector('sand-game')._game.getPlayer().x);
 await page.keyboard.down('d');await page.waitForTimeout(550);await page.keyboard.up('d');
 check('ordinary movement works after closing a panel',await page.evaluate(x=>document.querySelector('sand-game')._game.getPlayer().x>x+1,initial));
 for(let i=0;i<50;i++){
  const dx=await page.evaluate(()=>{const g=document.querySelector('sand-game')._game,v=g.getMissionView(),c=g.getChests()[0];return c.worldX-v.playerWorldX;});
  if(Math.abs(dx)<18)break;
  const key=dx<0?'a':'d';await page.keyboard.down(key);await page.waitForTimeout(90);await page.keyboard.up(key);
 }
 await page.waitForTimeout(400);
 await page.mouse.move(2,2);await page.keyboard.press('e');
 await page.getByRole('dialog',{name:'Inventory',exact:true}).waitFor();
 check('proximity alone does not open a chest',await page.getByRole('button',{name:'Take all',exact:true}).count()===0);
 await page.keyboard.press('Escape');
 const chestPoint=await page.evaluate(()=>{const host=document.querySelector('sand-game'),g=host._game,v=g.getMissionView(),c=g.getChests()[0],r=host.shadowRoot.querySelector('#sand-main').getBoundingClientRect();return {x:r.x+(c.worldX-v.cameraWorldX)/v.viewCols*r.width,y:r.y+(c.worldY+2-v.cameraWorldY)/v.viewRows*r.height};});
 await page.mouse.move(chestPoint.x,chestPoint.y);
 await page.locator('.ad-chest-prompt').waitFor({state:'visible'});
 await page.mouse.move(2,2);
 check('chest prompt clears when the pointer leaves',!(await page.locator('.ad-chest-prompt').isVisible()));
 await page.mouse.move(chestPoint.x,chestPoint.y);await page.keyboard.press('e');
 await page.getByRole('button',{name:'Take all',exact:true}).waitFor();
 await page.screenshot({path:artifacts+'/chest.png'});
 const lootedAt=await page.evaluate(()=>Date.now());
 await page.getByRole('button',{name:'Take all',exact:true}).click();
 await page.locator('.ad-loot').getByText('Empty', { exact: true }).waitFor();
 await page.waitForFunction(time=>document.querySelector('sand-game')._game.getSaveState().savedAt>time,lootedAt,{timeout:30000});
 const saved=await page.evaluate(()=>document.querySelector('sand-game')._game.getInventory());
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>{const g=document.querySelector('sand-game')?._game;return g?.getSaveState().restored && window.__sandPerf().mirrorWorldTick > 0 && g.getInventory()?.equipment?.length && g.getChests().length;},null,{timeout:60000});
 await page.waitForFunction(()=>document.querySelector('sand-game')._game.getChests()[0]?.remaining===0,null,{timeout:10000});
 check('reload restores looted chest',true);
 check('reload restores equipment',await page.evaluate(ids=>JSON.stringify(document.querySelector('sand-game')._game.getInventory().equipment.map(s=>s.definitionId))===JSON.stringify(ids),saved.equipment.map(s=>s.definitionId)));
 for(const size of [{width:900,height:650},{width:390,height:844}]){
  await page.setViewportSize(size);await page.getByRole('button',{name:'Inventory (I)',exact:true}).click();
  check(`inventory fits ${size.width}px`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'Close panel',exact:true}).click();
 }
 await page.getByRole('button',{name:'Inventory (I)',exact:true}).click();
 await page.waitForTimeout(1000);
 const recovered = await page.evaluate(async()=>{
  const {loadAdventure,saveAdventure}=await import('/src/sand/worker/adventureSaveStore.js');
  const good=await loadAdventure();await saveAdventure(good.bytes);await saveAdventure(good.bytes);
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('aster-adventures',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise((resolve,reject)=>{
   const tx=db.transaction('checkpoints','readwrite'),store=tx.objectStore('checkpoints'),keys=store.getAllKeys();
   keys.onsuccess=()=>{for(const key of keys.result)if(!key.endsWith(':previous'))store.put({bytes:new Uint8Array(32),compressed:false},key);};
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });db.close();
  const restored=await loadAdventure(),again=await loadAdventure();
  return restored.bytes.length===good.bytes.length&&restored.bytes.every((v,i)=>v===good.bytes[i])&&again.bytes.every((v,i)=>v===good.bytes[i]);
 });
 check('a corrupt latest checkpoint recovers and repairs from the previous save',recovered);
 check('no browser errors',errors.length===0,errors.join('; '));
}});
