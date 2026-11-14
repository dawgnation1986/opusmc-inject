// ==UserScript==
// @name         OpusMC 原生资源包（独立版 · 无客户端依赖）
// @namespace    https://github.com/bigpixel
// @version      1.5.0
// @description  给 OpusMC 网页版加上原版 MC 的资源包选择界面：方块 / 物品 / 实体 / 环境 / 药水 / GUI 全类别，支持 16x~128x、多个包叠加排序、一次导入多个 zip。不含任何辅助 / hack 功能，可单独安装。
// @author       BigPixel
// @match        https://opuscraft.pages.dev/*
// @match        https://www.bilibilitoy.com/*
// @match        https://www.bilibili.com/toy/*
// @match        http://localhost:8777/*
// @match        *://*/game.html*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  // 主客户端已经内置同一套引擎，两个都装会重复 hook；二选一即可
  if (W.__cometInstalled) {
    console.log('[OpusRP] 检测到 Comet 客户端已内置资源包功能，独立插件跳过安装');
    return;
  }
  if (W.__opusRPInstalled) return;
  W.__opusRPInstalled = true;

  // ---------------- 适配层：补齐引擎区块用到的外部符号 ----------------
  const state = { game: null, player: null };
  const CFG_KEY = 'opusmc_rp_settings';
  const cfg = { settings: {} };
  try { Object.assign(cfg.settings, JSON.parse(W.localStorage.getItem(CFG_KEY) || '{}')); }
  catch (e) { /* noop */ }
  let __sCache = null;
  function getS(id, key) {
    const k = id + '.' + key;
    return Object.prototype.hasOwnProperty.call(cfg.settings, k) ? cfg.settings[k] : undefined;
  }
  function saveCfg() {
    try { W.localStorage.setItem(CFG_KEY, JSON.stringify(cfg.settings)); } catch (e) { /* noop */ }
  }
  function refreshGui() { /* 独立版没有客户端 GUI */ }
  function extLog() { /* noop */ }
  function pushNotification(title, msg) {
    try {
      const u = state.game && state.game.ui;
      if (u && typeof u.message === 'function') u.message(title + '：' + msg, '#FFFF55');
      else console.log('[OpusRP]', title, msg);
    } catch (e) { console.log('[OpusRP]', msg); }
  }
  function mk(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  // 兜底面板样式（主路径是游戏自己绘制的菜单，这段只在游戏没起来时用）
  const style = document.createElement('style');
  style.textContent = `
    #__comet_rpbtn {
      position: fixed; left: 50%; top: 66%; transform: translateX(-50%);
      z-index: 2147483600; display: none; cursor: pointer;
      padding: 6px 20px; border-radius: 6px;
      background: linear-gradient(180deg, rgba(150,110,225,.94), rgba(92,60,165,.94));
      border: 1px solid rgba(255,255,255,.7); color: #fff;
      font: 12px "Microsoft YaHei", sans-serif; text-shadow: 0 1px 1px rgba(0,0,0,.65);
      box-shadow: 0 2px 0 rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.3);
    }
    #__comet_rpbtn.show { display: block; }
    #__comet_rpbtn.hidden { display: none !important; }
    #__comet_rpbtn:hover { filter: brightness(1.16); }
    #__comet_rpmenu {
      position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
      z-index: 2147483601; display: none; width: min(430px, 92vw); box-sizing: border-box;
      padding: 12px; border-radius: 14px;
      border: .5px solid rgba(176,107,255, .75);
      background: linear-gradient(140deg,
        rgba(176,107,255, .12) 0%, #10121c 46%, rgba(0,0,0,.5) 100%);
      box-shadow: 0 0 calc(14 * 1px) rgba(176,107,255, .4),
                  0 16px 50px rgba(0,0,0,.7);
      color: #eef2f8; font: 11px "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    #__comet_rpmenu.open { display: block; }
    #__comet_rpmenu.drag { outline: 2px dashed #b06bff; }
    .cm-rmhead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .cm-rmtitle { font-weight: 700; font-size: 14px; color: #b06bff; }
    .cm-rmclose { cursor: pointer; font-size: 18px; line-height: 1; opacity: .75; padding: 0 4px; }
    .cm-rmclose:hover { opacity: 1; }
    .cm-rmstatus {
      padding: 7px 9px; border-radius: 5px; background: rgba(0,0,0,.35);
      min-height: 15px; line-height: 16px; word-break: break-all;
    }
    .cm-rmhint { margin: 7px 2px; opacity: .66; line-height: 15px; font-size: 10px; }
    .cm-rmrow { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .cm-rmrow .cm-rmbtn { min-width: 88px; }
    .cm-rmbtn {
      flex: 1; text-align: center; padding: 6px 4px; border-radius: 5px; cursor: pointer;
      background: rgba(176,107,255, .42); border: .5px solid rgba(255,255,255,.25);
    }
    .cm-rmbtn:hover { background: rgba(176,107,255, .68); }
    .cm-rmtoggle { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; opacity: .9; }
    .cm-rmswitch {
      width: 30px; height: 15px; border-radius: 9px; background: rgba(255,255,255,.18); cursor: pointer;
    }
    .cm-rmswitch i {
      display: block; width: 11px; height: 11px; margin: 2px; border-radius: 50%;
      background: #ddd; transition: transform .15s;
    }
    .cm-rmswitch.on { background: rgba(176,107,255, .9); }
    .cm-rmswitch.on i { transform: translateX(15px); background: #fff; }
    .cm-rminfo { font-size: 10px; opacity: .62; line-height: 15px; word-break: break-all; }
    .cm-map-open #__comet_rpbtn, .cm-map-open #__comet_rpmenu { display: none !important; }
  `;
  try { (document.head || document.documentElement).appendChild(style); } catch (e) { /* noop */ }

  // ==========================================================================
  // MC 材质包：直接导入官方资源包 zip，按 ASSETS.tiles 的贴图名替换方块贴图
  // 链路：assets.js 的 strip 长条图 → render.init() 的 getImageData → tileData
  //       → texStorage3D / texSubImage3D(TEXTURE_2D_ARRAY)
  // 注入点：hook getImageData 在源头改像素；导入后主动重传全部 mip 级，无需刷新。
  // zip 解压走浏览器原生 DecompressionStream('deflate-raw')，不引任何依赖。
  // ==========================================================================
  const rp = {
    tiles: new Map(),        // 贴图名 -> Uint8ClampedArray(16*16*4)
    ready: false, loaded: 0, patched: 0,
    glInfo: null,            // { levels, F, layers }
    lastGrid: null, lastW: 0, lastH: 0,
    db: null,
    packInfo: null,          // 导入包的分类统计，用于把诊断说清楚
    menuOpen: false,
    gui: new Map(),          // 游戏 images 键 -> { img, w, h }（GUI / HUD / 物品栏贴图）
    guiOrig: new Map(),      // 首次替换前的原始贴图，清除 / 换包时还原
    guiCount: 0, guiApplied: 0, guiDirty: false, guiBound: null,
    packs: [],               // 导入过的所有包 { id, name, tiles:Map, gui:[{k,b}], nBlock, nGui }
    order: [],               // 已启用的包 id，索引 0 优先级最高
    task: Promise.resolve(), // 导入 / 清除 / 切换全部串行，杜绝连点互相覆盖
    menuProto: null,         // 缓存游戏的 MenuScreen.prototype
    screen: null,            // 当前打开的原版资源包界面
    etex: new Map(),         // ETEX 路径 -> PNG bytes（实体 / 生物贴图）
    etexOrig: new Map(),     // 原版 ETEX 值，关闭时还原
    etexUrl: new Map(),      // 路径 -> 当前 blob URL，替换前 revoke
    etexDirty: false, etexApplied: 0, iconsDirty: false,
    stripBase: null,         // 原版 strip 像素，每轮从它重建，避免上一包残留
    glTex: null,             // 方块纹理数组（游戏没挂到 renderer，靠 hook 抓绑定对象）
    skippedAspect: [],       // 比例异常被拦下的 GUI 贴图键
    guiHi: new Map(),        // 保留原分辨率、走高清九宫格的键 -> 倍数
    suspended: false,        // 「记住选择」关掉后，启动时载入库但不自动应用
    stats: null,             // 最近一次导入的分类统计
    coverage: null,          // { used, total, pct } 游戏贴图槽位覆盖率
  };
  function rpEnabled() {
    return getS('resourcepack', 'enabled') !== false;
  }
  function rpStatus(s) {
    try { cfg.settings['resourcepack.status'] = String(s); saveCfg(); refreshGui(); } catch (e) { /* noop */ }
    try { rpMenuRender(); } catch (e) { /* 面板可能还没建好 */ }
  }

  // ---- GUI 材质包：游戏 UI 每帧都用 renderer.images[key] 画 2D 界面，
  // 只要把同名同尺寸的贴图换掉，物品栏 / 箱子 / 按钮 / 血量条 / 菜单底纹就全变了。
  // MandalasGUI+Dakmode 这类「零 block 贴图」的界面包，靠这条链路才算真的导入成功。
  const RP_GUI_ALIAS = {
    crosshair: ['crosshair'], hotbar: ['hotbar'],
    hotbar_selection: ['hotbar_sel'], hotbar_offhand_left: ['hotbar_offhand_left'],
    button_highlighted: ['button_hl'], button_disabled: ['button_dis'],
    slider_handle_highlighted: ['slider_handle_hl'], slider_highlighted: ['slider'],
    text_field_highlighted: ['text_field_hl'], tab_highlighted: ['tab_hl'],
    hotbar_selection: ['hotbar_sel'],
    options_background_: ['options_bg', 'menu_bg'],
    options_background: ['options_bg', 'menu_bg'],
    experience_bar_background: ['xp_bg'], experience_bar_progress: ['xp_fg'],
    crosshair_attack_indicator_background: ['attack_bg'],
    crosshair_attack_indicator_progress: ['attack_progress'],
    crosshair_attack_indicator_full: ['attack_full'],
    effect_background: ['effect_bg'], effect_background_ambient: ['effect_bg_ambient'],
    page_forward: ['widget_page_forward'], page_backward: ['widget_page_backward'],
    page_forward_highlighted: ['widget_page_forward_highlighted'],
    page_backward_highlighted: ['widget_page_backward_highlighted'],
    scroller_background: ['wscroller_bg'], checkbox: ['checkbox'], tab_selected: ['tab_sel'],
  };
  function rpGuiCandidates(name) {
    const base = String(name).split('/').pop().replace(/\.png$/i, '');
    const tag = '/textures/gui/';
    const gi = name.indexOf(tag);
    let path = '';
    if (gi >= 0) path = name.slice(gi + tag.length, -4).replace(/\//g, '_');
    const short = path.replace(/^sprites_(hud|widget|container)_/, '');
    const out = [];
    const add = (k) => { if (k && out.indexOf(k) < 0) out.push(k); };
    (RP_GUI_ALIAS[base] || []).forEach(add);
    add(base);
    add(path); add(short);
    if (/(^|_)container_/.test(path)) add('gui_' + base);
    if (/^empty_(armor_)?slot_/.test(base)) add(base.replace(/^empty_(armor_)?slot_/, 'slot_'));
    return out;
  }
  // 模组准星（CozyUI / Dynamic Crosshair）常给一张「全不透明黑底 + 白十字」，
  // 靠模组自己挖黑。原版游戏用 difference 直接画就成黑方块了。
  // 只在「整张几乎无透明 + 大面积纯黑」时抠黑，正常 GUI 贴图不受影响。
  function rpChromaKey(cx, w, h) {
    try {
      const d = rpOrigGID.call(cx, 0, 0, w, h);
      const px = d.data, n = px.length / 4;
      let opaque = 0, black = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] > 200) opaque++;
        if (px[i] < 24 && px[i + 1] < 24 && px[i + 2] < 24 && px[i + 3] > 200) black++;
      }
      if (opaque < n * 0.98 || black < n * 0.45) return false;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] < 24 && px[i + 1] < 24 && px[i + 2] < 24) px[i + 3] = 0;
      }
      cx.putImageData(d, 0, 0);
      return true;
    } catch (e) { return false; }
  }
  // 高清包（32x / 64x / 128x）整张缩到游戏原生尺寸，而不是裁左上角；
  // 竖条动画（16xN 或 CozyUI 的 hotbar_selection 96x736）只取第一帧。
  async function rpPngBitmap(data, tw, th, frameIndex, keepOriginal, forcedFrameH) {
    const blob = new Blob([data], { type: 'image/png' });
    let bmp = null;
    if (typeof createImageBitmap === 'function') {
      try { bmp = await createImageBitmap(blob); } catch (e) { /* 落到 Image */ }
    }
    if (!bmp) {
      const U = W.URL || URL;
      const url = U.createObjectURL(blob);
      const im = new Image();
      await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; });
      bmp = im;   // blob URL 不能立刻 revoke，Image 还要用
    }
    const w0 = bmp.width || bmp.naturalWidth || 16;
    const h0 = bmp.height || bmp.naturalHeight || 16;
    const ow = tw || w0, oh = th || h0;
    // 高清九宫格控件：保留原分辨率，交给 rpInstallHiResHook 按比例取边框。
    // 先压回 200x20 再被游戏硬放大，会两次丢细节，正是「像素感很重」的来源。
    if (keepOriginal && w0 !== ow && h0 !== oh) return { img: bmp, w: w0, h: h0, hi: true };
    const cv = document.createElement('canvas');
    cv.width = ow; cv.height = oh;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = true;    // 高质量下采样，别用最近邻切出硬锯齿
    cx.imageSmoothingQuality = 'high';
    cx.clearRect(0, 0, ow, oh);         // 保证透明贴图不会带黑底
    const frameH = forcedFrameH > 0 ? forcedFrameH : Math.round(w0 * oh / ow);
    if (frameH > 0 && h0 >= frameH * 2) {
      const frames = Math.max(1, Math.round(h0 / frameH));
      // 入场动画取稳定末帧；普通竖条动画（水/岩浆）取首帧
      const idx = Math.max(0, Math.min(frames - 1, frameIndex == null ? 0 : frameIndex));
      const sy = idx * frameH;
      cx.drawImage(bmp, 0, sy, w0, Math.min(frameH, h0 - sy), 0, 0, ow, oh);
    } else cx.drawImage(bmp, 0, 0, w0, h0, 0, 0, ow, oh);
    rpChromaKey(cx, ow, oh);
    try { if (bmp.close) bmp.close(); } catch (e) { /* noop */ }
    return { img: cv, w: ow, h: oh };
  }
  const RP_REPEAT_TEX = ['rain', 'snowfall', 'end_portal_tex', 'end_sky', 'end_crystal_beam', 'beacon_beam'];
  // render.init() 把一批 images 预先 tex2D 上传过（moon0..7 / sun / rain / 生物…）。
  // 这些光换 images 是看不到的，得把对应的 WebGL 纹理也重传一遍。
  function rpReuploadTex(k, img) {
    try {
      const R = state.game && state.game.renderer;
      if (!R || !R.entityTex || !R.entityTex[k] || typeof R.tex2D !== 'function') return;
      const old = R.entityTex[k];
      R.entityTex[k] = R.tex2D(img, RP_REPEAT_TEX.indexOf(k) >= 0);
      if (R.gl && old && R.gl.deleteTexture) R.gl.deleteTexture(old);
    } catch (e) { /* noop */ }
  }
  function rpColormap(R, k, img) {
    try {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 256;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const d = rpOrigGID.call(x, 0, 0, 256, 256).data;
      if (k === 'grass_color') R.grassMap = d;
      else R.foliageMap = d;
    } catch (e) { /* noop */ }
  }
  function rpApplyGui() {
    const g = state.game;
    const R = g && g.renderer;
    const imgs = R && R.images;
    if (!imgs) return 0;
    const on = rpEnabled();
    let n = 0;
    for (const [k, rec] of rp.gui) {
      if (!Object.prototype.hasOwnProperty.call(imgs, k)) continue;
      if (!rp.guiOrig.has(k)) rp.guiOrig.set(k, imgs[k]);
      const orig = rp.guiOrig.get(k);
      const img = on ? rec.img : orig;
      // 高清九宫格贴图保留原分辨率，尺寸自然不等于原版，不能按普通贴图校验
      if (on && !rec.hi && (!orig || rec.w !== orig.width || rec.h !== orig.height)) continue;
      imgs[k] = img;
      if (img) {
        rpReuploadTex(k, img);
        if (k === 'grass_color' || k === 'foliage_color') rpColormap(R, k, img);
      }
      n++;
    }
    try {
      const u = g.ui;
      if (u) { if (u.tileCache) u.tileCache.clear(); if (u.dirtTile) u.dirtTile = null; }
    } catch (e) { /* noop */ }
    rp.guiApplied = n;
    rpInstallHiResHook();
    return n;
  }
  // 游戏 ui.nine() 把 im.width 当源尺寸、border=3 当边框。高清图是 4x 的，
  // 直接喂会把 3px 边框变成 3/4，所以这里重写九宫格：源坐标 x scale、目标坐标不变。
  // 只影响 rp.guiHi 里登记的键，其它按钮走原函数；异常时回退并恢复平滑状态。
  function rpInstallHiResHook() {
    try {
      const ui = state.game && state.game.ui;
      if (!ui || ui.__cometHiRes) return;
      const proto = Object.getPrototypeOf(ui);
      if (!proto || typeof proto.nine !== 'function') return;
      const orig = proto.nine;
      proto.nine = function (name, x, y, w, h, border) {
        const s = rp.guiHi && rp.guiHi.get(name);
        const im = this.img && this.img[name];
        if (!s || !im || !im.width) return orig.call(this, name, x, y, w, h, border);
        const b = border, B = b * s, iw = im.width, ih = im.height;
        if (iw < B * 2 || ih < B * 2) return orig.call(this, name, x, y, w, h, border);
        const c = this.ctx, sm = c.imageSmoothingEnabled, q = c.imageSmoothingQuality;
        c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
        try {
          c.drawImage(im, 0, 0, B, B, x, y, b, b);
          c.drawImage(im, iw - B, 0, B, B, x + w - b, y, b, b);
          c.drawImage(im, 0, ih - B, B, B, x, y + h - b, b, b);
          c.drawImage(im, iw - B, ih - B, B, B, x + w - b, y + h - b, b, b);
          c.drawImage(im, B, 0, iw - 2 * B, B, x + b, y, w - 2 * b, b);
          c.drawImage(im, B, ih - B, iw - 2 * B, B, x + b, y + h - b, w - 2 * b, b);
          c.drawImage(im, 0, B, B, ih - 2 * B, x, y + b, b, h - 2 * b);
          c.drawImage(im, iw - B, B, B, ih - 2 * B, x + w - b, y + b, b, h - 2 * b);
          c.drawImage(im, B, B, iw - 2 * B, ih - 2 * B, x + b, y + b, w - 2 * b, h - 2 * b);
        } catch (e) { orig.call(this, name, x, y, w, h, border); }
        finally { c.imageSmoothingEnabled = sm; c.imageSmoothingQuality = q; }
      };
      ui.__cometHiRes = true;
    } catch (e) { /* noop */ }
  }
  function rpGuiTick() {
    try {
      const R = state.game && state.game.renderer;
      const imgs = R && R.images;
      if (!imgs) return;
      if (rp.iconsDirty) rp.iconsDirty = !rpRefreshIcons();
      // 游戏重载 / 切世界会换 renderer.images 对象；脏标记或对象变了就重新贴一次
      if (rp.guiDirty || rp.etexDirty || rp.guiBound !== imgs) {
        rp.guiBound = imgs;
        const n = rpApplyGui();
        const m = rpApplyEntities();
        rp.guiDirty = !(n > 0 || !rp.gui.size);
        rp.etexDirty = !(m > 0 || !rp.etex.size);
      }
    } catch (e) { /* noop */ }
  }

  // 从 data:image/png;base64,... 的头 32 个字符读出 IHDR 尺寸，
  // 这样即使 renderer 还没初始化（在标题页 / 选项页导包）也知道该缩放到多大。
  function rpPngDimOf(dataUrl) {
    try {
      const b64 = String(dataUrl).split(',')[1] || '';
      const bin = (typeof W.atob === 'function' ? W.atob : atob)(b64.slice(0, 32));
      const u = new Uint8Array(24);
      for (let i = 0; i < 24; i++) u[i] = bin.charCodeAt(i) & 255;
      const dv = new DataView(u.buffer);
      return [dv.getUint32(16), dv.getUint32(20)];
    } catch (e) { return null; }
  }
  // 直接读 PNG IHDR，不用解码整张图
  function rpPngHeader(b) {
    try {
      if (!b || b.length < 24) return null;
      const dv = new DataView(b.buffer, b.byteOffset, Math.min(b.byteLength, 24));
      if (dv.getUint32(0) !== 0x89504e47) return null;
      return [dv.getUint32(16), dv.getUint32(20)];
    } catch (e) { return null; }
  }
  // GUI 贴图宽度只可能是目标宽度的 1/2/4/8/16 倍（材质包分辨率档位）。
  // 像 CozyUI 的 button_highlighted.png 320x1280（目标 200x20，1.6 倍）其实是
  // hover 动画精灵图，不是按钮；硬压扁会把动画第一帧的白色装饰挤进按钮中间。
  // 合法竖条动画（hotbar_selection 96x736 对 24x23）按整数帧放行。
  const RP_NINE_KEYS = ['button', 'button_hl', 'button_dis', 'slider',
    'slider_handle', 'slider_handle_hl', 'text_field', 'text_field_hl',
    'wscroller', 'wscroller_bg'];
  // 返回贴图分类，而不是简单放行/拦下：
  //   normal = 标准 1/2/4/8/16 倍高清图；
  //   anim   = 帧宽高比与目标一致的竖条入场动画（CozyUI hover 320x1280 -> 200x20）；
  //   reject = 路径反查认错的图（粒子 / 药水 / 别的控件）。
  function rpScaleInfo(src, dst) {
    if (!src || !dst || !src[0] || !dst[0]) return { mode: 'normal', scale: 1, frameH: 0, frames: 1 };
    const r = src[0] / dst[0];
    const std = [1, 2, 4, 8, 16].find((k) => Math.abs(r - k) < 0.09);
    if (std) return { mode: 'normal', scale: std, frameH: dst[1] * std, frames: 1 };
    // 帧高由【源图结构】决定，不能用目标比例推算：
    // CozyUI 320x1280 是 16 帧 x 320x80，按 200x20 推会误算成 32，
    // 只取到第一帧上半截，白色箭头就变成按钮中间的两只尖角。
    const fh = Math.round(src[0] / 4);   // 4x 包：按钮帧高 = 逻辑高 x 4
    const frames = Math.round(src[1] / fh);
    if (fh > 0 && frames >= 4 && Math.abs(src[1] / fh - frames) < 0.12) {
      return { mode: 'anim', scale: r, frameH: fh, frames: frames };
    }
    return { mode: 'reject', scale: r, frameH: 0, frames: 1 };
  }
  function rpScaleGuard(src, dst) { return rpScaleInfo(src, dst).mode !== 'reject'; }
  function rpPackById(id) { return rp.packs.find((p) => p.id === id) || null; }
  function rpNewId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function rpTask(fn) { rp.task = rp.task.then(fn, fn); return rp.task; }
  function rpKeySet() {
    const A = W.ASSETS || {};
    const imgs = (state.game && state.game.renderer && state.game.renderer.images) || null;
    return { imgs, assets: A.images || null, tiles: A.tiles || null, etex: W.ETEX || null };
  }
  const RP_MOON = {
    full_moon: 'moon0', waning_gibbous: 'moon1', last_quarter: 'moon2', waning_crescent: 'moon3',
    new_moon: 'moon4', waxing_crescent: 'moon5', first_quarter: 'moon6', waxing_gibbous: 'moon7',
  };
  // 按 MC 资源包的目录结构把一张 PNG 映射到游戏里真正消费它的地方。
  // 严格按类别分派，避免 gui/advancements/backgrounds/stone.png 之类误伤方块贴图。
  function rpKeyFor(name, ks) {
    // CozyUI 这类整合包里带 dynamiccrosshair / jei / emi / inventoryhud 等
    // 其它 namespace 的同名贴图，它们不是给原版 MC 用的，混进来会把准星盖成黑块。
    const ns = name.match(/assets\/([^/]+)\/(?:textures|optifine|mcpatcher|cit)\//i);
    if (ns && ns[1].toLowerCase() !== 'minecraft') return null;
    let rel = null;
    const gi = name.indexOf('/textures/');
    if (gi >= 0) rel = name.slice(gi + '/textures/'.length).replace(/\.png$/i, '');
    else {
      // 没有 /textures/ 段：OptiFine 扩展、旧包直接放在 assets/minecraft 下、
      // 或者干脆不带 assets 前缀。尽量按目录名猜一次。
      const m = name.match(/(?:^|\/)(block|blocks|item|items|gui|entity|environment|mob_effect|misc|font)\/(.+)\.png$/i);
      if (m) rel = m[1] + '/' + m[2];
      else return null;   // optifine 自定义 GUI 等：原版没有对应槽位
    }
    // 1.7 及更早的复数目录 / 多余前缀
    rel = rel.replace(/^blocks\//, 'block/').replace(/^items\//, 'item/')
             .replace(/^textures\//, '');
    const parts = rel.split('/');
    const cat = parts[0], rest = parts.slice(1), base = rest[rest.length - 1] || '';
    const has = (o, k) => !!(o && Object.prototype.hasOwnProperty.call(o, k));
    const hasT = (k) => has(ks.tiles, k);
    const hasI = (k) => has(ks.imgs, k) || has(ks.assets, k);
    if (cat === 'block') return hasT(base) ? { type: 'tile', key: base, cat: 'block' } : null;
    if (cat === 'item') {
      for (const k of ['i_' + base, base]) {
        if (hasT(k)) return { type: 'tile', key: k, cat: 'item' };
        if (hasI(k)) return { type: 'img', key: k, cat: 'item' };
      }
      return null;
    }
    // decor.js / items3.js 会调 r.etex('painting/...') 与 r.etex('map/...')，
    // 这两类同样走 window.ETEX，之前只认 entity/ 白白漏了 89 张。
    if (cat === 'entity' || cat === 'painting' || cat === 'map') {
      const p = cat + '/' + rest.join('/');
      if (has(ks.etex, p)) return { type: 'etex', key: p, cat: 'entity' };
      for (const k of [base, '@' + p]) if (hasI(k)) return { type: 'img', key: k, cat: 'entity' };
      return null;
    }
    if (cat === 'gui') {
      for (const k of rpGuiCandidates(name)) if (hasI(k)) return { type: 'img', key: k, cat: 'gui' };
      return null;
    }
    if (cat === 'environment') {
      for (const k of [RP_MOON[base] || base, base]) if (hasI(k)) return { type: 'img', key: k, cat: 'env' };
      return null;
    }
    if (cat === 'mob_effect') {
      const k = 'eff_' + base;
      return hasI(k) ? { type: 'img', key: k, cat: 'fx' } : null;
    }
    if (cat === 'misc' || cat === 'font') {
      for (const k of [base, 'font_' + base, '@' + rel]) if (hasI(k)) return { type: 'img', key: k, cat: 'misc' };
      return null;
    }
    return null;
  }
  function rpTargetDim(k, ks) {
    if (ks.assets && ks.assets[k]) {
      const d = rpPngDimOf(ks.assets[k]);
      if (d && d[0] > 0 && d[1] > 0) return d;   // 原版尺寸最可靠
    }
    if (ks.imgs && ks.imgs[k] && ks.imgs[k].width) return [ks.imgs[k].width, ks.imgs[k].height];
    return null;
  }
  // 实体贴图走 window.ETEX：游戏的 Renderer.etex() 每次 new Image() 读它。
  // 换掉值之后必须把已上传的 WebGL 纹理和缓存清掉，下一帧才会重新加载。
  function rpApplyEntities() {
    const R = state.game && state.game.renderer;
    const E = W.ETEX;
    if (!R || !E) return 0;
    const on = rpEnabled();
    const U = W.URL || URL;
    for (const [p, orig] of rp.etexOrig) {
      if (on && rp.etex.has(p)) continue;
      if (rp.etexUrl.has(p)) {
        try { U.revokeObjectURL(rp.etexUrl.get(p)); } catch (e) { /* noop */ }
        rp.etexUrl.delete(p);
      }
      if (orig != null) E[p] = orig;
    }
    if (on) {
      for (const [p, b] of rp.etex) {
        if (!rp.etexOrig.has(p)) rp.etexOrig.set(p, E[p]);
        if (rp.etexUrl.has(p)) { try { U.revokeObjectURL(rp.etexUrl.get(p)); } catch (e) { /* noop */ } }
        const url = U.createObjectURL(new Blob([b], { type: 'image/png' }));
        rp.etexUrl.set(p, url);
        E[p] = url;
      }
    }
    try {
      const gl = R.gl, et = R.entityTex || {};
      for (const k of Object.keys(et)) {
        if (k.charAt(0) !== '@') continue;
        try { if (gl && et[k] && gl.deleteTexture) gl.deleteTexture(et[k]); } catch (e) { /* noop */ }
        delete et[k];
      }
      for (const k of Object.keys(R.images || {})) if (k.charAt(0) === '@') delete R.images[k];
      if (R._etexWait && R._etexWait.clear) R._etexWait.clear();
    } catch (e) { /* noop */ }
    rp.etexApplied = on ? rp.etex.size : 0;
    return rp.etexApplied;
  }
  // 方块物品图标是 buildIcons() 离线 3D 渲出来的；平面物品图标走 stripCanvas。
  // 两者都带缓存，替换贴图后必须重建，否则物品栏里还是旧图。
  function rpRefreshIcons() {
    try {
      const g = state.game, R = g && g.renderer;
      if (!R || !R.stripCanvas) return false;
      const u = g.ui;
      if (u) { if (u.icons && u.icons.clear) u.icons.clear(); u.iconsOf = null; u.icons = new Map(); }
      if (typeof R.buildIcons === 'function') R.buildIcons();
      return true;
    } catch (e) { return false; }
  }
  function rpSlotTotal(ks) {
    let n = 0;
    if (ks.tiles) n += Object.keys(ks.tiles).length;      // 方块 + 物品图标图集
    if (ks.assets) n += Object.keys(ks.assets).length;    // GUI / HUD / 环境
    if (ks.etex) n += Object.keys(ks.etex).length;        // 实体模型
    return n;
  }
  async function rpRebuild() {
    const ks = rpKeySet();
    const tiles = new Map(), imgRaw = new Map(), etex = new Map();
    if (rpEnabled() && !rp.suspended) {
      for (let i = rp.order.length - 1; i >= 0; i--) {
        const pk = rpPackById(rp.order[i]);
        if (!pk) continue;
        for (const [k, v] of (pk.tiles || new Map())) tiles.set(k, v);
        for (const it of (pk.imgs || pk.gui || [])) imgRaw.set(it.k, it.b);
        for (const it of (pk.etex || [])) etex.set(it.k, it.b);
      }
    }
    const gui = new Map();
    const skipped = [];
    const hi = new Map();
    for (const [k, b] of imgRaw) {
      const d = rpTargetDim(k, ks);
      const sd = rpPngHeader(b);
      const si = rpScaleInfo(sd, d);
      if (si.mode === 'reject') { skipped.push(k); continue; }
      // 入场动画取第 0 帧（唯一带完整发光描边的一帧），普通竖条动画取首帧
      const frame = 0;
      const hiRes = si.mode === 'normal' && si.scale >= 2 && RP_NINE_KEYS.indexOf(k) >= 0;
      try {
        const rec = await rpPngBitmap(b, d && d[0], d && d[1], frame, hiRes, si.frameH);
        gui.set(k, rec);
        if (hiRes && rec.hi) hi.set(k, si.scale);
      } catch (e) { /* 单张失败跳过 */ }
    }
    rp.skippedAspect = skipped;
    rp.guiHi = hi;
    // 换包 / 关包前先把上一轮的界面贴图还原，否则被移除的键会一直残留
    if (ks.imgs) {
      for (const [k, o] of rp.guiOrig) ks.imgs[k] = o;
      rp.guiOrig.clear();
    }
    rp.tiles = tiles; rp.loaded = tiles.size;
    rp.gui = gui; rp.guiCount = gui.size;
    rp.etex = etex;
    const total = rpSlotTotal(ks);
    const used = tiles.size + gui.size + etex.size;
    rp.coverage = { used: used, total: total, pct: total ? Math.round(used / total * 1000) / 10 : 0 };
    rp.guiDirty = true; rp.guiBound = null;
    rp.etexDirty = true; rp.iconsDirty = true;
    rpReupload();
    rpApplyGui();
    rpApplyEntities();
    rp.iconsDirty = !rpRefreshIcons();
    try { rpMenuRender(); } catch (e) { /* noop */ }
    if (rp.screen && rp.screen.layout) rp.screen.layout();
    return { block: tiles.size, gui: gui.size, entity: etex.size };
  }
  async function rpSaveLibrary() {
    const db = await rpOpenDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tiles', 'readwrite');
      tx.objectStore('tiles').put({ packs: rp.packs, order: rp.order }, 'library');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  async function rpReapply() {
    return rpTask(async () => {
      rp.suspended = false;
      const r = await rpRebuild();
      const msg = '已重新应用：' + rp.order.length + ' 个包 / 方块物品 ' + r.block +
        ' 张 / 界面 ' + r.gui + ' 张 / 实体 ' + r.entity + ' 张';
      rpStatus(msg);
      pushNotification('材质包', msg);
      return r;
    });
  }
  function rpSetEnabled(on) {
    cfg.settings['resourcepack.enabled'] = !!on;
    __sCache = null;
    try { saveCfg(); } catch (e) { /* noop */ }
    rpTask(async () => { await rpRebuild(); rpMenuRender(); });
  }
  async function rpAddPack(f) {
    rpStatus('正在解压 ' + f.name);
    pushNotification('材质包', '正在解压 ' + f.name + '…');
    const buf = await f.arrayBuffer();
    const entries = await rpUnzip(buf);
    const cat = {};
    for (const e of entries) {
      const cm = e.name.match(/\/textures\/([^/]+)\//);
      const k = cm ? cm[1] : 'other';
      cat[k] = (cat[k] || 0) + 1;
    }
    rpStatus('正在匹配贴图（' + entries.length + ' 个文件）…');
    // pack.mcmeta 里带了包描述和 pack_format，顺手读出来显示在界面上
    let desc = '';
    const meta = entries.find((e) => e.kind === 'meta' && e.data);
    if (meta) {
      try {
        const j = JSON.parse(new TextDecoder().decode(meta.data));
        const d = j && j.pack && j.pack.description;
        desc = String(typeof d === 'object' ? (d.text || d.translate || '') : (d || ''))
          .replace(/§./g, '').slice(0, 48);
      } catch (e) { /* noop */ }
    }
    const ks = rpKeySet();
    const tiles = new Map(), imgs = new Map(), etex = new Map();
    const n = { block: 0, item: 0, gui: 0, entity: 0, env: 0, fx: 0, misc: 0, skip: 0,
      model: 0, noslot: 0, otherns: 0, badAspect: 0 };
    for (const e of entries) {
      if (e.kind === 'model') n.model++;
      else if (e.kind === 'noslot') n.noslot++;
    }
    for (const e of entries) {
      if (!e.data) { n.skip++; continue; }
      const info = rpKeyFor(e.name, ks);
      if (!info) {
        n.skip++;
        const nsm = e.name.match(/assets\/([^/]+)\//i);
        if (nsm && nsm[1].toLowerCase() !== 'minecraft') n.otherns++;
        continue;
      }
      const b = new Uint8Array(e.data);
      try {
        if (info.type === 'tile') { tiles.set(info.key, await rpDecode(b)); n[info.cat]++; }
        else if (info.type === 'etex') { etex.set(info.key, b); n.entity++; }
        else { imgs.set(info.key, b); n[info.cat]++; }
      } catch (err) { n.skip++; }
    }
    // 比例异常的 GUI 贴图不是同一类元素，别入库；hover/disabled 尽量用同包基础按钮兜底
    for (const [k, b] of Array.from(imgs)) {
      const d = ks.assets && ks.assets[k] ? rpPngDimOf(ks.assets[k]) : null;
      const sd = rpPngHeader(b);
      if (!d || !sd || rpScaleGuard(sd, d)) continue;
      n.badAspect++;
      imgs.delete(k);
      const base = k.replace(/_hl$|_dis$/, '');
      if (base !== k && imgs.has(base)) imgs.set(k, imgs.get(base));
    }
    if (!tiles.size && !imgs.size && !etex.size) {
      let msg;
      if (n.model > 0) {
        msg = '这是模型 / blockstates 包（' + n.model + ' 个 JSON），不含贴图；' +
          'OpusMC 的方块模型由代码生成，不读取模型 JSON，无法应用';
      } else if (n.otherns > 0) {
        msg = '包内 ' + n.otherns + ' 张贴图属于其它 mod 命名空间（JEI / EMI / OptiFine 等），原版没有对应槽位';
      } else {
        const parts = Object.keys(cat).map((k) => k + ' ' + cat[k]);
        msg = (parts.length ? '包内：' + parts.join(' / ') : '包里没有 PNG 贴图') + '；没有能对上游戏的贴图';
      }
      rpStatus(msg);
      pushNotification('材质包', msg);
      return null;
    }
    rp.stats = n;
    rpStatus('正在应用 ' + (tiles.size + imgs.size + etex.size) + ' 张贴图…');
    const name = String(f.name || '资源包').replace(/\.zip$/i, '');
    let pk = rp.packs.find((p) => p.name === name);
    if (!pk) {
      pk = { id: rpNewId(), name: name };
      rp.packs.push(pk);
      if (rp.order.indexOf(pk.id) < 0) rp.order.push(pk.id);
    }
    pk.tiles = tiles;
    pk.imgs = Array.from(imgs, ([k, b]) => ({ k, b }));
    pk.gui = pk.imgs;                    // 兼容 v1.23 存档字段
    pk.etex = Array.from(etex, ([k, b]) => ({ k, b }));
    pk.nBlock = n.block; pk.nItem = n.item; pk.nGui = n.gui;
    pk.nEntity = n.entity; pk.nEnv = n.env; pk.nFx = n.fx; pk.nMisc = n.misc;
    pk.nSkip = n.skip; pk.desc = desc;
    rp.packInfo = { cat, total: entries.length, stats: n, desc: desc };
    if (getS('resourcepack', 'enabled') === false) {
      cfg.settings['resourcepack.enabled'] = true;
      __sCache = null;
      try { saveCfg(); } catch (e) { /* noop */ }
    }
    try { await rpSaveLibrary(); } catch (e) { /* 本次会话有效 */ }
    rp.suspended = false;   // 用户主动导入 = 现在就要用
    const r = await rpRebuild();
    const msg = '已应用「' + name + '」：方块 ' + n.block + ' / 物品 ' + n.item +
      ' / 界面 ' + n.gui + ' / 实体 ' + n.entity + ' / 环境 ' + n.env +
      ' / 药水 ' + n.fx + (n.badAspect ? ' / 拦下比例异常 ' + n.badAspect + ' 张' : '') +
      '，共 ' + rp.order.length + ' 个包';
    rpStatus(msg);
    pushNotification('材质包', msg);
    extLog && extLog(msg, 'profile');
    return pk;
  }

  // ---- 零依赖 zip 解析（stored / deflate） ----
  function rpInflate(raw) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('浏览器不支持 DecompressionStream'));
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([raw]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then((b) => new Uint8Array(b));
  }
  async function rpUnzip(buf) {
    const dv = new DataView(buf);
    const total = buf.byteLength;
    let eocd = -1;
    const floor = Math.max(0, total - 65557);
    for (let i = total - 22; i >= floor; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 zip 资源包');
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const out = [];
    const jobs = [];
    for (let i = 0; i < count && off + 46 <= total; i++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const compSize = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      const localOff = dv.getUint32(off + 42, true);
      let name = '';
      try { name = dec.decode(new Uint8Array(buf, off + 46, nameLen)); } catch (e) { /* noop */ }
      off += 46 + nameLen + extraLen + commentLen;
      const isPng = /\.png$/i.test(name);
      const isMeta = /pack\.mcmeta$/i.test(name);
      if (!isPng && !isMeta) {
        // 把「这个包到底装了什么」记下来，导入失败时才能说清楚原因
        if (/\/(blockstates|models)\/.*\.json$/i.test(name)) out.push({ name, data: null, kind: 'model' });
        continue;
      }
      if (/pack\.png$/i.test(name)) continue;             // 包图标不是贴图
      // 这些目录游戏没有对应槽位，别白解压；painting / map 是 ETEX 真实消费的，不能跳
      if (/\/(particle|trims|font|colormap)\//i.test(name)) {
        out.push({ name, data: null, skip: true, kind: 'noslot' });
        continue;
      }
      // 其余 PNG 一律收下：optifine / mcpatcher / 旧版 textures/blocks /
      // 没有 assets 前缀的包，交给 rpKeyFor 去归一化判断
      if (localOff + 30 > total) continue;
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      if (start + compSize > total) continue;
      jobs.push({ name, method, raw: new Uint8Array(buf, start, compSize), kind: isMeta ? 'meta' : null });
    }
    // 分批并行解压：GUI 包动辄 500+ 张，一张一张 await 会卡住好几秒，
    // 用户以为「导入没反应」就会连点，越点越乱。
    for (let i = 0; i < jobs.length; i += 24) {
      const batch = jobs.slice(i, i + 24);
      const done = await Promise.all(batch.map(async (j) => {
        try { return { name: j.name, kind: j.kind, data: j.method === 0 ? j.raw : await rpInflate(j.raw) }; }
        catch (e) { return null; }
      }));
      for (const d of done) if (d) out.push(d);
    }
    return out;
  }

  // ---- PNG -> 16x16 RGBA（动画竖条自动取首帧） ----
  async function rpDecode(data) {
    const blob = new Blob([data], { type: 'image/png' });
    let bmp = null;
    try {
      bmp = await createImageBitmap(blob);
      const cv = document.createElement('canvas');
      cv.width = 16; cv.height = 16;
      const cx = cv.getContext('2d');
      cx.imageSmoothingEnabled = true;
      // 16x 竖条是动画多帧（水 / 岩浆），取第一帧；32x / 64x 高清包整张缩到 16x16，
      // 否则 Faithful 这类包会只拿到左上角一小块，看起来像贴错图。
      if (bmp.width === 16 && bmp.height > 16) cx.drawImage(bmp, 0, 0, 16, 16, 0, 0, 16, 16);
      else cx.drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, 0, 16, 16);
      const img = rpOrigGID.call(cx, 0, 0, 16, 16);
      return new Uint8ClampedArray(img.data);
    } finally {
      try { if (bmp && bmp.close) bmp.close(); } catch (e) { /* noop */ }
    }
  }

  // ---- 像素注入：识别 strip 尺寸，按 tile 索引覆写 ----
  function rpPatchGrid(img, w, h) {
    if (!rpEnabled() || !rp.tiles.size) return 0;
    const A = W.ASSETS;
    if (!A || !A.tiles) return 0;
    const cols = A.cols || 64;
    const n = A.count || Object.keys(A.tiles).length;
    const stripW = cols * 16;
    const stripH = Math.ceil(n / cols) * 16;
    if (w !== stripW || h !== stripH) return 0;
    if (!img || !img.data) return 0;
    const dst = img.data;
    let done = 0;
    for (const [name, px] of rp.tiles) {
      const k = A.tiles[name];
      if (k == null || !px || px.length < 1024) continue;
      const x0 = (k % cols) * 16, y0 = Math.floor(k / cols) * 16;
      if (y0 + 16 > h) continue;
      for (let yy = 0; yy < 16; yy++) {
        const di = ((y0 + yy) * w + x0) * 4;
        const si = yy * 64;
        for (let xx = 0; xx < 64; xx++) dst[di + xx] = px[si + xx];
      }
      done++;
    }
    rp.lastGrid = img;
    rp.lastW = w;
    rp.lastH = h;
    rp.patched = done;
    return done;
  }

  // ---- 在 document-start 立刻装 hook（ASSETS 可能还没加载，运行时再读） ----
  const rpOrigGID = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function (sx, sy, sw, sh) {
    const res = rpOrigGID.apply(this, arguments);
    try { rpPatchGrid(res, sw, sh); } catch (e) { /* noop */ }
    return res;
  };
  if (W.WebGL2RenderingContext && W.WebGL2RenderingContext.prototype.texStorage3D) {
    const rpOrigStorage = W.WebGL2RenderingContext.prototype.texStorage3D;
    W.WebGL2RenderingContext.prototype.texStorage3D = function (target, levels, ifmt, w, h, d) {
      try {
        if (target === this.TEXTURE_2D_ARRAY && w === 16) {
          rp.glInfo = { levels, F: Math.max(1, h / 16), layers: d };
          // 游戏在 bindTexture 之后立刻 texStorage3D，此刻能拿到真正的纹理对象；
          // renderer 上并没有 texArray 字段，不抓就永远没法主动重传。
          try { rp.glTex = this.getParameter(this.TEXTURE_BINDING_2D_ARRAY); } catch (e) { /* noop */ }
        }
      } catch (e) { /* noop */ }
      return rpOrigStorage.apply(this, arguments);
    };
  }

  // ---- mip 重算（与游戏一致：box 平均，尺寸按 tile 竖排） ----
  function rpMip(src, size, n) {
    const ns = Math.max(1, size >> 1);
    const out = new Uint8Array(n * ns * ns * 4);
    const row = size * 4;
    for (let k = 0; k < n; k++) {
      for (let y = 0; y < ns; y++) {
        for (let x = 0; x < ns; x++) {
          const i = (k * size * size + y * 2 * size + x * 2) * 4;
          const o = (k * ns * ns + y * ns + x) * 4;
          for (let c = 0; c < 4; c++) {
            out[o + c] = (src[i + c] + src[i + 4 + c] + src[i + row + c] + src[i + row + 4 + c]) >> 2;
          }
        }
      }
    }
    return out;
  }

  // ---- 导入后立即重传纹理，不用刷新页面 ----
  function rpReupload() {
    try {
      const R = state.game && state.game.renderer;
      const gl = R && R.gl;
      const A = W.ASSETS;
      if (!gl || !rp.glTex || !A || !A.tiles || !rp.glInfo || !R.stripCanvas) return false;
      const cv = R.stripCanvas;
      const cx = cv.getContext('2d');
      const cols = A.cols || 64;
      const n = A.count || Object.keys(A.tiles).length;
      // 首次留一份原版像素；之后每轮都从它重建，避免上一包的残留在 strip 上越积越多
      if (!rp.stripBase) rp.stripBase = rpOrigGID.call(cx, 0, 0, cv.width, cv.height);
      const grid = rpOrigGID.call(cx, 0, 0, cv.width, cv.height);
      grid.data.set(rp.stripBase.data);
      rpPatchGrid(grid, cv.width, cv.height);
      // 写回 stripCanvas：drawFlatIcon（平面物品图标）直接 drawImage 它，
      // 不走 getImageData 的 hook，所以只改返回值是看不到的。
      try {
        const tmp = document.createElement('canvas');
        tmp.width = cv.width; tmp.height = cv.height;
        tmp.getContext('2d').putImageData(grid, 0, 0);
        cx.clearRect(0, 0, cv.width, cv.height);
        cx.drawImage(tmp, 0, 0);
      } catch (e) { /* noop */ }
      const data = new Uint8Array(n * 1024);
      for (let k = 0; k < n; k++) {
        const x0 = (k % cols) * 16, y0 = Math.floor(k / cols) * 16;
        for (let y = 0; y < 16; y++) {
          const from = ((y0 + y) * cv.width + x0) * 4;
          data.set(grid.data.subarray(from, from + 64), (k * 16 + y) * 64);
        }
      }
      const { levels, F, layers } = rp.glInfo;
      let cur = new Uint8Array(data);
      let size = 16;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, rp.glTex);
      for (let level = 0; level < levels; level++) {
        const want = layers * F * size * size * 4;
        let px = cur;
        if (px.length < want) { const p = new Uint8Array(want); p.set(px); px = p; }
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, level, 0, 0, 0, size, size * F, layers, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (level < levels - 1) cur = rpMip(cur, size, n);
        size >>= 1;
      }
      return true;
    } catch (e) {
      pushNotification('材质包', '重传失败：' + e.message);
      return false;
    }
  }

  // ---- IndexedDB：保存解压后的 16x16 像素（紧凑，约 1KB/张） ----
  function rpOpenDB() {
    return new Promise((resolve, reject) => {
      if (rp.db) { resolve(rp.db); return; }
      if (typeof indexedDB === 'undefined') { reject(new Error('无 IndexedDB')); return; }
      const req = indexedDB.open('opusmc_resourcepack', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tiles')) db.createObjectStore('tiles');
        resolve(db);
      };
      req.onsuccess = () => { rp.db = req.result; resolve(rp.db); };
      req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
    });
  }
  async function rpRestore() {
    let got = false;
    try {
      const db = await rpOpenDB();
      const read = (key) => new Promise((resolve, reject) => {
        const tx = db.transaction('tiles', 'readonly');
        const req = tx.objectStore('tiles').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const lib = await read('library');
      if (lib && Array.isArray(lib.packs) && lib.packs.length) {
        rp.packs = lib.packs.map((p) => ({
          id: p.id, name: p.name, nBlock: p.nBlock || 0, nGui: p.nGui || 0,
          tiles: p.tiles instanceof Map ? p.tiles : new Map(Object.entries(p.tiles || {})),
          imgs: Array.isArray(p.imgs) ? p.imgs : (Array.isArray(p.gui) ? p.gui : []),
          gui: Array.isArray(p.gui) ? p.gui : [],
          etex: Array.isArray(p.etex) ? p.etex : [],
          nBlock: p.nBlock || 0, nItem: p.nItem || 0, nGui: p.nGui || 0,
          nEntity: p.nEntity || 0, nEnv: p.nEnv || 0, nFx: p.nFx || 0, nMisc: p.nMisc || 0,
          nSkip: p.nSkip || 0, legacy: !!p.legacy,
        }));
        rp.order = Array.isArray(lib.order) ? lib.order.filter((id) => rpPackById(id)) : [];
        got = true;
      } else {
        // 兼容 v1.22.0 的单包存档：迁移成一个包，别让用户白导一次
        const tiles = await read('block');
        const gl = await read('gui');
        if ((tiles && tiles.size) || (Array.isArray(gl) && gl.length)) {
          const gl2 = Array.isArray(gl) ? gl : [];
          const pk = {
            id: 'migrated', name: '上次导入的资源包', legacy: true,
            tiles: tiles instanceof Map ? tiles : new Map(Object.entries(tiles || {})),
            imgs: gl2, gui: gl2, etex: [],
            nBlock: 0, nItem: 0, nGui: 0, nEntity: 0, nEnv: 0, nFx: 0,
            nMisc: 0, nSkip: 0,
          };
          pk.nBlock = pk.tiles.size; pk.nGui = gl2.length;
          rp.packs = [pk]; rp.order = [pk.id];
          got = true;
          try { await rpSaveLibrary(); } catch (e) { /* noop */ }
        }
      }
      if (got) {
        // 「记住选择」关掉：库照样读出来供界面列着，但不自动套到游戏上。
        // 下次开浏览器就是原版，不用卸载插件。
        const remember = getS('resourcepack', 'remember') !== false;
        rp.suspended = !remember;
        await rpRebuild();
        rpStatus(remember
          ? '已恢复 ' + rp.order.length + ' 个资源包：方块 ' + rp.tiles.size + ' 张 / 界面 ' + rp.guiCount + ' 张'
          : '已载入 ' + rp.packs.length + ' 个包（记住选择已关，本次不自动启用）');
      }
    } catch (e) { /* 首次运行没有存档，正常 */
    }
    return got;
  }

  // ---- 导入 ----
  function rpImport() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.zip,application/zip';
    inp.multiple = true;   // 一次可以选好几个包，按选择顺序叠加
    inp.addEventListener('change', () => {
      const fs = Array.prototype.slice.call(inp.files || []);
      if (!fs.length) return;
      rpTask(async () => { for (const f of fs) await rpAddPack(f); });
    });
    inp.click();
  }
  function rpImportFile(f) { return rpTask(() => rpAddPack(f)); }
  function rpClear() {
    return rpTask(async () => {
      rp.suspended = false;
      rp.packs = []; rp.order = []; rp.packInfo = null; rp.stats = null;
      try {
        const db = await rpOpenDB();
        const tx = db.transaction('tiles', 'readwrite');
        tx.objectStore('tiles').delete('library');
        tx.objectStore('tiles').delete('block');
        tx.objectStore('tiles').delete('gui');
      } catch (e) { /* noop */ }
      await rpRebuild();
      rpStatus('已清除全部资源包');
      pushNotification('材质包', '已恢复原版方块与界面贴图');
    });
  }

  // ==========================================================================
  // 材质包入口放在游戏「原版菜单页面」上，不塞进客户端 GUI
  // 检测 ui.screen 有 widgets/layout = 原版菜单屏；按钮是独立 DOM，风格仿原版按钮
  // ==========================================================================
  const rpMenuBtn = mk('div');
  rpMenuBtn.id = '__comet_rpbtn';
  rpMenuBtn.textContent = '资源包…';
  const rpMenu = mk('div');
  rpMenu.id = '__comet_rpmenu';
  const rpmHead = mk('div', 'cm-rmhead');
  rpmHead.append(mk('span', 'cm-rmtitle', '资源包'));
  const rpmClose = mk('div', 'cm-rmclose', '×');
  rpmHead.append(rpmClose);
  const rpmStatus = mk('div', 'cm-rmstatus', '未导入');
  const rpmHint = mk('div', 'cm-rmhint',
    '把标准 MC 资源包 .zip 拖到这里：方块贴图走纹理数组，GUI / 物品栏 / HUD 贴图直接换掉游戏界面，两类都生效。');
  const rpmRow = mk('div', 'cm-rmrow');
  const rpmImport = mk('div', 'cm-rmbtn', '导入 .zip');
  const rpmReapply = mk('div', 'cm-rmbtn', '重新应用');
  const rpmClear = mk('div', 'cm-rmbtn', '清除');
  const rpmDemo = mk('div', 'cm-rmbtn', '内置暗色 GUI 包');
  rpmRow.append(rpmImport, rpmReapply, rpmClear, rpmDemo);
  const rpmToggleRow = mk('div', 'cm-rmtoggle');
  const rpmSwitch = mk('span', 'cm-rmswitch');
  rpmSwitch.append(mk('i'));
  rpmToggleRow.append(mk('span', '', '启用材质包'), rpmSwitch);
  const rpmInfo = mk('div', 'cm-rminfo', '');
  rpMenu.append(rpmHead, rpmStatus, rpmHint, rpmRow, rpmToggleRow, rpmInfo);
  try { if (document.documentElement) document.documentElement.append(rpMenuBtn, rpMenu); } catch (e) { /* noop */ }

  function rpMenuRender() {
    try {
      let st = String(cfg.settings['resourcepack.status'] || '未导入');
      rpmStatus.textContent = st;
      const pi = rp.packInfo;
      const applied = '已应用：方块 ' + rp.tiles.size + ' 张 / 界面 ' + rp.guiCount + ' 张';
      const lib = '资源包 ' + rp.order.length + ' 个启用 / ' + rp.packs.length + ' 个已导入；' + applied;
      if (pi) {
        const parts = Object.keys(pi.cat).map((k) => k + ' ' + pi.cat[k]);
        rpmInfo.textContent = '包内贴图：' + (parts.join(' / ') || '无') + '；' + lib;
      } else if (rp.packs.length || rp.tiles.size || rp.guiCount) {
        rpmInfo.textContent = lib;
      } else {
        rpmInfo.textContent = '';
      }
      const on = getS('resourcepack', 'enabled') !== false;
      rpmSwitch.classList.toggle('on', on);
    } catch (e) { /* noop */ }
  }
  function rpMenuSetOpen(on) {
    // 主路径：打开游戏自己绘制的原版资源包界面；DOM 面板只在游戏还没起来时兜底
    if (on && rpOpenPackScreen()) {
      rp.menuOpen = false;
      rpMenu.classList.remove('open');
      rpMenuBtn.classList.remove('hidden');
      return;
    }
    rp.menuOpen = !!on;
    rpMenu.classList.toggle('open', rp.menuOpen);
    if (rp.menuOpen) rpMenuRender();
    rpMenuBtn.classList.toggle('hidden', rp.menuOpen);
  }
  // 资源包入口塞进游戏 OptionsScreen 自己的 widgets 数组：由 MenuScreen.draw()
  // 的 ui.button(w) 画出来、由 mouseDown 的 w.onClick() 响应，是真正的原版按钮。
  function rpNativeWidget() {
    const ui = state.game && state.game.ui;
    const scr = ui && ui.screen;
    if (!scr || !Array.isArray(scr.widgets)) return { inMenu: false, native: false };
    const ws = scr.widgets;
    const lab = (w) => (w && typeof w.label === 'string' ? w.label : '');
    const slot = ws.find((w) => w && !w.__cometRp && (lab(w) === '资源包…' || lab(w) === '资源包...'));
    const acc = ws.find((w) => w && (lab(w) === '账号…' || lab(w) === '账号...'));
    // 只在「选项」屏动手，其它菜单（标题 / 暂停 / 子选项页）一律不碰
    if (!slot && !acc && scr.title !== '选项') return { inMenu: false, native: false };
    const tip = ['导入 Minecraft 资源包 .zip', '方块 / 物品栏 / GUI 贴图都会生效'];
    if (slot) {
      Object.assign(slot, {
        enabled: true, label: '资源包…', tip,
        __cometRp: true, onClick: () => rpMenuSetOpen(true),
      });
      return { inMenu: true, native: true };
    }
    if (acc) {
      // onboard.js 把 OptionsScreen.layout() 里原本 sub(6, '资源包…') 的槽位
      // 改成了「账号…」：把这一格 150px 一分为二，账号和资源包并排，
      // 位置仍落在原版网格的同一行，不会飘到屏幕中间去。
      if (!acc.__cometRpSplit) {
        acc.__cometRpSplit = true;
        acc.w = 72;
      }
      let btn = ws.find((w) => w && w.__cometRp);
      if (!btn) {
        btn = { label: '资源包…', tip, __cometRp: true, onClick: () => rpMenuSetOpen(true) };
        ws.push(btn);
      }
      btn.x = acc.x + 78; btn.y = acc.y; btn.w = 72; btn.h = acc.h || 20;
      return { inMenu: true, native: true };
    }
    return { inMenu: true, native: false };
  }
  // 暂停菜单（游戏菜单）：从「选项…」widget 反推原版网格坐标，
  // 先找没被占的格子；单人是「模式…」、联机是「房间…」把右列占满了，
  // 那就按 24px 行距在网格末尾补一行，绝不盖住任何已有按钮。
  function rpPauseWidget() {
    const ui = state.game && state.game.ui;
    const scr = ui && ui.screen;
    if (!scr || !Array.isArray(scr.widgets) || scr.title !== '游戏菜单') return false;
    const ws = scr.widgets;
    if (ws.some((w) => w && w.__cometRp)) return true;
    const opt = ws.find((w) => w && typeof w.label === 'string' && w.label === '选项…');
    if (!opt || typeof opt.x !== 'number' || typeof opt.y !== 'number') return false;
    const lx = opt.x, top = opt.y - 72;
    const H = (ui && ui.h) || 240;
    const free = (x, y, w, h) => !ws.some((q) => q && typeof q.x === 'number' &&
      typeof q.y === 'number' && x < q.x + (q.w || 0) && x + w > q.x &&
      y < q.y + (q.h || 20) && y + h > q.y);
    // 优先填网格里真正空出来的 98px 格子
    const cells = [[lx + 106, opt.y, 98, 20], [lx + 106, top + 48, 98, 20],
                   [lx + 106, top + 24, 98, 20], [lx, top + 96, 98, 20]];
    let box = cells.find((c) => c[1] + c[3] < H - 24 && free(c[0], c[1], c[2], c[3]));
    if (!box) {
      const ys = ws.filter((w) => w && typeof w.y === 'number' && w.y < H - 40).map((w) => w.y);
      const ny = (ys.length ? Math.max.apply(null, ys) : opt.y) + 24;
      if (ny + 20 >= H - 24) return false;
      // 补行时跟「保存并退回标题屏幕」一样做成 204 整行，别留半边空着
      if (free(lx, ny, 204, 20)) box = [lx, ny, 204, 20];
      else if (free(lx, ny, 98, 20)) box = [lx, ny, 98, 20];
      else return false;
    }
    ws.push({
      x: box[0], y: box[1], w: box[2], h: box[3], label: '资源包…', __cometRp: true,
      tip: ['打开资源包界面'],
      onClick: () => rpMenuSetOpen(true),
    });
    return true;
  }
  // ==========================================================================
  // 原版资源包界面：直接复用游戏 MenuScreen.prototype 的 draw / mouseDown / key，
  // 所以标题、按钮九宫格、悬浮提示、ESC 返回全是游戏自己的东西，不是自制 DOM。
  // 左「可用」右「已选」，中间箭头移入移出 / 调优先级，支持多个包叠加。
  // ==========================================================================
  function rpMenuProto(ui) {
    if (rp.menuProto) return rp.menuProto;
    let p = ui && ui.screen ? Object.getPrototypeOf(ui.screen) : null;
    let base = null;
    while (p && p !== Object.prototype) {
      if (typeof p.draw === 'function' && typeof p.mouseDown === 'function' && typeof p.key === 'function') base = p;
      p = Object.getPrototypeOf(p);
    }
    if (base) rp.menuProto = base;
    return base;
  }
  // 游戏版本差异导致拿不到 MenuScreen.prototype 时的兜底：照样 duck-type 一个
  // 屏幕对象，只用 ui 自己的原语绘制，绝不退回到那个自制 DOM 弹窗。
  function rpOwnScreen(s, g, ui) {
    s.game = g; s.title = ''; s.widgets = []; s.parent = ui.screen || null;
    s.bgDim = 0.5; s.blurBg = true;
    s.selL = -1; s.selR = -1; s.scrollL = 0; s.scrollR = 0;
    s.layout = () => rpPackLayout(s, ui);
    s.draw = (u) => {
      if (u.menuBackground) u.menuBackground();
      if (s.box && u.listBackground) u.listBackground(s.box.top, s.box.bottom);
      for (const w of s.widgets) {
        if (w.text || w.slider) continue;
        if (u.button) u.button(w);
      }
      for (const w of s.widgets) {
        if (w.tip && u.hit && u.hit(w) && u.tooltip) {
          u.tooltip(w.tip.map((t) => ({ text: t })), u.mouse.x, u.mouse.y);
        }
      }
    };
    s.mouseDown = (u, mx, my, btn) => {
      if (btn !== 0) return;
      for (const w of s.widgets) {
        if (w.slider || w.text || w.enabled === false) continue;
        if (u.hit(w, mx, my)) { if (w.onClick) w.onClick(); return; }
      }
    };
    s.key = (u, ev) => {
      if (ev.key === 'Escape' && s.onEsc) { s.onEsc(); return true; }
      return false;
    };
    s.wheel = (u, dy) => {
      if (!s.box) return;
      if (u.mouse.x < s.box.cx) s.scrollL = Math.max(0, s.scrollL + Math.sign(dy));
      else s.scrollR = Math.max(0, s.scrollR + Math.sign(dy));
      s.layout();
    };
    s.onEsc = () => rpPackDone(s);
    s.close = () => { if (rp.screen === s) rp.screen = null; };
    return s;
  }
  function rpShort(s, w) {
    const n = Math.max(4, Math.floor(w / 9));
    return String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s);
  }
  function rpPackScreen() { return rp.screen; }
  function rpRefreshScreen() {
    const s = rp.screen;
    if (s && s.layout) s.layout();
  }
  function rpPackDone(s) {
    try {
      const ui = state.game && state.game.ui;
      if (ui) {
        if (s.parent) ui.open(s.parent);
        else if (typeof ui.close === 'function') ui.close();
      }
    } catch (e) { /* noop */ }
    rp.screen = null;
  }
  function rpOpenPackScreen() {
    try {
      const g = state.game;
      const ui = g && g.ui;
      if (!ui || typeof ui.open !== 'function') return false;
      const proto = rpMenuProto(ui);
      let s;
      if (proto) {
        s = Object.create(proto);
        s.game = g;
        s.title = '资源包';
        s.titleY = 12;
        s.widgets = [];
        s.parent = ui.screen || null;
        s.bgDim = 0.5;
        s.blurBg = true;
        s.selL = -1; s.selR = -1; s.scrollL = 0; s.scrollR = 0;
        s.layout = () => rpPackLayout(s, ui);
        s.drawExtra = (u) => { if (s.box && u.listBackground) u.listBackground(s.box.top, s.box.bottom); };
        s.wheel = (u, dy) => {
          if (!s.box) return;
          if (u.mouse.x < s.box.cx) s.scrollL = Math.max(0, s.scrollL + Math.sign(dy));
          else s.scrollR = Math.max(0, s.scrollR + Math.sign(dy));
          s.layout();
        };
        s.onEsc = () => rpPackDone(s);
        s.close = () => { if (rp.screen === s) rp.screen = null; };
      } else {
        s = rpOwnScreen({}, g, ui);
      }
      rp.screen = s;
      ui.open(s);
      return true;
    } catch (e) { rp.screen = null; return false; }
  }
  function rpPackLists() {
    const used = rp.order.map(rpPackById).filter(Boolean);
    const avail = rp.packs.filter((p) => rp.order.indexOf(p.id) < 0);
    return { used, avail };
  }
  function rpPackLayout(s, ui) {
    const cx = ui.w / 2;
    const top = 36, bottom = Math.max(top + 44, ui.h - 58);
    const gap = 8, aw = 22;
    const lw = Math.max(78, Math.floor((ui.w - 28 - gap * 2 - aw) / 2));
    const total = lw * 2 + aw + gap * 2;
    const lx = Math.max(2, Math.floor((ui.w - total) / 2));
    const ax = lx + lw + gap, rx = ax + aw + gap;
    s.box = { lx, ax, rx, lw, aw, top, bottom, cx };
    const { used, avail } = rpPackLists();
    const rows = Math.max(1, Math.floor((bottom - top - 4) / 22));
    s.scrollL = Math.min(s.scrollL, Math.max(0, avail.length - rows));
    s.scrollR = Math.min(s.scrollR, Math.max(0, used.length - rows));
    const ws = [];
    // 列标题用 MenuScreen 的 text widget，字体跟原版完全一致
    ws.push({ text: '可用的资源包', x: lx + lw / 2, y: top - 13, color: '#FFFFFF' });
    ws.push({ text: '已选的资源包', x: rx + lw / 2, y: top - 13, color: '#FFFFFF' });
    for (let i = 0; i < rows; i++) {
      const y = top + 2 + i * 22;
      const a = avail[i + s.scrollL];
      if (a) ws.push({
        x: lx, y, w: lw, h: 20, label: rpShort(a.name, lw),
        blue: s.selL === i + s.scrollL,
        tip: [a.name, '方块 ' + (a.nBlock || 0) + ' / 物品 ' + (a.nItem || 0) +
          ' / 界面 ' + (a.nGui || 0) + ' / 实体 ' + (a.nEntity || 0) +
          ' / 环境 ' + (a.nEnv || 0) + ' / 药水 ' + (a.nFx || 0),
          '未适配 ' + (a.nSkip || 0) + ' 张（游戏本身没有对应贴图）',
          (a.desc ? '说明：' + a.desc : (a.legacy ? '旧版存档，建议用「×」删除后重新导入 zip' : '选中后点 → 启用'))],
        onClick: () => { s.selL = i + s.scrollL; s.selR = -1; s.layout(); },
      });
      const b = used[i + s.scrollR];
      if (b) ws.push({
        x: rx, y, w: lw, h: 20, label: rpShort(b.name, lw),
        blue: s.selR === i + s.scrollR,
        tip: [b.name, '优先级 ' + (i + s.scrollR + 1) + '（越靠上越优先）'],
        onClick: () => { s.selR = i + s.scrollR; s.selL = -1; s.layout(); },
      });
    }
    const ay = Math.max(top + 4, top + Math.floor((bottom - top) / 2) - 46);
    const arrows = [
      ['→', '加入已选', () => rpPackAdd(s)],
      ['←', '移出已选', () => rpPackRemove(s)],
      ['↑', '提高优先级', () => rpPackMove(s, -1)],
      ['↓', '降低优先级', () => rpPackMove(s, 1)],
      ['×', '彻底删除选中的可用包', () => rpPackDelete(s)],
    ];
    arrows.forEach((a, i) => ws.push({
      x: ax, y: ay + i * 24, w: aw, h: 20, label: a[0], tip: [a[1]], onClick: a[2],
    }));
    const rpBg = 4;
    const rpBw = Math.max(64, Math.min(96, Math.floor((ui.w - 24 - rpBg * 2) / 3)));
    const rpX0 = Math.max(2, Math.floor((ui.w - (rpBw * 3 + rpBg * 2)) / 2));
    const rpBy = ui.h - 27;
    const rpX = (i) => rpX0 + i * (rpBw + rpBg);
    const rpR1 = rpBy - 24, rpR2 = rpBy;
    const rpRemember = getS('resourcepack', 'remember') !== false;
    const rpBtns = [
      ['导入 .zip…', ['可一次选中多个资源包'], () => rpImport()],
      ['内置暗色包', ['41KB 暗色 GUI 包'], () => rpLoadBuiltin()],
      ['全部清除', ['删除所有包并恢复原版贴图', '关浏览器重开也不会再自动装回来'], () => rpPackClearAll(s)],
      ['重新应用', ['重新合并已启用的包'], () => rpReapply()],
      ['记住选择: ' + (rpRemember ? '开' : '关'),
        [rpRemember ? '开：重开浏览器自动恢复上次选的包' : '关：重开浏览器就是原版，包仍留在列表里'],
        () => rpPackRemember(s)],
      ['完成', [], () => rpPackDone(s)],
    ];
    rpBtns.forEach((btn, i) => ws.push({
      x: rpX(i % 3), y: i < 3 ? rpR1 : rpR2, w: rpBw, h: 20,
      label: btn[0], tip: btn[1], onClick: btn[2],
    }));
    // 两个口径的覆盖率：既看游戏槽位覆盖，也看这个包自己有多少没法用
    const rpCv = rp.coverage || { used: 0, total: 0, pct: 0 };
    const rpSt = rp.stats || {};
    ws.push({
      text: rpShort('槽位覆盖 ' + rpCv.pct + '%（' + rpCv.used + '/' + rpCv.total + '）' +
        ' · 高清 ' + (rp.guiHi ? rp.guiHi.size : 0) + ' · 未适配 ' + (rpSt.skip || 0) +
        ' · 模型 ' + (rpSt.model || 0), ui.w - 16),
      x: cx, y: rpR1 - 16, color: '#AAAAAA',
    });
    s.widgets = ws;
  }
  function rpPackClearAll(s) {
    // rpClear 自己就是串行任务，外面再包一层 rpTask 会互相等待
    rpClear().then(() => {
      s.selL = -1; s.selR = -1; s.scrollL = 0; s.scrollR = 0;
      s.layout();
      pushNotification('材质包', '已全部清除，恢复原版贴图');
    });
  }
  function rpPackRemember(s) {
    const on = getS('resourcepack', 'remember') !== false;
    cfg.settings['resourcepack.remember'] = !on;
    __sCache = null;
    try { saveCfg(); } catch (e) { /* noop */ }
    // 只改「下次启动要不要自动套用」，不动当前这一局的效果
    s.layout();
    pushNotification('材质包', on ? '已关闭「记住选择」，重开浏览器将是原版' : '已开启「记住选择」');
  }
  function rpPackAdd(s) {
    const { avail } = rpPackLists();
    const pk = avail[s.selL];
    if (!pk) return;
    rpTask(async () => {
      rp.suspended = false;
      if (rp.order.indexOf(pk.id) < 0) rp.order.push(pk.id);
      s.selL = -1; s.selR = rp.order.length - 1;
      await rpSaveLibrary(); await rpRebuild();
    });
  }
  function rpPackRemove(s) {
    const id = rp.order[s.selR];
    if (!id) return;
    rpTask(async () => {
      rp.suspended = false;
      rp.order.splice(s.selR, 1);
      s.selR = -1; s.selL = 0;
      await rpSaveLibrary(); await rpRebuild();
    });
  }
  function rpPackMove(s, dir) {
    const i = s.selR, j = i + dir;
    if (i < 0 || j < 0 || j >= rp.order.length) return;
    rpTask(async () => {
      rp.suspended = false;
      const t = rp.order[i]; rp.order[i] = rp.order[j]; rp.order[j] = t;
      s.selR = j;
      await rpSaveLibrary(); await rpRebuild();
    });
  }
  function rpPackDelete(s) {
    const { avail } = rpPackLists();
    const pk = avail[s.selL];
    if (!pk) return;
    rpTask(async () => {
      rp.suspended = false;
      rp.packs = rp.packs.filter((p) => p !== pk);
      s.selL = -1;
      await rpSaveLibrary(); await rpRebuild();
    });
  }
  function rpMenuTick() {
    try {
      rpGuiTick();
      // 趁菜单还开着，把游戏 MenuScreen.prototype 记下来；之后从客户端模块按钮
      //（当前没有菜单屏）直接打开资源包界面也能复用原版绘制。
      if (!rp.menuProto) { try { rpMenuProto(state.game && state.game.ui); } catch (e) { /* noop */ } }
      const r = rpNativeWidget();      // 选项屏
      const p = rpPauseWidget();       // 暂停菜单（用户截图里那一屏）
      const native = r.native || p;
      const inMenu = r.inMenu || p;
      // 原生按钮生效后 DOM 胶囊彻底不显示；只有拿不到菜单 widget 时才兜底
      rpMenuBtn.classList.toggle('show', inMenu && !native && !rp.menuOpen);
      if (!inMenu && rp.menuOpen) rpMenuSetOpen(false);
      if (rp.menuOpen) rpMenuRender();
    } catch (e) { /* noop */ }
  }


  rpMenuBtn.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    rpMenuSetOpen(true);
  });
  rpmClose.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    rpMenuSetOpen(false);
  });
  rpmImport.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); rpImport(); });
  rpmReapply.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    // 旧判断只看方块贴图，GUI 包（0 张 block）会被误报「还没导入材质包」
    if (!rp.packs.length) { rpStatus('还没导入材质包'); return; }
    rpReapply();
  });
  rpmClear.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    rpClear();
  });
  rpmDemo.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    rpLoadBuiltin();
  });
  rpmToggleRow.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    rpSetEnabled(getS('resourcepack', 'enabled') === false);
  });
  // 拖放 zip 到面板
  rpMenu.addEventListener('dragover', (ev) => { ev.preventDefault(); ev.stopPropagation(); rpMenu.classList.add('drag'); });
  rpMenu.addEventListener('dragleave', (ev) => { ev.stopPropagation(); rpMenu.classList.remove('drag'); });
  rpMenu.addEventListener('drop', async (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    rpMenu.classList.remove('drag');
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (!f) return;
    rpImportFile(f);
  });
  rpMenu.addEventListener('mousedown', (ev) => ev.stopPropagation());
  rpMenu.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); });

  // 导入统一走 rpTask 串行队列，见 rpAddPack / rpImportFile。


  // ---- 内置轻量暗色 GUI 包（41KB / 56 张，精选自用户提供的 MandalasGUI+Dakmode） ----
  const BUILTIN_GUI_B64 = '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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALBR3rEuCDZiW/WRAAAAAElFTkSuQmCCUEsBAhQAFAAAAAAA7IVpXVuCLuhqAAAAagAAAAsAAAAAAAAAAAAAAIABAAAAAHBhY2subWNtZXRhUEsBAhQAFAAAAAAA7IVpXdLfh4SoAAAAqAAAADYAAAAAAAAAAAAAAIABkwAAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvYnV0dG9uLnBuZ1BLAQIUABQAAAAAAOyFaV052NQiqAAAAKgAAAA5AAAAAAAAAAAAAACAAY8BAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2J1dHRvbl9obC5wbmdQSwECFAAUAAAAAADshWldrLhpGJMAAACTAAAAOgAAAAAAAAAAAAAAgAGOAgAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9idXR0b25fZGlzLnBuZ1BLAQIUABQAAAAAAOyFaV1qfGTYlA4AAJQOAAA5AAAAAAAAAAAAAACAAXkDAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2ludmVudG9yeS5wbmdQSwECFAAUAAAAAADshWldjAqGtkYCAABGAgAAOgAAAAAAAAAAAAAAgAFkEgAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9nZW5lcmljXzU0LnBuZ1BLAQIUABQAAAAAAOyFaV1BGeAn9wkAAPcJAAA+AAAAAAAAAAAAAACAAQIVAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2NyYWZ0aW5nX3RhYmxlLnBuZ1BLAQIUABQAAAAAAOyFaV2WmddI9QMAAPUDAAA3AAAAAAAAAAAAAACAAVUfAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2Z1cm5hY2UucG5nUEsBAhQAFAAAAAAA7IVpXcSe9lciCwAAIgsAADkAAAAAAAAAAAAAAIABnyMAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvZ3VpX2FudmlsLnBuZ1BLAQIUABQAAAAAAOyFaV3jr9QAMgoAADIKAABEAAAAAAAAAAAAAACAARgvAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2d1aV9lbmNoYW50aW5nX3RhYmxlLnBuZ1BLAQIUABQAAAAAAOyFaV00WRzkJAwAACQMAAA4AAAAAAAAAAAAAACAAaw5AABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2d1aV9sb29tLnBuZ1BLAQIUABQAAAAAAOyFaV1TKO6SogkAAKIJAAA8AAAAAAAAAAAAAACAASZGAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2d1aV9zbWl0aGluZy5wbmdQSwECFAAUAAAAAADshWldk1X5VNMIAADTCAAAPwAAAAAAAAAAAAAAgAEiUAAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9ndWlfc3RvbmVjdXR0ZXIucG5nUEsBAhQAFAAAAAAA7IVpXVLd6RDoAAAA6AAAADYAAAAAAAAAAAAAAIABUlkAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvaG90YmFyLnBuZ1BLAQIUABQAAAAAAOyFaV2JdN0ZkAAAAJAAAAA6AAAAAAAAAAAAAACAAY5aAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2hvdGJhcl9zZWwucG5nUEsBAhQAFAAAAAAA7IVpXchCZuN8AAAAfAAAADkAAAAAAAAAAAAAAIABdlsAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvY3Jvc3NoYWlyLnBuZ1BLAQIUABQAAAAAAOyFaV3ynVlQrgAAAK4AAAA6AAAAAAAAAAAAAACAAUlcAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L29wdGlvbnNfYmcucG5nUEsBAhQAFAAAAAAA7IVpXfKdWVCuAAAArgAAADcAAAAAAAAAAAAAAIABT10AAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvbWVudV9iZy5wbmdQSwECFAAUAAAAAADshWldFjm/D7YAAAC2AAAANQAAAAAAAAAAAAAAgAFSXgAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC94cF9iZy5wbmdQSwECFAAUAAAAAADshWldza9EW8sAAADLAAAANQAAAAAAAAAAAAAAgAFbXwAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC94cF9mZy5wbmdQSwECFAAUAAAAAADshWldQGI6bG8AAABvAAAAOQAAAAAAAAAAAAAAgAF5YAAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9hdHRhY2tfYmcucG5nUEsBAhQAFAAAAAAA7IVpXTDvZ7GXAAAAlwAAAD8AAAAAAAAAAAAAAIABP2EAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvYXR0YWNrX3Byb2dyZXNzLnBuZ1BLAQIUABQAAAAAAOyFaV3FljKUqAAAAKgAAAA7AAAAAAAAAAAAAACAATNiAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2F0dGFja19mdWxsLnBuZ1BLAQIUABQAAAAAAOyFaV2d/HW/kAAAAJAAAAA5AAAAAAAAAAAAAACAATRjAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2VmZmVjdF9iZy5wbmdQSwECFAAUAAAAAADshWld43LI0JEAAACRAAAAQQAAAAAAAAAAAAAAgAEbZAAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9lZmZlY3RfYmdfYW1iaWVudC5wbmdQSwECFAAUAAAAAADshWld1bDegIoAAACKAAAAOgAAAAAAAAAAAAAAgAELZQAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9oZWFydF9mdWxsLnBuZ1BLAQIUABQAAAAAAOyFaV1QJ+QRhgAAAIYAAAA6AAAAAAAAAAAAAACAAe1lAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2hlYXJ0X2hhbGYucG5nUEsBAhQAFAAAAAAA7IVpXfX4LTCQAAAAkAAAAD8AAAAAAAAAAAAAAIABy2YAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvaGVhcnRfY29udGFpbmVyLnBuZ1BLAQIUABQAAAAAAOyFaV08TyDqiQAAAIkAAABDAAAAAAAAAAAAAACAAbhnAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2hlYXJ0X2Z1bGxfYmxpbmtpbmcucG5nUEsBAhQAFAAAAAAA7IVpXSeglWGGAAAAhgAAAEMAAAAAAAAAAAAAAIABomgAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvaGVhcnRfaGFsZl9ibGlua2luZy5wbmdQSwECFAAUAAAAAADshWld48mxU5MAAACTAAAASAAAAAAAAAAAAAAAgAGJaQAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9oZWFydF9jb250YWluZXJfYmxpbmtpbmcucG5nUEsBAhQAFAAAAAAA7IVpXVokc1GKAAAAigAAAEQAAAAAAAAAAAAAAIABgmoAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvaGVhcnRfYWJzb3JiaW5nX2Z1bGwucG5nUEsBAhQAFAAAAAAA7IVpXen4jG6KAAAAigAAAEMAAAAAAAAAAAAAAIABbmsAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvaGVhcnRfcG9pc29uZWRfZnVsbC5wbmdQSwECFAAUAAAAAADshWldLqCCcooAAACKAAAAQwAAAAAAAAAAAAAAgAFZbAAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9oZWFydF93aXRoZXJlZF9mdWxsLnBuZ1BLAQIUABQAAAAAAOyFaV2x1q2higAAAIoAAABBAAAAAAAAAAAAAACAAURtAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2hlYXJ0X2Zyb3plbl9mdWxsLnBuZ1BLAQIUABQAAAAAAOyFaV3TDLODmwAAAJsAAAA5AAAAAAAAAAAAAACAAS1uAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2Zvb2RfZnVsbC5wbmdQSwECFAAUAAAAAADshWldcGkqd5YAAACWAAAAOQAAAAAAAAAAAAAAgAEfbwAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9mb29kX2hhbGYucG5nUEsBAhQAFAAAAAAA7IVpXTenNyGSAAAAkgAAADoAAAAAAAAAAAAAAIABDHAAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvZm9vZF9lbXB0eS5wbmdQSwECFAAUAAAAAADshWldzHcpyKAAAACgAAAAQAAAAAAAAAAAAAAAgAH2cAAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9mb29kX2Z1bGxfaHVuZ2VyLnBuZ1BLAQIUABQAAAAAAOyFaV1gMtqSmgAAAJoAAABAAAAAAAAAAAAAAACAAfRxAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2Zvb2RfaGFsZl9odW5nZXIucG5nUEsBAhQAFAAAAAAA7IVpXZsxNkWSAAAAkgAAAEEAAAAAAAAAAAAAAIAB7HIAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvZm9vZF9lbXB0eV9odW5nZXIucG5nUEsBAhQAFAAAAAAA7IVpXZ11TDKVAAAAlQAAADoAAAAAAAAAAAAAAIAB3XMAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvYXJtb3JfZnVsbC5wbmdQSwECFAAUAAAAAADshWldxiCtv6AAAACgAAAAOgAAAAAAAAAAAAAAgAHKdAAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9hcm1vcl9oYWxmLnBuZ1BLAQIUABQAAAAAAOyFaV0decZfkAAAAJAAAAA7AAAAAAAAAAAAAACAAcJ1AABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2FybW9yX2VtcHR5LnBuZ1BLAQIUABQAAAAAAOyFaV2+fqbJnAAAAJwAAAAzAAAAAAAAAAAAAACAAat2AABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L2Fpci5wbmdQSwECFAAUAAAAAADshWldcQLqZo0AAACNAAAAPAAAAAAAAAAAAAAAgAGYdwAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9haXJfYnVyc3RpbmcucG5nUEsBAhQAFAAAAAAA7IVpXQa6cMKQAAAAkAAAADkAAAAAAAAAAAAAAIABf3gAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvYWlyX2VtcHR5LnBuZ1BLAQIUABQAAAAAAOyFaV2suGkYkwAAAJMAAAA2AAAAAAAAAAAAAACAAWZ5AABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L3NsaWRlci5wbmdQSwECFAAUAAAAAADshWldsYDNyY8AAACPAAAAPQAAAAAAAAAAAAAAgAFNegAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC9zbGlkZXJfaGFuZGxlLnBuZ1BLAQIUABQAAAAAAOyFaV1OmLA7jwAAAI8AAABAAAAAAAAAAAAAAACAATd7AABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L3NsaWRlcl9oYW5kbGVfaGwucG5nUEsBAhQAFAAAAAAA7IVpXW8QlM6IAAAAiAAAADoAAAAAAAAAAAAAAIABJHwAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvdGV4dF9maWVsZC5wbmdQSwECFAAUAAAAAADshWldzmja0ogAAACIAAAAPQAAAAAAAAAAAAAAgAEEfQAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC90ZXh0X2ZpZWxkX2hsLnBuZ1BLAQIUABQAAAAAAOyFaV17WDnboQAAAKEAAAAzAAAAAAAAAAAAAACAAed9AABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L3RhYi5wbmdQSwECFAAUAAAAAADshWldeA1ngKEAAAChAAAANgAAAAAAAAAAAAAAgAHZfgAAYXNzZXRzL21pbmVjcmFmdC90ZXh0dXJlcy9ndWkvc3ByaXRlcy9jb21ldC90YWJfaGwucG5nUEsBAhQAFAAAAAAA7IVpXVpARTQ2AgAANgIAADkAAAAAAAAAAAAAAIABzn8AAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvdGFiX2l0ZW1zLnBuZ1BLAQIUABQAAAAAAOyFaV0NZnga5wMAAOcDAAA9AAAAAAAAAAAAAACAAVuCAABhc3NldHMvbWluZWNyYWZ0L3RleHR1cmVzL2d1aS9zcHJpdGVzL2NvbWV0L3RhYl9pbnZlbnRvcnkucG5nUEsBAhQAFAAAAAAA7IVpXUaF/0lVAgAAVQIAAD8AAAAAAAAAAAAAAIABnYYAAGFzc2V0cy9taW5lY3JhZnQvdGV4dHVyZXMvZ3VpL3Nwcml0ZXMvY29tZXQvdGFiX2l0ZW1fc2VhcmNoLnBuZ1BLBQYAAAAAOQA5AFMXAABPiQAAAAA=';
  function rpLoadBuiltin() {
    try {
      const bin = (typeof W.atob === 'function' ? W.atob : atob)(BUILTIN_GUI_B64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      rpImportFile({ name: 'opusmc-dark-gui-lite.zip', arrayBuffer: async () => bytes.buffer });
      pushNotification('材质包', '正在载入内置暗色 GUI 包…');
    } catch (e) {
      rpStatus('内置包载入失败：' + e.message);
    }
  }

  // ---------------- 启动 ----------------
  const RP_API = {
    version: '1.5.0',
    open: () => rpMenuSetOpen(true),
    openScreen: rpOpenPackScreen,
    import: rpImport,
    importFile: rpImportFile,
    importFiles: (list) => rpTask(async () => { for (const f of list) await rpAddPack(f); }),
    guiPackKeys: () => Array.from(rp.gui.keys()),
    get skippedAspect() { return rp.skippedAspect.slice(); },
    builtin: rpLoadBuiltin,
    reapply: rpReapply,
    clear: rpClear,
    setEnabled: rpSetEnabled,
    get packs() { return rp.packs.map((p) => ({ id: p.id, name: p.name, nBlock: p.nBlock,
      nItem: p.nItem, nGui: p.nGui, nEntity: p.nEntity })); },
    get order() { return rp.order.slice(); },
    get stats() { return rp.stats; },
    get status() { return String(cfg.settings['resourcepack.status'] || '未导入'); },
    get screen() { return rp.screen; },
  };
  W.__opusRP = RP_API;

  // 等游戏实例出现再恢复存档；之后每 250ms 同步引用、注入菜单按钮、补应用贴图
  (function boot(n) {
    if (W.game && W.game.renderer) {
      state.game = W.game;
      rpRestore();
      setInterval(() => {
        try {
          if (W.game && W.game !== state.game) state.game = W.game;
          rpMenuTick();
        } catch (e) { /* noop */ }
      }, 250);
      return;
    }
    if (n > 0) setTimeout(() => boot(n - 1), 300);
  })(200);

  // Alt+R 直接呼出（要先开过一次菜单，让脚本缓存到游戏的 MenuScreen 原型）
  W.addEventListener('keydown', (ev) => {
    if (!ev.altKey || ev.code !== 'KeyR') return;
    ev.preventDefault(); ev.stopPropagation();
    rpMenuSetOpen(true);
  }, true);

  console.log('[OpusRP] 已加载，Alt+R 或游戏菜单里的「资源包…」打开');
})();
