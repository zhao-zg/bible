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
            renderTheme: _renderThemeTextForPlan,
            renderOutlines: _renderOutlinesForSection,
            buildDayHtml: _buildDayInnerHtml,
            setPlanData(data) { _planData = data; },
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

test('reading-plan metadata is shown only for Chinese Recovery Version primary languages', () => {
    const { bible, plan } = app();
    const entry = { book: 1, book_to: 1, chapter: 1, chapter_to: 1, section: 1, section_to: 1 };
    const chapters = [{ bookIndex: 1, data: { chapters: [{
        chapter: 1, verses: [{ section: 1, content: 'Verse text' }]
    }] } }];

    for (const [lang, introText, topicText] of [
        ['zh-rcv', '著者　摩西', '主题内容'],
        ['zh-hant-rcv', '著者　摩西', '主題內容']
    ]) {
        bible.setActiveVersions([lang, 'en-rcv']);
        const html = plan.renderEntry(entry, chapters, { '1': { '1': introText } }, { '1': topicText });
        assert.ok(html.includes('bible-metadata'), lang);
        assert.ok(html.includes('bible-theme-text'), lang);
        assert.ok(html.includes(topicText), lang);
        assert.ok(plan.renderOutlines([{ section: 1, level: 1, text: '纲目内容' }], 1), lang);
    }

    for (const lang of ['en-darby', 'en-kjv', 'en-rcv', 'ko-rcv']) {
        bible.setActiveVersions([lang, 'zh-rcv']);
        const html = plan.renderEntry(entry, chapters, { '1': { '1': '著者　摩西' } }, { '1': '主题内容' });
        assert.equal(html.includes('bible-metadata'), false, lang);
        assert.equal(html.includes('bible-theme-text'), false, lang);
        assert.equal(plan.renderTheme(1, { '1': '主题内容' }, 'Gen'), '', lang);
        assert.equal(plan.renderOutlines([{ section: 1, level: 1, text: '纲目内容' }], 1), '', lang);
    }
});

test('unsupported all-topics fallback renders the empty-day state instead of a blank topic section', () => {
    const { bible, plan } = app();
    plan.setPlanData({ plans: [{ id: 'empty', entries: [] }] });
    const inst = { id: 'empty-plan', planIds: ['empty'], year: 2025, completed: {} };

    bible.setActiveVersions(['en-rcv', 'zh-rcv']);
    const englishHtml = plan.buildDayHtml(inst, 365);
    assert.ok(englishHtml.includes('rp-empty-day'));
    assert.equal(englishHtml.includes('rp-reading-heading'), false);
    assert.equal(englishHtml.includes('rp-topic-loading'), false);

    bible.setActiveVersions(['zh-rcv', 'en-rcv']);
    const chineseHtml = plan.buildDayHtml(inst, 365);
    assert.ok(chineseHtml.includes('rp-reading-heading'));
    assert.ok(chineseHtml.includes('rp-topic-loading'));
});

