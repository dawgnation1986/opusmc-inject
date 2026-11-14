# 03 · 启动开场动画（Boot Intro → Fabric）

> 同一个项目、同一套口径：MC Java 1.21.1 / Fabric Loader 0.16+ / Fabric API / Yarn mappings / Java 17，`ClientModInitializer` 入口，`onInitializeClient()` 里注册事件。别和别的卷混用类名和事件名。

## 卷首：源码位置、要复刻的效果、Java 侧对应概念

对应 JS 源码（`opusmc-hud.user.js` v1.31.0）：

| 位置 | 函数 / 常量 | 干什么的 |
| --- | --- | --- |
| 760–769 | `MODULES` 里 `id:'intro'` 的 `settings[]` | 4 个设置项的 schema、默认值、范围、步长 |
| 10144–10151 | CSS `#__comet_intro` / `.skippable` / `.fade` | 全屏覆盖层、点击穿透、`opacity .55s ease` 淡出 |
| 2058–2087 | `cmShapeRadius()`（02 卷共享） | 极坐标半径函数，开场动画和脚下光环共用 |
| 11944–11947 | 四段过渡注释 + `introCanvas/introRAF/introDone` | 状态三件套 |
| 11948 | `cmEase()` | 三次缓动（easeInOutCubic） |
| 11949–11958 | `cmIntroFinish()` | 收尾：加 `.fade` class、620ms 后移除 DOM |
| 11959–12058 | `playIntro()` + 内层 `frame()` | 主体，逐帧绘制全在这里 |
| 12115 | `boot()` 末尾 `try { playIntro(); } catch(e){}` | 触发点 + 异常不影响启动 |

**要复刻的效果**：客户端起来第一眼全黑，一个几何图案被一段段「组装」出来——110 颗粒子从四周往中心汇聚，三层同形状的轮廓带确定性碎片抖动逐渐归位，整圈持续自转，两道工程草图式同心圆、三道向外扩散的光环，中间淡入 `COMET` / `OpusHUD v…` 文字，最后整体淡出消失。whole 动画只播一次，点击可跳过，崩了也不影响进游戏。

它是「盖在最顶层的全屏 2D 覆盖层」：`#__comet_intro` 是 `position:fixed; inset:0; z-index:2147483647` 的 canvas，`pointer-events:none`（只有 `skippable` 时才接收点击），每帧 `clearRect` 重画。没有 3D、没有深度、没有世界坐标——这点跟 02 卷的 3D 光环不同，别把 `ringProject` 那套投影搬过来。

**Java 侧概念对照**：

| 网页 | Fabric / Java |
| --- | --- |
| `#__comet_intro` DOM canvas（顶层、无深度） | `Screen` 覆盖层 / `TitleScreen` mixin 尾部绘制 / 自定义全屏 `RenderLayer` |
| `requestAnimationFrame(frame)` | `ClientTickEvents.END_CLIENT_TICK` 推进时钟 + 每帧 render 回调 |
| `performance.now() - t0` | 累加的单调时钟（毫秒） |
| `p = min(1, elapsed/dur)` | 归一化进度 `float p` |
| `cmEase(x)` | 静态 `CmEase.ease(float)` |
| `c.fillRect` 黑幕 | `DrawContext.fill()` 带 ARGB / 全屏 quad |
| `c.arc` / `c.stroke` / `c.lineTo` | ribbon quad 折线 + `TextRenderer`（02 卷的 `strokePolyline` 可直接复用） |
| `c.fillText` | `TextRenderer.draw(...)` + `MatrixStack.scale()` 做字号 |
| `.fade { opacity:0; transition:.55s ease }` | 逐帧 alpha（`finishTimer` 线性/ease 衰减），或全屏 shader 混合 |
| `setTimeout(remove, 620)` | tick 计时器到点置 `active=false` |
| `click` → `cmIntroFinish()` | `Screen.mouseClicked` / mixin 注入消费点击 |
| `introCanvas` 非空 + `introDone` | `static AtomicBoolean played` + `active` 标志 |
| `getS('intro', …)` | `IntroConfig` POJO + Gson（02 卷 `AuraConfig` 同款） |
| 整个 `playIntro` 的 try/catch | 渲染入口 `try/catch(Throwable)` + 日志 |

**移植边界**：这卷只做开场那一下的视觉，不碰 Aura 攻击逻辑、不碰 ESP、不碰资源包 UI。`cmShapeRadius` / `ColorUtil.hsla()` / ribbon 工具从 02 卷的 `dev.opus.fabric.common` 直接 import，别复制第二份——源码 2053–2054 的注释也写了「3D 脚下光环和 2D 开场动画都用这一套极坐标半径函数」。

---

## 1. 触发链路与状态机

网页里的生命周期很干净，先照着还原，Java 侧照这个状态机搭：

```js
// 11947
let introCanvas = null, introRAF = 0, introDone = false;

// 12115，boot() 最后一行
try { playIntro(); } catch (e) { /* noop */ }

// 11959-11972，playIntro 开头
if (getS('intro','enabled') === false || introCanvas) return;   // 关了 / 已在播 → 直接退
const cv = document.createElement('canvas');                    // 建覆盖层
if (getS('intro','skip') !== false) cv.className = 'skippable';
... document.documentElement.append(cv);
introCanvas = cv; introDone = false;                            // 状态置位
cv.addEventListener('click', () => cmIntroFinish(cv), { once:true });  // 点一次就收尾
const frame = (now) => { ... if (p<1) introRAF = requestAnimationFrame(frame);
                         else cmIntroFinish(cv); };
introRAF = requestAnimationFrame(frame);

// 11949-11958，cmIntroFinish
if (introDone) return;              // 幂等
introDone = true;
cancelAnimationFrame(introRAF);
cv.classList.add('fade');           // CSS 0.55s opacity → 0
setTimeout(() => { cv.remove(); if (introCanvas===cv) introCanvas=null; }, 620);
```

三个状态变量各管一件事，别合成一个 boolean：

- `introCanvas`（非 null = 正在播）：负责「只播一次」的去重，`playIntro` 开头就查它。
- `introDone`：负责 `cmIntroFinish` 的幂等，点击跳过和自然结束都会走到它，没这个标志会重复取消 rAF / 重复 remove。
- `introRAF`：帧句柄，收尾时 `cancelAnimationFrame`。

还有一个容易忽略的**双重淡出**，Java 里必须分开处理：

1. **动画内部淡出** `fadeOut = 1 - max(0,(p-0.82)/0.18)`（11981），乘到每个图元的颜色 alpha 上（12006、12026、12038、12044 都在用）。这是「时间轴最后一段，画面内容渐渐变淡」。
2. **覆盖层淡出** `.fade { opacity:0; transition: opacity .55s ease }`（10151、10148）由 `cmIntroFinish` 加上 class 触发，把整个 canvas（连同黑幕）在 0.55 秒内淡没，620ms 后移除。这是「收尾时把整层 DOM 淡掉」。

网页里两者叠在一起：p 到 0.82 之后内容先按 `fadeOut` 变淡，p=1 时调 `cmIntroFinish` 再让整层 0.55s 淡没。Java 里没有 CSS class，得用两个独立的 alpha 源：逐帧 `fadeOut` 乘图元色，收尾用一个 `finishTimer`（0.55s）控制整层全局 alpha。

