# -*- coding: utf-8 -*-
# mc-proxy.mjs 客户端侧大修：HTTP 升级 + hello 握手 + 文档兼容修正（一次落盘）
import os
os.chdir(r"D:\discuz\webmc\hook\opusmc-inject\tools")
p = 'mc-proxy.mjs'
t = open(p, newline='', encoding='utf-8').read()

def rep(old, new, n=1):
    global t
    c = t.count(old)
    assert c == n, 'old 命中 %d 次（应 %d）: %s...' % (c, n, old[:70])
    t = t.replace(old, new)

# 1) wrapServerSocket 支持 HTTP 升级（OpusMC 是浏览器原生 WebSocket，先发 GET 头等 101）
rep("""function wrapServerSocket(socket) {
  const st = { buf: Buffer.alloc(0), pong: null, handlers: { message: null, close: null } };
  socket.on('error', () => { }); // 客户端断开/ECONNRESET 不让进程崩
  socket.on('data', (chunk) => {
    st.buf = Buffer.concat([st.buf, chunk]);""",
"""function wrapServerSocket(socket) {
  const st = { buf: Buffer.alloc(0), pong: null, upgraded: false, handlers: { message: null, close: null } };
  socket.on('error', () => { }); // 客户端断开/ECONNRESET 不让进程崩
  socket.on('data', (chunk) => {
    st.buf = Buffer.concat([st.buf, chunk]);
    // HTTP 升级：浏览器 WebSocket 的第一步。回 101 + Sec-WebSocket-Accept，剩余字节进 ws 流
    if (!st.upgraded) {
      const i = st.buf.indexOf('\\r\\n\\r\\n');
      if (i === -1) return; // 头还没收全
      const head = st.buf.subarray(0, i).toString('utf8');
      const m = /Sec-WebSocket-Key:\\s*(\\S+)/i.exec(head);
      if (!/^GET /m.test(head) || !m) return; // 不是升级请求，按旧路走
      const accept = crypto.createHash('sha1').update(m[1] + WS_MAGIC).digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: ' + accept + '\\r\\n\\r\\n');
      st.upgraded = true;
      const rest = st.buf.subarray(i + 4);
      st.buf = Buffer.alloc(0);
      if (rest.length) { st.buf = Buffer.concat([st.buf, rest]); }
      return; // 升级帧本身不带消息
    }""")

# 2) hello 握手：拿到玩家名才连 PHPMC；settings.rd 记下
rep("""  client = wrapServerSocket(socket);
  log('OpusMC 客户端已接入（直接连接）—— 主动连接 PHPMC（proxy 协议：服务端先发 login）');
  connectMc('WebPlayer');
  client.onMessage((payload) => {
    // proxy 协议：JSON 文本消息（客户端连上后等 proxy 先发 states/login —— 服务端先说话）
    let m;
    try { m = JSON.parse(payload.toString('utf8')); } catch (e) { return; }
    if (m.t === 'tick') { lastTick = m; clientToMc(m); return; }
    clientToMc(m);
  });""",
"""  client = wrapServerSocket(socket);
  let playerName = 'WebPlayer';
  log('OpusMC 客户端已接入（HTTP 升级完成）—— 等待 hello 握手');
  client.onMessage((payload) => {
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
  });""")

# 3) connectMc 里的固定玩家名去掉（由 hello 传入）
rep("function connectMc(name) {", "function connectMc(name = 'WebPlayer') {")
rep("""    log('wss 通道已建立，发送 states/biomes + 握手 + 登录');
    toMc(MC.handshake(MC_HOST, MC_PORT));""",
"""    log('wss 通道已建立，发送 states/biomes + 握手 + 登录');
    toMc(MC.handshake(MC_HOST, MC_PORT));""")

# 4) 0x15 Entity Relative Move：1.8 末尾有 bool onGround（文档 §6 表；实测剩 1 字节）
rep("""      case 0x15: { r.varInt(); r.i8(); r.i8(); r.i8(); return; }                      // Entity Move""",
"""      case 0x15: { r.varInt(); r.i8(); r.i8(); r.i8(); r.bool(); return; }            // Entity Move（1.8 带 onGround）""")

# 5) 0x23 Block Change：读出坐标与 state，转发给客户端（s = (id<<4)|meta，states 表下标）
rep("""      case 0x23: { r.i64(); r.varInt(); return; }                                     // Block Change""",
"""      case 0x23: { // Block Change：packedPos(long) + varInt blockId（=(id<<4)|meta 的 raw state）
        const packed = r.i64();
        const bx = Number(BigInt.asIntN(26, BigInt(packed) >> 38n));
        const bz = Number(BigInt.asIntN(26, (BigInt(packed) << 26n) >> 38n));
        const by = Number((BigInt(packed) >> 26n) & 0xFFFn);
        out.block = { x: bx, y: by, z: bz, s: r.varInt() };
        return;
      }""")

# 6) 0x39 Abilities → 转发 flags（OpusMC: bit1 可飞 bit2 飞行中，语义一致）
rep("""      case 0x39: { r.u8(); r.f32(); r.f32(); return; }                                // Abilities""",
"""      case 0x39: { out.abilities = { flags: r.u8() }; r.f32(); r.f32(); return; }     // Abilities""")

