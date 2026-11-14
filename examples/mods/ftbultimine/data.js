'use strict';
// FTB Ultimine 的还原版不新增方块/物品/贴图，全部逻辑在 code.js。
// 这里只按 SDK 协议登记自己，让「模组」界面和世界检查能认出来。
// 对照源码：FTBUltiminePlayerData.updateBlocks 里的 Mods.register 等价物。
OpusMC.data('ftbultimine', {
  tab: { name: '连锁破坏' }
});
