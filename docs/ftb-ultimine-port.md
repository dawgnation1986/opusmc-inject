# FTB Ultimine —— 源码获取与 OpusMC 还原

## 结论先说

**完整源码拿到了，不需要反编译，也不需要猜算法。**

`https://github.com/FTBTeam/FTB-Ultimine` 的 git 通道可用（GitHub REST API 被共享出口 IP 限流，
但 `git clone` 走的是另一个端点，不受影响）。仓库 21 个分支、3.8MB，含 2026-11-12 的最新提交
`19d67c1 (dev, 26.1.2.8)`，还有一条专门给 MC 26.3 的 `feature/26.3` 分支。

按源码逐段还原出一个可运行的 OpusMC 模组 `ftbultimine`，**已在真实浏览器里验证 hook 挂载成功、
SDK 零报错**（详见「验证」一节）。全程产物都在 D 盘，没往 C 盘写任何东西。

---

## 1. 源码归档位置

```
refs/
├── FTB-Ultimine/                 完整 git 仓库（--no-checkout，21 个远端分支，3.8MB）
├── ftb-ultimine-dev/             dev 分支导出（最新，26.1.2.8）← 还原依据
├── ftb-ultimine-main/            main 分支导出
├── ftb-ultimine-feature-26.3/   26.3 移植分支导出
└── ftb-ultimine-1.21.1-main/    1.21.1 稳定版导出
```

四个分支的源码都已用 `git archive | tar` 导出成普通目录，不依赖 git 就能读。
`.gitignore` 里 `refs/` 不入库（上游源码，体积 6.3MB，随时可重新 clone）。

主要分支时间线：

| 分支 | 最近提交 | 说明 |
|---|---|---|
| `dev` | 2026-11-12 `19d67c1` | 最新，26.1.2.8，**本次还原依据** |
| `main` | 2026-11-05 `bb4f0a0` | 合并 dev |
| `feature/26.3` | 2026-09-21 `0daaa10` | "finish 26.3 port" |
| `1.21.1/main` | 2026-11-06 `e2b75c6` | 稳定版 |
| `1.16/main` | 老版本 | 历史 |

---

## 2. 算法拆解（全部对着源码逐行核对）

### 2.1 核心：26 邻域泛洪（`shape/ShapelessShape.java`）

```java
// 3x3x3 去掉中心 = 26 个邻居
for (int x=-1..1) for (int y=-1..1) for (int z=-1..1)
    if (x!=0||y!=0||z!=0) NEIGHBOR_POSITIONS.add(new BlockPos(x,y,z));

// 作物：5x5 同层平面（24 个）+ 正上/正下（2 个），按距中心距离排序
for (int x=-2..2) for (int z=-2..2) if (x!=0||z!=0) ... add(new BlockPos(x,0,z));
add(0,1,0); add(0,-1,0);
NEIGHBOR_POSITIONS_PLANT.sort(Comparator.comparingDouble(o -> o.distSqr(BlockPos.ZERO)));

// walk：显式栈 DFS，命中才扩展邻居，命中数达 maxBlocks 立即返回
while (!openSet.isEmpty()) {
    BlockPos ptr = openSet.pop();
    if (context.check(ptr) && known.add(ptr)) {
        if (known.size() >= context.maxBlocks()) return;
        for (BlockPos side : cropLike ? PLANT : NORMAL) if (traversed.add(offset)) openSet.add(offset);
    }
}
// 返回前按离起始点的距离排序（EntityDistanceComparator），近的先破坏
```

**还原要点**：`traversed` 在入队时就标记（不是出队时），`known` 只收真正匹配的方块；
不匹配的方块**不会继续向外扩展**（所以矿脉被空气隔开就断）。这两点最容易写错。

### 2.2 六种形状（`FTBUltimine.registerBuiltinShapes`）

| 顺序 | id | 源码 | 几何 |
|---|---|---|---|
| 0 | `shapeless` | `ShapelessShape` | 26 邻域泛洪，**默认 + indeterminate** |
| 1 | `small_tunnel` | `SmallTunnelShape` | 沿命中面反方向逐格，遇不匹配即停 |
| 2 | `small_square` | `SmallSquareShape extends LargeTunnelShape` | 3×3 单层（`maxDepth()=1`） |
| 3 | `large_tunnel` | `LargeTunnelShape` | 3×3 逐层推进，整层都不匹配才停 |
| 4 | `mining_tunnel` | `MiningTunnelShape extends DiagonalTunnelShape` | 水平沿面 + 每格 Y−1 |
| 5 | `escape_tunnel` | `EscapeTunnelShape` | 水平沿面 + 每格 Y+1 |

