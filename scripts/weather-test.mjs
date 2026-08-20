// Weather presentation profiles and deterministic authority effects.
/* global process */

import {
  MAT,
  PLANET,
  WEATHER,
  createEngineWasm,
  initSandWasm,
} from '../src/sand/wasmBridge/engineFactory.js';
import { sampleDayNight } from '../src/sand/game/dayNightCycle.js';
import { createEngineLifecycle } from '../src/sand/game/engineLifecycle.js';
import { paletteForPhase } from '../src/sand/game/parallaxBackground.js';
import {
  DEFAULT_WEATHER_ID,
  applyWeatherToPalette,
  getWeatherProfile,
  resolveWeatherId,
  resolveWeatherIdForPlanet,
  weatherSkyLight,
} from '../src/sand/game/weather.js';
import { gridHash, makeChecker } from './sand-test-util.mjs';

const { check, done } = makeChecker('weather');
const SKY_FIELDS = ['skyTop', 'skyMid', 'skyGlow', 'skyLow'];
const CLOUD_FIELDS = ['cloudDark', 'cloudLight'];
const LANDSCAPE_FIELDS = ['ridgeFar', 'ridgeMid', 'ridgeNear', 'ridgeDeep'];

check('clear is the stable default and malformed values fall back to it',
  DEFAULT_WEATHER_ID === WEATHER.CLEAR
    && resolveWeatherId() === WEATHER.CLEAR
    && resolveWeatherId('rain') === WEATHER.RAIN
    && resolveWeatherId(String(WEATHER.RAIN)) === WEATHER.RAIN
    && resolveWeatherId('storm') === WEATHER.CLEAR
    && resolveWeatherId(99) === WEATHER.CLEAR);
check('rain normalizes to clear on unsupported planets',
  resolveWeatherIdForPlanet(WEATHER.RAIN, PLANET.EARTH) === WEATHER.RAIN
    && resolveWeatherIdForPlanet(WEATHER.RAIN, PLANET.MARS) === WEATHER.CLEAR);

const clearProfile = getWeatherProfile(WEATHER.CLEAR);
const rainProfile = getWeatherProfile(WEATHER.RAIN);
check('rain is a denser cloud profile with precipitation',
  rainProfile.cloudCounts[0] > clearProfile.cloudCounts[0]
    && rainProfile.cloudCounts[1] > clearProfile.cloudCounts[1]
    && rainProfile.precipitation?.kind === 'rain');

const noonPalette = paletteForPhase(0.5);
const rainyPalette = applyWeatherToPalette(noonPalette, WEATHER.RAIN);
check('rain changes every sky and cloud color',
  [...SKY_FIELDS, ...CLOUD_FIELDS].every(
    (field) => rainyPalette[field] !== noonPalette[field],
  ));
check('rain leaves the landscape palette untouched',
  LANDSCAPE_FIELDS.every((field) => rainyPalette[field] === noonPalette[field]));
check('clear returns the unmodified day/night palette',
  applyWeatherToPalette(noonPalette, WEATHER.CLEAR) === noonPalette);

const noon = sampleDayNight(0.5).skyLight;
const midnight = sampleDayNight(0).skyLight;
const rainyNoon = weatherSkyLight(noon, WEATHER.RAIN);
const rainyMidnight = weatherSkyLight(midnight, WEATHER.RAIN);
check('rain slightly reduces day and night skylight on four-point steps',
  rainyNoon < noon && rainyMidnight < midnight
    && rainyNoon % 4 === 0 && rainyMidnight % 4 === 0
    && weatherSkyLight(noon, WEATHER.CLEAR) === noon);

const presentationCalls = [];
const fakePresentationEngine = {
  getCam: () => ({ x: 4, y: 5 }),
  getWorldOffsetX: () => 10,
  getWorldOffsetY: () => 20,
  setWeather: (value) => presentationCalls.push(['weather', value]),
  setSkyLight: (value) => presentationCalls.push(['light', value]),
};
const fakePresentationContext = {
  canvas: {},
  container: {},
  parallax: {
    draw: (value) => presentationCalls.push(['parallax', value.weatherId]),
  },
  engine: fakePresentationEngine,
  cols: 64,
  rows: 48,
  localPlayerId: 0,
  dayNight: sampleDayNight(0.5),
  dayVisualKey: 0,
  weatherId: WEATHER.RAIN,
  weatherVisualKey: 0,
  viewCols: 32,
  bgZoomScale: () => 1,
  appliedSkyLight: noon,
  forceFullRender: false,
};
createEngineLifecycle(fakePresentationContext, {})
  .rebuildEngineForDims(64, 48);
check('same-size replay immediately reapplies presentation weather',
  presentationCalls.some(([kind, value]) => kind === 'weather' && value === WEATHER.RAIN)
    && presentationCalls.some(
      ([kind, value]) => kind === 'light' && value === rainyNoon,
    )
    && presentationCalls.some(
      ([kind, value]) => kind === 'parallax' && value === WEATHER.RAIN,
    )
    && fakePresentationContext.appliedSkyLight === rainyNoon
    && fakePresentationContext.forceFullRender);

await initSandWasm();

const WORLD = Object.freeze({
  cols: 256,
  rows: 224,
  worldSeed: 0x7a11cafe,
  sinksOn: false,
  infinite: true,
});
const VIEW_COLS = 128;
const VIEW_ROWS = 96;
const TURNS = 64;

function countMaterial(grid, material) {
  let count = 0;
  for (const cell of grid) if (cell === material) count++;
  return count;
}

