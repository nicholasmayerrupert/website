// A Noita-inspired procedural world: surface ruins over a layered underground
// of cave biomes, pockets of liquids, embedded structures, and environmental
// hazards. It deliberately uses only the existing material set and engine rules.

import { MAT } from '../engine.js';
import { createWorldContext } from '../worldgen/context.js';
import {
  heightField,
  fillTerrain,
  floodWater,
  scatterSurface,
} from '../worldgen/terrain.js';
import {
  bridge,
  house,
  placeOnSurface,
  ruinedArch,
  ruinedTower,
  tree,
  watchtower,
  well,
} from '../worldgen/structures.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const rectEmptyRatio = (ctx, x0, y0, w, h) => {
  let empty = 0;
  let total = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      total++;
      if (ctx.get(x, y) === ctx.MAT.EMPTY) empty++;
    }
  }
  return total === 0 ? 0 : empty / total;
};

const carveDisc = (ctx, cx, cy, r, material = ctx.MAT.EMPTY) => {
  const rr = r * r;
  const lim = Math.ceil(r);
  for (let oy = -lim; oy <= lim; oy++) {
    for (let ox = -lim; ox <= lim; ox++) {
      if (ox * ox + oy * oy <= rr) ctx.put(cx + ox, cy + oy, material);
    }
  }
};

const carveEllipse = (ctx, cx, cy, rx, ry, material = ctx.MAT.EMPTY) => {
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  for (let oy = -ry; oy <= ry; oy++) {
    for (let ox = -rx; ox <= rx; ox++) {
      if ((ox * ox) / rx2 + (oy * oy) / ry2 <= 1) {
        ctx.put(cx + ox, cy + oy, material);
      }
    }
  }
};

const fillIfEmpty = (ctx, x0, y0, w, h, material) => {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) ctx.putIfEmpty(x, y, material);
  }
};

const materialAtDepth = (ctx, y, field) => {
  const depth = (y - field.baseY) / Math.max(1, ctx.rows - field.baseY);
  if (depth > 0.78) return ctx.MAT.LAVA;
  if (depth > 0.58) return ctx.rng() < 0.35 ? ctx.MAT.ACID : ctx.MAT.WATER;
  if (depth > 0.38) return ctx.rng() < 0.45 ? ctx.MAT.OIL : ctx.MAT.WATER;
  return ctx.MAT.WATER;
};

function carveCavernNetwork(ctx, field) {
  const { cols, rows, rng, noise } = ctx;
  const roomCount = clamp(Math.round(cols / 18), 8, 24);
  const rooms = [];
  const yTop = Math.max(8, field.baseY + 8);
  const yBottom = rows - 8;

  for (let i = 0; i < roomCount; i++) {
    const layer = i / Math.max(1, roomCount - 1);
    const x = clamp(
      Math.round(cols * (0.08 + rng() * 0.84)),
      4,
      cols - 5
    );
    const wave = noise.fbm2(ctx.worldX(x) * 0.026, layer * 3.3, { octaves: 3 });
    const y = clamp(
      Math.round(yTop + layer * (yBottom - yTop) + (wave - 0.5) * rows * 0.16),
      yTop,
      yBottom
    );
    const rx = 5 + Math.floor(rng() * 10);
    const ry = 3 + Math.floor(rng() * 6);
    rooms.push({ x, y, rx, ry, depth: layer });
    carveEllipse(ctx, x, y, rx, ry);

    if (rng() < 0.58) {
      const pocket = materialAtDepth(ctx, y, field);
      const poolH = clamp(Math.floor(ry * (0.45 + rng() * 0.45)), 1, ry + 1);
      fillIfEmpty(ctx, x - rx + 2, y + ry - poolH, rx * 2 - 3, poolH, pocket);
    }
  }

  rooms.sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1];
    const b = rooms[i];
    const midX = Math.round((a.x + b.x) * 0.5 + (rng() - 0.5) * 22);
    const pts = [
      [a.x, a.y],
      [midX, a.y + Math.round((b.y - a.y) * 0.35)],
      [midX, a.y + Math.round((b.y - a.y) * 0.7)],
      [b.x, b.y],
    ];
    for (let p = 1; p < pts.length; p++) {
      carveTunnel(ctx, pts[p - 1][0], pts[p - 1][1], pts[p][0], pts[p][1], 2 + rng() * 1.8);
    }
  }

  const sideBranches = Math.max(5, Math.round(cols / 45));
  for (let i = 0; i < sideBranches; i++) {
    const room = rooms[Math.floor(rng() * rooms.length)];
    const dir = rng() < 0.5 ? -1 : 1;
    const len = 18 + Math.floor(rng() * 36);
    const endX = clamp(room.x + dir * len, 3, cols - 4);
    const endY = clamp(room.y + Math.round((rng() - 0.5) * 18), yTop, yBottom);
    carveTunnel(ctx, room.x, room.y, endX, endY, 1.4 + rng() * 1.4);
    if (rng() < 0.7) carveEllipse(ctx, endX, endY, 3 + Math.floor(rng() * 5), 2 + Math.floor(rng() * 4));
  }

  return rooms;
}

