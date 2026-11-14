# 05 · 工程骨架、逐类对照、落地与验收

**依据**：`_ref/` 里从 Meteor master 拉到的 19 个真实文件 + Wurst 7 公开架构资料。这份是开工清单，不是概念介绍。

---

## 1. 两种接入方式，选一个

| | Addon（推荐） | Fork |
|---|---|---|
| 做法 | 独立 mod，依赖 `meteor-client`，调用它的公开 API | 复制 Meteor 源码，改包名与主类 |
| 协议 | 可自选（MIT / 自有） | 必须 GPL-3.0，且保留版权头 |
| 升级 | Meteor 更新后可能要跟 API | 得自己 merge 上游 |
| 能改多深 | 只能用公开类；主题/组件/管线都够 | 能改 `GameRendererMixin` 等内部逻辑 |
| 适合 | 本方案全量需求 | 需要改渲染时机本身 |

本方案按 **addon** 写。所有用到的类（`Renderer3D` / `GuiTheme` / `HudElement` / `MeteorRenderPipelines` / `Color`）都是 public，不需要 fork。

---

## 2. 工程骨架

```
comet-fx/
├── build.gradle.kts
├── gradle.properties
├── settings.gradle.kts
├── gradle/libs.versions.toml
└── src/main/
    ├── java/com/bigpixel/comet/
    │   ├── CometFx.java                    ClientModInitializer 入口
    │   ├── render/
    │   │   ├── CometShapes.java           3D 线/框/圆/环/箭头/批量
    │   │   ├── CometShapes2D.java         圆角/渐变/圆/扇形
    │   │   ├── CometGeometry.java         17 图案极坐标（纯 Java，可单测）
    │   │   ├── CometColor.java            HSV / 彩虹 / lerp（纯 Java）
    │   │   ├── CometEase.java             缓动（纯 Java）
    │   │   ├── CometQuality.java          性能分档
    │   │   └── CometRenderPipelines.java  自定义 RenderPipeline
    │   ├── gui/
    │   │   ├── CometGlassTheme.java       extends MeteorGuiTheme
    │   │   ├── CometGlassWindow.java      extends WWindow
    │   │   ├── CometGlassPipeline.java    ping-pong 模糊
    │   │   ├── CometComposite.java        SDF 合成
    │   │   └── CometPreset.java           三档预设
    │   ├── hud/  Comet*Hud.java ×20      见 03 卷
    │   ├── fx/   CometAuraRing / CometIntro / CometParticles / CometTrail /
    │   │         CometMotionBlur / CometTrajectory / CometRenderEvents
    │   └── mixin/ GameRendererMixin / ScreenMixin（仅 2 个）
    └── resources/
        ├── fabric.mod.json
        ├── comet-fx.mixins.json
        └── assets/comet/shaders/
            ├── comet_blur.vsh / comet_blur.fsh / comet_composite.fsh
            └── pipeline/*.json（若 RenderPearl 需要独立声明）
```

### `gradle/libs.versions.toml`（对齐 Meteor 26.3）

```toml
[versions]
jdk = "25"
minecraft = "26.3"
fabric-loader = "0.19.5"
fabric-api = "0.162.0+26.3"
fabric-loom = "1.14-SNAPSHOT"     # 以当前 Loom 为准
meteor = "26.3-18"                 # 与用户装的 Meteor 版本一致

[libraries]
minecraft = { module = "com.mojang:minecraft", version.ref = "minecraft" }
fabric-loader = { module = "net.fabricmc:fabric-loader", version.ref = "fabric-loader" }
meteor-client = { module = "meteordevelopment:meteor-client", version.ref = "meteor" }

[plugins]
fabric-loom = { id = "net.fabricmc.fabric-loom", version.ref = "fabric-loom" }
```

### `build.gradle.kts` 要点

```kotlin
plugins { alias(libs.plugins.fabric.loom) }
java { toolchain.languageVersion.set(JavaLanguageVersion.of(25)) }
dependencies {
    minecraft(libs.minecraft)
    mappings(loom.officialMojangMappings())     // ← Mojang 官方映射，别写 yarn
    modImplementation(libs.fabric.loader)
    modImplementation(libs.meteor.client)
    modImplementation(fabricApi.module("fabric-rendering-v1", "..."))
}
loom { accessWidenerPath = file("src/main/resources/comet-fx.accesswidener") }
```

### `fabric.mod.json`

