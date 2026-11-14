# 09 · 玩法模块实现思路

**对应源码**：`tickModules`（1647–1753）是总入口，`tickMovement`（1555–1598）、`tickAutoEat`（1625–1645）、`tickScaffold`（1331–1402）、`tickFreecam`（1453–1486）、`installFlyKeys` / `ensureFlyHook`（1490–1553）、`ensureCritHook`（1601–1622）、`hookNightVision`（945–954）、`updateMotionBlur`（3664–3690）、`applyXrayWorld`（1869–1877）、`applyGate`（866–879）、`applyServer`（882–887）、`perfLevel` / `perfGlow`（1943–1952）、`buildBackup` / `parseBackup`（11145–11229）、材质包链路（7651–7656、8385–8470）、`syncGuiClasses` / `setFloatOpen`（10620–10670）。模块定义见 README §2.3 / §2.4。

**要实现的效果**：把 25 个玩法模块从「hook 网页版游戏的 JS 字段」翻译成「Fabric 事件 / Mixin 改 Java 对象」，每个给出 JS 改了什么、Java 侧对应什么、关键代码片段。**Aura 的攻击逻辑按用户要求排除**——`tickAura` / `tickMultiAura` / `tickTrigger` / `tickBowAim` 的自动索敌与发包打人不在本卷，`02` 卷只搬它们的视觉部分；本卷也不重复展开 `02`–`06` 已经写完的纯渲染特效。

**Java 侧对应概念**：`ClientTickEvents.END_CLIENT_TICK`（对应每帧 `tickModules`）、Mixin 改 `ClientPlayerEntity` / `ClientPlayerInteractionManager` / `GameRenderer` / `ClientWorld` / `LightmapTextureManager` / `InGameHud`、`KeyBindingHelper`（对应 `keydown` 捕获）、`ModConfig`（07 卷，对应 `cfg`）、`ClientPlayNetworkHandler#sendPacket`（对应 `net.dig` / `net.send`）。

> Mixin 的方法名 / descriptor 按 Yarn 1.21.1 写，编译时以实际 mappings 为准调整 `@Inject(method = "...")`；类名与方法语义是稳定的。所有模块统一通过 `Module.isEnabled()`（07 卷）读开关，不在各模块里自己存状态。

---

## 0. 先对齐：JS 字段 → Java 对象

脚本所有玩法模块都在读写 `g`（game）和 `p`（player）上的字段。翻译前先把这张映射摆出来，后面每节直接引用：

| JS 字段（`p.*` / `g.*`） | 源码用途 | Java / Yarn 对应 |
|---|---|---|
| `p.sprinting` | autosprint 1668 | `ClientPlayerEntity#setSprinting(boolean)` / `isSprinting()` |
| `p.sneaking` / `p.usingItem` | 1668 跳过疾跑 | `player.isSneaking()` / `player.isUsingItem()` |
| `p.flying` / `p.creative` | fly 1509 / 1549 | `player.getAbilities().flying`；`creative` getter 对应 `PlayerAbilities#creativeMode` 或 `GameMode.CREATIVE` 判定 |
| `p.fallDist` / `p.slowFall` | nofall 1577 | `Entity#fallDistance`；Java 版更直接：`LivingEntity#handleFallDamage` |
| `p.speedBonus()` | speed 1589 | `LivingEntity#getMovementSpeed()`（Yarn 1.21.1 在 `LivingEntity`） |
| `p.stepHeight` | step 1568 | `Entity#getStepHeight()` / `setStepHeight(float)` |
| `p.food` / `p.air` | autoeat 1635 / waterbreath 1689 | `HungerManager#getFoodLevel()`；`Entity#getAir()` / `setAir(int)` |
| `p.inWater` / `p.eyeInWater` | 1689 | `Entity#isSubmergedInWater()` / `isTouchingWater()` |
| `p.deathTime` / `p.dead` | autorespawn 1730 | `LivingEntity#deathTime` / `isDead()`；或直接检测 `DeathScreen` |
| `p.inv.held` / `p.inv.slots` | autoeat 1629 / scaffold 1335 | `player.getInventory().getMainHandStack()` / `getStack(int)` |
| `p.yaw` / `p.pitch` | bowaim 1292 / freecam 1470 | `Entity#setYaw(float)` / `setPitch(float)`（注意 1.21 是度数） |
| `g.settings.autoJump` | autojump 1682 | `MinecraftClient#options.getAutoJump()`（`SimpleOption<Boolean>`） |
| `g.breakSpeed(id)` | fastbreak 1695 | `ClientPlayerInteractionManager#updateBlockBreakingProgress` / `AbstractBlockState#calcBlockBreakingDelta` |
| `g.breaking` / `g.breaking.progress` | instantbreak 1703 | `ClientPlayerInteractionManager` 的破坏进度（mixin 内部字段） |
| `g.net.dig(0/2, target)` | instantbreak 1708 | `ClientPlayNetworkHandler#sendPacket(PlayerActionC2SPacket)`（START_DESTROY_BLOCK / STOP_DESTROY_BLOCK） |
| `w.getBlock / w.setBlock` | scaffold 1369 / 1393 | `ClientWorld#getBlockState(BlockPos)` / `setBlockState(BlockPos, BlockState)` |
| `g.worldTime` / `g.weather` | ambience 1742–1745 | `ClientWorld#getTimeOfDay()` / `getRainGradient(float)` |
| `W.nightVisionScale(p)` | fullbright 949 | `LightmapTextureManager#update(float)` / `GameRenderer` 夜视强度 |
| `g.attack(...)` | crit 1604 | `AttackEntityCallback.EVENT` |
| `g.mouseBtn[2]` | autoeat 1638 / bowaim 1303 | `MinecraftClient#options.useKey`（`KeyBinding#setPressed`）或 `UseItemCallback` |
| `g.readInput()` | autosprint 1670 / freecam 1427 | `ClientPlayerEntity#input`（`Input` 字段） |
| `g.renderer.setCamera(...)` | freecam 1441 | `Camera#setPos / setRotation` 或 `GameRendererMixin#renderWorld` |
| `g.state` | tickModules 1653 挡掉非游玩状态 | `client.world == null` / `client.currentScreen` |
| `isMP(g)` | 1659 联机提示 | `client.isInSingleplayer()` 取反 |

一个贯穿全卷的注意点：源码 `tickModules` 开头 `syncRefs()`（993–1005）每帧重新对齐 `W.game` / `g.player`，因为网页版进服 / 复活 / 切维度会**重建 Player 实例**。Java 版 `client.player` 也会在切维度 / 重生时换对象，所以**不要在模块里缓存 `ClientPlayerEntity` 引用**，每帧从 `client.player` 取。`ClientPlayConnectionEvents.JOIN` 只用来做一次性初始化。

---

## 1. 移动类（源码 `cat: 'movement'`，7 个中的 5 个）

任务口径把 `scaffold` / `nofall` 放到「世界」类，按口径走；本节只放 AutoSprint / Fly / Speed / AutoJump / Step。

### 1.1 AutoSprint（`autosprint`）

**JS 要点**（1668–1674）：`modOn('autosprint') && p.health > 0 && !p.sneaking && !p.usingItem` 时，`g.readInput().fwd > 0` 就 `p.sprinting = true`；勾了 `onlyforward=false` 则不管方向都疾跑。每帧写字段，不还原（关闭后靠原版下一帧自然清掉）。

**Fabric 对应**：`ClientTickEvents.END_CLIENT_TICK` + `ClientPlayerEntity#setSprinting`；输入读 `client.player.input.movementForward`。

