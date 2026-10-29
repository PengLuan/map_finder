#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
统计线上 POI 不足 30 个的主题和省级行政单位。
用法:
  1. 本地: python -m scripts.audit_poi_coverage
  2. 线上: python -m scripts.audit_poi_coverage --host <IP> -u <user> -p <password> -d <db>
"""
import argparse, sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pymysql

# 省级行政单位 adcode 前两位映射
PROVINCE_CODES = {
    "11": "北京", "12": "天津", "13": "河北", "14": "山西", "15": "内蒙古",
    "21": "辽宁", "22": "吉林", "23": "黑龙江", "31": "上海", "32": "江苏",
    "33": "浙江", "34": "安徽", "35": "福建", "36": "江西", "37": "山东",
    "41": "河南", "42": "湖北", "43": "湖南", "44": "广东", "45": "广西",
    "46": "海南", "50": "重庆", "51": "四川", "52": "贵州", "53": "云南",
    "54": "西藏", "61": "陕西", "62": "甘肃", "63": "青海", "64": "宁夏",
    "65": "新疆", "71": "台湾", "81": "香港", "82": "澳门",
}

THRESHOLD = 30


def main():
    parser = argparse.ArgumentParser(description="审计 POI 覆盖率")
    parser.add_argument("--host", default="localhost")
    parser.add_argument("-P", "--port", type=int, default=3306)
    parser.add_argument("-u", "--user", default="root")
    parser.add_argument("-p", "--password", default="123456")
    parser.add_argument("-d", "--database", default="map_game")
    parser.add_argument("--threshold", type=int, default=THRESHOLD)
    args = parser.parse_args()

    conn = pymysql.connect(
        host=args.host, port=args.port, user=args.user,
        password=args.password, database=args.database, charset="utf8mb4",
    )
    cur = conn.cursor()

    print(f"{'=' * 70}")
    print(f"  POI 覆盖率审计  (不足 {args.threshold} 个的项)")
    print(f"{'=' * 70}\n")

    # ── 1. 按主题统计 ──
    print("【按主题统计】")
    print(f"{'主题code':<22} {'主题名':<14} {'POI数':>6}  状态")
    print("-" * 60)
    cur.execute("""
        SELECT t.code, t.name, t.enabled, COUNT(p.id) as cnt
        FROM poi_themes t
        LEFT JOIN pois p ON p.category = t.code
        GROUP BY t.code, t.name, t.enabled
        ORDER BY t.sort_order
    """)
    theme_low = []
    for code, name, enabled, cnt in cur.fetchall():
        flag = ""
        if cnt < args.threshold:
            flag = f"← 不足{args.threshold}"
            theme_low.append((code, name, cnt, enabled))
        print(f"  {code:<20} {(name or '')[:12]:<12} {cnt:>6}  {'✓' if enabled else '✗'} {flag}")

    total_themes = cur.rowcount
    print(f"\n  主题总数: {total_themes}, 不足{args.threshold}的: {len(theme_low)}")

    # ── 2. 按省级行政单位统计 ──
    print(f"\n{'=' * 70}")
    print("【按省级行政单位统计】")
    print(f"{'adcode':>8} {'省份':<8} {'POI数':>6}  状态")
    print("-" * 40)
    province_low = []
    for code_prefix, prov_name in sorted(PROVINCE_CODES.items()):
        cur.execute(
            "SELECT COUNT(*) FROM pois WHERE adcode LIKE %s", (f"{code_prefix}%",)
        )
        cnt = cur.fetchone()[0]
        flag = ""
        if cnt < args.threshold:
            flag = f"← 不足{args.threshold}"
            province_low.append((code_prefix, prov_name, cnt))
        print(f"  {code_prefix:>4}xx  {prov_name:<6} {cnt:>6}  {flag}")

    # 无 adcode 的 POI（境外等）
    cur.execute("SELECT COUNT(*) FROM pois WHERE adcode IS NULL OR adcode = ''")
    no_adcode = cur.fetchone()[0]
    if no_adcode:
        print(f"  无adcode            {no_adcode:>6}  (主题模式可用, 分省模式不可用)")

    print(f"\n  省份总数: {len(PROVINCE_CODES)}, 不足{args.threshold}的: {len(province_low)}")

    # ── 3. 汇总 ──
    print(f"\n{'=' * 70}")
    print("【汇总：需要补充的项】")
    print(f"{'=' * 70}\n")

    if theme_low:
        print("⚠ 主题不足30:")
        for code, name, cnt, enabled in theme_low:
            print(f"  {code} ({name}): {cnt} 条, 需补 {args.threshold - cnt} 条")
        print()

    if province_low:
        print("⚠ 省份不足30:")
        for code_prefix, prov_name, cnt in province_low:
            print(f"  {prov_name} (adcode {code_prefix}): {cnt} 条, 需补 {args.threshold - cnt} 条")
        print()

    if not theme_low and not province_low:
        print("✓ 全部达标！所有主题和省份的 POI 数均 ≥30")

    # ── 4. 按省份×主题交叉统计（不足30的格子）──
    print(f"\n{'=' * 70}")
    print("【省份×主题 交叉：不足30的格子】")
    print(f"{'=' * 70}\n")
    cross_low = []
    for code_prefix, prov_name in sorted(PROVINCE_CODES.items()):
        cur.execute("""
            SELECT p.category, COUNT(*) as cnt
            FROM pois p
            WHERE p.adcode LIKE %s
            GROUP BY p.category
            ORDER BY cnt DESC
        """, (f"{code_prefix}%",))
        rows = cur.fetchall()
        for cat, cnt in rows:
            if cnt < args.threshold:
                cross_low.append((prov_name, code_prefix, cat, cnt))

    if cross_low:
        print(f"{'省份':<8} {'主题':<20} {'POI数':>6}  需补")
        print("-" * 50)
        for prov, cp, cat, cnt in cross_low:
            print(f"  {prov:<6} {cat:<18} {cnt:>6}  {args.threshold - cnt}")
    else:
        print("  ✓ 全部达标！")

    conn.close()
    print(f"\n{'=' * 70}")
    print("  审计完成")
    print(f"{'=' * 70}")


if __name__ == "__main__":
    main()
