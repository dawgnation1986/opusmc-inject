# -*- coding: utf-8 -*-
# patch_v220_ui.py — 自定义服务器列表改成官方房间列表同款视觉（每行右侧「进入」按钮）
import os
os.chdir(r"D:\discuz\webmc\hook\opusmc-inject")
p = 'probe/js/net.js'
t = open(p, newline='', encoding='utf-8').read()
EOL = "\r\n" if "\r\n" in t else "\n"
print('行尾 =', 'CRLF' if EOL == "\r\n" else 'LF')

start = t.index('class ServerListScreen extends MenuScreen {')
end = t.index('class ServerEditScreen extends MenuScreen {', start)
assert start < end

NEW = """class ServerListScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, '多人游戏 · 自定义服务器'); this.parent = parent; this.titleY = 12;
    this.list = loadNetServers(game);
    this.sel = 0; this.page = 0; this.lastClickAt = 0; this.lastSel = -1; this.note = '';
  }
  // 与 MultiplayerScreen.rows() 完全一致，视觉才对得上官方房间列表
  rows() { return Math.max(2, Math.floor((this.game.ui.h - 82 - 62) / 24)); }
  layout() {
    const u = this.game.ui, cx = u.w / 2, n = this.rows();
    const pages = Math.max(1, Math.ceil(this.list.length / n));
    this.page = Math.max(0, Math.min(this.page, pages - 1));
    this.listBox = { x: cx - 152, y: 84, w: 254, rowH: 24 };
    const view = this.list.slice(this.page * n, this.page * n + n);
    this.widgets = [
      { x: cx + 106, y: 66, w: 22, h: 14, label: '<', enabled: this.page > 0, onClick: () => { this.page--; this.layout(); } },
      { x: cx + 130, y: 66, w: 22, h: 14, label: '>', enabled: this.page < pages - 1, onClick: () => { this.page++; this.layout(); } },
    ];
    // 官方房间那样：每行右侧一个「进入」，点一下直接进
    view.forEach((s, i) => {
      const idx = this.page * n + i;
      this.widgets.push({ x: cx + 106, y: 84 + i * 24, w: 46, h: 20, label: '进入', blue: idx === this.sel,
        tip: [String(s.name || s.url), String(s.url), '点一下加入；双击这一行也可以'],
        onClick: () => { this.sel = idx; this.join(); } });
    });
    this.widgets.push(
      { x: cx - 152, y: u.h - 52, w: 98, h: 20, label: '添加服务器', onClick: () => this.game.ui.open(new ServerEditScreen(this.game, this, -1)) },
      { x: cx - 50, y: u.h - 52, w: 98, h: 20, label: '编辑', onClick: () => { if (this.list.length) this.game.ui.open(new ServerEditScreen(this.game, this, this.sel)); } },
      { x: cx + 52, y: u.h - 52, w: 100, h: 20, label: '删除', onClick: () => this.del() },
      { x: cx - 152, y: u.h - 28, w: 150, h: 20, label: '返回', onClick: () => this.onEsc() },
      { x: cx + 2, y: u.h - 28, w: 150, h: 20, label: '直接连接（手填）', onClick: () => this.game.ui.open(new DirectConnectScreen(this.game, this)) },
    );
  }
  mouseDown(ui, mx, my, button) {
    const b = this.listBox, n = this.rows();
    if (b && mx >= b.x && mx < b.x + b.w && my >= b.y && my < b.y + n * 24) {
      const idx = this.page * n + Math.floor((my - b.y) / 24);
      if (idx < this.list.length) {
        const now = performance.now();
        const dbl = idx === this.lastSel && now - this.lastClickAt < 400;
        this.sel = idx; this.lastSel = idx; this.lastClickAt = now;
        if (dbl) this.join(); else this.layout();
        return;
      }
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
    this.list.splice(this.sel, 1);
    saveNetServers(this.game, this.list);
    this.sel = Math.max(0, Math.min(this.sel, this.list.length - 1));
    this.page = Math.min(this.page, Math.max(0, Math.ceil(this.list.length / this.rows()) - 1));
    this.layout();
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, b = this.listBox, n = this.rows();
    if (!b) return;
    Font.draw(c, `自定义服务器（${this.list.length}）`, cx - 152, 69, '#FFFFFF');
    if (!this.list.length) Font.center(c, '还没有服务器，点「添加服务器」加一个', cx, 100, '#A0A0A0');
    this.list.slice(this.page * n, this.page * n + n).forEach((s, i) => {
      const y = 84 + i * 24, idx = this.page * n + i;
      c.fillStyle = idx === this.sel ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.35)';
      c.fillRect(b.x, y, b.w, 20);
      Font.draw(c, fitText(String(s.name || s.url), 248), b.x + 3, y + 2, '#FFFFFF');
      Font.draw(c, fitText(String(s.url), 248), b.x + 3, y + 11, '#90C890');
    });
    if (this.note) Font.center(c, fitText(this.note, ui.w - 8), cx, ui.h - 62, this.noteColor || '#FFFF80');
  }
  onEsc() { this.game.ui.hideInput(); this.game.ui.open(this.parent || new TitleScreen(this.game)); }
}

"""
t = t[:start] + NEW.replace("\n", EOL) + t[end:]

old2 = "this.parent.page = Math.floor(this.parent.sel / Math.max(1, this.parent.listBox ? this.parent.listBox.rows : 6));"
assert t.count(old2) == 1, 'ServerEditScreen 页码行未命中'
t = t.replace(old2, "this.parent.page = Math.floor(this.parent.sel / Math.max(1, this.parent.rows()));")

open(p, 'w', newline='', encoding='utf-8').write(t)
print('v2.2.0 界面完成，单次落盘')
