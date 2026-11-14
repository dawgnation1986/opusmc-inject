# 02 · 光环特效全解（Aura Range Ring → Fabric）

> 移植笔记，写给要接手这块的同事。目标是 MC Java 1.21.1 / Fabric Loader 0.16+ / Fabric API / Yarn mappings / Java 17，入口一律 `implements ClientModInitializer`，在 `onInitializeClient()` 里注册事件。下面所有类名、方法签名、事件名都按这个口径写，别和别的卷混。

## 卷首：我从哪读的、要复刻什么、Java 里对应什么

对应 JS 源码（`opusmc-hud.user.js` v1.31.0，单 IIFE，注释完整）：

| 位置 | 函数 / 常量 | 干什么的 |
| --- | --- | --- |
| 297–328 | `MODULES` 里 `id:'aura'` 的 `settings[]` | 光环设置项的 schema、默认值、范围、步长 |
| 1943–1950 | `perfLevel()` | 按 FPS 自动分「绚丽 / 均衡 / 省电」 |
| 1951–1953 | `perfGlow()` | 辉光是否启用 |
| 1954–1959 | `perfFx()` | 特效质量系数（决定采样点数） |
| 1961–1964 | `fxCanvas` / `fxctx` | 离屏拖影画布，固定 1280×720 起步 |
| 1966–1977 | `playerCenter()` | 取玩家插值坐标 `[x,y,z]` |
| 1979–1984 | `withAlpha()` | `#hex` / `hsl()` → 带 alpha 的颜色串 |
| 1986–1996 | `hexToHue()` | `#rrggbb` → 0..360 色相 |
| 1999–2008 | `strokeRingPath()` | 折线路径，遇到非法点断笔（不跨屏拉长线） |
| 2010–2040 | `ringProject()` | **近平面裁剪投影**：相机后方的点压到近平面取屏幕边缘坐标 |
| 2042–2050 | `ringGrad()` | 彩虹线性渐变（8 段色标） |
| 2055–2057 | `CM_GEOM` / `CM_GEOM_TIPS` | 9 种几何图案名 + 各自的尖角数 |
| 2058–2087 | `cmShapeRadius()` | 极坐标半径函数，几何图案共用 |
| 2088 | `cmIsGeom()` | 判断模式是不是几何图案 |
| 2090–2269 | `drawAuraRing()` | 主绘制，光环全部效果都在这 |
| 1806–1816 | `hexToRgba()` | 颜色工具 |
| 1852–1860 | `project()` | 单点投影，读 `v.vp`（列主序 MVP） |
| 3387–3406 | `musicSpectrum()` | Web Audio 频谱 → `bins/bass/mid/hi/level` |
| 806–819 | `getS()` | 配置读取 + `__sCache` 缓存 |
| 2436–2458 | ESP 每帧主循环 | `drawAuraRing(r, p, W_, H_, alpha)` 的调用点 |
| 6926–6930 | `rGlobalCache()` | 兜底 vp 矩阵（`renderer.vp`） |

**要复刻的效果**：玩家脚底一个与攻击半径等大的 3D 圆环，带透视、17 种动效模式、彩虹渐变、辉光、拖影/动态模糊、环绕粒子、环形频谱柱、几何图案顶点呼吸发光和内接星线。它是「贴在地面、随视角透视、永远画在 HUD 之上的带透视 2D 覆盖层」——注意源码把 3D 点投影成屏幕 2D 坐标后用 Canvas 2D `stroke()`，**没有深度测试**（ESP canvas 就是盖在游戏画面上的一层 DOM canvas）。这个语义决定了 Java 侧怎么选渲染路径，后面专门讲。

**Java 侧概念对照**（粗粒度，细节逐节展开）：

| 网页 | Fabric / Java |
| --- | --- |
| ESP overlay canvas（2D，无深度） | `HudRenderCallback.EVENT` + `DrawContext`，或用自定义 `RenderLayer` 关深度测试 |
| `v.vp` 列主序矩阵 | `org.joml.Matrix4f` = projection × view，view 由 `Camera` 构造 |
| `project()` / `ringProject()` | `Vector4f.mul(Matrix4f)` + 近平面插值 |
| `ctx.shadowBlur` | 离屏 `RenderTarget` + 两趟可分离高斯模糊 shader，加法混合回主帧缓冲 |
| `fxCanvas` + `destination-out` 渐隐 | 上一帧 `RenderTarget` + alpha 衰减 pass（`fragColor.a *= decay`） |
| `ectx.filter = 'blur(Npx)'` | 上面那两趟高斯，`sigma` 由 `fxBlur` 换算 |
| `createLinearGradient` 8 段 HSL | 顶点逐点配色（每个折线点算一个 ARGB） |
| `Web Audio AnalyserNode` | OpenAL loopback 采集 + 自写 FFT，或音量包络 / 伪律动兜底 |
| `getS()` + `__sCache` | Config POJO + Gson，字段读一次缓存在实例里 |
| `performance.now()/1000 * speed` | `ClientTickEvents.END_CLIENT_TICK` 累加的单调时钟 |

**移植边界，先划清楚**：用户明确排除 Aura 的攻击部分。`aura` 模块里 `strength`、`players`、`targets`、`rotate`，以及 `multiaura`、`triggerbot` 全部不移植——那是自动攻击 / 目标筛选 / 转头逻辑，跟视觉无关。本卷只保留 `ring` 这个开关（`id:'ring'`，表示「脚下范围圈」，默认 true）和 13 个视觉设置项。`drawAuraRing` 里读的 `getS('aura','range')` 在网页里同时是攻击判定半径，Java 侧只当「光环半径」用，别接任何攻击回调。

---

## 1. 调用链与每帧主流程（照着源码还原）

网页里光环不是独立 rAF，而是挂在 ESP 覆盖层的每帧重画里：

```js
// 2436-2458，ESP 帧函数节选
if (!r || !r.vp || !r.camPos) return;
...
if (espCanvas.width !== glCv.width) espCanvas.width = glCv.width; // 跟随 GL 画布尺寸
ectx.clearRect(0, 0, espCanvas.width, espCanvas.height);
const W_ = espCanvas.width, H_ = espCanvas.height;
if (showAuraRing) drawAuraRing(r, p, W_, H_, alpha);   // ← 光环在这
```

`r` 是渲染信息对象（`{ vp, camPos }`），`p` 是玩家实体，`alpha` 是插值系数（`ipos(alpha)`），`W_/H_` 是物理像素尺寸（含 DPR）。每帧清屏重画，没有残留——拖影是光环自己在离屏 `fxCanvas` 里维护的，跟 ESP canvas 的清屏不冲突。

对应到 Fabric，一帧要做这些事，顺序别乱：

1. `ClientTickEvents.END_CLIENT_TICK` 里推进全局时钟 `t`，刷新 `perfLevel()` 需要的 FPS，更新音乐分析器。
2. `HudRenderCallback` / `WorldRenderEvents.AFTER_ENTITIES` 触发时，取 `Camera`、`tickCounter()`、玩家插值坐标。
3. 造 view-projection 矩阵，生成 3D 环点 → 投影 + 近平面裁剪 → 屏幕折线。
4. 若开了辉光/拖影：把这一帧的光环**单独**画进离屏 `RenderTarget`（不是主帧缓冲），先做 alpha 衰减（拖影），再画当前帧，然后两趟高斯模糊，最后加法混合回主画面。
5. 若没开，直接把折线画到主画面。

`fxCanvas` 的尺寸同步（2139 行 `if (fxCanvas.width !== W_) ...`）在 Java 里就是 `RenderTarget.resize(W, H, true)`，窗口缩放时触发，别每帧无脑 resize。

---

## 2. 配置：13 个设置项 → `AuraConfig`

源码 299–327 的 schema 挨个抄下来。注意 `ringColor` 默认空串代表「彗星紫 `#b06bff`」，彩虹模式下它只当**起始色相**用；`ringFill` 是 0–40 的整数百分比，代码里 `/100` 变成 0–0.4 的 alpha；`fxTrail` 是 0–90，代码里 `/100` 并 clamp 到 0.95。

| id | 中文 | 类型 | 默认 | 范围 | 步长 | Java 字段 | 类型 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `range` | 范围 | slider | `4.5` | 2–6 | 0.1 | `range` | `double` | 光环半径（米/方块）；网页里同时是攻击半径，Java 只当视觉 |
| `ringColor` | 光环颜色 | color | `""` | — | — | `ringColor` | `String` | 空串 → `#b06bff`；彩虹时取 `hexToHue` 当起始 hue |
| `ringMode` | 光环动效 | select | `极光` | 17 项 | — | `ringMode` | `String`（或 enum） | 见第 4 节 |
| `ringSpeed` | 动效速度 | slider | `1` | 0.2–3 | 0.1 | `ringSpeed` | `double` | 乘进时间 `t` |
| `ringWidth` | 线条粗细 | slider | `2.5` | 1–8 | 0.5 | `ringWidth` | `double` | Canvas `lineWidth`，Java 里要 ribbon 展开 |
| `ringLayers` | 圈层数 | slider | `2` | 1–4 | 1 | `ringLayers` | `int` | 部分模式会强制覆盖成 1 或 ≥2 |
| `ringGlow` | 辉光强度 | slider | `14` | 0–30 | 1 | `ringGlow` | `double` | 对应 `shadowBlur` px |
| `ringFill` | 填充强度 | slider | `12` | 0–40 | 2 | `ringFill` | `double` | `/100` → 0–0.4 alpha，仅第 0 层填充 |
| `ringRainbow` | 彩虹渐变 | checkbox | `true` | — | — | `ringRainbow` | `boolean` | 部分模式强制开 |
| `ringParticles` | 环绕粒子 | checkbox | `true` | — | — | `ringParticles` | `boolean` | |
| `fxBars` | 环形频谱柱 | checkbox | `true` | — | — | `fxBars` | `boolean` | 仅 `音乐律动` 且有频谱时生效 |
| `fxBlur` | 动态模糊 | slider | `3` | 0–12 | 0.5 | `fxBlur` | `double` | px，换算成高斯 sigma |
| `fxTrail` | 拖影长度 | slider | `55` | 0–90 | 5 | `fxTrail` | `double` | `/100` → `decay`，clamp 0.95 |

另外 `ring`（299–312 里的 checkbox，默认 true）是模块总开关，Java 侧加一个 `ringEnabled`。`perf` 模块的 `level` / `noGlow` / `fxQuality`，以及 `music` 模块的 `sens`（灵敏度，默认 1.2，代码里 `max(0.2, ...)`）也要读，见第 3、12 节。

### `AuraConfig.java`

Config POJO 用 Gson，字段就是上面这些。别用 `Map<String,Object>`，移植完还得对着字符串 key 猜类型，迟早出事。

```java
package dev.opus.fabric.aura;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;

/** 对应 JS 里 MODULES[id='aura'].settings + perf/music 相关项。 */
public final class AuraConfig {
    // --- aura 视觉 ---
    public boolean ringEnabled   = true;      // id:'ring'
    public double  range         = 4.5;       // 2..6 step .1
    public String  ringColor     = "";        // 空 → #b06bff
    public String  ringMode      = "极光";     // 17 选 1
    public double  ringSpeed     = 1.0;       // .2..3 step .1
    public double  ringWidth     = 2.5;       // 1..8 step .5
    public int     ringLayers    = 2;         // 1..4 step 1
    public double  ringGlow      = 14.0;      // 0..30 step 1
    public double  ringFill      = 12.0;      // 0..40 step 2，内部 /100
    public boolean ringRainbow   = true;
    public boolean ringParticles = true;
    public boolean fxBars        = true;
    public double  fxBlur        = 3.0;       // 0..12 step .5
    public double  fxTrail       = 55.0;      // 0..90 step 5，内部 /100

    // --- 跨模块 ---
    public String  perfLevel     = "自动";     // '自动' | '绚丽' | '均衡' | '省电'
    public boolean perfNoGlow    = false;
    public double  perfFxQuality = 1.0;
    public double  musicSens     = 1.2;

    /** 对应 JS: String(gs('ringColor','')).trim() || '#b06bff'。 */
    public String effectiveColor() {
        String s = ringColor == null ? "" : ringColor.trim();
        return s.isEmpty() ? "#b06bff" : s;
    }

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    public static AuraConfig load() {
        Path p = FabricLoader.getInstance().getConfigDir().resolve("opus-aura.json");
        if (!Files.exists(p)) {
            AuraConfig c = new AuraConfig();
            c.save();
            return c;
        }
        try (Reader r = Files.newBufferedReader(p)) {
            AuraConfig c = GSON.fromJson(r, AuraConfig.class);
            return c == null ? new AuraConfig() : c;
        } catch (IOException | RuntimeException e) {
            // 配置坏了不能让游戏起不来，跟 playIntro 的 try/catch 一个道理
            return new AuraConfig();
        }
    }

    public void save() {
        Path p = FabricLoader.getInstance().getConfigDir().resolve("opus-aura.json");
        try (Writer w = Files.newBufferedWriter(p)) {
            GSON.toJson(this, w);
        } catch (IOException ignored) { }
    }
}
```

