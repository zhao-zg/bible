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
  var _currentTestament = 'ot'; // 'ot' | 'nt'
  var _currentTab = 'books';    // 'books' | 'favorites' | 'history'
  var _history = [];            // 浏览历史
  var _verseEventsBound = false; // 经文事件委托是否已绑定

  function loadHistory() {
    try { _history = JSON.parse(localStorage.getItem('bible_history') || '[]'); } catch(e) { _history = []; }
  }
  function saveHistory() {
    try { localStorage.setItem('bible_history', JSON.stringify(_history.slice(0, 50))); } catch(e) {}
  }

  // ── 简易 Toast 提示 ──
  function _showBibleToast(msg) {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
      'background:rgba(50,50,50,.92);color:#fff;padding:10px 18px;border-radius:22px;' +
      'font-size:14px;z-index:99999;opacity:0;transition:opacity .3s;pointer-events:none;' +
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

  // ── 事件委托：绑定在不会被 innerHTML 替换的 #app 容器上 ──
  var _appDelegationBound = false;
  function _bindAppDelegation() {
    if (_appDelegationBound) return;
    var container = document.getElementById('app');
    if (!container) return;
    _appDelegationBound = true;

    container.addEventListener('click', function(e) {
      var t = e.target;

      // 标签页切换（书卷/收藏/历史）
      var tabEl = t.closest ? t.closest('.book-nav-tab') : null;
      if (!tabEl && t.classList && t.classList.contains('book-nav-tab')) tabEl = t;
      if (tabEl && tabEl.dataset && tabEl.dataset.tab) {
        _currentTab = tabEl.dataset.tab;
        renderBookList();
        return;
      }

      // 旧约/新约切换
      var testEl = t.closest ? t.closest('.testament-tab') : null;
      if (!testEl && t.classList && t.classList.contains('testament-tab')) testEl = t;
      if (testEl && testEl.dataset && testEl.dataset.testament) {
        _currentTestament = testEl.dataset.testament;
        _currentBook = null;
        renderBookList();
        return;
      }

      // 书卷点击
      var bookEl = t.closest ? t.closest('.book-list-item') : null;
      if (!bookEl && t.classList && t.classList.contains('book-list-item')) bookEl = t;
      if (bookEl && bookEl.dataset && bookEl.dataset.book) {
        var bookIdx = parseInt(bookEl.dataset.book);
        _currentBook = bookIdx;
        // 更新高亮
        container.querySelectorAll('.book-list-item').forEach(function(el) { el.classList.remove('active'); });
        bookEl.classList.add('active');
        // 更新章节列表
        var chapterCol = document.getElementById('chapterListCol');
        if (chapterCol) {
          chapterCol.innerHTML = _renderChapterList(bookIdx);
        }
        return;
      }

      // 章节点击
      var chapterEl = t.closest ? t.closest('.chapter-list-item') : null;
      if (!chapterEl && t.classList && t.classList.contains('chapter-list-item')) chapterEl = t;
      if (chapterEl && chapterEl.dataset) {
        var bIdx = parseInt(chapterEl.dataset.book);
        var chIdx = parseInt(chapterEl.dataset.chapter);
        if (bIdx && chIdx) {
          if (window.CXRouter) {
            window.CXRouter.navigate('bible/' + bIdx + '/' + chIdx);
          }
        }
        return;
      }
    });
  }
  function addHistory(bookIndex, chapter) {
    var entry = { bookIndex: bookIndex, chapter: chapter, time: Date.now() };
    _history = _history.filter(function(h) {
      return !(h.bookIndex === bookIndex && h.chapter === chapter);
    });
    _history.unshift(entry);
    if (_history.length > 50) _history = _history.slice(0, 50);
    saveHistory();
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

  function loadBooksMeta() {
    if (_booksMeta) return Promise.resolve(_booksMeta);
    return fetch(getRoot() + 'data/bible-books.json')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        _booksMeta = data;
        return data;
      });
  }

  // ── 版本元数据加载 ──
  function loadVersionsMeta() {
    if (_availableVersions.length) return Promise.resolve(_availableVersions);
    return fetch(getRoot() + 'data/bible-versions.json')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        _availableVersions = data || [];
        // 从 localStorage 恢复激活版本
        try {
          var saved = JSON.parse(localStorage.getItem('bible_active_versions') || '');
          if (Array.isArray(saved) && saved.length) _activeVersions = saved;
        } catch(e) {}
        // 确保 zh-rcv 始终在激活列表中
        if (_activeVersions.indexOf('zh-rcv') === -1) _activeVersions.unshift('zh-rcv');
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

  // ── 加载指定版本的书卷数据 ──
  function loadVersionBookData(lang, bookIndex) {
    if (_versionDataCache[lang] && _versionDataCache[lang][bookIndex]) {
      return Promise.resolve(_versionDataCache[lang][bookIndex]);
    }
    var idx = String(bookIndex).padStart(2, '0');
    return fetch(getRoot() + 'data/bible/' + lang + '/' + idx + '.json')
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
      : fetch(getRoot() + 'data/bible/' + String(bookIndex).padStart(2, '0') + '.json')
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

    return mainPromise.then(function(mainData) {
      return Promise.all(secondaryPromises).then(function() {
        return mainData;
      });
    });
  }

  // ── 元数据懒加载 ──
  function loadBibleTopics() {
    if (_topicsData) return Promise.resolve(_topicsData);
    if (_topicsPromise) return _topicsPromise;
    _topicsPromise = fetch(getRoot() + 'data/bible-topics.json')
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
    _introPromise = fetch(getRoot() + 'data/bible-intro.json')
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
    _outlinesPromise = fetch(getRoot() + 'data/bible-outlines.json')
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
  //  书卷/章节导航（双栏布局）
  // ══════════════════════════════════════════════════════════
  function renderBookList() {
    var container = document.getElementById('app');
    if (!container) return;
    window._cxShowApp();
    _hideBibleSpeechBar(); // 离开圣经视图时隐藏朗读栏

    loadBooksMeta().then(function(books) {
      var html = '<div class="book-nav">';

      // 搜索栏
      html += '<div class="book-nav-header">';
      html += '<input type="text" class="book-nav-search" id="bibleSearchInput" placeholder="' + esc(_t('search_placeholder')) + '" />';
      html += '</div>';

      // 三标签页
      html += '<div class="book-nav-tabs">';
      html += '<button class="book-nav-tab' + (_currentTab === 'books' ? ' active' : '') + '" data-tab="books">' + esc(_t('tab_books')) + '</button>';
      html += '<button class="book-nav-tab' + (_currentTab === 'favorites' ? ' active' : '') + '" data-tab="favorites">' + esc(_t('tab_favorites')) + '</button>';
      html += '<button class="book-nav-tab' + (_currentTab === 'history' ? ' active' : '') + '" data-tab="history">' + esc(_t('tab_history')) + '</button>';
      html += '</div>';

      // 双栏主体
      html += '<div class="book-nav-body" id="bookNavBody">';
      html += _renderBookNavContent(books);
      html += '</div>';

      // 底部旧约/新约切换
      html += '<div class="testament-tabs">';
      html += '<button class="testament-tab' + (_currentTestament === 'ot' ? ' active' : '') + '" data-testament="ot">' + esc(_t('old_testament')) + '</button>';
      html += '<button class="testament-tab' + (_currentTestament === 'nt' ? ' active' : '') + '" data-testament="nt">' + esc(_t('new_testament')) + '</button>';
      html += '</div>';

      html += '</div>';
      container.innerHTML = html;

      _bindBookNavEvents();
    });
  }

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
        + '<div style="font-size:32px;margin-bottom:12px">⭐</div>'
        + '<div>' + esc(_t('no_favorites')) + '</div>'
        + '<div style="margin-top:8px;font-size:13px">' + esc(_t('fav_hint')) + '</div>'
        + '</div>';
    }
    var html = '<div style="width:100%;overflow-y:auto;-webkit-overflow-scrolling:touch">';
    favs.forEach(function(f) {
      var meta = getBookMeta(f.bookIndex);
      var name = f.bookName || meta.name || _t('tab_books') + f.bookIndex;
      html += '<div class="chapter-list-item" data-book="' + f.bookIndex + '" data-chapter="' + f.chapter + '" style="display:flex;justify-content:space-between;align-items:center">';
      html += '<span>' + esc(name) + ' ' + _tf('chapter_n', {n: f.chapter}) + '</span>';
      html += '<span style="font-size:11px;color:var(--text-muted,#999);white-space:nowrap;margin-left:8px">' + _relativeTime(f.time) + '</span>';
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
        if (typeof window.CX.backStack.discard === 'function') {
          window.CX.backStack.discard(_drawerBackStackClose);
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
      var _backStackPushed = false;
      function closeDrawer() {
        overlay.classList.remove('open');
        setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 300);
        if (_backStackPushed && window.CX && window.CX.backStack) {
          if (typeof window.CX.backStack.discard === 'function') {
            window.CX.backStack.discard(closeDrawer);
          }
        }
        _backStackPushed = false;
        _drawerBackStackClose = null;
      }

      // 注册到返回栈（Android 返回键支持）
      if (window.CX && window.CX.backStack && typeof window.CX.backStack.push === 'function') {
        window.CX.backStack.push(closeDrawer);
        _drawerBackStackClose = closeDrawer;
        _backStackPushed = true;
      }

      // 点击遮罩关闭
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeDrawer();
      });

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

      // 搜索输入
      var searchInput = drawer.querySelector('#drawerSearchInput');
      if (searchInput) {
        searchInput.addEventListener('input', function() {
          var q = this.value.trim().toLowerCase();
          if (!q) {
            body.innerHTML = _renderBookNavContent(books);
            return;
          }
          // 按名称/序号过滤书卷
          var filtered = books.filter(function(b) {
            return String(b.name).toLowerCase().indexOf(q) !== -1 || String(b.index).indexOf(q) !== -1;
          });
          body.innerHTML = _renderBookNavContent(filtered);
        });
      }
    });
  }

  function _bindBookNavEvents() {
    // 标签页、旧约/新约、书卷、章节点击均由 _bindAppDelegation() 事件委托处理

    // 搜索栏
    var searchInput = document.getElementById('bibleSearchInput');
    if (searchInput) {
      searchInput.addEventListener('click', function() {
        if (window.CXSearch && window.CXSearch.open) window.CXSearch.open();
      });
    }
  }

  function _bindChapterClick() {
    document.querySelectorAll('.chapter-list-item').forEach(function(item) {
      item.addEventListener('click', function() {
        var bookIdx = parseInt(this.dataset.book);
        var chapter = parseInt(this.dataset.chapter);
        if (bookIdx && chapter) {
          if (window.CXRouter) {
            window.CXRouter.navigate('bible/' + bookIdx + '/' + chapter);
          }
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════
  //  朗读控制栏（圣经视图专用）
  // ══════════════════════════════════════════════════════════
  function _hideBibleSpeechBar() {
    var bar = document.getElementById('bottomControlBar');
    if (bar) bar.style.display = 'none';
  }

  function _initBibleSpeech(meta, chapter) {
    // 若朗读控制栏不存在，注入一个（复用 speech.js 所需的 DOM 结构）
    // speech.js init() 通过 byId('bottomControlBar') 查找控制栏
    var bar = document.getElementById('bottomControlBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'bottomControlBar';
      bar.className = 'bottom-control-bar';
      bar.style.cssText = 'display:none;';
      bar.innerHTML = '' +
        '<button class="control-btn play-pause-btn" id="playPauseBtn" title="' + esc(_t('tts_play_pause')) + '" aria-label="' + esc(_t('tts_play_label')) + '">' +
          '<span class="play-icon">▶</span>' +
          '<span class="pause-icon" style="display:none;">⏸</span>' +
        '</button>' +
        '<button class="control-btn loop-btn" id="loopBtn" title="' + esc(_t('tts_loop_off')) + '" aria-label="' + esc(_t('tts_loop_off')) + '">①</button>' +
        '<div class="progress-section">' +
          '<div class="progress-column">' +
            '<input type="range" id="progressBar" class="progress-bar" min="0" max="100" value="0" step="0.1">' +
            '<span class="speech-time" id="speechTime">00:00 / 00:00</span>' +
          '</div>' +
          '<select id="rateSelect" class="control-select" title="' + esc(_t('tts_rate')) + '">' +
            '<option value="0.5">0.5x</option>' +
            '<option value="0.75">0.75x</option>' +
            '<option value="1" selected>1x</option>' +
            '<option value="1.25">1.25x</option>' +
            '<option value="1.5">1.5x</option>' +
            '<option value="2">2x</option>' +
          '</select>' +
        '</div>';
      document.body.appendChild(bar);
    }
    bar.style.display = 'none'; // 初始化时隐藏，init 成功后由 speech.js 显示

    // 初始化 CXSpeech，朗读当前章节经文
    if (window.CXSpeech && window.CXSpeech.init) {
      var title = (meta.name || '') + ' ' + chapter;
      window.CXSpeech.init({
        getElements: function() {
          var segs = [];
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

  // ══════════════════════════════════════════════════════════
  //  经文阅读视图
  // ══════════════════════════════════════════════════════════
  function renderBibleView(bookIndex, chapter, skipHistory) {
    var container = document.getElementById('app');
    if (!container) return;
    window._cxShowApp();

    _currentBook = bookIndex;
    _currentChapter = chapter;
    if (!skipHistory) addHistory(bookIndex, chapter);

    container.innerHTML = '<div class="bible-reading"><div style="padding:40px;text-align:center;color:var(--text-muted,#999)">' + esc(_t('loading')) + '</div></div>';

    Promise.all([loadBooksMeta(), loadBookData(bookIndex), loadBibleTopics(), loadBibleIntro(), loadBibleOutlines()]).then(function(results) {
      var books = results[0];
      var bookData = results[1];
      var meta = getBookMeta(bookIndex);

      // 找到对应章节
      var chapterData = null;
      if (bookData.chapters) {
        for (var i = 0; i < bookData.chapters.length; i++) {
          if (bookData.chapters[i].chapter === chapter) {
            chapterData = bookData.chapters[i];
            break;
          }
        }
      }

      var html = '<div class="bible-reading">';

      // 返回按钮
      html += '<button class="bible-back-btn" onclick="window.CXRouter&&CXRouter.navigate(\'\')">' + esc(_t('back_to_books')) + '</button>';

      // 标题（含收藏按钮）
      var isFav = _isFavorite(bookIndex, chapter);
      html += '<div class="bible-title" style="display:flex;align-items:center;justify-content:space-between">';
      html += '<span>' + esc(meta.name) + ' ' + chapter + '</span>';
      html += '<button class="bible-fav-btn" id="bibleFavBtn" data-book="' + bookIndex + '" data-chapter="' + chapter + '" data-name="' + esc(meta.name) + '" style="background:none;border:none;font-size:20px;cursor:pointer;padding:4px 8px;color:' + (isFav ? '#f5a623' : 'var(--text-muted,#999)') + '">' + (isFav ? '★' : '☆') + '</button>';
      html += '</div>';

      if (!chapterData || !chapterData.verses || !chapterData.verses.length) {
        html += '<div style="padding:20px;text-align:center;color:var(--text-muted,#999)">' + esc(_t('no_scripture')) + '</div>';
        html += '</div>';
        container.innerHTML = html;
        return;
      }

      // 元数据区（受开关控制）
      if (_toggles.showIntro) {
        html += _renderMetadata(bookData, chapterData, bookIndex);
      }

      // 主题摘要（受开关控制）
      if (_toggles.showTheme) {
        html += _renderThemeText(chapterData, bookIndex);
      }

      // 纲目（受开关控制）
      if (_toggles.showOutline) {
        html += _renderOutline(chapterData, bookIndex, chapter);
      }

      // 经文正文
      html += _renderVerses(chapterData, meta.acronym, chapter);

      html += '</div>';
      container.innerHTML = html;

      // 绑定注解/串珠点击事件
      _bindVerseEvents();

      // 绑定收藏按钮
      var favBtn = document.getElementById('bibleFavBtn');
      if (favBtn) {
        favBtn.addEventListener('click', function() {
          var bi = parseInt(this.dataset.book);
          var ch = parseInt(this.dataset.chapter);
          var bn = this.dataset.name || '';
          if (_isFavorite(bi, ch)) {
            _removeFavorite(bi, ch);
            this.textContent = '☆';
            this.style.color = 'var(--text-muted,#999)';
          } else {
            _addFavorite(bi, bn, ch);
            this.textContent = '★';
            this.style.color = '#f5a623';
          }
        });
      }

      // 滚动到顶部
      window.scrollTo(0, 0);

      // 注入朗读控制栏并初始化 CXSpeech
      _initBibleSpeech(meta, chapter);
    }).catch(function(err) {
      console.error('[CXBible] 加载失败:', err);
      container.innerHTML = '<div class="bible-reading">'
        + '<button class="bible-back-btn" onclick="window.CXRouter&&CXRouter.navigate(\'\')">' + esc(_t('back_to_books')) + '</button>'
        + '<div style="padding:40px;text-align:center;color:var(--danger-text,#c53030)">' + esc(_t('load_failed_retry')) + '</div>'
        + '</div>';
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
      html += '<span class="meta-value">' + esc(parsed.value) + '</span>';
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
    html += '<span class="theme-content">' + esc(topic) + '</span>';
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

  // ── 经文正文 ──
  function _renderVerses(chapterData, bookAcronym, chapter) {
    var html = '';
    var lastSection = -1;
    var isMultiVersion = _activeVersions.length > 1;

    // 构建辅助版本的 sectionMap: lang -> sectionMap
    var secondaryMaps = {};
    if (isMultiVersion) {
      _activeVersions.forEach(function(lang) {
        if (lang === 'zh-rcv') return;
        var cache = _versionDataCache[lang];
        var bookData = cache ? cache[_currentBook] : null;
        var chData = _findChapterData(bookData, chapter);
        secondaryMaps[lang] = _buildSectionMap(chData);
      });
    }

    chapterData.verses.forEach(function(verse) {
      var sec = verse.section;
      var flag = verse.flag || 0;
      var content = verse.content || '';
      var isNewSection = sec !== lastSection;

      // 节号分隔
      if (isNewSection && flag === 0) {
        if (lastSection !== -1 && _toggles.showVerseDivider) {
          html += '<hr class="verse-divider" />';
        }
        html += '<div class="bible-verse" data-section="' + sec + '">';
        html += '<span class="verse-num">' + sec + '</span> ';
      } else if (isNewSection && flag !== 0) {
        // 带上下半节标记
        html += '<div class="bible-verse" data-section="' + sec + '">';
        html += '<span class="verse-num">' + sec + '</span> ';
      } else if (flag !== 0) {
        // 同一节的下半节
        html += '<div class="bible-verse" data-section="' + sec + '" data-flag="' + flag + '">';
      }

      // 经文文本
      if (isMultiVersion) {
        html += '<div class="bible-verse-lang primary" data-lang="zh-rcv">';
        html += '<span class="lang-label">' + esc(_getVersionLabel('zh-rcv')) + '</span>';
        html += renderVerseText(content, bookAcronym, chapter, sec, flag);
        html += '</div>';
      } else {
        html += renderVerseText(content, bookAcronym, chapter, sec, flag);
      }
      html += '</div>';

      // 辅助版本文本（在新节的首条 verse 之后渲染）
      if (isMultiVersion && isNewSection) {
        _activeVersions.forEach(function(lang) {
          if (lang === 'zh-rcv') return;
          var secMap = secondaryMaps[lang] || {};
          var secVerse = secMap[sec];
          if (secVerse) {
            var texts = Array.isArray(secVerse)
              ? secVerse.map(function(v) { return v.text; }).join('')
              : secVerse.text;
            if (texts) {
              html += '<div class="bible-verse-lang secondary" data-lang="' + esc(lang) + '">';
              html += '<span class="lang-label">' + esc(_getVersionLabel(lang)) + '</span>';
              html += esc(texts);
              html += '</div>';
            }
          }
        });
      }

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



  // ── 通用浮层（纲目 / 更多菜单等） ──
  var _overlayStylesInjected = false;
  function _ensureOverlayStyles() {
    if (_overlayStylesInjected) return;
    _overlayStylesInjected = true;
    var s = document.createElement('style');
    s.id = 'verse-detail-overlay-styles';
    s.textContent = '.verse-detail-overlay{position:fixed;inset:0;background:var(--overlay-bg,rgba(0,0,0,.5));z-index:950;' +
      'display:flex;align-items:flex-end;justify-content:center;opacity:0;pointer-events:none;transition:opacity .25s ease}' +
      '.verse-detail-overlay.open{opacity:1;pointer-events:auto}' +
      '.verse-detail-card{background:var(--card-bg,#fff);border-radius:16px 16px 0 0;width:100%;max-width:600px;' +
      'max-height:70vh;overflow-y:auto;padding:20px 18px;box-shadow:var(--card-shadow);-webkit-overflow-scrolling:touch;' +
      'transform:translateY(100%);transition:transform .3s ease}' +
      '.verse-detail-overlay.open .verse-detail-card{transform:translateY(0)}' +
      '.verse-detail-text{font-size:16px;line-height:1.9;color:var(--text-color,var(--text,#333));margin-bottom:16px}' +
      '.verse-detail-footer{display:flex;align-items:center;justify-content:space-between;padding-top:12px;border-top:1px solid var(--border,#e0e0e0)}' +
      '.verse-detail-source{font-size:13px;color:var(--text-muted,#7A6E64)}' +
      '.verse-detail-copy{padding:6px 16px;background:var(--brand,#8B4513);color:var(--brand-text,#fff);border:none;' +
      'border-radius:6px;font-size:13px;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '.verse-detail-copy:active{opacity:.8}' +
      '@media(min-width:768px){.verse-detail-card{border-radius:16px;margin-bottom:40px}.verse-detail-overlay{align-items:center}}';
    document.head.appendChild(s);
  }

  function _showDetailOverlay(htmlContent, source, rawText) {
    _ensureOverlayStyles();
    // 移除已有浮层
    var existing = document.querySelector('.verse-detail-overlay');
    if (existing) existing.parentNode.removeChild(existing);

    var overlay = document.createElement('div');
    overlay.className = 'verse-detail-overlay';
    overlay.innerHTML = '<div class="verse-detail-card">'
      + '<div class="verse-detail-text">' + htmlContent + '</div>'
      + '<div class="verse-detail-footer">'
      + '<span class="verse-detail-source">' + esc(source) + '</span>'
      + '<button class="verse-detail-copy">' + esc(_t('copy_all')) + '</button>'
      + '</div>'
      + '</div>';

    document.body.appendChild(overlay);

    // 动画打开
    requestAnimationFrame(function() {
      overlay.classList.add('open');
    });

    // 关闭函数（同时清理 backStack 条目）
    var _backStackPushed = false;
    function closeOverlay() {
      overlay.classList.remove('open');
      setTimeout(function() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 300);
      // 若是由 backStack 触发（非点击关闭），不需要再 pop
      if (_backStackPushed && window.CX && window.CX.backStack) {
        // 通过 discard 静默移除，避免再次触发关闭
        if (typeof window.CX.backStack.discard === 'function') {
          window.CX.backStack.discard(closeOverlay);
        }
      }
      _backStackPushed = false;
    }

    // 注册到全局返回栈（Android 返回键支持）
    if (window.CX && window.CX.backStack && typeof window.CX.backStack.push === 'function') {
      window.CX.backStack.push(closeOverlay);
      _backStackPushed = true;
    }

    // 点击遮罩关闭
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) {
        if (_backStackPushed && window.CX && window.CX.backStack && typeof window.CX.backStack.pop === 'function') {
          window.CX.backStack.pop();
          closeOverlay(); // pop 后显式关闭（popstate 因 _skip > 0 不会调用 closeOverlay）
        } else {
          closeOverlay();
        }
      }
    });

    // 复制
    var copyBtn = overlay.querySelector('.verse-detail-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(rawText || '').then(function() {
            copyBtn.textContent = _t('copied');
            setTimeout(function() { copyBtn.textContent = _t('copy_all'); }, 1500);
          });
        } else {
          // 回退
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
  //  纲目浮层
  // ══════════════════════════════════════════════════════════
  function showOutline() {
    // 若不在阅读页，返回首页
    if (!_currentBook || !_currentChapter) {
      window.CXRouter && CXRouter.navigate('');
      return;
    }

    var bookData = _bookDataCache[_currentBook];
    if (!bookData || !bookData.chapters) {
      window.CXRouter && CXRouter.navigate('');
      return;
    }

    // 找到当前章节数据
    var chapterData = null;
    for (var ci = 0; ci < bookData.chapters.length; ci++) {
      if (bookData.chapters[ci].chapter === _currentChapter) {
        chapterData = bookData.chapters[ci];
        break;
      }
    }
    if (!chapterData || !chapterData.verses || !chapterData.verses.length) return;

    // 提取纲目：记录 section 变化点
    var sections = [];
    var prevSection = -1;
    chapterData.verses.forEach(function(verse) {
      if (verse.section !== prevSection) {
        var preview = (verse.content || '').slice(0, 20);
        sections.push({ section: verse.section, preview: preview });
        prevSection = verse.section;
      }
    });

    if (!sections.length) return;

    var meta = getBookMeta(_currentBook);
    var html = '<div class="outline-list" style="max-height:60vh;overflow-y:auto">';
    sections.forEach(function(sec, idx) {
      html += '<div class="outline-item" data-verse="' + sec.section + '" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border,#eee);font-size:14px">';
      html += '<span style="color:var(--brand,#8B4513);font-weight:600;margin-right:8px">' + _tf('section_n', {n: (idx + 1)}) + '</span>';
      html += '<span style="color:var(--text,#333)">' + esc(sec.preview) + '…</span>';
      html += '</div>';
    });
    html += '</div>';

    _showDetailOverlay(html, esc(meta.name) + ' ' + _currentChapter + ' ' + _t('outline'), '');

    // 绑定纲目项点击事件：关闭浮层 + 滚动到对应经文
    setTimeout(function() {
      var overlay = document.querySelector('.verse-detail-overlay');
      if (!overlay) return;
      var items = overlay.querySelectorAll('.outline-item');
      items.forEach(function(item) {
        item.addEventListener('click', function() {
          var verseSection = this.dataset.verse;
          // 关闭浮层
          var overlayEl = document.querySelector('.verse-detail-overlay');
          if (overlayEl) {
            overlayEl.classList.remove('open');
            setTimeout(function() {
              if (overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
            }, 300);
          }
          // 滚动到对应经文
          var verseEl = document.querySelector('.bible-verse[data-section="' + verseSection + '"]');
          if (verseEl) {
            setTimeout(function() {
              verseEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 320);
          }
        });
      });
      // 隐藏复制按钮（纲目不需要复制）
      var copyBtn = overlay.querySelector('.verse-detail-copy');
      if (copyBtn) copyBtn.style.display = 'none';
    }, 50);
  }

  // ══════════════════════════════════════════════════════════
  //  更多菜单
  // ══════════════════════════════════════════════════════════
  function showMore() {
    var html = '<div class="more-menu" style="padding:4px 0">';
    html += '<div class="more-menu-item" data-action="charts" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:15px;border-bottom:1px solid var(--border,#eee)">';
    html += '<span style="font-size:20px">📊</span><span>' + esc(_t('reading_stats')) + '</span></div>';

    html += '<div class="more-menu-item" data-action="illustrations" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:15px;border-bottom:1px solid var(--border,#eee)">';
    html += '<span style="font-size:20px">🖼️</span><span>' + esc(_t('bible_illustrations')) + '</span></div>';

    html += '<div class="more-menu-item" data-action="help" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:15px;border-bottom:1px solid var(--border,#eee)">';
    html += '<span style="font-size:20px">📖</span><span>' + esc(_t('user_guide')) + '</span></div>';

    if (_currentBook) {
      html += '<div class="more-menu-item" data-action="bookmark" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:15px;border-bottom:1px solid var(--border,#eee)">';
      html += '<span style="font-size:20px">🔖</span><span>' + esc(_t('add_bookmark')) + '</span></div>';
    }

    html += '</div>';

    _showDetailOverlay(html, _t('more'), '');

    // 绑定菜单项点击
    setTimeout(function() {
      var overlay = document.querySelector('.verse-detail-overlay');
      if (!overlay) return;
      // 隐藏复制按钮
      var copyBtn = overlay.querySelector('.verse-detail-copy');
      if (copyBtn) copyBtn.style.display = 'none';

      var items = overlay.querySelectorAll('.more-menu-item');
      items.forEach(function(item) {
        item.addEventListener('click', function() {
          var action = this.dataset.action;
          // 关闭浮层
          var overlayEl = document.querySelector('.verse-detail-overlay');
          if (overlayEl) {
            overlayEl.classList.remove('open');
            setTimeout(function() {
              if (overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
            }, 300);
          }
          setTimeout(function() {
            if (action === 'charts') {
              if (window.CXBible && CXBible.renderCharts) CXBible.renderCharts();
            } else if (action === 'illustrations') {
              if (window.CXBible && CXBible.renderIllustrations) CXBible.renderIllustrations();
            } else if (action === 'help') {
              _showDetailOverlay(
                '<div style="line-height:1.8;font-size:14px">'
                + '<p>' + esc(_t('guide_books')) + '</p>'
                + '<p>' + esc(_t('guide_tts')) + '</p>'
                + '<p>' + esc(_t('guide_font')) + '</p>'
                + '<p>' + esc(_t('guide_outline')) + '</p>'
                + '<p>' + esc(_t('guide_fav')) + '</p>'
                + '</div>',
                _t('user_guide'),
                ''
              );
            } else if (action === 'bookmark') {
              // 添加书签
              var meta = getBookMeta(_currentBook);
              var title = (meta.name || '') + ' ' + _tf('chapter_n', {n: _currentChapter});
              var _bmDone = false; // 标记是否已显示反馈
              if (window.CXBookmark && CXBookmark.add) {
                try {
                  var _bmResult = CXBookmark.add({
                    path: 'bible/' + _currentBook + '/' + _currentChapter,
                    scrollY: window.scrollY || 0,
                    title: title
                  });
                  if (_bmResult && typeof _bmResult.then === 'function') {
                    _bmResult.then(function() {
                      // CXBookmark.add 成功：显式 Toast 反馈
                      if (!_bmDone) { _bmDone = true; _showBibleToast(_t('bookmark_added')); }
                    }, function() {
                      // CXBookmark.add 失败：localStorage 降级
                      if (_bmDone) return;
                      _bmDone = true;
                      try {
                        var key = 'bible_bookmarks';
                        var bookmarks = JSON.parse(localStorage.getItem(key) || '[]');
                        bookmarks.push({
                          bookIndex: _currentBook,
                          bookName: meta.name || '',
                          chapter: _currentChapter,
                          timestamp: Date.now()
                        });
                        localStorage.setItem(key, JSON.stringify(bookmarks));
                        _showBibleToast(_t('bookmark_added'));
                      } catch(e) {
                        _showBibleToast(_t('bookmark_failed'))
                      }
                    });
                  } else {
                    // CXBookmark.add 未返回 Promise，直接视为成功
                    if (!_bmDone) { _bmDone = true; _showBibleToast(_t('bookmark_added')); }
                  }
                } catch(e) {
                  // CXBookmark.add 同步抛出异常：localStorage 降级
                  if (!_bmDone) {
                    _bmDone = true;
                    try {
                      var key = 'bible_bookmarks';
                      var bookmarks = JSON.parse(localStorage.getItem(key) || '[]');
                      bookmarks.push({
                        bookIndex: _currentBook,
                        bookName: meta.name || '',
                        chapter: _currentChapter,
                        timestamp: Date.now()
                      });
                      localStorage.setItem(key, JSON.stringify(bookmarks));
                      _showBibleToast(_t('bookmark_added'));
                    } catch(e2) {
                      _showBibleToast(_t('bookmark_failed'))
                    }
                  }
                }
                // 安全超时：若 CXBookmark.add() 2秒内无任何回调，强制显示提示
                setTimeout(function() {
                  if (!_bmDone) {
                    _bmDone = true;
                    _showBibleToast(_t('bookmark_added'));
                  }
                }, 2000);
              } else {
                // CXBookmark 不可用时直接存 localStorage
                try {
                  var key = 'bible_bookmarks';
                  var bookmarks = JSON.parse(localStorage.getItem(key) || '[]');
                  bookmarks.push({
                    bookIndex: _currentBook,
                    bookName: meta.name || '',
                    chapter: _currentChapter,
                    timestamp: Date.now()
                  });
                  localStorage.setItem(key, JSON.stringify(bookmarks));
                  _showBibleToast(_t('bookmark_added'));
                } catch(e) {
                  _showBibleToast(_t('bookmark_failed'))
                }
              }
            }
          }, 320);
        });
      });
    }, 50);
  }

  // ══════════════════════════════════════════════════════════
  //  设置面板
  // ══════════════════════════════════════════════════════════
  function renderSettings() {
    var container = document.getElementById('app');
    if (!container) return;
    window._cxShowApp();
    _hideBibleSpeechBar();
  
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
    var fontSize = 16;
    try { fontSize = parseInt(localStorage.getItem('bibleFontSize') || '16'); } catch(e) {}
    html += '<div class="settings-section">';
    html += '<div class="settings-section-title">' + esc(_t('font_size')) + '</div>';
    html += '<div class="font-size-slider-container">';
    html += '<span class="slider-label small">A</span>';
    html += '<input type="range" class="font-size-slider" min="12" max="24" value="' + fontSize + '" id="bibleFontSizeSlider" />';
    html += '<span class="slider-label large">A</span>';
    html += '</div></div>';
  
    // 显示语言 checkbox 组
    if (_availableVersions.length > 0) {
      html += '<div class="settings-section">';
      html += '<div class="settings-section-title">' + esc(_t('display_languages')) + '</div>';
      html += '<div class="language-checkboxes">';
      _availableVersions.forEach(function(ver) {
        var isPrimary = ver.lang === 'zh-rcv';
        var isActive = _activeVersions.indexOf(ver.lang) !== -1;
        html += '<label class="language-checkbox">';
        html += '<input type="checkbox" data-lang="' + esc(ver.lang) + '"';
        if (isActive) html += ' checked';
        if (isPrimary) html += ' disabled';
        html += ' />';
        // 优先使用 i18n 翻译的版本名，fallback 到 ver.label
        var _verKey = 'version_' + ver.lang.replace(/-/g, '_');
        var _verLabel = (window.CXI18n && window.CXI18n.t) ? window.CXI18n.t(_verKey) : ver.lang;
        if (_verLabel === _verKey) _verLabel = ver.label; // key 不存在时 fallback
        html += '<span>' + esc(_verLabel) + '</span>';
        if (isPrimary) html += '<span class="lang-badge primary">' + esc(_t('primary_version')) + '</span>';
        html += '</label>';
      });
      html += '</div></div>';
    }
  
    // ── 语言版本管理 ──
    if (_availableVersions.length > 0) {
      html += '<div class="settings-section">';
      html += '<div class="settings-section-title">' + esc(_t('lang_pack_manager')) + '</div>';
      html += '<div class="lang-pack-list" id="langPackList">';
      _availableVersions.forEach(function(ver) {
        var isPrimary = ver.lang === 'zh-rcv';
        var installed = !isPrimary && window.CXLanguagePack && window.CXLanguagePack.isInstalled(ver.lang);

        html += '<div class="lang-pack-item" data-lang="' + esc(ver.lang) + '">';
        html += '<div class="lang-pack-info">';

        // 版本名（i18n 优先）
        var verKey = 'version_' + ver.lang.replace(/-/g, '_');
        var verLabel = _t(verKey);
        if (verLabel === verKey) verLabel = ver.label;
        html += '<span class="lang-pack-name">' + esc(verLabel) + '</span>';

        // 状态徽章
        if (isPrimary) {
          html += '<span class="lang-badge bundled">' + esc(_t('lang_pack_bundled')) + '</span>';
        } else if (installed) {
          html += '<span class="lang-badge status-downloaded">' + esc(_t('lang_pack_downloaded')) + '</span>';
        } else {
          html += '<span class="lang-badge status-available">' + esc(_t('lang_pack_available')) + '</span>';
        }
        html += '</div>'; // lang-pack-info

        // 大小占位（异步填充）
        if (!isPrimary && window.CXLanguagePack) {
          html += '<span class="lang-pack-size" data-lang="' + esc(ver.lang) + '"></span>';
        }

        // 操作按钮
        if (!isPrimary) {
          if (installed) {
            html += '<button class="lang-pack-btn delete" data-action="delete" data-lang="' + esc(ver.lang) + '">' + esc(_t('lang_pack_delete')) + '</button>';
          } else {
            if (navigator.onLine) {
              html += '<button class="lang-pack-btn download" data-action="download" data-lang="' + esc(ver.lang) + '">' + esc(_t('lang_pack_download')) + '</button>';
            } else {
              html += '<span class="lang-pack-offline">' + esc(_t('lang_pack_no_network')) + '</span>';
            }
          }
        }

        html += '</div>'; // lang-pack-item

        // 进度条区域（默认隐藏）
        if (!isPrimary) {
          html += '<div class="lang-pack-progress" data-lang="' + esc(ver.lang) + '" style="display:none">';
          html += '<div class="progress-bar-container"><div class="progress-bar-fill" style="width:0%"></div></div>';
          html += '<span class="progress-text">0%</span>';
          html += '</div>';
        }
      });
      html += '</div></div>'; // lang-pack-list, settings-section
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
          'gray-white': '#FFFFFF',
          'light-yellow': '#FFF8E7',
          'warm-yellow': '#F5F0E6',
          'dark-gray': '#3E3E3E',
          'night': '#1A1A1A'
        };
        if (metaTheme) metaTheme.setAttribute('content', colorMap[theme] || '#FFFFFF');
      });
    });

    // 字号滑块
    var slider = document.getElementById('bibleFontSizeSlider');
    if (slider) {
      slider.addEventListener('input', function() {
        var size = parseInt(this.value);
        try { localStorage.setItem('bibleFontSize', String(size)); } catch(e) {}
        document.querySelectorAll('.bible-verse').forEach(function(el) {
          el.style.fontSize = size + 'px';
        });
      });
    }

    // 内容开关
    document.querySelectorAll('[data-toggle]').forEach(function(input) {
      input.addEventListener('change', function() {
        var key = this.dataset.toggle;
        _toggles[key] = this.checked;
        saveToggles();
      });
    });

    // 语言 checkbox 变更（联动语言包下载）
    document.querySelectorAll('.language-checkbox input[data-lang]').forEach(function(input) {
      input.addEventListener('change', function() {
        var lang = this.dataset.lang;
        if (lang === 'zh-rcv') return; // 主版本不可取消
        var idx = _activeVersions.indexOf(lang);
        if (this.checked && idx === -1) {
          // 检查是否已安装，未安装则自动触发下载
          if (window.CXLanguagePack && !window.CXLanguagePack.isInstalled(lang)) {
            if (!navigator.onLine) {
              _showBibleToast(_t('lang_pack_no_network'));
              this.checked = false;
              return;
            }
            var downloadBtn = document.querySelector('[data-action="download"][data-lang="' + lang + '"]');
            if (downloadBtn) downloadBtn.click();
            // 暂时不勾选，等下载完成后再勾选
            this.checked = false;
            return;
          }
          _activeVersions.push(lang);
        } else if (!this.checked && idx !== -1) {
          _activeVersions.splice(idx, 1);
        }
        saveActiveVersions();
        // 若当前在阅读页，重新加载数据并刷新视图（不记录历史）
        if (_currentBook && _currentChapter) {
          renderBibleView(_currentBook, _currentChapter, true);
        }
      });
    });

    // ── 语言版本管理 ──
    // 下载按钮
    document.querySelectorAll('[data-action="download"]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var lang = this.dataset.lang;
        if (!navigator.onLine) {
          _showBibleToast(_t('lang_pack_no_network'));
          return;
        }
        var progress = document.querySelector('.lang-pack-progress[data-lang="' + lang + '"]');
        var dlBtn = this;

        dlBtn.disabled = true;
        dlBtn.textContent = _t('lang_pack_downloading');
        if (progress) progress.style.display = 'block';

        if (window.CXLanguagePack) {
          window.CXLanguagePack.download(lang, function(p) {
            if (progress) {
              var fill = progress.querySelector('.progress-bar-fill');
              var text = progress.querySelector('.progress-text');
              if (fill) fill.style.width = p.percent + '%';
              if (text) text.textContent = p.percent + '%';
            }
          }).then(function() {
            _showBibleToast(_t('lang_pack_download_complete'));
            // 自动勾选该语言 checkbox
            var checkbox = document.querySelector('.language-checkbox input[data-lang="' + lang + '"]');
            if (checkbox && !checkbox.checked) {
              checkbox.checked = true;
              var idx = _activeVersions.indexOf(lang);
              if (idx === -1) _activeVersions.push(lang);
              saveActiveVersions();
            }
            // 重新渲染设置面板以更新状态
            var appContainer = document.getElementById('app');
            if (appContainer) _renderSettingsInner(appContainer);
            // 如果在阅读页，刷新视图
            if (_currentBook && _currentChapter) {
              renderBibleView(_currentBook, _currentChapter, true);
            }
          }).catch(function(err) {
            console.error('[CXBible] 语言包下载失败:', err);
            _showBibleToast(_t('lang_pack_download_failed'));
            // re-render 面板恢复状态（旧 DOM 引用已失效）
            var appContainer = document.getElementById('app');
            if (appContainer) _renderSettingsInner(appContainer);
          });
        }
      });
    });

    // 删除按钮
    document.querySelectorAll('[data-action="delete"]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var lang = this.dataset.lang;
        if (!confirm(_t('lang_pack_confirm_delete'))) return;

        if (window.CXLanguagePack) {
          window.CXLanguagePack.delete(lang).then(function() {
            // 取消该语言 checkbox
            var checkbox = document.querySelector('.language-checkbox input[data-lang="' + lang + '"]');
            if (checkbox && checkbox.checked) {
              checkbox.checked = false;
              var idx = _activeVersions.indexOf(lang);
              if (idx !== -1) _activeVersions.splice(idx, 1);
              saveActiveVersions();
            }
            _showBibleToast(_t('lang_pack_delete') + ' ✓');
            // 重新渲染设置面板
            var appContainer = document.getElementById('app');
            if (appContainer) _renderSettingsInner(appContainer);
            // 如果在阅读页，刷新视图
            if (_currentBook && _currentChapter) {
              renderBibleView(_currentBook, _currentChapter, true);
            }
          }).catch(function(err) {
            console.error('[CXBible] 语言包删除失败:', err);
            _showBibleToast(_t('lang_pack_delete') + ' ✗');
            var appContainer = document.getElementById('app');
            if (appContainer) _renderSettingsInner(appContainer);
          });
        }
      });
    });

    // 异步加载并显示包大小
    if (window.CXLanguagePack) {
      window.CXLanguagePack.getManifest().then(function(manifest) {
        manifest.packs.forEach(function(pack) {
          var el = document.querySelector('.lang-pack-size[data-lang="' + pack.lang + '"]');
          if (el) {
            var mb = (pack.size / 1048576).toFixed(1);
            el.textContent = _tf('lang_pack_size_mb', {n: mb});
          }
        });
      }).catch(function() {});
    }
  }

  // ══════════════════════════════════════════════════════════
  //  图表列表 / 读经计划（预留接口）
  // ══════════════════════════════════════════════════════════
  function renderCharts() {
    var container = document.getElementById('app');
    if (!container) return;
    window._cxShowApp();
    _hideBibleSpeechBar(); // 离开圣经视图时隐藏朗读栏

    // 从历史读取数据
    loadHistory();
    var hist = _history;

    var html = '<div class="bible-reading">';
    html += '<button class="bible-back-btn" onclick="window.CXRouter&&CXRouter.navigate(\'\')">' + esc(_t('back')) + '</button>';
    html += '<h2 style="text-align:center;margin:12px 0 20px;color:var(--heading,#2C1810)">' + esc(_t('reading_stats')) + '</h2>';

    if (!hist.length) {
      html += '<div style="padding:40px 20px;text-align:center;color:var(--text-muted,#999)">'
        + '<div style="font-size:32px;margin-bottom:12px">📊</div>'
        + '<div>' + esc(_t('no_reading_history')) + '</div>'
        + '<div style="margin-top:8px;font-size:13px">' + esc(_t('stats_hint')) + '</div>'
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
    html += '<div style="font-size:24px;font-weight:700;color:var(--brand,#8B4513)">' + uniqueBooks + '</div>';
    html += '<div style="font-size:12px;color:var(--text-muted,#999);margin-top:4px">' + esc(_t('books_read')) + '</div></div>';
    html += '<div style="background:var(--card,#fff);border-radius:12px;padding:16px 8px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.06)">';
    html += '<div style="font-size:24px;font-weight:700;color:var(--brand,#8B4513)">' + totalChapters + '</div>';
    html += '<div style="font-size:12px;color:var(--text-muted,#999);margin-top:4px">' + esc(_t('chapters_read')) + '</div></div>';
    html += '<div style="background:var(--card,#fff);border-radius:12px;padding:16px 8px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.06)">';
    html += '<div style="font-size:24px;font-weight:700;color:var(--brand,#8B4513)">' + bookmarkCount + '</div>';
    html += '<div style="font-size:12px;color:var(--text-muted,#999);margin-top:4px">' + esc(_t('fav_chapters')) + '</div></div>';
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
    html += '<div style="font-size:14px;font-weight:600;color:var(--heading,#2C1810);margin-bottom:10px">' + esc(_t('last_7_days')) + '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;text-align:center">';
    for (var di = 0; di < 7; di++) {
      var refDate = new Date(today);
      refDate.setDate(today.getDate() - (6 - di));
      var dayLabel = dayLabels[refDate.getDay()];
      var count = dayCounts[di];
      var bgColor = count > 0 ? 'var(--brand,#8B4513)' : 'var(--border,#e8e0d0)';
      var textColor = count > 0 ? '#fff' : 'var(--text-muted,#999)';
      html += '<div style="border-radius:8px;padding:8px 4px;background:' + bgColor + ';color:' + textColor + '">';
      html += '<div style="font-size:11px;opacity:.8">' + dayLabel + '</div>';
      html += '<div style="font-size:16px;font-weight:600;margin-top:4px">' + count + '</div>';
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
    html += '<div style="font-size:14px;font-weight:600;color:var(--heading,#2C1810);margin-bottom:12px">' + esc(_t('reading_progress')) + '</div>';

    html += '<div style="margin-bottom:14px">';
    html += '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">';
    html += '<span style="color:var(--text,#333)">' + esc(_t('old_testament')) + '</span><span style="color:var(--text-muted,#999)">' + otCount + '/39 ' + esc(_t('books_unit')) + ' (' + otPct + '%)</span></div>';
    html += '<div style="height:8px;background:var(--border,#e8e0d0);border-radius:4px;overflow:hidden">';
    html += '<div style="height:100%;width:' + otPct + '%;background:var(--brand,#8B4513);border-radius:4px;transition:width .3s"></div></div></div>';

    html += '<div style="margin-bottom:14px">';
    html += '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">';
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

    var illustrations = [
      { file: '18.png', title: '神新约的经纶' },
      { file: 'br.png', title: '诸天国度分别图' },
      { file: 'EO.png', title: '旧约远古近东地区' },
      { file: 'kE.png', title: '保罗的行程' },
      { file: 'KR.png', title: '七十个七与基督来临' },
      { file: 'Mr.png', title: '新约时代的巴勒斯坦' },
      { file: 'O9.png', title: '旧约时代的以色列' },
      { file: 'XJ.png', title: '耶稣基督的谱系' }
    ];

    var root = getRoot();
    var allUrls = illustrations.map(function(item) { return root + 'img/' + item.file; });

    var html = '<div class="bible-reading">';
    html += '<button class="bible-back-btn" onclick="window.CXRouter&&CXRouter.navigate(\'\')">' + esc(_t('back')) + '</button>';
    html += '<h2 style="text-align:center;margin:12px 0 8px;color:var(--heading,#2C1810)">' + esc(_t('bible_illustrations')) + '</h2>';
    html += '<div style="text-align:center;font-size:13px;color:var(--text-muted,#999);margin-bottom:16px">' + esc(_t('illustrations_hint')) + '</div>';

    html += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:0 16px">';
    for (var i = 0; i < illustrations.length; i++) {
      html += '<div class="illust-card" data-idx="' + i + '" style="background:var(--card,#fff);border-radius:12px;overflow:hidden;padding-bottom:8px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.06)">';
      html += '<img src="' + root + 'img/' + illustrations[i].file + '" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px 8px 0 0;display:block" alt="' + esc(illustrations[i].title) + '">';
      html += '<div style="font-size:13px;text-align:center;margin-top:6px;color:var(--text,#333);padding:0 6px">' + esc(illustrations[i].title) + '</div>';
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

    container.innerHTML = '<div class="bible-reading">'
      + '<button class="bible-back-btn" onclick="window.CXRouter&&CXRouter.navigate(\'\')">' + esc(_t('back')) + '</button>'
      + '<h2 style="text-align:center;margin:20px 0;color:var(--heading,#2C1810)">' + esc(_t('reading_plan')) + '</h2>'
      + '<div style="padding:20px;text-align:center;color:var(--text-muted,#999)">' + esc(_t('loading')) + '</div>'
      + '</div>';

    fetch(getRoot() + 'data/reading-plans.json')
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
    loadToggles();
    loadHistory();

    // 绑定 #app 容器事件委托（仅执行一次，不受 innerHTML 替换影响）
    _bindAppDelegation();

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
  }

  // ── 清理指定版本的内存缓存 ──
  function clearVersionCache(lang) {
    if (_versionDataCache[lang]) {
      delete _versionDataCache[lang];
    }
  }

  // ── 暴露 API ──
  window.CXBible = {
    init: init,
    refresh: function() {
      // 语言切换后重新渲染当前视图
      _t  = (window.CXI18n && window.CXI18n.t)  ? window.CXI18n.t.bind(window.CXI18n)  : function(k) { return k; };
      _tf = (window.CXI18n && window.CXI18n.tf) ? window.CXI18n.tf.bind(window.CXI18n) : function(k, v) { return k; };
      if (_currentBook && _currentChapter) {
        renderBibleView(_currentBook, _currentChapter, true);
      } else {
        renderBookList();
      }
    },
    renderBookList: renderBookList,
    renderBibleView: renderBibleView,
    renderSettings: renderSettings,
    renderCharts: renderCharts,
    renderIllustrations: renderIllustrations,
    renderReadingPlan: renderReadingPlan,
    showOutline: showOutline,
    showBookDrawer: _showBookDrawer,
    getToggles: function() { return _toggles; },
    setToggle: function(key, val) {
      if (key in _toggles) { _toggles[key] = !!val; saveToggles(); }
    },
    getActiveVersions: function() { return _activeVersions.slice(); },
    getAvailableVersions: function() { return _availableVersions.slice(); },
    clearVersionCache: clearVersionCache,
    showVerseDetail: _showDetailOverlay
  };

  // 兼容 index.html 中 CXRenderer.showOutline 的调用
  window.CXRenderer = window.CXRenderer || {};
  window.CXRenderer.showOutline = showOutline;

  // 挂载更多菜单到 CX.showMore
  window.CX = window.CX || {};
  window.CX.showMore = showMore;

  // 自动初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