function runScenario({
  weatherId,
  underground = false,
  planetId = PLANET.EARTH,
  backgroundEnabled = true,
}) {
  const engine = createEngineWasm({ ...WORLD, planetId });
  engine.setBgEnabled(backgroundEnabled);
  engine.setViewport(1, 1, VIEW_COLS, VIEW_ROWS);
  engine.cameraSet(
    (WORLD.cols - VIEW_COLS) / 2,
    underground ? WORLD.rows - VIEW_ROWS : 0,
  );
  if (weatherId !== undefined) engine.setWeather(weatherId);
  const initialWater = countMaterial(engine.getGrid(), MAT.WATER);
  const initialBackgroundHash = gridHash(engine.getGridBg());
  for (let turn = 0; turn < TURNS; turn++) {
    engine.stepActors();
    engine.stepWorld();
  }
  const result = {
    weatherId: engine.getWeather(),
    hash: engine.gridHash(),
    foregroundHash: gridHash(engine.getGrid()),
    backgroundHash: gridHash(engine.getGridBg()),
    initialBackgroundHash,
    water: countMaterial(engine.getGrid(), MAT.WATER),
    initialWater,
  };
  engine.destroy();
  return result;
}

const defaultClear = runScenario({});
const explicitClear = runScenario({ weatherId: WEATHER.CLEAR });
check('default and explicit clear preserve identical simulation output',
  defaultClear.weatherId === WEATHER.CLEAR
    && JSON.stringify(defaultClear) === JSON.stringify(explicitClear));

const rainA = runScenario({ weatherId: WEATHER.RAIN });
const rainB = runScenario({ weatherId: WEATHER.RAIN });
const addedWater = rainA.water - explicitClear.water;
check('rain deterministically adds a bounded amount of foreground water',
  rainA.weatherId === WEATHER.RAIN
    && addedWater > 0 && addedWater <= Math.ceil(TURNS / 4));
check('equal rain worlds remain byte-deterministic',
  JSON.stringify(rainA) === JSON.stringify(rainB));
const foregroundOnlyRain = runScenario({
  weatherId: WEATHER.RAIN,
  backgroundEnabled: false,
});
check('rain injection does not write to a disabled background layer',
  foregroundOnlyRain.backgroundHash === foregroundOnlyRain.initialBackgroundHash);

function runRoofScenario(weatherId) {
  const cols = 128;
  const rows = 96;
  const cameraX = 32;
  const engine = createEngineWasm({
    cols,
    rows,
    worldSeed: WORLD.worldSeed,
    sinksOn: false,
  });
  engine.setBgEnabled(false);
  engine.setViewport(1, 1, 64, 48);
  engine.cameraSet(cameraX, 0);
  const grid = engine.getGrid();
  for (let x = cameraX; x < cameraX + 64; x++) {
    // The bounded source targets row 2. This inert row-1 canopy is inspected by
    // WeatherSystem before the world scheduler and needs no topology setup.
    grid[cols + x] = MAT.SAND;
  }
  engine.resetSimulationActivity();
  engine.setWeather(weatherId);
  for (let tick = 0; tick < 4; tick++) engine.stepActors();
  engine.stepWorld();
  const result = {
    hash: engine.gridHash(),
    water: countMaterial(engine.getGrid(), MAT.WATER),
  };
  engine.destroy();
  return result;
}

const roofClear = runRoofScenario(WEATHER.CLEAR);
const roofRain = runRoofScenario(WEATHER.RAIN);
check('current solid overhead geometry blocks the rain source',
  JSON.stringify(roofRain) === JSON.stringify(roofClear),
  `${roofClear.water}/${roofClear.hash} vs ${roofRain.water}/${roofRain.hash}`);

function runBoundedScenario(weatherId) {
  const engine = createEngineWasm({
    cols: 128,
    rows: 96,
    worldSeed: WORLD.worldSeed,
    sinksOn: false,
  });
  engine.setBgEnabled(false);
  engine.setViewport(1, 1, 64, 48);
  engine.cameraSet(32, 0);
  engine.setWeather(weatherId);
  for (let tick = 0; tick < 4; tick++) engine.stepActors();
  engine.stepWorld();
  const result = {
    hash: engine.gridHash(),
    water: countMaterial(engine.getGrid(), MAT.WATER),
  };
  engine.destroy();
  return result;
}

const boundedClear = runBoundedScenario(WEATHER.CLEAR);
const boundedRainA = runBoundedScenario(WEATHER.RAIN);
const boundedRainB = runBoundedScenario(WEATHER.RAIN);
check('bounded engines receive deterministic rain at their visible sky edge',
  boundedRainA.water === boundedClear.water + 1
    && boundedRainA.hash !== boundedClear.hash
    && JSON.stringify(boundedRainA) === JSON.stringify(boundedRainB));

const undergroundClear = runScenario({
  weatherId: WEATHER.CLEAR,
  underground: true,
});
const undergroundRain = runScenario({
  weatherId: WEATHER.RAIN,
  underground: true,
});
check('an underground viewport does not inject rain at the buffer edge',
  undergroundRain.hash === undergroundClear.hash
    && undergroundRain.water === undergroundClear.water);

const marsClear = runScenario({
  weatherId: WEATHER.CLEAR,
  planetId: PLANET.MARS,
});
const marsRain = runScenario({
  weatherId: WEATHER.RAIN,
  planetId: PLANET.MARS,
});
check('Earth rain does not inject water on unsupported planets',
  marsRain.hash === marsClear.hash && marsRain.water === marsClear.water);

const failures = done();
process.exit(failures === 0 ? 0 : 1);
