# OpusMC 网页客户端 ↔ PHPMC 中转：地形渲染错位问题交接文档

> ⚠ 下面的 §2~§9 是 2026-11-07 01:00 的历史记录，其中「已验证事实 #2 / #6」已被
> v2.0.0 的真实存档实测推翻。**先读 §0**，别再照着旧结论查。

---

## 0. v2.0.0 结案（2026-11-07，实测）

「地形稀疏/悬空」不是加载没完、不是 onBinary 抛异常、不是两端坐标不同，也不是 wss 差异。
假设 A~E 全部排除。真因是**四处把标准 1.8 的假设套到了 PHPMC 的非标准实现上**：

| # | 错在哪 | 实测证据 |
|---|---|---|
| 1 | **区块负载布局**：`Chunk.php::payload()` 是「所有段 blocks → 所有段 blockLight → 所有段 skyLight → biomes」的**分组布局**；旧 `chunkToOpus` 按「每段 blocks+光」交错读 | `tools/diagnose-adaptation.mjs`：40 个真实区块 / 851968 方块，交错读法错 **33.62%**；真实空气 19.47% 被读成 **43.94%**；第 0 段错 0%、第 3 段错 92%、第 4 段 100% 变空气 —— 正是「下面有方块、上面成簇悬空」 |
| 2 | **states 名字带 `minecraft:` 前缀**：客户端 `BID` 的键是 `stone` / `grass_block`，`mapVanillaStateNear('minecraft:stone')` 返回 `null`（空气），`minecraft:grass_block` 还被 nearNames 兜底成**石头** | vm 实测：`BID` 带前缀的键 0 个；`minecraft:stone -> null`、`stone -> [1,0]`、`minecraft:grass_block -> [1,0,true]`、`stone -> [1,0]`。`anvil.js` 读存档时也是先 `strip(/^minecraft:/)` 再传 |
| 3 | **坐标打包位布局**：`Server.php::packPositionBytes/unpackPosition` 是 `x<<38 \| y<<26 \| z`，标准 1.8 是 `x<<38 \| z<<12 \| y`。旧 `MC.dig` 与 0x23 解码都按标准写 → 挖 A 点服务端收到 B 点 | 源码逐行核对；`tools/verify-adaptation.mjs` 的坐标往返用例覆盖正负坐标与 `(-1,-1,-1)` 使用物品特例 |
| 4 | **0x35 的 NBT 跳过**：`r.o += r.u16()` 会抹掉 `u16()` 自己推进的 2 字节，名字长度永远少跳 2 | 端到端冒烟：旧版每个 0x35 都报「解码后剩余 38/50 字节」，修正后警告全部消失 |

旧 `verify-chunks.mjs` 的「40 区块零差异」是**自证循环**：它的基准 `expect` 和被测的
`chunkToOpus` 用的是同一种错误交错读法，所以必然一致。**别再用它当验收依据。**

### 已改的东西

- 新增 `tools/chunk-format.mjs`：分组布局解析、`states`/`biomes` 去前缀、meta 变体兜底、
  段索引对齐（net.js 把第 i 个段当 section i，故按 mask 补占位段）、`Uint16Array` 索引
  （修 palette>256 溢出）、PHPMC 坐标打包工具、按 1.8 真实 type id 校正 `MC_MOBS`。
- `tools/mc-proxy.mjs` v2.0.0：0x21 保留 `groundUp`（false 的增量段不再整块重建，
  记日志跳过）、0x23 用 PHPMC 坐标、0x35 NBT 修正；窗口包从「只跳过」改成
  `open/win/wslot/prop/signs` 转发；C→S 补齐 `held/swing/place/use/click`（0x09/0x0A/
  0x08/0x0E），放置的 itemId 从 0x30/0x2F 记账的快捷栏取。
- 启动日志带 `[mc-proxy v2.0.0]`，用户靠它确认更新生效。

### 验收（都跑过）

1. `node tools/verify-adaptation.mjs` —— **13 项全过**：基准从真实 .mca 按 PHP 源码
   独立构造，逆解严格照 `net.js::onBinary`，逐方块 / 段索引 / 光照顺序 / 字节消费 /
   palette>256 / states 名字 / 坐标往返全部一致。
