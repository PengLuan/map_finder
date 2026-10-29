"""
封面图片上传 OSS 脚本：
1. 将 static/covers/ 下所有图片上传到阿里云 OSS
2. 更新数据库 pois.cover_url 为 OSS 地址

运行方式：cd backend && python -m scripts.upload_covers_to_oss
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import oss2
from app.database import SessionLocal
from app.models import POI

# ===== OSS 配置 =====
OSS_ACCESS_KEY_ID = os.environ.get("OSS_ACCESS_KEY_ID", "")
OSS_ACCESS_KEY_SECRET = os.environ.get("OSS_ACCESS_KEY_SECRET", "")
OSS_ENDPOINT = "https://oss-cn-beijing.aliyuncs.com"
OSS_BUCKET_NAME = "map-find"
OSS_PREFIX = "covers/"  # OSS 中的目录前缀
OSS_PUBLIC_URL = f"https://{OSS_BUCKET_NAME}.oss-cn-beijing.aliyuncs.com"

# 本地封面目录
COVERS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "covers")


def main():
    # 1. 初始化 OSS
    auth = oss2.Auth(OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET)
    bucket = oss2.Bucket(auth, OSS_ENDPOINT, OSS_BUCKET_NAME)
    print(f"[OSS] bucket={OSS_BUCKET_NAME}, endpoint={OSS_ENDPOINT}, prefix={OSS_PREFIX}")

    # 设置 Bucket 为公共读（所有人可读取，仅管理员可写入）
    try:
        bucket.put_bucket_acl(oss2.BUCKET_ACL_PUBLIC_READ)
        print("[ACL] Bucket 已设置为公共读")
    except Exception as e:
        print(f"[ACL] 设置公共读失败: {e}")

    # 2. 扫描本地文件
    if not os.path.isdir(COVERS_DIR):
        print(f"[ERROR] 目录不存在: {COVERS_DIR}")
        return

    files = [f for f in os.listdir(COVERS_DIR) if f.endswith((".jpg", ".jpeg", ".png", ".webp"))]
    files.sort(key=lambda f: int(os.path.splitext(f)[0]) if os.path.splitext(f)[0].isdigit() else 0)
    print(f"[SCAN] 发现 {len(files)} 个封面文件")

    # 3. 上传到 OSS
    uploaded = 0
    skipped = 0
    failed = 0
    for filename in files:
        local_path = os.path.join(COVERS_DIR, filename)
        oss_key = f"{OSS_PREFIX}{filename}"

        try:
            # 幂等：OSS 上已存在的文件跳过，只上传新增的
            if bucket.object_exists(oss_key):
                skipped += 1
                continue
            bucket.put_object_from_file(oss_key, local_path)
            uploaded += 1
            if uploaded % 50 == 0:
                print(f"  已上传 {uploaded} 个...")
        except Exception as e:
            failed += 1
            print(f"  [FAIL] {filename}: {e}")

    print(f"[UPLOAD] 完成: 新上传 {uploaded}, 跳过 {skipped}, 失败 {failed}")

    # 4. 更新数据库
    db = SessionLocal()
    try:
        pois = db.query(POI).all()
        updated = 0
        for poi in pois:
            # 检查对应的封面文件是否存在
            cover_file = f"{poi.id}.jpg"
            if cover_file in files or f"{poi.id}.png" in files:
                ext = "jpg" if cover_file in files else "png"
                oss_url = f"{OSS_PUBLIC_URL}/{OSS_PREFIX}{poi.id}.{ext}"
                if poi.cover_url != oss_url:
                    poi.cover_url = oss_url
                    updated += 1

        db.commit()
        print(f"[DB] 更新了 {updated} 条 POI 的 cover_url")
    finally:
        db.close()

    print("[DONE] 全部完成!")
    print(f"  示例 URL: {OSS_PUBLIC_URL}/{OSS_PREFIX}1.jpg")


if __name__ == "__main__":
    main()
