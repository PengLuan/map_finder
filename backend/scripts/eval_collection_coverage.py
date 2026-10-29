# -*- coding: utf-8 -*-
"""评估 collection-list.md 100 个专题的点位在本地 pois 表的覆盖情况。"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pymysql

DOC = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "..", "docs", "collection-list.md",
)

rows = []
with open(DOC, encoding="utf-8") as f:
    for line in f:
        m = re.match(
            r"^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|",
            line,
        )
        if m:
            code = m.group(3).strip()
            name = m.group(2).strip()
            count = int(m.group(4))
            points = m.group(5)
            rows.append((code, name, count, points))

print(f"解析到专题数: {len(rows)}")


def clean_point(p: str) -> str:
    p = p.strip()
    p = re.sub(r"[（(].*?[）)]", "", p)  # 去括号注释
    return p.strip()


parsed = []
for code, name, count, points in rows:
    pts = [clean_point(x) for x in points.split("→") if clean_point(x)]
    parsed.append((code, name, count, pts))

conn = pymysql.connect(
    host="127.0.0.1", user="root", password="123456",
    database="map_game", charset="utf8mb4",
)
cur = conn.cursor()
cur.execute("SELECT name, id, lng, lat, cover_url FROM pois")
poi_map = {}
for r in cur.fetchall():
    poi_map.setdefault(r[0], []).append(r)

total = 0
matched = 0
unmatched = []
missing_by_coll = {}
for code, name, count, pts in parsed:
    total += len(pts)
    for p in pts:
        if p in poi_map:
            matched += 1
        else:
            unmatched.append((code, name, p))
            missing_by_coll.setdefault(code, []).append(p)

print(f"点位总数: {total}")
print(f"匹配 pois: {matched} ({matched * 100.0 / total:.1f}%)")
print(f"未匹配: {len(unmatched)} ({len(unmatched) * 100.0 / total:.1f}%)")
print()
print("=== 未匹配点位（按专题）===")
for code, name, count, pts in parsed:
    miss = missing_by_coll.get(code)
    if miss:
        print(f"{code} {name} ({count}点): 缺 {miss}")
conn.close()
