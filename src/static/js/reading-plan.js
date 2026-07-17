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
    NT_OT_fan: { label: '\u65b0\u65e7\u7ea6\u5e76\u8bfb\uff08\u901a\u8bfb\uff09', desc: '\u65b0\u65e7\u7ea6\u5e76\u884c\uff0c365\u5929\u8bfb\u5b8c', icon: '\uD83D\uDCDA', planIds: ['kO', 'LU'] },
    NT_OT_jing:{ label: '\u65b0\u65e7\u7ea6\u5e76\u8bfb\uff08\u6bb5\u8bfb\uff09', desc: '\u65b0\u65e7\u7ea6\u5e76\u884c\uff0c364\u5929\u8bfb\u5b8c', icon: '\uD83D\uDCDA', planIds: ['2k', 'zy'] },
    NT_fan:    { label: '\u4e00\u5e74\u65b0\u7ea6\uff08\u901a\u8bfb\uff09', desc: '\u6309\u6574\u7ae0\u9605\u8bfb\uff0c365\u5929\u8bfb\u5b8c', icon: '\uD83D\uDCD6', planIds: ['kO'] },
    OT_fan:    { label: '\u4e00\u5e74\u65e7\u7ea6\uff08\u901a\u8bfb\uff09', desc: '\u6309\u6574\u7ae0\u9605\u8bfb\uff0c365\u5929\u8bfb\u5b8c', icon: '\uD83D\uDCDC', planIds: ['LU'] },
    NT_jing:   { label: '\u4e00\u5e74\u65b0\u7ea6\uff08\u6bb5\u8bfb\uff09', desc: '\u6309\u4e3b\u9898\u6bb5\u843d\u9605\u8bfb\uff0c364\u5929\u8bfb\u5b8c', icon: '\uD83D\uDCD6', planIds: ['2k'] },
    OT_jing:   { label: '\u4e00\u5e74\u65e7\u7ea6\uff08\u6bb5\u8bfb\uff09', desc: '\u6309\u4e3b\u9898\u6bb5\u843d\u9605\u8bfb\uff0c364\u5929\u8bfb\u5b8c', icon: '\uD83D\uDCDC', planIds: ['zy'] }
  };

  var _planData = null;
  var _books = null;
  var _currentInstId = null;
  var _currentDay = null;
  var _preRenderedDayHtml = {};
  var _eventsBound = false;   // 防止 setupEvents() 重复绑定
  var _renderGen = 0;           // 渲染代数计数器，防止快速导航 / 退出时旧异步回调覆盖新页面

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
  function loadPlanData() {
    if (_planData) return Promise.resolve(_planData);
    return fetch(getRoot() + 'data/reading-plans.json').then(function (r) { return r.json(); }).then(function (d) { _planData = d; return d; });
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
    var max = 0;
    for (var i = 0; i < inst.planIds.length; i++) { var p = getPlan(inst.planIds[i]); if (p && p.entries && p.entries.length > max) max = p.entries.length; }
    return max;
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
  function getEntriesForDay(inst, dayNum) {
    var entries = [];
    for (var i = 0; i < inst.planIds.length; i++) {
      var plan = getPlan(inst.planIds[i]);
      if (plan && plan.entries) {
        for (var j = 0; j < plan.entries.length; j++) {
          if (plan.entries[j].d === dayNum) { entries.push({ planId: plan.id, planName: plan.name, entry: plan.entries[j] }); break; }
        }
      }
    }
    console.log('[RP] getEntriesForDay day=' + dayNum + ' planIds=' + JSON.stringify(inst.planIds) + ' found=' + entries.length);
    return entries;
  }

  // ══════════════════════════════════════════════════════════
  //  渲染入口
  // ══════════════════════════════════════════════════════════
  function render(instanceId, dayNum) {
    // 确保事件委托已注册（reading-plan.js 以 defer 加载，
    // index.html 内联脚本可能在 CXReadingPlan 就绪前就尝试调用 init()）
    setupEvents();
    var app = document.getElementById('app');
    if (!app) return;

    // 不在此处隐藏 fixedChapterBar —— 异步数据加载期间旧顶栏仍可见，
    // 避免"旧栏消失 → 空白闪一下 → 新日期栏出现"的闪烁。
    // 在 .then() 回调里新内容就绪后再隐藏。

    // 先完成数据加载 + 完整渲染，再一次性替换并展示页面，避免切换时残影
    // （不再提前 _cxShowApp，旧页面会一直保留到新页面完全就绪）
    Promise.all([loadPlanData(), loadBooks()]).then(function () {
      // 若加载期间已离开读经计划页（例如用户已返回圣经页），放弃本次渲染，避免覆盖新页面
      if (!document.body.classList.contains('cx-reading-plan-page')) return;
      // 新内容即将渲染，此时隐藏旧顶栏，新 rp-date-bar 同帧出现，消除闪烁
      var bar = document.getElementById('fixedChapterBar');
      if (bar) bar.style.display = 'none';
      if (instanceId) {
        var inst = getInstance(instanceId);
        if (!inst) { renderPlanList(); win._cxShowApp(); return; }
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
          renderPlanList(); win._cxShowApp();
        }
      }
    }).catch(function (err) {
      console.error('[RP] 加载计划数据失败', err);
      if (!document.body.classList.contains('cx-reading-plan-page')) return;
      var bar = document.getElementById('fixedChapterBar');
      if (bar) bar.style.display = 'none';
      var app2 = document.getElementById('app');
      if (app2) app2.innerHTML = '<div class="rp-container"><div class="bible-reading"><div style="padding:40px;text-align:center;color:var(--danger-text,#c53030)">加载失败，请检查网络后重试</div></div></div>';
    });
  }

  // ══════════════════════════════════════════════════════════
  //  计划选择页
  // ══════════════════════════════════════════════════════════
  function renderPlanList() {
    var app = document.getElementById('app');
    var html = '<div class="rp-container" style="padding-top:0">';
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
    // 渲染代守卫：防止快速导航 / 退出时，旧的异步数据加载回调覆盖新页面内容
    var __gen = ++_renderGen;
    // 若此刻已离开读经计划页（如用户已返回圣经页），直接放弃，不触碰 #app
    if (!document.body.classList.contains('cx-reading-plan-page')) return;
    var app = document.getElementById('app');
    if (!app) return;
    var bar = document.getElementById('fixedChapterBar');
    if (bar) bar.style.display = 'none';

    // 立刻渲染页面框架（日期栏 + 进度条 + 抽屉），经文内容异步填入，
    // 避免日期栏等经文加载完才出现导致切换时顶部空白 ~1s
    app.style.opacity = '';
    app.style.transition = '';

    var dateStr = dateForDay(inst.year, doy);
    var d = new Date(dateStr);
    var total = planTotal(inst);
    var done = completedCount(inst);
    var comp = inst.completed && inst.completed[String(doy)];
    var pct = total > 0 ? Math.round(done / total * 100) : 0;

    // ── 同步渲染页面框架 ──
    var html = '<div class="rp-container">';

    // ── 固定顶栏（日期）── 与经文页 fixedChapterBar 一致
    html += '<div class="rp-date-bar">';
    html += '<button class="rp-back" data-action="go-back" style="position:absolute;left:8px" title="返回">\u2039</button>';
    html += '<span class="rp-date-label">' + (d.getMonth() + 1) + '\u6708' + d.getDate() + '\u65e5</span>';
    html += '<button class="rp-sidebar-btn" data-action="toggle-drawer" title="\u8fdb\u5ea6">';
    html += '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
    html += '</button></div>';

    // ── 进度条 ──
    html += '<div class="rp-progress-mini"><div class="rp-progress-mini-fill" style="width:' + pct + '%"></div></div>';

    // ── 主内容：骨架占位（经文异步填入） ──
    html += '<div class="bible-reading" id="rpBibleReading"><div style="padding:40px;text-align:center;color:var(--text-muted,#999)">加载中…</div></div>';

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
    win._cxShowApp();

    // 保存滚动位置
    var savedScroll = (opts && opts.restoreScroll != null) ? opts.restoreScroll : window.scrollY;

    // 当前渲染是否仍有效：未被更新的渲染取代，且仍停留在读经计划页
    function _stillValid() {
      return __gen === _renderGen && document.body.classList.contains('cx-reading-plan-page');
    }

    // 绑定滑动手势（框架已就绪，可立即绑定）
    _initSwipeConfig();
    if (window.CXSwipeSlider) {
      CXSwipeSlider.unbindSwipeGesture();
      CXSwipeSlider.bindSwipeGesture();
      CXSwipeSlider.setupSlider();
    }

    // 预缓存相邻天的内容（骨架同步存入缓存，经文异步加载后更新已创建的侧页 DOM）
    _precachAdjacentDays();

    // 异步加载经文内容，填入已渲染的 .bible-reading 容器
    _preRenderDayWithVerses(inst, doy).then(function(innerHtml) {
      if (!_stillValid()) return;   // 已有更新渲染或已离开读经计划页 → 丢弃，避免覆盖新页面
      var readingEl = document.getElementById('rpBibleReading');
      if (readingEl) {
        readingEl.innerHTML = innerHtml;
      }

      // 经文填入后 slider 内容高度已变，同步更新避免 overflow:hidden 裁切
      _updateSliderHeight();

      // 恢复滚动位置
      if (savedScroll) {
        requestAnimationFrame(function() { window.scrollTo(0, savedScroll); });
      }

      // 布局稳定后再修正一次高度（兜底）
      requestAnimationFrame(_updateSliderHeight);
    }).catch(function (err) {
      console.error('[RP] 加载当日经文失败', err);
      if (!_stillValid()) return;   // 已离开读经计划页 → 不处理
      var readingEl = document.getElementById('rpBibleReading');
      if (readingEl) {
        readingEl.innerHTML = '<div style="padding:40px;text-align:center"><div style="color:var(--danger-text,#c53030);margin-bottom:16px">加载失败，请检查网络后重试</div><button onclick="window.CXReadingPlan && CXReadingPlan.render(\'' + inst.id + '\',\'' + doy + '\')" style="padding:8px 24px;border:1px solid var(--border,#ddd);border-radius:6px;background:var(--bg,#fff);cursor:pointer;font-size:0.875rem">重试</button></div>';
      }
      _updateSliderHeight();
    });
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
      return Promise.all([loadChapter(e.entry.book), loadOutlines()]).then(function (results) {
        return _renderEntryVersesHtml(e.entry, results[0]);
      });
    });
    return Promise.all(promises).then(function (versesHtml) {
      var html = '';
      for (var i = 0; i < entries.length; i++) {
        html += '<div class="rp-reading-section">';
        html += '<div class="rp-reading-heading">' + esc(entries[i].planName) + ' \u00b7 ' + esc(formatEntry(entries[i].entry)) + '</div>';
        html += '<div class="rp-verses" id="rpVerses' + i + '">' + versesHtml[i] + '</div>';
        html += '</div>';
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
    var pending = entries.length;
    function onVerseDone() {
      pending--;
      requestAnimationFrame(_updateSliderHeight);
      if (pending <= 0 && restoreScroll) {
        requestAnimationFrame(function() { window.scrollTo(0, restoreScroll); });
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

        el.innerHTML = '<div class="rp-verses-loading">\u52a0\u8f7d\u4e2d\u2026</div>';

        Promise.all([loadChapter(entry.book), loadOutlines()]).then(function (results) {
          var html = _renderEntryVersesHtml(entry, results[0]);
          el.innerHTML = html;
          console.log('[RP] entry[' + idx + '] rendered');
          onVerseDone();
        }).catch(function (err) {
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
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i], entry = e.entry;
        html += '<div class="rp-reading-section">';
        html += '<div class="rp-reading-heading">' + esc(e.planName) + ' \u00b7 ' + esc(formatEntry(entry)) + '</div>';
        html += '<div class="rp-verses" id="rpVerses' + i + '"></div>';
        html += '</div>';
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
        // 更新侧页 DOM（如果已存在）
        var container = document.getElementById('app');
        if (!container) return;
        // 已离开读经计划页（例如返回圣经页）则不再更新侧页 DOM，避免写入失效 / 其他页面
        if (!document.body.classList.contains('cx-reading-plan-page')) return;
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
    var container = document.getElementById('app');
    if (!container) return;
    var wrapper = container.querySelector('.swipe-slider');
    var centerEl = wrapper && wrapper.querySelector('.center-page');
    if (!wrapper || !centerEl) return;
    var h = centerEl.offsetHeight;
    if (h > 0) wrapper.style.height = h + 'px';
  }

  // ── 滑动触发的导航（共享模块 touchEnd 调用）──
  function _animateSwipe(direction) {
    var targetDay = _resolveDay(direction);
    if (!targetDay) return false;

    var container = document.getElementById('app');
    var wrapper = container ? container.querySelector('.swipe-slider') : null;
    if (!wrapper || !wrapper.querySelector('.center-page')) return false;

    return true;
  }

  // ── 滑动动画完成后的就地更新（共享模块 onSwipeComplete 回调）──
  function _animateSwipeCleanup(direction, centerEl, leftEl, rightEl, wrapper) {
    // 若滑动动画期间已离开读经计划页，放弃就地更新，避免写入已失效的 DOM
    if (!document.body.classList.contains('cx-reading-plan-page')) return;
    var targetDay = _resolveDay(direction);
    if (!targetDay) return;

    _currentDay = targetDay;

    var inst = getInstance(_currentInstId);
    if (!inst) return;

    var newContentHtml = _preRenderedDayHtml[targetDay] || _buildDayInnerHtml(inst, targetDay);
    var dateStr = dateForDay(inst.year, targetDay);
    var d = new Date(dateStr);
    var total = planTotal(inst);
    var done = completedCount(inst);
    var pct = total > 0 ? Math.round(done / total * 100) : 0;

    var container = document.getElementById('app');

    // ── 就地更新固定元素（不销毁 DOM）──
    var dateLabel = container.querySelector('.rp-date-label');
    if (dateLabel) dateLabel.textContent = (d.getMonth() + 1) + '\u6708' + d.getDate() + '\u65e5';

    var progressFill = container.querySelector('.rp-progress-mini-fill');
    if (progressFill) progressFill.style.width = pct + '%';

    var drawerTab = container.querySelector('.rp-drawer-tab[data-tab="progress"]');
    if (drawerTab) drawerTab.textContent = '\u8fdb\u5ea6(' + done + '/' + total + ')';

    var drawerBody = document.getElementById('rpDrawerBody');
    if (drawerBody) drawerBody.innerHTML = _buildCalendarContent(inst);

    // ── 就地更新三页 slider 内容（不销毁/重建 slider）──
    // centerEl 始终为中页位置，赋目标天内容
    var centerBR = centerEl.querySelector('.bible-reading');
    if (centerBR) centerBR.innerHTML = newContentHtml;

    // leftEl = 上一天
    var prevDay = _resolveDay(-1);
    var prevHtml = prevDay ? (_preRenderedDayHtml[prevDay] || _buildDayInnerHtml(inst, prevDay)) : '';
    var leftBR = leftEl.querySelector('.bible-reading');
    if (leftBR) leftBR.innerHTML = prevHtml;

    // rightEl = 下一天
    var nextDay = _resolveDay(1);
    var nextHtml = nextDay ? (_preRenderedDayHtml[nextDay] || _buildDayInnerHtml(inst, nextDay)) : '';
    var rightBR = rightEl.querySelector('.bible-reading');
    if (rightBR) rightBR.innerHTML = nextHtml;

    [centerEl, leftEl, rightEl].forEach(function(el) {
      if (!el) return;
      el.style.transition = '';
      el.style.transform = '';
      el.style.willChange = '';
    });

    wrapper.style.height = centerEl.offsetHeight + 'px';

    window.scrollTo(0, 0);

    var hasFullVerses = newContentHtml.indexOf('class="bible-verse"') !== -1;
    if (hasFullVerses) {
      requestAnimationFrame(_updateSliderHeight);
    } else {
      var entries = getEntriesForDay(inst, targetDay);
      _loadAllVerses(entries);
    }

    _precachAdjacentDays();

    var newHash = '#/reading-plan/' + _currentInstId + '/' + targetDay;
    if (window.location.hash !== newHash) {
      try {
        history.replaceState(null, '', newHash);
      } catch(e) {
        window.location.hash = newHash;
      }
    }
  }

  // ── 初始化共享滑动模块配置（每次渲染读经计划时调用，确保配置不被圣经页覆盖）──
  function _initSwipeConfig() {
    if (!window.CXSwipeSlider) return;
    CXSwipeSlider.init({
      containerId: 'app',
      contentSelector: '.rp-container > .bible-reading',
      ignoreSelectors: 'button, a, input, .rp-drawer, .rp-drawer-overlay',
      isPage: function() {
        return !document.body.classList.contains('cx-bible-page');
      },
      resolveDelta: function(delta) {
        return _resolveDay(delta);
      },
      getPreRenderedHtml: function(targetDay) {
        var inst = _currentInstId ? getInstance(_currentInstId) : null;
        if (!inst) return '';
        return _preRenderedDayHtml[targetDay] || _buildDayInnerHtml(inst, targetDay);
      },
      buildSidePage: function(pageEl, html) {
        pageEl.innerHTML = '<div class="bible-reading">' + html + '</div>';
      },
      getDamping: function(dx) {
        var inst = _currentInstId ? getInstance(_currentInstId) : null;
        var total = inst ? planTotal(inst) : 365;
        var atStart = (_currentDay <= 1 && dx > 0);
        var atEnd = (_currentDay >= total && dx < 0);
        if (atStart || atEnd) return 0;
        return dx;
      },
      onSliderCreated: function(wrapper) {
        var container = document.getElementById('app');
        if (!container) return;
        var rpContainer = container.querySelector('.rp-container');
        if (rpContainer) {
          rpContainer.style.minHeight = 'auto';
          rpContainer.style.padding = '0';
        }
        requestAnimationFrame(_updateSliderHeight);
      },
      onSwipeComplete: function(direction, centerEl, leftEl, rightEl, wrapper) {
        _animateSwipeCleanup(direction, centerEl, leftEl, rightEl, wrapper);
      }
    });
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
    if (_eventsBound) return;   // 已绑定则跳过，防止重复注册
    var app = document.getElementById('app');
    if (!app) return;
    _eventsBound = true;
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
          break;
        case 'switch-plan':
          _currentInstId = t.dataset.id; _currentDay = dayOfYear(todayStr());
          closeDrawer();
          var inst = getInstance(_currentInstId);
          if (inst) renderDayContent(inst, _currentDay);
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
      } else if (t.dataset.action === 'close-dialog') { closeDialog(); }
    });
  }

  function init() { setupEvents(); }
  function clearCache() { _chapterCache = {}; }
  win.CXReadingPlan = { init: init, render: render, renderPlanList: renderPlanList, showCreateDialog: showCreateDialog, clearCache: clearCache };
})(window);
