// Intensive dual-layer "stacked logs" suite.
//
// Several long horizontal stone rods (logs) staggered across FG/BG with small
// co-occupation patches. Locks:
//   - settle under cross-layer support
//   - no creep while co-occupation + grounded path remain (incl. multi-pair acid)
//   - prompt fall when the last contact is erased (no freeze)
//   - distal free logs fall when a middle joint is cut; proximal stay
//
// Run: node scripts/stacked-logs-test.mjs

import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';

await initSandWasm();

const C = 240, R = 100;
const FLOOR_Y = 70;
const kk = (x, y) => y * C + x;

let failures = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
};

const mk = (seed = 1) => {
  const e = createEngineWasm({ cols: C, rows: R, infinite: false, sinksOn: false, worldSeed: seed });
  e.setBgEnabled(true);
  return e;
};
const step = (e, n, dt = 16) => {
  let t = 0;
  for (let i = 0; i < n; i++) { t += dt; e.step(t); }
};
const paintFloor = (e) => {
  for (let y = FLOOR_Y; y < R; y++) for (let x = 0; x < C; x++) e.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
  e.syncComponentsLayer(0);
};
const paintLog = (e, layer, x0, x1, y0, h = 5) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x1; x++) e.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
  e.syncComponentsLayer(layer);
};
const paintPillar = (e, layer, x0, x1, y0, y1) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) e.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
  e.syncComponentsLayer(layer);
};
/** Exclusive bbox on one layer (caller must ensure x-range is unique to that log). */
const stoneTop = (grid, x0, x1, yHi = FLOOR_Y) => {
  let n = 0, minY = yHi;
  for (let y = 0; y < yHi; y++) for (let x = x0; x < x1; x++) {
    if (grid[kk(x, y)] !== MAT.STONE) continue;
    n++;
    if (y < minY) minY = y;
  }
  return { n, minY: n ? minY : -1 };
};
const coCount = (e, x0, x1, y0, y1) => {
  const fg = e.getGrid(), bg = e.getGridBg();
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const k = kk(x, y);
    if (fg[k] === MAT.STONE && bg[k] === MAT.STONE) n++;
  }
  return n;
};
const stoneReaches = (grid, seeds, tx0, tx1, ty0, ty1) => {
  const seen = new Uint8Array(C * R);
  const q = [];
  for (const [sx, sy] of seeds) {
    if (sx < 0 || sx >= C || sy < 0 || sy >= R) continue;
    const k = kk(sx, sy);
    if (grid[k] !== MAT.STONE || seen[k]) continue;
    seen[k] = 1; q.push(k);
  }
  let qi = 0;
  while (qi < q.length) {
    const k = q[qi++];
    const y = (k / C) | 0, x = k - y * C;
    if (x >= tx0 && x < tx1 && y >= ty0 && y < ty1) return true;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = x + ox, ny = y + oy;
      if (nx < 0 || nx >= C || ny < 0 || ny >= R) continue;
      const nk = kk(nx, ny);
      if (!seen[nk] && grid[nk] === MAT.STONE) { seen[nk] = 1; q.push(nk); }
    }
  }
  return false;
};

/**
 * Horizontal support chain (same y-band, exclusive free spans for measurement):
 *   FG0 [20,100) + pillar — grounded
 *   BG1 [95,175) — 5-col co with FG0, free span measured [110,170)
 *   FG2 [170,230) — 5-col co with BG1, free span [180,225)
 *   BG3 [225,C-2) — short distal hanger co with FG2
 */
