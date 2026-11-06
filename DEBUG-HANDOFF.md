# OpusMC 网页客户端 ↔ PHPMC 中转：地形渲染错位问题交接文档

> 写给下一个接手的模型/人。本项目的协议翻译已经打通 95%，只剩「网页客户端渲染出的地形与
> PHPMC 真实世界不符（方块稀疏/悬空/错落）」这一个问题。请先读完「已验证事实」再动手，
> 那些结论都花了实测成本，别推翻重查。

---

## 1. 三分钟背景

- **目标**：让 OpusMC（B 站 Toy 平台的网页版 MC，源码未混淆，本地副本在 `probe/`）通过
  中转连接用户自制的 PHP MC 1.8.9 服务端（`PHPMC/`，协议 47，TCP 25565 / wss 24443）。
- **中转**：`tools/mc-proxy.mjs`（Node，零依赖）。方向：
  `OpusMC 网页客户端 --ws://localhost:8780--> mc-proxy --wss://localhost:24443--> PHPMC`
- **协议形态**：
  - OpusMC 侧 = JSON 文本帧（`{t:'tick'|'chat'|...}`）+ 二进制帧（chunk type1）
  - PHPMC 侧 = MC 1.8.9 原始字节流（binary WS 帧内，VarInt 分帧）
  - mc-proxy 双向翻译
- **权威文档**：
  - `../服务端-客户端协议清单.md` —— 用户写的 PHPMC 发包清单（clientbound 全表 + 坑点）
  - `PHPMC/src/Server.php` —— C→S（handlePlay，1349 行起）与 C_* 常量的**唯一权威**
  - `probe/js/net.js` —— OpusMC 客户端协议实现（onMessage / onBinary 的 case 就是消息字典）
- **启动**：双击 `launch-play.bat`（PHPMC→mc-proxy→静态服 8777→Edge）。
  游戏内「多人游戏 → 直接连接」默认地址就是 ws://localhost:8780。

## 2. 当前状态（2026-11-07 01:00）

**已通**（模拟客户端 + 用户真机双端实测确认）：
登录/JoinGame、聊天、保活、位置回传、血量、时间、能力值、经验、
区块下发（实测 49~376 个，字节数稳定 33-41KB/个）、
玩家名单（0x38→players）、玩家/生物生成（0x0C/0x0F→spawn，19 种生物映射）、
实体移动（0x15-0x18 相对移动累计→绝对 move）、销毁（0x13）、头部朝向（0x19）、
方块变化（0x23→block）、卸载区块、下雨（0x2B）、受伤红闪（0x1A）、挥手（0x0B）。

**未通（本题）**：网页客户端渲染出的地形与 PHPMC 真实世界**不符**——
方块稀疏、成簇悬空、大量空洞；Java 客户端（TCP 直连 PHPMC）同世界渲染正常。

## 3. 已验证事实（不要重查）

1. **VarInt 解码曾有位移 bug（`++shift` 应为 `shift += 7`）**，已修两处
   （drainMc 读包长 + Reader.varInt）。修复后包长 61711 正确，区块流完全对齐。
   —— 这条是历史，仅提醒：**任何新写的 VarInt 解码都要自查这一条**。
2. **chunkToOpus 的输出与 PHPMC 原始区块数据逐方块一致**：
   `tools/verify-chunks.mjs` 连 TCP 25565 收 0x21，跑与 mc-proxy 相同的翻译，
   再按 net.js onBinary 的读取规则**逆解**，与 PHPMC 原始 (id<<4|meta) 逐方块比对，
   40 个区块 4096×40 方块**零差异**。逆解还校验了「恰好消费全部字节」。
3. **palette=1 的段不写 4096B 索引数组**是 OpusMC 的格式约定（net.js onBinary 里
   `if (len > 1)` 才读 idx），chunkToOpus 已遵守；palette>256 时写 u16 索引也已支持。
4. **states 消息（4096 项方块名）与 biomes（256 项）确实到达客户端**
   （模拟客户端确认收到），且在 login 之前发送（net.js 的 login 会清 chunk 队列，
   顺序错了会丢区块，已确认没踩）。
5. **net.js onBinary 的解析规则**与 chunkToOpus 的写入顺序已逐字节人工核对一致：
   `[u8 type][i32LE cx][i32LE cz][u8 n]` + 每段
   `[u16LE paletteLen][u16LE palette×len][u8 索引×4096（len≤256）/u16×4096（>256）；len==1 时整段省略索引]`
   `+ [u8 flags(bit0 sky,bit1 block)][sky 2048][block 2048]` + 尾部 `[u8 群系×256]`。
