import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  GAME_CONTENT, GAME_WORLD, GAME_JOBS, GAME_SCENES, PLAYER_ART,
  PLAYER_PREVIEW, CREATURE_HEIGHTS,
} from '../src/sand/content/catalog.js';

// Production consumes the exact validated wire packet. Development keeps the
// source compiler and full art available to the live authoring workbench.
export function compiledContentPlugin({ inline = false } = {}) {
  let base = '/';
  return {
    name: 'compiled-game-content',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) { base = config.base; },
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        if (inline || context.path.includes('/work/')) return [];
        const entries = Object.values(context.bundle || {});
        const asset = entries.find(entry => entry.name === 'sand-content.bin');
        return asset ? [{ tag: 'link', attrs: {
          rel: 'preload', href: `${base}${asset.fileName}`, as: 'fetch', crossorigin: '',
        }, injectTo: 'head' }] : [];
      },
    },
    transform(_source, id) {
      if (id !== resolve('src/sand/content/catalog.js')) return null;
      const bytes = Buffer.from(GAME_CONTENT.packed.buffer, GAME_CONTENT.packed.byteOffset, GAME_CONTENT.packed.byteLength);
      let load;
      if (inline) {
        const encoded = gzipSync(bytes, { level: 9 }).toString('base64');
        load = `const bytes = Uint8Array.from(atob(${JSON.stringify(encoded)}), c => c.charCodeAt(0));
          const buffer = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();`;
      } else {
        const asset = this.emitFile({ type: 'asset', name: 'sand-content.bin', source: bytes });
        load = `const response = await fetch(import.meta.ROLLUP_FILE_URL_${asset});
          if (!response.ok) throw new Error('Game content download failed: ' + response.status);
          const buffer = await response.arrayBuffer();`;
      }
      return {
        code: `
          export const GAME_CONTENT = ${JSON.stringify({ hash: GAME_CONTENT.hash, anchors: GAME_CONTENT.anchors, scenes: GAME_SCENES })};
          export const GAME_WORLD = ${JSON.stringify(GAME_WORLD)};
          export const GAME_JOBS = ${JSON.stringify(GAME_JOBS)};
          export const GAME_SCENES = GAME_CONTENT.scenes;
          export const PLAYER_ART = ${JSON.stringify(PLAYER_ART)};
          export const PLAYER_PREVIEW = ${JSON.stringify(PLAYER_PREVIEW)};
          export const CREATURE_HEIGHTS = ${JSON.stringify(CREATURE_HEIGHTS)};
          let pending;
          export function initGameContent() {
            if (!pending) pending = (async () => {
              ${load}
              if (buffer.byteLength !== ${bytes.length}) throw new Error('Invalid game content length');
              const packed = new Int32Array(buffer);
              if (packed[0] !== ${GAME_CONTENT.packed[0]} || packed[1] !== ${GAME_CONTENT.packed[1]} || (packed[2] >>> 0) !== GAME_CONTENT.hash)
                throw new Error('Game content version mismatch');
              GAME_CONTENT.packed = packed;
              return GAME_CONTENT;
            })().catch(error => { pending = null; throw error; });
            return pending;
          }
        `,
        map: null,
      };
    },
  };
}
