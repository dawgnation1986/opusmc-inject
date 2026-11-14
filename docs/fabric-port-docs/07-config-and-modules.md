# 07 · 配置与模块系统

**对应源码**：`cfg` / `saveCfg`（106–131）、旧配置迁移（785–803）、`getS` / `setS` / `modOn` / `toggleModule` / `afterToggle` / `afterSetting`（805–863）、`MODULES` 与 `CATS`（286–779）、五组 `EXT_MODULES`（4653 / 5384 / 6128 / 6644 / 7171）、`MODULE_SUB_ORDER` / `MODULE_SUBS` / `sortedModules` / `renderModuleList`（10516–10556）、搜索（10565–10617）、`syncGuiClasses`（10620）、`keyName` / `makeModuleRow` / 绑定按钮（10456–10505、10800–10817）、`applyTheme` / `setTheme`（10238–10259）、`APPEARANCE_PRESETS` / `applyAppearance` / `saveAppearanceSnapshot` / `restoreAppearance` / `applyAppearancePreset`（1878–1942）、`perfLevel` / `perfGlow`（1943–1952）、`.opuscfg` 备份（11145–11229）、`extSelfTest`（6963–7017）、`extHealthCheck`（6333–6370）、帮助中心自检 Tab（7121–7138）、键位管理 Tab（6495–6545）、`onKeyDown`（11750–11835）。

**要实现的效果**：一个能记住 100 个模块开关、307 个设置项、键位绑定、收藏、面板位置、主题、外观预设、路径点和备份文件的配置系统；模块按分类 / 子分类组织，能搜索、能收藏置顶、能用中键或按钮绑按键；两套主题（default / glass）、四档外观预设（绚丽 / 平缓 / 基本 / 自定义）可切换并还原自定义值；`.opuscfg` 能完整导入导出；帮助中心能自检出「未注册的设置」「重复 id」「未知模块键位」这类问题。

**Java 侧对应概念**：`ModConfig` POJO + Gson 落盘（替代 `localStorage`）、`Module` 基类 + `ModuleRegistry`（替代 `MODULES` / `MODS_BY_ID`）、`SettingSpec`（替代 `settings[]` 描述对象）、Cloth Config 屏幕（替代手写 DOM 设置面板）、`KeyBindingHelper` + 自定义按键捕获屏幕（替代 `cfg.binds` + `keydown` 捕获）、`BackupCodec`（替代 `buildBackup` / `parseBackup`）、`ModuleRegistry.selfTest()`（替代 `extSelfTest`）。

这一卷是地基。02–06、09 卷都要 import 这里的 `ModConfig` / `Module` / `ModuleRegistry`，先落地再往下做。

---

## 1. `cfg` 的完整结构与持久化

### 1.1 源码长什么样

IIFE 顶层读一次 `localStorage`，逐字段 `||` 回退到默认值（103–127 行）：

```js
const CFG_KEY = '__cometCfg';
const OLD_KEY = '__opusHudCfg';
const stored = JSON.parse(W.localStorage.getItem(CFG_KEY) || '{}');
const oldCfg = JSON.parse(W.localStorage.getItem(OLD_KEY) || 'null');

const cfg = {
  states: stored.states || {},                 // 模块开关：moduleId -> bool
  settings: stored.settings || {},            // 设置值："moduleId.settingId" -> 任意类型
  binds: stored.binds || {},                  // 键位：moduleId -> KeyboardEvent.code
  favorites: stored.favorites || {},          // 收藏：moduleId -> bool
  hudPos: stored.hudPos || {},                // 各 HUD 元素位置
  guiOffset: stored.guiOffset || { x: 0, y: 0 },
  theme: stored.theme === 'glass' ? 'glass' : 'default',
  servers: stored.servers || [{ name: '官方', url: 'https://xz.honghemc.cn:8443' }],
  serverIdx: stored.serverIdx || 0,
  mcAddr: stored.mcAddr || 'ws://localhost:25565',
  mcName: stored.mcName || 'WebPlayer',
  floatPos: stored.floatPos || {},
  guiKey: stored.guiKey || 'Backquote',
  waypoints: Array.isArray(stored.waypoints) ? stored.waypoints : [],
  minmapPos: stored.minmapPos || { x: 16, y: 16 },
  invPos: stored.invPos || { x: 16, y: 16 },
  dropsPos: stored.dropsPos || { x: 16, y: 210 },
  musicPos: stored.musicPos || { x: 16, y: 16 },
  appearance: stored.appearance || {},
  ext: stored.ext || { coords: [], profiles: {}, macros: [], stats: null },
};

function saveCfg() {
  try { W.localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* 内存态兜底 */ }
}
```

几个容易漏的点：

- `settings` 是**扁平 Map**，key 形如 `"aura.range"`、`"esp.mobColor"`，不是嵌套对象。源码所有读写都走 `getS(mid, sid)` 拼 key。
- `settings` 的值类型混合：`checkbox` 是 boolean、`slider` 是 number、`color` / `text` 是字符串、`multi` 是字符串数组。Java 侧用 `Map<String, JsonElement>` 才装得下，别用 `Map<String, String>`。
- `theme` 做了白名单校验（`=== 'glass' ? 'glass' : 'default'`），不是裸取字符串。`waypoints` 也校验了 `Array.isArray`。移植时要把这类校验补上，脏配置不该让 mod 崩。
- `saveCfg()` 全程 `try/catch` 吞异常，写失败就留在内存。Java 侧对应「写临时文件 + 原子 move，失败只记日志不抛」。

### 1.2 旧配置迁移（785–803）

一次性把 `__opusHudCfg` 的扁平旧键映射到新结构，`cfg.states` 里没有的项才补，然后 `saveCfg()`：

```js
if (oldCfg && !stored.states) {
  const map = {
    esp: oldCfg.esp, tracers: oldCfg.tracers, nametags: oldCfg.labels !== false,
    itemesp: oldCfg.itemEsp, fullbright: oldCfg.nightVision, ambience: oldCfg.timeWeather,
    hud: oldCfg.hud !== false, gate: oldCfg.bypassGate, clientside: true,
  };
  for (const k in map) if (cfg.states[k] === undefined) cfg.states[k] = !!map[k];
  if (oldCfg.espDist) cfg.settings['esp.distance'] = oldCfg.espDist;
  // ... servers / serverIdx / mcAddr / mcName / hud.* 若干项
  saveCfg();
}
```

Java 版如果打算兼容旧网页版导出的配置，可以留一个 `migrateLegacy(JsonObject)`；纯新工程可以直接不做，但**「缺字段用默认值」的机制必须做**，见 §1.4。

### 1.3 `getS` 的默认值回退与 `__sCache`

这是整套配置最核心的 40 行（805–831）：

```js
let __sCache = null;
function getS(mid, sid) {
  const k = mid + '.' + sid;
  if (__sCache && k in __sCache) return __sCache[k];       // 帧内缓存命中
  let v;
  if (cfg.settings[k] !== undefined) v = cfg.settings[k];   // 用户存过的值优先
  else {
    const m = MODS_BY_ID[mid];
    const d = m && m.settings && m.settings.find((s) => s.id === sid);
    if (!d) return undefined;                               // 未知设置项
    v = typeof d.value === 'function' ? d.value() : d.value; // 回退到注册时的默认值
  }
  if (__sCache) __sCache[k] = v;
  return v;
}
function setS(mid, sid, v) {
  cfg.settings[mid + '.' + sid] = v;
  __sCache = null;          // 立即失效
  saveCfg();
  afterSetting(mid, sid, v);
}
function modOn(id) { return !!cfg.states[id]; }
function toggleModule(m) {
  cfg.states[m.id] = !cfg.states[m.id];
  saveCfg();
  afterToggle(m);
}
```

三条语义要照搬：

1. **用户值 > 注册默认值 > undefined**。`getS` 从不把默认值写回 `cfg.settings`，只在内存里回退。好处是升级默认值后老用户会自动跟上。Java 侧别在 `load()` 里把默认值灌进 `settings` Map。
2. **`value` 可以是函数**。`server.server` 的选项读 `cfg.servers`，`mc18.addr` / `mc18.name` 的初值读 `cfg.mcAddr` / `cfg.mcName`（728、738–739 行）。Java 侧用 `Supplier<T>` 表达动态默认值。
3. **`__sCache` 是帧级缓存**，不是永久缓存。生命周期在 `onFrame`（3101–3111）：

```js
function onFrame(alpha) {
  __sCache = {};            // 每帧开头清空
  try {
    applyXrayWorld(...);
    espFrame.alpha = alpha;
    tickModules();          // 一帧里几百次 getS，全部命中缓存
    espFrame();
    updateMotionBlur(state.player);
  } finally { __sCache = null; }   // 帧尾彻底失效，避免跨帧读到脏值
}
```

另外 `setS`、`restoreAppearance`（1927）、`applyAppearancePreset`（1937）都会手动 `__sCache = null`。**Java 侧的对应做法**：`Module` 提供 `get(sid)` 走 `ModConfig.get(...)`，在 `CometTick.onEndTick` 开头调 `ModConfig.beginFrame()` 生成一帧的不可变快照（或者干脆用 `ConcurrentHashMap` 缓存 + 帧尾 `clear()`），别每帧几百次做 Map 查找 + JSON 解析。最省事的实现是：

```java
// ModConfig 里：帧内缓存，语义对齐 __sCache
private static final Map<String, Object> FRAME_CACHE = new HashMap<>();
public static void beginFrame() { FRAME_CACHE.clear(); }
public static void endFrame()   { FRAME_CACHE.clear(); }
```

`CometTick.onEndTick` 用 `try/finally` 包住分发，对应源码 `onFrame` 的结构。**别把 `__sCache` 做成永久缓存**——`setS` 之后必须立刻能读到新值，否则调完设置界面数值不动。

### 1.4 副作用链

值变了要触发一堆联动（834–863）：

