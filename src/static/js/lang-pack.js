/**
 * 语言包管理模块（全内置版本）
 * 所有语言版本数据已直接打包在 data/bible/{lang}/ 目录中，
 * 无需远程下载，即装即用。
 * 挂载到 window.CXLanguagePack
 */
(function() {
  'use strict';

  // ── 工具函数 ──
  function getRoot() {
    return (window.CX_ROOT || './');
  }

  // ── Manifest（从 bible-versions.json 构建）──
  var _manifest = null;

  function getManifest(forceRefresh) {
    if (_manifest && !forceRefresh) {
      return Promise.resolve(_manifest);
    }
    return fetch(getRoot() + 'data/bible-versions.json', { cache: 'no-cache' })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(versions) {
        // 将版本元数据转为 manifest 格式（排除 zh-rcv 主版本）
        var packs = [];
        versions.forEach(function(ver) {
          if (ver.lang === 'zh-rcv') return; // 主版本不算 pack
          packs.push({
            lang: ver.lang,
            label: ver.label,
            bundled: true
          });
        });
        _manifest = { version: 2, packs: packs, bundled: true };
        return _manifest;
      });
  }

  // ── 安装状态：所有版本始终已安装 ──
  function getInstalled() {
    if (!_manifest) return [];
    return _manifest.packs.map(function(p) { return p.lang; });
  }

  function isInstalled(lang) {
    // zh-rcv 是主版本，始终可用
    if (lang === 'zh-rcv') return true;
    return getInstalled().indexOf(lang) !== -1;
  }

  // ── 缓存检测：分片文件已内置，始终返回 true ──
  function isCached(lang) {
    return Promise.resolve(isInstalled(lang));
  }

  // ── 下载：无需下载，直接返回成功 ──
  function download(lang, onProgress) {
    // 数据已内置，模拟进度
    if (onProgress) {
      onProgress({ downloaded: 1, total: 1, percent: 100, speed: 0 });
    }
    return Promise.resolve();
  }

  // ── 删除：内置数据不可删除 ──
  function deletePack(lang) {
    console.warn('[CXLanguagePack] 内置版本不可删除:', lang);
    return Promise.reject(new Error('Bundled packs cannot be deleted'));
  }

  // ── 获取包大小（内置版本返回 0）──
  function getPackSize(lang) {
    return Promise.resolve(0);
  }

  // ── 检查所有已安装版本 ──
  function checkAllInstalled() {
    return getManifest().then(function() {
      return getInstalled();
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

