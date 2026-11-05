#!/usr/bin/env node
// ============================================================================
// mc-proxy.mjs — OpusMC 网页客户端 ↔ PHPMC（MC 1.8.9）双协议中转（M1）
//
//   OpusMC 客户端 --ws://localhost:8780--> 本中转 --wss://PHPMC:24443--> PHPMC
//
//   客户端侧：按 net.js 的 proxy 协议（JSON 文本消息 t:xxx + 二进制帧）
//   PHPMC 侧：WebSocket.php 的 eaglercraft 式通道（binary 帧 = MC 1.8.9 字节流）
//
// 用法：node tools/mc-proxy.mjs [PHPMC地址] [PHPMC端口]
//   默认 localhost:24443（PHPMC server.properties 的 wss-port）
// 然后 OpusMC「直接连接」填 ws://localhost:8780 即可。
// M1 范围：握手/登录/JoinGame/聊天/保活/位置/时间/生命值。区块翻译在 M2。
// ============================================================================
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

const MC_HOST = process.argv[2] || 'localhost';
const MC_PORT = +(process.argv[3] || 24443);
const MC_SECURE = true; // PHPMC wss 自签证书，直接信任
const CLIENT_PORT = +(process.argv[4] || 8780);

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

// ============================ VarInt / 类型 ============================
function writeVarInt(v) {
  v = v >>> 0;
  const out = [];
  do { let b = v & 0x7F; v >>>= 7; if (v !== 0) b |= 0x80; out.push(b); } while (v !== 0);
  return Buffer.from(out);
}
class Reader {
  constructor(buf) { this.b = buf; this.o = 0; }
  varInt() {
    let v = 0, shift = 0;
    for (;;) {
      const b = this.b[this.o++];
      v |= (b & 0x7F) << shift;
      if (!(b & 0x80)) break;
      if (++shift > 5) throw new Error('varInt 太长');
    }
    return v;
  }
  string() {
    const len = this.varInt();
    const s = this.b.subarray(this.o, this.o + len).toString('utf8');
    this.o += len;
    return s;
  }
  i64() { const hi = this.b.readInt32BE(this.o); this.o += 4; const lo = this.b.readUInt32BE(this.o); this.o += 4; return hi * 4294967296 + lo; }
  f64() { const v = this.b.readDoubleBE(this.o); this.o += 8; return v; }
  f32() { const v = this.b.readFloatBE(this.o); this.o += 4; return v; }
  u8() { return this.b[this.o++]; }
  i8() { const v = this.b[this.o++]; return v >= 0x80 ? v - 0x100 : v; }
  i16() { const v = this.b.readInt16BE(this.o); this.o += 2; return v; }
  u16() { const v = this.b.readUInt16BE(this.o); this.o += 2; return v; }
  i32() { const v = this.b.readInt32BE(this.o); this.o += 4; return v; }
  bool() { return this.b[this.o++] !== 0; }
  raw(n) { const s = this.b.subarray(this.o, this.o + n); this.o += n; return s; }
  rest() { const s = this.b.subarray(this.o); this.o = this.b.length; return s; }
  get left() { return this.b.length - this.o; }
}
class Writer {
  constructor() { this.parts = []; }
  varInt(v) { this.parts.push(writeVarInt(v)); return this; }
  string(s) { const b = Buffer.from(String(s), 'utf8'); this.varInt(b.length); this.parts.push(b); return this; }
  bytes(b) { this.parts.push(b); return this; }
  i32(v) { const b = Buffer.alloc(4); b.writeInt32BE(v | 0); this.parts.push(b); return this; }
  i16(v) { const b = Buffer.alloc(2); b.writeInt16BE(v | 0); this.parts.push(b); return this; }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xFFFF); this.parts.push(b); return this; }
  u8(v) { this.parts.push(Buffer.from([v & 0xFF])); return this; }
  bool(v) { this.parts.push(Buffer.from([v ? 1 : 0])); return this; }
  f32(v) { const b = Buffer.alloc(4); b.writeFloatBE(v); this.parts.push(b); return this; }
  f64(v) { const b = Buffer.alloc(8); b.writeDoubleBE(v); this.parts.push(b); return this; }
  build() { return Buffer.concat(this.parts); }
}
function framePacket(id, body) {
  const idB = writeVarInt(id);
  const payload = Buffer.concat([idB, body || Buffer.alloc(0)]);
  return Buffer.concat([writeVarInt(payload.length), payload]);
}

