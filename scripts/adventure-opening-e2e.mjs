// Ordinary movement and mining complete the first NPC quest without granting materials.
import { runBrowserCases } from './browser-harness.mjs';
import { MAT } from '../src/sand/materials.js';
import { mkdirSync } from 'node:fs';
import process from 'node:process';
mkdirSync('.sand-artifacts/adventure-opening',{recursive:true});
process.exitCode=await runBrowserCases({opening:async({page,baseURL,check})=>{
 await page.goto(baseURL+'/game?nosave',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('sand-game')?._game?.getMission(),null,{timeout:60000});
 const player=()=>page.evaluate(()=>{const g=document.querySelector('sand-game')._game,v=g.getMissionView();return{...g.getPlayer(),worldX:v.playerWorldX,worldY:v.playerWorldY};});
 const focus=()=>page.locator('sand-game').evaluate(h=>h.shadowRoot.querySelector('.sg-sim').focus());
 async function walk(x){
  await focus();let last=null,stuck=0;
  for(let i=0;i<160;i++){
   const p=await player();if(!p.alive)throw Error('Died on the opening road');
   if(Math.abs(p.worldX-x)<8)return;
   stuck=last!==null&&Math.abs(p.worldX-last)<1?stuck+1:0;last=p.worldX;
   const key=p.worldX<x?'d':'a';await page.keyboard.down(key);await page.keyboard.down('Shift');
   if(stuck>1||p.worldY>12)await page.keyboard.down('Space');
   await page.waitForTimeout(180);await page.keyboard.up(key);await page.keyboard.up('Shift');await page.keyboard.up('Space');
  }
  throw Error('Road blocked: '+JSON.stringify(await player()));
 }
 async function osei(){
  const x=await page.evaluate(()=>{const g=document.querySelector('sand-game')._game;return g.getTalkableActors().find(n=>n.npcId===2)?.worldX;});
  await walk(x??96);await page.waitForTimeout(150);await page.keyboard.press('t');await page.getByRole('dialog',{name:'Conversation'}).waitFor();
 }
 await osei();await page.getByRole('button',{name:'Accept: Sparks for the mill',exact:true}).click();
 await page.keyboard.press('i');await page.getByRole('combobox',{name:'Tool footprint'}).click();await page.getByRole('option',{name:'3 × 3',exact:true}).click();await page.keyboard.press('Escape');
 await walk(445);await page.keyboard.press('2');
 console.log('Reached the ore bank');
 await page.screenshot({path:'.sand-artifacts/adventure-opening/ore-bank.png'});
 const amount=()=>page.evaluate(mat=>document.querySelector('sand-game')._game.getInventory().pools.flatMap(p=>p.entries).filter(s=>s.material===mat).reduce((n,s)=>n+s.count,0),MAT.IRON_ORE);
 for(let round=0;round<3&&await amount()<24;round++){
  for(let y=12;y<=18&&await amount()<24;y+=2)for(let x=450;x<=468&&await amount()<24;x+=2){
   const point=await page.evaluate(({x,y})=>{const t=window.__sandTest,o=t.worldOffset(),r=t.cellRect(x-o.x,y-o.y),b=document.querySelector('sand-game').getBoundingClientRect();return{x:b.x+(r.x+r.size/2)/devicePixelRatio,y:b.y+(r.y+r.size/2)/devicePixelRatio};},{x,y});
   const chest=await page.evaluate(({x,y})=>document.querySelector('sand-game')._game.getChests().some(c=>Math.abs(c.worldX-x)<=4&&y>=c.worldY-2&&y<=c.worldY+5),{x,y});
   if(chest)continue;
   await page.mouse.move(point.x,point.y);await page.mouse.down();await page.waitForTimeout(600);await page.mouse.up();
  }
  await walk(460);await page.waitForTimeout(900);console.log('Gathered ore',await amount());
 }
 check('the starter pick can collect the requested iron',await amount()>=24,`ore=${await amount()}`);
 await walk(96);await osei();await page.getByRole('button',{name:/Hand over iron ore/}).click();
 await page.waitForFunction(()=>document.querySelector('sand-game')._game.getMission().objectives[0].state===2);
 check('ordinary mining and NPC delivery complete the opening quest',true);
 await page.screenshot({path:'.sand-artifacts/adventure-opening/reward.png'});
}});