async function navigationPage(t, pwa = false, startInPlan = false) {
    const days = [1, 2, 3, 4];
    const data = {
        '/data/bible-books.json': [{ index: 1, name: 'Genesis', acronym: 'Gen', chapters: 4 }],
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
    const indexHtml = fs.readFileSync(path.join(root, 'src', 'static', 'index.html'), 'utf8');
    const toolbarButton = indexHtml.match(/<button id="readingPlanToolbarBtn"[^]*?<\/button>/)[0];
    const server = http.createServer((req, res) => {
        if (req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<!doctype html><html><body><main id="app"></main>' + toolbarButton + '</body></html>');
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
    await page.goto(`http://127.0.0.1:${server.address().port}/#/${startInPlan ? 'reading-plan/back-test/2' : 'bible/1/2'}`);
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
    await page.locator(startInPlan ? '.center-page .bible-verse' : '#app .bible-verse').waitFor();
    await page.waitForLoadState('networkidle');
    return page;
}

test('real startup registers the app and PWA back handlers', async t => {
    const chrome = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
    const executablePath = process.env.CHROME_PATH || (fs.existsSync(chrome) ? chrome : chromium.executablePath());
    const browser = await chromium.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const data = {
        '/data/bible-books.json': [{ index: 1, name: 'Genesis', acronym: 'Gen', chapters: 2 }],
        '/data/bible-versions.json': [{ lang: 'zh-rcv', label: 'RCV', bundled: true }],
        '/data/bible/01.json': { chapters: [1, 2].map(chapter => ({
            chapter, verses: [{ section: 1, content: 'Chapter ' + chapter }]
        })) },
        '/data/reading-plans.json': { plans: [] },
        '/data/book-names-i18n.json': {},
        '/data/bible-intro.json': {},
        '/data/bible-topics.json': {},
        '/data/bible-outlines.json': {}
    };
    for (const [mode, restore] of [['app', false], ['app', true], ['pwa', false]]) {
        const page = await browser.newPage();
        await page.addInitScript(({ mode, restore }) => {
            if (mode === 'app') {
                window.backListeners = 0;
                window.Capacitor = { Plugins: { App: {
                    addListener(name, handler) {
                        if (name === 'backButton') { window.backListeners++; window.systemBack = handler; }
                    },
                    getInfo() { return Promise.resolve({ version: 'test' }); },
                    exitApp() { window.exitCalls = (window.exitCalls || 0) + 1; }
                } } };
            } else {
                const matchMedia = window.matchMedia.bind(window);
                window.matchMedia = query => query === '(display-mode: standalone)'
                    ? { matches: true, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }
                    : matchMedia(query);
            }
            if (restore) {
                localStorage.setItem('cx_last_page', location.origin + '/index.html#/bible/1/2');
                localStorage.setItem('cx_last_page_time', String(Date.now()));
            }
        }, { mode, restore });
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'startup.test') return route.abort();
            if (Object.hasOwn(data, url.pathname)) return route.fulfill({ json: data[url.pathname] });
            const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
            const file = path.join(root, 'src', 'static', name);
            if (!file.startsWith(path.join(root, 'src', 'static') + path.sep)
                || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
                return route.fulfill({ status: 404, body: '' });
            }
            return route.fulfill({ path: file });
        });
        await page.goto('http://startup.test/index.html' + (restore ? '' : '#/bible/1/1'));
        await page.locator('#app .bible-verse').first().waitFor();
        if (mode === 'app') {
            assert.equal(await page.evaluate(() => window.backListeners), 1);
            if (restore) assert.equal(await page.evaluate(() => location.hash), '#/bible/1/2');
            await page.evaluate(() => window.systemBack());
            assert.equal(await page.evaluate(() => window.exitCalls), 1);
        } else {
            assert.equal(await page.evaluate(() => typeof CX.backStack._fallback), 'function');
        }
        await page.close();
    }
});

for (const chapter of [2, 3]) {
    test(`book drawer selecting chapter ${chapter} leaves no stale back callback`, async t => {
        const page = await navigationPage(t);
        await page.evaluate(() => CXBible.showBookDrawer());
        await page.locator(`.chapter-list-item[data-book="1"][data-chapter="${chapter}"]`).click();
        await page.waitForURL(`**/#/bible/1/${chapter}`);
        assert.equal(await page.evaluate(() => CX.backStack.size()), 0);
        await page.evaluate(() => window.systemBack());
        assert.equal(await page.evaluate(() => window.exitCalls), 1);
    });
}

test('book drawer close button removes its back callback', async t => {
    const page = await navigationPage(t);
    await page.evaluate(() => CXBible.showBookDrawer());
    await page.locator('.bible-drawer-close').click();
    assert.equal(await page.evaluate(() => CX.backStack.size()), 0);
    await page.evaluate(() => window.systemBack());
    assert.equal(await page.evaluate(() => window.exitCalls), 1);
});

for (const pwa of [false, true]) {
    test(`${pwa ? 'PWA' : 'app'} back closes plan drawer and create dialog before leaving the plan`, async t => {
        const page = await navigationPage(t, pwa);
        await openPlanDay(page);
        await page.locator('[data-action="toggle-drawer"]').click();
        await page.evaluate(() => window.systemBack());
        await page.waitForFunction(() => {
            const drawer = document.querySelector('#rpDrawer');
            return drawer && !drawer.classList.contains('open');
        });
        assert.equal(await page.evaluate(() => location.hash), '#/reading-plan/back-test/2');
        await page.evaluate(() => CXReadingPlan.showCreateDialog());
        await page.evaluate(() => window.systemBack());
        await page.locator('#rpCreateDialog').waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => location.hash), '#/reading-plan/back-test/2');
        await page.evaluate(() => window.systemBack());
        await waitForBible(page);
        if (!pwa) {
            await page.waitForTimeout(60);
            await page.evaluate(() => window.systemBack());
            assert.equal(await page.evaluate(() => window.exitCalls), 1);
        }
    });
}

