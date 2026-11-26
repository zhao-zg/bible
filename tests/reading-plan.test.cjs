const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const bibleScript = fs.readFileSync(path.join(root, 'src', 'static', 'js', 'bible-renderer.js'), 'utf8');
const planScript = fs.readFileSync(path.join(root, 'src', 'static', 'js', 'reading-plan.js'), 'utf8');
const marker = '  // 自动初始化';
assert.ok(bibleScript.includes(marker));

function app(saved = {}, fetchBook) {
    const storage = new Map(Object.entries(saved));
    const listeners = new Map();
    const requests = [];
    const shards = {
        'en-darby': { chapters: [{ chapter: 1, verses: [{ section: 1, text: 'Darby & text' }] }] },
        'en-kjv': { chapters: [{ chapter: 1, verses: [{ section: 1, text: 'KJV text' }] }] },
        'en-rcv': { chapters: [{ chapter: 1, verses: [{ section: 1, text: 'Recovery text' }] }] },
        'ko-rcv': { chapters: [{ chapter: 1, verses: [{ section: 1, text: '태초에 하나님께서' }] }] },
        'zh-hant-rcv': { chapters: [{ chapter: 1, verses: [{ section: 1, content: '{1}繁體經文' }] }] }
    };
    const names = {
        en: { '1': { full: 'Genesis', short: 'Gen' } },
        'ko-rcv': { '1': { full: '창세기', short: '창' } },
        'zh-hant-rcv': { '1': { full: '創世記', short: '創' } }
    };
    const window = {
        CX_ROOT: './',
        addEventListener(name, listener) {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(listener);
        },
        dispatchEvent(event) {
            for (const listener of listeners.get(event.type) || []) listener(event);
        }
    };
    const context = vm.createContext({
        window,
        document: {
            readyState: 'loading', addEventListener() {}, getElementById() { return null; },
            body: { classList: { contains() { return false; } } }
        },
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value)
        },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        console: { log() {}, warn() {}, error() {} },
        fetch: async url => {
            requests.push(url);
            const match = /data\/bible\/([^/]+)\/01\.json/.exec(url);
            const data = match ? (fetchBook ? await fetchBook(match[1], shards) : shards[match[1]])
                : url.includes('book-names-i18n') ? names : {};
            assert.ok(data, 'Unexpected request: ' + url);
            return { ok: true, json: async () => data };
        }
    });
    vm.runInContext(bibleScript.slice(0, bibleScript.indexOf(marker)) + `
        window.restoreVersionsForTest = _restoreActiveVersions;
    })();`, context);
    vm.runInContext(planScript.replace(/\}\)\(window\);\s*$/, `
        win.planTest = {
            loadChapter, loadBooksI18n, bookName, bookAcronym, _primaryDataFile,
            renderEntry: _renderEntryVersesHtml,
            prefetch: _precachAdjacentDays,
            setupPrefetch(inst, plan) {
                _currentInstId = inst.id;
                _currentDay = 2;
                _planData = { plans: [plan] };
            },
            cachedDays() { return Object.keys(_preRenderedDayHtml); }
        };
    })(window);`), context);
    return { bible: window.CXBible, plan: window.planTest, restore: window.restoreVersionsForTest, storage, requests };
}

test('English primary versions synchronize from saved order and later version switches', () => {
    const { bible, restore, storage } = app({
        bible_active_versions: JSON.stringify(['en-kjv', 'zh-hant-rcv']),
        bible_primary_lang: 'zh-hant-rcv'
    });
    restore();
    assert.equal(storage.get('bible_primary_lang'), 'en-kjv');
    for (const lang of ['en-darby', 'en-kjv', 'en-rcv', 'zh-hant-rcv']) {
        bible.setActiveVersions([lang, 'zh-rcv']);
        assert.equal(bible.getPrimaryLang(), lang);
        assert.equal(storage.get('bible_primary_lang'), lang);
    }
});

