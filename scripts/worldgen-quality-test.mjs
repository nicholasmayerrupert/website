// High-level world-generation contracts: canonical coordinates, traversable cave
// topology, depth progression, reachable ruins, and useful background cavities.

import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('worldgen quality');
const mk = (cols, rows, seed) => createEngineWasm({
  cols, rows, worldSeed: seed, sinksOn: false, infinite: true,
});

// A seed names one world, independent of the loaded window. Compare both pure
// diagnostics and material cells in the overlap of differently sized buffers.
{
  const seed = 0x51A7E;
  const small = mk(192, 160, seed);
  const large = mk(320, 320, seed);
  let queryMismatches = 0;
  for (let x = -1200; x <= 1200; x += 7) {
    if (small.worldSurfaceAbsAt(x) !== large.worldSurfaceAbsAt(x)) queryMismatches++;
    if (small.worldBiomeAt(x) !== large.worldBiomeAt(x)) queryMismatches++;
    for (let y = 24; y <= 560; y += 29) {
      if (small.worldCaveBiomeAt(x, y) !== large.worldCaveBiomeAt(x, y)) queryMismatches++;
      if (small.worldIsCaveAt(0, x, y) !== large.worldIsCaveAt(0, x, y)) queryMismatches++;
      if (small.worldIsCaveAt(1, x, y) !== large.worldIsCaveAt(1, x, y)) queryMismatches++;
    }
  }
  check(`world queries ignore viewport dimensions (mismatches ${queryMismatches})`, queryMismatches === 0);

  const overlap = {
    x0: Math.max(small.getWorldOffsetX(), large.getWorldOffsetX()),
    y0: Math.max(small.getWorldOffsetY(), large.getWorldOffsetY()),
    x1: Math.min(small.getWorldOffsetX() + 192, large.getWorldOffsetX() + 320),
    y1: Math.min(small.getWorldOffsetY() + 160, large.getWorldOffsetY() + 320),
  };
  let cellMismatches = 0, compared = 0;
  for (const layer of [0, 1]) {
    const a = layer ? small.getGridBg() : small.getGrid();
    const b = layer ? large.getGridBg() : large.getGrid();
    for (let wy = overlap.y0 + 1; wy < overlap.y1 - 1; wy++)
      for (let wx = overlap.x0 + 1; wx < overlap.x1 - 1; wx++) {
        const ai = (wy - small.getWorldOffsetY()) * 192 + wx - small.getWorldOffsetX();
        const bi = (wy - large.getWorldOffsetY()) * 320 + wx - large.getWorldOffsetX();
        compared++;
        if (a[ai] !== b[bi]) cellMismatches++;
      }
  }
  check(`generated overlap is viewport-independent (${compared} cells, ${cellMismatches} mismatches)`,
    compared > 20_000 && cellMismatches === 0);
  small.destroy();
  large.destroy();
}

// Flood from every surface entrance in a macro-region. The guaranteed backbone
// must carry that flood into the deep cave band without tunnelling through solids.
function caveReach(e, region) {
  const x0 = region * 256 - 10, x1 = (region + 1) * 256 + 10;
  const y0 = -180, y1 = 450;
  const width = x1 - x0 + 1, height = y1 - y0 + 1;
  const cave = new Uint8Array(width * height);
  const seen = new Uint8Array(cave.length);
  const queue = new Int32Array(cave.length);
  let head = 0, tail = 0, deepest = y0;

  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      cave[(y - y0) * width + x - x0] = e.worldIsCaveAt(0, x, y) ? 1 : 0;

  for (let x = x0; x <= x1; x++) {
    const surface = e.worldSurfaceAbsAt(x);
    for (let y = surface; y <= surface + 2; y++) {
      if (y < y0 || y > y1) continue;
      const i = (y - y0) * width + x - x0;
      if (cave[i] && !seen[i]) { seen[i] = 1; queue[tail++] = i; }
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width, y = (i / width) | 0;
    deepest = Math.max(deepest, y + y0);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = ny * width + nx;
      if (!cave[ni] || seen[ni]) continue;
      seen[ni] = 1;
      queue[tail++] = ni;
    }
  }
  return { deepest, cells: tail };
}

{
  let failedRoutes = 0, smallestFlood = Infinity;
  for (const seed of [0, 0xBED, 0xBEEF]) {
    const e = mk(128, 128, seed);
    for (let region = -2; region <= 2; region++) {
      const route = caveReach(e, region);
      smallestFlood = Math.min(smallestFlood, route.cells);
      if (route.deepest < 420) failedRoutes++;
    }
    e.destroy();
  }
  check(`surface entrances reach the deep cave band (15 regions, ${failedRoutes} failures)`,
    failedRoutes === 0 && smallestFlood > 1_000);
}

