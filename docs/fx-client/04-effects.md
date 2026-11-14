# 04 · 特效全量实现

**对应 Meteor 源码**：`renderer/Renderer3D.java`、`renderer/Renderer2D.java`、`renderer/MeshBuilder.java`、`events/render/Render3DEvent.java`、`events/render/Render2DEvent.java`、`systems/modules/render/Tracers.java`、`Trajectories.java`、`Breadcrumbs.java`、`renderer/MeteorRenderPipelines.java`。
**对应彗星 userscript**：`cmShapeRadius` 2055–2087、`drawAuraRing` 2090–2269、`playIntro` 11959–12058、`cmEase` 11948、`updateMotionBlur` 3659–3690、`simulateProj` 2671–2914。
**要实现**：脚下光环 17 图案、开场黑屏组装动画、粒子、拖影、辉光、彩虹流动、环形频谱、视角运动模糊、投掷物抛物线。

---

## 1. 光环：17 种模式的真相

彗星 `ringMode` 有 17 项，但 `cmShapeRadius` 里**只有 9 个几何 case**，另外 8 个是「半径恒为圆 + 布尔开关组合」。别照着 17 写 17 个形状函数。

| 分组 | 模式 | 差异来源 |
|---|---|---|
| 几何 9 种 | 五芒星 / 六芒星 / 三角阵 / 菱形 / 六边形 / 花瓣 / 齿轮 / 螺旋 / 星轨 | `radius(θ)` 不同 |
| 动效 8 种 | 极光 / 彩虹 / 波浪 / 脉冲 / 旋转 / 双层 / 粒子 / 音乐律动 | `rainbow / wave / pulse / spin / parts / music / layers` 布尔组合 |

**几何公式**（已从 `opusmc-hud.user.js:2058-2087` 逐行核对，`src/CometGeometry.java` 有可编译实现）：

```java
public static double radius(String shape, double a, double rad, double t, double phase) {
    double TAU = Math.PI * 2;
    return switch (shape) {
        case "五芒星" -> star(5, 0.44, a, rad, phase) * (1 + 0.06 * Math.sin(t * 2.4));
        case "六芒星" -> star(6, 0.50, a, rad, phase);
        case "三角阵" -> star(3, 0.42, a, rad, phase);
        case "菱形"   -> poly(4, a, rad, phase);
        case "六边形" -> poly(6, a, rad, phase);
        case "花瓣"   -> rad * (0.66 + 0.34 * Math.abs(Math.cos(4 * (a + phase * 0.4))));
        case "齿轮"   -> rad * (0.88 + 0.12 * (Math.cos(12 * (a + phase)) > 0 ? 1 : 0));
        case "螺旋"   -> rad * (0.35 + 0.65 * mod(a + t * 0.8 + phase, TAU) / TAU);
        case "星轨"   -> rad * (1 + 0.03 * Math.sin(a * 24 + t * 4));
        default       -> rad;                       // 圆：动效 8 种都走这里
    };
}

/** n 尖星：周期 2π/n。写成 2π/(2n) 会变成 2n 个尖 —— 五芒星变 10 尖，这个坑踩过 */
static double star(int n, double inner, double a, double rad, double phase) {
    double seg = TAU / n, u = mod(a + phase, seg), half = seg / 2;
    double f = u < half ? 1 - u / half : (u - half) / half;
    return rad * (inner + (1 - inner) * f);
}

/** 正 n 边形极坐标：直边，不是 cos 调出来的波浪圆 */
static double poly(int n, double a, double rad, double phase) {
    double seg = TAU / n, u = mod(a + phase, seg);
    return rad * Math.cos(Math.PI / n) / Math.max(0.2, Math.cos(u - seg / 2));
}
```

尖角数量 `CM_GEOM_TIPS`：五芒星 5 / 六芒星 6 / 三角阵 3 / 菱形 2 / 六边形 6 / 花瓣 8 / 齿轮 12 / 螺旋 0 / 星轨 0。五芒星与六芒星额外画**内接跳点连线**（pentagram：每次跳过一个顶点，`i → (i+2) % 5`）。

---

## 2. `CometAuraRing` —— 完整渲染器

