# -*- coding: utf-8 -*-
"""从编译产物复制出一份「资源正常化」的可运行源码副本。

原始 probe/ 里 4000 张贴图全是 base64 内嵌在 JS 字符串里，改一张都得重新
生成整个 JS。本脚本做三件事：

1. 完整复制 probe/ -> opusmc-source/（game.html / js/ / sounds/ 一个不少）。
2. 把 vanilla-assets/ 里导出的独立 PNG 放进副本的 assets/ 目录，
   再把 assets.js / etex.js / font.js 里的 data URL 换成相对文件路径。
3. 把 render.js 里 526 个串行的 `await loadImage(...)` 改成并发
   （data URL 是同步的，换成 HTTP 路径后串行会把启动拖死）。

不改动 probe/ 里任何文件；重复运行会重建 opusmc-source/。
零第三方依赖。用法：python tools/build_source_tree.py
"""
import json
import os
import re
import shutil
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'probe')
ASSETS = os.path.join(ROOT, 'vanilla-assets')
DST = os.path.join(ROOT, 'opusmc-source')
MAPPING = os.path.join(ASSETS, 'MAPPING.json')

if not os.path.isdir(ASSETS) or not os.path.isfile(MAPPING):
    sys.exit('先运行 tools/extract_vanilla_assets.py 生成 vanilla-assets/')

M = json.load(open(MAPPING, encoding='utf-8'))
IMG = M['images']

# ---------------------------------------------------------------- 1) 复制
print('复制 probe/ -> opusmc-source/ ...')
if os.path.exists(DST):
    shutil.rmtree(DST)
shutil.copytree(SRC, DST)
n_js = sum(1 for dp, _, fs in os.walk(DST) for f in fs if f.endswith('.js'))
n_snd = sum(1 for dp, _, fs in os.walk(os.path.join(DST, 'sounds')) for f in fs)
print('  js %d 个 / sounds %d 个' % (n_js, n_snd))

print('复制独立贴图 -> opusmc-source/assets/ ...')
shutil.copytree(os.path.join(ASSETS, 'assets'), os.path.join(DST, 'assets'))
n_png = sum(1 for dp, _, fs in os.walk(os.path.join(DST, 'assets')) for f in fs if f.endswith('.png'))
shutil.copyfile(os.path.join(ASSETS, 'pack.mcmeta'), os.path.join(DST, 'assets', 'pack.mcmeta'))
print('  %d 张 PNG' % n_png)

DATA_RE = re.compile(r'"data:image/png;base64,[A-Za-z0-9+/=]+"')


def rewrite(path, fn, tag):
    s = open(path, encoding='utf-8').read()
    out, n = fn(s)
    if n == 0:
        print('  警告: %s 没有替换到任何内容' % tag)
    open(path, 'w', encoding='utf-8', newline='').write(out)
    print('  %s: %d 处' % (tag, n))


# ---------------------------------------------------------------- 2) assets.js
p = os.path.join(DST, 'js', 'assets.js')


def fix_assets(s):
    n = [0]

    # strip 长条图
    def strip_sub(m):
        n[0] += 1
        return '"strip": "assets/minecraft/textures/_atlas/strip.png"'

    s = re.sub(r'"strip"\s*:\s*"data:image/png;base64,[A-Za-z0-9+/=]+"',
               strip_sub, s, count=1)

    # images 段：按 key 查 MAPPING.json
    i = s.index('"images"')
    head, tail = s[:i], s[i:]

    def img_sub(m):
        k = m.group(1)
        if k not in IMG:
            return m.group(0)
        n[0] += 1
        return '"%s": "assets/minecraft/textures/%s"' % (k, IMG[k]['path'])

    tail = re.sub(r'"([A-Za-z0-9_@/]+)"\s*:\s*"data:image/png;base64,[A-Za-z0-9+/=]+"',
                  img_sub, tail)
    return head + tail, n[0]


rewrite(p, fix_assets, 'js/assets.js')

# 注入 tileFiles：tile 名 -> 独立 PNG 路径，让 rebuild_atlas.py 能把单张贴图拼回图集
def add_tilefiles():
    global n_png
    s = open(p, encoding='utf-8', newline='').read()
    if '"tileFiles"' in s:
        return
    tf = {}
    for k, v in M['tiles'].items():
        if v['source'] != 'unmapped':
            tf[k] = 'assets/minecraft/' + v['path']
    block = '"tileFiles": ' + json.dumps(tf, ensure_ascii=False, separators=(',', ':')) + ',\n  '
    # 放在 "tiles" 之前，保持顶层对象结构
    idx = s.index('"tiles"')
    s = s[:idx] + block + s[idx:]
    open(p, 'w', encoding='utf-8', newline='').write(s)
    print('  js/assets.js: 注入 tileFiles %d 条' % len(tf))

