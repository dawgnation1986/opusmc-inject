# 02 · 玻璃 UI：模糊管线、主题、组件树

**对应 Meteor 源码**：`gui/GuiTheme.java`（390 行，抽象基类）、`gui/themes/meteor/MeteorGuiTheme.java`（422 行）、`gui/renderer/GuiRenderer.java`（288 行）、`gui/WidgetScreen.java`、`gui/widgets/WWidget.java`、`gui/widgets/containers/WWindow.java`、`renderer/MeteorRenderPipelines.java`。
**要实现**：`backdrop-filter: blur(30px) saturate(180%) brightness(1.05)` 的等价物、面板 10px 模糊、dim 3px、sheen 三层渐变、圆角/边框/双层阴影/inset 高光、三档外观预设、开合过渡动画，以及完整 ClickGUI 组件树。

---

## 1. 网页 CSS 在 Java 里没有等价物，必须先说清

彗星 userscript 里玻璃效果是一行 CSS：

```css
backdrop-filter: blur(30px) saturate(180%) brightness(1.05);
```

Minecraft 的 GUI 渲染没有「 backdrop 」概念 —— 没有 DOM 层，也没有浏览器合成器自动把下层画面喂给 shader。要做出同样效果，得自己：

1. 把**已经画好的场景**（`mainRenderTarget`）拷到一张离屏纹理
2. 对这张纹理做**可分离高斯模糊**（水平一趟 + 垂直一趟，比二维卷积省一个数量级）
3. 在合成 shader 里做 `saturate` / `brightness` / 圆角 SDF `discard`
4. 把结果盖到面板矩形上，再画边框、阴影、高光、文字

Meteor 已经做了类似的事：`PostProcessShaders`（ESP 描边 / Chams）和 `MeshRenderer` 的 `.attachments(mainRenderTarget)`。我们照这个机制加自己的管线即可，不用碰 mixin。

**时机**：`GameRendererMixin` 在 `renderLevel` 尾部 post `RenderAfterWorldEvent`；GUI 阶段用 `Render2DEvent` / `HudRenderer` 之前做模糊，否则会把 HUD 自己糊进去。模糊只取「世界画面」，不取已画的 UI。

---

## 2. 参数表（从彗星 CSS 与 `APPEARANCE_PRESETS` 逐条抄下来）

| 元素 | 参数 | 值 |
|---|---|---|
| 主面板 | blur | 30px（σ≈12） |
| | saturate | 180% (1.8) |
| | brightness | 105% (1.05) |
| | 背景 | 四段白渐变叠加，整体 alpha ≈ 0.10 |
| | 边框 | 1px，白 alpha 0.18 |
| | 外阴影 | `0 12px 40px rgba(0,0,0,.45)` + `0 2px 8px rgba(0,0,0,.3)` |
| | inset 高光 | 上 1px 白 0.35 + 左 1px 白 0.12 |
| | 圆角 | 14 |
| 子面板 | blur | 10px（σ≈4） |
| | saturate | 150% (1.5) |
| | 圆角 | 9 |
| dim 遮罩 | blur | 3px |
| | 背景 | 径向渐变，中心透 0.15 → 边缘 0.55 |
| sheen | 三层线性渐变 | 顶部白 0.18 → 透明；顶边 1px 白 0.27；斜向白 0.06 |
| HUD 胶囊 | blur | 18px / saturate 175% |
| 下拉 / 控件 | 圆角 | 20 / 24 |
| 文字 | 主色 | `#e8eaf2`，text-shadow `0 1px 2px rgba(0,0,0,.6)` |
| 三档预设 | 绚丽 | accent `#b06bff`, glow 14, blur 18, radius 14, anim 1.3, saturate 1.5, bg `#10121c`, border .75 |
| | 平缓 | accent `#6f9bd1`, glow 5, blur 8, radius 9, anim .6, saturate 1.05, bg `#141821`, border .45 |
| | 基本 | accent `#8a8f99`, glow 0, blur 0, radius 4, anim 0, saturate .8, bg `#0d1016`, border .25 |

**主题与预设是正交的两件事**：`theme` 决定「是不是玻璃」（渲染路径不同），`preset` 决定「玻璃有多浓」（同一路径的数值）。别混成一个枚举。

