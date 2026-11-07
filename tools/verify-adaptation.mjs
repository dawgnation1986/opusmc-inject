#!/usr/bin/env node
// verify-adaptation.mjs — v2.0.0 内容级验证（基准独立，不共享被测代码的布局假设）
//
// 基准：从真实 .mca 存档按 PHPMC/src/World/Chunk.php::payload() 的源码逻辑重新构造 0x21 data。
// 被测：tools/chunk-format.mjs 的 chunkToOpus（mc-proxy 实际调用的那个）。
// 逆解：严格照 probe/js/net.js::onBinary 的读取规则，独立实现。
// 校验：逐方块 raw + 段索引 + 光照顺序 + 字节恰好消费完 + 名字表 + 坐标往返。
//
// 用法：node tools/verify-adaptation.mjs [存档目录]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';
import { VERSION, BLOCK_NAMES, BIOME_NAMES, CHEST_EXTRA_BASE, chunkToOpus, packPosBytes, unpackPos } from './chunk-format.mjs';

const ROOT = path.resolve(process.cwd());
const REGION_DIR = process.argv[2] || path.join(ROOT, 'PHPMC/world/region');
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  OK  ' : '  FAIL') + '  ' + msg); if (!cond) fail++; };

// ---------------- 独立基准：Anvil NBT -> PHPMC 0x21 data ----------------
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
      case 11: { const n = this.i32(), a = []; for (let i = 0; i < n; i++) a.push(this.i32()); return a; }
      case 12: { const n = this.i32(), a = []; for (let i = 0; i < n; i++) a.push(this.i64()); return a; }
      default: throw new Error('未知 NBT tag ' + t);
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
function nibble(s, i) { const b = s[i >> 1] || 0; return (i & 1) ? (b >> 4) & 15 : b & 15; }
function reference(level) {
  const secs = (level.Sections || [])
    .filter(s => s.Y >= 0 && s.Y <= 15 && s.Blocks && s.Blocks.length === 4096)
    .filter(s => { for (const v of s.Blocks) if (v !== 0) return true; return false; })
    .sort((a, b) => a.Y - b.Y);
  const mask = secs.reduce((m, s) => m | (1 << s.Y), 0);
  const rawBySec = new Map(), blBySec = new Map(), skyBySec = new Map();
  const blocksParts = [], blParts = [], skyParts = [];
  for (const s of secs) {
    const blocks = Buffer.alloc(8192), raw = [];
    const meta = s.Data || Buffer.alloc(2048);
    for (let i = 0; i < 4096; i++) {
      const id = s.Blocks[i], v = (id << 4) | nibble(meta, i);
      blocks.writeUInt16LE(v, i * 2); raw.push(v);
    }
    const bl = s.BlockLight && s.BlockLight.length === 2048 ? Buffer.from(s.BlockLight) : Buffer.alloc(2048);
    const sky = s.SkyLight && s.SkyLight.length === 2048 ? Buffer.from(s.SkyLight) : Buffer.alloc(2048);
    rawBySec.set(s.Y, raw); blBySec.set(s.Y, bl); skyBySec.set(s.Y, sky);
    blocksParts.push(blocks); blParts.push(bl); skyParts.push(sky);
  }
  const biomes = level.Biomes && level.Biomes.length === 256 ? Buffer.from(level.Biomes) : Buffer.alloc(256, 1);
  const data = Buffer.concat([...blocksParts, ...blParts, ...skyParts, biomes]);
  return { mask, data, secs, rawBySec, blBySec, skyBySec, biomes };
}

// ---------------- 独立逆解：严格照 net.js onBinary ----------------
function decodeOpus(bin) {
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  let p = 0;
  const type = dv.getUint8(p), cx = dv.getInt32(p + 1, true), cz = dv.getInt32(p + 5, true), n = dv.getUint8(p + 9); p += 10;
  const sections = [];
  for (let s = 0; s < n; s++) {
    const len = dv.getUint16(p, true); p += 2;
    const pal = [];
    for (let i = 0; i < len; i++, p += 2) pal.push(dv.getUint16(p, true));
    let idx = null;
    if (len > 1) {
      if (len <= 256) { idx = bin.subarray(p, p + 4096); p += 4096; }
      else { idx = new Uint16Array(4096); for (let j = 0; j < 4096; j++, p += 2) idx[j] = dv.getUint16(p, true); }
    }
    const f = bin[p++];
    let sky = null, bl = null;
    if (f & 1) { sky = bin.subarray(p, p + 2048); p += 2048; }
    if (f & 2) { bl = bin.subarray(p, p + 2048); p += 2048; }
    const raw = new Array(4096);
    for (let j = 0; j < 4096; j++) raw[j] = pal[len > 1 ? (idx ? idx[j] : 0) : 0];
    sections.push({ s, raw, sky, bl, len });
  }
  const biomes = bin.subarray(p, p + 256); p += 256;
  return { type, cx, cz, n, sections, biomes, consumed: p, total: bin.length };
}

