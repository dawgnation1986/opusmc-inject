# -*- coding: utf-8 -*-
"""
自定义模组安装器（离线版用）。

游戏 v47685 的 modapi.js 要求 data.js 里先有 OpusMC._prelude(id, {ids, textures})，
官方 SDK 用 tools/modsdk/install_mod.js 生成，但那份没随源码发布。这个脚本按
probe/js/modapi.js 里读到的格式自己生成，并注册到 probe/mods/index.json。

用法：
  python tools/install_mod.py <模组目录>
  python tools/install_mod.py examples/mods/helloblock

模组目录里应有：
  mod.json          元数据（id/name/en/brief/version...）
  data.js           内容定义（不能含 _prelude，脚本会加在开头）
  code.js           玩法事件（可选）
  textures/*.png    自定义贴图（可选，16x16）

生成/更新：
  probe/mods/<id>/data.js    带 _prelude 前导
  probe/mods/<id>/code.js
  probe/mods/<id>/textures/
  probe/mods/index.json      追加/更新该模组条目
"""
import os, sys, json, shutil, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROBE_MODS = os.path.join(ROOT, 'probe', 'mods')
BLOCK_ID_START = 4096      # 原版 BLOCK_DATA 到 2089，从这里起不会撞
ITEM_ID_START = 10000      # ITEM_DATA 是数组，SDK 用 id 直接索引/查表


def read_existing_ids(exclude=None):
    """从已有模组 data.js 的 _prelude 里收集占用过的编号，避免重复分配。
    exclude 是本模组 id：重复安装时不要把自己上次分的号算成占用。"""
    used_b, used_i = set(), set()
    for d, _, fs in os.walk(PROBE_MODS):
        if 'data.js' not in fs:
            continue
        if exclude and os.path.basename(d) == exclude:
            continue
        try:
            s = open(os.path.join(d, 'data.js'), encoding='utf-8').read(8000)
        except Exception:
            continue
        import re
        m = re.search(r'_prelude\([^,]+,\s*(\{.*?\})\s*\)\s*;', s, re.S)
        if not m:
            continue
        try:
            p = json.loads(m.group(1))
            for v in p.get('ids', {}).get('blocks', {}).values():
                used_b.add(int(v))
            for v in p.get('ids', {}).get('items', {}).values():
                used_i.add(int(v))
        except Exception:
            pass
    return used_b, used_i


def next_id(used, start):
    i = start
    while i in used:
        i += 1
    return i


def main():
    if len(sys.argv) < 2:
        sys.exit('用法: python tools/install_mod.py <模组目录>')
    src = os.path.abspath(sys.argv[1])
    meta_path = os.path.join(src, 'mod.json')
    if not os.path.isdir(src) or not os.path.exists(meta_path):
        sys.exit('找不到模组目录或 mod.json: ' + src)

    meta = json.load(open(meta_path, encoding='utf-8'))
    mid = meta.get('id', '')
    import re
    if not re.fullmatch(r'[a-z][a-z0-9_]{1,31}', mid):
        sys.exit('模组 id 不合规（小写字母开头，2-32 个小写字母/数字/下划线）: ' + mid)
    if not os.path.exists(os.path.join(src, 'data.js')):
        sys.exit('缺少 data.js')

    data = open(os.path.join(src, 'data.js'), encoding='utf-8').read()
    # SDK 的命名约束：方块/物品的 key 必须等于 id 或以 id_ 开头
    keys_b = re.findall(r"blocks\s*:\s*\{(.*?)\n\s*\}", data, re.S)
    keys_i = re.findall(r"items\s*:\s*\{(.*?)\n\s*\}", data, re.S)
    def key_names(chunks):
        out = []
        for c in chunks:
            out += re.findall(r"['\"]?([a-z0-9_]+)['\"]?\s*:\s*\{", c)
        return [k for k in out if k == mid or k.startswith(mid + '_')]
    bn, itn = key_names(keys_b), key_names(keys_i)

    used_b, used_i = read_existing_ids(mid)
    bmap, imap = {}, {}
    for k in bn:
        v = next_id(used_b, BLOCK_ID_START); used_b.add(v); bmap[k] = v
    for k in itn:
        v = next_id(used_i, ITEM_ID_START); used_i.add(v); imap[k] = v
    # 方块自带物品，编号与方块一致
    for k in bn:
        imap.setdefault(k, bmap[k])

    tex_dir = os.path.join(src, 'textures')
    textures = sorted(f[:-4] for f in os.listdir(tex_dir)
                      if f.lower().endswith('.png')) if os.path.isdir(tex_dir) else []

    prelude = {
        'ids': {'blocks': bmap, 'items': imap},
        'textures': textures,
        'version': meta.get('version', '1.0.0'),
        'name': meta.get('name', mid),
    }
    if '_prelude(' in data:
        # 重复安装：去掉旧前导再加新的
        data = re.sub(r'^// 由 tools/install_mod\.py.*?\nOpusMC\._prelude\(.*?\);\n', '',
                      data, count=1, flags=re.S)
    # 'use strict' 必须是脚本第一条语句才生效，所以提到最前面
    strict = ''
    data = data.lstrip()
    if data.startswith("'use strict';") or data.startswith('"use strict";'):
        q = "'use strict';" if data.startswith("'use strict';") else '"use strict";'
        strict = q + '\n'
        data = data[len(q):].lstrip('\n')
    head = (strict +
            '// 由 tools/install_mod.py 生成，请勿手改前导\n'
            'OpusMC._prelude(' + json.dumps(mid) + ', ' +
            json.dumps(prelude, ensure_ascii=False) + ');\n')
    data = head + data

    dst = os.path.join(PROBE_MODS, mid)
    os.makedirs(dst, exist_ok=True)
    open(os.path.join(dst, 'data.js'), 'w', encoding='utf-8', newline='').write(data)

    files = ['data.js']
    if os.path.exists(os.path.join(src, 'code.js')):
        shutil.copy2(os.path.join(src, 'code.js'), os.path.join(dst, 'code.js'))
        files.append('code.js')
    if textures:
        os.makedirs(os.path.join(dst, 'textures'), exist_ok=True)
        for f in sorted(os.listdir(tex_dir)):
            if f.lower().endswith('.png'):
                shutil.copy2(os.path.join(tex_dir, f), os.path.join(dst, 'textures', f))
                files.append('textures/' + f)

    # 注册进 index.json
    ip = os.path.join(PROBE_MODS, 'index.json')
    idx = json.load(open(ip, encoding='utf-8'))
    entry = {k: v for k, v in meta.items() if k != 'files'}
    entry['files'] = files
    total = sum(os.path.getsize(os.path.join(dst, f)) for f in files)
    entry['size'] = total
    mods = idx['mods']
    for i, m in enumerate(mods):
        if m.get('id') == mid:
            mods[i] = entry; break
    else:
        mods.append(entry)
    open(ip, 'w', encoding='utf-8', newline='').write(
        json.dumps(idx, ensure_ascii=False, indent=2) + '\n')

    print('已安装 %s -> probe/mods/%s/' % (mid, mid))
    print('  方块编号', bmap)
    print('  物品编号', imap)
    print('  贴图', textures)
    print('  文件', files, '共', total, 'B')
    print('\n本地测试（离线版 8777）：')
    print('  http://localhost:8777/game.html?modtest=' + mid)
    print('  或把它加进 probe/game.html 的 self.MODS_ALWAYS 让它成为内置模组')


if __name__ == '__main__':
    main()