> **Cloth Config 取舍**：网页的 slider / select / checkbox 天然对应 Cloth Config API 的 `ConfigEntryBuilder`，要出图形设置界面的话直接挂 Cloth Config + ModMenu，能拿到 min/max/step 校验和下拉约束，省得自己写 GUI。但本卷的运行时读取**只依赖上面这个 POJO**——Cloth Config 只是个编辑器，序列化仍走 Gson。别把渲染循环写成「每帧问 Cloth Config 要值」，那东西有 GUI 状态、跨线程读容易翻车。做法是：POJO 是唯一真相，Cloth Config 保存时回写 POJO 并 `save()`，渲染循环读 POJO 字段，恰如 JS 里 `getS()` 读 `cfg.settings` + `__sCache`。`__sCache` 那层缓存（806–819）在 Java 里没必要——字段访问本来就是 O(1)，省掉缓存反而避免改了配置还得手动失效。

---

## 3. 性能分级：`perfLevel` / `perfGlow` / `perfFx`

源码 1943–1959，逻辑很短但影响面大：

```js
function perfLevel() {
  const v = String(getS('perf','level') || '自动');
  if (v !== '自动') return v;
  const fps = num(state.game, 'fps');
  if (fps && fps < 25) return '省电';
  if (fps && fps < 45) return '均衡';
  return '绚丽';
}
function perfGlow() { return perfLevel() === '绚丽' && getS('perf','noGlow') !== true; }
function perfFx() {
  const lv = perfLevel();
  if (lv === '省电') return 0.4;
  if (lv === '均衡') return 0.7;
  return Math.max(0.3, Number(getS('perf','fxQuality')) || 1);
}
```

`perfFx()` 直接决定采样点数：`N = max(32, round(96 * perfFx()))`（2132 行），还决定粒子数量（2229 行 `省电 ? 3 : 8`）。`perfGlow()` 门控所有 `shadowBlur`（2169、2190、2198、2228、2264 行）和 `ectx.filter` 模糊（2264 行）。Java 版：

```java
package dev.opus.fabric.aura;

import net.minecraft.client.MinecraftClient;

public final class PerfTier {
    public enum Level { LOW, MEDIUM, HIGH }   // 省电 / 均衡 / 绚丽

    private final AuraConfig cfg;
    private long fpsWindowStart = System.nanoTime();
    private int  frames;
    private int  lastFps = 60;

    public PerfTier(AuraConfig cfg) { this.cfg = cfg; }

    /** END_CLIENT_TICK 每帧调一次，滑动 1 秒窗口估 FPS。 */
    public void tick() {
        frames++;
        long now = System.nanoTime();
        if (now - fpsWindowStart >= 1_000_000_000L) {
            lastFps = (int) (frames * 1_000_000_000.0 / (now - fpsWindowStart));
            frames = 0;
            fpsWindowStart = now;
        }
    }

    public Level level() {
        switch (cfg.perfLevel) {
            case "省电": return Level.LOW;
            case "均衡": return Level.MEDIUM;
            case "绚丽": return Level.HIGH;
            default:                              // '自动'
                if (lastFps < 25) return Level.LOW;
                if (lastFps < 45) return Level.MEDIUM;
                return Level.HIGH;
        }
    }

    /** 对应 perfGlow()。 */
    public boolean glow() { return level() == Level.HIGH && !cfg.perfNoGlow; }

    /** 对应 perfFx()。 */
    public float fx() {
        switch (level()) {
            case LOW:    return 0.4f;
            case MEDIUM: return 0.7f;
            default:     return Math.max(0.3f, (float) cfg.perfFxQuality);
        }
    }

    /** 2132 行：N = max(32, round(96 * perfFx()))。 */
    public int sampleCount() { return Math.max(32, Math.round(96 * fx())); }

    /** 2229 行：省电 3 颗，否则 8 颗。 */
    public int particleCount() { return level() == Level.LOW ? 3 : 8; }
}
```

FPS 采样别用 `MinecraftClient.getFps()` 的瞬时值直接判档，抖一下就反复切档、采样点数跟着跳，光环会「呼吸式」忽粗忽细。上面用 1 秒滑窗，`lastFps` 只在窗口边界更新，档位切换才稳定。`MinecraftClient.getInstance().getCurrentFps()` 也能用，但要自己加滞回（hysteresis），别照抄。

---

## 4. 17 种 `ringMode`：半径函数与动效开关

这里得先把一个容易搞错的点讲明白：**源码里 17 种模式并不是 17 个半径函数**。`cmShapeRadius()`（2058–2087）的 `switch` 只有 9 个几何 case，其余一律 `default: return rad`（标准圆）。另外 8 种「动效模式」的差别全在 `drawAuraRing` 里那一组布尔开关（`waveOn` / `pulseOn` / `spinOn` / `partsOn` / `musicOn` / `rainbowOn` / `layers`），半径都是同一个 `rad`。

所以「17 种完整定义」= 9 个几何半径函数 + 8 组 flags 组合。别硬凑 17 个 `radius()` 分支，那样会把「模式」和「形状」两套正交的东西焊死。

### 4.1 模式清单与开关组合（2093–2130 逐行对照）

| # | 模式 | 类别 | `cmShapeRadius` 行为 | rainbow | wave | pulse | spin | parts | music | layers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 极光 | 动效 | 圆 `rad` | ✓(可关) | ✓ | ✓ | ✓ | ✓(可关) | — | 用户值 |
| 2 | 彩虹 | 动效 | 圆 `rad` | ✓ | — | — | — | — | — | **强制 1** |
| 3 | 脉冲 | 动效 | 圆 `rad` | — | — | ✓ | — | — | — | **强制 1** |
| 4 | 旋转 | 动效 | 圆 `rad` | — | — | — | ✓ | ✓(可关) | — | 用户值 |
| 5 | 波浪 | 动效 | 圆 `rad` | — | ✓ | — | — | — | — | **强制 1** |
| 6 | 粒子 | 动效 | 圆 `rad` | — | — | — | — | ✓(可关) | — | **强制 1** |
| 7 | 双层 | 动效 | 圆 `rad` | — | — | — | ✓ | — | — | **≥2** |
| 8 | 音乐律动 | 动效 | 圆 `rad` | ✓(强制) | ✓ | ✓ | ✓ | ✓(强制) | ✓ | **≥2** |
| 9 | 五芒星 | 几何 | `star(5, .44)` | ✓(可关) | — | ✓ | ✓ | — | — | **强制 1** |
| 10 | 六芒星 | 几何 | `star(6, .50)` | ✓(可关) | — | ✓ | ✓ | — | — | **强制 1** |
| 11 | 三角阵 | 几何 | `star(3, .42)` | ✓(可关) | — | ✓ | ✓ | — | — | **强制 1** |
| 12 | 菱形 | 几何 | `poly(4)` | ✓(可关) | — | ✓ | ✓ | — | — | **强制 1** |
| 13 | 六边形 | 几何 | `poly(6)` | ✓(可关) | — | ✓ | ✓ | — | — | **强制 1** |
| 14 | 花瓣 | 几何 | 花瓣 | ✓(可关) | — | ✓ | ✓ | — | — | **强制 1** |
| 15 | 齿轮 | 几何 | 齿轮 | ✓(可关) | — | ✓ | ✓ | — | — | **强制 1** |
| 16 | 螺旋 | 几何 | 螺旋 | ✓(可关) | — | ✓ | ✓ | — | — | **强制 1** |
| 17 | 星轨 | 几何 | 星轨 | ✓(可关) | — | ✓ | ✓ | — | — | **强制 1** |

几个从源码抠出来、容易漏的细节：

- `shapeSpin`（2098 行 `const shapeSpin = shapeMode ? 1 : 0`）**定义了但后面没用**。几何图案真正的自转来自 2162 行 `phase = L*1.7 + (shapeMode ? t*0.55 : 0)` 和 2200 行 `ang = ... + t*0.55`。照抄时别去找 `shapeSpin` 的下游，没有下游。
- `cmShapeRadius(shape, a, rad, t, phase, wobble)` 的 `wobble` 参数**在函数体里完全没被引用**（2153 行传进去，2058–2087 没读）。`wobble` 真正起作用是在 `makePts` 里加波浪的那一行：`rad += sin(a*6 + t*2.6 + phase) * 0.34 * wobble`，传的是 `1 - L*0.2`。Java 版我保留签名对齐，但会注明这个参数在半径函数里是死参数。
- `layers` 的覆盖顺序（2127–2130）：先取 `clamp(ringLayers,1,4)`；彩虹/脉冲/粒子/波浪 → 1；`shapeMode` → 1；双层/音乐律动 → `max(2, layers)`。**后写的覆盖先写的**，音乐律动即使之前被设成别的值也会被拉回 ≥2。
- `rainbowOn`（2120）的精确条件：`ringRainbow !== false && (极光|彩虹|几何)` 或 `musicOn`。也就是「彩虹」「几何」在用户关掉 rainbow 时也会灭；「音乐律动」无视用户设置强制开。

### 4.2 `ShapeRadius.java` —— 9 个几何形状的 1:1 数学

逐 case 给实现。源码里的 `TAU`、`seg = TAU/n`、`u = ((a+phase) % seg + seg) % seg`（JS 取模可能是负，得手动归一）都要还原。Java 的 `%` 对负数同样返回负值，所以必须套一层 `floorMod` 风格的归一化，别直接 `a+phase % seg` 了事。

