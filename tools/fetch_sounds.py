#!/usr/bin/env python3
"""抓取 PHPMC/OpusMC 线上的全部音效文件（sounds/sfx/<name>.m4a）。

清单来源：js/sound_events.js 的 SOUND_EVENTS（事件 → 文件名数组）。
用法：python tools/fetch_sounds.py [基础URL]
默认 URL 是 v39426 版本；游戏更新后版本号路径会变，先抓最新的
js/sound_events.js 确认清单再跑本脚本。
"""
import io
import json
import os
import re
import subprocess
import sys

BASE = sys.argv[1] if len(sys.argv) > 1 else \
    "https://www.bilibilitoy.com/toy/OpusMC/47455601425408-v39426"

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVENTS = os.path.join(HERE, "probe", "js", "sound_events.js")
OUT = os.path.join(HERE, "probe", "sounds")


def main():
    t = io.open(EVENTS, encoding="utf-8").read()
    m = re.search(r"window\.SOUND_EVENTS\s*=\s*(\{.*\});?\s*$", t, re.S)
    if not m:
        print("先抓 js/sound_events.js 到 probe/js/（curl 同目录其他 js 的方法）")
        sys.exit(1)
    d = json.loads(m.group(1))
    names = sorted(set(s["name"] for ev in d.values() for s in ev if s.get("name")))
    print("音效文件数:", len(names))
    os.makedirs(OUT, exist_ok=True)
    ok, fail = 0, []
    for n in names:
        rel = os.path.join("sounds", "sfx", n + ".m4a")
        full = os.path.join(OUT, "sfx", n + ".m4a")
        os.makedirs(os.path.dirname(full), exist_ok=True)
        r = subprocess.run(
            ["curl", "-s", "--compressed", BASE + "/sounds/sfx/" + n + ".m4a",
             "-H", "User-Agent: Mozilla/5.0", "-H", "Referer: https://www.bilibili.com/",
             "-o", full, "-w", "%{http_code}"],
            capture_output=True, text=True)
        if r.stdout.strip() == "200":
            ok += 1
        else:
            fail.append((rel, r.stdout.strip()))
            if os.path.exists(full):
                os.remove(full)
    print("下载成功:", ok, "失败:", len(fail))
    for rel, code in fail[:10]:
        print("  ", code, rel)


if __name__ == "__main__":
    main()
