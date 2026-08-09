const platformFamily = (value) => String(value || '').split(/\s+/, 1)[0];
const nodeMajor = (value) => String(value || '').match(/^v?(\d+)/)?.[1] || null;
const emccVersion = (metadata) => metadata?.wasm?.buildInfo?.toolchain?.emcc?.match(/\b(\d+\.\d+\.\d+)\b/)?.[1] || null;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function sandBenchmarkGateMetric(baseline, current, section, metric) {
  const runValues = (result) => Array.isArray(result?.runs)
    ? result.runs.map((run) => run?.[section]?.[metric]).filter((value) => Number.isFinite(value))
    : [];
  const baselineRuns = runValues(baseline);
  const currentRuns = runValues(current);
  if (baselineRuns.length >= 3 && currentRuns.length >= 3) {
    return {
      baseline: median(baselineRuns),
      current: median(currentRuns),
      method: 'median-run',
    };
  }
  return {
    baseline: baseline?.[section]?.[metric],
    current: current?.[section]?.[metric],
    method: 'aggregate',
  };
}

export function compatibleSandTimingEnvironment(current, baseline) {
  const reasons = [];
  const fields = [
    ['platform', platformFamily(current?.platform), platformFamily(baseline?.platform)],
    ['architecture', current?.arch, baseline?.arch],
    ['CPU', current?.cpu, baseline?.cpu],
    ['Node major', nodeMajor(current?.node), nodeMajor(baseline?.node)],
    ['Emscripten', emccVersion(current), emccVersion(baseline)],
    ['build variant', current?.wasm?.buildInfo?.variant, baseline?.wasm?.buildInfo?.variant],
  ];
  for (const [label, after, before] of fields) {
    if (!after || !before) reasons.push(`${label} metadata missing`);
    else if (after !== before) reasons.push(`${label} differs (${before} -> ${after})`);
  }
  return { compatible: reasons.length === 0, reasons };
}

export function compatibleSandBenchmarkConfig(current, baseline) {
  const reasons = [];
  for (const field of ['COLS', 'ROWS', 'SEED', 'SHIFT_COLS', 'WARMUP_STEPS', 'SHIFTS_EACH_WAY', 'STEPS_PER_SHIFT', 'scenario', 'checksumOnly']) {
    if (current?.[field] !== baseline?.[field]) reasons.push(`${field} differs (${baseline?.[field]} -> ${current?.[field]})`);
  }
  return { compatible: reasons.length === 0, reasons };
}