add_tilefiles()

# ---------------------------------------------------------------- 3) etex.js
p = os.path.join(DST, 'js', 'etex.js')


def fix_etex(s):
    n = [0]

    def sub(m):
        k = m.group(1)
        if k not in M['etex']:
            return m.group(0)
        n[0] += 1
        return '"%s": "assets/minecraft/textures/%s.png"' % (k, k)

    s = re.sub(r'"((?:entity|painting|map)/[^"]+)"\s*:\s*"data:image/png;base64,[A-Za-z0-9+/=]+"', sub, s)
    return s, n[0]


rewrite(p, fix_etex, 'js/etex.js')

# ---------------------------------------------------------------- 4) font.js
p = os.path.join(DST, 'js', 'font.js')


def fix_font(s):
    s2, n = re.subn(r'"img"\s*:\s*"data:image/png;base64,[A-Za-z0-9+/=]+"',
                    '"img": "assets/minecraft/textures/font/ascii_atlas.png"', s)
    return s2, n


rewrite(p, fix_font, 'js/font.js')

# ---------------------------------------------------------------- 5) render.js 并发
p = os.path.join(DST, 'js', 'render.js')


def fix_render(s):
    old = "    for (const k in ASSETS.images) this.images[k] = await loadImage(ASSETS.images[k]);"
    if old not in s:
        return s, 0
    new = """    // 资源正常化版：贴图是独立文件，改成并发加载，避免 526 个串行 HTTP 请求拖死启动。
    const _pairs = await Promise.all(Object.keys(ASSETS.images).map(async (k) =>
      [k, await loadImage(ASSETS.images[k])]));
    for (const [k, im] of _pairs) this.images[k] = im;"""
    return s.replace(old, new, 1), 1


rewrite(p, fix_render, 'js/render.js')

# ---------------------------------------------------------------- 6) 校验
print('校验路径 ...')
js_dir = os.path.join(DST, 'js')
refs = set()
for f in os.listdir(js_dir):
    if not f.endswith('.js'):
        continue
    s = open(os.path.join(js_dir, f), encoding='utf-8').read()
    refs.update(re.findall(r'"(assets/minecraft/[^"]+\.(?:png|webp))"', s))
missing = [r for r in refs if not os.path.isfile(os.path.join(DST, r))]
leftover = 0
for f in ['assets.js', 'etex.js', 'font.js']:
    s = open(os.path.join(js_dir, f), encoding='utf-8').read()
    leftover += len(DATA_RE.findall(s))
print('  引用图片路径 %d 个，缺失 %d 个；三个资源 JS 里剩余 base64 %d 处'
      % (len(refs), len(missing), leftover))
if missing:
    print('  缺失样例:', missing[:5])

# HTML 的 script 引用
html = open(os.path.join(DST, 'game.html'), encoding='utf-8').read()
scripts = re.findall(r'<script src="([^"?]+)', html)
bad_scripts = [x for x in scripts if not os.path.isfile(os.path.join(DST, x))]
print('  game.html 引用 %d 个 js，缺失 %d 个' % (len(scripts), len(bad_scripts)))
if bad_scripts:
    print('  缺失样例:', bad_scripts[:5])

# ---------------------------------------------------------------- 7) 启动器 / 说明
server_src = os.path.join(HERE, 'server.mjs')
server_dst = os.path.join(HERE, 'server-source.mjs')
if os.path.isfile(server_src):
    s = open(server_src, encoding='utf-8').read()
    old = "const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'probe');"
    new = "const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'opusmc-source');"
    if old in s:
        s = s.replace(old, new, 1)
        s = s.replace("const PORT = +(process.env.PORT || 8777);",
                      "const PORT = +(process.env.PORT || 8778);", 1)
        open(server_dst, 'w', encoding='utf-8', newline='').write(s)
        print('  生成 tools/server-source.mjs（端口 8778，根目录 opusmc-source/，不碰原服务器）')

