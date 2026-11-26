'use strict';
// 传送石碑（Waystones 移植）
// 原版依据：WaystoneBlock 激活、WaystoneSettingsScreen（名称输入框 + 其他玩家可见勾选框）、
// WaystoneSelectionScreenBase（搜索框 + 目的地列表 + 翻页 + 当前位置可点开设置）、
// WarpStoneItem / WarpScrollItem / ReturnScrollItem

OpusMC.code('waystones', (api) => {
  const BLOCKS = [
    'waystones_waystone',
    'waystones_mossy_waystone',
    'waystones_sandy_waystone',
    'waystones_blackstone_waystone',
    'waystones_deepslate_waystone'
  ];
  const ACTIVE_OF = {}, BASE_OF = {};
  for (const k of BLOCKS) { ACTIVE_OF[k] = k + '_active'; BASE_OF[k + '_active'] = k; }
  const ALL_BLOCK_KEYS = BLOCKS.concat(Object.values(ACTIVE_OF));

  const REG = 'registry';
  const CD = 'cooldown';
  const WARP_CD = 30000;
  const UNNAMED = '<未命名>';

  const dim = () => api.world.dimension;

  function load(key, def) {
    try { const v = JSON.parse(api.store[key] || 'null'); return v == null ? def : v; }
    catch (e) { return def; }
  }
  const save = (key, v) => { api.store[key] = JSON.stringify(v); };
  const registry = () => { const r = load(REG, []); return Array.isArray(r) ? r : []; };
  const find = (r, x, y, z) => r.find((w) => w.x === x && w.y === y && w.z === z && w.dim === dim());

  function alive(list) {
    return list.filter((w) => {
      if (w.dim !== dim()) return false;
      const b = api.world.getBlock(w.x, w.y, w.z);
      return BLOCKS.includes(b) || !!BASE_OF[b];
    });
  }
  function unregister(x, y, z) {
    save(REG, registry().filter((w) => !(w.x === x && w.y === y && w.z === z && w.dim === dim())));
  }
  function dist(w) {
    const dx = api.player.x - (w.x + 0.5), dz = api.player.z - (w.z + 0.5);
    return Math.sqrt(dx * dx + dz * dz);
  }
  function rename(w, name, global) {
    w.name = name; w.global = !!global;
    save(REG, registry().map((q) => (q.x === w.x && q.y === w.y && q.z === w.z && q.dim === w.dim) ? w : q));
  }

  function teleportTo(w) {
    api.player.teleport(w.x + 0.5, w.y + 2, w.z + 0.5);
    api.world.sound('entity.enderman.teleport', w.x + 0.5, w.y + 1.2, w.z + 0.5, 1.0, 1.0);
    api.world.particle('portal', w.x + 0.5, w.y + 1.5, w.z + 0.5, 24);
  }
  function doTeleport(w, mode, self) {
    if (self && w.x === self.x && w.y === self.y && w.z === self.z) { api.message('你已经在目的地了', '#AAAAAA'); return; }
    if (mode === 'scroll') api.player.consumeHeld(1);
    if (mode === 'stone') api.store[CD] = JSON.stringify(Date.now() + WARP_CD);
    api.closeMenu();
    teleportTo(w);
    api.message('已传送到 ' + (w.name || UNNAMED), '#55FF55');
  }

  // ================= 原版 WaystoneSettingsScreen =================
  function settingsScreen(w) {
    const ui = api.raw.game.ui;
    let value = w.name || '', global = !!w.global, inputOn = false;
    const s = {
      bgDim: 0.5, blurBg: true,
      layout() {
        const W = ui.w, H = ui.h;
        s.title = [Math.floor(W / 2) - 100, Math.floor(H / 2) - 35];
        s.field = { x: Math.floor(W / 2) - 100, y: Math.floor(H / 2) - 20, w: 200, h: 20 };
        s.done = { x: Math.floor(W / 2), y: Math.floor(H / 2) + 10, w: 100, h: 20, label: '完成', onClick: submit };
        s.chk = { x: Math.floor(W / 2) - 100, y: Math.floor(H / 2) + 10, w: 20, h: 20, label: global ? '✔' : '', onClick: toggle };
        s.chkLabel = [Math.floor(W / 2) - 75, Math.floor(H / 2) + 16];
        s.cancel = { x: Math.floor(W / 2) - 100, y: Math.floor(H / 2) + 40, w: 100, h: 20, label: '取消', onClick: () => ui.close() };
      },
      draw(u) {
        u.menuBackground();
        if (typeof Font !== 'undefined') Font.draw(u.ctx, '传送石碑设置', s.title[0], s.title[1], '#FFFFFF');
        if (!inputOn) {
          inputOn = true;
          u.showInput(s.field.x, s.field.y, s.field.w, s.field.h, value, submit,
            { onInput: (v) => { value = v; }, onEsc: () => u.close(), max: 128 });
        }
        u.button(s.done); u.button(s.chk); u.button(s.cancel);
        if (typeof Font !== 'undefined') Font.draw(u.ctx, '其他玩家可见', s.chkLabel[0], s.chkLabel[1], '#FFFFFF');
      },
      mouseDown(u, mx, my, b) {
        if (b !== 0) return;
        for (const wg of [s.done, s.chk, s.cancel]) {
          if (u.hit(wg, mx, my)) {
            if (wg === s.chk) toggle(); else wg.onClick();
            return;
          }
        }
        if (typeof Font !== 'undefined') {
          const lw = Font.width('其他玩家可见');
          if (mx >= s.chkLabel[0] && mx < s.chkLabel[0] + lw && my >= s.chkLabel[1] && my < s.chkLabel[1] + 9) toggle();
        }
      },
      key(u, ev) { if (ev.key === 'Escape') { u.close(); return true; } return false; }
    };
    function toggle() { global = !global; s.chk.label = global ? '✔' : ''; }
    function submit(v) {
      const name = String(v != null ? v : value).trim();
      if (!name) { inputOn = false; value = ''; ui.hideInput(); return; } // 原版：空名字不提交，回到输入框
      rename(w, name, global);
      ui.hideInput();
      ui.close();
    }
    ui.open(s);
  }

  // ================= 原版 WaystoneSelectionScreenBase =================
  function selectionScreen(self, mode, page0) {
    const ui = api.raw.game.ui;
    let search = '', pageOffset = page0 || 0, inputOn = false;
    const all = alive(registry()).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const filter = () => all.filter((w) => (w.name || UNNAMED).toLowerCase().includes(search.toLowerCase()));
    const s = {
      bgDim: 0.5, blurBg: true,
      layout() {
        const W = ui.w, H = ui.h, bp = Math.max(4, Math.min(Math.floor((H * 0.6 - 64 - 25) / 25), Math.max(4, filter().length)));
        s.bp = bp;
        s.top = Math.floor(H / 2) - Math.floor((64 + bp * 22 + 40) / 2);
        s.title = [Math.floor(W / 2), s.top + 6];
        s.header = [Math.floor(W / 2), s.top + 22];
        s.search = { x: Math.floor(W / 2) - 99, y: s.top + 40, w: 198, h: 20 };
        s.prev = { x: Math.floor(W / 2) - 100, y: s.top + 64 + bp * 22 + 10, w: 95, h: 20, label: '上一页', onClick: () => { if (pageOffset > 0) { pageOffset--; rebuild(); } } };
        s.next = { x: Math.floor(W / 2) + 5, y: s.top + 64 + bp * 22 + 10, w: 95, h: 20, label: '下一页', onClick: () => { pageOffset++; rebuild(); } };
        rebuild();
      },
      draw(u) {
        u.menuBackground();
        if (typeof Font !== 'undefined') {
          Font.center(u.ctx, '选择目的地：', s.title[0], s.title[1], '#FFFFFF');
          Font.center(u.ctx, '当前位置：' + ((self && self.name) || UNNAMED), s.header[0], s.header[1], '#FFFF55');
        }
        if (!inputOn) {
          inputOn = true;
          u.showInput(s.search.x, s.search.y, s.search.w, s.search.h, search, () => { },
            { onInput: (v) => { search = v; pageOffset = 0; rebuild(); }, onEsc: () => u.close(), max: 50 });
        }
        for (const b of s.rows) u.button(b);
        u.button(s.prev); u.button(s.next);
      },
      mouseDown(u, mx, my, btn) {
        if (btn !== 0) return;
        if (self && my >= s.header[1] - 8 && my <= s.header[1] + 4 && mx > s.header[0] - 90 && mx < s.header[0] + 90) { ui.hideInput(); ui.close(); settingsScreen(self); return; }
        for (const b of s.rows) if (b.enabled !== false && u.hit(b, mx, my)) { ui.hideInput(); doTeleport(b.w, mode, self); return; }
        if (pageOffset > 0 && u.hit(s.prev, mx, my)) { pageOffset--; rebuild(); return; }
        if (pageOffset < Math.max(0, Math.ceil(filter().length / s.bp) - 1) && u.hit(s.next, mx, my)) { pageOffset++; rebuild(); return; }
      },
      key(u, ev) { if (ev.key === 'Escape') { u.hideInput(); u.close(); return true; } return false; }
    };
    function rebuild() {
      const W = ui.w, list = filter();
      s.rows = list.slice(pageOffset * s.bp, pageOffset * s.bp + s.bp).map((w, i) => ({
        x: Math.floor(W / 2) - 100, y: s.top + 64 + i * 22, w: 200, h: 20,
        label: (w.name || UNNAMED), w, enabled: !(self && w.x === self.x && w.y === self.y && w.z === self.z)
      }));
      s.prev.enabled = pageOffset > 0;
      s.next.enabled = pageOffset < Math.max(0, Math.ceil(list.length / s.bp) - 1);
    }
    ui.open(s);
  }

  const hasUi = () => !!(api.raw && api.raw.game && api.raw.game.ui && typeof Font !== 'undefined');

  function openSettings(w) {
    if (hasUi()) return settingsScreen(w);
    api.menu({
      title: '传送石碑设置',
      lines: ['名称：' + (w.name || UNNAMED)],
      buttons: [{ label: '保持此名称', onClick: () => api.closeMenu() }, { label: '关闭', onClick: () => api.closeMenu() }]
    });
  }
  function openSelection(self, mode, page) {
    if (hasUi()) return selectionScreen(self, mode, page || 0);
    const list = alive(registry()).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const names = list;
    const pages = Math.max(1, Math.ceil(names.length / 7));
    const p = Math.max(0, Math.min(page || 0, pages - 1));
    const cur = self;
    const buttons = names.slice(p * 7, p * 7 + 7).map((w) => ({
      label: (w.name || UNNAMED) + ' · ' + w.x + ',' + w.z + (cur && w.x === cur.x && w.y === cur.y && w.z === cur.z ? '（当前位置）' : ''),
      onClick: () => doTeleport(w, mode, self)
    }));
    if (p > 0) buttons.push({ label: '上一页', onClick: () => { api.closeMenu(); openSelection(self, mode, p - 1); } });
    if (p < pages - 1) buttons.push({ label: '下一页', onClick: () => { api.closeMenu(); openSelection(self, mode, p + 1); } });
    buttons.push({ label: '关闭', onClick: () => api.closeMenu() });
    api.menu({ title: '选择目的地：', lines: ['当前位置：' + ((self && self.name) || UNNAMED), '已激活 ' + names.length + ' 座'], buttons });
  }

  // ---- 右键石碑：第一次进入设置（名称空着，自己填）；已激活进选择界面 ----
  function useWaystone(ev) {
    ev.cancel();
    const x = ev.x, y = ev.y, z = ev.z;
    const here = api.world.getBlock(x, y, z);
    const base = BASE_OF[here] || here;
    const list = registry();
    let w = find(list, x, y, z);
    if (!w) {
      w = { x, y, z, dim: dim(), name: '', global: false };
      list.push(w);
      save(REG, list);
      api.world.setBlock(x, y, z, ACTIVE_OF[base] || base);
      api.world.sound('entity.player.levelup', x + 0.5, y + 1, z + 0.5, 0.2, 1.0);
      api.world.particle('effect', x + 0.5, y + 3, z + 0.5, 32);
      api.world.particle('effect', x + 0.5, y + 4, z + 0.5, 32);
      api.message('已激活的传送石碑：' + (w.name || UNNAMED), '#FFFF55');
      openSettings(w);
      return;
    }
    openSelection(w, 'waystone', 0);
  }
  for (const k of ALL_BLOCK_KEYS) api.onUseBlock(k, useWaystone);

  api.on('blockBroken', (ev) => { if (ALL_BLOCK_KEYS.includes(ev.block)) unregister(ev.x, ev.y, ev.z); });

  // ---- 传送石：30 秒冷却，不消耗 ----
  api.onUseItem('waystones_warp_stone', () => {
    if (Date.now() < (+load(CD, 0) || 0)) { api.message('传送石未完全充能。', '#FF5555'); return; }
    api.world.sound('block.portal.trigger', api.player.x, api.player.y + 1, api.player.z, 0.1, 2.0);
    openSelection(null, 'stone', 0);
  });
  // ---- 传送卷轴：同一个选择界面，传送时消耗一张 ----
  api.onUseItem('waystones_warp_scroll', () => {
    api.world.sound('block.portal.trigger', api.player.x, api.player.y + 1, api.player.z, 0.1, 2.0);
    openSelection(null, 'scroll', 0);
  });
  // ---- 返回卷轴：最近的已激活石碑，消耗一张 ----
  api.onUseItem('waystones_return_scroll', () => {
    const list = alive(registry());
    if (!list.length) { api.message('未激活任何传送石碑。', '#FF5555'); return; }
    list.sort((a, b) => dist(a) - dist(b));
    api.player.consumeHeld(1);
    teleportTo(list[0]);
    api.message('已传送到 ' + (list[0].name || UNNAMED), '#55FF55');
  });

  // ---- 命令保留原版 ModCommands 的 list / rename / search ----
  api.command('waystone', { args: '<list|rename 名字|search 关键词>', desc: '传送石碑：列出 / 命名 / 搜索' }, (args) => {
    const sub = (args[0] || 'list').toLowerCase(), rest = args.slice(1).join(' ').trim();
    const list = alive(registry());
    if (sub === 'rename' && rest) {
      const near = list.slice().sort((a, b) => dist(a) - dist(b))[0];
      if (!near) { api.message('未激活任何传送石碑。', '#FF5555'); return; }
      rename(near, rest, near.global);
      api.message('已激活的传送石碑：' + rest, '#55FF55');
      return;
    }
    if (sub === 'search') {
      const hits = list.filter((w) => String(w.name).includes(rest));
      if (!hits.length) { api.message('没有匹配「' + rest + '」的传送石碑', '#FF5555'); return; }
      for (const w of hits) api.message((w.name || UNNAMED) + ' · ' + w.x + ' ' + w.y + ' ' + w.z, '#55FF55');
      return;
    }
    if (!list.length) { api.message('未激活任何传送石碑。', '#AAAAAA'); return; }
    list.sort((a, b) => dist(a) - dist(b));
    for (const w of list) api.message((w.name || UNNAMED) + ' · ' + w.x + ' ' + w.y + ' ' + w.z + ' · ' + Math.round(dist(w)) + ' 格', '#55FF55');
  });
});
