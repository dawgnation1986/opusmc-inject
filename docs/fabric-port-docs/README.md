# Comet Client · 网页版 → Fabric 移植总览

这份文档是整套移植笔记的目录和地基。源码是被移植的对象：`opusmc-inject/opusmc-hud.user.js`，v1.31.0，12124 行，单个 IIFE，`@run-at document-start` 注入到 OpusMC / OpusCraft 网页版 Minecraft。用户在脚本里塞了一整套「彗星 Comet Client」：ClickGUI、毛玻璃主题、彗星式 HUD、光环 / ESP / 雷达、开场动画、一堆玩法模块和扩展模块。目标是把**全部功能与特效系统**搬到 Java 版 Fabric Mod，口径是「一定要全部的」。

写之前先把源码通读了一遍，包括 295–779 的 `MODULES`、106–140 的 `cfg`、1647 的 `tickModules`、3101 的 `onFrame`、11145 的备份格式、6963 的 `extSelfTest`。下面所有行号都对得上这个文件，不是估的。

有一件事必须先说清楚，不然后面每一卷都会算错账：

> **`MODULES` 运行时是 100 个模块，不是数组字面量里的 50 个。**
> 295–779 只是主表。之后五组 `EXT_MODULES`（4653 / 5384 / 6128 / 6644 / 7171）各自 `for (const em of ...) { MODULES.push(em); MODS_BY_ID[em.id] = em; }` 把模块追加进同一个数组，7429 行还单独 push 了 `about`。`extSelfTest()` 里报的 `MODULES.length`、帮助中心「关于」页显示的模块数，都是 100。全部模块共用同一套 `cfg.states` / `cfg.settings` / `cfg.binds` / `cfg.favorites`，扩展模块只是换了个注册位置，开关和设置跟主表模块完全同构。移植时一个都不能漏。

---

## 1. 目标与版本口径

### 1.1 要搬的是什么

不是把 JS 翻译成 Java，是把「效果」重新实现一遍。脚本能跑起来靠的是网页版游戏把 `game` / `player` 挂在 `window` 上、把渲染画在 `#gl`(WebGL) 和 `#ui`(Canvas 2D) 双画布上、把方块贴图塞进 `TEXTURE_2D_ARRAY`。Fabric 侧这些前提全变了：实体访问走 `MinecraftClient.getInstance()`，2D 绘制走 `DrawContext`，3D 线框走 `VertexConsumerProvider` + `RenderLayer.getLines()`，材质走资源包。所以每一条功能都要重新回答「在 Java 版里，什么东西等价于这个 hook」。

用户明确排除 **Aura 的攻击逻辑**（自动索敌 / 发包打人），但光环视觉、目标高亮、TargetHUD 这些还是要的；这条边界在 `02-aura-ring.md` 和 `09-gameplay-modules.md` 里都按「特效全搬、攻击判定不搬」处理。

### 1.2 统一技术口径（全十卷一致，别各写各的）

| 项 | 约定 |
|---|---|
| 游戏版本 | Minecraft **Java 1.21.1** |
| 加载器 | Fabric Loader **0.16+** |
| 映射 | **Yarn mappings**（1.21.1），不混用 Mojang / 官方名 |
| API | Fabric API |
| JDK | **Java 17** |
| 入口 | `implements ClientModInitializer`，`onInitializeClient()` 里注册事件；`environment: "client"` |
| HUD 2D | `HudRenderCallback.EVENT.register((DrawContext ctx, float tickDelta) -> ...)` |
| 世界渲染 | `WorldRenderEvents.AFTER_ENTITIES` / `END_MAIN`，用 `WorldRenderContext.matrixStack()` / `.camera()` |
| 3D 线框 | `VertexConsumerProvider` + `RenderLayer.getLines()` |
| 全屏后处理 | `RenderTarget`（离屏 framebuffer）+ 两趟可分离高斯模糊 shader |
| 配置 | Config POJO + Gson 落盘；GUI 用 Cloth Config |
| 运行时改逻辑 | Mixin `@Mixin` / `@Inject`，写明目标类与方法签名 |
| 事件 | `ClientTickEvents.END_CLIENT_TICK`、`ClientPlayConnectionEvents.JOIN`、`KeyBindingHelper`、`AttackEntityCallback` |

版本号里凡是带 `+` / `SNAPSHOT` / 具体数字的，都是**占位**：`build.gradle` 里用 `${project.*_version}` 引用 `gradle.properties`，换版本时只改一处。Cloth Config / ModMenu 的版本号和 1.21.1 的对应关系以各自 maven 实际发布为准，别照抄本文档里的占位数字。

### 1.3 分卷清单与阅读顺序

十份文档按「先全局、再特效、再系统、最后逐条对账」排：

| # | 文件 | 讲什么 | 什么时候读 |
|---|---|---|---|
| — | **README.md**（本卷） | 目标、口径、模块总表、工程结构、术语对照、优先级 | 第一个读 |
| 01 | `01-architecture.md` | 整体架构：IIFE → 生命周期、每帧链、注册表、渲染分层 | 读 README 之后 |
| 02 | `02-aura-ring.md` | 光环 / 范围圈 / 几何图案 / 频谱柱 / 拖影 / 辉光全解 | 做视觉特效时 |
| 03 | `03-boot-intro.md` | 启动开场动画：黑屏、图案逐段组装、碎片归位、扩散淡出 | 做视觉特效时 |
| 04 | `04-glass-ui.md` | 毛玻璃 ClickGUI、主题、外观预设、悬浮面板、HUD 编辑 | 做 UI 时 |
| 05 | `05-targethud-nametags.md` | TargetHUD、名字标签、世界内血条、头像 | 做 HUD 时 |
| 06 | `06-hud-and-esp.md` | Watermark / Info / ArrayList / 通知 / 雷达 / 罗盘 / ESP / Tracers / 小地图 / 背包 / 掉落物 | 做 HUD 时 |
| 07 | `07-config-and-modules.md` | cfg 结构、8 种设置类型、模块注册、分类 / 子分类 / 收藏 / 搜索 / 键位、主题与外观预设、`.opuscfg` 备份、自检、完整 Java 骨架 | 搭工程骨架时 |
| 08 | `08-porting-checklist.md` | 逐功能移植对照表、无法 1:1 移植清单、风险清单、验收清单 | 排期与验收时 |
| 09 | `09-gameplay-modules.md` | 移动 / 世界 / 工具 / 渲染 / 其它玩法模块的 Java 实现思路与客户端侧限制 | 做玩法时 |

