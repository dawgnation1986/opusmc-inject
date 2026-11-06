#!/usr/bin/env node
// mc-observe.mjs — 直连 PHPMC wss，观察真实 MC 1.8.9 包流（不解析，纯分帧 dump）
// 用途：定位 0x21 ChunkData 的包长 VarInt 与 payload 的真实形态
import tls from 'node:tls';
import net from 'node:net';
const TCP_MODE = process.env.TCP === '1';
import crypto from 'node:crypto';

const HOST = process.argv[2] || 'localhost';
const PORT = +(process.argv[3] || 24443);
const NAME = process.argv[4] || 'ObserveBot';

const MAX_PKTS = +(process.env.MAX_PKTS || 40);

function writeVarInt(v) {
  v = v >>> 0; const out = [];
  do { let b = v & 0x7F; v >>>= 7; if (v !== 0) b |= 0x80; out.push(b); } while (v !== 0);
  return Buffer.from(out);
}
function framePacket(id, body) {
  const p = Buffer.concat([writeVarInt(id), body || Buffer.alloc(0)]);
  return Buffer.concat([writeVarInt(p.length), p]);
}
function wsEncode(op, d) {
  const len = d.length; let h;
  if (len < 126) h = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(len, 6); }
  return Buffer.concat([h, d]);
}

const key = crypto.randomBytes(16).toString('base64');
const sendLogin = (w) => {
  const nameB = Buffer.from(NAME, 'utf8');
  const hostB = Buffer.from(HOST, 'utf8');
  const hs = framePacket(0x00, Buffer.concat([writeVarInt(47), writeVarInt(hostB.length), hostB, (() => { const b = Buffer.alloc(2); b.writeUInt16BE(PORT); return b; })(), writeVarInt(2)]));
  const lg = framePacket(0x00, Buffer.concat([writeVarInt(nameB.length), nameB]));
  if (w) { sock.write(wsEncode(0x2, hs)); sock.write(wsEncode(0x2, lg)); }
  else { sock.write(hs); sock.write(lg); }
  console.log('[已发握手+LoginStart]');
};
const sock = TCP_MODE
  ? net.connect({ host: HOST, port: PORT }, () => { upgraded = true; sendLogin(false); })
  : tls.connect({ host: HOST, port: PORT, rejectUnauthorized: false }, () => {
  sock.write(`GET / HTTP/1.1\r\nHost: ${HOST}:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nOrigin: https://www.bilibili.com\r\n\r\n`);
});
let upgraded = false, wsBuf = Buffer.alloc(0), mcBuf = Buffer.alloc(0);
let pktCount = 0, chunkCount = 0;

sock.on('data', (chunk) => {
  if (TCP_MODE) { mcBuf = Buffer.concat([mcBuf, chunk]); drainMc(); return; }
  if (!upgraded) {
    wsBuf = Buffer.concat([wsBuf, chunk]);
    const i = wsBuf.indexOf('\r\n\r\n');
    if (i === -1) return;
    const head = wsBuf.subarray(0, i).toString('utf8');
    if (!/101/.test(head)) { console.log('握手失败:', head.split('\r\n')[0]); process.exit(1); }
    upgraded = true;
    console.log('[ws] 升级成功');
    let rest = wsBuf.subarray(i + 4); wsBuf = Buffer.alloc(0);
    // 登录
    sendLogin(true);
    if (rest.length) feed(rest);
    return;
  }
  feed(chunk);
});
function feed(chunk) {
  wsBuf = Buffer.concat([wsBuf, chunk]);
  for (;;) {
    const b = wsBuf, len = b.length;
    if (len < 2) break;
    const op = b[0] & 0x0F; let plen = b[1] & 0x7F, off = 2;
    if (plen === 126) { if (len < 4) break; plen = b.readUInt16BE(2); off = 4; }
    else if (plen === 127) { if (len < 10) break; plen = b.readUInt32BE(6); off = 10; }
    if (len < off + plen) break;
    const data = Buffer.from(b.subarray(off, off + plen));
    wsBuf = b.subarray(off + plen);
    if (op === 0x8) { console.log('[ws] close 帧'); process.exit(0); }
    if (op === 0x9) { sock.write(wsEncode(0xA, data)); continue; }
    mcBuf = Buffer.concat([mcBuf, data]);
  }
  drainMc();
}
function drainMc() {
  for (;;) {
    const b = mcBuf;
    // 包长 VarInt 原始字节
    let len = 0, shift = 0, o = 0, ok = false;
    const rawBytes = [];
    while (o < b.length) {
      const byte = b[o++]; rawBytes.push(byte.toString(16).padStart(2, '0'));
      len |= (byte & 0x7F) << shift;
      if (!(byte & 0x80)) { ok = true; break; }
      shift += 7;
      if (shift > 28) break;
    }
    if (!ok) break;
    if (o + len > b.length) { console.log(`[等待] 包长 ${len}（VarInt: ${rawBytes.join(' ')})，缓冲 ${b.length}B 不够`); break; }
    const payload = b.subarray(o, o + len);
    mcBuf = b.subarray(o + len);
    const id = payload[0];
    pktCount++;
    const tag = id === 0x21 ? ' <<< CHUNK' : '';
    console.log(`#${pktCount} id=0x${id.toString(16).padStart(2, '0')} len=${len} varInt=[${rawBytes.join(' ')}] head=${payload.subarray(0, Math.min(40, payload.length)).toString('hex')}${tag}`);
    if (id === 0x21) {
      chunkCount++;
      // 解析 0x21 头部验证
      let p = 1;
      const cx = payload.readInt32BE(p); p += 4;
      const cz = payload.readInt32BE(p); p += 4;
      const groundUp = payload[p]; p += 1;
      const mask = payload.readUInt16BE(p); p += 2;
      // dataSize varInt
      let size = 0, s2 = 0, raw2 = [];
      while (p < payload.length) { const by = payload[p++]; raw2.push(by.toString(16).padStart(2, '0')); size |= (by & 0x7F) << s2; if (!(by & 0x80)) break; s2++; }
      const expect = countSections(mask) * 12288 + (groundUp ? 256 : 0);
      console.log(`   CHUNK#${chunkCount}: cx=${cx} cz=${cz} groundUp=${groundUp} mask=0x${mask.toString(16)}(${countSections(mask)}段) size=${size} [${raw2.join(' ')}] 期望=${expect} 实际剩余=${payload.length - p} ${size === payload.length - p ? '✓匹配' : '✗不匹配'}`);
    }
    if (pktCount >= MAX_PKTS) { console.log(`已观察 ${MAX_PKTS} 个包，退出`); process.exit(0); }
  }
}
function countSections(mask) { let n = 0; for (let s = 0; s < 16; s++) if (mask & (1 << s)) n++; return n; }
sock.on('error', (e) => { console.log('tls 错误:', e.message); process.exit(1); });
setTimeout(() => { console.log('超时退出'); process.exit(0); }, 25000);
