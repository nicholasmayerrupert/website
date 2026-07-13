import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize } from 'node:path';
import { chromium, devices, webkit } from 'playwright';

const root = new URL('../dist/', import.meta.url);
const currentHtml = await readFile(new URL('index.html', root), 'utf8');
const entry = currentHtml.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i)?.[1];
if (!entry) throw new Error('production index has no module entry');
const staleHtml = currentHtml.replace(entry, '/assets/removed-deployment.js');
const mime = {
  '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
};
let initialDocuments = 0;

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const headers = {
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-resource-policy': 'same-origin',
  };
  if (url.pathname === '/') {
    initialDocuments++;
    const body = url.searchParams.has('_startup') ? currentHtml : staleHtml;
    response.writeHead(200, { ...headers, 'content-type': mime['.html'], 'cache-control': 'no-store' });
    response.end(body);
    return;
  }
  if (url.pathname === '/assets/removed-deployment.js') {
    response.writeHead(404, { ...headers, 'content-type': 'text/plain', 'cache-control': 'no-store' });
    response.end();
    return;
  }
  try {
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
    const body = await readFile(new URL(relative, root));
    response.writeHead(200, { ...headers, 'content-type': mime[extname(relative)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404, { ...headers, 'content-type': 'text/plain' });
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const baseURL = `http://127.0.0.1:${address.port}/`;

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
};

console.log('stale deployment startup recovery');
for (const [name, browserType, device] of [
  ['mobile Chromium', chromium, devices['Pixel 7']],
  ['mobile WebKit', webkit, devices['iPhone 13']],
]) {
  const beforeDocuments = initialDocuments;
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__portfolioBooted === true, null, { timeout: 30000 });
  const state = await page.evaluate(() => ({
    cleanUrl: !location.search.includes('_startup'),
    retryCleared: sessionStorage.getItem('portfolio-startup-retry') === null,
    hasContent: !!document.getElementById('root')?.firstElementChild,
    href: location.href,
  }));
  check(`${name} automatically replaces stale HTML`, initialDocuments - beforeDocuments === 2, `${initialDocuments - beforeDocuments} documents`);
  check(`${name} reaches the current app`, state.hasContent, state.href);
  check(`${name} clears recovery state after boot`, state.cleanUrl && state.retryCleared, state.href);

  const href = page.url();
  await page.evaluate(() => window.dispatchEvent(new Event('unhandledrejection')));
  await page.waitForTimeout(100);
  check(`${name} ignores unrelated rejections after boot`, page.url() === href);
  await context.close();
  await browser.close();
}

await new Promise((resolve) => server.close(resolve));
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
