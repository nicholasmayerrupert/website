// Recorded source material for continuous movement beds and TNT transients.
// URLs are resolved by Vite in the site build and inlined by the standalone
// embed build. Node tests can still import the audio mixer without loading them.

export const AUDIO_ASSET_URLS = Object.freeze({
  sandFlow: new URL('./assets/sand-flow.wav', import.meta.url).href,
  waterFlow: new URL('./assets/water-flow.wav', import.meta.url).href,
  tntDeepExplosion: new URL('./assets/tnt-deep-explosion.mp3', import.meta.url).href,
  tntDeepBoom: new URL('./assets/tnt-deep-boom.mp3', import.meta.url).href,
  tntLargeExplosion: new URL('./assets/tnt-large-explosion.mp3', import.meta.url).href,
  blastGunReport: new URL('./assets/blast-gun-report.mp3', import.meta.url).href,
  minigunBurst: new URL('./assets/minigun-burst.mp3', import.meta.url).href,
  weaponAction: new URL('./assets/weapon-action.mp3', import.meta.url).href,
});

// These three recordings are one TNT effect, not interchangeable variants.
// The mixer stages the initial crack, pressure body, and trailing rumble into
// one buffer so each detonation needs only one AudioBufferSource.
export const TNT_EXPLOSION_LAYERS = Object.freeze([
  Object.freeze({ asset: 'tntDeepExplosion', rate: 0.94, gain: 0.65, delay: 0.012, decay: 1.1 }),
  Object.freeze({ asset: 'tntDeepBoom', rate: 0.84, gain: 0.90, delay: 0.032, decay: 1.4 }),
  Object.freeze({ asset: 'tntLargeExplosion', rate: 1.04, gain: 0.80, delay: 0, decay: 0.65 }),
]);

export async function loadAudioAssets(context) {
  const entries = await Promise.all(Object.entries(AUDIO_ASSET_URLS).map(async ([key, url]) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`audio asset ${key} failed: ${response.status}`);
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    return [key, buffer];
  }));
  return Object.fromEntries(entries);
}