```java
public final class AutoSprintModule extends Module {
    public AutoSprintModule() {
        super("autosprint", "AutoSprint", "自动疾跑", ModuleCategory.MOVEMENT,
              "自动保持疾跑", null, false);
        spec(SettingSpec.checkbox("onlyforward", "仅前进", true));
    }
    @Override public void tick(MinecraftClient client) {
        if (!isEnabled()) return;
        ClientPlayerEntity p = client.player;      // 不缓存，见 §0
        if (p == null || p.getHealth() <= 0 || p.isSneaking() || p.isUsingItem()) return;
        boolean onlyForward = get("onlyforward");
        if (!onlyForward || p.input.movementForward > 0) {
            p.setSprinting(true);
        }
    }
}
```

### 1.2 Fly（`fly`）

**JS 要点**：`installFlyKeys`（1490）在 window 捕获阶段监听空格，双击间隔 < 300ms 切 `p.flying`；`ensureFlyHook`（1521）做了一件很巧的事——hook `Player.prototype.tick` 加 `__cometTick` 标记，再给 `p.creative` 定义 getter，**只在 tick 执行期间返回 true**，这样飞行物理生效而 HUD 的血条 / 饥饿条（只在 `!creative` 时画）不受影响。源码 971–973 那段注释也提醒：别改 `p.yaw`，会连视角一起转。

**Fabric 对应**：`ClientPlayerEntityMixin#tickMovement` + `PlayerAbilities`；双击检测用 `KeyBindingHelper` 的 `wasPressed()` + 时间戳。Java 版最干净的做法是直接开 `allowFlying`：

```java
public final class FlyModule extends Module {
    private long lastSpaceMs;
    public FlyModule() {
        super("fly", "Fly", "飞行", ModuleCategory.MOVEMENT,
              "双击空格开启 / 关闭飞行；飞行时空格上升、Shift 下降", null, false);
    }
    @Override public void tick(MinecraftClient client) {
        ClientPlayerEntity p = client.player;
        if (p == null) return;
        PlayerAbilities ab = p.getAbilities();
        if (!isEnabled()) {
            if (!p.isCreative() && !p.isSpectator()) { ab.allowFlying = false; ab.flying = false; }
            return;
        }
        ab.allowFlying = true;                       // 对应 p.creative 在 tick 期间为 true
        // 双击空格由 CometTick 统一检测（对应 flyTapAt < 300），这里只切换
        if (doubleTapSpace()) ab.flying = !ab.flying;
        // 上升 / 下降由原版飞行输入处理；若要自己接管，读 options.jumpKey / sneakKey
    }
    private boolean doubleTapSpace() {
        // KeyBindings.SPACE.wasPressed() + System.currentTimeMillis() 差值 < 300
        return false; // 实现见 07 卷 KeyBindings
    }
}
```

`ab.allowFlying = true` 在**单机**有效；联机服务端会下发自己的能力并覆盖，属于 §6 的「服务端权威」范畴。别去 mixin `PlayerAbilities` 的 getter 伪造 creative——源码那么做是为了不影响 HUD，Java 版 `PlayerAbilities` 和 HUD 渲染是分开的两套字段，没有这个耦合，直接改能力就行。

### 1.3 Speed（`speed`）

**JS 要点**（1585–1597）：hook `p.speedBonus`，在原值上加 `0.1 * (mult - 1)`，关闭时把原函数还回去。`mult` 范围 1–2.5，默认 1.5。

**Fabric 对应**：`ClientPlayerEntityMixin` 或 `LivingEntityMixin` 的 `getMovementSpeed()F` 用 `@ModifyReturnValue`。注意 `@ModifyReturnValue` 是 Fabric Loader 提供的 Mixin Extra，需在 mixin 配置里启用；不想引依赖就用 `@Inject(at = @At("RETURN"), cancellable = true)` + `ci.setReturnValue(...)`。

```java
@Mixin(LivingEntity.class)
public abstract class LivingEntityMixin {
    @ModifyReturnValue(method = "getMovementSpeed()F", at = @At("RETURN"))
    private float comet$modifySpeed(float original) {
        if (!(Object) this instanceof ClientPlayerEntity) return original;
        if (!ModConfig.isOn("speed")) return original;
        double mult = ModConfig.get("speed", "mult");   // 默认 1.5，07 卷 getS 回退
        return (float) (original * mult);               // 比源码的加法更直观，效果一致
    }
}
```

源码用加法 `+ 0.1*(mult-1)` 是因为它的 `speedBonus` 是「加成系数」；Java 的 `getMovementSpeed()` 已经是最终速度，用乘法更贴切。别把两套公式混着抄。

### 1.4 AutoJump（`autojump`）

**JS 要点**（1679–1687）：开启时把 `g.settings.autoJump = true`，首次先把原值存进 `p.__cometAutoJump.v`，关闭时还原。这个「保存旧值 / 关闭还原」的模式在 `nofall`（`__cometSlowFallSaved`）、`speed`（`__cometOrigSpeedBonus`）里反复出现，Java 版统一用一个 `SavedValues` 工具类，别每个模块各写一份。

**Fabric 对应**：`MinecraftClient#options.getAutoJump()`（`SimpleOption<Boolean>`）。

```java
public final class AutoJumpModule extends Module {
    private Boolean saved;                          // 对应 __cometAutoJump.v
    public AutoJumpModule() {
        super("autojump", "AutoJump", "自动跳跃", ModuleCategory.MOVEMENT,
              "前进被方块挡住时自动起跳", null, false);
    }
    @Override public void tick(MinecraftClient client) {
        SimpleOption<Boolean> opt = client.options.getAutoJump();
        if (isEnabled()) {
            if (saved == null) saved = opt.getValue();
            opt.setValue(true);
        } else if (saved != null) {
            opt.setValue(saved);
            saved = null;
        }
    }
}
```

### 1.5 Step（`step`）

**JS 要点**（1566–1572）：`p.stepHeight = 1`（一格高），关闭还原 0。

**Fabric 对应**：`EntityMixin#getStepHeight()F` 用 `@ModifyReturnValue`。

```java
@Mixin(Entity.class)
public abstract class EntityMixin {
    @ModifyReturnValue(method = "getStepHeight()F", at = @At("RETURN"))
    private float comet$stepHeight(float original) {
        if (!(Object) this instanceof ClientPlayerEntity) return original;
        return ModConfig.isOn("step") ? 1.0f : original;   // 原版约 0.6f
    }
}
```

---

## 2. 世界类（任务口径，7 个）

源码里这些分属 `player`（6 个）和 `movement`（2 个）。按任务口径归到一起：FastBreak / InstantBreak / AutoEat / WaterBreath / AutoRespawn / NoFall / Scaffold。

### 2.1 FastBreak（`fastbreak`）

**JS 要点**（1692–1701）：hook `g.breakSpeed(id)`，返回值乘 `getS('fastbreak','mult')`（默认 8，范围 2–20）。只 hook 一次（`g.__cometBreakHook` 标记）。

**Fabric 对应**：破坏进度的累积速率。`ClientPlayerInteractionManagerMixin#updateBlockBreakingProgress(BlockPos, Direction)` 里改 `blockBreakingProgress` 的增量，或 mixin `AbstractBlockState#calcBlockBreakingDelta` 的倍数。选后者更干净：

```java
@Mixin(AbstractBlockState.class)
public abstract class AbstractBlockStateMixin {
    @ModifyReturnValue(method = "calcBlockBreakingDelta(Lnet/minecraft/entity/player/PlayerEntity;"
            + "Lnet/minecraft/world/BlockView;Lnet/minecraft/util/math/BlockPos;)F",
            at = @At("RETURN"))
    private float comet$fastBreak(float original) {
        if (!ModConfig.isOn("fastbreak")) return original;
        double mult = ModConfig.get("fastbreak", "mult");
        return (float) Math.min(1.0f, original * mult);   // 别超过 1，否则一帧破坏可能越界
    }
}
```

`Math.min(1.0f, ...)` 是必要的：源码乘 8 也可能让进度溢出，Java 版进度超过 1 会让状态机错乱。

### 2.2 InstantBreak（`instantbreak`）