6. **PHPMC 区块段布局**：每段 8192B（4096×u16 LE，(id<<4)|meta）+ 2048 blockLight
   + 2048 skyLight；mask=0 的段不写任何数据；groundUp=true 时尾部跟 256B 群系。
   （协议清单 §3 里「4096 字节 Blocks」指的是 4096 个方块条目，实际 8192 字节。）
7. **Java 客户端连同一 PHPMC 渲染正常** → PHPMC 的区块数据布局是标准 1.8，数据源没错。
8. **用户实测：双端能互见玩家/生物**（实体链路 OK），区块在跟随玩家下发
   （日志见「区块已翻译下发 N」持续增长，351/376 个）。
9. **net.js 1951 行把 onBinary 套了帧队列**（drainChunks 按帧预算消化），
   login/respawn 会清队列。已确认 mc-proxy 的发送顺序（states→biomes→…→login→chunks）
   不会触发清队列丢数据。
10. **0x35 Update Tile Entity**：PHPMC 的 NBT 是 named root（`0x0A + u16 名长 + 名字 +
    entries + 0x00`，见 `PHPMC/src/Nbt/Nbt.php:182`），skipNbt 已加根名字跳过。
    **但该修复未经实测**（出生点无箱子区块，0x35 无法在本地复现；需要玩家走到
    有箱子的区块，用户日志里的位置有）。

## 4. 现象细节（重要）

- 网页端渲染的方块**不是随机噪声**，而是「真实方块的一部分」：泥土、雪、石头
  （用户存的图里能看到雪坡、泥土层），但**缺失大量相邻方块**，呈
  「成簇悬空/斜向阶梯/大片空洞」状。像「一部分 section 渲染了、一部分被当成空气」。
- 同一时刻 Java 端一切正常。
- 两个客户端当时**不站在同一坐标**（用户先在 Java 端跑了一圈），所以
  **「两端同坐标对比」还没有做过**——这是第一个该做的实验。
- 用户网页端 F12 控制台的**红字报错与 missing 名单尚未采集**
  （net.js 里 `console.error('net', err)` 是 onBinary/onMessage 的异常出口；
  `game.net.missing` 是 mapVanillaStateNear 失败的名字统计 Map）。

## 5. 嫌疑排序（按可能性）

### 假设 A：地形其实是对的，只是「没加载完 + 两端位置不同」的观感
- 证据：用户 F3 显示「区块:44 视距:6 已生成:132」，视距 6 应有 169 个，还在加载；
  客户端把 chunk 解码摊到每帧（drainChunks 预算），1281 tick 才追平。
- **验证（5 分钟）**：两端站在**同一坐标**（Java 端 `/tp Steve511` 或网页端走过去），
  同视角截图对比。若一致 → 结案，剩下的只是加载速度体验。

### 假设 B：onBinary 抛异常导致部分 chunk 解析中断（每次中断丢整块）
- net.js 的 `putSection` 有 `if (!solid) return;`（整段无 solid 方块就整段丢弃——
  水面段/花草段**故意不渲染**），`ch.bs[s]` 的写入还有 `ids.length > 256` 的分支。
- **验证（10 分钟）**：网页端 F12 控制台过滤 `net`，在区块加载高峰时看有无
  `Index out of range` / `undefined` 类异常；有异常则栈指向的行就是真相。

### 假设 C：states 表里仍存在映射为「非预期方块」的条目
- `pal[i] = map[raw] || 0`：map 的值是 OpusMC 自己的 `(id<<8|meta)`。
  BLOCK_NAMES 表最近刚补过 meta 变体（树叶/花草/台阶/沙石/石头系），
  **新加的名字如果有拼写错误**（如 `cut_sandstone` 在 1.8 叫 smooth_sandstone、
  `short_grass` 在 1.8 的名是 `tallgrass`——不过客户端有 nearNames 兜底，
  理论上不失败），map 出来的方块就会「渲染成别的东西」而不是缺失。
- **验证（5 分钟）**：控制台跑
  `[...(game.net.missing||new Map()).entries()].slice(0,30)`
  以及抽查 `game.net.stateMap[701]`（0x2BD 区块里出现过的 raw）。

### 假设 D：PHPMC 的 0x21 后续包（mask 相同的更新）被当新 chunk 全量重建
- mc-proxy 对每个 0x21 都发 type=1（新建）。PHPMC 在玩家移动后会**重发**
  视距内区块吗？（日志显示下发编号持续增长到 376，可能有重发）
  type=1 会 `new Chunk` 全量重建 → 闪烁/回退，但不会「稀疏」。
