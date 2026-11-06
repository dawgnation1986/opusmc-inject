# -*- coding: utf-8 -*-
# patch4 v2：手持物品 equip 翻译 + BLOCK_NAMES meta 变体补全（紫黑方块修复）+ 视距 8
import os
os.chdir(r"D:\discuz\webmc\hook\opusmc-inject")
p = 'tools/mc-proxy.mjs'
t = open(p, newline='', encoding='utf-8').read()

def rep(old, new, n=1):
    global t
    c = t.count(old)
    assert c == n, 'old 命中 %d 次（应 %d）: %s...' % (c, n, old[:70])
    t = t.replace(old, new)

# 1) meta 变体补全（插在原木循环后、return a 前）
rep("""  for (let m = 0; m < 6; m++) {
    a[(5 << 4) | m] = 'minecraft:' + WOODS[m] + '_planks';
    a[(17 << 4) | m] = 'minecraft:' + WOODS[Math.min(m, 3)] + '_log';
    a[(162 << 4) | m] = m === 0 ? 'minecraft:acacia_log' : m === 1 ? 'minecraft:dark_oak_log' : 'minecraft:oak_log';
    a[(126 << 4) | m] = 'minecraft:' + WOODS[m] + '_slab';
  }
  return a;""",
"""  for (let m = 0; m < 6; m++) {
    a[(5 << 4) | m] = 'minecraft:' + WOODS[m] + '_planks';
    a[(17 << 4) | m] = 'minecraft:' + WOODS[Math.min(m, 3)] + '_log';
    a[(162 << 4) | m] = m === 0 ? 'minecraft:acacia_log' : m === 1 ? 'minecraft:dark_oak_log' : 'minecraft:oak_log';
    a[(126 << 4) | m] = 'minecraft:' + WOODS[m] + '_slab';
    a[(6 << 4) | m] = 'minecraft:' + WOODS[m] + '_sapling';
  }
  for (let m = 0; m < 4; m++) a[(18 << 4) | m] = 'minecraft:' + ['oak','spruce','birch','jungle'][m] + '_leaves';
  a[(161 << 4) | 0] = 'minecraft:acacia_leaves'; a[(161 << 4) | 1] = 'minecraft:dark_oak_leaves';
  a[(31 << 4) | 0] = 'minecraft:dead_bush'; a[(31 << 4) | 1] = 'minecraft:short_grass'; a[(31 << 4) | 2] = 'minecraft:fern';
  const FLOWERS = ['poppy','blue_orchid','allium','azure_bluet','red_tulip','orange_tulip','white_tulip','pink_tulip','oxeye_daisy'];
  for (let m = 0; m < FLOWERS.length; m++) a[(38 << 4) | m] = 'minecraft:' + FLOWERS[m];
  const SLAB_KINDS = ['stone','sandstone','oak','cobblestone','bricks','stone_brick','nether_brick','quartz'];
  for (let m = 0; m < 8; m++) { a[(44 << 4) | m] = 'minecraft:' + SLAB_KINDS[m] + '_slab'; a[(43 << 4) | m] = 'minecraft:' + SLAB_KINDS[m] + '_slab'; }
  a[(12 << 4) | 1] = 'minecraft:red_sand';
  const STONES = ['stone','granite','polished_granite','diorite','polished_diorite','andesite','polished_andesite'];
  for (let m = 0; m < 7; m++) a[(1 << 4) | m] = 'minecraft:' + STONES[m];
  a[(3 << 4) | 1] = 'minecraft:coarse_dirt'; a[(3 << 4) | 2] = 'minecraft:podzol';
  a[(24 << 4) | 1] = 'minecraft:chiseled_sandstone'; a[(24 << 4) | 2] = 'minecraft:cut_sandstone';
  a[(98 << 4) | 1] = 'minecraft:mossy_stone_bricks'; a[(98 << 4) | 2] = 'minecraft:cracked_stone_bricks'; a[(98 << 4) | 3] = 'minecraft:chiseled_stone_bricks';
  const DP = ['sunflower','lilac','tall_grass','large_fern','rose_bush','peony'];
  for (let m = 0; m < 6; m++) a[(175 << 4) | m] = 'minecraft:' + DP[m];
  a[(21 << 4) | 0] = 'minecraft:lapis_ore'; a[(22 << 4) | 0] = 'minecraft:lapis_block';
  a[(23 << 4) | 0] = 'minecraft:dispenser'; a[(25 << 4) | 0] = 'minecraft:note_block';
  a[(29 << 4) | 0] = 'minecraft:sticky_piston'; a[(33 << 4) | 0] = 'minecraft:piston'; a[(34 << 4) | 0] = 'minecraft:piston_head';
  a[(69 << 4) | 0] = 'minecraft:lever'; a[(178 << 4) | 0] = 'minecraft:daylight_detector';
  return a;""")

