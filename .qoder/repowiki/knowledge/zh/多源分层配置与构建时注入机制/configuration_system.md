该应用采用**多文件、分层级**的配置系统，通过构建脚本（`main.py`）在编译/打包阶段将静态配置文件合并并注入到产物中。配置体系主要服务于两个目标：静态站点（PWA）的生成逻辑与原生 Android 应用的运行时环境。

### 1. 核心配置文件分类

*   **构建与资源映射 (`config.yaml`)**:
    *   这是 Python 构建脚本的核心输入，定义了数据源路径（如 `resource/CG.db`）、输出目录、静态资源根目录以及阅读计划 JSON 列表。
    *   它还包含远程服务器地址（如 GitHub API），用于在构建时生成前端的远程配置脚本。
*   **应用元数据 (`app_config.json`)**:
    *   定义应用的基础身份信息，包括 `app_name`、`app_id` 和 `version`。
    *   该文件在构建过程中被读取以生成 `version.json`，并直接复制到输出目录供前端或原生层读取。
*   **原生桥接配置 (`capacitor.config.json`)**:
    *   针对 Capacitor 框架的配置，指定了 Web 资产目录（`output`）、应用 ID 以及 Android 平台的特定行为（如允许混合内容）。
*   **敏感信息模板 (`android/keystore.properties`)**:
    *   提供 Android 签名所需的密钥库路径和密码占位符。目前以明文模板形式存在，实际使用时需替换为真实凭证或通过环境变量注入。

### 2. 配置加载与处理架构

*   **构建时聚合 (Build-time Aggregation)**:
    *   `main.py` 作为配置中枢，首先加载 `config.yaml`。
    *   它根据 YAML 中的路径指引，调用 `export_bible_sql_json.py` 处理数据库，并将 `app_config.json` 中的版本号提取出来。
*   **动态配置生成**:
    *   **版本管理**: 结合 `app_config.json` 的版本和当前时间，自动生成 `output/version.json`。
    *   **远程配置混淆**: 读取 `config.yaml` 中的 `remote_servers`，将其中的 URL 进行 Base64 编码，并包装成 JavaScript IIFE（立即执行函数表达式）写入 `output/js/remote-config.js`。这种做法在前端隐藏了直接的 API 地址，同时实现了配置的动态注入。
*   **模板替换**:
    *   PWA 的 `manifest.json` 并非直接复制，而是基于 `src/templates/main_manifest.json` 模板，由构建脚本动态填入应用名称和描述后生成。

### 3. 开发者约定与规则

*   **配置分离原则**: 路径与资源映射放在 `config.yaml`，应用身份放在 `app_config.json`，原生能力放在 `capacitor.config.json`。修改构建逻辑时需同步检查 `main.py` 对这些文件的引用。
*   **敏感信息管理**: `keystore.properties` 不应提交真实密码。在生产环境中，建议通过 CI/CD 环境变量覆盖该文件或直接在 Gradle 构建命令中传入参数。
*   **前端配置获取**: 前端代码不应硬编码 API 地址或版本号，而应通过请求 `version.json` 或加载 `remote-config.js` 暴露的全局变量 `window.CX_SERVERS` 来获取运行时配置。