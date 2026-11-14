# -*- coding: utf-8 -*-
"""
把本地离线版曾经打过的「自定义服务器列表」补丁补回 probe/js/net.js。

背景：sync_v47685.py 用线上 net.js 整体覆盖，冲掉了这段本地改造，
多人游戏页只剩官方的「直接连接（局域网）」。这里从
_archive/back/probe-before-v47685/js/net.js 精确搬回 1378-1534 行
（NET_SERVERS_KEY / loadNetServers / saveNetServers / ServerListScreen / ServerEditScreen），
并把入口按钮换回「自定义服务器」（列表内自带「直接连接（手填）」）。

幂等：检测到 NET_SERVERS_KEY 已存在就只报告，不重复插入。
"""
import os, sys, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CUR = os.path.join(ROOT, 'probe', 'js', 'net.js')
BAK = os.path.join(ROOT, '_archive', 'back', 'probe-before-v47685', 'js', 'net.js')

cur = open(CUR, encoding='utf-8', newline='').read()
bak = open(BAK, encoding='utf-8', newline='').read()

if 'NET_SERVERS_KEY' in cur:
    print('已存在 NET_SERVERS_KEY，跳过（幂等）')
    sys.exit(0)

L = bak.split('\n')
# 备份里 1-based 1378..1534 → 0-based 1377..1534
block = '\n'.join(L[1377:1534])
assert 'const NET_SERVERS_KEY' in block, '块起点不对'
assert 'class ServerListScreen' in block, '缺 ServerListScreen'
assert 'class ServerEditScreen' in block, '缺 ServerEditScreen'
assert block.rstrip().endswith('}'), '块结尾不对: ' + block[-80:]
print('提取代码块 %d 行 / %d B' % (block.count('\n') + 1, len(block)))

# 1) 插到 DirectConnectScreen 的注释之前
anchor = '// 直接连接: a proxy\'s address (multiplayer/proxy on this computer, the LAN or Radmin: 开服给朋友.bat), not the room service.'
assert cur.count(anchor) == 1, ('anchor', cur.count(anchor))
cur = cur.replace(anchor, block.rstrip() + '\n\n' + anchor, 1)
print('已插入 ServerListScreen / ServerEditScreen')

# 2) 换入口按钮：官方的「直接连接（局域网）」→「自定义服务器」
old_btn = "    if (location.protocol === 'http:') this.widgets.push({ x: cx + 2, y: u.h - 28, w: 150, h: 20, label: '直接连接（局域网）', onClick: () => { this.game.ui.hideInput(); this.game.ui.open(new DirectConnectScreen(this.game, this)); } });"
new_btn = "    if (location.protocol === 'http:') this.widgets.push({ x: cx + 2, y: u.h - 28, w: 150, h: 20, label: '自定义服务器', onClick: () => { this.game.ui.hideInput(); this.game.ui.open(new ServerListScreen(this.game, this)); } });"
assert cur.count(old_btn) == 1, ('btn', cur.count(old_btn))
cur = cur.replace(old_btn, new_btn, 1)
print('入口按钮已换回「自定义服务器」')

# 3) 备份当前文件（改之前），再写
shutil.copy2(CUR, CUR + '.before-restore-netservers')
open(CUR, 'w', encoding='utf-8', newline='').write(cur)

# 4) 校验
chk = open(CUR, encoding='utf-8', newline='').read()
for s in ['const NET_SERVERS_KEY', 'class ServerListScreen', 'class ServerEditScreen',
          "label: '自定义服务器'", "label: '直接连接（手填）'"]:
    assert s in chk, '校验失败: ' + s
print('校验通过：5 个关键标记都在')
