import { ABI_FINGERPRINT, ABI_VERSION } from '../wasmBridge/abi.generated.js';
import { ENGINE_MAX_CELLS, ENGINE_MAX_DIMENSION } from '../engineLimits.js';
import { DEFAULT_DAY_PHASE, normalizeDayPhase } from './dayNightCycle.js';
import {
  DEFAULT_WEATHER_ID,
  isWeatherId,
  resolveWeatherIdForPlanet,
} from './weather.js';

export const REPLAY_FORMAT = 'sand-input-replay';
export const REPLAY_VERSION = 3;
export const REPLAY_PREFIX = 'SAND-REPLAY-3:';

const LEGACY_REPLAY_VERSION = 2;
const LEGACY_REPLAY_PREFIX = 'SAND-REPLAY-2:';

export const REPLAY_EVENT_TYPES = new Set([
  'control', 'input', 'intent', 'edge', 'config', 'resize', 'weather',
  'day-phase',
  'test-paint-disc', 'test-seed-reaction', 'test-creature-runtime',
  'test-natural-spawn', 'test-step-actors',
]);

export const MAX_REPLAY_TURNS = 2_000_000;
export const MAX_REPLAY_EVENTS = MAX_REPLAY_TURNS * 4;
const MAX_REPLAY_TEXT_BYTES = 64 * 1024 * 1024;
const MAX_REPLAY_EXPANDED_BYTES = 64 * 1024 * 1024;

const OP = Object.freeze({
  CONTROL: 0,
  INPUT: 1,
  INTENT: 2,
  EDGE: 3,
  CONFIG: 4,
  RESIZE: 5,
  TEST_PAINT_DISC: 6,
  TEST_SEED_REACTION: 7,
  TEST_CREATURE_RUNTIME: 8,
  TEST_NATURAL_SPAWN: 9,
  TEST_STEP_ACTORS: 10,
  // Appended so previously packed capsules keep decoding.
  WEATHER: 11,
  DAY_PHASE: 12,
});

const INTENT = Object.freeze({
  select: 0,
  size: 1,
  move: 2,
  pick: 3,
  throw: 4,
  craft: 5,
  respawn: 6,
  add: 7,
  'set-player-state': 8,
  'repair-base': 9,
});
const INTENT_NAMES = Object.freeze(Object.fromEntries(
  Object.entries(INTENT).map(([name, code]) => [code, name]),
));

