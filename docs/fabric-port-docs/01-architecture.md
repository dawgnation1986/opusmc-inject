# 卷一 · 整体架构：从单 IIFE userscript 到 Fabric Mod

## 这一卷对应什么

先把源头文件钉死，后面所有设计都从这里长出来。源文件 `opusmc-hud.user.js`（v1.31.0，12124 行）是一个 `(function(){ 'use strict'; ... })()` 单 IIFE，靠 `@run-at document-start` 抢在页面脚本之前执行，拿 `unsafeWindow` 摸到游戏挂的全局对象。这一卷读的是这些位置：

| JS 位置 | 函数 / 结构 | 干什么 |
| --- | --- | --- |
| 22-35 | IIFE 外壳、`W = unsafeWindow`、`__cometInstalled`、`VERSION` | 注入与防重复 |
| 100-131 | `CFG_KEY` / `cfg` / `saveCfg()` | 配置对象与持久化 |
| 285-293 | `CATS` | 分类侧栏数据源 |
| 295-779 | `MODULES` 主表 | 静态定义 50 个模块，每个带 `settings` |
| 781-803 | `MODS_BY_ID`、旧配置迁移 | 索引与默认值 |
| 1647 / 4855-4859 | `tickModules` / `extVal` / `extOn` | 每帧逻辑入口、扩展模块读配置 |
| 4653 / 5384 / 6128 / 6644 / 7171 / 7429 | 五组 `EXT_MODULES_*` + `about` | `MODULES.push` 动态再追加 50 个，运行时合计 **100 个** |
| 805-831 | `__sCache` / `getS` / `setS` / `modOn` / `toggleModule` | 设置读取、缓存失效、开关 |
| 833-850 | `afterToggle` / `afterSetting` | 模块副作用 |
| 925-987 | `fillText` 嗅探、`hookNightVision`、`hookRender` | 原型链挂钩、每帧驱动 |
| 989-1040 | `syncRefs` / `pollRef` | 800ms 轮询找游戏实例 |
| 1852-1860 / 2010-2040 | `project()` / `ringProject()` | 世界→屏幕投影、近平面裁剪 |
| 1878-1942 | `APPEARANCE_PRESETS` / `APPEARANCE_KEYS` / `applyAppearance` / `applyAppearancePreset` | 外观 8 参数与四档位 |
| 1943-1959 | `perfLevel` / `perfGlow` / `perfFx` | 性能分级 |
| 3100-3119 / 11715-11736 | `onFrame` / `startFallbackLoop` / 250ms 定时器 | 帧驱动与低频 HUD 更新 |
| 8385-8405 / 8644-8680 | `getImageData` / `texStorage3D` / `screen.widgets` 注入 | 资源包纹理替换、原版菜单塞按钮 |
| 9050-10154 | `css` 模板串（DOM 样式） | 面板 / HUD / 层级 |
| 10156-10254 | `mk()` / `gui` / `applyTheme` / `layoutPanel` | ClickGUI 骨架 |
| 11232-11270 | `hudStage.innerHTML` | HUD 元素 DOM |
| 11943-12123 | `playIntro` / `boot()` / `DOMContentLoaded` | 启动编排 |

要实现的效果：把这套「运行时往网页版 MC 里注入 HUD / ClickGUI / 特效」的体系，原样搬成 Java 版 1.21.1 的客户端 Mod。Java 侧对应概念是——注入点变成 `ClientModInitializer` 入口 + Mixin，DOM 容器变成 `DrawContext` 绘制层与自定义 `Screen`，`requestAnimationFrame` 变成 Fabric 渲染事件回调，`localStorage` 变成 Gson 落盘配置文件。

统一口径（全系列一致）：Minecraft Java 1.21.1 / Fabric Loader 0.16+ / Fabric API / Yarn mappings / Java 17。

---

## 1. 分层：一个 IIFE 拆成七层

网页里所有东西挤在一个闭包里，靠闭包变量共享状态（`cfg`、`state`、`MODULES`、`gui`、`hudStage` 全是顶层 `const`）。Java 没有闭包，也没必要有——按职责切包，用 `CometClient.INSTANCE` 或单例管理器暴露全局状态。

目录树按 Yarn 映射的常规布局排：

```
comet-client/
├── build.gradle
├── gradle.properties
├── settings.gradle
└── src/main/
    ├── java/com/bigpixel/comet/
    │   ├── CometClient.java              # implements ClientModInitializer，唯一入口
    │   ├── CometMod.java                 # 全局常量、状态引用（对应 IIFE 里的 state/VERSION）
    │   ├── config/
    │   │   ├── CometConfig.java          # Gson POJO，对应 cfg 字面量
    │   │   ├── ConfigManager.java        # load/save + __sCache 等价缓存
    │   │   ├── Theme.java                # DEFAULT / GLASS
    │   │   ├── PerfLevel.java            # 省电 / 均衡 / 绚丽
    │   │   ├── AppearancePreset.java     # 绚丽/平缓/基本 三组预设
    │   │   ├── Setting.java              # slider/checkbox/color/select/multi/text/button
    │   │   └── Vec2.java / Waypoint.java
    │   ├── module/
    │   │   ├── Module.java               # 基类，对应 MODULES 数组的单个元素
    │   │   ├── ModuleRegistry.java       # 对应 MODULES + MODS_BY_ID
    │   │   ├── Category.java             # 对应 CATS
    │   │   └── impl/                    # AuraModule / EspModule / HudModule / MinimapModule ... 共 100 个
    │   ├── render/
    │   │   ├── CometRenderEvents.java    # 注册全部渲染/ tick 事件
    │   │   ├── HudRenderer.java          # HudRenderCallback：水印/坐标/列表/通知/目标/罗盘
    │   │   ├── WorldFxRenderer.java      # WorldRenderEvents：光环/ESP/追踪线/抛物线
    │   │   ├── Projector.java            # 对应 project() / ringProject()
    │   │   ├── LineRenderer.java         # VertexConsumerProvider + RenderLayer.getLines()
    │   │   ├── glass/
    │   │   │   ├── GlassBlurRenderer.java      # 两趟可分离高斯（见卷四）
    │   │   │   └── MotionBlurRenderer.java    # 对应 updateMotionBlur
    │   │   └── shader/ShaderRegistry.java     # CoreShaderRegistrationCallback
    │   ├── gui/
    │   │   ├── ClickGuiScreen.java       # 对应 #__comet_panel，自定义 Screen
    │   │   ├── FloatPanelScreen.java     # 对应 .cm-float 悬浮分类面板
    │   │   ├── PanelRenderer.java        # drawBackground / drawPanel / drawModuleList
    │   │   ├── HudLayout.java            # 对应 hudPos / applyHudPos
    │   │   └── Notification.java         # 对应 .cm-notes
    │   ├── input/KeyBindings.java        # KeyBindingHelper，对应 onKeyDown
    │   └── mixin/
    │       ├── GameRendererMixin.java
    │       ├── ScreenMixin.java
    │       ├── TextRendererMixin.java
    │       ├── LightmapTextureManagerMixin.java
    │       └── MouseMixin.java
    └── resources/
        ├── fabric.mod.json
        ├── comet-client.mixins.json
        └── assets/comet-client/shaders/core/
            ├── blur.json
            ├── blur.vsh
            ├── blur_h.fsh
            ├── blur_v.fsh
            └── composite.fsh
```

`fabric.mod.json` 把入口和 mixin 配置挂上去。注意 `environment: "client"`——源脚本全是 HUD / 渲染 / 客户端按键，没有一行服务端逻辑，装到服务端毫无意义：

```json
{
  "schemaVersion": 1,
  "id": "comet-client",
  "version": "1.31.0",
  "name": "Comet Client (Fabric Port)",
  "description": "OpusMC 彗星客户端 HUD / ClickGUI / 特效系统的 Fabric 移植",
  "authors": ["BigPixel"],
  "environment": "client",
  "entrypoints": {
    "client": [
      "com.bigpixel.comet.CometClient"
    ]
  },
  "mixins": [
    "comet-client.mixins.json"
  ],
  "depends": {
    "fabricloader": ">=0.16.0",
    "minecraft": "~1.21.1",
    "java": ">=17",
    "fabric-api": "*"
  }
}
```

这里给的是最小骨架，只声明 `entrypoints.client`（`com.bigpixel.comet.CometClient`），没有 `modmenu` 入口——对应 README §3.2 注明的「不接 ModMenu 就删掉 `entrypoints.modmenu` + `suggests`」那种选择，不留悬空类。要接就补 `"modmenu": ["com.bigpixel.comet.config.CometModMenu"]` 并在 `suggests` 里加 `modmenu` / `cloth-config`，入口实现调 07 卷 §6.4 的 `ConfigScreen.create(Screen)`。README §3.2 那份是含可选入口的完整版，两者只是选择不同，没有冲突。

Mixin 清单单独一个文件，client 分类下的类只会在客户端加载：

```json
{
  "required": true,
  "minVersion": "0.8",
  "package": "com.bigpixel.comet.mixin",
  "compatibilityLevel": "JAVA_17",
  "client": [
    "GameRendererMixin",
    "ScreenMixin",
    "TextRendererMixin",
    "LightmapTextureManagerMixin",
    "MouseMixin"
  ],
  "injectors": {
    "defaultRequire": 1
  }
}
```

`build.gradle` 用 Loom 1.7（对应 1.21.1），版本号集中在 `gradle.properties`：

```gradle
plugins {
    id 'fabric-loom' version '1.7-SNAPSHOT'
    id 'maven-publish'
}

version = project.mod_version
group = project.maven_group
base { archivesName = project.archives_base_name }

repositories {
    maven { url 'https://maven.fabricmc.net/' }
    maven { url 'https://maven.shedaniel.me/' }               // Cloth Config，07 卷配置屏幕用
    maven { url 'https://maven.terraformersmc.com/releases/' } // ModMenu，可选
    mavenCentral()
}

dependencies {
    minecraft "com.mojang:minecraft:${project.minecraft_version}"
    mappings "net.fabricmc:yarn:${project.yarn_mappings}:v2"
    modImplementation "net.fabricmc:fabric-loader:${project.loader_version}"
    modImplementation "net.fabricmc.fabric-api:fabric-api:${project.fabric_version}"
    // 全队配置 GUI 口径：Cloth Config（07 卷 §6.4 ConfigScreen）+ Gson 落盘
    modApi "me.shedaniel.cloth:cloth-config-fabric:${project.cloth_config_version}"
    // ModMenu 只在接了 entrypoints.modmenu 时才需要；本卷 fabric.mod.json 是「不接」那版，
    // 所以这行默认注释。要接就放开它，并在 fabric.mod.json 补 entrypoints.modmenu + suggests：
    // modImplementation "com.terraformersmc:modmenu:${project.modmenu_version}"
}

processResources {
    inputs.property "version", project.version
    filesMatching("fabric.mod.json") {
        expand "version": project.version
    }
}

tasks.withType(JavaCompile).configureEach {
    it.options.release = 17
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
    withSourcesJar()
}
```