console.log(`=== verify-adaptation v${VERSION}（${REGION_DIR}）===`);
const files = fs.readdirSync(REGION_DIR).filter(f => /^r\.\-?\d+\.\-?\d+\.mca$/.test(f));
let chunks = 0, cells = 0, badCells = 0, badSec = 0, badLight = 0, badBio = 0, badConsume = 0, badIdx = 0;
for (const f of files) {
  for (const level of readRegion(path.join(REGION_DIR, f))) {
    if (chunks >= 40) break;
    let ref; try { ref = reference(level); } catch (e) { continue; }
    if (!ref.secs.length) continue;
    const bin = chunkToOpus(0, 0, ref.mask, ref.data, true);
    const d = decodeOpus(bin);
    const maxSec = ref.secs[ref.secs.length - 1].Y;
    if (d.n !== maxSec + 1) badIdx++;
    if (d.consumed !== d.total) badConsume++;
    if (!d.biomes.equals(ref.biomes)) badBio++;
    for (let s = 0; s < d.n; s++) {
      const got = d.sections[s], expect = ref.rawBySec.get(s);
      if (!expect) { // 占位段：整段必须是空气
        if (got.raw.some(v => v !== 0)) badSec++;
        continue;
      }
      let bad = 0;
      for (let j = 0; j < 4096; j++) {
        cells++;
        const e = expect[j], g = got.raw[j], cid = e >> 4;
        const isChest = cid === 54 || cid === 146 || cid === 130;
        // 相邻箱子会被换成扩展下标（大箱子左右半边），基准独立地只放宽这一格
        const okCell = g === e || (isChest && g >= CHEST_EXTRA_BASE && g < CHEST_EXTRA_BASE + 8);
        if (!okCell) { bad++; badCells++; }
      }
      if (bad) badSec++;
      const eb = ref.blBySec.get(s), es = ref.skyBySec.get(s);
      if (!got.bl || !got.bl.equals(eb) || !got.sky || !got.sky.equals(es)) badLight++;
    }
    chunks++;
  }
  if (chunks >= 40) break;
}
console.log(`  样本 ${chunks} 区块 / ${cells} 方块`);
ok(chunks > 0, '读到了真实存档区块');
ok(badCells === 0, `逐方块 raw 一致（不一致 ${badCells}）`);
ok(badSec === 0, `每段一致（含占位段）（异常段 ${badSec}）`);
ok(badIdx === 0, `段数 = 最高 section + 1（异常 ${badIdx}）`);
ok(badLight === 0, `sky/block 光照顺序与内容一致（异常 ${badLight}）`);
ok(badBio === 0, `群系 256B 一致（异常 ${badBio}）`);
ok(badConsume === 0, `逆解恰好消费全部字节（异常 ${badConsume}）`);

// palette > 256 分支（真实存档不会触发，合成一份）
{
  const n = 1, data = Buffer.alloc(12288 + 256);
  const expect = [];
  for (let j = 0; j < 4096; j++) { const v = 1 + (j % 300); data.writeUInt16LE(v, j * 2); expect.push(v); }
  data.fill(0xAB, 8192, 10240); data.fill(0xCD, 10240, 12288);
  const bin = chunkToOpus(7, -3, 1, data, true);
  const d = decodeOpus(bin);
  let bad = 0; for (let j = 0; j < 4096; j++) if (d.sections[0].raw[j] !== expect[j]) bad++;
  ok(bad === 0 && d.consumed === d.total, `palette>256 用 u16 索引（不一致 ${bad}，len=${d.sections[0].len}）`);
}