const CONTROL_FIELDS = Object.freeze([
  'worldX', 'worldY', 'buttons', 'inside', 'drawMode',
  'camWorldX', 'camWorldY', 'viewCols', 'viewRows', 'suspendStreaming',
]);
const CONTROL_BOOLEAN_FIELDS = new Set(['inside', 'drawMode', 'suspendStreaming']);
const INPUT_FIELDS = Object.freeze([
  'bits', 'worldAimX', 'worldAimY', 'tool', 'moveX', 'moveY',
]);
const NO_BOOLEAN_FIELDS = new Set();
const CONFIG_FIELDS = Object.freeze([
  'tool', 'drawMode', 'creativeKind', 'creativeValue', 'creatureNaturalSpawning',
]);
const CONFIG_BOOLEAN_FIELDS = new Set(['drawMode', 'creatureNaturalSpawning']);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function copyReplayValue(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeReplayInit(data) {
  const loadout = Array.isArray(data.loadout) ? data.loadout.slice(0, 16)
    .map((stack) => {
      const normalized = {
        itemKind: stack?.itemKind | 0,
        count: Math.max(0, Math.min(5000, stack?.count | 0)),
      };
      if (hasOwn(stack || {}, 'material')) normalized.material = stack.material | 0;
      return normalized;
    })
    .filter((stack) => stack.count > 0) : [];
  const planetId = data.planetId | 0;
  const init = {
    cols: data.cols | 0,
    rows: data.rows | 0,
    worldSeed: data.worldSeed >>> 0,
    survival: !!data.survival,
    creativeKind: data.creativeKind | 0,
    creativeValue: data.creativeValue | 0,
    tool: data.tool | 0,
    creatureNaturalSpawning: !!data.creatureNaturalSpawning,
    planetId,
    weatherId: resolveWeatherIdForPlanet(
      data.weatherId ?? DEFAULT_WEATHER_ID,
      planetId,
    ),
    dayPhase: normalizeDayPhase(data.dayPhase ?? DEFAULT_DAY_PHASE),
    dayOverridden: !!data.dayOverridden,
    gravityScale: Number(data.gravityScale),
    missionId: data.missionId | 0,
    loadout,
    drawMode: !!data.drawMode,
  };
  return init;
}

function normalizeReplayInput(input) {
  if (!input || typeof input !== 'object') return null;
  const normalized = {
    bits: input.bits | 0,
    worldAimX: Number(input.worldAimX),
    worldAimY: Number(input.worldAimY),
    tool: input.tool | 0,
  };
  if (Number.isFinite(input.moveX) && Number.isFinite(input.moveY)) {
    normalized.moveX = Number(input.moveX);
    normalized.moveY = Number(input.moveY);
  }
  return normalized;
}

export function normalizeReplayMessage(data, survival = false) {
  if (!data || typeof data !== 'object' || !REPLAY_EVENT_TYPES.has(data.type)) return null;
  switch (data.type) {
    case 'control': {
      const control = {
        type: 'control',
        camWorldX: Number(data.camWorldX),
        camWorldY: Number(data.camWorldY),
        viewCols: data.viewCols | 0,
        viewRows: data.viewRows | 0,
        suspendStreaming: !!data.suspendStreaming,
      };
      if (!survival) Object.assign(control, {
        worldX: Number(data.worldX),
        worldY: Number(data.worldY),
        buttons: data.buttons | 0,
        inside: !!data.inside,
        drawMode: !!data.drawMode,
      });
      return control;
    }
    case 'input': {
      const input = normalizeReplayInput(data.input);
      return input ? { type: 'input', input } : null;
    }
    case 'intent': {
      if (!hasOwn(INTENT, data.intent)) return null;
      const intent = { type: 'intent', intent: data.intent };
      switch (data.intent) {
        case 'select': intent.slot = data.slot | 0; break;
        case 'size': intent.footprint = data.footprint | 0; break;
        case 'move': intent.from = data.from | 0; intent.to = data.to | 0; break;
        case 'pick': intent.slot = data.slot | 0; intent.half = !!data.half; break;
        case 'throw': intent.whole = !!data.whole; break;
        case 'craft': intent.recipe = data.recipe | 0; intent.max = !!data.max; break;
        case 'repair-base':
        case 'respawn': break;
        case 'add': intent.material = data.material | 0; intent.count = data.count | 0; break;
        case 'set-player-state': intent.state = copyReplayValue(data.state || {}); break;
        default: return null;
      }
      return intent;
    }
    case 'edge':
      return {
        type: 'edge', kind: data.kind === 'down' ? 'down' : 'up',
        button: data.button | 0, buttons: data.buttons | 0,
        inside: !!data.inside, drawMode: !!data.drawMode,
        worldX: Number(data.worldX), worldY: Number(data.worldY),
      };
    case 'config': {
      const config = { type: 'config' };
      if (hasOwn(data, 'tool')) config.tool = data.tool | 0;
      if (hasOwn(data, 'drawMode')) config.drawMode = !!data.drawMode;
      if (hasOwn(data, 'creativeKind')) {
        config.creativeKind = data.creativeKind | 0;
        config.creativeValue = data.creativeValue | 0;
      }
      if (hasOwn(data, 'creatureNaturalSpawning'))
        config.creatureNaturalSpawning = !!data.creatureNaturalSpawning;
      return Object.keys(config).length > 1 ? config : null;
    }
    case 'resize': {
      const resize = { type: 'resize', cols: data.cols | 0, rows: data.rows | 0 };
      if (Number.isFinite(data.worldCenterX) && Number.isFinite(data.worldCenterY)) {
        resize.worldCenterX = Number(data.worldCenterX);
        resize.worldCenterY = Number(data.worldCenterY);
      }
      return resize;
    }
    case 'weather':
      return { type: 'weather', weatherId: data.weatherId | 0 };
    case 'day-phase':
      return {
        type: 'day-phase',
        phase: normalizeDayPhase(data.phase),
        overridden: !!data.overridden,
      };
    case 'test-paint-disc':
      return {
        type: data.type, material: data.material | 0, radius: data.radius | 0,
        worldX: Number(data.worldX), worldY: Number(data.worldY),
      };
    case 'test-seed-reaction':
      return {
        type: data.type, material: data.material | 0,
        cap: data.cap | 0, phase: data.phase | 0,
      };
    case 'test-creature-runtime':
      return { type: data.type, simulate: !!data.simulate, naturalSpawn: !!data.naturalSpawn };
    case 'test-natural-spawn':
      return {
        type: data.type, species: data.species | 0, salt: data.salt | 0,
        forceBreach: !!data.forceBreach,
      };
    case 'test-step-actors':
      return { type: data.type, steps: data.steps | 0 };
    default:
      return null;
  }
}

const finiteInteger = (value, min, max) => Number.isInteger(value)
  && value >= min && value <= max;

function validateReplayMessage(message, survival, version) {
  if (!message || typeof message !== 'object' || !REPLAY_EVENT_TYPES.has(message.type)) return false;
  if (version === LEGACY_REPLAY_VERSION) return true;
  const normalized = normalizeReplayMessage(message, survival);
  if (!normalized) return false;
  if (message.type === 'control') {
    return Number.isFinite(normalized.camWorldX) && Number.isFinite(normalized.camWorldY)
      && normalized.viewCols > 0 && normalized.viewRows > 0
      && (survival || (Number.isFinite(normalized.worldX) && Number.isFinite(normalized.worldY)));
  }
  if (message.type === 'input') {
    return Number.isFinite(normalized.input.worldAimX)
      && Number.isFinite(normalized.input.worldAimY);
  }
  if (message.type === 'resize') {
    return normalized.cols > 0 && normalized.rows > 0
      && normalized.cols <= ENGINE_MAX_DIMENSION && normalized.rows <= ENGINE_MAX_DIMENSION
      && normalized.cols * normalized.rows <= ENGINE_MAX_CELLS;
  }
  if (message.type === 'weather') return isWeatherId(normalized.weatherId);
  if (message.type === 'day-phase') return Number.isFinite(normalized.phase);
  return true;
}

export function replayAbiMatches(capsule) {
  return !!capsule
    && capsule.abiVersion === ABI_VERSION
    && capsule.abiFingerprint === ABI_FINGERPRINT;
}

export function validateReplayCapsule(value, options = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Replay capsule must be an object.');
  if (value.format !== REPLAY_FORMAT
      || (value.version !== REPLAY_VERSION && value.version !== LEGACY_REPLAY_VERSION))
    throw new Error('This is not a supported sand replay capsule.');
  const requireCompatibleAbi = options.requireCompatibleAbi !== false;
  if (requireCompatibleAbi && !replayAbiMatches(value))
    throw new Error('This replay was recorded by an incompatible sand engine build.');

  const init = value.init;
  if (!init || typeof init !== 'object') throw new Error('Replay initialization is missing.');
  if (!finiteInteger(init.cols, 1, ENGINE_MAX_DIMENSION)
      || !finiteInteger(init.rows, 1, ENGINE_MAX_DIMENSION)
      || init.cols * init.rows > ENGINE_MAX_CELLS)
    throw new Error('Replay dimensions are invalid.');
  if (!finiteInteger(init.worldSeed, 0, 0xffffffff))
    throw new Error('Replay world seed is invalid.');
  if (requireCompatibleAbi
      && init.weatherId !== undefined
      && (!isWeatherId(init.weatherId)
        || resolveWeatherIdForPlanet(init.weatherId, init.planetId | 0)
          !== init.weatherId))
    throw new Error('Replay weather is invalid for its planet.');
  if (init.dayPhase !== undefined && !Number.isFinite(Number(init.dayPhase)))
    throw new Error('Replay day phase is invalid.');

  const turns = value.turns;
  const events = value.events;
  const gates = value.gates;
  if (!finiteInteger(turns, 0, MAX_REPLAY_TURNS))
    throw new Error('Replay turn count is invalid or too large.');
  if (!Array.isArray(events) || events.length > MAX_REPLAY_EVENTS)
    throw new Error('Replay event list is invalid or too large.');
  if (!Array.isArray(gates) || gates.length > MAX_REPLAY_TURNS)
    throw new Error('Replay transport gate list is invalid or too large.');
  let previousTick = -1;
  for (const event of events) {
    if (!event || typeof event !== 'object'
        || !finiteInteger(event.tick, 0, turns)
        || event.tick < previousTick
        || !validateReplayMessage(event.message, !!init.survival, value.version))
      throw new Error('Replay contains an invalid authority event.');
    previousTick = event.tick;
  }
  let previousEnd = 0;
  for (const gate of gates) {
    if (!gate || typeof gate !== 'object'
        || !finiteInteger(gate.start, previousEnd, turns)
        || !finiteInteger(gate.end, gate.start + 1, turns)
        || !finiteInteger(gate.flags, 1, 3))
      throw new Error('Replay contains an invalid transport gate range.');
    previousEnd = gate.end;
  }

  const final = value.final;
  if (!final || typeof final !== 'object'
      || !finiteInteger(final.tick, 0, MAX_REPLAY_TURNS)
      || !finiteInteger(final.actorTick, 0, 0x7fffffff)
      || !finiteInteger(final.cols, 1, ENGINE_MAX_DIMENSION)
      || !finiteInteger(final.rows, 1, ENGINE_MAX_DIMENSION)
      || !finiteInteger(final.gridHash, 0, 0xffffffff)
      || !Number.isInteger(final.worldOffsetX)
      || !Number.isInteger(final.worldOffsetY))
    throw new Error('Replay final-state check is invalid.');

  return value;
}

export function replayDayPhaseAt(init, events, turn) {
  let phase = normalizeDayPhase(init?.dayPhase ?? DEFAULT_DAY_PHASE);
  let overridden = !!init?.dayOverridden;
  const tick = Math.max(0, turn | 0);
  if (Array.isArray(events)) {
    for (const event of events) {
      if (!event || (event.tick | 0) > tick) break;
      if (event.message?.type !== 'day-phase') continue;
      phase = normalizeDayPhase(event.message.phase);
      overridden = !!event.message.overridden;
    }
  }
  return { phase, overridden };
}

function packChangedState(message, previous, fields, booleanFields) {
  let mask = 0;
  const values = [];
  for (let i = 0; i < fields.length; i++) {
    const key = fields[i];
    const next = hasOwn(message, key) ? message[key] : undefined;
    const before = previous && hasOwn(previous, key) ? previous[key] : undefined;
    if (Object.is(next, before)) continue;
    mask |= 1 << i;
    values.push(next === undefined ? null : (booleanFields.has(key) ? (next ? 1 : 0) : next));
  }
  return [mask, ...values];
}

function unpackChangedState(row, start, previous, fields, booleanFields) {
  const mask = row[start] | 0;
  const next = previous ? { ...previous } : {};
  let cursor = start + 1;
  for (let i = 0; i < fields.length; i++) {
    if (!(mask & (1 << i))) continue;
    if (cursor >= row.length) throw new Error('Replay event payload is incomplete.');
    const value = row[cursor++];
    if (value === null) delete next[fields[i]];
    else next[fields[i]] = booleanFields.has(fields[i]) ? !!value : value;
  }
  if (cursor !== row.length) throw new Error('Replay event payload has trailing values.');
  return next;
}

function packIntent(message) {
  const code = INTENT[message.intent];
  switch (message.intent) {
    case 'select': return [code, message.slot];
    case 'size': return [code, message.footprint];
    case 'move': return [code, message.from, message.to];
    case 'pick': return [code, message.slot, message.half ? 1 : 0];
    case 'throw': return [code, message.whole ? 1 : 0];
    case 'craft': return [code, message.recipe, message.max ? 1 : 0];
    case 'repair-base':
    case 'respawn': return [code];
    case 'add': return [code, message.material, message.count];
    case 'set-player-state': return [code, message.state || {}];
    default: throw new Error('Replay contains an unknown intent.');
  }
}

function unpackIntent(row) {
  const name = INTENT_NAMES[row[2]];
  if (!name) throw new Error('Replay contains an unknown intent.');
  switch (name) {
    case 'select': return { type: 'intent', intent: name, slot: row[3] };
    case 'size': return { type: 'intent', intent: name, footprint: row[3] };
    case 'move': return { type: 'intent', intent: name, from: row[3], to: row[4] };
    case 'pick': return { type: 'intent', intent: name, slot: row[3], half: !!row[4] };
    case 'throw': return { type: 'intent', intent: name, whole: !!row[3] };
    case 'craft': return { type: 'intent', intent: name, recipe: row[3], max: !!row[4] };
    case 'repair-base':
    case 'respawn': return { type: 'intent', intent: name };
    case 'add': return { type: 'intent', intent: name, material: row[3], count: row[4] };
    case 'set-player-state': return { type: 'intent', intent: name, state: row[3] || {} };
    default: throw new Error('Replay contains an unknown intent.');
  }
}

function packConfig(message) {
  let mask = 0;
  const values = [];
  for (let i = 0; i < CONFIG_FIELDS.length; i++) {
    const key = CONFIG_FIELDS[i];
    if (!hasOwn(message, key)) continue;
    mask |= 1 << i;
    values.push(CONFIG_BOOLEAN_FIELDS.has(key) ? (message[key] ? 1 : 0) : message[key]);
  }
  return [mask, ...values];
}

function unpackConfig(row) {
  const mask = row[2] | 0;
  const message = { type: 'config' };
  let cursor = 3;
  for (let i = 0; i < CONFIG_FIELDS.length; i++) {
    if (!(mask & (1 << i))) continue;
    if (cursor >= row.length) throw new Error('Replay config payload is incomplete.');
    const key = CONFIG_FIELDS[i];
    message[key] = CONFIG_BOOLEAN_FIELDS.has(key) ? !!row[cursor++] : row[cursor++];
  }
  if (cursor !== row.length) throw new Error('Replay config payload has trailing values.');
  return message;
}

function packReplayEvents(capsule) {
  const packed = [];
  let previousTick = 0;
  let previousControl = null;
  let previousInput = null;
  for (const event of capsule.events) {
    const message = normalizeReplayMessage(event.message, !!capsule.init.survival);
    if (!message) continue;
    const row = [event.tick - previousTick];
    previousTick = event.tick;
    switch (message.type) {
      case 'control':
        row.push(OP.CONTROL, ...packChangedState(
          message, previousControl, CONTROL_FIELDS, CONTROL_BOOLEAN_FIELDS,
        ));
        previousControl = message;
        break;
      case 'input':
        row.push(OP.INPUT, ...packChangedState(
          message.input, previousInput, INPUT_FIELDS, NO_BOOLEAN_FIELDS,
        ));
        previousInput = message.input;
        break;
      case 'intent': row.push(OP.INTENT, ...packIntent(message)); break;
      case 'edge':
        row.push(
          OP.EDGE, message.kind === 'down' ? 1 : 0,
          message.button, message.buttons, message.inside ? 1 : 0,
          message.drawMode ? 1 : 0, message.worldX, message.worldY,
        );
        break;
      case 'config': row.push(OP.CONFIG, ...packConfig(message)); break;
      case 'weather': row.push(OP.WEATHER, message.weatherId); break;
      case 'day-phase':
        row.push(OP.DAY_PHASE, message.phase, message.overridden ? 1 : 0);
        break;
      case 'resize':
        row.push(
          OP.RESIZE, message.cols, message.rows,
          message.worldCenterX ?? null, message.worldCenterY ?? null,
        );
        break;
      case 'test-paint-disc':
        row.push(OP.TEST_PAINT_DISC, message.material, message.worldX, message.worldY, message.radius);
        break;
      case 'test-seed-reaction':
        row.push(OP.TEST_SEED_REACTION, message.material, message.cap, message.phase);
        break;
      case 'test-creature-runtime':
        row.push(OP.TEST_CREATURE_RUNTIME, message.simulate ? 1 : 0, message.naturalSpawn ? 1 : 0);
        break;
      case 'test-natural-spawn':
        row.push(OP.TEST_NATURAL_SPAWN, message.species, message.salt, message.forceBreach ? 1 : 0);
        break;
      case 'test-step-actors': row.push(OP.TEST_STEP_ACTORS, message.steps); break;
      default: throw new Error('Replay contains an unsupported event.');
    }
    packed.push(row);
  }
  return packed;
}

function unpackReplayEvents(rows) {
  if (!Array.isArray(rows)) throw new Error('Replay event payload is invalid.');
  const events = [];
  let tick = 0;
  let previousControl = null;
  let previousInput = null;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2 || !Number.isInteger(row[0]) || row[0] < 0)
      throw new Error('Replay event payload is invalid.');
    tick += row[0];
    let message;
    switch (row[1]) {
      case OP.CONTROL:
        previousControl = unpackChangedState(
          row, 2, previousControl, CONTROL_FIELDS, CONTROL_BOOLEAN_FIELDS,
        );
        message = { type: 'control', ...previousControl };
        break;
      case OP.INPUT:
        previousInput = unpackChangedState(row, 2, previousInput, INPUT_FIELDS, NO_BOOLEAN_FIELDS);
        message = { type: 'input', input: { ...previousInput } };
        break;
      case OP.INTENT: message = unpackIntent(row); break;
      case OP.EDGE:
        if (row.length !== 9) throw new Error('Replay edge payload is invalid.');
        message = {
          type: 'edge', kind: row[2] ? 'down' : 'up', button: row[3], buttons: row[4],
          inside: !!row[5], drawMode: !!row[6], worldX: row[7], worldY: row[8],
        };
        break;
      case OP.CONFIG: message = unpackConfig(row); break;
      case OP.WEATHER: message = { type: 'weather', weatherId: row[2] }; break;
      case OP.DAY_PHASE:
        message = { type: 'day-phase', phase: row[2], overridden: !!row[3] };
        break;
      case OP.RESIZE:
        if (row.length !== 6) throw new Error('Replay resize payload is invalid.');
        message = { type: 'resize', cols: row[2], rows: row[3] };
        if (row[4] !== null && row[5] !== null) {
          message.worldCenterX = row[4]; message.worldCenterY = row[5];
        }
        break;
      case OP.TEST_PAINT_DISC:
        message = { type: 'test-paint-disc', material: row[2], worldX: row[3], worldY: row[4], radius: row[5] };
        break;
      case OP.TEST_SEED_REACTION:
        message = { type: 'test-seed-reaction', material: row[2], cap: row[3], phase: row[4] };
        break;
      case OP.TEST_CREATURE_RUNTIME:
        message = { type: 'test-creature-runtime', simulate: !!row[2], naturalSpawn: !!row[3] };
        break;
      case OP.TEST_NATURAL_SPAWN:
        message = { type: 'test-natural-spawn', species: row[2], salt: row[3], forceBreach: !!row[4] };
        break;
      case OP.TEST_STEP_ACTORS:
        message = { type: 'test-step-actors', steps: row[2] };
        break;
      default: throw new Error('Replay contains an unknown event opcode.');
    }
    events.push({ tick, message });
  }
  return events;
}

