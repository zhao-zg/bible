// measure.js — 用真实无头浏览器测量弹框字体大小
// 运行: node measure.js
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const PROBE = 'file://' + path.resolve(__dirname, 'font-probe.html').replace(/\\/g, '/');
const SIZES = [14, 18, 24]; // 小 / 默认 / 大 三档全局字号设置

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(PROBE, { waitUntil: 'networkidle0' });

  const results = {};
  for (const size of SIZES) {
    const r = await page.evaluate((s) => {
      window.__setRoot(s);
      return window.__measure();
    }, size);
    results[size] = r;
  }

  if (errors.length) console.error('PAGE ERRORS:', errors);

  // 输出为 JSON，便于脚本解析
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