`LargeTunnelShape` 按命中面的**轴**决定 3×3 铺在哪两个分量上（X 轴铺 Y/Z，Y 轴铺 X/Z，Z 轴铺 X/Y），
每层结束后 `basePos = basePos.relative(face.getOpposite())`。

`DiagonalTunnelShape` 在命中面是竖直轴（上/下面）时改用玩家朝向，网页版用 `player.yaw` 近似。

### 2.3 匹配器（`shape/BlockMatchers.java`）

| 匹配器 | 行为 |
|---|---|
| `MATCH_BY_BLOCK` | 同一种方块 |
| `MATCH_BY_TAGS_SHAPELESS` | 默认标签 `minecraft:base_stone_overworld` / `c:ores/*` / `forge:ores/*` 内算同类 |
| `MATCH_BY_TAGS_SHAPED` | 默认标签 `*`，**任意方块**都算匹配（3×3 隧道因此能挖穿不同方块） |
| `MATCH_BY_CROP_TYPE` | 同种成熟作物 |

`determineBestMatcher` 的顺序：先试 tagMatcher（indeterminate 用 shapeless 组，否则 shaped 组），
**原点自身能匹配标签就用它**；否则是作物用 CROP；否则退回 MATCH_BY_BLOCK。

网页版没有原版 tag registry，用 key 模式还原：
- `base_stone_overworld` → `stone|andesite|diorite|granite|tuff|deepslate|calcite|...`
- 矿石 → `*_ore` / `ancient_debris`，含 `deepslate_` 前缀归一
- 原木 → `_(log|wood|stem|hyphae)` 按树种归一

### 2.4 状态机（`FTBUltiminePlayerData.java`）

```
pressed（按住 Ultimine 键）
  -> playerTick 里 checkBlocks：raycast 到方块，位置或命中面变了才 updateBlocks
  -> updateBlocks：determineBestMatcher -> shape.getBlocks -> 缓存 cachedBlocks
  -> SendShapePacket 发给客户端画预览
  -> 破坏时 handleBlockBreak：clearCache + 重新 updateBlocks + breakBlocksInShape
```

`checkBlocks` 的缓存键是 `(cachedPos, cachedDirection)` —— 朝向不变、方块不变就不重算，
这是每帧不卡的关键。还原版在 `drawSelection` 里用同样的键做缓存。

### 2.5 破坏执行（`FTBUltimine.breakBlocksInShape`）

逐条还原的检查：

1. **快照**：先把选中位置的方块记下来，破坏过程中被连带移除/替换（多方块结构、连锁掉落）就跳过
2. **硬度**：`destroySpeed <= baseSpeed` 才挖；但 shapeless 命中合并标签时豁免
   （这样铁矿 + 深板岩铁矿硬度不同也能一起挖，同时防止「挖石头顺带挖掉旁边的黑曜石」）
3. **工具**：每块检查 `isValidTool`，工具空了/快坏了就停
4. **饥饿**：每块 `causeFoodExhaustion(exhaustionPerBlock * 0.005)`，默认 20.0 → 每块 0.1 点 exhaustion
5. **经验**：`experiencePerBlock > 0` 时按 `(blocksMined - 1)` 累计扣
6. **掉落归集**：`DropsAccumulator` 把整批掉落收起来，最后统一落在起始方块处
7. **冷却**：非创造模式记 `lastUltimineTime`

### 2.6 预览轮廓（`utils/ShapeMerger.java` + `client/FTBUltimineClient.renderInGame`）

FTB 用 `ShapeMerger`（源自 Chisels & Bits 的 AABBCompressor）把相邻方块合并成少数大 AABB，
然后画这些盒子的边。客户端分两层：
- 外边缘实线白色 `setLineWidth(2f)` + `RenderTypes.LINES`
- 隐藏边半透明 `alpha = PREVIEW_LINE_ALPHA (默认 45)` + `LINES_NO_DEPTH_TRANSLUCENT`

还原版用等价做法：**邻居不在选中集合的面才画**（内部共享面不画），视觉结果与合并盒子一致，
省掉一遍 AABB 合并。同样分两层绘制。

### 2.7 默认配置（逐项抄自 `config/*Config.java`）