```java
package dev.opus.fabric.aura;

import static java.lang.Math.*;

/** 对应 cmShapeRadius / CM_GEOM / CM_GEOM_TIPS（2055-2088）。无状态，可直接静态调。 */
public final class ShapeRadius {
    public static final double TAU = PI * 2;

    public static final String[] GEOMS = {
        "五芒星", "六芒星", "三角阵", "菱形", "六边形", "花瓣", "齿轮", "螺旋", "星轨"
    };
    /** 尖角数；螺旋、星轨为 0（没有离散尖角，不画顶点发光点）。 */
    public static final java.util.Map<String, Integer> TIPS = java.util.Map.of(
        "五芒星", 5, "六芒星", 6, "三角阵", 3, "菱形", 2,
        "六边形", 6, "花瓣", 8, "齿轮", 12, "螺旋", 0, "星轨", 0
    );

    public static boolean isGeom(String mode) {
        for (String g : GEOMS) if (g.equals(mode)) return true;
        return false;
    }

    /** 把任意角归到 [0, mod)；对应 JS 的 ((x % m) + m) % m。 */
    private static double wrap(double x, double mod) {
        double r = x % mod;
        return r < 0 ? r + mod : r;
    }

    /**
     * n 尖星：一圈恰好 n 个尖、n 个谷，周期 2π/n。
     * 注意源码注释特意强调别写成 2π/2n，那会变成 2n 个尖。
     * inner 是谷底半径比例，f 在 [0,1] 之间三角波往返。
     */
    private static double star(int n, double inner, double a, double rad, double phase) {
        double seg  = TAU / n;
        double u    = wrap(a + phase, seg);
        double half = seg / 2;
        double f    = u < half ? 1 - u / half : (u - half) / half;
        return rad * (inner + (1 - inner) * f);
    }

    /**
     * 正 n 边形极坐标方程：直边，不是用 cos 调出来的波浪圆。
     * r = R·cos(π/n) / cos(u - π/n)，分母下限 0.2 防止退化。
     */
    private static double poly(int n, double a, double rad, double phase) {
        double seg = TAU / n;
        double u   = wrap(a + phase, seg);
        return rad * cos(PI / n) / max(0.2, cos(u - seg / 2));
    }

    /**
     * 与 JS 签名一一对应。wobble 在源码里是死参数，保留只为对齐调用点。
     * @param a      当前极角（0..2π）
     * @param rad    基准半径
     * @param t      已乘过 ringSpeed 的全局秒数
     * @param phase  相位偏移（每层不同）
     */
    public static double radius(String shape, double a, double rad,
                                double t, double phase, double wobble) {
        switch (shape) {
            case "五芒星":
                // 唯一的呼吸项：整体半径随 t 轻微起伏
                return star(5, 0.44, a, rad, phase) * (1 + 0.06 * sin(t * 2.4));
            case "六芒星":
                return star(6, 0.50, a, rad, phase);
            case "三角阵":
                return star(3, 0.42, a, rad, phase);
            case "菱形":
                return poly(4, a, rad, phase);            // n=4，TIPS 里写 2 只是「两个长轴端点」
            case "六边形":
                return poly(6, a, rad, phase);
            case "花瓣":
                // 8 瓣：|cos(4θ)| 出 8 个峰，相位只吃 0.4 倍
                return rad * (0.66 + 0.34 * abs(cos(4 * (a + phase * 0.4))));
            case "齿轮":
                // 12 齿方波：cos>0 顶到 1，否则 0.88
                return rad * (0.88 + 0.12 * (cos(12 * (a + phase)) > 0 ? 1 : 0));
            case "螺旋":
                // 半径随「角度 + 时间」线性爬升，每转一圈从 0.35R 涨到 1R，然后硬跳回
                double ang = wrap(a + t * 0.8 + phase, TAU);
                return rad * (0.35 + 0.65 * (ang / TAU));
            case "星轨":
                // 几乎是圆，叠一层高频细纹（a*24 + t*4）
                return rad * (1 + 0.03 * sin(a * 24 + t * 4));
            default:
                // 8 种动效模式：标准圆
                return rad;
        }
    }
}
```

`poly()` 里 `max(0.2, cos(...))` 的 0.2 是源码 2072 行的下限，照抄。`star()` 的 `inner` 值（五芒星 0.44、六芒星 0.50、三角阵 0.42）逐 case 对过，别统一成一个数。

### 4.3 `ModeFlags.java` —— 8 种动效模式的开关组合

把 2104–2130 那堆 `||` 收进一个对象，避免主渲染函数里再出现十几处 `mode.equals(...)`。

```java
package dev.opus.fabric.aura;

/** 把 drawAuraRing 里 2104-2130 的布尔推导集中到这里。 */
public final class ModeFlags {
    public final boolean geom, music, rainbow, wave, pulse, spin, parts;
    public final int     layers;

    public ModeFlags(AuraConfig cfg) {
        String mode = cfg.ringMode;
        geom   = ShapeRadius.isGeom(mode);
        music  = "音乐律动".equals(mode);

        boolean userRainbow = cfg.ringRainbow;
        rainbow = (userRainbow && ("极光".equals(mode)
                                || "彩虹".equals(mode)
                                || geom)) || music;
        wave  = "极光".equals(mode) || "波浪".equals(mode) || music;
        pulse = "极光".equals(mode) || "脉冲".equals(mode) || geom || music;
        spin  = "极光".equals(mode) || "旋转".equals(mode)
              || "双层".equals(mode) || geom || music;
        parts = (cfg.ringParticles && ("极光".equals(mode)
                                   || "旋转".equals(mode)
                                   || "粒子".equals(mode))) || music;

        int n = Math.max(1, Math.min(4, cfg.ringLayers));
        if ("彩虹".equals(mode) || "脉冲".equals(mode)
            || "粒子".equals(mode) || "波浪".equals(mode)) n = 1;
        if (geom) n = 1;                          // 几何单层，避免多层盖住尖角
        if ("双层".equals(mode) || music) n = Math.max(2, n);
        layers = n;
    }
}
```

---

## 5. 投影：`project()` 与 `ringProject()` 的近平面裁剪

这是整卷最值得逐行读的算法。先说普通单点投影（1853–1860），再说带裁剪的环投影（2012–2040）。

### 5.1 单点 `project()`

```js
const m = v.vp;                              // 列主序 4x4
const cw = m[3]*x + m[7]*y + m[11]*z + m[15];
if (cw <= 0.1) return null;                  // 相机后方 / 太近 → 丢弃
const cx = m[0]*x + m[4]*y + m[8]*z + m[12];
const cy = m[1]*x + m[5]*y + m[9]*z + m[13];
return { x:(cx/cw*0.5+0.5)*w, y:(1-(cy/cw*0.5+0.5))*h };
```

`m` 是列主序 `m[col*4+row]`：`m[3],m[7],m[11],m[15]` 是数学矩阵第 4 行（w 分量），`m[0],m[4],m[8],m[12]` 是第 1 行（x），`m[1],m[5],m[9],m[13]` 是第 2 行（y）。屏幕 y 做了翻转（NDC 的 +y 朝上，canvas 的 +y 朝下）。

JOML 的 `Matrix4f` 同样是列主序存储，但 getter `m00()` 是**数学 row0col0**。直接用一个 `Vector4f` 做矩阵乘最省事，`Vector4f.mul(Matrix4f)` 算的就是 `M · v`，等价于上面那串展开：

```java
static Vec2 project(Matrix4f vp, double x, double y, double z, int W, int H) {
    org.joml.Vector4f v = new org.joml.Vector4f((float) x, (float) y, (float) z, 1f).mul(vp);
    float cw = v.w;
    if (cw <= 0.1f) return null;                       // 对应 cw <= 0.1
    float nx = v.x / cw, ny = v.y / cw;               // NDC
    return new Vec2((nx * 0.5f + 0.5f) * W,
                    (1f - (ny * 0.5f + 0.5f)) * H);
}
```

### 5.2 为什么需要 `ringProject()`

普通 `project()` 遇到 `cw <= 0.1` 直接返回 `null`。`strokeRingPath()`（1999–2008）遇到 `null` 会断笔：`on=false`。对**闭合圆环**来说，只要玩家俯视角度让环的一部分落到相机后方，那一段就被丢掉，折线断开；更糟的是第 0 层填充 `ctx.fill()`（2173–2178）会因为路径不闭合而整块残缺或消失——源码 2010–2011 的注释说得就是这个坑：「紫色填充不会残缺或整块消失」。

`ringProject()` 的解法不是硬性丢弃，而是**把相机后方的点沿环的两侧邻居插值，压到近平面 `cw = EPS` 上，取一个屏幕边缘坐标**，让环在任何俯仰 / 第三人称角度都保持闭合。算法分四步：

1. 先把所有 3D 点一次性变成 clip 坐标 `{cw, cx, cy}`（`raw[]`），`EPS = 0.08`。
2. `cw > EPS` 的点正常透视除法得到屏幕坐标。
3. `cw <= EPS` 的点：沿环向前、向后各找**最近**一个 `cw > EPS` 的邻居 `prev` / `next`（2026–2029 的双向扩散查找）。
4. 对每个邻居 `p`，在 `cw` 维度上做线性插值求它与当前点连线和近平面 `cw=EPS` 的交点：`t = (EPS - p.cw)/(a.cw - p.cw)`，`cx/cy` 按同一 `t` 插值（2031–2035 的 `cross()`）。两个交点取平均（2036），再走正常 `scr()` 投影。整圈都找不到可见邻居（极端情况：整个环在相机后）才返回 `null`。
5. `closed=true` 时在末尾 push 首点，闭合路径。

注意 `cross()` 里的 `t` 是用 `p.cw`（可见邻居）与 `a.cw`（当前后方点）算的，`cx/cy` 却是从 `p` 往 `a` 插：`p.cx + (a.cx - p.cx)*t`。`t=0` 落在 `p`，`t=1` 落在 `a`，而 `cw=EPS` 位于两者之间，所以这是正确的线段参数化，别改成反的。

### 5.3 Java 版 `ringProject()`（Matrix4f + Camera）

```java
package dev.opus.fabric.aura;

import net.minecraft.client.render.Camera;
import net.minecraft.util.math.Vec3d;
import org.joml.Matrix4f;
import org.joml.Quaternionf;
import org.joml.Vector4f;

import java.util.ArrayList;
import java.util.List;

public final class ProjectUtil {
    private static final float EPS = 0.08f;

    /** 屏幕点。x/y 是物理像素，null 表示整段不可见。 */
    public static final class Pt {
        public final float x, y;
        public Pt(float x, float y) { this.x = x; this.y = y; }
        public Pt copy() { return new Pt(x, y); }
    }

    /** clip 空间中间量，对应 ringProject 里的 raw[i] = {cw,cx,cy}。 */
    private static final class Clip {
        float cw, cx, cy;
    }

    /**
     * 用 Camera 自己造 view 矩阵，乘上投影矩阵得到 vp。
     * 这样完全不依赖 RenderSystem 内部当前矩阵，HUD 阶段也能调。
     * 若发现上下/前后反了，把 rot 取 conjugate（Yarn 各小版本 Camera.getRotation 方向可能不同）。
     */
    public static Matrix4f buildViewProjection(Camera camera, Matrix4f projection) {
        Vec3d pos = camera.getPos();
        Quaternionf rot = camera.getRotation();      // org.joml.Quaternionf
        // view = R · T(-camPos)：先平移到相机原点，再旋到相机朝向
        Matrix4f view = new Matrix4f().rotation(rot)
                .translate((float) -pos.x, (float) -pos.y, (float) -pos.z);
        return new Matrix4f(projection).mul(view);
    }

    /** 没有现成投影矩阵时按 FOV 自造一个（兜底）。 */
    public static Matrix4f perspective(float fovDeg, float aspect, float near, float far) {
        return new Matrix4f().perspective((float) Math.toRadians(fovDeg), aspect, near, far);
    }

    private static Clip toClip(Matrix4f vp, double x, double y, double z) {
        Vector4f v = new Vector4f((float) x, (float) y, (float) z, 1f).mul(vp);
        Clip c = new Clip();
        c.cx = v.x; c.cy = v.y; c.cw = v.w;
        return c;
    }

    /** NDC → 屏幕像素，对应 scr(c)。 */
    private static Pt screen(Clip c, int W, int H) {
        float inv = 1f / c.cw;
        float nx = c.cx * inv, ny = c.cy * inv;
        return new Pt((nx * 0.5f + 0.5f) * W,
                      (1f - (ny * 0.5f + 0.5f)) * H);
    }

    /** 线段 p→a 与近平面 cw=EPS 的交点，对应 cross(p)。 */
    private static Clip cross(Clip p, Clip a) {
        float t = (EPS - p.cw) / (a.cw - p.cw);
        Clip c = new Clip();
        c.cw = EPS;
        c.cx = p.cx + (a.cx - p.cx) * t;
        c.cy = p.cy + (a.cy - p.cy) * t;
        return c;
    }

    /**
     * 1:1 对应 ringProject(v, coords, W_, H_, closed)。
     * @param world 环上 3D 点（世界绝对坐标）
     */
    public static Pt[] ringProject(Matrix4f vp, Vec3d[] world, int W, int H, boolean closed) {
        int n = world.length;
        Clip[] raw = new Clip[n];
        for (int i = 0; i < n; i++) {
            Vec3d q = world[i];
            raw[i] = toClip(vp, q.x, q.y, q.z);
        }

        Pt[] out = new Pt[n];
        for (int i = 0; i < n; i++) {
            Clip a = raw[i];
            if (a.cw > EPS) { out[i] = screen(a, W, H); continue; }

            Clip prev = null, next = null;
            for (int s = 1; s < n && (prev == null || next == null); s++) {
                if (prev == null) {
                    Clip p = raw[(i - s + n) % n];
                    if (p.cw > EPS) prev = p;
                }
                if (next == null) {
                    Clip p = raw[(i + s) % n];
                    if (p.cw > EPS) next = p;
                }
            }
            if (prev == null || next == null) { out[i] = null; continue; }

            Clip ia = cross(prev, a), ib = cross(next, a);
            Clip mid = new Clip();
            mid.cw = EPS;
            mid.cx = (ia.cx + ib.cx) / 2f;
            mid.cy = (ia.cy + ib.cy) / 2f;
            out[i] = screen(mid, W, H);
        }

        if (closed) {
            Pt[] closedArr = new Pt[n + 1];
            System.arraycopy(out, 0, closedArr, 0, n);
            closedArr[n] = out[0] == null ? null : out[0].copy();
            return closedArr;
        }
        return out;
    }

    /** 单点投影，对应 project()。 */
    public static Pt project(Matrix4f vp, double x, double y, double z, int W, int H) {
        Clip c = toClip(vp, x, y, z);
        return c.cw <= 0.1f ? null : screen(c, W, H);
    }
}
```

