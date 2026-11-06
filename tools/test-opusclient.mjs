#!/usr/bin/env node
// test-opusclient.mjs — 模拟 OpusMC 客户端连 mc-proxy（8780），验证区块链路
// 文本帧(0x1)=JSON 消息；二进制帧(0x2)=OpusMC chunk type1
import net from 'node:net';

const PORT = +(process.argv[2] || 8780);
const RUN_MS = +(process.argv[3] || 15000);

function wsEncode(op, data) { // 客户端帧必须 mask（b1 的 bit7=0x80）
  const len = data.length; let h;
  if (len < 126) h = Buffer.from([0x80 | op, 0x80 | len]);
  else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 0x80 | 126; h.writeUInt16BE(len, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 0x80 | 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(len, 6); }
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const d = Buffer.from(data);
  for (let i = 0; i < d.length; i++) d[i] ^= mask[i & 3];
  return Buffer.concat([h, mask, d]);
}
function wsDecode(bufRef) {
  let payload = Buffer.alloc(0), closed = false;
  for (;;) {
    const b = bufRef.buf, len = b.length;
    if (len < 2) break;
    const op = b[0] & 0x0F; let plen = b[1] & 0x7F, off = 2;
    if (plen === 126) { if (len < 4) break; plen = b.readUInt16BE(2); off = 4; }
    else if (plen === 127) { if (len < 10) break; plen = b.readUInt32BE(6); off = 10; }
    if (len < off + plen) break;
    const d = Buffer.from(b.subarray(off, off + plen)); // 服务端帧不 mask
    bufRef.buf = b.subarray(off + plen);
    if (op === 0x8) { closed = true; break; }
    if (op === 0x9) { bufRef.pong = wsEncode(0xA, d); continue; }
    payload = Buffer.concat([payload, d]);
  }
  return { payload, closed };
}

const stats = { login: 0, states: 0, biomes: 0, chunks: 0, chunkBytes: 0, chat: 0, other: {} };
let mcBuf = Buffer.alloc(0);

function handleJson(d) {
  try {
    const m = JSON.parse(d.toString('utf8'));
    if (m.t === 'login') { stats.login++; console.log(`[client] login: eid=${m.eid} mode=${m.mode}`); }
    else if (m.t === 'states') { stats.states++; console.log(`[client] states: ${m.list.length} 项方块状态`); }
    else if (m.t === 'biomes') { stats.biomes++; console.log(`[client] biomes: ${m.list.length} 项`); }
    else if (m.t === 'chat') { stats.chat++; if (stats.chat <= 3) console.log('[client] chat: ' + String(m.text || '').slice(0, 40)); }
    else {
      stats.other[m.t] = (stats.other[m.t] || 0) + 1;
      if (process.env.DBG && stats.other[m.t] === 1) console.log(`[client] 首次收到 t=${m.t} len=${d.length}`);
    }
  } catch (e) { console.log('[client] JSON 解析失败: ' + e.message.slice(0, 60)); }
}
function handleBin(d) {
  if (d.length > 10 && d[0] === 1) {
    stats.chunks++; stats.chunkBytes += d.length;
    const cx = d.readInt32LE(1), cz = d.readInt32LE(5), n = d[9];
    if (stats.chunks <= 3) console.log(`[client] 区块 (${cx},${cz}) 段数=${n} 总长=${d.length}`);
  }
}

const sock = net.connect({ host: 'localhost', port: PORT }, () => {
  sock.write(`GET / HTTP/1.1\r\nHost: localhost:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
});
let upgraded = false, buf = Buffer.alloc(0);
sock.on('data', (chunk) => {
  if (!upgraded) {
    buf = Buffer.concat([buf, chunk]);
    const i = buf.indexOf('\r\n\r\n');
    if (i === -1) return;
    if (!/101/.test(buf.subarray(0, i).toString('utf8'))) { console.log('握手失败'); process.exit(1); }
    upgraded = true;
    console.log('[client] ws 已连接');
    const rest = buf.subarray(i + 4); buf = Buffer.alloc(0);
    sock.write(wsEncode(0x1, Buffer.from(JSON.stringify({ t: 'hello', name: 'TestBot', version: 1, proto: 1, rd: 6 }))));
    let xy = 70;
    const iv = setInterval(() => {
      if (sock.destroyed) return;
      xy += 0.01;
      sock.write(wsEncode(0x1, Buffer.from(JSON.stringify({ t: 'tick', pos: [0.5, xy, 0.5, 0, 0, true, false], keys: {} }))));
    }, 100);
    setTimeout(() => { clearInterval(iv); finish(); }, RUN_MS);
    if (rest.length) feed(rest);
    return;
  }
  feed(chunk);
});
function feed(chunk) {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const b = buf, len = b.length;
    if (len < 2) break;
    const op = b[0] & 0x0F; let plen = b[1] & 0x7F, off = 2;
    if (plen === 126) { if (len < 4) break; plen = b.readUInt16BE(2); off = 4; }
    else if (plen === 127) { if (len < 10) break; plen = b.readUInt32BE(6); off = 10; }
    if (len < off + plen) break;
    const d = Buffer.from(b.subarray(off, off + plen));
    buf = b.subarray(off + plen);
    if (op === 0x8) { console.log('[client] 服务端关闭'); finish(); return; }
    if (op === 0x9) { sock.write(wsEncode(0xA, d)); continue; }
    if (op === 0x1) handleJson(d);
    else if (op === 0x2) handleBin(d);
  }
}
function finish() {
  console.log('======== 模拟客户端统计 ========');
  console.log(JSON.stringify(stats));
  console.log(`区块: ${stats.chunks} 个 / ${stats.chunkBytes}B`);
  process.exit(0);
}
sock.on('error', (e) => { console.log('连接错误: ' + e.message); process.exit(1); });
setTimeout(() => finish(), RUN_MS + 3000);
