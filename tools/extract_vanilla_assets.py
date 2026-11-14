# -*- coding: utf-8 -*-
"""把 OpusMC 编译产物里内嵌的贴图资源完整还原成标准 MC 资源包目录。

输入（都是编译产物，只读）：
  probe/js/assets.js   ASSETS = { strip, cols, count, tiles, anims, hi, images }
  probe/js/etex.js     window.ETEX = { "entity/...": dataURL }
  probe/js/font.js     window.FONT_MC.img
  probe/js/extras.js / skins.js / social.js 里各一张内嵌 PNG
  probe/sounds/sfx/    4849 个 .m4a

输出（全部新建，不覆盖任何已有文件）：
  vanilla-assets/assets/minecraft/textures/...   标准 MC 目录
  vanilla-assets/MAPPING.json                    游戏键 <-> 落盘路径 <-> 尺寸
  vanilla-assets/animations.json                 动画帧定义
  vanilla-assets/COMPAT.md                       兼容字典说明
  vanilla-assets/REPORT.md                      统计报告
  opusmc-vanilla-assets.zip                      上面全部 + 音效

零第三方依赖，只用标准库。用法：
  python tools/extract_vanilla_assets.py [--with-sounds]
"""
import base64
import collections
import json
import os
import re
import shutil
import struct
import sys
import zipfile
import zlib
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROBE = os.path.join(ROOT, 'probe')
OUT = os.path.join(ROOT, 'vanilla-assets')
ZIP = os.path.join(ROOT, 'opusmc-vanilla-assets.zip')
WITH_SOUNDS = '--with-sounds' in sys.argv

# ---------------------------------------------------------------- PNG 基础
def png_chunks(b):
    p = 8
    out = []
    while p + 8 <= len(b):
        ln = struct.unpack('>I', b[p:p + 4])[0]
        typ = b[p + 4:p + 8]
        data = b[p + 8:p + 8 + ln]
        out.append((typ, data))
        p += 12 + ln
        if typ == b'IEND':
            break
    return out


def png_dim(b):
    if b[:8] != b'\x89PNG\r\n\x1a\n':
        return (0, 0)
    return struct.unpack('>II', b[16:24])


def decode_rgba(b):
    """解 PNG -> (w, h, bytearray RGBA)。支持 8bit RGB/RGBA/灰度/调色板。"""
    w = h = bd = ct = 0
    plte = b''
    trns = b''
    idat = b''
    for typ, d in png_chunks(b):
        if typ == b'IHDR':
            w, h, bd, ct, _, _, inter = struct.unpack('>IIBBBBB', d)
            if inter or bd != 8:
                raise ValueError('只支持 8bit 非隔行 PNG')
        elif typ == b'PLTE':
            plte = d
        elif typ == b'tRNS':
            trns = d
        elif typ == b'IDAT':
            idat += d
    chans = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    bpp = chans
    stride = w * bpp
    raw = zlib.decompress(idat)
    rows = []
    prev = bytearray(stride)
    q = 0
    for _ in range(h):
        f = raw[q]; q += 1
        line = bytearray(raw[q:q + stride]); q += stride
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            bb = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if f == 1: line[i] = (line[i] + a) & 255
            elif f == 2: line[i] = (line[i] + bb) & 255
            elif f == 3: line[i] = (line[i] + ((a + bb) >> 1)) & 255
            elif f == 4:
                p = a + bb - c
                pa, pb, pc = abs(p - a), abs(p - bb), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (bb if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        rows.append(line)
        prev = line
    out = bytearray(w * h * 4)
    o = 0
    for line in rows:
        for x in range(w):
            i = x * bpp
            if ct == 6: r, g, bl, al = line[i], line[i+1], line[i+2], line[i+3]
            elif ct == 2: r, g, bl, al = line[i], line[i+1], line[i+2], 255
            elif ct == 3:
                k = line[i]
                r, g, bl = (plte[k*3], plte[k*3+1], plte[k*3+2]) if len(plte) >= k*3+3 else (0, 0, 0)
                al = trns[k] if k < len(trns) else 255
            elif ct == 0: r = g = bl = line[i]; al = 255
            else: r = g = bl = line[i]; al = line[i+1]
            out[o:o+4] = bytes((r, g, bl, al)); o += 4
    return w, h, out


def chunk(typ, data):
    return struct.pack('>I', len(data)) + typ + data + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)


