# 01 · 绘制核心：线、框、圆、环、批量几何

**对应 Meteor 源码**（`_ref/` 可逐行对照）：`renderer/Renderer3D.java`、`renderer/Renderer2D.java`、`renderer/MeshBuilder.java`、`renderer/MeteorRenderPipelines.java`、`mixin/GameRendererMixin.java:100-135`、`systems/modules/render/LightOverlay.java`。
**对应 Wurst 源码**：`util/RenderUtils.java` 的 `drawLine / drawTracer / drawCurvedLine / drawSolidBox / drawOutlinedBox / drawCrossBox / drawNode / drawArrow` 与批量变体。
**要做出来的东西**：一套 `CometShapes` 静态工具，把上面所有绘制形状补齐，供 ESP、光环、追踪线、雷达、粒子、面板共同调用。

---

## 1. 先钉死三件会让人调一整天的事

### 1.1 传世界坐标，不要自己减相机

`MeshBuilder.vec3()` 的真实实现（`_ref/.../MeshBuilder.java:88-99`）：

```java
public MeshBuilder vec3(double x, double y, double z) {
    long p = verticesPointer;
    memPutFloat(p,      (float) (x - cameraX));
    memPutFloat(p + 4,  (float) y);           // Y 不减
    memPutFloat(p + 8,  (float) (z - cameraZ));
    verticesPointer += 12;
    return this;
}
```

`cameraX/cameraZ` 在 `begin()` 里取自 `mc.gameRenderer.mainCamera().position()`（`Utils.rendering3D` 为真时），2D 阶段为 0。所以：

- 3D 绘制：**直接给世界坐标**，`x - cameraX` 由 Meteor 做
- 自己再减一次 → 图形跟着相机跑，看起来像贴在地上飘
- Y 不减，别顺手把 y 也减了

`Render3DEvent` 里的 `offsetX/offsetY/offsetZ` 是给你算距离、做屏幕投影用的，**不是**给 `renderer.line()` 的顶点用的。这两件事混淆是照抄 Wurst `applyRenderOffset()` 时最常见的坑 —— Wurst 要手动减，Meteor 不用。

### 1.2 穿墙与吃深度：两个 renderer 实例

`GameRendererMixin:100-131` 的真实流程：

```java
if (renderer == null)
    renderer = new Renderer3D(MeteorRenderPipelines.WORLD_COLORED_LINES,
                              MeteorRenderPipelines.WORLD_COLORED);
if (depthRenderer == null)
    depthRenderer = new Renderer3D(MeteorRenderPipelines.WORLD_COLORED_LINES_DEPTH,
                                   MeteorRenderPipelines.WORLD_COLORED_DEPTH);
Render3DEvent event = Render3DEvent.get(bobStack, renderer, depthRenderer,
    worldPartialTicks, mainCamera.position().x, ...);
// ...bob / Iris 矩阵修正...
renderer.begin();
depthRenderer.begin();
MeteorClient.EVENT_BUS.post(event);     // ← 我们在这里画
renderer.render(bobStack);
depthRenderer.render(bobStack);
```

| 实例 | 管线 | depthTest | 用途 |
|---|---|---|---|
| `event.renderer` | `WORLD_COLORED_LINES` / `WORLD_COLORED` | `CompareOp.ALWAYS_PASS` | 穿墙可见：ESP 框、追踪线、光环 |
| `event.depthRenderer` | `..._DEPTH` | `DepthStencilState.DEFAULT.depthTest()` | 被方块遮挡：地面标记、路径点 |

所以 `CometShapes` 所有方法都收一个 `Renderer3D r`，由调用方决定传哪个，**不要在工具内部写死**。Meteor 的 `LightOverlay` 就是这么做的：

```java
Renderer3D renderer = seeThroughBlocks.get() ? event.renderer : event.depthRenderer;
```

### 1.3 事件里只「排队」，不「提交」

