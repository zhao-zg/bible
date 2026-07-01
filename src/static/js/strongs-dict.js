/**
 * Strong's 词典查询模块
 * 懒加载 data/strongs-dict.json，点击 .sn-ref 弹出词典卡片
 * 支持三标签页切换：词典 / 词汇分析 / 相关经节
 * 挂载到 window.CXStrongsDict
 */
(function() {
  'use strict';

  var _dictData = null;
  var _dictPromise = null;
  var _booksMeta = null;
  var _booksPromise = null;

  function getRoot() {
    return (window.CX_ROOT || './');
  }

  function _t(key) {
    return (window.CXI18n && window.CXI18n.t) ? window.CXI18n.t(key) : key;
  }
  function _tf(key, vars) {
    return (window.CXI18n && window.CXI18n.tf) ? window.CXI18n.tf(key, vars) : key;
  }

  // ── 懒加载词典数据 ──
  function loadDict() {
    if (_dictData) return Promise.resolve(_dictData);
    if (_dictPromise) return _dictPromise;
    _dictPromise = fetch(getRoot() + 'data/strongs-dict.json', { cache: 'force-cache' })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        _dictData = data || {};
        return _dictData;
      })
      .catch(function(err) {
        console.warn('[CXStrongsDict] 词典加载失败:', err);
        _dictData = {};
        return _dictData;
      });
    return _dictPromise;
  }

  // ── 懒加载书卷元数据 ──
  function loadBooksMeta() {
    if (_booksMeta) return Promise.resolve(_booksMeta);
    if (_booksPromise) return _booksPromise;
    _booksPromise = fetch(getRoot() + 'data/bible-books.json', { cache: 'force-cache' })
      .then(function(r) { return r.json(); })
      .then(function(data) { _booksMeta = data || []; return _booksMeta; })
      .catch(function() { _booksMeta = []; return _booksMeta; });
    return _booksPromise;
  }

  function getBookName(bookIndex) {
    if (!_booksMeta) return String(bookIndex);
    for (var i = 0; i < _booksMeta.length; i++) {
      if (_booksMeta[i].index === bookIndex) return _booksMeta[i].name || String(bookIndex);
    }
    return String(bookIndex);
  }

  // ── 查找词典条目 ──
  function lookup(sn) {
    if (!_dictData) return null;
    return _dictData[sn] || null;
  }

  // ── 工具函数 ──
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 格式化词典释义文本
   */
  function formatDictText(text) {
    if (!text) return '';
    var escaped = escHtml(text);
    escaped = escaped.replace(/\n/g, '<br>');
    return escaped;
  }

  // ══════════════════════════════════════════════════════
  //  词汇分析：从 parsing 数据中提取该 Strong's 编号的词信息
  // ══════════════════════════════════════════════════════
  function showWordAnalysis(sn, bookIndex) {
    if (!window.CXParsingView || !window.CXParsingView.loadBookData) {
      return '<div class="sd-tab-empty">' + escHtml(_t('no_analysis_data')) + '</div>';
    }
    return window.CXParsingView.loadBookData(bookIndex).then(function(data) {
      var matches = [];
      if (!data || !data.chapters) return renderAnalysisResults(matches, bookIndex);
      var chapters = data.chapters;
      Object.keys(chapters).forEach(function(chStr) {
        var chNum = parseInt(chStr, 10);
        var chData = chapters[chStr];
        Object.keys(chData).forEach(function(secStr) {
          var secNum = parseInt(secStr, 10);
          var words = chData[secStr];
          if (!Array.isArray(words)) return;
          words.forEach(function(w) {
            if (w.s === sn) {
              matches.push({ ch: chNum, sec: secNum, word: w });
            }
          });
        });
      });
      return renderAnalysisResults(matches, bookIndex);
    });
  }

  function renderAnalysisResults(matches, bookIndex) {
    if (!matches.length) {
      return '<div class="sd-tab-empty">' + escHtml(_t('no_analysis_data')) + '</div>';
    }
    var bookName = getBookName(bookIndex);
    var html = '<div class="sd-analysis-list">';
    var seen = {};
    matches.forEach(function(m) {
      var key = m.ch + ':' + m.sec + ':' + (m.word.w || '');
      if (seen[key]) return;
      seen[key] = true;
      var w = m.word;
      html += '<div class="sd-analysis-item">';
      html += '<div class="sd-analysis-ref">' + escHtml(bookName) + ' ' + m.ch + ':' + m.sec + '</div>';
      html += '<div class="sd-analysis-word">';
      if (w.w) html += '<span class="sd-aw-orig">' + escHtml(w.w) + '</span>';
      if (w.p) html += '<span class="sd-aw-pro">' + escHtml(w.p) + '</span>';
      html += '</div>';
      html += '<div class="sd-analysis-detail">';
      if (w.f) html += '<span class="sd-ad-form">' + escHtml(w.f) + '</span>';
      if (w.e) html += '<span class="sd-ad-exp">' + escHtml(w.e) + '</span>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  // ══════════════════════════════════════════════════════
  //  相关经节搜索：在当前书卷中查找使用该 Strong's 编号的所有经节
  // ══════════════════════════════════════════════════════
  function showRelatedVerses(sn, bookIndex) {
    if (!window.CXParsingView || !window.CXParsingView.loadBookData) {
      return '<div class="sd-tab-empty">' + escHtml(_t('no_related_verses')) + '</div>';
    }
    return window.CXParsingView.loadBookData(bookIndex).then(function(data) {
      var results = [];
      if (!data || !data.chapters) return renderVerseResults(results, sn);
      var chapters = data.chapters;
      Object.keys(chapters).sort(function(a, b) { return parseInt(a) - parseInt(b); }).forEach(function(chStr) {
        var chNum = parseInt(chStr, 10);
        var chData = chapters[chStr];
        Object.keys(chData).sort(function(a, b) { return parseInt(a) - parseInt(b); }).forEach(function(secStr) {
          var secNum = parseInt(secStr, 10);
          var words = chData[secStr];
          if (!Array.isArray(words)) return;
          var found = false;
          for (var i = 0; i < words.length; i++) {
            if (words[i].s === sn) { found = true; break; }
          }
          if (found) {
            results.push({ bookIndex: bookIndex, ch: chNum, sec: secNum });
          }
        });
      });
      return renderVerseResults(results, sn);
    });
  }

  function renderVerseResults(results, sn) {
    if (!results.length) {
      return '<div class="sd-tab-empty">' + escHtml(_t('no_related_verses')) + '</div>';
    }
    var html = '<div class="sd-result-count">' + escHtml(_tf('search_results_n', { n: results.length })) + '</div>';
    html += '<div class="sd-verse-list">';
    results.forEach(function(r) {
      html += '<div class="sd-verse-item" data-book="' + r.bookIndex + '" data-ch="' + r.ch + '" data-sec="' + r.sec + '">';
      html += '<span class="sd-verse-ref">' + escHtml(getBookName(r.bookIndex)) + ' ' + r.ch + ':' + r.sec + '</span>';
      html += '<span class="sd-verse-go">' + escHtml(_t('search_btn')) + ' ›</span>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  // ══════════════════════════════════════════════════════
  //  弹窗主体：三标签页切换
  // ══════════════════════════════════════════════════════
  function showEntry(sn) {
    if (!sn) return;
    if (!window.CX || !window.CX.openDialog) return;

    loadDict().then(function() {
      return loadBooksMeta();
    }).then(function() {
      var entry = lookup(sn);

      // 获取当前书卷（从 CXBible 或路由）
      var bookIndex = 1;
      if (window.CXBible && typeof window.CXBible.getCurrentBook === 'function') {
        bookIndex = window.CXBible.getCurrentBook() || 1;
      }
      // fallback: 从 URL hash 获取
      if (!bookIndex || bookIndex < 1) {
        var hashMatch = window.location.hash.match(/bible\/(\d+)\//);
        if (hashMatch) bookIndex = parseInt(hashMatch[1], 10);
      }

      // 构建弹窗 HTML
      var html = '<div class="strongs-card">';
      // 头部：编号 + 原文
      html += '<div class="strongs-sn">' + escHtml(sn) + '</div>';
      if (entry && entry.o) {
        html += '<div class="strongs-orig">' + escHtml(entry.o) + '</div>';
      }

      // 标签页导航
      html += '<div class="sd-tabs">';
      html += '<button class="sd-tab active" data-tab="dict">' + escHtml(_t('strongs_lookup')) + '</button>';
      html += '<button class="sd-tab" data-tab="analysis">' + escHtml(_t('word_analysis')) + '</button>';
      html += '<button class="sd-tab" data-tab="verses">' + escHtml(_t('related_verses')) + '</button>';
      html += '</div>';

      // 标签页内容区
      html += '<div class="sd-tab-body" id="sd-tab-content">';
      // 默认显示词典内容
      html += '<div class="sd-panel sd-panel-dict">';
      if (entry && entry.t) {
        html += '<div class="strongs-body">' + formatDictText(entry.t) + '</div>';
      } else {
        html += '<div class="strongs-empty">' + escHtml(_t('no_dict_entry')) + '</div>';
      }
      html += '</div>';
      html += '</div>'; // sd-tab-body
      html += '</div>'; // strongs-card

      var dialogRef = window.CX.openDialog({
        id: 'strongs-dict-dialog',
        html: html
      });
      if (!dialogRef) return;

      var card = dialogRef.mask.querySelector('.strongs-card');
      var tabBody = card.querySelector('#sd-tab-content');
      var tabBtns = card.querySelectorAll('.sd-tab');
      var currentTab = 'dict';

      // 缓存已加载的标签页内容
      var tabCache = { dict: tabBody.innerHTML };

      // 标签页切换
      function switchTab(tabName) {
        if (tabName === currentTab) return;
        currentTab = tabName;

        // 更新按钮高亮
        for (var i = 0; i < tabBtns.length; i++) {
          tabBtns[i].classList.toggle('active', tabBtns[i].dataset.tab === tabName);
        }

        // 显示缓存或加载新内容
        if (tabCache[tabName]) {
          tabBody.innerHTML = tabCache[tabName];
          bindResultEvents(tabBody);
          return;
        }

        tabBody.innerHTML = '<div class="sd-tab-loading">…</div>';

        var promise;
        if (tabName === 'analysis') {
          promise = Promise.resolve(showWordAnalysis(sn, bookIndex));
        } else if (tabName === 'verses') {
          promise = Promise.resolve(showRelatedVerses(sn, bookIndex));
        }

        if (promise && typeof promise.then === 'function') {
          promise.then(function(content) {
            if (typeof content === 'string') {
              tabCache[tabName] = content;
              tabBody.innerHTML = content;
              bindResultEvents(tabBody);
            }
          });
        }
      }

      // 绑定标签页点击
      var tabsContainer = card.querySelector('.sd-tabs');
      tabsContainer.addEventListener('click', function(e) {
        var btn = e.target.closest ? e.target.closest('.sd-tab') : null;
        if (btn && btn.dataset.tab) {
          switchTab(btn.dataset.tab);
        }
      });

      // 绑定经节点击 → 跳转全文搜索
      function bindResultEvents(container) {
        container.querySelectorAll('.sd-verse-item').forEach(function(item) {
          item.addEventListener('click', function() {
            // 关闭当前 Strong's 弹窗
            dialogRef.close();
            // 跳转至全文搜索，预填 Strong's 编号并选择对应语言版本
            if (window.CXSearch && window.CXSearch.searchByStrongs) {
              window.CXSearch.searchByStrongs(sn);
            }
          });
        });
        // 绑定词汇分析中的 Strong's 编号点击
        container.querySelectorAll('.sd-aw-orig').forEach(function() {});
        container.querySelectorAll('[data-sn]').forEach(function(el) {
          el.style.cursor = 'pointer';
          el.addEventListener('click', function(e) {
            e.stopPropagation();
            var newSn = this.dataset.sn;
            if (newSn && newSn !== sn) {
              dialogRef.close();
              showEntry(newSn);
            }
          });
        });
      }

      // 初始绑定
      bindResultEvents(tabBody);
    });
  }

  // ── 事件委托：监听 .sn-ref 点击 ──
  document.addEventListener('click', function(e) {
    var t = e.target;
    if (t.classList && t.classList.contains('sn-ref') && t.dataset.sn) {
      e.preventDefault();
      e.stopPropagation();
      showEntry(t.dataset.sn);
    }
  }, true);

  // ── 公开 API ──
  window.CXStrongsDict = {
    loadDict: loadDict,
    lookup: lookup,
    showEntry: showEntry
  };
})();
/**
 * Strong's 词典查询模块
 * 懒加载 data/strongs-dict.json，点击 .sn-ref 弹出词典卡片
 * 挂载到 window.CXStrongsDict
 */
(function() {
  'use strict';

  var _dictData = null;
  var _dictPromise = null;

  function getRoot() {
    return (window.CX_ROOT || './');
  }

  // ── 懒加载词典数据 ──
  function loadDict() {
    if (_dictData) return Promise.resolve(_dictData);
    if (_dictPromise) return _dictPromise;
    _dictPromise = fetch(getRoot() + 'data/strongs-dict.json', { cache: 'force-cache' })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        _dictData = data || {};
        return _dictData;
      })
      .catch(function(err) {
        console.warn('[CXStrongsDict] 词典加载失败:', err);
        _dictData = {};
        return _dictData;
      });
    return _dictPromise;
  }

  // ── 查找词典条目 ──
  function lookup(sn) {
    if (!_dictData) return null;
    return _dictData[sn] || null;
  }

  // ── 显示词典弹窗 ──
  function showEntry(sn) {
    if (!sn) return;
    if (!window.CX || !window.CX.openDialog) return;

    // 先确保词典已加载
    loadDict().then(function() {
      var entry = lookup(sn);
      var _t = (window.CXI18n && window.CXI18n.t) ? window.CXI18n.t : function(k) { return k; };

      var html = '<div class="strongs-card">';
      html += '<div class="strongs-sn">' + escHtml(sn) + '</div>';

      if (entry) {
        if (entry.o) {
          html += '<div class="strongs-orig">' + escHtml(entry.o) + '</div>';
        }
        if (entry.t) {
          html += '<div class="strongs-body">' + formatDictText(entry.t) + '</div>';
        } else {
          html += '<div class="strongs-empty">' + escHtml(_t('no_dict_entry')) + '</div>';
        }
      } else {
        html += '<div class="strongs-empty">' + escHtml(_t('no_dict_entry')) + '</div>';
      }
      html += '</div>';

      window.CX.openDialog({
        id: 'strongs-dict-dialog',
        html: html
      });
    });
  }

  // ── 工具函数 ──
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 格式化词典释义文本：将结构化文本转为 HTML
   * 原文格式：编号、发音、词源、AV 翻译、释义等段落
   */
  function formatDictText(text) {
    if (!text) return '';
    var escaped = escHtml(text);
    // 将换行保留
    escaped = escaped.replace(/\n/g, '<br>');
    return escaped;
  }

  // ── 事件委托：监听 .sn-ref 点击 ──
  document.addEventListener('click', function(e) {
    var t = e.target;
    if (t.classList && t.classList.contains('sn-ref') && t.dataset.sn) {
      e.preventDefault();
      e.stopPropagation();
      showEntry(t.dataset.sn);
    }
  }, true);

  // ── 公开 API ──
  window.CXStrongsDict = {
    loadDict: loadDict,
    lookup: lookup,
    showEntry: showEntry
  };
})();
