// ==UserScript==
// @name         OpusMC 生存辅助（彗星 Comet 客户端）
// @namespace    https://github.com/bigpixel
// @version      1.3.3
// @description  网页版 MC 运行时注入：还原彗星客户端（Comet Client）的 ClickGUI —— 400x250 双栏面板、分类侧栏、搜索、模块设置面板、收藏 / 键位绑定，以及彗星式 HUD（Watermark / Info / TargetHud / ArrayList / 通知）。界面提供两套主题：默认（深色）与液态玻璃（Apple Liquid Glass 风格的半透明磨砂 + 高光边缘）。功能：Aura（可自选攻击生物）、TriggerBot、刀刀暴击、AutoSprint、AutoRespawn、ESP、Tracers、Nametags、ItemESP、TargetESP、FullBright、Ambience、飞行（双击空格）/ 加速 / 自动跳跃、快速破坏 / 瞬间破坏 / 自动进食 / 水下呼吸、雷达、罗盘。适配 OpusMC / OpusCraft / 本地离线版。
// @author       BigPixel
// @match        https://opuscraft.pages.dev/*
// @match        https://www.bilibilitoy.com/*
// @match        https://www.bilibili.com/toy/*
// @match        http://localhost:8777/*
// @match        *://*/game.html*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      honghemc.cn
// ==/UserScript==

