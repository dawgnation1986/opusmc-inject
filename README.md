# OpusMC 生存辅助 HUD — 注入操作手册

目标：给 B 站网页版 MC（`bilibili.com/toy/OpusMC`，闭源独立实现）做一个「彗星客户端」式的
运行时注入 HUD（坐标 / FPS / 血量 / 饥饿）。脚本本体是 `opusmc-hud.user.js`（v0.2.0）。

## 底细已摸清（2026-11-05 实测）

- **游戏真实地址**：B 站 Toy 只是外壳，游戏跑在 **`www.bilibilitoy.com`** 这个独立域的
  iframe 里（当前版本 `https://www.bilibilitoy.com/toy/OpusMC/47455601425408-v39426/index.html`，
  路径里的版本号会随更新变化，脚本用通配 `@match https://www.bilibilitoy.com/*` 覆盖）。
- **全局对象就叫 `window.game`**：游戏页面自己的代码就写着
  `(window.game && window.game.state !== 'boot')` —— 脚本 Tier 1 直接命中，无需断点考古。
- **源码未混淆**：游戏是 60+ 个按功能命名的独立 JS（非 bundle）。已全量下载到
  `probe/js/`（18MB），是**可读源码**，做深度 mod 时就是权威参考。类定义位置：
  `game.js`（class Game）、`entity.js`（class Entity / Living / Player）。
- 架构与 OpusCraft 同款双 canvas：`#gl`（WebGL 3D）+ `#ui`（2D HUD 层）。

## OpusMC 字段地图（照 entity.js / game.js 实测，已写进脚本适配）

| 数据 | OpusMC | OpusCraft 对照 |
|---|---|---|
| 全局对象 | `window.game` | `window.__game` |
| 坐标 | `game.player.pos = [x,y,z]`（**数组**） | `player.x / y / z` |
| 上一帧坐标 | `player.prev = [x,y,z]`（插值用） | `xo/yo/zo` |
| 速度 | `player.vel = [vx,vy,vz]` | `dx/dy/dz` |
| 朝向 | `player.yaw / pitch`（**弧度制**） | 度数制 |
| 血量 | `player.health`（满 20） | 同 |
| 饥饿 | `player.food / saturation` | 同 |
| 飞行/疾跑/潜行 | `player.flying / sprinting / sneaking` | 同 |
| 模式 | `game.mode`（'survival' 等） | `player.gameMode` |
| FPS | `game.fps` | 同 |
| 实体列表 | `game.entities` | `game.level.entities` |
| 游戏状态 | `game.state`（'boot'/'play'…） | `game.inWorld` |

## 使用（两步）

1. Chrome/Edge 装 Tampermonkey → 新建脚本 → 粘贴 `opusmc-hud.user.js` 全文 → 保存。
2. 打开 `https://www.bilibili.com/toy/OpusMC` 进游戏。左上角出现
   「OpusHUD · 已接入（game）· L 开菜单」即成功。

脚本对 `opuscraft.pages.dev` 同样生效，可以对照着玩。

## 功能（v0.3.0）

- **L 键**：开关右侧菜单（控件全为开关样式，配置存 localStorage 记住）。
- **H 键**：快速开关坐标 HUD（菜单里也能关）。
- **坐标 HUD**：XYZ / 方块坐标 / 朝向 / FPS / HP / 饥饿 / 模式 / 移速。
- **ESP 生物方框**：遍历 `game.entities`，只框生物（有 health/maxHealth 的实体）。
  敌对生物红框（类名清单来自 mobs_hostile.js）、生物蓝框、其他玩家紫框，
  方框上方带血条 + 类名 + 距离。投影直接读 `game.renderer.vp`（view×proj 合成矩阵，
  每帧更新），与游戏画面（含 fov、视角摆动、第三人称）完全对齐。
- **追踪线**：准星 → 生物方框中心。
- **ESP 距离**：菜单步进调节（8~128 格）。

## 离线完整版（断网可玩）

