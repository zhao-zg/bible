---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '48d24062-1576-41b8-b8f0-fa00399142f4'
  PropagateID: '48d24062-1576-41b8-b8f0-fa00399142f4'
  ReservedCode1: '7c5d619d-d2eb-4d4f-aeff-d89fc83c75e9'
  ReservedCode2: '7c5d619d-d2eb-4d4f-aeff-d89fc83c75e9'
---

# PWA 缓存方案统一设计

> 日期：2026-08-27
> 状态：待批准
> 范围：bible + books 两个项目

## 1. 目标

将 bible 和 books 项目的 PWA 缓存方案统一为 sg 项目已验证的方案：

- **数据桶**：`cx-data-{version}`（或 `bk-data-{version}`）版本化，切换桶更新
- **静态桶**：`cx-main`（或 `bk-main`）固定名，`cache.put` 覆盖更新
- **SW activate 零清理**：只做 `clients.claim()`，不删任何缓存
- **构建注入版本号**：`main.py`/`generator.py` 将 `APP_VERSION` 注入 `index.html`
- **版本号优先级**：参数 > 构建注入 > `fetchRemoteVersion` > 本地版本 > `0.0.0`

## 2. 各项目改造内容

### 2.1 Bible 项目

#### 当前状态
- 静态桶 `cx-main-{BUILD_TIME}` 版本化（每次构建新桶，旧桶靠 LRU 回收）
- 数据桶 `cx-data` 固定名（经文 66 卷 + 词典 + parsing）
- SW install 预缓存 PRECACHE_URLS，不 skipWaiting
- SW activate 零清理（已符合）
- 页面侧 `cacheAllResources` → `getCxAppCacheName` 动态查找 `cx-main-*`
- 版本号来源：`app_config.json` → `version.json` → `__BUILD_TIME__` 时间戳
- 更新流程：清缓存 → SKIP_WAITING → reload → checkPwaStartupCache → 全量重缓存

#### 改造项

| # | 文件 | 改动 |
|---|------|------|
| B1 | `src/templates/main_sw.js` | `CACHE_NAME` 改为固定 `'cx-main'`；新增 `DATA_CACHE_PREFIX = 'cx-data-'`；install 不再预缓存（改为 skipWaiting）；fetch handler 中 `isBibleData` 的缓存写入改为不指定桶（走全局 `caches.match`）；`CACHE_ALL_BIBLE` 消息改为写入调用方指定的桶；`CACHE_INFO` 消息兼容 `cx-data-*` |
| B2 | `src/static/index.html` | 新增 `CX_APP_VERSION_INJECT` 占位符；新增 `pwaCache` 模块（`install/checkOnStartup/dataCacheName/cacheAllInto/deleteOldBuckets`）；`cacheAllResources` 改为接收 version 参数，写入 `cx-data-{version}` 桶；`getCxAppCacheName` 简化为返回固定 `'cx-main'`；`showMandatoryInstallDialog` 传 version 给 `cacheAllResources`；`checkPwaStartupCache` 网络失败时用 `CX_APP_VERSION` 兜底 |
| B3 | `main.py` | 新增 `inject_app_version()` 函数，将 `APP_VERSION` 注入 `index.html`；`generate_sw()` 中 `__BUILD_TIME__` 替换改为 `APP_VERSION` 替换（SW 注释中的版本号） |
| B4 | `src/static/js/app-update.js` | PWA 更新流程中调用 `pwaCache.install('update', null, remoteVersion)` 传版本号 |
| B5 | `src/static/js/theme-toggle.js` | 内页缓存检查兼容 `cx-data-*`/`cx-data`/`cx-main`/`cx-main-*` |

#### 关键设计决策

- **CACHE_ALL_BIBLE 消息改造**：当前 SW 收到此消息后批量缓存 66 卷到 `DATA_CACHE`（固定名）。改造后，页面侧 `cacheAllInto` 在 `cacheAllResources` 中直接用 `fetch + cache.put` 缓存全部 URL（包括 66 卷），不再通过 SW message。这样可以统一走"切换桶"逻辑。SW 的 `CACHE_ALL_BIBLE` 消息保留但改为写入调用方通过 `event.data.cacheName` 传入的桶名。
- **PRECACHE_URLS 移除**：SW install 不再预缓存，改为 `skipWaiting()` 快速激活。缓存由页面侧安装对话框管理。
- **静态桶统一**：`cx-main` 固定名，SW fetch handler 的 `cache.put` 覆盖更新，不累积多版本桶。

