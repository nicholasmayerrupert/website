// The same content compiler runs in Node, the browser, and the authority worker.
import { MAT } from '../materials.js';
import { CREATURE, ITEM_KIND, OBJECTIVE_KIND } from '../wasmBridge/abi.generated.js';
import creatureArt from './creatureArt.js';

export const CONTENT_VERSION = 1;
export const ABSOLUTE = -2147483648;
export const ANIMATION_STATES = ['idle', 'walk', 'run', 'rise', 'fall', 'wade', 'swim'];
const fail = (path, message) => { throw new Error(`${path}: ${message}`); };
const integer = (value, path, min = -100000, max = 100000) => {
  if (!Number.isInteger(value) || value < min || value > max) fail(path, `expected integer ${min}…${max}`);
  return value;
};
const point = (value, path) => {
  if (!Array.isArray(value) || value.length !== 2) fail(path, 'expected [x, y]');
  return value.map((n, i) => integer(n, `${path}[${i}]`));
};
const bounds = (value, path) => {
  if (!Array.isArray(value) || value.length !== 4) fail(path, 'expected [left, top, right, bottom]');
  value.forEach((n, i) => integer(n, `${path}[${i}]`));
  if (value[0] > value[2] || value[1] > value[3]) fail(path, 'bounds are reversed');
  return value;
};
export function contentHash(value) {
  let hash = 2166136261;
  for (const c of JSON.stringify(value)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function compileContent(world, sprite, creatureSources = creatureArt) {
  if (world.version !== CONTENT_VERSION || sprite.version !== CONTENT_VERSION) fail('version', 'unsupported content version');
  const rects = [];
  const ids = new Set();
  const anchors = {};
  const scenes = [];
  const emit = (layer, surface, rect, mat, path) => {
    if (!['fg', 'bg', 'both'].includes(layer)) fail(path, `unknown layer ${layer}`);
    if (!Object.hasOwn(MAT, mat)) fail(path, `unknown material ${mat}`);
    bounds(rect, path);
    rects.push([layer === 'both' ? 2 : layer === 'bg' ? 1 : 0, surface, ...rect, MAT[mat]]);
    if (rects.length > 20000) fail(path, 'too many stamp rectangles');
  };
  const expand = (ops, origin, surface, path, stack = []) => {
    if (!Array.isArray(ops)) fail(path, 'expected operations');
    ops.forEach((op, index) => {
      const p = `${path}[${index}]`;
      if (op.use) {
        if (stack.includes(op.use) || stack.length > 12) fail(p, 'recursive prefab');
        const prefab = world.prefabs?.[op.use];
        if (!prefab) fail(p, `unknown prefab ${op.use}`);
        const at = point(op.at || [0, 0], `${p}.at`);
        expand(prefab, [origin[0] + at[0], origin[1] + at[1]], surface, p, [...stack, op.use]);
      } else if (op.rect) {
        const r = bounds(op.rect, `${p}.rect`);
        emit(op.layer, surface, [r[0] + origin[0], r[1] + origin[1], r[2] + origin[0], r[3] + origin[1]], op.material, p);
      } else if (op.polygon) {
        if (!Array.isArray(op.polygon) || op.polygon.length < 3) fail(p, 'polygon needs at least three points');
        const points = op.polygon.map((v, i) => point(v, `${p}.polygon[${i}]`));
        const lo = Math.min(...points.map(v => v[1])), hi = Math.max(...points.map(v => v[1]));
        if (hi - lo > 2048) fail(p, 'polygon is too tall');
        for (let y = lo; y < hi; y++) {
          const cuts = [];
          points.forEach((a, i) => {
            const b = points[(i + 1) % points.length], scan = y + .5;
            if ((a[1] <= scan && b[1] > scan) || (b[1] <= scan && a[1] > scan))
              cuts.push(a[0] + (scan - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
          });
          cuts.sort((a, b) => a - b);
          for (let i = 0; i + 1 < cuts.length; i += 2) {
            const left = Math.ceil(cuts[i]), right = Math.floor(cuts[i + 1]);
            if (left <= right) emit(op.layer, surface, [left + origin[0], y + origin[1], right + origin[0], y + origin[1]], op.material, p);
          }
        }
      } else fail(p, 'expected rect, polygon, or prefab use');
    });
  };
  for (const site of world.sites) {
    if (!/^[a-z][a-z0-9-]*$/.test(site.id) || ids.has(site.id)) fail('sites', `invalid or duplicate id ${site.id}`);
    ids.add(site.id);
    const origin = point(site.origin, `${site.id}.origin`);
    const surface = site.surfaceAt === undefined ? ABSOLUTE : integer(site.surfaceAt, `${site.id}.surfaceAt`);
    expand(site.operations, origin, surface, site.id);
    for (const [name, at] of Object.entries(site.anchors || {})) {
      point(at, `${site.id}.${name}`);
      anchors[`${site.id}.${name}`] = { x: origin[0] + at[0], y: origin[1] + at[1], surface };
    }
    if (site.preview) {
      point(site.preview.at, `${site.id}.preview.at`);
      integer(site.preview.zoomSteps, `${site.id}.preview.zoomSteps`, -4, 4);
      if (!Number.isFinite(site.preview.dayPhase) || site.preview.dayPhase < 0 || site.preview.dayPhase > 1) fail(site.id, 'invalid preview day phase');
      scenes.push({ id: site.id, name: site.name, description: site.description, ...site.preview, surface });
    }
  }
  for (const resident of world.residents || []) {
    if (!Object.hasOwn(CREATURE, resident.species)) fail('residents', `unknown creature ${resident.species}`);
    if (!anchors[resident.anchor]) fail('residents', `missing anchor ${resident.anchor}`);
  }
  for (const sign of world.signs || []) {
    if (!anchors[sign.anchor]) fail('signs', `missing anchor ${sign.anchor}`);
    if (sign.offset) point(sign.offset, 'sign.offset');
  }
  const jobs = world.quests.map((job, index) => {
    if (!job.key || world.quests.findIndex(q => q.key === job.key) !== index) fail('quests', `duplicate key ${job.key}`);
    const target = anchors[job.target];
    if (!target) fail(job.key, `missing target ${job.target}`);
    const types = { reach: OBJECTIVE_KIND.SURVEY, passage: OBJECTIVE_KIND.PASSAGE, drain: OBJECTIVE_KIND.DRAIN };
    const type = types[job.condition.kind];
    if (type === undefined) fail(job.key, `unknown condition ${job.condition.kind}`);
    const area = job.condition.bounds || [0, 0, 0, 0];
    bounds(area, `${job.key}.condition.bounds`);
    let prerequisites = 0;
    for (const key of job.after || []) {
      const i = world.quests.findIndex(q => q.key === key);
      if (i < 0 || i >= index) fail(job.key, `prerequisite ${key} must precede this quest`);
      prerequisites |= 1 << i;
    }
    const reward = job.reward;
    let rewardKind = 0, rewardId = 0;
    if (reward?.material) { rewardKind = 1; rewardId = MAT[reward.material]; }
    else if (reward?.item) { rewardKind = 2; rewardId = ITEM_KIND[reward.item]; }
    if (reward && (!rewardKind || rewardId === undefined)) fail(job.key, 'unknown reward');
    return [type, prerequisites, target.x, target.y, target.surface, ...area,
      job.condition.surfaceAt === undefined ? ABSOLUTE : integer(job.condition.surfaceAt, job.key), integer(job.radius ?? 23, job.key, 1, 100),
      rewardKind, rewardId, integer(reward?.count ?? 0, job.key, 0, 10000)];
  });
  if (jobs.length < 1 || jobs.length > 16) fail('quests', 'expected 1…16 quests');
  const width = integer(sprite.width, 'sprite.width', 1, 64), height = integer(sprite.height, 'sprite.height', 1, 64);
  if (!Number.isFinite(sprite.pixelScale) || sprite.pixelScale < .1 || sprite.pixelScale > 2) fail('sprite.pixelScale', 'expected .1…2');
  const symbols = Object.keys(sprite.palette);
  if (symbols.length < 2 || symbols.length > 32 || symbols.some(s => s.length !== 1) || symbols[0] !== '.') fail('sprite.palette', 'expected . transparency and up to 31 single-character colors');
  const palette = symbols.map((key, i) => {
    const hex = sprite.palette[key];
    if (!/^#[0-9a-f]{6}$/i.test(hex)) fail(`sprite.palette.${key}`, 'expected #rrggbb');
    return i === 0 ? 0 : (parseInt(hex.slice(1), 16) | 0xff000000);
  });
  const clips = [], pixels = [];
  let frameCount = 0;
  for (const state of ANIMATION_STATES) {
    const clip = sprite.clips[state];
    if (!clip || !Array.isArray(clip.frames) || clip.frames.length < 1 || clip.frames.length > 16) fail(`sprite.${state}`, 'expected 1…16 frames');
    clips.push(clip.frames.length, integer(clip.ticks, `sprite.${state}.ticks`, 1, 120), frameCount);
    for (const [index, rows] of clip.frames.entries()) {
      if (rows.length !== height || rows.some(row => typeof row !== 'string' || row.length !== width)) fail(`sprite.${state}[${index}]`, `expected ${width}×${height} pixels`);
      for (const row of rows) for (const symbol of row) {
        const value = symbols.indexOf(symbol);
        if (value < 0) fail(`sprite.${state}[${index}]`, `unknown pixel ${symbol}`);
        pixels.push(value);
      }
      frameCount++;
    }
  }
  const hash = contentHash({ world, sprite, creatureArt: creatureSources });
  for (const key of Object.keys(CREATURE)) if (!creatureSources[key]) fail('creatureArt', `missing art for ${key}`);
  const creatures = Object.entries(creatureSources).map(([key, art]) => {
    if (!Object.hasOwn(CREATURE, key)) fail(key, 'unknown creature');
    integer(art.width, key, 1, 64); integer(art.height, key, 1, 64);
    if (!Number.isFinite(art.pixelScale) || art.pixelScale < .1 || art.pixelScale > 2) fail(key, 'invalid pixel scale');
    const symbols = Object.keys(art.palette);
    if (symbols.length < 2 || symbols.length > 32 || symbols.some(s => s.length !== 1) || !['0', '.'].includes(symbols[0])) fail(key, 'expected transparent first symbol and 2…32 single-character colors');
    const colors = symbols.map((symbol, index) => {
      if (!/^#[0-9a-f]{6}$/i.test(art.palette[symbol])) fail(key, 'invalid color');
      return index ? parseInt(art.palette[symbol].slice(1), 16) | 0xff000000 : 0;
    });
    if (art.frames.length !== 4) fail(key, 'expected four creature poses');
    const pixels = art.frames.flatMap(rows => {
      if (rows.length !== art.height || rows.some(row => row.length !== art.width)) fail(key, 'wrong frame dimensions');
      return rows.flatMap(row => [...row].map(symbol => {
        const i = symbols.indexOf(symbol); if (i < 0) fail(key, 'unknown pixel'); return i;
      }));
    });
    return [CREATURE[key], art.width, art.height, Math.round(art.pixelScale * 1000), colors.length, ...colors, ...pixels];
  });
  const textures = Object.entries(world.textures || {}).map(([material, texture]) => {
    if (!Object.hasOwn(MAT, material) || texture.rows?.length !== 8 || texture.rows.some(row => row.length !== 8)) fail(`textures.${material}`, 'expected a known material and 8×8 tile');
    const colors = texture.palette.map(hex => {
      if (!/^#[0-9a-f]{6}$/i.test(hex)) fail(`textures.${material}`, 'invalid color');
      const rgb = parseInt(hex.slice(1), 16);
      return ((rgb & 255) << 16) | (rgb & 0xff00) | (rgb >>> 16);
    });
    return [MAT[material], ...texture.rows.flatMap(row => [...row].map(symbol => {
      if (!/^\d$/.test(symbol) || colors[Number(symbol)] === undefined) fail(`textures.${material}`, 'invalid palette index');
      return colors[Number(symbol)];
    }))];
  });
  if (!Number.isFinite(world.presentation.backgroundTint) || world.presentation.backgroundTint < .1 || world.presentation.backgroundTint > 1) fail('backgroundTint', 'expected .1…1');
  if (world.presentation.fadeTop >= world.presentation.fadeBottom) fail('presentation', 'fadeTop must precede fadeBottom');
  const packed = new Int32Array([0x41535452, CONTENT_VERSION, hash, rects.length, jobs.length,
    width, height, frameCount, palette.length, Math.round(sprite.pixelScale * 1000),
    ...bounds(world.repairBounds, 'repairBounds'), ...point(world.spawn, 'spawn'),
    integer(world.presentation.surfaceLight, 'surfaceLight', 0, 255),
    integer(world.presentation.deepLight, 'deepLight', 0, 255),
    integer(world.presentation.fadeTop, 'fadeTop'), integer(world.presentation.fadeBottom, 'fadeBottom'),
    Math.round(world.presentation.backgroundTint * 1000),
    ...rects.flat(), ...jobs.flat(), ...clips, ...palette, ...pixels, textures.length, ...textures.flat(),
    creatures.length, ...creatures.flat()]);
  return { packed, hash, anchors, scenes, rectangles: rects, world, sprite };
}
