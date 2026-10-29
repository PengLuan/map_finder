# -*- coding: utf-8 -*-
"""为 100 个专题补充预告卡的 description（文化背景 + 收集顺序说明）。

模板生成 3 句描述：主题地标 → 顺序玩法 → 勋章奖励。
用法：python scripts/generate_collection_descriptions.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal  # noqa: E402
from app.models import Collection, CollectionPoi, POI  # noqa: E402


def main():
    db = SessionLocal()
    try:
        colls = db.query(Collection).filter(Collection.enabled.is_(True)).all()
        updated = 0
        for c in colls:
            rows = (
                db.query(POI.name)
                .join(CollectionPoi, CollectionPoi.poi_id == POI.id)
                .filter(CollectionPoi.collection_id == c.id)
                .order_by(CollectionPoi.sort_order)
                .all()
            )
            names = [r[0] for r in rows]
            if not names:
                continue
            names_str = "、".join(names)
            desc = (
                f"{c.name}精选 {len(names)} 个中国地标：{names_str}。"
                f"按顺序依次收集，从起点逐站挑战，猜中每站准确位置即可前进。"
                f"集齐全部点位点亮专属勋章，用时计入排行榜。"
            )
            c.description = desc
            updated += 1
        db.commit()
        print(f"完成：更新 {updated} 个专题 description")
    finally:
        db.close()


if __name__ == "__main__":
    main()