---

## 2. 四段过渡：完整时间轴表

源码注释（11945）写的是「粒子汇聚(0~.32) → 图案成形(.16~.5) → 光环扩散(全程) → 淡出(.82~1)」，那是**视觉阶段**的描述；实际代码里的**关键阈值**是另一组数字（12081 的 `fadeOut`、11984 的 `veil`、11987 的 `assemble`、12001 的 `grow`、12044 的 `ta`）。两张嘴说的是同一段动画，别只抄注释就开写。下面按「归一化进度 `p = min(1, (now-t0)/dur)`」把两者对齐：

| 段 | p 区间 | 关键变量 / 公式 | 视觉 | Java 侧 |
| --- | --- | --- | --- | --- |
| ① 黑幕淡入 | `0 ~ 0.08` | `veil = p/0.08`（11984） | 全屏黑从 0 涨到 `0.985`，纯黑打底 | 全屏 quad，alpha = `0.985 * veil` |
| ② 逐段组装 | `0.1 ~ 0.65` | `assemble = cmEase(clamp((p-0.1)/0.55))`（11987）；`grow = cmEase(clamp((p-0.1)/0.45))`（12001）；`drawN = max(2, floor(240*assemble))`（12004） | 粒子汇聚、轮廓从 2 个点长到 240 个点、碎片归位、三层同形状成形 | 逐帧 ribbon，`drawN` 控制画多少段 |
| ②b 粒子汇聚 | `0 ~ 0.32`（视觉），代码由 `gather=assemble` 驱动，p>0.5 后渐隐（11995） | 110 颗，黄金角散布，`dist ∝ (1-gather)` | 四周亮点往中心收 | 110 个 quad，`gather` 控半径 |
| ③ 扩散光环 | **全程** `0 ~ 1` | `q = ((p*1.35 - k*0.16)%1 + 1)%1`，k=0,1,2（12036） | 三道带相位差的圆环一直往外扩、往外淡 | 三道圆，随 p 循环 |
| ③b 转圈 | 全程 | `spin = p*TAU*1.7`（12003） | 主图案整圈持续自转（约 1.7 圈） | 极角加 `spin` |
| ④ 淡出 | `0.86 ~ 1` | `veil = fadeOut`（p>0.86 分支，11984）；`fadeOut = 1 - max(0,(p-0.82)/0.18)`（11981） | 黑幕和内容一起淡没 | 逐帧 alpha 乘图元 |
| 收尾 | p = 1 | `cmIntroFinish`（12054） | CSS `.fade` 0.55s 整层淡没，620ms 后移除 | `finishTimer` 全局 alpha，到点 `active=false` |

几个数字的出处，逐个钉死，别凭感觉写：

- `0.985` 是黑幕 alpha 上限（11985），不是 1.0，留了一丁点透底。
- `assemble` 的分母 `0.55` → 从 p=0.1 到 p=0.65 刚好走满（11987）。
- `grow` 的分母 `0.45` → 从 p=0.1 到 p=0.55 走满，比 assemble 早结束（12001）。
- `drawN = floor(240 * assemble)`，最低 2（12004），所以 240 是轮廓的总采样点数，`i/240*TAU` 是角度（12015）。
- `spin = p * TAU * 1.7`（12003），整个动画转约 1.7 圈。
- `ta = cmEase(clamp((p-0.3)/0.2)) * fadeOut`（12044），文字在 p=0.3~0.5 淡入。
- 扩散光环 `q` 的 `p*1.35` 意味着每道环在动画里循环约 1.35 次，`k*0.16` 是三道环的相位差。

`dur` 的处理有处「设置范围和代码 clamp 不一致」：设置项 `duration` 是 `1.5~6`、步长 0.5、默认 3（766 行），但代码 11974 又 `Math.max(1.2, Math.min(8, Number(...)||3))` 额外 clamp 到 `[1.2, 8]` 秒。照抄时两边都留：GUI 按 1.5~6 约束，运行时按 `[1.2, 8]` 兜底，防止手改配置写出离谱值。

---

## 3. `cmEase()` 三次缓动 → Java

源码 11948 一行：

```js
function cmEase(x) { return x < 0.5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3)/2; }
```

标准 easeInOutCubic。Java 版，配一个 clamp 工具（源码里到处 `Math.min(1, Math.max(0, ...))`）：

```java
package dev.opus.fabric.common;

/** 对应 cmEase（11948），easeInOutCubic。开场动画与光环共用。 */
public final class CmEase {
    private CmEase() {}

    public static float clamp01(float x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

    /** x 已假定在 [0,1]；越界请先 clamp01。 */
    public static float ease(float x) {
        return x < 0.5f
                ? 4f * x * x * x
                : 1f - (float) Math.pow(-2f * x + 2f, 3) / 2f;
    }

    /** 组合：对应 cmEase(clamp01((p - start) / span)) 的高频写法。 */
    public static float window(float p, float start, float span) {
        return ease(clamp01((p - start) / span));
    }
}
```

动画里用到 `cmEase` 的四处，全用 `window` 表达：

```java
float assemble = CmEase.window(p, 0.10f, 0.55f);   // 11987
float grow     = CmEase.window(p, 0.10f, 0.45f);   // 12001
float ta       = CmEase.window(p, 0.30f, 0.20f);   // 12044（后面再乘 fadeOut）
```

`cmEase` 在 02 卷没用到（光环用的是裸 `sin`），但放 `common` 包没错，两卷共享工具类别各建一份。

---

## 4. 逐帧绘制：四层内容逐个还原

`frame()` 每帧开头 `c.clearRect(0,0,W_,H_)`（11982）——Java 里 Screen 覆盖层本身不攒批，每帧重画即可，不用手动清（DrawContext 是即时的）。尺寸用 `mc.getWindow().getFramebufferWidth/Height()`，对应源码里 `innerWidth*dpr`（DPR 已含在 framebuffer 尺寸里），`X = W/2, Y = H/2`。

### 4.1 纯黑不透明底（11984–11986）

```js
const veil = p < 0.08 ? p/0.08 : (p > 0.86 ? fadeOut : 1);
c.fillStyle = 'rgba(0,0,0,' + (0.985 * clamp(veil)).toFixed(3) + ')';
c.fillRect(0, 0, W_, H_);
```

`p<0.08` 淡入，`p>0.86` 用 `fadeOut` 淡出，中间恒 1。Java：

```java
float veil = p < 0.08f ? p / 0.08f : (p > 0.86f ? fadeOut : 1f);
int veilArgb = ColorUtil.argb("#000000", 0.985f * CmEase.clamp01(veil));
ctx.fill(0, 0, W, H, veilArgb);   // DrawContext.fill(x1,y1,x2,y2,argb)
```

`DrawContext.fill` 带 ARGB，天然支持半透明黑幕，不需要额外 RenderLayer。注意顺序：黑幕是每帧**第一个**画的，后面所有内容盖在它上面。

### 4.2 110 颗粒子汇聚（11989–11998）

