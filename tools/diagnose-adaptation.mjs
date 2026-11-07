#!/usr/bin/env node
// diagnose-adaptation.mjs — 离线诊断（不启动 PHPMC，不改任何服务）
//
// 目的：回答两个问题
//   A) PHPMC 的 0x21 data 究竟是「按段交错」还是「分组」？当前 mc-proxy 的读法会错多少？
//      —— 直接从真实 .mca 存档按 Chunk::payload() 的源码逻辑重建 data，两种读法逐方块对比。
//   B) 客户端 mapVanillaStateNear 能识别 'minecraft:stone' 这种带命名空间的名字吗？
//      —— 用 vm 加载 probe/js/blocks.js 与 terrain2.js 的真实函数定义，直接调用。
//
// 用法：node tools/diagnose-adaptation.mjs [存档目录]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';

const ROOT = path.resolve(process.cwd());
const REGION_DIR = process.argv[2] || path.join(ROOT, 'PHPMC/world/region');

// ---------------- 最小 NBT 读（Anvil / Java 大端） ----------------
class Nbt {
  constructor(buf) { this.b = buf; this.o = 0; }
  u8() { return this.b[this.o++]; }
  i8() { const v = this.b[this.o++]; return v > 127 ? v - 256 : v; }
  u16() { const v = this.b.readUInt16BE(this.o); this.o += 2; return v; }
  i16() { const v = this.b.readInt16BE(this.o); this.o += 2; return v; }
  i32() { const v = this.b.readInt32BE(this.o); this.o += 4; return v; }
  i64() { const v = this.b.readBigInt64BE(this.o); this.o += 8; return v; }
  f32() { const v = this.b.readFloatBE(this.o); this.o += 4; return v; }
  f64() { const v = this.b.readDoubleBE(this.o); this.o += 8; return v; }
  str() { const n = this.u16(); const s = this.b.subarray(this.o, this.o + n).toString('utf8'); this.o += n; return s; }
  payload(t) {
    switch (t) {
      case 1: return this.i8();
      case 2: return this.i16();
      case 3: return this.i32();
      case 4: return this.i64();
      case 5: return this.f32();
      case 6: return this.f64();
      case 7: { const n = this.i32(); const s = Buffer.from(this.b.subarray(this.o, this.o + n)); this.o += n; return s; }
      case 8: return this.str();
      case 9: { const it = this.u8(), n = this.i32(), a = []; for (let i = 0; i < n; i++) a.push(this.payload(it)); return a; }
      case 10: { const o = {}; for (;;) { const tt = this.u8(); if (tt === 0) break; o[this.str()] = this.payload(tt); } return o; }
      case 11: { const n = this.i32(), a = []; for (let i = 0; i < n; i++) a.push(this.i32()); this.o += 0; return a; }
      case 12: { const n = this.i32(), a = []; for (let i = 0; i < n; i++) a.push(this.i64()); return a; }
      default: throw new Error('未知 NBT tag ' + t + ' @' + this.o);
    }
  }
  root() { const t = this.u8(); this.str(); return this.payload(t); }
}

function readRegion(file) {
  const b = fs.readFileSync(file), out = [];
  for (let i = 0; i < 1024; i++) {
    const off = (b[i * 4] << 16) | (b[i * 4 + 1] << 8) | b[i * 4 + 2];
    if (!off || !b[i * 4 + 3]) continue;
    const p = off * 4096;
    if (p + 5 > b.length) continue;
    const len = b.readUInt32BE(p), comp = b[p + 4];
    if (len < 1 || p + 4 + len > b.length) continue;
    let raw = b.subarray(p + 5, p + 4 + len);
    try {
      if (comp === 1) raw = zlib.gunzipSync(raw);
      else if (comp === 2) raw = zlib.inflateSync(raw);
      const root = new Nbt(raw).root();
      if (root && root.Level) out.push(root.Level);
    } catch (e) { /* 坏 chunk 跳过 */ }
  }
  return out;
}