---

## 3. 完整 GLSL

### `assets/comet/shaders/comet_blur.vsh`

```glsl
#version 330 core

in vec2 Position;
out vec2 uv;

void main() {
    uv = Position * 0.5 + 0.5;
    gl_Position = vec4(Position, 0.0, 1.0);
}
```

> 若 RenderPearl 的 `POSITION_TEX` 顶点属性名为 `Position` / `UV`，把 `uv` 改为 `UV` 直接传；以实际 `DefaultVertexFormat` 为准。

### `assets/comet/shaders/comet_blur.fsh` —— 9-tap 可分离高斯

```glsl
#version 330 core

uniform sampler2D InSampler;   // 上一趟结果（第一趟是场景副本）
uniform vec2 Direction;        // (1/w, 0) 水平 / (0, 1/h) 垂直
uniform float Radius;          // 采样步长倍数，主面板 1.0 / 子面板 0.45

in vec2 uv;
out vec4 fragColor;

const float W[5] = float[5](0.227027, 0.194594, 0.121621, 0.054054, 0.016216);

void main() {
    vec4 sum = texture(InSampler, uv) * W[0];
    for (int i = 1; i < 5; i++) {
        vec2 off = Direction * float(i) * Radius;
        sum += texture(InSampler, uv + off) * W[i];
        sum += texture(InSampler, uv - off) * W[i];
    }
    fragColor = sum;
}
```

### `assets/comet/shaders/comet_composite.fsh` —— saturate / brightness / 圆角 SDF

```glsl
#version 330 core

uniform sampler2D SceneSampler;   // 模糊后的场景
uniform vec4  Rect;               // 面板矩形 (x, y, w, h)，屏幕像素
uniform vec2  ScreenSize;
uniform float Radius;             // 圆角半径
uniform float Saturate;           // 1.8 / 1.5 / 0.8
uniform float Brightness;         // 1.05
uniform vec4  Tint;               // rgba 背景叠色
uniform vec4  BorderColor;
uniform float BorderWidth;
uniform float Time;               // sheen 流动

in vec2 uv;
out vec4 fragColor;

float roundedBoxSDF(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
    vec2 pixel = uv * ScreenSize;
    vec2 center = Rect.xy + Rect.zw * 0.5;
    vec2 local  = pixel - center;
    float d = roundedBoxSDF(local, Rect.zw * 0.5, Radius);
    if (d > 0.0) discard;                       // 圆角外不画

    vec2 texUV = pixel / ScreenSize;
    vec3 col = texture(SceneSampler, texUV).rgb;

    // saturate
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(luma), col, Saturate);
    // brightness
    col *= Brightness;

    // 背景叠色（四段白渐变的近似：上亮下暗 + 轻微斜向）
    float grad = clamp(1.0 - (pixel.y - Rect.y) / max(Rect.w, 1.0), 0.0, 1.0);
    vec3 tint = Tint.rgb * (0.65 + 0.35 * grad);
    col = mix(col, tint, Tint.a);

    // sheen：顶部高光 + 斜向流动光带
    float top = smoothstep(0.0, 0.18, grad) * (1.0 - smoothstep(0.18, 0.34, grad));
    float sweep = sin((local.x + local.y) * 0.012 - Time * 0.6) * 0.5 + 0.5;
    col += vec3(1.0) * (top * 0.10 + sweep * 0.025);

    // 边框（内描边）
    float edge = smoothstep(-BorderWidth - 1.0, -BorderWidth, d);
    col = mix(col, BorderColor.rgb, edge * BorderColor.a);

    // 圆角边缘抗锯齿
    float aa = 1.0 - smoothstep(-1.0, 0.0, d);
    fragColor = vec4(col, Tint.a + (1.0 - Tint.a) * aa);
}
```

### 管线注册

