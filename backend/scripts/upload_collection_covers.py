# -*- coding: utf-8 -*-
"""为全部专题设置封面图（复用现有 POI 的真实 OSS 图，无 text_to_image）。

优先级：
1. 复用专题内第一个有封面图的 POI 的 cover_url。
2. 专题内无封面图时，用 POI 名称在现有 pois 表模糊匹配（name LIKE %名称%）。
3. 仍匹配不到时，用 FIX_KEYWORDS 手动关键词匹配。
4. 最后兜底用泰山图。

幂等：每次运行都按上述规则重新计算并写入，重启后封面图保持正确。
用法：python scripts/upload_collection_covers.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal  # noqa: E402
from app.models import Collection, CollectionPoi, POI  # noqa: E402

FIX_KEYWORDS = {
    "wuzhen": "泰山",
    "hot_spring": "华清宫",
    "yangtze_estuary": "上海",
    "canal_heritage": "瘦西湖",
    "mountain_tunnel": "秦岭",
    "wartime_university": "大学",
    "modern_university": "北京大学",
    "red_education": "延安",
    "dream_red_chamber": "颐和园",
    "geodetic_origin": "西安城墙",
    "ancient_observatory": "北京天文馆",
}

FALLBACK_COVER = "https://map-find.oss-cn-beijing.aliyuncs.com/covers/13.jpg"  # 泰山


def find_cover(db, keyword: str) -> str | None:
    p = (
        db.query(POI)
        .filter(POI.name.like(f"%{keyword}%"), POI.cover_url.isnot(None), POI.cover_url != "")
        .first()
    )
    return p.cover_url if p else None


def first_cover_url(db, coll_id: int) -> str | None:
    rows = (
        db.query(POI.cover_url)
        .join(CollectionPoi, CollectionPoi.poi_id == POI.id)
        .filter(CollectionPoi.collection_id == coll_id)
        .order_by(CollectionPoi.sort_order)
        .all()
    )
    for r in rows:
        if r[0]:
            return r[0]
    return None


def first_names(db, coll_id: int) -> list[str]:
    rows = (
        db.query(POI.name)
        .join(CollectionPoi, CollectionPoi.poi_id == POI.id)
        .filter(CollectionPoi.collection_id == coll_id)
        .order_by(CollectionPoi.sort_order)
        .all()
    )
    return [r[0] for r in rows]


def main():
    db = SessionLocal()
    try:
        colls = db.query(Collection).filter(Collection.enabled.is_(True)).all()
        reused = fallback = 0
        for c in colls:
            # 1. 复用专题内 POI 封面
            cover = first_cover_url(db, c.id)
            if cover:
                reused += 1
                c.cover_url = cover
                continue

            # 2. 模糊匹配（整名）
            names = first_names(db, c.id)
            for n in names:
                if len(n) >= 2:
                    cover = find_cover(db, n)
                    if cover:
                        break
            # 3. 手动关键词
            if not cover and c.code in FIX_KEYWORDS:
                cover = find_cover(db, FIX_KEYWORDS[c.code])
            # 4. 兜底
            if not cover:
                cover = FALLBACK_COVER
                fallback += 1
                print(f"兜底 {c.code} ({c.name})")
            c.cover_url = cover

        db.commit()
        print(f"完成：复用专题内封面 {reused} 个，兜底 {fallback} 个，共 {len(colls)} 个专题")
    finally:
        db.close()


if __name__ == "__main__":
    main()
