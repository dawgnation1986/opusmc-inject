# 05 · TargetHUD、名牌、目标光环

> 从 OpusMC userscript 往 Fabric 1.21.1 移植的第三批笔记。这一卷只处理「盯着一个目标看」时的三块东西：左上/可拖动的 TargetHUD 面板、挂在实体头顶的 Nametags、以及目标脚下的 TargetRing + Beam。ESP 线框本体、雷达、HUD 水印这些放在 06 卷，别混在一起。

## 0. 先对齐源码位置

| JS 函数 / 块 | 行号 | 干什么 |
|---|---|---|
| `espFrame()` 里的 nametags 分支 | 2552–2630 | 世界内名牌的完整绘制（格式、背景、血条、手持、装备、防重叠） |
| `MODULES` 的 `nametags` 定义 | 454–469 | 9 个设置项与默认值 |
| `displayName / heldOf / armorOf / itemColor` | 1818–1850 | 别名、手持、装备、图标配色 |
| `COLORS / colorOf / isPlayerEntity / typeColor / hexToRgba` | 1770–1816 | 敌对/被动/玩家的三套取色 |
| `drawTargetRing()` | 2347–2387 | 48 段旋转光圈 + 上升光柱 |
| `MODULES` 的 `targetring` 定义 | 573–581 | color / size / speed / beam |
| `.cm-target` 及子元素 CSS | 9309–9328 | 112×40 面板的逐像素布局 |
| `#__comet_hudstage` 缩放 | 9285–9286 | `50vw/50vh + scale(2)`，设计像素 ×2 |
| `hudStage.innerHTML` 的目标面板 DOM | 11262–11267 | 5 个子元素 + 48×48 头像 canvas |
| `updateHud()` 的 TargetHud 分支 | 11644–11666 | 名字/血量/血条/头像的刷新时机 |
| `faceUV / getFaceImg / faceCrop / drawOfficialFace` | 4261–4357 | 生物正脸 UV 裁切（本卷最硬的一块） |
| `faceType / FACE_CN / FACE_COLORS / paintFace` | 11442–11598 | 类型反查 + 像素手绘兜底 |
| `.cm-target` glass/edit 主题 | 9497–9546 | 毛玻璃态与编辑态覆盖 |

Java 侧对应概念：`HudRenderCallback` 画屏幕面板，`WorldRenderEvents.AFTER_ENTITIES` 画世界里的名牌/光环，`EntityRenderer#renderLabelIfPresent` 的 Mixin 用来接管原版名牌，`PlayerSkinTextures` / `EntityModel` 取代网页版从内嵌 JSON 里抠 UV 的做法，`Config POJO + Gson` 承接那 9 个设置项。

---

## 1. 两条绘制通道，网页版和 Java 版的分法不一样

网页版把东西画在两层上：

- **DOM 层**（`#__comet_hudstage`，11232 起）：TargetHUD、水印、ArrayList、通知。全是 `div` + CSS，靠 `transform: scale(2)` 放大，`cm-tfill` 的血条流动是 `@keyframes cm-wave`。
- **Canvas 2D 层**（`#__comet_esp`，`ectx`，9349 行）：名牌、光环、追踪线、雷达。每帧 `espFrame()` 用 `project()` 把世界坐标手算成屏幕像素，再 `ctx.strokeRect / fillText / arc`。

Java 侧没有 DOM，也没有「手算 vp 矩阵」这回事：

- 屏幕面板 → `HudRenderCallback`，`DrawContext.fill/drawText/drawTexture`。
- 世界里的 3D 线（光环、beam、方块框）→ `WorldRenderEvents.AFTER_ENTITIES`，直接把世界坐标交给 `VertexConsumer` + `RenderLayer.getLines()`，投影矩阵由渲染管线自己乘，**不需要** `project()`。
- 世界里的文字（名牌、路径点名字）→ 要么 Mixin `EntityRenderer#renderLabelIfPresent` 复用原版的 billboard 文本，要么用 `WorldRenderContext` 拿 `Camera`/矩阵自己摆 billboard。这是唯一还需要「算屏幕位置」的地方，但算的是 3D→相机空间，不是网页版那套 `vp[16]` 点乘。

`project()`（1853–1860）整段可以直接删掉，别照抄：

```js
// 网页版：列主序 vp 矩阵手算，因为 Canvas 2D 没有深度管线
const cw = m[3]*x + m[7]*y + m[11]*z + m[15];
if (cw <= 0.1) return null;
return { x: (cx/cw*0.5+0.5)*w_, y: (1-(cy/cw*0.5+0.5))*h_ };
```

Java 里 `MatrixStack` + `VertexConsumer` 天生处理了这套，见 §5.2 和 06 卷 §4。

---

## 2. TargetHUD 面板

### 2.1 逐元素布局（CSS 9309–9328 + DOM 11262–11267）

先记住一件事：`#__comet_hudstage` 是 `width:50vw; height:50vh; transform:scale(2); transform-origin:0 0`（9285–9286）。所以下面 CSS 里的所有数字是**设计像素**，真正上屏要 ×2。Java 版用 `DrawContext` 时直接按「屏幕像素」写，等价于把这张表全部乘 2：

| 元素 | 设计坐标 / 尺寸 | 屏幕像素(×2) | 颜色 / 字号 |
|---|---|---|---|
| `.cm-target` 面板 | 112×40, radius 6, border .35px | 224×80 | 边框 `#5a5a5a`；底 `linear-gradient(135deg,#343434,#161616 55%,#343434)` |
| `.cm-tface` 头像框 | left 9, top 8, 24×24, radius 4 | left 18, top 16, 48×48 | 边框 `#5a5a5a`；底 `#3d3d3d→#1a1a1a`；内嵌 canvas **48×48** |
| `.cm-tname` 名字 | left 39, top 11, width 50 | left 78, top 22, w 100 | `font-size 5.5px→11px`, weight 700, `#fff`, 单行省略号 |
| `.cm-thp` 血量数字 | right 9, top 11 | right 18, top 22 | `5px→10px`, 700, `rgba(200,200,200,.95)` |
| `.cm-tbar` 血条底 | left 39, top 25, 64×4, radius 2 | left 78, top 50, 128×8 | `rgba(0,0,0,.55)` |
| `.cm-tfill` 血条填充 | 同尺寸，宽度 = hp/maxHp | 同上 | `linear-gradient(90deg,#9b9b9b,#fff,#9b9b9b)` + `cm-wave 1.6s linear infinite`（背景位移 0→200%） |

默认位置 `defaultHudPos('target')` = `{x:20, y:88}`（11297），相对左上角；可拖动，位置存 `cfg.hudPos.target`（`applyHudPos` 11304 起）。Java 版把这个坐标原样放进 config 里当 `targetHudX / targetHudY` 即可，只是它现在是屏幕像素，默认值建议给 `40, 176`（即 ×2）。

`cm-wave` 是纯 CSS 动画，Java 里没有。要么用 `RenderSystem` 每帧改一次 `drawTexture` 的 u 偏移做流动（简单），要么干脆画成静态渐变——血条流动是锦上添花，优先级放最后。

### 2.2 刷新时机（updateHud 11644–11666）

目标不是「准星指到谁」，而是最近 4 秒内打过谁 / Aura 当前锁谁：

```js
const tgt = (lastTarget && !lastTarget.dead && performance.now()-lastTargetAt < 4000)
  ? lastTarget : (auraTarget && !auraTarget.dead ? auraTarget : null);
```

- `lastTarget` / `lastTargetAt`：攻击命中时写入（Java 侧对应 `AttackEntityCallback.EVENT`）。
- `auraTarget`：Aura 模块当前目标（Java 侧由 Killaura 逻辑维护一个静态引用）。
- 超过 4000ms 就隐藏面板（`elTarget.style.display='none'`）。
- 头像只在 `faceRef !== tgt || facePending` 时重画（11657），`facePending` 是贴图异步 onload 置位的——这个缓存思路 Java 版照搬，别每帧重裁皮肤。

血量 `hp.toFixed(1)`（11655），Java 用 `LivingEntity#getHealth()`，最大血 `getMaxHealth()`；网页版 `maxHealth` 缺省 20，Java 版 `getMaxHealth()` 直接有，不用猜。