test('closing plan overlays with their controls clears the back stack', async t => {
    const page = await navigationPage(t);
    await openPlanDay(page);
    await page.locator('[data-action="toggle-drawer"]').click();
    await page.locator('[data-action="drawer-tab"][data-tab="records"]').click();
    await page.locator('[data-action="show-create"]').click();
    assert.equal(await page.evaluate(() => CX.backStack.size()), 1);
    await page.locator('#rpCreateDialog [data-action="close-dialog"]').click();
    assert.equal(await page.evaluate(() => CX.backStack.size()), 0);
    await page.evaluate(() => window.systemBack());
    await waitForBible(page);
});

test('leaving the plan through the toolbar cleans up its open dialog', async t => {
    const page = await navigationPage(t);
    await openPlanDay(page);
    await page.evaluate(() => CXReadingPlan.showCreateDialog());
    await page.evaluate(() => window._cxSubPageBack());
    await waitForBible(page);
    assert.equal(await page.locator('#rpCreateDialog').count(), 0);
    assert.equal(await page.evaluate(() => CX.backStack.size()), 0);
    await page.evaluate(() => window.systemBack());
    assert.equal(await page.evaluate(() => window.exitCalls), 1);
});

test('toolbar switches between the daily plan and the previous scripture chapter', async t => {
    const page = await navigationPage(t);
    await page.addStyleTag({ path: path.join(root, 'src', 'static', 'css', 'bible-theme.css') });
    const button = page.locator('#readingPlanToolbarBtn');
    assert.equal(await button.getAttribute('aria-label'), '读经计划');
    assert.equal(await button.locator('.toolbar-plan-icon').isVisible(), true);
    assert.equal(await button.locator('.toolbar-scripture-icon').isVisible(), false);
    await button.click();
    await page.locator('.center-page .bible-verse').waitFor();
    assert.equal(await button.getAttribute('title'), '返回经文');
    assert.equal(await button.getAttribute('aria-label'), '返回经文');
    assert.equal(await button.locator('.toolbar-plan-icon').isVisible(), false);
    assert.equal(await button.locator('.toolbar-scripture-icon').isVisible(), true);
    await button.click();
    await waitForBible(page);
    assert.equal(await button.getAttribute('aria-label'), '读经计划');
    assert.equal(await button.locator('.toolbar-plan-icon').isVisible(), true);
});

test('toolbar returns from an empty or directly opened reading plan', async t => {
    const page = await navigationPage(t, false, true);
    const button = page.locator('#readingPlanToolbarBtn');
    assert.equal(await button.getAttribute('aria-label'), '返回经文');
    await button.click();
    await page.waitForFunction(() => location.hash === '#/bible/1/1'
        && document.querySelector('#app .bible-verse-lang')?.textContent === 'Chapter 1');
    await page.evaluate(() => localStorage.removeItem('cx_reading_plans'));
    await button.click();
    await page.locator('.rp-empty').waitFor();
    assert.equal(await button.getAttribute('aria-label'), '返回经文');
    await button.click();
    await page.waitForFunction(() => location.hash === '#/bible/1/1'
        && document.querySelector('#app .bible-verse-lang')?.textContent === 'Chapter 1');
});

test('the empty reading-plan page keeps all four choices together with tappable arrows', async t => {
    const page = await navigationPage(t);
    await page.addStyleTag({ path: path.join(root, 'src', 'static', 'css', 'bible-theme.css') });
    await page.evaluate(() => {
        localStorage.removeItem('cx_reading_plans');
        CXRouter.navigate('reading-plan');
    });
    await page.locator('.rp-empty').waitFor();
    const cards = page.locator('.rp-container > .rp-type-list > .rp-type-card');
    assert.deepEqual(await cards.evaluateAll(elements => elements.map(card => card.dataset.type)),
        ['one', 'two', 'four', 'six']);
    const layout = await cards.evaluateAll(elements => elements.map(card => {
        const bounds = card.getBoundingClientRect();
        const arrow = card.querySelector('.rp-type-arrow')?.getBoundingClientRect();
        return { x: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
            arrowInside: arrow && arrow.left >= bounds.left && arrow.right <= bounds.right
                && arrow.top >= bounds.top && arrow.bottom <= bounds.bottom };
    }));
    for (const [i, card] of layout.entries()) {
        assert.ok(card.arrowInside, `Arrow for choice ${i + 1} should be inside its card`);
        assert.equal(card.x, layout[0].x);
        assert.equal(card.right, layout[0].right);
        if (i > 0) {
            const gap = card.top - layout[i - 1].bottom;
            assert.ok(gap >= 0 && gap <= 20, `Unexpected gap before choice ${i + 1}: ${gap}px`);
        }
    }
    await cards.first().locator('.rp-type-arrow').tap();
    await page.waitForURL('**/#/reading-plan/*/*');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cx_reading_plans'))[0].type), 'one');
});

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