关于 `Camera.getRotation()`：Yarn 1.21.1 里它返回 `Quaternionf`，表示把世界方向旋到视图空间的旋转。有些版本语义是反的，跑起来如果发现光环左右镜像或俯仰反向，对 `rot` 调 `.conjugate()` 或对 view 矩阵调 `.invert()` 即可——这是移植时唯一需要实测校准的地方，源码那边 `v.vp` 是游戏直接给的、不存在这个歧义。

**`project()` 那 0.1 阈值和 `ringProject()` 的 0.08 不一样**：单点投影用 0.1（1856），环投影用 `EPS = 0.08`（2013），别合并成一个常量。粒子、频谱柱、顶点发光点走的是 `project()`（2202、2231、2252–2253），环折线走 `ringProject()`。

### 5.4 view-projection 矩阵从哪拿

三条路，按推荐顺序：

1. **自己造（上面 `buildViewProjection`）**：`ClientPlayConnectionEvents.JOIN` 之后 `MinecraftClient.getInstance().gameRenderer.getCamera()` 恒有效，投影矩阵用 `RenderSystem.getProjectionMatrix()`（Yarn 小版本可能叫 `getProjectionMatrix()` / `projectionMatrix`，按实际 mapping 调）或 `perspective()` 兜底。最可控，推荐。
2. `WorldRenderEvents.AFTER_ENTITIES` 里 `context.camera()` + `RenderSystem.getProjectionMatrix()` 缓存到字段，给同一帧的 HUD 阶段用。跨阶段传矩阵要注意投影矩阵在 HUD 阶段会被 MC 换成正交矩阵，**必须缓存值而不是在 HUD 里现取**。
3. 完全走 3D 管线：`WorldRenderContext.matrixStack()` + `VertexConsumerProvider` + `RenderLayer.getLines()`，顶点喂相对相机的世界坐标，让 MC 自己投影。这条**不需要 `ringProject()`**（GL 会裁剪线元），但填充三角形在相机穿过环面时仍可能出问题，而且有深度遮挡、语义偏离源码的「永远在 HUD 之上」。作为可选增强放第 14 节讲，主线仍用屏幕空间路径。

---

## 6. 颜色：`hexToHue` / `withAlpha` / `ringGrad`

### 6.1 `hexToHue()`（1986–1996）

标准 RGB→HSL 的 H 分量，只求色相。`#rgb` 三位要展开成六位，不足六位 `padEnd(6,'0')`，`parseInt` 失败兜底 280（紫）。Java 版：

```java
/** 对应 hexToHue；返回 0..360。 */
public static double hexToHue(String hex) {
    String h = (hex == null ? "" : hex).replace("#", "");
    if (h.length() == 3) {
        StringBuilder sb = new StringBuilder();
        for (char c : h.toCharArray()) sb.append(c).append(c);
        h = sb.toString();
    }
    while (h.length() < 6) h = h + "0";
    h = h.substring(0, 6);
    final int n;
    try { n = Integer.parseInt(h, 16); }
    catch (NumberFormatException e) { return 280; }
    float r = ((n >> 16) & 255) / 255f, g = ((n >> 8) & 255) / 255f, b = (n & 255) / 255f;
    float mx = Math.max(r, Math.max(g, b)), mn = Math.min(r, Math.min(g, b)), d = mx - mn;
    if (d == 0) return 0;
    double hh = mx == r ? ((g - b) / d) % 6
              : mx == g ? (b - r) / d + 2
                        : (r - g) / d + 4;
    return (hh * 60 + 360) % 360;
}
```

`withAlpha()`（1979–1984）在 Java 里没有意义——我们最终要的是 packed ARGB int，不是 CSS 字符串。给个 `hexToArgb(hex, alpha)` 就够：

```java
/** 对应 hexToRgba + withAlpha 的产物，但直接产出 MC 用的 0xAARRGGBB。 */
public static int argb(String hex, float a) {
    String h = (hex == null ? "" : hex).replace("#", "");
    if (h.length() == 3) {
        StringBuilder sb = new StringBuilder();
        for (char c : h.toCharArray()) sb.append(c).append(c);
        h = sb.toString();
    }
    while (h.length() < 6) h += "0";
    final int n;
    try { n = Integer.parseInt(h.substring(0, 6), 16); }
    catch (NumberFormatException e) { n = 0xFF5252; }
    int ai = Math.round(Math.max(0, Math.min(1, a)) * 255);
    return (ai << 24) | (n & 0xFFFFFF);
}
```

### 6.2 `ringGrad()` 彩虹渐变（2042–2050）

```js
const gr = ctx.createLinearGradient(0, 0, W_, H_);   // 从左上到右下
const h0 = hexToHue(hex);
for (let i = 0; i <= 8; i++)
  gr.addColorStop(i/8, 'hsla(' + round((h0 + i/8*360 + t*40) % 360) + ',95%,66%,' + a + ')');
```

一条沿屏幕对角线的 9 色标渐变，色相从 `h0` 转满一圈再加 `t*40` 的时间偏移，饱和度 95%、亮度 66%，alpha 用传进来的 `a`。注意 `ringGrad` 收到的 `t` 实参是 `t + L*0.3 + hueShift/360`（2166 行），所以层间有相位差，音乐模式还会被高频色相推着走。

Canvas 的线性渐变是「按像素在渐变轴上的投影取色」，Java 里没有现成对象。**最贴近的做法是顶点逐点配色**：折线上每个点按它在对角线 `(0,0)→(W,H)` 上的归一化投影 `s` 取一个 hue，直接把颜色写进 `VertexConsumer.vertex(...).color(...)`。`strokeRingPath` 本来就是逐点 lineTo，逐点给色几乎零成本，而且比「先做一张 1×N 的渐变纹理再采样」简单。

```java
/** HSL(h,95%,66%) → 0xAARRGGBB。h 为度，a 0..1。 */
public static int hsla(float h, float s, float l, float a) {
    h = ((h % 360) + 360) % 360 / 360f;
    float q = l < 0.5f ? l * (1 + s) : l + s - l * s;
    float p = 2 * l - q;
    float r = hue2rgb(p, q, h + 1f/3);
    float g = hue2rgb(p, q, h);
    float b = hue2rgb(p, q, h - 1f/3);
    int ai = Math.round(Math.max(0, Math.min(1, a)) * 255);
    return (ai << 24) | (Math.round(r*255) << 16) | (Math.round(g*255) << 8) | Math.round(b*255);
}
private static float hue2rgb(float p, float q, float t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1f/6) return p + (q - p) * 6 * t;
    if (t < 1f/2) return q;
    if (t < 2f/3) return p + (q - p) * (2f/3 - t) * 6;
    return p;
}

/**
 * 对应 ringGrad 的逐点配色版本。
 * @param gradT  = t + L*0.3 + hueShift/360（2166 行）
 * @return 每个折线点一个 ARGB
 */
public static int[] rainbowColors(ProjectUtil.Pt[] pts, String hex, double gradT,
                                  float a, int W, int H) {
    float h0 = (float) hexToHue(hex);
    float len2 = (float) (W * W + H * H);
    int[] colors = new int[pts.length];
    for (int i = 0; i < pts.length; i++) {
        ProjectUtil.Pt q = pts[i];
        // 点在对角线轴上的投影比例 s = (x*W + y*H)/(W²+H²)，clamp 到 [0,1]
        float s = q == null ? 0 : Math.max(0, Math.min(1, (q.x * W + q.y * H) / len2));
        // 8 段色标：色相 = h0 + s*360 + gradT*40（源码里 t 进了 *40）
        float hue = (h0 + s * 360f + (float) gradT * 40f) % 360f;
        colors[i] = hsla(hue, 0.95f, 0.66f, a);
    }
    return colors;
}
```

关掉 rainbow 时（2120 条件不成立），`ringGrad` 直接 `return withAlpha(hex, a)`，也就是整条线一个纯色——`rainbowColors` 那个分支就退化成 `Arrays.fill(colors, argb(hex, a))`，别傻乎乎还去算 HSL。

`hsla()` 在源码里到处用：顶点发光点（2205）、环绕粒子（2234）、频谱柱（2255）、开场动画（11996、12026、12038 用到 rgba 版）。抽成一个工具类，两卷共用。

---

## 7. 3D 环点生成 `makePts()`（2149–2159）

```js
const makePts = (radius, phase, wobble) => {
  const xyz = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2;
    let rad = cmShapeRadius(mode, a, radius, t, phase, wobble);
    if (waveOn)  rad += Math.sin(a * 6 + t * 2.6 + phase) * 0.34 * wobble;
    if (pulseOn) rad += Math.sin(t * 2.8 + phase) * 0.22;
    xyz[i] = [c[0] + Math.cos(a) * rad, y, c[2] + Math.sin(a) * rad];
  }
  return ringProject(r, xyz, W_, H_, true);
};
```

`y = c[1] + 0.05`（2131 行），环抬到脚底上方 5cm 防 z-fighting；所有点共面（水平面），`y` 恒定。`waveOn` 加 6 瓣正弦波（幅度 `0.34*wobble`），`pulseOn` 加一个只随时间变的整体呼吸（0.22）。Java 版直接返回世界坐标数组，再交给 `ProjectUtil.ringProject`：

```java
/** 对应 makePts：返回环上一圈世界坐标（水平面 y 恒定）。 */
public static Vec3d[] makePoints(Vec3d center, double radius, double phase, double wobble,
                                 double t, int N, String mode, ModeFlags flags) {
    double y = center.y + 0.05;
    Vec3d[] xyz = new Vec3d[N];
    for (int i = 0; i < N; i++) {
        double a = (double) i / N * ShapeRadius.TAU;
        double rad = ShapeRadius.radius(mode, a, radius, t, phase, wobble);
        if (flags.wave)  rad += Math.sin(a * 6 + t * 2.6 + phase) * 0.34 * wobble;
        if (flags.pulse) rad += Math.sin(t * 2.8 + phase) * 0.22;
        xyz[i] = new Vec3d(center.x + Math.cos(a) * rad, y, center.z + Math.sin(a) * rad);
    }
    return xyz;
}
```

主循环里每层的参数（2161–2166）：

```java
for (int L = 0; L < flags.layers; L++) {
    double phase = L * 1.7 + (flags.geom ? t * 0.55 : 0);
    double rad   = cfg.range * (1 - L * 0.14) * (flags.music ? (1 + beat * 0.16) : 1);
    double wobble = 1 - L * 0.2;
    Vec3d[]  world = makePoints(center, rad, phase, wobble, t, N, cfg.ringMode, flags);
    Pt[]     pts   = ProjectUtil.ringProject(vp, world, W, H, true);
    float    a     = (float) (Math.max(0.16, 0.92 - L * 0.17)
                    * (flags.pulse ? 0.78 + 0.22 * Math.sin(t * 3) : 1));
    double   width = Math.max(1, cfg.ringWidth * (1 - L * 0.18));
    // ... 提交折线（第 8 节）
}
```

`a` 的 alpha 下限 0.16（2165 行），层越靠外越淡；`width` 逐层收 18%。

---

## 8. 折线怎么画：Canvas `stroke()` → Java ribbon

`strokeRingPath` + `ctx.stroke()` 在网页里一行搞定，Java 侧没有「画任意宽度折线」的现成 API。两个坑要提前说：

