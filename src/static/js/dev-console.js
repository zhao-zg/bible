/**
 * 开发者调试控制台
 * 脚本加载时立刻开始无条件缓冲所有 console 输出（最多 500 条）。
 * 通过 window.CXDevConsole.init() 创建可视面板（展示历史缓冲）。
 * 通过 window.CXDevConsole.destroy() 仅移除面板，缓冲继续运行。
 * 由 theme-toggle.js 在"开发者模式"开关变更时驱动。
 */
(function() {
    'use strict';

    var _origConsole = {
        log:   console.log.bind(console),
        warn:  console.warn.bind(console),
        error: console.error.bind(console),
        info:  console.info.bind(console),
        debug: console.debug.bind(console)
    };
    var _devLogBuf = [];

    // ── 立即安装拦截，无论面板是否开启 ──────────────────────────────────
    function _hook(level) {
        return function() {
            _origConsole[level].apply(console, arguments);
            var msg = Array.prototype.slice.call(arguments).map(function(a) {
                if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack : '');
                try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch(ex) { return String(a); }
            }).join(' ');
            var entry = { t: Date.now(), level: level, text: msg };
            _devLogBuf.push(entry);
            if (_devLogBuf.length > 500) _devLogBuf.shift();
            // 若面板已打开，实时追加
            var body = document.getElementById('cx-dev-console-body');
            if (body) {
                body.appendChild(_buildLogRow(entry));
                while (body.childNodes.length > 500) body.removeChild(body.firstChild);
                var el = document.getElementById('cx-dev-console');
                if (el && el.classList.contains('expanded')) body.scrollTop = body.scrollHeight;
            }
        };
    }
    console.log   = _hook('log');
    console.warn  = _hook('warn');
    console.error = _hook('error');
    console.info  = _hook('info');
    console.debug = _hook('debug');

    // ── 未捕获异常（浏览器 DevTools 红色报错）──────────────────────────
    window.addEventListener('error', function(e) {
        var src = e.filename ? (e.filename.replace(/^.*\//, '') + ':' + e.lineno + ':' + e.colno + ' ') : '';
        var msg = src + (e.message || String(e));
        if (e.error && e.error.stack) msg += '\n' + e.error.stack;
        _origConsole.error('[uncaught]', msg);
        var entry = { t: Date.now(), level: 'error', text: '[uncaught] ' + msg };
        _devLogBuf.push(entry);
        if (_devLogBuf.length > 500) _devLogBuf.shift();
        var body = document.getElementById('cx-dev-console-body');
        if (body) {
            body.appendChild(_buildLogRow(entry));
            while (body.childNodes.length > 500) body.removeChild(body.firstChild);
            var el = document.getElementById('cx-dev-console');
            if (el && el.classList.contains('expanded')) body.scrollTop = body.scrollHeight;
        }
    });

    // ── 未处理的 Promise rejection ───────────────────────────────────────
    window.addEventListener('unhandledrejection', function(e) {
        var reason = e.reason;
        var msg = reason instanceof Error
            ? reason.message + (reason.stack ? '\n' + reason.stack : '')
            : String(reason);
        _origConsole.error('[unhandledrejection]', msg);
        var entry = { t: Date.now(), level: 'error', text: '[unhandledrejection] ' + msg };
        _devLogBuf.push(entry);
        if (_devLogBuf.length > 500) _devLogBuf.shift();
        var body = document.getElementById('cx-dev-console-body');
        if (body) {
            body.appendChild(_buildLogRow(entry));
            while (body.childNodes.length > 500) body.removeChild(body.firstChild);
            var el = document.getElementById('cx-dev-console');
            if (el && el.classList.contains('expanded')) body.scrollTop = body.scrollHeight;
        }
    });

    function _buildLogRow(entry) {
        var d  = new Date(entry.t);
        var hh = String(d.getHours()).padStart(2, '0');
        var mm = String(d.getMinutes()).padStart(2, '0');
        var ss = String(d.getSeconds()).padStart(2, '0');
        var row = document.createElement('div');
        row.className = 'cx-dev-log' + (entry.level === 'log' ? '' : ' ' + entry.level);
        row.textContent = hh + ':' + mm + ':' + ss + ' ' + entry.text;
        return row;
    }

    // ── 浮动按钮位置持久化 ─────────────────────────────────────────
    var _fabPos = { x: -1, y: -1 };
    try {
        var saved = localStorage.getItem('cx_dev_fab_pos');
        if (saved) { var p = JSON.parse(saved); if (typeof p.x === 'number') _fabPos = p; }
    } catch(ex) {}

    function _saveFabPos() {
        try { localStorage.setItem('cx_dev_fab_pos', JSON.stringify(_fabPos)); } catch(ex) {}
    }

    // ── 创建浮动按钮 ───────────────────────────────────────────────
    function _createFab() {
        var fab = document.getElementById('cx-dev-fab');
        if (fab) return fab;
        fab = document.createElement('div');
        fab.id = 'cx-dev-fab';
        fab.textContent = 'DEV';
        // 恢复上次位置或默认右下角
        if (_fabPos.x < 0) {
            _fabPos.x = window.innerWidth - 52;
            _fabPos.y = window.innerHeight - 120;
        }
        fab.style.left = Math.min(_fabPos.x, window.innerWidth - 44) + 'px';
        fab.style.top  = Math.min(_fabPos.y, window.innerHeight - 36) + 'px';
        document.body.appendChild(fab);

        // 拖动 (touch + mouse)
        var dragging = false, moved = false, sx, sy, ox, oy;
        function onStart(e) {
            dragging = true; moved = false;
            var t = e.touches ? e.touches[0] : e;
            sx = t.clientX; sy = t.clientY;
            ox = fab.offsetLeft; oy = fab.offsetTop;
            if (e.cancelable) e.preventDefault();
        }
        function onMove(e) {
            if (!dragging) return;
            var t = e.touches ? e.touches[0] : e;
            var dx = t.clientX - sx, dy = t.clientY - sy;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
            var nx = Math.max(0, Math.min(window.innerWidth - 44, ox + dx));
            var ny = Math.max(0, Math.min(window.innerHeight - 36, oy + dy));
            fab.style.left = nx + 'px';
            fab.style.top  = ny + 'px';
            _fabPos.x = nx; _fabPos.y = ny;
        }
        function onEnd() {
            if (!dragging) return;
            dragging = false;
            if (moved) _saveFabPos();
        }
        fab.addEventListener('touchstart', onStart, { passive: false });
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd);
        fab.addEventListener('mousedown', onStart);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);

        // 点击（非拖动）展开面板
        fab.addEventListener('click', function() {
            if (moved) return;
            _showPanel();
        });
        return fab;
    }

    function _removeFab() {
        var fab = document.getElementById('cx-dev-fab');
        if (fab && fab.parentNode) fab.parentNode.removeChild(fab);
    }

    function _showPanel() {
        var el = document.getElementById('cx-dev-console');
        if (!el) return;
        _removeFab();
        el.classList.remove('collapsed');
        el.classList.add('expanded');
        var title = document.getElementById('cx-dev-console-title');
        if (title) title.textContent = 'DEV ▼';
        var body = document.getElementById('cx-dev-console-body');
        if (body) body.scrollTop = body.scrollHeight;
    }

    function _collapsePanel() {
        var el = document.getElementById('cx-dev-console');
        if (!el) return;
        el.classList.remove('expanded');
        el.classList.add('collapsed');
        var title = document.getElementById('cx-dev-console-title');
        if (title) title.textContent = 'DEV ▲';
        _createFab();
    }

    function init() {
        if (document.getElementById('cx-dev-console')) return;
        var el = document.createElement('div');
        el.id = 'cx-dev-console';
        el.className = 'collapsed';
        el.innerHTML = [
            '<div id="cx-dev-console-bar">',
            '  <span id="cx-dev-console-title">DEV ▲</span>',
            '  <div id="cx-dev-console-actions">',
            '    <button class="cx-dev-btn" id="cx-dev-clear">清除</button>',
            '    <button class="cx-dev-btn" id="cx-dev-copy">复制</button>',
            '    <button class="cx-dev-btn" id="cx-dev-close">✕</button>',
            '  </div>',
            '</div>',
            '<div id="cx-dev-console-body"></div>'
        ].join('');
        document.body.appendChild(el);

        var bar   = document.getElementById('cx-dev-console-bar');
        var body  = document.getElementById('cx-dev-console-body');

        // 将历史缓冲全部渲染到面板
        if (_devLogBuf.length) {
            var frag = document.createDocumentFragment();
            for (var bi = 0; bi < _devLogBuf.length; bi++) frag.appendChild(_buildLogRow(_devLogBuf[bi]));
            body.appendChild(frag);
        }

        // bar 点击切换收起 / 展开
        bar.addEventListener('click', function(e) {
            if (e.target.classList.contains('cx-dev-btn')) return;
            if (el.classList.contains('collapsed')) {
                _showPanel();
            } else {
                _collapsePanel();
            }
        });

        // 清除
        document.getElementById('cx-dev-clear').addEventListener('click', function(e) {
            e.stopPropagation();
            body.innerHTML = '';
            _devLogBuf = [];
        });

        // 复制
        document.getElementById('cx-dev-copy').addEventListener('click', function(e) {
            e.stopPropagation();
            var txt = _devLogBuf.map(function(r) { return '[' + r.level + '] ' + r.text; }).join('\n');
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(txt).catch(function() {});
            } else {
                var ta = document.createElement('textarea');
                ta.value = txt;
                ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch(ex) {}
                document.body.removeChild(ta);
            }
        });

        // 关闭按钮：仅隐藏面板，不停止拦截
        document.getElementById('cx-dev-close').addEventListener('click', function(e) {
            e.stopPropagation();
            try { localStorage.setItem('cx_dev_mode', '0'); } catch(ex) {}
            var tog = document.getElementById('devModeToggle');
            if (tog) tog.checked = false;
            destroy();
        });

        // 初始状态：折叠时显示浮动按钮
        _createFab();
    }

    // 仅移除 DOM，console 拦截和缓冲继续运行
    function destroy() {
        _removeFab();
        var el = document.getElementById('cx-dev-console');
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    window.CXDevConsole = { init: init, destroy: destroy };
})();

