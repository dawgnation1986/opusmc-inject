# -*- coding: utf-8 -*-
"""
把 PEVersion/mods/*/data.js 里以路径引用的 tiles.png 换成 dataURL。

file:// 双击时，drawImage(本地 PNG) 会污染 canvas，render.js 的 getImageData
随后抛 "The canvas has been tainted by cross-origin data"，游戏启动失败。
把 PNG 变成 data:image/png;base64,... 后同源，问题消失。

用法：python tools/inline_mod_tiles.py [目标目录，默认 PEVersion]
幂等：已经是 data: 的不再处理。
"""
import base64, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, 'PEVersion')
MODS = os.path.join(DST, 'mods')

pat = re.compile(r"""(src:\s*)(['"])(mods/[^'"]+\.png)\2""")
n = 0
for d, _, fs in os.walk(MODS):
    if 'data.js' not in fs:
        continue
    js = os.path.join(d, 'data.js')
    s = open(js, encoding='utf-8', newline='').read()
    def rep(m):
        global n
        rel = m.group(3)
        if rel.startswith('data:'):
            return m.group(0)
        png = os.path.join(DST, rel.replace('/', os.sep))
        if not os.path.isfile(png):
            print('  跳过（文件不存在）:', rel)
            return m.group(0)
        b64 = base64.b64encode(open(png, 'rb').read()).decode('ascii')
        n += 1
        print('  内嵌 %-42s %.1f KB' % (rel, os.path.getsize(png) / 1024))
        return m.group(1) + m.group(2) + 'data:image/png;base64,' + b64 + m.group(2)
    out = pat.sub(rep, s)
    if out != s:
        open(js, 'w', encoding='utf-8', newline='').write(out)

print('共内嵌 %d 张贴图' % n)
if n == 0:
    print('（若已全部内嵌，这是正常的）')
