# -*- coding: utf-8 -*-
# patch_v200.py — mc-proxy v2.0.0 一次落盘
# 修复三处「拿标准 1.8 套非标准实现」的根因 + 补齐交互主干。
# 规则：读一次 -> 逐处 str.replace 并断言命中数 -> 只写一次。
import os
os.chdir(r"D:\discuz\webmc\hook\opusmc-inject")
p = 'tools/mc-proxy.mjs'
t = open(p, newline='', encoding='utf-8').read()
EOL = "\r\n" if "\r\n" in t else "\n"
print('行尾 =', 'CRLF' if EOL == "\r\n" else 'LF')

def rep(old, new, n=1):
    global t
    o = old.replace("\n", EOL)
    nn = new.replace("\n", EOL)
    c = t.count(o)
    assert c == n, 'old 命中 %d 次（应 %d）: %r...' % (c, n, old[:80])
    t = t.replace(o, nn)

# ---- 1) 引入独立模块 ----
rep("""import crypto from 'node:crypto';""",
"""import crypto from 'node:crypto';
import { VERSION, BLOCK_NAMES, BIOME_NAMES, MC_ITEM_NAMES, MC_ITEM_IDS, MC_MOBS,
  chunkToOpus, packPosBytes, unpackPos } from './chunk-format.mjs';""")

# ---- 2) 坐标打包 + C->S 交互包（PHPMC 布局，不再是标准 1.8）----
rep("""  dig(status, x, y, z, face) { // 0x07：u8 status + long packedPos + u8 face
    const packed = ((BigInt(x | 0) & 0x3FFFFFFn) << 38n) | ((BigInt(z | 0) & 0x3FFFFFFn) << 12n) | (BigInt(y | 0) & 0xFFFn);
    return framePacket(0x07, new Writer().bytes((() => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt.asIntN(64, packed)); return b; })()).u8(status).u8(face).build());
  },""",
"""  dig(status, x, y, z, face) { // 0x07：u8 status + long packedPos + u8 face（坐标用 PHPMC 布局）
    return framePacket(0x07, new Writer().bytes(packPosBytes(x, y, z)).u8(status).u8(face).build());
  },
  place(x, y, z, face, itemId, cx = 8, cy = 8, cz = 8) { // 0x08：long + face + slot + 3 个光标字节
    return framePacket(0x08, new Writer().bytes(packPosBytes(x, y, z)).u8(face)
      .i16(itemId).u8(1).i16(0).u8(0).u8(cx).u8(cy).u8(cz).build());
  },
  useItem(itemId) { // 0x08 的 (-1,-1) 特例：吃/喝/用物品
    return framePacket(0x08, new Writer().bytes(packPosBytes(-1, -1, -1)).u8(255)
      .i16(itemId).u8(1).i16(0).u8(0).u8(0).u8(0).u8(0).build());
  },
  swing() { return framePacket(0x0A); },                        // 0x0A Animation：无 body
  held(slot) { return framePacket(0x09, new Writer().i16(slot).build()); },
  click(id, slot, button, action, mode, carried) { // 0x0E Click Window：末尾是光标上的物品栈
    const w = new Writer().i8(id).i16(slot).u8(button).i16(action).u8(mode);
    const n = carried && MC_ITEM_IDS.get(String(carried.n || ''));
    if (!n) w.i16(-1);
    else w.i16(n).u8(carried.c || 1).i16(carried.d || 0).u8(0);
    return framePacket(0x0E, w.build());
  },""")

# ---- 3) 0x23 Block Change 坐标 ----
rep("""      case 0x23: { // Block Change：packedPos(long) + varInt blockId（=(id<<4)|meta 的 raw state）
        const packed = r.i64();
        const bx = Number(BigInt.asIntN(26, BigInt(packed) >> 38n));
        const bz = Number(BigInt.asIntN(26, (BigInt(packed) << 26n) >> 38n));
        const by = Number((BigInt(packed) >> 26n) & 0xFFFn);
        out.block = { x: bx, y: by, z: bz, s: r.varInt() };
        return;
      }""",
"""      case 0x23: { // Block Change：PHPMC 坐标布局 x<<38|y<<26|z（原代码按标准 1.8 解，y/z 全错）
        const [bx, by, bz] = unpackPos(r.raw(8).readBigInt64BE(0));
        out.block = { x: bx, y: by, z: bz, s: r.varInt() };
        return;
      }""")

