---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: 'c3fcf714-03e5-4b14-a7c6-8b21b6f678ce'
  PropagateID: 'c3fcf714-03e5-4b14-a7c6-8b21b6f678ce'
  ReservedCode1: '917b755f-eea8-4880-a6d2-c77f2d18b0d5'
  ReservedCode2: '917b755f-eea8-4880-a6d2-c77f2d18b0d5'
---

# 实施计划：启动网络请求门控

**日期**：2026-08-09
**设计文档**：`docs/plans/2026-08-09-startup-network-gate-design.md`

---

## Task 1: 添加中央门控函数 `BK.shouldAllowNetworkRequest()`

**文件**：`src/static/index.html`
**位置**：在 `<script>` 区域开头（CX_ENV 定义之后）

**实现**：
```javascript
window.BK = window.BK || {};
BK._forceNetwork = false;
BK.shouldAllowNetworkRequest = function(reason) {
    if (BK._forceNetwork) return true;
    if (localStorage.getItem('cx_auto_check_update') === '1') return true;
    if (reason === 'first-install') {
        var hasPwa = false, hasApk = false;
        try { hasPwa = !!localStorage.getItem('cx_pwa_version'); } catch(e) {}
        try { hasApk = !!localStorage.getItem('cx_apk_version'); } catch(e) {}
        if (!hasPwa && !hasApk) return true;
    }
    return false;
};
```

**验证**：在控制台执行 `BK.shouldAllowNetworkRequest('first-install')` 应根据 localStorage 状态返回正确值。

---

## Task 2: 守卫 `checkPwaStartupCache()` — version.json fetch

**文件**：`src/static/index.html:542`
**当前代码**：
```javascript
fetch('./version.json?t='+Date.now(),{cache:'no-store'})
```

**修改**：在 fetch 前加门控判断：
```javascript
if (!BK.shouldAllowNetworkRequest('first-install')) {
    console.log('[启动] 自动检查更新已关闭，跳过 PWA version.json 检查');
    return;
}
```

---

## Task 3: 守卫 `reg.update()`

**文件**：`src/static/index.html:602`
**当前代码**：
```javascript
reg.update().catch(function(){});
```

**修改**：
```javascript
if (BK.shouldAllowNetworkRequest('sw-update')) {
    reg.update().catch(function(){});
}
```

**注意**：`reg.update()` 不是 `first-install` 场景，关闭自动更新时一律跳过。

---

## Task 4: 守卫 Capacitor 缓存填充 fetch

**文件**：`src/static/index.html:582`
**当前代码**：
```javascript
fetch('./version.json?t='+Date.now(),{cache:'no-store'})
    .then(...)
    .then(function(v){
        var _ver=v.version||v.apk_version||'';
        if(_capVer&&_capVer===_ver)return;
        cacheAllTrainings(...)
    })
```

**修改**：在 fetch 前加门控：
```javascript
if (!BK.shouldAllowNetworkRequest('first-install')) {
    console.log('[启动] 自动检查更新已关闭，跳过 Capacitor 缓存填充');
} else {
    fetch('./version.json?t='+Date.now(),{cache:'no-store'})
    ...原有逻辑...
}
```

**边界**：有本地版本（`_capVer` 存在）且自动更新关闭 → 跳过。首次安装（无 `_capVer`）→ 放行。

---

## Task 5: 守卫 `_fetchSponsorConfig()`

**文件**：`src/static/js/bible-renderer.js:2941`
**当前代码**：
```javascript
_fetchSponsorConfig();
```

**修改**：
```javascript
if (window.BK && BK.shouldAllowNetworkRequest('sponsor')) {
    _fetchSponsorConfig();
}
```

**赞助按钮可见性**：修改 `_fetchSponsorConfig()` 的逻辑，在跳过探测时默认设置 `CX_SPONSOR = { enable: true }` 使按钮可见（不显示二维码，点击时按需获取）。

**补充修改** `bible-renderer.js:2941` 区域：
```javascript
if (window.BK && !BK.shouldAllowNetworkRequest('sponsor')) {
    // 关闭自动更新时，默认显示赞助入口，点击时按需获取
    window.CX_SPONSOR = { enable: true, wxQr: '', zfbQr: '', _deferred: true };
    var el = document.getElementById('cxSponsorMenuItem');
    if (el) el.style.display = 'flex';
} else {
    _fetchSponsorConfig();
}
```

**点击赞助时延迟获取**（`bible-renderer.js:2317`）：
```javascript
} else if (action === 'sponsor') {
    if (window.CX_SPONSOR && window.CX_SPONSOR._deferred) {
        // 按需获取赞助图
        BK._forceNetwork = true;
        _fetchSponsorConfig();
    }
    if (window.CX && window.CX.showSponsorDialog) window.CX.showSponsorDialog();
}
```

