export const PAN_COMPARE_LIMITS = Object.freeze({
  maxCursorCellError: 0,
  maxInstability: 0.5,
  frameAvgRelative: 0.5,
  frameAvgAbsoluteMs: 2,
  frameP95Relative: 0.5,
  frameP95AbsoluteMs: 4,
});

const PERF_ENV_FIELDS = ['platform', 'arch', 'deviceScaleFactor', 'renderer'];

export function compatiblePerfEnvironment(current, baseline) {
  if (!current || !baseline) return { compatible: false, reason: 'baseline has no environment metadata' };
  for (const field of PERF_ENV_FIELDS) {
    if (current[field] == null || baseline[field] == null) {
      return { compatible: false, reason: `baseline is missing ${field} metadata` };
    }
    if (current[field] !== baseline[field]) {
      return { compatible: false, reason: `${field} differs (${baseline[field]} -> ${current[field]})` };
    }
  }
  return { compatible: true, reason: '' };
}

export function comparePanResults(current, baseline, limits = PAN_COMPARE_LIMITS) {
  const failures = [];
  const cursorError = Number(current?.cursor?.worstCellErr);
  if (!Number.isFinite(cursorError) || cursorError > limits.maxCursorCellError) {
    failures.push(`cursor error ${cursorError} exceeds ${limits.maxCursorCellError} cells`);
  }

  const instability = Number(current?.flicker?.instability);
  if (!Number.isFinite(instability) || instability > limits.maxInstability) {
    failures.push(`instability ${instability} exceeds ${limits.maxInstability}`);
  }

  const perfEnvironment = compatiblePerfEnvironment(current?.meta, baseline?.meta);
  const perfLimits = {};
  if (perfEnvironment.compatible) {
    for (const [field, relative, absolute] of [
      ['avgFrameMs', limits.frameAvgRelative, limits.frameAvgAbsoluteMs],
      ['p95FrameMs', limits.frameP95Relative, limits.frameP95AbsoluteMs],
    ]) {
      const before = Number(baseline?.perf?.[field]);
      const after = Number(current?.perf?.[field]);
      if (!Number.isFinite(before) || !Number.isFinite(after)) {
        failures.push(`${field} is missing or invalid`);
        continue;
      }
      const allowed = Math.max(before * (1 + relative), before + absolute);
      perfLimits[field] = allowed;
      if (after > allowed) failures.push(`${field} ${after}ms exceeds ${allowed.toFixed(3)}ms`);
    }
  }

  return { failures, perfEnvironment, perfLimits };
}
