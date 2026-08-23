import {
  ABI_FINGERPRINT,
  ABI_VERSION,
  CREATIVE_KIND,
  CREATURE,
  INPUT,
  ITEM_KIND,
  MISSION,
  PLANET_NAMES,
  TOOL,
  WEATHER,
} from '../wasmBridge/abi.generated.js';
import { MATERIAL_BY_ID } from '../materials.js';
import { replayAbiMatches } from './replayCapsule.js';

const MAX_TIMELINE = 40;
const MAX_SUGGESTED_TURNS = 12;
const NOISY_TYPES = new Set(['control', 'input']);

const invertEnum = (map) => Object.fromEntries(
  Object.entries(map).map(([name, id]) => [id, name.toLowerCase()]),
);

const TOOL_NAMES = invertEnum(TOOL);
const CREATIVE_KIND_NAMES = invertEnum(CREATIVE_KIND);
const CREATURE_NAMES = invertEnum(CREATURE);
const WEATHER_NAMES = invertEnum(WEATHER);
const ITEM_KIND_NAMES = invertEnum(ITEM_KIND);
const MISSION_NAMES = invertEnum(MISSION);

const hex = (value) => `0x${Number(value).toString(16)}`;

const named = (names, id, fallback) => (
  Object.prototype.hasOwnProperty.call(names, id) ? names[id] : `${fallback}#${id}`
);

const materialName = (id) => {
  const material = MATERIAL_BY_ID[id];
  const name = material?.name;
  return name ? String(name).toLowerCase() : `material#${id}`;
};

const creativeLabel = (kind, value) => {
  const kindName = named(CREATIVE_KIND_NAMES, kind, 'kind');
  if (kind === CREATIVE_KIND.MATERIAL || kind === CREATIVE_KIND.SEED)
    return `${kindName}:${materialName(value)}`;
  if (kind === CREATIVE_KIND.CREATURE)
    return `${kindName}:${named(CREATURE_NAMES, value, 'creature')}`;
  return `${kindName}:${value}`;
};

const loadoutLabel = (stack) => {
  const kind = named(ITEM_KIND_NAMES, stack.itemKind, 'item');
  if (stack.itemKind === ITEM_KIND.MATERIAL && stack.material !== undefined)
    return `${kind}:${materialName(stack.material)} x${stack.count}`;
  return `${kind} x${stack.count}`;
};

const inputBitsLabel = (bits) => {
  const names = [];
  for (const [name, bit] of Object.entries(INPUT)) {
    if (bits & bit) names.push(name.toLowerCase());
  }
  return names.join('+') || 'none';
};

const roundCoord = (value) => Math.round(Number(value));
const formatPoint = (x, y) => `${roundCoord(x)},${roundCoord(y)}`;

const expandBounds = (bounds, x, y) => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return bounds;
  if (!bounds) return { minX: x, minY: y, maxX: x, maxY: y };
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
  return bounds;
};

const uniqueTurns = (turns, lastTurn) => {
  const set = new Set();
  for (const turn of turns) {
    if (!Number.isInteger(turn)) continue;
    set.add(Math.max(0, Math.min(lastTurn, turn)));
  }
  const sorted = [...set].sort((a, b) => a - b);
  if (sorted.length <= MAX_SUGGESTED_TURNS) return sorted;
  const picked = new Set([sorted[0], sorted[sorted.length - 1]]);
  const inner = sorted.slice(1, -1);
  const step = inner.length / (MAX_SUGGESTED_TURNS - 2);
  for (let i = 0; i < MAX_SUGGESTED_TURNS - 2; i++) {
    picked.add(inner[Math.min(inner.length - 1, Math.floor(i * step))]);
  }
  return [...picked].sort((a, b) => a - b);
};