1. `RenderLayer.getLines()` / `RenderSystem.lineWidth()` 的宽线在绝大多数驱动上被 clamp 到 1.0（`GL_ALIASED_LINE_WIDTH_RANGE` 上限就是 1）。`ringWidth` 默认 2.5、最大 8，靠 `glLineWidth` 复刻不出来。
2. 源码的 `lineWidth` 是**屏幕像素**宽度，不随距离缩放。所以正确做法是把折线展开成**屏幕对齐的 quad 带（ribbon）**：对每段 `[p_i, p_{i+1}]`，算法向量 `n = normalize(perp(dir)) * width/2`，生成两个三角形（4 个顶点），用 `RenderLayer` 的 `QUADS`/`TRIANGLES` 提交，颜色逐点给。

```java
/**
 * 把屏幕折线展开成带宽度的三角形带，提交给 VertexConsumer。
 * pts 为 null 时断笔（对应 strokeRingPath 的 on=false 语义）。
 */
public static void strokePolyline(VertexConsumer vc, MatrixStack matrices,
                                  ProjectUtil.Pt[] pts, int[] colors, float widthPx) {
    float half = widthPx * 0.5f;
    Matrix4f mat = matrices.peek().getPositionMatrix();
    for (int i = 0; i + 1 < pts.length; i++) {
        ProjectUtil.Pt p = pts[i], q = pts[i + 1];
        if (p == null || q == null) continue;                  // 断笔
        float dx = q.x - p.x, dy = q.y - p.y;
        float len = (float) Math.hypot(dx, dy);
        if (len < 1e-4f) continue;
        float nx = -dy / len * half, ny = dx / len * half;     // 法向 * 半宽
        int c0 = colors[i], c1 = colors[i == colors.length - 1 ? i : i + 1];

        // 两个三角形： (p+n, p-n, q+n) 与 (q+n, p-n, q-n)
        emit(vc, mat, p.x + nx, p.y + ny, c0);
        emit(vc, mat, p.x - nx, p.y - ny, c0);
        emit(vc, mat, q.x + nx, q.y + ny, c1);
        emit(vc, mat, q.x + nx, q.y + ny, c1);
        emit(vc, mat, p.x - nx, p.y - ny, c0);
        emit(vc, mat, q.x - nx, q.y - ny, c1);
    }
}
private static void emit(VertexConsumer vc, Matrix4f mat, float x, float y, int argb) {
    vc.vertex(mat, x, y, 0f).color(argb).normal(0, 0, 1);   // HUD 阶段 z=0
}
```

这个 ribbon 是在**屏幕空间**画的（`DrawContext` 的 `MatrixStack` 是像素坐标、z=0），所以宽度天然是像素、不随距离变，和 Canvas 一致。顶点格式用 `VertexFormats.POSITION_COLOR`（或 `POSITION_COLOR_NORMAL`，按你选的 RenderLayer 定）。关掉深度测试和面剔除，混合开 `SRC_ALPHA / ONE_MINUS_SRC_ALPHA`，对应 Canvas 默认的 source-over。

自定义 RenderLayer（1.21.1 Yarn，按实际 mapping 微调 `RenderPhase` 常量名）：

```java
public static final RenderLayer AURA_SCREEN = RenderLayer.of(
    "opus:aura_screen",
    VertexFormats.POSITION_COLOR,
    VertexFormat.DrawMode.TRIANGLES,   // ribbon 展开成三角形
    256, false, false,
    RenderLayer.MultiPhaseParameters.builder()
        .transparency(RenderPhase.TRANSLUCENT_TRANSPARENCY)
        .depthTest(RenderPhase.ALWAYS_DEPTH_TEST)             // 永远在 HUD 之上
        .cull(RenderPhase.DISABLE_CULLING)
        .writeMaskState(RenderPhase.ALL_MASK)
        .build(false)
);
```

第 0 层填充（2173–2178）用同一批 `pts` 做三角扇（以环心为公共顶点，`pts` 相邻两点成三角形），颜色 `argb(hex, fillA)`，`fillA = max(0, ringFill)/100`，`shadowBlur` 置 0——也就是填充不发光，只有描边发光。这里必须复用 `ringProject(..., closed=true)` 的结果，否则近平面那一段不闭合，填充又残缺了。

---

## 9. 辉光 `shadowBlur` → 全屏后处理（两趟可分离高斯）

网页里 `ctx.shadowColor/shadowBlur`（2168–2169、2190、2198、2228）是 Canvas 自带的「描边外发光」，Java 里没有等价物。团队口径给的方案是 **`RenderTarget` + 两趟可分离高斯模糊 shader**：把发光内容单独渲染到离屏 target，水平模糊到 ping、垂直模糊到 pong，再加法混合回主帧缓冲。这同时把 2264 行的 `ectx.filter = 'blur(Npx)'` 动态模糊一起解决了——同一个高斯，只是 `sigma` 来源不同。

### 9.1 采集哪些内容进离屏

不是整个光环都进离屏。源码里 `shadowBlur` 只作用于：环描边、spin 短弧、顶点发光点、粒子；填充不发光（2174 行 `ctx.shadowBlur = 0`）。所以离屏 target 里只画「需要发光的图元」，描边和辉光可以画两遍（一遍清晰、一遍进离屏），也可以只把清晰描边画进离屏再模糊叠加——后者更省，源码的 `shadowBlur` 视觉上就是「描边 + 一圈模糊光晕」，用「离屏描边 → 模糊 → 加法叠加 → 主画面再画清晰描边」两步即可复刻。

`glow` 到 `sigma` 的换算：`shadowBlur` 是 CSS 像素半径，近似 `sigma ≈ shadowBlur / 2`；`fxBlur`（2264 行 `blur(blurBase px)`）同理。`blurBase = max(0, fxBlur) * (1 + beat*0.7)`（2135 行），音乐模式下鼓点会放大模糊。合成时 `globalAlpha = 0.92`（2265 行）。

### 9.2 高斯 shader（`aura_blur.fsh`）

用 MC post-effect 的 vertex shader 约定（`Position` / `ProjMat` / `InSize` / `OutSize`），fragment 只管方向和半径。9 tap 足够，`sigma` 用循环权重算，避免硬编码两张纹理：

```glsl
// aura_blur.vsh —— 与 MC 内置 post shader 同款
#version 150

in vec3 Position;

uniform mat4 ProjMat;
uniform vec2 InSize;
uniform vec2 OutSize;

out vec2 texCoord;
out vec2 oneTexel;

void main() {
    vec4 outPos = ProjMat * vec4(Position.xy, 0.0, 1.0);
    gl_Position = vec4(outPos.xy, 0.2, 1.0);
    oneTexel = 1.0 / InSize;
    texCoord = Position.xy / OutSize;
}
```

```glsl
// aura_blur.fsh —— 一趟可分离高斯，方向由 BlurDir 控制
#version 150

uniform sampler2D DiffuseSampler;

in vec2 texCoord;
in vec2 oneTexel;

uniform vec2  BlurDir;    // (1,0) 水平趟 / (0,1) 垂直趟
uniform float Radius;     // 由 glow / fxBlur 换算的像素半径

out vec4 fragColor;

void main() {
    // 9 tap，权重用 exp(-i²/2σ²)，σ = Radius/2
    float sigma = max(0.5, Radius * 0.5);
    float w0 = 1.0;
    float w1 = exp(-1.0 / (2.0 * sigma * sigma));
    float w2 = exp(-4.0 / (2.0 * sigma * sigma));
    float w3 = exp(-9.0 / (2.0 * sigma * sigma));
    float w4 = exp(-16.0 / (2.0 * sigma * sigma));
    float wsum = w0 + 2.0 * (w1 + w2 + w3 + w4);

    vec2 step = oneTexel * BlurDir;
    vec3 sum = texture(DiffuseSampler, texCoord).rgb * w0;
    sum += texture(DiffuseSampler, texCoord + step * 1.0).rgb * w1;
    sum += texture(DiffuseSampler, texCoord - step * 1.0).rgb * w1;
    sum += texture(DiffuseSampler, texCoord + step * 2.0).rgb * w2;
    sum += texture(DiffuseSampler, texCoord - step * 2.0).rgb * w2;
    sum += texture(DiffuseSampler, texCoord + step * 3.0).rgb * w3;
    sum += texture(DiffuseSampler, texCoord - step * 3.0).rgb * w3;
    sum += texture(DiffuseSampler, texCoord + step * 4.0).rgb * w4;
    sum += texture(DiffuseSampler, texCoord - step * 4.0).rgb * w4;
    fragColor = vec4(sum / wsum, 1.0);
}
```

对应的 effect 声明（放到 `assets/opus/shaders/post/aura_blur.json`）：

```json
{
  "name": "opus:aura_blur",
  "intarget": "minecraft:main",
  "outtarget": "ping",
  "auxtargets": [],
  "uniforms": [
    { "name": "ProjMat",     "type": "matrix4x4", "count": 1,  "values": [ 1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1 ] },
    { "name": "InSize",      "type": "float",     "count": 2,  "values": [ 1, 1 ] },
    { "name": "OutSize",     "type": "float",     "count": 2,  "values": [ 1, 1 ] },
    { "name": "BlurDir",     "type": "float",     "count": 2,  "values": [ 1, 0 ] },
    { "name": "Radius",      "type": "float",     "count": 1,  "values": [ 7.0 ] }
  ]
}
```

实际工程里更省事的是不走 `PostEffectProcessor` 的 json，而是自己持有一个 `ShaderProgram`（`net.minecraft.client.gl.ShaderProgram`）+ 两个 `RenderTarget` 做 ping-pong，每帧设 `BlurDir` / `Radius` uniform 跑两趟。调度代码放第 11 节。

### 9.3 加法混合回主画面

```java
// 模糊完的 ping 纹理加法叠回主帧缓冲（alpha 0.92 对应 2265 行 globalAlpha）
RenderSystem.enableBlend();
RenderSystem.blendFunc(GlStateManager.SrcFactor.SRC_ALPHA,
                       GlStateManager.DstFactor.ONE);      // additive
// 绑定 ping.getColorAttachment()，画一个覆盖全屏的 quad，颜色 * 0.92
RenderSystem.disableBlend();
```

`shadowColor` 在 rainbow 模式下是白（2168 行 `rainbowOn ? '#ffffff' : hex`），非 rainbow 用 `hex`——离屏里画描边时把这个颜色乘进顶点色即可，模糊结果自然带上色相。

---

## 10. 拖影 `destination-out` 渐隐 → Framebuffer alpha 衰减

源码 2134–2145 的拖影机制值得单独拆：

```js
fxctx.save();
fxctx.globalCompositeOperation = 'destination-out';
fxctx.fillStyle = 'rgba(0,0,0,' + (1 - trail) + ')';   // trail = fxTrail/100，clamp 0.95
fxctx.fillRect(0, 0, W_, H_);                           // 整屏
fxctx.restore();
const ctx = fxOn ? fxctx : ectx;                        // 这一帧后续全画到 fxCanvas
...
// 2262-2268 合成
ectx.save();
if (blurBase > 0.05 && perfGlow()) ectx.filter = 'blur(blurBase px)';
ectx.globalAlpha = 0.92;
ectx.drawImage(fxCanvas, 0, 0);
ectx.restore();
```

`destination-out` 的语义是 `dst = dst * (1 - src.alpha)`。这里 `src.alpha = 1 - trail`，所以每帧把上一帧的内容整体乘 `trail`（0..0.95）衰减，然后再画当前帧的光环——旧帧以指数方式淡去，形成拖影。`fxOn = blurBase > 0.05 || trail > 0.02`（2137），只要模糊或拖影任一开着就走离屏路径；否则直接画 `ectx`。

Java 里「保留上一帧」= 一个常驻的 `RenderTarget`（不清屏），每帧先跑一个**衰减 pass** 把颜色/alpha 乘 `decay = trail`，再画当前帧光环，再（可选）模糊，最后合成回主画面。

