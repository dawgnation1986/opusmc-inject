# -*- coding: utf-8 -*-
# patch_v210_verify.py — verify-adaptation.mjs 适配 v2.1.0（chest 扩展下标 + meta props 检查）
import os
os.chdir(r"D:\discuz\webmc\hook\opusmc-inject")
p = 'tools/verify-adaptation.mjs'
t = open(p, newline='', encoding='utf-8').read()
EOL = "\r\n" if "\r\n" in t else "\n"

def rep(old, new, n=1):
    global t
    o = old.replace("\n", EOL); nn = new.replace("\n", EOL)
    c = t.count(o)
    assert c == n, 'old 命中 %d 次（应 %d）: %r...' % (c, n, old[:80])
    t = t.replace(o, nn)

rep("""import { VERSION, BLOCK_NAMES, BIOME_NAMES, chunkToOpus, packPosBytes, unpackPos } from './chunk-format.mjs';""",
"""import { VERSION, BLOCK_NAMES, BIOME_NAMES, CHEST_EXTRA_BASE, chunkToOpus, packPosBytes, unpackPos } from './chunk-format.mjs';""")

rep("""      let bad = 0;
      for (let j = 0; j < 4096; j++) { cells++; if (got.raw[j] !== expect[j]) { bad++; badCells++; } }
      if (bad) badSec++;""",
"""      let bad = 0;
      for (let j = 0; j < 4096; j++) {
        cells++;
        const e = expect[j], g = got.raw[j], cid = e >> 4;
        const isChest = cid === 54 || cid === 146 || cid === 130;
        // 相邻箱子会被换成扩展下标（大箱子左右半边），基准独立地只放宽这一格
        const okCell = g === e || (isChest && g >= CHEST_EXTRA_BASE && g < CHEST_EXTRA_BASE + 8);
        if (!okCell) { bad++; badCells++; }
      }
      if (bad) badSec++;""")

rep("""  ok(BLOCK_NAMES.length === 4096 && BIOME_NAMES.length === 256, 'states/biomes 表长度正确');""",
"""  ok(BLOCK_NAMES.length === CHEST_EXTRA_BASE + 8 && BIOME_NAMES.length === 256, 'states 表长度（含大箱子扩展项）正确');""")

rep("""  ok(miss === 0, `抽查 9 个常见状态都能被客户端映射（失败 ${miss}）`);
  ok(airish === 0, `抽查状态没有被映射成空气（异常 ${airish}）`);
}""",
"""  ok(miss === 0, `抽查 9 个常见状态都能被客户端映射（失败 ${miss}）`);
  ok(airish === 0, `抽查状态没有被映射成空气（异常 ${airish}）`);
  const mapState = (raw) => JSON.parse(vm.runInContext(
    `JSON.stringify(mapVanillaStateNear(${JSON.stringify(BLOCK_NAMES[raw])}))`, ctx));
  // 同一方块的不同 meta 必须映射出不同的客户端 meta（朝向 / 生长阶段真的生效）
  const groups = {
    '梯子朝向': [(65 << 4) | 2, (65 << 4) | 3, (65 << 4) | 4, (65 << 4) | 5],
    '作物阶段': [(59 << 4) | 0, (59 << 4) | 3, (59 << 4) | 7],
    '台阶上下半': [(126 << 4) | 0, (126 << 4) | 1],
    '楼梯朝向': [(53 << 4) | 0, (53 << 4) | 1, (53 << 4) | 4],
    '箱子朝向': [(54 << 4) | 2, (54 << 4) | 3, (54 << 4) | 4, (54 << 4) | 5],
  };
  for (const [label, raws] of Object.entries(groups)) {
    const ms = raws.map((r) => { const v = mapState(r); return v ? v[1] : null; });
    ok(ms.every((m) => m !== null) && new Set(ms).size > 1, `${label} 的不同 meta 映射出不同状态 [${ms.join(',')}]`);
  }
  // 大箱子扩展下标 -> 客户端 meta bit4(left)/bit5(right)
  const l = mapState(CHEST_EXTRA_BASE), r = mapState(CHEST_EXTRA_BASE + 1);
  ok(!!l && !!r && (l[1] & 16) && (r[1] & 32),
    `大箱子 left/right 映射出 bit4/bit5（left=${l && l[1]} right=${r && r[1]}）`);
}""")

open(p, 'w', newline='', encoding='utf-8').write(t)
print('verify-adaptation.mjs -> v2.1.0 完成，单次落盘')