`07` 是地基（`ModConfig` / `Module` / `ModuleRegistry` 三件套其余卷都要 import），建议先落地；`08` 是总账，写完后拿它逐条勾。

---

## 2. 完整模块总表

### 2.1 先分清「模块 id」和「设置项 id」

源码里两种 `id` 长得很像，别混：

- **模块 id**：`MODULES` 数组顶层对象的 `id`，如 `aura`、`esp`、`fly`。开关存 `cfg.states['aura']`，键位存 `cfg.binds['aura']`，收藏存 `cfg.favorites['aura']`。全表共 **100 个**。
- **设置项 id**：模块 `settings[]` 里的 `id`，如 `aura.range`、`esp.distance`。取值走 `getS(mid, sid)`，落盘 key 是 `"aura.range"`（模块 id + 点 + 设置项 id）。`extSelfTest()` 里 `MODULES.reduce((n, m) => n + (m.settings || []).length, 0)` 数的是这一类。

注意少数设置项的 `id` 恰好和某个模块 id 同名（例如 `resourcepack.enabled` 里的 `enabled`、`xray.labels`），但它们是字符串 key 的两段，不是模块。`getS` 的默认值来自 `MODS_BY_ID[mid].settings.find(s => s.id === sid).value`，`value` 甚至可以是函数（`server.server` 的选项、`mc18.addr` 的初值都是 `() => ...`，806–819 行），这个细节在 07 卷展开。

### 2.2 分类（CATS，286–293 行）

源码是 6 个分类，任务分派里写的 `move` / `world` / `tool` 是逻辑分组的叫法，**以源码为准**：

| cat id | 中文名 | 图标 | 主表模块数 | 扩展追加 | 合计 |
|---|---|---|---|---|---|
| `combat` | 战斗 | ⚔ | 5 | 5 | 10 |
| `movement` | 移动 | ➤ | 7 | 0 | 7 |
| `render` | 渲染 | ◈ | 20 | 12 | 32 |
| `player` | 玩家 | ☺ | 6 | 2 | 8 |
| `misc` | 工具 | ⚙ | 5 | 19 | 24 |
| `configs` | 配置（`extra: true`）| ⛭ | 7 | 12 | 19 |

逐行数主表（295–779）：5 + 7 + 6 + 20 + 5 + 7 = 50；五组扩展 + about 按 cat 是 5 / 0 / 12 / 2 / 19 / 12 = 50；合计 100。`spin` 源码里 `cat: 'misc'`（665 行），别因为它改的是渲染就把它算进 render。

`configs` 带 `extra: true`，在侧栏里单独一档。`MODULE_SUB_ORDER`（10516 行）是渲染分类下的**子分类**排序，不是新分类：`['实体与生物', '世界与方块', '轨迹与引导', '视觉特效', '界面与 HUD', '其它']`，靠 `MODULE_SUBS` 映射，`sortedModules()`（10533）按子分类序 + 收藏 + 名称排。

### 2.3 主表 50 个模块（295–779 行）

「对应分卷」写主责文档，括号内是次要引用。战斗类里 Aura 的**攻击判定**不搬，只搬视觉，故统一指向 `02` / `05` / `06`。

#### combat（5）

| id | 中文名 | 作用（源码 desc 压缩） | 对应分卷 |
|---|---|---|---|
| `aura` | 光环 | 自动攻击范围内敌对目标；设置里带整套脚下范围圈 / 几何图案 / 彩虹 / 粒子 / 频谱 / 拖影（18 个设置项，是特效最密的模块） | `02`（视觉）、`09`（攻击逻辑排除） |
| `multiaura` | 千手观音 | 一次挥击同时打中范围内多个生物，复用光环的目标筛选 | `02`、`09` |
| `triggerbot` | 触发机器人 | 准星指向目标时自动攻击 | `09` |
| `bowaim` | 弓箭辅助 | 手持弓自动瞄准（重力补偿 / 移动预判 / 平滑转视角 / 自动蓄力射击） | `09`、`06`（弹道线） |
| `crit` | 刀刀暴击 | 攻击瞬间伪造「下落中 + 蓄力拉满」使伤害判定 ×1.5 | `09` |

#### movement（7）

| id | 中文名 | 作用 | 对应分卷 |
|---|---|---|---|
| `autosprint` | 自动疾跑 | 保持疾跑，可设「仅前进」 | `09` |
| `fly` | 飞行 | 双击空格开关；飞行时空格升 / Shift 降 | `09` |
| `autojump` | 自动跳跃 | 前进被挡时自动起跳（写 `g.settings.autoJump`） | `09` |
| `speed` | 加速 | 提高移动速度，倍率 1–2.5 | `09` |
| `step` | 自动上台阶 | 自动跳上一格高方块（`p.stepHeight = 1`） | `09` |
| `scaffold` | 自动搭路 | 前进时自动在脚下前方铺手里的方块（单机 `setBlock` / 联机发 `place` 包） | `09` |
| `nofall` | 免摔伤 | 清 `fallDist` + 置 `slowFall` 取消坠落伤害 | `09` |

