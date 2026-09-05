import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileContent } from '../src/sand/content/compile.js';

const contentDir = resolve('src/sand/content');
const names = new Set(['world', 'player', 'creatureArt']);
const read = name => {
  const source = readFileSync(resolve(contentDir, `${name}.js`), 'utf8');
  return JSON.parse(source.slice(source.indexOf('export default ') + 15).trim().replace(/;$/, ''));
};

// A local development endpoint writes only validated authored data. It never
// accepts file paths or JavaScript, and is absent from production builds.
export function gameContentPlugin() {
  return {
    name: 'game-content-workbench',
    configureServer(server) {
      server.middlewares.use('/__game-content', (req, res) => {
        const respond = (code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
        if (req.method !== 'POST') { respond(405, { error: 'POST required' }); return; }
        const expectedOrigin = `http://${req.headers.host}`;
        if (req.headers.origin !== expectedOrigin || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) {
          respond(403, { error: 'Local same-origin editor requests only' }); return;
        }
        let body = '', tooLarge = false;
        req.on('data', chunk => {
          if (tooLarge) return;
          body += chunk;
          if (Buffer.byteLength(body) > 2 * 1024 * 1024) { tooLarge = true; respond(413, { error: 'Content too large' }); }
        });
        req.on('end', () => {
          if (tooLarge) return;
          try {
            const { name, data } = JSON.parse(body);
            if (!names.has(name)) throw new Error('Unknown content source');
            const sources = Object.fromEntries([...names].map(key => [key, key === name ? data : read(key)]));
            const result = compileContent(sources.world, sources.player, sources.creatureArt);
            writeFileSync(resolve(contentDir, `${name}.js`), `// Authored game content. Validated by content/compile.js.\nexport default ${JSON.stringify(data, null, 2)};\n`);
            respond(200, { hash: result.hash.toString(16) });
          } catch (error) { respond(400, { error: error.message }); }
        });
      });
    },
    handleHotUpdate({ file, server }) {
      if ([...names].some(name => file === resolve(contentDir, `${name}.js`))) {
        server.ws.send({ type: 'full-reload', path: '*' });
        return [];
      }
    },
  };
}
