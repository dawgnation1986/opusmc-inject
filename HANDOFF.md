# HANDOFF.md — Agent 交接文档

> 给接手的 AI Agent：本文档是 OpusMC 双协议客户端工程的完整交接。上一个 Agent（BigPixel）已耗尽本会话额度，修复工作从这里继续。**先读完本文档再动手**，所有关键信息（包括踩过的坑）都在里面。

---

## 一、项目是什么

用户（Rain，GitHub `dawgnation1986`）在折腾三样东西：

1. **OpusMC**：B 站 Toy 平台的网页版 Minecraft（闭源，作者 xingchen）。用户抓取了完整源码到 `probe/`（91 个 JS，未混淆）。
2. **PHPMC**：用户**自制**的 PHP Minecraft Java 1.8.9 服务端（协议 47，`PHPMC/` 目录，**源码在手**）。支持 TCP 25565 + **wss:24443 网页客户端通道**（`PHPMC/src/WebSocket.php`：eaglercraft 式设计，**WS binary 帧里封装的就是普通 MC 1.8.9 字节流**，协议无魔改）。
3. **目标**：让 OpusMC 网页客户端通过一个**双协议中转**连接 PHPMC 玩耍：`OpusMC 客户端 --ws--> 中转 --wss(MC1.8.9)--> PHPMC`。

另外还有一条已完成的支线：**userscript 辅助**（`opusmc-hud.user.js` v0.6.0，Tampermonkey）——ESP 3D 线框、雷达、罗盘、夜视、Meteor 式 ClickGUI（RShift）、来源伪装（GM_xhr hook fetch 伪装 Origin）、多房间服务器切换。**这条线已稳定，用户认可，别动它**。

## 二、目录地图

```
opusmc-inject/
├── opusmc-hud.user.js      # Tampermonkey 主脚本 v0.6.0（稳定，用户认可）
├── opus-mc18-link.user.js  # MC1.8 协议内核 userscript 版（已被 mc-proxy 取代，保留）
├── opus-resource-dump.user.js  # 资源导出工具
├── mods/                   # 独立 public 发布仓库的副本（git push 到 dawgnation1986/opusmc-mods）
├── probe/                  # 线上抓取的完整游戏（91 JS + game.html + emoji.webp）
│   ├── js/                 # 全部游戏源码（未混淆，net.js=多人协议层、screens.js=界面、game.js=主逻辑）
│   ├── game.html           # 启动页（已改：删防盗跳转、加 mc18.js 引用）
│   └── game.orig.html      # 线上原版备份
├── PHPMC/                  # 用户自制 PHP 服务端（源码在手，其中 src/Server.php 是 MC 协议权威）
│   ├── src/Server.php      # 5964 行，MC 协议收发全在这（发包字段=权威文档）
│   ├── src/Protocol.php    # VarInt/Frame 工具
│   └── src/WebSocket.php   # RFC6455 最小实现
├── tools/
│   ├── mc-proxy.mjs        # ★ 当前主战场：双协议中转（M1，调试中，见「卡点」）
│   └── fetch_sounds.py     # 音效抓取脚本
├── back/                   # 历史快照（只读，别改）
├── start-game.cmd          # 本地版启动（python http.server 8777 → probe/game.html）
└── README.md               # 项目 README（含全部版本历史记录）
```

## 三、mc-proxy.mjs 的协议细节（核心交接）

### OpusMC 客户端 ↔ proxy（「proxy 协议」）

**全部是 JSON 文本消息**（客户端 `NetClient.send(o)` = `JSON.stringify`），binary 帧是 proxy→客户端单向的区块下发。**客户端连上 ws 后等 proxy 先说话**（服务端先发 login——实测：客户端不发首条消息，proxy 必须主动）。

客户端**收**的消息类型（40+ 种，`case 'xxx'` 全表见 `probe/js/net.js` 153-293 行）：`login`（eid/dim/minY/mode）、`pos`（服务器定位）、`chat`、`time`、`health`、`rain`、`block`/`blocks`、`spawn`/`move`/`head`/`remove`/`hurt`、`players`、`signs`、`unload`、`kick`、`notice`、`error`、窗口类（open/win/wslot/cursor/wclose/prop/trades/pinv）、`held`/`effect`/`xp`/`death`/`equip`/`meta`/`collect`/`status`、`states`（方块状态表）、`biomes`。binary：chunk type 1 / light type 2（**布局定义就在 net.js 348 行开始的解码代码里**——proxy 写块数据时照这个格式打包）。