# 2) 0x0C 手持物品 → equip 消息
rep("""      case 0x0C: { // Spawn Player：eid + uuid16 + int×3(×32) + yaw/pitch + held(short) + metadata
        const eid = r.varInt();
        const uuid = r.raw(16);
        const x = r.i32() / 32, y = r.i32() / 32, z = r.i32() / 32;
        const yaw = r.u8() * 360 / 256, pitch = r.u8() * 360 / 256;
        r.i16();
        skipMetadata(r);
        entPos.set(eid, { x, y, z, yawDeg: yaw, pitchDeg: pitch });
        out.spawn = { type: 'player', id: eid, uuid: uuidHex(uuid), x, y, z, yaw, pitch, name: playerNames.get(uuidHex(uuid)) };
        return;
      }""",
"""      case 0x0C: { // Spawn Player：eid + uuid16 + int×3(×32) + yaw/pitch + held(short) + metadata
        const eid = r.varInt();
        const uuid = r.raw(16);
        const x = r.i32() / 32, y = r.i32() / 32, z = r.i32() / 32;
        const yaw = r.u8() * 360 / 256, pitch = r.u8() * 360 / 256;
        const held = r.i16();
        skipMetadata(r);
        entPos.set(eid, { x, y, z, yawDeg: yaw, pitchDeg: pitch });
        out.spawn = { type: 'player', id: eid, uuid: uuidHex(uuid), x, y, z, yaw, pitch, name: playerNames.get(uuidHex(uuid)) };
        if (held > 0) out.equip = { id: eid, item: { n: MC_ITEM_NAMES[held] || null, c: 1 } };
        return;
      }""")

# 3) MC 物品 id -> vanilla 名（插在 BLOCK_NAMES 之后）
rep("""  return a;
})();
// 群系：全平原""",
"""  return a;
})();
// MC 1.8 物品 id -> vanilla 名（手持 equip 用；1-255 复用方块名，256+ 工具/物品）
const MC_ITEM_NAMES = (() => {
  const m = {};
  for (let id = 1; id < 256; id++) if (BLOCK_NAMES[id << 4] !== 'minecraft:air') m[id] = BLOCK_NAMES[id << 4].slice(10);
  const tools = { 256:'iron_shovel',257:'iron_pickaxe',258:'iron_axe',259:'flint_and_steel',260:'apple',261:'bow',262:'arrow',263:'coal',264:'diamond',265:'iron_ingot',266:'gold_ingot',267:'iron_sword',268:'wooden_sword',269:'wooden_shovel',270:'wooden_pickaxe',271:'wooden_axe',272:'stone_sword',273:'stone_shovel',274:'stone_pickaxe',275:'stone_axe',276:'diamond_sword',277:'diamond_shovel',278:'diamond_pickaxe',279:'diamond_axe',280:'stick',281:'bowl',282:'mushroom_stew',283:'golden_sword',284:'golden_shovel',285:'golden_pickaxe',286:'golden_axe',287:'string',288:'feather',289:'gunpowder',290:'wooden_hoe',291:'stone_hoe',292:'iron_hoe',293:'diamond_hoe',294:'golden_hoe',295:'wheat_seeds',296:'wheat',297:'bread',306:'iron_helmet',307:'iron_chestplate',308:'iron_leggings',309:'iron_boots',310:'diamond_helmet',311:'diamond_chestplate',312:'diamond_leggings',313:'diamond_boots',318:'flint',319:'porkchop',320:'cooked_porkchop',322:'golden_apple',324:'oak_door',325:'bucket',326:'water_bucket',327:'lava_bucket',328:'minecart',329:'saddle',331:'redstone',332:'snowball',333:'oak_boat',334:'leather',335:'milk_bucket',336:'brick',337:'clay_ball',338:'sugar_cane',339:'paper',340:'book',341:'slime_ball',344:'egg',345:'compass',346:'fishing_rod',347:'clock',348:'glowstone_dust',352:'bone',353:'sugar',355:'bed',356:'repeater',357:'cookie',359:'shears',360:'melon_slice',361:'pumpkin_seeds',362:'melon_seeds',364:'cooked_beef',365:'chicken',366:'cooked_chicken',367:'rotten_flesh',368:'ender_pearl',369:'blaze_rod',371:'gold_nugget',372:'nether_wart',374:'glass_bottle',375:'spider_eye',377:'blaze_powder',378:'magma_cream',379:'brewing_stand',381:'ender_eye',384:'experience_bottle',388:'emerald',391:'carrot',392:'potato',393:'baked_potato',396:'golden_carrot',397:'skeleton_skull',398:'carrot_on_a_stick',399:'nether_star',400:'pumpkin_pie',404:'comparator',406:'quartz' };
  Object.assign(m, tools);
  return m;
})();
// 群系：全平原""")

# 4) mcToClient 下发 equip（在 spawn 之后）
rep("""  if (out.spawn) toClient(Object.assign({ t: 'spawn' }, out.spawn));""",
"""  if (out.spawn) toClient(Object.assign({ t: 'spawn' }, out.spawn));
  if (out.equip) toClient({ t: 'equip', id: out.equip.id, item: out.equip.item });""")

open(p, 'w', newline='', encoding='utf-8').write(t)
print('patch4 v2 完成：equip + 方块表补全')

# 5) PHPMC 视距 3 -> 8
pp = r"D:\discuz\webmc\hook\opusmc-inject\PHPMC\server.properties"
pt = open(pp, newline='', encoding='utf-8').read()
if 'view-distance=3' in pt:
    pt = pt.replace('view-distance=3', 'view-distance=8')
    open(pp, 'w', newline='', encoding='utf-8').write(pt)
    print('PHPMC 视距 3 -> 8')
else:
    print('视距已是 8 或配置变化，跳过')
