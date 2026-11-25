/**
 * 语言包管理模块
 * 主版本（zh-rcv 恢复本）数据内置在包内；其余译本按需下载：
 *  - PWA：数据在服务器上，在线切换即用，Service Worker 自动缓存（离线可用），
 *    手动"下载"用于提前预缓存全部 66 卷。
 *  - APK（Capacitor）：仅主版本内置，其余译本切换时从远程节点下载分片，
 *    由 Service Worker cache-first 缓存，下载一次后离线可用。
 * 挂载到 window.CXLanguagePack
 */
(function() {
  'use strict';

  var PRIMARY_LANG = 'zh-rcv';
  var INSTALLED_KEY = 'bible_installed_packs';
  var PACK_CACHE = 'cx-langpack'; // 语言包独立缓存桶（SW matchCached 会遍历所有缓存）
  var TOTAL_BOOKS = 66;
  var DOWNLOAD_CONCURRENCY = 5;

  function getRoot() {
    return (window.CX_ROOT || './');
  }

  function isNativeApp() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform &&
      window.Capacitor.isNativePlatform());
  }

  function hasCaches() {
    return typeof caches !== 'undefined' && caches && typeof caches.open === 'function';
  }

  // ── 已安装列表（localStorage）────────────────────────────
  function getInstalled() {
    try {
      return JSON.parse(localStorage.getItem(INSTALLED_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveInstalled(list) {
    try {
      localStorage.setItem(INSTALLED_KEY, JSON.stringify(list));
    } catch (e) { /* ignore */ }
  }

  function markInstalled(lang) {
    var installed = getInstalled();
    if (installed.indexOf(lang) === -1) {
      installed.push(lang);
      saveInstalled(installed);
    }
  }

  function unmarkInstalled(lang) {
    var installed = getInstalled();
    var idx = installed.indexOf(lang);
    if (idx !== -1) {
      installed.splice(idx, 1);
      saveInstalled(installed);
    }
  }

  // ── Manifest（从 bible-versions.json 构建）─────────────────
  var _manifest = null;
  var _manifestTime = 0;
  var MANIFEST_TTL = 5 * 60 * 1000;

  function getManifest(forceRefresh) {
    if (_manifest && !forceRefresh && (Date.now() - _manifestTime < MANIFEST_TTL)) {
      return Promise.resolve(_manifest);
    }
    return fetch(getRoot() + 'data/bible-versions.json', { cache: 'no-cache' })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(versions) {
        var packs = [];
        versions.forEach(function(ver) {
          if (ver.lang === PRIMARY_LANG) return; // 主版本不算 pack
          packs.push({
            lang: ver.lang,
            label: ver.label,
            bundled: ver.bundled === true, // APK 端构建时标记，PWA 端默认 false
            size: ver.size || 0
          });
        });
        _manifest = { version: 3, packs: packs };
        _manifestTime = Date.now();
        return _manifest;
      });
  }

  function findPack(lang) {
    if (!_manifest) return null;
    for (var i = 0; i < _manifest.packs.length; i++) {
      if (_manifest.packs[i].lang === lang) return _manifest.packs[i];
    }
    return null;
  }

  // ── 安装状态（同步近似：内置标记 + 下载记录）──────────────
  function isInstalled(lang) {
    if (lang === PRIMARY_LANG) return true;
    var pack = findPack(lang);
    if (pack && pack.bundled) return true; // APK 内置
    // manifest 尚未加载时，用已加载的版本元数据判断是否随构建内置
    if (window.CXBible && window.CXBible.getAvailableVersions) {
      var avail = window.CXBible.getAvailableVersions();
      for (var i = 0; i < avail.length; i++) {
        if (avail[i].lang === lang && avail[i].bundled === true) return true;
      }
    }
    return getInstalled().indexOf(lang) !== -1;
  }

  // ── 缓存检测（异步）：66 个分片全部已缓存才算完整 ─────────
  function isCached(lang) {
    if (lang === PRIMARY_LANG) return Promise.resolve(true);
    var pack = findPack(lang);
    if (pack && pack.bundled) return Promise.resolve(true);
    if (!hasCaches()) return Promise.resolve(false);
    return caches.keys().then(function(keys) {
      var probe = [];
      for (var i = 1; i <= TOTAL_BOOKS; i++) {
        var name = String(i).padStart ? String(i).padStart(2, '0') : ('0' + i).slice(-2);
        var suffix = '/data/bible/' + lang + '/' + name + '.json';
        probe.push(suffix);
      }
      return Promise.all(probe.map(function(suffix) {
        return Promise.all(keys.map(function(key) {
          if (key === 'cx-active') return Promise.resolve(null);
          return caches.open(key).then(function(c) {
            return c.match(new URL(suffix, selfLocation()).href);
          }).catch(function() { return null; });
        })).then(function(hits) {
          return hits.some(function(h) { return !!h; }) ? suffix : null;
        });
      }));
    }).then(function(results) {
      var found = results.filter(function(x) { return !!x; }).length;
      return found >= TOTAL_BOOKS;
    }).catch(function() {
      return false;
    });
  }

  function selfLocation() {
    try { return self.location.href; } catch (e) { return window.location.href; }
  }

  // ── 远程数据源（remote-config.js 注入的 Cloudflare 节点）──
  function remoteBases() {
    var servers = (window.CX_SERVERS && window.CX_SERVERS.cloudflare) || [];
    return servers.map(function(s) { return String(s).replace(/\/+$/, ''); });
  }

  // 数据路径（如 data/bible/ko-rcv/01.json）对应的请求 URL 列表：
  //  - 主版本分片（data/bible/NN.json，无语言目录）：仅本地（APK 内置）
  //  - PWA：相对路径（同源即服务器）
  //  - APK 未内置版本 / parsing：远程节点优先（本地无数据，避免无效 404）
  function candidateUrls(dataPath) {
    var isPrimaryShard = /^data\/bible\/\d+\.json$/.test(dataPath);
    var urls = [];
    if (!isNativeApp() || isPrimaryShard) {
      urls.push(getRoot() + dataPath);
    }
    if (isNativeApp() && !isPrimaryShard) {
      remoteBases().forEach(function(base) {
        urls.push(base + '/' + dataPath);
      });
    }
    return urls;
  }

  // ── 单个数据分片获取（供 bible-renderer / parsing-view 切换时按需拉取）──
  // 先查本地缓存（SW cache-first 已覆盖各缓存桶），未命中再按候选 URL 依次拉取
  function fetchShard(dataPath) {
    var localKey = new URL(getRoot() + dataPath, selfLocation()).href;
    var cachedPromise = hasCaches()
      ? caches.match(localKey).catch(function() { return null; })
      : Promise.resolve(null);
    return cachedPromise.then(function(cached) {
      if (cached) return cached;
      var urls = candidateUrls(dataPath);
      if (!urls.length) throw new Error('No source for ' + dataPath);
      var idx = 0;
      function attempt() {
        if (idx >= urls.length) {
          return Promise.reject(new Error('All sources failed: ' + dataPath));
        }
        var url = urls[idx++];
        return fetch(url).then(function(r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r;
        }).catch(function(err) {
          if (idx < urls.length) return attempt();
          throw err;
        }).then(function(r) {
          // 命中远程时以本地路径为键写入语言包缓存（供离线使用；SW 也会缓存一份）
          if (!hasCaches()) return r;
          var body = r.clone();
          return caches.open(PACK_CACHE).then(function(cache) {
            return cache.put(localKey, body).catch(function() {});
          }).then(function() { return r; });
        });
      }
      return attempt();
    });
  }

  // ── 下载整个语言包（66 卷，支持断点续传：已缓存分片跳过）──
  var _downloading = {};

  function shardNames() {
    var names = [];
    for (var i = 1; i <= TOTAL_BOOKS; i++) {
      names.push(String(i).padStart ? String(i).padStart(2, '0') : ('0' + i).slice(-2));
    }
    return names;
  }

  function download(lang, onProgress) {
    if (_downloading[lang]) return _downloading[lang];
    var task = _doDownload(lang, onProgress);
    _downloading[lang] = task.then(function(result) {
      delete _downloading[lang];
      return result;
    }).catch(function(err) {
      delete _downloading[lang];
      throw err;
    });
    return _downloading[lang];
  }

  function _doDownload(lang, onProgress) {
    if (!hasCaches()) return Promise.reject(new Error('Cache API unavailable'));
    return getManifest().then(function() {
      var pack = findPack(lang);
      if (pack && pack.bundled) return { ok: true, skipped: true }; // 内置无需下载
      var names = shardNames();
      var paths = names.map(function(n) { return 'data/bible/' + lang + '/' + n + '.json'; });
      var cachePromise = caches.open(PACK_CACHE);
      var base = selfLocation();

      // 先探测已缓存分片（断点续传）
      return cachePromise.then(function(cache) {
        return Promise.all(paths.map(function(p) {
          return cache.match(new URL(p, base).href).then(function(hit) { return hit ? p : null; });
        })).then(function(cached) {
          var pending = paths.filter(function(p) { return cached.indexOf(p) === -1; });
          var done = paths.length - pending.length;
          var failed = 0;

          function report() {
            if (onProgress) {
              onProgress({
                downloaded: done,
                total: paths.length,
                percent: Math.round(done / paths.length * 100),
                speed: 0
              });
            }
          }
          report();

          // 并发下载队列
          var queue = pending.slice();
          function worker() {
            var path = queue.shift();
            if (!path) return Promise.resolve();
            return attemptShard(path, cachePromise, base, 0).then(function() {
              done++;
              report();
              return worker();
            }).catch(function() {
              failed++;
              done++;
              report();
              return worker();
            });
          }
          var workers = [];
          for (var w = 0; w < DOWNLOAD_CONCURRENCY; w++) workers.push(worker());
          return Promise.all(workers).then(function() {
            if (failed > 0) {
              throw new Error('Download incomplete: ' + failed + ' shards failed');
            }
            markInstalled(lang);
            return { ok: true, total: paths.length };
          });
        });
      });
    });
  }

  function attemptShard(path, cachePromise, base, tryIdx) {
    var urls = candidateUrls(path);
    if (tryIdx >= urls.length) return Promise.reject(new Error('shard failed: ' + path));
    return fetch(urls[tryIdx]).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return cachePromise.then(function(cache) {
        // 保存到固定键（远程或本地来源统一以本地路径为键，运行时按路径命中）
        return cache.put(new URL(getRoot() + path, base).href, r.clone());
      });
    }).catch(function() {
      return attemptShard(path, cachePromise, base, tryIdx + 1);
    });
  }

  // ── 删除 ────────────────────────────────────────────────
  function deletePack(lang) {
    var pack = findPack(lang);
    if (pack && pack.bundled) {
      return Promise.reject(new Error('Bundled packs cannot be deleted'));
    }
    if (!hasCaches()) return Promise.reject(new Error('Cache API unavailable'));
    var marker = '/data/bible/' + lang + '/';
    return caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        if (key === 'cx-active') return Promise.resolve();
        return caches.open(key).then(function(cache) {
          return cache.keys().then(function(requests) {
            var doomed = requests.filter(function(req) {
              try { return new URL(req.url).pathname.indexOf(marker) !== -1; }
              catch (e) { return false; }
            });
            return Promise.all(doomed.map(function(req) { return cache.delete(req); }));
          });
        });
      }));
    }).then(function() {
      unmarkInstalled(lang);
      // 通知 bible-renderer 清理内存缓存
      if (window.CXBible && window.CXBible.clearVersionCache) {
        window.CXBible.clearVersionCache(lang);
      }
    });
  }

  // ── 包大小（MB，来自构建元数据）──────────────────────────
  function getPackSize(lang) {
    return getManifest().then(function() {
      var pack = findPack(lang);
      return pack ? pack.size : 0;
    });
  }

  function checkAllInstalled() {
    return getManifest().then(function(manifest) {
      var checks = manifest.packs.map(function(pack) {
        if (pack.bundled) return Promise.resolve({ lang: pack.lang, cached: true });
        // 已标记安装的做一次缓存核验
        if (getInstalled().indexOf(pack.lang) !== -1) {
          return isCached(pack.lang).then(function(cached) {
            if (!cached) unmarkInstalled(pack.lang);
            return { lang: pack.lang, cached: cached };
          });
        }
        return Promise.resolve({ lang: pack.lang, cached: false });
      });
      return Promise.all(checks);
    });
  }

  // ── 公开 API ──
  window.CXLanguagePack = {
    getManifest: getManifest,
    isInstalled: isInstalled,
    getInstalled: getInstalled,
    isCached: isCached,
    download: download,
    delete: deletePack,
    getPackSize: getPackSize,
    checkAllInstalled: checkAllInstalled,
    fetchShard: fetchShard
  };
})();
