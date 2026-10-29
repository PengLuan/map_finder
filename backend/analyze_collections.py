# -*- coding: utf-8 -*-
"""专题难度评定分析脚本 — 生成文档供人工审核"""
import json
import math

import pymysql

conn = pymysql.connect(
    host="localhost", port=3306, user="root", password="123456",
    database="map_game", charset="utf8mb4",
)
cur = conn.cursor()

# 1. 专题列表
cur.execute(
    "SELECT id, code, name, geometry, difficulty_star, sort_order, enabled "
    "FROM collections ORDER BY sort_order, id"
)
cols = [d[0] for d in cur.description]
collections = [dict(zip(cols, r)) for r in cur.fetchall()]

# 2. POI 数量与经纬度
def haversine_km(lat1, lng1, lat2, lng2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))

for c in collections:
    cur.execute(
        "SELECT p.lat, p.lng, p.name FROM pois p JOIN collection_pois cp ON cp.poi_id=p.id "
        "WHERE cp.collection_id=%s AND p.lat IS NOT NULL AND p.lng IS NOT NULL",
        (c["id"],),
    )
    pts = cur.fetchall()
    c["poi_coords"] = [(p[0], p[1], p[2]) for p in pts]
    if pts:
        lats = [p[0] for p in pts]
        lngs = [p[1] for p in pts]
        c["poi_count"] = len(pts)
        c["lat_range"] = max(lats) - min(lats)
        c["lng_range"] = max(lngs) - min(lngs)
        c["diag_km"] = round(haversine_km(min(lats), min(lngs), max(lats), max(lngs)))
    else:
        c["poi_count"] = 0
        c["lat_range"] = 0
        c["lng_range"] = 0
        c["diag_km"] = 0

conn.close()

# ===== 难度评定逻辑 =====
# 评分维度：poi_count（POI数量）、diag_km（地域跨度）、fame（知名度）
# 1 star: 3-4 POI, <500km, 常识类
# 2 star: 4-5 POI, 500-1000km, 常识类
# 3 star: 4-5 POI, 1000-2000km 或 6 POI 小范围
# 4 star: 5-6 POI, 大范围, 或 4 POI 超大范围(>2000km)
# 5 star: 6-7 POI, 大范围, 专业类
# 6 star: 7-8 POI, 大范围
# 7 star: 8 POI, 超大范围
# 8 star: 8 POI, 超大范围, 跨学科/抽象

# 知名度分级：1=大众常识（人人皆知，容易），2=有一定了解，3=冷门专业（难）
def fame_level(code: str) -> int:
    name = code
    # 大众常识类（-1 星）
    common = {
        "wuyue",  # 五岳
        "buddha_mountain",  # 四大佛教名山
        "taoist_mountain",  # 四大道教名山
        "famous_waterfall",  # 四大名瀑
        "freshwater_lake",  # 五大淡水湖
        "inland_lake",  # 七大内陆湖
        "yangtze_gorge",  # 长江三峡
        "yellow_river",  # 黄河九曲
        "jiangnan_tower",  # 江南三大名楼
        "four_great_tower",  # 四大名楼
        "six_ancient_capital",  # 六大古都
        "four_ancient_city",  # 四大古城
        "national_center_city",  # 国家中心城市
        "imperial_palace",  # 皇家宫殿
        "great_wall_pass",  # 长城关隘
        "eight_cuisine",  # 八大菜系
        "suzhou_garden",  # 苏州园林
        "red_city",  # 红色城市
        "revolution_holy_land",  # 革命圣地
        "yangtze_bridge",  # 长江大桥
        "three_major_campaigns",  # 三大战役
        "wuzhen",  # 五镇名山
    }
    # 冷门专业类（+1 星）
    obscure = {
        "geodetic_origin",  # 大地原点
        "north_south_divide",  # 南北分界线
        "geo_extreme",  # 经纬度四极
        "altitude_extreme",  # 海拔极值
        "time_zone_boundary",  # 时区分界
        "ancient_observatory",  # 古观象台
        "intl_rail_port",  # 国际铁路口岸
        "mountain_tunnel",  # 山岭隧道
        "aviation_hub",  # 民航枢纽
        "hsr_network",  # 高铁
        "cross_sea_bridge",  # 跨海大桥
        "modern_engineering",  # 现代工程
        "aviation_hub",  # 民航
    }
    if code in common:
        return 1
    if code in obscure:
        return 3
    return 2


def suggest_star(c):
    n = c["poi_count"]
    d = c["diag_km"]
    code = c["code"]
    fame = fame_level(code)

    # 先算基础星
    if n <= 3:
        base = 1
    elif n == 4:
        base = 2
    elif n == 5:
        base = 3
    elif n == 6:
        base = 4
    elif n == 7:
        base = 5
    else:  # >= 8
        base = 6

    # 地域跨度加成
    if d > 3000:
        base += 2
    elif d > 2000:
        base += 1
    elif d > 1500:
        base += 0
    elif d > 500:
        base -= 0
    else:
        base -= 1  # 小范围减一星

    # 知名度调整：大众-1，冷门+1
    if fame == 1:
        base -= 1
    elif fame == 3:
        base += 1

    # ★ 图案类专题（趣味性，难度适中偏上）
    star_patterns = {"heart_of_china", "five_point_star", "bagua_directions", "china_heart"}
    if code in star_patterns:
        if n <= 5:
            base = 5
        elif n <= 6:
            base = 6
        elif n <= 7:
            base = 7
        else:
            base = 8

    # 抽象概念类最低 3 星
    abstract_codes = {
        "geodetic_origin", "north_south_divide", "geo_extreme",
        "altitude_extreme", "time_zone_boundary", "ancient_observatory",
    }
    if code in abstract_codes:
        base = max(base, 3)

    # 限制在 1-8 星
    return max(1, min(8, base))


