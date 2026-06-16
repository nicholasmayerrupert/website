import { createEngine } from '../src/sand/engine.js';
import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';
import { mulberry32 } from '../src/sand/rng.js';
const COLS=120, ROWS=90, SEED=0xC0FFEE;
await initSandWasm();
const mk = (k)=> k==='js'
  ? createEngine({cols:COLS,rows:ROWS,rng:mulberry32(SEED),sinksOn:false,emittersOn:false})
  : createEngineWasm({cols:COLS,rows:ROWS,worldSeed:SEED,sinksOn:false});
function run(k){
  const e=mk(k);
  // stone floor
  for(let x=10;x<110;x++) for(let y=86;y<90;y++) e.addDiscToStoneDraft(x,y,0);
  e.finalizeStoneDraft();
  // 12x12 cube centered at (60,20)
  const cells=[]; for(let dx=-6;dx<6;dx++) for(let dy=-6;dy<6;dy++) cells.push([60+dx,20+dy]);
  e.spawnBody(cells);
  let now=0, maxRejected=0;
  for(let s=0;s<320;s++){ now+=16; e.step(now); }
  // count RIGID cells + lowest rigid row
  const g=e.getGrid(); let rigid=0, maxY=0;
  for(let i=0;i<g.length;i++) if(g[i]===13){ rigid++; const y=(i/COLS)|0; if(y>maxY) maxY=y; }
  const bc = e._bodyCount ? e._bodyCount() : (e.getBodies?e.getBodies().length:-1);
  const blocked = e._bodyBlocked ? e._bodyBlocked(0) : (e.getBodies?e.bodyFootprintBlocked(e.getBodies()[0]):-1);
  e.destroy?.();
  return { rigid, maxY, bc, blocked };
}
const j=run('js'), w=run('wasm');
console.log('JS  : rigidCells', j.rigid, 'restRow', j.maxY, 'bodies', j.bc, 'blocked', j.blocked);
console.log('WASM: rigidCells', w.rigid, 'restRow', w.maxY, 'bodies', w.bc, 'blocked', w.blocked);
const ok =
  w.rigid > 100 &&                       // cube intact (~144 cells)
  w.maxY >= 82 && w.maxY <= 86 &&         // resting on the floor (floor top ~80)
  w.bc === 1 &&                           // exactly one body
  w.blocked <= 4;                         // not deeply clipping terrain
console.log(ok ? 'PASS: WASM cube settles on the floor intact, no deep clipping' : 'FAIL');
process.exit(ok?0:1);