```java
package com.bigpixel.comet.fx;

import com.bigpixel.comet.render.CometShapes;
import meteordevelopment.meteorclient.events.render.Render3DEvent;
import meteordevelopment.meteorclient.renderer.Renderer3D;
import meteordevelopment.meteorclient.utils.render.color.Color;

public final class CometAuraRing {
    private static double t;                    // 累计秒
    public static void tick(double dt) { t += dt; }

    public static void render(Render3DEvent e, CometRingConfig c) {
        if (!c.enabled) return;
        Renderer3D r = c.seeThrough ? e.renderer : e.depthRenderer;
        double px = e.offsetX, py = e.offsetY, pz = e.offsetZ;   // 玩家/相机位置
        double rad = c.range * 0.55;
        int seg = CometQuality.segments();                        // 48/96/160
        double phase = c.spin ? t * c.speed : 0;
        double y = py + 0.015;

        int layers = c.layers ? 3 : 1;
        for (int L = 0; L < layers; L++) {
            double lr = rad * (1 - L * 0.18);
            double ly = y + L * 0.22;
            double lp = phase + L * 0.7;
            Color base = c.rainbow
                ? CometColor.rainbow(t * 0.35, L * 0.22, c.alpha)
                : c.color.copy().a((int)(c.alpha * (1 - L * 0.22)));

            // 几何图案本体
            CometShapes.polarShape(r, px, ly, pz, lr, seg,
                a -> CometGeometry.radius(c.mode, a + lp, 1, t, lp), base);

            // 尖角发光点
            int tips = CometGeometry.tips(c.mode);
            if (tips > 0) CometShapes.tips(r, px, ly, pz, lr, tips, lp,
                a -> CometGeometry.radius(c.mode, a + lp, 1, t, lp), base);

            // pentagram 内接跳点
            if (c.mode.equals("五芒星") || c.mode.equals("六芒星"))
                pentagram(r, px, ly, pz, lr, tips, lp, base);

            // 波浪：沿 y 起伏
            // 脉冲：半径呼吸 1 + 0.08*sin(t*2.4)
            // 粒子 / 频谱柱：见 §3
        }
    }

    private static void pentagram(Renderer3D r, double cx, double cy, double cz,
                                  double rad, int n, double phase, Color c) {
        for (int i = 0; i < n; i++) {
            double a1 = phase + Math.PI*2*i/n, a2 = phase + Math.PI*2*((i+2)%n)/n;
            r.line(cx + Math.cos(a1)*rad, cy, cz + Math.sin(a1)*rad,
                   cx + Math.cos(a2)*rad, cy, cz + Math.sin(a2)*rad, c);
        }
    }
}
```

**彩虹**：`CometColor.rainbow(t, phase, alpha)` 按顶点角度错开色相，逐段 `gradientLine` 或逐顶点 `Color` 传给 `MeshBuilder.vec3(...).color(...)` —— 这才是 Meteor 里做渐变线的正路，不是画一堆单色短线。

**辉光 shadowBlur 的等价物**：Canvas 的 `shadowBlur` 在 RenderPearl 里没有。两条路：
- 便宜：把同一图案用 `alpha*0.25` 画 3 遍，半径 `r-0.02 / r / r+0.02`，视觉上就是一圈柔光
- 正确：离屏 `RenderTarget` 画光环 → 跑 §02 的高斯 → 加色混合回主 target（跟毛玻璃共用 `CometGlassPipeline`）

**拖影 destination-out**：Canvas 用「上一帧不清屏、叠一层半透明黑」实现。Java 里开一张 `RenderTarget trail`，每帧先画 `alpha=0.12` 的黑 quad 衰减，再叠加新图案，最后合成回主 target。**复用同一张纹理**，别每帧 new。

---

## 3. 环绕粒子与环形频谱柱

**粒子**（110 颗，绚丽档 240）：确定性伪随机，禁止 `Random`（会闪）：

```java
for (int i = 0; i < count; i++) {
    double a = t * 0.6 + i * 2.399963;                  // 黄金角
    double rr = rad * (0.6 + 0.4 * frac(i * 0.618));
    double yy = y + 0.3 + 1.2 * frac(Math.sin(i * 12.9898) * 43758.5453)
                        + 0.25 * Math.sin(t * 1.7 + i);
    Color c = CometColor.rainbow(t, i * 0.01, 180);
    // 用小 quad 或短竖线代替点精灵
    r.line(px + Math.cos(a)*rr, yy, pz + Math.sin(a)*rr,
           px + Math.cos(a)*rr, yy + 0.09, pz + Math.sin(a)*rr, c);
}
```

