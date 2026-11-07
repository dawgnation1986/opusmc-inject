# -*- coding: utf-8 -*-
# patch_v221_frames.py — 真·逐帧分派：修「交互消息被整批丢弃」的总根因
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

rep("""// 解帧（服务端收到的帧应带 mask；返回 {payloads, closed}，未收全的留在 buf）
function wsDecode(bufRef) {
  let payload = Buffer.alloc(0), closed = false;""",
"""// 解帧（服务端收到的帧应带 mask；未收全的留在 buf）
// frames 传入数组 = 逐帧模式（OpusMC 的 JSON 文本帧，一个 chunk 里多条消息绝不能拼）；
// 不传 = 字节流模式（PHPMC 的 MC 字节流，帧边界 != 包边界，必须拼接后按 VarInt 分帧）。
function wsDecode(bufRef, frames) {
  let payload = Buffer.alloc(0), closed = false;""")

rep("""    if (opcode === 0x9) { bufRef.pong = wsEncode(0xA, data); continue; } // 服务端要回 pong
    payload = Buffer.concat([payload, data]); // 0x0/0x1/0x2 一律当字节流拼""",
"""    if (opcode === 0x9) { bufRef.pong = wsEncode(0xA, data); continue; } // 服务端要回 pong
    if (frames) frames.push({ opcode, data });
    else payload = Buffer.concat([payload, data]); // 0x0/0x1/0x2 一律当字节流拼（仅 PHPMC 侧）""")

rep("""    // 客户端消息是 JSON 文本帧 —— 必须逐帧分派（wsDecode 会把同 chunk 的多帧拼成一个
    // payload，两个 JSON 拼在一起 parse 必炸；只有 MC 字节流才是拼接语义）
    let closed = false;
    const frames = [];
    for (;;) {
      const r = wsDecode(st);
      if (r.closed) { closed = true; break; }
      if (r.payload.length) frames.push(r.payload);
      if (st.buf.length === 0) break; // wsDecode 已把未完成的留在 buf；防死循环
    }
    if (st.pong) { socket.write(st.pong); st.pong = null; }
    if (closed) { socket.end(); st.handlers.close && st.handlers.close(); return; }
    for (const f of frames) if (st.handlers.message) st.handlers.message(f);""",
"""    // 客户端消息是 JSON 文本帧 —— 必须逐帧分派。
    // v2.2.1 根因：旧代码外层循环看着像「逐帧」，但 wsDecode 内部会把同 chunk 的所有帧
    // concat 成一个 payload，多个 JSON 拼在一起 parse 必炸 -> 整批交互消息静默丢失。
    // 这就是「放置/攻击/容器点击全没反应」而 tick 正常（tick 每 100ms 单独一帧）的原因。
    const frames = [];
    const r = wsDecode(st, frames);
    if (st.pong) { socket.write(st.pong); st.pong = null; }
    if (r.closed) { socket.end(); st.handlers.close && st.handlers.close(); return; }
    for (const f of frames) if (f.opcode === 0x1 && st.handlers.message) st.handlers.message(f.data);""")

open(p, 'w', newline='', encoding='utf-8').write(t)

q = 'tools/chunk-format.mjs'
s = open(q, newline='', encoding='utf-8').read()
assert s.count("export const VERSION = '2.2.0';") == 1, 'VERSION 标记未命中'
s = s.replace("export const VERSION = '2.2.0';", "export const VERSION = '2.2.1';")
open(q, 'w', newline='', encoding='utf-8').write(s)
print('v2.2.1 逐帧分派完成，两文件各单次落盘')
