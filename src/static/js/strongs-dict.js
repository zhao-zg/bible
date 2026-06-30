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
