// Render the production mixer with real decoded recordings and Web Audio nodes.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { startTestServer } from './browser-harness.mjs';
const server = await startTestServer();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${server.baseURL}/src/sand/audio/audioAssets.js`);
  const result = await page.evaluate(async () => {
    const { createSandAudio } = await import('/src/sand/audio/sandAudio.js');
    const { OFF, SOUND_EVENT, STRIDES } = await import('/src/sand/wasmBridge/abi.generated.js');
    let failedClosed = false;
    window.AudioContext = function () { return {
      createGain() { throw new Error('Graph creation requires activation'); },
      close() { failedClosed = true; },
    }; };
    const prepared = createSandAudio();
    prepared.setMuted(false);
    prepared.prepare();
    if (!failedClosed || prepared.ready) throw new Error('Failed preparation retained its context');
    const silentContext = new OfflineAudioContext(2, 4800, 48000);
    Object.defineProperty(silentContext, 'state', { get: () => 'running' });
    silentContext.close = async () => {};
    window.AudioContext = function () { return silentContext; };
    prepared.prepare();
    if (prepared.ready) throw new Error('Prepared audio must wait for unlock');
    const silence = await silentContext.startRendering();
    prepared.destroy();
    if ([0, 1].some(channel => silence.getChannelData(channel).some(value => value !== 0)))
      throw new Error('Prepared mixer emitted audio before unlock');
    const ctx = new OfflineAudioContext(2, 48000 * 5, 48000);
    const originalCreateSource = ctx.createBufferSource.bind(ctx);
    const sources = [];
    let decoded = 0;
    const originalDecode = ctx.decodeAudioData.bind(ctx);
    ctx.decodeAudioData = async (...args) => {
      const buffer = await originalDecode(...args);
      decoded++;
      return buffer;
    };
    ctx.createBufferSource = () => {
      const source = originalCreateSource();
      const info = { source, starts: 0, stops: 0, startAt: 0, stopAt: Infinity };
      sources.push(info);
      const start = source.start.bind(source), stop = source.stop.bind(source);
      source.start = (...args) => { info.starts++; info.startAt = args[0]; start(...args); };
      source.stop = (...args) => { info.stops++; info.stopAt = args[0]; stop(...args); };
      return source;
    };
    Object.defineProperty(ctx, 'state', { get: () => 'running' });
    ctx.close = async () => {};
    let contextCreations = 0;
    window.AudioContext = function () { contextCreations++; return ctx; };
    const mixer = createSandAudio();
    mixer.setMuted(false);
    mixer.prepare();
    if (contextCreations !== 1 || sources.length === 0 || mixer.ready)
      throw new Error('Audio preparation must build the locked mixer');
    const preparedSources = sources.length;
    await mixer.unlock();
    if (contextCreations !== 1 || sources.length !== preparedSources)
      throw new Error('Gesture recreated the prepared audio mixer');
    const deadline = performance.now() + 10000;
    while (decoded < 8 && performance.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 20));
    if (decoded !== 8) throw new Error(`Only ${decoded} audio assets decoded`);
    await new Promise(resolve => setTimeout(resolve, 20));
    const listener = { x: 0, y: 0, viewWidth: 100 };
    const event = (type, x = 0, strength = 1) => {
      const values = new Float32Array(STRIDES.soundEvent);
      values[OFF.soundEvent.type] = type;
      values[OFF.soundEvent.x] = x;
      values[OFF.soundEvent.intensity] = strength;
      return values;
    };
    const initial = sources.length;
    mixer.playEvents(event(SOUND_EVENT.WEAPON_EXPLOSION, -15), listener);
    const first = sources.at(-1);
    if (sources.length !== initial + 1 || first.starts !== 1) throw new Error('Missing explosion onset');
    const paused = ctx.suspend(1);
    const rendering = ctx.startRendering();
    await paused;
    const beforeTerrain = sources.length;
    const terrain = new Float32Array(STRIDES.soundEvent * 3);
    terrain.set(event(SOUND_EVENT.EXPLOSION, -40), 0);
    terrain.set(event(SOUND_EVENT.EXPLOSION, -38), STRIDES.soundEvent);
    terrain.set(event(SOUND_EVENT.EXPLOSION, 40), STRIDES.soundEvent * 2);
    mixer.playEvents(terrain, listener);
    if (sources.length !== beforeTerrain + 2) throw new Error('Terrain regional admission failed');
    const beforeVolley = sources.length;
    const volley = new Float32Array(STRIDES.soundEvent * 24);
    for (let i = 0; i < 24; i++) volley.set(event(SOUND_EVENT.WEAPON_EXPLOSION, 15, 1.5), i * STRIDES.soundEvent);
    mixer.playEvents(volley, listener);
    if (sources.length !== beforeVolley + 24) throw new Error('Volley lost an onset');
    const retired = sources.filter(info => !info.source.loop && info.stops > 0).length;
    if (retired < 4) throw new Error('Dense volley did not retire old tails');
    if (sources.some(info => info.stops && info.stopAt - info.startAt < 0.14))
      throw new Error('Tail retirement cut off a fresh onset');
    const rates = new Set(sources.slice(beforeVolley).map(info => info.source.playbackRate.value));
    if (rates.size < 20) throw new Error('Repeated blasts have identical pitch');
    mixer.setMuted(true);
    const beforeMuted = sources.length;
    mixer.playEvents(event(SOUND_EVENT.WEAPON_EXPLOSION), listener);
    if (sources.length !== beforeMuted) throw new Error('Muted event created a voice');
    mixer.setMuted(false);
    await ctx.resume();
    const rendered = await rendering;
    const channels = [rendered.getChannelData(0), rendered.getChannelData(1)];
    let peak = 0, clipped = 0, sum = 0;
    for (const samples of channels) for (const sample of samples) {
      if (!Number.isFinite(sample)) throw new Error('Non-finite rendered audio');
      peak = Math.max(peak, Math.abs(sample));
      if (Math.abs(sample) >= 1) clipped++;
      sum += sample * sample;
    }
    if (peak < 0.05 || clipped) throw new Error(`Invalid mix: peak=${peak}, clipped=${clipped}`);
    mixer.destroy();
    return { peak, clipped, rms: Math.sqrt(sum / (rendered.length * 2)), decoded,
      volleyOnsets: 24, retired, distinctRates: rates.size };
  });
  console.log('Audio playback passed:', result);
  const combat = await page.evaluate(async () => {
    const { createSandAudio } = await import('/src/sand/audio/sandAudio.js');
    const { OFF, SOUND_EVENT, STRIDES } = await import('/src/sand/wasmBridge/abi.generated.js');
    const { MAT } = await import('/src/sand/materials.js');
    const cases = [
      ['sword', SOUND_EVENT.SWING, 1], ['axe', SOUND_EVENT.SWING, 2],
      ['bow', SOUND_EVENT.BOW, 0], ['arrow impact', SOUND_EVENT.ARROW_HIT, MAT.STONE],
      ['blade contact', SOUND_EVENT.MELEE_HIT, 1], ['wand', SOUND_EVENT.RUNE, 1],
      ['frost cast', SOUND_EVENT.RUNE, 2], ['briar cast', SOUND_EVENT.RUNE, 5],
      ['prism choir', SOUND_EVENT.RUNE, 7], ['hollow star', SOUND_EVENT.RUNE, 8],
      ['faultline', SOUND_EVENT.RUNE, 9], ['crystal shatter', SOUND_EVENT.SPELL_IMPACT, MAT.CRYSTAL],
      ['star collapse', SOUND_EVENT.SPELL_IMPACT, MAT.NEUTRONIUM],
      ['heavy strike', SOUND_EVENT.HEAVY_IMPACT, MAT.STONE],
      ['fire impact', SOUND_EVENT.SPELL_IMPACT, MAT.FIRE],
      ['water impact', SOUND_EVENT.SPELL_IMPACT, MAT.WATER],
      ['acid impact', SOUND_EVENT.SPELL_IMPACT, MAT.ACID],
      ['shockwave', SOUND_EVENT.SHOCKWAVE, MAT.ICE],
    ];
    const ctx = new OfflineAudioContext(2, 48000 * (cases.length * 1.5 + 1), 48000);
    let decoded = 0;
    const decode = ctx.decodeAudioData.bind(ctx);
    ctx.decodeAudioData = async (...args) => { const buffer = await decode(...args); decoded++; return buffer; };
    Object.defineProperty(ctx, 'state', { get: () => 'running' });
    ctx.close = async () => {};
    window.AudioContext = function () { return ctx; };
    const mixer = createSandAudio(); mixer.setMuted(false); await mixer.unlock();
    const deadline = performance.now() + 10000;
    while (decoded < 8 && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    if (decoded !== 8) throw new Error('Combat recordings failed to load');
    const pauses = cases.map((_, i) => ctx.suspend(.2 + i * 1.5));
    const rendering = ctx.startRendering();
    for (let i = 0; i < cases.length; i++) {
      await pauses[i];
      // Event admission uses wall time even when the audio graph renders offline.
      await new Promise(resolve => setTimeout(resolve, 90));
      const values = new Float32Array(STRIDES.soundEvent);
      values[OFF.soundEvent.type] = cases[i][1];
      values[OFF.soundEvent.material] = cases[i][2];
      values[OFF.soundEvent.intensity] = 1;
      mixer.playEvents(values, { x: 0, y: 0, viewWidth: 100 });
      await ctx.resume();
    }
    const rendered = await rendering;
    const left = rendered.getChannelData(0), right = rendered.getChannelData(1);
    const levels = cases.map(([name], i) => {
      const start = Math.floor((.2 + i * 1.5) * 48000);
      let peak = 0, sum = 0;
      for (let j = start; j < start + 48000; j++) {
        if (!Number.isFinite(left[j]) || !Number.isFinite(right[j])) throw new Error(`${name}: non-finite audio`);
        peak = Math.max(peak, Math.abs(left[j]), Math.abs(right[j])); sum += left[j] ** 2 + right[j] ** 2;
      }
      if (peak < .025 || peak >= 1) throw new Error(`${name}: silent or clipped (${peak})`);
      return { name, peak, rms: Math.sqrt(sum / 96000) };
    });
    const pcm = new Uint8Array(rendered.length * 4), view = new DataView(pcm.buffer);
    for (let i = 0; i < rendered.length; i++) {
      view.setInt16(i * 4, Math.round(left[i] * 32767), true);
      view.setInt16(i * 4 + 2, Math.round(right[i] * 32767), true);
    }
    let binary = '';
    for (let i = 0; i < pcm.length; i += 8192) binary += String.fromCharCode(...pcm.subarray(i, i + 8192));
    mixer.destroy();
    return { levels, pcm: btoa(binary) };
  });
  const artifactDir = process.env.SAND_TEST_ARTIFACTS || resolve('.sand-artifacts/audio');
  mkdirSync(artifactDir, { recursive: true });
  const pcm = Buffer.from(combat.pcm, 'base64'), header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(48000, 24); header.writeUInt32LE(192000, 28);
  header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  writeFileSync(resolve(artifactDir, 'combat-audio.wav'), Buffer.concat([header, pcm]));
  writeFileSync(resolve(artifactDir, 'combat-audio.json'), JSON.stringify(combat.levels, null, 2));
  console.log('Combat playback passed:', combat.levels);
} finally { await browser?.close(); server.close(); }
