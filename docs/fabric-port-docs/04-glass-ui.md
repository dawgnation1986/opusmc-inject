# 卷四 · 毛玻璃 UI：从 CSS backdrop-filter 到两趟高斯模糊

## 这一卷对应什么

| JS 位置 | 函数 / 结构 | 干什么 |
| --- | --- | --- |
| 9051-9075 | `#__comet_gui` / `.cm-dim` / `#__comet_panel` | 根容器、遮罩、主面板基础样式 |
| 9077-9108 | `.cm-pane` / `.cm-side` / `.cm-header` / 搜索框 | 侧栏与控件的默认（深色）外观 |
| 9285-9347 | `#__comet_hudstage` / `.cm-hudbox` / `.cm-target` / `.cm-arr` / `.cm-note` | HUD 元素的默认外观与圆角 |
| 9373-9517 | `#__comet_gui.glass ...` | **液态玻璃主题全部规则**，本卷主料 |
| 9555-9631 | `.cm-float` / `#__comet_gui.glass .cm-float` | 悬浮分类面板，默认与玻璃两套 |
| 9633-9647 | `#__comet_minimap` / `.glass` | 圆形小地图的玻璃态 |
| 9869-9875 | `#__comet_mblur` / `--cm-mblur` | 全屏视角运动模糊层 |
| 9877-9933 | `:root` 8 变量 / `.fancy` / `.plain` / `.glass` | 外观四档位与 CSS 变量 |
| 10156-10254 | `mk()` / `gui` 骨架 / `applyTheme()` / `layoutPanel()` | ClickGUI DOM 结构与主题切换 |
| 10238-10254 | `applyTheme()` | default / glass 的 class 切换 |
| 1878-1942 | `APPEARANCE_PRESETS` / `APPEARANCE_KEYS` / `applyAppearance` / `applyAppearancePreset` | 8 参数预设与写 `:root` 变量 |
| 1893-1912 | `applyAppearance()` | 逐项设 CSS 变量、切 fancy/plain |
| 3659-3686 | `updateMotionBlur(p)` | 按 yaw/pitch 变化速率算模糊强度 |
| 11725-11736 | 250ms 合并刷新 | 通知/HUD 的低频数据更新 |

要实现的效果：把 Apple Liquid Glass 风格的半透明磨砂面板（高光边缘、背景模糊、饱和度提升、镜面反光）和「转视角时画面糊、停下淡出」的运动模糊，搬进 Minecraft 的 `DrawContext` / `Screen` 体系。Java 侧对应概念是——`backdrop-filter` 换成「截 framebuffer + 两趟可分离高斯模糊 + 合成」，CSS 变量换成 `Config` 字段，DOM 层级换成 `Screen.render` 里的绘制顺序。

统一口径：Minecraft Java 1.21.1 / Fabric Loader 0.16+ / Fabric API / Yarn mappings / Java 17。

---

## 1. 先把 CSS 逐条拆成参数表

网页版所有玻璃效果都集中在 `#__comet_gui.glass ...` 这一段（9373-9517），加上 `.cm-float`、小地图、`:root` 变量几处补充。移植前必须把每条规则翻译成「Java 里谁负责、参数是多少」，否则后面写 shader 时会对不上。

### 1.1 遮罩层 `.cm-dim`

```css
#__comet_gui.glass .cm-dim {
  background: radial-gradient(120% 120% at 50% 0%, rgba(10,10,14,.16), rgba(6,6,10,.44));
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}
```

| 参数 | 值 | Java 归属 |
| --- | --- | --- |
| 背景 | 径向渐变，中心 `(50%, 0%)`，从 `rgba(10,10,14,0.16)` 到 `rgba(6,6,10,0.44)` | `drawBackground` 里画一层全屏渐变矩形 |
| 模糊 | `blur(3px)` | 全屏低半径模糊，或直接复用主模糊纹理的廉价版本 |

默认主题（9056-9060）是 `rgba(0,0,0,0.49)` 纯色 + `opacity` 过渡；玻璃主题换成径向渐变 + 3px 糊。这个 3px 是「擦掉背景细节、让面板浮起来」用的，半径很小，Java 里可以并进主模糊的第一次降采样，不必单独跑一趟。

### 1.2 主面板 `#__comet_panel`

```css
#__comet_gui.glass #__comet_panel {
  background: linear-gradient(135deg,
    rgba(255,255,255,.26) 0%, rgba(255,255,255,.09) 36%,
    rgba(255,255,255,.15) 64%, rgba(255,255,255,.05) 100%);
  border: .5px solid rgba(255,255,255,.42);
  backdrop-filter: blur(30px) saturate(180%) brightness(1.05);
  -webkit-backdrop-filter: blur(30px) saturate(180%) brightness(1.05);
  box-shadow: 0 20px 60px rgba(0,0,0,.42), 0 2px 10px rgba(0,0,0,.22),
    inset 0 1px 0 rgba(255,255,255,.52), inset 0 -1px 0 rgba(255,255,255,.14);
}
```

| 参数 | 值 | Java 归属 |
| --- | --- | --- |
| 底色 | 135° 线性渐变，四段白透明度 `.26 / .09 / .15 / .05` | 合成 shader 之后叠一层 `fillGradient` |
| 边框 | `0.5px`，`rgba(255,255,255,0.42)` | `drawPanel` 描边，1 GUI px 近似 0.5 CSS px |
| 模糊半径 | `30px` | 高斯 σ 换算（见 6.3），radius 配置默认 18，玻璃主题下 `applyAppearance` 的 `--cm-blur` 覆盖 |
| 饱和度 | `180%` → 系数 1.8 | 合成 shader 的 `Saturation` uniform |
| 亮度 | `1.05` | 合成 shader 的 `Brightness` uniform |
| 外阴影 | `0 20px 60px rgba(0,0,0,.42)` + `0 2px 10px rgba(0,0,0,.22)` | 面板外侧画两层半透明黑色（放大矩形 + 羽化，或直接两层 `fill`） |
| 内高光 | `inset 0 1px 0 rgba(255,255,255,.52)` | 顶边 1px 亮线 |
| 内暗边 | `inset 0 -1px 0 rgba(255,255,255,.14)` | 底边 1px 弱亮线 |

注意 `border-radius` 不在这条规则里——`#__comet_panel` 基础样式（9066）是 `border-radius: 15px`，玻璃主题的 `:root` 变量又把 `--cm-radius: 14px` 灌进来（9884-9893），实际生效的是 `var(--cm-radius)`。`.cm-sheen` 的 `14.5px`（9390）是单独的，比面板大 0.5px，故意让高光边缘微微溢出。

### 1.3 镜面高光 `.cm-sheen`

```css
.cm-sheen { display: none; }                 /* 默认主题不显示 */
#__comet_gui.glass .cm-sheen {
  display: block; position: absolute; inset: 0; border-radius: 14.5px;
  pointer-events: none; z-index: 0;
  background:
    radial-gradient(90% 62% at 16% -10%, rgba(255,255,255,.34), transparent 62%),
    radial-gradient(72% 52% at 102% 110%, rgba(255,255,255,.16), transparent 60%),
    linear-gradient(200deg, rgba(255,255,255,.1) 0%, transparent 34%);
}
#__comet_gui.glass #__comet_panel > * { z-index: 1; }
#__comet_gui.glass .cm-pane {
  border-color: rgba(255,255,255,.32);
  background: linear-gradient(150deg, rgba(255,255,255,.18), rgba(255,255,255,.055));
  box-shadow: inset 0 .5px 0 rgba(255,255,255,.34), 0 3px 12px rgba(0,0,0,.14);
  backdrop-filter: blur(10px) saturate(150%);
}
```

| 参数 | 值 | Java 归属 |
| --- | --- | --- |
| 左上高光 | 径向 `90% 62% at 16% -10%`，`rgba(255,255,255,.34)` → 62% 处透明 | sheen 层第一道渐变 |
| 右下高光 | 径向 `72% 52% at 102% 110%`，`rgba(255,255,255,.16)` | sheen 第二道 |
| 斜向底光 | `linear-gradient(200deg, rgba(255,255,255,.1), transparent 34%)` | sheen 第三道 |
| 圆角 | `14.5px` | 比面板大 0.5 |
| 层级 | sheen 在 `z-index:0`，面板所有子元素 `z-index:1` | `drawPanel` 里 sheen 先画、控件后画 |
| 子 pane 模糊 | `blur(10px) saturate(150%)` | 复用主模糊纹理，但只取面板内区域 |

`.cm-sheen` 在 `.fancy` 档还会被 CMS sweep 动画（9914-9919）叠一道 `linear-gradient(105deg, ...)` 横扫，Java 里用 `tickDelta` 算相位平移那道高光即可，不用单独 shader。

### 1.4 文字、控件、列表

