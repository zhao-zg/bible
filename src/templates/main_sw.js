/**
 * Service Worker for 圣经阅读器
 * App 版本: {{APP_VERSION}}
 * 缓存策略：圣经数据 cache-first，版本文件 network-first，其他 cache-first + network fallback
 */

// 静态资源缓存：固定名 cx-main（不带版本号）
// 数据缓存桶由页面 pwaCache 管理（cx-data-{version} 切换桶方案），SW 不参与其生命周期
// SW activate 零清理：不删除任何缓存（含旧版数据桶），只做 clients.claim() 接管页面
// SW 字节变化检测由注释中的 App 版本号驱动（升级时 sw.js 内容变化触发更新）
const CACHE_NAME = 'cx-main';
const DATA_CACHE_PREFIX = 'cx-data-';

const CONFIG = {
  TIMEOUT: 5000,
  CACHEABLE_TYPES: ['basic', 'cors']
};

// --------------------------------------------------------------------------
// 1. 生命周期
// --------------------------------------------------------------------------

self.addEventListener('install', event => {
  // 无需预缓存；缓存由安装对话框管理
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // 零清理：不删除任何缓存（含旧版 cx-main-*），仅接管页面
  event.waitUntil(self.clients.claim());
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

// 始终走网络、不缓存的文件（版本检测、目录更新用、赞助二维码）
const NETWORK_ONLY = ['version.json'];

function isNetworkOnly(url) {
  try {
    const path = new URL(url).pathname;
    // zanzhu 目录始终走网络，不缓存
    if (/\/img\/zanzhu\//.test(path)) return true;
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
      || path.endsWith('/data/bible-versions.json')
      || path.endsWith('/data/strongs-dict.json')
      || /\/data\/parsing\/\d+\.json$/.test(path);
  } catch (e) { return false; }
}

// packs 路径已废弃

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

  // 安装/更新时 cacheAllResources 使用 cache:'no-cache' 发起请求，
  // 由页面侧显式调用 cache.put 管理，SW 不再介入，避免双重写缓存竞争。
  // 必须在 isBibleData 等拦截分支之前，确保 no-cache 请求不被 SW 缓存命中
  if (request.cache === 'no-cache') return;

  // 圣经分片数据：cache-first（圣经数据不变，优先缓存，离线可用）
  // 经文数据写入 CACHE_NAME（固定名 cx-main），由 SW cache.put 覆盖更新
  if (isBibleData(request.url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request) || await caches.match(normalizedUrl);
      if (cached) return cached;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);
        const response = await fetch(request, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (response && response.status === 200 && CONFIG.CACHEABLE_TYPES.includes(response.type)) {
          const cache = await caches.open(CACHE_NAME);
          event.waitUntil(cache.put(request, response.clone()).catch(function() {}));
        }
        return response;
      } catch (e) {
        // 网络超时或离线：返回 503 JSON 兜底，避免页面 JS 因 fetch reject 报错
        return new Response('{"error":"offline"}', {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    })());
    return;
  }

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
      // 先尝试缓存的 index.html（SPA fallback），避免直接返回离线空壳
      return caches.match('./')
        || caches.match(normalizedUrl)
        || caches.match(request.url)
        || new Response(getOfflineHTML(), {
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
        port.postMessage({
          ok: allKeys.includes(CACHE_NAME),
          dataOk: allKeys.some(k => k.indexOf(DATA_CACHE_PREFIX) === 0)
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
  // 写入页面侧指定的数据桶（event.data.cacheName）
  if (event.data.type === 'CACHE_ALL_BIBLE') {
    event.waitUntil(
      caches.open(event.data.cacheName || 'cx-data-0.0.0').then(function(cache) {
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
        urls.push('./data/strongs-dict.json');
        for (var j = 1; j <= 66; j++) {
          urls.push('./data/parsing/' + String(j).padStart(2, '0') + '.json');
        }
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

  // 返回当前缓存的书卷数量和状态（查询数据桶 cx-data-*）
  if (event.data.type === 'CACHE_STATUS') {
    var port = event.ports && event.ports[0];
    if (!port) return;
    event.waitUntil(
      caches.keys().then(function(keys){
        // 找到第一个 cx-data-* 桶
        var dataKey = keys.find(function(k){ return k.indexOf(DATA_CACHE_PREFIX) === 0; });
        if(!dataKey) return { bibleCount: 0, bibleUrls: [] };
        return caches.open(dataKey).then(function(cache) {
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
                  var langDir = (parts.length >= 3 && parts[parts.length - 2] !== 'bible')
                    ? parts[parts.length - 2] + '/' : '';
                  bibleUrls.push(langDir + fileName);
                }
              } catch (e) {}
            });
            return { bibleCount: bibleCount, bibleUrls: bibleUrls };
          });
        });
      }).then(function(info){
        port.postMessage({
          ok: true,
          cachedBooks: info.bibleCount,
          totalBooks: 66,
          books: info.bibleUrls.sort()
        });
      }).catch(function(err) {
        port.postMessage({ ok: false, error: err.message });
      })
    );
  }
});