function buildChain(e, { y = 40, h = 5, overlap = 5 } = {}) {
  paintFloor(e);
  const fg0 = { layer: 0, x0: 20, x1: 100, y0: y, h, freeX0: 30, freeX1: 90 };
  paintLog(e, 0, fg0.x0, fg0.x1, y, h);
  paintPillar(e, 0, 25, 28, y + h, FLOOR_Y);
  const bg1 = { layer: 1, x0: 100 - overlap, x1: 180, y0: y, h, freeX0: 110, freeX1: 170 };
  paintLog(e, 1, bg1.x0, bg1.x1, y, h);
  const fg2 = { layer: 0, x0: 180 - overlap, x1: 230, y0: y, h, freeX0: 185, freeX1: 225 };
  paintLog(e, 0, fg2.x0, fg2.x1, y, h);
  const bg3 = { layer: 1, x0: 230 - overlap, x1: Math.min(C - 2, 230 - overlap + 50), y0: y, h };
  bg3.freeX0 = bg3.x0 + overlap; bg3.freeX1 = bg3.x1;
  paintLog(e, 1, bg3.x0, bg3.x1, y, h);
  step(e, 50);
  return { fg0, bg1, fg2, bg3, y, h, overlap };
}
const logTop = (e, log) => {
  const g = log.layer === 0 ? e.getGrid() : e.getGridBg();
  const x0 = log.freeX0 ?? log.x0, x1 = log.freeX1 ?? log.x1;
  return stoneTop(g, x0, x1);
};

// ---------------------------------------------------------------------------
console.log('stacked-logs: horizontal support chain settles');
{
  const e = mk(11);
  const chain = buildChain(e);
  for (const [name, log] of [['fg0', chain.fg0], ['bg1', chain.bg1], ['fg2', chain.fg2], ['bg3', chain.bg3]]) {
    const s = logTop(e, log);
    check(`${name} settled at y=${chain.y}`, s.minY === chain.y && s.n > 20, `(minY ${s.minY}, n ${s.n})`);
  }
  check('co at each joint',
    coCount(e, chain.bg1.x0, chain.fg0.x1, chain.y, chain.y + chain.h) >= 5
    && coCount(e, chain.fg2.x0, chain.bg1.x1, chain.y, chain.y + chain.h) >= 5
    && coCount(e, chain.bg3.x0, chain.fg2.x1, chain.y, chain.y + chain.h) >= 5);
  e.destroy();
}

console.log('stacked-logs: mid-FG0 acid does not drop free logs while path intact');
{
  const e = mk(12);
  const chain = buildChain(e);
  const before = { bg1: logTop(e, chain.bg1), fg2: logTop(e, chain.fg2), bg3: logTop(e, chain.bg3) };
  for (let i = 0; i < 200; i++) {
    if (i % 2 === 0) e.paintDiscLayer(0, 55, chain.y - 1, 1, MAT.ACID, true);
    e.step(16 * (i + 1));
  }
  const after = { bg1: logTop(e, chain.bg1), fg2: logTop(e, chain.fg2), bg3: logTop(e, chain.bg3) };
  const connected = stoneReaches(e.getGrid(), [[26, chain.y + 2]], chain.bg1.x0, chain.fg0.x1, chain.y, chain.y + chain.h);
  if (connected) {
    check('bg1 held', after.bg1.minY <= before.bg1.minY + 1, `(${before.bg1.minY}->${after.bg1.minY})`);
    check('fg2 held', after.fg2.minY <= before.fg2.minY + 1, `(${before.fg2.minY}->${after.fg2.minY})`);
    check('bg3 held', after.bg3.minY <= before.bg3.minY + 1, `(${before.bg3.minY}->${after.bg3.minY})`);
  } else {
    check('path severed (fall allowed)', true, `(bg1 ${after.bg1.minY}, fg2 ${after.fg2.minY})`);
  }
  e.destroy();
}

console.log('stacked-logs: erase joint 0-1 drops distal chain promptly');
{
  const e = mk(14);
  const chain = buildChain(e);
  const before = { bg1: logTop(e, chain.bg1), fg2: logTop(e, chain.fg2), bg3: logTop(e, chain.bg3) };
  for (let y = chain.y; y < chain.y + chain.h; y++)
    for (let x = chain.bg1.x0; x < chain.fg0.x1; x++)
      e.eraseDiscLayer(0, x, y, 0);
  step(e, 12);
  const after = { bg1: logTop(e, chain.bg1), fg2: logTop(e, chain.fg2), bg3: logTop(e, chain.bg3) };
  check('bg1 falls', after.bg1.minY > before.bg1.minY + 2, `(${before.bg1.minY}->${after.bg1.minY})`);
  check('fg2 falls', after.fg2.minY > before.fg2.minY + 2, `(${before.fg2.minY}->${after.fg2.minY})`);
  check('bg3 falls', after.bg3.minY > before.bg3.minY + 2, `(${before.bg3.minY}->${after.bg3.minY})`);
  step(e, 20);
  const later = logTop(e, chain.bg1);
  check('bg1 keeps falling (no freeze)', later.minY > after.bg1.minY + 3, `(${after.bg1.minY}->${later.minY})`);
  e.destroy();
}

