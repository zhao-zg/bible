/**
 * 圣经阅读器渲染器
 * 参考微圣经 UI 设计
 * 挂载到 window.CXBible
 */
(function () {
  'use strict';

  // ── 书卷简称中文数字 ──
  var CN_NUMS = ['零','一','二','三','四','五','六','七','八','九','十',
    '十一','十二','十三','十四','十五','十六','十七','十八','十九','二十',
    '二十一','二十二','二十三','二十四','二十五','二十六','二十七','二十八','二十九','三十',
    '三十一','三十二','三十三','三十四','三十五','三十六','三十七','三十八','三十九','四十',
    '四十一','四十二','四十三','四十四','四十五','四十六','四十七','四十八','四十九','五十'];

  function cnChapter(n) {
    return (CN_NUMS[n] || String(n)) + '章';
  }

  // ── i18n 安全引用 ──
  var _t  = (window.CXI18n && window.CXI18n.t)  ? window.CXI18n.t.bind(window.CXI18n)  : function(k) { return k; };
  var _tf = (window.CXI18n && window.CXI18n.tf) ? window.CXI18n.tf.bind(window.CXI18n) : function(k, v) { return k; };

  // ── 旧约/新约分界 ──
  var OT_END = 39; // 旧约 1-39，新约 40-66

  // ── 内容显示开关 ──
  var _toggles = {
    showTheme: true,
    showIntro: true,
    showOutline: true,
    showVerseDivider: true
  };

  function loadToggles() {
    try {
      var saved = JSON.parse(localStorage.getItem('bible_toggles') || '{}');
      Object.keys(saved).forEach(function(k) {
        if (k in _toggles) _toggles[k] = !!saved[k];
      });
    } catch(e) {}
  }
  function saveToggles() {
    try { localStorage.setItem('bible_toggles', JSON.stringify(_toggles)); } catch(e) {}
  }

  // ── 缓存 ──
  var _booksMeta = null;       // bible-books.json
  var _bookDataCache = {};     // bookIndex -> data
  var _preRenderedHtml = {};   // {bookIndex: {chapter: htmlString}}
  var _currentBook = null;
  var _currentChapter = null;
  var _topicsData = null;      // bible-topics.json
  var _topicsPromise = null;   // in-flight Promise 去重
  var _introData = null;       // bible-intro.json
  var _introPromise = null;    // in-flight Promise 去重
  var _outlinesData = null;    // bible-outlines.json
  var _outlinesPromise = null; // in-flight Promise 去重
  var _drawerBackStackClose = null; // 抽屉 backStack 跟踪，防止重复调用泄漏

  // ── 版本管理 ──
  var _availableVersions = [];   // 从 bible-versions.json 加载
  var _activeVersions = ['zh-rcv']; // 当前激活版本（默认仅恢复本）
  var _versionDataCache = {};    // lang -> bookIndex -> data
  var _langDisplayOrder = [];     // 语言显示顺序（辅助版本排序）
  var _currentTestament = 'ot'; // 'ot' | 'nt'
  var _currentTab = 'books';    // 'books' | 'favorites' | 'history'
  var _history = [];            // 浏览历史
  var _initDone = false;        // 防止 init() 被多次调用
  var _verseEventsBound = false; // 经文事件委托是否已绑定
  var _renderGen = 0;           // 渲染代数计数器，用于防止竞态条件
  var LOAD_TIMEOUT_MS = 15000;  // 数据加载超时阈值（毫秒）

  // ── Session 级滚动位置记忆（同一次打开内保留各章节位置，关闭后清除）──
  var _scrollSaveTimer = null;
  var _scrollSaveHandler = null;

  function _saveScrollPos(bookIndex, chapter) {
    try {
      sessionStorage.setItem('bible_scroll:' + bookIndex + '/' + chapter, String(window.scrollY || 0));
    } catch(e) {}
  }

  function _getScrollPos(bookIndex, chapter) {
    try {
      return parseInt(sessionStorage.getItem('bible_scroll:' + bookIndex + '/' + chapter) || '0', 10) || 0;
    } catch(e) { return 0; }
  }

  function _setupScrollSave() {
    if (_scrollSaveHandler) { window.removeEventListener('scroll', _scrollSaveHandler); }
    if (_scrollSaveTimer) { clearTimeout(_scrollSaveTimer); _scrollSaveTimer = null; }
    _scrollSaveHandler = function() {
      if (_scrollSaveTimer) clearTimeout(_scrollSaveTimer);
      _scrollSaveTimer = setTimeout(function() {
        _saveScrollPos(_currentBook, _currentChapter);
      }, 300);
    };
    window.addEventListener('scroll', _scrollSaveHandler, {passive: true});
  }

  function _flushScrollSave() {
    if (_scrollSaveTimer) { clearTimeout(_scrollSaveTimer); _scrollSaveTimer = null; }
    if (_currentBook && _currentChapter) _saveScrollPos(_currentBook, _currentChapter);
  }

  function loadHistory() {
    try {
      var raw = localStorage.getItem('bible_history');
      _history = JSON.parse(raw || '[]');
      console.log('[CXBible] loadHistory: raw=' + (raw ? raw.length + 'chars' : 'null') + ' → ' + _history.length + ' entries');
    } catch(e) { _history = []; console.error('[CXBible] loadHistory FAILED:', e); }
  }
  function saveHistory() {
    try { localStorage.setItem('bible_history', JSON.stringify(_history.slice(0, 50))); } catch(e) { console.error('[CXBible] saveHistory FAILED:', e); }
  }

  // ── 简易 Toast 提示 ──
  function _showBibleToast(msg) {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
      'background:rgba(50,50,50,.92);color:#fff;padding:10px 18px;border-radius:22px;' +
      'font-size:0.875rem;z-index:99999;opacity:0;transition:opacity .3s;pointer-events:none;' +
      'white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.18)';
    el.textContent = msg;
    document.body.appendChild(el);
    void el.offsetWidth;
    el.style.opacity = '1';
    setTimeout(function() {
      el.style.opacity = '0';
      setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, 2000);
  }

  function addHistory(bookIndex, chapter) {
    var entry = { bookIndex: bookIndex, chapter: chapter, time: Date.now() };
    _history = _history.filter(function(h) {
      return !(h.bookIndex === bookIndex && h.chapter === chapter);
    });
    _history.unshift(entry);
    if (_history.length > 50) _history = _history.slice(0, 50);
    saveHistory();
    console.log('[CXBible] addHistory → bible/' + bookIndex + '/' + chapter + ' (total=' + _history.length + ')');
  }

  // ── 收藏功能 ──
  function _getFavorites() {
    try {
      return JSON.parse(localStorage.getItem('bible_favorites') || '[]');
    } catch(e) { return []; }
  }
  function _saveFavorites(favs) {
    try { localStorage.setItem('bible_favorites', JSON.stringify(favs)); } catch(e) {}
  }
  function _addFavorite(bookIndex, bookName, chapter) {
    var favs = _getFavorites();
    // 避免重复
    for (var i = 0; i < favs.length; i++) {
      if (favs[i].bookIndex === bookIndex && favs[i].chapter === chapter) return;
    }
    favs.unshift({ bookIndex: bookIndex, bookName: bookName, chapter: chapter, time: Date.now() });
    _saveFavorites(favs);
  }
  function _removeFavorite(bookIndex, chapter) {
    var favs = _getFavorites();
    favs = favs.filter(function(f) {
      return !(f.bookIndex === bookIndex && f.chapter === chapter);
    });
    _saveFavorites(favs);
  }
  function _isFavorite(bookIndex, chapter) {
    var favs = _getFavorites();
    for (var i = 0; i < favs.length; i++) {
      if (favs[i].bookIndex === bookIndex && favs[i].chapter === chapter) return true;
    }
    return false;
  }
  function _relativeTime(ts) {
    var now = Date.now();
    var diff = now - ts;
    if (diff < 60000) return _t('time_just_now');
    var minutes = Math.floor(diff / 60000);
    if (minutes < 60) return _tf('time_minutes_ago', {n: minutes});
    var hours = Math.floor(diff / 3600000);
    if (hours < 24) return _tf('time_hours_ago', {n: hours});
    var days = Math.floor(diff / 86400000);
    if (days < 30) return _tf('time_days_ago', {n: days});
    var months = Math.floor(days / 30);
    return _tf('time_months_ago', {n: months});
  }

  // ── 数据加载 ──
  function getRoot() {
    return (window.CX_ROOT || './');
  }

  // Capacitor 原生 App 无 SW，用时间戳参数绕过 WebView HTTP 缓存，
  // 确保冷启动时取到 APK 包内最新文件（与 renderer.js 一致的策略）。
  function _buildFetchUrl(path) {
    var url = getRoot() + path;
    var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (isNative) url += (url.indexOf('?') === -1 ? '?_t=' : '&_t=') + Date.now();
    return url;
  }

  function loadBooksMeta() {
    if (_booksMeta) return Promise.resolve(_booksMeta);
    return fetch(_buildFetchUrl('data/bible-books.json'))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        _booksMeta = data;
        return data;
      });
  }

  // ── 版本元数据加载 ──
  function loadVersionsMeta() {
    if (_availableVersions.length) return Promise.resolve(_availableVersions);
    return fetch(_buildFetchUrl('data/bible-versions.json'))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        _availableVersions = data || [];
        // 从 localStorage 恢复激活版本
        try {
          var saved = JSON.parse(localStorage.getItem('bible_active_versions') || '');
          if (Array.isArray(saved) && saved.length) _activeVersions = saved;
        } catch(e) {}
        // 确保 zh-rcv 始终在激活列表中
        if (_activeVersions.indexOf('zh-rcv') === -1) _activeVersions.push('zh-rcv');
        // he-orig / he-el 依赖 KJV，若 KJV 不在激活列表则移除
        if (_activeVersions.indexOf('en-kjv') === -1) {
          ['he-orig', 'he-el'].forEach(function(origLang) {
            var idx = _activeVersions.indexOf(origLang);
            if (idx !== -1) _activeVersions.splice(idx, 1);
          });
        }
        loadLangDisplayOrder();
        return _availableVersions;
      })
      .catch(function(err) {
        console.warn('[CXBible] 版本元数据加载失败:', err);
        return [];
      });
  }

  function saveActiveVersions() {
    try { localStorage.setItem('bible_active_versions', JSON.stringify(_activeVersions)); } catch(e) {}
  }

  function saveLangDisplayOrder() {
    try {
      localStorage.setItem('bible_lang_display_order', JSON.stringify(_langDisplayOrder));
    } catch(e) {}
  }

  function loadLangDisplayOrder() {
    try {
      var saved = JSON.parse(localStorage.getItem('bible_lang_display_order') || '');
      if (Array.isArray(saved) && saved.length) {
        _langDisplayOrder = saved;
        return;
      }
    } catch(e) {}
    _langDisplayOrder = _activeVersions.slice();
  }

  // ── 加载指定版本的书卷数据 ──
  function loadVersionBookData(lang, bookIndex) {
    if (_versionDataCache[lang] && _versionDataCache[lang][bookIndex]) {
      return Promise.resolve(_versionDataCache[lang][bookIndex]);
    }
    var idx = String(bookIndex).padStart(2, '0');
    var url = _buildFetchUrl('data/bible/' + lang + '/' + idx + '.json');
    return fetch(url)
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        if (!_versionDataCache[lang]) _versionDataCache[lang] = {};
        _versionDataCache[lang][bookIndex] = data;
        return data;
      })
      .catch(function(err) {
        console.warn('[CXBible] 版本数据加载失败 (' + lang + '/' + bookIndex + '):', err);
        return { book_index: bookIndex, chapters: [] };
      });
  }

  function loadBookData(bookIndex) {
    // 主版本（CG 恢复本，含注解/串珠）
    var mainPromise = _bookDataCache[bookIndex]
      ? Promise.resolve(_bookDataCache[bookIndex])
      : fetch(_buildFetchUrl('data/bible/' + String(bookIndex).padStart(2, '0') + '.json'))
          .then(function(r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then(function(data) {
            _bookDataCache[bookIndex] = data;
            return data;
          })
          .catch(function(err) {
            console.warn('[CXBible] 书卷数据加载失败 (' + bookIndex + '):', err);
            return { book_index: bookIndex, book_name: '', book_acronym: '', chapters: [] };
          });

    // 非 zh-rcv 激活版本并行加载
    var secondaryPromises = [];
    for (var i = 0; i < _activeVersions.length; i++) {
      var lang = _activeVersions[i];
      if (lang === 'zh-rcv') continue;
      secondaryPromises.push(loadVersionBookData(lang, bookIndex));
    }

    if (secondaryPromises.length === 0) return mainPromise;

    // 所有版本并行 fetch
    var allPromises = [mainPromise].concat(secondaryPromises);
    return Promise.all(allPromises).then(function(results) {
      return results[0]; // 返回主版本数据
    });
  }

  // ── 元数据懒加载 ──
  function loadBibleTopics() {
    if (_topicsData) return Promise.resolve(_topicsData);
    if (_topicsPromise) return _topicsPromise;
    _topicsPromise = fetch(_buildFetchUrl('data/bible-topics.json'))
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        _topicsData = data;
        _topicsPromise = null;
        return data;
      })
      .catch(function(err) {
        console.warn('[CXBible] 主题数据加载失败:', err);
        _topicsPromise = null;
        return {};
      });
    return _topicsPromise;
  }

  function loadBibleIntro() {
    if (_introData) return Promise.resolve(_introData);
    if (_introPromise) return _introPromise;
    _introPromise = fetch(_buildFetchUrl('data/bible-intro.json'))
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        _introData = data;
        _introPromise = null;
        return data;
      })
      .catch(function(err) {
        console.warn('[CXBible] 书介数据加载失败:', err);
        _introPromise = null;
        return {};
      });
    return _introPromise;
  }

  function loadBibleOutlines() {
    if (_outlinesData) return Promise.resolve(_outlinesData);
    if (_outlinesPromise) return _outlinesPromise;
    _outlinesPromise = fetch(_buildFetchUrl('data/bible-outlines.json'))
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        _outlinesData = data;
        _outlinesPromise = null;
        return data;
      })
      .catch(function(err) {
        console.warn('[CXBible] 纲目数据加载失败:', err);
        _outlinesPromise = null;
        return {};
      });
    return _outlinesPromise;
  }

  // ── 辅助 ──
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function getBookMeta(bookIndex) {
    if (!_booksMeta) return { acronym: '', name: '' };
    for (var i = 0; i < _booksMeta.length; i++) {
      if (_booksMeta[i].index === bookIndex) return _booksMeta[i];
    }
    return { acronym: '', name: '' };
  }

  // ── 渲染经文文本（处理 {N} 和 [a] 标记）──
  function renderVerseText(content, bookAcronym, chapter, section, flag) {
    var text = esc(content);
    var verseKey = bookAcronym + chapter + ':' + section;
    if (flag === 1) verseKey += '上';
    else if (flag === 2) verseKey += '下';
    else if (flag === 3) verseKey += '中';

    // {N} → 注解上标
    text = text.replace(/\{(\d+)\}/g, function(_, n) {
      return '<sup class="fn-ref" data-vkey="' + esc(verseKey) + '" data-fn="' + n + '">' + n + '</sup>';
    });
    // [a] → 串珠上标
    text = text.replace(/\[([a-z]+)\]/g, function(_, lr) {
      return '<sup class="xref-ref" data-vkey="' + esc(verseKey) + '" data-xr="' + lr + '">' + lr + '</sup>';
    });
    return text;
  }

  // ══════════════════════════════════════════════════════════
  //  书卷/章节导航（双栏布局）— 共享渲染函数，供抽屉使用
  // ══════════════════════════════════════════════════════════

  function _renderBookNavContent(books) {
    if (_currentTab === 'history') {
      return _renderHistoryTab();
    }
    if (_currentTab === 'favorites') {
      return _renderFavoritesTab();
    }

    var startIdx = _currentTestament === 'ot' ? 1 : 40;
    var endIdx = _currentTestament === 'ot' ? 39 : 66;
    var filtered = books.filter(function(b) { return b.index >= startIdx && b.index <= endIdx; });

    var html = '<div class="book-list" id="bookListCol">';
    filtered.forEach(function(b) {
      var isActive = _currentBook === b.index;
      html += '<div class="book-list-item' + (isActive ? ' active' : '') + '" data-book="' + b.index + '">';
      html += '<span class="book-index">' + b.index + '</span>';
      html += '<span class="book-name">' + esc(b.name) + '</span>';
      html += '</div>';
    });
    html += '</div>';

    // 右侧章节列表
    html += '<div class="chapter-list" id="chapterListCol">';
    if (_currentBook) {
      html += _renderChapterList(_currentBook);
    } else if (filtered.length > 0) {
      html += _renderChapterList(filtered[0].index);
    }
    html += '</div>';

    return html;
  }

  function _renderChapterList(bookIndex) {
    var cached = _bookDataCache[bookIndex];
    var chapterCount = 0;
    if (cached && cached.chapters) {
      chapterCount = cached.chapters.length;
    } else {
      // 常见章节数（默认值，加载数据后会更新）
      var defaultChapters = {
        1:50,2:40,3:27,4:36,5:34,6:24,7:21,8:4,9:31,10:24,11:22,12:25,13:29,14:36,
        15:10,16:13,17:10,18:42,19:150,20:31,21:12,22:8,23:66,24:52,25:5,26:48,27:12,
        28:14,29:3,30:9,31:1,32:2,33:20,34:16,35:7,36:14,37:4,38:28,39:4,
        40:28,41:16,42:24,43:21,44:28,45:16,46:16,47:13,48:14,49:10,50:16,51:4,
        52:5,53:5,54:6,55:3,56:14,57:1,58:13,59:5,60:5,61:5,62:5,63:1,64:1,65:1,66:22
      };
      chapterCount = defaultChapters[bookIndex] || 10;
    }

    var html = '';
    for (var i = 1; i <= chapterCount; i++) {
      html += '<div class="chapter-list-item" data-book="' + bookIndex + '" data-chapter="' + i + '">';
      html += _tf('chapter_n', {n: i});
      html += '</div>';
    }
    return html;
  }

  function _renderHistoryTab() {
    if (!_history.length) {
      return '<div style="padding:40px 20px;text-align:center;color:var(--text-muted,#999);width:100%">' + esc(_t('no_history')) + '</div>';
    }
    var html = '<div style="width:100%;overflow-y:auto;-webkit-overflow-scrolling:touch">';
    _history.forEach(function(h) {
      var meta = getBookMeta(h.bookIndex);
      html += '<div class="chapter-list-item" data-book="' + h.bookIndex + '" data-chapter="' + h.chapter + '">';
      html += esc(meta.name || '') + ' ' + _tf('chapter_n', {n: h.chapter});
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function _renderFavoritesTab() {
    var favs = _getFavorites();
    if (!favs.length) {
      return '<div style="padding:40px 20px;text-align:center;color:var(--text-muted,#999);width:100%">'
        + '<div style="font-size:2rem;margin-bottom:12px">⭐</div>'
        + '<div>' + esc(_t('no_favorites')) + '</div>'
        + '<div style="margin-top:8px;font-size:0.813rem">' + esc(_t('fav_hint')) + '</div>'
        + '</div>';
    }
    var html = '<div style="width:100%;overflow-y:auto;-webkit-overflow-scrolling:touch">';
    favs.forEach(function(f) {
      var meta = getBookMeta(f.bookIndex);
      var name = f.bookName || meta.name || _t('tab_books') + f.bookIndex;
      html += '<div class="chapter-list-item" data-book="' + f.bookIndex + '" data-chapter="' + f.chapter + '" style="display:flex;justify-content:space-between;align-items:center">';
      html += '<span>' + esc(name) + ' ' + _tf('chapter_n', {n: f.chapter}) + '</span>';
      html += '<span style="font-size:0.688rem;color:var(--text-muted,#999);white-space:nowrap;margin-left:8px">' + _relativeTime(f.time) + '</span>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  // ══════════════════════════════════════════════════════════
  //  书卷导航抽屉（左侧滑入）
  // ══════════════════════════════════════════════════════════
  function _showBookDrawer() {
    // 移除已有抽屉
    var existing = document.querySelector('.bible-drawer-overlay');
    if (existing) {
      existing.parentNode.removeChild(existing);
      if (_drawerBackStackClose && window.CX && window.CX.backStack) {
        if (typeof window.CX.backStack.pop === 'function') {
          window.CX.backStack.pop(true);
        }
      }
      _drawerBackStackClose = null;
    }

    loadBooksMeta().then(function(books) {
      var overlay = document.createElement('div');
      overlay.className = 'bible-drawer-overlay';

      var drawer = document.createElement('div');
      drawer.className = 'bible-drawer';

      // 头部
      var header = document.createElement('div');
      header.className = 'bible-drawer-header';
      header.innerHTML = '<span>' + esc(_t('tab_books')) + '</span><button class="bible-drawer-close">&times;</button>';
      drawer.appendChild(header);

      // 搜索栏
      var searchWrap = document.createElement('div');
      searchWrap.className = 'bible-drawer-search';
      searchWrap.innerHTML = '<input type="text" class="book-nav-search" id="drawerSearchInput" placeholder="' + esc(_t('search_placeholder')) + '" />';
      drawer.appendChild(searchWrap);

      // 标签页（书卷/收藏/历史）
      var tabs = document.createElement('div');
      tabs.className = 'book-nav-tabs';
      tabs.innerHTML = '<button class="book-nav-tab' + (_currentTab === 'books' ? ' active' : '') + '" data-tab="books">' + esc(_t('tab_books')) + '</button>'
        + '<button class="book-nav-tab' + (_currentTab === 'favorites' ? ' active' : '') + '" data-tab="favorites">' + esc(_t('tab_favorites')) + '</button>'
        + '<button class="book-nav-tab' + (_currentTab === 'history' ? ' active' : '') + '" data-tab="history">' + esc(_t('tab_history')) + '</button>';
      drawer.appendChild(tabs);

      // 主体（书卷列表 + 章节列表）
      var body = document.createElement('div');
      body.className = 'bible-drawer-body';
      body.id = 'drawerNavBody';
      body.innerHTML = _renderBookNavContent(books);
      drawer.appendChild(body);

      // 旧约/新约标签
      var testamentTabs = document.createElement('div');
      testamentTabs.className = 'testament-tabs';
      testamentTabs.innerHTML = '<button class="testament-tab' + (_currentTestament === 'ot' ? ' active' : '') + '" data-testament="ot">' + esc(_t('old_testament')) + '</button>'
        + '<button class="testament-tab' + (_currentTestament === 'nt' ? ' active' : '') + '" data-testament="nt">' + esc(_t('new_testament')) + '</button>';
      drawer.appendChild(testamentTabs);

      overlay.appendChild(drawer);
      document.body.appendChild(overlay);

      // 动画打开
      requestAnimationFrame(function() { overlay.classList.add('open'); });

      // 关闭函数
      var _lockCleanup = null;
      var _backStackPushed = false;
      function closeDrawer() {
        overlay.classList.remove('open');
        if (_lockCleanup) { _lockCleanup(); _lockCleanup = null; }
        setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 300);
        if (_backStackPushed && window.CX && window.CX.backStack) {
          if (typeof window.CX.backStack.pop === 'function') {
            window.CX.backStack.pop(true);
          }
        }
        _backStackPushed = false;
        _drawerBackStackClose = null;
      }

      // 防滚动穿透 + 触摸遮罩关闭（直接调用 closeDrawer，不走 history.back，防止触发页面级回退）
      if (window.CX && window.CX.lockOverlayScroll) {
        _lockCleanup = window.CX.lockOverlayScroll(overlay, closeDrawer);
      }
      // 桌面端：点击遮罩空白关闭；移动端：阻止合成 click 误触底层按钮
      overlay.addEventListener('touchend', function(e) {
        if (e.target === overlay) { e.preventDefault(); e.stopPropagation(); closeDrawer(); }
      }, { passive: false });
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) { e.preventDefault(); e.stopPropagation(); closeDrawer(); }
      });

      // 注册到返回栈（Android 返回键支持）
      // 注意：popstate 调度器在调用回调前已弹出栈条目，所以回调内不能再调 backStack.pop()
      // 用包装函数先清除 _backStackPushed 标志，再调 closeDrawer，防止双重 pop
      if (window.CX && window.CX.backStack && typeof window.CX.backStack.push === 'function') {
        window.CX.backStack.push(function() {
          _backStackPushed = false;
          _drawerBackStackClose = null;
          closeDrawer();
        });
        _drawerBackStackClose = closeDrawer;
        _backStackPushed = true;
      }

      // 关闭按钮
      var closeBtn = drawer.querySelector('.bible-drawer-close');
      if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

      // 标签页切换
      tabs.addEventListener('click', function(e) {
        var tab = e.target.closest ? e.target.closest('.book-nav-tab') : null;
        if (!tab) return;
        var tabName = tab.dataset.tab;
        if (tabName) {
          var searchInput = overlay.querySelector('#drawerSearchInput');
          if (searchInput) searchInput.value = '';
          _currentTab = tabName;
          tabs.querySelectorAll('.book-nav-tab').forEach(function(t) { t.classList.remove('active'); });
          tab.classList.add('active');
          body.innerHTML = _renderBookNavContent(books);
        }
      });

      // 旧约/新约切换
      testamentTabs.addEventListener('click', function(e) {
        var tab = e.target.closest ? e.target.closest('.testament-tab') : null;
        if (!tab) return;
        var searchInput = overlay.querySelector('#drawerSearchInput');
        if (searchInput) searchInput.value = '';
        _currentTestament = tab.dataset.testament;
        testamentTabs.querySelectorAll('.testament-tab').forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        body.innerHTML = _renderBookNavContent(books);
      });

      // 书卷/章节点击（事件委托）
      body.addEventListener('click', function(e) {
        var t = e.target;

        // 书卷点击 → 展开章节列表
        var bookEl = t.closest ? t.closest('.book-list-item') : null;
        if (!bookEl && t.classList && t.classList.contains('book-list-item')) bookEl = t;
        if (bookEl && bookEl.dataset && bookEl.dataset.book) {
          var bookIdx = parseInt(bookEl.dataset.book);
          var chapterCol = body.querySelector('.chapter-list');
          if (chapterCol) {
            chapterCol.innerHTML = _renderChapterList(bookIdx);
          }
          // 高亮选中的书卷
          body.querySelectorAll('.book-list-item').forEach(function(el) { el.classList.remove('active'); });
          bookEl.classList.add('active');
          return;
        }

        // 章节点击 → 导航并关闭抽屉
        var chapterEl = t.closest ? t.closest('.chapter-list-item') : null;
        if (!chapterEl && t.classList && t.classList.contains('chapter-list-item')) chapterEl = t;
        if (chapterEl && chapterEl.dataset) {
          var bIdx = parseInt(chapterEl.dataset.book);
          var chIdx = parseInt(chapterEl.dataset.chapter);
          if (bIdx && chIdx) {
            closeDrawer();
            if (window.CXRouter) {
              window.CXRouter.navigate('bible/' + bIdx + '/' + chIdx);
            }
          }
          return;
        }
      });

      // 搜索输入：点击打开全局搜索弹窗（先关闭书卷抽屉）
      var searchInput = drawer.querySelector('#drawerSearchInput');
      if (searchInput) {
        searchInput.addEventListener('click', function() {
          closeDrawer();
          if (window.CXSearch && window.CXSearch.open) window.CXSearch.open();
        });
      }
    });
  }

  // ══════════════════════════════════════════════════════════
  //  朗读控制栏（圣经视图专用）
  // ══════════════════════════════════════════════════════════
  // 朗读控制已重构为弹窗模式（#speechDialog），不再需要隐藏内联栏
  function _hideBibleSpeechBar() {
    // no-op: 弹窗由 speech.js 内部管理显示/隐藏
  }

  function _initBibleSpeech(meta, chapter) {
    // 朗读控件已统一在 #speechDialog 弹窗中（index.html），无需动态注入
    // 初始化 CXSpeech，朗读当前章节经文
    if (window.CXSpeech && window.CXSpeech.init) {
      var title = (meta.name || '') + ' ' + chapter;
      window.CXSpeech.init({
        getElements: function() {
          var segs = [];
          // 标题
          var title = document.querySelector('.bible-title');
          if (title && title.textContent.trim()) segs.push({el: title});
          // 元数据区（著者、著时等）
          var metaItems = document.querySelectorAll('.bible-metadata-item');
          for (var i = 0; i < metaItems.length; i++) {
            if (metaItems[i].textContent.trim()) segs.push({el: metaItems[i]});
          }
          // 主题摘要
          var theme = document.querySelector('.bible-theme-text');
          if (theme && theme.textContent.trim()) segs.push({el: theme});
          // 纲目
          var outlines = document.querySelectorAll('.bible-outline-item');
          for (var i = 0; i < outlines.length; i++) {
            if (outlines[i].textContent.trim()) segs.push({el: outlines[i]});
          }
          // 经文正文
          var verses = document.querySelectorAll('.bible-verse');
          for (var i = 0; i < verses.length; i++) {
            if (verses[i].textContent.trim()) segs.push({el: verses[i]});
          }
          return segs;
        },
        title: title,
        lang: (window.CXI18n && window.CXI18n.getLang) ? window.CXI18n.getLang() : 'zh-CN'
      });
    }
  }

  // ── 构建章节内容 HTML（从缓存读取，用于动画预渲染） ──
  function _buildChapterInnerHtml(bookIndex, chapter) {
    var bookData = _bookDataCache[bookIndex];
    if (!bookData) return null;
    var chapterData = _findChapterData(bookData, chapter);
    var meta = getBookMeta(bookIndex);
    if (!meta) return null;

    var html = '<div class="bible-reading">';
    // 章节栏已改为 fixed 定位，不在此处渲染

    if (!chapterData || !chapterData.verses || !chapterData.verses.length) {
      html += '<div style="padding:20px;text-align:center;color:var(--text-muted,#999)">' + esc(_t('no_scripture')) + '</div>';
      html += '</div>';
      return html;
    }

    if (chapter === 1) {
      var headerHtml = '';
      if (_toggles.showIntro && _introData) headerHtml += _renderMetadata(bookData, chapterData, bookIndex);
      if (_toggles.showTheme && _topicsData) headerHtml += _renderThemeText(chapterData, bookIndex);
      if (headerHtml) {
        html += '<div class="bible-header-section">' + headerHtml + '</div>';
      }
    }

    html += _renderVerses(chapterData, meta.acronym, chapter, bookIndex);
    html += '</div>';
    return html;
  }

  // ── 预缓存相邻章节数据并预渲染 HTML ──
  function _precachAdjacentChapters() {
    if (!_currentBook || !_currentChapter) return;

    var targets = [];

    // 上一章
    var prevBook = _currentBook, prevCh = _currentChapter - 1;
    if (prevCh < 1) {
      if (prevBook > 1) { prevBook--; prevCh = _getChapterCount(prevBook); }
    }
    if (prevCh >= 1) {
      if (!_bookDataCache[prevBook]) loadBookData(prevBook);
      targets.push({book: prevBook, chapter: prevCh});
    }

    // 下一章
    var nextBook = _currentBook, nextCh = _currentChapter + 1;
    var totalCh = _getChapterCount(nextBook);
    if (nextCh > totalCh) {
      if (nextBook < 66) { nextBook++; nextCh = 1; }
    }
    if (nextCh <= _getChapterCount(nextBook)) {
      if (!_bookDataCache[nextBook]) loadBookData(nextBook);
      targets.push({book: nextBook, chapter: nextCh});
    }

    // 先清理旧缓存（仅保留相邻章节）
    var keep = {};
    targets.forEach(function(t) {
      keep[t.book + ':' + t.chapter] = true;
    });
    Object.keys(_preRenderedHtml).forEach(function(bookKey) {
      var chapters = _preRenderedHtml[bookKey];
      Object.keys(chapters).forEach(function(chKey) {
        if (!keep[bookKey + ':' + chKey]) {
          delete chapters[chKey];
        }
      });
      if (Object.keys(chapters).length === 0) {
        delete _preRenderedHtml[bookKey];
      }
    });

    // Promise-based：等待所有 loadBookData 完成后再预渲染
    var loadPromises = targets.map(function(t) {
      if (!_bookDataCache[t.book]) {
        return loadBookData(t.book).then(function() {
          return t;
        });
      }
      return Promise.resolve(t);
    });

    Promise.all(loadPromises).then(function(loadedTargets) {
      loadedTargets.forEach(function(t) {
        if (!t) return;
        try {
          var html = _buildChapterInnerHtml(t.book, t.chapter);
          if (html) {
            if (!_preRenderedHtml[t.book]) _preRenderedHtml[t.book] = {};
            _preRenderedHtml[t.book][t.chapter] = html;
            // 预加载完成后，若滑动容器已存在且对应侧页尚为空，立即回填，
            // 避免首次左右滑动时看到白页预览（跨书相邻章异步加载场景）。
            _fillSidePageIfReady(t.book, t.chapter, html);
          }
        } catch(e) { /* ignore pre-render failures */ }
      });
    }).catch(function() { /* ignore pre-cache failures */ });

    // 把已异步加载完成的相邻章也立即回填到已存在的侧页（防止滑动中途白屏）
    _flushSidePages();
  }

  // ── 同步预填充相邻章（仅限数据已缓存的相邻章，用于滑动容器建立前的即时预渲染）──
  // 解决：renderBibleView 中 setupSlider() 早于 _precachAdjacentChapters() 执行，
  // 导致首次左右滑动时相邻页 _preRenderedHtml 尚为空 → 白页预览。
  // 同书相邻章（prev/next）数据已随本章一并加载，可同步渲染，无需等待异步。
  function _prefillAdjacentSync() {
    if (!_currentBook || !_currentChapter) return;
    var targets = [];

    var prevBook = _currentBook, prevCh = _currentChapter - 1;
    if (prevCh < 1) {
      if (prevBook > 1) { prevBook--; prevCh = _getChapterCount(prevBook); }
    }
    if (prevCh >= 1 && _bookDataCache[prevBook]) {
      targets.push({ book: prevBook, chapter: prevCh });
    }

    var nextBook = _currentBook, nextCh = _currentChapter + 1;
    var totalCh = _getChapterCount(nextBook);
    if (nextCh > totalCh) {
      if (nextBook < 66) { nextBook++; nextCh = 1; }
    }
    if (nextCh <= _getChapterCount(nextBook) && _bookDataCache[nextBook]) {
      targets.push({ book: nextBook, chapter: nextCh });
    }

    targets.forEach(function(t) {
      try {
        var html = _buildChapterInnerHtml(t.book, t.chapter);
        if (html) {
          if (!_preRenderedHtml[t.book]) _preRenderedHtml[t.book] = {};
          _preRenderedHtml[t.book][t.chapter] = html;
        }
      } catch (e) { /* ignore */ }
    });
  }

  // ── 若滑动容器已建立，将已预渲染的相邻章回填到对应侧页 ──
  function _fillSidePageIfReady(book, chapter, html) {
    try {
      var slider = document.getElementById('app') && document.getElementById('app').querySelector('.swipe-slider');
      if (!slider) return;
      var left = slider.querySelector('.left-page');
      var right = slider.querySelector('.right-page');
      if (!left && !right) return;
      var target = _resolveChapter(-1);
      if (left && target && target.book === book && target.chapter === chapter && !left.firstElementChild) {
        left.innerHTML = html;
        if (left.firstElementChild) {
          left.firstElementChild.style.position = 'relative';
          left.firstElementChild.style.top = '0';
        }
      }
      target = _resolveChapter(1);
      if (right && target && target.book === book && target.chapter === chapter && !right.firstElementChild) {
        right.innerHTML = html;
        if (right.firstElementChild) {
          right.firstElementChild.style.position = 'relative';
          right.firstElementChild.style.top = '0';
        }
      }
    } catch (e) { /* ignore */ }
  }

  // 在预加载完成后立即把已就绪的相邻章回填到已存在的侧页（兜底）
  function _flushSidePages() {
    try {
      var slider = document.getElementById('app') && document.getElementById('app').querySelector('.swipe-slider');
      if (!slider) return;
      var left = slider.querySelector('.left-page');
      var right = slider.querySelector('.right-page');
      var target, html;
      target = _resolveChapter(-1);
      if (left && target && !left.firstElementChild) {
        html = (_preRenderedHtml[target.book] && _preRenderedHtml[target.book][target.chapter]) || '';
        if (html) {
          left.innerHTML = html;
          if (left.firstElementChild) { left.firstElementChild.style.position = 'relative'; left.firstElementChild.style.top = '0'; }
        }
      }
      target = _resolveChapter(1);
      if (right && target && !right.firstElementChild) {
        html = (_preRenderedHtml[target.book] && _preRenderedHtml[target.book][target.chapter]) || '';
        if (html) {
          right.innerHTML = html;
          if (right.firstElementChild) { right.firstElementChild.style.position = 'relative'; right.firstElementChild.style.top = '0'; }
        }
      }
    } catch (e) { /* ignore */ }
  }

  // ══════════════════════════════════════════════════════════
  //  TTS 朗读状态检查：DOM 重建前停止朗读，避免引用失效
  // ══════════════════════════════════════════════════════════
  function _stopTTSIfPlaying() {
    if (window.CXSpeech && typeof window.CXSpeech.isSpeaking === 'function' && window.CXSpeech.isSpeaking()) {
      window.CXSpeech.cancel();
    }
  }

  // ══════════════════════════════════════════════════════════
  //  经文阅读视图
  // ══════════════════════════════════════════════════════════
  function renderBibleView(bookIndex, chapter, skipHistory) {
    var container = document.getElementById('app');
    if (!container) return;
    window._cxShowApp();

    // ── 渲染代守卫：防止快速导航时旧 Promise 回调覆盖新内容 ──
    var __gen = ++_renderGen;

    // 离开前保存当前章节滚动位置
    _flushScrollSave();

    _currentBook = bookIndex;
    _currentChapter = chapter;
    if (!skipHistory) addHistory(bookIndex, chapter);

    // 读取 session 记忆的滚动位置
    var _preScroll = _getScrollPos(bookIndex, chapter);

    // 重置容器样式，防止上一次渲染残留的 opacity:0 导致内容不可见
    container.style.opacity = '';
    container.style.transition = '';
    container.innerHTML = '<div class="bible-reading"><div style="padding:40px;text-align:center;color:var(--text-muted,#999)">' + esc(_t('loading')) + '</div></div>';

    // ── 安全兜底：无论数据加载成功/失败/超时，都确保启动屏关闭 ──
    var _splashGuard = setTimeout(function() {
      if (window._dismissSplash) window._dismissSplash();
    }, 6000);

    // ── 超时保护：防止 fetch 挂起导致页面永远停留在 loading 状态 ──
    var _timeoutPromise = new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error('LOAD_TIMEOUT')); }, LOAD_TIMEOUT_MS);
    });

    Promise.race([
      Promise.all([loadBooksMeta(), loadBookData(bookIndex), loadBibleTopics(), loadBibleIntro(), loadBibleOutlines()]),
      _timeoutPromise
    ]).then(function(results) {
      // ── 渲染代检查：过期渲染直接丢弃，不操作 DOM ──
      if (__gen !== _renderGen) return;

      var html = _buildChapterInnerHtml(bookIndex, chapter);
      if (html === null) {
        container.innerHTML = '<div class="bible-reading"><div style="padding:20px;text-align:center;color:var(--text-muted,#999)">' + esc(_t('no_scripture')) + '</div></div>';
        clearTimeout(_splashGuard);
        if (window._dismissSplash) window._dismissSplash();
        return;
      }

      // 确保 fixed 章节栏存在
      var chapterBar = document.getElementById('fixedChapterBar');
      if (!chapterBar) {
        chapterBar = document.createElement('div');
        chapterBar.id = 'fixedChapterBar';
        chapterBar.className = 'bible-chapter-bar';
        chapterBar.innerHTML = '<span class="chapter-bar-title"></span>';
        document.body.appendChild(chapterBar);
      }
      var meta = getBookMeta(bookIndex);
      var titleEl = chapterBar.querySelector('.chapter-bar-title');
      if (titleEl && meta) titleEl.textContent = meta.name + ' ' + chapter;
      chapterBar.style.display = '';

      // 更新页面标题
      if (meta) document.title = meta.name + ' ' + chapter;

      // 若有记忆位置，先隐藏容器防止闪屏
      if (_preScroll > 0) {
        container.style.opacity = '0';
        container.style.transition = '';
      }

      container.innerHTML = html;

      // 内容已渲染完成，此时再关闭启动屏，避免启动屏提前关闭露出空白内容区
      clearTimeout(_splashGuard);
      if (window._dismissSplash) window._dismissSplash();

      // ── 使用 try-finally 确保 opacity 一定恢复 ──
      // 冷启动时 _bindVerseEvents / CXSwipeSlider 等可能抛异常，
      // 若不保护则 container.style.opacity 永远停留在 '0'，表现为内容区空白。
      try {
        // 绑定注解/串珠点击事件
        _bindVerseEvents();

        // 绑定手势导航
        _initSwipeConfig();
        if (window.CXSwipeSlider) {
          // 先同步预填充同书相邻章（数据已随本章加载），确保 setupSlider 建立侧页时即有内容，
          // 避免首次左右滑动看到白页预览。
          _prefillAdjacentSync();
          CXSwipeSlider.bindSwipeGesture();
          CXSwipeSlider.setupSlider();
        }
      } catch(e) {
        console.error('[CXBible] 渲染后初始化异常:', e);
      } finally {
        // 恢复滚动位置或滚动到顶部
        // 注意：冷启动时 requestAnimationFrame 可能延迟或根本不执行（部分 Android WebView
        // 在页面尚未完全就绪时会挂起 RAF），导致 container.style.opacity 永远停留在 '0'，
        // 表现为标题栏/底部栏正常但内容区空白。故改为同步恢复 + setTimeout 兜底。
        if (_preScroll > 0) {
          try { window.scrollTo(0, _preScroll); } catch(e) {}
          container.style.transition = 'opacity 0.15s ease';
          container.style.opacity = '';
          // 安全兜底：无论 RAF 是否执行，确保 opacity 已恢复
          setTimeout(function() {
            container.style.opacity = '';
            container.style.transition = '';
          }, 100);
          // 关键修复：opacity 恢复后必须重新测量并修正 swipe-slider 高度。
          // 因为 setupSlider() 在 opacity:0 时测得 offsetHeight=0，
          // 导致 wrapper 被 height:0px + overflow:hidden 裁切成空白页。
          // 用双帧 rAF + setTimeout 双保险：部分 Android WebView 冷启动时 rAF 可能被挂起，
          // setTimeout 仍能触发，确保高度一定被修正。
          function _fixSliderHeight() {
            try {
              var slider = container.querySelector('.swipe-slider');
              if (!slider) return;
              var centerPage = slider.querySelector('.center-page');
              if (!centerPage) return;
              var realH = centerPage.offsetHeight || container.offsetHeight || window.innerHeight || 0;
              if (realH > 0 && Math.abs(realH - (parseInt(slider.style.height, 10) || 0)) > 1) {
                slider.style.height = realH + 'px';
              }
            } catch(e) {}
          }
          requestAnimationFrame(function() { requestAnimationFrame(_fixSliderHeight); });
          setTimeout(_fixSliderHeight, 150);
          setTimeout(_fixSliderHeight, 500);
        } else {
          container.style.opacity = '';
          container.style.transition = '';
          window.scrollTo(0, 0);
        }
      }

      // 设置滚动位置保存监听
      _setupScrollSave();

      // 注入朗读控制栏并初始化 CXSpeech
      if (meta) _initBibleSpeech(meta, chapter);

      // 预缓存相邻章节数据（滑动动画可立即使用）
      _precachAdjacentChapters();
    }).catch(function(err) {
      // ── 渲染代检查：过期渲染直接丢弃 ──
      if (__gen !== _renderGen) return;

      clearTimeout(_splashGuard);
      console.error('[CXBible] 加载失败:', err);
      if (window._dismissSplash) window._dismissSplash();

      // ⚠️ 关键修复：重置 opacity，否则上一次 then 回调设置的 opacity:0 会导致错误信息也不可见
      container.style.opacity = '';
      container.style.transition = '';

      var errMsg = (err && err.message === 'LOAD_TIMEOUT')
        ? _t('load_timeout') || '加载超时，请检查网络后重试'
        : _t('load_failed_retry') || '加载失败';
      container.innerHTML = '<div class="bible-reading">'
        + '<div style="padding:40px;text-align:center">'
        + '<div style="color:var(--danger-text,#c53030);margin-bottom:16px">' + esc(errMsg) + '</div>'
        + '<button onclick="window.CXBible&&CXBible.renderBibleView(' + bookIndex + ',' + chapter + ')" style="padding:8px 24px;border:1px solid var(--border,#ddd);border-radius:6px;background:var(--bg,#fff);cursor:pointer;font-size:0.875rem">' + esc(_t('retry') || '重试') + '</button>'
        + '</div></div>';
    });
  }

  // ── 元数据渲染 ──
  function _renderMetadata(bookData, chapterData, bookIndex) {
    if (!_introData) return '';
    var intro = _introData[String(bookIndex)];
    if (!intro) return '';

    // 类型编号到标签的映射
    var labelMap = {
      '1': '著者',
      '2': '著时',
      '3': '著地',
      '4': '受者',
      '5': '记载地点',
      '6': '涵盖时段',
      '7': '尽职时间',
      '8': '尽职地点',
      '9': '尽职对象'
    };

    var html = '<div class="bible-metadata">';
    var hasContent = false;

    // 获取当前书卷上下文，供 wrapRefs 识别括号内无书名的引用
    var ctxMeta = getBookMeta(bookIndex);
    var ctxStr = (ctxMeta && ctxMeta.acronym) ? ctxMeta.acronym : '';

    // 按类型编号顺序渲染
    var keys = Object.keys(intro).sort(function(a, b) { return parseInt(a) - parseInt(b); });
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var value = intro[key];
      if (!value) continue;

      // 从数据文本中提取标签和值
      // 数据格式如: "著者 摩西，..." 或 "著者 摩西（..."
      var parsed = _parseIntroLine(value, key, labelMap);
      if (!parsed) continue;

      html += '<div class="bible-metadata-item">';
      html += '<span class="meta-label">' + esc(parsed.label) + '</span>';
      var metaHtml = (window.CXRef && window.CXRef.wrapRefs) ? CXRef.wrapRefs(parsed.value, ctxStr) : esc(parsed.value);
      html += '<span class="meta-value">' + metaHtml + '</span>';
      html += '</div>';
      hasContent = true;
    }

    html += '</div>';
    return hasContent ? html : '';
  }

  // 解析书介数据行，提取标签和内容
  function _parseIntroLine(text, key, labelMap) {
    if (!text) return null;

    var label = labelMap[key] || '';
    if (!label) return null;

    // 数据格式: "著者 摩西，..." 或 "著者 摩西（..."
    // 标签后跟全角空格或普通空格，然后是内容
    var value = text;
    // 尝试去掉开头的标签部分（数据中的标签可能是全角空格分隔）
    var patterns = [
      new RegExp('^' + label + '[\\s ]+'),  // 标签+空格
      new RegExp('^' + label + ' ')
    ];
    for (var i = 0; i < patterns.length; i++) {
      if (patterns[i].test(value)) {
        value = value.replace(patterns[i], '');
        break;
      }
    }

    return { label: label, value: value };
  }

  // ── 主题摘要 ──
  function _renderThemeText(chapterData, bookIndex) {
    if (!_topicsData) return '';
    var topic = _topicsData[String(bookIndex)];
    if (!topic) return '';

    var html = '<div class="bible-theme-text">';
    html += '<span class="meta-label">主题</span>';
    var topicHtml = (window.CXRef && window.CXRef.wrapRefs) ? CXRef.wrapRefs(topic, '') : esc(topic);
    html += '<span class="theme-content">' + topicHtml + '</span>';
    html += '</div>';
    return html;
  }

  // ── 纲目 ──
  function _renderOutline(chapterData, bookIndex, chapter) {
    if (!_outlinesData) return '';
    var bookOutlines = _outlinesData[String(bookIndex)];
    if (!bookOutlines) return '';

    var items = bookOutlines[String(chapter)];
    if (!items || !items.length) return '';

    var html = '<div class="bible-outline">';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var level = item.level || 1;
      // 限制 level 范围，level 1-6 对应 outline-level-0 到 outline-level-5
      var cssLevel = Math.max(0, Math.min(level - 1, 5));
      html += '<div class="bible-outline-item outline-level-' + cssLevel + '">' + esc(item.text) + '</div>';
    }
    html += '</div>';
    return html;
  }

  // ── 获取某版本某章节的经文映射 (section -> verse) ──
  function _buildSectionMap(chapterObj) {
    var map = {};
    if (!chapterObj || !chapterObj.verses) return map;
    chapterObj.verses.forEach(function(v) {
      if (!map[v.section]) {
        map[v.section] = v;  // 第一条直接存储
      } else if (Array.isArray(map[v.section])) {
        map[v.section].push(v);
      } else {
        map[v.section] = [map[v.section], v];  // 第二条时转为数组
      }
    });
    return map;
  }

  function _findChapterData(bookData, chapter) {
    if (!bookData || !bookData.chapters) return null;
    for (var i = 0; i < bookData.chapters.length; i++) {
      if (bookData.chapters[i].chapter === chapter) return bookData.chapters[i];
    }
    return null;
  }

  // ── 获取版本显示标签 ──
  function _getVersionLabel(lang) {
    for (var i = 0; i < _availableVersions.length; i++) {
      if (_availableVersions[i].lang === lang) return _availableVersions[i].label;
    }
    return lang;
  }

  // ── 原文经文渲染（将 Strong's 标签转为可点击上标）──
  // 输入文本已经过 esc() HTML 转义，标签变为 &lt;W...&gt; 形式
  function _renderStrongText(text) {
    var escaped = esc(text);
    // Step 1: 形态码 WTH/WTG → morph-ref（不可点击的灰色上标）
    escaped = escaped.replace(/&lt;WT([HG])(\d+)&gt;/g, function(_, hg, num) {
      return '<sup class="morph-ref">' + hg + num + '</sup>';
    });
    // Step 2: Strong's 编号 WH/WAH/WG/WAG → sn-ref（可点击查词典）
    // 去除前导零以匹配词典键（如 H07225 → H7225）
    escaped = escaped.replace(/&lt;W(A?)([HG])(\d+)&gt;/g, function(_, a, hg, num) {
      var sn = hg + String(parseInt(num, 10));
      return '<sup class="sn-ref" data-sn="' + sn + '">' + hg + num + '</sup>';
    });
    return escaped;
  }

  // ── 纯原文渲染（去除所有 Strong's / 形态码标签）──
  function _stripStrongsTags(text) {
    return esc(text).replace(/&lt;W[^&]*&gt;/g, '').replace(/\{[^}]*\}/g, '').trim();
  }

  // ── 新格式原文渲染：将 (H7225 原文) / [H8804] 编号包装为可点击上标 ──
  // 适用于 he-el 词典版本（显示 Strong's 编号 + 原文）
  function _renderOrigInline(text) {
    var escaped = esc(text);
    // Strong's 编号 + 原文：(H7225 רֵאשׁית) → 可点击序号 + 原文词
    escaped = escaped.replace(/\(([HG])(\d+)([^)]*)\)/g, function(match, prefix, num, orig) {
      var sn = prefix + String(parseInt(num, 10));
      return '<sup class="sn-ref" data-sn="' + sn + '">' + prefix + num + '</sup>' + orig;
    });
    // 形态码：[H8804] → 不可点击的灰色上标
    escaped = escaped.replace(/\[([HG])(\d+)\]/g, function(match, prefix, num) {
      return '<sup class="morph-ref">' + prefix + num + '</sup>';
    });
    return escaped;
  }

  // ── 纯原文渲染：直接显示纯原文文字（数据已在导出阶段处理完毕）──
  // 适用于 he-orig 原文版本（纯原文文字 + 标点，无空格/编号/中文）
  function _renderPureOrig(text) {
    return esc(text);
  }

  // ── 从 zh-rcv content 提取纯圣经经文文本（剥离注解/串珠标记）──
  function _plainBibleText(content) {
    return (content || '').replace(/\{\d+\}/g, '').replace(/\[[a-z]+\]/g, '');
  }

  // ── 经文正文 ──
  function _renderVerses(chapterData, bookAcronym, chapter, bookIndex) {
    var html = '';
    var lastSection = -1;
    var isMultiVersion = _activeVersions.length > 1;

    // 构建辅助版本的 sectionMap: lang -> sectionMap
    var secondaryMaps = {};
    if (isMultiVersion) {
      _activeVersions.forEach(function(lang) {
        var bookData;
        if (lang === 'zh-rcv') {
          bookData = _bookDataCache[bookIndex];
        } else {
          var cache = _versionDataCache[lang];
          bookData = cache ? cache[bookIndex] : null;
        }
        var chData = _findChapterData(bookData, chapter);
        secondaryMaps[lang] = _buildSectionMap(chData);
      });
    }

    // ── 构建内联纲目映射 ──
    var outlineMap = {};  // verse index -> [outline items]
    if (_toggles.showOutline && _outlinesData) {
      var bookOutlines = _outlinesData[String(bookIndex)];
      var items = bookOutlines ? bookOutlines[String(chapter)] : null;
      if (items && items.length) {
        // 根据 outline 条目的 section/flag 精确匹配经文位置
        items.forEach(function(item) {
          var targetSec = item.section;
          var targetFlag = item.flag || 0;
          // 找到第一个匹配的 verse index
          for (var vi = 0; vi < chapterData.verses.length; vi++) {
            var v = chapterData.verses[vi];
            if (v.section === targetSec && (v.flag || 0) === targetFlag) {
              if (!outlineMap[vi]) outlineMap[vi] = [];
              outlineMap[vi].push(item);
              break;
            }
          }
        });
      }
    }

    chapterData.verses.forEach(function(verse, vIdx) {
      // ── 在 section 变化点前插入纲目（连续纲目合并为一个背景块） ──
      var outlineInserted = false;
      if (outlineMap[vIdx]) {
        var outlineItems = outlineMap[vIdx];
        if (outlineItems.length > 0) {
          outlineInserted = true;
          html += '<div class="bible-outline-inline-group">';
          for (var oi = 0; oi < outlineItems.length; oi++) {
            var item = outlineItems[oi];
            var cssLevel = Math.max(0, Math.min((item.level || 1) - 1, 5));
            html += '<div class="bible-outline-inline outline-level-' + cssLevel + '">' + esc(item.text) + '</div>';
          }
          html += '</div>';
        }
      }

      var sec = verse.section;
      var flag = verse.flag || 0;
      var content = verse.content || '';
      var isNewSection = sec !== lastSection;

      // 检查当前节是否含原文版本
      var verseHasOrig = false;
      if (isNewSection && isMultiVersion) {
        ['he-el', 'he-orig'].forEach(function(origLang) {
          if (_activeVersions.indexOf(origLang) !== -1) {
            var sm = secondaryMaps[origLang];
            if (sm && sm[sec]) verseHasOrig = true;
          }
        });
      }
      var verseClass = 'bible-verse' + (verseHasOrig ? ' bible-verse-has-orig' : '');

      // 节号渲染（半节与正常节统一样式）
      if (isNewSection && flag === 0) {
        if (lastSection !== -1 && _toggles.showVerseDivider && !outlineInserted) {
          html += '<hr class="verse-divider" />';
        }
        html += '<div class="' + verseClass + '" data-section="' + sec + '">';
        html += '<span class="verse-num">' + sec + '</span>';
      } else if (isNewSection && flag !== 0) {
        // 新节的第一个半节
        var subLabel = (flag === 1) ? '上' : (flag === 3 ? '中' : '下');
        if (lastSection !== -1 && _toggles.showVerseDivider && !outlineInserted) {
          html += '<hr class="verse-divider" />';
        }
        html += '<div class="' + verseClass + '" data-section="' + sec + '" data-flag="' + flag + '">';
        html += '<span class="verse-num">' + sec + subLabel + '</span>';
      } else if (flag !== 0) {
        // 同一节的后续半节
        var subLabel = (flag === 2) ? '下' : (flag === 3 ? '中' : '上');
        html += '<div class="bible-verse" data-section="' + sec + '" data-flag="' + flag + '">';
        html += '<span class="verse-num">' + sec + subLabel + '</span>';
      }

      // 经文内容
      if (isMultiVersion) {
        // 调和：确保所有激活版本都在 _langDisplayOrder 中
        _activeVersions.forEach(function(l) {
          if (_langDisplayOrder.indexOf(l) === -1) {
            _langDisplayOrder.push(l);
          }
        });
        var orderedAll = _langDisplayOrder.filter(function(l) {
          return _activeVersions.indexOf(l) !== -1;
        });
        // 按排序顺序渲染，第一个为 primary，其余为 secondary
        orderedAll.forEach(function(lang, langIdx) {
          var cssClass = (langIdx === 0) ? 'primary' : 'secondary';
          if (lang === 'zh-rcv') {
            // zh-rcv 始终用丰富渲染（注解/串珠）
            html += '<div class="bible-verse-lang ' + cssClass + '" data-lang="zh-rcv">';
            html += renderVerseText(content, bookAcronym, chapter, sec, flag);
            html += '</div>';
          } else if (isNewSection) {
            // 辅助版本仅在新节首条渲染
            var secMap = secondaryMaps[lang] || {};
            var secVerse = secMap[sec];
            if (secVerse) {
              var texts = Array.isArray(secVerse)
                ? secVerse.map(function(v) { return v.text; }).join('')
                : secVerse.text;
              if (texts) {
                var origContent = '';
                if (lang === 'he-el') {
                  // 词典版本：只显示 Strong's 编号 + 原文，不显示中文翻译
                  origContent = _renderOrigInline(texts);
                } else if (lang === 'he-orig') {
                  origContent = _renderPureOrig(texts);
                } else {
                  origContent = esc(texts);
                }
                html += '<div class="bible-verse-lang ' + cssClass + '" data-lang="' + esc(lang) + '">';
                html += origContent;
                html += '</div>';
              }
            }
          }
        });
      } else {
        html += '<div class="bible-verse-lang primary">';
        html += renderVerseText(content, bookAcronym, chapter, sec, flag);
        html += '</div>';
      }

      html += '</div>'; // bible-verse

      lastSection = sec;
    });

    return html;
  }

  // ── 注解文本（截取前200字+展开按钮）──
  function _renderFootnoteText(text) {
    if (!text) return '';
    var short = text.length > 300 ? text.slice(0, 300) + '…' : text;
    // 处理 ˍ 换行标记
    short = esc(short).replace(/ˍ/g, '<br>');
    return short;
  }

  // ── 串珠文本（将引用转为可点击链接）──
  function _renderBeadText(text) {
    if (!text) return '';
    var escaped = esc(text);
    // 简单处理：将中文经文引用用 span 包裹
    // 更精确的解析可复用 scripture-popup.js 的 REF_BOOK_RE
    if (window.CXRef && window.CXRef.wrapRefs) {
      return window.CXRef.wrapRefs(text, '', {});
    }
    return escaped;
  }

  // ── 绑定经文事件（事件委托，仅首次注册）──
  // 注解(.fn-ref)和串珠(.xref-ref)的点击由 scripture-popup.js 的 document 级事件委托统一处理
  function _bindVerseEvents() {
    if (_verseEventsBound) return;
    _verseEventsBound = true;
    // No-op: 所有经文上标点击已统一由 scripture-popup.js 处理
  }



  // ── 通用浮层（纲目 / 更多菜单等，复用 CX.openDialog）──
  function _showDetailOverlay(htmlContent, source, rawText) {
    var hideFooter = !rawText;
    var html = '<div class="verse-detail-card">'
      + '<div class="verse-detail-text">' + htmlContent + '</div>'
      + (hideFooter ? '' : '<div class="verse-detail-footer">'
      + '<span class="verse-detail-source">' + esc(source) + '</span>'
      + '<button class="verse-detail-copy">' + esc(_t('copy_all')) + '</button>'
      + '</div>')
      + '</div>';

    var dlg = window.CX.openDialog({
      id: 'verseDetailDialog',
      html: html
    });
    if (!dlg) return;

    // 复制
    var copyBtn = dlg.mask.querySelector('.verse-detail-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(rawText || '').then(function() {
            copyBtn.textContent = _t('copied');
            setTimeout(function() { copyBtn.textContent = _t('copy_all'); }, 1500);
          });
        } else {
          var ta = document.createElement('textarea');
          ta.value = rawText || '';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          copyBtn.textContent = _t('copied');
          setTimeout(function() { copyBtn.textContent = _t('copy_all'); }, 1500);
        }
      });
    }
  }

  // ══════════════════════════════════════════════════════════
  //  手势导航（左右滑动切换章节 — 使用 CXSwipeSlider 共享模块）
  // ══════════════════════════════════════════════════════════
  var _chapterCounts = {
    1:50,2:40,3:27,4:36,5:34,6:24,7:21,8:4,9:31,10:24,11:22,12:25,13:29,14:36,
    15:10,16:13,17:10,18:42,19:150,20:31,21:12,22:8,23:66,24:52,25:5,26:48,27:12,
    28:14,29:3,30:9,31:1,32:2,33:20,34:16,35:7,36:14,37:4,38:28,39:4,
    40:28,41:16,42:24,43:21,44:28,45:16,46:16,47:13,48:14,49:10,50:16,51:4,
    52:5,53:5,54:6,55:3,56:14,57:1,58:13,59:5,60:5,61:5,62:5,63:1,64:1,65:1,66:22
  };

  function _getChapterCount(bookIndex) {
    var cached = _bookDataCache[bookIndex];
    if (cached && cached.chapters) return cached.chapters.length;
    return _chapterCounts[bookIndex] || 10;
  }

  // 计算目标章节（返回 {book, chapter} 或 null）
  function _resolveChapter(delta) {
    if (!_currentBook || !_currentChapter) return null;
    var newBook = _currentBook;
    var newChapter = _currentChapter + delta;
    var totalChapters = _getChapterCount(newBook);
    if (newChapter > totalChapters) {
      if (newBook >= 66) return null;
      newBook++; newChapter = 1;
    } else if (newChapter < 1) {
      if (newBook <= 1) return null;
      newBook--; newChapter = _getChapterCount(newBook);
    }
    return { book: newBook, chapter: newChapter };
  }

  // 按钮调用的无动画导航
  function _navigateChapter(delta) {
    var target = _resolveChapter(delta);
    if (!target) return;
    window.CXRouter && window.CXRouter.navigate('bible/' + target.book + '/' + target.chapter);
  }

  // ── 滑动触发的导航（共享模块 touchEnd 调用）──
  function _animateSwipe(direction) {
    var target = _resolveChapter(direction);
    if (!target) return false;

    var container = document.getElementById('app');
    var wrapper = container ? container.querySelector('.swipe-slider') : null;
    if (!wrapper || !wrapper.querySelector('.center-page')) {
      // 无 slider，fallback 到路由导航
      window.CXRouter && window.CXRouter.navigate('bible/' + target.book + '/' + target.chapter);
      return true;
    }

    // 有 slider 时由共享模块处理动画，此处仅标记为需要动画
    return true;
  }

  // ── 滑动动画完成后的就地更新（共享模块 onSwipeComplete 回调）──
  function _animateSwipeCleanup(direction, centerEl, leftEl, rightEl, wrapper) {
    var target = _resolveChapter(direction);
    if (!target) return;

    _saveScrollPos(_currentBook, _currentChapter);

    var savedScroll = _getScrollPos(target.book, target.chapter);
    _currentBook = target.book;
    _currentChapter = target.chapter;
    addHistory(target.book, target.chapter);

    // ── 就地更新三页内容（不销毁/重建 slider）──
    var newCenterHtml = (_preRenderedHtml[target.book] && _preRenderedHtml[target.book][target.chapter])
      ? _preRenderedHtml[target.book][target.chapter]
      : _buildChapterInnerHtml(target.book, target.chapter);

    if (direction === 1) {
      // 左滑→下一章：centerEl 保持中页位置，赋目标内容
      if (newCenterHtml) centerEl.innerHTML = newCenterHtml;
      if (centerEl.firstElementChild) {
        centerEl.firstElementChild.style.position = '';
        centerEl.firstElementChild.style.top = '';
      }

      // leftEl = 上一章（带滚动偏移）
      var newPrev = _resolveChapter(-1);
      leftEl.innerHTML = (newPrev && ((_preRenderedHtml[newPrev.book] && _preRenderedHtml[newPrev.book][newPrev.chapter])
        || _buildChapterInnerHtml(newPrev.book, newPrev.chapter))) || '';
      var cs = newPrev ? _getScrollPos(newPrev.book, newPrev.chapter) : 0;
      if (leftEl.firstElementChild) {
        leftEl.firstElementChild.style.position = 'relative';
        leftEl.firstElementChild.style.top = cs > 0 ? -cs + 'px' : '';
      }

      // rightEl = 下一章（带滚动偏移）
      var newNext = _resolveChapter(1);
      rightEl.innerHTML = (newNext && ((_preRenderedHtml[newNext.book] && _preRenderedHtml[newNext.book][newNext.chapter])
        || _buildChapterInnerHtml(newNext.book, newNext.chapter))) || '';
      var ns = newNext ? _getScrollPos(newNext.book, newNext.chapter) : 0;
      if (rightEl.firstElementChild) {
        rightEl.firstElementChild.style.position = 'relative';
        rightEl.firstElementChild.style.top = ns > 0 ? -ns + 'px' : '';
      }
    } else {
      // 右滑→上一章：centerEl 保持中页位置，赋目标内容
      if (newCenterHtml) centerEl.innerHTML = newCenterHtml;
      if (centerEl.firstElementChild) {
        centerEl.firstElementChild.style.position = '';
        centerEl.firstElementChild.style.top = '';
      }

      // leftEl = 上一章（带滚动偏移）
      var newPrev = _resolveChapter(-1);
      leftEl.innerHTML = (newPrev && ((_preRenderedHtml[newPrev.book] && _preRenderedHtml[newPrev.book][newPrev.chapter])
        || _buildChapterInnerHtml(newPrev.book, newPrev.chapter))) || '';
      var ps = newPrev ? _getScrollPos(newPrev.book, newPrev.chapter) : 0;
      if (leftEl.firstElementChild) {
        leftEl.firstElementChild.style.position = 'relative';
        leftEl.firstElementChild.style.top = ps > 0 ? -ps + 'px' : '';
      }

      // rightEl = 下一章（带滚动偏移）
      var newNext = _resolveChapter(1);
      rightEl.innerHTML = (newNext && ((_preRenderedHtml[newNext.book] && _preRenderedHtml[newNext.book][newNext.chapter])
        || _buildChapterInnerHtml(newNext.book, newNext.chapter))) || '';
      var ns = newNext ? _getScrollPos(newNext.book, newNext.chapter) : 0;
      if (rightEl.firstElementChild) {
        rightEl.firstElementChild.style.position = 'relative';
        rightEl.firstElementChild.style.top = ns > 0 ? -ns + 'px' : '';
      }
    }

    [centerEl, leftEl, rightEl].forEach(function(el) {
      if (!el) return;
      el.style.transition = '';
      el.style.transform = '';
      el.style.willChange = '';
    });

    wrapper.style.height = centerEl.offsetHeight + 'px';
    window.scrollTo(0, savedScroll || 0);

    _setupScrollSave();

    var chapterBar = document.getElementById('fixedChapterBar');
    var meta = getBookMeta(target.book);
    if (chapterBar && meta) {
      var titleEl = chapterBar.querySelector('.chapter-bar-title');
      if (titleEl) titleEl.textContent = meta.name + ' ' + target.chapter;
    }
    if (meta) {
      document.title = meta.name + ' ' + target.chapter;
      _initBibleSpeech(meta, target.chapter);
    }

    _precachAdjacentChapters();

    var newHash = '#/bible/' + target.book + '/' + target.chapter;
    if (window.location.hash !== newHash) {
      try {
        history.replaceState(null, '', newHash);
      } catch(e) {
        if (window.CX && window.CX.backStack && window.CX.backStack.skipNext) window.CX.backStack.skipNext();
        window.location.hash = newHash;
      }
    }
    // 滑动翻页走 replaceState（不触发 hashchange），主动持久化当前页，
    // 确保 cx_last_page 与阅读历史同步，冷启动能恢复到最后翻到的章节。
    if (window.CXSavePage) { try { window.CXSavePage(); } catch (e) {} }
  }

  // ── 初始化共享滑动模块配置（每次渲染圣经页时调用，确保配置不被读经计划覆盖）──
  function _initSwipeConfig() {
    if (!window.CXSwipeSlider) return;
    CXSwipeSlider.init({
      containerId: 'app',
      contentSelector: '.bible-reading',
      ignoreSelectors: 'button, a, input, #verseDetailDialog, .bible-drawer, .more-menu',
      isPage: function() {
        return !document.body.classList.contains('cx-reading-plan-page');
      },
      resolveDelta: function(delta) {
        return _resolveChapter(delta);
      },
      getPreRenderedHtml: function(target) {
        return (_preRenderedHtml[target.book] && _preRenderedHtml[target.book][target.chapter]) || '';
      },
      buildSidePage: function(pageEl, html, target) {
        pageEl.innerHTML = html;
        var scrollPos = _getScrollPos(target.book, target.chapter);
        if (scrollPos > 0 && pageEl.firstElementChild) {
          pageEl.firstElementChild.style.position = 'relative';
          pageEl.firstElementChild.style.top = -scrollPos + 'px';
        }
      },
      getDamping: function(dx) {
        var atStart = (_currentBook <= 1 && _currentChapter <= 1 && dx > 0);
        var atEnd = (_currentBook >= 66 && _currentChapter >= _getChapterCount(66) && dx < 0);
        if (atStart || atEnd) return 0;
        return dx;
      },
      onTouchStart: function() {
        try {
          var prev = _resolveChapter(-1);
          var next = _resolveChapter(1);
          if (prev && !_bookDataCache[prev.book]) loadBookData(prev.book);
          if (next && !_bookDataCache[next.book]) loadBookData(next.book);
        } catch(e) { /* ignore */ }
      },
      onSwipeComplete: function(direction, centerEl, leftEl, rightEl, wrapper) {
        _animateSwipeCleanup(direction, centerEl, leftEl, rightEl, wrapper);
      }
    });
  }


  // ══════════════════════════════════════════════════════════
  //  更多菜单（侧面板模式，复用 .theme-panel 样式）
  // ══════════════════════════════════════════════════════════
  var _morePanelInited = false;
  var _morePanelInBackStack = false;

  function _ensureMorePanel() {
    if (_morePanelInited) return;
    _morePanelInited = true;
    // 创建遮罩层
    var moreOverlay = document.createElement('div');
    moreOverlay.className = 'theme-panel-overlay';
    moreOverlay.id = 'morePanelOverlay';
    moreOverlay.addEventListener('touchend', function(e) {
      e.preventDefault(); e.stopPropagation(); _toggleMorePanel();
    }, { passive: false });
    moreOverlay.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation(); _toggleMorePanel();
    });
    document.body.appendChild(moreOverlay);
    // 创建面板
    var morePanel = document.createElement('div');
    morePanel.className = 'theme-panel';
    morePanel.id = 'morePanel';
    document.body.appendChild(morePanel);
  }

  function _buildMorePanelHTML() {
    var html = '';
    // header
    html += '<div class="theme-panel-header">';
    html += '<div class="theme-panel-title">更多</div>';
    html += '<button class="theme-panel-close" onclick="window.CX._toggleMorePanel()">×</button>';
    html += '</div>';

    // ── 阅读工具 section ──
    html += '<div class="theme-section">';
    html += '<div class="theme-section-title">阅读工具</div>';
    html += '<div class="more-menu-item" data-action="charts" style="padding:10px 0;display:flex;align-items:center;gap:12px;font-size:0.813rem;cursor:pointer;border-bottom:1px solid var(--border,#eee)">';
    html += '<span style="font-size:1rem">📊</span><span>' + esc(_t('reading_stats')) + '</span></div>';
    html += '<div class="more-menu-item" data-action="illustrations" style="padding:10px 0;display:flex;align-items:center;gap:12px;font-size:0.813rem;cursor:pointer">';
    html += '<span style="font-size:1rem">🖼️</span><span>' + esc(_t('bible_illustrations')) + '</span></div>';
    html += '</div>';

    // ── 本书 section（条件显示）──
    if (_currentBook) {
      html += '<div class="theme-section">';
      html += '<div class="theme-section-title">本书</div>';
      html += '<div class="more-menu-item" data-action="bookIntro" style="padding:10px 0;display:flex;align-items:center;gap:12px;font-size:0.813rem;cursor:pointer;border-bottom:1px solid var(--border,#eee)">';
      html += '<span style="font-size:1rem">📖</span><span>' + esc(_t('view_book_intro')) + '</span></div>';
      html += '<div class="more-menu-item" data-action="bookOutline" style="padding:10px 0;display:flex;align-items:center;gap:12px;font-size:0.813rem;cursor:pointer">';
      html += '<span style="font-size:1rem">📋</span><span>' + esc(_t('view_book_outline')) + '</span></div>';
      html += '</div>';
    }

    // ── 帮助与支持 section ──
    var _ua = navigator.userAgent;
    var _isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    var _isAndroid = /Android/i.test(_ua);
    var _isIOS = /iPad|iPhone|iPod/.test(_ua) && !window.MSStream;
    var _isStandalone = (window.navigator.standalone === true) || window.matchMedia('(display-mode: standalone)').matches;

    html += '<div class="theme-section">';
    html += '<div class="theme-section-title">帮助与支持</div>';
    html += '<div class="more-menu-item" data-action="help" style="padding:10px 0;display:flex;align-items:center;gap:12px;font-size:0.813rem;cursor:pointer;border-bottom:1px solid var(--border,#eee)">';
    html += '<span style="font-size:1rem">📖</span><span>' + esc(_t('user_guide')) + '</span></div>';
    html += '<div class="more-menu-item" data-action="clearData" style="padding:10px 0;display:flex;align-items:center;gap:12px;font-size:0.813rem;cursor:pointer;border-bottom:1px solid var(--border,#eee)">';
    html += '<span style="font-size:1rem">🧹</span><span>清理数据</span></div>';
    html += '<div class="more-menu-item" data-action="feedback" style="padding:10px 0;display:flex;align-items:center;gap:12px;font-size:0.813rem;cursor:pointer';
    // 顾念微工条件
    var _showSponsor = false;
    try {
      var _firstUse = parseInt(localStorage.getItem('cx_first_use') || '0', 10);
      var _elapsed = _firstUse ? (Date.now() - _firstUse) : 0;
      if (_elapsed >= 5 * 60 * 1000) _showSponsor = true;
    } catch(e) {}
    html += _showSponsor ? ';border-bottom:1px solid var(--border,#eee)' : '';
    html += '">';
    html += '<span style="font-size:1rem">💬</span><span>问题反馈</span></div>';
    if (_showSponsor) {
      html += '<div class="more-menu-item" data-action="sponsor" style="padding:10px 0;display:flex;align-items:center;gap:12px;font-size:0.813rem;cursor:pointer">';
      html += '<span style="font-size:1rem">❤️</span><span>顾念微工</span></div>';
    }
    html += '</div>';

    // ── 安装与更新 section（条件显示）──
    var _showInstall = (_isIOS && !_isStandalone) || !_isCapacitor;
    var _showApk = _isAndroid && !_isCapacitor;
    var _showUpdate = _isCapacitor || (_isStandalone && ('caches' in window));
    if (_showInstall || _showApk || _showUpdate) {
      html += '<div class="theme-section">';
      html += '<div class="theme-section-title">安装与更新</div>';
      var _installItems = [];
      if (_showInstall) {
        _installItems.push('<div class="more-menu-item" data-action="install" style="padding:10px 0;display:flex;align-items:center;gap:12px;font-size:0.813rem;cursor:pointer">'
          + '<span style="font-size:1rem">📲</span><span>发送桌面</span></div>');
      }
      if (_showApk) {
        _installItems.push('<div class="more-menu-item" data-action="androidApk" style="padding:10px 0;display:flex;align-items:center;gap:12px;font-size:0.813rem;cursor:pointer">'
          + '<span style="font-size:1rem">📱</span><span>安卓APK</span></div>');
      }
      if (_showUpdate) {
        _installItems.push('<div class="more-menu-item" data-action="checkUpdate" style="padding:10px 0;display:flex;align-items:center;gap:12px;font-size:0.813rem;cursor:pointer">'
          + '<span style="font-size:1rem">🔄</span><span>检查更新</span></div>');
      }
      // 添加 border-bottom 到除最后一项外的所有项
      for (var i = 0; i < _installItems.length; i++) {
        if (i < _installItems.length - 1) {
          _installItems[i] = _installItems[i].replace('cursor:pointer"', 'cursor:pointer;border-bottom:1px solid var(--border,#eee)"');
        }
        html += _installItems[i];
      }
      html += '</div>';
    }

    // ── 偏好设置 section ──
    html += '<div class="theme-section">';
    html += '<div class="theme-section-title">偏好设置</div>';
    // 自动检查更新 toggle（条件显示）
    if (_isCapacitor || (_isStandalone && ('caches' in window))) {
      var _autoChecked = false;
      try { _autoChecked = localStorage.getItem('cx_auto_check_update') === '1'; } catch(e) {}
      html += '<div style="padding:10px 0;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border,#eee)">';
      html += '<div style="display:flex;align-items:center;gap:12px"><span style="font-size:1rem">⚙️</span><div>';
      html += '<div style="font-size:0.813rem">自动检查更新</div>';
      html += '</div></div>';
      html += '<label class="pref-toggle" style="position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0">';
      html += '<input type="checkbox" id="moreAutoCheckToggle"' + (_autoChecked ? ' checked' : '') + ' style="opacity:0;width:0;height:0">';
      html += '<span class="pref-toggle-slider" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;border-radius:24px;transition:.3s"></span>';
      html += '</label></div>';
    }
    // 开发者模式 toggle
    var _devChecked = false;
    try { _devChecked = localStorage.getItem('cx_dev_mode') === '1'; } catch(e) {}
    html += '<div style="padding:10px 0;display:flex;align-items:center;justify-content:space-between">';
    html += '<div style="display:flex;align-items:center;gap:12px"><span style="font-size:1rem">🔧</span><div>';
    html += '<div style="font-size:0.813rem">开发者模式</div>';
    html += '</div></div>';
    html += '<label class="pref-toggle" style="position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0">';
    html += '<input type="checkbox" id="moreDevModeToggle"' + (_devChecked ? ' checked' : '') + ' style="opacity:0;width:0;height:0">';
    html += '<span class="pref-toggle-slider" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;border-radius:24px;transition:.3s"></span>';
    html += '</label></div>';
    html += '</div>';

    return html;
  }

  function _closeMorePanelInternal() {
    var panel = document.getElementById('morePanel');
    var overlay = document.getElementById('morePanelOverlay');
    if (panel) panel.classList.remove('show');
    if (overlay) overlay.classList.remove('show');
    document.documentElement.classList.remove('cx-scroll-locked');
    document.body.classList.remove('cx-scroll-locked');
  }

  function _toggleMorePanel() {
    var panel = document.getElementById('morePanel');
    var overlay = document.getElementById('morePanelOverlay');
    if (!panel) return;
    var willShow = !panel.classList.contains('show');
    if (willShow) {
      // 重建 HTML（条件项可能变化）
      panel.innerHTML = _buildMorePanelHTML();
      _bindMorePanelEvents(panel);
      panel.classList.add('show');
      if (overlay) overlay.classList.add('show');
      document.documentElement.classList.add('cx-scroll-locked');
      document.body.classList.add('cx-scroll-locked');
      if (window.CX && window.CX.lockOverlayScroll) {
        window.CX.lockOverlayScroll(overlay, function() { _toggleMorePanel(); });
      }
      _morePanelInBackStack = true;
      window.CX.backStack.push(function() {
        _morePanelInBackStack = false;
        _closeMorePanelInternal();
      });
    } else {
      _closeMorePanelInternal();
      if (_morePanelInBackStack) {
        _morePanelInBackStack = false;
        window.CX.backStack.pop(true);
      }
    }
  }

  function _bindMorePanelEvents(panel) {
    // 菜单项点击
    var items = panel.querySelectorAll('.more-menu-item');
    items.forEach(function(item) {
      item.addEventListener('click', function() {
        var action = this.dataset.action;
        // 关闭面板
        _toggleMorePanel();
        // 延时执行动作
        setTimeout(function() {
          _executeMoreAction(action);
        }, 320);
      });
    });
    // 自动检查更新 toggle
    var autoToggle = panel.querySelector('#moreAutoCheckToggle');
    if (autoToggle) {
      autoToggle.addEventListener('change', function() {
        var on = this.checked;
        try {
          if (on) localStorage.setItem('cx_auto_check_update', '1');
          else localStorage.removeItem('cx_auto_check_update');
        } catch(e) {}
      });
    }
    // 开发者模式 toggle
    var devToggle = panel.querySelector('#moreDevModeToggle');
    if (devToggle) {
      devToggle.addEventListener('change', function() {
        var on = this.checked;
        try { localStorage.setItem('cx_dev_mode', on ? '1' : '0'); } catch(e) {}
        if (on && window.CXDevConsole) window.CXDevConsole.init();
        else if (!on && window.CXDevConsole) window.CXDevConsole.destroy();
      });
    }
  }

  function _executeMoreAction(action) {
    var _ua = navigator.userAgent;
    var _isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    var _isIOS = /iPad|iPhone|iPod/.test(_ua) && !window.MSStream;
    var _isStandalone = (window.navigator.standalone === true) || window.matchMedia('(display-mode: standalone)').matches;

    if (action === 'charts') {
      if (window.CXBible && CXBible.renderCharts) CXBible.renderCharts();
    } else if (action === 'illustrations') {
      if (window.CXBible && CXBible.renderIllustrations) CXBible.renderIllustrations();
    } else if (action === 'help') {
      _showDetailOverlay(
        '<div style="line-height:1.8;font-size:0.875rem">'
        + '<p>' + esc(_t('guide_books')) + '</p>'
        + '<p>' + esc(_t('guide_tts')) + '</p>'
        + '<p>' + esc(_t('guide_font')) + '</p>'
        + '<p>' + esc(_t('guide_outline')) + '</p>'
        + '<p>' + esc(_t('guide_fav')) + '</p>'
        + '</div>',
        _t('user_guide'),
        ''
      );
    } else if (action === 'bookIntro') {
      var introMeta = getBookMeta(_currentBook);
      function showBookIntro() {
        var introHtml = _renderMetadata(null, null, _currentBook);
        var introTitle = (introMeta.name || '') + ' - ' + _t('view_book_intro');
        if (introHtml) {
          var introRawText = introHtml.replace(/<[^>]*>/g, '').trim();
          _showDetailOverlay(introHtml, introTitle, introRawText);
        } else {
          _showDetailOverlay('<div style="padding:20px;text-align:center;color:var(--text-muted,#999)">' + esc(_t('no_data')) + '</div>', introTitle, '');
        }
      }
      if (_introData) {
        showBookIntro();
      } else {
        loadBibleIntro().then(showBookIntro);
      }
    } else if (action === 'bookOutline') {
      var outlineMeta = getBookMeta(_currentBook);
      function showBookOutline() {
        var outlineData = _outlinesData ? _outlinesData[String(_currentBook)] : null;
        var outlineHtml = '';
        if (outlineData) {
          var chapters = Object.keys(outlineData).sort(function(a, b) { return parseInt(a) - parseInt(b); });
          chapters.forEach(function(ch) {
            outlineHtml += '<div style="margin-bottom:12px">';
            outlineHtml += '<div style="font-weight:bold;font-size:0.938rem;margin-bottom:6px;color:var(--text,#333)">' + esc(_tf('chapter_n', {n: ch})) + '</div>';
            var items = outlineData[ch];
            if (Array.isArray(items)) {
              items.forEach(function(item) {
                var title = (typeof item === 'string') ? item : (item.title || item.text || '');
                var ref = (typeof item === 'object' && item.ref) ? item.ref : '';
                outlineHtml += '<div style="padding:4px 0 4px calc(2em + 4px);font-size:0.875rem;color:var(--text-secondary,#555)">';
                outlineHtml += esc(title);
                if (ref) outlineHtml += ' <span style="color:var(--text-muted,#999);font-size:0.75rem">(' + esc(ref) + ')</span>';
                outlineHtml += '</div>';
              });
            }
            outlineHtml += '</div>';
          });
        }
        if (!outlineHtml) {
          outlineHtml = '<div style="padding:20px;text-align:center;color:var(--text-muted,#999)">' + esc(_t('no_data')) + '</div>';
        }
        var outlineRawText = outlineHtml.replace(/<[^>]*>/g, '').trim();
        _showDetailOverlay(outlineHtml, (outlineMeta.name || '') + ' - ' + _t('view_book_outline'), outlineRawText);
      }
      if (_outlinesData) {
        showBookOutline();
      } else {
        loadBibleOutlines().then(showBookOutline);
      }
    } else if (action === 'clearData') {
      if (window.CX && window.CX.clearData) { window.CX.clearData(); }
      else if (window.CX && window.CX.showClearDialog) { window.CX.showClearDialog(); }
    } else if (action === 'install') {
      if (_isIOS && !_isStandalone) {
        if (window.CX && window.CX.installIOS) { window.CX.installIOS(); }
      } else {
        if (window.CX && window.CX.installPWA) { window.CX.installPWA(); return; }
        var p = window._pwaInstallPrompt;
        if (p) {
          window._pwaInstallPrompt = null;
          p.prompt();
        }
      }
    } else if (action === 'androidApk') {
      if (window.CX && window.CX.downloadApk) { window.CX.downloadApk(); }
      else {
        var root = window.CX_ROOT || './';
        fetch(root + 'version.json?t=' + Date.now(), { cache: 'no-cache' })
          .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function(v) {
            var f = v.apk_file || ('bible-v' + (v.apk_version || v.version) + '.apk');
            window.open(root + f, '_blank');
          })
          .catch(function(e) { alert('获取失败: ' + e.message); });
      }
    } else if (action === 'checkUpdate') {
      if (_isCapacitor && window.AppUpdate && window.AppUpdate.showCloudflareUpdateDialog) {
        window.AppUpdate.showCloudflareUpdateDialog();
      } else if (window.AppUpdate && window.AppUpdate.showPwaUpdateDialog) {
        window.AppUpdate.showPwaUpdateDialog({ root: window.CX_ROOT || './' });
      }
    } else if (action === 'feedback') {
      if (window.CX && window.CX.showFeedbackDialog) window.CX.showFeedbackDialog();
    } else if (action === 'sponsor') {
      if (window.CX && window.CX.showSponsorDialog) window.CX.showSponsorDialog();
    }
  }

  function showMore() {
    _ensureMorePanel();
    _toggleMorePanel();
  }

  // ══════════════════════════════════════════════════════════
  //  设置面板
  // ══════════════════════════════════════════════════════════
  function renderSettings() {
    var container = document.getElementById('app');
    if (!container) return;
    window._cxShowApp();
    _hideBibleSpeechBar();
    var chapterBar = document.getElementById('fixedChapterBar');
    if (chapterBar) chapterBar.style.display = 'none';
  
    // 确保版本元数据已加载
    loadVersionsMeta().then(function() {
      _renderSettingsInner(container);
    });
  }
  
  function _renderSettingsInner(container) {
    var html = '<div class="settings-panel">';
    html += '<button class="bible-back-btn" onclick="window.CXRouter&&CXRouter.navigate(\'\')">' + esc(_t('back')) + '</button>';
    html += '<h2 style="text-align:center;margin:12px 0 20px;color:var(--heading,#2C1810)">' + esc(_t('settings')) + '</h2>';
  
    // 主题选择
    html += '<div class="settings-section">';
    html += '<div class="settings-section-title">' + esc(_t('reading_theme')) + '</div>';
    html += '<div class="theme-selector">';
    var themes = [
      { value: 'gray-white', label: _t('theme_gray_white') },
      { value: 'light-yellow', label: _t('theme_light_yellow') },
      { value: 'warm-yellow', label: _t('theme_warm_yellow') },
      { value: 'dark-gray', label: _t('theme_dark_gray') },
      { value: 'night', label: _t('theme_night') }
    ];
    var currentTheme = '';
    try { currentTheme = localStorage.getItem('readingTheme') || 'gray-white'; } catch(e) { currentTheme = 'gray-white'; }
    themes.forEach(function(t) {
      html += '<div class="theme-swatch' + (currentTheme === t.value ? ' active' : '') + '" data-theme-value="' + t.value + '">' + t.label + '</div>';
    });
    html += '</div></div>';
  
    // 字号滑块
    var fontSize = 18;
    try { fontSize = parseInt(localStorage.getItem('bibleFontSize') || '18'); } catch(e) {}
    html += '<div class="settings-section">';
    html += '<div class="settings-section-title">' + esc(_t('font_size')) + '</div>';
    html += '<div class="font-size-slider-container">';
    html += '<span class="slider-label small">A</span>';
    html += '<input type="range" class="font-size-slider" min="14" max="28" value="' + fontSize + '" id="bibleFontSizeSlider" />';
    html += '<span class="slider-label large">A</span>';
    html += '</div></div>';
  
    // 显示语言 checkbox 组
    if (_availableVersions.length > 0) {
      html += '<div class="settings-section">';
      html += '<div class="settings-section-title">' + esc(_t('display_languages')) + '</div>';
      html += '<div class="language-checkboxes">';
      var _kjvActive = _activeVersions.indexOf('en-kjv') !== -1;
      _availableVersions.forEach(function(ver) {
        // he-orig 和 he-el 均仅 KJV 激活时可选
        if ((ver.lang === 'he-orig' || ver.lang === 'he-el') && !_kjvActive) return;
        var isActive = _activeVersions.indexOf(ver.lang) !== -1;
        html += '<label class="language-checkbox">';
        html += '<input type="checkbox" data-lang="' + esc(ver.lang) + '"';
        if (isActive) html += ' checked';
        if (!isActive && _activeVersions.length >= 6) html += ' disabled';
        html += ' />';
        // 优先使用 i18n 翻译的版本名，fallback 到 ver.label
        var _verKey = 'version_' + ver.lang.replace(/-/g, '_');
        var _verLabel = (window.CXI18n && window.CXI18n.t) ? window.CXI18n.t(_verKey) : ver.lang;
        if (_verLabel === _verKey) _verLabel = ver.label; // key 不存在时 fallback
        html += '<span>' + esc(_verLabel) + '</span>';
        
        html += '</label>';
      });
      html += '</div></div>';
    }
  
    // ── 语言版本信息（所有版本已内置，无需下载）──
    if (_availableVersions.length > 1) {
      html += '<div class="settings-section">';
      html += '<div class="settings-section-title">' + esc(_t('lang_pack_manager')) + '</div>';
      html += '<div class="lang-pack-list" id="langPackList">';
      _availableVersions.forEach(function(ver) {
        var verKey = 'version_' + ver.lang.replace(/-/g, '_');
        var verLabel = _t(verKey);
        if (verLabel === verKey) verLabel = ver.label;
        html += '<div class="lang-pack-item" data-lang="' + esc(ver.lang) + '">';
        html += '<div class="lang-pack-info">';
        html += '<span class="lang-pack-name">' + esc(verLabel) + '</span>';
        html += '<span class="lang-badge bundled">' + esc(_t('lang_pack_bundled')) + '</span>';
        html += '</div></div>';
      });
      html += '</div></div>';
    }

    // 显示顺序（当有 2 个以上激活版本时显示）
    if (_activeVersions.length > 1) {
      html += '<div class="settings-section">';
      html += '<div class="settings-section-title">' + esc(_t('lang_display_order')) + '</div>';
      html += '<div class="lang-order-hint" style="font-size:0.75em;color:var(--text-muted,#999);padding:0 12px 8px">' + esc(_t('lang_display_order_hint')) + '</div>';
      html += '<div class="lang-order-list">';
      // 按当前排序显示
      var orderedAll = _langDisplayOrder.filter(function(l) { return _activeVersions.indexOf(l) !== -1; });
      orderedAll.forEach(function(lang, idx) {
        var verKey = 'version_' + lang.replace(/-/g, '_');
        var verLabel = _t(verKey);
        if (verLabel === verKey) {
          for (var ai = 0; ai < _availableVersions.length; ai++) {
            if (_availableVersions[ai].lang === lang) { verLabel = _availableVersions[ai].label; break; }
          }
        }
        html += '<div class="lang-order-item" data-lang="' + esc(lang) + '" data-idx="' + idx + '">';
        html += '<span class="lang-order-name">' + esc(verLabel) + '</span>';
        html += '<div class="lang-order-btns">';
        if (idx > 0) html += '<button class="lang-order-btn lang-move-up-btn" data-lang="' + esc(lang) + '" data-dir="up">↑ ' + esc(_t('lang_move_up')) + '</button>';
        if (idx < orderedAll.length - 1) html += '<button class="lang-order-btn lang-move-down-btn" data-lang="' + esc(lang) + '" data-dir="down">↓ ' + esc(_t('lang_move_down')) + '</button>';
        html += '</div></div>';
      });
      html += '</div></div>';
    }
  
    // 内容开关
    html += '<div class="settings-section">';
    html += '<div class="settings-section-title">' + esc(_t('display_content')) + '</div>';
    html += '<div class="content-toggles">';
    var toggleItems = [
      { key: 'showVerseDivider', label: _t('toggle_divider') }
    ];
    toggleItems.forEach(function(item) {
      html += '<div class="content-toggle">';
      html += '<span class="content-toggle-label">' + esc(item.label) + '</span>';
      html += '<label class="toggle-switch">';
      html += '<input type="checkbox" data-toggle="' + item.key + '"' + (_toggles[item.key] ? ' checked' : '') + ' />';
      html += '<span class="toggle-slider"></span>';
      html += '</label>';
      html += '</div>';
    });
    html += '</div></div>';
  
    html += '</div>';
    container.innerHTML = html;
  
    _bindSettingsEvents();
  }

  function _bindSettingsEvents() {
    // 主题切换
    document.querySelectorAll('.theme-swatch').forEach(function(swatch) {
      swatch.addEventListener('click', function() {
        var theme = this.dataset.themeValue;
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem('readingTheme', theme); } catch(e) {}
        document.querySelectorAll('.theme-swatch').forEach(function(s) { s.classList.remove('active'); });
        this.classList.add('active');
        // 同步更新 meta theme-color
        var metaTheme = document.querySelector('meta[name="theme-color"]');
        var colorMap = {
          'gray-white': '#FAF8F5',
          'light-yellow': '#F8ECD0',
          'warm-yellow': '#F6F3EB',
          'dark-gray': '#3A3835',
          'night': '#1C1A17'
        };
        if (metaTheme) metaTheme.setAttribute('content', colorMap[theme] || '#FFFFFF');
      });
    });

    // 字号滑块
    var slider = document.getElementById('bibleFontSizeSlider');
    if (slider) {
      slider.addEventListener('input', function() {
        var size = parseInt(this.value);
        document.documentElement.style.setProperty('--bible-font-size', size + 'px');
        try {
          localStorage.setItem('bibleFontSize', String(size));
          localStorage.setItem('globalFontSize', String(size));
        } catch(e) {}
      });
    }

    // 内容开关
    document.querySelectorAll('[data-toggle]').forEach(function(input) {
      input.addEventListener('change', function() {
        var key = this.dataset.toggle;
        _toggles[key] = this.checked;
        saveToggles();
        // 切换后立即重新渲染当前阅读视图
        if (_currentBook && _currentChapter) {
          renderBibleView(_currentBook, _currentChapter, true);
        }
      });
    });

    // 语言 checkbox 变更（所有版本已内置，直接切换显示）
    document.querySelectorAll('.language-checkbox input[data-lang]').forEach(function(input) {
      input.addEventListener('change', function() {
        var lang = this.dataset.lang;
        var idx = _activeVersions.indexOf(lang);
        if (this.checked && idx === -1) {
          if (_activeVersions.length >= 6) {
            this.checked = false;
            return;
          }
          _activeVersions.push(lang);
        } else if (!this.checked && idx !== -1) {
          _activeVersions.splice(idx, 1);
        }
        // KJV 取消激活时，自动移除 he-orig 和 he-el（均依赖 KJV）
        if (lang === 'en-kjv' && !this.checked) {
          ['he-orig', 'he-el'].forEach(function(origLang) {
            var origIdx = _activeVersions.indexOf(origLang);
            if (origIdx !== -1) {
              _activeVersions.splice(origIdx, 1);
              var orderIdx2 = _langDisplayOrder.indexOf(origLang);
              if (orderIdx2 !== -1) _langDisplayOrder.splice(orderIdx2, 1);
            }
          });
          saveLangDisplayOrder();
        }
        saveActiveVersions();
        // 同步排序列表
        if (this.checked && _langDisplayOrder.indexOf(lang) === -1) {
          _langDisplayOrder.push(lang);
        } else if (!this.checked) {
          var orderIdx = _langDisplayOrder.indexOf(lang);
          if (orderIdx !== -1) _langDisplayOrder.splice(orderIdx, 1);
        }
        saveLangDisplayOrder();
        // 版本可见性可能变化（he-orig/he-el 依赖 KJV），重新渲染设置面板
        _renderSettingsInner(document.getElementById('app'));
        // 若当前在阅读页，停止朗读后重新加载数据并刷新视图（不记录历史）
        _stopTTSIfPlaying();
        if (_currentBook && _currentChapter) {
          renderBibleView(_currentBook, _currentChapter, true);
        }
      });
    });

    // 语言排序按钮
    document.querySelectorAll('.lang-order-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var lang = this.dataset.lang;
        var dir = this.dataset.dir;
        var idx = _langDisplayOrder.indexOf(lang);
        if (idx === -1) return;
        if (dir === 'up' && idx > 0) {
          // 与上一个交换
          var tmp = _langDisplayOrder[idx - 1];
          _langDisplayOrder[idx - 1] = _langDisplayOrder[idx];
          _langDisplayOrder[idx] = tmp;
        } else if (dir === 'down' && idx < _langDisplayOrder.length - 1) {
          // 与下一个交换
          var tmp = _langDisplayOrder[idx + 1];
          _langDisplayOrder[idx + 1] = _langDisplayOrder[idx];
          _langDisplayOrder[idx] = tmp;
        }
        saveLangDisplayOrder();
        // 刷新设置面板 UI
        _renderSettingsInner(document.getElementById('app'));
        // 若当前在阅读页，停止朗读后刷新视图
        _stopTTSIfPlaying();
        if (_currentBook && _currentChapter) {
          renderBibleView(_currentBook, _currentChapter, true);
        }
      });
    });

    // 语言版本已全部内置，无需下载/删除操作
  }

  // ══════════════════════════════════════════════════════════
  //  图表列表 / 读经计划（预留接口）
  // ══════════════════════════════════════════════════════════
  function renderCharts() {
    var container = document.getElementById('app');
    if (!container) return;
    window._cxShowApp();
    _hideBibleSpeechBar(); // 离开圣经视图时隐藏朗读栏
    var chapterBar = document.getElementById('fixedChapterBar');
    if (chapterBar) chapterBar.style.display = 'none';

    // 从历史读取数据
    loadHistory();
    var hist = _history;

    var html = '<div class="bible-reading">';
    html += '<button class="bible-back-btn" onclick="window.CXRouter&&CXRouter.navigate(\'\')">' + esc(_t('back')) + '</button>';
    html += '<h2 style="text-align:center;margin:12px 0 20px;color:var(--heading,#2C1810)">' + esc(_t('reading_stats')) + '</h2>';

    if (!hist.length) {
      html += '<div style="padding:40px 20px;text-align:center;color:var(--text-muted,#999)">'
        + '<div style="font-size:2rem;margin-bottom:12px">📊</div>'
        + '<div>' + esc(_t('no_reading_history')) + '</div>'
        + '<div style="margin-top:8px;font-size:0.813rem">' + esc(_t('stats_hint')) + '</div>'
        + '</div>';
      html += '</div>';
      container.innerHTML = html;
      return;
    }

    // 统计：已读书卷、总章节数
    var uniqueBookSet = {};
    hist.forEach(function(h) { uniqueBookSet[h.bookIndex] = true; });
    var uniqueBooks = Object.keys(uniqueBookSet).length;
    var totalChapters = hist.length;

    // 书签数（尝试获取）
    var bookmarkCount = 0;
    try {
      var favs = _getFavorites();
      bookmarkCount = favs.length;
    } catch(e) {}

    // 统计卡片
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:0 16px;margin-bottom:20px">';
    html += '<div style="background:var(--card,#fff);border-radius:12px;padding:16px 8px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.06)">';
    html += '<div style="font-size:1.333rem;font-weight:700;color:var(--brand,#8B4513)">' + uniqueBooks + '</div>';
    html += '<div style="font-size:0.75rem;color:var(--text-muted,#999);margin-top:4px">' + esc(_t('books_read')) + '</div></div>';
    html += '<div style="background:var(--card,#fff);border-radius:12px;padding:16px 8px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.06)">';
    html += '<div style="font-size:1.333rem;font-weight:700;color:var(--brand,#8B4513)">' + totalChapters + '</div>';
    html += '<div style="font-size:0.75rem;color:var(--text-muted,#999);margin-top:4px">' + esc(_t('chapters_read')) + '</div></div>';
    html += '<div style="background:var(--card,#fff);border-radius:12px;padding:16px 8px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.06)">';
    html += '<div style="font-size:1.333rem;font-weight:700;color:var(--brand,#8B4513)">' + bookmarkCount + '</div>';
    html += '<div style="font-size:0.75rem;color:var(--text-muted,#999);margin-top:4px">' + esc(_t('fav_chapters')) + '</div></div>';
    html += '</div>';

    // 最近 7 天阅读日历
    var today = new Date();
    var dayLabels = _t('day_labels').split(',');
    var dayCounts = [0,0,0,0,0,0,0];
    hist.forEach(function(h) {
      var d = new Date(h.time);
      for (var di = 0; di < 7; di++) {
        var refDate = new Date(today);
        refDate.setDate(today.getDate() - (6 - di));
        if (d.getFullYear() === refDate.getFullYear() && d.getMonth() === refDate.getMonth() && d.getDate() === refDate.getDate()) {
          dayCounts[di]++;
          break;
        }
      }
    });
    html += '<div style="padding:0 16px;margin-bottom:20px">';
    html += '<div style="font-size:0.875rem;font-weight:600;color:var(--heading,#2C1810);margin-bottom:10px">' + esc(_t('last_7_days')) + '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;text-align:center">';
    for (var di = 0; di < 7; di++) {
      var refDate = new Date(today);
      refDate.setDate(today.getDate() - (6 - di));
      var dayLabel = dayLabels[refDate.getDay()];
      var count = dayCounts[di];
      var bgColor = count > 0 ? 'var(--brand,#8B4513)' : 'var(--border,#e8e0d0)';
      var textColor = count > 0 ? '#fff' : 'var(--text-muted,#999)';
      html += '<div style="border-radius:8px;padding:8px 4px;background:' + bgColor + ';color:' + textColor + '">';
      html += '<div style="font-size:0.688rem;opacity:.8">' + dayLabel + '</div>';
      html += '<div style="font-size:1rem;font-weight:600;margin-top:4px">' + count + '</div>';
      html += '</div>';
    }
    html += '</div></div>';

    // 旧约/新约进度条
    var otBooks = {};
    var ntBooks = {};
    hist.forEach(function(h) {
      if (h.bookIndex <= 39) otBooks[h.bookIndex] = true;
      else ntBooks[h.bookIndex] = true;
    });
    var otCount = Object.keys(otBooks).length;
    var ntCount = Object.keys(ntBooks).length;
    var otPct = Math.round(otCount / 39 * 100);
    var ntPct = Math.round(ntCount / 27 * 100);

    html += '<div style="padding:0 16px">';
    html += '<div style="font-size:0.875rem;font-weight:600;color:var(--heading,#2C1810);margin-bottom:12px">' + esc(_t('reading_progress')) + '</div>';

    html += '<div style="margin-bottom:14px">';
    html += '<div style="display:flex;justify-content:space-between;font-size:0.813rem;margin-bottom:6px">';
    html += '<span style="color:var(--text,#333)">' + esc(_t('old_testament')) + '</span><span style="color:var(--text-muted,#999)">' + otCount + '/39 ' + esc(_t('books_unit')) + ' (' + otPct + '%)</span></div>';
    html += '<div style="height:8px;background:var(--border,#e8e0d0);border-radius:4px;overflow:hidden">';
    html += '<div style="height:100%;width:' + otPct + '%;background:var(--brand,#8B4513);border-radius:4px;transition:width .3s"></div></div></div>';

    html += '<div style="margin-bottom:14px">';
    html += '<div style="display:flex;justify-content:space-between;font-size:0.813rem;margin-bottom:6px">';
    html += '<span style="color:var(--text,#333)">' + esc(_t('new_testament')) + '</span><span style="color:var(--text-muted,#999)">' + ntCount + '/27 ' + esc(_t('books_unit')) + ' (' + ntPct + '%)</span></div>';
    html += '<div style="height:8px;background:var(--border,#e8e0d0);border-radius:4px;overflow:hidden">';
    html += '<div style="height:100%;width:' + ntPct + '%;background:var(--brand,#8B4513);border-radius:4px;transition:width .3s"></div></div></div>';

    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
  }

  // ══════════════════════════════════════════════════════════
  //  圣经插图
  // ══════════════════════════════════════════════════════════
  function renderIllustrations() {
    var container = document.getElementById('app');
    if (!container) return;
    window._cxShowApp();
    _hideBibleSpeechBar();
    var chapterBar = document.getElementById('fixedChapterBar');
    if (chapterBar) chapterBar.style.display = 'none';

    var illustrations = [
      { file: '18.webp', title: '神新约的经纶' },
      { file: 'br.webp', title: '诸天国度分别图' },
      { file: 'EO.webp', title: '旧约远古近东地区' },
      { file: 'kE.webp', title: '保罗的行程' },
      { file: 'KR.webp', title: '七十个七与基督来临' },
      { file: 'Mr.webp', title: '新约时代的巴勒斯坦' },
      { file: 'NW.webp', title: '兽的数字' },
      { file: 'O9.webp', title: '旧约时代的以色列' },
      { file: 'XJ.webp', title: '耶稣基督的谱系' }
    ];

    var root = getRoot();
    var allUrls = illustrations.map(function(item) { return root + 'img/' + item.file; });

    var html = '<div class="bible-reading">';
    html += '<button class="bible-back-btn" onclick="window.CXRouter&&CXRouter.navigate(\'\')">' + esc(_t('back')) + '</button>';
    html += '<h2 style="text-align:center;margin:12px 0 8px;color:var(--heading,#2C1810)">' + esc(_t('bible_illustrations')) + '</h2>';
    html += '<div style="text-align:center;font-size:0.813rem;color:var(--text-muted,#999);margin-bottom:16px">' + esc(_t('illustrations_hint')) + '</div>';

    html += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:0 16px">';
    for (var i = 0; i < illustrations.length; i++) {
      html += '<div class="illust-card" data-idx="' + i + '" style="background:var(--card,#fff);border-radius:12px;overflow:hidden;padding-bottom:8px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.06)">';
      html += '<img src="' + root + 'img/' + illustrations[i].file + '" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px 8px 0 0;display:block" alt="' + esc(illustrations[i].title) + '">';
      html += '<div style="font-size:0.813rem;text-align:center;margin-top:6px;color:var(--text,#333);padding:0 6px">' + esc(illustrations[i].title) + '</div>';
      html += '</div>';
    }
    html += '</div>';
    html += '</div>';
    container.innerHTML = html;

    // 绑定点击事件
    var cards = container.querySelectorAll('.illust-card');
    cards.forEach(function(card) {
      card.addEventListener('click', function() {
        var idx = parseInt(this.dataset.idx, 10);
        if (window.CX && CX.ImageViewer && CX.ImageViewer.open) {
          CX.ImageViewer.open(allUrls[idx], allUrls, idx);
        }
      });
    });
  }

  function renderReadingPlan(planId) {
    var container = document.getElementById('app');
    if (!container) return;
    window._cxShowApp();
    var chapterBar = document.getElementById('fixedChapterBar');
    if (chapterBar) chapterBar.style.display = 'none';

    container.innerHTML = '<div class="bible-reading">'
      + '<button class="bible-back-btn" onclick="window.CXRouter&&CXRouter.navigate(\'\')">' + esc(_t('back')) + '</button>'
      + '<h2 style="text-align:center;margin:20px 0;color:var(--heading,#2C1810)">' + esc(_t('reading_plan')) + '</h2>'
      + '<div style="padding:20px;text-align:center;color:var(--text-muted,#999)">' + esc(_t('loading')) + '</div>'
      + '</div>';

    fetch(_buildFetchUrl('data/reading-plans.json'))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var plan = null;
        if (data.plans) {
          for (var i = 0; i < data.plans.length; i++) {
            if (data.plans[i].id === planId) {
              plan = data.plans[i];
              break;
            }
          }
        }
        if (!plan) {
          container.querySelector('.bible-reading > div:last-child').textContent = _t('plan_not_found_msg');
          return;
        }
        var html = '<div class="bible-reading">';
        html += '<button class="bible-back-btn" onclick="window.CXRouter&&CXRouter.navigate(\'\')">' + esc(_t('back')) + '</button>';
        html += '<h2 style="text-align:center;margin:20px 0;color:var(--heading,#2C1810)">' + esc(plan.name) + '</h2>';
        if (plan.entries && plan.entries.length) {
          plan.entries.forEach(function(entry, idx) {
            html += '<div class="chapter-list-item">' + esc(typeof entry === 'string' ? entry : JSON.stringify(entry)) + '</div>';
          });
        } else {
          html += '<div style="padding:20px;text-align:center;color:var(--text-muted,#999)">' + esc(_t('no_plan_content')) + '</div>';
        }
        html += '</div>';
        container.innerHTML = html;
      })
      .catch(function() {
        container.querySelector('.bible-reading > div:last-child').textContent = _t('load_failed');
      });
  }

  // ══════════════════════════════════════════════════════════
  //  初始化
  // ══════════════════════════════════════════════════════════
  function init() {
    if (_initDone) { console.log('[CXBible] init() skipped (already initialized)'); return; }
    _initDone = true;
    console.log('[CXBible] init() — loading history from localStorage');
    loadToggles();
    loadHistory();
    console.log('[CXBible] history loaded: ' + _history.length + ' entries' + (_history[0] ? ', latest=bible/' + _history[0].bookIndex + '/' + _history[0].chapter : ''));

    // 应用保存的主题
    var savedTheme = null;
    try { savedTheme = localStorage.getItem('readingTheme'); } catch(e) {}
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
    }

    // 应用保存的字号
    var savedFontSize = null;
    try { savedFontSize = localStorage.getItem('bibleFontSize'); } catch(e) {}
    if (savedFontSize) {
      document.documentElement.style.setProperty('--bible-font-size', savedFontSize + 'px');
    }

    // 预加载书卷元数据和版本元数据
    loadBooksMeta();
    loadVersionsMeta();

    // 点击外部关闭更多面板
    document.addEventListener('click', function(e) {
      var p = document.getElementById('morePanel');
      var toolbar = document.getElementById('bottomToolbar');
      if (p && p.classList.contains('show') && !p.contains(e.target) && !(toolbar && toolbar.contains(e.target))) {
        if (e.target.closest && e.target.closest('.cx-dialog-mask')) return;
        var masks = document.querySelectorAll('.cx-dialog-mask');
        for (var i = 0; i < masks.length; i++) {
          if (masks[i].contains(e.target)) return;
        }
        _toggleMorePanel();
      }
    });

    // ── 横屏/竖屏切换：重建 slider 以适配新尺寸 ──
    var _orientationTimer = null;
    function _onOrientationChange() {
      clearTimeout(_orientationTimer);
      _orientationTimer = setTimeout(function() {
        var slider = document.querySelector('.swipe-slider');
        if (slider && _currentBook && _currentChapter && window.CXSwipeSlider) {
          CXSwipeSlider.unbindSwipeGesture();
          slider.parentNode.removeChild(slider);
          CXSwipeSlider.bindSwipeGesture();
        }
      }, 250);
    }
    window.addEventListener('orientationchange', _onOrientationChange);
    window.addEventListener('resize', _onOrientationChange);
  }

  // ── 清理指定版本的内存缓存 ──
  function clearVersionCache(lang) {
    if (_versionDataCache[lang]) {
      delete _versionDataCache[lang];
    }
  }

  // ── 退出/后台时立即保存滚动位置（跳过防抖，防止 300ms 内退出导致位置丢失）──
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) _flushScrollSave();
  });
  window.addEventListener('pagehide', _flushScrollSave);

  // ── 暴露 API ──
  window.CXBible = {
    init: init,
    ensureHistory: function() {
      if (!_initDone) {
        console.log('[CXBible] ensureHistory: init not yet done, loading history now');
        loadHistory();
        console.log('[CXBible] ensureHistory: ' + _history.length + ' entries' + (_history[0] ? ', latest=bible/' + _history[0].bookIndex + '/' + _history[0].chapter : ''));
      }
    },
    refresh: function() {
      // 语言切换后重新渲染当前视图
      _t  = (window.CXI18n && window.CXI18n.t)  ? window.CXI18n.t.bind(window.CXI18n)  : function(k) { return k; };
      _tf = (window.CXI18n && window.CXI18n.tf) ? window.CXI18n.tf.bind(window.CXI18n) : function(k, v) { return k; };
      _stopTTSIfPlaying();
      if (_currentBook && _currentChapter) {
        renderBibleView(_currentBook, _currentChapter, true);
      } else {
        // 无当前阅读位置，跳转默认章节
        var latest = _history.length > 0 ? _history[0] : null;
        if (latest && latest.bookIndex && latest.chapter) {
          window.CXRouter && window.CXRouter.navigateReplace('bible/' + latest.bookIndex + '/' + latest.chapter);
        } else {
          window.CXRouter && window.CXRouter.navigateReplace('bible/1/1');
        }
      }
    },
    renderBibleView: renderBibleView,
    renderSettings: renderSettings,
    renderCharts: renderCharts,
    renderIllustrations: renderIllustrations,
    renderReadingPlan: renderReadingPlan,
    showBookDrawer: _showBookDrawer,
    navigateChapter: _navigateChapter,
    getToggles: function() { return _toggles; },
    setToggle: function(key, val) {
      if (key in _toggles) { _toggles[key] = !!val; saveToggles(); }
    },
    getActiveVersions: function() { return _activeVersions.slice(); },
    getAvailableVersions: function() { return _availableVersions.slice(); },
    clearVersionCache: clearVersionCache,

    // 语言版本顺序管理
    moveVersion: function(fromIndex, toIndex) {
      if (fromIndex < 0 || toIndex < 0) return false;
      if (fromIndex >= _activeVersions.length || toIndex >= _activeVersions.length) return false;
      var item = _activeVersions.splice(fromIndex, 1)[0];
      _activeVersions.splice(toIndex, 0, item);
      saveActiveVersions();
      return true;
    },
    addActiveVersion: function(lang) {
      if (_activeVersions.indexOf(lang) !== -1) return false;
      _activeVersions.push(lang);
      saveActiveVersions();
      return true;
    },
    removeActiveVersion: function(lang) {
      var idx = _activeVersions.indexOf(lang);
      if (idx === -1) return false;
      _activeVersions.splice(idx, 1);
      saveActiveVersions();
      return true;
    },
    setActiveVersions: function(order) {
      if (!Array.isArray(order) || !order.length) return false;
      _activeVersions = order.slice();
      saveActiveVersions();
      return true;
    },
    showVerseDetail: _showDetailOverlay,
    getLatestHistory: function() {
      return _history.length > 0 ? _history[0] : null;
    },
    getCurrentBook: function() { return _currentBook; },
    getCurrentChapter: function() { return _currentChapter; }
  };

  // 挂载更多菜单到 CX.showMore
  window.CX = window.CX || {};
  window.CX.showMore = showMore;
  window.CX._toggleMorePanel = _toggleMorePanel;

  // 自动初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