**JS 要点**（1703–1718）：`g.breaking` 有 `progress > 0` 时立刻完成。联机走 `net.dig(0, target)` 开挖 + `net.dig(2, target)` 完成 + `net.digging = null` + `g.netBreak(...)`，让服务器按 dig 包结算；单机直接 `g.breakBlock(br.pos...)`。最后 `g.breaking = null`、`g.attackCd = max(attackCd, 5)` 节流。

**Fabric 对应**：`AttackBlockCallback.EVENT`（左键点方块）+ `ClientPlayerInteractionManager#breakBlock`。联机发 `PlayerActionC2SPacket`。

```java
public final class InstantBreakModule extends Module {
    public InstantBreakModule() {
        super("instantbreak", "InstantBreak", "瞬间破坏", ModuleCategory.PLAYER,
              "开始挖掘立即破坏方块", null, false);
    }
    // 注册在 CometClient.onInitializeClient 里：
    // AttackBlockCallback.EVENT.register((player, world, hand, pos, direction) -> {
    //     if (!ModConfig.isOn("instantbreak")) return ActionResult.PASS;
    //     BlockState state = world.getBlockState(pos);
    //     if (state.isAir()) return ActionResult.PASS;
    //     // 单机：直接移除（客户端世界）；联机：发 START/STOP_DESTROY_BLOCK 让服务端结算
    //     if (client.isInSingleplayer()) {
    //         world.setBlockState(pos, Blocks.AIR.getDefaultState());
    //     } else {
    //         ClientPlayNetworkHandler net = client.getNetworkHandler();
    //         net.sendPacket(new PlayerActionC2SPacket(
    //             PlayerActionC2SPacket.Action.START_DESTROY_BLOCK, pos, direction));
    //         net.sendPacket(new PlayerActionC2SPacket(
    //             PlayerActionC2SPacket.Action.STOP_DESTROY_BLOCK, pos, direction));
    //     }
    //     return ActionResult.SUCCESS;   // 对应源码 g.breaking = null + attackCd 节流
    // });
    @Override public void tick(MinecraftClient client) {}
}
```

**注意**：联机时服务端会按自己的挖掘进度校验（见 §6），连发 START/STOP 很可能被判定为异常或忽略。源码自己也只在「让服务器按 dig 包结算」这个假设下工作，Java 版要把这条写进限制说明，别承诺联机有效。

### 2.3 AutoEat（`autoeat`）

**JS 要点**（1625–1645）：`p.food < threshold`（默认 16，范围 6–19）且 `W.itemDef(held.id).food` 为真时，替玩家按住右键 `g.mouseBtn[2] = true`、把 `g.useCd = 0`；不满足时还原 `keep.prev`。用 `p.__cometEat` 保存原始右键状态。

**Fabric 对应**：`ClientTickEvents.END_CLIENT_TICK` + `options.useKey.setPressed(true)`；食物判定用 `ItemStack#isFood()`（1.21.1 里 `ItemStack#isFood()` 或 `Item#getFoodComponent()`）。

```java
public final class AutoEatModule extends Module {
    private boolean wasUsing = false;                // 对应 __cometEat.prev
    public AutoEatModule() {
        super("autoeat", "AutoEat", "自动进食", ModuleCategory.PLAYER,
              "饥饿时自动吃手里的食物", null, false);
        spec(SettingSpec.slider("threshold", "触发饥饿值", 6, 19, 1, 16));
    }
    @Override public void tick(MinecraftClient client) {
        ClientPlayerEntity p = client.player;
        if (p == null) return;
        double threshold = get("threshold");
        ItemStack held = p.getInventory().getMainHandStack();
        boolean hungry = p.getHungerManager().getFoodLevel() < threshold;
        boolean want = isEnabled() && hungry && held.isFood();
        KeyBinding use = client.options.useKey;
        if (want) {
            if (!wasUsing) wasUsing = true;
            use.setPressed(true);                    // 对应 g.mouseBtn[2] = true
        } else if (wasUsing) {
            use.setPressed(false);                   // 对应还原 keep.prev
            wasUsing = false;
        }
    }
}
```

`use.setPressed(true)` 会触发原版的「使用物品」流程，食用进度、动画、饥饿恢复都由游戏自己算，比源码手动清 `useCd` 稳。

### 2.4 WaterBreath（`waterbreath`）

**JS 要点**（1689）：`modOn('waterbreath') && p.air > 0 && (p.inWater || p.eyeInWater)` 时 `p.air = 300`。注意 `p.air > 0` 这个条件——已经窒息到 0 就不再救。

**Fabric 对应**：`ClientPlayerEntityMixin#tickMovement` 尾部 `@Inject(at = @At("TAIL"))`。

```java
@Mixin(ClientPlayerEntity.class)
public abstract class ClientPlayerEntityMixin {
    @Inject(method = "tickMovement()V", at = @At("TAIL"))
    private void comet$waterBreath(CallbackInfo ci) {
        ClientPlayerEntity p = (ClientPlayerEntity) (Object) this;
        if (!ModConfig.isOn("waterbreath")) return;
        if (p.getAir() > 0 && (p.isSubmergedInWater() || p.isTouchingWater())) {
            p.setAir(p.getMaxAir());                 // 原版上限 300，对应源码写死 300
        }
    }
}
```

### 2.5 AutoRespawn（`autorespawn`）

**JS 要点**（1729–1736）：`p.deathTime > 0 || p.dead` 且 `now > respawnAt` 时调 `g.respawn()`，间隔 1500ms 节流。

**Fabric 对应**：检测 `client.currentScreen instanceof DeathScreen`（比读 `deathTime` 稳），发 `ClientStatusC2SPacket(PERFORM_RESPAWN)`。

```java
public final class AutoRespawnModule extends Module {
    private long nextAllowed = 0;
    public AutoRespawnModule() {
        super("autorespawn", "AutoRespawn", "自动重生", ModuleCategory.PLAYER,
              "死亡后自动重生", null, false);
    }
    @Override public void tick(MinecraftClient client) {
        if (!isEnabled()) return;
        if (!(client.currentScreen instanceof DeathScreen)) return;
        long now = System.currentTimeMillis();
        if (now < nextAllowed) return;                // 对应 respawnAt 节流
        nextAllowed = now + 1500;
        ClientPlayNetworkHandler net = client.getNetworkHandler();
        if (net != null) {
            net.sendPacket(new ClientStatusC2SPacket(
                    ClientStatusC2SPacket.Mode.PERFORM_RESPAWN));
        }
    }
}
```

### 2.6 NoFall（`nofall`）

**JS 要点**（1574–1583）：源码注释写得很关键——「游戏 `onLand()` 第一行是 `if (this.slowFall) return`，只清 `fallDist` 会被物理 tick 抢先；同时置 `slowFall` 才是可靠的免摔伤」。所以两件事一起做：`p.fallDist = 0` + `p.slowFall = true`，关闭时还原 `__cometSlowFallSaved`。

**Fabric 对应**：直接取消坠落伤害，比伪造字段可靠——`LivingEntityMixin#handleFallDamage` 用 `@Inject(cancellable = true)`。

```java
@Mixin(LivingEntity.class)
public abstract class LivingEntityMixin {
    @Inject(method = "handleFallDamage(DFLnet/minecraft/entity/damage/DamageSource;)Z",
            at = @At("HEAD"), cancellable = true)
    private void comet$noFall(double fallDistance, float damageMultiplier,
                              DamageSource source, CallbackInfoReturnable<Boolean> cir) {
        if (!((Object) this instanceof ClientPlayerEntity)) return;
        if (ModConfig.isOn("nofall")) cir.setReturnValue(false);   // 取消伤害
    }
}
```

`（DFL...;）Z` 这个 descriptor 在 1.21.1 里大概率是 `(FFL...DamageSource;)Z` 或 `(DFL...)Z`，编译时按实际 mappings 改。**联机限制**：伤害由服务端结算，客户端 `setReturnValue(false)` 只影响本地血条显示，服务端仍会扣血——详见 §6。

### 2.7 Scaffold（`scaffold`）

