#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
导出「中华桥梁」主题为线上可执行 SQL（幂等：先删后插）
输出: scripts/famous_bridges_online.sql
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pymysql

DB = dict(host="localhost", user="root", password="123456",
          database="map_game", charset="utf8mb4")

POI_COLUMNS = ["id", "name", "category", "lng", "lat", "adcode", "address", "summary",
               "cover_url", "hint_text", "difficulty", "source", "used_count",
               "verify_status", "shape_type", "radius_km", "area_review"]

THEME_COLUMNS = ["id", "code", "name", "description", "icon", "cover_url",
                 "group_name", "sort_order", "enabled"]


def esc(v):
    if v is None:
        return "NULL"
    s = str(v)
    s = s.replace("\\", "\\\\").replace("'", "''").replace("\n", " ")
    return f"'{s}'"


def main():
    conn = pymysql.connect(**DB)
    cur = conn.cursor(pymysql.cursors.DictCursor)

    cur.execute(f"SELECT {', '.join(POI_COLUMNS)} FROM pois "
                f"WHERE category='famous_bridges' ORDER BY id")
    pois = cur.fetchall()

    cur.execute(f"SELECT {', '.join(THEME_COLUMNS)} FROM poi_themes WHERE code='famous_bridges'")
    themes = cur.fetchall()
    conn.close()

    if not pois or not themes:
        print("未找到 famous_bridges 数据，请先运行 scripts.insert_famous_bridges")
        sys.exit(1)

    poi_col_sql = ", ".join(f"`{c}`" for c in POI_COLUMNS)
    theme_col_sql = ", ".join(f"`{c}`" for c in THEME_COLUMNS)

    lines = []
    lines.append("-- ============================================================")
    lines.append("-- 猜地图 map 项目：新主题「中华桥梁」导入（线上执行）")
    lines.append("-- 生成日期: 2026-08-14")
    lines.append(f"-- poi_themes 1 行 + pois {len(pois)} 条")
    lines.append("-- 说明: 幂等脚本，先清理 famous_bridges 再重新插入，可重复执行")
    lines.append("-- 新 POI 全部为 point（radius_km=0）、area_review=1（待核定）")
    lines.append("-- ============================================================")
    lines.append("")
    lines.append("SET NAMES utf8mb4;")
    lines.append("START TRANSACTION;")
    lines.append("")
    lines.append("DELETE FROM `pois` WHERE `category` = 'famous_bridges';")
    lines.append("DELETE FROM `poi_themes` WHERE `code` = 'famous_bridges';")
    lines.append("")
    theme_rows = ",\n".join(
        "(" + ", ".join(esc(t[c]) for c in THEME_COLUMNS) + ")" for t in themes)
    lines.append(f"INSERT INTO `poi_themes` ({theme_col_sql}) VALUES")
    lines.append(theme_rows + ";")
    lines.append("")
    value_rows = ",\n".join(
        "(" + ", ".join(esc(r[c]) for c in POI_COLUMNS) + ")" for r in pois)
    lines.append(f"INSERT INTO `pois` ({poi_col_sql}) VALUES")
    lines.append(value_rows + ";")
    lines.append("")
    lines.append("COMMIT;")
    lines.append("")
    lines.append(f"-- 校验：应为 {len(pois)}")
    lines.append("SELECT COUNT(*) FROM `pois` WHERE `category` = 'famous_bridges';")
    lines.append("")

    output = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "famous_bridges_online.sql")
    with open(output, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"已生成: {output}")
    print(f"poi_themes {len(themes)} 行, pois {len(pois)} 条")
    missing = [r["id"] for r in pois if not r["cover_url"]]
    if missing:
        print(f"警告: 以下 POI 无封面: {missing}")


if __name__ == "__main__":
    main()
