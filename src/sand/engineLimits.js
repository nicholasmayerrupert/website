// Hard engine limits shared by viewport sizing, packet validation, and the
// WASM adapter. The C++ boundary independently enforces the same limits.
export const ENGINE_MAX_DIMENSION = 16384;
export const ENGINE_MAX_CELLS = 8_000_000;
