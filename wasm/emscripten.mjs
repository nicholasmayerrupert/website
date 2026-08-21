import { spawnSync } from 'node:child_process';
import {
  existsSync, readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, extname, join, resolve } from 'node:path';
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

const resolveInDirectory = (directory, name, environment) => {
  const extensions = process.platform === 'win32'
    ? [...new Set([
      ...(envValue(environment, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';'),
      '.PY',
    ])]
    : [''];
  for (const extension of extensions) {
    const candidate = join(directory, `${name}${extension}`);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Continue through the directory's extensions.
    }
  }
  return null;
};

export function commandPath(name, environment = process.env) {
  if (name.includes('/') || name.includes('\\'))
    return existsSync(name) ? resolve(name) : null;

  for (const entry of envValue(environment, 'PATH').split(delimiter)) {
    const directory = entry.replace(/^"|"$/g, '');
    if (!directory) continue;
    const found = resolveInDirectory(directory, name, environment);
    if (found) return found;
  }
  return null;
}

// emcc resolution order: $EMSDK/upstream/emscripten, then PATH entries in
// order, then a checkout at ~/emsdk. Earlier candidates win only when they
// report the pinned version.
const emccCandidatePaths = (environment) => {
  const candidates = [];
  const add = (path) => {
    if (path && !candidates.includes(path)) candidates.push(path);
  };
  const emsdkRoot = envValue(environment, 'EMSDK');
  if (emsdkRoot)
    add(resolveInDirectory(join(emsdkRoot, 'upstream', 'emscripten'), 'emcc', environment));
  for (const entry of envValue(environment, 'PATH').split(delimiter)) {
    const directory = entry.replace(/^"|"$/g, '');
    if (directory)
      add(resolveInDirectory(directory, 'emcc', environment));
  }
  add(resolveInDirectory(join(homedir(), 'emsdk', 'upstream', 'emscripten'), 'emcc', environment));
  return candidates;
};

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

const probeEmcc = (emccPath, environment) => {
  let prepared;
  try {
    prepared = invocation(emccPath, ['--version'], environment);
  } catch (error) {
    return { emccPath, error: error.message };
  }

  const result = spawnSync(prepared.executable, prepared.args, {
    encoding: 'utf8',
    env: environment,
  });
  if (result.error)
    return { emccPath, error: result.error.message };
  if (result.status !== 0) {
    const detail = (result.stderr || `exit code ${result.status}`).trim().split(/\r?\n/)[0];
    return { emccPath, error: detail };
  }
  const versionLine = (result.stdout || '').split(/\r?\n/)[0].trim();
  return {
    emccPath,
    versionLine,
    version: versionLine.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? '',
  };
};

// An unactivated emsdk checkout ships a working emcc, but its launcher runs
// `python3` from PATH. Prepend the SDK's bundled Python so the checkout works
// without `emsdk_env.sh`.
const emsdkEnvironmentFor = (emccPath, environment) => {
  const cutoff = emccPath.lastIndexOf(join('upstream', 'emscripten'));
  if (cutoff < 0) return environment;
  const pythonRoot = join(emccPath.slice(0, cutoff), 'python');
  let versions;
  try {
    versions = readdirSync(pythonRoot);
  } catch {
    return environment;
  }
  const pythonName = process.platform === 'win32' ? 'python.exe' : 'python3';
  for (const version of versions) {
    for (const bin of [join(pythonRoot, version, 'bin'), join(pythonRoot, version)]) {
      if (!existsSync(join(bin, pythonName))) continue;
      return {
        ...environment,
        PATH: `${bin}${delimiter}${envValue(environment, 'PATH')}`,
      };
    }
  }
  return environment;
};

export function requireEmscripten() {
  const candidates = emccCandidatePaths(process.env);
  if (!candidates.length) {
    console.error(`Emscripten ${emscriptenVersion} was not found. Install the pinned emsdk (see wasm/README.md), then set EMSDK to its path or activate it in this shell (source <emsdk>/emsdk_env.sh).`);
    process.exit(1);
  }

  const probes = [];
  for (const emccPath of candidates) {
    const environment = emsdkEnvironmentFor(emccPath, process.env);
    const probe = probeEmcc(emccPath, environment);
    if (probe.version !== emscriptenVersion) {
      probes.push(probe);
      continue;
    }
    const suffix = basename(emccPath).slice('emcc'.length);
    const emxx = join(dirname(emccPath), `em++${suffix}`);
    return {
      emcc: emccPath,
      emxx,
      versionLine: probe.versionLine,
      environment,
    };
  }

  console.error(`No Emscripten ${emscriptenVersion} found on this machine. Probed, in order:`);
  for (const probe of probes)
    console.error(`  ${probe.emccPath}: ${probe.error ? `unusable (${probe.error})` : probe.versionLine}`);
  console.error('Set EMSDK to a pinned emsdk checkout or activate it in this shell (source <emsdk>/emsdk_env.sh). See wasm/README.md.');
  process.exit(1);
}

export function normalizeTextFile(path) {
  const content = readFileSync(path, 'utf8');
  const normalized = content.replaceAll('\r\n', '\n');
  if (normalized !== content) writeFileSync(path, normalized);
}
