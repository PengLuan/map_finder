#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
导出主题种子 POI 为线上可执行 SQL（幂等：先删后插）

输出: scripts/theme_pois_online.sql
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pymysql

from scripts.theme_seeds_data import THEME_SEEDS

DB = dict(host="localhost", user="root", password="123456",
          database="map_game", charset="utf8mb4")

CATEGORIES = list(THEME_SEEDS.keys())

# 必须带显式 id：cover_url 的 OSS key 为 covers/{id}.jpg，
# 线上 ID 与本地一致才能正确对应图片
COLUMNS = ["id", "name", "category", "lng", "lat", "adcode", "address", "summary",
           "cover_url", "hint_text", "difficulty", "source", "used_count"]


def esc(v):
    """SQL 字符串转义"""
    if v is None:
        return "NULL"
    s = str(v)
    s = s.replace("\\", "\\\\").replace("'", "''").replace("\n", " ")
    return f"'{s}'"


def main():
    conn = pymysql.connect(**DB)
    cur = conn.cursor(pymysql.cursors.DictCursor)

    placeholders = ",".join(["%s"] * len(CATEGORIES))
    cur.execute(
        f"SELECT {', '.join(COLUMNS)} FROM pois "
        f"WHERE category IN ({placeholders}) ORDER BY category, id",
        tuple(CATEGORIES))
    rows = cur.fetchall()
    conn.close()

    cat_list_sql = ", ".join(esc(c) for c in CATEGORIES)
    col_sql = ", ".join(f"`{c}`" for c in COLUMNS)

    lines = []
    lines.append("-- ============================================================")
    lines.append("-- 猜地图 map 项目：主题种子 POI 导入（线上执行）")
    lines.append("-- 生成日期: 2026-08-10")
    lines.append(f"-- 共 {len(rows)} 条，覆盖 {len(CATEGORIES)} 个主题")
    lines.append("-- 说明: 幂等脚本，先清理这 8 个主题再重新插入，可重复执行")
    lines.append("-- 依赖: pois 表需已含 source 字段（见 seed_pois.sql 的 DDL 部分）")
    lines.append("-- ============================================================")
    lines.append("")
    lines.append("SET NAMES utf8mb4;")
    lines.append("START TRANSACTION;")
    lines.append("")
    lines.append(f"-- 清理既有主题数据（{len(CATEGORIES)} 个主题）")
    lines.append(f"DELETE FROM `pois` WHERE `category` IN ({cat_list_sql});")
    lines.append("")
    lines.append(f"-- 插入 {len(rows)} 条主题种子")

    # 批量 INSERT（每 100 行一个语句，避免超长）
    BATCH = 100
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        value_rows = []
        for r in chunk:
            vals = ", ".join(esc(r[c]) for c in COLUMNS)
            value_rows.append(f"({vals})")
        lines.append(f"INSERT INTO `pois` ({col_sql}) VALUES")
        lines.append(",\n".join(value_rows) + ";")
        lines.append("")

    lines.append("COMMIT;")
    lines.append("")
    lines.append("-- 校验：应等于 " + str(len(rows)))
    lines.append(f"SELECT category, COUNT(*) FROM `pois` WHERE `category` IN ({cat_list_sql}) GROUP BY category;")
    lines.append("")

    output = "/Users/luanpeng/Desktop/allData/code/zhizhang/map/backend/scripts/theme_pois_online.sql"
    with open(output, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"已生成: {output}")
    print(f"共 {len(rows)} 条")
    # 统计各主题
    from collections import Counter
    cnt = Counter(r["category"] for r in rows)
    for c in CATEGORIES:
        print(f"  {c}: {cnt[c]}")


if __name__ == "__main__":
    main()
