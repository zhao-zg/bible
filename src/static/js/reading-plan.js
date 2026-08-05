/*!
 * reading-plan.js — 读经计划：主视图显示经文内容，侧边抽屉显示日历进度
 *
 * 路由：
 *   #/reading-plan          → 当日读经内容（或计划选择）
 *   #/reading-plan/{id}     → 指定计划的当日读经
 *   #/reading-plan/{id}/{day} → 指定天的读经内容
 *
 * 存储：localStorage cx_reading_plans
 * 暴露：window.CXReadingPlan
 */
(function (win) {
  'use strict';

  var STORAGE_KEY = 'cx_reading_plans';

  var PLAN_TYPES = {
    NT_OT:     { label: '新旧约并读（通读）', desc: '新旧约并行，一年读完', icon: '\uD83D\uDCDA', planIds: ['kO', 'LU'] },
    NT:        { label: '一年新约（通读）', desc: '按整章阅读，一年读完', icon: '\uD83D\uDCD6', planIds: ['kO'] },
    OT:        { label: '一年旧约（通读）', desc: '按整章阅读，一年读完', icon: '\uD83D\uDCDC', planIds: ['LU'] },
    NT_OT_jing: { label: '新旧约并读（段读）', desc: '按主题段落阅读，一年读完', icon: '\uD83D\uDCDA', planIds: ['2k', 'zy'] },
    NT_jing:   { label: '一年新约（段读）', desc: '按主题段落阅读，一年读完', icon: '\uD83D\uDCD6', planIds: ['2k'] },
    OT_jing:   { label: '一年旧约（段读）', desc: '按主题段落阅读，一年读完', icon: '\uD83D\uDCDC', planIds: ['zy'] }
  };

  var _planData = null;
  var _books = null;
  var _currentInstId = null;
  var _currentDay = null;
  var _isAnimating = false;
  var _swipeBound = false;
  var _preRenderedDayHtml = {};
  var _renderGen = 0;           // 渲染代数计数器，防止快速导航/退出时旧异步回调覆盖新页面

  // ══════════════════════════════════════════════════════════
  //  工具函数
  // ══════════════════════════════════════════════════════════
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }
  function getRoot() { return win.CX_ROOT || './'; }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function stripMarkers(s) { return s.replace(/\{\d+\}/g, '').replace(/\[[a-z]\]/gi, ''); }

  // ══════════════════════════════════════════════════════════
  //  日期工具
  // ══════════════════════════════════════════════════════════
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function yearStart(year) { return new Date(year, 0, 1); }
  function dayOfYear(dateStr) {
    var p = dateStr.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return Math.floor((d - yearStart(d.getFullYear())) / 864e5) + 1;
  }
  function dateForDay(year, dayNum) {
    var d = new Date(year, 0, dayNum);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function daysInYear(year) { return Math.floor((yearStart(year + 1) - yearStart(year)) / 864e5); }
  function daysInMonth(year, m) { return new Date(year, m + 1, 0).getDate(); }
  function firstDayOfMonth(year, m) { return new Date(year, m, 1).getDay(); }

  // ══════════════════════════════════════════════════════════
  //  时间颜色
  // ══════════════════════════════════════════════════════════
  function timeColor(ts) {
    if (!ts) return '';
    var h = new Date(ts).getHours();
    if (h >= 4 && h < 8) return 'green';
    if (h >= 8 && h < 18) return 'yellow';
    return 'red';
  }
  function timeColorLabel(c) {
    if (c === 'green') return '\u6e05\u6668 4\u20138\u70b9';
    if (c === 'yellow') return '\u65e5\u95f4 8\u201318\u70b9';
    if (c === 'red') return '\u5176\u4ed6\u65f6\u6bb5';
    return '';
  }

  // ══════════════════════════════════════════════════════════
  //  数据加载
  // ══════════════════════════════════════════════════════════
  function loadPlanData(forceRefresh) {
    if (!forceRefresh && _planData) return Promise.resolve(_planData);
    var url = getRoot() + 'data/reading-plans.json';
    var opts = {};
    if (forceRefresh) {
      // 破缓存：cache:'no-cache' 让 SW 直接放行（SW 对此选项不拦截），
      // 浏览器也不会使用 HTTP 缓存
      opts = { cache: 'no-cache' };
    }
    return fetch(url, opts).then(function (r) { return r.json(); }).then(function (d) { _planData = d; return d; });
  }
  function loadBooks() {
    if (_books) return Promise.resolve(_books);
    return fetch(getRoot() + 'data/bible-books.json').then(function (r) { return r.json(); }).then(function (d) { _books = d; return d; });
  }
  function bookName(idx) {
    if (!_books) return String(idx);
    for (var i = 0; i < _books.length; i++) if (_books[i].index === idx) return _books[i].name;
    return String(idx);
  }
  function getPlan(id) {
    if (!_planData || !_planData.plans) return null;
    for (var i = 0; i < _planData.plans.length; i++) if (_planData.plans[i].id === id) return _planData.plans[i];
    return null;
  }
  var _chapterCache = {};
  function loadChapter(bookIndex) {
    if (_chapterCache[bookIndex]) return Promise.resolve(_chapterCache[bookIndex]);
    return fetch(getRoot() + 'data/bible/' + pad2(bookIndex) + '.json')
      .then(function (r) { return r.json(); })
      .then(function (d) { _chapterCache[bookIndex] = d; return d; });
  }
  var _topicsData = null;
  function loadTopics() {
    if (_topicsData) return Promise.resolve(_topicsData);
    return fetch(getRoot() + 'data/bible-topics.json').then(function (r) { return r.json(); }).then(function (d) { _topicsData = d; return d; }).catch(function () { _topicsData = {}; return {}; });
  }
  function getTopic(bookIndex) {
    if (!_topicsData) return '';
    return _topicsData[String(bookIndex)] || '';
  }

  // ══════════════════════════════════════════════════════════
  //  存储
  // ══════════════════════════════════════════════════════════
  function loadInstances() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch (e) { return []; } }
  function saveInstances(list) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) { } }
  function getInstance(id) {
    var list = loadInstances();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function createInstance(type) {
    var list = loadInstances(), now = new Date();
    var inst = { id: uid(), type: type, planIds: PLAN_TYPES[type].planIds.slice(), startDate: now.getFullYear() + '-01-01', year: now.getFullYear(), createdAt: now.toISOString(), completed: {} };
    list.unshift(inst); saveInstances(list); return inst;
  }
  function markDay(instanceId, dayNum) {
    var list = loadInstances();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === instanceId) {
        if (!list[i].completed) list[i].completed = {};
        list[i].completed[String(dayNum)] = { at: new Date().toISOString() };
        saveInstances(list); return list[i];
      }
    }
    return null;
  }
  function deleteInstance(id) { saveInstances(loadInstances().filter(function (x) { return x.id !== id; })); }
  function completedCount(inst) { return inst.completed ? Object.keys(inst.completed).length : 0; }
  function planTotal(inst) {
    // 基于当年实际天数，确保年末最后一天也可导航到
    return daysInYear(inst.year);
  }
  function completedRounds(type) {
    var list = loadInstances(), rounds = 0;
    for (var i = 0; i < list.length; i++) { if (list[i].type === type) { var t = planTotal(list[i]); if (t > 0 && completedCount(list[i]) >= t) rounds++; } }
    return rounds;
  }

  // ══════════════════════════════════════════════════════════
  //  计划条目
  // ══════════════════════════════════════════════════════════
  function formatEntry(entry) {
    if (entry._allTopics) {
      return '\u5168\u5377\u4e3b\u9898';
    }
    if (entry.topic) {
      var name = bookName(entry.book);
      return name + ' \u00b7 \u4e3b\u9898';
    }
    var name = bookName(entry.book);
    if (entry.book === entry.book_to) {
      if (entry.chapter === entry.chapter_to) {
        if (entry.section === entry.section_to) return name + ' ' + entry.chapter + ':' + entry.section;
        return name + ' ' + entry.chapter + ':' + entry.section + '\u2013' + entry.section_to;
      }
      return name + ' ' + entry.chapter + ':' + entry.section + ' \u2013 ' + entry.chapter_to + ':' + entry.section_to;
    }
    return name + ' ' + entry.chapter + ':' + entry.section + ' \u2013 ' + bookName(entry.book_to) + ' ' + entry.chapter_to + ':' + entry.section_to;
  }
  var _forceRefreshAttempted = false;  // 防止无限重试

  function getEntriesForDay(inst, dayNum) {
    var entries = [];
    // 检查当天是否为闰年2月29日
    var dateStr = dateForDay(inst.year, dayNum);
    var isFeb29 = dateStr && dateStr.indexOf('-02-29') !== -1;

    // 检查当天是否为年末最后一天
    var totalDays = daysInYear(inst.year);
    var isYearEnd = (dayNum === totalDays);

    // 闰年2月29日：entries 中不会有数据，直接返回全卷主题
    if (isFeb29) {
      return [{ planId: '_all', planName: '\u5168\u5377\u4e3b\u9898', entry: { d: dayNum, _allTopics: true } }];
    }

    // 检查 planIds 是否都能在 _planData 中找到，缺失时强制刷新数据（仅尝试一次）
    var missingPlans = false;
    for (var pi = 0; pi < inst.planIds.length; pi++) {
      if (!getPlan(inst.planIds[pi])) { missingPlans = true; break; }
    }
    // 若有 planId 在当前 _planData 中找不到，可能是 SW 缓存了旧版 JSON，强制重新 fetch
    if (missingPlans && _planData && !_forceRefreshAttempted) {
      _forceRefreshAttempted = true;  // 只尝试一次，避免无限循环
      // 同步无法等待，返回空；异步刷新后由调用方重试
      loadPlanData(true).then(function () {
        console.log('[RP] planData force-refreshed, plans now: ' + (_planData ? _planData.plans.map(function(p){return p.id}).join(',') : 'none'));
        // 重新渲染当前天
        var inst2 = getInstance(inst.id);
        if (inst2) renderDayContent(inst2, dayNum);
      });
      return entries; // 先返回空，等刷新后重试
    }

    for (var i = 0; i < inst.planIds.length; i++) {
      var plan = getPlan(inst.planIds[i]);
      if (plan && plan.entries) {
        for (var j = 0; j < plan.entries.length; j++) {
          var entry = plan.entries[j];
          if (entry.d === dayNum) {
            // 平年时忽略 topic 标记（闰年2月29日由上方 isFeb29 统一处理为全卷主题）
            if (entry.topic) {
              entry = Object.assign({}, entry);
              delete entry.topic;
            }
            entries.push({ planId: plan.id, planName: plan.name, entry: entry }); break;
          }
        }
      }
    }

    // 年末最后一天且 entries 中无数据：回退到全卷主题
    if (isYearEnd && entries.length === 0) {
      return [{ planId: '_all', planName: '\u5168\u5377\u4e3b\u9898', entry: { d: dayNum, _allTopics: true } }];
    }

    console.log('[RP] getEntriesForDay day=' + dayNum + ' planIds=' + JSON.stringify(inst.planIds) + ' found=' + entries.length);
    return entries;
  }

  // ══════════════════════════════════════════════════════════
  //  渲染入口
  // ══════════════════════════════════════════════════════════
  function render(instanceId, dayNum) {
    var app = document.getElementById('app');
    if (!app) return;
    // 传 skipRedispatch=true：内容将由下方 Promise.all 异步写入，
    // 此时 #app.innerHTML 尚为空，若不跳过空内容检测会触发
    // Router.redispatch() 导致双重 render → _renderGen 守卫丢弃经文内容
    win._cxShowApp(true);
    var bar = document.getElementById('fixedChapterBar');
    if (bar) bar.style.display = 'none';

    Promise.all([loadPlanData(), loadBooks()]).then(function () {
      if (instanceId) {
        var inst = getInstance(instanceId);
        if (!inst) { renderPlanList(); return; }
        _currentInstId = inst.id;
        _currentDay = dayNum ? parseInt(dayNum, 10) : dayOfYear(todayStr());
        renderDayContent(inst, _currentDay);
      } else {
        var instances = loadInstances();
        if (instances.length > 0) {
          _currentInstId = instances[0].id;
          _currentDay = dayOfYear(todayStr());
          renderDayContent(instances[0], _currentDay);
        } else {
          _currentInstId = null; _currentDay = null;
          renderPlanList();
        }
      }
    });
  }

  // ══════════════════════════════════════════════════════════
  //  计划选择页
  // ══════════════════════════════════════════════════════════
  function renderPlanList() {
    var app = document.getElementById('app');
    var html = '<div class="rp-container">';
    html += '<div class="rp-header"><button class="rp-back" data-action="go-back">\u2039</button><h2 class="rp-title">\u8bfb\u7ecf\u8ba1\u5212</h2></div>';
    html += '<div class="rp-empty"><div class="rp-empty-icon">\uD83D\uDCD6</div><p>\u8fd8\u6ca1\u6709\u8bfb\u7ecf\u8ba1\u5212</p><p class="rp-empty-hint">\u9009\u62e9\u4e0b\u65b9\u7c7b\u578b\u5f00\u59cb\u4f60\u7684\u8bfb\u7ecf\u4e4b\u65c5</p></div>';
    html += _buildTypeCards();
    html += '</div>';
    app.innerHTML = html;
  }

  function _buildTypeCards() {
    var html = '<div class="rp-type-list">';
    var types = Object.keys(PLAN_TYPES);
    for (var i = 0; i < types.length; i++) {
      var key = types[i], pt = PLAN_TYPES[key];
      html += '<div class="rp-type-card" data-action="quick-create" data-type="' + key + '">';
      html += '<div class="rp-type-icon">' + pt.icon + '</div><div class="rp-type-info"><div class="rp-type-label">' + esc(pt.label) + '</div><div class="rp-type-desc">' + esc(pt.desc) + '</div></div>';
      html += '<div class="rp-type-arrow">\u203a</div></div>';
    }
    return html + '</div>';
  }

  // ══════════════════════════════════════════════════════════
  //  主视图：经文内容 + 侧边抽屉
  // ══════════════════════════════════════════════════════════
  function renderDayContent(inst, doy, opts) {
    _renderGen++;  // 递增渲染代数，使旧的异步回调失效
    var app = document.getElementById('app');
    var entries = getEntriesForDay(inst, doy);
    var dateStr = dateForDay(inst.year, doy);
    var d = new Date(dateStr);
    var total = planTotal(inst);
    var done = completedCount(inst);
    var comp = inst.completed && inst.completed[String(doy)];
    var color = comp ? timeColor(comp.at) : '';
    var pct = total > 0 ? Math.round(done / total * 100) : 0;

    // 保存滚动位置
    var savedScroll = (opts && opts.restoreScroll != null) ? opts.restoreScroll : window.scrollY;

    var html = '<div class="rp-container">';

    // ── 固定顶栏（日期）── 与经文页 fixedChapterBar 一致
    html += '<div class="rp-date-bar">';
    html += '<button class="chapter-nav-btn rp-back-btn" data-action="go-back" title="返回">\u2039</button>';
    html += '<span class="rp-date-label">' + (d.getMonth() + 1) + '\u6708' + d.getDate() + '\u65e5</span>';
    html += '<button class="rp-sidebar-btn" data-action="toggle-drawer" title="\u8fdb\u5ea6">';
    html += '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
    html += '</button></div>';

    // ── 进度条 ──
    html += '<div class="rp-progress-mini"><div class="rp-progress-mini-fill" style="width:' + pct + '%"></div></div>';

    // ── 主内容：经文（与经文页 .bible-reading 一致排版） ──
    html += '<div class="bible-reading">';
    if (entries.length === 0) {
      html += '<div class="rp-empty-day">\u5f53\u5929\u65e0\u8bfb\u7ecf\u5b89\u6392</div>';
    } else {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i], entry = e.entry;
        html += '<div class="rp-reading-section">';
        html += '<div class="rp-reading-heading">' + esc(e.planName) + ' \u00b7 ' + esc(formatEntry(entry)) + '</div>';
        if (entry.topic) {
          html += '<div class="rp-verses" id="rpVerses' + i + '"><div class="rp-topic-loading">\u52a0\u8f7d\u4e2d\u2026</div></div>';
        } else {
          html += '<div class="rp-verses" id="rpVerses' + i + '"></div>';
        }
        html += '</div>';
      }
    }

    // ── 已读按钮（内联在经文下方） ──
    html += '<div class="rp-read-bar-inline">';
    if (comp) {
      html += '<button class="rp-btn-read done" disabled>\u2713 \u5df2\u8bfb <span class="rp-read-ts">' + timeColorLabel(color) + '</span></button>';
    } else {
      html += '<button class="rp-btn-read" data-action="mark-read" data-day="' + doy + '">\u5df2\u8bfb</button>';
    }
    html += '</div>';
    html += '</div>';

    // ── 侧边抽屉 ──
    html += '<div class="rp-drawer-overlay" data-action="close-drawer"></div>';
    html += '<div class="rp-drawer" id="rpDrawer">';
    html += '<div class="rp-drawer-header"><div class="rp-drawer-tabs">';
    html += '<div class="rp-drawer-tab active" data-action="drawer-tab" data-tab="progress">\u8fdb\u5ea6(' + done + '/' + total + ')</div>';
    html += '<div class="rp-drawer-tab" data-action="drawer-tab" data-tab="records">\u8bb0\u5f55</div>';
    html += '</div><button class="rp-drawer-close" data-action="close-drawer">\u2715</button></div>';
    html += '<div class="rp-drawer-body" id="rpDrawerBody">' + _buildCalendarContent(inst) + '</div>';
    html += '</div>';

    html += '</div>';
    app.innerHTML = html;

    // 恢复滚动位置
    if (savedScroll) {
      requestAnimationFrame(function() { window.scrollTo(0, savedScroll); });
    }

    // 绑定滑动手势（先解绑旧监听器再绑定新的）
    _unbindSwipeGesture();
    _bindSwipeGesture();

    // 预缓存相邻天的内容
    _precachAdjacentDays();

    // 立即创建滑动容器（而非等首次触摸），避免 DOM 重组导致布局抖动
    _setupSlider();

    // 异步加载经文（加载完成后再次恢复滚动位置，防止内容高度变化导致跳动）
    _loadAllVerses(entries, savedScroll);
  }

  // 格式化经文：使用与 bible-renderer.js 完全相同的标记类名
  function _formatContent(content, vkey) {
    if (!content) return '';
    var s = esc(content);
    // {N} → 注解锚点（与 bible-renderer.js 一致）
    s = s.replace(/\{(\d+)\}/g, '<span class="fn-ref" data-vkey="' + vkey + '" data-fn="$1"><sup>$1</sup></span>');
    // [a-z] → 串珠锚点（与 bible-renderer.js 一致）
    s = s.replace(/\[([a-z])\]/gi, '<span class="xref-ref" data-vkey="' + vkey + '" data-xr="$1"><sup>$1</sup></span>');
    return s;
  }

  // 获取书卷缩写（用于 vkey）
  function bookAcronym(idx) {
    if (!_books) return String(idx);
    for (var i = 0; i < _books.length; i++) if (_books[i].index === idx) return _books[i].acronym || String(idx);
    return String(idx);
  }

  // 加载大纲数据
  var _outlines = null;
  function loadOutlines() {
    if (_outlines) return Promise.resolve(_outlines);
    return fetch(getRoot() + 'data/bible-outlines.json').then(function (r) { return r.json(); }).then(function (d) { _outlines = d; return d; }).catch(function () { return {}; });
  }

  // 获取章节大纲
  function getOutlinesForRange(bookIndex, chapter, secFrom, secTo) {
    if (!_outlines) return [];
    var bookData = _outlines[String(bookIndex)];
    if (!bookData) return [];
    var chData = bookData[String(chapter)];
    if (!chData || !Array.isArray(chData)) return [];
    var result = [];
    for (var i = 0; i < chData.length; i++) {
      var o = chData[i];
      if (o.section >= secFrom && o.section <= secTo) result.push(o);
    }
    return result;
  }

  // ── 渲染大纲组 HTML（供 _renderEntryVersesHtml 和 _loadAllVerses 复用） ──
  function _renderOutlinesForSection(outlines, sec) {
    var group = [];
    for (var i = 0; i < outlines.length; i++) {
      if (outlines[i].section === sec) group.push(outlines[i]);
    }
    if (group.length === 0) return '';
    var h = '<div class="bible-outline-inline-group">';
    for (var j = 0; j < group.length; j++) {
      var lvl = Math.min(Math.max((group[j].level || 1) - 1, 0), 5);
      h += '<div class="bible-outline-inline outline-level-' + lvl + '">' + esc(stripMarkers(group[j].text)) + '</div>';
    }
    return h + '</div>';
  }

  // ── 纯函数：根据 entry 和章节数据返回完整经文 HTML（不含 DOM 操作） ──
  function _renderEntryVersesHtml(entry, data) {
    if (!data || !data.chapters) return '<div class="rp-verses-empty">\u65e0\u7ecf\u6587\u6570\u636e</div>';
    var acro = bookAcronym(entry.book);
    var html = '';
    var chFrom = entry.chapter;
    var chTo = entry.chapter_to || entry.chapter;
    var hasVerses = false;

    for (var chNum = chFrom; chNum <= chTo; chNum++) {
      var ch = null;
      for (var c = 0; c < data.chapters.length; c++) {
        if (data.chapters[c].chapter === chNum) { ch = data.chapters[c]; break; }
      }
      if (!ch || !ch.verses) continue;

      var secStart = (chNum === chFrom) ? entry.section : 1;
      var secEnd = (chNum === chTo) ? entry.section_to : 9999;

      if (chNum > chFrom) {
        html += '<div class="rp-chapter-divider">' + esc(bookName(entry.book)) + ' ' + chNum + '</div>';
      }

      // 章节开头大纲（section <= secStart）
      var outlines = getOutlinesForRange(entry.book, chNum, secStart, secEnd);
      if (outlines.length > 0) {
        var preOutlines = [];
        for (var oi = 0; oi < outlines.length; oi++) {
          if (outlines[oi].section <= secStart) preOutlines.push(outlines[oi]);
        }
        if (preOutlines.length > 0) {
          html += '<div class="bible-outline-inline-group">';
          for (var pi = 0; pi < preOutlines.length; pi++) {
            var lvl = Math.min(Math.max((preOutlines[pi].level || 1) - 1, 0), 5);
            html += '<div class="bible-outline-inline outline-level-' + lvl + '">' + esc(stripMarkers(preOutlines[pi].text)) + '</div>';
          }
          html += '</div>';
        }
      }

      // 经文 + 行间大纲
      for (var v = 0; v < ch.verses.length; v++) {
        var vs = ch.verses[v];
        if (vs.section < secStart || vs.section > secEnd) continue;
        hasVerses = true;

        if (outlines.length > 0) {
          for (var oi2 = 0; oi2 < outlines.length; oi2++) {
            if (outlines[oi2].section === vs.section && outlines[oi2].section > secStart) {
              html += _renderOutlinesForSection(outlines, vs.section);
              break;
            }
          }
        }

        var vkey = acro + chNum + ':' + vs.section;
        var flagLabel = '';
        if (vs.flag === 1) flagLabel = '\u4e0a';
        else if (vs.flag === 2) flagLabel = '\u4e0b';
        else if (vs.flag === 3) flagLabel = '\u4e2d';

        html += '<div class="bible-verse" data-section="' + vs.section + '"' + (vs.flag ? ' data-flag="' + vs.flag + '"' : '') + '>';
        html += '<span class="verse-num">' + vs.section + flagLabel + '</span>';
        html += '<div class="bible-verse-lang primary">' + _formatContent(vs.content || '', vkey) + '</div>';
        html += '</div>';
      }
    }

    if (!hasVerses) return '<div class="rp-verses-empty">\u65e0\u5339\u914d\u7ecf\u6587</div>';
    return html;
  }

  // ── 异步预渲染一天的完整经文 HTML（含经文内容） ──
  function _preRenderDayWithVerses(inst, doy) {
    var entries = getEntriesForDay(inst, doy);
    if (entries.length === 0) return Promise.resolve(_buildDayInnerHtml(inst, doy));
    var promises = entries.map(function (e) {
      // 主题日：加载主题文本
      if (e.entry._allTopics) {
        return loadTopics().then(function () {
          var html = '<div class="bible-all-topics">';
          var keys = Object.keys(_topicsData).sort(function(a, b) { return +a - +b; });
          for (var k = 0; k < keys.length; k++) {
            var bIdx = keys[k];
            var topicText = _topicsData[bIdx];
            if (!topicText) continue;
            var bName = bookName(+bIdx);
            html += '<div class="bible-topic-item">';
            html += '<span class="bible-topic-book">' + esc(bName) + '</span>';
            html += '<span class="bible-topic-text">' + esc(topicText) + '</span>';
            html += '</div>';
          }
          html += '</div>';
          return html;
        });
      }
      if (e.entry.topic) {
        return loadTopics().then(function () {
          var topic = getTopic(e.entry.book);
          if (topic) {
            var html = '<div class="bible-theme-text">';
            html += '<span class="meta-label">\u4e3b\u9898</span>';
            html += '<span class="theme-content">' + esc(topic) + '</span>';
            html += '</div>';
            return html;
          }
          return '<div class="rp-verses-empty">\u65e0\u4e3b\u9898\u6570\u636e</div>';
        });
      }
      return Promise.all([loadChapter(e.entry.book), loadOutlines()]).then(function (results) {
        return _renderEntryVersesHtml(e.entry, results[0]);
      });
    });
    return Promise.all(promises).then(function (versesHtml) {
      var html = '';
      // 全卷主题日：特殊标题
      if (entries.length > 0 && entries[0].entry._allTopics) {
        html += '<div class="rp-reading-section">';
        html += '<div class="rp-reading-heading">' + esc(formatEntry(entries[0].entry)) + '</div>';
        html += '<div class="rp-verses" id="rpVerses0">' + versesHtml[0] + '</div>';
        html += '</div>';
      } else {
        for (var i = 0; i < entries.length; i++) {
          html += '<div class="rp-reading-section">';
          html += '<div class="rp-reading-heading">' + esc(entries[i].planName) + ' \u00b7 ' + esc(formatEntry(entries[i].entry)) + '</div>';
          html += '<div class="rp-verses" id="rpVerses' + i + '">' + versesHtml[i] + '</div>';
          html += '</div>';
        }
      }
      // 已读按钮
      var comp = inst.completed && inst.completed[String(doy)];
      var color = comp ? timeColor(comp.at) : '';
      html += '<div class="rp-read-bar-inline">';
      if (comp) {
        html += '<button class="rp-btn-read done" disabled>\u2713 \u5df2\u8bfb <span class="rp-read-ts">' + timeColorLabel(color) + '</span></button>';
      } else {
        html += '<button class="rp-btn-read" data-action="mark-read" data-day="' + doy + '">\u5df2\u8bfb</button>';
      }
      html += '</div>';
      return html;
    });
  }

  // ── 加载并渲染完整经文（支持跨章节） ──
  function _loadAllVerses(entries, restoreScroll) {
    console.log('[RP] _loadAllVerses entries:', entries.length);
    var gen = _renderGen;  // 捕获当前渲染代数，异步回调中校验
    var pending = entries.length;
    function onVerseDone() {
      pending--;
      requestAnimationFrame(_updateSliderHeight);
      if (pending <= 0 && restoreScroll) {
        requestAnimationFrame(function() { window.scrollTo(0, restoreScroll); });
      }
      // 全部经文加载完成时，多重兜底更新高度，确保布局稳定后能读到正确的 offsetHeight
      if (pending <= 0) {
        setTimeout(_updateSliderHeight, 100);
        setTimeout(_updateSliderHeight, 300);
        setTimeout(_updateSliderHeight, 600);
      }
    }
    if (entries.length === 0) {
      if (restoreScroll) requestAnimationFrame(function() { window.scrollTo(0, restoreScroll); });
      return;
    }
    for (var i = 0; i < entries.length; i++) {
      (function (idx, e) {
        var el = document.getElementById('rpVerses' + idx);
        if (!el) return;
        var entry = e.entry;

        // 全卷主题日：显示66卷书所有主题
        if (entry._allTopics) {
          loadTopics().then(function () {
            if (gen !== _renderGen || !document.body.classList.contains('cx-reading-plan-page')) return;
            var html = '<div class="bible-all-topics">';
            var keys = Object.keys(_topicsData).sort(function(a, b) { return +a - +b; });
            for (var k = 0; k < keys.length; k++) {
              var bIdx = keys[k];
              var topicText = _topicsData[bIdx];
              if (!topicText) continue;
              var bName = bookName(+bIdx);
              html += '<div class="bible-topic-item">';
              html += '<span class="bible-topic-book">' + esc(bName) + '</span>';
              html += '<span class="bible-topic-text">' + esc(topicText) + '</span>';
              html += '</div>';
            }
            html += '</div>';
            el.innerHTML = html;
            console.log('[RP] all-topics rendered, books=' + keys.length);
            onVerseDone();
          }).catch(function () {
            if (gen !== _renderGen) return;
            el.innerHTML = '<div class="rp-verses-empty">\u52a0\u8f7d\u5931\u8d25</div>';
            onVerseDone();
          });
          return;
        }

        // 主题日：加载并显示书卷主题
        if (entry.topic) {
          loadTopics().then(function () {
            if (gen !== _renderGen || !document.body.classList.contains('cx-reading-plan-page')) return;
            var topic = getTopic(entry.book);
            var html = '';
            if (topic) {
              html += '<div class="bible-theme-text">';
              html += '<span class="meta-label">\u4e3b\u9898</span>';
              html += '<span class="theme-content">' + esc(topic) + '</span>';
              html += '</div>';
            } else {
              html += '<div class="rp-verses-empty">\u65e0\u4e3b\u9898\u6570\u636e</div>';
            }
            el.innerHTML = html;
            console.log('[RP] entry[' + idx + '] topic rendered');
            onVerseDone();
          }).catch(function () {
            if (gen !== _renderGen) return;
            el.innerHTML = '<div class="rp-verses-empty">\u52a0\u8f7d\u5931\u8d25</div>';
            onVerseDone();
          });
          return;
        }

        el.innerHTML = '<div class="rp-verses-loading">\u52a0\u8f7d\u4e2d\u2026</div>';

        Promise.all([loadChapter(entry.book), loadOutlines()]).then(function (results) {
          // 渲染代守卫：若已导航离开或有新渲染，丢弃本次结果避免覆盖新页面
          if (gen !== _renderGen || !document.body.classList.contains('cx-reading-plan-page')) return;
          var html = _renderEntryVersesHtml(entry, results[0]);
          el.innerHTML = html;
          console.log('[RP] entry[' + idx + '] rendered');
          onVerseDone();
        }).catch(function (err) {
          if (gen !== _renderGen) return;  // 已有新渲染，不处理错误
          console.error('[RP] entry[' + idx + '] ERROR:', err);
          el.innerHTML = '<div class="rp-verses-empty">\u52a0\u8f7d\u5931\u8d25</div>';
          onVerseDone();
        });
      })(i, entries[i]);
    }
  }

  // ══════════════════════════════════════════════════════════
  //  手势导航（左右滑动切换天 — 与 bible-renderer.js 一致架构）
  // ══════════════════════════════════════════════════════════

  function _resolveDay(delta) {
    if (!_currentDay) return null;
    var inst = _currentInstId ? getInstance(_currentInstId) : null;
    if (!inst) return null;
    var total = planTotal(inst);
    var newDay = _currentDay + delta;
    if (newDay < 1 || newDay > total) return null;
    return newDay;
  }

  function _buildDayInnerHtml(inst, doy) {
    var entries = getEntriesForDay(inst, doy);
    var html = '';
    if (entries.length === 0) {
      html += '<div class="rp-empty-day">\u5f53\u5929\u65e0\u8bfb\u7ecf\u5b89\u6392</div>';
    } else {
      // 全卷主题日：特殊标题
      var first = entries[0], firstEntry = first.entry;
      if (firstEntry._allTopics) {
        html += '<div class="rp-reading-section">';
        html += '<div class="rp-reading-heading">' + esc(formatEntry(firstEntry)) + '</div>';
        html += '<div class="rp-verses" id="rpVerses0"><div class="rp-topic-loading">\u52a0\u8f7d\u4e2d\u2026</div></div>';
        html += '</div>';
      } else {
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i], entry = e.entry;
          html += '<div class="rp-reading-section">';
          html += '<div class="rp-reading-heading">' + esc(e.planName) + ' \u00b7 ' + esc(formatEntry(entry)) + '</div>';
          if (entry.topic) {
            html += '<div class="rp-verses" id="rpVerses' + i + '"><div class="rp-topic-loading">\u52a0\u8f7d\u4e2d\u2026</div></div>';
          } else {
            html += '<div class="rp-verses" id="rpVerses' + i + '"></div>';
          }
          html += '</div>';
        }
      }
    }
    var comp = inst.completed && inst.completed[String(doy)];
    var color = comp ? timeColor(comp.at) : '';
    html += '<div class="rp-read-bar-inline">';
    if (comp) {
      html += '<button class="rp-btn-read done" disabled>\u2713 \u5df2\u8bfb <span class="rp-read-ts">' + timeColorLabel(color) + '</span></button>';
    } else {
      html += '<button class="rp-btn-read" data-action="mark-read" data-day="' + doy + '">\u5df2\u8bfb</button>';
    }
    html += '</div>';
    return html;
  }

  function _precachAdjacentDays() {
    if (!_currentDay || !_currentInstId) return;
    var inst = getInstance(_currentInstId);
    if (!inst) return;
    var gen = _renderGen;  // 捕获当前渲染代数，异步回调中校验
    var keep = {};
    var prev = _resolveDay(-1);
    var next = _resolveDay(1);
    if (prev) keep[prev] = true;
    if (next) keep[next] = true;
    // 清理旧缓存
    Object.keys(_preRenderedDayHtml).forEach(function(k) {
      if (!keep[parseInt(k, 10)]) delete _preRenderedDayHtml[k];
    });
    // 先存骨架（供 _setupSlider 立即使用）
    if (prev) _preRenderedDayHtml[prev] = _buildDayInnerHtml(inst, prev);
    if (next) _preRenderedDayHtml[next] = _buildDayInnerHtml(inst, next);

    // 异步预加载经文，更新缓存和侧页 DOM
    var days = [];
    if (prev) days.push(prev);
    if (next) days.push(next);
    days.forEach(function(doy) {
      _preRenderDayWithVerses(inst, doy).then(function(html) {
        _preRenderedDayHtml[doy] = html;
        // 已离开读经计划页或已有新渲染 → 不更新侧页 DOM
        if (!document.body.classList.contains('cx-reading-plan-page')) return;
        if (gen !== _renderGen) return;
        var container = document.getElementById('app');
        if (!container) return;
        var pages = container.querySelectorAll('.swipe-page.left-page .bible-reading, .swipe-page.right-page .bible-reading');
        for (var i = 0; i < pages.length; i++) {
          var page = pages[i].closest('.swipe-page');
          if (!page) continue;
          var isLeft = page.classList.contains('left-page') && doy === _resolveDay(-1);
          var isRight = page.classList.contains('right-page') && doy === _resolveDay(1);
          if (isLeft || isRight) {
            pages[i].innerHTML = html;
          }
        }
      });
    });
  }

  // ── 动态更新滑动容器高度（经文异步加载后调用） ──
  function _updateSliderHeight() {
    if (!document.body.classList.contains('cx-reading-plan-page')) return;
    var container = document.getElementById('app');
    if (!container) return;
    var wrapper = container.querySelector('.swipe-slider');
    var centerEl = wrapper && wrapper.querySelector('.center-page');
    if (!wrapper || !centerEl) return;
    var h = centerEl.offsetHeight;
    if (h <= 0) return; // centerPage 未布局或不在 DOM 中，不修改
    var oldH = parseInt(wrapper.style.minHeight, 10) || parseInt(wrapper.style.height, 10) || 0;
    // 允许增大也允许缩小（差值>10px时更新），避免骨架阶段测得的偏小值
    // 锁死 min-height 导致内容无法完整滚动
    if (Math.abs(h - oldH) > 10) {
      wrapper.style.minHeight = h + 'px';
      // 兼容旧 height 属性
      if (parseInt(wrapper.style.height, 10) > 0) {
        wrapper.style.height = '';
      }
      console.log('[RP] _updateSliderHeight: ' + oldH + ' → ' + h + 'px');
    }
  }

  // ── 创建三页滑动容器（左-中-右预渲染），与经文页 swipe-slider 一致 ──
  function _setupSlider() {
    var container = document.getElementById('app');
    if (!container) return;
    var contentEl = container.querySelector('.rp-container > .bible-reading');
    if (!contentEl) return;
    if (contentEl.closest && contentEl.closest('.swipe-slider')) return;

    var W = container.offsetWidth;
    var wrapper = document.createElement('div');
    wrapper.className = 'swipe-slider';
    wrapper.style.cssText = 'position:relative;width:' + W + 'px;overflow-x:hidden;overflow-y:visible;';

    var centerPage = document.createElement('div');
    centerPage.className = 'swipe-page center-page';
    centerPage.style.cssText = 'width:' + W + 'px;min-height:' + viewH + 'px;'
    centerPage.appendChild(contentEl);
    wrapper.appendChild(centerPage);
    container.appendChild(wrapper);

    // .bible-reading 已移出 .rp-container，取消其 min-height:100vh 和 padding 防止空白
    // （.rp-container 内只剩 position:fixed 子元素，自身不应占据文档流空间）
    var rpContainer = container.querySelector('.rp-container');
    if (rpContainer) { rpContainer.style.minHeight = '0'; rpContainer.style.paddingBottom = '0'; }

    // 同步测量中页高度并设置 wrapper 高度（与 bible-renderer.js 一致）
    var centerH = centerPage.offsetHeight;
    // centerH 为 0 时用视口高度兜底，防止 height:0 + overflow:hidden 裁切成空白
    if (centerH <= 0) {
      centerH = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0;
    }

    var wrapperLeft = wrapper.getBoundingClientRect().left;
    var viewH = window.innerHeight;

    var inst = _currentInstId ? getInstance(_currentInstId) : null;

    // 左页（前一天）
    var leftPage = document.createElement('div');
    leftPage.className = 'swipe-page left-page';
    leftPage.style.cssText = 'position:fixed;top:0;left:' + (wrapperLeft - W) + 'px;width:' + W + 'px;height:' + viewH + 'px;overflow:hidden;z-index:1;contain:content;backface-visibility:hidden;';
    var prevDay = _resolveDay(-1);
    if (prevDay && inst) {
      var prevHtml = _preRenderedDayHtml[prevDay] || _buildDayInnerHtml(inst, prevDay);
      leftPage.innerHTML = '<div class="bible-reading">' + prevHtml + '</div>';
    }

    // 右页（后一天）
    var rightPage = document.createElement('div');
    rightPage.className = 'swipe-page right-page';
    rightPage.style.cssText = 'position:fixed;top:0;left:' + (wrapperLeft + W) + 'px;width:' + W + 'px;height:' + viewH + 'px;overflow:hidden;z-index:1;contain:content;backface-visibility:hidden;';
    var nextDay = _resolveDay(1);
    if (nextDay && inst) {
      var nextHtml = _preRenderedDayHtml[nextDay] || _buildDayInnerHtml(inst, nextDay);
      rightPage.innerHTML = '<div class="bible-reading">' + nextHtml + '</div>';
    }

    wrapper.appendChild(leftPage);
    wrapper.appendChild(rightPage);

    // 不设固定 height——改为由 center-page 内容自动撑开 wrapper 高度
    // center-page 的 min-height 保证空内容也有合理高度
    // 这彻底消除了冷启动时 offsetHeight=0 导致 height:0+overflow:hidden 裁切白屏的问题
    wrapper.style.minHeight = (centerH > viewH ? centerH : viewH) + 'px';
    requestAnimationFrame(_updateSliderHeight);
  }

  function _setSliderTransform(centerEl, leftEl, rightEl, dx, animate) {
    var transition = animate ? 'transform 0.18s cubic-bezier(.22,.61,.36,1)' : 'none';
    [centerEl, leftEl, rightEl].forEach(function(el) {
      if (!el) return;
      el.style.transition = transition;
      el.style.transform = 'translate3d(' + dx + 'px,0,0)';
      el.style.willChange = 'transform';
    });
  }

  function _animateSwipe(direction) {
    var targetDay = _resolveDay(direction);
    if (!targetDay) return false;

    var container = document.getElementById('app');
    if (!container) return false;

    var wrapper = container.querySelector('.swipe-slider');
    var centerEl = wrapper ? wrapper.querySelector('.center-page') : null;
    var leftEl = wrapper ? wrapper.querySelector('.left-page') : null;
    var rightEl = wrapper ? wrapper.querySelector('.right-page') : null;
    if (!wrapper || !centerEl) return false;

    var W = wrapper.offsetWidth;
    var targetX = -direction * W;

    _isAnimating = true;
    _setSliderTransform(centerEl, leftEl, rightEl, targetX, true);

    var cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      _isAnimating = false;

      _currentDay = targetDay;

      var inst = getInstance(_currentInstId);
      if (!inst) return;

      // 局部更新：只替换日期文字、进度条、经文内容，保留顶栏 DOM 不重建，避免闪烁
      var newContentHtml = _preRenderedDayHtml[targetDay] || _buildDayInnerHtml(inst, targetDay);
      var dateStr = dateForDay(inst.year, targetDay);
      var d = new Date(dateStr);
      var total = planTotal(inst);
      var done = completedCount(inst);
      var pct = total > 0 ? Math.round(done / total * 100) : 0;

      // 更新日期文字
      var dateLabel = container.querySelector('.rp-date-label');
      if (dateLabel) dateLabel.textContent = (d.getMonth() + 1) + '\u6708' + d.getDate() + '\u65e5';

      // 更新进度条
      var progressFill = container.querySelector('.rp-progress-mini-fill');
      if (progressFill) progressFill.style.width = pct + '%';

      // 更新抽屉进度标签
      var progressTab = container.querySelector('.rp-drawer-tab[data-tab="progress"]');
      if (progressTab) progressTab.textContent = '\u8fdb\u5ea6(' + done + '/' + total + ')';

      // 更新抽屉日历（高亮当前日）
      var drawerBody = container.querySelector('#rpDrawerBody');
      if (drawerBody) drawerBody.innerHTML = _buildCalendarContent(inst);

      // 更新经文内容
      var rpContainer = container.querySelector('.rp-container');
      if (rpContainer) {
        // 移除旧的 swipe-slider
        var oldSlider = container.querySelector('.swipe-slider');
        if (oldSlider) container.removeChild(oldSlider);
        // 移除旧的 bible-reading（可能在 rpContainer 内或 swipe-slider 内）
        var oldReading = rpContainer.querySelector('.bible-reading');
        if (oldReading) oldReading.parentNode.removeChild(oldReading);

        // 创建新的 bible-reading
        var readingDiv = document.createElement('div');
        readingDiv.className = 'bible-reading';
        readingDiv.innerHTML = newContentHtml;
        rpContainer.appendChild(readingDiv);

        // 确保 rp-container 恢复文档流
        rpContainer.style.minHeight = '0';
        rpContainer.style.paddingBottom = '0';
      }

      // 重建滑动容器
      _setupSlider();

      window.scrollTo(0, 0);

      // 若预渲染已包含完整经文则跳过加载，否则异步加载经文
      var hasFullVerses = newContentHtml.indexOf('class="bible-verse"') !== -1;
      if (hasFullVerses) {
        requestAnimationFrame(_updateSliderHeight);
      } else {
        var entries = getEntriesForDay(inst, targetDay);
        _loadAllVerses(entries);
      }

      _precachAdjacentDays();

      // 同步路由（不触发 re-dispatch）
      var newHash = '#/reading-plan/' + _currentInstId + '/' + targetDay;
      if (window.location.hash !== newHash) {
        try {
          history.replaceState(null, '', newHash);
        } catch(e) {
          window.location.hash = newHash;
        }
      }
    }

    centerEl.addEventListener('transitionend', function handler() {
      centerEl.removeEventListener('transitionend', handler);
      cleanup();
    });
    setTimeout(cleanup, 250);

    return true;
  }

  var _touchStartHandler = null;
  var _touchMoveHandler = null;
  var _touchEndHandler = null;
  var _swipeContainer = null;

  function _unbindSwipeGesture() {
    if (_swipeContainer && _touchStartHandler) {
      _swipeContainer.removeEventListener('touchstart', _touchStartHandler);
      _swipeContainer.removeEventListener('touchmove', _touchMoveHandler);
      _swipeContainer.removeEventListener('touchend', _touchEndHandler);
    }
    _touchStartHandler = null;
    _touchMoveHandler = null;
    _touchEndHandler = null;
    _swipeContainer = null;
    _swipeBound = false;
  }

  function _bindSwipeGesture() {
    if (_swipeBound) return;
    _swipeBound = true;

    var container = document.getElementById('app');
    if (!container) return;
    _swipeContainer = container;

    var startX = 0, startY = 0, startTime = 0;
    var isDragging = false, isHorizontal = null;
    var centerEl = null, leftEl = null, rightEl = null;
    var wrapperW = 0;
    var _rafId = 0, _pendingDx = 0;

    _touchStartHandler = function(e) {
      if (_isAnimating) return;
      if (!document.body.classList.contains('cx-reading-plan-page')) return;
      var target = e.target;
      if (target.closest && target.closest('button, a, input, .rp-drawer, .rp-drawer-overlay')) return;
      var sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;

      var wrapper = container.querySelector('.swipe-slider');
      if (!wrapper) return;
      centerEl = wrapper.querySelector('.center-page');
      leftEl = wrapper.querySelector('.left-page');
      rightEl = wrapper.querySelector('.right-page');
      if (!centerEl) return;

      wrapperW = wrapper.offsetWidth;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startTime = Date.now();
      isDragging = true;
      isHorizontal = null;
    };

    _touchMoveHandler = function(e) {
      if (!isDragging || _isAnimating || !centerEl) return;
      var dx = e.touches[0].clientX - startX;
      var dy = e.touches[0].clientY - startY;

      if (isHorizontal === null) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        isHorizontal = Math.abs(dx) >= 2 * Math.abs(dy);
      }
      if (!isHorizontal) { isDragging = false; return; }

      // 边界阻尼：第一天左滑 / 最后一天右滑
      var inst = _currentInstId ? getInstance(_currentInstId) : null;
      var total = inst ? planTotal(inst) : 365;
      var atStart = (_currentDay <= 1 && dx > 0);
      var atEnd = (_currentDay >= total && dx < 0);
      if (atStart || atEnd) dx = dx * 0.2;

      _pendingDx = dx;
      if (!_rafId) {
        _rafId = requestAnimationFrame(function() {
          _rafId = 0;
          _setSliderTransform(centerEl, leftEl, rightEl, _pendingDx, false);
        });
      }
    };

    _touchEndHandler = function(e) {
      if (!isDragging) return;
      isDragging = false;
      if (_rafId) { cancelAnimationFrame(_rafId); _rafId = 0; }
      if (isHorizontal !== true || !centerEl) { _resetDrag(); return; }

      var dx = e.changedTouches[0].clientX - startX;
      var dt = Date.now() - startTime;
      var vel = Math.abs(dx) / (dt || 1);
      var ratio = Math.abs(dx) / wrapperW;
      var direction = dx < 0 ? 1 : -1;

      if (ratio > 0.20 || vel > 0.3) {
        if (_animateSwipe(direction)) return;
      }

      // 未达阈值 → 弹回
      _setSliderTransform(centerEl, leftEl, rightEl, 0, true);
      var els = [centerEl, leftEl, rightEl];
      setTimeout(function() {
        els.forEach(function(el) {
          if (!el) return;
          el.style.transition = '';
          el.style.willChange = '';
        });
      }, 200);
      _resetDrag();
    };

    function _resetDrag() {
      isHorizontal = null;
      centerEl = null; leftEl = null; rightEl = null;
    }

    container.addEventListener('touchstart', _touchStartHandler, {passive: true});
    container.addEventListener('touchmove', _touchMoveHandler, {passive: true});
    container.addEventListener('touchend', _touchEndHandler);
  }

  // ══════════════════════════════════════════════════════════
  //  抽屉内容构建
  // ══════════════════════════════════════════════════════════
  function _buildCalendarContent(inst) {
    var year = inst.year || new Date().getFullYear(), todayDoy = dayOfYear(todayStr());
    var html = '<div class="rp-legend"><span class="rp-legend-item"><span class="rp-dot green"></span>\u6e05\u6668</span><span class="rp-legend-item"><span class="rp-dot yellow"></span>\u65e5\u95f4</span><span class="rp-legend-item"><span class="rp-dot red"></span>\u5176\u4ed6</span></div>';
    html += _buildCalendar(inst, year, todayDoy);
    return html;
  }

  function _buildRecordsContent(inst) {
    var all = loadInstances(), rounds = completedRounds(inst.type), html = '';
    var typeGroups = {};
    for (var i = 0; i < all.length; i++) { var t = all[i].type; if (!typeGroups[t]) typeGroups[t] = []; typeGroups[t].push(all[i]); }
    var types = Object.keys(typeGroups);
    for (var ti = 0; ti < types.length; ti++) {
      var type = types[ti], pt = PLAN_TYPES[type], group = typeGroups[type];
      html += '<div class="rp-record-group"><div class="rp-record-group-title">' + (pt ? pt.icon + ' ' + pt.label : type) + '</div>';
      for (var gi = 0; gi < group.length; gi++) {
        var g = group[gi], dn = completedCount(g), tt = planTotal(g);
        html += '<div class="rp-record-card' + (g.id === inst.id ? ' current' : '') + '" data-action="switch-plan" data-id="' + g.id + '">';
        html += '<div class="rp-record-date">\u5f00\u59cb: ' + esc(g.startDate) + '</div>';
        html += '<div class="rp-record-meta">' + esc(pt ? pt.label : type) + '  ' + dn + '/' + tt + '</div>';
        html += '<div class="rp-progress-bar"><div class="rp-progress-fill" style="width:' + (tt > 0 ? Math.round(dn / tt * 100) : 0) + '%"></div></div>';
        if (g.id === inst.id) html += '<div class="rp-record-badge">\u5f53\u524d</div>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '<div class="rp-records-footer">\u5df2\u5b8c\u6210 ' + rounds + ' \u904d\u8bfb\u7ecf</div>';
    html += '<button class="rp-btn-create" data-action="show-create">\u65b0\u589e\u8bb0\u5f55</button>';
    return html;
  }

  function _buildCalendar(inst, year, todayDoy) {
    var mn = ['1\u6708','2\u6708','3\u6708','4\u6708','5\u6708','6\u6708','7\u6708','8\u6708','9\u6708','10\u6708','11\u6708','12\u6708'];
    var wd = ['\u65e5','\u4e00','\u4e8c','\u4e09','\u56db','\u4e94','\u516d'];
    var html = '<div class="rp-calendar">';
    for (var m = 0; m < 12; m++) {
      html += '<div class="rp-month"><div class="rp-month-name">' + year + '\u5e74' + mn[m] + '</div><div class="rp-weekdays">';
      for (var w = 0; w < 7; w++) html += '<span class="rp-wd' + (w === 0 ? ' sun' : '') + '">' + wd[w] + '</span>';
      html += '</div><div class="rp-days">';
      var fd = firstDayOfMonth(year, m), dim = daysInMonth(year, m);
      for (var b = 0; b < fd; b++) html += '<span class="rp-day empty"></span>';
      for (var d = 1; d <= dim; d++) {
        var doy = dayOfYear(year + '-' + pad2(m + 1) + '-' + pad2(d));
        var comp = inst.completed && inst.completed[String(doy)];
        var clr = comp ? timeColor(comp.at) : '';
        var isToday = (doy === todayDoy), isCur = (doy === _currentDay);
        var cls = 'rp-day';
        if (isToday) cls += ' today';
        if (isCur && !isToday) cls += ' selected';
        if (clr) cls += ' done ' + clr;
        html += '<span class="' + cls + '" data-action="drawer-select-day" data-day="' + doy + '">' + d;
        if (clr) html += '<span class="rp-check">\u2713</span>';
        html += '</span>';
      }
      html += '</div></div>';
    }
    return html + '</div>';
  }

  // ══════════════════════════════════════════════════════════
  //  抽屉操作
  // ══════════════════════════════════════════════════════════
  function openDrawer(tab) {
    var drawer = document.getElementById('rpDrawer'), overlay = document.querySelector('.rp-drawer-overlay');
    if (drawer) drawer.classList.add('open');
    if (overlay) overlay.classList.add('open');
    _switchDrawerTab(tab || 'progress');
    setTimeout(function () {
      var sel = document.querySelector('#rpDrawerBody .rp-day.today, #rpDrawerBody .rp-day.selected');
      if (sel) sel.scrollIntoView({ block: 'center', behavior: 'auto' });
    }, 150);
  }
  function closeDrawer() {
    var drawer = document.getElementById('rpDrawer'), overlay = document.querySelector('.rp-drawer-overlay');
    if (drawer) drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
  }
  function _switchDrawerTab(tab) {
    var inst = _currentInstId ? getInstance(_currentInstId) : null;
    if (!inst) return;
    var tabs = document.querySelectorAll('.rp-drawer-tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].dataset.tab === tab);
    var body = document.getElementById('rpDrawerBody');
    if (!body) return;
    body.innerHTML = (tab === 'records') ? _buildRecordsContent(inst) : _buildCalendarContent(inst);
  }

  // ══════════════════════════════════════════════════════════
  //  创建对话框
  // ══════════════════════════════════════════════════════════
  function showCreateDialog() {
    if (document.getElementById('rpCreateDialog')) return;
    var ov = document.createElement('div');
    ov.id = 'rpCreateDialog'; ov.className = 'rp-dialog-overlay';
    var types = Object.keys(PLAN_TYPES), html = '<div class="rp-dialog"><div class="rp-dialog-title">\u65b0\u589e\u8bfb\u7ecf\u8bb0\u5f55</div>';
    for (var i = 0; i < types.length; i++) {
      var key = types[i], pt = PLAN_TYPES[key];
      html += '<div class="rp-dialog-option" data-action="create-plan" data-type="' + key + '"><div class="rp-dialog-opt-icon">' + pt.icon + '</div><div class="rp-dialog-opt-body"><div class="rp-dialog-opt-label">' + esc(pt.label) + '</div><div class="rp-dialog-opt-desc">' + esc(pt.desc) + '</div></div></div>';
    }
    html += '<button class="rp-dialog-cancel" data-action="close-dialog">\u53d6\u6d88</button></div>';
    ov.innerHTML = html; document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeDialog(); });
  }
  function closeDialog() { var el = document.getElementById('rpCreateDialog'); if (el) el.parentNode.removeChild(el); }

  // ══════════════════════════════════════════════════════════
  //  事件委托
  // ══════════════════════════════════════════════════════════
  function setupEvents() {
    var app = document.getElementById('app');
    if (!app) return;
    app.addEventListener('click', function (e) {
      var t = e.target.closest('[data-action]');
      if (!t) return;
      var action = t.dataset.action;
      switch (action) {
        case 'go-back':
          if (win.CXRouter) win.CXRouter.navigate('bible');
          break;
        case 'toggle-drawer':
          openDrawer(); break;
        case 'close-drawer':
          closeDrawer(); break;
        case 'drawer-tab':
          _switchDrawerTab(t.dataset.tab); break;
        case 'drawer-select-day':
          var day = parseInt(t.dataset.day, 10);
          _currentDay = day; closeDrawer();
          var inst = getInstance(_currentInstId);
          if (inst && win.CXRouter) win.CXRouter.navigate('reading-plan/' + inst.id + '/' + day);
          break;
        case 'mark-read':
          if (_currentInstId) {
            var day = parseInt(t.dataset.day, 10);
            markDay(_currentInstId, day);
            var inst = getInstance(_currentInstId);
            if (inst) {
              // 局部更新：只更新已读按钮、进度条、进度标签
              var comp = inst.completed && inst.completed[String(day)];
              var color = comp ? timeColor(comp.at) : '';
              var total = planTotal(inst);
              var done = completedCount(inst);
              var pct = total > 0 ? Math.round(done / total * 100) : 0;
              // 更新按钮
              var barEl = t.parentNode;
              if (barEl) {
                barEl.innerHTML = '<button class="rp-btn-read done" disabled>\u2713 \u5df2\u8bfb <span class="rp-read-ts">' + timeColorLabel(color) + '</span></button>';
              }
              // 更新进度条
              var fill = document.querySelector('.rp-progress-mini-fill');
              if (fill) fill.style.width = pct + '%';
              // 更新抽屉进度标签
              var tab = document.querySelector('.rp-drawer-tab[data-tab="progress"]');
              if (tab) tab.textContent = '\u8fdb\u5ea6(' + done + '/' + total + ')';
            }
          }
          break;
        case 'show-create':
          closeDrawer(); showCreateDialog(); break;
        case 'create-plan':
        case 'quick-create':
          var type = t.dataset.type;
          var inst = createInstance(type);
          closeDialog(); closeDrawer();
          _currentInstId = inst.id; _currentDay = dayOfYear(todayStr());
          renderDayContent(inst, _currentDay);
          // 同步路由 + 持久化页面记忆
          var _createHash = '#/reading-plan/' + _currentInstId + '/' + _currentDay;
          if (window.location.hash !== _createHash) {
            try { history.replaceState(null, '', _createHash); } catch(e) { window.location.hash = _createHash; }
          }
          if (win.CXSavePage) { try { win.CXSavePage(); } catch(e) {} }
          break;
        case 'switch-plan':
          _currentInstId = t.dataset.id; _currentDay = dayOfYear(todayStr());
          closeDrawer();
          var inst = getInstance(_currentInstId);
          if (inst) renderDayContent(inst, _currentDay);
          // 同步路由 + 持久化页面记忆，确保冷启动恢复到切换后的计划
          var _switchHash = '#/reading-plan/' + _currentInstId + '/' + _currentDay;
          if (window.location.hash !== _switchHash) {
            try { history.replaceState(null, '', _switchHash); } catch(e) { window.location.hash = _switchHash; }
          }
          if (win.CXSavePage) { try { win.CXSavePage(); } catch(e) {} }
          break;
        case 'goto-reading':
          var book = t.dataset.book, ch = t.dataset.chapter;
          if (book && ch && win.CXRouter) win.CXRouter.navigate('bible/' + book + '/' + ch);
          break;
      }
    });

    document.addEventListener('click', function (e) {
      var dialog = document.getElementById('rpCreateDialog');
      if (!dialog) return;
      var t = e.target.closest('[data-action]');
      if (!t || !dialog.contains(t)) return;
      if (t.dataset.action === 'create-plan') {
        var inst = createInstance(t.dataset.type);
        closeDialog(); _currentInstId = inst.id; _currentDay = dayOfYear(todayStr());
        renderDayContent(inst, _currentDay);
        // 同步路由 + 持久化页面记忆
        var _dHash = '#/reading-plan/' + _currentInstId + '/' + _currentDay;
        if (window.location.hash !== _dHash) {
          try { history.replaceState(null, '', _dHash); } catch(e) { window.location.hash = _dHash; }
        }
        if (win.CXSavePage) { try { win.CXSavePage(); } catch(e) {} }
      } else if (t.dataset.action === 'close-dialog') { closeDialog(); }
    });
  }

  function init() { setupEvents(); }
  function cleanup() { _unbindSwipeGesture(); }
  win.CXReadingPlan = { init: init, render: render, renderPlanList: renderPlanList, showCreateDialog: showCreateDialog, cleanup: cleanup };
})(window);
