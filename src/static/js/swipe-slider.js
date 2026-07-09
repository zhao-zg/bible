/*!
 * swipe-slider.js — 通用三页滑动容器（左-中-右预渲染）
 * 供 bible-renderer.js 和 reading-plan.js 共享
 *
 * 使用方式：各模块在初始化时调用 CXSwipeSlider.init({ ... }) 传入配置，
 * 之后通过 CXSwipeSlider 的 API 控制滑动行为。
 *
 * 暴露：window.CXSwipeSlider
 */
(function (win) {
  'use strict';

  var _opts = {};
  var _swipeBound = false;
  var _isAnimating = false;
  var _swipeContainer = null;
  var _touchStartHandler = null;
  var _touchMoveHandler = null;
  var _touchEndHandler = null;

  function _getContainer() {
    return document.getElementById((_opts && _opts.containerId) || 'app');
  }

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

  function _setupSlider() {
    var container = _getContainer();
    if (!container) return;
    var contentEl = container.querySelector((_opts && _opts.contentSelector) || '.bible-reading');
    if (!contentEl) return;
    if (contentEl.closest && contentEl.closest('.swipe-slider')) return;

    // 冷启动时启动屏（#cxSplash）可能仍覆盖在 #app 之上，部分 WebView 尚未对
    // 被遮挡的容器完成布局，container.offsetWidth 会返回 0，导致滑动容器被创建为
    // 0 宽且 overflow:hidden，正文被裁切为空白页。
    // 此处改用视口宽度作为兜底；若仍测得 0，则延迟到下一帧布局就绪后再构建，
    // 避免永久空白（仅冷启动出现，热导航无启动屏故一切正常）。
    var W = container.offsetWidth ||
            window.innerWidth ||
            (document.documentElement && document.documentElement.clientWidth) ||
            0;

    if (W <= 0) {
      _setupSlider._retry = (_setupSlider._retry || 0) + 1;
      if (_setupSlider._retry <= 12) {
        requestAnimationFrame(function () { _setupSlider(); });
      } else {
        _setupSlider._retry = 0;
      }
      return;
    }
    _setupSlider._retry = 0;

    var wrapper = document.createElement('div');
    wrapper.className = 'swipe-slider';
    wrapper.style.cssText = 'position:relative;width:' + W + 'px;overflow:hidden;';

    // 中页
    var centerPage = document.createElement('div');
    centerPage.className = 'swipe-page center-page';
    centerPage.style.cssText = 'width:' + W + 'px;';
    centerPage.appendChild(contentEl);
    wrapper.appendChild(centerPage);
    container.appendChild(wrapper);

    // 高度同样可能未被布局（被启动屏遮挡），用视口高度兜底，避免 0 高裁切；
    // 下一帧重新测量并修正为真实内容高度。
    var centerH = centerPage.offsetHeight || window.innerHeight || 0;
    var wrapperLeft = wrapper.getBoundingClientRect().left;
    var viewH = window.innerHeight;

    // 左页
    var leftPage = document.createElement('div');
    leftPage.className = 'swipe-page left-page';
    leftPage.style.cssText = 'position:fixed;top:0;left:' + (wrapperLeft - W) + 'px;width:' + W + 'px;height:' + viewH + 'px;overflow:hidden;z-index:1;contain:content;backface-visibility:hidden;';
    var prev = _opts.resolveDelta(-1);
    if (prev && _opts.getPreRenderedHtml) {
      var prevHtml = _opts.getPreRenderedHtml(prev);
      if (prevHtml && _opts.buildSidePage) _opts.buildSidePage(leftPage, prevHtml, prev);
    }

    // 右页
    var rightPage = document.createElement('div');
    rightPage.className = 'swipe-page right-page';
    rightPage.style.cssText = 'position:fixed;top:0;left:' + (wrapperLeft + W) + 'px;width:' + W + 'px;height:' + viewH + 'px;overflow:hidden;z-index:1;contain:content;backface-visibility:hidden;';
    var next = _opts.resolveDelta(1);
    if (next && _opts.getPreRenderedHtml) {
      var nextHtml = _opts.getPreRenderedHtml(next);
      if (nextHtml && _opts.buildSidePage) _opts.buildSidePage(rightPage, nextHtml, next);
    }

    wrapper.appendChild(leftPage);
    wrapper.appendChild(rightPage);

    wrapper.style.height = centerH + 'px';

    // 冷启动兜底：若干帧后布局已稳定，重新测量内容真实高度并修正容器高度，
    // 防止启动屏遮挡期间测得 0 高导致正文被 overflow:hidden 裁切为空白。
    requestAnimationFrame(function () {
      try {
        var h = centerPage.offsetHeight;
        if (h > 0 && Math.abs(h - (parseInt(wrapper.style.height, 10) || 0)) > 1) {
          wrapper.style.height = h + 'px';
        }
      } catch (e) {}
    });

    if (_opts.onSliderCreated) _opts.onSliderCreated(wrapper);
  }

  function _setSliderTransform(centerEl, leftEl, rightEl, dx, animate) {
    var transition = animate ? 'transform 0.18s cubic-bezier(.22,.61,.36,1)' : 'none';
    [centerEl, leftEl, rightEl].forEach(function (el) {
      if (!el) return;
      el.style.transition = transition;
      el.style.transform = 'translate3d(' + dx + 'px,0,0)';
      el.style.willChange = 'transform';
    });
  }

  function _bindSwipeGesture() {
    if (_swipeBound) return;
    _swipeBound = true;

    var container = _getContainer();
    if (!container) return;
    _swipeContainer = container;

    var startX = 0, startY = 0, startTime = 0;
    var isDragging = false, isHorizontal = null;
    var centerEl = null, leftEl = null, rightEl = null;
    var wrapperW = 0;
    var _rafId = 0, _pendingDx = 0;

    var onTouchStart = function (e) {
      if (_isAnimating) return;
      if (_opts.isPage && !_opts.isPage()) return;
      var target = e.target;
      var ignore = (_opts && _opts.ignoreSelectors) || 'button, a, input';
      if (target.closest && target.closest(ignore)) return;
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

      if (_opts.onTouchStart) _opts.onTouchStart();
    };

    var onTouchMove = function (e) {
      if (!isDragging || _isAnimating || !centerEl) return;
      var dx = e.touches[0].clientX - startX;
      var dy = e.touches[0].clientY - startY;

      if (isHorizontal === null) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        isHorizontal = Math.abs(dx) >= 2 * Math.abs(dy);
      }
      if (!isHorizontal) { isDragging = false; return; }

      var dampedDx = dx;
      if (_opts.getDamping) dampedDx = _opts.getDamping(dx) || dx;

      _pendingDx = dampedDx;
      if (!_rafId) {
        _rafId = requestAnimationFrame(function () {
          _rafId = 0;
          _setSliderTransform(centerEl, leftEl, rightEl, _pendingDx, false);
        });
      }
    };

    var onTouchEnd = function (e) {
      if (!isDragging) return;
      isDragging = false;
      if (_rafId) { cancelAnimationFrame(_rafId); _rafId = 0; }
      if (isHorizontal !== true || !centerEl) { resetDrag(); return; }

      var dx = e.changedTouches[0].clientX - startX;
      var dt = Date.now() - startTime;
      var vel = Math.abs(dx) / (dt || 1);
      var ratio = Math.abs(dx) / wrapperW;
      var direction = dx < 0 ? 1 : -1;

      if (ratio > 0.20 || vel > 0.3) {
        // 边界检查：目标方向没有相邻页则不滑动
        var target = _opts.resolveDelta ? _opts.resolveDelta(direction) : true;
        var wrapper = container.querySelector('.swipe-slider');
        if (target && wrapper) {
          _isAnimating = true;
          _setSliderTransform(centerEl, leftEl, rightEl, -direction * wrapper.offsetWidth, true);

          var cleaned = false;
          var doCleanup = function () {
            if (cleaned) return;
            cleaned = true;
            if (_opts.onSwipeComplete) _opts.onSwipeComplete(direction, centerEl, leftEl, rightEl, wrapper);
            _isAnimating = false;
          };

          centerEl.addEventListener('transitionend', function handler() {
            centerEl.removeEventListener('transitionend', handler);
            doCleanup();
          });
          setTimeout(doCleanup, 250);
          return;
        }
      }

      // 未达阈值 → 弹回
      _setSliderTransform(centerEl, leftEl, rightEl, 0, true);
      var els = [centerEl, leftEl, rightEl];
      setTimeout(function () {
        els.forEach(function (el) {
          if (!el) return;
          el.style.transition = '';
          el.style.transform = '';
          el.style.willChange = '';
        });
      }, 200);
      resetDrag();
    };

    function resetDrag() {
      isHorizontal = null;
      centerEl = null; leftEl = null; rightEl = null;
    }

    _touchStartHandler = onTouchStart;
    _touchMoveHandler = onTouchMove;
    _touchEndHandler = onTouchEnd;

    container.addEventListener('touchstart', _touchStartHandler, {passive: true});
    container.addEventListener('touchmove', _touchMoveHandler, {passive: true});
    container.addEventListener('touchend', _touchEndHandler);
  }

  win.CXSwipeSlider = {
    init: function (options) { _opts = options || {}; },
    isAnimating: function () { return _isAnimating; },
    setAnimating: function (v) { _isAnimating = !!v; },
    setSliderTransform: _setSliderTransform,
    setupSlider: _setupSlider,
    bindSwipeGesture: _bindSwipeGesture,
    unbindSwipeGesture: _unbindSwipeGesture
  };
})(window);
