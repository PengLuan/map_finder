#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
只为 famous_buildings 主题的 POI 爬封面（复用 crawl_images 的抓取逻辑）。

用法: python -m scripts.crawl_famous_buildings_covers [--force]
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models import POI
from scripts.crawl_images import COVER_DIR, fetch_cover, save_cover


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="忽略本地已有封面重新爬")
    args = parser.parse_args()

    db = SessionLocal()
    pois = db.query(POI).filter(POI.category == "famous_buildings").order_by(POI.id).all()

    ok = fail = skip = 0
    failed = []
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
            failed.append(poi.name)
        else:
            poi.cover_url = save_cover(img, poi.id)
            db.commit()
            print(f"✓ {img.size[0]}x{img.size[1]}")
            ok += 1
        time.sleep(0.3)

    db.close()
    print("\n==== 完成 ====")
    print(f"成功 {ok} | 跳过 {skip} | 失败 {fail}")
    if failed:
        print("失败列表:", ", ".join(failed))


if __name__ == "__main__":
    main()
