/* FTB Ultimine 还原版 —— 算法级验证
   用法：node examples/mods/ftbultimine/verify.js
   用最小 DOM/game stub 加载 code.js，然后调用导出到 __FTBU_TEST 的纯函数，
   逐项对照 FTBTeam/FTB-Ultimine 源码的预期行为。 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const code = fs.readFileSync(path.join(__dirname, 'code.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, l, x) => { console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); c ? pass++ : fail++; };

// ---------- 最小世界 ----------
const W = 24, H = 12;
const ID = { AIR: 0, STONE: 1, IRON_ORE: 2, DEEPSLATE_IRON_ORE: 3, OAK_LOG: 4, DIRT: 5, WHEAT: 6, OBSIDIAN: 7 };
const KEY = {
  1: 'stone', 2: 'iron_ore', 3: 'deepslate_iron_ore', 4: 'oak_log',
  5: 'dirt', 6: 'wheat', 7: 'obsidian',
};
const HARD = { 1: 1.5, 2: 3, 3: 4.5, 4: 2, 5: 0.5, 6: 0, 7: 50 };
const cells = new Uint8Array(W * H * W);
const idx = (x, y, z) => (y * W + z) * W + x;
const inside = (x, y, z) => x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < W;
function fill(id) { cells.fill(id); }
function put(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; }
function get(x, y, z) { return inside(x, y, z) ? cells[idx(x, y, z)] : 0; }

const BLOCKS = {};
for (const k in KEY) BLOCKS[k] = { key: KEY[k], hardness: HARD[k] };
const world = {
  getBlock: get,
  getMeta: (x, y, z) => (get(x, y, z) === ID.WHEAT ? 7 : 0),
  setBlock: (x, y, z, id) => put(x, y, z, id),
};
const Features = { propOf: (id, meta, k) => (k === 'age' ? String(meta) : undefined) };

const listeners = {};
const domListeners = {};
const doc = {
  readyState: 'loading',
  addEventListener(t, fn) { (domListeners[t] || (domListeners[t] = [])).push(fn); },
};
const win = {
  addEventListener(t, fn) { (listeners[t] || (listeners[t] = [])).push(fn); },
};
function Game() {}
Game.prototype.breakBlock = function () {};
Game.prototype.drawSelection = function () {};
function UI() {}
UI.prototype.drawHUD = function () {};

const ctx = {
  window: win, document: doc,
  // 预置内置 veinminer 的绑定（它是 MODS_ALWAYS，实际游戏里会先注册）
  Game, BLOCKS, Features,
  KEYBIND_CATS: [['连锁挖矿', [['veinmine', '连锁挖矿（开 / 关）', 'Backquote']]]],
  KEY_DEFAULT: { veinmine: 'Backquote' },
  KEY_CN: { veinmine: '连锁挖矿（开 / 关）' },
  bindDown: (g, name) => {
    const k = (g.settings && g.settings.keys && g.settings.keys[name]) || ctx.KEY_DEFAULT[name];
    return !!(k && g.keys && g.keys[k]);
  },
  keyLabel: (k) => k === 'Backquote' ? '`' : k,
  UI, Font: { center() {}, draw() {} },
  game: null, console, Date, Math, Set, Map, Object, Array, Number, String, Boolean,
};
ctx.self = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
// code.js 里的 (function(){...})() 会在加载时读取 Game 并挂 hook；把纯函数导出给测试
ctx.__FTBU_TEST = true;   // 让 code.js 导出内部函数供断言
let err = null;
try { vm.runInContext(code, ctx, { filename: 'code.js' }); } catch (e) { err = e; }
ok(!err, 'code.js 加载无异常', err && err.message);
if (err) { console.log(err.stack); process.exitCode = 1; return; }
const U = ctx.__FTBU;

// ---------- 配置默认值（对照 FTBUltimineServerConfig / ClientConfig）----------
ok(U.CFG.maxBlocks === 64, 'max_blocks 默认 64');
ok(U.CFG.exhaustionPerBlock === 20.0, 'exhaustion_per_block 默认 20.0');
ok(U.CFG.experiencePerBlock === 0.0, 'experience_per_block 默认 0');
ok(U.CFG.requireTool === false && U.CFG.requireValidTool === false, 'require_tool / valid_tool 默认 false');
ok(U.CFG.renderOutline === 256, 'render_outline 默认 256');
ok(U.CFG.previewLineAlpha === 45, 'preview_line_alpha 默认 45');
ok(U.CFG.singleCropHarvesting === true, 'single_crop_harvesting 默认 true');
ok(U.SHAPES.length === 6, '6 种内置形状', U.SHAPES.map(s => s.cn).join('/'));
ok(U.SHAPES[0].isDefault === true && U.SHAPES[0].indeterminate === true, '无形状是默认且 indeterminate');
ok(U.SHAPES[0].cn === '无形状', '首项名称对齐 FTB zh_cn：无形状');
ok(U.SHAPES[1].cn === '小型通道' && U.SHAPES[5].cn === '逃生通道', '其余形状名也用官方中文');
ok(U.NEIGHBORS_26.length === 26, '26 邻域（3x3x3 去掉中心）');
ok(U.NEIGHBORS_PLANT.length === 26, '作物邻域 26 个（5x5 平面 24 + 上下 2）');

// ---------- 匹配器（BlockMatchers）----------
ok(U.matchByBlock('stone')('stone') && !U.matchByBlock('stone')('dirt'), 'MATCH_BY_BLOCK 只认同种');
const tagS = U.matchByTagsShapeless('iron_ore');
ok(tagS('iron_ore', 2, 0) && tagS('deepslate_iron_ore', 3, 0), '标签合并：铁矿 + 深板岩铁矿');
ok(tagS('stone', 1, 0) && tagS('deepslate', 1, 0), '标签合并：base_stone_overworld 组');
ok(!tagS('dirt', 5, 0), '标签合并：泥土不算同组');
ok(U.matchByTagsShaped()('obsidian', 7, 0), 'shaped 的 merge_tags 默认 * → 任意方块');

// ---------- ShapeContext / 泛洪 ----------
function shapeCtx(orig, face, matcherFn, max = 64) {
  return {
    orig, face, maxBlocks: max,
    check(x, y, z) { const id = get(x, y, z); return !!id && matcherFn(KEY[id], id, 0); },
  };
}
fill(ID.AIR);
// 一条 5 格直线的铁矿
for (let i = 0; i < 5; i++) put(10 + i, 5, 10, ID.IRON_ORE);
let c = shapeCtx([10, 5, 10], 4, U.matchByTagsShapeless('iron_ore'));
let r = U.shapeless(c, false);
ok(r.length === 5, '泛洪找到相连的 5 块铁矿', r.length);
ok(r[0][0] === 10 && r[0][1] === 5 && r[0][2] === 10, '按距离排序：起始块排第一');

// 上限截断
for (let i = 0; i < 80; i++) put(i % W, 5, 12, ID.STONE);
c = shapeCtx([0, 5, 12], 4, U.matchByTagsShapeless('stone'), 30);
r = U.shapeless(c, false);
ok(r.length <= 30 && r.length > 0, 'maxBlocks 截断生效', r.length);

// 不连通的不算
fill(ID.AIR);
put(5, 5, 5, ID.IRON_ORE); put(6, 5, 5, ID.IRON_ORE);
put(20, 5, 20, ID.IRON_ORE);
c = shapeCtx([5, 5, 5], 4, U.matchByBlock('iron_ore'));
r = U.shapeless(c, false);
ok(r.length === 2, '不相连的矿不纳入', r.length);

// ---------- 形状几何 ----------
fill(ID.STONE);
const any = () => true;
let ctx2 = shapeCtx([10, 5, 10], 4, any, 10);
ok(U.smallTunnel(ctx2).length === 10, 'SmallTunnel 沿命中面向内 10 格');
ok(U.largeTunnel(ctx2, 1).length > 1, 'SmallSquare(=LargeTunnel maxDepth=1) 生成 3x3 层');
ok(U.largeTunnel(ctx2, 1).length <= 10, 'SmallSquare 受 maxBlocks 限制');
ok(U.largeTunnel(ctx2, 100).length >= U.largeTunnel(ctx2, 1).length, 'LargeTunnel 比 SmallSquare 挖得多');
// 斜向隧道每格 Y 变 1，测试世界高 12，从 y=5 出发最多走 6 格就到边界，
// 这正是 FTB 的 break 行为（超出世界 -> check 失败 -> 停），所以按可用高度断言
const diagH = U.diagonalTunnel(ctx2, -1).length;
const escH = U.diagonalTunnel(ctx2, 1).length;
// y=5 起：下斜到 y=0 共 6 格，上斜到 y=11 共 7 格
ok(diagH === 6 && escH === 7, '斜向隧道走到世界边界即停（FTB 的 check 失败 -> break）', diagH + '/' + escH);
const diag = U.diagonalTunnel(ctx2, -1);
ok(diag[1][1] === diag[0][1] - 1, '下斜矿道每格 Y 递减');
const esc = U.diagonalTunnel(ctx2, 1);
ok(esc[1][1] === esc[0][1] + 1, '上斜逃生梯每格 Y 递增');
ok(U.getBlocks(ctx2, 'shapeless', false).length > 0, 'getBlocks 分派到无形状（26 邻域泛洪）');
ok(U.getBlocks(ctx2, 'small_square', false).length > 0, 'getBlocks 分派到 3x3');

// 形状在遇到不匹配方块时中断（SmallTunnel 的 break）
fill(ID.STONE);
// face=4 (north = [0,0,-1])，SmallTunnel 沿 -face = +Z 走，所以挡在 z=12
put(10, 5, 12, ID.AIR);
ctx2 = shapeCtx([10, 5, 10], 4, any, 10);
ok(U.smallTunnel(ctx2).length === 2, 'SmallTunnel 遇到空气立刻停止（FTB 的 break）', U.smallTunnel(ctx2).length);

// ---------- 轮廓合并（ShapeMerger 等价）----------
const one = U.outlineEdges([[0, 0, 0]]);
ok(one.solid.length === 24 * 2, '单块 6 面 × 4 边 × 2 端点', one.solid.length);
const two = U.outlineEdges([[0, 0, 0], [1, 0, 0]]);
ok(two.solid.length < one.solid.length * 2, '相邻两块共享面被合并（边数少于两倍）', two.solid.length);
ok(U.flatten([[0, 0, 0], [1, 1, 1]]).length === 14, 'flatten 每顶点 7 个 float');

// ---------- 状态机 ----------
U.clearCache();
ok(U.state.cachedBlocks.length === 0 && U.state.cachedPos === null, 'clearCache 清空预览');
U.state.shapeIndex = 0; U.state.lastToggle = 0; U.cycleShape(true, { ui: {} });
ok(U.state.shapeIndex === 1, 'cycleShape(next) 前进');
ok(U.CFG.inputDelay === 125, '形状切换有 125ms 节流（FTB INPUT_DELAY）');
const beforeThrottle = U.state.shapeIndex;
U.cycleShape(true, { ui: {} });
ok(U.state.shapeIndex === beforeThrottle, '125ms 内连点被节流，不会一下滚到斜向形状');
U.state.lastToggle -= 200; U.cycleShape(false, { ui: {} });
ok(U.state.shapeIndex === 0, '超过节流间隔后可以回退');
U.state.lastToggle -= 200; U.state.shapeIndex = 5; U.cycleShape(true, { ui: {} });
ok(U.state.shapeIndex === 0, '形状循环回绕到第一个');

// ---- 延迟挂载：DOMContentLoaded 之后 breakBlock 才是我们的 ----
ok(String(Game.prototype.breakBlock).indexOf('FTB_ULTIMINE_BREAK_HOOK') < 0,
   '加载阶段三个 hook 都还没装（等 DOMContentLoaded）');
ok(String(Game.prototype.drawSelection).indexOf('outlineEdges') < 0, '预览 hook 也延迟');
ok(String(UI.prototype.drawHUD).indexOf('infoLines') < 0, 'HUD 面板 hook 也延迟');
(domListeners.DOMContentLoaded || []).forEach(f => f());
ok(String(Game.prototype.breakBlock).indexOf('FTB_ULTIMINE_BREAK_HOOK') >= 0,
   'DOMContentLoaded 后破坏 hook 在最外层');
ok(String(Game.prototype.drawSelection).indexOf('outlineEdges') >= 0, '预览 hook 在最外层');
ok(String(UI.prototype.drawHUD).indexOf('infoLines') >= 0, 'HUD 面板 hook 在最外层');

// ---- 这次三个症状的根因：按住键到底有没有生效 ----
function fakeGame(keys, settings) {
  return {
    state: 'play', net: null, player: { food: 20, inv: { held: null }, yaw: 0 },
    keys, settings: settings || { keys: {} }, ui: { screen: null }, mode: 'survival',
  };
}
ok(U.KEY_DEFAULT.ultimineHold === 'Backquote', '默认键是 FTB 原版的反引号（不是 Alt）');
ok(U.KEY_DEFAULT.ultimineNext === 'ArrowUp' && U.KEY_DEFAULT.ultiminePrev === 'ArrowDown', '形状切换键已进 KEY_DEFAULT');
ok(U.KEYBIND_CATS.some(c => c[0] === 'FTB连锁破坏'), '按键设置里能看到 FTB连锁破坏 分类');
ok(U.KEY_DEFAULT.veinmine !== 'Backquote', '内置 veinminer 默认键已让出反引号', U.KEY_DEFAULT.veinmine);
ok(U.KEYBIND_CATS.some(c => c[1].some(b => b[0] === 'veinmine' && b[2] !== 'Backquote')),
   '按键设置里内置项也同步改了默认键');

const g1 = fakeGame({});
ok(U.held(g1) === false, '没按键时 held=false');
g1.keys.Backquote = true;
ok(U.held(g1) === true, '按住默认键 -> held=true（用游戏的 bindDown）');
g1.keys.Backquote = false;
ok(U.held(g1) === false, '松开 -> held=false');
// 用户在按键设置里改成 KeyG，也必须生效
const g2 = fakeGame({ KeyG: true }, { keys: { ultimineHold: 'KeyG' } });
ok(U.held(g2) === true, '用户改键为 KeyG 后仍生效（读 g.settings.keys）');
ok(U.held(fakeGame({ Backquote: true }, { keys: { ultimineHold: 'KeyG' } })) === false,
   '改键后旧键不再生效');
// 非 play / 有界面 / 联机 时不激活
ok(U.held(Object.assign(fakeGame({ Backquote: true }), { state: 'title' })) === false, '标题界面不激活');
ok(U.held(Object.assign(fakeGame({ Backquote: true }), { net: {} })) === false, '联机不激活');

// ---- 左边信息面板 ----
fill(ID.IRON_ORE);
const g3 = fakeGame({ Backquote: true });
U.clearCache();
U.state.cachedBlocks = [[5, 5, 5], [6, 5, 5], [7, 5, 5]];
const lines = U.infoLines(g3);
ok(lines.length >= 4, '信息面板有多行', lines.length);
ok(lines.some(l => l.s.includes('FTB连锁破坏') && l.s.includes('已激活')), '面板显示已激活');
ok(lines.some(l => l.s.includes('采掘3方块')), '面板显示方块数');
ok(lines.some(l => l.s.includes('按住')), '面板显示按键提示');
ok(lines.some(l => l.c === '#FFFF55' && l.s.includes('▸')), '当前形状黄色高亮');
ok(lines.filter(l => l.c === '#AAAAAA').length >= 2, '形状菜单上下文灰色项');
U.state.cachedBlocks = [];
const idle = U.infoLines(g3);
ok(idle.some(l => l.s.includes('未激活')), '没有目标时显示未激活');
ok(idle.some(l => l.s.includes('未指向任何方块')), '未激活时给出原因');

console.log('---');
console.log(fail === 0 ? `ALL PASS (${pass})` : `${fail} FAILED / ${pass}`);
process.exitCode = fail ? 1 : 0;
