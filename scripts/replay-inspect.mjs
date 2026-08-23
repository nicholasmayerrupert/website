#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeReplayCapsule } from '../src/sand/game/replayCapsule.js';
import {
  formatReplayInspectText,
  summarizeReplayCapsule,
} from '../src/sand/game/replayInspect.js';

const argv = process.argv.slice(2);
const flags = new Set();
const values = new Map();
let capsulePath = null;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('--') && !capsulePath) {
    capsulePath = arg;
    continue;
  }
  if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
  const [name, inline] = arg.slice(2).split('=', 2);
  if (inline !== undefined) values.set(name, inline);
  else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) values.set(name, argv[++i]);
  else flags.add(name);
}

const help = () => {
  console.log(`Usage: node scripts/replay-inspect.mjs <capsule-file|-> [--json]

Decode a SAND-REPLAY-3 capsule without starting the engine.
Works when the ABI fingerprint does not match this checkout.

  --json     print machine-readable summary
`);
};

if (flags.has('help') || flags.has('h') || !capsulePath) {
  help();
  process.exit(capsulePath ? 0 : 1);
}

const source = capsulePath === '-' ? '-' : resolve(capsulePath);
const text = capsulePath === '-'
  ? readFileSync(0, 'utf8').trim()
  : readFileSync(source, 'utf8').trim();
const capsule = await decodeReplayCapsule(text, { requireCompatibleAbi: false });
const summary = summarizeReplayCapsule(capsule, { source: capsulePath === '-' ? '-' : source });

if (flags.has('json')) console.log(JSON.stringify(summary, null, 2));
else process.stdout.write(formatReplayInspectText(summary));