**JS 要点**（1331–1402）：60ms 节流；从 `held.id` 查 `def.block` 拿**权威方块 id**（源码 1344 行的坑：食物 / 工具没有 `block` 字段，早期版本拿 `held.id` 兜底会把羊肉当方块放出去，所以现在 `if (def.block == null) return`）；算脚下前方一格 `ax/ay/az`（`ahead` 设置项，默认 true，按 `g.lookDir()` 决定方向）；`w.getBlock(ax,ay,az) !== 0` 就跳过；找相邻实心方块算 face；联机 `net.send({t:'place', ...})`，单机 `w.setBlock(ax,ay,az,blockId,0)` 并扣手里方块数量；最后 `p.swing()`。

**Fabric 对应**：`ClientTickEvents.END_CLIENT_TICK` + `ClientPlayerInteractionManager#interactBlock`（联机走标准 `PlayerInteractBlockC2SPacket`），预览框画在 `AFTER_ENTITIES`。

```java
public final class ScaffoldModule extends Module {
    private long lastMs = 0;
    public ScaffoldModule() {
        super("scaffold", "Scaffold", "自动搭路", ModuleCategory.MOVEMENT,
              "前进时自动在脚下前方铺方块", null, false);
        spec(SettingSpec.checkbox("ahead", "铺前方", true));
    }
    @Override public void tick(MinecraftClient client) {
        if (!isEnabled()) return;
        long now = System.currentTimeMillis();
        if (now - lastMs < 60) return;               // 对应 scafAt 节流
        ClientPlayerEntity p = client.player;
        if (p == null) return;
        ItemStack held = p.getInventory().getMainHandStack();
        if (!(held.getItem() instanceof BlockItem)) return;   // 对应 def.block == null 直接 return
        Vec3d pos = p.getPos();
        BlockPos target = new BlockPos(
                (int) Math.floor(pos.x),
                (int) Math.floor(pos.y) - 1,
                (int) Math.floor(pos.z));
        if (get("ahead")) {
            Vec3d look = p.getRotationVec(client.getTickDelta());
            if (Math.abs(look.x) > Math.abs(look.z)) target = target.add(look.x > 0 ? 1 : -1, 0, 0);
            else target = target.add(0, 0, look.z > 0 ? 1 : -1);
        }
        ClientWorld world = client.world;
        if (world == null || !world.getBlockState(target).isAir()) return;
        // 走标准交互，让游戏自己处理发包 / 扣物品 / 挥手动画
        client.interactionManager.interactBlock(
                p, Hand.MAIN_HAND,
                new BlockHitResult(Vec3d.ofCenter(target), Direction.UP, target, false));
        p.swingHand(Hand.MAIN_HAND);                 // 对应 p.swing()
        lastMs = now;
    }
}
```

`instanceof BlockItem` 是源码 `def.block == null` 检查的 Java 等价物——别用 `held.getItem().getTranslationKey()` 猜方块 id，那是 1337–1350 行踩过的坑。

---

## 3. 工具类（任务口径，4 个）

XRay / 容器 ESP / 路径点 / 性能。源码里 `xray` / `containeresp` / `waypoints` 是 `render`，`perf` 是 `configs`；按任务口径归到「工具」。

### 3.1 XRay（`xray`）

**JS 要点**：`applyXrayWorld`（1869–1877）给游戏 WebGL 画布 `#gl` 加 `cm-xray-hidden` class，配合 CSS 把非矿石方块「变成空气」——**不动世界数据（不 setBlock）**，注释 1865–1867 强调这样不会破坏存档。`onFrame`（3104）只在 `mode === '材质透视'` 且游戏处于 play 时启用。另有 `mode='框选'`、扫描半径 `distance`、上限 `limit`、`through`（穿墙）、`labels`（矿石名字）。

**Fabric 对应**：隐藏画布这套没有等价物（08 卷 §3.6）。两条替代：① 注册一个资源包把非目标方块的模型替换成透明 / 玻璃（`client.reloadResources()` 生效）；② `mode='框选'` 走 `AFTER_ENTITIES` 画矿石高亮框，这是最稳的默认实现。扫描按 chunk 增量做，别每帧全扫。

```java
public final class XrayModule extends Module {
    private final Map<BlockPos, Block> cache = new HashMap<>();   // 扫描结果，chunk 更新时失效
    private long lastScan = 0;
    public XrayModule() {
        super("xray", "XRay", "矿透", ModuleCategory.RENDER,
              "材质透视 / 框选矿物", "世界与方块", false);
        spec(SettingSpec.select("mode", "透视模式",
                () -> List.of("材质透视", "框选"), "材质透视"));
        spec(SettingSpec.slider("distance", "扫描半径", 16, 128, 8, 48));
        spec(SettingSpec.slider("limit", "最多显示", 40, 600, 20, 200));
        spec(SettingSpec.checkbox("through", "穿墙显示", true));
        spec(SettingSpec.checkbox("labels", "矿石名字", true));
    }
    @Override public void tick(MinecraftClient client) {
        // 节流扫描：按 distance 半径遍历区块，只保留矿石 BlockState，结果写 cache
        // 对应源码 extOreScan；增量失效靠 ClientChunkEvents.CHUNK_LOAD / 方块更新包
    }
    @Override public void renderWorld(WorldRenderContext ctx) {
        if (!isEnabled()) return;
        String mode = get("mode");
        if ("材质透视".equals(mode)) {
            // 走资源包方案：由 ResourcePackModule 注册透明模型，这里只负责开关状态
            return;
        }
        // 框选：遍历 cache 画 RenderLayer.getLines() 方框；through=true 时关深度测试
        // labels=true 时用 HudRenderCallback 投影矿石名
    }
}
```

### 3.2 ContainerESP（`containeresp`）

**JS 要点**：扫周围箱子 / 木桶 / 熔炉等方块实体，12 类容器各配 `f_*`（框色）/ `t_*`（线色），共 26 个设置项（680–705）；`range`（8–96）、`width`、`tracer`、`labels`。

**Fabric 对应**：`client.world.blockEntities` 按 `BlockEntity` 类型分组（Chest / Barrel / Furnace / EnderChest / Hopper / ShulkerBox / Dispenser / Dropper / BlastFurnace / Smoker / CopperChest 等），`AFTER_ENTITIES` 画框 + 追踪线。

```java
@Override public void renderWorld(WorldRenderContext ctx) {
    if (!isEnabled()) return;
    MinecraftClient client = MinecraftClient.getInstance();
    double range = get("range");
    MatrixStack ms = ctx.matrixStack();
    for (BlockEntity be : client.world.blockEntities) {
        BlockPos pos = be.getPos();
        if (pos.getSquaredDistance(client.player.getPos()) > range * range) continue;
        String kind = ContainerKind.of(be);          // chest / barrel / furnace / ender / ...
        int boxColor = colorOf("f_" + kind, DEFAULT_BOX.get(kind));
        int lineColor = colorOf("t_" + kind, DEFAULT_LINE.get(kind));
        LineRenderer.box(ms, ctx.consumers(), pos, boxColor, (float) get("width") / 2);
        if (Boolean.TRUE.equals(get("tracer"))) {
            LineRenderer.line(ms, ctx.consumers(), ctx.camera().getPos(),
                    Vec3d.ofCenter(pos), lineColor);
        }
    }
}
```

`LineRenderer` 是 06 卷统一封装的 `RenderLayer.getLines()` 工具，别在 100 个模块里各写一份。26 个颜色设置项用 07 卷 `SettingSpec.color` 批量注册，代码里按 `"f_" + kind` 拼 key 读，别写 26 个 if。

### 3.3 Waypoints（`waypoints`）

**JS 要点**：`add`（586）/ `clear`（587）按钮，`beacon`（世界光柱）、`edge`（屏外箭头）、`distance`（32–512，默认 256）；数据存 `cfg.waypoints`，小地图同步标点，罗盘 `compassMarks` 也会读。

