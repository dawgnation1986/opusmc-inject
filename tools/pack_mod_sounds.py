# -*- coding: utf-8 -*-
"""把模组音效也内嵌进 PEVersion/js/sounds.js。

原版 4849 个音效由 build_pe_sounds.py 打包，key 是 'ambient/cave/cave1' 这种。
模组（匠魂/农夫乐事）的事件名带 '../../mods/<id>/sounds/xxx' 相对路径，
audio.js 用 SOUNDS.files[name] 查，所以 key 必须一字不差带上这个前缀。

本脚本：
  1. 从各 bundle.js 里正则抽出所有 '../../mods/.../sounds/NAME' 引用
  2. 找到对应 m4a，base64 追加进 sounds.js 的 files 对象（保持原 4849 项不变）
  3. 同时把这些事件并进 SOUNDS.events（必要时），让按名字播放能找到

幂等：已存在的 key 不重复写。
用法：python tools/pack_mod_sounds.py
"""
import base64, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PE = os.path.join(ROOT, 'PEVersion')
SJ = os.path.join(PE, 'js', 'sounds.js')

s = open(SJ, encoding='utf-8', errors='replace').read()
m = re.search(r'window\.SOUNDS = \{events: (\{.*?\}), files:\{\n(.*?)\n\}\};', s, re.S)
if not m:
    sys.exit('sounds.js 结构变了，无法解析')
events, files_blob = json.loads(m.group(1)), m.group(2)
existing = set(re.findall(r'^"([^"]+)":', files_blob, re.M))
print('现有事件 %d / 音效 %d' % (len(events), len(existing)))

# 从 bundle.js 抽模组音效名（带 ../../mods/... 前缀）
wanted = {}
for d, _, fs in os.walk(os.path.join(PE, 'mods')):
    for f in fs:
        if f != 'bundle.js':
            continue
        b = open(os.path.join(d, f), encoding='utf-8', errors='ignore').read()
        for name in re.findall(r'"(\.\./\.\./mods/[a-z0-9_]+/sounds/[a-z0-9_]+)"', b):
            wanted[name] = None

print('模组音效引用名 %d 个' % len(wanted))

# 解析出实际文件：'../../mods/tconstruct/sounds/bonk' -> PE/mods/tconstruct/sounds/bonk.m4a
add = []
for name in sorted(wanted):
    if name in existing:
        continue
    rel = name.replace('../../', '', 1)  # mods/tconstruct/sounds/bonk
    m4a = os.path.join(PE, rel + '.m4a')
    if not os.path.isfile(m4a):
        print('  缺文件:', rel + '.m4a')
        continue
    add.append((name, m4a))

print('待新增 %d 个' % len(add))
if not add:
    print('已是最新，无需改动')
    sys.exit(0)

# 干净结构：...最后一项"key":"base64",\n}};\n
# 最后一项已带逗号，所以新项直接插在 '\n}};' 之前，不要再加逗号
end = s.rfind('\n}};')
assert end > 0, '找不到 files 对象结尾'
additions = []
for name, path in add:
    b64 = base64.b64encode(open(path, 'rb').read()).decode('ascii')
    additions.append('%s:%s,' % (json.dumps(name), json.dumps(b64)))
out_text = s[:end] + '\n' + '\n'.join(additions) + s[end:]
open(SJ, 'w', encoding='utf-8', newline='\n').write(out_text)

sz = os.path.getsize(SJ)
print('已更新 sounds.js (%.1f MB)，新增 %d 个模组音效' % (sz / 1024 / 1024, len(add)))

# 校验
chk = open(SJ, encoding='utf-8', errors='replace').read()
mm = re.search(r'files:\{\n(.*?)\n\}\};', chk, re.S)
keys = set(re.findall(r'^"([^"]+)":', mm.group(1), re.M)) if mm else set()
missing = [n for n, _ in add if n not in keys]
print('校验：新增 %d 个，缺失 %d 个' % (len(add) - len(missing), len(missing)))
