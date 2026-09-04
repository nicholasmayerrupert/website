// Compatibility entry: node scripts/bench-tnt-placement.mjs [40 80 160 240]
import { runScenario } from './scenario-runner.mjs';
await runScenario({ scenario: 'placement', sizes: process.argv.slice(2).map(Number) });