### 2.3 `TargetHudRenderer.java`

面板是纯屏幕绘制，走 `HudRenderCallback`。注意 1.21.1 Fabric API 的 `HudRenderCallback` 签名是 `(DrawContext, RenderTickCounter)`，团队口径记作 `(DrawContext, float tickDelta)` —— 注册层把 `tickCounter.getTickDelta(true)` 抽出来传给 renderer，renderer 内部一律用 `float tickDelta`，两卷保持一致。

```java
package opus.hud.client.render;

import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.text.Text;
import net.minecraft.util.math.MathHelper;
import opus.hud.client.OpusHudClient;
import opus.hud.client.config.OpusConfig;
import opus.hud.client.state.TargetState;

/** 左上角 112×40（设计像素）的 TargetHUD。全部坐标已按 scale(2) 换算成屏幕像素。 */
public final class TargetHudRenderer {

    // 设计像素 ×2
    private static final int W = 224, H = 80;
    private static final int FACE_X = 18,  FACE_Y = 16, FACE_S = 48;
    private static final int NAME_X = 78, NAME_Y = 22;
    private static final int BAR_X = 78, BAR_Y = 50, BAR_W = 128, BAR_H = 8;

    private static final int BG_TOP   = 0xFF343434;
    private static final int BG_BOT  = 0xFF161616;
    private static final int BORDER  = 0xFF5A5A5A;
    private static final int WHITE   = 0xFFFFFFFF;
    private static final int HP_TEXT = 0xFFC8C8C8;

    public static void register() {
        HudRenderCallback.EVENT.register((DrawContext ctx, var tickCounter) -> {
            float tickDelta = tickCounter.getTickDelta(true);
            render(ctx, tickDelta);
        });
    }

    public static void render(DrawContext ctx, float tickDelta) {
        OpusConfig cfg = OpusHudClient.CONFIG;
        if (!cfg.hud.enabled || !cfg.hud.targetHud) return;

        LivingEntity target = TargetState.current();   // 4s 内 lastTarget / auraTarget
        MinecraftClient mc = MinecraftClient.getInstance();
        int x = cfg.hud.targetHudX, y = cfg.hud.targetHudY;

        // 面板底：CSS 的 135deg 渐变在 DrawContext 里用两条 fill 近似，
        // 想完全一致就上 fillGradient（1.21.1 有 drawVerticalGradient 的重载）。
        ctx.fill(x, y, x + W, y + H, BG_TOP);
        ctx.fill(x + 1, y + 1, x + W - 1, y + H - 1, 0xE0161616);
        drawBorder(ctx, x, y, W, H, BORDER);

        String name;
        float hp = 0f, maxHp = 20f;
        if (target == null) {
            name = "目标面板";
            hp = maxHp;
            FaceTextureHelper.drawPlaceholder(ctx, x + FACE_X, y + FACE_Y, FACE_S, mc);
        } else {
            name = target.getType().getName().getString();   // 别名见 §4.2，这里先走原名
            if (target instanceof net.minecraft.client.network.OtherClientPlayerEntity p) {
                name = p.getDisplayName().getString();
            }
            hp = target.getHealth();
            maxHp = target.getMaxHealth();
            FaceTextureHelper.drawEntityFace(ctx, target, x + FACE_X, y + FACE_Y, FACE_S, mc);
        }

        // 名字：CSS width:50(设计) + ellipsis。TextRenderer 用 trimToWidth 裁。
        var tr = mc.textRenderer;
        String clipped = tr.trimToWidth(name, 100);
        ctx.drawText(tr, Text.literal(clipped), x + NAME_X, y + NAME_Y, WHITE, true);

        // 血量数字右对齐到面板右边 18px 处
        String hpStr = String.format("%.1f", hp);
        int hpW = tr.getWidth(hpStr);
        ctx.drawText(tr, Text.literal(hpStr), x + W - 18 - hpW, y + NAME_Y, HP_TEXT, true);

        // 血条底 + 填充
        ctx.fill(x + BAR_X, y + BAR_Y, x + BAR_X + BAR_W, y + BAR_Y + BAR_H, 0xB0000000);
        float pct = MathHelper.clamp(hp / Math.max(1f, maxHp), 0f, 1f);
        int fw = (int) (BAR_W * pct);
        // cm-wave 流动：把渐变拆成三段，按 tick 做水平位移
        drawWaveBar(ctx, x + BAR_X, y + BAR_Y, fw, BAR_H, tickDelta);
    }

    /** 背景位移 0→200% 的近似：三段灰白灰，按时间平移。 */
    private static void drawWaveBar(DrawContext ctx, int x, int y, int w, int h, float tickDelta) {
        if (w <= 0) return;
        int phase = (int) ((System.currentTimeMillis() / 16) % (w * 2));
        int mid = w / 2;
        ctx.fill(x, y, x + Math.min(w, Math.max(0, mid - phase % w)), y + h, 0xFF9B9B9B);
        ctx.fill(x, y + 1, x + w, y + h - 1, 0xFFFFFFFF);
        ctx.fill(x, y, x + w, y + 1, 0xFF9B9B9B);
    }

    private static void drawBorder(DrawContext ctx, int x, int y, int w, int h, int color) {
        ctx.fill(x, y, x + w, y + 1, color);
        ctx.fill(x, y + h - 1, x + w, y + h, color);
        ctx.fill(x, y, x + 1, y + h, color);
        ctx.fill(x + w - 1, y, x + w, y + h, color);
    }
}
```

`TargetState` 是 `AttackEntityCallback` 和 Aura 共用的一个静态持有者：

```java
package opus.hud.client.state;

import net.fabricmc.fabric.api.event.player.v1.AttackEntityCallback;
import net.minecraft.entity.LivingEntity;
import net.minecraft.util.ActionResult;

/** 对应 JS 的 lastTarget / lastTargetAt / auraTarget，4000ms 过期。 */
public final class TargetState {
    private static LivingEntity lastTarget;
    private static long lastTargetAt;
    private static LivingEntity auraTarget;
    private static final long TTL_MS = 4000L;

    public static void register() {
        AttackEntityCallback.EVENT.register((player, world, hand, entity, hitResult) -> {
            if (entity instanceof LivingEntity le && !le.isDead()) {
                lastTarget = le;
                lastTargetAt = System.currentTimeMillis();
            }
            return ActionResult.PASS;   // 绝不吞掉原版攻击
        });
    }

    public static void setAuraTarget(LivingEntity e) { auraTarget = e; }

    public static LivingEntity current() {
        long now = System.currentTimeMillis();
        if (lastTarget != null && !lastTarget.isDead() && now - lastTargetAt < TTL_MS) {
            return lastTarget;
        }
        if (auraTarget != null && !auraTarget.isDead()) return auraTarget;
        return null;
    }
}
```

> `AttackEntityCallback` 只在你真的挥到实体的那一下触发，和网页版 `lastTargetAt` 的语义一致。如果还想要「准星悬停也算目标」，再补一个 raycast（`client.crosshairTarget`）分支，但那会让面板一直在闪，默认别开。

---

## 3. 生物头像裁切算法

这是整卷唯一需要认真做「等价替换」的地方，网页版为了从一张实体贴图里抠出正脸写了三个函数，Java 版有 `PlayerSkinTextures` 和 `EntityModel`，能省掉大半，但生物贴图那条路还是得自己裁。

### 3.1 网页版到底在干什么（4261–4357）

`faceUV(type)`（4262–4294）：

1. 从 `W.ENTITY_DATA.layers` 里取 `type + '#main'` 或 `type` 这一层；
2. `walk()` 递归（深度 ≤6）找数组 `o.head`；
3. `head[7]` 是这个部件的面列表，遍历找 `q[2] < -0.5` 的那一项 —— 即**法线朝 -Z 的正面**，找不到就退而用 `faces[0]`；
4. 从 `f[3]` 开始每 5 个一组，取 `u = f[i+3]`、`v = f[i+4]`，求包围盒 `u0,v0,u1,v1`（归一化 0–1 UV）。

`faceCrop(img)`（4312–4336）：

