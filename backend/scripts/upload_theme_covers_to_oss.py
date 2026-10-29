"""
主题封面图上传 OSS 脚本：
1. 从 poi_themes 读取 8 个主题的封面图 URL 并下载
2. 上传到阿里云 OSS（covers/themes/{code}.jpg）
3. 更新本地库 poi_themes.cover_url
4. 生成线上更新图片用的 scripts/update_theme_covers.sql

运行方式：cd backend && python3 -m scripts.upload_theme_covers_to_oss
"""
import os
import sys

import oss2
import pymysql
import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ===== OSS 配置（与 upload_covers_to_oss.py 保持一致） =====
OSS_ACCESS_KEY_ID = os.environ.get("OSS_ACCESS_KEY_ID", "")
OSS_ACCESS_KEY_SECRET = os.environ.get("OSS_ACCESS_KEY_SECRET", "")
OSS_ENDPOINT = "https://oss-cn-beijing.aliyuncs.com"
OSS_BUCKET_NAME = "map-find"
OSS_PREFIX = "covers/themes/"  # 主题封面单独目录，避免与 POI 封面混在一起
OSS_PUBLIC_URL = f"https://{OSS_BUCKET_NAME}.oss-cn-beijing.aliyuncs.com"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP_DIR = os.path.join(BASE_DIR, "static", "theme_covers")
SQL_PATH = os.path.join(BASE_DIR, "scripts", "update_theme_covers.sql")

EXT_BY_CONTENT_TYPE = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


def main():
    conn = pymysql.connect(
        host="localhost", port=3306, user="root", password="123456",
        database="map_game", charset="utf8mb4")
    cur = conn.cursor()
    cur.execute("SELECT code, cover_url FROM poi_themes ORDER BY sort_order")
    rows = cur.fetchall()
    print(f"[DB] 共 {len(rows)} 个主题")

    auth = oss2.Auth(OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET)
    bucket = oss2.Bucket(auth, OSS_ENDPOINT, OSS_BUCKET_NAME)
    os.makedirs(TMP_DIR, exist_ok=True)

    updates = []  # [(code, oss_url)]
    for code, url in rows:
        if not url:
            print(f"  [SKIP] {code}: 无封面图")
            continue
        # 1. 下载图片
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
        ext = EXT_BY_CONTENT_TYPE.get(content_type, "jpg")
        local_path = os.path.join(TMP_DIR, f"{code}.{ext}")
        with open(local_path, "wb") as f:
            f.write(resp.content)
        # 2. 上传 OSS
        oss_key = f"{OSS_PREFIX}{code}.{ext}"
        bucket.put_object_from_file(oss_key, local_path, headers={"Content-Type": content_type})
        oss_url = f"{OSS_PUBLIC_URL}/{oss_key}"
        # 3. 验证公网可访问
        try:
            check = requests.head(oss_url, timeout=30)
            status = "OK" if check.status_code == 200 else f"HTTP {check.status_code}"
        except Exception as e:
            status = f"CHECK_FAIL {e}"
        print(f"  [UPLOAD] {code} -> {oss_url} ({len(resp.content) // 1024}KB, {status})")
        updates.append((code, oss_url))

    if not updates:
        print("[ERROR] 没有可上传的封面图")
        conn.close()
        return

    # 4. 更新本地库
    for code, oss_url in updates:
        cur.execute("UPDATE poi_themes SET cover_url=%s WHERE code=%s", (oss_url, code))
    conn.commit()
    print(f"[DB] 本地已更新 {len(updates)} 个主题的 cover_url")

    # 5. 生成线上更新 SQL
    lines = [
        "-- ============================================================",
        "-- poi_themes 封面图地址更新为 OSS 地址（幂等，可重复执行）",
        "-- 生成方式: cd backend && python3 -m scripts.upload_theme_covers_to_oss",
        "-- ============================================================",
        "",
    ]
    for code, oss_url in updates:
        lines.append(f"UPDATE `poi_themes` SET `cover_url` = '{oss_url}' WHERE `code` = '{code}';")
    lines.append("")
    with open(SQL_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"[SQL] 已生成: {SQL_PATH}")

    conn.close()
    print("[DONE] 全部完成!")


if __name__ == "__main__":
    main()
