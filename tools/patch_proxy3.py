# -*- coding: utf-8 -*-
# mc-proxy.mjs 实体翻译 + metadata 结束符修复（0x7F）+ 0x38/0x0C/0x0F/0x13/0x15-0x19 全链路
import os
os.chdir(r"D:\discuz\webmc\hook\opusmc-inject\tools")
p = 'mc-proxy.mjs'
t = open(p, newline='', encoding='utf-8').read()

def rep(old, new, n=1):
    global t
    c = t.count(old)
    assert c == n, 'old 命中 %d 次（应 %d）: %s...' % (c, n, old[:70])
    t = t.replace(old, new)

# 1) skipMetadata 结束符：1.8 是 0x7F，不是 0x00（0x00 是 index0/type0 的合法条目）
rep("""function skipMetadata(r) {
  for (;;) {
    const h = r.u8();
    if (h === 0) return;""",
"""function skipMetadata(r) {
  for (;;) {
    const h = r.u8();
    if (h === 0x7F) return; // 1.8 结束符（文档 §4.0）；0x00 是 index0/type0 的合法条目""")

# 2) 实体位置表 + MC 生物 id -> OpusMC 名字映射 + uuid 转 hex（插在会话状态区）
rep("""let client = null;   // OpusMC 客户端连接（wrapServerSocket）
let mc = null;       // PHPMC 连接
let mcState = 'idle';
let mcEid = -1;
let chatLines = [];""",
"""let client = null;   // OpusMC 客户端连接（wrapServerSocket）
let mc = null;       // PHPMC 连接
let mcState = 'idle';
let mcEid = -1;
let chatLines = [];

// ---- 实体状态（0x38 名字表 + 实体绝对位置表，0x15/0x17 相对移动在上面累计）----
const entPos = new Map();      // eid -> {x, y, z, yawDeg, pitchDeg}
const playerNames = new Map(); // uuidHex -> name（0x38 action=0）
function uuidHex(buf) { return buf.toString('hex'); }
// MC 实体 type id（1.8）-> OpusMC NET_MOBS 名字；不在表里的 spawn 客户端会自动忽略
const MC_MOBS = {
  90: 'pig', 91: 'sheep', 92: 'cow', 93: 'chicken', 54: 'zombie', 51: 'skeleton',
  50: 'creeper', 52: 'spider', 58: 'enderman', 61: 'blaze', 56: 'ghast',
  57: 'zombified_piglin', 62: 'magma_cube', 120: 'villager', 99: 'iron_golem',
  95: 'wolf', 96: 'cat', 98: 'ocelot', 100: 'horse', 31: 'horse',
};""")

# 3) 0x38：收名字表并下发 players
rep("""      case 0x38: { // Player List：varInt action + varInt count + entries
        const action = r.varInt(), n = r.varInt();
        for (let i = 0; i < n; i++) {
          r.raw(16);
          if (action === 0) {
            r.string();
            const props = r.varInt();
            for (let p = 0; p < props; p++) { r.string(); r.string(); if (r.bool()) r.string(); }
            r.varInt(); r.varInt(); r.bool();
          } else if (action === 1 || action === 2 || action === 3) { r.varInt(); }
        }
        return;
      }""",
"""      case 0x38: { // Player List：action=0 的 uuid+name 是头顶名牌唯一来源（文档 §5.2）
        const action = r.varInt(), n = r.varInt();
        const list = [];
        for (let i = 0; i < n; i++) {
          const uuid = r.raw(16);
          if (action === 0) {
            const name = r.string();
            const props = r.varInt();
            for (let pp = 0; pp < props; pp++) { r.string(); r.string(); if (r.bool()) r.string(); }
            r.varInt(); r.varInt(); r.bool();
            playerNames.set(uuidHex(uuid), name);
            list.push({ uuid: uuidHex(uuid), name });
          } else if (action === 1 || action === 2 || action === 3) { r.varInt(); }
        }
        if (action === 0 && list.length) out.players = list;
        return;
      }""")

# 4) 0x0C Spawn Player：记录位置表 + spawn 消息（name 从 0x38 查）
rep("""      case 0x0C: { // Spawn Player：eid + uuid16 + int×3 + yaw/pitch + held(short) + metadata
        r.varInt(); r.raw(16); r.i32(); r.i32(); r.i32(); r.u8(); r.u8(); r.i16();
        skipMetadata(r);
        return;
      }""",
"""      case 0x0C: { // Spawn Player：eid + uuid16 + int×3(×32) + yaw/pitch + held(short) + metadata
        const eid = r.varInt();
        const uuid = r.raw(16);
        const x = r.i32() / 32, y = r.i32() / 32, z = r.i32() / 32;
        const yaw = r.u8() * 360 / 256, pitch = r.u8() * 360 / 256;
        r.i16();
        skipMetadata(r);
        entPos.set(eid, { x, y, z, yawDeg: yaw, pitchDeg: pitch });
        out.spawn = { type: 'player', id: eid, uuid: uuidHex(uuid), x, y, z, yaw, pitch, name: playerNames.get(uuidHex(uuid)) };
        return;
      }""")