- `iw/ih` 取 `naturalWidth/naturalHeight`（默认 64×32）；
- UV → 像素：`sx = floor(u0*iw)`、`sy = floor(v0*ih)`、`sw = ceil((u1-u0)*iw)`、`sh = ceil((v1-v0)*ih)`；
- **有效性检查**：把贴图画进临时 canvas，`getImageData(sx,sy,sw,sh)` 数 alpha>40 的像素占比 `ratio`；`ratio < 0.3 || sw<3 || sh<3` 就回退成整张贴图。这一步是防止 UV 算错裁出一块全透明的空白；
- 结果缓存在 `img.__crop`。

`drawOfficialFace(c, type, S, e)`（4338–4357）：

```js
const crop = (getS('hud','faceStyle') === '整张贴图')
  ? { sx:0, sy:0, sw:iw, sh:ih } : faceCrop(img);
c.imageSmoothingEnabled = false;
c.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 2, 2, S-4, S-4);
```

`faceStyle` 三档（500–501）：`自动正脸`（走上面的 UV 裁切）、`整张贴图`（不裁）、`像素手绘`（`drawOfficialFace` 直接返回 false，交给 `paintFace` 用 `FACE_COLORS` 画色块）。

源码里那句注释是踩过坑的，务必读一遍（4348–4349）：

> head front 在原版贴图里几乎都在像素 (8,8)-(16,16)；按真实贴图高度换算 v，64×64 皮肤才不会裁到身体（之前写死 v=0.25~0.5 就是猪头像变棕黑条的原因）

也就是说：**不能把 v 写成固定的 0.25~0.5**，因为 32 高贴图（老生物）和 64 高贴图（玩家皮肤 / 新版）里 `(8,8)-(16,16)` 的归一化 v 完全不同。网页版靠 `ENTITy_DATA` 的 UV 或 fallback `{8/iw, 8/ih, 16/iw, 16/ih}`（4316）按 `ih` 动态算，这才是对的。

### 3.2 网页版从内嵌 JSON 取 UV vs Java 版

| | 网页版 OpusMC | Java 1.21.1 |
|---|---|---|
| 模型数据 | `W.ENTITY_DATA.layers`，JS 自己解析的 JSON（部件 + 面 + 顶点 UV） | `EntityModel` / `ModelPart`，Mojang 编译好的类 |
| 贴图 | `faceTexture()` 找 `img.src`（可能是 dataURL 或内嵌资源） | `Identifier`（`minecraft:textures/entity/...`）+ `PlayerSkinTextures` |
| 取正脸 | 递归找 `head[7]` 里朝 -Z 的面，算 UV 包围盒 | **不用算**。玩家皮肤的正脸固定是 64×64 的 `(8,8)-(16,16)`，帽子层在 `(40,8)-(48,16)`；生物贴图用 `NativeImage` 裁 |
| 渲染 | Canvas 2D `drawImage` 九参缩放 | `DrawContext.drawTexture` + `MatrixStack.scale`，或注册成动态贴图 |

结论：**玩家头像那套 UV 递归在 Java 版可以整个删掉**，因为 `PlayerSkinTextures` 给的皮肤本来就是标准布局，直接 `(8,8,8,8)` 裁。生物（猪/苦力怕/监守者）没有统一皮肤，还得沿用「从贴图裁一块」的思路，但数据源从 `ENTITY_DATA` 换成 `ResourceManager` 读到的 `NativeImage`。

### 3.3 `FaceTextureHelper.java` —— 玩家走 SkinTextures，生物走 NativeImage

```java
package opus.hud.client.render;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.network.OtherClientPlayerEntity;
import net.minecraft.client.network.PlayerListEntry;
import net.minecraft.client.network.PlayerSkinTextures;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.entity.LivingEntity;
import net.minecraft.resource.Resource;
import net.minecraft.util.Identifier;
import org.joml.Matrix4f;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** 对应 JS 的 getFaceImg / faceCrop / drawOfficialFace。 */
public final class FaceTextureHelper {

    /** 生物中文/英文类型 → 实体贴图 Identifier，对应 FACE_CN（11444–11453）。 */
    private static final Map<String, Identifier> MOB_TEX = new HashMap<>();
    static {
        put("zombie",       "minecraft", "textures/entity/zombie/zombie.png");
        put("creeper",      "minecraft", "textures/entity/creeper/creeper.png");
        put("skeleton",     "minecraft", "textures/entity/skeleton/skeleton.png");
        put("enderman",     "minecraft", "textures/entity/enderman/enderman.png");
        put("pig",          "minecraft", "textures/entity/pig/pig.png");
        put("cow",          "minecraft", "textures/entity/cow/cow.png");
        put("sheep",        "minecraft", "textures/entity/sheep/sheep.png");
        put("chicken",      "minecraft", "textures/entity/chicken.png");
        put("villager",     "minecraft", "textures/entity/villager/villager.png");
        put("warden",       "minecraft", "textures/entity/warden/warden.png");
    }
    private static void put(String k, String ns, String path) {
        MOB_TEX.put(k, Identifier.of(ns, path));
    }

    /** 裁好的 8×8 正脸，注册成动态贴图后缓存；对应 faceImgs[ck]。 */
    private static final Map<Identifier, Identifier> CROP_CACHE = new HashMap<>();

    public static void drawEntityFace(DrawContext ctx, LivingEntity e,
                                      int x, int y, int size, MinecraftClient mc) {
        Identifier skin = playerSkin(e, mc);
        if (skin != null) {
            // 玩家皮肤：标准 64×64，head front 固定 (8,8)-(16,16)，第二层帽子 (40,8)-(48,16)
            drawSkinCrop(ctx, skin, x, y, size, 8, 8, mc);        // base
            drawSkinCrop(ctx, skin, x, y, size, 40, 8, mc);       // hat overlay
            return;
        }
        Identifier mob = MOB_TEX.get(mobKey(e));
        if (mob != null) {
            drawMobCrop(ctx, mob, x, y, size, mc);
            return;
        }
        drawPlaceholder(ctx, x, y, size, mc);
    }

    /** 玩家：PlayerListEntry → PlayerSkinTextures.texture()，对应 e.look.skin / e.skinName。 */
    private static Identifier playerSkin(LivingEntity e, MinecraftClient mc) {
        if (!(e instanceof OtherClientPlayerEntity p)) return null;
        if (mc.getNetworkHandler() == null) return null;
        PlayerListEntry entry = mc.getNetworkHandler().getPlayerListEntry(p.getUuid());
        if (entry == null) return null;
        PlayerSkinTextures tex = entry.getSkinTextures();
        return tex == null ? null : tex.texture();
    }

    /**
     * DrawContext.drawTexture 只做 1:1 像素拷贝，要把 8×8 放大到 size×size，
     * 就对 MatrixStack 做一次 scale。等价于 JS 的 drawImage 九参形式。
     */
    private static void drawSkinCrop(DrawContext ctx, Identifier skin,
                                     int x, int y, int size, int u, int v, MinecraftClient mc) {
        float s = size / 8f;
        ctx.getMatrices().push();
        ctx.getMatrices().translate(x, y, 0f);
        ctx.getMatrices().scale(s, s, 1f);
        // (texture, x, y, u, v, width, height, textureWidth, textureHeight)
        ctx.drawTexture(skin, 0, 0, u, v, 8, 8, 64, 64);
        ctx.getMatrices().pop();
    }

    /**
     * 生物贴图：从 ResourceManager 读 NativeImage，按原版 head front (8,8)-(16,16)
     * 裁 8×8，注册成 NativeImageBackedTexture 后复用。
     * 这一步就是 JS faceCrop 的 1:1 移植——区别只是数据源从 <img>/canvas 换成 NativeImage。
     */
    private static void drawMobCrop(DrawContext ctx, Identifier srcId,
                                    int x, int y, int size, MinecraftClient mc) {
        Identifier cropped = CROP_CACHE.get(srcId);
        if (cropped == null) {
            cropped = buildCrop(srcId, mc);
            CROP_CACHE.put(srcId, cropped);
        }
        if (cropped == null) { drawPlaceholder(ctx, x, y, size, mc); return; }
        float s = size / 8f;
        ctx.getMatrices().push();
        ctx.getMatrices().translate(x, y, 0f);
        ctx.getMatrices().scale(s, s, 1f);
        ctx.drawTexture(cropped, 0, 0, 0, 0, 8, 8, 8, 8);
        ctx.getMatrices().pop();
    }

    private static Identifier buildCrop(Identifier srcId, MinecraftClient mc) {
        try {
            Resource res = mc.getResourceManager().getResource(srcId).orElse(null);
            if (res == null) return null;
            try (InputStream in = res.getInputStream();
                 NativeImage src = NativeImage.read(in)) {
                int iw = src.getWidth(), ih = src.getHeight();
                // 按真实贴图高度换算 v：32 高和 64 高得到的像素行不同，别写死 0.25
                float u0 = 8f / iw, v0 = 8f / ih, u1 = 16f / iw, v1 = 16f / ih;
                int sx = Math.max(0, (int) Math.floor(u0 * iw));
                int sy = Math.max(0, (int) Math.floor(v0 * ih));
                int sw = Math.max(1, Math.min(iw - sx, (int) Math.ceil((u1 - u0) * iw)));
                int sh = Math.max(1, Math.min(ih - sy, (int) Math.ceil((v1 - v0) * ih)));

                // 对应 faceCrop 的 alpha 占比检查：裁出来几乎全透明就退回整张
                int opaque = 0;
                for (int py = sy; py < sy + sh; py++) {
                    for (int px = sx; px < sx + sw; px++) {
                        if ((src.getColor(px, py) >>> 24) > 40) opaque++;
                    }
                }
                boolean bad = (sw < 3 || sh < 3) || (opaque / (float) (sw * sh) < 0.3f);
                if (bad) { sx = 0; sy = 0; sw = iw; sh = ih; }

                NativeImage out = new NativeImage(sw, sh, false);
                for (int py = 0; py < sh; py++) {
                    for (int px = 0; px < sw; px++) {
                        out.setColor(px, py, src.getColor(sx + px, sy + py));
                    }
                }
                Identifier id = Identifier.of("opus-hud", "face/" +
                        srcId.getPath().replace('/', '_').replace(".png", ""));
                mc.getTextureManager().registerTexture(id, new NativeImageBackedTexture(out));
                return id;
            }
        } catch (Exception ignored) {
            return null;
        }
    }

    /** 对应 paintFace 里 e==null 的「目标」占位（11503–11507）。 */
    public static void drawPlaceholder(DrawContext ctx, int x, int y, int size, MinecraftClient mc) {
        ctx.fill(x, y, x + size, y + size, 0xFF12161F);
        ctx.drawText(mc.textRenderer, net.minecraft.text.Text.literal("目标"),
                x + size / 2 - mc.textRenderer.getWidth("目标") / 2,
                y + size / 2 - 4, 0xFF7A8290, false);
    }

    private static String mobKey(LivingEntity e) {
        String path = net.minecraft.registry.Registries.ENTITY_TYPE.getId(e.getType()).getPath();
        return path.replace("_", "");
    }
}
```

