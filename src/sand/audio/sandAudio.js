// Browser sound renderer for the sand engine.
//
// C++ reports semantic events and local ambience measurements; this module is
// the only place that knows about Web Audio, samples, synthesis, panning, mixing, voice
// limits, browser activation, mute persistence, or document visibility.

import { OFF, SOUND_EVENT, STRIDES } from '../wasmBridge/abi.generated.js';
import { KIND, MATERIAL_BY_ID, MAT } from '../materials.js';
import {
  AMBIENCE_GROUP_MIXER, AMBIENCE_SAMPLE_FIELD, AMBIENCE_SAMPLE_STRIDE,
} from '../materials.generated.js';
import { loadAudioAssets, TNT_EXPLOSION_LAYERS } from './audioAssets.js';
import { creatureSoundSpec, creatureSoundPhase } from './creatureVoices.js';
import { createMusicDirector, scoreThreat } from './musicDirector.js';

const STORAGE_KEY = 'sand-audio-muted';
export function buildAmbienceVoiceSpecs(groups = AMBIENCE_GROUP_MIXER) {
  if (!Array.isArray(groups)) throw new TypeError('ambience mixer must be an array');
  const noiseKinds = new Set(['white', 'brown', 'crackle']);
  const filterTypes = new Set(['lowpass', 'bandpass', 'highpass']);
  return groups.map((group, id) => {
    if (group?.id !== id || !Number.isFinite(group.gain) || group.gain < 0
        || !noiseKinds.has(group.noise) || !filterTypes.has(group.filterType)
        || !Number.isFinite(group.frequency) || group.frequency <= 0
        || !Number.isFinite(group.q) || group.q < 0) {
      throw new TypeError(`invalid ambience mixer group ${id}`);
    }
    return Object.freeze({ ...group });
  });
}
const AMBIENCE_VOICE_SPECS = buildAmbienceVoiceSpecs();
const EVENT_DISTANCE = Object.freeze({
  [SOUND_EVENT.BELL]: 260,
  [SOUND_EVENT.RUNE]: 80,
  [SOUND_EVENT.SWING]: 60,
  [SOUND_EVENT.GUARD]: 90,
  [SOUND_EVENT.MELEE_HIT]: 95,
  [SOUND_EVENT.HEAVY_IMPACT]: 160,
  [SOUND_EVENT.SPELL_IMPACT]: 180,
  [SOUND_EVENT.SHOCKWAVE]: 240,
  [SOUND_EVENT.EXPLOSION]: 190,
  [SOUND_EVENT.FUSE]: 95,
  [SOUND_EVENT.IMPACT]: 90,
  [SOUND_EVENT.JUMP]: 65,
  [SOUND_EVENT.LAND]: 70,
  [SOUND_EVENT.PLACE]: 60,
  [SOUND_EVENT.BREAK]: 70,
  [SOUND_EVENT.PICKUP]: 55,
  [SOUND_EVENT.HURT]: 80,
  [SOUND_EVENT.CREATURE]: 70,
  [SOUND_EVENT.FLUID_FALL]: 130,
  [SOUND_EVENT.POWDER_MOVE]: 115,
  [SOUND_EVENT.SOLID_LAND]: 100,
  [SOUND_EVENT.ACID_DISSOLVE]: 120,
  [SOUND_EVENT.CRAFT]: 60,
  [SOUND_EVENT.BOW]: 80,
  [SOUND_EVENT.ARROW_HIT]: 95,
  [SOUND_EVENT.DEATH]: 100,
  [SOUND_EVENT.RESPAWN]: 80,
  [SOUND_EVENT.BLAST_GUN]: 150,
  [SOUND_EVENT.BORE_CHARGE]: 260,
  [SOUND_EVENT.BORE_FIRE]: 360,
  [SOUND_EVENT.ACID_MORTAR]: 155,
  [SOUND_EVENT.CLUSTER_LAUNCH]: 175,
  [SOUND_EVENT.MINIGUN]: 205,
  [SOUND_EVENT.SHIELD_HIT]: 110,
  [SOUND_EVENT.SHIELD_BREAK]: 155,
  [SOUND_EVENT.SPAWN_BREACH]: 220,
  [SOUND_EVENT.WEAPON_EXPLOSION]: 190,
  [SOUND_EVENT.BEAM]: 180,
});
const EVENT_COOLDOWN_MS = Object.freeze({
  [SOUND_EVENT.EXPLOSION]: 85,
  [SOUND_EVENT.FUSE]: 70,
  [SOUND_EVENT.IMPACT]: 48,
  [SOUND_EVENT.JUMP]: 55,
  [SOUND_EVENT.LAND]: 55,
  [SOUND_EVENT.PLACE]: 42,
  [SOUND_EVENT.BREAK]: 45,
  [SOUND_EVENT.PICKUP]: 35,
  [SOUND_EVENT.HURT]: 90,
  [SOUND_EVENT.CREATURE]: 65,
  [SOUND_EVENT.FLUID_FALL]: 90,
  [SOUND_EVENT.POWDER_MOVE]: 80,
  [SOUND_EVENT.SOLID_LAND]: 72,
  [SOUND_EVENT.ACID_DISSOLVE]: 115,
  [SOUND_EVENT.CRAFT]: 55,
  [SOUND_EVENT.BOW]: 45,
  [SOUND_EVENT.ARROW_HIT]: 40,
  [SOUND_EVENT.DEATH]: 250,
  [SOUND_EVENT.RESPAWN]: 150,
  [SOUND_EVENT.BLAST_GUN]: 55,
  [SOUND_EVENT.BORE_CHARGE]: 320,
  [SOUND_EVENT.BORE_FIRE]: 260,
  [SOUND_EVENT.ACID_MORTAR]: 85,
  [SOUND_EVENT.CLUSTER_LAUNCH]: 90,
  [SOUND_EVENT.MINIGUN]: 28,
  [SOUND_EVENT.SHIELD_HIT]: 38,
  [SOUND_EVENT.SHIELD_BREAK]: 240,
  [SOUND_EVENT.SPAWN_BREACH]: 700,
  [SOUND_EVENT.BEAM]: 120,
  [SOUND_EVENT.MELEE_HIT]: 35,
  [SOUND_EVENT.HEAVY_IMPACT]: 55,
  [SOUND_EVENT.SHOCKWAVE]: 200,
});

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

