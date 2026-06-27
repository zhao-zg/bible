/**
 * 语言包下载管理模块
 * 支持语言包的下载、缓存检测、删除功能
 * 挂载到 window.CXLanguagePack
 */
(function() {
  'use strict';

  var _manifest = null; // 缓存 manifest 数据
  var _manifestTime = 0;
  var MANIFEST_TTL = 5 * 60 * 1000; // 5 分钟

  // ── 工具函数 ──
  function getRoot() {
    return (window.CX_ROOT || './');
  }

  // ── Manifest ──
  function getManifest(forceRefresh) {
    if (_manifest && !forceRefresh && (Date.now() - _manifestTime < MANIFEST_TTL)) {
      return Promise.resolve(_manifest);
    }
    return fetch(getRoot() + 'data/packs/manifest.json', { cache: 'no-cache' })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        _manifest = data;
        _manifestTime = Date.now();
        return data;
      });
  }

  // ── 安装状态（localStorage） ──
  function getInstalled() {
    try {
      return JSON.parse(localStorage.getItem('bible_installed_packs') || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveInstalled(list) {
    try {
      localStorage.setItem('bible_installed_packs', JSON.stringify(list));
    } catch (e) { /* ignore */ }
  }

  function isInstalled(lang) {
    return getInstalled().indexOf(lang) !== -1;
  }

  // ── 缓存检测（异步）──
  function isCached(lang) {
    return caches.open('cx-main').then(function(cache) {
      return cache.match(getRoot() + 'data/bible/' + lang + '/01.json');
    }).then(function(resp) {
      return !!resp;
    }).catch(function() {
      return false;
    });
  }

  // ── 下载 ──
  var _downloading = {};

  function _doDownload(lang, onProgress) {
    // onProgress: function({downloaded, total, percent, speed}) {}
    return getManifest().then(function(manifest) {
      var pack = null;
      for (var i = 0; i < manifest.packs.length; i++) {
        if (manifest.packs[i].lang === lang) {
          pack = manifest.packs[i];
          break;
        }
      }
      if (!pack) throw new Error('Language pack not found: ' + lang);

      var url = getRoot() + 'data/packs/' + pack.file;

      // 使用 streaming fetch 追踪进度
      return fetch(url, { cache: 'no-cache' }).then(function(response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);

        var contentLength = response.headers.get('Content-Length');
        var total = contentLength ? parseInt(contentLength, 10) : pack.size;
        var reader = response.body ? response.body.getReader() : null;

        if (!reader) {
          // body 不可读，降级为整体读取（无进度）
          return response.arrayBuffer();
        }

        var chunks = [];
        var downloaded = 0;
        var startTime = Date.now();
        var lastReportTime = 0;

        function pump() {
          return reader.read().then(function(result) {
            if (result.done) return chunks;

            chunks.push(result.value);
            downloaded += result.value.length;

            if (onProgress) {
              var now = Date.now();
              // 每 200ms 报告一次进度
              if (now - lastReportTime >= 200) {
                var elapsed = (now - startTime) / 1000;
                var speed = elapsed > 0 ? downloaded / elapsed : 0;
                onProgress({
                  downloaded: downloaded,
                  total: total,
                  percent: total ? Math.round(downloaded / total * 100) : 0,
                  speed: speed
                });
                lastReportTime = now;
              }
            }
            return pump();
          });
        }

        return pump().then(function() {
          // 合并 chunks 为完整 ArrayBuffer
          var totalLength = chunks.reduce(function(sum, c) { return sum + c.length; }, 0);
          var result = new Uint8Array(totalLength);
          var offset = 0;
          chunks.forEach(function(chunk) {
            result.set(chunk, offset);
            offset += chunk.length;
          });

          // 确保最后一次进度也报告
          if (onProgress) {
            var elapsed = (Date.now() - startTime) / 1000;
            var speed = elapsed > 0 ? downloaded / elapsed : 0;
            onProgress({
              downloaded: downloaded,
              total: total,
              percent: total ? 100 : 0,
              speed: speed
            });
          }

          return result.buffer;
        });
      });
    }).then(function(arrayBuffer) {
      // 使用 JSZip 解压
      if (typeof JSZip === 'undefined') {
        throw new Error('JSZip not loaded');
      }
      return JSZip.loadAsync(arrayBuffer).then(function(zip) {
        arrayBuffer = null; // 尽早释放 ZIP 二进制
        // 将文件写入 Cache API（cache-injection 策略）
        return caches.open('cx-main').then(function(cache) {
          var fileNames = Object.keys(zip.files);
          // 逐文件处理，避免全量驻留
          return fileNames.reduce(function(chain, name) {
            return chain.then(function() {
              var entry = zip.files[name];
              if (entry.dir) return;
              return entry.async('string').then(function(content) {
                var cacheUrl = getRoot() + 'data/bible/' + lang + '/' + name;
                var blob = new Blob([content], { type: 'application/json' });
                var response = new Response(blob, {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' }
                });
                return cache.put(new Request(cacheUrl), response);
              });
            });
          }, Promise.resolve());
        });
      });
    }).then(function() {
      // 更新已安装列表
      var installed = getInstalled();
      if (installed.indexOf(lang) === -1) {
        installed.push(lang);
        saveInstalled(installed);
      }
    });
  }

  function download(lang, onProgress) {
    if (_downloading[lang]) return _downloading[lang];
    var p = _doDownload(lang, onProgress);
    _downloading[lang] = p.then(function(result) {
      delete _downloading[lang];
      return result;
    }).catch(function(err) {
      delete _downloading[lang];
      throw err;
    });
    return _downloading[lang];
  }

  // ── 删除 ──
  function deletePack(lang) {
    return caches.open('cx-main').then(function(cache) {
      return cache.keys().then(function(requests) {
        var promises = [];
        requests.forEach(function(req) {
          if (req.url.indexOf('/data/bible/' + lang + '/') !== -1) {
            promises.push(cache.delete(req));
          }
        });
        return Promise.all(promises);
      });
    }).then(function() {
      // 更新已安装列表
      var installed = getInstalled();
      var idx = installed.indexOf(lang);
      if (idx !== -1) {
        installed.splice(idx, 1);
        saveInstalled(installed);
      }

      // 通知 bible-renderer 清理内存缓存
      if (window.CXBible && window.CXBible.clearVersionCache) {
        window.CXBible.clearVersionCache(lang);
      }
    }).catch(function(err) {
      console.error('[CXLanguagePack] 删除失败:', err);
      throw err;
    });
  }

  // ── 获取包大小 ──
  function getPackSize(lang) {
    return getManifest().then(function(manifest) {
      for (var i = 0; i < manifest.packs.length; i++) {
        if (manifest.packs[i].lang === lang) return manifest.packs[i].size;
      }
      return 0;
    });
  }

  // ── 初始化所有已安装版本的缓存检查 ──
  function checkAllInstalled() {
    return getManifest().then(function(manifest) {
      var checks = manifest.packs.map(function(pack) {
        return isCached(pack.lang).then(function(cached) {
          return { lang: pack.lang, cached: cached };
        });
      });
      return Promise.all(checks).then(function(results) {
        // 同步 localStorage（确保 Cache API 中的状态和 localStorage 一致）
        var installed = [];
        results.forEach(function(r) {
          if (r.cached) installed.push(r.lang);
        });
        saveInstalled(installed);
        return installed;
      });
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
    checkAllInstalled: checkAllInstalled
  };
})();
