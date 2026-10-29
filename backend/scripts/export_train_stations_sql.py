#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""导出「车站寻踪」主题为线上可执行 SQL。输出: scripts/train_stations_online.sql"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pymysql

DB = dict(host="localhost", user="root", password="123456", database="map_game", charset="utf8mb4")
POI_COLUMNS = ["id","name","category","lng","lat","adcode","address","summary","cover_url","hint_text","difficulty","source","used_count","verify_status","shape_type","radius_km","area_review"]
THEME_COLUMNS = ["id","code","name","description","icon","cover_url","group_name","sort_order","enabled"]

def esc(v):
    if v is None: return "NULL"
    s = str(v).replace("\\","\\\\").replace("'","''").replace("\n"," ")
    return f"'{s}'"

def main():
    conn = pymysql.connect(**DB)
    cur = conn.cursor(pymysql.cursors.DictCursor)
    cur.execute(f"SELECT {', '.join(POI_COLUMNS)} FROM pois WHERE category='train_stations' ORDER BY id")
    pois = cur.fetchall()
    cur.execute(f"SELECT {', '.join(THEME_COLUMNS)} FROM poi_themes WHERE code='train_stations'")
    themes = cur.fetchall()
    conn.close()
    if not pois or not themes:
        print("未找到 train_stations 数据"); sys.exit(1)
    poi_col_sql = ", ".join(f"`{c}`" for c in POI_COLUMNS)
    theme_col_sql = ", ".join(f"`{c}`" for c in THEME_COLUMNS)
    lines = ["-- ============================================================",
             "-- 猜地图 map 项目：新主题「车站寻踪」导入（线上执行）",
             "-- 生成日期: 2026-08-14",
             f"-- poi_themes 1 行 + pois {len(pois)} 条",
             "-- 幂等脚本，可重复执行",
             "-- ============================================================",
             "", "SET NAMES utf8mb4;", "START TRANSACTION;", "",
             "DELETE FROM `pois` WHERE `category` = 'train_stations';",
             "DELETE FROM `poi_themes` WHERE `code` = 'train_stations';", ""]
    theme_rows = ",\n".join("(" + ", ".join(esc(t[c]) for c in THEME_COLUMNS) + ")" for t in themes)
    lines.append(f"INSERT INTO `poi_themes` ({theme_col_sql}) VALUES")
    lines.append(theme_rows + ";")
    lines.append("")
    value_rows = ",\n".join("(" + ", ".join(esc(r[c]) for c in POI_COLUMNS) + ")" for r in pois)
    lines.append(f"INSERT INTO `pois` ({poi_col_sql}) VALUES")
    lines.append(value_rows + ";")
    lines += ["", "COMMIT;", "",
              f"-- 校验：应为 {len(pois)}",
              "SELECT COUNT(*) FROM `pois` WHERE `category` = 'train_stations';", ""]
    output = os.path.join(os.path.dirname(os.path.abspath(__file__)), "train_stations_online.sql")
    with open(output, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"已生成: {output}")
    print(f"poi_themes {len(themes)} 行, pois {len(pois)} 条")
    missing = [r["id"] for r in pois if not r["cover_url"]]
    if missing: print(f"警告: 无封面 POI: {missing}")

if __name__ == "__main__":
    main()