```js
function afterToggle(m) {
  if (m.id === 'gate') applyGate();
  if (m.id === 'server') applyServer();
  notify(m.cn || m.name, modOn(m.id) ? '已开启' : '已关闭');
  refreshGui();
  refreshHud();
}
function afterSetting(mid, sid, v) {
  if (mid === 'server' && sid === 'server') { /* 切服务器 */ }
  if (mid === 'gate') applyGate();
  if (mid === 'mc18' && sid === 'addr') cfg.mcAddr = v;
  if (mid === 'mc18' && sid === 'name') cfg.mcName = v;
  if (mid === 'hud') refreshHud();
  if (mid === 'appearance') {
    if (sid === 'preset') {
      if (v === '自定义') restoreAppearance();
      else {
        if (__lastPreset === '自定义') saveAppearanceSnapshot();
        applyAppearancePreset(v);
      }
    } else {
      if (String(getS('appearance', 'preset') || '') === '自定义') saveAppearanceSnapshot();
      applyAppearance();
    }
  }
}
```

Java 侧不要照抄这一长串 `if`——把「设置变更」做成事件：`ModConfig` 在 `setS` 后发 `SettingChangedEvent(mid, sid, value)`，各模块自己订阅（外观模块订阅 `appearance.*`，HUD 模块订阅 `hud.*`）。这样 100 个模块的联动不会挤在一个方法里。`07` 的 `ModuleRegistry` 里给一个简易发布/订阅即可（见 §7.3）。

---

## 2. 设置类型体系

### 2.1 源码实际是 7 种 + 1 套独立键位

任务口径写的是 8 种（`checkbox/slider/select/color/text/button/multi/hotkey`）。核对源码后有个偏差要记下来：`extSelfTest()`（6983 行）里的白名单是

```js
const allowed = ['slider', 'checkbox', 'select', 'multi', 'color', 'text', 'button'];
```

**只有 7 种**。`hotkey` 从来不是 `settings[]` 的 `type`——765 行 `floatgui.hotkey` 写的是 `type: 'button'`，点它触发「按键中…」状态；真正的键位绑定是 `cfg.binds` + `bindingModule` + `onKeyDown`（11808–11818）这套独立机制，值存 `KeyboardEvent.code`（如 `KeyP` / `Backquote`），根本不进 `cfg.settings`。

所以 Java 侧按「7 种设置类型 + 1 类键位字段」设计。下面映射表按 8 行给全，最后一行注明它的独立来源。

| # | JS `type` | 源码实例 | JS 值类型 | Java 字段 / 存储 | Cloth Config 控件 | 备注 |
|---|---|---|---|---|---|---|
| 1 | `checkbox` | `aura.players`（301）、`hud.watermark`（493） | boolean | `boolean` / `Map<String,JsonElement>` | `startBooleanToggle(Text, boolean)` | 最常用；`.setDefaultValue(...)` 传注册默认值 |
| 2 | `slider` | `aura.range`（299，`min:2 max:6 step:0.1`）、`perf.fxQuality`（530，`step:0.1`） | number（含小数） | `double`（内部按 double 存） | `startDoubleSlider(Text, double, double, double)` 或退化成 `startIntSlider` ×100 | 必须保留 `min/max/step`，`extSelfTest` 会校验 `min < max` |
| 3 | `select` | `aura.ringMode`（314，17 个几何图案）、`appearance.preset`（511） | string | `String` | `startStringDropdownMenu(Text, String, ...)` / `startDropdownMenu` | `options` 可以是**函数**（`server.server` 的 `options: () => cfg.servers.map(...)`，728 行），Java 侧用 `Supplier<List<String>>` |
| 4 | `color` | `aura.ringColor`（313）、`containeresp.f_chest`（680，默认 `#ffc857`） | string（`#rrggbb`，空串 = 用默认色） | `int`（0xRRGGBB）+ `boolean useDefault` | `startColorField(Text, int)` | 空串语义是「留空 = 主题色」，别解析成 0；Java 侧用 `OptionalInt` 或 `-1` 表示 |
| 5 | `text` | `nametags.alias`（466，`placeholder`）、`blockesp.target`（551） | string | `String` | `startStrField(Text, String)` | `value` 可以是函数（`mc18.addr` 读 `cfg.mcAddr`）；`placeholder` 用 `.setTooltip(...)` 表达 |
| 6 | `button` | `waypoints.add`（586）、`cfgreset.export`（754）、`floatgui.hotkey`（775） | 无值（只触发动作） | 无字段，只有回调 | `startTextDescription(Text)` 或自定义 `ActionButtonEntry`（Cloth Config 无原生 button entry） | 点击后跑副作用；`cfgreset` 三个按钮对应导出 / 导入 / 重置 |
| 7 | `multi` | `aura.targets`（303，`options` 23 种生物，`value: []`） | string[] | `List<String>` | `startStrList(Text, List<String>)`（多选列表）；或 `startSubCategory` 里放一堆 booleanToggle | 「留空 = 默认（敌对生物 + 玩家）」是业务语义，别在控件层硬编码 |
| 8 | `hotkey`（独立体系） | `cfg.binds['esp'] = 'KeyP'`；`cfg.guiKey = 'Backquote'` | string（`KeyboardEvent.code`） | `Map<String,String> binds` + `String guiKey` | `startKeyCodeField` / 自定义 `KeyCaptureScreen` | 不进 `settings[]`；`keyName()`（10456）负责显示名映射（`ShiftLeft` → `LShift`） |

### 2.2 设置描述对象 → `SettingSpec`

源码每个设置项就是一个字面量：`{ id, name, cn, type, value, min, max, step, options, desc, placeholder }`。`name` 是英文、`cn` 是中文、`desc` 是说明、`value` 是默认值（可为函数）。Java 侧用一个泛型描述类把这些都装下：

```java
package com.bigpixel.comet.module;

import net.minecraft.text.Text;
import java.util.List;
import java.util.function.Supplier;

/** 对应源码 settings[] 里的单个字面量（如 299 行 aura.range）。 */
public final class SettingSpec<T> {

    public enum Kind { CHECKBOX, SLIDER, SELECT, COLOR, TEXT, BUTTON, MULTI, HOTKEY }

    private final String id;
    private final String name;          // 源码 name（英文）
    private final String cn;            // 源码 cn（中文）
    private final Kind kind;
    private final Supplier<T> defaultValue;   // 对应 value，可为函数
    private final Double min, max, step;     // 仅 slider
    private final Supplier<List<String>> options; // 仅 select / multi，可为函数
    private final String desc;          // 说明
    private final String placeholder;   // 仅 text
    private Runnable onClick;           // 仅 button

    private SettingSpec(String id, String name, String cn, Kind kind, Supplier<T> def,
                        Double min, Double max, Double step, Supplier<List<String>> options,
                        String desc, String placeholder, Runnable onClick) {
        this.id = id; this.name = name; this.cn = cn; this.kind = kind;
        this.defaultValue = def; this.min = min; this.max = max; this.step = step;
        this.options = options; this.desc = desc;
        this.placeholder = placeholder; this.onClick = onClick;
    }

    // ---- 工厂方法，写注册代码时用它，别直接 new ----
    public static SettingSpec<Boolean> checkbox(String id, String cn, boolean def) {
        return new SettingSpec<>(id, id, cn, Kind.CHECKBOX, () -> def,
                null, null, null, null, null, null, null);
    }
    public static SettingSpec<Double> slider(String id, String cn,
                                             double min, double max, double step, double def) {
        return new SettingSpec<>(id, id, cn, Kind.SLIDER, () -> def,
                min, max, step, null, null, null, null);
    }
    public static SettingSpec<String> select(String id, String cn,
                                             Supplier<List<String>> options, String def) {
        return new SettingSpec<>(id, id, cn, Kind.SELECT, () -> def,
                null, null, null, options, null, null, null);
    }
    public static SettingSpec<String> color(String id, String cn, String def) {
        return new SettingSpec<>(id, id, cn, Kind.COLOR, () -> def,
                null, null, null, null, null, null, null);
    }
    public static SettingSpec<String> text(String id, String cn, String def, String placeholder) {
        return new SettingSpec<>(id, id, cn, Kind.TEXT, () -> def,
                null, null, null, null, null, placeholder, null);
    }
    public static SettingSpec<Void> button(String id, String cn, Runnable onClick) {
        return new SettingSpec<>(id, id, cn, Kind.BUTTON, () -> null,
                null, null, null, null, null, null, onClick);
    }
    public static SettingSpec<List<String>> multi(String id, String cn,
                                                  Supplier<List<String>> options, List<String> def) {
        return new SettingSpec<>(id, id, cn, Kind.MULTI, () -> def,
                null, null, null, options, null, null, null);
    }

    public String id()            { return id; }
    public String cn()            { return cn; }
    public Kind kind()            { return kind; }
    public T defaultValue()       { return defaultValue.get(); }   // 每次求值，对齐 value 为函数
    public double min()           { return min == null ? 0 : min; }
    public double max()           { return max == null ? 1 : max; }
    public double step()          { return step == null ? 1 : step; }
    public List<String> options() { return options == null ? List.of() : options.get(); }
    public String desc()          { return desc; }
    public String placeholder()   { return placeholder; }
    public Runnable onClick()     { return onClick; }
    public Text label()           { return Text.literal(cn == null ? name : cn); }

    public boolean valid() {
        if (id == null || id.isEmpty() || cn == null) return false;
        if (kind == Kind.SLIDER && !(min < max)) return false;
        if (kind == Kind.SELECT && options().isEmpty()) return false;
        return true;
    }
}
```

`defaultValue()` 每次调用都重新求值，这是刻意对齐源码 `typeof d.value === 'function' ? d.value() : d.value`——像 `mc18.addr` 这种默认值跟 `cfg.mcAddr` 联动的，必须动态取。

### 2.3 值存取：`ModConfig.get(mid, sid)` 的回退