const SAMPLE_FAMILIES = Object.freeze({
  stone: ['stone1', 'stone2', 'stone3'],
  wood: ['wood1', 'wood2', 'wood3'],
  metal: ['metal1', 'metal2', 'metal3'],
  glass: ['glass1', 'glass2', 'glass3'],
  hit: ['hit1', 'hit2', 'hit3'],
  step: ['step1', 'step2', 'step3'],
  soil: ['soil1', 'soil2', 'soil3'],
  swish: ['swish1', 'swish2', 'swish3'],
  cloth: ['cloth1', 'cloth2', 'cloth3'],
  splash: ['splash1', 'splash2', 'splash3'],
  pickup: ['pickup1', 'pickup2'],
});

const COMBAT_EVENTS = new Set([
  SOUND_EVENT.SWING, SOUND_EVENT.BOW, SOUND_EVENT.MELEE_HIT, SOUND_EVENT.RUNE,
  SOUND_EVENT.HEAVY_IMPACT, SOUND_EVENT.SPELL_IMPACT, SOUND_EVENT.SHOCKWAVE,
  SOUND_EVENT.HURT, SOUND_EVENT.BLAST_GUN, SOUND_EVENT.BORE_CHARGE,
  SOUND_EVENT.BORE_FIRE, SOUND_EVENT.ACID_MORTAR, SOUND_EVENT.CLUSTER_LAUNCH,
  SOUND_EVENT.MINIGUN, SOUND_EVENT.SHIELD_HIT, SOUND_EVENT.SHIELD_BREAK,
  SOUND_EVENT.SPAWN_BREACH,
]);

export function materialSoundFamily(material) {
  const spec = MATERIAL_BY_ID[material];
  if ([MAT.ICE, MAT.GLASS, MAT.CRYSTAL, MAT.LIGHT].includes(material)) return 'glass';
  if (spec?.kind === KIND.LIQUID) return 'splash';
  if (spec?.kind === KIND.POWDER) return 'soil';
  if (/WOOD|LEAF|SEED|PLANT|VINE|CACTUS|MUSH|BRAMBLE|REED|FROND/.test(spec?.name || '')) return 'wood';
  if (material === MAT.RIGID) return 'stone';
  return 'stone';
}

export function sandMediaMetadata() {
  return {
    title: 'Falling Sand',
    artist: 'Nicholas Mayer-Rupert',
    album: 'Interactive Sand Engine',
    artwork: [{
      src: '/sand-media-artwork.png',
      sizes: '512x512',
      type: 'image/png',
    }],
  };
}

function updateMediaSessionMetadata() {
  if (typeof navigator === 'undefined' || !navigator.mediaSession
      || typeof MediaMetadata === 'undefined') return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata(sandMediaMetadata());
  } catch { /* Media Session is optional browser chrome. */ }
}

export function semanticEventCooldownMs(type, continuousPlace = false) {
  // Projectile detonations are already discrete authority events. Unlike a TNT
  // chain or a dense brush, suppressing any one of them loses gameplay feedback.
  if (type === SOUND_EVENT.WEAPON_EXPLOSION || type === SOUND_EVENT.SPELL_IMPACT) return 0;
  return continuousPlace ? 125 : (EVENT_COOLDOWN_MS[type] ?? 45);
}

export function createTerrainExplosionGate() {
  let recent = [];
  return (x, y, now) => {
    recent = recent.filter((blast) => now - blast.at < EVENT_COOLDOWN_MS[SOUND_EVENT.EXPLOSION]);
    if (recent.some((blast) => Math.hypot(x - blast.x, y - blast.y) < 18)) return false;
    recent.push({ x, y, at: now });
    return true;
  };
}

export function derivePlayerEffectState(player) {
  const alive = !!player && player.alive !== false;
  return {
    id: alive ? (player.id | 0) : 0,
    jetpack: alive && !!player.jetpackActive && (player.jetpackFuel ?? 1) > 0,
    shield: alive && !!player.shieldActive && (player.shieldHealth ?? 1) > 0,
  };
}

export function spatializeSound(eventX, eventY, listener, maxDistance, layer = 0) {
  const dx = eventX - listener.x;
  const dy = eventY - listener.y;
  const distance = Math.hypot(dx, dy);
  // Loudness stays nearly constant across the visible view; stereo placement,
  // not volume loss, tells the listener whether a sound is left or right.
  const viewWidth = listener.viewWidth || 80;
  const fullGainRadius = Math.max(20, viewWidth * 0.55);
  const fadeEdge = Math.max(maxDistance, fullGainRadius + maxDistance * 0.6);
  const fade = clamp((distance - fullGainRadius) / Math.max(1, fadeEdge - fullGainRadius));
  const distanceGain = 1 - fade * fade;
  const panWidth = Math.max(20, viewWidth * 0.46);
  return {
    gain: distanceGain * distanceGain * (layer ? 0.58 : 1),
    pan: clamp(dx / panWidth, -1, 1),
    distance,
  };
}

