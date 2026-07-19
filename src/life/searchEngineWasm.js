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
    soupResultTransient: fn(module, 'life_soup_result_transient', 'number', ['number', 'number']),
    soupResultPeriod: fn(module, 'life_soup_result_period', 'number', ['number', 'number']),
    soupResultSerial: fn(module, 'life_soup_result_serial', 'number', ['number', 'number']),
    soupResultReason: fn(module, 'life_soup_result_reason', 'number', ['number', 'number']),
    soupResultCells: fn(module, 'life_soup_result_cells', 'number', ['number', 'number']),
    soupLoopResultCount: fn(module, 'life_soup_loop_result_count', 'number', ['number']),
    soupLoopResultLifetime: fn(module, 'life_soup_loop_result_lifetime', 'number', ['number', 'number']),
    soupLoopResultTransient: fn(module, 'life_soup_loop_result_transient', 'number', ['number', 'number']),
    soupLoopResultPeriod: fn(module, 'life_soup_loop_result_period', 'number', ['number', 'number']),
    soupLoopResultSerial: fn(module, 'life_soup_loop_result_serial', 'number', ['number', 'number']),
    soupLoopResultCells: fn(module, 'life_soup_loop_result_cells', 'number', ['number', 'number']),
    step: fn(module, 'life_step', null, ['number', 'number', 'number']),
    measureLifetime: fn(module, 'life_measure_lifetime', 'number', ['number', 'number', 'number']),
    measurePeriod: fn(module, 'life_measure_period', 'number', ['number', 'number', 'number']),
    measureTransient: fn(module, 'life_measure_transient', 'number', ['number', 'number', 'number']),
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
      const boundedHorizon = Math.min(0x7fffffff, Math.max(0, Math.trunc(horizon) || 0));
      api.startSoup(handle, Math.round(density * 100), boundedHorizon, low, high, leaderboardSize);
    },
    pumpSoup(batchSize) { return api.soupPump(handle, batchSize); },
    soupSnapshot() {
      const results = [];
      const count = api.soupResultCount(handle);
      for (let i = 0; i < count; i++) {
        results.push({
          lifetime: api.soupResultLifetime(handle, i),
          transient: api.soupResultTransient(handle, i),
          period: api.soupResultPeriod(handle, i),
          serial: api.soupResultSerial(handle, i),
          reason: api.soupResultReason(handle, i),
          cells: copyCells(api.soupResultCells(handle, i)),
        });
      }
      const loops = [];
      const loopCount = api.soupLoopResultCount(handle);
      for (let i = 0; i < loopCount; i++) {
        loops.push({
          lifetime: api.soupLoopResultLifetime(handle, i),
          transient: api.soupLoopResultTransient(handle, i),
          period: api.soupLoopResultPeriod(handle, i),
          serial: api.soupLoopResultSerial(handle, i),
          reason: 2,
          cells: copyCells(api.soupLoopResultCells(handle, i)),
        });
      }
      return { searched: api.soupsSearched(handle), results, loops };
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
    measureOrbit(cells, horizon) {
      const input = module._malloc(cellCount);
      module.HEAPU8.set(cells, input);
      const packed = api.measureLifetime(size, input, horizon);
      const period = api.measurePeriod(size, input, horizon);
      const transient = api.measureTransient(size, input, horizon);
      module._free(input);
      return { lifetime: packed >> 2, reason: packed & 3, transient, period };
    },
    stop() { api.stop(handle); },
    destroy() { api.destroy(handle); },
  };
}
