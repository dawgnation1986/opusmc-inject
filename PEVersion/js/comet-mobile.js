'use strict';
// PEVersion 客户端整合：进世界提示 + 手机端「客户端」按钮。
// PC：Insert 键由 HUD 自己处理（见 comet-hud.js）；这里只负责提示与触屏按钮。
(function () {
  var btn = null, hintAt = 0;

  function isTouch() {
    try {
      if (typeof TouchDevice !== 'undefined') return !!TouchDevice.touch || TouchDevice.kind !== 'pc';
      return (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    } catch (e) { return false; }
  }
  function inWorld(g) {
    return !!(g && g.state === 'play' && g.player && g.world && !(g.ui && g.ui.screen));
  }
  function hud() { return (typeof window !== 'undefined') ? window.__cometHud : null; }

  // 进世界时提示一次（游戏自己的 message 走聊天栏，触屏也能看见）
  function tip(g) {
    if (!inWorld(g) || g.__cometTipShown) return;
    g.__cometTipShown = true;
    var text = isTouch()
      ? '客户端已载入：点右侧「客户端」按钮打开设置面板'
      : '客户端已载入：按 Insert 键打开设置面板（` 键开悬浮面板）';
    try { if (g.ui && g.ui.message) g.ui.message(text, '#55FF55'); } catch (e) { }
    try { if (hud() && hud().notify) hud().notify(text); } catch (e) { }
  }

  // 触屏按钮：一个独立的 DOM 按钮，不碰游戏 touch 布局
  function ensureBtn() {
    if (!isTouch() || btn || !document.body) return;
    btn = document.createElement('div');
    btn.textContent = '客户端';
    btn.setAttribute('data-comet-client-btn', '1');
    var st = btn.style;
    st.position = 'fixed';
    st.right = '8px';
    st.bottom = '76px';
    st.zIndex = '2147483000';
    st.padding = '8px 12px';
    st.borderRadius = '8px';
    st.color = '#fff';
    st.background = 'rgba(30,30,40,0.72)';
    st.border = '1px solid rgba(255,255,255,0.35)';
    st.font = 'bold 14px sans-serif';
    st.userSelect = 'none';
    st.touchAction = 'manipulation';
    st.display = 'none';
    var open = function (e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      try {
        var h = hud();
        if (h && h.toggleClassic) h.toggleClassic();
        else if (h && h.toggleMenu) h.toggleMenu();
      } catch (err) { }
    };
    btn.addEventListener('touchstart', open, { passive: false });
    btn.addEventListener('mousedown', open, false);
    document.body.appendChild(btn);
  }

  // 每帧轻量检查：HUD 是否就绪、是否进世界、按钮显隐
  function loop() {
    try {
      var g = (typeof game !== 'undefined') ? game : null;
      ensureBtn();
      if (hud()) tip(g);
      if (btn && g) btn.style.display = inWorld(g) ? '' : 'none';
    } catch (e) { }
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loop, { once: true });
  else loop();
})();
