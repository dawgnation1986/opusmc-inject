# 机械动力 · Create（OpusMC 网页移植版）

把 Create（机械动力）搬进 OpusMC 离线版。**不是复刻外观，是移植**：方块外形直接转 Create 原仓库的
block model JSON，贴图直接用仓库里的 PNG（降采样到引擎要求的 16×16）。

- 仓库：`_ref/repo/Create-mc1.20.1-dev/`（整包 `create-mc1.20.1-dev.zip`，14.9 MB）
- 版本：1.2.0 · 模组 id `create` · 编号 blocks 4097–4112 / items 10001–10014

## 内容清单

**16 个方块**

| 方块 | 外形来源 |
|---|---|
| 安山岩机壳 / 黄铜机壳 / 铜机壳 | 原版贴图（长方体） |
| 传动轴 / 齿轮 / 大齿轮 | `block/shaft.json`、`block/cogwheel.json`、`block/large_cogwheel.json` |
| 水车 | `block/water_wheel/block.json` + 手工补的轮辐（原版轮子是 OBJ，引擎不吃） |
| 风车轴承 | 原版贴图（长方体） |
| 白色风帆 | `block/white_sail.json`（帆布 + 木框） |
| 手摇曲柄 | **重做**：原版 handle.json 的旋转手柄在网页端错位，改成底座 + 轴 + 摇把，全部在方块内 |
| 创造马达 | `block/creative_motor/block.json` |
| 机械压机 | `block/mechanical_press/block.json` + 压回方块内的压杆/压头 |
| 石磨 | `block/millstone/block.json` + 方块内的磨芯 |
| 动力锯 | `block/mechanical_saw/horizontal.json` + 方块内的锯片 |
| 机械搅拌器 | `block/mechanical_mixer/block.json` + 方块内的搅拌杆 + 顶部轴承口 |
| 锌矿石 | 原版贴图 + 主世界生成（每区块 8 簇） |

**14 个物品**：安山岩合金、铁板、铜板、金板、坚固板、黄铜锭、黄铜粒、黄铜板、锌锭、锌粒、粗锌、
面粉、精密构件、工程师护目镜。

**22 条配方**（21 工作台 + 1 熔炼），链条闭合：安山岩+铁粒 → 合金 → 传动轴/机壳 → 齿轮/大齿轮 →
水车/风车轴承/曲柄/风帆 → 压机/石磨/锯/搅拌器 → 铁板/铜板/金板/黄铜板 → 机壳/精密构件/护目镜。
创造马达按原版设定只在创造物品栏里，不给配方。

## 状态机制（1.2.0 修正）

- **手摇曲柄不再孤立发电**：必须相邻一格有传动轴 / 齿轮 / 大齿轮或其它传动件，右键摇动才让这一网
  跑 5 秒；孤立放着的曲柄右键会提示“没接上传动轴”。
- **风车轴承要装帆**：原版是轴承 + 一排 sail，这里要求轴承上方 3×3×8 范围里至少 3 张白色风帆，
  否则不算动力源（不再靠“上方有空气”糊过去）。
- **水车**：6 个邻面里任意一面是水（水源或流水都算）→ 8 RPM / 32 SU。
- **创造马达**：默认 16 RPM，`/create motor N` 可改（1–256），容量 16384 SU。
- **机器接传动**：齿轮/轴放在搅拌机、压机、锯、石磨的任意相邻格就并进同一网；搅拌机顶部那截带
  `axis` 贴图的方块就是它的轴承口。整网转速 0 或超应力时机器拒绝加工。

## 工程师护目镜

护目镜是**头盔栏护甲**（`armor.slot = head`，0 点护甲）：右键戴上 / 摘下，戴上后看向任意传动件或机器，
左上角显示该网络的转速、应力、动力源状态。引擎没有护目镜的护甲层贴图，所以戴上后头上不显示铁头盔
（`armor.mat` 改成不存在的 `goggles`，渲染层自动跳过）。

## 动力学数值（取自 Create mc1.20.1 源码）

| 部件 | 转速 | 应力容量 / 消耗 |
|---|---|---|
| 水车 `WaterWheelBlockEntity` | 8 RPM | 32 SU |
| 风车轴承 `setGeneratorSpeed(16,true)` | 16 RPM（需装帆） | 512 SU |
| 手摇曲柄 `HandCrankBlock.getRotationSpeed()` | 32 RPM | 8 SU |
| 创造马达 | 默认 16 RPM（`/create motor` 改） | 16384 SU |
| 机械压机 | — | 8 SU |
| 石磨 / 动力锯 / 机械搅拌器 | — | 各 4 SU |

大齿轮每多一个：转速 ×0.5、容量 ×2，最多叠 3 次。需求 > 容量 = 超应力，机器拒绝工作（和原版一致）。
传动网络 = 6 邻接 BFS（上限 600 个方块，结果缓存 20 tick）。

## 机器用法