# ---- 4) 0x21 保留 groundUp ----
rep("""        out.chunk = { cx: r.i32(), cz: r.i32() };
        r.bool();
        out.chunk.mask = r.u16();   // 协议清单 §3：primaryBitMask 是 ushort""",
"""        out.chunk = { cx: r.i32(), cz: r.i32() };
        out.chunk.groundUp = r.bool();  // false = 增量段更新（PHPMC 目前停用，但必须能识别）
        out.chunk.mask = r.u16();   // 协议清单 §3：primaryBitMask 是 ushort""")

# ---- 5) 窗口/告示牌解码：从「只跳过」改成「解析并转发」 ----
rep("""      case 0x2D: { // Open Window：uByte id + string type + string title + uByte slots (+bool horse)
        r.u8(); r.string(); r.string(); r.u8();
        return;
      }
      case 0x2F: { // Set Slot：byte win + short slot + short item + (item>=0: byte count + short dmg + nbt)
        r.i8(); r.i16(); const it = r.i16();
        if (it >= 0) { r.i8(); r.i16(); if (r.u8() === 1) skipNbt(r); }
        return;
      }
      case 0x30: { // Window Items：byte win + short count + slots（每个可能带 NBT）
        r.i8();
        const n = r.i16();
        for (let i = 0; i < n; i++) {
          const it = r.i16();
          if (it >= 0) { r.i8(); r.i16(); if (r.u8() === 1) skipNbt(r); }
        }
        return;
      }
      case 0x31: { r.u8(); r.i16(); r.i16(); return; }                                // Window Property
      case 0x32: { r.u8(); r.i16(); r.bool(); return; }                               // Confirm Transaction
      case 0x33: { r.i64(); r.string(); r.string(); r.string(); r.string(); return; } // Update Sign""",
"""      case 0x2D: { out.winOpen = { id: r.u8(), type: r.string(), title: r.string(), slots: r.u8() }; return; }
      case 0x2F: { const id = r.i8(), slot = r.i16(); out.wslot = { id, slot, item: readSlot(r) }; return; }
      case 0x30: {
        const id = r.i8(), n = r.i16(), items = [];
        for (let i = 0; i < n; i++) items.push(readSlot(r));
        out.winItems = { id, items };
        return;
      }
      case 0x31: { out.winProp = { id: r.u8(), k: r.i16(), v: r.i16() }; return; }
      case 0x32: { r.u8(); r.i16(); r.bool(); return; }                               // Confirm Transaction
      case 0x33: { // Update Sign：坐标也是 PHPMC 布局
        const [bx, by, bz] = unpackPos(r.raw(8).readBigInt64BE(0));
        out.sign = { x: bx, y: by, z: bz, lines: [r.string(), r.string(), r.string(), r.string()] };
        return;
      }""")

# ---- 6) readSlot / slotToClient（放在 skipMetadata 之前）----
rep("""// metadata（watch：byte 类型<<5|索引 + 值，0x00 结尾）——按 1.8 标准""",
"""// Slot Data：short id(-1=空) + byte count + short dmg + byte nbtPresent(+NBT)
function readSlot(r) {
  const id = r.i16();
  if (id < 0) return null;
  const count = r.i8(), dmg = r.i16();
  if (r.u8() === 1) skipNbt(r);
  return { id, count, dmg };
}
function slotToClient(s) { return s ? { n: MC_ITEM_NAMES[s.id] || 'stone', c: s.count, d: s.dmg } : null; }
// metadata（watch：byte 类型<<5|索引 + 值，0x00 结尾）——按 1.8 标准""")

