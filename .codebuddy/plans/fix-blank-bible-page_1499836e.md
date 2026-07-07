---
name: fix-blank-bible-page
overview: 修复圣经阅读页面偶尔显示空白的问题，包括添加超时保护、解决竞态条件、增强错误处理和状态恢复
todos:
  - id: add-render-gen-counter
    content: 在 bible-renderer.js 顶部变量区域添加 _renderGen 计数器变量
    status: completed
  - id: fix-race-condition
    content: "重构 renderBibleView(): 添加渲染代捕获和回调守卫，解决快速滑动时的竞态覆盖问题"
    status: completed
    dependencies:
      - add-render-gen-counter
  - id: add-timeout-protection
    content: 为 renderBibleView 的 Promise.all 添加 Promise.race 超时保护（15秒），防止 fetch 挂起导致永久空白
    status: completed
    dependencies:
      - add-render-gen-counter
  - id: fix-capacitor-fetch
    content: 优化 loadBookData/loadBooksMeta 等函数：Capacitor 原生环境添加时间戳参数绕过缓存，参考 renderer.js 已有模式
    status: completed
  - id: ensure-splash-dismissal
    content: 在 renderBibleView 入口添加安全兜底定时器确保启动屏关闭；统一超时/错误的用户反馈 UI（重试按钮+错误描述）
    status: completed
    dependencies:
      - add-render-gen-counter
      - fix-race-condition
      - add-timeout-protection
---

## 产品概述

修复圣经阅读器 PWA/Android APK 中间歇性出现的经文页面空白 bug：标题栏（如"创世记 6"）正常显示，底部导航栏也正常，但中间内容区域完全空白。此问题为偶发，用户需要手动刷新才能恢复。

## 核心功能

- 诊断并修复 `renderBibleView()` 中的竞态条件导致旧 Promise 回调覆盖新内容
- 为数据加载添加超时保护，防止 fetch 挂起导致页面永远停留在 loading 状态
- 修复 Capacitor 原生环境下 fetch 缓存导致的加载异常
- 确保启动屏在所有代码路径中都能正确关闭
- 增强空数据状态的用户反馈，区分"加载失败"与"无内容"

## 技术栈

- 纯前端 SPA（无框架），原生 JavaScript (ES5)
- Service Worker 缓存策略（cache-first for bible data）
- Capacitor 打包 Android APK
- 目标文件: `src/static/js/bible-renderer.js`

## 实现方案

### 根因分析（已确认的 3 个根因）

**根因 1: 竞态条件（最主要原因）**
`renderBibleView()` 第 848-943 行没有渲染版本控制。当用户快速滑动手势导航时：

1. 第 1 次 `renderBibleView(1,6)` 调用发起 fetch，设置 loading 状态
2. 用户快速滑动触发第 2 次 `renderBibleView(1,7)` 调用，设置新的 loading
3. 第 1 次的 fetch 先返回，执行 `container.innerHTML = html`（创世记 6 的内容）
4. 但此时 `_currentBook=1, _currentChapter=7`，chapterBar 显示 "创世记 7"
5. 或者第 2 次返回后又被第 1 次覆盖 → 内容为空或错乱

**根因 2: 无超时保护**
第 865 行的 `Promise.all([...])` 没有 `.race()` 超时。如果任何 fetch 请求挂起（网络抖动、SW 异常、Capacitor WebView 问题）：

- loading 文字显示后被覆盖（如果发生竞态）
- 或永远停留在某个中间状态
- success/catch 都不会触发

**根因 3: 静默错误 + 启动屏残留**

- `loadBookData()` (292行) catch 返回 `{chapters: []}` 而不是抛出错误
- `Promise.all` "成功"但数据为空 → 显示"无经文"提示（但截图显示完全空白，说明可能是更早阶段失败）
- 如果 Promise 既不 resolve 也不 reject → 启动屏依赖 4 秒兜底关闭，但内容区仍为空
- `_dismissSplash()` 只在 then/catch 中调用（898/936行），漏掉了挂起场景

### 修复设计

**修复 A: 渲染版本号防竞态**
在模块顶部新增 `_renderGen` 计数器变量。每次进入 `renderBibleView()` 时递增，在 then/catch 回调开头检查当前值是否匹配，过期则直接 return 不执行 DOM 操作。

```javascript
// 新增变量（约第70行附近）
var _renderGen = 0; // 渲染代数计数器，用于防止竞态条件

// renderBibleView() 内部修改:
function renderBibleView(bookIndex, chapter, skipHistory) {
    var __gen = ++_renderGen; // 捕获当前渲染代
    
    // ... existing code ...
    
    Promise.all([...]).then(function(results) {
        if (__gen !== _renderGen) return; // 过期渲染，丢弃
        // ... existing success code ...
    }).catch(function(err) {
        if (__gen !== _renderGen) return; // 过期渲染，丢弃
        // ... existing error code ...
    });
}
```

**修复 B: 超时保护**
使用 `Promise.race()` 包装 `Promise.all`，15 秒超时后 reject：

```javascript
var LOAD_TIMEOUT_MS = 15000;
var timeoutPromise = new Promise(function(_, reject) {
    setTimeout(function() { reject(new Error('LOAD_TIMEOUT')); }, LOAD_TIMEOUT_MS);
});

Promise.race([
    Promise.all([loadBooksMeta(), loadBookData(bookIndex), loadBibleTopics(), loadBibleIntro(), loadBibleOutlines()]),
    timeoutPromise
]).then(function(results) { /* ... */ })
  .catch(function(err) { /* ... */ });
```

**修复 C: Capacitor fetch 优化**
参考 renderer.js 第 95-97 行的做法，对 Capacitor 原生环境的圣经数据 fetch 添加时间戳参数绕过 HTTP 缓存：

```javascript
// 在 getRoot() 或 loadBookData() 内部:
function _getFetchUrl(path) {
    var url = getRoot() + path;
    var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (isNative) url += '?_t=' + Date.now();
    return url;
}

// loadBookData 改用:
fetch(_getFetchUrl('data/bible/' + String(bookIndex).padStart(2, '0') + '.json'))
```

**修复 D: 确保启动屏关闭 + 统一错误 UI**
在 `renderBibleView` 函数入口处（设置 loading 后），注册一个延迟的安全兜底：无论 Promise 最终是否完成，都确保启动屏关闭且至少显示一个有意义的界面。

```javascript
// 在 container.innerHTML = loading 之后添加兜底定时器:
setTimeout(function() {
    // 兜底：如果当前仍是本代渲染且容器内仍是 loading 提示，强制刷新
    if (__gen === _renderGen && window._dismissSplash) window._dismissSplash();
}, 5000); // 比 splash 兜底(4s)稍长，给数据加载留足时间
```

### 架构影响范围

仅修改 `src/static/js/bible-renderer.js` 一个文件，改动集中在一个函数 `renderBibleView()` 及其依赖的数据加载函数。不影响其他组件（router.js、renderer.js 等）。