test('daily reading loads English verse text and shared English book names', async () => {
    const { bible, plan, requests } = app();
    await plan.loadBooksI18n();
    const entry = { book: 1, book_to: 1, chapter: 1, chapter_to: 1, section: 1, section_to: 1 };
    for (const [lang, expected] of [
        ['en-darby', 'Darby &amp; text'],
        ['en-kjv', 'KJV text'],
        ['en-rcv', 'Recovery text']
    ]) {
        bible.setActiveVersions([lang, 'zh-rcv']);
        const data = await plan.loadChapter(1);
        const html = plan.renderEntry(entry, [{ bookIndex: 1, data }], null, null);
        assert.ok(html.includes(`data-lang="${lang}"`), lang);
        assert.ok(html.includes(expected), lang);
        assert.equal(html.includes('fn-ref'), false, lang);
        assert.equal(plan.bookName(1), 'Genesis', lang);
        assert.equal(plan.bookAcronym(1), 'Gen', lang);
        assert.equal(plan._primaryDataFile('bible-topics.json'), 'data/bible-topics.json', lang);
        assert.ok(requests.some(url => url.includes(`data/bible/${lang}/01.json`)), lang);
    }
    bible.setActiveVersions(['zh-hant-rcv', 'zh-rcv']);
    const data = await plan.loadChapter(1);
    const html = plan.renderEntry(entry, [{ bookIndex: 1, data }], null, null);
    assert.ok(html.includes('data-vkey="創1:1" data-fn="1"'));
    assert.ok(html.includes('繁體經文'));
    assert.equal(plan._primaryDataFile('bible-topics.json'), 'data/bible-topics-hant.json');
});

test('old adjacent-day requests cannot repopulate caches after switching language', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const { bible, plan, storage } = app({}, async (lang, shards) => {
        if (lang === 'en-darby') await pending;
        return shards[lang];
    });
    bible.setActiveVersions(['en-darby', 'zh-hant-rcv']);
    const inst = { id: 'language-test', type: 'one', planIds: ['one'], startDate: '2026-01-01', year: 2026, completed: {} };
    storage.set('cx_reading_plans', JSON.stringify([inst]));
    plan.setupPrefetch(inst, { id: 'one', entries: [1, 2, 3].map(d => ({
        d, book: 1, book_to: 1, chapter: 1, chapter_to: 1, section: 1, section_to: 1
    })) });
    plan.prefetch();
    bible.setPrimaryVersion('zh-hant-rcv');
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(Array.from(plan.cachedDays()), []);
});

test('Korean primary restores and renders daily reading with Korean book names', async () => {
    const { bible, plan, restore, requests, storage } = app({
        bible_active_versions: JSON.stringify(['ko-rcv', 'en-rcv']),
        bible_primary_lang: 'en-rcv'
    });
    restore();
    assert.equal(bible.getPrimaryLang(), 'ko-rcv');
    assert.equal(storage.get('bible_primary_lang'), 'ko-rcv');
    await plan.loadBooksI18n();
    const data = await plan.loadChapter(1);
    const entry = { book: 1, book_to: 1, chapter: 1, chapter_to: 1, section: 1, section_to: 1 };
    const html = plan.renderEntry(entry, [{ bookIndex: 1, data }], null, null);
    assert.ok(html.includes('data-lang="ko-rcv"'));
    assert.ok(html.includes('태초에 하나님께서'));
    assert.equal(html.includes('fn-ref'), false);
    assert.equal(html.includes('xref-ref'), false);
    assert.equal(plan.bookName(1), '창세기');
    assert.equal(plan.bookAcronym(1), '창');
    assert.equal(plan._primaryDataFile('bible-topics.json'), 'data/bible-topics.json');
    assert.ok(requests.some(url => url.includes('data/bible/ko-rcv/01.json')));
    bible.setActiveVersions(['en-rcv', 'ko-rcv']);
    bible.setPrimaryVersion('ko-rcv');
    assert.equal(bible.getPrimaryLang(), 'ko-rcv');
});

