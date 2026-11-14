# 06 · HUD 组件与 ESP / 轨迹

> 这是移植笔记里最大的一卷。05 卷处理「盯一个目标」，这一卷把剩下的界面元素和世界渲染全铺开：左上水印/坐标、右上 ArrayList、右下通知、世界里的伤害数字与血条、ESP 线框与追踪线、投掷物抛物线、雷达/小地图/罗盘、方块/容器/路径点/掉落物高亮、背包与装备耐久。
>
> 统一口径：MC Java 1.21.1 / Fabric Loader 0.16+ / Fabric API / Yarn / Java 17；入口 `ClientModInitializer#onInitializeClient()`；屏幕 HUD 走 `HudRenderCallback`，世界渲染走 `WorldRenderEvents.AFTER_ENTITIES / END_MAIN`；3D 线用 `VertexConsumerProvider` + `RenderLayer.getLines()`，`RenderSystem` 管深度/混合；全屏后处理走 `RenderTarget` + 两趟可分离高斯；配置是 `Config POJO + Gson`；Mixin 用 `@Mixin/@Inject`；事件挂 `ClientTickEvents.END_CLIENT_TICK`、`ClientPlayConnectionEvents.JOIN`、`KeyBindingHelper`、`AttackEntityCallback`。05 卷已经落地的 `OpusHudClient`、`ColorUtil`、`ConfigLoader`、`TargetState` 这里直接复用，不再重复贴。

## 0. 源码地图

| JS 函数 / 块 | 行号 | 干什么 | 本卷章节 |
|---|---|---|---|
| `hudStage.innerHTML` | 11234–11270 | 水印 / 坐标 / TargetHUD / ArrayList / 通知 五个 DOM 容器 | §2 |
| `#__comet_hudstage` CSS | 9285–9286 | `50vw/50vh + scale(2)`，设计像素 ×2 | §2 |
| `.cm-hud / .cm-hudbox / .cm-hudicon` CSS | 9298–9307 | 水印与坐标条的排版、标签色 | §2 |
| `.cm-array / .cm-arr` CSS | 9330–9336 | ArrayList 右对齐、逐行卡片 | §2.3 |
| `.cm-notes / .cm-note / cm-notein / .out` | 9337–9347 | 通知滑入淡出动画 | §2.4 |
| `updateHud()` | 11605–11667 | fps/时间/网络状态、xyz/bps、TargetHUD 刷新 | §2.1 §2.2 |
| `renderArrayList()` | 11669–11675 | 启用模块按名字长度倒序 | §2.3 |
| `pushNotification / renderNotes` | 11679–11693 | 通知队列（≤5 条） | §2.4 |
| `refreshHud()` | 11696–11709 | 按开关显隐各元素 | §2 |
| 通知过期 `setInterval` | 11715–11720 | 2600ms 过期 + `.out` 滑出 | §2.4 |
| `espFrame()` | 2389–2666 | ESP 主循环：8 顶点线框、追踪线、nametags、TargetESP | §4 |
| `project()` | 1853–1860 | 世界→屏幕投影（网页版手算 vp 矩阵） | §1 |
| `typeColor / colorOf / hexToRgba` | 1776–1816 | 敌对/被动/玩家/物品分型取色 | §4.2 |
| `simulateProj / solveBallistic / leadPoint` | 2671–2747 | 弹道积分与命中解算 | §5.1 §5.2 |
| `projParams / heldProjInfo` | 2806–2832 | 弓/弩/雪球/珍珠/药水物性 | §5.2 |
| `strokeProj / drawLandMark` | 2749–2804 | 光带 4 段渐隐 / 光点 / 落点脉冲圈 | §5.3 |
| `drawProjectiles()` | 2834–2914 | 手持预览 + 预判点 + 飞行中投射物 | §5 |
| `drawRadar()` | 2916–2991 | 正北朝上圆形雷达 | §6 |
| `drawCompass()` | 2993–3080 | 几点方位条 + 经纬度 + 路径点嵌入 | §7.2 |
| `drawMinimap()` | 4494–4580 | 圆形小地图：地形/实体/路径点/箭头 | §7.1 |
| `blockRGB / refreshTerrain` | 4451–4492 | 地形着色 | §7.1 |
| `drawBlockEsp()` | 2272–2310 | 准星方块 3D 线框 + 填充 | §8.1 |
| `drawBlockTracker()` | 3890–3937 | 扫描匹配方块 + 屏外箭头 | §8.2 |
| `extChunkBorders()` | 5490–5525 | 区块分界线 | §8.3 |
| `drawWaypoints()` / `extWaypointLine()` | 4387–4439 / 7228–7258 | 光柱 + 屏外箭头 + 准星引导线 | §8.4 |
| `drawContainerEsp()` | 7583–7649 | 容器分类配色框 + 虚线追踪 + 名字 | §8.5 |
| `extDropBoxes()` | 5201–5250 | 掉落物世界内 3D 框 | §8.6 |
| `updateInventory()` | 4614–4645 | 背包 / 快捷栏 36 格 | §9.1 |
| `extArmorRows()` | 5569–5592 | 四件盔甲 + 手持耐久 | §9.2 |
| `extDrawDamage()` | 5726–5751 | 伤害数字上飘 | §3.1 |
| `extWorldHealthBars()` | 7325–7355 | 生物头顶细血条 | §3.2 |
| `extRenderB / D / E` 分发 | 5839–5845 / 7021 / 7384 | 扩展模块的 render 汇总入口 | §1 §3 |
| `MODULES` 的 hud/esp/tracers/projectile/… | 421–631 | 全部设置项与默认值 | 各章 |

---

## 1. 总纲：三条通道，别把所有东西塞进一个回调

网页版 `espFrame()`（2389）一帧里干了十几件事，是因为它只有一块 `ectx` 画布。Java 侧按「画在哪里」拆成三条，注册点各不相同：

| 通道 | 承载内容 | Fabric 事件 | 坐标系 |
|---|---|---|---|
| 屏幕 2D | 水印、坐标、ArrayList、通知、雷达、小地图、罗盘、背包、耐久、伤害数字（屏幕投影后）、名牌（路线 B） | `HudRenderCallback.EVENT` | `DrawContext`，`Window.getScaledWidth/Height()` |
| 世界 3D | ESP 线框、追踪线、光环/beam、方块框、容器框、掉落物框、区块边界、路径点光柱、投掷物轨迹 | `WorldRenderEvents.AFTER_ENTITIES` | `MatrixStack` 已平移到相机相对坐标 |
| 全屏后处理 | 毛玻璃、辉光、运动模糊（04 卷） | `WorldRenderEvents.END_MAIN` + `RenderTarget` + 两趟高斯 | 屏幕 UV |

`ClientTickEvents.END_CLIENT_TICK` 不画东西，只更新状态：通知队列过期、伤害数字 `pops` 老化、弹道点缓存、FPS 采样、`tagBoxes` 清空（05 卷 `NametagRenderer.beginFrame()`）。这个分工务必守住，不然 `DrawContext` 和 `VertexConsumer` 会互相抢 GL 状态。

一个全局的注册总表（05 卷 `OpusHudClient` 里追加）：

```java
@Override
public void onInitializeClient() {
    CONFIG = ConfigLoader.load();

    // —— 05 卷已注册 ——
    TargetHudRenderer.register();
    TargetRingRenderer.register();
    TargetState.register();            // AttackEntityCallback

    // —— 本卷新增 ——
    HudElementsRenderer.register();    // HudRenderCallback，§2.5
    RadarRenderer.register();          // HudRenderCallback，§6.2
    MinimapRenderer.register();        // HudRenderCallback，§7.3
    CompassRenderer.register();        // HudRenderCallback，§7.3
    InventoryHudRenderer.register();   // HudRenderCallback，§9
    EspRenderer.register();            // WorldRenderEvents.AFTER_ENTITIES，§4.5
    ProjectileRenderer.register();     // AFTER_ENTITIES，§5.4
    BlockRenderer.register();          // AFTER_ENTITIES，§8.7
    WorldOverlayRenderer.register();   // AFTER_ENTITIES（伤害数字/血条），§3.3

    ClientTickEvents.END_CLIENT_TICK.register(mc -> {
        NametagRenderer.beginFrame();
        HudState.tick(mc);             // fps / bps / 通知过期 / 伤害 pop 老化，见 §2.5
        ProjectileRenderer.tick(mc);
    });

    ClientPlayConnectionEvents.JOIN.register((handler, sender, mc) -> {
        HudState.reset();              // 换服清通知、伤害 pop、路径点缓存
        TargetState.clear();
    });

    // EDIT_HUD 键位（KeyBindingHelper）在 tick 里判 wasPressed() 开编辑模式，
    // 对应 JS 的 state.editHud（11416）与各面板 makeDraggable。
}
```

> 1.21.1 Fabric API 的 `HudRenderCallback` 真实签名是 `(DrawContext, RenderTickCounter)`，团队口径记作 `(DrawContext, float tickDelta)`。所有 renderer 内部统一用 `float tickDelta`，注册层统一写 `tickCounter.getTickDelta(true)` 转换一次，两卷保持一致。`WorldRenderContext` 同理用 `context.tickCounter().getTickDelta(true)`。

---

## 2. HUD 四件套（DOM 层 → HudRenderCallback）

四块东西共用 `#__comet_hudstage`（11232），该层是 `width:50vw; height:50vh; transform:scale(2)`（9285–9286），**CSS 里的 px 全是设计像素，上屏 ×2**。Java 侧直接按屏幕像素写，下面表格里给的已经是换算后的值。

`refreshHud()`（11696–11709）按五个开关决定显隐，Java 侧就是 `if (!cfg.hud.watermark) return;` 这种，不再展开。

### 2.1 水印（Player » fps » 时间 » 联机）

DOM 11235–11249，`updateHud()` 11609–11622 每帧填值：

| span | 内容 | JS 来源 |
|---|---|---|
| `__c_wm_user` | 玩家名 | `playerName()` |
| `__c_wm_fps` | 帧率 | `num(state.game,'fps')`，`Math.round` |
| `__c_wm_time` | `HH:MM` | `new Date()` 本地时间（不是游戏时间） |
| `__c_wm_net*` | 「联机」 | `isMP(state.game)`，单机时 `display:none` |

分隔符是 `»`，图标 `✦ ◈ ◷ ⇄`（`cm-hudicon` / `cm-hico` / `cm-hsep` 的颜色见 9303–9307：`hlbl` 灰、`hsep` 更灰、`hico` 亮灰、`hval` 白）。默认位置 `{x:20,y:8}`（11295）→ 屏幕 `40,16`。

**Java 实现路径**：`DrawContext.drawText` 一行拼出来，用 `§` 或分段 `drawText` 上色。FPS 自己采样（`MinecraftClient` 没有稳定的公开 fps getter，别赌），网络状态用 `!mc.isIntegratedServerRunning()`。时间用 `LocalTime.now()` 保持和 JS 一致（本地时钟，不是 `world.getTimeOfDay()`）。

```java
// HudElementsRenderer 里的一段，完整类见 §2.5
private void drawWatermark(DrawContext ctx, MinecraftClient mc) {
    if (!cfg.hud.watermark) return;
    int x = cfg.hud.watermarkX, y = cfg.hud.watermarkY;
    var tr = mc.textRenderer;
    int cx = x;
    cx = seg(ctx, tr, "✦ ", cx, y, 0xFFB06BFF);                    // 主题紫
    cx = seg(ctx, tr, mc.getSession().getUsername(), cx, y, 0xFFFFFFFF);
    cx = seg(ctx, tr, " » ", cx, y, 0x99A0A0B0);
    cx = seg(ctx, tr, "◈ ", cx, y, 0xFFC8C8D0);
    cx = seg(ctx, tr, String.valueOf(HudState.fps), cx, y, 0xFFFFFFFF);
    cx = seg(ctx, tr, " fps » ◷ ", cx, y, 0x99A0A0B0);
    cx = seg(ctx, tr, LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm")),
             cx, y, 0xFFFFFFFF);
    if (!mc.isIntegratedServerRunning()) {                          // isMP
        cx = seg(ctx, tr, " » ⇄ 联机", cx, y, 0xFF6EE7A5);
    }
}
private static int seg(DrawContext ctx, var tr, String s, int x, int y, int color) {
    ctx.drawText(tr, Text.literal(s), x, y, color, true);
    return x + tr.getWidth(s);
}
```

### 2.2 坐标条（x / y / z / 速度 / 方位）

DOM 11250–11261，`updateHud()` 11624–11642。xyz 是 `Math.floor(readPos(player))`，速度 `bps` 用一阶低通：

```js
const inst = dist / dt;                    // 两次采样间的位移速率
bpsSmooth = bpsSmooth * 0.7 + inst * 0.3; // 11635
if (elIbps) elIbps.textContent = bpsSmooth.toFixed(1);
```

`lastSample` 记录 `{player,x,y,z,t}`，`dt` 落在 `(0.05, 2)` 秒才更新，避免卡顿/切世界时跳数。

Java 侧 `mc.player.getPos()` 直接有，`bps` 用 `getVelocity().horizontalLength() * 20`（速度单位是「格/tick」×20 = 格/秒）或照搬「按 tick 位移 / dt」的采样，后者更贴原行为，我选后者。方位是网页版坐标条没有、但 Java 版顺手补的：由 `player.getYaw()` 换成 北/东/南/西（罗盘 §7.2 有现成的换算），团队要求的「方位」在这里补上。

```java
private void drawCoords(DrawContext ctx, MinecraftClient mc, float tickDelta) {
    if (!cfg.hud.info) return;
    var p = mc.player; if (p == null) return;
    int x = cfg.hud.infoX, y = cfg.hud.infoY;
    var tr = mc.textRenderer;
    String bps = String.format("%.1f", HudState.bps);
    String bearing = bearingCn(p.getYaw(tickDelta));
    String line = String.format("✚ x %d » y %d » z %d » %s b/s » %s",
            (int) Math.floor(p.getX()), (int) Math.floor(p.getY()),
            (int) Math.floor(p.getZ()), bps, bearing);
    ctx.drawText(tr, Text.literal(line), x, y, 0xFFEFF2FA, true);
}

/** yaw: 0=南(+Z) 90=西(-X) 180=北(-Z) 270=东(+X)，见 drawCompass 3019。 */
static String bearingCn(float yaw) {
    float deg = (yaw + 180f + 360f) % 360f;
    if (deg < 45 || deg >= 315) return "北";
    if (deg < 135) return "东";
    if (deg < 225) return "南";
    return "西";
}
```

`HudState.bps` 的采样放在 `END_CLIENT_TICK`：

```java
// HudState.tick(mc)
long now = System.currentTimeMillis();
if (last != null) {
    double dt = (now - last.t) / 1000.0;
    if (dt > 0.05 && dt < 2.0) {
        double d = last.pos.distanceTo(p.getPos());
        bps = bps * 0.7 + (d / dt) * 0.3;   // 11635 一阶低通，1:1 搬
    }
}
last = new Sample(p.getPos(), now);
```

### 2.3 ArrayList（右对齐、按长度排序、动画）

`renderArrayList()` 11669–11675：

```js
const on = MODULES.filter(m => modOn(m.id) && m.id !== 'hud');
on.sort((a,b) => b.name.length - a.name.length);   // 名字长的在上
for (const m of on) elArray.append(mk('div','cm-arr', m.cn || m.name));
```

容器 `.cm-array { right:8; top:8; flex-direction:column; align-items:flex-end; gap:2 }`（9330），每行 `.cm-arr` 高 14（设计）→ 28 屏幕，字体 5.5→11px，右对齐、圆角 4、渐变底、灰边框。CSS 里没有逐行动画（`cm-notein` 是通知的），只有整体布局；团队说的「动画」对应 04 卷毛玻璃态的过渡，Java 侧用行索引做一个淡入偏移即可。

**Java 实现路径**：`HudRenderCallback` 里从右边缘往左算每行宽度，`fill` 卡片 + `drawText` 右对齐。模块列表来自 `ModuleRegistry`（把 05 卷 config 的布尔字段映射成 `List<String>`）。

