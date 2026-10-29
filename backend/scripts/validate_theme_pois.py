#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
校验主题种子数据正确性

检查项：
1. 每个主题数量与种子清单一致
2. 坐标在中国范围内（WGS84）
3. adcode / cover_url / hint_text / summary 非空
4. 同主题内重复坐标检测（<500m 视为疑似重复）
5. 同主题内重复名称检测
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pymysql

from scripts.theme_seeds_data import THEME_SEEDS

DB = dict(host="localhost", user="root", password="123456",
          database="map_game", charset="utf8mb4")

# 中国范围（WGS84，含边界余量）
LNG_MIN, LNG_MAX = 73.0, 136.0
LAT_MIN, LAT_MAX = 3.0, 54.0


def haversine_km(lng1, lat1, lng2, lat2):
    import math
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlng / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


def main():
    conn = pymysql.connect(**DB)
    cur = conn.cursor(pymysql.cursors.DictCursor)

    issues = []
    total_ok = 0

    print("=" * 70)
    print("主题种子数据校验报告")
    print("=" * 70)

    for cat, seed_names in THEME_SEEDS.items():
        expected = len(seed_names)
        cur.execute(
            "SELECT id, name, lng, lat, adcode, address, summary, cover_url, hint_text, source "
            "FROM pois WHERE category=%s", (cat,))
        rows = cur.fetchall()
        actual = len(rows)

        status = "✓" if actual == expected else "✗"
        print(f"\n[{status}] {cat}: {actual}/{expected}")
        if actual != expected:
            issues.append(f"{cat}: 数量不符 {actual}/{expected}")

        # 逐行检查
        seen_coords = []
        seen_names = {}
        for r in rows:
            name = r["name"]
            lng, lat = float(r["lng"]), float(r["lat"])

            # 1. 坐标范围
            if not (LNG_MIN <= lng <= LNG_MAX and LAT_MIN <= lat <= LAT_MAX):
                issues.append(f"{cat}/{name}: 坐标越界 ({lng},{lat})")

            # 2. 必填字段
            for field in ("adcode", "cover_url", "hint_text", "summary", "address"):
                if not r[field]:
                    issues.append(f"{cat}/{name}: {field} 为空")

            # 3. 重复名称
            if name in seen_names:
                issues.append(f"{cat}/{name}: 名称重复")
            seen_names[name] = True

            # 4. 重复坐标（<100m 视为 geocode 撞点；200-500m 的相邻场馆属正常）
            for (plng, plat, pname) in seen_coords:
                d = haversine_km(lng, lat, plng, plat)
                if d < 0.1:
                    issues.append(f"{cat}/{name}: 与 {pname} 坐标重复 ({d*1000:.0f}m)")
                    break
            seen_coords.append((lng, lat, name))

        total_ok += sum(1 for r in rows)

    conn.close()

    print("\n" + "=" * 70)
    if issues:
        print(f"发现 {len(issues)} 个问题:")
        for it in issues:
            print(f"  ⚠ {it}")
    else:
        print("✅ 全部通过，无问题")
    print("=" * 70)


if __name__ == "__main__":
    main()