// ---------------- 按 PHPMC Chunk::payload() 的源码重建 data ----------------
function nibble(s, i) { const b = s[i >> 1] || 0; return (i & 1) ? (b >> 4) & 15 : b & 15; }
function blocksBytes(sec) {
  const out = Buffer.alloc(8192);
  const ids = sec.Blocks, meta = sec.Data || Buffer.alloc(2048), add = sec.Add;
  for (let i = 0; i < 4096; i++) {
    let id = ids[i];
    if (add) id |= nibble(add, i) << 8;
    out.writeUInt16LE((id << 4) | nibble(meta, i), i * 2);
  }
  return out;
}
function phpPayload(level) {
  const secs = (level.Sections || [])
    .filter(s => s.Y >= 0 && s.Y <= 15 && s.Blocks && s.Blocks.length === 4096)
    .filter(s => { for (const v of s.Blocks) if (v !== 0) return true; return false; }); // 全空气段不进 mask
  secs.sort((a, b) => a.Y - b.Y);
  const mask = secs.reduce((m, s) => m | (1 << s.Y), 0);
  const blocks = Buffer.concat(secs.map(blocksBytes));
  const bl = Buffer.concat(secs.map(s => s.BlockLight && s.BlockLight.length === 2048 ? Buffer.from(s.BlockLight) : Buffer.alloc(2048)));
  const sky = Buffer.concat(secs.map(s => s.SkyLight && s.SkyLight.length === 2048 ? Buffer.from(s.SkyLight) : Buffer.alloc(2048)));
  const bio = level.Biomes && level.Biomes.length === 256 ? Buffer.from(level.Biomes) : Buffer.alloc(256, 1);
  return { mask, data: Buffer.concat([blocks, bl, sky, bio]), secs };
}

// ---------------- 两种读法 ----------------
// 分组（PHP 真实布局）：所有段的 blocks 连在一起，然后所有 blockLight，然后所有 skyLight
function readGrouped(n, data) {
  const out = []; let p = 0;
  for (let k = 0; k < n; k++) for (let j = 0; j < 4096; j++) { out.push(data.readUInt16LE(p)); p += 2; }
  return out;
}
// 交错（当前 mc-proxy 的 chunkToOpus）：每段 8192 blocks + 2048 blockLight + 2048 skyLight
function readInterleaved(n, data) {
  const out = []; let p = 0;
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < 4096; j++) { out.push(data.readUInt16LE(p)); p += 2; }
    p += 4096;
  }
  return out;
}

console.log('=== A. 区块布局实测（真实 .mca 存档）===');
const files = fs.readdirSync(REGION_DIR).filter(f => /^r\.\-?\d+\.\-?\d+\.mca$/.test(f));
let chunks = 0, totalCells = 0, diffCells = 0, airGrouped = 0, airInterleaved = 0, overflow = 0;
const examples = [];
for (const f of files) {
  const levels = readRegion(path.join(REGION_DIR, f));
  for (const level of levels) {
    if (chunks >= 40) break;
    let pl;
    try { pl = phpPayload(level); } catch (e) { continue; }
    const n = pl.secs.length;
    if (!n) continue;
    const expectLen = 256 + 12288 * n;
    if (pl.data.length !== expectLen) { console.log(`  ! ${f} 负载长度 ${pl.data.length} != ${expectLen}`); continue; }
    const g = readGrouped(n, pl.data), it = readInterleaved(n, pl.data);
    for (let i = 0; i < g.length; i++) {
      totalCells++;
      if (g[i] !== it[i]) diffCells++;
      if (g[i] === 0) airGrouped++;
      if (it[i] === 0) airInterleaved++;
      if (it[i] > 4095) overflow++;  // states 表只有 4096 项 -> 越界即 undefined -> 空气
    }
    if (examples.length < 3) {
      const secBreak = [];
      for (let s = 0; s < n; s++) {
        let bad = 0, zero = 0;
        for (let j = 0; j < 4096; j++) { if (g[s * 4096 + j] !== it[s * 4096 + j]) bad++; if (it[s * 4096 + j] === 0) zero++; }
        secBreak.push(`段${s}(y=${pl.secs[s].Y * 16}..${pl.secs[s].Y * 16 + 15}):错${(bad / 40.96).toFixed(1)}% 空${(zero / 40.96).toFixed(1)}%`);
      }
      examples.push(`  ${f} mask=0x${pl.mask.toString(16)} ${n}段 | ${secBreak.join(' | ')}`);
    }
    chunks++;
  }
  if (chunks >= 40) break;
}
console.log(`  样本：${chunks} 个区块，${totalCells} 个方块`);
console.log(`  交错读法与真实方块不一致：${diffCells} (${(diffCells / totalCells * 100).toFixed(2)}%)`);
console.log(`  真实空气比例 ${(airGrouped / totalCells * 100).toFixed(2)}%  ->  交错读法空气比例 ${(airInterleaved / totalCells * 100).toFixed(2)}%`);
console.log(`  交错读法出现越界 raw(>4095)：${overflow} 个（客户端 states 下标溢出 -> 空气）`);
for (const e of examples) console.log(e);
console.log(`  结论：${diffCells === 0 ? '两种布局等价（当前 proxy 没问题）' : '当前 proxy 的交错读法是错的，必须按分组布局解析'}`);

