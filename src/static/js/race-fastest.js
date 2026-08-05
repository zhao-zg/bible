/**
 * 并发竞速工具：多个 URL 同时发起请求，首个成功者获胜。
 * 内置全局最快镜像记忆：同组服务器首次竞速后缓存最优结果，
 * 后续请求优先走记忆线路，减少冗余竞速。
 *
 * 用法：
 *   CX.raceFastest(urls, {
 *     fetchOptions: { cache: 'no-cache' },
 *     timeout: 10000,
 *     logPrefix: '[下载]',
 *     group: 'cf',            // 可选：镜像组标识，同组共享记忆
 *     validate: function(r) { return r.ok; },
 *     transform: function(r, idx, url) { return r.json(); }
 *   }).then(function(result) {
 *     // result = { value, idx, url }
 *   }).catch(function(err) {
 *     // 所有 URL 均失败
 *   });
 *
 * 全局记忆：
 *   CX.getFastestMirror(group)  → 返回记忆的最快 URL 或 null
 *   CX.clearMirrorCache(group?) → 清除指定组或全部记忆
 *   CX.MIRROR_TTL                → 记忆有效期（默认 5 分钟）
 */
(function () {
    'use strict';

    // ── 全局最快镜像记忆 ──────────────────────────────────
    var _mirrorCache = {};   // { group: { url, idx, ts } }
    var MIRROR_TTL = 5 * 60 * 1000;  // 记忆有效期 5 分钟

    function getFastestMirror(group) {
        if (!group) return null;
        var entry = _mirrorCache[group];
        if (!entry) return null;
        if (Date.now() - entry.ts > MIRROR_TTL) {
            delete _mirrorCache[group];
            return null;
        }
        return entry.url;
    }

    function setFastestMirror(group, url, idx) {
        if (!group || !url) return;
        _mirrorCache[group] = { url: url, idx: idx, ts: Date.now() };
    }

    function clearMirrorCache(group) {
        if (group) {
            delete _mirrorCache[group];
        } else {
            _mirrorCache = {};
        }
    }

    function raceFastest(urls, options) {
        options = options || {};
        if (!urls || !urls.length) return Promise.reject(new Error('raceFastest: urls 为空'));

        var fetchOptions = options.fetchOptions || { cache: 'no-cache' };
        var timeout = options.timeout || 10000;
        var transform = options.transform || function (r) { return r; };
        var validate = options.validate || function (r) { return r && r.ok !== false; };
        var logPrefix = options.logPrefix || '[raceFastest]';
        var group = options.group || '';

        // 单一 URL 走简化路径
        if (urls.length === 1) {
            var singleUrl = urls[0];
            console.log(logPrefix, '请求:', singleUrl);
            return fetch(singleUrl, fetchOptions)
                .then(function (r) {
                    if (!validate(r)) throw new Error('HTTP ' + (r && r.status));
                    return Promise.resolve(transform(r, 0, singleUrl))
                        .then(function (value) {
                            if (group) setFastestMirror(group, singleUrl, 0);
                            return { value: value, idx: 0, url: singleUrl };
                        });
                });
        }

        // ── 记忆优先：如果该组已有有效记忆，优先尝试记忆线路 ──
        var cached = group ? getFastestMirror(group) : null;
        if (cached) {
            // 找到记忆 URL 在列表中的位置
            var cachedIdx = -1;
            for (var ci = 0; ci < urls.length; ci++) {
                if (urls[ci] === cached) { cachedIdx = ci; break; }
            }

            if (cachedIdx >= 0) {
                console.log(logPrefix, '记忆命中: #' + cachedIdx, cached);
                // 优先走记忆线路，同时后台并发竞速验证
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
                        // 记忆线路失败，清除记忆，返回标记让外层走完整竞速
                        clearMirrorCache(group);
                        return null;
                    });

                return Promise.race([
                    cachedFetch,
                    new Promise(function (r) { setTimeout(function () { r(null); }, timeout); })
                ]).then(function (result) {
                    if (result && result.fromCache) {
                        // 记忆线路成功，刷新记忆时间
                        setFastestMirror(group, cachedUrl, cachedIdx);
                        console.log(logPrefix, '记忆线路成功，跳过竞速');
                        return result;
                    }
                    // 记忆线路失败或超时，走完整竞速
                    return doRace(urls, fetchOptions, timeout, transform, validate, logPrefix, group);
                });
            }
        }

        return doRace(urls, fetchOptions, timeout, transform, validate, logPrefix, group);
    }

    // ── 核心竞速逻辑（抽取为独立函数）────────────────────────
    function doRace(urls, fetchOptions, timeout, transform, validate, logPrefix, group) {
        console.log(logPrefix, '并发竞速 ' + urls.length + ' 个源');

        return new Promise(function (resolve, reject) {
            var settled = false;
            var finished = 0;
            var total = urls.length;
            var errors = [];

            var controllers = [];

            // 总超时
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
                // 缓存最快镜像
                if (group) setFastestMirror(group, url, idx);
                // 取消其余请求
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
                    // 复制避免污染原对象
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
    window.CX.getFastestMirror = getFastestMirror;
    window.CX.clearMirrorCache = clearMirrorCache;
    window.CX.MIRROR_TTL = MIRROR_TTL;
})();