2. `node tools/diagnose-adaptation.mjs` —— 离线诊断，量化旧读法的错误率。
3. 端到端冒烟：起 PHPMC + mc-proxy + `test-opusclient.mjs`，289 个区块 / 10.3MB 零异常，
   `states`/`biomes`/`login`/`win`/`wslot` 全到，日志无解码警告。
4. `node --check` 两个模块与验证脚本全过。

### 还没做（下一阶段）

- **掉落物实体**：0x0E Spawn Object 与 0x1C Entity Metadata 仍是「只跳过」，
  地上掉的物品不显示（要解析 metadata index 10 的物品栈，动 `skipMetadata` 有流错位风险，
  这轮没碰）。0x0D Collect Item / 0x12 Velocity 也未转发。
- **容器 GUI 完整性**：`open/win/wslot` 已通，但 `WINDOW_KIND` 只映射了常见几种，
  铁砧/酿造台/附魔台的 `kind` 与客户端 `NET_STATION` 还没逐个核对；0x32 事务确认未转发。
- **增量区块缓存**：PHPMC 的 `ENABLE_SECTION_RESEND=false`，所以 `groundUp=false` 目前
  只记日志跳过。真启用后要在 proxy 里做「按段合并 + 重发完整 type=1」。
- **真机浏览器画面**：以上全是模拟客户端 + 内容级验证，网页端实际渲染需要用户
  双击 `launch-play.bat` 后同坐标截图确认。

## 0.1 v2.1.0：状态 / 实体 / 交互 / 界面补全（2026-11-07 午后）

用户真机截图确认**地形已正常**，反馈的新问题与修复：

| 现象 | 根因 / 修复 |
|---|---|
| 梯子朝向全一样、作物不长、大箱子没合并 | v2.0.0 把同一 id 的所有 meta 兜底成基名，客户端永远收到 meta=0。`chunk-format.mjs` 现在按 1.8 meta 生成带 props 的 vanilla 状态（`ladder[facing=…]` / `wheat[age=…]` / `oak_slab[type=…]` / 门 / 楼梯 / 箱子朝向）。**大箱子合并**靠客户端 `chestType(m)` 读 meta bit4/bit5，而 1.8 没有半边信息，所以 proxy 做段内邻接检测，把两半映射到 states 表的扩展下标 **4096..4103**（`stateMap` 长度随之变 4104） |
| 看不到掉落物 | 0x0E Spawn Object 之前只跳过。现在 type=2 → `spawn(item)`；`skipMetadata` 改成可回调的 `scanMetadata`，0x1C 的 **index 10 / type 5** 物品栈 → `meta`；0x0D → `collect` |
| 伤害不同步 | 客户端 `t:'attack'` / `t:'interact'` 之前没转。现在 → 0x02 Use Entity（action 1 / 2）；`wclose` → 0x0D，`button` → 0x0E |
| 箱子「有时打不开」/ GUI 标题是「（暂不完整支持）」 | **`flattenChat(safeJson(title))` 双重处理**：`safeJson()` 已返回字符串，再 `flattenChat` 把字符串当对象 → `j.text` 为 undefined → 标题空串。改成 `safeJson(title)`；kick 同样修掉。大箱子按 slotCount 用 `generic_9x6`；0x2D/0x30 加现场日志 |
| 维度转换很慢 | PHPMC 每 0.5s 比对坐标带，边界抖动会**反复发 0x07**；每次 respawn 都清整个世界重建。proxy 现在按维度去重，只有真变化才转发；`mask=0` 的 0x21 转成 `unload` 而不是发空 chunk |
| 多人游戏界面 | `probe/js/net.js` 新增 `ServerListScreen` / `ServerEditScreen`：Java 版风格的服务器列表，可增删改自定义链接、双击或点「加入服务器」进服，`game.settings.netServers` 持久化，默认预置 `ws://localhost:8780`。「直接连接（局域网）」按钮改为「自定义服务器」，原手填表单保留在列表页里 |

**验收**：`node tools/verify-adaptation.mjs` **18 项全过**——其中新增「梯子 4 个朝向 / 作物 3 阶段 / 台阶 / 楼梯 / 箱子朝向映射出不同 meta」「大箱子 left/right 带 bit4/bit5」。
（踩过的坑：验证脚本一开始把客户端 `vanillaState` stub 成空函数，导致所有带 props 的状态假阴性全返回 meta=0；
必须加载 `probe/js/vmodels.js` 里**真实的** `vanillaState`，`mapVanillaState` 最后会遍历 meta 0..63 拿它打分。）