---

## Task 6: 守卫 `AppUpdate.loadConfig()` 降级 fetch

**文件**：`src/static/js/app-update.js:222-234`
**当前代码**：
```javascript
return fetch('./app_config.json', { cache: 'no-cache' })
    .then(...)
```

**修改**：
```javascript
if (!window.BK || !BK.shouldAllowNetworkRequest('first-install')) {
    console.log('[更新] 自动检查更新已关闭，跳过 loadConfig fetch');
    return Promise.resolve();
}
return fetch('./app_config.json', { cache: 'no-cache' })
    .then(...)
```

**边界**：`cx_apk_version` 缓存存在时，前面 `return Promise.resolve()` 已返回，不会走到 fetch。此守卫仅影响缓存不存在的降级场景。

---

## Task 7: 手动检查更新时设置 `_forceNetwork`

**文件**：`src/static/js/bible-renderer.js:2309-2314`
**当前代码**：
```javascript
} else if (action === 'checkUpdate') {
    if (_isCapacitor && window.AppUpdate && window.AppUpdate.showCloudflareUpdateDialog) {
        window.AppUpdate.showCloudflareUpdateDialog();
    } else if (window.AppUpdate && window.AppUpdate.showPwaUpdateDialog) {
        window.AppUpdate.showPwaUpdateDialog({ root: window.CX_ROOT || './' });
    }
}
```

**修改**：
```javascript
} else if (action === 'checkUpdate') {
    if (window.BK) BK._forceNetwork = true;
    if (_isCapacitor && window.AppUpdate && window.AppUpdate.showCloudflareUpdateDialog) {
        window.AppUpdate.showCloudflareUpdateDialog();
    } else if (window.AppUpdate && window.AppUpdate.showPwaUpdateDialog) {
        window.AppUpdate.showPwaUpdateDialog({ root: window.CX_ROOT || './' });
    }
    if (window.BK) BK._forceNetwork = false;
}
```

**同步执行说明**：`showCloudflareUpdateDialog` / `showPwaUpdateDialog` 是同步触发对话框，网络请求在内部异步发起，需要在调用前设置 `_forceNetwork = true`。但由于 JS 单线程，同步设置 → 同步调用 → 同步重置会导致异步 fetch 时 `_forceNetwork` 已为 false。

**修正方案**：不在 action 处设置，而是在 `silentCheckUpdate` 和 `showPwaUpdateDialog` 内部设置，或在门控函数中增加「手动触发」标志（如 sessionStorage）。

**最终方案**：给 `shouldAllowNetworkRequest` 增加「来源检测」：如果调用来自用户主动触发的更新检查（通过 `BK._manualCheckActive = true` 标志），则放行。

```javascript
BK.shouldAllowNetworkRequest = function(reason) {
    if (BK._forceNetwork) return true;
    if (BK._manualCheckActive) return true;  // 手动检查更新期间放行
    if (localStorage.getItem('cx_auto_check_update') === '1') return true;
    if (reason === 'first-install') { ... }
    return false;
};
```

手动检查更新的调用方式：
```javascript
} else if (action === 'checkUpdate') {
    BK._manualCheckActive = true;
    try {
        if (_isCapacitor && window.AppUpdate && window.AppUpdate.showCloudflareUpdateDialog) {
            window.AppUpdate.showCloudflareUpdateDialog();
        } else if (window.AppUpdate && window.AppUpdate.showPwaUpdateDialog) {
            window.AppUpdate.showPwaUpdateDialog({ root: window.CX_ROOT || './' });
        }
    } finally {
        // 延迟重置，确保内部异步 fetch 能读到 true
        setTimeout(function() { BK._manualCheckActive = false; }, 10000);
    }
}
```

---

## 修改文件汇总

| 文件 | 修改数 | 说明 |
|------|--------|------|
| `src/static/index.html` | 4 处 | 门控函数 + checkPwaStartupCache + reg.update + Capacitor 缓存填充 |
| `src/static/js/bible-renderer.js` | 3 处 | _fetchSponsorConfig 守卫 + 赞助按钮默认可见 + 手动检查更新标志 |
| `src/static/js/app-update.js` | 1 处 | loadConfig fetch 守卫 |

## 不受影响的请求

- SW 注册本身（`navigator.serviceWorker.register`）
- 本地数据索引加载（`bible-books.json`、`bible-versions.json`）
- 用户手动操作（手动检查更新、WebDAV 同步）
- 已有守卫的 `silentCheckUpdate()`（两处）