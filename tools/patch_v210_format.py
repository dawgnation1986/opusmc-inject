# -*- coding: utf-8 -*-
# patch_v210_format.py — chunk-format.mjs v2.1.0：按 1.8 meta 生成 vanilla state props + 大箱子合并
import os
os.chdir(r"D:\discuz\webmc\hook\opusmc-inject")
p = 'tools/chunk-format.mjs'
t = open(p, newline='', encoding='utf-8').read()
EOL = "\r\n" if "\r\n" in t else "\n"

def rep(old, new, n=1):
    global t
    o = old.replace("\n", EOL); nn = new.replace("\n", EOL)
    c = t.count(o)
    assert c == n, 'old 命中 %d 次（应 %d）: %r...' % (c, n, old[:80])
    t = t.replace(o, nn)

rep("""export const VERSION = '2.0.0';""", """export const VERSION = '2.1.0';
// 大箱子合并用：客户端 chestType(m) 读 meta bit4(left)/bit5(right)，
// 而 1.8 的箱子 meta 只有朝向、没有半边信息，所以 proxy 自己算邻接，
// 把这两半映射到 states 表的扩展下标（>4095，客户端 stateMap 支持）。
export const CHEST_EXTRA_BASE = 4096;
export const CHEST_FACES = ['north', 'south', 'west', 'east'];
const FACE_18 = { 2: 'north', 3: 'south', 4: 'west', 5: 'east' };
const FACE4 = ['east', 'west', 'south', 'north']; // 客户端 FACING4（meta&3）
const SLAB_TYPE = ['bottom', 'top', 'double', 'double'];
const TRAP_FACE = ['north', 'south', 'west', 'east'];

// 1.8 meta -> vanilla 状态字符串（带 props）。客户端 mapVanillaState 会遍历自己的 meta
// 找 vanillaState(b, m) 与这些 props 最匹配的一个，从而还原朝向/生长阶段/半边。
// 返回不带 minecraft: 前缀的名字。
function propsFor(id, m, base) {
  const b = base.replace(/^minecraft:/, '');
  const withProps = (name, kv) => `${name || b}[${kv.join(',')}]`;
  if (id === 65) return FACE_18[m] ? withProps('ladder', [`facing=${FACE_18[m]}`]) : b;
  if (id === 54 || id === 146) return FACE_18[m] ? withProps('chest', [`facing=${FACE_18[m]}`]) : b;
  if (id === 130) return 'ender_chest';
  if (id === 59) return withProps('wheat', [`age=${m & 7}`]);
  if (id === 141) return withProps('carrots', [`age=${m & 7}`]);
  if (id === 142) return withProps('potatoes', [`age=${m & 7}`]);
  if (id === 115) return withProps('nether_wart', [`age=${Math.min(3, m & 3)}`]);
  if (id === 104) return withProps('melon_stem', [`age=${m & 7}`]);
  if (id === 105) return withProps('pumpkin_stem', [`age=${m & 7}`]);
  if (id === 60) return withProps('farmland', [`moisture=${m ? 7 : 0}`]);
  if (id === 78) return withProps('snow', [`layers=${(m & 7) + 1}`]);
  if (id === 120) return withProps('end_portal_frame', [`eye=${(m & 4) ? 'true' : 'false'}`, 'facing=south']);
  if (id === 90) return withProps('nether_portal', [`axis=${(m & 1) ? 'z' : 'x'}`]);
  if (id === 26) return withProps('bed', [`facing=${['north', 'east', 'south', 'west'][m & 3]}`, `part=${(m & 4) ? 'head' : 'foot'}`]);
  if (id === 17 || id === 162) return withProps('', [`axis=${['y', 'x', 'z', 'y'][m & 3]}`]);
  if ([53, 67, 108, 109, 114, 128, 134, 135, 136, 180, 203].includes(id))
    return withProps('', [`facing=${FACE4[m & 3]}`, `half=${(m & 4) ? 'top' : 'bottom'}`]);
  if ([44, 43, 126, 182, 204, 205].includes(id))
    return withProps('', [`type=${SLAB_TYPE[m & 3]}`]);
  if ([64, 71, 193, 194, 195, 196, 197].includes(id))
    return withProps('', [`facing=${FACE4[m & 3]}`, `half=${(m & 8) ? 'upper' : 'lower'}`, `open=${!!(m & 4)}`, `hinge=${(m & 16) ? 'right' : 'left'}`]);
  if ([96, 167].includes(id))
    return withProps('', [`facing=${TRAP_FACE[m & 3]}`, `half=${(m & 8) ? 'top' : 'bottom'}`, `open=${!!(m & 4)}`]);
  return b;
}
const META_IDS = new Set([65, 54, 146, 130, 59, 141, 142, 115, 104, 105, 60, 78, 120, 90, 26, 17, 162,
  53, 67, 108, 109, 114, 128, 134, 135, 136, 180, 203, 44, 43, 126, 182, 204, 205,
  64, 71, 193, 194, 195, 196, 197, 96, 167]);

// 段内邻接检测：把相邻的两个箱子改成 left/right 扩展下标，客户端才会画成一个大箱子。
function markDoubleChests(raws) {
  const isChest = (v) => { const id = v >> 4; return id === 54 || id === 146 || id === 130; };
  for (let j = 0; j < 4096; j++) {
    const v = raws[j];
    if (!isChest(v)) continue;
    const id = v >> 4, face = FACE_18[v & 15] || 'north';
    const fi = CHEST_FACES.indexOf(face), x = j & 15, z = (j >> 4) & 15;
    let nb = -1;
    if (face === 'north' || face === 'south') {
      if (x < 15 && isChest(raws[j + 1]) && (raws[j + 1] >> 4) === id) nb = j + 1;
    } else if (z < 15 && isChest(raws[j + 16]) && (raws[j + 16] >> 4) === id) nb = j + 16;
    if (nb < 0) continue;
    // 客户端 chestSeam：north/east 时小坐标半边的缝朝正方向 -> 小的是 left
    const smallIsLeft = face === 'north' || face === 'east';
    raws[j] = CHEST_EXTRA_BASE + fi * 2 + (smallIsLeft ? 0 : 1);      // left
    raws[nb] = CHEST_EXTRA_BASE + fi * 2 + (smallIsLeft ? 1 : 0);      // right
  }
}""")