function packReplayCapsule(capsule) {
  let previousEnd = 0;
  const gates = capsule.gates.map((gate) => {
    const packed = [gate.start - previousEnd, gate.end - gate.start, gate.flags];
    previousEnd = gate.end;
    return packed;
  });
  return [
    capsule.abiVersion,
    capsule.abiFingerprint,
    normalizeReplayInit(capsule.init),
    capsule.turns,
    packReplayEvents(capsule),
    gates,
    capsule.view || {},
    capsule.final,
  ];
}

function unpackReplayCapsule(value) {
  if (!Array.isArray(value) || value.length !== 8 || !Array.isArray(value[5]))
    throw new Error('This is not a supported sand replay capsule.');
  let previousEnd = 0;
  const gates = value[5].map((gate) => {
    if (!Array.isArray(gate) || gate.length !== 3)
      throw new Error('Replay transport gate payload is invalid.');
    const start = previousEnd + gate[0];
    const decoded = { start, end: start + gate[1], flags: gate[2] };
    previousEnd = decoded.end;
    return decoded;
  });
  return {
    format: REPLAY_FORMAT,
    version: REPLAY_VERSION,
    abiVersion: value[0],
    abiFingerprint: value[1],
    init: value[2],
    turns: value[3],
    events: unpackReplayEvents(value[4]),
    gates,
    view: value[6],
    final: value[7],
  };
}