`probe/` 目录就是抓下来的完整游戏（90 个 JS + game.html，全部外部资源内嵌，
唯一的外部数据 credits.json 也已内嵌在 texts.js 里——资源零缺失）。

**本地双击 game.html 黑屏是正常的**：file:// 协议下 Chrome 禁 Worker（地形生成）
和 IndexedDB（存档），游戏起不来。用 `start-game.cmd` 走本地服务器：

1. 双击 `start-game.cmd`（自动开浏览器到 `http://localhost:8777/game.html`）；
2. 窗口保持开着（Ctrl+C 或关窗 = 停服）；
3. 断网也能玩，存档在你浏览器里（IndexedDB 按「来源」隔离：本地版和 B 站版存档互不相通）。

已验证：本地起服后 game.html 与全部 JS 均 200。

## v0.6.0 双协议：MC 1.8.9 直连内核（2026-11-05）

- 用户自制 **PHPMC**（`opusmc-inject/PHPMC/`，PHP 写的 Minecraft Java 1.8.9 服务端，
  协议 47，TCP 25565 + **wss:24443 网页客户端通道**）。探查确认：PHPMC 的 wss 通道是
  eaglercraft 式设计——**WebSocket binary 帧里封装的就是普通 MC 字节流**（帧边界≠包
  边界，客户端按 VarInt 包长自行分帧），协议层无任何魔改。
- **新工具 `opus-mc18-link.user.js`**：在 OpusMC 页面里实现的 MC 1.8.9 协议客户端内核
  （协议 47）——WS 管道 + VarInt 读写 + 握手/登录/Play 状态机 + KeepAlive 应答 +
  聊天收发 + **解码表按 PHPMC src/Server.php 的实际发包字段逐个反向核对**
  （含 PHPMC 特例：Chunk Data 的 primaryBitmask 写的是 2 字节 short，不是标准 varInt）。
  覆盖 PHPMC 发送的全部 30+ 个 clientbound 包（JoinGame/Chat/Chunk/BlockChange/
  PlayerList/SpawnPlayer/Mob/Entity 系列/UpdateTileEntity(NBT 跳过)/Disconnect…）。
- **用法**（PHPMC 起服后）：
  1. Tampermonkey 装本脚本，打开本地版（或任意匹配页）；
  2. console：`__mc18.connect('ws://localhost:25565', '你的名字')`（本地测试走 ws 普通端口
     自动识别；远程用 wss://host:24443，自签证书需浏览器信任）；
  3. `__mc18.status()` 看状态/区块计数，`__mc18.say('hi')` 聊天，服务器后台应能看到
     玩家加入；`__mc18.probe(x,y,z)` 发位置探针触发按坐标下发区块。
- **阶段路线**：本版打通「连接-登录-聊天-区块数据解码」链路；下一阶段是
  **世界桥接**（1.8 方块 id ↔ OpusMC 方块 id 映射、区块注入 OpusMC 世界、位置/动作
  同步）——那是真正的「网页客户端进真服务器」，工程量大，按里程碑推进。

## v0.5.3 标题屏残留与贴脸爆炸修复（2026-11-05）

- **标题屏不再画 ESP**：`game.state`（boot/title/loading/play）非 play 时清屏停画——
  之前标题屏会画出上个世界残留实体的框/标签/追踪线（用户看到满屏羊牛标签就是这个）。
- **贴脸爆炸保护**：实体距眼睛 <0.1m 或投影角点超出画布 4 倍时整框不画——
  此前贴脸实体的 3D 框投影坐标会除以极小的 w 爆炸成天文数字，棱线拉满整屏
  （正对相机时 4 根竖棱重合成一条竖线，看起来像一座「塔」）。
- 说明：截图里的蓝色斑块是**游戏自己的夜景云层**，中央白塔是**贴脸实体的爆炸线框**，
  都不是雷达——雷达是右下角 140px 圆形小图（需要在 GUI 开「实体雷达」）。

