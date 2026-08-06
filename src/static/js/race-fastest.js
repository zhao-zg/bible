/**
 * 并发竞速工具：多个 URL 同时发起请求，首个成功者获胜。
 * 内置两级镜像记忆：
 *   - 持久缓存（localStorage）：跨会话有效，适合 version.json 等小文件竞速
 *   - 会话缓存（内存）：网络变化时失效，适合下载测速
 *
 * 用法：
 *   CX.raceFastest(urls, {
 *     fetchOptions: { cache: 'no-cache' },
 *     timeout: 10000,
 *     logPrefix: '[下载]',
 *     group: 'cf',            // 镜像组标识，同组共享记忆
 *     persist: true,           // true → localStorage 持久缓存
 *     validate: function(r) { return r.ok; },
 *     transform: function(r, idx, url) { return r.json(); }
 *   }).then(function(result) {
 *     // result = { value, idx, url }
 *   });
 *
 * API：
 *   CX.getFastestMirror(group)    → 返回记忆的最快 URL 或 null
 *   CX.clearMirrorCache(group?)   → 清除指定组或全部记忆
 *   CX.invalidateSessionCache()   → 网络变化时调用，清除所有会话缓存
 */
(function () {
    'use strict';

    // ── 缓存存储 ──────────────────────────────────────────
    var LS_KEY = 'cx_mirror_cache';       // localStorage key
    var _sessionCache = {};               // 会话级缓存 { group: { url, idx, ts } }
    var _persistCache = null;             // 持久缓存懒加载
    var _netType = null;                  // 初始网络类型

    // 懒加载持久缓存
    function _loadPersist() {
        if (_persistCache !== null) return _persistCache;
        try {
            var raw = localStorage.getItem(LS_KEY);
            _persistCache = raw ? JSON.parse(raw) : {};
        } catch (e) {
            _persistCache = {};
        }
        return _persistCache;
    }

    function _savePersist() {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(_loadPersist()));
        } catch (e) { /* quota exceeded */ }
    }

    // 获取当前网络类型（用于判断网络变化）
    function _getNetType() {
        var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        return conn ? (conn.type || conn.effectiveType || '') : '';
    }

    // 检查网络是否变化，变化则清除会话缓存
    function _checkNetChange() {
        var cur = _getNetType();
        if (_netType === null) { _netType = cur; return; }
        if (cur && _netType && cur !== _netType) {
            console.log('[raceFastest] 网络变化:', _netType, '→', cur, '，清除会话缓存');
            _sessionCache = {};
            _netType = cur;
        }
    }

    // ── 缓存读写 ──────────────────────────────────────────

    function getFastestMirror(group, persist) {
        if (!group) return null;
        _checkNetChange();

        // 优先会话缓存
        var entry = _sessionCache[group];
        if (entry) return entry.url;

        // 持久缓存
        if (persist) {
            var pc = _loadPersist();
            var pe = pc[group];
            if (pe && pe.url) {
                // 命中持久缓存，回填到会话缓存
                _sessionCache[group] = { url: pe.url, idx: pe.idx, ts: Date.now() };
                return pe.url;
            }
        }
        return null;
    }

    function setFastestMirror(group, url, idx, persist) {
        if (!group || !url) return;
        var entry = { url: url, idx: idx, ts: Date.now() };
        _sessionCache[group] = entry;

        if (persist) {
            var pc = _loadPersist();
            pc[group] = { url: url, idx: idx };
            _savePersist();
        }
    }

    function clearMirrorCache(group) {
        if (group) {
            delete _sessionCache[group];
            var pc = _loadPersist();
            delete pc[group];
            _savePersist();
        } else {
            _sessionCache = {};
            _persistCache = {};
            try { localStorage.removeItem(LS_KEY); } catch (e) {}
        }
    }

    function invalidateSessionCache() {
        _sessionCache = {};
    }

    // 监听网络变化
    if (typeof navigator !== 'undefined') {
        var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (conn && conn.addEventListener) {
            conn.addEventListener('change', function () {
                _checkNetChange();
            });
        }
    }

    // ── 核心竞速逻辑 ──────────────────────────────────────

    function raceFastest(urls, options) {
        options = options || {};
        if (!urls || !urls.length) return Promise.reject(new Error('raceFastest: urls 为空'));

        var fetchOptions = options.fetchOptions || { cache: 'no-cache' };
        var timeout = options.timeout || 10000;
        var transform = options.transform || function (r) { return r; };
        var validate = options.validate || function (r) { return r && r.ok !== false; };
        var logPrefix = options.logPrefix || '[raceFastest]';
        var group = options.group || '';
        var persist = !!options.persist;  // true → 持久化到 localStorage

        // 单一 URL 走简化路径
        if (urls.length === 1) {
            var singleUrl = urls[0];
            console.log(logPrefix, '请求:', singleUrl);
            return fetch(singleUrl, fetchOptions)
                .then(function (r) {
                    if (!validate(r)) throw new Error('HTTP ' + (r && r.status));
                    return Promise.resolve(transform(r, 0, singleUrl))
                        .then(function (value) {
                            if (group) setFastestMirror(group, singleUrl, 0, persist);
                            return { value: value, idx: 0, url: singleUrl };
                        });
                });
        }

        // ── 记忆优先 ──
        var cached = group ? getFastestMirror(group, persist) : null;
        if (cached) {
            var cachedIdx = -1;
            for (var ci = 0; ci < urls.length; ci++) {
                if (urls[ci] === cached) { cachedIdx = ci; break; }
            }

            if (cachedIdx >= 0) {
                console.log(logPrefix, '记忆命中: #' + cachedIdx, cached);
                var cachedUrl = cached;
                var cachedFetch = fetch(cachedUrl, fetchOptions)
                    .then(function (r) {
                        if (!validate(r)) throw new Error('HTTP ' + (r && r.status));
                        return Promise.resolve(transform(r, cachedIdx, cachedUrl));
                    })
                    .then(function (value) {
                        return { value: value, idx: cachedIdx, url: cachedUrl, fromCache: true };
                    })
                    .catch(function () {
                        // 记忆线路失败，清除
                        delete _sessionCache[group];
                        if (persist) {
                            var pc = _loadPersist();
                            delete pc[group];
                            _savePersist();
                        }
                        return null;
                    });

                return Promise.race([
                    cachedFetch,
                    new Promise(function (r) { setTimeout(function () { r(null); }, timeout); })
                ]).then(function (result) {
                    if (result && result.fromCache) {
                        setFastestMirror(group, cachedUrl, cachedIdx, persist);
                        console.log(logPrefix, '记忆线路成功，跳过竞速');
                        return result;
                    }
                    return doRace(urls, fetchOptions, timeout, transform, validate, logPrefix, group, persist);
                });
            }
        }

        return doRace(urls, fetchOptions, timeout, transform, validate, logPrefix, group, persist);
    }

    function doRace(urls, fetchOptions, timeout, transform, validate, logPrefix, group, persist) {
        console.log(logPrefix, '并发竞速 ' + urls.length + ' 个源');

        return new Promise(function (resolve, reject) {
            var settled = false;
            var finished = 0;
            var total = urls.length;
            var errors = [];
            var controllers = [];

            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                for (var i = 0; i < controllers.length; i++) {
                    try { controllers[i] && controllers[i].abort(); } catch (e) {}
                }
                reject(new Error(logPrefix + ' 总超时 (' + timeout + 'ms)，已完成 ' + finished + '/' + total));
            }, timeout);

            function onSuccess(value, idx, url) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                console.log(logPrefix, '首个成功: #' + idx, url, '(' + (Date.now() - startTime) + 'ms)');
                if (group) setFastestMirror(group, url, idx, persist);
                for (var i = 0; i < controllers.length; i++) {
                    if (i === idx) continue;
                    try { controllers[i] && controllers[i].abort(); } catch (e) {}
                }
                resolve({ value: value, idx: idx, url: url });
            }

            function onFail(err, idx) {
                finished++;
                errors.push({ idx: idx, err: err });
                if (settled) return;
                if (finished >= total) {
                    settled = true;
                    clearTimeout(timer);
                    var msg = errors.map(function (e) { return '#' + e.idx + ': ' + (e.err && e.err.message || e.err); }).join('; ');
                    reject(new Error(logPrefix + ' 所有源均失败 - ' + msg));
                }
            }

            var startTime = Date.now();

            urls.forEach(function (url, idx) {
                var controller = (typeof AbortController === 'function') ? new AbortController() : null;
                if (controller) controllers[idx] = controller;

                var opts = fetchOptions;
                if (controller) {
                    opts = {};
                    for (var k in fetchOptions) opts[k] = fetchOptions[k];
                    opts.signal = controller.signal;
                }

                fetch(url, opts)
                    .then(function (r) {
                        if (settled) return;
                        if (!validate(r)) throw new Error('HTTP ' + (r && r.status));
                        return Promise.resolve(transform(r, idx, url));
                    })
                    .then(function (value) {
                        if (settled) return;
                        onSuccess(value, idx, url);
                    })
                    .catch(function (err) {
                        if (settled && err && err.name === 'AbortError') return;
                        onFail(err, idx);
                    });
            });
        });
    }

    // 暴露
    window.CX = window.CX || {};
    window.CX.raceFastest = raceFastest;
    window.CX.getFastestMirror = function (group) { return getFastestMirror(group, true); };
    window.CX.clearMirrorCache = clearMirrorCache;
    window.CX.invalidateSessionCache = invalidateSessionCache;
})();