```glsl
// aura_fade.fsh —— 对应 destination-out 的整屏渐隐
#version 150
uniform sampler2D DiffuseSampler;
uniform float Decay;          // = trail

in vec2 texCoord;
out vec4 fragColor;

void main() {
    vec4 c = texture(DiffuseSampler, texCoord);
    // premultiplied framebuffer：rgb 与 a 一起衰减，等价于 destination-out
    fragColor = vec4(c.rgb * Decay, c.a * Decay);
}
```

如果 `RenderTarget` 不带独立 alpha（多数 MC framebuffer 是 RGBA8，带 alpha），直接 `c * Decay` 就行；若驱动把 alpha 固定成 1，退化成只衰减 `rgb`：`fragColor = vec4(c.rgb * Decay, 1.0)`，视觉上拖影照样成立，只是合成时用加法混合而非 source-over。别在这个 pass 里 `clear()`，一清就全没了——`fxCanvas` 源码从来没清过，全靠 `destination-out` 衰减。

`fxBlur` 与 `fxTrail` 的耦合：`blurBase = max(0, fxBlur) * (1 + beat*0.7)`（2135），`trail = clamp(fxTrail/100, 0, 0.95)`（2136）。模糊只在 `perfGlow()` 为真时生效（2264），拖影不受 perf 门控（省电档也有拖影，只是采样点少）。

---

## 11. 后处理调度：`FxPipeline`

把 9、10 两节拼成一个可落地的调度类。它在 `HudRenderCallback` 里被调，输入是「这一帧要画的光环图元」的一个 lambda（这样清晰描边和离屏描边共用同一段绘制代码）。

```java
package dev.opus.fabric.aura;

import com.mojang.blaze3d.systems.RenderSystem;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gl.RenderTarget;
import net.minecraft.client.gl.ShaderProgram;
import net.minecraft.client.gui.DrawContext;

/** fxCanvas / fxctx / shadowBlur / ectx.filter 的 Java 对应物。 */
public final class FxPipeline {
    private final MinecraftClient mc = MinecraftClient.getInstance();
    private RenderTarget accum, ping, pong;       // accum 保留上一帧（拖影）
    private ShaderProgram blur, fade;

    /** 窗口尺寸变化时调，对应 2139 行 fxCanvas.width/height 同步。 */
    public void resize(int W, int H) {
        if (accum != null) { accum.delete(); ping.delete(); pong.delete(); }
        accum = new RenderTarget(W, H, true, MinecraftClient.IS_SYSTEM_MAC);
        ping  = new RenderTarget(W, H, true, MinecraftClient.IS_SYSTEM_MAC);
        pong  = new RenderTarget(W, H, true, MinecraftClient.IS_SYSTEM_MAC);
        accum.setClearColor(0, 0, 0, 0);
    }

    /** @param drawFrame 把「当前帧光环」画进当前绑定的 target（离屏或主画面） */
    public void render(DrawContext ctx, int W, int H, AuraConfig cfg,
                       boolean glowOn, double blurBase, double trail,
                       Runnable drawFrame) {
        boolean fxOn = blurBase > 0.05 || trail > 0.02;
        if (!fxOn) { drawFrame.run(); return; }        // 直接画主画面，对应 ctx = ectx

        if (accum == null || accum.width != W || accum.height != H) resize(W, H);

        // 1) 衰减上一帧：destination-out (1-trail)
        accum.bindWrite(false);
        applyFullscreen(fade, p -> p.uniform("Decay").set((float) trail));

        // 2) 把当前帧光环画进 accum（不清屏）
        drawFrame.run();

        // 3) 两趟高斯（仅 perfGlow 为真，对应 2264）
        RenderTarget src = accum;
        if (glowOn && blurBase > 0.05) {
            ping.bindWrite(false);
            applyFullscreen(blur, p -> {
                p.uniform("BlurDir").set(1f, 0f);
                p.uniform("Radius").set((float) blurBase);
            }, src);
            pong.bindWrite(false);
            applyFullscreen(blur, p -> {
                p.uniform("BlurDir").set(0f, 1f);
                p.uniform("Radius").set((float) blurBase);
            }, ping);
            src = pong;
        }

        // 4) 加法混合回主画面，globalAlpha = 0.92（2265）
        mc.getFramebuffer().bindWrite(false);
        RenderSystem.enableBlend();
        RenderSystem.blendFuncSeparate(
                GlStateManager.SrcFactor.SRC_ALPHA, GlStateManager.DstFactor.ONE,
                GlStateManager.SrcFactor.ONE,       GlStateManager.DstFactor.ONE);
        blitTexture(src.getColorAttachment(), 0.92f);
        RenderSystem.disableBlend();
    }

    // applyFullscreen / blitTexture：绑定 shader、绑 DiffuseSampler、画全屏 quad。
    // 按 1.21.1 的 ShaderProgram + GlUniform 写法填，别用已废弃的 GlProgram。
    private void applyFullscreen(ShaderProgram p, java.util.function.Consumer<ShaderProgram> uniforms) {
        applyFullscreen(p, uniforms, null);
    }
    private void applyFullscreen(ShaderProgram p, java.util.function.Consumer<ShaderProgram> uniforms,
                                 RenderTarget tex) { /* 省略固定样板 */ }
    private void blitTexture(int texId, float alpha) { /* 全屏 quad + 纹理采样 */ }
}
```

`ShaderProgram` / `GlUniform` 的具体构造在 1.21.1 里是 `ShaderProgram(Identifier, VertexFormat, ...)` 或走 `ShaderLoader`，各小版本差异较大，这里只固定「接口长这样、uniform 名叫什么、跑几趟」，样板代码按工程里现有的 post shader 封装复用即可——别为了一个光环另起一套 GL 状态机。

---

## 12. 环绕粒子、环形频谱柱、Web Audio → Java

### 12.1 环绕粒子（2227–2240）

`partsOn` 时每层画 8 颗（省电 3 颗，来自 `perfLevel()`），沿环等分但带旋转：

```js
for (let k = 0; k < (perfLevel()==='省电' ? 3 : 8); k++) {
  const ang = (k/8)*TAU + t*(L%2 ? -0.9 : 0.9) + L*0.4;
  const q = project(r, c0+cos(ang)*rad, y+0.02, c2+sin(ang)*rad, W,H);
  ... arc(q.x,q.y, 2.4 + 0.8*sin(t*4+k), ...)   // 半径呼吸
}
```

颜色 rainbow 时 `hsla((hexToHue(hex)+k*45+t*60)%360, 95%, 72%, .95)`，否则 `withAlpha(hex,.95)`。注意粒子走的是**单点 `project()`**（不是 `ringProject`），相机后方直接 `continue` 丢掉——源码允许粒子在后半圈消失，这跟环折线必须闭合是两种处理。Java 里用 `ProjectUtil.project()` + 一个画实心圆的小 quad（或 `DrawContext` 的圆近似）即可，半径 `2.4 + 0.8*sin(t*4+k)` 是屏幕像素。

### 12.2 环形频谱柱（2243–2259）

只有 `音乐律动` 且拿到频谱数据时画，64 根柱沿环向外辐射，像一圈均衡器：

```js
const bars = 64;
for (let k = 0; k < bars; k++) {
  const a  = k/bars*TAU + t*0.18;
  const bi = Math.floor(k/bars * barData.length * 0.72);   // 只取前 72% 的 bins
  const v  = Math.min(1.4, (barData[bi]||0)/255 * sens);
  const r0 = range*(1+beat*0.16);
  const r1 = r0 + 0.22 + v*2.4;
  p0 = project(...r0), p1 = project(...r1);                 // 两个端点
  strokeStyle = 'hsla(' + round((hueShift + k*6 + 360)%360) + ',95%,68%,.85)';
  lineWidth = Math.max(1.5, width);
  line(p0, p1);
}
```

`barData` 是 `musicSpectrum().bins`（`Uint8Array`，来自 AnalyserNode）。`bi` 的 `0.72` 系数是为了避开高频段（人耳不敏感、数值也小）。Java 里把 64 根柱当成 64 条短线，复用第 8 节的 ribbon（宽度 `max(1.5, ringWidth)`），颜色用 `hsla`。

### 12.3 `musicSpectrum()` 的 Java 对应

网页（3387–3406）：

```js
analyser.getByteFrequencyData(freqData);          // Web Audio AnalyserNode
sum/bass/mid/hi 按频段累加：i < n*.12 是 bass，i < n*.45 是 mid，其余 hi
return { bins, n, level: sum/(n*255),
         bass: bass/(n*.12*255), mid: mid/(n*.33*255), hi: hi/(n*.55*255) };
```

`sum < 8` 直接返回 `null`（CORS 污染 / 静音）。`drawAuraRing` 里拿到 `null` 走伪律动兜底（2113–2118）：

```js
const t2 = performance.now()/1000;
beat = (0.32 + 0.3*Math.sin(t2*6.2)) * sens;
hueShift = 90 + 70*Math.sin(t2*1.7);
```

**这是「数据结构可 1:1 移植、音频采集必须换实现」的典型**。Java 侧没有 `AnalyserNode`，MC 的声音走 OpenAL（LWJGL 的 `ALC11`/`AL10`/`AL11`）。三种落地方式，按性价比排：

1. **OpenAL loopback 采集 + 自写 FFT**：`alcCaptureOpenDevice(deviceName, freq, AL_FORMAT_MONO8/16, bufSize)` 打开系统回环设备，`alcCaptureSamples` 取 PCM → 加汉宁窗 → radix-2 FFT → 取前 N/2 个 bin 的幅度映射到 0..255，凑出 `bins/bass/mid/hi/level`。最忠实，但 Windows 上 loopback 设备名各家驱动不统一，得做设备枚举和降级。
2. **音量包络**：不取频谱，用 MC `SoundManager` 当前播放的 tick / 或 PCM 的 RMS 包络当 `beat`，`bins` 用带通滤波拆成 64 段近似。省事，`环形频谱柱` 视觉上够用。
3. **伪律动兜底**：直接照抄 2115–2118 的时间函数，不需要任何音频输入。源码本来就把这条当无音频时的降级路径，Java 侧把它做成默认实现完全合理。

统一成一个接口，`drawAuraRing` 只认 `Spectrum` 这个数据结构：

```java
package dev.opus.fabric.aura;

/** 对应 musicSpectrum() 的返回结构（3399-3405）。 */
public final class Spectrum {
    public final float[] bins;     // 0..255，长度 = FFT bin 数
    public final float level, bass, mid, hi;
    public Spectrum(float[] bins, float level, float bass, float mid, float hi) {
        this.bins = bins; this.level = level; this.bass = bass; this.mid = mid; this.hi = hi;
    }
}

public interface MusicAnalyzer {
    /** 无数据时返回 null，触发 drawAuraRing 里的伪律动分支。 */
    Spectrum sample();
    void close();
}
```

```java
/** 兜底实现：1:1 对应 2113-2118，不需要 OpenAL。 */
public final class FallbackBeatAnalyzer implements MusicAnalyzer {
    private final double sens;
    public FallbackBeatAnalyzer(double sens) { this.sens = Math.max(0.2, sens); }

    @Override public Spectrum sample() { return null; }   // 让调用方走伪律动

    /** 2109-2118 合并后的 beat / hueShift，供 drawAuraRing 直接取。 */
    public double beat(double tSec)     { return (0.32 + 0.30 * Math.sin(tSec * 6.2)) * sens; }
    public double hueShift(double tSec) { return 90 + 70 * Math.sin(tSec * 1.7); }
    @Override public void close() { }
}
```

真实频谱分支（有 `Spectrum` 时，2108–2112）：

```java
beat     = Math.min(1.4, spec.bass * sens);
hueShift = spec.hi * 220;
barData  = spec.bins;
```

`sens = max(0.2, musicSens)`（2105 行），`beat` clamp 到 1.4，`hueShift` 是度数（后面 `/360` 进 `ringGrad` 的 gradT，2255 行直接进 HSL）。

自写 FFT 的骨架（给 loopback 实现用，radix-2 迭代版，够 64 柱用）：

