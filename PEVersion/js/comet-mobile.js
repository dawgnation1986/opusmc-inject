/* PE_CLIENT_BTN */
'use strict';
// PEVersion 客户端整合：进世界提示 + 面板触摸隔离 + 关闭按钮。
// PC：Insert 键由 HUD 自己处理（见 comet-hud.js）；手机：原生触摸按钮 mobile.js 的 L.client。
// 由 tools/patch_pe_client_button.py 配套维护。
(function () {
  var veil = null, closeBtn = null, armed = false;

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
  function guiOpen() {
    try { return document.documentElement.classList.contains('cm-gui-open'); } catch (e) { return false; }
  }
  function closeGui() {
    try {
      var H = hud();
      if (H && H.toggleClassic) { H.toggleClassic(false); return; }
      if (H && H.toggleFloat) { H.toggleFloat(false); return; }
      if (H && H.toggleMenu) { H.toggleMenu(false); }
    } catch (e) { }
  }

  // 供 touch.js 查询：面板打开时，坐标落在面板内就交给 HUD，游戏不处理
  window.__cometGuiBlocks = function (target) {
    if (!guiOpen()) return false;
    if (!target) return false;
    var panel = document.getElementById('__comet_panel');
    if (!panel) return false;
    // 用事件 target 判断，不靠坐标（面板有 scale(2)，rect 会放大到整屏）
    return !!(target === panel || panel.contains(target) || target === closeBtn);
  };

  // 进世界时提示一次
  function tip(g) {
    if (!inWorld(g) || g.__cometTipShown) return;
    g.__cometTipShown = true;
    var text = '客户端已载入：点「客户端」按钮 或 按 Ins 键打开设置面板';
    try { if (g.ui && g.ui.message) g.ui.message(text, '#55FF55'); } catch (e) { }
    try { if (hud() && hud().notify) hud().notify(text); } catch (e) { }
  }

  // 建遮罩 + 关闭按钮（只建一次）
  function ensure() {
    if (armed || !document.body) return;
    armed = true;
    veil = document.createElement('div');
    veil.id = '__pe_gui_veil';
    var vs = veil.style;
    vs.position = 'fixed'; vs.inset = '0'; vs.display = 'none';
    vs.zIndex = '2147483640';           // 低于 HUD 面板 2147483647，高于游戏 canvas
    vs.background = 'rgba(0,0,0,0.01)'; // 几乎透明，只为吃事件
    vs.touchAction = 'none';

    closeBtn = document.createElement('div');
    closeBtn.id = '__pe_gui_close';
    closeBtn.textContent = '×';
    var cs = closeBtn.style;
    // 放进面板内部右上角：跟着面板走，不会被系统胶囊/屏幕边缘挡住
    cs.position = 'absolute'; cs.top = '2px'; cs.right = '2px';
    cs.zIndex = '99999'; cs.width = '26px'; cs.height = '26px';
    cs.lineHeight = '22px'; cs.textAlign = 'center';
    cs.fontSize = '20px'; cs.color = '#fff';
    cs.background = 'rgba(200,50,50,0.85)';
    cs.border = '2px solid rgba(255,255,255,0.6)';
    cs.borderRadius = '8px'; cs.userSelect = 'none'; cs.touchAction = 'manipulation';

    document.body.appendChild(veil);
    attachClose();

    // 面板 DOM 是动态的，找到后把 × 塞进它右上角
  function attachClose() {
    if (!closeBtn || closeBtn.parentNode) return;
    var panel = document.getElementById('__comet_panel');
    if (panel) panel.appendChild(closeBtn);
  }

  // capture 阶段拦截：面板打开时，任何不在面板内的指针/触摸都不让游戏拿到
    var BLOCK = function (e) {
      if (!guiOpen()) return;
      var t = e.target;
      var panel = document.getElementById('__comet_gui');
      var inside = !!(panel && t && (panel === t || panel.contains(t)))
        || t === veil || t === closeBtn;   // 遮罩/叉要收到自己的关闭事件
      if (inside) return;              // 面板内部交给 HUD 自己处理
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mouseup', 'wheel', 'contextmenu']
      .forEach(function (ev) {
        document.addEventListener(ev, BLOCK, { capture: true, passive: false });
      });

    // 点遮罩 / 点叉 → 关闭
    var shut = function (e) { if (e) { e.preventDefault(); e.stopImmediatePropagation(); } closeGui(); };
    veil.addEventListener('pointerdown', shut, { capture: true, passive: false });
    veil.addEventListener('touchstart', shut, { capture: true, passive: false });
    closeBtn.addEventListener('pointerdown', shut, { capture: true, passive: false });
    closeBtn.addEventListener('touchstart', shut, { capture: true, passive: false });
    closeBtn.addEventListener('mousedown', shut, true);
  }

  // 每帧轻量检查：HUD 就绪、进世界提示、遮罩/叉显隐
  function loop() {
    try {
      var g = (typeof game !== 'undefined') ? game : null;
      if (hud()) tip(g);
      ensure();
      attachClose();
      var on = guiOpen();
      if (veil) veil.style.display = on ? 'block' : 'none';
      // × 在 #__comet_panel 内，父级 #__comet_gui:not(.visible) 是 display:none，自动跟着隐藏，无需 JS 控制
    } catch (e) { }
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loop, { once: true });
  else loop();
})();
