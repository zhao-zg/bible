/**
 * scripture-popup.js
 * ==================
 * 功能：
 *  1. .scripture-ref[data-refs] 点击 → 弹框显示经文
 *  2. 正文自动标注阿拉伯式经文引用
 *  3. 弹框内 {N} 注脚号 → 展开注解（fn-ref）
 *  4. 弹框内 [a] 串珠号 → 展开对应串珠经文列表（xref-ref）
 *  5. 导航栈（返回按钮）
 *  6. 分片懒加载：bible/{NN}.json（同时提取经文/注解/串珠）
 *
 * 全局变量（fetch 后手动赋值）：
 *   CX_SCRIPTURES_DATA   （从分片提取的经文文本）
 *   CX_BIBLE_NOTES       （从分片提取的注解）
 *   CX_BIBLE_XREFS       （从分片提取的串珠）
 */
(function () {
  'use strict';

  /* ── 书卷/数字匹配（支持阿拉伯与中文数字） ── */
  var REF_BOOK_RE = '[创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚雅玛太可路约徒罗林加弗腓西帖提门多彼犹启来][后前上下壹贰叁参]?';
  /* 只有一章的书卷（犹、俄、门、约贰/约叁），引用时可省略章号 */
  var SINGLE_CHAPTER_BOOKS = { '犹':1, '俄':1, '门':1, '约贰':1, '约叁':1, '约二':1, '约三':1 };
  var REF_NUM_RE = '[0-9一二三四五六七八九十百零〇○]+';
  var RANGE_SEP = '[\\-~～—]';  /* 范围分隔符：- ~ ～ — */
  /* 支持：太4:19 / 太四19 / 太四19-22 / 太4:19~22 / 罗五17～21 / 路九23 */
  var INLINE_REF_RE = new RegExp('(' + REF_BOOK_RE + '(?:' + REF_NUM_RE + ':' + REF_NUM_RE + '(?:' + RANGE_SEP + REF_NUM_RE + ')?[上中下]?|[一二三四五六七八九十百零〇○]+' + REF_NUM_RE + '(?:' + RANGE_SEP + REF_NUM_RE + ')?[上中下]?))', 'g');

  /* ── HTML 转义 ── */
  function esc(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function cnNumToInt(s) {
    if (!s) return null;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    var m = { '零':0, '〇':0, '○':0, '一':1, '二':2, '三':3, '四':4, '五':5, '六':6, '七':7, '八':8, '九':9 };

    if (s.indexOf('百') >= 0 || s.indexOf('十') >= 0) {
      var val = 0;
      var rest = s;
      var i;
      if ((i = rest.indexOf('百')) >= 0) {
        var h = rest.slice(0, i);
        val += (h ? (m[h] || 0) : 1) * 100;
        rest = rest.slice(i + 1);
      }
      if ((i = rest.indexOf('十')) >= 0) {
        var t = rest.slice(0, i);
        val += (t ? (m[t] || 0) : 1) * 10;
        rest = rest.slice(i + 1);
      }
      for (var k = 0; k < rest.length; k++) {
        val += (m[rest.charAt(k)] || 0);
      }
      return val;
    }

    var digits = [];
    for (var j = 0; j < s.length; j++) {
      var d = m[s.charAt(j)];
      if (d === undefined) return null;
      digits.push(d);
    }
    if (digits.length === 1) return digits[0];
    if (digits.length === 2) return digits[0] * 10 + digits[1];
    if (digits.length === 3) return digits[0] * 100 + digits[1] * 10 + digits[2];
    return null;
  }

  function normalizeNumToken(token) {
    var n = cnNumToInt(token);
    return (n === null || isNaN(n)) ? null : String(n);
  }

  function parseBookAndTail(ref) {
    var mBook = ref.match(new RegExp('^(' + REF_BOOK_RE + ')(.*)$'));
    if (!mBook) return null;
    return { book: mBook[1], tail: mBook[2] || '' };
  }

  function getBookFromRef(ref) {
    var bt = parseBookAndTail(ref || '');
    return bt ? bt.book : '';
  }

  function splitRefTokens(refs) {
    return String(refs || '')
      .replace(/[（(]/g, ' ')
      .replace(/[）)]/g, ' ')
      .split(/[\s,，;；、]+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function normalizeRef(ref, fallbackBook) {
    ref = (ref || '').trim();
    if (!ref) return '';
    ref = ref
      .replace(/^参+/g, '')
      .replace(/^[见見]/g, '')
      .replace(/\s+/g, '')
      .replace(/：/g, ':')
      .replace(/[－—～~]/g, '-')
      .replace(/[。；，、]$/g, '');

    /* 「书+章+标题」格式：诗二二标题 / 诗22标题 → 诗22:0T */
    if (/标题$/.test(ref)) {
      var titleRef = ref.slice(0, -2); /* 去掉"标题" */
      var btT = parseBookAndTail(titleRef);
      if (btT && btT.book) {
        var chT = normalizeNumToken(btT.tail);
        if (chT) return btT.book + chT + ':0T';
      }
    }

    var bt = parseBookAndTail(ref);
    var book = bt ? bt.book : (fallbackBook || '');
    var tail = bt ? bt.tail : ref;
    if (!book) return ref;

    var m1 = tail.match(new RegExp('^(' + REF_NUM_RE + '):(' + REF_NUM_RE + '(?:-' + REF_NUM_RE + ')?)([上中下]?)$'));
    if (m1) {
      var ch = normalizeNumToken(m1[1]);
      if (!ch) return ref;
      var vr = m1[2];
      var suffix = m1[3] || '';
      if (vr.indexOf('-') >= 0) {
        var ab = vr.split('-', 2);
        var a = normalizeNumToken(ab[0]);
        var b = normalizeNumToken(ab[1]);
        if (!a || !b) return ref;
        return book + ch + ':' + a + '-' + b + suffix;
      }
      var v = normalizeNumToken(vr);
      return v ? (book + ch + ':' + v + suffix) : ref;
    }

    var m2 = tail.match(/^([一二三四五六七八九十百零〇○]+)(\d+(?:-\d+)?)([上中下]?)$/);
    if (m2) {
      var ch2 = normalizeNumToken(m2[1]);
      if (!ch2) return ref;
      var vr2 = m2[2];
      var suffix2 = m2[3] || '';
      if (vr2.indexOf('-') >= 0) {
        var ab2 = vr2.split('-', 2);
        var a2 = normalizeNumToken(ab2[0]);
        var b2 = normalizeNumToken(ab2[1]);
        if (!a2 || !b2) return ref;
        return book + ch2 + ':' + a2 + '-' + b2 + suffix2;
      }
      var v2 = normalizeNumToken(vr2);
      return v2 ? (book + ch2 + ':' + v2 + suffix2) : ref;
    }

    var m3 = tail.match(new RegExp('^(' + REF_NUM_RE + ')([一二三四五六七八九十百零〇○]+)([上中下]?)$'));
    if (m3) {
      var ch3 = normalizeNumToken(m3[1]);
      var v3 = normalizeNumToken(m3[2]);
      var suffix3 = m3[3] || '';
      if (!ch3 || !v3) return ref;
      return book + ch3 + ':' + v3 + suffix3;
    }

    /* 单章书卷：犹20 → 犹1:20，门8 → 门1:8 */
    if (SINGLE_CHAPTER_BOOKS[book]) {
      var m4 = tail.match(/^(\d+(?:-\d+)?)([上中下]?)$/);
      if (m4) {
        var vr4 = m4[1], suffix4 = m4[2] || '';
        if (vr4.indexOf('-') >= 0) {
          var ab4 = vr4.split('-', 2);
          return book + '1:' + ab4[0] + '-' + ab4[1] + suffix4;
        }
        return book + '1:' + vr4 + suffix4;
      }
    }

    /* 整章范围：士六-八 → 士6-士8（章级范围，expandRefToken 展开为整章经节）
     * 单章引用：士六 → 士6:0（:0 前缀触发 expandRefToken 的整章展开） */
    var m5 = tail.match(new RegExp('^(' + REF_NUM_RE + ')(?:-(' + REF_NUM_RE + '))?$'));
    if (m5) {
      var c5a = normalizeNumToken(m5[1]);
      if (!c5a) return ref;
      if (m5[2] !== undefined) {
        var c5b = normalizeNumToken(m5[2]);
        if (!c5b) return ref;
        return book + c5a + '-' + book + c5b;
      }
      return book + c5a + ':0';
    }

    /* 跨书章范围：撒上十六-撒下二四 → 撒上16-撒下24 */
    var m6 = tail.match(new RegExp('^(' + REF_NUM_RE + ')-(' + REF_BOOK_RE + ')(' + REF_NUM_RE + ')$'));
    if (m6) {
      var c6a = normalizeNumToken(m6[1]);
      var b6 = m6[2];
      var c6b = normalizeNumToken(m6[3]);
      if (!c6a || !c6b) return ref;
      return book + c6a + '-' + b6 + c6b;
    }

    return ref;
  }

  function parseAndExpandRefs(refs, bibleDict, contextBook) {
    var tokens = splitRefTokens(refs);
    var lastBook = contextBook || '';
    var lastChapter = '';   // 上一个成功解析的章号（十进制字符串）
    var out = [];
    tokens.forEach(function (token) {
      // 节范围标签前缀剥离：「31-35:出三六35」→「出三六35」
      // 形如「数字(范围):经文引用」，冒号前是段落/节次标签，非经文章节引用
      var _lm = /^\d+(?:[~～\-]\d+)?:([^\d:].*)$/.exec(token);
      if (_lm) token = _lm[1].trim();
      // 纯节号续接（如 8~9、19~24）：仅含数字+范围符，无书卷前缀
      // 此时继承 lastBook + lastChapter，拼成完整引用再解析
      var bareVerse = token.replace(/[～~—\-]/g, '-').match(/^(\d+)(-\d+)?([上中下]?)$/);
      if (bareVerse && lastBook && lastChapter) {
        token = lastBook + lastChapter + ':' + token;
      }
      var nr = normalizeRef(token, lastBook);
      if (!nr) return;
      var bk = getBookFromRef(nr);
      if (bk) lastBook = bk;
      // 更新 lastChapter（从规范化后的 book+章:节 中提取章号）
      var chm = nr.match(/(\d+):/);
      if (chm) lastChapter = chm[1];
      out = out.concat(expandRefToken(nr, bibleDict));
    });
    return out;
  }

  function expandRefToken(ref, bibleDict) {
    var nr = normalizeRef(ref);
    if (!nr) return [];

    // 跨章范围：book c1:v1-c2:v2（如 启10:1-11:13、创1:2下-2:3）
    // 展开为区间内所有已收录经节（含上/中/下半节键）；
    // 端点节带上/中/下修饰时按半节边界收窄（如「一2下～二3」从 创1:2下 起、「三4～十一43上」到 创11:43上 止）；
    // 若端点节未分上下半（无对应半节键），保留整节不收窄
    var mrCross = nr.match(new RegExp('^(' + REF_BOOK_RE + ')(\\d+):(\\d+)([上中下]?)-(\\d+):(\\d+)([上中下]?)$'));
    if (mrCross) {
      var bC = mrCross[1];
      var c1C = parseInt(mrCross[2], 10), v1C = parseInt(mrCross[3], 10);
      var c2C = parseInt(mrCross[5], 10), v2C = parseInt(mrCross[6], 10);
      var m1C = mrCross[4] || '', m2C = mrCross[7] || '';
      if (!isNaN(c1C) && !isNaN(v1C) && !isNaN(c2C) && !isNaN(v2C)
          && (c2C > c1C || (c2C === c1C && v2C >= v1C))) {
        var _rank = { '': 0, '上': 1, '中': 2, '下': 3 };
        var _keyReC = new RegExp('^' + bC + '(\\d+):(\\d+)([上中下]?)$');
        var arrC = Object.keys(bibleDict || {})
          .filter(function (k) {
            if (k.slice(-2) === ':0') return false;
            var m = k.match(_keyReC);
            if (!m) return false;
            var kc = parseInt(m[1], 10), kv = parseInt(m[2], 10);
            if (kc < c1C || kc > c2C) return false;
            if (kc === c1C && kv < v1C) return false;
            if (kc === c2C && kv > v2C) return false;
            return true;
          });
        // 起点半节修饰：过滤边界前的半节（如「一2下」排除 创1:2上）
        // 仅当边界节存在满足条件的键时才过滤，避免未分半的整节被整段丢弃
        if (m1C) {
          var _startKept = arrC.filter(function (k) {
            var m = k.match(_keyReC);
            return parseInt(m[1], 10) === c1C && parseInt(m[2], 10) === v1C
              && (_rank[m[3] || ''] || 0) >= (_rank[m1C] || 0);
          });
          if (_startKept.length) {
            arrC = arrC.filter(function (k) {
              var m = k.match(_keyReC);
              return !(parseInt(m[1], 10) === c1C && parseInt(m[2], 10) === v1C
                && (_rank[m[3] || ''] || 0) < (_rank[m1C] || 0));
            });
          }
        }
        // 终点半节修饰：过滤边界后的半节（如「十一43上」排除 创11:43下）
        if (m2C) {
          var _endKept = arrC.filter(function (k) {
            var m = k.match(_keyReC);
            return parseInt(m[1], 10) === c2C && parseInt(m[2], 10) === v2C
              && (_rank[m[3] || ''] || 0) <= (_rank[m2C] || 0);
          });
          if (_endKept.length) {
            arrC = arrC.filter(function (k) {
              var m = k.match(_keyReC);
              return !(parseInt(m[1], 10) === c2C && parseInt(m[2], 10) === v2C
                && (_rank[m[3] || ''] || 0) > (_rank[m2C] || 0));
            });
          }
        }
        arrC.sort(function (a, b) {
          var ma = a.match(_keyReC);
          var mb = b.match(_keyReC);
          var ca = parseInt(ma[1], 10), va = parseInt(ma[2], 10), sa = ma[3] || '';
          var cb = parseInt(mb[1], 10), vb = parseInt(mb[2], 10), sb = mb[3] || '';
          if (ca !== cb) return ca - cb;
          if (va !== vb) return va - vb;
          return (_rank[sa] || 0) - (_rank[sb] || 0);
        });
        if (arrC.length) return arrC;
      }
      return [bC + c1C + ':' + v1C, bC + c2C + ':' + v2C];
    }

    /* 标题专属引用（:0T）：只显示标题文字，不展开整章 */
    if (nr.slice(-3) === ':0T') {
      return [nr];
    }
    if (nr.slice(-2) === ':0') {
      var prefix = nr.slice(0, -1); /* e.g. "诗133:" */
      var chKeys = Object.keys(bibleDict || {})
        .filter(function (k) { return k.indexOf(prefix) === 0 && k.slice(-2) !== ':0'; })
        .sort(function (a, b) {
          var av = parseInt((a.split(':')[1] || '').replace(/[上中下]/g, ''), 10);
          var bv = parseInt((b.split(':')[1] || '').replace(/[上中下]/g, ''), 10);
          return av - bv;
        });
      // 若该章有标题（":0" 条目有内容），置于列表首位
      if ((bibleDict || {})[nr]) chKeys.unshift(nr);
      return chKeys.length ? chKeys : [nr];
    }

/* 章级范围：同书 士6-士8 / 跨书 撒上16-撒下24（整章范围串珠）
     * 展开为范围内所有已收录经节（整章语义） */
    var mrChap = nr.match(new RegExp('^(' + REF_BOOK_RE + ')(\\d+)-(' + REF_BOOK_RE + ')(\\d+)$'));
    if (mrChap) {
      var b1C = mrChap[1], c1C = parseInt(mrChap[2], 10);
      var b2C = mrChap[3], c2C = parseInt(mrChap[4], 10);
      if (!isNaN(c1C) && !isNaN(c2C)) {
        var _rankC = { '': 0, '上': 1, '中': 2, '下': 3 };
        var _chapKeyRe = new RegExp('^(' + REF_BOOK_RE + ')(\\d+):(\\d+)([上中下]?)$');
        var allKeysC = Object.keys(bibleDict || {});

        /* 同书章范围：士6-士8 → 士6 全章 .. 士8 全章 */
        if (b1C === b2C) {
          var arrChap = allKeysC
            .filter(function (k) {
              if (k.slice(-2) === ':0') return false;
              var m = k.match(_chapKeyRe);
              if (!m) return false;
              var kc = parseInt(m[2], 10);
              return m[1] === b1C && kc >= c1C && kc <= c2C;
            })
            .sort(function (a, b) {
              var ma = a.match(_chapKeyRe), mb = b.match(_chapKeyRe);
              var ca = parseInt(ma[2], 10), va = parseInt(ma[3], 10), sa = ma[4] || '';
              var cb = parseInt(mb[2], 10), vb = parseInt(mb[3], 10), sb = mb[4] || '';
              if (ca !== cb) return ca - cb;
              if (va !== vb) return va - vb;
              return (_rankC[sa] || 0) - (_rankC[sb] || 0);
            });
          return arrChap.length ? arrChap : [b1C + c1C + ':0', b1C + c2C + ':0'];
        }

        /* 跨书章范围：撒上16-撒下24 → 按对象键插入序（书卷顺序）取 b1C..b2C 区间 */
        var startIdx = -1, endIdx = -1;
        allKeysC.forEach(function (k, _i) {
          if (k.slice(-2) === ':0') return;
          var m = k.match(_chapKeyRe);
          if (!m) return;
          if (m[1] === b1C && startIdx === -1) startIdx = _i;
          if (m[1] === b2C) endIdx = _i; /* 持续更新到终点书最后一个键 */
        });
        if (startIdx !== -1 && endIdx !== -1 && startIdx <= endIdx) {
          var arrCrossC = allKeysC.slice(startIdx, endIdx + 1)
            .filter(function (k) {
              var m = k.match(_chapKeyRe);
              if (!m || k.slice(-2) === ':0') return false;
              var kc = parseInt(m[2], 10);
              if (m[1] === b1C) return kc >= c1C;
              if (m[1] === b2C) return kc <= c2C;
              return true;
            });
          if (arrCrossC.length) return arrCrossC;
        }
        return [b1C + c1C + ':0', b2C + c2C + ':0'];
      }
    }

    var mr = nr.match(new RegExp('^(' + REF_BOOK_RE + ')(\\d+):(\\d+)-(\\d+)([上中下]?)$'));
    if (mr) {
      var book = mr[1], ch = parseInt(mr[2], 10), v1 = parseInt(mr[3], 10), v2 = parseInt(mr[4], 10);
      var sfx = mr[5] || '';
      if (!isNaN(ch) && !isNaN(v1) && !isNaN(v2) && v2 >= v1) {
        var arr = [];
        for (var i = v1; i < v2; i++) arr.push(book + ch + ':' + i);
        if (!sfx) {
          arr.push(book + ch + ':' + v2);
        } else {
          /* 末节带半节修饰（如「腓1:19-21上」）：末节只取到该半节为止；
             该节若未分半（只有整节键），退回整节，避免「未收录」 */
          var _rk = { '': 0, '上': 1, '中': 2, '下': 3 };
          var _eRe = new RegExp('^' + book + ch + ':' + v2 + '([上中下]?)$');
          var endKeys = Object.keys(bibleDict || {}).filter(function (k) {
            var m = k.match(_eRe);
            return m && (_rk[m[1] || ''] || 0) <= (_rk[sfx] || 0);
          }).sort(function (a, b) {
            var ma = a.match(_eRe), mb = b.match(_eRe);
            return (_rk[ma[1] || ''] || 0) - (_rk[mb[1] || ''] || 0);
          });
          arr = arr.concat(endKeys.length ? endKeys : [book + ch + ':' + v2]);
        }
        return arr;
      }
    }

    return [nr];
  }

  /* ── 结构化区间检索（对齐权威 App 的「书/章/节」三元组模型）──────────
     refs[].x / bead.xr 为 [b1,c1,v1,u1,b2,c2,v2,u2] 整型区间：
       v=0 表示章边界（起点=章首，终点=章末）
       u=0 不限、1 上、2 下（沿用 content.flag）
     位置键 = book*1e6 + chapter*1e3 + verse，整章/跨章/跨卷由同一段比较覆盖。 */

  /* ── 按语言的数据集 ───────────────────────────────
     弹窗内容（注解/串珠/经文）按点击标记所在的语言行路由：
     简体主版本从 data/bible/，繁体从 data/bible/zh-hant-rcv/。
     window.CX_* 全局变量保留为简体主版本，供其它模块（读经计划/搜索等）继续使用。 */
  var _langDatasets = {};   /* lang -> {text,notes,xrefs,noteRefs,xrefRefs,noteRanges,xrefRanges,notePointers,xrefPointers,bookIndex} */
  var _langReady = {};      /* lang -> bool */
  var _langLoading = {};    /* lang -> bool */
  var _langCbs = {};        /* lang -> [cb] */
  var _popupLang = 'zh-rcv';/* 当前弹窗语言（由触发元素所在语言行决定） */

  function resolveLangFromEl(el) {
    var node = el;
    while (node && node !== document) {
      if (node.classList && node.classList.contains('bible-verse-lang')
          && node.dataset && node.dataset.lang) {
        return node.dataset.lang;
      }
      node = node.parentNode;
    }
    return 'zh-rcv';
  }

  /* 当前弹窗语言的数据集（未加载/缺失时回退简体主版本） */
  function _ds() {
    return _langDatasets[_popupLang] || _langDatasets['zh-rcv']
      || { text: window.CX_SCRIPTURES_DATA || null, notes: window.CX_BIBLE_NOTES || null,
           xrefs: window.CX_BIBLE_XREFS || null, noteRefs: window.CX_BIBLE_NOTE_REFS || null,
           xrefRefs: window.CX_BIBLE_XREF_REFS || null, noteRanges: window.CX_BIBLE_NOTE_RANGES || null,
           xrefRanges: window.CX_BIBLE_XREF_RANGES || null, notePointers: window.CX_BIBLE_NOTE_POINTERS || null,
           xrefPointers: window.CX_BIBLE_XREF_POINTERS || null, bookIndex: window.CX_BOOK_INDEX || null };
  }

  function ensureLangDataset(lang, cb) {
    if (!lang || lang === 'zh-rcv') { ensureBibleText(cb); return; }
    if (_langReady[lang]) { cb(); return; }
    if (!_langCbs[lang]) _langCbs[lang] = [];
    _langCbs[lang].push(cb);
    if (_langLoading[lang]) return;
    _langLoading[lang] = true;
    var shardDir = getRootPath() + 'data/bible/' + lang + '/';
    loadFromShards(function (result) {
      _langDatasets[lang] = result || {};
      _langReady[lang] = true;
      _langLoading[lang] = false;
      var cbs = _langCbs[lang]; _langCbs[lang] = [];
      cbs.forEach(function (f) { f(); });
    }, shardDir);
  }

  var _verseIndexes = {};

  function _unitRank(u) {
    if (u === 1) return 1;   /* 上 */
    if (u === 3) return 2;   /* 中 */
    if (u === 2) return 3;   /* 下 */
    return 0;                /* 整节 */
  }

  function _posKey(b, c, v) {
    return b * 1000000 + c * 1000 + (v || 0);
  }

  function buildVerseIndex() {
    if (_verseIndexes[_popupLang]) return _verseIndexes[_popupLang];
    var dict = _ds().text || {};
    var map = _ds().bookIndex || {};
    var list = [];
    Object.keys(dict).forEach(function (k) {
      var m = /^([^\d:]+)(\d+):(\d+)([上中下]?)$/.exec(k);
      if (!m) return;
      var bi = map[m[1]];
      if (!bi) return;
      var u = m[4] === '上' ? 1 : (m[4] === '下' ? 2 : (m[4] === '中' ? 3 : 0));
      list.push({ k: k, p: _posKey(bi, parseInt(m[2], 10), parseInt(m[3], 10)), u: u, v: parseInt(m[3], 10) });
    });
    list.sort(function (a, b) { return a.p - b.p || a.u - b.u; });
    _verseIndexes[_popupLang] = list;
    return list;
  }

  /* 变长区间解码：字符串 "b,c;b,c,v;b,c,v1,b2,c2,v2" → 区间对象
       [b,c] 仅章标题（诗篇篇题）
       [b,c,v] 单节 · [b,c,v,u] 单节+半节
       [b,c,v1,b2,c2,v2] 区间 · [b1,c1,v1,u1,b2,c2,v2,u2] 带半节的区间 */
  function _decodeRange(r) {
    var n = Array.isArray(r) ? r : String(r || '').split(',').map(Number);
    if (!n.length || isNaN(n[0])) return null;
    if (n.length === 2) {
      return { b1: n[0], c1: n[1], v1: 0, u1: 0, b2: n[0], c2: n[1], v2: 0, u2: 0, titleOnly: true };
    }
    if (n.length === 3) {
      return { b1: n[0], c1: n[1], v1: n[2], u1: 0, b2: n[0], c2: n[1], v2: n[2], u2: 0 };
    }
    if (n.length === 4) {
      return { b1: n[0], c1: n[1], v1: n[2], u1: n[3], b2: n[0], c2: n[1], v2: n[2], u2: n[3] };
    }
    if (n.length === 6) {
      return { b1: n[0], c1: n[1], v1: n[2], u1: 0, b2: n[3], c2: n[4], v2: n[5], u2: 0 };
    }
    if (n.length === 8) {
      return { b1: n[0], c1: n[1], v1: n[2], u1: n[3], b2: n[4], c2: n[5], v2: n[6], u2: n[7] };
    }
    return null;
  }

  /* 解析 data-x / x / xr：支持紧凑字符串（区间用 ; 分隔）与数组 */
  function parseRanges(raw) {
    if (!raw) return null;
    var parts;
    if (Array.isArray(raw)) parts = raw;
    else parts = String(raw).split(';');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '' || parts[i] === null) continue;
      out.push(parts[i]);
    }
    return out.length ? out : null;
  }

  /* 解析注解指针：字符串 "b,c,v,num,para;..."（或数组） */
  function parseNotes(raw) {
    if (!raw) return null;
    var parts = Array.isArray(raw) ? raw : String(raw).split(';');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      out.push(parts[i]);
    }
    return out.length ? out : null;
  }

  /* 书号 → 缩写（由当前语言数据集的 bookIndex 反推，简繁各自缓存） */
  var _acrByBookLang = {};
  function bookAcr(b) {
    var cache = (_acrByBookLang[_popupLang] = _acrByBookLang[_popupLang] || {});
    if (!cache._built) {
      var map = _ds().bookIndex || {};
      Object.keys(map).forEach(function (acr) { cache[map[acr]] = acr; });
      cache._built = true;
    }
    return cache[b] || '';
  }

  /* 渲染注解指针（把被引注解的正文接在经文列表之后） */
  function renderNotePointers(notes) {
    notes = parseNotes(notes);
    if (!notes) return '';
    var html = '';
    notes.forEach(function (item) {
      var n = String(item).split(',').map(Number);
      if (n.length < 4) return;
      var key = bookAcr(n[0]) + n[1] + ':' + n[2];
      var num = n[3];
      var ds = _ds();
      var text = ((ds.notes || {})[key] || [])[num - 1];
      var label = key + ' 注' + num;
      if (!text) {
        html += '<div class="scripture-popup-verse scripture-popup-verse--missing" data-vkey="'
          + esc(key) + '"><span class="scripture-popup-ref">' + esc(label)
          + '</span><span class="scripture-popup-text">（未找到注解）</span></div>';
        return;
      }
      var spans = ((ds.noteRefs || {})[key] || {})[String(num)] || null;
      html += '<div class="scripture-popup-verse scripture-popup-verse--note" data-vkey="'
        + esc(key) + '"><span class="scripture-popup-ref">' + esc(label)
        + '</span><span class="scripture-popup-text">' + renderNoteText(text, key, spans)
        + '</span></div>';
    });
    return html;
  }

  /* 把整型区间展开成经文键数组（如 ['腓1:19','腓1:20','腓1:21上']） */
  function expandRanges(ranges) {
    ranges = parseRanges(ranges);
    if (!ranges || !ranges.length) return [];
    var idx = buildVerseIndex();
    if (!idx.length) return [];

    function lowerBound(p) {
      var lo = 0, hi = idx.length;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (idx[mid].p < p) lo = mid + 1; else hi = mid;
      }
      return lo;
    }
    function upperBound(p) {
      var lo = 0, hi = idx.length;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (idx[mid].p <= p) lo = mid + 1; else hi = mid;
      }
      return lo;
    }

    var out = [], seen = {};
    ranges.forEach(function (r) {
      var f = _decodeRange(r);
      if (!f) return;
      var v1 = f.v1, u1 = f.u1, v2 = f.v2, u2 = f.u2;
      var lo = _posKey(f.b1, f.c1, v1 || 0);
      var hi = _posKey(f.b2, f.c2, v2 || 999);
      if (hi < lo) return;
      var start = lowerBound(lo), end = upperBound(hi);
      var picked = [];
      for (var i = start; i < end; i++) {
        var it = idx[i];
        /* :0 是诗篇篇题行：「标题」引用只取它；普通区间与正版的
           BETWEEN 起点=第1节 一致——不带起始章的篇题，区间中途各篇的篇题照常列出 */
        if (f.titleOnly ? it.v !== 0 : (it.v === 0 && it.p === lo)) continue;
        picked.push(it);
      }

      /* 起点/终点半节修饰：仅当该节确实存在更靠后的半节行时才裁剪，
         否则（该节未分上/下）保留整节，避免"未收录" */
      if (v1 && u1) {
        var has1 = picked.some(function (it) {
          return it.p === lo && _unitRank(it.u) >= _unitRank(u1);
        });
        if (has1) {
          picked = picked.filter(function (it) {
            return !(it.p === lo && _unitRank(it.u) < _unitRank(u1));
          });
        }
      }
      if (v2 && u2) {
        var has2 = picked.some(function (it) {
          return it.p === hi && _unitRank(it.u) <= _unitRank(u2);
        });
        if (has2) {
          picked = picked.filter(function (it) {
            return !(it.p === hi && _unitRank(it.u) > _unitRank(u2));
          });
        }
      }

      picked.forEach(function (it) {
        if (!seen[it.k]) { seen[it.k] = 1; out.push(it.k); }
      });
    });
    return out.length ? out : null;   /* null → 调用方回退到引用串展开 */
  }

  /* ── 根路径 ── */
  function getRootPath() {
    return (window.CX && window.CX_ROOT) ? window.CX_ROOT : '../';
  }

  /* ── 懒加载 JSON ── */
  function loadJSON(url, onDone) {
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(onDone)
      .catch(function () { onDone(null); }); /* 加载失败也继续 */
  }

  var _loadingText  = false, _cbText  = [];
  var _bibleLoaded = false;          /* 分片数据是否已加载 */

  function ensureBibleText(cb) {
    /* 全部就绪：bible 已加载 */
    if (_bibleLoaded) { cb(); return; }
    _cbText.push(cb);
    if (_loadingText) return;
    _loadingText = true;

    /* bible 尚未加载：优先尝试分片 JSON，回退全量 JSON */
    var bibleData = null;
    function allDone() {
      if (bibleData) {
        window.CX_BIBLE_TEXT_DATA = bibleData;  /* 保留全本圣经独立引用，供整章展开使用 */
        window.CX_SCRIPTURES_DATA = Object.assign({}, bibleData);
      }
      _bibleLoaded = true;
      _loadingText = false;
      window.CX_BIBLE_TEXT_READY = 1;
      /* 简体主版本数据集注册（供弹窗按语言路由） */
      _langDatasets['zh-rcv'] = {
        text: window.CX_SCRIPTURES_DATA || null,
        notes: window.CX_BIBLE_NOTES || null,
        xrefs: window.CX_BIBLE_XREFS || null,
        noteRefs: window.CX_BIBLE_NOTE_REFS || null,
        xrefRefs: window.CX_BIBLE_XREF_REFS || null,
        noteRanges: window.CX_BIBLE_NOTE_RANGES || null,
        xrefRanges: window.CX_BIBLE_XREF_RANGES || null,
        notePointers: window.CX_BIBLE_NOTE_POINTERS || null,
        xrefPointers: window.CX_BIBLE_XREF_POINTERS || null,
        bookIndex: window.CX_BOOK_INDEX || null
      };
      _langReady['zh-rcv'] = true;
      var cbs = _cbText.slice(); _cbText = [];
      cbs.forEach(function (f) { f(); });
    }

    // 直接从分片加载（不再依赖 bible-text.json）
    loadFromShards(function(result) {
      bibleData = result ? result.text : null;
      // 同时填充注解和串珠数据
      if (result && result.notes) {
        window.CX_BIBLE_NOTES = result.notes;
        window.CX_BIBLE_NOTES_READY = 1;
      }
      if (result && result.xrefs) {
        window.CX_BIBLE_XREFS = result.xrefs;
        window.CX_BIBLE_XREFS_READY = 1;
      }
      if (result && result.noteRefs) {
        window.CX_BIBLE_NOTE_REFS = result.noteRefs;
      }
      if (result && result.xrefRefs) {
        window.CX_BIBLE_XREF_REFS = result.xrefRefs;
      }
      if (result && result.noteRanges) {
        window.CX_BIBLE_NOTE_RANGES = result.noteRanges;
      }
      if (result && result.xrefRanges) {
        window.CX_BIBLE_XREF_RANGES = result.xrefRanges;
      }
      if (result && result.notePointers) {
        window.CX_BIBLE_NOTE_POINTERS = result.notePointers;
      }
      if (result && result.xrefPointers) {
        window.CX_BIBLE_XREF_POINTERS = result.xrefPointers;
      }
      if (result && result.bookIndex) {
        window.CX_BOOK_INDEX = result.bookIndex;
      }
      _verseIndexes = {};   /* 数据变化后重建各语言位置索引 */
      allDone();
    });
  }

  /* 从分片 JSON 加载（data/bible/01.json ~ 66.json），同时提取经文/注解/串珠
     shardDirOverride：次主版本（如繁体）复用同一管线，指向 data/bible/{lang}/ */
  function loadFromShards(onShardDone, shardDirOverride) {
    var shardDir = shardDirOverride || (getRootPath() + 'data/bible/');
    var merged = {};
    var mergedNotes = {};
    var mergedXrefs = {};
    var mergedNoteRefs = {};
    var mergedXrefRefs = {};
    var mergedNoteRanges = {};
    var mergedXrefRanges = {};
    var mergedNotePointers = {};
    var mergedXrefPointers = {};
    var bookIndexByAcr = {};

    function loadNext(idx) {
      if (idx > 66) {
        onShardDone({
          text: Object.keys(merged).length ? merged : null,
          notes: Object.keys(mergedNotes).length ? mergedNotes : null,
          xrefs: Object.keys(mergedXrefs).length ? mergedXrefs : null,
          noteRefs: Object.keys(mergedNoteRefs).length ? mergedNoteRefs : null,
          xrefRefs: Object.keys(mergedXrefRefs).length ? mergedXrefRefs : null,
          noteRanges: Object.keys(mergedNoteRanges).length ? mergedNoteRanges : null,
          xrefRanges: Object.keys(mergedXrefRanges).length ? mergedXrefRanges : null,
          notePointers: Object.keys(mergedNotePointers).length ? mergedNotePointers : null,
          xrefPointers: Object.keys(mergedXrefPointers).length ? mergedXrefPointers : null,
          bookIndex: Object.keys(bookIndexByAcr).length ? bookIndexByAcr : null
        });
        return;
      }
      var num = String(idx).padStart(2, '0');
      fetch(shardDir + num + '.json')
        .then(function(r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function(bookData) {
          if (bookData && bookData.chapters) {
            var acr = bookData.book_acronym || '';
            if (bookData.book_index) bookIndexByAcr[acr] = bookData.book_index;
            bookData.chapters.forEach(function(ch) {
              (ch.verses || []).forEach(function(v) {
                var suffix = '';
                if (v.flag === 1) suffix = '上';
                else if (v.flag === 2) suffix = '下';
                else if (v.flag === 3) suffix = '中';
                var key = acr + ch.chapter + ':' + v.section + suffix;
                merged[key] = v.content || '';

                // 提取注解
                if (v.footnotes && v.footnotes.length) {
                  var baseKey = acr + ch.chapter + ':' + v.section;
                  var noteArr = [];
                  v.footnotes.forEach(function(fn) {
                    noteArr[fn.seq - 1] = fn.note || '';
                    /* 导出期预解析的引经区间（footnote_link 注入） */
                    if (fn.refs && fn.refs.length) {
                      (mergedNoteRefs[baseKey] || (mergedNoteRefs[baseKey] = {}))[fn.seq] = fn.refs;
                      var _rx = [];
                      var _rn = [];
                      fn.refs.forEach(function (rr) {
                        if (rr.x) _rx.push(String(rr.x));
                        if (rr.n) _rn.push(String(rr.n));
                      });
                      if (_rx.length) {
                        (mergedNoteRanges[baseKey] || (mergedNoteRanges[baseKey] = {}))[fn.seq] = _rx.join(';');
                      }
                      if (_rn.length) {
                        (mergedNotePointers[baseKey] || (mergedNotePointers[baseKey] = {}))[fn.seq] = _rn.join(';');
                      }
                    }
                  });
                  mergedNotes[baseKey] = noteArr;
                }

                // 提取串珠
                if (v.beads && v.beads.length) {
                  var baseKey2 = acr + ch.chapter + ':' + v.section;
                  var xrefMap = mergedXrefs[baseKey2] || {};
                  v.beads.forEach(function(bd) {
                    xrefMap[bd.seq] = bd.bead || '';
                    if (bd.xrefs) {
                      (mergedXrefRefs[baseKey2] || (mergedXrefRefs[baseKey2] = {}))[bd.seq] = bd.xrefs;
                    }
                    if (bd.xr) {
                      (mergedXrefRanges[baseKey2] || (mergedXrefRanges[baseKey2] = {}))[bd.seq] = String(bd.xr);
                    }
                    if (bd.nr) {
                      (mergedXrefPointers[baseKey2] || (mergedXrefPointers[baseKey2] = {}))[bd.seq] = String(bd.nr);
                    }
                  });
                  mergedXrefs[baseKey2] = xrefMap;
                }
              });
            });
          }
          loadNext(idx + 1);
        })
        .catch(function() { loadNext(idx + 1); });
    }
    loadNext(1);
  }


  /* ensureBibleNotes / ensureBibleXrefs：已合并到 ensureBibleText 中，
   * 注解和串珠数据随分片加载一起提取，无需单独加载全局 JSON */
  function ensureBibleNotes(cb) {
    if (window.CX_BIBLE_NOTES_READY) { cb(); return; }
    ensureBibleText(cb); /* 触发分片加载，完成后 CX_BIBLE_NOTES 会自动填充 */
  }

  function ensureBibleXrefs(cb) {
    if (window.CX_BIBLE_XREFS_READY) { cb(); return; }
    ensureBibleText(cb); /* 触发分片加载，完成后 CX_BIBLE_XREFS 会自动填充 */
  }

  /* ═══════════════════════════ DOM 结构（复用 cx-dialog-mask / cx-dialog 体系）═══════════════════════════ */
  function createModal() {
    var overlay = document.createElement('div');
    overlay.id = 'scripture-popup-overlay';
    overlay.className = 'cx-dialog-mask scripture-popup-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    var box = document.createElement('div');
    box.className = 'cx-dialog scripture-popup';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    var header = document.createElement('div');
    header.className = 'scripture-popup-header';

    var backBtn = document.createElement('button');
    backBtn.className = 'scripture-popup-back';
    backBtn.setAttribute('aria-label', '返回');
    backBtn.innerHTML = '&#9664;';
    backBtn.style.display = 'none';
    backBtn.addEventListener('click', navBack);

    var title = document.createElement('span');
    title.className = 'scripture-popup-title';
    title.id = 'scripture-popup-title';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'scripture-popup-close';
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.innerHTML = '&#10005;';
    closeBtn.addEventListener('click', closeModal);

    header.appendChild(backBtn);
    header.appendChild(title);
    header.appendChild(closeBtn);

    var body = document.createElement('div');
    body.className = 'scripture-popup-body';
    body.id = 'scripture-popup-body';

    box.appendChild(header);
    box.appendChild(body);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    var _popupLastTap = 0;

    /* 点遮罩空白：内部有导航层则 history.back()（让 backStack 回退一帧），否则直接关闭弹框 */
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        e.preventDefault(); e.stopPropagation();
        var now = Date.now();
        if (now - _popupLastTap < 350) return;
        _popupLastTap = now;
        if (navStack.length > 1) {
          try { history.back(); } catch(err) {}
        } else {
          closeModal();
        }
      }
    });

    /* 防滚动穿透 + 触摸点遮罩关闭（同上逻辑：有内部层 → history.back，否则 → closeModal） */
    window.CX.lockOverlayScroll(overlay, function() {
      var now = Date.now();
      if (now - _popupLastTap < 350) return;
      _popupLastTap = now;
      if (navStack.length > 1) {
        try { history.back(); } catch(err) {}
      } else {
        closeModal();
      }
    });

    return { overlay: overlay, title: title, body: body, backBtn: backBtn };
  }

  var modal = null;
  function getModal() {
    if (!modal) modal = createModal();
    return modal;
  }

  /* ═══════════════════════════ 导航栈 ═══════════════════════════ */
  var navStack = [];
  // 每层 navPush 对应 1 条 backStack 记录，用数组保存所有函数引用
  // 避免 _lastNavBackFn 单变量被覆盖导致前 N-1 个引用丢失
  var _navBackStackFns = [];

  /* ── makeScriptureStep: 弹 1 层，每层 navPush 各自对应 1 条 backStack 记录 ── */
  function makeScriptureStep() {
    return function step() {
      if (navStack.length > 1) {
        /* 还有上层 → 回退一帧（本条 backStack 记录已消耗，不再 re-push）*/
        navStack.pop();
        renderFrame(navStack[navStack.length - 1]);
      } else {
        /* 最顶层 → 关闭弹框 */
        navStack = [];
        if (modal) {
          modal.overlay.classList.remove('scripture-popup-overlay--open');
          modal.overlay.setAttribute('aria-hidden', 'true');
        }
      }
    };
  }

  /* navPush: 每层都向 backStack 注册 1 条关闭回调 */
  function navPush(frame) {
    /* 保存当前帧的滚动位置，供返回时恢复 */
    if (navStack.length > 0 && modal) {
      navStack[navStack.length - 1]._scrollTop = modal.body.scrollTop;
    }
    navStack.push(frame);
    renderFrame(frame);
    var fn = makeScriptureStep();
    _navBackStackFns.push(fn);
    window.CX.backStack.push(fn);
  }

  /* navBack（← 按钮）: 弹 1 层 + 静默移除对应的 backStack 记录 */
  function navBack() {
    if (navStack.length <= 1) { closeModal(); return; }
    navStack.pop();
    renderFrame(navStack[navStack.length - 1]);
    // 静默移除最近一个 backStack 条目，避免 history.back() 与路由竞态
    var fn = _navBackStackFns.length > 0 ? _navBackStackFns.pop() : null;
    if (fn && window.CX.backStack.remove) {
      window.CX.backStack.remove(fn);
    } else {
      window.CX.backStack.pop();
    }
  }

  /* ═══════════════════════════ 渲染经文帧 ═══════════════════════════ */
  /*
   * frame = { type:'verses', refs:'创1:1,创1:2', label:'...' }
   *       | { type:'footnote', verseKey:'创1:1', num:'1' }
   *       | { type:'xrefs', verseKey:'创1:1', letter:'a' }
   */
  function renderFrame(frame) {
    var m = getModal();
    m.backBtn.style.display = navStack.length > 1 ? '' : 'none';

    if (frame.type === 'verses') {
      m.title.textContent = frame.label || (frame.refs || '').replace(/,/g, '、');
      var renderVersesFn = function () {
        /* 数据已缓存（预加载），直接渲染，避免 loading→内容 双重 innerHTML 导致闪屏 */
        m.body.innerHTML = renderVerseList(frame.refs, frame.verseKey || '', frame.ranges, frame.notes);
        m.body.scrollTop = frame._scrollTop || 0;
      };
      if (_langReady[_popupLang] || (_popupLang === 'zh-rcv' && window.CX_BIBLE_TEXT_READY)) {
        renderVersesFn();
      } else {
        m.body.innerHTML = '<div class="scripture-popup-loading">加载中…</div>';
        ensureLangDataset(_popupLang, renderVersesFn);
      }
    } else if (frame.type === 'footnote') {
      m.title.textContent = frame.verseKey + ' 注' + frame.num;
      var renderFn = function () {
        var noteArr = (_ds().notes || {})[baseKey(frame.verseKey)] || [];
        var text = noteArr[parseInt(frame.num, 10) - 1] || '（未找到注解）';
        m.body.innerHTML = renderFootnoteBody(text, frame.verseKey, frame.num);
        bindCopyButton(m.body, text);
        m.body.scrollTop = frame._scrollTop || 0;
      };
      if (_langReady[_popupLang] || (_popupLang === 'zh-rcv' && window.CX_BIBLE_NOTES_READY)) {
        renderFn();
      } else {
        m.body.innerHTML = '<div class="scripture-popup-loading">加载中…</div>';
        ensureLangDataset(_popupLang, renderFn);
      }
    } else if (frame.type === 'xrefs') {
      m.title.textContent = frame.verseKey + ' 串' + frame.letter;
      var renderXrefsFn = function () {
        var ds = _ds();
        var xrefMap = (ds.xrefs || {})[baseKey(frame.verseKey)] || {};
        var _xr = (ds.xrefRefs || {})[baseKey(frame.verseKey)] || {};
        var _xrr = (ds.xrefRanges || {})[baseKey(frame.verseKey)] || {};
        var _xrn = (ds.xrefPointers || {})[baseKey(frame.verseKey)] || {};
        var refs = _xr[frame.letter] || xrefMap[frame.letter] || '';
        var refRanges = _xrr[frame.letter] || null;
        var refNotes = _xrn[frame.letter] || null;
        if (refs || refRanges || refNotes) {
          m.body.innerHTML = renderVerseList(refs, frame.verseKey || '', refRanges, refNotes);
          m.body.scrollTop = frame._scrollTop || 0;
        } else {
          m.body.innerHTML = '<div class="scripture-popup-empty">（未找到串珠）</div>';
          m.body.scrollTop = 0;
        }
      };
      if (_langReady[_popupLang] || (_popupLang === 'zh-rcv' && window.CX_BIBLE_XREFS_READY && window.CX_BIBLE_TEXT_READY)) {
        renderXrefsFn();
      } else {
        m.body.innerHTML = '<div class="scripture-popup-loading">加载中…</div>';
        ensureLangDataset(_popupLang, renderXrefsFn);
      }
    }
  }

  /* 渲染注解内容 + 复制按钮 */
  function renderFootnoteBody(text, verseKey, num) {
    var noteRefs = null;
    if (num !== undefined && num !== null) {
      var m = (_ds().noteRefs || {})[baseKey(verseKey)];
      if (m) noteRefs = m[String(num)] || m[parseInt(num, 10)] || null;
    }
    return '<div class="scripture-popup-fn-body">' + renderNoteText(text, verseKey, noteRefs) + '</div>'
      + '<button class="scripture-popup-copy-btn" data-copy-text="' + esc(text) + '">复制注解</button>';
  }

  /* 绑定复制按钮事件 */
  function bindCopyButton(container, text) {
    var btn = container.querySelector('.scripture-popup-copy-btn');
    if (!btn) return;
    btn.addEventListener('click', function() {
      var raw = btn.getAttribute('data-copy-text') || text;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(raw).then(function() {
          btn.textContent = '已复制';
          setTimeout(function() { btn.textContent = '复制注解'; }, 1500);
        });
      } else {
        var ta = document.createElement('textarea');
        ta.value = raw;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        btn.textContent = '已复制';
        setTimeout(function() { btn.textContent = '复制注解'; }, 1500);
      }
    });
  }

  /* 剥除上/下后缀，得到完整节键（用于查找注解/串珠） */
  function baseKey(ref) {
    return ref.replace(/[上中下]$/, '');
  }

  /* 渲染经文列表（支持 {N} → fn-ref, [a] → xref-ref）；
     经文/注解指针取自当前弹窗语言的数据集（简体/繁体） */
  function renderVerseList(refs, contextRef, ranges, notes) {
    var dict = _ds().text || {};
    var bibleDict = dict;
    var contextBook = getBookFromRef(contextRef || '');
    /* 优先用结构化区间检索；区间不可用/为空时回退到引用串展开 */
    var refArr = (ranges && ranges.length) ? expandRanges(ranges) : null;
    if (!refArr || !refArr.length) {
      refArr = (refs && refs.trim()) ? parseAndExpandRefs(refs, bibleDict, contextBook) : [];
    }
    var noteHtml = renderNotePointers(notes);
    if (!refArr.length) {
      return noteHtml || '<div class="scripture-popup-empty">暂无经文</div>';
    }
    return refArr.map(function (ref) {
      ref = ref.trim();
      if (!ref) return '';
      var nr = normalizeRef(ref) || ref;
      var bk = baseKey(nr);               /* 去掉上/下，用于查注解/串珠 */
      /* 优先用半节文本，若无则退到完整节文本 */
      /* :0T = 标题专属引用，从 :0 键取内容，与普通经节同样渲染（支持注解/串珠） */
      if (nr.slice(-3) === ':0T') {
        var titleKey = nr.slice(0, -1); /* 诗22:0T → 诗22:0 */
        var titleLabel = titleKey.replace(/:0$/, ':标题'); /* 诗22:0 → 诗22:标题 */
        var titleRaw = dict[titleKey] || '';
        if (titleRaw) {
          return '<div class="scripture-popup-verse" data-vkey="' + esc(titleKey) + '">'
            + '<span class="scripture-popup-ref">' + esc(titleLabel) + '</span>'
            + '<span class="scripture-popup-text">' + renderVerseText(titleRaw, titleKey) + '</span>'
            + '</div>';
        }
        return '<div class="scripture-popup-verse scripture-popup-verse--missing">'
          + '<span class="scripture-popup-ref">' + esc(titleLabel) + '</span>'
          + '<span class="scripture-popup-text">（未收录标题）</span></div>';
      }
      var raw = dict[nr] || (bk !== nr ? dict[bk] : '');
      /* :0 整章引用首位标题行，同样用普通经节样式渲染 */
      if (raw && nr.slice(-2) === ':0') {
        var titleLabel0 = bk.replace(/:0$/, ':标题'); /* 诗22:0 → 诗22:标题 */
        return '<div class="scripture-popup-verse" data-vkey="' + esc(bk) + '">'
          + '<span class="scripture-popup-ref">' + esc(titleLabel0) + '</span>'
          + '<span class="scripture-popup-text">' + renderVerseText(raw, bk) + '</span>'
          + '</div>';
      }
      if (raw) {
        return '<div class="scripture-popup-verse" data-vkey="' + esc(bk) + '">'
          + '<span class="scripture-popup-ref">' + esc(ref) + '</span>'
          + '<span class="scripture-popup-text">' + renderVerseText(raw, bk) + '</span>'
          + '</div>';
      }
      /* 无精确匹配时，尝试上/中/下半节合并显示 */
      if (!/[上中下]$/.test(nr)) {
        var upRaw = dict[nr + '上'], midRaw = dict[nr + '中'], downRaw = dict[nr + '下'];
        if (upRaw || midRaw || downRaw) {
          var combined = '';
          if (upRaw) combined += '<div class="scripture-popup-verse" data-vkey="' + esc(bk) + '">'
            + '<span class="scripture-popup-ref">' + esc(ref + '上') + '</span>'
            + '<span class="scripture-popup-text">' + renderVerseText(upRaw, bk) + '</span></div>';
          if (midRaw) combined += '<div class="scripture-popup-verse" data-vkey="' + esc(bk) + '">'
            + '<span class="scripture-popup-ref">' + esc(ref + '中') + '</span>'
            + '<span class="scripture-popup-text">' + renderVerseText(midRaw, bk) + '</span></div>';
          if (downRaw) combined += '<div class="scripture-popup-verse" data-vkey="' + esc(bk) + '">'
            + '<span class="scripture-popup-ref">' + esc(ref + '下') + '</span>'
            + '<span class="scripture-popup-text">' + renderVerseText(downRaw, bk) + '</span></div>';
          return combined;
        }
      }
      return '<div class="scripture-popup-verse scripture-popup-verse--missing">'
        + '<span class="scripture-popup-ref">' + esc(ref) + '</span>'
        + '<span class="scripture-popup-text">（未收录）</span>'
        + '</div>';
    }).join('') + noteHtml;
  }

  /* 把 {N} 转为注脚上标，[a] 转为串珠上标 */
  function renderVerseText(raw, verseKey) {
    var text = esc(raw);
    /* {N} → fn-ref */
    text = text.replace(/\{(\d+)\}/g, function (_, n) {
      return '<sup class="fn-ref" data-vkey="' + esc(verseKey) + '" data-fn="' + n + '">' + n + '</sup>';
    });
    /* [a] → xref-ref */
    text = text.replace(/\[([a-z]+)\]/g, function (_, lr) {
      return '<sup class="xref-ref" data-vkey="' + esc(verseKey) + '" data-xr="' + lr + '">' + lr + '</sup>';
    });
    return text;
  }

  /* 用导出期预解析的区间（footnote_link）渲染注解：
     区间由权威数据给出，不再依赖运行时正则推断，边界精确、无散文误报。
     返回 null 表示数据不可用，调用方回退到 wrapRefs。 */
  function renderNoteWithSpans(text, spans) {
    if (!text || !spans || !spans.length) return null;
    var len = text.length;
    var list = [];
    spans.forEach(function (r) {
      if (!r || (!r.r && !r.x && !r.n)) return;   /* 纯注解指针的 span 没有 r */
      var s = parseInt(r.s, 10), e = parseInt(r.e, 10);
      if (isNaN(s) || isNaN(e)) return;
      if (s < 0 || e > len || e <= s) return;
      list.push({ s: s, e: e, r: String(r.r || ''), x: r.x || null, n: r.n || null });
    });
    if (!list.length) return null;
    list.sort(function (a, b) { return a.s - b.s; });
    /* 去掉重叠（保留靠前者），避免嵌套 span */
    var clean = [], lastEnd = -1;
    list.forEach(function (r) {
      if (r.s >= lastEnd) { clean.push(r); lastEnd = r.e; }
    });

    function renderRange(a, b) {
      var html = '', cur = a;
      clean.forEach(function (r) {
        if (r.e <= a || r.s >= b) return;
        var s = Math.max(r.s, a), e = Math.min(r.e, b);
        if (s > cur) html += esc(text.slice(cur, s)).replace(/\n/g, '<br>');
        html += '<span class="scripture-ref" data-refs="' + esc(r.r) + '"'
          + (r.x ? ' data-x="' + esc(String(r.x)) + '"' : '')
          + (r.n ? ' data-n="' + esc(String(r.n)) + '"' : '') + '>'
          + esc(text.slice(s, e)).replace(/\n/g, '<br>') + '</span>';
        cur = e;
      });
      if (cur < b) html += esc(text.slice(cur, b)).replace(/\n/g, '<br>');
      return html;
    }

    /* 按 ˍ 切段，保证与既有注解段落样式一致 */
    var paras = [], start = 0;
    while (true) {
      var k = text.indexOf('ˍ', start);
      if (k < 0) { paras.push([start, len]); break; }
      paras.push([start, k]);
      start = k + 1;
    }
    if (paras.length === 1) return renderRange(paras[0][0], paras[0][1]);
    return paras.map(function (p) {
      return '<p class="fn-para">' + renderRange(p[0], p[1]) + '</p>';
    }).join('');
  }

  /* 渲染注解文字（内嵌经文引用变为可点击，verseKey 提供书卷上下文） */
  /* ˍ（U+02CD）为注解源数据的分段标记，与 bible-renderer.js _renderFootnoteText 同语义；
     切分为 <p class="fn-para"> 段落而非 <br>，便于 CSS 控制段间距（wrapRefs 不跨 ˍ 包裹 span，split 安全） */
  function renderNoteText(text, verseKey, spans) {
    var bySpans = renderNoteWithSpans(text, spans);
    if (bySpans !== null) return bySpans;
    var html;
    /* 数据集带有正版可点区间时，区间之外（含整条没有区间的注解）一律是纯文本——
       与正版一致，不做运行时猜测；仅旧数据（无区间）才回退到 wrapRefs 推断 */
    if (_ds().noteRefs) {
      html = esc(text).replace(/\n/g, '<br>');
    } else if (window.CXRef && window.CXRef.wrapRefs) {
      html = window.CXRef.wrapRefs(text, verseKey || '', { lockBook: true })
        .replace(/\n/g, '<br>');
    } else {
      html = esc(text)
        .replace(
          INLINE_REF_RE,
          '<span class="verse-ref" data-refs="$1">$1</span>'
        )
        .replace(/\n/g, '<br>');
    }
    if (html.indexOf('ˍ') < 0) return html;
    return html.split('ˍ').map(function (p) {
      return '<p class="fn-para">' + p + '</p>';
    }).join('');
  }

  /* 确保弹框已打开（fn-ref/xref-ref 可能在弹框外点击）*/
  /* backStack push 由后续 navPush 完成，此处只负责打开 overlay */
  function ensureOpen() {
    var m = getModal();
    if (!m.overlay.classList.contains('scripture-popup-overlay--open')) {
      navStack = [];
      m.overlay.classList.add('scripture-popup-overlay--open');
      m.overlay.setAttribute('aria-hidden', 'false');
    }
  }

  /* 读取元素上的结构化区间（data-x 为紧凑字符串编码） */
  function readRanges(el) {
    if (!el || !el.dataset || !el.dataset.x) return null;
    return parseRanges(el.dataset.x);
  }

  /* 读取元素上的注解指针 */
  function readNotes(el) {
    if (!el || !el.dataset || !el.dataset.n) return null;
    return parseNotes(el.dataset.n);
  }

  /* ═══════════════════════════ 弹框开关 ═══════════════════════════ */
  function openModal(refs, labelText, ranges, notes) {
    var m = getModal();
    navStack = [];
    m.overlay.classList.add('scripture-popup-overlay--open');
    m.overlay.setAttribute('aria-hidden', 'false');
    navPush({ type: 'verses', refs: refs, ranges: ranges, notes: notes,
              label: labelText || (refs || '').replace(/,/g,'、') });
    /* navPush 内部已调用 backStack.push，无需再次 push */
  }

  function closeModal() {
    if (!modal) return;
    /* 有几层就清几次，一次性消耗对应的 history 记录 */
    var n = navStack.length;
    navStack = [];
    _navBackStackFns = [];
    modal.overlay.classList.remove('scripture-popup-overlay--open');
    modal.overlay.setAttribute('aria-hidden', 'true');
    if (n > 0 && window.CX && window.CX.backStack) {
      if (typeof window.CX.backStack.clear === 'function') {
        window.CX.backStack.clear(n);
      } else {
        for (var i = 0; i < n; i++) window.CX.backStack.pop();
      }
    }
  }

  /* ── ESC 关闭 ── */
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.keyCode === 27) && modal && modal.overlay.classList.contains('scripture-popup-overlay--open')) {
      closeModal();
    }
  });

  /* ── 平板：点击扩展框外区域关闭 ── */
  document.addEventListener('click', function (e) {
    if (window.innerWidth < 600) return;
    if (!modal || !modal.overlay.classList.contains('scripture-popup-overlay--open')) return;
    /* 点击在弹框本体内 → 不关闭 */
    if (modal.overlay.contains(e.target)) return;
    /* 点击的是经文引用类元素 → 不关闭（由事件委托接管打开新帧） */
    var t = e.target;
    while (t && t !== document) {
      if (t.classList && (
        (t.classList.contains('scripture-ref') && t.dataset && (t.dataset.refs || t.dataset.x || t.dataset.n)) ||
        t.classList.contains('fn-ref') ||
        t.classList.contains('xref-ref')
      )) return;
      t = t.parentNode;
    }
    /* 平板不锁滚动，history.back() 会异步恢复滚动位置，提前保存并还原 */
    var savedScrollY = window.scrollY;
    closeModal();
    /* history.back() 是异步的，用 popstate 之后恢复最可靠 */
    window.addEventListener('popstate', function restoreScroll() {
      window.removeEventListener('popstate', restoreScroll);
      /* 再等一帧，确保浏览器滚动恢复已执行完毕 */
      requestAnimationFrame(function () {
        window.scrollTo(0, savedScrollY);
      });
    }, { once: true });
  }, true); /* capture 保证在事件委托之前执行 */

  /* ═══════════════════════════ 事件委托 ═══════════════════════════ */
  document.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== document) {
      /* .scripture-ref[data-refs] → 打开弹框，或若已在弹框内则 navPush 导航 */
      if (t.classList && t.classList.contains('scripture-ref') && t.dataset
          && (t.dataset.refs || t.dataset.x || t.dataset.n)) {
        e.preventDefault(); e.stopPropagation();
        var _ranges = readRanges(t);
        var _notes = readNotes(t);
        var overlay = document.getElementById('scripture-popup-overlay');
        var insidePopup = overlay && overlay.contains(t);
        if (!insidePopup) _popupLang = resolveLangFromEl(t);
        if (insidePopup) {
          navPush({ type: 'verses', refs: t.dataset.refs || '', ranges: _ranges, notes: _notes,
                    label: t.textContent.trim() });
        } else {
          openModal(t.dataset.refs || '', t.textContent.replace(/^[—─\s]+/,'').trim(), _ranges, _notes);
        }
        return;
      }
      /* fn-ref（注脚号）*/
      if (t.classList && t.classList.contains('fn-ref') && t.dataset) {
        e.preventDefault(); e.stopPropagation();
        /* 弹框内点击继承当前语言；弹框外按所在语言行路由（繁体→繁体注解） */
        if (!(modal && modal.overlay.contains(t))) _popupLang = resolveLangFromEl(t);
        ensureOpen();
        navPush({ type: 'footnote', verseKey: t.dataset.vkey, num: t.dataset.fn });
        return;
      }
      /* xref-ref（串珠号）*/
      if (t.classList && t.classList.contains('xref-ref') && t.dataset) {
        e.preventDefault(); e.stopPropagation();
        if (!(modal && modal.overlay.contains(t))) _popupLang = resolveLangFromEl(t);
        ensureOpen();
        navPush({ type: 'xrefs', verseKey: t.dataset.vkey, letter: t.dataset.xr });
        return;
      }
      /* verse-ref（注解内经文引用）*/
      if (t.classList && t.classList.contains('verse-ref') && t.dataset && t.dataset.refs) {
        e.preventDefault(); e.stopPropagation();
        navPush({ type: 'verses', refs: t.dataset.refs, label: t.textContent });
        return;
      }
      t = t.parentNode;
    }
  });

  /* ═══════════════════════════ 自动标注正文 ═══════════════════════════ */
  function annotateInlineRefs() {
    var paras = document.querySelectorAll('.content-text');
    paras.forEach(function (p) {
      if (p.querySelector('span')) return;
      var html = p.innerHTML;
      var newer = html.replace(INLINE_REF_RE, function (ref) {
        return '<span class="scripture-ref scripture-ref--inline" data-refs="' + esc(ref) + '">' + esc(ref) + '</span>';
      });
      if (newer !== html) p.innerHTML = newer;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', annotateInlineRefs);
  } else {
    annotateInlineRefs();
  }

  /* ═══════════════════════════ 自动渲染 scripture-block ═══════════════════════════ */
  /* .scripture-block[data-refs] 行内经文块（晨兴喂养等），带注脚和串珠上标 */
  function renderScriptureBlocks() {
    var blocks = document.querySelectorAll('.scripture-block[data-refs]');
    if (!blocks.length) return;
    ensureBibleText(function () {
      blocks.forEach(function (block) {
        if (block.hasAttribute('data-rendered')) return;
        block.setAttribute('data-rendered', '1');
        var refs = (block.dataset.refs || '').trim();
        if (!refs) return;
        block.innerHTML = renderVerseList(refs);
      });
      // 经文块渲染完成后，通知 highlight.js 重新计算字符偏移并恢复划线
      if (window.CXHighlight && window.CXHighlight.redoHighlights) {
        window.CXHighlight.redoHighlights();
      }
      // 经文块撑开内容后，通知翻页布局重新计算容器高度（避免 overflow:hidden 截断最后段落）
      document.dispatchEvent(new CustomEvent('cx:scriptureBlocksRendered'));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderScriptureBlocks);
  } else {
    renderScriptureBlocks();
  }

  /* ═══════════════════════════ 静态经文块（锚文本对齐注入注解/串珠）═══════════════ */
  /* .scripture-block-static[data-refs]：保留文档原文，从分片数据找到
   * {N}/[a] 在 JSON 经文中的位置：
   *   - 标记前有文字 → 取末尾 8 字作 lookback，在文档原文中搜索，插在其后
   *   - 标记前无文字 → 取标记后 8 字作 lookahead，在文档原文中搜索，插在其前
   * 找不到对应文字 → 跳过（文档经文不全）。 */
  function renderScriptureStaticBlocks() {
    var blocks = document.querySelectorAll('.scripture-block-static[data-refs]');
    if (!blocks.length) return;
    ensureBibleText(function () {
      blocks.forEach(function (block) {
        if (block.hasAttribute('data-rendered')) return;
        block.setAttribute('data-rendered', '1');
        var refs = (block.dataset.refs || '').trim();
        if (!refs) return;
        var dict = window.CX_SCRIPTURES_DATA || {};
        var docText = block.textContent;
        var ctxBook = getBookFromRef((refs.split(',')[0] || '').trim());
        var refArr = parseAndExpandRefs(refs, dict, ctxBook);

        /* 从所有 ref 的 JSON 文本里，按出现顺序收集注入点 */
        var injections = [];
        refArr.forEach(function (ref) {
          var nr = normalizeRef(ref) || ref;
          var bk = baseKey(nr);
          var raw = dict[nr] || (bk !== nr ? dict[bk] : '');
          if (!raw) return;
          var MRE = /\{(\d+)\}|\[([a-z]+)\]/g, lastEnd = 0, mm;
          while ((mm = MRE.exec(raw)) !== null) {
          /* 剥除 {N}/[a] 标记后再提取锚定文字，避免相邻标记干扰 */
          var STRIP_MARKS = /\{\d+\}|\[[a-z]+\]/g;
          var prefix = raw.slice(lastEnd, mm.index).replace(STRIP_MARKS, '');
          var lookback  = prefix.replace(/[\s\u3000\u00a0]/g, '').slice(-8);
          var suffix    = raw.slice(mm.index + mm[0].length).replace(STRIP_MARKS, '');
            var lookahead = suffix.replace(/[\s\u3000\u00a0]/g, '').slice(0, 8);
            var mhtml = mm[1]
              ? '<sup class="fn-ref" data-vkey="' + esc(bk) + '" data-fn="' + mm[1] + '">' + mm[1] + '</sup>'
              : '<sup class="xref-ref" data-vkey="' + esc(bk) + '" data-xr="' + mm[2] + '">' + mm[2] + '</sup>';
            injections.push({ lookback: lookback, lookahead: lookahead, html: mhtml });
            lastEnd = mm.index + mm[0].length;
          }
        });

        if (!injections.length) { block.innerHTML = esc(docText); return; }

        /* 依次在 docText 中定位每个注入点 */
        var parts = [];
        var searchFrom = 0;

        injections.forEach(function (inj) {
          var insertPos = -1;

          if (inj.lookback) {
            /* 优先用 lookback：在 lookback 文字之后插入 */
            var idx = docText.indexOf(inj.lookback, searchFrom);
            if (idx !== -1) {
              insertPos = idx + inj.lookback.length;
            } else if (inj.lookback.length > 3) {
              idx = docText.indexOf(inj.lookback.slice(-4), searchFrom);
              if (idx !== -1) insertPos = idx + inj.lookback.slice(-4).length;
            }
          }

          if (insertPos === -1 && inj.lookahead) {
            /* lookback 找不到（或为空）→ 用 lookahead：在 lookahead 文字之前插入 */
            /* 依次尝试 8‑字符、4‑字符、2‑字符，处理文档省略号截断的情形 */
            var laFull = inj.lookahead;
            var laTrys = [laFull, laFull.slice(0, 4), laFull.slice(0, 2)];
            for (var _li = 0; _li < laTrys.length; _li++) {
              if (!laTrys[_li]) continue;
              var idx2 = docText.indexOf(laTrys[_li], searchFrom);
              if (idx2 !== -1) { insertPos = idx2; break; }
            }
          }

          if (insertPos !== -1) {
            parts.push({ pos: insertPos, html: inj.html });
            searchFrom = insertPos;
          }
          /* 两者都找不到 → 文档经文不全，跳过 */
        });

        /* 按位置升序排列，拼接最终 HTML */
        parts.sort(function (a, b) { return a.pos - b.pos; });
        var out = '', lastPos = 0;
        parts.forEach(function (part) {
          out += esc(docText.slice(lastPos, part.pos)) + part.html;
          lastPos = part.pos;
        });
        out += esc(docText.slice(lastPos));
        block.innerHTML = out;
      });
      if (window.CXHighlight && window.CXHighlight.redoHighlights) {
        window.CXHighlight.redoHighlights();
      }
      document.dispatchEvent(new CustomEvent('cx:scriptureBlocksRendered'));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderScriptureStaticBlocks);
  } else {
    renderScriptureStaticBlocks();
  }

  /* ── 暴露给外部（可选）── */
  /* init()：由 renderer.js 的 setContent 在每次 SPA 切换后调用，
   * 重新对动态插入的经文块执行注解/串珠注入和行内引用标注。 */
  function init() {
    annotateInlineRefs();
    renderScriptureBlocks();
    renderScriptureStaticBlocks();
  }
  /* ── 外部 API：直接打开注解帧 ── */
  function showFootnote(verseKey, noteSeq) {
    ensureOpen();
    navPush({ type: 'footnote', verseKey: verseKey, num: String(noteSeq) });
  }

  /* ── 外部 API：直接打开串珠帧 ── */
  function showBead(verseKey, beadSeq) {
    ensureOpen();
    navPush({ type: 'xrefs', verseKey: verseKey, letter: beadSeq });
  }

  window.CXScripturePopup = { open: openModal, close: closeModal, init: init, showFootnote: showFootnote, showBead: showBead };

  /* ── 空闲预加载：页面加载后利用空闲时间提前加载分片数据 ──
   * 文件已在 PWA/APK 缓存中，无网络开销；
   * 提前加载后用户首次点击经文/注解/串珠时无需等待。
   * 一次加载同时提取经文、注解、串珠。
   */
  function idleLoad(fn) {
    if (window.requestIdleCallback) {
      requestIdleCallback(fn, { timeout: 4000 });
    } else {
      setTimeout(fn, 3000);
    }
  }

  function schedulePreload() {
    idleLoad(function () {
      ensureBibleText(function () {});
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedulePreload);
  } else {
    schedulePreload();
  }
})();
