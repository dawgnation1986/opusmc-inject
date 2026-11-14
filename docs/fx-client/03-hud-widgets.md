# 03 · HUD 组件全量实现

**对应 Meteor 源码**：`systems/hud/HudElement.java`（147 行）、`systems/hud/HudRenderer.java`（336 行）、`systems/hud/HudBox.java`、`systems/hud/screens/HudEditorScreen.java`、`systems/modules/render/Nametags.java`、`ESP.java`、`Tracers.java`、`Trajectories.java`。
**要实现**：彗星 userscript 的全部 HUD 组件，每个做成一个 `HudElement` 子类，自带锚点、拖拽、编辑屏、NBT 持久化。

---

## 1. 为什么每个组件都做 `HudElement`

`HudElement` 已经把麻烦事做完了（`_ref/.../HudElement.java`）：

```java
public abstract class HudElement implements Snapper.Element, ISerializable<HudElement> {
    public final HudElementInfo<?> info;
    public final Settings settings = new Settings();
    public final HudBox box = new HudBox(this);   // 锚点 / 吸附 / 位置
    public boolean autoAnchors = true;
    public int x, y;
    protected double alignX(double width, Alignment alignment);
    // render(HudRenderer) 由子类实现
}
```

所以组件只写三件事：`info` 注册、`render()` 画什么、`settings` 有哪些参数。位置、拖拽、保存、编辑屏全部白拿。

`HudRenderer` 的真实方法（`_ref/.../HudRenderer.java`）：

```java
line(x1,y1,x2,y2,Color)
quad(x,y,w,h,Color) / quad(..., cTL,cTR,cBR,cBL)
triangle(x1,y1,x2,y2,x3,y3,Color)
texture(Identifier,x,y,w,h,Color)
text(String,x,y,Color,shadow,scale) / textWidth / textHeight
item(ItemStack,x,y,scale,overlay)
entity(LivingEntity,x,y,w,h,yaw,pitch)      // 画生物模型，TargetHUD 头像可用
post(Runnable)                              // 延后绘制
```

圆角、渐变、圆环用 `01` 卷的 `CometShapes2D` 补。

---

## 2. 组件总表

| # | 组件 | 彗星对应 | 尺寸 / 位置 | 核心参数 |
|---|---|---|---|---|
| 1 | 水印 `CometWatermarkHud` | `cm-wm` | 左上 12,12 | 文字模板、彩虹、字号 |
| 2 | 坐标条 `CometCoordsHud` | 坐标胶囊 | 顶部居中 | x/y/z、bps、方位、精度 |
| 3 | 模块列表 `CometArrayListHud` | `cm-array` | 右上，右对齐 | 长度倒序、颜色、动画、彩虹 |
| 4 | 通知 `CometNotificationsHud` | `cm-note` | 右下 | 队列 ≤5、2600ms、滑入淡出 |
| 5 | TargetHUD `CometTargetHud` | `cm-target` | 112×40（×2） | 脸/名/血条/手持/装备/距离 |
| 6 | 名牌 `CometNametagsHud` | nametags | 世界投影 | 别名、格式、缩放、紧凑、背景 |
| 7 | 雷达 `CometRadarHud` | radar | 右上圆 | 正北朝上、半径、点配色 |
| 8 | 小地图 `CometMinimapHud` | minimap | 右下 | 地形、实体、标签、缩放 |
| 9 | 罗盘 `CometCompassHud` | compass | 顶部 | 方位、经纬度、路径点 |
| 10 | 准星 `CometCrosshairHud` | crosshair | 屏幕中心 | 5 种形状、间隙、命中变色 |
| 11 | 命中标记 `CometHitmarkerHud` | hitmarker | 中心四角 | 时长、大小、颜色 |
| 12 | 伤害数字 `CometDamageHud` | damagenumbers | 世界投影 | 字号、上浮、淡出 |
| 13 | 世界血条 `CometHealthBarHud` | healthbar | 实体上方 | 宽度、渐变、数值 |
| 14 | FPS 图 `CometFpsGraphHud` | fpsgraph | 左下 | 环形缓冲 120 帧、折线/柱状 |
| 15 | 药水列表 `CometPotionHud` | potionhud | 右侧 | 图标、剩余时长、颜色 |
| 16 | 装备耐久 `CometArmorHud` | armorhud | 快捷栏上方 | 4 件、耐久条、警告阈值 |
| 17 | 背包 `CometInventoryHud` | invhud | 下方 | 33 格、图标、耐久 |
| 18 | 低血量 vignette `CometLowHpHud` | lowhp | 全屏 | 径向渐变、脉冲 |
| 19 | 实体信息 `CometEntityInfoHud` | entityinfo | 世界投影 | 类型/血量/装备 |
| 20 | 光柱 / 路径点 `CometWaypointHud` | waypoints | 世界 | 标签、距离、光柱 |

