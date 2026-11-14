# 08 · 逐功能移植对照表

**对应源码**：整份 `opusmc-hud.user.js`。`MODULES`（295–779）+ 五组 `EXT_MODULES`（4653 / 5384 / 6128 / 6644 / 7171）+ `about`（7423）共 100 个模块；特效分散在 `tickAura`（1140）、`tickMovement`（1555）、`tickModules`（1647）、`espFrame`、`extRender*`（7021 起）、`applyAppearance`（1893）、`updateMotionBlur`（3664）、`onFrame`（3101）、材质包 hook（8385–8470）、开场动画（11850 附近）、渲染循环 hook（958–987）等处。

**要实现的效果**：把「哪些东西要搬、搬到哪去、有多难、什么时候做、怎样算做完」变成一张可以逐行勾的总账。用户强调「一定要全部的」，所以本卷按 100 个模块 + 独立特效两遍列全，不合并、不省略。

**Java 侧对应概念**：Fabric 事件（`HudRenderCallback` / `WorldRenderEvents.AFTER_ENTITIES` / `END_MAIN` / `ClientTickEvents.END_CLIENT_TICK` / `ClientPlayConnectionEvents.JOIN` / `AttackEntityCallback`）、Mixin 目标类与方法签名、Config（07 卷）、后处理管线（04 卷）、3D 线框封装（06 卷）。

约定：模块 id 与分类按 README §2 的表，不重复解释；优先级 P0/P1/P2 沿用 README §5（P0 视觉与地基 → P1 HUD → P2 玩法）。难度口径：**低** = 一个事件回调或改一个选项值就能复现；**中** = 需要 Mixin 或自建渲染管线；**高** = 要重写算法 / 没有等价物 / 涉及服务端权威。

> Mixin 目标类与方法签名按 Yarn 1.21.1 写。MC 版本一换方法名会变，编译时以实际 mappings 为准调整 `@Inject(method = "...")`；类名 + 方法语义是稳定的，别照抄描述名去猜 descriptor。

---

## 1. 逐模块对照表（100 个）

### 1.1 combat（10）

| 模块 id / JS 函数 | Fabric 事件 / Mixin 目标 | 实现要点 | 难度 | 优先级 |
|---|---|---|---|---|
| `aura` / `tickAura` 1140 | `AttackEntityCallback.EVENT` + `ClientTickEvents.END_CLIENT_TICK`；**视觉部分**走 `AFTER_ENTITIES` | 攻击判定用户明确排除，只搬 `ring` 系列特效（见 §2.1）；`auraTarget` 仍要算出来给 `targetesp` / `targetring` / TargetHUD 用 | 高（特效）/ 低（目标选取）| P0（视觉）|
| `multiaura` / `tickMultiAura` 1215 | `AttackEntityCallback.EVENT` | 同上，多目标只用于高亮，不实现多目标攻击发包 | 中 | P2 |
| `triggerbot` / `tickTrigger` 1157 | `AttackEntityCallback.EVENT` + `MinecraftClient#crosshairTarget` Mixin | 准星目标 = `MinecraftClient.crosshairTarget` 的 `EntityHitResult`；距离 / 攻击冷却判断 | 中 | P2 |
| `bowaim` / `tickBowAim` 1238 | `ClientTickEvents.END_CLIENT_TICK` + `GameRendererMixin#getFov` | 抛物线 `solveBallistic` 用 `ProjectileEntity` 的重力 / 初速换算；平滑转视角改 `ClientPlayerEntity#setYaw/setPitch`；自动拉弓用 `KeyBinding#setPressed` 模拟使用键 | 高 | P2 |
| `crit` / `ensureCritHook` 1601 | `AttackEntityCallback.EVENT` | 源码伪造 `p.onGround=false / attackT=1e3` 骗暴击；Java 版暴击由服务端算，客户端改 `PlayerEntity#getAttackCooldownProgress` 只影响本地动画；标注「联机无效」 | 中 | P2 |
| `hitmarker` / EXT B | `AttackEntityCallback.EVENT` + `HudRenderCallback` | 命中事件记时间戳，HUD 层画准星闪光 + 播 `SoundEvents` | 低 | P1 |
| `antikb` / EXT B | `ClientPlayerEntityMixin#tickMovement` `@ModifyVariable` 或 `LivingEntityMixin#takeKnockback` | 受击速度增量清零；服务端会重新下发速度，标注客户端侧限制 | 中 | P2 |
| `lowhp` / `extLowHpOverlay` 6315 | `HudRenderCallback` + `ClientPlayerEntity#getHealth` | 径向红色渐变 overlay，900ms 衰减 + 正弦闪烁；`DrawContext.fill` 分层画 | 低 | P1 |
| `armorwarn` / EXT C | `ClientTickEvents.END_CLIENT_TICK` + `ItemStack#getDamage` | 遍历盔甲栏耐久低于阈值发通知 | 低 | P1 |
| `damageindicator` / EXT D | `LivingEntityMixin#damage` `@Inject(at = @At("RETURN"))` + `HudRenderCallback` | 由伤害来源 `DamageSource#getSource` 算方位角，屏边画指示弧 | 中 | P1 |

### 1.2 movement（7）

| 模块 id / JS 函数 | Fabric 事件 / Mixin 目标 | 实现要点 | 难度 | 优先级 |
|---|---|---|---|---|
| `autosprint` / `tickModules` 1668 | `ClientTickEvents.END_CLIENT_TICK` + `ClientPlayerEntity#setSprinting` | `onlyforward` 时读 `Input#movementForward > 0`；潜行 / 使用物品时不触发（源码判 `p.sneaking / p.usingItem`）| 低 | P2 |
| `fly` / `installFlyKeys` 1490 + `ensureFlyHook` 1521 | `ClientPlayerEntityMixin#tickMovement` + `Input` 字段 + `KeyBindingHelper` | 源码 hook `creative` getter 只在 tick 期间返回 true；Java 版直接 `player.getAbilities().allowFlying = true`（创造/观察者模式），生存模式需 `ClientPlayerEntityMixin` 或发包，标注服务端会拒绝 | 高 | P2 |
| `autojump` / 1679 | `MinecraftClient#options.getAutoJump()` | 直接 `options.getAutoJump().setValue(true)`，关闭时还原旧值（源码存 `__cometAutoJump.v`）| 低 | P2 |
| `speed` / 1585 | `ClientPlayerEntityMixin#tickMovement` `@ModifyVariable` 或 `getMovementSpeed` `@ModifyReturnValue` | 源码给 `p.speedBonus` 加 `0.1*(mult-1)`；Java 版改移动速度乘数，联机由服务端权威覆盖 | 中 | P2 |
| `step` / 1566 | `EntityMixin#getStepHeight` `@ModifyReturnValue` | 源码 `p.stepHeight = 1`；Java 版返回 1.0f，关闭还原 0.6f | 低 | P2 |
| `scaffold` / `tickScaffold` 1331 | `ClientTickEvents.END_CLIENT_TICK` + `ClientPlayerInteractionManager#interactBlock` / `WorldRenderEvents` 预览 | 从 `player.getInventory().getMainHandStack()` 取方块，算脚下前方空位，走 `interactBlock` 发包（源码联机发 `t:'place'`）；60ms 节流要保留 | 高 | P2 |
| `nofall` / 1576 | `ClientPlayNetworkHandler` 发包 / `LivingEntityMixin#handleFallDamage` `@Inject(cancellable = true)` | 源码清 `fallDist` + 置 `slowFall`；Java 版最稳是取消 `handleFallDamage`，联机仍可能因服务端位置校验受伤害 | 中 | P2 |

### 1.3 render（32）