```properties
# gradle.properties
org.gradle.jvmargs=-Xmx2G
minecraft_version=1.21.1
yarn_mappings=1.21.1+build.68
loader_version=0.16.5
fabric_version=0.104.0+1.21.1
cloth_config_version=15.0.140
# 接 ModMenu 时才放开（本卷 fabric.mod.json 是「不接」那版）
# modmenu_version=11.0.3
mod_version=1.31.0
maven_group=com.bigpixel
archives_base_name=comet-client
```

`cloth_config_version` / `modmenu_version` 是占位，1.21.1 对应的实际版本以各自 maven 发布为准（README §3.4 也是这么注的），别照抄这里的数字。Gson 不用单独引——Fabric Loader 自带，直接 `import com.google.gson.*` 即可。

入口类只做一件事：按顺序把配置、模块、事件、按键、Mixin 副作用全注册好。对应 `boot()`（12060-12117）那一长串 `appendChild` + `applyXxx` + `pollRef(0)`：

```java
package com.bigpixel.comet;

import com.bigpixel.comet.config.ConfigManager;
import com.bigpixel.comet.module.ModuleRegistry;
import com.bigpixel.comet.render.CometRenderEvents;
import com.bigpixel.comet.render.shader.ShaderRegistry;
import com.bigpixel.comet.input.KeyBindings;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;

public final class CometClient implements ClientModInitializer {

    public static final String MOD_ID = "comet-client";
    private static CometClient INSTANCE;

    public static CometClient getInstance() { return INSTANCE; }

    @Override
    public void onInitializeClient() {
        INSTANCE = this;

        // 1. 配置先起来：模块默认值、getS 缓存都依赖它
        ConfigManager.load();

        // 2. 注册表：把 MODULES 数组实例化成 Module 对象，填 states 默认值
        ModuleRegistry.bootstrap();

        // 3. 着色器要在第一次渲染前注册（CoreShaderRegistrationCallback 由 Fabric 提前触发）
        ShaderRegistry.register();

        // 4. 渲染 / tick / 按键事件
        CometRenderEvents.register();
        KeyBindings.register();

        // 5. 进服时重挂引用（对应 syncRefs 里「切换世界重建 Player」的注释）
        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> {
            ModuleRegistry.onWorldJoin(client);
            ConfigManager.invalidateCache();
        });
    }
}
```

网页里 `document.readyState === 'loading'` 时挂 `DOMContentLoaded`、否则直接 `boot()`（12119-12123），这段判断在 Fabric 里根本不需要——`ClientModInitializer` 就是框架约定的「客户端初始化完成」时机，比 DOMContentLoaded 还早、还确定。`isWrapperPage()` 那套 iframe 判断也直接删掉，Java 版没有外层壳页面。

**一份命名上的账，先摊开说。** 这一卷是「架构骨架」，按要求给了完整的 `CometConfig` / `ConfigManager` / `Module` / `ModuleRegistry` / `CometClient` 可落地代码；而 07 卷《配置与模块系统》是明确定位的地基卷，用的是 `ModConfig` / `Module` / `ModuleRegistry` / `CometTick` / `SettingSpec`，并写了「02–06、09 卷都要 import 这里」。两边类名不一样，而且都各自给了一份实现——照抄会变成两套并存。落地时**统一以 07 卷命名为基准**，本卷按下面这张表折算，不要复制两份：

| 职责 | 01 卷（本卷骨架用名） | 07 卷（地基，落地基准） | 折算方式 |
| --- | --- | --- | --- |
| 配置 POJO | `CometConfig` | `ModConfig` | 直接改名，字段表搬过去 |
| 配置读写 / 帧缓存 | `ConfigManager`（独立类） | `ModConfig` 自带 `load/save/beginFrame/endFrame/get` | 把 `ConfigManager` 的静态方法折进 `ModConfig`，不保留第二个类 |
| 模块基类 | `Module` | `Module` | 同名，取 07 卷的 `get(sid)` 走 `ModConfig.get(...)` 版本 |
| 注册表 | `ModuleRegistry`（分组注册 + `selfTest`） | `ModuleRegistry`（`sortedModules` / 子分类 / `selfTest`） | 取 07 卷为准，把本卷第 4 节的六个 `registerXxx()` 分组注册并进 07 卷 1160 行附近那句占位注释；`ready` 不另起一套初始化，落在 07 卷 `finish()`（1044 行，已做 `states.putIfAbsent` + `selfTest()`）之后置位 |
| 设置描述 | `Setting<T>`（7 个子类） | `SettingSpec` | 取 07 卷，本卷 7 种 type 的子类结构等价 |
| 每帧逻辑分发 | `CometRenderEvents` 里 `END_CLIENT_TICK` 注册 | `CometTick.onEndTick` | tick 分发收敛到 `CometTick`；事件注册代码本身仍可用 |
| 入口 | `CometClient implements ClientModInitializer` | 07 卷未定义入口 | 保留 `CometClient`，不与 07 冲突 |
| 渲染分层 | `HudRenderer` / `WorldFxRenderer` / `Projector` | 07 卷不涉及 | 本卷自有，无需折算 |
| 毛玻璃 | `GlassBlurRenderer` / `GlassParams`（04 卷） | 07 卷不涉及 | 本卷自有 |

本卷保留自己那套命名，是因为骨架卷要自洽地讲清「分层 → 事件 → 配置 → 注册表」这条链，代码得能独立读；但**它不应该被当成第二份实现**。把边界划清楚，免得有人照着抄出两套：

- **不进工程、只用来读结构**：本卷的 `CometConfig` / `ConfigManager` / `Setting<T>` / `Module` / `ModuleRegistry` 五个代码块。工程里直接 import 07 卷的 `ModConfig` / `SettingSpec` / `Module` / `ModuleRegistry`。特别说明：`CometConfig`（POJO）和 `ConfigManager`（管理器）若机械改名成同一个 `ModConfig`，会撞出两个类定义，代码根本编译不了；07 卷已经把两者合一，没必要再搬一份。正文里那些 `ConfigManager.*` / `CometConfig` 调用点（入口、模块 `get()`、帧缓存、`setS` 等）读的时候按上表折算即可，不必逐行替换。
- **本卷独有、可直接进工程**：`Projector`（世界→屏幕投影）、`CometRenderEvents`（事件注册）、五个 Mixin、`PerfLevel` / `Theme` / `AppearancePreset`，以及 04 卷的 `GlassBlurRenderer` / `MotionBlurRenderer` / `GlassParams` / `ClickGuiScreen`。这些 07 卷不涉及。
- **入口顺序**：README §3.5 定的是 `ModConfig.load()` → `ModuleRegistry.bootstrap()` → `KeyBindings.register()` → 事件注册 → `JOIN` / `AttackEntityCallback`。本卷 `CometClient` 多一步 `ShaderRegistry.register()`（毛玻璃 shader 必须在首次渲染前注册），排在 `bootstrap()` 之后、事件注册之前，不冲突。
- **fabric.mod.json / build.gradle**：本卷给的是最小骨架，只有 `entrypoints.client`，没有 `modmenu` 入口——正好对应 README §3.2 注明的「不接 ModMenu 就删掉 `entrypoints.modmenu` + `suggests`」那种选择，不留悬空类。若决定接 ModMenu，入口类名/包名对齐 `com.bigpixel.comet.config.CometModMenu`，`getModConfigScreenFactory()` 调 07 卷 §6.4 的 `ConfigScreen.create(Screen)`；Cloth Config 的 maven 仓库与 `modApi` 依赖已按 README §3.4 补进本卷 build.gradle，ModMenu 依赖则以注释形式留着，接时放开。
- **配置 GUI 用 Cloth Config**：全队口径（README §3.4、07 卷 §6.4）是 Gson 落盘 + Cloth Config 界面。04 卷那个自绘 `ClickGuiScreen` 只管毛玻璃 ClickGUI（模块开关列表），因为 Cloth Config 的控件画不出 `backdrop-filter`；配置管理、帮助中心、备份这些屏幕仍走 Cloth Config。两者是不同的 `Screen`，不矛盾，第 5 节的配置库选型已按这个边界写明。

09 卷目前用的是 `OpusConfig` / `OpusHudClient` / `GameplayTicker`，和 07 卷这套也对不上，且含用户明确排除的 Aura 攻击逻辑——这卷已被报给 team-lead 裁决，本卷不引用它任何类名，等裁决结果再定。若全队最终换了标准，01/07 一起跟着调，不用单改这一卷。

---

## 2. 渲染循环：三条时间线对上三类事件

源脚本其实有三条互相独立的驱动线，别混成一条：

- **每帧**：`hookRender()`（958-987）改 `G.prototype.render`，在原版 render 之后调 `onFrame(a)`；挂不上就退到 `startFallbackLoop()` 的 `requestAnimationFrame`（3114-3119）。`onFrame` 里跑 `tickModules()`、`espFrame()`、`updateMotionBlur()`（3101-3111），且每帧开头 `__sCache = {}`、结尾 `__sCache = null`。
- **每 250ms**：一个 `setInterval` 合并刷新 `updateHud / updateInventory / drawMinimap / updateDrops / extHudX / rpMenuTick`（11725-11736）。注释写得很直白：四个 HUD 更新合并到一个定时器，少 3 个回调与 3 次重复布局。
- **每 400ms / 2000ms**：通知过期清理（2600ms 生命周期）、mc18 状态轮询。

Java 侧不需要自己 rAF，Fabric 事件已经按帧切好了。映射关系：

| JS 驱动 | 频率 | Java 事件 | 用途 |
| --- | --- | --- | --- |
| `hookRender` → `onFrame` 的 `tickModules()` | 每帧（逻辑） | `ClientTickEvents.END_CLIENT_TICK` | 模块逻辑：Aura 找目标、AutoSprint 写状态、飞行、自动进食 |
| `espFrame()` 世界内 2D/3D 覆盖 | 每帧（渲染） | `WorldRenderEvents.AFTER_ENTITIES` / `END_MAIN` | 光环、ESP 框、追踪线、投掷物抛物线 |
| HUD DOM 更新 | 每帧绘制、250ms 刷数据 | `HudRenderCallback.EVENT` | 水印 / 坐标 / 列表 / 通知 / 目标 HUD / 罗盘 / 雷达 |
| `startFallbackLoop` | rAF | 不需要 | 框架保证每帧回调 |
| 250ms `setInterval` | 低频 | `ClientTickEvents.END_CLIENT_TICK` 里用计数器 | 攒够 N tick 再刷一次数据 |
| `performance.now()` | 平滑动画 | `tickCounter.getTickDelta(true)` / `System.nanoTime()` | 旋转、脉冲、呼吸动画相位 |

注册代码集中放在 `CometRenderEvents`，一眼能看出哪条线对应哪个回调：

