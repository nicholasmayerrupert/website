import worker from '../cloudflare/worker.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
};

const html = '<!doctype html><div id="root"></div>';
const env = {
  ASSETS: {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/') {
        return new Response(html, { headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=0, must-revalidate' } });
      }
      if (path === '/assets/index-abc123.js') {
        return new Response('export default true', { headers: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=0, must-revalidate' } });
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
check('HTML is never stored by the browser', page.headers.get('cache-control') === 'no-store', page.headers.get('cache-control'));

const asset = await get('/assets/index-abc123.js');
check('fingerprinted assets are immutable', asset.headers.get('cache-control') === 'public, max-age=31556952, immutable', asset.headers.get('cache-control'));
check('asset responses do not force cross-origin isolation',
  asset.headers.get('cross-origin-opener-policy') === null
  && asset.headers.get('cross-origin-embedder-policy') === null
  && asset.headers.get('cross-origin-resource-policy') === null);

const missing = await get('/assets/removed-build.js');
check('missing old deployment asset is a real 404', missing.status === 404, String(missing.status));
check('missing asset response cannot be cached', missing.headers.get('cache-control') === 'no-store', missing.headers.get('cache-control'));
check('missing asset is not mislabeled as HTML', !missing.headers.get('content-type')?.includes('text/html'), missing.headers.get('content-type'));

const favicon = await get('/favicon.svg');
check('unfingerprinted public files keep the platform policy', favicon.headers.get('cache-control') !== 'public, max-age=31556952, immutable', favicon.headers.get('cache-control'));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