`getS` 的「用户值 > 注册默认值」在 Java 侧落到 `Module.get(sid)`，实现放在 §7.1 的 `ModConfig` 里。这里先给调用形态，后面各卷写模块时照这个用：

```java
// 模块内部
double range = get("range");                    // 回退到 SettingSpec 默认值
boolean players = get("players");
String mode = get("ringMode");
List<String> targets = get("targets");
```

`get` 是 `Module` 上的泛型方法，内部拼 `"模块id.sid"` 查 `ModConfig.settings`，没有就问自己的 `SettingSpec` 要默认值——和 `getS` 一模一样。

---

## 3. 模块注册与组织

### 3.1 注册、索引、开关初始化

源码两处建立索引（781–783、4741–4745），扩展模块走同一套：

```js
const MODS_BY_ID = {};
for (const m of MODULES) MODS_BY_ID[m.id] = m;
for (const m of MODULES) if (cfg.states[m.id] === undefined) cfg.states[m.id] = !!m.state;

// 每组 EXT_MODULES 追加时重复一遍：
for (const em of EXT_MODULES) {
  MODULES.push(em);
  MODS_BY_ID[em.id] = em;
  if (cfg.states[em.id] === undefined) cfg.states[em.id] = !!em.state;
}
```

`m.state` 是「默认开启」标记，只有 `nametags`（455）、`hud`（491）、`floatgui`（773）三个模块带 `state: true`。其余默认关。**注意顺序**：先建索引再初始化开关，否则 `getS` 回退默认值时找不到模块。

### 3.2 分类、子分类、收藏、搜索

`CATS` 六个分类（286–293）已在 README §2.2 列全。`MODULE_SUB_ORDER`（10516）和 `MODULE_SUBS`（10517–10531）是渲染分类内部的**分组标题**，不是新分类：

```js
const MODULE_SUB_ORDER = ['实体与生物', '世界与方块', '轨迹与引导', '视觉特效', '界面与 HUD', '其它'];
const MODULE_SUBS = {
  esp: '实体与生物', tracers: '实体与生物', nametags: '实体与生物', itemesp: '实体与生物',
  xray: '世界与方块', blockesp: '世界与方块', containeresp: '世界与方块',
  projectile: '轨迹与引导', trail: '轨迹与引导', waypoints: '轨迹与引导',
  hitmarker: '视觉特效', fullbright: '视觉特效', ambience: '视觉特效', mblur: '视觉特效',
  minimap: '界面与 HUD', hud: '界面与 HUD', invhud: '界面与 HUD', drops: '界面与 HUD',
  // ... 共 40 余条，未列出的落 '其它'
};
function moduleSub(m) { return MODULE_SUBS[m.id] || '其它'; }
function sortedModules(cat) {
  return MODULES.filter((m) => m.cat === cat).slice().sort((a, b) => {
    const sa = MODULE_SUB_ORDER.indexOf(moduleSub(a)), sb = MODULE_SUB_ORDER.indexOf(moduleSub(b));
    if (sa !== sb) return sa - sb;
    return (!!cfg.favorites[b.id] - !!cfg.favorites[a.id]) || a.name.localeCompare(b.name);
  });
}
```

排序规则：先子分类序 → 同组内收藏优先 → 再按英文名字母序。`renderModuleList`（10540）在 `grouped` 为真时插入分组标题（`cm-subhdr`），这个开关来自 `getS('appearance', 'group')`（510，默认 true）。

收藏点在 10478–10490：点行内的 ★ 切换 `cfg.favorites[m.id]` 并 `saveCfg()` + 重绘列表。搜索在 10580–10609：按 `name` / `cn` / `desc` / **分类中文名** 做小写 `includes` 匹配，支持左键直接开关、右键跳转分类并选中模块。

`sortedModules` 里 `MODULE_SUBS` 有几条重复 key（如 `chunkborder` 出现两次，10521 和 10530），JS 对象字面量后者覆盖前者——都是 `'世界与方块'`，没实际影响，但移植时别照抄成 Map.put 两次。

### 3.3 键位绑定

四块拼起来：

1. **存储**：`cfg.binds`（`moduleId -> KeyboardEvent.code`）、`cfg.guiKey`（默认 `Backquote`）。
2. **进入绑定态**：中键点模块行（10499–10503）或点设置面板里的「快捷键」行（10800–10817）设 `bindingModule = m`，界面显示「按键中…」。
3. **捕获按键**：`onKeyDown`（11808–11818）在 GUI 打开时优先处理——`Delete` / `Backspace` 清除绑定，其余 `e.code` 直接存进 `cfg.binds`，`saveCfg()` 后刷新界面。
4. **触发**：GUI 关闭时（11827–11832）`MODULES.find(x => cfg.binds[x.id] === e.code)`，命中且非 `e.repeat` 就 `toggleModule(m)`；带 `ctrlKey` / `metaKey` 的不处理，输入框聚焦时不处理。

显示名映射 `keyName`（10456–10465）把 `ShiftLeft → LShift`、`Backquote → \`~\``、去掉 `Key` / `Digit` 前缀。Java 侧用 `InputUtil.Key` + `I18n.translate` 得到本地化名，或直接存 `InputUtil.Key.getTranslationKey()`。

系统快捷键（6506–6511）：悬浮面板 = `cfg.guiKey`、经典面板 = `Ins` / `ScrLk`、大地图 = `M`、关闭 = `Esc`、HUD 编辑 = 配置里的按钮。

### 3.4 主题与外观预设

主题是 `cfg.theme`（`'default'` / `'glass'`），`setTheme`（10255）改值 + `saveCfg()` + `applyTheme()`；`applyTheme`（10238）给 gui / hudStage / 小地图 / 背包 / 大地图 / 掉落面板 / 方块选择 / 音乐面板统一 toggle `glass` class，再同步主题按钮的 `on` 态。`glass` 的视觉差异全在 CSS（9374–9493 的 `backdrop-filter`），Java 侧对应 04 卷的模糊管线开关。

外观预设更绕一点（1878–1942）：

```js
const APPEARANCE_PRESETS = {
  '绚丽': { accent:'#b06bff', glow:14, blur:18, radius:14, anim:1.3, saturate:1.5, bg:'#10121c', border:0.75 },
  '平缓': { accent:'#6f9bd1', glow:5,  blur:8,  radius:9,  anim:0.6, saturate:1.05,bg:'#141821', border:0.45 },
  '基本': { accent:'#8a8f99', glow:0,  blur:0,  radius:4,  anim:0,   saturate:0.8, bg:'#0d1016', border:0.25 },
};
const APPEARANCE_KEYS = ['accent','glow','blur','radius','anim','saturate','bg','border'];
let __lastPreset = '绚丽';

function applyAppearance() {   // 1893，把值写进 CSS 变量 --cm-*
  const preset = String(gs2('preset') || '绚丽');
  const p = APPEARANCE_PRESETS[preset] || APPEARANCE_PRESETS['绚丽'];
  const val = (k) => { const v = gs2(k); return v == null || v === '' ? p[k] : v; };
  root.style.setProperty('--cm-accent', accent);   // 逐个写 8 个变量
  gui.classList.toggle('fancy', preset === '绚丽');
  gui.classList.toggle('plain', preset === '基本');
  __lastPreset = preset;
}
function saveAppearanceSnapshot() {          // 1913
  if (!cfg.appearance) cfg.appearance = {};
  const snap = {};
  for (const k of APPEARANCE_KEYS) snap[k] = getS('appearance', k);
  cfg.appearance.snapshot = snap;
  saveCfg();
}
function restoreAppearance() {               // 1920
  const snap = cfg.appearance.snapshot;
  if (!snap) { saveAppearanceSnapshot(); applyAppearance(); return; }
  for (const k of APPEARANCE_KEYS) {
    if (snap[k] !== undefined) cfg.settings['appearance.' + k] = snap[k];
  }
  __sCache = null; saveCfg(); applyAppearance(); refreshGui();
  pushNotification('外观设置', '已还原你之前的自定义外观');
}
function applyAppearancePreset(name) {       // 1933
  const p = APPEARANCE_PRESETS[name]; if (!p) return;
  for (const k of APPEARANCE_KEYS) cfg.settings['appearance.' + k] = p[k];
  __sCache = null; saveCfg(); applyAppearance(); refreshGui();
}
```

配合 `afterSetting`（851–862）的状态机：

- 选「自定义」→ `restoreAppearance()`，把上次快照填回 8 个设置项。
- 从「自定义」切到别的档 → 先 `saveAppearanceSnapshot()` 保住自定义值，再 `applyAppearancePreset()`。
- 在「自定义」档下调任意一项 → 每次都 `saveAppearanceSnapshot()`，保证快照始终是最新的自定义值。

这里有个反直觉但正确的做法：**快照存 `cfg.appearance.snapshot`，8 个设置值仍存 `cfg.settings['appearance.*']`**，两份数据、一份是备份。Java 侧别把快照和当前值合并成一个对象，否则「切预设再切回自定义」就丢值了。

性能档 `perfLevel`（1943–1952）单独一提：`'自动'` 时按 `state.game.fps` 阈值降级（<25 省电 / <45 均衡 / 其余绚丽），`perfGlow()` 只在「绚丽且没勾 noGlow」时开辉光。Java 侧用 `MinecraftClient.getInstance().getCurrentFps()`（或自己按帧间隔算）驱动同一套档位，02 卷的粒子 / 辉光、08 卷的性能预算都读它。

---

## 4. `.opuscfg` 备份格式

### 4.1 源码（11145–11229）

格式极简：第一行魔数 `OPUSCFG1`，第二行是 UTF-8 JSON 的 base64。