```java
package com.bigpixel.comet.render;

import com.bigpixel.comet.config.ConfigManager;
import com.bigpixel.comet.module.ModuleRegistry;
import net.fabricmc.fabric.api.client.event.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderEvents;
import net.minecraft.client.MinecraftClient;

public final class CometRenderEvents {

    private static int hudDataTick = 0;   // 对应 250ms 定时器：20 tick ≈ 1s，攒 5 tick 刷一次

    public static void register() {
        // ---- 逻辑帧：对应 onFrame() 里的 tickModules() ----
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            // 每帧开头重置设置缓存，对应 onFrame 的 __sCache = {}
            ConfigManager.beginFrame();
            try {
                ModuleRegistry.tick(client);

                // 250ms 合并刷新：HUD 数据不必每帧重算，但绘制仍每帧发生
                if (++hudDataTick >= 5) {
                    hudDataTick = 0;
                    ModuleRegistry.refreshHudData(client);
                }
            } finally {
                // 对应 onFrame 的 finally { __sCache = null }
                ConfigManager.endFrame();
            }
        });

        // ---- 世界渲染：对应 espFrame()，在实体之后画覆盖物 ----
        WorldRenderEvents.AFTER_ENTITIES.register(ctx -> {
            // ctx.matrixStack() / camera() / tickCounter() / world() / consumers()
            ModuleRegistry.onWorldRender(ctx);
            WorldFxRenderer.render(ctx);
        });

        // END_MAIN 用来做全屏后处理（运动模糊合成），此时主场景已进 framebuffer
        WorldRenderEvents.END_MAIN.register(ctx -> {
            MotionBlurRenderer.compositeIfNeeded(ctx);
        });

        // ---- HUD：对应 hudStage 那一堆 DOM ----
        // 1.21.1 / Fabric API 0.104 的回调是 (DrawContext, RenderTickCounter)，
        // tickDelta 从 getTickDelta(true) 取；旧教程里的 (DrawContext, float) 已不适用。
        HudRenderCallback.EVENT.register((drawContext, tickCounter) -> {
            HudRenderer.render(drawContext, tickCounter.getTickDelta(true));
        });
    }
}
```

`HudRenderCallback` 的回调签名按 Fabric API 版本会变：1.21.1 配 `fabric_version=0.104.0+1.21.1` 是 `(DrawContext, RenderTickCounter)`，插值系数走 `tickCounter.getTickDelta(true)`；老教程里常见的 `(DrawContext, float tickDelta)` 是早期 API，别照抄。全系列其他卷如果写成 `var tickCounter` 或 `(DrawContext ctx, RenderTickCounter t)`，和这里是同一个东西。

`WorldRenderContext` 里能拿到的东西正好覆盖 `espFrame` 需要的全部输入：`matrixStack()` 对应 3D 变换栈，`camera()` 对应 `r.camPos` 与 yaw/pitch，`tickCounter()` 对应源脚本里那个 `alpha`（2438-2440 行从 `g.pauseA / g.acc` 兜底算出来的插值系数）。源脚本 `alpha` 是为了在固定步长逻辑和可变帧率渲染之间插值，Java 里 `tickCounter.getTickDelta(true)` 直接就是它，不用自己兜底。

---

## 3. 三套坐标系：别把像素搞混

这是整份移植里最容易翻车的地方。源脚本同时用了三套坐标，混用就会「面板位置对、光环位置飘、线宽忽粗忽细」。

**GUI 像素。** `#__comet_stage` 和 `#__comet_hudstage` 都是 `width:50vw; height:50vh; transform:scale(2)`（9061-9064、9285-9289），也就是 DOM 里所有 `left/top/width/height` 都按「屏幕一半」写：面板 400×250 实际占 800×500 物理像素区域，`.cm-side` 的 `left:7.5px` 实际是 15 CSS px。游戏自己的 `ui.w / ui.h`（8694、8835 行）又是另一套逻辑分辨率，塞原版按钮时按它算居中。Java 侧没有 CSS scale，统一用 `Window.getScaledWidth()/getScaledHeight()` 这套「GUI 像素」，`DrawContext` 的所有坐标都是它。源脚本里那个 ×2 的 stage 在 Java 里不该复刻——它是为了绕开网页版 `#ui` 画布本身的 0.5 缩放，Minecraft 的 GUI scale 已经由 `Window` 处理好了。

**屏幕像素 / 物理像素。** 开场动画 canvas 按 `innerWidth * dpr` 开尺寸（11965-11968），`espCanvas` 直接对齐 `glCv.width/height`（2444-2447）。`dpr` 被 `Math.min(devicePixelRatio, 2)` 夹住。Java 侧对应 `Window.getFramebufferWidth()/getFramebufferHeight()`，做全屏 framebuffer、shader 采样步长时用它；`DrawContext` 那套是 scaled，两者差一个 `window.getScaleFactor()`。

**世界坐标。** `renderer.vp` 是列主序的 view×projection 矩阵，`project()`（1853-1860）拿它把 `[x,y,z]` 变屏幕点：

```js
function project(v, x, y, z, w_, h_) {
  const m = v.vp;
  const cw = m[3]*x + m[7]*y + m[11]*z + m[15];   // 列主序：第 4 行
  if (cw <= 0.1) return null;                        // 近平面外直接丢
  const cx = m[0]*x + m[4]*y + m[8]*z + m[12];
  const cy = m[1]*x + m[5]*y + m[9]*z + m[13];
  return { x:(cx/cw*.5+.5)*w_, y:(1-(cy/cw*.5+.5))*h_ };
}
```

`ringProject()`（2012-2040）多干了一件事：相机后方的圆环点不丢，沿相邻可见点插值压到 `cw=EPS` 的近平面上，保证 3D 圆环在第三人称 / 大俯仰角下闭合。这个「近平面裁剪」算法可以 1:1 搬，下面 Java 版连插值都照抄。

Java 侧不用去凑一个 `vp` 数组——`WorldRenderContext` 给的是分开的 `projectionMatrix()` 和 `camera()`。按 vanilla `GameRenderer#renderWorld` 的构造方式（`RX(pitch) · RY(yaw+180)`）自己搭 view 旋转，避开 `Camera#getRotation()` 四元数在不同映射版本里的符号约定差异。`Projector` 完整实现：

```java
package com.bigpixel.comet.render;

import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.Camera;
import net.minecraft.client.util.Window;
import net.minecraft.util.math.Vec3d;
import org.joml.Matrix4f;
import org.joml.Vector4f;
import org.joml.Vector2f;

import java.util.ArrayList;
import java.util.List;

/**
 * 对应 JS 的 project() / ringProject()。
 * JS 里 v.vp = projection * view（列主序），Java 里从 Camera + projectionMatrix 现场组装。
 */
public final class Projector {
    private Projector() {}

    /** 世界坐标 → 屏幕 GUI 像素（scaled）。相机后方/近平面外返回 null。 */
    public static Vector2f project(Vec3d world, Camera camera, Matrix4f projection,
                                   int scaledW, int scaledH) {
        Vector4f clip = clipSpace(world, camera, projection);
        if (clip == null) return null;
        float ndcX = clip.x / clip.w;
        float ndcY = clip.y / clip.w;
        return new Vector2f(
                (ndcX * 0.5f + 0.5f) * scaledW,
                (1.0f - (ndcY * 0.5f + 0.5f)) * scaledH);   // 屏幕 Y 向下，对应 JS 的 1-(...)
    }

    /** 只算 clip space，ringProject 的近平面裁剪要直接用它。 */
    public static Vector4f clipSpace(Vec3d world, Camera camera, Matrix4f projection) {
        Vec3d cam = camera.getPos();
        // 平移到相机原点
        float rx = (float) (world.x - cam.x);
        float ry = (float) (world.y - cam.y);
        float rz = (float) (world.z - cam.z);

        // 与 GameRenderer#renderWorld 一致：RX(pitch) · RY(yaw+180)
        Matrix4f view = new Matrix4f()
                .rotateX((float) Math.toRadians(camera.getPitch()))
                .rotateY((float) Math.toRadians(camera.getYaw() + 180.0f));

        Vector4f v = view.transform(new Vector4f(rx, ry, rz, 1.0f));
        return projection.transform(v);   // 就地乘，返回同一个 Vector4f
    }

    private static final float EPS = 0.08f;   // 对应 JS ringProject 的 EPS

    /**
     * 对应 ringProject()：把落在近平面外（w<=EPS）的环点沿相邻可见点插值压回近平面，
     * 保证闭合圆环不残缺。输入是世界坐标折线，输出屏幕折线，可能含 null。
     */
    public static List<Vector2f> projectRing(List<Vec3d> ring, Camera camera, Matrix4f projection,
                                             int scaledW, int scaledH, boolean closed) {
        int n = ring.size();
        Vector4f[] raw = new Vector4f[n];
        for (int i = 0; i < n; i++) raw[i] = clipSpace(ring.get(i), camera, projection);

        List<Vector2f> out = new ArrayList<>(n + 1);
        for (int i = 0; i < n; i++) {
            Vector4f a = raw[i];
            if (a.w > EPS) {
                out.add(toScreen(a, scaledW, scaledH));
                continue;
            }
            Vector4f prev = null, next = null;
            for (int s = 1; s < n && (prev == null || next == null); s++) {
                if (prev == null) {
                    Vector4f p = raw[(i - s + n) % n];
                    if (p.w > EPS) prev = p;
                }
                if (next == null) {
                    Vector4f p = raw[(i + s) % n];
                    if (p.w > EPS) next = p;
                }
            }
            if (prev == null || next == null) { out.add(null); continue; }

            Vector4f ia = crossNear(prev, a);
            Vector4f ib = crossNear(next, a);
            Vector4f mid = new Vector4f(
                    (ia.x + ib.x) * 0.5f,
                    (ia.y + ib.y) * 0.5f,
                    (ia.z + ib.z) * 0.5f,
                    EPS);
            out.add(toScreen(mid, scaledW, scaledH));
        }
        if (closed) out.add(out.isEmpty() ? null : out.get(0));
        return out;
    }

    private static Vector4f crossNear(Vector4f p, Vector4f a) {
        float t = (EPS - p.w) / (a.w - p.w);   // 注意 JS 里变量命名反了，语义是「从 p 走向 a」
        return new Vector4f(
                p.x + (a.x - p.x) * t,
                p.y + (a.y - p.y) * t,
                p.z + (a.z - p.z) * t,
                EPS);
    }

    private static Vector2f toScreen(Vector4f c, int w, int h) {
        float ndcX = c.x / c.w, ndcY = c.y / c.w;
        return new Vector2f((ndcX * 0.5f + 0.5f) * w,
                            (1.0f - (ndcY * 0.5f + 0.5f)) * h);
    }

    /** 在 WorldRenderEvents 回调里拿齐三件套的便捷入口。 */
    public static Frame currentFrame(WorldRenderContext ctx) {
        MinecraftClient mc = MinecraftClient.getInstance();
        Window win = mc.getWindow();
        return new Frame(
                ctx.camera(),
                new Matrix4f(ctx.projectionMatrix()),
                win.getScaledWidth(), win.getScaledHeight(),
                win.getFramebufferWidth(), win.getFramebufferHeight());
    }

    public record Frame(Camera camera, Matrix4f projection,
                        int scaledW, int scaledH,
                        int fbW, int fbH) {}
}
```

如果锁定的 Fabric 版本里 `WorldRenderContext` 没有 `projectionMatrix()`（老版本要从 `RenderSystem.getProjectionMatrix()` 取），把这一行换掉即可，其余不变。实际调用长这样：