```java
private void drawArrayList(DrawContext ctx, MinecraftClient mc) {
    if (!cfg.hud.arraylist) return;
    List<String> on = ModuleRegistry.enabledNames();      // 已按长度倒序
    int right = mc.getWindow().getScaledWidth() - 16;     // right:8 设计 → 16
    int top = 16;
    var tr = mc.textRenderer;
    int rowH = 28, gap = 4;
    for (int i = 0; i < on.size(); i++) {
        String s = on.get(i);
        int w = tr.getWidth(s) + 24;                       // padding 0 6 设计 → 12×2
        int x0 = right - w, y0 = top + i * (rowH + gap);
        // 滑入动画：按行索引给一个短暂的 x 偏移，Math.exp 衰减
        float age = HudState.arrayAge(i);
        int slide = (int) (18 * Math.exp(-age * 8));
        ctx.fill(x0 + slide, y0, right + slide, y0 + rowH, 0xC0343434);
        ctx.fill(x0 + slide, y0, x0 + slide + 1, y0 + rowH, 0xFF5A5A5A);
        ctx.drawText(tr, Text.literal(s), x0 + slide + 12, y0 + rowH / 2 - 4,
                0xFFF0F0F0, true);
    }
}
```

### 2.4 通知（滑入淡出、队列、2600ms）

`pushNotification(title, desc)`（11679–11683）：`notes.push({title,desc,at})`，超过 5 条 `shift()`。`renderNotes()` 11684–11693 重建 DOM，每条 `.cm-note` 108×24（设计）→ 216×48，标题 6→12px 加粗白，描述 5→10px 灰。CSS 9338–9347：

```css
.cm-note { animation: cm-notein .2s ease; }         /* 从 translateX(18px) opacity:0 进场 */
.cm-note.out { opacity:0; transform:translateX(12px); transition:.25s; }
@keyframes cm-notein { from{opacity:0;transform:translateX(18px)} to{opacity:1;transform:none} }
```

11715–11720 的 `setInterval` 每 200ms 把 `now - n.at >= 2600` 的滤掉，出场时先加 `.out` 类再移除。

**Java 实现路径**：`HudState` 里维护 `Deque<Note>`，`pushNotification` 在模块开关、路径点标记、装备警告这些地方调（对应 05 卷 `notify`）；`HudRenderCallback` 里按 `age` 算 alpha 和 x 偏移：

```java
// HudState
public static final class Note { public final String title, desc; public final long at;
    Note(String t, String d){ title=t; desc=d; at=System.currentTimeMillis(); } }
public static final java.util.ArrayDeque<Note> NOTES = new java.util.ArrayDeque<>();
public static void notify(String t, String d) {
    NOTES.addLast(new Note(t, d));
    while (NOTES.size() > 5) NOTES.removeFirst();     // 11681
}
public static void expire() {                          // 挂 END_CLIENT_TICK
    long now = System.currentTimeMillis();
    while (!NOTES.isEmpty() && now - NOTES.peekFirst().at > 2600) NOTES.removeFirst();
}
```

绘制（右下角 `bottom:132` 设计 → 264，`right:8` → 16）：

```java
private void drawNotes(DrawContext ctx, MinecraftClient mc) {
    if (!cfg.hud.notifications) return;
    var tr = mc.textRenderer;
    int right = mc.getWindow().getScaledWidth() - 16;
    int bottom = mc.getWindow().getScaledHeight() - 264;
    int w = 216, h = 48, gap = 4;
    int i = 0;
    for (HudState.Note n : HudState.NOTES) {
        long age = System.currentTimeMillis() - n.at;
        float in  = Math.min(1f, age / 200f);           // cm-notein .2s
        float out = age > 2350 ? 1f - (age - 2350) / 250f : 1f;  // .out .25s
        float alpha = Math.max(0f, Math.min(in, out));
        int x0 = right - w + (int) (18 * (1 - in)) + (int) (12 * (1 - out));
        int y0 = bottom - (i + 1) * (h + gap);
        int bg = (int) (0xB0 * alpha) << 24 | 0x00343434;
        ctx.fill(x0, y0, x0 + w, y0 + h, bg);
        int titleC = (int) (255 * alpha) << 24 | 0xFFFFFF;
        ctx.drawText(tr, Text.literal(n.title), x0 + 12, y0 + 9, titleC, true);
        ctx.drawText(tr, Text.literal(n.desc), x0 + 12, y0 + 26,
                (int) (170 * alpha) << 24 | 0xA0A0A0, false);
        i++;
    }
}
```

> CSS 动画是**网页特有、必须换实现**的典型：没有 `opacity`/`transform` 属性可挂，全靠每帧按 `System.currentTimeMillis()` 算 alpha 和位移。上面那段就是 `cm-notein` / `.out` 的手写等价物。

### 2.5 完整骨架 ① `HudElementsRenderer.java`

把水印、坐标、ArrayList、通知、TargetHUD（05 卷）串在一个 `HudRenderCallback` 里。状态类 `HudState` 一并列全。

```java
package opus.hud.client.render;

import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.text.Text;
import opus.hud.client.OpusHudClient;
import opus.hud.client.config.OpusConfig;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayDeque;
import java.util.List;

/** 屏幕 2D HUD 四件套。对应 hudStage DOM 的 wm/info/array/notes。 */
public final class HudElementsRenderer {

    public static void register() {
        HudRenderCallback.EVENT.register((DrawContext ctx, var tickCounter) -> {
            float tickDelta = tickCounter.getTickDelta(true);
            HudState.onFrame();                 // fps 采样
            render(ctx, tickDelta);
        });
    }

    static void render(DrawContext ctx, float tickDelta) {
        OpusConfig c = OpusHudClient.CONFIG;
        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc.player == null || mc.world == null) return;
        if (!c.hud.enabled) return;

        drawWatermark(ctx, mc, c);
        drawCoords(ctx, mc, tickDelta, c);
        drawArrayList(ctx, mc, c);
        drawNotes(ctx, mc, c);
        // TargetHudRenderer.render(ctx, tickDelta) 由 05 卷单独 register，
        // 同属 HudRenderCallback，顺序由注册先后决定，互不干扰。
    }

    private static void drawWatermark(DrawContext ctx, MinecraftClient mc, OpusConfig c) {
        if (!c.hud.watermark) return;
        var tr = mc.textRenderer;
        int x = c.hud.watermarkX, y = c.hud.watermarkY;
        x = seg(ctx, tr, "✦ ", x, y, 0xFFB06BFF);
        x = seg(ctx, tr, mc.getSession().getUsername(), x, y, 0xFFFFFFFF);
        x = seg(ctx, tr, " » ◈ ", x, y, 0x99A0A0B0);
        x = seg(ctx, tr, String.valueOf(HudState.fps), x, y, 0xFFFFFFFF);
        x = seg(ctx, tr, " fps » ◷ ", x, y, 0x99A0A0B0);
        x = seg(ctx, tr, LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm")),
                x, y, 0xFFFFFFFF);
        if (!mc.isIntegratedServerRunning()) seg(ctx, tr, " » ⇄ 联机", x, y, 0xFF6EE7A5);
    }

    private static void drawCoords(DrawContext ctx, MinecraftClient mc,
                                   float tickDelta, OpusConfig c) {
        if (!c.hud.info) return;
        var p = mc.player; var tr = mc.textRenderer;
        String line = String.format("✚ x %d » y %d » z %d » %.1f b/s » %s",
                (int) Math.floor(p.getX()), (int) Math.floor(p.getY()),
                (int) Math.floor(p.getZ()), HudState.bps, bearingCn(p.getYaw(tickDelta)));
        ctx.drawText(tr, Text.literal(line), c.hud.infoX, c.hud.infoY, 0xFFEFF2FA, true);
    }

    private static void drawArrayList(DrawContext ctx, MinecraftClient mc, OpusConfig c) {
        if (!c.hud.arraylist) return;
        List<String> on = ModuleRegistry.enabledNames();
        var tr = mc.textRenderer;
        int right = mc.getWindow().getScaledWidth() - 16;
        int rowH = 28, gap = 4;
        for (int i = 0; i < on.size(); i++) {
            String s = on.get(i);
            int w = tr.getWidth(s) + 24;
            int x0 = right - w + (int) (18 * Math.exp(-HudState.arrayAge(i) * 8));
            int y0 = 16 + i * (rowH + gap);
            ctx.fill(x0, y0, right, y0 + rowH, 0xC0343434);
            ctx.fill(x0, y0, x0 + 1, y0 + rowH, 0xFF5A5A5A);
            ctx.drawText(tr, Text.literal(s), x0 + 12, y0 + rowH / 2 - 4, 0xFFF0F0F0, true);
        }
    }

    private static void drawNotes(DrawContext ctx, MinecraftClient mc, OpusConfig c) {
        if (!c.hud.notifications) return;
        var tr = mc.textRenderer;
        int right = mc.getWindow().getScaledWidth() - 16;
        int bottom = mc.getWindow().getScaledHeight() - 264;
        int w = 216, h = 48, gap = 4, i = 0;
        for (HudState.Note n : HudState.NOTES) {
            long age = System.currentTimeMillis() - n.at;
            float in = Math.min(1f, age / 200f);
            float out = age > 2350 ? 1f - (age - 2350) / 250f : 1f;
            float a = Math.max(0f, Math.min(in, out));
            int x0 = right - w + (int) (18 * (1 - in)) + (int) (12 * (1 - out));
            int y0 = bottom - (i + 1) * (h + gap);
            ctx.fill(x0, y0, x0 + w, y0 + h, ((int)(0xB0*a) << 24) | 0x343434);
            ctx.drawText(tr, Text.literal(n.title), x0 + 12, y0 + 9,
                    ((int)(255*a) << 24) | 0xFFFFFF, true);
            ctx.drawText(tr, Text.literal(n.desc), x0 + 12, y0 + 26,
                    ((int)(170*a) << 24) | 0xA0A0A0, false);
            i++;
        }
    }

    static String bearingCn(float yaw) {
        float d = (yaw + 180f + 360f) % 360f;
        return d < 45 || d >= 315 ? "北" : d < 135 ? "东" : d < 225 ? "南" : "西";
    }

    private static int seg(DrawContext ctx, var tr, String s, int x, int y, int color) {
        ctx.drawText(tr, Text.literal(s), x, y, color, true);
        return x + tr.getWidth(s);
    }
}
```

```java
package opus.hud.client.render;

import net.minecraft.client.MinecraftClient;
import net.minecraft.util.math.Vec3d;

/** 对应 JS 的 updateHud / notes / lastSample / QUICK 状态，挂在 END_CLIENT_TICK。 */
public final class HudState {
    public static int fps = 0;
    public static double bps = 0;
    public static final java.util.ArrayDeque<Note> NOTES = new java.util.ArrayDeque<>();
    private static long lastFpsT = System.currentTimeMillis();
    private static int frames = 0;
    private static Sample last;
    private static final long[] ArrayAge = new long[64];

    public static final class Note {
        public final String title, desc; public final long at;
        Note(String t, String d){ title=t; desc=d; at=System.currentTimeMillis(); }
    }
    private record Sample(Vec3d pos, long t) {}

    public static void onFrame() {                 // HudRenderCallback 每帧调
        frames++;
        long now = System.currentTimeMillis();
        if (now - lastFpsT >= 1000) {
            fps = (int) (frames * 1000L / (now - lastFpsT));
            frames = 0; lastFpsT = now;
        }
    }

    public static void tick(MinecraftClient mc) {  // END_CLIENT_TICK
        expire();
        var p = mc.player; if (p == null) return;
        long now = System.currentTimeMillis();
        if (last != null) {
            double dt = (now - last.t()) / 1000.0;
            if (dt > 0.05 && dt < 2.0) {
                double inst = last.pos().distanceTo(p.getPos()) / dt;
                bps = bps * 0.7 + inst * 0.3;      // 11635
            }
        }
        last = new Sample(p.getPos(), now);
    }

    public static void notify(String t, String d) {
        NOTES.addLast(new Note(t, d));
        while (NOTES.size() > 5) NOTES.removeFirst();
    }
    private static void expire() {
        long now = System.currentTimeMillis();
        while (!NOTES.isEmpty() && now - NOTES.peekFirst().at > 2600) NOTES.removeFirst();
    }
    public static void reset() { NOTES.clear(); bps = 0; last = null; }
    public static double arrayAge(int i) { return (System.currentTimeMillis() - ArrayAge[i & 63]) / 1000.0; }
}
```

`ModuleRegistry` 是个薄封装，把 config 里的布尔字段变成显示名列表并按长度倒序（对应 11672–11673）：

```java
public final class ModuleRegistry {
    public static java.util.List<String> enabledNames() {
        var c = opus.hud.client.OpusHudClient.CONFIG;
        var out = new java.util.ArrayList<String>();
        if (c.esp.enabled)       out.add("生物ESP");
        if (c.tracers.enabled)   out.add("追踪线");
        if (c.nametags.enabled)  out.add("名字标签");
        if (c.projectile.enabled)out.add("投掷物抛物线");
        if (c.minimap.enabled)   out.add("小地图");
        if (c.hud.radar)         out.add("雷达");
        // …其余模块照 421–709 的 id/cn 表补
        out.sort((a, b) -> b.length() - a.length());   // 11673
        return out;
    }
}
```

---

## 3. 世界内文字与血条

这两块网页版画在 `ectx`（屏幕画布）上，靠 `project()` 把实体坐标变成屏幕点，属于「算法可搬、载体要换」的中间地带。

### 3.1 伤害数字 `extDrawDamage`（5726–5751）

设置（5437–5444）：`color` 默认红 `#ff5f6d`、`speed` 0.8、`size` 16、`bold` true。

`extB.pops`（4845 里 `damagePops: []`）存 `{text,x,y,z,born}`，由战斗逻辑在实体掉血时 push。绘制：

```js
const age = (now - pop.born)/1000;
if (age > 1.2) { splice; continue; }        // 1.2 秒生命
const q = project(r, pop.x, pop.y + age*speed, pop.z);  // 上飘
const a = 1 - age/1.2;                      // 线性淡出
ctx.lineWidth = 3; strokeStyle 黑 (描边);
strokeText(pop.text); fillStyle hexToRgba(color,a); fillText(...)
```

**Java 实现路径**：伤害来源用 `AttackEntityCallback`（打别人）和 `ClientTickEvents` 里比对周围实体 `getHealth()` 变化（别人挨打/自己挨打）两条。`pop` 队列放 `HudState` 或独立 `DamagePopState`，每帧在 `HudRenderCallback` 里把世界点投影到屏幕后 `drawText`。投影这一步 Java 有现成的：用 `Camera` + `Matrix4f` 做透视除法，或者直接 `ctx` 里用 `net.minecraft.client.util.math.MatrixStack` 配 `VertexConsumer` 画 billboard 文本（同 05 卷名牌路线 A）。最省事的还是屏幕投影：

```java
// WorldOverlayRenderer 片段，完整投影工具见 §3.3
for (DamagePop p : DamagePopState.POPS) {
    float age = (System.currentTimeMillis() - p.born) / 1000f;
    if (age > 1.2f) { it.remove(); continue; }
    Vec3d world = p.pos.add(0, age * cfg.damage.speed, 0);
    Vec3d screen = ScreenProjector.project(world, mc, tickDelta);   // 见 §3.3
    if (screen == null) continue;
    int a = (int) (255 * (1 - age / 1.2f));
    // bold + 描边：shadow=true 近似 strokeText 的黑描边
    String s = p.text;
    ctx.drawText(tr, Text.literal(s), (int) screen.x - tr.getWidth(s)/2,
            (int) screen.y, ((a) << 24) | (cfg.damage.color & 0xFFFFFF), true);
}
```

`size`（8–36）通过 `ctx.getMatrices().scale(size/9f, ...)` 实现，`bold` 用 `drawText` 的 shadow 参数近似；要真加粗得自己注册一个粗体 `TextRenderer`，优先级放低。

### 3.2 世界内血条 `extWorldHealthBars`（7325–7355）

设置（7196–7201）：`width` 默认 32、`color` 默认绿 `#6ee7a5`。

遍历实体，跳过 `health/maxHealth` 为空的，距离 >48 的不画，最多 30 个；投影点在 `q[1] + h + 0.28`（头顶再抬 0.28），`pct = clamp(health/maxHealth)`，画黑底 `width+2 × 5` 和填充 `width*pct × 3`。

**Java 实现路径**：`LivingEntity#getHealth/getMaxHealth/getHeight()` 直接有，比网页版 `num(e,'h')` 猜高度准。绘制同 §3.1，投影到屏幕后 `fill` 两条矩形。血条和名牌别叠在一起 —— 05 卷名牌自带一条血条（2605–2611），两者同时开会重影，config 里做个互斥或直接让 `healthbar` 只在名牌关闭时生效。

### 3.3 `ScreenProjector` —— 唯一还需要「投影」的工具

