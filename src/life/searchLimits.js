export const MAX_LIFE_SEARCH_WORKERS = 16;

export const normalizeLifeSearchWorkers = (value) =>
  Math.min(MAX_LIFE_SEARCH_WORKERS, Math.max(1, Math.round(value) || 1));