几个必须说清的点：

- `PlayerSkinTextures` 是 1.20.5+ 才有的类（之前叫 `PlayerListEntry#getSkinTexture` 直接给 `Identifier`）。1.21.1 用 `entry.getSkinTextures().texture()`，没问题。
- `NativeImage.read(InputStream)` 读的是**资源包里**的贴图；如果装了改生物贴图的材质包，`ResourceManager` 会自动给到改后的那张，比网页版 `faceTexture()` 去猜 `img.src` 稳。
- `NativeImageBackedTexture` 注册后要由 `TextureManager` 管生命周期，别在 `drawMobCrop` 里 new 完就丢；这里用 `CROP_CACHE` 保证每个实体类型只裁一次，和 `faceImgs[ck]` 一一对应。
- `drawTexture` 的 `textureWidth/textureHeight` 参数在 1.21.1 仍可用；若你的映射用的是新 `drawTexture(Function<Identifier,RenderLayer>, ...)` 重载，把 `ctx.drawTexture(...)` 换成 `ctx.drawTexture(RenderLayer::getGuiTextured, ...)` 即可，逻辑不变。

### 3.4 像素手绘兜底（`paintFace` 11494–11598）

`faceStyle='像素手绘'` 时网页版完全不碰贴图，用 `FACE_COLORS`（11467–11492）给每种生物配三色 `[主色, 暗边, 眼睛色]`，然后按类型画特征：`sheep` 画羊毛、`cow` 画角、`pig` 画鼻子、`spider` 画红眼…… 玩家则按名字 hash 出一个渐变色 + 首字母（11510–11520）。

这块**算法可以 1:1 移植**（就是一串 `fill()` + 颜色表），但优先级最低。Java 版直接用 `DrawContext.fill` 复刻 `rr()` 圆角矩形（11599–11603 的 `roundRect` 在 Java 里没有，用四个直角矩形拼，或干脆用直角），颜色表照抄成 `Map<String,int[]>`。默认 `自动正脸` 就够了，建议最后再做。

---

## 4. 名牌 Nametags（世界内）

### 4.1 设置项（454–469）

| id | 类型 | 默认 | 用途 |
|---|---|---|---|
| `held` | checkbox | true | 显示手持物 |
| `armor` | checkbox | true | 显示 4 格装备 |
| `compact` | checkbox | true | 紧凑排版（名字居中，不左移半个距离宽） |
| `scale` | slider 0.8–1.8 | 1.1 | 字号系数 |
| `color` | color | 空=白 | 名字颜色 |
| `bgColor` | color | 空=主题深 | 背景色 |
| `bgAlpha` | slider 0–100 | 88 | 背景不透明度 |
| `format` | select | 名称+距离 | 四选一 |
| `alias` | text | 空 | `鸡=咯咯,猪=佩奇` |

### 4.2 别名：displayName（1818–1830）

```js
for (const pair of raw.split(/[,，;；]/)) {
  const i = pair.indexOf('=');
  if (i < 0) continue;
  const k = pair.slice(0,i).trim(), v = pair.slice(i+1).trim();
  if (k && v && n.indexOf(k) >= 0) { n = n.replace(k, v); break; }
}
```

`cnName(e)` 是中文名（比如「僵尸」），中英文逗号/分号都能当分隔符，命中第一个 key 就 `replace` 并 `break`（只替换一次，不是全局）。Java 版：

```java
public static String displayName(LivingEntity e, OpusConfig.Nametags c) {
    String n = e.getType().getName().getString();   // 已按当前语言本地化
    for (String pair : c.alias.split("[,，;；]")) {
        int i = pair.indexOf('=');
        if (i < 0) continue;
        String k = pair.substring(0, i).trim(), v = pair.substring(i + 1).trim();
        if (!k.isEmpty() && !v.isEmpty() && n.contains(k)) {
            return n.replace(k, v);       // 只替换第一个命中，对应 break
        }
    }
    return n;
}
```

### 4.3 格式与排版（2552–2630）

`format` 四档拼出来的 `label`（2556–2560）：

```
仅名称          → name
名称+血量       → name + ' ' + round(health) + 'hp'
名称+距离+血量  → name + ' ' + round(dist) + 'm ' + round(health) + 'hp'
名称+距离(默认) → name + '  ' + round(dist) + 'm'      // 两个空格
```

字号 `font = '700 ' + round(12*scale) + 'px'`，`scale` 被 `clamp(0.7, 2)`（2555）。注意 CSS 里 12px 也是设计像素，但名牌是画在 `ectx`（espCanvas，与 gl 画布同尺寸）上的，所以这里已经是物理像素，Java 版按 `client.getWindow().getScaledWidth()` 坐标系直接用，别再 ×2。

宽度计算（2571–2577）：

```js
const wName = measureText(label).width || 40;
const wDist = 30 + wName/2;          // 紧凑排版相关，但只有非 compact 才用
const wHeld = heldNm ? measureText(heldNm).width + 26 : 0;
const wArmor = armor.filter(Boolean).length * 11;
const tw = max(74, wName+40, wHeld+wArmor+12);
const th = (isMob ? 8 : 0) + (heldNm||wArmor ? 13 : 0) + 17;
```

`th` 分三段：名字行 17、血条行 8（仅生物）、装备行 13（仅当有手持/装备）。Java 用 `TextRenderer.getWidth()` 替 `measureText`，`textRenderer.fontHeight` 替 17。