# 5) 0x0F Spawn Mob：映射表 + 位置表 + spawn
rep("""      case 0x0F: { // Spawn Mob：eid + uByte type + int×3 + yaw/pitch/head + vel×3 + metadata
        r.varInt(); r.u8(); r.i32(); r.i32(); r.i32(); r.u8(); r.u8(); r.u8();
        r.i16(); r.i16(); r.i16();
        skipMetadata(r);
        return;
      }""",
"""      case 0x0F: { // Spawn Mob：eid + uByte type + int×3(×32) + yaw/pitch/head + vel×3 + metadata
        const eid = r.varInt();
        const type = r.u8();
        const x = r.i32() / 32, y = r.i32() / 32, z = r.i32() / 32;
        const yaw = r.u8() * 360 / 256, pitch = r.u8() * 360 / 256;
        r.u8();
        r.i16(); r.i16(); r.i16();
        skipMetadata(r);
        const name = MC_MOBS[type];
        if (name) {
          entPos.set(eid, { x, y, z, yawDeg: yaw, pitchDeg: pitch });
          out.spawn = { type: name, id: eid, x, y, z, yaw, pitch };
        }
        return;
      }""")

# 6) 0x13 Destroy → remove；0x15/0x16/0x17/0x18 → move；0x19 → head
rep("""      case 0x13: { const n = r.varInt(); for (let i = 0; i < n; i++) r.varInt(); return; } // Destroy""",
"""      case 0x13: { // Destroy Entities
        const n = r.varInt(); const ids = [];
        for (let i = 0; i < n; i++) { const eid = r.varInt(); ids.push(eid); entPos.delete(eid); }
        if (ids.length) out.remove = ids;
        return;
      }""")
rep("""      case 0x15: { r.varInt(); r.i8(); r.i8(); r.i8(); r.bool(); return; }            // Entity Move（1.8 带 onGround）""",
"""      case 0x15: { // Entity Relative Move：delta i8（×32），在位置表上累计后发绝对 move
        const eid = r.varInt();
        const dx = r.i8() / 32, dy = r.i8() / 32, dz = r.i8() / 32;
        r.bool();
        const e = entPos.get(eid);
        if (e) { e.x += dx; e.y += dy; e.z += dz; out.move = { id: eid, x: e.x, y: e.y, z: e.z }; }
        return;
      }""")
rep("""      case 0x16: { r.varInt(); r.u8(); r.u8(); r.bool(); return; }                    // Entity Look""",
"""      case 0x16: { // Entity Look（yaw/pitch 是 0-255 圈）
        const eid = r.varInt();
        const yaw = r.u8() * 360 / 256, pitch = r.u8() * 360 / 256;
        r.bool();
        const e = entPos.get(eid);
        if (e) { e.yawDeg = yaw; e.pitchDeg = pitch; out.move = { id: eid, yaw, pitch }; }
        return;
      }""")
rep("""      case 0x17: { r.varInt(); r.i8(); r.i8(); r.i8(); r.u8(); r.u8(); r.bool(); return; } // Move&Look""",
"""      case 0x17: { // Entity Move & Look：delta i8（×32）+ yaw/pitch
        const eid = r.varInt();
        const dx = r.i8() / 32, dy = r.i8() / 32, dz = r.i8() / 32;
        const yaw = r.u8() * 360 / 256, pitch = r.u8() * 360 / 256;
        r.bool();
        const e = entPos.get(eid);
        if (e) { e.x += dx; e.y += dy; e.z += dz; e.yawDeg = yaw; e.pitchDeg = pitch; out.move = { id: eid, x: e.x, y: e.y, z: e.z, yaw, pitch }; }
        return;
      }""")
rep("""      case 0x18: { r.varInt(); r.i32(); r.i32(); r.i32(); r.u8(); r.u8(); r.bool(); return; } // Teleport""",
"""      case 0x18: { // Entity Teleport：绝对 int×32
        const eid = r.varInt();
        const x = r.i32() / 32, y = r.i32() / 32, z = r.i32() / 32;
        const yaw = r.u8() * 360 / 256, pitch = r.u8() * 360 / 256;
        r.bool();
        entPos.set(eid, { x, y, z, yawDeg: yaw, pitchDeg: pitch });
        out.move = { id: eid, x, y, z, yaw, pitch, tp: true };
        return;
      }""")
rep("""      case 0x19: { r.varInt(); r.u8(); return; }                                      // Head Look""",
"""      case 0x19: { const eid = r.varInt(); out.head = { id: eid, yaw: r.u8() * 360 / 256 }; return; } // Head Look""")

# 7) mcToClient：下发 spawn/players/remove/move/head
rep("""  if (out.abilities) toClient({ t: 'abilities', flags: out.abilities.flags });""",
"""  if (out.abilities) toClient({ t: 'abilities', flags: out.abilities.flags });
  if (out.players) toClient({ t: 'players', list: out.players });
  if (out.spawn) toClient(Object.assign({ t: 'spawn' }, out.spawn));
  if (out.remove) toClient({ t: 'remove', ids: out.remove });
  if (out.move) toClient(Object.assign({ t: 'move' }, out.move));
  if (out.head) toClient({ t: 'head', id: out.head.id, yaw: out.head.yaw });""")

# 8) 连接/断开时清实体表（换会话不留旧实体）
rep("""    mcState = 'idle';
    toClient({ t: 'kick', reason: '与 PHPMC 的连接断开：' + why });
    mc = null;""",
"""    mcState = 'idle';
    entPos.clear(); playerNames.clear();
    toClient({ t: 'kick', reason: '与 PHPMC 的连接断开：' + why });
    mc = null;""")

open(p, 'w', newline='', encoding='utf-8').write(t)
print('实体翻译 + metadata 0x7F 修复完成')