| 模块 id / JS 函数 | Fabric 事件 / Mixin 目标 | 实现要点 | 难度 | 优先级 |
|---|---|---|---|---|
| `esp` / 422 | `WorldRenderEvents.AFTER_ENTITIES` + `RenderLayer.getLines()` | 遍历 `client.world.getEntities()`，按距离过滤，画 AABB 线框；三类颜色分别取 `mobColor/itemColor/playerColor` | 中 | P1 |
| `tracers` / 431 | `AFTER_ENTITIES` + `RenderLayer.getLines()` | 从 `camera.getPos()` 到实体中心画线；颜色同上 | 中 | P1 |
| `projectile` / 439 | `AFTER_ENTITIES` + `ClientTickEvents` 预测 | 按 `ProjectileEntity` 重力 / 初速积分出轨迹点；`held/flight/land/leadMark` 四个开关分段画 | 高 | P1 |
| `nametags` / 454 | `EntityRendererMixin#renderLabelIfPresent` 或 `HudRenderCallback` 投影 | 名字 / 血条 / 手持 / 装备 / 别名 / 排版 8 个设置项，见 05 卷 | 中 | P1 |
| `itemesp` / 471 | `AFTER_ENTITIES` + `RenderLayer.getLines()` | 只画 `ItemEntity` / 投射物的框或标记 | 低 | P1 |
| `targetesp` / 474 | `AFTER_ENTITIES` | 用 `auraTarget`（或当前准星实体）画高亮框 | 低 | P1 |
| `fullbright` / 477 + `hookNightVision` 945 | `LightmapTextureManagerMixin#update(F)V` `@Inject` | 把亮度纹理填满最大值；源码是 hook `nightVisionScale` 返回 `max(v,1)` | 中 | P2 |
| `nightvision` / 480 | `GameRendererMixin#getNightVisionStrength` `@ModifyReturnValue` 或给玩家加 `StatusEffects.NIGHT_VISION` | 客户端加无限时长夜视效果最直接；与 `fullbright` 二者取一 | 低 | P2 |
| `ambience` / 483 + 1738 | `ClientWorldMixin#getTimeOfDay` / `getRainGradient` `@ModifyReturnValue` | 源码直接写 `g.worldTime / g.weather`；Java 版改客户端世界时间 / 降雨渐变的**渲染值**，不动服务端时间 | 中 | P2 |
| `hud` / 491 | `HudRenderCallback.EVENT` | 9 个子开关（水印 / 坐标 / TargetHud / ArrayList / 通知 / 雷达 / 罗盘 / 头像样式 / 罗盘路径点），见 06 卷 | 中 | P1 |
| `xray` / 536 + `applyXrayWorld` 1869 | `WorldRendererMixin#render` 或 `BlockRenderLayer` 过滤 + `AFTER_ENTITIES` 框选 | 「材质透视」隐藏 `#gl` 只留矿石**在 Java 版没有等价物**（见 §3.6）；改为资源包替换方块模型 / 框选高亮矿石 | 高 | P2 |
| `blockesp` / 548 | `ClientTickEvents` 扫区块 + `AFTER_ENTITIES` | 按 `target` 名字在半径内扫 `BlockState`（用 `Block` 注册表反查），缓存结果，画框 + 准星框 + 屏外箭头 | 中 | P1 |
| `trail` / 563 | `ClientTickEvents` 采样 + `AFTER_ENTITIES` | 每帧记录玩家坐标进环形缓冲，按 `length` 画渐隐折线 + 脚下光点 | 中 | P1 |
| `targetring` / 573 | `AFTER_ENTITIES` | 目标脚下旋转光圈 + 上升光柱，见 02 卷 | 中 | P0 |
| `waypoints` / 583 | `AFTER_ENTITIES` + `HudRenderCallback` + `ClientPlayConnectionEvents.JOIN` | 光柱 / 名字距离 / 屏外箭头 / 小地图标点；`add` / `clear` 按钮；数据存 `ModConfig.waypoints` | 中 | P1 |
| `minimap` / 594 | `HudRenderCallback` + 离屏 `Framebuffer` | 圆形裁剪 + 地形着色（读 `ClientWorld#getBlockState` 高度图）/ 实体点 / 路径点；大地图 `M` 键开 `Screen` | 高 | P1 |
| `invhud` / 608 | `HudRenderCallback` | 悬浮物品栏，用 `ItemRenderer` 画 `ItemStack` + 中文名 / 数量 / 选中格 | 中 | P1 |
| `drops` / 619 | `ClientTickEvents` 统计 + `AFTER_ENTITIES` / `HudRenderCallback` | 汇总面板 + 世界内名字距离 / 3D 框；`xp` 含经验球；`hideTags` 只留面板 | 中 | P1 |
| `mblur` / 657 + `updateMotionBlur` 3664 | `WorldRenderEvents.END_MAIN` + 后处理管线 | 源码是 CSS `backdrop-filter` 全屏层；Java 版离屏 `Framebuffer` + 两趟高斯，强度随 yaw/pitch 变化率（见 §3.1 / §4.3）| 高 | P0 |
| `containeresp` / 673 | `ClientTickEvents` 扫 `BlockEntity` + `AFTER_ENTITIES` | 13 类容器各配框色 / 线色（共 30 个设置项，26 个是颜色项），扫描 `client.world.blockEntities` 按类型分组 | 中 | P1 |
| `chunkborder` / EXT B | `AFTER_ENTITIES` + `RenderLayer.getLines()` | 按玩家所在 chunk 算 16×16 边界，画竖线 + 网格 | 低 | P1 |
| `lightoverlay` / EXT B | `ClientTickEvents` 扫地面 + `AFTER_ENTITIES` | `client.world.getLightLevel(pos)` 按等级叠色块（黄 / 红） | 中 | P1 |
| `armorhud` / EXT B | `HudRenderCallback` | 4 件盔甲图标 + 耐久条 | 低 | P1 |
| `potionhud` / EXT B | `HudRenderCallback` | `client.player.getStatusEffects()` 剩余时间 | 低 | P1 |
| `fpsgraph` / EXT B | `HudRenderCallback` | 环形缓冲存 FPS，`DrawContext` 画折线 | 低 | P1 |
| `damagenumbers` / EXT B | `LivingEntityMixin#damage` `@Inject` + 世界投影 | 命中处飘数字，投影到屏幕坐标 | 中 | P1 |
| `crosshair` / 5447 + 5755 | `InGameHudMixin#renderCrosshair(DrawContext, float)` `@Inject(cancellable = true)` | 五种形状（`shape` 设置项）在 HUD 层自绘 | 低 | P1 |
| `zoom` / 5460 + 5799 | `GameRendererMixin#getFov(Camera, float, boolean)` `@ModifyReturnValue` | 按住键时 FOV 除以倍率，平滑过渡 | 低 | P1 |
| `entitytrail` / EXT D 7024 | `ClientTickEvents` 采样 + `AFTER_ENTITIES` | 每个实体一条短拖尾，需按实体 id 分环形缓冲，注意实体卸载时清理 | 中 | P1 |
| `waypointline` / EXT E | `AFTER_ENTITIES` | 脚下到路径点的引导线 | 低 | P1 |
| `blockoutline` / EXT E | `AFTER_ENTITIES` | `client.crosshairTarget` 的 `BlockHitResult` 画方块描边 | 低 | P1 |
| `healthbar` / EXT E | `EntityRendererMixin#renderLabelIfPresent` 或 `HudRenderCallback` 投影 | 世界内血条，区别于 05 卷的 TargetHUD | 中 | P1 |
| `spin` / 665（源码 `misc`）`hookRender` 974 | `LivingEntityRendererMixin#getBodyYaw` / `EntityMixin#getBodyYaw` `@ModifyReturnValue` | 只加身体朝向偏移，**不改 `player.yaw`**（源码注释 971–973 明确说改 yaw 会让视角一起转）| 中 | P2 |

### 1.4 player（8）