console.log('stacked-logs: erase joint 1-2 drops only distal logs');
{
  const e = mk(15);
  const chain = buildChain(e);
  const before = { bg1: logTop(e, chain.bg1), fg2: logTop(e, chain.fg2), bg3: logTop(e, chain.bg3) };
  for (let y = chain.y; y < chain.y + chain.h; y++)
    for (let x = chain.fg2.x0; x < chain.bg1.x1; x++)
      e.eraseDiscLayer(1, x, y, 0);
  step(e, 12);
  const after = { bg1: logTop(e, chain.bg1), fg2: logTop(e, chain.fg2), bg3: logTop(e, chain.bg3) };
  check('bg1 stays (held by FG0)', after.bg1.minY <= before.bg1.minY + 1, `(${before.bg1.minY}->${after.bg1.minY})`);
  check('fg2 falls', after.fg2.minY > before.fg2.minY + 2, `(${before.fg2.minY}->${after.fg2.minY})`);
  check('bg3 falls', after.bg3.minY > before.bg3.minY + 2, `(${before.bg3.minY}->${after.bg3.minY})`);
  e.destroy();
}

console.log('stacked-logs: distal acid does not drop proximal chain');
{
  const e = mk(16);
  const chain = buildChain(e);
  const before = { bg1: logTop(e, chain.bg1), fg2: logTop(e, chain.fg2) };
  const ax = ((chain.bg3.freeX0 + chain.bg3.freeX1) / 2) | 0;
  for (let i = 0; i < 250; i++) {
    if (i % 2 === 0) e.paintDiscLayer(1, ax, chain.y - 1, 1, MAT.ACID, true);
    e.step(16 * (i + 1));
  }
  const after = { bg1: logTop(e, chain.bg1), fg2: logTop(e, chain.fg2) };
  check('bg1 unaffected', after.bg1.minY <= before.bg1.minY + 1, `(${before.bg1.minY}->${after.bg1.minY})`);
  check('fg2 unaffected', after.fg2.minY <= before.fg2.minY + 1, `(${before.fg2.minY}->${after.fg2.minY})`);
  e.destroy();
}

console.log('stacked-logs: remaining far-side overlap keeps support (no middle sever)');
{
  // FG log + BG hang. Erase FG contact columns NEAREST the free end of FG
  // (away from pillar), leave contact columns nearer the body so the beam
  // stays one component.
  const e = mk(31);
  paintFloor(e);
  paintLog(e, 0, 30, 130, 40, 5);
  paintPillar(e, 0, 40, 43, 45, FLOOR_Y);
  paintLog(e, 1, 110, 210, 40, 5); // overlap 110-130
  step(e, 40);
  const before = stoneTop(e.getGridBg(), 140, 200); // exclusive free span of BG
  check('bg starts supported', before.minY === 40, `(${before.minY})`);
  // Erase right half of FG contact (x=120-130) — still connected via x=110-119 to body/pillar path.
  for (let y = 40; y < 45; y++) for (let x = 120; x < 130; x++) e.eraseDiscLayer(0, x, y, 0);
  step(e, 40);
  const after = stoneTop(e.getGridBg(), 140, 200);
  const co = coCount(e, 110, 120, 40, 45);
  check('half far-side erase keeps bg', after.minY === 40 && co >= 10, `(top ${after.minY}, co ${co})`);
  // Erase remaining contact — fall.
  for (let y = 40; y < 45; y++) for (let x = 110; x < 120; x++) e.eraseDiscLayer(0, x, y, 0);
  step(e, 10);
  const fell = stoneTop(e.getGridBg(), 140, 200);
  check('bg falls after last contact', fell.minY > 42, `(top ${fell.minY})`);
  e.destroy();
}

