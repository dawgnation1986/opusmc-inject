#!/usr/bin/env node
// verify-chunks.mjs — 内容级验证：PHPMC 原始区块 -> chunkToOpus 同款翻译 -> 按 net.js 规则逆解 -> 逐方块比对 + ASCII 剖面
import net from 'node:net';

const HOST = 'localhost', PORT = 25565, NAME = 'VerifyBot';
const RUN_MS = +(process.env.RUN_MS || 12000);

function writeVarInt(v) { v = v >>> 0; const o = []; do { let b = v & 0x7F; v >>>= 7; if (v !== 0) b |= 0x80; o.push(b); } while (v !== 0); return Buffer.from(o); }
function framePacket(id, body) { const p = Buffer.concat([writeVarInt(id), body || Buffer.alloc(0)]); return Buffer.concat([writeVarInt(p.length), p]); }

// ==== chunkToOpus 同款翻译（与 mc-proxy.mjs 保持一致）====
const WOOL = ['white','orange','magenta','light_blue','yellow','lime','pink','gray','light_gray','cyan','purple','blue','brown','green','red','black'];
const BLOCK_NAMES = (() => {
  const a = new Array(4096).fill('minecraft:air');
  const base = { 1:'stone',2:'grass_block',3:'dirt',4:'cobblestone',5:'oak_planks',7:'bedrock',8:'water',9:'water',10:'lava',11:'lava',12:'sand',13:'gravel',14:'gold_ore',15:'iron_ore',16:'coal_ore',17:'oak_log',18:'oak_leaves',20:'glass',24:'sandstone',35:'white_wool',41:'gold_block',42:'iron_block',45:'bricks',46:'tnt',47:'bookshelf',48:'mossy_cobblestone',49:'obsidian',50:'torch',53:'oak_stairs',54:'chest',56:'diamond_ore',57:'diamond_block',58:'crafting_table',61:'furnace',65:'ladder',66:'rail',67:'cobblestone_stairs',73:'redstone_ore',79:'ice',80:'snow_block',81:'cactus',82:'clay',85:'oak_fence',86:'pumpkin',87:'netherrack',88:'soul_sand',89:'glowstone',98:'stone_bricks',101:'iron_bars',102:'glass_pane',103:'melon',106:'vine',110:'mycelium',112:'nether_bricks',121:'end_stone',129:'emerald_ore',133:'emerald_block',152:'quartz_ore',155:'quartz_block',159:'white_stained_glass',161:'oak_leaves',162:'oak_log',165:'slime_block',168:'prismarine',169:'sea_lantern',170:'hay_block',172:'terracotta',173:'coal_block',174:'packed_ice',179:'red_sandstone',201:'purpur_block',206:'end_stone_bricks',55:'redstone_wire',59:'wheat',60:'farmland',71:'iron_door',64:'oak_door',74:'redstone_ore',75:'redstone_torch',76:'redstone_torch',78:'snow',83:'sugar_cane',84:'jukebox',90:'nether_portal',91:'jack_o_lantern',96:'oak_trapdoor',97:'infested_stone',99:'brown_mushroom_block',100:'red_mushroom_block',107:'oak_fence_gate',108:'brick_stairs',109:'stone_brick_stairs',111:'lily_pad',113:'nether_brick_fence',114:'nether_brick_stairs',115:'nether_wart',116:'enchanting_table',117:'brewing_stand',118:'cauldron',119:'end_portal',120:'end_portal_frame',122:'dragon_egg',123:'redstone_lamp',124:'redstone_lamp',126:'oak_slab',128:'sandstone_stairs',130:'ender_chest',131:'tripwire_hook',132:'tripwire',134:'spruce_stairs',135:'birch_stairs',136:'jungle_stairs',138:'beacon',139:'cobblestone_wall',140:'flower_pot',141:'carrots',142:'potatoes',143:'oak_button',145:'anvil',146:'trapped_chest',147:'light_weighted_pressure_plate',148:'heavy_weighted_pressure_plate',149:'comparator',151:'redstone_block',153:'hopper',154:'quartz_block',156:'activator_rail',157:'dropper',166:'barrier',167:'iron_trapdoor',175:'sunflower',176:'white_banner',177:'white_wall_banner',180:'red_sandstone_stairs',182:'red_sandstone_slab',183:'spruce_fence_gate',184:'birch_fence_gate',185:'jungle_fence_gate',186:'dark_oak_fence_gate',187:'acacia_fence_gate',188:'spruce_fence',189:'birch_fence',190:'jungle_fence',191:'dark_oak_fence',192:'acacia_fence',193:'spruce_door',194:'birch_door',195:'jungle_door',196:'acacia_door',197:'dark_oak_door',198:'end_rod',199:'chorus_plant',200:'chorus_flower',202:'purpur_pillar',203:'purpur_stairs',204:'purpur_slab',205:'purpur_slab',207:'beetroots',208:'dirt_path',209:'end_gateway',210:'repeating_command_block',211:'chain_command_block',212:'frosted_ice',213:'magenta_glazed_terracotta',214:'white_glazed_terracotta',215:'orange_glazed_terracotta',216:'yellow_glazed_terracotta',217:'lime_glazed_terracotta',218:'pink_glazed_terracotta',219:'gray_glazed_terracotta',220:'light_gray_glazed_terracotta',221:'cyan_glazed_terracotta',222:'purple_glazed_terracotta',223:'blue_glazed_terracotta',224:'brown_glazed_terracotta',225:'green_glazed_terracotta',226:'red_glazed_terracotta',227:'black_glazed_terracotta',26:'bed',30:'cobweb',31:'short_grass',32:'dead_bush',37:'dandelion',38:'poppy',39:'brown_mushroom',40:'red_mushroom',51:'fire',52:'spawner',63:'oak_sign',68:'oak_wall_sign',70:'stone_button',72:'stone_button',77:'oak_button',92:'cake',93:'repeater',94:'repeater',104:'pumpkin_stem',105:'melon_stem',125:'oak_slab',127:'cocoa',137:'command_block',144:'skeleton_skull',158:'powered_rail',27:'powered_rail',28:'detector_rail',178:'comparator' };
  for (const [id, name] of Object.entries(base)) a[(+id) << 4] = 'minecraft:' + name;
  for (let m = 0; m < 16; m++) {
    a[(35 << 4) | m] = 'minecraft:' + WOOL[m] + '_wool';
    a[(95 << 4) | m] = 'minecraft:' + WOOL[m] + '_stained_glass';
    a[(160 << 4) | m] = 'minecraft:' + WOOL[m] + '_stained_glass_pane';
    a[(171 << 4) | m] = 'minecraft:' + WOOL[m] + '_carpet';
    a[(159 << 4) | m] = 'minecraft:' + WOOL[m] + '_terracotta';
    a[(228 << 4) | m] = 'minecraft:' + WOOL[m] + '_concrete';
    a[(229 << 4) | m] = 'minecraft:' + WOOL[m] + '_concrete_powder';
    a[(230 << 4) | m] = 'minecraft:' + WOOL[m] + '_stained_glass';
    a[(231 << 4) | m] = 'minecraft:' + WOOL[m] + '_stained_glass_pane';
  }
  for (let m = 0; m < 6; m++) {
    a[(5 << 4) | m] = 'minecraft:' + ['oak','spruce','birch','jungle','acacia','dark_oak'][m] + '_planks';
    a[(17 << 4) | m] = 'minecraft:' + ['oak','spruce','birch','jungle','oak','oak'][m] + '_log';
  }
  return a;
})();