| 模块 id / JS 函数 | Fabric 事件 / Mixin 目标 | 实现要点 | 难度 | 优先级 |
|---|---|---|---|---|
| `autorespawn` / 1729 | `ClientTickEvents.END_CLIENT_TICK` + `DeathScreen` 检测 / `ClientPlayNetworkHandler#sendPacket` | 死亡 1.5s 节流后发 `ClientStatusC2SPacket(PERFORM_RESPAWN)` | 低 | P2 |
| `fastbreak` / 1692 | `ClientPlayerInteractionManagerMixin#updateBlockBreakingProgress` `@ModifyVariable` 或 `getBlockBreakingProgress` | 源码 hook `g.breakSpeed` 乘倍率；Java 版加快破坏进度累加速率，联机服务端按自己的进度结算 | 中 | P2 |
| `instantbreak` / 1703 | `AttackBlockCallback.EVENT` + `ClientPlayerInteractionManager#breakBlock` | 开挖立刻完成；源码联机 `net.dig(0/2)` 让服务器结算 | 中 | P2 |
| `autoeat` / `tickAutoEat` 1625 | `ClientTickEvents.END_CLIENT_TICK` + `UseItemCallback` / `KeyBinding#setPressed` | 饥饿 < 阈值且手持食物时按住使用键（`p.food < threshold` → `HungerManager#getFoodLevel`）| 中 | P2 |
| `waterbreath` / 1689 | `ClientPlayerEntityMixin#tickMovement` `@Inject(at = @At("TAIL"))` | 水下把 `player.setAir(300)`（源码 `p.air = 300`）| 低 | P2 |
| `freecam` / `tickFreecam` 1453 + `ensureFreecamHooks` 1423 | `GameRendererMixin#renderWorld` / `CameraMixin#setPos/setRotation` + `ClientTickEvents` | 源码 hook `readInput`（冻结身体）和 `renderer.setCamera`（换相机位）；Java 版用 `CameraMixin` + 一个 `freecamState`，身体输入清零 | 高 | P2 |
| `autotool` / EXT A | `AttackBlockCallback.EVENT` | 开挖前按 `BlockState` 计算最快工具，`client.player.getInventory().selectedSlot = n`；`restore` 挖完切回 | 中 | P2 |
| `autoarmor` / EXT A | `ClientTickEvents.END_CLIENT_TICK`（`delay` 节流）| 扫描背包按 `ArmorItem` 防御值选最高，发 `ClickSlotC2SPacket` 或直接改客户端背包；联机需发包 | 中 | P2 |

### 1.5 misc（24）

| 模块 id / JS 函数 | Fabric 事件 / Mixin 目标 | 实现要点 | 难度 | 优先级 |
|---|---|---|---|---|
| `music` / 634 | `ClientTickEvents` + `HudRenderCallback` + 自定义音频线程 | 网页侧 `AudioContext` / 第三方音源全无等价物（见 §3.5 / §3.7）；Java 版退化为「本地文件播放 + 伪律动」或只读 `SoundManager` 音量 | 高 | P2 |
| `server` / 726 | `ClientPlayConnectionEvents.JOIN` / `Disconnect` / `MultiplayerScreen` | 源码写 `NET_CONFIG.rooms` 切房间；Java 版是切服务器地址（`ServerInfo`），本质是「重连」 | 高 | P2 |
| `gate` / `applyGate` 866 | 无对应 | 网页登录门槛 hook（`W.onlineGate`），Java 版没有这个 UI，整条丢弃（§3.7）| — | P2（不做）|
| `mc18` / 736 | 无对应 | 依赖 `opus-mc18-link` 的 1.8 协议桥，Java 1.21.1 客户端不直连 1.8；整条丢弃或做成「打开外部启动器」提示 | — | P2（不做）|
| `spin` / 665 | 见 render 表 | 已在 §1.3 列，按源码归 misc | 中 | P2 |
| `deathpoint` / EXT A | `ClientTickEvents.END_CLIENT_TICK` 检测死亡 | 死亡时往 `ModConfig.waypoints` 加一条（`name` 前缀 + `color`）| 低 | P1 |
| `coordlog` / EXT A 4831 | `HudRenderCallback` + `KeyBindingHelper` | 记录 / 复制 / 清空坐标，数据进 `cfg.ext.coords`（07 卷 `ExtData.coords`）| 低 | P1 |
| `sessionstats` / EXT A | `ClientTickEvents.END_CLIENT_TICK` | 时长 / 距离 / 挖掘数 / FPS 极值计数 | 低 | P1 |
| `combatlog` / EXT A | `LivingEntityMixin#damage` / `AttackEntityCallback` / 死亡检测 | 环形缓冲保留 `max` 条事件 | 低 | P1 |
| `chunkinfo` / EXT A | `HudRenderCallback` | 区块坐标 / 区内坐标 / 亮度 / 维度文本 | 低 | P1 |
| `blockinfo` / EXT A | `HudRenderCallback` + `crosshairTarget` | 准星方块名 / 坐标 / 硬度（`BlockState#getHardness`）/ 建议工具 | 低 | P1 |
| `welcome` / EXT C | `ClientPlayConnectionEvents.JOIN` | 进服弹欢迎通知 | 低 | P1 |
| `afk` / EXT C | `ClientTickEvents.END_CLIENT_TICK` + `Input` 空闲计时 | 长时间无输入标记 AFK，改通知 / 状态文本 | 低 | P1 |
| `tps` / EXT C | `ClientTickEvents.END_CLIENT_TICK` + `ClientWorld#getTime` | 由世界时间推进估 TPS | 低 | P1 |
| `entitycount` / `extEntityCounts` 6280 | `ClientTickEvents` + `HudRenderCallback` | 按半径统计 mob / item / player / other | 低 | P1 |
| `gametime` / `extGameClock` 6297 | `HudRenderCallback` | `world.getTimeOfDay()` → 游戏时间 / 天数 / 月相 | 低 | P1 |
| `coordcopy` / `extCopyCoord` 6302 | `KeyBindingHelper` | 按 `format` 拼坐标写系统剪贴板（`MinecraftClient#keyboard.setClipboard`）| 低 | P1 |
| `damageindicator` / EXT D | 见 combat 表 | 已列 | 中 | P1 |
| `blockhistory` / EXT D | `ClientChunkEvents.CHUNK_LOAD` / `BlockUpdateS2CPacket` Mixin | 记录附近方块变更，环形缓冲 | 中 | P1 |
| `chatlog` / EXT D | `ClientReceiveMessageEvents.CHAT` | 留存聊天消息 | 低 | P1 |
| `orestats` / EXT D | `ClientChunkEvents.CHUNK_LOAD` 扫矿物 | 见过的矿石计数 | 中 | P1 |
| `playtimewarn` / EXT D | `ClientTickEvents` 计时 | 超时通知 | 低 | P1 |
| `fpswarn` / EXT D | `ClientTickEvents` + 当前 FPS | 掉帧通知 | 低 | P1 |
| `autogg` / EXT D | `ClientPlayConnectionEvents.JOIN` | 进服自动发一句聊天（`ClientPlayNetworkHandler#sendChatMessage`）| 低 | P1 |
| `entityinfo` / EXT E | `HudRenderCallback` + `crosshairTarget` | 准星实体详情面板 | 低 | P1 |
| `chunkborder` / EXT B | 见 render 表 | 已列，按源码 `cat: 'render'` | 低 | P1 |

> misc 按源码逐条数：主表 5（`music` / `spin` / `server` / `gate` / `mc18`）+ A 组 6 + C 组 6 + D 组 6 + E 组 1 = 24。`damageindicator`（combat）、`chunkborder`（render）两行是跨表引用，不算 misc。分类计数以 README §2.2 为准，本表只保证**每个模块都有落点**，不拿行数反推分类。`gate` / `mc18` 两行标「不做」也是有落点——明确丢弃比悄悄漏掉强。

### 1.6 configs（19）