**防重叠**（2578–2585）值得单独留着：`tagBoxes` 是每帧的已占盒子数组，新标签从 `ty = minY - 12 - th/2` 起，撞上就往下错 `(b.h+th)/2+3`。Java 里搞一个每帧 `clear()` 的 `List<TagBox>`，逻辑照搬，见 §4.7。

背景（2588–2592）：

- `bgColor` 空时按主题挑：glass → `rgba(18,22,32,bga)`，否则 `rgba(8,11,18,bga)`；
- `bga = clamp(bgAlpha/100, 0, 1)`，默认 0.88；
- 圆角矩形 `rr(c, left, top, tw, th, 6)` 填充，再 `stroke hexToRgba(color,.55)` 描边 —— 描边色用的是 **ESP 框的颜色**（`color`），不是名字色，这样生物框和名牌边框同色。

血条（2605–2611）：`tw-12` 宽、4px 高，`hp>0.5` 绿 `#6ee7a5`、`>0.25` 黄 `#ffc857`、否则红 `#ff5f6d`。Java 直接 `fill()` 三档。

手持/装备（2612–2628）：手持物画 7×7 色块（`itemColor(held)`）+ 名字前 8 字；装备每格 7×7 色块、水平步长 11。`itemColor(id)`（1847–1850）是 `hsl((abs(id)*47)%360, 62%, 62%)` —— 纯数值 hash，Java 里用 `Item.getRawId(item)` 或 `Registries.ITEM.getRawId()` 复刻即可，但更推荐直接用 `ItemStack` 的稀有度/名字，比 hash 好看。

紧凑模式（2598）：`compact ? cx : cx - wDist/2`，即紧凑时名字居中，非紧凑时左移给右侧距离数字让位。注意右侧距离 `fillText(round(dist)+'m', left+tw-6, ly)`（2601）**无论 compact 与否都画**，所以默认 `名称+距离` 格式下其实距离会出现两次（label 里一次、右对齐一次）—— 这是网页版的原样行为，移植时按你自己的审美决定要不要去重，我建议去重。

### 4.4 颜色计算（1770–1816）

```js
const COLORS = {
  hostile:'#ff5252', passive:'#4fc3f7', player:'#c084fc',
  line:'rgba(255,82,82,.65)', text:'#fff',
  hpBg:'rgba(0,0,0,.55)', hpFill:'#e8e8e8'
};
```

`colorOf(e)` 的优先级：`e.T.hostile` → 红；`e.T.passive` → 蓝；`e.type==='player'` → 紫；再按 `constructor.name`（`HOSTILE` 集合 1043）判定，兜底蓝。`typeColor(modId,e,isMob)`（1801–1804）先按 `entityCat`（item/player/mob）找 `mobColor/playerColor/itemColor`，再回落 `color`，都空才让 `colorOf` 接管。

Java 侧的对应判定干净得多，不用查类名字符串：

```java
public static int entityColor(LivingEntity e, OpusConfig cfg) {
    if (e instanceof net.minecraft.client.network.OtherClientPlayerEntity) return 0xFFC084FC;
    // 1.21.1 有 MobEntity#isHostile? 没有统一接口，用类型标签判
    boolean hostile = e instanceof net.minecraft.entity.mob.HostileEntity
            || e.getType().isIn(net.minecraft.registry.tag.EntityTypeTags.SKELETONS);
    if (cfg.esp.mobColor != 0 && hostile) return cfg.esp.mobColor;
    return hostile ? 0xFFFF5252 : 0xFF4FC3F7;
}
```

`HostileEntity` 在 1.21.1 是存在的（`net.minecraft.entity.mob.HostileEntity`），比网页版 `HOSTILE.has(constructor.name)` 靠谱。怪物中立/被动的细分想做全，就照 1043 行那个集合抄一份 `Set<EntityType<?>>`。

`hexToRgba(hex,a)`（1806–1816）把 `#rgb`/`#rrggbb` 转成 `rgba()`，Java 里配一个 `ColorUtil.parseHex(String, float alpha)` 返回 `0xAARRGGBB`，全卷共用。

### 4.5 `NametagRenderer.java`

两条路都给，推荐 A，B 作为备选说明。

**路线 A（推荐）：Mixin 接管 `EntityRenderer#renderLabelIfPresent`**。原版本来就在实体头顶画名字牌，注入 `HEAD` + `cancel` 后自己画，billboard 朝向、遮挡、缩放都不用管。

```java
package opus.hud.client.mixin;

import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.entity.EntityRenderer;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.entity.Entity;
import net.minecraft.text.Text;
import opus.hud.client.render.NametagRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(EntityRenderer.class)
public abstract class EntityRendererMixin {

    /**
     * 1.21.1 Yarn 描述符：
     * renderLabelIfPresent(Entity, Text, MatrixStack, VertexConsumerProvider, int)V
     * 若你的映射带第 6 个 float tickDelta 参数，在描述符里补一个 F、形参表补一个 float 即可。
     */
    @Inject(
        method = "renderLabelIfPresent(Lnet/minecraft/entity/Entity;Lnet/minecraft/text/Text;" +
                 "Lnet/minecraft/client/util/math/MatrixStack;" +
                 "Lnet/minecraft/client/render/VertexConsumerProvider;I)V",
        at = @At("HEAD"),
        cancellable = true
    )
    private void opus$customNametag(Entity entity, Text text, MatrixStack matrices,
                                    VertexConsumerProvider vertexConsumers, int light,
                                    CallbackInfo ci) {
        if (NametagRenderer.render(entity, matrices, vertexConsumers, light)) {
            ci.cancel();   // 我们画过了，别再画原版那块半透明黑底名字
        }
    }
}
```

`NametagRenderer.render` 用 `matrices` 摆 billboard：

