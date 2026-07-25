// Explosives (TNT). A TNT cell lit by fire fuses, then detonates a DURABILITY-gated
// crater: soft blocks (low durability) blow up from farther out than hard blocks.
// Covers: detonation, "easier to mine = easier to blow up", TNT->TNT chaining, and the
// explosive RIGID BODY (a free TNT body detonates when exposed to fire).
// Run: node scripts/explosives-test.mjs
import { initSandWasm, createEngineWasm as createEngineWasmRaw } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
// Every engine in this file gets the test hooks (grounding/body/particle pokes).
const createEngineWasm = (opts) => attachTestHooks(createEngineWasmRaw(opts));
import { MAT } from '../src/sand/materials.js';
import { SOUND_EVENT } from '../src/sand/wasmBridge/abi.generated.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 140, ROWS = 110, SEED = 0xC0FFEE, BLAST_DEBRIS_CAP = 64;
await initSandWasm();
const mk = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false, infinite: false });
const { check, done } = makeChecker('explosives (TNT)');
const count = (g, m) => { let n = 0; for (const v of g) if (v === m) n++; return n; };
const GAS = new Set([MAT.FIRE, MAT.STEAM, MAT.ACRID_SMOKE]);
const AFTERMATH = [MAT.ACRID_SMOKE, MAT.STEAM, MAT.FIRE];
const carvedInBox = (g, cx, cy, r) => { let n = 0; for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) { if (x < 0 || x >= COLS || y < 0 || y >= ROWS) continue; const v = g[y * COLS + x]; if (v === MAT.EMPTY || GAS.has(v)) n++; } return n; };
const countInBox = (g, mat, cx, cy, r) => { let n = 0; for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) { if (x < 0 || x >= COLS || y < 0 || y >= ROWS) continue; if (g[y * COLS + x] === mat) n++; } return n; };
const topRow = (g, mat, cols = COLS) => { for (let k = 0; k < g.length; k++) if (g[k] === mat) return Math.floor(k / cols); return -1; };
const countAny = (g, mats) => { let n = 0; for (const v of g) if (mats.includes(v)) n++; return n; };
const aftermathStats = (g) => ({
  acrid: count(g, MAT.ACRID_SMOKE),
  steam: count(g, MAT.STEAM),
  fire: count(g, MAT.FIRE),
  total: countAny(g, AFTERMATH),
});
const gasDistanceStats = (g, cx, cy, mats = AFTERMATH) => {
  let n = 0, sum = 0;
  for (let i = 0; i < g.length; i++) {
    if (!mats.includes(g[i])) continue;
    const x = i % COLS, y = Math.floor(i / COLS);
    n++; sum += Math.hypot(x - cx, y - cy);
  }
  return { count: n, avg: n ? sum / n : 0 };
};
const stressRng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s ^ (s >>> 15), 2246822519) >>> 0;
    s = Math.imul(s ^ (s >>> 13), 3266489917) >>> 0;
    return ((s ^= s >>> 16) >>> 0) / 4294967296;
  };
};
function stampGeneratedTerrainTntStrokes(e, cols, rows, seed, layer = 0) {
  const r = stressRng(seed);
  const clampX = (v) => Math.max(2, Math.min(cols - 3, v));
  const clampY = (v) => Math.max(2, Math.min(rows - 3, v));
  for (let s = 0; s < 14; s++) {
    let x = clampX(Math.floor(20 + r() * 80));
    // Keep stroke origins inside the loaded buffer (surface - N can go negative).
    let y = clampY(Math.floor(e.worldSurfaceAt(e.getWorldOffsetX() + x) - 45 - r() * 50));
    const segments = 8 + Math.floor(r() * 10);
    for (let i = 0; i < segments; i++) {
      const nx = clampX(x + Math.floor(20 + r() * 65));
      const surf = e.worldSurfaceAt(e.getWorldOffsetX() + nx);
      const ny = clampY(Math.floor(surf - 15 - r() * 80));
      const steps = Math.max(Math.abs(nx - x), Math.abs(ny - y));
      for (let t = 0; t <= steps; t += 3) {
        const a = steps ? t / steps : 0;
        e.placeMaterial(clampX(Math.round(x + (nx - x) * a)), clampY(Math.round(y + (ny - y) * a)), 2, MAT.TNT, layer);
      }
      x = nx; y = ny;
    }
  }
  e.syncComponentsLayer(layer);
}
function igniteGeneratedTerrainStress(e, cols, rows, seed) {
  const r = stressRng(seed ^ 0x9e3779b9);
  for (let i = 0; i < 24; i++) {
    const x = Math.floor(3 + r() * (cols - 6));
    const surf = e.worldSurfaceAt(e.getWorldOffsetX() + x);
    const y = Math.max(2, Math.min(rows - 3, surf - 20 + Math.floor(r() * 40)));
    e.placeMaterial(x, y, 2, i % 3 === 0 ? MAT.LAVA : MAT.FIRE);
  }
}

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

