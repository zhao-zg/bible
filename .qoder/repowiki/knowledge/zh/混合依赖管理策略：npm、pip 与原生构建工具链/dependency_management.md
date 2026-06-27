该项目采用混合依赖管理方案，结合了前端（Node.js/npm）、后端脚本（Python/pip）以及移动端原生（Android/Gradle）的生态系统。核心依赖通过 `package.json` 和 `requirements.txt` 声明，并通过 CI/CD 流程自动化安装。

### 1. 依赖系统概览
- **前端/跨平台层**：使用 **npm** 作为包管理器，核心依赖为 **Capacitor** 框架及其插件（如 `@capacitor/core`, `@capacitor/android`），用于将 Web 应用打包为原生 Android APK。
- **构建/数据处理层**：使用 **pip** 管理 Python 依赖，目前仅依赖 `PyYAML` 用于解析配置文件。
- **原生安卓层**：依赖 **Gradle** 进行构建，由 Capacitor 自动管理 `android/` 目录下的 `build.gradle` 和依赖项。
- **第三方库供应**：部分前端库（如 `jszip`, `localforage`）以静态文件形式直接存放在 `src/static/js/vendor/` 目录下，未纳入 npm 管理。

### 2. 关键文件与配置
- **`package.json`**：定义了项目元数据及 npm 依赖。使用了语义化版本控制（如 `^6.0.0`），确保在次版本更新时保持兼容。
- **`requirements.txt`**：声明了 Python 环境所需的 `PyYAML>=6.0`。
- **`build.sh`**：Cloudflare Pages 的构建入口，显式执行 `pip install -r requirements.txt`。
- **`.github/workflows/android-release.yml`**：CI 配置文件，展示了完整的依赖安装流程：先设置 Python/Node/Java 环境，再分别执行 `pip install` 和 `npm install`，最后触发 Gradle 构建。

### 3. 架构约定
- **双端统一构建**：通过 `npm run build` 调用 `python main.py` 生成静态资源，随后利用 `npx cap sync` 将 Web 资源同步至 Android 原生项目，实现了 Web PWA 与 Native APK 的资源共享。
- **供应商库本地化**：对于不常更新或为了简化构建流程的前端库，项目选择直接 vendoring（放入 `vendor` 目录），而非通过 npm 引入，这减少了构建时的网络请求但增加了手动更新的责任。

### 4. 开发者规范
- **环境一致性**：开发时应确保 Node.js (v20+)、Python (3.11+) 和 Java (17) 版本与 CI 环境保持一致。
- **依赖更新**：
  - 前端依赖更新需运行 `npm update` 并提交 `package-lock.json`（若存在）或确保 `package.json` 版本范围正确。
  - Python 依赖更新需修改 `requirements.txt`。
  - 原生 Android 依赖通常由 `npx cap sync` 根据 `package.json` 中的 Capacitor 插件自动同步，不建议手动修改 `android/app/build.gradle` 中的插件依赖。