05 卷说过 `project()` 整段可以删，那是指 3D 线框；**文字/矩形标签**仍需要世界点→屏幕点。Java 版不用手算 `vp[16]`，但得从 `Camera` 和投影矩阵里取：

```java
package opus.hud.client.render;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.Camera;
import net.minecraft.util.math.Vec3d;
import org.joml.Matrix4f;
import org.joml.Vector3f;
import org.joml.Vector4f;

/** 世界坐标 → 屏幕像素。取代 JS project() 的列主序 vp 点乘。 */
public final class ScreenProjector {
    public static Vec3d project(Vec3d world, MinecraftClient mc, float tickDelta) {
        Camera cam = mc.gameRenderer.getCamera();
        Vec3d camPos = cam.getPos();
        // 相机相对坐标 × view 旋转 × 投影矩阵
        Vector3f rel = new Vector3f(
                (float)(world.x - camPos.x),
                (float)(world.y - camPos.y),
                (float)(world.z - camPos.z));
        rel.rotate(cam.getRotation().conjugate());     // 世界 → 相机空间
        Matrix4f proj = new Matrix4f(mc.gameRenderer.getBasicProjectionMatrix());
        Vector4f clip = new Vector4f(rel.x(), rel.y(), rel.z(), 1f).mul(proj);
        if (clip.w <= 0.01f) return null;               // 对应 cw <= 0.1
        float ndcX = clip.x / clip.w, ndcY = clip.y / clip.w;
        int w = mc.getWindow().getScaledWidth(), h = mc.getWindow().getScaledHeight();
        return new Vec3d((ndcX * 0.5 + 0.5) * w, (1 - (ndcY * 0.5 + 0.5)) * h, clip.w);
    }
}
```

`getBasicProjectionMatrix()` 返回的是 FOV 投影矩阵（不含 GUI 缩放）；乘上 `Camera.getRotation()` 的共轭四元数把方向转正，等价于网页版 `vp` 里的 view 部分。`clip.w` 就是深度，返回它给调用方做距离衰减用。若你的映射里 `getBasicProjectionMatrix()` 名字不同（1.21 有些版本叫 `getProjectionMatrix()`），改个名即可；也可以直接在 `WorldRenderEvents.AFTER_ENTITIES` 里用 `context.projectionMatrix()` 拿，更准。

---

## 4. ESP 主体

### 4.1 8 顶点 → 12 条边（`espFrame` 2497–2548）

网页版先按 `w/h` 猜一个 AABB，再投影 8 个角：

```js
const hw = (num(e,'w') ?? 0.6)/2, hh = num(e,'h') ?? 1.8;
const bb = [pos[0]-hw, pos[1], pos[2]-hw, pos[0]+hw, pos[1]+hh, pos[2]+hw];
for (i=0..7) pt = project(r, bb[i&1?3:0], bb[i&2?4:1], bb[i&4?5:2]);
const EDGES = [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]];
```

**Java 版这里可以彻底换实现**：`entity.getBoundingBox()` 直接给 `minX/minY/minZ/maxX/maxY/maxZ`，不用猜 `w=0.6/h=1.8`；8 个角也不用手算投影，直接把 6 个数交给 `VertexConsumer`，投影矩阵自动处理。这就是「算法可 1:1 移植（12 条边的连接关系照抄）」但「投影必须换（3D 世界坐标代替屏幕点）」的典型。

`EDGES` 的索引约定（i 的 bit0=X, bit1=Y, bit2=Z）两卷统一，05 卷 `drawBlockEsp` 的 12 条边、06 卷 `extDropBoxes`、`drawContainerEsp` 全用同一张表，抽成一个常量：

```java
public static final int[][] BOX_EDGES = {
    {0,1},{1,3},{3,2},{2,0},{4,5},{5,7},{7,6},{6,4},{0,4},{1,5},{2,6},{3,7}
};
```

### 4.2 类型配色、距离衰减、上限（2466–2521 / 1770–1804）

- `maxD2 = pow(esp.distance, 2)`（2466，默认 64），`maxEnts = perf.maxEnts`（2470，默认 80）硬截断循环；
- `typeColor('esp', e, isMob)` 按 `entityCat`（item/player/mob）找 `mobColor/playerColor/itemColor`，再回落 `color`，全空才 `colorOf(e)`（红/蓝/紫）；
- 掉落物用 `itemKindOf(e)` 返回的 `kind` 当颜色；
- 距离衰减在掉落物框里最明显：`fade = max(0.25, 1 - dist/(R*1.2))`（5237），容器是 `max(0.3, 1-dist/(R*1.3))`（7616），ESP 主体本身**没有**按距离淡化，只有 `maxD2` 硬裁剪。别自作主张给 ESP 加渐变，保持原样。

### 4.3 追踪线（2523–2535）

```js
ectx.moveTo(W_/2, H_/2); ectx.lineTo(cx, cy);   // 准星 → 实体屏幕中心
```

三类分别配色（`tracers` 模块 431–437 的 `mobColor/itemColor/playerColor`）：玩家紫 `rgba(192,132,252,.62)`、敌对红 `rgba(255,82,82,.65)`、被动蓝 `rgba(79,195,247,.5)`、掉落物按 `kind` 半透明。Java 侧换成 3D：从相机位置到实体中心画一条 `getLines()` 线段，起点 `camera.getPos()` 平移后的原点 `(0,0,0)`，终点 `entity.getLerpedPos(tickDelta) - camPos + (0, height/2, 0)`。穿墙显示靠 `RenderSystem.disableDepthTest()`。

### 4.4 TargetESP 四角括号（2635–2661）

`showTarget && auraTarget` 时对目标 AABB 的四个角画 `l = min(10, (x1-x0)*0.28, (y1-y0)*0.28)` 的白色括号（8 条短线段）。这是纯屏幕 2D 效果，Java 侧要么用 `ScreenProjector` 投影后 `fill`，要么在 3D 里画 12 条短线（更贴世界，转头不会飘）。我选 3D，和 ESP 线框同一批 `VertexConsumer`。

### 4.5 完整骨架 ② `EspRenderer.java`

```java
package opus.hud.client.render;

import com.mojang.blaze3d.systems.RenderSystem;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.*;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.entity.Entity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.ItemEntity;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;
import opus.hud.client.OpusHudClient;
import opus.hud.client.config.OpusConfig;
import opus.hud.client.state.TargetState;
import org.joml.Matrix4f;

import java.util.Iterator;

/** ESP 3D 线框 + 追踪线 + TargetESP 四角括号。对应 espFrame 2466–2661。 */
public final class EspRenderer {

    public static final int[][] BOX_EDGES = {
        {0,1},{1,3},{3,2},{2,0},{4,5},{5,7},{7,6},{6,4},{0,4},{1,5},{2,6},{3,7}
    };

    public static void register() {
        WorldRenderEvents.AFTER_ENTITIES.register(EspRenderer::afterEntities);
    }

    private static void afterEntities(WorldRenderContext context) {
        OpusConfig c = OpusHudClient.CONFIG;
        if (!c.esp.enabled && !c.tracers.enabled && !c.targetEsp.enabled) return;
        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc.world == null || mc.player == null) return;

        float tickDelta = context.tickCounter().getTickDelta(true);
        Vec3d cam = context.camera().getPos();
        MatrixStack matrices = context.matrixStack();
        VertexConsumerProvider.Immediate immediate =
                mc.getBufferBuilders().getEntityVertexConsumers();

        RenderSystem.disableDepthTest();
        RenderSystem.depthMask(false);
        RenderSystem.enableBlend();
        RenderSystem.defaultBlendFunc();
        VertexConsumer lines = immediate.getBuffer(RenderLayer.getLines());
        Matrix4f m = matrices.peek().getPositionMatrix();

        double maxD2 = (double) c.esp.distance * c.esp.distance;
        int count = 0;
        Iterator<Entity> it = mc.world.getEntities().iterator();
        while (it.hasNext() && count++ < c.perf.maxEnts) {
            Entity e = it.next();
            if (e == mc.player || e.isRemoved()) continue;
            Vec3d pos = e.getLerpedPos(tickDelta);
            if (pos.squaredDistanceTo(cam) > maxD2) continue;

            boolean mob = e instanceof LivingEntity;
            int color = c.esp.enabled ? entityColor(e, c) : 0;
            Box bb = e.getBoundingBox();   // 直接拿 AABB，不用 w/h 猜（2500）
            double x0 = bb.minX - cam.x, x1 = bb.maxX - cam.x;
            double y0 = bb.minY - cam.y, y1 = bb.maxY - cam.y;
            double z0 = bb.minZ - cam.z, z1 = bb.maxZ - cam.z;

            if (c.tracers.enabled && (mob || e instanceof ItemEntity)) {
                int tc = tracerColor(e, c);
                float[] rgb = rgb(tc);
                // 准星 = 相机原点；终点取 AABB 中心
                line(lines, m, 0, 0, 0,
                        (x0+x1)/2, (y0+y1)/2, (z0+z1)/2, rgb, 0.62f);
            }

            if (c.esp.enabled && mob) {
                float[] rgb = rgb(color);
                double[][] v = corners(x0,y0,z0,x1,y1,z1);
                for (int[] ed : BOX_EDGES) {
                    double[] a = v[ed[0]], b = v[ed[1]];
                    line(lines, m, a[0],a[1],a[2], b[0],b[1],b[2], rgb, 0.9f);
                }
            }
            if (c.esp.enabled && !mob) {          // 掉落物：网页版画 strokeRect（2546）
                float[] rgb = rgb(c.esp.itemColor != 0 ? c.esp.itemColor : 0xFFFFD54F);
                double[][] v = corners(x0,y0,z0,x1,y1,z1);
                for (int[] ed : BOX_EDGES) {
                    double[] a = v[ed[0]], b = v[ed[1]];
                    line(lines, m, a[0],a[1],a[2], b[0],b[1],b[2], rgb, 0.8f);
                }
            }
        }

        // TargetESP 四角括号（2635–2661）
        if (c.targetEsp.enabled) {
            LivingEntity tgt = TargetState.current();
            if (tgt != null) drawBrackets(lines, m, tgt.getBoundingBox(), cam, tickDelta);
        }

        immediate.draw();
        RenderSystem.depthMask(true);
        RenderSystem.enableDepthTest();
        RenderSystem.disableBlend();
    }

    /** 8 角点，bit0=X bit1=Y bit2=Z，和 JS 的 i&1/2/4 一致。 */
    public static double[][] corners(double x0,double y0,double z0,
                                      double x1,double y1,double z1) {
        double[][] v = new double[8][3];
        for (int i = 0; i < 8; i++) {
            v[i][0] = (i & 1) != 0 ? x1 : x0;
            v[i][1] = (i & 2) != 0 ? y1 : y0;
            v[i][2] = (i & 4) != 0 ? z1 : z0;
        }
        return v;
    }

    private static void drawBrackets(VertexConsumer vc, Matrix4f m, Box bb,
                                     Vec3d cam, float tickDelta) {
        double x0 = bb.minX-cam.x, x1 = bb.maxX-cam.x;
        double y0 = bb.minY-cam.y, y1 = bb.maxY-cam.y;
        double z0 = bb.minZ-cam.z, z1 = bb.maxZ-cam.z;
        double l = Math.min(0.28 * (x1-x0), 0.28 * (y1-y0));
        float[] w = {1f,1f,1f};
        // 在 AABB 前面 z0 的四个角各画一个 L 形括号，共 8 短线
        for (double[] corner : new double[][]{{x0,y0},{x1,y0},{x1,y1},{x0,y1}}) {
            double cx = corner[0], cy = corner[1];
            line(vc, m, cx, cy, z0, cx + (cx==x0?l:-l), cy, z0, w, 0.9f);
            line(vc, m, cx, cy, z0, cx, cy + (cy==y0?l:-l), z0, w, 0.9f);
        }
    }

    /** 颜色判定：HostileEntity 取代 HOSTILE.has(constructor.name)（05 卷 §4.4）。 */
    public static int entityColor(Entity e, OpusConfig c) {
        if (e instanceof net.minecraft.client.network.OtherClientPlayerEntity)
            return c.esp.playerColor != 0 ? c.esp.playerColor : 0xFFC084FC;
        boolean hostile = e instanceof net.minecraft.entity.mob.HostileEntity;
        if (hostile) return c.esp.mobColor != 0 ? c.esp.mobColor : 0xFFFF5252;
        return 0xFF4FC3F7;
    }
    private static int tracerColor(Entity e, OpusConfig c) {
        if (e instanceof net.minecraft.client.network.OtherClientPlayerEntity)
            return c.tracers.playerColor != 0 ? c.tracers.playerColor : 0xFFC084FC;
        if (e instanceof net.minecraft.entity.mob.HostileEntity)
            return c.tracers.mobColor != 0 ? c.tracers.mobColor : 0xFFFF5252;
        return c.tracers.itemColor != 0 ? c.tracers.itemColor : 0xFF4FC3F7;
    }

    public static float[] rgb(int argb) {
        return new float[]{((argb>>16)&255)/255f, ((argb>>8)&255)/255f, (argb&255)/255f};
    }

    /** RenderLayer.getLines() 顶点：position + color + normal + .next()。两卷统一。 */
    public static void line(VertexConsumer vc, Matrix4f m,
                            double x1,double y1,double z1,
                            double x2,double y2,double z2,
                            float[] rgb, float a) {
        vc.vertex(m,(float)x1,(float)y1,(float)z1).color(rgb[0],rgb[1],rgb[2],a).normal(0,1,0).next();
        vc.vertex(m,(float)x2,(float)y2,(float)z2).color(rgb[0],rgb[1],rgb[2],a).normal(0,1,0).next();
    }
}
```

> `mc.world.getEntities().iterator()` 在 1.21.1 可用（`World#getEntities()` 返回 `Iterable<Entity>`）。要更细的控制（只取特定类型、按距离排序）就用 `world.getEntitiesByClass(...)` 或 `Box` 查询。`perf.maxEnts` 的硬截断照 2470 行搬，别省 —— 大服务器里不截断会卡。

---

## 5. 投掷物：抛物线 / 落点 / 飞行轨迹

这块是**算法 1:1 可移植**的典范：JS 里的物理积分和 Java 版原版弹道基本一致，参数都能直接抄。

### 5.1 `simulateProj`（2671–2690）

源码注释（2669–2670）写得很清楚：

> 与游戏内真实物理一致（entity.js）：每 tick 先位移，再 `v *= drag`、`vy = vy*drag - grav`
> 箭 / 雪球 / 鸡蛋 / 药水：drag 0.99、grav 0.05；末影珍珠：drag 0.99、grav 0.03

```js
for (let i=0; i<maxTicks; i++) {
  x += vx; y += vy; z += vz;
  if (isSolidAt(w, floor(x),floor(y),floor(z))) { pts.push([px,py,pz]); return {pts,land:[px,py,pz]}; }
  pts.push([x,y,z]);
  vx *= drag; vy = vy*drag - grav; vz *= drag;
  if (y < -70) return {pts,land:null};
}
```

`maxTicks`：手持预览 260（2854）、飞行轨迹 200（2906）、弹道解算 110（2743）。`land` 是撞到实心方块前最后一个空中点（不是方块坐标），这点在画落点圈时要记得。

**Java 实现路径**：`world.getBlockState(BlockPos).isSolid()` / `!isAir()` 替 `isSolidAt`；`Vec3d` 替数组；碰撞检测想更准就用 `world.raycast(new RaycastContext(...))`，但逐 tick 方块查询更贴原版行为。

### 5.2 `projParams` / `solveBallistic` / `leadPoint`

`projParams`（2806–2829）按手持物 key 给物性：

| key | speed | extraVy | grav | drag | color | 备注 |
|---|---|---|---|---|---|---|
| `bow` | `f*3` | 0 | 0.05 | 0.99 | `#5fd8ff` | `f=min(1,(t²+2t)/3)`, `t=useT/20` 封顶 1 |
| `crossbow` | `f*3.15` | 0 | 0.05 | 0.99 | `#5fd8ff` | 同 f |
| `ender_pearl` | 1.5 | 0 | **0.03** | 0.99 | `#55d6ff` | |
| `potion*` | 0.5 | 0.1 | 0.05 | 0.99 | `#55d6ff` | |
| `snowball/egg/exp_bottle/trident` | 1.5 | 0 | 0.05 | 0.99 | `#55d6ff` | |
| 其它 | — | — | — | — | — | `return null`，不画 |

弓的发射点有 `+lookDir*0.3` 水平偏移（2850–2852，注释「箭从 pos + lookDir×0.3 射出」），雪球/珍珠/药水无偏移。

