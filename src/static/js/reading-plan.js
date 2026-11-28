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

  // 四档周期计划，与正版 APK 的 plan_index 完全一致：
// 一年一次 364 天 / 两年一次 728 天 / 四个月一次 121 天 / 半年一次 182 天。
// 每档每天两条记录：旧约一段 + 新约一段（entry.t = 1 旧约 / 2 新约）。
var PLAN_TYPES = {
  one:  { label: '一年一次', desc: '全年读完整本圣经', icon: '\uD83D\uDCDA', planIds: ['one'], total: 364 },
  two:  { label: '两年一次', desc: '两年读完整本圣经', icon: '\uD83D\uDCDA', planIds: ['two'], total: 728 },
  four: { label: '四个月一次', desc: '四个月读完整本圣经', icon: '\uD83D\uDCC6', planIds: ['four'], total: 121 },
  six:  { label: '半年一次', desc: '半年读完整本圣经', icon: '\uD83D\uDCD6', planIds: ['six'], total: 182 }
};

// 旧版 planId 重命名映射（旧→新）：旧版进度存的是 kO/LU/2k/zy，读取时迁移为新命名。
// 更早的 6 种组合类型（NT_OT/NT/OT/…）在 loadInstances 中整体迁移为「一年一次」。
var PLAN_ID_RENAMES = { 'kO': 'one', 'LU': 'one', '2k': 'one', 'zy': 'one' };

  var _planData = null;
  var _planDataRequest = 0;
  var _books = null;
  var _currentInstId = null;
  var _currentDay = null;
  var _isAnimating = false;
  var _swipeBound = false;
  var _preRenderedDayHtml = {};
  var _preRenderInstId = null;   // 预渲染归属计划，切换计划时清空避免复用旧计划内容
  var _renderGen = 0;           // 渲染代数计数器，防止快速导航/退出时旧异步回调覆盖新页面
  var _renderPending = false;
  var _renderFailed = false;
  var _drawerBackFn = null;
  var _dialogBackFn = null;

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

  // ── 与正文页共用主语言及版本加载入口 ──
  function getPrimaryLang() {
    return (win.CXBible && win.CXBible.getPrimaryLang) ? win.CXBible.getPrimaryLang() : 'zh-rcv';
  }
  function _isHantPrimary() { return getPrimaryLang() === 'zh-hant-rcv'; }
  function _supportsChinesePlanMetadata() {
    var lang = getPrimaryLang();
    return lang === 'zh-rcv' || lang === 'zh-hant-rcv';
  }
  function _primaryDataFile(base) {
    return 'data/' + (_isHantPrimary() ? base.replace('.json', '-hant.json') : base);
  }

  // 界面/计划文案的繁体映射（长词条在前：split/join 全表按序执行，短词先命中会破坏长词）
  var _PLAN_HANT = [
    ['四个月读完整本圣经', '四個月讀完整本聖經'],
    ['两年读完整本圣经', '兩年讀完整本聖經'],
    ['全年读完整本圣经', '全年讀完整本聖經'],
    ['半年读完整本圣经', '半年讀完整本聖經'],
    ['四个月一次', '四個月一次'],
    ['两年一次', '兩年一次'],
    ['选择下方类型开始你的读经之旅', '選擇下方類型開始你的讀經之旅'],
    ['当天无读经安排', '當天無讀經安排'],
    ['新增读经记录', '新增讀經記錄'],
    ['还没有读经计划', '還沒有讀經計劃'],
    ['新旧约并行，一年读完', '新舊約並行，一年讀完'],
    ['按主题段落阅读，一年读完', '按主題段落閱讀，一年讀完'],
    ['按整章阅读，一年读完', '按整章閱讀，一年讀完'],
    ['新旧约并读（通读）', '新舊約並讀（通讀）'],
    ['一年新约（通读）', '一年新約（通讀）'],
    ['一年旧约（通读）', '一年舊約（通讀）'],
    ['新旧约并读（段读）', '新舊約並讀（段讀）'],
    ['一年新约（段读）', '一年新約（段讀）'],
    ['一年旧约（段读）', '一年舊約（段讀）'],
    ['清晨 4–8点', '清晨 4–8點'],
    ['日间 8–18点', '日間 8–18點'],
    ['其他时段', '其他時段'],
    ['无主题数据', '無主題資料'],
    ['加载中…', '載入中…'],
    ['加载失败', '載入失敗'],
    ['无经文数据', '無經文資料'],
    ['无匹配经文', '無匹配經文'],
    ['新旧约并读', '新舊約並讀'],
    ['读经计划', '讀經計劃'],
    ['一年新约', '一年新約'],
    ['一年旧约', '一年舊約'],
    ['新约·段读', '新約·段讀'],
    ['旧约·段读', '舊約·段讀'],
    ['全卷主题', '全卷主題'],
    ['新增记录', '新增記錄'],
    ['遍读经', '遍讀經'],
    ['日间', '日間'],
    ['已读', '已讀'],
    ['进度', '進度'],
    ['记录', '記錄'],
    ['当前', '當前'],
    ['开始: ', '開始: '],
    ['主题', '主題'],
    ['新约', '新約'],
    ['旧约', '舊約']
  ];
  // 按主语言转换文本（简体文案/计划名 → 繁体；仅用于渲染输出，不动数据）
  function _planText(s) {
    var out = String(s == null ? '' : s);
    if (!_isHantPrimary()) return out;
    for (var i = 0; i < _PLAN_HANT.length; i++) out = out.split(_PLAN_HANT[i][0]).join(_PLAN_HANT[i][1]);
    return out;
  }

  // ── 与正文页共用的内容显示开关（设置面板写入 bible_toggles） ──
  // 读经计划内的书介/主题/纲目/节间分隔线均遵循同一份开关，避免两页显示不一致
  var TOGGLE_KEYS = ['showIntro', 'showTheme', 'showOutline', 'showVerseDivider'];
  var _uiToggleCache = null;
  function _uiToggles() {
    if (_uiToggleCache) return _uiToggleCache;
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem('bible_toggles') || '{}') || {}; } catch (e) { saved = {}; }
    var t = {};
    for (var i = 0; i < TOGGLE_KEYS.length; i++) {
      var k = TOGGLE_KEYS[i];
      t[k] = (k in saved) ? !!saved[k] : true;
    }
    _uiToggleCache = t;
    return t;
  }
  function _refreshUIToggles() { _uiToggleCache = null; }

  // ── 与正文页一致的页头区块包裹（浅色底 + 主题上方分隔线） ──
  function _wrapHeaderSection(inner) {
    return inner ? '<div class="bible-header-section">' + inner + '</div>' : '';
  }

  // ── 书介/主题 HTML（与正文页 _renderMetadata + _renderThemeText 同结构） ──
  function _renderBookHeaderHtml(bookIndex, introData, topicsData, ctxStr) {
    if (!_supportsChinesePlanMetadata()) return '';
    var t = _uiToggles();
    var inner = '';
    if (t.showIntro && introData) inner += _renderBookIntro(bookIndex, introData, ctxStr);
    if (t.showTheme) inner += _renderThemeTextForPlan(bookIndex, topicsData, ctxStr);
    return _wrapHeaderSection(inner);
  }

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

  // ── 计划日期换算（以 startDate 为第 1 天，支持两年计划跨年） ──
  function _instStartDate(inst) {
    var s = (inst && inst.startDate) || '';
    var p = String(s).split('-');
    if (p.length === 3 && p[0] && p[1] && p[2]) return new Date(+p[0], +p[1] - 1, +p[2]);
    return new Date((inst && inst.year) || new Date().getFullYear(), 0, 1);
  }
  function _dayDate(inst, dayNum) {
    var s = _instStartDate(inst);
    return new Date(s.getFullYear(), s.getMonth(), s.getDate() + (dayNum - 1));
  }
  function _dayDateStr(inst, dayNum) {
    var d = _dayDate(inst, dayNum);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function _rawDayIndex(inst, dateStr) {
    var p = String(dateStr || '').split('-');
    if (p.length !== 3) return 1;
    var target = new Date(+p[0], +p[1] - 1, +p[2]);
    var s = _instStartDate(inst);
    return Math.floor((target - s) / 864e5) + 1;
  }
  function _dayIndex(inst, dateStr) {
    return clampDay(inst, _rawDayIndex(inst, dateStr));
  }

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
    if (c === 'green') return _planText('\u6e05\u6668 4\u20138\u70b9');
    if (c === 'yellow') return _planText('\u65e5\u95f4 8\u201318\u70b9');
    if (c === 'red') return _planText('\u5176\u4ed6\u65f6\u6bb5');
    return '';
  }

  // ══════════════════════════════════════════════════════════
  //  数据加载
  // ══════════════════════════════════════════════════════════
  function loadPlanData(forceRefresh) {
    if (!forceRefresh && _planData) return Promise.resolve(_planData);
    var request = ++_planDataRequest, gen = _renderGen;
    var url = getRoot() + 'data/reading-plans.json';
    var opts = {};
    if (forceRefresh) {
      // 破缓存：cache:'no-cache' 让 SW 直接放行（SW 对此选项不拦截），
      // 浏览器也不会使用 HTTP 缓存
      opts = { cache: 'no-cache' };
    }
    return fetch(url, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + url);
      return r.json();
    }).then(function (d) {
      if (request === _planDataRequest && gen === _renderGen && document.body.classList.contains('cx-reading-plan-page')) _planData = d;
      return d;
    });
  }
  function loadBooks() {
    if (_books) return Promise.resolve(_books);
    return fetch(getRoot() + 'data/bible-books.json').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ': bible-books.json');
      return r.json();
    }).then(function (d) { _books = d; return d; });
  }
  // 书名国际化（繁体主语言时书名/缩写取对应语言）
  var _booksI18n = null;
  function loadBooksI18n() {
    if (_booksI18n) return Promise.resolve(_booksI18n);
    return fetch(getRoot() + 'data/book-names-i18n.json').then(function (r) { return r.json(); }).then(function (d) { _booksI18n = d; return d; }).catch(function () { _booksI18n = {}; return {}; });
  }
  function _primaryBookNames() {
    var lang = getPrimaryLang();
    if (lang !== 'zh-rcv' && _booksI18n) {
      return _booksI18n[lang] || (lang.indexOf('en-') === 0 ? _booksI18n.en : null);
    }
    return null;
  }
  function _missingPlanId(inst) {
    if (!Array.isArray(inst.planIds) || !inst.planIds.length) {
      throw new Error('Reading plan has no plan IDs: ' + inst.id);
    }
    for (var i = 0; i < inst.planIds.length; i++) {
      var plan = getPlan(inst.planIds[i]);
      if (!plan || !Array.isArray(plan.entries) || !plan.entries.length) return inst.planIds[i];
    }
    return null;
  }
  function bookName(idx) {
    var names = _primaryBookNames();
    if (names) { var e = names[String(idx)] || names[idx]; if (e && e.full) return e.full; }
    if (!_books) return String(idx);
    for (var i = 0; i < _books.length; i++) if (_books[i].index === idx) return _books[i].name;
    return String(idx);
  }
  function getPlan(id) {
    if (!_planData || !_planData.plans) return null;
    for (var i = 0; i < _planData.plans.length; i++) if (_planData.plans[i].id === id) return _planData.plans[i];
    // 兼容旧版 reading-plans.json（planId 重命名前）：新 id 找不到时按映射查旧 id
    for (var oldId in PLAN_ID_RENAMES) {
      if (PLAN_ID_RENAMES[oldId] === id) {
        for (var j = 0; j < _planData.plans.length; j++) if (_planData.plans[j].id === oldId) return _planData.plans[j];
      }
    }
    return null;
  }
  var _chapterCache = {};
  function loadChapter(bookIndex) {
    var lang = getPrimaryLang();
    var cacheKey = lang + ':' + bookIndex;
    if (_chapterCache[cacheKey]) return Promise.resolve(_chapterCache[cacheKey]);
    var basePath = (lang === 'zh-rcv') ? 'data/bible/' : 'data/bible/' + lang + '/';
    var promise = lang !== 'zh-rcv' && win.CXBible && win.CXBible.loadVersionBookData
      ? win.CXBible.loadVersionBookData(lang, bookIndex)
      : fetch(getRoot() + basePath + pad2(bookIndex) + '.json').then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        });
    return promise.then(function (d) { _chapterCache[cacheKey] = d; return d; });
  }
  var _topicsData = null;
  function loadTopics() {
    if (_topicsData) return Promise.resolve(_topicsData);
    var file = _primaryDataFile('bible-topics.json');
    return fetch(getRoot() + file).then(function (r) { return r.json(); }).then(function (d) {
      if (file === _primaryDataFile('bible-topics.json')) _topicsData = d;
      return d;
    }).catch(function () { return {}; });
  }
  function getTopic(bookIndex) {
    if (!_topicsData) return '';
    return _topicsData[String(bookIndex)] || '';
  }

  // ══════════════════════════════════════════════════════════
  //  存储
  // ══════════════════════════════════════════════════════════
  function loadInstances() {
    var list;
    try { list = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch (e) { return []; }
    var migrated = false;
    for (var i = 0; i < list.length; i++) {
      var inst = list[i];
      // 旧的 6 种组合类型（NT_OT/NT/OT/…）已改为 4 档周期，统一迁移为「一年一次」
      if (inst && (!inst.type || !PLAN_TYPES[inst.type])) {
        inst.type = 'one';
        inst.planIds = PLAN_TYPES['one'].planIds.slice();
        migrated = true;
        continue;
      }
      if (inst && inst.planIds && inst.planIds.length) {
        for (var j = 0; j < inst.planIds.length; j++) {
          if (PLAN_ID_RENAMES[inst.planIds[j]]) { inst.planIds[j] = PLAN_ID_RENAMES[inst.planIds[j]]; migrated = true; }
        }
      }
    }
    if (migrated) saveInstances(list);
    return list;
  }
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
    // 计划实际天数（一年 364 / 两年 728 / 四个月 121 / 半年 182），
    // 与 APK 的 plan_* 表天数一致；数据未加载时回退当年天数，避免日历空白
    var maxD = 0;
    var planIds = (inst && inst.planIds) ? inst.planIds : [];
    for (var i = 0; i < planIds.length; i++) {
      var p = getPlan(planIds[i]);
      if (!p || !p.entries) continue;
      for (var j = 0; j < p.entries.length; j++) {
        var d = p.entries[j].d || 0;
        if (d > maxD) maxD = d;
      }
    }
    return maxD || daysInYear((inst && inst.year) || new Date().getFullYear());
  }

  // 天序号钳制到 [1, 计划总天数]（四个月/半年计划在年中就已读完）
  function clampDay(inst, day) {
    var total = planTotal(inst);
    var d = parseInt(day, 10);
    if (!d || d < 1) d = 1;
    if (total > 0 && d > total) d = total;
    return d;
  }
  function _todayDay(inst) {
    var day = _rawDayIndex(inst, todayStr());
    return !_planData || _missingPlanId(inst) ? Math.max(1, day) : clampDay(inst, day);
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
      return _planText('\u5168\u5377\u4e3b\u9898');
    }
    if (entry.topic) {
      var name = bookName(entry.book);
      return _planText(name) + ' \u00b7 ' + _planText('\u4e3b\u9898');
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
  // 读经段落标题：一档计划每天两条（旧约/新约），用约别替代重复的计划名
  function _entryHeadingName(item) {
    var it = item || {};
    if (it.entry && it.entry.t === 1) return _planText('\u65e7\u7ea6');
    if (it.entry && it.entry.t === 2) return _planText('\u65b0\u7ea6');
    return _planText(it.planName || '');
  }

  function getEntriesForDay(inst, dayNum) {
    var entries = [];

    // 计划最后一天（四个月/半年/两年计划的天数各不相同）
    var totalDays = planTotal(inst);
    var isYearEnd = (dayNum === totalDays);

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
            // 一档计划每天两条（旧约 + 新约），全部收集
            entries.push({ planId: plan.id, planName: plan.name, entry: entry });
          }
        }
      }
    }

    // 年末最后一天且 entries 中无数据：回退到全卷主题
    if (isYearEnd && entries.length === 0 && _supportsChinesePlanMetadata()) {
      return [{ planId: '_all', planName: _planText('\u5168\u5377\u4e3b\u9898'), entry: { d: dayNum, _allTopics: true } }];
    }

    console.log('[RP] getEntriesForDay day=' + dayNum + ' planIds=' + JSON.stringify(inst.planIds) + ' found=' + entries.length);
    return entries;
  }

  // ══════════════════════════════════════════════════════════
  //  渲染入口
  // ══════════════════════════════════════════════════════════
  function _dateBarHtml(d, loading) {
    var html = '<div class="rp-date-bar">';
    html += '<button class="chapter-nav-btn rp-back-btn" data-action="go-back" title="返回">\u2039</button>';
    html += '<span class="rp-date-label">' + (d.getMonth() + 1) + '\u6708' + d.getDate() + '\u65e5</span>';
    html += '<button class="rp-sidebar-btn" data-action="toggle-drawer" title="' + _planText('\u8fdb\u5ea6') + '"' + (loading ? ' disabled' : '') + '>';
    html += '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
    return html + '</button></div>';
  }

  function render(instanceId, dayNum) {
    var app = document.getElementById('app');
    if (!app) return;
    closeDrawer();
    var gen = ++_renderGen;
    _renderPending = true;
    _renderFailed = false;
    var bar = document.getElementById('fixedChapterBar');
    if (bar) bar.style.display = 'none';

    var earlyInst = instanceId ? getInstance(instanceId) : loadInstances()[0];
    var type = earlyInst && PLAN_TYPES[earlyInst.type];
    var earlyDay, earlyRendered = false;
    if (earlyInst && type && earlyInst.planIds && earlyInst.planIds.length === 1 && earlyInst.planIds[0] === type.planIds[0]) {
      earlyDay = dayNum ? parseInt(dayNum, 10) : _rawDayIndex(earlyInst, todayStr());
      earlyDay = Math.max(1, Math.min(type.total, earlyDay || 1));
      app.innerHTML = '<div class="rp-container rp-day-view rp-initial-loading">' + _dateBarHtml(_dayDate(earlyInst, earlyDay), true) +
        '<div class="bible-reading"><div class="rp-verses-loading">' + _planText('\u52a0\u8f7d\u4e2d\u2026') + '</div></div></div>';
      app.style.display = '';
      app.style.transition = '';
      app.style.opacity = '1';
      earlyRendered = true;
      if (win._dismissSplash) win._dismissSplash();
    }

    Promise.all([loadPlanData(), loadBooks(), loadBooksI18n()]).then(function () {
      if (gen !== _renderGen || !document.body.classList.contains('cx-reading-plan-page')) return;
      var inst = instanceId ? getInstance(instanceId) : loadInstances()[0];
      if (inst && _missingPlanId(inst)) {
        return loadPlanData(true).then(function () {
          var missing = _missingPlanId(inst);
          if (missing) throw new Error('Reading plan data missing: ' + missing);
        });
      }
    }).then(function () {
      if (gen !== _renderGen || !document.body.classList.contains('cx-reading-plan-page')) return;
      _renderPending = false;
      if (instanceId) {
        var inst = getInstance(instanceId);
        if (!inst) { renderPlanList(); return; }
        _currentInstId = inst.id;
        _currentDay = clampDay(inst, dayNum ? parseInt(dayNum, 10) : _dayIndex(inst, todayStr()));
        // 超范围的 URL 天序号（如四个月计划的 /329）修正为实际天，避免地址与内容不一致
        var _wantDay = dayNum ? parseInt(dayNum, 10) : 0;
        if (_wantDay && _wantDay !== _currentDay) {
          try { history.replaceState(null, '', '#/reading-plan/' + inst.id + '/' + _currentDay); } catch (e) {}
        }
        renderDayContent(inst, _currentDay, { keepVisible: earlyRendered });
      } else {
        var instances = loadInstances();
        if (instances.length > 0) {
          _currentInstId = instances[0].id;
          _currentDay = clampDay(instances[0], _dayIndex(instances[0], todayStr()));
          renderDayContent(instances[0], _currentDay, { keepVisible: earlyRendered });
        } else {
          _currentInstId = null; _currentDay = null;
          renderPlanList();
        }
      }
    }, function (err) {
      if (gen !== _renderGen || !document.body.classList.contains('cx-reading-plan-page')) return;
      _renderPending = false;
      _renderFailed = true;
      console.error('[RP] Failed to load reading plan:', err);
      var loading = earlyRendered ? app.querySelector('.rp-verses-loading') : null;
      if (loading) {
        loading.classList.add('rp-load-error');
        loading.textContent = _planText('\u52a0\u8f7d\u5931\u8d25');
      }
      else {
        app.innerHTML = '<div class="rp-container"><div class="rp-header"><button class="rp-back" data-action="go-back">\u2039</button><h2 class="rp-title">' + _planText('\u8bfb\u7ecf\u8ba1\u5212') + '</h2></div><div class="rp-empty rp-load-error">' + _planText('\u52a0\u8f7d\u5931\u8d25') + '</div></div>';
        app.style.display = '';
        app.style.opacity = '1';
      }
    });
  }

  // ══════════════════════════════════════════════════════════
  //  计划选择页
  // ══════════════════════════════════════════════════════════
  function renderPlanList() {
    var app = document.getElementById('app');
    var html = '<div class="rp-container">';
    html += '<div class="rp-header"><button class="rp-back" data-action="go-back">\u2039</button><h2 class="rp-title">' + _planText('\u8bfb\u7ecf\u8ba1\u5212') + '</h2></div>';
    html += '<div class="rp-empty"><div class="rp-empty-icon">\uD83D\uDCD6</div><p>' + _planText('\u8fd8\u6ca1\u6709\u8bfb\u7ecf\u8ba1\u5212') + '</p><p class="rp-empty-hint">' + _planText('\u9009\u62e9\u4e0b\u65b9\u7c7b\u578b\u5f00\u59cb\u4f60\u7684\u8bfb\u7ecf\u4e4b\u65c5') + '</p></div>';
    html += _buildTypeCards();
    html += '</div>';
    app.innerHTML = html;
    // 直达 #/reading-plan 时启动流程可能尚未显示 #app，这里兜底显示
    app.style.display = '';
    app.style.opacity = '1';
    if (window._cxShowApp) { try { window._cxShowApp(true); } catch (e) {} }
  }

  function _buildTypeCards() {
    var html = '<div class="rp-type-list">';
    var types = Object.keys(PLAN_TYPES);
    for (var i = 0; i < types.length; i++) {
      var key = types[i], pt = PLAN_TYPES[key];
      html += '<div class="rp-type-card" data-action="quick-create" data-type="' + key + '">';
      html += '<div class="rp-type-icon">' + pt.icon + '</div><div class="rp-type-info"><div class="rp-type-label">' + esc(_planText(pt.label)) + '</div><div class="rp-type-desc">' + esc(_planText(pt.desc)) + '</div></div>';
      html += '<div class="rp-type-arrow">\u203a</div></div>';
    }
    return html + '</div>';
  }

  // ══════════════════════════════════════════════════════════
  //  主视图：经文内容 + 侧边抽屉
  // ══════════════════════════════════════════════════════════
  function renderDayContent(inst, doy, opts) {
    closeDrawer();
    if (!_planData || _missingPlanId(inst)) {
      render(inst.id, doy);
      return;
    }
    _renderGen++;  // 递增渲染代数，使旧的异步回调失效
    _isAnimating = false;
    // 切换计划时清空相邻天预渲染，避免复用上一档计划的同日内容
    if (_preRenderInstId !== inst.id) { _preRenderedDayHtml = {}; _preRenderInstId = inst.id; }
    var app = document.getElementById('app');
    var entries = getEntriesForDay(inst, doy);
    var d = _dayDate(inst, doy);
    var total = planTotal(inst);
    var done = completedCount(inst);
    var pct = total > 0 ? Math.round(done / total * 100) : 0;

    // 保存滚动位置
    var savedScroll = (opts && opts.restoreScroll != null) ? opts.restoreScroll : window.scrollY;

    // 每次渲染读取最新显示开关（设置面板可能刚修改过）
    _refreshUIToggles();

    // 先隐藏 #app，防止旧内容→新内容的可见闪烁
    if (!(opts && opts.keepVisible)) {
      app.style.opacity = '0';
      app.style.transition = '';
    }

    var html = '<div class="rp-container rp-day-view">';

    // ── 固定顶栏（日期）── 与经文页 fixedChapterBar 一致
    html += _dateBarHtml(d, false);

    // ── 进度条 ──
    html += '<div class="rp-progress-mini"><div class="rp-progress-mini-fill" style="width:' + pct + '%"></div></div>';

    // ── 主内容：经文（与经文页 .bible-reading 一致排版） ──
    html += '<div class="bible-reading">';
    if (entries.length === 0) {
      html += '<div class="rp-empty-day">' + _planText('\u5f53\u5929\u65e0\u8bfb\u7ecf\u5b89\u6392') + '</div>';
    } else {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i], entry = e.entry;
        html += '<div class="rp-reading-section">';
        html += '<div class="rp-reading-heading">' + esc(_entryHeadingName(e)) + ' \u00b7 ' + esc(formatEntry(entry)) + '</div>';
        if (entry.topic) {
          html += '<div class="rp-verses" id="rpVerses' + i + '"><div class="rp-topic-loading">' + _planText('\u52a0\u8f7d\u4e2d\u2026') + '</div></div>';
        } else {
          html += '<div class="rp-verses" id="rpVerses' + i + '"></div>';
        }
        html += '</div>';
      }
    }

    if (entries.length === 0) html += _readBarHtml(inst, doy);
    html += '</div>';

    // ── 侧边抽屉 ──
    html += '<div class="rp-drawer-overlay" data-action="close-drawer"></div>';
    html += '<div class="rp-drawer" id="rpDrawer">';
    html += '<div class="rp-drawer-header"><div class="rp-drawer-tabs">';
    html += '<div class="rp-drawer-tab active" data-action="drawer-tab" data-tab="progress">' + _planText('\u8fdb\u5ea6') + '(' + done + '/' + total + ')</div>';
    html += '<div class="rp-drawer-tab" data-action="drawer-tab" data-tab="records">' + _planText('\u8bb0\u5f55') + '</div>';
    html += '</div><button class="rp-drawer-close" data-action="close-drawer">\u2715</button></div>';
    html += '<div class="rp-drawer-body" id="rpDrawerBody">' + _buildCalendarContent(inst) + '</div>';
    html += '</div>';

    html += '</div>';
    if (opts && opts.keepVisible) {
      var container = app.querySelector('.rp-container');
      var dateBar = container.querySelector('.rp-date-bar');
      var replacement = document.createElement('div');
      replacement.innerHTML = html;
      var newBar = replacement.querySelector('.rp-date-bar');
      dateBar.querySelector('.rp-date-label').textContent = newBar.querySelector('.rp-date-label').textContent;
      var sidebarButton = dateBar.querySelector('.rp-sidebar-btn');
      sidebarButton.disabled = false;
      sidebarButton.title = newBar.querySelector('.rp-sidebar-btn').title;
      while (dateBar.nextSibling) container.removeChild(dateBar.nextSibling);
      while (newBar.nextSibling) container.appendChild(newBar.nextSibling);
      container.classList.remove('rp-initial-loading');
    } else {
      app.innerHTML = html;
    }

    // 确保 #app 可见（可能在 render() 中未调用 _cxShowApp）
    app.style.display = '';

    // 骨架内容已写入，下一帧渐显，避免闪烁
    if (!(opts && opts.keepVisible)) {
      requestAnimationFrame(function() {
        app.style.transition = 'opacity 0.15s ease';
        app.style.opacity = '1';
      });
    }

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
    _loadAllVerses(entries, savedScroll, inst, doy);
  }

  function _readBarHtml(inst, doy) {
    var comp = inst.completed && inst.completed[String(doy)];
    var html = '<div class="rp-read-bar-inline">';
    if (comp) {
      html += '<button class="rp-btn-read done" disabled>\u2713 ' + _planText('\u5df2\u8bfb') + ' <span class="rp-read-ts">' + timeColorLabel(timeColor(comp.at)) + '</span></button>';
    } else {
      html += '<button class="rp-btn-read" data-action="mark-read" data-day="' + doy + '">' + _planText('\u5df2\u8bfb') + '</button>';
    }
    return html + '</div>';
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

  // 获取书卷缩写（用于 vkey；主语言繁体时用繁体缩写）
  function bookAcronym(idx) {
    var names = _primaryBookNames();
    if (names) { var e = names[String(idx)] || names[idx]; if (e && e.short) return e.short; }
    if (!_books) return String(idx);
    for (var i = 0; i < _books.length; i++) if (_books[i].index === idx) return _books[i].acronym || String(idx);
    return String(idx);
  }

  // 加载大纲数据
  var _outlines = null;
  function loadOutlines() {
    if (_outlines) return Promise.resolve(_outlines);
    var file = _primaryDataFile('bible-outlines.json');
    return fetch(getRoot() + file).then(function (r) { return r.json(); }).then(function (d) {
      if (file === _primaryDataFile('bible-outlines.json')) _outlines = d;
      return d;
    }).catch(function () { return {}; });
  }

  // 加载书介数据（著者/著时/著地/受者等）
  var _introData = null;
  function loadIntroData() {
    if (_introData) return Promise.resolve(_introData);
    var file = _primaryDataFile('bible-intro.json');
    return fetch(getRoot() + file).then(function (r) { return r.json(); }).then(function (d) {
      if (file === _primaryDataFile('bible-intro.json')) _introData = d;
      return d;
    }).catch(function () { return {}; });
  }

  // 类型编号到标签的映射（与 bible-renderer.js _renderMetadata 保持一致）
  var _introLabelMap = {
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
  // 繁体书介数据的行首标签为繁体（著時/著地/涵蓋時段…），按主语言选用
  var _introLabelMapHant = {
    '1': '著者',
    '2': '著時',
    '3': '著地',
    '4': '受者',
    '5': '記載地點',
    '6': '涵蓋時段',
    '7': '盡職時間',
    '8': '盡職地點',
    '9': '盡職對象'
  };
  function _introLabels() { return _isHantPrimary() ? _introLabelMapHant : _introLabelMap; }

  // 解析书介数据行，提取标签和内容（数据格式："著者　摩西，..."，标签后跟全角或普通空格）
  function _parseIntroLine(text, key) {
    if (!text) return null;
    var label = _introLabels()[key] || '';
    if (!label) return null;
    var value = text;
    var patterns = [
      new RegExp('^' + label + '[\\s ]+'),
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

  // 渲染某书卷的书介（著者/著时/著地/受者四类，不含纲目）
  // bookIndex: 书卷号(1-66)；data: _introData；ctxStr: 书卷缩写上下文（供 wrapRefs 识别括号内无书名的引用）
  function _renderBookIntro(bookIndex, data, ctxStr) {
    if (!data) return '';
    var intro = data[String(bookIndex)];
    if (!intro) return '';
    var html = '<div class="bible-metadata">';
    var hasContent = false;
    // 按类型编号顺序渲染（与正文 _renderMetadata 一致：著者/著时/著地/受者/记载地点/涵盖时段/尽职时间/尽职地点/尽职对象）
    var keys = Object.keys(intro).sort(function(a, b) { return parseInt(a) - parseInt(b); });
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var value = intro[key];
      if (!value) continue;
      var parsed = _parseIntroLine(value, key);
      if (!parsed) continue;
      html += '<div class="bible-metadata-item">';
      html += '<span class="meta-label">' + esc(parsed.label) + '</span>';
      // 与 bible-renderer.js _renderMetadata 一致：经文引用展开（无 CXRef 时退化为纯文本）
      var metaHtml = (window.CXRef && window.CXRef.wrapRefs) ? window.CXRef.wrapRefs(parsed.value, ctxStr || '') : esc(parsed.value);
      html += '<span class="meta-value">' + metaHtml + '</span>';
      html += '</div>';
      hasContent = true;
    }
    html += '</div>';
    return hasContent ? html : '';
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
    if (!_supportsChinesePlanMetadata()) return '';
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

  // ── 主题摘要（与 bible-renderer.js _renderThemeText 同款结构） ──
  // ctxStr: 书卷缩写上下文（供 wrapRefs 识别括号内无书名的引用，与书介一致）
  function _renderThemeTextForPlan(bookIndex, topicsData, ctxStr) {
    if (!_supportsChinesePlanMetadata() || !topicsData) return '';
    var topic = topicsData[String(bookIndex)];
    if (!topic) return '';
    var html = '<div class="bible-theme-text">';
    html += '<span class="meta-label">' + (_isHantPrimary() ? '主題' : '主题') + '</span>';
    var topicHtml = (window.CXRef && window.CXRef.wrapRefs) ? window.CXRef.wrapRefs(topic, ctxStr || '') : esc(topic);
    html += '<span class="theme-content">' + topicHtml + '</span>';
    html += '</div>';
    return html;
  }

  // 计算条目跨越的书卷列表（支持跨书卷：book → book_to）
  function _spanBooks(entry) {
    var from = entry.book, to = entry.book_to || entry.book;
    if (to < from) to = from;
    var arr = [];
    for (var b = from; b <= to; b++) arr.push(b);
    return arr;
  }

  // 加载条目跨书卷范围内各卷的章节数据，返回 [{bookIndex, data}]（按书卷顺序）
  function _loadSpanChapters(entry) {
    var books = _spanBooks(entry);
    return Promise.all(books.map(function (b) {
      return loadChapter(b).then(function (d) { return { bookIndex: b, data: d }; });
    }));
  }

  // ── 纯函数：根据 entry 和章节数据返回完整经文 HTML（不含 DOM 操作） ──
  // datas: [{bookIndex, data}] 按书卷顺序的章节数据（支持跨书卷条目：首卷读到卷尾，
  // 末卷从第 1 章读到 chapter_to，中间卷全卷）
  // introData/topicsData: 书介/主题数据（可选）；某卷从 1:1 起读时在经文顶部显示书介 + 主题；
  // 段读拆章时（如"创 1:24 – 2:6"）section > 1 表示非首段，不再重复显示
  //（与 bible-renderer.js 仅第一章显示书介与主题的语义一致）
  function _renderEntryVersesHtml(entry, datas, introData, topicsData) {
    if (!datas || !datas.length || !datas[0] || !datas[0].data || !datas[0].data.chapters) {
      return '<div class="rp-verses-empty">' + _planText('无经文数据') + '</div>';
    }
    var bookFrom = entry.book;
    var bookTo = entry.book_to || entry.book;
    var html = '';
    var hasVerses = false;

    for (var bi = 0; bi < datas.length; bi++) {
      var ds = datas[bi];
      var bIdx = ds.bookIndex;
      var data = ds.data;
      if (!data || !data.chapters) continue;
      var acro = bookAcronym(bIdx);

      // 本卷渲染范围：同卷条目按 entry；跨书卷首卷读到卷尾；末卷从第 1 章起；中间卷全卷
      var chFrom, chTo, secFrom, secTo;
      if (bookFrom === bookTo) {
        chFrom = entry.chapter;
        chTo = entry.chapter_to || entry.chapter;
        secFrom = entry.section;
        secTo = entry.section_to;
      } else if (bIdx === bookFrom) {
        chFrom = entry.chapter; chTo = 9999;
        secFrom = entry.section; secTo = 9999;
      } else if (bIdx === bookTo) {
        chFrom = 1; chTo = entry.chapter_to;
        secFrom = 1; secTo = entry.section_to;
      } else {
        chFrom = 1; chTo = 9999;
        secFrom = 1; secTo = 9999;
      }

      // 卷首段（第 1 章第 1 节起读）在本卷起始章处显示书介 + 主题
      // （与 bible-renderer.js 顺序一致：章节头 → 书介 → 主题 → 经文；
      // 首卷为条目起始章时不产生分隔条，书介+主题仍在经文顶部）

      for (var chNum = chFrom; chNum <= chTo; chNum++) {
        var ch = null;
        for (var c = 0; c < data.chapters.length; c++) {
          if (data.chapters[c].chapter === chNum) { ch = data.chapters[c]; break; }
        }
        if (!ch || !ch.verses) continue;

        var secStart = (chNum === chFrom) ? secFrom : 1;
        var secEnd = (chNum === chTo) ? secTo : 9999;

        // 章分隔：非本卷起始章，或跨书卷条目中的后续卷（新卷第一章也显示卷名+章号）
        if (chNum > chFrom || bi > 0) {
          html += '<div class="rp-chapter-divider">' + esc(bookName(bIdx)) + ' ' + chNum + '</div>';
        }

        // 本卷起始章（且从 1:1 起读）显示书介 + 主题
        // 与 bible-renderer.js 一致：两者统一包进 .bible-header-section（浅色区块 + 主题上方分隔线）
        if (chNum === chFrom && chFrom === 1 && secFrom === 1) {
          html += _renderBookHeaderHtml(bIdx, introData, topicsData, acro);
        }

        // 章节开头大纲（section <= secStart）—— 遵循正文页的「纲目」显示开关
        var outlines = _supportsChinesePlanMetadata() && _uiToggles().showOutline
          ? getOutlinesForRange(bIdx, chNum, secStart, secEnd) : [];
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

        // 经文 + 行间大纲（与正文一致：同 section 只插一次大纲，并在节间插入分隔线）
        var lastVsSection = -1;
        for (var v = 0; v < ch.verses.length; v++) {
          var vs = ch.verses[v];
          if (vs.section < secStart || vs.section > secEnd) continue;
          hasVerses = true;

          var isNewVerseSection = vs.section !== lastVsSection;
          var outlineInserted = false;
          if (isNewVerseSection && outlines.length > 0) {
            for (var oi2 = 0; oi2 < outlines.length; oi2++) {
              if (outlines[oi2].section === vs.section && outlines[oi2].section > secStart) {
                html += _renderOutlinesForSection(outlines, vs.section);
                outlineInserted = true;
                break;
              }
            }
          }
          if (isNewVerseSection && lastVsSection !== -1 && !outlineInserted && _uiToggles().showVerseDivider) {
            html += '<hr class="verse-divider" />';
          }

          var vkey = acro + chNum + ':' + vs.section;
          var flagLabel = '';
          if (vs.flag === 1) flagLabel = '上';
          else if (vs.flag === 2) flagLabel = '下';
          else if (vs.flag === 3) flagLabel = '中';

          html += '<div class="bible-verse" data-section="' + vs.section + '"' + (vs.flag ? ' data-flag="' + vs.flag + '"' : '') + '>';
          html += '<span class="verse-num">' + vs.section + flagLabel + '</span>';
          var verseHtml = vs.content != null ? _formatContent(vs.content, vkey) : esc(vs.text || '');
          html += '<div class="bible-verse-lang primary" data-lang="' + esc(getPrimaryLang()) + '">' + verseHtml + '</div>';
          html += '</div>';
          lastVsSection = vs.section;
        }
      }
    }

    if (!hasVerses) return '<div class="rp-verses-empty">' + _planText('无匹配经文') + '</div>';
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
          if (!topic) return '<div class="rp-verses-empty">' + _planText('\u65e0\u4e3b\u9898\u6570\u636e') + '</div>';
          if (!_uiToggles().showTheme) return '';
          return _wrapHeaderSection(_renderThemeTextForPlan(e.entry.book, _topicsData, bookAcronym(e.entry.book)));
        });
      }
      return Promise.all([_loadSpanChapters(e.entry), loadOutlines(), loadIntroData(), loadTopics()]).then(function (results) {
        return _renderEntryVersesHtml(e.entry, results[0], results[2], results[3]);
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
          html += '<div class="rp-reading-heading">' + esc(_entryHeadingName(entries[i])) + ' \u00b7 ' + esc(formatEntry(entries[i].entry)) + '</div>';
          html += '<div class="rp-verses" id="rpVerses' + i + '">' + versesHtml[i] + '</div>';
          html += '</div>';
        }
      }
      html += _readBarHtml(inst, doy);
      return html;
    });
  }

  // ── 加载并渲染完整经文（支持跨章节） ──
  function _loadAllVerses(entries, restoreScroll, inst, doy) {
    console.log('[RP] _loadAllVerses entries:', entries.length);
    var gen = _renderGen;  // 捕获当前渲染代数，异步回调中校验
    var reading = document.querySelector('#app .center-page .bible-reading');
    var pending = entries.length, failed = false;
    function onVerseDone(error) {
      if (gen !== _renderGen || _currentDay !== doy || !document.body.classList.contains('cx-reading-plan-page') ||
          reading !== document.querySelector('#app .center-page .bible-reading')) return;
      if (error) failed = true;
      pending--;
      requestAnimationFrame(_updateSliderHeight);
      if (pending <= 0 && restoreScroll) {
        requestAnimationFrame(function() { window.scrollTo(0, restoreScroll); });
      }
      // 全部经文加载完成时，多重兜底更新高度，确保布局稳定后能读到正确的 offsetHeight
      if (pending <= 0) {
        if (!failed && reading && !reading.querySelector('.rp-read-bar-inline')) {
          reading.insertAdjacentHTML('beforeend', _readBarHtml(inst, doy));
        }
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
            el.innerHTML = '<div class="rp-verses-empty">' + _planText('\u52a0\u8f7d\u5931\u8d25') + '</div>';
            onVerseDone(true);
          });
          return;
        }

        // 主题日：加载并显示书卷主题
        if (entry.topic) {
          loadTopics().then(function () {
            if (gen !== _renderGen || !document.body.classList.contains('cx-reading-plan-page')) return;
            var topic = getTopic(entry.book);
            var html = '';
            if (!topic) {
              html = '<div class="rp-verses-empty">' + _planText('\u65e0\u4e3b\u9898\u6570\u636e') + '</div>';
            } else if (_uiToggles().showTheme) {
              html = _wrapHeaderSection(_renderThemeTextForPlan(entry.book, _topicsData, bookAcronym(entry.book)));
            }
            el.innerHTML = html;
            console.log('[RP] entry[' + idx + '] topic rendered');
            onVerseDone();
          }).catch(function () {
            if (gen !== _renderGen) return;
            el.innerHTML = '<div class="rp-verses-empty">' + _planText('\u52a0\u8f7d\u5931\u8d25') + '</div>';
            onVerseDone(true);
          });
          return;
        }

        el.innerHTML = '<div class="rp-verses-loading">' + _planText('\u52a0\u8f7d\u4e2d\u2026') + '</div>';

        Promise.all([_loadSpanChapters(entry), loadOutlines(), loadIntroData(), loadTopics()]).then(function (results) {
          // 渲染代数守卫：若已导航离开或有新渲染，丢弃本次结果避免覆盖新页面
          if (gen !== _renderGen || !document.body.classList.contains('cx-reading-plan-page')) return;
          var html = _renderEntryVersesHtml(entry, results[0], results[2], results[3]);
          el.innerHTML = html;
          console.log('[RP] entry[' + idx + '] rendered');
          onVerseDone();
        }).catch(function (err) {
          if (gen !== _renderGen) return;  // 已有新渲染，不处理错误
          console.error('[RP] entry[' + idx + '] ERROR:', err);
          el.innerHTML = '<div class="rp-verses-empty">' + _planText('\u52a0\u8f7d\u5931\u8d25') + '</div>';
          onVerseDone(true);
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
      html += '<div class="rp-empty-day">' + _planText('\u5f53\u5929\u65e0\u8bfb\u7ecf\u5b89\u6392') + '</div>';
    } else {
      // 全卷主题日：特殊标题
      var first = entries[0], firstEntry = first.entry;
      if (firstEntry._allTopics) {
        html += '<div class="rp-reading-section">';
        html += '<div class="rp-reading-heading">' + esc(formatEntry(firstEntry)) + '</div>';
        html += '<div class="rp-verses" id="rpVerses0"><div class="rp-topic-loading">' + _planText('\u52a0\u8f7d\u4e2d\u2026') + '</div></div>';
        html += '</div>';
      } else {
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i], entry = e.entry;
          html += '<div class="rp-reading-section">';
// 标题：一档计划每天两条（旧约/新约），用约别替代重复的计划名
        var _headingName = _entryHeadingName(e);
        html += '<div class="rp-reading-heading">' + esc(_headingName) + ' \u00b7 ' + esc(formatEntry(entry)) + '</div>';
          if (entry.topic) {
          html += '<div class="rp-verses" id="rpVerses' + i + '"><div class="rp-topic-loading">' + _planText('\u52a0\u8f7d\u4e2d\u2026') + '</div></div>';
          } else {
            html += '<div class="rp-verses" id="rpVerses' + i + '"></div>';
          }
          html += '</div>';
        }
      }
    }
    if (entries.length === 0) html += _readBarHtml(inst, doy);
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
        if (gen !== _renderGen) return;
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
    // 允许增大也允许缩小（差值>1px时更新），避免骨架阶段测得的偏小值
    // 锁死 min-height 导致内容无法完整滚动，同时消除顶栏 padding 微调后的底部残留空白
    if (Math.abs(h - oldH) > 1) {
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

    // 必须先声明 viewH：下面 centerPage 的 min-height 和侧页高度都要用它。
    // （旧代码在 centerPage 拼接之后才声明，var 提升导致拼出 'min-height:undefinedpx'，
    //   中页失去视口高度下限，短内容日会出现页面高度不足。）
    var viewH = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0;

    var W = container.offsetWidth;
    var wrapper = document.createElement('div');
    wrapper.className = 'swipe-slider';
    // overflow-x 用 clip：hidden 会把 wrapper 变成伪滚动容器，吞掉首次纵向滚动手势
    wrapper.style.cssText = 'position:relative;width:100%;overflow-x:clip;overflow-y:visible;';

    var centerPage = document.createElement('div');
    centerPage.className = 'swipe-page center-page';
    centerPage.style.cssText = 'width:100%;min-height:' + viewH + 'px;'
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

    // ── 动态设置所有 .bible-reading 的 padding-top 匹配日期栏实际高度 ──
    try {
      var _dateBar = container.querySelector('.rp-date-bar');
      var _barH = _dateBar ? (_dateBar.offsetHeight || 0) : 0;
      if (_barH > 0) {
        var _rpReadings = container.querySelectorAll('.bible-reading');
        for (var _i = 0; _i < _rpReadings.length; _i++) {
          _rpReadings[_i].style.paddingTop = _barH + 'px';
        }
      }
    } catch(_e) {}
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
    var gen = _renderGen;

    _isAnimating = true;
    _setSliderTransform(centerEl, leftEl, rightEl, targetX, true);

    var cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (gen !== _renderGen || !document.body.classList.contains('cx-reading-plan-page')) return;
      _isAnimating = false;

      _currentDay = targetDay;

      var inst = getInstance(_currentInstId);
      if (!inst) return;

      // 局部更新：只替换日期文字、进度条、经文内容，保留顶栏 DOM 不重建，避免闪烁
      var newContentHtml = _preRenderedDayHtml[targetDay] || _buildDayInnerHtml(inst, targetDay);
      var d = _dayDate(inst, targetDay);
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
      if (progressTab) progressTab.textContent = _planText('\u8fdb\u5ea6') + '(' + done + '/' + total + ')';

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
        // 动态设置 padding-top 匹配日期栏实际高度
        var _db = container.querySelector('.rp-date-bar');
        if (_db && _db.offsetHeight > 0) readingDiv.style.paddingTop = _db.offsetHeight + 'px';
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
        _loadAllVerses(entries, null, inst, targetDay);
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
      var wrapperLeft = wrapper.getBoundingClientRect().left;
      if (leftEl) {
        leftEl.style.left = (wrapperLeft - wrapperW) + 'px';
        leftEl.style.width = wrapperW + 'px';
        leftEl.style.height = window.innerHeight + 'px';
      }
      if (rightEl) {
        rightEl.style.left = (wrapperLeft + wrapperW) + 'px';
        rightEl.style.width = wrapperW + 'px';
        rightEl.style.height = window.innerHeight + 'px';
      }
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
    var year = inst.year || new Date().getFullYear(), todayDoy = _dayIndex(inst, todayStr());
    var html = '<div class="rp-legend"><span class="rp-legend-item"><span class="rp-dot green"></span>' + _planText('\u6e05\u6668') + '</span><span class="rp-legend-item"><span class="rp-dot yellow"></span>' + _planText('\u65e5\u95f4') + '</span><span class="rp-legend-item"><span class="rp-dot red"></span>' + _planText('\u5176\u4ed6') + '</span></div>';
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
      html += '<div class="rp-record-group"><div class="rp-record-group-title">' + (pt ? pt.icon + ' ' + _planText(pt.label) : type) + '</div>';
      for (var gi = 0; gi < group.length; gi++) {
        var g = group[gi], dn = completedCount(g), tt = planTotal(g);
        html += '<div class="rp-record-card' + (g.id === inst.id ? ' current' : '') + '" data-action="switch-plan" data-id="' + g.id + '">';
        html += '<div class="rp-record-date">' + _planText('\u5f00\u59cb: ') + esc(g.startDate) + '</div>';
        html += '<div class="rp-record-meta">' + esc(pt ? _planText(pt.label) : type) + '  ' + dn + '/' + tt + '</div>';
        html += '<div class="rp-progress-bar"><div class="rp-progress-fill" style="width:' + (tt > 0 ? Math.round(dn / tt * 100) : 0) + '%"></div></div>';
        if (g.id === inst.id) html += '<div class="rp-record-badge">' + _planText('\u5f53\u524d') + '</div>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '<div class="rp-records-footer">' + _planText('\u5df2\u5b8c\u6210 ') + rounds + ' ' + _planText('\u904d\u8bfb\u7ecf') + '</div>';
    html += '<button class="rp-btn-create" data-action="show-create">' + _planText('\u65b0\u589e\u8bb0\u5f55') + '</button>';
    return html;
  }

  function _buildCalendar(inst, year, todayDoy) {
    var mn = ['1\u6708','2\u6708','3\u6708','4\u6708','5\u6708','6\u6708','7\u6708','8\u6708','9\u6708','10\u6708','11\u6708','12\u6708'];
    var wd = ['\u65e5','\u4e00','\u4e8c','\u4e09','\u56db','\u4e94','\u516d'];
    var html = '<div class="rp-calendar">';
    // 从计划开始月画到读完月（四个月/半年只画前几个月；两年计划跨年连续显示）
    var maxDay = planTotal(inst);
    var startDate = _instStartDate(inst);
    var endDate = _dayDate(inst, maxDay);
    var cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    var endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    while (cur <= endMonth) {
      var y = cur.getFullYear(), m = cur.getMonth();
      html += '<div class="rp-month"><div class="rp-month-name">' + y + '\u5e74' + mn[m] + '</div><div class="rp-weekdays">';
      for (var w = 0; w < 7; w++) html += '<span class="rp-wd' + (w === 0 ? ' sun' : '') + '">' + wd[w] + '</span>';
      html += '</div><div class="rp-days">';
      var fd = firstDayOfMonth(y, m), dim = daysInMonth(y, m);
      for (var b = 0; b < fd; b++) html += '<span class="rp-day empty"></span>';
      for (var d = 1; d <= dim; d++) {
        var ds = y + '-' + pad2(m + 1) + '-' + pad2(d);
        var raw = _rawDayIndex(inst, ds);        // 不钳制，用于判断计划范围
        var comp = (raw >= 1 && raw <= maxDay && inst.completed) ? inst.completed[String(raw)] : null;
        var clr = comp ? timeColor(comp.at) : '';
        var isToday = (raw === todayDoy), isCur = (raw === _currentDay);
        var cls = 'rp-day';
        if (raw < 1 || raw > maxDay) cls += ' out-of-range';   // 计划外的日期不可选
        if (isToday) cls += ' today';
        if (isCur && !isToday) cls += ' selected';
        if (clr) cls += ' done ' + clr;
        html += '<span class="' + cls + '" data-action="drawer-select-day" data-day="' + (raw < 1 ? 1 : Math.min(raw, maxDay)) + '">' + d;
        if (clr) html += '<span class="rp-check">\u2713</span>';
        html += '</span>';
      }
      html += '</div></div>';
      cur = new Date(y, m + 1, 1);
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
    if (drawer && !_drawerBackFn && win.CX && win.CX.backStack) {
      _drawerBackFn = function () { _drawerBackFn = null; closeDrawer(); };
      win.CX.backStack.push(_drawerBackFn);
    }
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
    if (_drawerBackFn && win.CX && win.CX.backStack) {
      win.CX.backStack.remove(_drawerBackFn);
      _drawerBackFn = null;
    }
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
    var types = Object.keys(PLAN_TYPES), html = '<div class="rp-dialog"><div class="rp-dialog-title">' + _planText('\u65b0\u589e\u8bfb\u7ecf\u8bb0\u5f55') + '</div>';
    for (var i = 0; i < types.length; i++) {
      var key = types[i], pt = PLAN_TYPES[key];
      html += '<div class="rp-dialog-option" data-action="create-plan" data-type="' + key + '"><div class="rp-dialog-opt-icon">' + pt.icon + '</div><div class="rp-dialog-opt-body"><div class="rp-dialog-opt-label">' + esc(_planText(pt.label)) + '</div><div class="rp-dialog-opt-desc">' + esc(_planText(pt.desc)) + '</div></div></div>';
    }
    html += '<button class="rp-dialog-cancel" data-action="close-dialog">\u53d6\u6d88</button></div>';
    ov.innerHTML = html; document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeDialog(); });
    if (win.CX && win.CX.backStack) {
      _dialogBackFn = function () { _dialogBackFn = null; closeDialog(); };
      win.CX.backStack.push(_dialogBackFn);
    }
  }
  function closeDialog() {
    var el = document.getElementById('rpCreateDialog');
    if (el) el.parentNode.removeChild(el);
    if (_dialogBackFn && win.CX && win.CX.backStack) {
      win.CX.backStack.remove(_dialogBackFn);
      _dialogBackFn = null;
    }
  }

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
          if (t.classList.contains('out-of-range')) break;   // 计划外的日期不可选
          closeDrawer();
          var inst = getInstance(_currentInstId);
          if (inst && win.CXRouter) {
            // 不在此处设置 _currentDay：render() 会根据路由参数设置，
            // 提前设置会导致 _isSamePage() 误判为"已在同一页"而跳过渲染
            win.CXRouter.navigate('reading-plan/' + inst.id + '/' + day);
          } else {
            _currentDay = day;
            if (inst) renderDayContent(inst, day);
          }
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
                barEl.innerHTML = '<button class="rp-btn-read done" disabled>\u2713 ' + _planText('\u5df2\u8bfb') + ' <span class="rp-read-ts">' + timeColorLabel(color) + '</span></button>';
              }
              // 更新进度条
              var fill = document.querySelector('.rp-progress-mini-fill');
              if (fill) fill.style.width = pct + '%';
              // 更新抽屉进度标签
              var tab = document.querySelector('.rp-drawer-tab[data-tab="progress"]');
              if (tab) tab.textContent = _planText('\u8fdb\u5ea6') + '(' + done + '/' + total + ')';
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
          _currentInstId = inst.id; _currentDay = _todayDay(inst);
          renderDayContent(inst, _currentDay);
          // 同步路由 + 持久化页面记忆
          var _createHash = '#/reading-plan/' + _currentInstId + '/' + _currentDay;
          if (window.location.hash !== _createHash) {
            try { history.replaceState(null, '', _createHash); } catch(e) { window.location.hash = _createHash; }
          }
          if (win.CXSavePage) { try { win.CXSavePage(); } catch(e) {} }
          break;
        case 'switch-plan':
          _currentInstId = t.dataset.id;
          closeDrawer();
          var inst = getInstance(_currentInstId);
          if (inst) {
            _currentDay = _todayDay(inst);
            renderDayContent(inst, _currentDay);
          }
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
        closeDialog(); _currentInstId = inst.id; _currentDay = _todayDay(inst);
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

  function _isSamePage(instId, dayNum) {
    // 判断路由参数是否与当前读经计划页一致，用于跳过重复渲染
    if (_renderPending || _renderFailed) return false;
    if (!instId) {
      // 无指定实例ID时，使用当前第一个实例
      var instances = loadInstances();
      if (instances.length > 0) instId = instances[0].id;
    }
    if (!dayNum) {
      var _inst0 = getInstance(instId);
      dayNum = _inst0 ? _dayIndex(_inst0, todayStr()) : dayOfYear(todayStr());
    }
    var inst = getInstance(instId);
    var day = inst ? clampDay(inst, dayNum) : parseInt(dayNum, 10);
    return _currentInstId === instId && _currentDay === day;
  }

  // 跳转到当天
  function goToToday() {
    var inst = getInstance(_currentInstId);
    if (!inst) {
      var instances = loadInstances();
      if (instances.length > 0) inst = instances[0];
    }
    if (inst) {
      var day = _todayDay(inst);   // 四个月/半年计划读完后停在最后一天
      if (_currentDay === day && _currentInstId === inst.id) return; // 已在当天
      _currentInstId = inst.id;
      _currentDay = day;
      renderDayContent(inst, day);
      var newHash = '#/reading-plan/' + inst.id + '/' + day;
      if (window.location.hash !== newHash) {
        try { history.replaceState(null, '', newHash); } catch(e) { window.location.hash = newHash; }
      }
      if (win.CXSavePage) { try { win.CXSavePage(); } catch(e) {} }
    }
  }

  function init() { setupEvents(); }

  // ── 主语言变更（设置面板切换后）：清缓存并重渲染当前天 ──
  window.addEventListener('cx:primaryLangChanged', function () {
    if (!_renderPending) _renderGen++;
    _preRenderedDayHtml = {};
    _preRenderInstId = null;
    _chapterCache = {};
    _topicsData = null;
    _introData = null;
    _outlines = null;
    try {
      if (document.body.classList.contains('cx-reading-plan-page')) {
        if (_renderPending) return;
        if (_renderFailed) {
          var error = document.querySelector('#app .rp-load-error');
          if (error) error.textContent = _planText('\u52a0\u8f7d\u5931\u8d25');
          var title = document.querySelector('#app .rp-title');
          if (title) title.textContent = _planText('\u8bfb\u7ecf\u8ba1\u5212');
          var progress = document.querySelector('#app .rp-sidebar-btn');
          if (progress) progress.title = _planText('\u8fdb\u5ea6');
          return;
        }
        if (_currentInstId && _currentDay) {
          var inst = getInstance(_currentInstId);
          if (inst) { renderDayContent(inst, _currentDay); return; }
        }
        // 计划列表页（尚未选择计划）：直接按新主语言重绘
        renderPlanList();
      }
    } catch (e) {}
  });
  function cleanup() {
    closeDialog();
    closeDrawer();
    _renderGen++;
    _renderPending = false;
    _renderFailed = false;
    _isAnimating = false;
    _unbindSwipeGesture();
  }
  win.CXReadingPlan = { init: init, render: render, renderPlanList: renderPlanList, showCreateDialog: showCreateDialog, cleanup: cleanup, _isSamePage: _isSamePage, goToToday: goToToday, remeasureHeight: _updateSliderHeight };
})(window);
