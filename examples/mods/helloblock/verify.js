/* 无浏览器验证：用最小 stub 跑一遍 data.js / code.js，检查注册链路。
   用法：node examples/mods/helloblock/verify.js  */
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = __dirname;
const installed = path.join(dir, '..', '..', '..', 'probe', 'mods', 'helloblock');

let pass = 0, fail = 0;
const ok = (c, l, x) => { console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); c ? pass++ : fail++; };

// ---- 最小 SDK stub ----
const calls = { data: null, code: null, events: [], eventFns: {}, commands: [], useItems: [], timers: [] };
const ctx = {
  OpusMC: {
    _prelude(id, p) { ctx.__prelude = { id, p }; },
    data(id, def) { calls.data = { id, def }; },
    code(id, fn) {
      calls.code = { id, fn };
      const api = {
        id,
        on: (n, f) => {
          calls.events.push(n);
          (calls.eventFns[n] || (calls.eventFns[n] = [])).push(f);
          return api;
        },
        every: (t, f) => { calls.timers.push(t); return api; },
        onUseItem: (k, f) => {
          calls.useItems.push(k);
          // 复刻 modapi.js 的 guard(f.mod, ..., f.fn, ev)：只传一个参数，
          // ev 由 make() 生成，带 cancelled / cancel()。真的调一次，签名写错当场暴露。
          calls.useItemCb = f;
          return api;
        },
        command: (n, o, f) => { calls.commands.push(n); return api; },
        toast: () => {}, message: () => {},
        world: { setBlock() {}, sound() {} },
        player: {
          x: 1, y: 64, z: 2, onGround: true,
          teleport() { calls.teleported = true; },
          damageHeld() { calls.damaged = true; },
          addXp(n) { calls.xp = n; },
        },
        raw: { game: {} },
      };
      fn(api);
    },
  },
  BLOCK_DATA: [], ITEM_DATA: [], RECIPE_DATA: { crafting: [], cooking: [], stonecutting: [], tags: {} },
  MOD_VMODELS: [], Mods: { register: (id, info) => { ctx.__registered = { id, info }; } },
  CREATIVE_TABS: [], ITEM_KEY: {}, BID: {},
  models: { models: [], items: {} },
  console, setTimeout, clearTimeout,
};
// modapi.js 里 data() 依赖的全局
ctx.models = { models: [], items: {} };
vm.createContext(ctx);

const dataSrc = fs.readFileSync(path.join(installed, 'data.js'), 'utf8');
const codeSrc = fs.readFileSync(path.join(installed, 'code.js'), 'utf8');

// ---- data.js ----
let e1 = null;
try { vm.runInContext(dataSrc, ctx, { filename: 'data.js' }); } catch (e) { e1 = e; }
ok(!e1, 'data.js 执行无异常', e1 && e1.message);
ok(!!ctx.__prelude && ctx.__prelude.id === 'helloblock', '_prelude 前导正确', ctx.__prelude && ctx.__prelude.id);
ok(ctx.__prelude.p.ids.blocks.helloblock_lamp >= 4096, '方块编号已分配', ctx.__prelude.p.ids.blocks.helloblock_lamp);
ok(ctx.__prelude.p.ids.items.helloblock_return >= 10000, '物品编号已分配', ctx.__prelude.p.ids.items.helloblock_return);
ok(!!calls.data && calls.data.id === 'helloblock', 'OpusMC.data 被调用');
const def = calls.data && calls.data.def;
ok(!!(def && def.blocks.helloblock_lamp), '定义了示例灯');
ok(def.blocks.helloblock_lamp.light === 15, '示例灯亮度 15');
ok(!!(def && def.items.helloblock_return), '定义了回城石');
ok(Array.isArray(def.recipes) && def.recipes.length === 2, '两条配方', def.recipes.length);
ok(def.recipes[0].type === 'shaped' && def.recipes[0].pattern.length === 3, '有序配方格式正确');
// SDK 命名约束
ok(Object.keys(def.blocks).every(k => k === 'helloblock' || k.startsWith('helloblock_')), '方块 key 符合命名约束');
ok(Object.keys(def.items).every(k => k === 'helloblock' || k.startsWith('helloblock_')), '物品 key 符合命名约束');

// ---- code.js ----
calls.events.length = 0; calls.commands.length = 0; calls.useItems.length = 0;
let e2 = null;
try { vm.runInContext(codeSrc, ctx, { filename: 'code.js' }); } catch (e) { e2 = e; }
ok(!e2, 'code.js 执行无异常', e2 && e2.message);
ok(!!calls.code && calls.code.id === 'helloblock', 'OpusMC.code 被调用');
ok(calls.commands.includes('hello'), '注册了 /hello 命令');
ok(calls.useItems.includes('helloblock_return'), '注册了回城石右键');
ok(calls.events.includes('worldLoad'), '监听 worldLoad');
ok(calls.events.includes('blockBroken'), '监听 blockBroken');
ok(calls.timers.includes(600), '注册了 600 tick 定时器（30 秒，不刷屏）');

// 触发 blockBroken 回调（事件列表里最后一个是它）
ok(typeof calls.code.fn === 'function', 'code 回调是函数');

// ---- 先按游戏顺序触发 worldLoad（设置 spawn），再触发右键 ----
(calls.eventFns.worldLoad || []).forEach(f => f({ name: 'test', seed: 1 }));

// ---- 真的触发一次右键回调（复刻 SDK 的 make(ev)）----
let ev = { cancelled: false, cancel() { this.cancelled = true; } };
let useErr = null;
try { calls.useItemCb(ev); } catch (e) { useErr = e; }
ok(!useErr, '右键回城石回调执行无异常', useErr && useErr.message);
ok(ev.cancelled === true, '回调正确调用了 ev.cancel()（不再写 undefined.cancelled）');
ok(calls.teleported === true, '回城石触发了传送');
ok(calls.damaged === true, '回城石扣了耐久');

console.log('---');
console.log(fail === 0 ? `ALL PASS (${pass})` : `${fail} FAILED / ${pass}`);
process.exitCode = fail ? 1 : 0;
