/*!
 * router.js — SPA hash 路由
 * Hash 格式：
 *   #/            → 首页（跳转最近阅读或默认章节）
 *   #/bible/{bookIndex}/{chapter}  → 经文阅读视图
 *   #/bible       → 跳转最近阅读或默认章节
 *   #/{path}      → 批次目录（章节列表）
 *   #/{path}/{n}/{view}  → 章节视图（cv/cx/h/ts/sg/zs）
 *
 * 暴露：window.CXRouter
 *   .start()
 *   .navigate(hashPath)        e.g. navigate('2025-04') or navigate('2025-04/1/cx')
 *   .navigateReplace(hashPath) 同 navigate，但用 replaceState（不新增历史条目），用于返回键显式层级跳转
 *   .back()
 */
(function (win) {
  'use strict';

  var _started = false;
  var _skipNextDispatch = false;  // 用于跳过 ghost history 条目的 hashchange dispatch

  function getPath() {
    var h = win.location.hash || '#/';
    // strip leading '#/'
    return h.replace(/^#\/?/, '');
  }

  // ── 延迟重试队列：当目标模块尚未就绪时，缓存 dispatch 参数，
  //    等模块加载完成后重试，防止冷启动时 defer 脚本竞态导致白屏。
  var _pendingDispatch = null;   // { path: string, timer: number|null }
  var _MAX_RETRY_DELAY = 5000;   // 最长等待 5 秒

  function dispatch(path) {
    // 每次 dispatch 入口立即重置 skip 标志，消除 navigateReplace 中 setTimeout 的竞态条件
    _skipNextDispatch = false;
    // 有新 dispatch 时清除旧的挂起重试
    if (_pendingDispatch) {
      if (_pendingDispatch.timer) clearTimeout(_pendingDispatch.timer);
      _pendingDispatch = null;
    }

    try {
    var parts = path.split('/').filter(Boolean);
    // 记录当前路由路径，供 nav-stack.js 返回键处理读取（popstate 后 hash 已改变，需此值定位来源页）
    win.__cxCurrentPath = path;
    var R = win.CXRenderer;
    var B = win.CXBible;
    // ── 诊断日志：记录 dispatch 来源和 #app 状态 ──
    var _appEl = document.getElementById('app');
    console.log('[Router] dispatch path="' + path + '" parts=' + JSON.stringify(parts)
      + ' CXRenderer=' + (R ? 'ok' : 'NULL')
      + ' #app.innerHTML.length=' + (_appEl ? (_appEl.innerHTML||'').length : 'N/A')
      + ' #app.display="' + (_appEl ? _appEl.style.display : 'N/A') + '"');

    // 读经计划路由：#/reading-plan, #/reading-plan/{id}, #/reading-plan/{id}/{day}
    if (parts.length > 0 && parts[0] === 'reading-plan') {
      var RP = win.CXReadingPlan;
      if (!RP) {
        console.warn('[Router] CXReadingPlan 未就绪，挂起 dispatch 等待模块加载');
        _scheduleRetry(path);
        return;
      }
      // 已在读经计划页且实例+日期一致时跳过重复渲染，避免顶栏闪烁
      var _rpInstId = parts.length >= 2 ? parts[1] : null;
      var _rpDayNum = parts.length >= 3 ? parts[2] : null;
      if (document.body.classList.contains('cx-reading-plan-page') && RP._isSamePage && RP._isSamePage(_rpInstId, _rpDayNum)) {
        console.log('[Router] 已在读经计划页，参数一致，跳过重复渲染');
        return;
      }
      document.body.classList.remove('cx-bible-page');
      document.body.classList.add('cx-reading-plan-page');
      win.scrollTo(0, 0);
      RP.render(_rpInstId, _rpDayNum);
      return;
    }

    // 圣经阅读路由：#/bible/{bookIndex}/{chapter}（仅依赖 CXBible，不依赖 CXRenderer）
    if (parts.length > 0 && parts[0] === 'bible') {
      if (!B) {
        console.warn('[Router] CXBible 未就绪，挂起 dispatch 等待模块加载');
        _scheduleRetry(path);
        return;
      }
      win.scrollTo(0, 0);
      if (parts.length === 1 || parts.length === 2) {
        // #/bible 或 #/bible/{bookIndex} → 跳转默认章节
        document.body.classList.remove('cx-bible-page');
        document.body.classList.remove('cx-reading-plan-page');
        if (win.CXReadingPlan && win.CXReadingPlan.cleanup) win.CXReadingPlan.cleanup();
        setTimeout(function() {
          var latest = (win.CXBible && win.CXBible.getLatestHistory) ? win.CXBible.getLatestHistory() : null;
          if (latest && latest.bookIndex && latest.chapter) {
            Router.navigateReplace('bible/' + latest.bookIndex + '/' + latest.chapter);
          } else {
            Router.navigateReplace('bible/1/1');
          }
        }, 0);
      } else if (parts.length >= 3) {
        // #/bible/{bookIndex}/{chapter} → 经文阅读视图
        document.body.classList.add('cx-bible-page');
        document.body.classList.remove('cx-reading-plan-page');
        if (win.CXReadingPlan && win.CXReadingPlan.cleanup) win.CXReadingPlan.cleanup();
        B.renderBibleView(parseInt(parts[1], 10), parseInt(parts[2], 10));
      }
      return;
    }

    if (!R) {
      console.warn('[Router] CXRenderer 未就绪，挂起 dispatch 等待模块加载');
      _scheduleRetry(path);
      return;
    }
    document.body.classList.remove('cx-bible-page');
    document.body.classList.remove('cx-reading-plan-page');
    if (win.CXReadingPlan && win.CXReadingPlan.cleanup) win.CXReadingPlan.cleanup();
    win.scrollTo(0, 0);

    if (parts.length === 0) {
      // 默认直达经文：有历史则恢复最近阅读，否则跳转创世记第1章
      // 将 getLatestHistory 调用推迟到 setTimeout 内部，避免 DOMContentLoaded 竞态
      setTimeout(function() {
        var latest = (win.CXBible && win.CXBible.getLatestHistory) ? win.CXBible.getLatestHistory() : null;
        console.log('[Router] dispatch("") latest=' + JSON.stringify(latest) + ' hash="' + win.location.hash + '"');
        if (latest && latest.bookIndex && latest.chapter) {
          Router.navigateReplace('bible/' + latest.bookIndex + '/' + latest.chapter);
        } else {
          Router.navigateReplace('bible/1/1');
        }
      }, 0);
    } else if (parts.length === 1) {
      R.renderBatchIndex(parts[0]);
    } else if (parts.length === 2 && parts[1] === 'motto') {
      R.renderMotto(parts[0]);
    } else if (parts.length === 2 && parts[1] === 'motto_song') {
      R.renderMottoSong(parts[0]);
    } else if (parts.length >= 3) {
      R.renderChapterView(parts[0], parseInt(parts[1], 10), parts[2]);
    } else {
      R.renderHome();
    }
    } finally {
      // 每次路由 dispatch 后持久化当前页，确保 cx_last_page 始终=最后浏览的页面，
      // 覆盖 navigateReplace / 视图切换等不触发 hashchange 的路径；与 index.html 的
      // CXSavePage（beforeunload/pagehide/visibilitychange/hashchange）互补。
      if (win.CXSavePage) { try { win.CXSavePage(); } catch (e) {} }
    }
  }

  // ── 延迟重试：目标模块（CXReadingPlan/CXBible/CXRenderer）未就绪时 ──
  //    注册轮询 + window.load 兜底，确保冷启动时 defer 脚本竞态不会导致白屏。
  //    所有 defer 脚本在 DOMContentLoaded 之前保证执行完成，
  //    但如果 start() 在 DOMContentLoaded 之前被调用（不应发生，但防御性处理），
  //    或脚本加载异常慢，则用轮询重试。
  function _scheduleRetry(path) {
    if (_pendingDispatch && _pendingDispatch.path === path) return; // 已在等待同一路径
    _pendingDispatch = { path: path, timer: null };

    // 轮询重试：每 50ms 检查模块是否就绪，最长等待 _MAX_RETRY_DELAY
    var startTime = Date.now();
    var retryTimer = setInterval(function() {
      // 根据路径判断需要哪个模块就绪
      var parts = path.split('/').filter(Boolean);
      var ready = false;
      if (parts.length > 0 && parts[0] === 'reading-plan') {
        ready = !!win.CXReadingPlan;
      } else if (parts.length > 0 && parts[0] === 'bible') {
        ready = !!win.CXBible;
      } else {
        ready = !!win.CXRenderer;
      }
      if (ready || Date.now() - startTime > _MAX_RETRY_DELAY) {
        clearInterval(retryTimer);
        if (_pendingDispatch && _pendingDispatch.path === path) {
          _pendingDispatch = null;
          if (ready) {
            console.log('[Router] 模块已就绪，重新 dispatch path="' + path + '"');
            dispatch(path);
          } else {
            console.error('[Router] 模块加载超时，放弃 dispatch path="' + path + '"，fallback 到默认页');
            // 最终兜底：导航到默认圣经页，避免永久白屏
            if (win.CXBible) {
              dispatch('bible/1/1');
            } else {
              // 极端情况：CXBible 也不可用，手动显示 #app
              var app = document.getElementById('app');
              if (app) {
                app.style.display = '';
                app.style.opacity = '';
                app.innerHTML = '<div style="padding:40px;text-align:center;color:var(--danger-text,#c53030)">页面加载失败，请关闭应用后重新打开</div>';
              }
            }
          }
        }
      }
    }, 50);
    _pendingDispatch.timer = retryTimer;
  }

  function onHashChange() {
    // 若正在执行 PWA 退出（history.back），忽略本次 hash 变化，避免路由重渲染
    var _appEl = document.getElementById('app');
    console.log('[Router] hashchange hash="' + win.location.hash + '" __cxExiting=' + !!win.__cxExiting
      + ' #app.innerHTML.length=' + (_appEl ? (_appEl.innerHTML||'').length : 'N/A')
      + ' #app.display="' + (_appEl ? _appEl.style.display : 'N/A') + '"');
    if (win.__cxExiting) return;
    if (_skipNextDispatch) {
      _skipNextDispatch = false;
      console.log('[Router] hashchange skipped (ghost entry)');
      return;
    }
    dispatch(getPath());
  }

  var Router = {
    start: function () {
      if (_started) return;
      _started = true;
      win.addEventListener('hashchange', onHashChange);
      console.log('[Router] start() initialHash="' + win.location.hash + '"');
      dispatch(getPath());
    },

    navigate: function (hashPath) {
      // 用户主动导航，清除退出标记（防止 exit 流程误阻断后续导航）
      win.__cxExiting = false;
      var newHash = '#/' + (hashPath || '');
      console.log('[Router] navigate("' + hashPath + '") curHash="' + win.location.hash + '" → newHash="' + newHash + '"');
      if (win.location.hash === newHash) {
        // same hash — force re-dispatch (e.g. return to home from home)
        dispatch(hashPath || '');
        return;
      }
      // 判断是否为同一章节内的视图切换（cx↔cv↔h↔ts↔sg↔zs）
      // 视图切换：replaceState 替换当前历史条目，不新增条目，
      //   避免返回键需逐一回放每个视图标签（与 APK backButton 行为一致）
      // 跨层级跳转（home↔批次↔章节）：location.hash 新增历史条目，
      //   确保返回键可逐级退回
      var curParts = (win.__cxCurrentPath || '').split('/').filter(Boolean);
      var newParts = (hashPath || '').split('/').filter(Boolean);
      var isSameChapterViewSwitch = (
        curParts.length === 3 && newParts.length === 3 &&
        curParts[0] === newParts[0] && curParts[1] === newParts[1] &&
        curParts[0] !== 'bible' // 圣经路由无视图切换，跨章节需新增历史条目
      );
      if (isSameChapterViewSwitch) {
        // 同章节视图切换：replaceState 不触发 popstate / hashchange，需手动 dispatch
        try { win.history.replaceState(null, '', win.location.pathname + newHash); } catch(e) {}
        dispatch(hashPath || '');
      } else {
        // 跨层级跳转：Android Chrome PWA 在 location.hash 赋值时会触发虚假 popstate，
        // 先 skipNext() 让 backStack 忽略它；hashchange 会自动触发 dispatch
        if (win.CX && win.CX.backStack && win.CX.backStack.skipNext) win.CX.backStack.skipNext();
        win.location.hash = newHash;
      }
    },

    back: function () {
      win.history.back();
    },

    // 用 replaceState 跳转到 hashPath（不新增历史条目），并立即 dispatch 渲染。
    // 用于 PWA 返回键的显式层级跳转，天然覆盖 ghost entry，无需额外检测。
    navigateReplace: function (hashPath) {
      win.__cxExiting = false;
      var newHash = '#/' + (hashPath || '');
      console.log('[Router] navigateReplace("' + hashPath + '") curHash="' + win.location.hash + '" → newHash="' + newHash + '"');
      // 设置 skip 标志以抑制 replaceState 可能产生的虚假 hashchange（部分浏览器实现差异）
      _skipNextDispatch = true;
      try { win.history.replaceState(null, '', win.location.pathname + newHash); } catch(e) {}
      // dispatch 内部会在入口处同步重置 _skipNextDispatch，无需 setTimeout，
      // 从而消除竞态条件：后续 navigate() 触发的 hashchange 不会被误跳过。
      dispatch(hashPath || '');
    },

    // 让下一次 hashchange 不触发 dispatch（用于跳过 ghost replaceState 条目）
    skipNextDispatch: function() { _skipNextDispatch = true; },

    currentPath: function () {
      return getPath();
    },

    // 重新 dispatch 当前路由（不改变 hash，不新增历史条目）
    // 用于 _cxShowApp / bfcache 检测到 #app innerHTML 为空时的补救渲染。
    // 不能用 start()——它有 _started 守卫，第二次调用直接返回。
    // 防重入守卫：renderBibleView 开头调用 _cxShowApp()，此时 innerHTML 尚为空，
    // redispatch 会再次触发 renderBibleView，形成无限递归。加 _redispatching 标志截断。
    redispatch: function () {
      if (win._cxRedispatching) {
        console.warn('[Router] redispatch BLOCKED by _cxRedispatching guard');
        return;
      }
      win._cxRedispatching = true;
      var _appEl = document.getElementById('app');
      console.log('[Router] redispatch() called, #app.innerHTML.length=' + (_appEl ? (_appEl.innerHTML||'').length : 'N/A')
        + ' #app.display="' + (_appEl ? _appEl.style.display : 'N/A') + '"'
        + ' stack=[' + (new Error().stack||'').split('\n').slice(2,4).map(function(s){return s.trim();}).join(' | ') + ']');
      try {
        dispatch(getPath());
      } finally {
        win._cxRedispatching = false;
      }
    }
  };

  win.CXRouter = Router;

}(window));