- **验证**：在 mc-proxy 里对 0x21 的 (cx,cz) 做去重日志，看同一区块是否多次下发。

### 假设 E：wss 流与 TCP 流在 PHPMC 端有差异
- 理论上 Connection::send 一帧一包无分片，但 wss 路径多一层 TLS。
  verify-chunks 只验证过 **TCP 25565** 路径的原始数据。
- **验证（20 分钟）**：把 verify-chunks.mjs 加 wss 模式（抄 mc-proxy 的 connectWss），
  对同一 (cx,cz) 双路径各收一次 0x21，逐字节比对。

## 6. 工具清单（都在 opusmc-inject/tools/）

| 文件 | 用途 |
|---|---|
| mc-proxy.mjs | 中转本体（带 0x35 hex dump，`MCPROXY_DEBUG=1` 开帧级日志） |
| test-opusclient.mjs | 模拟 OpusMC 客户端（hello 握手 + tick），统计各消息收包数 |
| mc-observe.mjs | 直连 PHPMC 的包流观察器（`TCP=1` 走 25565，否则走 wss 24443） |
| verify-chunks.mjs | **内容级验证**：翻译→逆解→与 PHPMC 原始数据逐方块比对 |
| launch-play.bat | 一键启动 PHPMC→mc-proxy→静态服→Edge |
| launch-offline.bat | 只启动离线单机（无 PHPMC） |

## 7. 协议速查（易错点浓缩）

- PHPMC C→S（handlePlay，以源码为准）：0x05=**Look**、0x06=**Position And Look**
  （与 wiki 1.8 相反！）；0x07 digging 的 status 3/4=丢物品；只实现了 0x00-0x08。
- 1.8 clientbound：0x1A 的 eid 是 **int**；0x0C 带 uuid 16 字节；0x21 的
  primaryBitMask 是 **ushort**；0x35 的 NBT 是 named root（无 present 字节）；
  0x29 同时是 Spawn Painting 和 Sound Effect（PHPMC 只发画）；
  DataWatcher 字节 = `(type << 5) | index`，结束符 **0x7F**；
  Slot：short id（-1=空）+ byte count + short dmg + **nbtPresent byte**（item 的才有）。
- NBT：named root（type + u16 名长 + 名字 + entries + 0x00），名字是 big-endian u16。
- OpusMC chunk type1 见 §3 第 5 条；palette 值 = (id<<4|meta)，
  是 `states` 消息 4096 项数组的下标，客户端用 `mapVanillaStateNear` 映射到自己的方块。
- OpusMC 的 JSON 消息字典：客户端→服（hello/settings/tick/held/dig/chat/click/
  creative/drop/trade/sign/tpok）；服→客户端（states/biomes/login/respawn/pos/
  abilities/mode/time/rain/chat/unload/signs/block/blocks/players/spawn/move/head/
  remove/anim/hurt/pass/vmove/open/win/wslot/cursor/wclose/prop/trades/pinv/held/
  effect/uneffect/health/xp/death/equip/meta/collect/…，全文见 net.js onMessage）。

## 8. 约定红线（用户偏好，务必遵守）

- **只往 D 盘写文件**；不往 C 盘写任何东西。
- **同文件多处修改用 python 补丁脚本一次落盘**，old 串**必须先 grep 实际内容**；
  patch 内容含反引号/反斜杠时绝不能内联在 bash 的 `python3 -c "..."` 里（会被
  命令替换篡改），一律写成 .py 文件执行。
- 改完必跑 `node --check`；涉及区块必须跑 `verify-chunks.mjs`（内容级）。
- 每次编辑要带版本号/可观察标记，用户靠它确认更新生效。
- push 失败（代理 502）不用反复重试，本地 commit 安全，网络恢复再推。

## 9. 下一个人该做的事（按顺序）

1. **假设 A 的同坐标对比**（5 分钟）——大概率直接结案或大幅收窄。
2. 采集网页端 F12 红字 + `game.net.missing`（假设 B/C 的现场证据）。
3. 若 1、2 无果，跑假设 E 的双路径比对（把 verify-chunks 加 wss 模式）。
4. 0x35 的修复（skipNbt 跳根名）需要站在箱子区块实测确认。
5. M4 候选：容器/背包 GUI 翻译（0x2D/0x2F/0x30 → open/win/wslot，协议清单 §8 有
   slotCount 反直觉约定：工作台/铁砧/酿造台/附魔台必须给 0）、村民交易、
   附魔 NBT 透传（PHPMC 有看门狗在保附魔，别把它喂丢了）。