```java
package opus.hud.client.render;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.entity.Entity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.text.Text;
import net.minecraft.util.math.MathHelper;
import opus.hud.client.OpusHudClient;
import opus.hud.client.config.OpusConfig;

import java.util.ArrayList;
import java.util.List;

public final class NametagRenderer {

    /** 每帧清空，对应 JS 的 tagBoxes（2391 / 2578–2585）。 */
    private static final List<TagBox> BOXES = new ArrayList<>();
    private record TagBox(float x, float y, float w, float h) {}

    public static void beginFrame() { BOXES.clear(); }

    /** @return true 表示已绘制（调用方 ci.cancel()）。 */
    public static boolean render(Entity e, MatrixStack matrices,
                                  VertexConsumerProvider vc, int light) {
        OpusConfig.Nametags c = OpusHudClient.CONFIG.nametags;
        if (!c.enabled) return false;
        if (!(e instanceof LivingEntity le) || le.isDead()) return false;

        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc.player == null || e == mc.player) return false;
        double dist = mc.player.distanceTo(e);
        if (dist * dist > (double) OpusHudClient.CONFIG.esp.distance
                * OpusHudClient.CONFIG.esp.distance) return false;

        float scale = MathHelper.clamp(c.scale, 0.7f, 2f);
        String name = displayName(le, c);
        String label = formatLabel(c, name, dist, le);

        TextRenderer tr = mc.textRenderer;
        String distStr = (int) Math.round(dist) + "m";
        // 手持 / 装备
        String heldName = c.held ? itemName(le.getMainHandStack()) : null;
        List<ItemStack> armor = c.armor ? collectArmor(le) : List.of();

        int wName = tr.getWidth(label);
        int wHeld = heldName == null ? 0 : tr.getWidth(tr.trimToWidth(heldName, 80)) + 26;
        int wArmor = (int) armor.stream().filter(s -> !s.isEmpty()).count() * 11;
        int tw = Math.max(74, Math.max(wName + 40, wHeld + wArmor + 12));
        int th = 8 + ((heldName != null || wArmor > 0) ? 13 : 0) + 17;

        // 防重叠：撞上已有盒子就下移一行（2578–2585）
        float cx = 0f, ty = -12f - th / 2f;
        for (TagBox b : BOXES) {
            if (Math.abs(b.x - cx) < (b.w + tw) / 2f + 3 &&
                Math.abs(b.y - ty) < (b.h + th) / 2f + 2) {
                ty = b.y + (b.h + th) / 2f + 3;
            }
        }
        BOXES.add(new TagBox(cx, ty, tw, th));

        int color = entityColor(le);
        int bga = (int) (MathHelper.clamp(c.bgAlpha / 100f, 0f, 1f) * 255);
        int bg = c.bgColor.isEmpty() ? (0x080B12 | (bga << 24)) : ColorUtil.parseHex(c.bgColor, bga / 255f);

        matrices.push();
        // 原版 label 的 billboard：pile 之后再翻转，这里沿用其矩阵即可
        matrices.scale(scale, scale, scale);
        int left = -tw / 2, top = (int) (ty - th / 2);

        // 背景 + 描边（2588–2594）：DrawContext 在 Mixin 里没有，直接 fill 用 Tessellator 太重，
        // 所以这里把背景/文字交给 billboard 的 VertexConsumer 方块，或退回路线 B 的 HudRenderCallback。
        // 实战建议：路线 A 只画「文字」，背景与血条走路线 B 的屏幕空间绘制，见下。
        drawBillboardText(matrices, vc, tr, label, distStr, left, top, tw, th,
                          c, color, bg, le, heldName, armor, light);
        matrices.pop();
        return true;
    }

    private static void drawBillboardText(MatrixStack matrices, VertexConsumerProvider vc,
                                          TextRenderer tr, String label, String distStr,
                                          int left, int top, int tw, int th,
                                          OpusConfig.Nametags c, int color, int bg,
                                          LivingEntity le, String heldName,
                                          List<ItemStack> armor, int light) {
        // 1.21.1 TextRenderer.draw(Text, float x, float y, int color, boolean shadow,
        //        Matrix4f matrix, VertexConsumerProvider, TextRenderer.TextLayerType, int bg, int light)
        var mat = matrices.peek().getPositionMatrix();
        tr.draw(Text.literal(label), c.compact ? -tr.getWidth(label) / 2f : left,
                top + 4, ColorUtil.parseHex(c.color.isEmpty() ? "#f2f5fa" : c.color, 1f),
                true, mat, vc, TextRenderer.TextLayerType.SEE_THROUGH, bg, light);
        // 血条 / 装备图标：用 fill() 风格的 quad，代码骨架见 06 卷 EspRenderer 的 quad 工具。
    }

    private static String formatLabel(OpusConfig.Nametags c, String name, double dist, LivingEntity le) {
        int hp = Math.round(le.getHealth());
        return switch (c.format) {
            case "仅名称"        -> name;
            case "名称+血量"     -> name + " " + hp + "hp";
            case "名称+距离+血量" -> name + " " + Math.round(dist) + "m " + hp + "hp";
            default              -> name + "  " + Math.round(dist) + "m";
        };
    }

    private static String displayName(LivingEntity e, OpusConfig.Nametags c) { /* §4.2 */ return e.getName().getString(); }
    private static String itemName(ItemStack s) { return s.isEmpty() ? null : s.getName().getString(); }
    private static List<ItemStack> collectArmor(LivingEntity le) {
        List<ItemStack> out = new ArrayList<>();
        for (ItemStack s : le.getArmorItems()) out.add(s);
        return out;
    }
    private static int entityColor(LivingEntity e) { /* §4.4 */ return 0xFF4FC3F7; }
}
```

**路线 B（更省心）：完全不用 Mixin，全部在 `HudRenderCallback` 里画屏幕空间标签。** 用 `net.minecraft.client.render.RenderTickCounter` + `Camera` 把 `entity.getPos()` 投影到屏幕：

```java
// 每帧：camera.getPos() 作为原点，Vector3f 经 projectionMatrix * viewMatrix 变换
// 1.21.1 可以复用 net.minecraft.client.util.math.Matrix4f + Window 反算：
Vec3d cam = mc.gameRenderer.getCamera().getPos();
Vec3d world = e.getLerpedPos(tickDelta).add(0, e.getHeight() + 0.5, 0);
Vector3f clip = new Vector3f((float)(world.x-cam.x), (float)(world.y-cam.y), (float)(world.z-cam.z));
// 用 WorldRenderContext.projectionMatrix() 与 camera 的 view 矩阵做 perspectiveProject，
// 得到 (sx, sy)，再用 DrawContext.fill + drawText 画。
```

这条路的代价是得自己算 billboard 缩放和遮挡，好处是**背景、血条、手持、装备、防重叠全部能用 `DrawContext.fill/drawText` 直接画**，和 CSS 那套几乎一一对应，比在 `VertexConsumerProvider` 里拼 quad 舒服得多。我实际移植会选 B：Mixin 只用来 `ci.cancel()` 掉原版名字（避免重影），标签本体走屏幕空间。上面 `EntityRendererMixin` 改成只 cancel、不调 `render()` 即可。

> 一句话取舍：**算法（别名/格式/配色/防重叠/宽度计算）100% 可 1:1 移植**；**绘制载体必须换** —— Canvas 2D 的 `measureText/fillText/fillRect/roundRect` 换成 `TextRenderer.getWidth/draw/fill`，DOM/CSS 那套在这里完全不存在。

---

## 5. TargetRing 与 Beam

### 5.1 JS 逐行（2347–2387）

```js
const e = (lastTarget && !dead && now-lastTargetAt<4000) ? lastTarget
       : (auraTarget && !auraTarget.dead ? auraTarget : null);   // 和 TargetHUD 同一个目标源
const c = e.ipos(alpha) || e.pos;                                // 插值后的脚下坐标
const color = getS('targetring','color') || '#ff5f6d';
const t = now/1000;
const rad = max(0.2, getS('targetring','size')||0.9) * (1 + 0.12*sin(t*4));  // 呼吸
const spin = t * (getS('targetring','speed')||1);
for (i=0; i<48; i++) xyz.push([c[0]+cos(a)*rad, c[1]+0.05, c[2]+sin(a)*rad]);
strokeRingPath(ringProject(r, xyz, ...));                        // 48 段闭合环
if (beam) {
  const b1 = project(r, c[0], c[1], c[2]);                      // 脚
  const b2 = project(r, c[0], c[1]+2.2, c[2]);                  // 顶
  const gr = createLinearGradient(b2→b1);                       // 顶透明 → 底 0.5
  stroke 一条竖线;
}
```

参数：48 段、半径 `size*(1+0.12sin(4t))`、转速 `speed*t`、高度 `+0.05`（避免 z-fighting）、颜色默认珊瑚红 `#ff5f6d`、beam 高 2.2、线宽 `max(1.4, W_/700)` / `max(2, W_/500)`、`shadowBlur 12`。

**网页特有必须换实现的**：`project()` 手算屏幕坐标 → Java 直接画 3D；`createLinearGradient` 做 beam 的上下渐变 → Java 用逐顶点 color（顶点色 alpha 从 0→0.5）；`shadowBlur` → Java 用 `RenderLayer` 加一层半透明粗线做辉光，或走 04 卷的全屏模糊后处理，别指望有 canvas 阴影。

### 5.2 `TargetRingRenderer.java`