function chunkToOpus(cx, cz, mask, data) {
  const out = [Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0])];
  out[0].writeInt32LE(cx, 1); out[0].writeInt32LE(cz, 5);
  const sections = []; let p = 0;
  for (let s = 0; s < 16; s++) {
    if (!(mask & (1 << s))) continue;
    const palette = [0]; const palIdx = new Map(); const cells = new Uint8Array(4096);
    for (let j = 0; j < 4096; j++) {
      const v = data.readUInt16LE(p); p += 2;
      let ix = palIdx.get(v);
      if (ix === undefined) { ix = palette.length; palette.push(v); palIdx.set(v, ix); }
      cells[j] = ix;
    }
    const blockLight = data.subarray(p, p + 2048); p += 2048;
    const skyLight = data.subarray(p, p + 2048); p += 2048;
    sections.push({ palette, cells, blockLight, skyLight });
  }
  const biomes = data.subarray(p, p + 256);
  out[0][9] = sections.length;
  for (const sec of sections) {
    const len = Buffer.alloc(2); len.writeUInt16LE(sec.palette.length);
    const pal = Buffer.alloc(sec.palette.length * 2);
    for (let i = 0; i < sec.palette.length; i++) pal.writeUInt16LE(sec.palette[i], i * 2);
    if (sec.palette.length === 1) out.push(len, pal, Buffer.from([3]), Buffer.from(sec.skyLight), Buffer.from(sec.blockLight));
    else if (sec.palette.length <= 256) out.push(len, pal, Buffer.from(sec.cells), Buffer.from([3]), Buffer.from(sec.skyLight), Buffer.from(sec.blockLight));
    else { const wide = Buffer.alloc(8192); for (let j = 0; j < 4096; j++) wide.writeUInt16LE(sec.cells[j], j * 2); out.push(len, pal, wide, Buffer.from([3]), Buffer.from(sec.skyLight), Buffer.from(sec.blockLight)); }
  }
  out.push(biomes.length === 256 ? Buffer.from(biomes) : Buffer.alloc(256));
  return Buffer.concat(out);
}

