// Run before Cloudflare's asset cache so HTML and fingerprinted build assets get
// deliberately different browser-cache policies. HTML may be stored for browser
// history restoration but must be revalidated for ordinary requests. Hashed
// assets remain usable from the browser cache across deployments.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isAsset = url.pathname.startsWith('/assets/');
    const isWasm = isAsset && url.pathname.endsWith('.wasm');
    // Dedicated Vite HTML entries resolve internally so visitors keep canonical
    // extensionless URLs without paying for redirect round trips.
    let assetRequest = request;
    const entryPath = url.pathname === '/game' ? '/game/'
      : url.pathname === '/work/falling-sand' ? '/work/falling-sand/'
      : null;
    if (entryPath) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = entryPath;
      assetRequest = new Request(assetUrl, request);
    }
    // Production builds include a quality-11 Brotli sibling for each WASM file.
    // The public URL stays fingerprinted with the uncompressed module hash.
    if (isWasm) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname += '.br';
      assetRequest = new Request(assetUrl, request);
      assetRequest.headers.set('accept-encoding', 'identity');
    }
    const response = await env.ASSETS.fetch(assetRequest);
    const type = response.headers.get('content-type') || '';
    const isHtml = type.includes('text/html');

    const headers = new Headers(response.headers);
    if (!response.ok) headers.set('cache-control', 'no-store');
    else if (isHtml) headers.set('cache-control', 'no-cache');
    else if (isAsset) headers.set('cache-control', 'public, max-age=31556952, immutable');

    // SPA fallback returns index.html for unknown URLs. Never serve that HTML as
    // JavaScript: a stale deployment should fail loudly and let index.html's
    // bounded startup recovery fetch the current manifest.
    if (isAsset && isHtml) {
      headers.set('content-type', 'text/plain; charset=utf-8');
      headers.set('cache-control', 'no-store');
      return new Response(null, { status: 404, headers });
    }

    if (isWasm) {
      headers.set('content-type', 'application/wasm');
      headers.set('content-encoding', 'br');
      headers.set('cache-control', 'public, max-age=31556952, immutable, no-transform');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
      ...(isWasm ? { encodeBody: 'manual' } : {}),
    });
  },
};
