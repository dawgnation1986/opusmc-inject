# 参数速查表：从 JS 源码自动抽取的全部设置项

> 这张表是给 Java 侧建 `Config` POJO 用的。每行对应源码 `MODULES` 数组里的一个设置项，
> 默认值 / 范围 / 步长都是从 `opusmc-hud.user.js` 里读出来的，不是手填的。
> 生成时间：2026-11-11T20:06:30

按模块分组，`type` 到 Java / Cloth Config 的控件映射见 `07-config-and-modules.md`。
带 `*` 的是复用了 id 的旧字段或分组标题，按源码原样保留。

## 模块总览

| 模块 id | 中文名 | 分类 | 设置项数 |
| --- | --- | --- | ---: |
| `aura` | 光环 | `combat` | 6 |
| `multiaura` | 千手观音 | `combat` | 3 |
| `triggerbot` | 触发机器人 | `combat` | 2 |
| `bowaim` | 弓箭辅助 | `combat` | 7 |
| `crit` | 刀刀暴击 | `combat` | 0 |
| `autosprint` | 自动疾跑 | `movement` | 1 |
| `fly` | 飞行 | `movement` | 0 |
| `autojump` | 自动跳跃 | `movement` | 0 |
| `speed` | 加速 | `movement` | 1 |
| `step` | 自动上台阶 | `movement` | 0 |
| `scaffold` | 自动搭路 | `movement` | 1 |
| `nofall` | 免摔伤 | `movement` | 0 |
| `autorespawn` | 自动重生 | `player` | 0 |
| `fastbreak` | 快速破坏 | `player` | 1 |
| `instantbreak` | 瞬间破坏 | `player` | 0 |
| `autoeat` | 自动进食 | `player` | 1 |
| `waterbreath` | 水下呼吸 | `player` | 0 |
| `freecam` | 灵魂出窍 | `player` | 2 |
| `esp` | 生物ESP | `render` | 1 |
| `tracers` | 追踪线 | `render` | 0 |
| `projectile` | 投掷物抛物线 | `render` | 5 |
| `nametags` | 名字标签 | `render` | 7 |
| `itemesp` | 物品ESP | `render` | 0 |
| `targetesp` | 目标ESP | `render` | 0 |
| `fullbright` | 全亮 | `render` | 0 |
| `nightvision` | 夜视 | `render` | 0 |
| `ambience` | 环境 | `render` | 3 |
| `hud` | HUD | `render` | 7 |
| `appearance` | 外观设置 | `configs` | 10 |
| `perf` | 性能优化 | `configs` | 1 |
| `xray` | 矿透 | `render` | 5 |
| `blockesp` | 方块追踪 | `render` | 8 |
| `trail` | 移动轨迹 | `render` | 4 |
| `targetring` | 目标光环 | `render` | 4 |
| `waypoints` | 路径点 | `render` | 5 |
| `minimap` | 小地图 | `render` | 8 |
| `invhud` | 背包信息 | `render` | 5 |
| `drops` | 掉落物汇总 | `render` | 5 |
| `music` | 音乐播放器 | `misc` | 9 |
| `mblur` | 视角运动模糊 | `render` | 2 |
| `spin` | 模型自转 | `misc` | 2 |
| `containeresp` | 容器 ESP | `render` | 30 |
| `resourcepack` | MC 材质包 | `configs` | 8 |
| `server` | 服务器切换 | `misc` | 2 |
| `gate` | 跳过登录门槛 | `misc` | 0 |
| `mc18` | MC18 连接 | `misc` | 3 |
| `hudedit` | HUD 编辑 | `configs` | 2 |
| `cfgreset` | 配置备份 | `configs` | 3 |
| `intro` | 启动开场动画 | `configs` | 4 |
| `floatgui` | 悬浮标签 | `configs` | 2 |

共 **50** 个模块、**170** 个设置项。