**频谱柱**（64 根）：网页版用 Web Audio `AnalyserNode`，Java 版没有浏览器音频总线。三条可选：
1. 用 OpenAL `alcCaptureOpenDevice` 做 loopback（能拿真实频谱，但要处理设备权限）
2. 用游戏内音乐/音效音量包络做伪律动（简单、够看）
3. 完全用 `sin` 合成的假频谱（无依赖，兜底）

接口统一成 `MusicAnalyzer.bands()` 返回 `double[64]`，三种实现可换。柱高 `h = bands[k] * 0.9`，沿环均匀排布，`gradientLine` 从底到顶渐变。

---

## 4. 开场动画：黑屏 → 逐段组装 → 转圈 → 淡出

彗星 `playIntro()` 的时间轴（已从 11981–12044 核对）：

| 进度 p | 阶段 | 关键量 |
|---|---|---|
| 0–0.08 | 纯黑幕淡入 | `veil = p/0.08`，底 `rgba(0,0,0,0.985)` |
| 0.10–0.65 | 逐段组装 | `assemble = easeInOutCubic((p-0.1)/0.55)`，`drawN = max(2, floor(240*assemble))` |
| 全程 | 碎片归位 | `settle = 1 - assemble`，`jx/jy` 由 `sin(i*12.9898+L*7.1)` 确定性生成 |
| 全程 | 持续转圈 | `spin = p * TAU * 1.7` |
| 全程 | 扩散光环 | `q = ((p*1.35 - k*0.16) % 1 + 1) % 1`，3 道 |
| 0.30–0.50 | 中央文字淡入 | `ta = easeInOutCubic((p-0.3)/0.2) * fadeOut` |
| 0.82–1.00 | 淡出 | `fadeOut = 1 - max(0,(p-0.82)/0.18)`，逐图元 + 整层 CSS `.fade` 0.55s |

Java 侧用**全屏覆盖层**（`Render2DEvent` 里最后画，或独立 `Screen` overlay），逐帧算 alpha：

```java
public final class CometIntro {
    private static boolean played, active, done;
    private static long start;
    private static double duration = 3.0, styleSeed, layerAlpha = 1;

    public static void play(CometIntroConfig c) {
        if (played || !c.enabled) return;
        played = active = true;  done = false;
        start = System.nanoTime(); duration = c.duration;
    }

    public static void render(Render2DEvent e, HudRenderer r) {
        if (!active || done) return;
        double p = Math.min(1, (System.nanoTime() - start) / 1e9 / duration);
        try {
            double fadeOut = 1 - Math.max(0, (p - 0.82) / 0.18);
            double veil    = p < 0.08 ? p / 0.08 : (p > 0.86 ? fadeOut : 1);
            double assemble= CometEase.inOutCubic(clamp((p - 0.1) / 0.55));
            double spin    = p * Math.PI * 2 * 1.7;
            int    drawN   = Math.max(2, (int)(240 * assemble));

            // ① 纯黑不透明底
            r.quad(0, 0, W, H, new Color(0,0,0,(int)(255*0.985*veil)));

            // ② 110 颗粒子从四周汇聚（黄金角 + 确定性索引）
            for (int i = 0; i < 110; i++) { ... }

            // ③ 图案逐段绘制：只画前 drawN 段，形成「组装」感
            double settle = 1 - assemble;
            for (int i = 0; i < drawN; i++) {
                double a = Math.PI*2*i/240 + spin;
                double jx = Math.sin(i*12.9898 + L*7.1) * settle * 0.35;
                double jy = Math.cos(i*78.233 + L*3.3) * settle * 0.35;
                double rr = R * CometGeometry.radius(style, a, 1, p, spin);
                // 3 层同形状不同相位，逐段连成折线
            }

            // ④ 两道构图同心圆 + 3 道扩散光环
            // ⑤ 中央文字 COMET + 版本号，alpha = ta
        } catch (Throwable ignored) {
            // 动画异常绝不能影响启动
        } finally {
            if (p >= 1) finish();
        }
    }

    private static void finish() {
        // 双层淡出：逐图元 fadeOut + 整层 620ms 的 layerAlpha（对应 CSS .fade）
        layerAlpha = 1 - CometEase.inOutCubic(...);
        if (layerAlpha <= 0) { active = false; done = true; }
    }
}
```