function carveTunnel(ctx, x0, y0, x1, y1, r) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const wobble = 0.55 + ctx.noise.fbm2(ctx.worldX(x) * 0.08, y * 0.05, { octaves: 2 }) * 0.75;
    carveDisc(ctx, x, y, r * wobble);
  }
}

function dressCaveBiomes(ctx, field) {
  const { cols, rows, MAT, rng, noise } = ctx;
  for (let y = field.baseY + 5; y < rows - 3; y++) {
    const depth = (y - field.baseY) / Math.max(1, rows - field.baseY);
    for (let x = 2; x < cols - 2; x++) {
      if (ctx.get(x, y) !== MAT.EMPTY) continue;
      const floor = ctx.get(x, y + 1);
      const ceiling = ctx.get(x, y - 1);
      const n = noise.fbm2(ctx.worldX(x) * 0.07, y * 0.06, { octaves: 3 });

      if (floor === MAT.STONE || floor === MAT.SAND) {
        if (depth < 0.28 && rng() < 0.08) ctx.put(x, y, MAT.PLANT);
        else if (depth < 0.52 && n > 0.72 && rng() < 0.18) ctx.put(x, y, MAT.PLANT);
        else if (depth > 0.7 && n > 0.68 && rng() < 0.05) ctx.put(x, y, MAT.FIRE);
        else if (depth > 0.82 && rng() < 0.018) ctx.put(x, y, MAT.LAVA);
      }

      if ((ceiling === MAT.STONE || ceiling === MAT.SAND) && depth > 0.18 && n > 0.66 && rng() < 0.05) {
        const drip = depth > 0.65 ? MAT.LAVA : depth > 0.45 ? MAT.ACID : MAT.WATER;
        ctx.put(x, y, drip);
      }
    }
  }
}

function placeUndergroundRuins(ctx, rooms) {
  const candidates = rooms
    .filter((r) => r.y > ctx.rows * 0.34 && r.y < ctx.rows - 12 && r.rx >= 6)
    .sort((a, b) => b.rx * b.ry - a.rx * a.ry);
  const count = Math.min(candidates.length, clamp(Math.round(ctx.cols / 70), 2, 6));

  for (let i = 0; i < count; i++) {
    const room = candidates[(i * 2) % candidates.length];
    if (!room) continue;
    const style = i % 3;
    if (style === 0) shrine(ctx, room);
    else if (style === 1) mineGallery(ctx, room);
    else collapsedLab(ctx, room);
  }
}

