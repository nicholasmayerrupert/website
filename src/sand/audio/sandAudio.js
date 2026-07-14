// Browser sound renderer for the sand engine.
//
// C++ reports semantic events and local ambience measurements; this module is
// the only place that knows about Web Audio, synthesis, panning, mixing, voice
// limits, browser activation, mute persistence, or document visibility.

import { OFF, SOUND_EVENT, STRIDES } from '../wasmBridge/abi.generated.js';
import { KIND, MATERIALS, MAT } from '../materials.js';
import { loadAudioAssets } from './audioAssets.js';

const STORAGE_KEY = 'sand-audio-muted';
const AMBIENCE = Object.freeze({ WATER: 0, FIRE: 1, LAVA: 2, ACID: 3 });
const AMBIENCE_VOLUME = [0, 0.15, 0, 0];
const EVENT_DISTANCE = Object.freeze({
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
});

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

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

function readStoredMuted() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; }
  catch { return false; }
}

function writeStoredMuted(muted) {
  try { localStorage.setItem(STORAGE_KEY, muted ? '1' : '0'); }
  catch { /* storage may be unavailable in third-party/private embeds */ }
}

export function createSandAudio() {
  let context = null;
  let master = null;
  let effectsBus = null;
  let ambienceBus = null;
  let enabled = true;
  let muted = readStoredMuted();
  let hidden = typeof document !== 'undefined' && document.hidden;
  let destroyed = false;
  let activeVoices = 0;
  let noiseBuffer = null;
  let brownBuffer = null;
  let crackleBuffer = null;
  let ambienceVoices = null;
  let recordedAssets = null;
  let movementVoices = null;
  let assetLoad = null;
  const lastEventAt = new Map();
  const MAX_VOICES = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 16 : 28;

  const audible = () => enabled && !muted && !hidden && !destroyed;

  const makeNoise = (seconds, kind) => {
    const length = Math.ceil(context.sampleRate * seconds);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const out = buffer.getChannelData(0);
    let seed = kind === 'brown' ? 0x51f15e : kind === 'crackle' ? 0xc9a31e : 0x7f4a7c;
    let brown = 0;
    for (let i = 0; i < length; i++) {
      seed = Math.imul(seed ^ (seed >>> 15), 2246822519) >>> 0;
      const white = ((seed / 4294967296) * 2 - 1);
      if (kind === 'brown') {
        brown = clamp((brown + white * 0.055) / 1.045, -1, 1);
        out[i] = brown * 2.4;
      } else if (kind === 'crackle') {
        const impulse = (seed & 1023) < 9 ? white * (0.45 + ((seed >>> 10) & 255) / 255) : 0;
        out[i] = white * 0.08 + impulse;
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

  const createAmbienceVoice = (group) => {
    const source = context.createBufferSource();
    source.loop = true;
    source.buffer = group === AMBIENCE.WATER || group === AMBIENCE.ACID ? brownBuffer
      : group === AMBIENCE.FIRE ? crackleBuffer
        : brownBuffer;
    const filter = context.createBiquadFilter();
    if (group === AMBIENCE.WATER) { filter.type = 'bandpass'; filter.frequency.value = 720; filter.Q.value = 0.48; }
    else if (group === AMBIENCE.FIRE) { filter.type = 'bandpass'; filter.frequency.value = 1850; filter.Q.value = 0.62; }
    else if (group === AMBIENCE.LAVA) { filter.type = 'lowpass'; filter.frequency.value = 320; filter.Q.value = 0.72; }
    else { filter.type = 'bandpass'; filter.frequency.value = 820; filter.Q.value = 0.45; }
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(filter); filter.connect(gain);
    const panner = connectSpatial(gain, ambienceBus, 0);
    source.start();
    return { source, gain, panner };
  };

  const createMovementVoice = (buffer, {
    filterType = 'lowpass', frequency = 7000, q = 0.2, rate = 1,
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
    const panner = connectSpatial(gain, effectsBus, 0);
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

  const init = () => {
    if (context || destroyed || typeof window === 'undefined') return context;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    // Older WebKit builds expose AudioContext but reject constructor options.
    // Fall back to the optionless form so iOS Safari and iOS Chrome can still
    // create the graph from the user's first gesture.
    try { context = new AudioContext({ latencyHint: 'interactive' }); }
    catch { context = new AudioContext(); }
    master = context.createGain();
    master.gain.value = 0;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -15;
    compressor.knee.value = 16;
    compressor.ratio.value = 7;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.22;
    effectsBus = context.createGain();
    ambienceBus = context.createGain();
    effectsBus.gain.value = 0.82;
    ambienceBus.gain.value = 0.6;
    effectsBus.connect(master); ambienceBus.connect(master);
    master.connect(compressor); compressor.connect(context.destination);
    noiseBuffer = makeNoise(2.1, 'white');
    brownBuffer = makeNoise(2.3, 'brown');
    crackleBuffer = makeNoise(2.7, 'crackle');
    ambienceVoices = [0, 1, 2, 3].map(createAmbienceVoice);
    movementVoices = {
      lava: createMovementVoice(brownBuffer, { frequency: 230, q: 0.5, rate: 0.72 }),
      gas: createMovementVoice(noiseBuffer, {
        filterType: 'highpass', frequency: 1350, q: 0.16, rate: 0.94,
      }),
      acid: createMovementVoice(noiseBuffer, {
        filterType: 'highpass', frequency: 2250, q: 0.2, rate: 1.04,
      }),
    };
    const loadingContext = context;
    assetLoad = loadAudioAssets(context).then((assets) => {
      if (destroyed || context !== loadingContext) return;
      recordedAssets = assets;
      movementVoices.water = createMovementVoice(assets.waterFlow, { frequency: 6800, q: 0.15 });
      movementVoices.sand = createMovementVoice(assets.sandFlow, {
        filterType: 'highpass', frequency: 720, q: 0.18,
      });
    }).catch((error) => console.warn('[sand audio] recorded assets unavailable', error));
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
    if (!audible() && ambienceVoices) for (const voice of ambienceVoices)
      voice.gain.gain.setTargetAtTime(0, now, 0.04);
  };

  const unlock = async () => {
    try {
      // iOS defaults Web Audio to an ambient session, which the hardware silent
      // switch mutes in Safari and every iOS browser. Treat opted-in game audio
      // as media playback when the Audio Session API is available.
      if (typeof navigator !== 'undefined' && navigator.audioSession)
        navigator.audioSession.type = 'playback';
      const ctx = init();
      if (!ctx || destroyed) return false;
      // WebKit also exposes a non-standard `interrupted` state after an audio
      // session interruption. It needs the same resume attempt as `suspended`.
      if (ctx.state !== 'running' && ctx.state !== 'closed') await ctx.resume();
      applyMaster();
      return ctx.state === 'running';
    } catch { return false; }
  };

  const trackVoice = (source) => {
    activeVoices++;
    source.onended = () => { activeVoices = Math.max(0, activeVoices - 1); };
  };

  const playNoise = ({ duration, gain, pan, frequency, type = 'bandpass', q = 0.7,
    rate = 1, buffer = noiseBuffer, delay = 0, attack = 0.012 }) => {
    if (!audible() || !context || activeVoices >= MAX_VOICES || gain <= 0.001) return;
    const now = context.currentTime + delay;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const filter = context.createBiquadFilter();
    filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + Math.min(attack, duration * 0.45));
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter); filter.connect(envelope); connectSpatial(envelope, effectsBus, pan);
    trackVoice(source);
    source.start(now, (context.currentTime * 0.371) % Math.max(0.01, buffer.duration - duration), duration);
  };

  const playTone = ({ from, to = from, duration, gain, pan, wave = 'sine', delay = 0, attack = 0.012 }) => {
    if (!audible() || !context || activeVoices >= MAX_VOICES || gain <= 0.001) return;
    const now = context.currentTime + delay;
    const osc = context.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + Math.min(attack, duration * 0.45));
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(envelope); connectSpatial(envelope, effectsBus, pan);
    trackVoice(osc);
    osc.start(now); osc.stop(now + duration + 0.01);
  };

  const playSample = ({ buffer, gain, pan, rate = 1 }) => {
    if (!buffer || !audible() || !context || activeVoices >= MAX_VOICES || gain <= 0.001) return;
    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.linearRampToValueAtTime(gain, now + 0.004);
    const duration = buffer.duration / rate;
    envelope.gain.setValueAtTime(gain, now + Math.max(0.01, duration - 0.04));
    envelope.gain.linearRampToValueAtTime(0.0001, now + duration);
    source.connect(envelope); connectSpatial(envelope, effectsBus, pan);
    trackVoice(source);
    source.start(now);
  };

  const renderEvent = (type, strength, material, spatial, variation = 0.5) => {
    const gain = clamp(strength, 0.08, 2.5) * spatial.gain;
    const pan = spatial.pan;
    const pitch = 0.88 + ((material * 37) % 17) / 50;
    if (type === SOUND_EVENT.EXPLOSION) {
      playSample({ buffer: recordedAssets?.tntExplosion,
        gain: Math.min(0.72, gain * 0.44), pan, rate: 0.98 + variation * 0.04 });
    } else if (type === SOUND_EVENT.FUSE) {
      playNoise({ duration: 0.48, gain: gain * 0.32, pan, frequency: 3100, type: 'highpass', q: 0.35, buffer: crackleBuffer, rate: 1.1 });
    } else if (type === SOUND_EVENT.IMPACT || type === SOUND_EVENT.SOLID_LAND) {
      const density = MATERIALS[material]?.density || 1.4;
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
      playTone({ from: 145, to: 245, duration: 0.13, gain: gain * 0.22, pan, wave: 'triangle' });
    } else if (type === SOUND_EVENT.LAND) {
      playNoise({ duration: 0.13, gain: gain * 0.44, pan, frequency: 410, type: 'lowpass', q: 0.55, rate: 0.9 });
    } else if (type === SOUND_EVENT.PLACE) {
      const kind = MATERIALS[material]?.kind;
      if (kind === KIND.POWDER || kind === KIND.LIQUID || kind === KIND.GAS) {
        if (kind === KIND.POWDER) holdMovementVoice('sand', strength * 0.45, spatial,
          { volume: 0.075, rate: 0.96 + variation * 0.08, hold: 0.2 });
        else if (kind === KIND.GAS) holdMovementVoice('gas', strength * 0.4, spatial,
          { volume: 0.06, rate: 0.92 + variation * 0.14, hold: 0.22, attack: 0.1, release: 0.24 });
        else if (material === MAT.LAVA) holdMovementVoice('lava', strength * 0.45, spatial,
          { volume: 0.085, rate: 0.9 + variation * 0.12, hold: 0.22, release: 0.3 });
        else holdMovementVoice('water', strength * 0.42, spatial,
          { volume: 0.062, rate: material === MAT.OIL ? 0.82 : 0.96 + variation * 0.08, hold: 0.2 });
      } else {
        const density = MATERIALS[material]?.density || 1.4;
        const heavy = clamp((density - 0.4) / 2.7);
        const placePitch = pitch * (0.94 - heavy * 0.22);
        playNoise({ duration: 0.13 + heavy * 0.05, gain: gain * 0.28, pan,
          frequency: (510 - heavy * 190) * placePitch, type: 'lowpass', q: 0.48,
          rate: 0.8 + placePitch * 0.16, buffer: brownBuffer, attack: 0.008 });
        playTone({ from: (108 - heavy * 25) * placePitch, to: (58 - heavy * 11) * placePitch,
          duration: 0.12 + heavy * 0.05, gain: gain * 0.13, pan, wave: 'sine', attack: 0.006 });
      }
    } else if (type === SOUND_EVENT.BREAK) {
      playNoise({ duration: 0.21, gain: gain * 0.48, pan, frequency: 1250 * pitch, type: 'bandpass', q: 0.52, rate: pitch });
      playNoise({ duration: 0.11, gain: gain * 0.25, pan, frequency: 430 * pitch, type: 'lowpass', q: 0.7, rate: 0.8 * pitch });
    } else if (type === SOUND_EVENT.PICKUP) {
      playTone({ from: 520 * pitch, to: 720 * pitch, duration: 0.1, gain: gain * 0.18, pan, wave: 'sine' });
      playTone({ from: 740 * pitch, to: 930 * pitch, duration: 0.11, gain: gain * 0.13, pan, wave: 'sine', delay: 0.055 });
    } else if (type === SOUND_EVENT.HURT) {
      playNoise({ duration: 0.18, gain: gain * 0.35, pan, frequency: 680, type: 'bandpass', q: 0.8, rate: 0.75 });
      playTone({ from: 170, to: 82, duration: 0.2, gain: gain * 0.2, pan, wave: 'sawtooth' });
    } else if (type === SOUND_EVENT.CREATURE) {
      playTone({ from: 280 * pitch, to: 205 * pitch, duration: 0.12, gain: gain * 0.13, pan, wave: 'triangle' });
    } else if (type === SOUND_EVENT.FLUID_FALL) {
      const lava = material === MAT.LAVA;
      const oil = material === MAT.OIL;
      if (lava) {
        holdMovementVoice('lava', strength, spatial, { volume: 0.115,
          rate: 0.88 + variation * 0.16, hold: 0.38, attack: 0.11, release: 0.34 });
      } else {
        holdMovementVoice('water', strength, spatial, { volume: oil ? 0.075 : 0.1,
          rate: oil ? 0.8 : 0.95 + variation * 0.09, hold: 0.34, attack: 0.09, release: 0.25 });
      }
    } else if (type === SOUND_EVENT.POWDER_MOVE) {
      holdMovementVoice('sand', strength, spatial, { volume: 0.105,
        rate: 0.94 + variation * 0.12, hold: 0.3, attack: 0.085, release: 0.22 });
    } else if (type === SOUND_EVENT.ACID_DISSOLVE) {
      holdMovementVoice('acid', strength, spatial, { volume: 0.09,
        rate: 0.96 + variation * 0.12, hold: 0.42, attack: 0.095, release: 0.3 });
    }
  };

  const playEvents = (packed, listener) => {
    if (!audible() || !context || context.state !== 'running' || !packed?.length) return;
    const O = OFF.soundEvent;
    const nowMs = performance.now();
    for (let i = 0; i + STRIDES.soundEvent <= packed.length; i += STRIDES.soundEvent) {
      const type = packed[i + O.type] | 0;
      const eventX = packed[i + O.x], eventY = packed[i + O.y];
      const variation = ((Math.imul(Math.floor(eventX), 73856093)
        ^ Math.imul(Math.floor(eventY), 19349663)) >>> 0) / 4294967295;
      const spatial = spatializeSound(packed[i + O.x], packed[i + O.y], listener,
        EVENT_DISTANCE[type] ?? 70, packed[i + O.layer] | 0);
      if (spatial.gain <= 0.001) continue;
      const material = packed[i + O.material] | 0;
      const materialKind = MATERIALS[material]?.kind;
      const continuousPlace = type === SOUND_EVENT.PLACE
        && (materialKind === KIND.POWDER || materialKind === KIND.LIQUID || materialKind === KIND.GAS);
      const regional = type === SOUND_EVENT.FLUID_FALL || type === SOUND_EVENT.POWDER_MOVE
        || type === SOUND_EVENT.ACID_DISSOLVE;
      const cooldownKey = regional
        ? `${type}:${Math.round(spatial.pan * 2)}` : type;
      const last = lastEventAt.get(cooldownKey) || -Infinity;
      const cooldown = type === SOUND_EVENT.EXPLOSION ? 190 + variation * 160
        : continuousPlace ? 125 : (EVENT_COOLDOWN_MS[type] ?? 45);
      if (nowMs - last < cooldown) continue;
      lastEventAt.set(cooldownKey, nowMs);
      renderEvent(type, packed[i + O.intensity], material, spatial, variation);
    }
  };

  const updateAmbience = (packed, listener) => {
    if (!context || !ambienceVoices) return;
    const now = context.currentTime;
    for (let group = 0; group < ambienceVoices.length; group++) {
      const o = group * 3;
      const amount = audible() && packed?.length >= o + 3 ? clamp(packed[o]) : 0;
      const spatial = spatializeSound(packed?.[o + 1] ?? listener.x, packed?.[o + 2] ?? listener.y,
        listener, 115, 0);
      const voice = ambienceVoices[group];
      const target = amount * AMBIENCE_VOLUME[group] * Math.max(0.18, spatial.gain);
      voice.gain.gain.setTargetAtTime(target, now, target > voice.gain.gain.value ? 0.16 : 0.3);
      if (voice.panner) voice.panner.pan.setTargetAtTime(spatial.pan * 0.72, now, 0.18);
    }
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
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    if (ambienceVoices) for (const voice of ambienceVoices) { try { voice.source.stop(); } catch { /* already stopped */ } }
    if (movementVoices) for (const voice of Object.values(movementVoices)) { try { voice.source.stop(); } catch { /* already stopped */ } }
    const ctx = context;
    context = master = effectsBus = ambienceBus = ambienceVoices = movementVoices = recordedAssets = assetLoad = null;
    try { ctx?.close(); } catch { /* browser is already tearing down */ }
  };

  return {
    unlock,
    playEvents,
    updateAmbience,
    setEnabled,
    setMuted,
    toggleMuted,
    get enabled() { return enabled; },
    get muted() { return muted; },
    get ready() { return context?.state === 'running'; },
    destroy,
  };
}