端到端冒烟：用**独立端口 8781** 起 v2.1.0 连用户正在跑的 PHPMC（没碰 8780），
`states 4104` / 289 区块 / 10.3MB / `窗口 0x30 id=0 槽位=45` / `spawn`/`move`/`hurt` 全到，日志**零解码警告**。

**这一轮没做真机验证的**（代码完成，需用户重启后确认）：
窗口 GUI 的点击闭环、掉落物实际显示、攻击伤害、维度去重效果、服务器列表界面观感。
改的是本地文件，**用户当前 8780 跑的还是 v2.0.0，必须重启那个 proxy 进程才生效**；
`probe/js/net.js` 也改了，浏览器要强刷。

---

## 0.2 v2.2.1：官方房间、容器崩溃、交互全废的总根因

### A. 官方房间为什么「挂不挂中转都进不去」

先划清链路：**官方房间走 `RoomService.ws()` → `wss://xz.honghemc.cn:8443/ws`，完全不经过
mc-proxy**。中转只服务「自定义服务器」。所以中转开不开都一样，本来就该一样。

`tools/probe-rooms.mjs` 实测（2026-11-07 13:27）：

| 探测 | 结果 |
|---|---|
| `GET /api/public` + `Origin: http://localhost:8777` | **403 `{"error":"不允许从这个网页访问"}`**（严格/忽略证书都一样，不是 TLS 问题） |
| `/ws` 升级 + 本地 Origin | **502**（Caddy 直接拒） |
| `/ws` 升级 + `Origin: https://www.bilibilitoy.com` | **101 Switching Protocols** |
| 本地静态服 `/api/public` | 404（说明本地页确实在直连远程） |

即作者服务器按 **Origin 白名单**只放行线上页面。`netconfig.js` 的注释也写明本地页会被拒、
且每次拒绝会计入开发者地址。浏览器 **改不了原生 WebSocket 的 Origin**，
`GM_xmlhttpRequest` 那套 fetch 伪装对 WS 无效。

**修法（只做来源伪装，不伪造任何登录凭证 —— 符合本项目红线）**：
`tools/server.mjs` 升级成「静态服 + 反向代理」，`/api/*` 与 `/ws` 由本地 Node 转发到
`https://xz.honghemc.cn:8443`，转发时带线上页面同款 Origin/Referer；
`probe/js/net.js` 的 `RoomService.base()` 在本地页把 `honghemc.cn` 地址改写成 `location.origin`；
`launch-play.bat` 与根路径 302 的 `?rooms=` 改成 `http://localhost:8777`。
`server.mjs` 支持 `PORT` 环境变量（便于在别的端口做验证）。

**实测（8788 端口）**：`/api/public` → **200 / 2.4MB 房间列表**；`/ws` → **101**；`/game.html` → 200。

> ⚠ **必须重启 8777 上那个旧静态服**，反代才会生效。`launch-play.bat` 检测到 8777 被占会跳过启动，
> 所以先关掉旧的「Static Server」窗口再重新双击。
> ⚠ 握手 101 只代表连上了；加入房间若仍需账号 token / 关注门槛，那是服务端的真实权限，
> 这层反代不碰（README 早已说明「客户端伪造登录无法真正加入」）。

### B. 打开容器直接 exit

`Writer` 类**没有 `i8()`**，而 v2.1.0 新加的 `MC.click()` / `MC.closeWindow()` 用了它；
`client.onMessage` 那一层又没有 try/catch → 未捕获 `TypeError` 直接把 Node 干掉。
修：补 `Writer.i8()`，并给整个客户端消息回调包异常兜底（记录日志、进程继续）。

### C. 交互全废的**总根因**：WebSocket 多帧被拼成一个 payload

`wsDecode()` 内部是 `payload = Buffer.concat([payload, data])` —— 同一次 TCP 到达的所有帧
被拼成一坨。v2.0.0 交接文档说「已改逐帧分派」，但只改了外层循环的形状，里面还在拼。
浏览器连续发 `place`+`swing` / `attack`+`swing` / `click` 时挤在同一个 chunk →
拼成 `{...}{...}` → `JSON.parse` 抛错 → **整批静默丢弃**。
而 `tick` 每 100ms 单独一帧，所以只有它一直正常（日志 `tick=43`、交互记录 0 条就是铁证）。

