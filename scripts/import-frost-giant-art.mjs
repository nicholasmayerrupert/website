import { importCreatureArt } from './import-creature-art.mjs';

// The manifest maps breath, smash, and spear to three equal attack segments.
export async function importFrostGiantArt() {
  return (await importCreatureArt(['FROST_GIANT'])).FROST_GIANT;
}
