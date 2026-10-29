# -*- coding: utf-8 -*-
"""为 5 个 MVP 专题生成封面图 URL 并写入 collections.cover_url。

封面图使用 text_to_image 生成接口（与 game.cover_url_for 一致），
URL 直接作为 cover_url 存库，前端 <img> 加载时实时生成图片。
幂等：直接 UPDATE 覆盖，可重复执行。

用法：
    cd /www/wwwroot/zhizhang/map/backend   （本地为 backend 目录）
    python scripts/seed_collection_covers.py
"""
import os
import sys
from urllib.parse import quote

# 让脚本能 import app 包
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal  # noqa: E402
from app.models import Collection  # noqa: E402

_BASE = "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image"
_IMAGE_SIZE = "landscape_16_9"

COVERS = {
    "wuyue": "aerial landscape of the five sacred mountains of China, majestic peaks with misty summits, photorealistic, golden hour light, dramatic natural scenery, high detail",
    "gudu6": "ancient capital city of China, historic palace and grand city walls, traditional Chinese architecture, aerial view, photorealistic, golden hour light, high detail",
    "foshan4": "sacred Buddhist mountain in China, ancient temple on misty peak with golden pagoda, serene atmosphere, photorealistic, high detail",
    "lake5": "vast freshwater lake in China, calm water reflecting sunset, lush green shoreline, aerial view, photorealistic, high detail",
    "jiangnan3": "famous ancient Chinese tower by the river in Jiangnan, traditional pavilion architecture, waterfront, golden hour light, photorealistic, high detail",
}


def _url(prompt: str) -> str:
    return f"{_BASE}?prompt={quote(prompt)}&image_size={_IMAGE_SIZE}"


def main() -> None:
    db = SessionLocal()
    try:
        for code, prompt in COVERS.items():
            url = _url(prompt)
            coll = db.query(Collection).filter(Collection.code == code).first()
            if not coll:
                print(f"跳过（专题不存在）: {code}")
                continue
            coll.cover_url = url
            print(f"{code} ({coll.name}) -> {url}")
        db.commit()
        print(f"完成：已写入 {len(COVERS)} 个专题 cover_url")
    finally:
        db.close()


if __name__ == "__main__":
    main()
