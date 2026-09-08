import { SIM_STEP_MS } from '../timing/fixedRateClock.js';

// Render one confirmed actor tick behind the newest snapshot. No velocity
// extrapolation runs beyond an authority position or through an unseen impact.
// Snapshot times use the authority clock mapped to the browser time origin;
// main-thread message batching does not restart their presentation intervals.
export function createActorPresentation({ stride, fields, kind, extraX = [], extraY = [] }) {
  let previous = null, current = null;
  const buffers = [new Float32Array(0), new Float32Array(0)];
  let bufferIndex = 0;
  let lastSample = null, lastKey = '';
  const reset = () => { previous = current = lastSample = null; lastKey = ''; };
  const push = (data, tick, at, offsetX = 0, offsetY = 0) => {
    if (current && tick < current.tick) reset();
    // Intent replies can repeat an actor tick. They update its facts without
    // turning that tick into its own predecessor or restarting its render time.
    if (!current || tick !== current.tick) previous = current;
    else at = current.at;
    current = { data: Float32Array.from(data), tick, at, offsetX, offsetY, ids: new Map() };
    for (let i = 0; i < data.length; i += stride) current.ids.set(data[i + fields.id], i);
    lastKey = '';
  };
  const sample = (at, offsetX = 0, offsetY = 0, interpolate = true) => {
    if (!current) return null;
    if (!interpolate) previous = null;
    const ticks = previous ? current.tick - previous.tick : 0;
    const span = ticks * SIM_STEP_MS;
    const alpha = interpolate && span > 0
      ? Math.max(0, Math.min(1, (at - current.at + span - SIM_STEP_MS) / span)) : 1;
    const key = `${alpha}:${offsetX}:${offsetY}`;
    if (key === lastKey) return lastSample;
    lastKey = key;
    bufferIndex ^= 1;
    let out = buffers[bufferIndex];
    if (out.length !== current.data.length) out = buffers[bufferIndex] = new Float32Array(current.data.length);
    out.set(current.data);
    const dx = current.offsetX - offsetX, dy = current.offsetY - offsetY;
    for (let i = 0; i < out.length; i += stride) {
      out[i + fields.x] += dx; out[i + fields.y] += dy;
      for (const field of extraX) out[i + field] += dx;
      for (const field of extraY) out[i + field] += dy;
      if (alpha === 1 || !previous) continue;
      const j = previous.ids.get(out[i + fields.id]);
      if (j === undefined || previous.data[j + kind] !== out[i + kind]) continue;
      const x = previous.data[j + fields.x] + previous.offsetX - offsetX;
      const y = previous.data[j + fields.y] + previous.offsetY - offsetY;
      const travel = Math.hypot(out[i + fields.x] - x, out[i + fields.y] - y);
      const speed = Math.max(Math.hypot(out[i + fields.vx], out[i + fields.vy]),
        Math.hypot(previous.data[j + fields.vx], previous.data[j + fields.vy]));
      // Discontinuous relocation is not travel. Allow one cell per tick for
      // collision/support projection and snapshot rounding beyond velocity.
      if (travel > (speed + 1) * ticks) continue;
      out[i + fields.x] = x + (out[i + fields.x] - x) * alpha;
      out[i + fields.y] = y + (out[i + fields.y] - y) * alpha;
    }
    lastSample = out;
    return out;
  };
  return { push, sample, reset };
}