for (const failed of [false, true]) {
    test(`read button waits for all daily passages${failed ? ' and stays hidden on failure' : ''}`, async t => {
        const page = await navigationPage(t);
        const entry = (d, book) => ({ d, book, book_to: book, chapter: 1, chapter_to: 1, section: 1, section_to: 1 });
        await page.route('**/data/reading-plans.json', route => route.fulfill({ json: {
            plans: [{ id: 'one', name: 'Plan', entries: [entry(1, 1), entry(2, 1), entry(2, 2), entry(3, 1)] }]
        } }));
        let release, requested;
        const pending = new Promise(resolve => { release = resolve; });
        const started = new Promise(resolve => { requested = resolve; });
        await page.route('**/data/bible/02.json', async route => {
            requested();
            await pending;
            if (failed) return route.fulfill({ status: 503, body: 'unavailable' });
            return route.fulfill({ json: { chapters: [{ chapter: 1, verses: [{ section: 1, content: 'Second passage' }] }] } });
        });
        try {
            await page.evaluate(() => CXRouter.navigate('reading-plan/back-test/2'));
            await started;
            await page.locator('.center-page .bible-verse').first().waitFor();
            assert.equal(await page.locator('.center-page .rp-btn-read').count(), 0);
            release();
            if (failed) {
                await page.locator('.center-page .rp-verses-empty').waitFor();
                assert.equal(await page.locator('.center-page .rp-btn-read').count(), 0);
            } else {
                const button = page.locator('.center-page .rp-btn-read');
                await button.waitFor();
                assert.equal(await page.locator('.center-page .bible-verse').count(), 2);
                assert.equal(await page.locator('.center-page .bible-reading').evaluate(el =>
                    el.lastElementChild.className), 'rp-read-bar-inline');
                await button.click();
                assert.equal(await button.isDisabled(), true);
                assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('cx_reading_plans'))[0].completed['2']));
                await page.evaluate(() => CXRouter.navigate('reading-plan/back-test/3'));
                await page.locator('.center-page .rp-btn-read').waitFor();
                await page.evaluate(() => CXRouter.navigate('reading-plan/back-test/2'));
                await button.waitFor();
                assert.equal(await button.isDisabled(), true);
            }
        } finally {
            release();
        }
    });
}

test('swiping to a still-loading preview waits to render the read button', async t => {
    const page = await navigationPage(t);
    const entry = (d, book) => ({ d, book, book_to: book, chapter: 1, chapter_to: 1, section: 1, section_to: 1 });
    await page.route('**/data/reading-plans.json', route => route.fulfill({ json: {
        plans: [{ id: 'one', name: 'Plan', entries: [entry(1, 1), entry(2, 2), entry(3, 1)] }]
    } }));
    let release, requested;
    const pending = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { requested = resolve; });
    await page.route('**/data/bible/02.json', async route => {
        requested();
        await pending;
        return route.fulfill({ json: { chapters: [{ chapter: 1, verses: [{ section: 1, content: 'Second passage' }] }] } });
    });
    try {
        await page.evaluate(() => CXRouter.navigate('reading-plan/back-test/1'));
        await page.locator('.center-page .bible-verse').waitFor();
        await started;
        assert.equal(await page.locator('.right-page .rp-btn-read').count(), 0);
        await swipePlanDay(page);
        await page.waitForURL('**/#/reading-plan/back-test/2');
        assert.equal(await page.locator('.center-page .rp-btn-read').count(), 0);
        release();
        await page.locator('.center-page .rp-btn-read').waitFor();
        assert.equal(await page.locator('.center-page .bible-verse-lang').textContent(), 'Second passage');
    } finally {
        release();
    }
});

