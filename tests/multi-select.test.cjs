const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'src', 'static', 'js', 'bible-renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'static', 'css', 'bible-theme.css'), 'utf8');
const marker = '  // 自动初始化';
assert.ok(script.includes(marker));
const testScript = script.slice(0, script.indexOf(marker)) + `
  window.setupVerses = function(multiple) {
    _currentBook = 1;
    _currentChapter = 1;
    _booksMeta = [{ index: 1, name: 'Genesis', acronym: 'Gen' }];
    _activeVersions = multiple ? ['zh-rcv', 'en-kjv'] : ['zh-rcv'];
    _langDisplayOrder = _activeVersions.slice();
    var chapter = { chapter: 1, verses: [
      { section: 1, content: '中文一{1}' },
      { section: 2, flag: 1, content: '中文二上' },
      { section: 2, flag: 2, content: '中文二下' }
    ] };
    _bookDataCache[1] = { chapters: [chapter] };
    _versionDataCache['en-kjv'] = { 1: { chapters: [{ chapter: 1, verses: [
      { section: 1, text: 'English one' },
      { section: 2, text: 'English two' }
    ] }] } };
    document.getElementById('app').innerHTML = _renderVerses(chapter, 'Gen', 1, 1);
    _bindVerseEvents();
  };
})();`;

test('multi-select copies individual language rows and selects all displayed rows', async () => {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><body><main id="app" style="padding:60px 0"></main></body></html>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const chrome = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
    const executablePath = process.env.CHROME_PATH || (fs.existsSync(chrome) ? chrome : chromium.executablePath());
    let browser;
    try {
        browser = await chromium.launch({ executablePath, headless: true });
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.addStyleTag({ content: css });
        await page.evaluate(() => {
            window.CXI18n = {
                t: key => key,
                tf: (key, values) => `${key}:${values.n}`
            };
            window.CX = {
                openDialog: ({ html }) => {
                    const mask = document.createElement('div');
                    mask.innerHTML = html;
                    document.body.appendChild(mask);
                    return { mask, close: () => mask.remove() };
                }
            };
            Object.defineProperty(navigator, 'clipboard', {
                value: { writeText: text => { window.copiedText = text; return Promise.resolve(); } }
            });
            Object.defineProperty(navigator, 'share', {
                value: ({ text }) => { window.sharedText = text; return Promise.resolve(); }
            });
        });
        await page.addScriptTag({ content: testScript });
        await page.evaluate(() => window.setupVerses(true));

        await page.locator('.bible-verse').first().locator('.verse-num').click();
        await page.locator('.verse-action-btn[data-action="multi"]').click();
        const rows = page.locator('.bible-verse-lang');
        assert.equal(await rows.count(), 5);
        assert.equal(await page.locator('.multi-select-count').textContent(), 'selected_count:1');
        assert.equal(await rows.nth(0).locator('.verse-checkbox.checked').count(), 1);
        assert.equal(await rows.nth(1).locator('.verse-checkbox.checked').count(), 0);
        await page.evaluate(() => {
            document.addEventListener('click', event => {
                if (event.target.classList.contains('fn-ref')) window.noteClicked = true;
            });
        });
        await rows.nth(0).locator('.fn-ref').click();
        assert.equal(await page.evaluate(() => !!window.noteClicked), false);
        assert.equal(await page.locator('.multi-select-count').textContent(), 'selected_count:0');
        await page.locator('.bible-verse').first().locator('.verse-num').click();
        assert.equal(await page.locator('.multi-select-count').textContent(), 'selected_count:1');

        const boxes = await page.evaluate(() => {
            const verse = document.querySelector('.bible-verse');
            return {
                num: verse.querySelector('.verse-num').getBoundingClientRect().toJSON(),
                first: verse.querySelector('.primary .verse-checkbox').getBoundingClientRect().toJSON(),
                second: verse.querySelector('.secondary .verse-checkbox').getBoundingClientRect().toJSON()
            };
        });
        assert.ok(boxes.first.right <= boxes.num.left, 'first checkbox must not overlap verse number');
        assert.ok(Math.abs(boxes.first.left - boxes.second.left) < 1, 'checkboxes align across languages');

        await rows.nth(1).locator('.verse-checkbox').click();
        await rows.nth(0).click();
        await rows.nth(4).click();
        assert.equal(await page.locator('.multi-select-count').textContent(), 'selected_count:2');
        await page.locator('.multi-select-action[data-action="copy"]').click();
        assert.equal(await page.evaluate(() => window.copiedText), 'Genesis 1:1  English one\nGenesis 1:2下  中文二下');
        await page.locator('.multi-select-action[data-action="share"]').click();
        assert.equal(await page.evaluate(() => window.sharedText), 'Genesis 1:1  English one\nGenesis 1:2下  中文二下');

        await page.locator('.multi-select-action[data-action="select-all"]').click();
        assert.equal(await page.locator('.verse-checkbox.checked').count(), 5);
        assert.equal(await page.locator('.multi-select-action[data-action="select-all"]').textContent(), 'deselect_all');
        await page.locator('.multi-select-action[data-action="copy"]').click();
        assert.equal(await page.evaluate(() => window.copiedText),
            'Genesis 1:1  中文一\nGenesis 1:1  English one\nGenesis 1:2上  中文二上\nGenesis 1:2上  English two\nGenesis 1:2下  中文二下');
        await page.locator('.multi-select-action[data-action="select-all"]').click();
        assert.equal(await page.locator('.verse-checkbox.checked').count(), 0);

        await rows.nth(1).click();
        await rows.nth(0).click();
        await page.locator('.multi-select-action[data-action="fav"]').click();
        const favorites = await page.evaluate(() => JSON.parse(localStorage.getItem('bible_favorites')));
        assert.equal(favorites.length, 1);
        assert.equal(favorites[0].verseText, '中文一');
        assert.equal(await page.locator('.verse-checkbox').count(), 0);

        await page.evaluate(() => window.setupVerses(false));
        await page.locator('.verse-num').first().click();
        await page.locator('.verse-action-btn[data-action="multi"]').click();
        await page.locator('.multi-select-action[data-action="select-all"]').click();
        await page.locator('.multi-select-action[data-action="copy"]').click();
        assert.equal(await page.evaluate(() => window.copiedText),
            'Genesis 1:1  中文一\nGenesis 1:2上  中文二上\nGenesis 1:2下  中文二下');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
