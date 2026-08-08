import { spawnSync } from 'node:child_process';
import {
  existsSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { delimiter, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const emscriptenVersion = readFileSync(
  new URL('./emscripten-version.txt', import.meta.url),
  'utf8',
).trim();

const envValue = (environment, name) => {
  const key = Object.keys(environment).find((candidate) => candidate.toUpperCase() === name);
  return key ? environment[key] : '';
};

export function commandPath(name, environment = process.env) {
  if (name.includes('/') || name.includes('\\'))
    return existsSync(name) ? resolve(name) : null;

  const extensions = process.platform === 'win32'
    ? [...new Set([
      ...(envValue(environment, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';'),
      '.PY',
    ])]
    : [''];
  for (const entry of envValue(environment, 'PATH').split(delimiter)) {
    const directory = entry.replace(/^"|"$/g, '');
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Continue through PATH.
      }
    }
  }
  return null;
}

const invocation = (command, args, environment) => {
  const executable = commandPath(command, environment);
  if (!executable) throw new Error(`Unable to find ${command} on PATH.`);

  const extension = extname(executable).toLowerCase();
  if (process.platform !== 'win32' || !['.bat', '.cmd', '.py'].includes(extension))
    return { executable, args };

  const script = extension === '.py'
    ? executable
    : `${executable.slice(0, -extension.length)}.py`;
  const python = commandPath('python', environment) || commandPath('python3', environment);
  if (!python || !existsSync(script))
    throw new Error(`Unable to launch ${command}; activate the pinned emsdk environment.`);
  return { executable: python, args: [script, ...args] };
};

export function run(command, args, {
  capture = false,
  cwd = repoRoot,
  environment = process.env,
} = {}) {
  let prepared;
  try {
    prepared = invocation(command, args, environment);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const result = spawnSync(prepared.executable, prepared.args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) {
    console.error(`Unable to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (capture && result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return capture ? result.stdout.trim() : '';
}

export function requireEmscripten() {
  const emcc = commandPath('emcc');
  const emxx = commandPath('em++');
  if (!emcc || !emxx) {
    console.error(`Emscripten ${emscriptenVersion} is not active. Follow wasm/README.md.`);
    process.exit(1);
  }

  const versionLine = run(emcc, ['--version'], { capture: true }).split(/\r?\n/)[0];
  const actualVersion = versionLine.match(/\b\d+\.\d+\.\d+\b/)?.[0];
  if (actualVersion !== emscriptenVersion) {
    console.error(`Expected Emscripten ${emscriptenVersion}, found ${actualVersion || versionLine}. Follow wasm/README.md.`);
    process.exit(1);
  }
  return { emcc, emxx, versionLine };
}

export function normalizeTextFile(path) {
  const content = readFileSync(path, 'utf8');
  const normalized = content.replaceAll('\r\n', '\n');
  if (normalized !== content) writeFileSync(path, normalized);
}
