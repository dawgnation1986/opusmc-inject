# -*- coding: utf-8 -*-
"""
把 opusmc-v47685-src/ 同步到 probe/（离线版）。

保留的本地改动：
  1. 去掉强制跳回 bilibili 的重定向守卫（离线版要能直接打开）
  2. 标题 / bootnote 标注离线同步版与源版本
  3. probe/ 下已有的 sounds/（4849 个音效，线上逐字节相同，不重下）
  4. probe/ 下已有的 files.txt 等辅助文件
  5. 本地调试用的 __TOY_PERF__ 性能探针（在线上 index.html 里同样存在，无需特殊处理）

用法：python tools/sync_v47685.py
"""
import os, re, shutil, json, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'opusmc-v47685-src')
DST = os.path.join(ROOT, 'probe')
BACKUP = os.path.join(ROOT, 'back', 'probe-before-v47685')

if not os.path.isdir(SRC):
    sys.exit('找不到源码快照：' + SRC)

# ---------------------------------------------------------------- 1) 备份旧 js + 入口
os.makedirs(BACKUP, exist_ok=True)
old_js = os.path.join(DST, 'js')
if os.path.isdir(old_js):
    dst_old = os.path.join(BACKUP, 'js')
    if not os.path.exists(dst_old):
        shutil.copytree(old_js, dst_old)
for name in ('game.html', 'game.orig.html'):
    p = os.path.join(DST, name)
    if os.path.exists(p):
        shutil.copy2(p, os.path.join(BACKUP, name))
print('已备份旧 js/ 与入口 ->', BACKUP)

# ---------------------------------------------------------------- 2) 同步 js/（覆盖，不删旧文件）
n_js = 0
for f in sorted(os.listdir(os.path.join(SRC, 'js'))):
    s = os.path.join(SRC, 'js', f)
    if not os.path.isfile(s):
        continue
    shutil.copy2(s, os.path.join(old_js, f))
    n_js += 1
print('同步 js/ 文件:', n_js)

# ---------------------------------------------------------------- 3) 同步 mods/（线上游戏根目录 mods/ -> probe/mods/）
src_mods = os.path.join(SRC, 'mods')
dst_mods = os.path.join(DST, 'mods')
os.makedirs(dst_mods, exist_ok=True)
n_mod = 0
for d, _, fs in os.walk(src_mods):
    rel = os.path.relpath(d, src_mods)
    out = dst_mods if rel == '.' else os.path.join(dst_mods, rel)
    os.makedirs(out, exist_ok=True)
    for f in fs:
        shutil.copy2(os.path.join(d, f), os.path.join(out, f))
        n_mod += 1
print('同步 mods/ 文件:', n_mod)

# ---------------------------------------------------------------- 4) 合成离线版 index.html
html = open(os.path.join(SRC, 'index.html'), encoding='utf-8').read()

# 4a) 去掉强制跳回 bilibili 的重定向守卫
guard = re.compile(
    r'<script>\s*if\s*\(\s*window\.self\s*===\s*window\.top\s*\)\s*\{[^}]*window\.location\.replace\([^;]*\);\s*\}\s*</script>')
html, cnt = guard.subn('<!-- local offline copy: removed the redirect-to-bilibili guard -->', html)
assert cnt == 1, '重定向守卫匹配数 %d，停止' % cnt

# 4b) 标题与 bootnote 标成离线同步版
html = html.replace('<title>OpusMC</title>', '<title>OpusMC 离线版 · 同步自线上 v47685</title>', 1)
html = re.sub(r'(<div id="bootnote">)[^<]*(</div>)',
              r'\g<1>离线同步版 · 源版本 v47685 · 2026-11-13\g<2>', html, count=1)

# 4c) 统一标注来源
html = html.replace('<html lang="zh-CN">',
                    '<html lang="zh-CN"><!-- synced from v47685 by tools/sync_v47685.py -->', 1)

# 4d) 给所有 js/*.js 加版本号做 cache-bust。
# 线上入口的 script 不带版本，浏览器会用启发式缓存，改了 net.js 页面仍加载旧副本
# （用户实测「还是只有直接连接」就是这个）。每次同步都换一个版本串。
import re
CACHE_VER = '?v=47685r1'
html = re.sub(r'(<script[^>]*src="js/[^"?]+)(")', lambda m: m.group(1) + CACHE_VER + m.group(2), html)
assert html.count(CACHE_VER) >= 90, 'cache-bust 未生效: %d' % html.count(CACHE_VER)

open(os.path.join(DST, 'game.html'), 'w', encoding='utf-8', newline='').write(html)
print('已写入 probe/game.html（离线改造版）')

# ---------------------------------------------------------------- 5) 校验
scripts = [l.strip().split('?')[0] for l in
           open(os.path.join(SRC, 'script-list.txt'), encoding='utf-8') if l.strip()]
missing = [f for f in scripts if not os.path.exists(os.path.join(DST, f))]
assert not missing, '入口 script 缺失: %s' % missing

idx = json.load(open(os.path.join(dst_mods, 'index.json'), encoding='utf-8'))
mod_missing = [m['id'] + '/' + f for m in idx['mods'] for f in m['files']
               if not os.path.exists(os.path.join(dst_mods, m['id'], f))]
# LICENSE.txt 是线上本身 404，允许
mod_missing_real = [x for x in mod_missing if not x.endswith('LICENSE.txt')]
assert not mod_missing_real, '模组文件缺失: %s' % mod_missing_real

assert 'MODS_ALWAYS' in html, '入口丢了 MODS_ALWAYS'
assert 'location.replace("https://www.bilibili.com' not in html, '重定向守卫没去干净'

print('校验通过：%d 个入口 script 齐全、%d 个模组文件齐全（%d 个线上自身 404）、MODS_ALWAYS 保留、守卫已移除'
      % (len(scripts), n_mod, len(mod_missing)))