> 这些全是**画信息**，没有一条会改变游戏状态。TargetHUD 的「当前目标」用 `AttackEntityCallback` 被动记录最后一次挥击碰到的实体（下面 §4），不主动索敌。

---

## 3. 组件基类与注册

```java
package com.bigpixel.comet.hud;

import meteordevelopment.meteorclient.systems.hud.*;
import meteordevelopment.meteorclient.settings.*;
import meteordevelopment.meteorclient.utils.render.color.Color;

public abstract class CometHudElement extends HudElement {
    protected final SettingGroup sg = settings.getDefaultGroup();

    protected final Setting<Boolean> glass = sg.add(new BoolSetting.Builder()
        .name("glass").description("毛玻璃背板").defaultValue(true).build());
    protected final Setting<Double> bgAlpha = sg.add(new DoubleSetting.Builder()
        .name("bg-alpha").defaultValue(0.42).min(0).max(1).sliderMax(1).build());
    protected final Setting<SettingColor> accent = sg.add(new ColorSetting.Builder()
        .name("accent").defaultValue(new SettingColor(176,107,255)).build());

    protected CometHudElement(HudElementInfo<?> info) { super(info); }

    /** 统一的玻璃背板，所有组件共用 */
    protected void panel(HudRenderer r, double x, double y, double w, double h) {
        if (glass.get() && CometGlassPipeline.isAvailable()) {
            CometComposite.draw(CometGlassPipeline.blur(10, 0.5), x,y,w,h, CometPreset.current());
        } else {
            CometShapes2D.roundedRect(r./* adapter */, x,y,w,h, 9, 6,
                new Color(16,18,28,(int)(255*bgAlpha.get())));
        }
        CometShapes2D.sheen(...);
    }
}
```

`HudRenderer` 与 `GuiRenderer` 的 quad 接口几乎同名，写一个 20 行的 `HudDrawAdapter` 把 `CometShapes2D` 接到 `HudRenderer` 即可，不要复制两套绘制代码。

注册（Meteor 的 HUD 系统）：

```java
public final class CometHud {
    public static final HudGroup GROUP = new HudGroup("Comet");
    public static final HudElementInfo<CometWatermarkHud> WATERMARK =
        new HudElementInfo<>(GROUP, "watermark", "水印", CometWatermarkHud::new);
    // ...其余 19 个
    public static void register() {
        Hud.get().register(WATERMARK);   // 以实际 HUD 注册 API 为准
    }
}
```

---

## 4. TargetHUD：脸 + 名 + 血条 + 装备 + 距离

布局（彗星是 `112×40` 设计值，`scale(2)` 渲染，Java 里直接按 224×80 画，或统一按 GUI scale 折算）：

```
┌──────────────────────────────────────────┐
│ ┌────┐  Name                    12.4 m   │
│ │脸  │  ████████████░░░░  18.5 / 20    │
│ └────┘  [剑] [盔] [甲] [裤] [靴]        │
└──────────────────────────────────────────┘
```

**头像两条路**：

1. `HudRenderer.entity(LivingEntity, x, y, w, h, yaw, pitch)` —— 直接画生物 3D 模型，最省事，但耗性能
2. 皮肤裁切 —— 用 `PlayerSkinTextures` 拿 `Identifier`，`r.texture(id, x, y, w, h, color)` 只画 `head front` 区域。原版 64×64 皮肤的脸在 `(8,8)-(16,16)`，**内层的 hat 层在 `(40,8)-(48,16)`**；`v` 必须按贴图真实高度换算，不能写死 `0.25~0.5`（128×128 高清皮肤会错）。

```java
private void drawFace(HudRenderer r, LivingEntity e, int x, int y, int size) {
    if (e instanceof PlayerEntity p) {
        Identifier skin = mc.getSkinProvider().getSkinTextures(p.getGameProfile()).texture();
        // 8/64 = 0.125, 16/64 = 0.25；HudRenderer.texture 不支持 UV 时用
        // Renderer2D.TEXTURE.texQuad(..., rotation, texX1,texY1,texX2,texY2, color)
        Renderer2D.TEXTURE.texQuad(x, y, size, size, 0,
            8/64f, 8/64f, 16/64f, 16/64f, Color.WHITE);
    } else {
        r.entity(e, x, y, size, size, 0, 0);   // 非玩家用模型
    }
}
```

**目标来源（被动，不索敌）**：

