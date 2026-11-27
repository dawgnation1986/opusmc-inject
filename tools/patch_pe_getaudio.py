# -*- coding: utf-8 -*-
"""给 PEVersion 加原生触摸按钮「点击获取游戏音频资源」。

点击 → 原生 confirm「下载完成请放入js文件夹」→ 确定后打开 123pan 链接。
接入点照 client 按钮（mobile.js），可拖动/缩放（布局编辑器 ids 加 getaudio）。
幂等：检测 PE_GETAUDIO 标记。
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'PEVersion', 'js', 'mobile.js')
t = open(P, encoding='utf-8', newline='').read()
E = '\r\n' if '\r\n' in t else '\n'
if 'PE_GETAUDIO' in t:
    print('已改，跳过'); sys.exit(0)

LABEL = '点击获取游戏音频资源'
URL = 'https://1815498758.share.123pan.cn/123pan/dk8iVv-y6XNd'

def R(a, b, tag):
    global t
    a=a.replace('\n',E); b=b.replace('\n',E)
    c=t.count(a); assert c==1,(tag,c); t=t.replace(a,b,1); print('ok',tag)

# 1) 布局：放屏幕左侧中部（摇杆上方），宽度按文字算
R("""    L.client = { x: L.f3.x - Math.round(ts * 2.2) - gp, y: top, w: Math.round(ts * 2.2), h: ts };""",
"""    L.client = { x: L.f3.x - Math.round(ts * 2.2) - gp, y: top, w: Math.round(ts * 2.2), h: ts };
    // PE_GETAUDIO：音频资源按钮（左侧中部，避开顶栏与摇杆）
    L.getaudio = { x: m, y: Math.round(H * 0.36), w: Math.min(Font.width('点击获取游戏音频资源') + 10, W - 2 * m), h: Math.max(18, ts) };""", 'layout')

# 2) 安全区/胶囊列表（两处）
R("for (const id of ['pause', 'chat', 'view', 'emote', 'f3', 'client']) if (L[id]) { L[id].x -= sf.r; L[id].y += sf.t; }",
  "for (const id of ['pause', 'chat', 'view', 'emote', 'f3', 'client', 'getaudio']) if (L[id]) { L[id].x -= sf.r; L[id].y += sf.t; }", 'safe')
R("for (const id of ['pause', 'chat', 'view', 'emote', 'f3', 'client']) if (L[id] && L[id].y < cap.h) L[id].x = Math.max(0, L[id].x - dx);",
  "for (const id of ['pause', 'chat', 'view', 'emote', 'f3', 'client']) if (L[id] && L[id].y < cap.h) L[id].x = Math.max(0, L[id].x - dx);", 'capsule(unchanged)')

# 3) startPlay 命中
R("""    if (this.hitL(L.client, x, y)) { s.kind = 'button'; s.btn = 'client'; return; }""",
"""    if (this.hitL(L.client, x, y)) { s.kind = 'button'; s.btn = 'client'; return; }
    if (this.hitL(L.getaudio, x, y)) { s.kind = 'button'; s.btn = 'getaudio'; return; }""", 'hit')

# 4) endPlay 点击
R("""    if (s.kind === 'button' && s.btn === 'client') {""",
"""    if (s.kind === 'button' && s.btn === 'getaudio') {
      if (!cancel && this.hitL(this.L.getaudio, s.x, s.y)) {
        // PE_GETAUDIO：原生 confirm，确定后打开网盘链接
        try {
          var ok = window.confirm('下载完成请放入js文件夹');
          if (ok) window.open('URL_PLACEHOLDER', '_blank');
        } catch (e) { }
      }
      return;
    }
    if (s.kind === 'button' && s.btn === 'client') {""", 'click')
t = t.replace('URL_PLACEHOLDER', URL, 1)

# 5) 绘制
R("""    this.btn(c, L.client, null, false, '客户端');""",
"""    this.btn(c, L.client, null, false, '客户端');
    this.btn(c, L.getaudio, null, false, '点击获取游戏音频资源');""", 'draw')

# 6) 编辑器 ids
R("'emote', 'f3', 'client', 'view'];", "'emote', 'f3', 'client', 'getaudio', 'view'];", 'editor ids')

open(P,'w',encoding='utf-8',newline='').write(t)
print('完成', len(t), 'B')