| 模块 id / JS 函数 | Fabric 事件 / Mixin 目标 | 实现要点 | 难度 | 优先级 |
|---|---|---|---|---|
| `appearance` / 507 + `applyAppearance` 1893 | 07 卷 `ModConfig` + 04 卷后处理 | 4 档预设写 8 个值（`accent/glow/blur/radius/anim/saturate/bg/border`），Java 侧是 POJO 字段而非 CSS 变量 | 中 | P0 |
| `perf` / 524 + `perfLevel` 1943 | `ClientTickEvents.END_CLIENT_TICK` | 按 FPS 自动降级（<25 省电 / <45 均衡 / 其余绚丽），`maxEnts/fxQuality/noGlow` 供各特效读 | 低 | P0 |
| `resourcepack` / 709 | `ResourcePackManager` / `FabricLoader` 资源包注册 | 网页侧 `TEXTURE_2D_ARRAY` 注入整套丢弃；Java 版本来就支持标准资源包（§3.6）| 中 | P2 |
| `hudedit` / 744 | `HudRenderCallback` + 自定义编辑 `Screen` | 拖拽改 `ModConfig.hudPos`，见 04/06 卷 | 中 | P1 |
| `cfgreset` / 751 | `BackupCodec`（07 卷 §4.2）| 导出 / 导入 / 重置三个按钮 | 低 | P0 |
| `intro` / 760 | `MinecraftClientMixin#render(boolean)` `@Inject(at = @At("HEAD"), cancellable = true)` | 开场动画覆盖整帧，见 03 卷；`skip` 点击跳过 | 高 | P0 |
| `floatgui` / 771 + `syncGuiClasses` 10620 | 自定义 `Screen` + HUD 层可拖动面板 | 每分类一个面板、可折叠成标签、位置存 `cfg.floatPos`；`hotkey` 走键位捕获 | 高 | P0 |
| `profile` / EXT A | `ModConfig` / 07 卷 | 把 `states` 快照存进 `cfg.ext.profiles` 三个档位，`save` / `load` 按钮 | 低 | P0 |
| `macro` / EXT A | `KeyBindingHelper` + `ClientPlayNetworkHandler#sendChatMessage` | 3 条文本，点一下发送 | 低 | P2 |
| `helpcenter` / EXT C | `Screen` | 模块说明（源码 `EXT_MODULE_DOCS`）/ 速查表 / 自检 Tab | 中 | P1 |
| `keyadmin` / EXT C 6495 | `KeyBindings.clearBind`（07 卷 §6.5）| 列出 / 清除 `cfg.binds` | 低 | P0 |
| `healthcheck` / EXT C | `ModuleRegistry.selfTest()`（07 卷 §6.3）| 配置体检页面 | 低 | P0 |
| `notes` / EXT D | `Screen` + `ModConfig` | 游戏内便签，文本存配置 | 低 | P2 |
| `screenshot` / EXT D | `ScreenshotRecorder` / `MinecraftClient#getFramebuffer` | 一键截图（`GLFW` + `NativeImage`）| 低 | P2 |
| `resource` / EXT D | `HudRenderCallback` | 内存 / 实体 / FPS 等运行时信息 | 低 | P1 |
| `selftest` / EXT D | `ModuleRegistry.selfTest()` | 帮助中心自检 Tab，空列表显示「所有模块注册与设置项检查通过」 | 低 | P0 |
| `quicktoggle` / EXT E | `ModuleRegistry` | 一键关掉所有高开销特效（遍历 `render` 分类批量 `setOn(false)`）| 低 | P1 |
| `guide` / EXT E | `Screen` | 指令 / 方块速查 | 低 | P2 |
| `about` / 7423 + `extAboutInfo` 7433 | `Screen` | 版本 / 模块数 / 设置数 / 运行时信息 | 低 | P2 |

---

## 2. 逐特效对照表（模块之外的效果）

`aura` 一个模块里塞了 18 个设置项，模块表一行装不下；开场动画、毛玻璃、HUD 组件同理。这一节把这些「不是独立模块的效果」单独列账。

### 2.1 光环 / 范围圈（`aura.settings`，02 卷）

| 特效 / 设置项 | 源码 | Fabric 实现 | 难度 | 优先级 |
|---|---|---|---|---|
| 脚下范围圈 `ring` | 312 | `AFTER_ENTITIES` 画水平圆环，半径 = `aura.range`，随玩家位置移动 | 中 | P0 |
| 极光 | `ringMode` 314 | 多层彩色环 + 正弦扰动，shader 或折线顶点 | 中 | P0 |
| 彩虹 | 314 + `ringRainbow` 323 | HSB 色相随时间循环，`Color.HSBtoRGB` | 低 | P0 |
| 脉冲 | 314 | 半径 / 透明度按 `sin(t * ringSpeed)` 呼吸 | 低 | P0 |
| 旋转 | 314 | 顶点角度加 `t * ringSpeed` 偏移 | 低 | P0 |
| 波浪 | 314 | 环上顶点 y 按角度正弦起伏 | 中 | P0 |
| 粒子 | 314 + `ringParticles` 324 | 沿环撒 N 个 `Particle` 或自绘点精灵 | 中 | P0 |
| 双层 | 314 + `ringLayers` 320 | 多环同心，半径等差，透明度递减 | 低 | P0 |
| 音乐律动 | 314 | 无 Web Audio 频谱（§3.5）；用时间函数伪律动或 `SoundManager` 音量兜底 | 高 | P0 |
| 五芒星 / 六芒星 | 314 | 五角 / 六角星顶点连线，带旋转 | 中 | P0 |
| 三角阵 / 菱形 / 六边形 / 花瓣 | 314 | 对应正多边形 / 极坐标花瓣曲线 `r = a*cos(k*θ)` | 中 | P0 |
| 齿轮 / 螺旋 / 星轨 | 314 | 齿形极坐标 / 阿基米德螺线 / 多圈轨道点 | 中 | P0 |
| 环形频谱柱 `fxBars` 325 | 325 | 环上按角度立 N 根柱子，高度取伪频谱数组 | 中 | P0 |
| 辉光 `ringGlow` 321 | 321 | 后处理高斯（04 卷），不是 canvas `shadowBlur` | 高 | P0 |
| 填充 `ringFill` 322 | 322 | 环内半透明填充（`RenderLayer` 三角形扇） | 中 | P0 |
| 拖影 `fxTrail` 327 / `fxBlur` 326 | 326–327 | 保留前 N 帧位置画渐隐残影；`fxBlur` 用后处理 | 高 | P0 |
| 线条粗细 `ringWidth` 319 | 319 | `RenderLayer.getLines()` 的线宽在 MC 里受限（GL_LINES 宽度常被驱动钳到 1）；用四边形条带替代 | 中 | P0 |
| 动效速度 `ringSpeed` 318 | 318 | 所有动画统一乘 `tickDelta * ringSpeed` | 低 | P0 |

> `RenderLayer.getLines()` 底层是 `GL_LINES`，很多驱动忽略 `glLineWidth` > 1。要还原 `ringWidth`（1–8 可调）必须自己把线段展开成屏幕/世界空间的四边形条带，这是 02 卷要解决的第一个硬骨头。

### 2.2 开场动画（03 卷）

| 阶段 | 源码 | Fabric 实现 | 难度 | 优先级 |
|---|---|---|---|---|
| 纯黑屏覆盖 | 11850 附近 | `MinecraftClientMixin#render` HEAD 注入，`cancellable` 覆盖整帧 | 中 | P0 |
| 图案逐段组装 | 同上 | 9 种几何图案（五芒星 / 六芒星 / 花瓣 / 齿轮 / 三角阵 / 星轨 / 极光等）分段绘制，按 `duration` 推进进度 | 高 | P0 |
| 碎片归位 | 同上 | 顶点从随机偏移插值回目标位置 | 中 | P0 |
| 持续转圈 | 同上 | 整体旋转 `t * speed` | 低 | P0 |
| 扩散淡出 | 同上 | 半径放大 + 全局 alpha 衰减到 0，结束放行原版渲染 | 中 | P0 |
| 点击跳过 `skip` 767 | 767 | 鼠标点击事件置 `finished = true` | 低 | P0 |

### 2.3 毛玻璃 / UI（04 卷）