`solveBallistic`（2730–2747）在 `yaw` 定死后，对 pitch 在 `[base-0.9, base+0.9]` 里扫 19 个角度，各跑一次 `simulateProj(...,aim)`，取 `sim.near`（整条轨迹离目标最近距离）最小的那个 pitch。`leadPoint`（2719–2729）用 4 次迭代逼近提前点：`t = d/speed; p = ce + vel*t`。`entityVel`（2700–2717）从 `__cometPrevPos` 的 30–400ms 差分估目标速度，clamp 到 ±0.8。

Java 侧 `player.getActiveItem()` / `player.getItemUseTime()` 直接给 `useT`，`player.getRotationVector()` 给 lookDir，`Entity#getVelocity()` 给飞行投射物的 `vel`（不用自己差分）。`bowAimState` 那套预判点（2862–2882）对应 Killaura/BowAim 模块，05 卷没覆盖，这里按「由瞄准模块提供一个 `Optional<Vec3d> aim`」的接口接入即可。

### 5.3 `strokeProj` / `drawLandMark`（2749–2804）

轨迹样式（446–447 `style`）：`光带`（默认）/ `细线` / `光点` / `关闭`。

- 光点：每隔 3 个点画一个 `arc(1.2+f*1.8)`，alpha `0.12+f*0.65`，`f=1-i/len`；
- 光带/细线：**分 4 段渐隐**，每段一次 `stroke`（注释 2767「比逐点 stroke 便宜，也没有虚线的廉价感」），`f=1-s/4`，光带 alpha `0.72*f`、线宽 `0.6+2.4*f`，细线 alpha `0.32*f`、线宽 1；
- `okPt`（2756–2757）把超出 `[-0.4W,1.4W]` 的点断开，避免相机后方的点被投影成贯穿屏幕的长竖线 —— **Java 版同样要防**：投影后 `clip.w <= 0` 的点直接跳过，见 §3.3。

`drawLandMark`（2788–2804）：落点画 `6*pulse` 的填充圈 + 描边 + 中心 `1.6` 实心点，`pulse=1+0.14sin(4t)`。

### 5.4 `ProjectileRenderer.java`

```java
package opus.hud.client.render;

import com.mojang.blaze3d.systems.RenderSystem;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.*;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.entity.projectile.ProjectileEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Vec3d;
import opus.hud.client.OpusHudClient;
import opus.hud.client.config.OpusConfig;
import org.joml.Matrix4f;

import java.util.ArrayList;
import java.util.List;

/** 手持预览 + 飞行中投射物预测轨迹 + 落点圈。对应 drawProjectiles 2834–2914。 */
public final class ProjectileRenderer {

    public static void register() {
        WorldRenderEvents.AFTER_ENTITIES.register(ProjectileRenderer::afterEntities);
    }
    public static void tick(net.minecraft.client.MinecraftClient mc) { /* 清理过期飞行轨迹缓存 */ }

    private record Sim(List<Vec3d> pts, Vec3d land, double near) {}

    private static void afterEntities(WorldRenderContext context) {
        OpusConfig.Projectile c = OpusHudClient.CONFIG.projectile;
        if (!c.enabled) return;
        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc.world == null || mc.player == null) return;
        float tickDelta = context.tickCounter().getTickDelta(true);
        Vec3d cam = context.camera().getPos();
        int color = c.trailColor.isEmpty() ? 0xFF55D6FF : ColorUtil.parseHex(c.trailColor, 1f);

        VertexConsumerProvider.Immediate imm = mc.getBufferBuilders().getEntityVertexConsumers();
        RenderSystem.disableDepthTest();
        RenderSystem.enableBlend();
        VertexConsumer lines = imm.getBuffer(RenderLayer.getLines());
        Matrix4f m = context.matrixStack().peek().getPositionMatrix();

        // 1) 手持预览：从 eye + lookDir*0.3(弓) 起跑 260 tick
        if (c.held) {
            ItemStack held = mc.player.getActiveItem().isEmpty()
                    ? mc.player.getMainHandStack() : mc.player.getActiveItem();
            ProjParams pp = params(held, mc.player.getItemUseTime());
            if (pp != null) {
                Vec3d dir = mc.player.getRotationVector();
                Vec3d eye = mc.player.getEyePos();
                double off = pp.bow ? 0.3 : 0;
                Vec3d o = eye.add(dir.x*off, 0, dir.z*off);
                Sim sim = simulate(mc, o,
                        new Vec3d(dir.x*pp.speed, dir.y*pp.speed + pp.extraVy, dir.z*pp.speed),
                        pp.grav, pp.drag, 260, null);
                stroke(lines, m, sim.pts, color, cam, c.style);
                if (c.land && sim.land != null) landMark(lines, m, sim.land, color, cam);
            }
        }

        // 2) 飞行中投射物：最多 8 个、96 格内，用实体自身 velocity 预测 200 tick
        if (c.flight) {
            int drawn = 0;
            for (var e : mc.world.getEntities()) {
                if (drawn >= 8 || !(e instanceof ProjectileEntity pe) || pe.isRemoved()) continue;
                if (pe.getPos().squaredDistanceTo(mc.player.getPos()) > 96*96) continue;
                double grav = pe.getType() == net.minecraft.entity.EntityType.ENDER_PEARL ? 0.03 : 0.05;
                Sim sim = simulate(mc, pe.getPos(), pe.getVelocity(), grav, 0.99, 200, null);
                stroke(lines, m, sim.pts, color, cam, c.style);
                if (c.land && sim.land != null) landMark(lines, m, sim.land, color, cam);
                drawn++;
            }
        }
        imm.draw();
        RenderSystem.enableDepthTest();
        RenderSystem.disableBlend();
    }

    /** simulateProj 的 1:1 移植（2671–2690）：先位移，碰实心方块退回上一空中点，再衰减速度。 */
    private static Sim simulate(MinecraftClient mc, Vec3d o, Vec3d v,
                                double grav, double drag, int maxTicks, Vec3d aim) {
        List<Vec3d> pts = new ArrayList<>();
        pts.add(o);
        double x=o.x, y=o.y, z=o.z, vx=v.x, vy=v.y, vz=v.z, near=Double.MAX_VALUE;
        for (int i = 0; i < maxTicks; i++) {
            double px=x, py=y, pz=z;
            x+=vx; y+=vy; z+=vz;
            if (aim != null) near = Math.min(near, Math.hypot(x-aim.x, y-aim.y, z-aim.z));
            BlockPos bp = new BlockPos((int)Math.floor(x),(int)Math.floor(y),(int)Math.floor(z));
            if (!mc.world.getBlockState(bp).isAir()) {
                pts.add(new Vec3d(px,py,pz));
                return new Sim(pts, new Vec3d(px,py,pz), near);   // land = 撞前空中点
            }
            pts.add(new Vec3d(x,y,z));
            vx*=drag; vy=vy*drag-grav; vz*=drag;
            if (y < -70) return new Sim(pts, null, near);
        }
        return new Sim(pts, null, near);
    }

    /** 4 段渐隐，对应 strokeProj 2767–2784。 */
    private static void stroke(VertexConsumer vc, Matrix4f m, List<Vec3d> pts,
                               int color, Vec3d cam, String style) {
        if (style.equals("关闭") || pts.size() < 2) return;
        float[] rgb = EspRenderer.rgb(color);
        if (style.equals("光点")) {
            for (int i = 0; i < pts.size(); i += 3) {
                float f = 1f - i/(float)pts.size();
                // 光点用一小段十字线近似 arc，避免引入 quad 批次
                Vec3d p = pts.get(i).subtract(cam);
                EspRenderer.line(vc, m, p.x-1-f, p.y, p.z, p.x+1+f, p.y, p.z, rgb, 0.12f+0.65f*f);
            }
            return;
        }
        int segs = 4, n = pts.size();
        for (int s = 0; s < segs; s++) {
            int a0 = n*s/segs, a1 = n*(s+1)/segs;
            float f = 1f - s/(float)segs;
            float alpha = (style.equals("细线") ? 0.32f : 0.72f) * f;
            for (int i = a0; i < a1-1; i++) {
                Vec3d p = pts.get(i).subtract(cam), q = pts.get(i+1).subtract(cam);
                // clip.w<=0 的点由 ScreenProjector 那套裁掉；这里用 cam 距离粗筛
                if (p.z > 0) continue;
                EspRenderer.line(vc, m, p.x,p.y,p.z, q.x,q.y,q.z, rgb, alpha);
            }
        }
    }

    private static void landMark(VertexConsumer vc, Matrix4f m, Vec3d land,
                                 int color, Vec3d cam) {
        float[] rgb = EspRenderer.rgb(color);
        Vec3d p = land.subtract(cam);
        double r = 0.3 * (1 + 0.14*Math.sin(System.currentTimeMillis()/250.0));
        for (int i = 0; i < 12; i++) {                 // 12 段近似脉冲圈
            double a0 = i*Math.PI/6, a1 = (i+1)*Math.PI/6;
            EspRenderer.line(vc, m, p.x+Math.cos(a0)*r, p.y+Math.sin(a0)*r, p.z,
                    p.x+Math.cos(a1)*r, p.y+Math.sin(a1)*r, p.z, rgb, 0.8f);
        }
    }

    private record ProjParams(double speed, double extraVy, double grav, double drag, boolean bow) {}
    private static ProjParams params(ItemStack held, int useT) {
        if (held.isOf(Items.BOW) || held.isOf(Items.CROSSBOW)) {
            float t = Math.max(0, Math.min(1, useT/20f));
            float f = Math.min(1, (t*t + t*2)/3);           // 2817 releaseBow
            if (f < 0.1f) return null;
            return new ProjParams(f*(held.isOf(Items.CROSSBOW)?3.15:3), 0, 0.05, 0.99, true);
        }
        if (held.isOf(Items.ENDER_PEARL)) return new ProjParams(1.5,0,0.03,0.99,false);
        if (held.isOf(Items.SPLASH_POTION) || held.isOf(Items.LINGERING_POTION))
            return new ProjParams(0.5,0.1,0.05,0.99,false);
        if (held.isOf(Items.SNOWBALL)||held.isOf(Items.EGG)
                ||held.isOf(Items.EXPERIENCE_BOTTLE)||held.isOf(Items.TRIDENT))
            return new ProjParams(1.5,0,0.05,0.99,false);
        return null;
    }
}
```

> `ItemEntity` 之外的 `ProjectileEntity` 判定比网页版 `/Snowball|Egg|Pearl|.../.test(constructor.name)`（2896）干净。`leadMark` 那块菱形 + `预判 X.Xm` 文字（2865–2880）交给 `HudRenderCallback` + `ScreenProjector` 画，别塞进 `VertexConsumer` 批次。

---

## 6. 雷达

### 6.1 `drawRadar`（2916–2991）

`rctx` 是独立 120×120 canvas，CSS `#__comet_radar` 固定 `right:12 bottom:12`、圆形（9350–9353）。绘制用 `setTransform(2,0,0,2,0,0)` —— 又是 ×2 的设计像素。

- `R = size/2 - 3 = 57`，`scale = R / max(8, esp.distance*0.5)`（2939，默认 `R/32`）；
- 坐标映射 `px = cx + dx*scale`（+X 向东 → 右）、`py = cy - dz*scale`（+Z 向北 → 上），**正北朝上，不随玩家朝向旋转**（2938 注释）；
- `arc(cx,cy,R)` 后 `clip()` 做圆形裁剪（2944），渐变底 `rgba(52,52,52,.82)→rgba(22,22,22,.82)`，中间画一圈 `R/2` 的虚线圈；
- 实体点：生物 `colorOf(e)` 半径 2.5，掉落物 `#ffd54f` 半径 1.6，超出 `lim = esp.distance*0.5` 的不画；
- 外圈描边 + 四个方位字（北/东/南/西）+ 中心固定白色三角箭头（指北，不旋转）。

**Java 实现路径**：`HudRenderCallback` 里画。圆形裁剪 —— `RenderSystem.enableScissor` 只能矩形，所以要么用 stencil，要么把圆拆成水平线段填。最省事的是**逐行水平填充圆**：对 `dy` 从 `-R` 到 `R`，`half = sqrt(R²-dy²)`，`fill(cx-half, cy+dy, cx+half, cy+dy+1, color)`，渐变底就按行插值颜色。实体点、方位字、箭头都用 `fill`/`drawText` 画在圆内，圆外的点用 `hypot > R` 直接跳过 —— 连 scissor 都不用。

### 6.2 完整骨架 ③ `RadarRenderer.java`

```java
package opus.hud.client.render;

import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.entity.Entity;
import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.text.Text;
import opus.hud.client.OpusHudClient;
import opus.hud.client.config.OpusConfig;

/** 正北朝上圆形雷达。对应 drawRadar 2916–2991。 */
public final class RadarRenderer {

    public static void register() {
        HudRenderCallback.EVENT.register((DrawContext ctx, var tickCounter) -> {
            render(ctx, tickCounter.getTickDelta(true));
        });
    }

    static void render(DrawContext ctx, float tickDelta) {
        OpusConfig c = OpusHudClient.CONFIG;
        if (!c.hud.enabled || !c.hud.radar) return;
        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc.world == null || mc.player == null) return;

        int size = 120;                       // 设计 120，×2 = 240 CSS 像素
        int cx = size/2, cy = size/2, R = size/2 - 3;
        // 屏幕定位：right:12 bottom:12（CSS），这里换成左上角坐标
        int ox = mc.getWindow().getScaledWidth()  - size - 24;
        int oy = mc.getWindow().getScaledHeight() - size - 24;
        float scale = R / Math.max(8f, c.esp.distance * 0.5f);   // 2939

        // 1) 圆形渐变底：逐行水平填充（替代 arc+clip）
        for (int dy = -R; dy <= R; dy++) {
            int half = (int) Math.sqrt((double)R*R - dy*dy);
            float t = (dy + R) / (2f * R);
            int col = lerp(0xD0343434, 0xD0161616, t);
            ctx.fill(ox + cx - half, oy + cy + dy, ox + cx + half, oy + cy + dy + 1, col);
        }
        // 中圈 R/2 的虚线：用点画近似
        for (int i = 0; i < 48; i++) {
            double a = i*Math.PI/24;
            int px = ox + cx + (int)(Math.cos(a)*R/2), py = oy + cy + (int)(Math.sin(a)*R/2);
            ctx.fill(px, py, px+1, py+1, 0x38A0A0A0);
        }

        // 2) 实体点：+X 向右（东），+Z 向上（北），不随朝向旋转
        double px0 = mc.player.getX(), pz0 = mc.player.getZ();
        double lim = c.esp.distance * 0.5;
        for (Entity e : mc.world.getEntities()) {
            if (e == mc.player || e.isRemoved()) continue;
            double dx = e.getX()-px0, dz = e.getZ()-pz0;
            if (dx*dx + dz*dz > lim*lim) continue;
            int sx = ox + cx + (int)(dx*scale), sy = oy + cy - (int)(dz*scale);
            boolean mob = e instanceof LivingEntity;
            int color = mob ? EspRenderer.entityColor(e, c) : 0xFFFFD54F;
            int rad = mob ? 3 : 2;
            ctx.fill(sx-rad, sy-rad, sx+rad, sy+rad, color | 0xFF000000);
        }

        // 3) 外圈 + 方位字 + 中心指北箭头
        outline(ctx, ox, oy, cx, cy, R, 0x73C8C8C8);
        var tr = mc.textRenderer;
        ctx.drawText(tr, Text.literal("北"), ox+cx-3, oy+4, 0xCCFFFFFF, false);
        ctx.drawText(tr, Text.literal("南"), ox+cx-3, oy+size-12, 0xCCFFFFFF, false);
        ctx.drawText(tr, Text.literal("西"), ox+2, oy+cy-4, 0x80FFFFFF, false);
        ctx.drawText(tr, Text.literal("东"), ox+size-10, oy+cy-4, 0x80FFFFFF, false);
        // 固定三角箭头（2987–2990）
        for (int dy = 0; dy < 10; dy++) {
            int half = dy * 4 / 10;
            ctx.fill(ox+cx-half, oy+cy-6+dy, ox+cx+half, oy+cy-5+dy, 0xFFFFFFFF);
        }
    }

    private static void outline(DrawContext ctx, int ox,int oy,int cx,int cy,int R,int col) {
        for (int i = 0; i < 360; i++) {
            double a = Math.toRadians(i);
            int x = ox+cx+(int)(Math.cos(a)*R), y = oy+cy+(int)(Math.sin(a)*R);
            ctx.fill(x, y, x+1, y+1, col);
        }
    }
    private static int lerp(int a, int b, float t) {
        int ar=(a>>16)&255, ag=(a>>8)&255, ab=a&255;
        int br=(b>>16)&255, bg=(b>>8)&255, bb=b&255;
        return (a & 0xFF000000) | ((int)(ar+(br-ar)*t)<<16)
                | ((int)(ag+(bg-ag)*t)<<8) | (int)(ab+(bb-ab)*t);
    }
}
```

