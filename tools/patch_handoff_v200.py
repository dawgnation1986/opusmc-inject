# -*- coding: utf-8 -*-
# patch_handoff_v200.py — DEBUG-HANDOFF.md 一次落盘：纠正被实测推翻的两条「已验证事实」
import os
os.chdir(r"D:\discuz\webmc\hook\opusmc-inject")
p = 'DEBUG-HANDOFF.md'
t = open(p, newline='', encoding='utf-8').read()
EOL = "\r\n" if "\r\n" in t else "\n"
print('行尾 =', 'CRLF' if EOL == "\r\n" else 'LF')

def rep(old, new, n=1):
    global t
    o = old.replace("\n", EOL); nn = new.replace("\n", EOL)
    c = t.count(o)
    assert c == n, 'old 命中 %d 次（应 %d）: %r...' % (c, n, old[:70])
    t = t.replace(o, nn)

rep("""> 写给下一个接手的模型/人。本项目的协议翻译已经打通 95%，只剩「网页客户端渲染出的地形与
> PHPMC 真实世界不符（方块稀疏/悬空/错落）」这一个问题。请先读完「已验证事实」再动手，
> 那些结论都花了实测成本，别推翻重查。

---""",
"""> ⚠ 下面的 §2~§9 是 2026-11-07 01:00 的历史记录，其中「已验证事实 #2 / #6」已被
> v2.0.0 的真实存档实测推翻。**先读 §0**，别再照着旧结论查。

---

## 0. v2.0.0 结案（2026-11-07，实测）

「地形稀疏/悬空」不是加载没完、不是 onBinary 抛异常、不是两端坐标不同，也不是 wss 差异。
假设 A~E 全部排除。真因是**四处把标准 1.8 的假设套到了 PHPMC 的非标准实现上**：

| # | 错在哪 | 实测证据 |
|---|---|---|
| 1 | **区块负载布局**：`Chunk.php::payload()` 是「所有段 blocks → 所有段 blockLight → 所有段 skyLight → biomes」的**分组布局**；旧 `chunkToOpus` 按「每段 blocks+光」交错读 | `tools/diagnose-adaptation.mjs`：40 个真实区块 / 851968 方块，交错读法错 **33.62%**；真实空气 19.47% 被读成 **43.94%**；第 0 段错 0%、第 3 段错 92%、第 4 段 100% 变空气 —— 正是「下面有方块、上面成簇悬空」 |
| 2 | **states 名字带 `minecraft:` 前缀**：客户端 `BID` 的键是 `stone` / `grass_block`，`mapVanillaStateNear('minecraft:stone')` 返回 `null`（空气），`minecraft:grass_block` 还被 nearNames 兜底成**石头** | vm 实测：`BID` 带前缀的键 0 个；`minecraft:stone -> null`、`stone -> [1,0]`、`minecraft:grass_block -> [1,0,true]`、`stone -> [1,0]`。`anvil.js` 读存档时也是先 `strip(/^minecraft:/)` 再传 |
| 3 | **坐标打包位布局**：`Server.php::packPositionBytes/unpackPosition` 是 `x<<38 \\| y<<26 \\| z`，标准 1.8 是 `x<<38 \\| z<<12 \\| y`。旧 `MC.dig` 与 0x23 解码都按标准写 → 挖 A 点服务端收到 B 点 | 源码逐行核对；`tools/verify-adaptation.mjs` 的坐标往返用例覆盖正负坐标与 `(-1,-1,-1)` 使用物品特例 |
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

---""")

rep("""## 3. 已验证事实（不要重查）""",
"""## 3. 历史记录（其中 #2 / #6 已被 §0 推翻，先看 §0）""")

rep("""2. **chunkToOpus 的输出与 PHPMC 原始区块数据逐方块一致**：""",
"""2. ❌ **已被推翻** —— 这条的「零差异」是自证循环（基准与被测共用错误布局）。以下为原文：""")
rep("""6. **PHPMC 区块段布局**：每段 8192B（4096×u16 LE，(id<<4)|meta）+ 2048 blockLight
   + 2048 skyLight；mask=0 的段不写任何数据；groundUp=true 时尾部跟 256B 群系。
   （协议清单 §3 里「4096 字节 Blocks」指的是 4096 个方块条目，实际 8192 字节。）""",
"""6. ❌ **已被推翻** —— 真实布局是**分组**：所有段 blocks 连排 → 所有段 blockLight →
   所有段 skyLight → 尾部 biomes 256B。见 `PHPMC/src/World/Chunk.php::payload()` 第 60~120 行，
   源码注释里就写着「不是每段 方块+光 各自打包」。单段区块才碰巧等价。
   （协议清单 §3 里「4096 字节 Blocks」指的是 4096 个方块条目，实际 8192 字节。）""")

rep("""## 9. 下一个人该做的事（按顺序）

1. **假设 A 的同坐标对比**（5 分钟）——大概率直接结案或大幅收窄。
2. 采集网页端 F12 红字 + `game.net.missing`（假设 B/C 的现场证据）。
3. 若 1、2 无果，跑假设 E 的双路径比对（把 verify-chunks 加 wss 模式）。
4. 0x35 的修复（skipNbt 跳根名）需要站在箱子区块实测确认。
5. M4 候选：容器/背包 GUI 翻译（0x2D/0x2F/0x30 → open/win/wslot，协议清单 §8 有
   slotCount 反直觉约定：工作台/铁砧/酿造台/附魔台必须给 0）、村民交易、
   附魔 NBT 透传（PHPMC 有看门狗在保附魔，别把它喂丢了）。""",
"""## 9. 下一个人该做的事（按 §0 更新）

1. **真机同坐标截图确认**：`launch-play.bat` 起全套，网页端与 Java 端站同一坐标对比地形。
   这是唯一还没做的验收（其余都是模拟客户端 + 内容级验证）。
2. 掉落物实体（0x0E / 0x1C / 0x0D）——地上物品目前不显示。
3. 容器 GUI 的 `kind` 逐个核对 `NET_STATION`，补 0x32 事务确认。
4. 若 PHPMC 启用 `ENABLE_SECTION_RESEND`，实现增量区块的段缓存合并。
5. 村民交易、附魔 NBT 透传（PHPMC 有看门狗在保附魔，别把它喂丢了）。

> 旧版这一节列的「假设 A 同坐标对比 / 采集 F12 红字 / 双路径 wss 比对」都不用做了：
> 根因已在源码与真实存档里定位并修掉。""")

open(p, 'w', newline='', encoding='utf-8').write(t)
print('DEBUG-HANDOFF.md v2.0.0 更正完成，单次落盘')
