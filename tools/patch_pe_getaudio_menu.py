# -*- coding: utf-8 -*-
"""把「点击获取游戏音频资源」从游戏内触摸按钮改为菜单按钮。

- 移除 mobile.js 里的 L.getaudio 触摸按钮（6 处接入）
- screens.js 加共享 getAudioButton(g)：confirm「下载完成请放入js文件夹」→ 打开 123pan
- 主菜单左下角（x=2, y=u.h-24）
- 暂停菜单「保存并退回」上方一行

只改 PEVersion 副本。幂等：检测 PE_GETAUDIO_MENU 标记。
"""
import os, sys, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PE = os.path.join(ROOT, 'PEVersion', 'js')
MOBILE = os.path.join(PE, 'mobile.js')
SCREENS = os.path.join(PE, 'screens.js')
URL = 'https://1815498758.share.123pan.cn/123pan/dk8iVv-y6XNd'

# ---------- 1) 移除 mobile.js 里的触摸按钮 ----------
t = open(MOBILE, encoding='utf-8', newline='').read()
E = '\r\n' if '\r\n' in t else '\n'
if "L.getaudio" in t:
    lines = t.split(E)
    out = []
    skip_brace = 0
    for ln in lines:
        if 'PE_GETAUDIO' in ln and '音频资源按钮' in ln:
            continue
        if "L.getaudio = {" in ln:
            continue
        if 'var aw = Math.min(Font.width(' in ln:
            continue
        if "for (const id of ['pause', 'chat', 'view', 'emote', 'f3', 'client', 'getaudio'])" in ln:
            out.append(ln.replace(", 'getaudio'", ""))
            continue
        if "if (this.hitL(L.getaudio, x, y))" in ln:
            continue
        if "this.btn(c, L.getaudio, null, false," in ln:
            continue
        if "'client', 'getaudio', 'view']" in ln:
            out.append(ln.replace("'client', 'getaudio', 'view'", "'client', 'view'"))
            continue
        if "if (s.kind === 'button' && s.btn === 'getaudio') {" in ln:
            skip_brace = 1
            continue
        if skip_brace:
            # 跳过整个点击块，直到遇到闭合的 "    }" 且缩进匹配
            if ln.strip() == '}' and ln.startswith('    }'):
                skip_brace = 0
            continue
        out.append(ln)
    t = E.join(out)
    open(MOBILE, 'w', encoding='utf-8', newline='').write(t)
    print('mobile.js 已移除触摸按钮')
else:
    print('mobile.js 无触摸按钮，跳过')

# ---------- 2) screens.js 加菜单按钮 ----------
s = open(SCREENS, encoding='utf-8', newline='').read()
Es = '\r\n' if '\r\n' in s else '\n'
if 'PE_GETAUDIO_MENU' not in s:
    def R(a, b, tag):
        global s
        a=a.replace('\n',Es); b=b.replace('\n',Es)
        c=s.count(a); assert c==1,(tag,c); s=s.replace(a,b,1); print('ok',tag)

    # 共享函数：插在 TitleScreen 之前
    R("class TitleScreen extends MenuScreen {",
"""// PE_GETAUDIO_MENU：获取音频资源的菜单按钮（主菜单左下角 / 暂停菜单）
function getAudioButton(g, x, y, w) {
  return { x, y, w: w || 150, h: 20, gold: true, label: '点击获取游戏音频资源',
    tip: ['下载游戏音频资源后，把文件放入 js 文件夹'],
    onClick: () => {
      try {
        if (window.confirm('下载完成请放入js文件夹')) window.open('URL_HERE', '_blank');
      } catch (e) { }
    } };
}
URL_PLACEHOLDER
class TitleScreen extends MenuScreen {""".replace('URL_HERE', URL), '共享函数')
    # 去掉占位注释行
    s = s.replace('URL_PLACEHOLDER' + Es, '', 1)

    # 主菜单左下角：在 widgets 数组里加一项（退出游戏之后）
    R("""      { x: cx + 2, y: l + 84, w: 98, h: 20, label: '退出游戏', onClick: () => quitGame(g) },
    ];""",
"""      { x: cx + 2, y: l + 84, w: 98, h: 20, label: '退出游戏', onClick: () => quitGame(g) },
      getAudioButton(g, 2, u.h - 24, 160),
    ];""", '主菜单')

    # 暂停菜单：在「保存并退回」之前加一行
    R("""      { x: cx - 102, y: y + (roomMode ? 120 : 96), w: 204, h: 20, label: '保存并退回到标题屏幕', onClick: () => g.quitToTitle() },""",
"""      getAudioButton(g, cx - 102, y + (roomMode ? 144 : 120), 204),
      { x: cx - 102, y: y + (roomMode ? 120 : 96), w: 204, h: 20, label: '保存并退回到标题屏幕', onClick: () => g.quitToTitle() },""", '暂停菜单')

    open(SCREENS, 'w', encoding='utf-8', newline='').write(s)
    print('screens.js 已加菜单按钮')
else:
    print('screens.js 已改，跳过')

print('完成')