**Fabric 对应**：`ModConfig.waypoints`（07 卷 `List<Waypoint>`）、`AFTER_ENTITIES` 光柱、`HudRenderCallback` 名字距离 / 屏外箭头、`ClientPlayConnectionEvents.JOIN` 后重新加载。按维度过滤（`Waypoint` 要加 `dimension` 字段，源码没有但 Java 版必须，否则下界光柱会画在主世界）。

```java
public final class WaypointsModule extends Module {
    public WaypointsModule() {
        super("waypoints", "Waypoints", "路径点", ModuleCategory.RENDER,
              "世界光柱 + 名字距离 + 屏外箭头", "轨迹与引导", false);
        spec(SettingSpec.button("add", "标记当前坐标", () -> addHere()));
        spec(SettingSpec.button("clear", "清空路径点", () -> clearAll()));
        spec(SettingSpec.checkbox("beacon", "世界光柱", true));
        spec(SettingSpec.checkbox("edge", "屏外箭头", true));
        spec(SettingSpec.slider("distance", "显示距离", 32, 512, 16, 256));
    }
    private void addHere() {
        MinecraftClient c = MinecraftClient.getInstance();
        if (c.player == null) return;
        BlockPos p = c.player.getBlockPos();
        ModConfig.get().waypoints.add(new ModConfig.Waypoint(
                "路径点 " + (ModConfig.get().waypoints.size() + 1),
                p.getX(), p.getY(), p.getZ()));
        // 补维度：c.world.getRegistryKey().getValue().toString()
        ModConfig.save();
    }
    private void clearAll() { ModConfig.get().waypoints.clear(); ModConfig.save(); }
    @Override public void renderWorld(WorldRenderContext ctx) {
        if (!isEnabled() || !Boolean.TRUE.equals(get("beacon"))) return;
        for (ModConfig.Waypoint w : ModConfig.get().waypoints) {
            LineRenderer.beacon(ctx.matrixStack(), ctx.consumers(), w, 0x4FE8E0);
        }
    }
}
```

`button` 设置项在 07 卷 §6.4 里注明过：Cloth Config 没有原生 button entry，正式实现用自定义 `ActionButtonEntry`，别在构建屏幕时就执行 `addHere()`。

### 3.4 Performance（`perf`）

**JS 要点**（1943–1952）：`perfLevel()` 在 `'自动'` 时按 `state.game.fps` 降级（<25 省电 / <45 均衡 / 其余绚丽）；`perfGlow()` 只在「绚丽且 `noGlow` 为 false」时允许辉光，注释 531–532 说 `shadowBlur` 是 canvas 最贵的操作；`maxEnts`（20–200，默认 80）、`fxQuality`（0.3–1）、`noGlow`。

**Fabric 对应**：`ClientTickEvents.END_CLIENT_TICK` 里读 `MinecraftClient#getCurrentFps()`（或按帧间隔自算）写到一个全局 `PerfState`，所有特效（02 卷粒子 / 辉光、08 卷模糊、06 卷实体上限）只读它。

```java
public final class PerfModule extends Module {
    public PerfModule() {
        super("perf", "Performance", "性能优化", ModuleCategory.CONFIGS,
              "按帧率自动降级高开销效果", null, false);
        spec(SettingSpec.select("level", "性能档位",
                () -> List.of("自动", "省电", "均衡", "绚丽"), "自动"));
        spec(SettingSpec.slider("maxEnts", "实体上限", 20, 200, 10, 80));
        spec(SettingSpec.slider("fxQuality", "特效精度", 0.3, 1, 0.1, 1));
        spec(SettingSpec.checkbox("noGlow", "关闭辉光", false));
    }
    @Override public void tick(MinecraftClient client) {
        String level = get("level");
        int fps = client.getCurrentFps();
        String effective = "自动".equals(level)
                ? (fps < 25 ? "省电" : fps < 45 ? "均衡" : "绚丽") : level;
        PerfState.set(effective,
                ((Number) get("maxEnts")).intValue(),
                ((Number) get("fxQuality")).doubleValue(),
                Boolean.TRUE.equals(get("noGlow")));
    }
}
/** 全局只读快照，对应脚本 perfLevel() 被各处调用。 */
public final class PerfState {
    public static String level = "绚丽";
    public static int maxEnts = 80;
    public static double fxQuality = 1.0;
    public static boolean noGlow = false;
    public static boolean glowAllowed() { return "绚丽".equals(level) && !noGlow; }
    static void set(String l, int m, double q, boolean n) {
        level = l; maxEnts = m; fxQuality = q; noGlow = n;
    }
}
```

`PerfState` 是少数几个可以做成静态可变的东西——它就是一帧一份的只读快照，对应源码每帧 `perfLevel()` 被调用多次的语义。

---

## 4. 渲染类（任务口径，5 个）

FullBright / NightVision / Ambience / MotionBlur / Crosshair。这些是「改渲染结果」，大部分纯客户端、服务端无感，属于最安全的一类。

### 4.1 FullBright（`fullbright`）

**JS 要点**（944–954）：`hookNightVision` 替换全局 `W.nightVisionScale(p)`，`(modOn('fullbright') || modOn('nightvision'))` 时返回 `Math.max(v, 1)`，走游戏原生的 env.nightVision 路径。

**Fabric 对应**：两条路。① `LightmapTextureManagerMixin#update(F)V` 尾部把亮度纹理填满最大；② 更省事：把 `options.getGamma()` 拉到最大并给玩家加夜视效果。① 更接近源码「强制最亮」的效果。

```java
@Mixin(LightmapTextureManager.class)
public abstract class LightmapTextureManagerMixin {
    @Inject(method = "update(F)V", at = @At("TAIL"))
    private void comet$fullbright(float tickDelta, CallbackInfo ci) {
        if (!ModConfig.isOn("fullbright") && !ModConfig.isOn("nightvision")) return;
        // 把亮度纹理的 sky/dark 两列都填成全亮，等价于 nightVisionScale 返回 1
        NativeImage img = ((LightmapTextureManager) (Object) this).textureImage;
        for (int y = 0; y < img.getHeight(); y++) {
            for (int x = 0; x < img.getWidth(); x++) {
                img.setColor(x, y, 0xFFFFFFFF);
            }
        }
        ((LightmapTextureManager) (Object) this).texture.upload();
    }
}
```

`textureImage` / `texture` 是私有字段，需用 `@Accessor` 或 `@Shadow`，具体名按 mappings 调。Sodium 会重写光照管线，如果装了 Sodium 这条 Mixin 可能失效——08 卷 §4.1 给了规避思路（优先用事件，改亮度尽量放 TAIL）。

### 4.2 NightVision（`nightvision`）

**JS 要点**：与 `fullbright` 共用 `hookNightVision`（951 行是 `modOn('fullbright') || modOn('nightvision')`），源码里两者效果几乎一样。

**Fabric 对应**：给客户端玩家加一个无限时长的夜视 `StatusEffectInstance`，或直接在 `GameRendererMixin#getNightVisionStrength` 上 `@ModifyReturnValue` 返回 1.0。后者不动游戏状态、没有药水图标副作用，更干净：

```java
@Mixin(GameRenderer.class)
public abstract class GameRendererMixin {
    @ModifyReturnValue(method = "getNightVisionStrength(Lnet/minecraft/entity/LivingEntity;F)F",
            at = @At("RETURN"))
    private float comet$nightVision(float original) {
        return ModConfig.isOn("nightvision") ? 1.0f : original;
    }
}
```

### 4.3 Ambience（`ambience`）

**JS 要点**（1738–1747）：`freeze !== false` 时把 `g.worldTime` 写成 `getS('ambience','time')`（0–24000，默认 6000）；`weather` 为 `'下雨'` / `'Rain'` 时 `g.weather = 1`，否则 0。