```css
#__comet_gui.glass .cm-hlabel { color: rgba(255,255,255,.72); text-shadow: 0 1px 2px rgba(0,0,0,.35); }
#__comet_gui.glass .cm-cat   { color: rgba(255,255,255,.62); }
#__comet_gui.glass .cm-cat:hover, ... .sel { color: #fff; }
#__comet_gui.glass .cm-sec   { color: rgba(255,255,255,.5); }
#__comet_gui.glass .cm-sec::before/::after { background: rgba(255,255,255,.25); }
#__comet_gui.glass .cm-row   { background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.1);
                               color: rgba(255,255,255,.72); box-shadow: inset 0 .5px 0 rgba(255,255,255,.22); }
#__comet_gui.glass .cm-row:hover  { background: rgba(255,255,255,.2); }
#__comet_gui.glass .cm-row.sel    { background: rgba(255,255,255,.24); border-color: rgba(255,255,255,.46); animation:none; }
#__comet_gui.glass .cm-row.on     { color: #fff; }
#__comet_gui.glass .cm-switch.on  { border-color: rgba(255,255,255,.72); }
#__comet_gui.glass .cm-switch.on i{ background:#fff; }
#__comet_gui.glass .cm-track      { background: rgba(255,255,255,.18); }
#__comet_gui.glass .cm-track .cm-fill { background: rgba(255,255,255,.85); }
#__comet_gui.glass .cm-value      { color: rgba(255,255,255,.62); }
#__comet_gui.glass .cm-value b    { color:#fff; }
```

| 元素 | 默认（深色） | 玻璃 | Java |
| --- | --- | --- | --- |
| 标题 `.cm-hlabel` | `rgba(128,128,128,.5)` | `rgba(255,255,255,.72)` + `text-shadow` | `drawText` 颜色 + 一层 1px 偏移暗色描边 |
| 分类 `.cm-cat` | `rgba(128,128,128,.5)` | `rgba(255,255,255,.62)`，选中 `#fff` | 文本颜色 |
| 分组线 `.cm-sec` | `rgba(150,150,150,.39)` | `rgba(255,255,255,.5)` | 文本 |
| 模块行 `.cm-row` | `rgba(64,64,64,.098)` | `rgba(255,255,255,.1)`，hover `.2`，sel `.24` | `fill` 矩形 |
| 开关/滑块 | 灰 | 白系 | 控件自绘 |
| 输入框 `.cm-searchbox/.cm-text/.cm-select/.cm-soon` | `rgba(255,255,255,.03)` | `rgba(255,255,255,.1)`，边框 `rgba(255,255,255,.34)`，`inset 0 .5px 0 rgba(255,255,255,.32)` | 矩形 + 顶边亮线 |

### 1.5 下拉菜单与搜索结果

```css
#__comet_gui.glass .cm-options {
  background: rgba(24,24,30,.55);
  border-color: rgba(255,255,255,.34);
  backdrop-filter: blur(20px) saturate(170%);
  box-shadow: 0 8px 24px rgba(0,0,0,.42), inset 0 .5px 0 rgba(255,255,255,.28);
}
#__comet_gui.glass .cm-results {
  border-color: rgba(255,255,255,.34);
  background: rgba(18,18,24,.5);
  backdrop-filter: blur(24px) saturate(170%);
  box-shadow: inset 0 .5px 0 rgba(255,255,255,.26);
}
#__comet_gui.glass .cm-btn { border-color: rgba(255,255,255,.34); background: rgba(255,255,255,.12); color:#fff; }
```

这两层是「浮在面板之上、还要再糊一次背景」的下拉层。CSS 里它们各自有独立的 `backdrop-filter`，Java 里别真给每个下拉框都跑一遍模糊——复用主模糊纹理，只是采样区域换成下拉框矩形，底色再叠一点暗色即可。半径 20/24px 的差异在 1/2 降采样后几乎看不出，统一用主 radius 足够。

### 1.6 HUD 元素的玻璃态

```css
#__comet_hudstage.glass .cm-hudbox,
#__comet_hudstage.glass .cm-hudicon,
#__comet_hudstage.glass .cm-arr,
#__comet_hudstage.glass .cm-note,
#__comet_hudstage.glass .cm-target {
  border-color: rgba(255,255,255,.34);
  background: linear-gradient(135deg, rgba(255,255,255,.22), rgba(255,255,255,.07));
  backdrop-filter: blur(18px) saturate(175%);
  -webkit-backdrop-filter: blur(18px) saturate(175%);
  box-shadow: inset 0 .5px 0 rgba(255,255,255,.45), 0 4px 16px rgba(0,0,0,.28);
}
#__comet_hudstage.glass .cm-hudbox, ... .cm-target { color:#fff; }
#__comet_hudstage.glass .cm-hudbox .cm-hlbl, ... .cm-hsep { color: rgba(255,255,255,.68); }
```

HUD 玻璃和面板玻璃是两套独立模糊：HUD 元素散布在屏幕各处、彼此不相邻，每个都要对自己背后那块区域做 `blur(18px)`。这是性能最凶的一块——网页里浏览器合成器能批量处理，Java 里如果给每个 HUD 小框各跑一趟模糊，帧率直接崩。6.6 节会给降级方案。

### 1.7 悬浮面板与小地图

```css
#__comet_gui.glass .cm-float {
  border-color: rgba(255,255,255,.34);
  background: linear-gradient(150deg, rgba(255,255,255,.22), rgba(255,255,255,.07));
  backdrop-filter: blur(18px) saturate(175%);
  box-shadow: inset 0 .5px 0 rgba(255,255,255,.45), 0 8px 26px rgba(0,0,0,.28);
  color:#fff;
}
#__comet_minimap.glass {
  border-color: rgba(255,255,255,.5);
  background: rgba(255,255,255,.1);
  backdrop-filter: blur(10px) saturate(160%);
  box-shadow: inset 0 .5px 0 rgba(255,255,255,.5), 0 8px 26px rgba(0,0,0,.3);
}
```

`.cm-float` 默认态（9555-9562）是 `rgba(38,38,38,.96) → rgba(12,12,12,.97)` 的近黑渐变 + `0 8px 26px rgba(0,0,0,.55)` 阴影；玻璃态整套换成白系半透明 + 内高光。圆角 `9px`（9557）。小地图是 `border-radius:50%` 的圆形，玻璃态半径 10px、饱和 160%——圆形裁剪在 Java 里用 `glEnable(GL_SCISSOR_TEST)` 做不出圆，得用 shader 里的 `discard` 或画圆形贴图，见 6.7。

### 1.8 `:root` 变量与四档位

```css
:root {
  --cm-accent:#b06bff; --cm-accent-rgb:176,107,255;
  --cm-glow:14; --cm-blur:18px; --cm-radius:14px;
  --cm-anim:1.3; --cm-sat:1.5; --cm-bg:#10121c; --cm-border:.75;
}
#__comet_gui .cm-float, #__comet_gui #__comet_panel {
  border-radius: var(--cm-radius);
  border-color: rgba(var(--cm-accent-rgb), var(--cm-border));
  background: linear-gradient(140deg, rgba(var(--cm-accent-rgb),.12) 0%, var(--cm-bg) 46%, rgba(0,0,0,.42) 100%);
  box-shadow: 0 0 calc(var(--cm-glow)*1px) rgba(var(--cm-accent-rgb),.42), inset 0 .5px 0 rgba(255,255,255,.25);
  filter: saturate(var(--cm-sat));
}
#__comet_gui.fancy .cm-float, ... #__comet_panel { animation: cm-breathe calc(4s/var(--cm-anim)) ...; }
#__comet_gui.plain .cm-float, ... #__comet_panel {
  animation:none!important; filter:none!important; box-shadow:none!important;
  border-radius:4px; background: var(--cm-bg)!important;
}
#__comet_gui.glass .cm-float, #__comet_gui.glass #__comet_panel {
  backdrop-filter: blur(var(--cm-blur)) saturate(var(--cm-sat));
}
```

这里能看出三套机制是叠着生效的：`fancy/plain` 是**动画与滤镜强度**，`glass/default` 是**是否磨砂**，`--cm-*` 变量是**具体数值**。`.plain` 里 `filter:none` 把饱和度滤镜干掉、圆角强制 4px、阴影全去，但 `backdrop-filter` 那条 `.glass` 规则仍在——所以「玻璃 + 基本档」= 有模糊但无高光无动画。Java 里对应：档位只影响合成 shader 的参数和是否画 sheen/呼吸动画，`Theme` 决定是否跑模糊。

---

## 2. APPEARANCE_PRESETS 的 8 个参数 → Java 字段

`APPEARANCE_KEYS = ['accent','glow','blur','radius','anim','saturate','bg','border']`（1883），三组预设（1878-1882）：

| 参数 | 类型 | 绚丽 | 平缓 | 基本 | 控件定义（511-520） | Java 字段 / 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| `accent` | color | `#b06bff` | `#6f9bd1` | `#8a8f99` | color，默认空=彗星紫 | `int accentArgb`，面板底色渐变、边框、按钮、开关、滑块填充、选中行 |
| `glow` | slider 0-24 step1 | 14 | 5 | 0 | glow | `float glowPx`，外发光半径 = `glow*1px`（9890 的 `calc()`） |
| `blur` | slider 0-30 step1 | 18 | 8 | 0 | blur | `float blurPx`，**高斯 sigma 的输入**，见 6.3 |
| `radius` | slider 0-22 step1 | 14 | 9 | 4 | radius | `float radiusPx`，面板/浮窗圆角；basic 强制 4 |
| `anim` | slider 0-2 step0.1 | 1.3 | 0.6 | 0 | anim | `float animSpeed`，呼吸/横扫/色相动画的周期除数 |
| `saturate` | slider 0.5-2 step0.1 | 1.5 | 1.05 | 0.8 | saturate | `float saturation`，合成 shader uniform + `filter:saturate()` |
| `bg` | color | `#10121c` | `#141821` | `#0d1016` | bg，默认空=深色 | `int bgArgb`，面板渐变中点色、plain 档整块底色 |
| `border` | slider 0-1 step0.05 | 0.75 | 0.45 | 0.25 | border | `float borderAlpha`，边框 `rgba(accentRgb, border)` |

