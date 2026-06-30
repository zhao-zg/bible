/**
 * Service Worker for 圣经阅读器
 * 缓存策略：圣经数据 cache-first，版本文件 network-first，其他 cache-first + network fallback
 */

const CACHE_NAME = 'cx-main';
const SW_VERSION = '__BUILD_TIME__';

const CONFIG = {
  TIMEOUT: 5000,
  CACHEABLE_TYPES: ['basic', 'cors']
};

// 核心预缓存资源（install 阶段缓存）
const PRECACHE_URLS = [
  './',
  './manifest.json',
  './version.json',
  './data/bible-books.json',
  './data/bible-versions.json',
  './data/bible-topics.json',
  './data/bible-intro.json',
  './data/bible-outlines.json'
];

// --------------------------------------------------------------------------
// 1. 生命周期
// --------------------------------------------------------------------------

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.all(PRECACHE_URLS.map(function(url) {
        return fetch(url).then(function(resp) {
          if (resp.ok) return cache.put(url, resp);
        }).catch(function() { /* 预缓存失败不影响安装 */ });
      }));
    }).catch(function() {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      // 清理非当前版本的缓存（版本更新时自动淘汰旧缓存）
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME && k.startsWith('cx-')).map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// --------------------------------------------------------------------------
// 2. URL 规范化 (处理中文路径)
// --------------------------------------------------------------------------

function normalizeUrl(urlStr) {
  try {
    let url = new URL(urlStr);
    let decodedPath = decodeURIComponent(url.pathname);
    
    if (decodedPath.endsWith('/index.html')) {
      decodedPath = decodedPath.slice(0, -10);
    }
    
    // 目录补全斜杠
    if (!decodedPath.split('/').pop().includes('.') && !decodedPath.endsWith('/')) {
      decodedPath += '/';
    }

    return url.origin + decodedPath;
  } catch (e) {
    return urlStr;
  }
}

// --------------------------------------------------------------------------
// 3. 请求拦截
// --------------------------------------------------------------------------

// 始终走网络、不缓存的文件（版本检测、目录更新用）
const NETWORK_ONLY = ['version.json'];

function isNetworkOnly(url) {
  try {
    const path = new URL(url).pathname;
    return NETWORK_ONLY.some(f => path.endsWith('/' + f) || path === '/' + f || path.endsWith(f));
  } catch (e) { return false; }
}

// 圣经分片数据（data/bible/*.json 及 data/bible/{lang}/*.json）：cache-first，数据不变优先缓存
function isBibleData(url) {
  try {
    const path = new URL(url).pathname;
    // 匹配 /data/bible/NN.json 或 /data/bible/{lang-subdir}/NN.json（如 zh-rcv/01.json）
    return /\/data\/bible\/([a-z]{2}-[a-z]+\/)?\d+\.json$/.test(path)
      || path.endsWith('/data/bible-books.json')
      || path.endsWith('/data/bible-versions.json');
  } catch (e) { return false; }
}

// packs 路径已废弃（所有语言版本已内置）

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const request = event.request;
  const normalizedUrl = normalizeUrl(request.url);

  // 版本/目录文件：网络优先，离线时才降级缓存
  if (isNetworkOnly(request.url)) {
    event.respondWith((async () => {
      try {
        return await fetch(request, { cache: 'no-store' });
      } catch (e) {
        const cached = await caches.match(request) || await caches.match(normalizedUrl);
        if (cached) return cached;
        throw e;
      }
    })());
    return;
  }

  // 圣经分片数据：cache-first（圣经数据不变，优先缓存，离线可用）
  if (isBibleData(request.url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request) || await caches.match(normalizedUrl);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response && response.status === 200 && CONFIG.CACHEABLE_TYPES.includes(response.type)) {
          const cache = await caches.open(CACHE_NAME);
          event.waitUntil(cache.put(request, response.clone()).catch(function() {}));
        }
        return response;
      } catch (e) {
        throw e;
      }
    })());
    return;
  }

  // 安装/更新时 cacheAllTrainings 使用 cache:'no-cache' 发起请求，
  // 由页面侧显式调用 cache.put 管理，SW 不再介入，避免双重写缓存竞争。
  if (request.cache === 'no-cache') return;

  const responsePromise = (async () => {
    // 1. 缓存优先 (尝试原始 URL 和规范化 URL)
    const cached = await caches.match(request) || await caches.match(normalizedUrl);
    if (cached) return cached;

    // 2. 缓存未命中 → 从网络取并写缓存
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response && response.status === 200 && CONFIG.CACHEABLE_TYPES.includes(response.type)) {
      const responseClone = response.clone();
      const cache = await caches.open(CACHE_NAME);
      // 用 event.waitUntil 延长 SW 生命周期，确保大文件写完再休眠
      const writePromise = cache.put(request, responseClone)
        .then(() => {
          if (request.url !== normalizedUrl) {
            return cache.put(normalizedUrl, response.clone());
          }
        })
        .catch(() => {/* 写缓存失败不影响正常响应 */});
      event.waitUntil(writePromise);
    }
    return response;
  })();

  event.respondWith(responsePromise.catch(err => {
    if (request.mode === 'navigate') {
      return new Response(getOfflineHTML(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    throw err;
  }));
});

// --------------------------------------------------------------------------
// 4. 工具
// --------------------------------------------------------------------------

function getOfflineHTML() {
  return `<!DOCTYPE html><html lang="zh-CN"><body><div style="text-align:center;margin-top:50px;"><h1>📱 离线状态</h1><p>当前页面尚未缓存</p><button onclick="location.reload()">刷新重试</button></div></body></html>`;
}

self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();

  if (event.data.type === 'CLEAR_ALL_CACHES') {
    event.waitUntil(
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    );
  }

  // 查询当前缓存状态（通过 MessageChannel port 回复）
  if (event.data.type === 'CACHE_INFO') {
    const port = event.ports && event.ports[0];
    if (!port) return;
    event.waitUntil(
      caches.keys().catch(() => []).then(allKeys => {
        const trainingCacheCount = allKeys.filter(k => k.startsWith('cx-') && k !== 'cx-main').length;
        port.postMessage({
          trainingCacheCount: trainingCacheCount,
          ok: allKeys.includes('cx-main')
        });
      }).catch(err => {
        port.postMessage({ ok: false });
      })
    );
  }

  // 仅清除 cx-* 离线缓存，保留用户 localStorage 数据
  if (event.data.type === 'CLEAR_CACHE') {
    const port = event.ports && event.ports[0];
    event.waitUntil(
      caches.keys()
        .then(keys => Promise.all(keys.filter(k => k.startsWith('cx-')).map(k => caches.delete(k))))
        .then(() => { if (port) port.postMessage({ ok: true }); })
        .catch(err => { if (port) port.postMessage({ ok: false, error: err.message }); })
    );
  }

  // 批量缓存所有 66 卷圣经分片数据（默认版本 + 版本元数据）
  if (event.data.type === 'CACHE_ALL_BIBLE') {
    event.waitUntil(
      caches.open(CACHE_NAME).then(function(cache) {
        var urls = [];
        for (var i = 1; i <= 66; i++) {
          urls.push('./data/bible/' + String(i).padStart(2, '0') + '.json');
        }
        urls.push('./data/bible-books.json');
        urls.push('./data/bible-versions.json');
        urls.push('./data/bible-topics.json');
        urls.push('./data/bible-intro.json');
        urls.push('./data/bible-outlines.json');
        urls.push('./data/reading-plans.json');
        return Promise.all(urls.map(function(url) {
          return fetch(url).then(function(resp) {
            if (resp.ok) return cache.put(url, resp);
          }).catch(function() {});
        }));
      }).then(function() {
        var port = event.ports && event.ports[0];
        if (port) port.postMessage({ ok: true });
      }).catch(function(err) {
        var port = event.ports && event.ports[0];
        if (port) port.postMessage({ ok: false, error: err.message });
      })
    );
  }

  // 返回当前缓存的书卷数量和状态
  if (event.data.type === 'CACHE_STATUS') {
    var port = event.ports && event.ports[0];
    if (!port) return;
    event.waitUntil(
      caches.open(CACHE_NAME).then(function(cache) {
        return cache.keys().then(function(requests) {
          var bibleCount = 0;
          var bibleUrls = [];
          requests.forEach(function(req) {
            try {
              var path = new URL(req.url).pathname;
              if (/\/data\/bible\/([a-z]{2}-[a-z]+\/)?\d+\.json$/.test(path)) {
                bibleCount++;
                var parts = path.split('/');
                var fileName = parts[parts.length - 1];
                // 区分默认版本与多语言版本：/data/bible/01.json vs /data/bible/zh-rcv/01.json
                var langDir = (parts.length >= 3 && parts[parts.length - 2] !== 'bible')
                  ? parts[parts.length - 2] + '/' : '';
                bibleUrls.push(langDir + fileName);
              }
            } catch (e) {}
          });
          port.postMessage({
            ok: true,
            cachedBooks: bibleCount,
            totalBooks: 66,
            books: bibleUrls.sort()
          });
        });
      }).catch(function(err) {
        port.postMessage({ ok: false, error: err.message });
      })
    );
  }
});