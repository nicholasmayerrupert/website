let modulePromise = null;

export async function initLifeSearchWasm() {
  if (!modulePromise) {
    modulePromise = import('./wasm/lifeSearch.js')
      .then(({ default: createLifeSearchModule }) => createLifeSearchModule());
  }
  return modulePromise;
}

const fn = (module, name, result, args) => module.cwrap(name, result, args);

export async function createLifeSearchEngine(size) {
  const module = await initLifeSearchWasm();
  const api = {
    create: fn(module, 'life_create', 'number', ['number']),
    destroy: fn(module, 'life_destroy', null, ['number']),
    stop: fn(module, 'life_stop', null, ['number']),
    startSoup: fn(module, 'life_start_soup', null, ['number', 'number', 'number', 'number', 'number', 'number']),
    soupPump: fn(module, 'life_soup_pump', 'number', ['number', 'number']),
    soupsSearched: fn(module, 'life_soups_searched', 'number', ['number']),
    soupResultCount: fn(module, 'life_soup_result_count', 'number', ['number']),
    soupResultLifetime: fn(module, 'life_soup_result_lifetime', 'number', ['number', 'number']),
    soupResultReason: fn(module, 'life_soup_result_reason', 'number', ['number', 'number']),
    soupResultCells: fn(module, 'life_soup_result_cells', 'number', ['number', 'number']),
    startReverse: fn(module, 'life_start_reverse', null, ['number', 'number', 'number', 'number', 'number']),
    reversePump: fn(module, 'life_reverse_pump', 'number', ['number', 'number']),
    reverseStatus: fn(module, 'life_reverse_status', 'number', ['number']),
    reverseCurrentDepth: fn(module, 'life_reverse_current_depth', 'number', ['number']),
    reverseBestLength: fn(module, 'life_reverse_best_length', 'number', ['number']),
    reverseBestLayer: fn(module, 'life_reverse_best_layer', 'number', ['number', 'number']),
    reverseParents: fn(module, 'life_reverse_parents', 'number', ['number']),
    reverseBacktracks: fn(module, 'life_reverse_backtracks', 'number', ['number']),
    reverseCyclePrunes: fn(module, 'life_reverse_cycle_prunes', 'number', ['number']),
    reverseGoeLeaves: fn(module, 'life_reverse_goe_leaves', 'number', ['number']),
    reverseDepthCuts: fn(module, 'life_reverse_depth_cuts', 'number', ['number']),
    reverseConflicts: fn(module, 'life_reverse_conflicts', 'number', ['number']),
    step: fn(module, 'life_step', null, ['number', 'number', 'number']),
    measureLifetime: fn(module, 'life_measure_lifetime', 'number', ['number', 'number', 'number']),
  };
  const handle = api.create(size);
  if (!handle) throw new Error('Unable to create Life search engine');
  const cellCount = size * size;

  const copyCells = (pointer) => pointer
    ? module.HEAPU8.slice(pointer, pointer + cellCount)
    : new Uint8Array(cellCount);
  const splitSeed = (seed) => [Number(seed & 0xffffffffn), Number((seed >> 32n) & 0xffffffffn)];

  return {
    size,
    startSoup({ density, horizon, seed, leaderboardSize }) {
      const [low, high] = splitSeed(seed);
      api.startSoup(handle, Math.round(density * 100), horizon, low, high, leaderboardSize);
    },
    pumpSoup(batchSize) { return api.soupPump(handle, batchSize); },
    soupSnapshot() {
      const results = [];
      const count = api.soupResultCount(handle);
      for (let i = 0; i < count; i++) {
        results.push({
          lifetime: api.soupResultLifetime(handle, i),
          reason: api.soupResultReason(handle, i),
          cells: copyCells(api.soupResultCells(handle, i)),
        });
      }
      return { searched: api.soupsSearched(handle), results };
    },
    startReverse(cells, { maxDepth, seed }) {
      const pointer = module._malloc(cellCount);
      module.HEAPU8.set(cells, pointer);
      const [low, high] = splitSeed(seed);
      api.startReverse(handle, pointer, maxDepth, low, high);
      module._free(pointer);
    },
    pumpReverse(conflictBudget) { return api.reversePump(handle, conflictBudget); },
    reverseSnapshot(includeBest = false) {
      const bestLength = api.reverseBestLength(handle);
      const snapshot = {
        status: api.reverseStatus(handle),
        currentDepth: api.reverseCurrentDepth(handle),
        bestDepth: Math.max(0, bestLength - 1),
        parents: api.reverseParents(handle),
        backtracks: api.reverseBacktracks(handle),
        cyclePrunes: api.reverseCyclePrunes(handle),
        goeLeaves: api.reverseGoeLeaves(handle),
        depthCuts: api.reverseDepthCuts(handle),
        conflicts: api.reverseConflicts(handle),
      };
      if (includeBest) {
        snapshot.layers = Array.from({ length: bestLength }, (_, index) =>
          copyCells(api.reverseBestLayer(handle, index)));
      }
      return snapshot;
    },
    step(cells) {
      const input = module._malloc(cellCount);
      const output = module._malloc(cellCount);
      module.HEAPU8.set(cells, input);
      api.step(size, input, output);
      const result = copyCells(output);
      module._free(input);
      module._free(output);
      return result;
    },
    measureLifetime(cells, horizon) {
      const input = module._malloc(cellCount);
      module.HEAPU8.set(cells, input);
      const packed = api.measureLifetime(size, input, horizon);
      module._free(input);
      return { lifetime: packed >> 2, reason: packed & 3 };
    },
    stop() { api.stop(handle); },
    destroy() { api.destroy(handle); },
  };
}
