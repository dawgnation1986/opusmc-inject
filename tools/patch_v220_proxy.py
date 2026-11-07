# -*- coding: utf-8 -*-
# patch_v220_proxy.py — v2.2.0：容器崩溃 / 放置失效 / 掉落物诊断 / 异常兜底
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

# 1) Writer 缺 i8 -> 容器一点就 TypeError 未捕获 -> 进程 exit
rep("""  u8(v) { this.parts.push(Buffer.from([v & 0xFF])); return this; }
  bool(v)""",
"""  u8(v) { this.parts.push(Buffer.from([v & 0xFF])); return this; }
  i8(v) { const b = Buffer.alloc(1); b.writeInt8(v | 0); this.parts.push(b); return this; }
  bool(v)""")

# 2) readSlot 的 NBT 标记：PHPMC 有附魔时直接写根标签(0x0A)，没有 present=1
rep("""function readSlot(r) {
  const id = r.i16();
  if (id < 0) return null;
  const count = r.i8(), dmg = r.i16();
  if (r.u8() === 1) skipNbt(r);
  return { id, count, dmg };
}""",
"""function readSlot(r) {
  const id = r.i16();
  if (id < 0) return null;
  const count = r.i8(), dmg = r.i16();
  const flag = r.u8();
  if (flag === 0x0A) { r.o -= 1; skipNbt(r); } // PHPMC slotBytes：直接写 NBT 根标签，没有 present 字节
  else if (flag === 1) skipNbt(r);              // 标准 1.8：present=1 + NBT 根标签
  // 0x00 = 无 NBT。少跳 NBT 会让后面所有槽位错位，快捷栏记账就成 0（放置被服务端拒）
  return { id, count, dmg };
}""")

# 3) 掉落物 / metadata 现场日志
rep("""        if (type === 2) { // 掉落物：物品栈由紧随其后的 0x1C(index 10) 给
          entPos.set(eid, { x, y, z, yawDeg: 0, pitchDeg: 0 });
          out.spawn = { type: 'item', id: eid, x, y, z };
        }""",
"""        if (type === 2) { // 掉落物：物品栈由紧随其后的 0x1C(index 10) 给
          entPos.set(eid, { x, y, z, yawDeg: 0, pitchDeg: 0 });
          out.spawn = { type: 'item', id: eid, x, y, z };
          log(`掉落物 0x0E：eid=${eid} @ ${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`);
        }""")
rep("""  if (out.entityMeta && out.entityMeta.item) toClient({ t: 'meta', id: out.entityMeta.id, item: slotToClient(out.entityMeta.item) });""",
"""  if (out.entityMeta && out.entityMeta.item) {
    log(`掉落物 0x1C：eid=${out.entityMeta.id} item=${JSON.stringify(slotToClient(out.entityMeta.item))}`);
    toClient({ t: 'meta', id: out.entityMeta.id, item: slotToClient(out.entityMeta.item) });
  }""")

# 4) 放置 / 点击现场日志（方便确认为什么放不了）
rep("""    case 'place': { // 0x08：客户端不带物品名，用 0x30/0x2F 记下的快捷栏
      const cx = Math.round((o.cx ?? 0.5) * 15), cy = Math.round((o.cy ?? 0.5) * 15), cz = Math.round((o.cz ?? 0.5) * 15);
      toMc(MC.place(o.x | 0, o.y | 0, o.z | 0, o.face | 0, heldItemId(), cx, cy, cz));
      break;
    }""",
"""    case 'place': { // 0x08：客户端不带物品名，用 0x30/0x2F 记下的快捷栏
      const cx = Math.round((o.cx ?? 0.5) * 15), cy = Math.round((o.cy ?? 0.5) * 15), cz = Math.round((o.cz ?? 0.5) * 15);
      const item = heldItemId();
      log(`放置 0x08：@${o.x | 0},${o.y | 0},${o.z | 0} face=${o.face | 0} 物品=${item}（heldSlot=${heldSlot} hotbar=[${hotbar.join(',')}]）`);
      toMc(MC.place(o.x | 0, o.y | 0, o.z | 0, o.face | 0, item, cx, cy, cz));
      break;
    }""")
rep("""    case 'click': toMc(MC.click(o.id | 0, o.slot | 0, o.button | 0, ++clickAction, o.mode | 0, o.carried)); break;""",
"""    case 'click': {
      const pkt = MC.click(o.id | 0, o.slot | 0, o.button | 0, ++clickAction, o.mode | 0, o.carried);
      toMc(pkt);
      log(`点击 0x0E：win=${o.id} slot=${o.slot} mode=${o.mode} 字节=${pkt.length}`);
      break;
    }""")

# 5) 客户端消息整体兜底：任何异常都不许把进程干掉
rep("""  client.onMessage((payload) => {
    let m;
    try { m = JSON.parse(payload.toString('utf8')); } catch (e) { return; }
    if (m.t === 'hello') {
      playerName = String(m.name || 'WebPlayer').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16) || 'WebPlayer';
      log(`hello：玩家 ${playerName}（proto=${m.proto || '?'} rd=${m.rd || '?'}）—— 连接 PHPMC`);
      connectMc(playerName);
      return;
    }
    if (m.t === 'tick') { lastTick = m; clientToMc(m); return; }
    clientToMc(m);
  });""",
"""  client.onMessage((payload) => {
    let m;
    try { m = JSON.parse(payload.toString('utf8')); } catch (e) { return; }
    try {
      if (m.t === 'hello') {
        playerName = String(m.name || 'WebPlayer').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16) || 'WebPlayer';
        log(`hello：玩家 ${playerName}（proto=${m.proto || '?'} rd=${m.rd || '?'}）—— 连接 PHPMC`);
        connectMc(playerName);
        return;
      }
      if (m.t === 'tick') { lastTick = m; clientToMc(m); return; }
      clientToMc(m);
    } catch (e) {
      // 客户端消息里任何一个字段缺失都不该让整个中转 exit（v2.2.0：容器点击崩溃的根因）
      log(`⚠ 客户端消息 ${m && m.t} 处理异常（已忽略，进程继续）: ${e.stack || e.message}`);
    }
  });""")

open(p, 'w', newline='', encoding='utf-8').write(t)
# 统一版本号（mc-proxy 启动日志用 v${VERSION}，用户靠它确认更新生效）
q = 'tools/chunk-format.mjs'
s = open(q, newline='', encoding='utf-8').read()
assert s.count("export const VERSION = '2.1.0';") == 1, 'chunk-format VERSION 标记未命中'
s = s.replace("export const VERSION = '2.1.0';", "export const VERSION = '2.2.0';")
open(q, 'w', newline='', encoding='utf-8').write(s)
print('v2.2.0 完成：mc-proxy + chunk-format，各单次落盘')
