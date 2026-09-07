// The same content compiler runs in Node, the browser, and the authority worker.
import { MAT } from '../materials.js';
import { CREATURE, ITEM_KIND, OBJECTIVE_KIND, PLAYER_ANIMATION } from '../wasmBridge/abi.generated.js';
import creatureArt from './creatureArt.js';
import { EQUIPMENT } from './equipment.js';

export const CONTENT_VERSION = 3;
export const ABSOLUTE = -2147483648;
export const ANIMATION_STATES = Object.keys(PLAYER_ANIMATION).filter(key => key !== 'COUNT').map(key => key.toLowerCase());
export const CREATURE_CLIPS = ['idle', 'move', 'windup', 'attack', 'recover', 'hurt', 'death', 'special'];
export const MAX_CLIP_FRAMES = 32;
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
  const residents = (world.residents || []).map(resident => {
    if (!Object.hasOwn(CREATURE, resident.species)) fail('residents', `unknown creature ${resident.species}`);
    if (!anchors[resident.anchor]) fail('residents', `missing anchor ${resident.anchor}`);
    const at = anchors[resident.anchor];
    return [integer(resident.id, 'resident.id', 1, 64), CREATURE[resident.species], at.x, at.y, at.surface,
      integer(resident.roamRadius ?? 0, 'resident.roamRadius', 0, 48)];
  });
  if (residents.length > 64) fail('residents', 'at most 64 residents');
  for (const sign of world.signs || []) {
    if (!anchors[sign.anchor]) fail('signs', `missing anchor ${sign.anchor}`);
    if (sign.offset) point(sign.offset, 'sign.offset');
  }
  const jobs = world.quests.map((job, index) => {
    if (!job.key || world.quests.findIndex(q => q.key === job.key) !== index) fail('quests', `duplicate key ${job.key}`);
    const target = anchors[job.target];
    if (!target) fail(job.key, `missing target ${job.target}`);
    const types = { reach: OBJECTIVE_KIND.SURVEY, passage: OBJECTIVE_KIND.PASSAGE, drain: OBJECTIVE_KIND.DRAIN, build: OBJECTIVE_KIND.BUILD, deliver: OBJECTIVE_KIND.DELIVER, defeat: OBJECTIVE_KIND.DEFEAT };
    const type = types[job.condition.kind];
    if (type === undefined) fail(job.key, `unknown condition ${job.condition.kind}`);
    const area = job.condition.bounds || [0, 0, 0, 0];
    bounds(area, `${job.key}.condition.bounds`);
    const prerequisites = [];
    for (const key of job.after || []) {
      const i = world.quests.findIndex(q => q.key === key);
      if (i < 0 || i >= index) fail(job.key, `prerequisite ${key} must precede this quest`);
      if (prerequisites.includes(i)) fail(job.key, `duplicate prerequisite ${key}`);
      prerequisites.push(i);
    }
    let material = 0, species = 0, count = 1;
    if (['build', 'deliver'].includes(job.condition.kind)) {
      material = MAT[job.condition.material];
      if (material === undefined || material === MAT.EMPTY) fail(job.key, 'expected condition material');
    }
    if (job.condition.kind === 'build') {
      if (!job.condition.bounds || area[2] - area[0] > 128 || area[3] - area[1] > 64)
        fail(job.key, 'build needs a bounded construction area');
      count = area[2] - area[0] + 1;
    }
    if (job.condition.kind === 'deliver') count = integer(job.condition.count, job.key, 1, 10000);
    if (job.condition.kind === 'defeat') {
      species = CREATURE[job.condition.species];
      if (species === undefined) fail(job.key, 'unknown encounter species');
    }
    const reward = job.reward;
    let rewardKind = 0, rewardId = 0;
    if (reward?.material) { rewardKind = 1; rewardId = MAT[reward.material]; }
    else if (reward?.gear) { rewardKind = 3; rewardId = reward.gear; if (!EQUIPMENT.some(g => g.id === rewardId)) fail(job.key, 'unknown gear'); }
    else if (reward?.item) { rewardKind = 2; rewardId = ITEM_KIND[reward.item]; }
    if (reward && (!rewardKind || rewardId === undefined)) fail(job.key, 'unknown reward');
    return [type, prerequisites.length, target.x, target.y, target.surface, ...area,
      job.condition.surfaceAt === undefined ? ABSOLUTE : integer(job.condition.surfaceAt, job.key), integer(job.radius ?? 23, job.key, 1, 100),
      rewardKind, rewardId, integer(reward?.count ?? 0, job.key, 0, 10000), material, count, species, integer(job.giver || 0, 'quest.giver', 0, 64), ...prerequisites];
  });
  for (const [speaker, dialogue] of Object.entries(world.dialogue || {})) {
    if (!Object.hasOwn(CREATURE, speaker)) fail('dialogue', `unknown speaker ${speaker}`);
    for (const variant of dialogue.variants || []) {
      if (!world.quests.some(q => q.key === variant.quest)) fail(speaker, `unknown dialogue quest ${variant.quest}`);
      if (!['locked', 'active', 'complete'].includes(variant.state) || typeof variant.text !== 'string') fail(speaker, 'invalid dialogue variant');
    }
  }
  if (jobs.length < 1 || jobs.length > 128) fail('quests', 'expected 1…128 quests');
  const width = integer(sprite.width, 'sprite.width', 1, 64), height = integer(sprite.height, 'sprite.height', 1, 64);
  if (!Number.isFinite(sprite.pixelScale) || sprite.pixelScale < .1 || sprite.pixelScale > 2) fail('sprite.pixelScale', 'expected .1…2');
  const symbols = Object.keys(sprite.palette);
  if (symbols.length < 2 || symbols.length > 32 || symbols.some(s => s.length !== 1) || symbols[0] !== '.') fail('sprite.palette', 'expected . transparency and up to 31 single-character colors');
  const palette = symbols.map((key, i) => {
    const hex = sprite.palette[key];
    if (!/^#[0-9a-f]{6}$/i.test(hex)) fail(`sprite.palette.${key}`, 'expected #rrggbb');
    return i === 0 ? 0 : (parseInt(hex.slice(1), 16) | 0xff000000);
  });
  const limbColors = ['outline', 'sleeve', 'skin', 'hand'].map(role => {
    const index = symbols.indexOf(sprite.limbs?.[role]);
    if (index < 1) fail(`sprite.limbs.${role}`, 'expected an opaque palette symbol');
    return index;
  });
  const clips = [], pixels = [];
  let frameCount = 0;
  for (const state of ANIMATION_STATES) {
    const clip = sprite.clips[state] || (PLAYER_ANIMATION[state.toUpperCase()] >= 7 ? sprite.clips.idle : null);
    if (!clip || !Array.isArray(clip.frames) || clip.frames.length < 1 || clip.frames.length > MAX_CLIP_FRAMES) fail(`sprite.${state}`, 'expected 1…32 frames');
    const durations = clip.durations || clip.frames.map(() => clip.ticks);
    if (durations.length !== clip.frames.length) fail(`sprite.${state}`, 'duration count must match frames');
    clips.push(clip.frames.length, frameCount, ...durations.map(t => integer(t, `sprite.${state}.duration`, 1, 120)));
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
  const hash = contentHash({ world, sprite, creatureArt: creatureSources, equipment: EQUIPMENT });
  for (const key of Object.keys(CREATURE)) if (!creatureSources[key]) fail('creatureArt', `missing art for ${key}`);
  const creatures = Object.entries(creatureSources).map(([key, art]) => {
    if (!Object.hasOwn(CREATURE, key)) fail(key, 'unknown creature');
    integer(art.width, key, 1, 128); integer(art.height, key, 1, 128);
    if (!Number.isFinite(art.pixelScale) || art.pixelScale < .1 || art.pixelScale > 2) fail(key, 'invalid pixel scale');
    const symbols = Object.keys(art.palette);
    if (symbols.length < 2 || symbols.length > 32 || symbols.some(s => s.length !== 1) || !['0', '.'].includes(symbols[0])) fail(key, 'expected transparent first symbol and 2…32 single-character colors');
    const colors = symbols.map((symbol, index) => {
      if (!/^#[0-9a-f]{6}$/i.test(art.palette[symbol])) fail(key, 'invalid color');
      return index ? parseInt(art.palette[symbol].slice(1), 16) | 0xff000000 : 0;
    });
    const clipRecords = [], pixels = [];
    let frameOffset = 0;
    for (const state of CREATURE_CLIPS) {
      const clip = art.clips?.[state] || art.clips?.idle || { frames: art.frames, ticks: 9 };
      if (!Array.isArray(clip.frames) || clip.frames.length < 1 || clip.frames.length > MAX_CLIP_FRAMES)
        fail(`${key}.${state}`, 'expected 1…32 frames');
      const durations = clip.durations || clip.frames.map(() => clip.ticks);
      if (durations.length !== clip.frames.length) fail(`${key}.${state}`, 'duration count must match frames');
      clipRecords.push(clip.frames.length, frameOffset,
        ...durations.map(t => integer(t, `${key}.${state}.duration`, 1, 120)));
      for (const rows of clip.frames) {
        if (rows.length !== art.height || rows.some(row => typeof row !== 'string' || row.length !== art.width)) fail(key, 'wrong frame dimensions');
        for (const row of rows) for (const symbol of row) {
          const index = symbols.indexOf(symbol);
          if (index < 0) fail(key, 'unknown pixel');
          pixels.push(index);
        }
      }
      frameOffset += clip.frames.length;
    }
    return [CREATURE[key], art.width, art.height, Math.round(art.pixelScale * 1000), colors.length,
      frameOffset, ...clipRecords, ...colors, ...pixels];
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
  const chestIds = new Set();
  const chests = (world.chests || []).map(chest => {
    integer(chest.id, 'chest.id', 1, 100000);
    if (chestIds.has(chest.id)) fail('chests', 'duplicate identity');
    chestIds.add(chest.id);
    const anchor = anchors[chest.anchor]; if (!anchor) fail('chests', 'unknown anchor');
    const offset = point(chest.offset || [0, 0], 'chest.offset');
    if (!Array.isArray(chest.loot) || chest.loot.length > 24) fail('chests', 'at most 24 stacks');
    const loot = chest.loot.flatMap(item => {
      const kind = item.gear ? ITEM_KIND.GEAR : item.material ? ITEM_KIND.MATERIAL : ITEM_KIND[item.item];
      const value = item.gear || (item.material ? MAT[item.material] : 0);
      if (kind === undefined || value === undefined || (item.gear && !EQUIPMENT.some(g => g.id === item.gear))) fail('chests', 'unknown item');
      return [kind, value, integer(item.count, 'chest.count', 1, 999)];
    });
    return [chest.id, anchor.x + offset[0], anchor.y + offset[1], anchor.surface, chest.loot.length, ...loot];
  });
  if (chests.length > 512) fail('chests', 'too many chests');
  const packed = new Int32Array([0x41535452, CONTENT_VERSION, hash, rects.length, jobs.length,
    width, height, frameCount, palette.length, Math.round(sprite.pixelScale * 1000),
    ...bounds(world.repairBounds, 'repairBounds'), ...point(world.spawn, 'spawn'),
    integer(world.presentation.surfaceLight, 'surfaceLight', 0, 255),
    integer(world.presentation.deepLight, 'deepLight', 0, 255),
    integer(world.presentation.fadeTop, 'fadeTop'), integer(world.presentation.fadeBottom, 'fadeBottom'),
    Math.round(world.presentation.backgroundTint * 1000),
    ...rects.flat(), ...jobs.flat(), ...clips, ...palette, ...pixels, textures.length, ...textures.flat(),
    creatures.length, ...creatures.flat(), residents.length, ...residents.flat(), ...limbColors, EQUIPMENT.length,
    ...EQUIPMENT.flatMap(g => [g.id, g.family, g.slot, g.power, g.defense, g.stamina, g.mana, g.cooldown, g.reach, g.spell, g.style, g.price]), chests.length, ...chests.flat()]);
  return { packed, hash, anchors, scenes, rectangles: rects, world, sprite };
}