export function buildTntExplosionBuffer(context, assets) {
  const layers = TNT_EXPLOSION_LAYERS.map((layer) => ({
    ...layer, buffer: assets[layer.asset],
  }));
  if (layers.some((layer) => !layer.buffer)) return null;
  const channels = Math.max(...layers.map((layer) => layer.buffer.numberOfChannels));
  const length = Math.max(...layers.map((layer) =>
    Math.ceil(layer.buffer.length / layer.rate) + Math.round(layer.delay * context.sampleRate)));
  const mixed = context.createBuffer(channels, length, context.sampleRate);
  for (const layer of layers) {
    for (let channel = 0; channel < channels; channel++) {
      const input = layer.buffer.getChannelData(
        Math.min(channel, layer.buffer.numberOfChannels - 1),
      );
      const output = mixed.getChannelData(channel);
      const layerLength = Math.ceil(input.length / layer.rate);
      const offset = Math.round(layer.delay * context.sampleRate);
      const decayStep = Math.exp(-1 / (context.sampleRate * layer.decay));
      const fadeLength = context.sampleRate * .04;
      const fadeStart = layerLength - 1 - fadeLength;
      const inverseFadeLength = 1 / fadeLength;
      let envelope = layer.gain;
      for (let i = 0; i < layerLength; i++) {
        const sourceIndex = i * layer.rate;
        const lo = Math.floor(sourceIndex);
        const mix = sourceIndex - lo;
        const hi = Math.min(input.length - 1, lo + 1);
        const fade = i <= fadeStart ? 1 : (layerLength - 1 - i) * inverseFadeLength;
        output[i + offset] += (input[lo] + (input[hi] - input[lo]) * mix)
          * envelope * fade;
        envelope *= decayStep;
      }
    }
  }
  // Normalize the complete effect once, retaining its transient and leaving
  // headroom for overlapping detonations in the master compressor.
  let peak = 0;
  for (let channel = 0; channel < channels; channel++) {
    const output = mixed.getChannelData(channel);
    for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(output[i]));
  }
  if (peak > 0) {
    const gain = 0.9 / peak;
    for (let channel = 0; channel < channels; channel++) {
      const output = mixed.getChannelData(channel);
      for (let i = 0; i < length; i++) output[i] *= gain;
    }
  }
  return mixed;
}

export function explosionVoiceSpec(strength, spatial, variation = 0.5) {
  const size = clamp((strength - 0.4) / 3.6);
  return {
    gain: Math.min(1.15, Math.sqrt(clamp(strength, 0.08, 4)) * 0.8) * spatial.gain,
    rate: 1.03 - size * 0.20 + (variation - 0.5) * 0.10,
    frequency: 3200 + 11000 * Math.exp(-spatial.distance / 180),
    pan: spatial.pan * 0.88,
  };
}

function readStoredMuted() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; }
  catch { return false; }
}

function writeStoredMuted(muted) {
  try { localStorage.setItem(STORAGE_KEY, muted ? '1' : '0'); }
  catch { /* storage may be unavailable in third-party/private embeds */ }
}