// ==== 按 net.js onBinary 规则逆解 chunk type1 -> (id<<4|meta) 三维数组 ====
function decodeOpus(bin) {
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const u8 = bin;
  let p = 0;
  const type = dv.getUint8(p), cx = dv.getInt32(p + 1, true), cz = dv.getInt32(p + 5, true), n = dv.getUint8(p + 9); p += 10;
  const world = {}; // key: s<<12|j -> raw
  for (let s = 0; s < n; s++) {
    const len = dv.getUint16(p, true); p += 2;
    const pal = [];
    for (let i = 0; i < len; i++, p += 2) pal.push(dv.getUint16(p, true));
    let idx = null;
    if (len > 1) { if (len <= 256) { idx = u8.subarray(p, p + 4096); p += 4096; } else { idx = u8.subarray(p, p + 8192); p += 8192; } }
    const f = u8[p++];
    let sky = null, bl = null;
    if (f & 1) { sky = u8.subarray(p, p + 2048); p += 2048; }
    if (f & 2) { bl = u8.subarray(p, p + 2048); p += 2048; }
    for (let j = 0; j < 4096; j++) {
      const raw = pal[len > 1 ? (idx ? idx[j] : 0) : 0];
      world[(s << 12) | j] = raw;
    }
    void sky; void bl;
  }
  const biomes = u8.subarray(p, p + 256); p += 256;
  return { type, cx, cz, world, biomes, consumed: p, total: bin.length };
}

// PHPMC 原始 section 解包（对照基准）
function phpRaw(data, mask) {
  const world = {}; let p = 0;
  for (let s = 0; s < 16; s++) {
    if (!(mask & (1 << s))) continue;
    for (let j = 0; j < 4096; j++) { world[(s << 12) | j] = data.readUInt16LE(p); p += 2; }
    p += 4096; // meta nibble（1.8 1.9+ 布局是 blocks+meta；PHPMC 的 12288/段 = 8192 blocks + 2048 blockLight + 2048 skyLight —— 无独立 meta！）
    p += 0;
  }
  return world;
}