> 雷达和 05 卷的 `TargetHudRenderer`、本卷的 `HudElementsRenderer` 都注册在同一个 `HudRenderCallback.EVENT` 上，Fabric 会按注册顺序依次回调，各自画各自的区域，不冲突。想控制层级就调整 `OpusHudClient` 里的 register 顺序。

---

## 7. 小地图与罗盘

### 7.1 `drawMinimap`（4494–4580）

`miniCanvas` 是 360×360（4444），CSS `#__comet_minimap` 固定右上（4498 `applyPanelPos(...'right','top',16,16)`），`size` 设置 120–320（默认 180），`zoom` 视野半径 16–128（默认 48，`R`）。

- 圆形裁剪 `arc(cx,cy,rad)` + `clip()`，`rad = S/2-6`（4504–4509），底 `rgba(10,14,22,.72)`；
- 地形着色：`refreshTerrain(g, c[0], c[2], R, floor(c[1]))` 生成 64×64 像素，`imageSmoothingEnabled=false` 后 `drawImage` 铺满圆，`globalAlpha=0.88`（4515–4521）。`blockRGB(id)`（4451–4463）按方块 key 给颜色：水 `[58,123,213]`、草/泥 `[95,154,69]`、沙 `[217,199,131]`、雪/冰 `[232,242,247]`、石 `[139,139,139]`、木/叶 `[107,143,74]`，兜底按 `id*37%60` 生成灰绿。
- 距离圈 `0.33/0.66/1` 三圈（4523–4524）；
- 实体点：`sx = cx+(q[0]-c[0])/R*rad`、`sy = cy+(q[2]-c[2])/R*rad`（注意 **+Z 向下**，和雷达相反，这是网页版小地图的朝向），敌对红 `#ff5252` / 被动蓝 `#4fc3f7` / 掉落物黄 `#ffd54f`；
- 路径点菱形 + 名字（4541–4556）、玩家箭头按 `-yaw` 旋转（4557–4562）、外圈 + N/S/W/E + 底部 `x / z` 坐标（4568–4579）。

**Java 实现路径**：地形贴图用 `NativeImage` 动态生成 + `NativeImageBackedTexture` 注册（和 05 卷 `FaceTextureHelper.buildCrop` 同一套手法），每 700ms 刷新一次（对应 `terrainAt`/4465 附近的节流）；`world.getBlockState(x, y, z)` 采样顶层方块 → `blockRGB` 配色写进 `NativeImage`；圆形裁剪同 §6.1 的逐行填充。实体点、路径点、箭头用 `fill`/`drawText`。

```java
// MinimapRenderer 里地形刷新的核心，其余布局照 drawMinimap 逐行搬
private static Identifier refreshTerrain(MinecraftClient mc, int px, int pz, int R, int py) {
    long now = System.currentTimeMillis();
    if (terrainId != null && now - terrainAt < 700) return terrainId;   // 节流
    terrainAt = now;
    NativeImage img = new NativeImage(64, 64, false);
    for (int z = 0; z < 64; z++) {
        for (int x = 0; x < 64; x++) {
            int wx = px + (x-32) * R / 32, wz = pz + (z-32) * R / 32;
            var state = mc.world.getBlockState(new BlockPos(wx, py, wz));
            int[] rgb = blockRgb(state);                 // 4451 的配色表
            img.setColor(x, z, 0xFF000000 | (rgb[0]<<16)|(rgb[1]<<8)|rgb[2]);
        }
    }
    terrainId = Identifier.of("opus-hud", "minimap_terrain");
    mc.getTextureManager().registerTexture(terrainId, new NativeImageBackedTexture(img));
    return terrainId;
}
```

### 7.2 `drawCompass`（2993–3080）

300×40 的条（2994），`setTransform(2,...)` 又是 ×2。关键参数：

```js
const deg = (yawDeg(num(p,'yaw')) ?? 0) + 180;
const bearing = ((deg%360)+360)%360;      // 0=正北，90=东，游戏 +Z 为北、+X 为东
const pxPerDeg = 9, stripBottom = 27;
const CLOCK = {0:'12点',45:'1:30',90:'3点',135:'4:30',180:'6点',225:'7:30',270:'9点',315:'10:30'};
```

每 5° 画一根刻度（3027–3043），`diff = ((a - bearing + 180)%360+360)%360 - 180`，`x = w/2 + diff*pxPerDeg`， `%90` 大刻度 9px 白、`%45` 中刻度 6px + `CLOCK[a]` 文字、其余 3px。`compassMarks`（3046–3073）把 `cfg.waypoints` 按方位角 `atan2(dx,dz)` 嵌进条里，屏外的画三角箭头、条内的画菱形 + 名字 + `dist m`。中心一根白指示线（3075–3079）。

「经纬度」其实是坐标：小地图底部 `floor(c[0])+' / '+floor(c[2])`（4578），罗盘本身不写坐标，团队要求的经纬度我在 Java 版罗盘下方补一行 `x / z`。

**Java 实现路径**：`HudRenderCallback` 里按 `player.getYaw(tickDelta)` 算 bearing，循环 `a=0..360 step 5` 画 `fill` 竖线 + `drawText` 方位字，路径点复用 `WaypointState`（§8.4）。`CompassRenderer` 骨架和 `RadarRenderer` 同构，这里给关键循环：

```java
int w = 300, h = 40, ox = ..., oy = ...;
float yaw = mc.player.getYaw(tickDelta);
float bearing = (yaw + 180f + 360f) % 360f;
int pxPerDeg = 9, bottom = 27;
ctx.fill(ox, oy, ox+w, oy+h, 0xD0343434);            // 渐变底用逐列 lerp
for (int a = 0; a < 360; a += 5) {
    float diff = ((a - bearing + 180) % 360 + 360) % 360 - 180;
    int x = ox + w/2 + (int)(diff * pxPerDeg);
    if (x < ox+6 || x > ox+w-6) continue;
    boolean big = a % 90 == 0, mid = a % 45 == 0;
    int len = big ? 9 : mid ? 6 : 3;
    ctx.fill(x, oy+bottom-len, x+1, oy+bottom-1, big?0xCCFFFFFF:mid?0x80FFFFFF:0x38FFFFFF);
    if (mid) ctx.drawText(tr, Text.literal(CLOCK.get(a)), x-8, oy+4, 0xCCFFFFFF, false);
}
// 中心指示 + x/z
ctx.fill(ox+w/2, oy+bottom-7, ox+w/2+2, oy+bottom, 0xFFFFFFFF);
ctx.drawText(tr, Text.literal((int)mc.player.getX()+" / "+(int)mc.player.getZ()),
        ox+w/2-20, oy+h-8, 0xCCFFFFFF, false);
```

### 7.3 `MinimapRenderer.java` 骨架

```java
public final class MinimapRenderer {
    public static void register() {
        HudRenderCallback.EVENT.register((DrawContext ctx, var t) -> render(ctx, t.getTickDelta(true)));
    }
    static void render(DrawContext ctx, float tickDelta) {
        OpusConfig.Minimap c = OpusHudClient.CONFIG.minimap;
        if (!c.enabled) return;
        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc.world == null || mc.player == null) return;
        int S = c.size, cx = S/2, cy = S/2, rad = S/2-6, R = c.zoom;
        int ox = mc.getWindow().getScaledWidth() - S - 32, oy = 32;   // right/top 16 ×2
        // 圆形底（逐行填充，同 RadarRenderer）
        for (int dy=-rad; dy<=rad; dy++) { /* ... */ }
        if (c.terrain) {
            Identifier tex = refreshTerrain(mc, (int)mc.player.getX(), (int)mc.player.getZ(),
                                           R, (int)mc.player.getY());
            ctx.drawTexture(RenderLayer::getGuiTextured, tex,
                    ox+cx-rad, oy+cy-rad, 0f,0f, rad*2,rad*2, rad*2,rad*2);
        }
        // 三圈距离环、实体点、路径点、按 -yaw 旋转的玩家箭头、N/S/W/E、x/z
        // 逐项照 drawMinimap 4522–4579 搬，坐标全部用 DrawContext.fill / drawText。
    }
    // refreshTerrain / blockRgb 见 §7.1
}
```

> 圆形裁剪、`drawImage` 缩放、`shadowBlur`、CSS 圆角全是 Canvas/DOM 特有，Java 侧分别换成「逐行水平填充」「`drawTexture`」「叠一层半透明描边」「直接用 `fill` 直角」。地形贴图是唯一一处需要 `NativeImage` 的地方，也是小地图里最值钱的一块，值得单独做。

---

## 8. 方块 / 容器 / 路径点 / 掉落物

### 8.1 准星方块高亮 `drawBlockEsp`（2272–2310）

取 `g.target.pos`（准星命中点）或 `g.breaking.pos`，`floor` 成方块坐标，投影 8 个角（2283–2287）。填充：四个面 `[[0,1,3,2],[4,5,7,6],[0,1,5,4],[2,3,7,6]]` 用 `hexToRgba(color,0.13)`；线框：12 条边、`color` 默认金 `#ffd54f`、`lineWidth = max(1, width)`（默认 2）、`shadowBlur 9`。

**Java 实现路径**：`client.crosshairTarget` 是 `BlockHitResult` 时取 `getBlockPos()`，比网页版读 `g.target` 稳。半透明填充不能只画线 —— 得用 `RenderLayer.getTranslucent()` 的 quad，或者退一步只画 12 条边（网页版填充是锦上添花）。我在 `BlockRenderer` 里给一个 `drawFilledBox` 用 `VertexConsumer` 画 6 个面。

### 8.2 方块追踪 `drawBlockTracker`（3890–3937）

`scanBlocks()` 按 `blockesp.target`（默认 `diamond_ore`）扫周围区块，半径 48、上限 120（554–555）。每个命中画 8 角线框 + 填充 + `dist m` 标签（`dist<48`）；`bad`（投影超界）时若 `edge` 开，用 `edgePoint()`（3122）算屏外箭头。Java 侧 `world.getStatesInBox(Box)` 或 `BlockPos` 遍历 + `Registries.BLOCK` 匹配，比网页版 `scanBlocks` 直接。

### 8.3 区块边界 `extChunkBorders`（5490–5525）

`ccx = floor(x/16), ccz = floor(z/16)`，`rad` 默认 2、`height` 默认 24、`color` 默认青 `#4fe8e0`。两组循环分别画 X=常数和 Z=常数的竖线（从 `c[1]` 到 `c[1]+height`），`hexToRgba(color,0.55)`、线宽 1。Java 侧 `ChunkPos` + `getLines()` 照搬，注意 `height` 是从玩家脚底往上，不是从 y=0。

### 8.4 路径点 `drawWaypoints`（4387–4439）+ 引导线 `extWaypointLine`（7228–7258）

- 光柱：底 `w.y+0.05`、顶 `w.y + min(24, 4+dist*0.12)`，`createLinearGradient` 顶透明→底 0.6，顶上一个随距离缩放的菱形 `s = clamp(900/(dist+8), 4, 11)`，再画 `name + dist m` 标签；
- 屏外：`edgePoint(dx,dz)` 给屏幕边缘点，画 6px 圆点 + 距离；
- 引导线：从准星（屏幕中心）到最近路径点投影点，虚线 `[6,5]`、`color` 跟随 `wp.color`、末端 `name + dist m`。

`WaypointState` 存 `List<Waypoint>{name,x,y,z,color}`，由 `addWaypoint`（4360）/`markHere` 写、Gson 存进 config。Java 侧光柱、引导线、菱形都在 `AFTER_ENTITIES` 里画 3D（`RenderLayer.getLines()`），屏外箭头走 `HudRenderCallback` + `ScreenProjector`。`createLinearGradient` 和 `setLineDash` 都是网页特有：前者逐顶点 alpha，后者用「画一段、空一段」的短线段拼。

### 8.5 容器 ESP `drawContainerEsp`（7583–7649）

`scanContainers()` 找箱子/木桶/熔炉/发射器/漏斗/潜影盒等 `BlockEntity`，每类有独立框色与线色（`f_chest/t_chest/...` 673–705，12 类）。参数：`range` 40、`width` 1.6、`tracer` 默认开、`labels` 默认开。每个命中画 8 角线框（alpha `fade = max(0.3, 1-dist/(R*1.3))`）+ 0.08 填充矩形 + 虚线追踪（`[4,4]`）+ `dist<32` 时名字标签 `kind.cn + ' ' + dist + 'm'`。

**Java 实现路径**：`world.blockEntities` 或 `Chunk` 里遍历 `BlockEntity`，按 `instanceof ChestBlockEntity / BarrelBlockEntity / FurnaceBlockEntity / ...` 分类，颜色表照 680–705 抄成 `Map<Class<?>, int[]>`。比网页版按字符串猜可靠。

### 8.6 掉落物 3D 框 `extDropBoxes`（5201–5250）+ 汇总

`drops` 模块（619–631）：`range` 32、`max` 10、`worldTags`（世界内名字距离，由 05 卷 nametags 负责）、`worldBoxes`（3D 框）、`hideTags`、`xp`。框：`hw=hh=0.24` 的小立方体，`fade = max(0.25, 1-dist/(R*1.2))`（5237），最多 60 个。汇总面板是另一块 DOM（`extBox` 5261 起），Java 侧走 `HudRenderCallback` 画一个列表。

### 8.7 `BlockRenderer.java`（方块/容器/边界/路径点/掉落物汇总）