```js
const CFG_KEYS = ['states','settings','binds','favorites','hudPos','guiOffset',
  'floatPos','theme','servers','serverIdx','mcAddr','mcName','guiKey',
  'waypoints','minmapPos','invPos','mapOpts','appearance','ext','extPos',
  'dropsPos','musicPos','fpsGraphPos','extFold'];

function b64enc(s) { return W.btoa(unescape(encodeURIComponent(s))); }
function b64dec(s) { return decodeURIComponent(escape(W.atob(s))); }

function buildBackup() {
  const data = {};
  for (const k of CFG_KEYS) if (cfg[k] !== undefined) data[k] = cfg[k];
  const payload = {
    app: 'OpusMC-Comet', format: 'opuscfg', version: VERSION,
    savedAt: new Date().toISOString(), data,
  };
  const b = b64enc(JSON.stringify(payload));
  return b ? 'OPUSCFG1\n' + b + '\n' : null;
}
function parseBackup(txt) {
  const s = String(txt || '');
  const nl = s.indexOf('\n');
  if (nl < 0 || s.slice(0, nl).trim() !== 'OPUSCFG1') throw new Error('不是 .opuscfg 备份');
  const json = b64dec(s.slice(nl + 1).replace(/\s/g, ''));   // 去掉所有空白再解
  if (!json) throw new Error('内容无法解码');
  const o = JSON.parse(json);
  if (!o || o.format !== 'opuscfg' || !o.data) throw new Error('格式不正确');
  return o;
}
function applyImported(o) {
  for (const k of CFG_KEYS) if (o.data[k] !== undefined) cfg[k] = o.data[k];
  saveCfg();
  applyTheme(); layoutPanel(); applyHudPos();
  refreshGui(); refreshHud();
  pushNotification('配置备份', '已导入 ' + (o.version || '?') + ' 的配置');
}
```

导出走 `Blob` + `<a download>` 下载（失败则复制 base64 到剪贴板），导入走 `<input type="file">` + `FileReader`；文件名 `opus-comet-YYYY-MM-DD.opuscfg`。`cfgreset` 模块（751–757）的三个按钮分别挂 `export` / `import` / `reset`，`reset` 会清空 `cfg.binds` / `cfg.favorites` / `cfg.settings` 等（11132 附近）。

要注意 `CFG_KEYS` 里有 `mapOpts`、`extPos`、`fpsGraphPos`、`extFold` 四个字段**不在初始 cfg 字面量里**，是运行时才加的；源码用 `if (cfg[k] !== undefined)` 跳过未定义的。Java 侧 `BackupCodec` 用「按字段名白名单挑 JsonObject 成员」复刻这个行为，别把整个 `ModConfig` 无脑序列化进去（会带上不该导出的运行时字段）。

### 4.2 Java `BackupCodec`

```java
package com.bigpixel.comet.config;

import com.google.gson.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.util.Base64;
import java.util.List;

/** 对应源码 11145–11229：OPUSCFG1 + base64(JSON) 的导入导出。 */
public final class BackupCodec {

    public static final String MAGIC = "OPUSCFG1";
    public static final String APP   = "OpusMC-Comet";

    // 对应 CFG_KEYS：只导出这些顶层字段；缺的字段跳过
    private static final List<String> CFG_KEYS = List.of(
            "states", "settings", "binds", "favorites", "hudPos", "guiOffset",
            "floatPos", "theme", "servers", "serverIdx", "mcAddr", "mcName", "guiKey",
            "waypoints", "minmapPos", "invPos", "mapOpts", "appearance", "ext", "extPos",
            "dropsPos", "musicPos", "fpsGraphPos", "extFold");

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private BackupCodec() {}

    /** 对应 buildBackup()：返回完整 .opuscfg 文本，可直接写文件。 */
    public static String build(ModConfig cfg, String version) {
        JsonObject data = new JsonObject();
        JsonObject full = GSON.toJsonTree(cfg).getAsJsonObject();
        for (String k : CFG_KEYS) {
            if (full.has(k)) data.add(k, full.get(k));   // 对应 cfg[k] !== undefined
        }
        JsonObject payload = new JsonObject();
        payload.addProperty("app", APP);
        payload.addProperty("format", "opuscfg");
        payload.addProperty("version", version);
        payload.addProperty("savedAt", Instant.now().toString());
        payload.add("data", data);

        String json = GSON.toJson(payload);
        // UTF-8 显式编码，对齐 btoa(unescape(encodeURIComponent(s))) 的中文处理
        String b64 = Base64.getEncoder().encodeToString(json.getBytes(StandardCharsets.UTF_8));
        return MAGIC + "\n" + b64 + "\n";
    }

    /** 对应 parseBackup()：校验魔数 / 格式 / data，返回 data 子对象供 applyImported 用。 */
    public static JsonObject parse(String text) throws IOException {
        int nl = text.indexOf('\n');
        if (nl < 0 || !MAGIC.equals(text.substring(0, nl).trim())) {
            throw new IOException("不是 .opuscfg 备份");
        }
        String b64 = text.substring(nl + 1).replaceAll("\\s", "");  // 对应 .replace(/\s/g,'')
        byte[] raw;
        try {
            raw = Base64.getDecoder().decode(b64);
        } catch (IllegalArgumentException e) {
            throw new IOException("内容无法解码", e);
        }
        JsonObject o;
        try {
            o = JsonParser.parseString(new String(raw, StandardCharsets.UTF_8)).getAsJsonObject();
        } catch (JsonParseException | IllegalStateException e) {
            throw new IOException("格式不正确", e);
        }
        if (!o.has("format") || !"opuscfg".equals(o.get("format").getAsString())
                || !o.has("data") || !o.get("data").isJsonObject()) {
            throw new IOException("格式不正确");
        }
        return o;
    }

    /** 对应 applyImported()：白名单字段覆盖到当前配置，再落盘并刷新。 */
    public static void apply(ModConfig cfg, JsonObject parsed) {
        JsonObject data = parsed.getAsJsonObject("data");
        JsonObject cur = GSON.toJsonTree(cfg).getAsJsonObject();
        for (String k : CFG_KEYS) {
            if (data.has(k)) cur.add(k, data.get(k));      // 对应 cfg[k] = o.data[k]
        }
        ModConfig.replaceFrom(cur);                        // 用合并后的树重建 INSTANCE
        ModConfig.save();
        // 调用方接着做：主题重应用、面板布局重建、HUD 位置重算、GUI/HUD 刷新
    }

    public static void exportToFile(ModConfig cfg, String version, Path target) throws IOException {
        // 原子写，对应源码 saveCfg 的"写失败别毁掉内存态"
        Path tmp = target.resolveSibling(target.getFileName() + ".tmp");
        Files.writeString(tmp, build(cfg, version), StandardCharsets.UTF_8);
        Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    public static JsonObject importFromFile(Path source) throws IOException {
        return parse(Files.readString(source, StandardCharsets.UTF_8));
    }
}
```

`ModConfig.replaceFrom(JsonObject)` 是 §7.1 里给的方法：把合并后的 JSON 树反序列化成新实例并替换 `INSTANCE`，顺带触发一次「配置整体变更」通知（对应 `applyImported` 里的 `applyTheme()` / `layoutPanel()` / `applyHudPos()` / `refreshGui()` / `refreshHud()`）。

导入导出在 Cloth Config 里就是两个 `button` 设置项：导出弹系统文件保存对话框（或写到 `gameDir/comet-backup-*.opuscfg` 后通知路径），导入弹文件选择。Fabric 纯客户端没有原生文件选择器，常用做法是先让用户把文件放到固定目录，界面上给「导入」按钮读那个文件；这层 UI 细节归 04 卷。

---

## 5. 自检逻辑

源码有两套检查，别混：

### 5.1 `extSelfTest()`（6963–7017）—— 模块注册自检

帮助中心「模块自检」Tab 调它，输出 `report = { at, version, modules, settings, docs, undocumented, problems }`。逐项检查：

| 检查 | 源码片段 | Java 版落点 |
|---|---|---|
| 模块说明兜底 | 6967–6971：`EXT_MODULE_DOCS` 没写的用 `m.desc` 补 | 每个 `Module` 必须有 `description`，缺省用 id |
| 模块字段完整 | 6973：`!m.id \|\| !m.name \|\| !m.cn \|\| !m.cat` | `Module` 构造器里校验，非 nullable |
| 模块 id 重复 | 6974–6975：`ids` Set | `ModuleRegistry.register` 发现重复直接抛 |
| 索引同步 | 6976：`MODS_BY_ID[m.id] !== m` | `BY_ID` 由 `register` 唯一维护，不需要单独查 |
| 开关已初始化 | 6977：`cfg.states[m.id] === undefined` | `bootstrap()` 后遍历检查（对应 783 行初始化） |
| 设置字段 / id 重复 | 6979–6982：`sids` Set | `SettingSpec.valid()` + 每模块内 Set |
| 设置类型白名单 | 6983–6984：`allowed` 7 种 | `SettingSpec.Kind` 枚举天然保证 |
| slider 范围 | 6985：`!(s.min < s.max)` | `SettingSpec.valid()` |
| select 选项 | 6987–6991：`options` 可为函数，必须非空数组 | `options().isEmpty()` 检查 |
| 分类非空 | 6995–6997：`MODULES.some(m => m.cat === cat.id)` | `BY_CAT` 每个枚举至少一个模块 |
| 函数接线 | 6998–7006：`fns` 表里 17 个渲染 / tick 函数必须存在 | Java 编译期保证，这条可省 |

结果页（7121–7138）：有 `problems` 就列「异常明细」，没有就显示 **`所有模块注册与设置项检查通过`**（7132）。这句是任务里点名要的验收文案，Java 版配置屏幕的「自检」页保留同样的成功提示。

### 5.2 `extHealthCheck()`（6333–6370）—— 配置体检

帮助中心「配置体检」Tab 调它，检查的是**用户数据**而不是注册代码：