## v0.5.2 关键修复 + Git 仓库（2026-11-05）

- **ESP 全灭根因修复**：v0.5.0 全量重写时把 `let renderHooked = false;` 声明弄丢了——
  严格模式下 espFrame 第一行读未声明变量直接抛 ReferenceError，渲染挂钩里的
  try/catch 把异常静默吞掉，rAF 回调自己也抛在第一行——**ESP/雷达/罗盘/标签无声全灭**，
  且控制台无任何报错。已补回声明（v0.5.2）。
- **Git 仓库**：`opusmc-inject/` 已建仓（main 分支，单提交 8baaa6f，217 文件）。
  - `.gitignore` 排除：back/、源码备份/、probe/sounds/（51MB 音效）、
    PHPMC 私钥/logs/cache/world/dist/data；
  - 音效二进制不入库，用 `tools/fetch_sounds.py`（固化了抓取脚本）重新拉取；
  - 推远端：`git remote add origin <你的仓库地址> && git push -u origin main`
    （GitHub/Gitee 均可，或告诉我地址我来推）。

## v0.5.1 多房间服务器支持（2026-11-05）

- **背景**：多人联机的房间服务是作者自建的（`NET_CONFIG.rooms` =
  `https://xz.honghemc.cn:8443`，账号/房间/WebRTC 信令全在这台服务器），登录凭证
  （token/key）附在每个联机请求里、由服务端校验——**客户端伪造登录无法真正加入**，
  伪造凭证打服务器不做。
- **新增：房间服务器切换**。`RoomService.base()` 每次动态读 `NET_CONFIG.rooms`，
  热切换无需刷新：
  - GUI「信息」列尾新增「服务器」行，点击在已配置的服务器间循环；单服务器时点击
    会提示控制台添加法。
  - 控制台管理：`__opusHud.addServer(名字, 'https/wss 地址')` 添加、
    `__opusHud.listServers()` 查看、`__opusHud.setServer(序号)` 切换。
  - 切换后**重进房间生效**（连接中的会话不变）。
- **前提要说清**：其他服务器必须跑**兼容的房间服务协议**（同一套 /api/rooms +
  /p2p + /ws 接口）才可用——作者的 rooms 服务端没开源，没有现成的第二台兼容服务器
  的话，这个功能主要服务于自建/测试。
- **加入别人房间的登录问题**：`joinRoom` 本身只带本地随机 room-key（房主管理用），
  客户端的登录门槛可能在多人界面 UI 层——本地版可用作者内置的测试开关
  `?toymock=1`（URL 参数，作者专门为 localhost 留的 mock 登录）进界面试试；
  真被服务端拒绝就说明 guest 也要账号——那就到在线版注册一个（免费），这是正道。

## v0.5.0 Meteor 式 ClickGUI（2026-11-05）

- 菜单彻底重构为 **Meteor 客户端同款 ClickGUI**：**RShift（右 Shift）** 呼出/关闭
  （L 键保留备用，Esc 也能关），三列布局：
  - **Render**（紫）：ESP 生物方框 / 追踪线 / 名字与血条 / 物品与投射物 / 实体雷达 /
    方位罗盘 / 夜视，列尾 ESP 距离步进；
  - **信息**（蓝）：坐标 HUD / **时间与天气**（新模块：第 N 天 HH:MM · 晴/降雨%）；
  - **Search**（绿）：搜索框，实时过滤模块。
- 交互还原 Meteor：**左键点模块 = 开关**（开启项紫色高亮）、**列头可拖动**、
  底部提示条、GUI 开启时游戏键盘鼠标全部被拦（点空白不会锁视角也不会攻击），
  搜索框打字正常输入且不会让角色乱走。
- 键盘归属：RShift 归 GUI（游戏收不到，原版 RShift 无功能；左 Shift 潜行不受影响）；
  GUI 开启时 WASD/E/F3 等全部吞掉，Esc 关 GUI；GUI 关闭一切照旧。