`renderer.line()` 只是往 `MeshBuilder` 的 `ByteBuffer` 里塞顶点；真正的 GPU 提交在 `EVENT_BUS.post()` 返回后由 mixin 调 `renderer.render(bobStack)`。所以**在 `@EventHandler` 里调 `renderer.render()` 是错的**，会提交一份空网格或重复提交。我们只管塞顶点。

---

## 2. 颜色与形状模式

Meteor 的 `Color`（`utils/render/color/Color.java`）是 4 个 `int` 字段 `r/g/b/a`，`SettingColor` 继承它并带彩虹设置。常用构造：

```java
import meteordevelopment.meteorclient.utils.render.color.Color;
import meteordevelopment.meteorclient.utils.render.color.SettingColor;
import meteordevelopment.meteorclient.renderer.ShapeMode;

Color c  = new Color(176, 107, 255, 200);
Color c2 = new SettingColor(176, 107, 255, 255);
Color faded = c.copy().a(80);
```

`ShapeMode` 是 `Lines / Sides / Both`，`Renderer3D.box(AABB, sideColor, lineColor, ShapeMode, int excludeDir)` 直接用。

一个补齐：Meteor 的 `Color` 没有 HSB / 彩虹流动，我们加一个 `CometColor`（纯 Java，见 `src/`）：

```java
public final class CometColor {
    /** h∈[0,360), s,v∈[0,1] → 0xRRGGBB 分量，返回 {r,g,b} */
    public static int[] hsv(double h, double s, double v) { ... }
    /** 彩虹：时间 t（秒）驱动色相，phase 给每个顶点错开 */
    public static Color rainbow(double t, double phase, int alpha) { ... }
    /** 两色线性插值 */
    public static Color lerp(Color a, Color b, float f) { ... }
}
```

---

## 3. `CometShapes` —— 3D 绘制工具（完整实现）

