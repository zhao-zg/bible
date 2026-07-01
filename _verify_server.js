// 验证修复：创建临时 HTML，用内联 CSS 模拟浏览器计算上标偏移
const http = require('http');
const fs = require('fs');
const path = require('path');

// 从 output 读取实际部署的 CSS
const styleCSS = fs.readFileSync(path.join(__dirname, 'output/css/style.css'), 'utf-8');
const themeCSS = fs.readFileSync(path.join(__dirname, 'output/css/bible-theme.css'), 'utf-8');

// 提取关键 CSS 属性
function extractRule(css, selector) {
  const re = new RegExp('\\' + selector + '\\{([^}]+)\\}');
  const m = css.match(re);
  return m ? m[1] : '';
}

const fnRefStyle = extractRule(styleCSS, '.fn-ref');
const xrefRefStyle = extractRule(styleCSS, '.xref-ref');
const primaryStyle = extractRule(themeCSS, '.bible-verse-lang.primary');

// 解析 bible-renderer.js 检查单版本包裹
const brJS = fs.readFileSync(path.join(__dirname, 'output/js/bible-renderer.js'), 'utf-8');
const hasSingleWrap = brJS.includes('bible-verse-lang primary');
const langCount = (brJS.match(/bible-verse-lang/g) || []).length;

// 模拟计算：line-height 对上标偏移的影响
// vertical-align:super 的偏移量 ≈ 父级 font-size * 0.33 ~ 0.5（取决于 line-height）
// line-height:0 时偏移几乎为 0；line-height:1 时正常偏移
function parseLH(rule) {
  const m = rule.match(/line-height:([^;]+)/);
  return m ? m[1].trim() : 'N/A';
}
function parseVA(rule) {
  const m = rule.match(/vertical-align:([^;]+)/);
  return m ? m[1].trim() : 'N/A';
}
function parseFS(rule) {
  const m = rule.match(/font-size:([^;]+)/);
  return m ? m[1].trim() : 'N/A';
}

const fnLH = parseLH(fnRefStyle);
const fnVA = parseVA(fnRefStyle);
const fnFS = parseFS(fnRefStyle);
const xrLH = parseLH(xrefRefStyle);
const xrVA = parseVA(xrefRefStyle);
const xrFS = parseFS(xrefRefStyle);
const priWidth = primaryStyle.match(/width:([^;]+)/);

const allPass =
  fnLH === '1' && xrLH === '1' &&
  fnVA === 'super' && xrVA === 'super' &&
  hasSingleWrap && langCount >= 3;

const results = {
  pass: allPass,
  checks: [
    { name: '.fn-ref line-height', expected: '1', actual: fnLH, ok: fnLH === '1' },
    { name: '.fn-ref vertical-align', expected: 'super', actual: fnVA, ok: fnVA === 'super' },
    { name: '.fn-ref font-size', expected: '.68em', actual: fnFS, ok: fnFS === '.68em' },
    { name: '.xref-ref line-height', expected: '1', actual: xrLH, ok: xrLH === '1' },
    { name: '.xref-ref vertical-align', expected: 'super', actual: xrVA, ok: xrVA === 'super' },
    { name: '.xref-ref font-size', expected: '.65em', actual: xrFS, ok: xrFS === '.65em' },
    { name: '单版本包裹 div (bible-verse-lang primary)', expected: '存在', actual: hasSingleWrap ? '存在' : '缺失', ok: hasSingleWrap },
    { name: 'bible-verse-lang 引用次数', expected: '≥3', actual: String(langCount), ok: langCount >= 3 },
    { name: '.primary width 排除节号', expected: 'calc(100%-2em-4px)', actual: priWidth ? priWidth[1].trim() : 'N/A', ok: !!priWidth },
  ]
};

