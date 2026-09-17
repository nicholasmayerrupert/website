import {initSandWasm,createEngineWasm,PLANET,MAT} from '../wasmBridge/engineFactory.js';
import {OFF,STRIDES,PLAYER_ANIMATION,ITEM_KIND} from '../wasmBridge/abi.generated.js';
import player from '../content/player.js';

export async function createPlayerViewer(canvas) {
  await initSandWasm();
  const engine=createEngineWasm({cols:96,rows:80,worldSeed:73,planetId:PLANET.FRONTIER,infinite:false,sinksOn:false});
  let config={styles:Array(6).fill(1),state:'walk',facing:1,weapon:1,shield:false,aim:0},tick=0,paused=false,last=0,carry=0,raf;
  const ground=60;let water=false;
  try {
    engine.setCreatureRuntime(false,false);engine.setSurvivalInventory(true);
    for(let x=0;x<96;x++)for(let y=ground;y<80;y++)engine.paintDisc(x,y,0,MAT.STONE,true);
    engine.syncComponents();const id=engine.spawnPlayer(45,ground-8);
    if(!engine.glInit(canvas))throw Error('WebGL2 required');engine.glResize(canvas.width,canvas.height);
    engine.setViewport(1,24,canvas.width/24,canvas.height/24);engine.cameraSet(48-canvas.width/48,ground+2-canvas.height/24);
    engine.glSetFlags(false,false,true);engine.setSkyLight(235);
    const base=engine.getPlayer(id),offset=OFF.glPlayerExt,record=new Float32Array(STRIDES.glPlayerExt);
    function render(){
      if(water!==(config.state==='swim')){
        water=config.state==='swim';
        for(let x=0;x<96;x++)for(let y=ground-12;y<ground;y++)engine.paintDisc(x,y,0,water?MAT.WATER:MAT.EMPTY,true);
      }
      const clip=player.clips[config.state],duration=clip.frames.reduce((n,_,i)=>n+(clip.durations?.[i]||clip.ticks),0);
      let phase=tick%duration,frame=0;while(frame<clip.frames.length-1&&phase>=(clip.durations?.[frame]||clip.ticks)){phase-=clip.durations?.[frame]||clip.ticks;frame++;}
      const state={...base,x:45,y:ground-8,facing:config.facing,own:1,alive:config.state==='death'?0:1,
        animState:PLAYER_ANIMATION[config.state.toUpperCase()],animFrame:frame,heldDefinition:config.weapon,heldItemKind:config.weapon?ITEM_KIND.GEAR:0,
        shieldActive:config.shield,shieldHealth:100,aimX:47+config.facing*Math.cos(config.aim)*30,aimY:ground-5+Math.sin(config.aim)*30,
        actionDuration:duration,actionTicks:duration-tick%duration,swordCombo:1,hurtCooldown:0};
      for(let i=0;i<6;i++)state['gear'+i]=config.styles[i]?100+(config.styles[i]-1)*6+i:0;
      state.gear6=config.shield?201:0;
      for(const [key,at] of Object.entries(offset))record[at]=Number(state[key]??0);
      engine.syncActorTick(tick);engine.glSetPlayers(true,record,id);engine.glRenderFrame(true);
      return {config:{...config,styles:[...config.styles]},frame,tick,record:Array.from(record)};
    }
    const api={select(next){config={...config,...next};tick=0;return render();},pause(){paused=true;},play(){paused=false;},step(){paused=true;tick++;return render();},seek(frame){paused=true;const clip=player.clips[config.state];tick=clip.frames.slice(0,frame).reduce((n,_,i)=>n+(clip.durations?.[i]||clip.ticks),0);return render();},inspect:render,dispose(){cancelAnimationFrame(raf);engine.destroy();}};
    function loop(now){carry+=Math.min(100,now-(last||now));last=now;if(!paused){while(carry>=1000/60){tick++;carry-=1000/60;}render();}else carry=0;raf=requestAnimationFrame(loop);}
    render();raf=requestAnimationFrame(loop);return api;
  }catch(error){engine.destroy();throw error;}
}
