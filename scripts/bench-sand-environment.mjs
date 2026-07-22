const platformFamily = (value) => String(value || '').split(/\s+/, 1)[0];
const nodeMajor = (value) => String(value || '').match(/^v?(\d+)/)?.[1] || null;
const emccVersion = (metadata) => metadata?.wasm?.buildInfo?.toolchain?.emcc?.match(/\b(\d+\.\d+\.\d+)\b/)?.[1] || null;

export function compatibleSandTimingEnvironment(current, baseline) {
  const reasons = [];
  const fields = [
    ['platform', platformFamily(current?.platform), platformFamily(baseline?.platform)],
    ['architecture', current?.arch, baseline?.arch],
    ['CPU', current?.cpu, baseline?.cpu],
    ['Node major', nodeMajor(current?.node), nodeMajor(baseline?.node)],
    ['Emscripten', emccVersion(current), emccVersion(baseline)],
  ];
  for (const [label, after, before] of fields) {
    if (!after || !before) reasons.push(`${label} metadata missing`);
    else if (after !== before) reasons.push(`${label} differs (${before} -> ${after})`);
  }
  return { compatible: reasons.length === 0, reasons };
}

export function compatibleSandBenchmarkConfig(current, baseline) {
  const reasons = [];
  for (const field of ['COLS', 'ROWS', 'SEED', 'SHIFT_COLS', 'WARMUP_STEPS', 'SHIFTS_EACH_WAY', 'STEPS_PER_SHIFT', 'scenario']) {
    if (current?.[field] !== baseline?.[field]) reasons.push(`${field} differs (${baseline?.[field]} -> ${current?.[field]})`);
  }
  return { compatible: reasons.length === 0, reasons };
}