// ============================ RFC6455 WebSocket ============================
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function wsAccept(key) { return crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64'); }
function wsEncode(opcode, data) {
  const len = data.length;
  let head;
  if (len < 126) { head = Buffer.from([0x80 | opcode, len]); }
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
  return Buffer.concat([head, data]);
}
// 解帧（服务端收到的帧应带 mask；返回 {payloads, closed}，未收全的留在 buf）
function wsDecode(bufRef) {
  let payload = Buffer.alloc(0), closed = false;
  for (;;) {
    const buf = bufRef.buf, len = buf.length;
    if (len < 2) break;
    const b0 = buf[0], b1 = buf[1];
    const opcode = b0 & 0x0F;
    const masked = (b1 & 0x80) !== 0;
    let plen = b1 & 0x7F, off = 2;
    if (plen === 126) { if (len < 4) break; plen = buf.readUInt16BE(2); off = 4; }
    else if (plen === 127) { if (len < 10) break; plen = buf.readUInt32BE(6); off = 10; }
    let maskKey = null;
    if (masked) { if (len < off + 4) break; maskKey = buf.subarray(off, off + 4); off += 4; }
    if (len < off + plen) break;
    let data = Buffer.from(buf.subarray(off, off + plen));
    if (maskKey && plen > 0) for (let i = 0; i < plen; i++) data[i] ^= maskKey[i & 3];
    bufRef.buf = buf.subarray(off + plen);
    if (opcode === 0x8) { closed = true; break; }
    if (opcode === 0x9) { bufRef.pong = wsEncode(0xA, data); continue; } // 服务端要回 pong
    payload = Buffer.concat([payload, data]); // 0x0/0x1/0x2 一律当字节流拼
  }
  return { payload, closed };
}

// ws 服务端连接包装（给 OpusMC 客户端）
function wrapServerSocket(socket) {
  const st = { buf: Buffer.alloc(0), pong: null, handlers: { message: null, close: null } };
  socket.on('data', (chunk) => {
    st.buf = Buffer.concat([st.buf, chunk]);
    const { payload, closed } = wsDecode(st);
    if (st.pong) { socket.write(st.pong); st.pong = null; }
    if (closed) { socket.end(); st.handlers.close && st.handlers.close(); return; }
    if (payload.length && st.handlers.message) st.handlers.message(payload);
  });
  socket.on('close', () => st.handlers.close && st.handlers.close());
  return {
    sendText(o) { socket.write(wsEncode(0x1, Buffer.from(JSON.stringify(o), 'utf8'))); },
    sendBinary(b) { socket.write(wsEncode(0x2, b)); },
    onMessage(fn) { st.handlers.message = fn; },
    onClose(fn) { st.handlers.close = fn; },
    close() { try { socket.end(); } catch (e) { } },
  };
}

// wss 客户端连接包装（连 PHPMC，客户端帧要 mask；自签证书直接信任）
function connectWss(host, port, path, onOpen, onMessage, onClose) {
  const key = crypto.randomBytes(16).toString('base64');
  const req = {
    host, port, path: path || '/', method: 'GET',
    headers: {
      Host: `${host}:${port}`,
      Upgrade: 'websocket', Connection: 'Upgrade',
      'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13',
      Origin: 'https://www.bilibili.com',
    },
    rejectUnauthorized: false,
  };
  const reqObj = tls.connect ? null : null;
  const r = (MC_SECURE ? tls : net).connect(req, () => {
    r.write(
      `GET ${req.path} HTTP/1.1\r\n` +
      `Host: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n` +
      `Origin: https://www.bilibili.com\r\n\r\n`);
  });
  let upgraded = false, buf = Buffer.alloc(0);
  const api = {
    sendText(o) { r.write(wsEncode(0x1, Buffer.from(JSON.stringify(o), 'utf8'))); },
    sendBinary(b) { r.write(wsEncode(0x2, b)); },
    close() { try { r.end(); } catch (e) { } },
  };
  const onData = (chunk) => {
    if (!upgraded) {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) return;
      const header = buf.subarray(0, idx).toString('utf8');
      if (!/101 Switching Protocols/i.test(header) || !/Sec-WebSocket-Accept/i.test(header)) {
        onClose('握手失败：' + header.split('\r\n')[0]); return;
      }
      upgraded = true;
      buf = buf.subarray(idx + 4);
      onOpen();
    }
    buf = Buffer.concat([buf, chunk]);
    const st = { buf };
    const { payload, closed } = wsDecode(st);
    buf = st.buf;
    if (closed) { onClose('closed'); return; }
    if (payload.length) onMessage(payload);
  };
  r.on('data', onData);
  r.on('error', (e) => onClose('wss 错误: ' + e.message));
  r.on('close', () => { if (upgraded) onClose('closed'); });
  return api;
}