**Fabric 对应**：`ClientWorldMixin#getTimeOfDay()` / `getRainGradient(F)` 用 `@ModifyReturnValue`。**只改渲染用的时间 / 天气**，不动服务端 tick——源码在单机直接改 `g.worldTime` 是真的改了世界时间，Java 版不要这么做，否则会影响生物作息 / 作物生长等服务端逻辑。

```java
@Mixin(ClientWorld.class)
public abstract class ClientWorldMixin {
    @ModifyReturnValue(method = "getTimeOfDay()J", at = @At("RETURN"))
    private long comet$freezeTime(long original) {
        if (!ModConfig.isOn("ambience")) return original;
        if (!Boolean.TRUE.equals(ModConfig.get("ambience", "freeze"))) return original;
        return ((Number) ModConfig.get("ambience", "time")).longValue();
    }
    @ModifyReturnValue(method = "getRainGradient(F)F", at = @At("RETURN"))
    private float comet$weather(float original) {
        if (!ModConfig.isOn("ambience")) return original;
        String w = ModConfig.get("ambience", "weather");
        return "下雨".equals(w) ? 1.0f : 0.0f;
    }
}
```

### 4.4 MotionBlur（`mblur`）

**JS 要点**（3659–3690）：一个全屏 `div` 用 CSS `backdrop-filter: blur(var(--cm-mblur))`，`z-index` 低于 HUD 与 ESP，只糊游戏画面。强度按 yaw/pitch 的**变化率**算：`d = hypot(Δyaw, Δpitch)`，`target = min(strength, d * strength * 22)`，`mbSmooth` 用「上升快（0.55）/ 下降按 decay（默认 0.1）」的不对称平滑，停下自动淡出。

**Fabric 对应**：`WorldRenderEvents.END_MAIN` + 04 卷 `BlurPipeline`（离屏 Framebuffer + 两趟高斯）。模糊半径 uniform 由 `mbSmooth` 驱动；因为我们在 `END_MAIN` 画、HUD 在 `HudRenderCallback` 之后画，HUD / ESP 天然保持清晰，不需要 z-index。

```java
public final class MotionBlurModule extends Module {
    private double lastYaw, lastPitch, smooth;
    private boolean hasLast;
    public MotionBlurModule() {
        super("mblur", "MotionBlur", "视角运动模糊", ModuleCategory.RENDER,
              "转动视角时画面动态模糊，停下自动淡出", "视觉特效", false);
        spec(SettingSpec.slider("strength", "模糊强度", 0, 8, 0.5, 5));
        spec(SettingSpec.slider("decay", "余韵", 0.05, 0.4, 0.05, 0.1));
    }
    @Override public void renderWorld(WorldRenderContext ctx) {
        if (!isEnabled()) { smooth = 0; hasLast = false; return; }
        double yaw = ctx.camera().getYaw(), pitch = ctx.camera().getPitch();
        double d = 0;
        if (hasLast) {
            double dy = yaw - lastYaw;
            while (dy > 180) dy -= 360;
            while (dy < -180) dy += 360;
            d = Math.hypot(dy, pitch - lastPitch);      // 对应源码 hypot(dy, Δpitch)
        }
        lastYaw = yaw; lastPitch = pitch; hasLast = true;
        double strength = get("strength");
        double decay = get("decay");
        double target = Math.min(strength, d * strength * 22);
        smooth += (target - smooth) * (target > smooth ? 0.55 : decay);  // 不对称平滑
        if (smooth < 0.05) return;
        BlurPipeline.INSTANCE.blurCurrentFrame((float) smooth);           // 04 卷管线
    }
}
```

注意 1.21 的 `Camera#getYaw()` 是**度数**，源码 `p.yaw` 是弧度（脚本里 `while (dy > Math.PI)`），所以边界判断从 `π` 换成 `180`，`d * strength * 22` 里的系数要按度数重新标定，别照抄 22。

### 4.5 Crosshair（`crosshair`，扩展 B 组）

**JS 要点**（5755 起）：`extOn('crosshair')` 时在 HUD 画布上按 `shape` 画五种准星之一，`size` / `gap` / `color` / `alpha` 等设置项；原版准星被盖掉。

**Fabric 对应**：`InGameHudMixin#renderCrosshair(DrawContext, float)` `@Inject(at = @At("HEAD"), cancellable = true)`，取消原版再自绘。

```java
@Mixin(InGameHud.class)
public abstract class InGameHudMixin {
    @Inject(method = "renderCrosshair(Lnet/minecraft/client/gui/DrawContext;F)V",
            at = @At("HEAD"), cancellable = true)
    private void comet$crosshair(DrawContext ctx, float tickDelta, CallbackInfo ci) {
        if (!ModConfig.isOn("crosshair")) return;
        ci.cancel();                                   // 盖掉原版十字
        Window w = MinecraftClient.getInstance().getWindow();
        int cx = w.getScaledWidth() / 2, cy = w.getScaledHeight() / 2;
        String shape = ModConfig.get("crosshair", "shape");
        int color = ColorHelper.fromHex(ModConfig.get("crosshair", "color"));
        // 五种形状：十字 / 圆点 / 方框 / 斜叉 / 空心圆，按 shape 分支用 ctx.fill 画
        CrosshairShapes.draw(ctx, cx, cy, shape, color);
    }
}
```

---

## 5. 其它类（任务口径，5 个）

ServerSwitch / MC18 / ConfigBackup / Floating GUI / ResourcePack。这一组里有几条是**网页环境专属**，08 卷 §3 已判定无法 1:1 移植，这里给结论和可行的替代。

### 5.1 ServerSwitch（`server`）

**JS 要点**（882–887）：`applyServer()` 从 `cfg.servers[cfg.serverIdx]` 取 URL 写进 `W.NET_CONFIG.rooms`；`afterSetting`（843–846）里改 `server.server` 下拉时更新 `cfg.serverIdx` 并重应用；`afterToggle` 也调一次。设置项的 `options` 是函数（728 行 `() => cfg.servers.map(s => s.name)`），默认值也是函数。

**Fabric 对应**：Java 版没有「房间服务器列表」这个概念，最接近的是切 `ServerInfo` 并重连。用 `ClientPlayConnectionEvents.DISCONNECT` + `ConnectScreen` 或 `client.connectToServer(...)`。配置里保留 `List<ServerEntry>`（07 卷），下拉选项做成 `Supplier<List<String>>`（07 卷 `SettingSpec.select` 已支持函数式 options）。

```java
// 对应 applyServer()：选中项变化时
public static void applyServer(int idx) {
    ModConfig cfg = ModConfig.get();
    cfg.serverIdx = idx;
    ModConfig.save();
    ModConfig.ServerEntry e = cfg.servers.get(idx);
    // 解析 e.url 为 Address + ServerInfo，走 client.connectToServer(...)
    // 注意：这是"断开重连"，不是网页版的"换 rooms 地址"，语义差异要在 UI 上写清楚
}
```

### 5.2 MC18（`mc18`）

**JS 要点**（736–741）：`addr` / `name` 两个 text 设置的 `value` 是函数（读 `cfg.mcAddr` / `cfg.mcName`），`toggle` 按钮直连 1.8 服务器，依赖外部脚本 `opus-mc18-link`。

**Fabric 对应**：Java 1.21.1 客户端不直连 1.8 协议服务器，协议不兼容。整条功能在 Java 版**没有等价物**；保留配置字段（`mcAddr` / `mcName`）和一个「用外部启动器 / ViaVersion 代理」的说明按钮即可，不做协议桥。08 卷 §3.7 已把它列为「不适用」。

### 5.3 ConfigBackup（`cfgreset`）

**JS 要点**（11145–11229、751–757）：`export` / `import` / `reset` 三个按钮；`.opuscfg` 格式是 `OPUSCFG1` 魔数 + base64(JSON)，`CFG_KEYS` 白名单挑字段，`applyImported` 覆盖后调 `applyTheme` / `layoutPanel` / `applyHudPos` / `refreshGui` / `refreshHud`；`reset` 清空 `binds` / `favorites` / `settings` 等（11132 附近）。