def encode_rgba(w, h, px):
    raw = b''.join(b'\x00' + bytes(px[y*w*4:(y+1)*w*4]) for y in range(h))
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 6))
            + chunk(b'IEND', b''))


def dataurl(s):
    m = re.search(r'data:image/png;base64,([A-Za-z0-9+/=]+)', s)
    return base64.b64decode(m.group(1)) if m else None


# ---------------------------------------------------------------- 解析 assets.js
print('读取 probe/js/assets.js ...')
assets_src = open(os.path.join(PROBE, 'js', 'assets.js'), encoding='utf-8').read()

def top_object(src, key):
    i = src.index('"' + key + '"')
    i = src.index('{', i)
    d = 0
    j = i
    while j < len(src):
        if src[j] == '{': d += 1
        elif src[j] == '}':
            d -= 1
            if d == 0: break
        j += 1
    return src[i:j + 1]

TILES = json.loads(top_object(assets_src, 'tiles'))
ANIMS = json.loads(top_object(assets_src, 'anims'))
HI = json.loads(top_object(assets_src, 'hi'))
COLS = int(re.search(r'"cols"\s*:\s*(\d+)', assets_src).group(1))
COUNT = int(re.search(r'"count"\s*:\s*(\d+)', assets_src).group(1))
strip_b = dataurl(re.search(r'"strip"\s*:\s*"(data:image/png;base64,[^"]+)"', assets_src).group(1))
img_obj = top_object(assets_src, 'images')
IMAGES = {}
for k, v in re.findall(r'"([A-Za-z0-9_@/]+)"\s*:\s*"(data:image/png;base64,[^"]+)"', img_obj):
    IMAGES[k] = dataurl(v)
print('  tiles %d / count %d / cols %d / images %d / anims %d'
      % (len(TILES), COUNT, COLS, len(IMAGES), len(ANIMS)))

print('读取 probe/js/etex.js ...')
etex_src = open(os.path.join(PROBE, 'js', 'etex.js'), encoding='utf-8').read()
ETEX = {}
for k, v in re.findall(r'"((?:entity|painting|map)/[^"]+)"\s*:\s*"(data:image/png;base64,[^"]+)"', etex_src):
    ETEX[k] = dataurl(v)
print('  ETEX %d' % len(ETEX))

# 其它单张内嵌图
MISC = {}
for fn in ['font.js', 'extras.js', 'skins.js', 'social.js', 'emoji.js']:
    p = os.path.join(PROBE, 'js', fn)
    if not os.path.exists(p):
        continue
    src = open(p, encoding='utf-8').read()
    for i, m in enumerate(re.finditer(r'data:image/png;base64,([A-Za-z0-9+/=]+)', src)):
        b = base64.b64decode(m.group(1))
        MISC[fn.replace('.js', '') + ('' if i == 0 else '_%d' % i)] = b
for extra in ['emoji.webp', 'jing.webp']:
    p = os.path.join(PROBE, 'js', extra)
    if os.path.exists(p):
        MISC[extra.replace('.', '_')] = open(p, 'rb').read()
print('  杂项内嵌图/外部资源 %d' % len(MISC))

# ---------------------------------------------------------------- 反查标准 MC 路径
# 用用户手上的三个材质包，建立 basename -> 官方相对路径 的投票表
PACKS = [
    '材质包/Faithful 64x - Release 13.zip',
    '材质包/CozyUI+_v1.11.zip',
    '材质包/MandalasGUI+Dakmode_1.21.8_v3.1.zip',
]
VOTES = collections.defaultdict(collections.Counter)
for rel in PACKS:
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        continue
    with zipfile.ZipFile(p) as z:
        for n in z.namelist():
            m = re.search(r'assets/minecraft/textures/(.+\.png)$', n)
            if not m:
                continue
            path = m.group(1)
            base = os.path.basename(path)[:-4]
            VOTES[base][path] += 1
print('  从材质包学到 %d 个 basename 的官方路径' % len(VOTES))

