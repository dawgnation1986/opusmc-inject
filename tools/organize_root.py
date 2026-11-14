# -*- coding: utf-8 -*-
"""
整理 opusmc-inject 根目录（只移动，不删除，可逆，幂等）。

不移动的东西（被启动器 / 工具 / 脚本硬编码或用户常读）：
  probe/, tools/, PHPMC/, mods/, opusmc-source/, vanilla-assets/, 材质包/,
  launch-*.bat, start-game.cmd, opusmc-hud.user.js, opusmc-resourcepack.user.js,
  opusmc-dark-gui-lite.zip, opusmc-vanilla-assets.zip, opusmc-v47685-src/,
  README.md, HANDOFF.md, DEBUG-HANDOFF.md, 服务端-客户端协议清单.md, .git*

nul 是 Windows 保留设备名（历史误创建），文件系统 API 无法移动，留在原位由 .gitignore 忽略。

运行后生成：
  目录结构.md                 导航与分类说明
  tools/undo_organize.py      一键还原
"""
import os, shutil, sys, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MOVES = [
    ('fabric-port-docs',           'docs/fabric-port-docs'),
    ('fx-client',                  'docs/fx-client'),
    ('comet-mod',                  'dev/comet-mod'),
    ('opusmc-hud.user.zip',        '_archive/opusmc-hud.user.zip'),
    ('ring-patterns-preview.png',  '_archive/ring-patterns-preview.png'),
    ('opus-mc18-link.user.js',     '_archive/legacy/opus-mc18-link.user.js'),
    ('opus-resource-dump.user.js', '_archive/legacy/opus-resource-dump.user.js'),
    ('.tmp-online',                '_archive/tmp-online'),
    ('源码备份',                   '_archive/源码备份'),
    ('back',                       '_archive/back'),
]

def main():
    done, skipped, failed = [], [], []
    for src, dst in MOVES:
        s, d = os.path.join(ROOT, src), os.path.join(ROOT, dst)
        if os.path.exists(d):
            skipped.append((src, dst, '目标已存在')); continue
        if not os.path.exists(s):
            skipped.append((src, dst, '源不存在')); continue
        try:
            os.makedirs(os.path.dirname(d), exist_ok=True)
            shutil.move(s, d)
            done.append((src, dst))
            print('  移动 %-32s -> %s' % (src, dst))
        except Exception as e:
            failed.append((src, str(e)))
            print('  失败 %-32s %s' % (src, e))

    # 记录里要包含之前已移动成功的项，否则还原脚本不完整
    record = os.path.join(ROOT, 'tools', '.organize-record.json')
    all_moves = list(done)
    if os.path.exists(record):
        try:
            all_moves = json.load(open(record, encoding='utf-8'))
        except Exception:
            pass
    seen = set()
    merged = []
    for pair in all_moves + done:
        k = tuple(pair)
        if k not in seen:
            seen.add(k); merged.append(list(pair))
    with open(record, 'w', encoding='utf-8', newline='') as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)

    gi = os.path.join(ROOT, '.gitignore')
    t = open(gi, encoding='utf-8', newline='').read()
    if '_archive/' not in t:
        t = t.rstrip('\n') + '\n\n# 整理后的归档目录（organize_root.py）\n_archive/\n'
        open(gi, 'w', encoding='utf-8', newline='').write(t)
        print('  已更新 .gitignore（_archive/ 不入库）')

    undo = os.path.join(ROOT, 'tools', 'undo_organize.py')
    with open(undo, 'w', encoding='utf-8', newline='') as f:
        f.write('# -*- coding: utf-8 -*-\n')
        f.write('"""把 organize_root.py 移动过的文件全部还原。"""\n')
        f.write('import os, shutil, json\n')
        f.write('ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))\n')
        f.write('MOVES = json.load(open(os.path.join(ROOT, "tools", ".organize-record.json"), encoding="utf-8"))\n')
        f.write('''n = 0
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
''')
    print('\n本次移动 %d 项，跳过 %d 项，失败 %d 项' % (len(done), len(skipped), len(failed)))
    print('记录共 %d 项 -> tools/.organize-record.json' % len(merged))
    print('已生成 tools/undo_organize.py')
    if failed:
        sys.exit(1)

if __name__ == '__main__':
    main()
