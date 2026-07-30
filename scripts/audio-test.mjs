// Sound architecture contracts: the authoritative engine emits bounded semantic
// records, ambience is sampled independently, and browser spatialization remains
// a pure presentation concern. No AudioContext is needed in Node.

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { CREATIVE_KIND, OFF, SOUND_EVENT, STRIDES } from '../src/sand/wasmBridge/abi.generated.js';
import { MAT } from '../src/sand/materials.js';
import {
  buildTntExplosionBuffer, derivePlayerEffectState,
  semanticEventCooldownMs, spatializeSound,
} from '../src/sand/audio/sandAudio.js';
import {
  AUDIO_ASSET_URLS, TNT_EXPLOSION_LAYERS,
} from '../src/sand/audio/audioAssets.js';
import { makeChecker } from './sand-test-util.mjs';
import { readFile } from 'node:fs/promises';

await initSandWasm();
const { check, done } = makeChecker('semantic audio');
const mk = (storageRole = 'full') => createEngineWasm({
  cols: 96, rows: 72, worldSeed: 0x50a0d, sinksOn: false, infinite: false, storageRole,
});
const O = OFF.soundEvent;

check('ward, breach, explosion, and beam cues have distinct semantic ids',
  Number.isInteger(SOUND_EVENT.SHIELD_HIT)
    && SOUND_EVENT.SHIELD_BREAK === SOUND_EVENT.SHIELD_HIT + 1
    && SOUND_EVENT.SPAWN_BREACH === SOUND_EVENT.SHIELD_BREAK + 1
    && SOUND_EVENT.WEAPON_EXPLOSION === SOUND_EVENT.SPAWN_BREACH + 1
    && SOUND_EVENT.BEAM === SOUND_EVENT.WEAPON_EXPLOSION + 1);
check('weapon detonations bypass the terrain-TNT presentation cooldown',
  semanticEventCooldownMs(SOUND_EVENT.WEAPON_EXPLOSION) === 0
    && semanticEventCooldownMs(SOUND_EVENT.EXPLOSION, 0) === 190
    && semanticEventCooldownMs(SOUND_EVENT.EXPLOSION, 1) === 350);
check('beam cues have an explicit presentation cooldown',
  semanticEventCooldownMs(SOUND_EVENT.BEAM) === 120);

{
  const assets = Object.fromEntries(TNT_EXPLOSION_LAYERS.map((layer, index) => [
    layer.asset,
    {
      numberOfChannels: 1,
      length: 4,
      getChannelData: () => Float32Array.of(index + 1, 0, 0, 0),
    },
  ]));
  const context = {
    sampleRate: 4,
    createBuffer(channels, length) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        getChannelData: (channel) => data[channel],
      };
    },
  };
  const mixed = buildTntExplosionBuffer(context, assets);
  check('the shared TNT effect runtime-mixes all three complete recorded layers',
    TNT_EXPLOSION_LAYERS.length === 3
      && mixed.length === 5
      && mixed.getChannelData(0)[0] === 6);
}

{
  const idle = derivePlayerEffectState({
    id: 1, alive: true, jetpackActive: false, shieldActive: false,
  });
  const active = derivePlayerEffectState({
    id: 1, alive: true, jetpackActive: true, jetpackFuel: 0.5,
    shieldActive: true, shieldHealth: 120,
  });
  const dead = derivePlayerEffectState({
    id: 1, alive: false, jetpackActive: true, jetpackFuel: 0.5,
    shieldActive: true, shieldHealth: 120,
  });
  check('continuous player audio follows authoritative jetpack and ward state',
    !idle.jetpack && !idle.shield && active.jetpack && active.shield);
  check('death silences continuous player effects',
    !dead.jetpack && !dead.shield && dead.id === 0);
}

// Gun layers stay compact, locally bundled, and tied to an auditable CC0 source.
{
  const expected = [
    ['blastGunReport', '826162'],
    ['minigunBurst', '482120'],
    ['weaponAction', '844173'],
  ];
  const provenance = await readFile(
    new URL('../src/sand/audio/assets/README.md', import.meta.url), 'utf8');
  for (const [key, sourceId] of expected) {
    const url = AUDIO_ASSET_URLS[key];
    const bytes = await readFile(new URL(url));
    const mp3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
    check(`${key} is a compact bundled MP3`, mp3 && bytes.length >= 1000 && bytes.length < 16000);
    check(`${key} retains CC0 source provenance`, provenance.includes(sourceId));
  }
}

// A gameplay action creates one packed authority event and draining is destructive.
{
  const e = mk();
  e.setCreativeMaterial(CREATIVE_KIND.CUBE, 0);
  e.pointerDown(48, 24, 0);
  const events = e.drainSoundEvents();
  check('creative placement emits one ABI-sized record', events.length === STRIDES.soundEvent);
  check('placement event has semantic type and world position',
    events[O.type] === SOUND_EVENT.PLACE && events[O.x] === 48 && events[O.y] === 24);
  check('event strength is finite and positive', Number.isFinite(events[O.intensity]) && events[O.intensity] > 0);
  check('draining an event queue is destructive', e.drainSoundEvents().length === 0);
  e.destroy();
}

// Presentation mirrors can execute predicted input without inventing sound.
{
  const e = mk('presentation');
  e.setCreativeMaterial(CREATIVE_KIND.CUBE, 0);
  e.pointerDown(48, 24, 0);
  check('presentation role suppresses gameplay sound events', e.drainSoundEvents().length === 0);
  e.destroy();
}

