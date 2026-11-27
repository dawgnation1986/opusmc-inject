# -*- coding: utf-8 -*-
"""给 PEVersion 加一个游戏原生触摸按钮「客户端」（像 F3/emote 那样）。

接入点（对照 mobile.js 里 f3 的实现）：
  1. layout：L.client 默认位置 + touchLayout/touchScale 覆盖（自动生效，因为覆盖是遍历 L[id]）
  2. startPlay 命中：s.kind='button', s.btn='client'
  3. endPlay：调 __cometHud.toggleClassic()
  4. draw：btn(c, L.client, null, false, '客户端')
  5. 编辑器 ids()：加 'client'（这样能在「编辑按钮布局」里拖动/缩放）
  6. 安全区与胶囊避让列表：加 'client'
  7. 移除旧的独立 DOM 按钮（comet-mobile.js 里的），避免两个按钮重叠

幂等：检测 'client' 标记。
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PE = os.path.join(ROOT, 'PEVersion', 'js')
MOBILE = os.path.join(PE, 'mobile.js')
CM = os.path.join(PE, 'comet-mobile.js')

def patch(path, pairs, tag):
    t = open(path, encoding='utf-8', newline='').read()
    E = '\r\n' if '\r\n' in t else '\n'
    if 'PE_CLIENT_BTN' in t:
        print('  跳过（已改）:', tag); return
    for old, new in pairs:
        old = old.replace('\n', E); new = new.replace('\n', E)
        c = t.count(old)
        assert c == 1, (tag, old[:60], c)
        t = t.replace(old, new, 1)
    open(path, 'w', encoding='utf-8', newline='').write(t)
    print('  ok', tag)

# ---------- mobile.js ----------
patch(MOBILE, [
  # 1) 布局：放在 f3 左边
  ("    L.f3 = { x: L.emote.x - ts - gp, y: top, w: ts, h: ts };",
   """    L.f3 = { x: L.emote.x - ts - gp, y: top, w: ts, h: ts };
    // PE_CLIENT_BTN：客户端按钮（原生触摸按钮，可在布局编辑器里调位置/大小）
    L.client = { x: L.f3.x - Math.round(ts * 2.2) - gp, y: top, w: Math.round(ts * 2.2), h: ts };"""),
  # 2) 安全区
  ("    for (const id of ['pause', 'chat', 'view', 'emote', 'f3']) if (L[id]) { L[id].x -= sf.r; L[id].y += sf.t; }",
   "    for (const id of ['pause', 'chat', 'view', 'emote', 'f3', 'client']) if (L[id]) { L[id].x -= sf.r; L[id].y += sf.t; }"),
  # 3) 胶囊避让
  ("for (const id of ['pause', 'chat', 'view', 'emote', 'f3']) if (L[id] && L[id].y < cap.h) L[id].x = Math.max(0, L[id].x - dx);",
   "for (const id of ['pause', 'chat', 'view', 'emote', 'f3', 'client']) if (L[id] && L[id].y < cap.h) L[id].x = Math.max(0, L[id].x - dx);"),
  # 4) 另一处避让列表
  ("['pause', 'chat', 'view', 'emote', 'f3', 'jump', 'descend', 'sprint', 'attack', 'use', 'interact', 'sneak', 'inv']",
   "['pause', 'chat', 'view', 'emote', 'f3', 'client', 'jump', 'descend', 'sprint', 'attack', 'use', 'interact', 'sneak', 'inv']"),
  # 5) startPlay 命中
  ("    if (this.hitL(L.f3, x, y)) { s.kind = 'button'; s.btn = 'f3'; return; }",
   """    if (this.hitL(L.f3, x, y)) { s.kind = 'button'; s.btn = 'f3'; return; }
    if (this.hitL(L.client, x, y)) { s.kind = 'button'; s.btn = 'client'; return; }"""),
  # 6) endPlay
  ("    if (s.kind === 'button' && s.btn === 'emote') { if (!cancel && this.hitL(this.L.emote, s.x, s.y)) g.ui.open(new QuickChatScreen(g)); return; }",
   """    if (s.kind === 'button' && s.btn === 'emote') { if (!cancel && this.hitL(this.L.emote, s.x, s.y)) g.ui.open(new QuickChatScreen(g)); return; }
    if (s.kind === 'button' && s.btn === 'client') {
      if (!cancel && this.hitL(this.L.client, s.x, s.y)) {
        try { var H = window.__cometHud; if (H && H.toggleClassic) H.toggleClassic(); else if (H && H.toggleMenu) H.toggleMenu(); } catch (e) { }
      }
      return;
    }"""),
  # 7) 绘制（client 在 f3 左边，画一个带文字的按钮）
  ("    this.btn(c, L.f3, null, !!ui.debug, 'F3');",
   "    this.btn(c, L.f3, null, !!ui.debug, 'F3');\n    this.btn(c, L.client, null, false, '客户端');"),
  # 8) 编辑器 ids
  ("'emote', 'f3', 'view'];", "'emote', 'f3', 'client', 'view'];"),
], 'mobile.js 原生客户端按钮')

# ---------- comet-mobile.js：去掉独立 DOM 按钮，只保留进世界提示 ----------
t = open(CM, encoding='utf-8', newline='').read()
E = '\r\n' if '\r\n' in t else '\n'
if 'PE_CLIENT_BTN' not in t:
    # 把 ensureBtn 整个函数换成空，loop 里不再管按钮
    import re
    t = re.sub(r'  function ensureBtn\(\) \{[\s\S]*?\n  \}\n', '  // PE_CLIENT_BTN：按钮已改为游戏原生触摸按钮（mobile.js 里的 L.client），这里不再创建 DOM 按钮。\n', t, count=1)
    t = t.replace('      ensureBtn();\n', '').replace('      if (btn && g) btn.style.display = inWorld(g) ? \'\' : \'none\';\n', '')
    t = t.replace("  var btn = null, hintAt = 0;", "  var hintAt = 0;")
    t = "/* PE_CLIENT_BTN */" + E + t
    open(CM, 'w', encoding='utf-8', newline='').write(t)
    print('  ok comet-mobile.js 移除 DOM 按钮')
else:
    print('  跳过 comet-mobile.js')

print('完成')