```java
package opus.hud.client.render;

import com.mojang.blaze3d.systems.RenderSystem;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.*;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.entity.LivingEntity;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.MathHelper;
import net.minecraft.util.math.Vec3d;
import opus.hud.client.OpusHudClient;
import opus.hud.client.config.OpusConfig;
import opus.hud.client.state.TargetState;
import org.joml.Matrix4f;

/** 目标脚下 48 段旋转光圈 + 2.2 格高的上升光柱。 */
public final class TargetRingRenderer {

    private static final int SEGMENTS = 48;
    private static final int DEFAULT_COLOR = 0xFFFF5F6D;

    public static void register() {
        WorldRenderEvents.AFTER_ENTITIES.register(TargetRingRenderer::onAfterEntities);
    }

    private static void onAfterEntities(WorldRenderContext context) {
        OpusConfig.TargetRing c = OpusHudClient.CONFIG.targetRing;
        if (!c.enabled) return;
        LivingEntity target = TargetState.current();
        if (target == null) return;

        // 1.21.1 WorldRenderContext 是 tickCounter()；旧映射的 tickDelta() 返回 float。
        float tickDelta = context.tickCounter().getTickDelta(true);
        MinecraftClient mc = MinecraftClient.getInstance();

        // AFTER_ENTITIES 阶段矩阵栈已平移到「相机相对坐标」，减去 camPos 即可
        Vec3d cam = context.camera().getPos();
        Vec3d foot = target.getLerpedPos(tickDelta);
        double bx = foot.x - cam.x, by = foot.y - cam.y + 0.05, bz = foot.z - cam.z;

        int argb = c.color.isEmpty() ? DEFAULT_COLOR
                : ColorUtil.parseHex(c.color, 0.9f);
        float r = ((argb >> 16) & 255) / 255f;
        float g = ((argb >> 8) & 255) / 255f;
        float b = (argb & 255) / 255f;

        float t = (System.currentTimeMillis() % 1000000L) / 1000f;
        float rad = Math.max(0.2f, c.size) * (1f + 0.12f * MathHelper.sin(t * 4f));
        float spin = t * c.speed;

        MatrixStack matrices = context.matrixStack();
        VertexConsumerProvider.Immediate immediate =
                mc.getBufferBuilders().getEntityVertexConsumers();

        // 穿墙显示：临时关深度测试，画完恢复（团队口径：RenderSystem 管深度/混合）
        RenderSystem.disableDepthTest();
        RenderSystem.depthMask(false);
        RenderSystem.enableBlend();
        RenderSystem.defaultBlendFunc();

        VertexConsumer lines = immediate.getBuffer(RenderLayer.getLines());
        Matrix4f m = matrices.peek().getPositionMatrix();

        // 48 段闭合环
        double prevX = 0, prevZ = 0;
        for (int i = 0; i <= SEGMENTS; i++) {
            double a = (double) i / SEGMENTS * Math.PI * 2 + spin;
            double px = bx + Math.cos(a) * rad;
            double pz = bz + Math.sin(a) * rad;
            if (i > 0) {
                line(lines, m, prevX, by, prevZ, px, by, pz, r, g, b, 0.9f);
            }
            prevX = px; prevZ = pz;
        }

        // Beam：两顶点 color alpha 从顶 0 → 底 0.5，取代 createLinearGradient
        if (c.beam) {
            float topY = (float) (by + 2.2);
            // 分段插值，让渐变更顺（两段就够，对应 JS 的 0→1 两个 colorStop）
            for (int i = 0; i < 8; i++) {
                float f0 = i / 8f, f1 = (i + 1) / 8f;
                float y0 = (float) by + (topY - (float) by) * f0;
                float y1 = (float) by + (topY - (float) by) * f1;
                float a0 = 0.5f * (1f - f0), a1 = 0.5f * (1f - f1);
                line(lines, m, bx, y0, bz, bx, y1, bz, r, g, b, a0);
            }
        }

        immediate.draw();   // 用 Immediate 必须自己 flush
        RenderSystem.depthMask(true);
        RenderSystem.enableDepthTest();
        RenderSystem.disableBlend();
    }

    /** RenderLayer.getLines() 的顶点格式：position + color + normal，末尾 .next()。 */
    private static void line(VertexConsumer vc, Matrix4f m,
                             double x1, double y1, double z1,
                             double x2, double y2, double z2,
                             float r, float g, float b, float a) {
        vc.vertex(m, (float) x1, (float) y1, (float) z1).color(r, g, b, a).normal(0, 1, 0).next();
        vc.vertex(m, (float) x2, (float) y2, (float) z2).color(r, g, b, a).normal(0, 1, 0).next();
    }
}
```

关于 `context.consumers()` 与 `getEntityVertexConsumers()`：1.21.1 Fabric API 的 `WorldRenderContext` 有 `consumers()`（有的映射叫 `vertexConsumers()`）能直接拿 `VertexConsumerProvider`，但那是由 `WorldRenderer` 统一 flush 的，自己不好控制时机。上面用 `MinecraftClient.getInstance().getBufferBuilders().getEntityVertexConsumers()` 拿 `Immediate` 再 `draw()`，是 ESP 类 mod 最稳的写法，两卷统一用这个。若你确认自己的映射里 `context.consumers()` 可用，把 `immediate` 换过去、删掉 `immediate.draw()` 即可。

`RenderLayer.getLines()` 的线宽在 1.21 由 `RenderSystem.setLineWidth` / `RenderLayer.LineWidth` 控制，网页版那套 `W_/700` 的屏幕相关线宽就别照搬了 —— Java 里 GL 线宽本来就是像素单位，给个固定 2.0f 就够，想要粗光环就叠一层稍大半径的半透明环。

---

## 6. Mixin 注入点与事件注册

### 6.1 两个注入点

**`EntityRenderer#renderLabelIfPresent`**（§4.5 路线 A 已给完整 Mixin）：接管名牌。用带描述符的 `method =` 避免重载歧义，`cancellable = true`。

**`LivingEntityRenderer`**：网页版 `faceUV` 从 `ENTITY_DATA` 的 `head` 部件取 UV，本质是想拿到「这个生物模型长什么样」。Java 版不需要在渲染器里抠 UV，但如果你想做「按模型部件高亮」「给头盔挂血条」这类需要 `EntityModel` 的效果，注入点在这里：

```java
package opus.hud.client.mixin;

import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.entity.LivingEntityRenderer;
import net.minecraft.client.render.entity.model.EntityModel;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.entity.LivingEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(LivingEntityRenderer.class)
public abstract class LivingEntityRendererMixin<T extends LivingEntity, M extends EntityModel<T>> {

    /** 泛型擦除后的描述符；1.21.1 的 render 是 (LivingEntity, float, float, MatrixStack, VertexConsumerProvider, int)V */
    @Inject(
        method = "render(Lnet/minecraft/entity/LivingEntity;FF" +
                 "Lnet/minecraft/client/util/math/MatrixStack;" +
                 "Lnet/minecraft/client/render/VertexConsumerProvider;I)V",
        at = @At("HEAD")
    )
    private void opus$captureModel(T entity, float yaw, float tickDelta,
                                   MatrixStack matrices, VertexConsumerProvider vc,
                                   int light, CallbackInfo ci) {
        // 拿到 entity 后可以取 getBoundingBox() 做头顶血条、取 model 做部件高亮。
        // 这里只做数据登记，绘制统一放到 WorldRenderEvents，别在 Mixin 里刷 VertexConsumer。
        opus.hud.client.state.EntityFrame.capture(entity, tickDelta);
    }
}
```

> 提醒：`@Mixin` 目标类要写进 `opus-hud.mixins.json` 的 `client` 数组，`"compatibilityLevel": "JAVA_17"`，`package` 指向 `opus.hud.client.mixin`。注入 `renderLabelIfPresent` 时若服务端也加载了这个类会崩，务必放在 client-only mixin 配置里。

### 6.2 入口类 `OpusHudClient.java`

```java
package opus.hud.client;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import opus.hud.client.config.ConfigLoader;
import opus.hud.client.config.OpusConfig;
import opus.hud.client.render.NametagRenderer;
import opus.hud.client.render.TargetHudRenderer;
import opus.hud.client.render.TargetRingRenderer;
import opus.hud.client.state.TargetState;
import org.lwjgl.glfw.GLFW;

public final class OpusHudClient implements ClientModInitializer {

    public static OpusConfig CONFIG;
    public static final KeyBinding EDIT_HUD = KeyBindingHelper.registerKeyBinding(
            new KeyBinding("key.opus-hud.edit_hud", InputUtil.Type.KEYSYM,
                    GLFW.GLFW_KEY_RIGHT_SHIFT, "category.opus-hud"));

    @Override
    public void onInitializeClient() {
        CONFIG = ConfigLoader.load();   // Config POJO + Gson，见 §8

        // 事件注册（团队统一口径）
        TargetHudRenderer.register();       // HudRenderCallback
        NametagRenderer.beginFrame();       // 占位：实际每帧清 box 在 END_CLIENT_TICK
        TargetRingRenderer.register();      // WorldRenderEvents.AFTER_ENTITIES
        TargetState.register();             // AttackEntityCallback

        ClientTickEvents.END_CLIENT_TICK.register(mc -> {
            NametagRenderer.beginFrame();   // 每帧清 tagBoxes，对应 espFrame() 开头
            // 06 卷的 HUD 状态（通知队列过期、伤害数字、弹道缓存）也挂在这里
        });

        ClientPlayConnectionEvents.JOIN.register((handler, sender, mc) -> {
            TargetState.clear();            // 换世界时清掉旧目标，避免面板挂着上个服的怪
        });

        // 06 卷的 EspRenderer / RadarRenderer / HudElementsRenderer 也在这里 register()
    }
}
```

