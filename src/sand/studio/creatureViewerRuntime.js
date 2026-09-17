import { initSandWasm, createEngineWasm, MAT, PLANET } from '../wasmBridge/engineFactory.js';
import { CREATURE_ATTACK_STATE as A, OFF, STRIDES } from '../wasmBridge/abi.generated.js';
import schema from '../abi.schema.json';
import creatureArt from '../content/creatureArt.js';
import { CREATURE_ATTACK_ANIMATIONS, creaturePreviewClip } from '../content/creatureAnimations.js';
import { BESTIARY } from '../content/bestiary.js';

export const CREATURE_ROSTER = schema.enums.CreatureSpecies.descriptors.map(def => ({
  ...def, key: def.key.replace('CREATURE_', ''), name: BESTIARY[def.id]?.name || def.name,
}));
export const PREVIEW_MODES = ['idle', 'move', 'windup', 'attack', 'recover', 'hurt', 'death', 'special', 'simulation'];
export const ATTACK_NAMES = Object.fromEntries(Object.entries(CREATURE_ATTACK_ANIMATIONS).map(([key, attacks]) => [key, attacks.map(a => a.name)]));
export function previewClip(key, mode, pattern = 0) {
  return creaturePreviewClip(key, creatureArt[key], mode === 'simulation' ? 'idle' : mode, pattern);
}
export function clipDuration(clip) { return clip.frames.reduce((sum, _, i) => sum + (clip.durations?.[i] || clip.ticks), 0); }
export function clipFrame(clip, tick) {
  let phase = tick % clipDuration(clip), frame = 0;
  while (frame < clip.frames.length - 1 && phase >= (clip.durations?.[frame] || clip.ticks)) {
    phase -= clip.durations?.[frame] || clip.ticks; frame++;
  }
  return frame;
}
export function drawCreatureFrame(ctx, key, frame, x, y, scale, facing = 1) {
  const art = creatureArt[key];
  frame.forEach((row, iy) => [...row].forEach((symbol, ix) => {
    if (symbol === '.' || symbol === '0') return;
    ctx.fillStyle = art.palette[symbol];
    ctx.fillRect(x + (facing < 0 ? art.width - 1 - ix : ix) * scale, y + iy * scale, scale, scale);
  }));
}