客户端**发**的消息：`tick`（**每帧**：`{t:'tick', pos:[x, y+minY, z, yawDeg, pitchDeg, onGround, collidedH], keys}`）、`chat`、`tpok`、`dig`、`held`、`drop`、`click`、`trade`、`creative`、`sign`。

### PHPMC 侧（MC 1.8.9 协议 47）

**无压缩**（PHPMC 不发 Set Compression）。PHPMC 发送集 = `src/Server.php` 顶部 `C_*` 常量表 + 每个 send 调用点（**发包字段顺序的权威文档**）。已知非标准处：

- **JoinGame (0x01) 比标准 1.8 多发一个 `bool reducedDebugInfo`**——解码必须补读这 1 字节，否则整个流错位 1 字节（**这个 bug 已经修过一次**：0x67/0x10 垃圾包全是它导致的连锁错位）。
- **ChunkData (0x21) 的 primaryBitmask 是 2 字节 short**（标准 1.8 是 varInt）——已按 PHPMC 实现适配。

### 中转结构（tools/mc-proxy.mjs）

- **ws 服务端**（8780，手写 RFC6455，模仿 PHPMC/WebSocket.php）接 OpusMC 客户端
- **wss 客户端**（手写 tls.connect + upgrade，rejectUnauthorized:false 过自签）连 PHPMC
- **MC 1.8 状态机**：handshake(0x00, proto47) → LoginStart(0x00) → LoginSuccess → Play
- **翻译层**（`mcToClient`/`clientToMc`）：JoinGame→login、Chat↔Chat、TimeUpdate→time、UpdateHealth→health、PosLook→pos、Disconnect→kick、ChunkData（M1 只统计，M2 翻译）、KeepAlive 由 proxy 自答（30 秒不回 PHPMC 踢人）
- 运行统计日志（10 秒一次）：客户端 tick 数/PosLook 转发数/MC 字节数

## 四、当前卡点（接手 Agent 的第一任务）

**实测已打通**：OpusMC 客户端 → 中转 → PHPMC wss → **登录成功**（PHPMC 日志：`登录 user=WebPlayer`、`进服 WebPlayer eid=124 at 0.5,63,0.5`）。

**卡点**：客户端 OpusMC 侧一直卡「正在连接… 区块: 0」，12 秒左右断开重连。中转日志显示**大量「未收录的 PHPMC 包 0x10」连锁错位**。

**根因分析**（日志+源码交叉定位）：
1. `0x67`/`0x70` 不在 PHPMC 发送常量表里 → 是**流错位后的误读垃圾**，不是真包。
2. 错位源 = **JoinGame 的 reducedDebug bool**（已修复提交）——**但修复后用户还没实测**，接手后先实测这一版。
3. 如果还有错位，按同样方法排查：**PHPMC JoinGame 处理函数（Server.php ~700 行）之后实际发送的包序列**逐一和 mc-proxy 解码表对照（`grep -n "self::C_\|->send(0x" Server.php`）。
4. 客户端 12 秒断开重连的原因：OpusMC 的 LoadingScreen 有超时（等不到区块就 fail）——**M2 做完区块翻译自然解决**。

**修复流程**（照做）：
1. 起 PHPMC（`PHPMC/start.ps1`，wss 24443）
2. `node tools/mc-proxy.mjs localhost 24443`（保持窗口开着）
3. 浏览器开 `http://localhost:8777/game.html` → 直接连接 → `ws://localhost:8780` + 玩家名 → 加入
4. 看中转日志：出现「未收录的 PHPMC 包 0xXX」时，到 `PHPMC/src/Server.php` grep `self::C_XXX` 找到该包的 send 调用点，按字段顺序在 `MC.decode` 补解码分支
5. 每次补表后 `node --check tools/mc-proxy.mjs` 验语法，让用户重连实测

## 五、M2/M3 路线图

