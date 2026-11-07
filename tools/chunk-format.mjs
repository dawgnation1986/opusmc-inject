#!/usr/bin/env node
// ============================================================================
// chunk-format.mjs — OpusMC chunk type1 打包器 + 1.8 名字表（v2.0.0）
//
// 抽出来的原因：mc-proxy 原先把「翻译」和「验证基准」写在同一套假设里，
// 于是 verify-chunks.mjs 的「零差异」是自证循环。这个模块只做打包，
// 验证脚本 tools/verify-adaptation.mjs 会用完全独立的基准逆解它。
//
// 三处权威（都实测过，别再按标准 1.8 想当然）：
//  1) PHPMC/src/World/Chunk.php::payload()   —— 分组布局：
//     [所有段 blocks (8192/段)] [所有段 blockLight (2048/段)]
//     [所有段 skyLight (2048/段)] [biomes 256]，不是「每段 blocks+光」交错。
//  2) probe/js/terrain2.js::mapVanillaStateNear —— states 名字不带 minecraft: 前缀，
//     BID 的键是 'stone' / 'grass_block'；带前缀会返回 null（空气）或被 nearNames
//     兜底成别的方块（minecraft:grass_block -> 石头）。
//  3) PHPMC/src/Server.php::packPositionBytes/unpackPosition —— 坐标是
//     x<<38 | y<<26 | z（y 在 bits 26..37、z 在 bits 0..25），与标准 1.8
//     的 x<<38 | z<<12 | y 相反。
// 另外 probe/js/net.js::onBinary 把第 i 个收到的段直接当作 section i，
// 不带段索引，所以必须按 mask 的 bit 位置补齐占位段。
// ============================================================================
export const VERSION = '2.2.1';
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
}

// ---------------- PHPMC 坐标打包 ----------------
export function packPosBytes(x, y, z) {
  const v = ((BigInt(x | 0) & 0x3FFFFFFn) << 38n)
    | ((BigInt(y | 0) & 0xFFFn) << 26n)
    | (BigInt(z | 0) & 0x3FFFFFFn);
  const b = Buffer.alloc(8);
  b.writeBigInt64BE(BigInt.asIntN(64, v));
  return b;
}
export function unpackPos(v) {
  const b = typeof v === 'bigint' ? v : BigInt(v);
  let x = Number((b >> 38n) & 0x3FFFFFFn); if (x >= (1 << 25)) x -= (1 << 26);
  const y = Number((b >> 26n) & 0xFFFn);
  let z = Number(b & 0x3FFFFFFn); if (z >= (1 << 25)) z -= (1 << 26);
  return [x, y, z];
}

// ---------------- 方块状态名表（4096 项，下标 = (id<<4)|meta）----------------
const WOOL = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];