```java
public static final RenderPipeline COMET_BLUR =
    add(new ExtendedRenderPipelineBuilder(MESH_UNIFORMS)
        .withLocation(MeteorClient.identifier("pipeline/comet_blur"))
        .withVertexBinding(0, DefaultVertexFormat.POSITION_TEX)
        .withVertexShader(MeteorClient.identifier("shaders/comet_blur.vsh"))
        .withFragmentShader(MeteorClient.identifier("shaders/comet_blur.fsh"))
        .withDepthStencilState(new DepthStencilState(CompareOp.ALWAYS_PASS, false))
        .withColorTargetState(new ColorTargetState(BlendFunction.TRANSLUCENT))
        .build());
```

---

## 4. `CometGlassPipeline.java` —— ping-pong 与降级

```java
package com.bigpixel.comet.gui;

import com.mojang.blaze3d.systems.RenderSystem;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.RenderTarget;   // Yarn 名；Mojang 名同为 RenderTarget

/** 两趟高斯。所有 Framebuffer 复用，不在每帧 new。 */
public final class CometGlassPipeline {
    private static RenderTarget ping, pong;
    private static int lastW = -1, lastH = -1;
    private static boolean available = true;

    public static void ensure(int w, int h) {
        if (w == lastW && h == lastH && ping != null) return;
        release();
        ping = new RenderTarget(w, h, true, Minecraft.ON_OSX);
        pong = new RenderTarget(w, h, true, Minecraft.ON_OSX);
        ping.setClearColor(0, 0, 0, 0); pong.setClearColor(0, 0, 0, 0);
        lastW = w; lastH = h;
    }

    /** 把当前主 target 拷进 ping，做 H/V 两趟，结果留在 ping.colorTextureId */
    public static int blur(double radiusPx, double downscale) {
        if (!available) return -1;
        Minecraft mc = Minecraft.getInstance();
        int w = Math.max(1, (int)(mc.getWindow().getWidth() * downscale));
        int h = Math.max(1, (int)(mc.getWindow().getHeight() * downscale));
        ensure(w, h);
        try {
            copyMainTo(ping);
            pass(ping, pong, 1.0 / w, 0, radiusPx);   // 水平
            pass(pong, ping, 0, 1.0 / h, radiusPx);   // 垂直
            return ping.getColorTextureId();
        } catch (Throwable t) {
            available = false;                        // shader 不可用时一次性降级
            return -1;
        }
    }

    private static void pass(RenderTarget src, RenderTarget dst,
                             double dx, double dy, double radius) { /* 绑定 pipeline + uniform + 全屏 quad */ }
    private static void copyMainTo(RenderTarget dst) { /* blit mainRenderTarget */ }

    /** 降级：纯色半透明面板，视觉差一档但绝不黑屏 */
    public static boolean isAvailable() { return available; }
    public static void release() { if (ping != null) ping.destroyBuffers();
                                   if (pong != null) pong.destroyBuffers();
                                   ping = pong = null; }
}
```

**Iris / Sodium 兼容**：`RenderTarget` 的绑定状态可能被 shaderpack 占用，每趟结束要恢复 `Minecraft.getInstance().getMainRenderTarget().bindWrite(true)`；检测到 Iris 启用且自定义 shader 编译失败时走 `isAvailable() == false` 的纯色降级。别在每帧 catch 里反复重试。

**性能账**：1920×1080 半分辨率、9-tap ×2 趟 ≈ 200 万次采样，中端 GPU 约 0.6~1.2ms。主面板只糊一次，多个子面板复用同一张模糊纹理，不要每个面板各跑两趟。

---

## 5. `CometGlassTheme extends MeteorGuiTheme`

Meteor 的 `GuiTheme` 是抽象基类，`window / label / button / checkbox / slider / dropdown / section / ...` 全是抽象工厂方法。最省事、也最不容易写错的做法是**继承 `MeteorGuiTheme`**（它已实现全部工厂），只覆盖颜色设置与窗口绘制：

