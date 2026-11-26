# OpusMC v47685 源码快照

抓取时间：2026-11-13 20:33
来源：`https://www.bilibili.com/toy/OpusMC` → iframe `https://www.bilibilitoy.com/toy/OpusMC/47455601425408-v47685/index.html`
本地旧快照：`probe/js`（`v=41351b`）

## 结论

**完整源码已全量拿到。** 游戏仍是带完整注释的可读 JS，不是混淆产物。

| 项 | 数量 |
|---|---|
| 入口 `<script>` | 99 |
| js/ 实际文件（含清单外运行时资源） | 101 |
| 入口清单新增 JS | 8 |
| 清单外运行时 JS | 2 |
| 内容变更 JS | 69 |
| 逐字节相同 JS | 23 |
| 模组包 | 7 个 / 192 文件（另有 index.json） |
| 模组文件实际拿到 | 191 / 192 |
| 音效 | 本地 `probe/sounds` 4849 个，线上 `sound_events.js` 逐字节相同，可直接复用 |

全量 `node --check`：js/ 与 mods/ 下所有 JS **0 个语法错误**。

## 这次更新的核心：模组系统

`mods.js` 顶部注释把机制讲得很清楚：模组本体在 `mods/<id>/` 动态目录，
页面按世界（world）选择要加载的模组，重载时用 `sessionStorage` 传递；
`data.js` 在原版数据文件之后、`blocks.js` 之前注入方块/物品/配方/贴图；
`code.js` 在 `main.js` 之前注入玩法；`tiles.png` 追加到纹理数组。
仅单人，联机房是原版。

入口清单里新增的 8 个 JS：

| 文件 | 大小 | 作用 |
|---|---|---|
| `js/live.js` | 5602 B | 直播相关 |
| `js/minigame.js` | 14707 B | 小游戏 |
| `js/modapi.js` | 40298 B | 模组 SDK：给第三方模组注册方块、物品、配方 |
| `js/mods.js` | 12078 B | 模组系统主体：下载/删除/按世界加载/重载 |
| `js/mods_code.js` | 202 B | 占位：`Mods.stage("code")`，插入各模组 code.js |
| `js/mods_data.js` | 118 B | 占位：`Mods.stage("data")`，插入各模组 data.js |
| `js/mods_ui.js` | 36946 B | 「模组」界面（截图第二张那个列表） |
| `js/shareholders.js` | 29703 B | 股东名册（截图里「股东名册」按钮） |

清单外但真实存在、由 worker / 运行时加载，已一并下载（2 个 JS）：

- `js/chunk_worker.js`
- `js/sound_events.js`

另有 `js/emoji.webp`、`js/jing.webp` 两个图片资源。

## 7 个模组包

