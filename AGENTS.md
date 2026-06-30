# AGENTS.md — Bible Reader 项目指南

## 项目概述

多语言圣经阅读器 PWA，支持 5 个圣经译本（恢复本、和合本、Darby、KJV、新译本），含注解与串珠功能。通过 Capacitor 打包为 Android APK。

## 构建命令

```bash
# 完整构建（生成 output/ 目录）
python main.py

# 仅导出圣经数据（不复制静态文件）
python export_bible_sql_json.py

# Android APK 构建
npm run android:build        # 构建 + 同步 + Gradle 打包

# Capacitor 同步
npm run cap:sync             # 将 output/ 复制到 Android assets

# 版本发布（交互式）
release.bat
```

**Python 依赖**: `PyYAML>=6.0`, `Pillow>=10.0`（图像压缩可选）

## 架构关键点

### 构建管线（3 阶段）

```
资源文件 (resource/*.db + resource/*.json)
    ↓ Phase 1: export_bible_sql_json.py
output/data/ (JSON 分片)
    ↓ Phase 2: 复制 src/static/ → output/
output/ (完整静态站点)
    ↓ Phase 3: 生成 version.json, remote-config.js
PWA 就绪 / Capacitor 同步
```

### ⚠️ 重要规则

1. **`output/` 是生成目录** — 不要直接编辑其中的文件，修改应在 `src/static/` 或构建脚本中进行。
2. **`src/static/` 是前端源码** — 所有 HTML/CSS/JS 的修改在这里进行。
3. **数据源在 `resource/`** — SQLite 数据库 (`.db`) 和读经计划 JSON，不直接编辑 `output/data/`。

### 前端架构（无框架 SPA）

| 文件 | 职责 |
|------|------|
| `src/static/js/router.js` | Hash 路由 (`#/bible/1/1`) |
| `src/static/js/renderer.js` | 通用渲染器：JSON → HTML |
| `src/static/js/bible-renderer.js` | 圣经阅读 UI：书卷列表、章节、版本切换 |
| `src/static/js/search.js` | 全文搜索（66 卷渐进索引） |
| `src/static/js/i18n.js` | 15+ 语言国际化 |
| `src/static/js/speech.js` | TTS 语音朗读 |

- **事件委托模式**: 所有事件绑定在 `#app` 容器上（因为 `innerHTML` 替换会清除子元素事件）
- **离线优先**: Service Worker (`src/templates/main_sw.js`) 缓存所有静态资源
- **数据按需加载**: 66 卷圣经分片为 `bible/{01..66}.json`，前端按需 fetch

### 圣经数据格式

经文中使用特殊标记：
- `{N}` — 注解序号锚点（如 `{1}` 指向第 1 条注解）
- `[a-z]` — 串珠字母锚点（如 `[a]` 指向交叉引用）

在 `output/data/bible/01.json` 中：
```json
{
  "book_index": 1,
  "chapters": [{
    "chapter": 1,
    "verses": [{
      "section": 1,
      "content": "{1}[a]起初神创造诸天与地，",
      "footnotes": [{"seq": 1, "note": "..."}],
      "beads": [{"seq": "a", "bead": "约1:1,约1:2"}]
    }]
  }]
}
```

### 排除的前端文件

构建时以下 `src/static/js/` 文件**不会**被复制到 `output/`：
- `txt-importer.js`, `resource-pack.js`, `toc-redirect.js`, `training-enricher.js`
（这些是从训练应用模板继承来的，本项目不使用）

## 配置

- `config.yaml` — 构建配置（目录、读经计划、远程服务器 URL）
- `app_config.json` — 应用版本号和运行时配置
- `capacitor.config.json` — Capacitor 配置，`webDir` 指向 `output`

## 项目命名遗留

本项目是从一个训练应用模板派生的，部分命名仍保留模板痕迹：
- `manifest.json` 模板中的占位名 `"Training App"` 在构建时被替换为 `"圣经"`
- `src/static/js/` 中排除了训练相关的 JS 文件