| 效果 | 源码 | Fabric 实现 | 难度 | 优先级 |
|---|---|---|---|---|
| `blur()` 磨砂 | 9382 `backdrop-filter: blur(30px)` | 离屏 `Framebuffer` + 两趟可分离高斯 shader | 高 | P0 |
| `saturate()` / `brightness()` | 9382 | 同一 shader 里调饱和度 / 亮度 uniform | 中 | P0 |
| 高光边缘 `cm-sheen` | 9389 | 屏幕空间边缘渐变（`Smoothstep` 到四边）| 中 | P0 |
| 圆角 `radius` 514 | `--cm-radius` | 后处理里做圆角遮罩，或九宫格 GUI 纹理 | 中 | P0 |
| 主题 `default` / `glass` | `applyTheme` 10238 | 一个布尔切后处理管线开关 + 配色表 | 低 | P0 |
| 面板拖动 / 折叠 | `makeDraggable` / 10620 | `Screen` 鼠标拖拽 + `ModConfig.floatPos` 持久化 | 中 | P1 |
| 搜索框 / 下拉 / 滑块 / 开关 / 取色器 | `renderSettings` | Cloth Config 控件（07 卷 §6.4）| 中 | P0 |
| 收藏 ★ / 键位徽标 | `makeModuleRow` 10467 | 列表行自定义渲染 | 低 | P0 |

### 2.4 HUD 组件（05 / 06 卷）

| 效果 | 源码 | Fabric 实现 | 难度 | 优先级 |
|---|---|---|---|---|
| Watermark 水印 | 11235 | 左上角文字 + FPS / 时间 / 联机态 | 低 | P1 |
| Info 坐标 / 速度 | `hud.info` | `client.player.getPos()` / 速度向量文本 | 低 | P1 |
| TargetHUD 目标血条 | 05 卷 | 目标名 / 血条 / 头像 / 距离，投影或固定面板 | 中 | P1 |
| ArrayList 模块列表 | 06 卷 | 按启用模块 + 分类色排序，右上角堆叠 | 低 | P1 |
| 通知 Notifications | `notify` / `pushNotification` | 定时消失的堆叠卡片 | 低 | P1 |
| 雷达（正北朝上）| 1755–1768 canvas | 圆形裁剪 + 实体点投影（北固定）| 中 | P1 |
| 罗盘（几点方位 + 经纬度）| 同上 | 方位条 + 角度 / 坐标文本 | 中 | P1 |
| 罗盘路径点标记 `compassMarks` 502 | 502 | 把 waypoint 方位角嵌进方位条（PUBG 式）| 中 | P1 |
| 头像（自动正脸 / 整张贴图 / 像素手绘）| `faceTexture` 4234 | `PlayerSkinTexture` 裁 8×8 正脸；跨源获取无对应物（§3.10）| 中 | P1 |
| 名字标签 / 世界血条 | 454 / `healthbar` | `EntityRendererMixin#renderLabelIfPresent` 或 HUD 投影 | 中 | P1 |
| 屏外箭头 `edge` | `edgePoint` 3121 | 世界方位角 → 屏幕边缘坐标 | 中 | P1 |
| 世界光柱 `beacon` | 588 / 579 | `AFTER_ENTITIES` 画半透明竖立方体 | 中 | P1 |
| 3D 线框 / 追踪线 / 引导线 | `RenderLayer.getLines()` | 统一封装（06 卷 `LineRenderer`）| 中 | P1 |
| 动态模糊 `mblur` | 3659 | 见 §2.3 毛玻璃同一管线，强度按视角变化率 | 高 | P0 |

### 2.5 准星与命中反馈

| 效果 | 源码 | Fabric 实现 | 难度 | 优先级 |
|---|---|---|---|---|
| 自定义准星 5 形状 | 5755 `extOn('crosshair')` | `InGameHudMixin#renderCrosshair` 取消原版 + 自绘 | 低 | P1 |
| 击中标记 `hitmarker` | 5428 | 命中时间戳 + 准星闪光 + 音效 | 低 | P1 |
| 伤害数字 | 5437 | 世界坐标投影 + 上飘淡出 | 中 | P1 |
| 低血量径向红晕 | 6315 | `HudRenderCallback` 全屏径向渐变 | 低 | P1 |
| 受伤方向指示 | 6646 | 伤害来源方位 → 屏边弧线 | 中 | P1 |

---

## 3. 网页特有、无法 1:1 移植的清单

这一节是「诚实账」：下面 11 项在 Fabric 里**没有等价物**，硬抄只会写出跑不起来的代码。每项给替代方案，并标出受影响的模块/特效。

### 3.1 CSS `backdrop-filter`（毛玻璃）

源码 9376–9871 一整片 `backdrop-filter: blur(30px) saturate(180%) brightness(1.05)`，还带 `-webkit-` 前缀。它模糊的是「元素背后的**已渲染画面**」，由浏览器合成器完成。

**为什么不行**：Java 版没有 DOM 合成器，`DrawContext` 只会在当前帧缓冲上叠加绘制，拿不到「已经画好的背景」作为输入，MC 也没有 CSS。

**替代**：离屏 `Framebuffer`（Fabric API 里是 `SimpleFramebuffer`；Iris 语境下叫 `RenderTarget`，统一口径里写的就是它）+ 两趟可分离高斯模糊 shader：先把主帧缓冲拷到离屏，横趟模糊 → 竖趟模糊 → 把结果作为 GUI 面板底纹叠回。饱和度 / 亮度 / 圆角遮罩全放进同一个 fragment shader 的 uniform。详见 04 卷和本卷 §4.3 的 `BlurPipeline` 骨架。

**影响**：`appearance`、`floatgui`、`mblur`、`music`/`minimap` 等所有面板；光环辉光 `ringGlow` 也复用这条管线。

### 3.2 DOM 拖放与 `z-index`

源码 `makeDraggable`、`layoutPanel`（10229）、`syncGuiClasses`（10620）、`cm-xray-on` 全靠 DOM 节点 + CSS 层级；`prepareOpen`（10628）还会 `document.exitPointerLock()` 释放鼠标锁。

**为什么不行**：MC 的 GUI 是 `Screen` + `DrawContext`，没有 DOM 树，层级由「谁先画」决定。

**替代**：每个悬浮面板是一个 `Screen`（或 HUD 层的一个可拖动矩形），拖拽自己处理 `mouseDragged`，位置存 `ModConfig.hudPos` / `floatPos`（07 卷）。层级用**渲染阶段顺序**表达：世界层 → `AFTER_ENTITIES` 3D 线框 → `END_MAIN` 后处理 → `HudRenderCallback` HUD → `Screen` 交互界面。`z-index` 的概念直接删掉。指针锁用 `MinecraftClient#mouse.unlockCursor()`。

### 3.3 `localStorage`

源码 `CFG_KEY = '__cometCfg'`、`saveCfg()` 一行 `localStorage.setItem(...)`（101–131），容量约 5MB、同步、同源隔离。

**为什么不行**：Java 版没有浏览器存储；配置文件在 `run/config/`，是进程级文件系统。

**替代**：`ModConfig` POJO + Gson 写 `FabricLoader.getInstance().getConfigDir().resolve("comet.json")`（07 卷 §6.1）。注意两个差异得补上：① Gson 不跑字段初始化器，用「默认树 + 顶层覆盖」；② 写文件要原子 move，失败只记日志不抛（对应源码 `try/catch` 静默兜底）。容量不再是问题，但 IO 不能放在渲染线程（§4.2）。

### 3.4 Canvas 2D

源码 ESP / 雷达 / 罗盘 / 光环 / 频谱全画在 `<canvas>` 的 `getContext('2d')` 上（1755–1768 建了 `espCanvas` / `radar` / `compass` 三块），用 `fillRect`、`stroke`、`createRadialGradient`、`shadowBlur`。

**为什么不行**：MC 没有 2D 画布上下文；只有 `DrawContext`（矩形 / 文字 / 纹理）和 GL 顶点缓冲。