| 检查 | 源码 | 说明 |
|---|---|---|
| 设置键格式 | 6336–6341：必须有 `.`，`mid` 必须是已知模块，`sid` 必须是该模块已注册设置 | 清理老版本残留的 `settings` 键 |
| 未知模块键位 | 6345–6347：`cfg.binds` 的 key 必须在 `MODS_BY_ID` | 模块删了键位要能报出来 |
| waypoints 是数组 + 坐标是数字 | 6348–6355 | 脏路径点 |
| 面板位置是 `{x,y}` 数字 | 6356–6359：`invPos` / `dropsPos` / `minmapPos` / `musicPos` / `extPos` / `fpsGraphPos` | 拖拽写坏的位置 |
| `cfg.ext` 结构 | 6360–6364：`coords` 数组 / `profiles` 对象 | 扩展数据 |

结果页（6519–6534）：`配置看起来一切正常` 或列出「需要处理」。导出 `report = { version, at, modules, settings, binds, waypoints, ... }`（6365 起，后半段我读到 6370，report 字段到 `waypoints` 为止，后面还有 coords / profiles / issues）。

Java 版把两者合成一个 `ModuleRegistry.selfTest()`（见 §7.3），返回 `List<String> problems`，配置屏幕加一页显示。

---

## 6. 完整 Java 骨架

下面四段是可以直接落进 `src/main/java` 的代码。包名和 README §3.1 的目录树一致。

### 6.1 `ModConfig.java`（Gson + 嵌套 POJO）

```java
package com.bigpixel.comet.config;

import com.bigpixel.comet.module.ModuleRegistry;
import com.bigpixel.comet.module.SettingSpec;
import com.google.gson.*;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** 对应源码 106–131 的 cfg + saveCfg。单例，纯客户端。 */
public final class ModConfig {

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Path FILE =
            FabricLoader.getInstance().getConfigDir().resolve("comet.json");
    private static volatile ModConfig INSTANCE;

    // ---- 顶层字段，逐条对齐 cfg 字面量（106–127） ----
    public Map<String, Boolean>       states      = new HashMap<>();
    public Map<String, JsonElement>   settings    = new HashMap<>();
    public Map<String, String>        binds       = new HashMap<>();
    public Map<String, Boolean>       favorites   = new HashMap<>();
    public Map<String, Vec2>          hudPos      = new HashMap<>();
    public Vec2                       guiOffset   = new Vec2(0, 0);
    public String                     theme       = "default";
    public List<ServerEntry>          servers     = new ArrayList<>();
    public int                        serverIdx   = 0;
    public String                     mcAddr      = "ws://localhost:25565";
    public String                     mcName      = "WebPlayer";
    public Map<String, Vec2>          floatPos    = new HashMap<>();
    public String                     guiKey      = "Backquote";
    public List<Waypoint>             waypoints   = new ArrayList<>();
    public Vec2                       minmapPos   = new Vec2(16, 16);
    public Vec2                       invPos      = new Vec2(16, 16);
    public Vec2                       dropsPos    = new Vec2(16, 210);
    public Vec2                       musicPos    = new Vec2(16, 16);
    public Appearance                 appearance  = new Appearance();
    public ExtData                    ext         = new ExtData();
    // 源码 CFG_KEYS 里运行时才出现的 4 个字段，Java 里显式声明，备份时才有得存
    public JsonObject                 mapOpts     = new JsonObject();
    public Vec2                       extPos      = new Vec2(16, 16);
    public Vec2                       fpsGraphPos = new Vec2(16, 16);
    public boolean                    extFold     = false;

    private ModConfig() {}

    // ---- 嵌套 POJO ----
    public static final class Vec2 {
        public int x, y;
        public Vec2() { this(0, 0); }
        public Vec2(int x, int y) { this.x = x; this.y = y; }
    }
    public static final class ServerEntry {
        public String name, url;
        public ServerEntry() {}
        public ServerEntry(String name, String url) { this.name = name; this.url = url; }
    }
    public static final class Waypoint {
        public String name;
        public double x, y, z;
        public int color;          // 0 表示用默认色，对应 color 设置「留空」
        public Waypoint() {}
        public Waypoint(String name, double x, double y, double z) {
            this.name = name; this.x = x; this.y = y; this.z = z;
        }
    }
    /** 对应 cfg.appearance：只存快照，8 个当前值仍在 settings["appearance.*"]。 */
    public static final class Appearance {
        public Map<String, JsonElement> snapshot = new HashMap<>();
    }
    /** 对应 cfg.ext 的默认值 {coords:[],profiles:{},macros:[],stats:null}（126 行）。 */
    public static final class ExtData {
        public List<Waypoint>            coords   = new ArrayList<>();
        public Map<String, JsonElement>  profiles = new HashMap<>();
        public List<String>              macros   = new ArrayList<>();
        public JsonElement               stats    = JsonNull.INSTANCE;
    }

    // ---- 默认值：createDefault 是唯一定义默认的地方 ----
    private static ModConfig createDefault() {
        ModConfig c = new ModConfig();
        c.servers.add(new ServerEntry("官方", "https://xz.honghemc.cn:8443"));
        return c;
    }

    /**
     * 对应源码 106–127 那串 `stored.x || 默认`。
     * 关键点：Gson 反序列化走 UnsafeAllocator，字段初始化器不会执行，
     * 所以必须"先用完整默认树、再按顶层字段整体覆盖 saved"，
     * 否则老配置缺的新字段会变成 null 而不是默认值。
     */
    public static ModConfig load() {
        JsonObject base = GSON.toJsonTree(createDefault()).getAsJsonObject();
        try {
            if (Files.exists(FILE)) {
                JsonObject saved = JsonParser
                        .parseString(Files.readString(FILE, StandardCharsets.UTF_8))
                        .getAsJsonObject();
                // 顶层字段整体替换；saved 没有的字段保留默认。对齐 stored.x || 默认
                for (Map.Entry<String, JsonElement> e : saved.entrySet()) {
                    base.add(e.getKey(), e.getValue());
                }
            }
        } catch (IOException | JsonParseException | IllegalStateException e) {
            // 对应 saveCfg 的静默兜底：读坏了用内存默认值，不让 mod 起不来
            System.err.println("[comet] 配置读取失败，使用默认值: " + e.getMessage());
        }
        INSTANCE = GSON.fromJson(base, ModConfig.class);
        sanitize(INSTANCE);
        return INSTANCE;
    }

    /** 对应 theme 白名单、waypoints 数组校验（113、120 行）。 */
    private static void sanitize(ModConfig c) {
        if (!"glass".equals(c.theme)) c.theme = "default";
        if (c.states == null)    c.states    = new HashMap<>();
        if (c.settings == null)  c.settings  = new HashMap<>();
        if (c.binds == null)     c.binds     = new HashMap<>();
        if (c.favorites == null) c.favorites = new HashMap<>();
        if (c.waypoints == null) c.waypoints = new ArrayList<>();
        if (c.appearance == null) c.appearance = new Appearance();
        if (c.ext == null)        c.ext        = new ExtData();
    }

    public static ModConfig get() {
        return INSTANCE != null ? INSTANCE : load();
    }

    /** 对应 BackupCodec.apply 里的"用合并树重建实例"。 */
    public static void replaceFrom(JsonObject merged) {
        INSTANCE = GSON.fromJson(merged, ModConfig.class);
        sanitize(INSTANCE);
        ModuleRegistry.onConfigReplaced();   // 对应 applyImported 的 applyTheme/layoutPanel/refresh*
    }

    public static void save() {
        try {
            Path tmp = FILE.resolveSibling(FILE.getFileName() + ".tmp");
            Files.createDirectories(FILE.getParent());
            Files.writeString(tmp, GSON.toJson(get()), StandardCharsets.UTF_8);
            Files.move(tmp, FILE, StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            System.err.println("[comet] 配置写入失败（内存态保留）: " + e.getMessage());
        }
    }

    // ---- getS / setS / modOn / toggleModule 的 Java 对应 ----

    /** 帧内缓存，语义对齐 __sCache（805、3102、3110）。 */
    private static final Map<String, Object> FRAME_CACHE = new HashMap<>();
    public static void beginFrame() { FRAME_CACHE.clear(); }
    public static void endFrame()   { FRAME_CACHE.clear(); }

    /**
     * 对应 getS(mid, sid)：用户值 > 注册默认值 > null。
     * 默认值由 ModuleRegistry 按 mid/sid 问对应 SettingSpec 要。
     */
    @SuppressWarnings("unchecked")
    public static <T> T get(String mid, String sid) {
        String key = mid + "." + sid;                 // 对应 k = mid + '.' + sid
        if (FRAME_CACHE.containsKey(key)) return (T) FRAME_CACHE.get(key);
        Object v = null;
        JsonElement stored = get().settings.get(key);
        if (stored != null && !stored.isJsonNull()) {
            v = fromJson(stored);                    // 用户存过的值
        } else {
            SettingSpec<?> spec = ModuleRegistry.setting(mid, sid);
            if (spec != null) v = spec.defaultValue();  // 回退默认值（可能为函数求值）
        }
        FRAME_CACHE.put(key, v);
        return (T) v;
    }

    private static Object fromJson(JsonElement e) {
        if (e.isJsonPrimitive()) {
            JsonPrimitive p = e.getAsJsonPrimitive();
            if (p.isBoolean()) return p.getAsBoolean();
            if (p.isNumber())  return p.getAsDouble();   // slider 一律按 double
            return p.getAsString();                      // color / text / select
        }
        if (e.isJsonArray()) {
            List<String> out = new ArrayList<>();
            for (JsonElement x : e.getAsJsonArray()) out.add(x.getAsString());  // multi
            return out;
        }
        return null;
    }

    private static JsonElement toJson(Object v) {
        if (v == null) return JsonNull.INSTANCE;
        if (v instanceof Boolean b) return new JsonPrimitive(b);
        if (v instanceof Number n) return new JsonPrimitive(n);
        if (v instanceof String s) return new JsonPrimitive(s);
        if (v instanceof List<?> l) {
            JsonArray a = new JsonArray();
            for (Object o : l) a.add(String.valueOf(o));
            return a;
        }
        return GSON.toJsonTree(v);
    }

    /** 对应 setS：写值 → 缓存失效 → 落盘 → 发变更事件。 */
    public static <T> void set(String mid, String sid, T value) {
        get().settings.put(mid + "." + sid, toJson(value));
        FRAME_CACHE.remove(mid + "." + sid);     // 对应 __sCache = null
        save();
        ModuleRegistry.onSettingChanged(mid, sid, value);  // 对应 afterSetting
    }

    public static boolean isOn(String id) {
        return Boolean.TRUE.equals(get().states.get(id));   // 对应 modOn
    }
    public static void setOn(String id, boolean on) {
        get().states.put(id, on);
        save();
        ModuleRegistry.onModuleToggled(id, on);   // 对应 afterToggle
    }
}
```

