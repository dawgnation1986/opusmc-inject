#!/usr/bin/env node
// probe-rooms.mjs — 诊断官方房间连不上：分别测 HTTP API / TLS 证书 / WS 升级握手
// 只读探测，不发任何加入房间的请求，不改服务端状态。
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';

const HOST = 'xz.honghemc.cn', PORT = 8443;
const LOCAL_PORT = +(process.env.PORT || 8777);
const ORIGIN = 'http://localhost:8777';

function api(rejectUnauthorized) {
  return new Promise((resolve) => {
    const req = https.request({ host: HOST, port: PORT, path: '/api/public', method: 'GET',
      rejectUnauthorized, timeout: 8000, headers: { Origin: ORIGIN } }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => resolve(`HTTP ${res.statusCode} len=${d.length} body=${d.slice(0, 120)}`));
    });
    req.on('error', (e) => resolve(`ERR ${e.code || ''} ${e.message}`));
    req.on('timeout', () => { req.destroy(); resolve('TIMEOUT'); });
    req.end();
  });
}
function wsUpgrade(origin) {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = https.request({ host: HOST, port: PORT, path: '/ws', method: 'GET',
      rejectUnauthorized: false, timeout: 8000, headers: {
        Origin: origin, Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13',
      } }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => resolve(`HTTP ${res.statusCode} ${JSON.stringify(res.headers)} body=${d.slice(0, 200)}`));
    });
    req.on('upgrade', (res) => resolve(`UPGRADE 101 ${JSON.stringify(res.headers)}`));
    req.on('error', (e) => resolve(`ERR ${e.code || ''} ${e.message}`));
    req.on('timeout', () => { req.destroy(); resolve('TIMEOUT'); });
    req.end();
  });
}
function localApi() {
  return new Promise((resolve) => {
    const req = http.request({ host: 'localhost', port: LOCAL_PORT, path: '/api/public', method: 'GET', timeout: 10000 }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => resolve(`HTTP ${res.statusCode} len=${d.length} body=${d.slice(0, 100)}`));
    });
    req.on('error', (e) => resolve(`ERR ${e.code || ''} ${e.message}`));
    req.on('timeout', () => { req.destroy(); resolve('TIMEOUT'); });
    req.end();
  });
}
function localWs() {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({ host: 'localhost', port: LOCAL_PORT, path: '/ws', method: 'GET', timeout: 10000,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13', Origin: 'http://localhost:8777' } }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => resolve(`HTTP ${res.statusCode} ${JSON.stringify(res.headers)} body=${d.slice(0, 100)}`));
    });
    req.on('upgrade', (res, socket) => { resolve(`UPGRADE 101 ${JSON.stringify(res.headers)}`); socket.destroy(); });
    req.on('error', (e) => resolve(`ERR ${e.code || ''} ${e.message}`));
    req.on('timeout', () => { req.destroy(); resolve('TIMEOUT'); });
    req.end();
  });
}
function localStatic(p = '/api/public') {
  return new Promise((resolve) => {
    const req = http.request({ host: 'localhost', port: LOCAL_PORT, path: p, method: 'GET', timeout: 3000 }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => resolve(`HTTP ${res.statusCode} len=${d.length} body=${d.slice(0, 80)}`));
    });
    req.on('error', (e) => resolve(`ERR ${e.code || ''} ${e.message}`));
    req.on('timeout', () => { req.destroy(); resolve('TIMEOUT'); });
    req.end();
  });
}

console.log('=== 官方房间服务诊断 ===');
console.log('1) /api/public 严格校验证书 :', await api(true));
console.log('2) /api/public 忽略证书错误 :', await api(false));
console.log('3) /ws 升级（Origin=localhost）:', await wsUpgrade(ORIGIN));
console.log('4) /ws 升级（Origin=线上域名）  :', await wsUpgrade('https://www.bilibilitoy.com'));
console.log('5) 本地反代 /api/public     :', await localApi());
console.log('6) 本地反代 /ws 升级        :', await localWs());
console.log('7) 本地静态 /game.html      :', await localStatic('/game.html'));
