const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'src', 'static', 'index.html'), 'utf8');
const start = index.indexOf('    window.CX.pwaCache = (function(){');
const end = index.indexOf('\n    })();', start) + '\n    })();'.length;
assert.ok(start >= 0 && end > start, 'PWA cache module must exist');
const cacheModule = index.slice(start, end);
const updateScript = fs.readFileSync(path.join(root, 'src', 'static', 'js', 'app-update.js'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'src', 'templates', 'main_sw.js'), 'utf8')
    .replaceAll('{{APP_VERSION}}', '2.0.0');

test('PWA update preserves the old cache on failure and activates the complete new cache', async () => {
    let failedPath = '';
    let failureType = '';
    let assetVersion = 'new version';
    const pageHtml = `<!doctype html><html><body>
        <script>
        window.CX = {
            openDialog: function(options) {
                var dialog = document.createElement('div');
                dialog.innerHTML = options.html;
                document.body.appendChild(dialog);
                return { close: function() { dialog.remove(); } };
            },
            backStack: []
        };
        window.CX_ROOT = './';
        window.__cxCoreUrls = ['./', './js/test.js', './js/app-update.js'];
        ${cacheModule}
        ${updateScript}
        if (!location.search) navigator.serviceWorker.register('./sw.js');
        </script>
        </body></html>`;
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === failedPath) {
            res.writeHead(failureType === '404' ? 404 : 200, { 'Content-Type': 'text/html' });
            return res.end('not the requested resource');
        }
        if (url.pathname === '/sw.js') {
            res.writeHead(200, { 'Content-Type': 'application/javascript' });
            return res.end(serviceWorker);
        }
        if (url.pathname === '/' || url.pathname === '/index.html') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(pageHtml);
        }
        if (url.pathname === '/version.json') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end('{"version":"2.0.0"}');
        }
        if (url.pathname === '/js/app-update.js') {
            res.writeHead(200, { 'Content-Type': 'application/javascript' });
            return res.end(updateScript);
        }
        res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.js') ? 'application/javascript' : 'application/json' });
        res.end(url.pathname === '/js/test.js' ? assetVersion : '{}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const chrome = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
    const executablePath = process.env.CHROME_PATH || (fs.existsSync(chrome) ? chrome : chromium.executablePath());
    let browser;
    try {
        browser = await chromium.launch({ executablePath, headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();
        const base = `http://127.0.0.1:${server.address().port}/`;
        await page.goto(base);
        await page.waitForFunction(() => navigator.serviceWorker.controller);
        await page.evaluate(async () => {
            const old = await caches.open('cx-main');
            await old.put('./js/test.js', new Response('old version'));
            localStorage.setItem('cx_pwa_version', '1.0.0');
            const incomplete = await caches.open('cx-data-stage-incomplete');
            await incomplete.put('./js/test.js', new Response('incomplete version'));
        });
        assert.equal(await page.evaluate(() => fetch('./js/test.js').then(r => r.text())), 'old version');

        await page.evaluate(() => window.AppUpdate.showPwaUpdateDialog());
        await page.locator('#pwaUpdateBtn').waitFor({ state: 'visible' });
        failedPath = '/data/parsing/01.json';
        failureType = '404';
        await page.locator('#pwaUpdateBtn').click();
        await page.locator('#pwaCheckStatus').filter({ hasText: '更新失败' }).waitFor({ timeout: 10000 }).catch(async error => {
            throw new Error(`${error.message}\nStatus: ${await page.locator('#pwaCheckStatus').textContent()}`);
        });
        assert.equal(await page.evaluate(() => localStorage.getItem('cx_pwa_version')), '1.0.0');
        assert.equal(await page.evaluate(() => fetch('./js/test.js').then(r => r.text())), 'old version');

        failureType = 'html';
        await page.locator('#pwaUpdateBtn').click();
        await page.locator('#pwaCheckStatus').filter({ hasText: '更新失败' }).waitFor();
        assert.equal(await page.evaluate(() => localStorage.getItem('cx_pwa_version')), '1.0.0');

        failedPath = '';
        await page.evaluate(() => {
            const original = Storage.prototype.setItem;
            Storage.prototype.setItem = function(key, value) {
                if (key === 'cx_pwa_version') {
                    Storage.prototype.setItem = original;
                    throw new Error('storage unavailable');
                }
                return original.call(this, key, value);
            };
        });
        await page.locator('#pwaUpdateBtn').click();
        await page.locator('#pwaCheckStatus').filter({ hasText: '更新失败' }).waitFor();
        assert.equal(await page.evaluate(() => localStorage.getItem('cx_pwa_version')), '1.0.0');
        assert.equal(await page.evaluate(() => localStorage.getItem('cx_pwa_bucket')), null);
        assert.equal(await page.evaluate(() => fetch('./js/test.js').then(r => r.text())), 'old version');

        await Promise.all([
            page.waitForNavigation(),
            page.locator('#pwaUpdateBtn').click()
        ]);
        assert.equal(await page.evaluate(() => localStorage.getItem('cx_pwa_version')), '2.0.0');
        assert.equal(await page.evaluate(() => fetch('./js/test.js').then(r => r.text())), 'new version');
        const status = await page.evaluate(() => new Promise(resolve => {
            const channel = new MessageChannel();
            channel.port1.onmessage = event => resolve(event.data);
            navigator.serviceWorker.controller.postMessage({ type: 'CACHE_STATUS' }, [channel.port2]);
        }));
        assert.equal(status.cachedBooks, 66);
        assetVersion = 'later version';
        assert.equal(await page.evaluate(() => fetch('./js/test.js', { cache: 'no-store' }).then(r => r.text())), 'later version');

        failedPath = '/data/parsing/01.json';
        failureType = '404';
        const failedUpdate = await page.evaluate(() => window.CX.pwaCache.install('update', null, '3.0.0'));
        assert.equal(failedUpdate.failed, 1);
        assert.equal(await page.evaluate(() => localStorage.getItem('cx_pwa_version')), '2.0.0');
        assert.equal(await page.evaluate(() => fetch('./js/test.js').then(r => r.text())), 'new version');

        await context.setOffline(true);
        await page.reload();
        assert.equal(await page.evaluate(() => fetch('./js/test.js').then(r => r.text())), 'new version');
        assert.equal(await page.evaluate(() => fetch('./data/parsing/01.json').then(r => r.status)), 200);
        await context.close();

        const legacyContext = await browser.newContext();
        const legacyPage = await legacyContext.newPage();
        await legacyPage.goto(base + '?seed');
        await legacyPage.evaluate(async () => {
            const old = await caches.open('cx-main');
            await old.put('./js/test.js', new Response('old version'));
            const installed = await caches.open('cx-data-2.0.0');
            await installed.put('./js/test.js', new Response('installed version'));
            await navigator.serviceWorker.register('./sw.js');
        });
        await legacyPage.waitForFunction(() => navigator.serviceWorker.controller);
        assert.equal(await legacyPage.evaluate(() => fetch('./js/test.js').then(r => r.text())), 'installed version');
        await legacyContext.close();
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
