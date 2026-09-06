// Render the production mixer with real decoded recordings and Web Audio nodes.
import { chromium } from 'playwright';
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
    window.AudioContext = function () { return ctx; };
    const mixer = createSandAudio();
    mixer.setMuted(false);
    await mixer.unlock();
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
} finally { await browser?.close(); server.close(); }
