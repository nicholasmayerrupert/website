import worker from '../cloudflare/worker.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
};

const html = '<!doctype html><div id="root"></div>';
const gameHtml = '<!doctype html><title>Sand Game</title><div id="root"></div>';
const caseStudyHtml = '<!doctype html><title>Falling Sand Engineering Case Study</title><div id="root"></div>';
let lastAssetPath = '';
let lastAssetEncoding = '';
const env = {
  ASSETS: {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      lastAssetPath = path;
      lastAssetEncoding = request.headers.get('accept-encoding') || '';
      if (path === '/') {
        return new Response(html, { headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=0, must-revalidate' } });
      }
      if (path === '/game/') {
        return new Response(gameHtml, { headers: { 'content-type': 'text/html' } });
      }
      if (path === '/work/falling-sand/') {
        return new Response(caseStudyHtml, { headers: { 'content-type': 'text/html' } });
      }
      if (path === '/assets/index-abc123.js') {
        return new Response('export default true', { headers: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=0, must-revalidate' } });
      }
      if (path === '/assets/sandEngine-abc123.wasm.br') {
        return new Response(new Uint8Array([27, 3, 0, 0]), { headers: { 'content-type': 'application/octet-stream' } });
      }
      if (path === '/favicon.svg') {
        return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
      }
      // Match Cloudflare's SPA fallback for an asset absent from this version.
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    },
  },
};

console.log('deployment cache policy');

const get = (path) => worker.fetch(new Request(`https://example.com${path}`), env);
const page = await get('/');
check('HTML is revalidated but remains eligible for history restoration',
  page.headers.get('cache-control') === 'no-cache', page.headers.get('cache-control'));

const asset = await get('/assets/index-abc123.js');
check('fingerprinted assets are immutable', asset.headers.get('cache-control') === 'public, max-age=31556952, immutable', asset.headers.get('cache-control'));
check('asset responses do not force cross-origin isolation',
  asset.headers.get('cross-origin-opener-policy') === null
  && asset.headers.get('cross-origin-embedder-policy') === null
  && asset.headers.get('cross-origin-resource-policy') === null);

const wasm = await get('/assets/sandEngine-abc123.wasm');
check('WASM resolves to its precompressed asset', lastAssetPath === '/assets/sandEngine-abc123.wasm.br', lastAssetPath);
check('precompressed WASM is read without a second encoding', lastAssetEncoding === 'identity', lastAssetEncoding);
check('fingerprinted WASM is immutable and byte-preserving', wasm.headers.get('cache-control') === 'public, max-age=31556952, immutable, no-transform', wasm.headers.get('cache-control'));
check('WASM keeps its streaming MIME type', wasm.headers.get('content-type') === 'application/wasm', wasm.headers.get('content-type'));
check('WASM is served as Brotli', wasm.headers.get('content-encoding') === 'br', wasm.headers.get('content-encoding'));

const game = await get('/game');
check('/game resolves its dedicated HTML entry without a redirect', game.status === 200 && (await game.text()).includes('Sand Game'));
check('/game is internally resolved as /game/', lastAssetPath === '/game/', lastAssetPath);
check('/game HTML is revalidated but remains eligible for history restoration',
  game.headers.get('cache-control') === 'no-cache', game.headers.get('cache-control'));

const caseStudy = await get('/work/falling-sand');
check('/work/falling-sand resolves its dedicated HTML entry without a redirect',
  caseStudy.status === 200 && (await caseStudy.text()).includes('Falling Sand Engineering Case Study'));
check('/work/falling-sand is internally resolved with a trailing slash',
  lastAssetPath === '/work/falling-sand/', lastAssetPath);
check('/work/falling-sand HTML is revalidated but remains eligible for history restoration',
  caseStudy.headers.get('cache-control') === 'no-cache', caseStudy.headers.get('cache-control'));

const missing = await get('/assets/removed-build.js');
check('missing old deployment asset is a real 404', missing.status === 404, String(missing.status));
check('missing asset response cannot be cached', missing.headers.get('cache-control') === 'no-store', missing.headers.get('cache-control'));
check('missing asset is not mislabeled as HTML', !missing.headers.get('content-type')?.includes('text/html'), missing.headers.get('content-type'));

const favicon = await get('/favicon.svg');
check('unfingerprinted public files keep the platform policy', favicon.headers.get('cache-control') !== 'public, max-age=31556952, immutable', favicon.headers.get('cache-control'));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