| id | 名称 | 作者 | 协议 | 文件数 | 声明大小 | 关键代码 |
|---|---|---|---|---|---|---|
| `tconstruct` | 匠魂 (Tinkers' Construct) | SlimeKnights | MIT | 141 | 11.6 MB | data.js 4216KB / code.js 5KB / bundle.js 3165KB |
| `farmersdelight` | 农夫乐事 (Farmer's Delight) | vectorwing | MIT | 41 | 3.3 MB | data.js 1123KB / code.js 0KB / bundle.js 256KB |
| `veinminer` | 连锁挖矿 (Vein Miner) | UP主 | 自制 | 2 | 0.0 MB | data.js 0KB / code.js 11KB |
| `nightvision` | 夜视 (Night Vision) | UP主 | 自制 | 2 | 0.0 MB | data.js 0KB / code.js 1KB |
| `dynlights` | 移动光源 (Dynamic Lights) | UP主 | 自制 | 2 | 0.0 MB | data.js 0KB / code.js 27KB |
| `tcdemo` | 匠魂教程地图 () | UP主 | 自制 | 2 | 0.0 MB | data.js 0KB / code.js 25KB |
| `fddemo` | 农夫乐事教程地图 () | UP主 | 自制 | 2 | 0.0 MB | data.js 0KB / code.js 22KB |

`tcdemo` / `fddemo` 是两个隐藏的教程地图模组（index 里 `tutorial` 字段引用）。

**服务端 404 的文件**（`index.json` 列了但没放，非下载失败）：

- `mods/farmersdelight/LICENSE.txt`

## 内容变更的 JS（按变化量）

| 文件 | 旧 | 新 | 变化 |
|---|---|---|---|
| `models.js` | 4116670 | 4210734 | +94064 |
| `game.js` | 206222 | 264803 | +58581 |
| `etex.js` | 870882 | 910358 | +39476 |
| `features.js` | 87617 | 117159 | +29542 |
| `entity.js` | 92574 | 118747 | +26173 |
| `render.js` | 111859 | 127259 | +15400 |
| `telemetry.js` | 21948 | 36712 | +14764 |
| `blocks.js` | 72772 | 85799 | +13027 |
| `ui.js` | 93703 | 105682 | +11979 |
| `equip.js` | 48628 | 60401 | +11773 |
| `companion.js` | 38034 | 46550 | +8516 |
| `mobile.js` | 33778 | 40787 | +7009 |
| `village_mobs.js` | 16158 | 23099 | +6941 |
| `cosmetics.js` | 26636 | 33021 | +6385 |
| `spawning.js` | 16426 | 22808 | +6382 |
| `structtypes.js` | 34836 | 40646 | +5810 |
| `vehicles.js` | 42020 | 47439 | +5419 |
| `items3.js` | 49806 | 55117 | +5311 |
| `effects.js` | 21468 | 26379 | +4911 |
| `terrain2.js` | 49332 | 54071 | +4739 |
| `specials.js` | 27449 | 32117 | +4668 |
| `account.js` | 52450 | 57099 | +4649 |
| `dims.js` | 33348 | 37807 | +4459 |
| `mobitems.js` | 25372 | 29704 | +4332 |
| `structures_data.js` | 3355173 | 3359417 | +4244 |
| `main.js` | 15460 | 19690 | +4230 |
| `redstone.js` | 69135 | 73257 | +4122 |
| `itemuse.js` | 14188 | 18125 | +3937 |
| `mobs_animals.js` | 109432 | 113322 | +3890 |
| `mobs_hostile.js` | 68059 | 71910 | +3851 |
| `net.js` | 161331 | 164730 | +3399 |
| `touch.js` | 31747 | 34923 | +3176 |
| `shaders.js` | 91053 | 94069 | +3016 |
| `capes.js` | 42900 | 45883 | +2983 |
| `mesher.js` | 42677 | 45560 | +2883 |
| `toy.js` | 23006 | 25751 | +2745 |
| `structures.js` | 6639 | 9372 | +2733 |
| `world.js` | 76125 | 78754 | +2629 |
| `screens.js` | 68106 | 70409 | +2303 |
| `blockents.js` | 20346 | 22552 | +2206 |
| `vmodels.js` | 15879 | 18040 | +2161 |
| `p2p.js` | 56007 | 58106 | +2099 |
| `anvil.js` | 18870 | 20925 | +2055 |
| `vmobs.js` | 39685 | 41527 | +1842 |
| `save.js` | 14943 | 16674 | +1731 |
| `mobs_water.js` | 25947 | 27623 | +1676 |
| `onboard.js` | 44683 | 45846 | +1163 |
| `enchant.js` | 20565 | 21526 | +961 |
| `mobs2.js` | 41142 | 42074 | +932 |
| `export.js` | 25964 | 26725 | +761 |
| `emodel.js` | 13803 | 14546 | +743 |
| `worldgen.js` | 96820 | 97529 | +709 |
| `decor.js` | 32775 | 33436 | +661 |
| `structgen.js` | 36866 | 37490 | +624 |
| `controls.js` | 16156 | 16758 | +602 |
| `audio.js` | 24516 | 25110 | +594 |
| `social.js` | 7597 | 8075 | +478 |
| `skins.js` | 19763 | 20183 | +420 |
| `gen_worker.js` | 6673 | 7044 | +371 |
| `cloudsave.js` | 20985 | 21323 | +338 |
| `merchant.js` | 14549 | 14866 | +317 |
| `news.js` | 42071 | 41760 | -311 |
| `render2.js` | 12605 | 12894 | +289 |
| `checkin.js` | 40736 | 40899 | +163 |
| `util.js` | 9323 | 9404 | +81 |
| `extras.js` | 39953 | 40026 | +73 |
| `cmdrun.js` | 52029 | 52092 | +63 |
| `draw2.js` | 10823 | 10839 | +16 |
| `blockdata.js` | 560684 | 560677 | -7 |

## 逐字节相同的文件

`assets.js`, `beacon.js`, `cmdblock.js`, `commands.js`, `emoji.js`, `entitydata.js`, `font.js`, `itemdata.js`, `jing_tex.js`, `nbt.js`, `netconfig.js`, `nether_mobs.js`, `panorama.js`, `panorama_data.js`, `perf.js`, `raids.js`, `recipedata.js`, `sound_events.js`, `subtitles.js`, `texts.js`, `trees.js`, `workstations.js`, `worldgen_data.js`

## 目录

```
_snapshot/v47685/
├── index.html            线上游戏入口（99 个 script）
├── toy-shell.html        bilibili 外壳（含 iframe 地址）
├── js/                   103 个 JS + 2 个 webp（19.9 MB）
└── mods/
    ├── index.json        模组索引（7 个）
    └── <id>/             data.js / code.js / bundle.js / tiles.png / gui / sounds ...
```

## 踩过的坑

1. bilibili 外壳是 gzip，`curl` 要加 `--compressed`，否则读到二进制。
2. 游戏真身不在 `www.bilibilitoy.com/` 根，而在 shell 的 iframe：
   `/toy/OpusMC/47455601425408-v47685/index.html`。
3. `mods/index.json` 的路径是 `mods/index.json`（不是注释里写的 `game/mods/index.json`）。
4. **Windows 下 Python 重定向 stdout 会写成 CRLF**，批量下载时每行路径尾巴带 `\r`，
   192 个请求全 404。生成清单必须用二进制写或显式 `\n`。
5. 模组资源不在 `js/` 里，要另读 `mods/index.json` 按 `mods/<id>/<file>` 拼。