async function navigationPage(t, pwa = false) {
    const days = [1, 2, 3, 4];
    const data = {
        '/data/bible-books.json': [{ index: 1, name: 'Genesis', acronym: 'Gen' }],
        '/data/bible-versions.json': [{ lang: 'zh-rcv', label: 'RCV', bundled: true }],
        '/data/bible/01.json': { book_index: 1, chapters: days.map(chapter => ({
            chapter, verses: [{ section: 1, content: 'Chapter ' + chapter }]
        })) },
        '/data/reading-plans.json': { plans: [{ id: 'one', name: 'Plan', entries: days.map(d => ({
            d, book: 1, book_to: 1, chapter: d, chapter_to: d, section: 1, section_to: 1
        })) }] },
        '/data/book-names-i18n.json': {},
        '/data/bible-intro.json': {},
        '/data/bible-topics.json': {},
        '/data/bible-outlines.json': {}
    };
    const server = http.createServer((req, res) => {
        if (req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<!doctype html><html><body><main id="app"></main></body></html>');
        } else if (Object.hasOwn(data, req.url)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data[req.url]));
        } else {
            res.writeHead(404);
            res.end();
        }
    });
    let browser;
    t.after(async () => {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const chrome = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
    const executablePath = process.env.CHROME_PATH || (fs.existsSync(chrome) ? chrome : chromium.executablePath());
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.goto(`http://127.0.0.1:${server.address().port}/#/bible/1/2`);
    await page.evaluate(pwa => {
        window._cxShowApp = () => { document.getElementById('app').style.display = ''; };
        if (pwa) {
            window.matchMedia = query => ({ matches: query === '(display-mode: standalone)' });
            window.systemBack = () => history.back();
        } else {
            window.Capacitor = { Plugins: { App: {
                addListener(name, handler) { if (name === 'backButton') window.systemBack = handler; },
                exitApp() { window.exitCalls = (window.exitCalls || 0) + 1; }
            } } };
        }
        localStorage.setItem('cx_reading_plans', JSON.stringify([{
            id: 'back-test', type: 'one', planIds: ['one'], year: 2026,
            startDate: '2026-01-01', completed: {}
        }]));
    }, pwa);
    const themeScript = fs.readFileSync(path.join(root, 'src', 'static', 'js', 'theme-toggle.js'), 'utf8');
    const stackStart = themeScript.lastIndexOf('(function()', themeScript.indexOf('    var _stack = [];'));
    assert.ok(stackStart >= 0);
    await page.addScriptTag({ content: themeScript.slice(stackStart, themeScript.indexOf('\n})();', stackStart) + 6) });
    await page.addScriptTag({ content: bibleScript.slice(0, bibleScript.indexOf(marker)) + '})();' });
    await page.addScriptTag({ content: planScript });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'src', 'static', 'js', 'router.js'), 'utf8') });
    const navScript = fs.readFileSync(path.join(root, 'src', 'static', 'js', 'nav-stack.js'), 'utf8');
    await page.addScriptTag({ content: navScript.slice(0, navScript.indexOf('})();') + 5) });
    await page.evaluate(() => {
        CXReadingPlan.init();
        CXRouter.start();
        CXNavStack.initHomePage();
    });
    await page.locator('#app .bible-verse').waitFor();
    await page.waitForLoadState('networkidle');
    return page;
}

async function openPlanDay(page, day = 2) {
    await page.evaluate(day => CXRouter.navigate('reading-plan/back-test/' + day), day);
    await page.waitForFunction(day =>
        document.querySelector('.center-page .bible-verse-lang')?.textContent === 'Chapter ' + day, day);
}

