// Explosives (TNT). A TNT cell lit by fire fuses, then detonates a DURABILITY-gated
// crater: soft blocks (low durability) blow up from farther out than hard blocks.
// Covers: detonation, "easier to mine = easier to blow up", TNT->TNT chaining, and the
// explosive RIGID BODY (a free TNT body detonates when exposed to fire).
// Run: node scripts/explosives-test.mjs
import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 140, ROWS = 110, SEED = 0xC0FFEE;
await initSandWasm();
const mk = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: false });
const { check, done } = makeChecker('explosives (TNT)');
const count = (g, m) => { let n = 0; for (const v of g) if (v === m) n++; return n; };
const GAS = new Set([MAT.FIRE, MAT.STEAM, MAT.ACRID_SMOKE]);
const AFTERMATH = [MAT.ACRID_SMOKE, MAT.STEAM, MAT.FIRE];
const carvedInBox = (g, cx, cy, r) => { let n = 0; for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) { if (x < 0 || x >= COLS || y < 0 || y >= ROWS) continue; const v = g[y * COLS + x]; if (v === MAT.EMPTY || GAS.has(v)) n++; } return n; };
const countAny = (g, mats) => { let n = 0; for (const v of g) if (mats.includes(v)) n++; return n; };
const aftermathStats = (g) => ({
  acrid: count(g, MAT.ACRID_SMOKE),
  steam: count(g, MAT.STEAM),
  fire: count(g, MAT.FIRE),
  total: countAny(g, AFTERMATH),
});

// Fill a solid grounded block of material M, sit a TNT on top, light it, and run until
// the blast fires (a sudden jump in carved cells inside the crater box). Return how many
// crater cells were carved.
function blastCrater(M) {
  const e = mk();
  const cx = 70, top = 50;
  for (let y = top; y < ROWS; y++) for (let x = 30; x < 110; x++) e.placeMaterial(x, y, 0, M);
  e.placeMaterial(cx, top - 1, 0, MAT.TNT); // TNT resting on the block
  e.syncComponents();
  const box = () => carvedInBox(e.getGrid(), cx, top - 1, 14); // centred on the blast point
  const empty0 = box();
  let blast = -1, crater = 0;
  for (let i = 0; i < 80; i++) {
    e.placeMaterial(cx + 1, top - 1, 1, MAT.FIRE); // keep a flame beside the TNT past the fuse
    e.step(i * 16);
    const now = box();
    if (now - empty0 > 12) { blast = i; crater = now - empty0; break; } // detect the blast's sudden crater
  }
  const tntLeft = count(e.getGrid(), MAT.TNT);
  e.destroy();
  return { blast, crater, tntLeft };
}

// --- detonation happens, and the TNT is consumed ---
{
  const soft = blastCrater(MAT.SANDSTONE); // durability 6
  const hard = blastCrater(MAT.IRON_ORE);  // durability 14
  check(`TNT detonated (blast fired at step ${soft.blast})`, soft.blast > 0);
  check(`TNT is consumed by its own blast (${soft.tntLeft} left)`, soft.tntLeft === 0);
  check(`soft block carves a crater (${soft.crater} cells)`, soft.crater > 30);
  check(`hard block carves a crater (${hard.crater} cells)`, hard.crater > 0);
  // the headline rule: easier-to-mine (lower durability) blows up from farther out
  check(`soft block blows up MORE than hard (${soft.crater} > ${hard.crater})`, soft.crater > hard.crater * 1.5);
}

// --- TNT chains: light one end of a line, the whole line goes ---
{
  const e = mk();
  const y = ROWS - 2; // resting directly on the floor so the line stays put (grounded)
  for (let x = 30; x <= 100; x++) e.placeMaterial(x, y, 0, MAT.TNT);
  e.syncComponents();
  const tnt0 = count(e.getGrid(), MAT.TNT);
  for (let i = 0; i < 200; i++) { e.placeMaterial(28, y, 1, MAT.FIRE); e.step(i * 16); if (count(e.getGrid(), MAT.TNT) === 0) break; } // light the left end from the side
  check(`TNT line existed (${tnt0})`, tnt0 > 30);
  check(`a single spark chained the whole TNT line (0 left)`, count(e.getGrid(), MAT.TNT) === 0);
  e.destroy();
}

// --- explosive RIGID BODY: a free TNT body detonates when it meets fire ---
{
  const e = mk();
  for (let x = 30; x < 110; x++) for (let y = 70; y < ROWS; y++) e.placeMaterial(x, y, 0, MAT.STONE);
  e.syncComponents();
  e.spawnBox(70, 60, 3, 3, MAT.TNT); // a TNT body dropped onto the stone
  const stone0 = count(e.getGrid(), MAT.STONE);
  let gone = false;
  for (let i = 0; i < 200; i++) {
    e.placeMaterial(70, 64, 2, MAT.FIRE); // a flame where the body falls/rests
    e.step(i * 16);
    if (count(e.getGrid(), MAT.TNT) === 0 && e._bodyCount() === 0) { gone = true; break; } // TNT body fell, but watch it explode + clear
    if (count(e.getGrid(), MAT.TNT) === 0 && count(e.getGrid(), MAT.STONE) < stone0 - 20) { gone = true; break; } // detonated + cratered (STONE debris may linger transiently)
  }
  check(`explosive TNT body detonated (TNT consumed, stone cratered)`, gone);
  e.destroy();
}