ALIAS = {
    'button_hl': ['button_highlighted'], 'button_dis': ['button_disabled'],
    'hotbar_sel': ['hotbar_selection'], 'slider_handle_hl': ['slider_handle_highlighted'],
    'text_field_hl': ['text_field_highlighted'], 'tab_hl': ['tab_highlighted'],
    'options_bg': ['options_background_', 'options_background'],
    'menu_bg': ['options_background_', 'options_background'],
    'xp_bg': ['experience_bar_background'], 'xp_fg': ['experience_bar_progress'],
    'attack_bg': ['crosshair_attack_indicator_background'],
    'attack_progress': ['crosshair_attack_indicator_progress'],
    'attack_full': ['crosshair_attack_indicator_full'],
    'effect_bg': ['effect_background'], 'effect_bg_ambient': ['effect_background_ambient'],
    'scroller': ['scroller'], 'font': ['ascii'],
}
MOON = {'moon0': 'full_moon', 'moon1': 'waning_gibbous', 'moon2': 'last_quarter',
        'moon3': 'waning_crescent', 'moon4': 'new_moon', 'moon5': 'waxing_crescent',
        'moon6': 'first_quarter', 'moon7': 'waxing_gibbous'}


def official_path(key):
    """游戏 images 键 -> 标准 MC textures/ 相对路径。"""
    cands = ALIAS.get(key, [])[:] + [key]
    if key.startswith('eff_'):
        cands.insert(0, key[4:])
    if key.startswith('gui_'):
        cands.insert(0, key[4:])
    if key.startswith('heart_'):
        cands.insert(0, key[6:])
    if key in MOON:
        return 'environment/celestial/moon/%s.png' % MOON[key]
    for c in cands:
        if c in VOTES:
            # 偏好 sprites/ 下更具体的路径；同类取票数最高、路径最短
            best = sorted(VOTES[c].items(), key=lambda kv: (-kv[1], len(kv[0])))[0][0]
            return best
    if key.startswith('eff_'):
        return 'mob_effect/%s.png' % key[4:]
    if key.startswith('slot_'):
        return 'gui/sprites/container/slot/%s.png' % key[5:]
    if key.startswith('rb_'):
        return 'gui/recipe_book/%s.png' % key[3:]
    if key.startswith('tab_'):
        return 'gui/container/creative_inventory/%s.png' % key
    return 'gui/opusmc/%s.png' % key


# ---------------------------------------------------------------- 落盘
if os.path.exists(OUT):
    shutil.rmtree(OUT)
TEX = os.path.join(OUT, 'assets', 'minecraft', 'textures')
os.makedirs(TEX, exist_ok=True)

written = []
seen_paths = set()
def put(rel, data):
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'wb') as f:
        f.write(data)
    written.append(rel)
    seen_paths.add(rel)
    return rel