```java
@EventHandler private static void onAttack(AttackEntityEvent e) {
    TargetState.set(e.entity, System.currentTimeMillis());   // 只记，不找，不打
}
```

`TargetState` 存 `{entity, lastSeen}`，超过 5 秒或实体死亡就清空。这是 UI 数据源，不是战斗逻辑。

血条：`r.quad(x,y,w,h, bg)` + `r.quad(x,y,w*hp/max,h, hpColor)`，颜色按 `hp/max` 从绿→黄→红插值；装备用 `r.item(stack, x, y, scale, true)`。

---

## 5. 名牌：世界坐标 → 屏幕

Meteor 自带 `NametagUtils`（`utils/render/Nametags.java`）做投影与缩放，直接用：

```java
@EventHandler private static void onRender2D(Render2DEvent e) {
    for (Entity ent : targets()) {
        Vec3 pos = ent.getPosition(e.tickDelta).add(0, ent.getBbHeight() + 0.5, 0);
        if (!NametagUtils.to2D(pos, distanceScale.get())) continue;
        NametagUtils.begin(pos);
        String label = format(ent);                    // 别名 + 距离 + 血量...
        double w = r.textWidth(label);
        r.quad(-w/2 - 3, -2, w + 6, r.textHeight() + 4, bg);
        r.text(label, -w/2, 0, color, true);
        r.item(ent.getMainHandStack(), ...);           // 手持物
        NametagUtils.end();
    }
}
```

`tagBoxes` 做屏幕矩形重叠检测，重叠时纵向错开，避免一群怪的名字糊成一团。

---

## 6. 雷达 / 小地图 / 罗盘

**雷达**（正北朝上，圆形裁剪）：

```java
r./* scissor 圆 */ ;
CometShapes2D.circle(g, cx, cy, radius, 64, new Color(8,10,18,150));
CometShapes2D.ring2d(g, cx, cy, radius, radius-1.2, 64, accent);
for (Entity e : nearby) {
    double dx = e.getX() - cam.x, dz = e.getZ() - cam.z;
    double d = Math.hypot(dx, dz);
    if (d > range) continue;
    double px = cx + dx / range * radius, py = cy + dz / range * radius;
    CometShapes2D.circle(g, px, py, 2.2, 8, colorOf(e));
}
g.text("N", cx - 3, cy - radius - 11, Color.WHITE, false);
```

> 正北朝上 = 不做相机 yaw 旋转；要做「朝向朝上」则把 `(dx,dz)` 绕 yaw 旋转，代码见 `04-effects.md` 的旋转矩阵段。

**小地图**：每 N tick 把周围区块渲染进一张 `NativeImageBackedTexture`（地形顶视 + 方块颜色映射），HUD 里 `r.texture(id, x,y,w,h,Color.WHITE)` 贴上去，再叠实体点与标签。别每帧重画地形。

**罗盘**：顶部一条带，中央是玩家朝向，刻度按 yaw 偏移，路径点用三角标记；「几点方位」用 `CLOCK` 映射（北=12点/南=6点，顺时针每 30° 一格）。

---

## 7. 动画与队列

彗星的 CSS 动画（`cm-notein` 滑入 / `.out` 淡出 / `cm-array` 顺序）在 Java 里就是每帧插值：

| 组件 | 公式 |
|---|---|
| 通知 | `age = now - born`；入场 `p = easeOutCubic(min(1, age/220))`，`x = w*(1-p)`；出场 `alpha = 1 - max(0,(age-2340)/260)` |
| 模块列表 | 每项按名字长度倒序；新增项 `y` 从 -8 缓动到目标，删除项淡出后移除 |
| 命中标记 | `alpha = 1 - age/220`，四角短线随时间向外扩 `0→4px` |
| 伤害数字 | 世界坐标上浮 `y += age*0.0008`，`alpha = 1 - age/900` |
| 低血量 | 全屏径向渐变，`pulse = 0.5+0.5*sin(now*0.004)` 调 alpha |

统一用 `CometEase`（`easeInOutCubic` / `easeOutCubic` / `easeOutBack`），别各处手写。

---

## 8. 验收

- 打开 HUD 编辑屏，20 个组件都能拖、能吸附、重进游戏位置还在 → `HudElement` 接对了
- TargetHUD 打一下生物，脸/名/血条/装备都对；不打人时不出现 → 被动记录对了
- 10 只怪挤在一起，名牌自动错开不重叠 → `tagBoxes` 对了
- 通知连发 8 条，队列只留 5 条且依次滑入淡出 → 动画与队列对了
- 雷达 N 永远朝上，旋转视角时雷达不转 → 坐标系对了