function packLegacyReplayCapsule(capsule) {
  return {
    ...capsule,
    events: capsule.events.map((event) => [event.tick, event.message]),
    gates: capsule.gates.map((gate) => [gate.start, gate.end, gate.flags]),
  };
}

function unpackLegacyReplayCapsule(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Array.isArray(value.events) || !Array.isArray(value.gates))
    throw new Error('This is not a supported sand replay capsule.');
  return {
    ...value,
    events: value.events.map(([tick, message]) => ({ tick, message })),
    gates: value.gates.map(([start, end, flags]) => ({ start, end, flags })),
  };
}

const replayTextBytes = (text) => new TextEncoder().encode(text).length;

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  if (binary.length > MAX_REPLAY_TEXT_BYTES)
    throw new Error('Replay capsule is too large.');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function readLimited(stream, limit) {
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  let finished = false;
  while (!finished) {
    const { value, done } = await reader.read();
    if (done) { finished = true; continue; }
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new Error('Replay capsule expands beyond the size limit.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function encodeReplayCapsule(capsule) {
  validateReplayCapsule(capsule);
  if (capsule.version === LEGACY_REPLAY_VERSION) {
    const legacy = `${LEGACY_REPLAY_PREFIX}${JSON.stringify(packLegacyReplayCapsule(capsule))}`;
    if (replayTextBytes(legacy) > MAX_REPLAY_TEXT_BYTES)
      throw new Error('Replay capsule is too large.');
    return legacy;
  }

  const json = JSON.stringify(packReplayCapsule(capsule));
  const bytes = new TextEncoder().encode(json);
  if (bytes.length > MAX_REPLAY_EXPANDED_BYTES)
    throw new Error('Replay capsule is too large.');
  const plain = `${REPLAY_PREFIX}json:${json}`;
  if (typeof CompressionStream !== 'function') {
    if (replayTextBytes(plain) > MAX_REPLAY_TEXT_BYTES)
      throw new Error('Replay capsule is too large.');
    return plain;
  }
  const compressed = await readLimited(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),
    MAX_REPLAY_TEXT_BYTES,
  );
  const gzip = `${REPLAY_PREFIX}gzip:${bytesToBase64(compressed)}`;
  const text = replayTextBytes(gzip) < replayTextBytes(plain) ? gzip : plain;
  if (replayTextBytes(text) > MAX_REPLAY_TEXT_BYTES)
    throw new Error('Replay capsule is too large.');
  return text;
}

export async function decodeReplayCapsule(text, options = {}) {
  const compact = String(text || '').trim();
  if (replayTextBytes(compact) > MAX_REPLAY_TEXT_BYTES)
    throw new Error('Replay capsule is too large.');
  if (compact.startsWith(LEGACY_REPLAY_PREFIX)) {
    const payload = compact.slice(LEGACY_REPLAY_PREFIX.length);
    if (!payload) throw new Error('Replay text is incomplete.');
    return validateReplayCapsule(unpackLegacyReplayCapsule(JSON.parse(payload)), options);
  }
  if (!compact.startsWith(REPLAY_PREFIX))
    throw new Error('Replay text must start with SAND-REPLAY-3:.');

  const payload = compact.slice(REPLAY_PREFIX.length);
  const separator = payload.indexOf(':');
  if (separator < 0) throw new Error('Replay text is incomplete.');
  const encoding = payload.slice(0, separator);
  let json;
  if (encoding === 'json') {
    json = payload.slice(separator + 1);
    if (replayTextBytes(json) > MAX_REPLAY_EXPANDED_BYTES)
      throw new Error('Replay capsule expands beyond the size limit.');
  } else if (encoding === 'gzip') {
    if (typeof DecompressionStream !== 'function')
      throw new Error('This browser cannot decompress replay capsules.');
    const bytes = base64ToBytes(payload.slice(separator + 1));
    const expanded = await readLimited(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
      MAX_REPLAY_EXPANDED_BYTES,
    );
    json = new TextDecoder().decode(expanded);
  } else {
    throw new Error('Replay text uses an unknown encoding.');
  }
  if (!json) throw new Error('Replay text is incomplete.');
  return validateReplayCapsule(unpackReplayCapsule(JSON.parse(json)), options);
}
