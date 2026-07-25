// Deep-world contracts: the upper network joins the abyss without a cutoff,
// rock strata blend gradually, deep biomes stay diverse, and chamber-scale
// features/monuments survive deterministic streaming.

import { initSandWasm, createEngineWasm, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('deep worldgen');
const mk = (cols, rows, seed) => createEngineWasm({
  cols, rows, worldSeed: seed, sinksOn: false, infinite: true,
});

// Flood from a real surface mouth, through the former y=576 cave floor, and well
// into the deep graph. A visually hidden one-cell break fails this at cell scale.
function floodFromSurface(engine, region) {
  const x0 = region * 256 - 180, x1 = (region + 1) * 256 + 180;
  const y0 = -160, y1 = 1000;
  const width = x1 - x0 + 1, height = y1 - y0 + 1;
  const cave = new Uint8Array(width * height);
  const seen = new Uint8Array(cave.length);
  const queue = new Int32Array(cave.length);
  let head = 0, tail = 0, deepest = y0, crossedOldFloor = false;

  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
    cave[(y - y0) * width + x - x0] = engine.worldIsCaveAt(0, x, y) ? 1 : 0;
  for (let x = region * 256; x < (region + 1) * 256; x++) {
    const surface = engine.worldSurfaceAbsAt(x);
    for (let y = surface; y <= surface + 2; y++) {
      const i = (y - y0) * width + x - x0;
      if (i >= 0 && i < cave.length && cave[i] && !seen[i]) {
        seen[i] = 1;
        queue[tail++] = i;
      }
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width, y = (i / width) | 0;
    const worldY = y0 + y;
    deepest = Math.max(deepest, worldY);
    crossedOldFloor ||= worldY === 576;
    for (const next of [x ? i - 1 : -1, x + 1 < width ? i + 1 : -1,
      y ? i - width : -1, y + 1 < height ? i + width : -1]) {
      if (next >= 0 && cave[next] && !seen[next]) {
        seen[next] = 1;
        queue[tail++] = next;
      }
    }
  }
  return { deepest, crossedOldFloor, cells: tail };
}

{
  let failures = 0, smallestFlood = Infinity;
  for (const seed of [0, 0xBED, 0xBEEF]) {
    const engine = mk(96, 96, seed);
    const result = floodFromSurface(engine, 0);
    smallestFlood = Math.min(smallestFlood, result.cells);
    failures += !result.crossedOldFloor || result.deepest < 995;
    engine.destroy();
  }
  check(`surface caves cross the old floor and reach y=1000 (${failures} failures)`,
    failures === 0 && smallestFlood > 12_000);
}

// Deep realms are broad, but their fBm thresholds should not starve any of the
// four identities across representative worlds.
{
  const counts = [0, 0, 0, 0];
  for (const seed of [0xBED, 0xBEEF, 7]) {
    const engine = mk(96, 96, seed);
    for (let y = 720; y <= 2200; y += 104)
      for (let x = -3600; x <= 3600; x += 144) {
        const biome = engine.worldCaveBiomeAt(x, y);
        if (biome >= 4 && biome <= 7) counts[biome - 4]++;
      }
    engine.destroy();
  }
  check(`all deep biomes remain common (magma/geode/fossil/void ${counts.join('/')})`,
    counts.every((count) => count >= 100));
}

// Background recesses remain rare at depth. In particular, the infinite
// foreground graph must never be copied into the backdrop as lines.
{
  const engine = mk(96, 96, 0xBED);
  let foreground = 0, background = 0, samples = 0;
  for (let y = 720; y < 1400; y += 4) for (let x = -1600; x < 1600; x += 4) {
    foreground += engine.worldIsCaveAt(0, x, y);
    background += engine.worldIsCaveAt(1, x, y);
    samples++;
  }
  const fgFraction = foreground / samples, bgFraction = background / samples;
  check(`deep background stays solid (${(bgFraction * 100).toFixed(2)}% void vs foreground ${(fgFraction * 100).toFixed(1)}%)`,
    fgFraction > 0.20 && bgFraction < 0.03);
  engine.destroy();
}

// Inspect actual generated cells across the transition. Both rocks coexist for a
// long interval and the deepstone share rises monotonically; no row performs an
// abrupt global material swap.
{
  const COLS = 512, ROWS = 320;
  const engine = mk(COLS, ROWS, 0xBED);
  engine.shiftWorldXY(0, 256);
  engine.shiftWorldXY(0, 256);
  const grid = engine.getGrid();
  const ox = engine.getWorldOffsetX(), oy = engine.getWorldOffsetY();
  const bands = [[480, 520], [560, 600], [640, 680], [704, 744]];
  const shares = bands.map(([a, b]) => {
    let stone = 0, deepstone = 0;
    for (let wy = a; wy < b; wy++) for (let wx = ox; wx < ox + COLS; wx++) {
      const mat = grid[(wy - oy) * COLS + wx - ox];
      stone += mat === MAT.STONE;
      deepstone += mat === MAT.DEEPSTONE;
    }
    return deepstone / Math.max(1, stone + deepstone);
  });
  let hardRows = 0;
  for (let wy = 520; wy < 680; wy++) {
    let stone = 0, deepstone = 0;
    for (let x = 0; x < COLS; x++) {
      const mat = grid[(wy - oy) * COLS + x];
      stone += mat === MAT.STONE;
      deepstone += mat === MAT.DEEPSTONE;
    }
    if (stone + deepstone > COLS / 3 && (!stone || !deepstone)) hardRows++;
  }
  check(`stone blends into deepstone (${shares.map((v) => `${(v * 100).toFixed(0)}%`).join(' -> ')})`,
    shares[0] < 0.30 && shares[1] > shares[0] && shares[2] > shares[1]
      && shares[3] > 0.97 && hardRows === 0);
  engine.destroy();
}

function deepWindowMetrics(engine, cols, rows) {
  const fg = engine.getGrid(), bg = engine.getGridBg();
  let lava = 0, maxLavaRun = 0, decor = 0, largeHalls = 0;
  for (let y = 0; y < rows; y++) {
    let run = 0;
    for (let x = 0; x < cols; x++) {
      const mat = fg[y * cols + x];
      if (mat === MAT.LAVA) {
        lava++;
        maxLavaRun = Math.max(maxLavaRun, ++run);
      } else run = 0;
      decor += [MAT.WOOD, MAT.IRON_ORE, MAT.GOLD_ORE, MAT.CRYSTAL, MAT.MYCELIUM,
        MAT.GLOWSHROOM, MAT.LAVA, MAT.DEBRIS].includes(bg[y * cols + x]);
    }
  }

  // Monument shells form one connected brick/sandstone component spanning most
  // of a chamber; count only tall, broad components to exclude ore and accents.
  const seen = new Uint8Array(fg.length);
  const stack = [];
  for (let start = 0; start < fg.length; start++) {
    if (seen[start] || (fg[start] !== MAT.BRICK && fg[start] !== MAT.SANDSTONE)) continue;
    seen[start] = 1;
    stack.push(start);
    let cells = 0, minX = cols, maxX = -1, minY = rows, maxY = -1;
    while (stack.length) {
      const i = stack.pop(), x = i % cols, y = (i / cols) | 0;
      cells++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const next of [x ? i - 1 : -1, x + 1 < cols ? i + 1 : -1,
        y ? i - cols : -1, y + 1 < rows ? i + cols : -1])
        if (next >= 0 && !seen[next]
            && (fg[next] === MAT.BRICK || fg[next] === MAT.SANDSTONE)) {
          seen[next] = 1;
          stack.push(next);
        }
    }
    if (cells > 140 && maxX - minX + 1 >= 70 && maxY - minY + 1 >= 24) largeHalls++;
  }
  return { lava, maxLavaRun, decor, largeHalls };
}

// Search several streamed windows. This verifies actual cells—not only planning
// queries—and gives broad biomes enough room to reveal their signature landmark.
{
  const COLS = 512, ROWS = 320;
  let lava = 0, maxLavaRun = 0, decor = 0, largeHalls = 0;
  for (const seed of [0xBED, 0xBEEF, 7]) {
    const engine = mk(COLS, ROWS, seed);
    for (let i = 0; i < 3; i++) engine.shiftWorldXY(0, 256);
    for (let window = 0; window < 8; window++) {
      const metrics = deepWindowMetrics(engine, COLS, ROWS);
      lava += metrics.lava;
      maxLavaRun = Math.max(maxLavaRun, metrics.maxLavaRun);
      decor += metrics.decor;
      largeHalls += metrics.largeHalls;
      engine.shiftWorldXY(256, 0);
      if (window === 3) {
        engine.shiftWorldXY(0, 256);
        engine.shiftWorldXY(0, 256);
      }
    }
    engine.destroy();
  }
  check(`magma realms contain huge lava seas (${lava} cells, widest level span ${maxLavaRun})`,
    lava > 8_000 && maxLavaRun >= 80);
  check(`deep monuments are large and furnished (${largeHalls} halls, ${decor} background details)`,
    largeHalls >= 4 && decor > 2_000);
}

// Component-backed architecture must remain anchored once simulation starts.
// These are the same deterministic representatives used by the visual atlas.
{
  let movedCells = 0, compared = 0;
  for (const [worldX, worldY, wall] of [
    [2009, 768, MAT.BRICK],       // crystal observatory
    [4267, 686, MAT.SANDSTONE],   // fossil conservatory
  ]) {
    const COLS = 320, ROWS = 240;
    const engine = mk(COLS, ROWS, 3053);
    while (worldX - engine.getWorldOffsetX() > COLS - 80) engine.shiftWorldXY(160, 0);
    while (worldY - engine.getWorldOffsetY() > ROWS - 50) engine.shiftWorldXY(0, 160);
    const before = Uint8Array.from(engine.getGrid(), (mat) => mat === wall ? 1 : 0);
    let time = 0;
    for (let step = 0; step < 300; step++) {
      time += 16;
      engine.step(time);
    }
    const after = engine.getGrid();
    for (let i = 0; i < before.length; i++) {
      compared += before[i];
      movedCells += before[i] && after[i] !== wall;
    }
    engine.destroy();
  }
  check(`deep component architecture stays anchored (${compared} cells, ${movedCells} moved)`,
    compared > 800 && movedCells === 0);
}

done();