`applyAppearance()`（1893-1912）的回落逻辑值得单独拎出来：

```js
const p = APPEARANCE_PRESETS[preset] || APPEARANCE_PRESETS['绚丽'];
const val = (k) => { const v = gs2(k); return v == null || v === '' ? p[k] : v; };
```

也就是**用户存过的值优先，空值才落回当前档位预设**。`applyAppearancePreset()`（1933-1942）切档时会先把 8 个 key 全写进 `cfg.settings['appearance.xxx']`，再 `__sCache=null; saveCfg(); applyAppearance(); refreshGui()`。`saveAppearanceSnapshot()` / `restoreAppearance()`（1913-1932）是「自定义」档的记忆：切到别的档前存快照，切回来时把快照写回 `settings`。

Java 侧把这些塞进卷一已有的 `CometConfig.Appearance`，再补一个 `GlassParams` 值对象给渲染器用：

```java
package com.bigpixel.comet.render.glass;

import com.bigpixel.comet.config.AppearancePreset;
import com.bigpixel.comet.config.ConfigManager;
import com.bigpixel.comet.config.Theme;
import com.google.gson.JsonElement;

/** 把 8 个 CSS 变量在每帧开头解析成一个不可变快照，渲染器只读它。 */
public record GlassParams(
        int accentArgb,
        float glowPx,
        float blurPx,
        float radiusPx,
        float animSpeed,
        float saturation,
        int bgArgb,
        float borderAlpha,
        boolean glass,
        boolean fancy,
        boolean plain
) {
    public static GlassParams current() {
        String preset = ConfigManager.getS("appearance", "preset", "绚丽");
        AppearancePreset.Appearance p = AppearancePreset.PRESETS
                .getOrDefault(preset, AppearancePreset.PRESETS.get("绚丽"));

        int accent = color("accent", p.accent());
        int bg     = color("bg", p.bg());

        return new GlassParams(
                accent,
                num("glow", p.glow()),
                num("blur", p.blur()),
                num("radius", p.radius()),
                Math.max(0.1f, num("anim", p.anim())),   // 对应 1905 的 Math.max(0.1, ...)
                num("saturate", p.saturate()),
                bg,
                num("border", p.border()),
                Theme.current() == Theme.GLASS,
                "绚丽".equals(preset),
                "基本".equals(preset)
        );
    }

    private static float num(String k, float def) {
        Object v = ConfigManager.getS("appearance", k, null);
        return v instanceof Number n ? n.floatValue() : def;
    }

    private static int color(String k, int def) {
        Object v = ConfigManager.getS("appearance", k, null);
        if (!(v instanceof String s) || s.isBlank()) return def | 0xFF000000;
        try { return (int) Long.parseLong(s.replace("#",""), 16) | 0xFF000000; }
        catch (NumberFormatException e) { return def | 0xFF000000; }
    }

    /** 基本档强制圆角 4、无阴影、无滤镜，对应 9922-9927 的 .plain 覆盖。 */
    public float effectiveRadius() { return plain ? 4f : radiusPx; }
    public boolean sheenVisible()  { return glass && !plain; }
    public boolean breathe()       { return fancy && !plain; }
    public float effectiveSaturation() { return plain ? 1.0f : saturation; }

    /** CSS blur(Npx) → 高斯 sigma 的经验换算，见 6.3。 */
    public float sigma() { return Math.max(0.01f, blurPx * 0.5f); }
}
```

`--cm-accent-rgb` 那套「把 hex 拆成 `176,107,255` 再拼 `rgba(...)`」（1885-1891 `accentRgb()`）在 Java 里不需要——ARGB 本来就是分量，画的时候 `ColorHelper.Argb` 或自己拆 `(argb>>16)&255` 即可。`accentRgb()` 这个字符串拼接函数属于纯网页 hack，删掉。

---

## 3. default 与 glass 的视觉差异与切换逻辑

`applyTheme()`（10238-10254）做的事很轻：读 `cfg.theme`，给 `gui` 切 `glass` class，顺手给 `hudStage / miniCanvas / invBox / bigmap / dropBox / blockPick / musicBox` 也切一遍 `glass`，再把主题按钮的 `on` 状态对齐。它**不碰** `fancy/plain`——那两个是 `applyAppearance()` 按 preset 切的（1909-1910）。两套正交。

| 维度 | default（深色） | glass（液态玻璃） |
| --- | --- | --- |
| 主面板底 | `linear-gradient(135deg, #1a1a1a, #000 42%, #1a1a1a 70%, #000)`（9068） | 白色四段半透明渐变 + 模糊纹理合成 |
| 遮罩 | `rgba(0,0,0,.49)` 纯色 | 径向渐变 + `blur(3px)` |
| 边框 | `.5px solid rgba(55,55,55,.84)` | `.5px solid rgba(255,255,255,.42)` |
| 阴影 | `0 12px 40px rgba(0,0,0,.45)` | 两层外阴影 + 两条 inset 高光 |
| 高光层 | `.cm-sheen { display:none }` | 三层渐变 sheen + fancy 档横扫 |
| 子 pane | `rgba(128,128,128,.098)` | `blur(10px) saturate(150%)` + 白系渐变 |
| 文字 | 灰阶 `rgba(128,128,128,.5~.7)` | 白系 `rgba(255,255,255,.62~.9)` + text-shadow |
| HUD 框 | 深灰渐变 + `#5a5a5a` 边 | `blur(18px) saturate(175%)` + 白边 |
| 悬浮面板 | 近黑 `.96` 渐变 | 白系半透明 + `blur(18px)` |

切换的 Java 版：没有 class 要切，渲染器每帧读 `Theme.current()` 决定「跑不跑模糊、用哪套色板」，`Theme.set()` 只改配置 + 失效缓存 + 落盘。这也意味着切换是**即时**的，不像网页要 `classList.toggle` 触发 CSS 重算——少了一层，但也少了 CSS transition 的免费补间。网页里 `opacity / transform` 的 `.25s` 过渡（9058、9070）Java 里得自己用 `tickDelta` 插值 `panelAlpha`，`ClickGuiScreen` 里存一个 `openProgress` 即可。

```java
public static void set(com.bigpixel.comet.config.Theme t, net.minecraft.client.MinecraftClient mc) {
    com.bigpixel.comet.config.Theme.set(t);   // 卷一里的枚举方法：改 cfg.theme + 落盘
    // 没有 DOM class 要切；下一帧 HudRenderer / ClickGuiScreen 读 Theme.current() 自动生效
}
```

一个坑：网页里 `miniCanvas / invBox / bigmap / dropBox / blockPick / musicBox` 都是独立 DOM，各自带 `.glass` class，`applyTheme` 要逐个 toggle；Java 里这些是 `HudRenderer` 里一串 draw 调用，共用一个 `GlassParams`，**不要**给每个控件各存一份主题状态。

---

## 4. 层次结构与圆角规则

把 10164-10216 的 DOM 树和 CSS 圆角整理成一张表，Java 侧 `ClickGuiScreen.render` 就按这个顺序画：

```
#__comet_gui                         (fixed inset:0, z 2147483647)
├── .cm-dim                         全屏遮罩
├── #__comet_stage                  (50vw×50vh, scale 2 —— Java 不复刻)
│   └── #__comet_panel              400×250, radius var(--cm-radius)=14
│       ├── .cm-sheen               inset:0, radius 14.5, z0
│       ├── .cm-side  (.cm-pane)    left7.5 top7.5 80×235, radius 10
│       ├── .cm-header(.cm-pane)    left92 top7.5 300×25, radius 8
│       ├── .cm-mods  (.cm-pane)    left92 top38 120×204, radius 6
│       ├── .cm-sets  (.cm-pane)    left218 top38 172×204, radius 7
│       ├── .cm-soon                left12.5 top220.5 70×17, radius 5
│       ├── .cm-theme               left12.5 top198 70×17, radius 5（内 .cm-topt radius 3.5）
│       ├── .cm-results             下拉，radius 由 --cm-radius 兜底
│       ├── .cm-hlabel              left100 top16
│       └── .cm-searchbox           left315 top12.5 70×15, radius 4（内 input）
├── #__comet_float                  z 2147483646
│   └── .cm-float ×N                176 宽, radius 9（.cm-fhead 27 高, .cm-fbody max 46vh/300）
└── .cm-fver                       左下角版本文字
```

| 元素 | 圆角 | 说明 |
| --- | --- | --- |
| `#__comet_panel` / `.cm-float` | `var(--cm-radius)`，绚丽 14 / 平缓 9 / 基本 4 | 9884-9887 覆盖基础 15/9 |
| `.cm-sheen` | 14.5 | 比面板大 0.5，故意溢出 |
| `.cm-side` | 10 | 侧栏 |
| `.cm-header` | 8 | 顶栏 |
| `.cm-mods` | 6 / `.cm-sets` 7 | 两栏微差 |
| `.cm-row` | 5（基础 9145）/ `.cm-float .cm-row` 4 | 列表行 |
| `.cm-theme` / `.cm-topt` | 5 / 3.5 | 主题切换胶囊 |
| `.cm-searchbox` | 4 | 搜索胶囊 |
| `.cm-hudbox` / `.cm-hudicon` | 5 | HUD 胶囊 |
| `.cm-target` | 6（内 `.cm-tface` 4、血条 2） | 目标面板 |
| `.cm-arr` | 4 | ArrayList 条目 |
| `.cm-note` | 5 | 通知 |
| `.cm-tbar/.cm-tfill/.cm-track/.cm-knob` | 2 / 3 | 细条与滑块 |
| `#__comet_minimap` | 50%（圆） | 特殊 |
| `.cm-switch` / `.cm-rmswitch` | 9 / 9 | 拨动开关胶囊 |

