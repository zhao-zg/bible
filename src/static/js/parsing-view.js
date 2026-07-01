/**
 * 逐词解析视图模块
 * 按需加载 data/parsing/{NN}.json，展示每节经文的逐词分析
 * 挂载到 window.CXParsingView
 */
(function() {
  'use strict';

  var _cache = {};  // bookIndex -> data
  var _loading = {};

  function getRoot() {
    return (window.CX_ROOT || './');
  }

  // ── 加载书卷解析数据 ──
  function loadBookData(bookIndex) {
    if (_cache[bookIndex]) return Promise.resolve(_cache[bookIndex]);
    if (_loading[bookIndex]) return _loading[bookIndex];
    var idx = String(bookIndex).padStart(2, '0');
    _loading[bookIndex] = fetch(getRoot() + 'data/parsing/' + idx + '.json', { cache: 'force-cache' })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        _cache[bookIndex] = data || { chapters: {} };
        delete _loading[bookIndex];
        return _cache[bookIndex];
      })
      .catch(function(err) {
        console.warn('[CXParsingView] 加载失败 (book=' + bookIndex + '):', err);
        _cache[bookIndex] = { chapters: {} };
        delete _loading[bookIndex];
        return _cache[bookIndex];
      });
    return _loading[bookIndex];
  }

  // ── 获取指定节的词列表 ──
  function getWords(bookData, chapter, section) {
    if (!bookData || !bookData.chapters) return [];
    var chData = bookData.chapters[String(chapter)];
    if (!chData) return [];
    var secData = chData[String(section)];
    return secData || [];
  }

  // ── 获取指定章的所有节号 ──
  function getSections(bookData, chapter) {
    if (!bookData || !bookData.chapters) return [];
    var chData = bookData.chapters[String(chapter)];
    if (!chData) return [];
    return Object.keys(chData).map(Number).sort(function(a, b) { return a - b; });
  }

  // ── 工具函数 ──
  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── 渲染词卡片 HTML ──
  function renderWord(wordObj) {
    var html = '<div class="parsing-word">';
    if (wordObj.w) {
      html += '<span class="parsing-word-orig">' + esc(wordObj.w) + '</span>';
    }
    if (wordObj.p) {
      html += '<span class="parsing-word-pro">' + esc(wordObj.p) + '</span>';
    }
    if (wordObj.s) {
      html += '<span class="parsing-word-sn" data-sn="' + esc(wordObj.s) + '">' + esc(wordObj.s) + '</span>';
    }
    if (wordObj.f) {
      html += '<span class="parsing-word-form">' + esc(wordObj.f) + '</span>';
    }
    if (wordObj.e) {
      html += '<span class="parsing-word-exp">' + esc(wordObj.e) + '</span>';
    }
    html += '</div>';
    return html;
  }

  // ── 渲染指定节的内容 ──
  function renderSection(bookData, chapter, section) {
    var words = getWords(bookData, chapter, section);
    if (!words.length) {
      return '<div class="parsing-loading">此节无解析数据</div>';
    }
    var html = '';
    for (var i = 0; i < words.length; i++) {
      html += renderWord(words[i]);
    }
    return html;
  }

  // ── 显示逐词解析视图 ──
  function showParsingView(bookIndex, chapter, initialSection) {
    if (!window.CX || !window.CX.openDialog) return;
    var _t = (window.CXI18n && window.CXI18n.t) ? window.CXI18n.t : function(k) { return k; };

    var dialogRef = window.CX.openDialog({
      id: 'parsing-view-dialog',
      html: '<div class="parsing-dialog">' +
        '<div class="parsing-header">' + esc(_t('parsing_view')) + '</div>' +
        '<div class="parsing-section-nav" id="parsing-sec-nav"></div>' +
        '<div class="parsing-body" id="parsing-body-content">' +
        '<div class="parsing-loading">加载中…</div>' +
        '</div></div>'
    });
    if (!dialogRef) {
      // 旧 dialog 可能残留，先销毁再重新打开
      var existing = document.getElementById('parsing-view-dialog');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      dialogRef = window.CX.openDialog({
        id: 'parsing-view-dialog',
        html: '<div class="parsing-dialog">' +
          '<div class="parsing-header">' + esc(_t('parsing_view')) + '</div>' +
          '<div class="parsing-section-nav" id="parsing-sec-nav"></div>' +
          '<div class="parsing-body" id="parsing-body-content">' +
          '<div class="parsing-loading">加载中…</div>' +
          '</div></div>'
      });
    }
    if (!dialogRef) return;

    var navEl = dialogRef.mask.querySelector('#parsing-sec-nav');
    var bodyEl = dialogRef.mask.querySelector('#parsing-body-content');
    var currentSection = initialSection || 1;

    // 绑定节号按钮点击
    function onNavClick(e) {
      var t = e.target;
      if (t.classList && t.classList.contains('parsing-sec-btn')) {
        var sec = parseInt(t.dataset.sec, 10);
        if (!isNaN(sec)) {
          currentSection = sec;
          updateView();
        }
      }
    }

    // 绑定 Strong's 编号点击（委托到 body 容器）
    function onBodyClick(e) {
      var t = e.target;
      if (t.classList && t.classList.contains('parsing-word-sn') && t.dataset.sn) {
        e.preventDefault();
        e.stopPropagation();
        if (window.CXStrongsDict) {
          window.CXStrongsDict.showEntry(t.dataset.sn);
        }
      }
    }

    navEl.addEventListener('click', onNavClick);
    bodyEl.addEventListener('click', onBodyClick);

    function updateView() {
      // 更新导航按钮高亮
      var btns = navEl.querySelectorAll('.parsing-sec-btn');
      for (var i = 0; i < btns.length; i++) {
        var isActive = parseInt(btns[i].dataset.sec, 10) === currentSection;
        btns[i].classList.toggle('active', isActive);
      }
      // 渲染内容
      loadBookData(bookIndex).then(function(data) {
        bodyEl.innerHTML = renderSection(data, chapter, currentSection);
      });
    }

    // 加载数据后渲染导航
    loadBookData(bookIndex).then(function(data) {
      var sections = getSections(data, chapter);
      if (!sections.length) {
        navEl.innerHTML = '';
        bodyEl.innerHTML = '<div class="parsing-loading">此章无解析数据</div>';
        return;
      }

      // 渲染导航按钮
      var navHtml = '';
      for (var i = 0; i < sections.length; i++) {
        var isActive = sections[i] === currentSection;
        navHtml += '<button class="parsing-sec-btn' + (isActive ? ' active' : '') +
          '" data-sec="' + sections[i] + '">' + sections[i] + '</button>';
      }
      navEl.innerHTML = navHtml;

      // 渲染初始内容
      bodyEl.innerHTML = renderSection(data, chapter, currentSection);

      // 滚动到激活的导航按钮
      var activeBtn = navEl.querySelector('.parsing-sec-btn.active');
      if (activeBtn) {
        activeBtn.scrollIntoView({ inline: 'center', block: 'nearest' });
      }
    });
  }

  // ── 公开 API ──
  window.CXParsingView = {
    showParsingView: showParsingView,
    loadBookData: loadBookData
  };
})();
