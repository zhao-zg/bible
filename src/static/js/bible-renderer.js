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

  // ── 旧约/新约分界 ──
  var OT_END = 39; // 旧约 1-39，新约 40-66

  // ── 内容显示开关 ──
  var _toggles = {
    showTheme: true,
    showIntro: true,
    showOutline: true,
    showFootnotes: true,
    showBeads: true,
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
    if (diff < 60000) return '刚刚';
    var minutes = Math.floor(diff / 60000);
    if (minutes < 60) return minutes + '分钟前';
    var hours = Math.floor(diff / 3600000);
    if (hours < 24) return hours + '小时前';
    var days = Math.floor(diff / 86400000);
    if (days < 30) return days + '天前';
    var months = Math.floor(days / 30);
    return months + '月前';
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

  function loadBookData(bookIndex) {
    if (_bookDataCache[bookIndex]) return Promise.resolve(_bookDataCache[bookIndex]);
    var idx = String(bookIndex).padStart(2, '0');
    return fetch(getRoot() + 'data/bible/' + idx + '.json')
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
      html += '<input type="text" class="book-nav-search" id="bibleSearchInput" placeholder="搜索经文和注解" />';
      html += '</div>';

      // 三标签页
      html += '<div class="book-nav-tabs">';
      html += '<button class="book-nav-tab' + (_currentTab === 'books' ? ' active' : '') + '" data-tab="books">书卷</button>';
      html += '<button class="book-nav-tab' + (_currentTab === 'favorites' ? ' active' : '') + '" data-tab="favorites">收藏</button>';
      html += '<button class="book-nav-tab' + (_currentTab === 'history' ? ' active' : '') + '" data-tab="history">历史</button>';
      html += '</div>';

      // 双栏主体
      html += '<div class="book-nav-body" id="bookNavBody">';
      html += _renderBookNavContent(books);
      html += '</div>';

      // 底部旧约/新约切换
      html += '<div class="testament-tabs">';
      html += '<button class="testament-tab' + (_currentTestament === 'ot' ? ' active' : '') + '" data-testament="ot">旧约</button>';
      html += '<button class="testament-tab' + (_currentTestament === 'nt' ? ' active' : '') + '" data-testament="nt">新约</button>';
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
      html += '第' + cnChapter(i).replace('章','') + '章';
      html += '</div>';
    }
    return html;
  }

  function _renderHistoryTab() {
    if (!_history.length) {
      return '<div style="padding:40px 20px;text-align:center;color:var(--text-muted,#999);width:100%">暂无浏览记录</div>';
    }
    var html = '<div style="width:100%;overflow-y:auto;-webkit-overflow-scrolling:touch">';
    _history.forEach(function(h) {
      var meta = getBookMeta(h.bookIndex);
      html += '<div class="chapter-list-item" data-book="' + h.bookIndex + '" data-chapter="' + h.chapter + '">';
      html += esc(meta.name || '') + ' 第' + h.chapter + '章';
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
        + '<div>暂无收藏</div>'
        + '<div style="margin-top:8px;font-size:13px">在阅读页点击星标按钮添加收藏</div>'
        + '</div>';
    }
    var html = '<div style="width:100%;overflow-y:auto;-webkit-overflow-scrolling:touch">';
    favs.forEach(function(f) {
      var meta = getBookMeta(f.bookIndex);
      var name = f.bookName || meta.name || '书卷' + f.bookIndex;
      html += '<div class="chapter-list-item" data-book="' + f.bookIndex + '" data-chapter="' + f.chapter + '" style="display:flex;justify-content:space-between;align-items:center">';
      html += '<span>' + esc(name) + ' 第' + f.chapter + '章</span>';
      html += '<span style="font-size:11px;color:var(--text-muted,#999);white-space:nowrap;margin-left:8px">' + _relativeTime(f.time) + '</span>';
      html += '</div>';
    });
    html += '</div>';
    return html;
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
        '<button class="control-btn play-pause-btn" id="playPauseBtn" title="播放/暂停" aria-label="播放">' +
          '<span class="play-icon">▶</span>' +
          '<span class="pause-icon" style="display:none;">⏸</span>' +
        '</button>' +
        '<button class="control-btn loop-btn" id="loopBtn" title="只播放当前页面" aria-label="只播放当前页面">①</button>' +
        '<div class="progress-section">' +
          '<div class="progress-column">' +
            '<input type="range" id="progressBar" class="progress-bar" min="0" max="100" value="0" step="0.1">' +
            '<span class="speech-time" id="speechTime">00:00 / 00:00</span>' +
          '</div>' +
          '<select id="rateSelect" class="control-select" title="语速">' +
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
        lang: 'zh-CN'
      });
    }
  }

  // ══════════════════════════════════════════════════════════
  //  经文阅读视图
  // ══════════════════════════════════════════════════════════
  function renderBibleView(bookIndex, chapter) {
    var container = document.getElementById('app');
    if (!container) return;
    window._cxShowApp();

    _currentBook = bookIndex;
    _currentChapter = chapter;
    addHistory(bookIndex, chapter);

    container.innerHTML = '<div class="bible-reading"><div style="padding:40px;text-align:center;color:var(--text-muted,#999)">加载中…</div></div>';

    Promise.all([loadBooksMeta(), loadBookData(bookIndex)]).then(function(results) {
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
      html += '<button class="bible-back-btn" onclick="window.CXRouter&&CXRouter.navigate(\'\')">◀ 书卷导航</button>';

      // 标题（含收藏按钮）
      var isFav = _isFavorite(bookIndex, chapter);
      html += '<div class="bible-title" style="display:flex;align-items:center;justify-content:space-between">';
      html += '<span>' + esc(meta.name) + ' ' + chapter + '</span>';
      html += '<button class="bible-fav-btn" id="bibleFavBtn" data-book="' + bookIndex + '" data-chapter="' + chapter + '" data-name="' + esc(meta.name) + '" style="background:none;border:none;font-size:20px;cursor:pointer;padding:4px 8px;color:' + (isFav ? '#f5a623' : 'var(--text-muted,#999)') + '">' + (isFav ? '★' : '☆') + '</button>';
      html += '</div>';

      if (!chapterData || !chapterData.verses || !chapterData.verses.length) {
        html += '<div style="padding:20px;text-align:center;color:var(--text-muted,#999)">暂无经文数据</div>';
        html += '</div>';
        container.innerHTML = html;
        return;
      }

      // 元数据区（受开关控制）
      if (_toggles.showIntro) {
        html += _renderMetadata(bookData, chapterData);
      }

      // 主题摘要（受开关控制）
      if (_toggles.showTheme) {
        html += _renderThemeText(chapterData);
      }

      // 纲目（受开关控制）
      if (_toggles.showOutline) {
        html += _renderOutline(chapterData);
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
        + '<button class="bible-back-btn" onclick="window.CXRouter&&CXRouter.navigate(\'\')">◀ 书卷导航</button>'
        + '<div style="padding:40px;text-align:center;color:var(--danger-text,#c53030)">加载失败，请重试</div>'
        + '</div>';
    });
  }

  // ── 元数据渲染 ──
  function _renderMetadata(bookData, chapterData) {
    // 目前数据中没有单独的 metadata 字段
    // 这里预留结构，后续数据扩展时可用
    return '';
  }

  // ── 主题摘要 ──
  function _renderThemeText(chapterData) {
    // 主题摘要通常在第0节的标题中，暂不渲染（数据中无此字段）
    return '';
  }

  // ── 纲目 ──
  function _renderOutline(chapterData) {
    // 纲目数据暂未包含在 JSON 中，预留接口
    return '';
  }

  // ── 经文正文 ──
  function _renderVerses(chapterData, bookAcronym, chapter) {
    var html = '';
    var lastSection = -1;

    chapterData.verses.forEach(function(verse) {
      var sec = verse.section;
      var flag = verse.flag || 0;
      var content = verse.content || '';

      // 节号分隔
      if (sec !== lastSection && flag === 0) {
        if (lastSection !== -1 && _toggles.showVerseDivider) {
          html += '<hr class="verse-divider" />';
        }
        html += '<div class="bible-verse" data-section="' + sec + '">';
        html += '<span class="verse-num">' + sec + '</span> ';
      } else if (sec !== lastSection && flag !== 0) {
        // 带上下半节标记
        html += '<div class="bible-verse" data-section="' + sec + '">';
        html += '<span class="verse-num">' + sec + '</span> ';
      } else if (flag !== 0) {
        // 同一节的下半节
        html += '<div class="bible-verse" data-section="' + sec + '" data-flag="' + flag + '">';
      }

      // 经文文本
      html += renderVerseText(content, bookAcronym, chapter, sec, flag);
      html += '</div>';

      // 注解（内联显示，受开关控制）
      if (_toggles.showFootnotes && verse.footnotes && verse.footnotes.length) {
        verse.footnotes.forEach(function(fn) {
          html += '<div class="bible-footnote-inline" data-fn-seq="' + fn.seq + '">';
          html += '<span class="fn-num">' + fn.seq + '</span> ';
          html += _renderFootnoteText(fn.note);
          html += '</div>';
        });
      }

      // 串珠（内联显示，受开关控制）
      if (_toggles.showBeads && verse.beads && verse.beads.length) {
        verse.beads.forEach(function(bead) {
          html += '<div class="bible-bead-inline" data-bead-seq="' + esc(bead.seq) + '">';
          html += '<span class="bead-letter">' + esc(bead.seq) + '</span> ';
          html += _renderBeadText(bead.bead);
          html += '</div>';
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
  function _bindVerseEvents() {
    if (_verseEventsBound) return;
    var container = document.getElementById('app');
    if (!container) return;
    _verseEventsBound = true;

    container.addEventListener('click', function(e) {
      var t = e.target;

      // 注解上标点击 → 打开弹框
      if (t.classList && t.classList.contains('fn-ref') && t.dataset) {
        e.preventDefault();
        e.stopPropagation();
        if (window.CXScripturePopup && window.CXScripturePopup.open) {
          // 通过 scripture-popup 显示注解
          var vkey = t.dataset.vkey;
          var fn = t.dataset.fn;
          _showFootnotePopup(vkey, fn);
        }
        return;
      }

      // 串珠上标点击 → 打开弹框
      if (t.classList && t.classList.contains('xref-ref') && t.dataset) {
        e.preventDefault();
        e.stopPropagation();
        _showBeadPopup(t.dataset.vkey, t.dataset.xr);
        return;
      }
    });
  }

  // ── 注解浮层 ──
  function _showFootnotePopup(verseKey, fnNum) {
    var bookData = _bookDataCache[_currentBook];
    if (!bookData) return;

    // 从缓存数据中找到对应注解
    var noteText = '';
    if (bookData.chapters && _currentChapter) {
      for (var ci = 0; ci < bookData.chapters.length; ci++) {
        if (bookData.chapters[ci].chapter !== _currentChapter) continue;
        var verses = bookData.chapters[ci].verses;
        for (var vi = 0; vi < verses.length; vi++) {
          if (verses[vi].footnotes) {
            for (var fi = 0; fi < verses[vi].footnotes.length; fi++) {
              var fn = verses[vi].footnotes[fi];
              if (String(fn.seq) === String(fnNum)) {
                noteText = fn.note || '';
                break;
              }
            }
          }
          if (noteText) break;
        }
        if (noteText) break;
      }
    }

    if (!noteText) {
      noteText = '（未找到注解）';
    }

    var escNote = esc(noteText);
    var safeHtml = escNote.replace(/ˍ/g, '<br>');
    _showDetailOverlay(
      safeHtml,
      verseKey + ' 注' + fnNum,
      noteText
    );
  }

  // ── 串珠浮层 ──
  function _showBeadPopup(verseKey, letter) {
    var bookData = _bookDataCache[_currentBook];
    if (!bookData) return;

    var beadText = '';
    if (bookData.chapters && _currentChapter) {
      for (var ci = 0; ci < bookData.chapters.length; ci++) {
        if (bookData.chapters[ci].chapter !== _currentChapter) continue;
        var verses = bookData.chapters[ci].verses;
        for (var vi = 0; vi < verses.length; vi++) {
          if (verses[vi].beads) {
            for (var bi = 0; bi < verses[vi].beads.length; bi++) {
              var bead = verses[vi].beads[bi];
              if (bead.seq === letter) {
                beadText = bead.bead || '';
                break;
              }
            }
          }
          if (beadText) break;
        }
        if (beadText) break;
      }
    }

    if (!beadText) {
      beadText = '（未找到串珠）';
    }

    _showDetailOverlay(
      esc(beadText),
      verseKey + ' 串' + letter,
      beadText
    );
  }

  // ── 通用浮层 ──
  function _showDetailOverlay(htmlContent, source, rawText) {
    // 移除已有浮层
    var existing = document.querySelector('.verse-detail-overlay');
    if (existing) existing.parentNode.removeChild(existing);

    var overlay = document.createElement('div');
    overlay.className = 'verse-detail-overlay';
    overlay.innerHTML = '<div class="verse-detail-card">'
      + '<div class="verse-detail-text">' + htmlContent + '</div>'
      + '<div class="verse-detail-footer">'
      + '<span class="verse-detail-source">' + esc(source) + '</span>'
      + '<button class="verse-detail-copy">全部复制</button>'
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
            copyBtn.textContent = '已复制';
            setTimeout(function() { copyBtn.textContent = '全部复制'; }, 1500);
          });
        } else {
          // 回退
          var ta = document.createElement('textarea');
          ta.value = rawText || '';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          copyBtn.textContent = '已复制';
          setTimeout(function() { copyBtn.textContent = '全部复制'; }, 1500);
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
      html += '<span style="color:var(--brand,#8B4513);font-weight:600;margin-right:8px">段 ' + (idx + 1) + '</span>';
      html += '<span style="color:var(--text,#333)">' + esc(sec.preview) + '…</span>';
      html += '</div>';
    });
    html += '</div>';

    _showDetailOverlay(html, esc(meta.name) + ' ' + _currentChapter + ' 纲目', '');

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
    html += '<span style="font-size:20px">📊</span><span>阅读统计</span></div>';

    html += '<div class="more-menu-item" data-action="help" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:15px;border-bottom:1px solid var(--border,#eee)">';
    html += '<span style="font-size:20px">📖</span><span>使用说明</span></div>';

    if (_currentBook) {
      html += '<div class="more-menu-item" data-action="bookmark" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:15px;border-bottom:1px solid var(--border,#eee)">';
      html += '<span style="font-size:20px">🔖</span><span>添加书签</span></div>';
    }

    html += '</div>';

    _showDetailOverlay(html, '更多', '');

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
            } else if (action === 'help') {
              _showDetailOverlay(
                '<div style="line-height:1.8;font-size:14px">'
                + '<p>📅 点击底部工具栏书卷导航按钮选择书卷开始阅读</p>'
                + '<p>🔊 朗读按钮可开启语音朗读</p>'
                + '<p>Aa 调整字号和阅读主题</p>'
                + '<p>📑 目录按钮查看当前章节纲目</p>'
                + '<p>⭐ 标题栏星标可收藏当前章节</p>'
                + '</div>',
                '使用说明',
                ''
              );
            } else if (action === 'bookmark') {
              // 添加书签
              var meta = getBookMeta(_currentBook);
              var title = (meta.name || '') + ' 第' + _currentChapter + '章';
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
                      if (!_bmDone) { _bmDone = true; _showBibleToast('已添加书签 ✓'); }
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
                        _showBibleToast('已添加书签 ✓');
                      } catch(e) {
                        _showBibleToast('⚠ 添加书签失败');
                      }
                    });
                  } else {
                    // CXBookmark.add 未返回 Promise，直接视为成功
                    if (!_bmDone) { _bmDone = true; _showBibleToast('已添加书签 ✓'); }
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
                      _showBibleToast('已添加书签 ✓');
                    } catch(e2) {
                      _showBibleToast('⚠ 添加书签失败');
                    }
                  }
                }
                // 安全超时：若 CXBookmark.add() 2秒内无任何回调，强制显示提示
                setTimeout(function() {
                  if (!_bmDone) {
                    _bmDone = true;
                    _showBibleToast('已添加书签 ✓');
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
                  _showBibleToast('已添加书签 ✓');
                } catch(e) {
                  _showBibleToast('⚠ 添加书签失败');
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
    _hideBibleSpeechBar(); // 离开圣经视图时隐藏朗读栏

    var html = '<div class="settings-panel">';
    html += '<button class="bible-back-btn" onclick="window.CXRouter&&CXRouter.navigate(\'\')">◀ 返回</button>';
    html += '<h2 style="text-align:center;margin:12px 0 20px;color:var(--heading,#2C1810)">设置</h2>';

    // 主题选择
    html += '<div class="settings-section">';
    html += '<div class="settings-section-title">阅读主题</div>';
    html += '<div class="theme-selector">';
    var themes = [
      { value: 'gray-white', label: '灰白' },
      { value: 'light-yellow', label: '浅黄' },
      { value: 'warm-yellow', label: '米黄' },
      { value: 'dark-gray', label: '深灰' },
      { value: 'night', label: '黑夜' }
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
    html += '<div class="settings-section-title">字号大小</div>';
    html += '<div class="font-size-slider-container">';
    html += '<span class="slider-label small">A</span>';
    html += '<input type="range" class="font-size-slider" min="12" max="24" value="' + fontSize + '" id="bibleFontSizeSlider" />';
    html += '<span class="slider-label large">A</span>';
    html += '</div></div>';

    // 内容开关
    html += '<div class="settings-section">';
    html += '<div class="settings-section-title">显示内容</div>';
    html += '<div class="content-toggles">';
    var toggleItems = [
      { key: 'showFootnotes', label: '经文注解' },
      { key: 'showBeads', label: '经文串珠' },
      { key: 'showVerseDivider', label: '经节分割线' }
    ];
    toggleItems.forEach(function(item) {
      html += '<div class="content-toggle">';
      html += '<span class="content-toggle-label">' + item.label + '</span>';
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
    html += '<button class="bible-back-btn" onclick="window.CXRouter&&CXRouter.navigate(\'\')">◀ 返回</button>';
    html += '<h2 style="text-align:center;margin:12px 0 20px;color:var(--heading,#2C1810)">阅读统计</h2>';

    if (!hist.length) {
      html += '<div style="padding:40px 20px;text-align:center;color:var(--text-muted,#999)">'
        + '<div style="font-size:32px;margin-bottom:12px">📊</div>'
        + '<div>暂无阅读记录</div>'
        + '<div style="margin-top:8px;font-size:13px">开始阅读后这里会显示统计数据</div>'
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
    html += '<div style="font-size:12px;color:var(--text-muted,#999);margin-top:4px">已读书卷</div></div>';
    html += '<div style="background:var(--card,#fff);border-radius:12px;padding:16px 8px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.06)">';
    html += '<div style="font-size:24px;font-weight:700;color:var(--brand,#8B4513)">' + totalChapters + '</div>';
    html += '<div style="font-size:12px;color:var(--text-muted,#999);margin-top:4px">已读章节</div></div>';
    html += '<div style="background:var(--card,#fff);border-radius:12px;padding:16px 8px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.06)">';
    html += '<div style="font-size:24px;font-weight:700;color:var(--brand,#8B4513)">' + bookmarkCount + '</div>';
    html += '<div style="font-size:12px;color:var(--text-muted,#999);margin-top:4px">收藏章节</div></div>';
    html += '</div>';

    // 最近 7 天阅读日历
    var today = new Date();
    var dayLabels = ['日','一','二','三','四','五','六'];
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
    html += '<div style="font-size:14px;font-weight:600;color:var(--heading,#2C1810);margin-bottom:10px">最近 7 天</div>';
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
    html += '<div style="font-size:14px;font-weight:600;color:var(--heading,#2C1810);margin-bottom:12px">阅读进度</div>';

    html += '<div style="margin-bottom:14px">';
    html += '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">';
    html += '<span style="color:var(--text,#333)">旧约</span><span style="color:var(--text-muted,#999)">' + otCount + '/39 卷 (' + otPct + '%)</span></div>';
    html += '<div style="height:8px;background:var(--border,#e8e0d0);border-radius:4px;overflow:hidden">';
    html += '<div style="height:100%;width:' + otPct + '%;background:var(--brand,#8B4513);border-radius:4px;transition:width .3s"></div></div></div>';

    html += '<div style="margin-bottom:14px">';
    html += '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">';
    html += '<span style="color:var(--text,#333)">新约</span><span style="color:var(--text-muted,#999)">' + ntCount + '/27 卷 (' + ntPct + '%)</span></div>';
    html += '<div style="height:8px;background:var(--border,#e8e0d0);border-radius:4px;overflow:hidden">';
    html += '<div style="height:100%;width:' + ntPct + '%;background:var(--brand,#8B4513);border-radius:4px;transition:width .3s"></div></div></div>';

    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
  }

  function renderReadingPlan(planId) {
    var container = document.getElementById('app');
    if (!container) return;
    window._cxShowApp();

    container.innerHTML = '<div class="bible-reading">'
      + '<button class="bible-back-btn" onclick="window.CXRouter&&CXRouter.navigate(\'\')">◀ 返回</button>'
      + '<h2 style="text-align:center;margin:20px 0;color:var(--heading,#2C1810)">读经计划</h2>'
      + '<div style="padding:20px;text-align:center;color:var(--text-muted,#999)">加载中…</div>'
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
          container.querySelector('.bible-reading > div:last-child').textContent = '未找到读经计划';
          return;
        }
        var html = '<div class="bible-reading">';
        html += '<button class="bible-back-btn" onclick="window.CXRouter&&CXRouter.navigate(\'\')">◀ 返回</button>';
        html += '<h2 style="text-align:center;margin:20px 0;color:var(--heading,#2C1810)">' + esc(plan.name) + '</h2>';
        if (plan.entries && plan.entries.length) {
          plan.entries.forEach(function(entry, idx) {
            html += '<div class="chapter-list-item">' + esc(typeof entry === 'string' ? entry : JSON.stringify(entry)) + '</div>';
          });
        } else {
          html += '<div style="padding:20px;text-align:center;color:var(--text-muted,#999)">暂无计划内容</div>';
        }
        html += '</div>';
        container.innerHTML = html;
      })
      .catch(function() {
        container.querySelector('.bible-reading > div:last-child').textContent = '加载失败';
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

    // 预加载书卷元数据
    loadBooksMeta();
  }

  // ── 暴露 API ──
  window.CXBible = {
    init: init,
    renderBookList: renderBookList,
    renderBibleView: renderBibleView,
    renderSettings: renderSettings,
    renderCharts: renderCharts,
    renderReadingPlan: renderReadingPlan,
    showVerseDetail: _showDetailOverlay,
    showOutline: showOutline,
    getToggles: function() { return _toggles; },
    setToggle: function(key, val) {
      if (key in _toggles) { _toggles[key] = !!val; saveToggles(); }
    }
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