async function swipePlanDay(page, back = false) {
    await page.evaluate(back => {
        const target = document.querySelector('.center-page .bible-verse-lang');
        for (const [type, x] of [['touchstart', 300], ['touchmove', 50], ['touchend', 50]]) {
            const touch = new Touch({ identifier: 1, target, clientX: x, clientY: 200 });
            target.dispatchEvent(new TouchEvent(type, {
                bubbles: true, touches: type === 'touchend' ? [] : [touch], changedTouches: [touch]
            }));
        }
        if (back) window.systemBack();
    }, back);
}

async function waitForBible(page) {
    await page.waitForFunction(() =>
        location.hash === '#/bible/1/2' && document.body.classList.contains('cx-bible-page')
        && document.querySelector('#app .bible-verse-lang')?.textContent === 'Chapter 2');
}

for (const reopen of [false, true]) {
    test(`system back during initial plan loading ignores the old render${reopen ? ' after reopening' : ''}`, async t => {
        const page = await navigationPage(t);
        let release, requested, oldRequest, calls = 0;
        const pending = new Promise(resolve => { release = resolve; });
        const started = new Promise(resolve => { requested = resolve; });
        await page.route('**/data/reading-plans.json', async route => {
            if (++calls === 1) {
                oldRequest = route.request();
                requested();
                await pending;
            }
            await route.continue();
        });
        await page.evaluate(() => CXRouter.navigate('reading-plan/back-test/2'));
        await started;
        await page.evaluate(() => window.systemBack());
        await waitForBible(page);
        if (reopen) await openPlanDay(page, 1);
        const response = page.waitForResponse(response => response.request() === oldRequest);
        release();
        await response;
        await page.waitForLoadState('networkidle');
        if (reopen) {
            assert.equal(await page.locator('.center-page .bible-verse-lang').textContent(), 'Chapter 1');
        } else {
            assert.equal(await page.locator('.rp-container').count(), 0);
            assert.equal(await page.locator('#app .bible-verse-lang').textContent(), 'Chapter 2');
        }
    });
}

test('system back during a stale plan refresh cannot redraw the daily reading page', async t => {
    const page = await navigationPage(t);
    let release, requested, calls = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { requested = resolve; });
    await page.route('**/data/reading-plans.json', async route => {
        if (++calls === 1) {
            await route.fulfill({ json: { plans: [] } });
        } else {
            requested();
            await pending;
            await route.continue();
        }
    });
    await page.evaluate(() => CXRouter.navigate('reading-plan/back-test/2'));
    await started;
    await page.evaluate(() => window.systemBack());
    await waitForBible(page);
    const response = page.waitForResponse('**/data/reading-plans.json');
    release();
    await response;
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('.rp-container').count(), 0);
    assert.equal(await page.locator('#app .bible-verse-lang').textContent(), 'Chapter 2');
});

for (const pwa of [false, true]) {
    test(`${pwa ? 'PWA' : 'native'} system back during a swipe keeps the normal chapter and route`, async t => {
        const page = await navigationPage(t, pwa);
        await openPlanDay(page);
        await swipePlanDay(page, true);
        await waitForBible(page);
        await page.waitForTimeout(300);
        assert.equal(await page.evaluate(() => location.hash), '#/bible/1/2');
        assert.equal(await page.locator('.rp-container').count(), 0);
        assert.equal(await page.locator('#app .bible-verse-lang').textContent(), 'Chapter 2');
    });
}

test('reopening a plan after system back ignores the old swipe and still allows new swipes', async t => {
    const page = await navigationPage(t);
    await openPlanDay(page);
    await swipePlanDay(page, true);
    await waitForBible(page);
    await openPlanDay(page, 1);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => location.hash), '#/reading-plan/back-test/1');
    assert.equal(await page.locator('.center-page .bible-verse-lang').textContent(), 'Chapter 1');
    await swipePlanDay(page);
    await page.waitForFunction(() => location.hash === '#/reading-plan/back-test/2');
    assert.equal(await page.locator('.center-page .bible-verse-lang').textContent(), 'Chapter 2');
});
