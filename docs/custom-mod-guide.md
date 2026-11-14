# OpusMC 自定义模组开发指南（离线版 v47685）

游戏从 **v47685** 起内置模组系统。这份指南基于 `probe/js/modapi.js`（官方 SDK）和
`probe/js/mods.js`（加载器）的真实实现写成，所有 API 名都对着源码核过。

> 想直接看能跑的东西：`examples/mods/helloblock/` 是一个完整示例，
> `node examples/mods/helloblock/verify.js` 有 20 项自动校验。

---

## 1. 先搞清加载顺序

`probe/game.html` 里 `<script>` 的顺序是刻意排的，模组文件被 `document.write` 插在中间：

```
js/assets.js / font.js / texts.js / worldgen_data.js / blockdata.js / itemdata.js / recipedata.js
   ↓  原版数据准备完毕
js/modapi.js                 SDK 就位（OpusMC.data / OpusMC.code）
   ↓
js/mods_data.js  →  Mods.stage('data')
   ↓  为每个启用的模组 document.write 一个 <script src="mods/<id>/data.js">
   ↓  这里加自定义方块、物品、配方、贴图、矿石（页面 + 地形/mesh worker 都会跑）
js/blocks.js / world.js / mesher.js / models.js / render.js ...
   ↓
js/mods_code.js  →  OpusMC._finish() 然后 Mods.stage('code')
   ↓  为模组写 <script src="mods/<id>/code.js">
   ↓  这里挂事件、命令、按键（只在页面跑）
js/main.js                 启动游戏
```

**所以 `data.js` 里不能碰 DOM、不能碰 `game`** —— 它也会在 worker 里执行。
玩法逻辑一律放 `code.js`。

---

## 2. 三个文件的最小结构

```
probe/mods/<id>/
├── data.js        内容（必需）
├── code.js        玩法（可选）
└── textures/      自定义贴图（可选，16×16 PNG）
    └── xxx.png
```

再加 `probe/mods/index.json` 里的一条登记，`<id>` 才会出现在「模组」界面。

**`id` 规则**：小写字母开头，2–32 个小写字母/数字/下划线。
**所有方块/物品的 key** 必须等于 id 或以 `id_` 开头 —— `modapi.js` 会强制检查，
写错直接抛「名字要以「xxx_」开头」。

---

## 3. 编号：`OpusMC._prelude`

这是最容易卡住的地方。`OpusMC.data()` 第一件事就检查 `m.ids`：

```js
if (!m.ids) throw new Error('模组 xxx 没有经过安装（缺少编号）：运行 node tools/install_mod.js');
```

官方 SDK 用 `tools/modsdk/install_mod.js` 生成前导，但那份**没随源码发布**。
本项目补了一个等价的 `tools/install_mod.py`：

```bash
python tools/install_mod.py examples/mods/helloblock
```

它会：

1. 扫描 `data.js` 里的 `blocks` / `items` 键
2. 分配不冲突的编号（方块从 `4096` 起，原版 `BLOCK_DATA` 到 `2089`；物品从 `10000` 起）
3. 扫描 `textures/*.png`
4. 在 `data.js` 开头插入：

```js
'use strict';
// 由 tools/install_mod.py 生成，请勿手改前导
OpusMC._prelude("helloblock", {"ids":{"blocks":{"helloblock_lamp":4096}, ...}, "textures":[], ...});
```

5. 复制文件到 `probe/mods/<id>/`，登记进 `probe/mods/index.json`

**两个坑**：

- `'use strict'` 必须是脚本第一条语句才生效，安装器会自动把它提到最前。
- 重复安装不能让编号一路递增（存档靠编号识别方块）。安装器会排除本模组自己的旧编号，
  连续装三次都稳定在 4096。

改了方块/物品列表后**必须重新运行安装器**，否则新增的那个没有编号，`data()` 会抛错。

---

## 4. `data.js`：加内容

`OpusMC.data(id, def)` 支持的顶层字段（对着 `modapi.js` 的 `dataImpl`）：

| 字段 | 内容 |
|---|---|
| `blocks` | 自定义方块 |
| `items` | 自定义物品（不能与方块同名，方块自带物品） |
| `recipes` | 有序/无序/熔炼/切石配方 |
| `ores` | 矿石生成（写进 `WG_DATA`，页面和地形 worker 一致） |
| `tags` | 把物品加进原版标签（如 `planks`） |
| `tab` | 创造模式标签页 `{ name, icon }` |