`ModConfig.load()` 里那段「默认树 + 顶层覆盖」是这一卷最值得抄的一段：它同时解决了 Gson 不跑字段初始化器、老配置缺新字段、`theme` 白名单三件事，而且和源码 `stored.x || 默认` 的语义一一对应。

### 6.2 `Module.java` 基类

```java
package com.bigpixel.comet.module;

import com.bigpixel.comet.config.ModConfig;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.text.Text;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;

import java.util.*;

/** 对应源码 MODULES 数组里的单个模块对象。100 个模块各写一个子类。 */
public abstract class Module {

    private final String id;
    private final String enName;
    private final String cn;
    private final ModuleCategory category;
    private final String description;
    private final String subCategory;          // 对应 MODULE_SUBS，默认「其它」
    private final boolean enabledByDefault;    // 对应 m.state === true
    private final List<SettingSpec<?>> specs = new ArrayList<>();
    private final Map<String, SettingSpec<?>> specIndex = new HashMap<>();

    protected Module(String id, String enName, String cn, ModuleCategory category,
                     String description, String subCategory, boolean enabledByDefault) {
        this.id = Objects.requireNonNull(id);
        this.enName = enName == null ? id : enName;
        this.cn = Objects.requireNonNull(cn);
        this.category = Objects.requireNonNull(category);
        this.description = description == null ? cn : description;
        this.subCategory = subCategory == null ? "其它" : subCategory;
        this.enabledByDefault = enabledByDefault;
    }

    protected <T> SettingSpec<T> spec(SettingSpec<T> s) {
        if (specIndex.containsKey(s.id())) {
            throw new IllegalStateException(id + " 设置 id 重复: " + s.id());
        }
        specs.add(s);
        specIndex.put(s.id(), s);
        return s;
    }

    // ---- 对应 modOn / toggleModule ----
    public final boolean isEnabled() {
        Boolean v = ModConfig.get().states.get(id);
        return v != null ? v : enabledByDefault;
    }
    public final void toggle() { ModConfig.setOn(id, !isEnabled()); }

    // ---- 对应 getS(mid, sid) 的模块内简写 ----
    @SuppressWarnings("unchecked")
    protected final <T> T get(String sid) {
        return (T) ModConfig.get(id, sid);
    }

    // ---- 生命周期钩子，子类按需覆盖 ----
    public void onEnable()  {}
    public void onDisable() {}
    public void onConfigReplaced() {}                       // 对应 applyImported 后的刷新
    public void onSettingChanged(String sid, Object value) {} // 对应 afterSetting 的模块内联动

    /** 对应 tickModules 里每帧的模块逻辑，由 CometTick 分发。 */
    public void tick(MinecraftClient client) {}
    /** 对应 espFrame 里的 3D / 世界绘制，AFTER_ENTITIES 阶段。 */
    public void renderWorld(WorldRenderContext ctx) {}
    /** 对应 HUD 绘制，HudRenderCallback 阶段。 */
    public void renderHud(DrawContext ctx, float tickDelta) {}

    // ---- getters ----
    public String id()                       { return id; }
    public String enName()                   { return enName; }
    public String cn()                       { return cn; }
    public Text label()                      { return Text.literal(cn); }
    public ModuleCategory category()         { return category; }
    public String description()              { return description; }
    public String subCategory()              { return subCategory; }
    public boolean enabledByDefault()        { return enabledByDefault; }
    public List<SettingSpec<?>> settings()   { return Collections.unmodifiableList(specs); }
    public SettingSpec<?> setting(String sid){ return specIndex.get(sid); }
    public boolean valid() {
        if (id.isEmpty() || cn.isEmpty() || category == null) return false;
        for (SettingSpec<?> s : specs) {
            if (!s.valid()) return false;
        }
        return true;
    }
}
```

`ModuleCategory` 就是 `CATS` 的枚举：

```java
package com.bigpixel.comet.module;

/** 对应源码 CATS（286–293），顺序保持与侧栏一致。 */
public enum ModuleCategory {
    COMBAT("combat", "战斗", "⚔"),
    MOVEMENT("movement", "移动", "➤"),
    RENDER("render", "渲染", "◈"),
    PLAYER("player", "玩家", "☺"),
    MISC("misc", "工具", "⚙"),
    CONFIGS("configs", "配置", "⛭", true);   // extra: true

    public final String id, cn, icon;
    public final boolean extra;
    ModuleCategory(String id, String cn, String icon) { this(id, cn, icon, false); }
    ModuleCategory(String id, String cn, String icon, boolean extra) {
        this.id = id; this.cn = cn; this.icon = icon; this.extra = extra;
    }
}
```

### 6.3 `ModuleRegistry.java`

```java
package com.bigpixel.comet.module;

import com.bigpixel.comet.config.ModConfig;
import net.minecraft.text.Text;

import java.util.*;

/** 对应 MODULES / MODS_BY_ID / sortedModules / extSelfTest / onKeyDown 的键位查表。 */
public final class ModuleRegistry {

    /** 对应 MODULE_SUB_ORDER（10516）。 */
    public static final List<String> SUB_ORDER = List.of(
            "实体与生物", "世界与方块", "轨迹与引导", "视觉特效", "界面与 HUD", "其它");

    private static final LinkedHashMap<String, Module> BY_ID = new LinkedHashMap<>();
    private static final EnumMap<ModuleCategory, List<Module>> BY_CAT =
            new EnumMap<>(ModuleCategory.class);
    private static final Map<String, List<Listener>> LISTENERS = new HashMap<>();

    private ModuleRegistry() {}

    public interface Listener {
        void onSettingChanged(String mid, String sid, Object value);
    }
    public static void subscribe(String mid, Listener l) {
        LISTENERS.computeIfAbsent(mid, k -> new ArrayList<>()).add(l);
    }

    /**
     * 对应 781–783 + 五组 EXT_MODULES 的 push 循环 + about。
     * 100 个模块在这里全部注册；顺序影响侧栏默认顺序。
     */
    public static void bootstrap() {
        // 主表 50 个（README §2.3），扩展 50 个（README §2.4）逐个 register(...)
        // 例：
        // register(new AuraModule());
        // register(new EspModule());
        // ...
        // register(new CrosshairModule());   // 扩展 B 组，别漏
        // register(new AboutModule());      // 7429 行单独 push
        finish();
    }

    /** 对应 MODS_BY_ID[m.id] = m + cfg.states 初始化。 */
    public static void register(Module m) {
        if (BY_ID.putIfAbsent(m.id(), m) != null) {
            throw new IllegalStateException("模块 id 重复: " + m.id());   // 对应 6974
        }
        BY_CAT.computeIfAbsent(m.category(), k -> new ArrayList<>()).add(m);
    }

    private static void finish() {
        // 对应 783 行：没显式存过的开关用 m.state 初始化
        Map<String, Boolean> states = ModConfig.get().states;
        for (Module m : BY_ID.values()) {
            states.putIfAbsent(m.id(), m.enabledByDefault());
        }
        selfTest();      // 对应 extSelfTest 在启动时跑一遍
    }

    public static Module byId(String id)          { return BY_ID.get(id); }
    public static Collection<Module> all()        { return BY_ID.values(); }
    public static SettingSpec<?> setting(String mid, String sid) {
        Module m = BY_ID.get(mid);
        return m == null ? null : m.setting(sid);
    }

    /**
     * 对应源码 ArrayList 绘制（11672–11673）与 06 卷 §2.5 的 enabledNames()：
     * 已启用模块中文名，按字符串长度倒序。基于 BY_ID 全量（100 个，含五组 EXT 追加），
     * 不要手写 if 链只列主表几个模块。06 卷 §2.5 那个同名薄封装类应删除，统一走这里。
     */
    public static List<String> enabledNames() {
        List<String> out = new ArrayList<>();
        for (Module m : BY_ID.values()) {
            if (m.isEnabled()) out.add(m.cn());
        }
        out.sort((a, b) -> b.length() - a.length());   // 对应 11673
        return out;
    }

    /** 对应 sortedModules（10533）：子分类序 → 收藏 → 英文名字母序。 */
    public static List<Module> sorted(ModuleCategory cat) {
        List<Module> out = new ArrayList<>(BY_CAT.getOrDefault(cat, List.of()));
        Map<String, Boolean> fav = ModConfig.get().favorites;
        out.sort(Comparator
                .comparingInt((Module m) -> {
                    int i = SUB_ORDER.indexOf(m.subCategory());
                    return i < 0 ? SUB_ORDER.size() : i;      // 对应 moduleSub 落「其它」
                })
                .thenComparing((Module m) -> Boolean.TRUE.equals(fav.get(m.id())) ? 0 : 1)
                .thenComparing(Module::enName));
        return out;
    }

    /** 对应 renderSearchResults（10580）：name / cn / desc / 分类中文名 小写匹配。 */
    public static List<Module> search(String query) {
        String q = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        if (q.isEmpty()) return new ArrayList<>(BY_ID.values());
        List<Module> out = new ArrayList<>();
        for (Module m : BY_ID.values()) {
            if (m.enName().toLowerCase(Locale.ROOT).contains(q)
                    || m.cn().contains(q)
                    || m.description().toLowerCase(Locale.ROOT).contains(q)
                    || m.category().cn.contains(q)) {
                out.add(m);
            }
        }
        return out;
    }

    /** 对应 onKeyDown 11827：按 cfg.binds 反查模块并切换。 */
    public static Module byBind(String keyCode) {
        for (Map.Entry<String, String> e : ModConfig.get().binds.entrySet()) {
            if (Objects.equals(e.getValue(), keyCode)) return BY_ID.get(e.getKey());
        }
        return null;
    }

    // ---- 变更分发：对应 afterToggle / afterSetting ----
    public static void onModuleToggled(String id, boolean on) {
        Module m = BY_ID.get(id);
        if (m == null) return;
        if (on) m.onEnable(); else m.onDisable();
        // 通知 + refreshGui + refreshHud 由 HUD / GUI 层订阅，见 06 卷
    }
    public static void onSettingChanged(String mid, String sid, Object value) {
        Module m = BY_ID.get(mid);
        if (m != null) m.onSettingChanged(sid, value);
        for (Listener l : LISTENERS.getOrDefault(mid, List.of())) {
            l.onSettingChanged(mid, sid, value);
        }
    }
    public static void onConfigReplaced() {
        for (Module m : BY_ID.values()) m.onConfigReplaced();   // 对应 applyImported 的全量刷新
    }

    /** 对应 extSelfTest（6963–7017）+ extHealthCheck（6333–6370），返回问题列表。 */
    public static List<String> selfTest() {
        List<String> problems = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        for (Module m : BY_ID.values()) {
            if (!m.valid()) problems.add("模块字段/设置异常: " + m.id());
            if (!ids.add(m.id())) problems.add("模块 id 重复: " + m.id());
            if (ModConfig.get().states.get(m.id()) == null) {
                problems.add("开关未初始化: " + m.id());
            }
            Set<String> sids = new HashSet<>();
            for (SettingSpec<?> s : m.settings()) {
                if (!sids.add(s.id())) problems.add("设置 id 重复: " + m.id() + "." + s.id());
            }
        }
        for (ModuleCategory c : ModuleCategory.values()) {
            if (BY_CAT.getOrDefault(c, List.of()).isEmpty()) {
                problems.add("分类下无模块: " + c.cn);
            }
        }
        // 配置体检：未知设置键 / 未知模块键位 / 路径点 / 面板位置
        for (String key : ModConfig.get().settings.keySet()) {
            int dot = key.indexOf('.');
            if (dot < 0) { problems.add("设置键格式异常: " + key); continue; }
            if (setting(key.substring(0, dot), key.substring(dot + 1)) == null) {
                problems.add("未知设置项: " + key);
            }
        }
        for (String id : ModConfig.get().binds.keySet()) {
            if (!BY_ID.containsKey(id)) problems.add("未知模块的键位: " + id);
        }
        return problems;   // 空列表 = 帮助中心显示「所有模块注册与设置项检查通过」
    }
}
```