**Fabric 对应**：07 卷 `BackupCodec`（§4.2）已经把 `build` / `parse` / `apply` / `exportToFile` / `importFromFile` 全写完了。Java 侧只要把三个按钮接上：

```java
// 对应 cfgreset.export
BackupCodec.exportToFile(ModConfig.get(), "1.31.0-port",
        FabricLoader.getInstance().getGameDir().resolve("comet-backup.opuscfg"));
// 对应 cfgreset.import
BackupCodec.apply(ModConfig.get(),
        BackupCodec.importFromFile(userChosenPath));   // 内部会 replaceFrom + onConfigReplaced
// 对应 cfgreset.reset
ModConfig.get().states.clear();
ModConfig.get().settings.clear();
ModConfig.get().binds.clear();
ModConfig.get().favorites.clear();
ModConfig.save();
ModuleRegistry.onConfigReplaced();
KeyBindings.rebuildModuleKeys();                       // 键位清空后要重建，07 卷 §6.5
```

`replaceFrom` 会触发 `ModuleRegistry.onConfigReplaced()`，对应源码 `applyImported` 里那串刷新调用。

### 5.4 Floating GUI（`floatgui`）

**JS 要点**（771–777、10620–10670）：每个分类一个悬浮面板，可拖动、右键标题折叠成一条标签，位置存 `cfg.floatPos`；`syncGuiClasses`（10620）给根元素 toggle `any-open` / `float-open` / `classic-open` / `cm-gui-open`；`prepareOpen`（10628）会 `document.exitPointerLock()` 释放鼠标锁；`hotkey` 按钮走绑定态；两套 UI（悬浮 / 经典）各自独立开关。默认 `state: true`。

**Fabric 对应**：自定义 `Screen`（或 HUD 层可拖动矩形），`mouseDragged` 改 `ModConfig.floatPos`，`mouse.unlockCursor()` 对应 `exitPointerLock`。`syncGuiClasses` 那四个 class 状态在 Java 版就是一个枚举 `GuiMode { NONE, FLOATING, CLASSIC }`，渲染时按模式画。

```java
public final class FloatingGuiModule extends Module {
    public FloatingGuiModule() {
        super("floatgui", "Floating GUI", "悬浮标签", ModuleCategory.CONFIGS,
              "每个分类一个悬浮面板，可拖动 / 折叠", null, true);   // 对应 state: true
        spec(SettingSpec.button("hotkey", "呼出按键", () -> KeyBindings.startCapture("floatgui")));
        spec(SettingSpec.button("reset", "重置面板位置", () -> {
            ModConfig.get().floatPos.clear();
            ModConfig.save();
        }));
    }
    // 面板本体在 04 卷：CometFloatingScreen extends Screen，
    // 每个 ModuleCategory 一个可拖动 Panel，mouseDragged 写 ModConfig.floatPos。
}
```

### 5.5 ResourcePack（`resourcepack`）

**JS 要点**（709–723、7651–7656、8385–8470）：导入标准 MC `.zip`，`DecompressionStream('deflate-raw')` 解压，hook `getImageData` 改像素，抓 `texStorage3D(TEXTURE_2D_ARRAY)` 时的纹理对象，`rpReupload()` 逐 mip 级 `texSubImage3D` 重传，不刷新页面；GUI / 物品栏 / HUD 贴图直接替换游戏 `images`；`enabled` / `open` / `import` / `reapply` / `clear` / `demo`（内置 41KB 暗色 GUI 包）/ `status` / `anims`（动画贴图取首帧）。

**Fabric 对应**：Java 版本来就支持标准资源包，整套 GL 注入丢弃（08 卷 §3.6）。按钮映射：

| JS 按钮 | Java 实现 |
|---|---|
| `import` | 复制 `.zip` 到 `run/resourcepacks/`，`client.getResourcePackManager().scanPacks()` |
| `open` | 打开原版 `PackScreen`（对应源码「用游戏自己的菜单绘制」）|
| `reapply` | `client.reloadResources()` |
| `clear` | 从已启用列表移除，`client.reloadResources()` |
| `demo` | 把内置暗色 GUI 包（41KB / 56 张）作为 mod 自带 `ResourcePack` 注册 |
| `status` | 读已启用包数量写文本 |
| `anims` | 动画贴图由 MC 的 `AnimationResourceMetadata` 自己处理，取首帧的语义变成「禁用动画」开关 |

```java
public final class ResourcePackModule extends Module {
    public ResourcePackModule() {
        super("resourcepack", "ResourcePack", "MC 材质包", ModuleCategory.CONFIGS,
              "导入标准 MC 资源包 .zip", null, false);
        spec(SettingSpec.checkbox("enabled", "启用材质包", true));
        spec(SettingSpec.button("open", "打开原版资源包界面",
                () -> MinecraftClient.getInstance().setScreen(
                        new PackScreen(MinecraftClient.getInstance().getResourcePackManager()))));
        spec(SettingSpec.button("reapply", "重新应用",
                () -> MinecraftClient.getInstance().reloadResources()));
        spec(SettingSpec.text("status", "状态", "未导入", null));
        spec(SettingSpec.checkbox("anims", "包含动画贴图首帧", true));
    }
}
```

`PackScreen` 的构造签名按 mappings 调；`demo` 内置包用 `FabricResourcePack` / `ModResourcePack` 注册到 `ResourcePackManager`。

---

## 6. 作弊功能与服务端同步边界

这一节技术中立地记清楚「哪些能改、哪些改了也白改、哪些会被检测」，不评价该不该用。源码自己就在 `tickModules` 1659–1666 做了联机提示：

```js
const mp = isMP(g);
if (mp && !state.mpSeen) {
  state.mpSeen = true;
  pushNotification('联机模式', '战斗已改为发包；飞行/加速/瞬间破坏/刀刀暴击受服务器判定');
}
```

Java 版把这条复刻成一个 `ServerAuthGuard`，模块在改状态前先看一眼：

```java
public final class ServerAuthGuard {
    private static boolean mpSeen = false;
    public static boolean isMultiplayer(MinecraftClient c) {
        return c.getNetworkHandler() != null && !c.isInSingleplayer();
    }
    /** 对应源码 1661 的联机提示，只在状态翻转时发一次。 */
    public static void noticeIfNeeded(MinecraftClient c) {
        boolean mp = isMultiplayer(c);
        if (mp && !mpSeen) {
            mpSeen = true;
            Notifications.push("联机模式",
                    "飞行 / 加速 / 瞬间破坏 / 暴击等由服务器判定，客户端改动可能无效");
        } else if (!mp && mpSeen) {
            mpSeen = false;
        }
    }
}
```

### 6.0 为什么「改了也白改」：六类对照

上一节的 `ServerAuthGuard` 只解决了「什么时候提醒」，还得先讲清**哪类改动根本不生效**。
网页版 `attackEntity()`（1124–1138）的注释把本质说透了：

> 单机直接算伤害；联机必须发包（本地调用 `g.attack` 只会打到本地副本）

Fabric 客户端 mod 没有「单机直接写内存」这个奢侈：哪怕单人游戏，逻辑服务端
（integrated server）也是独立线程，`ClientPlayerEntity` 只是 `ServerPlayerEntity`
的一个镜像。逐类对照：

