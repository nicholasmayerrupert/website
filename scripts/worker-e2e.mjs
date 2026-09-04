import { workerBrowserCases, workerBrowserContextOptions } from './worker-browser-cases.mjs';
import { runBrowserCases } from './browser-harness.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--case'))
  throw new Error('Usage: node scripts/worker-e2e.mjs [--case NAME]');
const selected = args.length ? args[1].split(',') : Object.keys(workerBrowserCases);
const failures = await runBrowserCases(workerBrowserCases, selected, workerBrowserContextOptions);
console.log(`${selected.length - failures}/${selected.length} browser cases passed`);
process.exitCode = failures ? 1 : 0;
