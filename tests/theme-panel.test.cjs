const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'src', 'static', 'js', 'bible-renderer.js'), 'utf8');
const themeScript = fs.readFileSync(path.join(root, 'src', 'static', 'js', 'theme-toggle.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'static', 'css', 'bible-theme.css'), 'utf8');
const marker = '  // \u81ea\u52a8\u521d\u59cb\u5316';
assert.ok(script.includes(marker));
const testScript = script.slice(0, script.indexOf(marker)) + `
  window.setupPanelReading = function() {
    _booksMeta = [{ index: 1, name: 'Genesis', acronym: 'Gen', chapters: 1 }];
    _availableVersions = [
      { lang: 'zh-rcv', label: 'RCV', bundled: true },
      { lang: 'en-kjv', label: 'KJV', bundled: true },
      { lang: 'zh-cuv', label: 'CUV', bundled: true }
    ];
    _bookDataCache[1] = { chapters: [{ chapter: 1, verses: [
      { section: 1, content: 'RCV one' }
    ] }] };
    _versionDataCache['en-kjv'] = { 1: { chapters: [{ chapter: 1, verses: [
      { section: 1, text: 'KJV one' }
    ] }] } };
    _versionDataCache['zh-cuv'] = { 1: { chapters: [{ chapter: 1, verses: [
      { section: 1, text: 'CUV one' }
    ] }] } };
    _topicsData = {};
    _introData = {};
    _outlinesData = {};
    window.CXBible.setActiveVersions(['zh-rcv', 'en-kjv']);
    renderBibleView(1, 1, true);
  };
})();`;

test('language changes and reordering keep the settings panel open without disabling normal closing', async () => {
    const server = http.createServer((req, res) => {
        if (req.url !== '/') {
            res.writeHead(404);
            res.end();
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><body class="cx-bible-page"><main id="app"></main>'
            + '<div id="bottomToolbar" style="position:fixed;bottom:0;left:0">'
            + '<button id="settingsButton" onclick="toggleThemePanel()">Settings</button></div></body></html>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const chrome = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
    const executablePath = process.env.CHROME_PATH || (fs.existsSync(chrome) ? chrome : chromium.executablePath());
    let browser;
    try {
        browser = await chromium.launch({ executablePath, headless: true });
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.addStyleTag({ content: css });
        await page.evaluate(() => {
            window.CXI18n = { t: key => key, tf: key => key };
            window._cxShowApp = () => { document.getElementById('app').style.display = ''; };
            localStorage.setItem('bible_primary_lang', 'zh-rcv');
        });
        await page.addScriptTag({ content: testScript });
        await page.evaluate(() => window.setupPanelReading());
        await page.locator('#app .bible-verse').first().waitFor();
        await page.addScriptTag({ content: themeScript });
        await page.locator('#settingsButton').click();

        const actions = [
            ['lang-activate', 'zh-cuv', ['zh-rcv', 'en-kjv', 'zh-cuv']],
            ['lang-move-down', 'en-kjv', ['zh-rcv', 'zh-cuv', 'en-kjv']],
            ['lang-move-up', 'en-kjv', ['zh-rcv', 'en-kjv', 'zh-cuv']],
            ['lang-move-up', 'en-kjv', ['en-kjv', 'zh-rcv', 'zh-cuv']],
            ['lang-deactivate', 'zh-cuv', ['en-kjv', 'zh-rcv']]
        ];
        for (const [action, lang, order] of actions) {
            await page.locator(`#cxLangList [data-action="${action}"][data-lang="${lang}"]`).click();
            assert.equal(await page.locator('#themePanel.show').count(), 1, `${action} keeps the panel open`);
            assert.equal(await page.locator('#themePanelOverlay.show').count(), 1);
            assert.equal(await page.evaluate(() => window.CX.backStack.size()), 1);
            assert.equal(await page.evaluate(() => document.body.classList.contains('cx-scroll-locked')), true);
            assert.deepEqual(await page.locator('#cxLangList .cx-lang-row[data-lang]')
                .evaluateAll(rows => rows.map(row => row.dataset.lang)), order);
            assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('bible_active_versions'))), order);
            await page.waitForFunction(expected => {
                const rows = document.querySelectorAll('#app .bible-verse-lang');
                return JSON.stringify(Array.from(rows, row => row.dataset.lang)) === JSON.stringify(expected);
            }, order);
        }

        await page.locator('.theme-panel-close').click();
        assert.equal(await page.locator('#themePanel.show').count(), 0);
        assert.equal(await page.locator('#themePanelOverlay.show').count(), 0);
        assert.equal(await page.evaluate(() => window.CX.backStack.size()), 0);
        assert.equal(await page.evaluate(() => document.body.classList.contains('cx-scroll-locked')), false);

        await page.locator('#settingsButton').click();
        await page.locator('#themePanelOverlay').click({ position: { x: 10, y: 10 } });
        assert.equal(await page.locator('#themePanel.show').count(), 0);

        await page.locator('#settingsButton').click();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#themePanel.show').count(), 0);

        await page.locator('#settingsButton').click();
        await page.evaluate(() => history.back());
        await page.locator('#themePanel:not(.show)').waitFor({ state: 'attached' });
        assert.equal(await page.evaluate(() => window.CX.backStack.size()), 0);
        assert.equal(await page.evaluate(() => document.body.classList.contains('cx-scroll-locked')), false);
        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
