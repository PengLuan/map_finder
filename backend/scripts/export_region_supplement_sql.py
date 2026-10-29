#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""导出天津/台湾/香港/澳门补充POI为SQL。输出: scripts/region_supplement_online.sql"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pymysql

DB = dict(host="localhost", user="root", password="123456", database="map_game", charset="utf8mb4")
POI_COLUMNS = ["id","name","category","lng","lat","adcode","address","summary","cover_url","hint_text","difficulty","source","used_count","verify_status","shape_type","radius_km","area_review"]

def esc(v):
    if v is None: return "NULL"
    s = str(v).replace("\\","\\\\").replace("'","''").replace("\n"," ")
    return f"'{s}'"

def main():
    conn = pymysql.connect(**DB)
    cur = conn.cursor(pymysql.cursors.DictCursor)
    cur.execute(f"SELECT {', '.join(POI_COLUMNS)} FROM pois WHERE id BETWEEN 6201 AND 6293 ORDER BY id")
    pois = cur.fetchall()
    conn.close()
    if not pois:
        print("未找到补充POI数据"); sys.exit(1)
    poi_col_sql = ", ".join(f"`{c}`" for c in POI_COLUMNS)
    lines = [
        "-- ============================================================",
        "-- 猜地图 map 项目：天津/台湾/香港/澳门补充POI导入（线上执行）",
        "-- 生成日期: 2026-08-14",
        f"-- pois {len(pois)} 条（天津10+台湾30+香港25+澳门28）",
        "-- 幂等脚本，可重复执行",
        "-- 全部 area_review=1（待核定）",
        "-- ============================================================",
        "", "SET NAMES utf8mb4;", "START TRANSACTION;", "",
        "DELETE FROM `pois` WHERE `id` BETWEEN 6201 AND 6293;", "",
        f"INSERT INTO `pois` ({poi_col_sql}) VALUES",
        ",\n".join("(" + ", ".join(esc(r[c]) for c in POI_COLUMNS) + ")" for r in pois) + ";",
        "", "COMMIT;", "",
        f"-- 校验：应为 {len(pois)}",
        "SELECT COUNT(*) FROM `pois` WHERE `id` BETWEEN 6201 AND 6293;",
        "",
        "-- 校验各省区POI总数(应全部>=30)",
        "SELECT LEFT(adcode,2) as province, COUNT(*) FROM `pois` WHERE LEFT(adcode,2) IN ('12','71','81','82') GROUP BY LEFT(adcode,2);",
        "",
    ]
    output = os.path.join(os.path.dirname(os.path.abspath(__file__)), "region_supplement_online.sql")
    with open(output, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"已生成: {output}")
    print(f"pois {len(pois)} 条")
    missing = [r["id"] for r in pois if not r["cover_url"]]
    if missing: print(f"警告: 无封面 POI: {missing}")
    else: print("全部有封面 ✓")

if __name__ == "__main__":
    main()