console.log('stacked-logs: multi-pair simultaneous far-side acid (no creep)');
{
  // Three independent hanging pairs sharing a floor (one mega FG component).
  // Simultaneous acid on every BG free span must not creep any bg while co remains.
  // Regression: pure-bore joint restore slept through multi-pair acid and the
  // middle pair crept one cell/step while co-occupation still existed.
  const e = mk(41);
  paintFloor(e);
  const pairs = [];
  for (let i = 0; i < 3; i++) {
    const base = 20 + i * 70, y = 40;
    paintLog(e, 0, base, base + 40, y, 5);
    paintPillar(e, 0, base + 5, base + 8, y + 5, FLOOR_Y);
    paintLog(e, 1, base + 35, base + 80, y, 5);
    pairs.push({ base, y, bgX0: base + 35, bgX1: base + 80, freeX0: base + 45, freeX1: base + 75 });
  }
  step(e, 50);
  const befores = pairs.map((p) => stoneTop(e.getGridBg(), p.freeX0, p.freeX1));
  for (let i = 0; i < 300; i++) {
    if (i % 2 === 0) for (const p of pairs) e.paintDiscLayer(1, p.bgX0 + 25, p.y - 1, 1, MAT.ACID, true);
    e.step(16 * (i + 1));
  }
  pairs.forEach((p, i) => {
    const after = stoneTop(e.getGridBg(), p.freeX0, p.freeX1);
    const co = coCount(e, p.bgX0, p.bgX0 + 5, p.y, p.y + 5);
    if (co >= 2) {
      check(`pair ${i} no creep under multi-pair acid`, after.minY <= befores[i].minY + 1,
        `(${befores[i].minY}->${after.minY}, co ${co})`);
    } else {
      check(`pair ${i} co dissolved`, true, `(co ${co}, top ${after.minY})`);
    }
  });
  e.destroy();
}

console.log('stacked-logs: stacked horizontal tiers (two y-bands)');
{
  // Lower tier: FG base + BG hanger. Upper tier: FG base + BG hanger, separate.
  const e = mk(51);
  paintFloor(e);
  // lower
  paintLog(e, 0, 30, 100, 50, 5);
  paintPillar(e, 0, 40, 43, 55, FLOOR_Y);
  paintLog(e, 1, 95, 170, 50, 5);
  // upper (gap of 3 empty rows so same-layer logs don't 8-merge)
  paintLog(e, 0, 30, 100, 40, 5);
  paintPillar(e, 0, 50, 53, 45, 50); // short pillar onto lower FG log
  paintLog(e, 1, 95, 170, 40, 5);
  step(e, 60);
  const lowBg = stoneTop(e.getGridBg(), 120, 160);
  const upBg = stoneTop(e.getGridBg(), 120, 160);
  // Both free spans share x — measure by y bands instead
  const band = (y0, y1) => {
    const g = e.getGridBg();
    let n = 0, minY = R;
    for (let y = y0; y < y1; y++) for (let x = 120; x < 160; x++) {
      if (g[kk(x, y)] !== MAT.STONE) continue;
      n++; if (y < minY) minY = y;
    }
    return { n, minY: n ? minY : -1 };
  };
  const low = band(48, 58), up = band(38, 48);
  check('lower bg tier settled', low.minY === 50 && low.n > 50, `(${JSON.stringify(low)})`);
  check('upper bg tier settled', up.minY === 40 && up.n > 50, `(${JSON.stringify(up)})`);
  // Acid mid lower BG — upper must stay
  for (let i = 0; i < 200; i++) {
    if (i % 2 === 0) e.paintDiscLayer(1, 140, 49, 1, MAT.ACID, true);
    e.step(16 * (i + 1));
  }
  const up2 = band(38, 48);
  const lowCo = coCount(e, 95, 100, 50, 55);
  if (lowCo >= 2) {
    // lower may lose cells but if co remains shouldn't free-fall past 52
    const low2 = band(48, 65);
    check('lower stays near height with co', low2.minY <= 52, `(top ${low2.minY}, co ${lowCo})`);
  }
  check('upper unaffected by lower-tier acid', up2.minY === 40, `(top ${up2.minY})`);
  e.destroy();
}