```java
package opus.hud.client.render;

import com.mojang.blaze3d.systems.RenderSystem;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.*;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.entity.ItemEntity;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;
import opus.hud.client.OpusHudClient;
import opus.hud.client.state.WaypointState;
import org.joml.Matrix4f;

/** 准星方块框、方块追踪、区块边界、容器 ESP、掉落物框、路径点光柱/引导线。 */
public final class BlockRenderer {

    public static void register() {
        WorldRenderEvents.AFTER_ENTITIES.register(BlockRenderer::afterEntities);
    }

    private static void afterEntities(WorldRenderContext context) {
        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc.world == null || mc.player == null) return;
        var c = OpusHudClient.CONFIG;
        float tickDelta = context.tickCounter().getTickDelta(true);
        Vec3d cam = context.camera().getPos();
        Matrix4f m = context.matrixStack().peek().getPositionMatrix();
        VertexConsumerProvider.Immediate imm = mc.getBufferBuilders().getEntityVertexConsumers();

        RenderSystem.disableDepthTest();
        RenderSystem.depthMask(false);
        RenderSystem.enableBlend();
        RenderSystem.defaultBlendFunc();
        VertexConsumer lines = imm.getBuffer(RenderLayer.getLines());

        // 1) 准星方块：3D 线框（2272–2310）
        if (c.blockEsp.enabled && mc.crosshairTarget instanceof BlockHitResult bhr) {
            BlockPos bp = bhr.getBlockPos();
            Box b = new Box(bp);
            float[] gold = {1f, 0.835f, 0.306f};       // #ffd54f
            drawBox(lines, m, b, cam, gold, 0.9f);
            // 填充（2291–2297）：走 translucent quad，见 drawFill 说明
        }

        // 2) 方块追踪（3890–3937）
        if (c.blockEsp.enabled) {
            int R = c.blockEsp.radius;
            BlockPos center = mc.player.getBlockPos();
            for (BlockPos p : BlockPos.iterate(center.add(-R,-R,-R), center.add(R,R,R))) {
                if (!matches(p, c.blockEsp.target, mc)) continue;
                float fade = Math.max(0.3f, 1f - (float)Math.sqrt(p.getSquaredDistance(center)) / (R*1.3f));
                drawBox(lines, m, new Box(p), cam, gold, fade);
            }
        }

        // 3) 区块边界（5490–5525）
        if (c.chunkBorder.enabled) drawChunkBorders(lines, m, cam, c.chunkBorder);

        // 4) 容器 ESP（7583–7649）
        if (c.containerEsp.enabled) {
            for (BlockEntity be : mc.world.blockEntities) {
                double d = be.getPos().toCenterPos().distanceTo(mc.player.getPos());
                if (d > c.containerEsp.range) continue;
                float[] col = containerColor(be);
                float fade = Math.max(0.3f, 1f - (float)d / (c.containerEsp.range*1.3f));
                drawBox(lines, m, new Box(be.getPos()), cam, col, fade);
                if (c.containerEsp.tracer) {                 // 虚线追踪：短线段拼接
                    Vec3d to = be.getPos().toCenterPos().subtract(cam);
                    dashed(lines, m, 0,0,0, to.x,to.y,to.z, col, fade*0.75f);
                }
            }
        }

        // 5) 掉落物 3D 框（5201–5250）
        if (c.drops.worldBoxes) {
            int drawn = 0;
            for (var e : mc.world.getEntities()) {
                if (drawn >= 60 || !(e instanceof ItemEntity ie)) continue;
                Vec3d p = ie.getLerpedPos(tickDelta);
                double d = p.distanceTo(mc.player.getPos());
                if (d > c.drops.range) continue;
                float fade = Math.max(0.25f, 1f - (float)d/(c.drops.range*1.2f));
                drawBox(lines, m, Box.of(p, 0.48, 0.48, 0.48), cam,
                        new float[]{1f,0.84f,0.31f}, fade);         // hw=hh=0.24 → 边长 0.48
                drawn++;
            }
        }

        // 6) 路径点光柱 + 引导线（4387–4439 / 7228–7258）
        if (c.waypoints.enabled) {
            for (WaypointState.Waypoint w : WaypointState.ALL) {
                double dx=w.x-cam.x, dy=w.y-cam.y, dz=w.z-cam.z;
                float[] col = EspRenderer.rgb(w.color);
                double top = dy + Math.min(24, 4 + Math.hypot(w.x-mc.player.getX(), w.z-mc.player.getZ())*0.12);
                // 光柱渐变：8 段逐顶点 alpha，取代 createLinearGradient
                for (int i=0;i<8;i++) {
                    float f0=i/8f, f1=(i+1)/8f;
                    double y0=dy+(top-dy)*f0, y1=dy+(top-dy)*f1;
                    EspRenderer.line(lines,m, dx,y0,dz, dx,y1,dz, col, (float)(0.6*(1-f0)));
                }
                dashed(lines,m, 0,0,0, dx,dy+0.5,dz, col, 0.75f);   // 准星引导线
            }
        }

        imm.draw();
        RenderSystem.depthMask(true);
        RenderSystem.enableDepthTest();
        RenderSystem.disableBlend();
    }

    /** AABB 12 条边，复用 05 卷 EspRenderer 的 BOX_EDGES。 */
    public static void drawBox(VertexConsumer vc, Matrix4f m, Box b, Vec3d cam,
                               float[] rgb, float a) {
        double[][] v = EspRenderer.corners(
                b.minX-cam.x, b.minY-cam.y, b.minZ-cam.z,
                b.maxX-cam.x, b.maxY-cam.y, b.maxZ-cam.z);
        for (int[] ed : EspRenderer.BOX_EDGES) {
            double[] p=v[ed[0]], q=v[ed[1]];
            EspRenderer.line(vc,m, p[0],p[1],p[2], q[0],q[1],q[2], rgb, a);
        }
    }

    /** setLineDash([6,5]) / ([4,4]) 的等价物：按长度切成 6 段画、隔段跳过。 */
    private static void dashed(VertexConsumer vc, Matrix4f m,
                               double x1,double y1,double z1,
                               double x2,double y2,double z2, float[] rgb, float a) {
        int seg = 12;
        for (int i=0;i<seg;i+=2) {
            double t0=i/(double)seg, t1=(i+1)/(double)seg;
            EspRenderer.line(vc,m,
                    x1+(x2-x1)*t0, y1+(y2-y1)*t0, z1+(z2-z1)*t0,
                    x1+(x2-x1)*t1, y1+(y2-y1)*t1, z1+(z2-z1)*t1, rgb, a);
        }
    }

    private static void drawChunkBorders(VertexConsumer vc, Matrix4f m, Vec3d cam, Object cfg) { /* §8.3，逐 16 格画竖线 */ }
    private static boolean matches(BlockPos p, String target, MinecraftClient mc) { /* Registries.BLOCK 匹配 */ return false; }
    private static float[] containerColor(BlockEntity be) { /* 680–705 的 12 类配色表 */ return new float[]{1f,0.78f,0.34f}; }
}
```

> 半透明填充（`drawBlockEsp` 2291–2297、容器 7628）没在骨架里展开：`RenderLayer.getLines()` 只能画线，填充要另开一个 `RenderLayer.getTranslucent()` 批次，用 `VertexConsumer.vertex(...).color(...).next()` 画 6 个 quad（每面 4 顶点，注意 1.21.1 的 quad 要 `.next()` 收尾两次或用 `drawQuad`）。做法和 3D 线框完全同构，只是 layer 换成 translucent、顶点数翻倍，照 2293 那四个面的顶点索引拼即可。

---

## 9. 背包 / 装备耐久 / 掉落物汇总

### 9.1 `updateInventory`（4614–4645）

`invhud` 模块（608–616）：`full`（默认 false）、`names`（默认 true）、`scale` 0.8–1.6。DOM 是 `#__comet_inv`（4609），`full ? 36 : 9` 格，每格显示中文物品名 + 数量（`count>1`），选中格 `i === inv.sel` 加 `.sel` 类，物品按 `abs(id)%8` 上 8 色之一。整块用 `transform: scale(var(--cm-inv-scale))` 缩放（9655）。

**Java 实现路径**：`HudRenderCallback` 里读 `mc.player.getInventory().main.get(i)`（`ItemStack`），`getName().getString()` 给中文名（语言文件自动本地化，比网页版 `itemName(id)` 查表强），`getCount()` 给数量，`getInventory().selectedSlot` 给选中格。画 N×M 格子 + 物品图标（`ctx.drawItem(stack, x, y)` 是 1.21.1 `DrawContext` 的方法，直接画真实物品图标，比色块好得多）+ 数量角标。整块缩放用 `ctx.getMatrices().scale()`。

```java
private void drawInventory(DrawContext ctx, MinecraftClient mc) {
    var c = OpusHudClient.CONFIG.invHud;
    if (!c.enabled) return;
    var inv = mc.player.getInventory();
    int n = c.full ? 36 : 9, cols = 9, cell = 20;
    ctx.getMatrices().push();
    ctx.getMatrices().scale(c.scale, c.scale, 1f);
    for (int i = 0; i < n; i++) {
        int x = (i % cols) * cell, y = (i / cols) * cell;
        ctx.fill(x, y, x+cell-2, y+cell-2, i == inv.selectedSlot ? 0x80B06BFF : 0x80101018);
        ItemStack s = inv.main.get(i);
        if (!s.isEmpty()) {
            ctx.drawItem(s, x+2, y+2);                         // 真实物品图标
            if (s.getCount() > 1)
                ctx.drawText(mc.textRenderer, Text.literal(String.valueOf(s.getCount())),
                        x+cell-10, y+cell-10, 0xFFFFFFFF, true);
            if (c.names && i < 9)
                ctx.drawText(mc.textRenderer, Text.literal(s.getName().getString()),
                        x, y-8, 0xFFDCE4F0, false);
        }
    }
    ctx.getMatrices().pop();
}
```

### 9.2 装备耐久 `extArmorRows`（5569–5592）

读 `inv.slots[36..39]` 四件盔甲 + `inv.held`，`pct = clamp(1 - damage/maxDurability, 0, 1)`（5578–5581），`extHudB()`（5854–5885）把每行渲染成 `名称 + 中文名 + 一条 `<i class="cm-extfill" data-w="pct%">` 的 CSS 宽度条。

**Java 实现路径**：`ItemStack#getDamage() / getMaxDamage()` 直接给，`1 - damage/maxDamage` 照搬；`player.getArmorItems()` 遍历 4 件，`player.getMainHandStack()` 手持。画 5 行：`drawItem` 图标 + 名字 + 底条（`fill` 黑）+ 填充条（按 pct 绿→黄→红）。耐久比例和 05 卷名牌血条的三档配色（2608）可以共用同一个 `pctColor()`。

### 9.3 掉落物汇总面板

`drops` 的 `max` 10 条、`range` 32、`hideTags` 控制是否隐藏散标签（由 05 卷 nametags 的 `dropSummary` 分支 2550–2552 配合）。Java 侧统计 `world.getEntitiesByClass(ItemEntity.class, Box)`，按物品名聚合 count，排序取前 10，`HudRenderCallback` 画一个列表。和 `extDropBoxes` 的分工（一个画汇总 DOM、一个画世界 3D 框）保持不变。

---

## 9A. 扩展模块补遗（EXT_MODULES B / C / D / E 组）

主表 50 个模块之外，源码还在 4653 / 5384 / 6128 / 6644 / 7171 五行定义了五组 `EXT_MODULES_*`，每组末尾都是同一段注册代码（以 B 组 5477–5481 为例）：

```js
for (const em of EXT_MODULES_B) {
  MODULES.push(em);
  MODS_BY_ID[em.id] = em;
  if (cfg.states[em.id] === undefined) cfg.states[em.id] = !!em.state;
}
```

也就是说扩展模块和主表**完全共用** `cfg.states`（开关 → `modOn(id)`）、`cfg.settings['id.key']`（设置 → `getS(id,key)` / `extVal`）、`MODS_BY_ID`，没有第二条配置通道。07 卷写统一注册表时按模块 id 直接引用即可，这里不另起一套。

**接线结构别理解错**：扩展模块不是「一个模块一个 `tickXxx`」，而是三条共享分组管线 —— `extTick / extTickB / extTickC / extTickD`（1749–1752，由 `tickModules()` 3107 调）、`extRenderB / C / D / E`（2461–2465，由 `espFrame()` 调）加 `extDropBoxes`（2461）、`extHud / extHudB / C / D / E`。`extSelfTest()`（6999–7006）用一张 `fns` 表把这十几个函数挨个 `typeof` 检查，接线丢了会在自检里报「函数缺失」。开关靠 `extOn(id)`（4859，就是 `modOn` 的一行包装）和 `extVal(key, def)`（4855–4858，把 `'id.key'` 拆开喂给 `getS`，取不到退默认值）在分组函数**内部**分流。所以下面写「JS 要点」时，贴源码的说法是「走 `extRenderX` 分组管线 + `extOn(id)` 开关」，而不是「模块有自己的独立循环」。Java 侧没这个约束：`ClientTickEvents.END_CLIENT_TICK` 一个泵里按 `cfg.xxx.enabled` 分支即可，见 §1 的 `GameplayTicker` 与 09 卷 §1。

**源码 cat 归属**（07 卷按 `ModuleCategory` 枚举分组时以这个为准，别把补遗这批全当成 `render`）：`combat` 有 `hitmarker`（5428）、`antikb`（5469）、`lowhp`（6167）、`damageindicator`（6646）；`misc` 有 `entityinfo`（7189）、`music`（主表 634）；其余 `lightoverlay / potionhud / fpsgraph / crosshair / zoom / entitytrail / blockoutline` 才是 `render`。行号按模块 id 定位：B 组 5384–5477（lightoverlay 5395、potionhud 5412、fpsgraph 5420、hitmarker 5428、crosshair 5447、zoom 5460、antikb 5469），C 组 lowhp 6167 / 绘制 6315，D 组 damageindicator 6646、entitytrail 6715 / 函数定义 6885 / 分发点 7024（`extRenderD`），E 组 blockoutline 7181、entityinfo 7189；两个具体绘制入口 `extDrawCrosshair` 5755、`extApplyZoom` 5799。

前面章节已经覆盖了 `chunkborder`（§8.3）、`armorhud`（§9.2）、`damagenumbers`（§3.1）、`healthbar`（§3.2）、`waypointline`（§8.4）、`invhud`（§9.1）、`drops`（§9.3）、`minimap`（§7.1）。这一节把剩下的 HUD / 渲染 / 战斗提示类补齐 —— index-doc 提醒别漏的那批。事件与 Mixin 目标的**逐模块总表**在 08 卷 §1（100 个模块按 cat 分组），模块 id / 中文名 / cat / 主责分卷在 README §2.4；06 卷这里给的是按「完整可落地 Java 代码」要求写的绘制实现，与 08 卷的对照表互补，不冲突。

### 9A.1 逐项要点

| 模块 id | JS 函数 / 行号 | 参数（`getS/extVal` 默认值） | Java 实现路径 |
|---|---|---|---|
| `lightoverlay` | `extLightOverlay` 5528 | `radius` 10（4–24）、`threshold` 7（0–12）、`alpha` 35（10–80） | `world.getLightLevel(BlockPos)` 采样、700ms 缓存（`extB.lightCache/lightAt` 5536），暗处格子投影到屏幕后 `fill` 红色方块。纯客户端，安全 |
| `potionhud` | `extEffects` 5593 / `extHudB` 5874–5882 | `show` true、`max` 6（2–12） | `player.getStatusEffects()` → `StatusEffectInstance#getAmplifier()/getDuration()`，显示 `中文名 + (amp+1)` 与剩余时间，`HudRenderCallback` 画列表 |
| `fpsgraph` | `extDrawGraph` 5629–5663 | `height` 50（30–120）、`color` 空=`#6ee7a5` | 扩 `HudState.fpsHist` 成 60 长度环形缓冲，`max=max(60,...hist)`，`y = h - fps/max*(h-6)-3`，背景 4 条 1/4 网格线，右上角当前 fps。位置 `right/bottom 16,210` |
| `hitmarker` | `extTrackHit` 5666 / `extDrawHitMarker` 5680–5701 | `time` 250（100–800）、`color` 白、`size` 9（4–20） | `AttackEntityCallback` / tick 里 `attackT∈(0,3)` 且 120ms 去重记 `hitAt`；`g=size*.35, l=size*.55`，四角各一条斜线，`a=1-age/dur` |
| `crosshair` | `extDrawCrosshair` 5754–5794 | `shape` 十字/点/圆/方框/斜叉、`size` 7、`gap` 3、`thick` 1.5、`dynamic` 移动扩散 | **必须 Mixin `InGameHud#renderCrosshair` 并 `ci.cancel()`**，否则原版准星会叠在下面。`spread=min(6,\|v\|*8)+(sprinting?2:0)` 加进 `gap` |
| `zoom` | `extApplyZoom` 5797 / `extZoomKey` 5810 | `factor` 2.5（1.2–6）、`key` `KeyC`、`smooth` true | `@Mixin(GameRenderer#getFov)` 乘 `zoomValue`；`want=held?1/factor:1`，`zoomValue += (want-zoomValue)*(smooth?.25:1)`，`baseFov` 缓存一次。按键走 `KeyBindingHelper` |
| `antikb` | `extAntiKnockback` 5817 | `h` 20（0–100）、`v` 100（0–100） | 源码注释写明「仅改客户端速度，不发封包」：受伤后把 `p.vel[0/2] *= h/100`、`p.vel[1] *= v/100`。Java 侧同理缩放 `player.getVelocity()`，**服务器上无效**，只做本地预测 |
| `damageindicator` | `extDrawHurtDirs` 6763–6790 | `time` 1800（500–4000）、`color` 红 | `extD.hurtDirs` 存 `{yaw,at}`；`d = 归一化(h.yaw-yaw, ±π)`，`x=W/2+sin(ang)*rad`、`y=H/2-cos(ang)*rad`、`rad=min(W,H)*.38`，实心点 r=6 + 扩散圈 `12*(1+age/dur)`，过期过滤。Java 用 `DamageTracker#getMostRecentDamage()` 拿来源方位 |
| `lowhp` | `extLowHpOverlay` 6315–6330 / `extRenderC` 6589 | `threshold` 6（2–15）、`flash` true | `createRadialGradient(中心透明→边缘红)` 在 Java 没有，改成**逐圈 `fill`** 近似：`a=(1-age/900)*.32*(flash?.65+.35*sin(age/60):1)`，900ms 生命，`hp<threshold` 时触发 |
| `entityinfo` | `extFocusEntity` 7288–7301 / `extHudE` 7302 | `show` true | `mc.crosshairTarget instanceof EntityHitResult` → `getEntity()` → `getHealth/getMaxHealth/distanceTo`，`HudRenderCallback` 画一个小面板 |
| `blockoutline` | `extBlockOutline` 7261–7285 | `color` 白、`width` 1.5 | 和 §8.1 的 `drawBlockEsp` 是**同一套 8 角 12 边**，只是白色细线、无填充。直接复用 `BlockRenderer.drawBox(lines, m, new Box(pos), cam, white, 0.9f)`，不用另写渲染器 |
| `entitytrail` | `extEntityTrails` 6885–6925 | `count` 4（1–12）、`length` 12（4–30） | 每实体一个 `Deque<Vec3d>`，位移 >0.04 才采样，敌对红 / 被动蓝、`globalAlpha .6`。Java 走 `AFTER_ENTITIES` 画 **3D 折线**（比网页版 `project()` 投影更稳），见下方 `EntityTrailRenderer` |
| `music` | 主表 634–654 | 音源聚合、320 音质、律动灵敏度 | 网页特有、必须整体换实现：Java 版 `SoundManager` 没有现成 FFT 频谱。要么自己跑 `AudioTranscribe`/外部播放器的频谱数据喂给 02 卷光环的 `barData` 与 04 卷律动，要么砍掉播放器只保留「频谱数组」这个接口。不要试图在 Fabric 里复刻 GD/netease 抓流 |

