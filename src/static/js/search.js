/*!
 * search.js — 经文全文搜索
 * 索引懒加载 + 全屏 Modal UI + 段落级定位
 * Tab: 经文搜索 / 注解搜索
 */
(function (win) {
  'use strict';

  // ── 工具 ─────────────────────────────────────────────────────────────────

  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ── 核心对象 ──────────────────────────────────────────────────────────────

  var CXSearch = {
    _modal: null,
    _input: null,
    _resultsEl: null,
    _countEl: null,
    _tabBarEl: null,
    _filterBarEl: null,
    _debounceTimer: null,
    _inBackStack: false,
    _lockCleanup: null,

    // ── 圣经经文搜索 ────────────────────────────────────────────────────────
    _bibleSearchReady: false,
    _bibleSearchIndex: [],
    _bibleSearchPromise: null,
    _bibleBooks: null,
    _bibleIndexLoaded: {},
    _bibleLoadingCount: 0,

    // ── 搜索结果状态（供 tab 切换复用）────────────────────────────────────
    _lastScriptureResults: [],
    _lastNoteResults: [],
    _lastTerms: [],
    _lastQuery: '',
    _activeSearchTab: 'scripture',
    _searchBookFilter: 0, // 0 = 所有书卷
    _searchLangFilter: '', // '' = 默认版本(zh-rcv), 'he-el', 'he-orig' 等
    _versionSearchIndex: {}, // lang -> [entries]
    _versionIndexLoaded: {}, // lang -> bool
    _versionIndexLoading: {}, // lang -> Promise
    _bibleResultsShown: 0,

    // ── 搜索历史 ───────────────────────────────────────────────────────────
    _SEARCH_HISTORY_KEY: 'bible_search_history',
    _SEARCH_HISTORY_MAX: 20,

    _getSearchHistory: function() {
      try { return JSON.parse(localStorage.getItem(this._SEARCH_HISTORY_KEY) || '[]'); }
      catch(e) { return []; }
    },
    _saveSearchHistory: function(list) {
      try { localStorage.setItem(this._SEARCH_HISTORY_KEY, JSON.stringify(list)); } catch(e) {}
    },
    _addSearchHistory: function(query) {
      if (!query || !query.trim()) return;
      var q = query.trim();
      var list = this._getSearchHistory();
      // 去重：移除已有同关键词
      list = list.filter(function(item) { return item.query !== q; });
      // 插入最前
      list.unshift({ query: q, time: Date.now() });
      // 上限 20
      if (list.length > this._SEARCH_HISTORY_MAX) list = list.slice(0, this._SEARCH_HISTORY_MAX);
      this._saveSearchHistory(list);
    },
    _removeSearchHistory: function(query) {
      var list = this._getSearchHistory();
      list = list.filter(function(item) { return item.query !== query; });
      this._saveSearchHistory(list);
    },
    _clearSearchHistory: function() {
      this._saveSearchHistory([]);
    },

    // 搜索历史相对时间
    _historyRelativeTime: function(ts) {
      var _t = function(key) { return (win.CXI18n && win.CXI18n.t) ? win.CXI18n.t(key) : key; };
      var _tf = function(key, v) { return (win.CXI18n && win.CXI18n.tf) ? win.CXI18n.tf(key, v) : key; };
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
    },

    _buildBibleSearchIndex: function() {
      if (this._bibleSearchPromise) return this._bibleSearchPromise;
      var self = this;
      this._bibleSearchPromise = new Promise(function(resolve) {
        var root = (win.CX_ROOT !== undefined ? win.CX_ROOT : './');
        fetch(root + 'data/bible-books.json')
          .then(function(r) { return r.json(); })
          .then(function(books) {
            self._bibleBooks = books;
            self._bibleSearchReady = true;
            return self._loadAllBooksForSearch();
          })
          .then(function() {
            resolve();
          })
          .catch(function() {
            self._bibleSearchPromise = null;
            resolve();
          });
      });
      return this._bibleSearchPromise;
    },

    _loadAllBooksForSearch: function() {
      var self = this;
      var batchSize = 8;
      function loadBatch(start) {
        var promises = [];
        for (var i = start; i < Math.min(start + batchSize, 67); i++) {
          if (!self._bibleIndexLoaded[i]) {
            promises.push(self._loadBookForSearch(i));
          }
        }
        if (promises.length === 0) return Promise.resolve();
        return Promise.all(promises).then(function() {
          if (start + batchSize < 67) return loadBatch(start + batchSize);
        });
      }
      return loadBatch(1);
    },

    _loadBookForSearch: function(bookIndex) {
      var self = this;
      if (self._bibleIndexLoaded[bookIndex]) {
        return Promise.resolve();
      }
      var root = (win.CX_ROOT !== undefined ? win.CX_ROOT : './');
      var bookId = String(bookIndex).padStart(2, '0');
      return fetch(root + 'data/bible/' + bookId + '.json')
        .then(function(r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function(data) {
          if (!data || !data.chapters) return;
          var bookName = '';
          var bookAbbr = '';
          if (self._bibleBooks) {
            for (var i = 0; i < self._bibleBooks.length; i++) {
              if (self._bibleBooks[i].index === bookIndex) {
                bookName = self._bibleBooks[i].name;
                bookAbbr = self._bibleBooks[i].acronym || bookName;
                break;
              }
            }
          }
          data.chapters.forEach(function(ch) {
            if (!ch.verses) return;
            ch.verses.forEach(function(verse) {
              if (verse.content && verse.content.length >= 4) {
                var plainText = verse.content
                  .replace(/\{[^}]*\}/g, '')
                  .replace(/\[[a-z]\]/g, '')
                  .trim();
                if (plainText.length >= 4) {
                  self._bibleSearchIndex.push({
                    bookIndex: bookIndex,
                    chapter: ch.chapter,
                    section: verse.section,
                    text: plainText,
                    bookName: bookName,
                    bookAbbr: bookAbbr,
                    url: 'bible/' + bookIndex + '/' + ch.chapter,
                    type: 'scripture'
                  });
                }
              }

              // 索引注解内容
              if (verse.footnotes && verse.footnotes.length) {
                verse.footnotes.forEach(function(fn) {
                  if (!fn.note || fn.note.length < 4) return;
                  var noteText = fn.note
                    .replace(/\{[^}]*\}/g, '')
                    .replace(/\[[a-z]\]/g, '')
                    .trim();
                  if (noteText.length < 4) return;
                  self._bibleSearchIndex.push({
                    bookIndex: bookIndex,
                    chapter: ch.chapter,
                    section: verse.section,
                    text: noteText,
                    bookName: bookName,
                    bookAbbr: bookAbbr,
                    url: 'bible/' + bookIndex + '/' + ch.chapter,
                    type: 'note',
                    fnSeq: fn.seq
                  });
                });
              }
            });
          });
          self._bibleIndexLoaded[bookIndex] = true;
        })
        .catch(function() { /* 加载失败静默忽略 */ });
    },

    _searchBible: function(query, typeFilter) {
      // 如果有语言筛选器且该版本索引已加载，使用版本索引
      if (this._searchLangFilter && this._versionIndexLoaded[this._searchLangFilter]) {
        return this._searchVersionIndex(query, this._searchLangFilter, typeFilter);
      }
      if (!this._bibleSearchReady || !this._bibleSearchIndex.length) return [];
      var terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) return [];
      var results = [];

      for (var i = 0; i < this._bibleSearchIndex.length; i++) {
        var entry = this._bibleSearchIndex[i];
        if (typeFilter && entry.type !== typeFilter) continue;
        var hay = entry.bookName + ' ' + entry.chapter + ' ' + entry.section + ' ' + entry.text;
        var hayLower = hay.toLowerCase();
        var match = true;
        for (var j = 0; j < terms.length; j++) {
          if (hayLower.indexOf(terms[j]) === -1) { match = false; break; }
        }
        if (match) results.push(entry);
      }
      return results;
    },

    _searchVersionIndex: function(query, lang, typeFilter) {
      var entries = this._versionSearchIndex[lang];
      if (!entries || !entries.length) return [];
      var terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) return [];
      var results = [];
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (typeFilter && entry.type !== typeFilter) continue;
        var hay = entry.bookName + ' ' + entry.chapter + ' ' + entry.section + ' ' + entry.text;
        var hayLower = hay.toLowerCase();
        var match = true;
        for (var j = 0; j < terms.length; j++) {
          if (hayLower.indexOf(terms[j]) === -1) { match = false; break; }
        }
        if (match) results.push(entry);
      }
      return results;
    },

    _bindBibleResultClicks: function() {
      var self = this;
      var items = self._resultsEl.querySelectorAll('.cx-search-item[data-bible-url]');
      items.forEach(function(item) {
        item.addEventListener('click', function() {
          var url = this.dataset.bibleUrl;
          var section = this.dataset.section;
          var noteKey = this.dataset.noteKey; // bookAbbr + chapter:section
          var fnSeq = this.dataset.fnSeq;
          if (self._modal) self._modal.classList.remove('active');
          if (self._lockCleanup) { self._lockCleanup(); self._lockCleanup = null; }
          if (self._inBackStack && win.CX && win.CX.backStack) {
            // 使用 remove() 代替 pop()，避免 history.back() 与后续 navigate() 竞态
            if (self._backStackFn && win.CX.backStack.remove) {
              win.CX.backStack.remove(self._backStackFn);
            } else {
              win.CX.backStack.pop();
            }
            self._inBackStack = false;
          }
          // 在重置前捕获搜索词，供跳转后高亮关键词使用
          var searchQuery = self._lastQuery || '';
          // 点击搜索结果跳转时才记录搜索历史
          if (searchQuery) {
            self._addSearchHistory(searchQuery);
          }
          // 重置搜索状态（清空输入、隐藏过滤栏和结果）
          self._resetSearchState();
          if (win.CXRouter) {
            // 设置搜索定位目标，renderBibleView 会先隐藏→渲染→定位→渐显
            if (win.CXBible) {
              win.CXBible.pendingScrollSection = section;
              win.CXBible.pendingSearchQuery = searchQuery;
            }
            win.CXRouter.navigate(url);
            // 注解结果：渲染完成后再打开注解弹框
            if (noteKey && fnSeq && win.CXScripturePopup && win.CXScripturePopup.showFootnote) {
              self._openNoteAfterRender(noteKey, fnSeq);
            }
          }
        });
      });
    },

    _resetSearchState: function() {
      if (this._input) this._input.value = '';
      if (this._countEl) this._countEl.textContent = '';
      if (this._resultsEl) this._resultsEl.innerHTML = '';
      if (this._tabBarEl) { this._tabBarEl.style.display = 'none'; this._tabBarEl.innerHTML = ''; }
      if (this._filterBarEl) { this._filterBarEl.style.display = 'none'; this._filterBarEl.innerHTML = ''; }
      this._searchBookFilter = 0;
      this._bibleResultsShown = 0;
      this._searchLangFilter = '';
      this._lastScriptureResults = [];
      this._lastNoteResults = [];
      this._lastTerms = [];
      this._lastQuery = '';
      this._activeSearchTab = 'scripture';
    },

    // ── 注解弹框延迟打开：等待渲染完成后调用 ──────────────────
    _openNoteAfterRender: function(noteKey, fnSeq) {
      var maxAttempts = 20;
      var interval = 150;
      var attempt = 0;
      function tryOpen() {
        attempt++;
        if (win.CXScripturePopup && win.CXScripturePopup.showFootnote) {
          win.CXScripturePopup.showFootnote(noteKey, parseInt(fnSeq, 10));
          return;
        }
        if (attempt < maxAttempts) {
          setTimeout(tryOpen, interval);
        }
      }
      setTimeout(tryOpen, 800);
    },

    // ── Strong's 编号搜索入口 ──────────────────────────────────────
    searchByStrongs: function(sn) {
      if (!sn) return;
      // 根据 Strong's 前缀确定语言版本
      var prefix = sn.charAt(0).toUpperCase();
      var lang = (prefix === 'H') ? 'he-el' : (prefix === 'G') ? 'he-el' : '';
      this._searchLangFilter = lang;
      this.open();
      this._input.value = sn;
      var self = this;
      // 先加载版本索引再搜索
      if (lang) {
        this._loadVersionForSearch(lang).then(function() {
          self._doSearch(sn);
        });
      } else {
        this._doSearch(sn);
      }
    },

    // ── 加载版本特定数据用于搜索 ────────────────────────────────────
    _loadVersionForSearch: function(lang) {
      if (this._versionIndexLoaded[lang]) return Promise.resolve();
      if (this._versionIndexLoading[lang]) return this._versionIndexLoading[lang];
      var self = this;
      var root = (win.CX_ROOT !== undefined ? win.CX_ROOT : './');
      // 加载所有 66 卷版本数据
      var batchSize = 8;
      var entries = [];

      function loadBatch(start) {
        var promises = [];
        for (var i = start; i < Math.min(start + batchSize, 67); i++) {
          promises.push(loadOneBook(i));
        }
        if (promises.length === 0) return Promise.resolve();
        return Promise.all(promises).then(function() {
          if (start + batchSize < 67) return loadBatch(start + batchSize);
        });
      }

      function loadOneBook(bookIndex) {
        var bookId = String(bookIndex).padStart(2, '0');
        return fetch(root + 'data/bible/' + lang + '/' + bookId + '.json', { cache: 'force-cache' })
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(data) {
            if (!data || !data.chapters) return;
            var bookName = '';
            var bookAbbr = '';
            if (self._bibleBooks) {
              for (var i = 0; i < self._bibleBooks.length; i++) {
                if (self._bibleBooks[i].index === bookIndex) {
                  bookName = self._bibleBooks[i].name;
                  bookAbbr = self._bibleBooks[i].acronym || bookName;
                  break;
                }
              }
            }
            data.chapters.forEach(function(ch) {
              if (!ch.verses) return;
              ch.verses.forEach(function(verse) {
                if (verse.text && verse.text.length >= 2) {
                  entries.push({
                    bookIndex: bookIndex,
                    chapter: ch.chapter,
                    section: verse.section,
                    text: verse.text,
                    bookName: bookName,
                    bookAbbr: bookAbbr,
                    url: 'bible/' + bookIndex + '/' + ch.chapter,
                    type: 'scripture',
                    lang: lang
                  });
                }
              });
            });
          })
          .catch(function() { /* 静默忽略 */ });
      }

      this._versionIndexLoading[lang] = loadBatch(1).then(function() {
        self._versionSearchIndex[lang] = entries;
        self._versionIndexLoaded[lang] = true;
        delete self._versionIndexLoading[lang];
      });
      return this._versionIndexLoading[lang];
    },

    // ── Modal 开/关 ───────────────────────────────────────────────────────

    // ── 渲染搜索历史 ─────────────────────────────────────────────────
    _renderSearchHistory: function() {
      var self = this;
      var history = self._getSearchHistory();
      var _t = function(key) {
        return (window.CXI18n && window.CXI18n.t) ? window.CXI18n.t(key) : key;
      };

      if (!history.length) {
        self._resultsEl.innerHTML = '<div class="cx-search-empty" style="padding:40px 20px;text-align:center">'
          + '<div style="font-size:28px;margin-bottom:8px;opacity:0.4">🔍</div>'
          + '<div>' + esc(_t('search_history_empty')) + '</div>'
          + '</div>';
        return;
      }

      var html = '<div class="cx-search-history">';
      html += '<div class="cx-search-history-header">' + esc(_t('search_history')) + '</div>';
      history.forEach(function(item) {
        html += '<div class="cx-search-history-item" data-query="' + esc(item.query) + '">';
        html += '<span class="cx-search-history-icon">🔍</span>';
        html += '<span class="cx-search-history-text">' + esc(item.query) + '</span>';
        html += '<span class="cx-search-history-time">' + esc(self._historyRelativeTime(item.time)) + '</span>';
        html += '<button class="cx-search-history-del" data-query="' + esc(item.query) + '" aria-label="' + esc(_t('delete')) + '">✕</button>';
        html += '</div>';
      });
      html += '</div>';
      html += '<button class="cx-search-history-clear">' + esc(_t('clear_search_history')) + '</button>';
      self._resultsEl.innerHTML = html;

      // 绑定事件
      self._resultsEl.querySelectorAll('.cx-search-history-item').forEach(function(el) {
        el.addEventListener('click', function(e) {
          // 排除删除按钮点击
          if (e.target.closest && e.target.closest('.cx-search-history-del')) return;
          var query = el.dataset.query;
          if (query && self._input) {
            self._input.value = query;
            self._doSearch(query);
          }
        });
      });

      self._resultsEl.querySelectorAll('.cx-search-history-del').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var query = btn.dataset.query;
          if (query) {
            self._removeSearchHistory(query);
            self._renderSearchHistory();
          }
        });
      });

      var clearBtn = self._resultsEl.querySelector('.cx-search-history-clear');
      if (clearBtn) {
        clearBtn.addEventListener('click', function() {
          self._clearSearchHistory();
          self._renderSearchHistory();
        });
      }
    },

    // ── 显示搜索历史或清空结果 ─────────────────────────────────────
    _showHistoryOrEmpty: function() {
      // 搜索框为空时显示历史，否则不显示
      if (!this._input || !this._input.value.trim()) {
        this._tabBarEl.style.display = 'none';
        this._filterBarEl.style.display = 'none';
        this._countEl.textContent = '';
        this._renderSearchHistory();
      }
    },

    open: function () {
      if (!this._modal) this._buildUI();
      this._modal.classList.add('active');
      var self = this;
      if (win.CX && win.CX.lockOverlayScroll && !this._lockCleanup) {
        this._lockCleanup = win.CX.lockOverlayScroll(this._modal, function () { self.close(); });
      }
      setTimeout(function () { self._input.focus(); }, 50);
      self._filterBarEl.style.display = 'flex';

      // 注意：popstate 调度器在调用回调前已弹出栈条目，所以回调内不能再调 backStack.pop()
      // 用包装函数先清除 _inBackStack 标志，再调 close，防止双重 pop
      if (!this._inBackStack && win.CX && win.CX.backStack) {
        var self2 = this;
        this._backStackFn = function () { self2._inBackStack = false; self2.close(); };
        win.CX.backStack.push(this._backStackFn);
        this._inBackStack = true;
      }

      // 异步加载圣经搜索索引
      this._buildBibleSearchIndex();
      if (this._input.value.trim()) {
        self._doSearch(self._input.value);
      } else {
        // 搜索框为空时显示历史
        self._showHistoryOrEmpty();
      }
    },

    close: function () {
      if (!this._modal || !this._modal.classList.contains('active')) return;
      this._modal.classList.remove('active');
      if (this._lockCleanup) { this._lockCleanup(); this._lockCleanup = null; }
      if (this._inBackStack && win.CX && win.CX.backStack) {
        // 使用 remove() 代替 pop()，避免触发 history.back() 导致路由重渲染白屏
        if (this._backStackFn && win.CX.backStack.remove) {
          win.CX.backStack.remove(this._backStackFn);
        } else {
          win.CX.backStack.pop();
        }
        this._inBackStack = false;
        this._backStackFn = null;
      }
    },

    // ── 执行搜索 ─────────────────────────────────────────────────────────

    _doSearch: function (query) {
      var self = this;
      var q = query.trim();
      if (!q) {
        this._countEl.textContent = '';
        this._resultsEl.innerHTML = '';
        this._tabBarEl.style.display = 'none';
        this._filterBarEl.style.display = 'none';
        return;
      }
      this._bibleResultsShown = 0;
      this._countEl.textContent = '搜索中…';
      this._resultsEl.innerHTML = '';
      this._searchBookFilter = 0;

      self._buildBibleSearchIndex()
        .then(function () {
          var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
          var scriptureResults = self._searchBible(q, 'scripture');
          var noteResults = self._searchBible(q, 'note');

          self._lastScriptureResults = scriptureResults;
          self._lastNoteResults = noteResults;
          self._lastTerms = terms;
          self._lastQuery = q;

          var totalCount = scriptureResults.length + noteResults.length;

          // 搜索历史改为点击结果时才记录，此处不再自动保存

          var loadedCount = Object.keys(self._bibleIndexLoaded).length;
          if (totalCount === 0 && loadedCount === 0) {
            self._countEl.textContent = '索引加载中，请稍后重试';
          } else if (totalCount === 0) {
            self._countEl.textContent = '未找到相关内容';
          } else {
            var countText = '共 ' + totalCount + ' 条结果';
            if (loadedCount > 0 && loadedCount < 66) {
              countText += '（已加载 ' + loadedCount + '/66 卷）';
            }
            self._countEl.textContent = countText;
          }

          // 自动选择 tab（scripture 优先）
          if (scriptureResults.length > 0) {
            self._activeSearchTab = 'scripture';
          } else if (noteResults.length > 0) {
            self._activeSearchTab = 'note';
          }

          self._renderAllResults();
        });
    },

    // ── Tab 切换 ────────────────────────────────────────────────────────
    _switchTab: function(tab) {
      this._activeSearchTab = tab;
      this._bibleResultsShown = 0;
      this._searchBookFilter = 0;
      this._renderAllResults();
    },

    // ── 书卷过滤切换 ──────────────────────────────────────────────────
    _switchBookFilter: function(bookIndex) {
      this._searchBookFilter = bookIndex;
      this._bibleResultsShown = 0;
      this._renderAllResults();
    },

    // ── 渲染所有结果（根据当前 tab） ─────────────────────────────────
    _renderAllResults: function() {
      var self = this;
      self._resultsEl.innerHTML = '';

      var scriptureResults = self._lastScriptureResults;
      var noteResults = self._lastNoteResults;
      var terms = self._lastTerms;
      var q = self._lastQuery;
      var hasScripture = scriptureResults.length > 0;
      var hasNote = noteResults.length > 0;

      // 显示/隐藏 tab 栏
      if (hasScripture || hasNote) {
        self._tabBarEl.style.display = 'flex';
        self._tabBarEl.innerHTML = '';
        var tabs = [
          { key: 'scripture', label: '经文', count: scriptureResults.length },
          { key: 'note', label: '注解', count: noteResults.length }
        ];
        tabs.forEach(function(t) {
          var tab = document.createElement('button');
          tab.className = 'cx-search-tab' + (self._activeSearchTab === t.key ? ' active' : '');
          tab.textContent = t.label + ' ' + t.count;
          tab.disabled = t.count === 0;
          tab.addEventListener('click', function() { self._switchTab(t.key); });
          self._tabBarEl.appendChild(tab);
        });
      } else {
        self._tabBarEl.style.display = 'none';
      }

      // 当前 tab 的数据
      var currentResults, currentType;
      if (self._activeSearchTab === 'scripture') {
        currentResults = scriptureResults;
        currentType = 'scripture';
      } else {
        currentResults = noteResults;
        currentType = 'note';
      }

      // 过滤栏始终显示，仅控制结果区域渲染
      self._filterBarEl.style.display = 'flex';
      if (currentResults.length > 0) {
        self._renderFilterBar(currentResults);
        self._renderBibleResults(currentResults, terms, q, currentType);
      }
    },

    // ── 渲染书卷过滤栏（语言下拉 + 书卷下拉）────────────────────
    _renderFilterBar: function(results) {
      var self = this;
      self._filterBarEl.innerHTML = '';

      // 统计各书卷结果数
      var bookCounts = {};
      results.forEach(function(r) {
        bookCounts[r.bookIndex] = (bookCounts[r.bookIndex] || 0) + 1;
      });

      // ── 语言版本下拉筛选器 ──
      var langSelect = document.createElement('select');
      langSelect.className = 'cx-search-lang-select';
      var langOptions = [
        { value: '', label: '恢复本' },
        { value: 'zh-ncv', label: '和合本' },
        { value: 'zh-cuv', label: '文理和合本' },
        { value: 'en-darby', label: '达秘译本' },
        { value: 'en-kjv', label: '钦定本' },
        { value: 'he-el', label: '词典(来/希)' },
        { value: 'he-orig', label: '原文(来/希)' }
      ];
      langOptions.forEach(function(opt) {
        var option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        if (opt.value === self._searchLangFilter) option.selected = true;
        langSelect.appendChild(option);
      });
      langSelect.addEventListener('change', function() {
        var newLang = this.value;
        self._searchLangFilter = newLang;
        self._bibleResultsShown = 0;
        self._searchBookFilter = 0;
        if (newLang && !self._versionIndexLoaded[newLang]) {
          self._countEl.textContent = '加载版本数据中…';
          self._loadVersionForSearch(newLang).then(function() {
            self._doSearch(self._input.value);
          });
        } else {
          self._doSearch(self._input.value);
        }
      });
      self._filterBarEl.appendChild(langSelect);

      // ── 书卷下拉筛选器 ──
      var bookSelect = document.createElement('select');
      bookSelect.className = 'cx-search-book-select';

      var allOpt = document.createElement('option');
      allOpt.value = '0';
      allOpt.textContent = '全部书卷 (' + results.length + ')';
      bookSelect.appendChild(allOpt);

      var bookList = Object.keys(bookCounts).map(Number).sort(function(a, b) { return a - b; });
      bookList.forEach(function(bIdx) {
        var opt = document.createElement('option');
        opt.value = String(bIdx);
        var bName = '';
        var bAbbr = '';
        if (self._bibleBooks) {
          for (var i = 0; i < self._bibleBooks.length; i++) {
            if (self._bibleBooks[i].index === bIdx) {
              bName = self._bibleBooks[i].name;
              bAbbr = self._bibleBooks[i].acronym || bName;
              break;
            }
          }
        }
        var displayName = bAbbr || bName || ('书卷' + bIdx);
        opt.textContent = displayName + ' (' + bookCounts[bIdx] + ')';
        bookSelect.appendChild(opt);
      });

      bookSelect.value = String(self._searchBookFilter);
      bookSelect.addEventListener('change', function() {
        self._switchBookFilter(parseInt(this.value, 10));
      });
      self._filterBarEl.appendChild(bookSelect);
    },

    // ── 渲染圣经搜索结果 ─────────────────────────────────────────
    _renderBibleResults: function(results, terms, q, type) {
      var self = this;
      var filtered = self._searchBookFilter > 0
        ? results.filter(function(r) { return r.bookIndex === self._searchBookFilter; })
        : results;

      if (filtered.length === 0) {
        self._resultsEl.innerHTML = '<div class="cx-search-empty">该书卷无匹配结果</div>';
        return;
      }

      var batchSize = 50;
      var shown = self._bibleResultsShown || 0;
      if (shown === 0) {
        self._resultsEl.innerHTML = '';
      }
      var end = Math.min(shown + batchSize, filtered.length);
      for (var i = shown; i < end; i++) {
        var r = filtered[i];
        var snippet = self.extractSnippet(r.text, terms);
        var item = document.createElement('div');
        item.className = 'cx-search-item cx-search-bible-item';
        item.setAttribute('data-bible-url', esc(r.url));
        item.setAttribute('data-section', r.section);
        if (r.type === 'note' && r.fnSeq) {
          var noteKey = (r.bookAbbr || r.bookName) + r.chapter + ':' + r.section;
          item.setAttribute('data-note-key', noteKey);
          item.setAttribute('data-fn-seq', r.fnSeq);
        }
        var typeLabel = r.type === 'note' ? '<span class="cx-search-type-note">注解</span> ' : '';
        item.innerHTML =
          '<div class="cx-search-item-ref">' + typeLabel + esc(r.bookName) + ' ' + r.chapter + ':' + r.section + '</div>' +
          '<div class="cx-search-item-snippet">' + snippet + '</div>';
        self._resultsEl.appendChild(item);
      }
      self._bibleResultsShown = end;

      // 移除旧的"加载更多"按钮
      var oldMoreBtn = self._resultsEl.querySelector('.cx-search-bible-more');
      if (oldMoreBtn) oldMoreBtn.parentNode.removeChild(oldMoreBtn);

      if (end < filtered.length) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cx-search-more cx-search-more--btn cx-search-bible-more';
        btn.textContent = '加载更多（还有 ' + (filtered.length - end) + ' 条）';
        btn.addEventListener('click', function() {
          self._renderBibleResults(results, terms, q, type);
        });
        self._resultsEl.appendChild(btn);
      }

      self._bindBibleResultClicks();
    },

    extractSnippet: function (text, terms) {
      if (!text) return '';
      var lc = text.toLowerCase();
      var idx = -1;
      for (var i = 0; i < terms.length; i++) {
        idx = lc.indexOf(terms[i]);
        if (idx !== -1) break;
      }
      if (idx === -1) idx = 0;

      var s = Math.max(0, idx - 40);
      var e = Math.min(text.length, idx + 100);
      var snippet = (s > 0 ? '…' : '') + esc(text.slice(s, e)) + (e < text.length ? '…' : '');

      terms.forEach(function (t) {
        var re = new RegExp('(' + escRe(esc(t)) + ')', 'gi');
        snippet = snippet.replace(re, '<mark>$1</mark>');
      });
      return snippet;
    },

    _buildUI: function () {
      // 注入 CSS
      var style = document.createElement('style');
      style.textContent = [
        '#cx-search-modal{display:none;position:fixed;inset:0;z-index:2000;flex-direction:column;align-items:stretch;justify-content:flex-start}',
        '#cx-search-modal.active{display:flex}',
        '.cx-search-overlay{position:fixed;inset:0;background:var(--overlay-strong,rgba(0,0,0,.45));z-index:0}',
        '.cx-search-panel{position:relative;z-index:1;background:var(--surface,#fff);display:flex;flex-direction:column;width:100%;border-radius:0 0 16px 16px;animation:cxSrSlide .22s ease;max-height:92vh;overscroll-behavior:contain}',
        '@keyframes cxSrSlide{from{transform:translateY(-100%)}to{transform:translateY(0)}}',
        '.cx-search-header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border,#e0e0e0)}',
        '#cx-search-input{flex:1;font:inherit;font-size:16px;background:var(--surface-alt,#f5f5f5);color:var(--text,inherit);border:1.5px solid var(--border,#ddd);border-radius:8px;padding:7px 11px;outline:none;-webkit-appearance:none}',
        '#cx-search-input:focus{border-color:var(--brand,#4a90d9)}',
        '.cx-search-close{background:none;border:none;font-size:20px;color:var(--text-muted,#999);cursor:pointer;padding:4px 8px;line-height:1;-webkit-tap-highlight-color:transparent}',
        '#cx-search-count{padding:5px 13px;font-size:14px;color:var(--text-muted,#999);min-height:22px}',
        '#cx-search-results{overflow-y:auto;flex:1;min-height:80px;padding-bottom:24px;overscroll-behavior:contain}',
        '.cx-search-item{padding:10px 13px;border-bottom:1px solid var(--border,#f0f0f0);cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background .12s}',
        '.cx-search-item:active{background:var(--nav-hover,rgba(0,0,0,.05))}',
        '.cx-search-item-snippet{font-size:14px;color:var(--text,#555);line-height:1.6}',
        '.cx-search-item-snippet mark{background:var(--search-hl,#fff176);color:inherit;border-radius:2px;padding:0 1px}',
        '.cx-search-more{padding:7px 13px;font-size:14px;color:var(--text-muted,#999);background:var(--surface-alt,#f9f9f9);border-bottom:1px solid var(--border,#f0f0f0);font-style:italic}',
        '.cx-search-more--btn{width:100%;text-align:center;cursor:pointer;border:none;color:var(--brand,#4a90d9);font-style:normal;font-weight:600;-webkit-tap-highlight-color:transparent}',
        '.cx-search-more--btn:active{background:var(--nav-hover,rgba(0,0,0,.05))}',
        'mark.cx-search-hl{background:var(--search-hl,#fff176);color:inherit;border-radius:2px;padding:0 1px}',
        // Tab 栏
        '#cx-search-tabs{display:none;padding:0 12px;border-bottom:1px solid var(--border,#e0e0e0);background:var(--surface,#fff);flex-shrink:0}',
        '.cx-search-tab{background:none;border:none;border-bottom:2.5px solid transparent;font:inherit;font-size:14px;font-weight:600;color:var(--text-muted,#999);padding:10px 16px 8px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:color .15s,border-color .15s}',
        '.cx-search-tab.active{color:var(--brand,#8B4513);border-bottom-color:var(--brand,#8B4513)}',
        '.cx-search-tab:disabled{color:var(--border,#ccc);cursor:default}',
        // 书卷过滤栏
        '#cx-search-filters{display:none;padding:8px 12px;gap:8px;flex-wrap:nowrap;align-items:center;border-bottom:1px solid var(--border,#e0e0e0);background:var(--surface,#fff);flex-shrink:0}',
        '.cx-search-lang-select,.cx-search-book-select{font:inherit;font-size:14px;color:var(--text,#333);background:var(--surface-alt,#f5f5f5);border:1.5px solid var(--border,#ddd);border-radius:8px;padding:5px 8px;outline:none;-webkit-appearance:none;appearance:none;cursor:pointer;flex-shrink:0;background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%23999\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center;padding-right:24px}',
        '.cx-search-lang-select{max-width:42%}',
        '.cx-search-book-select{flex:1;min-width:0;max-width:56%}',
        '.cx-search-lang-select:focus,.cx-search-book-select:focus{border-color:var(--brand,#4a90d9)}',
        // 圣经结果样式
        '.cx-search-bible-item{padding:12px 13px;border-bottom:1px solid var(--border,#f0f0f0);cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background .12s}',
        '.cx-search-bible-item:active{background:var(--nav-hover,rgba(0,0,0,.05))}',
        '.cx-search-item-ref{font-size:14px;font-weight:600;color:var(--brand,#8B4513);margin-bottom:4px}',
        '.cx-search-empty{padding:24px 16px;text-align:center;color:var(--text-muted,#999);font-size:14px}',
        '.cx-search-type-note{display:inline-block;font-size:14px;font-weight:600;color:var(--brand-text,#fff);background:var(--warning,#B89030);border-radius:3px;padding:1px 5px;margin-right:4px;vertical-align:middle}',
        // 搜索历史
        '.cx-search-history{padding:0}',
        '.cx-search-history-header{padding:10px 13px 6px;font-size:14px;font-weight:600;color:var(--text-muted,#999);text-transform:uppercase;letter-spacing:0.5px}',
        '.cx-search-history-item{display:flex;align-items:center;padding:10px 13px;border-bottom:1px solid var(--border,#f0f0f0);cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background .12s;gap:8px}',
        '.cx-search-history-item:active{background:var(--nav-hover,rgba(0,0,0,.05))}',
        '.cx-search-history-icon{font-size:14px;flex-shrink:0;opacity:0.5}',
        '.cx-search-history-text{flex:1;font-size:15px;color:var(--text,#333);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.cx-search-history-time{font-size:12px;color:var(--text-muted,#999);flex-shrink:0;margin-right:2px}',
        '.cx-search-history-del{background:none;border:none;font-size:16px;color:var(--text-muted,#ccc);cursor:pointer;padding:2px 4px;line-height:1;flex-shrink:0;-webkit-tap-highlight-color:transparent}',
        '.cx-search-history-del:active{color:var(--danger,#e53935)}',
        '.cx-search-history-clear{display:block;width:100%;padding:12px;text-align:center;font-size:14px;color:var(--danger,#e53935);background:none;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent}',
        '.cx-search-history-clear:active{background:var(--nav-hover,rgba(0,0,0,.05))}',
      ].join('\n');
      document.head.appendChild(style);

      // 构建 DOM
      var modal = document.createElement('div');
      modal.id = 'cx-search-modal';
      modal.innerHTML =
        '<div class="cx-search-overlay"></div>' +
        '<div class="cx-search-panel">' +
          '<div class="cx-search-header">' +
            '<input id="cx-search-input" type="text" enterkeyhint="search" placeholder="搜索经文或注解…" autocomplete="off" autocorrect="off" spellcheck="false">' +
            '<button class="cx-search-close" aria-label="关闭">✕</button>' +
          '</div>' +
          '<div id="cx-search-tabs"></div>' +
          '<div id="cx-search-filters"></div>' +
          '<div id="cx-search-count"></div>' +
          '<div id="cx-search-results"></div>' +
        '</div>';
      document.body.appendChild(modal);

      this._modal    = modal;
      this._input    = modal.querySelector('#cx-search-input');
      this._resultsEl = modal.querySelector('#cx-search-results');
      this._countEl  = modal.querySelector('#cx-search-count');
      this._tabBarEl = modal.querySelector('#cx-search-tabs');
      this._filterBarEl = modal.querySelector('#cx-search-filters');

      // 事件绑定
      var self = this;

      modal.querySelector('.cx-search-overlay').addEventListener('touchend', function (e) {
        e.preventDefault(); self.close();
      }, { passive: false });
      modal.querySelector('.cx-search-overlay').addEventListener('click', function (e) {
        e.preventDefault(); self.close();
      });
      modal.querySelector('.cx-search-close').addEventListener('click', function () {
        self.close();
      });

      function _triggerSearch() {
        clearTimeout(self._debounceTimer);
        self._debounceTimer = setTimeout(function () {
          self._doSearch(self._input.value);
        }, 300);
      }

      this._input.addEventListener('input', function () {
        clearTimeout(self._debounceTimer);
        if (!self._input.value.trim()) {
          // 输入清空时显示搜索历史
          self._debounceTimer = setTimeout(function() {
            self._showHistoryOrEmpty();
          }, 100);
        } else {
          self._debounceTimer = setTimeout(function () {
            self._doSearch(self._input.value);
          }, 300);
        }
      });

      this._input.addEventListener('compositionend', function () {
        clearTimeout(self._debounceTimer);
        self._doSearch(self._input.value);
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && self._modal && self._modal.classList.contains('active')) {
          self.close();
        }
      });

      // 防鼠标/触控板滚动穿透 + 允许过滤栏横滑
      modal.addEventListener('wheel', function (e) {
        var el = e.target;
        // 允许过滤栏内的水平滚动
        var inFilter = false;
        while (el && el !== modal) {
          if (el === self._filterBarEl) { inFilter = true; break; }
          el = el.parentElement;
        }
        if (inFilter) return; // 不拦截过滤栏内的滚动

        var resultsEl = self._resultsEl;
        if (!resultsEl) return;
        var el2 = e.target;
        var inResults = false;
        while (el2 && el2 !== modal) {
          if (el2 === resultsEl) { inResults = true; break; }
          el2 = el2.parentElement;
        }
        if (!inResults) { e.preventDefault(); return; }
        var atTop = resultsEl.scrollTop <= 0;
        var atBot = resultsEl.scrollTop + resultsEl.clientHeight >= resultsEl.scrollHeight - 1;
        if ((atTop && e.deltaY < 0) || (atBot && e.deltaY > 0)) e.preventDefault();
      }, { passive: false });

      // 首次构建：预渲染默认过滤栏（版本选择器 + 书卷菜单），避免 open() 时过滤栏为空
      self._filterBarEl.style.display = 'flex';
      self._filterBarEl.innerHTML = '';
      var langSelect = document.createElement('select');
      langSelect.className = 'cx-search-lang-select';
      var langOptions = [
        { value: '', label: '恢复本' },
        { value: 'zh-ncv', label: '和合本' },
        { value: 'zh-cuv', label: '文理和合本' },
        { value: 'en-darby', label: '达秘译本' },
        { value: 'en-kjv', label: '钦定本' },
        { value: 'he-el', label: '词典(来/希)' },
        { value: 'he-orig', label: '原文(来/希)' }
      ];
      langOptions.forEach(function(opt) {
        var option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        if (opt.value === self._searchLangFilter) option.selected = true;
        langSelect.appendChild(option);
      });
      langSelect.addEventListener('change', function() {
        var newLang = this.value;
        self._searchLangFilter = newLang;
        self._bibleResultsShown = 0;
        self._searchBookFilter = 0;
        if (newLang && !self._versionIndexLoaded[newLang]) {
          self._countEl.textContent = '加载版本数据中…';
          self._loadVersionForSearch(newLang).then(function() {
            self._doSearch(self._input.value);
          });
        } else {
          self._doSearch(self._input.value);
        }
      });
      self._filterBarEl.appendChild(langSelect);

      var bookSelect = document.createElement('select');
      bookSelect.className = 'cx-search-book-select';
      var allOpt = document.createElement('option');
      allOpt.value = '0';
      allOpt.textContent = '全部书卷';
      bookSelect.appendChild(allOpt);
      bookSelect.addEventListener('change', function() {
        self._switchBookFilter(parseInt(this.value, 10));
      });
      self._filterBarEl.appendChild(bookSelect);
    },

    // ── 初始化入口 ───────────────────────────────────────────────────────

    init: function () {
      var self = this;

      function bindBtn() {
        var btn = document.getElementById('cx-search-btn');
        if (btn) {
          btn.addEventListener('click', function (e) {
            e.preventDefault();
            self.open();
          });
        }
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindBtn);
      } else {
        bindBtn();
      }
    }
  };

  win.CXSearch = CXSearch;
  CXSearch.init();

}(window));