export const BLOCK_NAMES = (() => {
  const a = new Array(4096).fill('minecraft:air');
  const base = {
    1: 'stone', 2: 'grass_block', 3: 'dirt', 4: 'cobblestone', 5: 'oak_planks', 7: 'bedrock',
    8: 'water', 9: 'water', 10: 'lava', 11: 'lava', 12: 'sand', 13: 'gravel',
    14: 'gold_ore', 15: 'iron_ore', 16: 'coal_ore', 17: 'oak_log', 18: 'oak_leaves',
    20: 'glass', 24: 'sandstone', 35: 'white_wool', 41: 'gold_block', 42: 'iron_block',
    45: 'bricks', 46: 'tnt', 47: 'bookshelf', 48: 'mossy_cobblestone', 49: 'obsidian',
    50: 'torch', 53: 'oak_stairs', 54: 'chest', 56: 'diamond_ore', 57: 'diamond_block',
    58: 'crafting_table', 61: 'furnace', 65: 'ladder', 66: 'rail', 67: 'cobblestone_stairs',
    73: 'redstone_ore', 79: 'ice', 80: 'snow_block', 81: 'cactus', 82: 'clay',
    85: 'oak_fence', 86: 'pumpkin', 87: 'netherrack', 88: 'soul_sand', 89: 'glowstone',
    98: 'stone_bricks', 101: 'iron_bars', 102: 'glass_pane', 103: 'melon', 106: 'vine',
    110: 'mycelium', 112: 'nether_bricks', 121: 'end_stone', 129: 'emerald_ore',
    133: 'emerald_block', 152: 'quartz_ore', 155: 'quartz_block', 159: 'white_stained_glass',
    161: 'oak_leaves', 162: 'oak_log', 165: 'slime_block', 168: 'prismarine',
    169: 'sea_lantern', 170: 'hay_block', 172: 'terracotta', 173: 'coal_block',
    174: 'packed_ice', 179: 'red_sandstone', 201: 'purpur_block', 206: 'end_stone_bricks',
    26: 'bed', 30: 'cobweb', 31: 'short_grass', 32: 'dead_bush', 37: 'dandelion',
    38: 'poppy', 39: 'brown_mushroom', 40: 'red_mushroom', 51: 'fire', 52: 'spawner',
    55: 'redstone_wire', 59: 'wheat', 60: 'farmland', 63: 'oak_sign', 68: 'oak_wall_sign',
    70: 'stone_button', 71: 'iron_door', 64: 'oak_door', 72: 'stone_button', 77: 'oak_button',
    92: 'cake', 93: 'repeater', 94: 'repeater', 104: 'pumpkin_stem', 105: 'melon_stem',
    125: 'oak_slab', 127: 'cocoa', 137: 'command_block', 144: 'skeleton_skull',
    158: 'powered_rail', 27: 'powered_rail', 28: 'detector_rail',
    178: 'comparator',
    74: 'redstone_ore', 75: 'redstone_torch', 76: 'redstone_torch', 78: 'snow',
    83: 'sugar_cane', 84: 'jukebox', 90: 'nether_portal', 91: 'jack_o_lantern', 96: 'oak_trapdoor',
    97: 'infested_stone', 99: 'brown_mushroom_block', 100: 'red_mushroom_block',
    107: 'oak_fence_gate', 108: 'brick_stairs', 109: 'stone_brick_stairs', 111: 'lily_pad',
    113: 'nether_brick_fence', 114: 'nether_brick_stairs', 115: 'nether_wart',
    116: 'enchanting_table', 117: 'brewing_stand', 118: 'cauldron', 119: 'end_portal',
    120: 'end_portal_frame', 122: 'dragon_egg', 123: 'redstone_lamp', 124: 'redstone_lamp',
    126: 'oak_slab', 128: 'sandstone_stairs', 130: 'ender_chest', 131: 'tripwire_hook',
    132: 'tripwire', 134: 'spruce_stairs', 135: 'birch_stairs', 136: 'jungle_stairs',
    138: 'beacon', 139: 'cobblestone_wall', 140: 'flower_pot', 141: 'carrots', 142: 'potatoes',
    143: 'oak_button', 145: 'anvil', 146: 'trapped_chest', 147: 'light_weighted_pressure_plate',
    148: 'heavy_weighted_pressure_plate', 149: 'comparator', 151: 'redstone_block',
    153: 'hopper', 154: 'quartz_block', 156: 'activator_rail', 157: 'dropper',
    166: 'barrier', 167: 'iron_trapdoor', 175: 'sunflower', 176: 'white_banner',
    177: 'white_wall_banner', 180: 'red_sandstone_stairs', 182: 'red_sandstone_slab',
    183: 'spruce_fence_gate', 184: 'birch_fence_gate', 185: 'jungle_fence_gate',
    186: 'dark_oak_fence_gate', 187: 'acacia_fence_gate', 188: 'spruce_fence',
    189: 'birch_fence', 190: 'jungle_fence', 191: 'dark_oak_fence', 192: 'acacia_fence',
    193: 'spruce_door', 194: 'birch_door', 195: 'jungle_door', 196: 'acacia_door',
    197: 'dark_oak_door', 198: 'end_rod', 199: 'chorus_plant', 200: 'chorus_flower',
    202: 'purpur_pillar', 203: 'purpur_stairs', 204: 'purpur_slab', 205: 'purpur_slab',
    207: 'beetroots', 208: 'dirt_path', 209: 'end_gateway', 210: 'repeating_command_block',
    211: 'chain_command_block', 212: 'frosted_ice', 213: 'magenta_glazed_terracotta',
    214: 'white_glazed_terracotta', 215: 'orange_glazed_terracotta',
    216: 'yellow_glazed_terracotta', 217: 'lime_glazed_terracotta',
    218: 'pink_glazed_terracotta', 219: 'gray_glazed_terracotta',
    220: 'light_gray_glazed_terracotta', 221: 'cyan_glazed_terracotta',
    222: 'purple_glazed_terracotta', 223: 'blue_glazed_terracotta',
    224: 'brown_glazed_terracotta', 225: 'green_glazed_terracotta',
    226: 'red_glazed_terracotta', 227: 'black_glazed_terracotta',
  };
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
    a[(5 << 4) | m] = 'minecraft:' + WOODS[m] + '_planks';
    a[(17 << 4) | m] = 'minecraft:' + WOODS[Math.min(m, 3)] + '_log';
    a[(162 << 4) | m] = m === 0 ? 'minecraft:acacia_log' : m === 1 ? 'minecraft:dark_oak_log' : 'minecraft:oak_log';
    a[(126 << 4) | m] = 'minecraft:' + WOODS[m] + '_slab';
    a[(6 << 4) | m] = 'minecraft:' + WOODS[m] + '_sapling';
  }
  for (let m = 0; m < 4; m++) a[(18 << 4) | m] = 'minecraft:' + ['oak', 'spruce', 'birch', 'jungle'][m] + '_leaves';
  a[(161 << 4) | 0] = 'minecraft:acacia_leaves'; a[(161 << 4) | 1] = 'minecraft:dark_oak_leaves';
  a[(31 << 4) | 0] = 'minecraft:dead_bush'; a[(31 << 4) | 1] = 'minecraft:short_grass'; a[(31 << 4) | 2] = 'minecraft:fern';
  const FLOWERS = ['poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy'];
  for (let m = 0; m < FLOWERS.length; m++) a[(38 << 4) | m] = 'minecraft:' + FLOWERS[m];
  const SLAB_KINDS = ['stone', 'sandstone', 'oak', 'cobblestone', 'bricks', 'stone_brick', 'nether_brick', 'quartz'];
  for (let m = 0; m < 8; m++) { a[(44 << 4) | m] = 'minecraft:' + SLAB_KINDS[m] + '_slab'; a[(43 << 4) | m] = 'minecraft:' + SLAB_KINDS[m] + '_slab'; }
  a[(12 << 4) | 1] = 'minecraft:red_sand';
  const STONES = ['stone', 'granite', 'polished_granite', 'diorite', 'polished_diorite', 'andesite', 'polished_andesite'];
  for (let m = 0; m < 7; m++) a[(1 << 4) | m] = 'minecraft:' + STONES[m];
  a[(3 << 4) | 1] = 'minecraft:coarse_dirt'; a[(3 << 4) | 2] = 'minecraft:podzol';
  a[(24 << 4) | 1] = 'minecraft:chiseled_sandstone'; a[(24 << 4) | 2] = 'minecraft:cut_sandstone';
  a[(98 << 4) | 1] = 'minecraft:mossy_stone_bricks'; a[(98 << 4) | 2] = 'minecraft:cracked_stone_bricks'; a[(98 << 4) | 3] = 'minecraft:chiseled_stone_bricks';
  const DP = ['sunflower', 'lilac', 'tall_grass', 'large_fern', 'rose_bush', 'peony'];
  for (let m = 0; m < 6; m++) a[(175 << 4) | m] = 'minecraft:' + DP[m];
  a[(21 << 4) | 0] = 'minecraft:lapis_ore'; a[(22 << 4) | 0] = 'minecraft:lapis_block';
  a[(23 << 4) | 0] = 'minecraft:dispenser'; a[(25 << 4) | 0] = 'minecraft:note_block';
  a[(29 << 4) | 0] = 'minecraft:sticky_piston'; a[(33 << 4) | 0] = 'minecraft:piston'; a[(34 << 4) | 0] = 'minecraft:piston_head';
  a[(69 << 4) | 0] = 'minecraft:lever'; a[(178 << 4) | 0] = 'minecraft:daylight_detector';
  // 兜底：同一 id 未登记的 meta 变体沿用基名，别让流动的水/朝向不同的火把变空气
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
})();