## `aura` — 光环（combat）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `range` | 范围 | `slider` | `4.5` | 2 ~ 6 / 步长 0.1 | — | — |
| `strength` | 强度 | `slider` | `0.9` | 0.3 ~ 1 / 步长 0.05 | — | — |
| `players` | 玩家 | `checkbox` | `true` | — | — | 默认目标包含玩家 |
| `targets` | 攻击生物 | `multi` | `[]` | — | [ '玩家', '僵尸', '骷髅', '苦力怕', '蜘蛛', '末影人', '女巫', '史莱姆', '烈焰人', '恶魂', '… | 留空 = 默认（敌对生物 + 玩家） |
| `rotate` | 旋转 | `checkbox` | `false` | — | — | 攻击时朝向目标 |
| `ring` | 脚下范围圈 | `checkbox` | `true` | — | — | 在脚底画与攻击半径等大的光环，代表光环已开启 |

## `multiaura` — 千手观音（combat）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `range` | 范围 | `slider` | `4.5` | 2 ~ 6 / 步长 0.1 | — | — |
| `strength` | 强度 | `slider` | `0.9` | 0.3 ~ 1 / 步长 0.05 | — | — |
| `max` | 最多目标 | `slider` | `3` | 1 ~ 8 / 步长 1 | — | — |

## `triggerbot` — 触发机器人（combat）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `range` | 范围 | `slider` | `3.5` | 1.5 ~ 6 / 步长 0.1 | — | — |
| `strength` | 强度 | `slider` | `0.9` | 0.3 ~ 1 / 步长 0.05 | — | — |

## `bowaim` — 弓箭辅助（combat）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `range` | 范围 | `slider` | `40` | 8 ~ 96 / 步长 2 | — | — |
| `rotate` | 锁定视角 | `checkbox` | `true` | — | — | 关闭后只显示弹道，不强行转动视角 |
| `lead` | 移动目标预判 | `checkbox` | `true` | — | — | 按目标速度算提前量，打移动中的生物 |
| `smooth` | 转视角平滑 | `slider` | `0.35` | 0 ~ 0.9 / 步长 0.05 | — | — |
| `zero` | 弹道校准 | `slider` | `0.2` | -0.5 ~ 0.8 / 步长 0.05 | — | 落点偏低就调高，偏高就调低 |
| `auto` | 自动射击 | `checkbox` | `true` | — | — | 拉满后自动松手 |
| `players` | 包含玩家 | `checkbox` | `true` | — | — | — |

## `crit` — 刀刀暴击（combat）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |

## `autosprint` — 自动疾跑（movement）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `onlyforward` | 仅前进 | `checkbox` | `true` | — | — | 仅前进时疾跑 |

## `fly` — 飞行（movement）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |

## `autojump` — 自动跳跃（movement）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |

## `speed` — 加速（movement）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `mult` | 倍率 | `slider` | `1.5` | 1 ~ 2.5 / 步长 0.1 | — | — |

## `step` — 自动上台阶（movement）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |

## `scaffold` — 自动搭路（movement）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `ahead` | 铺前方 | `checkbox` | `true` | — | — | 铺在前进方向；关闭则只铺脚下 |

## `nofall` — 免摔伤（movement）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |

## `autorespawn` — 自动重生（player）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |

## `fastbreak` — 快速破坏（player）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `mult` | 速度倍率 | `slider` | `8` | 2 ~ 20 / 步长 1 | — | — |

## `instantbreak` — 瞬间破坏（player）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |

## `autoeat` — 自动进食（player）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `threshold` | 触发饥饿值 | `slider` | `16` | 6 ~ 19 / 步长 1 | — | — |

## `waterbreath` — 水下呼吸（player）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |

## `freecam` — 灵魂出窍（player）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `speed` | 速度 | `slider` | `1.5` | 0.5 ~ 4 / 步长 0.1 | — | — |
| `body` | 冻结身体 | `checkbox` | `true` | — | — | 出窍时身体不受移动输入影响 |

## `esp` — 生物ESP（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `distance` | 距离 | `slider` | `64` | 8 ~ 128 / 步长 4 | — | — |

## `tracers` — 追踪线（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |

## `projectile` — 投掷物抛物线（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `held` | 手持预览 | `checkbox` | `true` | — | — | — |
| `flight` | 飞行轨迹 | `checkbox` | `true` | — | — | — |
| `land` | 落点标记 | `checkbox` | `true` | — | — | — |
| `style` | 轨迹样式 | `select` | `光带` | — | ['光带', '细线', '光点', '关闭'] | — |
| `color` | 轨迹颜色 | `color` | `` | — | — | 留空 = 弓黄 / 投掷物蓝 |

## `nametags` — 名字标签（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `held` | 手持物品 | `checkbox` | `true` | — | — | — |
| `armor` | 装备栏 | `checkbox` | `true` | — | — | — |
| `compact` | 紧凑排版 | `checkbox` | `true` | — | — | — |
| `scale` | 字号 | `slider` | `1.1` | 0.8 ~ 1.8 / 步长 0.1 | — | — |
| `color` | 名字颜色 | `color` | `` | — | — | 留空 = 白色 |
| `format` | 显示内容 | `select` | `名称+距离` | — | ['名称+距离', '仅名称', '名称+血量', '名称+距离+血量'] | — |
| `alias` | 自定义别名 | `text` | `` | — | — | — |

## `itemesp` — 物品ESP（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |

## `targetesp` — 目标ESP（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |

## `fullbright` — 全亮（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |

## `nightvision` — 夜视（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |

## `ambience` — 环境（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `freeze` | 锁定时间 | `checkbox` | `true` | — | — | 锁定时间 |
| `time` | 时间 | `slider` | `6000` | 0 ~ 24000 / 步长 500 | — | — |
| `weather` | 天气 | `select` | `晴朗` | — | ['晴朗', '下雨'] | — |

## `hud` — HUD（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `watermark` | 水印 | `checkbox` | `true` | — | — | 左上角水印 |
| `info` | 坐标信息 | `checkbox` | `true` | — | — | 坐标 / 速度 |
| `target` | 目标HUD | `checkbox` | `true` | — | — | 目标血条 |
| `arraylist` | 模块列表 | `checkbox` | `true` | — | — | 启用模块列表 |
| `notifications` | 通知 | `checkbox` | `true` | — | — | 开关提示 |
| `radar` | 雷达 | `checkbox` | `true` | — | — | 俯视实体雷达（正北朝上） |
| `compass` | 罗盘 | `checkbox` | `true` | — | — | 方位罗盘（几点方向 + 经纬度） |

## `appearance` — 外观设置（configs）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `group` | 模块列表按子分类分组 | `checkbox` | `true` | — | — | — |
| `preset` | 外观档位 | `select` | `绚丽` | — | ['绚丽', '平缓', '基本', '自定义'] | — |
| `accent` | 主题色 | `color` | `` | — | — | 留空 = 彗星紫 |
| `glow` | 辉光强度 | `slider` | `14` | 0 ~ 24 / 步长 1 | — | — |
| `blur` | 玻璃模糊 | `slider` | `18` | 0 ~ 30 / 步长 1 | — | — |
| `radius` | 圆角 | `slider` | `14` | 0 ~ 22 / 步长 1 | — | — |
| `anim` | 动画速度 | `slider` | `1.3` | 0 ~ 2 / 步长 0.1 | — | — |
| `saturate` | 饱和度 | `slider` | `1.5` | 0.5 ~ 2 / 步长 0.1 | — | — |
| `bg` | 面板底色 | `color` | `` | — | — | 留空 = 深色 |
| `border` | 边框亮度 | `slider` | `0.75` | 0 ~ 1 / 步长 0.05 | — | — |

## `perf` — 性能优化（configs）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `level` | 性能档位 | `select` | `自动` | — | ['自动', '省电', '均衡', '绚丽'] | — |

## `xray` — 矿透（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `mode` | 透视模式 | `select` | `材质透视` | — | ['材质透视', '框选'] | — |
| `distance` | 扫描半径 | `slider` | `48` | 16 ~ 128 / 步长 8 | — | — |
| `limit` | 最多显示 | `slider` | `200` | 40 ~ 600 / 步长 20 | — | — |
| `through` | 穿墙显示 | `checkbox` | `true` | — | — | — |
| `labels` | 矿石名字 | `checkbox` | `true` | — | — | — |

## `blockesp` — 方块追踪（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `target` | 目标方块 | `text` | `diamond_ore` | — | — | — |
| `browse` | 浏览方块… | `button` | `` | — | — | — |
| `radius` | 扫描半径 | `slider` | `48` | 16 ~ 128 / 步长 8 | — | — |
| `limit` | 最多显示 | `slider` | `120` | 20 ~ 400 / 步长 20 | — | — |
| `color` | 框颜色 | `color` | `` | — | — | 留空 = 金色 |
| `width` | 线宽 | `slider` | `2` | 1 ~ 6 / 步长 0.5 | — | — |
| `crosshair` | 准星方块框 | `checkbox` | `true` | — | — | — |
| `edge` | 屏外箭头 | `checkbox` | `true` | — | — | — |

## `trail` — 移动轨迹（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `color` | 轨迹颜色 | `color` | `` | — | — | 留空 = 薄荷绿 |
| `length` | 轨迹长度 | `slider` | `60` | 10 ~ 160 / 步长 10 | — | — |
| `width` | 线宽 | `slider` | `2` | 1 ~ 6 / 步长 0.5 | — | — |
| `glow` | 脚下光点 | `checkbox` | `true` | — | — | — |

## `targetring` — 目标光环（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `color` | 光环颜色 | `color` | `` | — | — | 留空 = 珊瑚红 |
| `size` | 圈半径 | `slider` | `0.9` | 0.4 ~ 2.5 / 步长 0.1 | — | — |
| `speed` | 旋转速度 | `slider` | `1` | 0.2 ~ 3 / 步长 0.1 | — | — |
| `beam` | 上升光柱 | `checkbox` | `true` | — | — | — |

## `waypoints` — 路径点（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `add` | 标记当前坐标 | `button` | `` | — | — | — |
| `clear` | 清空路径点 | `button` | `` | — | — | — |
| `beacon` | 世界光柱 | `checkbox` | `true` | — | — | — |
| `edge` | 屏外箭头 | `checkbox` | `true` | — | — | — |
| `distance` | 显示距离 | `slider` | `256` | 32 ~ 512 / 步长 16 | — | — |

## `minimap` — 小地图（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `size` | 尺寸 | `slider` | `180` | 120 ~ 320 / 步长 10 | — | — |
| `zoom` | 视野半径 | `slider` | `48` | 16 ~ 128 / 步长 8 | — | — |
| `terrain` | 地形着色 | `checkbox` | `true` | — | — | — |
| `entities` | 实体点 | `checkbox` | `true` | — | — | — |
| `labels` | 路径点名字 | `checkbox` | `true` | — | — | — |
| `open` | 打开大地图 (M) | `button` | `` | — | — | — |
| `editpos` | 编辑位置 | `button` | `` | — | — | — |
| `resetpos` | 重置位置 | `button` | `` | — | — | — |

## `invhud` — 背包信息（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `full` | 显示完整背包 | `checkbox` | `false` | — | — | — |
| `names` | 显示物品名 | `checkbox` | `true` | — | — | — |
| `scale` | 面板缩放 | `slider` | `1` | 0.8 ~ 1.6 / 步长 0.1 | — | — |
| `editpos` | 编辑位置 | `button` | `` | — | — | — |
| `resetpos` | 重置位置 | `button` | `` | — | — | — |

## `drops` — 掉落物汇总（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `range` | 统计半径 | `slider` | `32` | 8 ~ 64 / 步长 4 | — | — |
| `max` | 最多条目 | `slider` | `10` | 4 ~ 20 / 步长 1 | — | — |
| `xp` | 包含经验球 | `checkbox` | `true` | — | — | — |
| `editpos` | 编辑位置 | `button` | `` | — | — | — |
| `resetpos` | 重置位置 | `button` | `` | — | — | — |

## `music` — 音乐播放器（misc）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `source` | 首选音源 | `select` | `GD·netease` | — | ['GD·netease', 'GD·kuwo', 'GD·kugou', 'GD·tencent', 'GD·joox', 'GD·… | — |
| `br` | 音质 | `select` | `320` | — | ['128', '192', '320', '740', '999'] | — |
| `multi` | 聚合多源搜索 | `checkbox` | `true` | — | — | 一次查多个音源并合并去重，曲库最全；结果标注来源 |
| `cors` | 频谱优先模式 | `checkbox` | `false` | — | — | 开启后要求音源给 CORS（可能播不了）；关闭则保证能播，律动走兜底 |
| `open` | 打开播放器 | `button` | `` | — | — | — |
| `volume` | 音量 | `slider` | `70` | 0 ~ 100 / 步长 5 | — | — |
| `sens` | 律动灵敏度 | `slider` | `1.2` | 0.3 ~ 3 / 步长 0.1 | — | — |
| `editpos` | 编辑位置 | `button` | `` | — | — | — |
| `resetpos` | 重置位置 | `button` | `` | — | — | — |

## `mblur` — 视角运动模糊（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `strength` | 模糊强度 | `slider` | `5` | 0 ~ 8 / 步长 0.5 | — | — |
| `decay` | 余韵 | `slider` | `0.1` | 0.05 ~ 0.4 / 步长 0.05 | — | — |

## `spin` — 模型自转（misc）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `speed` | 转速 | `slider` | `3` | 0.1 ~ 20 / 步长 0.5 | — | — |
| `reverse` | 反向旋转 | `checkbox` | `false` | — | — | — |

## `containeresp` — 容器 ESP（render）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `range` | 扫描半径 | `slider` | `40` | 8 ~ 96 / 步长 4 | — | — |
| `width` | 框线宽 | `slider` | `1.6` | 1 ~ 5 / 步长 0.5 | — | — |
| `tracer` | 显示追踪线 | `checkbox` | `true` | — | — | — |
| `labels` | 显示名称 | `checkbox` | `true` | — | — | — |
| `f_chest` | 箱子·框色 | `color` | `#ffc857` | — | — | — |
| `t_chest` | 箱子·线色 | `color` | `#ffc857` | — | — | — |
| `f_copper` | 铜箱·框色 | `color` | `#e08a5b` | — | — | — |
| `t_copper` | 铜箱·线色 | `color` | `#e08a5b` | — | — | — |
| `f_ender` | 末影箱·框色 | `color` | `#b06bff` | — | — | — |
| `t_ender` | 末影箱·线色 | `color` | `#b06bff` | — | — | — |
| `f_barrel` | 木桶·框色 | `color` | `#c98a4b` | — | — | — |
| `t_barrel` | 木桶·线色 | `color` | `#c98a4b` | — | — | — |
| `f_furnace` | 熔炉·框色 | `color` | `#8c94a3` | — | — | — |
| `t_furnace` | 熔炉·线色 | `color` | `#8c94a3` | — | — | — |
| `f_blast` | 高炉·框色 | `color` | `#5fd8ff` | — | — | — |
| `t_blast` | 高炉·线色 | `color` | `#5fd8ff` | — | — | — |
| `f_smoker` | 烟熏炉·框色 | `color` | `#a8e06a` | — | — | — |
| `t_smoker` | 烟熏炉·线色 | `color` | `#a8e06a` | — | — | — |
| `f_dispenser` | 发射器·框色 | `color` | `#ff9a5b` | — | — | — |
| `t_dispenser` | 发射器·线色 | `color` | `#ff9a5b` | — | — | — |
| `f_dropper` | 投放器·框色 | `color` | `#ff7bc0` | — | — | — |
| `t_dropper` | 投放器·线色 | `color` | `#ff7bc0` | — | — | — |
| `f_hopper` | 漏斗·框色 | `color` | `#4fe8e0` | — | — | — |
| `t_hopper` | 漏斗·线色 | `color` | `#4fe8e0` | — | — | — |
| `f_shulker` | 潜影盒·框色 | `color` | `#c07bff` | — | — | — |
| `t_shulker` | 潜影盒·线色 | `color` | `#c07bff` | — | — | — |
| `f_utility` | 工作站·框色 | `color` | `#6ee7a5` | — | — | — |
| `t_utility` | 工作站·线色 | `color` | `#6ee7a5` | — | — | — |
| `f_other` | 其它容器·框色 | `color` | `#e8ecf4` | — | — | — |
| `t_other` | 其它容器·线色 | `color` | `#e8ecf4` | — | — | — |

## `resourcepack` — MC 材质包（configs）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `enabled` | 启用材质包 | `checkbox` | `true` | — | — | — |
| `open` | 打开原版资源包界面 | `button` | `` | — | — | 用游戏自己的菜单绘制：左右双列表、箭头、优先级排序、可叠加多个包 |
| `import` | 导入 .zip | `button` | `` | — | — | — |
| `reapply` | 重新应用 | `button` | `` | — | — | — |
| `clear` | 清除材质包 | `button` | `` | — | — | — |
| `demo` | 内置暗色 GUI 包 | `button` | `` | — | — | 41KB / 56 张，精选自 MandalasGUI+Dakmode；会真的改物品栏、菜单按钮、血条与菜单底纹 |
| `status` | 状态 | `text` | `未导入` | — | — | — |
| `anims` | 包含动画贴图首帧 | `checkbox` | `true` | — | — | 水 / 岩浆等竖条多帧图只取第一帧 |

## `server` — 服务器切换（misc）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `server` | 服务器 | `select` | `` | — | () => (cfg.servers || []).map((s) => s.name) | — |
| `apply` | 应用服务器 | `button` | `` | — | — | — |

## `gate` — 跳过登录门槛（misc）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |

## `mc18` — MC18 连接（misc）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `addr` | 地址 | `text` | `() => cfg.mcAddr` | — | — | — |
| `name` | 名字 | `text` | `() => cfg.mcName` | — | — | — |
| `toggle` | 连接 / 断开 | `button` | `` | — | — | — |

## `hudedit` — HUD 编辑（configs）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `edit` | 编辑位置 | `button` | `` | — | — | — |
| `resetpos` | 重置位置 | `button` | `` | — | — | — |

## `cfgreset` — 配置备份（configs）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `export` | 导出备份 (.opuscfg) | `button` | `` | — | — | — |
| `import` | 导入备份 | `button` | `` | — | — | — |
| `reset` | 重置配置 | `button` | `` | — | — | — |

## `intro` — 启动开场动画（configs）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `enabled` | 启用开场动画 | `checkbox` | `true` | — | — | — |
| `style` | 动画样式 | `select` | `五芒星` | — | ['五芒星', '六芒星', '花瓣', '齿轮', '三角阵', '星轨', '极光'] | — |
| `duration` | 时长（秒） | `slider` | `3` | 1.5 ~ 6 / 步长 0.5 | — | — |
| `skip` | 点击画面可跳过 | `checkbox` | `true` | — | — | — |

## `floatgui` — 悬浮标签（configs）

| 设置 id | 名称 | 类型 | 默认值 | 范围 / 步长 | 选项 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `hotkey` | 呼出按键 | `button` | `` | — | — | — |
| `reset` | 重置面板位置 | `button` | `` | — | — | — |

## 光环特效专用参数（源码 `drawAuraRing` 的读取点）

这几个值不在 MODULES 里写死，而是 `gs(id, default)` 读的，Java 侧同样要有兜底默认值：

| 读取键 | 默认 | 含义 |
| --- | --- | --- |
| `range` | 4.5 | 光环半径（格） |
| `ringColor` | `#b06bff` | 基础色 / 彩虹起始色相 |
| `ringMode` | `极光` | 17 种动效（见 `02-aura-ring.md`） |
| `ringSpeed` | 1 | 动画时间倍率 |
| `ringWidth` | 2.5 | 线宽 |
| `ringLayers` | 2 | 圈层数 1~4 |
| `ringGlow` | 14 | 辉光强度 |
| `ringFill` | 12 | 填充强度（百分比） |
| `ringRainbow` | true | 彩虹渐变 |
| `ringParticles` | true | 环绕粒子 |
| `fxBars` | true | 环形频谱柱 |
| `fxBlur` | 3 | 动态模糊（px） |
| `fxTrail` | 55 | 拖影长度（百分比） |

## 外观预设（`APPEARANCE_PRESETS`，源码约 1878 行）

8 个键：`accent / glow / blur / radius / anim / saturate / bg / border`。
Java 侧建议做成 `AppearancePreset` 枚举，切换时整体写回 Config 并刷新渲染。
具体每档数值与毛玻璃 shader 参数见 `04-glass-ui.md`。

## 性能分级（`perfLevel` / `perfFx` / `perfGlow`）

| 档位 | `perfFx()` 系数 | 粒子数 | 辉光 |
| --- | ---: | ---: | --- |
| 省电 | 0.4 | 3 | 关 |
| 均衡 | 0.7 | 8 | 关 |
| 绚丽 | `fxQuality`（默认 1） | 8 | 开 |

Java 侧用 `FxQuality` 枚举，所有粒子数量、采样点数 N、模糊半径都乘这个系数。

## 开场动画参数（`intro` 模块）

| 键 | 默认 | 范围 |
| --- | --- | --- |
| `enabled` | true | bool |
| `style` | `五芒星` | 7 种 |
| `duration` | 3 | 1.5 ~ 6 / 0.5 |
| `skip` | true | bool |

时间轴、缓动公式与逐段组装算法见 `03-boot-intro.md`。

---

复现：`python tools/gen_param_cheatsheet.py`（生成脚本随文档一起保留）。