```java
package com.bigpixel.comet.gui;

import meteordevelopment.meteorclient.gui.themes.meteor.MeteorGuiTheme;
import meteordevelopment.meteorclient.gui.renderer.GuiRenderer;
import meteordevelopment.meteorclient.gui.widgets.WWidget;
import meteordevelopment.meteorclient.gui.widgets.containers.WWindow;
import meteordevelopment.meteorclient.gui.WidgetScreen;

public class CometGlassTheme extends MeteorGuiTheme {
    public static final CometGlassTheme INSTANCE = new CometGlassTheme();

    private CometPreset preset = CometPreset.LUX;

    public CometGlassTheme() {
        super();
        this.name = "Comet Glass";
        // 覆盖父类 SettingColor 默认值，让它跟三档预设对齐
        // （MeteorGuiTheme 里是 sgColors / sgBackgroundColors / sgOutline 等 SettingGroup）
    }

    public void setPreset(CometPreset p) { this.preset = p; }

    /** 每屏绘制前：取一张模糊纹理，供所有面板共用 */
    @Override public void beforeRender() {
        super.beforeRender();
        CometGlassPipeline.blur(preset.blurPx * 0.6, 0.5);
    }

    /** 自己的窗口类：在父类 WWindow 的背景绘制阶段换成玻璃 quad */
    @Override public WWindow window(WWidget icon, String title) {
        return new CometGlassWindow(icon, title, preset);
    }
}
```

`CometPreset` 就是参数表那三档，字段 `accent / glow / blurPx / radius / anim / saturate / bg / border`，全部 `record` + `val()` 回落，跟彗星 `APPEARANCE_PRESETS` 一一对应。

> 如果要完全独立（不继承 Meteor 主题），就得实现 `GuiTheme` 的 20+ 个抽象工厂方法，另写一套 `W*` 控件。工作量翻倍且没有收益，不推荐。

---

## 6. 面板组件树

```
WidgetScreen (CometClickGui extends WidgetScreen)
└── WWindow "Comet"                     玻璃背景 / 标题栏 / 可拖拽
    ├── WHorizontalList                 顶部分类标签
    │   └── WButton × 6                Combat / Player / Movement / Render / World / Misc
    ├── WSection "渲染"                 可折叠
    │   ├── WTable                     模块行
    │   │   ├── WLabel  "ESP"
    │   │   ├── WCheckbox enabled
    │   │   └── WButton "⚙"            打开设置
    │   └── WView                      滚动容器（scissorStart/End）
    └── WVerticalList                  底部：搜索框 / 收藏 / 主题切换
```

**只搬 UI，不搬玩法**：这个组件树里显示的是「渲染类模块」的开关与参数（ESP 颜色、光环图案、模糊强度），**不包含** KillAura 之类战斗模块的条目与逻辑。模块数据来自 `Modules.get().getGroup(Render)` 等只读查询。

窗口背景绘制（在 `WWindow.render(GuiRenderer)` 里）：

```java
@Override protected void onRender(GuiRenderer g, double mouseX, double mouseY, double delta) {
    int tex = CometGlassPipeline.blur(preset.blurPx, 0.5);
    if (tex >= 0) {
        CometComposite.draw(tex, x, y, width, height, preset);  // 圆角 SDF + saturate + sheen
    } else {
        CometShapes2D.roundedRect(g, x, y, width, height, preset.radius, 8,
                                  new Color(preset.bg).a(235));              // 降级
    }
    shadow(g, x, y, width, height);        // 两层外阴影：偏移 quad + 低 alpha
    border(g, x, y, width, height);        // 1px 边框
    CometShapes2D.sheen(g, x, y, width, height, Color.WHITE);
    super.onRender(g, mouseX, mouseY, delta);
}
```

**动画**：开合用 `openProgress`（0→1，`easeInOutCubic`），`GuiRenderer.setAlpha(openProgress)` 控整体透明度，配合 `y += (1 - p) * 12` 的位移；`anim` 系数从预设取（绚丽 1.3 / 平缓 0.6 / 基本 0）。CSS `transition` 在这里就是每帧插值，没有别的魔法。

---

## 7. 验收

- 打开 ClickGUI，能透过面板**看到背后被模糊的世界**，且 HUD 文字仍清晰 → 模糊时机与纹理来源对了
- 面板四角是圆角、边缘没有黑边或锯齿 → SDF 与 AA 对了
- 连续开关 20 次、切三档预设，不黑屏不闪 → 资源复用与降级对了
- 装 Iris + shaderpack 仍可打开（可能降级为纯色）→ 兼容路径对了