(function () {
  'use strict';

  // Tampermonkey 沙箱里的 window 是代理，必须拿页面真身才能摸到游戏挂的全局对象
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // 同一页面被重复注入（脚本装了两份 / 多层 match）时只保留第一份
  if (W.__cometInstalled) {
    console.log('[Comet] 本页面已有实例，跳过重复注入');
    return;
  }
  W.__cometInstalled = true;

  const VERSION = '1.3.3';
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

  const state = { game: null, player: null, flavor: '', mpSeen: false };

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
    if (n === 'ItemEntity') return '#ffd54f';
    if (n === 'ExperienceOrb') return '#69f0ae';
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
      id: 'esp', name: 'ESP', cn: '生物ESP', cat: 'render', desc: '生物 3D 线框',
      settings: [
        { id: 'distance', name: 'Distance', cn: '距离', type: 'slider', min: 8, max: 128, step: 4, value: 64 },
      ],
    },
    {
      id: 'tracers', name: 'Tracers', cn: '追踪线', cat: 'render', desc: '从准星指向实体的追踪线',
    },
    {
      id: 'nametags', name: 'Nametags', cn: '名字标签', cat: 'render', desc: '实体名字与血条', state: true,
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
        { id: 'radar', name: 'Radar', cn: '雷达', type: 'checkbox', value: false, desc: '俯视实体雷达' },
        { id: 'compass', name: 'Compass', cn: '罗盘', type: 'checkbox', value: false, desc: '方位罗盘' },
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
      id: 'cfgreset', name: 'ConfigReset', cn: '配置重置', cat: 'configs', desc: '重置或导出本地配置',
      settings: [
        { id: 'reset', name: 'Reset Config', cn: '重置配置', type: 'button' },
        { id: 'export', name: 'Export Config', cn: '导出配置', type: 'button' },
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

  function getS(mid, sid) {
    const k = mid + '.' + sid;
    if (cfg.settings[k] !== undefined) return cfg.settings[k];
    const m = MODS_BY_ID[mid];
    const d = m && m.settings && m.settings.find((s) => s.id === sid);
    if (!d) return undefined;
    return typeof d.value === 'function' ? d.value() : d.value;
  }
  function setS(mid, sid, v) {
    cfg.settings[mid + '.' + sid] = v;
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
        const out = hookedOrig.call(this, a, now);
        try { onFrame(a); } catch (e) { /* noop */ }
        return out;
      };
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
    p.yaw = Math.atan2(-dx, dz);
    const dy = (tp[1] + 0.9) - (pp[1] + 1.62);
    p.pitch = -Math.atan2(dy, Math.hypot(dx, dz));
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

    if (modOn('nofall')) p.fallDist = 0;

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
    if (!g || !p) return;
    if (g.state && g.state !== 'play') return;

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
    if (modOn('triggerbot')) tickTrigger(g);
    if (modOn('targetesp') && getS('hud', 'target') !== false) { /* TargetESP 绘制在 ESP 里 */ }

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
  compass.width = 600; compass.height = 48;
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
    if (name === 'Player') return COLORS.player;
    if (HOSTILE.has(name)) return COLORS.hostile;
    return COLORS.passive;
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

  function espFrame() {
    const g = state.game, p = state.player;
    const showEsp = modOn('esp'), showTracers = modOn('tracers');
    const showItems = modOn('itemesp'), showTarget = modOn('targetesp');
    const hudOn = modOn('hud');
    const showRadar = hudOn && !!getS('hud', 'radar');
    const showCompass = hudOn && !!getS('hud', 'compass');
    const anyOn = showEsp || showTracers || showItems || showTarget || showRadar || showCompass;
    if (!g || !p) return;
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
    const maxD2 = Math.pow(getS('esp', 'distance') ?? 64, 2);
    let ents;
    try { ents = g.entities; } catch (e) { return; }
    if (Array.isArray(ents)) {
      for (const e of ents) {
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

          const color = isMob ? colorOf(e) : kind;
          const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

          if (showTracers && isMob) {
            ectx.strokeStyle = (HOSTILE.has(e.constructor && e.constructor.name) || (e.T && e.T.hostile))
              ? COLORS.line : 'rgba(79,195,247,0.5)';
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

          if (modOn('nametags') && (isMob || showItems)) {
            const label = `${cnName(e)}  ${Math.hypot(dx, dy, dz).toFixed(0)}m`;
            ectx.textAlign = 'center';
            if (isMob) {
              ectx.font = 'bold 14px "Microsoft YaHei", sans-serif';
              const hp = Math.min(1, Math.max(0, e.health / e.maxHealth));
              const barW = Math.max(46, maxX - minX), barH = 5;
              const barX = cx - barW / 2, barY = minY - 12;
              ectx.fillStyle = COLORS.hpBg;
              ectx.fillRect(barX, barY, barW, barH);
              ectx.fillStyle = COLORS.hpFill;
              ectx.fillRect(barX, barY, barW * hp, barH);
              ectx.lineWidth = 3;
              ectx.strokeStyle = 'rgba(0,0,0,0.85)';
              ectx.strokeText(label, cx, barY - 5);
              ectx.fillStyle = COLORS.text;
              ectx.fillText(label, cx, barY - 5);
            } else {
              ectx.font = 'bold 12px "Microsoft YaHei", sans-serif';
              ectx.lineWidth = 3;
              ectx.strokeStyle = 'rgba(0,0,0,0.85)';
              ectx.strokeText(label, cx, minY - 3);
              ectx.fillStyle = color;
              ectx.fillText(label, cx, minY - 3);
            }
            ectx.textAlign = 'start';
            ectx.lineWidth = 1;
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

    drawRadar(showRadar);
    drawCompass(showCompass);
  }

  function drawRadar(on) {
    const size = 120;
    const c = rctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, radar.width, radar.height);
    if (!on) return;
    c.setTransform(2, 0, 0, 2, 0, 0);
    const g = state.game, p = state.player;
    if (!g || !p) return;
    const cx = size / 2, cy = size / 2, R = size / 2 - 3;
    const cam = (g.renderer && g.renderer.camPos) || targetPos(p);
    if (!cam) return;
    const yaw = yawRad(num(p, 'yaw'));
    const fx = -Math.sin(yaw), fz = Math.cos(yaw);
    const rx = -fz, rz = fx;
    const scale = R / Math.max(8, (getS('esp', 'distance') ?? 64) * 0.5);
    const px = (dx, dz) => cx + (dx * rx + dz * rz) * scale;
    const py = (dx, dz) => cy - (dx * fx + dz * fz) * scale;

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
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(cx, cy - 5); c.lineTo(cx - 3.5, cy + 4); c.lineTo(cx + 3.5, cy + 4);
    c.closePath(); c.fill();
  }

  function drawCompass(on) {
    const w = 300, h = 24, c = cctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, compass.width, compass.height);
    if (!on) return;
    c.setTransform(2, 0, 0, 2, 0, 0);
    const p = state.player;
    if (!p) return;
    const deg = yawDeg(num(p, 'yaw')) ?? 0;
    const pxPerDeg = 12;
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
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let a = 0; a < 360; a += 15) {
      const diff = ((a - deg + 180) % 360 + 360) % 360 - 180;
      const x = w / 2 + diff * pxPerDeg;
      if (x < 6 || x > w - 6) continue;
      const big = a % 90 === 0;
      c.strokeStyle = big ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.28)';
      c.beginPath();
      c.moveTo(x, h - (big ? 14 : 9)); c.lineTo(x, h - 4);
      c.stroke();
      if (big) {
        c.fillStyle = 'rgba(255,255,255,0.95)';
        c.font = 'bold 13px "Microsoft YaHei", sans-serif';
        c.fillText({ 0: '南', 90: '西', 180: '北', 270: '东' }[a], x, 9);
      }
    }
    c.fillStyle = '#ffffff';
    c.fillRect(w / 2 - 1, h - 15, 2, 11);
  }

  // ---------- 帧驱动 ----------
  function onFrame(alpha) {
    espFrame.alpha = alpha;
    try { tickModules(); } catch (e) { /* noop */ }
    try { espFrame(); } catch (e) { /* noop */ }
  }

  let fallbackStarted = false;
  function startFallbackLoop() {
    if (fallbackStarted) return;
    fallbackStarted = true;
    const loop = () => { try { onFrame(null); } catch (e) { /* noop */ } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // ---------- 样式（彗星灰阶主题） ----------
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
    #__comet_gui.open .cm-dim { opacity: 1; }
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
    #__comet_gui.open #__comet_panel { opacity: 1; transform: translateY(0); }
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
      position: fixed; left: 50%; top: 8px; width: 300px; height: 24px; margin-left: -150px;
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

  let selectedCat = 'combat';
  let selectedModule = null;
  let openSelect = null;
  let bindingModule = null;
  let searchActive = false;
  let settingsTitle = null;
  let settingsDesc = null;

  function guiOpen() { return gui.classList.contains('open'); }

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
    gui.classList.toggle('glass', glass);
    try { hudStage.classList.toggle('glass', glass); } catch (e) { /* noop */ }
    for (const el of themeOpts) el.classList.toggle('on', el.dataset.theme === cfg.theme);
  }
  function setTheme(id) {
    cfg.theme = id === 'glass' ? 'glass' : 'default';
    saveCfg();
    applyTheme();
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
    if (m.settings && m.settings.length) {
      row.append(mk('span', 'cm-gear', selectedModule === m ? '⚙' : '···'));
    }

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
      if (ev.button === 2) { selectModule(m); return; }
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

  function renderModuleList() {
    const keep = modScroll.scrollTop;
    modScroll.innerHTML = '';
    const mods = MODULES.filter((m) => m.cat === selectedCat)
      .slice()
      .sort((a, b) => (!!cfg.favorites[b.id] - !!cfg.favorites[a.id]) || a.name.localeCompare(b.name));
    for (const m of mods) modScroll.append(makeModuleRow(m));
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

  // ---------- 打开 / 关闭 ----------
  function setGuiOpen(open, immediate) {
    if (open) {
      gui.classList.remove('closing');
      gui.classList.add('visible');
      layoutPanel();
      buildSidebar();
      renderModuleList();
      renderSettings();
      updateHeaderLabel();
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* noop */ }
      try { if (state.game && state.game.releasePointer) state.game.releasePointer(); } catch (e) { /* noop */ }
      void gui.offsetWidth;
      gui.classList.add('open');
      document.documentElement.classList.add('cm-gui-open');
    } else {
      gui.classList.remove('open');
      gui.classList.add('closing');
      document.documentElement.classList.remove('cm-gui-open');
      setSearch(false);
      bindingModule = null;
      openSelect = null;
      const done = () => {
        if (!guiOpen()) {
          gui.classList.remove('visible');
          gui.classList.remove('closing');
        }
      };
      if (immediate) done(); else setTimeout(done, 240);
    }
  }

  function toggleMenu(force) {
    const show = force != null ? force : !guiOpen();
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
    return { checkbox: '⊞', slider: '≡', select: '⌄', text: '✎', button: '' }[type] || '';
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
    content.style.height = y + 'px';
    scroll.append(content);
    setsPane.append(scroll);
    scroll.scrollTop = settingsScrollTop;
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

  function runAction(m, s) {
    if (m.id === 'server' && s.id === 'apply') {
      applyServer();
      notify('服务器切换', (cfg.servers[cfg.serverIdx] || {}).name || '已应用');
    }
    if (m.id === 'mc18' && s.id === 'toggle') toggleMc18();
    if (m.id === 'cfgreset' && s.id === 'reset') resetConfig();
    if (m.id === 'cfgreset' && s.id === 'export') exportConfig();
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
    for (const m of MODULES) cfg.states[m.id] = !!m.state;
    saveCfg();
    refreshGui();
    refreshHud();
    notify('配置重置', '配置已重置');
  }

  function exportConfig() {
    try {
      const json = JSON.stringify({ states: cfg.states, settings: cfg.settings, binds: cfg.binds }, null, 2);
      navigator.clipboard.writeText(json);
      notify('配置重置', '配置已复制到剪贴板');
    } catch (e) {
      notify('配置重置', '导出失败');
    }
  }

  // ---------- HUD（彗星式界面元素） ----------
  const hudStage = document.createElement('div');
  hudStage.id = '__comet_hudstage';
  hudStage.innerHTML = `
    <div class="cm-hud cm-wm" id="__c_wm">
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
    <div class="cm-hud cm-info" id="__c_info">
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
    <div class="cm-target" id="__c_target">
      <div class="cm-tface">☺</div>
      <div class="cm-tname" id="__c_tname">Target</div>
      <div class="cm-thp" id="__c_thp">20.0</div>
      <div class="cm-tbar"><div class="cm-tfill" id="__c_tfill"></div></div>
    </div>
    <div class="cm-array" id="__c_array"></div>
    <div class="cm-notes" id="__c_notes"></div>
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
  }

  function bindHudDrag(el, key) {
    el.addEventListener('mousedown', (ev) => {
      if (!guiOpen() || ev.button !== 0) return;
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
  bindHudDrag(elWm, 'watermark');
  bindHudDrag(elInfo, 'info');
  bindHudDrag(elTarget, 'target');

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

  function updateHud() {
    const hudOn = modOn('hud');
    if (!hudOn) return;

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
    const showT = !!getS('hud', 'target');
    if (tgt && showT) {
      elTarget.style.display = '';
      let name = cnName(tgt);
      try { if (tgt.type === 'player' && tgt.name) name = tgt.name; } catch (e) { /* noop */ }
      elTName.textContent = name;
      const hp = num(tgt, 'health') ?? 0;
      const maxHp = num(tgt, 'maxHealth') ?? 20;
      elTHp.textContent = hp.toFixed(1);
      elTFill.style.width = Math.min(100, Math.max(0, (hp / maxHp) * 100)) + '%';
    } else {
      elTarget.style.display = 'none';
    }
  }

  function renderArrayList() {
    elArray.innerHTML = '';
    if (!modOn('hud') || !getS('hud', 'arraylist')) return;
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
    if (!modOn('hud') || !getS('hud', 'notifications')) return;
    for (const n of notes) {
      const box = mk('div', 'cm-note');
      box.append(mk('div', 'cm-ntitle', n.title));
      box.append(mk('div', 'cm-ndesc', n.desc));
      elNotes.append(box);
    }
  }
  const notify = pushNotification;

  function refreshHud() {
    const on = modOn('hud');
    elWm.style.display = (on && getS('hud', 'watermark')) ? '' : 'none';
    elInfo.style.display = (on && getS('hud', 'info')) ? '' : 'none';
    elArray.style.display = (on && getS('hud', 'arraylist')) ? '' : 'none';
    elNotes.style.display = (on && getS('hud', 'notifications')) ? '' : 'none';
    if (!(on && getS('hud', 'target'))) elTarget.style.display = 'none';
    radar.style.display = (on && getS('hud', 'radar')) ? '' : 'none';
    compass.style.display = (on && getS('hud', 'compass')) ? '' : 'none';
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

  setInterval(() => { try { updateHud(); } catch (e) { /* noop */ } }, 250);

  // ---------- 键盘 / 绑定 ----------
  function isInputTarget(t) {
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  function onKeyDown(e) {
    // 彗星默认 RShift；Insert 作为备用键（部分键盘/输入法吞掉右 Shift）
    if (e.code === 'ShiftRight' || e.code === 'Insert') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) toggleMenu();
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

  // ---------- 对外 API（兼容旧脚本的 __opusHud） ----------
  const api = {
    version: VERSION,
    get game() { return state.game; },
    get player() { return state.player; },
    cfg,
    modules: MODULES,
    notify: pushNotification,
    toggleMenu,
    setTheme,
    getTheme() { return cfg.theme; },
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

    buildSidebar();
    renderModuleList();
    renderSettings();
    updateHeaderLabel();
    layoutPanel();
    applyHudPos();
    applyTheme();
    refreshHud();

    installOriginSpoof();
    installAccountSync();
    installFillTextSniffer();
    hookNightVision();
    applyGate();
    applyServer();
    pollRef(0);

    console.log('[Comet] ClickGUI 就绪 · RShift 呼出 · 中键拖动面板 · 右键打开设置');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