test('toolbar shows the date bar on the first frame while plan data is loading', async t => {
    const page = await navigationPage(t);
    await page.addStyleTag({ path: path.join(root, 'src', 'static', 'css', 'bible-theme.css') });
    const watchFirstFrame = () => page.evaluate(() => {
        window.firstDateFrame = new Promise(resolve => {
            const observer = new MutationObserver(() => {
                if (!document.querySelector('.rp-date-bar')) return;
                observer.disconnect();
                requestAnimationFrame(() => {
                    const bar = document.querySelector('.rp-date-bar');
                    const rect = bar.getBoundingClientRect();
                    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                    resolve({
                        opacity: Number(getComputedStyle(bar.parentElement).opacity),
                        onTop: !!hit && bar.contains(hit)
                    });
                });
            });
            observer.observe(document.getElementById('app'), { childList: true });
        });
    });
    let release, requested;
    const pending = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { requested = resolve; });
    await page.route('**/data/reading-plans.json', async route => {
        requested();
        await pending;
        await route.continue();
    });
    try {
        await watchFirstFrame();
        await page.locator('#readingPlanToolbarBtn').click();
        await started;
        const firstFrame = await page.evaluate(() => window.firstDateFrame);
        assert.equal(firstFrame.opacity, 1, JSON.stringify(firstFrame));
        assert.equal(firstFrame.onTop, true, JSON.stringify(firstFrame));
        assert.equal(await page.locator('.rp-verses-loading').isVisible(), true);
    } finally {
        release();
    }
    await page.locator('.center-page .bible-verse').waitFor();
    assert.equal(await page.locator('.rp-date-bar').isVisible(), true);
    await page.locator('#readingPlanToolbarBtn').click();
    await waitForBible(page);
    await watchFirstFrame();
    await page.locator('#readingPlanToolbarBtn').click();
    const cachedFrame = await page.evaluate(() => window.firstDateFrame);
    assert.equal(cachedFrame.opacity, 1, JSON.stringify(cachedFrame));
    assert.equal(cachedFrame.onTop, true, JSON.stringify(cachedFrame));
    await page.locator('.center-page .bible-verse').waitFor();
});

test('daily date appears before plan data and stays visible when the content loads', async t => {
    const page = await navigationPage(t);
    await page.addStyleTag({ path: path.join(root, 'src', 'static', 'css', 'bible-theme.css') });
    await page.addStyleTag({ content: '.rp-date-bar { padding-top: 40px; }' });
    let release, requested;
    const pending = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { requested = resolve; });
    await page.route('**/data/reading-plans.json', async route => {
        requested();
        await pending;
        await route.continue();
    });
    try {
        await page.evaluate(() => {
            window.splashDismissals = 0;
            window._dismissSplash = () => { window.splashDismissals++; };
            CXRouter.navigate('reading-plan/back-test/2');
        });
        await started;
        assert.equal(await page.evaluate(() => window.splashDismissals), 1);
        assert.equal(await page.locator('.rp-date-label').textContent(), '1月2日');
        assert.equal(await page.locator('.rp-date-label').isVisible(), true);
        assert.equal(await page.locator('.rp-sidebar-btn').isDisabled(), true);
        assert.equal(await page.locator('.rp-verses-loading').textContent(), '加载中…');
        assert.equal(await page.locator('.bible-verse').count(), 0);
        const bounds = await page.evaluate(() => ({
            barBottom: document.querySelector('.rp-date-bar').getBoundingClientRect().bottom,
            loadingTop: document.querySelector('.rp-verses-loading').getBoundingClientRect().top
        }));
        assert.ok(bounds.loadingTop >= bounds.barBottom, JSON.stringify(bounds));
        await page.setViewportSize({ width: 844, height: 390 });
        const landscapeBounds = await page.evaluate(() => ({
            barBottom: document.querySelector('.rp-date-bar').getBoundingClientRect().bottom,
            loadingTop: document.querySelector('.rp-verses-loading').getBoundingClientRect().top
        }));
        assert.ok(landscapeBounds.loadingTop >= landscapeBounds.barBottom, JSON.stringify(landscapeBounds));
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.rp-container')).opacity === '1');
        await page.evaluate(() => {
            window.initialPlanBar = document.querySelector('.rp-date-bar');
            window.initialPlanContainer = document.querySelector('.rp-container');
        });
        await page.evaluate(() => window.dispatchEvent(new Event('cx:primaryLangChanged')));
    } finally {
        release();
    }
    await page.locator('.center-page .bible-verse').waitFor();
    assert.equal(await page.locator('.rp-date-label').textContent(), '1月2日');
    assert.equal(await page.locator('#app').evaluate(el => el.style.opacity), '1');
    assert.equal(await page.locator('.rp-sidebar-btn').isEnabled(), true);
    assert.equal(await page.evaluate(() => window.initialPlanBar === document.querySelector('.rp-date-bar')
        && window.initialPlanContainer === document.querySelector('.rp-container')), true);
    assert.equal(await page.locator('.rp-container').evaluate(el => getComputedStyle(el).opacity), '1');
});