```js
const gather = assemble;
for (let i = 0; i < 110; i++) {
  const a = i * 2.399963;                                  // 黄金角 ≈ 137.5077°
  const dist = (0.55 + 0.45*((i*37)%100)/100) * (1-gather) * max(W,H)*0.62;
  const px = X + cos(a)*dist, py = Y + sin(a)*dist;
  const al = (0.25 + 0.75*gather) * max(0, 1 - max(0,(p-0.5)/0.5));
  c.fillStyle = 'hsla(' + round((i*7 + p*180)%360) + ',95%,72%,' + al + ')';
  c.arc(px, py, (1.2 + 1.8*abs(sin(i)))*dpr, 0, TAU); c.fill();
}
```

三个确定性成分，一个 `Math.random()` 都没有——这是「不闪烁」的关键，Java 里也别用 `Random`：

- 角度 `a = i*2.399963`（黄金角，把 110 颗均匀铺开不成放射状条纹）。
- 半径系数 `0.55 + 0.45*((i*37)%100)/100`，`(i*37)%100` 是整数散列。
- 点半径 `1.2 + 1.8*abs(sin(i))`，也是 i 的确定性函数。

`dist ∝ (1-gather)`：gather 从 0 到 1，粒子从 `max(W,H)*0.62` 的外圈收到中心。`al` 在 p>0.5 后线性降到 0（11995 那个 `1 - max(0,(p-0.5)/0.5)`），所以粒子下半程渐隐、把舞台让给主图案。Java：

```java
for (int i = 0; i < 110; i++) {
    double a = i * 2.399963;
    double dist = (0.55 + 0.45 * ((i * 37) % 100) / 100.0)
                * (1 - gather) * Math.max(W, H) * 0.62;
    double px = X + Math.cos(a) * dist, py = Y + Math.sin(a) * dist;
    float al = (float) ((0.25 + 0.75 * gather)
              * Math.max(0, 1 - Math.max(0, (p - 0.5) / 0.5)));
    int col = ColorUtil.hsla((i * 7 + p * 180) % 360f, 0.95f, 0.72f, al);
    float r = (float) (1.2 + 1.8 * Math.abs(Math.sin(i))) * dpr;
    DrawUtil.fillCircle(ctx, (float) px, (float) py, r, col);   // 小 quad / 圆近似
}
```

`hsla()` 直接用 02 卷 `ColorUtil` 的那个。`dpr` 在 Java 里等价于窗口缩放系数（`mc.getWindow().getScaleFactor()`），framebuffer 尺寸已经乘过，单独调字号/点半径时用。

### 4.3 主图案：逐段绘制、碎片归位、三层同形状、spinning（12000–12032）

这是最核心的一段。先构图圆，再三层层叠轮廓。

```js
const grow = cmEase(clamp((p-0.1)/0.45));
const R = min(W,H)*0.26*grow;
const spin = p*TAU*1.7;
const drawN = max(2, floor(240*assemble));

// 两道构图同心圆（工程草图感）
c.strokeStyle = 'rgba(150,180,240,' + (0.18*assemble*fadeOut) + ')';
c.lineWidth = 1*dpr;
for (let k = 1; k <= 2; k++) {
  c.arc(X, Y, min(W,H)*0.13*k*grow, 0, TAU); c.stroke();
}

// 三层同形状不同相位
for (let L = 0; L < 3; L++) {
  const rad = R*(1 - L*0.16);
  c.beginPath();
  for (let i = 0; i <= drawN; i++) {
    const a = i/240*TAU;
    const rr = cmShapeRadius(style, a, rad, p*3, spin + L*0.4, 1);
    const settle = 1 - assemble;
    const jx = sin(i*12.9898 + L*7.1) * min(W,H)*0.16;
    const jy = cos(i*78.233 + L*3.3) * min(W,H)*0.16;
    const px = X + cos(a)*rr + settle*jx;
    const py = Y + sin(a)*rr + settle*jy;
    if (i) c.lineTo(px,py); else c.moveTo(px,py);
  }
  if (assemble >= 1) c.closePath();
  c.strokeStyle = 'hsla(' + round((p*220 + L*60)%360) + ',92%,70%,'
                + (0.78*fadeOut*(1-L*0.22)) + ')';
  c.lineWidth = (3.2 - L*0.7)*dpr;
  c.shadowColor = '#8ab4ff'; c.shadowBlur = 18*dpr;
  c.stroke();
}
c.shadowBlur = 0;
```

逐个拆：

- **`R = min(W,H)*0.26*grow`**：主图案半径，`grow` 从 0 长起，图案是「长大」出来的，不是淡入出来的。
- **`drawN = max(2, floor(240*assemble))`**：逐段绘制。轮廓总共 240 个采样点，每帧只画前 `drawN` 个，`assemble` 涨到 1 才画满并 `closePath()`。`i/240*TAU` 是角度——注意分母是常数 240，不是 `drawN`，所以未画到的部分是「还没接上的线」，不是把整圈压缩。
- **碎片归位 jitter（确定性伪随机）**：`settle = 1 - assemble`，`jx/jy` 是 `sin(i*12.9898 + L*7.1)` / `cos(i*78.233 + L*3.3)` 乘 `min(W,H)*0.16`。每个顶点有固定散开偏移，`settle` 从 1 衰减到 0，顶点从散开位置**插值**回目标点。系数 12.9898 / 78.233 是经典 GLSL hash 常数，纯确定性，不闪烁。
- **`spin = p*TAU*1.7` 转圈**：整圈持续自转约 1.7 圈，角度里通过 `cmShapeRadius` 的 `phase` 参数生效（`spin + L*0.4`）。
- **三层同形状不同相位**：`L=0,1,2`，半径 `R*(1-L*0.16)` 逐层收 16%，相位 `spin + L*0.4`，颜色 `hsla((p*220+L*60)%360, 92%, 70%, 0.78*fadeOut*(1-L*0.22))`，线宽 `(3.2-L*0.7)*dpr`。三层用同一个 `style`，`cmShapeRadius` 的 `t` 实参是 `p*3`（不是全局秒数！），`wobble` 传 1。
- **两道构图同心圆**：`k=1,2`，半径 `min(W,H)*0.13*k*grow`，颜色 `rgba(150,180,240, 0.18*assemble*fadeOut)`，线宽 `1*dpr`。
- **`shadowBlur = 18*dpr`**（12029）：三层轮廓带蓝色辉光。Java 里对应 02 卷的全屏后处理（RenderTarget + 两趟高斯），或省事一点直接把轮廓画两遍（一遍粗+低 alpha 当光晕、一遍细+高 alpha 当实线）。开场动画只播一次、时长几秒，用离屏高斯不算浪费；但要是想零依赖，粗描边那招视觉上够用——这是个明确取舍，别默认上全套后处理。

Java 版：

