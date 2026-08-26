---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: 'd97fdc8f-5f1e-4749-82cd-77baea50d4d6'
  PropagateID: 'd97fdc8f-5f1e-4749-82cd-77baea50d4d6'
  ReservedCode1: 'c4280232-665a-4b6e-b673-9fd8389e5973'
  ReservedCode2: 'c4280232-665a-4b6e-b673-9fd8389e5973'
---

# PWA 缓存方案统一 — 实现计划

> 日期：2026-08-27
> 设计文档：`docs/plans/2026-08-27-pwa-cache-unification-design.md`
> 约束：每个 task 完成后构建验证，全部完成后浏览器实测

## Bible 项目

### Task B1: SW 模板改造 `src/templates/main_sw.js`
- [ ] `CACHE_NAME` 改为 `'cx-main'`（固定名）
- [ ] 新增 `const DATA_CACHE_PREFIX = 'cx-data-'`
- [ ] 删除 `SW_VERSION` 常量和 `__BUILD_TIME__` 引用
- [ ] SW 注释中版本号改为 `{{APP_VERSION}}`（与 sg 一致）
- [ ] install 改为 `self.skipWaiting()`（删除 PRECACHE_URLS 预缓存逻辑）
- [ ] activate 保持零清理（已是 `clients.claim()`）
- [ ] fetch handler：`isBibleData` 的缓存写入改为不指定桶名（`caches.open(CACHE_NAME)` → 改为不写缓存，让全局 `caches.match` 搜索数据桶）
- [ ] `CACHE_ALL_BIBLE` 消息：改为从 `event.data.cacheName` 取桶名写入
- [ ] `CACHE_INFO` 消息：`dataOk` 改为 `allKeys.some(k => k.indexOf(DATA_CACHE_PREFIX) === 0)`
- [ ] **验证**：构建通过，sw.js 生成正确

### Task B2: index.html 页面侧改造
- [ ] 新增 `CX_APP_VERSION_INJECT` 占位符（与 sg 一致位置）
- [ ] 新增 `window.CX_APP_VERSION` 变量声明和注释
- [ ] 新增 `pwaCache` 模块（从 sg 移植 `install/checkOnStartup/dataCacheName/cacheAllInto/deleteOldBuckets/fetchRemoteVersion/getLocalVersion/setLocalVersion`）
- [ ] `buildUrlList` 适配 bible 的 `__cxCoreUrls` + 66 卷经文 + 词典 + parsing URL 列表
- [ ] `cacheAllResources` 改为调用 `pwaCache.install` 或直接内联切换桶逻辑
- [ ] `getCxAppCacheName` 简化为返回 `'cx-main'`
- [ ] `showMandatoryInstallDialog` 传 `targetVersion` 给缓存函数
- [ ] `checkPwaStartupCache` 网络失败时用 `CX_APP_VERSION` 兜底
- [ ] `CACHE_ALL_BIBLE` 消息改为传 `cacheName` 参数
- [ ] **验证**：构建通过，index.html 含 `CX_APP_VERSION` 注入点

### Task B3: main.py 构建脚本改造
- [ ] 新增 `inject_app_version()` 函数（从 sg 移植）
- [ ] `generate_sw()` 中 `__BUILD_TIME__` 替换改为 `{{APP_VERSION}}` 替换
- [ ] `inject_app_version()` 调用加入 `__main__` 流程
- [ ] **验证**：构建通过，output/index.html 含 `window.CX_APP_VERSION = '0.1.11'`

### Task B4: app-update.js PWA 更新改造
- [ ] PWA 更新流程中调用 `pwaCache.install('update', null, remoteVersion)` 传版本号
- [ ] 清缓存逻辑保留（清 `cx-*` 后触发重缓存）
- [ ] **验证**：构建通过

### Task B5: theme-toggle.js 缓存检查兼容
- [ ] 内页缓存检查兼容 `cx-data-*`/`cx-data`/`cx-main`/`cx-main-*`
- [ ] **验证**：构建通过

### Task B6: Bible 构建验证
- [ ] `$env:PYTHONIOENCODING='utf-8'; python main.py` 构建通过
- [ ] `output/index.html` 含 `window.CX_APP_VERSION = '0.1.11'`
- [ ] `output/sw.js` 含 `CACHE_NAME = 'cx-main'` 和 `DATA_CACHE_PREFIX = 'cx-data-'`
- [ ] 无构建错误

## Books 项目

### Task K1: SW 模板改造 `src/templates/main_sw.js`
- [ ] `CACHE_NAME` 保持 `'bk-main'`（已符合，无需改）
- [ ] 新增 `const DATA_CACHE_PREFIX = 'bk-data-'`
- [ ] SW 注释中版本号改为 `{{APP_VERSION}}`
- [ ] install 保留 `PRECACHE_URLS` 预缓存，但末尾加 `self.skipWaiting()`
- [ ] activate 保持零清理（已符合）
- [ ] `CACHE_INFO` 消息：`dataOk` 兼容 `bk-data-*`
- [ ] **验证**：构建通过

### Task K2: index.html 页面侧改造
- [ ] 新增 `BK_APP_VERSION_INJECT` 占位符
- [ ] 新增 `window.BK_APP_VERSION` 变量声明
- [ ] 新增 `pwaCache` 模块（从 sg 移植，前缀改为 `bk-data-`）
- [ ] `buildUrlList` 适配 books 的 `__bkCoreUrls` + `books-index.json` + `manifest.json`
- [ ] `cacheAllBooks` 改为调用 `pwaCache.install` 或内联切换桶逻辑
- [ ] `checkPwaStartupCache` 传 version 给安装函数；网络失败时用 `BK_APP_VERSION` 兜底
- [ ] **验证**：构建通过

### Task K3: generator.py 构建脚本改造
- [ ] 新增 `inject_app_version()` 逻辑
- [ ] SW 模板中 `{{APP_VERSION}}` 替换
- [ ] **验证**：构建通过，output/index.html 含 `window.BK_APP_VERSION`

### Task K4: app-update/au-init.js PWA 更新改造
- [ ] PWA 更新流程中传版本号给安装函数
- [ ] **验证**：构建通过

### Task K5: theme-toggle.js 缓存检查兼容
- [ ] 内页缓存检查兼容 `bk-data-*`/`bk-main`
- [ ] **验证**：构建通过

### Task K6: Books 构建验证
- [ ] `python main.py` 构建通过
- [ ] `output/index.html` 含 `window.BK_APP_VERSION`
- [ ] `output/sw.js` 含 `DATA_CACHE_PREFIX = 'bk-data-'`
- [ ] 无构建错误

## 最终验证

### Task F1: Bible 浏览器实测
- [ ] 启动 HTTP 服务器
- [ ] 首次安装：`pwaCache.install('install', null)` 自动用 `CX_APP_VERSION` 建桶
- [ ] 模拟升级到新版本号
- [ ] 断网验证：经文/静态资源全部可读
- [ ] 清理测试环境

### Task F2: Books 浏览器实测
- [ ] 启动 HTTP 服务器
- [ ] 首次安装：`pwaCache.install('install', null)` 自动用 `BK_APP_VERSION` 建桶
- [ ] 模拟升级到新版本号
- [ ] 断网验证：静态资源/数据索引可读，IndexedDB 书籍数据不受影响
- [ ] 清理测试环境

### Task F3: Git 提交
- [ ] Bible 项目 git 提交
- [ ] Books 项目 git 提交

> AI生成