**替代**：分两类。屏幕空间的矩形 / 文字 / 渐变 → `DrawContext.fill()` / `drawText()` / 九宫格纹理；世界空间的 3D 线框 / 光环 / 光柱 → `VertexConsumerProvider` + `RenderLayer.getLines()`，用 `WorldRenderContext.matrixStack()` 变换。`createRadialGradient` 的径向红晕（低血量）用一张预生成的径向渐变纹理拉伸铺满，别逐像素算。`shadowBlur`（辉光）归 §3.1 的后处理。

### 3.5 Web Audio 频谱（`AnalyserNode`）

源码 3319–3420 用 `AudioContext` + `createMediaElementSource` + `createAnalyser()`，`getByteFrequencyData(freqData)` 拿频谱驱动 `music.sens` 和光环「音乐律动」「环形频谱柱」。注释里已经写了真相：第三方 CDN 不给 CORS 时 `getByteFrequencyData` 全零，脚本自己会走**伪律动兜底**。

**为什么不行**：Java 版没有浏览器音频图，没有 `AnalyserNode`；MC 的 `SoundManager` 不暴露实时 PCM 频谱。

**替代**：三条路，按投入排序：① 直接用脚本同款伪律动（时间函数 + 低频噪声），视觉上几乎一样，最低成本；② 播放本地音频文件时自己读 PCM 跑 FFT（需引入音频解码，重）；③ 读 `SoundManager` 正在播放的音量近似。**推荐 ①**，并在配置里保留 `music.sens` 灵敏度参数，语义不变。`ringMode = 音乐律动` 和 `fxBars` 两个特效靠它。

### 3.6 WebGL `TEXTURE_2D_ARRAY` 注入方块材质

源码 7651–7656 的链路是：hook `CanvasRenderingContext2D.prototype.getImageData` 在源头改像素 → 抓 `texStorage3D(TEXTURE_2D_ARRAY, ..., 16, ...)` 时的纹理对象 → `rpReupload()` 逐 mip 级 `texSubImage3D` 重传（8385–8470）。这是为了在**不刷新页面**的前提下把标准 MC 资源包塞进网页版游戏的贴图数组。

**为什么不行**：Java 版本来就用标准资源包，`SpriteAtlasTexture` / `NativeImage` / `ResourcePackManager` 全是现成的；直接 hook GL 调用既没必要又会和 Sodium / Iris 的纹理管线打架。

**替代**：把 `resourcepack` 模块做成「注册一个 `ResourcePack`」——`.zip` 用 `ZipFileSystem` / `ResourcePack` 读，`assets/*/textures/block/*.png` 由 MC 自己加载。`import` / `reapply` / `clear` / `demo`（内置暗色 GUI 包）四个按钮映射到资源包列表的增删与 `client.reloadResources()`。「材质透视」XRay 的隐藏画布做法（1869 行 `applyXrayWorld` 给 `#gl` 加 class）更没有对应物，改成资源包替换方块模型为透明 / 玻璃，或直接走 `xray.mode = 框选`。

### 3.7 B 站 Toy iframe / 来源伪装 / 账号同步

源码 7–11 的 `@match`（`bilibilitoy.com` / `bilibili.com/toy/*` / `localhost:8777` / `*://*/game.html*`）、`installOriginSpoof`（40–70，把 `honghemc.cn` 的请求伪造 `Origin: bilibili.com` / `Referer`）、`installAccountSync`（75–96，用 `GM_setValue/GM_getValue` 把登录态从线上版搬到离线版）、`gate`（866，hook `W.onlineGate` 跳过登录门槛）。

**为什么不行**：这些全是**网页托管环境**的适配，不是客户端功能。Java 版没有同源策略、没有 iframe、没有油猴 API、没有「多人界面登录门槛」这个 UI。

**替代**：整体丢弃，并在文档里明确记为「不适用」而非「未移植」。Java 侧唯一有意义的是 `java.net.http.HttpClient` 做跨域请求（没有 CORS 限制，反而更简单），但本项目没有需要它的功能。`server`（切房间）保留但语义变成「切换 `ServerInfo` 地址并重连」；`mc18`（1.8 协议桥）保留成「打开外部启动器」的提示或直接不做。

### 3.8 资源包 zip 的 `DecompressionStream('deflate-raw')` 解压

源码 8265–8268：`new DecompressionStream('deflate-raw')` 解 zip 里的 deflate 数据，注释特意说「不引任何依赖」；另有 `createImageBitmap`（7757 / 8337）解码图片。

**为什么不行**：这是浏览器独有的 Streams API。

**替代**：`java.util.zip.ZipInputStream` / `InflaterInputStream`（JDK 原生，比浏览器侧还直接）、`NativeImage.read(InputStream)` 解码 PNG。图片绘制走 `RenderSystem` 上传纹理，不需要 `createImageBitmap`。

### 3.9 `document-start` 注入时机

源码 `@run-at document-start`（12 行）+ `installAccountSync` 要在游戏加载前抢注 `keydown` 捕获（3199 注释）、`hookRender` 要抢在 `ASSETS` 加载前装 `getImageData` hook（8385 注释）。

**为什么不行**：Mod 没有「文档开始」这个时刻，加载器有自己的初始化阶段。

**替代**：`ClientModInitializer#onInitializeClient()` 在所有世界加载之前执行，天然满足「比游戏逻辑早」。事件注册用 Fabric 官方回调（`ClientTickEvents` / `WorldRenderEvents` / `HudRenderCallback`），不去抢 `prototype.render`（958–987 那套 hook 在 Java 版完全不需要，反而容易和 Sodium 冲突，见 §5.1）。唯一要注意：`ClientPlayConnectionEvents.JOIN` 才是「进世界」的时机，别在 `onInitializeClient` 里访问 `client.world`（那时还是 null）。

### 3.10 跨源头像 / 皮肤获取

源码 `faceTexture`（4234）从 `window.ETEX`（网页版把 vanilla 贴图挂成 data URI）里找 `entity/player/wide/steve` 这类键，`getFaceImg`（4296）用 `Image` 加载后裁正脸；注释 3199 附近还提到跨域限制。

**为什么不行**：Java 版皮肤由 Mojang 会话 / 皮肤服务提供，`PlayerEntity#getSkinTextures()` 返回 `SkinTextures`，网络获取由游戏内部完成。

**替代**：直接从 `SkinTextures#texture()` 拿 `Identifier`，用 `DrawContext.drawTexture` 裁 8×8 头部区域（正脸 UV 是固定的）。`hud.faceStyle` 的三种样式（自动正脸 / 整张贴图 / 像素手绘）都基于这张纹理做不同裁切 / 放大过滤，不需要任何 HTTP。

### 3.11 双击空格 / 键盘捕获阶段

源码 `installFlyKeys`（1490）在 `window` 上用 `addEventListener(..., true)` 捕获阶段监听，`onKeyDown`（11750–11835）用 `stopImmediatePropagation` 抢按键；`g.mouseBtn[2]` 直接模拟鼠标右键（`tickAutoEat` 1638、`tickBowAim` 1303）。

**为什么不行**：MC 有自己的 `KeyBinding` / `Input` 体系，没有 DOM 事件、没有捕获阶段、没有 `mouseBtn` 数组可以随便写。

**替代**：`KeyBindingHelper.registerKeyBinding` + `ClientTickEvents.END_CLIENT_TICK` 里 `wasPressed()` / `isPressed()`；模拟「按住使用键」用 `MinecraftClient.options.useKey.setPressed(true)`，模拟右键用 `UseItemCallback` / `ClientPlayerInteractionManager#interactItem`。双击空格的检测自己记上次按键时间戳（源码 `flyTapAt < 300ms` 的逻辑照搬即可）。

---

## 4. 风险清单

### 4.1 Mixin 冲突（Sodium / Iris）