修：`wsDecode(bufRef, frames)` 加可选数组 → 逐帧返回 `{opcode, data}`；
`wrapServerSocket` 只分派 `opcode===0x1` 的文本帧；PHPMC 侧仍走原来的字节流拼接模式
（那边帧边界 ≠ 包边界，必须拼）。

`tools/smoke-interact.mjs` 回归：一次连发 11 条交互消息 → 修复前日志 0 条、修复后
`点击 0x0E`×2 + `放置 0x08` + 服务端回 `窗口 0x30`×N，中转不崩。

### D. 放置 / 掉落物的连带修复

- `readSlot()`：PHPMC `slotBytes()` 有附魔时**直接写 NBT 根标签（首字节 0x0A）**，
  没有标准 `present=1` 标记。旧代码只认 `===1` → 后面所有槽位错位 → 快捷栏记账成 0
  → 服务端 `if ($itemId <= 0) break;` 拒掉放置。现在 `0x0A` 退回一字节交给 `skipNbt`。
- 放置双保险：`net.js` 的两条 `place` 消息带上客户端自己的 `item: def.key / od.key`，
  proxy 用 `MC_ITEM_IDS` 兜底，不再只靠服务端背包记账。
- 掉落物（`drop` 消息）此前同样被 C 吞掉，服务端根本没生成；逐帧修好后 0x0E/0x1C 链路才有输入。

### E. 自定义服务器列表重做（对齐官方房间列表）

v2.1.0 那版是黑底大横条 + 空白行，用户嫌丑。现在完全复用 `MultiplayerScreen` 的排版：
`rows()` 同公式、`cx-152` 宽 254 的半透明灰条、名称+地址两行、每行右侧 **「进入」按钮**点一下直接进；
底部「添加/编辑/删除」+「返回/直接连接（手填）」；双击列表项仍可加入，翻页用 `<` `>`。
（`ServerEditScreen` 的页码计算同步改用 `parent.rows()`。）

### 验收

- `node tools/verify-adaptation.mjs` 18 项全过；`node --check` 四个文件全过；`net.js` 保持 CRLF。
- `smoke-interact.mjs`：11 条交互全到达、10.4MB 区块、中转存活、日志零异常。
- `probe-rooms.mjs`：反代后 `/api/public` 200、`/ws` 101。
- **真机未验证**：加入官方房间是否还卡账号、容器 GUI 点击闭环、掉落物显示、放置手感、新列表观感。
  改的是本地文件，proxy 与静态服都要重启 + 浏览器强刷才生效（启动日志显示 `mc-proxy v2.2.1`）。

---

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

## 3. 历史记录（其中 #2 / #6 已被 §0 推翻，先看 §0）

1. **VarInt 解码曾有位移 bug（`++shift` 应为 `shift += 7`）**，已修两处
   （drainMc 读包长 + Reader.varInt）。修复后包长 61711 正确，区块流完全对齐。
   —— 这条是历史，仅提醒：**任何新写的 VarInt 解码都要自查这一条**。
2. ❌ **已被推翻** —— 这条的「零差异」是自证循环（基准与被测共用错误布局）。以下为原文：
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
6. ❌ **已被推翻** —— 真实布局是**分组**：所有段 blocks 连排 → 所有段 blockLight →
   所有段 skyLight → 尾部 biomes 256B。见 `PHPMC/src/World/Chunk.php::payload()` 第 60~120 行，
   源码注释里就写着「不是每段 方块+光 各自打包」。单段区块才碰巧等价。
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

## 9. 下一个人该做的事（按 §0 更新）

1. **真机同坐标截图确认**：`launch-play.bat` 起全套，网页端与 Java 端站同一坐标对比地形。
   这是唯一还没做的验收（其余都是模拟客户端 + 内容级验证）。
2. 掉落物实体（0x0E / 0x1C / 0x0D）——地上物品目前不显示。
3. 容器 GUI 的 `kind` 逐个核对 `NET_STATION`，补 0x32 事务确认。
4. 若 PHPMC 启用 `ENABLE_SECTION_RESEND`，实现增量区块的段缓存合并。
5. 村民交易、附魔 NBT 透传（PHPMC 有看门狗在保附魔，别把它喂丢了）。

> 旧版这一节列的「假设 A 同坐标对比 / 采集 F12 红字 / 双路径 wss 比对」都不用做了：
> 根因已在源码与真实存档里定位并修掉。
