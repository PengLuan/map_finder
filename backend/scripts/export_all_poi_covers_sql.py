#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
导出全量 POI 封面 UPDATE SQL（按 ID 更新 cover_url）

从本地 DB 读取所有 POI 的 cover_url，生成幂等 UPDATE 语句。
输出: scripts/update_all_poi_covers.sql
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pymysql

DB = dict(host="localhost", user="root", password="123456",
          database="map_game", charset="utf8mb4")


def esc(v):
    if v is None:
        return "NULL"
    s = str(v)
    s = s.replace("\\", "\\\\").replace("'", "''")
    return f"'{s}'"


def main():
    conn = pymysql.connect(**DB)
    cur = conn.cursor()
    cur.execute("SELECT id, name, cover_url FROM pois ORDER BY id")
    rows = cur.fetchall()
    conn.close()

    lines = []
    lines.append("-- ============================================================")
    lines.append("-- 猜地图 map 项目：全量 POI 封面 cover_url 更新（线上执行）")
    lines.append(f"-- 生成日期: 2026-08-14")
    lines.append(f"-- 共 {len(rows)} 条 UPDATE 语句，幂等可重复执行")
    lines.append("-- 说明: 按 POI ID 更新 cover_url 为 OSS 地址")
    lines.append("-- ============================================================")
    lines.append("")
    lines.append("SET NAMES utf8mb4;")
    lines.append("START TRANSACTION;")
    lines.append("")

    has_cover = 0
    no_cover = []
    for r in rows:
        pid, name, cover_url = r
        if cover_url and cover_url.startswith("https://map-find.oss"):
            lines.append(f"UPDATE `pois` SET `cover_url` = {esc(cover_url)} WHERE `id` = {pid};")
            has_cover += 1
        else:
            no_cover.append((pid, name))

    lines.append("")
    lines.append("COMMIT;")
    lines.append("")

    output = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "update_all_poi_covers.sql")
    with open(output, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"已生成: {output}")
    print(f"有封面 UPDATE: {has_cover} 条")
    if no_cover:
        print(f"无封面 POI: {len(no_cover)} 条")
        for pid, name in no_cover:
            print(f"  {pid} | {name}")
    else:
        print("所有 POI 均有封面")


if __name__ == "__main__":
    main()
