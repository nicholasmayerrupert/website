import { comparePanResults } from './bench-pan-compare.mjs';

const meta = { platform: 'test', arch: 'x64', deviceScaleFactor: 1, renderer: 'software' };
const baseline = {
  meta,
  cursor: { worstCellErr: 0 },
  flicker: { instability: 0 },
  verticalFlicker: { instability: 0 },
  parallaxVertical: { layers: [{ mismatch: 0.01 }, { mismatch: 0.01 }, { mismatch: 0.005 }] },
  perf: { avgFrameMs: 2, p95FrameMs: 5 },
};
const current = (overrides = {}) => ({
  ...structuredClone(baseline),
  ...overrides,
});

let failures = 0;
const check = (label, ok) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
};

console.log('pan benchmark regression guard');
check('matching result passes', comparePanResults(current(), baseline).failures.length === 0);
check('cursor regression fails', comparePanResults(current({ cursor: { worstCellErr: 1 } }), baseline).failures.some((s) => s.startsWith('cursor')));
check('flicker regression fails', comparePanResults(current({ flicker: { instability: 0.6 } }), baseline).failures.some((s) => s.startsWith('instability')));
check('vertical flicker regression fails', comparePanResults(current({ verticalFlicker: { instability: 0.6 } }), baseline).failures.some((s) => s.startsWith('vertical instability')));
check('vertical parallax rigidity regression fails',
  comparePanResults(current({ parallaxVertical: { layers: [{}, {}, { mismatch: 0.02 }] } }), baseline)
    .failures.some((s) => s.startsWith('vertical parallax')));
check('average frame regression fails', comparePanResults(current({ perf: { avgFrameMs: 4.1, p95FrameMs: 5 } }), baseline).failures.some((s) => s.startsWith('avgFrameMs')));
check('p95 frame regression fails', comparePanResults(current({ perf: { avgFrameMs: 2, p95FrameMs: 10 } }), baseline).failures.some((s) => s.startsWith('p95FrameMs')));
const crossPlatform = comparePanResults(current({ meta: { ...meta, platform: 'other' }, perf: { avgFrameMs: 99, p95FrameMs: 99 } }), baseline);
check('cross-platform timing is not compared', !crossPlatform.perfEnvironment.compatible && crossPlatform.failures.length === 0);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
