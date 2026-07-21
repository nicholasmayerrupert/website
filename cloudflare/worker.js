// Run before Cloudflare's asset cache so HTML and fingerprinted build assets get
// deliberately different browser-cache policies. A resumed tab may still hold
// an older index.html after a deploy; its hashed assets must remain usable from
// the browser cache instead of being revalidated against the new manifest.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
    const response = await env.ASSETS.fetch(assetRequest);
    const type = response.headers.get('content-type') || '';
    const isHtml = type.includes('text/html');
    const isAsset = url.pathname.startsWith('/assets/');

    const headers = new Headers(response.headers);
    if (isHtml || !response.ok) headers.set('cache-control', 'no-store');
    else if (isAsset) headers.set('cache-control', 'public, max-age=31556952, immutable');

    // SPA fallback returns index.html for unknown URLs. Never serve that HTML as
    // JavaScript: a stale deployment should fail loudly and let index.html's
    // bounded startup recovery fetch the current manifest.
    if (isAsset && isHtml) {
      headers.set('content-type', 'text/plain; charset=utf-8');
      return new Response(null, { status: 404, headers });
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