「胶囊」这个词在源码里对应的是 `.cm-hudbox`（`height:20px; border-radius:5px`）、`.cm-arr`、`cm-theme` 这一族矮条：高度固定、圆角约为高度的一半、左右 padding 7px。Java 里统一抽一个 `fillRoundedRect(dc, x,y,w,h, r, argb)` helper，`drawHudCapsule()` 走它；不要每个 draw 方法里各写一遍圆角计算。

圆角在 `DrawContext` 里没有原生 API。三条路：

1. **九宫格贴图**：预生成一张带圆角的 1×1 白色 mask 纹理（半径可配置的几张），`drawTexture` 拉伸，最简单，但圆角半径变化时贴图要重建。
2. **shader 里 `discard`**：合成 shader 传面板局部坐标，用 SDF 圆角矩形算 alpha，圆角随 `radiusPx` 参数实时变，最贴合 `--cm-radius` 可拖动的需求。
3. **CPU 拆矩形**：用 4 个角 + 3 个条带填充，纯 `fill`，零依赖，但圆角是阶梯近似。

推荐 2——卷 6 的合成 shader 里顺手做，反正模糊纹理已经要过一遍 fragment。`fillRoundedRect` 的纯 Java 兜底（方案 3）也给一份，省电档关 shader 时用：

```java
/** 无 shader 时的圆角矩形兜底：中心三条 + 四个角的阶梯近似。 */
public static void fillRounded(DrawContext dc, int x, int y, int w, int h, float r, int argb) {
    int ri = (int) Math.ceil(r);
    if (ri <= 0) { dc.fill(x, y, x + w, y + h, argb); return; }
    dc.fill(x + ri, y, x + w - ri, y + h, argb);          // 中央竖条
    dc.fill(x, y + ri, x + ri, y + h - ri, argb);          // 左
    dc.fill(x + w - ri, y + ri, x + w, y + h - ri, argb);  // 右
    for (int dy = 0; dy < ri; dy++) {
        float t = 1f - (dy + 0.5f) / ri;
        int half = (int) (ri - Math.sqrt(Math.max(0, ri * ri - (ri - dy - 0.5f) * (ri - dy - 0.5f))));
        int inset = ri - half;
        dc.fill(x + inset, y + dy, x + w - inset, y + dy + 1, argb);
        dc.fill(x + inset, y + h - dy - 1, x + w - inset, y + h - dy, argb);
    }
}
```

---

## 5. 视角运动模糊：从 `--cm-mblur` 到全屏后处理

`updateMotionBlur(p)`（3659-3686）是网页里最巧的一段。它不糊 UI（`#__comet_mblur` 的 z-index 2147482990 低于 HUD 的 2147483646 和 ESP 的 2147483646），只糊游戏画面：

```js
function updateMotionBlur(p) {
  if (!on) { mbSmooth = 0; mblurEl.style.setProperty('--cm-mblur','0px'); return; }
  const yaw = num(p,'yaw'), pitch = num(p,'pitch')||0;
  let d = 0;
  if (yaw != null && mbLastYaw != null) {
    let dy = yaw - mbLastYaw;
    while (dy > Math.PI) dy -= Math.PI*2;      // 跨 ±π 归一化
    while (dy < -Math.PI) dy += Math.PI*2;
    d = Math.hypot(dy, pitch - (mbLastPitch||0));
  }
  mbLastYaw = yaw; mbLastPitch = pitch;
  const strength = Math.max(0, Number(getS('mblur','strength'))||5);
  const decay = Math.max(0.03, Math.min(0.6, Number(getS('mblur','decay'))||0.1));
  const target = Math.min(strength, d*strength*22);
  mbSmooth += (target - mbSmooth) * (target > mbSmooth ? 0.55 : decay);  // 起快落慢
  mblurEl.style.setProperty('--cm-mblur', mbSmooth.toFixed(2)+'px');
}
```

CSS（9869-9875）：

```css
#__comet_mblur {
  position:fixed; inset:0; z-index:2147482990; pointer-events:none;
  backdrop-filter: blur(var(--cm-mblur, 0px));
}
#__comet_mblur.off { backdrop-filter:none; }
.cm-map-open #__comet_mblur { display:none!important; }   /* 大地图打开时关掉 */
```

对应的 `mblur` 模块设置（657-663）：`strength` 0-8 默认 5、`decay` 0.05-0.4 默认 0.1。

**算法可以 1:1 搬**：`d` 的算法、跨 ±π 归一化、起快落慢的非对称平滑（上升 0.55、下降 `decay`）、`target` 的 `d*strength*22` 系数，全都不用改。Java 版放在 `MotionBlurRenderer`，每帧更新 `currentRadius`：

```java
package com.bigpixel.comet.render.glass;

import com.bigpixel.comet.config.ConfigManager;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.Camera;

public final class MotionBlurRenderer {
    private MotionBlurRenderer() {}

    private static double lastYaw = Double.NaN, lastPitch = 0;
    private static double smooth = 0;

    /** 对应 updateMotionBlur()，在 END_CLIENT_TICK 里调用，只算强度不渲染。 */
    public static void tick(MinecraftClient mc) {
        if (mc.player == null || !ConfigManager.modOn("mblur", false)) {
            smooth = 0; lastYaw = Double.NaN; return;
        }
        // JS 的 p.yaw 是弧度（156 行注释：OpusMC yaw 弧度）；Java Camera#getYaw 是度数，
        // 这里统一转弧度，保持 d*strength*22 的量纲不变。
        double yaw = Math.toRadians(mc.player.getYaw());
        double pitch = Math.toRadians(mc.player.getPitch());

        double d = 0;
        if (!Double.isNaN(lastYaw)) {
            double dy = yaw - lastYaw;
            while (dy > Math.PI) dy -= Math.PI * 2;
            while (dy < -Math.PI) dy += Math.PI * 2;
            d = Math.hypot(dy, pitch - lastPitch);
        }
        lastYaw = yaw; lastPitch = pitch;

        float strength = ConfigManager.getS("mblur", "strength", 5f);
        float decay = Math.max(0.03f, Math.min(0.6f,
                ConfigManager.getS("mblur", "decay", 0.1f)));
        float target = Math.min(strength, (float) (d * strength * 22));
        smooth += (target - smooth) * (target > smooth ? 0.55 : decay);
    }

    public static float currentRadius() { return (float) smooth; }
    public static boolean active() { return smooth > 0.05f; }
}
```

渲染合成放在 `WorldRenderEvents.END_MAIN`——这时主场景已经进 `mc.getFramebuffer()`，正好是「只糊游戏画面、不糊 HUD」的时机（HUD 是之后 `HudRenderCallback` 才画的）：

```java
public static void compositeIfNeeded(WorldRenderContext ctx) {
    if (!active()) return;
    MinecraftClient mc = MinecraftClient.getInstance();
    float radius = currentRadius();
    // 大地图打开时关掉，对应 .cm-map-open #__comet_mblur { display:none }
    if (BigMapScreen.isOpen()) return;
    GlassBlurRenderer.blurFullScreen(mc, radius, /* saturation */ 1.0f, /* brightness */ 1.0f);
}
```

网页里这层靠 `backdrop-filter` 自动只糊「它背后的像素」；Java 里 `END_MAIN` 的时机正好复刻了这一点，因为 HUD 还没画。这是整个移植里时机对得最整齐的一处。

---

## 6. 重点：完整的 Java 实现路径

### 6.1 为什么必须自己写两趟模糊

先把结论说死：**CSS `backdrop-filter` 在 Minecraft / Java 侧没有等价物**。浏览器合成器在合成阶段能对「元素背后已绘制的 framebuffer」实时做模糊，是浏览器渲染管线白送的能力；Minecraft 的 `DrawContext` 只有「往当前 framebuffer 里画矩形/贴图」，没有「读取背后像素再模糊」这回事。`RenderSystem` 也不提供 `blurRegion()`。

所以只能自己走完整链路：

```
① 场景已经在 mc.getFramebuffer() 里
② 绑定它的 colorAttachment 作为输入纹理
③ 第一趟：水平方向高斯 → ping framebuffer
④ 第二趟：垂直方向高斯 → pong framebuffer   （可分离：2×N 次采样代替 N² 次）
⑤ 合成：把 pong 按面板矩形贴回屏幕，同时做 saturate / brightness / tint / 圆角 SDF / sheen
⑥ DrawContext 画文字、控件（在模糊之上）
```

「两趟」指的是同一个高斯核跑两次（H 和 V），不是两套 shader。可分离高斯是这里的关键：半径 R 的直接二维卷积要 `(2R+1)²` 次采样，拆成 H+V 只要 `2×(2R+1)` 次。CSS 的 `blur(30px)` 内核本来就是可分离的，我们只是把它显式写出来。

### 6.2 着色器注册

1.21.1 用 `CoreShaderRegistrationCallback` 提前注册（Fabric 会在第一次渲染前触发），`ShaderProgram` 是 Yarn 名（老版本映射叫 `JsonGlProgram`，Mojang 名 `ShaderInstance`），JSON 沿用 vanilla 的 `shaders/core/*.json` 格式：

