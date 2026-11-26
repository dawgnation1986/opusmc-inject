# 传送石碑 Waystones（网页版移植）

把 [Waystones](https://github.com/TwelveIterations/Waystones)（1.20.1 分支）搬进 OpusMC。
模型、贴图、配方、文案都直接来自仓库，逻辑按 `WaystoneBlock` / `NameGenerator` /
`WaystoneSelectionMenu` / `WarpStoneItem` / `WarpScrollItem` / `ReturnScrollItem` 翻译成 JavaScript。

版本 `1.0.0` · 方块编号 4113–4117 · 物品编号 10015–10017

## 内容

| 类型 | 内容 |
|---|---|
| 方块 | 传送石碑、传送石碑（苔石）、传送石碑（砂岩）、传送石碑（黑石）、传送石碑（深板岩），每种一个方块、模型两格高（0..32） |
| 物品 | 传送石、传送卷轴、返回卷轴 |
| 配方 | 传送石 1 条 + 五种石碑各 1 条 + 两种卷轴各 1 条，共 8 条，照抄 `data/waystones/recipes` |

## 玩法（对应原版）

- **第一次右键**：登记进已激活名单。原版 `PlayerWaystoneManager.activateWaystone` 会调用
  `NameGenerator` 给石碑起名，这里照 `MrPorkNameGenerator` 的三段音节表生成（如 `Lukzermur`），
  重名时缀罗马数字（` II`、`III`…，`NameGenerator.resolveDuplicate`）。
  同时播 `entity.player.levelup`（0.2 音量）、在 y+3 / y+4 各喷 32 颗附魔粒子。
  然后打开「传送石碑设置」：名称栏已经填好，直接「保持此名称」或「换一个名字」。
- **已激活后再右键**：打开「选择目的地：」界面，列出所有已激活石碑（含「当前位置」），
  点一个就传送，落点在石碑顶上（y+2）。
- **传送石**：右键打开同一个选择界面，传送后 30 秒冷却、物品不消耗；冷却中提示
  「传送石未完全充能。」。
- **传送卷轴**：右键打开选择界面，传送时消耗 1 张。
- **返回卷轴**：右键直接去最近的已激活石碑，消耗 1 张。
- **命令**：`/waystone list`、`/waystone rename 新名字`、`/waystone search 关键词`
  （界面里没有文本输入框，自定义名字只能走命令；原版是在界面输入框里打字）。

## 和原版的差异

1. **一个方块两格高，而不是 `half=lower/upper` 两个方块**：引擎方块状态固定为 `[{}]`，
   不能做双半方块和 `facing`。这里把两半几何拼进同一个模型（0..32），碰撞和选取框也跟着
   模型到两格，所以能站上去、从上半右键也是同一块；代价是没有朝向，放置时不会朝玩家。
2. **界面是引擎的按钮菜单**（`api.menu`），没有原版的文本输入框、滚动列表、Shift 删除、
   经验等级消耗显示。命名用「激活时自动生成 + 设置界面确认/随机换名」近似，
   自定义名字用命令。
3. **没有经验消耗**（原版默认配置也是 0）。
4. **未移植**：共享石碑、传送石板、单向石碑、传送粉/共鸣碎片/绑定卷轴、
   **村庄世界生成**（原版 `worldgen` 会在村庄里放石碑；引擎没有结构生成接口）、
   Journey Map/背包按钮集成。
5. 名单用 `api.store` 存在世界存档（JSON），是**世界级**而不是玩家级：同一世界共用一份列表。

## 文件

```
mods/waystones/
├─ data.js            5 方块 / 3 物品 / 8 配方 + 内联 WAYSTONE_MODELS（每种 9 个元件）
├─ code.js            激活自动命名、设置界面、选择界面、传送、三个道具、/waystone
├─ mod.json
├─ textures/          68 张 16×16（65 张按面从 64×32 原图切出 + 3 张物品）
├─ _ref/              Waystones 1.20.1 原始仓库（模型 / 贴图 / 配方 / Java 源码）
└─ _build/
   ├─ mkmodel.py      按 parent 链取几何、按面切 uv、拼 32 高、写 data.js
   ├─ mktextures.py   切面贴图、物品贴图
   ├─ mkprelude.py    分配编号、写 _prelude、登记 index.json
   ├─ crops.json      mkmodel 产出的面 → uv 区域表
   ├─ verify.js       47 项玩法桩校验
   └─ verify_sdk.js   21 项真实 modapi.js 数据层校验
```

## 重新生成 / 校验

```powershell
python probe/mods/waystones/_build/mkmodel.py
python probe/mods/waystones/_build/mktextures.py
python probe/mods/waystones/_build/mkprelude.py
node probe/mods/waystones/_build/verify.js
node probe/mods/waystones/_build/verify_sdk.js
```

测试页：`http://localhost:8777/game.html?modtest=waystones`
