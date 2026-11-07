# -*- coding: utf-8 -*-
# patch_v221_rooms.py — 本地页的房间地址自动指向本地反代 + 启动脚本 URL
import os
os.chdir(r"D:\discuz\webmc\hook\opusmc-inject")

def patch(path, old, new, n=1):
    t = open(path, newline='', encoding='utf-8').read()
    EOL = "\r\n" if "\r\n" in t else "\n"
    o = old.replace("\n", EOL); nn = new.replace("\n", EOL)
    c = t.count(o)
    assert c == n, '%s 命中 %d 次（应 %d）: %r' % (path, c, n, old[:70])
    open(path, 'w', newline='', encoding='utf-8').write(t.replace(o, nn))
    print(path, '->', 'CRLF' if EOL == "\r\n" else 'LF', '已更新')

patch('probe/js/net.js',
"""    if (!q && /^(localhost|127\\.|\\[::1\\])|\\.(localhost|test)$/.test(location.hostname)) return '';
    return String(q || (window.NET_CONFIG && NET_CONFIG.rooms) || '').replace(/\\/+$/, '');""",
"""    const local = /^(localhost|127\\.|\\[::1\\])|\\.(localhost|test)$/.test(location.hostname);
    if (!q && local) return '';
    let b = String(q || (window.NET_CONFIG && NET_CONFIG.rooms) || '').replace(/\\/+$/, '');
    // 本地页直连线上房间服务会被 Origin 白名单拒（/api/* 403、/ws 502）；
    // 浏览器改不了 WebSocket 的 Origin，统一走 tools/server.mjs 的本地反代。
    if (local && /honghemc\\.cn/.test(b)) b = location.origin;
    return b;""")

patch('launch-play.bat',
"""start msedge "http://localhost:8777/game.html?rooms=https://xz.honghemc.cn:8443\"""",
"""start msedge "http://localhost:8777/game.html?rooms=http://localhost:8777\"""")
