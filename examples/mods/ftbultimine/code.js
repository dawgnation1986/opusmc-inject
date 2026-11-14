'use strict';
// ---------------------------------------------------------------------------
// FTB Ultimine —— OpusMC 还原版
//
// 逐段对照 FTBTeam/FTB-Ultimine（dev 分支，26.1.2.8）的源码：
//   shape/ShapelessShape.java          26 邻域泛洪 + 作物 5x5 邻域
//   shape/SmallTunnelShape.java        沿命中面向内逐格
//   shape/LargeTunnelShape.java        3x3 逐层推进
//   shape/SmallSquareShape.java        = LargeTunnel(maxDepth=1)
//   shape/DiagonalTunnelShape.java     斜向矿道（yDirection ±1）
//   shape/BlockMatchers.java           同类 / 标签 / 作物 三种匹配器
//   api/shape/ShapeContext.java        check(pos) 与 matcher
//   FTBUltiminePlayerData.java         pressed / shapeIndex / 缓存 / updateBlocks
//   FTBUltimine.java                  canUltimine / breakBlocksInShape
//   utils/ShapeMerger.java             外轮廓合并（这里用等价的「只画暴露面」实现）
//   client/FTBUltimineClient.java      renderInGame：实线外缘 + 半透明隐藏边
//   config/*Config.java                默认值
//
// 只在页面跑，单人世界有效（和 FTB 一样：联机房是原版）。
// ---------------------------------------------------------------------------
(function () {
  if (typeof Game === 'undefined') return;

  // ---- 配置默认值（FTBUltimineServerConfig / FTBUltimineClientConfig）----
  const CFG = {
    maxBlocks: 64,              // COSTS_LIMITS.max_blocks
    exhaustionPerBlock: 20.0,   // COSTS_LIMITS.exhaustion_per_block（实际 * 0.005）
    experiencePerBlock: 0.0,    // COSTS_LIMITS.experience_per_block
    requireTool: false,         // COSTS_LIMITS.require_tool
    requireValidTool: false,    // COSTS_LIMITS.require_valid_tool_for_block
    cooldownMs: 0,              // COSTS_LIMITS.ultimine_cooldown（tick -> ms）
    preventToolBreak: 0,        // MISC.prevent_tool_break (0..100)
    cancelOnFail: false,        // MISC.cancel_on_block_break_fail
    mergeTagsShapeless: ['minecraft:base_stone_overworld', 'c:ores/*', 'forge:ores/*'],
    mergeTagsShaped: ['*'],
    renderOutline: 256,         // RENDERING.render_outline
    previewLineAlpha: 45,       // RENDERING.preview_line_alpha (0..255)
    requireKeyForCycling: true, // GENERAL.require_ultimine_key_for_cycling
    shapeFeedback: false,       // GENERAL.shape_feedback_hotbar_message
    singleCropHarvesting: true, // FEATURES.single_crop_harvesting
  };

  // ---- 形状名（ShapeRegistry.registerBuiltinShapes 的注册顺序）----
  const SHAPES = [
    { id: 'shapeless',      cn: '散挖',       indeterminate: true,  isDefault: true },
    { id: 'small_tunnel',   cn: '小隧道',     indeterminate: false },
    { id: 'small_square',   cn: '3×3 单层',   indeterminate: false },
    { id: 'large_tunnel',   cn: '3×3 隧道',   indeterminate: false },
    { id: 'mining_tunnel',  cn: '下斜矿道',   indeterminate: false },
    { id: 'escape_tunnel',  cn: '上斜逃生梯', indeterminate: false },
  ];

  // ---- 命中面 -> 方向（FACE_NAMES = west,east,down,up,north,south）----
  const FACE_VEC = [
    [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]
  ];
  const FACE_AXIS = [0, 0, 1, 1, 2, 2];   // 0=X 1=Y 2=Z
  const keyOf = (id) => (typeof BLOCKS !== 'undefined' && BLOCKS[id] ? BLOCKS[id].key : '');
  const metaOf = (w, x, y, z) => (w.getMeta ? w.getMeta(x, y, z) : 0);
  const sleepSafe = (n) => Math.max(0, n | 0);

  // ---- 按键：按住 Alt 激活（FTB 的 Ultimine 键），滚轮/↑↓ 切形状 ----
  // 用 KEYBIND_CATS 登记，和内置 veinminer 的 Backquote 开关互不冲突。
  if (typeof KEYBIND_CATS !== 'undefined' && typeof KEY_DEFAULT !== 'undefined' && !KEY_DEFAULT.ultimineHold) {
    KEYBIND_CATS.push(['连锁破坏（FTB）', [
      ['ultimineHold', '按住启用连锁破坏', 'AltLeft'],
      ['ultimineNext', '切换下一个形状', 'ArrowUp'],
      ['ultiminePrev', '切换上一个形状', 'ArrowDown'],
    ]]);
    KEY_DEFAULT.ultimineHold = 'AltLeft';
    KEY_DEFAULT.ultimineNext = 'ArrowUp';
    KEY_DEFAULT.ultiminePrev = 'ArrowDown';
    if (typeof KEY_CN !== 'undefined') {
      KEY_CN.ultimineHold = '按住启用连锁破坏';
      KEY_CN.ultimineNext = '切换下一个形状';
      KEY_CN.ultiminePrev = '切换上一个形状';
    }
  }

  const bound = (g, id, def) => {
    const k = g.settings && g.settings.keys && g.settings.keys[id];
    return k !== undefined ? k : def;
  };
  const isKeyDown = (e, code) => e.code === code || (code === 'AltLeft' && e.key === 'Alt');

  // ---- 玩家状态（FTBUltiminePlayerData：pressed / shapeIndex / 缓存）----
  const state = {
    pressed: false,
    shapeIndex: 0,
    cachedPos: null,
    cachedDir: -1,
    cachedBlocks: [],
    pendingXP: 0,
    exhaustion: 0,
    lastUse: 0,
  };
  const clearCache = () => { state.cachedPos = null; state.cachedDir = -1; state.cachedBlocks = []; };
  const currentShape = () => SHAPES[state.shapeIndex] || SHAPES[0];
  const cycleShape = (next, g) => {
    state.shapeIndex = (state.shapeIndex + (next ? 1 : -1) + SHAPES.length) % SHAPES.length;
    clearCache();
    if (CFG.shapeFeedback && g.ui && g.ui.message) g.ui.message('形状：' + currentShape().cn, '#FFFFFF');
  };

  // ---- 方块分组 / 标签匹配（BlockMatchers + FTBUltimineTags 的近似）----
  // 网页版没有原版的 tag registry，用 key 模式还原 FTB 默认的三组标签：
  //   base_stone_overworld -> stone/andesite/diorite/granite/deepslate/tuff...
  //   c:ores/* / forge:ores/* -> *_ore / ancient_debris
  const BASE_STONE = /^(stone|andesite|diorite|granite|tuff|deepslate|calcite|smooth_basalt|dripstone_block|infested_)/;
  const isOre = (k) => /_ore$/.test(k) || k === 'ancient_debris';
  const isBaseStone = (k) => BASE_STONE.test(k);
  const isLog = (k) => /_(log|wood|stem|hyphae)$/.test(k);
  const isCropKey = (k) => /^(wheat|carrots|potatoes|beetroots|nether_wart|cocoa|torchflower_crop|melon|pumpkin)$/.test(k);
  const inMergeGroup = (k) => isBaseStone(k) || isOre(k);

  // BlockMatchers.MATCH_BY_BLOCK：同一种方块
  const matchByBlock = (origKey) => (k) => k === origKey;
  // BlockMatchers.MATCH_BY_TAGS_SHAPELESS：默认标签组内的算同类
  const matchByTagsShapeless = (origKey) => (k) => {
    if (k === origKey) return true;
    if (inMergeGroup(origKey) && inMergeGroup(k)) return true;
    // 同种矿石的 deepslate 变体
    if (isOre(origKey) && isOre(k) && origKey.replace(/^deepslate_/, '') === k.replace(/^deepslate_/, '')) return true;
    // 同种树木的 log / wood
    if (isLog(origKey) && isLog(k) && origKey.replace(/_(log|wood|stem|hyphae)$/, '') === k.replace(/_(log|wood|stem|hyphae)$/, '')) return true;
    return false;
  };
  // BlockMatchers.MATCH_BY_TAGS_SHAPED：默认 '*'，任意方块都算匹配
  const matchByTagsShaped = () => () => true;
  // BlockMatchers.MATCH_BY_CROP_TYPE：同种成熟作物
  const matchByCrop = (origKey, origId, origMeta, ripeFn) => (k, id, m) => k === origKey && ripeFn(id, m) === ripeFn(origId, origMeta);

  // BlockMatchers.determineBestMatcher
  function determineMatcher(shape, origKey, origId, origMeta, ripeFn) {
    const tagMatcher = shape.indeterminate ? matchByTagsShapeless(origKey) : matchByTagsShaped();
    if (tagMatcher(origKey, origId, origMeta)) return { fn: tagMatcher, cropLike: false };
    if (isCropKey(origKey)) return { fn: matchByCrop(origKey, origId, origMeta, ripeFn), cropLike: true };
    return { fn: matchByBlock(origKey), cropLike: false };
  }

  // 成熟判定（VanillaCropLikeHandler 的近似：age 到上限 / 老小麦 meta>=7）
  // ripe(id, meta)：网页版把 block id 和 meta 一起传进来（Features.propOf(id, meta, 'age')）
  function ripe(id, meta) {
    const k = keyOf(id);
    if (k === 'wheat') return (meta | 0) >= 7;                 // 老小麦用 meta 存 age
    if (k === 'melon' || k === 'pumpkin' || k === 'cocoa' || k === 'nether_wart') return true;
    if (typeof Features !== 'undefined' && Features.propOf) {
      const age = Features.propOf(id, meta, 'age');
      if (age !== undefined) {
        const b = BLOCKS[id];
        const max = b && b.states ? Math.max(0, ...b.states.map(s => +s.age || 0)) : 0;
        return max > 0 && +age >= max;
      }
    }
    return true;
  }

  // ---- ShapeContext.check(pos)：读世界、跑匹配器 ----
  function makeContext(g, orig, face, origKey, origMeta, matcher, maxBlocks) {
    const w = g.world;
    return {
      orig, face, origKey, origMeta, matcher, maxBlocks,
      getBlock(x, y, z) { return w.getBlock(x, y, z); },
      getMeta(x, y, z) { return metaOf(w, x, y, z); },
      check(x, y, z) {
        const id = w.getBlock(x, y, z);
        if (!id) return false;
        return matcher.fn(keyOf(id), id, metaOf(w, x, y, z));
      },
    };
  }

  // ---- 26 邻域（ShapelessShape.NEIGHBOR_POSITIONS）----
  const NEIGHBORS_26 = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++)
    if (x || y || z) NEIGHBORS_26.push([x, y, z]);
  // ---- 作物邻域：5x5 平面 + 上下，按距中心排序（ShapelessShape.NEIGHBOR_POSITIONS_PLANT）----
  const NEIGHBORS_PLANT = [];
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++)
    if (x || z) NEIGHBORS_PLANT.push([x, 0, z]);
  NEIGHBORS_PLANT.push([0, 1, 0], [0, -1, 0]);
  NEIGHBORS_PLANT.sort((a, b) => (a[0] * a[0] + a[2] * a[2]) - (b[0] * b[0] + b[2] * b[2]));

  const d2 = (p, o) => (p[0] - o[0]) ** 2 + (p[1] - o[1]) ** 2 + (p[2] - o[2]) ** 2;

  // ---- ShapelessShape.walk：显式栈的泛洪，命中才扩展邻居 ----
  function shapeless(ctx, cropLike) {
    const known = [], knownSet = new Set();
    const traversed = new Set();
    const open = [ctx.orig.slice()];
    const key = (p) => p[0] + ',' + p[1] + ',' + p[2];
    traversed.add(key(ctx.orig));
    const neighbors = cropLike ? NEIGHBORS_PLANT : NEIGHBORS_26;
    while (open.length) {
      const p = open.pop();
      const k = key(p);
      if (!ctx.check(p[0], p[1], p[2]) || knownSet.has(k)) continue;
      knownSet.add(k); known.push(p);
      if (known.length >= ctx.maxBlocks) break;
      for (const n of neighbors) {
        const q = [p[0] + n[0], p[1] + n[1], p[2] + n[2]], kk = key(q);
        if (!traversed.has(kk)) { traversed.add(kk); open.push(q); }
      }
    }
    // EntityDistanceComparator：离起始点近的先破坏
    known.sort((a, b) => d2(a, ctx.orig) - d2(b, ctx.orig));
    return known.slice(0, ctx.maxBlocks);
  }

  // ---- SmallTunnelShape：沿命中面反方向逐格 ----
  function smallTunnel(ctx) {
    const out = [], f = FACE_VEC[ctx.face] || [0, 0, -1];
    for (let i = 0; i < ctx.maxBlocks; i++) {
      const p = [ctx.orig[0] - f[0] * i, ctx.orig[1] - f[1] * i, ctx.orig[2] - f[2] * i];
      if (!ctx.check(p[0], p[1], p[2])) break;
      out.push(p);
    }
    return out;
  }

  // ---- LargeTunnelShape / SmallSquareShape(maxDepth=1)：3x3 逐层推进 ----
  function largeTunnel(ctx, maxDepth) {
    const out = [], axis = FACE_AXIS[ctx.face] === undefined ? 2 : FACE_AXIS[ctx.face];
    const f = FACE_VEC[ctx.face] || [0, 0, -1];
    let base = ctx.orig.slice(), depth = 0;
    out.push(base.slice());
    while (depth < maxDepth && out.length < ctx.maxBlocks) {
      const size = out.length;
      outer:
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        if (depth === 0 && a === 0 && b === 0) continue;
        const p = base.slice();
        if (axis === 0) { p[1] += a; p[2] += b; }
        else if (axis === 1) { p[0] += a; p[2] += b; }
        else { p[0] += a; p[1] += b; }
        if (ctx.check(p[0], p[1], p[2])) {
          out.push(p);
          if (out.length >= ctx.maxBlocks) break outer;
        }
      }
      if (out.length === size) break;   // 这一层没有可挖的，停
      base = [base[0] - f[0], base[1] - f[1], base[2] - f[2]];
      depth++;
    }
    return out;
  }

  // ---- DiagonalTunnelShape（MiningTunnel y=-1 / EscapeTunnel y=+1）----
  function diagonalTunnel(ctx, yDir) {
    const out = [];
    let f = FACE_VEC[ctx.face] || [0, 0, -1];
    // 命中面是竖直轴时，改用玩家朝向（FTB: context.player().getDirection().getOpposite()）
    if (FACE_AXIS[ctx.face] === 1) {
      const yaw = (ctx.playerYaw || 0);
      f = [Math.sin(yaw) > 0 ? -1 : 1, 0, Math.cos(yaw) > 0 ? -1 : 1];
    }
    for (let i = 0; i < ctx.maxBlocks; i++) {
      const p = [ctx.orig[0] - f[0] * i, ctx.orig[1] + yDir * i, ctx.orig[2] - f[2] * i];
      if (!ctx.check(p[0], p[1], p[2])) break;
      out.push(p);
    }
    return out;
  }

  function getBlocks(ctx, shapeId, cropLike) {
    switch (shapeId) {
      case 'shapeless': return shapeless(ctx, cropLike);
      case 'small_tunnel': return smallTunnel(ctx);
      case 'small_square': return largeTunnel(ctx, 1);
      case 'large_tunnel': return largeTunnel(ctx, 0x7fffffff);
      case 'mining_tunnel': return diagonalTunnel(ctx, -1);
      case 'escape_tunnel': return diagonalTunnel(ctx, 1);
      default: return shapeless(ctx, cropLike);
    }
  }

  // ---- canUltimine（FTBUltimine.canUltimine 的对应检查）----
  function canUltimine(g) {
    if (!g.player || g.net || g.state !== 'play') return false;
    if (CFG.cooldownMs > 0 && Date.now() - state.lastUse < CFG.cooldownMs) return false;
    if (g.mode !== 'creative' && (g.player.food | 0) <= 0) return false;
    if (CFG.requireTool) {
      const h = g.player.inv && g.player.inv.held;
      if (!h || !h.id) return false;
    }
    return true;
  }

  // ---- 更新预览缓存（FTBUltiminePlayerData.checkBlocks / updateBlocks）----
  function updateBlocks(g, pos, face) {
    const w = g.world;
    const id = w.getBlock(pos[0], pos[1], pos[2]);
    if (!id) { clearCache(); return; }
    const origKey = keyOf(id), origMeta = metaOf(w, pos[0], pos[1], pos[2]);
    const shape = currentShape();
    const m = determineMatcher(shape, origKey, id, origMeta, ripe);
    const max = Math.max(0, CFG.maxBlocks);
    if (!max) { clearCache(); return; }
    const ctx = makeContext(g, pos.slice(), face, origKey, origMeta, m, max);
    ctx.playerYaw = g.player ? g.player.yaw : 0;
    state.cachedPos = pos.slice();
    state.cachedDir = face;
    state.cachedBlocks = getBlocks(ctx, shape.id, m.cropLike);
    // 经验上限裁剪（FTBUltiminePlayerData.updateBlocks）
    if (CFG.experiencePerBlock > 0) {
      const xp = g.player ? (g.player.xp || 0) : 0;
      const lim = Math.floor(xp / CFG.experiencePerBlock);
      if (lim < state.cachedBlocks.length) state.cachedBlocks = state.cachedBlocks.slice(0, Math.max(0, lim));
    }
  }

  // ---- 破坏执行（FTBUltimine.breakBlocksInShape）----
  function breakBlocksInShape(g, orig) {
    const w = g.world, blocks = state.cachedBlocks;
    if (!blocks.length) return false;
    const id0 = w.getBlock(orig[0], orig[1], orig[2]);
    const baseHard = (BLOCKS[id0] && BLOCKS[id0].hardness) || 0;
    const shape = currentShape();
    // 快照：破坏过程中被连带移除/替换的位置要跳过
    const snapshot = blocks.map(p => [p, w.getBlock(p[0], p[1], p[2]), keyOf(w.getBlock(p[0], p[1], p[2]))]);
    let mined = 0;
    const hadItem = !!(g.player.inv && g.player.inv.held && g.player.inv.held.id);
    // DropsAccumulator：破坏期间把掉落/经验收起来，最后统一落在起始方块处
    const drops = []; let xp = 0;
    const di = g.dropItem, dx = g.dropXp;
    g.dropItem = (px, py, pz, st) => { if (st) drops.push(st); };
    g.dropXp = (px, py, pz, n) => { xp += n; };
    g.__ftbUltimining = true;
    try {
      for (const [p, expId, expKey] of snapshot) {
        const cur = w.getBlock(p[0], p[1], p[2]);
        if (!cur || cur !== expId) continue;      // 被先前的破坏波及
        const hard = (BLOCKS[cur] && BLOCKS[cur].hardness) || 0;
        // 硬度检查：shapeless 命中标签时豁免（铁矿/深板岩铁矿、石头混挖）
        const hardnessOK = hard >= 0 && (hard <= baseHard ||
          (shape.indeterminate && inMergeGroup(expKey) && inMergeGroup(keyOf(cur))));
        if (g.mode !== 'creative' && (!hardnessOK || !validToolFor(g, expKey, hard))) continue;

        if (!tryBreakOne(g, p) && CFG.cancelOnFail) break;

        if (g.mode !== 'creative') {
          // FTB: causeFoodExhaustion(exhaustionPerBlock * 0.005)，每 4 点扣 1 饥饿
          state.exhaustion += CFG.exhaustionPerBlock * 0.005;
          while (state.exhaustion >= 4 && g.player.food > 0) { g.player.food--; state.exhaustion -= 4; }
          if (g.player.food <= 0) break;
        }
        const held = g.player.inv && g.player.inv.held;
        if (hadItem && (!held || !held.id)) break;
        if (CFG.preventToolBreak > 0 && held && held.dmg !== undefined && held.dmg >= CFG.preventToolBreak) break;
        mined++;
      }
    } finally {
      g.__ftbUltimining = false;
      g.dropItem = di; g.dropXp = dx;
      if (di) for (const st of drops) di.call(g, orig[0] + 0.5, orig[1] + 0.5, orig[2] + 0.5, st);
      if (xp > 0 && dx) dx.call(g, orig[0] + 0.5, orig[1] + 0.5, orig[2] + 0.5, xp);
      if (g.flushMesh) g.flushMesh();
    }
    if (g.mode !== 'creative') {
      state.lastUse = Date.now();
      if (CFG.experiencePerBlock > 0 && mined > 1) {
        const cost = Math.floor((mined - 1) * CFG.experiencePerBlock);
        if (cost > 0 && typeof g.addXp === 'function') g.addXp(-cost);
      }
    }
    return mined > 0;
  }

  function validToolFor(g, k, hard) {
    if (!CFG.requireValidTool) return true;
    const h = g.player.inv && g.player.inv.held;
    if (!h || !h.id) return hard <= 0;
    return true;
  }

  function tryBreakOne(g, p) {
    try {
      // 走游戏原版 breakBlock，让掉落、工具磨损、音效都按原版来
      g.breakBlock(p[0], p[1], p[2], false, true);
      return !g.world.getBlock(p[0], p[1], p[2]);
    } catch (e) { return false; }
  }

  // ---- 预览轮廓（ShapeMerger 的等价：只画暴露在外的面，不画内部共享面）----
  // FTB 用 AABB 合并成少数大盒子；网页版用「邻居不在选中集合 -> 画这个面的 4 条边」，
  // 视觉结果一致（截图里那片白色多边形），且省掉一遍盒子合并。
  function outlineEdges(list) {
    const set = new Set(list.map(p => p[0] + ',' + p[1] + ',' + p[2]));
    const has = (x, y, z) => set.has(x + ',' + y + ',' + z);
    const faces = [
      { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
      { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
      { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
      { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
      { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
      { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
    ];
    const solid = [], hidden = [];
    const e = 0.004;
    for (const [x, y, z] of list) {
      for (const f of faces) {
        if (has(x + f.n[0], y + f.n[1], z + f.n[2])) continue;   // 内部面不画
        for (let i = 0; i < 4; i++) {
          const a = f.c[i], b = f.c[(i + 1) % 4];
          const p1 = [x + a[0] + (a[0] ? e : -e), y + a[1] + (a[1] ? e : -e), z + a[2] + (a[2] ? e : -e)];
          const p2 = [x + b[0] + (b[0] ? e : -e), y + b[1] + (b[1] ? e : -e), z + b[2] + (b[2] ? e : -e)];
          solid.push(p1, p2);
          hidden.push(p1, p2);
        }
      }
    }
    return { solid, hidden };
  }

  function flatten(pts) {
    const v = [];
    for (const p of pts) v.push(p[0], p[1], p[2], 0, 0, 0, 1);
    return v;
  }

  // ---- 事件接入（对照 FTBUltimineClient / FTBUltimine 的 tick 与按键）----
  window.addEventListener('keydown', (e) => {
    const g = typeof game !== 'undefined' ? game : null;
    if (!g || g.state !== 'play' || g.ui.screen || g.net) return;
    if (isKeyDown(e, bound(g, 'ultimineHold', 'AltLeft'))) { state.pressed = true; e.preventDefault && e.preventDefault(); }
    if (e.repeat) return;
    if (bound(g, 'ultimineNext', 'ArrowUp') === e.code && (!CFG.requireKeyForCycling || state.pressed)) cycleShape(true, g);
    if (bound(g, 'ultiminePrev', 'ArrowDown') === e.code && (!CFG.requireKeyForCycling || state.pressed)) cycleShape(false, g);
  });
  window.addEventListener('keyup', (e) => {
    if (isKeyDown(e, 'AltLeft')) { state.pressed = false; clearCache(); }
  });
  window.addEventListener('blur', () => { state.pressed = false; clearCache(); });
  window.addEventListener('wheel', (e) => {
    const g = typeof game !== 'undefined' ? game : null;
    if (!g || !state.pressed || g.state !== 'play' || g.ui.screen) return;
    cycleShape(e.deltaY < 0 || e.deltaX < 0, g);
  }, { passive: true });

  // ---- 破坏 hook（FTBUltimine.handleBlockBreak）----
  // 延到所有脚本加载完再挂：js/mobile.js、tconstruct/bundle.js 等也在包 breakBlock，
  // 若在这里就挂，会被后面加载的脚本盖在里层（顺序虽仍生效，但易被其他模组误判/覆盖）。
  function installBreakHook() {
    const origBreak = Game.prototype.breakBlock;
    Game.prototype.breakBlock = function (x, y, z, natural, silent) {
      // FTB_ULTIMINE_BREAK_HOOK（探针/自检标记，勿删）
      // natural / 已在连锁中：交回原版，避免递归
      if (natural || this.__ftbUltimining || !state.pressed || !canUltimine(this))
        return origBreak.apply(this, arguments);
      // 内置 veinminer 若开着，让位给它，避免两套连锁互相打架
      if (this.settings && this.settings.veinOn) return origBreak.apply(this, arguments);
      const t = this.target;
      const face = t && t.face !== undefined ? t.face : 4;
      updateBlocks(this, [x, y, z], face);
      if (state.cachedBlocks.length < 2) { clearCache(); return origBreak.apply(this, arguments); }
      const did = breakBlocksInShape(this, [x, y, z]);
      if (did) { clearCache(); return true; }
      clearCache();
      return origBreak.apply(this, arguments);
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installBreakHook);
  else installBreakHook();

  // ---- 预览 hook（FTBUltimineClient.renderInGame）----
  const origDrawSelection = Game.prototype.drawSelection;
  Game.prototype.drawSelection = function (env) {
    origDrawSelection.call(this, env);
    if (!state.pressed || !canUltimine(this) || this.ui.hideHud || this.perspective === 2) return;
    const t = this.target;
    if (!t || !t.pos) return;
    const pos = t.pos.slice(), face = t.face !== undefined ? t.face : 4;
    if (!state.cachedPos || state.cachedPos.join(',') !== pos.join(',') || state.cachedDir !== face)
      updateBlocks(this, pos, face);
    const list = state.cachedBlocks.slice(0, CFG.renderOutline);
    if (list.length < 2) return;
    const { solid, hidden } = outlineEdges(list);
    const gl = this.renderer && this.renderer.gl;
    if (gl) gl.enable(gl.DEPTH_TEST);
    // 隐藏边：半透明（PREVIEW_LINE_ALPHA），先画
    if (this.renderer.drawLines)
      this.renderer.drawLines(flatten(hidden), [1, 1, 1, CFG.previewLineAlpha / 255 * 0.6]);
    // 外缘：白色实线
    if (this.renderer.drawLines) this.renderer.drawLines(flatten(solid), [1, 1, 1, 0.9]);
  };

  // ---- HUD 提示（FTBUltimineClient.addPressedInfo / shape menu）----
  if (typeof UI !== 'undefined' && UI.prototype.drawHUD) {
    const origHUD = UI.prototype.drawHUD;
    UI.prototype.drawHUD = function () {
      const r = origHUD.apply(this, arguments), g = this.game;
      if (g && state.pressed && g.state === 'play' && !this.screen && state.cachedBlocks.length > 1) {
        Font.center(this.ctx, currentShape().cn + ' · ' + state.cachedBlocks.length + ' 个方块',
          this.w / 2, this.h / 2 + 12, '#FFFFFF');
      }
      return r;
    };
  }

  // 算法级单测的出口（verify.js 用；正常游戏里 globalThis.__FTBU_TEST 不存在，无副作用）
  if (typeof globalThis !== 'undefined' && globalThis.__FTBU_TEST === true) {
    globalThis.__FTBU = {
      CFG, SHAPES, FACE_VEC, FACE_AXIS, NEIGHBORS_26, NEIGHBORS_PLANT,
      shapeless, smallTunnel, largeTunnel, diagonalTunnel, getBlocks,
      makeContext, determineMatcher, matchByBlock, matchByTagsShapeless,
      matchByTagsShaped, matchByCrop, ripe, outlineEdges, flatten,
      state, clearCache, currentShape, cycleShape, canUltimine, updateBlocks,
      inMergeGroup, isOre, isBaseStone, keyOf, d2,
    };
  }
})();