test('the early date updates in place when loaded plan data clamps the requested day', async t => {
    const page = await navigationPage(t);
    let release, requested;
    const pending = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { requested = resolve; });
    await page.route('**/data/reading-plans.json', async route => {
        requested();
        await pending;
        await route.continue();
    });
    try {
        await page.evaluate(() => CXRouter.navigate('reading-plan/back-test/999'));
        await started;
        assert.equal(await page.locator('.rp-date-label').textContent(), '12月30日');
        await page.evaluate(() => { window.initialPlanBar = document.querySelector('.rp-date-bar'); });
    } finally {
        release();
    }
    await page.waitForURL('**/#/reading-plan/back-test/4');
    await page.locator('.center-page .bible-verse').waitFor();
    assert.equal(await page.locator('.rp-date-label').textContent(), '1月4日');
    assert.equal(await page.evaluate(() => window.initialPlanBar === document.querySelector('.rp-date-bar')), true);
});

for (const [type, total] of [['one', 364], ['two', 728], ['four', 121], ['six', 182]]) {
    test(`early ${type} plan date clamps to the actual plan end`, async t => {
        const entries = JSON.parse(fs.readFileSync(path.join(root, 'resource', `plan-${type}.json`), 'utf8'));
        assert.equal(Math.max(...entries.map(entry => entry.d)), total);
        const page = await navigationPage(t);
        let release, requested;
        const pending = new Promise(resolve => { release = resolve; });
        const started = new Promise(resolve => { requested = resolve; });
        await page.route('**/data/reading-plans.json', async route => {
            requested();
            await pending;
            await route.fulfill({ json: { plans: [{ id: type, name: type, entries: [{
                d: total, book: 1, book_to: 1, chapter: 1, chapter_to: 1, section: 1, section_to: 1
            }] }] } });
        });
        try {
            await page.evaluate(type => {
                localStorage.setItem('cx_reading_plans', JSON.stringify([{
                    id: 'back-test', type, planIds: [type], year: 2026,
                    startDate: '2026-01-01', completed: {}
                }]));
                CXRouter.navigate('reading-plan/back-test/999');
            }, type);
            await started;
            const end = new Date(2026, 0, total);
            const expected = `${end.getMonth() + 1}月${end.getDate()}日`;
            assert.equal(await page.locator('.rp-date-label').textContent(), expected);
            release();
            await page.waitForURL(`**/#/reading-plan/back-test/${total}`);
            await page.locator('.center-page .bible-verse').waitFor();
            assert.equal(await page.locator('.rp-date-label').textContent(), expected);
        } finally {
            release();
        }
    });
}

test('a failed plan load leaves the date and an explicit error visible', async t => {
    const page = await navigationPage(t);
    await page.addStyleTag({ path: path.join(root, 'src', 'static', 'css', 'bible-theme.css') });
    await page.addStyleTag({ content: '.rp-date-bar { padding-top: 40px; }' });
    await page.route('**/data/reading-plans.json', route => route.fulfill({ status: 500, body: 'error' }));
    await page.evaluate(() => CXRouter.navigate('reading-plan/back-test/2'));
    await page.getByText('加载失败').waitFor();
    assert.equal(await page.locator('.rp-date-label').textContent(), '1月2日');
    assert.equal(await page.locator('.rp-sidebar-btn').isDisabled(), true);
    const bounds = await page.evaluate(() => ({
        barBottom: document.querySelector('.rp-date-bar').getBoundingClientRect().bottom,
        errorTop: document.querySelector('.rp-verses-loading').getBoundingClientRect().top
    }));
    assert.ok(bounds.errorTop >= bounds.barBottom, JSON.stringify(bounds));
    await page.evaluate(() => {
        localStorage.setItem('bible_primary_lang', 'zh-hant-rcv');
        window.dispatchEvent(new Event('cx:primaryLangChanged'));
    });
    assert.equal(await page.locator('.rp-verses-loading').textContent(), '載入失敗');
    assert.equal(await page.locator('.rp-type-card').count(), 0);
    assert.equal(await page.locator('.rp-date-label').textContent(), '1月2日');
    assert.equal(await page.locator('.rp-sidebar-btn').getAttribute('title'), '進度');
    await page.evaluate(() => localStorage.setItem('bible_primary_lang', 'zh-rcv'));
    await page.locator('.rp-back-btn').click();
    await waitForBible(page);
    await page.unroute('**/data/reading-plans.json');
    await openPlanDay(page);
    assert.equal(await page.locator('.rp-sidebar-btn').isEnabled(), true);
});