console.log('stacked-logs: free-fall cadence after contact cut');
{
  const e = mk(61);
  paintFloor(e);
  paintLog(e, 0, 30, 90, 35, 5);
  paintPillar(e, 0, 40, 43, 40, FLOOR_Y);
  paintLog(e, 1, 85, 180, 35, 5);
  step(e, 40);
  for (let y = 35; y < 40; y++) for (let x = 85; x < 90; x++) e.eraseDiscLayer(0, x, y, 0);
  const tops = [];
  for (let i = 0; i < 30; i++) {
    e.step(16 * (i + 1));
    tops.push(stoneTop(e.getGridBg(), 100, 170).minY);
  }
  const deltas = [];
  for (let i = 1; i < tops.length; i++) deltas.push(tops[i] - tops[i - 1]);
  let dropped = 0;
  const air = [];
  for (const d of deltas) {
    if (d === 0 && dropped >= 8) break;
    air.push(d);
    dropped += d;
  }
  check('free-fall progress', dropped >= 10, `(dropped ${dropped}, tops ${tops.slice(0, 12).join(',')})`);
  check('free-body fall remains forward-only', air.every((d) => d >= 0), `(deltas ${air.join(',')})`);
  check('free-body fall accelerates', air.some((d) => d > 1), `(deltas ${air.join(',')})`);
  e.destroy();
}

console.log('stacked-logs: dual-layer full slab acid bore (no BG phase-through)');
{
  const e = mk(71);
  paintFloor(e);
  for (let y = FLOOR_Y; y < R; y++) for (let x = 0; x < C; x++) e.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
  e.syncComponentsLayer(1);
  for (let y = 30; y < 38; y++) for (let x = 40; x < 160; x++) {
    e.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
    e.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
  }
  for (let y = 38; y < FLOOR_Y; y++) for (let x = 50; x < 55; x++) {
    e.paintDiscLayer(0, x, y, 0, MAT.STONE, true);
    e.paintDiscLayer(1, x, y, 0, MAT.STONE, true);
  }
  e.syncComponentsLayer(0); e.syncComponentsLayer(1);
  step(e, 40);
  const top0 = stoneTop(e.getGridBg(), 100, 150).minY;
  for (let i = 0; i < 200; i++) {
    if (i % 2 === 0) e.paintDiscLayer(0, 120, 29, 2, MAT.ACID, true);
    e.step(16 * (i + 1));
  }
  const top1 = stoneTop(e.getGridBg(), 100, 150).minY;
  const co = coCount(e, 100, 150, 30, 38);
  if (co > 50) check('BG slab stays with co', top1 <= top0 + 1, `(${top0}->${top1}, co ${co})`);
  else check('co dissolved', true, `(co ${co})`);
  e.destroy();
}

console.log('stacked-logs: chain of 4 logs — partial top-row joint acid keeps support');
{
  const e = mk(81);
  const chain = buildChain(e, { overlap: 6 });
  const before = logTop(e, chain.bg1);
  // Acid only on top surface of joint 0-1 (may nibble rows, leave bottom co)
  for (let i = 0; i < 60; i++) {
    if (i % 3 === 0) {
      for (let x = chain.bg1.x0; x < chain.fg0.x1; x++) e.paintDiscLayer(0, x, chain.y - 1, 0, MAT.ACID, true);
    }
    e.step(16 * (i + 1));
  }
  const co = coCount(e, chain.bg1.x0, chain.fg0.x1, chain.y, chain.y + chain.h);
  const after = logTop(e, chain.bg1);
  if (co >= 4) {
    check('bg1 stays with remaining joint co', after.minY <= before.minY + 1,
      `(${before.minY}->${after.minY}, co ${co})`);
  } else {
    check('joint mostly gone', true, `(co ${co}, top ${after.minY})`);
  }
  e.destroy();
}

// ---------------------------------------------------------------------------
console.log('');
if (failures) {
  console.error(`${failures} stacked-logs check(s) failed`);
  process.exit(1);
}
console.log('all stacked-logs checks passed');
