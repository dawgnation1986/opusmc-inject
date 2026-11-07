# -*- coding: utf-8 -*-
# patch_v221_docs.py — DEBUG-HANDOFF.md 补 §0.2（官方房间 / 崩溃 / 逐帧 / 放置 / 界面）
import os
os.chdir(r"D:\discuz\webmc\hook\opusmc-inject")
p = 'DEBUG-HANDOFF.md'
t = open(p, newline='', encoding='utf-8').read()
EOL = "\r\n" if "\r\n" in t else "\n"
anchor = "---" + EOL + EOL + "## 1. 三分钟背景"
assert t.count(anchor) == 1, '找不到 §1 锚点'

section = """## 0.2 v2.2.1：官方房间、容器崩溃、交互全废的总根因

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

"""
t = t.replace(anchor, section + anchor)
open(p, 'w', newline='', encoding='utf-8').write(t)
print('DEBUG-HANDOFF.md 补 §0.2 完成')