```java
/** 就地 radix-2 Cooley-Tukey FFT，re/im 长度必须是 2 的幂。 */
public static void fft(float[] re, float[] im) {
    int n = re.length;
    for (int i = 1, j = 0; i < n; i++) {
        int bit = n >> 1;
        for (; (j & bit) != 0; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            float tr = re[i]; re[i] = re[j]; re[j] = tr;
            float ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
    }
    for (int len = 2; len <= n; len <<= 1) {
        double ang = -2 * Math.PI / len;
        float wr = (float) Math.cos(ang), wi = (float) Math.sin(ang);
        for (int i = 0; i < n; i += len) {
            float cr = 1, ci = 0;
            for (int k = 0; k < len / 2; k++) {
                int a = i + k, b = a + len / 2;
                float ur = re[a], ui = im[a];
                float vr = re[b] * cr - im[b] * ci;
                float vi = re[b] * ci + im[b] * cr;
                re[a] = ur + vr; im[a] = ui + vi;
                re[b] = ur - vr; im[b] = ui - vi;
                float ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr; cr = ncr;
            }
        }
    }
}
```

汉宁窗 + 幅度→byte 映射按 `getByteFrequencyData` 的语义做（`-100dB..-30dB` 映射到 0..255 那一套），这里不展开；`bins.length` 取 512 或 1024 都行，`bi = floor(k/64 * bins.length * 0.72)` 跟源码一致。

---

## 13. 几何图案专属效果（2195–2225）

这部分只在 `shapeMode && L === 0` 时跑，三层同形状不同相位、单层是几何模式的硬性约束（2129 行）就是为了让这些尖角效果不被盖住。

### 13.1 自动旋转 / 脉冲 / 单层

- **旋转**：`phase = L*1.7 + (shapeMode ? t*0.55 : 0)`（2162），几何模式每层额外 `t*0.55` 的自转；顶点角度也 `+ t*0.55`（2200）。`spinOn` 条件里含 `shapeMode`（2124），所以几何一定画那段 0.85 rad 的短弧。
- **脉冲**：`pulseOn` 含 `shapeMode`（2123），半径叠 `sin(t*2.8+phase)*0.22`，alpha 叠 `0.78+0.22*sin(t*3)`。
- **单层**：`if (shapeMode) layers = 1`（2129），注释写得很直白——「几何图案单层，避免多层互相盖住尖角」。

### 13.2 顶点呼吸发光（2196–2210）

`tips = CM_GEOM_TIPS[mode]`（五芒星 5、六芒星 6、三角阵 3、菱形 2、六边形 6、花瓣 8、齿轮 12、螺旋 0、星轨 0）。`tips=0` 时循环不执行，螺旋/星轨没有离散尖角就不画点。

```js
const ang = k/tips*TAU + t*0.55;
const rr  = cmShapeRadius(mode, ang, rad, t, t*0.55, 1);
const q   = project(r, c0+cos(ang)*rr, y+0.03, c2+sin(ang)*rr, W,H);
fillStyle = rainbowOn
  ? 'hsla('+round((hexToHue(hex)+k*60+t*70)%360)+',96%,74%,.95)'
  : withAlpha(hex,.95);
arc(q.x,q.y, 2.8 + 1.6*sin(t*3.2+k), 0, TAU);   // 半径呼吸
```

`y+0.03` 比环面再高 3cm，保证点画在环线上方不被 line 盖住。`shadowBlur = glow*1.2`（2198，比环描边的 `glow` 稍强）。Java 里 `tips` 直接读 `ShapeRadius.TIPS`，每个点一个实心 quad，颜色 `hsla(h0 + k*60 + t*70, .96, .74, .95)`，半径 `2.8 + 1.6*sin(t*3.2+k)`。

### 13.3 pentagram 内接跳点连线（2211–2224）

仅五芒星 / 六芒星补一圈内接虚线，角度按 `(k*2)/tips` 跳点（五芒星 k*2 就是经典的一笔画五角星）：

```js
for (let k = 0; k < tips; k++) {
  const ang = (k*2)/tips*TAU + t*0.55;
  const rr  = cmShapeRadius(mode, ang, rad*0.62, t, t*0.55, 1);   // 注意 rad*0.62
  inner.push([c0+cos(ang)*rr, y, c2+sin(ang)*rr]);
}
const ip = ringProject(r, inner, W, H, true);   // closed，同样要近平面裁剪
ctx.shadowBlur = 0;                              // 虚线不发光
ctx.strokeStyle = withAlpha(rainbowOn ? '#ffffff' : hex, 0.32);
ctx.lineWidth = 1;
strokeRingPath(ctx, ip); ctx.stroke();
```

`rad*0.62` 把内接星缩到 62%，`cmShapeRadius` 仍然用同一个 shape（所以是「缩小的同形状」而非简单圆）。`shadowBlur` 归零、`lineWidth=1`、alpha 0.32，跟主描边形成虚实对比。Java 里同样 `ringProject(vp, inner, W, H, true)` + ribbon（宽度 1），颜色 `argb(rainbow ? "#ffffff" : hex, 0.32f)`。

### 13.4 spin 短弧（2180–2193）

`spinOn` 时每段画一段 0.85 rad（≈48.7°）的亮弧，14 个采样点，起点 `(t*1.15 + L*1.9) % TAU`：

```java
if (flags.spin) {
    double start = (t * 1.15 + L * 1.9) % ShapeRadius.TAU;
    Vec3d[] arcXyz = new Vec3d[15];
    for (int i = 0; i <= 14; i++) {
        double ang = start + (double) i / 14 * 0.85;
        arcXyz[i] = new Vec3d(center.x + Math.cos(ang) * rad, y,
                              center.z + Math.sin(ang) * rad);
    }
    Pt[] arc = ProjectUtil.ringProject(vp, arcXyz, W, H, false);   // 不闭合！
    int col = ColorUtil.argb(flags.rainbow ? "#ffffff" : cfg.effectiveColor(), 0.95f);
    strokePolyline(vc, matrices, arc, fill(colors, col), (float) Math.max(2, cfg.ringWidth * 1.8));
    // shadowBlur = glow*1.4 → 进离屏发光层
}
```

`closed=false`（2187 行），别手滑传 true。`lineWidth = max(2, width*1.8)`（2189），辉光 `glow*1.4`（2190）。

---

## 14. 完整骨架：`AuraRingRenderer.java`

把前面所有零件装起来。事件注册按团队口径：`ClientModInitializer` + `HudRenderCallback` + `ClientTickEvents.END_CLIENT_TICK` + `ClientPlayConnectionEvents.JOIN` + `KeyBindingHelper`（一个切换光环开关的按键，对应网页 RShift 呼出 GUI 之外的模块开关习惯）。

```java
package dev.opus.fabric.aura;

import com.mojang.blaze3d.systems.RenderSystem;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.events.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.render.Camera;
import net.minecraft.client.util.InputUtil;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.util.math.Vec3d;
import org.joml.Matrix4f;
import org.lwjgl.glfw.GLFW;

/** 光环特效总入口。只做视觉，不接任何攻击 / 目标筛选逻辑。 */
public final class AuraRingRenderer implements ClientModInitializer {

    private static AuraConfig cfg;
    private static PerfTier perf;
    private static FxPipeline fx;
    private static MusicAnalyzer music;
    private static FallbackBeatAnalyzer fallback;

    private static double clockSec;          // 单调时钟，替代 performance.now()/1000
    private static Matrix4f cachedVp;        // 每帧缓存的 projection × view
    private static boolean inWorld;

    private static KeyBinding toggleKey;

    @Override
    public void onInitializeClient() {
        cfg      = AuraConfig.load();
        perf     = new PerfTier(cfg);
        fx       = new FxPipeline();
        fallback = new FallbackBeatAnalyzer(cfg.musicSens);
        music    = fallback;                 // 有 OpenAL 实现时换成它

        toggleKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.opus.auraToggle",
                InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_R,
                "category.opus.aura"));

        // 时间推进 + FPS 采样 + 按键切换
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            perf.tick();
            clockSec += 1.0 / 20.0;         // 一 tick = 50ms；也可按真实 delta 累加
            if (toggleKey.wasPressed()) {
                cfg.ringEnabled = !cfg.ringEnabled;
                cfg.save();
            }
        });

        // 缓存投影矩阵：AFTER_ENTITIES 阶段投影还是透视矩阵，HUD 阶段会被换成正交
        WorldRenderEvents.AFTER_ENTITIES.register(context -> {
            Camera cam = context.camera();
            Matrix4f proj = RenderSystem.getProjectionMatrix();
            cachedVp = ProjectUtil.buildViewProjection(cam, proj);
        });

        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> inWorld = true);
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> inWorld = false);

        // 主绘制：屏幕空间 2D 覆盖层，对应 ESP canvas
        HudRenderCallback.EVENT.register((DrawContext ctx, float tickDelta) -> {
            try {
                renderFrame(ctx, tickDelta);
            } catch (Throwable t) {
                // 光环画崩了不能拖垮 HUD，跟 playIntro 的 try/catch 一个原则
                // OpusLog.warn("aura render", t);
            }
        });
    }

    private static void renderFrame(DrawContext ctx, float tickDelta) {
        if (!inWorld || !cfg.ringEnabled || cachedVp == null) return;
        MinecraftClient mc = MinecraftClient.getInstance();
        PlayerEntity player = mc.player;
        Camera cam = mc.gameRenderer.getCamera();
        if (player == null || cam == null) return;

        int W = mc.getWindow().getFramebufferWidth();
        int H = mc.getWindow().getFramebufferHeight();

        // 玩家插值坐标，对应 playerCenter(p, alpha) → ipos(alpha)
        Vec3d center = player.getLerpedPos(tickDelta);
        double t = clockSec * cfg.ringSpeed;            // 2100 行 t = now/1000 * speed
        ModeFlags flags = new ModeFlags(cfg);
        int N = perf.sampleCount();                     // 2132

        // --- 音乐 / 伪律动（2106-2119） ---
        double beat = 0, hueShift = 0;
        float[] barData = null;
        if (flags.music) {
            Spectrum spec = music.sample();
            if (spec != null) {
                double sens = Math.max(0.2, cfg.musicSens);
                beat     = Math.min(1.4, spec.bass * sens);
                hueShift = spec.hi * 220;
                barData  = spec.bins;
            } else {
                beat     = fallback.beat(clockSec);
                hueShift = fallback.hueShift(clockSec);
            }
        }

        // --- 拖影 / 模糊参数（2135-2137） ---
        double blurBase = Math.max(0, cfg.fxBlur) * (1 + beat * 0.7);
        double trail    = Math.max(0, Math.min(0.95, cfg.fxTrail / 100.0));
        boolean glowOn  = perf.glow();

        // 把「这一帧的光环」抽成 lambda，FxPipeline 决定画到离屏还是主画面
        Runnable draw = () -> drawRing(ctx, cachedVp, center, W, H, t, N, flags, beat, hueShift, barData);
        fx.render(ctx, W, H, cfg, glowOn, blurBase, trail, draw);
    }

    private static void drawRing(DrawContext ctx, Matrix4f vp, Vec3d center,
                                 int W, int H, double t, int N, ModeFlags flags,
                                 double beat, double hueShift, float[] barData) {
        MatrixStack matrices = ctx.getMatrices();
        VertexConsumerProvider.Immediate immediate =
                MinecraftClient.getInstance().renderBuffers().getEntityVertexConsumers();
        VertexConsumer vc = immediate.getBuffer(AuraRenderLayers.AURA_SCREEN);
        String hex = cfg.effectiveColor();

        for (int L = 0; L < flags.layers; L++) {
            double phase  = L * 1.7 + (flags.geom ? t * 0.55 : 0);
            double rad    = cfg.range * (1 - L * 0.14) * (flags.music ? (1 + beat * 0.16) : 1);
            double wobble = 1 - L * 0.2;
            Vec3d[] world = AuraMath.makePoints(center, rad, phase, wobble, t, N, cfg.ringMode, flags);
            ProjectUtil.Pt[] pts = ProjectUtil.ringProject(vp, world, W, H, true);

            float a = (float) (Math.max(0.16, 0.92 - L * 0.17)
                    * (flags.pulse ? 0.78 + 0.22 * Math.sin(t * 3) : 1));
            float width = (float) Math.max(1, cfg.ringWidth * (1 - L * 0.18));

            // 描边：彩虹逐点配色 or 纯色
            int[] colors = flags.rainbow
                    ? ColorUtil.rainbowColors(pts, hex, t + L * 0.3 + hueShift / 360.0, a, W, H)
                    : ColorUtil.solidColors(pts.length, ColorUtil.argb(hex, a));
            AuraMath.strokePolyline(vc, matrices, pts, colors, width);

            // 第 0 层填充（2173-2178），不发光
            if (L == 0 && cfg.ringFill > 0) {
                float fillA = (float) Math.max(0, cfg.ringFill) / 100f;
                AuraMath.fillFan(vc, matrices, pts, ColorUtil.argb(hex, fillA), W, H);
            }

            // spin 短弧（2180-2193）
            if (flags.spin) drawSpinArc(vc, matrices, vp, center, rad, t, L, W, H, flags, hex);

            // 几何顶点发光 + 内接跳点（2195-2224）
            if (flags.geom && L == 0) drawGeomTips(vc, matrices, vp, center, rad, t, W, H, flags, hex);

            // 环绕粒子（2227-2240）
            if (flags.parts) drawParticles(vc, matrices, vp, center, rad, t, L, W, H, flags, hex);
        }

        // 环形频谱柱（2243-2259），只画一次，不在层循环里
        if (flags.music && barData != null && cfg.fxBars) {
            drawSpectrumBars(vc, matrices, vp, center, t, beat, hueShift, barData, W, H, flags);
        }
        immediate.draw();   // 提交了要 draw，否则啥都没有
    }

    // drawSpinArc / drawGeomTips / drawParticles / drawSpectrumBars / fillFan
    // 全部按第 12、13 节的公式填，签名已固定，这里省略重复样板。
    private static void drawSpinArc(VertexConsumer vc, MatrixStack m, Matrix4f vp,
                                    Vec3d c, double rad, double t, int L,
                                    int W, int H, ModeFlags f, String hex) { /* §13.4 */ }
    private static void drawGeomTips(VertexConsumer vc, MatrixStack m, Matrix4f vp,
                                     Vec3d c, double rad, double t,
                                     int W, int H, ModeFlags f, String hex) { /* §13.2/13.3 */ }
    private static void drawParticles(VertexConsumer vc, MatrixStack m, Matrix4f vp,
                                      Vec3d c, double rad, double t, int L,
                                      int W, int H, ModeFlags f, String hex) { /* §12.1 */ }
    private static void drawSpectrumBars(VertexConsumer vc, MatrixStack m, Matrix4f vp,
                                         Vec3d c, double t, double beat, double hueShift,
                                         float[] bins, int W, int H, ModeFlags f) { /* §12.2 */ }
}
```