三个要求逐条对账：**只播一次**（`played`）、**点击跳过**（`ScreenMixin` 的 `mouseClicked` HEAD 消费点击 → `finish()`）、**异常不影响启动**（`try/catch(Throwable)` 包住整个 render）。触发点用 `TitleScreenMixin#render TAIL` 或 `ClientPlayConnectionEvents.JOIN` 兜底，二选一。

---

## 5. 视角运动模糊

彗星 `updateMotionBlur`（3659–3690）算法：

```java
double dy = normalizeAngle(yaw - lastYaw);        // ±π 归一化
double d  = Math.hypot(dy, pitch - lastPitch);
double target = Math.min(strength, d * strength * 22);
// 不对称平滑：上升快、下降按 decay
mbSmooth += (target - mbSmooth) * (target > mbSmooth ? 0.55 : decay);
```

**坑**：Java `Camera#getYaw()` 是**度**，彗星 `p.yaw` 是弧度。边界判断从 `π` 换 `180`，系数 `22` 必须按度数重新标定（约 `22 * 180/π ≈ 1260`，实际建议实测后取 `0.35` 量级），别照抄 22。

模糊半径 uniform 由 `mbSmooth` 驱动，复用 §02 的 `CometGlassPipeline`，在 `RenderAfterWorldEvent` 合成、HUD 之前，这样 HUD 文字天然保持清晰，不需要 z-index。

---

## 6. 投掷物抛物线与落点

Wurst `TrajectoriesHack` 已经给了完整物性表与模拟循环，直接照它的结构（**只搬绘制，不搬瞄准辅助**）：

```java
List<Vec3> path = new ArrayList<>();
Vec3 pos = player.getEyePosition().add(handOffset);
Vec3 vel = startMotion(yaw, pitch, throwPower);
for (int i = 0; i < 300; i++) {
    path.add(pos);
    pos = pos.add(vel.scale(0.05));
    vel = vel.add(0, -gravity * 0.05, 0).scale(drag);
    if (world.clip(...).getType() != MISS) break;
}
CometShapes.fadingPolyline(e.renderer, path, color);
CometShapes.beam(e.renderer, pos.x, pos.z, pos.y, pos.y + 0.2, 0.25, color);  // 落点框
```

物性：`throwPower`（末影珍珠/雪球/药水 1.5，三叉戟 2.2）、`gravity`（0.03/0.05）、`drag`（0.99）、流体处理。弓箭用 `solveBallistic` 解算发射角。

---

## 7. 参数表（视觉设置，全部走 Meteor `Settings`）

| 设置 | 类型 | 默认 | 范围 |
|---|---|---|---|
| `ring-enabled` | Bool | true | — |
| `ring-mode` | Enum | 五芒星 | 17 项 |
| `ring-range` | Double | 4.5 | 2–6 |
| `ring-speed` | Double | 1.0 | 0.2–3 |
| `ring-width` | Double | 2.0 | 1–5 |
| `ring-layers` | Int | 1 | 1–3 |
| `ring-glow` | Bool | true | — |
| `ring-fill` | Bool | false | — |
| `ring-rainbow` | Bool | true | — |
| `ring-particles` | Int | 110 | 0–240 |
| `fx-bars` | Bool | false | 频谱柱 |
| `fx-blur` | Bool | true | 辉光 |
| `fx-trail` | Bool | false | 拖影 |
| `intro-enabled` | Bool | true | — |
| `intro-style` | Enum | 五芒星 | 7 项 |
| `intro-duration` | Double | 3.0 | 1.5–6 |
| `intro-skip` | Bool | true | 点击跳过 |
| `mblur-strength` | Double | 0.6 | 0–1 |
| `mblur-decay` | Double | 0.1 | 0.02–0.5 |
| `glass-preset` | Enum | 绚丽 | 绚丽/平缓/基本 |

---

## 8. 验收

- 五芒星恰好 **5 个尖**（不是 10 个），六边形是**直边**（不是波浪圆）→ 公式对了
- 光环开启时脚下图案随玩家移动、隔着墙仍可见；关掉 seeThrough 被地面遮住 → 双 renderer 对了
- 开场进游戏是**纯黑 → 图形一段段接起来 → 转圈 → 淡出**，点一下能跳过，只播一次 → 时间轴对了
- 快速转视角时画面糊、停下自动淡出，HUD 文字始终清晰 → 运动模糊时机对了
- 扔雪球能看到渐隐抛物线与落点圈 → 轨迹对了