```java
package com.bigpixel.comet.render.shader;

import com.bigpixel.comet.CometClient;
import com.mojang.blaze3d.vertex.VertexFormats;
import net.fabricmc.fabric.api.client.rendering.v1.CoreShaderRegistrationCallback;
import net.minecraft.client.gl.ShaderProgram;
import net.minecraft.util.Identifier;

public final class ShaderRegistry {
    private ShaderRegistry() {}

    public static final Identifier BLUR = Identifier.of(CometClient.MOD_ID, "blur");
    public static final Identifier COMPOSITE = Identifier.of(CometClient.MOD_ID, "composite");

    private static ShaderProgram blurProgram;
    private static ShaderProgram compositeProgram;

    public static void register() {
        CoreShaderRegistrationCallback.EVENT.register(ctx -> {
            // 1.21.1 Fabric API：register(id, vertexFormat, 配置回调)
            // 回调里可以缓存 ShaderProgram 引用并绑定 sampler / 自定义 uniform 初值
            ctx.register(BLUR, VertexFormats.POSITION, program -> {
                blurProgram = program;
            });
            ctx.register(COMPOSITE, VertexFormats.POSITION, program -> {
                compositeProgram = program;
            });
        });
    }

    public static ShaderProgram blur() { return blurProgram; }
    public static ShaderProgram composite() { return compositeProgram; }
}
```

> 版本提示：如果锁定的 Fabric API 里 `CoreShaderRegistrationCallback.RegistrationContext#register` 签名是 `(Identifier, VertexFormat, Consumer<ShaderProgram>)` 就照上面写；更老的版本要走 `JsonGlProgram` + `GameRenderer#loadPrograms` 的 Mixin，或者干脆用 `RenderLayer` + `ShaderLoader`。卷一锁的是 `0.104.0+1.21.1`，用上面的写法。

`assets/comet-client/shaders/core/blur.json`：

```json
{
  "blend": {
    "func": "add",
    "srcrgb": "one",
    "dstrgb": "zero",
    "srcalpha": "one",
    "dstalpha": "zero"
  },
  "vertex": "comet-client:blur",
  "fragment": "comet-client:blur",
  "attributes": [ "Position" ],
  "samplers": [ { "name": "DiffuseSampler" } ],
  "uniforms": [
    { "name": "ProjMat",  "type": "matrix4x4", "count": 16,
      "values": [ 1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1 ] },
    { "name": "InSize",   "type": "float", "count": 2, "values": [ 1, 1 ] },
    { "name": "OutSize",  "type": "float", "count": 2, "values": [ 1, 1 ] },
    { "name": "Direction","type": "float", "count": 2, "values": [ 1, 0 ] },
    { "name": "Radius",   "type": "float", "count": 1, "values": [ 1 ] }
  ]
}
```

`InSize` / `OutSize` / `ProjMat` 由 `ShaderProgram` 在绑定时按当前 framebuffer 自动填（vanilla 的 `blur.json` 也是这么用的）；`Direction` / `Radius` 是自定义的，每趟手动 `GlUniform#set`。

`assets/comet-client/shaders/core/composite.json`：

```json
{
  "blend": {
    "func": "add",
    "srcrgb": "srcalpha",
    "dstrgb": "one_minus_srcalpha",
    "srcalpha": "one",
    "dstalpha": "one_minus_srcalpha"
  },
  "vertex": "comet-client:blur",
  "fragment": "comet-client:composite",
  "attributes": [ "Position" ],
  "samplers": [ { "name": "DiffuseSampler" } ],
  "uniforms": [
    { "name": "ProjMat",    "type": "matrix4x4", "count": 16,
      "values": [ 1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1 ] },
    { "name": "InSize",     "type": "float", "count": 2, "values": [ 1, 1 ] },
    { "name": "OutSize",    "type": "float", "count": 2, "values": [ 1, 1 ] },
    { "name": "Saturation", "type": "float", "count": 1, "values": [ 1.8 ] },
    { "name": "Brightness", "type": "float", "count": 1, "values": [ 1.05 ] },
    { "name": "Tint",       "type": "float", "count": 4, "values": [ 1, 1, 1, 0 ] },
    { "name": "Radius",     "type": "float", "count": 1, "values": [ 14 ] },
    { "name": "Rect",       "type": "float", "count": 4, "values": [ 0, 0, 1, 1 ] }
  ]
}
```

### 6.3 顶点着色器（两趟 + 合成共用）

全屏 quad 直接给 NDC 坐标，`ProjMat` 传单位阵，不依赖 `RenderSystem` 的投影矩阵——这样 `BufferRenderer.drawWithShader` 画一个 `(-1,-1)~(1,1)` 的 quad 就能铺满任意尺寸的 framebuffer：

```glsl
// assets/comet-client/shaders/core/blur.vsh
#version 150

in vec3 Position;

out vec2 vUv;

void main() {
    vUv = Position.xy * 0.5 + 0.5;
    gl_Position = vec4(Position, 1.0);
}
```

### 6.4 片元着色器：可分离高斯

`blur.fsh`，两趟共用，`Direction` 切换 `(1,0)` / `(0,1)`。半径按 CSS `blur(Npx)` 折算：浏览器高斯大约 σ ≈ N/2，我们用 `sigma = Radius * 0.5`，采样半径取 `ceil(3*sigma)`，9 tap（固定权重）按 `sigma` 缩放步长——这样 `Radius=0` 时退化为原图，不需要分支：

```glsl
// assets/comet-client/shaders/core/blur.fsh
#version 150

uniform sampler2D DiffuseSampler;

uniform vec2  InSize;      // 输入纹理物理尺寸，ShaderProgram 自动填
uniform vec2  Direction;   // (1,0) 水平 / (0,1) 垂直
uniform float Radius;      // CSS blur() 的 px，对应 --cm-blur

in  vec2 vUv;
out vec4 fragColor;

void main() {
    float sigma   = max(Radius * 0.5, 0.001);
    vec2  texel   = Direction / InSize;
    float stepLen = sigma / 2.0;          // 9-tap 覆盖约 ±2σ，靠步长缩放模拟更大半径

    // 归一化 9-tap 高斯权重（σ=1 时的离散近似）
    float w0 = 0.2270270270;
    float w1 = 0.1945945946;
    float w2 = 0.1216216216;
    float w3 = 0.0540540541;
    float w4 = 0.0162162162;

    vec3 acc = texture(DiffuseSampler, vUv).rgb * w0;
    acc += texture(DiffuseSampler, vUv + texel * stepLen * 1.0).rgb * w1;
    acc += texture(DiffuseSampler, vUv - texel * stepLen * 1.0).rgb * w1;
    acc += texture(DiffuseSampler, vUv + texel * stepLen * 2.0).rgb * w2;
    acc += texture(DiffuseSampler, vUv - texel * stepLen * 2.0).rgb * w2;
    acc += texture(DiffuseSampler, vUv + texel * stepLen * 3.0).rgb * w3;
    acc += texture(DiffuseSampler, vUv - texel * stepLen * 3.0).rgb * w3;
    acc += texture(DiffuseSampler, vUv + texel * stepLen * 4.0).rgb * w4;
    acc += texture(DiffuseSampler, vUv - texel * stepLen * 4.0).rgb * w4;

    fragColor = vec4(acc, 1.0);
}
```

这里做一个诚实的说明：CSS 的 `blur(30px)` 是三段 box-blur 近似高斯、σ 更大，9 tap 固定权重 + 步长缩放只能做到「视觉接近」，做不到像素级一致。想要更准就把 tap 数提到 13/17 并按 `exp(-x²/2σ²)` 动态算权重；但 30px 半径下 9 tap 配 1/2 降采样已经很接近了，且省一半采样。**这个换算是「算法可 1:1 移植」里唯一需要标星号的近似**。

### 6.5 合成着色器：饱和度 / 亮度 / 圆角 SDF / 面板底色

`composite.fsh` 干四件事：把模糊纹理按面板矩形贴上去、做 `saturate()` / `brightness()`、叠白色渐变底、用 SDF 圆角矩形裁 alpha。`Rect` 是面板矩形在纹理 UV 里的范围 `[x0,y0,x1,y1]`，`Radius` 是圆角（GUI px，转成 UV 比例）：

```glsl
// assets/comet-client/shaders/core/composite.fsh
#version 150

uniform sampler2D DiffuseSampler;

uniform vec2  InSize;
uniform float Saturation;   // 对应 saturate(180%) -> 1.8
uniform float Brightness;   // 对应 brightness(1.05)
uniform vec4  Tint;         // 面板底色渐变的近似叠色 rgba
uniform vec4  Rect;         // 面板矩形 UV 范围 x0,y0,x1,y1
uniform float Radius;       // 圆角 px

in  vec2 vUv;
out vec4 fragColor;

// 圆角矩形 SDF：p 是相对中心的局部坐标，b 是半尺寸，r 是圆角半径
float roundedBoxSDF(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
    vec3 c = texture(DiffuseSampler, vUv).rgb;

    // saturate()
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, Saturation);
    // brightness()
    c *= Brightness;

    // 面板白色渐变底：用 Tint 近似 linear-gradient(135deg) 的四段白透明度
    float g = clamp((vUv.x + (1.0 - vUv.y)) * 0.5, 0.0, 1.0);
    vec3 panelTint = mix(vec3(0.26), vec3(0.05), g);
    c = mix(c, panelTint, Tint.a);
    c += Tint.rgb * 0.06;

    // 圆角裁剪：Rect 是 UV，换成物理像素后求中心与半尺寸
    vec2 p        = vUv * InSize;
    vec2 r0       = Rect.xy * InSize;
    vec2 r1       = Rect.zw * InSize;
    vec2 center   = (r0 + r1) * 0.5;
    vec2 halfSize = (r1 - r0) * 0.5;
    float sdf = roundedBoxSDF(p - center, halfSize, Radius);
    float aa  = 1.0 - smoothstep(-1.0, 1.0, sdf);   // 1px 抗锯齿边
    if (aa <= 0.001) discard;

    fragColor = vec4(c, aa);
}
```