function blastDamagesMaterial(name) {
  const e = mk();
  const M = MAT[name];
  const cx = 70, top = 70;
  for (let y = top; y < ROWS; y++) for (let x = 30; x < 110; x++) e.placeMaterial(x, y, 0, MAT.STONE);
  for (let y = top - 20; y < top; y++) for (let x = cx + 6; x <= cx + 22; x++) e.placeMaterial(x, y, 0, M);
  e.placeMaterial(cx, top - 1, 0, MAT.TNT);
  e.syncComponents();
  const before = countInBox(e.getGrid(), M, cx, top - 1, 14);
  let after = before, consumed = false;
  for (let i = 0; i < 90; i++) {
    e.placeMaterial(cx + 1, top - 1, 1, MAT.FIRE);
    e.step(i * 16);
    if (count(e.getGrid(), MAT.TNT) === 0) {
      after = countInBox(e.getGrid(), M, cx, top - 1, 14);
      consumed = true;
      break;
    }
  }
  e.destroy();
  return { before, after, consumed };
}

// --- detonation happens, and the TNT is consumed ---
{
  const soft = blastCrater(MAT.SANDSTONE); // durability 6
  const hard = blastCrater(MAT.IRON_ORE);  // durability 13
  check(`TNT detonated (blast fired at step ${soft.blast})`, soft.blast > 0);
  check(`TNT is consumed by its own blast (${soft.tntLeft} left)`, soft.tntLeft === 0);
  check(`soft block carves a crater (${soft.crater} cells)`, soft.crater > 30);
  check(`hard block carves a crater (${hard.crater} cells)`, hard.crater > 0);
  // the headline rule: easier-to-mine (lower durability) blows up from farther out
  check(`soft block blows up MORE than hard (${soft.crater} > ${hard.crater})`, soft.crater > hard.crater * 1.5);
}