export async function createCreatureViewer(canvas, sourceCanvas, initial = {}) {
  await initSandWasm();
  let config = { creature: 'FROST_GIANT', mode: 'move', pattern: 0, facing: 1, travel: true, ...initial };
  let engine, initialSnapshot, tick = 0, paused = false, speed = 1, accumulator = 0, last = 0, raf = 0, disposed = false;
  let definition, art, clip, actorId, startX, startY;
  const ground = 108, o = OFF.creatureSnapshot, ctx = sourceCanvas.getContext('2d');
  function actorData() {
    const data = engine.getCreatureSnapshotData();
    for (let i = 0; i < data.length; i += STRIDES.creatureSnapshot)
      if (data[i + o.id] === actorId) return data.slice(i, i + STRIDES.creatureSnapshot);
    return null;
  }
  function place(values) {
    const data = initialSnapshot.slice();
    for (const [key, value] of Object.entries(values)) data[o[key]] = value;
    engine.setMirrorCreatures(data, 0, 0);
  }
  function pose() {
    engine.syncActorTick(tick);
    const duration = clipDuration(clip), phase = (tick % duration) / duration;
    const values = { facing: config.facing, vx: 0, animFrame: 0, attackState: A.IDLE, attackProgress: 0, attackPattern: config.pattern };
    if (config.mode === 'move') {
      values.vx = config.facing * (definition.stats.walkSpeed || definition.stats.swimSpeed || .15);
      values.animFrame = 1;
      if (config.travel) values.x = startX + config.facing * ((tick * Math.abs(values.vx)) % 42);
    }
    if (config.mode === 'windup') Object.assign(values, { attackState: A.CHARGING, attackProgress: phase });
    if (config.mode === 'attack') Object.assign(values, { attackState: A.FIRING, attackProgress: 1 - phase });
    if (config.mode === 'recover') Object.assign(values, { attackState: A.RECOVERING, attackProgress: phase,
      attackPattern: config.pattern });
    if (config.mode === 'hurt') values.health = definition.stats.maxHealth - (tick % 36 ? 1 : 0);
    if (config.mode === 'death') Object.assign(values, { alive: 0, animFrame: clipFrame(clip, tick) });
    place(values);
  }
  function render() {
    const data = engine.getCreatureSnapshotData().slice();
    engine.glSetCreatures(data); engine.glSetProjectiles(engine.getProjectileSnapshotData().slice());
    engine.glRenderFrame(true);
    const scale = Math.max(1, Math.floor(Math.min((sourceCanvas.width - 60) / art.width, (sourceCanvas.height - 40) / art.height)));
    ctx.fillStyle = '#1d303b'; ctx.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    const x = Math.floor((sourceCanvas.width - art.width * scale) / 2), y = sourceCanvas.height - 20 - art.height * scale;
    ctx.fillStyle = '#55717e'; ctx.fillRect(0, y + art.height * scale, sourceCanvas.width, 1);
    drawCreatureFrame(ctx, config.creature, clip.frames[clipFrame(clip, tick)], x, y, scale, config.facing);
  }
  function reset() {
    engine?.destroy(); engine = null; tick = 0; accumulator = 0;
    definition = CREATURE_ROSTER.find(d => d.key === config.creature);
    art = creatureArt[config.creature]; clip = previewClip(config.creature, config.mode, config.pattern);
    engine = createEngineWasm({ cols: 224, rows: 144, worldSeed: 73, sinksOn: false, planetId: PLANET.FRONTIER });
    engine.setCreatureRuntime(false, false); engine.setSurvivalInventory(true);
    for (let x = 0; x < 224; x++) for (let y = ground; y < 144; y++)
      engine.paintDisc(x, y, 0, y === ground && x % 12 === 0 ? MAT.SANDSTONE : MAT.STONE, true);
    const aquatic = definition.stats.locomotion === 'CL_AQUATIC';
    if (aquatic) for (let x = 0; x < 224; x++) for (let y = 72; y < ground; y++) engine.paintDisc(x, y, 0, MAT.WATER, true);
    if (config.mode === 'simulation' && !(config.creature === 'FROST_GIANT' && config.pattern === 1))
      for (let x = 168; x < 173; x++) for (let y = 80; y < ground; y++) engine.paintDisc(x, y, 0, MAT.STONE, true);
    engine.syncComponents();
    startX = config.facing > 0 ? 76 : 132;
    startY = ground - definition.stats.h - (aquatic || definition.stats.locomotion === 'CL_FLYING' ? 15 : 0);
    actorId = engine.spawnScriptedCreature(definition.id, startX, startY);
    if (actorId < 0) throw new Error(`Could not spawn ${config.creature}`);
    initialSnapshot = engine.getCreatureSnapshotData().slice();
    if (initialSnapshot.length !== STRIDES.creatureSnapshot) throw new Error('Preview needs exactly one creature');
    initialSnapshot[o.facing] = config.facing;
    initialSnapshot[o.aimX] = startX + config.facing * (config.creature === 'FROST_GIANT' && config.pattern === 1 ? 18 : 68);
    initialSnapshot[o.aimY] = ground - 7;
    if (config.mode === 'simulation') {
      engine.spawnPlayer(startX + config.facing * 48, ground - 8);
      place({ facing: config.facing, attackState: A.CHARGING, attackProgress: 0, attackPattern: config.pattern });
      engine.setCreatureRuntime(true, false);
    } else pose();
    if (!engine.glInit(canvas)) throw new Error('WebGL2 is required for the creature viewer');
    engine.glResize(canvas.width, canvas.height);
    const cell = Math.min(12, Math.max(6, Math.floor(300 / (art.height * art.pixelScale))));
    const cols = canvas.width / cell, rows = canvas.height / cell;
    engine.setViewport(1, cell, Math.ceil(cols), Math.ceil(rows));
    engine.cameraSet(112 - cols / 2, ground + 8 - rows); engine.glSetFlags(false, false, true); engine.setSkyLight(220);
    render();
  }
  function advance() {
    tick++;
    if (config.mode === 'simulation') {
      engine.stepActors(); engine.stepWorld();
      if (tick >= 240) reset();
    } else pose();
  }
  function frame(now) {
    if (disposed) return;
    accumulator += Math.min(100, now - (last || now)) * speed; last = now;
    if (!paused) {
      let changed = false;
      while (accumulator >= 1000 / 60) { accumulator -= 1000 / 60; advance(); changed = true; }
      if (changed) render();
    } else accumulator = 0;
    raf = requestAnimationFrame(frame);
  }
  const api = {
    select(next) {
      const candidate = { ...config, ...next };
      if (!CREATURE_ROSTER.some(d => d.key === candidate.creature)) throw new Error('Unknown creature');
      if (!PREVIEW_MODES.includes(candidate.mode)) throw new Error('Unknown preview mode');
      candidate.pattern = Math.max(0, Math.min(2, Math.floor(Number(candidate.pattern) || 0)));
      candidate.facing = candidate.facing < 0 ? -1 : 1;
      config = candidate; reset(); return api.inspect();
    },
    pause() { paused = true; },
    play() { paused = false; last = 0; accumulator = 0; },
    setSpeed(value) { if ([.25, .5, 1, 2].includes(value)) speed = value; },
    restart() { reset(); },
    step(count = 1) { paused = true; for (let i = 0; i < Math.min(600, Math.max(1, count)); i++) advance(); render(); return api.inspect(); },
    seekFrame(index) {
      paused = true;
      const target = Math.max(0, Math.min(clip.frames.length - 1, Math.floor(index)));
      if (config.mode === 'simulation') return;
      const targetTick = clip.frames.slice(0, target).reduce((sum, _, i) => sum + (clip.durations?.[i] || clip.ticks), 0);
      reset();
      for (let i = 0; i < targetTick; i++) { advance(); render(); }
    },
    inspect() {
      const data = actorData();
      return { ...config, tick, paused, speed, frame: clipFrame(clip, tick), frames: clip.frames.length,
        dimensions: [art.width, art.height], contexts: engine.sharedGlContextCount(),
        actor: data ? Object.fromEntries(Object.entries(o).map(([key, offset]) => [key, data[offset]])) : null,
        projectiles: engine.getProjectiles().map(p => ({ kind: p.kind, x: p.x, y: p.y })) };
    },
    dispose() { disposed = true; cancelAnimationFrame(raf); engine?.destroy(); engine = null; },
  };
  try { api.select(initial); raf = requestAnimationFrame(frame); }
  catch (error) { api.dispose(); throw error; }
  return api;
}
