import { runBrowserCases } from './browser-harness.mjs';
import { mkdirSync } from 'node:fs';
import process from 'node:process';
const artifacts='.sand-artifacts/adventure-browser';mkdirSync(artifacts,{recursive:true});
const bedCase=async({page,baseURL,check},touch)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(baseURL+'/game',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('sand-game')?._game?.getBeds().length>=3,null,{timeout:60000});
 const bed=await page.evaluate(()=>{
  const g=document.querySelector('sand-game')._game,b=g.getBeds()[0],o=window.__sandTest.worldOffset();
  g.setDayPhase(.3);window.__sandTest.setPlayerState({x:b.worldX-2-o.x,y:b.worldY-4-o.y,vx:0,vy:0});return b.id;
 });
 await page.getByRole('button',{name:'Use bed (E)',exact:true}).waitFor({state:'visible'});
 if(touch)await page.getByRole('button',{name:'Use bed (E)',exact:true}).tap();
 else {await page.locator('sand-game').evaluate(h=>h.shadowRoot.querySelector('.sg-sim').focus());await page.keyboard.press('e');}
 await page.waitForFunction(id=>document.querySelector('sand-game')._game.getPlayer().respawnBed===id,bed);
 await page.getByText('Respawn point set. You can sleep here at night.',{exact:true}).waitFor();
 check('daytime use sets spawn and explains nighttime sleep',true);
 await page.evaluate(()=>document.querySelector('sand-game')._game.setDayPhase(.9));
 await page.getByRole('button',{name:'Use bed (E)',exact:true}).click();
 await page.getByRole('dialog',{name:'Sleeping',exact:true}).waitFor();
 await page.screenshot({path:artifacts+`/player-sleep-${touch?'mobile':'desktop'}.png`});
 if(touch)await page.getByRole('button',{name:'Leave bed',exact:true}).tap();else await page.keyboard.press('Escape');
 await page.getByRole('dialog',{name:'Sleeping',exact:true}).waitFor({state:'hidden'});
 check('leave bed cancels the night skip',await page.evaluate(()=>document.querySelector('sand-game')._game.getDayNight().phase>.8));
 await page.getByRole('button',{name:'Use bed (E)',exact:true}).click();
 await page.getByRole('dialog',{name:'Sleeping',exact:true}).waitFor();
 await page.getByRole('dialog',{name:'Sleeping',exact:true}).waitFor({state:'hidden'});
 check('sleep advances the world to morning',await page.evaluate(()=>{const d=document.querySelector('sand-game')._game.getDayNight();return d.phase>.2&&d.phase<.23&&!d.overridden;}));
 const savedAt=await page.evaluate(()=>{const now=Date.now();window.dispatchEvent(new Event('pagehide'));return now;});
 await page.waitForFunction(t=>document.querySelector('sand-game')._game.getSaveState().savedAt>=t,savedAt,{timeout:30000});
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(id=>{const g=document.querySelector('sand-game')?._game;return g?.getSaveState().restored&&g.getPlayer()?.respawnBed===id;},bed,{timeout:60000});
 check('reload restores the selected bed',true);
 check('no browser errors',errors.length===0,errors.join('; '));
};
process.exitCode=await runBrowserCases({desktop:args=>bedCase(args,false),mobile:args=>bedCase(args,true)},undefined,{mobile:{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}});
