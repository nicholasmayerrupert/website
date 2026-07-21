#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '0.16.9';
const RELEASE_BASE = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${VERSION}`;
const TARGETS = {
  'darwin-arm64': {
    asset: `tectonic-${VERSION}-aarch64-apple-darwin.tar.gz`,
    sha256: 'edb67c61aba768289f6da441c9e6f523cfaff4f8b2a5708523ef29c543f8e88e',
  },
  'darwin-x64': {
    asset: `tectonic-${VERSION}-x86_64-apple-darwin.tar.gz`,
    sha256: '79d8839fa3594bfea9b2bf2ac0a0455bcc4d0de956a5e5c403107e9a72f79e86',
  },
  'linux-arm64': {
    asset: `tectonic-${VERSION}-aarch64-unknown-linux-musl.tar.gz`,
    sha256: 'f9aa39017dbd51f111fdb93dda222178cbe51c8193508fc567b523cc74fff9c1',
  },
  'linux-x64': {
    asset: `tectonic-${VERSION}-x86_64-unknown-linux-musl.tar.gz`,
    sha256: '60b13a0826ae7ad9ce34b4a2df06bff2cfcfa6dda8a915477c0cbb84e1a4a902',
  },
};

const SOURCE = join(ROOT, 'resume', 'Nicholas-Mayer-Rupert-Resume.tex');
const PDF_NAME = 'Nicholas-Mayer-Rupert-Resume.pdf';
const PUBLIC_DIR = join(ROOT, 'public');
const COMMITTED_PDF = join(PUBLIC_DIR, PDF_NAME);
const CACHE_ROOT = join(ROOT, '.cache');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

async function ensureTectonic() {
  const targetName = `${process.platform}-${process.arch}`;
  const target = TARGETS[targetName];
  if (!target) {
    throw new Error(
      `Unsupported platform ${targetName}. Supported platforms: ${Object.keys(TARGETS).join(', ')}`,
    );
  }

  const installDir = join(CACHE_ROOT, 'tectonic', VERSION, targetName);
  const binary = join(installDir, 'tectonic');
  try {
    await access(binary, constants.X_OK);
    return binary;
  } catch {}

  await mkdir(installDir, { recursive: true });
  const archive = join(installDir, target.asset);
  const download = `${archive}.download-${process.pid}`;
  const extractDir = await mkdtemp(join(installDir, '.extract-'));

  console.log(`Downloading Tectonic ${VERSION} for ${targetName}...`);
  const response = await fetch(`${RELEASE_BASE}/${target.asset}`);
  if (!response.ok) {
    throw new Error(`Tectonic download failed: ${response.status} ${response.statusText}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== target.sha256) {
    throw new Error(`Tectonic checksum mismatch: expected ${target.sha256}, received ${actualHash}`);
  }

  try {
    await writeFile(download, bytes);
    await rename(download, archive);
    run('tar', ['-xzf', archive, '-C', extractDir]);
    const extractedBinary = join(extractDir, 'tectonic');
    await chmod(extractedBinary, 0o755);
    await rename(extractedBinary, binary);
  } finally {
    await rm(download, { force: true });
    await rm(archive, { force: true });
    await rm(extractDir, { recursive: true, force: true });
  }

  return binary;
}

function compile(binary, outDir) {
  run(binary, ['-X', 'compile', '--outdir', outDir, SOURCE], {
    cwd: ROOT,
    env: {
      ...process.env,
      FORCE_SOURCE_DATE: '1',
      SOURCE_DATE_EPOCH: '0',
      XDG_CACHE_HOME: CACHE_ROOT,
    },
  });
}

async function checkResume(binary) {
  const outDir = await mkdtemp(join(tmpdir(), 'website-resume-'));
  try {
    compile(binary, outDir);
    const [generated, committed] = await Promise.all([
      readFile(join(outDir, PDF_NAME)),
      readFile(COMMITTED_PDF),
    ]);
    if (!generated.equals(committed)) {
      throw new Error('Résumé PDF is stale. Run `npm run build:resume` and commit the updated PDF.');
    }
    console.log('Committed résumé PDF is up to date.');
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--check') || args.length > 1) {
    throw new Error('Usage: node scripts/resume.mjs [--check]');
  }

  const binary = await ensureTectonic();
  if (args[0] === '--check') {
    await checkResume(binary);
    return;
  }

  await mkdir(PUBLIC_DIR, { recursive: true });
  compile(binary, PUBLIC_DIR);
  console.log(`Built ${COMMITTED_PDF}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