`bootstrap()` 里 100 个 `register(...)` 是体力活，但**必须一个不少**——README §2.3 / §2.4 两张表就是清单。`selfTest()` 在 `finish()` 里跑一次，启动时若有重复 id / 缺开关会立刻在日志里显形，对应源码帮助中心自检 Tab 的 `problems`。

### 6.4 `ConfigScreen.java`（Cloth Config 骨架）

```java
package com.bigpixel.comet.config;

import com.bigpixel.comet.module.*;
import me.shedaniel.clothconfig2.api.*;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;

import java.util.*;

/** 对应源码手写的 DOM 设置面板：分类侧栏 + 模块列表 + 设置行。 */
public final class ConfigScreen {

    private ConfigScreen() {}

    public static Screen create(Screen parent) {
        ModConfig cfg = ModConfig.get();
        ConfigBuilder builder = ConfigBuilder.create()
                .setParentScreen(parent)
                .setTitle(Text.literal("Comet Client · 配置"));
        ConfigEntryBuilder eb = builder.entryBuilder();

        // 每个分类一个 ConfigCategory，对应 CATS 侧栏
        for (ModuleCategory cat : ModuleCategory.values()) {
            ConfigCategory cc = builder.getOrCreateCategory(Text.literal(cat.icon + " " + cat.cn));
            // 按 sortedModules 的顺序：子分类 → 收藏 → 名称
            String lastSub = null;
            boolean group = Boolean.TRUE.equals(ModConfig.get("appearance", "group"));
            for (Module m : ModuleRegistry.sorted(cat)) {
                if (group && !Objects.equals(lastSub, m.subCategory())) {
                    cc.addEntry(eb.startTextDescription(Text.literal("— " + m.subCategory() + " —"))
                            .build());                       // 对应 cm-subhdr 分组标题
                    lastSub = m.subCategory();
                }
                // 模块开关（对应 cfg.states）
                cc.addEntry(eb.startBooleanToggle(m.label(), m.isEnabled())
                        .setDefaultValue(m.enabledByDefault())
                        .setTooltip(Text.literal(m.description()))
                        .setSaveConsumer(v -> ModConfig.setOn(m.id(), v))
                        .build());
                // 模块键位（对应 cfg.binds，见 §6.5）
                if (cat != ModuleCategory.CONFIGS) {
                    KeyBindings.addEntry(cc, eb, m);
                }
                // 该模块的设置项
                for (SettingSpec<?> s : m.settings()) {
                    addSetting(cc, eb, m, s);
                }
            }
        }

        // 自检页：对应帮助中心「模块自检 / 配置体检」两个 Tab
        ConfigCategory diag = builder.getOrCreateCategory(Text.literal("⛭ 自检"));
        List<String> problems = ModuleRegistry.selfTest();
        diag.addEntry(eb.startTextDescription(Text.literal(problems.isEmpty()
                ? "所有模块注册与设置项检查通过"
                : "异常 " + problems.size() + " 项：" + String.join(" / ", problems)))
                .build());

        // 备份页：对应 cfgreset 的三个按钮
        ConfigCategory backup = builder.getOrCreateCategory(Text.literal("⛭ 配置备份"));
        backup.addEntry(eb.startTextDescription(Text.literal("导出 / 导入 .opuscfg（见 BackupCodec）"))
                .build());

        builder.setSavingRunnable(ModConfig::save);   // 对应 saveCfg
        return builder.build();
    }

    /** 8 类设置 → Cloth Config 控件的映射，见 §2.1 表。 */
    private static void addSetting(ConfigCategory cc, ConfigEntryBuilder eb,
                                   Module m, SettingSpec<?> raw) {
        String key = m.id() + "." + raw.id();
        Text label = raw.label();
        switch (raw.kind()) {
            case CHECKBOX -> cc.addEntry(eb
                    .startBooleanToggle(label, boolVal(m, raw))
                    .setDefaultValue((Boolean) raw.defaultValue())
                    .setTooltip(tooltip(raw))
                    .setSaveConsumer(v -> ModConfig.set(m.id(), raw.id(), v))
                    .build());
            case SLIDER -> cc.addEntry(eb
                    // 注：部分 Cloth Config 版本方法名为 startFloatSlider / startDoubleSlider，
                    // 若版本无 double 版，退回 startIntSlider 并把值 ×100 存储。
                    .startDoubleSlider(label, dblVal(m, raw), raw.min(), raw.max())
                    .setDefaultValue((Double) raw.defaultValue())
                    .setTooltip(tooltip(raw))
                    .setSaveConsumer(v -> ModConfig.set(m.id(), raw.id(), v))
                    .build());
            case SELECT -> cc.addEntry(eb
                    .startStringDropdownMenu(label, strVal(m, raw))
                    .setSelections(raw.options())          // 可为动态 Supplier 求值
                    .setDefaultValue((String) raw.defaultValue())
                    .setTooltip(tooltip(raw))
                    .setSaveConsumer(v -> ModConfig.set(m.id(), raw.id(), v))
                    .build());
            case COLOR -> cc.addEntry(eb
                    .startColorField(label, colorVal(m, raw))   // 空串 → 主题色，见 §2.1
                    .setDefaultValue(parseColor((String) raw.defaultValue()))
                    .setTooltip(tooltip(raw))
                    .setSaveConsumer(v -> ModConfig.set(m.id(), raw.id(), toHex(v)))
                    .build());
            case TEXT -> cc.addEntry(eb
                    .startStrField(label, strVal(m, raw))
                    .setDefaultValue((String) raw.defaultValue())
                    .setTooltip(Text.literal(raw.placeholder() == null
                            ? (raw.desc() == null ? "" : raw.desc()) : raw.placeholder()))
                    .setSaveConsumer(v -> ModConfig.set(m.id(), raw.id(), v))
                    .build());
            case MULTI -> cc.addEntry(eb
                    .startStrList(label, listVal(m, raw))     // 对应 multi 的字符串数组
                    .setDefaultValue(castList(raw.defaultValue()))
                    .setTooltip(tooltip(raw))
                    .setSaveConsumer(v -> ModConfig.set(m.id(), raw.id(), v))
                    .build());
            case BUTTON -> {
                // Cloth Config 无原生 button entry；用 textDescription + 自定义点击入口，
                // 或项目里自备一个 ActionButtonEntry extends AbstractConfigListEntry。
                Runnable r = raw.onClick();
                cc.addEntry(eb.startTextDescription(
                        Text.literal(label.getString() + "  「点击执行」")).build());
                if (r != null) r.run();     // 实际工程换成真正的按钮控件，别在构建期就执行
            }
            case HOTKEY -> KeyBindings.addEntry(cc, eb, m);   // 独立键位体系
        }
    }

    // ---- 取值小工具：统一走 ModConfig.get，带默认值回退 ----
    private static boolean boolVal(Module m, SettingSpec<?> s) {
        Object v = ModConfig.get(m.id(), s.id());
        return v instanceof Boolean b ? b : (Boolean) s.defaultValue();
    }
    private static double dblVal(Module m, SettingSpec<?> s) {
        Object v = ModConfig.get(m.id(), s.id());
        return v instanceof Number n ? n.doubleValue() : (Double) s.defaultValue();
    }
    private static String strVal(Module m, SettingSpec<?> s) {
        Object v = ModConfig.get(m.id(), s.id());
        return v instanceof String t ? t : (String) s.defaultValue();
    }
    @SuppressWarnings("unchecked")
    private static List<String> listVal(Module m, SettingSpec<?> s) {
        Object v = ModConfig.get(m.id(), s.id());
        return v instanceof List<?> l ? (List<String>) l
                : (List<String>) s.defaultValue();
    }
    @SuppressWarnings("unchecked")
    private static List<String> castList(Object o) {
        return o instanceof List<?> l ? (List<String>) l : List.of();
    }
    private static int colorVal(Module m, SettingSpec<?> s) {
        Object v = ModConfig.get(m.id(), s.id());
        String hex = v instanceof String t ? t : (String) s.defaultValue();
        return parseColor(hex);
    }
    private static int parseColor(String hex) {
        // 空串 = 用主题默认色（源码「留空 = 彗星紫」），这里给彗星紫 0xB06BFF
        if (hex == null || hex.isEmpty()) return 0xB06BFF;
        try { return Integer.parseInt(hex.replace("#", ""), 16); }
        catch (NumberFormatException e) { return 0xB06BFF; }
    }
    private static String toHex(int rgb) {
        return String.format("#%06x", rgb & 0xFFFFFF);
    }
    private static Text tooltip(SettingSpec<?> s) {
        return Text.literal(s.desc() == null ? "" : s.desc());
    }
}
```

