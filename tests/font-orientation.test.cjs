const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'static', 'css', 'bible-theme.css'), 'utf8');
const sliderScript = fs.readFileSync(path.join(__dirname, '..', 'src', 'static', 'js', 'swipe-slider.js'), 'utf8');

test('mobile reading font size stays fixed when orientation changes', async () => {
    const chrome = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
    const executablePath = process.env.CHROME_PATH || (fs.existsSync(chrome) ? chrome : chromium.executablePath());
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage({
            viewport: { width: 390, height: 844 },
            isMobile: true,
            deviceScaleFactor: 2
        });
        await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>'
            + '<body><div class="bible-verse">Verse</div></body></html>');
        await page.addStyleTag({ content: css });
        for (const [rootSize, bibleSize] of [[18, null], [22, null], [20, 24]]) {
            await page.evaluate(([root, bible]) => {
                document.documentElement.style.fontSize = root + 'px';
                if (bible === null) document.documentElement.style.removeProperty('--bible-font-size');
                else document.documentElement.style.setProperty('--bible-font-size', bible + 'px');
            }, [rootSize, bibleSize]);
            for (const viewport of [
                { width: 390, height: 844 },
                { width: 844, height: 390 },
                { width: 650, height: 360 },
                { width: 390, height: 844 }
            ]) {
                await page.setViewportSize(viewport);
                const sizes = await page.locator('.bible-verse').evaluate(element => ({
                    fontSize: getComputedStyle(element).fontSize,
                    textSizeAdjust: getComputedStyle(document.documentElement).webkitTextSizeAdjust
                }));
                assert.equal(sizes.fontSize, (bibleSize ?? rootSize) + 'px');
                assert.equal(sizes.textSizeAdjust, '100%');
            }
        }
        await page.evaluate(() => {
            document.documentElement.style.fontSize = '18px';
            document.documentElement.style.removeProperty('--bible-font-size');
        });
        await page.setViewportSize({ width: 1280, height: 800 });
        assert.equal(await page.locator('.bible-verse').evaluate(el => getComputedStyle(el).fontSize), '16.992px');
    } finally {
        await browser.close();
    }
});

test('slider stays within viewport immediately when rotating to portrait', async () => {
    const chrome = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
    const executablePath = process.env.CHROME_PATH || (fs.existsSync(chrome) ? chrome : chromium.executablePath());
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
        await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head>'
            + '<body class="cx-bible-page"><main id="app"><div class="bible-reading"><div class="bible-verse">Verse</div></div></main></body></html>');
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: sliderScript });
        await page.evaluate(() => {
            window.CXSwipeSlider.init({ resolveDelta: () => null });
            window.CXSwipeSlider.setupSlider();
            window.CXSwipeSlider.bindSwipeGesture();
        });
        await page.setViewportSize({ width: 390, height: 844 });
        const dimensions = await page.evaluate(() => ({
            viewport: document.documentElement.clientWidth,
            slider: document.querySelector('.swipe-slider').getBoundingClientRect().width,
            center: document.querySelector('.center-page').getBoundingClientRect().width,
            scrollWidth: document.documentElement.scrollWidth,
            scale: window.visualViewport.scale
        }));
        assert.equal(dimensions.slider, dimensions.viewport);
        assert.equal(dimensions.center, dimensions.viewport);
        assert.equal(dimensions.scrollWidth, dimensions.viewport);
        assert.equal(dimensions.scale, 1);
        const sidePositions = await page.evaluate(() => {
            const target = document.querySelector('.center-page .bible-verse');
            const touch = new Touch({ identifier: 1, target, clientX: 200, clientY: 200 });
            target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch], changedTouches: [touch] }));
            return ['.left-page', '.right-page'].map(selector => {
                const rect = document.querySelector(selector).getBoundingClientRect();
                return [rect.left, rect.width, rect.height];
            });
        });
        assert.deepEqual(sidePositions, [[-390, 390, 844], [390, 390, 844]]);
    } finally {
        await browser.close();
    }
});