`Radius` 传的是 `effectiveRadius() * scaleFactor`，已经是物理像素，和 `InSize` 同一套单位；`Rect` 的四个分量是 0~1 的 UV，所以两边都要乘 `InSize` 才能比较。这两套单位混用是圆角糊成椭圆或整块被 `discard` 的最常见原因。

### 6.6 GlassBlurRenderer.java

整个链条收在一个类里。`Framebuffer` 是 Yarn 名（Mojang 名 `RenderTarget`），`SimpleFramebuffer` 是 1.21.1 里可直接 new 的实现；老映射里构造参数是 `(w,h,depth,useDepthAttachment)`，1.21.1 是 `(w,h,depth,isMac)`，按锁定的映射选：

```java
package com.bigpixel.comet.render.glass;

import com.bigpixel.comet.render.shader.ShaderRegistry;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.*;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gl.Framebuffer;
import net.minecraft.client.gl.SimpleFramebuffer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gl.ShaderProgram;

public final class GlassBlurRenderer {
    private GlassBlurRenderer() {}

    private static Framebuffer ping;
    private static Framebuffer pong;
    private static int fbW = -1, fbH = -1;

    /** 由 ClientTickEvents 或窗口 resize 回调驱动，尺寸变了就重建。 */
    public static void ensureSize(MinecraftClient mc) {
        int w = mc.getWindow().getFramebufferWidth();
        int h = mc.getWindow().getFramebufferHeight();
        if (w == fbW && h == fbH && ping != null) return;
        if (ping != null) ping.delete();
        if (pong != null) pong.delete();
        // 1/2 降采样：模糊半径 30px 下视觉损失极小，采样量降 4 倍
        int bw = Math.max(1, w / 2), bh = Math.max(1, h / 2);
        ping = new SimpleFramebuffer(bw, bh, false, MinecraftClient.IS_SYSTEM_MAC);
        pong = new SimpleFramebuffer(bw, bh, false, MinecraftClient.IS_SYSTEM_MAC);
        ping.setClearColor(0, 0, 0, 0);
        pong.setClearColor(0, 0, 0, 0);
        fbW = w; fbH = h;
    }

    /**
     * 两趟可分离高斯。srcTex 一般是 mc.getFramebuffer().getColorAttachment()，
     * 结果留在 pong.colorAttachment。radiusPx 对应 CSS blur(Npx)。
     */
    public static void blur(MinecraftClient mc, int srcTex, float radiusPx) {
        ensureSize(mc);
        ShaderProgram prog = ShaderRegistry.blur();
        if (prog == null || radiusPx <= 0.01f) return;

        Framebuffer main = mc.getFramebuffer();
        Framebuffer prevTarget = main;   // 记录，最后恢复

        // ---- 第一趟：水平 ----
        ping.clear(MinecraftClient.IS_SYSTEM_MAC);
        ping.beginWrite(true);
        RenderSystem.setShader(() -> prog);
        RenderSystem.setShaderTexture(0, srcTex);
        setUniform(prog, "Direction", 1.0f, 0.0f);
        setUniform(prog, "Radius", radiusPx);
        drawFullscreenQuad();

        // ---- 第二趟：垂直 ----
        pong.clear(MinecraftClient.IS_SYSTEM_MAC);
        pong.beginWrite(true);
        RenderSystem.setShader(() -> prog);
        RenderSystem.setShaderTexture(0, ping.getColorAttachment());
        setUniform(prog, "Direction", 0.0f, 1.0f);
        setUniform(prog, "Radius", radiusPx);
        drawFullscreenQuad();

        // 恢复主 framebuffer，后续 HUD / Screen 继续往它画
        prevTarget.beginWrite(true);
    }

    /** 全屏运动模糊用：直接把模糊结果盖回主 framebuffer（不带面板底色）。 */
    public static void blurFullScreen(MinecraftClient mc, float radiusPx, float sat, float bright) {
        int src = mc.getFramebuffer().getColorAttachment();
        blur(mc, src, radiusPx);
        // 用 composite 把 pong 全屏贴回（Rect = 全屏，Tint.a = 0 不叠面板色）
        composite(mc, pong.getColorAttachment(), sat, bright,
                  0f, 0f, 1f, 1f, /* tintAlpha */ 0f, /* corner */ 0f);
    }

    /** 面板用：把模糊纹理按面板矩形合成到当前 DrawContext 之上。 */
    public static void drawGlassPanel(MinecraftClient mc, DrawContext dc,
                                      int x, int y, int w, int h, GlassParams p) {
        if (!p.glass() || p.blurPx() <= 0.01f) {
            drawOpaquePanel(dc, x, y, w, h, p);   // 降级：见 6.8
            return;
        }
        int src = mc.getFramebuffer().getColorAttachment();
        blur(mc, src, p.blurPx());

        int fbW = mc.getWindow().getFramebufferWidth();
        int fbH = mc.getWindow().getFramebufferHeight();
        float scale = mc.getWindow().getScaleFactor();
        // GUI 像素 → framebuffer 像素 → UV
        float x0 = (x * scale) / fbW, y0 = (y * scale) / fbH;
        float x1 = ((x + w) * scale) / fbW, y1 = ((y + h) * scale) / fbH;

        composite(mc, pong.getColorAttachment(),
                  p.effectiveSaturation(), 1.05f,
                  x0, y0, x1, y1,
                  /* tintAlpha */ 0.18f,
                  /* corner */ p.effectiveRadius() * scale);

        drawPanelChrome(dc, x, y, w, h, p);   // sheen / 边框 / 阴影 / 圆角补线
    }

    private static void composite(MinecraftClient mc, int tex,
                                  float sat, float bright,
                                  float x0, float y0, float x1, float y1,
                                  float tintAlpha, float corner) {
        ShaderProgram prog = ShaderRegistry.composite();
        if (prog == null) return;
        RenderSystem.enableBlend();
        RenderSystem.defaultBlendFunc();
        RenderSystem.setShader(() -> prog);
        RenderSystem.setShaderTexture(0, tex);
        setUniform(prog, "Saturation", sat);
        setUniform(prog, "Brightness", bright);
        setUniform(prog, "Tint", 1f, 1f, 1f, tintAlpha);
        setUniform(prog, "Rect", x0, y0, x1, y1);
        setUniform(prog, "Radius", corner);
        drawFullscreenQuad();
        RenderSystem.disableBlend();
    }

    /** 画 NDC 全屏 quad；POSITION 顶点直接是裁剪空间坐标。 */
    private static void drawFullscreenQuad() {
        BufferBuilder bb = Tessellator.getInstance()
                .begin(VertexFormat.DrawMode.QUADS, VertexFormats.POSITION);
        bb.vertex(-1.0f, -1.0f, 0.0f);
        bb.vertex( 1.0f, -1.0f, 0.0f);
        bb.vertex( 1.0f,  1.0f, 0.0f);
        bb.vertex(-1.0f,  1.0f, 0.0f);
        BufferRenderer.drawWithShader(bb.end());
    }

    private static void setUniform(ShaderProgram prog, String name, float... v) {
        // ShaderProgram#getUniform 可能为 null（被 GLSL 优化掉），统一走一个空安全 helper
        var u = prog.getUniform(name);
        if (u == null) return;
        if (v.length == 1) u.set(v[0]);
        else if (v.length == 2) u.set(v[0], v[1]);
        else if (v.length == 4) u.set(v[0], v[1], v[2], v[3]);
    }

    private static void drawPanelChrome(DrawContext dc, int x, int y, int w, int h, GlassParams p) {
        int accent = p.accentArgb();
        // 外阴影两层：对应 0 20px 60px / 0 2px 10px
        dc.fill(x + 3, y + 6, x + w + 3, y + h + 6, 0x40000000);
        dc.fill(x + 1, y + 2, x + w + 1, y + h + 2, 0x26000000);
        // 边框 rgba(255,255,255,.42)
        int border = 0x6BFFFFFF;
        dc.fill(x, y, x + w, y + 1, border);
        dc.fill(x, y + h - 1, x + w, y + h, border);
        dc.fill(x, y, x + 1, y + h, border);
        dc.fill(x + w - 1, y, x + w, y + h, border);
        // inset 顶高光 / 底暗边
        dc.fill(x + 1, y + 1, x + w - 1, y + 2, 0x85FFFFFF);
        dc.fill(x + 1, y + h - 2, x + w - 1, y + h - 1, 0x24FFFFFF);
    }

    private static void drawOpaquePanel(DrawContext dc, int x, int y, int w, int h, GlassParams p) {
        // 降级：不跑模糊，直接用 var(--cm-bg) 渐变近似，对应 .plain
        int bg = p.bgArgb();
        dc.fill(x, y, x + w, y + h, 0xE0000000 | (bg & 0x00FFFFFF));
        drawPanelChrome(dc, x, y, w, h, p);
    }
}
```

几个落地时必须盯住的点：

