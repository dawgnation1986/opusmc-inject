# 彗星客户端 · 视觉层完整方案（Meteor 基座）

**基座**：Meteor Client（彗星客户端，Java / Fabric 开源客户端），以 **addon 或 fork** 形式扩展。
**参考**：Meteor 自身的渲染 / GUI 架构 + Wurst 7 的 `RenderUtils` 绘制形状。
**目标**：把玻璃 UI、绘制线、绘制方框、全套 HUD 组件与特效完整实现出来。
**不做**：杀戮光环、自动攻击、移动、破坏等任何玩法逻辑。

> 用户原话边界：「只要编写特效那些 UI 那些的，玻璃 UI 还有绘制线绘制方框那些的，把它的 UI 全部弄过来；不需要编写它是如何实现的杀戮光环那些的」。

---

## 0. 版本口径（已核对真实源码，别再按旧印象写）

从 Meteor master 的 `gradle/libs.versions.toml` 与 `fabric.mod.json` 读到：

| 项 | 值 |
|---|---|
| Minecraft | **26.3** |
| Java / JDK | **25** |
| Fabric Loader | 0.19.5 |
| Fabric API | 0.162.0+26.3 |
| 映射 | **Mojang 官方**（`PoseStack` / `AABB` / `LocalPlayer`） |
| 渲染底层 | **RenderPearl**（`RenderPipeline` / `MeshRenderer` / `GpuBuffer`） |
| License | GPL-3.0（fork 必须遵守；addon 可独立选协议） |
| 入口 | `meteordevelopment.meteorclient.MeteorClient` |

Wurst 7 master 同样是 Mojang 映射 + Java 21/25，所以**不再有「Yarn vs Mojang」二选一的问题**，两边一致。

之前 `fabric-port-docs/` 那 11 卷按 1.21.1 / Yarn / Java 17 写，是另一份工作，**不修改、不复用、不引用**。本目录自成一体。

## 1. 为什么长在 Meteor 上，而不是自建事件层

Meteor 已经把最难的部分做完了：

| 需求 | 直接用 Meteor 现成的 | 自己造的代价 |
|---|---|---|
| 3D 线框 / 穿墙 | `Renderer3D.renderer` / `depthRenderer` 双实例，`MeshBuilder` 批量几何 | 要 mixin `GameRenderer.renderLevel`，处理 Iris bob 矩阵、RenderPearl 管线 |
| 2D 绘制 | `Renderer2D.COLOR` / `.TEXTURE`，`quad` / `line` / `boxLines` / `texQuad` | 自己注册顶点格式与管线 |
| GUI 组件树 | `GuiTheme` + `WidgetScreen` + `WWidget` / `WWindow` / `WSection` | 自己写布局、事件、滚动、裁剪 |
| HUD 组件 | `HudElement` + `HudBox` + `HudRenderer`，自带锚点/拖拽/编辑屏 | 自己写拖拽与位置持久化 |
| 颜色 / 设置 | `Color` / `SettingColor` / `Settings`（8 种设置类型） | 自己写 Gson 与控件 |
| 事件 | `MeteorClient.EVENT_BUS`，`@EventHandler` | 自己造总线 |

所以本方案**只做扩展，不重写地基**：新增一个 `CometGuiTheme`（玻璃主题）、一组 `Comet*Renderer` 绘制工具、一组 `HudElement` 组件、若干 `RenderPipeline` 与 shader。

## 2. 要搬的完整清单

| 类别 | 内容 | 落在 Meteor 的哪一层 | 文档 |
|---|---|---|---|
| 玻璃 UI | blur / saturate / brightness、sheen 高光、圆角、边框、双层阴影、inset 高光、三档预设、动画过渡 | `GuiTheme` 子类 + `GuiRenderer` + 自定义 `RenderPipeline` shader | `02-glass-ui.md` |
| 绘制线 | 直线、追踪线、曲线、虚线、箭头、批量线 | `Renderer3D` / `Renderer2D` 扩展 `CometShapes` | `01-render-core.md` |
| 绘制方框 | 12 边 3D 框、实心框、四角括号、渐变面、光柱、节点、批量框 | 同上 | `01-render-core.md` |
| 主面板 / ClickGUI | 胶囊、主面板、侧栏、悬浮标签、设置面板、通知、搜索、收藏 | `WWidget` 组件树 + 玻璃主题 | `02-glass-ui.md` |
| HUD 组件 | 水印、坐标、模块列表、通知、TargetHUD（脸/名/血条/装备/距离）、名牌、雷达、小地图、罗盘、准星、命中标记、伤害数字、FPS 图、药水列表、装备耐久 | `HudElement` 子类 | `03-hud-widgets.md` |
| 特效 | 脚下光环 17 图案、开场黑屏组装、粒子、拖影、辉光、彩虹流动、环形频谱、视角运动模糊、投掷物抛物线 | `Renderer3D` + 自定义 pipeline + `HudRenderer` | `04-effects.md` |

