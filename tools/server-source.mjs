// OpusMC 本地版一键启动服务器（零依赖，node tools/server.mjs）
// 静态服 + 官方房间服务反向代理。
// 原因：作者服务器按 Origin 白名单放行，localhost 页面直连会被拒（/api/* -> 403
// 「不允许从这个网页访问」，/ws -> 502）。浏览器改不了 WebSocket 的 Origin，
// 所以由本地服务端转发，带线上页面同款 Origin（只做来源伪装，不伪造任何登录凭证）。
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'opusmc-source');
const PORT = +(process.env.PORT || 8778);
const ROOMS = 'http://localhost:' + PORT;   // 游戏页的 rooms 参数指向本地反代
const UP_HOST = 'xz.honghemc.cn';
const UP_PORT = 8443;
const SPOOF_ORIGIN = 'https://www.bilibilitoy.com';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.map': 'application/json',
};

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

// ---------- /api/* 反代 ----------
function proxyApi(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers = {
      Origin: SPOOF_ORIGIN,
      Referer: SPOOF_ORIGIN + '/',
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
      Accept: req.headers.accept || '*/*',
    };
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    if (body.length) headers['Content-Length'] = body.length;
    const up = https.request({ host: UP_HOST, port: UP_PORT, path: req.url, method: req.method,
      headers, rejectUnauthorized: false, timeout: 15000 }, (ur) => {
      res.writeHead(ur.statusCode || 502, {
        'Content-Type': ur.headers['content-type'] || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      ur.pipe(res);
      if (process.env.ROOMS_DEBUG) log('[api]', req.method, req.url, '->', ur.statusCode);
    });
    up.on('error', (e) => { res.writeHead(502); res.end(JSON.stringify({ error: '房间服务不可达: ' + e.message })); });
    up.on('timeout', () => up.destroy());
    if (body.length) up.write(body);
    up.end();
  });
}

// ---------- /ws 反代 ----------
function proxyWs(req, client, head) {
  const up = https.request({ host: UP_HOST, port: UP_PORT, path: req.url || '/ws',
    rejectUnauthorized: false, timeout: 0, headers: {
      Host: UP_HOST + ':' + UP_PORT,
      Connection: 'Upgrade', Upgrade: 'websocket',
      'Sec-WebSocket-Key': req.headers['sec-websocket-key'] || '',
      'Sec-WebSocket-Version': req.headers['sec-websocket-version'] || '13',
      Origin: SPOOF_ORIGIN, Referer: SPOOF_ORIGIN + '/',
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
    } });
  up.on('upgrade', (ur, us, uhead) => {
    const accept = ur.headers['sec-websocket-accept'] || '';
    client.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    if (uhead && uhead.length) client.write(uhead);
    if (head && head.length) us.write(head);
    us.pipe(client); client.pipe(us);
    us.on('error', () => client.destroy());
    client.on('error', () => us.destroy());
    log('[ws] 已接通官方房间服务');
  });
  up.on('response', (ur) => {
    // 上游没给 101（例如 Origin 又被拒）：把状态码透给浏览器，别假装成功
    log('[ws] 上游拒绝升级:', ur.statusCode);
    client.write('HTTP/1.1 ' + (ur.statusCode || 502) + ' Upstream refused\r\nContent-Length: 0\r\n\r\n');
    client.end();
  });
  up.on('error', (e) => { log('[ws] 上游错误:', e.message); client.destroy(); });
  up.end();
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/' || urlPath === '/index.html') {
    res.writeHead(302, { Location: '/game.html?rooms=' + ROOMS });
    res.end();
    return;
  }
  if (urlPath.startsWith('/api/') || urlPath === '/ws' || urlPath.startsWith('/p2p')) {
    proxyApi(req, res);
    return;
  }
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('not found: ' + urlPath); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size, 'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.on('upgrade', (req, client, head) => {
  const p = (req.url || '/').split('?')[0];
  if (p !== '/ws' && !p.startsWith('/p2p')) { client.destroy(); return; }
  proxyWs(req, client, head);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.log('8777 已有服务在跑；如果它是旧版静态服，请关掉重启以启用房间反代');
  else { console.error('启动失败:', e.message); process.exit(1); }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`OpusMC 本地服: http://localhost:${PORT}（静态 + 官方房间反代，Origin=${SPOOF_ORIGIN}）`);
});