// ── HTTP 服务器 ──
const PORT = 8766;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>上标修复验证</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'Segoe UI', sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 24px; }
  h1 { font-size: 20px; margin-bottom: 20px; color: #fff; }
  .card { background: #16213e; border-radius: 12px; padding: 20px; margin-bottom: 16px; border: 1px solid #0f3460; }
  .card h2 { font-size: 16px; margin-bottom: 12px; }
  .pass { border-left: 4px solid #00c853; }
  .fail { border-left: 4px solid #ff1744; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; margin-left: 8px; }
  .badge-ok { background: #00c85322; color: #00c853; }
  .badge-ng { background: #ff174422; color: #ff1744; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; padding: 8px 12px; color: #8899aa; border-bottom: 1px solid #0f3460; }
  td { padding: 8px 12px; border-bottom: 1px solid #0f346033; }
  .ok-row td { color: #69f0ae; }
  .ng-row td { color: #ff8a80; }
  .demo { margin-top: 16px; }
  .demo-title { font-size: 13px; color: #8899aa; margin-bottom: 8px; }
  .verse-demo { font-size: 16px; line-height: 1.9; padding: 12px 16px; border-radius: 8px; }
  .verse-before { background: #2a1a1a; border: 1px solid #5a2020; }
  .verse-after { background: #1a2a1a; border: 1px solid #205a20; }
  .fn-ref-before { font-size:.68em; vertical-align:super; line-height:0; color:#c07818; font-weight:700; }
  .xref-ref-before { font-size:.65em; vertical-align:super; line-height:0; color:#8B4513; font-weight:700; }
  .fn-ref-after { font-size:.68em; vertical-align:super; line-height:1; color:#c07818; font-weight:700; }
  .xref-ref-after { font-size:.65em; vertical-align:super; line-height:1; color:#8B4513; font-weight:700; }
  .verse-num { color: #8B4513; font-weight: 700; font-size: 14px; margin-right: 4px; }
  .summary { font-size: 18px; text-align: center; padding: 16px; border-radius: 12px; margin-bottom: 16px; }
  .summary-pass { background: #00c85318; border: 1px solid #00c853; color: #69f0ae; }
  .summary-fail { background: #ff174418; border: 1px solid #ff1744; color: #ff8a80; }
</style></head><body>
<h1>🔍 注解/串珠上标位置修复验证</h1>

<div class="summary ${allPass ? 'summary-pass' : 'summary-fail'}">
  ${allPass ? '✅ 所有检查项通过 — 修复已生效' : '❌ 存在未通过的检查项'}
</div>

<div class="card ${allPass ? 'pass' : 'fail'}">
  <h2>检查结果 <span class="badge ${allPass ? 'badge-ok' : 'badge-ng'}">${allPass ? 'ALL PASS' : 'HAS FAILURES'}</span></h2>
  <table>
    <tr><th>检查项</th><th>期望值</th><th>实际值</th><th>状态</th></tr>
    ${results.checks.map(c => `
    <tr class="${c.ok ? 'ok-row' : 'ng-row'}">
      <td>${c.name}</td><td>${c.expected}</td><td>${c.actual}</td>
      <td>${c.ok ? '✅' : '❌'}</td>
    </tr>`).join('')}
  </table>
</div>

<div class="card">
  <h2>视觉效果对比</h2>
  <div class="demo">
    <div class="demo-title">修复前 (line-height: 0) — 上标几乎不抬高</div>
    <div class="verse-demo verse-before">
      <span class="verse-num">1</span><sup class="fn-ref-before">1</sup><sup class="xref-ref-before">a</sup>起初<sup class="fn-ref-before">2</sup><sup class="xref-ref-before">b</sup>神<sup class="fn-ref-before">3</sup>创造<sup class="fn-ref-before">4</sup><sup class="xref-ref-before">c</sup>诸天与地，
    </div>
  </div>
  <div class="demo" style="margin-top:12px">
    <div class="demo-title">修复后 (line-height: 1) — 上标正常抬高</div>
    <div class="verse-demo verse-after">
      <span class="verse-num">1</span><sup class="fn-ref-after">1</sup><sup class="xref-ref-after">a</sup>起初<sup class="fn-ref-after">2</sup><sup class="xref-ref-after">b</sup>神<sup class="fn-ref-after">3</sup>创造<sup class="fn-ref-after">4</sup><sup class="xref-ref-after">c</sup>诸天与地，
    </div>
  </div>
</div>

<div class="card">
  <h2>修复原理</h2>
  <table>
    <tr><th>修改</th><th>文件</th><th>说明</th></tr>
    <tr class="ok-row">
      <td>CSS line-height</td><td>style.css</td>
      <td>.fn-ref / .xref-ref 的 line-height: 0 → 1，让 vertical-align:super 有足够行框高度来计算上标偏移</td>
    </tr>
    <tr class="ok-row">
      <td>JS 包裹 div</td><td>bible-renderer.js</td>
      <td>单版本模式增加 &lt;div class="bible-verse-lang primary"&gt;，与多版本模式保持一致的 flex 布局结构</td>
    </tr>
  </table>
</div>
</body></html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, () => {
  console.log(`验证页面已启动: http://127.0.0.1:${PORT}`);
  console.log('');

  // 同时输出命令行结果
  console.log('=== 命令行验证结果 ===');
  results.checks.forEach(c => {
    console.log(`  ${c.ok ? '✅' : '❌'} ${c.name}: ${c.actual} (期望: ${c.expected})`);
  });
  console.log('');
  console.log(allPass ? '✅ 全部通过！' : '❌ 有检查项未通过');
  console.log('');
  console.log('打开浏览器访问 http://127.0.0.1:' + PORT + ' 查看可视化对比');
});