// --- Phase 3: debris chunks (that bake into rubble), cosmetic particles, shockwave ---
{
  const e = mk();
  for (let x = 30; x < 110; x++) for (let y = 50; y < ROWS; y++) e.placeMaterial(x, y, 0, MAT.STONE);
  e.placeMaterial(70, 49, 0, MAT.TNT);
  e.syncComponents();
  const items0 = e.itemCount();
  let maxBodies = 0, particlesSeen = false;
  for (let i = 0; i < 60; i++) {
    e.placeMaterial(71, 49, 1, MAT.FIRE);
    e.step(i * 16);
    maxBodies = Math.max(maxBodies, e._bodyCount());
    if (e.itemCount() > items0 + 5) particlesSeen = true;
  }
  check(`blast scattered cosmetic particles (items ${items0} -> peak)`, particlesSeen);
  check(`blast ejected physical debris chunks (peak bodies ${maxBodies})`, maxBodies > 0);
  for (let i = 60; i < 500; i++) e.step(i * 16); // let the rubble settle + bake
  check(`debris chunks baked back into static rubble (bodies now ${e._bodyCount()})`, e._bodyCount() <= 1);
  e.destroy();
}
{
  // a free body within the blast radius is shoved outward (away from the centre)
  const e = mk();
  for (let x = 20; x < 120; x++) e.placeMaterial(x, ROWS - 1, 0, MAT.STONE); // floor
  e.placeMaterial(60, ROWS - 2, 0, MAT.TNT);
  e.syncComponents();
  e.spawnBox(72, ROWS - 5, 2, 2, MAT.RIGID); // a body just to the right of the TNT, inside the blast
  for (let i = 0; i < 30; i++) e.step(i * 16); // settle
  const avgRigidX = () => { const g = e.getGrid(); let s = 0, n = 0; for (let i = 0; i < g.length; i++) if (g[i] === MAT.RIGID) { s += i % COLS; n++; } return n ? s / n : -1; };
  const x0 = avgRigidX();
  for (let i = 30; i < 90; i++) { e.placeMaterial(61, ROWS - 2, 1, MAT.FIRE); e.step(i * 16); }
  const x1 = avgRigidX();
  check(`shockwave shoved the nearby body outward (x ${x0.toFixed(1)} -> ${x1.toFixed(1)})`, x0 > 0 && x1 > x0 + 2);
  e.destroy();
}

// --- each consumed TNT pixel emits one aftermath cell: mostly acrid smoke, some steam/fire ---
{
  const e = mk();
  const cx = 70, cy = 50, half = 5;
  for (let y = cy - 14; y <= cy + 14; y++) for (let x = cx - 14; x <= cx + 14; x++) {
    if (x >= cx - half && x <= cx + half && y >= cy - half && y <= cy + half) continue;
    if (x >= cx + half + 1 && x <= cx + half + 3 && y >= cy - 1 && y <= cy + 1) continue;
    e.placeMaterial(x, y, 0, MAT.SANDSTONE);
  }
  for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) e.placeMaterial(x, y, 0, MAT.TNT);
  e.syncComponents();
  const tnt0 = count(e.getGrid(), MAT.TNT);
  let peak = { acrid: 0, steam: 0, fire: 0, total: 0 };
  let tntLeft = tnt0;
  for (let i = 0; i < 80; i++) {
    if (i < 3) e.placeMaterial(cx + half + 2, cy, 1, MAT.FIRE); // light the TNT block once; the fuse persists
    e.step(i * 16);
    const g = e.getGrid();
    const stats = aftermathStats(g);
    if (stats.total > peak.total) peak = stats;
    tntLeft = count(g, MAT.TNT);
    if (tntLeft === 0 && i > 35) break;
  }
  check(`TNT block existed (${tnt0} cells)`, tnt0 === (half * 2 + 1) * (half * 2 + 1));
  check(`TNT block was consumed (${tntLeft} left)`, tntLeft === 0);
  check(`blast emitted about one aftermath cell per TNT pixel (peak ${peak.total} vs TNT ${tnt0})`, peak.total >= tnt0 * 0.6 && peak.total <= tnt0 + 12);
  check(`acrid smoke dominates the aftermath (acrid ${peak.acrid}, steam ${peak.steam})`, peak.acrid > peak.steam * 1.8);
  check(`blast emits some steam (peak ${peak.steam})`, peak.steam > 10);
  check(`blast emits some fire (peak ${peak.fire})`, peak.fire > 4);
  e.destroy();
}

// --- gases inside a blast radius survive instead of being carved away ---
{
  const e = mk();
  const cx = 70, top = 50;
  for (let y = top; y < ROWS; y++) for (let x = 30; x < 110; x++) e.placeMaterial(x, y, 0, MAT.SANDSTONE);
  e.placeMaterial(cx, top - 1, 0, MAT.TNT);
  e.syncComponents();
  let survived = false, steamBeforeBlast = 0;
  for (let i = 0; i < 80; i++) {
    e.placeMaterial(cx + 1, top - 1, 1, MAT.FIRE);
    if (i >= 24) {
      for (let x = cx - 12; x <= cx + 12; x++) {
        if (x >= cx - 1 && x <= cx + 2) continue;
        e.placeMaterial(x, top - 8, 0, MAT.STEAM);
      }
    }
    steamBeforeBlast = count(e.getGrid(), MAT.STEAM);
    e.step(i * 16);
    const tntLeft = count(e.getGrid(), MAT.TNT);
    const steamNow = count(e.getGrid(), MAT.STEAM);
    if (tntLeft === 0) { survived = steamNow >= steamBeforeBlast * 0.75; break; }
  }
  check(`gas survives TNT blast carving (steam before blast ${steamBeforeBlast})`, survived);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