#### player（6，任务口径里的「世界」）

| id | 中文名 | 作用 | 对应分卷 |
|---|---|---|---|
| `autorespawn` | 自动重生 | 死亡后延时调 `g.respawn()` | `09` |
| `fastbreak` | 快速破坏 | hook `g.breakSpeed` 乘倍率（2–20） | `09` |
| `instantbreak` | 瞬间破坏 | 开挖立即完成（联机 `net.dig(0/2)`） | `09` |
| `autoeat` | 自动进食 | 饥饿低于阈值且手持食物时按住右键 | `09` |
| `waterbreath` | 水下呼吸 | 水下把 `p.air` 顶回 300 | `09` |
| `freecam` | 灵魂出窍 | 相机脱离身体，WASD + 空格 / Shift + 鼠标自由移动，身体原地不动 | `09` |

#### render（21）

| id | 中文名 | 作用 | 对应分卷 |
|---|---|---|---|
| `esp` | 生物ESP | 生物 / 掉落物 / 玩家 3D 线框，各自定义颜色 | `06` |
| `tracers` | 追踪线 | 准星 → 实体的追踪线，各自定义颜色 | `06` |
| `projectile` | 投掷物抛物线 | 手持预览 / 飞行轨迹 / 落点 / 预判命中点，与弓箭辅助共用弹道 | `06`、`09` |
| `nametags` | 名字标签 | 实体名字 + 血条 + 手持 / 装备 / 别名 / 排版（9 设置项，默认开） | `05` |
| `itemesp` | 物品ESP | 掉落物 / 投射物标记 | `06` |
| `targetesp` | 目标ESP | 高亮 Aura 当前目标 | `05`、`02` |
| `fullbright` | 全亮 | 强制最亮夜视（hook `nightVisionScale`） | `09` |
| `nightvision` | 夜视 | 强制夜视效果 | `09` |
| `ambience` | 环境 | 锁 `g.worldTime` / `g.weather` | `09` |
| `hud` | HUD | 水印 / 坐标 / TargetHud / ArrayList / 通知 / 雷达 / 罗盘 / 路径点（默认开） | `06` |
| `xray` | 矿透 | 「材质透视」隐藏 `#gl` 只留矿石 / 「框选」；扫描半径 / 上限 / 穿墙 / 标签 | `09`、`08` |
| `blockesp` | 方块追踪 | 指定方块名扫描周围区块持续高亮，含准星框 / 屏外箭头 / 浏览按钮 | `06` |
| `trail` | 移动轨迹 | 身后渐隐光轨 + 脚下光点 | `06` |
| `targetring` | 目标光环 | 目标脚下旋转光圈 + 上升光柱 | `02` |
| `waypoints` | 路径点 | 世界光柱 + 名字距离 + 屏外箭头，小地图同步标点 | `06`、`09` |
| `minimap` | 小地图 | Xaero 式圆形：地形着色 / 实体点 / 路径点 / 方位坐标，含「打开大地图 (M)」 | `06` |
| `invhud` | 背包信息 | 悬浮快捷栏 / 完整背包，物品中文名 / 数量 / 选中格 | `06` |
| `drops` | 掉落物汇总 | 汇总面板 + 世界内名字距离 / 3D 框，可分别开关 | `06` |
| `mblur` | 视角运动模糊 | 转视角时全屏模糊，停下淡出（CSS `backdrop-filter`，3659 行） | `09`、`04`、`08` |
| `containeresp` | 容器 ESP | 箱子 / 木桶 / 熔炉等 13 类容器，每类单独框色 + 线色（30 个设置项，其中 26 个是颜色项） | `06` |

`spin` 归 `misc`，见下表；它改的是 `playerBodyYaw`（965–982 行），但分类不是 render。

#### misc（5，任务口径里的「工具」）

| id | 中文名 | 作用 | 对应分卷 |
|---|---|---|---|
| `music` | 音乐播放器 | GD 音乐台 / 公共领域双音源，聚合搜索 / 自动换源 / Web Audio 频谱（11 设置项） | `06`、`08` |
| `server` | 服务器切换 | 切房间服务器（写 `NET_CONFIG.rooms`） | `09` |
| `gate` | 跳过登录门槛 | hook `W.onlineGate` 跳过客户端 UI 门槛 | `09`、`08` |
| `mc18` | MC18 连接 | 直连 1.8 服务器（依赖 `opus-mc18-link`） | `09`、`08` |
| `spin` | 模型自转 | 见上 | `09` |

#### configs（6）

| id | 中文名 | 作用 | 对应分卷 |
|---|---|---|---|
| `appearance` | 外观设置 | 绚丽 / 平缓 / 基本 / 自定义四档预设，写 CSS 变量（1878 行 `APPEARANCE_PRESETS`） | `04`、`07` |
| `perf` | 性能优化 | 按 FPS 自动降级（省电 / 均衡 / 绚丽），实体上限 / 特效精度 / 关辉光 | `07`、`08` |
| `resourcepack` | MC 材质包 | 导入标准 MC `.zip`，方块贴图走 `TEXTURE_2D_ARRAY`、GUI 贴图替换 `images`，`DecompressionStream` 原生解压 | `08`、`09` |
| `hudedit` | HUD 编辑 | 拖动调整 HUD 元素位置 | `04`、`06` |
| `cfgreset` | 配置备份 | 导出 / 导入 `.opuscfg`（含开关 / 按键 / 路径点 / 面板位置） | `07` |
| `intro` | 启动开场动画 | 黑屏图案逐段组装 / 碎片归位 / 转圈 / 扩散淡出 | `03` |
| `floatgui` | 悬浮标签 | 每个分类一个悬浮面板，可拖动 / 右键折叠，位置自动记（默认开） | `04` |

