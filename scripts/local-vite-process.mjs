import { spawnSync } from 'node:child_process';
import { posix, win32 } from 'node:path';

export function npmInvocation(platform = process.platform, execPath = process.execPath) {
  if (platform !== 'win32') return { command: 'npm', args: [] };
  return {
    command: execPath,
    args: [win32.join(win32.dirname(execPath), 'node_modules/npm/bin/npm-cli.js')],
  };
}

export function stopDetachedProcess(pid, {
  platform = process.platform,
  run = spawnSync,
  kill = process.kill,
} = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (platform === 'win32') {
    run('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    kill(-pid, 'SIGTERM');
  }
  return true;
}

export function normalizedCwd(url, platform = process.platform) {
  const pathname = decodeURIComponent(url.pathname);
  return platform === 'win32'
    ? win32.normalize(pathname.replace(/^\/(?:([A-Za-z]):)/, '$1:'))
    : posix.normalize(pathname);
}
