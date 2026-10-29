#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
主题封面覆盖脚本：用高德检索的真实照片覆盖 OSS 同名 key covers/themes/{code}.jpg

OSS 对象被直接覆盖，cover_url 不变，因此无需任何 SQL 操作。

用法：
    cd backend
    python3 -m scripts.overwrite_theme_covers
"""
import os
import random
import time

import oss2
import pymysql
import requests

AMAP_KEY = os.environ.get("AMAP_WEB_KEY", "")

OSS_ACCESS_KEY_ID = os.environ.get("OSS_ACCESS_KEY_ID", "")
OSS_ACCESS_KEY_SECRET = os.environ.get("OSS_ACCESS_KEY_SECRET", "")
OSS_ENDPOINT = "https://oss-cn-beijing.aliyuncs.com"
OSS_BUCKET_NAME = "map-find"
OSS_PUBLIC_URL = f"https://{OSS_BUCKET_NAME}.oss-cn-beijing.aliyuncs.com"

# 每个主题的旗舰 POI 名称（用于检索高质量真实照片）
THEME_FLAGSHIP = {
    "university_211": "清华大学",
    "scenic_5a": "九寨沟风景区",
    "peak_famous": "黄山风景区",
    "lake_famous": "杭州西湖风景名胜区",
    "airport_major": "北京首都国际机场",
    "historic_city": "西安城墙",
    "museum_l1": "中国国家博物馆",
    "unesco_whs": "八达岭长城",
}


def fetch_amap_photo(name, max_retry=6):
    for attempt in range(max_retry):
        try:
            r = requests.get(
                "https://restapi.amap.com/v3/place/text",
                params={"key": AMAP_KEY, "keywords": name,
                        "extensions": "all", "output": "JSON"},
                timeout=15).json()
            if r.get("status") != "1":
                time.sleep(1.5 * (attempt + 1) + random.random())
                continue
            for poi in r.get("pois", []):
                photos = poi.get("photos") or []
                if photos and photos[0].get("url"):
                    return photos[0]["url"].replace("http://", "https://")
            return None
        except Exception:
            time.sleep(1 + attempt)
    return None


def main():
    auth = oss2.Auth(OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET)
    bucket = oss2.Bucket(auth, OSS_ENDPOINT, OSS_BUCKET_NAME)

    ok = fail = 0
    for code, name in THEME_FLAGSHIP.items():
        photo = fetch_amap_photo(name)
        if not photo:
            print(f"❌ {code} ({name}): 高德无照片", flush=True)
            fail += 1
            continue
        try:
            img = requests.get(photo, timeout=20)
            data = img.content
            is_jpg = data[:3] == b"\xff\xd8\xff"
            is_png = data[:8] == b"\x89PNG\r\n\x1a\n"
            if img.status_code != 200 or len(data) <= 5000 or not (is_jpg or is_png):
                print(f"❌ {code} ({name}): 图片下载无效", flush=True)
                fail += 1
                continue
            # 覆盖同 key：cover_url 不变，无需 SQL
            bucket.put_object(f"covers/themes/{code}.jpg", data,
                              headers={"Content-Type": "image/jpeg" if is_jpg else "image/png"})
            print(f"✅ {code} ({name}): 覆盖 {len(data)} 字节", flush=True)
            ok += 1
        except Exception as e:
            print(f"❌ {code} ({name}): {e}", flush=True)
            fail += 1
        time.sleep(0.3)

    print(f"\n完成: ok={ok} fail={fail}", flush=True)

    # 校验本地库 cover_url 仍指向该 key
    conn = pymysql.connect(host="localhost", user="root", password="123456",
                           database="map_game", charset="utf8mb4")
    cur = conn.cursor()
    cur.execute("SELECT code, cover_url FROM poi_themes ORDER BY id")
    for code, url in cur.fetchall():
        mark = "✓" if url and url.endswith(f"covers/themes/{code}.jpg") else "✗"
        print(f"  {mark} {code}: {url}")
    conn.close()


if __name__ == "__main__":
    main()
