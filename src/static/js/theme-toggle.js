/**
 * 主题切换和字体控制功能模块
 * 支持 5 种圣经主题切换和字体大小调整
 * 参考微圣经 UI 设计
 */

// ── 笔记备份/恢复守卫：防止升级或意外 reload 导致 cx_highlights 丢失 ─────────
(function() {
    'use strict';
    var NOTES_KEY   = 'cx_highlights';
    var BACKUP_KEY  = 'cx_highlights_bak';
    var BACKUP_TS_KEY = 'cx_highlights_bak_ts';

    // 已迁移到 IndexedDB：备份守卫置空，旧 localStorage 备份键无意义
    try {
        if (localStorage.getItem('cx_hl_migrated') === '1') {
            window.CX = window.CX || {};
            window.CX.notesGuard = { save: function() {} };
            return;
        }
    } catch(e) {}

    // 启动时：若主键为空但备份存在（30天内），静默恢复
    try {
        var current = localStorage.getItem(NOTES_KEY);
        var backup  = localStorage.getItem(BACKUP_KEY);
        var backupTs = parseInt(localStorage.getItem(BACKUP_TS_KEY) || '0', 10);
        var day30 = 30 * 24 * 60 * 60 * 1000;
        if ((!current || current === '{}' || current === '[]') &&
            backup && backup.length > 2 &&
            backupTs && (Date.now() - backupTs) < day30) {
            localStorage.setItem(NOTES_KEY, backup);
            console.log('[笔记守卫] 从备份恢复笔记，备份时间:', new Date(backupTs).toLocaleString());
        }
    } catch(e) {}

    // 当 app 切入后台时刷新备份（visibilitychange 比 beforeunload 在移动端更可靠）
    function saveNotesBackup() {
        try {
            var notes = localStorage.getItem(NOTES_KEY);
            if (notes && notes.length > 2 && notes !== '{}' && notes !== '[]') {
                localStorage.setItem(BACKUP_KEY, notes);
                localStorage.setItem(BACKUP_TS_KEY, Date.now().toString());
            }
        } catch(e) {}
    }

    document.addEventListener('visibilitychange', function() {
        if (document.hidden) saveNotesBackup();
    });
    window.addEventListener('beforeunload', saveNotesBackup);

    // 暴露给外部调用（如 clearAllCachesAndMemory 清除 cx_ 键时同步清备份）
    window.CX = window.CX || {};
    window.CX.notesGuard = { save: saveNotesBackup };
})();


// ── 错误日志收集器 ──────────────────────────────────────────────────────────
(function() {
    'use strict';
    var LOG_KEY     = 'cx_error_log';
    var LOG_VER_KEY = 'cx_error_log_ver';
    var MAX_ENTRIES = 40;

    function getCurrentVersion() {
        try {
            return localStorage.getItem('cx_apk_version') ||
                   localStorage.getItem('cx_pwa_version') || '';
        } catch(e) { return ''; }
    }

    function clearStaleErrorLog() {
        try {
            var savedVer = localStorage.getItem(LOG_VER_KEY);
            if (!savedVer) return;
            var curVer = getCurrentVersion();
            if (curVer && curVer !== savedVer) {
                localStorage.removeItem(LOG_KEY);
                localStorage.removeItem(LOG_VER_KEY);
            }
        } catch(e) {}
    }
    clearStaleErrorLog();

    function appendLog(entry) {
        try {
            var arr = [];
            try { arr = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch(e) {}
            if (!Array.isArray(arr)) arr = [];
            if (arr.length === 0) {
                try { localStorage.setItem(LOG_VER_KEY, getCurrentVersion()); } catch(e) {}
            }
            arr.push(entry);
            if (arr.length > MAX_ENTRIES) arr = arr.slice(arr.length - MAX_ENTRIES);
            localStorage.setItem(LOG_KEY, JSON.stringify(arr));
        } catch(e) {}
    }

    var _origOnerror = window.onerror;
    window.onerror = function(msg, src, line, col, err) {
        var m = String(msg || '');
        if (m.indexOf('Script error') === 0) return false;
        appendLog({
            t: Date.now(),
            m: m.substring(0, 250),
            s: (src || '').replace(/^.*\//, '') + ':' + line
        });
        if (_origOnerror) return _origOnerror.apply(this, arguments);
        return false;
    };

    window.addEventListener('unhandledrejection', function(e) {
        var msg = '';
        try {
            msg = e.reason ? (e.reason.message || String(e.reason)) : 'unhandledrejection';
        } catch(ex) { msg = 'unhandledrejection'; }
        appendLog({ t: Date.now(), m: msg.substring(0, 250) });
    });

    window.CX = window.CX || {};
    window.CX.errorLog = {
        get:   function() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch(e) { return []; } },
        clear: function() { try { localStorage.removeItem(LOG_KEY); localStorage.removeItem(LOG_VER_KEY); } catch(e) {} }
    };
})();


// ── Native 崩溃日志收集（APK 专用）──────────────────────────────────────────
(function() {
    'use strict';
    var CRASH_KEY         = 'cx_native_crash';
    var CRASH_VERSION_KEY = 'cx_native_crash_ver';
    function fetchNativeCrash() {
        try {
            var p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CrashLog;
            if (!p || typeof p.getLastCrash !== 'function') return;
            p.getLastCrash().then(function(res) {
                if (res && res.log) {
                    var verLine = res.log.split('\n')[0] || '';
                    var verMatch = verLine.match(/^Version:\s*(.+)/);
                    var logVer = verMatch ? verMatch[1].trim() : '';
                    try {
                        localStorage.setItem(CRASH_KEY, res.log);
                        if (logVer) localStorage.setItem(CRASH_VERSION_KEY, logVer);
                    } catch(e) {}
                }
            }).catch(function() {});
        } catch(e) {}
    }
    function clearStaleVersionLog() {
        try {
            var storedCrashVer = localStorage.getItem(CRASH_VERSION_KEY);
            if (!storedCrashVer) return;
            var currentVer = localStorage.getItem('cx_apk_version') || '';
            if (currentVer && currentVer !== storedCrashVer) {
                localStorage.removeItem(CRASH_KEY);
                localStorage.removeItem(CRASH_VERSION_KEY);
            }
        } catch(e) {}
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            clearStaleVersionLog();
            fetchNativeCrash();
        });
    } else {
        setTimeout(function() { clearStaleVersionLog(); fetchNativeCrash(); }, 0);
    }
    window.CX = window.CX || {};
    window.CX.nativeCrashLog = {
        get:   function() { try { return localStorage.getItem(CRASH_KEY) || ''; } catch(e) { return ''; } },
        clear: function() { try { localStorage.removeItem(CRASH_KEY); localStorage.removeItem(CRASH_VERSION_KEY); } catch(e) {} }
    };
})();