`KeyBindingHelper` + `ClientTickEvents` 里判 `EDIT_HUD.wasPressed()` 开 HUD 编辑模式，对应网页版 `state.editHud`（11416 行 `hudStage.classList.toggle('edit', ...)`）和那些可拖动面板。这块的拖拽交互 Java 版要自己写（鼠标按下记偏移、拖动改 config 坐标），没有 DOM 的 `makeDraggable` 可用。

---

## 7. 配置 POJO（本卷字段）

```java
package opus.hud.client.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;

import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;

public final class ConfigLoader {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Path FILE = FabricLoader.getInstance()
            .getConfigDir().resolve("opus-hud.json");

    public static OpusConfig load() {
        try {
            if (Files.exists(FILE)) {
                try (Reader r = Files.newBufferedReader(FILE)) {
                    OpusConfig c = GSON.fromJson(r, OpusConfig.class);
                    if (c != null) return c;
                }
            }
        } catch (Exception ignored) { /* 落回默认配置 */ }
        OpusConfig def = new OpusConfig();
        save(def);
        return def;
    }

    public static void save(OpusConfig c) {
        try (Writer w = Files.newBufferedWriter(FILE)) {
            GSON.toJson(c, w);
        } catch (Exception ignored) { }
    }
}
```

```java
package opus.hud.client.config;

/** 字段与 JS 的 MODULES 设置一一对应；05 卷先列三块，06 卷继续补。 */
public class OpusConfig {
    public Hud hud = new Hud();
    public Nametags nametags = new Nametags();
    public TargetRing targetRing = new TargetRing();
    public Esp esp = new Esp();

    public static class Hud {
        public boolean enabled = true, targetHud = true;
        public int targetHudX = 40, targetHudY = 176;   // 设计值 20,88 × scale(2)
        public String faceStyle = "自动正脸";           // 自动正脸 / 整张贴图 / 像素手绘
    }
    public static class Nametags {
        public boolean enabled = true, held = true, armor = true, compact = true;
        public float scale = 1.1f;
        public String color = "", bgColor = "", format = "名称+距离", alias = "";
        public int bgAlpha = 88;
    }
    public static class TargetRing {
        public boolean enabled = false, beam = true;
        public String color = "";
        public float size = 0.9f, speed = 1.0f;
    }
    public static class Esp {
        public int distance = 64;
        public int mobColor = 0, playerColor = 0, itemColor = 0;
    }
}
```

`ColorUtil` 顺手给一个，全卷共用：

```java
package opus.hud.client.render;

public final class ColorUtil {
    /** "#rgb" / "#rrggbb" / 空 → 0xAARRGGBB；对应 JS hexToRgba(hex, a)。 */
    public static int parseHex(String hex, float alpha) {
        if (hex == null || hex.isBlank()) return (int)(alpha*255) << 24;
        String h = hex.trim().replace("#", "");
        if (h.length() == 3) {
            h = "" + h.charAt(0)+h.charAt(0)+h.charAt(1)+h.charAt(1)+h.charAt(2)+h.charAt(2);
        }
        h = (h + "000000").substring(0, 6);
        try {
            int n = Integer.parseInt(h, 16);
            int a = Math.max(0, Math.min(255, (int)(alpha * 255)));
            return (a << 24) | (n & 0xFFFFFF);
        } catch (NumberFormatException e) {
            return (int)(alpha*255) << 24;
        }
    }
}
```

---

## 8. 可 1:1 移植 / 必须换实现

**算法直接搬，只换函数名：**

- 别名的 split/replace 逻辑、四种 format 拼串
- `tw/th` 的宽度估算（`measureText` → `TextRenderer.getWidth`）
- `tagBoxes` 防重叠（每帧清空 + 撞盒下移）
- `colorOf` 的三档配色优先级（红/蓝/紫）与 `typeColor` 的回落顺序
- `faceCrop` 的 UV→像素换算、**按真实贴图高度算 v**、alpha 占比 <0.3 回退整张
- TargetRing 的 48 段、`size*(1+0.12sin(4t))`、spin、beam 高 2.2
- `TargetState` 的 4 秒 TTL 与 lastTarget/auraTarget 双来源

**网页特有，必须换掉：**

| 网页版 | Java 版 |
|---|---|
| `project()` 手算 `vp[16]` 点乘 | `WorldRenderEvents` + `VertexConsumer` 直接画 3D，投影交给管线 |
| Canvas 2D `roundRect / fillText / measureText` | `DrawContext.fill / drawText` + `TextRenderer.getWidth` |
| `.cm-target` DOM + CSS `cm-wave` 关键帧 | `HudRenderCallback` 逐帧 `fill`，流动用矩阵位移近似 |
| `createLinearGradient(b2→b1)` 做 beam | 逐顶点 color alpha 0→0.5 |
| `ctx.shadowBlur = 12` 辉光 | 叠一层半透明粗环，或走 04 卷的两趟高斯模糊后处理 |
| `W.ENTITY_DATA.layers` 里递归找 `head[7]` 的 -Z 面 | 玩家用 `PlayerSkinTextures`（正脸固定 `(8,8)-(16,16)`）；生物用 `NativeImage` 读资源包贴图 |
| `<img>.onload` 异步 + `facePending` | `TextureManager` 同步注册 `NativeImageBackedTexture`，缓存一次 |
| `e.T.hostile` / `constructor.name` / `HOSTILE` 集合 | `e instanceof HostileEntity` + `EntityTypeTags` |
| `w/h` 猜包围盒 | `entity.getBoundingBox()` 直接给 `minX..maxZ` |

**最容易踩的两个坑：**

1. 皮肤 v 坐标别写死 0.25~0.5（4349 行注释，猪头像变棕黑条就是这么来的），一律 `8/ih`、`16/ih`。
2. `hudStage` 是 `scale(2)` 的：CSS 里 112×40 / 5.5px / 24×24 全是设计像素，Java 侧画面板时统一 ×2，但名牌画在 espCanvas 上已经是物理像素，**不要再乘**。两处坐标系不同，弄混了面板会小一半或名牌大一圈。

---

## 9. 落地顺序

1. `OpusConfig` + `ConfigLoader` + `ColorUtil` 先落地，后面每个 renderer 都依赖它。
2. `TargetState` + `AttackEntityCallback`，把「目标是谁」这条数据链打通 —— TargetHUD、TargetRing、TargetESP 全靠它。
3. `TargetHudRenderer` 面板框架（先不画头像，用占位），确认 `HudRenderCallback` 注册和屏幕坐标对。
4. `FaceTextureHelper` 玩家皮肤路径（`PlayerSkinTextures` + `drawTexture` 缩放），这是最高频、最容易被发现不对的地方。
5. `NametagRenderer` 路线 B（屏幕空间）+ `EntityRendererMixin` 只 cancel 原版名字，逐项对齐别名/格式/血条/装备。
6. `EntityRendererMixin` / `LivingEntityRendererMixin` 补进 `mixins.json`，确认 `renderLabelIfPresent` 描述符在你的 Yarn 版本里对得上。
7. `TargetRingRenderer` 放最后，它依赖 `RenderLayer.getLines()` 的正确顶点格式，先拿一个静态方块框验证 `VertexConsumer` 链路能画出来再上 48 段环。
8. 生物头像的 `NativeImage` 裁切和像素手绘兜底属于打磨项，主线跑通后再补。

06 卷会把 ESP 8 顶点线框、追踪线、雷达/小地图/罗盘、投掷物抛物线、HUD 水印/ArrayList/通知、伤害数字、世界血条、背包耐久一次性铺开，并给 `EspRenderer` / `RadarRenderer` / `HudElementsRenderer` 三个完整骨架和一张全量对照表。本卷的 `TargetState`、`ColorUtil`、`OpusHudClient` 入口会在那边直接复用。