```java
float grow  = CmEase.window(p, 0.10f, 0.45f);
float R     = (float) (Math.min(W, H) * 0.26 * grow);
float spin  = (float) (p * ShapeRadius.TAU * 1.7);
int   drawN = Math.max(2, (int) Math.floor(240 * assemble));
float dpr   = (float) mc.getWindow().getScaleFactor();

// 两道构图同心圆
int guide = ColorUtil.argb("#96b4f0", 0.18f * assemble * fadeOut);
DrawUtil.strokeCircle(ctx, X, Y, Math.min(W,H)*0.13f*grow*dpr, 1f*dpr, guide);
DrawUtil.strokeCircle(ctx, X, Y, Math.min(W,H)*0.26f*grow*dpr, 1f*dpr, guide);

for (int L = 0; L < 3; L++) {
    float rad = R * (1 - L * 0.16f);
    ProjectUtil.Pt[] poly = new ProjectUtil.Pt[drawN + 1];
    for (int i = 0; i <= drawN; i++) {
        double a = (double) i / 240 * ShapeRadius.TAU;
        double rr = ShapeRadius.radius(cfg.style, a, rad, p * 3.0, spin + L * 0.4, 1);
        double settle = 1 - assemble;
        double jx = Math.sin(i * 12.9898 + L * 7.1) * Math.min(W, H) * 0.16;
        double jy = Math.cos(i * 78.233 + L * 3.3) * Math.min(W, H) * 0.16;
        double px = X + Math.cos(a) * rr + settle * jx;
        double py = Y + Math.sin(a) * rr + settle * jy;
        poly[i] = new ProjectUtil.Pt((float) px, (float) py);
    }
    int[] cols = new int[poly.length];
    int c = ColorUtil.hsla((p * 220 + L * 60) % 360f, 0.92f, 0.70f,
                           0.78f * fadeOut * (1 - L * 0.22f));
    java.util.Arrays.fill(cols, c);
    // 逐段：assemble>=1 才闭合（对应 12025 的 closePath）
    AuraMath.strokePolyline(vc, ctx.getMatrices(),
                            assemble >= 1 ? close(poly) : poly,
                            cols, (3.2f - L * 0.7f) * dpr);
}
```

`close(poly)` 是把首点追加到末尾（对应 `closePath()`），`assemble < 1` 时保持开口。`cmShapeRadius` 的 `t` 传 `p*3` 这个别照抄成全局时钟——源码 12016 明明白白是 `p*3`。

### 4.4 三道扩散光环（12034–12041）

```js
for (let k = 0; k < 3; k++) {
  const q = ((p*1.35 - k*0.16) % 1 + 1) % 1;
  const rr = min(W,H)*(0.12 + q*0.42);
  c.strokeStyle = 'rgba(150,190,255,' + (0.3*(1-q)*fadeOut) + ')';
  c.lineWidth = 1.5*dpr;
  c.arc(X, Y, rr, 0, TAU); c.stroke();
}
```

`q` 是每道环自己的循环进度（0→1 再跳回 0），半径从 `0.12*min` 涨到 `0.54*min`，alpha 随 `q` 线性降到 0，`k*0.16` 让三道环错开。(0.12 + 0.42) = 0.54 是最大半径。Java 里 `q` 的 JS 负模同样要 `wrap`：

```java
for (int k = 0; k < 3; k++) {
    double raw = (p * 1.35 - k * 0.16) % 1.0;
    float q = (float) (raw < 0 ? raw + 1 : raw);
    float rr = (float) (Math.min(W, H) * (0.12 + q * 0.42));
    int col = ColorUtil.argb("#96beff", 0.3f * (1 - q) * fadeOut);
    DrawUtil.strokeCircle(ctx, X, Y, rr, 1.5f * dpr, col);
}
```

### 4.5 中央文字（12043–12051）

```js
const ta = cmEase(clamp((p-0.3)/0.2)) * fadeOut;
c.textAlign='center'; c.textBaseline='middle';
c.font = '700 ' + round(30*dpr) + 'px "Segoe UI", sans-serif';
c.fillStyle = 'rgba(240,246,255,' + ta + ')';
c.fillText('COMET', X, Y - 6*dpr);
c.font = round(12*dpr) + 'px "Segoe UI", sans-serif';
c.fillStyle = 'rgba(190,210,245,' + (ta*0.85) + ')';
c.fillText('OpusHUD v' + VERSION + ' · ' + style, X, Y + 20*dpr);
```

`ta` 在 p=0.3~0.5 淡入，再乘 `fadeOut` 随画面淡出。两行：`COMET`（粗体、30*dpr、色 `#f0f6ff`）和 `OpusHUD v{VERSION} · {style}`（12*dpr、色 `#bed2f5`、alpha*0.85）。Java 用 `TextRenderer` + `MatrixStack.scale()` 放大字号（MC 默认字体约 9px 高，30px 要 scale ≈ 3.3）：

```java
float ta = CmEase.window(p, 0.30f, 0.20f) * fadeOut;
var tr = mc.textRenderer;
String sub = "OpusHUD v" + OpusVersion.VALUE + " · " + cfg.style;

MatrixStack ms = ctx.getMatrices();
ms.push();
float bigScale = (30f * dpr) / tr.fontHeight;
ms.translate(X, Y - 6 * dpr, 0);
ms.scale(bigScale, bigScale, 1);
int bigCol = ColorUtil.argb("#f0f6ff", ta);
tr.draw("COMET", -tr.getWidth("COMET") / 2f, -tr.fontHeight / 2f, bigCol,
        false, ms.peek().getPositionMatrix(), ctx.getVertexConsumers(),
        TextRenderer.TextLayerType.NORMAL, 0, 0xF000F0);
ms.pop();

ms.push();
float subScale = (12f * dpr) / tr.fontHeight;
ms.translate(X, Y + 20 * dpr, 0);
ms.scale(subScale, subScale, 1);
int subCol = ColorUtil.argb("#bed2f5", ta * 0.85f);
tr.draw(sub, -tr.getWidth(sub) / 2f, -tr.fontHeight / 2f, subCol,
        false, ms.peek().getPositionMatrix(), ctx.getVertexConsumers(),
        TextRenderer.TextLayerType.NORMAL, 0, 0xF000F0);
ms.pop();
```

`textAlign='center'` / `textBaseline='middle'` 对应 `-getWidth()/2` 和 `-fontHeight/2` 的偏移。`VERSION` 在 Java 里用 `FabricLoader.getInstance().getModContainer("opus").get().getMetadata().getVersion().toString()` 拿，别硬编码。`tr.draw` 的 `background`/`layerType`/`light` 参数按 1.21.1 实际签名填，这里只固定几何与颜色。

---

## 5. 确定性伪随机：为什么整段没有 `Math.random()`

把这点单独拎出来，因为 Java 侧最容易手滑加 `new Random()`：

- 粒子角度 `i*2.399963`、半径 `(i*37)%100`、点半径 `sin(i)`；
- 碎片 jitter `sin(i*12.9898 + L*7.1)` / `cos(i*78.233 + L*3.3)`；
- 颜色按 `i*7`、`p*220`、`L*60`、`i*7+p*180`、`hueShift+k*6` 这类线性散列。

全部是「输入确定 → 输出确定」，同一帧重画两次像素完全一致。源码 12017 的注释写得很直白：「确定性伪随机，不闪烁」。Java 里但凡用 `Random` / `Math.random()`，拖影或双重绘制时碎片会每帧乱跳，组装过程直接破功。所有「随机」都从 index / 时间 / 层号算，这是硬约束。

顺带：`ShapeRadius.radius()` 里螺旋、星轨、花瓣那些 `sin(a*24+t*4)` 之类也是确定性的，02 卷和这卷共用，别在 common 包里塞任何全局随机状态。