```java
package com.bigpixel.comet.render;

import meteordevelopment.meteorclient.renderer.Renderer3D;
import meteordevelopment.meteorclient.renderer.ShapeMode;
import meteordevelopment.meteorclient.utils.render.color.Color;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

/** 所有坐标都是世界坐标；Renderer3D 内部会减 cameraX/cameraZ。 */
public final class CometShapes {
    private CometShapes() {}
    private static final double TAU = Math.PI * 2;

    // ---------------------------------------------------------------- 线

    /** 单色直线 */
    public static void line(Renderer3D r, Vec3 a, Vec3 b, Color c) {
        r.line(a.x, a.y, a.z, b.x, b.y, b.z, c);
    }

    /** 渐变直线（Meteor 原生支持双端颜色） */
    public static void gradientLine(Renderer3D r, Vec3 a, Vec3 b, Color c1, Color c2) {
        r.line(a.x, a.y, a.z, b.x, b.y, b.z, c1, c2);
    }

    /** 追踪线：从相机到目标，对应 Wurst RenderUtils.drawTracer */
    public static void tracer(Renderer3D r, Vec3 camera, Vec3 target, Color c, boolean stem) {
        line(r, camera, target, c);
        if (stem) line(r, target, target.add(0, 1.8, 0), c);   // 竖杆
    }

    /** 折线 / 抛物线，对应 Wurst drawCurvedLine */
    public static void polyline(Renderer3D r, java.util.List<Vec3> pts, Color c) {
        for (int i = 1; i < pts.size(); i++) line(r, pts.get(i - 1), pts.get(i), c);
    }

    /** 尾迹渐隐折线：越靠近头部越亮，投掷物与拖影用 */
    public static void fadingPolyline(Renderer3D r, java.util.List<Vec3> pts, Color head) {
        int n = pts.size();
        for (int i = 1; i < n; i++) {
            float f = i / (float) n;
            Color a = head.copy().a((int) (head.a * (1 - f) * 0.9));
            Color b = head.copy().a((int) (head.a * (1 - (i + 1f) / n) * 0.9));
            gradientLine(r, pts.get(i - 1), pts.get(i), a, b);
        }
    }

    /** 虚线：dash/gap 为世界单位 */
    public static void dashed(Renderer3D r, Vec3 a, Vec3 b, Color c, double dash, double gap) {
        Vec3 d = b.subtract(a);
        double len = d.length();
        if (len < 1e-6) return;
        Vec3 unit = d.scale(1 / len);
        for (double t = 0; t < len; t += dash + gap) {
            double e = Math.min(t + dash, len);
            line(r, a.add(unit.scale(t)), a.add(unit.scale(e)), c);
        }
    }

    /** 3D 箭头：杆 + 四片箭羽，方向自适应 */
    public static void arrow(Renderer3D r, Vec3 from, Vec3 to, Color c, double headLen) {
        line(r, from, to, c);
        Vec3 dir = to.subtract(from).normalize();
        Vec3 up  = Math.abs(dir.y) > 0.9 ? new Vec3(1, 0, 0) : new Vec3(0, 1, 0);
        Vec3 side = dir.cross(up).normalize();
        Vec3 other = dir.cross(side).normalize();
        Vec3 base = to.subtract(dir.scale(headLen));
        for (Vec3 s : new Vec3[]{ side, side.scale(-1), other, other.scale(-1) }) {
            line(r, to, base.add(s.scale(headLen * 0.45)), c);
        }
    }

    // ---------------------------------------------------------------- 框

    /** 12 边线框，Meteor 原生 boxLines，excludeDir=0 画全 12 边 */
    public static void box(Renderer3D r, AABB box, Color c) {
        r.boxLines(box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ, c, 0);
    }

    /** 线 + 半透明面 */
    public static void filledBox(Renderer3D r, AABB box, Color side, Color line) {
        r.box(box, side, line, ShapeMode.Both, 0);
    }

    /** 四角括号：TargetESP 用，比整框更轻。ratio=每条边画的比例(0~0.5) */
    public static void cornerBox(Renderer3D r, AABB b, Color c, double ratio) {
        double dx = (b.maxX - b.minX) * ratio, dy = (b.maxY - b.minY) * ratio,
               dz = (b.maxZ - b.minZ) * ratio;
        for (double x : new double[]{ b.minX, b.maxX })
          for (double y : new double[]{ b.minY, b.maxY })
            for (double z : new double[]{ b.minZ, b.maxZ }) {
                r.line(x, y, z, x + (x == b.minX ? dx : -dx), y, z, c);
                r.line(x, y, z, x, y + (y == b.minY ? dy : -dy), z, c);
                r.line(x, y, z, x, y, z + (z == b.minZ ? dz : -dz), c);
            }
    }

    /** 交叉框：每个面画 X，对应 Wurst drawCrossBox */
    public static void crossBox(Renderer3D r, AABB b, Color c) {
        double[][] xs = {{b.minX, b.maxX}, {b.minY, b.maxY}, {b.minZ, b.maxZ}};
        for (int axis = 0; axis < 3; axis++) {
            double lo = xs[axis][0], hi = xs[axis][1];
            // 在垂直于 axis 的两个面上各画两条对角线
            // 省略重复推导，实现见 src/CometShapes.java
        }
        box(r, b, c);
    }

    /** 八面体节点，对应 Wurst drawNode */
    public static void node(Renderer3D r, Vec3 center, double s, Color c) {
        Vec3[] v = { center.add(s,0,0), center.add(-s,0,0), center.add(0,s,0),
                     center.add(0,-s,0), center.add(0,0,s), center.add(0,0,-s) };
        int[][] e = {{0,2},{0,3},{0,4},{0,5},{1,2},{1,3},{1,4},{1,5},
                     {2,4},{2,5},{3,4},{3,5}};
        for (int[] p : e) line(r, v[p[0]], v[p[1]], c);
    }

    /** 光柱：底面方框 + 四条竖线 + 顶面方框，路径点/容器 ESP 用 */
    public static void beam(Renderer3D r, double x, double z, double y0, double y1,
                            double half, Color c) {
        AABB b = new AABB(x-half, y0, z-half, x+half, y1, z+half);
        box(r, b, c);
    }

    /** 批量框：一次事件里画 N 个，Meteor 的 MeshBuilder 自动扩容 */
    public static void boxes(Renderer3D r, Iterable<AABB> list, Color c) {
        for (AABB b : list) box(r, b, c);
    }

    // ---------------------------------------------------------------- 圆 / 环 / 图案

    /** 水平圆环（脚下光环），segments 由性能档决定 */
    public static void ring(Renderer3D r, double cx, double cy, double cz,
                            double radius, double yOffset, int segments, Color c) {
        double px = cx + radius, pz = cz;
        for (int i = 1; i <= segments; i++) {
            double a = TAU * i / segments;
            double x = cx + Math.cos(a) * radius, z = cz + Math.sin(a) * radius;
            r.line(px, cy + yOffset, pz, x, cy + yOffset, z, c);
            px = x; pz = z;
        }
    }

    /** 任意极坐标形状：radiusFn 由 CometGeometry 提供（见 04 卷 17 图案） */
    public static void polarShape(Renderer3D r, double cx, double cy, double cz,
                                  double radius, int segments,
                                  java.util.function.DoubleUnaryOperator radiusFn, Color c) {
        double px = 0, pz = 0;
        for (int i = 0; i <= segments; i++) {
            double a = TAU * i / segments;
            double rr = radius * radiusFn.applyAsDouble(a);
            double x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
            if (i > 0) r.line(px, cy, pz, x, cy, z, c);
            px = x; pz = z;
        }
    }

    /** 带顶点发光的几何图案：尖角处画短放射线 */
    public static void tips(Renderer3D r, double cx, double cy, double cz,
                            double radius, int tipCount, double phase,
                            java.util.function.DoubleUnaryOperator radiusFn, Color c) {
        for (int i = 0; i < tipCount; i++) {
            double a = phase + TAU * i / tipCount;
            double rr = radius * radiusFn.applyAsDouble(a);
            double x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
            r.line(x, cy, z, cx + Math.cos(a) * (rr + 0.18), cy, z + Math.sin(a) * (rr + 0.18), c);
        }
    }

    /** 竖直圆环（目标光环 targetring），法线朝相机的近似：绕 Y 轴旋转的圆 */
    public static void verticalRing(Renderer3D r, Vec3 center, double radius,
                                    int segments, double yaw, Color c) {
        double cos = Math.cos(yaw), sin = Math.sin(yaw);
        Vec3 prev = null;
        for (int i = 0; i <= segments; i++) {
            double a = TAU * i / segments;
            double lx = Math.cos(a) * radius, ly = Math.sin(a) * radius;
            Vec3 p = center.add(lx * cos, ly, lx * sin);
            if (prev != null) line(r, prev, p, c);
            prev = p;
        }
    }
}
```