rep("""  // 兜底：同一 id 未登记的 meta 变体沿用基名，别让流动的水/朝向不同的火把变空气
  for (let id = 1; id < 256; id++) {
    const b = a[id << 4];
    if (b === 'minecraft:air') continue;
    for (let m = 1; m < 16; m++) if (a[(id << 4) | m] === 'minecraft:air') a[(id << 4) | m] = b;
  }
  // 关键：客户端 BID 的键不带命名空间（anvil.js 也是先 strip 再传 mapVanillaStateNear）
  return a.map((s) => s.replace(/^minecraft:/, ''));
})();""",
"""  // 兜底：同一 id 未登记的 meta 变体沿用基名，别让流动的水/朝向不同的火把变空气
  for (let id = 1; id < 256; id++) {
    const b = a[id << 4];
    if (b === 'minecraft:air') continue;
    for (let m = 1; m < 16; m++) if (a[(id << 4) | m] === 'minecraft:air') a[(id << 4) | m] = b;
  }
  // 按 1.8 meta 补 props（梯子朝向 / 作物阶段 / 台阶上下半 / 门开合 / 箱子朝向…）
  for (const id of META_IDS) {
    for (let m = 0; m < 16; m++) {
      const slot = (id << 4) | m;
      if (a[slot] === 'minecraft:air') continue;
      a[slot] = 'minecraft:' + propsFor(id, m, a[slot]);
    }
  }
  // 关键：客户端 BID 的键不带命名空间（anvil.js 也是先 strip 再传 mapVanillaStateNear）
  const clean = a.map((s) => s.replace(/^minecraft:/, ''));
  // 扩展下标 4096..4103 = 大箱子的左右半边（每个朝向两个）
  for (const face of CHEST_FACES) {
    clean.push(`chest[facing=${face},type=left]`);
    clean.push(`chest[facing=${face},type=right]`);
  }
  return clean;
})();""")

rep("""  const packed = new Map(); // section index -> {palette, cells, sky, bl}
  for (let k = 0; k < n; k++) {
    const palette = [0], palIdx = new Map(), cells = new Uint16Array(4096);
    const base = k * 8192;
    for (let j = 0; j < 4096; j++) {
      const v = data.readUInt16LE(base + j * 2);
      let ix = palIdx.get(v);
      if (ix === undefined) { ix = palette.length; palette.push(v); palIdx.set(v, ix); }
      cells[j] = ix;
    }""",
"""  const packed = new Map(); // section index -> {palette, cells, sky, bl}
  for (let k = 0; k < n; k++) {
    const base = k * 8192;
    const raws = new Uint16Array(4096);
    for (let j = 0; j < 4096; j++) raws[j] = data.readUInt16LE(base + j * 2);
    markDoubleChests(raws); // 相邻箱子 -> 扩展下标
    const palette = [0], palIdx = new Map(), cells = new Uint16Array(4096);
    for (let j = 0; j < 4096; j++) {
      const v = raws[j];
      let ix = palIdx.get(v);
      if (ix === undefined) { ix = palette.length; palette.push(v); palIdx.set(v, ix); }
      cells[j] = ix;
    }""")

open(p, 'w', newline='', encoding='utf-8').write(t)
print('chunk-format.mjs -> v2.1.0 完成，单次落盘')