// 群系表也用不带前缀的名字（客户端 vbiomeIndex 按 biome_order 查）
export const BIOME_NAMES = new Array(256).fill('plains');

// 1.8 物品 id -> vanilla 名（无前缀）；同时给反向表用于 C->S 的 slot 打包
const TOOL_NAMES = {
  256: 'iron_shovel', 257: 'iron_pickaxe', 258: 'iron_axe', 259: 'flint_and_steel', 260: 'apple', 261: 'bow', 262: 'arrow', 263: 'coal', 264: 'diamond', 265: 'iron_ingot', 266: 'gold_ingot', 267: 'iron_sword', 268: 'wooden_sword', 269: 'wooden_shovel', 270: 'wooden_pickaxe', 271: 'wooden_axe', 272: 'stone_sword', 273: 'stone_shovel', 274: 'stone_pickaxe', 275: 'stone_axe', 276: 'diamond_sword', 277: 'diamond_shovel', 278: 'diamond_pickaxe', 279: 'diamond_axe', 280: 'stick', 281: 'bowl', 282: 'mushroom_stew', 283: 'golden_sword', 284: 'golden_shovel', 285: 'golden_pickaxe', 286: 'golden_axe', 287: 'string', 288: 'feather', 289: 'gunpowder', 290: 'wooden_hoe', 291: 'stone_hoe', 292: 'iron_hoe', 293: 'diamond_hoe', 294: 'golden_hoe', 295: 'wheat_seeds', 296: 'wheat', 297: 'bread', 306: 'iron_helmet', 307: 'iron_chestplate', 308: 'iron_leggings', 309: 'iron_boots', 310: 'diamond_helmet', 311: 'diamond_chestplate', 312: 'diamond_leggings', 313: 'diamond_boots', 318: 'flint', 319: 'porkchop', 320: 'cooked_porkchop', 322: 'golden_apple', 324: 'oak_door', 325: 'bucket', 326: 'water_bucket', 327: 'lava_bucket', 328: 'minecart', 329: 'saddle', 331: 'redstone', 332: 'snowball', 333: 'oak_boat', 334: 'leather', 335: 'milk_bucket', 336: 'brick', 337: 'clay_ball', 338: 'sugar_cane', 339: 'paper', 340: 'book', 341: 'slime_ball', 344: 'egg', 345: 'compass', 346: 'fishing_rod', 347: 'clock', 348: 'glowstone_dust', 352: 'bone', 353: 'sugar', 355: 'bed', 356: 'repeater', 357: 'cookie', 359: 'shears', 360: 'melon_slice', 361: 'pumpkin_seeds', 362: 'melon_seeds', 364: 'cooked_beef', 365: 'chicken', 366: 'cooked_chicken', 367: 'rotten_flesh', 368: 'ender_pearl', 369: 'blaze_rod', 371: 'gold_nugget', 372: 'nether_wart', 374: 'glass_bottle', 375: 'spider_eye', 377: 'blaze_powder', 378: 'magma_cream', 379: 'brewing_stand', 381: 'ender_eye', 384: 'experience_bottle', 388: 'emerald', 391: 'carrot', 392: 'potato', 393: 'baked_potato', 396: 'golden_carrot', 397: 'skeleton_skull', 398: 'carrot_on_a_stick', 399: 'nether_star', 400: 'pumpkin_pie', 404: 'comparator', 406: 'quartz',
};
export const MC_ITEM_NAMES = (() => {
  const m = {};
  for (let id = 1; id < 256; id++) if (BLOCK_NAMES[id << 4] !== 'air') m[id] = BLOCK_NAMES[id << 4];
  Object.assign(m, TOOL_NAMES);
  return m;
})();
export const MC_ITEM_IDS = (() => {
  const m = new Map();
  for (const [id, n] of Object.entries(MC_ITEM_NAMES)) if (!m.has(n)) m.set(n, +id);
  return m;
})();