- 数据源：时间与天气读 `game.worldTime`（tick→第 N 天 HH:MM，MC tick 0 = 06:00）
  和 `game.weather`（0~1 降雨强度）。

## v0.4.2 + 资源还原工具（2026-11-05）

- **抓取完整性再修正**：发现游戏音效是**真实文件**——http 模式运行时从
  `sounds/sfx/<name>.m4a` 下载（清单在动态加载的 `js/sound_events.js`，静态扫描抓不到）。
  已补抓：sound_events.js + **4849 个音效文件（51MB）全部下载成功**。音乐无实体文件
  （audio.js 开头注明背景音乐也是程序合成）。**最终清单：game.html + 91 个 JS +
  emoji.webp + 4849 音效 = 线上全部，抓取完成。**
- **源码备份**：`back/probe-snapshot-20261105/`（72M 完整快照，含音效）。
- **本地离线版全功能**：主脚本 @match 加入 `http://localhost:8777/*`——ESP/雷达/罗盘/
  夜视等所有功能在离线版同样生效（v0.4.2）。
- **资源还原工具**（`opus-resource-dump.user.js`，实验性）：游戏贴图全是运行时代码
  生成的（「every texture is made in code」），这个工具 hook WebGL 纹理上传管线，
  把游戏生成过的每张贴图记录下来导出 PNG；数据表导出 JSON。用法：
  1. Tampermonkey 安装本脚本，打开本地版或在线版进游戏；
  2. console：`__resDump.list()` 看抓到的纹理清单 → `__resDump.saveAll()` 批量导出 PNG
     （或 `save(id)` 单张）；`__resDump.texts()` 导出数据表 JSON；
  3. 进世界玩一会儿再导出更全（实体贴图/区块纹理是动态上传的）。
  注意：音效已有实体文件（sounds/sfx/），不需要 dump。

## v0.4.1 修复与改进（2026-11-05）

- **渲染循环挂钩（治大幅移动卡顿）**：ESP 原来用独立 rAF 循环，与游戏渲染各跑各的，
  读到的相机矩阵慢一帧——转视角时方框拖影。现在直接包装 `Game.prototype.render`：
  **游戏每帧渲染完立即画 ESP，零滞后**；挂不上（异构实现）自动退回 rAF 循环。
  `__opusHud.destroy()` 会还原挂钩。
- **3D 立体线框**：生物方框从 2D 屏幕包围矩形改为**投影 8 个角画 12 条棱**的彗星式
  立体框（底面 4 棱 + 顶面 4 棱 + 4 立柱），跟原版 F3+B 的 hitbox 形态一致。
- **铭牌「Mob」修复**：牛/羊这类生物不是独立类，都是通用 `Mob` 类挂种类字段——
  类名对照表大量失效。现改读实体原生的 `e.T` 类型数据：**游戏内置了 158 种生物的
  官方中文名**（ENTITY_DATA.types[*].cn：cow=牛、creeper=苦力怕、warden=监守者），
  直接显示，幼体加「幼年」前缀；敌我判定也改用 `e.T.hostive/passive` 原生标记。
- **铭牌太小**：生物标签升为 **14px 粗体 + 3px 黑描边**（亮背景/远处都清晰），
  血条加宽至至少 46px；物品标签 12px 粗体。
- **雷达/罗盘不显示的接线遗漏修复**：v0.4.0 里两个绘制函数写好了但忘了在渲染循环
  里调用——开关亮着画面却没有，就是它。已接线。

## v0.4.0 功能全量 + 抓取完整性审计（2026-11-05）

