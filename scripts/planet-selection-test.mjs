import {
  PLANET, PLANET_GAMEPLAY_FLAG, planetHasGameplayFlag,
} from '../src/sand/wasmBridge/abi.generated.js';
import { resolvePlanetId } from '../src/sand/game/planetSelection.js';
import { applyCreatureRuntimePolicy } from '../src/sand/game/creatureRuntimePolicy.js';
import { recoveryBeamIsActive } from '../src/sand/embed/talkHud.js';
import { makeChecker } from './sand-test-util.mjs';

const { check, done } = makeChecker('planet selection');

check('generated planet names resolve case-insensitively',
  resolvePlanetId('Moon') === PLANET.MOON);
check('valid numeric planet ids pass through',
  resolvePlanetId(PLANET.MARS) === PLANET.MARS);
check('unknown planet names fail loudly', (() => {
  try { resolvePlanetId('marz'); } catch (error) { return error instanceof RangeError; }
  return false;
})());
check('unknown numeric planet ids fail loudly', (() => {
  try { resolvePlanetId(999); } catch (error) { return error instanceof RangeError; }
  return false;
})());
check('natural-spawn capability matches the inhabited-world contract',
  [PLANET.EARTH, PLANET.MOON, PLANET.MARS].every((planet) =>
    planetHasGameplayFlag(planet, PLANET_GAMEPLAY_FLAG.NATURAL_SPAWNS))
    && !planetHasGameplayFlag(PLANET.SHIP, PLANET_GAMEPLAY_FLAG.NATURAL_SPAWNS));
check('ship gameplay capabilities are generated from one descriptor',
  [
    PLANET_GAMEPLAY_FLAG.PROTECTED_CREW,
    PLANET_GAMEPLAY_FLAG.FRAME_ANCHOR,
    PLANET_GAMEPLAY_FLAG.VOID_RECOVERY,
    PLANET_GAMEPLAY_FLAG.SCRIPTED_CREW,
  ].every((flag) => planetHasGameplayFlag(PLANET.SHIP, flag)));
check('village residents stay scoped to Earth',
  planetHasGameplayFlag(PLANET.EARTH, PLANET_GAMEPLAY_FLAG.VILLAGE_RESIDENTS)
    && [PLANET.MOON, PLANET.MARS, PLANET.SHIP].every((planet) =>
      !planetHasGameplayFlag(planet, PLANET_GAMEPLAY_FLAG.VILLAGE_RESIDENTS)));
const fixtureRecoveryPlanet = 77;
const fixtureGameplayFlag = (planetId, flag) =>
  planetId === fixtureRecoveryPlanet
    && flag === PLANET_GAMEPLAY_FLAG.VOID_RECOVERY;
check('recovery presentation follows reusable planet capability metadata',
  recoveryBeamIsActive(fixtureRecoveryPlanet, 49, fixtureGameplayFlag)
    && !recoveryBeamIsActive(PLANET.SHIP, 49, fixtureGameplayFlag)
    && !recoveryBeamIsActive(fixtureRecoveryPlanet, 48, fixtureGameplayFlag));
const runtimeCalls = [];
applyCreatureRuntimePolicy({
  survival: true,
  debugHitboxes: false,
  planetId: PLANET.SHIP,
  creativeKind: 0,
  creatureSimulationRequested: false,
  worldWorker: null,
}, {
  setCreatureRuntime: (...args) => runtimeCalls.push(args),
});
check('ship survival simulates authored creatures without natural population',
  runtimeCalls.length === 1
    && runtimeCalls[0][0] === true
    && runtimeCalls[0][1] === false);

const failures = done();
process.exit(failures ? 1 : 0);
