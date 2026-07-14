// Recorded source material for continuous movement beds and TNT transients.
// URLs are resolved by Vite in the site build and inlined by the standalone
// embed build. Node tests can still import the audio mixer without loading them.

const ASSET_URLS = Object.freeze({
  sandFlow: new URL('./assets/sand-flow.wav', import.meta.url).href,
  waterFlow: new URL('./assets/water-flow.wav', import.meta.url).href,
  tntFirework: new URL('./assets/tnt-firework.mp3', import.meta.url).href,
  tntSlam: new URL('./assets/tnt-slam.mp3', import.meta.url).href,
  tntDeep: new URL('./assets/tnt-deep.mp3', import.meta.url).href,
});

export async function loadAudioAssets(context) {
  const entries = await Promise.all(Object.entries(ASSET_URLS).map(async ([key, url]) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`audio asset ${key} failed: ${response.status}`);
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    return [key, buffer];
  }));
  return Object.fromEntries(entries);
}