- **新功能**（全部菜单开关，配置记住）：
  - **实体雷达**：右下角圆形俯视图，玩家朝向为上，生物敌我分色点 + 掉落物黄点/
    经验球绿点/投射物橙点，半径随「ESP 距离」联动。
  - **方位罗盘**：顶部朝向刻度条（南/西/北/东 + 15° 刻度），绿色指针指当前朝向。
  - **物品与投射物 ESP**：掉落物/经验球/箭/火球/末影珍珠/TNT 等无血量实体画小点框
    + 中文名距离，独立于生物 ESP 开关。
  - **生物中文名**：60+ 类名→中文对照表（逐个对照 probe/js 类定义注释核对，
    Crawler=蠹虫、SulfurCube=硫磺方块、Nautilus=鹦鹉螺坐骑），标签优先显示中文。
  - **HUD 维度显示**：主世界/下界/末地。
- **抓取完整性审计**：重新备份线上原版 `game.orig.html`；全量扫描 90 个 JS 的文件
  引用，**补抓漏网之鱼 `js/emoji.webp`（116KB 表情贴图，被 emoji.js 引用）**；
  credits.json/end.txt/postcredits.txt/world.json 线上均 404（运行时走 MC_TEXTS
  内嵌数据，实体文件不存在）；favicon/manifest 404 不存在。
  **最终清单：game.html + 90 JS + emoji.webp = 线上可抓的全部，已 100% 抓齐。**
- **公告红字解释**：「不允许从这个网页访问」是 B 站服务端的来源校验（/api/news
  只允许 bilibili 域页面读取），本地版注定被拒——不是文件缺失。已在本地副本
  news.js 加域名守卫：非 B 站域跳过公告拉取，不再弹红字，单人玩法不受任何影响。
- 服务端功能（登录/公告/云存档/多人）在本地版不可用属预期，绕过校验不做。

## v0.3.3 修复与新增（2026-11-05）

- **框框不流畅**：游戏是 20Hz tick + 每帧插值渲染（`render(acc/50)`），方框原来读的
  是物理 tick 位置 `e.pos`，会 20Hz 跳变。现改用 `e.ipos(alpha)`（和游戏渲染同一插值
  参数），AABB 也按插值位置自算（`e.box()` 读的是未插值位置）——移动中的生物方框丝滑。
- **菜单点不到**：游戏在 window capture 上监听 mousedown，把**一切点击**变成指针锁定
  （main.js:72）——指针被锁定的瞬间菜单就点不着了。两路修复：开菜单时自动
  `exitPointerLock()`；菜单区域的 mousedown 在 capture 阶段就地拦截
  （`stopImmediatePropagation`，userscript 注册早于游戏脚本，拦得住）。关闭菜单后
  点一下游戏画面即恢复正常视角控制。
- **夜视（新开关）**：发现游戏渲染原生支持 `env.nightVision`（夜视药水路径，连
  shader 里都有）。菜单新增「夜视」开关，实现方式是替换全局 `nightVisionScale()`
  让强度恒为 1——走的完全是游戏自己的渲染路径，效果等同原版夜视药水满级。
- **本地版跳转真相（更正此前的说法）**：跳转代码不在 90 个 js 里，而是
  **game.html 第 219 行的内联脚本**——只要不在 iframe 里打开（本地直接开 = 顶层窗口），
  立刻 `location.replace` 回 B 站线上版。这是作者的防盗版守卫。本地副本已删除该行，
  现在 `http://localhost:8777/game.html` 就是终点，不会再跳。在线版不受影响
  （B 站 iframe 里 `self !== top`，守卫本来就不触发）。

## v0.3.2 修复记录（2026-11-05）

- **z 裁剪错杀（ESP 方框不显示的真正根因）**：`project()` 把裁剪空间的 clip.z
  当成 NDC z 按 [-1,1] 裁剪。透视投影下 clip.z 的正常范围是 -near ~ -far 的量级
  （几十到几百），按 [-1,1] 裁等于**只有约 1 米内的实体能显示**——表现为方框
  永远不出现、追踪线贴脸时偶尔闪一下、一走动就消失。已去掉 z 裁剪，只保留
  「相机后方」剔除（cw≤0），符合 ESP 宁多勿漏的语义。
