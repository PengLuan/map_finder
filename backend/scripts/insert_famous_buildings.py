"""
新增「华夏建筑」主题：poi_themes 1 行 + pois 313 条（全部 point、area_review=1 待核定）。

- 幂等：重复执行会先删除 code=famous_buildings / category=famous_buildings 的旧数据再重建，
  重建前会保留已有的 POI 封面 URL 与主题封面 URL
- adcode/address 通过高德逆地理编码按坐标校准
- 主题封面现场爬一张图，上传 OSS covers/themes/famous_buildings.jpg 并回写 cover_url
- POI 封面不在此脚本处理，后续运行 scripts.crawl_famous_buildings_covers + scripts.upload_covers_to_oss

运行: cd backend && python3 -m scripts.insert_famous_buildings
"""
import os
import sys
import time

import pymysql
import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.famous_buildings_data import BUILDINGS

AMAP_KEY = os.environ.get("AMAP_WEB_KEY", "")

OSS_ACCESS_KEY_ID = os.environ.get("OSS_ACCESS_KEY_ID", "")
OSS_ACCESS_KEY_SECRET = os.environ.get("OSS_ACCESS_KEY_SECRET", "")
OSS_ENDPOINT = "https://oss-cn-beijing.aliyuncs.com"
OSS_BUCKET_NAME = "map-find"
OSS_PUBLIC_URL = f"https://{OSS_BUCKET_NAME}.oss-cn-beijing.aliyuncs.com"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEME_COVER_DIR = os.path.join(BASE_DIR, "static", "theme_covers")

THEME = {
    "id": 18,
    "code": "famous_buildings",
    "name": "华夏建筑",
    "description": "从古塔宫殿到现代地标，纵览中华建筑的千年风华",
    "icon": "🏯",
    "group_name": "人文景观",
    "sort_order": 10,
}


def regeo(lng: float, lat: float):
    """高德逆地理编码，返回 (adcode, formatted_address)"""
    try:
        resp = requests.get(
            "https://restapi.amap.com/v3/geocode/regeo",
            params={"location": f"{lng},{lat}", "key": AMAP_KEY, "extensions": "base"},
            timeout=10,
        )
        data = resp.json()
        if data.get("status") == "1":
            comp = data["regeocode"]["addressComponent"]
            addr = data["regeocode"].get("formatted_address") or ""
            if isinstance(addr, list):
                addr = ""
            return comp.get("adcode") or "", addr
    except Exception as e:
        print(f"    regeo 失败: {e}", file=sys.stderr)
    return "", ""


def upload_theme_cover():
    """为主题爬一张封面图并上传 OSS，返回 OSS URL"""
    from scripts.crawl_images import fetch_cover

    img = None
    for q in ("故宫太和殿 全景", "天坛祈年殿 全景", "中国古建筑 宫殿"):
        img = fetch_cover(q)
        if img is not None:
            break
    if img is None:
        print("[THEME] 封面爬取失败，cover_url 留空")
        return None

    if img.mode != "RGB":
        img = img.convert("RGB")
    w, h = img.size
    scale = min(1.0, 1280 / max(w, h))
    if scale < 1.0:
        img = img.resize((int(w * scale), int(h * scale)))
    os.makedirs(THEME_COVER_DIR, exist_ok=True)
    local = os.path.join(THEME_COVER_DIR, "famous_buildings.jpg")
    img.save(local, "JPEG", quality=85, optimize=True)

    import oss2
    bucket = oss2.Bucket(oss2.Auth(OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET),
                         OSS_ENDPOINT, OSS_BUCKET_NAME)
    oss_key = "covers/themes/famous_buildings.jpg"
    bucket.put_object_from_file(oss_key, local, headers={"Content-Type": "image/jpeg"})
    url = f"{OSS_PUBLIC_URL}/{oss_key}"
    try:
        status = requests.head(url, timeout=20).status_code
    except Exception:
        status = "?"
    print(f"[THEME] 封面已上传 {url} (HTTP {status})")
    return url


def main():
    conn = pymysql.connect(host="localhost", port=3306, user="root", password="123456",
                           database="map_game", charset="utf8mb4")
    cur = conn.cursor()

    # 幂等：清理前先保留已有封面 URL
    cur.execute("SELECT id, cover_url FROM pois WHERE category='famous_buildings'")
    old_covers = {row[0]: row[1] for row in cur.fetchall() if row[1]}
    cur.execute("SELECT cover_url FROM poi_themes WHERE code='famous_buildings'")
    row = cur.fetchone()
    old_theme_cover = row[0] if row and row[0] else None
    cur.execute("DELETE FROM pois WHERE category='famous_buildings'")
    cur.execute("DELETE FROM poi_themes WHERE code='famous_buildings'")
    conn.commit()
    print(f"[CLEAN] 已清理旧的 famous_buildings 数据（保留 {len(old_covers)} 条 POI 封面、主题封面{'有' if old_theme_cover else '无'}）")

    # 插入主题
    cur.execute(
        "INSERT INTO poi_themes (id, code, name, description, icon, cover_url, group_name, sort_order, enabled) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,1)",
        (THEME["id"], THEME["code"], THEME["name"], THEME["description"],
         THEME["icon"], old_theme_cover, THEME["group_name"], THEME["sort_order"]),
    )
    conn.commit()
    print(f"[THEME] 已插入 poi_themes: {THEME['name']} (id={THEME['id']}, sort_order={THEME['sort_order']})")

    # 插入 POI
    ok = 0
    for r in BUILDINGS:
        adcode, address = regeo(r["lng"], r["lat"])
        if not adcode:
            print(f"    {r['name']}: 逆地理失败 (lng={r['lng']}, lat={r['lat']})")
        cur.execute(
            "INSERT INTO pois (id, name, category, lng, lat, adcode, address, summary, "
            "cover_url, hint_text, difficulty, source, used_count, verify_status, "
            "shape_type, radius_km, area_review) "
            "VALUES (%s,%s,'famous_buildings',%s,%s,%s,%s,%s,%s,%s,%s,'manual',0,'approved',"
            "'point',0,1)",
            (r["id"], r["name"], r["lng"], r["lat"], adcode or None, address or None,
             r["summary"], old_covers.get(r["id"]), r["hint"], r["difficulty"]),
        )
        conn.commit()
        print(f"  [{ok+1}/{len(BUILDINGS)}] {r['name']} id={r['id']} adcode={adcode or '-'} 地址={address or '-'}")
        ok += 1
        time.sleep(0.15)

    # 主题封面（已有则跳过）
    if old_theme_cover:
        print(f"[THEME] 已有封面 {old_theme_cover}，跳过上传")
    else:
        cover = upload_theme_cover()
        if cover:
            cur.execute("UPDATE poi_themes SET cover_url=%s WHERE code='famous_buildings'", (cover,))
            conn.commit()

    conn.close()
    print(f"\n[DONE] 插入 {ok} 条 POI（area_review=1 待核定），接下来运行:")
    print("  python3 -m scripts.crawl_famous_buildings_covers  # 爬 POI 封面")
    print("  python3 -m scripts.upload_covers_to_oss            # 上传 OSS 并回写 cover_url")


if __name__ == "__main__":
    main()
