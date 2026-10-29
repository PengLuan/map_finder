#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
POI 封面补齐 worker：去网上检索真实照片（高德 place/text）并上传 OSS

处理 cover_url 为 NULL 或 trae-api 生成链接（不可用）的 POI：
  1. 高德 place/text (extensions=all) 按名称+adcode 检索真实照片
  2. 下载并校验图片格式（JPEG/PNG 魔数 + 最小体积）
  3. 上传 OSS covers/{id}.jpg
  4. 更新本地库 cover_url

用法：python3 scripts/fill_covers_worker.py --partition 0 --partition-total 30
"""
import argparse
import hashlib
import os
import random
import re
import time

import oss2
import pymysql
import requests

AMAP_KEY = os.environ.get("AMAP_WEB_KEY", "")

# ===== OSS 配置（与 upload_covers_to_oss.py 一致） =====
OSS_ACCESS_KEY_ID = os.environ.get("OSS_ACCESS_KEY_ID", "")
OSS_ACCESS_KEY_SECRET = os.environ.get("OSS_ACCESS_KEY_SECRET", "")
OSS_ENDPOINT = "https://oss-cn-beijing.aliyuncs.com"
OSS_BUCKET_NAME = "map-find"
OSS_PUBLIC_URL = f"https://{OSS_BUCKET_NAME}.oss-cn-beijing.aliyuncs.com"


def md5_partition(name, total):
    return int(hashlib.md5(name.encode("utf-8")).hexdigest(), 16) % total


def _query_amap(name, city):
    r = requests.get(
        "https://restapi.amap.com/v3/place/text",
        params={"key": AMAP_KEY, "keywords": name, "city": city,
                "extensions": "all", "output": "JSON"},
        timeout=15).json()
    if r.get("status") != "1":
        return None  # 限流/异常
    urls = []
    for poi in r.get("pois", []):
        for ph in (poi.get("photos") or []):
            u = ph.get("url")
            if u:
                u = u.replace("http://", "https://")
                if u not in urls:
                    urls.append(u)
    return urls


def fetch_amap_photos(name, adcode, max_retry=4):
    """高德检索真实照片，返回候选 https URL 列表（含 QPS 限流退避重试）"""
    for attempt in range(max_retry):
        try:
            urls = _query_amap(name, adcode or "")
            if urls is None:
                time.sleep(1.5 * (attempt + 1) + random.random())
                continue
            if not urls and adcode:
                # city 限制过严（偏远地区 adcode 可能不匹配），去掉 city 重试
                urls2 = _query_amap(name, "")
                if urls2:
                    urls = urls2
            return urls or []
        except Exception:
            time.sleep(1 + attempt)
    return []


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9",
}


def _clean(url: str) -> str:
    return url.replace("\\/", "/").replace("\\u0026", "&")


def search_bing(query: str) -> list:
    """必应图片搜索兜底，返回原图 URL 列表"""
    try:
        resp = requests.get(
            "https://www.bing.com/images/async",
            params={
                "q": query, "first": 0, "count": 35, "relp": 35,
                "qft": "+filterui:imagesize-large", "SFX": "2",
            },
            headers=HEADERS, timeout=12,
        )
        urls = re.findall(r'"murl":"(http[^"]+)"', resp.text)
        return [_clean(u) for u in urls]
    except Exception:
        return []


def search_baidu(query: str) -> list:
    """百度图片搜索兜底，返回大图 URL 列表"""
    try:
        resp = requests.get(
            "https://image.baidu.com/search/acjson",
            params={
                "tn": "resultjson_com", "ipn": "rj", "fp": "result",
                "word": query, "pn": 0, "rn": 30,
            },
            headers=HEADERS, timeout=12,
        )
        text = resp.text
        urls = re.findall(r'"hoverURL":"(http[^"]+)"', text)
        urls += re.findall(r'"middleURL":"(http[^"]+)"', text)
        return [_clean(u) for u in urls]
    except Exception:
        return []


def fetch_web_photos(name):
    """高德无照片时用网页图片搜索兜底"""
    urls = search_bing(f"{name} 风景")
    if len(urls) < 3:
        urls += search_baidu(name)
    return urls


def download_best(urls):
    """依次尝试候选图片，返回 (data, ext)：优先取大于 15KB 的第一张，否则取最大的有效图"""
    best = None
    for u in urls[:8]:
        try:
            img = requests.get(u, timeout=20)
            data = img.content
            is_jpg = data[:3] == b"\xff\xd8\xff"
            is_png = data[:8] == b"\x89PNG\r\n\x1a\n"
            if img.status_code != 200 or len(data) <= 2000 or not (is_jpg or is_png):
                continue
            if len(data) > 15000:
                return data, ("jpg" if is_jpg else "png")
            if best is None or len(data) > len(best[0]):
                best = (data, "jpg" if is_jpg else "png")
        except Exception:
            continue
    return best if best else (None, None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--partition", type=int, required=True)
    ap.add_argument("--partition-total", type=int, required=True)
    args = ap.parse_args()

    conn = pymysql.connect(host="localhost", port=3306, user="root", password="123456",
                           database="map_game", charset="utf8mb4")
    cur = conn.cursor()
    cur.execute("SELECT id, name, adcode, category FROM pois "
                "WHERE cover_url IS NULL OR cover_url LIKE '%trae-api%' ORDER BY id")
    rows = [r for r in cur.fetchall()
            if md5_partition(r[1], args.partition_total) == args.partition]
    total = len(rows)
    print(f"[P{args.partition}] 待处理 {total}", flush=True)

    auth = oss2.Auth(OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET)
    bucket = oss2.Bucket(auth, OSS_ENDPOINT, OSS_BUCKET_NAME)

    ok = fail = 0
    for i, (pid, name, adcode, category) in enumerate(rows):
        urls = fetch_amap_photos(name, adcode)
        if not urls:
            urls = fetch_web_photos(name)  # 高德无照片时走网页图片搜索
        new_url = None
        data, ext = download_best(urls)
        if data:
            try:
                oss_key = f"covers/{pid}.{ext}"
                bucket.put_object(oss_key, data, headers={
                    "Content-Type": "image/jpeg" if ext == "jpg" else "image/png"})
                new_url = f"{OSS_PUBLIC_URL}/{oss_key}"
            except Exception:
                new_url = None
        if new_url:
            cur.execute("UPDATE pois SET cover_url=%s WHERE id=%s", (new_url, pid))
            conn.commit()
            ok += 1
        else:
            fail += 1
        if (i + 1) % 5 == 0 or i + 1 == total:
            print(f"PROGRESS {i + 1}/{total} ok={ok} fail={fail}", flush=True)

    print(f"[P{args.partition}] 完成: ok={ok} fail={fail} total={total}", flush=True)
    conn.close()


if __name__ == "__main__":
    main()