- 关于「本地版跳转到 B 站」：**此前判断有误，已更正**——跳转代码是 game.html 内联的
  防盗版守卫（第 219 行，非 iframe 打开即跳回 B 站），js 文件里确实没有。本地副本
  已删除该守卫（v0.3.3 起），localhost 版不会再跳。
- 关于 GitHub 仓库：`github.com/Oppenheimerism/OpusCraft` 只是**参考架构**
  （另一个开源网页 MC），不是 OpusMC 的源码。OpusMC 闭源，我们的参考代码
  是 `probe/js/`（从线上抓的原文件），所有修改都在 userscript 里。

## v0.3.1 修复记录（2026-11-05）

- **双 frame 假实例**：Toy 外壳页（bilibili.com/toy/OpusMC）和游戏 iframe 是两个页面，
  脚本原来两边都注入 → 外壳那份「假实例」的菜单/HUD 叠在游戏上面，开关拨了
  却作用在一个没有游戏的页面（两边 localStorage 也是隔离的）。现在 boot 时检测
  `<canvas id="gl">`，只有真正的游戏页面才启动 UI。
  **操作要点：先点一下游戏画面（把键盘焦点给游戏），再按 L。**
- **ESP 画布 DPR 错位**：ESP 画布原来没有 CSS 拉伸，Windows 显示缩放不是 100% 时
  方框整体偏出屏幕。现已强制 `width/height: 100%`，与游戏画布同比映射，任意缩放都对齐。
- 修复后如果 ESP 开关是关的：进游戏按 L 重新拨一次（会记住）。

## 服务端 API 说明（回答「/api/account/* 拿得到吗」）

拿不到，也不可能拿到：`/api/account/*`、`/api/gate` 这些是跑在作者服务器上的
**服务端代码**，浏览器只收到 HTTP 响应，永远收不到服务端源码。客户端侧的调用方
（account.js、net.js、p2p.js、cloudsave.js）已在 probe/js 里，能还原「发了什么请求」，
还原不了「服务端怎么处理」。服务端没开源就没辙——主动攻击服务器属于未授权访问，
这条线不碰。**后果**：离线版单人玩法完整；多人联机依赖作者服务端，本地起不了。

## 离线版 vs 在线版怎么分辨

看浏览器地址栏：`localhost:8777` = start-game.cmd 起的本地版（断网可玩）；
`bilibili.com / bilibilitoy.com` = 在线版（你自己开的标签）。start-game.cmd 不会
打开任何 bilibili 地址。

## 如果没接入（降级策略）

- HUD 显示「还没抓到 player 引用…」并持续 5 分钟 → 自动发现失败。
  在游戏 iframe 的 console 里手动来：
  1. `__opusHud.setRef(game)` —— 直接把全局 game 递给它；
  2. 或 `__opusHud.sniffFillText()` 开启嗅探 → 玩两秒 → 看 `__opusHud.fillTextLog`
     （记录画出来的文字 + 调用源码位置）→ 去 Sources 定位 HUD 渲染函数 →
     断点断住后 `__opusHud.setRef(this)`。
- Console 记得把左上角「top ▾」切到 bilibilitoy.com 的 frame。

## 已知的坑

- **B 站更新游戏**：版本号路径会变（如 `…-v39426` 变 `-v39427`），但脚本 match 的是
  整个域，不受影响；真正会失效的是字段改名 —— 届时重新抓 `probe/js/` 对照。
- **probe/js/ 只是参考快照**（2026-11-05，v39426），游戏更新后以线上最新为准。
- **公平性边界**：坐标/FPS/血量/饥饿这类是原版 F3 就有的信息，属于显示增强；
  自动挖矿、自动战斗这类在联机房间里就是外挂，别做。

## 下一步可扩展

- 方位罗盘（读 yaw 画罗盘，注意弧度制）
- 实体雷达（扫 `game.entities` 画点位，OpusMC 的实体列表是平铺数组，比 OpusCraft 好读）
- 生物群系 / 维度显示（找 worldgen.js / dims.js 里的字段）
- 时间天气（`game.worldTime`、`game.weather`）
