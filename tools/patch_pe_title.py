# -*- coding: utf-8 -*-
"""PEVersion 主菜单精简：去登录/公告/股东/签到/左右下角图标/底部文字，模组免登录。

改的是 PEVersion/js/ 下游戏真正加载的文件（不是根目录那份）。
幂等：检查标记，已改过就跳过。
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(ROOT, 'PEVersion', 'js')

def R(file, old, new, tag, mark=None):
    p = os.path.join(JS, file)
    t = open(p, encoding='utf-8', newline='').read()
    if mark and mark in t:
        print('  跳过（已改）:', tag)
        return
    E = '\r\n' if '\r\n' in t else '\n'
    old = old.replace('\n', E); new = new.replace('\n', E)
    if t.count(old) != 1:
        print('  FAIL', tag, 'count=', t.count(old)); sys.exit(1)
    open(p, 'w', encoding='utf-8', newline='').write(t.replace(old, new, 1))
    print('  ok', tag)

# 1) screens.js：登录按钮、左右下角图标、底部两行字
R('screens.js',
"""      { x: cx - 124, y: l + 84, w: 20, h: 20, icon: 'icon_language', tip: ['游戏说明'], onClick: () => g.ui.open(new HelpScreen(g, this)) },
      { x: cx - 100, y: l + 84, w: 98, h: 20, label: '选项…', onClick: () => g.ui.open(new OptionsScreen(g, this)) },
      { x: cx + 2, y: l + 84, w: 98, h: 20, label: '退出游戏', onClick: () => quitGame(g) },
      // (no 全屏 where the page can't go full screen: iPhones - see toggleFullscreen)
      fsSupported() ? { x: cx + 104, y: l + 84, w: 20, h: 20, icon: 'icon_accessibility', tip: ['全屏'], onClick: () => toggleFullscreen() } : null,
    ].filter(Boolean);
    // the account (top left) and, until everything is unlocked, the way to unlock it (top right)
    if (Account.loggedIn) this.widgets.push({ x: 4, y: 4, w: Math.min(120, Font.width(Account.name) + 30), h: 18, label: fitText(Account.name, 110), tip: ['账号：游戏名、识别码、退出登录'], onClick: () => g.ui.open(new AccountScreen(g, this)) });
    else this.widgets.push({ x: 4, y: 4, w: 60, h: 18, gold: true, label: '登录', tip: ['登录后可以联机、云存档、换皮肤和披风'], onClick: () => g.ui.open(new LoginScreen(g, () => g.ui.open(new TitleScreen(g)))) });
    if (Account.loggedIn && !Account.allUnlocked()) this.widgets.push({ x: u.w - 112, y: 4, w: 108, h: 18, gold: true, label: '解锁披风和联机', onClick: () => g.ui.open(new UnlockScreen(g, this)) });""",
"""      // PEVersion：选项/退出保留，左右下角图标与账号/登录去掉
      { x: cx - 100, y: l + 84, w: 98, h: 20, label: '选项…', onClick: () => g.ui.open(new OptionsScreen(g, this)) },
      { x: cx + 2, y: l + 84, w: 98, h: 20, label: '退出游戏', onClick: () => quitGame(g) },
    ];""", 'screens: widgets', mark='PEVersion：选项/退出保留')

R('screens.js',
"""    const left = 'OpusMC · 仅在 B站 Toy 平台发布';
    Font.draw(c, left, 2, ui.h - 10, '#FFFFFF');
    let t = 'Minecraft 粉丝二创 · 非官方 · 永久免费 · 请支持正版', ty = ui.h - 10;
    if (Font.width(left) + Font.width(t) + 10 > ui.w) t = '粉丝二创 · 非官方 · 永久免费 · 请支持正版';
    if (Font.width(left) + Font.width(t) + 10 > ui.w) t = '粉丝二创 · 永久免费 · 请支持正版';
    if (Font.width(left) + Font.width(t) + 10 > ui.w) ty = ui.h - 20;
    Font.draw(c, t, ui.w - Font.width(t) - 2, ty, '#FFFFFF');""",
"""    // PEVersion：底部两行署名去掉（离线版不涉及 B站 Toy / 股东）
    // 注意：这里不能留 void left; —— left 的 const 声明已被删掉，会抛 TDZ ReferenceError，
    // 中断 drawExtra 导致按钮一个都不画（用户实测过，node --check 抓不到）。""", 'screens: bottom text', mark='PEVersion：底部两行署名去掉')

# 2) cloudsave.js：底部「登录后可以…」
R('cloudsave.js',
"""    else if (!Account.loggedIn) Font.center(ui.ctx, fitText('登录后可以联机、云存档、换皮肤和披风', ui.w - 8), ui.w / 2, ui.h - 22, '#A0A0A0');""",
"""    // PEVersion：离线版不显示登录提示
    void n;""", 'cloudsave: hint', mark='PEVersion：离线版不显示登录提示')

# 3) news.js：整段公告注入禁掉
R('news.js',
"""// the title screen: refresh when it opens and every 5 minutes, the sign, a tap on it, the important one dropping
(() => {""",
"""// PEVersion：公告吊牌整段禁用（离线版不读取线上公告）
if (false) (() => {""", 'news: disable', mark='PEVersion：公告吊牌整段禁用')

# 4) shareholders.js：股东名单按钮禁掉
R('shareholders.js',
"""// the title screen: a gold 股东名单 button under the news sign's (and the sign-in's) - only with a room service
(() => {""",
"""// PEVersion：股东名单按钮禁用
if (false) (() => {""", 'shareholders: disable', mark='PEVersion：股东名单按钮禁用')

# 5) checkin.js：签到按钮禁掉
R('checkin.js',
"""// ---- the ways in: the title screen (under the news sign) and the pause menu, each with the red dot ----
(() => {""",
"""// PEVersion：签到按钮禁用
if (false) (() => {""", 'checkin: disable', mark='PEVersion：签到按钮禁用')

# 6) mods_ui.js：模组免登录
R('mods_ui.js',
"""function openModsScreen(g, parent) { modsGate(g, () => g.ui.open(new ModsScreen(g, parent)), parent); }""",
"""// PEVersion：离线版模组免登录，直接打开
function openModsScreen(g, parent) { g.ui.open(new ModsScreen(g, parent)); }""", 'mods: no gate', mark='PEVersion：离线版模组免登录')

# 7) onboard.js：跳过协议/引导/FPS 测试（否则首次打开停在 AgreementScreen）
R('onboard.js',
"""      if (!s.onboarded || (s.legalV || 0) < LEGAL.v) setTimeout(() => Onboarding.start(this), 50);""",
"""      // PEVersion：离线单机版跳过协议/引导/FPS 测试，打开就到主菜单
      if (location.protocol === 'file:') { s.onboarded = true; s.legalV = LEGAL.v; s.fpsTestV = FPS_TEST_V; if (this.saveSettings) this.saveSettings(); }
      else if (!s.onboarded || (s.legalV || 0) < LEGAL.v) setTimeout(() => Onboarding.start(this), 50);""",
  'onboard: skip', mark='PEVersion：离线单机版跳过协议')

print('完成')