> `Color.copy().a(...)` 是 Meteor `Color` 的真实方法；若所用版本字段名不同，用 `new Color(c.r, c.g, c.b, alpha)` 兜底。`ShapeMode` 与 `Dir` 在 `meteordevelopment.meteorclient.utils.world.Dir`。

---

## 4. `CometShapes2D` —— 屏幕空间（面板 / 雷达 / HUD 底）

Meteor 的 `Renderer2D.COLOR` 提供 `quad / line / boxLines / triangle / texQuad`，`GuiRenderer` 另外提供 `quad / triangle / text / scissorStart / setAlpha`。缺的是**圆角矩形、渐变、圆、圆弧**，补上：

```java
package com.bigpixel.comet.render;

import meteordevelopment.meteorclient.gui.renderer.GuiRenderer;
import meteordevelopment.meteorclient.utils.render.color.Color;

public final class CometShapes2D {
    private CometShapes2D() {}
    private static final double TAU = Math.PI * 2;

    /** 圆角矩形：四角各用 cornerSeg 个三角形扇形，中间用两个 quad 填 */
    public static void roundedRect(GuiRenderer g, double x, double y, double w, double h,
                                   double radius, int cornerSeg, Color c) {
        double rad = Math.min(radius, Math.min(w, h) / 2);
        g.quad(x + rad, y, w - 2 * rad, h, c);
        g.quad(x, y + rad, rad, h - 2 * rad, c);
        g.quad(x + w - rad, y + rad, rad, h - 2 * rad, c);
        double[][] cc = {{x+rad,y+rad,180},{x+w-rad,y+rad,270},
                         {x+w-rad,y+h-rad,0},{x+rad,y+h-rad,90}};
        for (double[] q : cc) sector(g, q[0], q[1], rad, q[2], cornerSeg, c);
    }

    private static void sector(GuiRenderer g, double cx, double cy, double rad,
                               double startDeg, int seg, Color c) {
        double step = 90.0 / seg;
        for (int i = 0; i < seg; i++) {
            double a1 = Math.toRadians(startDeg + i * step);
            double a2 = Math.toRadians(startDeg + (i + 1) * step);
            g.triangle(cx, cy,
                       cx + Math.cos(a1)*rad, cy + Math.sin(a1)*rad,
                       cx + Math.cos(a2)*rad, cy + Math.sin(a2)*rad, c);
        }
    }

    /** 圆角描边：用短线段拼，线宽由 GUI 层 texture 或多次偏移模拟 */
    public static void roundedOutline(GuiRenderer g, double x, double y, double w, double h,
                                      double radius, int seg, Color c) {
        // 上/下/左/右四条直线 + 四角折线，实现见 src/
    }

    /** 圆 / 圆环 / 扇形（雷达、FPS 环形图、光晕） */
    public static void circle(GuiRenderer g, double cx, double cy, double rad, int seg, Color c) {
        for (int i = 0; i < seg; i++) {
            double a1 = TAU*i/seg, a2 = TAU*(i+1)/seg;
            g.triangle(cx, cy, cx+Math.cos(a1)*rad, cy+Math.sin(a1)*rad,
                             cx+Math.cos(a2)*rad, cy+Math.sin(a2)*rad, c);
        }
    }
    public static void arc(GuiRenderer g, double cx, double cy, double rad,
                           double from, double to, int seg, Color c) { ... }
    public static void ring2d(GuiRenderer g, double cx, double cy, double outer,
                              double inner, int seg, Color c) { ... }

    /** 四角线性渐变：GuiRenderer 原生 quad 支持四角颜色 */
    public static void gradientRect(GuiRenderer g, double x, double y, double w, double h,
                                    Color tl, Color tr, Color br, Color bl) {
        g.quad(x, y, w, h, tl, tr, br, bl);
    }

    /** 高光 sheen：三层渐变叠在面板顶部，对应 CSS .cm-sheen */
    public static void sheen(GuiRenderer g, double x, double y, double w, double h, Color base) {
        gradientRect(g, x, y, w, h * 0.32,
            base.copy().a(46), base.copy().a(20), base.copy().a(0), base.copy().a(0));
        gradientRect(g, x, y, w, 1.2,
            base.copy().a(70), base.copy().a(70), base.copy().a(0), base.copy().a(0));
    }
}
```