function shrine(ctx, room) {
  const { MAT, rng, rect, put } = ctx;
  const w = clamp(room.rx * 2 - 3, 7, 17);
  const h = clamp(room.ry + 4, 7, 13);
  const x0 = room.x - (w >> 1);
  const y0 = room.y + room.ry - h;
  if (rectEmptyRatio(ctx, x0 - 1, y0 - 1, w + 2, h + 2) < 0.45) return;

  rect(x0, y0, w, h, MAT.STONE);
  rect(x0 + 1, y0 + 1, w - 2, h - 2, MAT.EMPTY);
  rect(x0 + 2, y0 + h - 2, w - 4, 1, MAT.STONE);
  for (let x = x0 + 1; x < x0 + w - 1; x += 3) put(x, y0, MAT.STONE);
  rect(room.x - 1, y0 + h - 4, 2, 4, MAT.EMPTY);
  put(x0 + 1, y0 + 2, MAT.FIRE);
  put(x0 + w - 2, y0 + 2, MAT.FIRE);
  if (rng() < 0.5) fillIfEmpty(ctx, x0 + 2, y0 + h - 3, w - 4, 1, MAT.WATER);
}

function mineGallery(ctx, room) {
  const { MAT, rect, put, rng } = ctx;
  const y = room.y + Math.floor(room.ry * 0.35);
  const x0 = room.x - room.rx + 2;
  const x1 = room.x + room.rx - 2;
  if (x1 - x0 < 8) return;

  rect(x0, y, x1 - x0 + 1, 1, MAT.WOOD);
  for (let x = x0; x <= x1; x += 5) {
    rect(x, y - 3, 1, 4, MAT.WOOD);
    if (rng() < 0.45) put(x, y - 4, MAT.FIRE);
  }
  if (rng() < 0.65) fillIfEmpty(ctx, x0 + 2, y - 2, 3 + Math.floor(rng() * 5), 2, MAT.OIL);
}

function collapsedLab(ctx, room) {
  const { MAT, rect, put, rng } = ctx;
  const w = clamp(room.rx + 4, 8, 16);
  const h = clamp(room.ry + 3, 7, 12);
  const x0 = room.x - (w >> 1);
  const y0 = room.y - (h >> 1);
  if (rectEmptyRatio(ctx, x0 - 1, y0 - 1, w + 2, h + 2) < 0.4) return;

  rect(x0, y0, w, h, MAT.STONE);
  rect(x0 + 1, y0 + 1, w - 2, h - 2, MAT.EMPTY);
  rect(x0 + 2, y0 + Math.floor(h * 0.55), w - 4, 1, MAT.WOOD);
  rect(x0 + 1, y0 + h - 3, 2 + Math.floor(rng() * 4), 2, rng() < 0.5 ? MAT.ACID : MAT.WATER);
  for (let i = 0; i < 5; i++) put(x0 + Math.floor(rng() * w), y0 + Math.floor(rng() * h), rng() < 0.6 ? MAT.STONE : MAT.WOOD);
  if (rng() < 0.7) put(x0 + w - 2, y0 + 2, MAT.FIRE);
}

