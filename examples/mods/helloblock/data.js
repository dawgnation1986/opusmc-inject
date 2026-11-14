'use strict';
// 示例：内容侧。这一段在原版数据文件之后、blocks.js 之前跑，
// 页面和地形/mesh worker 都会执行，所以这里只能「加数据」，不能碰 DOM、不能碰 game。
//
// 命名规则（modapi.js 会强制检查）：所有方块/物品的 key 必须等于模组 id，
// 或以「id_」开头，只用小写字母、数字、下划线。
OpusMC.data('helloblock', {
  tab: { name: '示例模组' },

  blocks: {
    helloblock_lamp: {
      name: '示例灯',
      texture: 'minecraft:sea_lantern',   // 借用原版贴图，省掉 textures/*.png
      hardness: 1.2,
      tool: 'pickaxe',
      level: 1,
      light: 15,                          // 自发光
      sound: 'glass',
      drops: 'helloblock_lamp'
    }
  },

  items: {
    helloblock_return: {
      name: '回城石',
      texture: 'minecraft:emerald',
      stack: 1,
      durability: 16,
      glint: true
    }
  },

  recipes: [
    {
      type: 'shaped',
      result: 'helloblock_lamp',
      pattern: ['GGG', 'GSG', 'GGG'],
      key: { G: 'minecraft:glowstone', S: 'minecraft:sea_lantern' }
    },
    {
      type: 'shapeless',
      result: 'helloblock_return',
      ingredients: ['minecraft:emerald', 'minecraft:ender_pearl']
    }
  ]
});
