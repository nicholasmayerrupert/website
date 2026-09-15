export function rigidCorrectionStages(trace, layer, radius) {
  const travel = (dx, dy, da) => Math.hypot(dx, dy) + Math.abs(da) * radius;
  const stages = {};
  for (const name of ['biasMotion', 'projectionMotion']) {
    const { dx, dy, da } = trace[name];
    stages[name] = travel(dx, dy, da);
  }
  // Missing optional stages are bridged to the next captured world pose.
  const order = layer === 0
    ? [[7, 'bodyRaster'], [8, 'terrainRecovery'], [9, 'stamp'],
      [1, 'layerFinalize'], [2, 'peerLayer'], [3, 'worldRelax'],
      [4, 'worldRestamp'], [5, 'worldCommit']]
    : [[7, 'bodyRaster'], [8, 'terrainRecovery'], [9, 'stamp'],
      [2, 'layerFinalize'], [3, 'worldRelax'], [4, 'worldRestamp'],
      [5, 'worldCommit']];
  let previous = 6;
  for (const [index, name] of order) {
    if (!(trace.mask & (1 << index))) continue;
    const a = trace.poses[previous], b = trace.poses[index];
    stages[name] = travel(b.px - a.px, b.py - a.py, b.angle - a.angle);
    previous = index;
  }
  return stages;
}

// Observe one body's correction stages without changing the simulated inputs.
export function trackRigidMotion(engine, layer, bodyId) {
  engine._setRigidTraceBody(layer, bodyId);
  const stages = {};
  let samples = 0;
  let maxCorrection = 0;
  let maxCorrectionTick = -1;
  let correctionTicks = 0;
  let previousWorldTick = engine.getTick();
  return {
    sample(tick) {
      const worldTick = engine.getTick();
      if (worldTick === previousWorldTick) return;
      previousWorldTick = worldTick;
      let body = -1;
      for (let index = 0; index < engine._bodyCountLayer(layer); index++)
        if (engine._bodyIdLayer(layer, index) === bodyId) body = index;
      if (body < 0) return;
      const radius = engine._bodyStateLayer(layer, body).maxR;
      const trace = engine._rigidTracePoses();
      if (!(trace.mask & (1 << 6))) return;
      samples++;
      let correction = 0;
      const add = (name, value) => {
        const stage = stages[name] ??= { max: 0, total: 0, ticks: 0 };
        stage.max = Math.max(stage.max, value);
        stage.total += value;
        stage.ticks += value > 1e-8;
        correction += value;
      };
      for (const [name, value] of Object.entries(rigidCorrectionStages(trace, layer, radius)))
        add(name, value);
      correctionTicks += correction > 1e-8;
      if (correction > maxCorrection) {
        maxCorrection = correction;
        maxCorrectionTick = tick;
      }
    },
    summary: () => ({ layer, bodyId, samples, correctionTicks,
      maxCorrection, maxCorrectionTick, stages }),
  };
}