configs 共 7 个（`appearance` / `perf` / `resourcepack` / `hudedit` / `cfgreset` / `intro` / `floatgui`），是唯一 `extra: true` 的一档；render 20 个，数量最多。`appearance` / `perf` / `resourcepack` 的 `desc` 都写在下一行（507 / 524 / 709），按行号数别漏。

### 2.4 扩展模块 50 个（EXT_MODULES A–E + about）

这 50 个没有出现在 `MODULES` 字面量里，是运行时 push 进去的。**它们照样有 `cfg.states` 开关、有 `settings`、出现在 ClickGUI 列表里、能被键位绑定和收藏**。移植时统一进 `ModuleRegistry`，不要当成「次要功能」砍掉。

#### A 组 `EXT_MODULES`（4653–4739，10 个）

| id | 中文名 | cat | 作用 | 对应分卷 |
|---|---|---|---|---|
| `autotool` | 自动工具 | player | 开挖时自动切最快工具，可静默 / 挖完切回 | `09` |
| `autoarmor` | 自动装备 | player | 自动把防御最高的盔甲穿到盔甲栏 | `09` |
| `deathpoint` | 死亡点 | misc | 死亡时自动打路径点 | `09` |
| `coordlog` | 坐标记录 | misc | 记录 / 复制 / 清空当前坐标，进 `.opuscfg` | `06`、`07` |
| `sessionstats` | 本次统计 | misc | 时长 / 行走距离 / 挖掘数 / FPS 极值 | `06` |
| `combatlog` | 战斗日志 | misc | 最近受伤 / 击杀 / 死亡事件 | `06` |
| `profile` | 配置档 | configs | 把模块开关存成 3 个档位一键切换 | `07` |
| `macro` | 聊天宏 | configs | 3 条自定义文本一键发送 | `07` |
| `chunkinfo` | 区块信息 | misc | 区块坐标 / 区内坐标 / 亮度 / 维度 | `06` |
| `blockinfo` | 准星方块信息 | misc | 准星方块名 / 坐标 / 硬度 / 建议工具 | `06` |

#### B 组 `EXT_MODULES_B`（5384–5477，10 个）

| id | 中文名 | cat | 作用 | 对应分卷 |
|---|---|---|---|---|
| `chunkborder` | 区块边界 | render | 画 16×16 区块边界线 | `06` |
| `lightoverlay` | 亮度覆盖 | render | 在地面叠亮度等级色块 | `06` |
| `armorhud` | 装备耐久 | render | 悬浮显示盔甲与耐久 | `06` |
| `potionhud` | 药水效果 | render | 悬浮显示药水剩余时间 | `06` |
| `fpsgraph` | FPS 曲线 | render | 实时 FPS 折线图 | `06` |
| `hitmarker` | 击中标记 | combat | 命中时准星闪一下 + 音效 | `06` |
| `damagenumbers` | 伤害数字 | render | 命中处飘伤害数字 | `06` |
| `crosshair` | 自定义准星 | render | 五种形状可切（5755 行绘制） | `06`、`09` |
| `zoom` | 缩放 | render | 按键改 FOV 缩放（5799 行） | `06` |
| `antikb` | 防击退 | combat | 取消受击击退 | `09` |

#### C 组 `EXT_MODULES_C`（6128–6215，11 个）

| id | 中文名 | cat | 作用 | 对应分卷 |
|---|---|---|---|---|
| `welcome` | 欢迎提示 | misc | 进服弹欢迎语 | `06` |
| `afk` | 挂机检测 | misc | 长时间无输入标记 AFK | `06` |
| `tps` | TPS 估算 | misc | 由世界时间推进估 TPS | `06` |
| `entitycount` | 实体计数 | misc | 按半径统计 mob / item / player（6280 行） | `06` |
| `gametime` | 游戏时钟 | misc | 游戏内时间 / 天数 / 月相（6297 行） | `06` |
| `lowhp` | 低血量警报 | combat | 低血时径向红色 overlay + 闪烁（6315 行） | `06` |
| `armorwarn` | 装备损坏警告 | combat | 耐久低时提示 | `06` |
| `coordcopy` | 复制坐标 | misc | 按格式复制坐标到剪贴板（6302 行） | `06` |
| `helpcenter` | 帮助中心 | configs | 模块说明 / 速查表 / 自检 Tab | `07` |
| `keyadmin` | 键位管理 | configs | 列出 / 清除已绑定键位（6495 行） | `07` |
| `healthcheck` | 配置体检 | configs | `extHealthCheck()`（6333 行）扫异常设置键 / 路径点 / 面板位置 | `07` |

#### D 组 `EXT_MODULES_D`（6644–6739，12 个）

| id | 中文名 | cat | 作用 | 对应分卷 |
|---|---|---|---|---|
| `damageindicator` | 受伤方向 | combat | 屏幕边缘指示伤害来源方向 | `06` |
| `blockhistory` | 方块变化记录 | misc | 记录附近方块变更 | `06` |
| `chatlog` | 聊天记录 | misc | 留存聊天消息 | `06` |
| `orestats` | 挖矿统计 | misc | 见过的矿石计数 | `06` |
| `playtimewarn` | 时长提醒 | misc | 游玩超时提示 | `06` |
| `fpswarn` | 掉帧提醒 | misc | FPS 低于阈值提示 | `06` |
| `notes` | 随身边签 | configs | 游戏内便签 | `07` |
| `screenshot` | 截图 | configs | 一键截图 | `07` |
| `resource` | 资源用量 | configs | 内存 / 实体等运行时信息 | `07` |
| `entitytrail` | 实体轨迹 | render | 实体移动拖尾（7024 行 `extEntityTrails`） | `06` |
| `autogg` | 进服问候 | misc | 进服自动发一句 | `06` |
| `selftest` | 模块自检 | configs | 帮助中心「模块自检」Tab，跑 `extSelfTest()` | `07` |