`armorwarn`（6175）、`orestats`（6670）、`blockhistory`（6654）、`chatlog`（6663）、`notes`（6692）、`resource`（6708）、`screenshot`（6700）、`autogg`（6723）、`playtimewarn`/`fpswarn`（6678/6685）、`coordcopy`（6182）这些是记录/面板/工具，不是渲染，归 07 卷统一注册表和 08 卷对照表处理，本节不展开 —— 但它们的开关同样在 `cfg.states`，`ModuleRegistry.enabledNames()`（§2.5）要把它们一起收进 ArrayList，别只遍历主表 `MODULES` 的前 50 个。

### 9A.2 `ExtOverlayRenderer.java`（合并 6 个屏幕 2D 扩展模块）

```java
package opus.hud.client.render;

import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.text.Text;
import opus.hud.client.OpusHudClient;
import opus.hud.client.config.OpusConfig;
import opus.hud.client.state.HudState;

import java.util.ArrayDeque;

/** fpsgraph / hitmarker / lowhp / damageindicator / crosshair / potionhud / entityinfo。 */
public final class ExtOverlayRenderer {

    private static long hitAt = -1, lowHpAt = -1;
    private static final ArrayDeque<Integer> FPS_HIST = new ArrayDeque<>();
    private static final java.util.List<HurtDir> HURT = new java.util.ArrayList<>();
    private record HurtDir(float yaw, long at) {}

    public static void register() {
        HudRenderCallback.EVENT.register((DrawContext ctx, var t) -> {
            render(ctx, t.getTickDelta(true));
        });
    }

    public static void onAttack() { hitAt = System.currentTimeMillis(); }   // 5666–5678 的 120ms 去重
    public static void onHurt(float sourceYaw) {                             // 6763 hurtDirs
        HURT.add(new HurtDir(sourceYaw, System.currentTimeMillis()));
    }
    public static void onLowHp() { lowHpAt = System.currentTimeMillis(); }

    static void render(DrawContext ctx, float tickDelta) {
        OpusConfig c = OpusHudClient.CONFIG;
        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc.player == null || mc.world == null) return;
        int W = mc.getWindow().getScaledWidth(), H = mc.getWindow().getScaledHeight();
        long now = System.currentTimeMillis();

        if (c.fpsGraph.enabled) drawFpsGraph(ctx, mc, W, H, c.fpsGraph);
        if (c.potionHud.enabled) drawPotions(ctx, mc, c.potionHud);
        if (c.lowHp.enabled) drawLowHp(ctx, W, H, now, c.lowHp);
        if (c.hitMarker.enabled) drawHitMarker(ctx, W, H, now, c.hitMarker);
        if (c.damageIndicator.enabled) drawHurtDirs(ctx, mc, W, H, now, tickDelta, c.damageIndicator);
        if (c.entityInfo.enabled) drawEntityInfo(ctx, mc);
        // crosshair 的 ci.cancel() 在 InGameHudMixin 里做，这里只画自定义形状
        if (c.crosshair.enabled) drawCrosshair(ctx, mc, W, H, c.crosshair);
    }

    private static void drawFpsGraph(DrawContext ctx, MinecraftClient mc, int W, int H,
                                     OpusConfig.FpsGraph c) {
        FPS_HIST.addLast(HudState.fps);
        while (FPS_HIST.size() > 60) FPS_HIST.removeFirst();       // 60 次采样
        int h = c.height, w = 180, x0 = W - w - 32, y0 = H - 420;  // right/bottom 16,210 ×2
        ctx.fill(x0, y0, x0+w, y0+h, 0xB8080C14);
        for (int i = 1; i < 4; i++) ctx.fill(x0, y0+h*i/4, x0+w, y0+h*i/4+1, 0x1FFFFFFF);
        int max = 60; for (int v : FPS_HIST) max = Math.max(max, v);
        int n = FPS_HIST.size(), i = 0;
        int prevX = 0, prevY = 0;
        for (int v : FPS_HIST) {
            int px = x0 + i * w / Math.max(1, n-1);
            int py = y0 + h - (int)(v/(float)max * (h-6)) - 3;     // 5654
            if (i > 0) line(ctx, prevX, prevY, px, py, c.color);
            prevX = px; prevY = py; i++;
        }
        ctx.drawText(mc.textRenderer, Text.literal(HudState.fps + " fps"), x0+12, y0+6,
                0xD9FFFFFF, false);
    }

    private static void drawPotions(DrawContext ctx, MinecraftClient mc, OpusConfig.PotionHud c) {
        var tr = mc.textRenderer;
        int y = 120, i = 0;
        for (StatusEffectInstance e : mc.player.getStatusEffects()) {
            if (i++ >= c.max) break;                                  // 5416 max
            String amp = e.getAmplifier() > 0 ? " " + (e.getAmplifier()+1) : "";  // 5878
            String dur = e.getDuration()/20 + "s";
            ctx.drawText(tr, Text.literal(e.getEffectType().value().getName().getString() + amp + "  " + dur),
                    16, y, 0xFFEFF2FA, true);
            y += 16;
        }
    }

    /** createRadialGradient → 逐圈 fill，从外向内 alpha 递减。 */
    private static void drawLowHp(DrawContext ctx, int W, int H, long now, OpusConfig.LowHp c) {
        if (mcHealth() >= c.threshold) return;
        long age = now - lowHpAt;
        if (lowHpAt < 0 || age > 900) return;
        float a = (1 - age/900f) * 0.32f
                * (c.flash ? 0.65f + 0.35f*(float)Math.sin(age/60f) : 1f);  // 6320
        int cx = W/2, cy = H/2, rMax = (int)(Math.max(W,H)*0.62);
        int rMin = (int)(Math.min(W,H)*0.25);
        for (int r = rMax; r > rMin; r -= 12) {
            float t = (r - rMin)/(float)(rMax - rMin);
            int alpha = (int)(255 * a * t);
            int col = (alpha << 24) | 0xFF1414;
            // 用四条矩形边近似圆环，避免逐像素
            ctx.fill(cx-r, cy-r, cx+r, cy-r+12, col);
            ctx.fill(cx-r, cy+r-12, cx+r, cy+r, col);
            ctx.fill(cx-r, cy-r, cx-r+12, cy+r, col);
            ctx.fill(cx+r-12, cy-r, cx+r, cy+r, col);
        }
    }

    private static void drawHitMarker(DrawContext ctx, int W, int H, long now,
                                      OpusConfig.HitMarker c) {
        long age = now - hitAt;
        if (hitAt < 0 || age > c.time) return;
        int a = (int)(255*(1 - age/(float)c.time));
        int g = (int)(c.size*0.35f), l = (int)(c.size*0.55f), cx=W/2, cy=H/2;
        int col = (a<<24) | (c.color & 0xFFFFFF);
        line(ctx, cx-g-l, cy-g-l, cx-g, cy-g, col);                 // 5695 四角斜线
        line(ctx, cx+g+l, cy-g-l, cx+g, cy-g, col);
        line(ctx, cx-g-l, cy+g+l, cx-g, cy+g, col);
        line(ctx, cx+g+l, cy+g+l, cx+g, cy+g, col);
    }

    /** 6763–6790：伤害来源方位点 + 扩散圈。 */
    private static void drawHurtDirs(DrawContext ctx, MinecraftClient mc, int W, int H,
                                     long now, float tickDelta, OpusConfig.DamageIndicator c) {
        float yaw = (float)Math.toRadians(mc.player.getYaw(tickDelta));
        int rad = (int)(Math.min(W,H)*0.38);
        HURT.removeIf(h -> now - h.at > c.time);
        for (HurtDir h : HURT) {
            float d = h.yaw - yaw;
            while (d > Math.PI) d -= Math.PI*2;
            while (d < -Math.PI) d += Math.PI*2;
            int x = W/2 + (int)(Math.sin(d)*rad), y = H/2 - (int)(Math.cos(d)*rad);
            float a = 1 - (now - h.at)/(float)c.time;
            ctx.fill(x-6, y-6, x+6, y+6, ((int)(a*204)<<24) | 0xFF5F6D);
            int rr = (int)(12*(1 + (now-h.at)/(float)c.time));
            ctx.fill(x-rr, y, x+rr, y+1, ((int)(a*255)<<24) | 0xFF5F6D);
        }
    }

    private static void drawEntityInfo(DrawContext ctx, MinecraftClient mc) {
        if (!(mc.crosshairTarget instanceof net.minecraft.util.hit.EntityHitResult ehr)) return;
        if (!(ehr.getEntity() instanceof LivingEntity le)) return;
        String s = le.getName().getString() + "  " + (int)le.getHealth() + "/"
                + (int)le.getMaxHealth() + "hp  "
                + (int)Math.sqrt(le.squaredDistanceTo(mc.player)) + "m";
        ctx.drawText(mc.textRenderer, Text.literal(s), 16, 200, 0xFFFFFFFF, true);
    }

    private static void drawCrosshair(DrawContext ctx, MinecraftClient mc, int W, int H,
                                      OpusConfig.Crosshair c) {
        int cx=W/2, cy=H/2;
        double v = mc.player.getVelocity().horizontalLength();
        int spread = (int)Math.min(6, Math.abs(v)*8) + (mc.player.isSprinting()?2:0);
        int gap = c.gap + (c.dynamic ? spread : 0), L = c.size;
        int col = c.color;
        switch (c.shape) {
            case "点"   -> ctx.fill(cx-1, cy-1, cx+1, cy+1, col);
            case "圆"   -> { /* 逐点画圆，同 RadarRenderer.outline */ }
            case "方框" -> { ctx.fill(cx-L,cy-L,cx+L,cy-L+1,col); ctx.fill(cx-L,cy+L,cx+L,cy+L+1,col);
                             ctx.fill(cx-L,cy-L,cx-L+1,cy+L,col); ctx.fill(cx+L,cy-L,cx+L+1,cy+L,col); }
            case "斜叉" -> { line(ctx,cx-L,cy-L,cx+L,cy+L,col); line(ctx,cx+L,cy-L,cx-L,cy+L,col); }
            default     -> {                                       // 十字 5787–5790
                line(ctx,cx-gap-L,cy,cx-gap,cy,col); line(ctx,cx+gap,cy,cx+gap+L,cy,col);
                line(ctx,cx,cy-gap-L,cx,cy-gap,col); line(ctx,cy,cy+gap,cx,cy+gap+L,col);
            }
        }
    }

    private static void line(DrawContext ctx, int x1,int y1,int x2,int y2,int col) {
        // 1px 折线用 fill 逐段近似，够用；要精确就上 Bresenham
        ctx.fill(Math.min(x1,x2), Math.min(y1,y2), Math.max(x1,x2)+1, Math.max(y1,y2)+1, col);
    }
    private static float mcHealth() { return MinecraftClient.getInstance().player.getHealth(); }
}
```

配套的两个 Mixin（只列注入点，方法描述符按你的 Yarn 版本微调）：

```java
// 自定义准星：必须先 cancel 原版，否则两套准星叠在一起
@Mixin(net.minecraft.client.gui.hud.InGameHud.class)
public abstract class InGameHudMixin {
    @Inject(method = "renderCrosshair", at = @At("HEAD"), cancellable = true)
    private void opus$crosshair(CallbackInfo ci) {
        if (OpusHudClient.CONFIG.crosshair.enabled) ci.cancel();  // 绘制交给 ExtOverlayRenderer
    }
}

// 缩放：改 FOV，对应 extApplyZoom 5801–5807 的 zoomValue 平滑
// 08 卷 §1 记作 GameRendererMixin#getFov(Camera,float,boolean) 的 @ModifyReturnValue，
// 与下面的 @Inject(RETURN, cancellable) 等价；这里用 @Inject 是不想引入 MixinExtras 依赖。
@Mixin(net.minecraft.client.render.GameRenderer.class)
public abstract class GameRendererMixin {
    @Inject(method = "getFov", at = @At("RETURN"), cancellable = true)
    private void opus$zoom(CallbackInfoReturnable<Double> cir) {
        OpusConfig.Zoom z = OpusHudClient.CONFIG.zoom;
        if (!z.enabled) return;
        cir.setReturnValue(cir.getReturnValueD() * ZoomState.value());
    }
}
```

`ZoomState.value()` 就是 `extB.zoomValue` 的直译：`want = held ? 1/factor : 1`，`v += (want-v)*(smooth?0.25:1)`，`baseFov` 只在第一次缓存（5804）。按键由 `KeyBindingHelper` 注册的 `KeyBinding` 在 `END_CLIENT_TICK` 里 `wasPressed/isPressed` 驱动，取代网页版的 `keydown/keyup` + `fcKeys` 那套 DOM 监听。

### 9A.3 `EntityTrailRenderer.java`（3D 版）

网页版 `extEntityTrails` 用 `project()` 把每个轨迹点投成屏幕折线（6916），Java 侧直接画 3D 更省事，也不怕相机后方的点被投成贯穿屏幕的长线：

```java
package opus.hud.client.render;

import com.mojang.blaze3d.systems.RenderSystem;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.*;
import net.minecraft.entity.LivingEntity;
import net.minecraft.util.math.Vec3d;
import opus.hud.client.OpusHudClient;
import org.joml.Matrix4f;

import java.util.*;

/** 对应 extEntityTrails 6885–6925：最近 N 个生物的一段移动轨迹。 */
public final class EntityTrailRenderer {
    private static final Map<LivingEntity, ArrayDeque<Vec3d>> TRAILS = new WeakHashMap<>();

    public static void register() {
        WorldRenderEvents.AFTER_ENTITIES.register(EntityTrailRenderer::afterEntities);
    }

    private static void afterEntities(WorldRenderContext context) {
        var c = OpusHudClient.CONFIG.entityTrail;
        MinecraftClient mc = MinecraftClient.getInstance();
        if (!c.enabled || mc.world == null || mc.player == null) { TRAILS.clear(); return; }
        float tickDelta = context.tickCounter().getTickDelta(true);
        Vec3d cam = context.camera().getPos();
        Matrix4f m = context.matrixStack().peek().getPositionMatrix();
        VertexConsumerProvider.Immediate imm = mc.getBufferBuilders().getEntityVertexConsumers();

        RenderSystem.disableDepthTest();
        RenderSystem.enableBlend();
        VertexConsumer lines = imm.getBuffer(RenderLayer.getLines());
        int used = 0;
        for (var e : mc.world.getEntities()) {
            if (used >= c.count) break;                            // count 默认 4
            if (!(e instanceof LivingEntity le) || le == mc.player || le.isDead()) continue;
            Vec3d q = le.getLerpedPos(tickDelta);
            if (q.distanceTo(mc.player.getPos()) > 48) continue;   // 6900
            var trail = TRAILS.computeIfAbsent(le, k -> new ArrayDeque<>());
            Vec3d last = trail.peekLast();
            if (last == null || q.distanceTo(last) > 0.04) {        // 6904 采样阈值
                trail.addLast(q.add(0, 0.05, 0));
                while (trail.size() > c.length) trail.removeFirst(); // length 默认 12
            }
            if (trail.size() < 2) continue;
            boolean hostile = le instanceof net.minecraft.entity.mob.HostileEntity;
            float[] rgb = hostile ? new float[]{1f,.37f,.43f} : new float[]{.31f,.76f,.97f};
            Vec3d prev = null;
            for (Vec3d p : trail) {
                Vec3d rel = p.subtract(cam);
                if (prev != null) EspRenderer.line(lines, m,
                        prev.x,prev.y,prev.z, rel.x,rel.y,rel.z, rgb, 0.6f);
                prev = rel;
            }
            used++;
        }
        imm.draw();
        RenderSystem.enableDepthTest();
        RenderSystem.disableBlend();
    }
}
```