```java
public static void render(WorldRenderContext wrc) {
    Camera camera = wrc.camera();
    Matrix4f projection = new Matrix4f(wrc.projectionMatrix());
    int sw = MinecraftClient.getInstance().getWindow().getScaledWidth();
    int sh = MinecraftClient.getInstance().getWindow().getScaledHeight();

    Vec3d ringCenter = /* 玩家脚下，带 tickDelta 插值 */;
    List<Vec3d> ring = AuraGeometry.buildRing(ringCenter, radius, 64);
    List<Vector2f> screenPts = Projector.projectRing(ring, camera, projection, sw, sh, true);
    // screenPts 交给 LineRenderer 或 DrawContext 画
}
```

三套坐标的换算口诀，写在这里免得后面几卷各写各的：

- `DrawContext` 坐标 = scaled = `Window.getScaledWidth/Height()`。
- framebuffer / shader texel = `Window.getFramebufferWidth/Height()` = scaled × `getScaleFactor()`。
- 世界→屏幕必须先减 `camera.getPos()` 再乘 view·projection，最后 NDC→scaled。
- 源脚本 `w_` / `h_` 传的是 `espCanvas.width/height`（= glCv 物理尺寸），所以 JS 里投影结果其实是**物理像素**；Java 里若要和 `DrawContext` 混画，统一换算到 scaled，别一半 scaled 一半物理。

---

## 4. 模块注册表：MODULES 数组变成 Module 类

先纠正一个容易看漏的事实：`MODULES` 不是一个写完就封口的常量表，而是**运行时拼装出来的，最终 100 个模块**。主表在 295-779 静态定义 50 个，之后五组 `EXT_MODULES`（`EXT_MODULES` 4653 / `_B` 5384 / `_C` 6128 / `_D` 6644 / `_E` 7171）各自用 `for (const em of EXT_MODULES_X) { MODULES.push(em); MODS_BY_ID[em.id] = em; }` 往同一个数组里追加（10 / 10 / 11 / 12 / 6 个），最后 7423-7430 再补一个 `about` 模块。50 + 10 + 10 + 11 + 12 + 6 + 1 = 100。

这个结构对移植有两层含义，别按「一张 50 行的表」来设计：

- **单一索引 `MODS_BY_ID`**。781-782 行主表建一次，五组 EXT 追加时每 push 一个就同步写一次索引（4743 / 5479 / 6217 / 6741 / 7221），`about` 也单独 `MODS_BY_ID.about = about`（7430）。所以 `getS(mid, sid)`、`refreshGui()`、帮助中心自检（6976 行 `if (MODS_BY_ID[m.id] !== m) problems.push('索引未同步')`）全靠这一张索引表，不存在「主表模块」和「扩展模块」的区别。Java 里 `ModuleRegistry.bootstrap()` 必须把 100 个全部 `register` 完再对外提供查询，任何中途查询都会看到半张表。
- **扩展模块复用同一套配置与开关**。4855-4859 行 `extVal(key, def)` 就是 `getS(key.split('.')[0], key.split('.')[1])` 加个默认值兜底，`extOn(id)` 直接 `return modOn(id)`。也就是说 EXT 模块的开关在 `cfg.states`、设置值在 `cfg.settings`，键名同样是 `mid.sid`，没有第二套存储。Java 里不必为 EXT 模块另建 `ExtModule` 基类，全部走同一个 `Module` + `ConfigManager`。

`MODULES` 元素是纯数据：`id / name / cn / cat / desc`，可选 `state`（默认开关），可选 `settings` 数组。`settings` 条目有 `id / name / cn / type / value`，以及 slider 的 `min/max/step`、select 的 `options`、checkbox 的 `desc`，个别 `value` 是函数（728、738 行的 `() => ...`，运行时从 cfg 取）。`CATS`（286-293）给分类侧栏用。全文件 `state: true` 只有三个：`nametags`（455）、`hud`（491）、`floatgui`（773），五组 EXT 里一个默认开都没有；783 行 `for (const m of MODULES) if (cfg.states[m.id] === undefined) cfg.states[m.id] = !!m.state;` 把默认值灌进配置——注意这句在主表定义后、EXT 追加前执行，所以 EXT 模块的默认状态是靠各自 push 后的兜底（比如 `about` 在 7431 行单独 `if (cfg.states.about === undefined) cfg.states.about = false`），不是靠 783 行那次循环。Java 里用 `putIfAbsent` 在每次 `register` 时就补默认值，比这个时序更省心。

每帧链的源头也标一下：`hookRender()`（965-970）替换游戏构造器 `prototype.render`，在原版 render 之后调 `onFrame(a)`；`onFrame`（3101-3111）先 `syncRefs()` 再依次跑 `tickModules()`（1647）、`espFrame()`、`updateMotionBlur()`。`tickModules` 是 100 个模块逻辑的总入口，进去先 `syncRefs()`、再挡掉 boot/title/loading/menu/pause 这类非游玩状态，然后才是各模块分支。Java 里对应 `ClientTickEvents.END_CLIENT_TICK → ModuleRegistry.tick()` 遍历全部 `Module.onTick()`，非游玩状态由 `client.world == null || client.player == null` 天然挡掉，不用抄那串字符串状态判断。

这套「数据即注册表」的设计很适合直接映射成 Java 的基类 + 注册表。

`Setting<T>` 覆盖 7 种 type：

```java
package com.bigpixel.comet.config;

import java.util.List;
import java.util.function.Supplier;

/** 对应 MODULES[].settings[] 的一个条目。value 为函数时对应 JS 里 () => cfg.xxx。 */
public abstract class Setting<T> {
    public final String id, name, cn;
    public final String desc;
    protected T value;
    protected final Supplier<T> dynamic;   // JS 的 value: () => ...

    protected Setting(String id, String name, String cn, String desc, T value, Supplier<T> dynamic) {
        this.id = id; this.name = name; this.cn = cn; this.desc = desc;
        this.value = value; this.dynamic = dynamic;
    }

    public T get() { return dynamic != null ? dynamic.get() : value; }
    public void set(T v) { this.dynamic = null; this.value = v; }
    public abstract String type();

    public static final class Slider extends Setting<Float> {
        public final float min, max, step;
        public Slider(String id, String n, String cn, String d,
                      float min, float max, float step, float def) {
            super(id, n, cn, d, def, null);
            this.min = min; this.max = max; this.step = step;
        }
        public String type() { return "slider"; }
    }
    public static final class Checkbox extends Setting<Boolean> {
        public Checkbox(String id, String n, String cn, String d, boolean def) {
            super(id, n, cn, d, def, null);
        }
        public String type() { return "checkbox"; }
    }
    public static final class Color extends Setting<String> {
        public Color(String id, String n, String cn, String d, String def) {
            super(id, n, cn, d, def, null);
        }
        public String type() { return "color"; }
    }
    public static final class Select extends Setting<String> {
        public final List<String> options;
        public Select(String id, String n, String cn, String d, String def, List<String> opts) {
            super(id, n, cn, d, def, null); this.options = opts;
        }
        public String type() { return "select"; }
    }
    public static final class Multi extends Setting<List<String>> {
        public final List<String> options;
        public Multi(String id, String n, String cn, String d, List<String> opts) {
            super(id, n, cn, d, List.of(), null); this.options = opts;
        }
        public String type() { return "multi"; }
    }
    public static final class Text extends Setting<String> {
        public final String placeholder;
        public Text(String id, String n, String cn, String d, String def, String ph) {
            super(id, n, cn, d, def, null); this.placeholder = ph;
        }
        public String type() { return "text"; }
    }
    public static final class Button extends Setting<Void> {
        public Runnable onClick;
        public Button(String id, String n, String cn, String d) {
            super(id, n, cn, d, null, null);
        }
        public String type() { return "button"; }
    }
}
```

`Module` 基类。注意源脚本的模块逻辑是「散在各处的 `if (modOn('xxx'))`」——`onFrame` 里 `tickModules()` 逐个判断、渲染函数里也逐个判断；Java 里收成 `onTick / onWorldRender / onHud` 三个钩子，开关判断由注册表统一做，模块自己只写启用时的行为：

```java
package com.bigpixel.comet.module;

import com.bigpixel.comet.config.ConfigManager;
import com.bigpixel.comet.config.Setting;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public abstract class Module {

    public final String id, name, cn, cat, desc;
    public final boolean stateByDefault;
    private final List<Setting<?>> settings = new ArrayList<>();
    private final Map<String, Setting<?>> byId = new LinkedHashMap<>();

    protected Module(String id, String name, String cn, String cat, String desc) {
        this(id, name, cn, cat, desc, false);
    }
    protected Module(String id, String name, String cn, String cat, String desc, boolean stateByDefault) {
        this.id = id; this.name = name; this.cn = cn; this.cat = cat; this.desc = desc;
        this.stateByDefault = stateByDefault;
    }

    protected <S extends Setting<?>> S add(S s) {
        settings.add(s); byId.put(s.id, s); return s;
    }
    public List<Setting<?>> settings() { return settings; }

    @SuppressWarnings("unchecked")
    public <T> T get(String sid) {
        Setting<?> s = byId.get(sid);
        if (s == null) return null;
        return (T) ConfigManager.getS(id, sid, s.get());   // 配置覆盖，取不到用定义默认值
    }

    public boolean on() { return ConfigManager.modOn(id, stateByDefault); }

    // ---- 生命周期钩子，对应 afterToggle / afterSetting 的副作用 ----
    public void onEnable(MinecraftClient c) {}
    public void onDisable(MinecraftClient c) {}
    public void onSettingChanged(String sid) {}

    // ---- 三个渲染/逻辑入口，注册表统一按 on() 过滤后调用 ----
    public void onTick(MinecraftClient c) {}
    public void onWorldRender(WorldRenderContext ctx) {}
    public void onHud(DrawContext dc, float tickDelta) {}
    public void refreshHudData(MinecraftClient c) {}   // 对应 250ms 那批更新
}
```

`ModuleRegistry` 把 `CATS` + `MODULES` + `MODS_BY_ID` + 默认值灌入 + `toggleModule` 全收进来。JS 是「主表 50 个 + 五组 EXT 动态 push + about」，Java 里没法（也没必要）动态 push——按组写成六个 `registerXxx()` 静态方法，全部注册完再对外可见，语义等价且更安全：