**不写**：Killaura / MultiAura / TriggerBot / BowAim 的索敌与发包，以及任何改变游戏状态的模块。TargetHUD 需要「当前目标」，只用 `AttackEntityCallback` **被动记录**最后一次挥击碰到的实体，不主动找目标。

## 3. 真实 API 速查（从拉下来的源码逐行核对）

```java
// Render3DEvent —— Meteor 在 GameRendererMixin 里 post，带双 renderer 与相机偏移
public class Render3DEvent {
    public PoseStack matrices;
    public Renderer3D renderer;        // 穿墙（ALWAYS_PASS）
    public Renderer3D depthRenderer;   // 吃深度
    public float tickDelta;
    public double offsetX, offsetY, offsetZ;   // 相机位置
}

// Renderer3D 的真实方法签名（Mojang 映射）
renderer.line(x1,y1,z1, x2,y2,z2, Color);
renderer.line(x1,y1,z1, x2,y2,z2, Color c1, Color c2);   // 渐变线
renderer.boxLines(x1,y1,z1, x2,y2,z2, Color, int excludeDir);
renderer.quad(...);  renderer.side(...);  renderer.box(AABB, sideColor, lineColor, ShapeMode, excludeDir);

// MeteorRenderPipelines 注册自定义管线的真实写法
new ExtendedRenderPipelineBuilder(MESH_UNIFORMS)
    .withLocation(MeteorClient.identifier("pipeline/xxx"))
    .withVertexBinding(0, DefaultVertexFormat.POSITION_COLOR)
    .withPrimitiveTopology(PrimitiveTopology.DEBUG_LINES)
    .withVertexShader(...).withFragmentShader(...)
    .withDepthStencilState(new DepthStencilState(CompareOp.ALWAYS_PASS, false))
    .withColorTargetState(new ColorTargetState(BlendFunction.TRANSLUCENT))
    .withCull(false).build();

// HudElement —— 自带锚点、拖拽、编辑屏、NBT 持久化
public abstract class HudElement implements Snapper.Element, ISerializable<HudElement> {
    public final HudElementInfo<?> info;
    public final Settings settings;
    public final HudBox box;
    public abstract void render(HudRenderer renderer);   // 见 03 卷
}

// GuiRenderer —— GUI 层的绘制入口
guiRenderer.quad(x, y, w, h, Color);  guiRenderer.scissorStart(...);  guiRenderer.text(...);
```

参考源码已放在 `_ref/`（19+ 个文件，181KB，从 Meteor master 直接拉取，可作逐行对照）。

## 4. 目录

| 文件 | 内容 |
|---|---|
| `01-render-core.md` | `CometShapes`：线 / 框 / 圆 / 环 / 星 / 圆角 / 虚线 / 箭头 / 批量，含完整 Java |
| `02-glass-ui.md` | 玻璃主题、模糊 shader（完整 GLSL）、面板组件树、动画 |
| `03-hud-widgets.md` | 全部 HUD 组件的 `HudElement` 实现与参数表 |
| `04-effects.md` | 光环 17 图案、开场动画、粒子、拖影、辉光、频谱、运动模糊 |
| `05-meteor-wurst-map.md` | Meteor/Wurst 逐类对照、工程骨架、落地顺序、验收 |
| `src/` | 纯 Java 数学层源码，已用 `javac 25` 编译并跑通 34 项断言 |
| `_ref/` | Meteor 官方源码快照（21 个 .java，253KB，只读参考） |

`src/` 里的文件目前是**平铺**的，为的是能脱离 Fabric 工程单独 `javac` 验证。落进正式工程时按 `package com.bigpixel.comet.render` 移到 05 卷目录树里的 `src/main/java/com/bigpixel/comet/render/`，类名与包名不用改。

## 5. 落地顺序

1. `CometShapes` —— 用 `Renderer3D` 画出线、12 边框、圆、四角括号
2. `CometGlassTheme` + 模糊 pipeline —— 画出一块真毛玻璃面板
3. HUD 组件：水印 → 坐标 → 模块列表 → 通知 → TargetHUD → 雷达
4. 光环 17 图案 + 开场黑屏组装动画
5. 粒子 / 拖影 / 辉光 / 运动模糊
6. 玻璃 ClickGUI 组件树收尾

每步「怎样算做完」在 05 卷，全部是肉眼可见的标准。