---

## 6. CSS `.fade` → Screen 覆盖层 + 逐帧 alpha / RenderLayer 淡出

CSS（10144–10151）：

```css
#__comet_intro {
  position: fixed; inset: 0; width: 100%; height: 100%;
  z-index: 2147483647; pointer-events: none; opacity: 1;
  transition: opacity .55s ease;
}
#__comet_intro.skippable { pointer-events: auto; cursor: pointer; }
#__comet_intro.fade { opacity: 0; }
```

`cmIntroFinish` 加 `.fade` 后整层 0.55s `ease` 淡到 0，620ms 后 `remove()`。Java 没有 class 切换和 CSS 过渡，得自己算这个全局 alpha。两个层次别混：

**(a) 逐图元 alpha（`fadeOut`）**——时间轴第 ④ 段，12006/12026/12038/12044 已经把 `fadeOut` 乘进每个颜色了，第 4 节的 Java 代码照做即可，不需要额外机制。

**(b) 整层全局 alpha（对应 `.fade`）**——收尾时用一个 `finishTimer`，从 0 涨到 0.55s，全局乘 `1 - ease(t/0.55)`（用 `cmEase` 近似 CSS 的 `ease`，比线性舒服）。这个 alpha 要作用到**包括黑幕在内的所有图元**，所以最干净的做法是：把整个覆盖层先画进一个离屏 `RenderTarget`，再用一个全屏 shader 按全局 alpha 混合回主帧缓冲。给 GLSL：

```glsl
// intro_overlay.fsh —— 对应 .fade 的整层 opacity 过渡
#version 150
uniform sampler2D DiffuseSampler;
uniform float LayerAlpha;        // 1 → 0，由 finishTimer 驱动

in vec2 texCoord;
out vec4 fragColor;

void main() {
    vec4 c = texture(DiffuseSampler, texCoord);
    fragColor = vec4(c.rgb, c.a * LayerAlpha);
}
```

混合用 `SRC_ALPHA / ONE_MINUS_SRC_ALPHA`（source-over），这样黑幕在淡出时也会一起透出底下 TitleScreen，跟 CSS `opacity` 的行为一致。零依赖的替代方案：不上离屏，直接把 `LayerAlpha` 乘进第 4 节每个 `ColorUtil.argb/hsla` 的 alpha 参数里——效果几乎一样，省一套 RenderTarget，代价是黑幕也要手动乘。开场动画只播一次，我倾向后者：少一个 framebuffer、少一处 resize 同步，代码路径短。离屏 shader 方案留给「以后要往 overlay 里叠后处理辉光」时再上。

自定义全屏 RenderLayer（若要走离屏方案）：

```java
public static final RenderLayer INTRO_OVERLAY = RenderLayer.of(
    "opus:intro_overlay",
    VertexFormats.POSITION_TEXTURE_COLOR,
    VertexFormat.DrawMode.QUADS,
    256, false, false,
    RenderLayer.MultiPhaseParameters.builder()
        .transparency(RenderPhase.TRANSLUCENT_TRANSPARENCY)
        .depthTest(RenderPhase.ALWAYS_DEPTH_TEST)
        .cull(RenderPhase.DISABLE_CULLING)
        .build(false)
);
```

`pointer-events:none` 的对应物：覆盖层默认**不消费**鼠标/键盘事件；只有 `skip=true` 时才拦截点击（第 8 节）。别让 overlay 把 TitleScreen 的按钮全挡了。

---

## 7. 7 种样式 + 4 个设置项 → `IntroConfig`

源码 760–769 的 schema：

| id | 中文 | 类型 | 默认 | 范围 / 选项 | 步长 | Java 字段 | 类型 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `enabled` | 启用开场动画 | checkbox | `true` | — | — | `enabled` | `boolean` |
| `style` | 动画样式 | select | `五芒星` | 7 项 | — | `style` | `String` |
| `duration` | 时长（秒） | slider | `3` | 1.5–6 | 0.5 | `duration` | `double` |
| `skip` | 点击画面可跳过 | checkbox | `true` | — | — | `skip` | `boolean` |

7 种样式（765 行 options）：`五芒星`、`六芒星`、`花瓣`、`齿轮`、`三角阵`、`星轨`、`极光`。

**这里有个必须讲清的映射**：前 6 种是 02 卷 `CM_GEOM` 里的几何形状，`cmShapeRadius` 会走具体的 `star/poly/花瓣/齿轮/星轨` 分支；**「极光」不在 `CM_GEOM` 里**，`cmShapeRadius` 对它走 `default: return rad`，也就是一个标准圆。所以 7 种样式里 6 种是几何、1 种是圆。别把「极光」当成某种几何去补一个不存在的 case。另外 02 卷几何有 9 种（还有菱形、六边形、螺旋），但开场动画的 options 只列了这 6 种 + 极光——`cmShapeRadius` 支持全部 9 种，只是 GUI 没放开，照抄 options 即可，别自作主张加进列表。

`duration` 的双重 clamp（第 2 节讲过）：字段按 1.5~6 约束，运行时 `clamp(1.2, 8)` 兜底。

```java
package dev.opus.fabric.intro;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;

import java.io.*;
import java.nio.file.*;

/** 对应 MODULES[id='intro'].settings（760-769）。序列化走 Gson，与 02 卷 AuraConfig 同款。 */
public final class IntroConfig {
    public boolean enabled  = true;
    public String  style    = "五芒星";   // 7 选 1
    public double  duration = 3.0;       // 1.5..6 step .5；运行时 clamp [1.2, 8]
    public boolean skip     = true;

    /** 7 种样式，顺序照抄 765 行 options。 */
    public static final String[] STYLES = {
        "五芒星", "六芒星", "花瓣", "齿轮", "三角阵", "星轨", "极光"
    };

    /** '极光' 走 cmShapeRadius 的 default（圆）。 */
    public boolean isCircleStyle() { return "极光".equals(style); }

    /** 对应 11974：clamp 到 [1.2, 8] 秒。 */
    public long durationMs() {
        double d = duration;
        if (!Double.isFinite(d) || d == 0) d = 3.0;
        d = Math.max(1.2, Math.min(8.0, d));
        return (long) (d * 1000);
    }

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    public static IntroConfig load() {
        Path p = FabricLoader.getInstance().getConfigDir().resolve("opus-intro.json");
        if (!Files.exists(p)) { IntroConfig c = new IntroConfig(); c.save(); return c; }
        try (Reader r = Files.newBufferedReader(p)) {
            IntroConfig c = GSON.fromJson(r, IntroConfig.class);
            return c == null ? new IntroConfig() : c;
        } catch (IOException | RuntimeException e) {
            return new IntroConfig();     // 配置坏了照样进游戏
        }
    }

    public void save() {
        Path p = FabricLoader.getInstance().getConfigDir().resolve("opus-intro.json");
        try (Writer w = Files.newBufferedWriter(p)) { GSON.toJson(this, w); }
        catch (IOException ignored) { }
    }
}
```

