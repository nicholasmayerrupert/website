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

export async function loadAudioAssets(context) {
  const entries = await Promise.all(Object.entries(AUDIO_ASSET_URLS).map(async ([key, url]) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`audio asset ${key} failed: ${response.status}`);
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    return [key, buffer];
  }));
  return Object.fromEntries(entries);
}
