// Fossils are persistent, solid world features with open cavities and grounded roots.
import process from 'node:process';
import { initSandWasm, createEngineWasm, BIOME, MAT, WORLD_FEATURE } from '../src/sand/wasmBridge/engineFactory.js';
import { makeChecker } from './sand-test-util.mjs';
await initSandWasm();
const { check, done } = makeChecker('bone highlands');
const make = (cols = 256) => createEngineWasm({cols, rows:192, worldSeed:7, infinite:true, sinksOn:false});
const e = make();
const features = new Map();
for (let x = -12000; x <= 12000 && features.size < 3; x += 8) {
  if (e.worldBiomeAt(x) !== BIOME.ROCKY) continue;
  const surface = e.worldSurfaceAbsAt(x);
  for (let dy = 3; dy <= 27; dy += 4) {
    const c = e.worldContextAt(x, surface - dy);
    if (c.featureKind === WORLD_FEATURE.OUTCROP) features.set(c.featureId % 3, c);
  }
}
check('skulls, rib cages, and vertebral columns all occur in bone highlands', features.size === 3);
function moveTo(engine, x, y) {
  const ox = Math.floor((x - engine.cols / 2) / 32) * 32;
  const oy = Math.floor((y - engine.rows / 2) / 32) * 32;
  while (engine.getWorldOffsetX() !== ox) engine.shiftWorldXY(Math.max(-128, Math.min(128, ox - engine.getWorldOffsetX())), 0);
  while (engine.getWorldOffsetY() !== oy) engine.shiftWorldXY(0, Math.max(-96, Math.min(96, oy - engine.getWorldOffsetY())));
}
for (const [form, context] of features) {
  const {left,top,right,bottom} = context.bounds;
  const cx = Math.floor((left+right)/2), cy = Math.floor((top+bottom)/2);
  moveTo(e,cx,cy);
  const capture = engine => {
    const cells=[];
    for (const grid of [engine.getGrid(),engine.getGridBg()])
      for(let y=top;y<=bottom;y++) for(let x=left;x<=right;x++)
        cells.push(grid[(y-engine.getWorldOffsetY())*engine.cols+x-engine.getWorldOffsetX()]);
    return cells;
  };
  const before=capture(e);
  let above=0, holes=0;
  for(let y=top;y<e.worldSurfaceAbsAt(cx)-1;y++) for(let x=left;x<=right;x++) {
    const k=(y-e.getWorldOffsetY())*e.cols+x-e.getWorldOffsetX();
    if(e.getGrid()[k]===MAT.BONE) above++;
    if(e.getGrid()[k]===MAT.EMPTY && e.getGridBg()[k]===MAT.EMPTY) holes++;
  }
  check(`form ${form} has an exposed bone silhouette and open space`,above>35 && holes>20);
  const wide=make(384); moveTo(wide,cx,cy);
  const wider=capture(wide);
  check(`form ${form} matches across viewport sizes and both layers`,before.every((v,i)=>v===wider[i]));
  wide.destroy();
  e.shiftWorldXY(128,0);e.shiftWorldXY(128,0);e.shiftWorldXY(-128,0);e.shiftWorldXY(-128,0);
  const streamed=capture(e);
  check(`form ${form} survives streaming`,before.every((v,i)=>v===streamed[i]));
  const boneCells=[];
  for(let y=top;y<=bottom;y++) for(let x=left;x<=right;x++){
    const k=(y-e.getWorldOffsetY())*e.cols+x-e.getWorldOffsetX();
    if(e.getGrid()[k]===MAT.BONE) boneCells.push(k);
  }
  for(let t=0;t<100;t++)e.stepWorld();
  check(`form ${form} remains component-backed and grounded through settling`,boneCells.every(k=>e.getGrid()[k]===MAT.BONE));
  console.log(`  sample form ${form}: world ${cx},${cy}`);
}
e.destroy();
process.exitCode=done()?1:0;