// Background caves should create real transfer/exploration choices without
// duplicating the foreground's cavern volume.
{
  const e = mk(128, 128, 0xBED);
  let fg = 0, bg = 0, overlap = 0, samples = 0;
  for (let y = 40; y < 520; y += 2) for (let x = -768; x < 768; x += 2) {
    const f = e.worldIsCaveAt(0, x, y);
    const b = e.worldIsCaveAt(1, x, y);
    fg += f;
    bg += b;
    overlap += f && b;
    samples++;
  }
  const fgFraction = fg / samples, bgFraction = bg / samples;
  check(`background caves are sparse but substantial (${(bgFraction * 100).toFixed(1)}% vs fg ${(fgFraction * 100).toFixed(1)}%)`,
    bgFraction > 0.05 && bgFraction < fgFraction * 0.45 && overlap > 1_000);
  e.destroy();
}

// Every seed gets compact coal and copper lodes near the original spawn.
{
  let missing = 0, leastCoal = Infinity, leastCopper = Infinity;
  for (const seed of [0, 1, 0xBED, 0xBEEF]) {
    const e = mk(256, 256, seed);
    const grid = e.getGrid(), ox = e.getWorldOffsetX(), oy = e.getWorldOffsetY();
    let coal = 0, copper = 0;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const wx = ox + x;
      if (Math.abs(wx) > 128) continue;
      const depth = oy + y - e.worldSurfaceAbsAt(wx);
      if (depth < 16 || depth > 100) continue;
      const mat = grid[y * 256 + x];
      coal += mat === MAT.COAL_ORE;
      copper += mat === MAT.COPPER_ORE;
    }
    leastCoal = Math.min(leastCoal, coal);
    leastCopper = Math.min(leastCopper, copper);
    if (coal < 24 || copper < 24) missing++;
    e.destroy();
  }
  check(`starter coal/copper are guaranteed (minimum ${leastCoal}/${leastCopper} cells)`, missing === 0);
}

// Sample a broad generated volume. Advanced ore rewards obey their depth gates,
// early caves are hazard-free, and underground ruins touch the open cave graph.
{
  const e = mk(256, 256, 0xBED);
  let minIron = Infinity, minGold = Infinity, minHazard = Infinity;
  let iron = 0, gold = 0, deepHazards = 0;
  let ruinSamples = 0, reachableRuinSamples = 0;
  for (let vertical = 0; vertical < 7; vertical++) {
    if (vertical) e.shiftWorldXY(0, 96);
    for (let band = 0; band < 14; band++) {
      const grid = e.getGrid(), ox = e.getWorldOffsetX(), oy = e.getWorldOffsetY();
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const mat = grid[y * 256 + x];
        const wx = ox + x, wy = oy + y;
        const depth = wy - e.worldSurfaceAbsAt(wx);
        if (mat === MAT.IRON_ORE) { iron++; minIron = Math.min(minIron, depth); }
        if (mat === MAT.GOLD_ORE) { gold++; minGold = Math.min(minGold, depth); }
        if (mat === MAT.ACID || mat === MAT.LAVA || mat === MAT.METHANE) {
          minHazard = Math.min(minHazard, depth);
          if (depth > 180) deepHazards++;
        }
        if (mat !== MAT.BRICK || depth <= 30 || x < 14 || x >= 242 || y < 14 || y >= 242
            || ((wx * 31 + wy * 17) & 31) !== 0) continue;
        ruinSamples++;
        let reachable = false;
        for (let dy = -12; dy <= 12 && !reachable; dy++)
          for (let dx = -12; dx <= 12; dx++) {
            const i = (y + dy) * 256 + x + dx;
            if (grid[i] === MAT.EMPTY && e.worldIsCaveAt(0, wx + dx, wy + dy)) {
              reachable = true;
              break;
            }
          }
        reachableRuinSamples += reachable;
      }
      e.shiftWorldXY(128, 0);
    }
    e.shiftWorldXY(-14 * 128, 0);
  }
  check(`iron stays below its depth gate (minimum depth ${minIron})`, iron > 1_000 && minIron > 105);
  check(`gold stays below its depth gate (minimum depth ${minGold})`, gold > 100 && minGold > 300);
  check(`hazards ramp in after the early cave network (minimum depth ${minHazard}, deep cells ${deepHazards})`,
    minHazard > 90 && deepHazards > 1_000);
  check(`underground ruins meet the open cave graph (${reachableRuinSamples}/${ruinSamples} samples)`,
    ruinSamples > 100 && reachableRuinSamples / ruinSamples > 0.90);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
