'use strict';
// PEVersion 内置客户端 HUD —— 由 opusmc-hud.user.js 转制（tools/integrate_hud.py 生成，勿手改）。
// 去掉了 UserScript 元数据头；unsafeWindow 在普通网页里自动兜底为 window。
(function () {
  'use strict';

  // Tampermonkey 沙箱里的 window 是代理，必须拿页面真身才能摸到游戏挂的全局对象
  const W = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

  // 同一页面被重复注入（脚本装了两份 / 多层 match）时只保留第一份
  if (W.__cometInstalled) {
    console.log('[Comet] 本页面已有实例，跳过重复注入');
    return;
  }
  W.__cometInstalled = true;

  const VERSION = '1.32.0';
  const REF_POLL_MS = 800;
  const REF_POLL_MAX_TRIES = 375;

  // ---------- 来源伪装：作者服务器（honghemc.cn）的账号/公告/房间 API 只认 B 站 Toy 域页面 ----------
  function installOriginSpoof() {
    try {
      if (typeof GM_xmlhttpRequest !== 'function') return;
      const origFetch = W.fetch ? W.fetch.bind(W) : null;
      W.fetch = function (url, opts) {
        const u = String(url);
        if (u.indexOf('honghemc.cn') === -1) {
          return origFetch ? origFetch(url, opts) : fetch(url, opts);
        }
        opts = opts || {};
        return new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: opts.method || 'GET',
            url: u,
            data: opts.body,
            headers: { Origin: 'https://www.bilibili.com', Referer: 'https://www.bilibili.com/' },
            timeout: 20000,
            onload: (r) => resolve({
              ok: r.status >= 200 && r.status < 300,
              status: r.status,
              text: () => Promise.resolve(r.responseText),
              json: () => Promise.resolve(JSON.parse(r.responseText)),
            }),
            onerror: () => reject(new TypeError('fetch failed')),
            ontimeout: () => reject(new TypeError('timeout')),
          });
        });
      };
      console.log('[Comet] 来源伪装已启用');
    } catch (err) { /* noop */ }
  }

  // ---------- 账号同步：线上版（B站域）登录态自动搬到离线版（localhost）----------
  // AI 伙伴/联机/云存档都要登录；离线版没有 B 站一键登录，识别码又常失效。
  // 线上版页面加载时把 localStorage 的登录态存进油猴跨域存储，离线版没登录时自动恢复。
  function installAccountSync() {
    try {
      const KEY = 'mcjs-account';
      const h = location.hostname;
      const onBili = /(^|\.)bilibili(com|toy)\.com$/.test(h);
      const onLocal = /^(localhost|127\.|\[::1\])|\.(localhost|test)$/.test(h);
      if (onBili && typeof GM_setValue === 'function') {
        const acc = W.localStorage.getItem(KEY);
        if (acc && acc.indexOf('"token":"') !== -1) GM_setValue('cometAccountSync', acc);
      } else if (onLocal) {
        const cur = W.localStorage.getItem(KEY);
        const hasToken = cur && cur.indexOf('"token":"') !== -1;
        if (!hasToken && typeof GM_getValue === 'function') {
          const sync = GM_getValue('cometAccountSync');
          if (sync && sync.indexOf('"token":"') !== -1) {
            W.localStorage.setItem(KEY, sync);
            console.log('[Comet] 已从线上版同步登录态（AI 伙伴 / 联机可用）');
          }
        }
      }
    } catch (err) { console.warn('[Comet] 账号同步失败', err); }
  }

  const state = { game: null, player: null, flavor: '', mpSeen: false, editHud: false };

  // ---------- 配置 ----------
  const CFG_KEY = '__cometCfg';
  const OLD_KEY = '__opusHudCfg';
  const stored = (() => { try { return JSON.parse(W.localStorage.getItem(CFG_KEY) || '{}'); } catch (e) { return {}; } })();
  const oldCfg = (() => { try { return JSON.parse(W.localStorage.getItem(OLD_KEY) || 'null'); } catch (e) { return null; } })();

  const cfg = {
    states: stored.states || {},
    settings: stored.settings || {},
    binds: stored.binds || {},
    favorites: stored.favorites || {},
    hudPos: stored.hudPos || {},
    guiOffset: stored.guiOffset || { x: 0, y: 0 },
    theme: stored.theme === 'glass' ? 'glass' : 'default',
    servers: stored.servers || [{ name: '官方', url: 'https://xz.honghemc.cn:8443' }],
    serverIdx: stored.serverIdx || 0,
    mcAddr: stored.mcAddr || 'ws://localhost:25565',
    mcName: stored.mcName || 'WebPlayer',
    floatPos: stored.floatPos || {},
    guiKey: stored.guiKey || 'Backquote',
    waypoints: Array.isArray(stored.waypoints) ? stored.waypoints : [],
    minmapPos: stored.minmapPos || { x: 16, y: 16 },
    invPos: stored.invPos || { x: 16, y: 16 },
    dropsPos: stored.dropsPos || { x: 16, y: 210 },
    musicPos: stored.musicPos || { x: 16, y: 16 },
    appearance: stored.appearance || {},
    ext: stored.ext || { coords: [], profiles: {}, macros: [], stats: null },
  };

  function saveCfg() {
    try { W.localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* 内存态兜底 */ }
  }

  // ---------- 工具 ----------
  function num(o, ...keys) {
    if (!o) return null;
    for (const k of keys) {
      try {
        const v = o[k];
        if (typeof v === 'number' && isFinite(v)) return v;
      } catch (e) { /* getter 可能抛 */ }
    }
    return null;
  }

  function vec3(o, ...keys) {
    if (!o) return null;
    for (const k of keys) {
      try {
        const v = o[k];
        if (Array.isArray(v) && typeof v[0] === 'number' && typeof v[2] === 'number') return v;
      } catch (e) { /* noop */ }
    }
    return null;
  }

  // OpusMC: p.pos=[x,y,z] yaw 弧度 | OpusCraft: p.x/y/z yaw 度数
  function readPos(p) {
    const pos = vec3(p, 'pos', 'position');
    const vel = vec3(p, 'vel', 'velocity');
    const yaw = num(p, 'yaw', 'rotationY', 'rotation');
    return {
      x: pos ? pos[0] : num(p, 'x'),
      y: pos ? pos[1] : num(p, 'y'),
      z: pos ? pos[2] : num(p, 'z'),
      vx: vel ? vel[0] : num(p, 'dx', 'vx'),
      vy: vel ? vel[1] : num(p, 'dy', 'vy'),
      vz: vel ? vel[2] : num(p, 'dz', 'vz'),
      yaw,
      pitch: num(p, 'pitch', 'rotationX'),
      health: num(p, 'health', 'hp'),
      food: num(p, 'food', 'hunger'),
      fps: num(state.game, 'fps'),
    };
  }

  function yawDeg(yaw) {
    if (yaw == null) return null;
    return Math.abs(yaw) <= 7 ? yaw * 180 / Math.PI : yaw;
  }
  function yawRad(yaw) {
    if (yaw == null) return 0;
    return Math.abs(yaw) <= 7 ? yaw : yaw * Math.PI / 180;
  }

  const CN_NAMES = {
    ZombieKind: '僵尸', SkeletonKind: '骷髅', CaveSpider: '洞穴蜘蛛', Crawler: '蠹虫',
    Slime: '史莱姆', SulfurCube: '硫磺方块', Phantom: '幻翼', Witch: '女巫',
    Pillager: '掠夺者', Vindicator: '卫道士', Evoker: '唤魔者', Vex: '恼鬼',
    Ravager: '劫掠兽', Breeze: '旋风人', Creaking: '嘎枝', Warden: '监守者',
    Shulker: '潜影贝', Zoglin: '僵尸疣猪兽', Wither: '凋灵', EnderDragon: '末影龙',
    Blaze: '烈焰人', Ghast: '恶魂', MagmaCube: '岩浆怪', Piglin: '猪灵',
    Hoglin: '疣猪兽', ZombifiedPiglin: '僵尸猪灵', Enderman: '末影人',
    Guardian: '守卫者', Drowned: '溺尸', SnowGolem: '雪傀儡',
    Allay: '悦灵', Armadillo: '犰狳', Axolotl: '美西螈', Bat: '蝙蝠', Bee: '蜜蜂',
    Camel: '骆驼', Cat: '猫', Cod: '鳕鱼', Dolphin: '海豚', Fox: '狐狸', Frog: '青蛙',
    Goat: '山羊', HappyGhast: '快乐恶魂', Horse: '马', Llama: '羊驼', Mooshroom: '哞菇',
    Ocelot: '豹猫', Panda: '熊猫', Parrot: '鹦鹉', PolarBear: '北极熊', Pufferfish: '河豚',
    Rabbit: '兔子', Salmon: '鲑鱼', Sniffer: '嗅探兽', Squid: '鱿鱼', Strider: '炽足兽',
    Tadpole: '蝌蚪', TropicalFish: '热带鱼', Turtle: '海龟', Wolf: '狼', Villager: '村民',
    WanderingTrader: '流浪商人', Nautilus: '鹦鹉螺',
    ItemEntity: '掉落物', Arrow: '箭', ExperienceOrb: '经验球', Fireball: '火球',
    ThrownPearl: '末影珍珠', PrimedTNT: '点燃的TNT', WitherSkull: '凋灵之首',
    ShulkerBullet: '潜影弹', DragonFireball: '龙息火球', EyeOfEnder: '末影之眼',
    FallingBlock: '掉落方块', EvokerFangs: '唤魔者尖牙', AreaCloud: '药水云',
  };
  // 物品 id -> 中文名（游戏里的 ITEMS 是 const 词法变量，window 上取不到；
  // 但数据表 self.BLOCK_DATA / self.ITEM_DATA 挂在 window 上，可直接建索引）
  const __itemNames = {};
  let __itemNamesReady = false;
  function buildItemNames() {
    if (__itemNamesReady) return;
    __itemNamesReady = true;
    try {
      for (const src of [W.BLOCK_DATA, W.ITEM_DATA]) {
        if (!Array.isArray(src)) continue;
        for (const d of src) {
          if (!d || typeof d.id === 'undefined') continue;
          const nm = d.cn || d.key;
          if (nm) __itemNames[d.id] = nm;
        }
      }
    } catch (err) { /* noop */ }
  }
  function itemName(id) {
    if (typeof id === 'undefined' || id === null) return null;
    // 游戏里的 itemDef(id) 是顶层函数声明，挂在 window 上，能覆盖所有运行时分配的 id
    // （工具 / 木棍等不在 ITEM_DATA 固定 id 表里的物品，只能这样拿到名字）
    try {
      const fn = W.itemDef;
      if (typeof fn === 'function') {
        const d = fn(id);
        const nm = d && (d.cn || d.name || d.key);
        if (nm) return nm;
      }
    } catch (err) { /* noop */ }
    try {
      const it = W.ITEMS && W.ITEMS[id];
      if (it && (it.cn || it.name || it.key)) return it.cn || it.name || it.key;
    } catch (err) { /* noop */ }
    buildItemNames();
    return __itemNames[id] || null;
  }

  function cnName(e) {
    try {
      // 联机玩家：NetPlayer 上有服务器下发的真实 ID
      if (e && e.type === 'player' && typeof e.name === 'string' && e.name && e.name !== '?') return e.name;
      // 掉落物显示实际物品名（圆石 / 木头 …），而不是类名 ItemEntity
      if (e && e.stack && typeof e.stack.id !== 'undefined') {
        const nm = itemName(e.stack.id);
        const cnt = typeof e.stack.count === 'number' ? e.stack.count : e.stack.n;
        if (nm) return (typeof cnt === 'number' && cnt > 1 ? nm + ' ×' + cnt : nm);
      }
      const T = e.T || (e.type && W.ENTITY_DATA && W.ENTITY_DATA.types ? W.ENTITY_DATA.types[e.type] : null);
      let n = (T && T.cn) || e.type || null;
      // 没有 type / 中文名时退回类名，但类名也要过一遍中文表（经验球 / 箭 …）
      if (!n) n = (e.constructor && e.constructor.name) || '?';
      if (e.baby) n = '幼年' + n;
      return CN_NAMES[n] || n;
    } catch (err) {
      return (e.constructor && e.constructor.name) || '?';
    }
  }

  const PROJ = new Set(['Arrow', 'Fireball', 'ThrownPearl', 'WitherSkull', 'ShulkerBullet',
    'DragonFireball', 'EyeOfEnder', 'MobShot', 'PrimedTNT', 'EvokerFangs']);
  function itemKindOf(e) {
    const n = (e && e.constructor && e.constructor.name) || '';
    if (n === 'ItemEntity' || (e && e.stack != null && e.health == null && e.maxHealth == null)) return '#ffd54f';
    if (n === 'ExperienceOrb' || (e && e.xp != null && e.health == null)) return '#69f0ae';
    if (PROJ.has(n)) return '#ff8a65';
    if (n === 'FallingBlock' || n === 'AreaCloud') return '#b0bec5';
    return null;
  }

  function looksLikePlayer(o) {
    try {
      if (!o || typeof o !== 'object') return false;
      if (typeof o.yaw !== 'number' && typeof o.rotationY !== 'number') return false;
      if (typeof o.x === 'number' && typeof o.y === 'number' && typeof o.z === 'number') return true;
      return Array.isArray(o.pos) && typeof o.pos[0] === 'number';
    } catch (e) { return false; }
  }

  // ---------- 分类与模块注册表（彗星 ClickGUI 数据源） ----------
  const CATS = [
    { id: 'combat', name: '战斗', icon: '⚔' },
    { id: 'movement', name: '移动', icon: '➤' },
    { id: 'render', name: '渲染', icon: '◈' },
    { id: 'player', name: '玩家', icon: '☺' },
    { id: 'misc', name: '工具', icon: '⚙' },
    { id: 'configs', name: '配置', icon: '⛭', extra: true },
  ];

  const MODULES = [
    {
      id: 'aura', name: 'Aura', cn: '光环', cat: 'combat', desc: '自动攻击范围内的敌对目标',
      settings: [
        { id: 'range', name: 'Range', cn: '范围', type: 'slider', min: 2, max: 6, step: 0.1, value: 4.5 },
        { id: 'strength', name: 'Strength', cn: '强度', type: 'slider', min: 0.3, max: 1, step: 0.05, value: 0.9 },
        { id: 'players', name: 'Players', cn: '玩家', type: 'checkbox', value: true, desc: '默认目标包含玩家' },
        {
          id: 'targets', name: 'Targets', cn: '攻击生物', type: 'multi', value: [],
          desc: '留空 = 默认（敌对生物 + 玩家）',
          options: [
            '玩家', '僵尸', '骷髅', '苦力怕', '蜘蛛', '末影人', '女巫', '史莱姆',
            '烈焰人', '恶魂', '猪灵', '疣猪兽', '溺尸', '守卫者', '幻翼', '劫掠兽',
            '监守者', '凋灵', '牛', '猪', '羊', '鸡', '村民',
          ],
        },
        { id: 'rotate', name: 'Rotate', cn: '旋转', type: 'checkbox', value: false, desc: '攻击时朝向目标' },
        { id: 'ring', name: 'Range Ring', cn: '脚下范围圈', type: 'checkbox', value: true, desc: '在脚底画与攻击半径等大的光环，代表光环已开启' },
        { id: 'ringColor', name: 'Ring Color', cn: '光环颜色', type: 'color', value: '', desc: '留空 = 彗星紫；彩虹模式下作为起始色相' },
        { id: 'ringMode', name: 'Ring FX', cn: '光环动效', type: 'select', value: '极光',
          desc: '几何图案自带旋转 / 脉冲 / 顶点发光',
          options: ['极光', '彩虹', '脉冲', '旋转', '波浪', '粒子', '双层', '音乐律动',
            '五芒星', '六芒星', '三角阵', '菱形', '六边形', '花瓣', '齿轮', '螺旋', '星轨'] },
        { id: 'ringSpeed', name: 'FX Speed', cn: '动效速度', type: 'slider', min: 0.2, max: 3, step: 0.1, value: 1 },
        { id: 'ringWidth', name: 'Line Width', cn: '线条粗细', type: 'slider', min: 1, max: 8, step: 0.5, value: 2.5 },
        { id: 'ringLayers', name: 'Layers', cn: '圈层数', type: 'slider', min: 1, max: 4, step: 1, value: 2 },
        { id: 'ringGlow', name: 'Glow', cn: '辉光强度', type: 'slider', min: 0, max: 30, step: 1, value: 14 },
        { id: 'ringFill', name: 'Fill', cn: '填充强度', type: 'slider', min: 0, max: 40, step: 2, value: 12 },
        { id: 'ringRainbow', name: 'Rainbow', cn: '彩虹渐变', type: 'checkbox', value: true },
        { id: 'ringParticles', name: 'Particles', cn: '环绕粒子', type: 'checkbox', value: true },
        { id: 'fxBars', name: 'Spectrum Bars', cn: '环形频谱柱', type: 'checkbox', value: true },
        { id: 'fxBlur', name: 'Motion Blur', cn: '动态模糊', type: 'slider', min: 0, max: 12, step: 0.5, value: 3 },
        { id: 'fxTrail', name: 'Afterimage', cn: '拖影长度', type: 'slider', min: 0, max: 90, step: 5, value: 55 },
      ],
    },
    {
      id: 'multiaura', name: 'MultiAura', cn: '千手观音', cat: 'combat', desc: '千手观音：一次挥击同时打中范围内多个生物（复用光环的“攻击生物”筛选）',
      settings: [
        { id: 'range', name: 'Range', cn: '范围', type: 'slider', min: 2, max: 6, step: 0.1, value: 4.5 },
        { id: 'strength', name: 'Strength', cn: '强度', type: 'slider', min: 0.3, max: 1, step: 0.05, value: 0.9 },
        { id: 'max', name: 'Max Targets', cn: '最多目标', type: 'slider', min: 1, max: 8, step: 1, value: 3 },
      ],
    },
    {
      id: 'triggerbot', name: 'TriggerBot', cn: '触发机器人', cat: 'combat', desc: '准星指向目标时自动攻击',
      settings: [
        { id: 'range', name: 'Range', cn: '范围', type: 'slider', min: 1.5, max: 6, step: 0.1, value: 3.5 },
        { id: 'strength', name: 'Strength', cn: '强度', type: 'slider', min: 0.3, max: 1, step: 0.05, value: 0.9 },
      ],
    },
    {
      id: 'bowaim', name: 'BowAim', cn: '弓箭辅助', cat: 'combat', desc: '手持弓时自动瞄准目标（带重力补偿），可选自动拉弓射击',
      settings: [
        { id: 'range', name: 'Range', cn: '范围', type: 'slider', min: 8, max: 96, step: 2, value: 40 },
        { id: 'rotate', name: 'Lock View', cn: '锁定视角', type: 'checkbox', value: true, desc: '关闭后只显示弹道，不强行转动视角' },
        { id: 'lead', name: 'Lead Target', cn: '移动目标预判', type: 'checkbox', value: true,
          desc: '按目标速度算提前量，打移动中的生物' },
        { id: 'smooth', name: 'Smooth', cn: '转视角平滑', type: 'slider', min: 0, max: 0.9, step: 0.05, value: 0.35 },
        { id: 'zero', name: 'Zero', cn: '弹道校准', type: 'slider', min: -0.5, max: 0.8, step: 0.05, value: 0.2,
          desc: '落点偏低就调高，偏高就调低' },
        { id: 'autoCharge', name: 'Auto Charge', cn: '自动蓄力', type: 'checkbox', value: true },
        { id: 'auto', name: 'Auto Shoot', cn: '自动射击', type: 'checkbox', value: true, desc: '拉满后自动松手' },
        { id: 'players', name: 'Players', cn: '包含玩家', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'crit', name: 'Criticals', cn: '刀刀暴击', cat: 'combat', desc: '每次攻击都判定为暴击（伤害 ×1.5，单机有效；联机伤害由服务器计算）',
    },
    {
      id: 'autosprint', name: 'AutoSprint', cn: '自动疾跑', cat: 'movement', desc: '自动保持疾跑',
      settings: [
        { id: 'onlyforward', name: 'Only Forward', cn: '仅前进', type: 'checkbox', value: true, desc: '仅前进时疾跑' },
      ],
    },
    {
      id: 'fly', name: 'Fly', cn: '飞行', cat: 'movement', desc: '双击空格开启 / 关闭飞行；飞行时空格上升、Shift 下降',
    },
    {
      id: 'autojump', name: 'AutoJump', cn: '自动跳跃', cat: 'movement', desc: '前进被方块挡住时自动起跳',
    },
    {
      id: 'speed', name: 'Speed', cn: '加速', cat: 'movement', desc: '提高移动速度',
      settings: [
        { id: 'mult', name: 'Multiplier', cn: '倍率', type: 'slider', min: 1, max: 2.5, step: 0.1, value: 1.5 },
      ],
    },
    {
      id: 'step', name: 'Step', cn: '自动上台阶', cat: 'movement', desc: '自动跳上一格高的方块',
    },
    {
      id: 'scaffold', name: 'Scaffold', cn: '自动搭路', cat: 'movement', desc: '前进时自动在脚下前方铺方块（用手里的方块，单机直接放置，联机发包）',
      settings: [
        { id: 'ahead', name: 'Ahead', cn: '铺前方', type: 'checkbox', value: true, desc: '铺在前进方向；关闭则只铺脚下' },
      ],
    },
    {
      id: 'nofall', name: 'NoFall', cn: '免摔伤', cat: 'movement', desc: '取消坠落伤害',
    },
    {
      id: 'autorespawn', name: 'AutoRespawn', cn: '自动重生', cat: 'player', desc: '死亡后自动重生',
    },
    {
      id: 'fastbreak', name: 'FastBreak', cn: '快速破坏', cat: 'player', desc: '加快挖掘方块的速度',
      settings: [
        { id: 'mult', name: 'Speed', cn: '速度倍率', type: 'slider', min: 2, max: 20, step: 1, value: 8 },
      ],
    },
    {
      id: 'instantbreak', name: 'InstantBreak', cn: '瞬间破坏', cat: 'player', desc: '开始挖掘立即破坏方块',
    },
    {
      id: 'autoeat', name: 'AutoEat', cn: '自动进食', cat: 'player', desc: '饥饿时自动吃手里的食物',
      settings: [
        { id: 'threshold', name: 'Threshold', cn: '触发饥饿值', type: 'slider', min: 6, max: 19, step: 1, value: 16 },
      ],
    },
    {
      id: 'waterbreath', name: 'WaterBreath', cn: '水下呼吸', cat: 'player', desc: '在水下不会消耗氧气',
    },
    {
      id: 'freecam', name: 'Freecam', cn: '灵魂出窍', cat: 'player', desc: '相机脱离身体自由移动（WASD 平移，空格 / Shift 升降，鼠标转视角；身体原地不动）',
      settings: [
        { id: 'speed', name: 'Speed', cn: '速度', type: 'slider', min: 0.5, max: 4, step: 0.1, value: 1.5 },
        { id: 'body', name: 'Freeze Body', cn: '冻结身体', type: 'checkbox', value: true, desc: '出窍时身体不受移动输入影响' },
      ],
    },
    {
      id: 'esp', name: 'ESP', cn: '生物ESP', cat: 'render', desc: '生物 / 掉落物 / 玩家 3D 线框，可分别自定义颜色',
      settings: [
        { id: 'distance', name: 'Distance', cn: '距离', type: 'slider', min: 8, max: 128, step: 4, value: 64 },
        { id: 'mobColor', name: 'Mob Box', cn: '生物框颜色', type: 'color', value: '', desc: '留空 = 敌对红 / 被动蓝' },
        { id: 'itemColor', name: 'Item Box', cn: '掉落物框颜色', type: 'color', value: '', desc: '留空 = 按物品类型配色' },
        { id: 'playerColor', name: 'Player Box', cn: '玩家框颜色', type: 'color', value: '', desc: '留空 = 紫色' },
      ],
    },
    {
      id: 'tracers', name: 'Tracers', cn: '追踪线', cat: 'render', desc: '从准星指向生物 / 掉落物 / 玩家的追踪线，可分别自定义颜色',
      settings: [
        { id: 'mobColor', name: 'Mob Line', cn: '生物线颜色', type: 'color', value: '', desc: '留空 = 敌对红 / 被动蓝' },
        { id: 'itemColor', name: 'Item Line', cn: '掉落物线颜色', type: 'color', value: '', desc: '留空 = 按物品类型配色' },
        { id: 'playerColor', name: 'Player Line', cn: '玩家线颜色', type: 'color', value: '', desc: '留空 = 紫色' },
      ],
    },
    {
      id: 'projectile', name: 'Projectiles', cn: '投掷物抛物线', cat: 'render', desc: '显示手中弓 / 投掷物的抛物线路径与落点，以及飞行中投射物的预测轨迹',
      settings: [
        { id: 'held', name: 'Held Preview', cn: '手持预览', type: 'checkbox', value: true },
        { id: 'flight', name: 'Flight Trail', cn: '飞行轨迹', type: 'checkbox', value: true },
        { id: 'land', name: 'Landing Mark', cn: '落点标记', type: 'checkbox', value: true },
        { id: 'leadMark', name: 'Lead Mark', cn: '预判命中点', type: 'checkbox', value: true,
          desc: '显示弓箭辅助算出的提前点，和辅助瞄准共用同一套弹道' },
        { id: 'style', name: 'Trail Style', cn: '轨迹样式', type: 'select', value: '光带',
          options: ['光带', '细线', '光点', '关闭'] },
        { id: 'trailColor', name: 'Trail Color', cn: '轨迹颜色', type: 'color', value: '',
          desc: '留空 = 青蓝（弓与投掷物同色系）' },
        { id: 'color', name: 'Trail Color', cn: '轨迹颜色', type: 'color', value: '', desc: '留空 = 弓黄 / 投掷物蓝' },
      ],
    },
    {
      id: 'nametags', name: 'Nametags', cn: '名字标签', cat: 'render', desc: '实体名字与血条',
      state: true,
      settings: [
        { id: 'held', name: 'Held Item', cn: '手持物品', type: 'checkbox', value: true },
        { id: 'armor', name: 'Armor', cn: '装备栏', type: 'checkbox', value: true },
        { id: 'compact', name: 'Compact', cn: '紧凑排版', type: 'checkbox', value: true },
        { id: 'scale', name: 'Scale', cn: '字号', type: 'slider', min: 0.8, max: 1.8, step: 0.1, value: 1.1 },
        { id: 'color', name: 'Name Color', cn: '名字颜色', type: 'color', value: '', desc: '留空 = 白色' },
        { id: 'bgColor', name: 'BG Color', cn: '背景颜色', type: 'color', value: '', desc: '留空 = 主题深色' },
        { id: 'bgAlpha', name: 'BG Alpha', cn: '背景不透明度', type: 'slider', min: 0, max: 100, step: 5, value: 88 },
        { id: 'format', name: 'Format', cn: '显示内容', type: 'select', value: '名称+距离',
          options: ['名称+距离', '仅名称', '名称+血量', '名称+距离+血量'] },
        { id: 'alias', name: 'Alias', cn: '自定义别名', type: 'text', value: '',
          placeholder: '鸡=咯咯,猪=佩奇' },
      ],
    },
    {
      id: 'itemesp', name: 'ItemESP', cn: '物品ESP', cat: 'render', desc: '掉落物 / 投射物标记',
    },
    {
      id: 'targetesp', name: 'TargetESP', cn: '目标ESP', cat: 'render', desc: '高亮 Aura 当前目标',
    },
    {
      id: 'fullbright', name: 'FullBright', cn: '全亮', cat: 'render', desc: '强制最亮夜视',
    },
    {
      id: 'nightvision', name: 'NightVision', cn: '夜视', cat: 'render', desc: '强制开启夜视效果',
    },
    {
      id: 'ambience', name: 'Ambience', cn: '环境', cat: 'render', desc: '锁定世界时间与天气',
      settings: [
        { id: 'freeze', name: 'Freeze Time', cn: '锁定时间', type: 'checkbox', value: true, desc: '锁定时间' },
        { id: 'time', name: 'Time', cn: '时间', type: 'slider', min: 0, max: 24000, step: 500, value: 6000 },
        { id: 'weather', name: 'Weather', cn: '天气', type: 'select', value: '晴朗', options: ['晴朗', '下雨'] },
      ],
    },
    {
      id: 'hud', name: 'Hud', cn: 'HUD', cat: 'render', desc: '彗星式 HUD 界面元素', state: true,
      settings: [
        { id: 'watermark', name: 'Watermark', cn: '水印', type: 'checkbox', value: true, desc: '左上角水印' },
        { id: 'info', name: 'Info', cn: '坐标信息', type: 'checkbox', value: true, desc: '坐标 / 速度' },
        { id: 'target', name: 'TargetHud', cn: '目标HUD', type: 'checkbox', value: true, desc: '目标血条' },
        { id: 'arraylist', name: 'ArrayList', cn: '模块列表', type: 'checkbox', value: true, desc: '启用模块列表' },
        { id: 'notifications', name: 'Notifications', cn: '通知', type: 'checkbox', value: true, desc: '开关提示' },
        { id: 'radar', name: 'Radar', cn: '雷达', type: 'checkbox', value: true, desc: '俯视实体雷达（正北朝上）' },
        { id: 'compass', name: 'Compass', cn: '罗盘', type: 'checkbox', value: true, desc: '方位罗盘（几点方向 + 经纬度）' },
        { id: 'faceStyle', name: 'Face', cn: '头像样式', type: 'select', value: '自动正脸',
          options: ['自动正脸', '整张贴图', '像素手绘'] },
        { id: 'compassMarks', name: 'Waypoints', cn: '罗盘路径点', type: 'checkbox', value: true,
          desc: '像 PUBG 一样把已标记点位嵌进方位条' },
      ],
    },
    {
      id: 'appearance', name: 'Appearance', cn: '外观设置', cat: 'configs',
      desc: '绚丽 / 平缓 / 基本 / 自定义；选「自定义」还原你之前调过的值',
      settings: [
        { id: 'group', name: 'Group Modules', cn: '模块列表按子分类分组', type: 'checkbox', value: true },
        { id: 'preset', name: 'Preset', cn: '外观档位', type: 'select', value: '绚丽',
          options: ['绚丽', '平缓', '基本', '自定义'] },
        { id: 'accent', name: 'Accent', cn: '主题色', type: 'color', value: '', desc: '留空 = 彗星紫' },
        { id: 'glow', name: 'Glow', cn: '辉光强度', type: 'slider', min: 0, max: 24, step: 1, value: 14 },
        { id: 'blur', name: 'Blur', cn: '玻璃模糊', type: 'slider', min: 0, max: 30, step: 1, value: 18 },
        { id: 'radius', name: 'Radius', cn: '圆角', type: 'slider', min: 0, max: 22, step: 1, value: 14 },
        { id: 'anim', name: 'Animation', cn: '动画速度', type: 'slider', min: 0, max: 2, step: 0.1, value: 1.3 },
        { id: 'saturate', name: 'Saturate', cn: '饱和度', type: 'slider', min: 0.5, max: 2, step: 0.1, value: 1.5 },
        { id: 'bg', name: 'Background', cn: '面板底色', type: 'color', value: '', desc: '留空 = 深色' },
        { id: 'border', name: 'Border', cn: '边框亮度', type: 'slider', min: 0, max: 1, step: 0.05, value: 0.75 },
      ],
    },
    {
      id: 'perf', name: 'Performance', cn: '性能优化', cat: 'configs',
      desc: '按帧率自动降级高开销效果；也可手动选档',
      settings: [
        { id: 'level', name: 'Level', cn: '性能档位', type: 'select', value: '自动',
          options: ['自动', '省电', '均衡', '绚丽'] },
        { id: 'maxEnts', name: 'Max Entities', cn: '实体上限', type: 'slider', min: 20, max: 200, step: 10, value: 80 },
        { id: 'fxQuality', name: 'FX Quality', cn: '特效精度', type: 'slider', min: 0.3, max: 1, step: 0.1, value: 1 },
        { id: 'noGlow', name: 'No Glow', cn: '关闭辉光', type: 'checkbox', value: false,
          desc: 'shadowBlur 是 canvas 最贵的操作，关掉最省' },
      ],
    },
    {
      id: 'xray', name: 'XRay', cn: '矿透', cat: 'render',
      desc: '材质透视：只显示矿物实体，其余画面压暗成空气；仅限单人或自用服务器',
      settings: [
        { id: 'mode', name: 'Mode', cn: '透视模式', type: 'select', value: '材质透视',
          options: ['材质透视', '框选'] },
        { id: 'distance', name: 'Distance', cn: '扫描半径', type: 'slider', min: 16, max: 128, step: 8, value: 48 },
        { id: 'limit', name: 'Max', cn: '最多显示', type: 'slider', min: 40, max: 600, step: 20, value: 200 },
        { id: 'through', name: 'Through Walls', cn: '穿墙显示', type: 'checkbox', value: true },
        { id: 'labels', name: 'Labels', cn: '矿石名字', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'blockesp', name: 'BlockTracker', cn: '方块追踪', cat: 'render',
      desc: '指定方块名扫描周围区块，持续高亮所有匹配方块（转身 / 穿墙也能看到）',
      settings: [
        { id: 'target', name: 'Target', cn: '目标方块', type: 'text', value: 'diamond_ore',
          placeholder: '钻石矿 / diamond_ore / chest' },
        { id: 'browse', name: 'Browse', cn: '浏览方块…', type: 'button' },
        { id: 'radius', name: 'Radius', cn: '扫描半径', type: 'slider', min: 16, max: 128, step: 8, value: 48 },
        { id: 'limit', name: 'Max Hits', cn: '最多显示', type: 'slider', min: 20, max: 400, step: 20, value: 120 },
        { id: 'color', name: 'Color', cn: '框颜色', type: 'color', value: '', desc: '留空 = 金色' },
        { id: 'width', name: 'Width', cn: '线宽', type: 'slider', min: 1, max: 6, step: 0.5, value: 2 },
        { id: 'crosshair', name: 'Crosshair Box', cn: '准星方块框', type: 'checkbox', value: true },
        { id: 'edge', name: 'Edge Arrow', cn: '屏外箭头', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'trail', name: 'Trail', cn: '移动轨迹', cat: 'render',
      desc: '身后留下渐隐光轨与脚下光点',
      settings: [
        { id: 'color', name: 'Color', cn: '轨迹颜色', type: 'color', value: '', desc: '留空 = 薄荷绿' },
        { id: 'length', name: 'Length', cn: '轨迹长度', type: 'slider', min: 10, max: 160, step: 10, value: 60 },
        { id: 'width', name: 'Width', cn: '线宽', type: 'slider', min: 1, max: 6, step: 0.5, value: 2 },
        { id: 'glow', name: 'Glow', cn: '脚下光点', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'targetring', name: 'TargetRing', cn: '目标光环', cat: 'render',
      desc: '当前目标脚下的旋转光圈 + 上升光柱',
      settings: [
        { id: 'color', name: 'Color', cn: '光环颜色', type: 'color', value: '', desc: '留空 = 珊瑚红' },
        { id: 'size', name: 'Size', cn: '圈半径', type: 'slider', min: 0.4, max: 2.5, step: 0.1, value: 0.9 },
        { id: 'speed', name: 'Speed', cn: '旋转速度', type: 'slider', min: 0.2, max: 3, step: 0.1, value: 1 },
        { id: 'beam', name: 'Beam', cn: '上升光柱', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'waypoints', name: 'Waypoints', cn: '路径点', cat: 'render',
      desc: '标记坐标：世界光柱 + 名字距离 + 屏外箭头，小地图同步标点',
      settings: [
        { id: 'add', name: 'Add Here', cn: '标记当前坐标', type: 'button' },
        { id: 'clear', name: 'Clear', cn: '清空路径点', type: 'button' },
        { id: 'beacon', name: 'Beacon', cn: '世界光柱', type: 'checkbox', value: true },
        { id: 'edge', name: 'Edge Arrow', cn: '屏外箭头', type: 'checkbox', value: true },
        { id: 'distance', name: 'Max Distance', cn: '显示距离', type: 'slider', min: 32, max: 512, step: 16, value: 256 },
      ],
    },
    {
      id: 'minimap', name: 'Minimap', cn: '小地图', cat: 'render',
      desc: 'Xaero 式圆形小地图：地形着色 / 实体点 / 路径点 / 方位与坐标',
      settings: [
        { id: 'size', name: 'Size', cn: '尺寸', type: 'slider', min: 120, max: 320, step: 10, value: 180 },
        { id: 'zoom', name: 'Zoom', cn: '视野半径', type: 'slider', min: 16, max: 128, step: 8, value: 48 },
        { id: 'terrain', name: 'Terrain', cn: '地形着色', type: 'checkbox', value: true },
        { id: 'entities', name: 'Entities', cn: '实体点', type: 'checkbox', value: true },
        { id: 'labels', name: 'Labels', cn: '路径点名字', type: 'checkbox', value: true },
        { id: 'open', name: 'Open Map', cn: '打开大地图 (M)', type: 'button' },
        { id: 'editpos', name: 'Edit Pos', cn: '编辑位置', type: 'button' },
        { id: 'resetpos', name: 'Reset Pos', cn: '重置位置', type: 'button' },
      ],
    },
    {
      id: 'invhud', name: 'Inventory', cn: '背包信息', cat: 'render',
      desc: '悬浮显示快捷栏 / 完整背包：物品中文名、数量、选中格',
      settings: [
        { id: 'full', name: 'Full Inv', cn: '显示完整背包', type: 'checkbox', value: false },
        { id: 'names', name: 'Names', cn: '显示物品名', type: 'checkbox', value: true },
        { id: 'scale', name: 'Scale', cn: '面板缩放', type: 'slider', min: 0.8, max: 1.6, step: 0.1, value: 1 },
        { id: 'editpos', name: 'Edit Pos', cn: '编辑位置', type: 'button' },
        { id: 'resetpos', name: 'Reset Pos', cn: '重置位置', type: 'button' },
      ],
    },
    {
      id: 'drops', name: 'DropList', cn: '掉落物汇总', cat: 'render',
      desc: '汇总面板 + 世界内掉落物名字距离与 3D 框（可分别开关）',
      settings: [
        { id: 'range', name: 'Range', cn: '统计半径', type: 'slider', min: 8, max: 64, step: 4, value: 32 },
        { id: 'max', name: 'Max', cn: '最多条目', type: 'slider', min: 4, max: 20, step: 1, value: 10 },
        { id: 'worldTags', name: 'World Tags', cn: '世界内名字距离', type: 'checkbox', value: true },
        { id: 'worldBoxes', name: 'World Boxes', cn: '世界内 3D 框', type: 'checkbox', value: true },
        { id: 'hideTags', name: 'Hide Tags', cn: '隐藏散标签', type: 'checkbox', value: false,
          desc: '开启后只留汇总面板，画面最干净' },
        { id: 'xp', name: 'XP Orbs', cn: '包含经验球', type: 'checkbox', value: true },
        { id: 'editpos', name: 'Edit Pos', cn: '编辑位置', type: 'button' },
        { id: 'resetpos', name: 'Reset Pos', cn: '重置位置', type: 'button' },
      ],
    },
    {
      id: 'music', name: 'Music', cn: '音乐播放器', cat: 'misc',
      desc: 'GD音乐台 / 公共领域双音源；仅供个人学习，禁止下载传播或商用',
      settings: [
        { id: 'source', name: 'Source', cn: '首选音源', type: 'select', value: 'GD·netease',
          options: ['GD·netease', 'GD·kuwo', 'GD·kugou', 'GD·tencent', 'GD·joox',
            'GD·bilibili', '公共领域·Archive'] },
        { id: 'br', name: 'Quality', cn: '音质', type: 'select', value: '320',
          options: ['128', '192', '320', '740', '999'] },
        { id: 'multi', name: 'Multi Search', cn: '聚合多源搜索', type: 'checkbox', value: true,
          desc: '一次查多个音源并合并去重，曲库最全；结果标注来源' },
        { id: 'multiCount', name: 'Sources', cn: '聚合源数', type: 'slider', min: 2, max: 6, step: 1, value: 3 },
        { id: 'autoRetry', name: 'Auto Retry', cn: '自动换源重试', type: 'checkbox', value: true,
          desc: '单源模式下某音源超时 / 无结果时自动试下一个' },
        { id: 'cors', name: 'Spectrum Mode', cn: '频谱优先模式', type: 'checkbox', value: false,
          desc: '开启后要求音源给 CORS（可能播不了）；关闭则保证能播，律动走兜底' },
        { id: 'open', name: 'Open Player', cn: '打开播放器', type: 'button' },
        { id: 'volume', name: 'Volume', cn: '音量', type: 'slider', min: 0, max: 100, step: 5, value: 70 },
        { id: 'sens', name: 'Sensitivity', cn: '律动灵敏度', type: 'slider', min: 0.3, max: 3, step: 0.1, value: 1.2 },
        { id: 'editpos', name: 'Edit Pos', cn: '编辑位置', type: 'button' },
        { id: 'resetpos', name: 'Reset Pos', cn: '重置位置', type: 'button' },
      ],
    },
    {
      id: 'mblur', name: 'MotionBlur', cn: '视角运动模糊', cat: 'render',
      desc: '转动视角时画面产生动态模糊，停下自动淡出（不影响光环拖影）',
      settings: [
        { id: 'strength', name: 'Strength', cn: '模糊强度', type: 'slider', min: 0, max: 8, step: 0.5, value: 5 },
        { id: 'decay', name: 'Decay', cn: '余韵', type: 'slider', min: 0.05, max: 0.4, step: 0.05, value: 0.1 },
      ],
    },
    {
      id: 'spin', name: 'Spin', cn: '模型自转', cat: 'misc',
      desc: '娱乐：只让模型身体自转，视角 / 头朝向 / 移动完全不动',
      settings: [
        { id: 'speed', name: 'Speed', cn: '转速', type: 'slider', min: 0.1, max: 20, step: 0.5, value: 3 },
        { id: 'reverse', name: 'Reverse', cn: '反向旋转', type: 'checkbox', value: false },
      ],
    },
    {
      id: 'containeresp', name: 'ContainerESP', cn: '容器 ESP', cat: 'render',
      desc: '扫描周围箱子 / 木桶 / 熔炉等方块实体，每类容器可单独设置框色与追踪线颜色',
      settings: [
        { id: 'range', name: 'Range', cn: '扫描半径', type: 'slider', min: 8, max: 96, step: 4, value: 40 },
        { id: 'width', name: 'Width', cn: '框线宽', type: 'slider', min: 1, max: 5, step: 0.5, value: 1.6 },
        { id: 'tracer', name: 'Tracer', cn: '显示追踪线', type: 'checkbox', value: true },
        { id: 'labels', name: 'Labels', cn: '显示名称', type: 'checkbox', value: true },
        { id: 'f_chest', name: 'Chest Box', cn: '箱子·框色', type: 'color', value: '#ffc857' },
        { id: 't_chest', name: 'Chest Line', cn: '箱子·线色', type: 'color', value: '#ffc857' },
        { id: 'f_copper', name: 'Copper Box', cn: '铜箱·框色', type: 'color', value: '#e08a5b' },
        { id: 't_copper', name: 'Copper Line', cn: '铜箱·线色', type: 'color', value: '#e08a5b' },
        { id: 'f_ender', name: 'Ender Box', cn: '末影箱·框色', type: 'color', value: '#b06bff' },
        { id: 't_ender', name: 'Ender Line', cn: '末影箱·线色', type: 'color', value: '#b06bff' },
        { id: 'f_barrel', name: 'Barrel Box', cn: '木桶·框色', type: 'color', value: '#c98a4b' },
        { id: 't_barrel', name: 'Barrel Line', cn: '木桶·线色', type: 'color', value: '#c98a4b' },
        { id: 'f_furnace', name: 'Furnace Box', cn: '熔炉·框色', type: 'color', value: '#8c94a3' },
        { id: 't_furnace', name: 'Furnace Line', cn: '熔炉·线色', type: 'color', value: '#8c94a3' },
        { id: 'f_blast', name: 'Blast Box', cn: '高炉·框色', type: 'color', value: '#5fd8ff' },
        { id: 't_blast', name: 'Blast Line', cn: '高炉·线色', type: 'color', value: '#5fd8ff' },
        { id: 'f_smoker', name: 'Smoker Box', cn: '烟熏炉·框色', type: 'color', value: '#a8e06a' },
        { id: 't_smoker', name: 'Smoker Line', cn: '烟熏炉·线色', type: 'color', value: '#a8e06a' },
        { id: 'f_dispenser', name: 'Dispenser Box', cn: '发射器·框色', type: 'color', value: '#ff9a5b' },
        { id: 't_dispenser', name: 'Dispenser Line', cn: '发射器·线色', type: 'color', value: '#ff9a5b' },
        { id: 'f_dropper', name: 'Dropper Box', cn: '投放器·框色', type: 'color', value: '#ff7bc0' },
        { id: 't_dropper', name: 'Dropper Line', cn: '投放器·线色', type: 'color', value: '#ff7bc0' },
        { id: 'f_hopper', name: 'Hopper Box', cn: '漏斗·框色', type: 'color', value: '#4fe8e0' },
        { id: 't_hopper', name: 'Hopper Line', cn: '漏斗·线色', type: 'color', value: '#4fe8e0' },
        { id: 'f_shulker', name: 'Shulker Box', cn: '潜影盒·框色', type: 'color', value: '#c07bff' },
        { id: 't_shulker', name: 'Shulker Line', cn: '潜影盒·线色', type: 'color', value: '#c07bff' },
        { id: 'f_utility', name: 'Utility Box', cn: '工作站·框色', type: 'color', value: '#6ee7a5' },
        { id: 't_utility', name: 'Utility Line', cn: '工作站·线色', type: 'color', value: '#6ee7a5' },
        { id: 'f_other', name: 'Other Box', cn: '其它容器·框色', type: 'color', value: '#e8ecf4' },
        { id: 't_other', name: 'Other Line', cn: '其它容器·线色', type: 'color', value: '#e8ecf4' },
      ],
    },
    {
      id: 'resourcepack', name: 'ResourcePack', cn: 'MC 材质包', cat: 'configs',
      desc: '导入标准 MC 资源包 .zip：方块贴图走纹理数组，GUI / 物品栏 / HUD 贴图直接替换游戏 images（零依赖原生解压）',
      settings: [
        { id: 'enabled', name: 'Enabled', cn: '启用材质包', type: 'checkbox', value: true },
        { id: 'open', name: 'Open Screen', cn: '打开原版资源包界面', type: 'button',
          desc: '用游戏自己的菜单绘制：左右双列表、箭头、优先级排序、可叠加多个包' },
        { id: 'import', name: 'Import', cn: '导入 .zip', type: 'button' },
        { id: 'reapply', name: 'Reapply', cn: '重新应用', type: 'button' },
        { id: 'clear', name: 'Clear', cn: '清除材质包', type: 'button' },
        { id: 'demo', name: 'Builtin Pack', cn: '内置暗色 GUI 包', type: 'button',
          desc: '41KB / 56 张，精选自 MandalasGUI+Dakmode；会真的改物品栏、菜单按钮、血条与菜单底纹' },
        { id: 'status', name: 'Status', cn: '状态', type: 'text', value: '未导入' },
        { id: 'anims', name: 'Anims', cn: '包含动画贴图首帧', type: 'checkbox', value: true,
          desc: '水 / 岩浆等竖条多帧图只取第一帧' },
      ],
    },
    {
      id: 'server', name: 'ServerSwitch', cn: '服务器切换', cat: 'misc', desc: '切换房间服务器',
      settings: [
        { id: 'server', name: 'Server', cn: '服务器', type: 'select', value: '', options: () => (cfg.servers || []).map((s) => s.name) },
        { id: 'apply', name: 'Apply Server', cn: '应用服务器', type: 'button' },
      ],
    },
    {
      id: 'gate', name: 'BypassGate', cn: '跳过登录门槛', cat: 'misc', desc: '跳过多人界面的客户端登录门槛',
    },
    {
      id: 'mc18', name: 'MC18 Link', cn: 'MC18 连接', cat: 'misc', desc: '直连 MC1.8 服务器（需 opus-mc18-link）',
      settings: [
        { id: 'addr', name: 'Address', cn: '地址', type: 'text', value: () => cfg.mcAddr, placeholder: 'ws://IP:25565' },
        { id: 'name', name: 'Name', cn: '名字', type: 'text', value: () => cfg.mcName, placeholder: 'Player' },
        { id: 'toggle', name: 'Connect / Disconnect', cn: '连接 / 断开', type: 'button' },
      ],
    },
    {
      id: 'hudedit', name: 'HUD Edit', cn: 'HUD 编辑', cat: 'configs', desc: '拖动调整 HUD 元素位置（水印 / 坐标 / 目标面板 / 罗盘 / 雷达 / 列表）',
      settings: [
        { id: 'edit', name: 'Edit HUD', cn: '编辑位置', type: 'button' },
        { id: 'resetpos', name: 'Reset HUD', cn: '重置位置', type: 'button' },
      ],
    },
    {
      id: 'cfgreset', name: 'ConfigBackup', cn: '配置备份', cat: 'configs',
      desc: '导出 / 导入专用 .opuscfg 备份（含模块开关、按键、路径点、面板位置）',
      settings: [
        { id: 'export', name: 'Export', cn: '导出备份 (.opuscfg)', type: 'button' },
        { id: 'import', name: 'Import', cn: '导入备份', type: 'button' },
        { id: 'reset', name: 'Reset Config', cn: '重置配置', type: 'button' },
      ],
    },
    {
      id: 'intro', name: 'Boot Intro', cn: '启动开场动画', cat: 'configs',
      desc: '黑屏开场：图案一段段组装、碎片归位、持续转圈，再扩散淡出',
      settings: [
        { id: 'enabled', name: 'Enabled', cn: '启用开场动画', type: 'checkbox', value: true },
        { id: 'style', name: 'Style', cn: '动画样式', type: 'select', value: '五芒星',
          options: ['五芒星', '六芒星', '花瓣', '齿轮', '三角阵', '星轨', '极光'] },
        { id: 'duration', name: 'Duration', cn: '时长（秒）', type: 'slider', min: 1.5, max: 6, step: 0.5, value: 3 },
        { id: 'skip', name: 'Skip', cn: '点击画面可跳过', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'floatgui', name: 'Floating GUI', cn: '悬浮标签', cat: 'configs',
      desc: '彗星式：每个分类一个悬浮面板，可拖动 / 右键标题折叠成一条标签，位置自动记住；经典面板保留',
      state: true,
      settings: [
        { id: 'hotkey', name: 'Hotkey', cn: '呼出按键', type: 'button' },
        { id: 'reset', name: 'Reset Layout', cn: '重置面板位置', type: 'button' },
      ],
    },
  ];

  const MODS_BY_ID = {};
  for (const m of MODULES) MODS_BY_ID[m.id] = m;
  for (const m of MODULES) if (cfg.states[m.id] === undefined) cfg.states[m.id] = !!m.state;

  // 旧版配置迁移（一次性）
  if (oldCfg && !stored.states) {
    const map = {
      esp: oldCfg.esp, tracers: oldCfg.tracers, nametags: oldCfg.labels !== false,
      itemesp: oldCfg.itemEsp, fullbright: oldCfg.nightVision, ambience: oldCfg.timeWeather,
      hud: oldCfg.hud !== false, gate: oldCfg.bypassGate, clientside: true,
    };
    for (const k in map) if (cfg.states[k] === undefined) cfg.states[k] = !!map[k];
    if (oldCfg.espDist) cfg.settings['esp.distance'] = oldCfg.espDist;
    if (Array.isArray(oldCfg.servers)) cfg.servers = oldCfg.servers;
    if (typeof oldCfg.serverIdx === 'number') cfg.serverIdx = oldCfg.serverIdx;
    if (oldCfg.mcAddr) cfg.mcAddr = oldCfg.mcAddr;
    if (oldCfg.mcName) cfg.mcName = oldCfg.mcName;
    cfg.settings['hud.watermark'] = cfg.settings['hud.watermark'] ?? true;
    cfg.settings['hud.info'] = cfg.settings['hud.info'] ?? (oldCfg.hud !== false);
    cfg.settings['hud.radar'] = cfg.settings['hud.radar'] ?? !!oldCfg.radar;
    cfg.settings['hud.compass'] = cfg.settings['hud.compass'] ?? !!oldCfg.compass;
    saveCfg();
  }

  let __sCache = null;
  function getS(mid, sid) {
    const k = mid + '.' + sid;
    if (__sCache && k in __sCache) return __sCache[k];
    let v;
    if (cfg.settings[k] !== undefined) v = cfg.settings[k];
    else {
      const m = MODS_BY_ID[mid];
      const d = m && m.settings && m.settings.find((s) => s.id === sid);
      if (!d) return undefined;
      v = typeof d.value === 'function' ? d.value() : d.value;
    }
    if (__sCache) __sCache[k] = v;
    return v;
  }
  function setS(mid, sid, v) {
    cfg.settings[mid + '.' + sid] = v;
    __sCache = null;
    saveCfg();
    afterSetting(mid, sid, v);
  }
  function modOn(id) { return !!cfg.states[id]; }
  function toggleModule(m) {
    cfg.states[m.id] = !cfg.states[m.id];
    saveCfg();
    afterToggle(m);
  }

  // ---------- 模块副作用 ----------
  function afterToggle(m) {
    if (m.id === 'gate') applyGate();
    if (m.id === 'server') applyServer();
    notify(m.cn || m.name, modOn(m.id) ? '已开启' : '已关闭');
    refreshGui();
    refreshHud();
  }

  function afterSetting(mid, sid, v) {
    if (mid === 'server' && sid === 'server') {
      const idx = (cfg.servers || []).findIndex((s) => s.name === v);
      if (idx >= 0) { cfg.serverIdx = idx; applyServer(); }
    }
    if (mid === 'gate') applyGate();
    if (mid === 'mc18' && sid === 'addr') cfg.mcAddr = v;
    if (mid === 'mc18' && sid === 'name') cfg.mcName = v;
    if (mid === 'hud') refreshHud();
    if (mid === 'appearance') {
      if (sid === 'preset') {
        if (v === '自定义') restoreAppearance();
        else {
          if (__lastPreset === '自定义') saveAppearanceSnapshot();
          applyAppearancePreset(v);
        }
      } else {
        if (String(getS('appearance', 'preset') || '') === '自定义') saveAppearanceSnapshot();
        applyAppearance();
      }
    }
  }

  // 多人免登录入口：只跳过客户端 UI 门槛（登录屏 / 关注解锁屏），服务端权限不变
  function applyGate() {
    try {
      if (typeof W.onlineGate !== 'function') return;
      if (modOn('gate') && !W.__cometOrigGate) {
        W.__cometOrigGate = W.onlineGate;
        W.onlineGate = function (g, then) { return then(); };
        console.log('[Comet] 多人免登录入口已开启');
      } else if (!modOn('gate') && W.__cometOrigGate) {
        W.onlineGate = W.__cometOrigGate;
        W.__cometOrigGate = null;
        console.log('[Comet] 多人免登录入口已关闭');
      }
    } catch (err) { /* noop */ }
  }

  // 房间服务器切换（RoomService.base() 动态读 NET_CONFIG.rooms）
  function applyServer() {
    try {
      const s = cfg.servers && cfg.servers[cfg.serverIdx];
      if (s && W.NET_CONFIG) W.NET_CONFIG.rooms = s.url;
    } catch (err) { /* noop */ }
  }

  // ---------- 引用发现 Tier 1：全局挂载 ----------
  function tryGlobalMount() {
    for (const key of ['game', '__game', 'G', 'engine', '__OPUS', 'mc', 'world']) {
      try {
        const g = W[key];
        if (g && typeof g === 'object') {
          if (g.player && looksLikePlayer(g.player)) return { game: g, player: g.player, key };
          if (looksLikePlayer(g)) return { game: null, player: g, key };
        }
      } catch (e) { /* 忽略抛错属性 */ }
    }
    return null;
  }

  function scanWindow() {
    let keys;
    try { keys = Object.getOwnPropertyNames(W); } catch (e) { return null; }
    for (const key of keys) {
      let v;
      try { v = W[key]; } catch (e) { continue; }
      if (!v || typeof v !== 'object' || v === W || v === W.document) continue;
      if (looksLikePlayer(v)) return { game: null, player: v, key };
      let sub;
      try { sub = Object.getOwnPropertyNames(v); } catch (e) { continue; }
      if (sub.length > 300) continue;
      for (const sk of sub) {
        let sv;
        try { sv = v[sk]; } catch (e) { continue; }
        if (sv && typeof sv === 'object' && looksLikePlayer(sv)) {
          return { game: v, player: sv, key: key + '.' + sk };
        }
      }
    }
    return null;
  }

  // ---------- 引用发现 Tier 3：hook fillText 嗅探 ----------
  function installFillTextSniffer() {
    if (W.__cometHud && W.__cometHud._snifferInstalled) return;
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y) {
      const h = W.__cometHud;
      if (h && h._sniffing) {
        h._sniffing.count++;
        if (h._sniffing.count <= 400) {
          let where = '(native)';
          try { where = new Error().stack.split('\n')[2]?.trim().slice(0, 120) ?? '(?)'; } catch (e) { /* noop */ }
          h.fillTextLog.push({ text: String(text).slice(0, 60), canvas: (this.canvas && (this.canvas.id || this.canvas.className)) || '(unnamed)', where });
        }
      }
      return orig.call(this, text, x, y);
    };
    if (W.__cometHud) W.__cometHud._snifferInstalled = true;
  }

  // ---------- 夜视：替换全局换算函数（游戏原生 env.nightVision 路径） ----------
  function hookNightVision() {
    if (W.__cometNVHooked) return;
    if (typeof W.nightVisionScale !== 'function') return;
    const orig = W.nightVisionScale;
    W.nightVisionScale = function (p) {
      const v = orig.call(this, p);
      try { return (modOn('fullbright') || modOn('nightvision')) ? Math.max(v, 1) : v; } catch (err) { return v; }
    };
    W.__cometNVHooked = true;
  }

  // ---------- 渲染循环挂钩 ----------
  let renderHooked = false, hookedOrig = null, hookedProto = null;
  function hookRender() {
    try {
      const G = state.game && state.game.constructor;
      if (!G || !G.prototype || typeof G.prototype.render !== 'function') return false;
      if (G.prototype.__cometRenderHooked) { renderHooked = true; return true; }
      hookedProto = G.prototype;
      hookedOrig = G.prototype.render;
      G.prototype.render = function (a, now) {
        if (modOn('spin')) spinAngle += (Number(getS('spin', 'speed')) || 0.6) * 0.016 * Math.PI * 2;
        const out = hookedOrig.call(this, a, now);
        try { onFrame(a); } catch (e) { /* noop */ }
        return out;
      };
      // 游戏画玩家身体用 playerBodyYaw()，相机 lookDir()/第三人称机位用 p.yaw。
      // 上一版直接改 p.yaw，视角就跟着一起疯转；这里只给「身体朝向的返回值」加偏移，
      // 不改玩家状态，第一/第三人称视角都保持不动。
      if (typeof G.prototype.playerBodyYaw === 'function' && !G.prototype.__cometBodyHooked) {
        const origBody = G.prototype.playerBodyYaw;
        G.prototype.playerBodyYaw = function (a) {
          const v = origBody.call(this, a);
          if (!modOn('spin')) return v;
          return v + spinAngle * (getS('spin', 'reverse') === true ? -1 : 1);
        };
        G.prototype.__cometBodyHooked = true;
      }
      G.prototype.__cometRenderHooked = true;
      renderHooked = true;
      return true;
    } catch (e) { return false; }
  }

  // 进入/切换世界（含进服、死亡复活、切维度）时，游戏会重建 Player 实例并替换
  // game.player；标题界面拿到的是预览玩家，坐标与朝向永远不动。若一直用最初的
  // 引用，坐标/罗盘就会"卡死"，光环按错误距离判定而不攻击，飞行/加速等写入也
  // 全落在废对象上。这里每帧重新对齐游戏与玩家实例。
  function syncRefs() {
    try {
      const g = W.game;
      if (g && typeof g === 'object' && g.player) {
        if (state.game !== g) {
          state.game = g;
          hookRender();
          console.log('[Comet] 游戏实例已更新');
        }
        if (state.player !== g.player) {
          state.player = g.player;
          refreshHud();
          console.log('[Comet] 玩家实例已更新（进入/切换世界）');
        }
        return;
      }
      if (state.game && state.game.player && state.game.player !== state.player) {
        state.player = state.game.player;
        refreshHud();
      }
    } catch (e) { /* noop */ }
  }

  function pollRef(tries) {
    if (state.player) return;
    const found = tryGlobalMount() || scanWindow();
    if (found) {
      state.game = found.game;
      state.player = found.player;
      state.flavor = found.key;
      console.log('[Comet] 引用接入成功:', found.key);
      // GUI 开着时拦下游戏的指针锁定（点 GUI / 点空白都不再锁视角）
      try {
        if (state.game && typeof state.game.capturePointer === 'function') {
          const origCap = state.game.capturePointer;
          state.game.capturePointer = function () {
            if (guiOpen()) return;
            return origCap.call(this);
          };
        }
      } catch (e) { /* noop */ }
      if (!hookRender()) startFallbackLoop();
      hookNightVision();
      applyGate();
      return;
    }
    if (tries < REF_POLL_MAX_TRIES) setTimeout(() => pollRef(tries + 1), REF_POLL_MS);
  }

  // ---------- 战斗 / 移动 / 环境 ----------
  const HOSTILE = new Set([
    'SkeletonKind', 'ZombieKind', 'CaveSpider', 'Crawler', 'Slime', 'SulfurCube',
    'Phantom', 'Witch', 'Illager', 'Pillager', 'Vindicator', 'Evoker', 'EvokerFangs',
    'Vex', 'Ravager', 'Breeze', 'Creaking', 'Warden', 'Shulker', 'Zoglin', 'Wither',
    'Blaze', 'Ghast', 'MagmaCube', 'Piglin', 'Hoglin', 'ZombifiedPiglin', 'Enderman',
    'Guardian', 'Drowned', 'EnderDragon',
  ]);

  let auraTarget = null;
  let lastTarget = null;
  let lastTargetAt = 0;
  let respawnAt = 0;

  const AURA_TARGET_COUNT = (() => {
    const m = MODULES.find((x) => x.id === 'aura');
    const s = m && m.settings.find((x) => x.id === 'targets');
    return s && Array.isArray(s.options) ? s.options.length : 0;
  })();

  function isCombatTarget(e) {
    try {
      const sel = getS('aura', 'targets');
      if (Array.isArray(sel) && sel.length) {
        // 全选 = 所有生物（含清单外的铁傀儡等）
        if (AURA_TARGET_COUNT && sel.length >= AURA_TARGET_COUNT) return true;
        const cls = (e.constructor && e.constructor.name) || '';
        const key = e.type === 'player' ? '玩家' : ((e.T && e.T.cn) || cnName(e));
        return sel.indexOf(key) !== -1 || sel.indexOf(cls) !== -1;
      }
      if (e.type === 'player') return getS('aura', 'players') !== false;
      if (e.T) return !!e.T.hostile;
    } catch (err) { /* noop */ }
    const n = e.constructor && e.constructor.name;
    return HOSTILE.has(n);
  }

  function targetPos(e) {
    try {
      if (Array.isArray(e.pos)) return e.pos;
      if (Array.isArray(e.position)) return e.position;
      if (typeof e.x === 'number') return [e.x, e.y, e.z];
    } catch (err) { /* noop */ }
    return null;
  }

  function rotateTo(p, e) {
    const tp = targetPos(e);
    const pp = targetPos(p);
    if (!tp || !pp) return;
    const dx = tp[0] - pp[0], dz = tp[2] - pp[2];
    if (Math.abs(dx) < 0.01 && Math.abs(dz) < 0.01) return;
    p.yaw = Math.atan2(-dx, -dz);
    const dy = (tp[1] + 0.9) - (pp[1] + 1.62);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }

  function findAuraTarget(g, p, range) {
    let best = null, bd = range * range;
    let ents;
    try { ents = g.entities; } catch (e) { return null; }
    if (!Array.isArray(ents)) return null;
    const pp = targetPos(p);
    if (!pp) return null;
    for (const e of ents) {
      if (!e || e === p || e.dead) continue;
      if (e.health == null || e.maxHealth == null) continue;
      if (!isCombatTarget(e)) continue;
      const tp = targetPos(e);
      if (!tp) continue;
      const dx = tp[0] - pp[0], dy = tp[1] - pp[1], dz = tp[2] - pp[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bd) { bd = d2; best = e; }
    }
    return best;
  }

  // 联机（服务器权威）：game.net 存在时世界和伤害都由服务器计算
  function isMP(g) {
    try { return !!(g && g.net); } catch (e) { return false; }
  }

  // 攻击：单机直接算伤害；联机必须发包（本地调用 g.attack 只会打到本地副本）
  function attackEntity(g, e) {
    const net = g.net;
    if (net && typeof net.send === 'function' && e && e.netId != null) {
      net.send({ t: 'attack', id: e.netId });
      net.send({ t: 'swing' });
      const p = state.player;
      if (p && typeof p.swing === 'function') p.swing();
      if (p) p.attackT = 0;
      if (typeof g.attackCd === 'number') g.attackCd = 4;
      return true;
    }
    g.attack(e);
    return false;
  }

  function tickAura(g, p) {
    const range = getS('aura', 'range') ?? 4.5;
    const target = findAuraTarget(g, p, range);
    auraTarget = target;
    if (!target) return;
    if (getS('aura', 'rotate') === true) rotateTo(p, target);
    if (typeof g.attackCd === 'number' && g.attackCd > 0) return;
    let strength = 1;
    try { strength = g.attackStrength(0.5); } catch (e) { return; }
    if (typeof strength !== 'number' || strength < (getS('aura', 'strength') ?? 0.9)) return;
    try {
      attackEntity(g, target);
      lastTarget = target;
      lastTargetAt = performance.now();
    } catch (e) { /* noop */ }
  }

  function tickTrigger(g) {
    auraTarget = null;
    const e = g.targetEntity;
    if (!e || e.dead || e.health == null) return;
    if (!isCombatTarget(e)) return;
    const p = state.player;
    const pp = targetPos(p), tp = targetPos(e);
    if (!pp || !tp) return;
    const range = getS('triggerbot', 'range') ?? 3.5;
    const dx = tp[0] - pp[0], dy = tp[1] - pp[1], dz = tp[2] - pp[2];
    if (dx * dx + dy * dy + dz * dz > range * range) return;
    if (g.attackCd > 0) return;
    let strength = 1;
    try { strength = g.attackStrength(0.5); } catch (err) { return; }
    if (strength < (getS('triggerbot', 'strength') ?? 0.9)) return;
    try {
      attackEntity(g, e);
      lastTarget = e;
      lastTargetAt = performance.now();
    } catch (err) { /* noop */ }
  }

  // ---------- 千手观音 / 弓箭辅助 / 自动搭路 / 灵魂出窍 ----------
  const LOOK_EYE = 1.62;

  function lookFrom(yaw, pitch) {
    return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  }

  function entityCenter(e) {
    const tp = targetPos(e);
    if (!tp) return null;
    const h = num(e, 'h') ?? 1.8;
    return [tp[0], tp[1] + h * 0.5, tp[2]];
  }

  function collectCombatTargets(g, p, range) {
    const out = [];
    try {
      const ents = g.entities;
      if (!Array.isArray(ents)) return out;
      const pp = targetPos(p);
      if (!pp) return out;
      for (const e of ents) {
        if (!e || e === p || e.dead) continue;
        if (e.health == null || e.maxHealth == null) continue;
        if (!isCombatTarget(e)) continue;
        const tp = targetPos(e);
        if (!tp) continue;
        const d2 = (tp[0] - pp[0]) * (tp[0] - pp[0]) + (tp[1] - pp[1]) * (tp[1] - pp[1]) + (tp[2] - pp[2]) * (tp[2] - pp[2]);
        if (d2 <= range * range) out.push({ e, d2 });
      }
      out.sort((a, b) => a.d2 - b.d2);
    } catch (err) { /* noop */ }
    return out;
  }

  // 千手观音：一次挥击打中范围内全部（或前 N 个）目标
  function tickMultiAura(g, p) {
    const range = getS('multiaura', 'range') ?? 4.5;
    const max = Math.max(1, Math.round(getS('multiaura', 'max') ?? 3));
    const list = collectCombatTargets(g, p, range);
    auraTarget = list.length ? list[0].e : null;
    if (!list.length) return;
    if (typeof g.attackCd === 'number' && g.attackCd > 0) return;
    let strength = 1;
    try { strength = g.attackStrength(0.5); } catch (e) { return; }
    if (typeof strength !== 'number' || strength < (getS('multiaura', 'strength') ?? 0.9)) return;
    let hit = 0;
    for (const it of list) {
      if (hit >= max) break;
      try {
        attackEntity(g, it.e);
        hit++;
        lastTarget = it.e;
        lastTargetAt = performance.now();
      } catch (err) { /* noop */ }
    }
  }

  // 弓箭辅助：按抛物线补偿自动瞄准，可选拉满自动射击
  function tickBowAim(g, p) {
    try {
      const held = p.inv && p.inv.held;
      const par = held ? projParams(p, held) : null;
      if (!par || !par.bow) { bowAimState.target = null; bowAimState.aim = null; return; }
      const range = Number(getS('bowaim', 'range')) || 40;
      const pp = targetPos(p);
      if (!pp) return;
      const eye = [pp[0], pp[1] + LOOK_EYE, pp[2]];
      const look = lookFrom(yawRad(num(p, 'yaw')), num(p, 'pitch') ?? 0);
      const wantPlayers = getS('bowaim', 'players') !== false;
      let best = null, bestScore = Infinity;
      const ents = g.entities;
      if (!Array.isArray(ents)) return;
      for (const e of ents) {
        if (!e || e === p || e.dead || e.health == null) continue;
        if (!wantPlayers && e.type === 'player') continue;
        const ce = entityCenter(e);
        if (!ce) continue;
        const dx = ce[0] - eye[0], dy = ce[1] - eye[1], dz = ce[2] - eye[2];
        const d = Math.hypot(dx, dy, dz);
        if (d > range || d < 0.6) continue;
        const dot = (dx * look[0] + dy * look[1] + dz * look[2]) / d;
        if (dot < 0.2) continue;
        const score = d * (2 - dot);
        if (score < bestScore) { bestScore = score; best = e; }
      }
      if (!best) { bowAimState.target = null; bowAimState.aim = null; return; }
      const ce = entityCenter(best);
      if (!ce) return;
      // 移动目标提前量：按弹速与目标速度迭代求「该往哪打」
      const vel = getS('bowaim', 'lead') !== false ? entityVel(best) : [0, 0, 0];
      const aim = leadPoint(eye, ce, vel, par.speed);
      aim[1] += Number(getS('bowaim', 'zero')) || 0;   // 弹道校准：默认补偿落点偏低
      const switched = bowAimState.target && bowAimState.target !== best;
      if (switched) bowAimState.sol = null;            // 换目标立刻重算，但转视角仍平滑
      bowAimState.switched = !!switched;
      bowAimState.target = best;
      bowAimState.aim = aim;
      const w = g.world;
      if (w) {
        bowAimState.tick++;
        // 数值扫 pitch 比较重，每 4 帧解一次，中间帧沿用
        if (bowAimState.tick % 4 === 1 || !bowAimState.sol) {
          bowAimState.sol = solveBallistic(eye, aim, par, w);
        }
      }
      const sol = bowAimState.sol;
      if (sol && getS('bowaim', 'rotate') !== false) {
        let sm = Math.max(0, Math.min(0.95, Number(getS('bowaim', 'smooth')) || 0));
        if (bowAimState.switched) sm = Math.min(0.95, sm + 0.3);
        let dyaw = sol.yaw - p.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        p.yaw += dyaw * (1 - sm);
        const pt = Math.max(-1.55, Math.min(1.55, sol.pitch));
        p.pitch += (pt - p.pitch) * (1 - sm);
      }
      // 默认：自动蓄力 + 拉满自动松手（平滑瞄准由上面的 smooth 控制）
      if (getS('bowaim', 'auto') !== false || getS('bowaim', 'autoCharge') !== false) {
        if (p.usingItem === held.id) {
          if ((p.useT || 0) >= 20) {
            if (g.mouseBtn) g.mouseBtn[2] = false;
            p.__cometBowHold = false;
          } else {
            if (g.mouseBtn) g.mouseBtn[2] = true;
            p.__cometBowHold = true;
          }
        } else if (!(typeof g.useCd === 'number' && g.useCd > 0)) {
          if (g.mouseBtn) g.mouseBtn[2] = true;
          p.__cometBowHold = true;
        }
      } else if (p.__cometBowHold) {
        if (g.mouseBtn) g.mouseBtn[2] = false;
        p.__cometBowHold = false;
      }
    } catch (err) { /* noop */ }
  }

  function blockDefOf(id) {
    try { return W.BLOCK_DATA ? W.BLOCK_DATA[id] : null; } catch (e) { return null; }
  }
  function isSolidAt(w, x, y, z) {
    try {
      const id = w.getBlock(x, y, z);
      if (!id) return false;
      const d = blockDefOf(id);
      return !!(d && d.solid);
    } catch (e) { return false; }
  }

  let scafAt = 0;
  // 自动搭路：前进时在脚前下方铺手里的方块
  function tickScaffold(g, p) {
    try {
      const now = performance.now();
      if (now - scafAt < 60) return;
      const held = p.inv && p.inv.held;
      if (!held || held.id == null) return;
      // blocks.js: 方块物品的 ITEMS[id] 带 `block: <方块id>`；食物/工具没有这个字段。
      // 旧版拿 held.id（物品 id）兜底，羊肉之类就被当方块 id 放出了不相干的方块。
      let blockId = null;
      try {
        const def = (typeof W.itemDef === 'function') ? W.itemDef(held.id)
          : (W.ITEMS && W.ITEMS[held.id]) || null;
        if (def) {
          if (def.block == null) return;       // 不是方块物品：绝对不放置
          blockId = def.block;                 // 权威方块 id，不用猜
        } else {
          // itemDef 拿不到时，只在能确证是方块的情况下才放
          const bd2 = blockDefOf(held.id);
          if (bd2 && bd2.id != null && bd2.solid !== undefined) blockId = bd2.id;
        }
      } catch (e) { return; }
      if (blockId == null) return;
      const w = g.world;
      if (!w) return;
      let inp = null;
      try { inp = g.readInput ? g.readInput() : null; } catch (e) { /* noop */ }
      const moving = inp ? (inp.fwd > 0 || inp.strafe > 0 || inp.strafe < 0) : true;
      if (!moving) return;
      const pp = targetPos(p);
      if (!pp) return;
      const bx = Math.floor(pp[0]), by = Math.floor(pp[1]), bz = Math.floor(pp[2]);
      let ax = bx, az = bz;
      if (getS('scaffold', 'ahead') !== false) {
        const look = g.lookDir ? g.lookDir() : lookFrom(yawRad(num(p, 'yaw')), 0);
        if (Math.abs(look[0]) > Math.abs(look[2])) ax += look[0] > 0 ? 1 : -1;
        else if (Math.abs(look[2]) > 1e-3) az += look[2] > 0 ? 1 : -1;
      }
      const ay = by - 1;
      if (w.getBlock(ax, ay, az) !== 0) return;
      // 找相邻可贴的实心方块（用于联机发包的 face）
      const N = [[-1, 0, 0, 1], [1, 0, 0, 0], [0, -1, 0, 3], [0, 1, 0, 2], [0, 0, -1, 5], [0, 0, 1, 4]];
      let nb = null;
      for (const n of N) {
        const nx = ax + n[0], ny = ay + n[1], nz = az + n[2];
        if (!isSolidAt(w, nx, ny, nz)) continue;
        nb = { x: nx, y: ny, z: nz, face: n[3] };
        break;
      }
      const net = g.net;
      if (net && typeof net.send === 'function') {
        if (!nb) return;
        const NET_FACE = [4, 5, 0, 1, 2, 3];
        net.send({
          t: 'place', item: def.key,
          x: nb.x, y: nb.y + (typeof net.minY === 'number' ? net.minY : 0), z: nb.z,
          face: NET_FACE[nb.face] ?? 1, cx: 0.5, cy: 0.5, cz: 0.5,
        });
        p.swing();
        if (typeof net.send === 'function') net.send({ t: 'swing' });
      } else {
        // 游戏没有 placeAt，单机放置走 world.setBlock(x,y,z,id,meta)
        if (typeof w.setBlock !== 'function') return;
        w.setBlock(ax, ay, az, blockId, 0);
        try {
          if (Number(held.count) > 1) held.count--;
          else if (p.inv && Array.isArray(p.inv.slots)) p.inv.slots[p.inv.sel | 0] = null;
        } catch (e) { /* noop */ }
        if (typeof p.swing === 'function') p.swing();
      }
      scafAt = now;
    } catch (err) { /* noop */ }
  }

  // 灵魂出窍：相机脱离身体
  const fcKeys = {};
  state.fc = { active: false, pos: null, yaw: 0, pitch: 0, bodyYaw: 0, bodyPitch: 0, last: 0 };
  let freecamListeners = false;
  function installFreecamListeners() {
    if (freecamListeners) return;
    freecamListeners = true;
    W.addEventListener('keydown', (e) => { fcKeys[e.code] = true; }, true);
    W.addEventListener('keyup', (e) => { fcKeys[e.code] = false; }, true);
    W.addEventListener('blur', () => { for (const k in fcKeys) fcKeys[k] = false; });
    W.addEventListener('mousemove', (e) => {
      const st = state.fc;
      if (!st || !st.active) return;
      if (guiOpen()) return;
      const s = 0.0024;
      st.yaw -= (e.movementX || 0) * s;
      st.pitch = Math.max(-1.55, Math.min(1.55, st.pitch - (e.movementY || 0) * s));
    });
  }
  function ensureFreecamHooks(g) {
    try {
      if (g.readInput && !g.__cometFcInput) {
        const orig = g.readInput;
        g.readInput = function () {
          const r = orig.apply(this, arguments);
          if (state.fc && state.fc.active && getS('freecam', 'body') !== false) {
            try {
              return Object.assign({}, r || {}, { fwd: 0, strafe: 0, jump: false, sneak: false, sprint: false });
            } catch (e) { /* noop */ }
          }
          return r;
        };
        g.__cometFcInput = true;
      }
      const r = g.renderer;
      if (r && !r.__cometFcCam && typeof r.setCamera === 'function') {
        const orig = r.setCamera;
        r.setCamera = function (pos, yaw, pitch, fov, extra) {
          const st = state.fc;
          if (st && st.active && st.pos) {
            return orig.call(this, st.pos.slice(), st.yaw, st.pitch, fov, extra);
          }
          return orig.apply(this, arguments);
        };
        r.__cometFcCam = true;
      }
    } catch (e) { /* noop */ }
  }

  function tickFreecam(g, p) {
    const st = state.fc;
    if (!st.active) {
      const pp = targetPos(p);
      if (!pp) return;
      ensureFreecamHooks(g);
      st.active = true;
      st.pos = [pp[0], pp[1] + LOOK_EYE, pp[2]];
      st.yaw = yawRad(num(p, 'yaw'));
      st.pitch = num(p, 'pitch') ?? 0;
      st.bodyYaw = num(p, 'yaw') ?? 0;
      st.bodyPitch = st.pitch;
      st.last = performance.now();
      return;
    }
    ensureFreecamHooks(g);
    if (getS('freecam', 'body') !== false) {
      p.yaw = st.bodyYaw;
      p.pitch = st.bodyPitch;
    }
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - st.last) / 1000));
    st.last = now;
    const k = fcKeys;
    const fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    const strafe = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const up = (k.Space ? 1 : 0) - ((k.ShiftLeft || k.ShiftRight) ? 1 : 0);
    const sp = (getS('freecam', 'speed') ?? 1.5) * 8 * dt;
    const f = lookFrom(st.yaw, st.pitch);
    const rx = Math.cos(st.yaw), rz = -Math.sin(st.yaw);
    st.pos[0] += (f[0] * fwd + rx * strafe) * sp;
    st.pos[1] += (f[1] * fwd + up) * sp;
    st.pos[2] += (f[2] * fwd + rz * strafe) * sp;
  }

  // ---------- 移动类模块：飞行 / 加速 / 上台阶 / 免摔伤 ----------
  let flyTapAt = 0;
  function installFlyKeys() {
    if (W.__cometFlyKeys) return;
    W.__cometFlyKeys = true;
    W.addEventListener('keydown', (e) => {
      try {
        if (!modOn('fly')) return;
        if (e.code !== 'Space' && e.keyCode !== 32) return;
        if (e.repeat) return;
        const g = state.game, p = state.player;
        if (!g || !p) return;
        // 创造 / 旁观模式游戏本身就支持双击空格，交给原版处理，避免互相抵消
        if (g.mode === 'creative' || g.mode === 'spectator') return;
        // 聊天 / 背包 / 面板打开时不抢空格
        if (g.ui && g.ui.screen) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        const now = performance.now();
        if (now - flyTapAt < 300) {
          // 原版创造飞行：双击空格切换；关闭时自然下坠
          p.flying = !p.flying;
          if (p.vel) p.vel[1] = 0;
          p.gliding = false;
          p.fallDist = 0;
          flyTapAt = 0;
        } else {
          flyTapAt = now;
        }
      } catch (err) { /* noop */ }
    }, true);
  }

  function ensureFlyHook(p) {
    if (p.__cometFlyHook) return;
    try {
      let o = Object.getPrototypeOf(p), d = null;
      while (o && !d) { d = Object.getOwnPropertyDescriptor(o, 'creative'); o = Object.getPrototypeOf(o); }
      if (!d || typeof d.get !== 'function') return;
      const orig = d.get;

      // 飞行物理需要 creative，但 HUD 的血条 / 饥饿值只在 !creative 时绘制。
      // 所以只在 Player.tick 执行期间把 creative 当 true 用，tick 之外照常按真实模式，
      // 这样开着飞行也不会把血条和物品栏吃掉。
      let proto = Object.getPrototypeOf(p);
      while (proto && !Object.getOwnPropertyDescriptor(proto, 'tick')) proto = Object.getPrototypeOf(proto);
      if (proto && !proto.__cometTickFly) {
        const ot = proto.tick;
        if (typeof ot === 'function') {
          proto.tick = function (input) {
            let on = false;
            try { on = modOn('fly'); } catch (e) { /* noop */ }
            if (on) this.__cometTick = true;
            try { return ot.call(this, input); } finally { if (on) this.__cometTick = false; }
          };
          proto.__cometTickFly = true;
        }
      }

      Object.defineProperty(p, 'creative', {
        configurable: true,
        get() { try { if (this.__cometTick) return true; } catch (e) { /* noop */ } return orig.call(this); },
      });
      p.__cometFlyHook = true;
    } catch (e) { /* noop */ }
  }

  function tickMovement(g, p) {
    if (modOn('fly')) {
      ensureFlyHook(p);
      installFlyKeys();
      p.__cometFlyOn = true;
      if (p.flying) { p.fallDist = 0; p.gliding = false; }
    } else if (p.__cometFlyOn) {
      p.__cometFlyOn = false;
      p.flying = false;
    }

    if (modOn('step')) {
      p.__cometStepOn = true;
      p.stepHeight = 1;
    } else if (p.__cometStepOn) {
      p.__cometStepOn = false;
      p.stepHeight = 0;
    }

    // 游戏 onLand() 第一行是 `if (this.slowFall) return`，只清 fallDist 会被物理 tick 抢先；
    // 同时置 slowFall 才是可靠的免摔伤，关闭时还原原值。
    if (modOn('nofall')) {
      p.fallDist = 0;
      if (p.__cometSlowFallSaved === undefined) p.__cometSlowFallSaved = !!p.slowFall;
      p.slowFall = true;
    } else if (p.__cometSlowFallSaved !== undefined) {
      p.slowFall = p.__cometSlowFallSaved;
      p.__cometSlowFallSaved = undefined;
    }

    const mult = getS('speed', 'mult') ?? 1.5;
    if (modOn('speed') && mult > 1) {
      if (!p.__cometOrigSpeedBonus) {
        p.__cometOrigSpeedBonus = p.speedBonus;
        p.speedBonus = function () {
          const b = this.__cometOrigSpeedBonus ? this.__cometOrigSpeedBonus.call(this) : 0;
          return b + 0.1 * ((getS('speed', 'mult') ?? 1.5) - 1);
        };
      }
    } else if (p.__cometOrigSpeedBonus) {
      p.speedBonus = p.__cometOrigSpeedBonus;
      p.__cometOrigSpeedBonus = null;
    }
  }

  // 刀刀暴击：攻击瞬间伪造“下落中 + 未落地 + 蓄力拉满”，让游戏判定暴击（伤害 ×1.5）
  function ensureCritHook(g) {
    if (g.__cometCritHook || typeof g.attack !== 'function') return;
    const oa = g.attack;
    g.attack = function () {
      const p = state.player;
      if (!modOn('crit') || this !== state.game || !p) return oa.apply(this, arguments);
      const s = { og: p.onGround, iw: p.inWater, vy: p.vel ? p.vel[1] : 0 };
      p.onGround = false;
      p.inWater = false;
      if (p.vel) p.vel[1] = -0.1;
      p.attackT = 1e3; // attackStrength 拉满，str = 1
      try {
        return oa.apply(this, arguments);
      } finally {
        p.onGround = s.og;
        p.inWater = s.iw;
        if (p.vel) p.vel[1] = s.vy;
        if ((p.attackT || 0) > 100) p.attackT = 0;
      }
    };
    g.__cometCritHook = true;
  }

  // 自动进食：饥饿值低于阈值且手持食物时，替玩家按住"右键"
  function tickAutoEat(g, p) {
    try {
      const keep = p.__cometEat;
      const threshold = getS('autoeat', 'threshold') ?? 16;
      const held = p.inv && p.inv.held;
      let isFood = false;
      if (held && typeof W.itemDef === 'function') {
        const d = W.itemDef(held.id);
        isFood = !!(d && d.food);
      }
      const hungry = typeof p.food === 'number' && p.food < threshold;
      if (modOn('autoeat') && hungry && isFood) {
        if (!keep) p.__cometEat = { prev: !!(g.mouseBtn && g.mouseBtn[2]) };
        if (g.mouseBtn) g.mouseBtn[2] = true;
        if (typeof g.useCd === 'number') g.useCd = 0;
      } else if (keep) {
        if (g.mouseBtn) g.mouseBtn[2] = !!keep.prev;
        p.__cometEat = null;
      }
    } catch (e) { /* noop */ }
  }

  function tickModules() {
    syncRefs();
    const g = state.game, p = state.player;
    if (!g || !p) { if (state.fc.active) state.fc.active = false; return; }
    // 只把明确的非游玩状态挡掉；线上版本 state 值可能是 game/playing/inworld，
    // 旧写法 `!== 'play'` 会让所有 tick 模块静默失效。
    const gs = String(g.state || '').toLowerCase();
    if (gs && ['boot', 'title', 'loading', 'menu', 'pause', 'paused'].indexOf(gs) >= 0) {
      if (state.fc.active) state.fc.active = false;
      return;
    }

    // 联机提示：服务器权威，移动/伤害由服务器判定
    const mp = isMP(g);
    if (mp && !state.mpSeen) {
      state.mpSeen = true;
      pushNotification('联机模式', '战斗已改为发包；飞行/加速/瞬间破坏/刀刀暴击受服务器判定');
    } else if (!mp && state.mpSeen) {
      state.mpSeen = false;
    }

    if (modOn('autosprint') && p.health > 0 && !p.sneaking && !p.usingItem) {
      try {
        const inp = g.readInput ? g.readInput() : null;
        if (inp && inp.fwd > 0) p.sprinting = true;
        else if (getS('autosprint', 'onlyforward') === false) p.sprinting = true;
      } catch (e) { /* noop */ }
    }

    tickMovement(g, p);

    if (modOn('crit')) ensureCritHook(g);
    if (modOn('autojump')) {
      try {
        if (!p.__cometAutoJump) p.__cometAutoJump = { v: !!(g.settings && g.settings.autoJump) };
        if (g.settings) g.settings.autoJump = true;
      } catch (e) { /* noop */ }
    } else if (p.__cometAutoJump) {
      try { if (g.settings) g.settings.autoJump = p.__cometAutoJump.v; } catch (e) { /* noop */ }
      p.__cometAutoJump = null;
    }
    tickAutoEat(g, p);
    if (modOn('waterbreath') && p.air > 0 && (p.inWater || p.eyeInWater)) p.air = 300;

    // 破坏类：快速破坏（加速挖掘进度）/ 瞬间破坏（开始挖就炸掉）
    if (modOn('fastbreak') || modOn('instantbreak')) {
      if (!g.__cometBreakHook && typeof g.breakSpeed === 'function') {
        const _bs = g.breakSpeed;
        g.breakSpeed = function (id) {
          const v = _bs.call(this, id);
          try { if (modOn('fastbreak')) return v * (getS('fastbreak', 'mult') ?? 8); } catch (e) { /* noop */ }
          return v;
        };
        g.__cometBreakHook = true;
      }
      const br = g.breaking;
      if (modOn('instantbreak') && br && Array.isArray(br.pos) && br.progress > 0) {
        try {
          const net = g.net;
          if (net && typeof net.dig === 'function' && g.target) {
            // 联机：先开挖再立刻完成，让服务器按 dig 包结算
            net.dig(0, g.target);
            net.dig(2, g.target);
            net.digging = null;
            if (typeof g.netBreak === 'function') g.netBreak(g.target.pos);
          } else {
            g.breakBlock(br.pos[0], br.pos[1], br.pos[2], false);
          }
          g.breaking = null;
          g.attackCd = Math.max(Number(g.attackCd) || 0, 5);
        } catch (e) { /* noop */ }
      }
    }

    if (modOn('aura')) tickAura(g, p);
    if (modOn('multiaura')) tickMultiAura(g, p);
    if (modOn('triggerbot')) tickTrigger(g);
    if (modOn('bowaim')) tickBowAim(g, p);
    if (modOn('scaffold')) tickScaffold(g, p);
    if (modOn('freecam')) tickFreecam(g, p);
    else if (state.fc.active) state.fc.active = false;

    if (modOn('autorespawn')) {
      const dead = (typeof p.deathTime === 'number' && p.deathTime > 0) || p.dead;
      const now = performance.now();
      if (dead && now > respawnAt) {
        respawnAt = now + 1500;
        try { g.respawn(); } catch (e) { /* noop */ }
      }
    }

    if (modOn('ambience')) {
      try {
        if (getS('ambience', 'freeze') !== false) {
          const t = getS('ambience', 'time');
          if (typeof t === 'number' && typeof g.worldTime === 'number') g.worldTime = t;
        }
        const w = getS('ambience', 'weather');
        if (w) g.weather = (w === 'Rain' || w === '下雨') ? 1 : 0;
      } catch (e) { /* noop */ }
    }

    try { extTick(g, p); } catch (e) { /* noop */ }
    try { extTickB(g, p); } catch (e) { /* noop */ }
    try { extTickC(g, p); } catch (e) { /* noop */ }
    try { extTickD(g, p); } catch (e) { /* noop */ }
  }

  // ---------- ESP / 雷达 / 罗盘 画布 ----------
  const espCanvas = document.createElement('canvas');
  espCanvas.id = '__comet_esp';
  const ectx = espCanvas.getContext('2d');

  const radar = document.createElement('canvas');
  radar.id = '__comet_radar';
  radar.width = 240; radar.height = 240;
  const rctx = radar.getContext('2d');

  const compass = document.createElement('canvas');
  compass.id = '__comet_compass';
  compass.width = 600; compass.height = 80;
  const cctx = compass.getContext('2d');

  const COLORS = {
    hostile: '#ff5252', passive: '#4fc3f7', player: '#c084fc',
    line: 'rgba(255,82,82,0.65)', text: '#ffffff',
    hpBg: 'rgba(0,0,0,0.55)', hpFill: '#e8e8e8',
  };

  function colorOf(e) {
    try {
      if (e.T) { if (e.T.hostile) return COLORS.hostile; if (e.T.passive) return COLORS.passive; }
      if (e.type === 'player') return COLORS.player;
    } catch (err) { /* noop */ }
    const name = (e.constructor && e.constructor.name) || '';
    if (name === 'Player' || name === 'NetPlayer') return COLORS.player;
    if (HOSTILE.has(name)) return COLORS.hostile;
    return COLORS.passive;
  }

  function isPlayerEntity(e) {
    try {
      return !!(e && (e.type === 'player' || (e.constructor && e.constructor.name === 'NetPlayer')));
    } catch (err) { return false; }
  }

  // 生物 / 玩家 / 掉落物：ESP 与追踪线分类型取色
  function entityCat(e, isMob) {
    if (!isMob) return 'item';
    return isPlayerEntity(e) ? 'player' : 'mob';
  }
  function settingKeyForCat(cat) {
    return cat === 'item' ? 'itemColor' : cat === 'player' ? 'playerColor' : 'mobColor';
  }
  function typeColor(modId, e, isMob) {
    const cat = entityCat(e, isMob);
    return getS(modId, settingKeyForCat(cat)) || getS(modId, 'color') || '';
  }

  function hexToRgba(hex, a) {
    try {
      const h = String(hex).replace('#', '');
      const s = h.length === 3
        ? h.split('').map((c) => c + c).join('')
        : h.padEnd(6, '0').slice(0, 6);
      const n = parseInt(s, 16);
      if (!isFinite(n)) return 'rgba(255,82,82,' + a + ')';
      return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    } catch (err) { return 'rgba(255,82,82,' + a + ')'; }
  }

  function displayName(e) {
    let n = cnName(e);
    try {
      const raw = String(getS('nametags', 'alias') || '');
      for (const pair of raw.split(/[,，;；]/)) {
        const i = pair.indexOf('=');
        if (i < 0) continue;
        const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
        if (k && v && n.indexOf(k) >= 0) { n = n.replace(k, v); break; }
      }
    } catch (err) { /* noop */ }
    return n;
  }
  function heldOf(e) {
    try {
      if (e.inv && e.inv.held && e.inv.held.id != null) return e.inv.held.id;
      if (e.heldId != null) return e.heldId;
      if (e.hand && e.hand.id != null) return e.hand.id;
    } catch (err) { /* noop */ }
    return null;
  }
  function armorOf(e) {
    try {
      if (e.inv && Array.isArray(e.inv.slots)) return e.inv.slots.slice(36, 40);
      if (Array.isArray(e.armorItems)) return e.armorItems;
      if (e.gear) return [e.gear[0], e.gear[1], e.gear[2], e.gear[3]];
    } catch (err) { /* noop */ }
    return [];
  }
  function itemColor(id) {
    const h = (Math.abs(Number(id) || 0) * 47) % 360;
    return 'hsl(' + h + ',62%,62%)';
  }

  // 世界 → 屏幕投影（读游戏 renderer 的 vp 矩阵，列主序）
  function project(v, x, y, z, w_, h_) {
    const m = v.vp;
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.1) return null;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    return { x: (cx / cw * 0.5 + 0.5) * w_, y: (1 - (cy / cw * 0.5 + 0.5)) * h_ };
  }

  // ---------- 绘制工具（光环 / 方块高亮 / 轨迹 / 目标环 共用） ----------
  const trailPts = [];
  const draggables = [];
  // 游戏是 #gl（WebGL 3D）+ #ui（2D HUD）双画布：
  // 材质透视时只隐藏 #gl = 非矿石方块全部变成「空气」，HUD 照常显示。
  // 不动任何世界数据（不 setBlock），所以绝对不会破坏存档。
  let __xrayHidden = false;
  function applyXrayWorld(hide) {
    if (hide === __xrayHidden) return;
    __xrayHidden = hide;
    try {
      const gl = document.querySelector('#gl') || (state.game && state.game.canvas);
      if (gl && gl.classList) gl.classList.toggle('cm-xray-hidden', hide);
      document.documentElement.classList.toggle('cm-xray-on', hide);
    } catch (e) { /* noop */ }
  }
  const APPEARANCE_PRESETS = {
    '绚丽': { accent: '#b06bff', glow: 14, blur: 18, radius: 14, anim: 1.3, saturate: 1.5, bg: '#10121c', border: 0.75 },
    '平缓': { accent: '#6f9bd1', glow: 5, blur: 8, radius: 9, anim: 0.6, saturate: 1.05, bg: '#141821', border: 0.45 },
    '基本': { accent: '#8a8f99', glow: 0, blur: 0, radius: 4, anim: 0, saturate: 0.8, bg: '#0d1016', border: 0.25 },
  };
  const APPEARANCE_KEYS = ['accent', 'glow', 'blur', 'radius', 'anim', 'saturate', 'bg', 'border'];
  let __lastPreset = '绚丽';
  function accentRgb(hex) {
    try {
      const h = String(hex || '').replace('#', '');
      const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
      const n = parseInt(s, 16);
      return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
    } catch (e) { return '176,107,255'; }
  }
  function applyAppearance() {
    const gs2 = (k) => getS('appearance', k);
    const preset = String(gs2('preset') || '绚丽');
    const p = APPEARANCE_PRESETS[preset] || APPEARANCE_PRESETS['绚丽'];
    const val = (k) => { const v = gs2(k); return v == null || v === '' ? p[k] : v; };
    const accent = String(val('accent') || '').trim() || p.accent;
    const root = document.documentElement;
    root.style.setProperty('--cm-accent', accent);
    root.style.setProperty('--cm-accent-rgb', accentRgb(accent));
    root.style.setProperty('--cm-glow', String(Number(val('glow')) || 0));
    root.style.setProperty('--cm-blur', (Number(val('blur')) || 0) + 'px');
    root.style.setProperty('--cm-radius', (Number(val('radius')) || 0) + 'px');
    root.style.setProperty('--cm-anim', String(Math.max(0.1, Number(val('anim')) || 0.1)));
    root.style.setProperty('--cm-sat', String(Number(val('saturate')) || 1));
    root.style.setProperty('--cm-bg', String(val('bg') || '').trim() || p.bg);
    root.style.setProperty('--cm-border', String(Number(val('border')) || 0));
    gui.classList.toggle('fancy', preset === '绚丽');
    gui.classList.toggle('plain', preset === '基本');
    __lastPreset = preset;
  }
  function saveAppearanceSnapshot() {
    if (!cfg.appearance) cfg.appearance = {};
    const snap = {};
    for (const k of APPEARANCE_KEYS) snap[k] = getS('appearance', k);
    cfg.appearance.snapshot = snap;
    saveCfg();
  }
  function restoreAppearance() {
    if (!cfg.appearance) cfg.appearance = {};
    const snap = cfg.appearance.snapshot;
    if (!snap) { saveAppearanceSnapshot(); applyAppearance(); return; }
    for (const k of APPEARANCE_KEYS) {
      if (snap[k] !== undefined) cfg.settings['appearance.' + k] = snap[k];
    }
    __sCache = null;
    saveCfg();
    applyAppearance();
    refreshGui();
    pushNotification('外观设置', '已还原你之前的自定义外观');
  }
  function applyAppearancePreset(name) {
    const p = APPEARANCE_PRESETS[name];
    if (!p) return;
    for (const k of APPEARANCE_KEYS) cfg.settings['appearance.' + k] = p[k];
    __sCache = null;
    saveCfg();
    applyAppearance();
    refreshGui();
    pushNotification('外观设置', '已切换到「' + name + '」');
  }
  function perfLevel() {
    const v = String(getS('perf', 'level') || '自动');
    if (v !== '自动') return v;
    const fps = num(state.game, 'fps');
    if (fps && fps < 25) return '省电';
    if (fps && fps < 45) return '均衡';
    return '绚丽';
  }
  function perfGlow() {
    return perfLevel() === '绚丽' && getS('perf', 'noGlow') !== true;
  }
  function perfFx() {
    const lv = perfLevel();
    if (lv === '省电') return 0.4;
    if (lv === '均衡') return 0.7;
    return Math.max(0.3, Number(getS('perf', 'fxQuality')) || 1);
  }
  const bowAimState = { target: null, aim: null, sol: null, tick: 0 };
  const fxCanvas = document.createElement('canvas');
  fxCanvas.id = '__comet_fx';
  fxCanvas.width = 1280; fxCanvas.height = 720;
  const fxctx = fxCanvas.getContext('2d');

  function playerCenter(p, alpha) {
    let c = null;
    try {
      if (p && typeof p.ipos === 'function') {
        const ip = p.ipos(alpha == null ? 1 : alpha);
        if (ip && typeof ip[0] === 'number' && typeof ip[2] === 'number') c = ip;
      }
      if (!c && p && Array.isArray(p.pos) && typeof p.pos[0] === 'number') c = p.pos;
      if (!c && p && typeof p.x === 'number') c = [p.x, p.y, p.z];
    } catch (e) { c = null; }
    return c;
  }

  function withAlpha(color, a) {
    const s = String(color || '');
    if (s.charAt(0) === '#') return hexToRgba(s, a);
    if (s.indexOf('hsl(') === 0) return 'hsla(' + s.slice(4, -1) + ',' + a + ')';
    return s;
  }

  function hexToHue(hex) {
    const h = String(hex || '').replace('#', '');
    const s = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.padEnd(6, '0').slice(0, 6);
    const n = parseInt(s, 16);
    if (!isFinite(n)) return 280;
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return 0;
    let hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (hh * 60 + 360) % 360;
  }

  // 相机后方的点会被 project 剔除；分段连线，避免跨屏拉出长线
  function strokeRingPath(ctx, pts) {
    ctx.beginPath();
    let on = false;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i];
      if (!q || !isFinite(q.x) || !isFinite(q.y)) { on = false; continue; }
      if (!on) { ctx.moveTo(q.x, q.y); on = true; }
      else ctx.lineTo(q.x, q.y);
    }
  }

  // 近平面裁剪：相机后方的圆环点不再直接丢弃，而是压到近平面上取一个屏幕边缘坐标。
  // 这样 3D 圆环在任何俯仰 / 第三人称角度都是闭合的，紫色填充不会残缺或整块消失。
  function ringProject(v, coords, W_, H_, closed) {
    const m = v.vp, EPS = 0.08;
    const raw = coords.map((q) => ({
      cw: m[3] * q[0] + m[7] * q[1] + m[11] * q[2] + m[15],
      cx: m[0] * q[0] + m[4] * q[1] + m[8] * q[2] + m[12],
      cy: m[1] * q[0] + m[5] * q[1] + m[9] * q[2] + m[13],
    }));
    const n = raw.length;
    const scr = (c) => ({ x: (c.cx / c.cw * 0.5 + 0.5) * W_, y: (1 - (c.cy / c.cw * 0.5 + 0.5)) * H_ });
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = raw[i];
      if (a.cw > EPS) { out[i] = scr(a); continue; }
      let prev = null, next = null;
      for (let s = 1; s < n && (!prev || !next); s++) {
        if (!prev) { const p = raw[(i - s + n) % n]; if (p.cw > EPS) prev = p; }
        if (!next) { const p = raw[(i + s) % n]; if (p.cw > EPS) next = p; }
      }
      if (!prev || !next) { out[i] = null; continue; }
      const cross = (p) => {
        const t = (EPS - p.cw) / (a.cw - p.cw);
        return { cw: EPS, cx: p.cx + (a.cx - p.cx) * t, cy: p.cy + (a.cy - p.cy) * t };
      };
      const ia = cross(prev), ib = cross(next);
      out[i] = scr({ cw: EPS, cx: (ia.cx + ib.cx) / 2, cy: (ia.cy + ib.cy) / 2 });
    }
    if (closed) out.push(out[0] ? { x: out[0].x, y: out[0].y } : null);
    return out;
  }

  function ringGrad(ctx, hex, t, rainbow, W_, H_, a) {
    if (!rainbow) return withAlpha(hex, a);
    const gr = ctx.createLinearGradient(0, 0, W_, H_);
    const h0 = hexToHue(hex);
    for (let i = 0; i <= 8; i++) {
      gr.addColorStop(i / 8, 'hsla(' + Math.round((h0 + i / 8 * 360 + t * 40) % 360) + ',95%,66%,' + a + ')');
    }
    return gr;
  }

  // ---------- 杀戮光环范围圈：多模式 / 彩虹 / 多层 / 粒子 / 辉光 ----------
  // 共用图案语言：3D 脚下光环和 2D 开场动画都用这一套极坐标半径函数。
  // 返回给定角度处该形状离中心的距离；非几何模式返回原半径（圆）。
  const CM_GEOM = ['五芒星', '六芒星', '三角阵', '菱形', '六边形', '花瓣', '齿轮', '螺旋', '星轨'];
  const CM_GEOM_TIPS = { 五芒星: 5, 六芒星: 6, 三角阵: 3, 菱形: 2,
    六边形: 6, 花瓣: 8, 齿轮: 12, 螺旋: 0, 星轨: 0 };
  function cmShapeRadius(shape, a, rad, t, phase, wobble) {
    const TAU = Math.PI * 2;
    // n 尖星：一圈恰好 n 个尖、n 个谷，周期 2π/n（写成 2π/2n 会变成 2n 个尖）
    const star = (n, inner) => {
      const seg = TAU / n;
      const u = (((a + phase) % seg) + seg) % seg;
      const half = seg / 2;
      const f = u < half ? 1 - u / half : (u - half) / half;
      return rad * (inner + (1 - inner) * f);
    };
    // 正 n 边形的极坐标方程：直边，而不是用 cos 调出来的波浪圆
    const poly = (n) => {
      const seg = TAU / n;
      const u = (((a + phase) % seg) + seg) % seg;
      return rad * Math.cos(Math.PI / n) / Math.max(0.2, Math.cos(u - seg / 2));
    };
    switch (shape) {
      case '五芒星': return star(5, 0.44) * (1 + 0.06 * Math.sin(t * 2.4));
      case '六芒星': return star(6, 0.50);
      case '三角阵': return star(3, 0.42);
      case '菱形': return poly(4);
      case '六边形': return poly(6);
      case '花瓣': return rad * (0.66 + 0.34 * Math.abs(Math.cos(4 * (a + phase * 0.4))));
      case '齿轮': return rad * (0.88 + 0.12 * (Math.cos(12 * (a + phase)) > 0 ? 1 : 0));
      case '螺旋': return rad * (0.35 + 0.65 *
        ((((a + t * 0.8 + phase) % TAU) + TAU) % TAU) / TAU);
      case '星轨': return rad * (1 + 0.03 * Math.sin(a * 24 + t * 4));
      default: return rad;
    }
  }
  function cmIsGeom(mode) { return CM_GEOM.indexOf(mode) >= 0; }

  function drawAuraRing(r, p, W_, H_, alpha) {
    const c = playerCenter(p, alpha);
    if (!c || !r || !r.vp) return;
    const gs = (id, def) => { const v = getS('aura', id); return v == null ? def : v; };
    const range = Math.max(0.5, Number(gs('range', 4.5)) || 4.5);
    const hex = String(gs('ringColor', '')).trim() || '#b06bff';
    const mode = String(gs('ringMode', '极光'));
    const shapeMode = cmIsGeom(mode);
    const shapeSpin = shapeMode ? 1 : 0;
    const speed = Number(gs('ringSpeed', 1)) || 1;
    const t = performance.now() / 1000 * speed;
    const width = Math.max(1, Number(gs('ringWidth', 2.5)) || 2.5);
    const glow = Math.max(0, Number(gs('ringGlow', 14)) || 0);
    const fillA = Math.max(0, Number(gs('ringFill', 12)) || 0) / 100;
    const musicOn = mode === '音乐律动';
    const sens = Math.max(0.2, Number(getS('music', 'sens')) || 1.2);
    let beat = 0, hueShift = 0, barData = null;
    if (musicOn) {
      const spec = musicSpectrum();
      if (spec) {
        beat = Math.min(1.4, spec.bass * sens);
        hueShift = spec.hi * 220;
        barData = spec.bins;
      } else {
        // 源没有 CORS / 还没播放：按时间做伪律动，视觉上不至于僵住
        const t2 = performance.now() / 1000;
        beat = (0.32 + 0.3 * Math.sin(t2 * 6.2)) * sens;
        hueShift = 90 + 70 * Math.sin(t2 * 1.7);
      }
    }
    const rainbowOn = (gs('ringRainbow', true) !== false &&
      (mode === '极光' || mode === '彩虹' || shapeMode)) || musicOn;
    const waveOn = mode === '极光' || mode === '波浪' || musicOn;
    const pulseOn = mode === '极光' || mode === '脉冲' || shapeMode || musicOn;
    const spinOn = mode === '极光' || mode === '旋转' || mode === '双层' || shapeMode || musicOn;
    const partsOn = (gs('ringParticles', true) !== false &&
      (mode === '极光' || mode === '旋转' || mode === '粒子')) || musicOn;
    let layers = Math.max(1, Math.min(4, Number(gs('ringLayers', 2)) || 2));
    if (mode === '彩虹' || mode === '脉冲' || mode === '粒子' || mode === '波浪') layers = 1;
    if (shapeMode) layers = 1;             // 几何图案单层，避免多层互相盖住尖角
    if (mode === '双层' || musicOn) layers = Math.max(2, layers);
    const y = c[1] + 0.05;
    const N = Math.max(32, Math.round(96 * perfFx()));

    // 动态模糊 / 拖影：画到离屏层，用 destination-out 渐隐保留残影，再 blur 合成回主画布
    const blurBase = Math.max(0, Number(gs('fxBlur', 3)) || 0) * (1 + beat * 0.7);
    const trail = Math.max(0, Math.min(0.95, (Number(gs('fxTrail', 55)) || 0) / 100));
    const fxOn = blurBase > 0.05 || trail > 0.02;
    if (fxOn) {
      if (fxCanvas.width !== W_ || fxCanvas.height !== H_) { fxCanvas.width = W_; fxCanvas.height = H_; }
      fxctx.save();
      fxctx.globalCompositeOperation = 'destination-out';
      fxctx.fillStyle = 'rgba(0,0,0,' + (1 - trail) + ')';
      fxctx.fillRect(0, 0, W_, H_);
      fxctx.restore();
    }
    const ctx = fxOn ? fxctx : ectx;
    ctx.save();

    const makePts = (radius, phase, wobble) => {
      const xyz = new Array(N);
      for (let i = 0; i < N; i++) {
        const a = i / N * Math.PI * 2;
        let rad = cmShapeRadius(mode, a, radius, t, phase, wobble);
        if (waveOn) rad += Math.sin(a * 6 + t * 2.6 + phase) * 0.34 * wobble;
        if (pulseOn) rad += Math.sin(t * 2.8 + phase) * 0.22;
        xyz[i] = [c[0] + Math.cos(a) * rad, y, c[2] + Math.sin(a) * rad];
      }
      return ringProject(r, xyz, W_, H_, true);
    };

    for (let L = 0; L < layers; L++) {
      const phase = L * 1.7 + (shapeMode ? t * 0.55 : 0);
      const rad = range * (1 - L * 0.14) * (musicOn ? (1 + beat * 0.16) : 1);
      const pts = makePts(rad, phase, 1 - L * 0.2);
      const a = Math.max(0.16, 0.92 - L * 0.17) * (pulseOn ? 0.78 + 0.22 * Math.sin(t * 3) : 1);
      ctx.strokeStyle = ringGrad(ctx, hex, t + L * 0.3 + hueShift / 360, rainbowOn, W_, H_, a);
      ctx.lineWidth = Math.max(1, width * (1 - L * 0.18));
      ctx.shadowColor = rainbowOn ? '#ffffff' : hex;
      ctx.shadowBlur = perfGlow() ? glow : 0;
      strokeRingPath(ctx, pts);
      ctx.stroke();

      if (L === 0 && fillA > 0) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = withAlpha(hex, fillA);
        strokeRingPath(ctx, pts);
        ctx.fill();
      }

      if (spinOn) {
        const start = (t * 1.15 + L * 1.9) % (Math.PI * 2);
        const arcXyz = [];
        for (let i = 0; i <= 14; i++) {
          const ang = start + i / 14 * 0.85;
          arcXyz.push([c[0] + Math.cos(ang) * rad, y, c[2] + Math.sin(ang) * rad]);
        }
        const arc = ringProject(r, arcXyz, W_, H_, false);
        ctx.strokeStyle = withAlpha(rainbowOn ? '#ffffff' : hex, 0.95);
        ctx.lineWidth = Math.max(2, width * 1.8);
        ctx.shadowBlur = perfGlow() ? glow * 1.4 : 0;
        strokeRingPath(ctx, arc);
        ctx.stroke();
      }

      // 几何图案：在每个尖角画会呼吸的发光点，并补一圈内接虚线
      if (shapeMode && L === 0) {
        const tips = CM_GEOM_TIPS[mode] || 0;
        ctx.shadowBlur = perfGlow() ? glow * 1.2 : 0;
        for (let k = 0; k < tips; k++) {
          const ang = k / tips * Math.PI * 2 + t * 0.55;
          const rr = cmShapeRadius(mode, ang, rad, t, t * 0.55, 1);
          const q = project(r, c[0] + Math.cos(ang) * rr, y + 0.03, c[2] + Math.sin(ang) * rr, W_, H_);
          if (!q) continue;
          ctx.fillStyle = rainbowOn
            ? 'hsla(' + Math.round((hexToHue(hex) + k * 60 + t * 70) % 360) + ',96%,74%,.95)'
            : withAlpha(hex, 0.95);
          ctx.beginPath();
          ctx.arc(q.x, q.y, 2.8 + 1.6 * Math.sin(t * 3.2 + k), 0, Math.PI * 2);
          ctx.fill();
        }
        if (mode === '五芒星' || mode === '六芒星') {
          const inner = [];
          for (let k = 0; k < tips; k++) {
            const ang = (k * 2) / tips * Math.PI * 2 + t * 0.55;
            const rr = cmShapeRadius(mode, ang, rad * 0.62, t, t * 0.55, 1);
            inner.push([c[0] + Math.cos(ang) * rr, y, c[2] + Math.sin(ang) * rr]);
          }
          const ip = ringProject(r, inner, W_, H_, true);
          ctx.shadowBlur = 0;
          ctx.strokeStyle = withAlpha(rainbowOn ? '#ffffff' : hex, 0.32);
          ctx.lineWidth = 1;
          strokeRingPath(ctx, ip);
          ctx.stroke();
        }
      }

      if (partsOn) {
        ctx.shadowBlur = perfGlow() ? glow : 0;
        for (let k = 0; k < (perfLevel() === '省电' ? 3 : 8); k++) {
          const ang = (k / 8) * Math.PI * 2 + t * (L % 2 ? -0.9 : 0.9) + L * 0.4;
          const q = project(r, c[0] + Math.cos(ang) * rad, y + 0.02, c[2] + Math.sin(ang) * rad, W_, H_);
          if (!q) continue;
          ctx.fillStyle = rainbowOn
            ? 'hsla(' + Math.round((hexToHue(hex) + k * 45 + t * 60) % 360) + ',95%,72%,.95)'
            : withAlpha(hex, 0.95);
          ctx.beginPath();
          ctx.arc(q.x, q.y, 2.4 + 0.8 * Math.sin(t * 4 + k), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 环形频谱柱：把 64 段频谱沿光环向外画，像一圈会跳的均衡器
    if (musicOn && barData && gs('fxBars', true) !== false) {
      const bars = 64;
      for (let k = 0; k < bars; k++) {
        const a = k / bars * Math.PI * 2 + t * 0.18;
        const bi = Math.floor(k / bars * barData.length * 0.72);
        const v = Math.min(1.4, (barData[bi] || 0) / 255 * sens);
        const r0 = range * (1 + beat * 0.16);
        const r1 = r0 + 0.22 + v * 2.4;
        const p0 = project(r, c[0] + Math.cos(a) * r0, y, c[2] + Math.sin(a) * r0, W_, H_);
        const p1 = project(r, c[0] + Math.cos(a) * r1, y, c[2] + Math.sin(a) * r1, W_, H_);
        if (!p0 || !p1) continue;
        ctx.strokeStyle = 'hsla(' + Math.round((hueShift + k * 6 + 360) % 360) + ',95%,68%,.85)';
        ctx.lineWidth = Math.max(1.5, width);
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }
    }
    ctx.restore();

    if (fxOn) {
      ectx.save();
      if (blurBase > 0.05 && perfGlow()) ectx.filter = 'blur(' + blurBase.toFixed(1) + 'px)';
      ectx.globalAlpha = 0.92;
      ectx.drawImage(fxCanvas, 0, 0);
      ectx.restore();
    }
  }

  // ---------- 方块高亮：准星指向的方块 3D 线框 ----------
  function drawBlockEsp(g, r, W_, H_) {
    let bp = null;
    try {
      const t = g.target;
      if (t && Array.isArray(t.pos)) bp = t.pos;
      else if (t && typeof t.x === 'number') bp = [t.x, t.y, t.z];
      else if (g.breaking && Array.isArray(g.breaking.pos)) bp = g.breaking.pos;
    } catch (e) { bp = null; }
    if (!bp) return;
    const x = Math.floor(bp[0]), y = Math.floor(bp[1]), z = Math.floor(bp[2]);
    const cs = [];
    for (let i = 0; i < 8; i++) {
      const q = project(r, x + (i & 1 ? 1 : 0), y + (i & 2 ? 1 : 0), z + (i & 4 ? 1 : 0), W_, H_);
      if (!q || Math.abs(q.x) > W_ * 3 || Math.abs(q.y) > H_ * 3) return;
      cs.push(q);
    }
    const color = String(getS('blockesp', 'color') || '').trim() || '#ffd54f';
    const ctx = ectx;
    ctx.save();
    if (getS('blockesp', 'fill') !== false) {
      ctx.fillStyle = hexToRgba(color, 0.13);
      for (const f of [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6]]) {
        ctx.beginPath(); ctx.moveTo(cs[f[0]].x, cs[f[0]].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(cs[f[i]].x, cs[f[i]].y);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, Number(getS('blockesp', 'width')) || 2);
    ctx.shadowColor = color; ctx.shadowBlur = 9;
    ctx.beginPath();
    for (const e2 of [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6],
                      [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]]) {
      ctx.moveTo(cs[e2[0]].x, cs[e2[0]].y);
      ctx.lineTo(cs[e2[1]].x, cs[e2[1]].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---------- 移动轨迹：渐隐光轨 + 脚下光点 ----------
  function drawTrail(r, p, W_, H_, alpha) {
    const c = playerCenter(p, alpha);
    if (!c) return;
    const maxN = Math.max(8, Math.min(160, Number(getS('trail', 'length')) || 60));
    const last = trailPts[trailPts.length - 1];
    if (!last || Math.hypot(c[0] - last[0], c[1] - last[1], c[2] - last[2]) > 0.06) {
      trailPts.push([c[0], c[1] + 0.08, c[2]]);
      while (trailPts.length > maxN) trailPts.shift();
    }
    if (trailPts.length < 2) return;
    const color = String(getS('trail', 'color') || '').trim() || '#69f0ae';
    const ctx = ectx;
    ctx.save();
    ctx.lineWidth = Math.max(1, Number(getS('trail', 'width')) || 2);
    ctx.lineCap = 'round';
    ctx.shadowColor = color; ctx.shadowBlur = 8;
    for (let i = 1; i < trailPts.length; i++) {
      const a = project(r, trailPts[i - 1][0], trailPts[i - 1][1], trailPts[i - 1][2], W_, H_);
      const b = project(r, trailPts[i][0], trailPts[i][1], trailPts[i][2], W_, H_);
      if (!a || !b) continue;
      ctx.strokeStyle = hexToRgba(color, (i / trailPts.length) * 0.8);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    if (getS('trail', 'glow') !== false) {
      const q = project(r, c[0], c[1] + 0.08, c[2], W_, H_);
      if (q) {
        ctx.fillStyle = hexToRgba(color, 0.55);
        ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------- 目标光环：当前目标脚下旋转光圈 + 上升光柱 ----------
  function drawTargetRing(r, W_, H_, alpha) {
    const e = (lastTarget && !lastTarget.dead && performance.now() - lastTargetAt < 4000)
      ? lastTarget : (auraTarget && !auraTarget.dead ? auraTarget : null);
    if (!e) return;
    let c = null;
    try {
      const ip = (typeof e.ipos === 'function') ? e.ipos(alpha == null ? 1 : alpha) : null;
      c = ip || (Array.isArray(e.pos) ? e.pos : null);
    } catch (err) { c = null; }
    if (!c) return;
    const color = String(getS('targetring', 'color') || '').trim() || '#ff5f6d';
    const t = performance.now() / 1000;
    const rad = Math.max(0.2, Number(getS('targetring', 'size')) || 0.9) * (1 + 0.12 * Math.sin(t * 4));
    const spin = t * (Number(getS('targetring', 'speed')) || 1);
    const xyz = [];
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * Math.PI * 2 + spin;
      xyz.push([c[0] + Math.cos(a) * rad, c[1] + 0.05, c[2] + Math.sin(a) * rad]);
    }
    const pts = ringProject(r, xyz, W_, H_, true);
    const ctx = ectx;
    ctx.save();
    ctx.lineWidth = Math.max(1.4, W_ / 700);
    ctx.strokeStyle = withAlpha(color, 0.9);
    ctx.shadowColor = color; ctx.shadowBlur = 12;
    strokeRingPath(ctx, pts);
    ctx.stroke();
    if (getS('targetring', 'beam') !== false) {
      const b1 = project(r, c[0], c[1], c[2], W_, H_);
      const b2 = project(r, c[0], c[1] + 2.2, c[2], W_, H_);
      if (b1 && b2) {
        const gr = ctx.createLinearGradient(b2.x, b2.y, b1.x, b1.y);
        gr.addColorStop(0, hexToRgba(color, 0));
        gr.addColorStop(1, hexToRgba(color, 0.5));
        ctx.strokeStyle = gr;
        ctx.lineWidth = Math.max(2, W_ / 500);
        ctx.beginPath(); ctx.moveTo(b2.x, b2.y); ctx.lineTo(b1.x, b1.y); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function espFrame() {
    const g = state.game, p = state.player;
    const tagBoxes = [];
    try {
      if (bigOpen) {
        ectx.clearRect(0, 0, espCanvas.width, espCanvas.height);
        drawRadar(false); drawCompass(false);
        return;
      }
    } catch (e) { /* 地图状态尚未初始化 */ }
    const showEsp = modOn('esp'), showTracers = modOn('tracers');
    const showItems = modOn('itemesp'), showTarget = modOn('targetesp');
    const hudOn = modOn('hud');
    const showRadar = (hudOn && !!getS('hud', 'radar')) || state.editHud;
    const showCompass = (hudOn && !!getS('hud', 'compass')) || state.editHud;
    const showProj = modOn('projectile');
    const showAuraRing = modOn('aura') && getS('aura', 'ring') !== false;
    const showBlock = modOn('blockesp');
    const showTrail = modOn('trail');
    const showTargetRing = modOn('targetring');
    const showWp = modOn('waypoints');
    const showXray = modOn('xray');
    const showContainers = modOn('containeresp');
    const extAny = ['chunkborder', 'lightoverlay', 'hitmarker', 'damagenumbers', 'crosshair',
      'damageindicator', 'entitytrail', 'lowhp', 'waypointline', 'blockoutline', 'healthbar']
      .some((k) => modOn(k));
    if (!showTrail) trailPts.length = 0;
    const anyOn = showEsp || showTracers || showItems || showTarget || showRadar || showCompass || showProj
      || showAuraRing || showBlock || showTrail || showTargetRing || showWp || showXray
      || showContainers || extAny;
    // 尚未进入游戏时编辑 HUD：罗盘 / 雷达仍要画出占位，否则是一块空白画布，没法拖
    if (!g || !p) {
      ectx.clearRect(0, 0, espCanvas.width, espCanvas.height);
      drawRadar(showRadar); drawCompass(showCompass);
      return;
    }
    if (!anyOn) {
      ectx.clearRect(0, 0, espCanvas.width, espCanvas.height);
      drawRadar(false); drawCompass(false);
      return;
    }
    if (g.state && g.state !== 'play') {
      ectx.clearRect(0, 0, espCanvas.width, espCanvas.height);
      drawRadar(false); drawCompass(false);
      return;
    }
    const r = g.renderer;
    if (!r || !r.vp || !r.camPos) return;

    const alpha = (espFrame.alpha != null) ? espFrame.alpha
      : (g.pauseA != null) ? g.pauseA
        : (typeof g.acc === 'number' && isFinite(g.acc) ? Math.max(0, Math.min(1, g.acc / 50)) : 1);

    const glCv = g.canvas;
    if (!glCv) return;
    if (espCanvas.width !== glCv.width || espCanvas.height !== glCv.height) {
      espCanvas.width = glCv.width;
      espCanvas.height = glCv.height;
    }
    ectx.clearRect(0, 0, espCanvas.width, espCanvas.height);

    const W_ = espCanvas.width, H_ = espCanvas.height;
    if (showAuraRing) drawAuraRing(r, p, W_, H_, alpha);
    if (showBlock) {
      if (getS('blockesp', 'crosshair') !== false) drawBlockEsp(g, r, W_, H_);
      drawBlockTracker(r, p, W_, H_, alpha);
    }
    if (showTrail) drawTrail(r, p, W_, H_, alpha);
    if (showTargetRing) drawTargetRing(r, W_, H_, alpha);
    if (showWp) drawWaypoints(r, p, W_, H_, alpha);
    if (showXray) drawXray(r, p, W_, H_, alpha);
    if (showContainers) drawContainerEsp(r, p, W_, H_, alpha);
    try { extDropBoxes(r, p, W_, H_, alpha); } catch (e) { /* noop */ }
    try { extRenderB(r, p, W_, H_, alpha, g); } catch (e) { /* noop */ }
    try { extRenderC(r, p, W_, H_); } catch (e) { /* noop */ }
    try { extRenderD(r, p, W_, H_, alpha); } catch (e) { /* noop */ }
    try { extRenderE(r, p, W_, H_, alpha); } catch (e) { /* noop */ }
    const maxD2 = Math.pow(getS('esp', 'distance') ?? 64, 2);
    let ents;
    try { ents = g.entities; } catch (e) { return; }
    let entCount = 0;
    const maxEnts = Math.max(10, Number(getS('perf', 'maxEnts')) || 80);
    if (Array.isArray(ents)) {
      for (const e of ents) {
        if (++entCount > maxEnts) break;
        try {
          if (!e || e === p || e.dead) continue;
          const isMob = e.health != null && e.maxHealth != null;
          let kind = null;
          if (!isMob) {
            if (!showItems) continue;
            kind = itemKindOf(e);
            if (!kind) continue;
          }
          if (isMob && !(showEsp || showTracers || modOn('nametags'))) continue;

          let pos;
          try {
            pos = (typeof e.ipos === 'function') ? e.ipos(alpha)
              : (Array.isArray(e.pos) ? e.pos.slice() : null);
          } catch (err) { pos = null; }
          if (!pos || typeof pos[0] !== 'number') {
            pos = Array.isArray(e.pos) ? e.pos : (typeof e.x === 'number' ? [e.x, e.y, e.z] : null);
          }
          if (!pos) continue;
          const dx = pos[0] - r.camPos[0], dy = pos[1] - r.camPos[1], dz = pos[2] - r.camPos[2];
          if (dx * dx + dy * dy + dz * dz > maxD2) continue;

          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, ok = true;
          let pts = null;
          if (isMob) {
            const hw = (num(e, 'w') ?? 0.6) / 2, hh = num(e, 'h') ?? 1.8;
            const bb = [pos[0] - hw, pos[1], pos[2] - hw, pos[0] + hw, pos[1] + hh, pos[2] + hw];
            pts = [];
            for (let i = 0; i < 8; i++) {
              const pt = project(r, bb[i & 1 ? 3 : 0], bb[i & 2 ? 4 : 1], bb[i & 4 ? 5 : 2], W_, H_);
              if (!pt) { ok = false; break; }
              const LIM_X = W_ * 1.5, LIM_Y = H_ * 1.5;
              if (pt.x < -LIM_X || pt.x > W_ + LIM_X || pt.y < -LIM_Y || pt.y > H_ + LIM_Y) { ok = false; break; }
              pts.push(pt);
              if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
              if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
            }
          } else {
            const pt = project(r, pos[0], pos[1], pos[2], W_, H_);
            if (pt) { const s = 5; minX = pt.x - s; maxX = pt.x + s; minY = pt.y - s; maxY = pt.y + s; }
            else ok = false;
          }
          if (!ok || maxX <= minX || maxY <= minY) continue;

          const setCol = typeColor('esp', e, isMob);
          const color = setCol || (isMob ? colorOf(e) : kind);
          const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

          if (showTracers && (isMob || showItems)) {
            const tSet = typeColor('tracers', e, isMob);
            const tc = tSet ? hexToRgba(tSet, 0.62)
              : (isMob ? (isPlayerEntity(e) ? hexToRgba(COLORS.player, 0.62)
                : ((HOSTILE.has(e.constructor && e.constructor.name) || (e.T && e.T.hostile)) ? COLORS.line : 'rgba(79,195,247,0.5)'))
                : hexToRgba(kind, 0.5));
            ectx.strokeStyle = tc;
            ectx.lineWidth = 1;
            ectx.beginPath();
            ectx.moveTo(W_ / 2, H_ / 2);
            ectx.lineTo(cx, cy);
            ectx.stroke();
          }

          if ((showEsp && isMob) || (showItems && !isMob)) {
            ectx.strokeStyle = color;
            ectx.lineWidth = isMob ? 1.5 : 1;
            if (isMob && pts) {
              const EDGES = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
              ectx.beginPath();
              for (const [a0, b0] of EDGES) { ectx.moveTo(pts[a0].x, pts[a0].y); ectx.lineTo(pts[b0].x, pts[b0].y); }
              ectx.stroke();
            } else {
              ectx.strokeRect(minX, minY, maxX - minX, maxY - minY);
            }
          }

          const dropSummary = modOn('drops')
            && (getS('drops', 'hideTags') === true || getS('drops', 'worldTags') === false);
          if (modOn('nametags') && (isMob || showItems) && !(dropSummary && !isMob)) {
            const dist = Math.hypot(dx, dy, dz);
            const name = displayName(e);
            const scale = Math.max(0.7, Math.min(2, Number(getS('nametags', 'scale')) || 1.1));
            const fmt = String(getS('nametags', 'format') || '名称+距离');
            const label = fmt === '仅名称' ? name
              : fmt === '名称+血量' ? (name + ' ' + (e.health != null ? Math.round(e.health) : '') + 'hp')
                : fmt === '名称+距离+血量' ? (name + ' ' + Math.round(dist) + 'm ' + (e.health != null ? Math.round(e.health) : '') + 'hp')
                  : (name + '  ' + Math.round(dist) + 'm');
            const nameColor = String(getS('nametags', 'color') || '').trim() || '#f2f5fa';
            const compact = getS('nametags', 'compact') !== false;
            const showHeld = getS('nametags', 'held') !== false;
            const showArmor = getS('nametags', 'armor') !== false;
            const held = showHeld ? heldOf(e) : null;
            const armor = showArmor ? armorOf(e) : [];
            const heldNm = held != null ? (itemName(held) || ('#' + held)) : null;
            const c = ectx;
            c.textAlign = 'center'; c.textBaseline = 'middle';
            c.font = '700 ' + Math.round(12 * scale) + 'px "Microsoft YaHei", sans-serif';
            const wName = c.measureText(label).width || 40;
            const wDist = 30 + (wName / 2);
            const wHeld = heldNm ? ((c.measureText(heldNm).width || 40) + 26) : 0;
            const wArmor = armor.filter(Boolean).length * 11;
            const tw = Math.max(74, wName + 40, wHeld + wArmor + 12);
            const th = (isMob ? 8 : 0) + (heldNm || wArmor ? 13 : 0) + 17;

            // 同屏标签防重叠：撞上已有盒子就往下错一行
            let ty = minY - 12 - th / 2;
            for (const b of tagBoxes) {
              if (Math.abs(b.x - cx) < (b.w + tw) / 2 + 3 && Math.abs(b.y - ty) < (b.h + th) / 2 + 2) {
                ty = b.y + (b.h + th) / 2 + 3;
              }
            }
            tagBoxes.push({ x: cx, y: ty, w: tw, h: th });

            const top = ty - th / 2, left = cx - tw / 2;
            const bg = String(getS('nametags', 'bgColor') || '').trim();
            const bga = Math.max(0, Math.min(1, (Number(getS('nametags', 'bgAlpha')) ?? 88) / 100));
            c.fillStyle = bg ? hexToRgba(bg, bga)
              : (cfg.theme === 'glass' ? 'rgba(18,22,32,' + bga + ')' : 'rgba(8,11,18,' + bga + ')');
            rr(c, left, top, tw, th, 6); c.fill();
            c.strokeStyle = hexToRgba(color || '#b06bff', .55); c.lineWidth = 1;
            rr(c, left, top, tw, th, 6); c.stroke();

            let ly = top + 10;
            c.fillStyle = nameColor; c.font = '700 ' + Math.round(12 * scale) + 'px "Microsoft YaHei", sans-serif';
            c.fillText(label, cx - (compact ? 0 : wDist / 2), ly);
            c.fillStyle = 'rgba(220,228,240,.68)'; c.font = '600 10px "Microsoft YaHei", sans-serif';
            c.textAlign = 'right';
            c.fillText(Math.round(dist) + 'm', left + tw - 6, ly);
            c.textAlign = 'center';
            ly += 11;

            if (isMob) {
              const hp = Math.min(1, Math.max(0, e.health / (e.maxHealth || 20)));
              c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(left + 6, ly - 2, tw - 12, 4);
              c.fillStyle = hp > .5 ? '#6ee7a5' : hp > .25 ? '#ffc857' : '#ff5f6d';
              c.fillRect(left + 6, ly - 2, (tw - 12) * hp, 4);
              ly += 8;
            }
            if (heldNm || wArmor) {
              let sx = left + 6;
              if (heldNm) {
                c.fillStyle = itemColor(held); c.fillRect(sx, ly - 4, 7, 7);
                c.textAlign = 'left'; c.font = '600 10px "Microsoft YaHei", sans-serif';
                c.fillStyle = 'rgba(235,240,248,.9)';
                c.fillText(String(heldNm).slice(0, 8), sx + 10, ly);
                sx += 10 + (c.measureText(String(heldNm).slice(0, 8)).width || 32) + 6;
              }
              for (const a of armor) {
                if (!a) continue;
                const aid = (a && a.id != null) ? a.id : a;
                c.fillStyle = itemColor(aid); c.fillRect(sx, ly - 4, 7, 7);
                sx += 11;
              }
              c.textAlign = 'center';
            }
            c.textBaseline = 'alphabetic'; c.textAlign = 'start'; c.lineWidth = 1;
          }
        } catch (err) { /* 单个实体出错不影响整体 */ }
      }
    }

    // TargetESP：彗星式白色四角括号
    if (showTarget && auraTarget && !auraTarget.dead) {
      try {
        const pos = targetPos(auraTarget);
        if (pos) {
          const pt = project(r, pos[0], pos[1] + 0.1, pos[2], W_, H_);
          if (pt) {
            const hw = (num(auraTarget, 'w') ?? 0.6) / 2, hh = num(auraTarget, 'h') ?? 1.8;
            const a = project(r, pos[0] - hw, pos[1], pos[2] - hw, W_, H_);
            const b = project(r, pos[0] + hw, pos[1] + hh, pos[2] + hw, W_, H_);
            if (a && b) {
              const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
              const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
              const l = Math.min(10, (x1 - x0) * 0.28, (y1 - y0) * 0.28);
              ectx.strokeStyle = 'rgba(255,255,255,0.9)';
              ectx.lineWidth = 2;
              ectx.beginPath();
              ectx.moveTo(x0, y0 + l); ectx.lineTo(x0, y0); ectx.lineTo(x0 + l, y0);
              ectx.moveTo(x1 - l, y0); ectx.lineTo(x1, y0); ectx.lineTo(x1, y0 + l);
              ectx.moveTo(x1, y1 - l); ectx.lineTo(x1, y1); ectx.lineTo(x1 - l, y1);
              ectx.moveTo(x0 + l, y1); ectx.lineTo(x0, y1); ectx.lineTo(x0, y1 - l);
              ectx.stroke();
            }
          }
        }
      } catch (err) { /* noop */ }
    }

    if (showProj) drawProjectiles(r, W_, H_);
    drawRadar(showRadar);
    drawCompass(showCompass);
  }

  // ---------- 投掷物抛物线 ----------
  // 与游戏内真实物理一致（entity.js）：每 tick 先位移，再 v *= drag、vy = vy * drag - grav
  // 箭 / 雪球 / 鸡蛋 / 药水：drag 0.99、grav 0.05；末影珍珠：drag 0.99、grav 0.03
  function simulateProj(w, ox, oy, oz, vx, vy, vz, grav, drag, maxTicks, aim) {
    const pts = [[ox, oy, oz]];
    let x = ox, y = oy, z = oz, near = Infinity;
    for (let i = 0; i < maxTicks; i++) {
      const px = x, py = y, pz = z;
      x += vx; y += vy; z += vz;
      if (aim) {
        const dd = Math.hypot(x - aim[0], y - aim[1], z - aim[2]);
        if (dd < near) near = dd;
      }
      if (isSolidAt(w, Math.floor(x), Math.floor(y), Math.floor(z))) {
        pts.push([px, py, pz]);
        return { pts, land: [px, py, pz], near };
      }
      pts.push([x, y, z]);
      vx *= drag; vy = vy * drag - grav; vz *= drag;
      if (y < -70) return { pts, land: null, near };
    }
    return { pts, land: null, near };
  }

  // ---- 统一弹道解算：弓箭辅助与预判线共用同一套物理 ----
  function itemKey(held) {
    try {
      const def = (typeof W.itemDef === 'function') ? W.itemDef(held.id)
        : (W.ITEMS && W.ITEMS[held.id]) || null;
      return def ? String(def.key || def.name || '') : '';
    } catch (e) { return ''; }
  }
  function entityVel(e) {
    try {
      let pos = Array.isArray(e.pos) ? e.pos
        : (typeof e.ipos === 'function' ? e.ipos(1) : null);
      if (!pos) return [0, 0, 0];
      let v = [0, 0, 0];
      const now = performance.now();
      if (e.__cometPrevPos && now - e.__cometPrevT > 30 && now - e.__cometPrevT < 400) {
        const dt = Math.max(1, (now - e.__cometPrevT) / 50);
        v = [(pos[0] - e.__cometPrevPos[0]) / dt,
             (pos[1] - e.__cometPrevPos[1]) / dt,
             (pos[2] - e.__cometPrevPos[2]) / dt];
      }
      e.__cometPrevPos = [pos[0], pos[1], pos[2]];
      e.__cometPrevT = now;
      if (Array.isArray(e.vel)) v = e.vel.slice();
      return v.map((x) => Math.max(-0.8, Math.min(0.8, Number(x) || 0)));
    } catch (err) { return [0, 0, 0]; }
  }
  function leadPoint(eye, ce, vel, speed) {
    let px = ce[0], py = ce[1], pz = ce[2];
    for (let i = 0; i < 4; i++) {
      const d = Math.hypot(px - eye[0], py - eye[1], pz - eye[2]);
      const t = d / Math.max(0.3, speed);
      px = ce[0] + vel[0] * t;
      py = ce[1] + vel[1] * t;
      pz = ce[2] + vel[2] * t;
    }
    return [px, py, pz];
  }
  function solveBallistic(eye, aim, par, w) {
    const dx = aim[0] - eye[0], dz = aim[2] - eye[2];
    const hd = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dx, -dz);
    const base = Math.atan2(aim[1] - eye[1], Math.max(0.1, hd));
    let bestP = base, bestErr = Infinity;
    const lo = Math.max(-1.4, base - 0.9), hi = Math.min(1.4, base + 0.9);
    for (let i = 0; i <= 18; i++) {
      const pitch = lo + (hi - lo) * i / 18;
      const cp = Math.cos(pitch);
      const d = [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
      const sim = simulateProj(w, eye[0], eye[1], eye[2],
        d[0] * par.speed, d[1] * par.speed + par.extraVy, d[2] * par.speed,
        par.grav, par.drag, 110, aim);
      if (sim.near < bestErr) { bestErr = sim.near; bestP = pitch; }
    }
    return { yaw, pitch: bestP, err: bestErr };
  }

  function strokeProj(r, pts, color, W_, H_) {
    const style = String(getS('projectile', 'style') || '光带');
    if (style === '关闭') return;
    const ctx = ectx;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // 超出画布太多的点直接断开，避免相机后方的点被投影成贯穿屏幕的长竖线
    const okPt = (q) => q && isFinite(q.x) && isFinite(q.y)
      && q.x > -W_ * 0.4 && q.x < W_ * 1.4 && q.y > -H_ * 0.4 && q.y < H_ * 1.4;
    if (style === '光点') {
      for (let i = 0; i < pts.length; i += 3) {
        const sp = project(r, pts[i][0], pts[i][1], pts[i][2], W_, H_);
        if (!okPt(sp)) continue;
        const f = 1 - i / pts.length;
        ctx.fillStyle = hexToRgba(color, 0.12 + f * 0.65);
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 1.2 + f * 1.8, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      // 分 4 段渐隐，每段一次 stroke（比逐点 stroke 便宜，也没有虚线的廉价感）
      const segs = 4, n = pts.length;
      for (let s = 0; s < segs; s++) {
        const a0 = Math.floor(n * s / segs), a1 = Math.floor(n * (s + 1) / segs);
        const f = 1 - s / segs;
        ctx.strokeStyle = hexToRgba(color, (style === '细线' ? 0.32 : 0.72) * f);
        ctx.lineWidth = style === '细线' ? 1 : 0.6 + 2.4 * f;
        ctx.beginPath();
        let started = false;
        for (let i = a0; i <= a1 && i < n; i += 2) {
          const sp = project(r, pts[i][0], pts[i][1], pts[i][2], W_, H_);
          if (!okPt(sp)) { started = false; continue; }
          if (!started) { ctx.moveTo(sp.x, sp.y); started = true; }
          else ctx.lineTo(sp.x, sp.y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawLandMark(r, land, color, W_, H_) {
    if (!land) return;
    const sp = project(r, land[0], land[1], land[2], W_, H_);
    if (!sp) return;
    const t = performance.now() / 1000;
    const pulse = 1 + 0.14 * Math.sin(t * 4);
    const ctx = ectx;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hexToRgba(color, 0.8);
    ctx.fillStyle = hexToRgba(color, 0.16);
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 6 * pulse, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = hexToRgba(color, 0.9);
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function projParams(p, held) {
    try {
      if (!held) return null;
      const key = itemKey(held);
      if (!key) return null;
      let speed = 1.5, extraVy = 0, grav = 0.05, drag = 0.99, color = '#55d6ff', bow = false;
      if (key === 'bow' || key === 'crossbow') {
        bow = true; color = '#5fd8ff';   // 青蓝替代刺眼的纯黄
        // releaseBow：f = (t² + 2t)/3（t = useT/20，封顶 1），速度 = f × 3（弩 3.15）
        const t = (p.usingItem === held.id && typeof p.useT === 'number')
          ? Math.max(0, Math.min(1, p.useT / 20)) : 1;
        const f = Math.min(1, (t * t + t * 2) / 3);
        if (f < 0.1) return null;
        speed = f * (key === 'crossbow' ? 3.15 : 3);
      } else if (key === 'ender_pearl') {
        grav = 0.03;
      } else if (/potion/.test(key)) {
        speed = 0.5; extraVy = 0.1;
      } else if (/^(snowball|egg|experience_bottle|trident)$/.test(key)) {
        /* 1.5，默认物性 */
      } else return null;
      return { speed, extraVy, grav, drag, color, bow, key };
    } catch (err) { return null; }
  }
  function heldProjInfo(p) {
    return projParams(p, p && p.inv && p.inv.held);
  }

  function drawProjectiles(r, W_, H_) {
    const g = state.game, p = state.player;
    if (!g || !p) return;
    const w = g.world;
    if (!w) return;
    const pp = targetPos(p);
    if (!pp) return;
    // 自定义轨迹颜色（留空 = 弓黄 / 投掷物蓝）
    const custom = String(getS('projectile', 'trailColor') || '').trim()
      || String(getS('projectile', 'color') || '').trim();
    const eyeH = (typeof p.eye === 'function' ? p.eye() : LOOK_EYE);

    if (getS('projectile', 'held') !== false) {
      const info = heldProjInfo(p);
      if (info) {
        const d = lookFrom(yawRad(num(p, 'yaw')), num(p, 'pitch') ?? 0);
        // 弓：箭从 pos + lookDir×0.3 射出；雪球 / 珍珠 / 药水：无水平偏移
        const off = info.bow ? 0.3 : 0;
        const sim = simulateProj(w, pp[0] + d[0] * off, pp[1] + eyeH, pp[2] + d[2] * off,
          d[0] * info.speed, d[1] * info.speed + info.extraVy, d[2] * info.speed,
          info.grav, info.drag, 260);
        const col = custom || info.color;
        strokeProj(r, sim.pts, col, W_, H_);
        if (getS('projectile', 'land') !== false) drawLandMark(r, sim.land, col, W_, H_);
      }
    }

    // 预判命中点：与弓箭辅助共用 bowAimState，画的就是解算出来的提前点
    if (getS('projectile', 'leadMark') !== false && modOn('bowaim')
      && bowAimState.aim && bowAimState.target) {
      const a = bowAimState.aim;
      const sp = project(r, a[0], a[1], a[2], W_, H_);
      if (sp) {
        ectx.save();
        ectx.strokeStyle = '#ff5f6d'; ectx.lineWidth = 2;
        ectx.shadowColor = '#ff5f6d'; ectx.shadowBlur = 8;
        ectx.beginPath();
        ectx.moveTo(sp.x, sp.y - 8); ectx.lineTo(sp.x + 8, sp.y);
        ectx.lineTo(sp.x, sp.y + 8); ectx.lineTo(sp.x - 8, sp.y);
        ectx.closePath(); ectx.stroke();
        ectx.shadowBlur = 0;
        if (bowAimState.sol && isFinite(bowAimState.sol.err)) {
          ectx.font = '700 11px "Microsoft YaHei", sans-serif';
          ectx.fillStyle = '#fff'; ectx.textAlign = 'center';
          ectx.fillText('预判 ' + bowAimState.sol.err.toFixed(1) + 'm', sp.x, sp.y - 13);
        }
        ectx.restore();
      }
    }

    if (getS('projectile', 'flight') !== false) {
      try {
        const ents = g.entities;
        if (Array.isArray(ents)) {
          const eye = [pp[0], pp[1] + LOOK_EYE, pp[2]];
          let drawn = 0;
          for (const e of ents) {
            if (drawn >= 8) break;
            if (!e || e.dead || e.stuck || !e.vel || !Array.isArray(e.vel)) continue;
            const age = num(e, 'age');
            if (age != null && age > 400) continue;
            const nm = (e.constructor && e.constructor.name) || '';
            const isProj = nm === 'Arrow' || /Snowball|Egg|Pearl|Trident|Potion|Fireball/i.test(nm);
            if (!isProj) continue;
            const ep = targetPos(e);
            if (!ep) continue;
            const dx = ep[0] - eye[0], dy = ep[1] - eye[1], dz = ep[2] - eye[2];
            if (dx * dx + dy * dy + dz * dz > 96 * 96) continue;
            const pearl = /Pearl/i.test(nm);
            const col = custom || (/Pearl|Snowball|Egg|Potion|Trident/i.test(nm) ? '#55d6ff' : '#ffd34d');
            const sim = simulateProj(w, ep[0], ep[1], ep[2],
              num(e.vel, 0) || 0, num(e.vel, 1) || 0, num(e.vel, 2) || 0,
              pearl ? 0.03 : 0.05, 0.99, 200);
            strokeProj(r, sim.pts, col, W_, H_);
            if (getS('projectile', 'land') !== false) drawLandMark(r, sim.land, col, W_, H_);
            drawn++;
          }
        }
      } catch (err) { /* noop */ }
    }
  }

  function drawRadar(on) {
    const size = 120;
    const c = rctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, radar.width, radar.height);
    if (!on) return;
    c.setTransform(2, 0, 0, 2, 0, 0);
    const g = state.game, p = state.player;
    if (!g || !p) {
      if (state.editHud) {
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.beginPath(); c.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.75)';
        c.font = 'bold 11px "Microsoft YaHei", sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('雷达', size / 2, size / 2);
      }
      return;
    }
    const cx = size / 2, cy = size / 2, R = size / 2 - 3;
    const cam = (g.renderer && g.renderer.camPos) || targetPos(p);
    if (!cam) return;
    // 正北朝上：+X 向右（东），+Z 向上（北），中心箭头不随玩家朝向旋转
    const scale = R / Math.max(8, (getS('esp', 'distance') ?? 64) * 0.5);
    const px = (dx, dz) => cx + dx * scale;
    const py = (dx, dz) => cy - dz * scale;

    c.save();
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();
    const gr = c.createLinearGradient(0, 0, size, size);
    gr.addColorStop(0, 'rgba(52,52,52,0.82)');
    gr.addColorStop(1, 'rgba(22,22,22,0.82)');
    c.fillStyle = gr;
    c.fillRect(0, 0, size, size);
    c.strokeStyle = 'rgba(160,160,160,0.22)';
    c.beginPath(); c.arc(cx, cy, R / 2, 0, Math.PI * 2); c.stroke();

    let ents; try { ents = g.entities; } catch (e) { ents = null; }
    if (Array.isArray(ents)) {
      for (const e of ents) {
        try {
          if (!e || e === p || e.dead) continue;
          const pos = targetPos(e);
          if (!pos) continue;
          const dx = pos[0] - cam[0], dz = pos[2] - cam[2];
          const lim = (getS('esp', 'distance') ?? 64) * 0.5;
          if (dx * dx + dz * dz > lim * lim) continue;
          const isMob = e.health != null && e.maxHealth != null;
          c.fillStyle = isMob ? colorOf(e) : '#ffd54f';
          c.beginPath();
          c.arc(px(dx, dz), py(dx, dz), isMob ? 2.5 : 1.6, 0, Math.PI * 2);
          c.fill();
        } catch (err) { /* noop */ }
      }
    }
    c.restore();
    c.strokeStyle = 'rgba(200,200,200,0.45)';
    c.lineWidth = 1;
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();

    // 方位字母（正北朝上）
    c.font = 'bold 8px "Microsoft YaHei", sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.fillText('北', cx, 8);
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillText('东', size - 7, cy);
    c.fillText('南', cx, size - 8);
    c.fillText('西', 7, cy);

    // 固定的中心箭头（指向正北，不跟随玩家朝向）
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(cx, cy - 6); c.lineTo(cx - 3.5, cy + 4); c.lineTo(cx + 3.5, cy + 4);
    c.closePath(); c.fill();
  }

  function drawCompass(on) {
    const w = 300, h = 40, c = cctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, compass.width, compass.height);
    if (!on) return;
    c.setTransform(2, 0, 0, 2, 0, 0);
    const gr = c.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, 'rgba(52,52,52,0.9)');
    gr.addColorStop(1, 'rgba(22,22,22,0.9)');
    c.fillStyle = gr;
    c.beginPath();
    if (c.roundRect) c.roundRect(0, 0, w, h, 5); else c.rect(0, 0, w, h);
    c.fill();
    c.strokeStyle = 'rgba(90,90,90,0.9)';
    c.lineWidth = 0.7;
    c.stroke();

    const p = state.player;
    if (!p) {
      c.fillStyle = 'rgba(255,255,255,0.75)';
      c.font = 'bold 11px "Microsoft YaHei", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('罗盘', w / 2, h / 2);
      return;
    }

    // 世界方位角：0 = 正北，90 = 东（游戏里 +Z 为北、+X 为东）
    const deg = (yawDeg(num(p, 'yaw')) ?? 0) + 180;
    const bearing = ((deg % 360) + 360) % 360;
    const pxPerDeg = 9;
    const stripBottom = 27;
    const CLOCK = { 0: '12点', 45: '1:30', 90: '3点', 135: '4:30', 180: '6点', 225: '7:30', 270: '9点', 315: '10:30' };

    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let a = 0; a < 360; a += 5) {
      let diff = ((a - bearing + 180) % 360 + 360) % 360 - 180;
      const x = w / 2 + diff * pxPerDeg;
      if (x < 6 || x > w - 6) continue;
      const mid = a % 45 === 0;
      const big = a % 90 === 0;
      c.strokeStyle = big ? 'rgba(255,255,255,0.8)' : (mid ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.22)');
      c.beginPath();
      c.moveTo(x, stripBottom - (big ? 9 : mid ? 6 : 3));
      c.lineTo(x, stripBottom - 1);
      c.stroke();
      if (mid) {
        c.fillStyle = big ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)';
        c.font = (big ? 'bold 9px' : '7px') + ' "Microsoft YaHei", sans-serif';
        c.fillText(CLOCK[a], x, 8);
      }
    }

    // PUBG 式：把已标记的路径点按方位嵌进罗盘条
    if (getS('hud', 'compassMarks') !== false) {
      const tp2 = targetPos(p);
      if (tp2) {
        for (const wp of (cfg.waypoints || [])) {
          const dx = wp.x - tp2[0], dz = wp.z - tp2[2];
          const wb = (Math.atan2(dx, dz) * 180 / Math.PI + 360) % 360;
          const d = ((wb - bearing + 540) % 360) - 180;
          const x = w / 2 + d * pxPerDeg;
          const dist = Math.round(Math.hypot(dx, dz));
          const clamped = Math.max(9, Math.min(w - 9, x));
          c.fillStyle = wp.color;
          if (x < 9 || x > w - 9) {
            c.beginPath();
            c.moveTo(clamped, 17); c.lineTo(clamped + (x < 9 ? -4 : 4), 21);
            c.lineTo(clamped + (x < 9 ? -4 : 4), 13); c.closePath(); c.fill();
          } else {
            c.beginPath();
            c.moveTo(x, 15); c.lineTo(x + 3.5, 19); c.lineTo(x, 23); c.lineTo(x - 3.5, 19);
            c.closePath(); c.fill();
            c.font = '700 6.5px "Microsoft YaHei", sans-serif';
            c.fillStyle = 'rgba(255,255,255,.95)';
            c.fillText(wp.name, x, 10);
            c.fillStyle = 'rgba(210,218,232,.8)';
            c.fillText(dist + 'm', x, 30);
          }
        }
      }
    }

    // 中心指示
    c.fillStyle = '#ffffff';
    c.fillRect(w / 2 - 0.8, stripBottom - 7, 1.6, 7);
    c.beginPath();
    c.moveTo(w / 2, 2); c.lineTo(w / 2 - 3, 7); c.lineTo(w / 2 + 3, 7);
    c.closePath(); c.fill();

    // 第二行：几点方向 + 度数 + 经纬度
    const hv = bearing / 30;
    const hh = Math.floor(hv) || 12;
    const mm = Math.round((hv - Math.floor(hv)) * 60);
    const clock = mm ? hh + ':' + (mm < 10 ? '0' : '') + mm : hh + '点';
    const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
    const dir = DIRS[Math.round(bearing / 45) % 8];
    c.textAlign = 'left';
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.font = 'bold 7px "Microsoft YaHei", sans-serif';
    c.fillText(clock + ' · ' + dir + ' · ' + Math.round(bearing) + '°', 7, 34);
    c.textAlign = 'right';
    c.fillStyle = 'rgba(190,190,200,0.85)';
    c.font = '6.5px "Microsoft YaHei", sans-serif';
    const tp = targetPos(p);
    if (tp) c.fillText('经度 ' + Math.round(tp[0]) + ' · 纬度 ' + Math.round(tp[2]), w - 7, 34);
  }

  // ---------- 帧驱动 ----------
  function onFrame(alpha) {
    __sCache = {};
    try {
      applyXrayWorld(modOn('xray') && getS('xray', 'mode') === '材质透视'
        && (!state.game || !state.game.state || state.game.state === 'play'));
      espFrame.alpha = alpha;
      try { tickModules(); } catch (e) { /* noop */ }
      try { espFrame(); } catch (e) { /* noop */ }
      try { updateMotionBlur(state.player); } catch (e) { /* noop */ }
    } finally { __sCache = null; }
  }

  let fallbackStarted = false;
  function startFallbackLoop() {
    if (fallbackStarted) return;
    fallbackStarted = true;
    const loop = () => { try { onFrame(null); } catch (e) { /* noop */ } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // 屏外标记贴边位置：把世界方位角换算成「相对当前视角」的角度，转视角时跟着绕
  function edgePoint(dx, dz, p, W_, H_) {
    const bearingDeg = ((yawDeg(num(p, 'yaw')) ?? 0) + 180 + 360) % 360;
    const worldBearing = (Math.atan2(dx, dz) * 180 / Math.PI + 360) % 360;
    const diff = ((worldBearing - bearingDeg + 540) % 360) - 180;
    const ang = diff * Math.PI / 180;
    const rad = Math.min(W_, H_) * 0.42;
    return {
      x: Math.max(20, Math.min(W_ - 20, W_ / 2 + Math.sin(ang) * rad)),
      y: Math.max(20, Math.min(H_ - 20, H_ / 2 - Math.cos(ang) * rad * 0.72)),
    };
  }

  // ---- 掉落物汇总 HUD ----
  const dropBox = document.createElement('div');
  dropBox.id = '__comet_drops';
  makeDraggable(dropBox, 'dropsPos', 'right', 'top', 16, 210);
  function updateDrops() {
    const on = modOn('drops') || state.editHud;
    dropBox.style.display = on ? '' : 'none';
    dropBox.classList.toggle('glass', cfg.theme === 'glass');
    applyPanelPos(dropBox, 'dropsPos', 'right', 'top', 16, 210);
    if (!on) return;
    const g = state.game, p = state.player;
    const c = p && playerCenter(p, 1);
    if (!g || !c || !Array.isArray(g.entities)) {
      dropBox.innerHTML = '<div class="cm-dtitle">掉落物 · 等待进入世界</div>';
      return;
    }
    const R = Math.max(8, Number(getS('drops', 'range')) || 32);
    const maxN = Math.max(4, Number(getS('drops', 'max')) || 10);
    const xpOn = getS('drops', 'xp') !== false;
    const map = new Map();
    for (const e of g.entities) {
      try {
        if (!e || e === p || e.dead) continue;
        const kind = itemKindOf(e);
        if (!kind) continue;
        const cls = (e.constructor && e.constructor.name) || '';
        if (!xpOn && cls === 'ExperienceOrb') continue;
        const q = Array.isArray(e.pos) ? e.pos : null;
        if (!q) continue;
        const d = Math.hypot(q[0] - c[0], q[2] - c[2]);
        if (d > R) continue;
        const nm = String(displayName(e)).replace(/\s*×\s*\d+\s*$/, '');
        const cnt = (e.stack && (e.stack.count || e.stack.n)) || 1;
        const cur = map.get(nm) || { n: 0, d: Infinity, color: kind };
        cur.n += cnt; cur.d = Math.min(cur.d, d);
        map.set(nm, cur);
      } catch (err) { /* noop */ }
    }
    const list = [...map.entries()].sort((a, b) => a[1].d - b[1].d).slice(0, maxN);
    let html = '<div class="cm-dtitle">附近掉落物 <span>' + map.size + ' 种</span></div>';
    if (!list.length) html += '<div class="cm-dempty">范围内没有掉落物</div>';
    for (const [nm, v] of list) {
      const h = (nm.length * 37) % 8;
      html += '<div class="cm-drow"><i class="cm-dc' + h + '"></i>'
        + '<span class="cm-dname">' + escHtml(nm) + '</span>'
        + '<span class="cm-dq">×' + v.n + '</span>'
        + '<span class="cm-dd">' + Math.round(v.d) + 'm</span></div>';
    }
    if (dropBox.__last !== html) { dropBox.innerHTML = html; dropBox.__last = html; }
  }

  // 面板位置统一拖动：GUI 打开时可拖，关掉后 pointer-events:none 不挡游戏
  function applyPanelPos(el, key, ax, ay, defX, defY) {
    const pos = cfg[key] || { x: defX, y: defY };
    el.style[ax] = pos.x + 'px';
    el.style[ay] = pos.y + 'px';
    el.style[ax === 'left' ? 'right' : 'left'] = 'auto';
    el.style[ay === 'top' ? 'bottom' : 'top'] = 'auto';
    const canDrag = guiOpen() || state.editHud || state.editPanels;
    el.style.pointerEvents = (canDrag || el.__alwaysInteractive) ? 'auto' : 'none';
    el.classList.toggle('cm-draggable', canDrag);
  }
  function makeDraggable(el, key, ax, ay, defX, defY) {
    draggables.push({ el, key, ax, ay, defX, defY });
  }
  // userscript 在 document-start 注入，这个 window capture 监听早于游戏注册，
  // stopImmediatePropagation 能挡住游戏「把一切 mousedown 变成指针锁定」的监听器。
  W.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    if (!(guiOpen() || state.editHud || state.editPanels)) return;
    const t = ev.target;
    let hit = null;
    for (const d of draggables) {
      if (d.el === t || (d.el.contains && d.el.contains(t))) { hit = d; break; }
    }
    if (!hit) return;
    // 播放器面板内部的按钮 / 输入框 / 列表不能被拖动 capture 吞掉
    if (hit.el.id === '__comet_music') {
      const tcls = String((t && t.className) || '');
      if (/cm-mu(btn|input|row|close|bar|fill)/.test(tcls)) return;
    }
    // 扩展 HUD 的标题要能点击折叠、面板要能滚轮滚动
    if (hit.el.id === '__comet_ext') {
      const tcls = String((t && t.className) || '');
      if (/cm-exttitle|cm-extfold/.test(tcls)) return;
    }
    ev.preventDefault(); ev.stopImmediatePropagation();
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* noop */ }
    try { if (state.game && state.game.releasePointer) state.game.releasePointer(); } catch (e) { /* noop */ }
    const cur = cfg[hit.key] || { x: hit.defX, y: hit.defY };
    const drag = { sx: ev.clientX, sy: ev.clientY, ox: cur.x, oy: cur.y };
    const move = (e2) => {
      const nx = drag.ox + (hit.ax === 'right' ? -(e2.clientX - drag.sx) : (e2.clientX - drag.sx));
      const ny = drag.oy + (hit.ay === 'bottom' ? -(e2.clientY - drag.sy) : (e2.clientY - drag.sy));
      cfg[hit.key] = { x: Math.max(0, Math.round(nx)), y: Math.max(0, Math.round(ny)) };
      applyPanelPos(hit.el, hit.key, hit.ax, hit.ay, hit.defX, hit.defY);
    };
    const up = () => {
      W.removeEventListener('mousemove', move);
      W.removeEventListener('mouseup', up);
      saveCfg();
    };
    W.addEventListener('mousemove', move);
    W.addEventListener('mouseup', up);
  }, true);
  function resetPanelPos(key, x, y) {
    cfg[key] = { x, y };
    saveCfg();
    pushNotification('面板位置', '已重置');
  }

  // ---- 方块追踪：可搜索的方块选择器 ----
  const blockPick = mk('div');
  blockPick.id = '__comet_blockpick';
  const bpH = mk('div', 'cm-bphead');
  bpH.append(mk('span', 'cm-bptitle', '选择追踪方块'));
  const bpClose = mk('div', 'cm-bpclose', '×');
  bpH.append(bpClose);
  const bpInput = document.createElement('input');
  bpInput.className = 'cm-bpinput';
  bpInput.placeholder = '搜索中文名或英文 key…';
  bpInput.spellcheck = false;
  const bpList = mk('div', 'cm-bplist');
  blockPick.append(bpH, bpInput, bpList);
  let blockPickOpen = false;

  function renderBlockList(q) {
    bpList.innerHTML = '';
    const s = String(q || '').trim().toLowerCase();
    // 线上 BLOCK_DATA 有可能是词法变量没挂 window，给一份常用兜底表保证列表不空
    const src = (Array.isArray(W.BLOCK_DATA) && W.BLOCK_DATA.length) ? W.BLOCK_DATA : [
      { id: 1, key: 'stone', cn: '石头' }, { id: 2, key: 'dirt', cn: '泥土' },
      { id: 3, key: 'grass_block', cn: '草方块' }, { id: 4, key: 'cobblestone', cn: '圆石' },
      { id: 5, key: 'oak_planks', cn: '橡木木板' }, { id: 6, key: 'oak_log', cn: '橡木原木' },
      { id: 7, key: 'diamond_ore', cn: '钻石矿石' }, { id: 8, key: 'iron_ore', cn: '铁矿石' },
      { id: 9, key: 'coal_ore', cn: '煤矿石' }, { id: 10, key: 'gold_ore', cn: '金矿石' },
      { id: 11, key: 'chest', cn: '箱子' }, { id: 12, key: 'crafting_table', cn: '工作台' },
      { id: 13, key: 'furnace', cn: '熔炉' }, { id: 14, key: 'sand', cn: '沙子' },
      { id: 15, key: 'glass', cn: '玻璃' }, { id: 16, key: 'obsidian', cn: '黑曜石' },
    ];
    let n = 0;
    for (const d of src) {
      if (!d || d.id == null) continue;
      const k = String(d.key || ''), cn = String(d.cn || '');
      if (!k && !cn) continue;
      if (s && k.toLowerCase().indexOf(s) < 0 && cn.toLowerCase().indexOf(s) < 0) continue;
      const row = mk('div', 'cm-bprow');
      row.append(mk('span', 'cm-bpcn', cn || k));
      row.append(mk('span', 'cm-bpkey', k));
      row.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        cfg.settings['blockesp.target'] = k || cn;
        saveCfg();
        closeBlockPicker();
        refreshGui();
        pushNotification('方块追踪', '目标已设为 ' + (cn || k));
      });
      bpList.append(row);
      if (++n >= 240) break;
    }
    if (!n) bpList.append(mk('div', 'cm-bpempty', '没有匹配的方块'));
  }
  function openBlockPicker() {
    blockPickOpen = true;
    blockPick.classList.add('open');
    bpInput.value = '';
    renderBlockList('');
    try { bpInput.focus(); } catch (e) { /* noop */ }
  }
  function closeBlockPicker() {
    blockPickOpen = false;
    blockPick.classList.remove('open');
  }
  bpInput.addEventListener('input', () => renderBlockList(bpInput.value));
  bpInput.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.code === 'Escape') closeBlockPicker();
  });
  bpClose.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    closeBlockPicker();
  });

  // ---------- v1.11.0 音乐播放器（Internet Archive 公共领域曲库 + 本地文件） ----------
  // 音频源：archive.org/advancedsearch.php 免 key、CORS 全开；metadata 拿文件名后拼 download URL。
  // 频谱：AudioContext + AnalyserNode；跨域音频必须先在 src 之前设 crossOrigin='anonymous'，
  // 服务端还得给 Access-Control-Allow-Origin，否则 getByteFrequencyData 全零（此时走伪律动兜底）。
  const musicBox = mk('div');
  musicBox.id = '__comet_music';
  musicBox.__alwaysInteractive = true;
  const mh = mk('div', 'cm-muhead');
  mh.append(mk('span', 'cm-mutitle', '音乐播放器'));
  const mClose = mk('div', 'cm-muclose', '×');
  mh.append(mClose);
  const mSearch = mk('div', 'cm-musearch');
  const mInput = document.createElement('input');
  mInput.className = 'cm-muinput';
  mInput.placeholder = '搜索公共领域音乐…';
  mInput.spellcheck = false;
  const mGo = mk('div', 'cm-mubtn', '搜索');
  mSearch.append(mInput, mGo);
  const mStatus = mk('div', 'cm-mustatus', '输入关键词搜索，或载入本地音频');
  const mList = mk('div', 'cm-mulist');
  const mNow = mk('div', 'cm-munow', '未播放');
  const mCtl = mk('div', 'cm-muctl');
  const mPrev = mk('div', 'cm-mubtn', '⏮');
  const mPlay = mk('div', 'cm-mubtn', '▶');
  const mStop = mk('div', 'cm-mubtn', '⏹');
  const mLocal = mk('div', 'cm-mubtn', '本地文件');
  mCtl.append(mPrev, mPlay, mStop, mLocal);
  const mBar = mk('div', 'cm-mubar');
  const mFill = mk('div', 'cm-mufill');
  mBar.append(mFill);
  const mCredit = mk('div', 'cm-mucredit',
    '音乐源：GD音乐台 music.gdstudio.xyz · 仅供个人学习，禁止下载传播或商用');
  musicBox.append(mh, mSearch, mStatus, mList, mNow, mCtl, mBar, mCredit);
  makeDraggable(musicBox, 'musicPos', 'left', 'top', 16, 16);

  const audioEl = document.createElement('audio');
  audioEl.id = '__comet_muaudio';
  // crossOrigin 默认不设：第三方 CDN 大多不给 CORS，设了 anonymous 浏览器会直接拒绝加载音频。
  // 只有用户主动开「频谱优先模式」时才在设 src 之前加上。本地 blob 同源，不设也能拿真频谱。
  let audioCtx = null, analyser = null, freqData = null, mediaSrc = null;
  let mTracks = [], mIndex = -1, mObjectUrl = null;

  function mHttp(url, done, fail) {
    try {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET', url, timeout: 10000,
          onload: (r) => { try { done(JSON.parse(r.responseText)); } catch (e) { fail('解析失败'); } },
          onerror: () => fail('网络错误'), ontimeout: () => fail('超时'),
        });
        return;
      }
    } catch (e) { /* 落到 fetch */ }
    fetch(url).then((r) => r.json()).then(done).catch(() => fail('网络错误'));
  }
  function ensureAudio() {
    if (audioCtx) { try { if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) { /* noop */ } return; }
    try {
      const AC = W.AudioContext || W.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      freqData = new Uint8Array(analyser.frequencyBinCount);
      mediaSrc = audioCtx.createMediaElementSource(audioEl);
      mediaSrc.connect(analyser);
      analyser.connect(audioCtx.destination);
    } catch (e) { analyser = null; }
  }
  function musicSpectrum() {
    if (!analyser || !freqData) return null;
    try { analyser.getByteFrequencyData(freqData); } catch (e) { return null; }
    const n = freqData.length;
    let sum = 0, bass = 0, mid = 0, hi = 0;
    for (let i = 0; i < n; i++) {
      const v = freqData[i]; sum += v;
      if (i < n * 0.12) bass += v;
      else if (i < n * 0.45) mid += v;
      else hi += v;
    }
    if (sum < 8) return null;   // 全零 = CORS 污染或静音
    return {
      bins: freqData, n,
      level: sum / (n * 255),
      bass: bass / Math.max(1, n * 0.12 * 255),
      mid: mid / Math.max(1, n * 0.33 * 255),
      hi: hi / Math.max(1, n * 0.55 * 255),
    };
  }
  function musicPlayUrl(url, title) {
    // createMediaElementSource 会把音频路由进 AudioContext；若 ctx 因自动播放策略
    // 处于 suspended，声音就完全没了。默认不接管，让 <audio> 直接出声（律动走兜底）。
    if (getS('music', 'cors') === true) {
      ensureAudio();
      try { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) { /* noop */ }
    }
    try {
      audioEl.pause();
      // crossOrigin 必须在 src 之前设置/移除，之后改无效
      if (getS('music', 'cors') === true) audioEl.crossOrigin = 'anonymous';
      else { try { audioEl.removeAttribute('crossOrigin'); } catch (e) { /* noop */ } }
      audioEl.src = url;
      audioEl.volume = Math.max(0, Math.min(1, (Number(getS('music', 'volume')) || 70) / 100));
      if (typeof audioEl.load === 'function') audioEl.load();
      mNow.textContent = title || '正在播放';
      mStatus.textContent = '正在加载…';
      const pr = audioEl.play();
      if (pr && pr.then) {
        pr.then(() => {
          mPlay.textContent = '⏸';
          mStatus.textContent = getS('music', 'cors') === true
            ? '播放中 · 尝试读取频谱' : '播放中 · 律动走兜底（可开频谱优先模式）';
        }).catch((e) => {
          mStatus.textContent = '播放失败：' + (e && e.message ? e.message : '音源不可播放')
            + ' · 可换一首或换音源';
        });
      } else {
        mPlay.textContent = '⏸';
        mStatus.textContent = '播放中';
      }
    } catch (e) { mStatus.textContent = '播放失败：' + e.message; }
  }
  audioEl.addEventListener('error', () => {
    mStatus.textContent = '音频加载失败（多为跨域/音源失效），换一首或用本地文件';
    mPlay.textContent = '▶';
  });
  let mLastReq = 0;
  function musicSource() { return String(getS('music', 'source') || 'GD·netease'); }
  function musicThrottle() {
    // API 作者声明「5 分钟内不超 50 次请求」，本地再保守一点
    const now = performance.now();
    const gap = getS('music', 'multi') !== false ? 3000 : 1500;
    if (now - mLastReq < gap) return false;
    mLastReq = now;
    return true;
  }
  function musicRenderList() {
    mList.innerHTML = '';
    if (!mTracks.length) { mStatus.textContent = '没有找到结果，换个关键词或音源试试'; return; }
    mStatus.textContent = '找到 ' + mTracks.length + ' 首 · 点击播放';
    mTracks.forEach((t, i) => {
      const row = mk('div', 'cm-murow');
      row.append(mk('span', 'cm-muname', String(t.name || t.title || '?').slice(0, 40)));
      const au = String(t.artistText || t.creator || '').slice(0, 14);
      row.append(mk('span', 'cm-muauthor', au + (t.srcLabel ? ' [' + t.srcLabel + ']' : '')));
      const pick = (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        mStatus.textContent = '获取播放地址…';
        musicLoad(i);
      };
      row.addEventListener('mousedown', pick);
      row.addEventListener('click', (ev) => { ev.stopPropagation(); });
      mList.append(row);
    });
  }
  // 文档列出的源：netease/tencent/kuwo/tidal/qobuz/joox/bilibili/apple/ytmusic/spotify；
  // kugou（酷狗）文档未列，仍加入链路，取不到会自动换下一个，不会卡住。
  const GD_CHAIN = ['netease', 'kuwo', 'kugou', 'tencent', 'joox', 'bilibili'];
  const GD_LABEL = { netease: '网易', kuwo: '酷我', kugou: '酷狗', tencent: 'QQ',
    joox: 'JOOX', bilibili: 'B站' };
  function gdSearchRows(q, platform, ok, fail) {
    const url = 'https://music-api.gdstudio.xyz/api.php?types=search&source='
      + encodeURIComponent(platform) + '&name=' + encodeURIComponent(q) + '&count=16&pages=1';
    mHttp(url, (d) => {
      const rows = Array.isArray(d) ? d : (d && Array.isArray(d.data) ? d.data : []);
      ok(rows.slice(0, 16).map((r) => ({
        id: r.id, name: r.name, source: r.source || platform,
        srcLabel: GD_LABEL[platform] || platform,
        artistText: Array.isArray(r.artist) ? r.artist.join('/') : String(r.artist || ''),
        album: r.album, pic_id: r.pic_id, lyric_id: r.lyric_id,
      })));
    }, fail);
  }
  function archiveRows(q, ok, fail) {
    const url = 'https://archive.org/advancedsearch.php?q='
      + encodeURIComponent('title:(' + q + ') AND mediatype:audio')
      + '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&rows=16&page=1&output=json';
    mHttp(url, (d) => {
      const docs = (d && d.response && d.response.docs) || [];
      ok(docs.slice(0, 16).map((t) => ({
        identifier: t.identifier, title: t.title, creator: t.creator,
        archive: true, srcLabel: 'Archive',
      })));
    }, fail);
  }
  function musicFinish(rows, label, picks) {
    const seen = new Set(), out = [];
    for (const t of rows) {
      const k = String(t.id || t.identifier || t.name || '') + '|' + String(t.artistText || '');
      if (seen.has(k)) continue;
      seen.add(k); out.push(t);
    }
    mTracks = out.slice(0, 32);
    try { cfg.musicLastSource = label; saveCfg(); } catch (e) { /* noop */ }
    musicRenderList();
    mStatus.textContent = (picks && picks.length > 1
      ? '聚合 ' + picks.length + ' 源 · ' : '来自 ')
      + label + ' · 共 ' + mTracks.length + ' 首 · 点击播放';
  }
  function musicSearch(q) {
    const s = String(q || '').trim();
    if (!s) return;
    if (!musicThrottle()) { mStatus.textContent = '请求太快，等一下再搜（API 限流）'; return; }
    mStatus.textContent = '搜索中…';
    mList.innerHTML = '';
    mTracks = [];
    const src = musicSource();
    const auto = getS('music', 'autoRetry') !== false;
    const multi = getS('music', 'multi') !== false;
    const multiN = Math.max(2, Math.min(6, Number(getS('music', 'multiCount')) || 3));
    const start = src.indexOf('GD·') === 0 ? src.slice(3) : null;
    if (!start) {
      archiveRows(s, (rows) => musicFinish(rows, '公共领域·Archive', []),
        (err) => { mStatus.textContent = '搜索失败：' + err; });
      return;
    }
    const order = [start, ...GD_CHAIN.filter((x) => x !== start)];
    const label = GD_LABEL[start] || start;

    if (multi) {
      // 首选源永远排第一，其余按顺序补足；并发请求后合并去重
      const picks = order.slice(0, multiN);
      let pending = picks.length, all = [];
      mStatus.textContent = '聚合 ' + picks.length + ' 源（首选 ' + label + '）…';
      const done = (rows) => {
        all = all.concat(rows);
        if (--pending <= 0) musicFinish(all, '首选 ' + label, picks);
      };
      for (const p of picks) gdSearchRows(s, p, done, () => done([]));
      return;
    }

    // 单源模式：只在失败/无结果时换源，状态里明确写出「来自 X」
    const chain = auto ? [...order, 'archive'] : [start];
    let idx = 0;
    const tryNext = (why) => {
      if (idx >= chain.length) {
        mStatus.textContent = '所有音源都没找到' + (why ? '（' + why + '）' : '') + '，换个关键词试试';
        musicRenderList();
        return;
      }
      const cur = chain[idx++];
      const curLabel = cur === 'archive' ? '公共领域·Archive' : (GD_LABEL[cur] || cur);
      mStatus.textContent = (idx > 1 ? '换源到 ' : '搜索 ') + curLabel + '…';
      const ok = (rows) => {
        if (!rows.length) { tryNext('无结果'); return; }
        musicFinish(rows, curLabel, []);
      };
      const fail = (err) => {
        mStatus.textContent = curLabel + ' 不可用（' + err + '）'
          + (auto && idx < chain.length ? '，自动换源…' : '');
        tryNext(err);
      };
      if (cur === 'archive') archiveRows(s, ok, fail);
      else gdSearchRows(s, cur, ok, fail);
    };
    tryNext('');
  }
  function musicLoad(i) {
    const t = mTracks[i];
    if (!t) return;
    mIndex = i;
    mStatus.textContent = '获取播放地址…';
    if (t.archive) {
      mHttp('https://archive.org/metadata/' + encodeURIComponent(t.identifier), (d) => {
        const files = (d && d.files) || [];
        const f = files.find((x) => x && /\.(mp3|ogg|m4a|wav)$/i.test(x.name || ''));
        if (!f) { mStatus.textContent = '这条没有可播放的音频文件'; return; }
        musicPlayUrl('https://archive.org/download/' + encodeURIComponent(t.identifier)
          + '/' + encodeURIComponent(f.name), t.title || f.name);
      }, (err) => { mStatus.textContent = '读取失败：' + err; });
      return;
    }
    const br = String(getS('music', 'br') || '320');
    const url = 'https://music-api.gdstudio.xyz/api.php?types=url&source='
      + encodeURIComponent(t.source || 'netease') + '&id=' + encodeURIComponent(t.id) + '&br=' + br;
    mHttp(url, (d) => {
      // 不同音源/版本可能返回 {url}、{data:{url}}、[{url}] 或纯字符串
      let u = null;
      if (typeof d === 'string') u = d;
      else if (Array.isArray(d)) u = d[0] && (d[0].url || d[0]);
      else if (d) u = d.url || (d.data && (d.data.url || (Array.isArray(d.data) && d.data[0] && d.data[0].url)));
      u = (typeof u === 'string' && /^https?:\/\//.test(u)) ? u : null;
      if (!u) { mStatus.textContent = '这个音源暂时取不到地址，换首或切音源'; return; }
      musicPlayUrl(u, t.name + (t.artistText ? ' - ' + t.artistText : ''));
    }, (err) => { mStatus.textContent = '取地址失败：' + err; });
  }
  function musicToggle() {
    if (!audioEl.src) { mStatus.textContent = '先搜索一首或载入本地文件'; return; }
    try {
      if (audioEl.paused) {
        if (getS('music', 'cors') === true) ensureAudio();
        audioEl.play();
        mPlay.textContent = '⏸';
      }
      else { audioEl.pause(); mPlay.textContent = '▶'; }
    } catch (e) { /* noop */ }
  }
  mGo.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); musicSearch(mInput.value); });
  mInput.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.code === 'Enter') musicSearch(mInput.value);
  });
  mPlay.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); musicToggle(); });
  mStop.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    try { audioEl.pause(); audioEl.currentTime = 0; } catch (e) { /* noop */ }
    mPlay.textContent = '▶'; mNow.textContent = '已停止';
  });
  mPrev.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (mTracks.length) musicLoad((mIndex - 1 + mTracks.length) % mTracks.length);
  });
  mLocal.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'audio/*';
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      if (mObjectUrl) { try { URL.revokeObjectURL(mObjectUrl); } catch (e) { /* noop */ } }
      mObjectUrl = URL.createObjectURL(f);   // blob 同源，一定能拿真频谱
      musicPlayUrl(mObjectUrl, f.name);
    });
    inp.click();
  });
  mClose.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    musicBox.classList.remove('open');
  });
  audioEl.addEventListener('timeupdate', () => {
    try {
      const p = audioEl.duration ? (audioEl.currentTime / audioEl.duration) * 100 : 0;
      mFill.style.setProperty('--cm-prog', p.toFixed(1) + '%');
    } catch (e) { /* noop */ }
  });
  function musicBoxOpen(on) {
    musicBox.classList.toggle('open', on == null ? !musicBox.classList.contains('open') : !!on);
    applyPanelPos(musicBox, 'musicPos', 'left', 'top', 16, 16);
  }

  // ---- 视角运动模糊：全屏 backdrop-filter 层，强度随 yaw/pitch 变化速率 ----
  // z-index 低于 HUD 与 ESP，所以只糊游戏画面，UI 和光环保持清晰。
  const mblurEl = mk('div');
  mblurEl.id = '__comet_mblur';
  let mbLastYaw = null, mbLastPitch = null, mbSmooth = 0;
  function updateMotionBlur(p) {
    const on = modOn('mblur');
    mblurEl.classList.toggle('off', !on);
    if (!on) {
      mbSmooth = 0; mbLastYaw = null; mbLastPitch = null;
      mblurEl.style.setProperty('--cm-mblur', '0px');
      return;
    }
    const yaw = num(p, 'yaw'), pitch = num(p, 'pitch') || 0;
    let d = 0;
    if (yaw != null && mbLastYaw != null) {
      let dy = yaw - mbLastYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      d = Math.hypot(dy, pitch - (mbLastPitch || 0));
    }
    mbLastYaw = yaw; mbLastPitch = pitch;
    const strength = Math.max(0, Number(getS('mblur', 'strength')) || 5);
    const decay = Math.max(0.03, Math.min(0.6, Number(getS('mblur', 'decay')) || 0.1));
    const target = Math.min(strength, d * strength * 22);
    mbSmooth += (target - mbSmooth) * (target > mbSmooth ? 0.55 : decay);
    mblurEl.style.setProperty('--cm-mblur', mbSmooth.toFixed(2) + 'px');
  }

  let spinAngle = 0;

  // ---------- v1.12.0 矿透 X-Ray ----------
  const ORE_KINDS = [
    { re: /diamond/, name: '钻石', color: '#4fe8e0' },
    { re: /emerald/, name: '绿宝石', color: '#4fe87a' },
    { re: /ancient_debris|netherite/, name: '残骸', color: '#b98463' },
    { re: /redstone/, name: '红石', color: '#ff5f6d' },
    { re: /lapis/, name: '青金石', color: '#4f7bff' },
    { re: /gold/, name: '金', color: '#ffc857' },
    { re: /iron/, name: '铁', color: '#e3e6ec' },
    { re: /copper/, name: '铜', color: '#e08a5b' },
    { re: /coal/, name: '煤', color: '#8c94a3' },
    { re: /quartz/, name: '石英', color: '#f2f2f2' },
  ];
  let xrayIds = null, xrayById = null, xrayHits = [], xrayAt = 0, xrayKey = '';

  function buildOreTable() {
    if (xrayIds) return xrayIds;
    xrayIds = []; xrayById = new Map();
    const src = Array.isArray(W.BLOCK_DATA) ? W.BLOCK_DATA : [];
    for (const d of src) {
      if (!d || d.id == null) continue;
      const k = String(d.key || '').toLowerCase();
      if (!/(ore|debris|quartz|lapis|redstone)/.test(k)) continue;
      let kind = ORE_KINDS.find((o) => o.re.test(k));
      if (!kind) continue;
      xrayIds.push(d.id);
      xrayById.set(d.id, kind);
    }
    return xrayIds;
  }
  function scanOres(g, p) {
    const ids = buildOreTable();
    const w = g && g.world;
    const c = playerCenter(p, 1);
    if (!ids.length || !w || !w.chunks || !c) { xrayHits = []; return; }
    const R = Math.max(16, Number(getS('xray', 'distance')) || 48);
    const key = R + ':' + Math.floor(c[0] / 16) + ':' + Math.floor(c[2] / 16);
    const now = performance.now();
    if (key === xrayKey && now - xrayAt < 900) return;
    xrayKey = key; xrayAt = now;
    const out = [], R2 = R * R;
    try {
      w.chunks.forEach((ch) => {
        if (!ch || typeof ch.findAll !== 'function') return;
        const ox = ch.cx * 16, oz = ch.cz * 16;
        if (Math.abs(ox + 8 - c[0]) > R + 16 || Math.abs(oz + 8 - c[2]) > R + 16) return;
        // Chunk.findAll 回调是 (index, id)，第二个参数直接就是方块 id
        ch.findAll(ids, (i, id) => {
          if (out.length >= 1200) return;
          const s = i >> 12, cell = i & 4095;
          const x = ox + (cell & 15), y = s * 16 + ((cell >> 8) & 15), z = oz + ((cell >> 4) & 15);
          const dx = x - c[0], dz = z - c[2];
          if (dx * dx + dz * dz > R2) return;
          out.push([x, y, z, xrayById.get(id) || null]);
        });
      });
    } catch (e) { /* noop */ }
    out.sort((a, b) => (Math.hypot(a[0] - c[0], a[2] - c[2]) - Math.hypot(b[0] - c[0], b[2] - c[2])));
    xrayHits = out.slice(0, Math.max(40, Number(getS('xray', 'limit')) || 200));
  }
  function drawXray(r, p, W_, H_, alpha) {
    scanOres(state.game, p);
    if (!xrayHits.length) return;
    const c = playerCenter(p, alpha);
    if (!c) return;
    if (getS('xray', 'mode') === '材质透视') {
      // 只画矿物实心块：纯 fillRect，无描边无辉光，比每个框 strokeRect+shadowBlur 便宜得多
      const cx2 = ectx;
      cx2.save();
      for (const h of xrayHits) {
        const kind = h[3];
        if (!kind) continue;
        const cs = [];
        let bad = false;
        for (let i = 0; i < 8; i++) {
          const q = project(r, h[0] + (i & 1 ? 1 : 0), h[1] + (i & 2 ? 1 : 0),
            h[2] + (i & 4 ? 1 : 0), W_, H_);
          if (!q || Math.abs(q.x) > W_ * 2 || Math.abs(q.y) > H_ * 2) { bad = true; break; }
          cs.push(q);
        }
        if (bad) continue;
        const xs = cs.map((q) => q.x), ys = cs.map((q) => q.y);
        const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
        const y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
        if (x1 < 0 || x0 > W_ || y1 < 0 || y0 > H_) continue;
        // 顶面亮 / 侧面暗，画出方块的体积感
        const faces = [[4, 5, 7, 6, 1], [0, 1, 5, 4, 0.68], [2, 3, 7, 6, 0.52]];
        for (const f of faces) {
          cx2.fillStyle = hexToRgba(kind.color, 0.95 * f[4]);
          cx2.beginPath();
          cx2.moveTo(cs[f[0]].x, cs[f[0]].y);
          for (let j = 1; j < 4; j++) cx2.lineTo(cs[f[j]].x, cs[f[j]].y);
          cx2.closePath(); cx2.fill();
        }
        const bw = Math.max(2, x1 - x0), bh = Math.max(2, y1 - y0);
        cx2.fillStyle = 'rgba(255,255,255,.55)';   // 矿粒高光
        cx2.fillRect(x0 + bw * 0.24, y0 + bh * 0.3, Math.max(1, bw * 0.12), Math.max(1, bh * 0.1));
        cx2.fillRect(x0 + bw * 0.62, y0 + bh * 0.6, Math.max(1, bw * 0.1), Math.max(1, bh * 0.1));
      }
      cx2.restore();
      return;
    }
    const through = getS('xray', 'through') !== false;
    const labels = getS('xray', 'labels') !== false;
    const ctx = ectx;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 10px "Microsoft YaHei", sans-serif';
    for (const h of xrayHits) {
      const kind = h[3];
      if (!kind) continue;
      const dist = Math.hypot(h[0] - c[0], h[1] - c[1], h[2] - c[2]);
      const cs = [];
      let bad = false;
      for (let i = 0; i < 8; i++) {
        const q = project(r, h[0] + (i & 1 ? 1 : 0), h[1] + (i & 2 ? 1 : 0), h[2] + (i & 4 ? 1 : 0), W_, H_);
        if (!q || Math.abs(q.x) > W_ * 2 || Math.abs(q.y) > H_ * 2) { bad = true; break; }
        cs.push(q);
      }
      if (bad) continue;
      const xs = cs.map((q) => q.x), ys = cs.map((q) => q.y);
      const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
      const y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      if (x1 < 0 || x0 > W_ || y1 < 0 || y0 > H_) continue;
      const bw = Math.max(2, x1 - x0), bh = Math.max(2, y1 - y0);
      ctx.globalAlpha = through ? 0.9 : 0.5;
      ctx.fillStyle = hexToRgba(kind.color, 0.2);
      ctx.fillRect(x0, y0, bw, bh);
      ctx.strokeStyle = kind.color;
      ctx.lineWidth = 1.4;
      ctx.shadowColor = kind.color; ctx.shadowBlur = 7;
      ctx.strokeRect(x0, y0, bw, bh);
      ctx.shadowBlur = 0;
      if (labels && dist < 24) {
        ctx.fillStyle = 'rgba(0,0,0,.7)';
        ctx.fillRect((x0 + x1) / 2 - 17, y0 - 13, 34, 12);
        ctx.fillStyle = kind.color;
        ctx.fillText(kind.name, (x0 + x1) / 2, y0 - 7);
      }
    }
    ctx.restore();
  }

  // ---------- v1.8.0 方块追踪 ----------
  // 游戏自带 Chunk.findAll(ids, fn)：先查 section palette，再逐格回调，比自己扫 getBlock 快得多
  let blockHits = [], blockScanAt = 0, blockScanKey = '';

  function targetBlockIds(query) {
    const out = [];
    const q = String(query || '').trim().toLowerCase();
    if (!q) return out;
    for (const src of [W.BLOCK_DATA, W.ITEM_DATA]) {
      if (!Array.isArray(src)) continue;
      for (const d of src) {
        if (!d || d.id == null) continue;
        const k = String(d.key || '').toLowerCase();
        const cn = String(d.cn || '').toLowerCase();
        if (k === q || cn === q || k.indexOf(q) >= 0 || cn.indexOf(q) >= 0) {
          if (out.indexOf(d.id) === -1) out.push(d.id);
        }
      }
    }
    return out;
  }

  function scanBlocks(g, p) {
    const w = g && g.world;
    const q = String(getS('blockesp', 'target') || '').trim();
    if (!w || !w.chunks || !q) { blockHits = []; return; }
    const ids = targetBlockIds(q);
    if (!ids.length) { blockHits = []; return; }
    const c = playerCenter(p, 1);
    if (!c) return;
    const R = Math.max(16, Number(getS('blockesp', 'radius')) || 48);
    const key = q + ':' + R + ':' + Math.floor(c[0] / 16) + ':' + Math.floor(c[2] / 16);
    const now = performance.now();
    if (key === blockScanKey && now - blockScanAt < 900) return;
    blockScanKey = key; blockScanAt = now;
    const set = new Set(ids), out = [], R2 = R * R;
    try {
      w.chunks.forEach((ch) => {
        if (!ch || typeof ch.findAll !== 'function') return;
        const ox = ch.cx * 16, oz = ch.cz * 16;
        if (Math.abs(ox + 8 - c[0]) > R + 16 || Math.abs(oz + 8 - c[2]) > R + 16) return;
        ch.findAll(ids, (i) => {
          if (out.length >= 1200) return;
          // 全局索引 = section<<12 | (y<<8 | z<<4 | x)，section 从 y=0 起每 16 格
          const s = i >> 12, cell = i & 4095;
          const x = ox + (cell & 15), y = s * 16 + ((cell >> 8) & 15), z = oz + ((cell >> 4) & 15);
          const dx = x - c[0], dz = z - c[2], dy = y - c[1];
          if (dx * dx + dz * dz > R2 || Math.abs(dy) > R) return;
          try { const got = w.getBlock(x, y, z); if (got && !set.has(got)) return; } catch (e) { /* noop */ }
          out.push([x, y, z]);
        });
      });
    } catch (e) { /* noop */ }
    out.sort((a, b) => (Math.hypot(a[0] - c[0], a[2] - c[2]) - Math.hypot(b[0] - c[0], b[2] - c[2])));
    blockHits = out.slice(0, Math.max(20, Number(getS('blockesp', 'limit')) || 120));
  }

  function drawBlockTracker(r, p, W_, H_, alpha) {
    scanBlocks(state.game, p);
    if (!blockHits.length) return;
    const c = playerCenter(p, alpha);
    if (!c) return;
    const color = String(getS('blockesp', 'color') || '').trim() || '#ffd54f';
    const lw = Math.max(1, Number(getS('blockesp', 'width')) || 2);
    const edgeOn = getS('blockesp', 'edge') !== false;
    const ctx = ectx;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 11px "Microsoft YaHei", sans-serif';
    for (const b of blockHits) {
      const dist = Math.hypot(b[0] - c[0], b[1] - c[1], b[2] - c[2]);
      const cs = [];
      let bad = false;
      for (let i = 0; i < 8; i++) {
        const q = project(r, b[0] + (i & 1 ? 1 : 0), b[1] + (i & 2 ? 1 : 0), b[2] + (i & 4 ? 1 : 0), W_, H_);
        if (!q || Math.abs(q.x) > W_ * 2 || Math.abs(q.y) > H_ * 2) { bad = true; break; }
        cs.push(q);
      }
      let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
      if (!bad) {
        x0 = Math.min.apply(null, cs.map((q) => q.x)); x1 = Math.max.apply(null, cs.map((q) => q.x));
        y0 = Math.min.apply(null, cs.map((q) => q.y)); y1 = Math.max.apply(null, cs.map((q) => q.y));
      }
      const off = bad || x1 < 0 || x0 > W_ || y1 < 0 || y0 > H_;
      if (off) {
        if (!edgeOn) continue;
        const ep = edgePoint(b[0] - c[0], b[2] - c[2], p, W_, H_);
        const px = ep.x, py = ep.y;
        ctx.fillStyle = hexToRgba(color, .85);
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      const bw = Math.max(3, x1 - x0), bh = Math.max(3, y1 - y0);
      ctx.fillStyle = hexToRgba(color, .14); ctx.fillRect(x0, y0, bw, bh);
      ctx.strokeStyle = color; ctx.lineWidth = lw;
      ctx.shadowColor = color; ctx.shadowBlur = 6;
      ctx.strokeRect(x0, y0, bw, bh);
      ctx.shadowBlur = 0;
      if (dist < 48) {
        ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect((x0 + x1) / 2 - 18, y0 - 15, 36, 13);
        ctx.fillStyle = '#fff'; ctx.fillText(Math.round(dist) + 'm', (x0 + x1) / 2, y0 - 8);
      }
    }
    ctx.restore();
  }

  // ---------- v1.8.0 Xaero 式大地图（M 打开） ----------
  const bigmap = document.createElement('div');
  bigmap.id = '__comet_bigmap';
  const bigHead = mk('div', 'cm-bmhead');
  const bigTitle = mk('span', 'cm-bmtitle', '地图');
  const bigHint = mk('span', 'cm-bmhint', '滚轮缩放 · 拖动平移 · 左键点地图设路径点 · M / Esc 关闭');
  bigHead.append(bigTitle, bigHint);
  const bigCanvas = document.createElement('canvas');
  bigCanvas.id = '__comet_bigmapcv';
  bigCanvas.width = 960; bigCanvas.height = 680;
  bigmap.append(bigHead, bigCanvas);
  const bctx = bigCanvas.getContext('2d');
  const bigTerrain = document.createElement('canvas');
  bigTerrain.width = 128; bigTerrain.height = 128;
  const btctx = bigTerrain.getContext('2d');
  let bigOpen = false, bigZoom = 96, bigOffX = 0, bigOffZ = 0;
  let bigAt = 0, bigKey = '';
  let bigDrag = null;

  function bigmapOpen(on) {
    bigOpen = on == null ? !bigOpen : !!on;
    bigmap.classList.toggle('open', bigOpen);
    document.documentElement.classList.toggle('cm-map-open', bigOpen);
    if (bigOpen) {
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* noop */ }
      drawBigMap();
    }
  }
  function bigWorldAt(sx, sy) {
    const p = state.player, c = p && playerCenter(p, 1);
    if (!c) return null;
    const S = bigCanvas.width, H = bigCanvas.height;
    return [c[0] + bigOffX + (sx - S / 2) / S * bigZoom * 2,
            c[2] + bigOffZ + (sy - H / 2) / H * bigZoom * 2];
  }
  function refreshBigTerrain(g, px, pz, py) {
    const w = g && g.world;
    if (!w || typeof w.getBlock !== 'function') return;
    const key = Math.round(px * 2) + ':' + Math.round(pz * 2) + ':' + bigZoom + ':' + Math.floor(py);
    const now = performance.now();
    if (key === bigKey && now - bigAt < 600) return;
    bigKey = key; bigAt = now;
    let img;
    try { img = btctx.createImageData(128, 128); } catch (e) { return; }
    if (!img || !img.data) return;
    const step = (bigZoom * 2) / 128;
    for (let j = 0; j < 128; j++) {
      for (let i = 0; i < 128; i++) {
        const wx = Math.floor(px - bigZoom + i * step);
        const wz = Math.floor(pz - bigZoom + j * step);
        let rgb = null;
        for (let dy = 4; dy >= -5; dy--) {
          let id = 0;
          try { id = w.getBlock(wx, py + dy, wz); } catch (e) { break; }
          if (id) { rgb = blockRGB(id); break; }
        }
        const o = (j * 128 + i) * 4;
        if (rgb) { img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 240; }
        else img.data[o + 3] = 0;
      }
    }
    try { btctx.putImageData(img, 0, 0); } catch (e) { /* noop */ }
  }
  function drawBigMap() {
    if (!bigOpen) return;
    const S = bigCanvas.width, H = bigCanvas.height, ctx = bctx;
    ctx.clearRect(0, 0, S, H);
    ctx.fillStyle = 'rgba(12,17,26,.94)'; ctx.fillRect(0, 0, S, H);
    const g = state.game, p = state.player;
    const c = (g && p) ? playerCenter(p, 1) : null;
    const centerX = c ? c[0] + bigOffX : bigOffX;
    const centerZ = c ? c[2] + bigOffZ : bigOffZ;
    if (c && g.world && mapOpt('terrain', true)) refreshBigTerrain(g, centerX, centerZ, Math.floor(c[1]));
    ctx.imageSmoothingEnabled = false;
    if (mapOpt('terrain', true)) ctx.drawImage(bigTerrain, 0, 0, S, H);
    else { ctx.fillStyle = 'rgba(20,28,40,.9)'; ctx.fillRect(0, 0, S, H); }
    // 坐标网格
    ctx.strokeStyle = 'rgba(255,255,255,.09)'; ctx.lineWidth = 1;
    const gridOn = mapOpt('grid', true);
    const grid = bigZoom >= 128 ? 64 : bigZoom >= 48 ? 32 : 16;
    if (gridOn) {
      for (let gx = Math.floor((centerX - bigZoom) / grid) * grid; gx < centerX + bigZoom; gx += grid) {
        const x = (gx - (centerX - bigZoom)) / (bigZoom * 2) * S;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let gz = Math.floor((centerZ - bigZoom) / grid) * grid; gz < centerZ + bigZoom; gz += grid) {
        const y = (gz - (centerZ - bigZoom)) / (bigZoom * 2) * H;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke();
      }
    }
    const toScreen = (wx, wz) => [(wx - (centerX - bigZoom)) / (bigZoom * 2) * S,
                                  (wz - (centerZ - bigZoom)) / (bigZoom * 2) * H];
    // 实体
    if (c && mapOpt('entities', true) && Array.isArray(g.entities)) {
      for (const e of g.entities) {
        try {
          if (!e || e === p || e.dead) continue;
          const q = Array.isArray(e.pos) ? e.pos : null;
          if (!q) continue;
          const [sx, sy] = toScreen(q[0], q[2]);
          ctx.fillStyle = (e.health != null) ? (e.T && e.T.hostile ? '#ff5252' : '#4fc3f7') : '#ffd54f';
          ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
        } catch (err) { /* noop */ }
      }
    }
    // 方块追踪命中
    for (const b of blockHits) {
      const [sx, sy] = toScreen(b[0], b[2]);
      ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 1.5;
      ctx.strokeRect(sx - 3, sy - 3, 6, 6);
    }
    // 路径点
    ctx.textAlign = 'center'; ctx.font = '700 13px "Microsoft YaHei", sans-serif';
    for (const wp of (cfg.waypoints || [])) {
      const [sx, sy] = toScreen(wp.x, wp.z);
      ctx.fillStyle = wp.color; ctx.shadowColor = wp.color; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(sx, sy - 7); ctx.lineTo(sx + 7, sy);
      ctx.lineTo(sx, sy + 7); ctx.lineTo(sx - 7, sy); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.fillRect(sx - 28, sy - 26, 56, 15);
      ctx.fillStyle = '#fff'; ctx.fillText(wp.name, sx, sy - 14);
    }
    // 玩家
    if (c) {
      const [sx, sy] = toScreen(c[0], c[2]);
      const yaw = num(p, 'yaw', 'rotationY') || 0;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(-yaw);
      ctx.fillStyle = '#fff'; ctx.shadowColor = '#000'; ctx.shadowBlur = 5;
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8);
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
    bigTitle.textContent = '地图 · ' + (c ? Math.floor(c[0]) + ' / ' + Math.floor(c[2]) : '--')
      + ' · 半径 ' + Math.round(bigZoom) + ' 格 · 路径点 ' + (cfg.waypoints || []).length;
  }

  bigCanvas.addEventListener('wheel', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    bigZoom = Math.max(16, Math.min(512, bigZoom * (ev.deltaY > 0 ? 1.2 : 1 / 1.2)));
    bigKey = ''; drawBigMap();
  }, { passive: false });
  bigCanvas.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    bigDrag = { x: ev.clientX, y: ev.clientY, moved: false };
  });
  W.addEventListener('mousemove', (ev) => {
    if (!bigDrag || !bigOpen) return;
    const dx = ev.clientX - bigDrag.x, dy = ev.clientY - bigDrag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) bigDrag.moved = true;
    bigOffX -= dx / bigCanvas.width * bigZoom * 2;
    bigOffZ -= dy / bigCanvas.height * bigZoom * 2;
    bigDrag.x = ev.clientX; bigDrag.y = ev.clientY;
    bigKey = ''; drawBigMap();
  });
  W.addEventListener('mouseup', () => {
    if (!bigDrag) return;
    if (!bigDrag.moved && typeof addWaypoint === 'function') {
      const q = bigWorldAt(bigDrag.__sx || bigCanvas.width / 2, bigDrag.__sy || bigCanvas.height / 2);
      if (q) addWaypoint(null, q[0], state.player ? (playerCenter(state.player, 1) || [0, 64, 0])[1] : 64, q[1]);
    }
    bigDrag = null;
  });
  bigCanvas.addEventListener('click', (ev) => {
    if (!bigOpen) return;
    const rect = bigCanvas.getBoundingClientRect();
    const sx = (ev.clientX - rect.left) / rect.width * bigCanvas.width;
    const sy = (ev.clientY - rect.top) / rect.height * bigCanvas.height;
    const q = bigWorldAt(sx, sy);
    if (q && typeof addWaypoint === 'function') {
      const py = state.player ? (playerCenter(state.player, 1) || [0, 64, 0])[1] : 64;
      addWaypoint(null, q[0], py, q[1]);
      drawBigMap();
    }
  });
  // ---- Xaero 式右键上下文菜单 ----
  const bigMenu = mk('div');
  bigMenu.id = '__comet_bigmenu';
  bigmap.append(bigMenu);
  const bigEdit = mk('div');
  bigEdit.id = '__comet_bigedit';
  bigmap.append(bigEdit);
  let bigFollow = true;

  function hideBigMenu() { bigMenu.classList.remove('open'); }
  function bigPrompt(title, value, done) {
    bigEdit.innerHTML = '';
    bigEdit.append(mk('span', 'cm-belabel', title));
    const inp = document.createElement('input');
    inp.value = value == null ? '' : String(value);
    inp.className = 'cm-beinput';
    const go = mk('div', 'cm-bebtn', '确定');
    const cancel = mk('div', 'cm-bebtn', '取消');
    const submit = () => { const v = inp.value.trim(); bigEdit.classList.remove('open'); if (v) done(v); drawBigMap(); };
    go.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); submit(); });
    cancel.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); bigEdit.classList.remove('open'); });
    inp.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.code === 'Enter') submit();
      if (ev.code === 'Escape') bigEdit.classList.remove('open');
    });
    bigEdit.append(inp, go, cancel);
    bigEdit.classList.add('open');
    try { inp.focus(); } catch (e) { /* noop */ }
  }
  function mapOpt(k, def) {
    if (!cfg.mapOpts) cfg.mapOpts = {};
    return cfg.mapOpts[k] === undefined ? def : cfg.mapOpts[k];
  }
  function toggleMapOpt(k) {
    if (!cfg.mapOpts) cfg.mapOpts = {};
    cfg.mapOpts[k] = !mapOpt(k, true);
    saveCfg();
    bigKey = '';
    drawBigMap();
  }
  function showBigMenu(clientX, clientY, wx, wz, wp) {
    bigMenu.innerHTML = '';
    const items = [];
    if (wp) {
      items.push(['重命名：' + wp.name, () => bigPrompt('新名字', wp.name, (v) => { wp.name = v; saveCfg(); })]);
      items.push(['切换颜色', () => {
        const i = WP_COLORS.indexOf(wp.color);
        wp.color = WP_COLORS[(i + 1 + WP_COLORS.length) % WP_COLORS.length];
        saveCfg();
      }]);
      items.push(['删除这个路径点', () => {
        cfg.waypoints = (cfg.waypoints || []).filter((x) => x !== wp);
        saveCfg();
      }]);
      items.push(['设为地图中心', () => { bigFollow = false; bigOffX = wp.x - (c0() || 0); bigOffZ = wp.z - (c2() || 0); bigKey = ''; }]);
    } else {
      items.push(['在此新建路径点', () => bigPrompt('路径点名字', '点 ' + ((cfg.waypoints || []).length + 1), (v) => {
        const py = state.player ? (playerCenter(state.player, 1) || [0, 64, 0])[1] : 64;
        addWaypoint(v, wx, py, wz);
      })]);
    }
    items.push(['复制坐标 (' + Math.round(wx) + ', ' + Math.round(wz) + ')', () => {
      try { navigator.clipboard.writeText(Math.round(wx) + ' / ' + Math.round(wz)); pushNotification('地图', '坐标已复制'); }
      catch (e) { pushNotification('地图', '坐标：' + Math.round(wx) + ' / ' + Math.round(wz)); }
    }]);
    items.push([bigFollow ? '切换：自由移动' : '切换：跟随玩家', () => {
      bigFollow = !bigFollow;
      if (bigFollow) { bigOffX = 0; bigOffZ = 0; }
      bigKey = '';
    }]);
    items.push(['放大 / 缩小', () => { bigZoom = bigZoom < 160 ? bigZoom * 1.5 : Math.max(16, bigZoom / 1.5); bigKey = ''; }]);
    items.push([mapOpt('grid', true) ? '隐藏坐标网格' : '显示坐标网格', () => toggleMapOpt('grid')]);
    items.push([mapOpt('entities', true) ? '隐藏实体点' : '显示实体点', () => toggleMapOpt('entities')]);
    items.push([mapOpt('terrain', true) ? '隐藏地形' : '显示地形', () => toggleMapOpt('terrain')]);
    items.push(['清空全部路径点', () => { cfg.waypoints = []; saveCfg(); }]);
    for (const [label, fn] of items) {
      const row = mk('div', 'cm-bmrow', label);
      row.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (ev.button !== 0) return;
        try { fn(); } catch (e) { /* noop */ }
        hideBigMenu();
        drawBigMap();
      });
      bigMenu.append(row);
    }
    bigMenu.style.left = Math.max(4, Math.min(W.innerWidth - 220, clientX)) + 'px';
    bigMenu.style.top = Math.max(4, Math.min(W.innerHeight - 340, clientY)) + 'px';
    bigMenu.classList.add('open');
  }
  function c0() { const p = state.player, q = p && playerCenter(p, 1); return q ? q[0] : 0; }
  function c2() { const p = state.player, q = p && playerCenter(p, 1); return q ? q[2] : 0; }

  bigCanvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const rect = bigCanvas.getBoundingClientRect();
    const sx = (ev.clientX - rect.left) / rect.width * bigCanvas.width;
    const sy = (ev.clientY - rect.top) / rect.height * bigCanvas.height;
    const q = bigWorldAt(sx, sy);
    if (!q) return;
    let picked = null, best = 16;
    for (const wp of (cfg.waypoints || [])) {
      const wx = (wp.x - (c0() + bigOffX - bigZoom)) / (bigZoom * 2) * bigCanvas.width;
      const wy = (wp.z - (c2() + bigOffZ - bigZoom)) / (bigZoom * 2) * bigCanvas.height;
      const d = Math.hypot(wx - sx, wy - sy);
      if (d < best) { best = d; picked = wp; }
    }
    showBigMenu(ev.clientX, ev.clientY, q[0], q[1], picked);
  });
  bigmap.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
  bigmap.addEventListener('mousedown', (ev) => {
    if (ev.target !== bigCanvas) hideBigMenu();
  });

  // ---------- v1.7.0 官方正脸 / 路径点 / 小地图 / 背包 ----------
  const WP_COLORS = ['#ff5f6d', '#4fc3f7', '#66e0a3', '#ffc857', '#c084fc', '#ff9ad5'];
  const faceImgs = {};
  let facePending = false;

  // 游戏自带官方贴图（etex.js 把 vanilla textures 以 data URI 挂在 window.ETEX）
  function faceTexture(type, skin) {
    try {
      const E = W.ETEX;
      if (!E || !type) return null;
      if (type === 'player') {
        const k = String(skin || 'steve').toLowerCase();
        for (const model of ['wide', 'slim']) {
          for (const name of [k, 'steve', 'alex']) {
            const key = 'entity/player/' + model + '/' + name;
            if (E[key]) return E[key];
          }
        }
        return null;
      }
      const prefix = 'entity/' + type + '/';
      let best = null;
      for (const k in E) {
        if (k.indexOf(prefix) !== 0) continue;
        const tail = k.slice(prefix.length);
        if (tail === type) return E[k];
        if (/baby|armor|saddle|sheared|angry|glow|eyes/i.test(tail)) continue;
        if (!best || tail.length < best.n) best = { src: E[k], n: tail.length };
      }
      return best ? best.src : null;
    } catch (e) { return null; }
  }

  // 从 ENTITY_DATA 的 head 部件里找朝 -Z 那一面的 UV，精确裁出正脸
  function faceUV(type) {
    try {
      const L = W.ENTITY_DATA && W.ENTITY_DATA.layers;
      const layer = L && (L[type + '#main'] || L[type]);
      if (!layer) return null;
      let head = null;
      const walk = (o, d) => {
        if (!o || typeof o !== 'object' || d > 6) return;
        if (Array.isArray(o.head)) head = o.head;
        for (const k in o) {
          if (k === 'head') continue;
          const v = o[k];
          if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, d + 1);
        }
      };
      walk(layer, 0);
      const faces = head && head[7];
      if (!Array.isArray(faces)) return null;
      let f = null;
      for (const q of faces) if (q && q[2] < -0.5) { f = q; break; }
      if (!f) f = faces[0];
      let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
      for (let i = 3; i + 4 < f.length; i += 5) {
        const u = f[i + 3], v = f[i + 4];
        if (typeof u === 'number' && typeof v === 'number') {
          u0 = Math.min(u0, u); v0 = Math.min(v0, v);
          u1 = Math.max(u1, u); v1 = Math.max(v1, v);
        }
      }
      if (!isFinite(u0) || u1 <= u0 || v1 <= v0) return null;
      return { u0, v0, u1, v1 };
    } catch (e) { return null; }
  }

  function getFaceImg(type, skin) {
    const ck = type + ':' + (skin || '');
    if (faceImgs[ck]) return faceImgs[ck];
    const src = faceTexture(type, skin);
    if (!src) return null;
    try {
      const img = new Image();
      img.onload = () => { img.__ok = true; facePending = true; };
      img.onerror = () => { img.__bad = true; };
      img.__type = type;
      img.src = src;
      faceImgs[ck] = img;
      return img;
    } catch (e) { return null; }
  }

  function faceCrop(img) {
    if (img.__crop) return img.__crop;
    const iw = img.naturalWidth || img.width || 64;
    const ih = img.naturalHeight || img.height || 32;
    const uv = faceUV(img.__type) || { u0: 8 / iw, v0: 8 / ih, u1: 16 / iw, v1: 16 / ih };
    const sx = Math.max(0, Math.floor(uv.u0 * iw));
    const sy = Math.max(0, Math.floor(uv.v0 * ih));
    const sw = Math.max(1, Math.min(iw - sx, Math.ceil((uv.u1 - uv.u0) * iw)));
    const sh = Math.max(1, Math.min(ih - sy, Math.ceil((uv.v1 - uv.v0) * ih)));
    let ratio = 1;
    try {
      const pc = document.createElement('canvas');
      pc.width = iw; pc.height = ih;
      const cc = pc.getContext('2d');
      cc.drawImage(img, 0, 0);
      const d = cc.getImageData(sx, sy, sw, sh).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
      ratio = n / Math.max(1, sw * sh);
    } catch (err) { ratio = 1; }
    img.__crop = (ratio < 0.3 || sw < 3 || sh < 3)
      ? { sx: 0, sy: 0, sw: iw, sh: ih }
      : { sx, sy, sw, sh };
    return img.__crop;
  }

  function drawOfficialFace(c, type, S, e) {
    const style = getS('hud', 'faceStyle') || '自动正脸';
    if (style === '像素手绘') return false;
    let skin = null;
    try { skin = e && ((e.look && e.look.skin) || e.skinName || (e.type === 'player' ? e.name : null)); } catch (err) { /* noop */ }
    const img = getFaceImg(type, skin);
    if (!img) return false;
    if (!img.__ok) { if (!img.__bad) facePending = true; return false; }
    const iw = img.naturalWidth || img.width || 64;
    const ih = img.naturalHeight || img.height || 32;
    // head front 在原版贴图里几乎都在像素 (8,8)-(16,16)；按真实贴图高度换算 v，
    // 64x64 皮肤才不会裁到身体（之前写死 v=0.25~0.5 就是猪头像变棕黑条的原因）
    const crop = (getS('hud', 'faceStyle') === '整张贴图')
      ? { sx: 0, sy: 0, sw: iw, sh: ih } : faceCrop(img);
    c.imageSmoothingEnabled = false;
    c.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 2, 2, S - 4, S - 4);
    c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 2;
    rr(c, 1, 1, S - 2, S - 2, 8); c.stroke();
    return true;
  }

  // ---- 路径点 ----
  function addWaypoint(name, x, y, z, color) {
    if (!Array.isArray(cfg.waypoints)) cfg.waypoints = [];
    const wp = {
      id: 'w' + Date.now() + Math.floor(Math.random() * 1000),
      name: name || ('点 ' + (cfg.waypoints.length + 1)),
      x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, z: Math.round(z * 10) / 10,
      color: color || WP_COLORS[cfg.waypoints.length % WP_COLORS.length],
    };
    cfg.waypoints.push(wp);
    saveCfg();
    pushNotification('路径点', '已标记 ' + wp.name);
    refreshGui();
    return wp;
  }
  function markHere() {
    const p = state.player;
    if (!p) { pushNotification('路径点', '还没进入游戏'); return null; }
    const q = playerCenter(p, 1);
    return q ? addWaypoint(null, q[0], q[1], q[2]) : null;
  }
  function clearWaypoints() {
    cfg.waypoints = [];
    saveCfg();
    refreshGui();
    pushNotification('路径点', '已清空');
  }

  function drawWaypoints(r, p, W_, H_, alpha) {
    const list = cfg.waypoints;
    if (!Array.isArray(list) || !list.length) return;
    const c = playerCenter(p, alpha);
    if (!c) return;
    const maxD = Number(getS('waypoints', 'distance')) || 256;
    const beacon = getS('waypoints', 'beacon') !== false;
    const edge = getS('waypoints', 'edge') !== false;
    const ctx = ectx;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const w of list) {
      const dx = w.x - c[0], dz = w.z - c[2];
      const dist = Math.hypot(dx, dz);
      if (dist > maxD) continue;
      const base = project(r, w.x, w.y + 0.05, w.z, W_, H_);
      const top = project(r, w.x, w.y + Math.min(24, 4 + dist * 0.12), w.z, W_, H_);
      const inView = base && top && base.x >= 0 && base.x <= W_ && base.y >= 0 && base.y <= H_;
      if (inView && beacon) {
        const gr = ctx.createLinearGradient(0, top.y, 0, base.y);
        gr.addColorStop(0, hexToRgba(w.color, 0));
        gr.addColorStop(1, hexToRgba(w.color, 0.6));
        ctx.strokeStyle = gr; ctx.lineWidth = Math.max(2, W_ / 420);
        ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.stroke();
        const s = Math.max(4, Math.min(11, 900 / (dist + 8)));
        ctx.fillStyle = hexToRgba(w.color, 0.92);
        ctx.shadowColor = w.color; ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(top.x, top.y - s); ctx.lineTo(top.x + s, top.y);
        ctx.lineTo(top.x, top.y + s); ctx.lineTo(top.x - s, top.y);
        ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        const label = w.name + '  ' + Math.round(dist) + 'm';
        ctx.font = '700 12px "Microsoft YaHei", sans-serif';
        const tw = (ctx.measureText(label).width || 80) + 12;
        ctx.fillStyle = 'rgba(0,0,0,.72)';
        ctx.fillRect(top.x - tw / 2, top.y - s - 21, tw, 17);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, top.x, top.y - s - 12);
      } else if (edge) {
        const ep = edgePoint(dx, dz, p, W_, H_);
        const px = ep.x, py = ep.y;
        ctx.fillStyle = hexToRgba(w.color, 0.92);
        ctx.shadowColor = w.color; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.font = '700 10px "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(String(Math.round(dist)) + 'm', px, py - 12);
      }
    }
    ctx.restore();
  }

  // ---- Xaero 式圆形小地图 ----
  const miniCanvas = document.createElement('canvas');
  miniCanvas.id = '__comet_minimap';
  miniCanvas.width = 360; miniCanvas.height = 360;
  const mctx = miniCanvas.getContext('2d');
  const terrainCv = document.createElement('canvas');
  terrainCv.width = 64; terrainCv.height = 64;
  const tctx = terrainCv.getContext('2d');
  let terrainAt = 0, terrainKey = '';

  function blockRGB(id) {
    if (!id) return null;
    let key = '';
    try { const d = W.BLOCK_DATA && W.BLOCK_DATA[id]; key = String((d && (d.key || d.cn)) || '').toLowerCase(); } catch (e) { /* noop */ }
    if (/water|水/.test(key)) return [58, 123, 213];
    if (/grass|草|dirt|泥/.test(key)) return [95, 154, 69];
    if (/sand|沙/.test(key)) return [217, 199, 131];
    if (/snow|雪|ice|冰/.test(key)) return [232, 242, 247];
    if (/stone|石|cobble|deepslate|tuff|andesite/.test(key)) return [139, 139, 139];
    if (/log|木|plank|leaves|叶|oak|birch|spruce/.test(key)) return [107, 143, 74];
    const h = (id * 37) % 60;
    return [90 + h, 100 + h, 90 + h];
  }

  function refreshTerrain(g, px, pz, radius, py) {
    const w = g && g.world;
    if (!w || typeof w.getBlock !== 'function') return;
    const key = Math.floor(px / 2) + ':' + Math.floor(pz / 2) + ':' + radius + ':' + Math.floor(py);
    if (key === terrainKey && performance.now() - terrainAt < 700) return;
    terrainKey = key; terrainAt = performance.now();
    let img;
    try { img = tctx.createImageData(64, 64); } catch (e) { return; }
    if (!img || !img.data) return;
    const step = (radius * 2) / 64;
    for (let j = 0; j < 64; j++) {
      for (let i = 0; i < 64; i++) {
        const wx = Math.floor(px - radius + i * step);
        const wz = Math.floor(pz - radius + j * step);
        let rgb = null;
        for (let dy = 4; dy >= -5; dy--) {
          let id = 0;
          try { id = w.getBlock(wx, py + dy, wz); } catch (e) { break; }
          if (id) { rgb = blockRGB(id); break; }
        }
        const o = (j * 64 + i) * 4;
        if (rgb) {
          img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 235;
        } else img.data[o + 3] = 0;
      }
    }
    try { tctx.putImageData(img, 0, 0); } catch (e) { /* noop */ }
  }

  function drawMinimap() {
    const on = modOn('minimap') || state.editHud;
    miniCanvas.style.display = on ? '' : 'none';
    miniCanvas.classList.toggle('edit', !!state.editHud);
    applyPanelPos(miniCanvas, 'minmapPos', 'right', 'top', 16, 16);
    if (state.editHud) miniCanvas.style.pointerEvents = 'auto';
    if (!on) return;
    const size = Math.max(120, Math.min(320, Number(getS('minimap', 'size')) || 180));
    miniCanvas.style.width = size + 'px';
    miniCanvas.style.height = size + 'px';
    const S = miniCanvas.width, cx = S / 2, cy = S / 2, rad = S / 2 - 6;
    const R = Math.max(16, Number(getS('minimap', 'zoom')) || 48);
    const ctx = mctx;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(10,14,22,.72)'; ctx.fillRect(0, 0, S, S);

    const g = state.game, p = state.player;
    const c = (g && p && (!g.state || g.state === 'play')) ? playerCenter(p, 1) : null;
    if (c) {
      if (getS('minimap', 'terrain') !== false) {
        refreshTerrain(g, c[0], c[2], R, Math.floor(c[1]));
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.88;
        ctx.drawImage(terrainCv, cx - rad, cy - rad, rad * 2, rad * 2);
        ctx.globalAlpha = 1;
      }
      // 距离圈
      ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1;
      for (const k of [0.33, 0.66, 1]) { ctx.beginPath(); ctx.arc(cx, cy, rad * k, 0, Math.PI * 2); ctx.stroke(); }
      // 实体点
      if (getS('minimap', 'entities') !== false && Array.isArray(g.entities)) {
        for (const e of g.entities) {
          try {
            if (!e || e === p || e.dead) continue;
            const q = (typeof e.ipos === 'function') ? e.ipos(1) : (Array.isArray(e.pos) ? e.pos : null);
            if (!q) continue;
            const sx = cx + (q[0] - c[0]) / R * rad, sy = cy + (q[2] - c[2]) / R * rad;
            if (Math.hypot(sx - cx, sy - cy) > rad) continue;
            const mob = e.health != null && e.maxHealth != null;
            ctx.fillStyle = mob ? (e.T && e.T.hostile ? '#ff5252' : '#4fc3f7') : '#ffd54f';
            ctx.beginPath(); ctx.arc(sx, sy, mob ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill();
          } catch (err) { /* noop */ }
        }
      }
      // 路径点
      const labels = getS('minimap', 'labels') !== false;
      for (const w of (cfg.waypoints || [])) {
        const sx = cx + (w.x - c[0]) / R * rad, sy = cy + (w.z - c[2]) / R * rad;
        if (Math.hypot(sx - cx, sy - cy) > rad - 3) continue;
        ctx.fillStyle = w.color;
        ctx.shadowColor = w.color; ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 5); ctx.lineTo(sx + 5, sy); ctx.lineTo(sx, sy + 5); ctx.lineTo(sx - 5, sy);
        ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        if (labels) {
          ctx.font = '700 11px "Microsoft YaHei", sans-serif';
          ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
          ctx.fillText(w.name, sx, sy - 9);
        }
      }
      // 玩家箭头（按 yaw 转）
      const yaw = num(p, 'yaw', 'rotationY') || 0;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-yaw);
      ctx.fillStyle = '#ffffff'; ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 4); ctx.lineTo(-6, 7);
      ctx.closePath(); ctx.fill(); ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '700 20px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center'; ctx.fillText('等待进入世界', cx, cy);
    }
    ctx.restore();
    // 外圈 + 方位 + 坐标
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
    ctx.font = '700 14px "Microsoft YaHei", sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillText('N', cx, 16); ctx.fillText('S', cx, S - 6);
    ctx.fillText('W', 12, cy + 5); ctx.fillText('E', S - 12, cy + 5);
    if (c) {
      ctx.font = '700 12px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.fillText(Math.floor(c[0]) + ' / ' + Math.floor(c[2]), cx, S - 22);
    }
  }

  // HUD 编辑模式下可拖动小地图（平时 pointer-events:none，不挡游戏操作）
  let mmDrag = null;
  miniCanvas.addEventListener('mousedown', (ev) => {
    if (!state.editHud || ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    const p0 = cfg.minmapPos || { x: 16, y: 16 };
    mmDrag = { x: ev.clientX, y: ev.clientY, px: p0.x, py: p0.y };
    const move = (e2) => {
      if (!mmDrag) return;
      cfg.minmapPos = {
        x: Math.max(0, mmDrag.px + (mmDrag.x - e2.clientX)),
        y: Math.max(0, mmDrag.py + (e2.clientY - mmDrag.y)),
      };
      drawMinimap();
    };
    const up = () => {
      mmDrag = null;
      W.removeEventListener('mousemove', move);
      W.removeEventListener('mouseup', up);
      saveCfg();
    };
    W.addEventListener('mousemove', move);
    W.addEventListener('mouseup', up);
  });

  // ---- 背包 HUD ----
  const invBox = document.createElement('div');
  invBox.id = '__comet_inv';
  makeDraggable(invBox, 'invPos', 'left', 'bottom', 16, 16);
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function updateInventory() {
    const on = modOn('invhud') || state.editHud;
    invBox.style.display = on ? '' : 'none';
    applyPanelPos(invBox, 'invPos', 'left', 'bottom', 16, 16);
    invBox.style.setProperty('--cm-inv-scale', String(Math.max(0.8, Math.min(1.6,
      Number(getS('invhud', 'scale')) || 1))));
    invBox.classList.toggle('glass', cfg.theme === 'glass');
    if (!on) return;
    const p = state.player, inv = p && p.inv;
    if (!inv || !Array.isArray(inv.slots)) {
      invBox.innerHTML = '<div class="cm-ivtitle">背包 · 等待进入世界</div>';
      return;
    }
    const full = getS('invhud', 'full') !== false;
    const names = getS('invhud', 'names') !== false;
    const n = full ? 36 : 9;
    let html = '<div class="cm-ivtitle">背包' + (full ? ' · 36 格' : ' · 快捷栏') + '</div><div class="cm-ivgrid">';
    for (let i = 0; i < n; i++) {
      const s = inv.slots[i];
      const sel = i === (inv.sel | 0);
      const cls = 'cm-ivslot' + (sel ? ' sel' : '') + (s ? ' has cm-ivc' + (Math.abs(Number(s.id) || 0) % 8) : '');
      let inner = '';
      if (s) {
        const nm = itemName(s.id) || ('#' + s.id);
        if (names) inner += '<span class="cm-ivn">' + escHtml(nm) + '</span>';
        if (Number(s.count) > 1) inner += '<span class="cm-ivq">' + Number(s.count) + '</span>';
      }
      html += '<div class="' + cls + '">' + inner + '</div>';
    }
    html += '</div>';
    if (invBox.__last !== html) { invBox.innerHTML = html; invBox.__last = html; }
  }

  // ==========================================================================
  // v1.17.0 扩展模块包
  // 全部自包含：模块注册表 + 数据表 + tick / render / hud 三组函数。
  // 只从 window.game / player 读数据，不改游戏源码，不写世界方块。
  // ==========================================================================

  const EXT_MODULES = [
    {
      id: 'autotool', name: 'AutoTool', cn: '自动工具', cat: 'player',
      desc: '开始挖掘时自动切到对这块方块最快的工具',
      settings: [
        { id: 'silent', name: 'Silent', cn: '不提示', type: 'checkbox', value: true },
        { id: 'restore', name: 'Restore', cn: '挖完切回', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'autoarmor', name: 'AutoArmor', cn: '自动装备', cat: 'player',
      desc: '自动把背包里防御最高的盔甲穿到盔甲栏',
      settings: [
        { id: 'delay', name: 'Delay', cn: '检查间隔', type: 'slider', min: 1, max: 20, step: 1, value: 5 },
      ],
    },
    {
      id: 'deathpoint', name: 'DeathPoint', cn: '死亡点', cat: 'misc',
      desc: '死亡时自动在死亡坐标打一个路径点',
      settings: [
        { id: 'name', name: 'Name', cn: '名称前缀', type: 'text', value: '死亡点' },
        { id: 'color', name: 'Color', cn: '颜色', type: 'color', value: '', desc: '留空 = 红色' },
      ],
    },
    {
      id: 'coordlog', name: 'CoordLog', cn: '坐标记录', cat: 'misc',
      desc: '一键记下当前坐标，可复制 / 清空；存进配置备份',
      settings: [
        { id: 'add', name: 'Add', cn: '记录当前坐标', type: 'button' },
        { id: 'clear', name: 'Clear', cn: '清空记录', type: 'button' },
        { id: 'max', name: 'Max', cn: '最多保留', type: 'slider', min: 5, max: 100, step: 5, value: 30 },
      ],
    },
    {
      id: 'sessionstats', name: 'SessionStats', cn: '本次统计', cat: 'misc',
      desc: '游玩时长 / 行走距离 / 挖掘数 / 最高最低 FPS',
      settings: [
        { id: 'show', name: 'Show HUD', cn: '显示面板', type: 'checkbox', value: true },
        { id: 'reset', name: 'Reset', cn: '重置统计', type: 'button' },
      ],
    },
    {
      id: 'combatlog', name: 'CombatLog', cn: '战斗日志', cat: 'misc',
      desc: '记录最近的受伤 / 击杀 / 死亡事件',
      settings: [
        { id: 'max', name: 'Max', cn: '保留条数', type: 'slider', min: 3, max: 20, step: 1, value: 8 },
        { id: 'clear', name: 'Clear', cn: '清空日志', type: 'button' },
      ],
    },
    {
      id: 'profile', name: 'Profiles', cn: '配置档', cat: 'configs',
      desc: '把当前模块开关存成档位，随时一键切回来',
      settings: [
        { id: 'slot', name: 'Slot', cn: '档位', type: 'select', value: '档位 1',
          options: ['档位 1', '档位 2', '档位 3'] },
        { id: 'save', name: 'Save', cn: '保存当前到该档', type: 'button' },
        { id: 'load', name: 'Load', cn: '载入该档', type: 'button' },
      ],
    },
    {
      id: 'macro', name: 'Macros', cn: '聊天宏', cat: 'configs',
      desc: '几条自定义文本，点一下即发送（联机时走聊天，单机只提示）',
      settings: [
        { id: 'm1', name: 'Macro 1', cn: '宏 1', type: 'text', value: '/help' },
        { id: 'm2', name: 'Macro 2', cn: '宏 2', type: 'text', value: '大家好' },
        { id: 'm3', name: 'Macro 3', cn: '宏 3', type: 'text', value: '' },
        { id: 'run1', name: 'Send 1', cn: '发送宏 1', type: 'button' },
        { id: 'run2', name: 'Send 2', cn: '发送宏 2', type: 'button' },
        { id: 'run3', name: 'Send 3', cn: '发送宏 3', type: 'button' },
      ],
    },
    {
      id: 'chunkinfo', name: 'ChunkInfo', cn: '区块信息', cat: 'misc',
      desc: '当前区块坐标 / 区内坐标 / 亮度 / 维度',
      settings: [
        { id: 'show', name: 'Show HUD', cn: '显示面板', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'blockinfo', name: 'BlockInfo', cn: '准星方块信息', cat: 'misc',
      desc: '显示准星指向方块的名字 / 坐标 / 硬度 / 建议工具',
      settings: [
        { id: 'show', name: 'Show HUD', cn: '显示面板', type: 'checkbox', value: true },
        { id: 'dist', name: 'Distance', cn: '显示距离', type: 'checkbox', value: true },
      ],
    },
  ];

  for (const em of EXT_MODULES) {
    MODULES.push(em);
    MODS_BY_ID[em.id] = em;
    if (cfg.states[em.id] === undefined) cfg.states[em.id] = !!em.state;
  }

  // ---- 数据表：工具效率 / 盔甲 / 方块 / 药水 / 群系 ----
  const TOOL_KIND = {
    pickaxe: 'pickaxe', axe: 'axe', shovel: 'shovel', sword: 'sword', hoe: 'hoe', shears: 'shears',
  };
  const TOOL_MATERIAL = {
    wooden: 1, stone: 2, iron: 3, golden: 4, diamond: 5, netherite: 6,
    wood: 1, gold: 4,
  };
  const ARMOR_SLOT = { helmet: 36, chestplate: 37, leggings: 38, boots: 39 };
  const ARMOR_MATERIAL = {
    leather: 1, chainmail: 2, iron: 3, golden: 4, gold: 4, diamond: 5, netherite: 6, turtle: 3,
  };
  const BLOCK_HINT = {
    stone: { cn: '石头', tool: 'pickaxe', hard: 1.5 },
    cobblestone: { cn: '圆石', tool: 'pickaxe', hard: 2 },
    dirt: { cn: '泥土', tool: 'shovel', hard: 0.5 },
    grass_block: { cn: '草方块', tool: 'shovel', hard: 0.6 },
    sand: { cn: '沙子', tool: 'shovel', hard: 0.5 },
    gravel: { cn: '砂砾', tool: 'shovel', hard: 0.6 },
    clay: { cn: '黏土', tool: 'shovel', hard: 0.6 },
    snow: { cn: '雪', tool: 'shovel', hard: 0.2 },
    oak_log: { cn: '橡木原木', tool: 'axe', hard: 2 },
    birch_log: { cn: '桦木原木', tool: 'axe', hard: 2 },
    spruce_log: { cn: '云杉原木', tool: 'axe', hard: 2 },
    jungle_log: { cn: '丛林木原木', tool: 'axe', hard: 2 },
    acacia_log: { cn: '金合欢原木', tool: 'axe', hard: 2 },
    dark_oak_log: { cn: '深色橡木原木', tool: 'axe', hard: 2 },
    oak_planks: { cn: '橡木木板', tool: 'axe', hard: 2 },
    coal_ore: { cn: '煤矿石', tool: 'pickaxe', hard: 3 },
    iron_ore: { cn: '铁矿石', tool: 'pickaxe', hard: 3 },
    gold_ore: { cn: '金矿石', tool: 'pickaxe', hard: 3 },
    diamond_ore: { cn: '钻石矿石', tool: 'pickaxe', hard: 3 },
    emerald_ore: { cn: '绿宝石矿石', tool: 'pickaxe', hard: 3 },
    redstone_ore: { cn: '红石矿石', tool: 'pickaxe', hard: 3 },
    lapis_ore: { cn: '青金石矿石', tool: 'pickaxe', hard: 3 },
    nether_quartz_ore: { cn: '下界石英矿石', tool: 'pickaxe', hard: 3 },
    ancient_debris: { cn: '远古残骸', tool: 'pickaxe', hard: 30 },
    obsidian: { cn: '黑曜石', tool: 'pickaxe', hard: 50 },
    netherrack: { cn: '下界岩', tool: 'pickaxe', hard: 0.4 },
    end_stone: { cn: '末地石', tool: 'pickaxe', hard: 3 },
    cobweb: { cn: '蜘蛛网', tool: 'sword', hard: 4 },
    leaves: { cn: '树叶', tool: 'shears', hard: 0.2 },
    oak_leaves: { cn: '橡树树叶', tool: 'shears', hard: 0.2 },
    wool: { cn: '羊毛', tool: 'shears', hard: 0.8 },
    melon: { cn: '西瓜', tool: 'axe', hard: 1 },
    pumpkin: { cn: '南瓜', tool: 'axe', hard: 1 },
    bookshelf: { cn: '书架', tool: 'axe', hard: 1.5 },
    chest: { cn: '箱子', tool: 'axe', hard: 2.5 },
    crafting_table: { cn: '工作台', tool: 'axe', hard: 2.5 },
    furnace: { cn: '熔炉', tool: 'pickaxe', hard: 3.5 },
    anvil: { cn: '铁砧', tool: 'pickaxe', hard: 5 },
    iron_block: { cn: '铁块', tool: 'pickaxe', hard: 5 },
    gold_block: { cn: '金块', tool: 'pickaxe', hard: 3 },
    diamond_block: { cn: '钻石块', tool: 'pickaxe', hard: 5 },
    glass: { cn: '玻璃', tool: 'none', hard: 0.3 },
    bedrock: { cn: '基岩', tool: 'none', hard: -1 },
    water: { cn: '水', tool: 'none', hard: -1 },
    lava: { cn: '岩浆', tool: 'none', hard: -1 },
    air: { cn: '空气', tool: 'none', hard: 0 },
  };
  const POTION_CN = {
    speed: '速度', slowness: '缓慢', haste: '急迫', mining_fatigue: '挖掘疲劳',
    strength: '力量', instant_health: '瞬间治疗', instant_damage: '瞬间伤害',
    jump_boost: '跳跃提升', nausea: '反胃', regeneration: '生命恢复',
    resistance: '抗性提升', fire_resistance: '防火', water_breathing: '水下呼吸',
    invisibility: '隐身', blindness: '失明', night_vision: '夜视',
    hunger: '饥饿', weakness: '虚弱', poison: '中毒', wither: '凋零',
    health_boost: '生命提升', absorption: '伤害吸收', saturation: '饱和',
    glowing: '发光', levitation: '飘浮', luck: '幸运', unluck: '霉运',
    slow_falling: '缓降', conduit_power: '潮涌能量', dolphins_grace: '海豚的恩惠',
    bad_omen: '不祥之兆', hero_of_the_village: '村庄英雄',
  };
  const BIOME_CN = {
    plains: '平原', forest: '森林', birch_forest: '桦木森林', desert: '沙漠',
    taiga: '针叶林', savanna: '热带草原', jungle: '丛林', swamp: '沼泽',
    mountains: '山地', ocean: '海洋', river: '河流', beach: '沙滩',
    badlands: '恶地', mushroom_fields: '蘑菇岛', nether: '下界', the_end: '末地',
    snowy_tundra: '雪原', ice_spikes: '冰刺之地', dark_forest: '黑森林',
    sunflower_plains: '向日葵平原', flower_forest: '繁花森林',
  };
  const EXT_TIPS = [
    '自动工具会读取手持物品定义，物品表缺失时自动跳过，不会乱切。',
    '自动装备只在背包里找盔甲，不会丢东西，也不会动快捷栏。',
    '死亡点依赖游戏里 deathTime / dead 字段，重生后自动打点。',
    '坐标记录存在本地配置里，导出 .opuscfg 备份会一起带走。',
    '本次统计从脚本加载时开始累计，重置按钮可随时清零。',
    '战斗日志只记录本地能观察到的血量变化，不读取服务端数据。',
    '配置档保存的是模块开关与设置快照，不影响路径点等世界数据。',
    '聊天宏在联机时走游戏聊天，单机只做提示，不会伪造封包。',
    '区块信息显示区块坐标与区内偏移，方便配合区块边界模块。',
    '准星方块信息会回退到方块数据表，查不到时显示数字 id。',
  ];

  // ---- 扩展状态 ----
  const ext = {
    lastPos: null, distance: 0, startedAt: performance.now(), mined: 0, kills: 0,
    fpsMin: Infinity, fpsMax: 0, lastHp: null, lastDead: false,
    events: [], lastArmorAt: 0, lastTargetId: null, lastBreaking: null,
    toolRestore: null, hitAt: 0, damagePops: [], fpsHist: [], lastFpsAt: 0,
    zoomHeld: false, lastChat: '', lastBiome: '', lastBlockId: null,
  };
  function extEnsure() {
    if (!cfg.ext) cfg.ext = {};
    if (!Array.isArray(cfg.ext.coords)) cfg.ext.coords = [];
    if (!cfg.ext.profiles || typeof cfg.ext.profiles !== 'object') cfg.ext.profiles = {};
    if (!Array.isArray(cfg.ext.macros)) cfg.ext.macros = [];
    return cfg.ext;
  }
  function extVal(key, def) {
    const s = getS(key.split('.')[0], key.split('.')[1]);
    return s === undefined ? def : s;
  }
  function extOn(id) { return modOn(id); }
  function extLog(text, kind) {
    ext.events.unshift({ t: performance.now(), text: String(text), kind: kind || 'info' });
    const max = Math.max(3, Number(extVal('combatlog.max', 8)) || 8);
    if (ext.events.length > max) ext.events.length = max;
  }
  function extItemDef(id) {
    try {
      const d = (typeof W.itemDef === 'function') ? W.itemDef(id) : (W.ITEMS && W.ITEMS[id]);
      return d || null;
    } catch (e) { return null; }
  }
  function extItemKey(id) {
    const d = extItemDef(id);
    return d ? String(d.key || d.name || '') : '';
  }
  function extToolPower(key) {
    const parts = String(key || '').split('_');
    const mat = parts[0];
    const kind = parts[parts.length - 1];
    if (!TOOL_MATERIAL[mat] || !TOOL_KIND[kind]) return 0;
    return TOOL_MATERIAL[mat] * 10 + (kind === 'pickaxe' ? 5 : 0);
  }
  function extBestTool(wantKind, slots) {
    let bestSlot = -1, bestPower = 0;
    for (let i = 0; i < 9 && i < slots.length; i++) {
      const s = slots[i];
      if (!s || s.id == null) continue;
      const key = extItemKey(s.id);
      const parts = String(key).split('_');
      const kind = parts[parts.length - 1];
      if (wantKind === 'none') continue;
      if (kind !== wantKind) continue;
      const power = extToolPower(key);
      if (power > bestPower) { bestPower = power; bestSlot = i; }
    }
    return bestSlot;
  }
  function extBlockHint(id) {
    try {
      const d = (W.BLOCK_DATA && W.BLOCK_DATA[id]) || null;
      const key = d && (d.key || '');
      return BLOCK_HINT[key] || (d && d.cn ? { cn: String(d.cn), tool: 'pickaxe', hard: Number(d.hardness) || 1 } : null);
    } catch (e) { return null; }
  }

  // ---- 模块 1：自动工具 ----
  function extAutoTool(g, p) {
    if (!extOn('autotool')) return;
    try {
      const slots = p.inv && p.inv.slots;
      if (!Array.isArray(slots)) return;
      let bp = null;
      try {
        if (g.target && Array.isArray(g.target.pos)) bp = g.target.pos;
        else if (g.breaking && Array.isArray(g.breaking.pos)) bp = g.breaking.pos;
      } catch (e) { bp = null; }
      if (!bp) {
        if (ext.toolRestore != null && extVal('autotool.restore', true)) {
          p.inv.sel = ext.toolRestore;
          ext.toolRestore = null;
        }
        return;
      }
      const w = g.world;
      if (!w || typeof w.getBlock !== 'function') return;
      const id = w.getBlock(Math.floor(bp[0]), Math.floor(bp[1]), Math.floor(bp[2]));
      const hint = extBlockHint(id);
      if (!hint || hint.tool === 'none') return;
      const slot = extBestTool(hint.tool, slots);
      if (slot < 0 || slot === p.inv.sel) return;
      if (ext.toolRestore == null) ext.toolRestore = p.inv.sel;
      p.inv.sel = slot;
      if (!extVal('autotool.silent', true)) pushNotification('自动工具', '已切换到 ' + hint.tool);
    } catch (e) { /* noop */ }
  }

  // ---- 模块 2：自动装备 ----
  function extAutoArmor(g, p) {
    if (!extOn('autoarmor')) return;
    const every = Math.max(1, Number(extVal('autoarmor.delay', 5)) || 5) * 200;
    const now = performance.now();
    if (now - ext.lastArmorAt < every) return;
    ext.lastArmorAt = now;
    try {
      const slots = p.inv && p.inv.slots;
      if (!Array.isArray(slots)) return;
      for (const armorName of Object.keys(ARMOR_SLOT)) {
        const target = ARMOR_SLOT[armorName];
        let bestIdx = -1, bestScore = -1;
        for (let i = 0; i < 36 && i < slots.length; i++) {
          const s = slots[i];
          if (!s || s.id == null) continue;
          const key = extItemKey(s.id);
          if (key.indexOf(armorName) < 0) continue;
          let score = 1;
          for (const mat of Object.keys(ARMOR_MATERIAL)) {
            if (key.indexOf(mat) >= 0) score = Math.max(score, ARMOR_MATERIAL[mat]);
          }
          if (score > bestScore) { bestScore = score; bestIdx = i; }
        }
        const cur = slots[target];
        let curScore = 0;
        if (cur && cur.id != null) {
          const ck = extItemKey(cur.id);
          for (const mat of Object.keys(ARMOR_MATERIAL)) {
            if (ck.indexOf(mat) >= 0) curScore = Math.max(curScore, ARMOR_MATERIAL[mat]);
          }
        }
        if (bestIdx >= 0 && bestScore > curScore) {
          const picked = slots[bestIdx];
          slots[bestIdx] = cur || null;
          slots[target] = picked;
          extLog('自动装备：' + (picked && extItemKey(picked.id) || armorName), 'gear');
        }
      }
    } catch (e) { /* noop */ }
  }

  // ---- 模块 3：死亡点 ----
  function extDeathPoint(g, p) {
    if (!extOn('deathpoint')) return;
    const dead = (typeof p.deathTime === 'number' && p.deathTime > 0) || !!p.dead;
    if (dead && !ext.lastDead) {
      try {
        const q = playerCenter(p, 1);
        if (q) {
          const prefix = String(extVal('deathpoint.name', '死亡点') || '死亡点');
          const color = String(extVal('deathpoint.color', '') || '').trim() || '#ff5f6d';
          const name = prefix + ' ' + (Array.isArray(cfg.waypoints) ? cfg.waypoints.length + 1 : 1);
          addWaypoint(name, q[0], q[1], q[2], color);
          extLog('死亡点已记录：' + Math.round(q[0]) + ' / ' + Math.round(q[2]), 'death');
        }
      } catch (e) { /* noop */ }
    }
    ext.lastDead = dead;
  }

  // ---- 模块 4：坐标记录 ----
  function extAddCoord() {
    try {
      const p = state.player;
      const q = p && playerCenter(p, 1);
      if (!q) { pushNotification('坐标记录', '还没进入世界'); return; }
      const e = extEnsure();
      const now = new Date();
      const stamp = String(now.getHours()).padStart(2, '0') + ':'
        + String(now.getMinutes()).padStart(2, '0');
      e.coords.unshift({
        x: Math.round(q[0] * 10) / 10, y: Math.round(q[1] * 10) / 10,
        z: Math.round(q[2] * 10) / 10, at: stamp,
        name: '坐标 ' + (e.coords.length + 1),
      });
      const max = Math.max(5, Number(extVal('coordlog.max', 30)) || 30);
      if (e.coords.length > max) e.coords.length = max;
      saveCfg();
      extLog('记录坐标 ' + Math.round(q[0]) + ' / ' + Math.round(q[2]), 'coord');
      pushNotification('坐标记录', '已记录 ' + e.coords.length + ' 个坐标');
      extHud();
    } catch (e) { pushNotification('坐标记录', '记录失败'); }
  }
  function extClearCoords() {
    extEnsure().coords = [];
    saveCfg();
    extHud();
    pushNotification('坐标记录', '已清空');
  }
  function extCopyCoords() {
    const list = extEnsure().coords || [];
    const txt = list.map((c) => c.name + ' ' + c.x + ' / ' + c.y + ' / ' + c.z).join('\n');
    try { navigator.clipboard.writeText(txt); pushNotification('坐标记录', '已复制 ' + list.length + ' 条'); }
    catch (e) { pushNotification('坐标记录', txt.slice(0, 60)); }
  }

  // ---- 模块 5：本次统计 ----
  function extStats(g, p) {
    try {
      const q = playerCenter(p, 1);
      if (q) {
        if (ext.lastPos) {
          const d = Math.hypot(q[0] - ext.lastPos[0], q[1] - ext.lastPos[1], q[2] - ext.lastPos[2]);
          if (d < 20) ext.distance += d;
        }
        ext.lastPos = [q[0], q[1], q[2]];
      }
      const fps = num(g, 'fps');
      if (typeof fps === 'number' && fps > 0) {
        ext.fpsMin = Math.min(ext.fpsMin, fps);
        ext.fpsMax = Math.max(ext.fpsMax, fps);
        const now = performance.now();
        if (now - ext.lastFpsAt > 500) {
          ext.lastFpsAt = now;
          ext.fpsHist.push(Math.round(fps));
          if (ext.fpsHist.length > 60) ext.fpsHist.shift();
        }
      }
      const br = g.breaking;
      const brKey = br && Array.isArray(br.pos) ? br.pos.join(',') : null;
      if (ext.lastBreaking && brKey !== ext.lastBreaking) ext.mined++;
      ext.lastBreaking = brKey;
    } catch (e) { /* noop */ }
  }
  function extResetStats() {
    ext.distance = 0; ext.mined = 0; ext.kills = 0;
    ext.fpsMin = Infinity; ext.fpsMax = 0; ext.fpsHist = [];
    ext.startedAt = performance.now();
    extLog('统计已重置', 'info');
    extHud();
    pushNotification('本次统计', '已重置');
  }
  function extDuration() {
    const s = Math.floor((performance.now() - ext.startedAt) / 1000);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  // ---- 模块 6：战斗日志 ----
  function extCombat(g, p) {
    if (!extOn('combatlog')) return;
    try {
      const hp = num(p, 'health');
      if (typeof hp === 'number') {
        if (ext.lastHp != null && hp < ext.lastHp) {
          extLog('受到伤害 -' + (ext.lastHp - hp).toFixed(1) + ' HP', 'hurt');
        } else if (ext.lastHp != null && hp > ext.lastHp) {
          extLog('恢复 +' + (hp - ext.lastHp).toFixed(1) + ' HP', 'heal');
        }
        ext.lastHp = hp;
      }
      const ents = g.entities;
      if (Array.isArray(ents)) {
        for (const e of ents) {
          if (!e || e.dead) continue;
          const key = e.constructor && e.constructor.name;
          if (e.__cometWasAlive && e.dead) ext.kills++;
          e.__cometWasAlive = !e.dead;
        }
      }
    } catch (e) { /* noop */ }
  }

  // ---- 模块 7：配置档 ----
  function extSaveProfile() {
    const slot = String(extVal('profile.slot', '档位 1') || '档位 1');
    const e = extEnsure();
    e.profiles[slot] = {
      states: JSON.parse(JSON.stringify(cfg.states)),
      settings: JSON.parse(JSON.stringify(cfg.settings)),
      savedAt: new Date().toISOString(),
    };
    saveCfg();
    extLog('保存配置档：' + slot, 'profile');
    pushNotification('配置档', '已保存 ' + slot);
  }
  function extLoadProfile() {
    const slot = String(extVal('profile.slot', '档位 1') || '档位 1');
    const p = extEnsure().profiles[slot];
    if (!p) { pushNotification('配置档', slot + ' 还没有存档'); return; }
    try {
      if (p.states) cfg.states = JSON.parse(JSON.stringify(p.states));
      if (p.settings) cfg.settings = JSON.parse(JSON.stringify(p.settings));
      __sCache = null;
      saveCfg();
      applyAppearance();
      refreshGui();
      refreshHud();
      extLog('载入配置档：' + slot, 'profile');
      pushNotification('配置档', '已载入 ' + slot);
    } catch (e) { pushNotification('配置档', '载入失败'); }
  }

  // ---- 模块 8：聊天宏 ----
  function extRunMacro(n) {
    const txt = String(extVal('macro.m' + n, '') || '').trim();
    if (!txt) { pushNotification('聊天宏', '宏 ' + n + ' 是空的'); return; }
    ext.lastChat = txt;
    try {
      const g = state.game;
      let sent = false;
      if (g && g.net && typeof g.net.send === 'function') {
        g.net.send({ t: 'chat', text: txt });
        sent = true;
      } else if (g && typeof g.chat === 'function') {
        g.chat(txt);
        sent = true;
      } else if (g && g.ui && typeof g.ui.addChat === 'function') {
        g.ui.addChat(txt);
        sent = true;
      }
      extLog('宏 ' + n + '：' + txt, 'macro');
      pushNotification('聊天宏', sent ? '已发送：' + txt : '单机记录：' + txt);
    } catch (e) { pushNotification('聊天宏', '发送失败'); }
  }

  // ---- 模块 9/10：区块 / 方块信息 ----
  function extChunkData(g, p) {
    try {
      const q = playerCenter(p, 1);
      if (!q) return null;
      const cx = Math.floor(q[0] / 16), cz = Math.floor(q[2] / 16);
      let light = null, biome = null;
      try {
        const w = g.world;
        if (w && typeof w.getLight === 'function') light = w.getLight(Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2]));
      } catch (e) { /* noop */ }
      try {
        const ch = g.world && g.world.chunks && g.world.chunks.get &&
          g.world.chunks.get((cx + 32768) * 65536 + (cz + 32768));
        if (ch && ch.biome) biome = ch.biome[((Math.floor(q[2]) & 15) << 4) | (Math.floor(q[0]) & 15)];
      } catch (e) { /* noop */ }
      return {
        cx, cz, ox: Math.floor(q[0]) - cx * 16, oz: Math.floor(q[2]) - cz * 16,
        y: Math.floor(q[1]), light, biome,
        dim: (String(g.world && g.world.dim || '') || 'overworld'),
      };
    } catch (e) { return null; }
  }
  function extTargetBlock(g) {
    try {
      const t = g.target;
      if (!t || !Array.isArray(t.pos)) return null;
      const w = g.world;
      const id = w && typeof w.getBlock === 'function'
        ? w.getBlock(Math.floor(t.pos[0]), Math.floor(t.pos[1]), Math.floor(t.pos[2])) : null;
      const hint = extBlockHint(id);
      const d = (W.BLOCK_DATA && W.BLOCK_DATA[id]) || null;
      return {
        id, pos: t.pos, hint,
        name: (hint && hint.cn) || (d && (d.cn || d.key)) || (id != null ? '#' + id : '未知'),
      };
    } catch (e) { return null; }
  }
  function extBiomeName(v) {
    if (v == null) return '未知';
    if (typeof v === 'string') return BIOME_CN[v] || v;
    if (typeof v === 'number') {
      const keys = Object.keys(BIOME_CN);
      return BIOME_CN[keys[v % keys.length]] || ('群系 ' + v);
    }
    return String(v);
  }

  // ---- 掉落物世界内 3D 框（名字/距离由原 nametags 负责） ----
  function extDropBoxes(r, p, W_, H_, alpha) {
    if (!extOn('drops') || extVal('drops.worldBoxes', true) === false) return;
    const g = state.game;
    if (!g || !Array.isArray(g.entities)) return;
    const c = playerCenter(p, alpha);
    if (!c) return;
    const R = Math.max(8, Number(extVal('drops.range', 32)) || 32);
    const ctx = ectx;
    const EDGES = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6],
      [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
    let drawn = 0;
    ctx.save();
    for (const e of g.entities) {
      if (drawn >= 60) break;
      try {
        if (!e || e === p || e.dead) continue;
        const kind = itemKindOf(e);
        if (!kind) continue;
        let q = null;
        try { q = (typeof e.ipos === 'function') ? e.ipos(alpha == null ? 1 : alpha) : null; } catch (err) { /* noop */ }
        if (!q || typeof q[0] !== 'number') q = Array.isArray(e.pos) ? e.pos : null;
        if (!q) continue;
        const dist = Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]);
        if (dist > R) continue;
        const hw = 0.24, hh = 0.24;
        const cs = [];
        let bad = false;
        for (let i = 0; i < 8; i++) {
          const sp = project(r,
            q[0] + (i & 1 ? hw : -hw),
            q[1] + (i & 2 ? hh : 0),
            q[2] + (i & 4 ? hw : -hw), W_, H_);
          if (!sp || Math.abs(sp.x) > W_ * 2 || Math.abs(sp.y) > H_ * 2) { bad = true; break; }
          cs.push(sp);
        }
        if (bad || cs.length < 8) continue;
        const fade = Math.max(0.25, 1 - dist / (R * 1.2));
        ctx.strokeStyle = hexToRgba(kind, fade);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (const ed of EDGES) {
          ctx.moveTo(cs[ed[0]].x, cs[ed[0]].y);
          ctx.lineTo(cs[ed[1]].x, cs[ed[1]].y);
        }
        ctx.stroke();
        drawn++;
      } catch (err) { /* noop */ }
    }
    ctx.restore();
  }

  // ---- 扩展 tick 汇总 ----
  function extTick(g, p) {
    extAutoTool(g, p);
    extAutoArmor(g, p);
    extDeathPoint(g, p);
    extStats(g, p);
    extCombat(g, p);
  }

  // ---- 扩展 HUD DOM（独立容器，不依赖 hudStage） ----
  const extBox = document.createElement('div');
  extBox.id = '__comet_ext';
  extBox.__alwaysInteractive = true;   // 让滚轮能到面板上（原来 pointer-events:none 滑不动）
  const extSections = {};
  for (const key of ['stats', 'chunk', 'block', 'coords', 'combat',
    'extra', 'orelog', 'resource', 'entity']) {
    const sec = mk('div', 'cm-extsec');
    sec.dataset.sec = key;
    extBox.append(sec);
    extSections[key] = sec;
  }
  try { if (document.documentElement) document.documentElement.append(extBox); } catch (e) { /* noop */ }
  makeDraggable(extBox, 'extPos', 'right', 'bottom', 16, 16);

  function extFoldState() {
    if (!cfg.extFold || typeof cfg.extFold !== 'object') cfg.extFold = {};
    return cfg.extFold;
  }
  let extFoldBound = false;
  function extApplyFold() {
    if (!extFoldBound) {
      extFoldBound = true;
      extBox.addEventListener('mousedown', (ev) => {
        const t = ev.target;
        const cls = String((t && t.className) || '');
        if (cls.indexOf('cm-exttitle') < 0 && cls.indexOf('cm-extfold') < 0) return;
        const title = cls.indexOf('cm-exttitle') >= 0 ? t
          : (t && t.parentNode && String(t.parentNode.className || '').indexOf('cm-exttitle') >= 0 ? t.parentNode : null);
        const sec = title && title.parentNode;
        const key = sec && sec.dataset && sec.dataset.sec;
        if (!key) return;
        ev.preventDefault(); ev.stopPropagation();
        const f = extFoldState();
        f[key] = !f[key];
        saveCfg();
        extApplyFold();
      });
    }
    const f = extFoldState();
    for (const key of Object.keys(extSections)) {
      extSections[key].classList.toggle('folded', !!f[key]);
    }
  }
  function extHtmlRow(label, value, cls) {
    return '<div class="cm-extrow' + (cls ? ' ' + cls : '') + '"><span class="cm-extk">'
      + escHtml(label) + '</span><span class="cm-extv">' + escHtml(value) + '</span></div>';
  }
  function extHud() {
    const g = state.game, p = state.player;
    const showStats = extOn('sessionstats') && extVal('sessionstats.show', true) !== false;
    const showChunk = extOn('chunkinfo') && extVal('chunkinfo.show', true) !== false;
    const showBlock = extOn('blockinfo') && extVal('blockinfo.show', true) !== false;
    const showCoords = extOn('coordlog');
    const showCombat = extOn('combatlog');
    extSections.stats.style.display = showStats ? '' : 'none';
    extSections.chunk.style.display = showChunk ? '' : 'none';
    extSections.block.style.display = showBlock ? '' : 'none';
    extSections.coords.style.display = showCoords ? '' : 'none';
    extSections.combat.style.display = showCombat ? '' : 'none';
    const showExtra = extOn('afk') || extOn('tps') || extOn('entitycount') || extOn('gametime');
    const showOrelog = extOn('orestats') || extOn('blockhistory') || extOn('chatlog');
    const showResource = extOn('resource') || extOn('notes');
    const showEntity = extOn('entityinfo');
    extSections.extra.style.display = showExtra ? '' : 'none';
    extSections.orelog.style.display = showOrelog ? '' : 'none';
    extSections.resource.style.display = showResource ? '' : 'none';
    extSections.entity.style.display = showEntity ? '' : 'none';
    if (showStats) {
      let html = '<div class="cm-exttitle">本次统计</div>';
      html += extHtmlRow('时长', extDuration());
      html += extHtmlRow('行走', ext.distance.toFixed(1) + ' m');
      html += extHtmlRow('挖掘', String(ext.mined));
      html += extHtmlRow('FPS', (isFinite(ext.fpsMin) ? Math.round(ext.fpsMin) : 0) + ' ~ ' + Math.round(ext.fpsMax));
      extSections.stats.innerHTML = html;
    }
    if (showChunk && p) {
      const d = extChunkData(g, p);
      let html = '<div class="cm-exttitle">区块信息</div>';
      html += extHtmlRow('区块', d ? d.cx + ' / ' + d.cz : '--');
      html += extHtmlRow('区内', d ? d.ox + ' / ' + d.oz : '--');
      html += extHtmlRow('高度', d ? String(d.y) : '--');
      html += extHtmlRow('光照', d && d.light != null ? String(d.light >> 4) + ' / ' + String(d.light & 15) : '--');
      html += extHtmlRow('群系', d ? extBiomeName(d.biome) : '--');
      extSections.chunk.innerHTML = html;
    }
    if (showBlock && g) {
      const b = extTargetBlock(g);
      let html = '<div class="cm-exttitle">准星方块</div>';
      html += extHtmlRow('名称', b ? b.name : '--');
      html += extHtmlRow('ID', b && b.id != null ? String(b.id) : '--');
      html += extHtmlRow('坐标', b ? Math.floor(b.pos[0]) + ' / ' + Math.floor(b.pos[1]) + ' / ' + Math.floor(b.pos[2]) : '--');
      html += extHtmlRow('硬度', b && b.hint ? String(b.hint.hard) : '--');
      html += extHtmlRow('建议', b && b.hint ? b.hint.tool : '--');
      extSections.block.innerHTML = html;
    }
    if (showCoords) {
      const list = extEnsure().coords || [];
      let html = '<div class="cm-exttitle">坐标记录 <span>' + list.length + '</span></div>';
      for (const c of list.slice(0, 6)) {
        html += extHtmlRow(c.name + ' ' + c.at, c.x + ' / ' + c.y + ' / ' + c.z);
      }
      if (!list.length) html += '<div class="cm-extempty">还没有记录</div>';
      extSections.coords.innerHTML = html;
    }
    if (showCombat) {
      let html = '<div class="cm-exttitle">战斗日志</div>';
      const kindCn = { hurt: '受伤', heal: '回复', death: '死亡', gear: '装备', coord: '坐标', profile: '配置', macro: '宏', info: '信息' };
      for (const e of ext.events.slice(0, 8)) {
        html += '<div class="cm-extrow cm-ext-' + e.kind + '"><span class="cm-extk">'
          + escHtml(kindCn[e.kind] || '信息') + '</span><span class="cm-extv">' + escHtml(e.text) + '</span></div>';
      }
      if (!ext.events.length) html += '<div class="cm-extempty">暂无事件</div>';
      extSections.combat.innerHTML = html;
    }
    extBox.style.display = (showStats || showChunk || showBlock || showCoords || showCombat
      || showExtra || showOrelog || showResource || showEntity) ? '' : 'none';
    applyPanelPos(extBox, 'extPos', 'right', 'bottom', 16, 16);
  }

  // ==========================================================================
  // 扩展模块包（二）：渲染 / 战斗 / HUD
  // ==========================================================================
  const EXT_MODULES_B = [
    {
      id: 'chunkborder', name: 'ChunkBorders', cn: '区块边界', cat: 'render',
      desc: '在世界里画出区块分界线，方便配合矿透与坐标记录',
      settings: [
        { id: 'radius', name: 'Radius', cn: '范围', type: 'slider', min: 1, max: 5, step: 1, value: 2 },
        { id: 'color', name: 'Color', cn: '线颜色', type: 'color', value: '', desc: '留空 = 青色' },
        { id: 'height', name: 'Height', cn: '线高度', type: 'slider', min: 8, max: 64, step: 4, value: 24 },
      ],
    },
    {
      id: 'lightoverlay', name: 'LightOverlay', cn: '亮度覆盖', cat: 'render',
      desc: '在地面标出方块光照，暗处用红色提示可能刷怪',
      settings: [
        { id: 'radius', name: 'Radius', cn: '范围', type: 'slider', min: 4, max: 24, step: 2, value: 10 },
        { id: 'threshold', name: 'Threshold', cn: '警戒亮度', type: 'slider', min: 0, max: 12, step: 1, value: 7 },
        { id: 'alpha', name: 'Alpha', cn: '透明度', type: 'slider', min: 10, max: 80, step: 5, value: 35 },
      ],
    },
    {
      id: 'armorhud', name: 'ArmorHUD', cn: '装备耐久', cat: 'render',
      desc: '显示四件盔甲与手持物品的耐久条',
      settings: [
        { id: 'show', name: 'Show', cn: '显示面板', type: 'checkbox', value: true },
        { id: 'icons', name: 'Icons', cn: '显示图标', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'potionhud', name: 'PotionHUD', cn: '药水效果', cat: 'render',
      desc: '列出当前状态效果与剩余时间',
      settings: [
        { id: 'show', name: 'Show', cn: '显示面板', type: 'checkbox', value: true },
        { id: 'max', name: 'Max', cn: '最多显示', type: 'slider', min: 2, max: 12, step: 1, value: 6 },
      ],
    },
    {
      id: 'fpsgraph', name: 'FPSGraph', cn: 'FPS 曲线', cat: 'render',
      desc: '独立小画布画出最近 60 次采样的帧率曲线',
      settings: [
        { id: 'height', name: 'Height', cn: '高度', type: 'slider', min: 30, max: 120, step: 10, value: 50 },
        { id: 'color', name: 'Color', cn: '线颜色', type: 'color', value: '', desc: '留空 = 绿色' },
      ],
    },
    {
      id: 'hitmarker', name: 'HitMarker', cn: '击中标记', cat: 'combat',
      desc: '攻击命中后在准星位置闪一下标记',
      settings: [
        { id: 'time', name: 'Duration', cn: '持续时间', type: 'slider', min: 100, max: 800, step: 50, value: 250 },
        { id: 'color', name: 'Color', cn: '颜色', type: 'color', value: '', desc: '留空 = 白色' },
        { id: 'size', name: 'Size', cn: '大小', type: 'slider', min: 4, max: 20, step: 1, value: 9 },
      ],
    },
    {
      id: 'damagenumbers', name: 'DamageNumbers', cn: '伤害数字', cat: 'render',
      desc: '实体掉血时在世界里飘出伤害数字',
      settings: [
        { id: 'color', name: 'Color', cn: '颜色', type: 'color', value: '', desc: '留空 = 红色' },
        { id: 'speed', name: 'Speed', cn: '上飘速度', type: 'slider', min: 0.2, max: 2, step: 0.1, value: 0.8 },
        { id: 'size', name: 'Font Size', cn: '字号', type: 'slider', min: 8, max: 36, step: 1, value: 16 },
        { id: 'bold', name: 'Bold', cn: '加粗', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'crosshair', name: 'Crosshair', cn: '自定义准星', cat: 'render',
      desc: '替换系统准星：形状 / 颜色 / 大小 / 间隙 / 动态扩散',
      settings: [
        { id: 'shape', name: 'Shape', cn: '形状', type: 'select', value: '十字',
          options: ['十字', '点', '圆', '方框', '斜叉'] },
        { id: 'color', name: 'Color', cn: '颜色', type: 'color', value: '', desc: '留空 = 白色' },
        { id: 'size', name: 'Size', cn: '大小', type: 'slider', min: 2, max: 20, step: 1, value: 7 },
        { id: 'gap', name: 'Gap', cn: '间隙', type: 'slider', min: 0, max: 12, step: 1, value: 3 },
        { id: 'thick', name: 'Thickness', cn: '线宽', type: 'slider', min: 1, max: 5, step: 0.5, value: 1.5 },
        { id: 'dynamic', name: 'Dynamic', cn: '移动扩散', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'zoom', name: 'Zoom', cn: '缩放', cat: 'render',
      desc: '按住设定按键放大视野，松开还原',
      settings: [
        { id: 'factor', name: 'Factor', cn: '倍率', type: 'slider', min: 1.2, max: 6, step: 0.2, value: 2.5 },
        { id: 'key', name: 'Key', cn: '按键', type: 'text', value: 'KeyC' },
        { id: 'smooth', name: 'Smooth', cn: '平滑过渡', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'antikb', name: 'AntiKnockback', cn: '防击退', cat: 'combat',
      desc: '受伤时减弱水平击退（仅改客户端速度，不发封包）',
      settings: [
        { id: 'h', name: 'Horizontal', cn: '水平保留', type: 'slider', min: 0, max: 100, step: 5, value: 20 },
        { id: 'v', name: 'Vertical', cn: '垂直保留', type: 'slider', min: 0, max: 100, step: 5, value: 100 },
      ],
    },
  ];
  for (const em of EXT_MODULES_B) {
    MODULES.push(em);
    MODS_BY_ID[em.id] = em;
    if (cfg.states[em.id] === undefined) cfg.states[em.id] = !!em.state;
  }

  const extB = {
    lastHp: new Map(), lastVel: null, pops: [], hitAt: 0, hitTarget: null,
    zoomValue: 1, zoomKeyHeld: false, baseFov: null, lastAttackT: 0,
    lightCache: null, lightAt: 0, graphCanvas: null, graphCtx: null,
  };

  // ---- 11：区块边界 ----
  function extChunkBorders(r, p, W_, H_) {
    if (!extOn('chunkborder')) return;
    const c = playerCenter(p, 1);
    if (!c) return;
    const rad = Math.max(1, Number(extVal('chunkborder.radius', 2)) || 2);
    const height = Math.max(8, Number(extVal('chunkborder.height', 24)) || 24);
    const color = String(extVal('chunkborder.color', '') || '').trim() || '#4fe8e0';
    const ccx = Math.floor(c[0] / 16), ccz = Math.floor(c[2] / 16);
    const ctx = ectx;
    ctx.save();
    ctx.strokeStyle = hexToRgba(color, 0.55);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let dx = -rad; dx <= rad + 1; dx++) {
      const wx = (ccx + dx) * 16;
      for (let dz = -rad; dz <= rad; dz++) {
        const wz = (ccz + dz) * 16;
        const a = project(r, wx, c[1], wz, W_, H_);
        const b = project(r, wx, c[1] + height, wz, W_, H_);
        if (!a || !b) continue;
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
    }
    for (let dz = -rad; dz <= rad + 1; dz++) {
      const wz = (ccz + dz) * 16;
      for (let dx = -rad; dx <= rad; dx++) {
        const wx = (ccx + dx) * 16;
        const a = project(r, wx, c[1], wz, W_, H_);
        const b = project(r, wx, c[1] + height, wz, W_, H_);
        if (!a || !b) continue;
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---- 12：亮度覆盖 ----
  function extLightOverlay(r, p, W_, H_, g) {
    if (!extOn('lightoverlay')) return;
    const c = playerCenter(p, 1);
    const w = g && g.world;
    if (!c || !w || typeof w.getLight !== 'function') return;
    const R = Math.max(4, Number(extVal('lightoverlay.radius', 10)) || 10);
    const threshold = Number(extVal('lightoverlay.threshold', 7)) || 7;
    const alpha = Math.max(0.1, (Number(extVal('lightoverlay.alpha', 35)) || 35) / 100);
    const now = performance.now();
    if (!extB.lightCache || now - extB.lightAt > 700) {
      extB.lightAt = now;
      const cells = [];
      const x0 = Math.floor(c[0]) - R, z0 = Math.floor(c[2]) - R;
      for (let dz = 0; dz <= R * 2; dz++) {
        for (let dx = 0; dx <= R * 2; dx++) {
          const x = x0 + dx, z = z0 + dz;
          let y = Math.floor(c[1]);
          for (let dy = 3; dy >= -4; dy--) {
            if (w.getBlock(x, y + dy, z)) { y = y + dy + 1; break; }
          }
          let lv = 15;
          try { const raw = w.getLight(x, y, z); if (typeof raw === 'number') lv = raw >> 4; } catch (e) { /* noop */ }
          cells.push([x, y, z, lv]);
        }
      }
      extB.lightCache = cells;
    }
    const ctx = ectx;
    ctx.save();
    for (const cell of extB.lightCache || []) {
      const q = project(r, cell[0] + 0.5, cell[1] + 0.02, cell[2] + 0.5, W_, H_);
      if (!q) continue;
      const dangerous = cell[3] < threshold;
      ctx.fillStyle = dangerous ? 'rgba(255,70,70,' + alpha + ')' : 'rgba(80,220,120,' + (alpha * 0.55) + ')';
      const s = Math.max(2, 90 / (Math.hypot(cell[0] - c[0], cell[2] - c[2]) + 4));
      ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
    }
    ctx.restore();
  }

  // ---- 13/14：装备 / 药水数据 ----
  function extArmorRows(p) {
    const slots = p && p.inv && Array.isArray(p.inv.slots) ? p.inv.slots : [];
    const names = ['头盔', '胸甲', '护腿', '靴子'];
    const rows = [];
    for (let i = 0; i < 4; i++) {
      const s = slots[36 + i];
      if (!s || s.id == null) { rows.push({ name: names[i], key: '', pct: 0, empty: true }); continue; }
      const key = extItemKey(s.id);
      const d = extItemDef(s.id);
      let max = Number(d && d.maxDurability) || Number(s.maxDamage) || 0;
      let cur = Number(s.damage) || Number(s.dmg) || 0;
      const pct = max > 0 ? Math.max(0, Math.min(1, 1 - cur / max)) : 1;
      rows.push({ name: names[i], key: key || '#' + s.id, cn: d && d.cn, pct, empty: false });
    }
    const held = p && p.inv && p.inv.held;
    if (held && held.id != null) {
      const d = extItemDef(held.id);
      const max = Number(d && d.maxDurability) || 0;
      const cur = Number(held.damage) || Number(held.dmg) || 0;
      rows.push({ name: '手持', key: extItemKey(held.id) || '#' + held.id,
        cn: d && d.cn, pct: max > 0 ? Math.max(0, Math.min(1, 1 - cur / max)) : 1, empty: false });
    }
    return rows;
  }
  function extEffects(p) {
    const src = p && (p.effects || p.potionEffects || p.activeEffects);
    const out = [];
    try {
      if (Array.isArray(src)) {
        for (const e of src) {
          const key = String((e && (e.key || e.type || e.name)) || '');
          const amp = Number(e && (e.amp !== undefined ? e.amp : e.amplifier)) || 0;
          const dur = Number(e && (e.t !== undefined ? e.t : e.duration)) || 0;
          out.push({ key, cn: POTION_CN[key] || key, amp, dur });
        }
      } else if (src && typeof src === 'object') {
        for (const key of Object.keys(src)) {
          const v = src[key];
          const dur = typeof v === 'number' ? v : Number(v && v.t) || 0;
          out.push({ key, cn: POTION_CN[key] || key, amp: Number(v && v.amp) || 0, dur });
        }
      }
    } catch (e) { /* noop */ }
    return out;
  }
  function extDurText(ticks) {
    const s = Math.max(0, Math.floor(ticks / 20));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  // ---- 15：FPS 曲线 ----
  function extEnsureGraph() {
    if (extB.graphCanvas) return;
    extB.graphCanvas = document.createElement('canvas');
    extB.graphCanvas.id = '__comet_fpsgraph';
    extB.graphCanvas.width = 320; extB.graphCanvas.height = 100;
    extB.graphCtx = extB.graphCanvas.getContext('2d');
    try { document.documentElement.append(extB.graphCanvas); } catch (e) { /* noop */ }
    makeDraggable(extB.graphCanvas, 'fpsGraphPos', 'right', 'bottom', 16, 210);
  }
  function extDrawGraph() {
    const on = extOn('fpsgraph');
    if (!on) { if (extB.graphCanvas) extB.graphCanvas.style.display = 'none'; return; }
    extEnsureGraph();
    const cv = extB.graphCanvas, cx = extB.graphCtx;
    const h = Math.max(30, Number(extVal('fpsgraph.height', 50)) || 50);
    cv.style.display = '';
    cv.style.height = h + 'px';
    const color = String(extVal('fpsgraph.color', '') || '').trim() || '#6ee7a5';
    cx.clearRect(0, 0, cv.width, cv.height);
    cx.fillStyle = 'rgba(8,12,20,.72)';
    cx.fillRect(0, 0, cv.width, cv.height);
    cx.strokeStyle = 'rgba(255,255,255,.12)';
    cx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      cx.beginPath(); cx.moveTo(0, cv.height * i / 4); cx.lineTo(cv.width, cv.height * i / 4); cx.stroke();
    }
    const hist = ext.fpsHist;
    if (hist.length > 1) {
      const max = Math.max(60, ...hist);
      cx.strokeStyle = color;
      cx.lineWidth = 2;
      cx.beginPath();
      for (let i = 0; i < hist.length; i++) {
        const x = i / Math.max(1, hist.length - 1) * cv.width;
        const y = cv.height - (hist[i] / max) * (cv.height - 6) - 3;
        if (i === 0) cx.moveTo(x, y); else cx.lineTo(x, y);
      }
      cx.stroke();
      cx.fillStyle = 'rgba(255,255,255,.85)';
      cx.font = '700 12px "Microsoft YaHei", sans-serif';
      cx.fillText(hist[hist.length - 1] + ' fps', 6, 14);
    }
    applyPanelPos(cv, 'fpsGraphPos', 'right', 'bottom', 16, 210);
  }

  // ---- 16：击中标记 ----
  function extTrackHit(g, p) {
    if (!extOn('hitmarker')) return;
    try {
      const at = num(p, 'attackT') || 0;
      const swing = num(p, 'swingT') || 0;
      const target = g.targetEntity || g.target;
      if ((at > 0 && at < 3) || (swing > 0 && target)) {
        if (performance.now() - extB.hitAt > 120) {
          extB.hitAt = performance.now();
          extB.hitTarget = target || null;
        }
      }
    } catch (e) { /* noop */ }
  }
  function extDrawHitMarker(W_, H_) {
    if (!extOn('hitmarker')) return;
    const dur = Math.max(100, Number(extVal('hitmarker.time', 250)) || 250);
    const age = performance.now() - extB.hitAt;
    if (age > dur) return;
    const size = Math.max(4, Number(extVal('hitmarker.size', 9)) || 9);
    const color = String(extVal('hitmarker.color', '') || '').trim() || '#ffffff';
    const a = 1 - age / dur;
    const cx = W_ / 2, cy = H_ / 2;
    const ctx = ectx;
    ctx.save();
    ctx.strokeStyle = hexToRgba(color, a);
    ctx.lineWidth = 2;
    const g = size * 0.35, l = size * 0.55;
    ctx.beginPath();
    ctx.moveTo(cx - g - l, cy - g - l); ctx.lineTo(cx - g, cy - g);
    ctx.moveTo(cx + g + l, cy - g - l); ctx.lineTo(cx + g, cy - g);
    ctx.moveTo(cx - g - l, cy + g + l); ctx.lineTo(cx - g, cy + g);
    ctx.moveTo(cx + g + l, cy + g + l); ctx.lineTo(cx + g, cy + g);
    ctx.stroke();
    ctx.restore();
  }

  // ---- 17：伤害数字 ----
  function extTrackDamage(g, p) {
    if (!extOn('damagenumbers')) return;
    try {
      const ents = g.entities;
      if (!Array.isArray(ents)) return;
      for (const e of ents) {
        if (!e || e === p) continue;
        const hp = num(e, 'health');
        if (typeof hp !== 'number') continue;
        const prev = extB.lastHp.get(e);
        extB.lastHp.set(e, hp);
        if (prev == null || hp >= prev) continue;
        const q = (typeof e.ipos === 'function') ? e.ipos(1)
          : (Array.isArray(e.pos) ? e.pos : null);
        if (!q) continue;
        extB.pops.push({
          x: q[0], y: q[1] + (num(e, 'h') || 1.8) + 0.3, z: q[2],
          text: '-' + (prev - hp).toFixed(1), born: performance.now(),
        });
      }
    } catch (e) { /* noop */ }
  }
  function extDrawDamage(r, W_, H_) {
    if (!extOn('damagenumbers')) { extB.pops.length = 0; return; }
    const color = String(extVal('damagenumbers.color', '') || '').trim() || '#ff5f6d';
    const speed = Math.max(0.2, Number(extVal('damagenumbers.speed', 0.8)) || 0.8);
    const now = performance.now();
    const ctx = ectx;
    ctx.save();
    const dSize = Math.max(8, Math.min(36, Number(getS('damagenumbers', 'size')) || 16));
    const dWeight = getS('damagenumbers', 'bold') !== false ? '700' : '400';
    ctx.font = dWeight + ' ' + dSize + 'px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    for (let i = extB.pops.length - 1; i >= 0; i--) {
      const pop = extB.pops[i];
      const age = (now - pop.born) / 1000;
      if (age > 1.2) { extB.pops.splice(i, 1); continue; }
      const q = project(r, pop.x, pop.y + age * speed, pop.z, W_, H_);
      if (!q) continue;
      const a = Math.max(0, 1 - age / 1.2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,' + (a * 0.8) + ')';
      ctx.strokeText(pop.text, q.x, q.y);
      ctx.fillStyle = hexToRgba(color, a);
      ctx.fillText(pop.text, q.x, q.y);
    }
    ctx.restore();
  }

  // ---- 18：自定义准星 ----
  function extDrawCrosshair(p, W_, H_) {
    if (!extOn('crosshair')) return;
    const shape = String(extVal('crosshair.shape', '十字') || '十字');
    const color = String(extVal('crosshair.color', '') || '').trim() || '#ffffff';
    const size = Math.max(2, Number(extVal('crosshair.size', 7)) || 7);
    const gap = Math.max(0, Number(extVal('crosshair.gap', 3)) || 0);
    const thick = Math.max(1, Number(extVal('crosshair.thick', 1.5)) || 1.5);
    let spread = 0;
    if (extVal('crosshair.dynamic', true) !== false) {
      const v = num(p, 'vel') || (Array.isArray(p.vel) ? Math.hypot(p.vel[0], p.vel[2]) : 0);
      spread = Math.min(6, Math.abs(v) * 8) + (p.sprinting ? 2 : 0);
    }
    const cx = W_ / 2, cy = H_ / 2, g = gap + spread, L = size;
    const ctx = ectx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = thick;
    ctx.beginPath();
    if (shape === '点') {
      ctx.arc(cx, cy, Math.max(1.5, thick), 0, Math.PI * 2);
      ctx.fill();
    } else if (shape === '圆') {
      ctx.arc(cx, cy, L, 0, Math.PI * 2);
      ctx.stroke();
    } else if (shape === '方框') {
      ctx.rect(cx - L, cy - L, L * 2, L * 2);
      ctx.stroke();
    } else if (shape === '斜叉') {
      ctx.moveTo(cx - L, cy - L); ctx.lineTo(cx + L, cy + L);
      ctx.moveTo(cx + L, cy - L); ctx.lineTo(cx - L, cy + L);
      ctx.stroke();
    } else {
      ctx.moveTo(cx - g - L, cy); ctx.lineTo(cx - g, cy);
      ctx.moveTo(cx + g, cy); ctx.lineTo(cx + g + L, cy);
      ctx.moveTo(cx, cy - g - L); ctx.lineTo(cx, cy - g);
      ctx.moveTo(cx, cy + g); ctx.lineTo(cx, cy + g + L);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- 19：缩放 ----
  function extApplyZoom(g) {
    const factor = Math.max(1.2, Number(extVal('zoom.factor', 2.5)) || 2.5);
    const want = (extOn('zoom') && extB.zoomKeyHeld) ? 1 / factor : 1;
    const smooth = extVal('zoom.smooth', true) !== false;
    extB.zoomValue += (want - extB.zoomValue) * (smooth ? 0.25 : 1);
    try {
      const r = g.renderer || g;
      if (extB.baseFov == null && typeof r.fov === 'number') extB.baseFov = r.fov;
      const base = extB.baseFov || 70;
      if (typeof r.fov === 'number') r.fov = base * extB.zoomValue;
      else if (typeof g.fov === 'number') g.fov = base * extB.zoomValue;
    } catch (e) { /* noop */ }
  }
  function extZoomKey(code, down) {
    const k = String(extVal('zoom.key', 'KeyC') || 'KeyC');
    if (code === k) { extB.zoomKeyHeld = down; return true; }
    return false;
  }

  // ---- 20：防击退 ----
  function extAntiKnockback(p) {
    if (!extOn('antikb')) return;
    try {
      const h = (Number(extVal('antikb.h', 20)) || 0) / 100;
      const v = (Number(extVal('antikb.v', 100)) || 0) / 100;
      const vel = p.vel;
      if (!Array.isArray(vel)) return;
      const hp = num(p, 'health');
      const hurt = hp != null && extB.lastPlayerHp != null && hp < extB.lastPlayerHp;
      extB.lastPlayerHp = hp;
      if (!hurt) return;
      vel[0] *= h; vel[2] *= h; vel[1] *= v;
    } catch (e) { /* noop */ }
  }

  // ---- 二组 tick / render 汇总 ----
  function extTickB(g, p) {
    extTrackHit(g, p);
    extTrackDamage(g, p);
    extAntiKnockback(p);
    extApplyZoom(g);
  }
  function extRenderB(r, p, W_, H_, alpha, g) {
    extChunkBorders(r, p, W_, H_);
    extLightOverlay(r, p, W_, H_, g);
    extDrawDamage(r, W_, H_);
    extDrawHitMarker(W_, H_);
    extDrawCrosshair(p, W_, H_);
  }

  // ---- 二组 HUD ----
  for (const key of ['armor', 'potion']) {
    const sec = mk('div', 'cm-extsec');
    sec.dataset.sec = key;
    extBox.append(sec);
    extSections[key] = sec;
  }
  function extHudB() {
    const p = state.player;
    const showArmor = extOn('armorhud') && extVal('armorhud.show', true) !== false;
    const showPotion = extOn('potionhud') && extVal('potionhud.show', true) !== false;
    extSections.armor.style.display = showArmor ? '' : 'none';
    extSections.potion.style.display = showPotion ? '' : 'none';
    if (showArmor && p) {
      let html = '<div class="cm-exttitle">装备耐久</div>';
      for (const row of extArmorRows(p)) {
        const label = row.cn || row.key || row.name;
        const pct = Math.round(row.pct * 100);
        const cls = row.empty ? ' cm-extemptyrow' : '';
        html += '<div class="cm-extarmor' + cls + '"><span class="cm-extk">'
          + escHtml(row.name) + '</span><span class="cm-extv">' + escHtml(String(label).slice(0, 12))
          + '</span><span class="cm-extbar"><i class="cm-extfill" data-w="' + pct + '"></i></span></div>';
      }
      extSections.armor.innerHTML = html;
      const fills = extSections.armor.querySelectorAll('.cm-extfill');
      for (const f of fills) f.style.width = f.dataset.w + '%';
    }
    if (showPotion && p) {
      const list = extEffects(p).slice(0, Math.max(2, Number(extVal('potionhud.max', 6)) || 6));
      let html = '<div class="cm-exttitle">状态效果</div>';
      for (const e of list) {
        html += extHtmlRow(e.cn + (e.amp ? ' ' + (e.amp + 1) : ''), extDurText(e.dur));
      }
      if (!list.length) html += '<div class="cm-extempty">暂无效果</div>';
      extSections.potion.innerHTML = html;
    }
    try { extDrawGraph(); } catch (e) { /* noop */ }
    return showArmor || showPotion || extOn('fpsgraph');
  }

  const __extHudA = extHud;
  extHud = function () {
    __extHudA();
    let anyB = false;
    try { anyB = !!extHudB(); } catch (e) { /* noop */ }
    if (anyB) extBox.style.display = '';
  };

  // ==========================================================================
  // 扩展模块包（三）：帮助中心 / 键位管理 / 配置体检 / 工具库 / 附加模块
  // ==========================================================================

  // ---- 通用工具库（被下面的模块与面板复用） ----
  const extUtil = {
    clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, Number(v) || 0)); },
    round(v, n) {
      const f = Math.pow(10, n || 0);
      return Math.round((Number(v) || 0) * f) / f;
    },
    pad2(n) { return String(Math.floor(n)).padStart(2, '0'); },
    clock(ms) {
      const s = Math.max(0, Math.floor(ms / 1000));
      return extUtil.pad2(s / 3600) + ':' + extUtil.pad2((s % 3600) / 60) + ':' + extUtil.pad2(s % 60);
    },
    shortClock(ms) {
      const s = Math.max(0, Math.floor(ms / 1000));
      return extUtil.pad2(s / 60) + ':' + extUtil.pad2(s % 60);
    },
    dist(a, b) {
      if (!a || !b) return 0;
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    },
    dist2d(a, b) {
      if (!a || !b) return 0;
      return Math.hypot(a[0] - b[0], a[2] - b[2]);
    },
    bearing(from, to) {
      const dx = to[0] - from[0], dz = to[2] - from[2];
      return ((Math.atan2(dx, dz) * 180 / Math.PI) + 360) % 360;
    },
    bearingName(deg) {
      const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
      return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
    },
    hex2rgb(hex) {
      const h = String(hex || '').replace('#', '');
      const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
      const n = parseInt(s, 16);
      if (!isFinite(n)) return [176, 107, 255];
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    },
    rgb2hex(r, g, b) {
      const f = (v) => extUtil.clamp(v, 0, 255).toString(16).padStart(2, '0');
      return '#' + f(r) + f(g) + f(b);
    },
    mix(a, b, t) {
      const A = extUtil.hex2rgb(a), B = extUtil.hex2rgb(b);
      return extUtil.rgb2hex(
        A[0] + (B[0] - A[0]) * t,
        A[1] + (B[1] - A[1]) * t,
        A[2] + (B[2] - A[2]) * t,
      );
    },
    hsv(h, s, v) {
      const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
      let r = 0, g = 0, b = 0;
      if (h < 60) { r = c; g = x; }
      else if (h < 120) { r = x; g = c; }
      else if (h < 180) { g = c; b = x; }
      else if (h < 240) { g = x; b = c; }
      else if (h < 300) { r = x; b = c; }
      else { r = c; b = x; }
      return extUtil.rgb2hex((r + m) * 255, (g + m) * 255, (b + m) * 255);
    },
    lerp(a, b, t) { return a + (b - a) * t; },
    smoothstep(t) { t = extUtil.clamp(t, 0, 1); return t * t * (3 - 2 * t); },
    hash(str) {
      let h = 2166136261;
      for (let i = 0; i < String(str).length; i++) {
        h ^= String(str).charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0);
    },
    colorOf(str, sat) {
      const hue = extUtil.hash(str) % 360;
      return extUtil.hsv(hue, sat || 0.55, 0.72);
    },
    clone(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } },
    deepEqual(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return a === b; } },
    once(fn) {
      let done = false, result;
      return function () { if (!done) { done = true; result = fn.apply(this, arguments); } return result; };
    },
    throttle(fn, ms) {
      let last = 0;
      return function () {
        const now = performance.now();
        if (now - last < ms) return;
        last = now;
        return fn.apply(this, arguments);
      };
    },
    debounce(fn, ms) {
      let timer = null;
      return function () {
        const args = arguments, self = this;
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(self, args), ms);
      };
    },
    nowISO() { return new Date().toISOString(); },
    dateText(d) {
      const x = d || new Date();
      return x.getFullYear() + '-' + extUtil.pad2(x.getMonth() + 1) + '-'
        + extUtil.pad2(x.getDate()) + ' ' + extUtil.pad2(x.getHours()) + ':'
        + extUtil.pad2(x.getMinutes());
    },
    bytes(n) {
      const v = Number(n) || 0;
      if (v < 1024) return v + ' B';
      if (v < 1048576) return (v / 1024).toFixed(1) + ' KB';
      return (v / 1048576).toFixed(1) + ' MB';
    },
    pct(v, total) { return total > 0 ? Math.round(v / total * 100) : 0; },
    versionCompare(a, b) {
      const A = String(a).split('.').map(Number), B = String(b).split('.').map(Number);
      for (let i = 0; i < Math.max(A.length, B.length); i++) {
        const d = (A[i] || 0) - (B[i] || 0);
        if (d) return d > 0 ? 1 : -1;
      }
      return 0;
    },
    escape(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c])); },
    truncate(s, n) { const v = String(s == null ? '' : s); return v.length > n ? v.slice(0, n - 1) + '…' : v; },
    splitLines(s) { return String(s || '').split(/\r?\n/).filter((x) => x.trim().length); },
    sum(arr) { return (arr || []).reduce((a, b) => a + (Number(b) || 0), 0); },
    avg(arr) { return arr && arr.length ? extUtil.sum(arr) / arr.length : 0; },
    median(arr) {
      if (!arr || !arr.length) return 0;
      const s = arr.slice().sort((a, b) => a - b);
      return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    },
    uniq(arr) { return Array.from(new Set(arr || [])); },
    groupBy(arr, key) {
      const out = {};
      for (const it of arr || []) {
        const k = typeof key === 'function' ? key(it) : it[key];
        (out[k] = out[k] || []).push(it);
      }
      return out;
    },
    pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; },
    msToTicks(ms) { return Math.floor((Number(ms) || 0) / 50); },
    ticksToMs(t) { return (Number(t) || 0) * 50; },
    gameTime(tick) {
      const t = ((Number(tick) || 0) % 24000 + 24000) % 24000;
      const h = Math.floor(t / 1000 + 6) % 24;
      const m = Math.floor((t % 1000) / 1000 * 60);
      return extUtil.pad2(h) + ':' + extUtil.pad2(m);
    },
    moonPhase(day) { return ['满月', '亏凸月', '下弦月', '残月', '新月', '娥眉月', '上弦月', '盈凸月'][((Math.floor(day) % 8) + 8) % 8]; },
    safeJson(s, def) { try { return JSON.parse(s); } catch (e) { return def; } },
    isNum(v) { return typeof v === 'number' && isFinite(v); },
    first() { for (let i = 0; i < arguments.length; i++) if (arguments[i] != null && arguments[i] !== '') return arguments[i]; return null; },
  };

  // ---- 模块说明表（帮助中心的数据源，逐条写清「是什么 / 何时用 / 注意」） ----
  const EXT_MODULE_DOCS = {
    aura: { what: '自动攻击范围内目标', when: '打怪 / 清场', tip: '联机时伤害由服务端判定，仅作辅助' },
    multiaura: { what: '一次挥击打中多个目标', when: '被围', tip: '目标数越多越吃性能' },
    triggerbot: { what: '准星指向目标时自动攻击', when: '单挑', tip: '需要准星真的落在实体上' },
    bowaim: { what: '统一弹道解算的弓箭辅助', when: '远程', tip: '落点偏低用「弹道校准」微调' },
    crit: { what: '每次攻击判定暴击', when: '近战', tip: '联机一般无效' },
    autosprint: { what: '自动保持疾跑', when: '跑图', tip: '可设仅前进时生效' },
    fly: { what: '双击空格开关飞行', when: '建造 / 赶路', tip: '联机可能被服务端拉回' },
    autojump: { what: '被挡住自动起跳', when: '跑图', tip: '会临时改游戏设置并还原' },
    speed: { what: '提高移动速度', when: '赶路', tip: '倍率别调太离谱' },
    step: { what: '自动上一格台阶', when: '跑图', tip: '靠 stepHeight 实现' },
    scaffold: { what: '前进时自动在脚下铺方块', when: '搭路', tip: '只放真正的方块物品，食物不会放' },
    nofall: { what: '取消坠落伤害', when: '高空作业', tip: '用 slowFall 短路 onLand' },
    autorespawn: { what: '死亡后自动重生', when: '刷怪塔', tip: '有 1.5 秒节流' },
    fastbreak: { what: '加快挖掘进度', when: '挖矿', tip: 'hook breakSpeed' },
    instantbreak: { what: '开始挖立即破坏', when: '拆建筑', tip: '联机会走发包路径' },
    autoeat: { what: '饥饿时自动进食', when: '长途', tip: '读 food 字段' },
    waterbreath: { what: '水下不消耗氧气', when: '海底', tip: '持续把 air 补满' },
    freecam: { what: '相机脱离身体', when: '探洞 / 观察', tip: '身体留在原地' },
    esp: { what: '生物 3D 线框', when: '找怪', tip: '距离越大越吃性能' },
    tracers: { what: '准星到实体的追踪线', when: '定位', tip: '实体太多时关掉' },
    projectile: { what: '抛物线 / 落点 / 预判线', when: '投掷 / 射箭', tip: '光带 / 细线 / 光点三种样式' },
    nametags: { what: '实体名字 / 距离 / 手持 / 装备', when: '辨识', tip: '支持别名与背景色' },
    itemesp: { what: '掉落物与投射物标记', when: '捡东西', tip: '配合掉落物汇总使用' },
    targetesp: { what: '高亮当前目标', when: '战斗', tip: '四角括号样式' },
    fullbright: { what: '强制最亮', when: '洞穴', tip: '只改本地渲染' },
    nightvision: { what: '夜视', when: '夜间', tip: '走游戏原生路径' },
    ambience: { what: '锁定时间与天气', when: '录屏 / 截图', tip: '仅本地显示' },
    hud: { what: '彗星式 HUD', when: '常驻', tip: '水印 / 坐标 / 罗盘 / 雷达可分项关' },
    waypoints: { what: '路径点光柱与屏外箭头', when: '标记地点', tip: '位置随视角变化' },
    minimap: { what: '圆形小地图', when: '认路', tip: '地形采样有节流' },
    invhud: { what: '背包面板', when: '整理', tip: '可拖位置与缩放' },
    drops: { what: '掉落物汇总 + 世界内框与名字', when: '捡东西', tip: '隐藏散标签可只留汇总' },
    mblur: { what: '转视角时画面动态模糊', when: '观感', tip: 'backdrop-filter 有开销' },
    spin: { what: '模型身体自转', when: '娱乐', tip: '只改 playerBodyYaw，视角不动' },
    xray: { what: '材质透视 / 框选', when: '找矿', tip: '仅单人自用服；隐藏 #gl 不改存档' },
    blockesp: { what: '指定方块追踪', when: '找特定方块', tip: '用浏览方块选择器' },
    targetring: { what: '目标脚下光圈', when: '战斗', tip: '与 Aura 目标联动' },
    trail: { what: '身后渐隐光轨', when: '观感', tip: '记录点有上限' },
    music: { what: '可搜索音乐播放器', when: '挂机', tip: '聚合多源，遵守 API 限流与出处声明' },
    appearance: { what: '外观四档位', when: '换皮', tip: '自定义档还原上次调过的值' },
    perf: { what: '性能档位与实体上限', when: '掉帧', tip: '自动档按实时 FPS 降级' },
    autotool: { what: '自动切最佳工具', when: '挖矿', tip: '物品表缺失时跳过' },
    autoarmor: { what: '自动穿最好的盔甲', when: '战斗前', tip: '只动背包与盔甲栏' },
    deathpoint: { what: '死亡自动打点', when: '探险', tip: '复用路径点系统' },
    coordlog: { what: '记录 / 导出坐标', when: '探图', tip: '存进 .opuscfg 备份' },
    sessionstats: { what: '本次游玩统计', when: '复盘', tip: '可随时重置' },
    combatlog: { what: '最近战斗事件', when: '复盘', tip: '只观察本地血量变化' },
    profile: { what: '三套配置档', when: '切场景', tip: '存模块开关与设置快照' },
    macro: { what: '三条聊天宏', when: '快捷发言', tip: '单机只提示不发包' },
    chunkinfo: { what: '区块 / 光照 / 群系', when: '查环境', tip: '依赖 world.getLight' },
    blockinfo: { what: '准星方块信息', when: '挖矿', tip: '含硬度与建议工具' },
    chunkborder: { what: '区块边界线', when: '对齐', tip: '范围别开太大' },
    lightoverlay: { what: '地面亮度格子', when: '防刷怪', tip: '红色 = 低于警戒亮度' },
    armorhud: { what: '装备耐久条', when: '战斗', tip: '读 damage / maxDurability' },
    potionhud: { what: '状态效果计时', when: '药水流', tip: '依赖 effects 字段' },
    fpsgraph: { what: 'FPS 曲线', when: '调性能', tip: '最近 60 次采样' },
    hitmarker: { what: '命中闪标', when: '战斗', tip: '观察攻击反馈' },
    damagenumbers: { what: '伤害飘字', when: '战斗', tip: '按实体血量差计算' },
    crosshair: { what: '自定义准星', when: '观感', tip: '五种形状可切' },
    zoom: { what: '按键缩放视野', when: '看远处', tip: '改 renderer.fov' },
    antikb: { what: '减弱水平击退', when: 'PVP', tip: '仅改客户端速度' },
    server: { what: '房间服务器切换', when: '联机', tip: '仅对兼容服务端有效' },
    gate: { what: '跳过多人界面门槛', when: '进房', tip: '不改服务端权限' },
    mc18: { what: 'MC 1.8 直连入口', when: '自用服', tip: '需要配套内核脚本' },
    hudedit: { what: 'HUD 编辑模式', when: '调布局', tip: '拖完点提示条完成' },
    cfgreset: { what: '导出 / 导入 / 重置配置', when: '备份', tip: '.opuscfg 专用格式' },
    floatgui: { what: '悬浮分类面板', when: '调模块', tip: '右键标题折叠' },
  };

  // ---- 附加小模块 ----
  const EXT_MODULES_C = [
    {
      id: 'welcome', name: 'Welcome', cn: '欢迎提示', cat: 'misc',
      desc: '进入世界时显示一条版本与快捷键提示',
      settings: [
        { id: 'text', name: 'Text', cn: '自定义文字', type: 'text', value: '' },
        { id: 'time', name: 'Duration', cn: '显示时长', type: 'slider', min: 2, max: 15, step: 1, value: 5 },
      ],
    },
    {
      id: 'afk', name: 'AFK', cn: '挂机检测', cat: 'misc',
      desc: '一段时间没有移动就在 HUD 上标记挂机状态',
      settings: [
        { id: 'seconds', name: 'Seconds', cn: '判定秒数', type: 'slider', min: 10, max: 300, step: 10, value: 60 },
      ],
    },
    {
      id: 'tps', name: 'TPS', cn: 'TPS 估算', cat: 'misc',
      desc: '按 worldTime 变化估算服务端 tick 速率',
      settings: [
        { id: 'show', name: 'Show', cn: '显示面板', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'entitycount', name: 'EntityCount', cn: '实体计数', cat: 'misc',
      desc: '统计附近生物 / 掉落物 / 玩家数量',
      settings: [
        { id: 'range', name: 'Range', cn: '统计半径', type: 'slider', min: 16, max: 128, step: 8, value: 64 },
      ],
    },
    {
      id: 'gametime', name: 'GameClock', cn: '游戏时钟', cat: 'misc',
      desc: '显示游戏内时间 / 天数 / 月相',
      settings: [
        { id: 'show', name: 'Show', cn: '显示面板', type: 'checkbox', value: true },
        { id: 'moon', name: 'Moon', cn: '显示月相', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'lowhp', name: 'LowHP', cn: '低血量警报', cat: 'combat',
      desc: '血量低于阈值时屏幕边缘泛红并提示',
      settings: [
        { id: 'threshold', name: 'Threshold', cn: '阈值', type: 'slider', min: 2, max: 15, step: 1, value: 6 },
        { id: 'flash', name: 'Flash', cn: '闪烁', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'armorwarn', name: 'ArmorWarn', cn: '装备损坏警告', cat: 'combat',
      desc: '装备耐久低于一定比例时提醒',
      settings: [
        { id: 'pct', name: 'Percent', cn: '警戒比例', type: 'slider', min: 5, max: 50, step: 5, value: 15 },
      ],
    },
    {
      id: 'coordcopy', name: 'CoordCopy', cn: '复制坐标', cat: 'misc',
      desc: '一键把当前坐标复制到剪贴板',
      settings: [
        { id: 'copy', name: 'Copy', cn: '复制当前坐标', type: 'button' },
        { id: 'format', name: 'Format', cn: '格式', type: 'select', value: 'x y z',
          options: ['x y z', 'x, y, z', '/tp x y z', '[x, y, z]'] },
      ],
    },
    {
      id: 'helpcenter', name: 'HelpCenter', cn: '帮助中心', cat: 'configs',
      desc: '可搜索的模块说明与快捷键速查',
      settings: [
        { id: 'open', name: 'Open', cn: '打开帮助中心', type: 'button' },
        { id: 'export', name: 'Export', cn: '导出模块清单', type: 'button' },
      ],
    },
    {
      id: 'keyadmin', name: 'KeyAdmin', cn: '键位管理', cat: 'configs',
      desc: '列出所有已绑定快捷键，可逐条清除',
      settings: [
        { id: 'open', name: 'Open', cn: '打开键位管理', type: 'button' },
        { id: 'clear', name: 'Clear All', cn: '清空全部键位', type: 'button' },
      ],
    },
    {
      id: 'healthcheck', name: 'HealthCheck', cn: '配置体检', cat: 'configs',
      desc: '检查配置项、路径点与面板位置是否异常',
      settings: [
        { id: 'run', name: 'Run', cn: '立即体检', type: 'button' },
        { id: 'export', name: 'Export', cn: '导出体检报告', type: 'button' },
      ],
    },
  ];
  for (const em of EXT_MODULES_C) {
    MODULES.push(em);
    MODS_BY_ID[em.id] = em;
    if (cfg.states[em.id] === undefined) cfg.states[em.id] = !!em.state;
  }

  const extC = {
    lastMoveAt: performance.now(), lastWorldTime: null, tps: 20, tpsAt: 0,
    welcomeShown: false, lastWarnAt: 0, lowHpFlash: 0, checkResult: null,
  };

  // ---- 附加模块逻辑 ----
  function extTickC(g, p) {
    try {
      const q = playerCenter(p, 1);
      if (q) {
        const moved = extC.lastPos ? extUtil.dist(q, extC.lastPos) > 0.05 : true;
        if (moved) extC.lastMoveAt = performance.now();
        extC.lastPos = [q[0], q[1], q[2]];
      }
      const wt = num(g, 'worldTime');
      if (extUtil.isNum(wt)) {
        const now = performance.now();
        if (extC.lastWorldTime != null && now - extC.tpsAt > 1000) {
          const dt = (now - extC.tpsAt) / 1000;
          const d = ((wt - extC.lastWorldTime) + 24000) % 24000;
          if (d > 0 && d < 1000) extC.tps = extUtil.clamp(d / dt / 20, 0, 25);
          extC.tpsAt = now;
          extC.lastWorldTime = wt;
        } else if (extC.lastWorldTime == null) {
          extC.lastWorldTime = wt; extC.tpsAt = now;
        }
      }
      const hp = num(p, 'health');
      if (extOn('lowhp') && extUtil.isNum(hp) && hp <= (Number(extVal('lowhp.threshold', 6)) || 6)) {
        extC.lowHpFlash = performance.now();
      }
      if (extOn('armorwarn')) {
        const pct = (Number(extVal('armorwarn.pct', 15)) || 15) / 100;
        const now = performance.now();
        if (now - extC.lastWarnAt > 15000) {
          for (const row of extArmorRows(p)) {
            if (!row.empty && row.pct > 0 && row.pct < pct) {
              pushNotification('装备警告', row.name + ' 耐久偏低');
              extLog('装备警告：' + row.name, 'gear');
              extC.lastWarnAt = now;
              break;
            }
          }
        }
      }
      if (extOn('welcome') && !extC.welcomeShown && q) {
        extC.welcomeShown = true;
        const custom = String(extVal('welcome.text', '') || '').trim();
        pushNotification('OpusHUD v' + VERSION,
          custom || '`~ 开悬浮面板 · Insert 开经典面板 · M 开大地图');
      }
    } catch (e) { /* noop */ }
  }

  function extAfkText() {
    const sec = (Number(extVal('afk.seconds', 60)) || 60);
    const idle = (performance.now() - extC.lastMoveAt) / 1000;
    return idle > sec ? '挂机中 ' + extUtil.shortClock(idle * 1000) : '活跃';
  }
  function extEntityCounts(g, p) {
    const c = playerCenter(p, 1);
    const R = Math.max(16, Number(extVal('entitycount.range', 64)) || 64);
    const out = { mob: 0, item: 0, player: 0, other: 0, total: 0 };
    if (!c || !Array.isArray(g.entities)) return out;
    for (const e of g.entities) {
      if (!e || e === p || e.dead) continue;
      const q = Array.isArray(e.pos) ? e.pos : null;
      if (!q || extUtil.dist(q, c) > R) continue;
      out.total++;
      if (e.health != null && e.maxHealth != null) {
        if (e.type === 'player') out.player++; else out.mob++;
      } else if (itemKindOf(e)) out.item++;
      else out.other++;
    }
    return out;
  }
  function extGameClock(g) {
    const tick = num(g, 'worldTime') || 0;
    const day = Math.floor(tick / 24000);
    return { text: extUtil.gameTime(tick), day, moon: extUtil.moonPhase(day) };
  }
  function extCopyCoord() {
    const p = state.player, q = p && playerCenter(p, 1);
    if (!q) { pushNotification('复制坐标', '还没进入世界'); return; }
    const x = Math.floor(q[0]), y = Math.floor(q[1]), z = Math.floor(q[2]);
    const fmt = String(extVal('coordcopy.format', 'x y z') || 'x y z');
    const text = fmt === 'x, y, z' ? x + ', ' + y + ', ' + z
      : fmt === '/tp x y z' ? '/tp ' + x + ' ' + y + ' ' + z
        : fmt === '[x, y, z]' ? '[' + x + ', ' + y + ', ' + z + ']'
          : x + ' ' + y + ' ' + z;
    try { navigator.clipboard.writeText(text); } catch (e) { /* noop */ }
    extLog('复制坐标 ' + text, 'coord');
    pushNotification('复制坐标', text);
  }
  function extLowHpOverlay(W_, H_) {
    if (!extOn('lowhp')) return;
    const age = performance.now() - extC.lowHpFlash;
    if (age > 900) return;
    const flash = extVal('lowhp.flash', true) !== false;
    const a = (1 - age / 900) * 0.32 * (flash ? (0.65 + 0.35 * Math.sin(age / 60)) : 1);
    const ctx = ectx;
    const gr = ctx.createRadialGradient(W_ / 2, H_ / 2, Math.min(W_, H_) * 0.25,
      W_ / 2, H_ / 2, Math.max(W_, H_) * 0.62);
    gr.addColorStop(0, 'rgba(255,0,0,0)');
    gr.addColorStop(1, 'rgba(255,20,20,' + Math.max(0, a) + ')');
    ctx.save();
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W_, H_);
    ctx.restore();
  }

  // ---- 配置体检 ----
  function extHealthCheck() {
    const issues = [];
    const cfgKeys = Object.keys(cfg.settings || {});
    for (const k of cfgKeys) {
      const dot = k.indexOf('.');
      if (dot < 0) { issues.push('设置键格式异常：' + k); continue; }
      const mid = k.slice(0, dot), sid = k.slice(dot + 1);
      const m = MODS_BY_ID[mid];
      if (!m) { issues.push('未知模块的设置：' + k); continue; }
      const s = m.settings && m.settings.find((x) => x.id === sid);
      if (!s) issues.push('未知设置项：' + k);
    }
    for (const id of Object.keys(cfg.binds || {})) {
      if (!MODS_BY_ID[id]) issues.push('未知模块的键位：' + id);
    }
    if (!Array.isArray(cfg.waypoints)) issues.push('路径点数据不是数组');
    else {
      cfg.waypoints.forEach((w, i) => {
        if (!extUtil.isNum(w.x) || !extUtil.isNum(w.y) || !extUtil.isNum(w.z)) {
          issues.push('路径点 ' + (i + 1) + ' 坐标异常');
        }
      });
    }
    for (const key of ['invPos', 'dropsPos', 'minmapPos', 'musicPos', 'extPos', 'fpsGraphPos']) {
      const v = cfg[key];
      if (v && (!extUtil.isNum(v.x) || !extUtil.isNum(v.y))) issues.push('面板位置异常：' + key);
    }
    if (!cfg.ext) issues.push('扩展数据缺失');
    else {
      if (!Array.isArray(cfg.ext.coords)) issues.push('坐标记录不是数组');
      if (!cfg.ext.profiles || typeof cfg.ext.profiles !== 'object') issues.push('配置档数据异常');
    }
    const report = {
      version: VERSION, at: extUtil.nowISO(),
      modules: MODULES.length, settings: cfgKeys.length,
      binds: Object.keys(cfg.binds || {}).length,
      waypoints: (cfg.waypoints || []).length,
      coords: ((cfg.ext && cfg.ext.coords) || []).length,
      profiles: Object.keys((cfg.ext && cfg.ext.profiles) || {}).length,
      issues,
    };
    extC.checkResult = report;
    extLog('配置体检：' + (issues.length ? issues.length + ' 项异常' : '全部正常'), 'profile');
    return report;
  }
  function extExportCheck() {
    const r = extHealthCheck();
    const lines = [
      'OpusHUD 配置体检 ' + r.version,
      '时间：' + r.at,
      '模块：' + r.modules + ' / 设置：' + r.settings + ' / 键位：' + r.binds,
      '路径点：' + r.waypoints + ' / 坐标记录：' + r.coords + ' / 配置档：' + r.profiles,
      '问题：' + (r.issues.length || '无'),
    ].concat(r.issues.map((x) => ' - ' + x));
    const body = lines.join('\n');
    try {
      const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'opus-hud-check.txt';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      pushNotification('配置体检', '报告已导出');
    } catch (e) { pushNotification('配置体检', body.slice(0, 80)); }
  }
  function extExportStats() {
    const counts = extEntityCounts(state.game || {}, state.player || {});
    const lines = [
      'OpusHUD 本次统计 ' + VERSION,
      '导出时间：' + extUtil.dateText(),
      '游玩时长：' + extDuration(),
      '行走距离：' + ext.distance.toFixed(1) + ' m',
      '挖掘次数：' + ext.mined,
      'FPS 范围：' + (isFinite(ext.fpsMin) ? Math.round(ext.fpsMin) : 0) + ' ~ ' + Math.round(ext.fpsMax),
      'FPS 均值：' + extUtil.avg(ext.fpsHist).toFixed(1),
      '附近实体：生物 ' + counts.mob + ' / 掉落 ' + counts.item + ' / 玩家 ' + counts.player,
      'TPS 估算：' + extC.tps.toFixed(1),
      '状态：' + extAfkText(),
      '',
      '最近事件：',
    ].concat(ext.events.map((e) => ' - [' + e.kind + '] ' + e.text));
    const body = lines.join('\n');
    try {
      const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'opus-hud-stats.txt';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      pushNotification('本次统计', '统计已导出');
    } catch (e) { pushNotification('本次统计', body.slice(0, 80)); }
  }
  function extExportModuleList() {
    const lines = ['OpusHUD 模块清单 ' + VERSION, '共 ' + MODULES.length + ' 个模块', ''];
    for (const cat of CATS) {
      const list = MODULES.filter((m) => m.cat === cat.id);
      if (!list.length) continue;
      lines.push('[' + cat.name + ']');
      for (const m of list) {
        const doc = EXT_MODULE_DOCS[m.id] || {};
        lines.push(' - ' + m.cn + ' (' + m.name + ')：' + (doc.what || m.desc));
        if (doc.when) lines.push('   适用：' + doc.when);
        if (doc.tip) lines.push('   注意：' + doc.tip);
        const st = m.settings || [];
        if (st.length) lines.push('   设置：' + st.map((s) => s.cn).join(' / '));
      }
      lines.push('');
    }
    const body = lines.join('\n');
    try {
      const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'opus-hud-modules.txt';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      pushNotification('帮助中心', '模块清单已导出');
    } catch (e) { pushNotification('帮助中心', body.slice(0, 80)); }
  }

  // ---- 帮助中心 / 键位管理面板（独立浮层） ----
  const helper = mk('div');
  helper.id = '__comet_helper';
  const hh = mk('div', 'cm-hphead');
  hh.append(mk('span', 'cm-hptitle', '帮助中心'));
  const hClose = mk('div', 'cm-hpclose', '×');
  hh.append(hClose);
  const hTabs = mk('div', 'cm-hptabs');
  const tabHelp = mk('div', 'cm-hptab on', '模块说明');
  const tabKeys = mk('div', 'cm-hptab', '键位管理');
  const tabCheck = mk('div', 'cm-hptab', '配置体检');
  hTabs.append(tabHelp, tabKeys, tabCheck);
  const hSearch = document.createElement('input');
  hSearch.className = 'cm-hpsearch';
  hSearch.placeholder = '搜索模块名 / 说明…';
  const hBody = mk('div', 'cm-hpbody');
  helper.append(hh, hTabs, hSearch, hBody);
  try { if (document.documentElement) document.documentElement.append(helper); } catch (e) { /* noop */ }
  let hTab = 'help';
  function helperRender() {
    const q = String(hSearch.value || '').trim().toLowerCase();
    let html = '';
    if (hTab === 'help') {
      for (const cat of CATS) {
        const list = MODULES.filter((m) => m.cat === cat.id).filter((m) => {
          if (!q) return true;
          const d = EXT_MODULE_DOCS[m.id] || {};
          return (m.cn + m.name + m.desc + (d.what || '') + (d.when || '')).toLowerCase().indexOf(q) >= 0;
        });
        if (!list.length) continue;
        html += '<div class="cm-hpcat">' + extUtil.escape(cat.name) + '</div>';
        for (const m of list) {
          const d = EXT_MODULE_DOCS[m.id] || {};
          html += '<div class="cm-hpitem"><b>' + extUtil.escape(m.cn) + '</b>'
            + '<span class="cm-hpid">' + extUtil.escape(m.name) + '</span>'
            + '<div class="cm-hpwhat">' + extUtil.escape(d.what || m.desc) + '</div>'
            + (d.when ? '<div class="cm-hpmeta">适用：' + extUtil.escape(d.when) + '</div>' : '')
            + (d.tip ? '<div class="cm-hptip">注意：' + extUtil.escape(d.tip) + '</div>' : '')
            + '</div>';
        }
      }
      if (!html) html = '<div class="cm-hpempty">没有匹配的模块</div>';
    } else if (hTab === 'keys') {
      const binds = cfg.binds || {};
      const keys = Object.keys(binds);
      html = '<div class="cm-hpcat">已绑定 ' + keys.length + ' 个模块</div>';
      for (const id of keys) {
        const m = MODS_BY_ID[id];
        html += '<div class="cm-hpkeyrow"><span>' + extUtil.escape(m ? m.cn : id)
          + '</span><span class="cm-hpkey">' + extUtil.escape(keyName(binds[id]))
          + '</span><span class="cm-hpdel" data-id="' + extUtil.escape(id) + '">清除</span></div>';
      }
      html += '<div class="cm-hpcat">系统快捷键</div>';
      const sys = [
        ['悬浮标签面板', keyName(cfg.guiKey || 'Backquote')],
        ['经典面板', 'Ins / ScrLk'],
        ['大地图', 'M'],
        ['关闭 / 返回', 'Esc'],
        ['HUD 编辑', '在配置里点「编辑位置」'],
      ];
      for (const [n, k] of sys) {
        html += '<div class="cm-hpkeyrow"><span>' + n + '</span><span class="cm-hpkey">'
          + extUtil.escape(k) + '</span></div>';
      }
      if (!keys.length) html += '<div class="cm-hpempty">还没有绑定模块快捷键</div>';
    } else {
      const r = extHealthCheck();
      html = '<div class="cm-hpcat">配置体检</div>';
      const rows = [
        ['脚本版本', r.version], ['模块总数', r.modules], ['设置项', r.settings],
        ['键位绑定', r.binds], ['路径点', r.waypoints], ['坐标记录', r.coords],
        ['配置档', r.profiles], ['异常项', r.issues.length],
      ];
      for (const [n, v] of rows) {
        html += '<div class="cm-hpkeyrow"><span>' + n + '</span><span class="cm-hpkey">' + v + '</span></div>';
      }
      if (r.issues.length) {
        html += '<div class="cm-hpcat">需要处理</div>';
        for (const i of r.issues) html += '<div class="cm-hptip">' + extUtil.escape(i) + '</div>';
      } else {
        html += '<div class="cm-hpok">配置看起来一切正常</div>';
      }
    }
    hBody.innerHTML = html;
    for (const del of hBody.querySelectorAll('.cm-hpdel')) {
      del.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        delete cfg.binds[del.dataset.id];
        saveCfg(); refreshGui(); helperRender();
        pushNotification('键位管理', '已清除');
      });
    }
  }
  for (const [tab, name] of [[tabHelp, 'help'], [tabKeys, 'keys'], [tabCheck, 'check']]) {
    tab.addEventListener('mousedown', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      hTab = name;
      for (const t of [tabHelp, tabKeys, tabCheck]) t.classList.toggle('on', t === tab);
      helperRender();
    });
  }
  hSearch.addEventListener('input', helperRender);
  hSearch.addEventListener('keydown', (ev) => ev.stopPropagation());
  hClose.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    helper.classList.remove('open');
  });
  function helperOpen(on) {
    helper.classList.toggle('open', on == null ? !helper.classList.contains('open') : !!on);
    if (helper.classList.contains('open')) helperRender();
  }

  // ---- 三组 HUD 汇总 ----
  function extHudC() {
    const g = state.game || {}, p = state.player || {};
    const extra = [];
    if (extOn('afk')) extra.push(['状态', extAfkText()]);
    if (extOn('tps') && extVal('tps.show', true) !== false) {
      extra.push(['TPS', extC.tps.toFixed(1)]);
    }
    if (extOn('entitycount')) {
      const c = extEntityCounts(g, p);
      extra.push(['实体', '生物 ' + c.mob + ' / 掉落 ' + c.item + ' / 玩家 ' + c.player]);
    }
    if (extOn('gametime') && extVal('gametime.show', true) !== false) {
      const t = extGameClock(g);
      extra.push(['游戏时间', t.text + ' · 第 ' + t.day + ' 天' + (extVal('gametime.moon', true) !== false ? ' · ' + t.moon : '')]);
    }
    const sec = extSections.extra;
    if (!sec) return false;
    if (!extra.length) { sec.innerHTML = ''; return false; }
    let html = '<div class="cm-exttitle">环境信息</div>';
    for (const [k, v] of extra) html += extHtmlRow(k, v);
    sec.innerHTML = html;
    return true;
  }
  function extRenderC(r, p, W_, H_) {
    extLowHpOverlay(W_, H_);
  }

  // ==========================================================================
  // 扩展模块包（四）：环境感知 / 记录 / 工具 / 自检
  // ==========================================================================

  // ---- 速查数据表 ----
  const EXT_PALETTE = {
    red: '#ff5f6d', orange: '#ff9a5b', amber: '#ffc857', lime: '#a8e06a',
    mint: '#6ee7a5', teal: '#4fe8e0', cyan: '#5fd8ff', azure: '#4f9bff',
    blue: '#4f7bff', indigo: '#7b7bff', violet: '#b06bff', purple: '#c07bff',
    pink: '#ff7bc0', rose: '#ff5f9e', brown: '#b98463', slate: '#8c94a3',
    ink: '#10141c', coal: '#1c2230', snow: '#eef2f8', gold: '#ffd54f',
  };
  const EXT_MESSAGES = {
    welcome: ['欢迎回来', 'Let us play', '又是挖矿的一天', 'Ready when you are'],
    lowhp: ['血量偏低，注意撤退', '危险！', 'Heal up', '先补一口'],
    afk: ['离开一会儿', '挂机中', 'AFK', '暂时不在'],
    found: ['发现目标', '有东西', 'Target acquired', '看那边'],
    warn: ['注意脚下', '小心', 'Careful', '别掉下去'],
    done: ['搞定', '完成', 'Done', '收工'],
  };
  const EXT_KEY_GUIDE = [
    ['悬浮标签面板', 'Backquote（默认，可重绑）', '开关彗星式分类面板'],
    ['经典面板', 'Insert / ScrollLock', '开关 400x250 设置台'],
    ['大地图', 'M', '全屏 Xaero 式地图'],
    ['关闭面板 / 地图', 'Escape', '逐层退出'],
    ['编辑 HUD 位置', '配置 → 编辑位置', '拖动后点提示条完成'],
    ['缩放（需开模块）', 'KeyC（可改）', '按住放大视野'],
    ['折叠悬浮分类', '右键分类标题', '折成一条标签'],
    ['打开模块设置', '右键模块行', '或点行尾齿轮'],
    ['绑定模块快捷键', '中键模块行 → 按键', 'Delete 清除'],
    ['搜索模块', '面板右上搜索框', '按中文名 / 英文名过滤'],
  ];
  const EXT_BLOCK_CHEATSHEET = [
    ['1', 'stone', '石头', '镐'], ['2', 'grass_block', '草方块', '锹'],
    ['3', 'dirt', '泥土', '锹'], ['4', 'cobblestone', '圆石', '镐'],
    ['5', 'oak_planks', '木板', '斧'], ['7', 'bedrock', '基岩', '不可破坏'],
    ['12', 'sand', '沙子', '锹'], ['13', 'gravel', '砂砾', '锹'],
    ['14', 'gold_ore', '金矿石', '镐'], ['15', 'iron_ore', '铁矿石', '镐'],
    ['16', 'coal_ore', '煤矿石', '镐'], ['17', 'oak_log', '原木', '斧'],
    ['21', 'lapis_ore', '青金石矿石', '镐'], ['49', 'obsidian', '黑曜石', '钻石镐'],
    ['56', 'diamond_ore', '钻石矿石', '铁镐以上'], ['73', 'redstone_ore', '红石矿石', '铁镐'],
    ['129', 'emerald_ore', '绿宝石矿石', '铁镐'], ['153', 'nether_quartz_ore', '石英矿石', '镐'],
  ];
  const EXT_BIOME_TIPS = {
    plains: '平坦，适合建家', forest: '木材多，视野差', desert: '无雨，沙子多',
    taiga: '会下雪，有狼', savanna: '干燥，有马', jungle: '藤蔓多，视野差',
    swamp: '有史莱姆，水多', mountains: '高处易摔，矿多', ocean: '水下注意氧气',
    nether: '岩浆与恶魂，别乱挖', the_end: '末影龙与潜影贝',
  };

  // ---- 模块 D 组 ----
  const EXT_MODULES_D = [
    {
      id: 'damageindicator', name: 'DamageIndicator', cn: '受伤方向', cat: 'combat',
      desc: '受伤时在屏幕边缘标出伤害来源方向',
      settings: [
        { id: 'time', name: 'Duration', cn: '显示时长', type: 'slider', min: 500, max: 4000, step: 250, value: 1800 },
        { id: 'color', name: 'Color', cn: '颜色', type: 'color', value: '', desc: '留空 = 红色' },
      ],
    },
    {
      id: 'blockhistory', name: 'BlockHistory', cn: '方块变化记录', cat: 'misc',
      desc: '记录准星指向过的不同方块，按发现顺序排列',
      settings: [
        { id: 'max', name: 'Max', cn: '保留条数', type: 'slider', min: 5, max: 40, step: 5, value: 12 },
        { id: 'clear', name: 'Clear', cn: '清空记录', type: 'button' },
      ],
    },
    {
      id: 'chatlog', name: 'ChatLog', cn: '聊天记录', cat: 'misc',
      desc: '记录最近的系统提示与聊天文字（若游戏暴露）',
      settings: [
        { id: 'max', name: 'Max', cn: '保留条数', type: 'slider', min: 5, max: 40, step: 5, value: 15 },
        { id: 'clear', name: 'Clear', cn: '清空', type: 'button' },
      ],
    },
    {
      id: 'orestats', name: 'OreStats', cn: '挖矿统计', cat: 'misc',
      desc: '统计本次见过的矿石种类与数量',
      settings: [
        { id: 'show', name: 'Show', cn: '显示面板', type: 'checkbox', value: true },
        { id: 'reset', name: 'Reset', cn: '重置', type: 'button' },
      ],
    },
    {
      id: 'playtimewarn', name: 'PlaytimeWarn', cn: '时长提醒', cat: 'misc',
      desc: '连续游玩到设定时间提醒休息',
      settings: [
        { id: 'minutes', name: 'Minutes', cn: '提醒分钟', type: 'slider', min: 10, max: 180, step: 10, value: 60 },
      ],
    },
    {
      id: 'fpswarn', name: 'FPSWarn', cn: '掉帧提醒', cat: 'misc',
      desc: '帧率持续低于阈值时提示关掉一些特效',
      settings: [
        { id: 'threshold', name: 'Threshold', cn: '阈值', type: 'slider', min: 10, max: 55, step: 5, value: 25 },
      ],
    },
    {
      id: 'notes', name: 'Notes', cn: '随身边签', cat: 'configs',
      desc: '一小块可编辑文字，随配置备份保存',
      settings: [
        { id: 'text', name: 'Text', cn: '内容', type: 'text', value: '在这里记点东西' },
        { id: 'show', name: 'Show', cn: '显示面板', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'screenshot', name: 'Screenshot', cn: '截图', cat: 'configs',
      desc: '把游戏画面与 HUD 叠加导出成 PNG',
      settings: [
        { id: 'take', name: 'Take', cn: '立即截图', type: 'button' },
        { id: 'hud', name: 'With HUD', cn: '包含 HUD 层', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'resource', name: 'Resource', cn: '资源用量', cat: 'configs',
      desc: '显示脚本估计的内存与实体开销',
      settings: [
        { id: 'show', name: 'Show', cn: '显示面板', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'entitytrail', name: 'EntityTrail', cn: '实体轨迹', cat: 'render',
      desc: '给最近的几个生物画一小段移动轨迹',
      settings: [
        { id: 'count', name: 'Count', cn: '实体数', type: 'slider', min: 1, max: 12, step: 1, value: 4 },
        { id: 'length', name: 'Length', cn: '轨迹长度', type: 'slider', min: 4, max: 30, step: 2, value: 12 },
      ],
    },
    {
      id: 'autogg', name: 'AutoGG', cn: '进服问候', cat: 'misc',
      desc: '进入世界几秒后发一句问候（可自定义）',
      settings: [
        { id: 'text', name: 'Text', cn: '内容', type: 'text', value: '大家好' },
        { id: 'delay', name: 'Delay', cn: '延迟秒数', type: 'slider', min: 1, max: 20, step: 1, value: 4 },
      ],
    },
    {
      id: 'selftest', name: 'SelfTest', cn: '模块自检', cat: 'configs',
      desc: '检查所有模块的注册、设置与动作接线是否完整',
      settings: [
        { id: 'run', name: 'Run', cn: '运行自检', type: 'button' },
        { id: 'open', name: 'Report', cn: '查看报告', type: 'button' },
      ],
    },
  ];
  for (const em of EXT_MODULES_D) {
    MODULES.push(em);
    MODS_BY_ID[em.id] = em;
    if (cfg.states[em.id] === undefined) cfg.states[em.id] = !!em.state;
  }

  const extD = {
    hurtDirs: [], lastHp: null, blockSeen: [], chatSeen: [], oreSeen: new Map(),
    warnedAt: 0, fpsLowSince: 0, enteredAt: 0, ggSent: false,
    entityTrails: new Map(), selfTest: null, lastScreenshot: 0,
  };

  // ---- 受伤方向 ----
  function extTrackHurt(p) {
    if (!extOn('damageindicator')) return;
    const hp = num(p, 'health');
    if (!extUtil.isNum(hp)) return;
    if (extD.lastHp != null && hp < extD.lastHp) {
      const yaw = num(p, 'yaw') || 0;
      extD.hurtDirs.push({ at: performance.now(), yaw, amount: extD.lastHp - hp });
      if (extD.hurtDirs.length > 6) extD.hurtDirs.shift();
    }
    extD.lastHp = hp;
  }
  function extDrawHurtDirs(p, W_, H_) {
    if (!extOn('damageindicator')) return;
    const dur = Math.max(500, Number(extVal('damageindicator.time', 1800)) || 1800);
    const color = String(extVal('damageindicator.color', '') || '').trim() || '#ff5f6d';
    const now = performance.now();
    const yaw = num(p, 'yaw') || 0;
    const ctx = ectx;
    ctx.save();
    for (const h of extD.hurtDirs) {
      const age = now - h.at;
      if (age > dur) continue;
      let d = h.yaw - yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const ang = d;
      const rad = Math.min(W_, H_) * 0.38;
      const x = W_ / 2 + Math.sin(ang) * rad;
      const y = H_ / 2 - Math.cos(ang) * rad;
      const a = 1 - age / dur;
      ctx.fillStyle = hexToRgba(color, a * 0.8);
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = hexToRgba(color, a);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 12 * (1 + age / dur), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    extD.hurtDirs = extD.hurtDirs.filter((h) => now - h.at < dur);
  }

  // ---- 方块变化记录 ----
  function extTrackBlock(g) {
    if (!extOn('blockhistory')) return;
    const b = extTargetBlock(g);
    if (!b || b.id == null) return;
    const key = String(b.id);
    if (extD.blockSeen.some((x) => x.key === key)) return;
    extD.blockSeen.unshift({ key, name: b.name, at: extUtil.shortClock(performance.now() - ext.startedAt) });
    const max = Math.max(5, Number(extVal('blockhistory.max', 12)) || 12);
    if (extD.blockSeen.length > max) extD.blockSeen.length = max;
  }
  function extTrackChat(g) {
    if (!extOn('chatlog')) return;
    try {
      const ui = g && g.ui;
      const msgs = ui && (ui.chat || ui.messages || ui.chatLog);
      if (!Array.isArray(msgs)) return;
      const last = msgs[msgs.length - 1];
      const text = typeof last === 'string' ? last : (last && (last.text || last.msg || last.message));
      if (!text) return;
      const s = String(text).slice(0, 120);
      if (extD.chatSeen[0] === s) return;
      extD.chatSeen.unshift(s);
      const max = Math.max(5, Number(extVal('chatlog.max', 15)) || 15);
      if (extD.chatSeen.length > max) extD.chatSeen.length = max;
    } catch (e) { /* noop */ }
  }
  function extTrackOre(g, p) {
    if (!extOn('orestats')) return;
    const c = playerCenter(p, 1);
    const w = g && g.world;
    if (!c || !w || typeof w.getBlock !== 'function') return;
    try {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            const id = w.getBlock(Math.floor(c[0]) + dx, Math.floor(c[1]) + dy, Math.floor(c[2]) + dz);
            const d = W.BLOCK_DATA && W.BLOCK_DATA[id];
            const k = d && String(d.key || '');
            if (!k || k.indexOf('ore') < 0) continue;
            const cur = extD.oreSeen.get(k) || 0;
            extD.oreSeen.set(k, cur + 1);
          }
        }
      }
    } catch (e) { /* noop */ }
  }

  // ---- 提醒类 ----
  function extWarnings(g, p) {
    const now = performance.now();
    if (extOn('playtimewarn') && now - extD.warnedAt > 60000) {
      const mins = Math.max(10, Number(extVal('playtimewarn.minutes', 60)) || 60);
      if ((now - ext.startedAt) / 60000 >= mins) {
        extD.warnedAt = now;
        pushNotification('休息一下', '已经连续玩了 ' + mins + ' 分钟');
        extLog('连续游玩提醒：' + mins + ' 分钟', 'info');
      }
    }
    if (extOn('fpswarn')) {
      const fps = num(g, 'fps');
      const th = Math.max(10, Number(extVal('fpswarn.threshold', 25)) || 25);
      if (extUtil.isNum(fps) && fps < th) {
        if (!extD.fpsLowSince) extD.fpsLowSince = now;
        else if (now - extD.fpsLowSince > 5000) {
          extD.fpsLowSince = 0;
          pushNotification('帧率偏低', '试试性能优化模块的「省电」档');
          extLog('FPS 持续低于 ' + th, 'info');
        }
      } else extD.fpsLowSince = 0;
    }
    if (extOn('autogg') && !extD.ggSent) {
      if (!extD.enteredAt) extD.enteredAt = now;
      const delay = Math.max(1, Number(extVal('autogg.delay', 4)) || 4) * 1000;
      if (now - extD.enteredAt > delay) {
        extD.ggSent = true;
        const txt = String(extVal('autogg.text', '大家好') || '').trim();
        if (txt) {
          extLog('进服问候：' + txt, 'macro');
          try {
            if (g.net && typeof g.net.send === 'function') g.net.send({ t: 'chat', text: txt });
            else if (typeof g.chat === 'function') g.chat(txt);
          } catch (e) { /* noop */ }
        }
      }
    }
    extTrackHurt(p);
    extTrackBlock(g);
    extTrackChat(g);
    if (now % 1000 < 260) extTrackOre(g, p);
  }

  // ---- 实体轨迹 ----
  function extEntityTrails(g, p, W_, H_, alpha) {
    if (!extOn('entitytrail')) { extD.entityTrails.clear(); return; }
    const c = playerCenter(p, alpha);
    if (!c || !Array.isArray(g.entities)) return;
    const maxEnts = Math.max(1, Number(extVal('entitytrail.count', 4)) || 4);
    const len = Math.max(4, Number(extVal('entitytrail.length', 12)) || 12);
    let used = 0;
    const ctx = ectx;
    ctx.save();
    for (const e of g.entities) {
      if (used >= maxEnts) break;
      if (!e || e === p || e.dead || e.health == null) continue;
      let q = null;
      try { q = (typeof e.ipos === 'function') ? e.ipos(alpha == null ? 1 : alpha) : null; } catch (err) { /* noop */ }
      if (!q || typeof q[0] !== 'number') q = Array.isArray(e.pos) ? e.pos : null;
      if (!q || extUtil.dist(q, c) > 48) continue;
      let trail = extD.entityTrails.get(e);
      if (!trail) { trail = []; extD.entityTrails.set(e, trail); }
      const last = trail[trail.length - 1];
      if (!last || extUtil.dist(q, last) > 0.04) {
        trail.push([q[0], q[1] + 0.05, q[2]]);
        if (trail.length > len) trail.shift();
      }
      if (trail.length < 2) continue;
      const col = (e.T && e.T.hostile) ? '#ff5f6d' : '#4fc3f7';
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < trail.length; i++) {
        const sp = project(rGlobalCache(), trail[i][0], trail[i][1], trail[i][2], W_, H_);
        if (!sp) { started = false; continue; }
        if (!started) { ctx.moveTo(sp.x, sp.y); started = true; }
        else ctx.lineTo(sp.x, sp.y);
      }
      ctx.stroke();
      used++;
    }
    ctx.restore();
  }
  let __extRendererCache = null;
  function rGlobalCache() {
    if (!__extRendererCache && state.game) __extRendererCache = state.game.renderer;
    return __extRendererCache || (state.game && state.game.renderer) || { vp: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 10] };
  }

  // ---- 截图 ----
  function extScreenshot() {
    try {
      const withHud = extVal('screenshot.hud', true) !== false;
      const gl = document.querySelector('#gl');
      const W0 = (gl && gl.width) || 1280;
      const H0 = (gl && gl.height) || 720;
      const cv = document.createElement('canvas');
      cv.width = W0; cv.height = H0;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#0b1018';
      cx.fillRect(0, 0, W0, H0);
      if (gl && gl.drawImage !== undefined) { /* canvas 元素走下面的 drawImage */ }
      try { if (gl) cx.drawImage(gl, 0, 0, W0, H0); } catch (e) { /* noop */ }
      try { cx.drawImage(espCanvas, 0, 0, W0, H0); } catch (e) { /* noop */ }
      if (withHud) {
        const ui = document.querySelector('#ui');
        try { if (ui) cx.drawImage(ui, 0, 0, W0, H0); } catch (e) { /* noop */ }
      }
      const url = cv.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'opus-hud-' + Date.now() + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      extD.lastScreenshot = performance.now();
      extLog('截图已保存', 'info');
      pushNotification('截图', 'PNG 已导出');
    } catch (e) { pushNotification('截图', '导出失败：' + e.message); }
  }

  // ---- 模块自检 ----
  function extSelfTest() {
    const problems = [];
    const ids = new Set();
    // 没逐条写说明的模块用自身描述兜底，帮助中心不会留空白
    for (const m of MODULES) {
      if (!EXT_MODULE_DOCS[m.id]) {
        EXT_MODULE_DOCS[m.id] = { what: m.desc, when: '按需开启', tip: '参数可在模块设置里调整' };
      }
    }
    for (const m of MODULES) {
      if (!m.id || !m.name || !m.cn || !m.cat) problems.push('模块字段缺失：' + (m.id || '?'));
      if (ids.has(m.id)) problems.push('模块 id 重复：' + m.id);
      ids.add(m.id);
      if (MODS_BY_ID[m.id] !== m) problems.push('索引未同步：' + m.id);
      if (cfg.states[m.id] === undefined) problems.push('开关未初始化：' + m.id);
      const sids = new Set();
      for (const s of (m.settings || [])) {
        if (!s.id || !s.cn) problems.push('设置字段缺失：' + m.id);
        if (sids.has(s.id)) problems.push('设置 id 重复：' + m.id + '.' + s.id);
        sids.add(s.id);
        const allowed = ['slider', 'checkbox', 'select', 'multi', 'color', 'text', 'button'];
        if (allowed.indexOf(s.type) < 0) problems.push('未知设置类型：' + m.id + '.' + s.id + ' = ' + s.type);
        if (s.type === 'slider' && !(s.min < s.max)) problems.push('滑块范围异常：' + m.id + '.' + s.id);
        // 下拉选项允许静态数组，也允许动态函数（如 server.server 读服务器列表）
        if (s.type === 'select') {
          const opts = typeof s.options === 'function' ? s.options() : s.options;
          if (!Array.isArray(opts) || !opts.length) {
            problems.push('下拉缺少选项：' + m.id + '.' + s.id);
          }
        }
      }
    }
    for (const cat of CATS) {
      if (!MODULES.some((m) => m.cat === cat.id)) problems.push('分类下无模块：' + cat.name);
    }
    // 接线检查直接看函数是否存在，比拼函数源码字符串可靠
    const fns = {
      extTick, extTickB, extTickC, extTickD, extRenderB, extRenderC, extRenderD,
      extRenderE, extHud, extHudB, extHudC, extHudD, extHudE, helperRender,
      extDropBoxes, extHealthCheck, extExportStats, extScreenshot, extQuickToggle,
    };
    for (const k of Object.keys(fns)) {
      if (typeof fns[k] !== 'function') problems.push('函数缺失：' + k);
    }
    const report = {
      at: extUtil.nowISO(), version: VERSION,
      modules: MODULES.length, settings: MODULES.reduce((n, m) => n + (m.settings || []).length, 0),
      docs: Object.keys(EXT_MODULE_DOCS).length,
      undocumented: MODULES.filter((m) => !EXT_MODULE_DOCS[m.id]).map((m) => m.id),
      problems,
    };
    extD.selfTest = report;
    extLog('模块自检：' + (problems.length ? problems.length + ' 项异常' : '全部通过'), 'profile');
    return report;
  }

  // ---- D 组 tick / render ----
  function extTickD(g, p) { extWarnings(g, p); }
  function extRenderD(r, p, W_, H_, alpha) {
    __extRendererCache = r;
    extDrawHurtDirs(p, W_, H_);
    extEntityTrails(state.game || {}, p, W_, H_, alpha);
  }
  function extHudD() {
    const orelog = extSections.orelog, resource = extSections.resource;
    if (!orelog || !resource) return false;
    let html = '';
    if (extOn('orestats') && extVal('orestats.show', true) !== false) {
      html += '<div class="cm-exttitle">挖矿统计</div>';
      const entries = Array.from(extD.oreSeen.entries()).slice(0, 8);
      for (const [k, v] of entries) {
        const d = BLOCK_HINT[k] || {};
        html += extHtmlRow(d.cn || k, String(v));
      }
      if (!entries.length) html += '<div class="cm-extempty">还没遇到矿石</div>';
    }
    if (extOn('blockhistory') && extD.blockSeen.length) {
      html += '<div class="cm-exttitle">方块记录</div>';
      for (const b of extD.blockSeen.slice(0, 6)) html += extHtmlRow(b.name, b.at);
    }
    if (extOn('chatlog') && extD.chatSeen.length) {
      html += '<div class="cm-exttitle">聊天记录</div>';
      for (const s of extD.chatSeen.slice(0, 5)) {
        html += '<div class="cm-extrow"><span class="cm-extv">' + escHtml(extUtil.truncate(s, 26)) + '</span></div>';
      }
    }
    let res = '';
    const noteOn = extOn('notes') && extVal('notes.show', false) !== false;
    const resOn = extOn('resource') && extVal('resource.show', false) !== false;
    if (noteOn) {
      const t = String(extVal('notes.text', '') || '').trim();
      res += '<div class="cm-exttitle">随身边签</div>';
      if (t) {
        for (const line of extUtil.splitLines(t).slice(0, 6)) {
          res += '<div class="cm-extrow"><span class="cm-extv">' + escHtml(line) + '</span></div>';
        }
      } else {
        res += '<div class="cm-extempty">在设置里写点什么</div>';
      }
    }
    if (resOn) {
      res += '<div class="cm-exttitle">资源占用</div>';
      const mem = (typeof performance.memory === 'object' && performance.memory)
        ? performance.memory.usedJSHeapSize : null;
      res += extHtmlRow('JS 堆', mem ? extUtil.bytes(mem) : '浏览器不提供');
      res += extHtmlRow('实体', String((state.game && state.game.entities || []).length));
      res += extHtmlRow('模块', String(MODULES.length));
      res += extHtmlRow('路径点', String((cfg.waypoints || []).length));
      res += extHtmlRow('设置项', String(Object.keys(cfg.settings || {}).length));
    }
    orelog.innerHTML = html;
    resource.innerHTML = res;
    return !!(html || res);
  }

  // ---- 帮助中心追加「速查 / 自检」标签 ----
  const tabCheat = mk('div', 'cm-hptab', '速查表');
  const tabTest = mk('div', 'cm-hptab', '自检');
  hTabs.append(tabCheat, tabTest);
  tabCheat.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    hTab = 'cheat';
    for (const t of [tabHelp, tabKeys, tabCheck, tabCheat, tabTest]) t.classList.toggle('on', t === tabCheat);
    helperRender();
  });
  tabTest.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    hTab = 'test';
    for (const t of [tabHelp, tabKeys, tabCheck, tabCheat, tabTest]) t.classList.toggle('on', t === tabTest);
    helperRender();
  });
  for (const t of [tabHelp, tabKeys, tabCheck]) {
    t.addEventListener('mousedown', () => {
      for (const x of [tabHelp, tabKeys, tabCheck, tabCheat, tabTest]) x.classList.toggle('on', x === t);
    });
  }

  const __helperRenderBase = helperRender;
  helperRender = function () {
    if (hTab === 'cheat') {
      let html = '<div class="cm-hpcat">快捷键</div>';
      for (const [n, k, d] of EXT_KEY_GUIDE) {
        html += '<div class="cm-hpkeyrow"><span>' + extUtil.escape(n) + '</span>'
          + '<span class="cm-hpkey">' + extUtil.escape(k) + '</span></div>'
          + '<div class="cm-hpmeta">' + extUtil.escape(d) + '</div>';
      }
      html += '<div class="cm-hpcat">常见方块速查</div>';
      for (const [id, key, cn, tool] of EXT_BLOCK_CHEATSHEET) {
        html += '<div class="cm-hpkeyrow"><span>' + cn + ' <span class="cm-hpid">'
          + key + '</span></span><span class="cm-hpkey">' + tool + '</span></div>';
      }
      html += '<div class="cm-hpcat">群系提示</div>';
      for (const k of Object.keys(EXT_BIOME_TIPS)) {
        html += extHtmlRow(BIOME_CN[k] || k, EXT_BIOME_TIPS[k]);
      }
      hBody.innerHTML = html;
      return;
    }
    if (hTab === 'test') {
      const r = extSelfTest();
      let html = '<div class="cm-hpcat">模块自检</div>';
      const rows = [['脚本版本', r.version], ['模块总数', r.modules],
        ['设置项', r.settings], ['说明条目', r.docs], ['异常', r.problems.length]];
      for (const [n, v] of rows) {
        html += '<div class="cm-hpkeyrow"><span>' + n + '</span><span class="cm-hpkey">' + v + '</span></div>';
      }
      if (r.problems.length) {
        html += '<div class="cm-hpcat">异常明细</div>';
        for (const p of r.problems) html += '<div class="cm-hptip">' + extUtil.escape(p) + '</div>';
      } else html += '<div class="cm-hpok">所有模块注册与设置项检查通过</div>';
      if (r.undocumented.length) {
        html += '<div class="cm-hpcat">未写详细说明的模块</div>';
        html += '<div class="cm-hpmeta">' + r.undocumented.map(extUtil.escape).join(' / ') + '</div>';
      }
      hBody.innerHTML = html;
      return;
    }
    __helperRenderBase();
  };

  // ==========================================================================
  // 扩展模块包（五）：引导 / 描边 / 信息 / 快捷操作
  // ==========================================================================

  // ---- 常用指令速查（帮助中心「速查表」用） ----
  const EXT_COMMAND_GUIDE = [
    ['/tp <x> <y> <z>', '传送到坐标', '需要权限'],
    ['/gamemode survival', '切生存', '需要权限'],
    ['/gamemode creative', '切创造', '需要权限'],
    ['/time set day', '设为白天', '需要权限'],
    ['/weather clear', '放晴', '需要权限'],
    ['/give <player> <item>', '给物品', '需要权限'],
    ['/sethome', '设家', '看服务器'],
    ['/home', '回家', '看服务器'],
    ['/spawn', '回出生点', '看服务器'],
    ['/tpa <player>', '请求传送', '看服务器'],
    ['/tpaccept', '接受传送', '看服务器'],
    ['/msg <player> <text>', '私聊', '通用'],
    ['/list', '在线列表', '通用'],
    ['/help', '帮助', '通用'],
    ['/seed', '查种子', '需要权限'],
    ['/clear', '清空背包', '需要权限'],
    ['/effect <player> <id>', '给药水', '需要权限'],
    ['/enchant <id> <level>', '附魔', '需要权限'],
    ['/summon <entity>', '召唤实体', '需要权限'],
    ['/kill', '自杀', '慎用'],
  ];

  const EXT_MODULES_E = [
    {
      id: 'waypointline', name: 'WaypointLine', cn: '路径点引导线', cat: 'render',
      desc: '从准星画一条线指向最近的路径点',
      settings: [
        { id: 'color', name: 'Color', cn: '线颜色', type: 'color', value: '', desc: '留空 = 跟随路径点颜色' },
        { id: 'width', name: 'Width', cn: '线宽', type: 'slider', min: 1, max: 6, step: 0.5, value: 2 },
      ],
    },
    {
      id: 'blockoutline', name: 'BlockOutline', cn: '准星方块描边', cat: 'render',
      desc: '给准星指向的方块画一圈精细描边',
      settings: [
        { id: 'color', name: 'Color', cn: '颜色', type: 'color', value: '', desc: '留空 = 白色' },
        { id: 'width', name: 'Width', cn: '线宽', type: 'slider', min: 1, max: 5, step: 0.5, value: 1.5 },
      ],
    },
    {
      id: 'entityinfo', name: 'EntityInfo', cn: '准星实体信息', cat: 'misc',
      desc: '准星指向生物时显示名字 / 血量 / 距离',
      settings: [
        { id: 'show', name: 'Show', cn: '显示面板', type: 'checkbox', value: true },
      ],
    },
    {
      id: 'healthbar', name: 'WorldHealthBar', cn: '世界内血条', cat: 'render',
      desc: '在生物头顶再叠一条细血条',
      settings: [
        { id: 'width', name: 'Width', cn: '宽度', type: 'slider', min: 16, max: 64, step: 4, value: 32 },
        { id: 'color', name: 'Color', cn: '颜色', type: 'color', value: '', desc: '留空 = 绿色' },
      ],
    },
    {
      id: 'quicktoggle', name: 'QuickToggle', cn: '一键关特效', cat: 'configs',
      desc: '临时关掉所有渲染类模块，再点一次恢复',
      settings: [
        { id: 'run', name: 'Toggle', cn: '切换', type: 'button' },
        { id: 'status', name: 'Status', cn: '当前状态', type: 'text', value: '正常' },
      ],
    },
    {
      id: 'guide', name: 'QuickGuide', cn: '指令速查', cat: 'configs',
      desc: '在帮助中心显示常用指令表',
      settings: [
        { id: 'open', name: 'Open', cn: '查看指令', type: 'button' },
      ],
    },
  ];
  for (const em of EXT_MODULES_E) {
    MODULES.push(em);
    MODS_BY_ID[em.id] = em;
    if (cfg.states[em.id] === undefined) cfg.states[em.id] = !!em.state;
  }

  const extE = { savedStates: null, lastEntity: null, guideTab: false };

  // ---- 路径点引导线 ----
  function extWaypointLine(r, p, W_, H_) {
    if (!extOn('waypointline')) return;
    const list = cfg.waypoints || [];
    if (!list.length) return;
    const c = playerCenter(p, 1);
    if (!c) return;
    let best = null, bd = Infinity;
    for (const w of list) {
      const d = extUtil.dist2d([w.x, 0, w.z], c);
      if (d < bd) { bd = d; best = w; }
    }
    if (!best) return;
    const q = project(r, best.x, best.y + 0.5, best.z, W_, H_);
    if (!q) return;
    const color = String(extVal('waypointline.color', '') || '').trim() || best.color || '#ff5f6d';
    const ctx = ectx;
    ctx.save();
    ctx.strokeStyle = hexToRgba(color, 0.75);
    ctx.lineWidth = Math.max(1, Number(extVal('waypointline.width', 2)) || 2);
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(W_ / 2, H_ / 2);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = hexToRgba(color, 0.9);
    ctx.font = '700 12px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(best.name + ' ' + Math.round(bd) + 'm', q.x, q.y - 10);
    ctx.restore();
  }

  // ---- 准星方块描边 ----
  function extBlockOutline(r, g, W_, H_) {
    if (!extOn('blockoutline')) return;
    const t = g && g.target;
    if (!t || !Array.isArray(t.pos)) return;
    const x = Math.floor(t.pos[0]), y = Math.floor(t.pos[1]), z = Math.floor(t.pos[2]);
    const cs = [];
    for (let i = 0; i < 8; i++) {
      const q = project(r, x + (i & 1 ? 1 : 0), y + (i & 2 ? 1 : 0), z + (i & 4 ? 1 : 0), W_, H_);
      if (!q) return;
      cs.push(q);
    }
    const color = String(extVal('blockoutline.color', '') || '').trim() || '#ffffff';
    const ctx = ectx;
    ctx.save();
    ctx.strokeStyle = hexToRgba(color, 0.9);
    ctx.lineWidth = Math.max(1, Number(extVal('blockoutline.width', 1.5)) || 1.5);
    ctx.beginPath();
    for (const ed of [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6],
      [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]]) {
      ctx.moveTo(cs[ed[0]].x, cs[ed[0]].y);
      ctx.lineTo(cs[ed[1]].x, cs[ed[1]].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---- 准星实体信息 ----
  function extFocusEntity(g, p) {
    const e = g && (g.targetEntity || g.target);
    if (!e || e === p) return null;
    const q = Array.isArray(e.pos) ? e.pos : null;
    if (!q) return null;
    const c = playerCenter(p, 1);
    return {
      name: cnName(e),
      hp: num(e, 'health'),
      max: num(e, 'maxHealth'),
      dist: c ? extUtil.dist(q, c) : 0,
      hostile: !!(e.T && e.T.hostile),
    };
  }
  function extHudE() {
    const g = state.game || {}, p = state.player || {};
    const sec = extSections.entity;
    if (!sec) return false;
    let html = '';
    if (extOn('entityinfo') && extVal('entityinfo.show', true) !== false) {
      const f = extFocusEntity(g, p);
      if (f) {
        html += '<div class="cm-exttitle">准星实体</div>';
        html += extHtmlRow('名称', f.name);
        html += extHtmlRow('血量', (f.hp != null ? f.hp.toFixed(1) : '--') + ' / ' + (f.max != null ? f.max : '--'));
        html += extHtmlRow('距离', f.dist.toFixed(1) + ' m');
        html += extHtmlRow('阵营', f.hostile ? '敌对' : '被动');
      }
    }
    if (extOn('quicktoggle') && extE.savedStates) {
      html += '<div class="cm-exttitle">特效已临时关闭</div>';
    }
    sec.innerHTML = html;
    return !!html;
  }

  // ---- 世界内血条 ----
  function extWorldHealthBars(r, p, W_, H_, alpha) {
    if (!extOn('healthbar')) return;
    const g = state.game;
    if (!g || !Array.isArray(g.entities)) return;
    const c = playerCenter(p, alpha);
    if (!c) return;
    const width = Math.max(16, Number(extVal('healthbar.width', 32)) || 32);
    const color = String(extVal('healthbar.color', '') || '').trim() || '#6ee7a5';
    const ctx = ectx;
    ctx.save();
    let drawn = 0;
    for (const e of g.entities) {
      if (drawn >= 30) break;
      if (!e || e === p || e.dead || e.health == null || e.maxHealth == null) continue;
      let q = null;
      try { q = (typeof e.ipos === 'function') ? e.ipos(alpha == null ? 1 : alpha) : null; } catch (err) { /* noop */ }
      if (!q) q = Array.isArray(e.pos) ? e.pos : null;
      if (!q || extUtil.dist(q, c) > 48) continue;
      const h = num(e, 'h') || 1.8;
      const sp = project(r, q[0], q[1] + h + 0.28, q[2], W_, H_);
      if (!sp) continue;
      const pct = extUtil.clamp(e.health / (e.maxHealth || 20), 0, 1);
      const x0 = sp.x - width / 2, y0 = sp.y;
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(x0 - 1, y0 - 1, width + 2, 5);
      ctx.fillStyle = hexToRgba(color, 0.9);
      ctx.fillRect(x0, y0, width * pct, 3);
      drawn++;
    }
    ctx.restore();
  }

  // ---- 一键关特效 ----
  const QUICK_RENDER_IDS = ['esp', 'tracers', 'nametags', 'itemesp', 'targetesp',
    'projectile', 'waypoints', 'minimap', 'trail', 'targetring', 'xray',
    'blockesp', 'chunkborder', 'lightoverlay', 'crosshair', 'damageindicator',
    'entitytrail', 'waypointline', 'blockoutline', 'healthbar', 'mblur'];
  function extQuickToggle() {
    if (extE.savedStates) {
      for (const id of Object.keys(extE.savedStates)) cfg.states[id] = extE.savedStates[id];
      extE.savedStates = null;
      cfg.settings['quicktoggle.status'] = '正常';
      pushNotification('一键关特效', '已恢复原有开关');
    } else {
      extE.savedStates = {};
      for (const id of QUICK_RENDER_IDS) {
        extE.savedStates[id] = !!cfg.states[id];
        cfg.states[id] = false;
      }
      cfg.settings['quicktoggle.status'] = '已临时关闭渲染类模块';
      pushNotification('一键关特效', '渲染类模块已临时关闭');
    }
    __sCache = null;
    saveCfg();
    refreshGui();
    refreshHud();
    extLog('一键关特效：' + (extE.savedStates ? '关闭' : '恢复'), 'profile');
  }

  function extRenderE(r, p, W_, H_, alpha) {
    extWaypointLine(r, p, W_, H_);
    extBlockOutline(r, state.game || {}, W_, H_);
    extWorldHealthBars(r, p, W_, H_, alpha);
  }

  // ---- 帮助中心「指令速查」标签 ----
  const tabGuide = mk('div', 'cm-hptab', '指令');
  hTabs.append(tabGuide);
  tabGuide.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    hTab = 'guide';
    for (const x of [tabHelp, tabKeys, tabCheck, tabCheat, tabTest, tabGuide]) x.classList.toggle('on', x === tabGuide);
    helperRender();
  });
  const __helperRenderD = helperRender;
  helperRender = function () {
    if (hTab === 'guide') {
      let html = '<div class="cm-hpcat">常用指令</div>';
      for (const [cmd, desc, note] of EXT_COMMAND_GUIDE) {
        html += '<div class="cm-hpkeyrow"><span class="cm-hpkey">' + extUtil.escape(cmd)
          + '</span><span>' + extUtil.escape(desc) + '</span></div>';
        html += '<div class="cm-hpmeta">' + extUtil.escape(note) + '</div>';
      }
      html += '<div class="cm-hpcat">配色参考</div>';
      for (const k of Object.keys(EXT_PALETTE)) {
        html += extHtmlRow(k, EXT_PALETTE[k]);
      }
      hBody.innerHTML = html;
      return;
    }
    __helperRenderD();
  };

  // ==========================================================================
  // 扩展模块包（六）：关于页
  // ==========================================================================
  {
    const about = {
      id: 'about', name: 'About', cn: '关于', cat: 'configs',
      desc: '查看脚本版本、模块数量与运行时信息',
      settings: [
        { id: 'open', name: 'Open', cn: '打开关于页', type: 'button' },
      ],
    };
    MODULES.push(about);
    MODS_BY_ID.about = about;
    if (cfg.states.about === undefined) cfg.states.about = false;
  }
  function extAboutInfo() {
    return {
      version: VERSION,
      modules: MODULES.length,
      settings: MODULES.reduce((n, m) => n + (m.settings || []).length, 0),
      docs: Object.keys(EXT_MODULE_DOCS).length,
      uptime: extDuration(),
      runtime: (typeof GM_info === 'object' && GM_info && GM_info.scriptHandler) || 'Tampermonkey',
    };
  }
  const tabAbout = mk('div', 'cm-hptab', '关于');
  hTabs.append(tabAbout);
  tabAbout.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    hTab = 'about';
    helperOpen(true);
    for (const x of hTabs.children) x.classList.toggle('on', x === tabAbout);
    helperRender();
  });
  const __helperRenderE = helperRender;
  helperRender = function () {
    if (hTab !== 'about') { __helperRenderE(); return; }
    const info = extAboutInfo();
    let html = '<div class="cm-hpcat">OpusMC 生存辅助</div>';
    const rows = [
      ['版本', info.version], ['模块总数', info.modules], ['设置项', info.settings],
      ['说明条目', info.docs], ['已运行', info.uptime], ['脚本管理器', info.runtime],
    ];
    for (const [n, v] of rows) {
      html += '<div class="cm-hpkeyrow"><span>' + n + '</span><span class="cm-hpkey">' + v + '</span></div>';
    }
    html += '<div class="cm-hpcat">说明</div>';
    html += '<div class="cm-hpmeta">本脚本只在浏览器里读取游戏运行时数据，不改动游戏源码与存档。</div>';
    html += '<div class="cm-hpmeta">ESP 类辅助仅限单人或自用服务器使用。</div>';
    html += '<div class="cm-hpmeta">音乐源来自 GD音乐台 music.gdstudio.xyz，仅供个人学习。</div>';
    html += '<div class="cm-hpok">配置可用「.opuscfg」完整备份与还原。</div>';
    hBody.innerHTML = html;
  };

  // ==========================================================================
  // 扩展模块包（六）结束
  // ==========================================================================

  // ==========================================================================
  // 容器 ESP：容器是方块实体（存在区块里），走 Chunk.findAll 扫描
  // ==========================================================================
  const CONTAINER_KINDS = [
    { id: 'ender', cn: '末影箱', re: /ender_chest/ },
    { id: 'shulker', cn: '潜影盒', re: /shulker_box/ },
    { id: 'copper', cn: '铜箱', re: /copper_chest/ },
    { id: 'chest', cn: '箱子', re: /chest/ },
    { id: 'barrel', cn: '木桶', re: /barrel/ },
    { id: 'blast', cn: '高炉', re: /blast_furnace/ },
    { id: 'smoker', cn: '烟熏炉', re: /smoker/ },
    { id: 'furnace', cn: '熔炉', re: /furnace/ },
    { id: 'dispenser', cn: '发射器', re: /dispenser/ },
    { id: 'dropper', cn: '投放器', re: /dropper/ },
    { id: 'hopper', cn: '漏斗', re: /hopper/ },
    {
      id: 'utility', cn: '工作站',
      re: /crafting_table|loom|grindstone|smithing_table|cartography_table|stonecutter|brewing_stand|lectern|composter|enchanting_table|anvil|beacon|jukebox|spawner|chiseled_bookshelf|decorated_pot|crafter/,
    },
  ];
  const CONTAINER_OTHER = { id: 'other', cn: '容器', re: /^$/ };
  const containerState = {
    ids: null, byId: null, keyById: null, hits: [], at: 0, key: '', lastCount: 0,
  };

  function containerKind(key) {
    const k = String(key || '');
    for (const kind of CONTAINER_KINDS) if (kind.re.test(k)) return kind;
    return CONTAINER_OTHER;
  }
  function containerTable() {
    // 线上 BLOCK_DATA 可能延迟挂载：空表绝不缓存，下次继续重建
    if (containerState.ids && containerState.ids.length) return containerState.ids;
    const ids = [], byId = new Map();
    const keyById = new Map();
    const src = Array.isArray(W.BLOCK_DATA) ? W.BLOCK_DATA : [];
    for (const d of src) {
      if (!d || d.id == null) continue;
      const k = String(d.key || '');
      keyById.set(d.id, k);
      if (!k) continue;
      const kind = containerKind(k);
      if (kind === CONTAINER_OTHER && !/storage|container|chest|barrel|furnace|hopper|shulker/i.test(k)) continue;
      ids.push(d.id);
      byId.set(d.id, kind);
    }
    containerState.ids = ids;
    containerState.byId = byId;
    containerState.keyById = keyById;
    return ids;
  }
  function containerColor(kind, which) {
    const v = String(getS('containeresp', (which === 'line' ? 't_' : 'f_') + kind.id) || '').trim();
    return v || (which === 'line' ? '#ffc857' : '#e8ecf4');
  }
  function scanContainers(g, p) {
    const c = playerCenter(p, 1);
    const w = g && g.world;
    if (!c || !w || !w.chunks) { containerState.hits = []; return; }
    const ids = containerTable();
    // ids 为空时仍走 ch.chests，不直接放弃
    const R = Math.max(8, Number(getS('containeresp', 'range')) || 40);
    const key = R + ':' + Math.floor(c[0] / 16) + ':' + Math.floor(c[2] / 16);
    const now = performance.now();
    if (key === containerState.key && now - containerState.at < 900) return;
    containerState.key = key;
    containerState.at = now;
    const out = [], R2 = R * R;
    const seen = new Set();
    const add = (x, y, z, idGuess) => {
      if (out.length >= 500) return;
      const dx = x - c[0], dz = z - c[2];
      if (dx * dx + dz * dz > R2) return;
      const sk = x + ',' + y + ',' + z;
      if (seen.has(sk)) return;
      seen.add(sk);
      let kind = null;
      try {
        const id = (typeof w.getBlock === 'function') ? w.getBlock(x, y, z) : idGuess;
        const key = containerState.keyById && containerState.keyById.get(id);
        if (key) kind = containerKind(key);
        if (!kind || kind === CONTAINER_OTHER) kind = containerState.byId.get(id) || kind;
      } catch (e) { /* noop */ }
      // 分类不到也画出来（宁可标「容器」，也不能漏掉普通箱子）
      out.push([x, y, z, kind || CONTAINER_OTHER]);
    };
    try {
      w.chunks.forEach((ch) => {
        if (!ch) return;
        const ox = ch.cx * 16, oz = ch.cz * 16;
        if (Math.abs(ox + 8 - c[0]) > R + 16 || Math.abs(oz + 8 - c[2]) > R + 16) return;
        // 游戏 blockents.js 每帧把全部方块实体坐标缓存进 ch.chests（[[x,y,z], ...]）
        if (Array.isArray(ch.chests) && ch.chests.length) {
          for (const q of ch.chests) add(q[0], q[1], q[2], -1);
        } else if (typeof ch.findAll === 'function') {
          ch.findAll(ids, (i, id) => {
            const cell = i & 4095;
            const s = i >> 12;
            add(ox + (cell & 15), s * 16 + ((cell >> 8) & 15), oz + ((cell >> 4) & 15), id);
          });
        }
      });
    } catch (e) { /* noop */ }
    out.sort((a, b) => (Math.hypot(a[0] - c[0], a[2] - c[2]) - Math.hypot(b[0] - c[0], b[2] - c[2])));
    containerState.hits = out;
    containerState.lastCount = out.length;
  }
  function drawContainerEsp(r, p, W_, H_, alpha) {
    if (!modOn('containeresp')) return;
    scanContainers(state.game, p);
    if (!containerState.hits.length) return;
    const c = playerCenter(p, alpha);
    if (!c) return;
    const R = Math.max(8, Number(getS('containeresp', 'range')) || 40);
    const lw = Math.max(1, Number(getS('containeresp', 'width')) || 1.6);
    const tracer = getS('containeresp', 'tracer') !== false;
    const labels = getS('containeresp', 'labels') !== false;
    const ctx = ectx;
    const EDGES = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6],
      [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '700 11px "Microsoft YaHei", sans-serif';
    for (const h of containerState.hits) {
      const kind = h[3];
      const dist = Math.hypot(h[0] - c[0], h[1] - c[1], h[2] - c[2]);
      if (dist > R) continue;
      const cs = [];
      let bad = false;
      for (let i = 0; i < 8; i++) {
        const q = project(r, h[0] + (i & 1 ? 1 : 0), h[1] + (i & 2 ? 1 : 0),
          h[2] + (i & 4 ? 1 : 0), W_, H_);
        if (!q || Math.abs(q.x) > W_ * 2 || Math.abs(q.y) > H_ * 2) { bad = true; break; }
        cs.push(q);
      }
      if (bad || cs.length < 8) continue;
      const xs = cs.map((q) => q.x), ys = cs.map((q) => q.y);
      const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
      const y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      if (x1 < 0 || x0 > W_ || y1 < 0 || y0 > H_) continue;
      const fade = Math.max(0.3, 1 - dist / (R * 1.3));
      const boxColor = containerColor(kind, 'box');
      const lineColor = containerColor(kind, 'line');
      ctx.strokeStyle = hexToRgba(boxColor, fade);
      ctx.fillStyle = hexToRgba(boxColor, 0.08 * fade);
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (const ed of EDGES) {
        ctx.moveTo(cs[ed[0]].x, cs[ed[0]].y);
        ctx.lineTo(cs[ed[1]].x, cs[ed[1]].y);
      }
      ctx.stroke();
      ctx.fillRect(x0, y0, Math.max(2, x1 - x0), Math.max(2, y1 - y0));
      if (tracer) {
        ctx.strokeStyle = hexToRgba(lineColor, fade * 0.75);
        ctx.lineWidth = Math.max(1, lw * 0.7);
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(W_ / 2, H_ / 2);
        ctx.lineTo((x0 + x1) / 2, (y0 + y1) / 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (labels && dist < 32) {
        const tx = (x0 + x1) / 2, ty = y0 - 7;
        const label = kind.cn + ' ' + Math.round(dist) + 'm';
        ctx.fillStyle = 'rgba(0,0,0,.68)';
        ctx.fillRect(tx - 30, ty - 10, 60, 14);
        ctx.fillStyle = hexToRgba(lineColor, fade);
        ctx.fillText(label, tx, ty + 1);
      }
    }
    ctx.restore();
  }

  // ==========================================================================
  // MC 材质包：直接导入官方资源包 zip，按 ASSETS.tiles 的贴图名替换方块贴图
  // 链路：assets.js 的 strip 长条图 → render.init() 的 getImageData → tileData
  //       → texStorage3D / texSubImage3D(TEXTURE_2D_ARRAY)
  // 注入点：hook getImageData 在源头改像素；导入后主动重传全部 mip 级，无需刷新。
  // zip 解压走浏览器原生 DecompressionStream('deflate-raw')，不引任何依赖。
  // ==========================================================================
  const rp = {
    tiles: new Map(),        // 贴图名 -> Uint8ClampedArray(16*16*4)
    ready: false, loaded: 0, patched: 0,
    glInfo: null,            // { levels, F, layers }
    lastGrid: null, lastW: 0, lastH: 0,
    db: null,
    packInfo: null,          // 导入包的分类统计，用于把诊断说清楚
    menuOpen: false,
    gui: new Map(),          // 游戏 images 键 -> { img, w, h }（GUI / HUD / 物品栏贴图）
    guiOrig: new Map(),      // 首次替换前的原始贴图，清除 / 换包时还原
    guiCount: 0, guiApplied: 0, guiDirty: false, guiBound: null,
    packs: [],               // 导入过的所有包 { id, name, tiles:Map, gui:[{k,b}], nBlock, nGui }
    order: [],               // 已启用的包 id，索引 0 优先级最高
    task: Promise.resolve(), // 导入 / 清除 / 切换全部串行，杜绝连点互相覆盖
    menuProto: null,         // 缓存游戏的 MenuScreen.prototype
    screen: null,            // 当前打开的原版资源包界面
    etex: new Map(),         // ETEX 路径 -> PNG bytes（实体 / 生物贴图）
    etexOrig: new Map(),     // 原版 ETEX 值，关闭时还原
    etexUrl: new Map(),      // 路径 -> 当前 blob URL，替换前 revoke
    etexDirty: false, etexApplied: 0, iconsDirty: false,
    stripBase: null,         // 原版 strip 像素，每轮从它重建，避免上一包残留
    glTex: null,             // 方块纹理数组（游戏没挂到 renderer，靠 hook 抓绑定对象）
    skippedAspect: [],       // 比例异常被拦下的 GUI 贴图键
    guiHi: new Map(),        // 保留原分辨率、走高清九宫格的键 -> 倍数
    suspended: false,        // 「记住选择」关掉后，启动时载入库但不自动应用
    stats: null,             // 最近一次导入的分类统计
    coverage: null,          // { used, total, pct } 游戏贴图槽位覆盖率
  };
  function rpEnabled() {
    return getS('resourcepack', 'enabled') !== false;
  }
  function rpStatus(s) {
    try { cfg.settings['resourcepack.status'] = String(s); saveCfg(); refreshGui(); } catch (e) { /* noop */ }
    try { rpMenuRender(); } catch (e) { /* 面板可能还没建好 */ }
  }

  // ---- GUI 材质包：游戏 UI 每帧都用 renderer.images[key] 画 2D 界面，
  // 只要把同名同尺寸的贴图换掉，物品栏 / 箱子 / 按钮 / 血量条 / 菜单底纹就全变了。
  // MandalasGUI+Dakmode 这类「零 block 贴图」的界面包，靠这条链路才算真的导入成功。
  const RP_GUI_ALIAS = {
    crosshair: ['crosshair'], hotbar: ['hotbar'],
    hotbar_selection: ['hotbar_sel'], hotbar_offhand_left: ['hotbar_offhand_left'],
    button_highlighted: ['button_hl'], button_disabled: ['button_dis'],
    slider_handle_highlighted: ['slider_handle_hl'], slider_highlighted: ['slider'],
    text_field_highlighted: ['text_field_hl'], tab_highlighted: ['tab_hl'],
    hotbar_selection: ['hotbar_sel'],
    options_background_: ['options_bg', 'menu_bg'],
    options_background: ['options_bg', 'menu_bg'],
    experience_bar_background: ['xp_bg'], experience_bar_progress: ['xp_fg'],
    crosshair_attack_indicator_background: ['attack_bg'],
    crosshair_attack_indicator_progress: ['attack_progress'],
    crosshair_attack_indicator_full: ['attack_full'],
    effect_background: ['effect_bg'], effect_background_ambient: ['effect_bg_ambient'],
    page_forward: ['widget_page_forward'], page_backward: ['widget_page_backward'],
    page_forward_highlighted: ['widget_page_forward_highlighted'],
    page_backward_highlighted: ['widget_page_backward_highlighted'],
    scroller_background: ['wscroller_bg'], checkbox: ['checkbox'], tab_selected: ['tab_sel'],
  };
  function rpGuiCandidates(name) {
    const base = String(name).split('/').pop().replace(/\.png$/i, '');
    const tag = '/textures/gui/';
    const gi = name.indexOf(tag);
    let path = '';
    if (gi >= 0) path = name.slice(gi + tag.length, -4).replace(/\//g, '_');
    const short = path.replace(/^sprites_(hud|widget|container)_/, '');
    const out = [];
    const add = (k) => { if (k && out.indexOf(k) < 0) out.push(k); };
    (RP_GUI_ALIAS[base] || []).forEach(add);
    add(base);
    add(path); add(short);
    if (/(^|_)container_/.test(path)) add('gui_' + base);
    if (/^empty_(armor_)?slot_/.test(base)) add(base.replace(/^empty_(armor_)?slot_/, 'slot_'));
    return out;
  }
  // 模组准星（CozyUI / Dynamic Crosshair）常给一张「全不透明黑底 + 白十字」，
  // 靠模组自己挖黑。原版游戏用 difference 直接画就成黑方块了。
  // 只在「整张几乎无透明 + 大面积纯黑」时抠黑，正常 GUI 贴图不受影响。
  function rpChromaKey(cx, w, h) {
    try {
      const d = rpOrigGID.call(cx, 0, 0, w, h);
      const px = d.data, n = px.length / 4;
      let opaque = 0, black = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] > 200) opaque++;
        if (px[i] < 24 && px[i + 1] < 24 && px[i + 2] < 24 && px[i + 3] > 200) black++;
      }
      if (opaque < n * 0.98 || black < n * 0.45) return false;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] < 24 && px[i + 1] < 24 && px[i + 2] < 24) px[i + 3] = 0;
      }
      cx.putImageData(d, 0, 0);
      return true;
    } catch (e) { return false; }
  }
  // 高清包（32x / 64x / 128x）整张缩到游戏原生尺寸，而不是裁左上角；
  // 竖条动画（16xN 或 CozyUI 的 hotbar_selection 96x736）只取第一帧。
  async function rpPngBitmap(data, tw, th, frameIndex, keepOriginal, forcedFrameH) {
    const blob = new Blob([data], { type: 'image/png' });
    let bmp = null;
    if (typeof createImageBitmap === 'function') {
      try { bmp = await createImageBitmap(blob); } catch (e) { /* 落到 Image */ }
    }
    if (!bmp) {
      const U = W.URL || URL;
      const url = U.createObjectURL(blob);
      const im = new Image();
      await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; });
      bmp = im;   // blob URL 不能立刻 revoke，Image 还要用
    }
    const w0 = bmp.width || bmp.naturalWidth || 16;
    const h0 = bmp.height || bmp.naturalHeight || 16;
    const ow = tw || w0, oh = th || h0;
    // 高清九宫格控件：保留原分辨率，交给 rpInstallHiResHook 按比例取边框。
    // 先压回 200x20 再被游戏硬放大，会两次丢细节，正是「像素感很重」的来源。
    if (keepOriginal && w0 !== ow && h0 !== oh) return { img: bmp, w: w0, h: h0, hi: true };
    const cv = document.createElement('canvas');
    cv.width = ow; cv.height = oh;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = true;    // 高质量下采样，别用最近邻切出硬锯齿
    cx.imageSmoothingQuality = 'high';
    cx.clearRect(0, 0, ow, oh);         // 保证透明贴图不会带黑底
    const frameH = forcedFrameH > 0 ? forcedFrameH : Math.round(w0 * oh / ow);
    if (frameH > 0 && h0 >= frameH * 2) {
      const frames = Math.max(1, Math.round(h0 / frameH));
      // 入场动画取稳定末帧；普通竖条动画（水/岩浆）取首帧
      const idx = Math.max(0, Math.min(frames - 1, frameIndex == null ? 0 : frameIndex));
      const sy = idx * frameH;
      cx.drawImage(bmp, 0, sy, w0, Math.min(frameH, h0 - sy), 0, 0, ow, oh);
    } else cx.drawImage(bmp, 0, 0, w0, h0, 0, 0, ow, oh);
    rpChromaKey(cx, ow, oh);
    try { if (bmp.close) bmp.close(); } catch (e) { /* noop */ }
    return { img: cv, w: ow, h: oh };
  }
  const RP_REPEAT_TEX = ['rain', 'snowfall', 'end_portal_tex', 'end_sky', 'end_crystal_beam', 'beacon_beam'];
  // render.init() 把一批 images 预先 tex2D 上传过（moon0..7 / sun / rain / 生物…）。
  // 这些光换 images 是看不到的，得把对应的 WebGL 纹理也重传一遍。
  function rpReuploadTex(k, img) {
    try {
      const R = state.game && state.game.renderer;
      if (!R || !R.entityTex || !R.entityTex[k] || typeof R.tex2D !== 'function') return;
      const old = R.entityTex[k];
      R.entityTex[k] = R.tex2D(img, RP_REPEAT_TEX.indexOf(k) >= 0);
      if (R.gl && old && R.gl.deleteTexture) R.gl.deleteTexture(old);
    } catch (e) { /* noop */ }
  }
  function rpColormap(R, k, img) {
    try {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 256;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const d = rpOrigGID.call(x, 0, 0, 256, 256).data;
      if (k === 'grass_color') R.grassMap = d;
      else R.foliageMap = d;
    } catch (e) { /* noop */ }
  }
  function rpApplyGui() {
    const g = state.game;
    const R = g && g.renderer;
    const imgs = R && R.images;
    if (!imgs) return 0;
    const on = rpEnabled();
    let n = 0;
    for (const [k, rec] of rp.gui) {
      if (!Object.prototype.hasOwnProperty.call(imgs, k)) continue;
      if (!rp.guiOrig.has(k)) rp.guiOrig.set(k, imgs[k]);
      const orig = rp.guiOrig.get(k);
      const img = on ? rec.img : orig;
      // 高清九宫格贴图保留原分辨率，尺寸自然不等于原版，不能按普通贴图校验
      if (on && !rec.hi && (!orig || rec.w !== orig.width || rec.h !== orig.height)) continue;
      imgs[k] = img;
      if (img) {
        rpReuploadTex(k, img);
        if (k === 'grass_color' || k === 'foliage_color') rpColormap(R, k, img);
      }
      n++;
    }
    try {
      const u = g.ui;
      if (u) { if (u.tileCache) u.tileCache.clear(); if (u.dirtTile) u.dirtTile = null; }
    } catch (e) { /* noop */ }
    rp.guiApplied = n;
    rpInstallHiResHook();
    return n;
  }
  // 游戏 ui.nine() 把 im.width 当源尺寸、border=3 当边框。高清图是 4x 的，
  // 直接喂会把 3px 边框变成 3/4，所以这里重写九宫格：源坐标 x scale、目标坐标不变。
  // 只影响 rp.guiHi 里登记的键，其它按钮走原函数；异常时回退并恢复平滑状态。
  function rpInstallHiResHook() {
    try {
      const ui = state.game && state.game.ui;
      if (!ui || ui.__cometHiRes) return;
      const proto = Object.getPrototypeOf(ui);
      if (!proto || typeof proto.nine !== 'function') return;
      const orig = proto.nine;
      proto.nine = function (name, x, y, w, h, border) {
        const s = rp.guiHi && rp.guiHi.get(name);
        const im = this.img && this.img[name];
        if (!s || !im || !im.width) return orig.call(this, name, x, y, w, h, border);
        const b = border, B = b * s, iw = im.width, ih = im.height;
        if (iw < B * 2 || ih < B * 2) return orig.call(this, name, x, y, w, h, border);
        const c = this.ctx, sm = c.imageSmoothingEnabled, q = c.imageSmoothingQuality;
        c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
        try {
          c.drawImage(im, 0, 0, B, B, x, y, b, b);
          c.drawImage(im, iw - B, 0, B, B, x + w - b, y, b, b);
          c.drawImage(im, 0, ih - B, B, B, x, y + h - b, b, b);
          c.drawImage(im, iw - B, ih - B, B, B, x + w - b, y + h - b, b, b);
          c.drawImage(im, B, 0, iw - 2 * B, B, x + b, y, w - 2 * b, b);
          c.drawImage(im, B, ih - B, iw - 2 * B, B, x + b, y + h - b, w - 2 * b, b);
          c.drawImage(im, 0, B, B, ih - 2 * B, x, y + b, b, h - 2 * b);
          c.drawImage(im, iw - B, B, B, ih - 2 * B, x + w - b, y + b, b, h - 2 * b);
          c.drawImage(im, B, B, iw - 2 * B, ih - 2 * B, x + b, y + b, w - 2 * b, h - 2 * b);
        } catch (e) { orig.call(this, name, x, y, w, h, border); }
        finally { c.imageSmoothingEnabled = sm; c.imageSmoothingQuality = q; }
      };
      ui.__cometHiRes = true;
    } catch (e) { /* noop */ }
  }
  function rpGuiTick() {
    try {
      const R = state.game && state.game.renderer;
      const imgs = R && R.images;
      if (!imgs) return;
      if (rp.iconsDirty) rp.iconsDirty = !rpRefreshIcons();
      // 游戏重载 / 切世界会换 renderer.images 对象；脏标记或对象变了就重新贴一次
      if (rp.guiDirty || rp.etexDirty || rp.guiBound !== imgs) {
        rp.guiBound = imgs;
        const n = rpApplyGui();
        const m = rpApplyEntities();
        rp.guiDirty = !(n > 0 || !rp.gui.size);
        rp.etexDirty = !(m > 0 || !rp.etex.size);
      }
    } catch (e) { /* noop */ }
  }

  // 从 data:image/png;base64,... 的头 32 个字符读出 IHDR 尺寸，
  // 这样即使 renderer 还没初始化（在标题页 / 选项页导包）也知道该缩放到多大。
  function rpPngDimOf(dataUrl) {
    try {
      const b64 = String(dataUrl).split(',')[1] || '';
      const bin = (typeof W.atob === 'function' ? W.atob : atob)(b64.slice(0, 32));
      const u = new Uint8Array(24);
      for (let i = 0; i < 24; i++) u[i] = bin.charCodeAt(i) & 255;
      const dv = new DataView(u.buffer);
      return [dv.getUint32(16), dv.getUint32(20)];
    } catch (e) { return null; }
  }
  // 直接读 PNG IHDR，不用解码整张图
  function rpPngHeader(b) {
    try {
      if (!b || b.length < 24) return null;
      const dv = new DataView(b.buffer, b.byteOffset, Math.min(b.byteLength, 24));
      if (dv.getUint32(0) !== 0x89504e47) return null;
      return [dv.getUint32(16), dv.getUint32(20)];
    } catch (e) { return null; }
  }
  // GUI 贴图宽度只可能是目标宽度的 1/2/4/8/16 倍（材质包分辨率档位）。
  // 像 CozyUI 的 button_highlighted.png 320x1280（目标 200x20，1.6 倍）其实是
  // hover 动画精灵图，不是按钮；硬压扁会把动画第一帧的白色装饰挤进按钮中间。
  // 合法竖条动画（hotbar_selection 96x736 对 24x23）按整数帧放行。
  const RP_NINE_KEYS = ['button', 'button_hl', 'button_dis', 'slider',
    'slider_handle', 'slider_handle_hl', 'text_field', 'text_field_hl',
    'wscroller', 'wscroller_bg'];
  // 返回贴图分类，而不是简单放行/拦下：
  //   normal = 标准 1/2/4/8/16 倍高清图；
  //   anim   = 帧宽高比与目标一致的竖条入场动画（CozyUI hover 320x1280 -> 200x20）；
  //   reject = 路径反查认错的图（粒子 / 药水 / 别的控件）。
  function rpScaleInfo(src, dst) {
    if (!src || !dst || !src[0] || !dst[0]) return { mode: 'normal', scale: 1, frameH: 0, frames: 1 };
    const r = src[0] / dst[0];
    const std = [1, 2, 4, 8, 16].find((k) => Math.abs(r - k) < 0.09);
    if (std) return { mode: 'normal', scale: std, frameH: dst[1] * std, frames: 1 };
    // 帧高由【源图结构】决定，不能用目标比例推算：
    // CozyUI 320x1280 是 16 帧 x 320x80，按 200x20 推会误算成 32，
    // 只取到第一帧上半截，白色箭头就变成按钮中间的两只尖角。
    const fh = Math.round(src[0] / 4);   // 4x 包：按钮帧高 = 逻辑高 x 4
    const frames = Math.round(src[1] / fh);
    if (fh > 0 && frames >= 4 && Math.abs(src[1] / fh - frames) < 0.12) {
      return { mode: 'anim', scale: r, frameH: fh, frames: frames };
    }
    return { mode: 'reject', scale: r, frameH: 0, frames: 1 };
  }
  function rpScaleGuard(src, dst) { return rpScaleInfo(src, dst).mode !== 'reject'; }
  function rpPackById(id) { return rp.packs.find((p) => p.id === id) || null; }
  function rpNewId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function rpTask(fn) { rp.task = rp.task.then(fn, fn); return rp.task; }
  function rpKeySet() {
    const A = W.ASSETS || {};
    const imgs = (state.game && state.game.renderer && state.game.renderer.images) || null;
    return { imgs, assets: A.images || null, tiles: A.tiles || null, etex: W.ETEX || null };
  }
  const RP_MOON = {
    full_moon: 'moon0', waning_gibbous: 'moon1', last_quarter: 'moon2', waning_crescent: 'moon3',
    new_moon: 'moon4', waxing_crescent: 'moon5', first_quarter: 'moon6', waxing_gibbous: 'moon7',
  };
  // 按 MC 资源包的目录结构把一张 PNG 映射到游戏里真正消费它的地方。
  // 严格按类别分派，避免 gui/advancements/backgrounds/stone.png 之类误伤方块贴图。
  function rpKeyFor(name, ks) {
    // CozyUI 这类整合包里带 dynamiccrosshair / jei / emi / inventoryhud 等
    // 其它 namespace 的同名贴图，它们不是给原版 MC 用的，混进来会把准星盖成黑块。
    const ns = name.match(/assets\/([^/]+)\/(?:textures|optifine|mcpatcher|cit)\//i);
    if (ns && ns[1].toLowerCase() !== 'minecraft') return null;
    let rel = null;
    const gi = name.indexOf('/textures/');
    if (gi >= 0) rel = name.slice(gi + '/textures/'.length).replace(/\.png$/i, '');
    else {
      // 没有 /textures/ 段：OptiFine 扩展、旧包直接放在 assets/minecraft 下、
      // 或者干脆不带 assets 前缀。尽量按目录名猜一次。
      const m = name.match(/(?:^|\/)(block|blocks|item|items|gui|entity|environment|mob_effect|misc|font)\/(.+)\.png$/i);
      if (m) rel = m[1] + '/' + m[2];
      else return null;   // optifine 自定义 GUI 等：原版没有对应槽位
    }
    // 1.7 及更早的复数目录 / 多余前缀
    rel = rel.replace(/^blocks\//, 'block/').replace(/^items\//, 'item/')
             .replace(/^textures\//, '');
    const parts = rel.split('/');
    const cat = parts[0], rest = parts.slice(1), base = rest[rest.length - 1] || '';
    const has = (o, k) => !!(o && Object.prototype.hasOwnProperty.call(o, k));
    const hasT = (k) => has(ks.tiles, k);
    const hasI = (k) => has(ks.imgs, k) || has(ks.assets, k);
    if (cat === 'block') return hasT(base) ? { type: 'tile', key: base, cat: 'block' } : null;
    if (cat === 'item') {
      for (const k of ['i_' + base, base]) {
        if (hasT(k)) return { type: 'tile', key: k, cat: 'item' };
        if (hasI(k)) return { type: 'img', key: k, cat: 'item' };
      }
      return null;
    }
    // decor.js / items3.js 会调 r.etex('painting/...') 与 r.etex('map/...')，
    // 这两类同样走 window.ETEX，之前只认 entity/ 白白漏了 89 张。
    if (cat === 'entity' || cat === 'painting' || cat === 'map') {
      const p = cat + '/' + rest.join('/');
      if (has(ks.etex, p)) return { type: 'etex', key: p, cat: 'entity' };
      for (const k of [base, '@' + p]) if (hasI(k)) return { type: 'img', key: k, cat: 'entity' };
      return null;
    }
    if (cat === 'gui') {
      for (const k of rpGuiCandidates(name)) if (hasI(k)) return { type: 'img', key: k, cat: 'gui' };
      return null;
    }
    if (cat === 'environment') {
      for (const k of [RP_MOON[base] || base, base]) if (hasI(k)) return { type: 'img', key: k, cat: 'env' };
      return null;
    }
    if (cat === 'mob_effect') {
      const k = 'eff_' + base;
      return hasI(k) ? { type: 'img', key: k, cat: 'fx' } : null;
    }
    if (cat === 'misc' || cat === 'font') {
      for (const k of [base, 'font_' + base, '@' + rel]) if (hasI(k)) return { type: 'img', key: k, cat: 'misc' };
      return null;
    }
    return null;
  }
  function rpTargetDim(k, ks) {
    if (ks.assets && ks.assets[k]) {
      const d = rpPngDimOf(ks.assets[k]);
      if (d && d[0] > 0 && d[1] > 0) return d;   // 原版尺寸最可靠
    }
    if (ks.imgs && ks.imgs[k] && ks.imgs[k].width) return [ks.imgs[k].width, ks.imgs[k].height];
    return null;
  }
  // 实体贴图走 window.ETEX：游戏的 Renderer.etex() 每次 new Image() 读它。
  // 换掉值之后必须把已上传的 WebGL 纹理和缓存清掉，下一帧才会重新加载。
  function rpApplyEntities() {
    const R = state.game && state.game.renderer;
    const E = W.ETEX;
    if (!R || !E) return 0;
    const on = rpEnabled();
    const U = W.URL || URL;
    for (const [p, orig] of rp.etexOrig) {
      if (on && rp.etex.has(p)) continue;
      if (rp.etexUrl.has(p)) {
        try { U.revokeObjectURL(rp.etexUrl.get(p)); } catch (e) { /* noop */ }
        rp.etexUrl.delete(p);
      }
      if (orig != null) E[p] = orig;
    }
    if (on) {
      for (const [p, b] of rp.etex) {
        if (!rp.etexOrig.has(p)) rp.etexOrig.set(p, E[p]);
        if (rp.etexUrl.has(p)) { try { U.revokeObjectURL(rp.etexUrl.get(p)); } catch (e) { /* noop */ } }
        const url = U.createObjectURL(new Blob([b], { type: 'image/png' }));
        rp.etexUrl.set(p, url);
        E[p] = url;
      }
    }
    try {
      const gl = R.gl, et = R.entityTex || {};
      for (const k of Object.keys(et)) {
        if (k.charAt(0) !== '@') continue;
        try { if (gl && et[k] && gl.deleteTexture) gl.deleteTexture(et[k]); } catch (e) { /* noop */ }
        delete et[k];
      }
      for (const k of Object.keys(R.images || {})) if (k.charAt(0) === '@') delete R.images[k];
      if (R._etexWait && R._etexWait.clear) R._etexWait.clear();
    } catch (e) { /* noop */ }
    rp.etexApplied = on ? rp.etex.size : 0;
    return rp.etexApplied;
  }
  // 方块物品图标是 buildIcons() 离线 3D 渲出来的；平面物品图标走 stripCanvas。
  // 两者都带缓存，替换贴图后必须重建，否则物品栏里还是旧图。
  function rpRefreshIcons() {
    try {
      const g = state.game, R = g && g.renderer;
      if (!R || !R.stripCanvas) return false;
      const u = g.ui;
      if (u) { if (u.icons && u.icons.clear) u.icons.clear(); u.iconsOf = null; u.icons = new Map(); }
      if (typeof R.buildIcons === 'function') R.buildIcons();
      return true;
    } catch (e) { return false; }
  }
  function rpSlotTotal(ks) {
    let n = 0;
    if (ks.tiles) n += Object.keys(ks.tiles).length;      // 方块 + 物品图标图集
    if (ks.assets) n += Object.keys(ks.assets).length;    // GUI / HUD / 环境
    if (ks.etex) n += Object.keys(ks.etex).length;        // 实体模型
    return n;
  }
  async function rpRebuild() {
    const ks = rpKeySet();
    const tiles = new Map(), imgRaw = new Map(), etex = new Map();
    if (rpEnabled() && !rp.suspended) {
      for (let i = rp.order.length - 1; i >= 0; i--) {
        const pk = rpPackById(rp.order[i]);
        if (!pk) continue;
        for (const [k, v] of (pk.tiles || new Map())) tiles.set(k, v);
        for (const it of (pk.imgs || pk.gui || [])) imgRaw.set(it.k, it.b);
        for (const it of (pk.etex || [])) etex.set(it.k, it.b);
      }
    }
    const gui = new Map();
    const skipped = [];
    const hi = new Map();
    for (const [k, b] of imgRaw) {
      const d = rpTargetDim(k, ks);
      const sd = rpPngHeader(b);
      const si = rpScaleInfo(sd, d);
      if (si.mode === 'reject') { skipped.push(k); continue; }
      // 入场动画取第 0 帧（唯一带完整发光描边的一帧），普通竖条动画取首帧
      const frame = 0;
      const hiRes = si.mode === 'normal' && si.scale >= 2 && RP_NINE_KEYS.indexOf(k) >= 0;
      try {
        const rec = await rpPngBitmap(b, d && d[0], d && d[1], frame, hiRes, si.frameH);
        gui.set(k, rec);
        if (hiRes && rec.hi) hi.set(k, si.scale);
      } catch (e) { /* 单张失败跳过 */ }
    }
    rp.skippedAspect = skipped;
    rp.guiHi = hi;
    // 换包 / 关包前先把上一轮的界面贴图还原，否则被移除的键会一直残留
    if (ks.imgs) {
      for (const [k, o] of rp.guiOrig) ks.imgs[k] = o;
      rp.guiOrig.clear();
    }
    rp.tiles = tiles; rp.loaded = tiles.size;
    rp.gui = gui; rp.guiCount = gui.size;
    rp.etex = etex;
    const total = rpSlotTotal(ks);
    const used = tiles.size + gui.size + etex.size;
    rp.coverage = { used: used, total: total, pct: total ? Math.round(used / total * 1000) / 10 : 0 };
    rp.guiDirty = true; rp.guiBound = null;
    rp.etexDirty = true; rp.iconsDirty = true;
    rpReupload();
    rpApplyGui();
    rpApplyEntities();
    rp.iconsDirty = !rpRefreshIcons();
    try { rpMenuRender(); } catch (e) { /* noop */ }
    if (rp.screen && rp.screen.layout) rp.screen.layout();
    return { block: tiles.size, gui: gui.size, entity: etex.size };
  }
  async function rpSaveLibrary() {
    const db = await rpOpenDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tiles', 'readwrite');
      tx.objectStore('tiles').put({ packs: rp.packs, order: rp.order }, 'library');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  async function rpReapply() {
    return rpTask(async () => {
      rp.suspended = false;
      const r = await rpRebuild();
      const msg = '已重新应用：' + rp.order.length + ' 个包 / 方块物品 ' + r.block +
        ' 张 / 界面 ' + r.gui + ' 张 / 实体 ' + r.entity + ' 张';
      rpStatus(msg);
      pushNotification('材质包', msg);
      return r;
    });
  }
  function rpSetEnabled(on) {
    cfg.settings['resourcepack.enabled'] = !!on;
    __sCache = null;
    try { saveCfg(); } catch (e) { /* noop */ }
    rpTask(async () => { await rpRebuild(); rpMenuRender(); });
  }
  async function rpAddPack(f) {
    rpStatus('正在解压 ' + f.name);
    pushNotification('材质包', '正在解压 ' + f.name + '…');
    const buf = await f.arrayBuffer();
    const entries = await rpUnzip(buf);
    const cat = {};
    for (const e of entries) {
      const cm = e.name.match(/\/textures\/([^/]+)\//);
      const k = cm ? cm[1] : 'other';
      cat[k] = (cat[k] || 0) + 1;
    }
    rpStatus('正在匹配贴图（' + entries.length + ' 个文件）…');
    // pack.mcmeta 里带了包描述和 pack_format，顺手读出来显示在界面上
    let desc = '';
    const meta = entries.find((e) => e.kind === 'meta' && e.data);
    if (meta) {
      try {
        const j = JSON.parse(new TextDecoder().decode(meta.data));
        const d = j && j.pack && j.pack.description;
        desc = String(typeof d === 'object' ? (d.text || d.translate || '') : (d || ''))
          .replace(/§./g, '').slice(0, 48);
      } catch (e) { /* noop */ }
    }
    const ks = rpKeySet();
    const tiles = new Map(), imgs = new Map(), etex = new Map();
    const n = { block: 0, item: 0, gui: 0, entity: 0, env: 0, fx: 0, misc: 0, skip: 0,
      model: 0, noslot: 0, otherns: 0, badAspect: 0 };
    for (const e of entries) {
      if (e.kind === 'model') n.model++;
      else if (e.kind === 'noslot') n.noslot++;
    }
    for (const e of entries) {
      if (!e.data) { n.skip++; continue; }
      const info = rpKeyFor(e.name, ks);
      if (!info) {
        n.skip++;
        const nsm = e.name.match(/assets\/([^/]+)\//i);
        if (nsm && nsm[1].toLowerCase() !== 'minecraft') n.otherns++;
        continue;
      }
      const b = new Uint8Array(e.data);
      try {
        if (info.type === 'tile') { tiles.set(info.key, await rpDecode(b)); n[info.cat]++; }
        else if (info.type === 'etex') { etex.set(info.key, b); n.entity++; }
        else { imgs.set(info.key, b); n[info.cat]++; }
      } catch (err) { n.skip++; }
    }
    // 比例异常的 GUI 贴图不是同一类元素，别入库；hover/disabled 尽量用同包基础按钮兜底
    for (const [k, b] of Array.from(imgs)) {
      const d = ks.assets && ks.assets[k] ? rpPngDimOf(ks.assets[k]) : null;
      const sd = rpPngHeader(b);
      if (!d || !sd || rpScaleGuard(sd, d)) continue;
      n.badAspect++;
      imgs.delete(k);
      const base = k.replace(/_hl$|_dis$/, '');
      if (base !== k && imgs.has(base)) imgs.set(k, imgs.get(base));
    }
    if (!tiles.size && !imgs.size && !etex.size) {
      let msg;
      if (n.model > 0) {
        msg = '这是模型 / blockstates 包（' + n.model + ' 个 JSON），不含贴图；' +
          'OpusMC 的方块模型由代码生成，不读取模型 JSON，无法应用';
      } else if (n.otherns > 0) {
        msg = '包内 ' + n.otherns + ' 张贴图属于其它 mod 命名空间（JEI / EMI / OptiFine 等），原版没有对应槽位';
      } else {
        const parts = Object.keys(cat).map((k) => k + ' ' + cat[k]);
        msg = (parts.length ? '包内：' + parts.join(' / ') : '包里没有 PNG 贴图') + '；没有能对上游戏的贴图';
      }
      rpStatus(msg);
      pushNotification('材质包', msg);
      return null;
    }
    rp.stats = n;
    rpStatus('正在应用 ' + (tiles.size + imgs.size + etex.size) + ' 张贴图…');
    const name = String(f.name || '资源包').replace(/\.zip$/i, '');
    let pk = rp.packs.find((p) => p.name === name);
    if (!pk) {
      pk = { id: rpNewId(), name: name };
      rp.packs.push(pk);
      if (rp.order.indexOf(pk.id) < 0) rp.order.push(pk.id);
    }
    pk.tiles = tiles;
    pk.imgs = Array.from(imgs, ([k, b]) => ({ k, b }));
    pk.gui = pk.imgs;                    // 兼容 v1.23 存档字段
    pk.etex = Array.from(etex, ([k, b]) => ({ k, b }));
    pk.nBlock = n.block; pk.nItem = n.item; pk.nGui = n.gui;
    pk.nEntity = n.entity; pk.nEnv = n.env; pk.nFx = n.fx; pk.nMisc = n.misc;
    pk.nSkip = n.skip; pk.desc = desc;
    rp.packInfo = { cat, total: entries.length, stats: n, desc: desc };
    if (getS('resourcepack', 'enabled') === false) {
      cfg.settings['resourcepack.enabled'] = true;
      __sCache = null;
      try { saveCfg(); } catch (e) { /* noop */ }
    }
    try { await rpSaveLibrary(); } catch (e) { /* 本次会话有效 */ }
    rp.suspended = false;   // 用户主动导入 = 现在就要用
    const r = await rpRebuild();
    const msg = '已应用「' + name + '」：方块 ' + n.block + ' / 物品 ' + n.item +
      ' / 界面 ' + n.gui + ' / 实体 ' + n.entity + ' / 环境 ' + n.env +
      ' / 药水 ' + n.fx + (n.badAspect ? ' / 拦下比例异常 ' + n.badAspect + ' 张' : '') +
      '，共 ' + rp.order.length + ' 个包';
    rpStatus(msg);
    pushNotification('材质包', msg);
    extLog && extLog(msg, 'profile');
    return pk;
  }

  // ---- 零依赖 zip 解析（stored / deflate） ----
  function rpInflate(raw) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('浏览器不支持 DecompressionStream'));
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([raw]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then((b) => new Uint8Array(b));
  }
  async function rpUnzip(buf) {
    const dv = new DataView(buf);
    const total = buf.byteLength;
    let eocd = -1;
    const floor = Math.max(0, total - 65557);
    for (let i = total - 22; i >= floor; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 zip 资源包');
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const out = [];
    const jobs = [];
    for (let i = 0; i < count && off + 46 <= total; i++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const compSize = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      const localOff = dv.getUint32(off + 42, true);
      let name = '';
      try { name = dec.decode(new Uint8Array(buf, off + 46, nameLen)); } catch (e) { /* noop */ }
      off += 46 + nameLen + extraLen + commentLen;
      const isPng = /\.png$/i.test(name);
      const isMeta = /pack\.mcmeta$/i.test(name);
      if (!isPng && !isMeta) {
        // 把「这个包到底装了什么」记下来，导入失败时才能说清楚原因
        if (/\/(blockstates|models)\/.*\.json$/i.test(name)) out.push({ name, data: null, kind: 'model' });
        continue;
      }
      if (/pack\.png$/i.test(name)) continue;             // 包图标不是贴图
      // 这些目录游戏没有对应槽位，别白解压；painting / map 是 ETEX 真实消费的，不能跳
      if (/\/(particle|trims|font|colormap)\//i.test(name)) {
        out.push({ name, data: null, skip: true, kind: 'noslot' });
        continue;
      }
      // 其余 PNG 一律收下：optifine / mcpatcher / 旧版 textures/blocks /
      // 没有 assets 前缀的包，交给 rpKeyFor 去归一化判断
      if (localOff + 30 > total) continue;
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      if (start + compSize > total) continue;
      jobs.push({ name, method, raw: new Uint8Array(buf, start, compSize), kind: isMeta ? 'meta' : null });
    }
    // 分批并行解压：GUI 包动辄 500+ 张，一张一张 await 会卡住好几秒，
    // 用户以为「导入没反应」就会连点，越点越乱。
    for (let i = 0; i < jobs.length; i += 24) {
      const batch = jobs.slice(i, i + 24);
      const done = await Promise.all(batch.map(async (j) => {
        try { return { name: j.name, kind: j.kind, data: j.method === 0 ? j.raw : await rpInflate(j.raw) }; }
        catch (e) { return null; }
      }));
      for (const d of done) if (d) out.push(d);
    }
    return out;
  }

  // ---- PNG -> 16x16 RGBA（动画竖条自动取首帧） ----
  async function rpDecode(data) {
    const blob = new Blob([data], { type: 'image/png' });
    let bmp = null;
    try {
      bmp = await createImageBitmap(blob);
      const cv = document.createElement('canvas');
      cv.width = 16; cv.height = 16;
      const cx = cv.getContext('2d');
      cx.imageSmoothingEnabled = true;
      // 16x 竖条是动画多帧（水 / 岩浆），取第一帧；32x / 64x 高清包整张缩到 16x16，
      // 否则 Faithful 这类包会只拿到左上角一小块，看起来像贴错图。
      if (bmp.width === 16 && bmp.height > 16) cx.drawImage(bmp, 0, 0, 16, 16, 0, 0, 16, 16);
      else cx.drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, 0, 16, 16);
      const img = rpOrigGID.call(cx, 0, 0, 16, 16);
      return new Uint8ClampedArray(img.data);
    } finally {
      try { if (bmp && bmp.close) bmp.close(); } catch (e) { /* noop */ }
    }
  }

  // ---- 像素注入：识别 strip 尺寸，按 tile 索引覆写 ----
  function rpPatchGrid(img, w, h) {
    if (!rpEnabled() || !rp.tiles.size) return 0;
    const A = W.ASSETS;
    if (!A || !A.tiles) return 0;
    const cols = A.cols || 64;
    const n = A.count || Object.keys(A.tiles).length;
    const stripW = cols * 16;
    const stripH = Math.ceil(n / cols) * 16;
    if (w !== stripW || h !== stripH) return 0;
    if (!img || !img.data) return 0;
    const dst = img.data;
    let done = 0;
    for (const [name, px] of rp.tiles) {
      const k = A.tiles[name];
      if (k == null || !px || px.length < 1024) continue;
      const x0 = (k % cols) * 16, y0 = Math.floor(k / cols) * 16;
      if (y0 + 16 > h) continue;
      for (let yy = 0; yy < 16; yy++) {
        const di = ((y0 + yy) * w + x0) * 4;
        const si = yy * 64;
        for (let xx = 0; xx < 64; xx++) dst[di + xx] = px[si + xx];
      }
      done++;
    }
    rp.lastGrid = img;
    rp.lastW = w;
    rp.lastH = h;
    rp.patched = done;
    return done;
  }

  // ---- 在 document-start 立刻装 hook（ASSETS 可能还没加载，运行时再读） ----
  const rpOrigGID = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function (sx, sy, sw, sh) {
    const res = rpOrigGID.apply(this, arguments);
    try { rpPatchGrid(res, sw, sh); } catch (e) { /* noop */ }
    return res;
  };
  if (W.WebGL2RenderingContext && W.WebGL2RenderingContext.prototype.texStorage3D) {
    const rpOrigStorage = W.WebGL2RenderingContext.prototype.texStorage3D;
    W.WebGL2RenderingContext.prototype.texStorage3D = function (target, levels, ifmt, w, h, d) {
      try {
        if (target === this.TEXTURE_2D_ARRAY && w === 16) {
          rp.glInfo = { levels, F: Math.max(1, h / 16), layers: d };
          // 游戏在 bindTexture 之后立刻 texStorage3D，此刻能拿到真正的纹理对象；
          // renderer 上并没有 texArray 字段，不抓就永远没法主动重传。
          try { rp.glTex = this.getParameter(this.TEXTURE_BINDING_2D_ARRAY); } catch (e) { /* noop */ }
        }
      } catch (e) { /* noop */ }
      return rpOrigStorage.apply(this, arguments);
    };
  }

  // ---- mip 重算（与游戏一致：box 平均，尺寸按 tile 竖排） ----
  function rpMip(src, size, n) {
    const ns = Math.max(1, size >> 1);
    const out = new Uint8Array(n * ns * ns * 4);
    const row = size * 4;
    for (let k = 0; k < n; k++) {
      for (let y = 0; y < ns; y++) {
        for (let x = 0; x < ns; x++) {
          const i = (k * size * size + y * 2 * size + x * 2) * 4;
          const o = (k * ns * ns + y * ns + x) * 4;
          for (let c = 0; c < 4; c++) {
            out[o + c] = (src[i + c] + src[i + 4 + c] + src[i + row + c] + src[i + row + 4 + c]) >> 2;
          }
        }
      }
    }
    return out;
  }

  // ---- 导入后立即重传纹理，不用刷新页面 ----
  function rpReupload() {
    try {
      const R = state.game && state.game.renderer;
      const gl = R && R.gl;
      const A = W.ASSETS;
      if (!gl || !rp.glTex || !A || !A.tiles || !rp.glInfo || !R.stripCanvas) return false;
      const cv = R.stripCanvas;
      const cx = cv.getContext('2d');
      const cols = A.cols || 64;
      const n = A.count || Object.keys(A.tiles).length;
      // 首次留一份原版像素；之后每轮都从它重建，避免上一包的残留在 strip 上越积越多
      if (!rp.stripBase) rp.stripBase = rpOrigGID.call(cx, 0, 0, cv.width, cv.height);
      const grid = rpOrigGID.call(cx, 0, 0, cv.width, cv.height);
      grid.data.set(rp.stripBase.data);
      rpPatchGrid(grid, cv.width, cv.height);
      // 写回 stripCanvas：drawFlatIcon（平面物品图标）直接 drawImage 它，
      // 不走 getImageData 的 hook，所以只改返回值是看不到的。
      try {
        const tmp = document.createElement('canvas');
        tmp.width = cv.width; tmp.height = cv.height;
        tmp.getContext('2d').putImageData(grid, 0, 0);
        cx.clearRect(0, 0, cv.width, cv.height);
        cx.drawImage(tmp, 0, 0);
      } catch (e) { /* noop */ }
      const data = new Uint8Array(n * 1024);
      for (let k = 0; k < n; k++) {
        const x0 = (k % cols) * 16, y0 = Math.floor(k / cols) * 16;
        for (let y = 0; y < 16; y++) {
          const from = ((y0 + y) * cv.width + x0) * 4;
          data.set(grid.data.subarray(from, from + 64), (k * 16 + y) * 64);
        }
      }
      const { levels, F, layers } = rp.glInfo;
      let cur = new Uint8Array(data);
      let size = 16;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, rp.glTex);
      for (let level = 0; level < levels; level++) {
        const want = layers * F * size * size * 4;
        let px = cur;
        if (px.length < want) { const p = new Uint8Array(want); p.set(px); px = p; }
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, level, 0, 0, 0, size, size * F, layers, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (level < levels - 1) cur = rpMip(cur, size, n);
        size >>= 1;
      }
      return true;
    } catch (e) {
      pushNotification('材质包', '重传失败：' + e.message);
      return false;
    }
  }

  // ---- IndexedDB：保存解压后的 16x16 像素（紧凑，约 1KB/张） ----
  function rpOpenDB() {
    return new Promise((resolve, reject) => {
      if (rp.db) { resolve(rp.db); return; }
      if (typeof indexedDB === 'undefined') { reject(new Error('无 IndexedDB')); return; }
      const req = indexedDB.open('opusmc_resourcepack', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tiles')) db.createObjectStore('tiles');
        resolve(db);
      };
      req.onsuccess = () => { rp.db = req.result; resolve(rp.db); };
      req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
    });
  }
  async function rpRestore() {
    let got = false;
    try {
      const db = await rpOpenDB();
      const read = (key) => new Promise((resolve, reject) => {
        const tx = db.transaction('tiles', 'readonly');
        const req = tx.objectStore('tiles').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const lib = await read('library');
      if (lib && Array.isArray(lib.packs) && lib.packs.length) {
        rp.packs = lib.packs.map((p) => ({
          id: p.id, name: p.name, nBlock: p.nBlock || 0, nGui: p.nGui || 0,
          tiles: p.tiles instanceof Map ? p.tiles : new Map(Object.entries(p.tiles || {})),
          imgs: Array.isArray(p.imgs) ? p.imgs : (Array.isArray(p.gui) ? p.gui : []),
          gui: Array.isArray(p.gui) ? p.gui : [],
          etex: Array.isArray(p.etex) ? p.etex : [],
          nBlock: p.nBlock || 0, nItem: p.nItem || 0, nGui: p.nGui || 0,
          nEntity: p.nEntity || 0, nEnv: p.nEnv || 0, nFx: p.nFx || 0, nMisc: p.nMisc || 0,
          nSkip: p.nSkip || 0, legacy: !!p.legacy,
        }));
        rp.order = Array.isArray(lib.order) ? lib.order.filter((id) => rpPackById(id)) : [];
        got = true;
      } else {
        // 兼容 v1.22.0 的单包存档：迁移成一个包，别让用户白导一次
        const tiles = await read('block');
        const gl = await read('gui');
        if ((tiles && tiles.size) || (Array.isArray(gl) && gl.length)) {
          const gl2 = Array.isArray(gl) ? gl : [];
          const pk = {
            id: 'migrated', name: '上次导入的资源包', legacy: true,
            tiles: tiles instanceof Map ? tiles : new Map(Object.entries(tiles || {})),
            imgs: gl2, gui: gl2, etex: [],
            nBlock: 0, nItem: 0, nGui: 0, nEntity: 0, nEnv: 0, nFx: 0,
            nMisc: 0, nSkip: 0,
          };
          pk.nBlock = pk.tiles.size; pk.nGui = gl2.length;
          rp.packs = [pk]; rp.order = [pk.id];
          got = true;
          try { await rpSaveLibrary(); } catch (e) { /* noop */ }
        }
      }
      if (got) {
        // 「记住选择」关掉：库照样读出来供界面列着，但不自动套到游戏上。
        // 下次开浏览器就是原版，不用卸载插件。
        const remember = getS('resourcepack', 'remember') !== false;
        rp.suspended = !remember;
        await rpRebuild();
        rpStatus(remember
          ? '已恢复 ' + rp.order.length + ' 个资源包：方块 ' + rp.tiles.size + ' 张 / 界面 ' + rp.guiCount + ' 张'
          : '已载入 ' + rp.packs.length + ' 个包（记住选择已关，本次不自动启用）');
      }
    } catch (e) { /* 首次运行没有存档，正常 */
    }
    return got;
  }

  // ---- 导入 ----
  function rpImport() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.zip,application/zip';
    inp.multiple = true;   // 一次可以选好几个包，按选择顺序叠加
    inp.addEventListener('change', () => {
      const fs = Array.prototype.slice.call(inp.files || []);
      if (!fs.length) return;
      rpTask(async () => { for (const f of fs) await rpAddPack(f); });
    });
    inp.click();
  }
  function rpImportFile(f) { return rpTask(() => rpAddPack(f)); }
  function rpClear() {
    return rpTask(async () => {
      rp.suspended = false;
      rp.packs = []; rp.order = []; rp.packInfo = null; rp.stats = null;
      try {
        const db = await rpOpenDB();
        const tx = db.transaction('tiles', 'readwrite');
        tx.objectStore('tiles').delete('library');
        tx.objectStore('tiles').delete('block');
        tx.objectStore('tiles').delete('gui');
      } catch (e) { /* noop */ }
      await rpRebuild();
      rpStatus('已清除全部资源包');
      pushNotification('材质包', '已恢复原版方块与界面贴图');
    });
  }

  // ==========================================================================
  // 材质包入口放在游戏「原版菜单页面」上，不塞进客户端 GUI
  // 检测 ui.screen 有 widgets/layout = 原版菜单屏；按钮是独立 DOM，风格仿原版按钮
  // ==========================================================================
  const rpMenuBtn = mk('div');
  rpMenuBtn.id = '__comet_rpbtn';
  rpMenuBtn.textContent = '资源包…';
  const rpMenu = mk('div');
  rpMenu.id = '__comet_rpmenu';
  const rpmHead = mk('div', 'cm-rmhead');
  rpmHead.append(mk('span', 'cm-rmtitle', '资源包'));
  const rpmClose = mk('div', 'cm-rmclose', '×');
  rpmHead.append(rpmClose);
  const rpmStatus = mk('div', 'cm-rmstatus', '未导入');
  const rpmHint = mk('div', 'cm-rmhint',
    '把标准 MC 资源包 .zip 拖到这里：方块贴图走纹理数组，GUI / 物品栏 / HUD 贴图直接换掉游戏界面，两类都生效。');
  const rpmRow = mk('div', 'cm-rmrow');
  const rpmImport = mk('div', 'cm-rmbtn', '导入 .zip');
  const rpmReapply = mk('div', 'cm-rmbtn', '重新应用');
  const rpmClear = mk('div', 'cm-rmbtn', '清除');
  const rpmDemo = mk('div', 'cm-rmbtn', '内置暗色 GUI 包');
  rpmRow.append(rpmImport, rpmReapply, rpmClear, rpmDemo);
  const rpmToggleRow = mk('div', 'cm-rmtoggle');
  const rpmSwitch = mk('span', 'cm-rmswitch');
  rpmSwitch.append(mk('i'));
  rpmToggleRow.append(mk('span', '', '启用材质包'), rpmSwitch);
  const rpmInfo = mk('div', 'cm-rminfo', '');
  rpMenu.append(rpmHead, rpmStatus, rpmHint, rpmRow, rpmToggleRow, rpmInfo);
  try { if (document.documentElement) document.documentElement.append(rpMenuBtn, rpMenu); } catch (e) { /* noop */ }

  function rpMenuRender() {
    try {
      let st = String(cfg.settings['resourcepack.status'] || '未导入');
      rpmStatus.textContent = st;
      const pi = rp.packInfo;
      const applied = '已应用：方块 ' + rp.tiles.size + ' 张 / 界面 ' + rp.guiCount + ' 张';
      const lib = '资源包 ' + rp.order.length + ' 个启用 / ' + rp.packs.length + ' 个已导入；' + applied;
      if (pi) {
        const parts = Object.keys(pi.cat).map((k) => k + ' ' + pi.cat[k]);
        rpmInfo.textContent = '包内贴图：' + (parts.join(' / ') || '无') + '；' + lib;
      } else if (rp.packs.length || rp.tiles.size || rp.guiCount) {
        rpmInfo.textContent = lib;
      } else {
        rpmInfo.textContent = '';
      }
      const on = getS('resourcepack', 'enabled') !== false;
      rpmSwitch.classList.toggle('on', on);
    } catch (e) { /* noop */ }
  }
  function rpMenuSetOpen(on) {
    // 主路径：打开游戏自己绘制的原版资源包界面；DOM 面板只在游戏还没起来时兜底
    if (on && rpOpenPackScreen()) {
      rp.menuOpen = false;
      rpMenu.classList.remove('open');
      rpMenuBtn.classList.remove('hidden');
      return;
    }
    rp.menuOpen = !!on;
    rpMenu.classList.toggle('open', rp.menuOpen);
    if (rp.menuOpen) rpMenuRender();
    rpMenuBtn.classList.toggle('hidden', rp.menuOpen);
  }
  // 资源包入口塞进游戏 OptionsScreen 自己的 widgets 数组：由 MenuScreen.draw()
  // 的 ui.button(w) 画出来、由 mouseDown 的 w.onClick() 响应，是真正的原版按钮。
  function rpNativeWidget() {
    const ui = state.game && state.game.ui;
    const scr = ui && ui.screen;
    if (!scr || !Array.isArray(scr.widgets)) return { inMenu: false, native: false };
    const ws = scr.widgets;
    const lab = (w) => (w && typeof w.label === 'string' ? w.label : '');
    const slot = ws.find((w) => w && !w.__cometRp && (lab(w) === '资源包…' || lab(w) === '资源包...'));
    const acc = ws.find((w) => w && (lab(w) === '账号…' || lab(w) === '账号...'));
    // 只在「选项」屏动手，其它菜单（标题 / 暂停 / 子选项页）一律不碰
    if (!slot && !acc && scr.title !== '选项') return { inMenu: false, native: false };
    const tip = ['导入 Minecraft 资源包 .zip', '方块 / 物品栏 / GUI 贴图都会生效'];
    if (slot) {
      Object.assign(slot, {
        enabled: true, label: '资源包…', tip,
        __cometRp: true, onClick: () => rpMenuSetOpen(true),
      });
      return { inMenu: true, native: true };
    }
    if (acc) {
      // onboard.js 把 OptionsScreen.layout() 里原本 sub(6, '资源包…') 的槽位
      // 改成了「账号…」：把这一格 150px 一分为二，账号和资源包并排，
      // 位置仍落在原版网格的同一行，不会飘到屏幕中间去。
      if (!acc.__cometRpSplit) {
        acc.__cometRpSplit = true;
        acc.w = 72;
      }
      let btn = ws.find((w) => w && w.__cometRp);
      if (!btn) {
        btn = { label: '资源包…', tip, __cometRp: true, onClick: () => rpMenuSetOpen(true) };
        ws.push(btn);
      }
      btn.x = acc.x + 78; btn.y = acc.y; btn.w = 72; btn.h = acc.h || 20;
      return { inMenu: true, native: true };
    }
    return { inMenu: true, native: false };
  }
  // 暂停菜单（游戏菜单）：从「选项…」widget 反推原版网格坐标，
  // 先找没被占的格子；单人是「模式…」、联机是「房间…」把右列占满了，
  // 那就按 24px 行距在网格末尾补一行，绝不盖住任何已有按钮。
  function rpPauseWidget() {
    const ui = state.game && state.game.ui;
    const scr = ui && ui.screen;
    if (!scr || !Array.isArray(scr.widgets) || scr.title !== '游戏菜单') return false;
    const ws = scr.widgets;
    if (ws.some((w) => w && w.__cometRp)) return true;
    const opt = ws.find((w) => w && typeof w.label === 'string' && w.label === '选项…');
    if (!opt || typeof opt.x !== 'number' || typeof opt.y !== 'number') return false;
    const lx = opt.x, top = opt.y - 72;
    const H = (ui && ui.h) || 240;
    const free = (x, y, w, h) => !ws.some((q) => q && typeof q.x === 'number' &&
      typeof q.y === 'number' && x < q.x + (q.w || 0) && x + w > q.x &&
      y < q.y + (q.h || 20) && y + h > q.y);
    // 优先填网格里真正空出来的 98px 格子
    const cells = [[lx + 106, opt.y, 98, 20], [lx + 106, top + 48, 98, 20],
                   [lx + 106, top + 24, 98, 20], [lx, top + 96, 98, 20]];
    let box = cells.find((c) => c[1] + c[3] < H - 24 && free(c[0], c[1], c[2], c[3]));
    if (!box) {
      const ys = ws.filter((w) => w && typeof w.y === 'number' && w.y < H - 40).map((w) => w.y);
      const ny = (ys.length ? Math.max.apply(null, ys) : opt.y) + 24;
      if (ny + 20 >= H - 24) return false;
      // 补行时跟「保存并退回标题屏幕」一样做成 204 整行，别留半边空着
      if (free(lx, ny, 204, 20)) box = [lx, ny, 204, 20];
      else if (free(lx, ny, 98, 20)) box = [lx, ny, 98, 20];
      else return false;
    }
    ws.push({
      x: box[0], y: box[1], w: box[2], h: box[3], label: '资源包…', __cometRp: true,
      tip: ['打开资源包界面'],
      onClick: () => rpMenuSetOpen(true),
    });
    return true;
  }
  // ==========================================================================
  // 原版资源包界面：直接复用游戏 MenuScreen.prototype 的 draw / mouseDown / key，
  // 所以标题、按钮九宫格、悬浮提示、ESC 返回全是游戏自己的东西，不是自制 DOM。
  // 左「可用」右「已选」，中间箭头移入移出 / 调优先级，支持多个包叠加。
  // ==========================================================================
  function rpMenuProto(ui) {
    if (rp.menuProto) return rp.menuProto;
    let p = ui && ui.screen ? Object.getPrototypeOf(ui.screen) : null;
    let base = null;
    while (p && p !== Object.prototype) {
      if (typeof p.draw === 'function' && typeof p.mouseDown === 'function' && typeof p.key === 'function') base = p;
      p = Object.getPrototypeOf(p);
    }
    if (base) rp.menuProto = base;
    return base;
  }
  // 游戏版本差异导致拿不到 MenuScreen.prototype 时的兜底：照样 duck-type 一个
  // 屏幕对象，只用 ui 自己的原语绘制，绝不退回到那个自制 DOM 弹窗。
  function rpOwnScreen(s, g, ui) {
    s.game = g; s.title = ''; s.widgets = []; s.parent = ui.screen || null;
    s.bgDim = 0.5; s.blurBg = true;
    s.selL = -1; s.selR = -1; s.scrollL = 0; s.scrollR = 0;
    s.layout = () => rpPackLayout(s, ui);
    s.draw = (u) => {
      if (u.menuBackground) u.menuBackground();
      if (s.box && u.listBackground) u.listBackground(s.box.top, s.box.bottom);
      for (const w of s.widgets) {
        if (w.text || w.slider) continue;
        if (u.button) u.button(w);
      }
      for (const w of s.widgets) {
        if (w.tip && u.hit && u.hit(w) && u.tooltip) {
          u.tooltip(w.tip.map((t) => ({ text: t })), u.mouse.x, u.mouse.y);
        }
      }
    };
    s.mouseDown = (u, mx, my, btn) => {
      if (btn !== 0) return;
      for (const w of s.widgets) {
        if (w.slider || w.text || w.enabled === false) continue;
        if (u.hit(w, mx, my)) { if (w.onClick) w.onClick(); return; }
      }
    };
    s.key = (u, ev) => {
      if (ev.key === 'Escape' && s.onEsc) { s.onEsc(); return true; }
      return false;
    };
    s.wheel = (u, dy) => {
      if (!s.box) return;
      if (u.mouse.x < s.box.cx) s.scrollL = Math.max(0, s.scrollL + Math.sign(dy));
      else s.scrollR = Math.max(0, s.scrollR + Math.sign(dy));
      s.layout();
    };
    s.onEsc = () => rpPackDone(s);
    s.close = () => { if (rp.screen === s) rp.screen = null; };
    return s;
  }
  function rpShort(s, w) {
    const n = Math.max(4, Math.floor(w / 9));
    return String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s);
  }
  function rpPackScreen() { return rp.screen; }
  function rpRefreshScreen() {
    const s = rp.screen;
    if (s && s.layout) s.layout();
  }
  function rpPackDone(s) {
    try {
      const ui = state.game && state.game.ui;
      if (ui) {
        if (s.parent) ui.open(s.parent);
        else if (typeof ui.close === 'function') ui.close();
      }
    } catch (e) { /* noop */ }
    rp.screen = null;
  }
  function rpOpenPackScreen() {
    try {
      const g = state.game;
      const ui = g && g.ui;
      if (!ui || typeof ui.open !== 'function') return false;
      const proto = rpMenuProto(ui);
      let s;
      if (proto) {
        s = Object.create(proto);
        s.game = g;
        s.title = '资源包';
        s.titleY = 12;
        s.widgets = [];
        s.parent = ui.screen || null;
        s.bgDim = 0.5;
        s.blurBg = true;
        s.selL = -1; s.selR = -1; s.scrollL = 0; s.scrollR = 0;
        s.layout = () => rpPackLayout(s, ui);
        s.drawExtra = (u) => { if (s.box && u.listBackground) u.listBackground(s.box.top, s.box.bottom); };
        s.wheel = (u, dy) => {
          if (!s.box) return;
          if (u.mouse.x < s.box.cx) s.scrollL = Math.max(0, s.scrollL + Math.sign(dy));
          else s.scrollR = Math.max(0, s.scrollR + Math.sign(dy));
          s.layout();
        };
        s.onEsc = () => rpPackDone(s);
        s.close = () => { if (rp.screen === s) rp.screen = null; };
      } else {
        s = rpOwnScreen({}, g, ui);
      }
      rp.screen = s;
      ui.open(s);
      return true;
    } catch (e) { rp.screen = null; return false; }
  }
  function rpPackLists() {
    const used = rp.order.map(rpPackById).filter(Boolean);
    const avail = rp.packs.filter((p) => rp.order.indexOf(p.id) < 0);
    return { used, avail };
  }
  function rpPackLayout(s, ui) {
    const cx = ui.w / 2;
    const top = 36, bottom = Math.max(top + 44, ui.h - 58);
    const gap = 8, aw = 22;
    const lw = Math.max(78, Math.floor((ui.w - 28 - gap * 2 - aw) / 2));
    const total = lw * 2 + aw + gap * 2;
    const lx = Math.max(2, Math.floor((ui.w - total) / 2));
    const ax = lx + lw + gap, rx = ax + aw + gap;
    s.box = { lx, ax, rx, lw, aw, top, bottom, cx };
    const { used, avail } = rpPackLists();
    const rows = Math.max(1, Math.floor((bottom - top - 4) / 22));
    s.scrollL = Math.min(s.scrollL, Math.max(0, avail.length - rows));
    s.scrollR = Math.min(s.scrollR, Math.max(0, used.length - rows));
    const ws = [];
    // 列标题用 MenuScreen 的 text widget，字体跟原版完全一致
    ws.push({ text: '可用的资源包', x: lx + lw / 2, y: top - 13, color: '#FFFFFF' });
    ws.push({ text: '已选的资源包', x: rx + lw / 2, y: top - 13, color: '#FFFFFF' });
    for (let i = 0; i < rows; i++) {
      const y = top + 2 + i * 22;
      const a = avail[i + s.scrollL];
      if (a) ws.push({
        x: lx, y, w: lw, h: 20, label: rpShort(a.name, lw),
        blue: s.selL === i + s.scrollL,
        tip: [a.name, '方块 ' + (a.nBlock || 0) + ' / 物品 ' + (a.nItem || 0) +
          ' / 界面 ' + (a.nGui || 0) + ' / 实体 ' + (a.nEntity || 0) +
          ' / 环境 ' + (a.nEnv || 0) + ' / 药水 ' + (a.nFx || 0),
          '未适配 ' + (a.nSkip || 0) + ' 张（游戏本身没有对应贴图）',
          (a.desc ? '说明：' + a.desc : (a.legacy ? '旧版存档，建议用「×」删除后重新导入 zip' : '选中后点 → 启用'))],
        onClick: () => { s.selL = i + s.scrollL; s.selR = -1; s.layout(); },
      });
      const b = used[i + s.scrollR];
      if (b) ws.push({
        x: rx, y, w: lw, h: 20, label: rpShort(b.name, lw),
        blue: s.selR === i + s.scrollR,
        tip: [b.name, '优先级 ' + (i + s.scrollR + 1) + '（越靠上越优先）'],
        onClick: () => { s.selR = i + s.scrollR; s.selL = -1; s.layout(); },
      });
    }
    const ay = Math.max(top + 4, top + Math.floor((bottom - top) / 2) - 46);
    const arrows = [
      ['→', '加入已选', () => rpPackAdd(s)],
      ['←', '移出已选', () => rpPackRemove(s)],
      ['↑', '提高优先级', () => rpPackMove(s, -1)],
      ['↓', '降低优先级', () => rpPackMove(s, 1)],
      ['×', '彻底删除选中的可用包', () => rpPackDelete(s)],
    ];
    arrows.forEach((a, i) => ws.push({
      x: ax, y: ay + i * 24, w: aw, h: 20, label: a[0], tip: [a[1]], onClick: a[2],
    }));
    const rpBg = 4;
    const rpBw = Math.max(64, Math.min(96, Math.floor((ui.w - 24 - rpBg * 2) / 3)));
    const rpX0 = Math.max(2, Math.floor((ui.w - (rpBw * 3 + rpBg * 2)) / 2));
    const rpBy = ui.h - 27;
    const rpX = (i) => rpX0 + i * (rpBw + rpBg);
    const rpR1 = rpBy - 24, rpR2 = rpBy;
    const rpRemember = getS('resourcepack', 'remember') !== false;
    const rpBtns = [
      ['导入 .zip…', ['可一次选中多个资源包'], () => rpImport()],
      ['内置暗色包', ['41KB 暗色 GUI 包'], () => rpLoadBuiltin()],
      ['全部清除', ['删除所有包并恢复原版贴图', '关浏览器重开也不会再自动装回来'], () => rpPackClearAll(s)],
      ['重新应用', ['重新合并已启用的包'], () => rpReapply()],
      ['记住选择: ' + (rpRemember ? '开' : '关'),
        [rpRemember ? '开：重开浏览器自动恢复上次选的包' : '关：重开浏览器就是原版，包仍留在列表里'],
        () => rpPackRemember(s)],
      ['完成', [], () => rpPackDone(s)],
    ];
    rpBtns.forEach((btn, i) => ws.push({
      x: rpX(i % 3), y: i < 3 ? rpR1 : rpR2, w: rpBw, h: 20,
      label: btn[0], tip: btn[1], onClick: btn[2],
    }));
    // 两个口径的覆盖率：既看游戏槽位覆盖，也看这个包自己有多少没法用
    const rpCv = rp.coverage || { used: 0, total: 0, pct: 0 };
    const rpSt = rp.stats || {};
    ws.push({
      text: rpShort('槽位覆盖 ' + rpCv.pct + '%（' + rpCv.used + '/' + rpCv.total + '）' +
        ' · 高清 ' + (rp.guiHi ? rp.guiHi.size : 0) + ' · 未适配 ' + (rpSt.skip || 0) +
        ' · 模型 ' + (rpSt.model || 0), ui.w - 16),
      x: cx, y: rpR1 - 16, color: '#AAAAAA',
    });
    s.widgets = ws;
  }
  function rpPackClearAll(s) {
    // rpClear 自己就是串行任务，外面再包一层 rpTask 会互相等待
    rpClear().then(() => {
      s.selL = -1; s.selR = -1; s.scrollL = 0; s.scrollR = 0;
      s.layout();
      pushNotification('材质包', '已全部清除，恢复原版贴图');
    });
  }
  function rpPackRemember(s) {
    const on = getS('resourcepack', 'remember') !== false;
    cfg.settings['resourcepack.remember'] = !on;
    __sCache = null;
    try { saveCfg(); } catch (e) { /* noop */ }
    // 只改「下次启动要不要自动套用」，不动当前这一局的效果
    s.layout();
    pushNotification('材质包', on ? '已关闭「记住选择」，重开浏览器将是原版' : '已开启「记住选择」');
  }
  function rpPackAdd(s) {
    const { avail } = rpPackLists();
    const pk = avail[s.selL];
    if (!pk) return;
    rpTask(async () => {
      rp.suspended = false;
      if (rp.order.indexOf(pk.id) < 0) rp.order.push(pk.id);
      s.selL = -1; s.selR = rp.order.length - 1;
      await rpSaveLibrary(); await rpRebuild();
    });
  }
  function rpPackRemove(s) {
    const id = rp.order[s.selR];
    if (!id) return;
    rpTask(async () => {
      rp.suspended = false;
      rp.order.splice(s.selR, 1);
      s.selR = -1; s.selL = 0;
      await rpSaveLibrary(); await rpRebuild();
    });
  }
  function rpPackMove(s, dir) {
    const i = s.selR, j = i + dir;
    if (i < 0 || j < 0 || j >= rp.order.length) return;
    rpTask(async () => {
      rp.suspended = false;
      const t = rp.order[i]; rp.order[i] = rp.order[j]; rp.order[j] = t;
      s.selR = j;
      await rpSaveLibrary(); await rpRebuild();
    });
  }
  function rpPackDelete(s) {
    const { avail } = rpPackLists();
    const pk = avail[s.selL];
    if (!pk) return;
    rpTask(async () => {
      rp.suspended = false;
      rp.packs = rp.packs.filter((p) => p !== pk);
      s.selL = -1;
      await rpSaveLibrary(); await rpRebuild();
    });
  }
  function rpMenuTick() {
    try {
      rpGuiTick();
      // 趁菜单还开着，把游戏 MenuScreen.prototype 记下来；之后从客户端模块按钮
      //（当前没有菜单屏）直接打开资源包界面也能复用原版绘制。
      if (!rp.menuProto) { try { rpMenuProto(state.game && state.game.ui); } catch (e) { /* noop */ } }
      const r = rpNativeWidget();      // 选项屏
      const p = rpPauseWidget();       // 暂停菜单（用户截图里那一屏）
      const native = r.native || p;
      const inMenu = r.inMenu || p;
      // 原生按钮生效后 DOM 胶囊彻底不显示；只有拿不到菜单 widget 时才兜底
      rpMenuBtn.classList.toggle('show', inMenu && !native && !rp.menuOpen);
      if (!inMenu && rp.menuOpen) rpMenuSetOpen(false);
      if (rp.menuOpen) rpMenuRender();
    } catch (e) { /* noop */ }
  }


  rpMenuBtn.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    rpMenuSetOpen(true);
  });
  rpmClose.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    rpMenuSetOpen(false);
  });
  rpmImport.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); rpImport(); });
  rpmReapply.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    // 旧判断只看方块贴图，GUI 包（0 张 block）会被误报「还没导入材质包」
    if (!rp.packs.length) { rpStatus('还没导入材质包'); return; }
    rpReapply();
  });
  rpmClear.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    rpClear();
  });
  rpmDemo.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    rpLoadBuiltin();
  });
  rpmToggleRow.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    rpSetEnabled(getS('resourcepack', 'enabled') === false);
  });
  // 拖放 zip 到面板
  rpMenu.addEventListener('dragover', (ev) => { ev.preventDefault(); ev.stopPropagation(); rpMenu.classList.add('drag'); });
  rpMenu.addEventListener('dragleave', (ev) => { ev.stopPropagation(); rpMenu.classList.remove('drag'); });
  rpMenu.addEventListener('drop', async (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    rpMenu.classList.remove('drag');
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (!f) return;
    rpImportFile(f);
  });
  rpMenu.addEventListener('mousedown', (ev) => ev.stopPropagation());
  rpMenu.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); });

  // 导入统一走 rpTask 串行队列，见 rpAddPack / rpImportFile。


  // ---- 内置轻量暗色 GUI 包（41KB / 56 张，精选自用户提供的 MandalasGUI+Dakmode） ----
  const BUILTIN_GUI_B64 = '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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALBR3rEuCDZiW/WRAAAAAElFTkSuQmCCUEsBAhQAFAAAAAAA7IVpXVuCLuhqAAAAagAAAAsAAAAAAAAAAAAAAIABAAAAAHBhY2subWNtZXRhUEsBAhQAFAAAAAAA7IVpXdLfh4SoAAAAqAAAADYAAAAAAAAAAAAAAIABkwAAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvYnV0dG9uLnBuZ1BLAQIUABQAAAAAAOyFaV052NQiqAAAAKgAAAA5AAAAAAAAAAAAAACAAY8BAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2J1dHRvbl9obC5wbmdQSwECFAAUAAAAAADshWldrLhpGJMAAACTAAAAOgAAAAAAAAAAAAAAgAGOAgAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9idXR0b25fZGlzLnBuZ1BLAQIUABQAAAAAAOyFaV1qfGTYlA4AAJQOAAA5AAAAAAAAAAAAAACAAXkDAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2ludmVudG9yeS5wbmdQSwECFAAUAAAAAADshWldjAqGtkYCAABGAgAAOgAAAAAAAAAAAAAAgAFkEgAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9nZW5lcmljXzU0LnBuZ1BLAQIUABQAAAAAAOyFaV1BGeAn9wkAAPcJAAA+AAAAAAAAAAAAAACAAQIVAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2NyYWZ0aW5nX3RhYmxlLnBuZ1BLAQIUABQAAAAAAOyFaV2WmddI9QMAAPUDAAA3AAAAAAAAAAAAAACAAVUfAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2Z1cm5hY2UucG5nUEsBAhQAFAAAAAAA7IVpXcSe9lciCwAAIgsAADkAAAAAAAAAAAAAAIABnyMAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvZ3VpX2FudmlsLnBuZ1BLAQIUABQAAAAAAOyFaV3jr9QAMgoAADIKAABEAAAAAAAAAAAAAACAARgvAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2d1aV9lbmNoYW50aW5nX3RhYmxlLnBuZ1BLAQIUABQAAAAAAOyFaV00WRzkJAwAACQMAAA4AAAAAAAAAAAAAACAAaw5AABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2d1aV9sb29tLnBuZ1BLAQIUABQAAAAAAOyFaV1TKO6SogkAAKIJAAA8AAAAAAAAAAAAAACAASZGAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2d1aV9zbWl0aGluZy5wbmdQSwECFAAUAAAAAADshWldk1X5VNMIAADTCAAAPwAAAAAAAAAAAAAAgAEiUAAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9ndWlfc3RvbmVjdXR0ZXIucG5nUEsBAhQAFAAAAAAA7IVpXVLd6RDoAAAA6AAAADYAAAAAAAAAAAAAAIABUlkAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvaG90YmFyLnBuZ1BLAQIUABQAAAAAAOyFaV2JdN0ZkAAAAJAAAAA6AAAAAAAAAAAAAACAAY5aAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2hvdGJhcl9zZWwucG5nUEsBAhQAFAAAAAAA7IVpXchCZuN8AAAAfAAAADkAAAAAAAAAAAAAAIABdlsAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvY3Jvc3NoYWlyLnBuZ1BLAQIUABQAAAAAAOyFaV3ynVlQrgAAAK4AAAA6AAAAAAAAAAAAAACAAUlcAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L29wdGlvbnNfYmcucG5nUEsBAhQAFAAAAAAA7IVpXfKdWVCuAAAArgAAADcAAAAAAAAAAAAAAIABT10AAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvbWVudV9iZy5wbmdQSwECFAAUAAAAAADshWldFjm/D7YAAAC2AAAANQAAAAAAAAAAAAAAgAFSXgAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC94cF9iZy5wbmdQSwECFAAUAAAAAADshWldza9EW8sAAADLAAAANQAAAAAAAAAAAAAAgAFbXwAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC94cF9mZy5wbmdQSwECFAAUAAAAAADshWldQGI6bG8AAABvAAAAOQAAAAAAAAAAAAAAgAF5YAAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9hdHRhY2tfYmcucG5nUEsBAhQAFAAAAAAA7IVpXTDvZ7GXAAAAlwAAAD8AAAAAAAAAAAAAAIABP2EAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvYXR0YWNrX3Byb2dyZXNzLnBuZ1BLAQIUABQAAAAAAOyFaV3FljKUqAAAAKgAAAA7AAAAAAAAAAAAAACAATNiAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2F0dGFja19mdWxsLnBuZ1BLAQIUABQAAAAAAOyFaV2d/HW/kAAAAJAAAAA5AAAAAAAAAAAAAACAATRjAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2VmZmVjdF9iZy5wbmdQSwECFAAUAAAAAADshWld43LI0JEAAACRAAAAQQAAAAAAAAAAAAAAgAEbZAAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9lZmZlY3RfYmdfYW1iaWVudC5wbmdQSwECFAAUAAAAAADshWld1bDegIoAAACKAAAAOgAAAAAAAAAAAAAAgAELZQAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9oZWFydF9mdWxsLnBuZ1BLAQIUABQAAAAAAOyFaV1QJ+QRhgAAAIYAAAA6AAAAAAAAAAAAAACAAe1lAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2hlYXJ0X2hhbGYucG5nUEsBAhQAFAAAAAAA7IVpXfX4LTCQAAAAkAAAAD8AAAAAAAAAAAAAAIABy2YAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvaGVhcnRfY29udGFpbmVyLnBuZ1BLAQIUABQAAAAAAOyFaV08TyDqiQAAAIkAAABDAAAAAAAAAAAAAACAAbhnAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2hlYXJ0X2Z1bGxfYmxpbmtpbmcucG5nUEsBAhQAFAAAAAAA7IVpXSeglWGGAAAAhgAAAEMAAAAAAAAAAAAAAIABomgAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvaGVhcnRfaGFsZl9ibGlua2luZy5wbmdQSwECFAAUAAAAAADshWld48mxU5MAAACTAAAASAAAAAAAAAAAAAAAgAGJaQAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9oZWFydF9jb250YWluZXJfYmxpbmtpbmcucG5nUEsBAhQAFAAAAAAA7IVpXVokc1GKAAAAigAAAEQAAAAAAAAAAAAAAIABgmoAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvaGVhcnRfYWJzb3JiaW5nX2Z1bGwucG5nUEsBAhQAFAAAAAAA7IVpXen4jG6KAAAAigAAAEMAAAAAAAAAAAAAAIABbmsAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvaGVhcnRfcG9pc29uZWRfZnVsbC5wbmdQSwECFAAUAAAAAADshWldLqCCcooAAACKAAAAQwAAAAAAAAAAAAAAgAFZbAAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9oZWFydF93aXRoZXJlZF9mdWxsLnBuZ1BLAQIUABQAAAAAAOyFaV2x1q2higAAAIoAAABBAAAAAAAAAAAAAACAAURtAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2hlYXJ0X2Zyb3plbl9mdWxsLnBuZ1BLAQIUABQAAAAAAOyFaV3TDLODmwAAAJsAAAA5AAAAAAAAAAAAAACAAS1uAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2Zvb2RfZnVsbC5wbmdQSwECFAAUAAAAAADshWldcGkqd5YAAACWAAAAOQAAAAAAAAAAAAAAgAEfbwAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9mb29kX2hhbGYucG5nUEsBAhQAFAAAAAAA7IVpXTenNyGSAAAAkgAAADoAAAAAAAAAAAAAAIABDHAAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvZm9vZF9lbXB0eS5wbmdQSwECFAAUAAAAAADshWldzHcpyKAAAACgAAAAQAAAAAAAAAAAAAAAgAH2cAAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9mb29kX2Z1bGxfaHVuZ2VyLnBuZ1BLAQIUABQAAAAAAOyFaV1gMtqSmgAAAJoAAABAAAAAAAAAAAAAAACAAfRxAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2Zvb2RfaGFsZl9odW5nZXIucG5nUEsBAhQAFAAAAAAA7IVpXZsxNkWSAAAAkgAAAEEAAAAAAAAAAAAAAIAB7HIAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvZm9vZF9lbXB0eV9odW5nZXIucG5nUEsBAhQAFAAAAAAA7IVpXZ11TDKVAAAAlQAAADoAAAAAAAAAAAAAAIAB3XMAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvYXJtb3JfZnVsbC5wbmdQSwECFAAUAAAAAADshWldxiCtv6AAAACgAAAAOgAAAAAAAAAAAAAAgAHKdAAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9hcm1vcl9oYWxmLnBuZ1BLAQIUABQAAAAAAOyFaV0decZfkAAAAJAAAAA7AAAAAAAAAAAAAACAAcJ1AABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2FybW9yX2VtcHR5LnBuZ1BLAQIUABQAAAAAAOyFaV2+fqbJnAAAAJwAAAAzAAAAAAAAAAAAAACAAat2AABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2Fpci5wbmdQSwECFAAUAAAAAADshWldcQLqZo0AAACNAAAAPAAAAAAAAAAAAAAAgAGYdwAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9haXJfYnVyc3RpbmcucG5nUEsBAhQAFAAAAAAA7IVpXQa6cMKQAAAAkAAAADkAAAAAAAAAAAAAAIABf3gAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvYWlyX2VtcHR5LnBuZ1BLAQIUABQAAAAAAOyFaV2suGkYkwAAAJMAAAA2AAAAAAAAAAAAAACAAWZ5AABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L3NsaWRlci5wbmdQSwECFAAUAAAAAADshWldsYDNyY8AAACPAAAAPQAAAAAAAAAAAAAAgAFNegAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9zbGlkZXJfaGFuZGxlLnBuZ1BLAQIUABQAAAAAAOyFaV1OmLA7jwAAAI8AAABAAAAAAAAAAAAAAACAATd7AABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L3NsaWRlcl9oYW5kbGVfaGwucG5nUEsBAhQAFAAAAAAA7IVpXW8QlM6IAAAAiAAAADoAAAAAAAAAAAAAAIABJHwAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvdGV4dF9maWVsZC5wbmdQSwECFAAUAAAAAADshWldzmja0ogAAACIAAAAPQAAAAAAAAAAAAAAgAEEfQAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC90ZXh0X2ZpZWxkX2hsLnBuZ1BLAQIUABQAAAAAAOyFaV17WDnboQAAAKEAAAAzAAAAAAAAAAAAAACAAed9AABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L3RhYi5wbmdQSwECFAAUAAAAAADshWldeA1ngKEAAAChAAAANgAAAAAAAAAAAAAAgAHZfgAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC90YWJfaGwucG5nUEsBAhQAFAAAAAAA7IVpXVpARTQ2AgAANgIAADkAAAAAAAAAAAAAAIABzn8AAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvdGFiX2l0ZW1zLnBuZ1BLAQIUABQAAAAAAOyFaV0NZnga5wMAAOcDAAA9AAAAAAAAAAAAAACAAVuCAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L3RhYl9pbnZlbnRvcnkucG5nUEsBAhQAFAAAAAAA7IVpXUaF/0lVAgAAVQIAAD8AAAAAAAAAAAAAAIABnYYAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvdGFiX2l0ZW1fc2VhcmNoLnBuZ1BLBQYAAAAAOQA5AFMXAABPiQAAAAA=';
  function rpLoadBuiltin() {
    try {
      const bin = (typeof W.atob === 'function' ? W.atob : atob)(BUILTIN_GUI_B64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      rpImportFile({ name: 'opusmc-dark-gui-lite.zip', arrayBuffer: async () => bytes.buffer });
      pushNotification('材质包', '正在载入内置暗色 GUI 包…');
    } catch (e) {
      rpStatus('内置包载入失败：' + e.message);
    }
  }

  // ---- 样式（彗星灰阶主题） ----------
  const css = `
    #__comet_gui {
      position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif; user-select: none; display: none;
    }
    #__comet_gui.visible { display: block; }
    #__comet_gui .cm-dim {
      position: absolute; inset: 0; background: rgba(0,0,0,0.49);
      opacity: 0; transition: opacity .25s ease;
    }
    #__comet_gui.any-open .cm-dim { opacity: 1; }
    #__comet_stage {
      position: absolute; left: 0; top: 0; width: 50vw; height: 50vh;
      transform: scale(2); transform-origin: 0 0; pointer-events: none;
    }
    #__comet_panel {
      position: absolute; width: 400px; height: 250px; border-radius: 15px; overflow: hidden;
      pointer-events: auto; box-sizing: border-box;
      background: linear-gradient(135deg, #1a1a1a 0%, #000 42%, #1a1a1a 70%, #000 100%);
      opacity: 0; transform: translateY(-15px);
      transition: opacity .25s ease, transform .25s cubic-bezier(.2,.8,.3,1);
      box-shadow: 0 12px 40px rgba(0,0,0,0.45);
    }
    #__comet_gui.classic-open #__comet_panel { opacity: 1; transform: translateY(0); }
    #__comet_gui:not(.classic-open) #__comet_panel { pointer-events: none; }
    #__comet_gui.closing #__comet_panel { opacity: 0; transform: translateY(30px); transition-duration: .2s; }

    .cm-pane {
      position: absolute; box-sizing: border-box;
      border: .5px solid rgba(55,55,55,.84); background: rgba(128,128,128,.098);
    }
    .cm-side { left: 7.5px; top: 7.5px; width: 80px; height: 235px; border-radius: 10px; }
    .cm-header { left: 92px; top: 7.5px; width: 300px; height: 25px; border-radius: 8px; }
    .cm-mods { left: 92px; top: 38px; width: 120px; height: 204px; border-radius: 6px; background: rgba(64,64,64,.059); }
    .cm-sets { left: 218px; top: 38px; width: 172px; height: 204px; border-radius: 7px; background: rgba(64,64,64,.059); }
    .cm-soon {
      position: absolute; left: 12.5px; top: 220.5px; width: 70px; height: 17px;
      box-sizing: border-box; border: .5px solid rgba(55,55,55,.84); border-radius: 5px;
      display: flex; align-items: center; justify-content: center;
      font-size: 6px; font-weight: 700; color: rgba(150,150,150,.78);
    }
    .cm-hlabel {
      position: absolute; left: 100px; top: 16px; font-size: 7px; font-weight: 700;
      color: rgba(128,128,128,.5); letter-spacing: .3px; transition: opacity .15s;
    }
    .cm-searchbox {
      position: absolute; left: 315px; top: 12.5px; width: 70px; height: 15px; box-sizing: border-box;
      border: .5px solid rgba(110,110,110,.55); border-radius: 4px; background: rgba(255,255,255,.03);
      transition: border-color .2s, background .2s;
    }
    .cm-searchbox.active { border-color: rgba(210,210,210,.9); background: rgba(255,255,255,.07); }
    .cm-searchbox input {
      position: absolute; left: 4px; top: 0; width: 46px; height: 14px; padding: 0; margin: 0;
      background: transparent; border: none; outline: none; color: #d2d2dc;
      font-family: inherit; font-size: 5px; caret-color: #b4b4b9;
    }
    .cm-searchbox input::placeholder { color: rgba(160,160,160,.9); }
    .cm-sdiv { position: absolute; left: 52px; top: 3.5px; width: .5px; height: 8px; background: rgba(128,128,128,.1); }
    .cm-sico { position: absolute; left: 55px; top: 3px; font-size: 8px; line-height: 9px; color: rgba(150,150,150,.8); }

    .cm-cat {
      position: absolute; left: 10px; width: 85px; height: 13px; display: flex; align-items: center;
      gap: 4px; padding-left: 7px; box-sizing: border-box; cursor: pointer;
      font-size: 6px; font-weight: 700; color: rgba(128,128,128,.5);
      transition: padding-left .25s ease, color .25s ease;
    }
    .cm-cat .cm-ball {
      position: absolute; left: 2px; top: 5px; width: 3px; height: 3px; border-radius: 2px;
      background: rgba(255,255,255,.78); opacity: 0; transition: opacity .2s;
    }
    .cm-cat .cm-ico { font-size: 6px; font-weight: 400; color: inherit; width: 6px; text-align: center; }
    .cm-cat .cm-cname { white-space: nowrap; }
    .cm-cat .cm-line {
      position: absolute; left: 7px; right: 12px; bottom: 0; height: .5px; background: #fff;
      opacity: 0; transform: scaleX(0); transform-origin: left; transition: transform .25s ease, opacity .25s;
    }
    .cm-cat.sel { padding-left: 12px; color: rgba(255,255,255,.9); }
    .cm-cat.sel .cm-ball { opacity: 1; }
    .cm-cat.sel .cm-line { opacity: .24; transform: scaleX(1); }
    .cm-cat:hover { color: rgba(255,255,255,.7); }

    .cm-sec {
      position: absolute; left: 15px; width: 65px; height: 8px; display: flex; align-items: center;
      font-size: 5px; font-weight: 700; color: rgba(150,150,150,.39); letter-spacing: .3px;
    }
    .cm-sec::before, .cm-sec::after { content: ""; width: 18px; height: .5px; background: rgba(255,255,255,.157); flex: 0 0 18px; }
    .cm-sec span { flex: 1; text-align: center; white-space: nowrap; }

    .cm-modscroll {
      position: absolute; left: 3px; right: 3px; top: 5px; bottom: 3px;
      overflow-y: auto; scrollbar-width: none; padding: 0;
    }
    .cm-modscroll::-webkit-scrollbar { display: none; }
    .cm-row {
      position: relative; width: 100%; height: 22px; margin-bottom: 2px; box-sizing: border-box;
      display: flex; align-items: center; gap: 3px; padding-right: 4px; border-radius: 5px;
      background: rgba(64,64,64,.098); border: .5px solid transparent; cursor: pointer;
      font-size: 6px; font-weight: 700; color: rgba(128,128,128,.706);
      transition: background .12s, color .12s, border-color .12s;
    }
    .cm-row:hover { background: rgba(100,100,100,.176); }
    .cm-row.sel { background: rgba(71,71,71,.216); border-color: rgba(200,200,200,.31); animation: cm-pulse 2.4s ease-in-out infinite; }
    .cm-row.on { color: #ffffff; }
    .cm-row .cm-ball {
      position: absolute; left: 4px; top: 9.5px; width: 3px; height: 3px; border-radius: 2px;
      background: #fff; opacity: 0; transition: opacity .15s;
    }
    .cm-row.on .cm-ball { opacity: .95; }
    .cm-row .cm-rname { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cm-row .cm-bind {
      height: 9px; line-height: 8px; padding: 0 2.5px; box-sizing: border-box;
      border: .5px solid rgba(80,80,85,.9); border-radius: 2px; background: rgba(50,50,55,.25);
      font-size: 4.5px; font-weight: 700; color: #a0a0a8; white-space: nowrap;
    }
    .cm-row .cm-spacer { flex: 1; }
    .cm-row .cm-star { font-size: 7px; line-height: 1; color: rgba(50,50,50,.47); transition: color .15s; }
    .cm-row .cm-star:hover { color: rgba(255,255,255,.65); }
    .cm-row .cm-star.fav { color: #ffd700; }
    .cm-row .cm-gear { font-size: 6px; line-height: 1; width: 8px; text-align: center; color: rgba(150,150,150,.47); }
    @keyframes cm-pulse { 0%,100% { border-color: rgba(200,200,200,.31); } 50% { border-color: rgba(200,200,200,.07); } }

    .cm-stitle { position: absolute; left: 8px; top: 8px; font-size: 7px; font-weight: 700; color: rgba(255,255,255,.78); }
    .cm-sdesc {
      position: absolute; left: 15px; top: 20px; width: 150px; font-size: 5px; font-weight: 700;
      color: rgba(128,128,128,.588); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .cm-sdesc::before { content: "ⓘ"; position: absolute; left: -7px; top: -.5px; font-size: 5px; }
    .cm-divider { position: absolute; left: 8px; top: 30px; width: 156px; height: 1.25px; background: rgba(64,64,64,.25); }
    .cm-set-scroll { position: absolute; left: 8px; top: 31px; width: 156px; bottom: 3px; overflow-y: auto; scrollbar-width: none; }
    .cm-set-scroll::-webkit-scrollbar { display: none; }
    .cm-set-content { position: relative; width: 156px; }
    .cm-set { position: absolute; left: 0; width: 156px; font-size: 6px; font-weight: 700; color: rgba(210,210,220,.78); }
    .cm-set .cm-sicon { position: absolute; left: 0; top: 1px; width: 7px; text-align: center; font-size: 6px; color: rgba(150,150,150,.6); }
    .cm-set .cm-sname { position: absolute; left: 9.5px; top: .5px; white-space: nowrap; }
    .cm-set .cm-sldesc {
      position: absolute; left: 0; top: 8.5px; width: 88px; font-size: 5px; font-weight: 700;
      color: rgba(128,128,128,.588); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .cm-switch {
      position: absolute; right: 2px; top: 3px; width: 16px; height: 10px; box-sizing: border-box;
      border: .5px solid rgba(155,155,155,.31); border-radius: 3px; background: rgba(55,55,55,.1);
      transition: border-color .2s;
    }
    .cm-switch i {
      position: absolute; left: 1.5px; top: 1.5px; width: 6px; height: 6px; border-radius: 3px;
      background: rgba(59,59,59,.78); transition: transform .2s ease, background .2s;
    }
    .cm-switch.on i { transform: translateX(6px); background: rgba(200,200,200,.9); }
    .cm-switch.on { border-color: rgba(200,200,200,.55); }
    .cm-value {
      position: absolute; right: 3px; top: 1.5px; font-size: 5px; font-weight: 700;
      color: rgba(110,110,120,1); white-space: nowrap;
    }
    .cm-value b { color: rgba(190,190,200,.95); font-weight: 700; }
    .cm-colorbox { position: absolute; right: 2px; top: 2px; display: flex; align-items: center; gap: 2px; cursor: pointer; }
    .cm-colorbox .cm-csw {
      width: 10px; height: 10px; border-radius: 2px; box-sizing: border-box;
      border: .5px solid rgba(200,200,200,.55); background: #ff6b6b;
    }
    .cm-colorbox .cm-csw.auto { background: linear-gradient(135deg, #ff6b6b 0 50%, #4fc3f7 50% 100%); opacity: .55; }
    .cm-colorbox .cm-ctxt { font-size: 4.5px; color: rgba(175,175,185,.9); white-space: nowrap; }
    .cm-colorbox .cm-cclr { font-size: 6.5px; line-height: 1; color: rgba(160,160,170,.7); padding: 0 1px; }
    .cm-colorbox .cm-cclr:hover { color: #fff; }
    .cm-colorbox .cm-cinput { position: absolute; right: 0; top: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
    .cm-bindrow .cm-bindv {
      position: absolute; right: 2px; top: 1px; height: 9.5px; line-height: 8.5px; padding: 0 3px; box-sizing: border-box;
      font-size: 5px; color: #cfcfd6; border: .5px solid rgba(90,90,95,.9); border-radius: 2px; background: rgba(50,50,55,.25);
      white-space: nowrap;
    }
    .cm-track {
      position: absolute; left: 1px; width: 154px; top: 11px; height: 2.5px; border-radius: 1px;
      background: rgba(60,60,65,.9); cursor: ew-resize;
    }
    .cm-track .cm-fill { position: absolute; left: 0; top: 0; height: 100%; border-radius: 1px; background: rgba(180,180,190,.85); }
    .cm-track .cm-knob {
      position: absolute; top: 50%; width: 5px; height: 5px; margin-left: -2.5px; margin-top: -2.5px;
      border-radius: 50%; background: #d8d8dc;
    }
    .cm-select {
      position: absolute; right: 2px; top: 3px; width: 65px; height: 10px; box-sizing: border-box;
      border: .5px solid rgba(55,55,55,.84); border-radius: 3px; background: rgba(55,55,55,.1);
      display: flex; align-items: center; padding: 0 3px; cursor: pointer; font-size: 5px;
    }
    .cm-select .cm-sk { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: rgba(190,190,200,.95); }
    .cm-select .cm-arrow { color: rgba(150,150,150,.8); font-size: 5px; }
    .cm-options {
      position: absolute; right: 2px; top: 15px; width: 65px; z-index: 5;
      background: rgba(30,30,30,.92); border: .5px solid rgba(90,90,90,.5); border-radius: 3px;
      box-shadow: 0 3px 8px rgba(0,0,0,.5);
    }
    .cm-option { position: relative; height: 14px; display: flex; align-items: center; padding-left: 5px; cursor: pointer; font-size: 5px; }
    .cm-option:hover { background: rgba(255,255,255,.07); }
    .cm-option .cm-obox {
      width: 6px; height: 6px; margin-right: 4px; box-sizing: border-box;
      border: .5px solid rgba(155,155,155,.5); border-radius: 1.5px;
    }
    .cm-option.sel .cm-obox { background: rgba(210,210,210,.9); border-color: rgba(210,210,210,.9); }
    .cm-option .cm-otxt { color: rgba(210,210,220,.9); }
    .cm-text {
      position: absolute; right: 2px; top: 3px; width: 65px; height: 10px; box-sizing: border-box;
      border: .5px solid rgba(55,55,55,.84); border-radius: 3px; background: rgba(55,55,55,.1);
    }
    .cm-text input {
      width: 100%; height: 100%; margin: 0; padding: 0 3px; box-sizing: border-box;
      background: transparent; border: none; outline: none; color: #d2d2dc;
      font-family: inherit; font-size: 5px; font-weight: 700;
    }
    .cm-btn {
      position: absolute; left: 0; top: 0; width: 156px; height: 16px; box-sizing: border-box;
      border: .5px solid rgba(90,90,90,.6); border-radius: 4px; background: rgba(64,64,64,.12);
      display: flex; align-items: center; justify-content: center; cursor: pointer;
      font-size: 6px; font-weight: 700; color: rgba(210,210,220,.85);
      transition: background .15s;
    }
    .cm-btn:hover { background: rgba(140,140,140,.2); }

    .cm-results {
      position: absolute; left: 92px; top: 38px; width: 300px; height: 204px; box-sizing: border-box;
      border: .5px solid rgba(55,55,55,.84); border-radius: 6px;
      background: linear-gradient(135deg, #141414, #000 70%);
      overflow-y: auto; scrollbar-width: none; padding: 5px 6px; display: none; z-index: 3;
    }
    .cm-results::-webkit-scrollbar { display: none; }
    .cm-results.show { display: block; }
    .cm-resrow {
      height: 22px; margin-bottom: 2px; box-sizing: border-box; border-radius: 5px;
      background: rgba(64,64,64,.098); border: .5px solid transparent;
      display: flex; align-items: center; padding: 0 6px; gap: 4px; cursor: pointer;
      font-size: 6px; font-weight: 700; color: rgba(180,180,180,.85);
    }
    .cm-resrow:hover { background: rgba(100,100,100,.176); }
    .cm-resrow.on { color: #fff; }
    .cm-resrow .cm-rcat { flex: 1; text-align: right; font-size: 5px; color: rgba(128,128,128,.6); }
    .cm-rempty { padding: 8px; font-size: 6px; color: rgba(128,128,128,.7); }

    #__comet_hudstage {
      position: fixed; left: 0; top: 0; width: 50vw; height: 50vh; transform: scale(2); transform-origin: 0 0;
      pointer-events: none; z-index: 2147483646; font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
      user-select: none;
    }
    .cm-hud { position: absolute; display: flex; align-items: center; pointer-events: none; }
    .cm-gui-open .cm-hud { pointer-events: auto; cursor: move; }
    .cm-gui-open .cm-target { pointer-events: auto; cursor: move; }
    .cm-hudicon {
      width: 20px; height: 20px; margin-right: 2px; box-sizing: border-box; border-radius: 5px;
      border: .35px solid #5a5a5a; background: linear-gradient(135deg, #343434, #161616 55%, #343434);
      display: flex; align-items: center; justify-content: center; font-size: 9px; color: rgba(235,235,235,.9);
    }
    .cm-hudbox {
      height: 20px; box-sizing: border-box; border-radius: 5px; border: .35px solid #5a5a5a;
      background: linear-gradient(135deg, #343434, #161616 55%, #343434);
      display: flex; align-items: center; padding: 0 7px; gap: 3px;
      font-size: 6px; font-weight: 700; color: rgba(240,240,240,.95); white-space: nowrap;
    }
    .cm-hudbox .cm-hval { color: #ffffff; }
    .cm-hudbox .cm-hlbl { color: rgba(160,160,160,.9); font-weight: 400; }
    .cm-hudbox .cm-hsep { color: rgba(160,160,160,.6); font-weight: 400; }
    .cm-hudbox .cm-hico { color: rgba(200,200,200,.85); font-weight: 400; }

    .cm-target {
      width: 112px; height: 40px; padding: 0; box-sizing: border-box; border-radius: 6px;
      border: .35px solid #5a5a5a; background: linear-gradient(135deg, #343434, #161616 55%, #343434);
      position: absolute; display: block;
    }
    .cm-target .cm-tface {
      position: absolute; left: 9px; top: 8px; width: 24px; height: 24px; box-sizing: border-box;
      border-radius: 4px; border: .35px solid #5a5a5a;
      background: linear-gradient(135deg, #3d3d3d, #1a1a1a);
      display: flex; align-items: center; justify-content: center; font-size: 13px; color: rgba(230,230,230,.85);
    }
    .cm-target .cm-tname { position: absolute; left: 39px; top: 11px; width: 50px; font-size: 5.5px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cm-target .cm-thp { position: absolute; right: 9px; top: 11px; font-size: 5px; font-weight: 700; color: rgba(200,200,200,.95); }
    .cm-target .cm-tbar { position: absolute; left: 39px; top: 25px; width: 64px; height: 4px; border-radius: 2px; background: rgba(0,0,0,.55); overflow: hidden; }
    .cm-target .cm-tfill {
      height: 100%; width: 100%; border-radius: 2px;
      background: linear-gradient(90deg, #9b9b9b, #ffffff, #9b9b9b); background-size: 200% 100%;
      animation: cm-wave 1.6s linear infinite;
    }
    @keyframes cm-wave { from { background-position: 0 0; } to { background-position: 200% 0; } }

    .cm-array { position: absolute; right: 8px; top: 8px; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
    .cm-arr {
      height: 14px; box-sizing: border-box; border-radius: 4px; border: .35px solid #5a5a5a;
      background: linear-gradient(135deg, #343434, #161616 55%, #343434);
      display: flex; align-items: center; padding: 0 6px; font-size: 5.5px; font-weight: 700;
      color: rgba(240,240,240,.95); white-space: nowrap;
    }
    .cm-notes { position: absolute; right: 8px; bottom: 132px; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
    .cm-note {
      width: 108px; height: 24px; padding: 3px 6px; box-sizing: border-box; border-radius: 5px;
      border: .35px solid #5a5a5a; background: linear-gradient(135deg, #343434, #161616 55%, #343434);
      display: flex; flex-direction: column; justify-content: center;
      animation: cm-notein .2s ease;
    }
    .cm-note .cm-ntitle { font-size: 6px; font-weight: 700; color: #fff; line-height: 1.1; }
    .cm-note .cm-ndesc { font-size: 5px; font-weight: 400; color: rgba(160,160,160,.95); line-height: 1.2; }
    .cm-note.out { opacity: 0; transform: translateX(12px); transition: .25s; }
    @keyframes cm-notein { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: none; } }

    #__comet_esp { position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 2147483646; pointer-events: none; }
    #__comet_radar {
      position: fixed; right: 12px; bottom: 12px; width: 120px; height: 120px; z-index: 2147483645;
      pointer-events: none; border-radius: 50%;
    }
    #__comet_compass {
      position: fixed; left: 50%; top: 8px; width: 300px; height: 40px; margin-left: -150px;
      z-index: 2147483645; pointer-events: none; border-radius: 5px;
    }

    /* ---------- 主题切换（默认 / 液态玻璃） ---------- */
    .cm-theme {
      position: absolute; left: 12.5px; top: 198px; width: 70px; height: 17px; box-sizing: border-box;
      display: flex; padding: 1.5px; gap: 1px; border-radius: 5px;
      border: .5px solid rgba(55,55,55,.84); background: rgba(55,55,55,.1);
    }
    .cm-theme .cm-topt {
      flex: 1; display: flex; align-items: center; justify-content: center; border-radius: 3.5px;
      font-size: 5.5px; font-weight: 700; letter-spacing: .2px; color: rgba(150,150,150,.85);
      cursor: pointer; transition: background .18s ease, color .18s ease;
    }
    .cm-theme .cm-topt:hover { color: rgba(255,255,255,.85); }
    .cm-theme .cm-topt.on { background: rgba(190,190,200,.22); color: #fff; }

    /* ---------- 液态玻璃主题（Apple Liquid Glass 风格） ---------- */
    #__comet_gui.glass .cm-dim {
      background: radial-gradient(120% 120% at 50% 0%, rgba(10,10,14,.16), rgba(6,6,10,.44));
      backdrop-filter: blur(3px);
      -webkit-backdrop-filter: blur(3px);
    }
    #__comet_gui.glass #__comet_panel {
      background: linear-gradient(135deg, rgba(255,255,255,.26) 0%, rgba(255,255,255,.09) 36%, rgba(255,255,255,.15) 64%, rgba(255,255,255,.05) 100%);
      border: .5px solid rgba(255,255,255,.42);
      backdrop-filter: blur(30px) saturate(180%) brightness(1.05);
      -webkit-backdrop-filter: blur(30px) saturate(180%) brightness(1.05);
      box-shadow: 0 20px 60px rgba(0,0,0,.42), 0 2px 10px rgba(0,0,0,.22),
        inset 0 1px 0 rgba(255,255,255,.52), inset 0 -1px 0 rgba(255,255,255,.14);
    }
    /* 镜面高光：贴在玻璃上的一层反光，不挡鼠标 */
    .cm-sheen { display: none; }
    #__comet_gui.glass .cm-sheen {
      display: block; position: absolute; inset: 0; border-radius: 14.5px; pointer-events: none; z-index: 0;
      background:
        radial-gradient(90% 62% at 16% -10%, rgba(255,255,255,.34), transparent 62%),
        radial-gradient(72% 52% at 102% 110%, rgba(255,255,255,.16), transparent 60%),
        linear-gradient(200deg, rgba(255,255,255,.1) 0%, transparent 34%);
    }
    #__comet_gui.glass #__comet_panel > * { z-index: 1; }
    #__comet_gui.glass .cm-pane {
      border-color: rgba(255,255,255,.32);
      background: linear-gradient(150deg, rgba(255,255,255,.18), rgba(255,255,255,.055));
      box-shadow: inset 0 .5px 0 rgba(255,255,255,.34), 0 3px 12px rgba(0,0,0,.14);
      backdrop-filter: blur(10px) saturate(150%);
      -webkit-backdrop-filter: blur(10px) saturate(150%);
    }
    #__comet_gui.glass .cm-mods,
    #__comet_gui.glass .cm-sets { background: rgba(255,255,255,.05); }

    #__comet_gui.glass .cm-hlabel { color: rgba(255,255,255,.72); text-shadow: 0 1px 2px rgba(0,0,0,.35); }
    #__comet_gui.glass .cm-cat { color: rgba(255,255,255,.62); }
    #__comet_gui.glass .cm-cat:hover,
    #__comet_gui.glass .cm-cat.sel { color: #fff; }
    #__comet_gui.glass .cm-cat.sel .cm-line { opacity: .5; }
    #__comet_gui.glass .cm-sec { color: rgba(255,255,255,.5); }
    #__comet_gui.glass .cm-sec::before,
    #__comet_gui.glass .cm-sec::after { background: rgba(255,255,255,.25); }

    #__comet_gui.glass .cm-searchbox,
    #__comet_gui.glass .cm-select,
    #__comet_gui.glass .cm-text,
    #__comet_gui.glass .cm-soon {
      border-color: rgba(255,255,255,.34);
      background: rgba(255,255,255,.1);
      box-shadow: inset 0 .5px 0 rgba(255,255,255,.32);
    }
    #__comet_gui.glass .cm-theme { border-color: rgba(255,255,255,.34); background: rgba(255,255,255,.1); }
    #__comet_gui.glass .cm-theme .cm-topt { color: rgba(255,255,255,.7); }
    #__comet_gui.glass .cm-theme .cm-topt.on { background: rgba(255,255,255,.3); color: #fff; }
    #__comet_gui.glass .cm-searchbox input,
    #__comet_gui.glass .cm-text input { color: #fff; }
    #__comet_gui.glass .cm-searchbox input::placeholder { color: rgba(255,255,255,.6); }
    #__comet_gui.glass .cm-sdiv { background: rgba(255,255,255,.2); }
    #__comet_gui.glass .cm-sico,
    #__comet_gui.glass .cm-soon { color: rgba(255,255,255,.7); }

    #__comet_gui.glass .cm-row {
      background: rgba(255,255,255,.1);
      border-color: rgba(255,255,255,.1);
      color: rgba(255,255,255,.72);
      box-shadow: inset 0 .5px 0 rgba(255,255,255,.22);
    }
    #__comet_gui.glass .cm-row:hover { background: rgba(255,255,255,.2); }
    #__comet_gui.glass .cm-row.sel {
      background: rgba(255,255,255,.24); border-color: rgba(255,255,255,.46); animation: none;
    }
    #__comet_gui.glass .cm-row.on { color: #fff; }
    #__comet_gui.glass .cm-row .cm-bind {
      border-color: rgba(255,255,255,.35); background: rgba(255,255,255,.12); color: #fff;
    }
    #__comet_gui.glass .cm-row .cm-star { color: rgba(255,255,255,.45); }
    #__comet_gui.glass .cm-row .cm-gear { color: rgba(255,255,255,.55); }

    #__comet_gui.glass .cm-stitle { color: #fff; }
    #__comet_gui.glass .cm-sdesc,
    #__comet_gui.glass .cm-set .cm-sldesc { color: rgba(255,255,255,.62); }
    #__comet_gui.glass .cm-divider { background: rgba(255,255,255,.16); }
    #__comet_gui.glass .cm-set { color: rgba(255,255,255,.86); }
    #__comet_gui.glass .cm-set .cm-sicon { color: rgba(255,255,255,.6); }
    #__comet_gui.glass .cm-value { color: rgba(255,255,255,.62); }
    #__comet_gui.glass .cm-value b { color: #fff; }
    #__comet_gui.glass .cm-track { background: rgba(255,255,255,.18); }
    #__comet_gui.glass .cm-track .cm-fill { background: rgba(255,255,255,.85); }
    #__comet_gui.glass .cm-track .cm-knob { background: #fff; }
    #__comet_gui.glass .cm-switch {
      border-color: rgba(255,255,255,.4); background: rgba(255,255,255,.1);
      box-shadow: inset 0 .5px 0 rgba(255,255,255,.28);
    }
    #__comet_gui.glass .cm-switch i { background: rgba(255,255,255,.45); }
    #__comet_gui.glass .cm-switch.on { border-color: rgba(255,255,255,.72); }
    #__comet_gui.glass .cm-switch.on i { background: #fff; }

    #__comet_gui.glass .cm-options {
      background: rgba(24,24,30,.55);
      border-color: rgba(255,255,255,.34);
      backdrop-filter: blur(20px) saturate(170%);
      -webkit-backdrop-filter: blur(20px) saturate(170%);
      box-shadow: 0 8px 24px rgba(0,0,0,.42), inset 0 .5px 0 rgba(255,255,255,.28);
    }
    #__comet_gui.glass .cm-option:hover { background: rgba(255,255,255,.18); }
    #__comet_gui.glass .cm-option .cm-otxt { color: #fff; }
    #__comet_gui.glass .cm-option .cm-obox { border-color: rgba(255,255,255,.5); }
    #__comet_gui.glass .cm-btn {
      border-color: rgba(255,255,255,.34); background: rgba(255,255,255,.12); color: #fff;
      box-shadow: inset 0 .5px 0 rgba(255,255,255,.34);
    }
    #__comet_gui.glass .cm-btn:hover { background: rgba(255,255,255,.22); }
    #__comet_gui.glass .cm-results {
      border-color: rgba(255,255,255,.34);
      background: rgba(18,18,24,.5);
      backdrop-filter: blur(24px) saturate(170%);
      -webkit-backdrop-filter: blur(24px) saturate(170%);
      box-shadow: inset 0 .5px 0 rgba(255,255,255,.26);
    }
    #__comet_gui.glass .cm-resrow { background: rgba(255,255,255,.08); color: rgba(255,255,255,.8); }
    #__comet_gui.glass .cm-resrow:hover { background: rgba(255,255,255,.18); }
    #__comet_gui.glass .cm-resrow .cm-rcat { color: rgba(255,255,255,.55); }
    #__comet_gui.glass .cm-rempty { color: rgba(255,255,255,.6); }

    #__comet_hudstage.glass .cm-hudbox,
    #__comet_hudstage.glass .cm-hudicon,
    #__comet_hudstage.glass .cm-arr,
    #__comet_hudstage.glass .cm-note,
    #__comet_hudstage.glass .cm-target {
      border-color: rgba(255,255,255,.34);
      background: linear-gradient(135deg, rgba(255,255,255,.22), rgba(255,255,255,.07));
      backdrop-filter: blur(18px) saturate(175%);
      -webkit-backdrop-filter: blur(18px) saturate(175%);
      box-shadow: inset 0 .5px 0 rgba(255,255,255,.45), 0 4px 16px rgba(0,0,0,.28);
    }
    #__comet_hudstage.glass .cm-hudbox,
    #__comet_hudstage.glass .cm-arr,
    #__comet_hudstage.glass .cm-note,
    #__comet_hudstage.glass .cm-target { color: #fff; }
    #__comet_hudstage.glass .cm-hudbox .cm-hlbl,
    #__comet_hudstage.glass .cm-hudbox .cm-hsep { color: rgba(255,255,255,.68); }
    #__comet_hudstage.glass .cm-note .cm-ndesc { color: rgba(255,255,255,.7); }
    #__comet_hudstage.glass .cm-target .cm-tface {
      border-color: rgba(255,255,255,.32); background: rgba(255,255,255,.14);
    }

    /* ---------- HUD 编辑模式 ---------- */
    #__comet_hudstage.edit .cm-hud,
    #__comet_hudstage.edit .cm-target,
    #__comet_hudstage.edit .cm-array,
    #__comet_hudstage.edit .cm-notes {
      pointer-events: auto; cursor: move;
      outline: .4px dashed rgba(0,210,255,.7); outline-offset: 2px;
    }
    #__comet_hudstage.edit [data-hl]::after {
      content: attr(data-hl); position: absolute; left: -1px; top: -8px;
      font-size: 5px; line-height: 7px; padding: 0 2px; border-radius: 2px; white-space: nowrap;
      color: #9fe8ff; background: rgba(0,0,0,.72); pointer-events: none;
    }
    #__comet_hudstage.edit .cm-notes { min-width: 108px; min-height: 24px; }
    #__comet_compass.edit,
    #__comet_radar.edit {
      pointer-events: auto; cursor: move;
      outline: 1px dashed rgba(0,210,255,.7); outline-offset: 2px;
    }
    #__comet_editbar {
      position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%);
      z-index: 2147483647; display: none; cursor: pointer;
      padding: 5px 12px; border-radius: 6px; border: .5px solid #5a5a5a;
      background: linear-gradient(135deg, #343434, #161616 55%, #343434);
      color: #eaeaea; font: 700 12px "Microsoft YaHei", sans-serif; white-space: nowrap;
      box-shadow: 0 6px 20px rgba(0,0,0,.5);
    }
    .cm-target .cm-tface canvas { width: 100%; height: 100%; display: block; border-radius: 3.5px; }

    /* ---------- v1.5.0 彗星式悬浮分类面板（经典 400x250 面板完整保留） ---------- */
    #__comet_float {
      position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; display: none;
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif; user-select: none;
    }
    #__comet_gui.visible #__comet_float { display: block; }
    #__comet_float.off { display: none !important; }
    .cm-float {
      position: absolute; width: 176px; pointer-events: auto; box-sizing: border-box;
      border: .5px solid rgba(110,110,110,.72); border-radius: 9px; overflow: hidden;
      background: linear-gradient(150deg, rgba(38,38,38,.96), rgba(12,12,12,.97) 60%, rgba(28,28,28,.96));
      box-shadow: 0 8px 26px rgba(0,0,0,.55), inset 0 .5px 0 rgba(255,255,255,.11);
      color: #dedede; opacity: 0; transform: translateY(-8px);
      transition: opacity .22s ease, transform .22s cubic-bezier(.2,.8,.3,1);
    }
    #__comet_gui.float-open .cm-float { opacity: 1; transform: none; }
    #__comet_gui:not(.float-open) .cm-float { pointer-events: none; }
    .cm-fhead {
      position: relative; display: flex; align-items: center; gap: 6px;
      height: 27px; padding: 0 7px; cursor: move;
      border-bottom: .5px solid rgba(255,255,255,.09);
      background: linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,0));
    }
    .cm-fhead::after {
      content: ''; position: absolute; left: 0; right: 0; bottom: -.5px; height: 1.5px;
      background: linear-gradient(90deg, var(--cm-accent, #b06bff), transparent 78%); opacity: .9;
    }
    .cm-fico { font-size: 12px; color: var(--cm-accent, #b06bff); width: 14px; text-align: center; }
    .cm-fname { font-size: 11px; font-weight: 700; letter-spacing: .3px; flex: 1; }
    .cm-fcount { font-size: 9px; color: rgba(255,255,255,.42); }
    .cm-fcaret { font-size: 9px; color: rgba(255,255,255,.55); transition: transform .2s; }
    .cm-float.collapsed .cm-fcaret { transform: rotate(-90deg); }
    .cm-fbody {
      max-height: min(46vh, 300px); overflow-y: auto; overflow-x: hidden; padding: 4px;
      transition: max-height .22s ease, opacity .18s ease, padding .22s ease;
    }
    .cm-float.collapsed .cm-fbody { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; }
    .cm-fbody::-webkit-scrollbar { width: 5px; }
    .cm-fbody::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 3px; }
    .cm-float .cm-row {
      display: flex; align-items: center; gap: 5px; height: 21px; margin-bottom: 2px;
      padding: 0 6px; border: .5px solid transparent; border-radius: 4px;
      font-size: 10.5px; line-height: 1; cursor: pointer;
      background: rgba(255,255,255,.035); color: rgba(230,230,230,.72);
    }
    .cm-float .cm-row:hover { background: rgba(255,255,255,.12); }
    .cm-float .cm-row.on { color: #fff; background: rgba(176,107,255,.16); border-color: rgba(176,107,255,.34); }
    .cm-float .cm-row.sel { border-color: rgba(255,255,255,.36); }
    .cm-float .cm-row .cm-ball {
      width: 4px; height: 4px; border-radius: 50%; flex: none;
      background: var(--cm-accent, #b06bff); opacity: .28;
    }
    .cm-float .cm-row.on .cm-ball { opacity: 1; box-shadow: 0 0 5px var(--cm-accent, #b06bff); }
    .cm-float .cm-row .cm-rname { flex: 1; }
    .cm-float .cm-row .cm-bind { font-size: 8px; color: rgba(255,255,255,.5); }
    .cm-float .cm-row .cm-spacer { display: none; }
    .cm-float .cm-row .cm-star { font-size: 9px; color: rgba(255,255,255,.25); }
    .cm-float .cm-row .cm-star.fav { color: #ffd700; }
    .cm-float .cm-row .cm-gear { font-size: 9px; color: rgba(255,255,255,.35); }
    .cm-fempty { font-size: 9px; color: rgba(255,255,255,.35); padding: 4px 6px; }
    .cm-fver {
      position: fixed; left: 12px; bottom: 10px; pointer-events: none;
      font-size: 10px; letter-spacing: .4px; color: rgba(255,255,255,.55);
      text-shadow: 0 1px 3px rgba(0,0,0,.8);
    }
    /* 液态玻璃主题：新面板与旧面板同款磨砂 + 高光边缘 */
    #__comet_gui.glass .cm-float {
      border-color: rgba(255,255,255,.34);
      background: linear-gradient(150deg, rgba(255,255,255,.22), rgba(255,255,255,.07));
      backdrop-filter: blur(18px) saturate(175%);
      -webkit-backdrop-filter: blur(18px) saturate(175%);
      box-shadow: inset 0 .5px 0 rgba(255,255,255,.45), 0 8px 26px rgba(0,0,0,.28);
      color: #fff;
    }
    #__comet_gui.glass .cm-fhead { border-bottom-color: rgba(255,255,255,.2); background: rgba(255,255,255,.08); }
    #__comet_gui.glass .cm-fname,
    #__comet_gui.glass .cm-fcount,
    #__comet_gui.glass .cm-fcaret { color: rgba(255,255,255,.9); }
    #__comet_gui.glass .cm-float .cm-row { background: rgba(255,255,255,.08); color: rgba(255,255,255,.8); }
    #__comet_gui.glass .cm-float .cm-row:hover { background: rgba(255,255,255,.2); }
    #__comet_gui.glass .cm-float .cm-row.on {
      background: rgba(176,107,255,.34); color: #fff; border-color: rgba(255,255,255,.4);
    }
    #__comet_gui.glass .cm-fver { color: rgba(255,255,255,.8); }

    /* ---------- v1.7.0 小地图 / 背包 HUD ---------- */
    #__comet_minimap {
      position: fixed; right: 16px; top: 16px; z-index: 2147483000;
      width: 180px; height: 180px; border-radius: 50%; pointer-events: none;
      border: 2px solid rgba(210,215,230,.55);
      box-shadow: 0 6px 24px rgba(0,0,0,.5), inset 0 0 0 1px rgba(0,0,0,.35);
      background: rgba(10,14,22,.55);
    }
    #__comet_minimap.glass {
      border-color: rgba(255,255,255,.5);
      background: rgba(255,255,255,.1);
      backdrop-filter: blur(10px) saturate(160%);
      -webkit-backdrop-filter: blur(10px) saturate(160%);
      box-shadow: inset 0 .5px 0 rgba(255,255,255,.5), 0 8px 26px rgba(0,0,0,.3);
    }
    #__comet_minimap.edit { pointer-events: auto; cursor: move; outline: 1px dashed rgba(0,210,255,.7); }
    #__comet_inv {
      position: fixed; left: 16px; bottom: 16px; z-index: 2147483000;
      width: 306px; padding: 9px; border-radius: 9px; pointer-events: none;
      border: .5px solid rgba(190,195,210,.4); background: rgba(8,11,18,.9);
      color: #eef2f8; font: 11px "Segoe UI", "Microsoft YaHei", sans-serif;
      box-shadow: 0 6px 20px rgba(0,0,0,.45);
      transform: scale(var(--cm-inv-scale, 1)); transform-origin: left bottom;
    }
    #__comet_inv.glass {
      border-color: rgba(255,255,255,.34);
      background: linear-gradient(150deg, rgba(255,255,255,.22), rgba(255,255,255,.07));
      backdrop-filter: blur(18px) saturate(175%);
      -webkit-backdrop-filter: blur(18px) saturate(175%);
      box-shadow: inset 0 .5px 0 rgba(255,255,255,.45), 0 8px 26px rgba(0,0,0,.28);
    }
    .cm-ivtitle { font-weight: 700; letter-spacing: .4px; margin-bottom: 6px; font-size: 12px; }
    .cm-ivgrid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 3px; }
    .cm-ivslot {
      position: relative; height: 32px; border-radius: 3px; box-sizing: border-box;
      border: .5px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05);
      overflow: hidden;
    }
    .cm-ivslot.has { border-color: rgba(255,255,255,.3); }
    .cm-ivslot.sel { outline: 1.5px solid #ffd54f; outline-offset: -1px; }
    .cm-ivn {
      position: absolute; left: 2px; right: 2px; top: 2px; font-size: 9px; line-height: 11px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 2px #000;
    }
    .cm-ivq {
      position: absolute; right: 2px; bottom: 1px; font-size: 11px; font-weight: 700;
      text-shadow: 0 1px 2px #000;
    }
    .cm-ivc0 { background: rgba(120,160,110,.5); }
    .cm-ivc1 { background: rgba(150,120,90,.5); }
    .cm-ivc2 { background: rgba(100,130,180,.5); }
    .cm-ivc3 { background: rgba(180,140,90,.5); }
    .cm-ivc4 { background: rgba(150,110,160,.5); }
    .cm-ivc5 { background: rgba(110,160,160,.5); }
    .cm-ivc6 { background: rgba(170,110,110,.5); }
    .cm-ivc7 { background: rgba(130,140,100,.5); }
    #__comet_gui.glass .cm-ivslot { border-color: rgba(255,255,255,.34); }

    /* ---------- v1.8.0 大地图 ---------- */
    #__comet_bigmap {
      position: fixed; inset: 0; z-index: 2147483600; display: none;
      background: #0b1018;
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif; color: #eef2f8;
    }
    .cm-map-open #__comet_gui,
    .cm-map-open #__comet_hudstage,
    .cm-map-open #__comet_esp,
    .cm-map-open #__comet_radar,
    .cm-map-open #__comet_compass,
    .cm-map-open #__comet_minimap,
    .cm-map-open #__comet_inv,
    .cm-map-open #__comet_editbar { display: none !important; }
    #__comet_bigmap.open { display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .cm-bmhead {
      display: flex; align-items: center; gap: 18px; width: min(960px, 94vw);
      padding: 10px 14px; box-sizing: border-box; border-radius: 10px 10px 0 0;
      border: .5px solid rgba(255,255,255,.28); border-bottom: none;
      background: rgba(20,26,38,.9);
    }
    .cm-bmtitle { font-size: 13px; font-weight: 700; letter-spacing: .4px; white-space: nowrap; }
    .cm-bmhint { font-size: 11px; color: rgba(220,230,244,.6); }
    #__comet_bigmapcv {
      width: min(960px, 94vw); height: min(680px, 78vh); display: block;
      border: .5px solid rgba(255,255,255,.28); border-radius: 0 0 10px 10px;
      cursor: crosshair; box-sizing: border-box;
      box-shadow: 0 18px 60px rgba(0,0,0,.6);
    }
    #__comet_bigmap.glass .cm-bmhead {
      border-color: rgba(255,255,255,.4);
      background: linear-gradient(150deg, rgba(255,255,255,.2), rgba(255,255,255,.06));
      backdrop-filter: blur(18px) saturate(175%);
      -webkit-backdrop-filter: blur(18px) saturate(175%);
    }

    /* ---------- v1.9.0 地图右键菜单 / 掉落物汇总 ---------- */
    #__comet_bigmenu {
      position: fixed; z-index: 2147483650; display: none; min-width: 190px;
      padding: 5px; border-radius: 8px; border: .5px solid rgba(255,255,255,.3);
      background: rgba(16,21,32,.96); color: #eef2f8;
      font: 11px "Segoe UI", "Microsoft YaHei", sans-serif;
      box-shadow: 0 10px 34px rgba(0,0,0,.6);
    }
    #__comet_bigmenu.open { display: block; }
    .cm-bmrow { padding: 6px 9px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
    .cm-bmrow:hover { background: rgba(176,107,255,.28); }
    #__comet_bigedit {
      position: fixed; left: 50%; top: 20px; transform: translateX(-50%);
      z-index: 2147483651; display: none; align-items: center; gap: 7px;
      padding: 8px 10px; border-radius: 8px; border: .5px solid rgba(255,255,255,.3);
      background: rgba(16,21,32,.96); color: #eef2f8;
      font: 11px "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    #__comet_bigedit.open { display: flex; }
    .cm-beinput {
      width: 150px; padding: 4px 6px; border-radius: 4px; outline: none;
      border: .5px solid rgba(255,255,255,.3); background: rgba(255,255,255,.1); color: #fff;
    }
    .cm-bebtn { padding: 4px 9px; border-radius: 4px; cursor: pointer; background: rgba(176,107,255,.35); }
    .cm-bebtn:hover { background: rgba(176,107,255,.6); }
    #__comet_drops {
      position: fixed; right: 16px; top: 210px; z-index: 2147483000;
      min-width: 158px; max-width: 230px; padding: 7px; border-radius: 9px;
      border: .5px solid rgba(190,195,210,.4); background: rgba(8,11,18,.88);
      color: #e8ecf4; font: 10px "Segoe UI", "Microsoft YaHei", sans-serif;
      box-shadow: 0 6px 20px rgba(0,0,0,.45); pointer-events: none;
    }
    #__comet_drops.glass {
      border-color: rgba(255,255,255,.34);
      background: linear-gradient(150deg, rgba(255,255,255,.22), rgba(255,255,255,.07));
      backdrop-filter: blur(18px) saturate(175%);
      -webkit-backdrop-filter: blur(18px) saturate(175%);
      box-shadow: inset 0 .5px 0 rgba(255,255,255,.45), 0 8px 26px rgba(0,0,0,.28);
    }
    .cm-dtitle { font-weight: 700; letter-spacing: .4px; margin-bottom: 5px; }
    .cm-dtitle span { font-weight: 400; opacity: .65; }
    .cm-dempty { opacity: .55; padding: 3px 0; }
    .cm-drow { display: flex; align-items: center; gap: 5px; height: 17px; }
    .cm-drow i { width: 7px; height: 7px; border-radius: 2px; flex: none; }
    .cm-dc0 { background: #8fb28a; } .cm-dc1 { background: #c9a06b; }
    .cm-dc2 { background: #6f9bc4; } .cm-dc3 { background: #c8a06b; }
    .cm-dc4 { background: #a77fc0; } .cm-dc5 { background: #6fb0b0; }
    .cm-dc6 { background: #c07f7f; } .cm-dc7 { background: #93a86f; }
    .cm-dname { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .cm-dq { color: #ffd54f; font-weight: 700; }
    .cm-dd { opacity: .6; min-width: 26px; text-align: right; }
    .cm-map-open #__comet_drops { display: none !important; }
    .cm-draggable { cursor: move; outline: 1px dashed rgba(0,210,255,.75); outline-offset: 2px; }

    /* ---------- v1.10.0 方块选择器 ---------- */
    #__comet_blockpick {
      position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
      z-index: 2147483655; display: none; width: 340px; box-sizing: border-box;
      padding: 9px; border-radius: 10px; border: .5px solid rgba(255,255,255,.3);
      background: rgba(12,17,26,.96); color: #eef2f8;
      font: 11px "Segoe UI", "Microsoft YaHei", sans-serif;
      box-shadow: 0 16px 50px rgba(0,0,0,.65);
    }
    #__comet_blockpick.open { display: flex; flex-direction: column; gap: 7px; }
    #__comet_blockpick.glass {
      border-color: rgba(255,255,255,.4);
      background: linear-gradient(150deg, rgba(255,255,255,.2), rgba(255,255,255,.07));
      backdrop-filter: blur(18px) saturate(175%);
      -webkit-backdrop-filter: blur(18px) saturate(175%);
    }
    .cm-bphead { display: flex; align-items: center; justify-content: space-between; font-weight: 700; }
    .cm-bpclose { cursor: pointer; font-size: 16px; line-height: 1; opacity: .75; padding: 0 4px; }
    .cm-bpclose:hover { opacity: 1; }
    .cm-bpinput {
      width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 5px; outline: none;
      border: .5px solid rgba(255,255,255,.28); background: rgba(255,255,255,.1); color: #fff;
    }
    .cm-bplist { max-height: 300px; overflow-y: auto; }
    .cm-bprow {
      display: flex; align-items: center; gap: 8px; padding: 5px 7px;
      border-radius: 4px; cursor: pointer;
    }
    .cm-bprow:hover { background: rgba(176,107,255,.3); }
    .cm-bpcn { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cm-bpkey { font-size: 9px; opacity: .55; }
    .cm-bpempty { opacity: .6; padding: 8px; text-align: center; }
    .cm-map-open #__comet_blockpick { display: none !important; }

    /* ---------- v1.11.0 音乐播放器 ---------- */
    #__comet_music {
      position: fixed; left: 16px; top: 16px; z-index: 2147483656; display: none;
      width: 320px; box-sizing: border-box; padding: 9px; border-radius: 10px;
      border: .5px solid rgba(255,255,255,.3); background: rgba(12,17,26,.95);
      color: #eef2f8; font: 11px "Segoe UI", "Microsoft YaHei", sans-serif;
      box-shadow: 0 14px 42px rgba(0,0,0,.6);
    }
    #__comet_music.open { display: block; }
    #__comet_music.glass {
      border-color: rgba(255,255,255,.4);
      background: linear-gradient(150deg, rgba(255,255,255,.2), rgba(255,255,255,.07));
      backdrop-filter: blur(18px) saturate(175%);
      -webkit-backdrop-filter: blur(18px) saturate(175%);
    }
    .cm-muhead { display: flex; align-items: center; justify-content: space-between; font-weight: 700; margin-bottom: 7px; }
    .cm-muclose { cursor: pointer; font-size: 16px; line-height: 1; opacity: .75; padding: 0 4px; }
    .cm-muclose:hover { opacity: 1; }
    .cm-musearch { display: flex; gap: 5px; }
    .cm-muinput {
      flex: 1; min-width: 0; padding: 5px 7px; border-radius: 5px; outline: none;
      border: .5px solid rgba(255,255,255,.28); background: rgba(255,255,255,.1); color: #fff;
    }
    .cm-mubtn {
      padding: 5px 9px; border-radius: 5px; cursor: pointer; white-space: nowrap;
      background: rgba(176,107,255,.32); text-align: center;
    }
    .cm-mubtn:hover { background: rgba(176,107,255,.58); }
    .cm-mustatus { font-size: 10px; opacity: .68; margin: 6px 2px; min-height: 12px; }
    .cm-mulist {
      max-height: 168px; overflow-y: auto; margin-bottom: 6px;
      scrollbar-width: thin; scrollbar-color: rgba(176,107,255,.55) transparent;
    }
    .cm-mulist::-webkit-scrollbar { width: 5px; }
    .cm-mulist::-webkit-scrollbar-track { background: transparent; }
    .cm-mulist::-webkit-scrollbar-thumb {
      background: rgba(176,107,255,.5); border-radius: 3px;
    }
    .cm-mulist::-webkit-scrollbar-thumb:hover { background: rgba(176,107,255,.8); }
    .cm-murow {
      display: flex; align-items: center; gap: 6px; padding: 4px 6px;
      border-radius: 4px; cursor: pointer;
    }
    .cm-murow:hover { background: rgba(176,107,255,.28); }
    .cm-muname { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .cm-muauthor { font-size: 9px; opacity: .5; max-width: 74px; overflow: hidden; white-space: nowrap; }
    .cm-munow { font-weight: 700; margin-bottom: 6px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .cm-muctl { display: flex; gap: 5px; }
    .cm-muctl .cm-mubtn { flex: 1; font-size: 10px; padding: 4px 2px; }
    .cm-mubar { height: 4px; margin-top: 7px; border-radius: 3px; background: rgba(255,255,255,.14); overflow: hidden; }
    .cm-mufill { width: var(--cm-prog, 0%); height: 100%; background: linear-gradient(90deg, #b06bff, #4fc3f7); }
    .cm-map-open #__comet_music { display: none !important; }
    .cm-mucredit { margin-top: 6px; font-size: 8.5px; line-height: 12px; opacity: .55; }
    #__comet_muaudio { display: none; }
    #__comet_mblur {
      position: fixed; inset: 0; z-index: 2147482990; pointer-events: none;
      backdrop-filter: blur(var(--cm-mblur, 0px));
      -webkit-backdrop-filter: blur(var(--cm-mblur, 0px));
    }
    #__comet_mblur.off { backdrop-filter: none; -webkit-backdrop-filter: none; }
    .cm-map-open #__comet_mblur { display: none !important; }

    /* ---------- v1.15.0 外观四档位 ---------- */
    :root {
      --cm-accent: #b06bff; --cm-accent-rgb: 176,107,255;
      --cm-glow: 14; --cm-blur: 18px; --cm-radius: 14px;
      --cm-anim: 1.3; --cm-sat: 1.5; --cm-bg: #10121c; --cm-border: .75;
    }
    /* 基础外观：任何档位都生效，改滑块立刻看得见 */
    #__comet_gui .cm-float,
    #__comet_gui #__comet_panel {
      border-radius: var(--cm-radius);
      border-color: rgba(var(--cm-accent-rgb), var(--cm-border));
      background: linear-gradient(140deg,
        rgba(var(--cm-accent-rgb), .12) 0%, var(--cm-bg) 46%, rgba(0,0,0,.42) 100%);
      box-shadow: 0 0 calc(var(--cm-glow) * 1px) rgba(var(--cm-accent-rgb), .42),
                  inset 0 .5px 0 rgba(255,255,255,.25);
      filter: saturate(var(--cm-sat));
    }
    #__comet_gui .cm-btn { background: rgba(var(--cm-accent-rgb), .42); }
    #__comet_gui .cm-btn:hover { background: rgba(var(--cm-accent-rgb), .68); }
    #__comet_gui .cm-switch.on { background: rgba(var(--cm-accent-rgb), .82); }
    #__comet_gui .cm-row.on,
    #__comet_gui .cm-float .cm-row.on { background: rgba(var(--cm-accent-rgb), .28); }
    #__comet_gui .cm-cat.sel .cm-ball,
    #__comet_gui .cm-topt.on { background: rgba(var(--cm-accent-rgb), .85); }
    #__comet_gui.fancy .cm-float,
    #__comet_gui.fancy #__comet_panel {
      animation: cm-breathe calc(4s / var(--cm-anim)) ease-in-out infinite;
    }
    @keyframes cm-breathe {
      0%, 100% { box-shadow: 0 0 calc(var(--cm-glow) * .6px) rgba(var(--cm-accent-rgb), .28); }
      50% { box-shadow: 0 0 calc(var(--cm-glow) * 1.4px) rgba(var(--cm-accent-rgb), .62); }
    }
    #__comet_gui.fancy .cm-fhead::after {
      background: linear-gradient(90deg, var(--cm-accent), transparent 78%);
      animation: cm-hue calc(7s / var(--cm-anim)) linear infinite;
    }
    @keyframes cm-hue { to { filter: hue-rotate(360deg); } }
    #__comet_gui.fancy .cm-sheen {
      opacity: .45;
      background: linear-gradient(105deg, transparent 34%, rgba(255,255,255,.24) 50%, transparent 66%);
      animation: cm-sweep calc(5s / var(--cm-anim)) linear infinite;
    }
    @keyframes cm-sweep { from { transform: translateX(-120%); } to { transform: translateX(120%); } }
    #__comet_gui.fancy .cm-row.on,
    #__comet_gui.fancy .cm-switch.on { background: rgba(var(--cm-accent-rgb), .42); }
    #__comet_gui.plain .cm-float,
    #__comet_gui.plain #__comet_panel {
      animation: none !important; filter: none !important;
      box-shadow: none !important; border-radius: 4px;
      background: var(--cm-bg) !important;
    }
    #__comet_gui.plain .cm-sheen { display: none; }
    #__comet_gui.glass .cm-float,
    #__comet_gui.glass #__comet_panel {
      backdrop-filter: blur(var(--cm-blur)) saturate(var(--cm-sat));
      -webkit-backdrop-filter: blur(var(--cm-blur)) saturate(var(--cm-sat));
    }
    /* 真材质透视：只隐藏 3D 画布，#ui（血量/天气/物品栏）照常 */
    .cm-xray-on #gl, #gl.cm-xray-hidden, canvas.cm-xray-hidden { visibility: hidden; }
    .cm-xray-on body {
      background: linear-gradient(#8fb8e6 0%, #d8e9f7 55%, #eef5fb 100%);
    }
    #__comet_ext {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483002;
      width: 210px; max-height: 62vh; overflow-y: auto; overscroll-behavior: contain;
      box-sizing: border-box; padding: 7px;
      /* 和主 UI 共用一套外观变量，颜色不会再对不上 */
      border-radius: var(--cm-radius);
      border: .5px solid rgba(var(--cm-accent-rgb), var(--cm-border));
      background: linear-gradient(140deg,
        rgba(var(--cm-accent-rgb), .12) 0%, var(--cm-bg) 46%, rgba(0,0,0,.42) 100%);
      box-shadow: 0 0 calc(var(--cm-glow) * 1px) rgba(var(--cm-accent-rgb), .38),
                  0 6px 20px rgba(0,0,0,.45);
      filter: saturate(var(--cm-sat));
      color: #eef2f8; font: 10px "Segoe UI", "Microsoft YaHei", sans-serif;
      scrollbar-width: thin; scrollbar-color: rgba(var(--cm-accent-rgb), .6) transparent;
    }
    #__comet_ext::-webkit-scrollbar { width: 6px; }
    #__comet_ext::-webkit-scrollbar-track { background: transparent; }
    #__comet_ext::-webkit-scrollbar-thumb {
      background: rgba(var(--cm-accent-rgb), .55); border-radius: 3px;
    }
    #__comet_ext.glass {
      background: linear-gradient(150deg, rgba(255,255,255,.2), rgba(255,255,255,.06));
      backdrop-filter: blur(var(--cm-blur)) saturate(var(--cm-sat));
      -webkit-backdrop-filter: blur(var(--cm-blur)) saturate(var(--cm-sat));
    }
    .cm-extsec .cm-exttitle {
      cursor: pointer; user-select: none; color: var(--cm-accent);
      border-bottom-color: rgba(var(--cm-accent-rgb), .35);
    }
    .cm-extsec .cm-exttitle::before { content: '▾ '; opacity: .85; }
    .cm-extsec.folded .cm-exttitle::before { content: '▸ '; }
    .cm-extsec.folded .cm-extrow,
    .cm-extsec.folded .cm-extarmor,
    .cm-extsec.folded .cm-extmore,
    .cm-extsec.folded .cm-extempty { display: none; }
    .cm-extsec:hover { background: rgba(var(--cm-accent-rgb), .06); }
    .cm-extfill { background: linear-gradient(90deg, var(--cm-accent), #4fc3f7); }
    .cm-extbar { background: rgba(var(--cm-accent-rgb), .16); }
    #__comet_fpsgraph {
      border-radius: var(--cm-radius); border-color: rgba(var(--cm-accent-rgb), var(--cm-border));
    }
    #__comet_helper {
      border-radius: var(--cm-radius); border-color: rgba(var(--cm-accent-rgb), var(--cm-border));
      background: linear-gradient(140deg, rgba(var(--cm-accent-rgb), .1), var(--cm-bg) 60%);
      box-shadow: 0 0 calc(var(--cm-glow) * 1px) rgba(var(--cm-accent-rgb), .32),
                  0 18px 60px rgba(0,0,0,.7);
      filter: saturate(var(--cm-sat));
    }
    #__comet_helper .cm-hptab.on { background: rgba(var(--cm-accent-rgb), .6); }
    #__comet_helper .cm-hpkey { background: rgba(var(--cm-accent-rgb), .35); }
    .cm-extsec { margin-bottom: 7px; }
    .cm-extsec:last-child { margin-bottom: 0; }
    .cm-exttitle {
      font-weight: 700; letter-spacing: .4px; margin-bottom: 4px; font-size: 11px;
      padding-bottom: 3px; border-bottom: .5px solid rgba(255,255,255,.16);
    }
    .cm-exttitle span { font-weight: 400; opacity: .6; }
    .cm-extrow { display: flex; align-items: center; gap: 5px; height: 16px; }
    .cm-extk { opacity: .6; min-width: 42px; }
    .cm-extv { flex: 1; text-align: right; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .cm-extempty { opacity: .5; padding: 3px 0; }
    .cm-extemptyrow { opacity: .42; }
    .cm-ext-hurt .cm-extv { color: #ff8a8a; }
    .cm-ext-heal .cm-extv { color: #8ae7a5; }
    .cm-ext-death .cm-extv { color: #ffb0b0; }
    .cm-ext-gear .cm-extv { color: #b7d0ff; }
    .cm-ext-coord .cm-extv { color: #ffd58a; }
    .cm-ext-profile .cm-extv { color: #d0b0ff; }
    .cm-ext-macro .cm-extv { color: #8fe0e0; }
    .cm-extarmor { display: flex; align-items: center; gap: 4px; height: 17px; }
    .cm-extarmor .cm-extk { min-width: 30px; }
    .cm-extarmor .cm-extv { flex: 1; text-align: left; }
    .cm-extbar {
      width: 46px; height: 5px; border-radius: 3px; flex: none;
      background: rgba(255,255,255,.14); overflow: hidden;
    }
    .cm-extfill { display: block; height: 100%; background: linear-gradient(90deg, #6ee7a5, #4fc3f7); }
    #__comet_fpsgraph {
      position: fixed; right: 16px; bottom: 210px; z-index: 2147483002;
      width: 160px; border-radius: 6px; pointer-events: none;
      border: .5px solid rgba(190,195,210,.35); box-shadow: 0 4px 14px rgba(0,0,0,.4);
    }
    .cm-map-open #__comet_ext, .cm-map-open #__comet_fpsgraph { display: none !important; }
    .cm-extmore { margin-top: 4px; padding-top: 3px; border-top: .5px dashed rgba(255,255,255,.14); }
    #__comet_helper {
      position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
      z-index: 2147483658; display: none; width: min(560px, 92vw);
      max-height: min(72vh, 660px); box-sizing: border-box;
      padding: 10px; border-radius: 11px; color: #eef2f8;
      border: .5px solid rgba(255,255,255,.3); background: rgba(12,17,26,.96);
      font: 11px "Segoe UI", "Microsoft YaHei", sans-serif;
      box-shadow: 0 18px 60px rgba(0,0,0,.7);
    }
    #__comet_helper.open { display: flex; flex-direction: column; }
    #__comet_helper.glass {
      border-color: rgba(255,255,255,.4);
      background: linear-gradient(150deg, rgba(255,255,255,.2), rgba(255,255,255,.07));
      backdrop-filter: blur(18px) saturate(175%);
      -webkit-backdrop-filter: blur(18px) saturate(175%);
    }
    .cm-hphead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .cm-hptitle { font-weight: 700; font-size: 13px; }
    .cm-hpclose { cursor: pointer; font-size: 17px; line-height: 1; opacity: .75; padding: 0 4px; }
    .cm-hpclose:hover { opacity: 1; }
    .cm-hptabs { display: flex; gap: 5px; margin-bottom: 7px; }
    .cm-hptab {
      padding: 4px 10px; border-radius: 5px; cursor: pointer;
      background: rgba(255,255,255,.07); font-size: 10px;
    }
    .cm-hptab.on { background: rgba(176,107,255,.55); }
    .cm-hpsearch {
      width: 100%; box-sizing: border-box; padding: 6px 9px; border-radius: 5px;
      outline: none; border: .5px solid rgba(255,255,255,.28);
      background: rgba(255,255,255,.1); color: #fff; margin-bottom: 7px;
    }
    .cm-hpbody { flex: 1; overflow-y: auto; padding-right: 4px; }
    .cm-hpcat {
      font-weight: 700; letter-spacing: .5px; margin: 8px 0 4px;
      padding-bottom: 3px; border-bottom: .5px solid rgba(255,255,255,.16);
    }
    .cm-hpitem { padding: 5px 6px; border-radius: 5px; margin-bottom: 3px; background: rgba(255,255,255,.045); }
    .cm-hpid { font-size: 9px; opacity: .5; margin-left: 6px; }
    .cm-hpwhat { margin-top: 2px; opacity: .86; }
    .cm-hpmeta { font-size: 9.5px; opacity: .6; margin-top: 2px; }
    .cm-hptip { font-size: 9.5px; color: #ffd58a; margin-top: 2px; }
    .cm-hpkeyrow { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 4px; }
    .cm-hpkeyrow:nth-child(even) { background: rgba(255,255,255,.045); }
    .cm-hpkey { margin-left: auto; padding: 1px 7px; border-radius: 4px; background: rgba(176,107,255,.32); }
    .cm-hpdel { cursor: pointer; color: #ff9a9a; padding: 1px 5px; }
    .cm-hpdel:hover { background: rgba(255,90,90,.24); border-radius: 4px; }
    .cm-hpempty, .cm-hpok { opacity: .65; padding: 10px; text-align: center; }
    .cm-hpok { color: #8ae7a5; opacity: 1; }
    .cm-map-open #__comet_helper { display: none !important; }
    .cm-hptab { font-size: 9.5px; padding: 4px 8px; }
    .cm-hpitem:hover { background: rgba(176,107,255,.18); }
    .cm-hpkeyrow .cm-hpid { font-size: 8.5px; }
    .cm-hpmeta { font-size: 9.5px; opacity: .62; padding: 0 6px 3px; }
    .cm-hpkeyrow .cm-hpkey { margin-left: 0; margin-right: auto; }
    .cm-extmore-e { margin-top: 5px; }
    #__comet_rpbtn {
      position: fixed; left: 50%; top: 66%; transform: translateX(-50%);
      z-index: 2147483600; display: none; cursor: pointer;
      padding: 6px 20px; border-radius: 6px;
      background: linear-gradient(180deg, rgba(150,110,225,.94), rgba(92,60,165,.94));
      border: 1px solid rgba(255,255,255,.7); color: #fff;
      font: 12px "Microsoft YaHei", sans-serif; text-shadow: 0 1px 1px rgba(0,0,0,.65);
      box-shadow: 0 2px 0 rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.3);
    }
    #__comet_rpbtn.show { display: block; }
    #__comet_rpbtn.hidden { display: none !important; }
    #__comet_rpbtn:hover { filter: brightness(1.16); }
    #__comet_rpmenu {
      position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
      z-index: 2147483601; display: none; width: min(430px, 92vw); box-sizing: border-box;
      padding: 12px; border-radius: var(--cm-radius);
      border: .5px solid rgba(var(--cm-accent-rgb), var(--cm-border));
      background: linear-gradient(140deg,
        rgba(var(--cm-accent-rgb), .12) 0%, var(--cm-bg) 46%, rgba(0,0,0,.5) 100%);
      box-shadow: 0 0 calc(var(--cm-glow) * 1px) rgba(var(--cm-accent-rgb), .4),
                  0 16px 50px rgba(0,0,0,.7);
      color: #eef2f8; font: 11px "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    #__comet_rpmenu.open { display: block; }
    #__comet_rpmenu.drag { outline: 2px dashed var(--cm-accent); }
    .cm-rmhead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .cm-rmtitle { font-weight: 700; font-size: 14px; color: var(--cm-accent); }
    .cm-rmclose { cursor: pointer; font-size: 18px; line-height: 1; opacity: .75; padding: 0 4px; }
    .cm-rmclose:hover { opacity: 1; }
    .cm-rmstatus {
      padding: 7px 9px; border-radius: 5px; background: rgba(0,0,0,.35);
      min-height: 15px; line-height: 16px; word-break: break-all;
    }
    .cm-rmhint { margin: 7px 2px; opacity: .66; line-height: 15px; font-size: 10px; }
    .cm-rmrow { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .cm-rmrow .cm-rmbtn { min-width: 88px; }
    .cm-rmbtn {
      flex: 1; text-align: center; padding: 6px 4px; border-radius: 5px; cursor: pointer;
      background: rgba(var(--cm-accent-rgb), .42); border: .5px solid rgba(255,255,255,.25);
    }
    .cm-rmbtn:hover { background: rgba(var(--cm-accent-rgb), .68); }
    .cm-rmtoggle { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; opacity: .9; }
    .cm-rmswitch {
      width: 30px; height: 15px; border-radius: 9px; background: rgba(255,255,255,.18); cursor: pointer;
    }
    .cm-rmswitch i {
      display: block; width: 11px; height: 11px; margin: 2px; border-radius: 50%;
      background: #ddd; transition: transform .15s;
    }
    .cm-rmswitch.on { background: rgba(var(--cm-accent-rgb), .9); }
    .cm-rmswitch.on i { transform: translateX(15px); background: #fff; }
    .cm-rminfo { font-size: 10px; opacity: .62; line-height: 15px; word-break: break-all; }
    .cm-map-open #__comet_rpbtn, .cm-map-open #__comet_rpmenu { display: none !important; }
    .cm-subhdr {
      padding: 6px 8px 3px; font-size: 9px; letter-spacing: 1px;
      color: var(--cm-accent); opacity: .85;
      border-top: .5px solid rgba(var(--cm-accent-rgb), .35);
      margin-top: 5px;
    }
    .cm-fsubhdr {
      padding: 5px 5px 2px; font-size: 8.5px; letter-spacing: .6px;
      color: var(--cm-accent); opacity: .8;
    }
    /* 资源包弹层必须高于 #__comet_gui(2147483647)，否则被面板盖住＝点了没反应 */
    #__comet_rpbtn { z-index: 2147483660 !important; }
    #__comet_rpmenu { z-index: 2147483661 !important; }
    /* 启动开场动画：全屏覆盖层，靠 class 做淡出，不写内联 style */
    #__comet_intro {
      position: fixed; inset: 0; width: 100%; height: 100%;
      z-index: 2147483647; pointer-events: none; opacity: 1;
      transition: opacity .55s ease;
    }
    #__comet_intro.skippable { pointer-events: auto; cursor: pointer; }
    #__comet_intro.fade { opacity: 0; }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;

  // ---------- ClickGUI 骨架 ----------
  function mk(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const gui = document.createElement('div');
  gui.id = '__comet_gui';
  const dim = mk('div', 'cm-dim');
  const stage = mk('div');
  stage.id = '__comet_stage';
  const panel = mk('div');
  panel.id = '__comet_panel';

  const side = mk('div', 'cm-pane cm-side');
  const header = mk('div', 'cm-pane cm-header');
  const hlabel = mk('div', 'cm-hlabel', 'Combat');

  const searchBox = mk('div', 'cm-searchbox');
  const searchInput = document.createElement('input');
  searchInput.placeholder = '搜索模块...';
  searchInput.spellcheck = false;
  const sdiv = mk('div', 'cm-sdiv');
  const sico = mk('div', 'cm-sico', '⌕');
  searchBox.append(searchInput, sdiv, sico);

  const modsPane = mk('div', 'cm-pane cm-mods');
  const modScroll = mk('div', 'cm-modscroll');
  modsPane.append(modScroll);

  const setsPane = mk('div', 'cm-pane cm-sets');
  const soon = mk('div', 'cm-soon', '敬请期待...');
  const results = mk('div', 'cm-results');

  // 主题切换：默认（深色）/ 液态玻璃（Apple Liquid Glass 风格）
  const themeOpts = [];
  const themeBox = mk('div', 'cm-theme');
  [['default', '默认'], ['glass', '玻璃']].forEach(([id, label]) => {
    const el = mk('span', 'cm-topt', label);
    el.dataset.theme = id;
    el.addEventListener('mousedown', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (ev.button === 0) setTheme(id);
    });
    themeOpts.push(el);
    themeBox.append(el);
  });

  const sheen = mk('div', 'cm-sheen');

  panel.append(sheen, side, header, modsPane, setsPane, soon, themeBox, results, hlabel, searchBox);
  stage.append(panel);
  gui.append(dim, stage);

  const floatLayer = mk('div');
  floatLayer.id = '__comet_float';
  const floatVer = mk('div', 'cm-fver', 'OpusHUD v' + VERSION + ' · ' + keyName(cfg.guiKey) + ' 悬浮标签 / Ins 经典面板');
  floatLayer.append(floatVer);
  gui.append(floatLayer);

  let selectedCat = 'combat';
  let selectedModule = null;
  let openSelect = null;
  let bindingModule = null;
  let searchActive = false;
  let settingsTitle = null;
  let settingsDesc = null;

  let floatOpen = false, classicOpen = false;
  function guiOpen() { return floatOpen || classicOpen; }

  function layoutPanel() {
    const vw = Math.floor(W.innerWidth / 2), vh = Math.floor(W.innerHeight / 2);
    const x = Math.floor((vw - 400) / 2 + cfg.guiOffset.x);
    const y = Math.floor((vh - 250) / 2 + cfg.guiOffset.y);
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
  }

  // ---------- 主题 ----------
  function applyTheme() {
    const glass = cfg.theme === 'glass';
    const ap = String(getS('appearance', 'preset') || '绚丽');
    gui.classList.toggle('fancy', ap === '绚丽');
    gui.classList.toggle('plain', ap === '基本');
    gui.classList.toggle('glass', glass);
    try { hudStage.classList.toggle('glass', glass); } catch (e) { /* noop */ }
    for (const el of themeOpts) el.classList.toggle('on', el.dataset.theme === cfg.theme);
    try {
      miniCanvas.classList.toggle('glass', glass);
      invBox.classList.toggle('glass', glass);
      bigmap.classList.toggle('glass', glass);
      dropBox.classList.toggle('glass', glass);
      blockPick.classList.toggle('glass', glass);
      musicBox.classList.toggle('glass', glass);
    } catch (e) { /* noop */ }
  }
  function setTheme(id) {
    cfg.theme = id === 'glass' ? 'glass' : 'default';
    saveCfg();
    applyTheme();
  }

  // ---------- 彗星式悬浮分类面板（WWindow 风格） ----------
  const FLOAT_ACCENT = {
    combat: '#ff5f6d', movement: '#4fc3f7', render: '#b06bff',
    player: '#66e0a3', misc: '#ffc857', configs: '#9aa4b2',
  };
  const floatPanels = {};

  function floatingOn() { return modOn('floatgui'); }

  function defaultFloatPos(i) {
    const vw = W.innerWidth, vh = W.innerHeight;
    const step = Math.min(138, Math.max(30, (vh - 60) / 3));
    return {
      x: i < 3 ? 14 : Math.max(14, vw - 190),
      y: 12 + (i % 3) * step,
    };
  }

  function floatPosOf(cat, i) {
    const saved = cfg.floatPos[cat];
    const d = defaultFloatPos(i);
    if (!saved || typeof saved.x !== 'number' || typeof saved.y !== 'number') {
      return { x: d.x, y: d.y, collapsed: false };
    }
    return {
      x: Math.min(Math.max(0, saved.x), Math.max(0, W.innerWidth - 176)),
      y: Math.min(Math.max(0, saved.y), Math.max(0, W.innerHeight - 30)),
      collapsed: !!saved.collapsed,
    };
  }

  function saveFloatPos() {
    cfg.floatPos = {};
    CATS.forEach((c) => {
      const el = floatPanels[c.id];
      if (!el || !el.parentNode) return;
      cfg.floatPos[c.id] = {
        x: parseFloat(el.style.left) || 0,
        y: parseFloat(el.style.top) || 0,
        collapsed: el.classList.contains('collapsed'),
      };
    });
    saveCfg();
  }

  function setFloatCollapsed(el, on) {
    el.classList.toggle('collapsed', on);
    const caret = el.querySelector('.cm-fcaret');
    if (caret) caret.textContent = on ? '▸' : '▾';
  }

  function buildFloatPanels() {
    floatLayer.querySelectorAll('.cm-float').forEach((n) => n.remove());
    for (const k in floatPanels) delete floatPanels[k];
    CATS.forEach((c, i) => {
      const el = mk('div', 'cm-float');
      el.dataset.cat = c.id;
      el.style.setProperty('--cm-accent', FLOAT_ACCENT[c.id] || '#b06bff');
      const pos = floatPosOf(c.id, i);
      el.style.left = pos.x + 'px';
      el.style.top = pos.y + 'px';

      const head = mk('div', 'cm-fhead');
      head.append(mk('span', 'cm-fico', c.icon));
      head.append(mk('span', 'cm-fname', c.name));
      head.append(mk('span', 'cm-fcount'));
      head.append(mk('span', 'cm-fcaret', '▾'));
      const body = mk('div', 'cm-fbody');
      el.append(head, body);
      setFloatCollapsed(el, pos.collapsed);

      let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
      head.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (ev.button === 2) {
          setFloatCollapsed(el, !el.classList.contains('collapsed'));
          saveFloatPos();
          return;
        }
        if (ev.button !== 0) return;
        dragging = true; moved = false;
        sx = ev.clientX; sy = ev.clientY;
        ox = parseFloat(el.style.left) || 0; oy = parseFloat(el.style.top) || 0;
        const move = (e2) => {
          if (!dragging) return;
          if (Math.abs(e2.clientX - sx) + Math.abs(e2.clientY - sy) > 3) moved = true;
          const nx = Math.min(Math.max(0, ox + e2.clientX - sx), Math.max(0, W.innerWidth - 176));
          const ny = Math.min(Math.max(0, oy + e2.clientY - sy), Math.max(0, W.innerHeight - 28));
          el.style.left = nx + 'px';
          el.style.top = ny + 'px';
        };
        const up = () => {
          if (!dragging) return;
          dragging = false;
          W.removeEventListener('mousemove', move);
          W.removeEventListener('mouseup', up);
          if (!moved) setFloatCollapsed(el, !el.classList.contains('collapsed'));
          saveFloatPos();
        };
        W.addEventListener('mousemove', move);
        W.addEventListener('mouseup', up);
      });
      el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
      el.addEventListener('mousedown', (ev) => ev.stopPropagation());
      el.addEventListener('wheel', (ev) => ev.stopPropagation(), { passive: true });
      floatPanels[c.id] = el;
      floatLayer.append(el);
    });
    renderFloatLists();
  }

  function renderFloatLists() {
    CATS.forEach((c) => {
      const el = floatPanels[c.id];
      if (!el) return;
      const body = el.querySelector('.cm-fbody');
      const count = el.querySelector('.cm-fcount');
      if (!body) return;
      const keep = body.scrollTop;
      body.innerHTML = '';
      const mods = sortedModules(c.id);
      let lastSub = null;
      for (const m of mods) {
        const sub = moduleSub(m);
        if (getS('appearance', 'group') !== false && sub !== lastSub) {
          body.append(mk('div', 'cm-fsubhdr', sub));
          lastSub = sub;
        }
        body.append(makeModuleRow(m));
      }
      if (!mods.length) body.append(mk('div', 'cm-fempty', '暂无模块'));
      if (count) {
        const n = mods.filter((m) => modOn(m.id)).length;
        count.textContent = n ? n + '/' + mods.length : String(mods.length);
      }
      body.scrollTop = keep;
    });
    floatLayer.classList.toggle('off', !floatingOn());
  }

  function resetFloatPos() {
    cfg.floatPos = {};
    saveCfg();
    buildFloatPanels();
    pushNotification('悬浮标签', '面板位置已重置');
  }

  // ---------- 侧栏 ----------
  function addSection(title, top) {
    const sec = mk('div', 'cm-sec');
    sec.style.top = top + 'px';
    sec.append(mk('span', '', title));
    side.append(sec);
  }

  function addCat(c, top) {
    const el = mk('div', 'cm-cat' + (c.id === selectedCat ? ' sel' : ''));
    el.style.top = top + 'px';
    el.append(mk('span', 'cm-ball'));
    el.append(mk('span', 'cm-ico', c.icon));
    el.append(mk('span', 'cm-cname', c.name));
    el.append(mk('span', 'cm-line'));
    el.addEventListener('mousedown', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (ev.button === 0) selectCategory(c.id);
    });
    side.append(el);
  }

  function buildSidebar() {
    side.innerHTML = '';
    addSection('主要', 52);
    CATS.filter((c) => !c.extra).forEach((c, i) => addCat(c, 65 + i * 15));
    addSection('其他', 137);
    CATS.filter((c) => c.extra).forEach((c, i) => addCat(c, 149 + i * 15));
  }

  function selectCategory(id) {
    if (searchActive) setSearch(false);
    selectedCat = id;
    if (selectedModule && selectedModule.cat !== id) selectedModule = null;
    openSelect = null;
    buildSidebar();
    updateHeaderLabel();
    renderModuleList();
    renderSettings();
  }

  function updateHeaderLabel() {
    if (searchActive) { hlabel.textContent = '搜索'; return; }
    const c = CATS.find((x) => x.id === selectedCat);
    hlabel.textContent = c ? c.name : '';
  }

  // ---------- 模块列表 ----------
  function keyName(code) {
    const map = {
      ShiftLeft: 'LShift', ShiftRight: 'RShift', ControlLeft: 'LCtrl', ControlRight: 'RCtrl',
      AltLeft: 'LAlt', AltRight: 'RAlt', Space: 'Space', Escape: 'Esc', Backspace: 'Back',
      Delete: 'Delete', Enter: 'Enter', Tab: 'Tab', CapsLock: 'Caps',
      Backquote: '`~', Insert: 'Ins', ScrollLock: 'ScrLk', ContextMenu: 'Menu',
    };
    if (map[code]) return map[code];
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^F(\d+)$/, 'F$1');
  }

  function makeModuleRow(m) {
    const on = modOn(m.id);
    const row = mk('div', 'cm-row' + (on ? ' on' : '') + (selectedModule === m ? ' sel' : ''));
    row.style.paddingLeft = (5 + (on ? 6 : 0)) + 'px';
    row.append(mk('span', 'cm-ball'));
    row.append(mk('span', 'cm-rname', m.cn || m.name));
    const bind = cfg.binds[m.id];
    if (bind || bindingModule === m) {
      row.append(mk('span', 'cm-bind', bindingModule === m ? '...' : keyName(bind)));
    }
    row.append(mk('span', 'cm-spacer'));
    const star = mk('span', 'cm-star' + (cfg.favorites[m.id] ? ' fav' : ''), '★');
    row.append(star);
    row.append(mk('span', 'cm-gear', selectedModule === m ? '⚙' : '···'));

    row.addEventListener('mousedown', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (ev.button === 0) {
        if (star.contains(ev.target)) {
          cfg.favorites[m.id] = !cfg.favorites[m.id];
          saveCfg();
          renderModuleList();
          return;
        }
        toggleModule(m);
        return;
      }
      if (ev.button === 2) {
        if (floatingOn() && selectedCat !== m.cat) selectCategory(m.cat);
        selectModule(m);
        return;
      }
      if (ev.button === 1) {
        bindingModule = m;
        renderModuleList();
        renderSettings();
      }
    });
    return row;
  }

  function selectModule(m) {
    selectedModule = m;
    bindingModule = null;
    openSelect = null;
    renderModuleList();
    renderSettings();
  }

  const MODULE_SUB_ORDER = ['实体与生物', '世界与方块', '轨迹与引导', '视觉特效', '界面与 HUD', '其它'];
  const MODULE_SUBS = {
    esp: '实体与生物', tracers: '实体与生物', nametags: '实体与生物', itemesp: '实体与生物',
    targetesp: '实体与生物', healthbar: '实体与生物', entitytrail: '实体与生物', chams: '实体与生物',
    xray: '世界与方块', blockesp: '世界与方块', containeresp: '世界与方块',
    chunkborder: '世界与方块', lightoverlay: '世界与方块', blockoutline: '世界与方块',
    blockinfo: '世界与方块', chunkinfo: '世界与方块', entityinfo: '世界与方块',
    projectile: '轨迹与引导', trail: '轨迹与引导', waypoints: '轨迹与引导',
    waypointline: '轨迹与引导', targetring: '轨迹与引导', hitmarker: '视觉特效',
    damagenumbers: '视觉特效', crosshair: '视觉特效', fullbright: '视觉特效',
    ambience: '视觉特效', nightvision: '视觉特效', mblur: '视觉特效',
    damageindicator: '视觉特效', zoom: '视觉特效', lowhp: '视觉特效',
    minimap: '界面与 HUD', hud: '界面与 HUD', invhud: '界面与 HUD', drops: '界面与 HUD',
    armorhud: '界面与 HUD', potionhud: '界面与 HUD', fpsgraph: '界面与 HUD',
    chunkborder: '世界与方块',
  };
  function moduleSub(m) { return MODULE_SUBS[m.id] || '其它'; }
  function sortedModules(cat) {
    return MODULES.filter((m) => m.cat === cat).slice().sort((a, b) => {
      const sa = MODULE_SUB_ORDER.indexOf(moduleSub(a)), sb = MODULE_SUB_ORDER.indexOf(moduleSub(b));
      if (sa !== sb) return sa - sb;
      return (!!cfg.favorites[b.id] - !!cfg.favorites[a.id]) || a.name.localeCompare(b.name);
    });
  }
  function renderModuleList() {
    renderFloatLists();
    const keep = modScroll.scrollTop;
    modScroll.innerHTML = '';
    const mods = sortedModules(selectedCat);
    const grouped = getS('appearance', 'group') !== false;
    let last = null;
    for (const m of mods) {
      const sub = moduleSub(m);
      if (grouped && sub !== last) {
        modScroll.append(mk('div', 'cm-subhdr', sub));
        last = sub;
      }
      modScroll.append(makeModuleRow(m));
    }
    modScroll.scrollTop = keep;
  }

  function refreshGui() {
    buildSidebar();
    renderModuleList();
    renderSettings();
    updateHeaderLabel();
  }

  // ---------- 搜索 ----------
  function setSearch(on) {
    searchActive = on;
    searchBox.classList.toggle('active', on);
    results.classList.toggle('show', on);
    updateHeaderLabel();
    if (on) {
      renderSearchResults();
      try { searchInput.focus(); } catch (e) { /* noop */ }
    } else {
      searchInput.value = '';
      try { searchInput.blur(); } catch (e) { /* noop */ }
    }
  }

  function renderSearchResults() {
    const q = searchInput.value.trim().toLowerCase();
    results.innerHTML = '';
    const mods = MODULES.filter((m) => !q
      || m.name.toLowerCase().includes(q)
      || (m.cn || '').includes(q)
      || m.desc.toLowerCase().includes(q)
      || (MODS_BY_ID[m.id] && (CATS.find((c) => c.id === m.cat) || { name: '' }).name.includes(q)));
    if (!mods.length) {
      results.append(mk('div', 'cm-rempty', '未找到模块'));
      return;
    }
    for (const m of mods) {
      const cat = CATS.find((c) => c.id === m.cat);
      const row = mk('div', 'cm-resrow' + (modOn(m.id) ? ' on' : ''));
      row.append(mk('span', 'cm-ball'));
      row.append(mk('span', 'cm-rname', m.cn || m.name));
      row.append(mk('span', 'cm-rcat', cat ? cat.name : ''));
      row.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (ev.button === 0) { toggleModule(m); renderSearchResults(); return; }
        if (ev.button === 2) {
          setSearch(false);
          selectCategory(m.cat);
          selectModule(m);
        }
      });
      results.append(row);
    }
  }

  searchBox.addEventListener('mousedown', (ev) => {
    ev.stopPropagation();
    if (!searchActive) setSearch(true);
    searchInput.focus();
  });
  searchInput.addEventListener('input', () => { if (searchActive) renderSearchResults(); });
  searchInput.addEventListener('focus', () => { if (!searchActive) setSearch(true); });

  // ---------- 打开 / 关闭：两套 UI 各按各的键，独立开关 ----------
  function syncGuiClasses() {
    void gui.offsetWidth;
    gui.classList.toggle('any-open', guiOpen());
    gui.classList.toggle('float-open', floatOpen);
    gui.classList.toggle('classic-open', classicOpen);
    document.documentElement.classList.toggle('cm-gui-open', guiOpen());
  }

  function prepareOpen() {
    gui.classList.remove('closing');
    gui.classList.add('visible');
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* noop */ }
    try { if (state.game && state.game.releasePointer) state.game.releasePointer(); } catch (e) { /* noop */ }
  }

  function finishClose(immediate) {
    if (guiOpen()) return;
    gui.classList.add('closing');
    const done = () => {
      if (!guiOpen()) {
        gui.classList.remove('visible');
        gui.classList.remove('closing');
      }
    };
    if (immediate) done(); else setTimeout(done, 240);
  }

  function setFloatOpen(open, immediate) {
    open = !!open;
    if (open === floatOpen) { syncGuiClasses(); return open; }
    floatOpen = open;
    if (open) {
      prepareOpen();
      buildFloatPanels();
      layoutPanel();
      buildSidebar();
      renderModuleList();
      renderSettings();
      updateHeaderLabel();
    } else {
      finishClose(immediate);
    }
    syncGuiClasses();
    return open;
  }

  function setClassicOpen(open, immediate) {
    open = !!open;
    if (open === classicOpen) { syncGuiClasses(); return open; }
    classicOpen = open;
    if (open) {
      prepareOpen();
      layoutPanel();
      buildSidebar();
      renderModuleList();
      renderSettings();
      updateHeaderLabel();
    } else {
      setSearch(false);
      bindingModule = null;
      openSelect = null;
      finishClose(immediate);
    }
    syncGuiClasses();
    return open;
  }

  function toggleFloat(force) {
    return setFloatOpen(force != null ? !!force : !floatOpen);
  }
  function toggleClassic(force) {
    return setClassicOpen(force != null ? !!force : !classicOpen);
  }

  // 兼容旧 API：一次同时开关两套
  function setGuiOpen(open, immediate) {
    setFloatOpen(open, immediate);
    setClassicOpen(open, immediate);
    return !!open;
  }
  function toggleMenu(force) {
    const show = force != null ? !!force : !guiOpen();
    setGuiOpen(show);
    return show;
  }

  // 中键拖动整个面板（彗星 DragHandler）
  panel.addEventListener('mousedown', (ev) => {
    if (ev.button !== 1) return;
    ev.preventDefault(); ev.stopPropagation();
    const sx = ev.clientX, sy = ev.clientY;
    const ox = cfg.guiOffset.x, oy = cfg.guiOffset.y;
    const move = (e2) => {
      cfg.guiOffset.x = ox + (e2.clientX - sx) / 2;
      cfg.guiOffset.y = oy + (e2.clientY - sy) / 2;
      layoutPanel();
    };
    const up = () => {
      W.removeEventListener('mousemove', move);
      W.removeEventListener('mouseup', up);
      saveCfg();
    };
    W.addEventListener('mousemove', move);
    W.addEventListener('mouseup', up);
  });

  panel.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
  panel.addEventListener('wheel', (ev) => { ev.stopPropagation(); }, { passive: true });
  panel.addEventListener('mousedown', (ev) => {
    // 点击搜索框/结果之外的地方收起搜索
    if (searchActive && !searchBox.contains(ev.target) && !results.contains(ev.target)) setSearch(false);
  });

  W.addEventListener('resize', () => { if (guiOpen()) layoutPanel(); applyHudPos(); });

  // ---------- 设置面板 ----------
  let settingsScrollTop = 0;

  function iconFor(type) {
    return { checkbox: '⊞', slider: '≡', select: '⌄', text: '✎', button: '', color: '◐' }[type] || '';
  }

  function fmtNum(v, step) {
    if (!isFinite(v)) return '?';
    if (step >= 1) return String(Math.round(v));
    if (step >= 0.1) return (Math.round(v * 10) / 10).toFixed(1);
    return (Math.round(v * 100) / 100).toFixed(2);
  }

  function getOptions(s) {
    const o = typeof s.options === 'function' ? s.options() : (s.options || []);
    return Array.isArray(o) ? o : [];
  }

  function renderSettings() {
    const oldScroll = setsPane.querySelector('.cm-set-scroll');
    if (oldScroll) settingsScrollTop = oldScroll.scrollTop;
    setsPane.innerHTML = '';
    settingsTitle = null;
    settingsDesc = null;

    if (!selectedModule) {
      setsPane.append(mk('div', 'cm-stitle', '设置'));
      const d = mk('div', 'cm-sdesc', '选择一个模块');
      d.style.top = '22px';
      d.style.left = '8px';
      d.style.width = '150px';
      setsPane.append(d);
      return;
    }

    const m = selectedModule;
    settingsTitle = mk('div', 'cm-stitle', m.cn || m.name);
    settingsDesc = mk('div', 'cm-sdesc', m.desc);
    if (m.id === 'floatgui') settingsDesc.textContent = m.desc + ' · 当前按键：' + keyName(cfg.guiKey);
    setsPane.append(settingsTitle, settingsDesc);
    setsPane.append(mk('div', 'cm-divider'));
    if (m.id === 'mc18') updateMc18Status();
    if (bindingModule === m) settingsDesc.textContent = '按下按键绑定 · Delete 清除';

    const scroll = mk('div', 'cm-set-scroll');
    const content = mk('div', 'cm-set-content');
    let y = 7;
    for (const s of (m.settings || [])) {
      const key = m.id + '.' + s.id;
      const opts = (s.type === 'select' || s.type === 'multi') ? getOptions(s) : null;
      const expanded = (s.type === 'select' || s.type === 'multi') && openSelect === key;
      const h = 16 + (expanded ? opts.length * 14 : 0);
      content.append(makeSettingRow(m, s, key, y, h, expanded, opts));
      y += h + 2;
    }
    content.append(makeBindRow(m, y));
    y += 18;
    content.style.height = y + 'px';
    scroll.append(content);
    setsPane.append(scroll);
    scroll.scrollTop = settingsScrollTop;
  }

  function makeBindRow(m, top) {
    const row = mk('div', 'cm-set cm-bindrow');
    row.style.top = top + 'px';
    row.style.height = '16px';
    row.append(mk('span', 'cm-sicon', '⌨'));
    row.append(mk('span', 'cm-sname', '快捷键'));
    const cur = cfg.binds[m.id];
    const val = mk('span', 'cm-bindv',
      bindingModule === m ? '按键中…' : (cur ? keyName(cur) : '未绑定'));
    row.append(val);
    row.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      bindingModule = bindingModule === m ? null : m;
      renderModuleList();
      renderSettings();
    });
    return row;
  }

  function makeSettingRow(m, s, key, top, height, expanded, opts) {
    const row = mk('div', 'cm-set');
    row.style.top = top + 'px';
    row.style.height = height + 'px';
    const icon = iconFor(s.type);
    if (icon) row.append(mk('span', 'cm-sicon', icon));

    if (s.type === 'slider') {
      const val = getS(m.id, s.id);
      row.append(mk('span', 'cm-sname', s.cn || s.name));
      const label = mk('span', 'cm-value');
      const b = mk('b', '', fmtNum(val, s.step));
      label.append(b, mk('span', '', s.unit ? ' ' + s.unit : ''));
      row.append(label);

      const track = mk('div', 'cm-track');
      const fill = mk('div', 'cm-fill');
      const knob = mk('div', 'cm-knob');
      track.append(fill, knob);
      row.append(track);

      const paint = () => {
        const v = getS(m.id, s.id);
        const pct = Math.min(1, Math.max(0, (v - s.min) / (s.max - s.min)));
        fill.style.width = (pct * 100) + '%';
        knob.style.left = (pct * 100) + '%';
        b.textContent = fmtNum(v, s.step);
      };
      const put = (cx) => {
        const r = track.getBoundingClientRect();
        const pct = Math.min(1, Math.max(0, (cx - r.left) / r.width));
        const raw = s.min + pct * (s.max - s.min);
        const v = Math.min(s.max, Math.max(s.min, Math.round(raw / s.step) * s.step));
        cfg.settings[key] = Math.round(v * 1000) / 1000;
        paint();
      };
      track.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault(); ev.stopPropagation();
        put(ev.clientX);
        const move = (e2) => put(e2.clientX);
        const up = () => {
          W.removeEventListener('mousemove', move);
          W.removeEventListener('mouseup', up);
          saveCfg();
        };
        W.addEventListener('mousemove', move);
        W.addEventListener('mouseup', up);
      });
      paint();
      return row;
    }

    if (s.type !== 'button') {
      row.append(mk('span', 'cm-sname', s.cn || s.name));
      if (s.desc) row.append(mk('span', 'cm-sldesc', s.desc));
    }

    if (s.type === 'checkbox') {
      const sw = mk('span', 'cm-switch' + (getS(m.id, s.id) ? ' on' : ''));
      sw.append(mk('i'));
      row.append(sw);
      row.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault(); ev.stopPropagation();
        setS(m.id, s.id, !getS(m.id, s.id));
        renderSettings();
      });
      return row;
    }

    if (s.type === 'color') {
      const cur = getS(m.id, s.id) || '';
      const box = mk('div', 'cm-colorbox');
      const sw = mk('span', 'cm-csw' + (cur ? '' : ' auto'));
      if (cur) sw.style.background = cur;
      const txt = mk('span', 'cm-ctxt', cur || '默认');
      const clr = mk('span', 'cm-cclr', '↺');
      const input = document.createElement('input');
      input.type = 'color';
      input.className = 'cm-cinput';
      input.value = cur || '#ff6b6b';
      box.append(sw, txt, clr, input);
      row.append(box);
      const apply = (v) => {
        cfg.settings[key] = v;
        saveCfg();
        sw.classList.toggle('auto', !v);
        sw.style.background = v || '';
        txt.textContent = v || '默认';
        input.value = v || '#ff6b6b';
      };
      box.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault(); ev.stopPropagation();
        if (ev.target === clr) { apply(''); return; }
        try { input.click(); } catch (err) { /* noop */ }
      });
      input.addEventListener('input', () => apply(input.value));
      row.title = '点击色块选择颜色 · ↺ 恢复默认';
      return row;
    }

    if (s.type === 'select') {
      const cur = getS(m.id, s.id) || opts[0];
      const box = mk('div', 'cm-select');
      box.append(mk('span', 'cm-sk', cur));
      box.append(mk('span', 'cm-arrow', '▾'));
      row.append(box);
      box.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault(); ev.stopPropagation();
        openSelect = (openSelect === key ? null : key);
        renderSettings();
      });
      if (expanded) {
        const list = mk('div', 'cm-options');
        for (const o of opts) {
          const opt = mk('div', 'cm-option' + (o === cur ? ' sel' : ''));
          opt.append(mk('span', 'cm-obox'), mk('span', 'cm-otxt', o));
          opt.addEventListener('mousedown', (ev) => {
            if (ev.button !== 0) return;
            ev.preventDefault(); ev.stopPropagation();
            setS(m.id, s.id, o);
            openSelect = null;
            renderSettings();
          });
          list.append(opt);
        }
        row.append(list);
      }
      return row;
    }

    if (s.type === 'multi') {
      const cur = Array.isArray(getS(m.id, s.id)) ? getS(m.id, s.id) : [];
      const box = mk('div', 'cm-select');
      box.append(mk('span', 'cm-sk', cur.length ? (cur.length >= opts.length ? '全部' : cur.length + ' 项') : '默认'));
      box.append(mk('span', 'cm-arrow', '▾'));
      row.append(box);
      box.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault(); ev.stopPropagation();
        openSelect = (openSelect === key ? null : key);
        renderSettings();
      });
      if (expanded) {
        const list = mk('div', 'cm-options');
        for (const o of opts) {
          const on = cur.indexOf(o) !== -1;
          const opt = mk('div', 'cm-option' + (on ? ' sel' : ''));
          opt.append(mk('span', 'cm-obox'), mk('span', 'cm-otxt', o));
          opt.addEventListener('mousedown', (ev) => {
            if (ev.button !== 0) return;
            ev.preventDefault(); ev.stopPropagation();
            const arr = Array.isArray(getS(m.id, s.id)) ? getS(m.id, s.id).slice() : [];
            const i = arr.indexOf(o);
            if (i === -1) arr.push(o); else arr.splice(i, 1);
            setS(m.id, s.id, arr);
            saveCfg();
            renderSettings();
          });
          list.append(opt);
        }
        row.append(list);
      }
      return row;
    }

    if (s.type === 'text') {
      const wrap = mk('div', 'cm-text');
      const input = document.createElement('input');
      input.value = String(getS(m.id, s.id) ?? '');
      input.placeholder = s.placeholder || '';
      input.spellcheck = false;
      input.addEventListener('input', () => setS(m.id, s.id, input.value));
      input.addEventListener('change', () => setS(m.id, s.id, input.value));
      wrap.addEventListener('mousedown', (ev) => ev.stopPropagation());
      wrap.append(input);
      row.append(wrap);
      return row;
    }

    if (s.type === 'button') {
      const btn = mk('div', 'cm-btn', s.cn || s.name);
      btn.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault(); ev.stopPropagation();
        runAction(m, s);
      });
      row.append(btn);
      return row;
    }

    return row;
  }

  let bindingGuiKey = false;
  function startBindGuiKey() {
    bindingGuiKey = true;
    pushNotification('悬浮标签', '按下想用的按键（Esc 取消，纯修饰键不算）');
  }
  function setGuiKey(code) {
    cfg.guiKey = code;
    bindingGuiKey = false;
    saveCfg();
    try { floatVer.textContent = 'OpusHUD v' + VERSION + ' · ' + keyName(code) + ' 悬浮标签 / Ins 经典面板'; } catch (e) { /* noop */ }
    pushNotification('悬浮标签', '呼出按键已设为 ' + keyName(code));
    refreshGui();
  }

  function runAction(m, s) {
    if (m.id === 'resourcepack' && s.id === 'open') rpMenuSetOpen(true);
    if (m.id === 'resourcepack' && s.id === 'import') rpImport();
    if (m.id === 'resourcepack' && s.id === 'reapply') {
      if (!rp.packs.length) { pushNotification('材质包', '还没导入材质包'); return; }
      rpReapply();
    }
    if (m.id === 'resourcepack' && s.id === 'clear') rpClear();
    if (m.id === 'resourcepack' && s.id === 'demo') rpLoadBuiltin();
    if (m.id === 'server' && s.id === 'apply') {
      applyServer();
      notify('服务器切换', (cfg.servers[cfg.serverIdx] || {}).name || '已应用');
    }
    if (m.id === 'mc18' && s.id === 'toggle') toggleMc18();
    if (m.id === 'hudedit' && s.id === 'edit') setEditHud(!state.editHud);
    if (m.id === 'hudedit' && s.id === 'resetpos') { resetHudPos(); notify('HUD 编辑', '位置已重置'); }
    if (m.id === 'cfgreset' && s.id === 'reset') resetConfig();
    if (m.id === 'cfgreset' && s.id === 'export') exportConfig();
    if (m.id === 'cfgreset' && s.id === 'import') importConfig();
    if (m.id === 'floatgui' && s.id === 'reset') resetFloatPos();
    if (m.id === 'floatgui' && s.id === 'hotkey') startBindGuiKey();
    if (m.id === 'waypoints' && s.id === 'add') markHere();
    if (m.id === 'waypoints' && s.id === 'clear') clearWaypoints();
    if (m.id === 'blockesp' && s.id === 'browse') openBlockPicker();
    if (m.id === 'music' && s.id === 'open') musicBoxOpen(true);
    if (m.id === 'music' && s.id === 'editpos') setEditHud(true);
    if (m.id === 'music' && s.id === 'resetpos') resetPanelPos('musicPos', 16, 16);
    if (m.id === 'about' && s.id === 'open') { hTab = 'about'; helperOpen(true); }
    if (m.id === 'quicktoggle' && s.id === 'run') extQuickToggle();
    if (m.id === 'guide' && s.id === 'open') { hTab = 'guide'; helperOpen(true); }
    if (m.id === 'screenshot' && s.id === 'take') extScreenshot();
    if (m.id === 'selftest' && s.id === 'run') {
      const r = extSelfTest();
      pushNotification('模块自检', r.problems.length ? r.problems.length + ' 项异常' : '全部通过（' + r.modules + ' 个模块）');
    }
    if (m.id === 'selftest' && s.id === 'open') { hTab = 'test'; helperOpen(true); }
    if (m.id === 'blockhistory' && s.id === 'clear') { extD.blockSeen = []; extHudD(); }
    if (m.id === 'chatlog' && s.id === 'clear') { extD.chatSeen = []; extHudD(); }
    if (m.id === 'orestats' && s.id === 'reset') { extD.oreSeen.clear(); extHudD(); }
    if (m.id === 'coordcopy' && s.id === 'copy') extCopyCoord();
    if (m.id === 'sessionstats' && s.id === 'export') extExportStats();
    if (m.id === 'helpcenter' && s.id === 'open') helperOpen(true);
    if (m.id === 'helpcenter' && s.id === 'export') extExportModuleList();
    if (m.id === 'keyadmin' && s.id === 'open') { hTab = 'keys'; helperOpen(true); }
    if (m.id === 'keyadmin' && s.id === 'clear') {
      cfg.binds = {}; saveCfg(); refreshGui(); helperRender();
      pushNotification('键位管理', '已清空全部键位');
    }
    if (m.id === 'healthcheck' && s.id === 'run') {
      const r = extHealthCheck();
      pushNotification('配置体检', r.issues.length ? r.issues.length + ' 项异常，点开帮助中心查看' : '一切正常');
    }
    if (m.id === 'healthcheck' && s.id === 'export') extExportCheck();
    if (m.id === 'coordlog' && s.id === 'add') extAddCoord();
    if (m.id === 'coordlog' && s.id === 'clear') extClearCoords();
    if (m.id === 'sessionstats' && s.id === 'reset') extResetStats();
    if (m.id === 'combatlog' && s.id === 'clear') { ext.events = []; extHud(); }
    if (m.id === 'profile' && s.id === 'save') extSaveProfile();
    if (m.id === 'profile' && s.id === 'load') extLoadProfile();
    if (m.id === 'macro' && s.id === 'run1') extRunMacro(1);
    if (m.id === 'macro' && s.id === 'run2') extRunMacro(2);
    if (m.id === 'macro' && s.id === 'run3') extRunMacro(3);
    if (m.id === 'minimap' && s.id === 'open') bigmapOpen(true);
    if (m.id === 'minimap' && s.id === 'editpos') setEditHud(true);
    if (m.id === 'invhud' && s.id === 'editpos') setEditHud(true);
    if (m.id === 'drops' && s.id === 'editpos') setEditHud(true);
    if (m.id === 'minimap' && s.id === 'resetpos') resetPanelPos('minmapPos', 16, 16);
    if (m.id === 'invhud' && s.id === 'resetpos') resetPanelPos('invPos', 16, 16);
    if (m.id === 'drops' && s.id === 'resetpos') resetPanelPos('dropsPos', 16, 210);
  }

  function toggleMc18() {
    const M = W.__mc18;
    if (!M) { notify('MC18 连接', '请先安装 opus-mc18-link'); return; }
    try {
      const st = M.status().state;
      if (st === 'play' || st === 'connecting' || st === 'login') {
        M.disconnect();
        notify('MC18 连接', '已断开');
      } else {
        M.connect(cfg.mcAddr, cfg.mcName);
        notify('MC18 连接', '连接中...');
      }
    } catch (e) { /* noop */ }
    updateMc18Status();
  }

  function updateMc18Status() {
    if (!settingsDesc || !selectedModule || selectedModule.id !== 'mc18') return;
    try {
      const M = W.__mc18;
      if (!M) { settingsDesc.textContent = '状态：请先安装 opus-mc18-link'; return; }
      const st = M.status().state;
      settingsDesc.textContent = '状态：' + ({
        idle: '未连接', connecting: '连接中', login: '登录中', play: '已连接', closed: '已断开',
      }[st] || st || '?');
    } catch (e) { /* noop */ }
  }

  function resetConfig() {
    cfg.states = {};
    cfg.settings = {};
    cfg.binds = {};
    cfg.favorites = {};
    cfg.hudPos = {};
    cfg.guiOffset = { x: 0, y: 0 };
    cfg.floatPos = {};
    cfg.guiKey = 'Backquote';
    for (const m of MODULES) cfg.states[m.id] = !!m.state;
    saveCfg();
    refreshGui();
    refreshHud();
    notify('配置重置', '配置已重置');
  }

  // ---------- 专用备份格式 .opuscfg ----------
  // 第一行固定魔数 OPUSCFG1，第二行是 UTF-8 JSON 的 base64；带应用标识 / 版本 / 保存时间。
  const CFG_KEYS = ['states', 'settings', 'binds', 'favorites', 'hudPos', 'guiOffset',
    'floatPos', 'theme', 'servers', 'serverIdx', 'mcAddr', 'mcName', 'guiKey',
    'waypoints', 'minmapPos', 'invPos', 'mapOpts', 'appearance', 'ext', 'extPos',
    'dropsPos', 'musicPos', 'fpsGraphPos', 'extFold'];

  function b64enc(s) {
    try { return W.btoa(unescape(encodeURIComponent(s))); } catch (e) { return null; }
  }
  function b64dec(s) {
    try { return decodeURIComponent(escape(W.atob(s))); } catch (e) { return null; }
  }
  function buildBackup() {
    const data = {};
    for (const k of CFG_KEYS) if (cfg[k] !== undefined) data[k] = cfg[k];
    const payload = {
      app: 'OpusMC-Comet', format: 'opuscfg', version: VERSION,
      savedAt: new Date().toISOString(), data,
    };
    const b = b64enc(JSON.stringify(payload));
    return b ? 'OPUSCFG1\n' + b + '\n' : null;
  }
  function parseBackup(txt) {
    const s = String(txt || '');
    const nl = s.indexOf('\n');
    if (nl < 0 || s.slice(0, nl).trim() !== 'OPUSCFG1') throw new Error('不是 .opuscfg 备份');
    const json = b64dec(s.slice(nl + 1).replace(/\s/g, ''));
    if (!json) throw new Error('内容无法解码');
    const o = JSON.parse(json);
    if (!o || o.format !== 'opuscfg' || !o.data) throw new Error('格式不正确');
    return o;
  }
  function applyImported(o) {
    for (const k of CFG_KEYS) if (o.data[k] !== undefined) cfg[k] = o.data[k];
    saveCfg();
    try { applyTheme(); layoutPanel(); applyHudPos(); } catch (e) { /* noop */ }
    refreshGui();
    refreshHud();
    pushNotification('配置备份', '已导入 ' + (o.version || '?') + ' 的配置');
  }
  function exportConfig() {
    try {
      const body = buildBackup();
      if (!body) throw new Error('编码失败');
      const blob = new Blob([body], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'opus-comet-' + new Date().toISOString().slice(0, 10) + '.opuscfg';
      (document.body || document.documentElement).appendChild(a);
      a.click();
      if (a.remove) a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* noop */ } }, 2000);
      pushNotification('配置备份', '已导出 .opuscfg 文件');
    } catch (e) {
      try {
        navigator.clipboard.writeText(buildBackup() || '');
        pushNotification('配置备份', '文件下载不可用，已复制到剪贴板');
      } catch (e2) {
        pushNotification('配置备份', '导出失败：' + e.message);
      }
    }
  }
  function importConfig() {
    try {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.opuscfg,text/plain';
      inp.addEventListener('change', () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const fr = new FileReader();
        fr.onload = () => {
          try { applyImported(parseBackup(String(fr.result || ''))); }
          catch (e) { pushNotification('配置备份', '导入失败：' + e.message); }
        };
        fr.onerror = () => pushNotification('配置备份', '文件读取失败');
        fr.readAsText(f);
      });
      inp.click();
    } catch (e) {
      pushNotification('配置备份', '无法打开文件选择：' + e.message);
    }
  }

  // ---------- HUD（彗星式界面元素） ----------
  const hudStage = document.createElement('div');
  hudStage.id = '__comet_hudstage';
  hudStage.innerHTML = `
    <div class="cm-hud cm-wm" id="__c_wm" data-hl="水印">
      <div class="cm-hudicon">✦</div>
      <div class="cm-hudbox">
        <span class="cm-hval" id="__c_wm_user">Player</span>
        <span class="cm-hsep">»</span>
        <span class="cm-hico">◈</span>
        <span class="cm-hval" id="__c_wm_fps">0</span><span class="cm-hlbl">fps</span>
        <span class="cm-hsep">»</span>
        <span class="cm-hico">◷</span>
        <span class="cm-hval" id="__c_wm_time">00:00</span>
        <span class="cm-hsep" id="__c_wm_netsep" style="display:none">»</span>
        <span class="cm-hico" id="__c_wm_netico" style="display:none">⇄</span>
        <span class="cm-hval" id="__c_wm_net" style="display:none">联机</span>
      </div>
    </div>
    <div class="cm-hud cm-info" id="__c_info" data-hl="坐标">
      <div class="cm-hudbox">
        <span class="cm-hico">✚</span>
        <span class="cm-hlbl">x</span><span class="cm-hval" id="__c_ix">0</span>
        <span class="cm-hsep">»</span>
        <span class="cm-hlbl">y</span><span class="cm-hval" id="__c_iy">0</span>
        <span class="cm-hsep">»</span>
        <span class="cm-hlbl">z</span><span class="cm-hval" id="__c_iz">0</span>
        <span class="cm-hsep">»</span>
        <span class="cm-hval" id="__c_ibps">0.0</span><span class="cm-hlbl">b/s</span>
      </div>
    </div>
    <div class="cm-target" id="__c_target" data-hl="目标面板">
      <div class="cm-tface"><canvas id="__c_tface" width="48" height="48"></canvas></div>
      <div class="cm-tname" id="__c_tname">Target</div>
      <div class="cm-thp" id="__c_thp">20.0</div>
      <div class="cm-tbar"><div class="cm-tfill" id="__c_tfill"></div></div>
    </div>
    <div class="cm-array" id="__c_array" data-hl="模块列表"></div>
    <div class="cm-notes" id="__c_notes" data-hl="通知"></div>
  `;

  const $h = (id) => hudStage.querySelector('#' + id);
  const elWm = $h('__c_wm');
  const elWmUser = $h('__c_wm_user');
  const elWmFps = $h('__c_wm_fps');
  const elWmTime = $h('__c_wm_time');
  const elWmNet = $h('__c_wm_net');
  const elWmNetIco = $h('__c_wm_netico');
  const elWmNetSep = $h('__c_wm_netsep');
  const elInfo = $h('__c_info');
  const elIx = $h('__c_ix');
  const elIy = $h('__c_iy');
  const elIz = $h('__c_iz');
  const elIbps = $h('__c_ibps');
  const elTarget = $h('__c_target');
  const elTName = $h('__c_tname');
  const elTHp = $h('__c_thp');
  const elTFill = $h('__c_tfill');
  const elTFace = $h('__c_tface');
  const tfctx = elTFace ? elTFace.getContext('2d') : null;
  const elArray = $h('__c_array');
  const elNotes = $h('__c_notes');

  function defaultHudPos(key) {
    if (key === 'watermark') return { x: 20, y: 8 };
    if (key === 'info') return { x: 20, y: 36 };
    if (key === 'target') return { x: 20, y: 88 };
    return { x: 20, y: 20 };
  }
  function hudPos(key) {
    if (!cfg.hudPos[key]) cfg.hudPos[key] = defaultHudPos(key);
    return cfg.hudPos[key];
  }
  function applyHudPos() {
    const wm = hudPos('watermark'), info = hudPos('info'), tg = hudPos('target');
    elWm.style.left = wm.x + 'px'; elWm.style.top = wm.y + 'px';
    elInfo.style.left = info.x + 'px'; elInfo.style.top = info.y + 'px';
    elTarget.style.left = tg.x + 'px'; elTarget.style.top = tg.y + 'px';
    const arr = cfg.hudPos.array;
    elArray.style.transform = arr ? 'translate(' + arr.x + 'px,' + arr.y + 'px)' : '';
    const nts = cfg.hudPos.notes;
    elNotes.style.transform = nts ? 'translate(' + nts.x + 'px,' + nts.y + 'px)' : '';
    const cp = cfg.hudPos.compass;
    if (cp) {
      compass.style.left = cp.x + 'px'; compass.style.top = cp.y + 'px'; compass.style.marginLeft = '0';
    } else {
      compass.style.left = '50%'; compass.style.top = '8px'; compass.style.marginLeft = '-150px';
    }
    const rd = cfg.hudPos.radar;
    if (rd) {
      radar.style.left = rd.x + 'px'; radar.style.top = rd.y + 'px';
      radar.style.right = 'auto'; radar.style.bottom = 'auto';
    } else {
      radar.style.left = 'auto'; radar.style.top = 'auto';
      radar.style.right = '12px'; radar.style.bottom = '12px';
    }
  }
  function resetHudPos() {
    cfg.hudPos = {};
    saveCfg();
    applyHudPos();
  }

  function bindHudDrag(el, key) {
    el.addEventListener('mousedown', (ev) => {
      if (!(guiOpen() || state.editHud) || ev.button !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      const pos = hudPos(key);
      const sx = ev.clientX, sy = ev.clientY, ox = pos.x, oy = pos.y;
      const move = (e2) => {
        pos.x = ox + (e2.clientX - sx) / 2;
        pos.y = oy + (e2.clientY - sy) / 2;
        applyHudPos();
      };
      const up = () => {
        W.removeEventListener('mousemove', move);
        W.removeEventListener('mouseup', up);
        saveCfg();
      };
      W.addEventListener('mousemove', move);
      W.addEventListener('mouseup', up);
    });
  }
  // 列表类 HUD（模块列表 / 通知）用位移偏移，不改变原来的贴边布局
  function bindOffsetDrag(el, key) {
    el.addEventListener('mousedown', (ev) => {
      if (!state.editHud || ev.button !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      const pos = cfg.hudPos[key] || { x: 0, y: 0 };
      cfg.hudPos[key] = pos;
      const sx = ev.clientX, sy = ev.clientY, ox = pos.x, oy = pos.y;
      const move = (e2) => {
        pos.x = ox + (e2.clientX - sx) / 2;
        pos.y = oy + (e2.clientY - sy) / 2;
        applyHudPos();
      };
      const up = () => {
        W.removeEventListener('mousemove', move);
        W.removeEventListener('mouseup', up);
        saveCfg();
      };
      W.addEventListener('mousemove', move);
      W.addEventListener('mouseup', up);
    });
  }
  // 罗盘 / 雷达是屏幕像素级的 fixed canvas，直接改 left/top
  function bindCanvasDrag(el, key) {
    el.addEventListener('mousedown', (ev) => {
      if (!state.editHud || ev.button !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      const r0 = el.getBoundingClientRect();
      const pos = cfg.hudPos[key] || { x: Math.round(r0.left), y: Math.round(r0.top) };
      cfg.hudPos[key] = pos;
      const sx = ev.clientX, sy = ev.clientY, ox = pos.x, oy = pos.y;
      const move = (e2) => {
        pos.x = ox + (e2.clientX - sx);
        pos.y = oy + (e2.clientY - sy);
        applyHudPos();
      };
      const up = () => {
        W.removeEventListener('mousemove', move);
        W.removeEventListener('mouseup', up);
        saveCfg();
      };
      W.addEventListener('mousemove', move);
      W.addEventListener('mouseup', up);
    });
  }
  bindHudDrag(elWm, 'watermark');
  bindHudDrag(elInfo, 'info');
  bindHudDrag(elTarget, 'target');
  bindOffsetDrag(elArray, 'array');
  bindOffsetDrag(elNotes, 'notes');
  bindCanvasDrag(compass, 'compass');
  bindCanvasDrag(radar, 'radar');

  // ---------- HUD 编辑模式 ----------
  const editBar = document.createElement('div');
  editBar.id = '__comet_editbar';
  editBar.textContent = '拖动 HUD 元素调整位置 · 点击这里完成（Esc）';
  editBar.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); setEditHud(false); });

  function setEditHud(on) {
    state.editHud = !!on;
    if (state.editHud && guiOpen()) toggleMenu(false);
    hudStage.classList.toggle('edit', state.editHud);
    compass.classList.toggle('edit', state.editHud);
    radar.classList.toggle('edit', state.editHud);
    editBar.style.display = state.editHud ? 'block' : 'none';
    try {
      for (const el of [invBox, dropBox, miniCanvas]) el.classList.toggle('cm-draggable', state.editHud);
      updateInventory(); updateDrops(); drawMinimap();
    } catch (e) { /* noop */ }
    // 还没进游戏（没有渲染钩子）时，编辑模式也要有帧驱动，才能看到罗盘 / 雷达占位
    if (state.editHud && !renderHooked) startFallbackLoop();
    if (state.editHud) refreshHud();
    else saveCfg();
  }

  function playerName() {
    try {
      const g = state.game, p = state.player;
      if (g && (g.username || g.userName)) return g.username || g.userName;
      if (p && (p.name || p.username)) return p.name || p.username;
    } catch (e) { /* noop */ }
    return 'Player';
  }

  let lastSample = null;
  let bpsSmooth = 0;

  // ---------- 目标面板头像 ----------
  // OpusMC 的生物类型挂在 e.T（e.type 往往只是 'Mob'），中文名也要能反查
  const FACE_CN = {
    '羊': 'sheep', '牛': 'cow', '猪': 'pig', '鸡': 'chicken', '苦力怕': 'creeper',
    '僵尸': 'zombie', '骷髅': 'skeleton', '末影人': 'enderman', '蜘蛛': 'spider',
    '洞穴蜘蛛': 'cave_spider', '村民': 'villager', '狼': 'wolf', '猫': 'cat',
    '马': 'horse', '史莱姆': 'slime', '岩浆怪': 'magma_cube', '女巫': 'witch',
    '烈焰人': 'blaze', '恶魂': 'ghast', '监守者': 'warden', '凋灵': 'wither',
    '蠹虫': 'silverfish', '溺尸': 'drowned', '猪灵': 'piglin', '疣猪兽': 'hoglin',
    '幻翼': 'phantom', '守卫者': 'guardian', '劫掠兽': 'ravager',
    '美西螈': 'axolotl', '悦灵': 'allay',
  };
  function faceType(e) {
    try {
      if (!e) return '';
      if (e.type === 'player') return 'player';
      const T = e.T || (e.type && W.ENTITY_DATA && W.ENTITY_DATA.types ? W.ENTITY_DATA.types[e.type] : null);
      let k = (T && (T.key || T.id || T.name)) || e.type || '';
      k = String(k).replace(/^minecraft:/, '').toLowerCase();
      const cn = String((T && T.cn) || cnName(e) || '').replace(/^幼年/, '');
      if (FACE_CN[cn]) return FACE_CN[cn];
      if (!k || k === 'mob' || k === 'object') k = String((e.constructor && e.constructor.name) || '').toLowerCase();
      return k;
    } catch (err) { return ''; }
  }
  const FACE_COLORS = {
    zombie: ['#6a9c4a', '#3f6629', '#101010'],
    skeleton: ['#d9d9d9', '#a0a0a0', '#1a1a1a'],
    creeper: ['#74c05a', '#47882f', '#0d0d0d'],
    enderman: ['#15151f', '#07070b', '#ff40ff'],
    spider: ['#33302e', '#513a26', '#ff3b3b'],
    cave_spider: ['#2b3f4a', '#16262e', '#ff3b3b'],
    witch: ['#6d5a86', '#47365b', '#1a1a1a'],
    blaze: ['#e6b833', '#a1760f', '#241400'],
    ghast: ['#eaeaea', '#c2c2c2', '#3a3a3a'],
    slime: ['#7fd97f', '#4ca34c', '#17330f'],
    magma_cube: ['#c25a20', '#7d3210', '#ffe066'],
    warden: ['#1d6e78', '#0b424a', '#7ef7ff'],
    wither: ['#333333', '#191919', '#ffffff'],
    blaze_rod: ['#e6b833', '#a1760f', '#241400'],
    villager: ['#c99a72', '#92602d', '#1a1a1a'],
    pig: ['#e79b9b', '#c06d6d', '#1a1a1a'],
    cow: ['#4a3524', '#2a1c11', '#1a1a1a'],
    sheep: ['#e8e4dc', '#b8b2a7', '#1a1a1a'],
    chicken: ['#e8e0cc', '#b8ae95', '#1a1a1a'],
    wolf: ['#c8c8c8', '#8a8a8a', '#1a1a1a'],
    cat: ['#d9a05b', '#9c6930', '#1a1a1a'],
    horse: ['#a5713f', '#6d4220', '#1a1a1a'],
    allay: ['#7fd8e8', '#4aa4ba', '#1a1a1a'],
    axolotl: ['#f2a0c0', '#bc5b87', '#1a1a1a'],
  };
  let faceRef;
  function paintFace(e) {
    const c = tfctx;
    if (!c) return;
    const S = 48;
    c.clearRect(0, 0, S, S);
    // 深色底：不管深色还是毛玻璃主题，头像都不会糊成一块空白
    c.fillStyle = '#12161f';
    rr(c, 1, 1, S - 2, S - 2, 8); c.fill();
    const t = faceType(e);
    if (!e) {
      c.fillStyle = '#7a8290'; c.font = '700 11px "Microsoft YaHei", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('目标', S / 2, S / 2 + 1);
      return;
    }
    if (drawOfficialFace(c, t, S, e)) return;
    if (t === 'player') {
      const nm = (e.name && e.name !== '?' ? e.name : '玩家');
      let h = 0; for (let i = 0; i < nm.length; i++) h = (h * 31 + nm.charCodeAt(i)) % 360;
      const g2 = c.createLinearGradient(0, 0, S, S);
      g2.addColorStop(0, 'hsl(' + h + ',68%,60%)');
      g2.addColorStop(1, 'hsl(' + ((h + 38) % 360) + ',62%,36%)');
      c.fillStyle = g2; rr(c, 3, 3, S - 6, S - 6, 9); c.fill();
      c.fillStyle = '#fff'; c.font = '700 24px "Microsoft YaHei", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(nm.slice(0, 1).toUpperCase(), S / 2, S / 2 + 1);
      return;
    }
    const pal = FACE_COLORS[t];
    const base = pal ? pal[0] : colorOf(e);
    const edge = pal ? pal[1] : '#2a2a33';
    let eyeColor = pal ? pal[2] : '#14141a';
    if (t === 'enderman') eyeColor = '#ff6bff';
    if (t === 'spider' || t === 'cave_spider') eyeColor = '#ff3b3b';
    if (t === 'sheep' || t === 'ghast') eyeColor = '#f2efe6';

    // 脸
    c.fillStyle = base;
    rr(c, 9, 9, 30, 30, 6); c.fill();
    c.fillStyle = 'rgba(255,255,255,.16)';
    rr(c, 12, 11, 24, 4, 2); c.fill();

    // 每种生物的特征
    if (t === 'sheep') {
      c.fillStyle = '#e7e2d6'; rr(c, 8, 7, 32, 34, 5); c.fill();
      c.fillStyle = '#d8cdb8'; rr(c, 14, 24, 20, 15, 4); c.fill();
      c.fillStyle = '#c9a89a'; rr(c, 19, 30, 10, 6, 2); c.fill();
      c.fillStyle = '#8c6f66'; c.fillRect(21, 32, 2, 2); c.fillRect(25, 32, 2, 2);
    } else if (t === 'cow') {
      c.fillStyle = '#e8dfc8'; rr(c, 5, 8, 7, 8, 2); c.fill(); rr(c, 36, 8, 7, 8, 2); c.fill();
      c.fillStyle = '#e9a9a0'; rr(c, 17, 30, 14, 8, 3); c.fill();
      c.fillStyle = '#8a5a55'; c.fillRect(20, 33, 2, 2); c.fillRect(26, 33, 2, 2);
    } else if (t === 'pig') {
      c.fillStyle = '#d8707a'; rr(c, 17, 29, 14, 9, 3); c.fill();
      c.fillStyle = '#7d3a41'; c.fillRect(20, 32, 3, 3); c.fillRect(26, 32, 3, 3);
    } else if (t === 'chicken') {
      c.fillStyle = '#d64545'; rr(c, 19, 4, 10, 7, 2); c.fill();
      c.fillStyle = '#f0b429'; c.beginPath(); c.moveTo(20, 30); c.lineTo(28, 30); c.lineTo(24, 36); c.closePath(); c.fill();
    } else if (t === 'creeper') {
      c.fillStyle = '#0d0d0d';
      c.fillRect(14, 19, 8, 8); c.fillRect(27, 19, 8, 8);
      c.fillRect(20, 27, 8, 9); c.fillRect(16, 33, 4, 6); c.fillRect(28, 33, 4, 6);
      eyeColor = null;
    } else if (t === 'skeleton' || t === 'wither') {
      c.fillStyle = '#20202a'; c.fillRect(13, 19, 8, 8); c.fillRect(27, 19, 8, 8);
      c.fillStyle = '#f2f2f2';
      for (let i = 0; i < 4; i++) c.fillRect(18 + i * 4, 32, 3, 4);
      eyeColor = null;
    } else if (t === 'enderman') {
      c.fillStyle = '#08080e'; rr(c, 9, 9, 30, 30, 6); c.fill();
      c.fillStyle = '#ff6bff'; c.fillRect(13, 21, 9, 4); c.fillRect(27, 21, 9, 4);
      eyeColor = null;
    } else if (t === 'spider' || t === 'cave_spider') {
      c.fillStyle = '#1a1010';
      for (const q of [[14, 19], [21, 17], [29, 19], [17, 26], [27, 26]]) {
        c.beginPath(); c.arc(q[0], q[1], 2.2, 0, Math.PI * 2); c.fill();
      }
      eyeColor = null;
    } else if (t === 'slime' || t === 'magma_cube') {
      c.fillStyle = 'rgba(255,255,255,.3)'; rr(c, 12, 12, 24, 10, 4); c.fill();
    } else if (t === 'villager') {
      c.fillStyle = '#a9793f'; rr(c, 21, 25, 6, 11, 3); c.fill();
      c.fillStyle = '#3d6b3d'; c.fillRect(15, 21, 3, 4); c.fillRect(30, 21, 3, 4);
    } else if (t === 'zombie') {
      c.fillStyle = '#2c4a1f'; c.fillRect(13, 17, 9, 3); c.fillRect(27, 17, 9, 3);
    } else if (t === 'blaze' || t === 'warden') {
      c.fillStyle = pal ? pal[2] : '#ffe066'; c.fillRect(13, 21, 9, 5); c.fillRect(27, 21, 9, 5);
      eyeColor = null;
    }

    if (eyeColor) {
      c.fillStyle = eyeColor;
      rr(c, 14, 20, 7, 8, 2); c.fill();
      rr(c, 27, 20, 7, 8, 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,.8)';
      c.fillRect(16, 21, 2, 2); c.fillRect(29, 21, 2, 2);
    }
    // 未知生物：右下角标中文名首字，至少能认出是什么
    if (!pal) {
      c.fillStyle = 'rgba(0,0,0,.62)'; rr(c, 28, 34, 16, 11, 3); c.fill();
      c.fillStyle = '#fff'; c.font = '700 9px "Microsoft YaHei", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(cnName(e) || '?').slice(0, 1), 36, 40);
    }
  }
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, r);
    else c.rect(x, y, w, h);
  }

  function updateHud() {
    const hudOn = modOn('hud');
    if (!hudOn && !state.editHud) return;

    const fps = num(state.game, 'fps');
    if (elWmFps) elWmFps.textContent = fps == null ? '0' : String(Math.round(fps));
    if (elWmUser) elWmUser.textContent = playerName();
    if (elWmTime) {
      const d = new Date();
      elWmTime.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    if (elWmNet) {
      const mp = isMP(state.game);
      const disp = mp ? '' : 'none';
      elWmNet.style.display = disp;
      if (elWmNetIco) elWmNetIco.style.display = disp;
      if (elWmNetSep) elWmNetSep.style.display = disp;
    }

    const rp = state.player ? readPos(state.player) : null;
    if (rp && rp.x != null) {
      elIx.textContent = String(Math.floor(rp.x));
      elIy.textContent = String(Math.floor(rp.y));
      elIz.textContent = String(Math.floor(rp.z));
      const now = performance.now();
      if (lastSample && lastSample.player === state.player) {
        const dt = (now - lastSample.t) / 1000;
        if (dt > 0.05 && dt < 2) {
          const dist = Math.hypot(rp.x - lastSample.x, rp.y - lastSample.y, rp.z - lastSample.z);
          const inst = dist / dt;
          bpsSmooth = bpsSmooth * 0.7 + inst * 0.3;
        }
      }
      lastSample = { player: state.player, x: rp.x, y: rp.y, z: rp.z, t: now };
    } else {
      elIx.textContent = elIy.textContent = elIz.textContent = '?';
    }
    if (elIbps) elIbps.textContent = bpsSmooth.toFixed(1);

    // TargetHud
    const tgt = (lastTarget && !lastTarget.dead && performance.now() - lastTargetAt < 4000)
      ? lastTarget : (auraTarget && !auraTarget.dead ? auraTarget : null);
    const showT = !!getS('hud', 'target') || state.editHud;
    if (tgt && showT) {
      elTarget.style.display = '';
      let name = cnName(tgt);
      try { if (tgt.type === 'player' && tgt.name) name = tgt.name; } catch (e) { /* noop */ }
      elTName.textContent = name;
      const hp = num(tgt, 'health') ?? 0;
      const maxHp = num(tgt, 'maxHealth') ?? 20;
      elTHp.textContent = hp.toFixed(1);
      elTFill.style.width = Math.min(100, Math.max(0, (hp / maxHp) * 100)) + '%';
      if (faceRef !== tgt || facePending) { try { paintFace(tgt); } catch (err) { /* noop */ } faceRef = tgt; facePending = false; }
    } else if (state.editHud) {
      elTarget.style.display = '';
      elTName.textContent = '目标面板';
      elTHp.textContent = '20.0';
      elTFill.style.width = '100%';
      if (faceRef !== null) { try { paintFace(null); } catch (err) { /* noop */ } faceRef = null; }
    } else {
      elTarget.style.display = 'none';
    }
  }

  function renderArrayList() {
    elArray.innerHTML = '';
    if (!state.editHud && (!modOn('hud') || !getS('hud', 'arraylist'))) return;
    const on = MODULES.filter((m) => modOn(m.id) && m.id !== 'hud');
    on.sort((a, b) => b.name.length - a.name.length);
    for (const m of on) elArray.append(mk('div', 'cm-arr', m.cn || m.name));
  }

  // 通知
  let notes = [];
  function pushNotification(title, desc) {
    notes.push({ title: String(title), desc: String(desc), at: performance.now() });
    if (notes.length > 5) notes.shift();
    renderNotes();
  }
  function renderNotes() {
    elNotes.innerHTML = '';
    if (!state.editHud && (!modOn('hud') || !getS('hud', 'notifications'))) return;
    for (const n of notes) {
      const box = mk('div', 'cm-note');
      box.append(mk('div', 'cm-ntitle', n.title));
      box.append(mk('div', 'cm-ndesc', n.desc));
      elNotes.append(box);
    }
  }
  const notify = pushNotification;

  function refreshHud() {
    const on = modOn('hud'), ed = state.editHud;
    elWm.style.display = (ed || (on && getS('hud', 'watermark'))) ? '' : 'none';
    elInfo.style.display = (ed || (on && getS('hud', 'info'))) ? '' : 'none';
    elArray.style.display = (ed || (on && getS('hud', 'arraylist'))) ? '' : 'none';
    elNotes.style.display = (ed || (on && getS('hud', 'notifications'))) ? '' : 'none';
    if (!(ed || (on && getS('hud', 'target')))) elTarget.style.display = 'none';
    radar.style.display = (ed || (on && getS('hud', 'radar'))) ? '' : 'none';
    compass.style.display = (ed || (on && getS('hud', 'compass'))) ? '' : 'none';
    applyHudPos();
    renderArrayList();
    renderNotes();
    updateHud();
  }

  setInterval(() => {
    if (guiOpen() && selectedModule && selectedModule.id === 'mc18') updateMc18Status();
  }, 2000);

  setInterval(() => {
    const now = performance.now();
    if (notes.length) {
      const before = notes.length;
      notes = notes.filter((n) => now - n.at < 2600);
      if (notes.length !== before) renderNotes();
    }
  }, 400);

  // 四个 HUD 更新合并到一个 250ms 定时器，少 3 个回调与 3 次重复布局
  setInterval(() => {
    try { updateHud(); } catch (e) { /* noop */ }
    try { updateInventory(); } catch (e) { /* noop */ }
    try { drawMinimap(); } catch (e) { /* noop */ }
    try { updateDrops(); } catch (e) { /* noop */ }
    try { extHud(); } catch (e) { /* noop */ }
    try { extHudC(); } catch (e) { /* noop */ }
    try { extHudD(); } catch (e) { /* noop */ }
    try { extHudE(); } catch (e) { /* noop */ }
    try { extApplyFold(); } catch (e) { /* noop */ }
    try { rpMenuTick(); } catch (e) { /* noop */ }
  }, 250);

  // ---------- 键盘 / 绑定 ----------
  function isInputTarget(t) {
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  function onKeyDown(e) {
    try {
      if (extZoomKey(e.code, true)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    } catch (err) { /* noop */ }
    if (blockPickOpen && e.code === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation();
      closeBlockPicker();
      return;
    }
    if (bindingGuiKey) {
      e.preventDefault(); e.stopImmediatePropagation();
      const pure = ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'];
      if (e.code === 'Escape') { bindingGuiKey = false; pushNotification('悬浮标签', '已取消'); refreshGui(); }
      else if (pure.indexOf(e.code) === -1) setGuiKey(e.code);
      return;
    }
    if (state.editHud && e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      setEditHud(false);
      return;
    }
    // 两套 UI 独立按键：新 UI 默认 ` / ~（Backquote）——浏览器里 RShift 常被页面或输入法吞掉
    // 主键可在「配置 → 悬浮标签 → 呼出按键」里重新绑定；RAlt 是 AltGr，不用
    if (e.code === (cfg.guiKey || 'Backquote')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) toggleFloat();
      return;
    }
    if (e.code === 'Insert' || e.code === 'ScrollLock') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) toggleClassic();
      return;
    }
    if (e.code === 'KeyM' && !isInputTarget(e.target)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) bigmapOpen();
      return;
    }
    if (bigOpen && e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      bigmapOpen(false);
      return;
    }

    if (guiOpen()) {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (bindingModule) { bindingModule = null; refreshGui(); return; }
        if (searchActive) { setSearch(false); return; }
        if (openSelect) { openSelect = null; renderSettings(); return; }
        toggleMenu(false);
        return;
      }
      if (isInputTarget(e.target)) { e.stopImmediatePropagation(); return; }
      if (e.ctrlKey && e.altKey && e.code === 'KeyR') {
        cfg.guiOffset = { x: 0, y: 0 };
        saveCfg();
        layoutPanel();
      }
      if (bindingModule) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code === 'Delete' || e.code === 'Backspace') delete cfg.binds[bindingModule.id];
        else cfg.binds[bindingModule.id] = e.code;
        saveCfg();
        const m = bindingModule;
        bindingModule = null;
        refreshGui();
        selectModule(m);
        return;
      }
      e.stopImmediatePropagation();
      return;
    }

    if (isInputTarget(e.target)) return;
    try { if (state.game && state.game.ui && state.game.ui.screen) return; } catch (err) { /* noop */ }
    if (e.ctrlKey || e.metaKey) return;
    const m = MODULES.find((x) => cfg.binds[x.id] === e.code);
    if (m && !e.repeat) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggleModule(m);
    }
  }

  W.addEventListener('keydown', onKeyDown, true);
  W.addEventListener('keyup', (e) => { try { extZoomKey(e.code, false); } catch (err) { /* noop */ } }, true);

  // ---------- 对外 API（兼容旧脚本的 __opusHud） ----------
  const api = {
    version: VERSION,
    get game() { return state.game; },
    get player() { return state.player; },
    cfg,
    modules: MODULES,
    notify: pushNotification,
    toggleMenu,
    toggleFloat,
    toggleClassic,
    addWaypoint,
    markHere,
    clearWaypoints,
    listWaypoints() { return (cfg.waypoints || []).slice(); },
    toggleBigMap: bigmapOpen,
    get hits() { return blockHits.slice(); },
    get ores() { return xrayHits.slice(); },
    get bowAim() { return bowAimState; },
    get containers() { return containerState.hits.slice(); },
    get resourcePack() {
      return { loaded: rp.loaded, patched: rp.patched, gui: rp.guiCount,
               guiApplied: rp.guiApplied, entity: rp.etexApplied, icons: rp.iconsDirty,
               coverage: rp.coverage, remember: getS('resourcepack', 'remember') !== false,
               packs: rp.packs.length, active: rp.order.length,
               enabled: rpEnabled(), glInfo: rp.glInfo };
    },
    importResourcePack: rpImport,
    clearResourcePack: rpClear,
    reapplyResourcePack: rpReupload,
    unzipResourcePack: rpUnzip,
    patchResourceGrid: rpPatchGrid,
    decodeResourcePng: rpDecode,
    openResourceMenu() { rpMenuSetOpen(true); },
    openPackScreen: rpOpenPackScreen,
    get packScreen() { return rpPackScreen(); },
    get packs() { return rp.packs.map((p) => ({ id: p.id, name: p.name, nBlock: p.nBlock,
      nItem: p.nItem, nGui: p.nGui, nEntity: p.nEntity, nEnv: p.nEnv, nFx: p.nFx })); },
    get packStats() { return rp.stats; },
    get packOrder() { return rp.order.slice(); },
    setPackEnabled: rpSetEnabled,
    importResourceFile: rpImportFile,
    importResourceFiles: (list) => rpTask(async () => { for (const f of list) await rpAddPack(f); }),
    loadBuiltinResourcePack: rpLoadBuiltin,
    loadDemoResourcePack: rpLoadBuiltin,
    reapplyResourcePack: rpReapply,
    applyGuiPack: rpApplyGui,
    guiPackKeys() { return Array.from(rp.gui.keys()); },
    buildBackup,
    parseBackup,
    applyAppearance,
    restoreAppearance,
    displayName,
    applyImported,
    setTheme,
    getTheme() { return cfg.theme; },
    setEditHud,
    resetHudPos,
    toggleHud(v) {
      cfg.states.hud = v == null ? !modOn('hud') : !!v;
      saveCfg();
      refreshHud();
      refreshGui();
    },
    setRef(g, p, label) {
      if (g) state.game = g;
      if (p) state.player = p;
      if (!hookRender()) startFallbackLoop();
      hookNightVision();
      applyGate();
      console.log('[Comet] setRef:', label || 'manual');
    },
    refresh() {
      refreshGui();
      refreshHud();
    },
    sniff(ms) {
      this.fillTextLog.length = 0;
      this._sniffing = { count: 0 };
      const self = this;
      setTimeout(() => { self._sniffing = null; console.log('[Comet] fillText 嗅探结果', self.fillTextLog); }, ms || 5000);
    },
    _sniffing: null,
    fillTextLog: [],
    _snifferInstalled: false,
  };
  W.__cometHud = api;
  W.__opusHud = api;

  // B 站 Toy 等外层页面会把游戏塞进 iframe：外层不注入，否则 HUD / ClickGUI 会出现两份
  const GAME_FRAME_RE = /opuscraft\.pages\.dev|bilibili\.com\/toy/i;
  function isWrapperPage() {
    try {
      if (W.top !== W.self) return false; // 自己就是 iframe → 这是游戏本体
      // B 站 Toy 外层页固定是「壳」，游戏在其 iframe 里；无论 iframe 何时创建都不注入
      const host = String(W.location.hostname || '');
      if (host.indexOf('bilibili.com') !== -1 && /^\/toy/i.test(String(W.location.pathname || ''))) return true;
      const frames = document.querySelectorAll('iframe');
      for (let i = 0; i < frames.length; i++) {
        if (GAME_FRAME_RE.test(String(frames[i].src || ''))) return true;
      }
    } catch (e) { /* noop */ }
    return false;
  }

  // ---------- 启动 ----------
  // ---------------- 启动开场动画 ----------------
  // 四段过渡：粒子汇聚(0~.32) -> 图案成形(.16~.5) -> 光环扩散(全程) -> 淡出(.82~1)
  // 与脚下光环共用 cmShapeRadius，图案语言一致。
  let introCanvas = null, introRAF = 0, introDone = false;
  function cmEase(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function cmIntroFinish(cv) {
    if (introDone) return;
    introDone = true;
    try { cancelAnimationFrame(introRAF); } catch (e) { /* noop */ }
    cv.classList.add('fade');
    setTimeout(() => {
      try { if (cv.parentNode) cv.remove(); } catch (e) { /* noop */ }
      if (introCanvas === cv) introCanvas = null;
    }, 620);
  }
  function playIntro() {
    try {
      if (getS('intro', 'enabled') === false || introCanvas) return;
      const cv = document.createElement('canvas');
      cv.id = '__comet_intro';
      if (getS('intro', 'skip') !== false) cv.className = 'skippable';
      // 像素预算：内部分辨率钳到约 4.2M 像素，CSS 仍 100% 铺满由浏览器拉伸。
      // 所有绘制尺寸都乘 dpr，拉伸回去后视觉大小不变，只是避免 4K+DPR2 的 33M 像素全屏填充。
      const cssW = Math.max(320, W.innerWidth || 1280);
      const cssH = Math.max(240, W.innerHeight || 720);
      const rawDpr = Math.min(W.devicePixelRatio || 1, 2);
      const dpr = Math.min(rawDpr, Math.sqrt(4200000 / (cssW * cssH)));
      const W_ = Math.max(320, Math.floor(cssW * dpr));
      const H_ = Math.max(240, Math.floor(cssH * dpr));
      cv.width = W_; cv.height = H_;
      const c = cv.getContext('2d');
      if (!c) return;
      document.documentElement.append(cv);
      introCanvas = cv; introDone = false;
      const style = String(getS('intro', 'style') || '五芒星');
      const dur = Math.max(1.2, Math.min(8, Number(getS('intro', 'duration')) || 3)) * 1000;
      const t0 = performance.now();
      const TAU = Math.PI * 2, X = W_ / 2, Y = H_ / 2;
      cv.addEventListener('click', () => cmIntroFinish(cv), { once: true });
      const frame = (now) => {
        if (introDone) return;
        const p = Math.min(1, (now - t0) / dur);
        const fadeOut = 1 - Math.max(0, (p - 0.82) / 0.18);
        // 纯黑底：进游戏第一眼是全黑，图案才被一点点组装出来
        const veil = p < 0.08 ? p / 0.08 : (p > 0.86 ? fadeOut : 1);
        // 满不透明时直接覆盖即可，省一次全屏 clearRect（4.2M 像素的写入）
        if (veil >= 0.999) c.fillStyle = '#000';
        else {
          c.clearRect(0, 0, W_, H_);
          c.fillStyle = 'rgba(0,0,0,' + (0.985 * Math.max(0, Math.min(1, veil))).toFixed(3) + ')';
        }
        c.fillRect(0, 0, W_, H_);
        const assemble = cmEase(Math.min(1, Math.max(0, (p - 0.1) / 0.55)));
        const minWH = Math.min(W_, H_), maxWH = Math.max(W_, H_);

        // 1) 粒子从四周向中心汇聚
        const gather = assemble;
        const pAlpha = ((0.25 + 0.75 * gather) * Math.max(0, 1 - Math.max(0, (p - 0.5) / 0.5))).toFixed(3);
        for (let i = 0; i < 110; i++) {
          const a = i * 2.399963;
          const dist = (0.55 + 0.45 * ((i * 37) % 100) / 100) * (1 - gather) * maxWH * 0.62;
          const px = X + Math.cos(a) * dist, py = Y + Math.sin(a) * dist;
          c.fillStyle = 'hsla(' + Math.round((i * 7 + p * 180) % 360) + ',95%,72%,' + pAlpha + ')';
          c.beginPath(); c.arc(px, py, (1.2 + 1.8 * Math.abs(Math.sin(i))) * dpr, 0, TAU); c.fill();
        }

        // 2) 主图案：一段段接起来（组装）、碎片归位、整圈持续旋转
        const grow = cmEase(Math.min(1, Math.max(0, (p - 0.1) / 0.45)));
        const R = Math.min(W_, H_) * 0.26 * grow;
        const spin = p * TAU * 1.7;
        const drawN = Math.max(2, Math.floor(240 * assemble));
        // 组装构图线：两道细同心圆，随组装淡入，像工程草图
        c.strokeStyle = 'rgba(150,180,240,' + (0.18 * assemble * fadeOut).toFixed(3) + ')';
        c.lineWidth = 1 * dpr;
        for (let k = 1; k <= 2; k++) {
          c.beginPath(); c.arc(X, Y, minWH * 0.13 * k * grow, 0, TAU); c.stroke();
        }
        // shadowBlur 是这里的性能杀手：Canvas 按路径包围盒做高斯模糊，3 层 × 每帧
        // 相当于 3 次全屏模糊，DPR2 实测吃掉约 64% 帧时间。改用「同一路径描两遍」模拟辉光。
        const settle = 1 - assemble, jScale = minWH * 0.16;
        for (let L = 0; L < 3; L++) {
          const rad = R * (1 - L * 0.16), phase = spin + L * 0.4;
          c.beginPath();
          for (let i = 0; i <= drawN; i++) {
            const a = i / 240 * TAU;
            const rr = cmShapeRadius(style, a, rad, p * 3, phase, 1);
            // 未组装到位的顶点从散开位置插值回目标点（确定性伪随机，不闪烁）
            const jx = Math.sin(i * 12.9898 + L * 7.1) * jScale;
            const jy = Math.cos(i * 78.233 + L * 3.3) * jScale;
            const px = X + Math.cos(a) * rr + settle * jx;
            const py = Y + Math.sin(a) * rr + settle * jy;
            if (i) c.lineTo(px, py); else c.moveTo(px, py);
          }
          if (assemble >= 1) c.closePath();
          const hue = Math.round((p * 220 + L * 60) % 360);
          const a0 = 0.78 * fadeOut * (1 - L * 0.22), lw = (3.2 - L * 0.7) * dpr;
          // 辉光：粗线低 alpha
          c.strokeStyle = 'hsla(' + hue + ',92%,70%,' + (a0 * 0.20).toFixed(3) + ')';
          c.lineWidth = lw + 7 * dpr; c.stroke();
          // 主线
          c.strokeStyle = 'hsla(' + hue + ',92%,70%,' + a0.toFixed(3) + ')';
          c.lineWidth = lw; c.stroke();
        }

        // 3) 三道向外扩散的光环，带相位差
        for (let k = 0; k < 3; k++) {
          const q = ((p * 1.35 - k * 0.16) % 1 + 1) % 1;
          const rr = minWH * (0.12 + q * 0.42);
          c.strokeStyle = 'rgba(150,190,255,' + (0.3 * (1 - q) * fadeOut).toFixed(3) + ')';
          c.lineWidth = 1.5 * dpr;
          c.beginPath(); c.arc(X, Y, rr, 0, TAU); c.stroke();
        }

        // 4) 中央文字：淡入 -> 停留 -> 随画面淡出
        const ta = cmEase(Math.min(1, Math.max(0, (p - 0.3) / 0.2))) * fadeOut;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = '700 ' + Math.round(30 * dpr) + 'px "Segoe UI", sans-serif';
        c.fillStyle = 'rgba(240,246,255,' + ta.toFixed(3) + ')';
        c.fillText('COMET', X, Y - 6 * dpr);
        c.font = Math.round(12 * dpr) + 'px "Segoe UI", sans-serif';
        c.fillStyle = 'rgba(190,210,245,' + (ta * 0.85).toFixed(3) + ')';
        c.fillText('OpusHUD v' + VERSION + ' · ' + style, X, Y + 20 * dpr);

        if (p < 1) introRAF = requestAnimationFrame(frame);
        else cmIntroFinish(cv);
      };
      introRAF = requestAnimationFrame(frame);
    } catch (e) { /* 开场动画失败不影响客户端启动 */ }
  }

  function boot() {
    if (isWrapperPage()) {
      try { W.removeEventListener('keydown', onKeyDown, true); } catch (e) { /* noop */ }
      console.log('[Comet] 外层页面（游戏在 iframe 内），跳过注入');
      return;
    }
    const head = document.head || document.documentElement;
    if (!styleEl.parentNode) head.appendChild(styleEl);
    if (!gui.parentNode) document.documentElement.append(gui);
    if (!hudStage.parentNode) document.documentElement.append(hudStage);
    if (!espCanvas.parentNode) document.documentElement.append(espCanvas);
    if (!radar.parentNode) document.documentElement.append(radar);
    if (!compass.parentNode) document.documentElement.append(compass);
    if (!editBar.parentNode) document.documentElement.append(editBar);
    if (!miniCanvas.parentNode) document.documentElement.append(miniCanvas);
    if (!invBox.parentNode) document.documentElement.append(invBox);
    if (!extBox.parentNode) document.documentElement.append(extBox);
    if (!helper.parentNode) document.documentElement.append(helper);
    if (!extB.graphCanvas || !extB.graphCanvas.parentNode) { try { extEnsureGraph(); } catch (e) { /* noop */ } }
    if (!bigmap.parentNode) document.documentElement.append(bigmap);
    if (!blockPick.parentNode) document.documentElement.append(blockPick);
    makeDraggable(miniCanvas, 'minmapPos', 'right', 'top', 16, 16);
    if (!musicBox.parentNode) document.documentElement.append(musicBox);
    if (!audioEl.parentNode) document.documentElement.append(audioEl);
    if (!mblurEl.parentNode) document.documentElement.append(mblurEl);
    musicBoxOpen(false);
    if (!dropBox.parentNode) document.documentElement.append(dropBox);
    updateDrops();
    if (typeof drawMinimap === 'function') drawMinimap();
    updateInventory();

    buildSidebar();
    renderModuleList();
    renderSettings();
    updateHeaderLabel();
    layoutPanel();
    applyHudPos();
    applyAppearance();
    applyTheme();
    refreshHud();

    installOriginSpoof();
    installAccountSync();
    installFreecamListeners();
    installFillTextSniffer();
    hookNightVision();
    applyGate();
    applyServer();
    if (!rpMenuBtn.parentNode) {
      try { document.documentElement.append(rpMenuBtn, rpMenu); } catch (e) { /* noop */ }
    }
    rpMenuRender();
    rpRestore().then((ok3) => { if (ok3) rpReupload(); });
    pollRef(0);

    try { playIntro(); } catch (e) { /* noop */ }
    console.log('[Comet] ClickGUI 就绪 · RShift 呼出 · 中键拖动面板 · 右键打开设置');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