网页版 hook 的是自己游戏的 `prototype.render`；Java 版如果也去 mixin `WorldRenderer#render` / `GameRenderer#renderWorld` / `LightmapTextureManager#update`，几乎必然和 Sodium（重写区块渲染）、Iris（接管 framebuffer 与 shader）撞车，表现为黑屏、光环不显示、或启动崩溃。

缓解：

- **能用 Fabric 事件就别用 Mixin**。3D 线框、所有 ESP、光环、光柱一律走 `WorldRenderEvents.AFTER_ENTITIES`；HUD 走 `HudRenderCallback`；每帧逻辑走 `ClientTickEvents.END_CLIENT_TICK`。本卷 §1 的 100 行表里，标 Mixin 的只有确实需要改原版行为的那些（改 FOV、改亮度、改实体属性、取消准星绘制）。
- 必须 Mixin 时用 `@Inject(at = @At("RETURN"))` 或 `@ModifyReturnValue`，**不用 `@Overwrite`**、少用 `@Redirect`（Sodium 常把目标方法整体替换掉，重定向会注入失败）。
- 注入点不要太靠前。亮度这种改 `LightmapTextureManagerMixin#update(F)V` 的 `@Inject`，放 `@At("TAIL")` 让原版和其他 mod 先算完再覆盖。
- `comet.mixins.json` 里 `defaultRequire: 1` 会让注入失败直接崩（README §3.3），这是刻意的：静默丢功能比早崩更难查。但**可选兼容目标**（只针对某个 mod 存在的类）单独放可选 mixin 配置并设 `required: false`。
- 后处理不要缓存 `MinecraftClient#getFramebuffer()` 的引用。Iris 会在每帧换 framebuffer，正确做法是在 `WorldRenderEvents.END_MAIN` 里读 `WorldRenderContext` 给出的当前目标，用完即弃（见 §4.3 代码）。

### 4.2 渲染线程

MC 的渲染、tick、GL 调用主要在客户端主线程，但网络回调 / 配置导入 / HTTP / 文件 IO 可能来自别的线程。脚本是单线程 JS，没有这个问题，移植时最容易在这里翻车。

规则与代码：

```java
// 只在客户端主线程改游戏状态 / 碰 GL；后台线程只算数据、把结果交给主线程
public static void onBackgroundDataReady(CompletableFuture<JsonObject> future) {
    future.thenAccept(data -> MinecraftClient.getInstance().execute(() -> {
        // execute(() -> ...) 把任务排回客户端主线程，对应源码"反正都在一个线程里"的隐含前提
        BackupCodec.apply(ModConfig.get(), data);
        ModuleRegistry.onConfigReplaced();
    }));
}
```

- `ClientTickEvents.END_CLIENT_TICK` / `HudRenderCallback` / `WorldRenderEvents.*` 都在客户端线程，可以直接读 `client.world` / `client.player`。
- 文件 IO（`ModConfig.save` / `BackupCodec`）、HTTP、音频解码放 `ExecutorService`，结果用 `client.execute(...)` 回主线程。
- `ModConfig` 单例用 `volatile` + 主线程写；帧缓存 `FRAME_CACHE` 不做跨线程共享（07 卷 §6.1）。
- `ClientPlayConnectionEvents.JOIN` 之前不访问 `client.world`，为 null。

### 4.3 内存泄漏（离屏 Framebuffer 复用）

毛玻璃 / 动态模糊 / 辉光 / 小地图都要离屏缓冲。最典型的泄漏是**每帧 `new SimpleFramebuffer(...)`** 或者窗口 resize 时旧缓冲没删。源码是浏览器管 canvas 生命周期，Java 侧必须手动 `delete()`。

```java
package com.bigpixel.comet.render;

import com.mojang.blaze3d.systems.RenderSystem;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gl.SimpleFramebuffer;
import net.minecraft.client.util.Window;

/** 对应统一口径里的 RenderTarget：Fabric 侧实际类是 SimpleFramebuffer。 */
public final class BlurPipeline implements AutoCloseable {

    private SimpleFramebuffer ping, pong;
    private int cachedW = -1, cachedH = -1;

    /** 窗口尺寸变了才重建；每帧只复用，不 new。 */
    private void ensureSize() {
        Window w = MinecraftClient.getInstance().getWindow();
        int width  = w.getFramebufferWidth();
        int height = w.getFramebufferHeight();
        if (width == cachedW && height == cachedH && ping != null) return;
        release();                                  // 先删旧的，别泄漏
        ping = new SimpleFramebuffer(width, height, false, false);
        pong = new SimpleFramebuffer(width, height, false, false);
        ping.setClearColor(0f, 0f, 0f, 0f);
        pong.setClearColor(0f, 0f, 0f, 0f);
        cachedW = width; cachedH = height;
    }

    /** 两趟可分离高斯：横 → 竖，对应 CSS blur() 的近似。 */
    public void blur(Runnable drawScene, float radiusPx, float saturate) {
        ensureSize();
        // 1) 把当前场景拷到 ping；2) 横趟 ping→pong；3) 竖趟 pong→ping；
        // 4) 用 ping 的颜色纹理作为面板底纹叠回，uniform 带 radiusPx / saturate
        // shader 与 RenderSystem 调用见 04 卷；这里只强调"复用不重建"。
        drawScene.run();
    }

    private void release() {
        if (ping != null) { ping.delete(); ping = null; }
        if (pong != null) { pong.delete(); pong = null; }
    }

    @Override public void close() { release(); }   // mod 停用时调，或注册客户端停止事件
}
```

其它要盯的：`NativeImage` 用完 `close()`；`VertexConsumerProvider.Immediate` 每帧 `draw()` 后不缓存；`entitytrail` / `trail` 的坐标环形缓冲按实体 id 存，实体卸载（`ClientEntityEvents.ENTITY_UNLOAD`）时删对应条目，否则长时间挂机内存一直涨；`waypoints` / `coordlog` 有 `max` 上限要真生效（源码 `coordlog.max` 30、`combatlog.max` 8）。

### 4.4 性能预算（粒子 / 模糊 / 3D 线框每帧开销）

脚本自己有 `perf` 模块（1943–1952）按 FPS 降级，`noGlow` 还专门注明「`shadowBlur` 是 canvas 最贵的操作」。Java 版的开销结构不同，得重新算一遍：

| 效果 | 每帧主要开销 | 预算建议 | 降级手段（对齐 `perf.level`）|
|---|---|---|---|
| 全屏两趟高斯模糊 | 2 次全屏 draw + 纹理采样，与分辨率平方相关 | 只在 `glass` 主题 / `mblur` 开启时跑；`省电` 档直接关 | 降采样到 1/2 或 1/4 分辨率再模糊；`fxQuality` 缩放离屏尺寸 |
| 光环 17 种动效 + 粒子 | 顶点数 = 圈层数 × 分段数 × 层数 | 分段 ≤ 64，粒子 ≤ 60；`省电` 档砍粒子 | `perf.fxQuality` 调分段 / 粒子数；`noGlow` 关辉光后处理 |
| 3D 线框（ESP / 容器 / 方块）| 每实体一次 AABB = 12 条线；实体上限 `maxEnts=80` | 扫实体用 `client.world.getEntities()` 一次，别每模块各扫一遍 | `esp.distance` / `containeresp.range` 半径裁剪；`perf.maxEnts` 硬上限 |
| 小地图地形着色 | 每帧读 `getBlockState` 数百次 | 缓存高度图，chunk 更新时失效，别每帧全扫 | `zoom` 缩小采样半径；`terrain` 关掉只画实体点 |
| 方块扫描（xray / blockesp / containeresp）| 半径 48 内 `BlockState` / `BlockEntity` 遍历 | 放后台线程按 chunk 增量扫，结果缓存；`ClientTickEvents` 只做节流触发 | `limit` / `radius` 设置项真生效 |
| 频谱柱 / 拖影 | 顶点 + 帧历史缓冲 | 拖影长度 `fxTrail` ≤ 90 帧，按固定步长采样 | 关闭 `fxBars` / `fxTrail` |
| 文本 HUD（十几个面板）| `DrawContext.drawText` 每次重建字形 | 合并同色文本，缓存 `Text` 对象 | `hud` 子开关逐个关 |