```java
package com.bigpixel.comet.module;

import com.bigpixel.comet.config.ConfigManager;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;

import java.util.*;

public final class ModuleRegistry {
    private ModuleRegistry() {}

    public static final List<Category> CATS = List.of(
            new Category("combat",   "战斗", "⚔"),
            new Category("movement", "移动", "➤"),
            new Category("render",   "渲染", "◈"),
            new Category("player",   "玩家", "☺"),
            new Category("misc",     "工具", "⚙"),
            new Category("configs",  "配置", "⛭", true)   // extra: true
    );

    private static final LinkedHashMap<String, Module> BY_ID = new LinkedHashMap<>();
    private static volatile boolean ready = false;

    /** 对应 boot() 里 MODULES 全部就位后才 refreshGui / renderModuleList。 */
    public static void bootstrap() {
        registerMain();      // 对应 295-779 主表，50 个
        registerExtA();      // 对应 EXT_MODULES   4653，10 个
        registerExtB();      // 对应 EXT_MODULES_B 5384，10 个
        registerExtC();      // 对应 EXT_MODULES_C 6128，11 个
        registerExtD();      // 对应 EXT_MODULES_D 6644，12 个
        registerExtE();      // 对应 EXT_MODULES_E 7171， 6 个
        registerAbout();     // 对应 7423-7430，        1 个
        // 合计 100 个。这里一次遍历灌默认值，取代 JS 里 783 行 + 各 EXT push 后零散的兜底
        for (Module m : BY_ID.values()) ConfigManager.ensureState(m.id, m.stateByDefault);
        ConfigManager.save();
        ready = true;
    }

    private static void registerMain() {
        register(new com.bigpixel.comet.module.impl.AuraModule());
        register(new com.bigpixel.comet.module.impl.MultiAuraModule());
        register(new com.bigpixel.comet.module.impl.TriggerBotModule());
        register(new com.bigpixel.comet.module.impl.BowAimModule());
        register(new com.bigpixel.comet.module.impl.EspModule());
        register(new com.bigpixel.comet.module.impl.TracersModule());
        register(new com.bigpixel.comet.module.impl.HudModule());
        register(new com.bigpixel.comet.module.impl.AppearanceModule());
        register(new com.bigpixel.comet.module.impl.PerfModule());
        register(new com.bigpixel.comet.module.impl.MotionBlurModule());
        register(new com.bigpixel.comet.module.impl.MinimapModule());
        // ... 主表剩余 39 个，按 MODULES 顺序逐个 new
    }

    private static void registerExtA() { /* 10 个，对应 4653-4741 */ }
    private static void registerExtB() { /* 10 个，对应 5384-5477 */ }
    private static void registerExtC() { /* 11 个，对应 6128-6215 */ }
    private static void registerExtD() { /* 12 个，对应 6644-6739 */ }
    private static void registerExtE() { /*  6 个，对应 7171-7219 */ }
    private static void registerAbout() {
        register(new com.bigpixel.comet.module.impl.AboutModule());
    }

    /** 对应 JS 每次 push 都同步写 MODS_BY_ID；顺带补默认状态，避免半张表被查询。 */
    private static void register(Module m) {
        BY_ID.put(m.id, m);
        ConfigManager.ensureState(m.id, m.stateByDefault);
    }

    /** 与 07 卷 ModuleRegistry.selfTest() 统一命名，对应 extSelfTest(6963-7017) / extHealthCheck(6333-6370)。
     *  索引同步一项由 register() 唯一维护 BY_ID 天然保证（07 卷 §5.1），这里仍留一道兜底。 */
    public static List<String> selfTest() {
        List<String> problems = new ArrayList<>();
        if (!ready) problems.add("注册表未初始化完成");
        if (BY_ID.size() != 100) problems.add("模块数不是 100，实际 " + BY_ID.size());
        for (Module m : BY_ID.values()) {
            if (byId(m.id) != m) problems.add("索引未同步：" + m.id);
            for (com.bigpixel.comet.config.Setting<?> s : m.settings()) {
                if (s.id == null || s.id.isEmpty()) problems.add("空设置 id：" + m.id);
            }
        }
        return problems;
    }

    public static Module byId(String id) { return BY_ID.get(id); }
    public static Collection<Module> all() { return BY_ID.values(); }
    public static int size() { return BY_ID.size(); }
    public static boolean isReady() { return ready; }

    /** 对应 modOn(id)，供 ArrayList / 渲染逻辑用。 */
    public static List<Module> enabled() {
        List<Module> r = new ArrayList<>();
        for (Module m : BY_ID.values()) if (m.on()) r.add(m);
        return r;
    }

    /** 对应 toggleModule(m) + afterToggle：翻开关、落盘、跑副作用、刷 GUI/HUD。 */
    public static void toggle(Module m, MinecraftClient c) {
        boolean now = ConfigManager.flipState(m.id, m.stateByDefault);
        ConfigManager.save();
        if (now) m.onEnable(c); else m.onDisable(c);
        Notification.push(m.cn, now ? "已开启" : "已关闭");
    }

    /** 对应 setS → afterSetting。 */
    public static void setSetting(Module m, String sid, Object v) {
        ConfigManager.setS(m.id, sid, v);
        m.onSettingChanged(sid);
    }

    public static void tick(MinecraftClient c) {
        for (Module m : BY_ID.values()) if (m.on()) m.onTick(c);
    }
    public static void onWorldRender(WorldRenderContext ctx) {
        for (Module m : BY_ID.values()) if (m.on()) m.onWorldRender(ctx);
    }
    public static void onHud(DrawContext dc, float delta) {
        for (Module m : BY_ID.values()) if (m.on()) m.onHud(dc, delta);
    }
    public static void refreshHudData(MinecraftClient c) {
        for (Module m : BY_ID.values()) if (m.on()) m.refreshHudData(c);
    }
    public static void onWorldJoin(MinecraftClient c) {
        // 对应 syncRefs 注释：进服/切维度会重建 Player，模块里缓存的实体引用要清掉
        for (Module m : BY_ID.values()) m.onDisable(c);
    }
}
```

一个具体模块长什么样，拿 `AuraModule` 举例——它把 297-329 行那一大坨 settings 逐条搬过来，`stateByDefault=false`（MODULES 里 aura 没写 `state`），逻辑钩子对应 `tickModules()` 里的 Aura 分支：

```java
package com.bigpixel.comet.module.impl;

import com.bigpixel.comet.config.Setting;
import com.bigpixel.comet.module.Module;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.minecraft.client.MinecraftClient;

import java.util.List;

public final class AuraModule extends Module {

    public final Setting.Slider range   = add(new Setting.Slider("range","Range","范围",null,2,6,0.1f,4.5f));
    public final Setting.Slider strength= add(new Setting.Slider("strength","Strength","强度",null,0.3f,1,0.05f,0.9f));
    public final Setting.Checkbox players= add(new Setting.Checkbox("players","Players","玩家","默认目标包含玩家",true));
    public final Setting.Multi targets  = add(new Setting.Multi("targets","Targets","攻击生物","留空 = 默认（敌对生物 + 玩家）",
            List.of("玩家","僵尸","骷髅","苦力怕","蜘蛛","末影人","女巫","史莱姆","烈焰人","恶魂")));
    public final Setting.Checkbox rotate = add(new Setting.Checkbox("rotate","Rotate","旋转","攻击时朝向目标",false));
    public final Setting.Checkbox ring   = add(new Setting.Checkbox("ring","Range Ring","脚下范围圈","在脚底画与攻击半径等大的光环",true));
    public final Setting.Color ringColor= add(new Setting.Color("ringColor","Ring Color","光环颜色","留空 = 彗星紫",""));
    public final Setting.Select ringMode= add(new Setting.Select("ringMode","Ring FX","光环动效","几何图案自带旋转/脉冲/顶点发光",
            "极光", List.of("极光","彩虹","脉冲","旋转","波浪","粒子","双层","音乐律动",
                    "五芒星","六芒星","三角阵","菱形","六边形","花瓣","齿轮","螺旋","星轨")));
    public final Setting.Slider ringSpeed= add(new Setting.Slider("ringSpeed","FX Speed","动效速度",null,0.2f,3,0.1f,1));
    public final Setting.Slider ringWidth= add(new Setting.Slider("ringWidth","Line Width","线条粗细",null,1,8,0.5f,2.5f));
    public final Setting.Slider ringLayers=add(new Setting.Slider("ringLayers","Layers","圈层数",null,1,4,1,2));
    public final Setting.Slider ringGlow = add(new Setting.Slider("ringGlow","Glow","辉光强度",null,0,30,1,14));
    public final Setting.Slider ringFill = add(new Setting.Slider("ringFill","Fill","填充强度",null,0,40,2,12));
    public final Setting.Checkbox rainbow= add(new Setting.Checkbox("ringRainbow","Rainbow","彩虹渐变",null,true));
    public final Setting.Checkbox particles=add(new Setting.Checkbox("ringParticles","Particles","环绕粒子",null,true));
    public final Setting.Checkbox fxBars  = add(new Setting.Checkbox("fxBars","Spectrum Bars","环形频谱柱",null,true));
    public final Setting.Slider fxBlur   = add(new Setting.Slider("fxBlur","Motion Blur","动态模糊",null,0,12,0.5f,3));
    public final Setting.Slider fxTrail  = add(new Setting.Slider("fxTrail","Afterimage","拖影长度",null,0,90,5,55));

    public AuraModule() {
        super("aura", "Aura", "光环", "combat", "自动攻击范围内的敌对目标");
    }

    @Override
    public void onTick(MinecraftClient c) {
        // 对应 tickModules() 里的 Aura 分支：按 range 找目标、按 targets/players 过滤、
        // rotate 时朝目标转视角、然后发包攻击。逻辑可 1:1 搬。
    }

    @Override
    public void onWorldRender(WorldRenderContext ctx) {
        if (!ring.get()) return;
        // 用 Projector.projectRing() + LineRenderer 画脚下范围圈，见卷二/卷三
    }
}
```

---

## 5. 配置：cfg / getS / __sCache / saveCfg → Gson + 缓存失效

`cfg`（106-127）是 17 个字段的扁平对象：`states / settings / binds / favorites / hudPos / guiOffset / theme / servers / serverIdx / mcAddr / mcName / floatPos / guiKey / waypoints / minmapPos / invPos / dropsPos / musicPos / appearance / ext`。`saveCfg()` 就一句 `localStorage.setItem(CFG_KEY, JSON.stringify(cfg))`，写失败静默兜底成内存态。

`getS(mid, sid)`（806-819）是热点：key 是 `mid + '.' + sid`，先查 `__sCache`，再查 `cfg.settings`，最后回落到 `MODS_BY_ID[mid].settings` 里定义项的 `value`（函数则调用）。`setS` 写配置后把 `__sCache = null` 让缓存整体失效——注意它置 `null` 而不是逐项删，`onFrame` 每帧开头 `__sCache = {}`、结尾 `finally { __sCache = null }`，意味着**缓存只在单帧内有效**，帧与帧之间不复用。这个设计很关键：网页里用户可能随时在 GUI 改设置，帧级缓存既省了反复查表又不会读到过期值。Java 里照搬这个「帧级缓存」语义。

完整 `CometConfig` POJO：

