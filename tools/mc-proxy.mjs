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
import { VERSION, BLOCK_NAMES, BIOME_NAMES, MC_ITEM_NAMES, MC_ITEM_IDS, MC_MOBS,
  chunkToOpus, packPosBytes, unpackPos } from './chunk-format.mjs';

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
      shift += 7;
      if (shift > 28) throw new Error('varInt 太长');
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
  i8(v) { const b = Buffer.alloc(1); b.writeInt8(v | 0); this.parts.push(b); return this; }
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
// 解帧（服务端收到的帧应带 mask；未收全的留在 buf）
// frames 传入数组 = 逐帧模式（OpusMC 的 JSON 文本帧，一个 chunk 里多条消息绝不能拼）；
// 不传 = 字节流模式（PHPMC 的 MC 字节流，帧边界 != 包边界，必须拼接后按 VarInt 分帧）。
function wsDecode(bufRef, frames) {
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
    if (frames) frames.push({ opcode, data });
    else payload = Buffer.concat([payload, data]); // 0x0/0x1/0x2 一律当字节流拼（仅 PHPMC 侧）
  }
  return { payload, closed };
}

// ws 服务端连接包装（给 OpusMC 客户端）
function wrapServerSocket(socket) {
  const st = { buf: Buffer.alloc(0), pong: null, upgraded: false, handlers: { message: null, close: null } };
  socket.on('error', () => { }); // 客户端断开/ECONNRESET 不让进程崩
  socket.on('data', (chunk) => {
    if (process.env.MCPROXY_DEBUG) console.log('[dbg] data ' + chunk.length + 'B upgraded=' + st.upgraded + ' head=' + chunk.subarray(0, 8).toString('hex'));
    st.buf = Buffer.concat([st.buf, chunk]);
    // HTTP 升级：浏览器 WebSocket 的第一步。回 101 + Sec-WebSocket-Accept，剩余字节进 ws 流
    if (!st.upgraded) {
      const i = st.buf.indexOf('\r\n\r\n');
      if (i === -1) return; // 头还没收全
      const head = st.buf.subarray(0, i).toString('utf8');
      const m = /Sec-WebSocket-Key:\s*(\S+)/i.exec(head);
      if (!/^GET /m.test(head) || !m) return; // 不是升级请求，按旧路走
      const accept = crypto.createHash('sha1').update(m[1] + WS_MAGIC).digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
      st.upgraded = true;
      const rest = st.buf.subarray(i + 4);
      st.buf = Buffer.alloc(0);
      if (rest.length) { st.buf = Buffer.concat([st.buf, rest]); }
      return; // 升级帧本身不带消息
    }
    // 客户端消息是 JSON 文本帧 —— 必须逐帧分派。
    // v2.2.1 根因：旧代码外层循环看着像「逐帧」，但 wsDecode 内部会把同 chunk 的所有帧
    // concat 成一个 payload，多个 JSON 拼在一起 parse 必炸 -> 整批交互消息静默丢失。
    // 这就是「放置/攻击/容器点击全没反应」而 tick 正常（tick 每 100ms 单独一帧）的原因。
    const frames = [];
    const r = wsDecode(st, frames);
    if (st.pong) { socket.write(st.pong); st.pong = null; }
    if (r.closed) { socket.end(); st.handlers.close && st.handlers.close(); return; }
    for (const f of frames) if (f.opcode === 0x1 && st.handlers.message) st.handlers.message(f.data);
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
function connectWss(host, port, onOpen, onMessage, onClose) {
  const key = crypto.randomBytes(16).toString('base64');
  // tls.connect 的 options 里绝不能带 path —— path 会让 Node 误走 Unix socket（EPERM）
  const sockOpts = { host, port, rejectUnauthorized: false };
  const r = (MC_SECURE ? tls : net).connect(sockOpts, () => {
    r.write(
      `GET / HTTP/1.1\r\n` +
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
      // HTTP 头之后的剩余字节才是 WS 数据流的开头；去掉头之后绝不能再把整个 chunk 重复拼接
      // （否则重复的 HTTP 头被 wsDecode 当帧读，首字节 'H'=0x48 低 4 位=8 正好命中 close 帧 → 假断开）
      chunk = buf.subarray(idx + 4);
      buf = Buffer.alloc(0);
      onOpen();
      if (chunk.length === 0) return;
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
  posGround(onGround) { return framePacket(0x03, new Writer().bool(onGround).build()); },
  dig(status, x, y, z, face) { // 0x07：u8 status + long packedPos + u8 face（坐标用 PHPMC 布局）
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
  },
  useEntity(eid, action, x = 0, y = 0, z = 0) { // 0x02：1=攻击 0=交互 2=对某点交互
    const w = new Writer().varInt(eid).varInt(action);
    if (action === 2) w.f32(x).f32(y).f32(z);
    return framePacket(0x02, w.build());
  },
  closeWindow(id) { return framePacket(0x0D, new Writer().i8(id).build()); },
  posLook(x, y, z, yaw, pitch, onGround) {
    return framePacket(0x06, new Writer().f64(x).f64(y).f64(z).f32(yaw).f32(pitch).bool(onGround).build());
  },
  // S→C 解码：返回 {id, 语义处理}——按 PHPMC 发送集全表
  decode(id, r, out) {
    switch (id) {
      case 0x00: out.keepAlive = r.varInt(); return;                                  // Keep Alive
      case 0x01: { // Join Game：int eid + uByte gm + byte dim + uByte diff + uByte max + string level + bool reducedDebug
        // PHPMC 比标准 1.8 多发一个 bool（reduced debug info）——少读它会导致整个流错位 1 字节
        out.join = { eid: r.i32(), gm: r.u8(), dim: r.i8(), diff: r.u8(), max: r.u8(), level: r.string() };
        r.u8();
        return;
      }
      case 0x02: { // Chat：string json + byte pos
        const json = r.string(), pos = r.i8();
        try { const j = JSON.parse(json); out.chat = { text: j.text || '', extra: j.extra || null }; }
        catch (e) { out.chat = { text: json }; }
        out.chatPos = pos;
        return;
      }
      case 0x03: { const age = r.i64(); out.time = { worldAge: age, dayTime: r.i64() }; return; } // Time Update
      case 0x05: r.i64(); return;                                                     // Spawn Position
      case 0x06: { // Update Health：float + varInt + float
        out.health = { hp: r.f32(), food: r.varInt(), sat: r.f32() };
        return;
      }
      case 0x07: { // Respawn（文档 §5.1：维度靠坐标带切，以此为准）
        const dimId = r.i32(); r.u8(); r.u8(); r.string();
        out.respawn = { dim: dimId === -1 ? 'nether' : dimId === 1 ? 'the_end' : 'overworld' };
        return;
      }
      case 0x08: { // Position & Look：double×3 + float×2 + byte flags
        out.posLook = { x: r.f64(), y: r.f64(), z: r.f64(), yaw: r.f32(), pitch: r.f32() };
        r.u8();
        return;
      }
      case 0x0A: { r.varInt(); r.i64(); return; }                                     // Use Bed
      case 0x0B: { const eid = r.varInt(); out.anim = { id: eid, a: r.u8() }; return; } // Animation（挥手）
      case 0x0C: { // Spawn Player：eid + uuid16 + int×3(×32) + yaw/pitch + held(short) + metadata
        const eid = r.varInt();
        const uuid = r.raw(16);
        const x = r.i32() / 32, y = r.i32() / 32, z = r.i32() / 32;
        const yaw = r.u8() * 360 / 256, pitch = r.u8() * 360 / 256;
        const held = r.i16();
        skipMetadata(r);
        entPos.set(eid, { x, y, z, yawDeg: yaw, pitchDeg: pitch });
        out.spawn = { type: 'player', id: eid, uuid: uuidHex(uuid), x, y, z, yaw, pitch, name: playerNames.get(uuidHex(uuid)) };
        if (held > 0) out.equip = { id: eid, item: { n: MC_ITEM_NAMES[held] || null, c: 1 } };
        return;
      }
      case 0x0D: { out.collect = { id: r.varInt(), by: r.varInt() }; return; }        // Collect Item
      case 0x0E: { // Spawn Object：eid + type + int×3 + yaw/pitch + int data + (data>0: vel×3)
        const eid = r.varInt(), type = r.u8();
        const x = r.i32() / 32, y = r.i32() / 32, z = r.i32() / 32;
        r.u8(); r.u8();
        const data = r.i32();
        if (data > 0) { r.i16(); r.i16(); r.i16(); }
        if (type === 2) { // 掉落物：物品栈由紧随其后的 0x1C(index 10) 给
          entPos.set(eid, { x, y, z, yawDeg: 0, pitchDeg: 0 });
          out.spawn = { type: 'item', id: eid, x, y, z };
          log(`掉落物 0x0E：eid=${eid} @ ${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`);
        }
        return;
      }
      case 0x0F: { // Spawn Mob：eid + uByte type + int×3(×32) + yaw/pitch/head + vel×3 + metadata
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
      }
      case 0x11: { r.varInt(); r.i32(); r.i32(); r.i32(); r.i16(); return; }          // Spawn XP Orb
      case 0x12: { r.varInt(); r.i16(); r.i16(); r.i16(); return; }                   // Entity Velocity
      case 0x13: { // Destroy Entities
        const n = r.varInt(); const ids = [];
        for (let i = 0; i < n; i++) { const eid = r.varInt(); ids.push(eid); entPos.delete(eid); }
        if (ids.length) out.remove = ids;
        return;
      }
      case 0x15: { // Entity Relative Move：delta i8（×32），在位置表上累计后发绝对 move
        const eid = r.varInt();
        const dx = r.i8() / 32, dy = r.i8() / 32, dz = r.i8() / 32;
        r.bool();
        const e = entPos.get(eid);
        if (e) { e.x += dx; e.y += dy; e.z += dz; out.move = { id: eid, x: e.x, y: e.y, z: e.z }; }
        return;
      }
      case 0x16: { // Entity Look（yaw/pitch 是 0-255 圈）
        const eid = r.varInt();
        const yaw = r.u8() * 360 / 256, pitch = r.u8() * 360 / 256;
        r.bool();
        const e = entPos.get(eid);
        if (e) { e.yawDeg = yaw; e.pitchDeg = pitch; out.move = { id: eid, yaw, pitch }; }
        return;
      }
      case 0x17: { // Entity Move & Look：delta i8（×32）+ yaw/pitch
        const eid = r.varInt();
        const dx = r.i8() / 32, dy = r.i8() / 32, dz = r.i8() / 32;
        const yaw = r.u8() * 360 / 256, pitch = r.u8() * 360 / 256;
        r.bool();
        const e = entPos.get(eid);
        if (e) { e.x += dx; e.y += dy; e.z += dz; e.yawDeg = yaw; e.pitchDeg = pitch; out.move = { id: eid, x: e.x, y: e.y, z: e.z, yaw, pitch }; }
        return;
      }
      case 0x18: { // Entity Teleport：绝对 int×32
        const eid = r.varInt();
        const x = r.i32() / 32, y = r.i32() / 32, z = r.i32() / 32;
        const yaw = r.u8() * 360 / 256, pitch = r.u8() * 360 / 256;
        r.bool();
        entPos.set(eid, { x, y, z, yawDeg: yaw, pitchDeg: pitch });
        out.move = { id: eid, x, y, z, yaw, pitch, tp: true };
        return;
      }
      case 0x19: { const eid = r.varInt(); out.head = { id: eid, yaw: r.u8() * 360 / 256 }; return; } // Head Look
      case 0x1A: { // Entity Status：2=受伤（红闪+音效），3=死亡
        const eid = r.i32(); const st = r.u8();
        if (st === 2) out.hurt = { id: eid };
        return;
      }
      case 0x1B: { r.i32(); r.i32(); r.bool(); return; }                              // Attach Entity
      case 0x1C: { // Entity Metadata：掉落物的物品栈在 index 10 / type 5
        const eid = r.varInt();
        out.entityMeta = { id: eid, item: null };
        scanMetadata(r, (idx, type, v) => { if (idx === 10 && type === 5) out.entityMeta.item = v; });
        return;
      }
      case 0x1F: { r.f32(); r.varInt(); r.varInt(); return; }                         // Set Experience
      case 0x21: { // Chunk Data —— PHPMC 特例：primaryBitmask 是 short
        if (!global.__chunkDumped) {
          global.__chunkDumped = true;
          log('0x21 原始字节(前24): ' + r.b.subarray(0, 24).toString('hex') + ' | 总长 ' + r.b.length);
        }
        out.chunk = { cx: r.i32(), cz: r.i32() };
        out.chunk.groundUp = r.bool();  // false = 增量段更新（PHPMC 目前停用，但必须能识别）
        out.chunk.mask = r.u16();   // 协议清单 §3：primaryBitMask 是 ushort
        const size = r.varInt();
        out.chunk.data = r.raw(size);   // 保留原始字节供 M2 区块翻译
        out.chunk.size = size;
        return;
      }
      case 0x23: { // Block Change：PHPMC 坐标布局 x<<38|y<<26|z（原代码按标准 1.8 解，y/z 全错）
        const [bx, by, bz] = unpackPos(r.raw(8).readBigInt64BE(0));
        out.block = { x: bx, y: by, z: bz, s: r.varInt() };
        return;
      }
      case 0x29: { // Spawn Painting（文档 §5.3：0x29 与 Sound Effect 双占用；PHPMC 已关音效，恒为画）
        const before = r.left;
        r.varInt(); r.string(); r.i64(); r.u8();
        if (r.left !== 0) throw new Error('0x29 解码后剩 ' + r.left + 'B（可能是音效包，按 §5.3 处理）');
        return;
      }
      case 0x2B: { // Change Game State：reason 1=开始下雨 2=停
        const reason = r.u8(); r.f32();
        if (reason === 1 || reason === 2) out.rain = { on: reason === 1 };
        return;
      }
      case 0x2D: { out.winOpen = { id: r.u8(), type: r.string(), title: r.string(), slots: r.u8() }; return; }
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
      }
      case 0x35: { // Update Tile Entity：packedPos(long) + uByte action + NBT blob（1.8 无 present 字节）
        if (!global.__teDumped) {
          global.__teDumped = true;
          log('0x35 hex(前40): ' + r.b.subarray(0, 40).toString('hex') + ' 总长 ' + r.b.length);
        }
        r.i64(); r.u8();
        skipNbt(r);
        return;
      }
      case 0x36: { r.i64(); return; }                                                 // Sign Editor Open
      case 0x38: { // Player List：action=0 的 uuid+name 是头顶名牌唯一来源（文档 §5.2）
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
      }
      case 0x39: { out.abilities = { flags: r.u8() }; r.f32(); r.f32(); return; }     // Abilities
      case 0x40: { out.kick = r.string(); return; }                                   // Disconnect
      default:
        throw new Error('未收录的 PHPMC 包 0x' + id.toString(16) + '（剩余 ' + r.left + 'B）—— 流错位，需要重连/补表');
    }
  },
};

// Slot Data：short id(-1=空) + byte count + short dmg + byte nbtPresent(+NBT)
function readSlot(r) {
  const id = r.i16();
  if (id < 0) return null;
  const count = r.i8(), dmg = r.i16();
  const flag = r.u8();
  if (flag === 0x0A) { r.o -= 1; skipNbt(r); } // PHPMC slotBytes：直接写 NBT 根标签，没有 present 字节
  else if (flag === 1) skipNbt(r);              // 标准 1.8：present=1 + NBT 根标签
  // 0x00 = 无 NBT。少跳 NBT 会让后面所有槽位错位，快捷栏记账就成 0（放置被服务端拒）
  return { id, count, dmg };
}
function slotToClient(s) { return s ? { n: MC_ITEM_NAMES[s.id] || 'stone', c: s.count, d: s.dmg } : null; }
// metadata（watch：byte 类型<<5|索引 + 值，0x00 结尾）——按 1.8 标准
function skipMetadata(r) { scanMetadata(r, () => {}); }
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
}
// NBT 跳过（PHPMC Nbt::write：named root = type + u16 名长 + 名字 + entries + 0x00）
// 坑：绝不能写 `r.o += r.u16()` —— += 先取旧 r.o，u16() 又推进 2 字节，赋值会把那 2 字节抹掉，
// 名字长度永远少跳 2 字节，0x35 每次都剩下一堆字节（v2.0.0 端到端实测抓到）。
function skipNbt(r) {
  const t = r.u8();
  const nameLen = r.u16();
  r.o += nameLen;
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
    case 10: { for (;;) { const t2 = r.u8(); if (t2 === 0) break; const nl = r.u16(); r.o += nl; skipNbtPayload(r, t2); } break; }
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

// ---- 实体状态（0x38 名字表 + 实体绝对位置表，0x15/0x17 相对移动在上面累计）----
const entPos = new Map();      // eid -> {x, y, z, yawDeg, pitchDeg}
const playerNames = new Map(); // uuidHex -> name（0x38 action=0）
function uuidHex(buf) { return buf.toString('hex'); }
// MC_MOBS 已移到 ./chunk-format.mjs（按 1.8 真实 type id 校正，去掉客户端不支持的项）
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
function heldItemId() { return hotbar[heldSlot] || 0; }

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
    mcModeName = out.join.gm === 1 ? 'creative' : 'survival';
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
  if (out.time) { r_i64_cache.dayTime = ((out.time.dayTime % 24000) + 24000) % 24000; toClient({ t: 'time', day: r_i64_cache.dayTime, rate: 1 }); }
  if (out.block) toClient({ t: 'block', x: out.block.x, y: out.block.y, z: out.block.z, s: out.block.s });
  if (out.abilities) toClient({ t: 'abilities', flags: out.abilities.flags });
  if (out.players) toClient({ t: 'players', list: out.players });
  if (out.spawn) toClient(Object.assign({ t: 'spawn' }, out.spawn));
  if (out.equip) toClient({ t: 'equip', id: out.equip.id, item: out.equip.item });
  if (out.entityMeta && out.entityMeta.item) {
    log(`掉落物 0x1C：eid=${out.entityMeta.id} item=${JSON.stringify(slotToClient(out.entityMeta.item))}`);
    toClient({ t: 'meta', id: out.entityMeta.id, item: slotToClient(out.entityMeta.item) });
  }
  if (out.collect) toClient({ t: 'collect', id: out.collect.id, by: out.collect.by });
  if (out.remove) toClient({ t: 'remove', ids: out.remove });
  if (out.move) toClient(Object.assign({ t: 'move' }, out.move));
  if (out.head) toClient({ t: 'head', id: out.head.id, yaw: out.head.yaw });
  if (out.hurt) toClient({ t: 'hurt', id: out.hurt.id });
  if (out.anim) toClient({ t: 'anim', id: out.anim.id, a: out.anim.a });
  if (out.rain) toClient({ t: 'rain', on: out.rain.on });
  if (out.respawn) {
    // PHPMC 每 0.5s 比对坐标带，边界抖动会反复发 0x07；respawn 会清整个世界重建，
    // 重复发就是「切维度特别慢」的主因。只在维度真变化时才转发。
    if (out.respawn.dim === lastDim) log(`维度未变化(${lastDim})，跳过重复 respawn`);
    else { lastDim = out.respawn.dim; toClient({ t: 'respawn', dim: out.respawn.dim, minY: 0, mode: mcModeName }); log('维度切换：' + out.respawn.dim); }
  }
  if (out.health) toClient({ t: 'health', hp: out.health.hp, food: out.health.food, sat: out.health.sat });
  if (out.posLook) toClient({ t: 'pos', x: out.posLook.x, y: out.posLook.y, z: out.posLook.z, yaw: out.posLook.yaw, pitch: out.posLook.pitch });
  if (out.chunk) {
    if (out.chunk.mask === 0 && out.chunk.groundUp) {
      toClient({ t: 'unload', cx: out.chunk.cx, cz: out.chunk.cz });
    } else if (out.chunk.groundUp === false) {
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
  }
  if (out.winOpen) {
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
  }
  if (out.wslot) {
    if (out.wslot.id === 0) recordHotbar([out.wslot.item], out.wslot.slot);
    toClient({ t: 'wslot', id: out.wslot.id, i: out.wslot.slot, item: slotToClient(out.wslot.item) });
  }
  if (out.winProp) toClient({ t: 'prop', id: out.winProp.id, k: out.winProp.k, v: out.winProp.v });
  if (out.sign) toClient({ t: 'signs', list: [[out.sign.x, out.sign.y, out.sign.z, out.sign.lines]] });
  if (out.kick) { toClient({ t: 'kick', reason: safeJson(out.kick) }); log('PHPMC 断开: ' + out.kick); }
}
let r_i64_cache = { dayTime: 1000 };
setInterval(() => {
  if (mc || statTickIn) log(`运行统计: 客户端tick=${statTickIn} 转发PosLook=${statPosOut} MC字节=${statMcBytes} MC帧=${statFrames} mcState=${mcState}`);
}, 10000);
let mcChunks = 0;
let mcModeName = 'survival';
let lastDim = 'overworld';
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
    case 'held': heldSlot = Math.max(0, Math.min(8, o.slot | 0)); toMc(MC.held(heldSlot)); break;
    case 'swing': toMc(MC.swing()); break;
    case 'place': { // 0x08：客户端不带物品名，用 0x30/0x2F 记下的快捷栏
      const cx = Math.round((o.cx ?? 0.5) * 15), cy = Math.round((o.cy ?? 0.5) * 15), cz = Math.round((o.cz ?? 0.5) * 15);
      const fallback = o.item && MC_ITEM_IDS.get(String(o.item));
      const item = heldItemId() || fallback || 0;
      log(`放置 0x08：@${o.x | 0},${o.y | 0},${o.z | 0} face=${o.face | 0} 物品=${item}（客户端=${o.item || '-'} 兜底=${fallback || '-'} hotbar=[${hotbar.join(',')}]）`);
      toMc(MC.place(o.x | 0, o.y | 0, o.z | 0, o.face | 0, item, cx, cy, cz));
      break;
    }
    case 'use': toMc(MC.useItem(heldItemId())); break;
    case 'click': {
      const pkt = MC.click(o.id | 0, o.slot | 0, o.button | 0, ++clickAction, o.mode | 0, o.carried);
      toMc(pkt);
      log(`点击 0x0E：win=${o.id} slot=${o.slot} mode=${o.mode} 字节=${pkt.length}`);
      break;
    }
    case 'settings': break; // rd 视距
    case 'attack': toMc(MC.useEntity(o.id | 0, 1)); break;                 // 0x02 攻击
    case 'interact': toMc(MC.useEntity(o.id | 0, 2, o.x || 0, o.y || 0, o.z || 0)); break;
    case 'wclose': toMc(MC.closeWindow(o.id | 0)); break;                    // 0x0D Close Window
    case 'button': toMc(MC.click(o.id | 0, o.b | 0, 0, ++clickAction, 0, null)); break;
    case 'tpok': break;     // 1.8 无 teleport confirm
    case 'creative': case 'trade': case 'sign': break;
    case 'error': break;
    default: break;
  }
}

// ============================ 主流程 ============================
const server = net.createServer((socket) => {
  socket.on('error', () => { });
  if (client) { try { client.close(); } catch (e) { } } // 单客户端：新的顶掉旧的
  client = wrapServerSocket(socket);
  let playerName = 'WebPlayer';
  log('OpusMC 客户端已接入（HTTP 升级完成）—— 等待 hello 握手');
  client.onMessage((payload) => {
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
  });
  client.onClose(() => { log('OpusMC 客户端断开'); client = null; if (mc) mc.close(); mc = null; mcState = 'idle'; });
});
let lastTick = null;

server.listen(CLIENT_PORT, () => log(`[mc-proxy v${VERSION}] 中转就绪：OpusMC「直接连接」填 ws://localhost:${CLIENT_PORT} → PHPMC ${MC_SECURE ? 'wss' : 'ws'}://${MC_HOST}:${MC_PORT}`));

// 连接 PHPMC（登录链路：握手 → LoginStart → Play）
function connectMc(name = 'WebPlayer') {
  if (mc) mc.close();
  mcState = 'connecting';
  log(`连接 PHPMC ${MC_SECURE ? 'wss' : 'ws'}://${MC_HOST}:${MC_PORT}（玩家 ${name}）`);
  mc = connectWss(MC_HOST, MC_PORT, () => {
    // 先把方块状态表（4096 项）与群系表发给客户端——客户端 mapVanillaStateNear 自己映射
    toClient({ t: 'states', list: BLOCK_NAMES });
    toClient({ t: 'biomes', list: BIOME_NAMES });
    log(`wss 通道已建立 v${VERSION}：发送 states/biomes + 握手 + 登录`);
    toMc(MC.handshake(MC_HOST, MC_PORT));
    toMc(MC.loginStart(name));
    mcState = 'login';
  }, (payload) => {
    // MC 字节流分帧（VarInt 包长）
    mcBuf = Buffer.concat([mcBuf, payload]);
    drainMc();
  }, (why) => {
    log(`PHPMC 连接断开(${why}) — 统计: 客户端tick=${statTickIn} 转发PosLook=${statPosOut} MC字节=${statMcBytes} MC帧=${statFrames}`);
    mcState = 'idle';
    entPos.clear(); playerNames.clear();
    toClient({ t: 'kick', reason: '与 PHPMC 的连接断开：' + why });
    mc = null;
  });
}
let mcBuf = Buffer.alloc(0);
let statTickIn = 0, statPosOut = 0, statMcBytes = 0, statFrames = 0;
function drainMc() {
  for (;;) {
    const b = mcBuf;
    let len = 0, shift = 0, o = 0, ok = false;
    while (o < b.length) {
      const byte = b[o++];
      len |= (byte & 0x7F) << shift;
      if (!(byte & 0x80)) { ok = true; break; }
      shift += 7;
      if (shift > 28) break;
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
        const before = r.left;
        try { mcToClient(id, r); } finally {
          if (r.left !== 0) log(`⚠ 包 0x${id.toString(16)} 解码后剩余 ${r.left}/${before + 1} 字节（应为 0）—— 字段表有误，后续流将错位`);
        }
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


// v2.0.0：区块打包、方块/物品/生物名表已抽到 ./chunk-format.mjs