#### E 组 `EXT_MODULES_E`（7171–7219，6 个）+ about（7423，1 个）

| id | 中文名 | cat | 作用 | 对应分卷 |
|---|---|---|---|---|
| `waypointline` | 路径点引导线 | render | 从脚下到路径点画引导线 | `06` |
| `blockoutline` | 准星方块描边 | render | 准星方块高亮描边 | `06` |
| `entityinfo` | 准星实体信息 | misc | 准星实体详情面板 | `06` |
| `healthbar` | 世界内血条 | render | 实体头顶血条（区别于 nametags 的） | `05` |
| `quicktoggle` | 一键关特效 | configs | 一键关掉所有高开销特效 | `07` |
| `guide` | 指令速查 | configs | 常用指令 / 方块速查 | `07` |
| `about` | 关于 | configs | 版本 / 模块数 / 设置数 / 运行时信息（7433 行 `extAboutInfo`） | `07` |

合计：主表 50 + A10 + B10 + C11 + D12 + E6 + about1 = **100**。

### 2.5 不是模块的几样东西

别把下面这些也当成模块去注册，它们是支撑代码：

- `hookRender` / `onFrame` / `tickModules`（965 / 3101 / 1647）：每帧驱动链，对应 Fabric 的事件回调，不是模块。
- `getS` / `setS` / `modOn` / `toggleModule`（806–831）：配置读写 API，对应 `ModConfig` 的方法。
- `espFrame` / `extHud*` / `extTick*`：渲染 / tick 分组函数，是多个模块共用的绘制管线。
- CSS 变量 `--cm-accent` / `--cm-blur` 等（1893 行 `applyAppearance` 写入）：主题状态，不是模块。
- `.opuscfg` 备份、帮助中心、自检 Tab：是 `configs` 分类下的**模块**，已列在上表，别重复算。

---

## 3. Java 工程结构建议

### 3.1 目录树

```
comet-client/
├── build.gradle
├── settings.gradle
├── gradle.properties
├── gradle/wrapper/gradle-wrapper.properties
└── src/main/
    ├── java/com/bigpixel/comet/
    │   ├── CometClient.java                 # ClientModInitializer 入口
    │   ├── config/
    │   │   ├── ModConfig.java              # Gson POJO + load/save
    │   │   ├── ConfigScreen.java           # Cloth Config 屏幕骨架
    │   │   └── BackupCodec.java            # .opuscfg 导出/导入
    │   ├── module/
    │   │   ├── Module.java                 # 基类
    │   │   ├── ModuleRegistry.java        # 100 个模块的注册/分类/开关
    │   │   ├── ModuleCategory.java        # 对应 CATS 枚举
    │   │   └── SettingSpec.java           # 8 种设置类型的描述
    │   ├── key/KeyBindings.java            # KeyBindingHelper + 模块键位绑定
    │   ├── event/
    │   │   ├── CometTick.java              # END_CLIENT_TICK 分发
    │   │   ├── CometHud.java               # HudRenderCallback
    │   │   └── CometWorldRender.java       # AFTER_ENTITIES / END_MAIN
    │   ├── render/
    │   │   ├── LineRenderer.java           # RenderLayer.getLines() 封装
    │   │   ├── BlurPipeline.java           # RenderTarget + 两趟高斯
    │   │   ├── geometry/                  # 光环几何图案（02 卷）
    │   │   └── hud/                       # 各 HUD 组件（05/06 卷）
    │   ├── gameplay/                      # 09 卷玩法模块实现
    │   └── mixin/                         # 所有 @Mixin
    │       ├── MinecraftClientMixin.java
    │       ├── ClientPlayerEntityMixin.java
    │       ├── GameRendererMixin.java
    │       ├── WorldRendererMixin.java
    │       ├── LightmapTextureManagerMixin.java
    │       ├── InGameHudMixin.java
    │       ├── ClientWorldMixin.java
    │       └── LivingEntityMixin.java
    └── resources/
        ├── fabric.mod.json
        ├── comet.mixins.json
        └── assets/comet/
            ├── shaders/                     # 高斯模糊 / 后处理 JSON + fsh/vsh
            ├── textures/gui/                # 毛玻璃九宫格 / 图标 / 头像兜底
            └── lang/zh_cn.json              # 模块名 / 设置名中文
```

`mixin` 包名必须和 `comet.mixins.json` 的 `"package"` 一致，否则运行时找不到类。

### 3.2 `fabric.mod.json`

`environment: "client"` 是硬要求——脚本全是客户端侧的东西，`server` 侧装了也没意义。`entrypoints.client` 指向初始化器，`mixins` 指向 mixin 配置。

```json
{
  "schemaVersion": 1,
  "id": "comet",
  "version": "${version}",
  "name": "Comet Client (Fabric Port)",
  "description": "OpusMC / Comet Client 网页注入客户端的 Fabric 移植：ClickGUI、毛玻璃 UI、彗星式 HUD、光环与 ESP 特效、玩法模块。",
  "authors": ["port"],
  "contact": {},
  "license": "ARR",
  "environment": "client",
  "entrypoints": {
    "client": [
      "com.bigpixel.comet.CometClient"
    ],
    "modmenu": [
      "com.bigpixel.comet.config.CometModMenu"
    ]
  },
  "mixins": [
    "comet.mixins.json"
  ],
  "depends": {
    "fabricloader": ">=0.16.0",
    "minecraft": "~1.21.1",
    "java": ">=17",
    "fabric-api": "*"
  },
  "suggests": {
    "modmenu": "*",
    "cloth-config": "*"
  }
}
```

`modmenu` 入口可选：不打算接 ModMenu 就把整个 `entrypoints.modmenu` 和 `suggests` 里的项删掉，别留个不存在的类。`depends` 里 `fabric-api` 用 `*` 让 Loom 自己解析，省得版本号写死对不上。

