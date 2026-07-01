// 临时验证服务器 - 加载实际 CSS 渲染经文，对比节号+上标位置
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8767;
const OUTPUT = path.join(__dirname, 'output');

const styleCSS = fs.readFileSync(path.join(OUTPUT, 'css/style.css'), 'utf-8');
const themeCSS = fs.readFileSync(path.join(OUTPUT, 'css/bible-theme.css'), 'utf-8');

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>经文渲染验证</title>
<style>
/* 实际部署的 CSS（直接注入） */
${themeCSS}
${styleCSS}

/* 验证页面框架 */
body.verify-body {
  font-family: -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  background: #0d1117; color: #c9d1d9; padding: 20px; margin: 0;
}
h1 { font-size: 18px; color: #58a6ff; margin-bottom: 16px; }
.panel { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
.panel h2 { font-size: 14px; color: #8b949e; margin-bottom: 12px; }

/* 经文演示区 - 模拟真实容器 */
.verse-container {
  background: #fff; color: #333; border-radius: 8px; padding: 16px 20px;
  font-size: 16px;
}
[data-theme="dark-gray"] .verse-container,
[data-theme="night"] .verse-container {
  background: #2a2a2a; color: #e0e0e0;
}

/* 检查信息 */
.info-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.info-table th { text-align: left; padding: 6px 10px; color: #8b949e; border-bottom: 1px solid #30363d; }
.info-table td { padding: 6px 10px; border-bottom: 1px solid #21262d; }
.ok { color: #3fb950; }
.warn { color: #d29922; }

/* 标尺线 */
.ruler { position: relative; height: 40px; margin: 8px 0; background: #1a1a2e; border-radius: 4px; overflow: hidden; }
.ruler-line { position: absolute; left: 0; right: 0; height: 1px; background: #ff000055; }
.ruler-label { position: absolute; right: 4px; font-size: 10px; color: #ff6666; transform: translateY(-12px); }
</style>
</head>
<body class="verify-body">
<h1>📖 经文渲染验证 — 节号 + 上标位置</h1>

<div class="panel">
  <h2>CSS 属性检查</h2>
  <table class="info-table">
    <tr><th>属性</th><th>值</th><th>状态</th></tr>
    <tr><td>.verse-num padding-top</td><td>2px</td><td class="ok">✅ 与包裹div对齐</td></tr>
    <tr><td>.bible-verse-lang padding</td><td>2px 0</td><td class="ok">✅</td></tr>
    <tr><td>.fn-ref line-height</td><td>1</td><td class="ok">✅ super可正常偏移</td></tr>
    <tr><td>.xref-ref line-height</td><td>1</td><td class="ok">✅ super可正常偏移</td></tr>
    <tr><td>.bible-verse align-items</td><td>flex-start</td><td class="ok">✅</td></tr>
    <tr><td>.primary width</td><td>calc(100% - 2em - 4px)</td><td class="ok">✅ 排除节号宽度</td></tr>
  </table>
</div>

<div class="panel">
  <h2>实际渲染效果（使用部署的 CSS）</h2>
  <div class="verse-container">
    <div class="bible-verse" data-section="1">
      <span class="verse-num">1</span>
      <div class="bible-verse-lang primary"><sup class="fn-ref" data-vkey="创1:1" data-fn="1">1</sup><sup class="xref-ref" data-vkey="创1:1" data-xr="a">a</sup>起初<sup class="fn-ref" data-vkey="创1:1" data-fn="2">2</sup>神<sup class="xref-ref" data-vkey="创1:1" data-xr="b">b</sup>创造<sup class="fn-ref" data-vkey="创1:1" data-fn="3">3</sup>诸天与地，</div>
    </div>
    <div class="bible-verse" data-section="2">
      <span class="verse-num">2上</span>
      <div class="bible-verse-lang primary"><sup class="fn-ref" data-vkey="创1:2" data-fn="1">1</sup>而地变为<sup class="xref-ref" data-vkey="创1:2" data-xr="a">a</sup>荒废空虚，<sup class="fn-ref" data-vkey="创1:2" data-fn="2">2</sup>渊面<sup class="xref-ref" data-vkey="创1:2" data-xr="b">b</sup>黑暗。</div>
    </div>
    <div class="bible-verse" data-section="2" data-flag="2">
      <span class="verse-num">2下</span>
      <div class="bible-verse-lang primary"><sup class="fn-ref" data-vkey="创1:2" data-fn="3">3</sup>神的<sup class="fn-ref" data-vkey="创1:2" data-fn="4">4</sup><sup class="xref-ref" data-vkey="创1:2" data-xr="c">c</sup>灵覆罩在水面上。</div>
    </div>
    <div class="bible-verse" data-section="3">
      <span class="verse-num">3</span>
      <div class="bible-verse-lang primary">神<sup class="fn-ref" data-vkey="创1:3" data-fn="1">1</sup><sup class="xref-ref" data-vkey="创1:3" data-xr="a">a</sup>说，要有<sup class="fn-ref" data-vkey="创1:3" data-fn="2">2</sup><sup class="xref-ref" data-vkey="创1:3" data-xr="b">b</sup>光，就有了光。</div>
    </div>
    <div class="bible-verse" data-section="4">
      <span class="verse-num">4</span>
      <div class="bible-verse-lang primary">神看光是<sup class="fn-ref" data-vkey="创1:4" data-fn="1">1</sup><sup class="xref-ref" data-vkey="创1:4" data-xr="a">a</sup>好的，就把光暗<sup class="fn-ref" data-vkey="创1:4" data-fn="2">2</sup><sup class="xref-ref" data-vkey="创1:4" data-xr="b">b</sup>分开了。</div>
    </div>
    <div class="bible-verse" data-section="5">
      <span class="verse-num">5</span>
      <div class="bible-verse-lang primary">神称光为<sup class="fn-ref" data-vkey="创1:5" data-fn="1">1</sup><sup class="xref-ref" data-vkey="创1:5" data-xr="a">a</sup>昼，称暗为夜。<sup class="fn-ref" data-vkey="创1:5" data-fn="2">2</sup><sup class="xref-ref" data-vkey="创1:5" data-xr="b">b</sup>有晚上，有早晨，这是第一日。</div>
    </div>
  </div>
</div>

<div class="panel">
  <h2>布局结构</h2>
  <pre style="font-size:12px;color:#8b949e;line-height:1.6;overflow-x:auto">
.bible-verse  ─ display:flex; align-items:flex-start; flex-wrap:wrap
├── .verse-num  ─ padding-top:2px; flex-shrink:0; min-width:2em
└── .bible-verse-lang.primary  ─ padding:2px 0; width:calc(100% - 2em - 4px)
    ├── sup.fn-ref  ─ font-size:.68em; vertical-align:super; line-height:1
    ├── sup.xref-ref ─ font-size:.65em; vertical-align:super; line-height:1
    └── 经文文本...
  </pre>
</div>

<div class="panel">
  <h2>对齐说明</h2>
  <table class="info-table">
    <tr><th>元素</th><th>距顶部偏移</th><th>说明</th></tr>
    <tr><td>.verse-num</td><td>2px (padding-top)</td><td>节号与经文首行基线对齐</td></tr>
    <tr><td>.bible-verse-lang</td><td>2px (padding)</td><td>经文内容起始位置</td></tr>
    <tr><td>sup.fn-ref</td><td>super (≈0.33em 上移)</td><td>line-height:1 让 super 正常计算偏移</td></tr>
    <tr><td>sup.xref-ref</td><td>super (≈0.33em 上移)</td><td>line-height:1 让 super 正常计算偏移</td></tr>
  </table>
</div>

<script>
// 测量实际像素位置
window.addEventListener('load', function() {
  var verses = document.querySelectorAll('.bible-verse');
  var results = [];
  for (var i = 0; i < Math.min(3, verses.length); i++) {
    var v = verses[i];
    var num = v.querySelector('.verse-num');
    var lang = v.querySelector('.bible-verse-lang');
    var sup = v.querySelector('.fn-ref, .xref-ref');
    var vRect = v.getBoundingClientRect();
    var nRect = num.getBoundingClientRect();
    var lRect = lang.getBoundingClientRect();
    var sRect = sup ? sup.getBoundingClientRect() : null;
    results.push({
      verse: num.textContent,
      numTop: (nRect.top - vRect.top).toFixed(1) + 'px',
      langTop: (lRect.top - vRect.top).toFixed(1) + 'px',
      supTop: sRect ? (sRect.top - vRect.top).toFixed(1) + 'px' : 'N/A',
      aligned: Math.abs((nRect.top - vRect.top) - (lRect.top - vRect.top)) < 0.5 ? 'YES' : 'NO (diff=' + Math.abs((nRect.top - vRect.top) - (lRect.top - vRect.top)).toFixed(1) + 'px)'
    });
  }
  var pre = document.createElement('pre');
  pre.style.cssText = 'font-size:12px;color:#3fb950;background:#0d1117;padding:12px;border-radius:6px;margin-top:8px';
  pre.textContent = '实测像素位置:\\n' + JSON.stringify(results, null, 2);
  document.querySelector('.panel:last-child').appendChild(pre);
});
</script>
</body></html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, () => {
  console.log('验证页面: http://127.0.0.1:' + PORT);
  console.log('');
  console.log('=== CSS 关键值确认 ===');
  
  // 从 CSS 中提取实际值
  const numMatch = themeCSS.match(/\.bible-verse \.verse-num\{([^}]+)\}/);
  const fnMatch = styleCSS.match(/\.fn-ref\{([^}]+)\}/);
  const xrMatch = styleCSS.match(/\.xref-ref\{([^}]+)\}/);
  const langMatch = themeCSS.match(/\.bible-verse-lang\{([^}]+)\}/);
  
  if (numMatch) {
    const pt = numMatch[1].match(/padding-top:([^;]+)/);
    console.log('  .verse-num padding-top:', pt ? pt[1] : 'N/A');
  }
  if (langMatch) {
    const p = langMatch[1].match(/padding:([^;]+)/);
    console.log('  .bible-verse-lang padding:', p ? p[1] : 'N/A');
  }
  if (fnMatch) {
    const lh = fnMatch[1].match(/line-height:([^;]+)/);
    console.log('  .fn-ref line-height:', lh ? lh[1] : 'N/A');
  }
  if (xrMatch) {
    const lh = xrMatch[1].match(/line-height:([^;]+)/);
    console.log('  .xref-ref line-height:', lh ? lh[1] : 'N/A');
  }
});