- **M2（当前）**：区块翻译——PHPMC ChunkData(0x21) 解码（1.8 格式：groundUp+short mask+varInt size+data，区段 16×16×16 的方块数组+调色板）→ 转成 net.js 348 行期望的 chunk type 1 布局 → binary 帧发给客户端。**方块 id 映射**先查 `probe/js/blockdata.js` 的 id 字段是否与 1.8 数字 id 一致（OpusMC 是仿 MC 实现，很可能一致或接近）。
- **M3**：位置（tick→0x06 已通）、挖掘（客户端 dig→MC 0x07 Player Digging）、放置（→0x08）、实体（Spawn Mob→客户端 spawn 消息）、背包/窗口（翻译量大，放最后）。
- 完成后 OpusMC 就是「**带 ESP 的网页客户端连任意 1.8.9 服务器**」。

## 六、其他已知事项

- **userscript 线**：v0.6.0 稳定。已知小问题：雷达显示尺寸曾异常铺满全屏（v0.6.1 已加 CSS 钉死+radarSize 自愈钳制，待用户验证）。
- **游戏源码已改的 3 处**（probe/）：`game.html`（删防盗跳转+加 mc18.js 引用——mc18.js 引用可以删了，mc-proxy 取代它）、`js/screens.js`（多人按钮跳过 onlineGate）、`js/net.js:1270`（gate 错误不再弹登录屏，改为显示提示）。
- **来源伪装**：`installOriginSpoof()` hook fetch，honghemc.cn 请求伪装 Origin=B 站 Toy（GM_xhr）。**实测：HTTP 层通了**（PHPMC 日志确认登录成功），说明服务端校验的就是 Origin——**这个方案有效，保留**。
- **PHPMC 源码是用户自制的**，用户在持续开发它（git status 里有用户自己的未提交修改——**别动 PHPMC 里用户改的东西**）。
- **git**：两个仓库——主仓库 `dawgnation1986/opusmc-inject`（private）、发布源 `dawgnation1986/opusmc-mods`（public，只放 3 个 userscript）。用户 token 已泄露过一次（ghp_VI3go…），**已提醒撤销**；推送用一次性 URL，token 不落 config。
- **用户偏好**：说中文、口语化、直接给结论；改版必须递增版本号（显示在 HUD 标题「OpusHUD vX.X.X」）；python 手术的 old 字符串必须先 grep 实际内容再写（凭记忆拼会连续翻车）；改完要 commit 并推送到 mods（userscript 线）或主仓库（游戏源码/工具线）。

## 七、约定与红线

- 不伪造服务端凭证对抗授权（来源伪装 OK，因为它只是让用户自己部署的副本获得和他本来就有权使用的在线版同等待遇；token 签名类伪造不碰）。
- ESP 类辅助**仅限单人/自用服务器**，多人公开房间别开（脚本 GUI 页脚有提示）。
- 不往 C 盘写任何东西（用户硬约定）。
- 每次改 userscript 递增版本号并推 mods 发布源；改游戏源码/工具提交主仓库。

## 八、0x21 卡点已破 + 客户端侧大修（2026-11-06 23:40 收官）

**根因（一坑两处）**：VarInt 解码位移 bug——解码循环里每轮 `++shift`（只 +1 位），应为 `shift += 7`。
单字节 VarInt 不受影响（M1 登录全通的原因），首个 ≥128 字节的包（0x21 区块 61711B）
立刻错位成 207。drainMc 读包长与 Reader.varInt 两处同修。

**客户端侧三大补丁**（此前 OpusMC 真客户端从未握上手）：
1. wrapServerSocket 补 HTTP 升级（浏览器 WS 先发 GET 等 101）
2. hello 握手：等客户端 {t:'hello',name} 才 connectMc(name)，替换固定 WebPlayer
3. wsDecode 多帧拼接会砸坏 JSON —— 客户端侧改逐帧分派（PHPMC 侧字节流保持拼接语义）

**实测（模拟客户端 test-opusclient.mjs）**：states 4096 项、biomes 256、login、
chat、49 区块 1.7MB 零异常、abilities/health/time 全通。

**按《服务端-客户端协议清单.md》对齐**：0x21 mask i16→u16、0x15 补 onGround bool、
0x29 双占用断言、dig/drop→0x07、block/respawn/abilities/time 下发、BLOCK_NAMES 补
16 色系与杂项。PHPMC C→S 以 Server.php handlePlay 为准（0x05=Look 0x06=PosLook，
与 wiki 相反，勿改）。

**一键启动**：launch-play.bat（PHPMC→mc-proxy→静态服→Edge），游戏内
多人→直接连接→默认 ws://localhost:8780 回车即进。
观察工具：mc-observe.mjs（TCP/wss 双模式看真实包流）。
