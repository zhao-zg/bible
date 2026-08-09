---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: 'e632851c-20c2-442b-9640-235e0e5f8e53'
  PropagateID: 'e632851c-20c2-442b-9640-235e0e5f8e53'
  ReservedCode1: 'f0e8c267-43b4-4588-a71f-38f67448bc9f'
  ReservedCode2: 'f0e8c267-43b4-4588-a71f-38f67448bc9f'
---

# 设计文档：启动网络请求门控

**日期**：2026-08-09
**目标**：关闭「自动检查更新」时，应用启动不发起任何网络请求（首次安装除外）

---

## 1. 背景

当前启动时有 5 处网络请求不受 `cx_auto_check_update` 控制：
1. `reg.update()` — SW 更新检查（PWA）
2. `checkPwaStartupCache()` fetch — `version.json`（PWA）
3. Capacitor 缓存填充 fetch — `version.json`（Capacitor）
4. `_fetchSponsorConfig()` — CF 服务器竞速（所有环境）
5. `AppUpdate.loadConfig()` 降级 — `app_config.json`（Capacitor 首次）

## 2. 方案选择

**方案 B：中央网络拦截器**

- 创建统一的 `BK.shouldAllowNetworkRequest(reason)` 门控函数
- 所有启动网络请求经此门控判断是否放行
- 手动触发时临时设 `BK._forceNetwork = true` 绕过
- 单一控制点，易维护，不易遗漏

## 3. 核心设计

### 3.1 门控函数

```javascript
window.BK = window.BK || {};
BK.shouldAllowNetworkRequest = function(reason) {
    // 手动强制放行（用户主动操作时临时设置）
    if (BK._forceNetwork) return true;
    // 自动检查更新已开启 → 允许
    if (localStorage.getItem('cx_auto_check_update') === '1') return true;
    // 首次安装（无本地版本）→ 允许 version.json 相关请求
    if (reason === 'first-install') {
        var hasLocal = localStorage.getItem('cx_pwa_version') || localStorage.getItem('cx_apk_version');
        if (!hasLocal) return true;
    }
    // 其他情况：关闭自动更新 → 拒绝
    return false;
};
```

### 3.2 受控请求点（5 处）

| # | 文件:行号 | 原始调用 | 门控后行为 |
|---|-----------|---------|-----------|
| 1 | `index.html:602` | `reg.update()` | 关闭时不调用 |
| 2 | `index.html:542` | `fetch('./version.json')` | 关闭时跳过（首次安装除外） |
| 3 | `index.html:582` | `fetch('./version.json')` Capacitor | 关闭时跳过（有本地版本且 APK 未升级时） |
| 4 | `bible-renderer.js:2941` | `_fetchSponsorConfig()` | 关闭时跳过，按钮默认可见 |
| 5 | `app-update.js:223` | `loadConfig()` fetch | 关闭时跳过（仅首次安装放行） |

### 3.3 不受控请求（保持不变）

- **SW 注册**本身（`navigator.serviceWorker.register`）：浏览器行为，无法控制且不产生实际网络请求（走 SW 缓存）
- **本地数据索引加载**（`bible-books.json`、`bible-versions.json`）：走 SW cache-first，通常无实际网络请求
- **用户主动操作**（手动检查更新、WebDAV 同步等）：不受此开关影响

### 3.4 手动触发绕过机制

用户点击「检查更新」按钮时：
```javascript
BK._forceNetwork = true;
AppUpdate.checkUpdate(); // 内部网络请求会被放行
// 完成后重置
.finally(function() { BK._forceNetwork = false; });
```

### 3.5 赞助按钮可见性

关闭自动更新时，`_fetchSponsorConfig()` 不执行，但赞助按钮**默认可见**。
用户点击赞助按钮时，再按需 fetch 赞助图（此时设置 `_forceNetwork = true`）。

### 3.6 Capacitor 缓存填充优化

使用 `cx_apk_version`（来自 Capacitor 原生，无需网络）与 `cx_pwa_version` 对比检测 APK 升级：
- 有本地版本 + APK 版本未变 → 跳过 version.json fetch
- 首次安装或 APK 升级 → 允许 fetch

## 4. 边界场景

| 场景 | 行为 |
|------|------|
| 首次安装（无本地数据） | 允许 version.json 请求，触发缓存安装 |
| APK 升级后首次打开 | 检测版本差异，允许 version.json 请求 |
| trainings.json 缓存未命中 | 降级走网络（SW cache-first 自然行为） |
| 手动点「检查更新」 | `_forceNetwork=true` 绕过门控 |
| 关闭自动更新 + 无网络 | 无额外请求，正常加载本地数据 |
| 开启自动更新 | 行为与修改前完全一致 |

## 5. 影响范围

修改文件：
1. `index.html` — 门控函数定义 + 4 处调用点守卫
2. `bible-renderer.js` — `_fetchSponsorConfig()` 守卫
3. `app-update.js` — `loadConfig()` 守卫 + 手动触发时 `_forceNetwork` 设置