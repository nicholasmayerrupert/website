export const MAX_LIFE_SEARCH_WORKERS = 16;
export const MAX_LIFE_SEARCH_BATCH = 10000;
export const LIFE_SEARCH_PUMP_TARGET_MS = 12;

const numeric = (value, fallback) => {
  const converted = Number(value);
  return Number.isNaN(converted) ? fallback : converted;
};

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

export const getLifeSearchWorkerLimit = (
  hardwareConcurrency = globalThis.navigator?.hardwareConcurrency || 4,
) => Math.min(
  MAX_LIFE_SEARCH_WORKERS,
  Math.max(1, Math.round(hardwareConcurrency) - 2),
);

export const normalizeLifeSearchWorkers = (value, limit = MAX_LIFE_SEARCH_WORKERS) =>
  Math.min(limit, Math.max(1, Math.round(value) || 1));

export const normalizeLifeSearchSettings = (settings) => ({
  size: clamp(Math.round(numeric(settings.size, 16)), 3, 64),
  density: clamp(numeric(settings.density, 37.5), 0.01, 99.99),
  horizon: clamp(Math.trunc(numeric(settings.horizon, 0)), 0, 0x7fffffff),
  batchSize: clamp(
    Math.round(numeric(settings.batchSize, 32)),
    1,
    MAX_LIFE_SEARCH_BATCH,
  ),
  leaderboardSize: clamp(
    Math.round(numeric(settings.leaderboardSize, 10)),
    1,
    100,
  ),
});

export function tuneLifeSearchBatch(current, completed, elapsedMs) {
  const batch = clamp(Math.round(current) || 1, 1, MAX_LIFE_SEARCH_BATCH);
  if (!(completed > 0) || !(elapsedMs > 0)) return batch;
  const estimate = Math.round(completed * LIFE_SEARCH_PUMP_TARGET_MS / elapsedMs);
  const boundedEstimate = clamp(estimate, Math.floor(batch / 2), batch * 4);
  return clamp(
    Math.round((batch + boundedEstimate) / 2),
    1,
    MAX_LIFE_SEARCH_BATCH,
  );
}
