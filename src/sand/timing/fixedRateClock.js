export const SIM_HZ = 60;
export const SIM_STEP_MS = 1000 / SIM_HZ;
export const ACTOR_STEP_MS = SIM_STEP_MS;
export const ACTOR_MAX_STEPS = 3;
export const ACTOR_MAX_DEBT_MS = 50;

// Retain fractional timer deadlines so integer-millisecond setTimeout calls
// alternate between 16 and 17 ms instead of truncating every 60 Hz turn to 16.
// A turn that runs past its following deadline starts one immediate turn, then
// resumes from a fresh interval instead of queuing every missed turn.
export function createTurnDeadline({ stepMs = SIM_STEP_MS, now = 0 } = {}) {
  let deadline = now + stepMs;

  const reset = (at = now) => { deadline = at + stepMs; };
  const nextDelay = (at) => {
    if (at >= deadline) {
      deadline = at + stepMs;
      return 0;
    }
    const delay = Math.max(0, deadline - at);
    deadline += stepMs;
    return delay;
  };

  return { nextDelay, reset };
}

// A small deterministic fixed-rate clock for real-time entities. It repays
// ordinary frame jitter (for example 20 ms render frames) but bounds recovery
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
