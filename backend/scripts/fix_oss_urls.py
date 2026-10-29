"""
批量检查并替换数据库中旧的杭州 OSS 地址为北京地址
运行方式：cd backend && python -m scripts.fix_oss_urls
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models import POI

OLD_HOST = "map-find.oss-cn-hangzhou.aliyuncs.com"
NEW_HOST = "map-find.oss-cn-beijing.aliyuncs.com"


def main():
    db = SessionLocal()
    try:
        pois = db.query(POI).filter(POI.cover_url.like(f"%{OLD_HOST}%")).all()
        if not pois:
            print(f"[OK] 未发现包含 {OLD_HOST} 的记录，无需替换")
            return

        print(f"[FOUND] 发现 {len(pois)} 条包含旧杭州地址的记录")
        for poi in pois:
            old_url = poi.cover_url
            poi.cover_url = old_url.replace(OLD_HOST, NEW_HOST)
            print(f"  POI#{poi.id} {poi.name}: {old_url} -> {poi.cover_url}")

        db.commit()
        print(f"[DONE] 已替换 {len(pois)} 条记录")
    finally:
        db.close()


if __name__ == "__main__":
    main()
