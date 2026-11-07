#!/usr/bin/env node
// smoke-interact.mjs — 交互回归测试（v2.2.0）
// 连一个独立的 mc-proxy 端口，发容器点击/关窗/放置/攻击/挥手，确认中转不会 exit。
// 用法：node tools/smoke-interact.mjs 8781
import net from 'node:net';

const PORT = +(process.argv[2] || 8781);
function wsEncode(op, data) {
  const len = data.length; let h;
  if (len < 126) h = Buffer.from([0x80 | op, 0x80 | len]);
  else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 0x80 | 126; h.writeUInt16BE(len, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 0x80 | 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(len, 6); }
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const d = Buffer.from(data);
  for (let i = 0; i < d.length; i++) d[i] ^= mask[i & 3];
  return Buffer.concat([h, mask, d]);
}
const send = (o) => { if (!sock.destroyed) sock.write(wsEncode(0x1, Buffer.from(JSON.stringify(o)))); };
const sock = net.connect({ host: 'localhost', port: PORT }, () => {
  sock.write(`GET / HTTP/1.1\r\nHost: localhost:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
});
let upgraded = false, buf = Buffer.alloc(0), bytes = 0;
sock.on('data', (chunk) => {
  bytes += chunk.length;
  if (!upgraded) {
    buf = Buffer.concat([buf, chunk]);
    const i = buf.indexOf('\r\n\r\n');
    if (i === -1) return;
    if (!/101/.test(buf.subarray(0, i).toString('utf8'))) { console.log('握手失败'); process.exit(1); }
    upgraded = true; buf = Buffer.alloc(0);
    console.log('[interact] ws 已连接，发 hello');
    send({ t: 'hello', name: 'InteractBot', version: 1, proto: 1, rd: 6 });
    const iv = setInterval(() => send({ t: 'tick', pos: [0.5, 70, 0.5, 0, 0, true, false], keys: {} }), 100);
    setTimeout(() => {
      const msgs = [
        { t: 'held', slot: 0 },
        { t: 'click', id: 1, slot: 0, button: 0, mode: 0, carried: null },
        { t: 'click', id: 1, slot: 1, button: 0, mode: 0, carried: { n: 'stone', c: 1, d: 0 } },
        { t: 'wclose', id: 1 },
        { t: 'place', item: 'grass_block', x: 0, y: 64, z: 0, face: 1, cx: 0.5, cy: 0.5, cz: 0.5 },
        { t: 'use', yaw: 0, pitch: 0 },
        { t: 'attack', id: 1 },
        { t: 'interact', id: 1, x: 0, y: 0.5, z: 0, sneak: false },
        { t: 'swing' },
        { t: 'drop', all: false },
        { t: 'button', id: 1, b: 0 },
      ];
      for (const m of msgs) send(m);
      console.log(`[interact] 已发 ${msgs.length} 条交互消息（点击/关窗/放置/攻击/交易按钮…）`);
    }, 1500);
    setTimeout(() => {
      clearInterval(iv);
      console.log(`[interact] 收到 ${bytes} 字节；连接仍存活 = ${!sock.destroyed}`);
      console.log(sock.destroyed ? '✗ 中转把连接断了' : '✓ 中转没崩（再看 proxy 日志有无异常）');
      sock.end(); process.exit(sock.destroyed ? 1 : 0);
    }, 4500);
  }
});
sock.on('error', (e) => { console.log('连接错误: ' + e.message); process.exit(1); });