```java
package com.bigpixel.comet.config;

import com.google.gson.JsonElement;
import com.google.gson.annotations.SerializedName;
import java.util.*;

public final class CometConfig {

    /** 对应 cfg.states：模块 id -> 开关。 */
    public Map<String, Boolean> states = new LinkedHashMap<>();

    /** 对应 cfg.settings： "module.setting" -> 值（数字/布尔/字符串/数组/对象都塞 JsonElement）。 */
    public Map<String, JsonElement> settings = new LinkedHashMap<>();

    /** 键位绑定：模块 id -> GLFW key 名。 */
    public Map<String, String> binds = new LinkedHashMap<>();
    public Map<String, Boolean> favorites = new LinkedHashMap<>();
    public Map<String, Vec2> hudPos = new LinkedHashMap<>();
    public Map<String, Vec2> floatPos = new LinkedHashMap<>();

    public Vec2 guiOffset = new Vec2(0, 0);
    public Vec2 minmapPos = new Vec2(16, 16);
    public Vec2 invPos    = new Vec2(16, 16);
    public Vec2 dropsPos  = new Vec2(16, 210);
    public Vec2 musicPos  = new Vec2(16, 16);

    /** default / glass，对应 cfg.theme（113 行强制二选一）。 */
    public String theme = "default";

    /** 对应 cfg.guiKey，默认 Backquote，Yarn 里叫 grave accent。 */
    public String guiKey = "key.keyboard.grave";

    public List<ServerEntry> servers = new ArrayList<>(List.of(
            new ServerEntry("官方", "https://xz.honghemc.cn:8443")));
    public int serverIdx = 0;
    public String mcAddr = "ws://localhost:25565";
    public String mcName = "WebPlayer";

    public List<Waypoint> waypoints = new ArrayList<>();

    /** 对应 cfg.appearance：自定义快照 + 当前档位。 */
    public Appearance appearance = new Appearance();

    /** 性能档位，对应 perf.level / perf.maxEnts / perf.fxQuality / perf.noGlow。 */
    public Perf perf = new Perf();

    public Ext ext = new Ext();

    // ---- 内嵌类型 ----
    public static final class Vec2 {
        public float x, y;
        public Vec2() {}
        public Vec2(float x, float y) { this.x = x; this.y = y; }
    }
    public static final class ServerEntry {
        public String name, url;
        public ServerEntry() {}
        public ServerEntry(String n, String u) { name = n; url = u; }
    }
    public static final class Waypoint {
        public String name;
        public double x, y, z;
        public int color;
    }
    public static final class Appearance {
        /** 对应 APPEARANCE_KEYS 的 8 个参数的自定义快照。 */
        public Map<String, JsonElement> snapshot = new LinkedHashMap<>();
        public String preset = "绚丽";
    }
    public static final class Perf {
        public String level = "自动";          // 自动 / 省电 / 均衡 / 绚丽
        public int maxEnts = 80;
        public float fxQuality = 1.0f;
        public boolean noGlow = false;
    }
    public static final class Ext {
        public List<double[]> coords = new ArrayList<>();
        public Map<String, JsonElement> profiles = new LinkedHashMap<>();
        public List<JsonElement> macros = new ArrayList<>();
        public JsonElement stats = null;
    }
}
```

`ConfigManager` 把 `load / save / beginFrame / endFrame / getS / setS / modOn / flipState / ensureState / invalidateCache` 全包了。持久化路径用 `FabricLoader.getInstance().getConfigDir()`，写文件用「先写 .tmp 再原子 move」，避免崩溃时把配置写半截——这点比 `localStorage.setItem` 稳，`localStorage` 同步写、超配额直接抛，源脚本只能 `catch(e){}` 兜底：

```java
package com.bigpixel.comet.config;

import com.bigpixel.comet.CometClient;
import com.google.gson.*;
import net.fabricmc.loader.api.FabricLoader;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.HashMap;
import java.util.Map;

public final class ConfigManager {
    private ConfigManager() {}

    private static final Gson GSON = new GsonBuilder()
            .setPrettyPrinting()
            .disableHtmlEscaping()
            .create();

    private static final Path FILE =
            FabricLoader.getInstance().getConfigDir().resolve("comet-client.json");

    private static CometConfig cfg = new CometConfig();

    /** 对应 __sCache：帧级缓存，null 表示本帧缓存未启用/已失效。 */
    private static Map<String, Object> frameCache = null;

    public static CometConfig get() { return cfg; }

    public static void load() {
        if (!Files.exists(FILE)) { save(); return; }
        try (Reader r = Files.newBufferedReader(FILE, StandardCharsets.UTF_8)) {
            CometConfig loaded = GSON.fromJson(r, CometConfig.class);
            if (loaded != null) cfg = loaded;
        } catch (Exception e) {
            CometClient.LOGGER.warn("[Comet] 配置读取失败，使用默认值", e);
        }
        normalize();
    }

    /** 旧版迁移的对应物：785-803 行把 __opusHudCfg 搬到新 key。Java 里只做字段兜底。 */
    private static void normalize() {
        if (cfg.states == null)   cfg.states = new java.util.LinkedHashMap<>();
        if (cfg.settings == null) cfg.settings = new java.util.LinkedHashMap<>();
        if (!"glass".equals(cfg.theme)) cfg.theme = "default";   // 对应 113 行
        if (cfg.servers == null || cfg.servers.isEmpty())
            cfg.servers = new java.util.ArrayList<>(
                    java.util.List.of(new CometConfig.ServerEntry("官方", "https://xz.honghemc.cn:8443")));
        if (cfg.appearance == null) cfg.appearance = new CometConfig.Appearance();
        if (cfg.perf == null)       cfg.perf = new CometConfig.Perf();
        if (cfg.ext == null)        cfg.ext = new CometConfig.Ext();
    }

    public static void save() {
        try {
            Path dir = FILE.getParent();
            if (dir != null) Files.createDirectories(dir);
            Path tmp = FILE.resolveSibling(FILE.getFileName() + ".tmp");
            try (Writer w = Files.newBufferedWriter(tmp, StandardCharsets.UTF_8)) {
                GSON.toJson(cfg, w);
            }
            try {
                Files.move(tmp, FILE, StandardCopyOption.REPLACE_EXISTING,
                        StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(tmp, FILE, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (Exception e) {
            // 对应 saveCfg 的 catch：写不进去就只保内存态，不让游戏崩
            CometClient.LOGGER.warn("[Comet] 配置落盘失败，保留内存态", e);
        }
    }

    // ---- 帧缓存生命周期，对应 onFrame 的 __sCache = {} / finally { = null } ----
    public static void beginFrame() { frameCache = new HashMap<>(); }
    public static void endFrame()   { frameCache = null; }
    public static void invalidateCache() { frameCache = null; }

    /** 对应 getS(mid, sid)：帧缓存 -> cfg.settings -> 定义默认值。 */
    @SuppressWarnings("unchecked")
    public static <T> T getS(String mid, String sid, T def) {
        String k = mid + "." + sid;
        if (frameCache != null && frameCache.containsKey(k)) return (T) frameCache.get(k);
        T v = def;
        JsonElement je = cfg.settings.get(k);
        if (je != null && !je.isJsonNull()) {
            Object o = jsonToJava(je);
            if (o != null) v = (T) o;
        }
        if (frameCache != null) frameCache.put(k, v);
        return v;
    }

    private static Object jsonToJava(JsonElement je) {
        if (je.isJsonPrimitive()) {
            JsonPrimitive p = je.getAsJsonPrimitive();
            if (p.isBoolean()) return p.getAsBoolean();
            if (p.isNumber())  return p.getAsFloat();
            return p.getAsString();
        }
        if (je.isJsonArray()) {
            java.util.List<String> l = new java.util.ArrayList<>();
            for (JsonElement e : je.getAsJsonArray()) l.add(e.getAsString());
            return l;
        }
        return je.toString();
    }

    /** 对应 setS：写配置、整体失效缓存、落盘。 */
    public static void setS(String mid, String sid, Object v) {
        cfg.settings.put(mid + "." + sid, GSON.toJsonTree(v));
        frameCache = null;          // 对应 __sCache = null
        save();
    }

    public static boolean modOn(String id, boolean def) {
        Boolean b = cfg.states.get(id);
        return b != null ? b : def;
    }
    public static void ensureState(String id, boolean def) {
        cfg.states.putIfAbsent(id, def);
    }
    public static boolean flipState(String id, boolean def) {
        boolean now = !modOn(id, def);
        cfg.states.put(id, now);
        return now;
    }
}
```

配置选型上多说两句。源脚本的 `cfg` 是「一张大表 + 字符串拼接 key」，没有类型约束，`getS` 全靠 `typeof` 兜。Java 里我建议**保留这张扁平 `settings` 表**，理由很实际：模块 100 个、设置项 307 个（按 `settings: [` 括号配平切块、再按 7 种 type 白名单数出来的精确值，和 07 卷一致），为每个模块建一个强类型 POJO 会产生巨量样板代码，而 ClickGUI 是数据驱动的（遍历 `Module.settings()` 画控件），扁平表正好对上。强类型只用在 `CometConfig` 的顶层字段（theme / guiKey / positions），其余走 `Map<String, JsonElement>`。

顺带记一个坑：直接 `grep -c "type: '"` 会得到 **323**，多出的 16 个不是设置项，是 `'text/plain;charset=utf-8'`、`'image/png'`、`'tile'`、`'img'`、`'etex'`、`'application/octet-stream'` 这类 MIME / 资源类型字面量。想要准确数字就按 type 白名单（slider / checkbox / color / button / select / text / multi）过滤，或按括号配平切块数 `settings` 里的顶层 `{`。

配置 GUI 的库选型按全队口径走（README §3.4、07 卷 §6.4）：**Cloth Config 做配置管理界面 + Gson 落盘**，07 卷 §6.4 的 `ConfigScreen.java` 已经把 307 个设置项映射到 Cloth Config 控件。MidnightConfig 靠注解生成，和这套动态 `settings` 表对不上，不用。这里点明一件容易混的事：04 卷那个自绘 `ClickGuiScreen` 不是要替代 Cloth Config，它只管毛玻璃 ClickGUI（模块开关列表那一屏）——Cloth Config 的 `ConfigEntry` 画不出 `backdrop-filter`，所以那屏必须自己用 `DrawContext` 画；配置管理、帮助中心、键位管理、备份这些屏幕照旧用 Cloth Config。两个是不同的 `Screen`，不冲突，别把「ClickGUI 自绘」推成「整个配置系统都不用第三方库」。

ModMenu 是可选入口：接就按 README §3.2 加 `entrypoints.modmenu` 指向 `com.bigpixel.comet.config.CometModMenu`，其 `getModConfigScreenFactory()` 返回 `ConfigScreen.create(parent)`；不接就把 `entrypoints.modmenu` 和 `suggests.modmenu` 一起删掉，别留个不存在的类（本卷前面的 fabric.mod.json 就是「不接」那版）。注意 ModMenu 入口打开的是**配置屏幕**，不是 `ClickGuiScreen`；后者由 `cfg.guiKey`（默认 Backquote）经 `KeyBindingHelper` 呼出。

---

## 6. 性能分级：省电 / 均衡 / 绚丽

`perfLevel()`（1943-1950）读 `perf.level`，是「自动」时按 `state.game.fps` 判：`<25` 省电、`<45` 均衡、否则绚丽。`perfGlow()` 决定辉光（`shadowBlur` 是 canvas 最贵的操作，注释里点名了）；`perfFx()` 给特效精度系数：省电 0.4、均衡 0.7、绚丽取 `fxQuality` 且夹下限 0.3。

Java 里做成枚举，质量缩放集中在一个地方算，别让每个渲染函数各写一遍 `if`：

