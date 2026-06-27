该项目采用**非侵入式、防御性**的错误处理策略，主要依赖 JavaScript 的 `try-catch` 块和 Promise 链式调用中的 `.catch()` 进行局部捕获与降级处理。系统未定义全局统一的错误类型或中间件，而是根据业务场景（如网络请求、本地存储、原生插件调用）实施具体的容错逻辑。

### 1. 核心策略：竞速与降级 (Race & Fallback)
针对网络资源加载（版本检查、资源包下载、Changelog 获取），项目实现了自定义的 `CX.raceFastest` 工具 (`src/static/js/race-fastest.js`)：
- **并发竞速**：同时向多个镜像源（Cloudflare, GitHub 等）发起请求，首个成功响应者获胜，其余请求被 `AbortController` 取消。
- **超时控制**：设置全局超时，若所有源均失败或超时，则抛出聚合错误信息。
- **降级路径**：在 `resource-pack.js` 等模块中，若 `raceFastest` 不可用，会自动降级为顺序尝试（Sequential Fallback）。

### 2. 原生环境容错 (Capacitor/Native)
在 `app-update.js` 中，针对 Android APK 更新流程实施了多层容错：
- **插件检测**：在执行文件操作前，严格检查 `window.Capacitor.Plugins.Filesystem` 等插件是否存在。
- **多路径保存**：APK 下载后，依次尝试保存到 `EXTERNAL/Download`、`CACHE`、`DATA` 目录，任一成功即停止，避免单一权限问题导致失败。
- **安装回退**：优先调用 `ApkInstaller` 插件，若失败则提示用户手动通过文件管理器安装。
- **错误反馈**：下载失败时提供“在浏览器中打开链接”的备选方案。

### 3. 数据持久化与状态恢复
- **LocalStorage 保护**：所有 `localStorage` 读写操作均包裹在 `try-catch` 中（如 `renderer.js`, `app-update.js`），防止因隐私模式或存储配额已满导致应用崩溃。
- **滚动位置记忆**：在 `renderer.js` 中，滚动位置的保存与恢复具有严格的空值检查和默认值兜底，确保 UI 渲染不因状态读取失败而错位。
- **缓存兜底**：在 `renderer.js` 的 `loadTraining` 中，若网络 fetch 失败（特别是原生环境），会自动尝试从 `Cache Storage` (Service Worker 缓存) 中读取数据，实现离线可用。

### 4. 构建脚本错误处理 (Python)
- **致命错误退出**：在 `main.py` 和 `export_bible_sql_json.py` 中，对于关键资源缺失（如数据库文件不存在），直接调用 `sys.exit(1)` 终止构建。
- **资源存在性检查**：在复制文件或生成 JSON 前，普遍使用 `Path.exists()` 进行预检，缺失时输出警告日志而非直接崩溃。

### 5. 开发者调试支持
- **全局异常捕获**：`dev-console.js` 拦截了 `window.onerror` 和 `unhandledrejection`，将未捕获的异常和 Promise 拒绝记录到内部缓冲区，并在开发者面板中展示，便于排查线上问题。
- **Console 劫持**：重写 `console.error/warn` 等方法，确保即使在不支持原生控制台的环境中也能保留错误日志。

### 开发规范建议
1. **网络请求必带超时与重试**：所有外部 API 调用应优先使用 `CX.raceFastest` 或具备超时控制的 fetch 封装。
2. **原生插件调用需判空**：访问 `window.Capacitor` 及其插件前，必须进行存在性检查。
3. **本地存储操作需包裹 Try-Catch**：严禁直接调用 `localStorage` 方法，必须处理可能的 `QuotaExceededError` 或安全限制。
4. **关键路径失败需有 UI 反馈**：如下载失败、版本检查失败，应向用户展示明确的错误提示或提供备选操作（如手动下载）。