### 3.3 `comet.mixins.json`

`compatibilityLevel: "JAVA_17"`、`injectors.defaultRequire: 1`（注入失败直接崩，别静默丢功能，脚本里 hook 失败是静默的，Java 侧宁可早点暴露）。列表按卷填，这里给出全套目标类名占位。

```json
{
  "required": true,
  "package": "com.bigpixel.comet.mixin",
  "compatibilityLevel": "JAVA_17",
  "minVersion": "0.8",
  "client": [
    "MinecraftClientMixin",
    "ClientPlayerEntityMixin",
    "GameRendererMixin",
    "WorldRendererMixin",
    "LightmapTextureManagerMixin",
    "InGameHudMixin",
    "ClientWorldMixin",
    "LivingEntityMixin",
    "KeyBindingMixin"
  ],
  "injectors": {
    "defaultRequire": 1
  }
}
```

这些 Mixin 各自负责什么，在 08 卷逐条对照表里会写明目标方法签名；`09` 卷给玩法相关的具体实现。别把 `server` 段的 Mixin 也塞进来——这个 mod 是纯客户端。

### 3.4 `build.gradle` 依赖骨架

版本号全部走 `gradle.properties`，这里是占位，换版本只改一处。

```groovy
plugins {
    id 'fabric-loom' version '1.7-SNAPSHOT'   // 占位：取 Loom 对 1.21.1 支持的版本
    id 'maven-publish'
}

version = project.mod_version
group = project.maven_group

base {
    archivesName = project.archives_base_name
}

repositories {
    mavenCentral()
    maven { url 'https://maven.fabricmc.net/' }
    maven { url 'https://maven.shedaniel.me/' }              // Cloth Config
    maven { url 'https://maven.terraformersmc.com/releases/' } // ModMenu
}

dependencies {
    minecraft "com.mojang:minecraft:${project.minecraft_version}"
    mappings "net.fabricmc:yarn:${project.yarn_mappings}:v2"
    modImplementation "net.fabricmc:fabric-loader:${project.loader_version}"
    modImplementation "net.fabricmc.fabric-api:fabric-api:${project.fabric_api_version}"

    // 配置 GUI：Cloth Config（07 卷）+ ModMenu（可选）
    modApi "me.shedaniel.cloth:cloth-config-fabric:${project.cloth_config_version}"
    modImplementation "com.terraformersmc:modmenu:${project.modmenu_version}"

    // Gson 由 Minecraft / Fabric 自带，不需要单独写 implementation；
    // 若打包后报类找不到，再显式加 implementation 'com.google.code.gson:gson:2.11.0'（占位）
}

processResources {
    inputs.property "version", project.version
    filteringCharset "UTF-8"
    filesMatching("fabric.mod.json") {
        expand "version": project.version
    }
}

tasks.withType(JavaCompile).configureEach {
    options.release = 17
    options.encoding = 'UTF-8'
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
    withSourcesJar()
}
```

`gradle.properties` 对应占位：

```properties
# 全是占位值，按 fabric 官方 / 各 maven 实际发布调整
org.gradle.jvmargs=-Xmx2G
minecraft_version=1.21.1
yarn_mappings=1.21.1+build.3
loader_version=0.16.9
fabric_api_version=0.107.0+1.21.1
cloth_config_version=15.0.140
modmenu_version=11.0.3
mod_version=1.31.0-port.0
maven_group=com.bigpixel
archives_base_name=comet-client
```

### 3.5 入口初始化器

`onInitializeClient()` 里按顺序：读配置 → 注册模块 → 注册键位 → 注册事件。脚本里这些是在 IIFE 顶层边定义边执行的，Java 侧要显式排序，否则模块读配置时 `ModConfig` 还是 null。

```java
package com.bigpixel.comet;

import com.bigpixel.comet.config.ModConfig;
import com.bigpixel.comet.key.KeyBindings;
import com.bigpixel.comet.module.ModuleRegistry;
import com.bigpixel.comet.event.CometHud;
import com.bigpixel.comet.event.CometTick;
import com.bigpixel.comet.event.CometWorldRender;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderEvents;
import net.fabricmc.fabric.api.event.player.v1.AttackEntityCallback;

public class CometClient implements ClientModInitializer {

    @Override
    public void onInitializeClient() {
        // 1. 配置：等价于 IIFE 顶层读 localStorage 到 cfg（103–127 行）
        ModConfig.load();

        // 2. 模块表：主表 50 + 扩展 50，等价于 MODULES + 五组 push + MODS_BY_ID 索引
        ModuleRegistry.bootstrap();

        // 3. 键位：等价于 onKeyDown（11750–11835）里的 cfg.binds 查表
        KeyBindings.register();

        // 4. 每帧链：等价于 hookRender → onFrame → tickModules / espFrame
        ClientTickEvents.END_CLIENT_TICK.register(CometTick::onEndTick);
        HudRenderCallback.EVENT.register(CometHud::onHud);
        WorldRenderEvents.AFTER_ENTITIES.register(CometWorldRender::afterEntities);
        WorldRenderEvents.END_MAIN.register(CometWorldRender::endMain);

        // 5. 进世界 / 攻击回调：等价于 syncRefs 检测新 game 实例、crit hook 的 g.attack
        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) ->
                CometTick.onJoinWorld(client));
        AttackEntityCallback.EVENT.register((player, world, hand, entity, hitResult) ->
                CometTick.onAttackEntity(player, entity));
    }
}
```

`HudRenderCallback` 的回调签名是 `(DrawContext ctx, float tickDelta)`——`tickDelta` 就是脚本 `onFrame(alpha)` 里的 `alpha`，做动画插值直接用它，别自己从 `System.nanoTime()` 另算一套，两边相位会对不上。`WorldRenderContext.matrixStack()` / `.camera()` 对应脚本 `#gl` 画布的相机矩阵；3D 线框一律在 `AFTER_ENTITIES`（实体画完、有深度）里画，`END_MAIN` 留给需要覆盖全屏的后处理。