readme = [
    '# OpusMC 资源正常化源码副本', '',
    '生成时间：' + datetime.now().isoformat(timespec='seconds'),
    '由 `tools/build_source_tree.py` 从 `probe/` 复制并转换而来，**原始的 `probe/` 没有改动**。',
    '', '## 和原版有什么区别', '',
    '| | 原 `probe/` | 这个副本 |', '| --- | --- | --- |',
    '| 贴图形态 | base64 内嵌在 `assets.js` / `etex.js` / `font.js` | `assets/minecraft/textures/` 下独立 PNG |',
    '| 改一张材质 | 重新生成整个 JS | 直接替换对应 PNG 文件 |',
    '| `render.js` 加载 | 526 个串行 `await loadImage(dataURL)` | 并发加载文件路径 |',
    '| 音效 | 本来就是独立 `.m4a` | 保持一致 |', '',
    '贴图路径对照表见 `../vanilla-assets/MAPPING.json`（`images` / `tiles` / `etex` 三段）。',
    '例如想把石头换掉，直接改 `assets/minecraft/textures/block/stone.png`；',
    '想换主菜单按钮，改 `assets/minecraft/textures/gui/sprites/widget/button.png`。',
    '', '## 启动', '',
    '```bat', 'launch-source.bat', '```', '',
    '或者手动：`node tools/server-source.mjs`，然后打开 `http://localhost:8778/game.html`。',
    '用 **8778** 是为了不跟原版 8777 抢端口，两个可以同时跑对照。',
    '', '## 改单张方块 / 物品贴图', '',
    '游戏 `render.init()` 读的是 `_atlas/strip.png`（64 列 x 2650 格 16x16 长条图集）。',
    '独立 PNG 通过 `js/assets.js` 里的 `"tileFiles"` 映射回每一格，改完跑一次：',
    '', '```bash', 'python tools/rebuild_atlas.py', '```', '',
    '它会按 `ASSETS.tiles` 的索引把 `textures/block/*.png` / `textures/item/*.png`',
    '重新拼成 strip.png（高清贴图自动按最近邻缩到 16x16），然后刷新页面即可。',
    '`launch-source.bat` 启动前会自动跑这一步。',
    '', '注意必须通过 HTTP 打开，不能双击 `game.html`（`file://` 下 `getImageData` 会被同源策略挡住）。',
    '', '## 校验结果', '',
    '- 引用的独立图片路径：%d 个，缺失 %d 个' % (len(refs), len(missing)),
    '- 三个资源 JS 里剩余 base64：%d 处' % leftover,
    '- `game.html` 引用的 js：%d 个，缺失 %d 个' % (len(scripts), len(bad_scripts)),
    '- 独立 PNG：%d 张 / 音效：%d 个' % (n_png, n_snd),
    '', '## 已知边界', '',
    '- JS 逻辑本身在 `probe/js/` 里就是带注释可读的，不是混淆产物；这份副本保留原样。',
    '- `blockstates/*.json` / `models/*.json` 仍不被游戏读取（方块模型由 `Mesher`/`blocks.js` 生成）。',
    '- 按钮**位置**写死在 `js/screens.js` 的 `layout()`，换贴图改不了位置。',
]
open(os.path.join(DST, 'README.md'), 'w', encoding='utf-8', newline='').write('\n'.join(readme) + '\n')

# 启动器：先重建图集，再起 8778 静态服，最后开浏览器
bat = os.path.join(ROOT, 'launch-source.bat')
open(bat, 'w', encoding='utf-8', newline='\r\n').write(
    '@echo off\r\n'
    'rem OpusMC resource-normalized source tree (port 8778, original 8777 untouched)\r\n'
    'cd /d "%~dp0"\r\n'
    'python tools\\rebuild_atlas.py\r\n'
    'if errorlevel 1 ( echo [atlas] rebuild failed & pause & exit /b 1 )\r\n'
    'start "OpusMC Source" /min node "tools\\server-source.mjs"\r\n'
    'ping -n 3 127.0.0.1 >nul\r\n'
    'start msedge "http://localhost:8778/game.html?rooms=http://localhost:8778"\r\n')
print('  生成 launch-source.bat')

print('')
print('完成：%s' % DST)
print('  独立 PNG %d / 音效 %d / 路径引用 %d（缺失 %d）/ 剩余 base64 %d'
      % (n_png, n_snd, len(refs), len(missing), leftover))
if missing or bad_scripts or leftover:
    sys.exit(1)