const sock = net.connect({ host: HOST, port: PORT }, () => {
  const hostB = Buffer.from(HOST, 'utf8');
  const hs = framePacket(0x00, Buffer.concat([writeVarInt(47), writeVarInt(hostB.length), hostB, (() => { const b = Buffer.alloc(2); b.writeUInt16BE(PORT); return b; })(), writeVarInt(2)]));
  sock.write(hs);
  sock.write(framePacket(0x00, Buffer.concat([writeVarInt(NAME.length), Buffer.from(NAME)])));
  console.log('[verify] 已登录');
});
let mcBuf = Buffer.alloc(0), nChunks = 0, mismatch = 0, compared = 0, printed = 0;
sock.on('data', (chunk) => {
  mcBuf = Buffer.concat([mcBuf, chunk]);
  for (;;) {
    const b = mcBuf;
    let len = 0, shift = 0, o = 0, ok = false;
    while (o < b.length) { const by = b[o++]; len |= (by & 0x7F) << shift; if (!(by & 0x80)) { ok = true; break; } shift += 7; if (shift > 28) break; }
    if (!ok || o + len > b.length) break;
    const payload = b.subarray(o, o + len);
    mcBuf = b.subarray(o + len);
    const id = payload[0];
    if (id !== 0x21) continue;
    let p = 1;
    const cx = payload.readInt32BE(p); p += 4;
    const cz = payload.readInt32BE(p); p += 4;
    const groundUp = payload[p]; p += 1;
    const mask = payload.readUInt16BE(p); p += 2;
    let size = 0, s2 = 0;
    while (p < payload.length) { const by = payload[p++]; size |= (by & 0x7F) << s2; if (!(by & 0x80)) break; s2 += 7; }
    const data = payload.subarray(p, p + size);
    if (size !== countSections(mask) * 12288 + (groundUp ? 256 : 0)) { console.log(`✗ 原始包内 data 大小不符: ${size}`); continue; }
    // 基准：PHPMC 原始方块（每段 8192B u16 blocks + 2048 blockLight + 2048 skyLight）
    const expect = {}; let q = 0;
    for (let s = 0; s < 16; s++) {
      if (!(mask & (1 << s))) continue;
      for (let j = 0; j < 4096; j++) { expect[(s << 12) | j] = data.readUInt16LE(q); q += 2; }
      q += 4096;
    }
    // 翻译 -> 逆解
    const bin = chunkToOpus(cx, cz, mask, data);
    const dec = decodeOpus(bin);
    if (dec.consumed !== bin.length) { console.log(`✗ 逆解没吃满: ${dec.consumed}/${bin.length}（格式错位！）`); mismatch++; }
    nChunks++; compared++;
    let bad = 0;
    for (const k in expect) if (expect[k] !== dec.world[k]) bad++;
    if (bad) { mismatch++; console.log(`✗ 区块 (${cx},${cz}) ${bad}/4096 方块不一致`); }
    // 打印第一个区块的 y=63 剖面（y=63 在 section 3）
    if (printed < 2 && !bad) {
      printed++;
      const s = 3, base = s << 12, rows = [];
      for (let z = 0; z < 16; z += 2) {
        let row = '';
        for (let x = 0; x < 16; x++) {
          const raw = expect[base | (x << 8) | (z << 4) | 8] & 0xFFF0 ? (expect[base | (x << 8) | (z << 4) | 8] >> 4) : 0;
          const names = { 0: '.', 1: '#', 2: '~', 3: '%', 8: 'w', 9: 'w', 12: ':', 17: '|', 18: '*', 79: 'i' };
          row += (names[raw] || '?');
        }
        rows.push(row);
      }
      console.log(`区块 (${cx},${cz}) y=63 剖面（.空气 #石 ~草 %土 w水 :沙）:\n` + rows.join('\n'));
    }
    if (nChunks >= 40) { finish(); return; }
  }
});
function countSections(mask) { let n = 0; for (let s = 0; s < 16; s++) if (mask & (1 << s)) n++; return n; }
function finish() {
  console.log(`======== 验证结果 ========`);
  console.log(`区块 ${nChunks} 个，逐方块比对 ${compared} 个，不一致 ${mismatch} 个`);
  console.log(mismatch === 0 && nChunks > 0 ? '✓✓✓ 翻译内容与 PHPMC 原始数据完全一致' : '✗ 有不一致，需要修');
  process.exit(0);
}
sock.on('error', (e) => { console.log('错误: ' + e.message); process.exit(1); });
setTimeout(() => finish(), RUN_MS);