// ============================ MC 1.8.9 协议（PHPMC 侧） ============================
// 发送集按 PHPMC src/Server.php 的 C_* 常量与 send 调用点核对；未核对处按 1.8 标准（注释标注）
const MC = {
  // C→S
  handshake(host, port) {
    return framePacket(0x00, new Writer().varInt(47).string(host).u16(port).varInt(2).build());
  },
  loginStart(name) { return framePacket(0x00, new Writer().string(name).build()); },
  keepAlive(id) { return framePacket(0x00, new Writer().varInt(id).build()); },
  chat(text) { return framePacket(0x01, new Writer().string(text).build()); },
  posLook(x, y, z, yaw, pitch, onGround) {
    return framePacket(0x06, new Writer().f64(x).f64(y).f64(z).f32(yaw).f32(pitch).bool(onGround).build());
  },
  // S→C 解码：返回 {id, 语义处理}——按 PHPMC 发送集全表
  decode(id, r, out) {
    switch (id) {
      case 0x00: out.keepAlive = r.varInt(); return;                                  // Keep Alive
      case 0x01: { // Join Game：int eid + uByte gm + byte dim + uByte diff + uByte max + string level
        out.join = { eid: r.i32(), gm: r.u8(), dim: r.i8(), diff: r.u8(), max: r.u8(), level: r.string() };
        return;
      }
      case 0x02: { // Chat：string json + byte pos
        const json = r.string(), pos = r.i8();
        try { const j = JSON.parse(json); out.chat = { text: j.text || '', extra: j.extra || null }; }
        catch (e) { out.chat = { text: json }; }
        out.chatPos = pos;
        return;
      }
      case 0x03: r.i64(); r.i64(); return;                                            // Time Update
      case 0x05: r.i64(); return;                                                     // Spawn Position
      case 0x06: { // Update Health：float + varInt + float
        out.health = { hp: r.f32(), food: r.varInt(), sat: r.f32() };
        return;
      }
      case 0x07: { // Respawn：int + uByte + uByte + string
        r.i32(); r.u8(); r.u8(); r.string();
        return;
      }
      case 0x08: { // Position & Look：double×3 + float×2 + byte flags
        out.posLook = { x: r.f64(), y: r.f64(), z: r.f64(), yaw: r.f32(), pitch: r.f32() };
        r.u8();
        return;
      }
      case 0x0A: { r.varInt(); r.i64(); return; }                                     // Use Bed
      case 0x0B: { r.varInt(); r.u8(); return; }                                      // Animation
      case 0x0C: { // Spawn Player：eid + uuid16 + int×3 + yaw/pitch + held(short) + metadata
        r.varInt(); r.raw(16); r.i32(); r.i32(); r.i32(); r.u8(); r.u8(); r.i16();
        skipMetadata(r);
        return;
      }
      case 0x0D: { r.varInt(); r.varInt(); return; }                                  // Collect Item
      case 0x0E: { // Spawn Object：eid + type + int×3 + yaw/pitch + int data + (data>0: vel×3)
        r.varInt(); r.u8(); r.i32(); r.i32(); r.i32(); r.u8(); r.u8();
        const data = r.i32();
        if (data > 0) { r.i16(); r.i16(); r.i16(); }
        return;
      }
      case 0x0F: { // Spawn Mob：eid + uByte type + int×3 + yaw/pitch/head + vel×3 + metadata
        r.varInt(); r.u8(); r.i32(); r.i32(); r.i32(); r.u8(); r.u8(); r.u8();
        r.i16(); r.i16(); r.i16();
        skipMetadata(r);
        return;
      }
      case 0x11: { r.varInt(); r.i32(); r.i32(); r.i32(); r.i16(); return; }          // Spawn XP Orb
      case 0x12: { r.varInt(); r.i16(); r.i16(); r.i16(); return; }                   // Entity Velocity
      case 0x13: { const n = r.varInt(); for (let i = 0; i < n; i++) r.varInt(); return; } // Destroy
      case 0x15: { r.varInt(); r.i8(); r.i8(); r.i8(); return; }                      // Entity Move
      case 0x16: { r.varInt(); r.u8(); r.u8(); r.bool(); return; }                    // Entity Look
      case 0x17: { r.varInt(); r.i8(); r.i8(); r.i8(); r.u8(); r.u8(); r.bool(); return; } // Move&Look
      case 0x18: { r.varInt(); r.i32(); r.i32(); r.i32(); r.u8(); r.u8(); r.bool(); return; } // Teleport
      case 0x19: { r.varInt(); r.u8(); return; }                                      // Head Look
      case 0x1A: { r.i32(); r.u8(); return; }                                         // Entity Status
      case 0x1B: { r.i32(); r.i32(); r.bool(); return; }                              // Attach Entity
      case 0x1C: { r.varInt(); skipMetadata(r); return; }                             // Entity Metadata
      case 0x1F: { r.f32(); r.varInt(); r.varInt(); return; }                         // Set Experience
      case 0x21: { // Chunk Data —— PHPMC 特例：primaryBitmask 是 short
        out.chunk = { cx: r.i32(), cz: r.i32() };
        r.bool();
        const mask = r.i16();
        const size = r.varInt();
        r.raw(size);
        out.chunk.size = size;
        return;
      }
      case 0x23: { r.i64(); r.varInt(); return; }                                     // Block Change
      case 0x29: { r.varInt(); r.string(); r.i64(); r.u8(); return; }                 // Spawn Painting
      case 0x2B: { r.u8(); r.f32(); return; }                                         // Change Game State
      case 0x2D: { // Open Window：uByte id + string type + string title + uByte slots (+bool horse)
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
      case 0x33: { r.i64(); r.string(); r.string(); r.string(); r.string(); return; } // Update Sign
      case 0x35: { // Update Tile Entity：packedPos(long) + uByte action + NBT
        r.i64(); r.u8();
        if (r.u8() === 1) skipNbt(r);
        return;
      }
      case 0x36: { r.i64(); return; }                                                 // Sign Editor Open
      case 0x38: { // Player List：varInt action + varInt count + entries
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
      }
      case 0x39: { r.u8(); r.f32(); r.f32(); return; }                                // Abilities
      case 0x40: { out.kick = r.string(); return; }                                   // Disconnect
      default:
        throw new Error('未收录的 PHPMC 包 0x' + id.toString(16) + '（剩余 ' + r.left + 'B）—— 流错位，需要重连/补表');
    }
  },
};

// metadata（watch：byte 类型<<5|索引 + 值，0x00 结尾）——按 1.8 标准
function skipMetadata(r) {
  for (;;) {
    const h = r.u8();
    if (h === 0) return;
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
}
// NBT 跳过（PHPMC src/Nbt 标准格式）
function skipNbt(r) {
  const t = r.u8();
  skipNbtPayload(r, t);
}
function skipNbtPayload(r, typeId) {
  if (typeId === 0) return;
  switch (typeId) {
    case 1: r.o++; break;
    case 2: r.o += 2; break;
    case 3: r.o += 4; break;
    case 4: r.o += 8; break;
    case 5: r.o += 4; break;
    case 6: r.o += 8; break;
    case 7: { const n = r.i32(); r.o += n; break; }
    case 8: { const n = r.u16(); r.o += n; break; }
    case 9: { const it = r.u8(); const n = r.i32(); for (let i = 0; i < n; i++) skipNbtPayload(r, it); break; }
    case 10: { for (;;) { const t2 = r.u8(); if (t2 === 0) break; r.o += r.u16(); skipNbtPayload(r, t2); } break; }
    case 11: { const n = r.i32(); r.o += n * 4; break; }
    case 12: { const n = r.i32(); r.o += n * 8; break; }
    default: throw new Error('NBT 未知类型 ' + typeId);
  }
}

// ============================ 会话状态 ============================
let client = null;   // OpusMC 客户端连接（wrapServerSocket）
let mc = null;       // PHPMC 连接
let mcState = 'idle';
let mcEid = -1;
let chatLines = [];

function toClient(o) { if (client) client.sendText(o); }
function toMc(buf) { if (mc) mc.sendBinary(buf); }

// PHPMC → OpusMC 翻译（M1 子集）
function mcToClient(id, r) {
  const out = {};
  MC.decode(id, r, out);
  // PHPMC KeepAlive 探测：proxy 直接应答（30 秒不回会被服务端踢出）
  if (out.keepAlive !== undefined) { toMc(MC.keepAlive(out.keepAlive)); return; }
  if (out.join) {
    mcEid = out.join.eid;
    toClient({
      t: 'login', eid: out.join.eid, dim: 'overworld', minY: 0,
      mode: out.join.gm === 1 ? 'creative' : 'survival',
      spawn: null, time: 1000,
    });
    log(`PHPMC JoinGame：eid=${out.join.eid} 模式=${out.join.gm === 1 ? '创造' : '生存'}`);
  }
  if (out.chat) {
    let text = out.chat.text || '';
    if (out.chat.extra) for (const ex of out.chat.extra) text += flattenChat(ex);
    toClient({ t: 'chat', text, color: '#FFFFFF' });
    log('[聊天] ' + text);
  }
  if (out.time) toClient({ t: 'time', day: (r_i64_cache.dayTime ?? 1000), rate: 1 });
  if (out.health) toClient({ t: 'health', hp: out.health.hp, food: out.health.food, sat: out.health.sat });
  if (out.posLook) toClient({ t: 'pos', x: out.posLook.x, y: out.posLook.y, z: out.posLook.z, yaw: out.posLook.yaw, pitch: out.posLook.pitch });
  if (out.chunk) { mcChunks++; if (mcChunks % 25 === 1) log(`PHPMC 区块已收 ${mcChunks}（最新 ${out.chunk.cx},${out.chunk.cz} ${out.chunk.size}B）—— M2 翻译渲染`); }
  if (out.kick) { toClient({ t: 'kick', reason: flattenChat(safeJson(out.kick)) }); log('PHPMC 断开: ' + out.kick); }
}
let r_i64_cache = { dayTime: 1000 };
let mcChunks = 0;
function flattenChat(j) {
  let s = j.text || '';
  if (Array.isArray(j.extra)) for (const ex of j.extra) s += flattenChat(ex);
  return s;
}
function safeJson(s) { try { const j = JSON.parse(s); return flattenChat(j); } catch (e) { return s; } }

// 客户端 → PHPMC 翻译（M1 子集）
function clientToMc(o) {
  if (!mc) return;
  switch (o.t) {
    case 'tick': {
      // pos: [x, y(世界), z, yawDeg, pitchDeg, onGround, collidedH] → 0x06 Pos & Look
      const p = o.pos || [];
      if (p.length >= 6) toMc(MC.posLook(p[0], p[1], p[2], p[3], p[4], !!p[5]));
      break;
    }
    case 'chat': toMc(MC.chat(String(o.text || '').slice(0, 256))); break;
    case 'tpok': break;                         // 1.8 无 teleport confirm，丢弃
    case 'error': break;                        // 客户端内部错误，忽略
    default: break;                             // dig/place/held 等 M3
  }
}

// ============================ 主流程 ============================
const server = net.createServer((socket) => {
  if (client) { try { client.close(); } catch (e) { } } // 单客户端：新的顶掉旧的
  client = wrapServerSocket(socket);
  log('OpusMC 客户端已接入（直接连接）—— 主动连接 PHPMC（proxy 协议：服务端先发 login）');
  connectMc('WebPlayer');
  client.onMessage((payload) => {
    // proxy 协议：JSON 文本消息（客户端连上后等 proxy 先发 states/login —— 服务端先说话）
    let m;
    try { m = JSON.parse(payload.toString('utf8')); } catch (e) { return; }
    if (m.t === 'tick') { lastTick = m; clientToMc(m); return; }
    clientToMc(m);
  });
  client.onClose(() => { log('OpusMC 客户端断开'); client = null; if (mc) mc.close(); mc = null; mcState = 'idle'; });
});
let lastTick = null;

server.listen(CLIENT_PORT, () => log(`中转就绪：OpusMC「直接连接」填 ws://localhost:${CLIENT_PORT} → PHPMC ${MC_SECURE ? 'wss' : 'ws'}://${MC_HOST}:${MC_PORT}`));

// 连接 PHPMC（登录链路：握手 → LoginStart → Play）
function connectMc(name) {
  if (mc) mc.close();
  mcState = 'connecting';
  log(`连接 PHPMC ${MC_SECURE ? 'wss' : 'ws'}://${MC_HOST}:${MC_PORT}（玩家 ${name}）`);
  mc = connectWss(MC_HOST, MC_PORT, '/', () => {
    log('wss 通道已建立，发送握手 + 登录');
    toMc(MC.handshake(MC_HOST, MC_PORT));
    toMc(MC.loginStart(name));
    mcState = 'login';
  }, (payload) => {
    // MC 字节流分帧（VarInt 包长）
    mcBuf = Buffer.concat([mcBuf, payload]);
    drainMc();
  }, (why) => {
    log('PHPMC 连接断开: ' + why);
    mcState = 'idle';
    toClient({ t: 'kick', reason: '与 PHPMC 的连接断开：' + why });
    mc = null;
  });
}
let mcBuf = Buffer.alloc(0);
function drainMc() {
  for (;;) {
    const b = mcBuf;
    let len = 0, shift = 0, o = 0, ok = false;
    while (o < b.length) {
      const byte = b[o++];
      len |= (byte & 0x7F) << shift;
      if (!(byte & 0x80)) { ok = true; break; }
      if (++shift > 5) break;
    }
    if (!ok || o + len > b.length) break;
    const payload = b.subarray(o, o + len);
    mcBuf = b.subarray(o + len);
    const r = new Reader(payload);
    let id;
    try { id = r.varInt(); } catch (e) { return; }
    try {
      if (mcState === 'login') {
        if (id === 0x02) { mcState = 'play'; log('PHPMC 登录成功，进入 Play 状态'); continue; }
        if (id === 0x00) { log('登录被拒: ' + r.string()); mcState = 'idle'; continue; }
        continue;
      }
      if (mcState === 'play') {
        const out = {};
        mcToClient(id, r);
        // Time Update 的 dayTime 缓存（login 消息需要）
        if (id === 0x03) { /* 已在 decode 消费；dayTime 从 PHPMC 的 time 包取 */ }
      }
    } catch (e) {
      log('PHPMC 包解码异常: ' + e.message);
      mcBuf = Buffer.alloc(0); // 流错位保护：清缓冲重同步（会丢帧，实测调）
      break;
    }
  }
}