---

## 4. 术语对照表

这一栏是给后面每一卷查的。左边是脚本里的东西，右边是 Fabric 侧该换成什么。有些没有一一对应，我直接写了替代方案，别硬套。

| 网页侧 | 源码位置 | Fabric / Java 侧 | 说明 |
|---|---|---|---|
| IIFE + `unsafeWindow` / `W` | 22–26 | `ClientModInitializer` + Mixin | JS 靠 IIFE 抢在页面前注入；Mod 由加载器在 `onInitializeClient` 初始化，天然早于世界加载，不需要「抢时机」 |
| `__cometInstalled` 防重复注入 | 29–33 | 不需要 | 一个 mod 只被加载一次 |
| `state.game` / `state.player` 引用发现（轮询 window 全局） | `tryGlobalMount` 890 / `syncRefs` 993 | `MinecraftClient.getInstance().world` / `.player` | Java 版有唯一权威实例，不需要猜 `game / __game / G / engine` 七个全局名 |
| 替换 `G.prototype.render` 注入每帧 | `hookRender` 958 | `WorldRenderEvents` / `HudRenderCallback` / `ClientTickEvents` | 不 hook 具体类方法，用官方事件；三个事件分别对应脚本一次 `onFrame` 里的不同绘制段 |
| `requestAnimationFrame(loop)` 兜底循环 | `startFallbackLoop` 3114 | 上述每帧事件 | Fabric 每帧都会触发，不需要自建 rAF；离屏模糊的绘制也挂在 `END_MAIN` |
| DOM 节点 + CSS（`div` / `classList.toggle` / `z-index`） | 遍布 | `DrawContext` / `Screen` / 渲染阶段顺序 | HUD 用 `HudRenderCallback` 画；可交互面板用 `Screen`；层级靠渲染阶段先后，不靠 z-index |
| Canvas 2D `getContext('2d')`、`fillRect` / `stroke` / `shadowBlur` | ESP / 雷达 / 罗盘画布 1755–1768 | `DrawContext.fill()` / `drawText()` + `VertexConsumerProvider` + `RenderLayer.getLines()` | 2D 矩形 / 文字走 `DrawContext`；3D 线框走 `RenderLayer.getLines()`；`shadowBlur` 的辉光用后处理高斯，别逐元素画阴影 |
| CSS `backdrop-filter: blur() saturate()` | 9376–9871 | `RenderTarget` + 两趟可分离高斯模糊 shader | 毛玻璃不能靠 CSS；截一帧到离屏 `RenderTarget`，横竖两趟模糊后叠回，饱和度 / 亮度在 shader 里调 |
| `--cm-accent` / `--cm-blur` CSS 变量 | `applyAppearance` 1893 | `ModConfig.appearance.*` 字段，绘制时读 | 预设切换 = 改 POJO 字段 + 重建屏幕，不是改样式表 |
| WebGL `TEXTURE_2D_ARRAY` + `texSubImage3D` 注入方块贴图 | 8392–8470 | 标准资源包 `ResourcePack` / `SpriteAtlasTexture` / `NativeImage` | Java 版本来就支持资源包；脚本是在 hook `texStorage3D` 抢纹理对象后手动重传，Fabric 侧直接注册资源包，不必碰 GL 调用 |
| `CanvasRenderingContext2D.prototype.getImageData` hook 改像素 | 8386 | `NativeImage` 后处理 / 自定义 `Sprite` 内容 | 同上，走资源包管线 |
| `DecompressionStream('deflate-raw')` 解 zip | 8265 | `java.util.zip.ZipInputStream` / `InflaterInputStream` | 浏览器原生解压 → JDK 原生 zip，反而更简单 |
| `localStorage` + `JSON.stringify(cfg)` | `saveCfg` 129 | `ModConfig` POJO + Gson 写 `FabricLoader.getInstance().getConfigDir().resolve("comet.json")` | 见 07 卷；注意 Gson 不写无参构造字段默认值的行为 |
| `cfg.states` / `cfg.settings` / `cfg.binds` / `cfg.favorites` | 106–127 | `Map<String, Boolean> states` / `Map<String, JsonElement> settings` / `Map<String, String> binds` / `Set<String> favorites` | 原样搬 4 个容器，key 命名保持 `"module.setting"` |
| `getS(mid, sid)` + `__sCache` | 806–819 | `ModConfig.get(mid, sid)` + 每帧缓存 | 脚本在 `onFrame` 开头 `__sCache = {}`、结尾置 null；Java 侧用 `tickDelta` 帧边界做一次快照，别每帧几百次查 Map |
| `modOn(id)` / `toggleModule(m)` | 826–831 | `ModuleRegistry.isEnabled(id)` / `.toggle(id)` | 开关变更要发通知 + 刷 GUI，等价于 `afterToggle`（834） |
| `cfg.binds` + `W.addEventListener('keydown', ..., true)` 捕获 | 11792–11835 | `KeyBindingHelper.registerKeyBinding` + `ClientTickEvents.END_CLIENT_TICK` 里 `wasPressed()` | 全局捕获阶段换成每帧轮询按键；模块键位表仍存 `binds` |
| `bindingModule` 按键中状态 / `keyName(code)` | 10456 / 10800 | Cloth Config 的 `KeyBinding` 控件 + `InputUtil.Key` 翻译名 | `keyName` 把 `ShiftLeft` 显示成 `LShift`，Java 侧 `InputUtil.Key.getTranslationKey()` 对应 |
| `GM_xmlhttpRequest` 跨域 / 来源伪装 | `installOriginSpoof` 40 | `java.net.http.HttpClient`（异步、切出渲染线程） | Java 没有同源策略，`Origin` / `Referer` 头想设就设；比浏览器侧简单得多 |
| B 站 Toy iframe / `@match` 多域 | 7–11 | 无对应概念 | 这是网页托管环境，不是客户端功能；移植时整体丢弃（08 卷详列） |
| Web Audio `AnalyserNode.getByteFrequencyData` | 3375–3389、3319 注释 | 无直接等价：自算 FFT / 播放进度驱动伪律动 | Java 版没有浏览器音频图；光环「音乐律动」用 `SoundManager` 音量或时间函数兜底，脚本自己也有伪律动兜底 |
| `document-start` 注入时机 | 12 | Mod 初始化期（早于 `ClientPlayConnectionEvents.JOIN`） | 需求自然满足，不用模拟 |
| 跨源头像 / 皮肤 `ETEX` data URI | `faceTexture` 4234 | `PlayerSkinTexture` / `SkinTextures` / `PlayerEntity.getSkinTextures()` | Java 版皮肤由会话与皮肤服务提供，网络细节由游戏管，不自己 fetch |
| `performance.now()` | 遍布 | `System.nanoTime()` / `Util.getMeasuringTimeMs()` / `tickDelta` | 动画计时统一到 `tickDelta`，避免两套时钟 |
| `devicePixelRatio` / `canvas.width = W * dpr` | ESP 画布 | `Window.getScaleFactor()` / `getScaledWidth()` / `getScaledHeight()` | DrawContext 已按 GUI scale 处理，别自己再乘 |