// Physical contacts and explosive state changes remain semantic engine facts.
{
  const e = mk();
  e.setCreativeMaterial(CREATIVE_KIND.CUBE, 0);
  e.pointerDown(48, 12, 0);
  e.drainSoundEvents(); // placement is covered above
  let impact = false;
  for (let i = 0; i < 180 && !impact; i++) {
    e.step();
    const events = e.drainSoundEvents();
    for (let o = 0; o < events.length; o += STRIDES.soundEvent)
      if (events[o + O.type] === SOUND_EVENT.IMPACT) impact = true;
  }
  check('rigid collision emits an impact event', impact);
  e.destroy();
}

{
  const e = mk();
  e.placeMaterial(48, 40, 0, MAT.TNT);
  e.syncComponents();
  let fuse = false, explosion = false;
  for (let i = 0; i < 100 && !explosion; i++) {
    e.placeMaterial(49, 40, 1, MAT.FIRE);
    e.step();
    const events = e.drainSoundEvents();
    for (let o = 0; o < events.length; o += STRIDES.soundEvent) {
      fuse ||= events[o + O.type] === SOUND_EVENT.FUSE;
      explosion ||= events[o + O.type] === SOUND_EVENT.EXPLOSION;
    }
  }
  check('TNT emits fuse and explosion events', fuse && explosion);
  e.destroy();
}

{
  const e = mk();
  e.placeMaterial(48, 12, 3, MAT.WATER);
  e.step();
  const events = e.drainSoundEvents();
  let falling = false;
  for (let o = 0; o < events.length; o += STRIDES.soundEvent)
    if (events[o + O.type] === SOUND_EVENT.FLUID_FALL && events[o + O.material] === MAT.WATER) falling = true;
  check('downward water movement emits a fluid-fall event', falling);
  e.destroy();
}

{
  const e = mk();
  e.placeMaterial(48, 12, 3, MAT.SAND);
  e.step();
  const events = e.drainSoundEvents();
  let moving = false;
  for (let o = 0; o < events.length; o += STRIDES.soundEvent)
    if (events[o + O.type] === SOUND_EVENT.POWDER_MOVE && events[o + O.material] === MAT.SAND) moving = true;
  check('moving sand emits one regional powder event', moving);
  e.destroy();
}

{
  const e = mk();
  e.addDiscToStoneDraft(48, 12, 2);
  e.finalizeStoneDraft();
  let landed = false;
  for (let i = 0; i < 100 && !landed; i++) {
    e.step();
    const events = e.drainSoundEvents();
    for (let o = 0; o < events.length; o += STRIDES.soundEvent)
      if (events[o + O.type] === SOUND_EVENT.IMPACT
          && events[o + O.material] === MAT.STONE) landed = true;
  }
  check('a newly placed structural body emits a material-tagged impact', landed);
  e.destroy();
}

{
  const e = mk();
  for (let y = 42; y < 70; y++) for (let x = 42; x <= 54; x++)
    e.placeMaterial(x, y, 0, MAT.STONE);
  e.syncComponents();
  let dissolving = false;
  for (let i = 0; i < 320 && !dissolving; i++) {
    e.placeMaterial(48, 40, 2, MAT.ACID);
    e.step();
    const events = e.drainSoundEvents();
    for (let o = 0; o < events.length; o += STRIDES.soundEvent)
      if (events[o + O.type] === SOUND_EVENT.ACID_DISSOLVE) dissolving = true;
  }
  check('acid emits a hiss event only when it dissolves material', dissolving);
  e.destroy();
}

// Continuous sources are measured as four stable groups, not emitted per cell.
{
  const e = mk();
  const groups = [MAT.WATER, MAT.FIRE, MAT.LAVA, MAT.ACID];
  const xs = [25, 41, 57, 73];
  for (let i = 0; i < groups.length; i++) e.paintDiscLayer(0, xs[i], 34, 5, groups[i], true);
  const ambience = e.sampleAmbience(48, 34, 40);
  check('ambience snapshot is four amount/position records', ambience.length === 12);
  for (let i = 0; i < groups.length; i++) {
    const o = i * 3;
    check(`ambience group ${i} is audible and located`,
      ambience[o] > 0 && ambience[o] <= 1 && Number.isFinite(ambience[o + 1]) && Number.isFinite(ambience[o + 2]));
  }
  check('ambience sampling does not enter the event queue', e.drainSoundEvents().length === 0);
  e.destroy();
}

// Spatialization is deterministic and attenuates distance/background layers.
{
  const listener = { x: 100, y: 40, viewWidth: 80 };
  const center = spatializeSound(100, 40, listener, 100, 0);
  const left = spatializeSound(70, 40, listener, 100, 0);
  const far = spatializeSound(250, 40, listener, 100, 0);
  const background = spatializeSound(100, 40, listener, 100, 1);
  check('centered sound is full gain and centered', center.gain === 1 && center.pan === 0);
  check('on-screen left sound pans without losing loudness', left.pan < 0 && left.gain === center.gain);
  check('out-of-range sound is silent', far.gain === 0);
  check('background layer is quieter', background.gain > 0 && background.gain < center.gain);
}

const failures = done();
if (failures) process.exit(1);