// --- material-class damage coverage: broad blast gate, storage-aware cleanup ---
{
  const damageNames = [
    'WOOD', 'PINE_WOOD', 'DRIFTWOOD', 'PLANT', 'VINE', 'CACTUS', 'MUSH_STEM', 'MUSH_CAP',
    'STONE', 'BRICK', 'COPPER_ORE', 'IRON_ORE', 'COAL_ORE', 'GOLD_ORE', 'DEBRIS', 'ICE',
    'SAND', 'DIRT', 'SNOW', 'GRASS', 'GUNPOWDER',
  ];
  for (const name of damageNames) {
    const r = blastDamagesMaterial(name);
    check(`TNT damages ${name} (${r.before} -> ${r.after})`, r.consumed && r.before > 0 && r.after < r.before);
  }
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

// --- a compact creative-placement diamond keeps two pretty pulses, not 13 craters ---
{
  const e = mk();
  const cx = 70, cy = 30;
  for (let oy = -2; oy <= 2; oy++) {
    const half = 2 - Math.abs(oy);
    for (let ox = -half; ox <= half; ox++) e.placeMaterial(cx + ox, cy + oy, 0, MAT.TNT);
  }
  e.syncComponents();
  const tnt0 = count(e.getGrid(), MAT.TNT);
  e.placeMaterial(cx, cy + 3, 1, MAT.FIRE);
  const pulseIntensity = [];
  let firstDrop = -1, completed = -1;
  for (let i = 0; i < 60; i++) {
    e.step(i * 16);
    const now = count(e.getGrid(), MAT.TNT);
    if (firstDrop < 0 && now < tnt0) firstDrop = i;
    if (completed < 0 && now === 0) completed = i;
    const sounds = e.drainSoundEvents();
    for (let s = 0; s < sounds.length; s += 6)
      if (sounds[s] === SOUND_EVENT.EXPLOSION) pulseIntensity.push(sounds[s + 3]);
  }
  check(`creative TNT diamond existed (${tnt0} cells)`, tnt0 === 13);
  check(`creative TNT diamond retained a two-tick chain (${firstDrop} -> ${completed})`, completed - firstDrop === 1);
  check(`creative TNT diamond emitted two compact blast fronts (${pulseIntensity.length})`,
        pulseIntensity.length === 2 && pulseIntensity.every((v) => v <= 1.01));
  e.destroy();
}

// --- a blast front shortens an already-lit static fuse instead of leaving a late tail ---
{
  const e = mk();
  const y = ROWS - 2, left = 50, right = 62;
  e.placeMaterial(left, y, 0, MAT.TNT);
  e.placeMaterial(right, y, 0, MAT.TNT);
  e.syncComponents();
  let firstDrop = -1, completed = -1;
  for (let i = 0; i < 60; i++) {
    if (i === 0) e.placeMaterial(left - 1, y, 1, MAT.FIRE);
    if (i === 8) e.placeMaterial(right + 1, y, 1, MAT.FIRE);
    e.step(i * 16);
    const now = count(e.getGrid(), MAT.TNT);
    if (firstDrop < 0 && now < 2) firstDrop = i;
    if (completed < 0 && now === 0) completed = i;
  }
  check(`blast front shortened the later static fuse (${firstDrop} -> ${completed})`, completed - firstDrop === 1);
  e.destroy();
}

// --- a lit TNT fuse keeps the layer active even after the igniting fire dies ---
{
  const e = mk();
  const cx = 70, cy = 55;
  e.placeMaterial(cx, cy, 0, MAT.TNT);
  e.syncComponents();
  e.placeMaterial(cx + 1, cy, 1, MAT.FIRE);
  let detonated = false;
  for (let i = 0; i < 100; i++) {
    e.step(i * 16);
    if (count(e.getGrid(), MAT.TNT) === 0) { detonated = true; break; }
  }
  check(`lit TNT detonated without a persistent flame`, detonated);
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

// --- debris chunks, cosmetic particles, and shockwave ---
{
  const e = mk();
  for (let x = 30; x < 110; x++) for (let y = 50; y < ROWS; y++) e.placeMaterial(x, y, 0, MAT.STONE);
  e.placeMaterial(70, 49, 0, MAT.TNT);
  e.syncComponents();
  const items0 = e.itemCount();
  let maxBodies = 0, maxStoneBodies = 0, particlesSeen = false;
  let sawGenericDebris = false;
  for (let i = 0; i < 60; i++) {
    e.placeMaterial(71, 49, 1, MAT.FIRE);
    e.step(i * 16);
    maxBodies = Math.max(maxBodies, e._bodyCount());
    let stoneBodies = 0;
    for (let b = 0; b < e._bodyCount(); b++) {
      if (e._bodyMaterial(b) === MAT.DEBRIS) sawGenericDebris = true;
      if (e._bodyMaterial(b) === MAT.STONE) stoneBodies++;
    }
    maxStoneBodies = Math.max(maxStoneBodies, stoneBodies);
    if (e.itemCount() > items0 + 5) particlesSeen = true;
  }
  check(`blast scattered cosmetic particles (items ${items0} -> peak)`, particlesSeen);
  check(`blast ejected physical debris chunks (peak bodies ${maxBodies})`, maxBodies > 0);
  check(`stone blast fills its bounded real-stone sample budget (peak ${maxStoneBodies})`, maxStoneBodies >= 3);
  check(`blast can suppress default generic DEBRIS chunks`, !sawGenericDebris);
  for (let i = 60; i < 500; i++) e.step(i * 16); // let the rubble settle
  const settledBodies = e._bodyCount();
  check(`settled blast rubble remains non-structural rigid bodies (${settledBodies})`, settledBodies > 0);
  const target = e._bodyState(0);
  let crushedWithoutPause = false;
  if (target) {
    const px = Math.round(target.px);
    const bodyTop = Math.floor(target.py - target.maxR);
    const plateBottom = bodyTop - 2;
    for (let y = plateBottom - 5; y <= plateBottom; y++)
      for (let x = px - 5; x <= px + 5; x++)
        e.placeMaterial(x, y, 0, x === px && y === plateBottom - 5 ? MAT.IRON_ORE : MAT.STONE);
    e.syncComponents();
    let previousTop = topRow(e.getGrid(), MAT.IRON_ORE);
    let paused = false;
    for (let i = 500; i < 512 && e._bodyCount() >= settledBodies; i++) {
      e.step(i * 16);
      const nextTop = topRow(e.getGrid(), MAT.IRON_ORE);
      if (nextTop === previousTop) paused = true;
      previousTop = nextTop;
    }
    crushedWithoutPause = e._bodyCount() < settledBodies && !paused;
  }
  check(`falling terrain crushes blast rubble without pausing`, crushedWithoutPause);
  e.destroy();
}
{
  const e = mk();
  const cx = 70, cy = 55;
  e.placeMaterial(cx, cy, 0, MAT.TNT);
  e.syncComponents();
  let sawGenericDebris = false;
  for (let i = 0; i < 80; i++) {
    e.placeMaterial(cx + 1, cy, 1, MAT.FIRE);
    e.step(i * 16);
    for (let b = 0; b < e._bodyCount(); b++) if (e._bodyMaterial(b) === MAT.DEBRIS) sawGenericDebris = true;
    if (count(e.getGrid(), MAT.TNT) === 0 && sawGenericDebris) break;
  }
  check(`open-air TNT still ejects generic DEBRIS chunks`, sawGenericDebris);
  e.destroy();
}
{
  // A solid background must not suppress rubble from a foreground cave blast.
  const e = mk();
  e.setBgEnabled(true);
  const cx = 70, cy = 55;
  e.paintDiscLayer(1, cx, cy, Math.max(COLS, ROWS), MAT.STONE, true);
  e.placeMaterial(cx, cy, 0, MAT.TNT);
  e.syncComponentsLayer(0);
  e.syncComponentsLayer(1);
  let peakBodies = 0, detonated = false;
  for (let i = 0; i < 80; i++) {
    if (i < 3) e.placeMaterial(cx + 1, cy, 1, MAT.FIRE);
    e.step(i * 16);
    if (count(e.getGrid(), MAT.TNT) === 0) detonated = true;
    if (detonated) peakBodies = Math.max(peakBodies, e._bodyCount());
  }
  check(`background-backed cave TNT detonated`, detonated);
  check(`background-backed cave TNT emitted physical rubble (peak bodies ${peakBodies})`, peakBodies > 0);
  e.destroy();
}
{
  // Enclosed TNT retains the bounded rubble budget; candidate spawning still
  // requires local escape space so chunks do not begin blocked inside terrain.
  const e = mk();
  const cx = 70, cy = 68;
  for (let y = 20; y < ROWS - 1; y++) for (let x = 20; x < 120; x++) {
    if (x >= cx && x <= cx + 3 && y === cy) continue; // short ignition tunnel
    e.placeMaterial(x, y, 0, MAT.STONE);
  }
  e.placeMaterial(cx, cy, 0, MAT.TNT);
  e.syncComponents();
  const empty0 = carvedInBox(e.getGrid(), cx, cy, 14);
  const items0 = e.itemCount();
  let peakBodies = 0, peakItems = items0, maxBlocked = 0, blasted = false;
  for (let i = 0; i < 90; i++) {
    e.placeMaterial(cx + 2, cy, 1, MAT.FIRE);
    e.step(i * 16);
    if (carvedInBox(e.getGrid(), cx, cy, 14) - empty0 > 20) blasted = true;
    if (!blasted) continue;
    peakBodies = Math.max(peakBodies, e._bodyCount());
    peakItems = Math.max(peakItems, e.itemCount());
    for (let b = 0; b < e._bodyCount(); b++) maxBlocked = Math.max(maxBlocked, e._bodyBlocked(b));
  }
  check(`enclosed TNT emitted bounded physical debris (peak bodies ${peakBodies})`, peakBodies > 0 && peakBodies <= 3);
  check(`enclosed TNT retained material flecks (items ${items0} -> ${peakItems})`, peakItems > items0);
  check(`buried TNT rubble kept collision blocking bounded (max blocked ${maxBlocked})`, maxBlocked <= 1);
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
{
  // A blast-cut static component should not become one massive launched body.
  // Destroyed solid cells still emit small physical rubble of their own material.
  const e = mk();
  for (let x = 20; x < 120; x++) e.placeMaterial(x, ROWS - 1, 0, MAT.STONE);
  for (let y = 45; y < ROWS - 1; y++) e.placeMaterial(72, y, 0, MAT.WOOD);
  e.placeMaterial(60, 72, 0, MAT.TNT);
  e.syncComponents();
  let maxWoodPts = 0;
  for (let i = 0; i < 90; i++) {
    e.placeMaterial(61, 72, 1, MAT.FIRE);
    e.step(i * 16);
    for (let b = 0; b < e._bodyCount(); b++) {
      if (e._bodyMaterial(b) !== MAT.WOOD) continue;
      const s = e._bodyState(b);
      if (s) maxWoodPts = Math.max(maxWoodPts, s.nPts);
    }
  }
  check(`TNT emitted small WOOD rubble from destroyed cells (max body cells ${maxWoodPts})`, maxWoodPts > 0);
  check(`TNT did not launch a massive detached WOOD chunk (max body cells ${maxWoodPts})`, maxWoodPts <= 4);
  e.destroy();
}
{
  // Grounded plant-family solids still need physical rubble from destroyed cells.
  const e = mk();
  for (let y = 68; y < ROWS; y++) for (let x = 48; x < 92; x++) e.placeMaterial(x, y, 0, MAT.WOOD);
  for (let y = 60; y < ROWS; y++) for (let x = 60; x < 65; x++) e.placeMaterial(x, y, 0, MAT.STONE);
  e.placeMaterial(70, 67, 0, MAT.TNT);
  e.syncComponents();
  let peakBodies = 0;
  let sawWoodBody = false, sawStoneBody = false;
  for (let i = 0; i < 90; i++) {
    e.placeMaterial(71, 67, 1, MAT.FIRE);
    e.step(i * 16);
    peakBodies = Math.max(peakBodies, e._bodyCount());
    for (let b = 0; b < e._bodyCount(); b++) {
      if (e._bodyMaterial(b) === MAT.WOOD) sawWoodBody = true;
      if (e._bodyMaterial(b) === MAT.STONE) sawStoneBody = true;
    }
  }
  check(`mixed grounded blast emitted physical rubble (peak bodies ${peakBodies})`, peakBodies > 0);
  check(`mixed grounded blast emitted WOOD rubble specifically`, sawWoodBody);
  check(`mixed grounded blast emitted STONE rubble specifically`, sawStoneBody);
  e.destroy();
}

// --- TNT emits a deterministic outer-ring gas cloud: mostly acrid smoke, some steam/fire ---
{
  const e = mk();
  const cx = 70, half = 5, cy = ROWS - 2 - half;
  for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) e.placeMaterial(x, y, 0, MAT.TNT);
  e.syncComponents();
  const tnt0 = count(e.getGrid(), MAT.TNT);
  let peak = { acrid: 0, steam: 0, fire: 0, total: 0 };
  let peakDist = { count: 0, avg: 0 };
  let tntLeft = tnt0;
  for (let i = 0; i < 80; i++) {
    if (i < 3) e.placeMaterial(cx + half + 2, cy, 1, MAT.FIRE); // light the TNT block once; the fuse persists
    e.step(i * 16);
    const g = e.getGrid();
    const stats = aftermathStats(g);
    if (stats.total > peak.total) { peak = stats; peakDist = gasDistanceStats(g, cx, cy); }
    tntLeft = count(g, MAT.TNT);
    if (tntLeft === 0 && i > 35) break;
  }
  check(`TNT block existed (${tnt0} cells)`, tnt0 === (half * 2 + 1) * (half * 2 + 1));
  check(`TNT block was consumed (${tntLeft} left)`, tntLeft === 0);
  check(`open blast emitted a substantial ring gas cloud (peak ${peak.total} vs TNT ${tnt0})`, peak.total > tnt0 * 2);
  check(`blast emits a lot of acrid smoke (acrid ${peak.acrid}, steam ${peak.steam})`, peak.acrid > peak.steam * 2);
  check(`blast emits some steam (peak ${peak.steam})`, peak.steam > 7);
  check(`blast emits some fire (peak ${peak.fire})`, peak.fire > 10);
  check(`blast ring emitted gas near the crater edge (avg distance ${peakDist.avg.toFixed(1)})`, peakDist.avg > 14);
  e.destroy();
}

// --- a single blast's gas shell is sparse, not a solid filled annulus ---
{
  const e = mk();
  const cx = 70, cy = 55;
  e.placeMaterial(cx, cy, 0, MAT.TNT);
  e.syncComponents();
  let peakGas = 0, tntLeft = 1;
  for (let i = 0; i < 80; i++) {
    if (i < 3) e.placeMaterial(cx + 1, cy, 1, MAT.FIRE);
    e.step(i * 16);
    const g = e.getGrid();
    peakGas = Math.max(peakGas, countAny(g, AFTERMATH));
    tntLeft = count(g, MAT.TNT);
    if (tntLeft === 0 && i > 35) break;
  }
  check(`single TNT blast consumed TNT (${tntLeft} left)`, tntLeft === 0);
  check(`single TNT blast emitted a sparse gas shell (${peakGas} cells)`, peakGas > 150 && peakGas < 300);
  e.destroy();
}

// --- one TNT blast damages the opposite layer and mirrors aftermath gas there ---
{
  const e = mk();
  e.setBgEnabled(true);
  const cx = 70, top = 56;
  for (let y = top; y < ROWS; y++) for (let x = 30; x < 110; x++) {
    e.placeMaterial(x, y, 0, MAT.STONE);
    e.placeMaterial(x, y, 0, MAT.STONE, 1);
  }
  e.placeMaterial(cx, top - 1, 0, MAT.TNT);
  e.syncComponentsLayer(0);
  e.syncComponentsLayer(1);
  const fgStone0 = countInBox(e.getGrid(), MAT.STONE, cx, top - 1, 18);
  const bgStone0 = countInBox(e.getGridBg(), MAT.STONE, cx, top - 1, 18);
  let fgStone1 = fgStone0, bgStone1 = bgStone0, fgGas = 0, bgGas = 0, tntLeft = 1;
  for (let i = 0; i < 90; i++) {
    e.placeMaterial(cx + 1, top - 1, 1, MAT.FIRE);
    e.step(i * 16);
    tntLeft = count(e.getGrid(), MAT.TNT);
    if (tntLeft === 0) {
      fgStone1 = countInBox(e.getGrid(), MAT.STONE, cx, top - 1, 18);
      bgStone1 = countInBox(e.getGridBg(), MAT.STONE, cx, top - 1, 18);
      fgGas = countAny(e.getGrid(), AFTERMATH);
      bgGas = countAny(e.getGridBg(), AFTERMATH);
      break;
    }
  }
  check(`cross-layer TNT blast consumed foreground TNT`, tntLeft === 0);
  check(`cross-layer TNT blast carved foreground stone (${fgStone0} -> ${fgStone1})`, fgStone1 < fgStone0);
  check(`cross-layer TNT blast carved background stone (${bgStone0} -> ${bgStone1})`, bgStone1 < bgStone0);
  check(`cross-layer TNT blast emitted gas in both layers (fg ${fgGas}, bg ${bgGas})`, fgGas > 0 && bgGas > 0);
  e.destroy();
}

// --- removing the last cross-layer contact must invalidate a sleeping support closure ---
{
  const e = mk();
  e.setBgEnabled(true);
  const cx = 70, cy = 45;
  // A thick floating foreground plate reconnects around its crater. Its only
  // support is the narrow background pillar co-occupying the plate's bottom;
  // the blast removes that contact without severing the foreground plate.
  e.placeMaterial(cx, cy, 0, MAT.TNT);
  for (let y = 28; y <= 48; y++) for (let x = 30; x <= 110; x++) {
    if (x === cx + 1 && y === cy) continue;
    e.placeMaterial(x, y, 0, MAT.STONE);
  }
  for (let y = 45; y < ROWS; y++) for (let x = cx - 2; x <= cx + 2; x++) e.placeMaterial(x, y, 0, MAT.STONE, 1);
  e.syncComponentsLayer(0);
  e.syncComponentsLayer(1);
  for (let i = 0; i < 8; i++) e.step(i * 16); // settle and enter the cached joint-support path
  const before = topRow(e.getGrid(), MAT.STONE);
  let detonated = false;
  for (let i = 8; i < 100; i++) {
    if (i < 12) e.placeMaterial(cx + 1, cy, 1, MAT.FIRE);
    e.step(i * 16);
    if (count(e.getGrid(), MAT.TNT) === 0) { detonated = true; break; }
  }
  for (let i = 100; i < 135; i++) e.step(i * 16);
  const after = topRow(e.getGrid(), MAT.STONE);
  let overlap = 0;
  for (let k = 0; k < e.getGrid().length; k++) if (e.getGrid()[k] === MAT.STONE && e.getGridBg()[k] === MAT.STONE) overlap++;
  check(`cross-layer support-cut blast detonated`, detonated);
  check(`plate falls after TNT removes its last background contact (top ${before} -> ${after}, overlap ${overlap})`, after > before + 4);
  e.destroy();
}

// --- a locally-safe blast may reconnect through another component, but a later cut must still split it ---
{
  const e = mk();
  const cx = 60, cy = 55;
  // STONE is chunk-bounded, so the U in x<64 is one component while the
  // blast-resistant IRON_ORE bridge across the chunk seam is another. TNT cuts
  // the U's left connection; the iron bridge keeps the global graph grounded.
  e.placeMaterial(cx, cy, 0, MAT.TNT);
  for (let x = 30; x < 64; x++) for (let y = 39; y <= 43; y++) e.placeMaterial(x, y, 0, MAT.STONE);
  for (let x = 30; x < 64; x++) for (let y = 67; y <= 71; y++) e.placeMaterial(x, y, 0, MAT.STONE);
  for (let x = 57; x < 64; x++) for (let y = 39; y <= 71; y++) {
    if (x === cx + 1 && y === cy) continue;
    e.placeMaterial(x, y, 0, MAT.STONE);
  }
  for (let x = 34; x <= 38; x++) for (let y = 67; y < ROWS; y++) e.placeMaterial(x, y, 0, MAT.STONE);
  for (let x = 64; x <= 68; x++) for (let y = 39; y <= 71; y++) e.placeMaterial(x, y, 0, MAT.IRON_ORE);
  e.syncComponents();
  for (let i = 0; i < 8; i++) e.step(i * 16);
  const fast0 = e.groundingDiag().fast;
  let detonated = false;
  for (let i = 8; i < 90; i++) {
    if (i < 12) e.placeMaterial(cx + 1, cy, 1, MAT.FIRE);
    e.step(i * 16);
    if (count(e.getGrid(), MAT.TNT) === 0) { detonated = true; break; }
  }
  const heldTop = topRow(e.getGrid(), MAT.STONE);
  const fast1 = e.groundingDiag().fast;
  for (let y = 39; y <= 71; y++) for (let x = 64; x <= 68; x++) e.eraseDisc(x, y, 0);
  for (let i = 90; i < 130; i++) e.step(i * 16);
  const releasedTop = topRow(e.getGrid(), MAT.STONE);
  check(`alternate-component reconnect blast detonated`, detonated);
  check(`alternate-component reconnect used the local grounding proof (${fast0} -> ${fast1})`, fast1 > fast0);
  check(`deferred split releases the upper piece after its alternate bridge is cut (top ${heldTop} -> ${releasedTop})`, releasedTop > heldTop + 4);
  e.destroy();
}

// --- gases inside a blast radius are cleared and replaced by outer-ring gas ---
{
  const e = mk();
  const cx = 70, top = 50;
  for (let y = top; y < ROWS; y++) for (let x = 30; x < 110; x++) e.placeMaterial(x, y, 0, MAT.SANDSTONE);
  e.placeMaterial(cx, top - 1, 0, MAT.TNT);
  e.syncComponents();
  let replaced = false, steamBeforeBlast = 0, steamAfterBlast = 0, steamDistBefore = 0, gasDistAfter = 0, gasAfterBlast = 0;
  for (let i = 0; i < 80; i++) {
    e.placeMaterial(cx + 1, top - 1, 1, MAT.FIRE);
    if (i >= 24) {
      for (let x = cx - 12; x <= cx + 12; x++) {
        if (x >= cx - 1 && x <= cx + 2) continue;
        e.placeMaterial(x, top - 8, 0, MAT.STEAM);
      }
    }
    steamBeforeBlast = count(e.getGrid(), MAT.STEAM);
    steamDistBefore = gasDistanceStats(e.getGrid(), cx, top - 1, [MAT.STEAM]).avg;
    e.step(i * 16);
    const tntLeft = count(e.getGrid(), MAT.TNT);
    steamAfterBlast = count(e.getGrid(), MAT.STEAM);
    gasAfterBlast = countAny(e.getGrid(), AFTERMATH);
    gasDistAfter = gasDistanceStats(e.getGrid(), cx, top - 1).avg;
    if (tntLeft === 0) { replaced = steamAfterBlast < steamBeforeBlast * 0.9 && gasAfterBlast > steamBeforeBlast && gasDistAfter > steamDistBefore + 4; break; }
  }
  check(`blast clears interior gas and stamps an outer ring (steam ${steamBeforeBlast} -> ${steamAfterBlast}, gas ${gasAfterBlast}, avg ${steamDistBefore.toFixed(1)} -> ${gasDistAfter.toFixed(1)})`, replaced);
  e.destroy();
}

// --- a large TNT mass chains as a staged wave, not as one same-frame detonation ---
{
  const C = 220, R = 180, side = 49;
  const e = createEngineWasm({ cols: C, rows: R, worldSeed: SEED, sinksOn: false, infinite: false });
  const x0 = 70, y0 = 90;
  for (let y = y0; y < y0 + side; y++) for (let x = x0; x < x0 + side; x++) e.placeMaterial(x, y, 0, MAT.TNT);
  e.syncComponents();
  const tnt0 = count(e.getGrid(), MAT.TNT);
  let peakGas = 0, tntLeft = tnt0, firstDropLeft = -1;
  for (let i = 0; i < 80; i++) {
    e.placeMaterial(x0 + side + 2, y0 + 20, 1, MAT.FIRE);
    e.step(i * 16);
    const g = e.getGrid();
    peakGas = Math.max(peakGas, countAny(g, AFTERMATH));
    tntLeft = count(g, MAT.TNT);
    if (firstDropLeft < 0 && tntLeft < tnt0) firstDropLeft = tntLeft;
    if (tntLeft === 0 && i > 35) break;
  }
  check(`large TNT block existed (${tnt0} cells)`, tnt0 === side * side);
  check(`large TNT chain staged after first blast (${firstDropLeft} left)`, firstDropLeft > 0);
  check(`large TNT chain completed (${tntLeft} left)`, tntLeft === 0);
  check(`large TNT chain produced visible gas (peak ${peakGas})`, peakGas > 250);
  e.destroy();
}

// --- a long chain embedded in grounded terrain completes while repeatedly cutting components ---
{
  const C = 260, R = 220, side = 49;
  const e = createEngineWasm({ cols: C, rows: R, worldSeed: SEED, sinksOn: false, infinite: false });
  const cx = C >> 1, cy = 92;
  const x0 = cx - (side >> 1), y0 = cy - (side >> 1);
  // Place TNT first so the following non-overwriting terrain fill surrounds its
  // lower half instead of preventing those TNT cells from being written.
  for (let y = y0; y < y0 + side; y++) for (let x = x0; x < x0 + side; x++) e.placeMaterial(x, y, 0, MAT.TNT);
  for (let y = cy + 1; y < R; y++) for (let x = 20; x < C - 20; x++) e.placeMaterial(x, y, 0, MAT.STONE);
  e.syncComponents();
  const tnt0 = count(e.getGrid(), MAT.TNT);
  let peakBodies = 0, peakStoneBodies = 0, tntLeft = tnt0, firstDropLeft = -1;
  for (let i = 0; i < 90; i++) {
    if (i < 3) e.placeMaterial(x0 + side + 1, cy, 1, MAT.FIRE);
    e.step(i * 16);
    tntLeft = count(e.getGrid(), MAT.TNT);
    if (firstDropLeft < 0 && tntLeft < tnt0) firstDropLeft = tntLeft;
    peakBodies = Math.max(peakBodies, e._bodyCount());
    let stoneBodies = 0;
    for (let b = 0; b < e._bodyCount(); b++) if (e._bodyMaterial(b) === MAT.STONE) stoneBodies++;
    peakStoneBodies = Math.max(peakStoneBodies, stoneBodies);
  }
  check(`terrain-embedded long TNT chain existed (${tnt0} cells)`, tnt0 === side * side);
  check(`terrain-embedded long TNT chain stayed staged after first blast (${firstDropLeft} left)`, firstDropLeft > 0);
  check(`terrain-embedded long TNT chain completed (${tntLeft} left)`, tntLeft === 0);
  check(`terrain-embedded long TNT chain emitted repeated stone rubble (peak ${peakStoneBodies})`, peakStoneBodies > 3);
  check(`terrain-embedded long TNT chain kept live rigid rubble bounded (peak ${peakBodies})`,
    peakBodies > 3 && peakBodies <= BLAST_DEBRIS_CAP);
  e.destroy();
}

// --- exceptionally broad fronts are queued in bounded deterministic slices ---
{
  const C = 360, R = 260, side = 159;
  const e = createEngineWasm({ cols: C, rows: R, worldSeed: SEED, sinksOn: false, infinite: false });
  const x0 = (C - side) >> 1, y0 = (R - side) >> 1;
  for (let y = y0; y < y0 + side; y++)
    for (let x = x0; x < x0 + side; x++) e.placeMaterial(x, y, 0, MAT.TNT);
  e.syncComponents();
  let tntLeft = side * side, peakQueuedFronts = 0, completed = false;
  for (let i = 0; i < 160; i++) {
    if (i < 3) e.placeMaterial(x0 + side + 1, y0 + (side >> 1), 1, MAT.FIRE);
    e.step(i * 16);
    tntLeft = count(e.getGrid(), MAT.TNT);
    peakQueuedFronts = Math.max(peakQueuedFronts, e._tntFrontCount());
    if (tntLeft === 0 && e._tntFrontCount() === 0) { completed = true; break; }
  }
  check(`exceptionally broad TNT chain used the deferred front budget (peak queue ${peakQueuedFronts})`,
        peakQueuedFronts > 0);
  check(`budgeted TNT chain completed and drained its front queue (${tntLeft} TNT left)`,
        completed && tntLeft === 0);
  check(`budgeted TNT chain kept live rigid rubble bounded (${e._bodyCount()} bodies)`,
        e._bodyCount() <= BLAST_DEBRIS_CAP);
  e.destroy();
}

// --- a large falling component pushes movable blast rubble instead of pausing ---
// The blast fan's exact shapes/velocities are intentionally random-looking. A
// directly spawned blast-rubble stack exercises the same body-owned grid collision
// in a deterministic arrangement.
{
  const C = 180, R = 260;
  const run = (crossLayer) => {
    const e = createEngineWasm({ cols: C, rows: R, worldSeed: 7, sinksOn: false, infinite: false });
    e.setBgEnabled(crossLayer);
    for (let layer = 0; layer <= (crossLayer ? 1 : 0); layer++) {
      for (let y = 10; y <= 110; y++) for (let x = 30; x <= 130; x++) {
        const marker = layer === 0 && x >= 45 && x <= 49 && y >= 20 && y <= 24;
        e.placeMaterial(x, y, 0, marker ? MAT.IRON_ORE : MAT.STONE, layer);
      }
      e.syncComponentsLayer(layer);
    }
    e.spawnBox(80, 122, 4, 2, MAT.STONE);
    e.spawnBox(80, 126, 4, 2, MAT.STONE);
    e._setBodyBlastDebris(0);
    e._setBodyBlastDebris(1);
    e.step(0); // stamp the free bodies into the live grid
    e._setBodyMotion(0, 0, 0, 0);
    e._setBodyMotion(1, 0, 0, 0);
    const markerTop = () => topRow(e.getGrid(), MAT.IRON_ORE, C);
    let previous = markerTop();
    const deltas = [];
    for (let i = 0; i < 24; i++) {
      e.step((i + 1) * 16);
      const next = markerTop();
      deltas.push(next - previous);
      previous = next;
    }
    e.destroy();
    return deltas;
  };
  for (const crossLayer of [false, true]) {
    const deltas = run(crossLayer);
    check(`large ${crossLayer ? 'cross-layer ' : ''}falling plate continuously pushes movable rigid-rubble stack (${deltas.join('')})`,
          deltas.every((delta) => delta === 1));
  }
}

// --- blast erosion preserves the non-structural state when rubble splits ---
{
  const C = 180, R = 140;
  const e = createEngineWasm({ cols: C, rows: R, worldSeed: SEED, sinksOn: false, infinite: false });
  e.spawnBox(90, 70, 15, 3, MAT.STONE);
  e._setBodyBlastDebris(0);
  e.step(0);
  e._detonateTnt(90, 70);
  const bodyCount = e._bodyCount();
  let structuralFragments = 0;
  for (let i = 0; i < bodyCount; i++) if (e._bodyBlastDebris(i) !== 1) structuralFragments++;
  check(`blast-cut rubble split into multiple bodies (${bodyCount})`, bodyCount > 1);
  check(`blast-cut rubble kept every fragment non-structural (${structuralFragments} structural)`,
        structuralFragments === 0);
  e.destroy();
}

// --- blast-created fire must not start a second, full-fuse explosion wave afterward ---
{
  const C = 180, R = 140, side = 25;
  const e = createEngineWasm({ cols: C, rows: R, worldSeed: SEED, sinksOn: false, infinite: false });
  const x0 = 70, y0 = 70;
  for (let y = y0; y < y0 + side; y++) for (let x = x0; x < x0 + side; x++) e.placeMaterial(x, y, 0, MAT.TNT);
  e.syncComponents();
  const tnt0 = count(e.getGrid(), MAT.TNT);
  let last = tnt0;
  const drops = [];
  for (let i = 0; i < 130; i++) {
    if (i < 3) e.placeMaterial(x0 + side + 2, y0 + 12, 1, MAT.FIRE);
    e.step(i * 16);
    const now = count(e.getGrid(), MAT.TNT);
    if (now !== last) { drops.push({ step: i, before: last, after: now }); last = now; }
  }
  let maxPostChainGap = 0;
  for (let i = 2; i < drops.length; i++) maxPostChainGap = Math.max(maxPostChainGap, drops[i].step - drops[i - 1].step);
  check(`medium TNT block existed (${tnt0} cells)`, tnt0 === side * side);
  check(`medium TNT chain completed (${last} left)`, last === 0);
  check(`blast fire did not trigger a delayed full-fuse TNT tail (max gap ${maxPostChainGap})`, maxPostChainGap <= 8);
  e.destroy();
}

// --- generated two-layer terrain: foreground TNT blast invalidates stale cross-layer bonds ---
{
  const C = 512, R = 256, seed = 12648430;
  const e = createEngineWasm({ cols: C, rows: R, worldSeed: seed, sinksOn: false, infinite: true });
  e.setBgEnabled(true);
  stampGeneratedTerrainTntStrokes(e, C, R, seed, 0);
  igniteGeneratedTerrainStress(e, C, R, seed);
  let survived = true;
  try {
    for (let i = 0; i < 80; i++) e.step(i * 16);
  } catch {
    survived = false;
  }
  check(`generated-terrain TNT stress survives cross-layer component reshaping`, survived);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
