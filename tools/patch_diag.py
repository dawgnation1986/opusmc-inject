# -*- coding: utf-8 -*-
# companion.js load() 弹窗诊断补丁
import os
os.chdir(r"D:\discuz\webmc\hook\opusmc-inject\probe\js")

p = 'companion.js'
with open(p, newline='', encoding='utf-8') as fh:
    t = fh.read()
eol = '\r\n' if '\r\n' in t else '\n'

old = ("    try { this.status = await Account.api('/api/ai/status', {}); } catch (e) { console.warn('[Companion] status 拉取失败:', e && e.message, e && e.status); }")
new = eol.join([
    "    try { this.status = await Account.api('/api/ai/status', {}); }",
    "    catch (e) { this.status = null; alert('[AI 诊断] status 拉取失败: ' + (e && e.message) + ' (HTTP ' + (e && e.status) + ')'); }",
    "    if (this.status && !this.status.on) alert('[AI 诊断] 服务端 on=false: ' + JSON.stringify(this.status).slice(0, 200));",
])

n = t.count(old)
assert n == 1, 'old 命中 %d 次' % n
t = t.replace(old, new)

# 未登录时的提示（诊断期）：load 被调但没登录，弹一次窗
old2 = "    if (COMPANION_OFF || !Account.loggedIn) { this.status = null; return null; }"
new2 = ("    if (COMPANION_OFF || !Account.loggedIn) { this.status = null;"
        " if (!COMPANION_OFF && typeof alert === 'function' && !window.__aiDiagShown) { window.__aiDiagShown = 1;"
        " alert('[AI 诊断] 未登录（Account.loggedIn=false），跳过 status 拉取——先去标题屏登录'); } return null; }")
n2 = t.count(old2)
assert n2 == 1, 'old2 命中 %d 次' % n2
t = t.replace(old2, new2)

with open(p, 'w', newline='', encoding='utf-8') as fh:
    fh.write(t)
print('弹窗诊断 OK (EOL=%r)' % eol)
