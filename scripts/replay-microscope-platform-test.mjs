import { strict as assert } from 'node:assert';
import {
  npmInvocation, normalizedCwd, stopDetachedProcess,
} from './local-vite-process.mjs';

const windows = npmInvocation('win32', 'C:\\Program Files\\nodejs\\node.exe');
assert.deepEqual(windows, {
  command: 'C:\\Program Files\\nodejs\\node.exe',
  args: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'],
});
assert.deepEqual(npmInvocation('darwin', '/opt/homebrew/bin/node'), {
  command: 'npm', args: [],
});
assert.deepEqual(npmInvocation('linux', '/usr/bin/node'), {
  command: 'npm', args: [],
});

let windowsStop = null;
assert.equal(stopDetachedProcess(8123, {
  platform: 'win32',
  run(command, args, options) { windowsStop = { command, args, options }; },
}), true);
assert.deepEqual(windowsStop, {
  command: 'taskkill',
  args: ['/pid', '8123', '/t', '/f'],
  options: { stdio: 'ignore' },
});

for (const platform of ['darwin', 'linux']) {
  let signal = null;
  assert.equal(stopDetachedProcess(8123, {
    platform,
    kill(pid, name) { signal = { pid, name }; },
  }), true);
  assert.deepEqual(signal, { pid: -8123, name: 'SIGTERM' });
}
assert.equal(stopDetachedProcess(0), false);

assert.equal(normalizedCwd(new URL('file:///E:/sand/site/'), 'win32'), 'E:\\sand\\site\\');
assert.equal(normalizedCwd(new URL('file:///home/sand/site/'), 'linux'), '/home/sand/site/');

console.log('replay microscope platform checks passed');