> Cloth Config / ModMenu 的取舍和 02 卷完全一致：POJO 是唯一真相，GUI 只做编辑和 `save()`，渲染循环读字段，别每帧问 GUI 要值。`enabled` 在 `playIntro` 开头判（11961），`skip` 决定是否挂点击监听（11964），`style/duration` 在播放开始时**快照**下来（`const style = ...` / `const dur = ...`，11973–11974）——播放途中改配置不影响当前这一遍，Java 里也要在开始时把 `style/dur` 拷进局部字段，别每帧读 `cfg.style`。

---

## 8. `BootIntroRenderer.java` 完整骨架 + 注入点取舍

### 8.1 触发点：`JOIN` 还是 `TitleScreen` mixin？

这是这卷最需要拍板的地方，先把取舍摆清楚。

网页在 `boot()` 末尾（12115，`DOMContentLoaded` 之后）播一次，语义是「**客户端启动第一眼**」。Fabric 的 `onInitializeClient()` 太早——那时 framebuffer、当前 Screen 都还没就绪，直接播会没画面。候选触发点：

| 方案 | 时机 | 优点 | 缺点 |
| --- | --- | --- | --- |
| `ClientPlayConnectionEvents.JOIN` | 第一次进世界 | framebuffer / camera 全就绪；API 稳定、零 mixin | 在 TitleScreen **之后**才播，看不到「第一眼」；重连会重复触发，必须靠 `played` 标志压住 |
| `TitleScreen` mixin `@Inject` | 标题界面渲染时 | 最接近「启动第一眼」，标题界面一出现就播 | 侵入性高，要写 mixin 配置；从世界退回标题会再次构造 Screen，仍要 `played` 标志 |
| 通用 `Screen.render` mixin + tick 延迟一帧 | 任意 Screen 就绪后 | 标题 / 世界都能盖，不绑具体类 | mixin 到父类影响面大，得小心 `ci` 和调用时机 |

**结论（推荐组合）**：主路径用 `TitleScreen` mixin 注入渲染，拿到「启动第一眼」；同时注册 `ClientPlayConnectionEvents.JOIN` 作为兜底——万一某些整合包跳过了 TitleScreen（直接进世界），JOIN 时若还没播过就补播。两者共用 `static AtomicBoolean played`，保证**整个客户端生命周期只播一次**。`ClientTickEvents.END_CLIENT_TICK` 负责推进时钟和收尾计时，不负责触发。

### 8.2 `BootIntroRenderer.java`

```java
package dev.opus.fabric.intro;

import dev.opus.fabric.common.*;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.events.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.util.math.MatrixStack;

import java.util.concurrent.atomic.AtomicBoolean;

/** 启动开场动画总入口。只做视觉，崩了不影响进游戏。 */
public final class BootIntroRenderer implements ClientModInitializer {

    private static IntroConfig cfg;
    private static final AtomicBoolean played = new AtomicBoolean(false); // 只播一次
    private static volatile boolean active = false;                        // 对应 introCanvas != null
    private static volatile boolean done   = false;                        // 对应 introDone

    private static long startMs;        // t0
    private static long durMs;          // 播放开始时快照的 dur
    private static long finishAtMs;     // 整层淡出结束时刻
    private static String styleSnap;    // 播放开始时快照的 style
    private static boolean skipSnap;

    @Override
    public void onInitializeClient() {
        cfg = IntroConfig.load();

        // 兜底触发：直接进世界、没经过 TitleScreen 时补播
        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> {
            if (!played.get()) start();
        });

        // 每帧推进：时钟、收尾计时、整层淡出
        ClientTickEvents.END_CLIENT_TICK.register(client -> tick());
    }

    /** 对应 playIntro() 的开头（11961-11977）。线程安全由 played CAS 保证。 */
    public static void start() {
        if (!cfg.enabled) return;                       // 11961
        if (!played.compareAndSet(false, true)) return; // introCanvas 非空 + 只播一次
        active   = true;
        done     = false;
        startMs  = System.currentTimeMillis();
        durMs    = cfg.durationMs();                    // 11974，已 clamp
        styleSnap = cfg.style;                          // 11973，快照
        skipSnap  = cfg.skip;                           // 11964，快照
        finishAtMs = Long.MAX_VALUE;
        // 注意：这里不建任何 canvas / DOM，覆盖层由 mixin 每帧画（见 8.3）
    }

    /** 对应 cmIntroFinish()（11949-11958），幂等。 */
    public static void finish() {
        if (done) return;
        done = true;
        // CSS .fade 是 .55s，setTimeout remove 是 620ms；用 620ms 收尾
        finishAtMs = System.currentTimeMillis() + 620L;
    }

    /** 点击跳过入口；skip=false 时不消费（对应 .skippable 才 pointer-events:auto）。 */
    public static boolean onClick() {
        if (!active || !skipSnap) return false;
        finish();
        return true;   // 让调用方 ci.cancel()，吃掉这次点击
    }

    private static void tick() {
        if (!active) return;
        long now = System.currentTimeMillis();
        if (done && now >= finishAtMs) {
            active = false;              // 对应 11955 的 cv.remove()
        }
    }

    /** 整层全局 alpha，对应 .fade 的 0.55s ease。未收尾时恒 1。 */
    private static float layerAlpha() {
        if (!done) return 1f;
        long now = System.currentTimeMillis();
        long remain = finishAtMs - now;     // 620 → 0
        float fadeT = CmEase.clamp01(1f - remain / 550f);  // .55s 淡出
        return 1f - CmEase.ease(fadeT);
    }

    /** 由 8.3 的 mixin 每帧调用。整段包 try/catch，绝不让异常冒到渲染管线。 */
    public static void render(DrawContext ctx, float delta) {
        if (!active) return;
        try {
            renderFrame(ctx, delta);
        } catch (Throwable t) {
            // 对应 12057 / 12115 的 try/catch：开场动画失败不影响客户端启动
            // OpusLog.warn("boot intro", t);
            active = false;   // 干脆关掉，别每帧刷异常
        }
    }

    private static void renderFrame(DrawContext ctx, float delta) {
        MinecraftClient mc = MinecraftClient.getInstance();
        int W = mc.getWindow().getFramebufferWidth();
        int H = mc.getWindow().getFramebufferHeight();
        float X = W / 2f, Y = H / 2f;
        float dpr = (float) mc.getWindow().getScaleFactor();

        long now = System.currentTimeMillis();
        float p = CmEase.clamp01((now - startMs) / (float) durMs);   // 11980
        float fadeOut = 1f - Math.max(0, (p - 0.82f) / 0.18f);       // 11981
        float layer = layerAlpha();                                   // .fade 整层
        float assemble = CmEase.window(p, 0.10f, 0.55f);              // 11987
        float grow     = CmEase.window(p, 0.10f, 0.45f);              // 12001
        float ta       = CmEase.window(p, 0.30f, 0.20f);              // 12044

        // ① 黑幕（11984-11986），layer 乘进 alpha 实现整层淡出
        float veil = p < 0.08f ? p / 0.08f : (p > 0.86f ? fadeOut : 1f);
        ctx.fill(0, 0, W, H, ColorUtil.argb("#000000",
                0.985f * CmEase.clamp01(veil) * layer));

        // ② 110 颗粒子（11991-11998）
        drawParticles(ctx, W, H, X, Y, dpr, p, assemble, layer);

        // ③ 主图案：构图圆 + 三层轮廓（12000-12032）
        drawMainShape(ctx, W, H, X, Y, dpr, p, fadeOut, assemble, grow, layer);

        // ④ 三道扩散光环（12035-12041）
        drawExpandRings(ctx, W, H, X, Y, dpr, p, fadeOut, layer);

        // ⑤ 中央文字（12043-12051）
        drawTitle(ctx, mc, X, Y, dpr, ta, fadeOut, layer);

        // 收尾：p 到 1 交给 cmIntroFinish（12053-12054）
        if (p >= 1f) finish();
    }

    // drawParticles / drawMainShape / drawExpandRings / drawTitle
    // 按第 4 节的公式填，签名已固定；style 一律用 styleSnap，别读 cfg.style。
    private static void drawParticles(DrawContext ctx, int W, int H, float X, float Y,
                                      float dpr, float p, float gather, float layer) { /* §4.2 */ }
    private static void drawMainShape(DrawContext ctx, int W, int H, float X, float Y,
                                      float dpr, float p, float fadeOut, float assemble,
                                      float grow, float layer) { /* §4.3 */ }
    private static void drawExpandRings(DrawContext ctx, int W, int H, float X, float Y,
                                        float dpr, float p, float fadeOut, float layer) { /* §4.4 */ }
    private static void drawTitle(DrawContext ctx, MinecraftClient mc, float X, float Y,
                                  float dpr, float ta, float fadeOut, float layer) { /* §4.5 */ }
}
```