export function createSandAudio({ expeditionScore = false } = {}) {
  let context = null;
  let unlocked = false;
  let master = null;
  let effectsBus = null;
  let ambienceBus = null;
  let enabled = true;
  let muted = readStoredMuted();
  let hidden = typeof document !== 'undefined' && document.hidden;
  let destroyed = false;
  let activeVoices = 0, activeCreatureVoices = 0;
  let noiseBuffer = null;
  let brownBuffer = null;
  let musicBus = null;
  let musicDirector = null;
  let scorePaused = false;
  let scorePlayer = null;
  let assetsReady = Promise.resolve();
  let ambienceVoices = null;
  let recordedAssets = null;
  let movementVoices = null;
  const lastVariant = new Map();
  let playerEffects = { id: 0, jetpack: false, shield: false };
  const lastEventAt = new Map();
  const lastRecordedWeaponAt = new Map();
  const admitTerrainExplosion = createTerrainExplosionGate();
  const explosionVoices = [];
  const mobileVoiceBudget = typeof navigator !== 'undefined'
    && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const MAX_VOICES = mobileVoiceBudget ? 16 : 28;

  const audible = () => unlocked && enabled && !muted && !hidden && !destroyed;

  const makeNoise = (seconds, kind) => {
    const length = Math.ceil(context.sampleRate * seconds);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const out = buffer.getChannelData(0);
    let seed = kind === 'brown' ? 0x51f15e : 0x7f4a7c;
    let brown = 0;
    for (let i = 0; i < length; i++) {
      seed = Math.imul(seed ^ (seed >>> 15), 2246822519) >>> 0;
      const white = ((seed / 4294967296) * 2 - 1);
      if (kind === 'brown') {
        brown = clamp((brown + white * 0.055) / 1.045, -1, 1);
        out[i] = brown * 2.4;
      } else out[i] = white;
    }
    return buffer;
  };

  const createPanner = (pan = 0) => {
    if (!context.createStereoPanner) return null;
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    return panner;
  };

  const connectSpatial = (node, destination, pan) => {
    const panner = createPanner(pan);
    if (panner) { node.connect(panner); panner.connect(destination); }
    else node.connect(destination);
    return panner;
  };

  const createAmbienceVoice = (spec) => {
    const asset = { water: 'waterFlow', fire: 'fireLoop', lava: 'bubbleLoop', acid: 'bubbleLoop' }[spec.name];
    if (!recordedAssets?.[asset] || !spec.gain) return null;
    const voice = createMovementVoice(recordedAssets[asset], {
      frequency: spec.name === 'fire' ? 6500 : 3000, destination: ambienceBus,
    });
    return { ...voice, volume: spec.gain };
  };

  const createMovementVoice = (buffer, {
    filterType = 'lowpass', frequency = 7000, q = 0.2, rate = 1, destination = effectsBus,
  } = {}) => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = rate;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = context.createGain();
    gain.gain.value = 0.0001;
    source.connect(filter); filter.connect(gain);
    const panner = connectSpatial(gain, destination, 0);
    source.start();
    return { source, gain, panner, baseRate: rate };
  };

  const holdMovementVoice = (name, strength, spatial, {
    volume, rate = 1, hold = 0.32, attack = 0.08, release = 0.24,
  }) => {
    const voice = movementVoices?.[name];
    if (!voice || !audible()) return;
    const now = context.currentTime;
    const target = Math.min(0.22, clamp(strength, 0.04, 2.5) * spatial.gain * volume);
    if (voice.gain.gain.cancelAndHoldAtTime) voice.gain.gain.cancelAndHoldAtTime(now);
    else {
      const current = Math.max(0.0001, voice.gain.gain.value);
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(current, now);
    }
    voice.gain.gain.setTargetAtTime(Math.max(0.0002, target), now, attack);
    voice.gain.gain.setTargetAtTime(0.0001, now + hold, release);
    voice.source.playbackRate.setTargetAtTime(voice.baseRate * rate, now, 0.12);
    if (voice.panner) voice.panner.pan.setTargetAtTime(spatial.pan, now, 0.1);
  };

  const setMovementVoice = (name, strength, {
    volume, rate = 1, attack = 0.06, release = 0.12, pan = 0,
  }) => {
    const voice = movementVoices?.[name];
    if (!voice || !context) return;
    const now = context.currentTime;
    const target = audible()
      ? Math.min(0.22, clamp(strength, 0, 2.5) * volume)
      : 0.0001;
    const current = Math.max(0.0001, voice.gain.gain.value);
    if (voice.gain.gain.cancelAndHoldAtTime) voice.gain.gain.cancelAndHoldAtTime(now);
    else {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(current, now);
    }
    voice.gain.gain.setTargetAtTime(Math.max(0.0001, target), now,
      target > current ? attack : release);
    voice.source.playbackRate.setTargetAtTime(voice.baseRate * rate, now, 0.08);
    if (voice.panner) voice.panner.pan.setTargetAtTime(pan, now, 0.08);
  };

  const createContext = () => {
    if (typeof window === 'undefined') return null;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    // Older WebKit builds expose AudioContext but reject constructor options.
    // Fall back to the optionless form for those iOS Safari/Chrome contexts.
    try { return new AudioContext({ latencyHint: 'interactive' }); }
    catch { return new AudioContext(); }
  };

  // Build the silent mixer and decode its recordings during loading. The master
  // output stays closed until unlock; browsers may defer device startup too.
  const prepare = () => {
    if (context || destroyed || !enabled || muted || hidden) return;
    try { init(); } catch {
      const failed = context;
      context = master = effectsBus = ambienceBus = ambienceVoices = movementVoices = recordedAssets = null;
      musicDirector?.destroy();
      musicBus = musicDirector = noiseBuffer = brownBuffer = null;
      try { failed?.close(); } catch { /* gesture will retry with a new context */ }
    }
  };

  const init = () => {
    if (context || destroyed) return context;
    context = createContext();
    if (!context) return null;
    master = context.createGain();
    master.gain.value = 0;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.22;
    effectsBus = context.createGain();
    ambienceBus = context.createGain();
    effectsBus.gain.value = 0.82;
    ambienceBus.gain.value = 0.6;
    musicBus = context.createGain();
    musicBus.gain.value = 0.42;
    effectsBus.connect(master); ambienceBus.connect(master); musicBus.connect(master);
    if (expeditionScore) musicDirector = createMusicDirector(context, musicBus);
    // The compressor controls sustained loudness. A soft peak guard catches
    // coincident blast transients, with a linear response below the knee.
    const peakInput = context.createGain();
    peakInput.gain.value = 0.25;
    const peakGuard = context.createWaveShaper();
    peakGuard.curve = Float32Array.from({ length: 4097 }, (_, i) => {
      const x = (i / 4096 * 2 - 1) * 4;
      const magnitude = Math.abs(x);
      return Math.sign(x) * (magnitude <= 0.8 ? magnitude
        : 0.8 + 0.18 * (1 - Math.exp(-(magnitude - 0.8) / 0.18)));
    });
    peakGuard.oversample = '2x';
    master.connect(compressor); compressor.connect(peakInput);
    peakInput.connect(peakGuard); peakGuard.connect(context.destination);
    noiseBuffer = makeNoise(2.1, 'white');
    brownBuffer = makeNoise(2.3, 'brown');
    movementVoices = {
      acid: createMovementVoice(noiseBuffer, {
        filterType: 'highpass', frequency: 2250, q: .2, rate: 1.04,
      }),
    };
    const loadingContext = context;
    assetsReady = loadAudioAssets(context).then((assets) => {
      if (destroyed || context !== loadingContext) return;
      recordedAssets = { ...assets, tntExplosion: buildTntExplosionBuffer(context, assets) };
      ambienceVoices = AMBIENCE_VOICE_SPECS.map(createAmbienceVoice);
      for (const [name, asset, options] of [
        ['water', 'waterFlow', { frequency: 6800 }],
        ['sand', 'sandFlow', { frequency: 6000 }],
        ['lava', 'bubbleLoop', { frequency: 900, rate: .72 }],
        ['gas', 'windLoop', { frequency: 4000 }],
        ['jetpackBody', 'fireLoop', { frequency: 650, rate: .82 }],
        ['jetpackHiss', 'windLoop', { frequency: 4300 }],
        ['shieldHum', 'windLoop', { frequency: 1600, rate: .7 }],
      ]) {
        if (assets[asset]) movementVoices[name] = createMovementVoice(assets[asset], options);
      }
    });
    applyMaster(true);
    return context;
  };

  const applyMaster = (immediate = false) => {
    if (!context || !master) return;
    const now = context.currentTime;
    const target = audible() ? 0.88 : 0;
    master.gain.cancelScheduledValues(now);
    if (immediate) master.gain.setValueAtTime(target, now);
    else master.gain.setTargetAtTime(target, now, target ? 0.035 : 0.025);
    musicDirector?.setAudible(audible() && !scorePaused);
    if (!audible()) {
      if (ambienceVoices) for (const voice of ambienceVoices)
        voice?.gain.gain.setTargetAtTime(0, now, 0.04);
      if (movementVoices) for (const voice of Object.values(movementVoices))
        voice.gain.gain.setTargetAtTime(0.0001, now, 0.04);
    }
  };

  const unlock = async () => {
    try {
      updateMediaSessionMetadata();
      // iOS defaults Web Audio to an ambient session, which the hardware silent
      // switch mutes in Safari and every iOS browser. Treat opted-in game audio
      // as media playback when the Audio Session API is available.
      if (typeof navigator !== 'undefined' && navigator.audioSession)
        navigator.audioSession.type = 'playback';
      const ctx = init();
      if (!ctx || destroyed) return false;
      musicDirector?.activate();
      // WebKit also exposes a non-standard `interrupted` state after an audio
      // session interruption. It needs the same resume attempt as `suspended`.
      if (ctx.state !== 'running' && ctx.state !== 'closed') await ctx.resume();
      unlocked = ctx.state === 'running';
      applyMaster();
      return ctx.state === 'running';
    } catch { return false; }
  };

  const trackVoice = (source, cleanup, weaponExplosion = false) => {
    if (!weaponExplosion) activeVoices++;
    source.onended = () => {
      if (!weaponExplosion) activeVoices = Math.max(0, activeVoices - 1);
      cleanup();
    };
  };

  const playNoise = ({ duration, gain, pan, frequency, type = 'bandpass', q = 0.7,
    rate = 1, buffer = noiseBuffer, delay = 0, attack = 0.012,
    weaponExplosion = false, toFrequency = frequency }) => {
    const atVoiceLimit = !weaponExplosion && activeVoices >= MAX_VOICES;
    if (!audible() || !context || atVoiceLimit || gain <= 0.001) return;
    const now = context.currentTime + delay;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const filter = context.createBiquadFilter();
    filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
    filter.frequency.setValueAtTime(frequency, now);
    filter.frequency.exponentialRampToValueAtTime(toFrequency, now + duration);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + Math.min(attack, duration * 0.45));
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter); filter.connect(envelope);
    const panner = connectSpatial(envelope, effectsBus, pan);
    trackVoice(source, () => {
      source.disconnect(); filter.disconnect(); envelope.disconnect(); panner?.disconnect();
    }, weaponExplosion);
    source.start(now, (context.currentTime * 0.371) % Math.max(0.01, buffer.duration - duration), duration);
  };

  const playTone = ({ from, to = from, duration, gain, pan, wave = 'sine',
    delay = 0, attack = 0.012, weaponExplosion = false }) => {
    if (!audible() || !context
        || (!weaponExplosion && activeVoices >= MAX_VOICES)
        || gain <= 0.001) return;
    const now = context.currentTime + delay;
    const osc = context.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + Math.min(attack, duration * 0.45));
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(envelope);
    const panner = connectSpatial(envelope, effectsBus, pan);
    trackVoice(osc, () => {
      osc.disconnect(); envelope.disconnect(); panner?.disconnect();
    }, weaponExplosion);
    osc.start(now); osc.stop(now + duration + 0.01);
  };

  const duckMusic = (amount = .45) => {
    if (!musicBus) return;
    const now = context.currentTime;
    const param = musicBus.gain;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else param.cancelScheduledValues(now);
    param.setTargetAtTime(.42 * Math.max(.72, amount), now, .045);
    param.setTargetAtTime(.42, now + .6, .8);
  };

  const playSample = ({ buffer, gain, pan, rate = 1, delay = 0,
    attack = 0.004, release = 0.04, frequency = 0, explosion = false, weaponExplosion = false,
    duration: requestedDuration, creature = false, creatureBackground = false }) => {
    if (!buffer || !audible() || !context
        || (creature && activeCreatureVoices >= (creatureBackground ? 4 : 8))
        || (!explosion && !weaponExplosion && activeVoices >= MAX_VOICES)
        || gain <= 0.001) return false;
    const now = context.currentTime + delay;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.linearRampToValueAtTime(gain, now + attack);
    const duration = Math.min(buffer.duration / rate, requestedDuration ?? Infinity);
    envelope.gain.setValueAtTime(gain, now + Math.max(attack, duration - release));
    envelope.gain.linearRampToValueAtTime(0.0001, now + duration);
    let filter = null;
    if (frequency) {
      filter = context.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = frequency; filter.Q.value = 0.5;
      source.connect(filter); filter.connect(envelope);
    } else source.connect(envelope);
    const panner = connectSpatial(envelope, effectsBus, pan);
    if (creature) activeCreatureVoices++;
    const cleanup = () => {
      if (creature) activeCreatureVoices = Math.max(0, activeCreatureVoices - 1);
      source.disconnect(); filter?.disconnect(); envelope.disconnect(); panner?.disconnect();
    };
    if (explosion) {
      // Keep fresh impacts audible during volleys; retire the oldest tail with
      // a short fade so stealing a voice never cuts its waveform abruptly.
      if (explosionVoices.length >= (mobileVoiceBudget ? 12 : 20)) {
        const oldest = explosionVoices.shift();
        const fadeAt = Math.max(now, oldest.startedAt + 0.1);
        const param = oldest.envelope.gain;
        if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(fadeAt);
        else {
          param.cancelScheduledValues(fadeAt);
          param.setValueAtTime(oldest.gain, fadeAt);
        }
        param.linearRampToValueAtTime(0, fadeAt + 0.045);
        oldest.source.stop(fadeAt + 0.05);
      }
      const voice = { source, envelope, gain, startedAt: now };
      explosionVoices.push(voice);
      source.onended = () => {
        const index = explosionVoices.indexOf(voice);
        if (index >= 0) explosionVoices.splice(index, 1);
        cleanup();
      };
    } else trackVoice(source, cleanup, weaponExplosion);
    source.start(now, 0, duration * rate);
    return true;
  };

  const playRecordedWeapon = (asset, {
    gain, pan, rate = 1, delay = 0, cooldown = 0, key = asset,
  }) => {
    const buffer = recordedAssets?.[asset];
    if (!buffer || !context) return false;
    const nowMs = context.currentTime * 1000;
    const last = lastRecordedWeaponAt.get(key) ?? -Infinity;
    if (nowMs - last < cooldown) return false;
    if (!playSample({ buffer, gain, pan, rate, delay })) return false;
    lastRecordedWeaponAt.set(key, nowMs);
    return true;
  };

  const playTntExplosionEffect = (strength, spatial, variation, weaponExplosion) => {
    const spec = explosionVoiceSpec(strength, spatial, variation);
    const { gain, pan, rate, frequency } = spec;
    if (recordedAssets?.tntExplosion) {
      playSample({
        buffer: recordedAssets.tntExplosion,
        ...spec,
        attack: 0.001,
        explosion: true,
      });
      return;
    }
    // A recorded gun report supplies the onset if the explosion is unavailable.
    playSample({ buffer: recordedAssets?.explosionBurst
      || recordedAssets?.blastGunReport, gain, pan, rate, frequency,
      explosion: true, weaponExplosion });
  };

  const chooseSample = (family) => {
    const keys = Array.isArray(family) ? family : SAMPLE_FAMILIES[family] || [family];
    const group = Array.isArray(family) ? family.join(':') : family;
    const available = keys.filter((key) => recordedAssets?.[key]);
    if (!available.length) return null;
    const previous = lastVariant.get(group);
    const choices = available.length > 1 ? available.filter((key) => key !== previous) : available;
    const key = choices[Math.floor(Math.random() * choices.length)];
    lastVariant.set(group, key);
    return recordedAssets[key];
  };

  const renderEvent = (type, strength, material, spatial, variation = Math.random()) => {
    const gain = Math.sqrt(clamp(strength, .04, 2.5)) * spatial.gain;
    const pan = spatial.pan * .82;
    const pitch = .97 + variation * .06;
    const sample = (family, volume, options = {}) => playSample({
      buffer: chooseSample(family), gain: gain * volume, pan, rate: pitch,
      frequency: 1800 + 9200 * Math.exp(-spatial.distance / 140),
      ...options,
    });
    const surface = materialSoundFamily(material);
    const rumble = (volume = .25, duration = .65) => sample('explosionBurst', volume,
      { rate: .85, frequency: 1200, duration, release: duration * .85 });
    if (COMBAT_EVENTS.has(type)) duckMusic();

    if (type === SOUND_EVENT.EXPLOSION || type === SOUND_EVENT.WEAPON_EXPLOSION) {
      duckMusic(.3);
      playTntExplosionEffect(strength, spatial, variation, type === SOUND_EVENT.WEAPON_EXPLOSION);
    } else if (type === SOUND_EVENT.BLAST_GUN) {
      sample('blastGunReport', .65);
      sample('weaponAction', .14, { delay: .055 });
    } else if (type === SOUND_EVENT.BORE_CHARGE || type === SOUND_EVENT.SPAWN_BREACH) {
      sample('windLoop', .55, { rate: .7, duration: .92, attack: .15 });
      sample('metal', .22, { rate: .65, delay: .1 });
    } else if (type === SOUND_EVENT.BORE_FIRE) {
      sample('blastGunReport', .65, { rate: .7 });
      rumble(.4, .9);
      sample('stone', .25, { delay: .08, rate: .8 });
    } else if (type === SOUND_EVENT.ACID_MORTAR || type === SOUND_EVENT.CLUSTER_LAUNCH) {
      sample('bow', .55, { rate: .72 });
      sample(type === SOUND_EVENT.ACID_MORTAR ? 'splash' : 'weaponAction', .3, { delay: .035 });
    } else if (type === SOUND_EVENT.MINIGUN) {
      playRecordedWeapon('minigunBurst', { gain: gain * .38, pan, rate: pitch,
        cooldown: 160, key: 'minigun-burst' });
    } else if (type === SOUND_EVENT.SWING) {
      sample('swish', .65, { rate: pitch * (material === 2 ? .8 : material === 3 ? 1.15 : 1) });
      sample('cloth', .1);
    } else if (type === SOUND_EVENT.MELEE_HIT) {
      sample('hit', .7);
      sample('metal', .12, { delay: .012, duration: .25 });
    } else if (type === SOUND_EVENT.GUARD || type === SOUND_EVENT.SHIELD_HIT) {
      sample(type === SOUND_EVENT.GUARD ? 'metal' : 'glass', .5);
      sample('hit', .2, { rate: .82 });
    } else if (type === SOUND_EVENT.SHIELD_BREAK) {
      sample('glass', .65, { rate: .85 });
      sample('windLoop', .3, { duration: .45, attack: .025 });
    } else if (type === SOUND_EVENT.RUNE) {
      // Element identities come from layered physical textures: air, embers,
      // brittle glass, foliage, and a low pressure body for the larger casts.
      sample('swish', .5, { rate: material === 8 ? .65 : pitch });
      if ([2, 7, 10].includes(material)) {
        sample('glass', .38, { rate: material === 10 ? .8 : 1.2, delay: .025 });
        if (material === 10) sample('windLoop', .3, { duration: .75, attack: .04 });
      } else if (material === 5) {
        sample('wood', .45, { rate: 1.1 });
        sample('cloth', .18, { delay: .04 });
      } else if (material === 8 || material === 9) {
        rumble(.42, material === 8 ? 1.1 : .5);
        sample('stone', .32, { rate: .78, delay: .04 });
      } else if (material !== 3) {
        sample('fireLoop', .45, { duration: material === 11 ? .55 : .3, attack: .008 });
        rumble(.18, .3);
      }
    } else if (type === SOUND_EVENT.HEAVY_IMPACT || type === SOUND_EVENT.SPELL_IMPACT) {
      const fire = material === MAT.FIRE || material === MAT.LAVA;
      const liquid = MATERIAL_BY_ID[material]?.kind === KIND.LIQUID;
      sample(fire ? 'explosionBurst' : liquid ? 'splash' : surface, .65,
        { duration: fire ? undefined : .75, explosion: type === SOUND_EVENT.SPELL_IMPACT });
      rumble(.28, .5);
      if (fire) sample('fireLoop', .32, { delay: .04, duration: .65 });
      if (material === MAT.ACID) sample('bubbleLoop', .4, { duration: .65 });
      if (material === MAT.NEUTRONIUM) rumble(.32, 1.1);
    } else if (type === SOUND_EVENT.SHOCKWAVE) {
      rumble(.55, 1.1);
      sample('stone', .45, { rate: .7, delay: .045 });
      sample('windLoop', .3, { duration: .7, attack: .02 });
    } else if (type === SOUND_EVENT.BELL) {
      sample('bell', .45, { rate: .8, duration: 4 });
    } else if (type === SOUND_EVENT.BEAM || type === SOUND_EVENT.RESPAWN) {
      sample('swish', .36, { rate: .72 });
      sample('bell', .25, { rate: 1.5, delay: .1, duration: 1.3 });
    } else if (type === SOUND_EVENT.FUSE) {
      sample('fireLoop', .28, { duration: .5, attack: .015 });
    } else if (type === SOUND_EVENT.IMPACT || type === SOUND_EVENT.SOLID_LAND) {
      const gain = clamp(strength, .08, 2.5) * spatial.gain;
      const pan = spatial.pan;
      const pitch = .88 + ((material * 37) % 17) / 50;
      const density = MATERIAL_BY_ID[material]?.density || 1.4;
      const heavy = clamp((density - 0.4) / 2.7);
      const bodyGain = type === SOUND_EVENT.SOLID_LAND ? 0.72 : 1;
      const bodyPitch = pitch * (1.08 - heavy * 0.32);
      playNoise({ duration: 0.14 + heavy * 0.09, gain: gain * 0.42 * bodyGain, pan,
        frequency: (420 - heavy * 175) * bodyPitch, type: 'lowpass', q: 0.58,
        rate: 0.78 + bodyPitch * 0.18, buffer: brownBuffer, attack: 0.008 });
      playTone({ from: (112 - heavy * 30) * bodyPitch, to: (57 - heavy * 12) * bodyPitch,
        duration: 0.14 + heavy * 0.08, gain: gain * 0.18 * bodyGain, pan,
        wave: 'sine', attack: 0.006 });
    } else if (type === SOUND_EVENT.JUMP) {
      sample('cloth', .3);
    } else if (type === SOUND_EVENT.LAND) {
      sample(surface === 'stone' ? 'step' : surface, .48, { rate: .9 * pitch });
      sample('cloth', .1);
    } else if (type === SOUND_EVENT.PLACE) {
      const kind = MATERIAL_BY_ID[material]?.kind;
      if (kind === KIND.POWDER || kind === KIND.LIQUID || kind === KIND.GAS) {
        const name = kind === KIND.POWDER ? 'sand' : kind === KIND.GAS ? 'gas'
          : material === MAT.LAVA ? 'lava' : 'water';
        holdMovementVoice(name, strength * .45, spatial,
          { volume: .08, rate: pitch, hold: .22, attack: .08, release: .25 });
      } else {
        const gain = clamp(strength, .08, 2.5) * spatial.gain;
        const pan = spatial.pan;
        const pitch = .88 + ((material * 37) % 17) / 50;
        const density = MATERIAL_BY_ID[material]?.density || 1.4;
        const heavy = clamp((density - 0.4) / 2.7);
        const placePitch = pitch * (0.94 - heavy * 0.22);
        playNoise({ duration: 0.13 + heavy * 0.05, gain: gain * 0.28, pan,
          frequency: (510 - heavy * 190) * placePitch, type: 'lowpass', q: 0.48,
          rate: 0.8 + placePitch * 0.16, buffer: brownBuffer, attack: 0.008 });
        playTone({ from: (108 - heavy * 25) * placePitch, to: (58 - heavy * 11) * placePitch,
          duration: 0.12 + heavy * 0.05, gain: gain * 0.13, pan, wave: 'sine', attack: 0.006 });
      }
    } else if (type === SOUND_EVENT.BREAK) {
      sample(surface, .52, { rate: .92 * pitch });
      sample('sandFlow', .14, { duration: .3, delay: .035 });
    } else if (type === SOUND_EVENT.PICKUP) {
      sample('pickup', .33);
    } else if (type === SOUND_EVENT.HURT || type === SOUND_EVENT.DEATH) {
      sample('hit', type === SOUND_EVENT.DEATH ? .65 : .5, { rate: type === SOUND_EVENT.DEATH ? .7 : .9 });
      sample('cloth', .22, { delay: .035 });
      if (type === SOUND_EVENT.DEATH) duckMusic(.15);
    } else if (creatureSoundPhase(type)) {
      const voice = creatureSoundSpec(material, type);
      if (!voice) return;
      const background = type === SOUND_EVENT.CREATURE_CALL || voice.phase === 'step';
      sample(voice.phase === 'step' ? voice.samples[0] : voice.samples, voice.gain, {
        rate: voice.rate * pitch, duration: voice.duration, release: .09,
        frequency: Math.min(voice.cutoff, 1800 + 8500 * Math.exp(-spatial.distance / 140)),
        creature: true, creatureBackground: background,
      });
      if (voice.texture) sample(voice.texture, voice.gain * .24, {
        rate: voice.rate * .94, delay: .04, duration: voice.phase === 'death' ? .85 : .45,
        release: .12, creature: true,
      });
      if (type === SOUND_EVENT.CREATURE_ATTACK || type === SOUND_EVENT.CREATURE_DEATH) duckMusic(.2);
    } else if (type === SOUND_EVENT.FLUID_FALL) {
      holdMovementVoice(material === MAT.LAVA ? 'lava' : 'water', strength, spatial,
        { volume: .115, rate: material === MAT.OIL ? .8 : pitch, hold: .35, attack: .09, release: .28 });
    } else if (type === SOUND_EVENT.POWDER_MOVE) {
      holdMovementVoice('sand', strength, spatial,
        { volume: .105, rate: pitch, hold: .3, attack: .085, release: .22 });
    } else if (type === SOUND_EVENT.ACID_DISSOLVE) {
      holdMovementVoice('acid', strength, spatial,
        { volume: .056, rate: .96 + variation * .12, hold: .42, attack: .095, release: .3 });
    } else if (type === SOUND_EVENT.CRAFT) {
      sample('craft', .4);
      sample('wood', .2, { delay: .1 });
    } else if (type === SOUND_EVENT.BOW) {
      sample('bow', .65);
    } else if (type === SOUND_EVENT.ARROW_HIT) {
      sample(surface, .52, { duration: .3 });
    }
  };

  const playEvents = (packed, listener) => {
    if (!audible() || !context || context.state !== 'running' || !packed?.length) return;
    const O = OFF.soundEvent;
    const nowMs = performance.now();
    for (let i = 0; i + STRIDES.soundEvent <= packed.length; i += STRIDES.soundEvent) {
      const type = packed[i + O.type] | 0;
      const eventX = packed[i + O.x], eventY = packed[i + O.y];
      const material = packed[i + O.material] | 0;
      const creatureVoice = creatureSoundSpec(material, type);
      const spatial = spatializeSound(packed[i + O.x], packed[i + O.y], listener,
        creatureVoice?.reach ?? EVENT_DISTANCE[type] ?? 70, packed[i + O.layer] | 0);
      if (spatial.gain <= 0.001) continue;
      const materialKind = MATERIAL_BY_ID[material]?.kind;
      const continuousPlace = type === SOUND_EVENT.PLACE
        && (materialKind === KIND.POWDER || materialKind === KIND.LIQUID || materialKind === KIND.GAS);
      const regional = type === SOUND_EVENT.FLUID_FALL || type === SOUND_EVENT.POWDER_MOVE
        || type === SOUND_EVENT.ACID_DISSOLVE;
      const cooldownKey = creatureVoice ? `${type}:${material}:${Math.round(spatial.pan * 2)}`
        : regional ? `${type}:${Math.round(spatial.pan * 2)}` : type;
      const cooldown = creatureVoice?.cooldown ?? semanticEventCooldownMs(type, continuousPlace);
      if (type === SOUND_EVENT.EXPLOSION) {
        if (!admitTerrainExplosion(eventX, eventY, nowMs)) continue;
      } else if (cooldown > 0) {
        const last = lastEventAt.get(cooldownKey) || -Infinity;
        if (nowMs - last < cooldown) continue;
        lastEventAt.set(cooldownKey, nowMs);
      }
      renderEvent(type, packed[i + O.intensity], material, spatial);
    }
  };

  const playBeam = () => {
    const emit = () => {
      if (!audible() || !context || context.state !== 'running') return false;
      renderEvent(SOUND_EVENT.BEAM, 1, MAT.LIGHT, {
        gain: 1,
        pan: 0,
        distance: 0,
      });
      return true;
    };
    if (emit()) return true;
    if (!audible()) return false;
    unlock().then((ready) => { if (ready) emit(); });
    return true;
  };

  const updateAmbience = (packed, listener) => {
    if (!context || !ambienceVoices) return;
    const now = context.currentTime;
    for (let group = 0; group < ambienceVoices.length; group++) {
      const o = group * AMBIENCE_SAMPLE_STRIDE;
      const amount = audible() && packed?.length >= o + AMBIENCE_SAMPLE_STRIDE
        ? clamp(packed[o + AMBIENCE_SAMPLE_FIELD.AMOUNT]) : 0;
      const spatial = spatializeSound(
        packed?.[o + AMBIENCE_SAMPLE_FIELD.WORLD_X] ?? listener.x,
        packed?.[o + AMBIENCE_SAMPLE_FIELD.WORLD_Y] ?? listener.y,
        listener, 115, 0,
      );
      const voice = ambienceVoices[group];
      if (!voice) continue;
      const target = amount * voice.volume * Math.max(0.18, spatial.gain);
      voice.gain.gain.setTargetAtTime(target, now, target > voice.gain.gain.value ? 0.16 : 0.3);
      if (voice.panner) voice.panner.pan.setTargetAtTime(spatial.pan * 0.72, now, 0.18);
    }
  };

  const updatePlayerEffects = (player) => {
    if (!context || !movementVoices) return;
    const next = derivePlayerEffectState(player);
    const samePlayer = next.id !== 0 && next.id === playerEffects.id;
    const fuel = clamp(player?.jetpackFuel ?? 0);
    const ward = clamp((player?.shieldHealth ?? 0) / 200);

    if (next.jetpack && (!samePlayer || !playerEffects.jetpack) && audible()) {
      playSample({ buffer: recordedAssets?.fireLoop, gain: .18, pan: 0,
        duration: .25, attack: .008 });
    }
    if (next.shield && (!samePlayer || !playerEffects.shield) && audible()) {
      playSample({ buffer: chooseSample('glass'), gain: .2, pan: 0, rate: .85 });
      playSample({ buffer: chooseSample('swish'), gain: .16, pan: 0, rate: .8 });
    }

    const thrust = next.jetpack ? 0.82 + fuel * 0.18 : 0;
    setMovementVoice('jetpackBody', thrust,
      { volume: 0.105, rate: 0.94 + fuel * 0.10, attack: 0.035, release: 0.12 });
    setMovementVoice('jetpackHiss', thrust,
      { volume: 0.062, rate: 1.02 + fuel * 0.16, attack: 0.025, release: 0.09 });
    setMovementVoice('shieldHum', next.shield ? 0.68 + ward * 0.32 : 0,
      { volume: 0.048, rate: 0.92 + ward * 0.12, attack: 0.055, release: 0.16 });
    playerEffects = next;
  };

  const updateScore = (player, creatures, paused = false) => {
    if (!musicDirector) return;
    scorePaused = paused;
    musicDirector.setAudible(audible() && !scorePaused);
    if (paused) return;
    const state = scoreThreat(player, creatures);
    if (player && scorePlayer && player.alive !== false
        && player.id === scorePlayer.id && player.health < scorePlayer.health)
      state.threat = true;
    scorePlayer = player ? { id: player.id, health: player.health } : null;
    musicDirector.update({ ...state, alive: !!player && player.alive !== false });
  };

  const setEnabled = (on) => { enabled = !!on; applyMaster(); };
  const setMuted = (on) => { muted = !!on; writeStoredMuted(muted); applyMaster(); };
  const toggleMuted = () => { setMuted(!muted); if (!muted) unlock(); return muted; };

  const onVisibility = () => {
    hidden = document.hidden;
    applyMaster();
    if (!hidden) unlock();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    musicDirector?.destroy();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    if (ambienceVoices) for (const voice of ambienceVoices) { try { voice?.source.stop(); } catch { /* already stopped */ } }
    if (movementVoices) for (const voice of Object.values(movementVoices)) { try { voice?.source.stop(); } catch { /* already stopped */ } }
    const ctx = context;
    unlocked = false;
    context = master = effectsBus = ambienceBus = ambienceVoices = movementVoices = recordedAssets = null;
    musicBus = musicDirector = noiseBuffer = brownBuffer = null;
    try { ctx?.close(); } catch { /* browser is already tearing down */ }
  };

  return {
    prepare,
    unlock,
    playEvents,
    playBeam,
    updateAmbience,
    updatePlayerEffects,
    updateScore,
    setEnabled,
    setMuted,
    toggleMuted,
    get enabled() { return enabled; },
    get muted() { return muted; },
    get assetsReady() { return assetsReady; },
    get ready() { return unlocked && context?.state === 'running'; },
    get playerEffects() { return { ...playerEffects }; },
    get scoreState() { return musicDirector?.state || null; },
    destroy,
  };
}
