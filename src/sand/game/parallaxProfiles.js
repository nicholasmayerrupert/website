import {
  BIOME, BIOME_FAMILY, CAVE_BIOME,
  PLANET_PRESENTATION,
} from '../wasmBridge/abi.generated.js';

const surface = (motif, density, extras = {}) => Object.freeze({
  motif, density, ...extras,
});
const cave = (motif, glow, density) => Object.freeze({
  motif, glow, density,
});

export const SURFACE_BACKDROP_PROFILES = Object.freeze({
  [BIOME.PLAINS]: surface('grass', 0.34),
  [BIOME.FOREST]: surface('pine', 0.88, { landmark: true }),
  [BIOME.DESERT]: surface('cactus', 0.28),
  [BIOME.ROCKY]: surface('spire', 0.38, { snow: 0.24 }),
  [BIOME.TUNDRA]: surface('tundra', 0.42, { snow: 0.92 }),
  [BIOME.JUNGLE]: surface('jungle', 1),
  [BIOME.SWAMP]: surface('reeds', 0.76),
});

export const CAVE_BACKDROP_PROFILES = Object.freeze({
  [CAVE_BIOME.DEFAULT]: cave('rock', '#788392', 0.22),
  [CAVE_BIOME.CRYSTAL]: cave('crystal', '#76dcff', 0.72),
  [CAVE_BIOME.MUSHROOM]: cave('mushroom', '#dc78dd', 0.78),
  [CAVE_BIOME.LUSH]: cave('roots', '#77cf8b', 0.82),
  [CAVE_BIOME.DEEP_MAGMA]: cave('magma', '#ff743c', 0.86),
  [CAVE_BIOME.DEEP_GEODE]: cave('geode', '#a98cff', 0.68),
  [CAVE_BIOME.DEEP_FOSSIL]: cave('fossil', '#d4b277', 0.58),
  [CAVE_BIOME.DEEP_VOID]: cave('void', '#9b63d6', 0.32),
});

export const PLANET_BACKDROP_STYLES = Object.freeze({
  [PLANET_PRESENTATION.EARTH]: Object.freeze({
    key: 'earth', clouds: true, stars: 1, relief: 1,
    caveNear: '#090d13',
  }),
  [PLANET_PRESENTATION.MOON]: Object.freeze({
    key: 'moon', clouds: false, stars: 1, relief: 1.18,
    caveNear: '#080a0f',
  }),
  [PLANET_PRESENTATION.MARS]: Object.freeze({
    key: 'mars', clouds: false, stars: 0.32, relief: 1.12,
    caveNear: '#100b0d',
  }),
  [PLANET_PRESENTATION.SHIP]: Object.freeze({
    key: 'ship', clouds: false, stars: 1, relief: 0,
    caveNear: '#030509',
  }),
});

export function resolveBackdropProfile(presentationProfile, biomeRef) {
  const planet = PLANET_BACKDROP_STYLES[presentationProfile];
  if (!planet) throw new RangeError(`unsupported presentation profile ${presentationProfile}`);
  const table = biomeRef.family === BIOME_FAMILY.CAVE
    ? CAVE_BACKDROP_PROFILES : SURFACE_BACKDROP_PROFILES;
  const biome = table[biomeRef.biome];
  if (!biome) {
    throw new RangeError(
      `missing backdrop profile for biome ${biomeRef.family}:${biomeRef.biome}`,
    );
  }
  return { planet, biome };
}

export function backdropProfilesComplete(surfaceCount, caveCount) {
  return Object.keys(SURFACE_BACKDROP_PROFILES).length === surfaceCount
    && Object.keys(CAVE_BACKDROP_PROFILES).length === caveCount
    && Object.keys(PLANET_BACKDROP_STYLES).length
      === Object.keys(PLANET_PRESENTATION).length;
}
