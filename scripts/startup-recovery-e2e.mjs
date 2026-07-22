import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize } from 'node:path';
import { chromium, devices, webkit } from 'playwright';

const root = new URL('../dist/', import.meta.url);
const entries = await Promise.all([
  ['portfolio', '/', 'index.html', false],
  ['falling-sand case study', '/work/falling-sand/', 'work/falling-sand/index.html', false],
  ['sand game', '/game', 'index.html', true],
].map(async ([name, pathname, file, sandRuntime]) => {
  const currentHtml = await readFile(new URL(file, root), 'utf8');
  const entry = currentHtml.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i)?.[1];
  if (!entry) throw new Error(`${file} has no module entry`);
  return { name, pathname, sandRuntime, currentHtml, staleHtml: currentHtml.replace(entry, '/assets/removed-deployment.js') };
}));
const mime = {
  '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};
const documentCounts = new Map(entries.map(({ pathname }) => [pathname, 0]));

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const headers = {
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-resource-policy': 'same-origin',
  };
  const pageEntry = entries.find(({ pathname }) => pathname === url.pathname);
  if (pageEntry) {
    documentCounts.set(url.pathname, documentCounts.get(url.pathname) + 1);
    const body = url.searchParams.has('_startup') ? pageEntry.currentHtml : pageEntry.staleHtml;
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
for (const { name: entryName, pathname, sandRuntime } of entries) {
  const browsers = sandRuntime ? [['desktop Chromium', chromium, { viewport: { width: 1280, height: 800 } }]] : [
    ['mobile Chromium', chromium, devices['Pixel 7']],
    ['mobile WebKit', webkit, devices['iPhone 13']],
  ];
  for (const [name, browserType, device] of browsers) {
    const beforeDocuments = documentCounts.get(pathname);
    let browser;
    try {
      browser = await browserType.launch({ headless: true });
    } catch (error) {
      if (browserType === chromium || process.env.REQUIRE_WEBKIT === '1') throw error;
      console.log(`  skip ${entryName} ${name} (install with: npx playwright install --with-deps webkit)\n   ${error.message.split('\n')[0]}`);
      continue;
    }
    const context = await browser.newContext({ ...device });
    const page = await context.newPage();
    await page.goto(new URL(pathname.slice(1), baseURL).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__portfolioBooted === true, null, { timeout: 30000 });
    if (sandRuntime) {
      await page.waitForFunction(() => !!document.querySelector('sand-game')?._game, null, { timeout: 30000 });
      check(`${entryName} ${name} starts the production sand runtime`, true);
    }
    const state = await page.evaluate(() => ({
      cleanUrl: !location.search.includes('_startup'),
      retryCleared: sessionStorage.getItem('portfolio-startup-retry') === null,
      hasContent: !!document.getElementById('root')?.firstElementChild,
      href: location.href,
    }));
    const loadedDocuments = documentCounts.get(pathname) - beforeDocuments;
    check(`${entryName} ${name} automatically replaces stale HTML`, loadedDocuments === 2, `${loadedDocuments} documents`);
    check(`${entryName} ${name} reaches the current app`, state.hasContent, state.href);
    check(`${entryName} ${name} clears recovery state after boot`, state.cleanUrl && state.retryCleared, state.href);

    const href = page.url();
    await page.evaluate(() => window.dispatchEvent(new Event('unhandledrejection')));
    await page.waitForTimeout(100);
    check(`${entryName} ${name} ignores unrelated rejections after boot`, page.url() === href);
    await context.close();
    await browser.close();
  }
}

await new Promise((resolve) => server.close(resolve));
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