---

## 5. 移植优先级

按「先让用户看到东西、再补齐可玩性」排。视觉是这套脚本最核心的价值（用户强调「全部的特效系统」），所以 P0 全给视觉和 UI 骨架；玩法模块很多在 Java 服务端会不同步，排在最后且要标注限制（09 卷展开）。

### P0 · 视觉与地基（必须先做）

| 内容 | 涉及分卷 | 为什么排第一 |
|---|---|---|
| 工程骨架、`ModConfig` / `Module` / `ModuleRegistry`、Cloth Config 屏幕 | `README` / `07` | 其余所有模块都要读写配置，没有地基后面全是空指针 |
| 毛玻璃后处理管线（`RenderTarget` + 两趟高斯） | `04` / `08` | 主题、面板、动态模糊、辉光全依赖它，先验证管线再堆效果 |
| 光环 / 范围圈 / 几何图案 / 彩虹 / 粒子 / 频谱柱 / 拖影 | `02` | 视觉密度最高，`aura` 一个模块 18 个设置项，先啃硬的 |
| 启动开场动画 | `03` | 独立、无依赖，适合用来验证 shader / 动画时序 |
| 3D 线框封装（`RenderLayer.getLines()`） | `06` / `08` | ESP / Tracers / 方块追踪 / 光柱全用它 |

### P1 · HUD 与信息层

| 内容 | 涉及分卷 |
|---|---|
| Watermark / Info / ArrayList / 通知 | `06` |
| TargetHUD / 名字标签 / 世界血条 / 头像 | `05` |
| 雷达 / 罗盘 / 小地图 / 背包 / 掉落物汇总 | `06` |
| 所有 ESP 家族（生物 / 物品 / 容器 / 方块追踪 / 路径点） | `06` |
| 扩展 HUD（armorhud / potionhud / fpsgraph / crosshair / zoom / 各种统计面板） | `06` |

### P2 · 玩法模块与系统收尾

| 内容 | 涉及分卷 | 备注 |
|---|---|---|
| 移动类（AutoSprint / Fly / Speed / Step / AutoJump / Scaffold / NoFall） | `09` | 客户端改速度 / 飞行在真实服务端会被反作弊或服务端权威覆盖 |
| 世界 / 玩家类（FastBreak / InstantBreak / AutoEat / WaterBreath / AutoRespawn / Freecam） | `09` | 挖掘、伤害、进食都由服务端结算，标注客户端侧限制 |
| 渲染开关类（FullBright / NightVision / Ambience / MotionBlur / 准星） | `09` | FullBright 改 gamma / 亮度纹理，注意与 Sodium/Iris 的 Mixin 冲突 |
| 工具 / 配置类（XRay / 容器 ESP / 路径点 / 性能档 / 备份 / 主题 / 悬浮标签 / 资源包） | `07` / `08` / `09` | XRay 在 Java 版建议走资源包或直接框选，「材质透视」那套隐藏画布的做法没有对应物 |
| 逐条验收与风险对账 | `08` | 拿 08 的清单逐个勾「怎样算移植成功」 |

跨卷依赖记一下：`07` 的 `ModuleRegistry` 被 `02`–`06`、`09` 全部引用；`08` 的对照表覆盖全部 100 个模块；`04` 的模糊管线被 `02`（辉光）、`09`（动态模糊）复用。改公共接口前先看一圈，别只顾自己那一卷。

---

## 6. 一条给后面的提醒

脚本里大量 hook 是「替换 prototype 方法 + 保存 orig + try/finally 还原」（`ensureFlyHook` 1521 的 `creative` getter、`ensureCritHook` 1601 的 `g.attack`、`ensureFreecamHooks` 1423 的 `readInput` / `setCamera`）。这类「临时伪造状态、调完还原」的技巧，在 Fabric 里对应 Mixin 的 `@Inject` + 局部变量修改，或 `@ModifyVariable`；**不要**照搬成 `try/finally` 里改全局字段——Java 版是多线程 + 服务端权威，改了不还原会污染后续 tick。具体每个 hook 的目标类和方法签名在 `08`、`09` 两卷逐条给出。

读到这里就可以按阅读顺序往下走了。要查某个模块归哪一卷、某个网页概念换成什么 Java 东西，回来看 §2 和 §4 两张表。
