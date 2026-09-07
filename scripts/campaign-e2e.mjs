// The opening is navigated through normal movement and contextual conversations.
import { runBrowserCases } from './browser-harness.mjs';
import { mkdirSync } from 'node:fs';
const artifacts='.sand-artifacts/frontier-browser';mkdirSync(artifacts,{recursive:true});
process.exitCode=await runBrowserCases({hearthwood:async({page,baseURL,check})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(baseURL+'/game?nosave',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('sand-game')?._game?.getPlayer(),null,{timeout:60000});
 await page.evaluate(()=>document.fonts.load('16px "Sand Pixel"'));
 const focus=()=>page.locator('sand-game').evaluate(h=>h.shadowRoot.querySelector('.sg-sim').focus());
 async function visit(id){
  await focus();
  for(let i=0;i<100;i++){
   const dx=await page.evaluate(id=>{const g=document.querySelector('sand-game')._game,p=g.getPlayer(),c=g.getTalkableActors().find(c=>c.npcId===id);return c?c.x-p.x:null;},id);
   if(dx===null)throw Error('Missing resident '+id);if(Math.abs(dx)<5)break;
   const direction=dx<0?'a':'d';await page.keyboard.down(direction);await page.waitForTimeout(80);await page.keyboard.up(direction);
  }
  await page.waitForTimeout(150);await page.keyboard.press('t');await page.getByRole('dialog',{name:'Conversation'}).waitFor();
 }
 await visit(1);check('Vale introduces the valley through conversation',await page.getByText('Vale',{exact:true}).isVisible());
 await page.screenshot({path:artifacts+'/vale.png'});
 await page.getByRole('dialog',{name:'Conversation'}).getByRole('button',{name:'Journal',exact:true}).click();
 await page.getByRole('dialog',{name:'Journal',exact:true}).waitFor();
 check('conversation opens the shared journal',await page.locator('[role=dialog]:visible').count()===1);
 await page.keyboard.press('Escape');await visit(2);
 await page.getByRole('button',{name:'Accept: Sparks for the mill',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('sand-game')._game.getMission().objectives[0].accepted);
 check('quest is accepted from Osei',true);
 await visit(2);await page.getByRole('button',{name:'Mend the lodge',exact:true}).click();
 check('Osei offers contextual lodge restoration',await page.getByRole('dialog',{name:'Conversation'}).count()===0);
 await visit(2);await page.getByRole('button',{name:'Use the workbench',exact:true}).click();
 await page.getByRole('dialog',{name:'Inventory',exact:true}).waitFor();
 await page.getByText('AT THE WORKBENCH',{exact:true}).waitFor();
 check('workshop shares inventory',await page.locator('[role=dialog]:visible').count()===1);
 await page.screenshot({path:artifacts+'/workshop.png'});await page.keyboard.press('Escape');
 await visit(7);await page.getByRole('button',{name:'Browse wares',exact:true}).click();
 await page.getByText('IVEN’S WARES · BARTER WITH COPPER',{exact:true}).waitFor();
 check('trader shares inventory',true);await page.screenshot({path:artifacts+'/trader.png'});
 check('no browser errors',errors.length===0,errors.join('; '));
}});