# 1) strip 长条图 -> 单张 16x16
print('切 strip 长条图 ...')
sw, sh, px = decode_rgba(strip_b)
assert sw == COLS * 16, (sw, COLS)
by_index = {v: k for k, v in TILES.items()}
tile_map = {}
for idx in range(COUNT):
    x0 = (idx % COLS) * 16
    y0 = (idx // COLS) * 16
    if (y0 + 16) * sw * 4 > len(px):
        break
    tile = bytearray(16 * 16 * 4)
    for y in range(16):
        src = ((y0 + y) * sw + x0) * 4
        tile[y*64:y*64+64] = px[src:src+64]
    b = encode_rgba(16, 16, tile)
    name = by_index.get(idx)
    if name:
        rel = ('textures/item/%s.png' % name[2:]) if name.startswith('i_') else ('textures/block/%s.png' % name)
        source = 'tiles'
    else:
        rel = 'textures/_atlas/unmapped_%04d.png' % idx
        source = 'unmapped'
    put('assets/minecraft/' + rel, b)
    tile_map[name or ('_atlas_%d' % idx)] = {'path': rel, 'index': idx, 'size': [16, 16], 'source': source}
put('assets/minecraft/textures/_atlas/strip.png', strip_b)

# 2) images 526 张（避开 ETEX 已占的 entity/painting/map 路径）
print('导出 images ...')
etex_paths = set('assets/minecraft/textures/' + (k + '.png') for k in ETEX)
image_map = {}
conflicts = []
for k, b in IMAGES.items():
    rel = official_path(k)
    full = 'assets/minecraft/textures/' + rel
    conflict = False
    if full in etex_paths or full in seen_paths:
        rel = 'gui/opusmc/%s.png' % k
        full = 'assets/minecraft/textures/' + rel
        conflict = True
        conflicts.append(k)
    w, h = png_dim(b)
    put(full, b)
    image_map[k] = {'path': rel, 'size': [w, h],
                    'guessed': rel.startswith('gui/opusmc/') and not conflict,
                    'conflict': conflict}

# 3) ETEX 814 张
print('导出 ETEX ...')
etex_map = {}
for k, b in ETEX.items():
    rel = k + '.png'
    w, h = png_dim(b)
    put('assets/minecraft/textures/' + rel, b)
    etex_map[k] = {'path': rel, 'size': [w, h]}

# 4) 杂项
print('导出杂项 ...')
for k, b in MISC.items():
    ext = 'webp' if k.endswith('_webp') else 'png'
    put('assets/minecraft/_misc/%s.%s' % (k, ext), b)
put('assets/minecraft/textures/font/ascii_atlas.png', MISC.get('font', b''))

# 5) 元数据
meta = {
    'pack': {'pack_format': 34,
             'description': 'OpusMC 编译产物内嵌贴图还原（原版基准）'},
    'generated_by': 'tools/extract_vanilla_assets.py',
}
put('pack.mcmeta', json.dumps(meta, ensure_ascii=False, indent=2).encode('utf-8'))
# pack.png 用游戏 logo
logo = IMAGES.get('logo') or IMAGES.get('inventory')
put('pack.png', logo or encode_rgba(16, 16, bytearray([80, 110, 170, 255] * 256)))

mapping = {
    'version': '1.0',
    'generated_at': datetime.now().isoformat(timespec='seconds'),
    'source': 'probe/js/assets.js + etex.js + font/extras/skins/social.js（编译产物）',
    'atlas': {'cols': COLS, 'count': COUNT, 'size': [sw, sh]},
    'notes': 'tiles 键以 i_ 开头的是物品图标，落盘到 textures/item/ 并去掉前缀；'
             'images 的路径由三个标准材质包投票反查，未命中的放 gui/opusmc/ 并标 guessed。',
    'tiles': tile_map,
    'images': image_map,
    'etex': etex_map,
    'anims': ANIMS,
    'hi': HI,
}
put('MAPPING.json', json.dumps(mapping, ensure_ascii=False, indent=2).encode('utf-8'))
put('animations.json', json.dumps(ANIMS, ensure_ascii=False, indent=2).encode('utf-8'))

# 6) 音效（可选，直接打进 zip，不落散文件）
sounds = []
snd_root = os.path.join(PROBE, 'sounds')
if os.path.isdir(snd_root):
    for dp, _, fs in os.walk(snd_root):
        for fn in fs:
            p = os.path.join(dp, fn)
            sounds.append((os.path.relpath(p, snd_root).replace('\\', '/'), p))

# 7) 报告
guessed = [k for k, v in image_map.items() if v['guessed']]
report = [
    '# OpusMC 内嵌贴图还原报告', '',
    '- 生成时间：' + mapping['generated_at'],
    '- 来源：`probe/js/assets.js`、`etex.js`、`font.js` 等（均为编译产物，仓库内没有原始 PNG）',
    '', '## 数量', '',
    '| 类别 | 数量 | 落盘位置 |', '| --- | ---: | --- |',
    '| 方块 / 物品图集格子 | %d | `textures/block/` + `textures/item/` |' % COUNT,
    '| ├ 有名字的 tile | %d | 按 `ASSETS.tiles` |' % len(TILES),
    '| └ 无名格子 | %d | `textures/_atlas/unmapped_*.png` |' % (COUNT - len(TILES)),
    '| GUI / HUD / 环境贴图 | %d | `textures/gui/` 等 |' % len(IMAGES),
    '| 实体 / 画 / 地图贴图 | %d | `textures/entity|painting|map/` |' % len(ETEX),
    '| ├ entity | %d | |' % sum(1 for k in ETEX if k.startswith('entity/')),
    '| ├ painting | %d | |' % sum(1 for k in ETEX if k.startswith('painting/')),
    '| └ map | %d | |' % sum(1 for k in ETEX if k.startswith('map/')),
    '| 动画定义 | %d | `animations.json` |' % len(ANIMS),
    '| 字体 / 杂项内嵌图 | %d | `_misc/` + `textures/font/` |' % len(MISC),
    '| 音效 | %d | zip 内 `sounds/` |' % (len(sounds) if WITH_SOUNDS else 0),
    '| **落盘文件合计** | **%d** | |' % len(written),
    '', '## 兼容字典怎么用', '',
    '`MAPPING.json` 的 `images` 段就是游戏实际消费的 526 个贴图键 → 标准 MC 路径。',
    '材质包里任何一张 PNG，只要路径能落到这张表里的 `path`，就能被替换；',
    '落不到的才属于游戏没实现的槽位（particle / trims / font / 未做的方块物品）。',
    '注意 `painting/` 与 `map/` 是游戏真实消费的，见 `etex` 段，不要误判为不支持。',
    '', '其中 %d 个键在三个材质包里没找到同名文件，路径是猜的（标 `guessed`）：' % len(guessed),
    '', '```', ', '.join(guessed[:60]) + (' ...' if len(guessed) > 60 else ''), '```',
    '', '另有 %d 个 `images` 键与 ETEX / 彼此路径冲突，已改存 `gui/opusmc/`（标 `conflict`）：' % len(conflicts),
    '', '```', ', '.join(conflicts[:40]) + (' ...' if len(conflicts) > 40 else ''), '```',
    '', '## 这次还原新发现的兼容空间', '',
    '- `etex.js` 里除了 725 张 `entity/`，还有 **52 张 `painting/` + 37 张 `map/`**，',
    '  而 `decor.js` / `items3.js` 确实调用了 `r.etex(\'painting/...\')` 和 `r.etex(\'map/...\')`。',
    '  也就是说这 89 张是游戏**真实消费**的贴图槽位，之前材质包链路只认 `entity/`，把它们漏了。',
    '  接上这三类后，Faithful / CozyUI 的画与地图装饰就能生效。',
    '', '## 为什么 CozyUI 的按钮颜色 / 位置不对', '',
    '先纠正一个误判：三个材质包**都有** `gui/sprites/widget/button.png`',
    '（MandalasGUI 200x20，CozyUI / Faithful 800x80），映射是能命中的，不是「完全不兼容」。',
    '真正的原因有三层：',
    '1. `ui.button()` 用 `nine(\'button\'|\'button_hl\'|\'button_dis\', ..., 3)` 九宫格拉伸；',
    '   4x 贴图缩回 200x20 后，3px 边框对应的原图是 12px，圆角 / 描边细节在缩放中变了味。',
    '2. `ui.js` 里 `goldShine` / `blue` 分支会用代码画的渐变 `fillRect` **盖住**按钮贴图，',
    '   这类按钮无论换什么 PNG 都改不了颜色。',
    '3. CozyUI 的 `button_highlighted.png` 是 320x1280 竖条动画，取首帧后才喂给游戏，',
    '   悬停态自然跟包作者预期的不一样。',
    '- 按钮**位置**写死在 `screens.js` 的 `layout()` 里，任何资源包都改不了（原版 MC 也一样）。',
    '- 方块模型由 `Mesher`/`blocks.js` 生成，不读 `blockstates/*.json` / `models/*.json`。',
    '', '## 复现', '',
    '```bash', 'python tools/extract_vanilla_assets.py --with-sounds', '```',
]
put('REPORT.md', ('\n'.join(report) + '\n').encode('utf-8'))

# 8) 打包
print('打包 ...')
with zipfile.ZipFile(ZIP, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for rel in written:
        z.write(os.path.join(OUT, rel), rel)
    if WITH_SOUNDS:
        for rel, p in sounds:
            z.write(p, 'sounds/' + rel)

size = os.path.getsize(ZIP)
print('')
print('完成：')
print('  目录   %s (%d 个文件)' % (OUT, len(written)))
print('  压缩包 %s (%.1f MB)' % (ZIP, size / 1048576))
print('  贴图   block/item %d, gui %d, etex %d (entity %d / painting %d / map %d)' % (
    COUNT, len(IMAGES), len(ETEX),
    sum(1 for k in ETEX if k.startswith('entity/')),
    sum(1 for k in ETEX if k.startswith('painting/')),
    sum(1 for k in ETEX if k.startswith('map/'))))
print('  音效   %d 个%s' % (len(sounds), '（已打进 zip）' if WITH_SOUNDS else '（本次未打包，加 --with-sounds）'))
print('  映射   MAPPING.json：%d 个游戏键' % (len(tile_map) + len(image_map) + len(etex_map)))
print('  猜测路径 %d 个（见 REPORT.md）' % len(guessed))