关键结构决策：**扫描类工作合并到一个 `CometTick.onEndTick`，结果放共享缓存，各模块只读**。源码 `tickModules` 里 `syncRefs()` 每帧对齐一次 `game/player`，`espFrame` 也是一次遍历画完所有 ESP——这个「一帧一次遍历」的习惯要保留，别让 100 个模块各自遍历一遍 `client.world.getEntities()`。

---

## 5. 验收清单

「怎样算移植成功」必须可观察、可复现。下面按组给标准，勾的时候照做，别凭感觉。

### 5.1 地基与配置（07 卷）

- [ ] 首次启动生成 `run/config/comet.json`，含全部顶层字段；删掉某个字段再启动，该字段自动补回默认值且 mod 不崩。
- [ ] 改任意设置 → 退出重进 → 值还在；`getS` 默认值回退：删掉 `settings["aura.range"]` 后读到 4.5，且不会把 4.5 写回文件。
- [ ] 100 个模块全部出现在 ClickGUI 的 6 个分类里，数量与 `README §2` 表一致；扩展模块（如 `crosshair` / `about`）不缺。
- [ ] 收藏置顶、搜索（中文名 / 描述 / 分类名）、子分类分组标题、键位绑定与清除、中键进绑定态都能用。
- [ ] 自检页在干净配置下显示「所有模块注册与设置项检查通过」；手动往 `settings` 塞一个未知键后再打开，能列出「未知设置项」。
- [ ] `.opuscfg` 导出后导入：模块开关、键位、路径点、面板位置全部还原；把第一行魔数改掉会被拒绝且不破坏现有配置。

### 5.2 视觉特效（02 / 03 / 04 卷）

- [ ] 光环：开 `aura.ring` 后脚下出现与 `range` 等大的圈；`ringMode` 17 种图案逐一切换都能看到不同形状；`ringSpeed` 调大动画明显变快；`ringWidth` 1 与 8 线宽确实不同（说明条带方案生效，没被 GL 钳死）。
- [ ] 彩虹模式色相随时间循环；`ringRainbow` 关掉后固定为 `ringColor`（留空 = 彗星紫 `#b06bff`）。
- [ ] `ringLayers` 1→4 圈数递增；`ringGlow` 从 0 调到 30 辉光变强；`ringFill` 从 0 调到 40 填充变实。
- [ ] `ringParticles` / `fxBars` / `fxTrail` 分别能开关，关掉后对应效果完全消失；`fxTrail` 停下移动后残影在 `fxTrail` 帧数内淡出。
- [ ] 开场动画：启动后黑屏 → 图案逐段组装 → 碎片归位 → 持续转圈 → 扩散淡出 → 正常进入标题；`duration` 1.5s 与 6s 时长明显不同；勾 `skip` 时点击能立刻跳过；`style` 7 种样式都能出图。
- [ ] 毛玻璃：`glass` 主题下能明显看到面板背后的画面被模糊、边缘有高光、四角是圆角；`appearance.blur` 0→30 变化可见；`default` 主题下无模糊。
- [ ] 四档外观预设：绚丽 / 平缓 / 基本切换后主题色、辉光、模糊、圆角、饱和度全变；切到「自定义」能还原之前手动调过的值，再切到别的档再切回来值不丢。
- [ ] 动态模糊：快速转视角时画面模糊，停下 0.5s 内淡出；HUD 与光环保持清晰（对应源码 `z-index` 低于 HUD/ESP 的注释 3660）。

### 5.3 HUD 与 ESP（05 / 06 卷）

- [ ] `hud` 9 个子开关逐个开关，对应元素出现/消失；水印显示版本号 / FPS / 时间且数值在变。
- [ ] TargetHUD：准星指向生物时出现目标名 + 血条 + 头像 + 距离，血量变化跟着动；三种 `faceStyle` 都能出图。
- [ ] ESP / Tracers：生物 / 掉落物 / 玩家分别用各自颜色画线框 / 追踪线；`esp.distance` 调小远处实体消失；超过 64 格不画。
- [ ] `containeresp` 13 类容器各自颜色可独立设置，改 `f_chest` 后只有箱子框变色。
- [ ] `blockesp.target` 填 `diamond_ore` 后周围钻石矿持续高亮，转身 / 穿墙仍看得到；屏外箭头指向正确方位。
- [ ] 雷达正北朝上：转身时雷达不跟着转，实体点方位与世界方位一致；罗盘「几点方向」随视角变化，`compassMarks` 把已标记点位嵌进方位条。
- [ ] 小地图圆形裁剪、地形着色、实体点、路径点都在；按 `M` 打开大地图；`zoom` 16→128 视野半径变化。
- [ ] 名字标签：手持 / 装备 / 紧凑排版 / 字号 / 名字色 / 背景色 / 透明度 / 显示内容 / 别名（「鸡=咯咯」）逐项生效。
- [ ] 扩展 HUD：`armorhud` / `potionhud` / `fpsgraph` / `crosshair`（5 形状）/ `zoom` / `lightoverlay` / `chunkborder` / `hitmarker` / `damagenumbers` / `lowhp` / `waypointline` / `blockoutline` / `worldHealthBar` 逐个开关都有可见差异，没有一个是空实现。

### 5.4 玩法模块（09 卷）

- [ ] 移动类：`autosprint` 前进自动疾跑（勾「仅前进」时后退不触发）；`fly` 双击空格开关、空格升 / Shift 降；`step` 能直接走上一格高；`speed.mult` 1.5 比 1.0 明显快；`nofall` 从高处落下不掉血（单机）。
- [ ] 世界/玩家类：`fastbreak.mult` 8 比 2 挖得快；`instantbreak` 点一下方块立刻消失；`autoeat` 饥饿低于阈值且手持食物自动吃；`waterbreath` 水下氧气不减；`autorespawn` 死亡后自动重生；`freecam` 相机自由飞而身体原地不动、关掉后视角归位。
- [ ] `scaffold` 前进时脚下前方自动铺方块，手持非方块物品时不放（源码 1344 行的坑：`itemDef.block == null` 直接 return）。
- [ ] 渲染开关：`fullbright` 进全黑洞穴亮度与地表一致、关闭后恢复；`nightvision` 有夜视效果；`ambience` 锁时间 / 天气；`mblur` 见 §5.2。
- [ ] **客户端侧限制可观察**：联到真实服务端时，`crit` / `fly` / `speed` / `instantbreak` / `nofall` 的「作弊」效果被服务端拒绝或回弹，且 mod 不崩、不反复发包刷屏。这条是验收项，不是可选项——09 卷要给出对应标注。

### 5.5 跨卷一致性

- [ ] 所有 100 个模块的开关都读同一个 `ModConfig.states`，没有模块自己另存一份状态。
- [ ] `quicktoggle` 能一键关掉所有高开销特效，再开能恢复。
- [ ] 导入一份含 100 个模块开关的 `.opuscfg` 后，界面上所有开关与文件一致。
- [ ] 装了 Sodium + Iris 的环境能启动，毛玻璃 / 光环 / ESP 不黑屏、不丢后处理（§4.1）。
- [ ] 连续挂机 30 分钟内存不持续增长（§4.3）：离屏缓冲只在窗口 resize 时重建，实体轨迹缓存随实体卸载清理。
- [ ] `perf.level = 自动` 时把 FPS 压到 25 以下，粒子 / 辉光 / 模糊自动降级（§4.4）。

---

这一卷是总账：§1 的 100 行对照表用来排期，§2 的特效表用来补模块表装不下的细节，§3 明确「哪些不搬、换成什么」，§4 是动手前要绕开的坑，§5 是逐条勾的验收。`09-gameplay-modules.md` 会把 §1 里 P2 那批玩法模块的 Java 实现展开，并写清楚作弊功能在服务端不同步的技术边界。
