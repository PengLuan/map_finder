#!/usr/bin/env python3
"""
POI 封面图爬虫

为数据库中每个 POI 爬取一张清晰的实景图片，保存到本地 static/covers/，
并更新 POI.cover_url，用于游戏结算（胜利 / 放弃）时展示。

图片源：必应图片搜索（大图）为主，百度图片搜索兜底。
下载后用 Pillow 校验有效性并按像素量评分，挑选最清晰的一张，
压缩到长边 1280px 存为 JPEG，避免外链失效 / 防盗链 / 加载慢。

用法:
  python -m scripts.crawl_images              # 只为缺少本地封面的 POI 爬取
  python -m scripts.crawl_images --force      # 全部重新爬取
  python -m scripts.crawl_images --limit 20   # 只处理前 20 个（测试用）
"""
import argparse
import io
import os
import re
import sys
import time

import requests
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models import POI

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9",
}

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COVER_DIR = os.path.join(BASE_DIR, "static", "covers")

MIN_BYTES = 15_000        # 过小的图（图标 / 缩略图）不要
MIN_SIDE = 360           # 最短边下限，过滤小图
MAX_SIDE = 1280          # 保存时长边上限，控制体积
GOOD_SCORE = 1000 * 700  # 达到该像素量即认为足够清晰，提前停止


def _clean(url: str) -> str:
    """还原 JSON 字符串中转义的斜杠和 &"""
    return url.replace("\\/", "/").replace("\\u0026", "&")


def search_bing(query: str) -> list:
    """必应图片搜索，返回原图 URL 列表"""
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
    except Exception as e:
        print(f"    bing 搜索失败: {e}", file=sys.stderr)
        return []


def search_baidu(query: str) -> list:
    """百度图片搜索（兜底），返回大图 URL 列表"""
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
    except Exception as e:
        print(f"    baidu 搜索失败: {e}", file=sys.stderr)
        return []


def download_score(url: str):
    """下载并评分，返回 (PIL.Image, score)；无效返回 (None, -1)"""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=12)
        if resp.status_code != 200:
            return None, -1
        if not resp.headers.get("Content-Type", "").startswith("image"):
            return None, -1
        data = resp.content
        if len(data) < MIN_BYTES:
            return None, -1
        img = Image.open(io.BytesIO(data))
        img.verify()  # 校验文件完整性
        img = Image.open(io.BytesIO(data))  # verify 后需重新打开
        if img.format not in ("JPEG", "PNG", "WEBP"):
            return None, -1
        w, h = img.size
        if min(w, h) < MIN_SIDE:
            return None, -1
        return img, w * h
    except Exception:
        return None, -1


def fetch_cover(query: str):
    """搜索候选并挑选最清晰的一张图"""
    candidates = search_bing(query)
    if len(candidates) < 3:
        candidates += search_baidu(query)

    best_img = None
    best_score = -1
    for url in candidates[:8]:
        img, score = download_score(url)
        if img is not None and score > best_score:
            best_img, best_score = img, score
            if best_score >= GOOD_SCORE:
                break  # 已足够清晰
    return best_img


def save_cover(img: Image.Image, poi_id: int) -> str:
    """压缩保存到本地，返回站点内 URL"""
    os.makedirs(COVER_DIR, exist_ok=True)
    if img.mode != "RGB":
        img = img.convert("RGB")
    w, h = img.size
    scale = min(1.0, MAX_SIDE / max(w, h))
    if scale < 1.0:
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    img.save(os.path.join(COVER_DIR, f"{poi_id}.jpg"), "JPEG", quality=85, optimize=True)
    return f"/static/covers/{poi_id}.jpg"


def main():
    parser = argparse.ArgumentParser(description="POI 封面图爬虫")
    parser.add_argument("--force", action="store_true", help="重新爬取所有 POI（默认只爬缺失的）")
    parser.add_argument("--limit", type=int, default=0, help="只处理前 N 个（0=全部）")
    args = parser.parse_args()

    db = SessionLocal()
    pois = db.query(POI).order_by(POI.id).all()
    if args.limit:
        pois = pois[: args.limit]

    ok = fail = skip = 0
    failed_names = []
    total = len(pois)
    for i, poi in enumerate(pois, 1):
        local = os.path.join(COVER_DIR, f"{poi.id}.jpg")
        expect_url = f"/static/covers/{poi.id}.jpg"
        if not args.force and os.path.exists(local):
            if poi.cover_url != expect_url:
                poi.cover_url = expect_url
                db.commit()
            skip += 1
            continue

        print(f"[{i}/{total}] {poi.name} ...", end=" ", flush=True)
        img = fetch_cover(poi.name)
        if img is None:
            print("✗ 未找到")
            fail += 1
            failed_names.append(poi.name)
        else:
            poi.cover_url = save_cover(img, poi.id)
            db.commit()
            print(f"✓ {img.size[0]}x{img.size[1]}")
            ok += 1
        time.sleep(0.3)

    db.close()
    print("\n==== 完成 ====")
    print(f"成功 {ok} | 跳过 {skip} | 失败 {fail}")
    if failed_names:
        print("失败列表:", ", ".join(failed_names))


if __name__ == "__main__":
    main()