骨架里几个必须守住的点：

- `played` 用 `AtomicBoolean`，`start()` 可能被 JOIN 回调和 TitleScreen mixin 同时触发（虽然都在客户端线程，但 CAS 最省心）。`active` / `done` 两个标志对应 `introCanvas` / `introDone`，职责不同，别合并。
- `styleSnap` / `durMs` / `skipSnap` 在 `start()` 时快照。源码 11973–11974 就是 `const style = ...` / `const dur = ...`，播放途中改配置不影响当前这一遍。
- `render()` 整个包 `try/catch(Throwable)`，异常时直接 `active=false` 关掉，对应 12057 行「开场动画失败不影响客户端启动」和 12115 行 boot 里那层 try/catch。别让一个 `NullPointerException` 卡死 TitleScreen。
- 时钟用 `System.currentTimeMillis()` 真实墙钟，对应 `performance.now()`。别用累加 tick——启动期间 tick 可能不稳，墙钟最贴合「3 秒播完」的直觉。
- `layerAlpha()` 把 CSS `.fade` 的 0.55s ease 复刻成 `1 - cmEase(t/0.55)`，620ms 到点置 `active=false`。这个 alpha 乘到**所有**图元（含黑幕），等价于整层 `opacity`。

### 8.3 `TitleScreen` mixin 注入点

`TitleScreen`（Yarn 1.21.1：`net.minecraft.client.gui.screen.TitleScreen`）的渲染尾部注入。`render` 描述符按实际 mapping 核对，1.21 是 `render(DrawContext, int, int, float)`：

```java
package dev.opus.fabric.mixin;

import dev.opus.fabric.intro.BootIntroRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.TitleScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(TitleScreen.class)
public abstract class TitleScreenMixin {

    /** 启动第一眼：标题界面一渲染就铺开场动画。TAIL 保证盖在背景与按钮之上。 */
    @Inject(method = "render(Lnet/minecraft/client/gui/DrawContext;IIF)V",
            at = @At("TAIL"))
    private void opus$afterTitleRender(DrawContext ctx, int mouseX, int mouseY,
                                       float delta, CallbackInfo ci) {
        BootIntroRenderer.start();     // 幂等，只第一次真正启动
        BootIntroRenderer.render(ctx, delta);
    }
}
```

`start()` 放这里而不是 `onInitializeClient()`：TitleScreen 第一次渲染时 framebuffer 已就绪，比 JOIN 更早、更贴「启动第一眼」。JOIN 的注册（8.2）是兜底，两处都调 `start()`，靠 `played` 压住重复。

点击跳过用父类 `Screen.mouseClicked` 的 HEAD 注入，避免覆盖层把 TitleScreen 按钮吃掉：

```java
package dev.opus.fabric.mixin;

import dev.opus.fabric.intro.BootIntroRenderer;
import net.minecraft.client.gui.screen.Screen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(Screen.class)
public abstract class ScreenMixin {
    /** 对应 cv.addEventListener('click', ..., {once:true}) + .skippable 的 pointer-events:auto。 */
    @Inject(method = "mouseClicked(DDI)Z", at = @At("HEAD"), cancellable = true)
    private void opus$introSkip(double mouseX, double mouseY, int button,
                                CallbackInfoReturnable<Boolean> cir) {
        if (BootIntroRenderer.onClick()) {
            cir.setReturnValue(true);    // 消费点击，别把这次点击透传给按钮
        }
    }
}
```

`onClick()` 在 `skip=false` 时返回 false，事件正常透传——对应 CSS 里只有 `.skippable` 才 `pointer-events:auto`。`{once:true}` 的语义由 `done` 标志保证（`finish()` 幂等，第二次点击 `active` 很快也会变 false）。

mixin 配置（`resources/opus.mixins.json`）：

```json
{
  "required": true,
  "minVersion": "0.8",
  "package": "dev.opus.fabric.mixin",
  "compatibilityLevel": "JAVA_17",
  "client": [
    "TitleScreenMixin",
    "ScreenMixin"
  ],
  "injectors": { "defaultRequire": 1 }
}
```

在 `fabric.mod.json` 里挂 `"mixins": ["opus.mixins.json"]`，`entrypoints.client` 指向 `BootIntroRenderer`。

---

## 9. 只播放一次 / 点击跳过 / 异常不影响启动 —— 三个硬要求逐条对账

| 要求 | 源码怎么做 | Java 怎么做 | 别踩的坑 |
| --- | --- | --- | --- |
| 只播放一次 | `introCanvas` 非空则 `return`（11961）+ `boot()` 只调一次（12115） | `AtomicBoolean played` CAS；`start()` 幂等；JOIN 兜底 + TitleScreen mixin 双触发都压得住 | 别把 `played` 放在 `TitleScreen.init()` 里——从世界退回标题会重新 init，会重播；用静态标志，跟 Screen 生命周期解耦 |
| 点击跳过 | `cv.className='skippable'`（11964）+ `addEventListener('click', cmIntroFinish, {once:true})`（11977） | `ScreenMixin.mouseClicked` HEAD 注入调 `onClick()`；`skip=false` 不消费；`done` 保证幂等 | 别让覆盖层默认吃掉所有输入（对应 `pointer-events:none`）；只在 active 且 skip 时 `cir.setReturnValue(true)` |
| 异常不影响启动 | `playIntro` 整体 try/catch（12057）+ boot 里 `try{playIntro()}catch(e){}`（12115） | `render()` 包 `try/catch(Throwable)`，异常时 `active=false`；`load()` 配置坏了返回默认 | `catch` 里别 `throw`，也别留半初始化的 `active=true` 每帧刷异常；打日志就够了 |

