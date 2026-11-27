# -*- coding: utf-8 -*-
"""把 HUD 的旧材质包功能换成独立插件 opusmc-resourcepack.user.js v1.5.0。

策略（低风险）：主区块整体替换为桩函数，不删散落的交叉引用行，
避免上次「删 MODULES/API 行切坏括号」的语法错误。
  - 主区块（// MC 材质包 ... // ---- 样式）→ 一套 rp* 空实现
  - MODULES 里的 resourcepack 模块保留定义但 UI 隐藏（renderModuleList 过滤）
  - 独立插件头部去掉 __cometInstalled 拦截，让它与 HUD 共存
生成 PEVersion/js/comet-hud.js 与 comet-resourcepack.js。
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HUD = os.path.join(ROOT, 'opusmc-hud.user.js')
RP = os.path.join(ROOT, 'opusmc-resourcepack.user.js')
PE = os.path.join(ROOT, 'PEVersion', 'js')
OUT_HUD = os.path.join(PE, 'comet-hud.js')
OUT_RP = os.path.join(PE, 'comet-resourcepack.js')

def strip_header(src):
    m = re.match(r'// ==UserScript==.*?// ==/UserScript==\s*', src, re.S)
    assert m, '找不到 UserScript 头'
    return src[m.end():]

# ---------- HUD ----------
t = strip_header(open(HUD, encoding='utf-8', newline='').read())
E = '\r\n' if '\r\n' in t else '\n'
# unsafeWindow 兜底
a = "const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;"
assert t.count(a) == 1
t = t.replace(a, "const W = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);", 1)
# 早退判定改成 __cometHud，避免拦独立插件
a2 = "if (W.__cometInstalled) {\n    console.log('[Comet] 本页面已有实例，跳过重复注入');".replace('\n', E)
b2 = "if (W.__cometHud) {\n    console.log('[Comet] 本页面已有实例，跳过重复注入');".replace('\n', E)
assert t.count(a2) == 1, ('early-return', t.count(a2))
t = t.replace(a2, b2, 1)
# 主区块 → 桩
lines = t.split(E)
s = next(i for i,l in enumerate(lines) if '// MC 材质包：直接导入官方资源包 zip' in l)
e = next(i for i,l in enumerate(lines) if i > s and '// ---- 样式（彗星灰阶主题）' in l)
stub = """  // PEVersion：旧材质包引擎已由独立插件 comet-resourcepack.js 取代，
  // 这里保留同名空桩，兼容 HUD 自身的 API 引用，不再 hook 任何贴图。
  const rp = { loaded:false, patched:0, gui:new Map(), guiCount:0, guiApplied:0,
    etexApplied:0, iconsDirty:0, coverage:0, packs:[], order:[], stats:{}, glInfo:null,
    skippedAspect:[], screen:null };
  const rpNoop = () => {}, rpEnabled = () => false;
  const rpMenuSetOpen = rpNoop, rpMenuRender = rpNoop, rpMenuTick = rpNoop;
  const rpImport = rpNoop, rpClear = rpNoop, rpReupload = rpNoop, rpReapply = rpNoop;
  const rpUnzip = async () => null, rpPatchGrid = rpNoop, rpDecode = async () => null;
  const rpLoadBuiltin = rpNoop, rpSetEnabled = rpNoop, rpImportFile = rpNoop;
  const rpAddPack = rpNoop, rpTask = async (f) => f(), rpOpenPackScreen = rpNoop;
  const rpPackScreen = () => null, rpGuiKeys = () => [], rpRestore = async () => false;
  const rpApplyGui = rpNoop, rpMenuBtn = { parentNode: null }, rpMenu = { parentNode: null };
"""
print('HUD 主区块替换 %d 行 → 桩' % (e - s))
lines[s:e] = stub.split(E)
t = E.join(lines)
# MODULES 里的 resourcepack 项：在 UI 渲染时过滤掉
a3 = "const list = MODULES.filter((m) => m.cat === cat.id);"
assert a3 in t
t = t.replace(a3, "const list = MODULES.filter((m) => m.cat === cat.id && (PE_NO_RP ? m.id !== 'resourcepack' : true));", 1)
# 定义常量
anchor = "  const VERSION = '1.32.0';"
assert t.count(anchor) == 1
t = t.replace(anchor, "  const PE_NO_RP = true; // 材质包由独立插件提供，HUD 不再显示该模块\n" + anchor, 1)
open(OUT_HUD, 'w', encoding='utf-8', newline='').write(
    "'use strict';\n// PEVersion 内置客户端（材质包功能已剥离，由 comet-resourcepack.js 提供）。\n"
    "// 由 tools/strip_hud_resourcepack.py 生成，勿手改。\n" + t)
print('已生成', OUT_HUD, os.path.getsize(OUT_HUD), 'B')

# ---------- 独立材质包插件 ----------
r = strip_header(open(RP, encoding='utf-8', newline='').read())
Er = '\r\n' if '\r\n' in r else '\n'
a4 = "const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;"
assert r.count(a4) == 1
r = r.replace(a4, "const W = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);", 1)
# 去掉「主客户端已内置」早退，让两个脚本共存
early = re.search(r'  // 主客户端已经内置同一套引擎，两个都装会重复 hook；二选一即可\r?\n  if \(W\.__cometInstalled\) \{[\s\S]*?\r?\n  \}\r?\n', r)
assert early, '找不到独立插件的早退块'
print('独立插件去掉早退块 %d 行' % early.group(0).count('\n'))
r = r[:early.start()] + r[early.end():]
open(OUT_RP, 'w', encoding='utf-8', newline='').write(
    "'use strict';\n// PEVersion 内置材质包引擎（opusmc-resourcepack.user.js v1.5.0 转制）。\n"
    "// 由 tools/strip_hud_resourcepack.py 生成，勿手改。\n" + r)
print('已生成', OUT_RP, os.path.getsize(OUT_RP), 'B')
