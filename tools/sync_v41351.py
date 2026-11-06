# -*- coding: utf-8 -*-
# 同步 v41351 -> probe/js + 重打离线补丁（一次落盘，逐处断言）
import os, shutil, sys

PROBE = r"D:\discuz\webmc\hook\opusmc-inject\probe"
SRC = r"C:\Users\zhahe\AppData\Local\Temp\opusmc_v41351\js"

os.chdir(PROBE)

# 1) 拷贝 41 个文件（40 差异 + jing_tex.js 新增）
files = ['account.js','audio.js','checkin.js','companion.js','decor.js','dims.js',
    'emodel.js','entity.js','equip.js','extras.js','game.js','gen_worker.js',
    'items3.js','main.js','mesher.js','mobile.js','mobitems.js','mobs2.js',
    'mobs_animals.js','mobs_hostile.js','net.js','nether_mobs.js','news.js',
    'onboard.js','p2p.js','perf.js','redstone.js','render.js','render2.js',
    'screens.js','shaders.js','social.js','spawning.js','specials.js',
    'telemetry.js','terrain2.js','touch.js','ui.js','vmobs.js','world.js',
    'jing_tex.js']
for f in files:
    shutil.copy2(os.path.join(SRC, f), os.path.join('js', f))
print('拷贝完成: %d 个文件' % len(files))

def patch(path, old, new):
    with open(path, newline='', encoding='utf-8') as fh:
        t = fh.read()
    eol = '\r\n' if '\r\n' in t else '\n'
    old = old.replace('\n', eol)
    new = new.replace('\n', eol)
    n = t.count(old)
    assert n == 1, '%s: old 命中 %d 次（应为 1）: %s...' % (path, n, old[:60])
    t = t.replace(old, new)
    with open(path, 'w', newline='', encoding='utf-8') as fh:
        fh.write(t)
    print('补丁 OK: %s (EOL=%r)' % (path, eol))

# 2) screens.js 多人按钮跳过 onlineGate
patch('js/screens.js',
    "label: '多人游戏', onClick: () => onlineGate(g, () => g.ui.open(new MultiplayerScreen(g, this)), this), tip:",
    "label: '多人游戏', onClick: () => g.ui.open(new MultiplayerScreen(g, this)), tip:")

# 3) net.js gate 错误：离线版显示提示，不弹登录屏死循环
patch('js/net.js',
    "if (e.gate) this.game.ui.open(Account.loggedIn ? new UnlockScreen(this.game, this, e.message, () => this.game.ui.open(this)) : new LoginScreen(this.game, () => this.game.ui.open(this)));",
    "if (e.gate) this.say('服务端拒绝了本地页面的请求（来源白名单）—— 联机请用在线版', true);")

# 4) news.js 离线版跳过公告拉取
patch('js/news.js',
    "  fetch(force, quiet) {\n    if (this.pending)",
    "  fetch(force, quiet) {\n"
    "    // [local offline copy] B 站服务端按页面来源拒绝非 bilibili 域（红字「不允许从这个网页访问」），\n"
    "    // 本地离线版直接跳过公告拉取，读 localStorage 缓存即可\n"
    "    if (!/(^|\\.)bilibili(com|toy)\\.com$/.test(location.hostname)) return Promise.resolve();\n"
    "    if (this.pending)")

# 5) game.html 插入 jing_tex.js（companion.js 之前）
with open('game.html', newline='', encoding='utf-8') as fh:
    t = fh.read()
eol = '\r\n' if '\r\n' in t else '\n'
old = '<script src="js/companion.js"></script>'
new = '<script src="js/jing_tex.js"></script>' + eol + old
n = t.count(old)
assert n == 1, 'game.html: companion.js 引用命中 %d 次' % n
with open('game.html', 'w', newline='', encoding='utf-8') as fh:
    fh.write(t.replace(old, new))
print('补丁 OK: game.html (+jing_tex.js)')

print('全部完成')
