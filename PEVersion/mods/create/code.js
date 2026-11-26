'use strict';
// ===========================================================================
// 机械动力（Create）网页移植版 · 玩法层
//
// 复刻的是 Create 的核心循环：转速(RPM) + 应力(SU)。
//   · 传动轴 / 齿轮 / 大齿轮 把相邻的动力学方块连成一张「网络」
//   · 网络里所有部件共享同一转速；动力源提供应力容量，机器消耗应力
//   · 需求 > 容量 → 超应力，机器停摆（和 Create 一样）
//
// 数值取自 Create mc1.20.1 源码（AllBlocks.java / CKinetics.java / HandCrankBlock.java）：
//   水车 8 RPM / 容量 32      风车轴承 16 RPM / 容量 512
//   手摇曲柄 32 RPM / 容量 8   创造马达 默认 16 RPM / 容量 16384
//   机械压机 8 SU   石磨 4 SU   动力锯 4 SU   机械搅拌器 4 SU
//   大型齿轮：转速 ×0.5、容量 ×2（每多一个大齿轮叠一次，最多叠 3 次）
//
// 网页端没有方块实体和贴图动画，所以机器改成「右键手持物品加工」，
// 而不是 Create 的传送带 / 漏斗自动化。
// ===========================================================================

OpusMC.code('create', (api) => {
  const BID = api.raw.BID, ITEM_KEY = api.raw.ITEM_KEY, BLOCKS = api.raw.BLOCKS, ITEMS = api.raw.ITEMS;

  // 护目镜在 Create 里是戴在头上的一件装备（curio），这里落到原版头盔栏。
  // 引擎没有护目镜的护甲层贴图，把 mat 改成一个不存在的名字，免得头上套个铁头盔。
  const GOG = ITEM_KEY['create_goggles'];
  if (GOG !== undefined && ITEMS[GOG] && ITEMS[GOG].armor) ITEMS[GOG].armor.mat = 'goggles';
  const inv = () => api.raw.game.player.inv;
  const wearingGoggles = () => {
    const i = inv(), s = i && i.slots ? i.slots[36] : null;
    return !!(s && s.id === GOG && s.count > 0);
  };

  const K = {
    shaft: 'create_shaft',
    cog: 'create_cogwheel',
    big: 'create_large_cogwheel',
    water: 'create_water_wheel',
    wind: 'create_windmill_bearing',
    crank: 'create_hand_crank',
    motor: 'create_creative_motor',
    press: 'create_mechanical_press',
    mill: 'create_millstone',
    saw: 'create_mechanical_saw',
    mix: 'create_mechanical_mixer',
    sail: 'create_white_sail'
  };

  // 参与动力网络的方块（机壳不算）
  const KIN = new Set([K.shaft, K.cog, K.big, K.water, K.wind, K.crank, K.motor, K.press, K.mill, K.saw, K.mix]);
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

  const SPEED = { [K.water]: 8, [K.wind]: 16, [K.crank]: 32 };
  const CAP = { [K.water]: 32, [K.wind]: 512, [K.crank]: 8, [K.motor]: 16384 };
  const IMPACT = { [K.press]: 8, [K.mill]: 4, [K.saw]: 4, [K.mix]: 4 };
  const MIN_RPM = 4;

  const CN = (k) => {
    const b = BLOCKS[BID[k]];
    if (b && b.cn) return b.cn;
    const it = api.raw.ITEMS[ITEM_KEY[k]];
    return (it && it.cn) || k;
  };
  const shortKey = (k) => String(k || '').replace(/^minecraft:/, '');

  // -------------------------------------------------------------------------
  // 网络求解：从任意一个动力学方块出发做广度优先，找同一网络的动力源与机器
  // -------------------------------------------------------------------------
  const isWater = (k) => k === 'water' || k === 'flowing_water' || k === 'still_water';

  function sourceOf(x, y, z, key) {
    if (key === K.water) {
      for (const d of DIRS) if (isWater(api.world.getBlock(x + d[0], y + d[1], z + d[2]))) return { rpm: SPEED[key], cap: CAP[key] };
      return null;
    }
    if (key === K.wind) {
      // 原版风车轴承要把帆装在它的转子上：上方 3×3×8 范围里至少 3 张风帆才当动力源
      let sails = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let i = 1; i <= 8; i++) if (api.world.getBlock(x + dx, y + i, z + dz) === K.sail) sails++;
        }
      }
      return sails >= 3 ? { rpm: SPEED[key], cap: CAP[key] } : null;
    }
    if (key === K.crank) {
      // 原版曲柄要装在传动轴（或齿轮）上，摇动才带动网络；孤立放着不出力
      let linked = false;
      for (const d of DIRS) if (KIN.has(api.world.getBlock(x + d[0], y + d[1], z + d[2]))) { linked = true; break; }
      if (!linked) return null;
      const until = api.store['c:' + x + ',' + y + ',' + z] || 0;
      return until > Date.now() ? { rpm: SPEED[key], cap: CAP[key] } : null;
    }
    if (key === K.motor) {
      const rpm = api.store['m:' + x + ',' + y + ',' + z] || 16;
      return { rpm: Math.max(1, Math.min(256, +rpm || 16)), cap: CAP[key] };
    }
    return null;
  }

  let cache = { key: '', tick: -999, net: null };

  function solve(x0, y0, z0) {
    const seen = new Set(), nodes = [];
    const q = [[x0, y0, z0]];
    while (q.length && nodes.length < 600) {
      const [x, y, z] = q.shift();
      const id = x + ',' + y + ',' + z;
      if (seen.has(id)) continue;
      seen.add(id);
      const b = api.world.getBlock(x, y, z);
      if (!KIN.has(b)) continue;
      nodes.push({ x, y, z, b });
      for (const d of DIRS) {
        const n = (x + d[0]) + ',' + (y + d[1]) + ',' + (z + d[2]);
        if (!seen.has(n)) q.push([x + d[0], y + d[1], z + d[2]]);
      }
    }
    let rpm = 0, cap = 0, demand = 0, sources = 0, big = 0;
    for (const n of nodes) {
      const s = sourceOf(n.x, n.y, n.z, n.b);
      if (s) { sources++; rpm = Math.max(rpm, s.rpm); cap += s.cap; }
      if (IMPACT[n.b]) demand += IMPACT[n.b];
      if (n.b === K.big) big++;
    }
    if (big) {
      const stack = Math.min(big, 3);
      rpm *= Math.pow(0.5, stack);
      cap *= Math.pow(2, stack);
    }
    rpm = Math.round(rpm * 10) / 10;
    return { rpm, cap, demand, over: demand > cap, sources, nodes: nodes.length, big, x: x0, y: y0, z: z0 };
  }

  function netAt(x, y, z, fresh) {
    const g = api.raw.game, key = x + ',' + y + ',' + z, now = g.tickCount | 0;
    if (!fresh && cache.key === key && now - cache.tick < 20 && cache.net) return cache.net;
    cache = { key, tick: now, net: solve(x, y, z) };
    return cache.net;
  }

  // 右键机器前的统一检查
  function drive(x, y, z, name) {
    const net = netAt(x, y, z, true);
    if (!net.sources) { api.message(name + '：这一网没有动力（水车要挨着水、风车轴承要装风帆、曲柄要接传动轴再摇）', '#FFAA55'); return null; }
    if (net.over) { api.message(name + '：超应力！需求 ' + net.demand + ' SU，容量只有 ' + net.cap + ' SU', '#FF5555'); return null; }
    if (net.rpm < MIN_RPM) { api.message(name + '：转速只有 ' + net.rpm + ' RPM，带不动', '#FFAA55'); return null; }
    return net;
  }

  function cooldown(x, y, z, ms) {
    const k = 't:' + x + ',' + y + ',' + z, now = Date.now(), s = api.store;
    if (s[k] && now - s[k] < ms) return true;
    s[k] = now;
    return false;
  }

  // -------------------------------------------------------------------------
  // 机器
  // -------------------------------------------------------------------------
  const PRESS = {
    iron_ingot: 'create_iron_sheet',
    copper_ingot: 'create_copper_sheet',
    gold_ingot: 'create_golden_sheet',
    create_brass_ingot: 'create_brass_sheet'
  };
  const MILL = { wheat: 'create_wheat_flour' };
  const MIX = [
    { hold: 'andesite', other: 'iron_nugget', out: 'create_andesite_alloy', n: 1, label: '安山岩 + 铁粒' },
    { hold: 'copper_ingot', other: 'create_zinc_ingot', out: 'create_brass_ingot', n: 2, label: '铜锭 + 锌锭' },
    { hold: 'create_zinc_ingot', other: 'copper_ingot', out: 'create_brass_ingot', n: 2, label: '锌锭 + 铜锭' }
  ];

  api.onUseBlock(K.press, (ev) => {
    ev.cancel();
    if (!drive(ev.x, ev.y, ev.z, '机械压机')) return;
    const held = api.player.held;
    if (!held) return api.message('机械压机：手里拿金属锭再右键（铁 / 铜 / 金 / 黄铜）', '#AAAAAA');
    const out = PRESS[held.item];
    if (!out) return api.message('机械压机：压不了「' + CN(held.item) + '」', '#FFAA55');
    if (cooldown(ev.x, ev.y, ev.z, 700)) return;
    api.player.consumeHeld(1);
    api.player.give(out, 1);
    api.world.sound('minecraft:block.anvil.land', ev.x + 0.5, ev.y + 0.6, ev.z + 0.5, 0.9, 1.25);
    api.world.particle('minecraft:crit', ev.x + 0.5, ev.y + 1.1, ev.z + 0.5, 6);
    api.message('机械压机：' + CN(held.item) + ' → ' + CN(out), '#7FD8FF');
  });

  api.onUseBlock(K.mill, (ev) => {
    ev.cancel();
    if (!drive(ev.x, ev.y, ev.z, '石磨')) return;
    const held = api.player.held;
    if (!held) return api.message('石磨：手里拿小麦再右键', '#AAAAAA');
    const out = MILL[held.item];
    if (!out) return api.message('石磨：磨不了「' + CN(held.item) + '」', '#FFAA55');
    if (cooldown(ev.x, ev.y, ev.z, 800)) return;
    api.player.consumeHeld(1);
    api.player.give(out, 1);
    api.world.sound('minecraft:block.grindstone.use', ev.x + 0.5, ev.y + 1, ev.z + 0.5, 0.8, 1);
    api.world.particle('minecraft:crit', ev.x + 0.5, ev.y + 1.1, ev.z + 0.5, 5);
    api.message('石磨：小麦 → 面粉', '#E8D8A0');
  });

  api.onUseBlock(K.saw, (ev) => {
    ev.cancel();
    if (!drive(ev.x, ev.y, ev.z, '动力锯')) return;
    const held = api.player.held;
    if (!held) return api.message('动力锯：手里拿原木再右键', '#AAAAAA');
    let out = null;
    if (/_log$/.test(held.item)) {
      const p = held.item.replace(/_log$/, '_planks');
      if (ITEM_KEY[p] !== undefined) out = p;
    }
    if (!out) return api.message('动力锯：锯不了「' + CN(held.item) + '」', '#FFAA55');
    if (cooldown(ev.x, ev.y, ev.z, 600)) return;
    api.player.consumeHeld(1);
    api.player.give(out, 6);
    api.world.sound('minecraft:block.wood.break', ev.x + 0.5, ev.y + 1, ev.z + 0.5, 0.9, 1.1);
    api.world.particle('minecraft:crit', ev.x + 0.5, ev.y + 1.05, ev.z + 0.5, 8);
    api.message('动力锯：' + CN(held.item) + ' → 6 × ' + CN(out), '#C8E6A0');
  });

  api.onUseBlock(K.mix, (ev) => {
    ev.cancel();
    if (!drive(ev.x, ev.y, ev.z, '机械搅拌器')) return;
    const held = api.player.held;
    if (!held) return api.message('机械搅拌器：手里拿主料再右键（安山岩 / 铜锭 / 锌锭）', '#AAAAAA');
    const r = MIX.find((m) => m.hold === held.item && api.player.count(m.other) > 0);
    if (!r) {
      const need = MIX.filter((m) => m.hold === held.item).map((m) => CN(m.other));
      return api.message('机械搅拌器：' + CN(held.item) + (need.length ? ' 还要背包里有 ' + need.join(' / ') : ' 不是可混合的主料'), '#FFAA55');
    }
    if (cooldown(ev.x, ev.y, ev.z, 900)) return;
    if (!api.player.take(r.other, 1)) return;
    api.player.consumeHeld(1);
    api.player.give(r.out, r.n);
    api.world.sound('minecraft:block.brewing_stand.brew', ev.x + 0.5, ev.y + 1, ev.z + 0.5, 0.7, 0.9);
    api.world.particle('minecraft:crit', ev.x + 0.5, ev.y + 1.0, ev.z + 0.5, 10);
    api.message('机械搅拌器：' + r.label + ' → ' + r.n + ' × ' + CN(r.out), '#D8B0FF');
  });

  // 手摇曲柄：接在传动件上才出力；摇一次带动网络 5 秒
  api.onUseBlock(K.crank, (ev) => {
    ev.cancel();
    let linked = false;
    for (const d of DIRS) if (KIN.has(api.world.getBlock(ev.x + d[0], ev.y + d[1], ev.z + d[2]))) { linked = true; break; }
    if (!linked) {
      api.message('手摇曲柄：没接上传动轴（相邻放一根传动轴或齿轮，再摇）', '#FF7777');
      return;
    }
    api.store['c:' + ev.x + ',' + ev.y + ',' + ev.z] = Date.now() + 5000;
    netAt(ev.x, ev.y, ev.z, true);
    api.world.sound('minecraft:block.lever.click', ev.x + 0.5, ev.y + 0.5, ev.z + 0.5, 0.7, 1.1);
    api.message('手摇曲柄：转起来了，32 RPM，持续 5 秒', '#FFE28A');
  });

  // -------------------------------------------------------------------------
  // 工程师护目镜：右键戴上 / 摘下（头盔栏），戴着看向动力学方块显示转速 / 应力
  // -------------------------------------------------------------------------
  api.onUseItem('create_goggles', () => {
    if (GOG === undefined) return;
    const i = inv(), slot = i.slots[36];
    if (slot && slot.id === GOG) {                    // 已戴着 → 摘下
      i.slots[36] = null;
      api.player.give('create_goggles', 1);
      api.message('摘下工程师护目镜', '#AAAAAA');
      return;
    }
    if (slot) return api.message('头盔栏已经有东西了，先摘下来', '#FFAA55');
    const held = i.held;
    if (!held || held.id !== GOG) return;
    i.slots[36] = { id: GOG, count: 1 };             // 戴到头上
    held.count -= 1;
    if (held.count <= 0) i.slots[i.sel] = null;
    api.message('戴上工程师护目镜：看向传动件显示转速与应力', '#7FD8FF');
  });

  api.on('hud', (h) => {
    if (!wearingGoggles()) return;
    const t = api.player.target;
    if (!t || !KIN.has(t.block)) return;
    const net = netAt(t.x, t.y, t.z);
    const w = h.width, ctx = h.ctx;
    const lines = [
      '机械动力 · ' + CN(t.block),
      '转速 ' + net.rpm + ' RPM' + (net.big ? '（大齿轮 ×' + net.big + '）' : ''),
      '应力 ' + Math.round(net.demand) + ' / ' + Math.round(net.cap) + ' SU',
      !net.sources ? '无动力' : net.over ? '超应力 · 机器停摆' : '运转中'
    ];
    const pad = 6, lineH = 11, bw = 150, bh = pad * 2 + lines.length * lineH;
    const x = 10, y = Math.max(20, Math.min(h.height - bh - 60, Math.floor(h.height / 2 - bh / 2)));
    ctx.fillStyle = 'rgba(12,16,22,0.78)';
    ctx.fillRect(x, y, bw, bh);
    ctx.strokeStyle = net.over ? '#FF5555' : '#C9A227';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
    const cols = ['#C9A227', '#FFFFFF', net.over ? '#FF5555' : '#B8E986', net.over ? '#FF5555' : '#8AD8FF'];
    lines.forEach((s, i) => h.text(s, x + pad, y + pad + i * lineH, cols[i]));
  });

  // -------------------------------------------------------------------------
  // 命令：/create
  // -------------------------------------------------------------------------
  const argv = (args) => {
    if (Array.isArray(args)) return args.map((s) => String(s));
    const s = String(args == null ? '' : args).trim();
    return s ? s.split(/\s+/) : [];
  };

  function lookNet() {
    const t = api.player.target;
    if (!t || !KIN.has(t.block)) { api.message('看着一个传动件 / 机器再用（传动轴、齿轮、水车…）', '#FFAA55'); return null; }
    return netAt(t.x, t.y, t.z, true);
  }

  function report() {
    const net = lookNet();
    if (!net) return;
    const t = api.player.target;
    api.message('—— ' + CN(t.block) + ' 所在的网络 ——', '#C9A227');
    api.message('方块数 ' + net.nodes + '，动力源 ' + net.sources + '，转速 ' + net.rpm + ' RPM', '#FFFFFF');
    api.message('应力 ' + Math.round(net.demand) + ' / ' + Math.round(net.cap) + ' SU' + (net.over ? '（超应力）' : '（余量 ' + Math.round(net.cap - net.demand) + '）'), net.over ? '#FF5555' : '#B8E986');
    if (!net.sources) api.message('没有动力源：水车需要 6 面中有水；风车轴承上方 3×3×8 范围要有 3 张白色风帆；曲柄要贴着传动轴右键摇 5 秒。', '#AAAAAA');
  }

  function clearDemo() {
    const s = api.store, list = s.demo || [];
    if (!list.length) return api.message('没有需要清除的演示方块', '#AAAAAA');
    let n = 0;
    for (const [x, y, z] of list) {
      const k = api.world.getBlock(x, y, z);
      if (k && k.indexOf('create_') === 0) { api.world.setBlock(x, y, z, 'air'); n++; }
    }
    s.demo = [];
    api.message('已清除演示装配（' + n + ' 个方块；水没有动，需要自己收）', '#AAAAAA');
  }

  function demo() {
    const p = api.player;
    let dx = -Math.sin(p.yaw), dz = Math.cos(p.yaw);
    if (Math.abs(dx) >= Math.abs(dz)) { dz = 0; dx = dx >= 0 ? 1 : -1; } else { dx = 0; dz = dz >= 0 ? 1 : -1; }
    const sx = dz, sz = -dx;                       // 侧向
    const x0 = Math.floor(p.x) + dx * 3, z0 = Math.floor(p.z) + dz * 3;
    let gy = Math.floor(p.y) + 2;
    for (let i = 0; i < 60 && gy > -60; i++) {
      if (api.world.getBlock(x0, gy, z0) !== 'air') break;
      gy--;
    }
    const y0 = gy + 1;
    const at = (t, s) => [x0 + dx * t + sx * s, y0, z0 + dz * t + sz * s];
    const plan = [
      { p: at(0, 0), b: K.water },
      { p: at(1, 0), b: K.shaft },
      { p: at(2, 0), b: K.shaft },
      { p: at(3, 0), b: K.cog },
      { p: at(4, 0), b: K.press },
      { p: at(0, 1), b: 'water' },
      { p: at(0, -1), b: 'water' }
    ];
    for (const it of plan) {
      const cur = api.world.getBlock(it.p[0], it.p[1], it.p[2]);
      if (cur !== 'air' && !/water/.test(cur) && cur !== 'grass' && cur !== 'short_grass' && cur !== 'tall_grass') {
        api.message('前方空间不够（' + CN(cur) + ' 挡住了），换个地方再试', '#FF5555');
        return;
      }
    }
    for (const it of plan) api.world.setBlock(it.p[0], it.p[1], it.p[2], it.b);
    api.store.demo = plan.filter((it) => it.b.indexOf('create_') === 0).map((it) => it.p);
    api.message('演示装配完成：水车 → 传动轴 → 传动轴 → 齿轮 → 机械压机', '#7FD8FF');
    api.message('手里拿铁锭右键压机；想看转速就拿着护目镜右键戴上', '#AAAAAA');
  }

  function setMotor(rpm) {
    const p = api.player, r = 8;
    let best = null;
    for (let x = Math.floor(p.x) - r; x <= Math.floor(p.x) + r && !best; x++) {
      for (let y = Math.floor(p.y) - r; y <= Math.floor(p.y) + r && !best; y++) {
        for (let z = Math.floor(p.z) - r; z <= Math.floor(p.z) + r && !best; z++) {
          if (api.world.getBlock(x, y, z) === K.motor) best = [x, y, z];
        }
      }
    }
    if (!best) return api.message('周围 8 格内没有创造马达', '#FFAA55');
    api.store['m:' + best.join(',')] = Math.max(1, Math.min(256, rpm | 0));
    netAt(best[0], best[1], best[2], true);
    api.message('创造马达转速设为 ' + Math.max(1, Math.min(256, rpm | 0)) + ' RPM', '#7FD8FF');
  }

  api.command('create', {
    usage: '/create <info|demo|clear|motor <rpm>|help>',
    description: '[机械动力] 网络信息、演示装配、清除演示、马达转速',
    suggest: ['info', 'demo', 'clear', 'motor', 'help']
  }, (args) => {
    const a = argv(args), sub = (a[0] || 'help').toLowerCase();
    if (sub === 'info' || sub === 'i') return report();
    if (sub === 'demo' || sub === 'd') return demo();
    if (sub === 'clear' || sub === 'c') return clearDemo();
    if (sub === 'motor' || sub === 'm') {
      const n = parseInt(a[1], 10);
      if (!isFinite(n)) return api.message('用法：/create motor <1-256>', '#FFAA55');
      return setMotor(n);
    }
    api.menu({
      title: '机械动力 · 手册',
      lines: [
        '让传动件连成一网，动力源才带得动机器。',
        '水车：6 面挨着水 → 8 RPM / 32 SU',
        '风车轴承：上方装 3 张以上白色风帆 → 16 RPM / 512 SU',
        '手摇曲柄：右键摇 5 秒 → 32 RPM / 8 SU',
        '创造马达：默认 16 RPM，/create motor 改',
        '大齿轮：转速 ×0.5，容量 ×2（最多叠 3 次）',
        '压机 8 SU · 石磨 4 · 动力锯 4 · 搅拌器 4',
        '需求 > 容量 = 超应力，机器停摆'
      ],
      buttons: [
        { label: '装配演示（水车→轴→齿轮→压机）', onClick: () => { api.closeMenu(); setTimeout(() => demo(), 60); } },
        { label: '查看准星所指的网络', onClick: () => { api.closeMenu(); setTimeout(() => report(), 60); } }
      ]
    });
  });
});