| 配置 | 默认 | 出处 |
|---|---|---|
| `max_blocks` | 64 | ServerConfig.COSTS_LIMITS |
| `exhaustion_per_block` | 20.0 | 同上 |
| `experience_per_block` | 0.0 | 同上 |
| `require_tool` | false | 同上 |
| `require_valid_tool_for_block` | false | 同上 |
| `ultimine_cooldown` | 0 | 同上 |
| `merge_tags` (shapeless) | 石头/矿石三组 | ServerConfig.MISC |
| `merge_tags_shaped` | `*` | 同上 |
| `prevent_tool_break` | 0 | 同上 |
| `cancel_on_block_break_fail` | false | 同上 |
| `single_crop_harvesting` | true | ServerConfig.FEATURES |
| `render_outline` | 256 | ClientConfig.RENDERING |
| `preview_line_alpha` | 45 | 同上 |
| `require_ultimine_key_for_cycling` | true | ClientConfig.GENERAL |
| `shape_feedback_hotbar_message` | false | 同上 |

---

## 3. 还原版模组

```
examples/mods/ftbultimine/      源码（可编辑）
├── mod.json                    元数据
├── data.js                     登记（不新增方块/物品，逻辑全在 code.js）
├── code.js                     ~500 行，逐段标注对应的 FTB 源码类
└── verify.js                   64 项算法断言
probe/mods/ftbultimine/         安装后的副本（install_mod.py 生成 _prelude 前导）
```

### 与 FTB 原版的差异（网页版能力所限，都写进代码注释了）

| 项 | FTB | 还原版 |
|---|---|---|
| 触发键 | Ultimine 键（默认 `KEY_GRAVE` 反引号，按住） | 同为 `Backquote` 按住，走游戏 `bindDown`；↑↓ / 滚轮切形状 |
| 标签系统 | 原版 `TagKey<Block>` 动态匹配 | key 模式近似（石头/矿石/原木） |
| 作物邻域 | `CropLikeRegistry` 可扩展 | 内置作物 key 表 + `Features.propOf(id,meta,'age')` |
| 轮廓 | AABB 合并 | 暴露面直接画，视觉等价 |
| 右键处理 | `RightClickDispatcher`（剥皮/锄地/耕地/收割） | 只实现作物成熟判定与匹配，**未做右键批量收割** |
| 联机 | 服务端权威 + 网络包 | 仅单人（`g.net` 时全部跳过） |
| 权限 | FTB Ranks / 实体属性覆盖 | 无 |
| 信息面板 | `addPressedInfo()` 左上 overlay | 已还原：激活状态/原因、形状菜单、采掘方块数、按键提示，用 zh_cn 原版文案与配色 |

### 与 OpusMC 内置 `veinminer` 的关系

内置的 `probe/mods/veinminer/code.js` 是 FTB 思路的**简化自研版**：
同样 26 邻域泛洪、MAX=64、矿石/原木/作物分组、逐块耗工具与饥饿、白线预览，
但它是「Backquote 开关 + 只挖特定类别」，没有 6 种形状、没有标签合并、没有按住预览。

**与内置 veinminer 的按键冲突**：内置 `veinminer` 是 `MODS_ALWAYS`（必加载），也占
`Backquote` 做开关。还原版启动时把它的默认键挪到 `KeyV`（同时改 `KEY_DEFAULT.veinmine`
和 `KEYBIND_CATS` 里那一项），让 FTB 还原版独占反引号；用户手动改过 `keys.veinmine` 则不动。
两者都 hook `breakBlock`，但 FTB 版在最外层且不再让位，按住时由它接管。


### 一个真实踩过的坑（hook 顺序）

`js/mobile.js`、`tconstruct/bundle.js`、`farmersdelight/bundle.js`、`veinminer/code.js`
都在包 `Game.prototype.breakBlock`，而且 `mobile.js` 在 `mods_code.js` **之后**才加载。
如果模组在 code 阶段就挂 hook，会被后面加载的脚本盖在里层 ——
功能仍生效，但 `String(Game.prototype.breakBlock)` 看不到自己的标记，容易误判「hook 没挂上」，
也可能被别的整体赋值覆盖。

另外 `js/minigame.js` 在 `mods_code.js` 之后又包了一层 `UI.prototype.drawHUD`，会盖住信息面板 hook。

**解决**：`breakBlock` / `drawSelection` / `drawHUD` 三个 hook 统一延到
`DOMContentLoaded` 由 `installAllHooks()` 一起装，保证都在最外层。

---


## 3.1 第一版为什么「没框 / 没连锁 / 没面板」（用户实测反馈）

第一版只验了「hook 挂上了」，没验「按住键之后会发生什么」，三个症状全中。
回头看根因其实是**一个**：自己用 `window.addEventListener` 维护 `state.pressed`，
而用户是在**游戏按键设置**里改的键，两边对不上 → `pressed` 永远 false。

