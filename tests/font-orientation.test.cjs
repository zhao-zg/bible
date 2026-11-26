const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'static', 'css', 'bible-theme.css'), 'utf8');

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
        await page.evaluate(() => {
            document.documentElement.style.fontSize = '20px';
            document.documentElement.style.setProperty('--bible-font-size', '20px');
        });

        const portrait = await page.locator('.bible-verse').evaluate(element => ({
            fontSize: getComputedStyle(element).fontSize,
            textSizeAdjust: getComputedStyle(document.documentElement).webkitTextSizeAdjust
        }));
        await page.setViewportSize({ width: 844, height: 390 });
        const landscape = await page.locator('.bible-verse').evaluate(element => ({
            fontSize: getComputedStyle(element).fontSize,
            textSizeAdjust: getComputedStyle(document.documentElement).webkitTextSizeAdjust
        }));

        assert.equal(portrait.fontSize, '20px');
        assert.equal(landscape.fontSize, portrait.fontSize);
        assert.equal(portrait.textSizeAdjust, '100%');
        assert.equal(landscape.textSizeAdjust, '100%');
    } finally {
        await browser.close();
    }
});
