# -*- coding: utf-8 -*-
"""从 opusmc-source/assets/ 下的独立方块 / 物品 PNG 重建 _atlas/strip.png。

游戏 render.init() 读的是一张 1024x672 的长条图（64 列 x 2650 格 16x16）。
这个脚本按 opusmc-source/js/assets.js 里注入的 `tileFiles` 映射，
把每格对应的独立 PNG 画回去，生成同样尺寸的 strip.png。

用法：python tools/rebuild_atlas.py
改完任意一张 block/*.png 或 item/*.png 后跑一次，再刷新页面即可。
零第三方依赖。
"""
import json
import os
import re
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DST = os.path.join(ROOT, 'opusmc-source')
ASSETS_JS = os.path.join(DST, 'js', 'assets.js')
OUT = os.path.join(DST, 'assets', 'minecraft', 'textures', '_atlas', 'strip.png')


def decode_rgba(b):
    w = h = bd = ct = 0
    plte = trns = b''
    idat = b''
    p = 8
    while p + 8 <= len(b):
        ln = struct.unpack('>I', b[p:p + 4])[0]
        typ, data = b[p + 4:p + 8], b[p + 8:p + 8 + ln]
        p += 12 + ln
        if typ == b'IHDR':
            w, h, bd, ct, _, _, inter = struct.unpack('>IIBBBBB', data)
            if inter or bd != 8:
                raise ValueError('只支持 8bit 非隔行 PNG')
        elif typ == b'PLTE': plte = data
        elif typ == b'tRNS': trns = data
        elif typ == b'IDAT': idat += data
        elif typ == b'IEND': break
    chans = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    bpp, stride = chans, w * chans
    raw = zlib.decompress(idat)
    rows, prev, q = [], bytearray(stride), 0
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
                pp = a + bb - c
                pa, pb, pc = abs(pp - a), abs(pp - bb), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (bb if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        rows.append(line); prev = line
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
    return (struct.pack('>I', len(data)) + typ + data
            + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff))


def encode_rgba(w, h, px):
    raw = b''.join(b'\x00' + bytes(px[y*w*4:(y+1)*w*4]) for y in range(h))
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 6))
            + chunk(b'IEND', b''))


if not os.path.isfile(ASSETS_JS):
    sys.exit('先运行 tools/build_source_tree.py')

s = open(ASSETS_JS, encoding='utf-8').read()
m = re.search(r'"tileFiles"\s*:\s*\{', s)
if not m:
    sys.exit('assets.js 里没有 tileFiles，先重跑 build_source_tree.py')
i = m.end() - 1
d = 0
j = i
while j < len(s):
    if s[j] == '{': d += 1
    elif s[j] == '}':
        d -= 1
        if d == 0: break
    j += 1
TILEFILES = json.loads(s[i:j + 1])
COLS = int(re.search(r'"cols"\s*:\s*(\d+)', s).group(1))
COUNT = int(re.search(r'"count"\s*:\s*(\d+)', s).group(1))
W = COLS * 16
H = ((COUNT + COLS - 1) // COLS) * 16

# 以现有 strip 打底：559 个无名格子（动画帧 / 额外层）没有独立 PNG，
# 必须保留原像素，不能清空，否则游戏里会缺贴图。
base = None
if os.path.isfile(OUT):
    bw, bh, base = decode_rgba(open(OUT, 'rb').read())
    if (bw, bh) != (W, H):
        base = None
canvas = bytearray(base) if base else bytearray(W * H * 4)

# 键是 tile 名，值是相对路径；索引从 ASSETS.tiles 里查
ti = re.search(r'"tiles"\s*:\s*\{', s).start()
ti = s.index('{', ti)
d = 0
tj = ti
while tj < len(s):
    if s[tj] == '{': d += 1
    elif s[tj] == '}':
        d -= 1
        if d == 0: break
    tj += 1
TILES = json.loads(s[ti:tj + 1])

by_index = {v: k for k, v in TILES.items()}
placed = 0
missing = 0
for idx in range(COUNT):
    name = by_index.get(idx)
    rel = TILEFILES.get(name) if name else None
    if not rel:
        missing += 1
        continue
    p = os.path.join(DST, rel)
    if not os.path.isfile(p):
        missing += 1
        continue
    tw, th, px = decode_rgba(open(p, 'rb').read())
    if tw != 16 or th != 16:
        # 高清贴图：整张缩到 16x16（最近邻，和游戏里 rpDecode 的行为一致）
        small = bytearray(16 * 16 * 4)
        for y in range(16):
            sy = min(th - 1, y * th // 16)
            for x in range(16):
                sx = min(tw - 1, x * tw // 16)
                small[(y*16+x)*4:(y*16+x)*4+4] = px[(sy*tw+sx)*4:(sy*tw+sx)*4+4]
        px = small
    x0 = (idx % COLS) * 16
    y0 = (idx // COLS) * 16
    for y in range(16):
        off = ((y0 + y) * W + x0) * 4
        canvas[off:off + 64] = px[y*64:y*64+64]
    placed += 1

os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'wb').write(encode_rgba(W, H, canvas))
print('重建 %s' % OUT)
print('  尺寸 %dx%d，格子 %d，已填 %d，缺失 %d' % (W, H, COUNT, placed, missing))
print('  改完 block/*.png 或 item/*.png 后刷新页面即可看到变化')
