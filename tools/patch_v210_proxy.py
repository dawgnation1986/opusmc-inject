# -*- coding: utf-8 -*-
# patch_v210_proxy.py — mc-proxy v2.1.0：掉落物 / 攻击 / 维度去重 / 窗口标题 / 卸载
import os
os.chdir(r"D:\discuz\webmc\hook\opusmc-inject")
p = 'tools/mc-proxy.mjs'
t = open(p, newline='', encoding='utf-8').read()
EOL = "\r\n" if "\r\n" in t else "\n"

def rep(old, new, n=1):
    global t
    o = old.replace("\n", EOL); nn = new.replace("\n", EOL)
    c = t.count(o)
    assert c == n, 'old 命中 %d 次（应 %d）: %r...' % (c, n, old[:80])
    t = t.replace(o, nn)

# 1) C->S 新方法：攻击 / 交互 / 关窗
rep("""    return framePacket(0x0E, w.build());
  },""",
"""    return framePacket(0x0E, w.build());
  },
  useEntity(eid, action, x = 0, y = 0, z = 0) { // 0x02：1=攻击 0=交互 2=对某点交互
    const w = new Writer().varInt(eid).varInt(action);
    if (action === 2) w.f32(x).f32(y).f32(z);
    return framePacket(0x02, w.build());
  },
  closeWindow(id) { return framePacket(0x0D, new Writer().i8(id).build()); },""")

# 2) metadata：改成可回调，掉落物物品栈才拿得到
rep("""function skipMetadata(r) {
  for (;;) {
    const h = r.u8();
    if (h === 0x7F) return; // 1.8 结束符（文档 §4.0）；0x00 是 index0/type0 的合法条目
    const type = (h >> 5) & 7;
    switch (type) {
      case 0: r.i8(); break;
      case 1: r.i16(); break;
      case 2: r.i32(); break;
      case 3: r.f32(); break;
      case 4: r.string(); break;
      case 5: r.i16(); r.i8(); r.i16(); if (r.u8() === 1) skipNbt(r); break; // item（可带 NBT）
      case 6: r.i32(); r.i32(); r.i32(); break;
      case 7: r.f32(); r.f32(); r.f32(); break;
      default: throw new Error('metadata 未知类型 ' + type);
    }
  }
}""",
"""function skipMetadata(r) { scanMetadata(r, () => {}); }
function scanMetadata(r, onEntry) {
  for (;;) {
    const h = r.u8();
    if (h === 0x7F) return; // 1.8 结束符（文档 §4.0）；0x00 是 index0/type0 的合法条目
    const type = (h >> 5) & 7, idx = h & 0x1F;
    let v = null;
    switch (type) {
      case 0: v = r.i8(); break;
      case 1: v = r.i16(); break;
      case 2: v = r.i32(); break;
      case 3: v = r.f32(); break;
      case 4: v = r.string(); break;
      case 5: v = readSlot(r); break;   // 掉落物的物品栈在 index 10
      case 6: v = [r.i32(), r.i32(), r.i32()]; break;
      case 7: v = [r.f32(), r.f32(), r.f32()]; break;
      default: throw new Error('metadata 未知类型 ' + type);
    }
    onEntry(idx, type, v);
  }
}""")

# 3) 0x0D Collect Item / 0x0E 掉落物 / 0x1C metadata
rep("""      case 0x0D: { r.varInt(); r.varInt(); return; }                                  // Collect Item
      case 0x0E: { // Spawn Object：eid + type + int×3 + yaw/pitch + int data + (data>0: vel×3)
        r.varInt(); r.u8(); r.i32(); r.i32(); r.i32(); r.u8(); r.u8();
        const data = r.i32();
        if (data > 0) { r.i16(); r.i16(); r.i16(); }
        return;
      }""",
"""      case 0x0D: { out.collect = { id: r.varInt(), by: r.varInt() }; return; }        // Collect Item
      case 0x0E: { // Spawn Object：eid + type + int×3 + yaw/pitch + int data + (data>0: vel×3)
        const eid = r.varInt(), type = r.u8();
        const x = r.i32() / 32, y = r.i32() / 32, z = r.i32() / 32;
        r.u8(); r.u8();
        const data = r.i32();
        if (data > 0) { r.i16(); r.i16(); r.i16(); }
        if (type === 2) { // 掉落物：物品栈由紧随其后的 0x1C(index 10) 给
          entPos.set(eid, { x, y, z, yawDeg: 0, pitchDeg: 0 });
          out.spawn = { type: 'item', id: eid, x, y, z };
        }
        return;
      }""")
rep("""      case 0x1C: { r.varInt(); skipMetadata(r); return; }                             // Entity Metadata""",
"""      case 0x1C: { // Entity Metadata：掉落物的物品栈在 index 10 / type 5
        const eid = r.varInt();
        out.entityMeta = { id: eid, item: null };
        scanMetadata(r, (idx, type, v) => { if (idx === 10 && type === 5) out.entityMeta.item = v; });
        return;
      }""")

