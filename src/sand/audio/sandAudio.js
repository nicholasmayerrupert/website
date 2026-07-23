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
  const lastEventAt = new Map();
  const lastRecordedWeaponAt = new Map();
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
      minigun: createMovementVoice(crackleBuffer, {
        filterType: 'bandpass', frequency: 1750, q: 0.46, rate: 1.32,
      }),
    };
    const loadingContext = context;
    loadAudioAssets(context).then((assets) => {
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

  const playSample = ({ buffer, gain, pan, rate = 1, delay = 0, attack = 0.004 }) => {
    if (!buffer || !audible() || !context || activeVoices >= MAX_VOICES || gain <= 0.001) return false;
    const now = context.currentTime + delay;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.linearRampToValueAtTime(gain, now + attack);
    const duration = buffer.duration / rate;
    envelope.gain.setValueAtTime(gain, now + Math.max(0.01, duration - 0.04));
    envelope.gain.linearRampToValueAtTime(0.0001, now + duration);
    source.connect(envelope); connectSpatial(envelope, effectsBus, pan);
    trackVoice(source);
    source.start(now);
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

  const renderEvent = (type, strength, material, spatial, variation = 0.5) => {
    const gain = clamp(strength, 0.08, 2.5) * spatial.gain;
    const pan = spatial.pan;
    const pitch = 0.88 + ((material * 37) % 17) / 50;
    if (type === SOUND_EVENT.BLAST_GUN) {
      // Recorded muzzle texture plus the fast pressure impulse, ground/body
      // reflection, and delayed weapon action that survive small speakers.
      playRecordedWeapon('blastGunReport', {
        gain: Math.min(0.28, gain * 0.22), pan, rate: 0.96 + variation * 0.08,
      });
      playNoise({ duration: 0.075, gain: gain * 0.22, pan, frequency: 2350,
        type: 'highpass', q: 0.38, rate: 1.05 + variation * 0.12, attack: 0.0015 });
      playTone({ from: 132, to: 48, duration: 0.18, gain: gain * 0.17, pan,
        wave: 'sine', attack: 0.002 });
      playNoise({ duration: 0.17, gain: gain * 0.11, pan, frequency: 265,
        type: 'lowpass', q: 0.55, rate: 0.88 + variation * 0.08,
        buffer: brownBuffer, delay: 0.026, attack: 0.003 });
      playRecordedWeapon('weaponAction', {
        gain: gain * 0.085, pan, rate: 0.94 + variation * 0.14,
        delay: 0.034, key: 'blast-action',
      });
    } else if (type === SOUND_EVENT.BORE_CHARGE) {
      // A rising warning with enough low body to remain readable behind terrain.
      playTone({ from: 82, to: 410, duration: 0.62, gain: gain * 0.16, pan,
        wave: 'sawtooth', attack: 0.04 });
      playTone({ from: 360, to: 1220, duration: 0.58, gain: gain * 0.09, pan,
        wave: 'triangle', delay: 0.035, attack: 0.05 });
      playNoise({ duration: 0.50, gain: gain * 0.08, pan, frequency: 2400,
        type: 'bandpass', q: 1.4, rate: 0.92 + variation * 0.12, attack: 0.08 });
    } else if (type === SOUND_EVENT.BORE_FIRE) {
      // The cutting beam reads as one violent pressure crack followed by a
      // descending energy discharge and its low reflected tail.
      playNoise({ duration: 0.065, gain: gain * 0.20, pan, frequency: 3900,
        type: 'highpass', q: 0.34, rate: 1.05 + variation * 0.12, attack: 0.0015 });
      playTone({ from: 1180, to: 74, duration: 0.42, gain: gain * 0.22, pan,
        wave: 'sawtooth', attack: 0.003 });
      playNoise({ duration: 0.34, gain: gain * 0.24, pan, frequency: 1120,
        type: 'bandpass', q: 0.7, rate: 0.82 + variation * 0.10, attack: 0.004 });
      playTone({ from: 105, to: 42, duration: 0.48, gain: gain * 0.20, pan,
        wave: 'sine', delay: 0.018, attack: 0.008 });
      playNoise({ duration: 0.31, gain: gain * 0.12, pan, frequency: 235,
        type: 'lowpass', q: 0.55, rate: 0.77 + variation * 0.08,
        buffer: brownBuffer, delay: 0.045, attack: 0.009 });
    } else if (type === SOUND_EVENT.ACID_MORTAR) {
      playRecordedWeapon('weaponAction', {
        gain: gain * 0.065, pan, rate: 0.78 + variation * 0.12,
        delay: 0.035, cooldown: 80, key: 'acid-action',
      });
      playTone({ from: 270, to: 92, duration: 0.22, gain: gain * 0.17, pan,
        wave: 'square', attack: 0.004 });
      playNoise({ duration: 0.24, gain: gain * 0.19, pan, frequency: 980,
        type: 'bandpass', q: 0.8, rate: 0.82 + variation * 0.16, attack: 0.008 });
      playTone({ from: 690, to: 330, duration: 0.28, gain: gain * 0.07, pan,
        wave: 'sawtooth', delay: 0.025, attack: 0.012 });
    } else if (type === SOUND_EVENT.CLUSTER_LAUNCH) {
      playRecordedWeapon('blastGunReport', {
        gain: Math.min(0.12, gain * 0.085), pan, rate: 0.78 + variation * 0.06,
        cooldown: 90, key: 'cluster-report',
      });
      playRecordedWeapon('weaponAction', {
        gain: gain * 0.07, pan, rate: 0.82 + variation * 0.10,
        delay: 0.042, cooldown: 90, key: 'cluster-action',
      });
      playNoise({ duration: 0.12, gain: gain * 0.25, pan, frequency: 1350,
        type: 'highpass', q: 0.55, rate: 1.0 + variation * 0.15, attack: 0.003 });
      playTone({ from: 190, to: 75, duration: 0.21, gain: gain * 0.17, pan,
        wave: 'triangle', attack: 0.004 });
      for (let i = 0; i < 3; i++) playTone({
        from: 820 + i * 180, to: 430 + i * 70, duration: 0.08,
        gain: gain * 0.045, pan, wave: 'square', delay: 0.045 + i * 0.026, attack: 0.002,
      });
    } else if (type === SOUND_EVENT.MINIGUN) {
      // The continuous crackle supplies the actual high cyclic rate; a quiet
      // real rifle burst periodically restores believable muzzle texture.
      playRecordedWeapon('minigunBurst', {
        gain: Math.min(0.15, gain * 0.11), pan, rate: 0.96 + variation * 0.08,
        cooldown: 235, key: 'minigun-burst',
      });
      playRecordedWeapon('weaponAction', {
        gain: gain * 0.045, pan, rate: 1.08 + variation * 0.16,
        delay: 0.012, cooldown: 90, key: 'minigun-action',
      });
      holdMovementVoice('minigun', strength, spatial, {
        volume: 0.105, rate: 1.18 + variation * 0.20,
        hold: 0.075, attack: 0.008, release: 0.045,
      });
      playTone({ from: 142 + variation * 24, to: 72, duration: 0.055,
        gain: gain * 0.075, pan, wave: 'square', attack: 0.002 });
      playNoise({ duration: 0.045, gain: gain * 0.085, pan, frequency: 3200,
        type: 'highpass', q: 0.36, rate: 1.12 + variation * 0.18, attack: 0.0015 });
    } else if (type === SOUND_EVENT.SHIELD_HIT) {
      // A compact glassy impact with a low magical shove. Rapid incoming fire
      // stays readable without becoming a wall of full-volume transients.
      playTone({ from: 760 + variation * 120, to: 1180, duration: 0.085,
        gain: gain * 0.13, pan, wave: 'triangle', attack: 0.002 });
      playTone({ from: 1540, to: 620 + variation * 90, duration: 0.14,
        gain: gain * 0.075, pan, wave: 'sine', delay: 0.008, attack: 0.002 });
      playNoise({ duration: 0.095, gain: gain * 0.11, pan, frequency: 2650,
        type: 'bandpass', q: 1.5, rate: 1.04 + variation * 0.12, attack: 0.0015 });
      playTone({ from: 118, to: 76, duration: 0.12, gain: gain * 0.075, pan,
        wave: 'sine', attack: 0.003 });
    } else if (type === SOUND_EVENT.SHIELD_BREAK) {
      // Ward collapse is deliberately distinct from ordinary health damage:
      // brittle high shards tear away above a descending, hollow power-down.
      playNoise({ duration: 0.30, gain: gain * 0.24, pan, frequency: 3400,
        type: 'highpass', q: 0.42, rate: 1.02 + variation * 0.14, attack: 0.001 });
      playNoise({ duration: 0.24, gain: gain * 0.18, pan, frequency: 1450,
        type: 'bandpass', q: 1.15, rate: 0.88 + variation * 0.10,
        buffer: crackleBuffer, delay: 0.012, attack: 0.002 });
      playTone({ from: 1280, to: 145, duration: 0.38, gain: gain * 0.18, pan,
        wave: 'sawtooth', attack: 0.003 });
      playTone({ from: 168, to: 46, duration: 0.42, gain: gain * 0.15, pan,
        wave: 'sine', delay: 0.018, attack: 0.005 });
    } else if (type === SOUND_EVENT.SPAWN_BREACH) {
      // A slow spatial tear announces the portal before the creature exists.
      // The climbing body, noisy seam, and final low pull are distinct from the
      // bore cannon's mechanical charge-up.
      playTone({ from: 66, to: 430, duration: 0.90, gain: gain * 0.15, pan,
        wave: 'sawtooth', attack: 0.11 });
      playTone({ from: 285 + variation * 45, to: 1160, duration: 0.82,
        gain: gain * 0.085, pan, wave: 'triangle', delay: 0.055, attack: 0.14 });
      playNoise({ duration: 0.78, gain: gain * 0.14, pan, frequency: 1480,
        type: 'bandpass', q: 1.25, rate: 0.68 + variation * 0.08,
        buffer: crackleBuffer, delay: 0.04, attack: 0.12 });
      playNoise({ duration: 0.24, gain: gain * 0.17, pan, frequency: 2900,
        type: 'highpass', q: 0.48, rate: 1.04 + variation * 0.10,
        delay: 0.69, attack: 0.025 });
      playTone({ from: 124, to: 42, duration: 0.30, gain: gain * 0.14, pan,
        wave: 'sine', delay: 0.67, attack: 0.018 });
    } else if (type === SOUND_EVENT.EXPLOSION) {
      const sampleGain = Math.min(0.46, gain * 0.25);
      if (recordedAssets) {
        playSample({ buffer: recordedAssets.tntDeepExplosion,
          gain: sampleGain, pan, rate: 0.90 + variation * 0.04 });
        playSample({ buffer: recordedAssets.tntDeepBoom,
          gain: sampleGain, pan, rate: 0.88 + variation * 0.04 });
        playSample({ buffer: recordedAssets.tntLargeExplosion,
          gain: sampleGain, pan, rate: 0.91 + variation * 0.04 });
      } else {
        // The first shot can land before recorded assets finish decoding, and a
        // failed asset request must not make the game's central effect silent.
        playNoise({ duration: 0.46, gain: gain * 0.38, pan, frequency: 210,
          type: 'lowpass', q: 0.6, rate: 0.78 + variation * 0.08,
          buffer: brownBuffer, attack: 0.003 });
        playTone({ from: 118, to: 38, duration: 0.48, gain: gain * 0.23, pan,
          wave: 'sine', delay: 0.006, attack: 0.003 });
      }
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
        holdMovementVoice('lava', strength, spatial, { volume: 0.13,
          rate: 0.88 + variation * 0.16, hold: 0.38, attack: 0.11, release: 0.34 });
      } else {
        holdMovementVoice('water', strength, spatial, { volume: oil ? 0.085 : 0.115,
          rate: oil ? 0.8 : 0.95 + variation * 0.09, hold: 0.34, attack: 0.09, release: 0.25 });
      }
    } else if (type === SOUND_EVENT.POWDER_MOVE) {
      holdMovementVoice('sand', strength, spatial, { volume: 0.105,
        rate: 0.94 + variation * 0.12, hold: 0.3, attack: 0.085, release: 0.22 });
    } else if (type === SOUND_EVENT.ACID_DISSOLVE) {
      holdMovementVoice('acid', strength, spatial, { volume: 0.07,
        rate: 0.96 + variation * 0.12, hold: 0.42, attack: 0.095, release: 0.3 });
    } else if (type === SOUND_EVENT.CRAFT) {
      playTone({ from: 430, to: 690, duration: 0.09, gain: gain * 0.16, pan, wave: 'square' });
      playTone({ from: 620, to: 880, duration: 0.1, gain: gain * 0.11, pan, wave: 'triangle', delay: 0.06 });
    } else if (type === SOUND_EVENT.BOW) {
      playNoise({ duration: 0.09, gain: gain * 0.18, pan, frequency: 1550, type: 'bandpass', q: 1.1, rate: 1.35 });
      playTone({ from: 240, to: 115, duration: 0.13, gain: gain * 0.13, pan, wave: 'triangle' });
    } else if (type === SOUND_EVENT.ARROW_HIT) {
      playNoise({ duration: 0.12, gain: gain * 0.3, pan, frequency: 1150, type: 'bandpass', q: 0.8, rate: 1.1 });
    } else if (type === SOUND_EVENT.DEATH) {
      playTone({ from: 210, to: 58, duration: 0.5, gain: gain * 0.25, pan, wave: 'sawtooth' });
    } else if (type === SOUND_EVENT.RESPAWN) {
      playTone({ from: 210, to: 520, duration: 0.24, gain: gain * 0.18, pan, wave: 'triangle' });
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
    context = master = effectsBus = ambienceBus = ambienceVoices = movementVoices = recordedAssets = null;
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