- **`beginWrite` / 恢复**。两趟模糊把 `ping` / `pong` 绑成 render target，结束时必须 `mc.getFramebuffer().beginWrite(true)` 把绑定还回去，否则后续 `DrawContext` 全画到离屏 buffer 上，屏幕一片黑。这是全篇最容易出 bug 的地方。
- **读主 framebuffer 的颜色纹理当输入**是允许的（读纹理、写另一个 FBO，不构成 feedback loop），但**不能**把 `ping` 既当输入又当输出，所以必须 ping-pong 两个。
- `SimpleFramebuffer` 的构造参数按实际 Yarn build 核对；1.21.1+build.68 是 `(int width, int height, boolean depth, boolean isMac)`。若报 `Framebuffer` 抽象，就用 `SimpleFramebuffer`。
- `BufferRenderer.drawWithShader` 依赖 `RenderSystem.setShader` 设置的当前 program；若该 API 在你的 Fabric 版本里叫 `drawWithGlobalProgram`，改个方法名即可，逻辑不变。
- `InSize` / `OutSize` 由 `ShaderProgram` 自动填当前 FBO 尺寸，别手动 set，会和 framebuffer 的实际尺寸对不上导致模糊方向错。

### 6.7 与 Iris / Sodium 的兼容与降级

这是必须写清楚的一段，不然用户装了光影一开就花屏。

**Iris**（光影 Mod）会接管整个渲染管线：它把主场景渲到自己的 framebuffer，最后用 composite pass 出图，还会替换 `GameRenderer` 的着色器。直接读 `mc.getFramebuffer().getColorAttachment()` 可能拿到的是 Iris 的中间 buffer 而不是最终画面；更糟的是 Iris 会在 `END_MAIN` 之后还要跑自己的 pass，我们在那个时机插入模糊会破坏它的 pipeline。

几条对策，按优先级：

1. **检测后降级**：运行时用 `FabricLoader.getInstance().isModLoaded("iris")` / `("sodium")` 判断。装了 Iris 就关掉「全屏运动模糊」（它和光影的运动模糊/景深重复，本来也冲突），玻璃面板改成「半不透明底 + 无模糊」的降级外观。
2. **时机挪后**：面板模糊放在 `ClickGuiScreen.render` 里做（那时 Iris 已经出完图），而不是 `END_MAIN`。全屏运动模糊没法挪，只能降级。
3. **别碰 Iris 的 framebuffer**：只 `getColorAttachment()` 读取，不 `beginWrite` 到它；我们自己的 `ping/pong` 是独立 FBO，不干扰 Iris。
4. **Sodium** 不改 framebuffer 结构（主要改区块渲染），对这套后处理基本无影响；但它可能改 `RenderSystem` 状态缓存，`enableBlend/disableBlend` 前后要 `RenderSystem.defaultBlendFunc()` 显式复位，别省。

降级开关集中在一个地方，和卷一的 `PerfLevel` 联动：

```java
public final class GlassCapability {
    private GlassCapability() {}

    public static boolean available() {
        if (net.fabricmc.loader.api.FabricLoader.getInstance().isModLoaded("iris")) return false;
        if (ShaderRegistry.blur() == null) return false;       // shader 没注册成功
        return true;
    }

    /** 综合 Iris / 性能档 / 用户开关，决定这一帧要不要真跑模糊。 */
    public static boolean shouldBlur(MinecraftClient mc) {
        if (!available()) return false;
        if (!com.bigpixel.comet.config.Theme.current().glass()) return false;
        // 省电 / 均衡档关掉毛玻璃（对应卷一 perfFx() 的 0.4 / 0.7 缩放思路）
        return com.bigpixel.comet.config.PerfLevel.current(mc) == com.bigpixel.comet.config.PerfLevel.FANCY;
    }
}
```

网页里没有这个烦恼——浏览器合成器由浏览器自己管。Java 侧多出来的这段「检测 + 降级」是移植必须补的防御代码。

### 6.8 性能开销与开关建议

算一笔账。1920×1080 全屏、1/2 降采样到 960×540，两趟各 9 tap：

- 采样次数 `2 × 9 × 960×540 ≈ 933 万` 次纹理读取/帧。
- 两个 `SimpleFramebuffer` 各约 `960×540×4B ≈ 2MB`，共 4MB 显存。
- 加上合成一趟，整体在主流独显上大约 0.5-1.5ms，集显 2-4ms。

网页里 `backdrop-filter` 也是这个量级，只是浏览器替你做了；Java 里这笔开销会实打实落到帧率上。所以：

| 场景 | 建议 |
| --- | --- |
| `ClickGUI` 打开 | 面板模糊开。GUI 打开时游戏本来就在暂停/慢速渲染，用户不敏感 |
| `glass` 主题 + HUD 元素 | **别逐个糊**。所有 HUD 胶囊共用一张「整屏模糊纹理」，按各自矩形采样，一次模糊全屏复用 |
| 全屏运动模糊 | 只在 `mblur` 模块开、`smooth>0.05`、且大地图未打开时跑；装了 Iris 直接关 |
| 省电 / 均衡档 | 关毛玻璃与运动模糊，走 `drawOpaquePanel` 纯色底 |
| 基本档 (`plain`) | `blurPx=0`，CSS 里 `.plain` 也没模糊，天然跳过 |
| 半径 > 20px | 1/4 降采样 + 两趟；或把 tap 降到 5 |
| 通知 / 下拉层 | 复用主模糊纹理，不单独跑 |

`perfLevel()` 的判据（卷一第 6 节）直接接进来：`FpsSampler.get() < 45` 自动降级到「不模糊」，用户手动选「绚丽」才强制开。这样低端机不会因为开了玻璃主题就掉到 20 帧。

---

## 7. 自定义 Screen（ClickGUI）渲染骨架

`#__comet_panel` 在 Java 里是 `Screen` 的子类。`Screen` 天然盖在 HUD 之上（对应 `#__comet_gui` 的 z-index 2147483647 最高），`renderBackground` 画遮罩，`render` 画面板与控件。骨架按 `drawBackground / drawPanel / drawModuleList` 三段拆，和 DOM 的 `dim / panel / modScroll` 一一对应：

