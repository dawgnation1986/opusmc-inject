# Comet FX — Meteor 基座魔改工程

**这不是文档，是能编译的工程。** 已在 `javac 25` / `Gradle 9.8.1` / `Fabric Loom 1.18.4` 下完整 `build` 成功，产出可安装的 jar。

## 三个能立刻核对的东西

| 想看什么 | 在哪 |
|---|---|
| **特效画面** | 双击 `preview/preview.html`（默认播开场动画；`?nointro=1` 跳过） |
| **编译结果** | `meteor-client/build/libs/meteor-client-26.3-local.jar`（4.9 MB） |
| **改了什么** | 下面「源码改动」一节 |

预览页截图：`preview/shots/final2.png`（Chrome 无头实拍，五芒星 5 尖、整圈彩虹、玻璃面板、TargetHUD、3D 线框、追踪线、雷达全部可见）。

## 一切皆在 D 盘

```
D:\discuz\webmc\hook\opusmc-inject\comet-mod\
├── meteor-client\              Meteor 26.3 源码（本工程 = 魔改它）
├── fabric-template\            Fabric 官方模板（工程结构参考）
├── preview\                    可双击看的特效预览
├── _cache\                     Gradle 发行版 + 全部依赖 + Loom 反编译产物  ← 615 MB
├── _tmp\                       TMP / TEMP / Chrome profile
├── env.bat                     D 盘隔离环境变量
├── build.bat                   一键构建
└── run-client.bat              一键启动游戏客户端（需 MC 账号）
```

`GRADLE_USER_HOME` / `TMP` / `TEMP` / `TMPDIR` / `java.io.tmpdir` 全部指向 `_cache` / `_tmp`。已核查：

- `C:\Users\zhahe\.gradle` 今天**零新增文件**（里面是 9 月/11 月初的旧缓存）
- `C:\Users\zhahe\.gradle\wrapper` 里**没有** 9.8.1（新版 Gradle 全在 D 盘）
- Gradle 9.8.1 发行版在 `_cache\gradle-home\wrapper\dists\`

## 源码改动（对 Meteor 原版只动了 1 行注册 + 1 行 import）

| 文件 | 状态 | 内容 |
|---|---|---|
| `src/main/java/meteordevelopment/meteorclient/systems/modules/Modules.java` | **改** | 加 `import com.bigpixel.comet.CometFX;` 和 `add(new CometFX());` 两行 |
| `src/main/java/com/bigpixel/comet/CometFX.java` | 新增 | 渲染模块：17 图案光环、彩虹、脉冲、尖角发光、pentagram、环绕粒子、实体 12 边框 + 追踪线 |
| `src/main/java/com/bigpixel/comet/render/CometGeometry.java` | 新增 | 9 种几何图案极坐标公式（五芒星 5 尖、正多边形直边） |
| `src/main/java/com/bigpixel/comet/render/CometColor.java` | 新增 | HSV / 彩虹 / lerp / 血量色 |
| `src/main/java/com/bigpixel/comet/render/CometEase.java` | 新增 | 缓动与开场四段 |
| `src/main/java/com/bigpixel/comet/render/CometShapesMath.java` | 新增 | 虚线切分、箭头羽片、圆角扇区、ribbon、确定性粒子 |
| `src/main/java/com/bigpixel/comet/render/CometShapes.java` | 新增 | 3D 绘制工具：线/框/四角括号/节点/光柱/圆/环/图案/批量 |

**没有玩法逻辑**：全工程不含索敌、发包、自动攻击、移动、破坏。`CometFX` 继承 `Module`，只订阅 `Render3DEvent` 和 `TickEvent.Post`，只往 `Renderer3D` 塞顶点。

## 怎么跑

### 构建

双击 `build.bat`，或：

```bat
cd /d D:\discuz\webmc\hook\opusmc-inject\comet-mod
call env.bat
cd meteor-client
gradlew.bat build --no-daemon
```

产物：`meteor-client\build\libs\meteor-client-26.3-local.jar`，把这个 jar 放进 `.minecraft\mods\` 即可（它就是 Meteor 本体 + 我们的视觉层，不要再单独装一个 Meteor）。

### 启用模块

进游戏 → Meteor ClickGUI → **Render** 分类 → `comet-fx` → 打开。设置里有：

`pattern`（17 图案）/ `radius` / `speed` / `layers` / `segments` / `see-through` / `rainbow` / `pulse` / `tip-glow` / `particles` / `entity-boxes`。

### 启动游戏（需要正版账号）

双击 `run-client.bat`（会执行 `gradlew runClient`）。**本机没有跑过**，需要 Minecraft 账号登录、下载 assets，未验证。上面那张预览页截图是 Chromium 实拍，不依赖 MC。

## 编译验证记录

| 命令 | 结果 |
|---|---|
| `gradlew --version` | Gradle 9.8.1 / JVM 25.0.3 |
| `gradlew compileJava`（首次） | **BUILD SUCCESSFUL in 2m33s**，2 个无害警告（Meteor 自带） |
| `gradlew compileJava`（加入 CometFX 后） | **BUILD SUCCESSFUL in 25s** |
| `gradlew build`（两次） | **BUILD SUCCESSFUL**，jar 4.9 MB / 1537 条目 / 含 13 个 `com/bigpixel/*` |
| `javac 25` 纯 Java 数学层 | 编译通过，`Verify` 34 项断言全过 |

`remapJar` 在这个 Loom 版本不存在，任务名是 `build` / `jar`（`gradlew tasks --all` 查过）。

## 两个从截图里抓出来并修掉的真 bug

1. **phase 双传**：`radius(shape, a + phase, t, phase)` 把旋转相位加了两次，形状被扭歪；改成只通过函数参数传一次。Java 侧和预览页同步修。
2. **彩虹只跨 31°**：`rainbow(t, phase)` 里 `phase * 360/TAU` 把 `0..0.55` 当成色相，整圈挤在橙红区；改成 `rainbowAt(hueDeg, alpha)` 按角度铺满 360°。

另外透视压缩系数从 `.30` 调到 `.58`、默认层数 3→1、粒子 110→40，才让五芒星轮廓在预览里能看清。**形状公式的 34 项断言一直是全绿的，但画面是错的** —— 所以这轮专门用 Chrome 无头截图核对。

## 边界

- `preview/` 是浏览器预览，用来核对视觉；真正进 MC 看到的还会受 GUI scale、FOV、深度测试影响，需要进游戏再调。
- 玻璃 UI / HUD 组件 / 开场动画的**完整 Java 实现方案**在 `..\fx-client\` 那 6 份文档里；本工程先落地了绘制层与光环这一条链路，其余按文档逐个搬即可。
- Meteor 是 GPL-3.0，魔改后分发需保留协议与版权头。