```json
{
  "schemaVersion": 1,
  "id": "comet-fx",
  "version": "${version}",
  "name": "Comet FX",
  "description": "Visual layer for Meteor Client: glass UI, shapes, HUD and effects.",
  "environment": "client",
  "entrypoints": { "client": ["com.bigpixel.comet.CometFx"] },
  "mixins": ["comet-fx.mixins.json"],
  "depends": {
    "java": ">=25",
    "minecraft": "26.3",
    "fabricloader": ">=0.19.5",
    "meteor-client": "*"
  },
  "breaks": { "optifabric": "*" }
}
```

### 入口

```java
package com.bigpixel.comet;

import net.fabricmc.api.ClientModInitializer;
import meteordevelopment.meteorclient.MeteorClient;

public final class CometFx implements ClientModInitializer {
    @Override public void onInitializeClient() {
        CometRenderPipelines.init();        // 注册 shader 管线
        CometGlassTheme.init();             // 注册主题
        CometHud.register();                // 20 个 HudElement
        CometRenderEvents.register();       // 订阅 EVENT_BUS
        CometIntro.register();              // TitleScreen / JOIN 触发
        MeteorClient.EVENT_BUS.subscribe(CometFx.class);
    }
}
```

**启动顺序有依赖**：管线 → 主题 → HUD → 事件 → 开场动画。主题初始化会读预设，预设要读 `ModConfig`，所以配置加载排最前。

---

## 3. Meteor / Wurst → 我们的逐类对照

| 能力 | Meteor 原类 | Wurst 原类 | 我们的类 |
|---|---|---|---|
| 3D 线 | `Renderer3D.line` | `RenderUtils.drawLine` | `CometShapes.line` |
| 3D 框 12 边 | `Renderer3D.boxLines` | `drawOutlinedBox` | `CometShapes.box` |
| 实心框 | `Renderer3D.box` | `drawSolidBox` | `CometShapes.filledBox` |
| 追踪线 | `Tracers` | `drawTracer` | `CometShapes.tracer` |
| 曲线 / 抛物线 | `Trajectories` | `drawCurvedLine` | `polyline` / `fadingPolyline` |
| 箭头 / 节点 | — | `drawArrow` / `drawNode` | `arrow` / `node` |
| 批量 | `MeshBuilder.ensureCapacity` | `drawOutlinedBoxes` | `boxes` |
| 穿墙 / 深度 | `WORLD_COLORED*` 四管线 | `WurstRenderLayers` | `CometRenderPipelines` |
| GUI 主题 | `GuiTheme` / `MeteorGuiTheme` | `ClickGui.Window` | `CometGlassTheme` |
| GUI 绘制 | `GuiRenderer.quad/triangle/scissor` | `DrawContext` | `CometShapes2D` |
| HUD 组件 | `HudElement` / `HudRenderer` | — | `Comet*Hud` ×20 |
| 名牌投影 | `NametagUtils` | — | 直接用 |
| 事件 | `EVENT_BUS` + `@EventHandler` | `EventManager` + `RenderListener` | 直接用 Meteor 的 |
| 设置 | `Settings` / `Setting<T>` | `*Setting` | 直接用 Meteor 的 |
| 后处理 | `PostProcessShaders` | — | `CometGlassPipeline` |
| 颜色 | `Color` / `SettingColor` | `java.awt.Color` | `CometColor` 补 HSV/彩虹 |

**明确不搬**：Meteor 的 `KillAura` / `CrystalAura` / `AnchorAura`、Wurst 的 `KillauraHack` / `TriggerBotHack`，以及所有 `hacks/` 下的玩法实现。本工程 `src/main/java` 里不会出现 `attack` / `interact` / `sendPacket` 这类调用（唯一例外是 `AttackEntityCallback` 被动读实体给 TargetHUD 显示）。

---

## 4. 映射对照（照抄 Wurst 代码时最容易翻车）

| 概念 | Wurst（Mojang） | Meteor（Mojang，26.3） | 若看到 Yarn 旧代码 |
|---|---|---|---|
| 玩家 | `LocalPlayer` | `LocalPlayer` | `ClientPlayerEntity` |
| 矩阵 | `PoseStack` | `PoseStack` | `MatrixStack` |
| 包围盒 | `AABB` | `AABB` | `Box` |
| 向量 | `Vec3` | `Vec3` | `Vec3d` |
| 屏幕绘制 | `GuiGraphics` | `GuiGraphicsExtractor` | `DrawContext` |
| 渲染目标 | `RenderTarget` | `mainRenderTarget` | `Framebuffer` |
| 顶点格式 | `DefaultVertexFormat` | `DefaultVertexFormat` | `VertexFormats` |
| 资源 id | `ResourceLocation` | `Identifier` | `Identifier` |