```java
package com.bigpixel.comet.gui;

import com.bigpixel.comet.config.ConfigManager;
import com.bigpixel.comet.module.Category;
import com.bigpixel.comet.module.Module;
import com.bigpixel.comet.module.ModuleRegistry;
import com.bigpixel.comet.render.glass.*;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;

import java.util.ArrayList;
import java.util.List;

public class ClickGuiScreen extends Screen {

    private static final int PANEL_W = 400, PANEL_H = 250;   // 对应 CSS，但用 scaled 像素，不 ×2
    private int panelX, panelY;
    private String selectedCat = "combat";
    private Module selected = null;
    private String search = "";
    private float openProgress = 1f;   // 对应 CSS 的 opacity/transform .25s 过渡

    public ClickGuiScreen() { super(Text.literal("Comet ClickGUI")); }

    @Override
    protected void init() {
        panelX = (this.width - PANEL_W) / 2 + (int) ConfigManager.get().guiOffset.x;
        panelY = (this.height - PANEL_H) / 2 + (int) ConfigManager.get().guiOffset.y;
    }

    // ============ ① drawBackground：对应 .cm-dim ============
    private void drawBackgroundLayer(DrawContext dc, GlassParams p) {
        if (p.glass()) {
            // radial-gradient(120% 120% at 50% 0%, rgba(10,10,14,.16), rgba(6,6,10,.44))
            // DrawContext 没有径向渐变，用双层竖向渐变近似
            dc.fillGradient(0, 0, this.width, this.height,
                    0x290A0A0E, 0x7006060A);
            // blur(3px) 由 GlassBlurRenderer 的低半径全屏模糊承担，Glass 主题下才跑
        } else {
            dc.fill(0, 0, this.width, this.height, 0x7D000000);   // rgba(0,0,0,.49)
        }
    }

    // ============ ② drawPanel：对应 #__comet_panel + .cm-sheen + .cm-pane ============
    private void drawPanel(DrawContext dc, GlassParams p) {
        int x = panelX, y = panelY, w = PANEL_W, h = PANEL_H;

        if (GlassCapability.shouldBlur(this.client)) {
            GlassBlurRenderer.drawGlassPanel(this.client, dc, x, y, w, h, p);
        } else {
            GlassBlurRenderer.drawOpaquePanel(dc, x, y, w, h, p);
        }

        // sheen：三层高光，先于所有控件画（对应 z-index:0）
        if (p.sheenVisible()) drawSheen(dc, x, y, w, h, p);

        // 四个 .cm-pane
        drawPane(dc, x + 8,   y + 8,  80, 235, 10, p);   // .cm-side
        drawPane(dc, x + 92,  y + 8,  300, 25,  8,  p);   // .cm-header
        drawPane(dc, x + 92,  y + 38, 120, 204, 6,  p);   // .cm-mods
        drawPane(dc, x + 218, y + 38, 172, 204, 7,  p);   // .cm-sets

        // 标题 / 搜索胶囊 / 主题切换胶囊
        dc.drawText(this.textRenderer, Text.literal(selectedCat),
                x + 100, y + 16, p.glass() ? 0xB8FFFFFF : 0x80808080, false);
        drawCapsule(dc, x + 315, y + 12, 70, 15, 4, p);
        drawCapsule(dc, x + 12,  y + 198, 70, 17, 5, p);
    }

    // ============ ③ drawModuleList：对应 .cm-modscroll / .cm-row ============
    private void drawModuleList(DrawContext dc, GlassParams p) {
        int x = panelX + 92 + 3, y = panelY + 38 + 5;
        int rowH = 22, maxRows = 9;
        List<Module> mods = new ArrayList<>();
        for (Module m : ModuleRegistry.all()) {
            if (!m.cat.equals(selectedCat)) continue;
            if (!search.isEmpty() && !m.cn.contains(search) && !m.name.toLowerCase().contains(search.toLowerCase())) continue;
            mods.add(m);
        }

        int rowBg      = p.glass() ? 0x1AFFFFFF : 0x19646464;
        int rowBgHover = p.glass() ? 0x33FFFFFF : 0x2D646464;
        int rowSel     = p.glass() ? 0x3DFFFFFF : 0x37474747;
        int textOff    = p.glass() ? 0xB8FFFFFF : 0xB4808080;
        int textOn     = 0xFFFFFFFF;

        int mouseX = (int) (this.client.mouse.getX() / this.client.getWindow().getScaleFactor());
        int mouseY = (int) (this.client.mouse.getY() / this.client.getWindow().getScaleFactor());

        for (int i = 0; i < Math.min(maxRows, mods.size()); i++) {
            Module m = mods.get(i);
            int ry = y + i * (rowH + 2);
            boolean hover = mouseX >= x && mouseX <= x + 114 && mouseY >= ry && mouseY <= ry + rowH;
            int bg = m == selected ? rowSel : (hover ? rowBgHover : rowBg);
            GlassBlurRenderer.fillRounded(dc, x, ry, 114, rowH, 5, bg);
            if (m == selected) {
                int bc = p.glass() ? 0x75FFFFFF : 0x4FC8C8C8;
                dc.fill(x, ry, x + 114, ry + 1, bc);
            }
            dc.drawText(this.textRenderer, Text.literal(m.cn),
                    x + 10, ry + 7, m.on() ? textOn : textOff, false);
        }
    }

    // ---- 辅助 ----
    private void drawPane(DrawContext dc, int x, int y, int w, int h, float r, GlassParams p) {
        int bg = p.glass() ? 0x14FFFFFF : 0x19808080;
        GlassBlurRenderer.fillRounded(dc, x, y, w, h, r, bg);
        if (p.glass()) dc.fill(x + 1, y, x + w - 1, y + 1, 0x57FFFFFF);   // inset 顶高光
    }

    private void drawCapsule(DrawContext dc, int x, int y, int w, int h, float r, GlassParams p) {
        int bg = p.glass() ? 0x1AFFFFFF : 0x0DFFFFFF;
        GlassBlurRenderer.fillRounded(dc, x, y, w, h, r, bg);
        dc.fill(x, y, x + w, y + 1, p.glass() ? 0x57FFFFFF : 0x37705A6E);
    }

    private void drawSheen(DrawContext dc, int x, int y, int w, int h, GlassParams p) {
        // 左上高光 radial-gradient(90% 62% at 16% -10%, rgba(255,255,255,.34), ...)
        // 用几层递减 alpha 的横向条带近似；fancy 档再叠一道随 tickDelta 平移的横扫
        for (int i = 0; i < 6; i++) {
            int a = (int) (0x34 * (1f - i / 6f)) << 24;
            dc.fill(x, y + i * 3, x + w / 3, y + i * 3 + 3, a | 0xFFFFFF);
        }
        if (p.breathe()) {
            float t = (System.nanoTime() / 1_000_000_000f) * p.animSpeed();
            int sweep = (int) ((t % 5f) / 5f * (w + 120)) - 60;
            dc.fill(x + sweep, y, x + sweep + 20, y + h, 0x14FFFFFF);
        }
    }

    @Override
    public void render(DrawContext dc, int mouseX, int mouseY, float delta) {
        GlassParams p = GlassParams.current();
        drawBackgroundLayer(dc, p);
        drawPanel(dc, p);
        drawModuleList(dc, p);
        // 设置面板 / 搜索结果下拉 / 悬浮分类面板依次画，顺序 = 源脚本 z-index
        super.render(dc, mouseX, mouseY, delta);
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        // 对应 .cm-row 的 mousedown → toggleModule / 选中，见卷一 ModuleRegistry.toggle
        return super.mouseClicked(mx, my, button);
    }

    @Override
    public boolean mouseDragged(double mx, double my, int button, double dx, double dy) {
        // 对应 makeDraggable 的中键拖面板：更新 cfg.guiOffset，落盘
        return super.mouseDragged(mx, my, button, dx, dy);
    }

    @Override
    public boolean shouldPause() { return false; }   // GUI 开着游戏不停，对应网页版
}
```

`drawBackground / drawPanel / drawModuleList` 三段对应 DOM 的 `dim / panel / modScroll`，`GlassParams.current()` 每 frame 开头解析一次（帧级缓存由卷一的 `ConfigManager.beginFrame/endFrame` 兜着），`GlassCapability.shouldBlur()` 把 Iris / 性能档 / 主题三道门槛收在一处。悬浮分类面板 `.cm-float` 是另一个 `FloatPanelScreen`，渲染骨架一样，只是数据源换成按 `Category` 分组、`radius=9`、多实例可拖动。

---

## 8. 哪些能 1:1 搬，哪些必须换实现

**算法可 1:1 移植**：

- `updateMotionBlur()` 的 `d = hypot(Δyaw, Δpitch)`、±π 归一化、`target = min(strength, d*strength*22)`、`mbSmooth` 非对称平滑（本卷第 5 节已给完整 Java）。
- `APPEARANCE_PRESETS` 8 组常量、`val()` 的「用户值优先、空值回落预设」、`applyAppearancePreset` 的批量写回。
- 所有颜色 / 圆角 / 透明度数值（第 1、4 节的表），直接当常量用。
- `accentRgb()` 的 hex 解析逻辑（虽然 Java 里不需要拼字符串）。
- 主题与档位的正交关系：`Theme` 管磨砂、`preset` 管强度。
- 面板 400×250 的布局坐标、各 pane 的 left/top/width/height（去掉 ×2 之后）。
- 通知队列 2600ms 过期、`cm-notein` 的 0.2s 滑入（用 `tickDelta` 插值）。

**网页特有，必须换实现**：

| 网页机制 | 为什么不能搬 | Java 替代 |
| --- | --- | --- |
| `backdrop-filter: blur()` | Java 没有「对背后像素实时模糊」的合成器 | 截主 framebuffer → 两趟可分离高斯 → 合成（本卷第 6 节完整实现） |
| `blur(30px) saturate(180%) brightness(1.05)` 一条 CSS 搞定 | 三个操作分属模糊 shader 与颜色分级 | `blur.fsh` + `composite.fsh` 的 `Saturation` / `Brightness` uniform |
| CSS 变量 `--cm-*` + `calc()` | 无 CSS | `GlassParams` record + Java 算数 |
| `:root` / `.glass` / `.fancy` / `.plain` class 切换 | 无 DOM | `Theme.current()` + `preset` 枚举判断 |
| `radial-gradient` / 多段 `linear-gradient` / `inset box-shadow` | `DrawContext` 只有纯色矩形与线性 `fillGradient` | 多层 `fill` 近似 + composite shader 的 `panelTint`；sheen 用条带近似或 shader |
| `border-radius` | 无原生圆角 API | composite shader 的 SDF `discard`；`fillRounded` 纯 Java 兜底 |
| `border-radius:50%` 的小地图 | 圆形裁剪 | shader `discard` 或圆形 mask 贴图 |
| `text-shadow` | 无 | 先画一层偏移暗色文本，再画亮色 |
| `@keyframes` 呼吸 / 色相 / 横扫 / 通知滑入 | 无 CSS 动画 | `System.nanoTime()` / `tickDelta` 驱动相位 |
| DOM 拖放、右键折叠、滚轮滚动 | 无 DOM 事件 | `Screen#mouseDragged / mouseClicked / mouseScrolled` |
| `z-index` | 无 | `Screen.render` 内绘制顺序 + 独立 `Screen` |
| `transition: opacity .25s` | 无 | `openProgress` 插值 |
| `.cm-map-open #__comet_mblur { display:none }` | CSS 后代选择器 | `BigMapScreen.isOpen()` 显式判断 |

额外一条：**Iris / Sodium 兼容与降级是网页版完全不存在的代码**，属于 Java 侧净新增的防御层，别漏。

---

## 9. 收尾

把这一卷的调用链串一遍，落地时按这个顺序核对：

1. `ShaderRegistry.register()` 在 `onInitializeClient` 里跑，shader 必须在任何渲染前就绪。
2. `WorldRenderEvents.END_MAIN` → `MotionBlurRenderer.compositeIfNeeded()`，按 yaw/pitch 速率糊游戏画面（不糊 HUD）。
3. `ClientTickEvents.END_CLIENT_TICK` → `MotionBlurRenderer.tick()` 更新强度、`GlassBlurRenderer.ensureSize()` 处理窗口 resize。
4. `ClickGuiScreen.render()` → `GlassParams.current()` → `GlassCapability.shouldBlur()` → `GlassBlurRenderer.drawGlassPanel()`（两趟模糊 + 合成 + chrome）→ 三段 draw。
5. `HudRenderer` 里所有玻璃态 HUD 胶囊共用 `pong` 那张模糊纹理，按各自矩形采样，绝不逐个重跑模糊。
6. 省电/均衡/Iris/基本档 → `drawOpaquePanel` 纯色底降级。

最容易翻车的三处再点一遍：模糊结束忘了 `mc.getFramebuffer().beginWrite(true)` 恢复绑定；`Rect` 的 GUI 像素没乘 `getScaleFactor()` 导致采样区域错位；给每个 HUD 小框各跑一趟模糊导致帧率崩。盯住这三点，毛玻璃就能在 Java 版里稳稳立住。