test('language changes preserve the error when loading the empty-plan page fails', async t => {
    const page = await navigationPage(t);
    await page.route('**/data/reading-plans.json', route => route.fulfill({ status: 500, body: 'error' }));
    await page.evaluate(() => {
        localStorage.removeItem('cx_reading_plans');
        CXRouter.navigate('reading-plan');
    });
    await page.getByText('加载失败').waitFor();
    await page.evaluate(() => {
        localStorage.setItem('bible_primary_lang', 'zh-hant-rcv');
        window.dispatchEvent(new Event('cx:primaryLangChanged'));
    });
    assert.equal(await page.locator('.rp-load-error').textContent(), '載入失敗');
    assert.equal(await page.locator('.rp-title').textContent(), '讀經計劃');
    assert.equal(await page.locator('.rp-type-card').count(), 0);
});

test('reading-plan slider fits portrait and keeps swipe previews aligned after rotation', async t => {
    const page = await navigationPage(t);
    await page.addStyleTag({ path: path.join(root, 'src', 'static', 'css', 'bible-theme.css') });
    await page.setViewportSize({ width: 844, height: 390 });
    await openPlanDay(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const dimensions = await page.evaluate(() => ({
        app: document.getElementById('app').clientWidth,
        slider: document.querySelector('.swipe-slider').getBoundingClientRect().width,
        center: document.querySelector('.center-page').getBoundingClientRect().width
    }));
    assert.equal(dimensions.slider, dimensions.app);
    assert.equal(dimensions.center, dimensions.app);

    await swipePlanDay(page);
    const alignment = await page.evaluate(() => {
        const slider = document.querySelector('.swipe-slider').getBoundingClientRect();
        const left = document.querySelector('.left-page');
        const right = document.querySelector('.right-page');
        return {
            width: slider.width,
            left: parseFloat(left.style.left),
            right: parseFloat(right.style.left),
            leftWidth: parseFloat(left.style.width),
            rightWidth: parseFloat(right.style.width)
        };
    });
    assert.equal(alignment.leftWidth, alignment.width);
    assert.equal(alignment.rightWidth, alignment.width);
    assert.equal(alignment.right - alignment.left, 2 * alignment.width);
    await page.waitForFunction(() => document.querySelector('.center-page .bible-verse-lang')?.textContent === 'Chapter 3');
});

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

for (const failure of ['http', 'missing', 'empty']) {
    test(`stale plan refresh ${failure} failure cannot mark an empty day and can be retried`, async t => {
        const page = await navigationPage(t);
        let release, requested, calls = 0;
        const pending = new Promise(resolve => { release = resolve; });
        const started = new Promise(resolve => { requested = resolve; });
        await page.route('**/data/reading-plans.json', async route => {
            calls++;
            if (calls === 1) return route.fulfill({ json: { plans: [] } });
            if (calls === 2) {
                requested();
                await pending;
                if (failure === 'http') return route.fulfill({ status: 503, json: { error: 'unavailable' } });
                return route.fulfill({ json: { plans: failure === 'empty' ? [{ id: 'one', entries: [] }] : [] } });
            }
            return route.continue();
        });
        try {
            await page.evaluate(() => CXRouter.navigate('reading-plan/back-test/2'));
            await started;
            assert.equal(await page.locator('.rp-verses-loading').textContent(), '加载中…');
            assert.equal(await page.locator('.rp-empty-day').count(), 0);
            assert.equal(await page.locator('.rp-btn-read').count(), 0);
        } finally {
            release();
        }
        await page.getByText('加载失败').waitFor();
        assert.equal(await page.locator('.rp-empty-day').count(), 0);
        assert.equal(await page.locator('.rp-btn-read').count(), 0);
        await page.evaluate(() => CXRouter.navigate('reading-plan/back-test/2'));
        await page.waitForFunction(() =>
            document.querySelector('.center-page .bible-verse-lang')?.textContent === 'Chapter 2');
        assert.equal(calls, 3);
    });
}

test('switching to a missing two-year plan refreshes before clamping its day', async t => {
    const page = await navigationPage(t);
    await page.clock.setFixedTime(new Date(2026, 2, 1, 12));
    await openPlanDay(page);
    let release, requested, calls = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { requested = resolve; });
    await page.route('**/data/reading-plans.json', async route => {
        if (++calls === 1) {
            requested();
            await pending;
            return route.fulfill({ status: 503, json: { error: 'unavailable' } });
        }
        await route.fulfill({ json: { plans: [
            { id: 'one', entries: [{ d: 4 }] },
            { id: 'two', entries: [
                { d: 425, book: 1, book_to: 1, chapter: 2, chapter_to: 2, section: 1, section_to: 1 },
                { d: 728, book: 1, book_to: 1, chapter: 2, chapter_to: 2, section: 1, section_to: 1 }
            ] }
        ] } });
    });
    try {
        await page.evaluate(() => {
            const plans = JSON.parse(localStorage.getItem('cx_reading_plans'));
            plans.push({ id: 'two-test', type: 'two', planIds: ['two'], year: 2025,
                startDate: '2025-01-01', completed: {} });
            localStorage.setItem('cx_reading_plans', JSON.stringify(plans));
            document.querySelector('[data-action="toggle-drawer"]').click();
            document.querySelector('[data-action="drawer-tab"][data-tab="records"]').click();
            document.querySelector('[data-action="switch-plan"][data-id="two-test"]').click();
        });
        await started;
        assert.equal(await page.locator('.rp-btn-read').count(), 0);
        assert.equal(await page.locator('.rp-date-label').textContent(), '3月1日');
    } finally {
        release();
    }
    await page.getByText('加载失败').waitFor();
    assert.equal(await page.locator('.rp-btn-read').count(), 0);
    await page.evaluate(() => CXRouter.navigate('reading-plan/two-test/425'));
    await page.waitForURL('**/#/reading-plan/two-test/425');
    await page.waitForFunction(() =>
        document.querySelector('.center-page .bible-verse-lang')?.textContent === 'Chapter 2');
    assert.equal(await page.locator('.rp-date-label').textContent(), '3月1日');
});