const uniqueCells = (cells) => {
  const seen = new Set();
  const out = [];
  for (const cell of cells) {
    if (!cell || !Number.isFinite(cell.x) || !Number.isFinite(cell.y)) continue;
    const next = { x: roundCoord(cell.x), y: roundCoord(cell.y) };
    const key = `${next.x},${next.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
    if (out.length >= 3) break;
  }
  return out;
};

const describeMessage = (message, survival) => {
  if (!message || typeof message !== 'object') return 'invalid';
  switch (message.type) {
    case 'control': {
      const bits = [];
      if (!survival && message.buttons) bits.push(`buttons=${message.buttons}`);
      if (!survival && Number.isFinite(message.worldX))
        bits.push(`@${formatPoint(message.worldX, message.worldY)}`);
      if (Number.isFinite(message.camWorldX))
        bits.push(`cam ${formatPoint(message.camWorldX, message.camWorldY)}`);
      return bits.join(' ') || 'control';
    }
    case 'input': {
      const input = message.input || {};
      const bits = [named(TOOL_NAMES, input.tool, 'tool')];
      if (input.bits) bits.push(inputBitsLabel(input.bits));
      if (Number.isFinite(input.worldAimX))
        bits.push(`aim ${formatPoint(input.worldAimX, input.worldAimY)}`);
      return bits.join(' ');
    }
    case 'intent': {
      const extra = { ...message };
      delete extra.type;
      delete extra.intent;
      if (message.material !== undefined) extra.material = materialName(message.material);
      const detail = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
      return `${message.intent}${detail}`;
    }
    case 'edge':
      return `${message.kind} @${formatPoint(message.worldX, message.worldY)}`;
    case 'config': {
      const bits = [];
      if (message.tool !== undefined) bits.push(named(TOOL_NAMES, message.tool, 'tool'));
      if (message.creativeKind !== undefined)
        bits.push(creativeLabel(message.creativeKind, message.creativeValue));
      if (message.drawMode !== undefined) bits.push(message.drawMode ? 'draw' : 'erase');
      if (message.creatureNaturalSpawning !== undefined) {
        bits.push(message.creatureNaturalSpawning ? 'natural-spawn' : 'no-natural-spawn');
      }
      return bits.join(' ') || 'config';
    }
    case 'weather':
      return named(WEATHER_NAMES, message.weatherId, 'weather');
    case 'resize':
      return `${message.cols}x${message.rows}`;
    case 'test-paint-disc':
      return `${materialName(message.material)} r${message.radius} @${formatPoint(message.worldX, message.worldY)}`;
    case 'test-seed-reaction':
      return `${materialName(message.material)} cap=${message.cap} phase=${message.phase}`;
    case 'test-creature-runtime':
      return `simulate=${!!message.simulate} natural=${!!message.naturalSpawn}`;
    case 'test-natural-spawn':
      return `${named(CREATURE_NAMES, message.species, 'species')} salt=${message.salt}`;
    case 'test-step-actors':
      return `steps=${message.steps}`;
    default:
      return message.type;
  }
};

const collapseTimeline = (events, survival, lastTurn) => {
  const rows = [];
  let run = null;
  const flush = () => {
    if (!run) return;
    const suffix = run.count > 1 ? `  x${run.count} (t=${run.start}-${run.end})` : '';
    rows.push({ tick: run.start, type: run.type, text: `${run.text}${suffix}` });
    run = null;
  };
  for (const event of events) {
    const type = event.message?.type || 'unknown';
    const text = describeMessage(event.message, survival);
    if (NOISY_TYPES.has(type) && run && run.type === type && run.text === text) {
      run.count += 1;
      run.end = event.tick;
      continue;
    }
    flush();
    if (NOISY_TYPES.has(type))
      run = { type, text, start: event.tick, end: event.tick, count: 1 };
    else
      rows.push({ tick: event.tick, type, text });
  }
  flush();
  if (rows.length <= MAX_TIMELINE) return rows;
  return [
    ...rows.slice(0, 18),
    { tick: null, type: 'omitted', text: `${rows.length - 36} more events` },
    ...rows.slice(-18),
  ];
};

export function summarizeReplayCapsule(capsule, options = {}) {
  const init = capsule.init || {};
  const survival = !!init.survival;
  const lastTurn = capsule.turns | 0;
  const abiMatches = replayAbiMatches(capsule);
  const eventCounts = {};
  const tools = new Set();
  const interestingTicks = [0, lastTurn];
  const strokeTicks = [];
  const pointerCells = [];
  let pointer = null;
  let camera = null;
  let lastButtons = 0;
  let stroke = null;
  const strokes = [];

  for (const event of capsule.events || []) {
    const message = event.message || {};
    eventCounts[message.type] = (eventCounts[message.type] || 0) + 1;
    if (!NOISY_TYPES.has(message.type)) interestingTicks.push(event.tick);

    if (message.type === 'config' && message.tool !== undefined)
      tools.add(named(TOOL_NAMES, message.tool, 'tool'));
    if (message.type === 'input' && message.input?.tool !== undefined)
      tools.add(named(TOOL_NAMES, message.input.tool, 'tool'));

    const worldX = message.worldX ?? message.input?.worldAimX;
    const worldY = message.worldY ?? message.input?.worldAimY;
    if (Number.isFinite(worldX) && Number.isFinite(worldY)) {
      pointer = expandBounds(pointer, worldX, worldY);
      pointerCells.push({ x: worldX, y: worldY, tick: event.tick });
    }
    if (Number.isFinite(message.camWorldX) && Number.isFinite(message.camWorldY))
      camera = expandBounds(camera, message.camWorldX, message.camWorldY);

    const buttons = message.type === 'control' ? message.buttons | 0
      : message.type === 'edge' ? message.buttons | 0
      : message.type === 'input'
        ? ((message.input?.bits | 0) & INPUT.PRIMARY ? 1 : 0)
        : lastButtons;
    if ((buttons & 1) && !(lastButtons & 1)) {
      stroke = {
        start: event.tick,
        end: event.tick,
        x0: worldX, y0: worldY, x1: worldX, y1: worldY,
      };
      strokeTicks.push(event.tick);
    } else if (stroke && (buttons & 1)) {
      stroke.end = event.tick;
      if (Number.isFinite(worldX)) {
        stroke.x1 = worldX;
        stroke.y1 = worldY;
      }
    } else if (stroke && !(buttons & 1)) {
      strokes.push(stroke);
      stroke = null;
    }
    lastButtons = buttons;
  }
  if (stroke) strokes.push(stroke);

  if (init.tool !== undefined) tools.add(named(TOOL_NAMES, init.tool, 'tool'));

  const longest = strokes.reduce((best, next) => (
    !best || (next.end - next.start) > (best.end - best.start) ? next : best
  ), null);

  const suggestedCells = uniqueCells([
    longest && Number.isFinite(longest.x0) ? { x: longest.x0, y: longest.y0 } : null,
    longest && Number.isFinite(longest.x1) ? {
      x: (Number(longest.x0) + Number(longest.x1)) / 2,
      y: (Number(longest.y0) + Number(longest.y1)) / 2,
    } : null,
    pointerCells.at(-1),
    pointerCells[0],
  ]);

  const suggestedAt = uniqueTurns([...interestingTicks, ...strokeTicks], lastTurn);
  const source = options.source || '';
  const file = !source || source === '-' ? '<capsule-file>' : source;
  const microscopeArgs = [file];
  if (suggestedAt.length) microscopeArgs.push('--at', suggestedAt.join(','));
  for (const cell of suggestedCells) microscopeArgs.push('--cell', `${cell.x},${cell.y}`);
  microscopeArgs.push('--around-anomalies', '6');

  return {
    source,
    abi: {
      matches: abiMatches,
      recorded: {
        version: capsule.abiVersion,
        fingerprint: capsule.abiFingerprint,
      },
      current: { version: ABI_VERSION, fingerprint: ABI_FINGERPRINT },
    },
    init: {
      mode: survival ? 'survival' : 'creative',
      planet: PLANET_NAMES[init.planetId | 0] || `planet#${init.planetId | 0}`,
      weather: named(WEATHER_NAMES, init.weatherId, 'weather'),
      seed: init.worldSeed >>> 0,
      grid: `${init.cols}x${init.rows}`,
      tool: named(TOOL_NAMES, init.tool, 'tool'),
      creative: creativeLabel(init.creativeKind, init.creativeValue),
      gravity: init.gravityScale,
      mission: named(MISSION_NAMES, init.missionId, 'mission'),
      loadout: (init.loadout || []).map(loadoutLabel),
      drawMode: !!init.drawMode,
      creatureNaturalSpawning: !!init.creatureNaturalSpawning,
    },
    turns: lastTurn,
    eventCount: (capsule.events || []).length,
    eventCounts,
    tools: [...tools],
    strokes: strokes.length,
    activity: {
      pointer,
      camera,
      longestStroke: longest && Number.isFinite(longest.x0) ? {
        turns: longest.end - longest.start + 1,
        from: formatPoint(longest.x0, longest.y0),
        to: formatPoint(longest.x1, longest.y1),
      } : null,
    },
    gates: (capsule.gates || []).length,
    timeline: collapseTimeline(capsule.events || [], survival, lastTurn),
    final: capsule.final || null,
    suggested: {
      at: suggestedAt,
      cells: suggestedCells,
      microscope: `npm run replay:microscope -- ${microscopeArgs.join(' ')}`,
    },
    notes: [
      'This capsule is a deterministic input recipe (seed + authority events), not a screenshot or world dump.',
      abiMatches
        ? 'ABI matches this checkout; microscope can replay it.'
        : 'ABI does not match this checkout. Inspect is still valid; microscope cannot reconstruct the world.',
      'Save pasted gzip to a file. Chat wrapping/truncation breaks capsules.',
    ],
  };
}