# ---- 7) 会话状态：删旧 MC_MOBS，加窗口/快捷栏状态 ----
rep("""// MC 实体 type id（1.8）-> OpusMC NET_MOBS 名字；不在表里的 spawn 客户端会自动忽略
const MC_MOBS = {
  90: 'pig', 91: 'sheep', 92: 'cow', 93: 'chicken', 54: 'zombie', 51: 'skeleton',
  50: 'creeper', 52: 'spider', 58: 'enderman', 61: 'blaze', 56: 'ghast',
  57: 'zombified_piglin', 62: 'magma_cube', 120: 'villager', 99: 'iron_golem',
  95: 'wolf', 96: 'cat', 98: 'ocelot', 100: 'horse', 31: 'horse',
};""",
"""// MC_MOBS 已移到 ./chunk-format.mjs（按 1.8 真实 type id 校正，去掉客户端不支持的项）
const WINDOW_KIND = {
  'minecraft:chest': 'generic_9x3', 'minecraft:crafting_table': 'crafting',
  'minecraft:furnace': 'furnace', 'minecraft:anvil': 'anvil',
  'minecraft:brewing_stand': 'brewing_stand', 'minecraft:enchanting_table': 'enchanting_table',
  'minecraft:dispenser': 'generic_9x3', 'minecraft:hopper': 'hopper',
};
const hotbar = new Array(9).fill(0); // 0x30/0x2F 里的 36..44 槽 -> 物品 id（0x08 放置要用）
let heldSlot = 0, clickAction = 0;
function recordHotbar(items, startSlot) {
  for (let i = 0; i < items.length; i++) {
    const s = startSlot + i;
    if (s >= 36 && s < 45) hotbar[s - 36] = items[i] ? items[i].id : 0;
  }
}
function heldItemId() { return hotbar[heldSlot] || 0; }""")

# ---- 8) 区块下发：groundUp=false 不再毁地形 ----
rep("""  if (out.chunk) {
    mcChunks++;
    try {
      const bin = chunkToOpus(out.chunk.cx, out.chunk.cz, out.chunk.mask, out.chunk.data);
      if (client) client.sendBinary(bin);
      if (mcChunks % 25 === 1) log(`区块已翻译下发 ${mcChunks}（${out.chunk.cx},${out.chunk.cz} ${bin.length}B）`);
    } catch (e) { log(`区块翻译失败 ${out.chunk.cx},${out.chunk.cz}: ${e.message}`); }
  }""",
"""  if (out.chunk) {
    if (out.chunk.groundUp === false) {
      // OpusMC type=1 会整块重建；增量段直接下发会抹掉其它段。
      // PHPMC 的 ENABLE_SECTION_RESEND=false，正常走不到；真出现了记日志，别静默毁地形。
      log(`⚠ 增量区块 (${out.chunk.cx},${out.chunk.cz}) mask=0x${out.chunk.mask.toString(16)} 已跳过（需要段缓存合并）`);
    } else {
      mcChunks++;
      try {
        const bin = chunkToOpus(out.chunk.cx, out.chunk.cz, out.chunk.mask, out.chunk.data, out.chunk.groundUp);
        if (client) client.sendBinary(bin);
        if (mcChunks % 25 === 1) log(`区块已翻译下发 ${mcChunks}（${out.chunk.cx},${out.chunk.cz} ${bin.length}B）`);
      } catch (e) { log(`区块翻译失败 ${out.chunk.cx},${out.chunk.cz}: ${e.message}`); }
    }
  }""")