```java
package com.bigpixel.comet.config;

import net.minecraft.client.MinecraftClient;

public enum PerfLevel {
    POWER_SAVE("省电", 0.40f, 20, false),
    BALANCED  ("均衡", 0.70f, 50, false),
    FANCY     ("绚丽", 1.00f, 80, true);

    public final String cn;
    public final float fxScale;       // 对应 perfFx()
    public final int maxEntities;     // 对应 perf.maxEnts 的默认分档
    public final boolean glow;        // 对应 perfGlow()

    PerfLevel(String cn, float fx, int ents, boolean glow) {
        this.cn = cn; this.fxScale = fx; this.maxEntities = ents; this.glow = glow;
    }

    public static PerfLevel current(MinecraftClient c) {
        CometConfig.Perf p = ConfigManager.get().perf;
        if (!"自动".equals(p.level)) return fromCn(p.level);
        int fps = currentFps(c);
        if (fps > 0 && fps < 25) return POWER_SAVE;
        if (fps > 0 && fps < 45) return BALANCED;
        return FANCY;
    }

    private static PerfLevel fromCn(String s) {
        for (PerfLevel l : values()) if (l.cn.equals(s)) return l;
        return FANCY;
    }

    private static int currentFps(MinecraftClient c) {
        // MinecraftClient 不直接暴露 fps；用 Fabric 的 DebugHud 或自己按帧计时。
        // 这里给一个常见的按 nanos 统计实现，卷四的模糊降级也用同一个值。
        return FpsSampler.get();
    }

    /** 对应 perfFx()：绚丽档再乘用户 fxQuality，并夹 0.3 下限。 */
    public float fxQuality() {
        if (this == FANCY) {
            float q = ConfigManager.get().perf.fxQuality;
            return Math.max(0.3f, q);
        }
        return fxScale;
    }

    /** 对应 perfGlow()：省电/均衡强制关辉光，绚丽档还要看 noGlow 开关。 */
    public boolean glowEnabled() {
        return this == FANCY && !ConfigManager.get().perf.noGlow;
    }

    /** 画质缩放：把「圆圈分段数 / 粒子数 / 拖影采样数」按系数缩，源脚本是 0.4/0.7/1。 */
    public int scaleSegments(int base) {
        return Math.max(8, Math.round(base * fxQuality()));
    }
}
```

`FpsSampler` 在 `END_CLIENT_TICK` 里累加，每秒算一次——对应源脚本读 `state.game.fps`：

```java
public final class FpsSampler {
    private static long windowStart = System.nanoTime();
    private static int frames = 0, fps = 0;
    public static void tick() {
        frames++;
        long now = System.nanoTime();
        if (now - windowStart >= 1_000_000_000L) {
            fps = (int) (frames * 1_000_000_000L / (now - windowStart));
            frames = 0; windowStart = now;
        }
    }
    public static int get() { return fps; }
}
```

`scaleSegments()` 是移植时最容易漏的：源脚本画光环用 `fxQuality` 缩分段数、缩粒子数、缩拖影采样，Java 里如果只把 `perfLevel()` 搬过来却没在几何生成处用上，省电档就只剩个摆设。所有「按数量循环」的地方都要过一遍 `PerfLevel.current(mc).scaleSegments(base)`。

---

## 7. 主题系统：default / glass

两套来源要分清，别混：

- `cfg.theme` 只有 `default` / `glass`（113 行强制归一化），由 `applyTheme()`（10238-10254）切 `gui.classList` 和一堆子容器的 `glass` class。这是**皮肤**。
- `appearance.preset` 有 `绚丽 / 平缓 / 基本 / 自定义` 四档（511-512 行），由 `applyAppearance()`（1893-1912）往 `:root` 写 8 个 CSS 变量、切 `fancy` / `plain` class。这是**强度**。

两者正交：glass 主题下也能选「基本」档（blur=0 的玻璃）。`applyAppearance` 里 `val(k)` 的回落逻辑是 `getS('appearance', k)` 为空则取当前 preset 的预设值——所以切 preset 时会先把 8 个 key 全写进 `cfg.settings`（1936 行），再清缓存、落盘、重画。

Java 里皮肤做成枚举，强度做成另一组配置，互不干扰：

```java
package com.bigpixel.comet.config;

public enum Theme {
    DEFAULT,
    GLASS;

    public static Theme current() {
        return "glass".equals(ConfigManager.get().theme) ? GLASS : DEFAULT;
    }

    public static void set(Theme t) {
        ConfigManager.get().theme = (t == GLASS) ? "glass" : "default";
        ConfigManager.invalidateCache();
        ConfigManager.save();
        // 对应 applyTheme()：所有容器重新取色，没有 DOM class 要切，
        // 渲染器每帧读 Theme.current() 即可，不需要「通知重绘」。
    }

    public boolean glass() { return this == GLASS; }
}
```

外观 8 参数和预设表单独放 `AppearancePreset`，卷四会逐条拆；这里只给出常量，保证架构上有个明确的归属：

```java
package com.bigpixel.comet.config;

import java.util.Map;

public final class AppearancePreset {
    private AppearancePreset() {}

    public static final String[] KEYS =
            {"accent","glow","blur","radius","anim","saturate","bg","border"};

    /** 对应 1878-1882 的 APPEARANCE_PRESETS。 */
    public static final Map<String, Appearance> PRESETS = Map.of(
        "绚丽", new Appearance(0xB06BFF, 14, 18, 14, 1.3f, 1.5f, 0x10121C, 0.75f),
        "平缓", new Appearance(0x6F9BD1,  5,  8,  9, 0.6f, 1.05f,0x141821, 0.45f),
        "基本", new Appearance(0x8A8F99,  0,  0,  4, 0.0f, 0.8f, 0x0D1016, 0.25f)
    );

    public record Appearance(int accent, int glow, float blur, float radius,
                             float anim, float saturate, int bg, float border) {}

    /** 对应 applyAppearance() 的 val()：用户值优先，空值回落预设。 */
    public static float number(String key, Appearance fallback) {
        Object v = ConfigManager.getS("appearance", key, null);
        if (v instanceof Number n) return n.floatValue();
        return switch (key) {
            case "glow" -> fallback.glow();
            case "blur" -> fallback.blur();
            case "radius" -> fallback.radius();
            case "anim" -> fallback.anim();
            case "saturate" -> fallback.saturate();
            case "border" -> fallback.border();
            default -> 0;
        };
    }
}
```

`applyAppearancePreset()`（1933-1942）的 Java 版就是「遍历 KEYS 写 settings → 失效缓存 → 落盘」，和 `ConfigManager.setS` 的语义一致，不再单列。

---

## 8. DOM 层级 → DrawContext 层级 / z-order

网页靠 `z-index` 排层，全是 2147483xxx 这种顶格值；Java 里没有 z-index，`HudRenderCallback` 里靠**调用顺序**定前后，自定义 `Screen` 又天然盖在 HUD 之上。先把源脚本的容器和 z-index 抄出来（`boot()` 12060-12089 一次性 append 全部容器，CSS 里定义层级）：

| DOM 容器 | z-index / 位置 | 内容 | Java 对应 | 绘制层 |
| --- | --- | --- | --- | --- |
| `#gl`（游戏 3D 画布） | 最底 | 世界 | 原版 `WorldRenderer` | 世界渲染（最底） |
| `#__comet_mblur` | 2147482990 | 全屏运动模糊 | `MotionBlurRenderer` | 世界之后、HUD 之前（后处理） |
| `#__comet_radar` / `#__comet_compass` | 2147483645 | 雷达 / 罗盘 | `HudRenderer` 的一节 | HUD（靠前画，先被盖） |
| `#__comet_esp` | 2147483646 | ESP 框 / 追踪线 / 抛物线 | `WorldFxRenderer` 投影到屏幕的部分 | HUD 早期 |
| `#__comet_hudstage` | 2147483646 | 水印 / 坐标 / 目标 / 列表 / 通知 | `HudRenderer` 主体 | HUD 中段 |
| `#__comet_ext` | 2147483002 | 扩展 HUD（坐标/FPS/统计） | `HudRenderer` 一节 | HUD 后段 |
| `#__comet_helper` / `#__comet_rpmenu` | 3002 / 2147483661 | 帮助 / 资源包菜单 | 独立 `Screen` 或 `Screen` 内弹层 | 顶层 Screen |
| `#__comet_gui` | 2147483647 | `.cm-dim` 遮罩 + `#__comet_panel` + `.cm-float` | `ClickGuiScreen` / `FloatPanelScreen` | 自定义 Screen（盖住 HUD） |
| `#__comet_intro` | 2147483647 | 开场动画 | 独立全屏覆盖 `Screen`（见卷三） | 最顶（启动期） |

`#__comet_gui` 内部结构（10208-10216）：`gui -> [dim, stage -> panel -> [sheen, side, header, modsPane, setsPane, soon, themeBox, results, hlabel, searchBox]], floatLayer`。对应到 Java 就是 `Screen.render` 里按这个顺序画：先 `renderBackground`（暗化 = `.cm-dim`），再画 panel 底 + sheen + 各 pane，最后画浮在最上的搜索结果下拉和悬浮面板。

`HudRenderer` 的绘制顺序（= 从底到顶的 z-order）建议这么排，和上面表格一一对应：

```java
package com.bigpixel.comet.render;

import com.bigpixel.comet.gui.HudLayout;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;

public final class HudRenderer {
    private HudRenderer() {}

    public static void render(DrawContext dc, float tickDelta) {
        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc.world == null || mc.player == null) return;

        // 从底到顶 = 源脚本 z-index 从小到大
        drawRadar(dc, tickDelta);        // 2147483645
        drawCompass(dc, tickDelta);      // 2147483645
        drawWorldOverlays(dc, tickDelta);// ESP 屏幕投影（2147483646）
        drawWatermark(dc);               // hudstage
        drawCoords(dc);
        drawTargetHud(dc);
        drawArrayList(dc);
        drawNotifications(dc);
        drawExtHud(dc);                  // 2147483002，最后画所以最靠上

        // 注意：ClickGUI / intro 是独立 Screen，不在这个回调里，天然盖在全部 HUD 之上
    }
    // 各 drawXxx 见卷四与 HUD 专卷
}
```

一个容易踩的坑：源脚本 `#__comet_gui` 和 `#__comet_hudstage` 都用了 `transform: scale(2)`，看上去是两个独立的 2× 画布；但 Java 里 HUD 和 Screen 共用同一个 scaled 坐标系，不该各建一套缩放矩阵。`HudLayout`（对应 `hudPos` / `applyHudPos`）里存的位置直接是 scaled 像素，画的时候 `dc.getMatrices().translate(x, y, 0)` 即可，别再乘 2。

---

## 9. 注入点对照表：JS hook → Mixin 目标

源脚本挂在原型链和全局对象上的 hook，Java 里换成 Mixin 的 `@Inject`。下表把每个 hook 的用途和具体目标类/方法签名钉死：