方块字段：`name / texture / textures / hardness / tool / level / needsTool / light /
sound / drops / transparent / shape / xp / fuel / gravity / slipperiness / climbable`。

物品字段：`name / texture / stack / durability / tool / attack / attackSpeed / food /
armor / fuel / glint / rarity / places / repairWith / enchantability`。

贴图两种写法：

```js
texture: 'minecraft:sea_lantern'   // 借用原版贴图，零额外文件（示例用的就是这个）
texture: 'lamp'                    // 用自己 textures/lamp.png
```

自定义的会被追加到方块贴图条带（`ASSETS.tiles` / `ASSETS.extra`），
`render.js` 从下一整行开始放，页面和 mesh worker 用同一顺序，不会错位。

配方示例：

```js
recipes: [
  { type: 'shaped', result: 'mymod_lamp', pattern: ['GGG','GSG','GGG'], key: { G:'minecraft:glowstone' } },
  { type: 'shapeless', result: 'mymod_return', ingredients: ['minecraft:emerald','minecraft:ender_pearl'] },
  { type: 'smelting', input: 'minecraft:raw_iron', result: 'mymod_lamp', xp: 0.5, time: 200 },
]
```

`type` 只能是 `shaped / shapeless / smelting / blasting / smoking / campfire_cooking / stonecutting`。
有序配方 `pattern` 是 1–3 行、每行等长 1–3 字符。

---

## 5. `code.js`：加玩法

`OpusMC.code(id, fn)` 给一个 `api`。所有回调都被 SDK 包了 `try/catch`：
出错在聊天里提示一次，游戏继续跑，细节在 `OpusMC.errors` 里（最多 200 条，同错合并计数）。

### 事件（`api.on(name, fn)`）

`tick / blockBreak / blockBroken / blockPlace / use / attack / entityDeath /
playerDeath / worldLoad / hud`

事件对象字段举例：`blockBreak` 给 `{x,y,z,block,held}`；`blockBroken` 给 `{x,y,z,block}`；
`use` 给 `{held,target,entity}`；`worldLoad` 给 `{name,seed}`。
`ev.cancelled = true` 可以拦下原版行为。

### 专用注册

```js
api.onUseBlock(key, fn)     // 右键某个方块
api.onUseItem(key, fn)      // 右键某个物品，fn(ev)【只有一个参数】，ev.cancel() 拦截
api.every(ticks, fn)        // 定时（20 tick = 1 秒）
api.command(name, opts, fn) // fn(args, ctx)，ctx 有 say / x / y / z
api.key(name, label, defaultKey, down, up)   // 自定义按键
```

两个回调的签名不一样，别混：

- `api.command(name, opts, fn)` → `fn(args, ctx)`（**两个参数**），`ctx` 有 `say / x / y / z`
- `api.onUseItem(key, fn)` / `api.onUseBlock(key, fn)` → `fn(ev)`（**只有一个参数**），
  `ev` 由 SDK 的 `make()` 生成，带 `cancelled` 和 `cancel()`；拦原版行为用 `ev.cancel()`

把 `onUseItem` 写成 `(args, ctx)` 再 `ctx.cancelled = true`，浏览器里会报
`Cannot set properties of undefined (setting 'cancelled')` —— 这个坑真实踩过。

### 常用 API

| 分组 | 方法/属性 |
|---|---|
| 提示 | `api.message(text, color)` / `api.toast(title, sub, iconItem)` / `api.menu({...})` |
| `api.world` | `getBlock / getState / setBlock / isLoaded / surfaceY / time / dimension / dropItem / explode / lightning / entities / damage / particle / sound` |
| `api.player` | `x/y/z/yaw/pitch/health/food/mode/sneaking/onGround/held/target`、`teleport / setVelocity / give / take / count / damageHeld / consumeHeld / addEffect / addXp` |
| 存档 | `api.store`（每个世界一份，只存 JSON 值） |
| 底层 | `api.raw` → `{ game, BLOCKS, ITEMS, BID, ITEM_KEY }` |
| 资源 | `api.assetUrl(file)` / `api.sound(file)`（播放 `assets/` 下的音频） / `api.image(file)` |

**坐标**：`api.player.y` 和 `api.world.*` 用的是 F3 显示的原版 Y；
内部世界 Y 从 0 开始，SDK 自动做 `minY` 换算，别自己减。

**`api.game` 不存在**：要拿原始 game 用 `api.raw.game`。

---

## 6. 怎么跑起来

### 本地测试（推荐）

```bash
launch-offline.bat       # 起 localhost:8777
```

然后打开：