| # | 症状 | 根因 |
|---|---|---|
| 1 | 按住键没白框 | 默认键设成 `AltLeft`（浏览器抢 Alt 菜单）+ 自定义按键监听读不到用户的绑定 |
| 2 | 连锁没用 | 同上；另外破坏 hook 里写了「内置 veinminer 开着就让位」，用户按过 Backquote 把内置开关打开后，还原版永远不接管 |
| 3 | 左边没信息 | `addPressedInfo` 面板第一版**根本没做** |

修法（全部对着源码/游戏实现）：

1. **按键改用游戏自己的 `bindDown(g, name)`**：`main.js` 维护 `g.keys[code]`，
   `controls.js:37` 的 `bindDown` 查它 —— 用户在「选项 → 按键控制」里设什么键都自动生效。
   删掉整套自定义 keydown 监听。
2. **默认键改 `Backquote`** 对齐 FTB 原版 `KEY_GRAVE`；内置 veinminer 默认键挪到 `KeyV` 解冲突。
3. **删掉让位逻辑**，FTB 版在最外层直接接管。
4. **补左上信息面板**，逐行照 `FTBUltimineClient.addPressedInfo()`，
   文案取 `assets/ftbultimine/lang/zh_cn.json`，配色 `#A3BE8C / #BF616A / #BFBF6C`。
5. `controls.js` 顶层只遍历一次 `KEYBIND_CATS` 填 `KEY_DEFAULT`/`KEY_CN`，
   模组在 `mods_code.js` 阶段才 push，必须自己补，否则按键设置里不显示、`bindDown` 也读不到。

> 教训：验证「hook 存在」和验证「功能可用」是两件事。后来改成在浏览器里
> 模拟 `g.keys.Backquote = true` + 造一片相连方块，直接量 `drawLines` 调用次数和
> 批量清空数，才真正把三个症状都覆盖到。

## 4. 验证结果

| 项 | 结果 |
|---|---|
| FTB 仓库 clone（21 分支） | 成功，3.8MB |
| 四分支源码导出 | 成功 |
| `node --check`（data/code/verify） | 通过 |
| `verify.js` 断言 | **64 项全过**（含按键改键、held 状态、信息面板、三 hook 延迟挂载） |
| 真实浏览器 `?modtest=ftbultimine` | 游戏加载完成、模组注册、`OpusMC.errors` 空、**三个 hook 全在最外层**、`KEY_DEFAULT.ultimineHold = Backquote`、`Mods.active = ["ftbultimine"]` |
| **按住键 → 白色轮廓** | **已量到**：浏览器里 `g.keys.Backquote=true` 后调 `drawSelection`，`renderer.drawLines` 调用 **3 次**（原版选块 1 + 隐藏边 1 + 外缘实线 1） |
| **按住键 → 批量破坏** | **已量到**：造 5 格相连方块调 `breakBlock`，一次清掉 **4 格**（剩 1 格是测试桩方块表不完整导致的硬度检查） |
| 手工看画面 | 仍未做：无头环境看不到屏幕，需你在浏览器里确认视觉效果 |

`verify.js` 覆盖：配置默认值、6 形状、26/作物邻域、三种匹配器、标签合并、
泛洪连通性与上限、按距离排序、形状几何与中断条件、轮廓合并、状态机循环、延迟挂载。

### 怎么自己试

```bash
launch-offline.bat        # 起 localhost:8777
```

打开 `http://localhost:8777/game.html?modtest=ftbultimine`，
**先按 Backquote 关掉内置连锁挖矿**（若它开着），然后：

- 按住 **反引号 ` / ~** + 准星指向矿脉 → 左上出现信息面板、方块出现白色外轮廓
- 保持按住并左键破坏 → 整片同类方块一起掉
- 按住时滚滚轮或按 ↑↓ → 在 6 种形状间切换（按 Shift 展开形状菜单上下文）
- 按键可在「选项 → 按键控制 → FTB连锁破坏」里改，改完自动生效

---

## 5. 所有产物都在 D 盘

```
D:\discuz\webmc\hook\opusmc-inject\
├── refs\                    FTB 上游源码（6.3MB）
├── examples\mods\ftbultimine\   还原版源码
├── probe\mods\ftbultimine\      安装副本
└── docs\ftb-ultimine-port.md    本文档
```

没有下载 Modrinth/CurseForge 的 jar（GitHub 已有完整源码，无需反编译），
没有启用 Gradle，没有任何缓存或临时产物写到 C 盘。