// ---------------- B. states 名字格式实测 ----------------
console.log('\n=== B. 客户端 states 名字格式实测 ===');
try {
  const ctx = {
    console: { warn() { }, log() { }, error() { }, info() { } },
    MAX_BLOCKS: 4096,
    ASSETS: { tiles: new Proxy({}, { get: () => 0 }) },
    Math, JSON, Set, Map, Object, Array, String, Number, Uint8Array, Uint16Array, Uint32Array,
    self: null, window: null, STRUCT_DATA: null, WG_DATA: null,
  };
  ctx.self = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'probe/js/blocks.js'), 'utf8'), ctx, { filename: 'blocks.js' });
  const t2 = fs.readFileSync(path.join(ROOT, 'probe/js/terrain2.js'), 'utf8');
  const snippet = t2.slice(t2.indexOf('const STATE_ALIAS'), t2.indexOf('function structStateMap'));
  // 只补「blocks.js 里没有」的全局，不声明变量（避免与 const 重复声明冲突）
  vm.runInContext('globalThis.WATER=-1;globalThis.LAVA=-1;globalThis.WIRE_ID=[];globalThis.Features={stateOf:()=>null};globalThis.vanillaState=()=>({key:"",p:{}});', ctx);
  vm.runInContext(snippet, ctx, { filename: 'terrain2.js#states' });
  const bidPrefixed = vm.runInContext("Object.keys(BID).filter(k=>k.startsWith('minecraft:')).length", ctx);
  console.log(`  BID 里带 minecraft: 前缀的键：${bidPrefixed} 个`);
  for (const name of ['minecraft:stone', 'stone', 'minecraft:grass_block', 'grass_block', 'minecraft:air', 'air', 'minecraft:water', 'water']) {
    const r = vm.runInContext(`JSON.stringify(mapVanillaStateNear(${JSON.stringify(name)}))`, ctx);
    console.log(`  mapVanillaStateNear('${name}') -> ${r}`);
  }
} catch (e) {
  console.log('  vm 加载失败（不影响 A 的结论）：' + e.message);
}

// ---------------- C. 段索引与 meta 变体覆盖 ----------------
console.log('\n=== C. 段索引 / meta 变体（决定修复范围）===');
{
  let hollow = 0, total = 0, metaNZ = 0, cells = 0;
  const rawHist = new Map();
  const files2 = fs.readdirSync(REGION_DIR).filter(f => /^r\.\-?\d+\.\-?\d+\.mca$/.test(f));
  for (const f of files2) {
    for (const level of readRegion(path.join(REGION_DIR, f))) {
      if (total >= 40) break;
      let pl; try { pl = phpPayload(level); } catch (e) { continue; }
      const n = pl.secs.length; if (!n) continue;
      total++;
      if (pl.mask !== (1 << n) - 1) hollow++;
      const g = readGrouped(n, pl.data);
      for (const v of g) {
        cells++;
        if (v & 15) metaNZ++;
        rawHist.set(v, (rawHist.get(v) || 0) + 1);
      }
    }
    if (total >= 40) break;
  }
  console.log(`  mask 非连续低位（段索引会错位）的区块：${hollow}/${total}`);
  console.log(`  meta != 0 的方块：${metaNZ}/${cells} (${(metaNZ / cells * 100).toFixed(2)}%)`);
  const top = [...rawHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16)
    .map(([v, c]) => `${v >> 4}:${v & 15}=${c}`).join('  ');
  console.log(`  出现最多的 raw（id:meta）：${top}`);
  console.log('  注：BLOCK_NAMES 目前只填 (id<<4)|0，其余 15 个 meta 全是 minecraft:air');
}