### 2.2 Books 项目

#### 当前状态
- 单一固定桶 `bk-main`（静态资源 + 数据索引 SWR 加速）
- 书籍数据在 IndexedDB（localforage），SW 不缓存
- SW install 预缓存 PRECACHE_URLS + vendor cMaps/fonts
- SW activate 零清理（已符合）
- 页面侧 `cacheAllBooks` 用 `Promise.allSettled` 并行 fetch + `cache.put` 覆盖
- 无独立数据桶（书籍数据在 IndexedDB，不需要切换桶）
- 版本号来源：`app_config.json` → `version.json`

#### 改造项

| # | 文件 | 改动 |
|---|------|------|
| K1 | `src/templates/main_sw.js` | `CACHE_NAME` 保持 `'bk-main'` 固定（已符合）；新增 `DATA_CACHE_PREFIX = 'bk-data-'`；`CACHE_INFO` 消息兼容 `bk-data-*`；fetch handler 中 `cache:'no-cache'` 直通逻辑保留 |
| K2 | `src/static/index.html` | 新增 `BK_APP_VERSION_INJECT` 占位符；新增 `pwaCache` 模块（`install/checkOnStartup/dataCacheName/cacheAllInto/deleteOldBuckets`）；`cacheAllBooks` 改为 `pwaCache.install` 的封装，写入 `bk-data-{version}` 桶；`checkPwaStartupCache` 传 version 给安装函数；网络失败时用 `BK_APP_VERSION` 兜底 |
| K3 | `generator.py` | 新增 `inject_app_version()` 调用，将 `APP_VERSION` 注入 `index.html` |
| K4 | `src/static/js/app-update/au-init.js` | PWA 更新流程中传版本号给安装函数 |
| K5 | `src/static/js/theme-toggle.js` | 内页缓存检查兼容 `bk-data-*`/`bk-main` |

#### 关键设计决策

- **Books 的"数据桶"仅含静态资源 + 数据索引**：书籍本体数据在 IndexedDB，不受 SW 升级影响。`bk-data-{version}` 桶里放的是 HTML/JS/CSS/icons + `books-index.json` + `manifest.json`，不包含书籍 JSON 本体。
- **IndexedDB 数据不需要切换桶**：localforage 数据跨版本保留，无需改动。
- **SW install 预缓存保留**：books 的 `PRECACHE_URLS` 预缓存机制保留（因为 books 无 SW install 预缓存会导致首次离线不可用），但改为 `skipWaiting()` 快速激活。

## 3. 统一后的架构对比

```
              Bible (改后)              Books (改后)              SG (当前)
─────────────────────────────────────────────────────────────────────────────
静态桶        cx-main (固定)             bk-main (固定)            cx-main (固定)
数据桶        cx-data-{version}         bk-data-{version}         cx-data-{version}
SW install    skipWaiting (无预缓存)     skipWaiting (保留预缓存)   skipWaiting (无预缓存)
SW activate   零清理                     零清理                     零清理
版本号来源     构建注入 APP_VERSION       构建注入 APP_VERSION       构建注入 APP_VERSION
更新保护       切换桶                     切换桶                     切换桶
IndexedDB     无                         书籍数据(不受影响)          无
```

## 4. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| Bible 200+ 文件全量重写耗时长 | `cacheAllInto` 改为 `Promise.allSettled` 并行 fetch（bible 当前已是并行） |
| 旧版用户升级后 `cx-main-*` 残留 | `deleteOldBuckets` 清理旧 `cx-data-*` 桶；`cx-main-*` 旧桶由浏览器 LRU 回收 |
| Books SW install 预缓存 + skipWaiting 冲突 | 预缓存失败不阻塞 install，skipWaiting 快速激活后由页面侧补缓存 |
| 构建注入占位符被遗漏 | 构建脚本检测占位符存在，缺失时告警 |

## 5. 不做的事

- 不改 bible 的 `app-update.js` APK 更新逻辑（仅改 PWA 部分）
- 不改 books 的 IndexedDB/localforage 数据管理层
- 不改三个项目的 CSS/HTML/业务逻辑
- 不统一三个项目的 SW fetch handler 策略细节（各自保留 network-only 列表等差异）

> AI生成