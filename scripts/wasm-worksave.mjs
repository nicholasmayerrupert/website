// Verify edited bands persist across a world shift round-trip (chunkStore port).
import { createEngine } from '../src/sand/engine.js';
import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';
import { mulberry32 } from '../src/sand/rng.js';
const COLS=256, ROWS=128, SEED=0x1234, SHIFT=128;
await initSandWasm();
const mk=(k)=> k==='js'
  ? createEngine({cols:COLS,rows:ROWS,infinite:true,worldSeed:SEED,rng:mulberry32(1)})
  : createEngineWasm({cols:COLS,rows:ROWS,infinite:true,worldSeed:SEED});
const oilCount=(g)=>{let c=0;for(let i=0;i<g.length;i++)if(g[i]===4)c++;return c;};
function run(k){
  const e=mk(k);
  // paint an OIL marker (oil never occurs in worldgen) in the left band [0,128)
  for(let y=30;y<46;y++) for(let x=20;x<40;x++) e.paintDisc(x,y,0,4,true);
  const before=oilCount(e.getGrid());
  // scroll the marker band off the left edge
  e.shiftWorld(SHIFT);
  const offEdge=oilCount(e.getGrid());
  // scroll back to the original window
  e.shiftWorld(-SHIFT);
  const after=oilCount(e.getGrid());
  e.destroy?.();
  return {before, offEdge, after};
}
const j=run('js'), w=run('wasm');
console.log(`JS  : painted ${j.before}  off-edge ${j.offEdge}  after-return ${j.after}`);
console.log(`WASM: painted ${w.before}  off-edge ${w.offEdge}  after-return ${w.after}`);
const ok = w.before>0 && w.offEdge===0 && w.after===w.before &&
           j.before>0 && j.offEdge===0 && j.after===j.before;
console.log(ok ? 'PASS: edited band saved on scroll-off and restored on return (JS + WASM)' : 'FAIL');
process.exit(ok?0:1);
