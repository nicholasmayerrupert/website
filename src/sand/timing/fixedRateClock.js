export const ACTOR_HZ = 60;
export const ACTOR_STEP_MS = 1000 / ACTOR_HZ;
export const ACTOR_MAX_STEPS = 3;
export const ACTOR_MAX_DEBT_MS = 50;

// A small deterministic fixed-rate clock for real-time entities. It repays
// ordinary frame jitter (for example 20 ms world frames) but bounds recovery
// after a stall so actor catch-up can never become an avalanche.
export function createFixedRateClock({
  stepMs = ACTOR_STEP_MS,
  maxSteps = ACTOR_MAX_STEPS,
  maxDebtMs = ACTOR_MAX_DEBT_MS,
  now = 0,
} = {}) {
  let last = now;
  let debtMs = 0;
  let droppedDebtMs = 0;

  const reset = (at = last) => {
    last = at;
    debtMs = 0;
    droppedDebtMs = 0;
  };

  const advance = (at, step) => {
    const elapsed = Math.max(0, at - last);
    last = at;
    const nextDebt = debtMs + elapsed;
    droppedDebtMs = Math.max(0, nextDebt - maxDebtMs);
    debtMs = Math.min(maxDebtMs, nextDebt);

    let steps = 0;
    while (steps < maxSteps && debtMs + 1e-9 >= stepMs) {
      step();
      debtMs -= stepMs;
      steps++;
    }
    if (debtMs < 1e-9) debtMs = 0;
    return { steps, debtMs, droppedDebtMs };
  };

  return {
    advance,
    reset,
  };
}

// World work deliberately has no accumulator. A missed deadline is discarded,
// and the next deadline starts at the frame that actually got to run the step.
export function createNoCatchupGate({ stepMs = 16, now = 0 } = {}) {
  let last = now;
  return {
    take(at) {
      if (at - last < stepMs) return false;
      last = at;
      return true;
    },
    reset(at = last) { last = at; },
  };
}
