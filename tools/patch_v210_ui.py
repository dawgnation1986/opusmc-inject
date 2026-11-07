# -*- coding: utf-8 -*-
# patch_v210_ui.py — Java 版风格的自定义服务器列表（canvas UI，注入 probe/js/net.js）
import os
os.chdir(r"D:\discuz\webmc\hook\opusmc-inject")
p = 'probe/js/net.js'
t = open(p, newline='', encoding='utf-8').read()
EOL = "\r\n" if "\r\n" in t else "\n"
print('行尾 =', 'CRLF' if EOL == "\r\n" else 'LF')

def rep(old, new, n=1):
    global t
    o = old.replace("\n", EOL); nn = new.replace("\n", EOL)
    c = t.count(o)
    assert c == n, 'old 命中 %d 次（应 %d）: %r...' % (c, n, old[:80])
    t = t.replace(o, nn)

ANCHOR = """// 直接连接: a proxy's address (multiplayer/proxy on this computer, the LAN or Radmin: 开服给朋友.bat), not the room service."""
NEW_CLASSES = """// ---------------------------------------------------------------------------
// 自定义服务器列表（Java 版多人游戏风格）：保存过的地址列成表，双击 / 点「加入服务器」直接进。
// 全部画在 canvas 上（这个游戏没有 DOM 界面），没有内联样式这回事。
const NET_SERVERS_KEY = 'netServers';
function loadNetServers(g) {
  const raw = g.settings && g.settings[NET_SERVERS_KEY];
  const list = Array.isArray(raw) ? raw.filter((s) => s && typeof s.url === 'string' && s.url.trim()) : [];
  if (!list.length) {
    const def = { name: '本地中转', url: 'ws://' + (location.hostname || 'localhost') + ':8780', player: '' };
    g.settings[NET_SERVERS_KEY] = [def];
    if (g.saveSettings) g.saveSettings();
    return [def];
  }
  return list.slice(0, 64);
}
function saveNetServers(g, list) { g.settings[NET_SERVERS_KEY] = list; if (g.saveSettings) g.saveSettings(); }

class ServerListScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, '多人游戏 · 自定义服务器'); this.parent = parent; this.titleY = 18;
    this.list = loadNetServers(game);
    this.sel = 0; this.page = 0; this.lastClickAt = 0; this.lastSel = -1; this.note = '';
  }
  get rows() { return this.listBox ? this.listBox.rows : 6; }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    const w = Math.min(430, u.w - 40), x = cx - w / 2;
    const rows = Math.max(4, Math.min(8, Math.floor((u.h - 205) / 26)));
    this.listBox = { x, y: 54, w, rowH: 26, rows };
    const bw = (w - 24) / 4, by = u.h - 58;
    this.widgets = [
      { x, y: by, w: bw, h: 20, label: '加入服务器', blue: true, onClick: () => this.join() },
      { x: x + bw + 8, y: by, w: bw, h: 20, label: '添加服务器', onClick: () => this.game.ui.open(new ServerEditScreen(this.game, this, -1)) },
      { x: x + (bw + 8) * 2, y: by, w: bw, h: 20, label: '编辑', onClick: () => { if (this.list.length) this.game.ui.open(new ServerEditScreen(this.game, this, this.sel)); } },
      { x: x + (bw + 8) * 3, y: by, w: bw, h: 20, label: '删除', onClick: () => this.del() },
      { x, y: u.h - 30, w: w / 2 - 4, h: 20, label: '返回', onClick: () => this.onEsc() },
      { x: x + w / 2 + 4, y: u.h - 30, w: w / 2 - 4, h: 20, label: '直接连接（手填）', onClick: () => this.game.ui.open(new DirectConnectScreen(this.game, this)) },
      { x: x + w - 22, y: 32, w: 20, h: 18, label: '▲', onClick: () => this.flip(-1) },
      { x: x + w - 22, y: this.listBox.y + rows * 26 + 4, w: 20, h: 18, label: '▼', onClick: () => this.flip(1) },
    ];
  }
  flip(d) {
    const pages = Math.max(1, Math.ceil(this.list.length / this.rows));
    this.page = Math.max(0, Math.min(pages - 1, this.page + d));
    this.sel = Math.min(this.list.length - 1, this.page * this.rows);
    if (this.sel < 0) this.sel = 0;
  }
  at(mx, my) {
    const b = this.listBox;
    if (mx < b.x || mx >= b.x + b.w || my < b.y || my >= b.y + b.rows * b.rowH) return -1;
    const i = this.page * b.rows + Math.floor((my - b.y) / b.rowH);
    return i < this.list.length ? i : -1;
  }
  mouseDown(ui, mx, my, button) {
    const i = this.at(mx, my);
    if (i >= 0) {
      const now = performance.now();
      const dbl = i === this.lastSel && now - this.lastClickAt < 400;
      this.sel = i; this.lastSel = i; this.lastClickAt = now;
      if (dbl) this.join();
      return;
    }
    super.mouseDown(ui, mx, my, button);
  }
  join() {
    const s = this.list[this.sel]; if (!s) return;
    const g = this.game;
    const name = String(s.player || g.settings.netName || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16)
      || ('Web' + Math.floor(Math.random() * 9000 + 1000));
    g.settings.netUrl = s.url; g.settings.netName = name;
    if (g.saveSettings) g.saveSettings();
    g.ui.hideInput();
    g.joinServer(s.url.trim(), name);
  }
  del() {
    if (!this.list.length) return;
    const g = this.game;
    this.list.splice(this.sel, 1);
    saveNetServers(g, this.list);
    this.sel = Math.max(0, Math.min(this.sel, this.list.length - 1));
    this.page = Math.min(this.page, Math.max(0, Math.ceil(this.list.length / this.rows) - 1));
  }
  drawExtra(ui) {
    const c = ui.ctx, b = this.listBox, cx = ui.w / 2;
    Font.center(c, '双击列表项可直接加入；地址与玩家名会记住', cx, 42, '#A0A0A0');
    const start = this.page * b.rows;
    for (let k = 0; k < b.rows; k++) {
      const i = start + k, y = b.y + k * b.rowH;
      ui.nine(i === this.sel ? 'text_field_hl' : 'text_field', b.x, y, b.w, b.rowH - 2, 1);
      const s = this.list[i]; if (!s) continue;
      Font.draw(c, String(s.name || s.url), b.x + 6, y + 5, i === this.sel ? '#FFFFFF' : '#E0E0E0');
      Font.draw(c, String(s.url), b.x + 6, y + 15, '#A0A0A0');
    }
    const pages = Math.max(1, Math.ceil(this.list.length / b.rows));
    Font.center(c, `${this.list.length} 个服务器 · 第 ${this.page + 1}/${pages} 页`, cx, b.y + b.rows * b.rowH + 14, '#808080');
    if (this.note) Font.center(c, this.note, cx, ui.h - 78, '#FFFF80');
  }
  onEsc() { this.game.ui.hideInput(); this.game.ui.open(this.parent || new TitleScreen(this.game)); }
}

class ServerEditScreen extends MenuScreen {
  constructor(game, parent, index) {
    super(game, index < 0 ? '添加服务器' : '编辑服务器'); this.parent = parent; this.index = index; this.titleY = 20;
    const s = index >= 0 ? parent.list[index] : null;
    this.name = s ? String(s.name || '') : '';
    this.url = s ? String(s.url || '') : 'ws://' + (location.hostname || 'localhost') + ':8780';
    this.player = s ? String(s.player || '') : String(game.settings.netName || '');
    this.field = 'name';
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.boxes = {
      name: { x: cx - 110, y: 58, w: 220, h: 20 },
      url: { x: cx - 110, y: 104, w: 220, h: 20 },
      player: { x: cx - 110, y: 150, w: 220, h: 20 },
    };
    this.widgets = [
      { x: cx - 110, y: 184, w: 105, h: 20, label: '保存', blue: true, onClick: () => this.save() },
      { x: cx + 5, y: 184, w: 105, h: 20, label: '取消', onClick: () => this.onEsc() },
      { x: cx - 110, y: u.h - 30, w: 220, h: 20, label: '返回', onClick: () => this.onEsc() },
    ];
    this.focus(this.field);
  }
  focus(f) {
    const u = this.game.ui, b = this.boxes[f];
    this.field = f;
    u.showInput(b.x + 4, b.y + 6, b.w - 8, 10, this[f], () => this.save(),
      { onInput: (v) => { this[f] = v; }, onEsc: () => this.onEsc(), max: f === 'name' ? 20 : 120 });
  }
  save() {
    const g = this.game, list = this.parent.list.slice();
    const rec = { name: this.name.trim() || this.url.trim(), url: this.url.trim(), player: this.player.trim() };
    if (!/^wss?:\\/\\//.test(rec.url)) { this.note = '地址要以 ws:// 或 wss:// 开头'; return; }
    if (this.index < 0) list.push(rec); else list[this.index] = rec;
    saveNetServers(g, list);
    this.parent.list = list;
    this.parent.sel = this.index < 0 ? list.length - 1 : this.index;
    this.parent.page = Math.floor(this.parent.sel / Math.max(1, this.parent.listBox ? this.parent.listBox.rows : 6));
    g.ui.hideInput(); g.ui.open(this.parent);
  }
  mouseDown(ui, mx, my, button) {
    for (const f of ['name', 'url', 'player']) {
      const r = this.boxes[f];
      if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) { this.focus(f); return; }
    }
    super.mouseDown(ui, mx, my, button);
  }
  drawExtra(ui) {
    const c = ui.ctx;
    const labels = { name: '服务器名称', url: '自定义链接（ws:// 或 wss://）', player: '玩家名（留空则用上次的名字）' };
    for (const f of ['name', 'url', 'player']) {
      const r = this.boxes[f];
      Font.draw(c, labels[f], r.x, r.y - 11, '#A0A0A0');
      ui.nine(this.field === f ? 'text_field_hl' : 'text_field', r.x, r.y, r.w, r.h, 1);
      if (this.field !== f) Font.draw(c, this[f], r.x + 4, r.y + 6, '#E0E0E0');
    }
    if (this.note) Font.center(c, this.note, ui.w / 2, 214, '#FF8080');
  }
  onEsc() { this.game.ui.hideInput(); this.game.ui.open(this.parent); }
}

"""
rep(ANCHOR, NEW_CLASSES + ANCHOR)

rep("""    if (location.protocol === 'http:') this.widgets.push({ x: cx + 2, y: u.h - 28, w: 150, h: 20, label: '直接连接（局域网）', onClick: () => { this.game.ui.hideInput(); this.game.ui.open(new DirectConnectScreen(this.game, this)); } });""",
"""    if (location.protocol === 'http:') this.widgets.push({ x: cx + 2, y: u.h - 28, w: 150, h: 20, label: '自定义服务器', onClick: () => { this.game.ui.hideInput(); this.game.ui.open(new ServerListScreen(this.game, this)); } });""")

open(p, 'w', newline='', encoding='utf-8').write(t)
print('probe/js/net.js -> 服务器列表界面完成，单次落盘')
