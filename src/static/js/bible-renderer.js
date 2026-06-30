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

    // 隐藏 fixed 章节栏
    var chapterBar = document.getElementById('fixedChapterBar');
    if (chapterBar) chapterBar.style.display = 'none';

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

      // 防滚动穿透 + 触摸遮罩关闭（通用机制，touchend → history.back）
      var _lockCleanup = null;
      if (window.CX && window.CX.lockOverlayScroll) {
        _lockCleanup = window.CX.lockOverlayScroll(overlay, function() { try { history.back(); } catch(e) {} });
      }

      // 关闭函数
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

      // 注册到返回栈（Android 返回键支持）
      if (window.CX && window.CX.backStack && typeof window.CX.backStack.push === 'function') {
        window.CX.backStack.push(closeDrawer);
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

    html += _renderVerses(chapterData, meta.acronym, chapter);
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
          }
        } catch(e) { /* ignore pre-render failures */ }
      });
    }).catch(function() { /* ignore pre-cache failures */ });
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

    _currentBook = bookIndex;
    _currentChapter = chapter;
    if (!skipHistory) addHistory(bookIndex, chapter);

    container.innerHTML = '<div class="bible-reading"><div style="padding:40px;text-align:center;color:var(--text-muted,#999)">' + esc(_t('loading')) + '</div></div>';

    Promise.all([loadBooksMeta(), loadBookData(bookIndex), loadBibleTopics(), loadBibleIntro(), loadBibleOutlines()]).then(function(results) {
      var html = _buildChapterInnerHtml(bookIndex, chapter);
      if (html === null) {
        container.innerHTML = '<div class="bible-reading"><div style="padding:20px;text-align:center;color:var(--text-muted,#999)">' + esc(_t('no_scripture')) + '</div></div>';
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

      container.innerHTML = html;

      // 绑定注解/串珠点击事件
      _bindVerseEvents();

      // 绑定手势导航
      _bindSwipeGesture();

      // 滚动到顶部
      window.scrollTo(0, 0);

      // 注入朗读控制栏并初始化 CXSpeech
      if (meta) _initBibleSpeech(meta, chapter);

      // 预缓存相邻章节数据（滑动动画可立即使用）
      _precachAdjacentChapters();
    }).catch(function(err) {
      console.error('[CXBible] 加载失败:', err);
      container.innerHTML = '<div class="bible-reading">'
        + '<div style="padding:40px;text-align:center">'
        + '<div style="color:var(--danger-text,#c53030);margin-bottom:16px">' + esc(_t('load_failed_retry')) + '</div>'
        + '<button onclick="window.CXBible&&CXBible.renderBibleView(' + bookIndex + ',' + chapter + ')" style="padding:8px 24px;border:1px solid var(--border,#ddd);border-radius:6px;background:var(--bg,#fff);cursor:pointer;font-size:0.875rem">' + esc(_t('retry')) + '</button>'
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
    return esc(text).replace(/&lt;W[^&]*&gt;/g, '').replace(/\{}/g, '');
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

    // ── 构建内联纲目映射 ──
    var outlineMap = {};  // verse index -> [outline items]
    if (_toggles.showOutline && _outlinesData) {
      var bookOutlines = _outlinesData[String(_currentBook)];
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
      // ── 在 section 变化点前插入纲目 ──
      if (outlineMap[vIdx]) {
        var outlineItems = outlineMap[vIdx];
        for (var oi = 0; oi < outlineItems.length; oi++) {
          var item = outlineItems[oi];
          var cssLevel = Math.max(0, Math.min((item.level || 1) - 1, 5));
          html += '<div class="bible-outline-inline outline-level-' + cssLevel + '">' + esc(item.text) + '</div>';
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
        if (lastSection !== -1 && _toggles.showVerseDivider) {
          html += '<hr class="verse-divider" />';
        }
        html += '<div class="' + verseClass + '" data-section="' + sec + '">';
        html += '<span class="verse-num">' + sec + '</span>';
      } else if (isNewSection && flag !== 0) {
        // 新节的第一个半节
        var subLabel = (flag === 1) ? '上' : (flag === 3 ? '中' : '下');
        if (lastSection !== -1 && _toggles.showVerseDivider) {
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
        // DOM 中 zh-rcv（primary）始终紧跟 verse-num（flex 布局需要）
        // 然后按排序顺序渲染其他 secondary 版本
        html += '<div class="bible-verse-lang primary" data-lang="zh-rcv">';
        html += renderVerseText(content, bookAcronym, chapter, sec, flag);
        html += '</div>';
        if (isNewSection) {
          orderedAll.forEach(function(lang) {
            if (lang === 'zh-rcv') return;
            var secMap = secondaryMaps[lang] || {};
            var secVerse = secMap[sec];
            if (secVerse) {
              var texts = Array.isArray(secVerse)
                ? secVerse.map(function(v) { return v.text; }).join('')
                : secVerse.text;
              if (texts) {
                html += '<div class="bible-verse-lang secondary" data-lang="' + esc(lang) + '">';
                html += (lang === 'he-el') ? _renderStrongText(texts)
                       : (lang === 'he-orig') ? _stripStrongsTags(texts)
                       : esc(texts);
                html += '</div>';
              }
            }
          });
        }
      } else {
        html += renderVerseText(content, bookAcronym, chapter, sec, flag);
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
    var html = '<div class="verse-detail-card">'
      + '<div class="verse-detail-text">' + htmlContent + '</div>'
      + '<div class="verse-detail-footer">'
      + '<span class="verse-detail-source">' + esc(source) + '</span>'
      + '<button class="verse-detail-copy">' + esc(_t('copy_all')) + '</button>'
      + '</div>'
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
  //  手势导航（左右滑动切换章节 — 实时跟手 + 滑动动画）
  // ══════════════════════════════════════════════════════════
  var _swipeBound = false;
  var _isAnimating = false;
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

  // ── 滑动动画：旧页滑出 + 新页滑入（仅滑动经文内容区） ──
  function _animateSwipe(direction) {
    // direction: -1 = 右滑→上一章, 1 = 左滑→下一章
    var target = _resolveChapter(direction);
    if (!target) return false;

    // 优先从预渲染缓存获取
    var newHtml = null;
    if (_preRenderedHtml[target.book] && _preRenderedHtml[target.book][target.chapter]) {
      newHtml = _preRenderedHtml[target.book][target.chapter];
    } else {
      newHtml = _buildChapterInnerHtml(target.book, target.chapter);
    }
    if (!newHtml) {
      // 先尝试异步加载数据再重试动画，而非直接 fallback
      _isAnimating = true;
      loadBookData(target.book).then(function() {
        newHtml = _buildChapterInnerHtml(target.book, target.chapter);
        if (newHtml) {
          _isAnimating = false;
          // 缓存结果
          if (!_preRenderedHtml[target.book]) _preRenderedHtml[target.book] = {};
          _preRenderedHtml[target.book][target.chapter] = newHtml;
          // 重试动画
          _animateSwipe(direction);
        } else {
          _isAnimating = false;
          // 最终 fallback
          window.CXRouter && window.CXRouter.navigate('bible/' + target.book + '/' + target.chapter);
        }
      }).catch(function() {
        _isAnimating = false;
        window.CXRouter && window.CXRouter.navigate('bible/' + target.book + '/' + target.chapter);
      });
      return true; // 已处理，阻止弹回动画
    }

    _isAnimating = true;
    var container = document.getElementById('app');
    if (!container) { _isAnimating = false; return false; }

    var W = container.offsetWidth;
    var contentEl = container.querySelector('.bible-reading');
    if (!contentEl) { _isAnimating = false; return false; }

    // 创建滑动容器（仅包含经文内容）
    var slider = document.createElement('div');
    slider.className = 'swipe-slider';
    slider.style.cssText = 'position:relative;overflow:hidden;width:' + W + 'px;height:' + contentEl.offsetHeight + 'px;';

    var oldPage = document.createElement('div');
    oldPage.style.cssText = 'position:absolute;top:0;left:0;width:100%;will-change:transform;';
    oldPage.appendChild(contentEl);

    var newPage = document.createElement('div');
    var offsetPct = direction > 0 ? 100 : -100;
    newPage.style.cssText = 'position:absolute;top:0;left:0;width:100%;transform:translateX(' + offsetPct + '%);will-change:transform;';
    newPage.innerHTML = newHtml;

    slider.appendChild(oldPage);
    slider.appendChild(newPage);
    container.appendChild(slider);

    // 强制回流后启动过渡动画
    void newPage.offsetHeight;
    var ease = 'transform 0.3s cubic-bezier(.25,.1,.25,1)';
    oldPage.style.transition = ease;
    newPage.style.transition = ease;

    var outPct = direction > 0 ? -100 : 100;
    requestAnimationFrame(function() {
      oldPage.style.transform = 'translateX(' + outPct + '%)';
      newPage.style.transform = 'translateX(0)';
    });

    // 兆底定时器（防止 transitionend 不触发）
    var cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;

      _isAnimating = false;
      _currentBook = target.book;
      _currentChapter = target.chapter;
      addHistory(target.book, target.chapter);

      // 恢复为正常页面内容：直接将 newPage 子节点移回 container，避免空白间隙
      container.innerHTML = '';
      if (newPage) {
        while (newPage.firstChild) {
          container.appendChild(newPage.firstChild);
        }
      }
      // 移除 slider（此时已空或只有 oldPage）
      if (slider.parentNode) slider.parentNode.removeChild(slider);

      _bindVerseEvents();
      _bindSwipeGesture();
      window.scrollTo(0, 0);

      // 更新章节标题
      var chapterBar = document.getElementById('fixedChapterBar');
      if (chapterBar) {
        var titleEl = chapterBar.querySelector('.chapter-bar-title');
        var meta = getBookMeta(target.book);
        if (titleEl && meta) titleEl.textContent = meta.name + ' ' + target.chapter;
      }

      // 更新 document.title
      var meta = getBookMeta(target.book);
      if (meta) {
        document.title = meta.name + ' ' + target.chapter;
        _initBibleSpeech(meta, target.chapter);
      }

      _precachAdjacentChapters();

      // 同步路由（使用 replaceState 避免触发 hashchange 事件导致二次渲染）
      var newHash = '#/bible/' + target.book + '/' + target.chapter;
      if (window.location.hash !== newHash) {
        try {
          history.replaceState(null, '', newHash);
        } catch(e) {
          if (window.CX && window.CX.backStack && window.CX.backStack.skipNext) window.CX.backStack.skipNext();
          window.location.hash = newHash; // fallback
        }
      }
    }

    newPage.addEventListener('transitionend', function handler() {
      newPage.removeEventListener('transitionend', handler);
      cleanup();
    });

    // 350ms 兆底
    setTimeout(cleanup, 350);

    return true;
  }

  function _bindSwipeGesture() {
    if (_swipeBound) return;
    _swipeBound = true;

    var container = document.getElementById('app');
    if (!container) return;

    var startX = 0, startY = 0, startTime = 0;
    var isDragging = false, isHorizontal = null;
    var contentEl = null; // 正在被拖拽的 .bible-reading 元素

    container.addEventListener('touchstart', function(e) {
      if (_isAnimating) return;
      var target = e.target;
      if (target.closest && target.closest('button, a, input, #verseDetailDialog, .bible-drawer, .more-menu')) return;
      var sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startTime = Date.now();
      isDragging = true;
      isHorizontal = null;
      contentEl = container.querySelector('.bible-reading');

      // 提前加载可能需要的相邻章节数据
      try {
        var prev = _resolveChapter(-1);
        var next = _resolveChapter(1);
        if (prev && !_bookDataCache[prev.book]) loadBookData(prev.book);
        if (next && !_bookDataCache[next.book]) loadBookData(next.book);
      } catch(e) { /* ignore */ }
    }, {passive: true});

    container.addEventListener('touchmove', function(e) {
      if (!isDragging || _isAnimating) return;
      var dx = e.touches[0].clientX - startX;
      var dy = e.touches[0].clientY - startY;

      // 方向判定
      if (isHorizontal === null) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        isHorizontal = Math.abs(dx) >= 2 * Math.abs(dy);
      }
      if (!isHorizontal) { isDragging = false; return; }

      // 边界阻尼：第一卷第一章左滑 / 启示录末章右滑
      var W = container.offsetWidth;
      var atStart = (_currentBook <= 1 && _currentChapter <= 1 && dx > 0);
      var atEnd = (_currentBook >= 66 && _currentChapter >= _getChapterCount(66) && dx < 0);
      if (atStart || atEnd) dx = dx * 0.2;

      // 跟手移动内容
      if (contentEl) {
        contentEl.style.transition = 'none';
        contentEl.style.transform = 'translateX(' + dx + 'px)';
        contentEl.style.willChange = 'transform';
      }
    }, {passive: true});

    container.addEventListener('touchend', function(e) {
      if (!isDragging) return;
      isDragging = false;
      if (isHorizontal !== true || !contentEl) { _resetDrag(); return; }

      var dx = e.changedTouches[0].clientX - startX;
      var dt = Date.now() - startTime;
      var vel = Math.abs(dx) / (dt || 1);
      var ratio = Math.abs(dx) / container.offsetWidth;
      var direction = dx < 0 ? 1 : -1;

      if (ratio > 0.20 || vel > 0.3) {
        // 达到阈值 → 滑动到新章节
        if (_animateSwipe(direction)) return;
      }

      // 未达到阈值 → 弹回原位
      contentEl.style.transition = 'transform 0.25s cubic-bezier(.25,.1,.25,1)';
      contentEl.style.transform = 'translateX(0)';
      var el = contentEl;
      setTimeout(function() {
        el.style.transition = '';
        el.style.transform = '';
        el.style.willChange = '';
      }, 280);
      _resetDrag();
    });

    function _resetDrag() {
      isHorizontal = null;
      contentEl = null;
    }
  }


  // ══════════════════════════════════════════════════════════
  //  更多菜单
  // ══════════════════════════════════════════════════════════
  function showMore() {
    var html = '<div class="more-menu" style="padding:4px 0">';

    // ── 默认可见项 ──
    html += '<div class="more-menu-item" data-action="charts" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:0.938rem;border-bottom:1px solid var(--border,#eee)">';
    html += '<span style="font-size:1.25rem">📊</span><span>' + esc(_t('reading_stats')) + '</span></div>';

    html += '<div class="more-menu-item" data-action="illustrations" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:0.938rem;border-bottom:1px solid var(--border,#eee)">';
    html += '<span style="font-size:1.25rem">🖼️</span><span>' + esc(_t('bible_illustrations')) + '</span></div>';

    if (_currentBook) {
      html += '<div class="more-menu-item" data-action="bookIntro" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:0.938rem;border-bottom:1px solid var(--border,#eee)">';
      html += '<span style="font-size:1.25rem">📖</span><span>' + esc(_t('view_book_intro')) + '</span></div>';

      html += '<div class="more-menu-item" data-action="bookOutline" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:0.938rem;border-bottom:1px solid var(--border,#eee)">';
      html += '<span style="font-size:1.25rem">📋</span><span>' + esc(_t('view_book_outline')) + '</span></div>';

      html += '<div class="more-menu-item" data-action="parsingView" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:0.938rem;border-bottom:1px solid var(--border,#eee)">';
      html += '<span style="font-size:1.25rem">🔍</span><span>' + esc(_t('parsing_view')) + '</span></div>';
    }

    // ── 折叠区（默认展开显示） ──
    html += '<div id="moreMenuExtra">';

    // 分割线
    html += '<div style="height:1px;background:var(--border,#eee);margin:4px 0"></div>';

    html += '<div class="more-menu-item" data-action="help" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:0.938rem;border-bottom:1px solid var(--border,#eee)">';
    html += '<span style="font-size:1.25rem">📖</span><span>' + esc(_t('user_guide')) + '</span></div>';

    // 清理数据
    html += '<div class="more-menu-item" data-action="clearData" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:0.938rem;border-bottom:1px solid var(--border,#eee)">';
    html += '<span style="font-size:1.25rem">🧹</span><span>清理数据</span></div>';

    // 发送桌面（条件显示）
    var _ua = navigator.userAgent;
    var _isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    var _isAndroid = /Android/i.test(_ua);
    var _isIOS = /iPad|iPhone|iPod/.test(_ua) && !window.MSStream;
    var _isStandalone = (window.navigator.standalone === true) || window.matchMedia('(display-mode: standalone)').matches;
    var _showInstall = (_isIOS && !_isStandalone) || !_isCapacitor;
    if (_showInstall) {
      html += '<div class="more-menu-item" data-action="install" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:0.938rem;border-bottom:1px solid var(--border,#eee)">';
      html += '<span style="font-size:1.25rem">📲</span><span>发送桌面</span></div>';
    }

    // 安卓APK（条件显示：安卓浏览器且非 Capacitor）
    if (_isAndroid && !_isCapacitor) {
      html += '<div class="more-menu-item" data-action="androidApk" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:0.938rem;border-bottom:1px solid var(--border,#eee)">';
      html += '<span style="font-size:1.25rem">📱</span><span>安卓APK</span></div>';
    }

    // 检查更新（条件显示：Capacitor 或 PWA）
    if (_isCapacitor || (_isStandalone && ('caches' in window))) {
      html += '<div class="more-menu-item" data-action="checkUpdate" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:0.938rem;border-bottom:1px solid var(--border,#eee)">';
      html += '<span style="font-size:1.25rem">🔄</span><span>检查更新</span></div>';
    }

    // 问题反馈
    html += '<div class="more-menu-item" data-action="feedback" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:0.938rem;border-bottom:1px solid var(--border,#eee)">';
    html += '<span style="font-size:1.25rem">💬</span><span>问题反馈</span></div>';

    // 顾念微工（使用超过 5 分钟后显示）
    var _showSponsor = false;
    try {
      var _firstUse = parseInt(localStorage.getItem('cx_first_use') || '0', 10);
      var _elapsed = _firstUse ? (Date.now() - _firstUse) : 0;
      if (_elapsed >= 5 * 60 * 1000) _showSponsor = true;
    } catch(e) {}
    if (_showSponsor) {
      html += '<div class="more-menu-item" data-action="sponsor" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:0.938rem">';
      html += '<span style="font-size:1.25rem">❤️</span><span>顾念微工</span></div>';
    }

    // 分割线
    html += '<div style="height:1px;background:var(--border,#eee);margin:4px 0"></div>';

    // 偏好设置（自动检查更新 - 条件显示：Capacitor 或 PWA）
    if (_isCapacitor || (_isStandalone && ('caches' in window))) {
      var _autoChecked = false;
      try { _autoChecked = localStorage.getItem('cx_auto_check_update') === '1'; } catch(e) {}
      html += '<div style="padding:12px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border,#eee)">';
      html += '<div style="display:flex;align-items:center;gap:12px"><span style="font-size:1.25rem">⚙️</span><div>';
      html += '<div style="font-size:0.938rem">偏好设置</div>';
      html += '<div style="font-size:0.75rem;color:var(--text-muted,#999);margin-top:2px">自动检查更新</div>';
      html += '</div></div>';
      html += '<label class="pref-toggle" style="position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0">';
      html += '<input type="checkbox" id="moreAutoCheckToggle"' + (_autoChecked ? ' checked' : '') + ' style="opacity:0;width:0;height:0">';
      html += '<span class="pref-toggle-slider" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;border-radius:24px;transition:.3s"></span>';
      html += '</label></div>';
    }

    // 高级（开发者模式）
    var _devChecked = false;
    try { _devChecked = localStorage.getItem('cx_dev_mode') === '1'; } catch(e) {}
    html += '<div style="padding:12px 16px;display:flex;align-items:center;justify-content:space-between">';
    html += '<div style="display:flex;align-items:center;gap:12px"><span style="font-size:1.25rem">🔧</span><div>';
    html += '<div style="font-size:0.938rem">高级</div>';
    html += '<div style="font-size:0.75rem;color:var(--text-muted,#999);margin-top:2px">开发者模式</div>';
    html += '</div></div>';
    html += '<label class="pref-toggle" style="position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0">';
    html += '<input type="checkbox" id="moreDevModeToggle"' + (_devChecked ? ' checked' : '') + ' style="opacity:0;width:0;height:0">';
    html += '<span class="pref-toggle-slider" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;border-radius:24px;transition:.3s"></span>';
    html += '</label></div>';

    html += '</div>'; // 结束折叠区

    html += '</div>';

    _showDetailOverlay(html, _t('more'), '');

    // 绑定菜单项点击
    setTimeout(function() {
      var overlay = document.getElementById('verseDetailDialog');
      if (!overlay) return;
      // 隐藏复制按钮
      var copyBtn = overlay.querySelector('.verse-detail-copy');
      if (copyBtn) copyBtn.style.display = 'none';

      var items = overlay.querySelectorAll('.more-menu-item');
      items.forEach(function(item) {
        item.addEventListener('click', function() {
          var action = this.dataset.action;
          // 关闭浮层
          var overlayEl = document.getElementById('verseDetailDialog');
          if (overlayEl) {
            window.CX.backStack.pop(true);
            if (overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
          }
          setTimeout(function() {
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
              // 查看本卷书介
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
              // 查看本卷纲目
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
                        outlineHtml += '<div style="padding:4px 0 4px 12px;font-size:0.875rem;color:var(--text-secondary,#555)">';
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
            } else if (action === 'parsingView') {
              // 打开逐词解析视图
              if (window.CXParsingView && _currentBook && _currentChapter) {
                window.CXParsingView.showParsingView(_currentBook, _currentChapter, 1);
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
          }, 320);
        });
      });

      // 偏好设置 toggle（自动检查更新）
      var autoToggle = overlay.querySelector('#moreAutoCheckToggle');
      if (autoToggle) {
        autoToggle.addEventListener('change', function() {
          var on = this.checked;
          try {
            if (on) localStorage.setItem('cx_auto_check_update', '1');
            else localStorage.removeItem('cx_auto_check_update');
          } catch(e) {}
        });
      }

      // 高级 toggle（开发者模式）
      var devToggle = overlay.querySelector('#moreDevModeToggle');
      if (devToggle) {
        devToggle.addEventListener('change', function() {
          var on = this.checked;
          try { localStorage.setItem('cx_dev_mode', on ? '1' : '0'); } catch(e) {}
          if (on && window.CXDevConsole) window.CXDevConsole.init();
          else if (!on && window.CXDevConsole) window.CXDevConsole.destroy();
        });
      }
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
        if (!isActive && _activeVersions.length >= 4) html += ' disabled';
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

    // 语言 checkbox 变更（所有版本已内置，直接切换显示）
    document.querySelectorAll('.language-checkbox input[data-lang]').forEach(function(input) {
      input.addEventListener('change', function() {
        var lang = this.dataset.lang;
        if (lang === 'zh-rcv') return; // 主版本不可取消
        var idx = _activeVersions.indexOf(lang);
        if (this.checked && idx === -1) {
          if (_activeVersions.length >= 4) {
            this.checked = false;
            return;
          }
          _activeVersions.push(lang);
        } else if (!this.checked && idx !== -1) {
          _activeVersions.splice(idx, 1);
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
      { file: '18.png', title: '神新约的经纶' },
      { file: 'br.png', title: '诸天国度分别图' },
      { file: 'EO.png', title: '旧约远古近东地区' },
      { file: 'kE.png', title: '保罗的行程' },
      { file: 'KR.png', title: '七十个七与基督来临' },
      { file: 'Mr.png', title: '新约时代的巴勒斯坦' },
      { file: 'NW.png', title: '兽的数字' },
      { file: 'O9.png', title: '旧约时代的以色列' },
      { file: 'XJ.png', title: '耶稣基督的谱系' }
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
      _stopTTSIfPlaying();
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
      if (fromIndex <= 0 || toIndex <= 0) return false; // 主版本(索引0)不可移动
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
      if (lang === 'zh-rcv') return false; // 主版本不可移除
      var idx = _activeVersions.indexOf(lang);
      if (idx === -1) return false;
      _activeVersions.splice(idx, 1);
      saveActiveVersions();
      return true;
    },
    setActiveVersions: function(order) {
      if (!Array.isArray(order) || !order.length) return false;
      if (order[0] !== 'zh-rcv') return false; // 主版本必须在首位
      _activeVersions = order.slice();
      saveActiveVersions();
      return true;
    },
    showVerseDetail: _showDetailOverlay,
    getLatestHistory: function() {
      return _history.length > 0 ? _history[0] : null;
    }
  };

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
