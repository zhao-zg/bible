该项目采用**Python驱动的静态站点生成器**结合**Capacitor跨平台框架**，实现Web PWA与Android APK的双端统一构建。核心逻辑通过`main.py`编排，将SQLite数据导出、静态资源聚合及版本配置生成自动化。

### 1. 构建架构与流程
构建过程分为三个标准化阶段：
*   **数据准备 (Data Prep)**：调用 `export_bible_sql_json.py` 从 `resource/CG.db` 提取经文、注解和串珠数据，生成压缩后的JSON文件至 `output/data/`。支持按书卷分片（Sharding）以优化加载性能。
*   **静态站点生成 (Static Generation)**：将 `src/static` 中的HTML/CSS/JS资产复制到 `output/` 目录，并根据模板动态生成 `manifest.json`（PWA配置）和 `sw.js`（Service Worker）。
*   **版本与配置 (Versioning)**：读取 `app_config.json` 生成 `version.json`，并根据 `config.yaml` 中的远程服务器配置生成混淆后的 `remote-config.js`。

### 2. 多端发布策略
*   **Web PWA**：通过 `.github/workflows/deploy-pages.yml` 实现自动化部署。当代码推送到 `main` 分支时，触发构建并将 `output/` 目录发布至 Cloudflare Pages。
*   **Android APK**：通过 `.github/workflows/android-release.yml` 实现自动化打包。监听 `v*` 标签推送，利用 GitHub Actions 环境（Node.js + Java 17）执行 `npm install` -> `python main.py` -> `npx cap sync` -> `gradlew assembleRelease`，最终将未签名的APK上传至 GitHub Releases。

### 3. 关键配置文件
*   `config.yaml`：定义资源路径、数据库位置及远程API端点。
*   `app_config.json`：管理应用ID、名称及语义化版本号。
*   `package.json`：封装了开发同步 (`cap:sync`) 和发布构建 (`android:build`) 的快捷命令。

### 4. 开发者规范
*   **资源排除**：`main.py` 中定义了 `EXCLUDED_JS_FILES`，构建时会自动剔除训练相关或非生产环境的JS文件（如 `txt-importer.js`）。
*   **数据归一化**：导出脚本支持 `--normalize-xrefs` 参数，用于启发式地标准化串珠引用格式。
*   **版本管理**：修改 `app_config.json` 中的 `version` 字段并推送对应 Git Tag 即可触发新的APK发布流程。