import {
  PLANET_BY_NAME, PLANET_COUNT,
} from '../wasmBridge/abi.generated.js';

export function resolvePlanetId(planet = 'earth') {
  if (typeof planet === 'number') {
    if (Number.isInteger(planet) && planet >= 0 && planet < PLANET_COUNT) return planet;
    throw new RangeError(`unknown planet id ${planet}`);
  }
  const name = String(planet).toLowerCase();
  if (Object.hasOwn(PLANET_BY_NAME, name)) return PLANET_BY_NAME[name];
  throw new RangeError(`unknown planet "${planet}"`);
}
