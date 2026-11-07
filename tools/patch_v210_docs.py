# -*- coding: utf-8 -*-
# patch_v210_docs.py — 交接文档补 v2.1.0 一节（一次落盘）
import os
os.chdir(r"D:\discuz\webmc\hook\opusmc-inject")
p = 'DEBUG-HANDOFF.md'
t = open(p, newline='', encoding='utf-8').read()
EOL = "\r\n" if "\r\n" in t else "\n"
anchor = "---" + EOL + EOL + "## 1. 三分钟背景"
assert t.count(anchor) == 1, '找不到 §1 锚点'

section = """## 0.1 v2.1.0：状态 / 实体 / 交互 / 界面补全（2026-11-07 午后）

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

"""
t = t.replace(anchor, section + anchor)
open(p, 'w', newline='', encoding='utf-8').write(t)
print('DEBUG-HANDOFF.md 补 §0.1 完成')
