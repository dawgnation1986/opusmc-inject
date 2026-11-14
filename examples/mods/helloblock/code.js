'use strict';
// 示例：玩法侧。只在页面里跑，单人世界有效（联机房是原版）。
// 所有回调都由 SDK 包了 try/catch：出错在聊天里提示一次，游戏继续跑，
// 详细记录见 OpusMC.errors。
//
// 参数约定（按 probe/js/modapi.js 的实际实现）：
//   api.command(name, opts, fn)  -> fn(args, ctx)，ctx 有 say / x / y / z
//   api.onUseItem(key, fn)       -> fn(ev)【只有一个参数】，ev.cancel() 或 ev.cancelled = true
//   api.on(event, fn)            -> fn(ev)
OpusMC.code('helloblock', (api) => {
  let spawn = null;

  api.on('worldLoad', (ev) => {
    spawn = { x: api.player.x, y: api.player.y, z: api.player.z };
    api.toast('示例模组已加载', '输入 /hello 试试', 'helloblock_lamp');
  });

  // /hello —— 在脚边放一盏示例灯
  api.command('hello', { usage: '/hello', description: '[示例模组] 在脚边放一盏示例灯' }, (args, ctx) => {
    api.world.setBlock(Math.floor(ctx.x), Math.floor(ctx.y), Math.floor(ctx.z), 'helloblock_lamp');
    ctx.say('放好啦', '#B06BFF');
  });

  // 右键回城石：回到进世界时的位置，扣一次耐久
  api.onUseItem('helloblock_return', (ev) => {
    if (!spawn) { api.message('还没进世界', '#FF8888'); return; }
    api.player.teleport(spawn.x, spawn.y, spawn.z);
    api.player.damageHeld(1);
    api.world.sound('minecraft:item.chorus_fruit.teleport', spawn.x, spawn.y, spawn.z);
    ev.cancel();                          // SDK 的 make() 提供的取消方法
  });

  // 破坏示例灯时给 3 点经验
  api.on('blockBroken', (ev) => {
    if (ev.block !== 'helloblock_lamp') return;
    api.player.addXp(3);
  });

  // 每 600 tick（30 秒）提示一次坐标，别刷屏
  api.every(600, () => {
    if (api.player.onGround)
      api.message('坐标 ' + Math.floor(api.player.x) + ', ' + Math.floor(api.player.z), '#9AA2B8');
  });
});