# 生成建议
for c in collections:
    c["suggest_star"] = suggest_star(c)

# 输出文档
lines = []
lines.append("# 专题难度评定建议")
lines.append("")
lines.append("## 评定维度")
lines.append("")
lines.append("| 维度 | 说明 |")
lines.append("|------|------|")
lines.append("| **POI 数量** | 点位越多，需要记住/定位的地点越多，难度越高 |")
lines.append("| **地域跨度** | 点位分布越广，需要了解的地理范围越大，难度越高 |")
lines.append("| **知名度** | 大众熟知的名胜（五岳、古都等）下调难度；冷门专业知识（大地原点、时区分界等）上调难度 |")
lines.append("")
lines.append("## 难度分级（1-8 星）")
lines.append("")
lines.append("| 星级 | 说明 | 解锁条件 |")
lines.append("|------|------|----------|")
lines.append("| ★1 | 入门：3-4 POI，小范围，大众常识 | 默认开放 |")
lines.append("| ★2 | 简单：4-5 POI，中等范围，大众常识 | 完成 2 个★1 专题 |")
lines.append("| ★3 | 普通：4-5 POI，大范围 或 6 POI 小范围 | 完成 3 个★2 专题 |")
lines.append("| ★4 | 中等：5-6 POI，大范围 或 冷门专业 | 完成 3 个★3 专题 |")
lines.append("| ★5 | 较难：6-7 POI，大范围 或 冷门专业 | 完成 4 个★4 专题 |")
lines.append("| ★6 | 困难：7-8 POI，大范围 | 完成 4 个★5 专题 |")
lines.append("| ★7 | 极难：8 POI，超大范围 | 完成 5 个★6 专题 |")
lines.append("| ★8 | 挑战：8 POI，超大范围，跨学科/抽象 | 完成 5 个★7 专题 |")
lines.append("")
lines.append("> 知名度定义：大众常识（五岳、古都、名楼等，几乎人人皆知）→ -1 星；有一定了解（四大名山等）→ 不变；冷门专业（大地原点、时区分界、国际铁路口岸等）→ +1 星。")
lines.append("")
lines.append("## 各专题评定明细")
lines.append("")
lines.append("| 当前星级 | 建议星级 | 变动 | 专题名称 | POI 数 | 地域跨度(km) | 知名度 | 评定理由 |")
lines.append("|---------|---------|------|---------|-------|-------------|--------|---------|")

current_stars = {}
suggest_stars = {}
for c in collections:
    cur_s = c["difficulty_star"]
    sug_s = c["suggest_star"]
    delta = sug_s - cur_s
    delta_str = f"+{delta}" if delta > 0 else str(delta) if delta < 0 else "="
    name = c["name"]
    n = c["poi_count"]
    d = c["diag_km"]

    # 理由
    reasons = []
    if n <= 3:
        reasons.append(f"仅 {n} 个 POI，数量少")
    elif n <= 5:
        reasons.append(f"{n} 个 POI，数量适中")
    elif n <= 6:
        reasons.append(f"{n} 个 POI，偏多")
    else:
        reasons.append(f"{n} 个 POI，数量多")

    if d < 100:
        reasons.append("分布极集中")
    elif d < 500:
        reasons.append("分布集中")
    elif d < 1000:
        reasons.append(f"跨度 {d}km，范围中等")
    elif d < 2000:
        reasons.append(f"跨度 {d}km，范围较大")
    elif d < 3000:
        reasons.append(f"跨度 {d}km，范围大")
    else:
        reasons.append(f"跨度 {d}km，范围极大")

    # 知识门槛
    code = c["code"]
    f = fame_level(code)
    if f == 1:
        fame_str = "大众常识"
        reasons.append("知名度高，大众熟知")
    elif f == 3:
        fame_str = "冷门专业"
        reasons.append("知名度低，属冷门知识")
    else:
        fame_str = "有一定了解"
        reasons.append("知名度中等")

    reason = "；".join(reasons)

    lines.append(f"| ★{cur_s} | ★{sug_s} | {delta_str} | {name} | {n} | {d} | {fame_str} | {reason} |")

    current_stars.setdefault(cur_s, 0)
    current_stars[cur_s] += 1
    suggest_stars.setdefault(sug_s, 0)
    suggest_stars[sug_s] += 1

lines.append("")
lines.append("## 星级分布对比")
lines.append("")
lines.append("| 星级 | 当前数量 | 建议数量 |")
lines.append("|------|---------|---------|")
for s in range(1, 9):
    cur_n = current_stars.get(s, 0)
    sug_n = suggest_stars.get(s, 0)
    lines.append(f"| ★{s} | {cur_n} | {sug_n} |")

lines.append("")
lines.append("---")
lines.append(f"共 {len(collections)} 个专题，生成时间自动。请人工审核后确认修改。")

doc = "\n".join(lines)
print(doc)

# 同时输出 JSON 格式便于后续批量更新
updates = [{"id": c["id"], "name": c["name"], "difficulty_star": c["suggest_star"]} for c in collections]
print("\n\n=== JSON 更新数据 ===")
print(json.dumps(updates, ensure_ascii=False, indent=2))