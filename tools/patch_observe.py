# -*- coding: utf-8 -*-
# mc-observe.mjs 加 TCP 直连模式 v2（基于实际文件内容）
import os
os.chdir(r"D:\discuz\webmc\hook\opusmc-inject\tools")
p = 'mc-observe.mjs'
t = open(p, newline='', encoding='utf-8').read()

assert "const TCP_MODE" not in t

# 1) import + 模式开关
t = t.replace("import tls from 'node:tls';",
              "import tls from 'node:tls';\nimport net from 'node:net';\nconst TCP_MODE = process.env.TCP === '1';", 1)

# 2) data 事件：TCP 模式直接喂 mcBuf
old = "sock.on('data', (chunk) => {\n  if (!upgraded) {"
assert old in t
t = t.replace(old, "sock.on('data', (chunk) => {\n  if (TCP_MODE) { mcBuf = Buffer.concat([mcBuf, chunk]); drainMc(); return; }\n  if (!upgraded) {", 1)

# 3) TCP 连接分支（ws 分支原样保留）
old2 = "const sock = tls.connect({ host: HOST, port: PORT, rejectUnauthorized: false }, () => {"
new2 = """const sendLogin = (w) => {
  const nameB = Buffer.from(NAME, 'utf8');
  const hs = framePacket(0x00, Buffer.concat([writeVarInt(47), Buffer.from(HOST, 'utf8'), (() => { const b = Buffer.alloc(2); b.writeUInt16BE(PORT); return b; })(), writeVarInt(2)]));
  const lg = framePacket(0x00, Buffer.concat([writeVarInt(nameB.length), nameB]));
  if (w) { sock.write(wsEncode(0x2, hs)); sock.write(wsEncode(0x2, lg)); }
  else { sock.write(hs); sock.write(lg); }
  console.log('[已发握手+LoginStart]');
};
const sock = TCP_MODE
  ? net.connect({ host: HOST, port: PORT }, () => { upgraded = true; sendLogin(false); })
  : tls.connect({ host: HOST, port: PORT, rejectUnauthorized: false }, () => {"""
assert old2 in t
t = t.replace(old2, new2, 1)

# 4) ws 升级成功后的登录改为 sendLogin(true)
old3 = """    // 登录
    const hs = framePacket(0x00, Buffer.concat([writeVarInt(47), Buffer.from(HOST, 'utf8'), (() => { const b = Buffer.alloc(2); b.writeUInt16BE(PORT); return b; })(), writeVarInt(2)]));
    const nameB = Buffer.from(NAME, 'utf8');
    const login = framePacket(0x00, Buffer.concat([writeVarInt(nameB.length), nameB]));
    sock.write(wsEncode(0x2, hs));
    sock.write(wsEncode(0x2, login));
    console.log('[mc] 已发握手+LoginStart');"""
assert old3 in t
t = t.replace(old3, "    // 登录\n    sendLogin(true);", 1)

open(p, 'w', newline='', encoding='utf-8').write(t)
print('TCP 模式 v2 完成')
