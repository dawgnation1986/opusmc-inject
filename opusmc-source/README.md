# OpusMC 资源正常化源码副本

生成时间：2026-11-10T20:18:45
由 `tools/build_source_tree.py` 从 `probe/` 复制并转换而来，**原始的 `probe/` 没有改动**。

## 和原版有什么区别

| | 原 `probe/` | 这个副本 |
| --- | --- | --- |
| 贴图形态 | base64 内嵌在 `assets.js` / `etex.js` / `font.js` | `assets/minecraft/textures/` 下独立 PNG |
| 改一张材质 | 重新生成整个 JS | 直接替换对应 PNG 文件 |
| `render.js` 加载 | 526 个串行 `await loadImage(dataURL)` | 并发加载文件路径 |
| 音效 | 本来就是独立 `.m4a` | 保持一致 |

贴图路径对照表见 `../vanilla-assets/MAPPING.json`（`images` / `tiles` / `etex` 三段）。
例如想把石头换掉，直接改 `assets/minecraft/textures/block/stone.png`；
想换主菜单按钮，改 `assets/minecraft/textures/gui/sprites/widget/button.png`。

## 启动

```bat
launch-source.bat
```

或者手动：`node tools/server-source.mjs`，然后打开 `http://localhost:8778/game.html`。
用 **8778** 是为了不跟原版 8777 抢端口，两个可以同时跑对照。

## 改单张方块 / 物品贴图

游戏 `render.init()` 读的是 `_atlas/strip.png`（64 列 x 2650 格 16x16 长条图集）。
独立 PNG 通过 `js/assets.js` 里的 `"tileFiles"` 映射回每一格，改完跑一次：

```bash
python tools/rebuild_atlas.py
```

它会按 `ASSETS.tiles` 的索引把 `textures/block/*.png` / `textures/item/*.png`
重新拼成 strip.png（高清贴图自动按最近邻缩到 16x16），然后刷新页面即可。
`launch-source.bat` 启动前会自动跑这一步。

注意必须通过 HTTP 打开，不能双击 `game.html`（`file://` 下 `getImageData` 会被同源策略挡住）。

## 校验结果

- 引用的独立图片路径：3433 个，缺失 0 个
- 三个资源 JS 里剩余 base64：0 处
- `game.html` 引用的 js：91 个，缺失 0 个
- 独立 PNG：3993 张 / 音效：4849 个

## 已知边界

- JS 逻辑本身在 `probe/js/` 里就是带注释可读的，不是混淆产物；这份副本保留原样。
- `blockstates/*.json` / `models/*.json` 仍不被游戏读取（方块模型由 `Mesher`/`blocks.js` 生成）。
- 按钮**位置**写死在 `js/screens.js` 的 `layout()`，换贴图改不了位置。