// MC 1.8 生物 type id -> OpusMC NET_MOBS 名字（不在 NET_MOBS 里的宁可不生成，也别乱映射）
export const MC_MOBS = {
  50: 'creeper', 51: 'skeleton', 52: 'spider', 54: 'zombie', 56: 'ghast',
  57: 'zombified_piglin', 58: 'enderman', 59: 'spider', 61: 'blaze', 62: 'magma_cube',
  90: 'pig', 91: 'sheep', 92: 'cow', 93: 'chicken', 95: 'cat', 96: 'cow',
  98: 'cat', 99: 'iron_golem', 120: 'villager',
};

// ---------------- 区块打包 ----------------
// data（PHPMC 0x21 负载，分组布局）：
//   [n*8192 blocks u16LE (id<<4|meta)] [n*2048 blockLight] [n*2048 skyLight] [256 biomes（仅 groundUp）]
// 输出（net.js onBinary type=1）：
//   [u8 1][i32LE cx][i32LE cz][u8 n] + 每段
//     [u16LE paletteLen][u16LE raw...][索引 4096×u8 / u16（len==1 时整段省略）]
//     [u8 flags][sky 2048][block 2048]
//   + [u8 biomes 256]
// 段索引：net.js 把第 i 个段放到 section i，故按 mask 的 bit 位置补齐占位段。
export function chunkToOpus(cx, cz, mask, data, groundUp = true) {
  const ids = [];
  for (let s = 0; s < 16; s++) if (mask & (1 << s)) ids.push(s);
  const n = ids.length;
  const bioLen = groundUp === false ? 0 : 256;
  const need = n * 12288 + bioLen;
  if (data.length < need) {
    throw new Error(`0x21 数据不足：${data.length}B，按 mask=0x${mask.toString(16)} 需要 ${need}B`);
  }

  const blocksEnd = n * 8192;
  const blStart = blocksEnd, skyStart = blocksEnd + n * 2048;
  const biomes = bioLen ? Buffer.from(data.subarray(n * 12288, n * 12288 + 256)) : Buffer.alloc(256);

  const packed = new Map(); // section index -> {palette, cells, sky, bl}
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
    }
    packed.set(ids[k], {
      palette, cells,
      sky: Buffer.from(data.subarray(skyStart + k * 2048, skyStart + (k + 1) * 2048)),
      bl: Buffer.from(data.subarray(blStart + k * 2048, blStart + (k + 1) * 2048)),
    });
  }

  const head = Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  head.writeInt32LE(cx, 1); head.writeInt32LE(cz, 5);
  const maxSec = n ? ids[n - 1] : -1;
  head[9] = maxSec + 1; // 段数含占位段，保证客户端的 s 就是真实 section index
  const out = [head];
  for (let s = 0; s <= maxSec; s++) {
    const sec = packed.get(s);
    if (!sec) {
      // 空段占位：palette=[0]（空气），flags=0（不带光照）。net.js putSection 会因 !solid 跳过。
      out.push(Buffer.from([1, 0, 0, 0, 0]));
      continue;
    }
    const len = Buffer.alloc(2); len.writeUInt16LE(sec.palette.length);
    const pal = Buffer.alloc(sec.palette.length * 2);
    for (let i = 0; i < sec.palette.length; i++) pal.writeUInt16LE(sec.palette[i], i * 2);
    out.push(len, pal);
    if (sec.palette.length === 1) {
      // net.js: len==1 时不读索引数组，整段就是 palette[0]
    } else if (sec.palette.length <= 256) {
      out.push(Buffer.from(Uint8Array.from(sec.cells)));
    } else {
      out.push(Buffer.from(sec.cells.buffer, sec.cells.byteOffset, sec.cells.byteLength));
    }
    out.push(Buffer.from([3]), sec.sky, sec.bl); // bit0 sky / bit1 block，顺序按 net.js
  }
  out.push(biomes.length === 256 ? biomes : Buffer.alloc(256));
  return Buffer.concat(out);
}
