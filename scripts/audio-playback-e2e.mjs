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
    const { AUDIO_ASSET_URLS } = await import('/src/sand/audio/audioAssets.js');
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
    ctx.createOscillator = () => { throw new Error('Game audio must use recordings'); };
    let contextCreations = 0;
    window.AudioContext = function () { contextCreations++; return ctx; };
    const mixer = createSandAudio();
    mixer.setMuted(false);
    mixer.prepare();
    if (contextCreations !== 1 || mixer.ready)
      throw new Error('Audio preparation must build the locked mixer');
    await mixer.assetsReady;
    const preparedSources = sources.length;
    await mixer.unlock();
    if (contextCreations !== 1 || sources.length !== preparedSources)
      throw new Error('Gesture recreated the prepared audio mixer');
    const assetCount = Object.keys(AUDIO_ASSET_URLS).length;
    if (decoded !== assetCount) throw new Error(`Only ${decoded}/${assetCount} audio assets decoded`);
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
    const { AUDIO_ASSET_URLS } = await import('/src/sand/audio/audioAssets.js');
    const { OFF, SOUND_EVENT, STRIDES } = await import('/src/sand/wasmBridge/abi.generated.js');
    const { MAT } = await import('/src/sand/materials.js');
    const cases = [
      ['sword', SOUND_EVENT.SWING, 1], ['axe', SOUND_EVENT.SWING, 2],
      ['bow', SOUND_EVENT.BOW, 0], ['arrow impact', SOUND_EVENT.ARROW_HIT, MAT.STONE],
      ['blade contact', SOUND_EVENT.MELEE_HIT, 1], ['wand', SOUND_EVENT.RUNE, 1],
      ['frost cast', SOUND_EVENT.RUNE, 2], ['briar cast', SOUND_EVENT.RUNE, 5],
      ['prism choir', SOUND_EVENT.RUNE, 7], ['hollow star', SOUND_EVENT.RUNE, 8],
      ['winterbreath', SOUND_EVENT.RUNE, 10], ['cindermaw', SOUND_EVENT.RUNE, 11],
      ['lava impact', SOUND_EVENT.SPELL_IMPACT, MAT.LAVA],
      ['faultline', SOUND_EVENT.RUNE, 9], ['crystal shatter', SOUND_EVENT.SPELL_IMPACT, MAT.CRYSTAL],
      ['star collapse', SOUND_EVENT.SPELL_IMPACT, MAT.NEUTRONIUM],
      ['heavy strike', SOUND_EVENT.HEAVY_IMPACT, MAT.STONE],
      ['fire impact', SOUND_EVENT.SPELL_IMPACT, MAT.FIRE],
      ['water impact', SOUND_EVENT.SPELL_IMPACT, MAT.WATER],
      ['acid impact', SOUND_EVENT.SPELL_IMPACT, MAT.ACID],
      ['shockwave', SOUND_EVENT.SHOCKWAVE, MAT.ICE],
      ['jump cloth', SOUND_EVENT.JUMP, MAT.STONE], ['landing', SOUND_EVENT.LAND, MAT.STONE],
      ['wood placement', SOUND_EVENT.PLACE, MAT.WOOD], ['stone break', SOUND_EVENT.BREAK, MAT.STONE],
      ['glass break', SOUND_EVENT.BREAK, MAT.GLASS], ['wood break', SOUND_EVENT.BREAK, MAT.WOOD],
      ['pickup', SOUND_EVENT.PICKUP, MAT.STONE], ['craft', SOUND_EVENT.CRAFT, MAT.WOOD],
      ['hurt', SOUND_EVENT.HURT, 0], ['death', SOUND_EVENT.DEATH, 0],
      ['fox vocal', SOUND_EVENT.CREATURE, 2], ['respawn', SOUND_EVENT.RESPAWN, 0],
      ['blast gun', SOUND_EVENT.BLAST_GUN, 0], ['bore charge', SOUND_EVENT.BORE_CHARGE, 0],
      ['bore fire', SOUND_EVENT.BORE_FIRE, 0], ['acid mortar', SOUND_EVENT.ACID_MORTAR, 0],
      ['cluster launch', SOUND_EVENT.CLUSTER_LAUNCH, 0], ['minigun', SOUND_EVENT.MINIGUN, 0],
      ['shield hit', SOUND_EVENT.SHIELD_HIT, 0], ['shield break', SOUND_EVENT.SHIELD_BREAK, 0],
      ['breach', SOUND_EVENT.SPAWN_BREACH, 0], ['bell', SOUND_EVENT.BELL, 0],
      ['guard', SOUND_EVENT.GUARD, 0], ['beam', SOUND_EVENT.BEAM, 0],
      ['fuse', SOUND_EVENT.FUSE, MAT.TNT],
      ['rigid body thud', SOUND_EVENT.IMPACT, MAT.RIGID],
      ['stone body thud', SOUND_EVENT.IMPACT, MAT.STONE],
      ['wood body thud', SOUND_EVENT.IMPACT, MAT.WOOD],
      ['crystal body thud', SOUND_EVENT.IMPACT, MAT.CRYSTAL],
      ['solid landing thud', SOUND_EVENT.SOLID_LAND, MAT.STONE],
      ['acid dissolve', SOUND_EVENT.ACID_DISSOLVE, MAT.ACID],
      ['TNT explosion', SOUND_EVENT.EXPLOSION, MAT.TNT],
      ['projectile explosion', SOUND_EVENT.WEAPON_EXPLOSION, MAT.TNT],

    ];
    const ctx = new OfflineAudioContext(2, 48000 * (cases.length * 1.5 + 1), 48000);
    const sampleStarts = [];
    const createBufferSource = ctx.createBufferSource.bind(ctx);
    ctx.createBufferSource = () => {
      const source = createBufferSource();
      const start = source.start.bind(source);
      source.start = (...args) => {
        sampleStarts.push({ source, duration: args[2] });
        start(...args);
      };
      return source;
    };
    let decoded = 0;
    const decode = ctx.decodeAudioData.bind(ctx);
    ctx.decodeAudioData = async (...args) => { const buffer = await decode(...args); decoded++; return buffer; };
    Object.defineProperty(ctx, 'state', { get: () => 'running' });
    ctx.close = async () => {};
    let oscillators = 0;
    const createOscillator = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => { oscillators++; return createOscillator(); };
    window.AudioContext = function () { return ctx; };
    const mixer = createSandAudio(); mixer.setMuted(false); await mixer.unlock();
    await mixer.assetsReady;
    if (decoded !== Object.keys(AUDIO_ASSET_URLS).length) throw new Error('Combat recordings failed to load');
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
      const before = oscillators;
      const beforeSamples = sampleStarts.length;
      mixer.playEvents(values, { x: 0, y: 0, viewWidth: 100 });
      if (cases[i][1] === SOUND_EVENT.SPELL_IMPACT
          && [MAT.FIRE, MAT.LAVA].includes(cases[i][2])
          && !sampleStarts.slice(beforeSamples).some(({ source, duration }) =>
            !source.loop && source.buffer.duration > 3
            && duration >= source.buffer.duration - .001))
        throw new Error(`${cases[i][0]}: explosion tail was truncated`);
      const thud = [SOUND_EVENT.IMPACT, SOUND_EVENT.SOLID_LAND, SOUND_EVENT.PLACE].includes(cases[i][1]);
      if (oscillators - before !== (thud ? 1 : 0))
        throw new Error(`${cases[i][0]}: incorrect synthesized thud admission`);
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

  await page.route('**/assets/wood1.mp3', route => route.fulfill({ status: 404, body: '' }));
  const lifecycle = await page.evaluate(async () => {
    const { createSandAudio } = await import('/src/sand/audio/sandAudio.js');
    const { loadAudioAssets } = await import('/src/sand/audio/audioAssets.js');
    const { OFF, SOUND_EVENT, STRIDES } = await import('/src/sand/wasmBridge/abi.generated.js');
    const ctx = new OfflineAudioContext(2, 48000 * 10, 48000);
    const assets = await loadAudioAssets(ctx);
    if (assets.wood1 || !assets.wood2 || !assets.bow || assets.piano)
      throw new Error('An asset failure discarded unrelated audio or loaded unwanted music');
    Object.defineProperty(ctx, 'state', { get: () => 'running' });
    ctx.close = async () => {};
    ctx.createOscillator = () => { throw new Error('Score must use a recording'); };
    const sources = [], createSource = ctx.createBufferSource.bind(ctx);
    ctx.createBufferSource = () => { const source = createSource(); sources.push(source); return source; };
    window.AudioContext = function () { return ctx; };
    const mixer = createSandAudio();
    mixer.setMuted(false); await mixer.unlock(); await mixer.assetsReady;
    const jetpack = { id: 1, alive: true, jetpackActive: true, jetpackFuel: 1 };
    mixer.updatePlayerEffects(jetpack);
    const variants = [];
    const pauses = [1, 2, 3, 4, 5, 7].map(time => ctx.suspend(time));
    const rendering = ctx.startRendering();
    for (let i = 0; i < pauses.length; i++) {
      await pauses[i];
      if (i === 0) mixer.setMuted(true);
      if (i === 1) mixer.setMuted(false);
      if (i === 4) mixer.setEnabled(false);
      if (i === 5) mixer.setEnabled(true);
      mixer.updatePlayerEffects(jetpack);
      if (i >= 1 && i <= 3) {
        await new Promise(resolve => setTimeout(resolve, 90));
        const values = new Float32Array(STRIDES.soundEvent);
        values[OFF.soundEvent.type] = SOUND_EVENT.SWING;
        values[OFF.soundEvent.intensity] = 1;
        const before = sources.length;
        mixer.playEvents(values, { x: 0, y: 0, viewWidth: 100 });
        variants.push(sources[before]?.buffer);
      }
      await ctx.resume();
    }
    const rendered = await rendering;
    const rms = (start, end) => {
      const samples = rendered.getChannelData(0).subarray(start * 48000, end * 48000);
      return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    };
    const levels = { effects: rms(.5, 1), muted: rms(1.5, 2), disabled: rms(6, 7), resumed: rms(8, 9) };
    if (levels.effects < .001 || levels.resumed < .001 || levels.muted > 1e-6 || levels.disabled > 1e-6)
      throw new Error(`Mixer lifecycle failed: ${JSON.stringify(levels)}`);
    if (variants.some((buffer, i) => !buffer || (i > 0 && buffer === variants[i - 1])))
      throw new Error('Repeated swings reused the same take consecutively');
    mixer.destroy();
    return levels;
  });
  await page.unroute('**/assets/wood1.mp3');
  console.log('Mixer lifecycle, alternate takes, and partial asset failure passed:', lifecycle);

  await page.addInitScript(() => {
    const NativeContext = window.AudioContext;
    window.__audioProbe = { decoded: 0, effects: 0, oscillators: 0 };
    window.AudioContext = class extends NativeContext {
      async decodeAudioData(...args) {
        const buffer = await super.decodeAudioData(...args);
        window.__audioProbe.decoded++;
        return buffer;
      }
      createBufferSource() {
        const source = super.createBufferSource(), start = source.start.bind(source);
        source.start = (...args) => {
          if (!source.loop) window.__audioProbe.effects++;
          start(...args);
        };
        return source;
      }
      createOscillator() { window.__audioProbe.oscillators++; return super.createOscillator(); }
    };
    localStorage.setItem('sand-audio-muted', '0');
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.baseURL}/game?nosave`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('sand-game')?._game?.getPlayer(), null, { timeout: 60000 });
  await page.waitForFunction(count => window.__audioProbe.decoded >= count, result.decoded);
  await page.locator('sand-game').evaluate(host => host.shadowRoot.querySelector('.sg-sim').focus());
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getAudioState().ready);
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getAudioState().score?.playing);
  await page.evaluate(() => document.querySelector('sand-game')._game.setAudioMuted(true));
  await page.waitForFunction(() => !document.querySelector('sand-game')._game.getAudioState().score?.playing);
  await page.evaluate(() => {
    const game = document.querySelector('sand-game')._game;
    game.setAudioMuted(false); return game.unlockAudio();
  });
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getAudioState().score?.playing);
  // The transition cue uses the same production mixer as authority events.
  await page.evaluate(() => document.querySelector('sand-game')._game.playBeamSound());
  await page.waitForFunction(() => window.__audioProbe.effects > 0);
  const live = await page.evaluate(() => ({ ...window.__audioProbe,
    state: document.querySelector('sand-game')._game.getAudioState() }));
  if (errors.length) throw new Error(`Game audio failed: ${JSON.stringify({ live, errors })}`);
  await page.screenshot({ path: resolve(artifactDir, 'game-audio.png') });
  console.log('/game audio startup passed:', live);
  await page.close();

  const scorePage = await browser.newPage();
  await scorePage.goto(`${server.baseURL}/src/sand/audio/musicDirector.js`);
  await scorePage.mouse.click(20, 20);
  await scorePage.evaluate(async () => {
    const { createMusicDirector } = await import('/src/sand/audio/musicDirector.js');
    const context = new AudioContext();
    await context.resume();
    context.decodeAudioData = () => { throw new Error('Long-form music must stream'); };
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.connect(context.destination);
    const media = [];
    const director = createMusicDirector(context, analyser, { createMedia() {
      const element = new Audio(); media.push(element); return element;
    } });
    const samples = new Float32Array(analyser.fftSize);
    window.__score = { context, director, media, rms() {
      analyser.getFloatTimeDomainData(samples);
      return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    } };
    director.setAudible(true);
  });
  await scorePage.waitForFunction(() => window.__score.director.state.track === 'hearth');
  await scorePage.waitForFunction(() => window.__score.rms() > .001);
  await scorePage.evaluate(() => window.__score.director.update({ threat: true }));
  await scorePage.waitForFunction(() => window.__score.director.state.track === 'embers');
  await scorePage.waitForFunction(() => window.__score.rms() > .001);
  await scorePage.evaluate(() => window.__score.director.update({ threat: true, boss: true }));
  await scorePage.waitForFunction(() => window.__score.director.state.track === 'bell');
  await scorePage.waitForFunction(() => window.__score.rms() > .001);
  await scorePage.evaluate(() => window.__score.director.setAudible(false));
  await scorePage.waitForFunction(() => window.__score.rms() < 1e-7);
  const pausedAt = await scorePage.evaluate(() => window.__score.media.at(-1).currentTime);
  await scorePage.evaluate(() => window.__score.director.setAudible(true));
  await scorePage.waitForFunction(time => window.__score.media.at(-1).currentTime > time + .1, pausedAt);
  await scorePage.waitForFunction(() => window.__score.rms() > .001);
  const music = await scorePage.evaluate(async () => {
    const { director, context, media, rms } = window.__score;
    const result = { ...director.state, rms: rms(), streamsCreated: media.length };
    director.destroy();
    if (media.some(element => !element.paused || element.getAttribute('src')))
      throw new Error('Destroyed music retained a media stream');
    await context.close();
    return result;
  });
  console.log('Original exploration/combat/boss music streaming and lifecycle passed:', music);
} finally { await browser?.close(); server.close(); }