# ---- 9) 窗口/告示牌 S->C 转发 ----
rep("""  if (out.kick) { toClient({ t: 'kick', reason: flattenChat(safeJson(out.kick)) }); log('PHPMC 断开: ' + out.kick); }""",
"""  if (out.winOpen) {
    const kind = WINDOW_KIND[out.winOpen.type] || 'generic_9x3';
    toClient({ t: 'open', id: out.winOpen.id, kind, title: flattenChat(safeJson(out.winOpen.title)) });
  }
  if (out.winItems) {
    if (out.winItems.id === 0) recordHotbar(out.winItems.items, 0);
    toClient({ t: 'win', id: out.winItems.id, items: out.winItems.items.map(slotToClient), carried: null });
  }
  if (out.wslot) {
    if (out.wslot.id === 0) recordHotbar([out.wslot.item], out.wslot.slot);
    toClient({ t: 'wslot', id: out.wslot.id, i: out.wslot.slot, item: slotToClient(out.wslot.item) });
  }
  if (out.winProp) toClient({ t: 'prop', id: out.winProp.id, k: out.winProp.k, v: out.winProp.v });
  if (out.sign) toClient({ t: 'signs', list: [[out.sign.x, out.sign.y, out.sign.z, out.sign.lines]] });
  if (out.kick) { toClient({ t: 'kick', reason: flattenChat(safeJson(out.kick)) }); log('PHPMC 断开: ' + out.kick); }""")

# ---- 10) 客户端 -> 服务端：补齐 place/use/swing/held/click ----
rep("""    case 'held': break;   // PHPMC 无 0x09（服务端自行记账），跳过
    case 'settings': break; // rd 视距，M3 用于限制区块请求范围
    case 'tpok': break;     // 1.8 无 teleport confirm
    case 'click': case 'creative': case 'trade': case 'sign': break;         // 容器/创造/交易：M3
    case 'error': break;""",
"""    case 'held': heldSlot = Math.max(0, Math.min(8, o.slot | 0)); toMc(MC.held(heldSlot)); break;
    case 'swing': toMc(MC.swing()); break;
    case 'place': { // 0x08：客户端不带物品名，用 0x30/0x2F 记下的快捷栏
      const cx = Math.round((o.cx ?? 0.5) * 15), cy = Math.round((o.cy ?? 0.5) * 15), cz = Math.round((o.cz ?? 0.5) * 15);
      toMc(MC.place(o.x | 0, o.y | 0, o.z | 0, o.face | 0, heldItemId(), cx, cy, cz));
      break;
    }
    case 'use': toMc(MC.useItem(heldItemId())); break;
    case 'click': toMc(MC.click(o.id | 0, o.slot | 0, o.button | 0, ++clickAction, o.mode | 0, o.carried)); break;
    case 'settings': break; // rd 视距
    case 'tpok': break;     // 1.8 无 teleport confirm
    case 'creative': case 'trade': case 'sign': break;
    case 'error': break;""")

# ---- 11) 版本标记（用户靠它确认更新生效）----
rep("""    log('wss 通道已建立，发送 states/biomes + 握手 + 登录');""",
"""    log(`wss 通道已建立 v${VERSION}：发送 states/biomes + 握手 + 登录`);""")
rep("""server.listen(CLIENT_PORT, () => log(`中转就绪：OpusMC「直接连接」填 ws://localhost:${CLIENT_PORT} → PHPMC ${MC_SECURE ? 'wss' : 'ws'}://${MC_HOST}:${MC_PORT}`));""",
"""server.listen(CLIENT_PORT, () => log(`[mc-proxy v${VERSION}] 中转就绪：OpusMC「直接连接」填 ws://localhost:${CLIENT_PORT} → PHPMC ${MC_SECURE ? 'wss' : 'ws'}://${MC_HOST}:${MC_PORT}`));""")

# ---- 12) 删除文件末尾旧的 M2 段（BLOCK_NAMES / chunkToOpus 等，已抽到模块）----
marker = '// ============================ M2：1.8 区块 → OpusMC chunk type 1 ============================'
idx = t.find(marker.replace("\n", EOL))
assert idx != -1, '找不到 M2 段起点'
t = t[:idx] + ('// v2.0.0：区块打包、方块/物品/生物名表已抽到 ./chunk-format.mjs' + EOL)

open(p, 'w', newline='', encoding='utf-8').write(t)
print('patch v2.0.0 完成，共 12 处，单次落盘')