还有个隐性要求：开场动画**不抢输入焦点、不改当前 Screen**。网页是 DOM 覆盖层，天然不接管页面；Java 里如果用 `mc.setScreen(new IntroScreen(...))` 把 TitleScreen 顶掉，就得自己转发按钮、处理 ESC、处理返回，风险和代码量都大。用 mixin 尾部绘制 + HEAD 消费点击，覆盖层始终是「画上去的一层」，不碰 Screen 栈，这是最贴源码语义的做法。

---

## 10. 「算法可 1:1 移植」 vs 「网页特有必须换实现」

| 项 | 判定 | 说明 |
| --- | --- | --- |
| `cmEase` easeInOutCubic | **1:1** | 纯公式，`CmEase.ease()` 逐行照抄 |
| 四段时间轴、所有阈值（0.08 / 0.1 / 0.55 / 0.45 / 0.82 / 0.86 / 0.18 / 1.35） | **1:1** | 第 2 节表逐个数钉死 |
| `veil` 黑幕 0.985、粒子 110 颗、黄金角 2.399963、`(i*37)%100` | **1:1** | 纯常量与公式 |
| `drawN = floor(240*assemble)` 逐段绘制、`i/240*TAU` 角度 | **1:1** | 分母恒 240，别写成 drawN |
| 碎片 jitter 的 `sin(i*12.9898+L*7.1)` / `cos(i*78.233+L*3.3)`、`settle=1-assemble` | **1:1** | 确定性，禁用 `Random` |
| `spin = p*TAU*1.7`、三层 `R*(1-L*0.16)`、相位 `spin+L*0.4` | **1:1** | 复用 `ShapeRadius.radius(style, a, rad, p*3, phase, 1)` |
| 两道构图圆、三道扩散光环 `q=((p*1.35-k*0.16)%1+1)%1` | **1:1** | JS 负模换 `wrap` |
| 中央文字颜色 / 位置 / `ta` 淡入 | **1:1（换绘制 API）** | `TextRenderer` + `MatrixStack.scale()` |
| 7 种样式（6 几何 + 极光=圆）、4 个设置项 | **1:1** | `IntroConfig` 字段对齐；「极光」走 `cmShapeRadius` 的 default |
| `duration` 双重 clamp（GUI 1.5~6 / 运行时 1.2~8） | **1:1** | 两边都留 |
| `hsla` / `argb` 配色 | **1:1（换载体）** | 输出 packed ARGB 而非 CSS 字符串，复用 02 卷 `ColorUtil` |
| `c.clearRect` + `c.arc` / `c.stroke` / `c.lineTo` / `c.fillText` | **必须换** | `DrawContext.fill` + ribbon quad（`strokePolyline`）+ `TextRenderer` |
| `c.shadowBlur = 18*dpr` 辉光 | **必须换** | 离屏高斯（02 卷 FxPipeline）或「粗描边+低 alpha」两遍近似；开场只播一次，建议后者省依赖 |
| CSS `#__comet_intro` / `.fade` / `transition opacity .55s ease` | **必须换** | `layerAlpha()` 逐帧算 + 整层 alpha 乘图元；或 `RenderTarget` + `intro_overlay.fsh` |
| `setTimeout(remove, 620)` | **必须换** | `finishAtMs` + `END_CLIENT_TICK` 到点置 `active=false` |
| `document.createElement` / `append` / `classList.add` / `cv.remove()` | **不移植** | Java 无 DOM，覆盖层是 mixin 画上去的一层 |
| `requestAnimationFrame` / `performance.now()` | **必须换** | `END_CLIENT_TICK` 推进 + `System.currentTimeMillis()` 墙钟 |
| `addEventListener('click', ...)` / `pointer-events` | **必须换** | `Screen.mouseClicked` mixin 消费点击 |
| `devicePixelRatio` / `innerWidth*dpr` | **换 API** | `getFramebufferWidth/Height()`（已含缩放）+ `getScaleFactor()` |
| `boot()` 末尾触发 | **换触发点** | `TitleScreen` mixin 主触发 + `ClientPlayConnectionEvents.JOIN` 兜底 |

---

## 11. 落地检查清单

- [ ] 双重淡出分开做：`fadeOut`（逐图元，p>0.82）和 `layerAlpha()`（整层，收尾 0.55s）别混成一个。
- [ ] 黑幕 `0.985` 不是 1.0，且是每帧第一个画的图元。
- [ ] `drawN` 的分母是常数 240，不是 `drawN`；`assemble>=1` 才 `closePath()`。
- [ ] `cmShapeRadius` 的 `t` 实参是 `p*3`，`wobble` 传 1，别塞全局时钟。
- [ ] 所有「随机」都是 index / 时间 / 层号的确定性函数，工程里搜一遍确认没有 `new Random()` / `Math.random()`。
- [ ] `spin = p*TAU*1.7`，三层相位 `spin + L*0.4`，半径 `R*(1-L*0.16)`。
- [ ] 扩散光环 `q` 用 `wrap` 处理负模，`(0.12+q*0.42)` 最大 0.54。
- [ ] 「极光」样式走 `cmShapeRadius` 的 default（圆），别补几何 case；GUI 只放开 7 种。
- [ ] `style/dur/skip` 在 `start()` 快照，播放途中改配置不影响当前一遍。
- [ ] `played` 是静态 `AtomicBoolean`，跟 TitleScreen 生命周期解耦；从世界退回标题不能重播。
- [ ] 覆盖层不接管 Screen 栈；`skip=false` 时点击正常透传，别吃掉 TitleScreen 按钮。
- [ ] `render()` 包 `try/catch(Throwable)`，异常时 `active=false`，只打日志。
- [ ] mixin 的 `method` 描述符（`render(Lnet/minecraft/client/gui/DrawContext;IIF)V`、`mouseClicked(DDI)Z`）按实际 Yarn 版本核对；`opus.mixins.json` 里加进 `client` 数组并在 `fabric.mod.json` 挂载。
- [ ] `ShapeRadius` / `ColorUtil` / `CmEase` / `strokePolyline` 从 02 卷 `common` 包 import，别复制第二份。
- [ ] 文字 `VERSION` 从 mod metadata 拿，别硬编码；`textAlign:center` / `textBaseline:middle` 用 `-getWidth()/2` / `-fontHeight/2` 复刻。

---

## 附：和 02 卷的接缝

两卷共用 `dev.opus.fabric.common` 下的四件东西：`ShapeRadius.radius()`（7 种 intro 样式直接用）、`ColorUtil.hsla()/argb()`、`CmEase`（这卷用，光环不用）、`strokePolyline()`（屏幕空间 ribbon）。源码里把它们放在同一个 IIFE 里靠闭包共享，Java 里靠包结构共享——语义一样，别各建一份。

最大的语义差异再强调一次：02 卷的光环是「3D 点投影到屏幕的带透视 2D 覆盖层」，需要 `ringProject` 近平面裁剪；这卷的 intro 是「纯 2D 全屏覆盖层」，坐标直接是屏幕像素，`X=W/2,Y=H/2` 起手，跟相机、`Camera`、投影矩阵一点关系都没有。别把 02 卷的 `cachedVp` / `buildViewProjection` 搬进来。