```
http://localhost:8777/game.html?modtest=helloblock
```

`?modtest=<id>` 是 SDK 的本地测试入口（`mods.js` 里解析）：
会自动建一个叫「模组测试」的创造世界、跳过协议页和首次引导，直接加载这些模组。
**只在 localhost / 127.0.0.1 生效**，多个 id 用逗号分隔。

### 变成内置

把 id 加进 `probe/game.html` 的：

```html
<script>self.MODS_ALWAYS = ["tconstruct", "farmersdelight", ..., "helloblock"];</script>
```

这样不用点下载，每次启动都加载（截图里那 7 个「已内置」就是这么来的）。

### 在「模组」界面里可选

装进 `probe/mods/index.json` 后就能在界面里下载/启用。
每个世界可以单独选模组（`mods.js` 的 `reloadWith`），联机房一律原版。

---

## 7. 示例模组

`examples/mods/helloblock/` 覆盖五条最常用路径：

| 功能 | 演示 |
|---|---|
| 自定义发光方块 | `helloblock_lamp`，亮度 15，借原版 `sea_lantern` 贴图 |
| 自定义物品 | `helloblock_return`，耐久 16、带附魔光 |
| 配方 | 有序 + 无序各一条 |
| 命令 | `/hello` 在脚边放灯 |
| 事件 | `worldLoad` / `blockBroken` / `every(100)` / 右键物品 |

安装与验证：

```bash
python tools/install_mod.py examples/mods/helloblock
node examples/mods/helloblock/verify.js      # 20 项全过
```

`verify.js` 用 Node 的最小 SDK stub 跑 `data.js` / `code.js`，
检查前导、编号、命名约束、配方、事件与命令注册。

---

## 8. 验证到什么程度

| 项 | 状态 |
|---|---|
| 全部 JS `node --check` | 通过 |
| 示例 `verify.js` 20 项断言 | **全过** |
| 安装器幂等（连装 3 次编号稳定） | 通过 |
| HTTP 静态服务取 `?modtest` 与模组文件 | 全部 200 |
| **无头 Chrome 里完整跑进游戏** | **未通过**：页面停在「正在生成标题画面 85%」，无头环境缺 WebGL/渲染上下文，探针脚本没能注入 |

最后一条如实说明：真实浏览器里点开 `?modtest=helloblock` 后，
灯、回城石、`/hello` 是否完全按预期工作，**还需要你在有显卡的浏览器里看一眼**。
注册链路和数据格式已经用源码级校验过，但「画面里真出现那个方块」这件事我没量到。

---

## 9. 内置模组是怎么写的（想深入时看）

`probe/mods/` 下 7 个内置模组**没有用 SDK**，它们直接改全局数据，可以当进阶参考：

| 模组 | 看什么 |
|---|---|
| `nightvision` | 最小的纯玩法模组：2 个文件、无数据，只 hook `nightVisionScale` 和 shader uniform |
| `veinminer` | 12KB 的破坏连锁，看 `blockBreak` 类 hook |
| `dynlights` | 移动光源，看逐帧光照更新 |
| `tconstruct` | 完整大型模组：`data.js` 4.3MB（自建方块/物品/配方）、`bundle.js` 3.2MB（打包脚本）、自定义 GUI 和创造标签页 |
| `tcdemo` / `fddemo` | 隐藏教程地图，看 `Mods.register` 与 seed 绑定 |

`mods.js` 顶部那段注释把整个机制（按世界加载、sessionStorage 重载、单人限定）写得很清楚，
值得先读一遍。

---

## 10. 坑清单

1. `data.js` 在 worker 里也跑 —— 不碰 `window` / `document` / `game`。
2. 少了 `_prelude` 会直接抛「没有经过安装」，手写 `data.js` 不生效。
3. `'use strict'` 要在第一行；安装器已处理。
4. 改了方块/物品列表要重装，且必须保证编号稳定，否则旧存档的方块会变。
5. key 命名必须 `id` 或 `id_` 前缀，只用小写字母数字下划线。
6. `api.command` 是 `(args, ctx)` 两参，`api.onUseItem` / `onUseBlock` 是 `(ev)` 单参，别混。
7. 没有 `api.game`，用 `api.raw.game`。
8. 联机房永远原版，`live()` 会挡掉所有模组回调。
9. `mods/index.json` 里 `farmersdelight/LICENSE.txt` 是线上自身 404，不是缺文件。
10. Windows 下生成文件清单用二进制写 `\n`，否则路径尾巴带 `\r` 全 404。
