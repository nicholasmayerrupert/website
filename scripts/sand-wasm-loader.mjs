// Node-only preload for selecting a diagnostic engine without changing imports.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

if (!process.env.SAND_WASM_LOADER) throw new Error('SAND_WASM_LOADER is required');
const loader = pathToFileURL(resolve(process.env.SAND_WASM_LOADER)).href;
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    const result = await nextResolve(specifier, context);
    if (result.url.endsWith('/src/sand/wasm/sandEngine.js'))
      return { url: ${JSON.stringify(loader)}, shortCircuit: true };
    return result;
  }
`), import.meta.url);