两段免责说明写给实际落地的人：

- `startDoubleSlider` / `startStringDropdownMenu` / `startStrList` / `startColorField` 的**确切方法名随 Cloth Config 版本变**（1.21.1 对应 15.x）。上面给的是语义正确的调用形态，编译时按实际 jar 里 `ConfigEntryBuilder` 的签名调一下即可。别为了对齐文档去改 mod 版本。
- `BUTTON` 那段 `r.run()` 是**占位**：Cloth Config 没有原生按钮 entry，正式实现要写一个 `ActionButtonEntry extends AbstractConfigListEntry`（或用一个「勾上即执行」的 booleanToggle），别在 `create()` 构建屏幕时就把导出 / 重置跑一遍。这一段在 04 卷的 UI 实现里会补完整。

README §3.2 的 `fabric.mod.json` 把 `entrypoints.modmenu` 指向 `com.bigpixel.comet.config.CometModMenu`，类实现补在这里，别留一个不存在的类：

```java
package com.bigpixel.comet.config;

import com.terraformersmc.modmenu.api.ConfigScreenFactory;
import com.terraformersmc.modmenu.api.ModMenuApi;

/** ModMenu 入口，对应 fabric.mod.json 的 entrypoints.modmenu。 */
public final class CometModMenu implements ModMenuApi {
    @Override
    public ConfigScreenFactory<?> getModConfigScreenFactory() {
        return ConfigScreen::create;   // ConfigScreen.create(Screen parent) 见 §6.4
    }
}
```

**前置条件**：这个类 `implements ModMenuApi`，只有工程引了 `modmenu` 依赖才编得出来。README §3.2 的 `fabric.mod.json` 是「接 ModMenu」版（有 `entrypoints.modmenu` + `suggests.modmenu`，`build.gradle` 里 `modImplementation modmenu` 启用），此时把本文件加入 src 即自洽。01 卷 §4 走「不接 ModMenu」版：`entrypoints.client` 之外全删、`modmenu` 依赖与 `modmenu_version` 都注释掉，那种搭法下**不要**把本文件放进 src，否则 `ModMenuApi` 找不到会编译失败。两份 `fabric.mod.json` 是两种可选示例，各自自洽，读者选一份用即可。

这个类只依赖 `ConfigScreen.create(Screen)` 的方法签名，与配置类最终定名无关，Config 口径裁决后不需要再改。

### 6.5 `KeyBindings.java`（键位注册 + 捕获）

```java
package com.bigpixel.comet.key;

import com.bigpixel.comet.config.ModConfig;
import com.bigpixel.comet.module.Module;
import com.bigpixel.comet.module.ModuleRegistry;
import me.shedaniel.clothconfig2.api.ConfigCategory;
import me.shedaniel.clothconfig2.api.ConfigEntryBuilder;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

import java.util.*;

/** 对应 cfg.binds / cfg.guiKey / bindingModule / onKeyDown（11750–11835）。 */
public final class KeyBindings {

    /** 对应 cfg.guiKey = 'Backquote'，呼出悬浮标签面板。 */
    public static final KeyBinding GUI_KEY = new KeyBinding(
            "key.comet.gui", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_GRAVE_ACCENT,
            "category.comet");

    private static final Map<String, KeyBinding> MODULE_KEYS = new HashMap<>();

    private KeyBindings() {}

    public static void register() {
        KeyBindingHelper.registerKeyBinding(GUI_KEY);

        // 每帧轮询，对应 onKeyDown 的"GUI 关闭时按 binds 反查模块"（11827）
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (GUI_KEY.wasPressed()) {
                /* 打开 / 关闭悬浮面板，04 卷实现 */
            }
            for (Map.Entry<String, KeyBinding> e : MODULE_KEYS.entrySet()) {
                if (!e.getValue().wasPressed()) continue;
                // 对应 !e.repeat、输入框聚焦、带 ctrl/meta 不处理
                if (client.currentScreen != null) continue;
                Module m = ModuleRegistry.byId(e.getKey());
                if (m != null) m.toggle();
            }
        });

        // 配置改动（导入备份 / 改绑定）后重建模块键位
        rebuildModuleKeys();
    }

    /** 对应 cfg.binds：为每个已绑定模块注册一个 KeyBinding。 */
    public static void rebuildModuleKeys() {
        MODULE_KEYS.clear();
        for (Map.Entry<String, String> e : ModConfig.get().binds.entrySet()) {
            InputUtil.Key key = InputUtil.fromTranslationKey(e.getValue());
            if (key == null) continue;
            KeyBinding kb = new KeyBinding(
                    "key.comet.module." + e.getKey(),
                    key.getCode(), "category.comet.modules");
            KeyBindingHelper.registerKeyBinding(kb);
            MODULE_KEYS.put(e.getKey(), kb);
        }
    }

    /** 对应 keyadmin Tab（6495）：列出 / 清除绑定。 */
    public static void clearBind(String moduleId) {
        ModConfig.get().binds.remove(moduleId);
        ModConfig.save();
        rebuildModuleKeys();
    }

    /**
     * 对应设置面板里的「快捷键」行（10800）+ bindingModule 按键中状态。
     * 正式实现用一个 KeyCaptureScreen 捕获下一次按键，把 InputUtil.Key 的
     * translationKey 写回 cfg.binds（Delete / Backspace 清除），然后 rebuildModuleKeys()。
     */
    public static void addEntry(ConfigCategory cc, ConfigEntryBuilder eb, Module m) {
        String cur = ModConfig.get().binds.get(m.id());
        cc.addEntry(eb.startTextDescription(Text.literal(
                "快捷键: " + (cur == null ? "未绑定" : cur))).build());
        // 04 卷替换为可点击的 KeyCaptureScreen 入口
    }
}
```

`InputUtil.fromTranslationKey` 在不同 Yarn 版本里签名略有差异（有的吃 `String`、有的吃 `TranslationKey` 包装），编译时按实际映射调整。存 `code` 字符串（`"KeyP"` / `"Backquote"`）还是 `translationKey`（`"key.keyboard.p"`）要**全局统一**；源码存的是 `KeyboardEvent.code`，所以建议 Java 侧也存 code，自己写一张 code ↔ GLFW 常量的映射表，别混用两套。

---

## 7. 与其它卷的接口约定

写别的卷时按下面的约定调本卷的东西，别各自造轮子：

| 需求 | 调用 | 对应源码 |
|---|---|---|
| 读设置（带默认值回退） | `Module` 子类里 `get("range")` | `getS(mid, sid)` |
| 写设置 | `ModConfig.set(mid, sid, v)` | `setS` |
| 判断模块开关 | `module.isEnabled()` / `ModConfig.isOn(id)` | `modOn(id)` |
| 切换模块 | `module.toggle()` | `toggleModule(m)` |
| 帧缓存边界 | `CometTick` 里 `beginFrame()` / `try {...} finally { endFrame() }` | `onFrame` 的 `__sCache` |
| 设置变更联动 | `Module.onSettingChanged` 覆盖，或 `ModuleRegistry.subscribe` | `afterSetting` |
| 模块列表（侧栏 / 搜索） | `ModuleRegistry.sorted(cat)` / `.search(q)` | `sortedModules` / `renderSearchResults` |
| 主题 / 外观 | 读 `ModConfig.get().theme` 与 `get("appearance","*")` | `applyTheme` / `applyAppearance` |
| 性能档 | 02/08 卷读 `perf.level` 与当前 FPS | `perfLevel` / `perfGlow` |
| 备份导入导出 | `BackupCodec.build/parse/apply` | `buildBackup/parseBackup/applyImported` |
| 自检结果 | `ModuleRegistry.selfTest()` 返回空 = 通过 | `extSelfTest` / `extHealthCheck` |

一个坑重复提醒：`ModConfig.get()` 是单例且 **Gson 反序列化不跑字段初始化器**，所有默认值只在 `createDefault()` 里定义一次；新增字段时改 `createDefault()` + 类字段声明两处，`load()` 的「默认树覆盖」会自动让老配置补上新默认值。别在 `Module` 构造器里硬编码默认值——那和源码「默认值只在 `settings[]` 的 `value` 里定义一次」是一个道理。

下一卷 `08-porting-checklist.md` 会把 README §2 的 100 个模块逐条列成「JS 函数 → Fabric 事件 / Mixin 目标 → 实现要点 → 难度 → 优先级」对照表，并把网页特有、无法 1:1 移植的部分单独列出来；`09-gameplay-modules.md` 写玩法模块的 Java 实现。