export function formatReplayInspectText(summary) {
  const lines = [];
  const abi = summary.abi;
  lines.push('# Replay inspect');
  if (summary.source) lines.push(`source: ${summary.source}`);
  lines.push(abi.matches
    ? `abi: MATCH v${abi.current.version} ${hex(abi.current.fingerprint)}`
    : `abi: MISMATCH recorded v${abi.recorded.version} ${hex(abi.recorded.fingerprint)} vs this checkout v${abi.current.version} ${hex(abi.current.fingerprint)}`);
  lines.push('');
  const init = summary.init;
  lines.push('## Init');
  lines.push(`mode: ${init.mode}    planet: ${init.planet}    weather: ${init.weather}`);
  lines.push(`seed: ${init.seed} (${hex(init.seed)})    grid: ${init.grid}    gravity: ${init.gravity}`);
  lines.push(`tool: ${init.tool}    creative: ${init.creative}    mission: ${init.mission}`);
  if (init.loadout.length) lines.push(`loadout: ${init.loadout.join(', ')}`);
  lines.push('');
  lines.push('## Events');
  lines.push(`turns: ${summary.turns}    events: ${summary.eventCount}    gates: ${summary.gates}    paint strokes: ${summary.strokes}`);
  const counts = Object.entries(summary.eventCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type}=${count}`)
    .join('  ');
  if (counts) lines.push(counts);
  if (summary.tools.length) lines.push(`tools: ${summary.tools.join(', ')}`);
  const pointer = summary.activity.pointer;
  if (pointer) {
    lines.push(`pointer: ${formatPoint(pointer.minX, pointer.minY)} .. ${formatPoint(pointer.maxX, pointer.maxY)}`);
  }
  const camera = summary.activity.camera;
  if (camera) {
    lines.push(`camera: ${formatPoint(camera.minX, camera.minY)} .. ${formatPoint(camera.maxX, camera.maxY)}`);
  }
  if (summary.activity.longestStroke) {
    const stroke = summary.activity.longestStroke;
    lines.push(`longest stroke: ${stroke.turns} turns ${stroke.from} -> ${stroke.to}`);
  }
  lines.push('');
  lines.push('## Timeline');
  for (const row of summary.timeline) {
    const tick = row.tick == null ? '       …' : String(row.tick).padStart(8, ' ');
    lines.push(`${tick}  ${row.type.padEnd(18, ' ')} ${row.text}`);
  }
  lines.push('');
  if (summary.final) {
    const final = summary.final;
    lines.push('## Final');
    lines.push(`tick: ${final.tick}    actorTick: ${final.actorTick}    grid: ${final.cols}x${final.rows}`);
    lines.push(`gridHash: ${hex(final.gridHash)}    worldOffset: ${final.worldOffsetX},${final.worldOffsetY}`);
    lines.push('');
  }
  lines.push('## Next');
  for (const note of summary.notes) lines.push(`- ${note}`);
  if (abi.matches) lines.push(`- ${summary.suggested.microscope}`);
  else lines.push('- Do not run microscope until this checkout’s ABI matches the capsule.');
  return `${lines.join('\n')}\n`;
}
