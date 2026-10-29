# -*- coding: utf-8 -*-
"""为补录的 POI（source='collection' 且无封面图）补齐封面图。

复用现有 POI 的真实 OSS 封面图（名称多候选模糊匹配），匹配不到用兜底图。
幂等：每次运行都按规则重算，重启后保持正确。

用法：python scripts/fix_poi_covers.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal  # noqa: E402
from app.models import POI  # noqa: E402

FALLBACK_COVER = "https://map-find.oss-cn-beijing.aliyuncs.com/covers/13.jpg"  # 泰山兜底


def candidates(name: str):
    """生成候选关键词：整名 / 去前2字 / 去后1字 / 去前2后1。"""
    yield name
    if len(name) >= 4:
        yield name[2:]
    if len(name) >= 3:
        yield name[:-1]
    if len(name) >= 5:
        yield name[2:-1]


def main():
    db = SessionLocal()
    try:
        no_cover = db.query(POI).filter(
            (POI.cover_url.is_(None)) | (POI.cover_url == ""), POI.source == "collection"
        ).all()
        print(f"待补封面 POI: {len(no_cover)}")

        matched = fallback = 0
        for p in no_cover:
            found = None
            for c in candidates(p.name):
                q = (
                    db.query(POI)
                    .filter(
                        POI.name.like(f"%{c}%"),
                        POI.cover_url.isnot(None),
                        POI.cover_url != "",
                        POI.id != p.id,
                    )
                    .first()
                )
                if q:
                    found = q.cover_url
                    break
            if found:
                matched += 1
            else:
                found = FALLBACK_COVER
                fallback += 1
                print(f"兜底 {p.name}")
            p.cover_url = found

        db.commit()
        print(f"完成：匹配 {matched} 个，兜底 {fallback} 个，共 {len(no_cover)} 个")
    finally:
        db.close()


if __name__ == "__main__":
    main()
