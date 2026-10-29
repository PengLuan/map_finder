#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
主题种子收集 Worker：按分区并行处理

每个 worker 负责 hash(name) % partition_total == partition 的种子。
流程：查重 → 高德 POI 搜索取坐标 → GCJ-02→WGS84 → 生成封面图 → 入库

用法（由 run_theme_collect.py 自动调用）：
    python collect_theme_worker.py --partition 0 --partition-total 30
    python collect_theme_worker.py --partition 0 --partition-total 30 --categories university_211,scenic_5a
"""
import argparse
import hashlib
import math
import os
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pymysql
import requests

from scripts.theme_seeds_data import THEME_SEEDS, THEME_META

# ---- 配置 ----
AMAP_KEY = os.environ.get("AMAP_WEB_KEY", "")
AMAP_PLACE_URL = "https://restapi.amap.com/v3/place/text"
REQUEST_INTERVAL = 0.2  # 秒，避免触发 QPS 限制
MAX_RETRY = 2

# 数据库配置
DB_CONFIG = {
    "host": os.environ.get("MYSQL_HOST", "localhost"),
    "port": int(os.environ.get("MYSQL_PORT", "3306")),
    "user": os.environ.get("MYSQL_USER", "root"),
    "password": os.environ.get("MYSQL_PASSWORD", "123456"),
    "database": os.environ.get("MYSQL_DATABASE", "map_game"),
    "charset": "utf8mb4",
}

_key_checked = False


def _check_api_key():
    """启动时验证 API Key 是否为 Web 服务类型"""
    global _key_checked
    if _key_checked:
        return
    _key_checked = True
    try:
        resp = requests.get(AMAP_PLACE_URL, params={
            "key": AMAP_KEY, "keywords": "故宫", "offset": 1, "page": 1,
            "extensions": "base", "output": "json",
        }, timeout=10)
        data = resp.json()
        if data.get("status") != "1":
            err = data.get("info", "未知错误")
            print(f"❌ 高德 API Key 验证失败: {err}", file=sys.stderr)
            print(f"   当前 Key: {AMAP_KEY[:8]}...", file=sys.stderr)
            if "PLAT_NOMATCH" in err or "USERKEY" in err:
                print(f"   原因: Key 类型不匹配，需要「Web服务」类型的 Key", file=sys.stderr)
                print(f"   解决: https://console.amap.com/dev/key/app 创建 Web服务 Key", file=sys.stderr)
                print(f"   然后: export AMAP_WEB_KEY=你的新Key", file=sys.stderr)
                sys.exit(1)
    except Exception:
        pass  # 网络问题不阻断，后续重试


# ===== GCJ-02 → WGS84 坐标转换 =====

_PI = 3.1415926535897932384626
_A = 6378245.0
_EE = 0.00669342162296594323


def _transform_lat(lng, lat):
    ret = -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * abs(lng) ** 0.5
    ret += (20.0 * math.sin(6.0 * lng * _PI) + 20.0 * math.sin(2.0 * lng * _PI)) * 2.0 / 3.0
    ret += (20.0 * math.sin(lat * _PI) + 40.0 * math.sin(lat / 3.0 * _PI)) * 2.0 / 3.0
    ret += (160.0 * math.sin(lat / 12.0 * _PI) + 320 * math.sin(lat * _PI / 30.0)) * 2.0 / 3.0
    return ret


def _transform_lng(lng, lat):
    ret = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * abs(lng) ** 0.5
    ret += (20.0 * math.sin(6.0 * lng * _PI) + 20.0 * math.sin(2.0 * lng * _PI)) * 2.0 / 3.0
    ret += (20.0 * math.sin(lng * _PI) + 40.0 * math.sin(lng / 3.0 * _PI)) * 2.0 / 3.0
    ret += (150.0 * math.sin(lng / 12.0 * _PI) + 300.0 * math.sin(lng / 30.0 * _PI)) * 2.0 / 3.0
    return ret


def gcj02_to_wgs84(lng, lat):
    """GCJ-02(火星坐标) → WGS-84(GPS坐标)"""
    dlat = _transform_lat(lng - 105.0, lat - 35.0)
    dlng = _transform_lng(lng - 105.0, lat - 35.0)
    radlat = lat / 180.0 * _PI
    magic = math.sin(radlat)
    magic = 1 - _EE * magic * magic
    sqrtmagic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((_A * (1 - _EE)) / (magic * sqrtmagic) * _PI)
    dlng = (dlng * 180.0) / (_A / sqrtmagic * math.cos(radlat) * _PI)
    mglat = lat + dlat
    mglng = lng + dlng
    return (lng * 2 - mglng, lat * 2 - mglat)


# ===== 封面图 URL 生成 =====

def make_cover_url(name):
    """生成地标专属航拍图 URL（text_to_image API）"""
    prompt = f"aerial landscape photograph of {name} in China, famous landmark, photorealistic, golden hour light, high detail"
    encoded = urllib.parse.quote(prompt)
    return f"https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt={encoded}&image_size=landscape_16_9"


# ===== 高德 POI 搜索 =====

def search_poi(name):
    """搜索 POI，返回第一个匹配结果"""
    params = {
        "key": AMAP_KEY,
        "keywords": name,
        "offset": 1,
        "page": 1,
        "extensions": "all",
        "output": "json",
    }
    for attempt in range(MAX_RETRY + 1):
        try:
            resp = requests.get(AMAP_PLACE_URL, params=params, timeout=10)
            data = resp.json()
            if data.get("status") == "1" and data.get("pois"):
                return data["pois"][0]
            if attempt < MAX_RETRY:
                time.sleep(1)
        except Exception:
            if attempt < MAX_RETRY:
                time.sleep(1)
    return None


def geocode_to_poi(name, category):
    """搜索 POI 并转换为入库数据"""
    poi_data = search_poi(name)
    if not poi_data:
        return None

    location = poi_data.get("location", "")
    if "," not in location:
        return None

    try:
        gcj_lng, gcj_lat = location.split(",")
        gcj_lng, gcj_lat = float(gcj_lng), float(gcj_lat)
    except ValueError:
        return None

    # 中国范围校验
    if not (73.0 <= gcj_lng <= 136.0 and 3.0 <= gcj_lat <= 54.0):
        return None

    # GCJ-02 → WGS84
    wgs_lng, wgs_lat = gcj02_to_wgs84(gcj_lng, gcj_lat)

    adcode = poi_data.get("adcode", "")
    pname = poi_data.get("pname", "")
    cityname = poi_data.get("cityname", "")
    adname = poi_data.get("adname", "")

    # 构建地址
    addr_parts = [p for p in [pname, cityname, adname] if p]
    address = " ".join(addr_parts)

    # 构建 hint_text
    if pname and cityname and pname != cityname:
        hint_text = f"{pname} {cityname} 的 {name}"
    elif pname:
        hint_text = f"{pname} 的 {name}"
    elif cityname:
        hint_text = f"{cityname} 的 {name}"
    else:
        hint_text = name

    # 生成 summary
    meta = THEME_META.get(category, {})
    summary_template = meta.get("summary_template", "{address}的{name}")
    summary = summary_template.format(address=address, name=name)

    return {
        "name": name,
        "category": category,
        "lng": round(wgs_lng, 6),
        "lat": round(wgs_lat, 6),
        "adcode": adcode,
        "address": address,
        "summary": summary,
        "cover_url": make_cover_url(name),
        "hint_text": hint_text,
        "difficulty": meta.get("difficulty", 3),
        "source": meta.get("source", "manual"),
    }


# ===== 分区逻辑 =====

def get_partition_items(partition, partition_total, categories=None):
    """获取属于当前分区的 (name, category) 列表"""
    cats = categories or list(THEME_SEEDS.keys())
    items = []
    for cat in cats:
        if cat not in THEME_SEEDS:
            continue
        for name in THEME_SEEDS[cat]:
            h = int(hashlib.md5(name.encode()).hexdigest(), 16)
            if h % partition_total == partition:
                items.append((name, cat))
    return items


# ===== 数据库操作（raw SQL） =====

def check_exists(conn, name, category):
    """检查 POI 是否已存在"""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM pois WHERE name = %s AND category = %s LIMIT 1",
            (name, category),
        )
        return cur.fetchone() is not None


def insert_poi(conn, data):
    """插入 POI"""
    sql = """INSERT INTO pois (name, category, lng, lat, adcode, address, summary,
             cover_url, hint_text, difficulty, source, used_count)
             VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"""
    with conn.cursor() as cur:
        cur.execute(sql, (
            data["name"], data["category"], data["lng"], data["lat"],
            data["adcode"], data["address"], data["summary"],
            data["cover_url"], data["hint_text"], data["difficulty"], data["source"],
            0,
        ))
    conn.commit()


# ===== 主逻辑 =====

def run(partition, partition_total, categories=None):
    _check_api_key()
    items = get_partition_items(partition, partition_total, categories)
    total = len(items)

    if total == 0:
        print("PROGRESS 0/0")
        return

    print(f"分区 {partition}/{partition_total}: 共 {total} 条待处理", file=sys.stderr)

    conn = pymysql.connect(**DB_CONFIG)
    inserted = 0
    skipped = 0
    failed = 0

    try:
        for i, (name, cat) in enumerate(items, 1):
            # 查重
            if check_exists(conn, name, cat):
                skipped += 1
                print(f"PROGRESS {i}/{total}")
                continue

            # geocode
            poi_data = geocode_to_poi(name, cat)
            if not poi_data:
                failed += 1
                print(f"  ✗ {name} (geocode 失败)", file=sys.stderr)
                print(f"PROGRESS {i}/{total}")
                continue

            # 入库
            try:
                insert_poi(conn, poi_data)
                inserted += 1
                print(f"  ✓ {name} → ({poi_data['lng']}, {poi_data['lat']})", file=sys.stderr)
            except Exception as e:
                failed += 1
                print(f"  ✗ {name} (入库失败: {e})", file=sys.stderr)

            print(f"PROGRESS {i}/{total}")
            time.sleep(REQUEST_INTERVAL)

    finally:
        conn.close()

    print(f"SKIP {skipped}/{total}")
    print(f"分区 {partition} 完成: 新增 {inserted}, 跳过 {skipped}, 失败 {failed}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="主题种子收集 Worker")
    parser.add_argument("--partition", type=int, required=True, help="分区号（0-based）")
    parser.add_argument("--partition-total", type=int, required=True, help="总分区数")
    parser.add_argument("--categories", type=str, default=None,
                        help="只处理指定主题（逗号分隔），默认全部")
    args = parser.parse_args()

    cats = args.categories.split(",") if args.categories else None
    run(args.partition, args.partition_total, cats)


if __name__ == "__main__":
    main()