function placeIntegratedSurface(ctx, field) {
  const { cols, rng } = ctx;
  const span = cols * 0.9;
  const placed = [];
  const overlaps = (x0, x1) => placed.some((p) => !(x1 < p.x0 - 3 || x0 > p.x1 + 3));
  const reserve = (gx, half) => {
    if (gx - half < 2 || gx + half > cols - 3 || overlaps(gx - half, gx + half)) return false;
    placed.push({ x0: gx - half, x1: gx + half });
    return true;
  };
  const flatness = (gx, half) => {
    const x0 = clamp(gx - half, 1, cols - 2);
    const x1 = clamp(gx + half, 1, cols - 2);
    let min = field.surface[x0];
    let max = min;
    for (let x = x0; x <= x1; x++) {
      if (field.surface[x] < min) min = field.surface[x];
      if (field.surface[x] > max) max = field.surface[x];
    }
    return max - min;
  };
  const terraformPad = (gx, half, y) => {
    for (let x = gx - half; x <= gx + half; x++) {
      const cur = field.surface[clamp(x, 0, cols - 1)];
      if (cur > y) ctx.fillColumn(x, y, cur, ctx.MAT.STONE);
      else if (cur < y) ctx.rect(x, cur, 1, y - cur, ctx.MAT.EMPTY);
      ctx.put(x, y, ctx.MAT.STONE);
    }
  };
  const trySurface = (dx, half, builder, opts = {}) => {
    const gx = ctx.cx(dx);
    if (!reserve(gx, half)) return false;
    const baseY = ctx.surfaceAt(gx);
    if (baseY >= ctx.rows || flatness(gx, half) > opts.maxSlope) {
      placed.pop();
      return false;
    }
    terraformPad(gx, half, baseY);
    placeOnSurface(ctx, dx, builder, opts);
    return true;
  };

  trySurface(0, 9, ruinedTower, { maxSlope: 6 });

  const palette = [
    { build: house, half: 10, maxSlope: 5 },
    { build: ruinedArch, half: 8, maxSlope: 8 },
    { build: watchtower, half: 5, maxSlope: 7 },
    { build: well, half: 4, maxSlope: 4 },
  ];
  const target = clamp(Math.round(cols / 58) + 2, 4, 10);
  for (let i = 0, made = 0; made < target && i < target * 8; i++) {
    const p = palette[Math.floor(rng() * palette.length)];
    const dx = Math.round((rng() - 0.5) * span);
    if (trySurface(dx, p.half, p.build, { maxSlope: p.maxSlope })) made++;
  }

  for (let i = 0; i < Math.max(3, Math.round(cols / 55)); i++) {
    const dx = Math.round((rng() - 0.5) * span);
    const gx = ctx.cx(dx);
    if (overlaps(gx - 3, gx + 3)) continue;
    if (rng() < 0.25) placeOnSurface(ctx, dx, bridge, { span: 10 + Math.floor(rng() * 14), clearance: 3 + Math.floor(rng() * 4) });
    else placeOnSurface(ctx, dx, tree);
  }
}

function addHazardPockets(ctx, field) {
  const { cols, rows, MAT, rng } = ctx;
  const count = clamp(Math.round(cols / 35), 5, 14);
  for (let i = 0; i < count; i++) {
    const x = 4 + Math.floor(rng() * (cols - 8));
    const minY = Math.max(field.surface[x] + 10, field.baseY + 6);
    const y = clamp(minY + Math.floor(rng() * Math.max(1, rows - minY - 6)), minY, rows - 6);
    const r = 2 + Math.floor(rng() * 5);
    const material = materialAtDepth(ctx, y, field);
    carveDisc(ctx, x, y, r + 1);
    carveDisc(ctx, x, y, r, material);
    if (material === MAT.LAVA && rng() < 0.65) ctx.put(x, y - r - 1, MAT.FIRE);
    if (material === MAT.WATER && rng() < 0.35) carveDisc(ctx, x + r + 2, y, 2, MAT.ICE);
  }
}

export function buildNoitaScene(api) {
  const ctx = createWorldContext(api);
  const field = heightField(ctx, {
    frequency: 0.022,
    octaves: 6,
    amplitude: Math.max(10, Math.floor(ctx.rows * 0.28)),
    baseFromBottom: Math.max(12, Math.floor(ctx.rows * 0.48)),
  });

  fillTerrain(ctx, field, {
    skin: 1,
    soil: Math.max(3, Math.floor(ctx.rows * 0.06)),
  });

  const rooms = carveCavernNetwork(ctx, field);
  floodWater(ctx, field, {
    caveWaterFromBottom: Math.max(4, Math.floor(ctx.rows * 0.14)),
  });
  addHazardPockets(ctx, field);
  placeUndergroundRuins(ctx, rooms);
  dressCaveBiomes(ctx, field);
  placeIntegratedSurface(ctx, field);
  scatterSurface(ctx, field, {
    tuftChance: 0.26,
    emberChance: 0.012,
  });

  ctx.commit();
}

export const noitaEmitters = [
  { material: MAT.WATER, rateMs: 180, pos: { x: 0.18, y: 0.08 }, r: 1 },
  { material: MAT.SAND, rateMs: 260, pos: { x: 0.52, y: 0.07 }, r: 1 },
  { material: MAT.LAVA, rateMs: 520, pos: { x: 0.83, y: 0.1 }, r: 1 },
];