原版是传送带 + 漏斗自动线，网页版没有方块实体，改成**右键手持物品加工**：

- 机械压机：铁锭→铁板、铜锭→铜板、金锭→金板、黄铜锭→黄铜板
- 石磨：小麦→面粉
- 动力锯：任意原木→6 个对应木板
- 机械搅拌器：安山岩+铁粒→安山岩合金；铜锭+锌锭（或反过来）→2 黄铜锭
- 手摇曲柄：贴着传动轴右键摇 5 秒，网络内 32 RPM

## 命令

```
/create info      看着某个传动件，报这一网的转速 / 应力 / 方块数
/create demo      面前自动搭「水车→轴→轴→齿轮→压机」并放两格水
/create clear     只拆自己搭过的演示方块
/create motor N   把周围 8 格内的创造马达设成 N RPM（1–256）
/create            手册
```

## 模型与动画：能做的和做不到的（必须写清楚）

引擎的方块是**静态模型**：`states` 固定为 `[{}]`，`modapi` 只暴露 `getState / setBlock(..., state)`，
没有逐帧方块渲染，也没有方块实体 tick。所以：

- **没有转动动画**。齿轮、水车、锯片在 Create 里是靠 BlockEntityRenderer 每帧转的，网页端方块模型
  烘死，只能用一片静止的锯片/辐条表示。这一点无法靠移植解决，除非改引擎（不在本次授权范围）。
- 活动部件不能“探头”到方块外：原版压机的压杆坐标到 y≈27、搅拌器立柱到 y≈32、搅拌头到 y=-4，
  这些在 Create 里由渲染器摆放，烘进静态模型会插进邻居方块。1.2.0 已把它们压回 0..16，外观上机器
  是“静止的一体机”，不会再悬空/穿模。
- 手摇曲柄原版手柄是带旋转的子模型，网页端会错位，1.2.0 改成固定朝向的摇把（始终朝 -X 方向）。

## 文件结构

```
probe/mods/create/
├── data.js          内容层（含 _prelude 与内联的 CREATE_MODELS）
├── code.js          玩法层（网络、动力源、四机器、护目镜 HUD、/create）
├── mod.json         模组信息
├── textures/        47 张 16×16 PNG（全部来自 Create 仓库）
├── README.md
└── _build/
    ├── mkmodel.py        Create block model JSON → data.js 里的 CREATE_MODELS
    ├── mktextures.py     按模型引用取材 + 降采样，写 textures/
    ├── mkprelude.py      编号分配 / 写 _prelude / 登记 index.json
    ├── verify.js         45 项玩法桩验证
    ├── verify_sdk.js     20 项真实 modapi.js 数据层验证
    ├── tex_probe.py      贴图尺寸 / 包围盒探测
    └── _ref/             整包仓库 + 抓下来的配方与源码
```

重新生成（改模型或贴图后按顺序跑）：

```
python _build/mkmodel.py      # 仓库模型 -> data.js 的 CREATE_MODELS
python _build/mktextures.py   # 仓库贴图 -> textures/（多余文件会删掉）
python _build/mkprelude.py    # 编号 + 前导 + index.json
node _build/verify.js && node _build/verify_sdk.js
```

## 与原版的差异（明确写下来）

1. **没有传送带 / 漏斗 / 机械臂 / contraption / 矿车装置**：这些依赖方块实体与逐帧渲染，网页版没有。
2. **没有方块朝向**：`states` 只有 `[{}]`，传动轴固定竖放、齿轮固定水平、曲柄手柄固定朝 -X。
   原版的六向旋转、齿轮啮合判定都没有。
3. **没有转动动画**：见上一节；齿轮/水车/锯片都是静态的。
4. **水车的轮子是近似**：原版走 `forge:obj` 的 `water_wheel.obj`，引擎只吃长方体元件，
   所以轮辐是用原版 `waterwheel_metal` 贴图手工拼的 5 辐条 + 轮缘 + 轮毂。
5. **机器是右键加工**，不是自动产线；没有加工时长、没有鼓风机、没有加热搅拌。
6. **护目镜没有自定义护甲层贴图**：戴上后头上不显示模型（避免套个铁头盔），只保留 HUD 功能。
7. **应力模型简化**：`KineticBlockEntity.calculateStressApplied()` 原版直接返回 impact，
   这里同样按 impact 直接相加，不乘转速；没有过应力时的转速衰减曲线。
8. **只移植了动力学主干**：Create 的 200+ 方块里，这里覆盖机壳、传动件、四种动力源、四台加工机器，
   其余（齿轮箱、离合器、变速箱、机械臂、装配线、列车、蓝图、蒸汽引擎等）都没进来。

## 版权

- 代码：MIT。
- 贴图与模型几何：来自 [Create](https://github.com/Creators-of-Create/Create)，作者 simibubi 及贡献者，
  授权 CC BY-NC-SA 4.0。本移植仅用于学习 / 非商业用途，请遵守原授权。
