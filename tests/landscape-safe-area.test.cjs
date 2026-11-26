const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..', 'src', 'static');
const css = fs.readFileSync(path.join(root, 'css', 'bible-theme.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const inlineCss = index.match(/<style>([\s\S]*?)<\/style>/)[1];

function withInsets(styles, left, right) {
    return styles.replace(/env\(safe-area-inset-(left|right),\s*0px\)/g,
        (_, side) => `${side === 'left' ? left : right}px`);
}

test('landscape reading and controls avoid either side cutout', async () => {
    const chrome = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
    const executablePath = process.env.CHROME_PATH || (fs.existsSync(chrome) ? chrome : chromium.executablePath());
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true });
        await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head>
            <body class="cx-bible-page cx-reading-plan-page">
              <div class="bible-chapter-bar"><button>Chapter</button></div>
              <div class="rp-date-bar"><button class="rp-back-btn">Back</button><button>Progress</button></div>
              <div class="bible-reading"><div class="bible-verse">Verse</div></div>
              <div class="rp-container"><div class="bible-reading">Plan</div></div>
              <div class="swipe-slider"><div class="bible-reading">Next</div></div>
              <div class="bottom-toolbar"><button class="toolbar-btn">First</button><button class="toolbar-btn">Last</button></div>
              <div class="multi-select-bar"><button>Cancel</button><button>Done</button></div>
              <div class="multi-select-toolbar"><button>First</button><button>Last</button></div>
              <div class="cx-float-nav show"><div class="page-navigation"><button>First</button><button>Last</button></div></div>
              <div class="scripture-popup-header">Header</div><div class="scripture-popup-body">Content</div>
              <div class="speech-dialog show"><div class="sd-header"><button>Play</button><button>Close</button></div></div>
              <div class="bible-drawer-overlay open"><div class="bible-drawer"><button>Books</button></div></div>
              <div class="rp-drawer open"><button>Progress</button></div>
              <div class="theme-panel show">Settings</div>
            </body></html>`);

        for (const height of [390, 320]) {
            await page.setViewportSize({ width: 844, height });
            let baseline;
            for (const [left, right] of [[0, 0], [48, 0], [0, 48]]) {
                const style = await page.addStyleTag({ content: withInsets(css + '\n' + inlineCss, left, right) });
                const result = await page.evaluate(() => {
                    const padding = selector => [...document.querySelectorAll(selector)].map(el => {
                        const style = getComputedStyle(el);
                        return [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)];
                    });
                    return {
                        reading: padding('.bible-reading'),
                        controls: padding('.bible-chapter-bar, .rp-date-bar, .bottom-toolbar, .multi-select-bar, .multi-select-toolbar, .cx-float-nav, .scripture-popup-header, .scripture-popup-body, .speech-dialog'),
                        bookDrawer: padding('.bible-drawer')[0],
                        planDrawer: padding('.rp-drawer')[0],
                        panelRight: parseFloat(getComputedStyle(document.querySelector('.theme-panel')).right),
                        buttons: [...document.querySelectorAll('.rp-date-bar button, .bottom-toolbar button, .multi-select-bar button, .multi-select-toolbar button, .speech-dialog button, .bible-drawer button, .rp-drawer button')]
                            .map(el => {
                                const rect = el.getBoundingClientRect();
                                return [rect.left, rect.right];
                            })
                    };
                });
                if (!baseline) baseline = result;
                for (const group of ['reading', 'controls']) {
                    result[group].forEach(([paddingLeft, paddingRight], i) => {
                        assert.ok(Math.abs(paddingLeft - baseline[group][i][0] - left) < 0.1);
                        assert.ok(Math.abs(paddingRight - baseline[group][i][1] - right) < 0.1);
                    });
                }
                assert.equal(result.bookDrawer[0], left);
                assert.equal(result.planDrawer[1], right);
                assert.equal(result.panelRight, baseline.panelRight + right);
                for (const [x1, x2] of result.buttons) {
                    assert.ok(x1 >= left - 0.1 && x2 <= 844 - right + 0.1);
                }
                await style.evaluate(el => el.remove());
            }
        }

        await page.setViewportSize({ width: 390, height: 844 });
        const portraitStyle = await page.addStyleTag({ content: withInsets(css + '\n' + inlineCss, 0, 0) });
        const portraitPadding = await page.locator('.bible-verse').evaluate(el =>
            getComputedStyle(el.parentElement).paddingLeft);
        await portraitStyle.evaluate(el => el.remove());
        await page.addStyleTag({ content: withInsets(css + '\n' + inlineCss, 48, 0) });
        assert.equal(await page.locator('.bible-verse').evaluate(el =>
            getComputedStyle(el.parentElement).paddingLeft), portraitPadding);
    } finally {
        await browser.close();
    }
});