Meteor 26.3 已全面 Mojang 映射 + RenderPearl，**不要再按 `VertexConsumerProvider` / `RenderLayer.getLines()` 那套 1.21.1 写法**，那在 26.3 里已经换了。这是与 `fabric-port-docs/` 那 11 卷最本质的差别。

---

## 5. 性能预算

| 特效 | 每帧成本 | 上限 | 降级 |
|---|---|---|---|
| 毛玻璃两趟模糊 | 0.6–1.2 ms | 每帧 1 次，多面板复用 | 可用 → 纯色面板 |
| 光环 3 层 ×160 段 | ~1440 线段 | 1 次 | 段数 160→48 |
| ESP 200 框 | ~2400 线段 | 256 实体 | 距离裁剪 |
| 粒子 240 | 240 短线段 | 240 | 40 |
| 拖影 / 辉光 | 复用同一 RenderTarget | 1 张 | 关闭 |
| 开场动画 | 240 段 + 110 粒子 | 仅启动时 | — |

`CometQuality` 用 FPS 滑窗（60 帧）自动切档：>55 绚丽、40–55 均衡、<40 省电。切档要带 2 秒滞回，否则阈值附近来回跳。

---

## 6. 风险

| 风险 | 表现 | 处理 |
|---|---|---|
| Iris shaderpack 占用 RenderTarget | 玻璃黑块 / 花屏 | 每趟结束 `mainRenderTarget.bindWrite(true)`；编译失败一次性降级 |
| RenderPearl 管线 API 随 MC 版本变 | 编译不过 | 所有 pipeline 集中在 `CometRenderPipelines`，只改一处 |
| `MeshBuilder` 容量 | 大批框崩溃 | 用 `ensureCapacity`，不要裸写 `ByteBuffer` |
| 帧缓存泄漏 | 显存涨 | `CometGlassPipeline` 只保留两张 target，窗口 resize 才重建 |
| 事件里重复提交 | 图形消失 | 只塞顶点，不调 `renderer.render()` |
| 坐标多减一次相机 | 图形漂移 | 见 01 卷 §1.1 |
| 弧度/度数混用 | 运动模糊系数错 | 见 04 卷 §5 |
| 五芒星周期写错 | 变 10 尖 | 见 04 卷 §1 |

---

## 7. 落地顺序与验收（每一步都是肉眼可见）

| 步 | 做什么 | 做完的标志 |
|---|---|---|
| 1 | 工程骨架 + `CometShapes` | 游戏里能画出一个贴住方块的 12 边框、一条追踪线 |
| 2 | `CometGlassPipeline` + `CometGlassTheme` | ClickGUI 面板能透出模糊世界，圆角与高光正常 |
| 3 | HUD 组件 1–10 | 水印/坐标/模块列表/通知/TargetHUD/雷达都能拖、能存 |
| 4 | 光环 17 图案 + 开场动画 | 五芒星 5 尖；进游戏黑屏组装转圈淡出 |
| 5 | 粒子 / 拖影 / 辉光 / 运动模糊 | 转视角糊、停下清；HUD 始终清晰 |
| 6 | HUD 组件 11–20 + 组件树收尾 | 20 个组件全在，三档预设可切 |
| 7 | Iris / Sodium 兼容与性能分档 | 装 shaderpack 不黑屏；200 框不掉帧 |

**全局回归**：全程没有一处自动攻击、自动移动、发包打人；把 `CometFx` 关掉，游戏行为与未装时完全一致。

---

## 8. `src/` 里已验证的部分

`src/main/java/com/bigpixel/comet/render/` 下的 4 个**纯 Java** 类不依赖 Minecraft / Meteor，已用本机 `javac 25` 编译通过并跑了数值断言：

- `CometGeometry` —— 9 种几何图案极坐标、尖角数、`mod()`；断言五芒星一圈恰好 5 个局部极大、六边形有直边
- `CometColor` —— HSV→RGB、彩虹、lerp
- `CometEase` —— 三种缓动
- `CometShapesMath` —— 虚线切分、箭头羽片、圆角扇区顶点、ribbon quad 展开

其余类依赖 Meteor / MC 类，需在完整 Fabric 工程里编译，本机没有 MC 26.3 依赖，**没有编译验证**，方案里已逐处标注真实 API 出处，落地时按 `_ref/` 对照即可。