# 7) 0x07 Respawn → respawn 消息（客户端 enterWorld 重置世界）
rep("""      case 0x07: { // Respawn：int + uByte + uByte + string
        r.i32(); r.u8(); r.u8(); r.string();
        return;
      }""",
"""      case 0x07: { // Respawn（文档 §5.1：维度靠坐标带切，以此为准）
        const dimId = r.i32(); r.u8(); r.u8(); r.string();
        out.respawn = { dim: dimId === -1 ? 'nether' : dimId === 1 ? 'the_end' : 'overworld' };
        return;
      }""")

# 8) mcToClient：补 block/abilities/respawn/time 下发
rep("""  if (out.time) toClient({ t: 'time', day: (r_i64_cache.dayTime ?? 1000), rate: 1 });""",
"""  if (out.time) { r_i64_cache.dayTime = ((out.time.dayTime % 24000) + 24000) % 24000; toClient({ t: 'time', day: r_i64_cache.dayTime, rate: 1 }); }
  if (out.block) toClient({ t: 'block', x: out.block.x, y: out.block.y, z: out.block.z, s: out.block.s });
  if (out.abilities) toClient({ t: 'abilities', flags: out.abilities.flags });
  if (out.respawn) { toClient({ t: 'respawn', dim: out.respawn.dim, minY: 0, mode: mcModeName }); log('维度切换：' + out.respawn.dim); }""")

# mcModeName 由 join 记录
rep("""  if (out.join) {
    mcEid = out.join.eid;""",
"""  if (out.join) {
    mcEid = out.join.eid;
    mcModeName = out.join.gm === 1 ? 'creative' : 'survival';""")
rep("let mcChunks = 0;", "let mcChunks = 0;\nlet mcModeName = 'survival';")

# 9) C→S 翻译扩展：dig→0x07、drop→0x07(3/4)、空 tick→0x03 onGround
rep("""function clientToMc(o) {
  if (!mc) return;
  switch (o.t) {
    case 'tick': {
      statTickIn++;
      const p = o.pos || [];
      if (p.length >= 6) { toMc(MC.posLook(p[0], p[1], p[2], p[3], p[4], !!p[5])); statPosOut++; }
      break;
    }
    case 'chat': toMc(MC.chat(String(o.text || '').slice(0, 256))); break;
    case 'tpok': break;                         // 1.8 无 teleport confirm，丢弃
    case 'error': break;                        // 客户端内部错误，忽略
    default: break;                             // dig/place/held 等 M3
  }
}""",
"""function clientToMc(o) {
  if (!mc) return;
  switch (o.t) {
    case 'tick': {
      statTickIn++;
      const p = o.pos || [];
      if (p.length >= 6) {
        // PHPMC handlePlay：0x06 = Position And Look（f64×3 + f32×2 + bool）
        toMc(MC.posLook(p[0], p[1], p[2], p[3], p[4], !!p[5])); statPosOut++;
      } else {
        toMc(MC.posGround(true)); // 站着不动也要报 onGround，防位置流断
      }
      break;
    }
    case 'chat': toMc(MC.chat(String(o.text || '').slice(0, 100))); break;   // PHPMC readString(100)
    case 'dig': { // 0=start 1=abort 2=finish → 直通 0x07（PHPMC 同义）
      toMc(MC.dig(o.status | 0, o.x, o.y, o.z, o.face | 0));
      break;
    }
    case 'drop': toMc(MC.dig(o.all ? 3 : 4, 0, 0, 0, 0)); break;             // 丢物品：status 3 整组 / 4 单个
    case 'held': break;   // PHPMC 无 0x09（服务端自行记账），跳过
    case 'settings': break; // rd 视距，M3 用于限制区块请求范围
    case 'tpok': break;     // 1.8 无 teleport confirm
    case 'click': case 'creative': case 'trade': case 'sign': break;         // 容器/创造/交易：M3
    case 'error': break;
    default: break;
  }
}""")

# 10) MC 编码器：补 posGround / dig
rep("""  chat(text) { return framePacket(0x01, new Writer().string(text).build()); },""",
"""  chat(text) { return framePacket(0x01, new Writer().string(text).build()); },
  posGround(onGround) { return framePacket(0x03, new Writer().bool(onGround).build()); },
  dig(status, x, y, z, face) { // 0x07：u8 status + long packedPos + u8 face
    const packed = ((BigInt(x | 0) & 0x3FFFFFFn) << 38n) | ((BigInt(z | 0) & 0x3FFFFFFn) << 12n) | (BigInt(y | 0) & 0xFFFn);
    return framePacket(0x07, new Writer().bytes((() => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt.asIntN(64, packed)); return b; })()).u8(status).u8(face).build());
  },""")

open(p, 'w', newline='', encoding='utf-8').write(t)
print('mc-proxy.mjs 大修完成：HTTP 升级 + hello + 0x15 + block/abilities/respawn/time + dig/drop')