> 这几个模块百分之九十是「屏幕 2D 覆盖层」，和 §2 的 `HudElementsRenderer` 同属 `HudRenderCallback`，可以直接合进那个类，也可以像这里一样单开一个 `ExtOverlayRenderer` 按功能分组。`lightoverlay` 和 `entitytrail` 一个偏世界投影、一个是 3D 折线，分别挂 `ScreenProjector` 和 `AFTER_ENTITIES`。§10 对照表末尾已经把这些行补齐。

`OpusConfig`（05 卷 §7 同一个 POJO）相应追加字段，字段名与 `EXT_MODULES_*` 里的 `id` 同名、`getS(id,key)` 的 key 对应字段名，Gson 直接序列化，别另建 `ExtConfig`：

```java
public FpsGraph fpsGraph = new FpsGraph();
public PotionHud potionHud = new PotionHud();
public LowHp lowHp = new LowHp();
public HitMarker hitMarker = new HitMarker();
public DamageIndicator damageIndicator = new DamageIndicator();
public Crosshair crosshair = new Crosshair();
public Zoom zoom = new Zoom();
public EntityTrail entityTrail = new EntityTrail();
public boolean entityInfo = false, lightOverlay = false, antiKnockback = false;

public static class FpsGraph { public boolean enabled=false; public int height=50; public int color=0xFF6EE7A5; }
public static class PotionHud { public boolean enabled=false; public int max=6; }
public static class LowHp { public boolean enabled=false, flash=true; public float threshold=6f; }
public static class HitMarker { public boolean enabled=false; public int time=250, size=9, color=0xFFFFFFFF; }
public static class DamageIndicator { public boolean enabled=false; public int time=1800, color=0xFFFF5F6D; }
public static class Crosshair { public boolean enabled=false, dynamic=true; public String shape="十字";
                                public int size=7, gap=3, color=0xFFFFFFFF; public float thick=1.5f; }
public static class Zoom { public boolean enabled=false, smooth=true; public float factor=2.5f; public String key="KeyC"; }
public static class EntityTrail { public boolean enabled=false; public int count=4, length=12; }
```

07 卷的统一注册表直接读这份 `OpusConfig` + `MODS_BY_ID` 即可；`ModuleRegistry.enabledNames()`（§2.5）遍历时要覆盖 `EXT_MODULES_*` push 进来的全部模块，别只数主表前 50 个。

---

## 10. 完整对照表：JS 函数 → Fabric 事件/Mixin → 实现要点

| JS 函数（行号） | Fabric 事件 / Mixin | 实现要点 | 可 1:1？ |
|---|---|---|---|
| `updateHud` 水印/坐标 11605–11642 | `HudRenderCallback` + `END_CLIENT_TICK` | fps 自采样、`bps=bps*.7+inst*.3`、本地时间、`isIntegratedServerRunning` 判联机 | 算法是，DOM 不是 |
| `renderArrayList` 11669 | `HudRenderCallback` | 按名字长度倒序、右边缘对齐、逐行 `fill` | 算法是 |
| `pushNotification/renderNotes` 11679 | `HudRenderCallback` + `END_CLIENT_TICK` | 队列≤5、2600ms 过期、手写 `in/out` alpha 与 x 位移替 CSS 动画 | 否（CSS 必须换） |
| `refreshHud` 11696 | 各 renderer 的 `if (!cfg.xxx) return` | 显隐就是配置布尔判断 | 是（概念） |
| `project` 1853 | `ScreenProjector`（`Camera`+投影矩阵） | 3D 线框不用它，文字/标签才用；`clip.w<=0` 裁掉 | 否（vp 点乘删） |
| `espFrame` 8 顶点线框 2499–2547 | `AFTER_ENTITIES` + `RenderLayer.getLines()` | `getBoundingBox()` 替 w/h 猜，12 边表照抄 | 连接关系是，投影否 |
| `typeColor/colorOf` 1776–1804 | `EspRenderer.entityColor` | `HostileEntity` 替字符串集合，配置色优先 | 是 |
| 追踪线 2523–2535 | `AFTER_ENTITIES` | 相机原点→实体中心 3D 线，`disableDepthTest` 穿墙 | 否（屏幕→3D） |
| TargetESP 括号 2635–2661 | `AFTER_ENTITIES` | 四角 8 条短线，`l=0.28*min(w,h)` | 是 |
| `simulateProj` 2671 | `ProjectileRenderer.simulate` | 先位移再 `vy=vy*drag-grav`，`land` 取撞前空中点 | 是（完全 1:1） |
| `projParams` 2806 / `solveBallistic` 2730 | 同上 | 弓 `f=(t²+2t)/3`、珍珠 grav 0.03 | 是 |
| `strokeProj` 2749 | 同上 | 4 段渐隐 / 光点 / 屏外点断开 | 是 |
| `drawLandMark` 2788 | 同上 | 12 段短线近似脉冲圈 | 近似 |
| `drawRadar` 2916 | `HudRenderCallback` | 正北朝上 `px=cx+dx*scale, py=cy-dz*scale`，圆形逐行填充 | 是（除 clip） |
| `drawCompass` 2993 | `HudRenderCallback` | bearing=(yaw+180)%360、每 5° 刻度、`CLOCK` 表、路径点嵌入 | 是 |
| `drawMinimap` 4494 | `HudRenderCallback` + `NativeImage` | 地形 `blockRGB` 采样→动态贴图、+Z 向下、玩家箭头按 -yaw | 部分（clip/drawImage 换） |
| `blockRGB/refreshTerrain` 4451 | `NativeImageBackedTexture` | 700ms 节流、`getBlockState` 采样 | 是 |
| `drawBlockEsp` 2272 | `AFTER_ENTITIES` | `crosshairTarget` → `BlockHitResult.getBlockPos()`，12 边 + translucent 填充 | 近似 |
| `drawBlockTracker` 3890 | `AFTER_ENTITIES` | `BlockPos.iterate` + `Registries.BLOCK` 匹配 | 是 |
| `extChunkBorders` 5490 | `AFTER_ENTITIES` | `ChunkPos*16` 竖线，高度从脚底起 | 是 |
| `drawWaypoints` 4387 / `extWaypointLine` 7228 | `AFTER_ENTITIES` + `HudRenderCallback` | 光柱逐顶点 alpha、虚线切段、屏外箭头走投影 | 部分 |
| `drawContainerEsp` 7583 | `AFTER_ENTITIES` | `BlockEntity instanceof` 分 12 类配色、fade、虚线追踪 | 是 |
| `extDropBoxes` 5201 | `AFTER_ENTITIES` | 0.48 立方体、`fade=max(.25,1-d/(R*1.2))` | 是 |
| `extDrawDamage` 5726 | `HudRenderCallback` + `ScreenProjector` | 1.2s 生命、`y+=age*speed`、alpha 线性淡出、描边 | 是 |
| `extWorldHealthBars` 7325 | `HudRenderCallback` + `ScreenProjector` | 头顶 +0.28、宽 32、`getHealth/getMaxHealth` | 是 |
| `updateInventory` 4614 | `HudRenderCallback` | `drawItem` 真图标、`selectedSlot` 高亮、矩阵整体 scale | 近似（图标升级） |
| `extArmorRows` 5569 | `HudRenderCallback` | `getDamage/getMaxDamage`、5 行条 | 是 |
| `faceUV/faceCrop` 4261（05 卷） | `PlayerSkinTextures` / `NativeImage` | 见 05 卷 §3 | 部分 |
| `EntityRenderer.renderLabelIfPresent` | `@Mixin` + `@Inject(cancellable)` | 05 卷 §4.5 / §6.1 | 否（Java 有原生） |
| `extLightOverlay` 5528 | `HudRenderCallback` + `getLightLevel` | radius/threshold/alpha、700ms 缓存 | 是 |
| `extEffects/extHudB` 5593 / 5874 | `HudRenderCallback` | `getStatusEffects`、amp+1、剩余时长 | 是 |
| `extDrawGraph` 5629 | `HudRenderCallback` | 60 点环形缓冲、`max=max(60,...hist)` | 是 |
| `extTrackHit/extDrawHitMarker` 5666 | `AttackEntityCallback` + `HudRenderCallback` | 120ms 去重、四角斜线、`a=1-age/dur` | 是 |
| `extDrawCrosshair` 5754 | `@Mixin(InGameHud#renderCrosshair, cancel)` | 5 种形状、`dynamic` spread | 否（必须 cancel 原版准星） |
| `extApplyZoom` 5797 | `@Mixin(GameRenderer#getFov)` | `zoomValue+=.25*(want-v)`、baseFov 缓存 | 是 |
| `extAntiKnockback` 5817 | `ClientPlayerEntity#setVelocity` | 仅本地速度缩放，服务器不认 | 近似 |
| `extDrawHurtDirs` 6763 | `HudRenderCallback` + `DamageTracker` | 方位归一化、`rad=.38*min(W,H)`、扩散圈 | 是 |
| `extLowHpOverlay` 6315 | `HudRenderCallback` | 径向渐变→逐圈 fill、900ms、flash | 否（gradient 必须换） |
| `extFocusEntity` 7288 | `HudRenderCallback` + `crosshairTarget` | 名字/血量/距离 | 是 |
| `extBlockOutline` 7261 | `AFTER_ENTITIES`（复用 `BlockRenderer.drawBox`） | 8 角 12 边白色细线 | 是 |
| `extEntityTrails` 6885 | `AFTER_ENTITIES` + `RenderLayer.getLines()` | `Deque`、0.04 采样阈值、3D 折线 | 是（投影换 3D） |
| `music` 634–654 | —（整体换实现） | Java 无现成 FFT，只保留频谱数组接口 | 否 |
| `armorwarn/orestats/blockhistory/chatlog/notes/resource/screenshot/autogg/coordcopy` 6175–6729 | `END_CLIENT_TICK` + `HudRenderCallback`（07 卷注册表） | 记录/面板类，共用 `cfg.states`/`getS` | 归 07 卷 |

---

## 11. 三个完整骨架小结 + 事件注册

团队要的「至少 3 个完整可落地渲染器骨架」分别落在这几节：

| 骨架 | 位置 | 承载 |
|---|---|---|
| ① `HudElementsRenderer.java` + `HudState` + `ModuleRegistry` | §2.5 | 水印/坐标/ArrayList/通知，`HudRenderCallback` |
| ② `EspRenderer.java` + `ScreenProjector` + `BoxEdges` | §4.5 | 8 顶点线框/追踪线/TargetESP，`AFTER_ENTITIES` |
| ③ `RadarRenderer.java` | §6.2 | 正北朝上圆形雷达，`HudRenderCallback` |

另外还给了 `ProjectileRenderer`（§5.4）、`MinimapRenderer`（§7.3）、`BlockRenderer`（§8.7）、`InventoryHudRenderer`（§9）四个骨架，加上 05 卷的 `TargetHudRenderer`、`NametagRenderer`、`TargetRingRenderer`、`FaceTextureHelper`，整套渲染层就齐了。

`mixins.json`（client-only）：

```json
{
  "required": true,
  "package": "opus.hud.client.mixin",
  "compatibilityLevel": "JAVA_17",
  "minVersion": "0.8",
  "client": [
    "EntityRendererMixin",
    "LivingEntityRendererMixin"
  ],
  "injectors": { "defaultRequire": 1 }
}
```

`fabric.mod.json` 的 entrypoint 指向 `opus.hud.client.OpusHudClient`（`client` 数组），别写进 `main` —— 这里所有东西都碰客户端类，放进通用入口会在服务端崩。

---

## 12. 可 1:1 移植 / 必须换实现

**直接搬算法、只换函数名和数据源：**

弹道 `simulateProj` 的积分、`projParams` 物性表、`f=(t²+2t)/3`；`strokeProj` 的 4 段渐隐与光点；`drawLandMark` 的脉冲；`drawRadar` 的正北朝上映射与 `scale=R/(dist*0.5)`；`drawCompass` 的 bearing/CLOCK/每 5° 刻度；`blockRGB` 的方块→颜色表；`extChunkBorders` 的 16 格网格；`extWorldHealthBars` 的 `pct=health/max` 与 48 格/30 个上限；`extArmorRows` 的 `1-damage/maxDamage`；`extDropBoxes` 的 `fade` 公式；`renderArrayList` 的长度倒序；通知队列的 ≤5 与 2600ms；bps 的 `0.7/0.3` 低通；ESP 的 12 边表与 `maxD2/maxEnts` 截断；`colorOf` 的红/蓝/紫优先级。

**网页特有，必须整个换掉：**

| 网页版 | Java 版 |
|---|---|
| `ectx` Canvas 2D + `project()` 手算 `vp[16]` | `VertexConsumer` 3D 世界坐标（线框）；`ScreenProjector`（文字标签） |
| `ctx.arc()+clip()` 圆形裁剪 | `DrawContext` 逐行水平填充圆，或 stencil |
| `createLinearGradient` / `setLineDash` | 逐顶点 color alpha / 短线段切段拼接 |
| `ctx.shadowBlur` 辉光 | 叠半透明粗线，或 04 卷 `RenderTarget` 两趟高斯 |
| CSS `cm-notein` / `.out` / `cm-wave` 关键帧 | 每帧按 `currentTimeMillis()` 算 alpha、位移、渐变偏移 |
| DOM `hudStage` + `makeDraggable` + `scale(2)` | `HudRenderCallback` + config 坐标 + `KeyBindingHelper` 手写拖拽 |
| `drawImage` 九参缩放 / `imageSmoothingEnabled=false` | `MatrixStack.scale` + `drawTexture`，或 `NativeImage` 裁切 |
| `W.ENTITY_DATA.layers` / `BLOCK_DATA` / `itemName(id)` 查表 | `EntityModel` / `Registries.BLOCK` / `ItemStack#getName()` |
| `e.constructor.name` / `HOSTILE` 集合 / `e.T.hostile` | `instanceof HostileEntity` / `EntityTypeTags` |
| `num(e,'w'/'h')` 猜包围盒 | `entity.getBoundingBox()` |
| `isSolidAt` / `scanBlocks` / `scanContainers` | `world.getBlockState` / `BlockPos.iterate` / `world.blockEntities` |
| `state.editHud` 下 DOM 可拖 | `KeyBinding` + `Mouse` 回调改 config 坐标 |

---

## 13. 落地顺序建议

1. 先扩 `OpusConfig`（把 421–709 的模块设置全补成 POJO 字段）+ `ModuleRegistry`，后面每个 renderer 都要读开关。
2. `HudElementsRenderer` + `HudState`：纯屏幕 2D，最容易验证，先把 `HudRenderCallback` 链路跑通。
3. `EspRenderer`：验证 `RenderLayer.getLines()` 的顶点格式、`disableDepthTest`、`immediate.draw()` —— 拿一个静态方块框试，能画出来再加实体遍历。
4. `ScreenProjector` + `WorldOverlayRenderer`：伤害数字、世界血条、名牌（05 卷）全依赖它，先用一个固定世界点验证投影对不对。
5. `RadarRenderer` / `CompassRenderer`：纯 2D，和 ① 同一套 `fill/drawText`。
6. `ProjectileRenderer`：`simulate` 是纯数学，可以脱离渲染单独单测（给定初速算 land），确认后再接 `VertexConsumer`。
7. `MinimapRenderer` 的 `NativeImage` 地形：唯一需要动态贴图的地方，和 05 卷 `FaceTextureHelper.buildCrop` 共用工具。
8. `BlockRenderer`：方块/容器/边界/路径点/掉落物，全部复用 `EspRenderer.BOX_EDGES` 和 `line()`，属于体力活。
9. `InventoryHudRenderer` / 装备耐久 / 掉落物汇总：收尾。
10. 最后接 04 卷的全屏后处理（毛玻璃/辉光/运动模糊）和 02/03 卷的光环与开场动画，把 `END_MAIN` 那趟 shader 挂上。

> 最容易翻车的三处：① `HudRenderCallback` 在 1.21.1 是 `(DrawContext, RenderTickCounter)` 不是 `(DrawContext, float)`，注册层务必转换；② `RenderLayer.getLines()` 的顶点必须 `position + color + normal` 三连并以 `.next()` 收尾，少一个就整批不画；③ hudStage 的 `scale(2)` 只影响 DOM 层（水印/坐标/TargetHUD/ArrayList/通知），espCanvas 上的名牌、雷达、小地图已经是物理像素，两处坐标系别混。