// ── CX.backStack：统一对话框/弹框返回键调度器 ──────────────────────────────
(function() {
    'use strict';
    window.CX = window.CX || {};
    var _stack = [];
    var _skip = 0;
    window.addEventListener('popstate', function() {
        if (_skip > 0) { _skip--; return; }
        if (_stack.length > 0) {
            var fn = _stack.pop();
            if (fn) fn();
        } else if (window.CX.backStack._fallback) {
            window.CX.backStack._fallback();
        }
    });
    window.CX.backStack = {
        _fallback: null,
        push: function(fn) {
            _stack.push(fn);
            try { history.pushState({ cxBack: true }, ''); } catch(e) {}
        },
        pop: function() {
            if (_stack.length > 0) {
                _stack.pop();
                _skip++;
                try { history.back(); } catch(e) {}
            }
        },
        size: function() { return _stack.length; },
        setFallback: function(fn) { this._fallback = fn; },
        skipNext: function() { _skip++; },
        abandon: function() {
            if (_stack.length > 0) { _stack.pop(); _skip++; }
        },
        discard: function() {
            if (_stack.length > 0) { _stack.pop(); }
        }
    };

    window.CX.lockOverlayScroll = function(overlay, onTapOverlay) {
        var _tsY = 0;
        function _onTouchStart(e) {
            if (e.touches && e.touches.length) _tsY = e.touches[0].clientY;
        }
        function _onTouchMove(e) {
            var el = e.target;
            var scrollable = null;
            while (el && el !== overlay) {
                var tag = (el.tagName || '').toLowerCase();
                var oy  = window.getComputedStyle(el).overflowY;
                if (((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) ||
                    (tag === 'textarea' && el.scrollHeight > el.clientHeight)) {
                    scrollable = el;
                    break;
                }
                el = el.parentElement;
            }
            if (scrollable) {
                var down  = e.touches[0].clientY < _tsY;
                var atTop = scrollable.scrollTop <= 0;
                var atBot = scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1;
                if ((atTop && !down) || (atBot && down)) e.preventDefault();
            } else {
                e.preventDefault();
            }
        }
        function _onTouchEnd(e) {
            if (e.target === overlay) {
                e.preventDefault();
                e.stopPropagation();
                if (onTapOverlay) onTapOverlay();
            }
        }
        overlay.addEventListener('touchstart', _onTouchStart, { passive: true });
        overlay.addEventListener('touchmove',  _onTouchMove,  { passive: false });
        overlay.addEventListener('touchend',   _onTouchEnd,   { passive: false });
        return function() {
            overlay.removeEventListener('touchstart', _onTouchStart);
            overlay.removeEventListener('touchmove',  _onTouchMove);
            overlay.removeEventListener('touchend',   _onTouchEnd);
        };
    };

    window.CX.openDialog = function(opts) {
        if (opts.id && document.getElementById(opts.id)) return null;
        var mask = document.createElement('div');
        if (opts.id) mask.id = opts.id;
        mask.className = opts.className || 'cx-dialog-mask';
        mask.innerHTML = opts.html || '';
        document.body.appendChild(mask);
        var _closed = false;
        function _destroy() {
            if (_closed) return; _closed = true;
            if (mask.parentNode) mask.parentNode.removeChild(mask);
            if (opts.onClose) opts.onClose();
        }
        window.CX.backStack.push(function() { _destroy(); });
        function close() { _destroy(); window.CX.backStack.pop(); }
        window.CX.lockOverlayScroll(mask, function() { try { history.back(); } catch(e) {} });
        mask.addEventListener('click', function(e) {
            if (e.target === mask) { e.stopPropagation(); try { history.back(); } catch(e) {} }
        });
        return { mask: mask, close: close };
    };
})();


// ══════════════════════════════════════════════════════════════
// 主题切换和字体控制（5 种圣经主题）
// ══════════════════════════════════════════════════════════════
(function() {
    'use strict';

    // ── 5 种主题名称 ──
    var VALID_THEMES = ['gray-white', 'light-yellow', 'warm-yellow', 'dark-gray', 'night'];
    var DEFAULT_THEME = 'warm-yellow';

    // meta[name=theme-color] 对应色值
    var themeMetaColors = {
        'gray-white':   '#FFFFFF',
        'light-yellow': '#FFF8E7',
        'warm-yellow':  '#F5F0E6',
        'dark-gray':    '#3E3E3E',
        'night':        '#1A1A1A'
    };

    // 深色主题列表（状态栏白色图标）
    var darkThemes = { 'dark-gray': true, 'night': true };

    // 字号 5 级：14, 16, 18, 20, 22
    var fontSizes = [14, 16, 18, 20, 22];
    var defaultSizeIndex = 2; // 18px
    var currentSizeIndex = defaultSizeIndex;

    var pageScrollLockCount = 0;

    // ── 内容显示开关状态（与 bible-renderer.js 共享 localStorage）──
    var _toggleKeys = ['showTheme', 'showIntro', 'showOutline', 'showVerseDivider'];
    var _toggleDefaults = {
        showTheme: true, showIntro: true, showOutline: true,
        showVerseDivider: true
    };

    function loadToggleStates() {
        try {
            var saved = JSON.parse(localStorage.getItem('bible_toggles') || '{}');
            Object.keys(saved).forEach(function(k) {
                if (k in _toggleDefaults) _toggleDefaults[k] = !!saved[k];
            });
        } catch(e) {}
    }
    function saveToggleStates() {
        try { localStorage.setItem('bible_toggles', JSON.stringify(_toggleDefaults)); } catch(e) {}
    }

    // ── localStorage 读写 ──
    function getStoredTheme() {
        try {
            var theme = localStorage.getItem('readingTheme');
            if (VALID_THEMES.indexOf(theme) !== -1) return theme;
            // 兼容旧版 cool/warm/dark
            var legacyMap = { cool: 'gray-white', warm: 'warm-yellow', dark: 'night' };
            if (legacyMap[theme]) {
                localStorage.setItem('readingTheme', legacyMap[theme]);
                return legacyMap[theme];
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    function getPreferredTheme() {
        var savedTheme = getStoredTheme();
        if (savedTheme) return savedTheme;
        try {
            return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark-gray' : DEFAULT_THEME;
        } catch (e) {
            return DEFAULT_THEME;
        }
    }

    function syncThemeColor(theme) {
        var color = themeMetaColors[theme] || themeMetaColors[DEFAULT_THEME];
        var metaThemeColor = document.querySelector('meta[name="theme-color"]');
        if (metaThemeColor) metaThemeColor.setAttribute('content', color);
        try {
            var sb = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
            if (sb) {
                sb.setBackgroundColor({ color: color });
                sb.setStyle({ style: darkThemes[theme] ? 'DARK' : 'LIGHT' });
            }
        } catch (e) {}
    }

    function lockPageScroll() {
        pageScrollLockCount += 1;
        document.documentElement.classList.add('cx-scroll-locked');
        document.body.classList.add('cx-scroll-locked');
    }

    function unlockPageScroll() {
        pageScrollLockCount = Math.max(0, pageScrollLockCount - 1);
        if (pageScrollLockCount === 0) {
            document.documentElement.classList.remove('cx-scroll-locked');
            document.body.classList.remove('cx-scroll-locked');
        }
    }

    // ── 初始化入口 ──
    function initDevConsole()  { window.CXDevConsole && window.CXDevConsole.init(); }
    function destroyDevConsole() { window.CXDevConsole && window.CXDevConsole.destroy(); }

    function initThemeToggle() {
        // 内页启动缓存检测
        (function() {
            var root = window.CX_ROOT || './';
            if (root === './') return;
            var isStandalone = window.navigator.standalone === true ||
                               window.matchMedia('(display-mode: standalone)').matches;
            var isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform &&
                                 window.Capacitor.isNativePlatform());
            if (!isStandalone || isCapacitor || !('caches' in window)) return;
            var storedVersion = null;
            try { storedVersion = localStorage.getItem('cx_pwa_version'); } catch(e) {}
            if (!storedVersion) {
                window.location.replace(root + 'index.html');
                return;
            }
            caches.keys().then(function(keys) {
                var hasCoreCache = keys.some(function(k) {
                    return k === 'cx-main' || k.indexOf('cx-main-') === 0;
                });
                if (!hasCoreCache) {
                    window.location.replace(root + 'index.html');
                }
            }).catch(function() {});
        })();

        var containerEl = document.querySelector('.container') || document.body;

        // 创建设置按钮（齿轮图标）
        var toggleBtn = document.createElement('div');
        toggleBtn.className = 'theme-toggle-btn';
        toggleBtn.onclick = toggleThemePanel;
        toggleBtn.title = '设置';
        toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6M1 12h6m6 0h6"/><path d="M4.2 4.2l4.3 4.3m5.5 5.5l4.3 4.3M4.2 19.8l4.3-4.3m5.5-5.5l4.3-4.3"/></svg>';
        containerEl.appendChild(toggleBtn);

        // 创建遮罩层
        var overlay = document.createElement('div');
        overlay.className = 'theme-panel-overlay';
        overlay.id = 'themePanelOverlay';
        overlay.onclick = function() { window.toggleThemePanel(); };
        document.body.appendChild(overlay);

        // 创建设置面板
        var panel = document.createElement('div');
        panel.className = 'theme-panel';
        panel.id = 'themePanel';
        panel.innerHTML = buildPanelHTML();
        document.body.appendChild(panel);

        window.CX.lockOverlayScroll(overlay, function() { window.toggleThemePanel(); });

        // 加载保存的主题
        var initialTheme = getPreferredTheme();
        document.documentElement.setAttribute('data-theme', initialTheme);
        updateThemeUI(initialTheme);
        syncThemeColor(initialTheme);

        // 加载保存的字体大小
        var savedSize = localStorage.getItem('globalFontSize');
        if (savedSize) {
            var savedIndex = fontSizes.indexOf(parseInt(savedSize));
            if (savedIndex !== -1) {
                currentSizeIndex = savedIndex;
                applyFontSize(savedSize);
            }
        }
        updateFontSizeUI();

        // 加载开关状态
        loadToggleStates();
        syncToggleUI();

        // 点击外部关闭面板
        document.addEventListener('click', function(e) {
            var p = document.getElementById('themePanel');
            var btn = document.querySelector('.theme-toggle-btn');
            if (p && p.classList.contains('show') && !p.contains(e.target) && !btn.contains(e.target)) {
                if (e.target.closest && e.target.closest('.cx-dialog-mask')) return;
                var masks = document.querySelectorAll('.cx-dialog-mask');
                for (var i = 0; i < masks.length; i++) {
                    if (masks[i].contains(e.target)) return;
                }
                window.toggleThemePanel();
            }
        });

        // ESC 关闭面板
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                var p = document.getElementById('themePanel');
                if (p && p.classList.contains('show')) {
                    window.toggleThemePanel();
                }
            }
        });

        // 初始化操作区按钮
        initSettingsActions();

        // 开发者模式
        try { if (localStorage.getItem('cx_dev_mode') === '1') initDevConsole(); } catch(e) {}

        // 跟随系统深浅色
        if (window.matchMedia) {
            var themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
            var handleThemeQueryChange = function(event) {
                if (getStoredTheme()) return;
                var nextTheme = event.matches ? 'dark-gray' : DEFAULT_THEME;
                document.documentElement.setAttribute('data-theme', nextTheme);
                updateThemeUI(nextTheme);
                syncThemeColor(nextTheme);
            };
            if (typeof themeQuery.addEventListener === 'function') {
                themeQuery.addEventListener('change', handleThemeQueryChange);
            } else if (typeof themeQuery.addListener === 'function') {
                themeQuery.addListener(handleThemeQueryChange);
            }
        }
    }

    // ── 构建面板 HTML ──
    function buildPanelHTML() {
        var html = '';
        html += '<div class="theme-panel-header">';
        html += '  <div class="theme-panel-title">设置</div>';
        html += '  <button class="theme-panel-close" onclick="toggleThemePanel()" title="关闭">×</button>';
        html += '</div>';

        // 阅读主题（5 种色卡）
        html += '<div class="theme-section">';
        html += '  <div class="theme-section-title">阅读主题</div>';
        html += '  <div class="theme-options" style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">';
        var themes = [
            { value: 'gray-white',   label: '灰白',   bg: '#FFFFFF', fg: '#333' },
            { value: 'light-yellow', label: '浅黄',   bg: '#FFF8E7', fg: '#333' },
            { value: 'warm-yellow',  label: '米黄',   bg: '#F5F0E6', fg: '#333' },
            { value: 'dark-gray',    label: '深灰',   bg: '#3E3E3E', fg: '#F5F5F5' },
            { value: 'night',        label: '黑夜',   bg: '#1A1A1A', fg: '#E0E0E0' }
        ];
        themes.forEach(function(t) {
            html += '<div class="theme-swatch-card" data-theme="' + t.value + '" '
                  + 'style="width:56px;height:36px;border-radius:8px;cursor:pointer;display:flex;'
                  + 'align-items:center;justify-content:center;font-size:11px;'
                  + 'background:' + t.bg + ';color:' + t.fg + ';border:2px solid transparent;'
                  + '-webkit-tap-highlight-color:transparent" '
                  + 'onclick="setTheme(\'' + t.value + '\')">'
                  + t.label + '</div>';
        });
        html += '  </div>';
        html += '</div>';

        // 字体大小（A→A 滑块，5 级）
        html += '<div class="theme-section">';
        html += '  <div class="theme-section-title">字体大小</div>';
        html += '  <div class="font-size-slider-container">';
        html += '    <span class="font-label-small">A</span>';
        html += '    <input type="range" class="font-size-slider" id="fontSizeSlider" '
              + '           min="0" max="4" step="1" value="' + defaultSizeIndex + '" '
              + '           oninput="handleFontSliderChange(this.value)">';
        html += '    <span class="font-label-large">A</span>';
        html += '    <span class="font-size-value" id="fontSizeDisplay">' + fontSizes[defaultSizeIndex] + 'px</span>';
        html += '  </div>';
        html += '</div>';

        // 朗读速度
        html += '<div class="theme-section">';
        html += '  <div class="theme-section-title">朗读速度</div>';
        html += '  <div class="font-size-slider-container">';
        html += '    <span style="font-size:12px;color:var(--text-muted,#999)">慢</span>';
        html += '    <input type="range" class="font-size-slider" id="speechRateSlider" '
              + '           min="50" max="200" step="25" value="100" '
              + '           oninput="handleSpeechRateChange(this.value)">';
        html += '    <span style="font-size:12px;color:var(--text-muted,#999)">快</span>';
        html += '    <span class="font-size-value" id="speechRateDisplay">1.0x</span>';
        html += '  </div>';
        html += '</div>';

        // 内容与数据
        html += '<div class="theme-section" id="settingsActionsSection" style="display:none">';
        html += '  <div class="theme-section-title">内容与数据</div>';
        html += '  <div class="actions-grid">';
        html += '    <button class="action-btn" id="bookmarkListBtn">';
        html += '      <span class="cache-icon">📑</span><span class="cache-text">我的书签</span>';
        html += '    </button>';
        html += '    <button class="action-btn danger" id="clearDataBtn" style="display:none">';
        html += '      <span class="cache-icon">🧹</span><span class="cache-text">清理数据</span>';
        html += '    </button>';
        html += '  </div>';
        html += '  <div class="theme-section-title" style="margin-top:14px">应用</div>';
        html += '  <div class="actions-grid">';
        html += '    <button class="action-btn" id="installBtn" style="display:none">';
        html += '      <span class="cache-icon">📲</span><span class="cache-text">发送桌面</span>';
        html += '    </button>';
        html += '    <button class="action-btn" id="androidApkBtn" style="display:none">';
        html += '      <span class="cache-icon">📱</span><span class="cache-text">安卓APK</span>';
        html += '    </button>';
        html += '    <button class="action-btn" id="checkUpdateBtn" style="display:none">';
        html += '      <span class="cache-icon">🔄</span><span class="cache-text">检查更新</span>';
        html += '    </button>';
        html += '    <button class="action-btn" id="guideBtn">';
        html += '      <span class="cache-icon">📖</span><span class="cache-text">使用说明</span>';
        html += '    </button>';
        html += '    <button class="action-btn feedback" id="feedbackBtn">';
        html += '      <span class="cache-icon">💬</span><span class="cache-text">问题反馈</span>';
        html += '    </button>';
        html += '    <button class="action-btn sponsor" id="sponsorBtn" style="display:none">';
        html += '      <span class="cache-icon">❤️</span><span class="cache-text">顾念微工</span>';
        html += '    </button>';
        html += '  </div>';
        html += '  <div class="cache-status" id="actionStatus"></div>';
        html += '</div>';

        // 自动检查更新
        html += '<div class="theme-section" id="autoCheckSection" style="display:none">';
        html += '  <div class="theme-section-title">偏好设置</div>';
        html += '  <div class="pref-row">';
        html += '    <div class="pref-label-wrap">';
        html += '      <span class="pref-title">自动检查更新</span>';
        html += '      <span class="pref-desc">启动时自动检查是否有新版本</span>';
        html += '    </div>';
        html += '    <label class="pref-toggle">';
        html += '      <input type="checkbox" id="autoCheckUpdateToggle">';
        html += '      <span class="pref-toggle-slider"></span>';
        html += '    </label>';
        html += '  </div>';
        html += '</div>';

        // 版本信息
        html += '<div class="theme-section" style="text-align:center;padding:8px 0 4px">';
        html += '  <span id="versionInfoText" style="font-size:11px;color:var(--text-muted,#999)"></span>';
        html += '</div>';

        return html;
    }

    // ── 初始化设置面板操作区 ──
    function initSettingsActions() {
        window.CX = window.CX || {};
        var section = document.getElementById('settingsActionsSection');
        if (section) section.style.display = 'block';
        var statusEl = document.getElementById('actionStatus');

        // 使用时长跟踪
        (function() {
            try {
                if (!localStorage.getItem('cx_first_use')) {
                    localStorage.setItem('cx_first_use', Date.now().toString());
                }
            } catch(e) {}
        })();

        // 顾念微工（使用超过 5 分钟后显示）
        (function() {
            try {
                var firstUse = parseInt(localStorage.getItem('cx_first_use') || '0', 10);
                var elapsed = firstUse ? (Date.now() - firstUse) : 0;
                if (elapsed >= 5 * 60 * 1000) {
                    var sponsorBtn = document.getElementById('sponsorBtn');
                    if (sponsorBtn) {
                        sponsorBtn.style.display = 'inline-flex';
                        sponsorBtn.addEventListener('click', showSponsorDialog);
                    }
                }
            } catch(e) {}
        })();

        // 使用说明
        (function() {
            var guideBtn = document.getElementById('guideBtn');
            if (guideBtn) guideBtn.addEventListener('click', showGuideDialog);
        })();

        // 反馈问题
        (function() {
            var feedbackBtn = document.getElementById('feedbackBtn');
            if (feedbackBtn) feedbackBtn.addEventListener('click', showFeedbackDialog);
        })();

        // 我的书签
        (function() {
            var bmListBtn = document.getElementById('bookmarkListBtn');
            if (bmListBtn) {
                bmListBtn.addEventListener('click', function() {
                    if (typeof window.toggleThemePanel === 'function') window.toggleThemePanel();
                    setTimeout(function() {
                        if (window.CXBookmark && window.CXBookmark.showList) {
                            window.CXBookmark.showList();
                        }
                    }, 300);
                });
            }
        })();

        // 环境检测
        var ua = navigator.userAgent;
        var isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform &&
                             window.Capacitor.isNativePlatform());
        var isAndroid = /Android/i.test(ua);
        var isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
        var isStandalone = (window.navigator.standalone === true) ||
                           window.matchMedia('(display-mode: standalone)').matches;

        // 清理数据
        var clearBtn = document.getElementById('clearDataBtn');
        if (clearBtn) {
            clearBtn.style.display = 'inline-flex';
            clearBtn.addEventListener('click', function() {
                if (window.CX.clearData) { window.CX.clearData(); }
                else { defaultPromptClearData(); }
            });
        }

        // 检查更新
        var updateBtn = document.getElementById('checkUpdateBtn');
        if (isCapacitor) {
            if (updateBtn) {
                updateBtn.style.display = 'inline-flex';
                updateBtn.addEventListener('click', function() {
                    if (window.AppUpdate && window.AppUpdate.showCloudflareUpdateDialog) {
                        window.AppUpdate.showCloudflareUpdateDialog();
                    }
                });
            }
        } else if (isStandalone && ('caches' in window)) {
            if (updateBtn) {
                updateBtn.style.display = 'inline-flex';
                updateBtn.addEventListener('click', function() {
                    var root = window.CX_ROOT || './';
                    if (window.AppUpdate && window.AppUpdate.showPwaUpdateDialog) {
                        window.AppUpdate.showPwaUpdateDialog({ root: root, statusEl: statusEl });
                    }
                });
            }
        }

        // 自动检查更新偏好
        if (isCapacitor || (isStandalone && ('caches' in window))) {
            var autoCheckSection = document.getElementById('autoCheckSection');
            var autoCheckToggle  = document.getElementById('autoCheckUpdateToggle');
            if (autoCheckSection) autoCheckSection.style.display = '';
            if (autoCheckToggle) {
                try { autoCheckToggle.checked = localStorage.getItem('cx_auto_check_update') === '1'; } catch(e) {}
                autoCheckToggle.addEventListener('change', function() {
                    try {
                        if (this.checked) localStorage.setItem('cx_auto_check_update', '1');
                        else localStorage.removeItem('cx_auto_check_update');
                    } catch(e) {}
                });
            }
        }

        // 安卓离线 APK
        var apkBtn = document.getElementById('androidApkBtn');
        if (isAndroid && !isCapacitor) {
            if (apkBtn) {
                apkBtn.style.display = 'inline-flex';
                apkBtn.addEventListener('click', function() {
                    if (window.CX.downloadApk) { window.CX.downloadApk(); return; }
                    var root = window.CX_ROOT || './';
                    if (statusEl) { statusEl.textContent = '正在获取最新版本...'; statusEl.className = 'cache-status'; }
                    fetch(root + 'version.json?t=' + Date.now(), { cache: 'no-cache' })
                        .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
                        .then(function(v) {
                            var f = v.apk_file || ('Bible-v' + (v.apk_version || v.version) + '.apk');
                            var sz = v.apk_size ? ' (' + (v.apk_size / 1024 / 1024).toFixed(1) + ' MB)' : '';
                            if (statusEl) { statusEl.textContent = '正在下载 v' + (v.apk_version || v.version) + sz + '...'; statusEl.className = 'cache-status success'; }
                            window.open(root + f, '_blank');
                        })
                        .catch(function(e) {
                            if (statusEl) { statusEl.textContent = '获取失败: ' + e.message; statusEl.className = 'cache-status error'; }
                        });
                });
            }
        }

        // PWA 安装到桌面
        var installBtn = document.getElementById('installBtn');
        if (installBtn) {
            if (isIOS && !isStandalone) {
                installBtn.style.display = 'inline-flex';
                installBtn.addEventListener('click', function() {
                    if (window.CX.installIOS) { window.CX.installIOS(); return; }
                    if (statusEl) {
                        statusEl.innerHTML = '请点击浏览器底部 <strong>分享按钮 ↑</strong>，然后选择 <strong>"添加到主屏幕"</strong>';
                        statusEl.className = 'cache-status';
                    }
                });
            } else {
                window.addEventListener('beforeinstallprompt', function(e) {
                    e.preventDefault();
                    window._pwaInstallPrompt = e;
                    installBtn.style.display = 'inline-flex';
                });
                installBtn.addEventListener('click', function() {
                    if (window.CX.installPWA) { window.CX.installPWA(); return; }
                    var p = window._pwaInstallPrompt;
                    if (!p) return;
                    window._pwaInstallPrompt = null;
                    p.prompt();
                    p.userChoice.then(function() { installBtn.style.display = 'none'; });
                });
            }
        }

        // 朗读速度初始化
        initSpeechRate();

        // 版本信息
        updateVersionInfo();
    }

    // ── 朗读速度 ──
    // localStorage('speechRate') 统一使用实际倍率值（"0.5"~"2"），与 speech.js 一致
    function initSpeechRate() {
        var savedRate = 1; // 默认 1.0x
        try { savedRate = parseFloat(localStorage.getItem('speechRate') || '1'); } catch(e) {}
        var slider = document.getElementById('speechRateSlider');
        if (slider) {
            slider.value = Math.round(savedRate * 100);
            updateSpeechRateDisplay(slider.value);
        }
    }

    window.handleSpeechRateChange = function(value) {
        var rate = parseInt(value);
        var actualRate = rate / 100;
        try { localStorage.setItem('speechRate', String(actualRate)); } catch(e) {}
        updateSpeechRateDisplay(rate);
        // 通知 speech.js 更新
        if (window.CXSpeech && window.CXSpeech.setRate) {
            window.CXSpeech.setRate(actualRate);
        }
    };

    function updateSpeechRateDisplay(rate) {
        var display = document.getElementById('speechRateDisplay');
        if (display) display.textContent = (rate / 100).toFixed(1) + 'x';
    }

    // ── 版本信息 ──
    function updateVersionInfo() {
        var el = document.getElementById('versionInfoText');
        if (!el) return;
        var ver = '';
        try {
            ver = localStorage.getItem('cx_apk_version') || localStorage.getItem('cx_pwa_version') || '';
        } catch(e) {}
        if (!ver) {
            try {
                var vEl = document.querySelector('meta[name="app-version"]');
                if (vEl) ver = vEl.getAttribute('content') || '';
            } catch(e) {}
        }
        el.textContent = ver ? ('v' + ver) : '';
    }

    // ── 清除数据对话框 ──
    function showClearDialog(onConfirm) {
        var selected = 'regular';
        var dlg = window.CX.openDialog({
            id: 'cxClearDialogMask',
            html: [
                '<div class="cx-dialog">',
                '  <div class="cx-dialog-title">清除数据</div>',
                '  <div class="cx-dialog-desc">选择要清除的内容</div>',
                '  <div class="cx-dialog-opts">',
                '    <div class="cx-dialog-opt selected" data-val="regular">',
                '      <div class="cx-dialog-opt-icon">🧾</div>',
                '      <div class="cx-dialog-opt-body">',
                '        <div class="cx-dialog-opt-title">常规数据</div>',
                '        <div class="cx-dialog-opt-sub">离线缓存、阅读进度、字体语速设置<br>保留划线笔记</div>',
                '      </div>',
                '    </div>',
                '    <div class="cx-dialog-opt" data-val="notes">',
                '      <div class="cx-dialog-opt-icon">📝</div>',
                '      <div class="cx-dialog-opt-body">',
                '        <div class="cx-dialog-opt-title">划线笔记</div>',
                '        <div class="cx-dialog-opt-sub">仅清除所有划线和高亮<br>保留其他设置</div>',
                '      </div>',
                '    </div>',
                '  </div>',
                '  <div class="cx-dialog-actions">',
                '    <button class="cx-dialog-cancel" data-action="cancel">取消</button>',
                '    <button class="cx-dialog-confirm" data-action="confirm">确定清除</button>',
                '  </div>',
                '</div>'
            ].join('')
        });
        if (!dlg) return;

        dlg.mask.addEventListener('click', function(e) {
            var t = e.target;
            var opt = t.closest ? t.closest('.cx-dialog-opt') : null;
            if (opt && opt.getAttribute('data-val')) {
                selected = opt.getAttribute('data-val');
                var opts = dlg.mask.querySelectorAll('.cx-dialog-opt');
                for (var i = 0; i < opts.length; i++) { opts[i].classList.remove('selected'); }
                opt.classList.add('selected');
                return;
            }
            if (t.getAttribute('data-action') === 'cancel') {
                dlg.close();
                return;
            }
            if (t.getAttribute('data-action') === 'confirm') {
                dlg.close();
                var statusEl = document.getElementById('actionStatus');
                if (statusEl) { statusEl.textContent = '🧹 正在清理中，请稍候...'; statusEl.className = 'cache-status'; }
                if (onConfirm) { onConfirm(selected); return; }
                // 内置实现（非主页）
                if (selected === 'notes') {
                    var doReload = function() {
                        try { localStorage.removeItem('cx_highlights'); } catch(e) {}
                        try { localStorage.removeItem('cx_highlights_bak'); } catch(e) {}
                        try { localStorage.removeItem('cx_highlights_bak_ts'); } catch(e) {}
                        try { localStorage.removeItem('cx_hl_migrated'); } catch(e) {}
                        if (statusEl) { statusEl.textContent = '✓ 划线笔记已清除，即将刷新...'; statusEl.className = 'cache-status success'; }
                        window.location.reload(true);
                    };
                    var clearP = (window.CXHighlight && window.CXHighlight.clearAllHighlightsForce)
                        ? window.CXHighlight.clearAllHighlightsForce()
                        : Promise.resolve();
                    clearP.then(doReload).catch(doReload);
                    return;
                }
                var steps = [];
                if ('serviceWorker' in navigator) {
                    steps.push(navigator.serviceWorker.getRegistrations().then(function(regs) {
                        return Promise.all(regs.map(function(r) { return r.unregister(); }));
                    }).catch(function() {}));
                }
                if ('caches' in window) {
                    steps.push(caches.keys().then(function(keys) {
                        return Promise.all(keys.map(function(k) { return caches.delete(k); }));
                    }).catch(function() {}));
                }
                try {
                    var theme = localStorage.getItem('readingTheme');
                    var fontSize = localStorage.getItem('globalFontSize');
                    var highlights = localStorage.getItem('cx_highlights');
                    var firstUse = localStorage.getItem('cx_first_use');
                    for (var i = localStorage.length - 1; i >= 0; i--) {
                        var k = localStorage.key(i); if (k) localStorage.removeItem(k);
                    }
                    if (theme)      localStorage.setItem('readingTheme', theme);
                    if (fontSize)   localStorage.setItem('globalFontSize', fontSize);
                    if (highlights) localStorage.setItem('cx_highlights', highlights);
                    if (firstUse)   localStorage.setItem('cx_first_use', firstUse);
                } catch(ex) {}
                Promise.all(steps).then(function() {
                    try{window.history.replaceState(null,'',window.location.pathname);}catch(e){}
                    window.location.reload();
                });
            }
        });
    }
    window.CX = window.CX || {};
    window.CX.showClearDialog = showClearDialog;

    function defaultPromptClearData() { showClearDialog(); }

    // ── 使用说明对话框（圣经版）──
    function showGuideDialog() {
        var _guideSec = function(title, items) {
            var rows = items.map(function(it) {
                return '<div style="display:flex;gap:8px;padding:5px 0;align-items:flex-start">' +
                    '<span style="flex-shrink:0;width:20px;text-align:center">' + it[0] + '</span>' +
                    '<div style="flex:1;min-width:0"><span style="font-weight:500;color:var(--heading)">' + it[1] + '</span>' +
                    (it[2] ? '<div style="font-size:12px;color:var(--text-secondary);margin-top:2px;line-height:1.5">' + it[2] + '</div>' : '') +
                    '</div></div>';
            }).join('');
            return '<div style="margin-bottom:14px">' +
                '<div style="font-size:14px;font-weight:600;color:var(--brand);margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid var(--border)">' + title + '</div>' +
                rows + '</div>';
        };

        var html = '<div class="cx-dialog" style="max-width:420px;padding:0;position:relative;max-height:80vh;display:flex;flex-direction:column">' +
            '<div style="padding:14px 16px 10px;font-size:16px;font-weight:600;color:var(--heading);flex-shrink:0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">' +
                '<span>📖 使用说明</span>' +
                '<button id="cxGuideClose" style="width:28px;height:28px;border-radius:50%;border:none;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center" title="关闭">×</button>' +
            '</div>' +
            '<div style="flex:1;overflow-y:auto;padding:12px 16px 16px;line-height:1.6;font-size:13px;color:var(--text)">' +
                _guideSec('🎨 阅读设置', [
                    ['🌓', '主题切换', '灰白 / 浅黄 / 米黄 / 深灰 / 黑夜五种主题，未手动选择时跟随手机深浅色自动切换'],
                    ['🔤', '字体大小', '拖动滑块调节字号，设置自动保存，所有页面生效'],
                    ['🔊', '朗读速度', '支持 0.5x ~ 2x 多档语速，朗读中也可随时切换']
                ]) +
                _guideSec('📚 经文浏览', [
                    ['📖', '书卷导航', '双栏布局：左侧选书卷，右侧选章节，支持旧约/新约切换'],
                    ['📑', '浏览历史', '自动记录最近阅读的章节，方便快速回到上次阅读位置'],
                    ['🔍', '全文搜索', '输入关键词搜索经文和注解，点击结果直接跳转']
                ]) +
                _guideSec('🔊 朗读功能', [
                    ['▶️', '播放控制', '底部控制栏：播放 / 暂停、进度条拖动、时间显示'],
                    ['⏩', '变速朗读', '支持多档语速，朗读中也可随时切换'],
                    ['🔄', '循环播放', '点击循环按钮，反复朗读当前页面'],
                    ['💡', '朗读高亮', '朗读时自动高亮当前句子，跟随进度移动'],
                    ['📖', '经文朗读', '朗读时经文缩写自动读为完整书名'],
                    ['📱', '后台朗读', '支持锁屏和后台朗读，通知栏显示标题和控制按钮']
                ]) +
                _guideSec('📜 经文系统', [
                    ['✝️', '经文弹框', '点击经文引用，弹出窗口显示完整经文'],
                    ['🔗', '串珠经文', '弹框内点击串珠编号，展开相关经文'],
                    ['📌', '注脚查看', '弹框内点击注脚编号，展开对应注解内容'],
                    ['🔍', '自动识别', '正文中的中文经文引用自动识别为可点击链接']
                ]) +
                _guideSec('✏️ 划线笔记', [
                    ['🖍️', '添加划线', '长按选择文字即可添加高亮、颜色标记或下划线'],
                    ['🗑️', '删除标记', '点击已有划线，在弹出菜单中点击「删除」移除'],
                    ['📓', '添加笔记', '点击划线旁的 📝 图标，输入笔记内容'],
                    ['💾', '自动保存', '划线和笔记保存在本机，卸载应用前不会丢失']
                ]) +
                _guideSec('⚙️ 应用', [
                    ['🧭', '底部工具栏', '书卷导航、朗读、设置、目录、更多功能一键直达'],
                    ['↩️', '返回导航', '按返回键逐层回退：内容→目录→主页→退出'],
                    ['📍', '位置记忆', '自动记住每个章节的阅读位置，下次打开自动恢复'],
                    ['🔄', '检查更新', '设置中的「检查更新」可查看是否有新版本'],
                    ['📲', '安装桌面', '添加到手机桌面后像原生应用一样使用，支持离线打开']
                ]) +
            '</div>' +
            '</div>';

        var dlg = window.CX.openDialog({
            id: 'cxGuideDialogMask',
            html: html
        });
        if (!dlg) return;

        var closeBtn = document.getElementById('cxGuideClose');
        if (closeBtn) closeBtn.addEventListener('click', dlg.close);
    }

    // ── 赞助对话框（简化版，不依赖远程图片）──
    function showSponsorDialog() {
        var dlg = window.CX.openDialog({
            id: 'cxSponsorMask',
            html: [
                '<div class="cx-sponsor-box">',
                '  <div class="cx-sponsor-close" id="cxSponsorClose">×</div>',
                '  <div class="cx-sponsor-title">❤️ 顾念微工</div>',
                '  <div class="cx-sponsor-desc">蒙福有余，可助这盏灯不灭 🌟</div>',
                '  <div style="padding:20px;text-align:center;color:var(--text-muted,#999);font-size:14px;line-height:1.8">',
                '    感谢您的支持与关爱<br>愿神赐福与您',
                '  </div>',
                '</div>'
            ].join('')
        });
        if (!dlg) return;

        dlg.mask.addEventListener('click', function(e) {
            if (e.target.id === 'cxSponsorClose') dlg.close();
        });
    }

    // ── 反馈问题对话框 ──
    function showFeedbackDialog() {
        var PUSH_URLS = (window.CX_SERVERS && window.CX_SERVERS.push) || [];
        var MAX_LEN = 500;

        var dlg = window.CX.openDialog({
            id: 'cxFeedbackMask',
            html: [
                '<div class="cx-feedback-box">',
                '  <div class="cx-feedback-header">',
                '    <div class="cx-feedback-title">💬 反馈问题</div>',
                '    <button class="cx-feedback-close" id="cxFeedbackClose">×</button>',
                '  </div>',
                '  <div class="cx-feedback-body">',
                '    <textarea class="cx-feedback-textarea" id="cxFeedbackText" maxlength="' + MAX_LEN + '" placeholder="请描述您遇到的问题或建议…"></textarea>',
                '    <div class="cx-feedback-count" id="cxFeedbackCount">0/' + MAX_LEN + '</div>',
                '    <div class="cx-feedback-tip">⚠️ 请先确认已是最新版本，部分问题在新版中已修复。</div>',
                '    <div class="cx-feedback-status" id="cxFeedbackStatus"></div>',
                '  </div>',
                '  <div class="cx-feedback-actions">',
                '    <button class="cx-feedback-cancel" id="cxFeedbackCancelBtn">取消</button>',
                '    <button class="cx-feedback-submit" id="cxFeedbackSubmitBtn">发送</button>',
                '  </div>',
                '</div>'
            ].join('')
        });
        if (!dlg) return;

        setTimeout(function() {
            var ta = document.getElementById('cxFeedbackText');
            if (ta) ta.focus();
        }, 100);

        var closeBtn = document.getElementById('cxFeedbackClose');
        if (closeBtn) closeBtn.addEventListener('click', dlg.close);

        var cancelBtn = document.getElementById('cxFeedbackCancelBtn');
        if (cancelBtn) cancelBtn.addEventListener('click', dlg.close);

        var textarea = document.getElementById('cxFeedbackText');
        var countEl = document.getElementById('cxFeedbackCount');
        if (textarea && countEl) {
            var _composing = false;
            function updateCount() { countEl.textContent = textarea.value.length + '/' + MAX_LEN; }
            textarea.addEventListener('compositionstart', function() { _composing = true; });
            textarea.addEventListener('compositionend', function() { _composing = false; updateCount(); });
            textarea.addEventListener('input', function() { if (!_composing) updateCount(); });
        }

        var submitBtn = document.getElementById('cxFeedbackSubmitBtn');
        var statusEl = document.getElementById('cxFeedbackStatus');
        if (submitBtn) {
            submitBtn.addEventListener('click', function() {
                var text = textarea ? textarea.value.trim() : '';
                if (!text) {
                    if (statusEl) { statusEl.textContent = '请输入反馈内容'; statusEl.className = 'cx-feedback-status error'; }
                    return;
                }
                submitBtn.disabled = true;
                submitBtn.textContent = '发送中…';
                if (statusEl) { statusEl.textContent = ''; statusEl.className = 'cx-feedback-status'; }

                var ua = navigator.userAgent || '';
                var platform = navigator.platform || '';
                var screenInfo = (screen.width || 0) + 'x' + (screen.height || 0);
                var appVer = '';
                try {
                    var vEl = document.querySelector('meta[name="app-version"]');
                    if (vEl) appVer = vEl.getAttribute('content') || '';
                    if (!appVer) appVer = localStorage.getItem('cx_apk_version') || localStorage.getItem('cx_pwa_version') || '';
                } catch(e) {}

                var runEnv = '浏览器';
                try {
                    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) runEnv = 'APK';
                    else if (window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)) runEnv = 'PWA';
                } catch(e) {}

                var deviceLines = [
                    '环境: ' + runEnv,
                    '平台: ' + platform,
                    '屏幕: ' + screenInfo,
                    appVer ? '版本: ' + appVer : ''
                ].filter(Boolean).join('\n');

                var errorLog = (window.CX && window.CX.errorLog) ? window.CX.errorLog.get() : [];
                var logLines = '';
                if (errorLog.length > 0) {
                    var fmt = errorLog.slice(-12).map(function(e) {
                        var d = new Date(e.t);
                        var ts = (d.getMonth()+1) + '/' + d.getDate() + ' '
                               + String(d.getHours()).padStart(2,'0') + ':'
                               + String(d.getMinutes()).padStart(2,'0') + ':'
                               + String(d.getSeconds()).padStart(2,'0');
                        return '[' + ts + '] ' + (e.s ? e.s + ' ' : '') + e.m;
                    }).join('\n');
                    logLines = '\n\n--- 错误日志 ---\n' + fmt;
                }

                var crashLog = (window.CX && window.CX.nativeCrashLog) ? window.CX.nativeCrashLog.get() : '';
                if (crashLog) {
                    logLines += '\n\n--- 崩溃日志 ---\n' + crashLog.substring(0, 1200);
                }

                var content = text + '\n\n---\n' + deviceLines + logLines;

                function tryPush(idx) {
                    if (idx >= PUSH_URLS.length) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = '发送';
                        if (statusEl) { statusEl.textContent = '发送失败，请稍后重试'; statusEl.className = 'cx-feedback-status error'; }
                        return;
                    }
                    var ctrl = new AbortController();
                    var timer = setTimeout(function() { ctrl.abort(); }, 10000);
                    fetch(PUSH_URLS[idx], {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title: '用户反馈', content: content }),
                        signal: ctrl.signal
                    })
                    .then(function(r) {
                        clearTimeout(timer);
                        if (!r.ok) throw new Error('HTTP ' + r.status);
                        return r.json();
                    })
                    .then(function() {
                        if (window.CX && window.CX.errorLog) window.CX.errorLog.clear();
                        if (window.CX && window.CX.nativeCrashLog) window.CX.nativeCrashLog.clear();
                        if (statusEl) { statusEl.textContent = '✓ 发送成功，感谢您的反馈！'; statusEl.className = 'cx-feedback-status success'; }
                        setTimeout(dlg.close, 1800);
                    })
                    .catch(function() { clearTimeout(timer); tryPush(idx + 1); });
                }
                tryPush(0);
            });
        }
    }

    // ── 面板开关 ──
    function closeThemePanelInternal(panel, overlay) {
        panel.classList.remove('show');
        if (overlay) overlay.classList.remove('show');
        unlockPageScroll();
    }

    window.toggleThemePanel = function() {
        var panel = document.getElementById('themePanel');
        if (!panel) return;
        var overlay = document.getElementById('themePanelOverlay');
        var willShow = !panel.classList.contains('show');
        if (willShow) {
            panel.classList.add('show');
            if (overlay) overlay.classList.add('show');
            lockPageScroll();
            window.CX.backStack.push(function() {
                closeThemePanelInternal(panel, overlay);
            });
        } else {
            closeThemePanelInternal(panel, overlay);
            window.CX.backStack.discard();
        }
    };

    // ── 设置主题 ──
    window.setTheme = function(theme) {
        if (VALID_THEMES.indexOf(theme) === -1) return;
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem('readingTheme', theme); } catch (e) {}
        updateThemeUI(theme);
        syncThemeColor(theme);
    };

    // ── 更新主题 UI 选中状态 ──
    function updateThemeUI(theme) {
        // 旧版 .theme-option 卡片
        document.querySelectorAll('.theme-option').forEach(function(option) {
            option.classList.toggle('active', option.getAttribute('data-theme') === theme);
        });
        // 新版 .theme-swatch-card 色卡
        document.querySelectorAll('.theme-swatch-card').forEach(function(card) {
            var isActive = card.getAttribute('data-theme') === theme;
            card.style.borderColor = isActive ? 'var(--brand, #8B4513)' : 'transparent';
        });
        // bible-renderer 的 .theme-swatch（如果存在）
        document.querySelectorAll('.theme-swatch').forEach(function(swatch) {
            swatch.classList.toggle('active', swatch.getAttribute('data-theme-value') === theme);
        });
    }

    // ── 字体大小 ──
    function applyFontSize(size) {
        document.body.style.fontSize = size + 'px';
        document.documentElement.style.setProperty('--bible-font-size', size + 'px');
        try { localStorage.setItem('globalFontSize', size); } catch(e) {}
    }

    function updateFontSizeUI() {
        var size = fontSizes[currentSizeIndex];
        var display = document.getElementById('fontSizeDisplay');
        if (display) display.textContent = size + 'px';
        var slider = document.getElementById('fontSizeSlider');
        if (slider) slider.value = currentSizeIndex;
    }

    window.handleFontSliderChange = function(value) {
        var index = parseInt(value);
        if (index >= 0 && index < fontSizes.length) {
            currentSizeIndex = index;
            applyFontSize(fontSizes[currentSizeIndex]);
            updateFontSizeUI();
        }
    };

    window.decreaseFontSize = function() {
        if (currentSizeIndex > 0) {
            currentSizeIndex--;
            applyFontSize(fontSizes[currentSizeIndex]);
            updateFontSizeUI();
        }
    };

    window.increaseFontSize = function() {
        if (currentSizeIndex < fontSizes.length - 1) {
            currentSizeIndex++;
            applyFontSize(fontSizes[currentSizeIndex]);
            updateFontSizeUI();
        }
    };

    window.resetFontSize = function() {
        currentSizeIndex = defaultSizeIndex;
        applyFontSize(fontSizes[currentSizeIndex]);
        updateFontSizeUI();
    };

    // ── 开关状态同步 ──
    function syncToggleUI() {
        _toggleKeys.forEach(function(key) {
            var input = document.querySelector('[data-toggle="' + key + '"]');
            if (input) input.checked = _toggleDefaults[key];
        });
    }

    // ── 导出字体控制 ──
    window.CXFontControl = {
        decrease: decreaseFontSize,
        increase: increaseFontSize,
        reset: resetFontSize,
        apply: function() {
            try {
                var saved = localStorage.getItem('globalFontSize');
                if (saved) applyFontSize(saved);
            } catch(e) {}
        }
    };

    // ══════════════════════════════════════════
    //  window.CX 公开 API（供 bible-renderer.js 调用）
    // ══════════════════════════════════════════
    window.CX = window.CX || {};

    /** 切换主题 */
    window.CX.setTheme = function(themeName) {
        window.setTheme(themeName);
    };

    /** 设置字号（0-4 级） */
    window.CX.setFontSize = function(level) {
        var idx = Math.max(0, Math.min(fontSizes.length - 1, parseInt(level) || 0));
        currentSizeIndex = idx;
        applyFontSize(fontSizes[idx]);
        updateFontSizeUI();
    };

    /** 获取开关状态 */
    window.CX.getToggleState = function(key) {
        return key in _toggleDefaults ? _toggleDefaults[key] : true;
    };

    /** 设置开关状态 */
    window.CX.setToggleState = function(key, value) {
        if (key in _toggleDefaults) {
            _toggleDefaults[key] = !!value;
            saveToggleStates();
            // 同步 bible-renderer 的内部状态
            if (window.CXBible && window.CXBible.setToggle) {
                window.CXBible.setToggle(key, !!value);
            }
        }
    };

    /** 获取所有开关状态 */
    window.CX.getAllToggleStates = function() {
        var result = {};
        _toggleKeys.forEach(function(k) { result[k] = _toggleDefaults[k]; });
        return result;
    };

    /** 获取当前主题名 */
    window.CX.getCurrentTheme = function() {
        return document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
    };

    /** 获取可用主题列表 */
    window.CX.getAvailableThemes = function() {
        return VALID_THEMES.slice();
    };

    // DOM 加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initThemeToggle);
    } else {
        initThemeToggle();
    }
})();