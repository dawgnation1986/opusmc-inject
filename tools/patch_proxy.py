# -*- coding: utf-8 -*-
# mc-proxy.mjs VarInt 位移 bug 修复 + 文档兼容性修正（一次落盘）
# 根因：解码 VarInt 时 `++shift`（每轮 +1 位）应为 `shift += 7`。
#       单字节 VarInt 不受影响（M1 全通的原因），首个 ≥128 字节的包（0x21 区块）立刻错位。
import os
os.chdir(r"D:\discuz\webmc\hook\opusmc-inject\tools")
p = 'mc-proxy.mjs'
t = open(p, newline='', encoding='utf-8').read()
eol = '\r\n' if '\r\n' in t else '\n'

def rep(old, new, n=1):
    global t
    c = t.count(old)
    assert c == n, 'old 命中 %d 次（应 %d）: %s...' % (c, n, old[:60])
    t = t.replace(old, new)

# 1) Reader.varInt 位移修复（解码核心 bug）
rep("""  varInt() {
    let v = 0, shift = 0;
    for (;;) {
      const b = this.b[this.o++];
      v |= (b & 0x7F) << shift;
      if (!(b & 0x80)) break;
      if (++shift > 5) throw new Error('varInt 太长');
    }
    return v;
  }""",
"""  varInt() {
    let v = 0, shift = 0;
    for (;;) {
      const b = this.b[this.o++];
      v |= (b & 0x7F) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
      if (shift > 28) throw new Error('varInt 太长');
    }
    return v;
  }""")

# 2) drainMc 包长 VarInt 位移修复（同一个 bug 的第二处）
rep("""    let len = 0, shift = 0, o = 0, ok = false;
    while (o < b.length) {
      const byte = b[o++];
      len |= (byte & 0x7F) << shift;
      if (!(byte & 0x80)) { ok = true; break; }
      if (++shift > 5) break;
    }""",
"""    let len = 0, shift = 0, o = 0, ok = false;
    while (o < b.length) {
      const byte = b[o++];
      len |= (byte & 0x7F) << shift;
      if (!(byte & 0x80)) { ok = true; break; }
      shift += 7;
      if (shift > 28) break;
    }""")

# 3) 0x21 mask：文档写 ushort（16 段满 = 0xFFFF，i16 会变 -1），改 u16
rep("""        out.chunk.mask = r.i16();""",
    """        out.chunk.mask = r.u16();   // 协议清单 §3：primaryBitMask 是 ushort""")

# 4) 0x03 Time Update 存 dayTime（mcToClient 里 out.time 目前永远 undefined）
rep("""      case 0x03: r.i64(); r.i64(); return;                                            // Time Update""",
    """      case 0x03: { const age = r.i64(); out.time = { worldAge: age, dayTime: r.i64() }; return; } // Time Update""")

# 5) 0x29 Spawn Painting：按文档 §5.3 加防御注释+断言（音效同 ID，PHPMC 已关音效）
rep("""      case 0x29: { r.varInt(); r.string(); r.i64(); r.u8(); return; }                 // Spawn Painting""",
    """      case 0x29: { // Spawn Painting（文档 §5.3：0x29 与 Sound Effect 双占用；PHPMC 已关音效，恒为画）
        const before = r.left;
        r.varInt(); r.string(); r.i64(); r.u8();
        if (r.left !== 0) throw new Error('0x29 解码后剩 ' + r.left + 'B（可能是音效包，按 §5.3 处理）');
        return;
      }""")

# 6) BLOCK_NAMES 补 16 色系（159 染色陶瓦 / 228 混凝土 / 229 混凝土粉末 / 230-231 染色玻璃）+ 常见杂项
rep("""  for (const [id, name] of Object.entries(base)) a[(+id) << 4] = 'minecraft:' + name;
  for (let m = 0; m < 16; m++) {
    a[(35 << 4) | m] = 'minecraft:' + WOOL[m] + '_wool';
    a[(95 << 4) | m] = 'minecraft:' + WOOL[m] + '_stained_glass';
    a[(160 << 4) | m] = 'minecraft:' + WOOL[m] + '_stained_glass_pane';
    a[(171 << 4) | m] = 'minecraft:' + WOOL[m] + '_carpet';
  }""",
"""  for (const [id, name] of Object.entries(base)) a[(+id) << 4] = 'minecraft:' + name;
  for (let m = 0; m < 16; m++) {
    a[(35 << 4) | m] = 'minecraft:' + WOOL[m] + '_wool';
    a[(95 << 4) | m] = 'minecraft:' + WOOL[m] + '_stained_glass';
    a[(160 << 4) | m] = 'minecraft:' + WOOL[m] + '_stained_glass_pane';
    a[(171 << 4) | m] = 'minecraft:' + WOOL[m] + '_carpet';
    a[(159 << 4) | m] = 'minecraft:' + WOOL[m] + '_terracotta';       // 1.8 染色陶瓦
    a[(228 << 4) | m] = 'minecraft:' + WOOL[m] + '_concrete';
    a[(229 << 4) | m] = 'minecraft:' + WOOL[m] + '_concrete_powder';
    a[(230 << 4) | m] = 'minecraft:' + WOOL[m] + '_stained_glass';    // 230/231 旧表误置，覆盖为玻璃
    a[(231 << 4) | m] = 'minecraft:' + WOOL[m] + '_stained_glass_pane';
  }""")

rep("""    228: 'white_concrete', 229: 'white_concrete_powder', 230: 'white_stained_glass',
    231: 'white_stained_glass_pane',
  };""",
"""  };""")

# 7) 杂项常用方块补齐（花/草/床/蛛网/刷怪笼/告示牌/按钮/中继比较器等）
rep("""    55: 'redstone_wire', 59: 'wheat', 60: 'farmland', 71: 'iron_door', 64: 'oak_door',""",
"""    26: 'bed', 30: 'cobweb', 31: 'short_grass', 32: 'dead_bush', 37: 'dandelion',
    38: 'poppy', 39: 'brown_mushroom', 40: 'red_mushroom', 51: 'fire', 52: 'spawner',
    55: 'redstone_wire', 59: 'wheat', 60: 'farmland', 63: 'oak_sign', 68: 'oak_wall_sign',
    70: 'stone_button', 71: 'iron_door', 64: 'oak_door', 72: 'stone_button', 77: 'oak_button',
    92: 'cake', 93: 'repeater', 94: 'repeater', 104: 'pumpkin_stem', 105: 'melon_stem',
    125: 'oak_slab', 127: 'cocoa', 137: 'command_block', 144: 'skeleton_skull',
    158: 'powered_rail', 27: 'powered_rail', 28: 'detector_rail',
    178: 'comparator',""")

open(p, 'w', newline='', encoding='utf-8').write(t)
print('mc-proxy.mjs 修复完成：VarInt×2 + mask u16 + time + 0x29 断言 + 方块表补全')