| JS 注入点 | 源码行 | 作用 | Mixin 目标类 · 方法签名 | 注入策略 |
| --- | --- | --- | --- | --- |
| `G.prototype.render` → `onFrame` | 958-987 | 每帧驱动 | 优先用 `WorldRenderEvents` / `ClientTickEvents`（不写 Mixin）；确需挂钩则 `net.minecraft.client.render.GameRenderer#render(net.minecraft.client.render.RenderTickCounter, boolean)` | 事件优先，Mixin 兜底 `@Inject(method="render", at=@At("TAIL"))` |
| `G.prototype.playerBodyYaw` | 974-982 | Spin 只转身体不转视角 | `net.minecraft.entity.LivingEntity#getBodyYaw()` 或 `PlayerEntityRenderer` 的渲染角度 | `@Inject(method="getBodyYaw()F", at=@At("RETURN"), cancellable=true)` |
| `CanvasRenderingContext2D.prototype.getImageData` | 8386-8391 | 改贴图 strip 像素（资源包） | `net.minecraft.client.texture.SpriteContents` / `NativeImage#getPixelColor`；正路是走 `ResourcePack` | 资源包用 `ResourcePackManager` 注册自定义包，**不 Mixin** |
| `WebGL2RenderingContext.prototype.texStorage3D` | 8392-8405 | 抓纹理数组、导入后重传 | `net.minecraft.client.texture.SpriteAtlasTexture#upload` / `GlStateManager` | 同上，走资源包重载 `mc.reloadResources()` |
| `CanvasRenderingContext2D.prototype.fillText`（嗅探） | 928-936 | 抓文本绘制、字体 | `net.minecraft.client.font.TextRenderer#draw(Ljava/lang/String;FFIZLorg/joml/Matrix4f;Lnet/minecraft/client/render/VertexConsumerProvider;Lnet/minecraft/client/font/TextRenderer$TextLayerType;II)I` | `@Inject(at=@At("HEAD"))`，仅调试用，可不搬 |
| `game.ui` 的 `screen.widgets` / `ui.button(w)` | 8644-8680 | 往原版「选项」菜单塞「资源包…」按钮 | `net.minecraft.client.gui.screen.Screen#init()V` / `OptionsScreen#init()V` | `@Inject(method="init()V", at=@At("TAIL"))` 后 `addDrawableChild(ButtonWidget.builder(...).build())` |
| `hookNightVision`（改亮度取值） | 945-953 | FullBright / NightVision 强制最亮 | `net.minecraft.client.render.LightmapTextureManager#update(F)` 或 `net.minecraft.client.render.GameRenderer#getGamma()D` | `@Inject(method="getGamma()D", at=@At("RETURN"), cancellable=true)` 返回放大值 |
| `game.capturePointer` 拦截 | 1026-1032 | GUI 开着时不锁鼠标 | `net.minecraft.client.Mouse#lockCursor()V` / `Mouse#onCursorPos` | `@Inject(method="lockCursor()V", at=@At("HEAD"), cancellable=true)` |
| `document.addEventListener('keydown')` | 11743+ | 全局按键 / 键位绑定 | 不需要 Mixin：`KeyBindingHelper` + `ClientTickEvents` 轮询 `wasPressed()` | 事件 |
| `localStorage.getItem/setItem` | 103/130 | 配置持久化 | 不 Mixin：`ConfigManager` + Gson 文件 | — |
| `document-start` + `unsafeWindow` | 12/26 | 抢在页面前注入 | `ClientModInitializer#onInitializeClient()` | 入口点 |

给两个最有代表性的 Mixin 具体代码。`ScreenMixin` 对应「塞原版按钮」，是 `screen.widgets` 那套逻辑的直接翻译：

```java
package com.bigpixel.comet.mixin;

import com.bigpixel.comet.gui.ResourcePackMenu;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.option.OptionsScreen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(OptionsScreen.class)
public abstract class ScreenMixin extends Screen {
    protected ScreenMixin(Text title) { super(title); }

    @Inject(method = "init()V", at = @At("TAIL"))
    private void comet$addResourcePackButton(CallbackInfo ci) {
        // 对应 rpNativeWidget()：只在「选项」屏动手，其它菜单一律不碰
        if (!(this instanceof OptionsScreen)) return;
        this.addDrawableChild(ButtonWidget.builder(
                Text.literal("资源包…"),
                btn -> ResourcePackMenu.open(this.client))
                .dimensions(this.width / 2 - 75, this.height - 28, 150, 20)
                .build());
    }
}
```

`GameRendererMixin` 对应 `hookNightVision` 那条「改返回值」的思路——源脚本包装了原版取亮度的方法，`Math.max(v, 1)`：

```java
package com.bigpixel.comet.mixin;

import com.bigpixel.comet.config.ConfigManager;
import com.bigpixel.comet.module.ModuleRegistry;
import net.minecraft.client.render.GameRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(GameRenderer.class)
public abstract class GameRendererMixin {

    @Inject(method = "getGamma()D", at = @At("RETURN"), cancellable = true)
    private void comet$fullbright(CallbackInfoReturnable<Double> cir) {
        boolean fb = ModuleRegistry.byId("fullbright") != null
                && ConfigManager.modOn("fullbright", false);
        boolean nv = ModuleRegistry.byId("nightvision") != null
                && ConfigManager.modOn("nightvision", false);
        if (fb || nv) {
            // 对应 951 行 Math.max(v, 1)：把 gamma 顶到至少 1.0
            cir.setReturnValue(Math.max(cir.getReturnValue(), 1.0));
        }
    }
}
```

FullBright 更稳的做法其实是 Mixin `LightmapTextureManager#update` 把光照贴图整张填白，或直接给玩家加 `StatusEffects.NIGHT_VISION`；`getGamma` 只影响渲染 gamma，不影响光照贴图，网页版之所以够用是因为它的「亮度」就是个标量。移植时按实际效果选，别照搬标量语义。

---

## 10. 哪些能 1:1 搬，哪些必须换实现

这条界限全系列都要守住，写在这里当总纲。

**算法可 1:1 移植**（把 JS 函数逐行翻成 Java 即可，数值都不用改）：

- `project()` / `ringProject()` 的矩阵运算与近平面裁剪（本卷第 3 节已给完整 Java）。
- `cmShapeRadius()` 那套极坐标几何图案（五芒星/六芒星/花瓣/齿轮/星轨……），纯数学。
- 抛物线弹道求解、落点预测、移动目标提前量（`bowaim`）、`cmEase()` 缓动函数。
- `perfLevel / perfGlow / perfFx` 的分级判据与系数 0.4/0.7/1。
- `APPEARANCE_PRESETS` 的 8 组常量、`val()` 回落逻辑。
- `getS / setS / modOn / toggleModule` 的缓存与状态机语义（帧级缓存照搬）。
- `MODULES / CATS` 的数据结构、默认值灌入、旧配置迁移思路；「主表 50 + 五组 EXT 追加 49 + about 1 = 100、单一 `MODS_BY_ID` 索引、`extVal`/`extOn` 复用同一套 cfg」这个拼装结构本身也能 1:1 搬成静态分组注册（第 4 节已给）。
- 通知队列的 2600ms 过期、ArrayList 排序、雷达/罗盘的方位角换算（`edgePoint` 3122 行）。
- 运动模糊的 `d = hypot(Δyaw, Δpitch)`、指数平滑 `mbSmooth += (target-mbSmooth)*k`（3664-3686）。

**网页特有，必须换实现**：

| 网页机制 | 为什么不能搬 | Java 替代 |
| --- | --- | --- |
| CSS `backdrop-filter: blur()` | Java/Minecraft 没有「对背后已绘制像素实时模糊」的合成器，浏览器是合成阶段自动做的 | 自己截 framebuffer + 两趟可分离高斯模糊（卷四完整实现） |
| DOM + `z-index` 层级 | 无 DOM | `DrawContext` 调用顺序 + 独立 `Screen` |
| `transform: scale(2)` 的 stage / hudstage | 那是绕开网页 `#ui` 画布缩放的 hack | 统一 `Window.getScaledWidth/Height()`，不额外乘 2 |
| `localStorage` | 浏览器 API | `ConfigManager` + Gson + `getConfigDir()` 文件 |
| DOM 拖放（`makeDraggable` / 中键拖面板） | 无 DOM 事件 | `Screen#mouseDragged` / `mouseClicked`，位置存 `cfg.hudPos` |
| CSS 动画（`@keyframes cm-breathe / cm-hue / cm-sweep / cm-notein`） | 无 CSS | `tickDelta` / `System.nanoTime()` 驱动相位，在 `render` 里算插值 |
| `requestAnimationFrame` / `setInterval` / `setTimeout` | 浏览器调度 | `ClientTickEvents` / `HudRenderCallback` + tick 计数器 |
| `unsafeWindow` / 原型链 hook | 沙箱逃逸技巧 | `ClientModInitializer` + Mixin |
| `getImageData` / `texStorage3D` 改纹理 | 直接改 WebGL 上传链路 | 注册自定义 `ResourcePack` + `reloadResources()` |
| `screen.widgets.push(...)` 塞按钮 | 网页版自己的菜单数据结构 | Mixin `Screen#init` + `addDrawableChild` |
| `capturePointer` 拦截 | 网页版指针锁 | Mixin `Mouse#lockCursor` |
| 跨域 `GM_xmlhttpRequest` / `fetch` 伪装 | 账号/音乐台 API 的网页特例 | 用 `java.net.http.HttpClient`；登录态注入整块可删（Java 版有正版账号体系） |
| `isWrapperPage()` iframe 判断 | B 站 Toy 外壳 | 直接删 |

一个判断原则：**凡是「读状态、算数值、定开关」的，照搬；凡是「往屏幕上放东西、从浏览器拿能力」的，重写。** 这条线划清楚，卷二到卷四就不用反复纠结。

---

## 11. 启动顺序与依赖

`boot()`（12060-12117）的顺序其实很有讲究，Java 版照这个顺序能少踩几个「空指针」：

1. 挂样式与全部容器（`styleEl` / `gui` / `hudStage` / 各 canvas）→ Java：入口注册事件、shader 注册（此时还没有世界，不能碰 `mc.world`）。
2. `buildSidebar / renderModuleList / renderSettings / layoutPanel / applyHudPos / applyAppearance / applyTheme / refreshHud` → Java：`ConfigManager.load()` + `ModuleRegistry.bootstrap()`，注册表要在任何渲染回调触发前就绪。
3. `installOriginSpoof / installAccountSync / installFreecamListeners / hookNightVision / applyGate / applyServer` → Java：Mixin 是类加载期生效的，不需要「安装」；账号同步整块删；`applyServer` 对应服务器切换，Java 版没有多个房间服务器的运行时切换，删。
4. `pollRef(0)` 800ms 轮询找 `game` / `player` → Java：`ClientPlayConnectionEvents.JOIN` 或 `END_CLIENT_TICK` 里判断 `mc.world/player != null`，比轮询干净得多。源脚本那段 989-1013 行「进入/切换世界会重建 Player 实例」的长注释仍然有价值——模块里凡是缓存了实体引用的，进服都要清，卷二的光环目标缓存就是典型。
5. `playIntro()` → Java：启动期覆盖 Screen，见卷三。

依赖方向单向：`config ← module ← render / gui ← input`，`mixin` 只反向读 `config` / `module` 状态，不持有渲染对象。`CometClient.INSTANCE` 只放常量和全局状态引用，别把 `DrawContext` 之类的帧内对象塞进去——那是每帧新建的，跨帧持有必错。

这套骨架立住之后，卷二（光环）、卷三（开场动画）、卷四（毛玻璃 UI）都是往 `render/` 和 `gui/` 里填具体实现，架构层不用再动。
