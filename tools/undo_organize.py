# -*- coding: utf-8 -*-
"""把 organize_root.py 移动过的文件全部还原。"""
import os, shutil, json
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOVES = json.load(open(os.path.join(ROOT, "tools", ".organize-record.json"), encoding="utf-8"))
n = 0
for src, dst in reversed(MOVES):
    s, d = os.path.join(ROOT, src), os.path.join(ROOT, dst)
    if not os.path.exists(d):
        print('跳过（不在归档位置）:', dst); continue
    if os.path.exists(s):
        print('跳过（原位已有同名）:', src); continue
    os.makedirs(os.path.dirname(s), exist_ok=True)
    shutil.move(d, s); n += 1
    print('还原 %s -> %s' % (dst, src))
print('已还原', n, '项')
