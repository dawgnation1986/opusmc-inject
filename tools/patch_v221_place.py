# -*- coding: utf-8 -*-
# patch_v221_place.py — 放置双保险：客户端 place 带物品名，proxy 优先/兜底都能拿到 itemId
import os
os.chdir(r"D:\discuz\webmc\hook\opusmc-inject")

def load(p):
    t = open(p, newline='', encoding='utf-8').read()
    return t, ("\r\n" if "\r\n" in t else "\n")

def save(p, t, EOL):
    open(p, 'w', newline='', encoding='utf-8').write(t)

def rep(t, EOL, old, new, n=1):
    o = old.replace("\n", EOL); nn = new.replace("\n", EOL)
    assert t.count(o) == n, '命中 %d 次（应 %d）: %r' % (t.count(o), n, old[:70])
    return t.replace(o, nn)

# --- net.js：place 消息带上客户端自己的物品 key ---
p = 'probe/js/net.js'
t, EOL = load(p)
t = rep(t, EOL,
"""    n.send({ t: 'place', x: t.pos[0], y: t.pos[1] + n.minY, z: t.pos[2], face: NET_FACE[t.face] ?? 1,
      cx: clamp(pt[0] - t.pos[0], 0, 1), cy: clamp(pt[1] - t.pos[1], 0, 1), cz: clamp(pt[2] - t.pos[2], 0, 1) });""",
"""    n.send({ t: 'place', item: def ? def.key : null, x: t.pos[0], y: t.pos[1] + n.minY, z: t.pos[2], face: NET_FACE[t.face] ?? 1,
      cx: clamp(pt[0] - t.pos[0], 0, 1), cy: clamp(pt[1] - t.pos[1], 0, 1), cz: clamp(pt[2] - t.pos[2], 0, 1) });""")
t = rep(t, EOL,
"""      n.send({ t: 'place', hand: 'off', x: t.pos[0], y: t.pos[1] + n.minY, z: t.pos[2], face: NET_FACE[t.face] ?? 1,
        cx: clamp(pt[0] - t.pos[0], 0, 1), cy: clamp(pt[1] - t.pos[1], 0, 1), cz: clamp(pt[2] - t.pos[2], 0, 1) });""",
"""      n.send({ t: 'place', hand: 'off', item: od ? od.key : null, x: t.pos[0], y: t.pos[1] + n.minY, z: t.pos[2], face: NET_FACE[t.face] ?? 1,
        cx: clamp(pt[0] - t.pos[0], 0, 1), cy: clamp(pt[1] - t.pos[1], 0, 1), cz: clamp(pt[2] - t.pos[2], 0, 1) });""")
save(p, t, EOL)

# --- mc-proxy：itemId = 服务端快捷栏 或 客户端带来的物品名 ---
p = 'tools/mc-proxy.mjs'
t, EOL = load(p)
t = rep(t, EOL,
"""      const item = heldItemId();
      log(`放置 0x08：@${o.x | 0},${o.y | 0},${o.z | 0} face=${o.face | 0} 物品=${item}（heldSlot=${heldSlot} hotbar=[${hotbar.join(',')}]）`);""",
"""      const fallback = o.item && MC_ITEM_IDS.get(String(o.item));
      const item = heldItemId() || fallback || 0;
      log(`放置 0x08：@${o.x | 0},${o.y | 0},${o.z | 0} face=${o.face | 0} 物品=${item}（客户端=${o.item || '-'} 兜底=${fallback || '-'} hotbar=[${hotbar.join(',')}]）`);""")
save(p, t, EOL)
print('v2.2.1 放置双保险完成，两文件各单次落盘')
