// Locally bundled recordings for foley, ambience, and weapon effects.
// URLs are resolved by Vite in the site build and inlined by the standalone
// embed build. Node tests can still import the audio mixer without loading them.

import { CREATURE_BANK_URLS } from './creatureBank.generated.js';
import { RECORDED_BANK_URLS } from './recordedBank.generated.js';

export const AUDIO_ASSET_URLS = Object.freeze({
  ...RECORDED_BANK_URLS,
  ...CREATURE_BANK_URLS,
  sandFlow: new URL('./assets/sand-flow.wav', import.meta.url).href,
  waterFlow: new URL('./assets/water-flow.wav', import.meta.url).href,
  blastGunReport: new URL('./assets/blast-gun-report.mp3', import.meta.url).href,
  minigunBurst: new URL('./assets/minigun-burst.mp3', import.meta.url).href,
  weaponAction: new URL('./assets/weapon-action.mp3', import.meta.url).href,
});

// Preserve the source effect's broadband attack and rolling tail in one
// peak-normalized buffer; each detonation needs one AudioBufferSource.
export const TNT_EXPLOSION_LAYERS = Object.freeze([
  Object.freeze({ asset: 'explosionBurst', rate: 1, gain: 1, delay: 0, decay: 8 }),
]);

export async function loadAudioAssets(context) {
  const entries = await Promise.all(Object.entries(AUDIO_ASSET_URLS)
    .map(async ([key, url]) => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return [key, await context.decodeAudioData(await response.arrayBuffer())];
      } catch (error) {
        // A failed recording must not discard the rest of the sound bank.
        console.warn(`[sand audio] ${key} unavailable`, error);
        return [key, null];
      }
    }));
  return Object.fromEntries(entries);
}