`GuiRenderer.scissorStart(x,y,w,h)` / `scissorEnd()` 做圆形裁剪区、滚动列表裁剪，直接调，不用自己碰 GL scissor。

---

## 5. 事件注册（真实写法）

```java
package com.bigpixel.comet.fx;

import meteordevelopment.meteorclient.MeteorClient;
import meteordevelopment.meteorclient.events.render.Render3DEvent;
import meteordevelopment.meteorclient.events.render.Render2DEvent;
import meteordevelopment.meteorclient.events.world.TickEvent;
import meteordevelopment.orbit.EventHandler;

public final class CometRenderEvents {
    private CometRenderEvents() {}

    public static void register() {
        MeteorClient.EVENT_BUS.subscribe(CometRenderEvents.class);   // 静态 @EventHandler
    }

    @EventHandler
    private static void onRender3D(Render3DEvent e) {
        // e.renderer 穿墙 / e.depthRenderer 吃深度
        // e.tickDelta 用于插值，e.offsetX/Y/Z 是相机世界坐标（算距离用）
        CometFxWorld.render(e);
    }

    @EventHandler
    private static void onRender2D(Render2DEvent e) {
        CometFxScreen.render(e);
    }

    @EventHandler
    private static void onTick(TickEvent.Post e) {
        CometFxWorld.tick();
    }
}
```