# 4) 重复 respawn 去重 + 掉落物/收集转发
rep("""  if (out.equip) toClient({ t: 'equip', id: out.equip.id, item: out.equip.item });""",
"""  if (out.equip) toClient({ t: 'equip', id: out.equip.id, item: out.equip.item });
  if (out.entityMeta && out.entityMeta.item) toClient({ t: 'meta', id: out.entityMeta.id, item: slotToClient(out.entityMeta.item) });
  if (out.collect) toClient({ t: 'collect', id: out.collect.id, by: out.collect.by });""")
rep("""  if (out.respawn) { toClient({ t: 'respawn', dim: out.respawn.dim, minY: 0, mode: mcModeName }); log('维度切换：' + out.respawn.dim); }""",
"""  if (out.respawn) {
    // PHPMC 每 0.5s 比对坐标带，边界抖动会反复发 0x07；respawn 会清整个世界重建，
    // 重复发就是「切维度特别慢」的主因。只在维度真变化时才转发。
    if (out.respawn.dim === lastDim) log(`维度未变化(${lastDim})，跳过重复 respawn`);
    else { lastDim = out.respawn.dim; toClient({ t: 'respawn', dim: out.respawn.dim, minY: 0, mode: mcModeName }); log('维度切换：' + out.respawn.dim); }
  }""")
rep("""let mcChunks = 0;
let mcModeName = 'survival';""",
"""let mcChunks = 0;
let mcModeName = 'survival';
let lastDim = 'overworld';""")

# 5) mask=0 的区块包 = 卸载；别再发一个空 chunk 覆盖画面
rep("""  if (out.chunk) {
    if (out.chunk.groundUp === false) {""",
"""  if (out.chunk) {
    if (out.chunk.mask === 0 && out.chunk.groundUp) {
      toClient({ t: 'unload', cx: out.chunk.cx, cz: out.chunk.cz });
    } else if (out.chunk.groundUp === false) {""")

# 6) 窗口：标题别二次 flatten（safeJson 已返回字符串），大箱子用 9x6，加现场日志
rep("""  if (out.winOpen) {
    const kind = WINDOW_KIND[out.winOpen.type] || 'generic_9x3';
    toClient({ t: 'open', id: out.winOpen.id, kind, title: flattenChat(safeJson(out.winOpen.title)) });
  }
  if (out.winItems) {
    if (out.winItems.id === 0) recordHotbar(out.winItems.items, 0);
    toClient({ t: 'win', id: out.winItems.id, items: out.winItems.items.map(slotToClient), carried: null });
  }""",
"""  if (out.winOpen) {
    // safeJson() 已经返回字符串；再套 flattenChat 会把标题洗成空串（GUI 只显示「暂不完整支持」）
    const kind = out.winOpen.type === 'minecraft:chest'
      ? (out.winOpen.slots > 27 ? 'generic_9x6' : 'generic_9x3')
      : (WINDOW_KIND[out.winOpen.type] || 'generic_9x3');
    log(`窗口 0x2D：id=${out.winOpen.id} type=${out.winOpen.type} -> ${kind} slots=${out.winOpen.slots} title="${safeJson(out.winOpen.title)}"`);
    toClient({ t: 'open', id: out.winOpen.id, kind, n: out.winOpen.slots, title: safeJson(out.winOpen.title) });
  }
  if (out.winItems) {
    if (out.winItems.id === 0) recordHotbar(out.winItems.items, 0);
    log(`窗口 0x30：id=${out.winItems.id} 槽位=${out.winItems.items.length}`);
    toClient({ t: 'win', id: out.winItems.id, items: out.winItems.items.map(slotToClient), carried: null });
  }""")
rep("""  if (out.kick) { toClient({ t: 'kick', reason: flattenChat(safeJson(out.kick)) }); log('PHPMC 断开: ' + out.kick); }""",
"""  if (out.kick) { toClient({ t: 'kick', reason: safeJson(out.kick) }); log('PHPMC 断开: ' + out.kick); }""")

# 7) 客户端交互消息 -> MC 包
rep("""    case 'tpok': break;     // 1.8 无 teleport confirm
    case 'creative': case 'trade': case 'sign': break;
    case 'error': break;""",
"""    case 'attack': toMc(MC.useEntity(o.id | 0, 1)); break;                 // 0x02 攻击
    case 'interact': toMc(MC.useEntity(o.id | 0, 2, o.x || 0, o.y || 0, o.z || 0)); break;
    case 'wclose': toMc(MC.closeWindow(o.id | 0)); break;                    // 0x0D Close Window
    case 'button': toMc(MC.click(o.id | 0, o.b | 0, 0, ++clickAction, 0, null)); break;
    case 'tpok': break;     // 1.8 无 teleport confirm
    case 'creative': case 'trade': case 'sign': break;
    case 'error': break;""")

open(p, 'w', newline='', encoding='utf-8').write(t)
print('mc-proxy.mjs -> v2.1.0 完成，单次落盘')