骨架里几个容易踩的点，单独拎出来：

- `cachedVp` 必须**在 `AFTER_ENTITIES` 缓存值**。`HudRenderCallback` 触发时 MC 已经把投影矩阵换成正交（HUD 用），现取 `RenderSystem.getProjectionMatrix()` 会得到错的矩阵，光环会变成一坨不动的平面图形。
- `immediate.draw()` 别漏。`VertexConsumerProvider.Immediate` 是攒批的，不 draw 一帧全丢。
- 时钟我用 `1/20` 每 tick 累加，替代 `performance.now()/1000`。要更平滑可以按 `tickDelta` 补插值，但光环是慢速动效（周期几秒），20Hz 的时钟足够，别为了它引入帧间抖动。
- `try/catch(Throwable)` 包住整个 `renderFrame`：网页里 `drawAuraRing` 外层没包，但 ESP 帧函数本身有防护；Java 里一个 NPE 会让整帧 HUD 崩，包一层更稳，和 03 卷 `playIntro` 的「异常不影响启动」同一个原则。

### 14.1 可选的 3D 深度版（偏离源码，按需换）

如果想让光环被地形遮挡、更像「贴地的 3D 光环」，把主路径换成 `WorldRenderEvents.AFTER_ENTITIES` + `RenderLayer.getLines()`：

```java
WorldRenderEvents.AFTER_ENTITIES.register(context -> {
    MatrixStack ms = context.matrixStack();       // 已含相机变换
    Camera cam = context.camera();
    Vec3d camPos = cam.getPos();
    VertexConsumer vc = context.consumers().getBuffer(RenderLayer.getLines());
    // 顶点喂「世界绝对坐标 - camPos」以外的处理要按 ms 当前状态定；
    // 稳妥做法：仍传世界绝对坐标，让 MC 的 modelView 处理平移
    for (Vec3d q : worldRingPoints)
        vc.vertex(ms.peek().getPositionMatrix(), (float) q.x, (float) q.y, (float) q.z)
          .color(argb).normal(0, 1, 0);
    context.consumers().getBuffer(RenderLayer.getLines());   // 记得 drawCurrentLayer
});
```

但这条路径有三处和源码不一致：GL 自动裁剪线元（不再需要 `ringProject` 的近平面插值，但填充三角形仍可能在相机穿过环面时消失）、有深度遮挡、线宽被驱动 clamp 到 1。要粗线还是得展开 ribbon，而 ribbon 在世界空间展开就变成「宽度随距离透视缩放」，跟 Canvas 的固定屏幕像素宽度又不一样了。**结论**：忠实移植走屏幕空间主线；3D 版当美术增强，别混着用。

---

## 15. 「算法可 1:1 移植」 vs 「网页特有必须换实现」

这张表是交接时最该先看的，省得有人拿 Canvas API 去 Java 里找同名类。

| 项 | 判定 | 说明 |
| --- | --- | --- |
| `cmShapeRadius` 9 种几何半径、五芒星周期 `2π/n`、`poly = R·cos(π/n)/cos(u-π/n)`、花瓣/齿轮/螺旋/星轨 | **1:1** | 纯数学，Java 逐行照抄，只需把 JS 负模换成 `wrap()` |
| 17 模式 → 8 组 flags + layers 覆盖顺序 | **1:1** | `ModeFlags` 完整还原了 2104–2130 |
| `ringProject` 近平面裁剪（双向找可见邻居、近平面插值、取平均） | **1:1** | 换成 `Matrix4f` + `Vector4f.mul`，算法结构不变 |
| `ringGrad` 彩虹 8 段色标、`hexToHue` | **1:1（换载体）** | 数学照抄，载体从 `createLinearGradient` 换成顶点逐点配色 |
| `hexToHsl` / `hsla` 配色 | **1:1** | 输出 packed ARGB 而非 CSS 字符串 |
| 环绕粒子、频谱柱、顶点呼吸、pentagram 内接跳点、spin 短弧 | **1:1** | 角度、相位、半径、alpha 公式全部照抄 |
| `perfLevel` / `perfGlow` / `perfFx` 分级 | **1:1（换 FPS 源）** | 阈值 25/45、系数 0.4/0.7、采样点 `96*fx` 照抄，FPS 源换成自己的滑窗 |
| 13 个设置项的默认值 / 范围 / 步长 | **1:1** | `AuraConfig` 字段对齐 |
| `getS()` + `__sCache` | **可简化** | Java 字段访问不需要缓存层 |
| `ctx.stroke()` + `lineWidth` | **必须换** | 驱动 lineWidth clamp 到 1 → 展开屏幕对齐 ribbon quad |
| `ctx.shadowBlur` 辉光 | **必须换** | 离屏 `RenderTarget` + 两趟高斯 + 加法混合 |
| `fxCanvas` + `destination-out` 渐隐 | **必须换（概念对应）** | alpha 衰减 pass shader（`fragColor *= decay`）+ 常驻 framebuffer，语义等价但实现不同 |
| `ectx.filter = 'blur(px)'` | **必须换** | 并入同一套高斯 shader，`sigma ← fxBlur` |
| `createLinearGradient` / `ctx.fill()` | **必须换** | 三角扇填充 + 顶点色 |
| `Web Audio AnalyserNode.getByteFrequencyData` | **必须换** | OpenAL loopback + 自写 FFT / 音量包络 / 伪律动兜底；`Spectrum` 结构 1:1 |
| `requestAnimationFrame` / `performance.now()` | **必须换** | `ClientTickEvents.END_CLIENT_TICK` + 累加时钟 |
| ESP overlay canvas（DOM 层，无深度） | **必须换** | `HudRenderCallback` + `DrawContext`，或自定义关深度的 `RenderLayer` |
| `player.ipos(alpha)` 插值 | **换 API** | `PlayerEntity.getLerpedPos(tickDelta)`（或 `getCameraPosVec`），语义等价 |
| `v.vp` 列主序矩阵 | **换来源** | `Camera` + 投影矩阵自造 view-projection |
| `document.createElement('canvas')` → append DOM | **不移植** | Java 没有 DOM，全屏覆盖层用 Screen / HUD 层 |

---

## 16. 落地检查清单 / 已知的坑

按这个顺序自查，能省掉大半调试时间：

- [ ] `ringProject` 的 `EPS=0.08` 和 `project` 的 `0.1` 是两个阈值，别合并。粒子/频谱柱/顶点走 `project()`（可丢点），环折线走 `ringProject()`（必须闭合）。
- [ ] `closed` 参数：环折线 `true`、内接跳点 `true`、spin 短弧 `false`。传反了要么多一条闭合边，要么少一段。
- [ ] `strokeRingPath` 遇到 `null` 是**断笔**不是跳过一个点继续连——第 8 节 ribbon 里 `if (p==null||q==null) continue` 就是这个语义，别写成「连到下一个非 null 点」，那会跨屏拉长线（1998 行注释专门提醒过）。
- [ ] `cmShapeRadius` 的 `wobble` 是死参数，别在半径函数里用它；它只在 `makePts` 的波浪项里生效。
- [ ] `shapeSpin` 定义了没用到，别去找它的下游。
- [ ] 几何模式 `layers=1` 是硬约束，`双层`/`音乐律动` 的 `max(2,...)` 写在最后覆盖，顺序别调。
- [ ] `rainbowOn` 在「音乐律动」下无视用户设置强制开；「彩虹」「几何」在用户关掉 `ringRainbow` 时会灭。
- [ ] 填充只画第 0 层、不发光（`shadowBlur=0`）、alpha = `ringFill/100`。
- [ ] `Camera.getRotation()` 的四元数方向按实际 Yarn 版本校准一次，反了就 conjugate；`v.vp` 在网页里是游戏直接给的，没有这个歧义。
- [ ] 投影矩阵必须在透视阶段缓存，HUD 阶段现取会拿到正交矩阵。
- [ ] ribbon 在屏幕空间展开，宽度才是像素、才不随距离缩放。
- [ ] `fxCanvas` 的渐隐 pass 千万别 `clear()`，源码从头到尾没清过屏。
- [ ] `blurBase = fxBlur*(1+beat*0.7)`，`trail = clamp(fxTrail/100, 0, .95)`，合成 `globalAlpha=0.92`；模糊受 `perfGlow()` 门控，拖影不受。
- [ ] 频谱柱 `bi = floor(k/64 * bins.length * 0.72)`，只取前 72% bins；`beat` clamp 1.4。
- [ ] `musicSpectrum()` 返回 `null` 时走伪律动（2115–2118），别把 `null` 当空数组画一排零柱。
- [ ] 窗口缩放时 `FxPipeline.resize()` 重建三个 `RenderTarget`，别每帧 resize。
- [ ] 攻击逻辑（strength/players/targets/rotate/multiaura/triggerbot）一行都别接。`range` 只是半径，别注册任何 `AttackEntityCallback` 之类的东西。
- [ ] `immediate.draw()`、`cachedVp` 非空、`inWorld` 三个守卫缺一不可。

---

## 附：与 03 卷的共享件

`ShapeRadius.radius()`（9 种几何）、`ColorUtil.hsla()`、`cmEase` 那类缓动（03 卷）是两卷共用的图案语言——源码 2053–2054 的注释也写了「3D 脚下光环和 2D 开场动画都用这一套极坐标半径函数」。工程里把 `ShapeRadius` / `ColorUtil` 放到 `dev.opus.fabric.common` 包，两卷都 import，别各复制一份。开场动画的 7 种样式里，「五芒星/六芒星/花瓣/齿轮/三角阵/星轨」直接复用这里的几何函数，「极光」在 `cmShapeRadius` 里走 `default`（圆）——这个 03 卷会再讲。