`@EventHandler` 来自 `meteordevelopment.orbit`（Meteor 自带事件库），静态类用 `subscribe(Class)`，实例用 `subscribe(Object)`。`Modules` 里的模块则在 `onActivate()` 里由 Meteor 自动订阅。

---

## 6. 自定义渲染管线（玻璃 / 辉光 / 光环需要）

沿用 `MeteorRenderPipelines` 的 `ExtendedRenderPipelineBuilder` 写法，注册自己的管线：

```java
public static final RenderPipeline COMET_BLUR = add(new ExtendedRenderPipelineBuilder(MESH_UNIFORMS)
    .withLocation(MeteorClient.identifier("pipeline/comet_blur"))
    .withVertexBinding(0, DefaultVertexFormat.POSITION_TEX)
    .withPrimitiveTopology(PrimitiveTopology.TRIANGLES)
    .withVertexShader(MeteorClient.identifier("shaders/comet_blur.vsh"))
    .withFragmentShader(MeteorClient.identifier("shaders/comet_blur.fsh"))
    .withDepthStencilState(new DepthStencilState(CompareOp.ALWAYS_PASS, false))
    .withColorTargetState(new ColorTargetState(BlendFunction.TRANSLUCENT))
    .withCull(false)
    .build());
```

shader 文件放 `src/main/resources/assets/meteor-client/shaders/`（若做独立 addon，路径前缀换成自己的 modid）。完整 GLSL 见 `02-glass-ui.md`。

**线宽问题**：`WORLD_COLORED_LINES` 用了 `.withLineSmooth()`，但驱动普遍把 `lineWidth` 钳到 1.0。要粗线必须自己把线段扩成 ribbon quad（两条线段 → 四个顶点 → 两个三角形），04 卷光环的 `ribbon` 就是干这个的。

---

## 7. 性能分级（沿用 Meteor 的 `Modules.get()` 与自己的设置）

| 档位 | ring segments | ESP 上限 | 粒子数 | 模糊降采样 |
|---|---|---|---|---|
| 省电 | 48 | 32 | 40 | 1/4 |
| 均衡 | 96 | 96 | 110 | 1/2 |
| 绚丽 | 160 | 256 | 240 | 1/2 + 两趟 |

每帧按 `Minecraft.getInstance().getFps()` 做滑窗，低于 45 自动降档。所有 `ring/ring2d/circle` 的 `segments` 都从这张表取，不写死常数。

---

## 8. 验收（肉眼可见）

- 站在一个方块前，`box()` 画出的 12 边框**严丝合缝贴住方块**，不随视角移动而漂移 → 说明坐标语义对了
- 隔着墙能看到 `event.renderer` 画的框，走到墙后 `event.depthRenderer` 画的标记被遮住 → 双实例对了
- 一帧画 200 个框不掉帧 → `MeshBuilder` 批量生效，没有重复 `render()`
- `roundedRect` 四角无锯齿缺口、`scissorStart` 裁剪内外的文字边界干净 → 2D 层对了
