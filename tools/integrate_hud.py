# -*- coding: utf-8 -*-
"""把 opusmc-hud.user.js 整合进 PEVersion 网页本体。

做三件事：
  1. 去掉 UserScript 元数据头，生成 PEVersion/js/comet-hud.js
  2. 在 PEVersion/game.html 末尾加载 HUD 脚本（游戏脚本之后）
  3. 生成 PEVersion/js/comet-mobile.js：
     - 进世界时提示 PC 按 Ins / 手机点「客户端」按钮
     - 触屏设备加一个「客户端」按钮，点它开经典面板

幂等：重复运行不会重复插入 script 标签。
用法：python tools/integrate_hud.py
"""
import os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'opusmc-hud.user.js')
PE = os.path.join(ROOT, 'PEVersion')
OUT = os.path.join(PE, 'js', 'comet-hud.js')
HTML = os.path.join(PE, 'game.html')
MOBILE = os.path.join(PE, 'js', 'comet-mobile.js')

# ---------- 1) 转制 HUD ----------
src = open(SRC, encoding='utf-8', newline='').read()
m = re.match(r'// ==UserScript==.*?// ==/UserScript==\s*', src, re.S)
assert m, '找不到 UserScript 头'
body = src[m.end():]
a = "const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;"
assert a in body, 'unsafeWindow 行变了，需人工确认'
body = body.replace(a, "const W = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);", 1)
header = """'use strict';
// PEVersion 内置客户端 HUD —— 由 opusmc-hud.user.js 转制（tools/integrate_hud.py 生成，勿手改）。
// 去掉了 UserScript 元数据头；unsafeWindow 在普通网页里自动兜底为 window。
"""
open(OUT, 'w', encoding='utf-8', newline='\n').write(header + body)
print('HUD 脚本已生成: %d B' % (len(header + body)))

# ---------- 2) mobile 脚本 ----------
MOBILE_JS = r"""'use strict';
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
"""
open(MOBILE, 'w', encoding='utf-8', newline='\n').write(MOBILE_JS)
print('手机按钮脚本已生成: %d B' % len(MOBILE_JS))

# ---------- 3) 挂到 game.html 末尾（所有游戏脚本之后）----------
html = open(HTML, encoding='utf-8', newline='').read()
if 'js/comet-hud.js' in html:
    print('game.html 已含 HUD 脚本，跳过插入')
else:
    E = '\r\n' if '\r\n' in html else '\n'
    tags = (E.join([
        '<!-- PEVersion 内置客户端 HUD（opusmc-hud.user.js 转制） -->',
        '<script src="js/comet-hud.js"></script>',
        '<script src="js/comet-mobile.js"></script>',
    ]) + E)
    idx = html.rfind('</body>')
    assert idx > 0, '找不到 </body>'
    html = html[:idx] + tags + html[idx:]
    open(HTML, 'w', encoding='utf-8', newline='').write(html)
    print('已插入 game.html')