| 类别 | 网页版单机 | Java 客户端 mod | 结论 |
|---|---|---|---|
| 纯视觉（XRay、Fullbright、NightVision、ESP、光环） | 改渲染 | 改渲染，只影响本地 | **安全**，1:1 移植 |
| 输入辅助（自动疾跑、自动跳、自动工具切槽、AutoArmor） | 改 `p.sprinting` / `p.inv.sel` | 改客户端输入/槽位，服务器照常收包 | **基本安全**，只是「帮玩家按得快」 |
| 视角旋转（Aura `rotate`、BowAim 锁视角） | 直接写 `p.yaw` | `player.setYaw()` 会随移动包发给服务器 | 可用，但**转视角包异常易被反作弊抓** |
| 移动类（Speed、Fly、Step、NoFall） | 直接写 `p.vel` / `p.flying` / `p.slowFall` | 客户端改了 velocity，服务端用自己算的位置覆盖 | **服务器上无效 / 会被拉回**，仅单人创造或本地可用 |
| 伤害类（Killaura、MultiAura、TriggerBot、Criticals） | `g.attack(e)` 直接扣血 | 只能走 `ClientPlayerInteractionManager` 发攻击包，伤害由服务端算 | **攻击动作可发，暴击 / 一刀多目标服务端不认** |
| 世界修改（Scaffold、InstantBreak、Ambience） | `world.setBlock` / `g.breakBlock` / 改 `worldTime` | 必须走标准交互发包，服务端权威决定是否生效 | **放置 / 挖掘发包可做，瞬间破坏和锁时间被驳回** |

> 本表只做技术边界描述。Aura 的自动索敌与发包打人按用户要求**不实现**，
> 见卷首与 §7；表里出现 `Killaura` 等名字仅用于说明「这类改动为什么无效」。

三个照抄就会翻车的地方，和 07 卷的命名口径一起记：

1. **弧度 vs 度数**：源码 `p.yaw` 是弧度（`while (dy > Math.PI)`），Java `Entity#setYaw()` 是**度**且零点差 180°；§4.4 的 `d * strength * 22` 系数必须按度数重新标定。
2. **客户端字段只是镜像**：直接写 `p.flying` / `p.vel` / `p.air` 在联机不生效，别把它当服务端状态用。
3. **别自己造发包路径**：`world.setBlock` / 手写 `net.send` 要换成 `ClientPlayerInteractionManager` 的标准交互；否则服务端不认，还容易被判异常包。

`6.1` 的分类表按「模块 → 服务端是否感知」组织，本表按「改动类型 → 为什么无效」组织，
两表互补：先看这张定性，再看 6.1 查具体模块归到哪一类。

### 6.1 分类表

| 类别 | 模块 | 服务端是否感知 | 说明 |
|---|---|---|---|
| 纯客户端视觉，服务端无感 | `fullbright` / `nightvision` / `ambience`（只改渲染值）/ `mblur` / `crosshair` / `esp` / `tracers` / `xray` / `containeresp` / `waypoints` / `minimap` / 所有 HUD | 否 | 只改本地渲染与 HUD，不发影响游戏状态的包；这类移植最安全 |
| 客户端本地状态，服务端权威 | `autosprint` / `autojump` / `step` / `freecam` / `waterbreath` / `autorespawn` / `autoeat` | 部分 | 输入 / 能力 / 氧气由服务端校验；单机完全生效，联机可能被回弹或覆盖 |
| 明显改变游戏状态，通常被服务端拒绝 | `fly`（生存飞行）/ `speed` / `nofall` / `fastbreak` / `instantbreak` / `scaffold` / `crit` / `antikb` / `bowaim` / `triggerbot` | 是 | 涉及移动、挖掘进度、伤害、方块放置，服务端有自己的判定 |
| 网页环境专属，Java 版不适用 | `gate` / `mc18` / `server`（房间切换）/ `music`（第三方音源）| — | 见 08 卷 §3，不是「作弊」而是没有对应物 |

### 6.2 反作弊检测点（技术描述）

服务端 / 反作弊插件一般从这些信号判断客户端异常，实现时知道边界在哪，别写出刷屏发包的代码：

| 改动 | 可观察信号 | 后果 |
|---|---|---|
| `speed` / `fly` | 移动包里的位移与预期速度不符；Y 方向异常位移；`onGround` 状态与位置矛盾 | 位置回弹（`ClientboundPlayerPositionPacket`）、移动校验标记、踢出 |
| `step` | 单帧 Y 位移跨过一格高且无跳跃包 | 同上 |
| `fastbreak` / `instantbreak` | 挖掘进度增长快于 `calcBlockBreakingDelta` 允许值；START/STOP 间隔过短 | 服务端忽略破坏、方块回滚、破坏进度校验标记 |
| `scaffold` | 在视线外 / 距离过远处发包放置；放置速率异常 | 放置被拒、物品不同步 |
| `nofall` | 客户端血量显示与服务端伤害事件不一致 | 客户端血条「假不掉血」，重连后同步回真实值 |
| `crit` | 暴击由服务端按 `fallDistance` / 冷却算，客户端伪造字段不影响服务端 | 联机无效（源码 361 行 desc 已写明）|
| `autoeat` / `waterbreath` | 饥饿 / 氧气由服务端 tick 结算 | 客户端本地值被下次同步覆盖 |

### 6.3 客户端侧限制的落地写法

别在模块里偷偷发包刷屏。三种稳妥做法：

1. **单机才启用强改动**：`ServerAuthGuard.isMultiplayer(client)` 为真时，直接让 `fly` / `speed` / `instantbreak` 这类模块跳过或只给视觉提示。
2. **失败不重试**：`interactBlock` / `sendPacket` 被服务端拒绝后不要循环补发（源码 `scaffold` 有 60ms 节流就是防这个）。
3. **状态可回滚**：所有「保存旧值 / 关闭还原」的模式（autojump / nofall / speed）在 `onDisable()` 里还原，别把 `allowFlying` / `stepHeight` 永久留在改过的状态。

```java
@Override public void onDisable() {
    // 对应源码 1561–1564 / 1580–1583 / 1684–1687 的还原分支
    ClientPlayerEntity p = MinecraftClient.getInstance().player;
    if (p != null && !p.isCreative() && !p.isSpectator()) {
        p.getAbilities().allowFlying = false;
        p.getAbilities().flying = false;
    }
}
```

`onEnable/onDisable` 由 07 卷 `ModuleRegistry.onModuleToggled` 统一分发，各模块只写自己的还原逻辑。

---

## 7. 交付边界与下一卷接口

本卷 25 个模块的实现都依赖 07 卷的三件套（`ModConfig` / `Module` / `ModuleRegistry`）和一个统一入口 `CometTick`：

```java
public final class CometTick {
    public static void onEndTick(MinecraftClient client) {
        if (client.world == null || client.player == null) return;
        ModConfig.beginFrame();                       // 对应 onFrame 开头 __sCache = {}
        try {
            ServerAuthGuard.noticeIfNeeded(client);  // 对应 1659 联机提示
            for (Module m : ModuleRegistry.all()) {  // 对应 tickModules 里一串 if (modOn) ...
                if (m.isEnabled()) m.tick(client);
            }
        } finally {
            ModConfig.endFrame();                    // 对应 onFrame finally __sCache = null
        }
    }
}
```

`m.tick(client)` 替代了源码 `tickModules` 里那一长串 `if (modOn('xxx')) tickXxx(...)`；100 个模块各管自己，注册顺序决定执行顺序。`renderWorld` / `renderHud` 由 `CometWorldRender` / `CometHud` 按 `AFTER_ENTITIES` / `HudRenderCallback` 阶段分发，同样遍历 `ModuleRegistry.all()`。

Aura 的攻击逻辑（`tickAura` / `tickMultiAura` / `tickTrigger` / `tickBowAim` 的自动索敌与发包）按用户要求**不实现**；`aura` 模块在 Java 侧只保留 `ring` 系列特效和「当前目标」的计算结果（给 `targetesp` / `targetring` / TargetHUD 用），见 02 / 05 卷。

四卷写完后的对账：README §2 的 100 个模块 → 07 卷 `ModuleRegistry.bootstrap()` 全部注册 → 08 卷 §1 对照表逐条定优先级与验收 → 09 卷（本卷）展开其中 25 个玩法模块的 Java 实现。剩下 75 个模块的实现分在 02（光环特效）、03（开场动画）、04（毛玻璃 UI）、05（TargetHUD / 名牌）、06（HUD / ESP / 小地图）、07（配置类）各卷。