// 名字表：客户端 BID 不带命名空间，必须全表无前缀且关键项映射成功
{
  const prefixed = BLOCK_NAMES.filter(n => n.startsWith('minecraft:')).length;
  ok(prefixed === 0, `states 4096 项全部无 minecraft: 前缀（残留 ${prefixed}）`);
  ok(BLOCK_NAMES.length === CHEST_EXTRA_BASE + 8 && BIOME_NAMES.length === 256, 'states 表长度（含大箱子扩展项）正确');
  const ctx = {
    console: { warn() { }, log() { }, error() { }, info() { } },
    MAX_BLOCKS: 4096, ASSETS: { tiles: new Proxy({}, { get: () => 0 }) },
    Math, JSON, Set, Map, Object, Array, String, Number, Uint8Array, Uint16Array, Uint32Array,
    STRUCT_DATA: null, WG_DATA: null,
  };
  ctx.self = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'probe/js/blocks.js'), 'utf8'), ctx);
  const t2 = fs.readFileSync(path.join(ROOT, 'probe/js/terrain2.js'), 'utf8');
  vm.runInContext(t2.slice(t2.indexOf('const STATE_ALIAS'), t2.indexOf('function structStateMap')), ctx);
  vm.runInContext('globalThis.WATER=-1;globalThis.LAVA=-1;globalThis.WIRE_ID=[];globalThis.Features={stateOf:()=>null};', ctx);
  // 必须加载客户端真实的 vanillaState：mapVanillaState 最后会遍历 meta 0..63 拿它打分，
  // stub 成空函数会让所有带 props 的状态都塌成 meta=0（假阴性）。
  const vsSrc = fs.readFileSync(path.join(ROOT, 'probe/js/vmodels.js'), 'utf8');
  const vsStart = vsSrc.indexOf('function vanillaState(');
  const vsEnd = vsSrc.indexOf('// ---- meshing', vsStart);
  vm.runInContext(vsSrc.slice(0, vsSrc.indexOf('function vanillaState(')) + vsSrc.slice(vsStart, vsEnd), ctx,
    { filename: 'vmodels.js#vanillaState' });
  let miss = 0, airish = 0;
  for (const raw of [1 << 4, 2 << 4, 3 << 4, 7 << 4, 8 << 4, 11 << 4, 12 << 4, 54 << 4, (31 << 4) | 1]) {
    const name = BLOCK_NAMES[raw];
    const r = vm.runInContext(`JSON.stringify(mapVanillaStateNear(${JSON.stringify(name)}))`, ctx);
    const v = JSON.parse(r);
    if (!v) miss++;
    else if (v[0] === 0 && raw !== 0) airish++;
  }
  ok(miss === 0, `抽查 9 个常见状态都能被客户端映射（失败 ${miss}）`);
  ok(airish === 0, `抽查状态没有被映射成空气（异常 ${airish}）`);
  const mapState = (raw) => JSON.parse(vm.runInContext(
    `JSON.stringify(mapVanillaStateNear(${JSON.stringify(BLOCK_NAMES[raw])}))`, ctx));
  // 同一方块的不同 meta 必须映射出不同的客户端 meta（朝向 / 生长阶段真的生效）
  const groups = {
    '梯子朝向': [(65 << 4) | 2, (65 << 4) | 3, (65 << 4) | 4, (65 << 4) | 5],
    '作物阶段': [(59 << 4) | 0, (59 << 4) | 3, (59 << 4) | 7],
    '台阶上下半': [(126 << 4) | 0, (126 << 4) | 1],
    '楼梯朝向': [(53 << 4) | 0, (53 << 4) | 1, (53 << 4) | 4],
    '箱子朝向': [(54 << 4) | 2, (54 << 4) | 3, (54 << 4) | 4, (54 << 4) | 5],
  };
  for (const [label, raws] of Object.entries(groups)) {
    const ms = raws.map((r) => { const v = mapState(r); return v ? v[1] : null; });
    ok(ms.every((m) => m !== null) && new Set(ms).size > 1, `${label} 的不同 meta 映射出不同状态 [${ms.join(',')}]`);
  }
  // 大箱子扩展下标 -> 客户端 meta bit4(left)/bit5(right)
  const l = mapState(CHEST_EXTRA_BASE), r = mapState(CHEST_EXTRA_BASE + 1);
  ok(!!l && !!r && (l[1] & 16) && (r[1] & 32),
    `大箱子 left/right 映射出 bit4/bit5（left=${l && l[1]} right=${r && r[1]}）`);
}

// 坐标往返：PHPMC 布局 x<<38|y<<26|z，含负坐标与 (-1,-1) 使用物品特例
{
  let bad = 0;
  for (const [x, y, z] of [[0, 0, 0], [100, 63, -200], [-35, 12, 47], [30000000, 255, -30000000], [-1, -1, -1]]) {
    const [ax, ay, az] = unpackPos(packPosBytes(x, y, z).readBigInt64BE(0));
    // y 是 12 位无符号，-1 会被解成 4095（PHPMC 只判 x/z，属预期）
    const ey = y < 0 ? y & 0xFFF : y;
    if (ax !== x || az !== z || ay !== ey) { bad++; console.log(`    坐标不符 ${x},${y},${z} -> ${ax},${ay},${az}`); }
  }
  ok(bad === 0, `packPos/unpackPos 往返（含 -1,-1,-1 特例，异常 ${bad}）`);
}

console.log(`\n======== ${fail === 0 ? '全部通过' : '有 ' + fail + ' 项失败'} ========`);
process.exit(fail === 0 ? 0 : 1);
