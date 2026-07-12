// Run before Cloudflare's asset cache so an old deployment cannot leave Safari
// with cached HTML at a hashed JavaScript URL. HTML is always revalidated at the
// origin; immutable hashed assets retain Cloudflare's normal asset caching.
export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const type = response.headers.get('content-type') || '';
    const isHtml = type.includes('text/html');
    const isAsset = new URL(request.url).pathname.startsWith('/assets/');

    if (isAsset && isHtml) return new Response(null, { status: 404 });
    if (!isHtml) return response;

    const headers = new Headers(response.headers);
    headers.set('cross-origin-opener-policy', 'same-origin');
    headers.set('cross-origin-embedder-policy', 'require-corp');
    headers.set('cache-control', 'no-store');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