test('a late stale refresh cannot replace newer plan data after reopening', async t => {
    const page = await navigationPage(t);
    let release, requested, calls = 0, oldRequest;
    const pending = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { requested = resolve; });
    await page.route('**/data/reading-plans.json', async route => {
        calls++;
        if (calls === 1) return route.fulfill({ json: { plans: [] } });
        if (calls === 2) {
            oldRequest = route.request();
            requested();
            await pending;
            return route.fulfill({ json: { plans: [] } });
        }
        if (calls === 3) return route.continue();
        return route.fulfill({ status: 503, json: { error: 'unavailable' } });
    });
    try {
        await page.evaluate(() => CXRouter.navigate('reading-plan/back-test/2'));
        await started;
        await page.evaluate(() => window.systemBack());
        await waitForBible(page);
        await openPlanDay(page, 1);
        const response = page.waitForResponse(r => r.request() === oldRequest);
        release();
        await response;
        await page.waitForLoadState('networkidle');
        await openPlanDay(page, 3);
        assert.equal(calls, 3);
    } finally {
        release();
    }
});

test('a late refresh cannot replace cached data used after leaving a missing plan', async t => {
    const page = await navigationPage(t);
    await openPlanDay(page);
    let release, requested, calls = 0, oldRequest;
    const pending = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { requested = resolve; });
    await page.route('**/data/reading-plans.json', async route => {
        if (++calls === 1) {
            oldRequest = route.request();
            requested();
            await pending;
            return route.fulfill({ json: { plans: [{ id: 'two', entries: [{ d: 1 }] }] } });
        }
        return route.fulfill({ status: 503, json: { error: 'unavailable' } });
    });
    try {
        await page.evaluate(() => {
            const plans = JSON.parse(localStorage.getItem('cx_reading_plans'));
            plans.push({ id: 'two-test', type: 'two', planIds: ['two'], year: 2026,
                startDate: '2026-01-01', completed: {} });
            localStorage.setItem('cx_reading_plans', JSON.stringify(plans));
            document.querySelector('[data-action="toggle-drawer"]').click();
            document.querySelector('[data-action="drawer-tab"][data-tab="records"]').click();
            document.querySelector('[data-action="switch-plan"][data-id="two-test"]').click();
        });
        await started;
        await page.evaluate(() => window.systemBack());
        await waitForBible(page);
        await openPlanDay(page, 3);
        const response = page.waitForResponse(r => r.request() === oldRequest);
        release();
        await response;
        await page.waitForLoadState('networkidle');
        await openPlanDay(page, 4);
        assert.equal(calls, 1);
    } finally {
        release();
    }
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
