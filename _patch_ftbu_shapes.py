# -*- coding: utf-8 -*-
"""形状名对齐 FTB 官方中文 + 滚轮/方向键 125ms 节流。一次读一次写。"""
import sys
P = 'examples/mods/ftbultimine/code.js'
t = open(P, encoding='utf-8', newline='').read()

def R(a, b, tag):
    global t
    c = t.count(a)
    assert c == 1, (tag, c)
    t = t.replace(a, b, 1)
    print('ok', tag)

# 1) 形状名照 zh_cn.json
R("""  const SHAPES = [
    { id: 'shapeless',      cn: '散挖',       indeterminate: true,  isDefault: true },
    { id: 'small_tunnel',   cn: '小隧道',     indeterminate: false },
    { id: 'small_square',   cn: '3×3 单层',   indeterminate: false },
    { id: 'large_tunnel',   cn: '3×3 隧道',   indeterminate: false },
    { id: 'mining_tunnel',  cn: '下斜矿道',   indeterminate: false },
    { id: 'escape_tunnel',  cn: '上斜逃生梯', indeterminate: false },
  ];""",
"""  // 名称逐条取自 FTB 的 assets/ftbultimine/lang/zh_cn.json，
  // 顺序与 FTBUltimine.registerBuiltinShapes 一致（shapeless 是默认）。
  const SHAPES = [
    { id: 'shapeless',      cn: '无形状',           indeterminate: true,  isDefault: true },
    { id: 'small_tunnel',   cn: '小型通道',         indeterminate: false },
    { id: 'small_square',   cn: '小型方形（3x3）',  indeterminate: false },
    { id: 'large_tunnel',   cn: '大型通道（3x3）',  indeterminate: false },
    { id: 'mining_tunnel',  cn: '采矿通道',         indeterminate: false },
    { id: 'escape_tunnel',  cn: '逃生通道',         indeterminate: false },
  ];""", 'names')

# 2) 配置补 INPUT_DELAY
R("""    requireSneakForMenu: false, // OVERLAY.require_sneak_for_menu""",
"""    inputDelay: 125,            // FTBUltimineClient.INPUT_DELAY（形状切换节流，毫秒）
    requireSneakForMenu: false, // OVERLAY.require_sneak_for_menu""", 'cfg')

# 3) cycleShape 加节流 + 面板提示形状名
R("""  const cycleShape = (next, g) => {
    state.shapeIndex = (state.shapeIndex + (next ? 1 : -1) + SHAPES.length) % SHAPES.length;
    clearCache();
    if (CFG.shapeFeedback && g.ui && g.ui.message) g.ui.message('形状：' + currentShape().cn, '#FFFFFF');
  };""",
"""  const cycleShape = (next, g) => {
    const now = Date.now();
    if (now - state.lastToggle < CFG.inputDelay) return;   // INPUT_DELAY 节流，防滚轮连跳
    state.lastToggle = now;
    state.shapeIndex = (state.shapeIndex + (next ? 1 : -1) + SHAPES.length) % SHAPES.length;
    clearCache();
    if (CFG.shapeFeedback && g && g.ui && g.ui.message) g.ui.message('形状：' + currentShape().cn, '#FFFFFF');
  };""", 'throttle')

R("""    exhaustion: 0,
    lastUse: 0,""",
"""    exhaustion: 0,
    lastUse: 0,
    lastToggle: 0,""", 'state')

# 4) 滚轮也加同样的节流（cycleShape 内部已挡，这里再限制必须按住且无界面）
R("""  window.addEventListener('wheel', (e) => {
    const g = typeof game !== 'undefined' ? game : null;
    if (!g || !held(g)) return;
    cycleShape(e.deltaY < 0 || e.deltaX < 0, g);
  }, { passive: true });""",
"""  window.addEventListener('wheel', (e) => {
    const g = typeof game !== 'undefined' ? game : null;
    if (!g || !held(g)) return;
    // FTB: onMouseScrolled 要求按住 Ultimine 键 + isMenuSneaking()
    if (CFG.requireSneakForMenu && !(g.keys && (g.keys.ShiftLeft || g.keys.ShiftRight))) return;
    cycleShape(e.deltaY < 0 || e.deltaX < 0, g);
  }, { passive: true });""", 'wheel')

# 5) 面板里加一行说明当前形状的默认项，方便用户确认
R("""    out.push({ x: 0, s: '按住 ' + KEY_LABEL(g) + ' 启用', c: '#888888' });""",
"""    out.push({ x: 0, s: '按住 ' + KEY_LABEL(g) + ' 启用 · 滚轮切形状', c: '#888888' });""", 'panel-hint')

open(P, 'w', encoding='utf-8', newline='').write(t)
print('written')
