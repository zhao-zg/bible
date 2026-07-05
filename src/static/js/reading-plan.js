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
  var _isAnimating = false;
  var _swipeBound = false;
  var _preRenderedDayHtml = {};

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
  function loadChapter(bookIndex) {
    return fetch(getRoot() + 'data/bible/' + pad2(bookIndex) + '.json').then(function (r) { return r.json(); });
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
    var app = document.getElementById('app');
    if (!app) return;
    win._cxShowApp();
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
        html += '<div class="rp-verses" id="rpVerses' + i + '"></div>';
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

    // 绑定滑动手势
    _swipeBound = false;
    _bindSwipeGesture();

    // 预缓存相邻天的内容
    _precachAdjacentDays();

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
        var acro = bookAcronym(entry.book);

        el.innerHTML = '<div class="rp-verses-loading">\u52a0\u8f7d\u4e2d\u2026</div>';

        Promise.all([loadChapter(entry.book), loadOutlines()]).then(function (results) {
          var data = results[0];
          if (!data || !data.chapters) {
            el.innerHTML = '<div class="rp-verses-empty">\u65e0\u7ecf\u6587\u6570\u636e</div>';
            onVerseDone(); return;
          }

          var html = '';
          var chFrom = entry.chapter;
          var chTo = entry.chapter_to || entry.chapter;
          var hasVerses = false;

          for (var chNum = chFrom; chNum <= chTo; chNum++) {
            // 找到对应章节
            var ch = null;
            for (var c = 0; c < data.chapters.length; c++) {
              if (data.chapters[c].chapter === chNum) { ch = data.chapters[c]; break; }
            }
            if (!ch || !ch.verses) continue;

            // 确定该章节的 section 范围
            var secStart = (chNum === chFrom) ? entry.section : 1;
            var secEnd = (chNum === chTo) ? entry.section_to : 9999;

            // 多章节时显示章节标题分隔
            if (chNum > chFrom) {
              html += '<div class="rp-chapter-divider">' + esc(bookName(entry.book)) + ' ' + chNum + '</div>';
            }

            // 大纲
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

            // 经文
            for (var v = 0; v < ch.verses.length; v++) {
              var vs = ch.verses[v];
              if (vs.section < secStart || vs.section > secEnd) continue;
              hasVerses = true;

              // 在该节之前插入大纲
              if (outlines.length > 0) {
                for (var oi2 = 0; oi2 < outlines.length; oi2++) {
                  if (outlines[oi2].section === vs.section && outlines[oi2].section > secStart) {
                    var group = [];
                    while (oi2 < outlines.length && outlines[oi2].section === vs.section) {
                      group.push(outlines[oi2]);
                      oi2++;
                    }
                    html += '<div class="bible-outline-inline-group">';
                    for (var gi = 0; gi < group.length; gi++) {
                      var lvl2 = Math.min(Math.max((group[gi].level || 1) - 1, 0), 5);
                      html += '<div class="bible-outline-inline outline-level-' + lvl2 + '">' + esc(stripMarkers(group[gi].text)) + '</div>';
                    }
                    html += '</div>';
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

          if (!hasVerses) {
            el.innerHTML = '<div class="rp-verses-empty">\u65e0\u5339\u914d\u7ecf\u6587</div>';
            onVerseDone(); return;
          }

          el.innerHTML = html;
          console.log('[RP] entry[' + idx + '] rendered ch' + chFrom + '-' + chTo);
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
    if (prev) _preRenderedDayHtml[prev] = _buildDayInnerHtml(inst, prev);
    if (next) _preRenderedDayHtml[next] = _buildDayInnerHtml(inst, next);
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
    wrapper.style.cssText = 'position:relative;width:' + W + 'px;overflow:hidden;';

    var centerPage = document.createElement('div');
    centerPage.className = 'swipe-page center-page';
    centerPage.style.cssText = 'width:' + W + 'px;';
    centerPage.appendChild(contentEl);
    wrapper.appendChild(centerPage);
    container.appendChild(wrapper);

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

      // 重建页面内容
      var newContentHtml = _preRenderedDayHtml[targetDay] || _buildDayInnerHtml(inst, targetDay);
      var dateStr = dateForDay(inst.year, targetDay);
      var d = new Date(dateStr);
      var total = planTotal(inst);
      var done = completedCount(inst);
      var pct = total > 0 ? Math.round(done / total * 100) : 0;

      var html = '<div class="rp-container">';
      html += '<div class="rp-date-bar">';
      html += '<span class="rp-date-label">' + (d.getMonth() + 1) + '\u6708' + d.getDate() + '\u65e5</span>';
      html += '<button class="rp-sidebar-btn" data-action="toggle-drawer" title="\u8fdb\u5ea6">';
      html += '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
      html += '</button></div>';
      html += '<div class="rp-progress-mini"><div class="rp-progress-mini-fill" style="width:' + pct + '%"></div></div>';
      html += '<div class="bible-reading">' + newContentHtml + '</div>';
      html += '<div class="rp-drawer-overlay" data-action="close-drawer"></div>';
      html += '<div class="rp-drawer" id="rpDrawer">';
      html += '<div class="rp-drawer-header"><div class="rp-drawer-tabs">';
      html += '<div class="rp-drawer-tab active" data-action="drawer-tab" data-tab="progress">\u8fdb\u5ea6(' + done + '/' + total + ')</div>';
      html += '<div class="rp-drawer-tab" data-action="drawer-tab" data-tab="records">\u8bb0\u5f55</div>';
      html += '</div><button class="rp-drawer-close" data-action="close-drawer">\u2715</button></div>';
      html += '<div class="rp-drawer-body" id="rpDrawerBody">' + _buildCalendarContent(inst) + '</div>';
      html += '</div>';
      html += '</div>';

      container.innerHTML = html;

      // 重新绑定手势
      _swipeBound = false;
      _bindSwipeGesture();

      window.scrollTo(0, 0);

      // 加载经文（侧页只有静态HTML，当前页需要异步加载经文）
      var entries = getEntriesForDay(inst, targetDay);
      _loadAllVerses(entries);

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

  function _bindSwipeGesture() {
    if (_swipeBound) return;
    _swipeBound = true;

    var container = document.getElementById('app');
    if (!container) return;

    var startX = 0, startY = 0, startTime = 0;
    var isDragging = false, isHorizontal = null;
    var centerEl = null, leftEl = null, rightEl = null;
    var wrapperW = 0;
    var _rafId = 0, _pendingDx = 0;

    container.addEventListener('touchstart', function(e) {
      if (_isAnimating) return;
      var target = e.target;
      if (target.closest && target.closest('button, a, input, .rp-drawer, .rp-drawer-overlay')) return;
      var sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;

      _setupSlider();

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
    }, {passive: true});

    container.addEventListener('touchmove', function(e) {
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
    }, {passive: true});

    container.addEventListener('touchend', function(e) {
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
    });

    function _resetDrag() {
      isHorizontal = null;
      centerEl = null; leftEl = null; rightEl = null;
    }
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
  win.CXReadingPlan = { init: init, render: render, renderPlanList: renderPlanList, showCreateDialog: showCreateDialog };
})(window);
