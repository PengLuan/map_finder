"""
新增「车站寻踪」主题：poi_themes 1 行 + pois 315 条（全部 point、area_review=1 待核定）。
运行: cd backend && python3 -m scripts.insert_train_stations
"""
import os, sys, time, pymysql, requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.train_stations_data import STATIONS

AMAP_KEY = os.environ.get("AMAP_WEB_KEY", "")
OSS_ACCESS_KEY_ID = os.environ.get("OSS_ACCESS_KEY_ID", "")
OSS_ACCESS_KEY_SECRET = os.environ.get("OSS_ACCESS_KEY_SECRET", "")
OSS_ENDPOINT = "https://oss-cn-beijing.aliyuncs.com"
OSS_BUCKET_NAME = "map-find"
OSS_PUBLIC_URL = f"https://{OSS_BUCKET_NAME}.oss-cn-beijing.aliyuncs.com"
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEME_COVER_DIR = os.path.join(BASE_DIR, "static", "theme_covers")

THEME = {"id": 20, "code": "train_stations", "name": "车站寻踪",
         "description": "从百年老站到现代高铁枢纽，纵横中国铁路的钢铁脉络",
         "icon": "🚄", "group_name": "人文景观", "sort_order": 12}


def regeo(lng, lat):
    try:
        resp = requests.get("https://restapi.amap.com/v3/geocode/regeo",
                            params={"location": f"{lng},{lat}", "key": AMAP_KEY, "extensions": "base"}, timeout=10)
        data = resp.json()
        if data.get("status") == "1":
            comp = data["regeocode"]["addressComponent"]
            addr = data["regeocode"].get("formatted_address") or ""
            if isinstance(addr, list): addr = ""
            return comp.get("adcode") or "", addr
    except Exception as e:
        print(f"    regeo 失败: {e}", file=sys.stderr)
    return "", ""


def upload_theme_cover():
    from scripts.crawl_images import fetch_cover
    img = None
    for q in ("北京南站 高铁", "上海虹桥站 高铁", "中国高铁站"):
        img = fetch_cover(q)
        if img is not None: break
    if img is None:
        print("[THEME] 封面爬取失败"); return None
    if img.mode != "RGB": img = img.convert("RGB")
    w, h = img.size
    scale = min(1.0, 1280 / max(w, h))
    if scale < 1.0: img = img.resize((int(w * scale), int(h * scale)))
    os.makedirs(THEME_COVER_DIR, exist_ok=True)
    local = os.path.join(THEME_COVER_DIR, "train_stations.jpg")
    img.save(local, "JPEG", quality=85, optimize=True)
    import oss2
    bucket = oss2.Bucket(oss2.Auth(OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET), OSS_ENDPOINT, OSS_BUCKET_NAME)
    oss_key = "covers/themes/train_stations.jpg"
    bucket.put_object_from_file(oss_key, local, headers={"Content-Type": "image/jpeg"})
    url = f"{OSS_PUBLIC_URL}/{oss_key}"
    print(f"[THEME] 封面已上传 {url}")
    return url


def main():
    conn = pymysql.connect(host="localhost", port=3306, user="root", password="123456", database="map_game", charset="utf8mb4")
    cur = conn.cursor()
    cur.execute("SELECT id, cover_url FROM pois WHERE category='train_stations'")
    old_covers = {row[0]: row[1] for row in cur.fetchall() if row[1]}
    cur.execute("SELECT cover_url FROM poi_themes WHERE code='train_stations'")
    row = cur.fetchone()
    old_theme_cover = row[0] if row and row[0] else None
    cur.execute("DELETE FROM pois WHERE category='train_stations'")
    cur.execute("DELETE FROM poi_themes WHERE code='train_stations'")
    conn.commit()
    print(f"[CLEAN] 已清理旧数据（保留 {len(old_covers)} 条封面）")
    cur.execute("INSERT INTO poi_themes (id, code, name, description, icon, cover_url, group_name, sort_order, enabled) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,1)",
                (THEME["id"], THEME["code"], THEME["name"], THEME["description"], THEME["icon"],
                 old_theme_cover, THEME["group_name"], THEME["sort_order"]))
    conn.commit()
    print(f"[THEME] 已插入: {THEME['name']} (id={THEME['id']})")
    ok = 0
    for r in STATIONS:
        adcode, address = regeo(r["lng"], r["lat"])
        cur.execute("INSERT INTO pois (id, name, category, lng, lat, adcode, address, summary, "
                    "cover_url, hint_text, difficulty, source, used_count, verify_status, "
                    "shape_type, radius_km, area_review) "
                    "VALUES (%s,%s,'train_stations',%s,%s,%s,%s,%s,%s,%s,%s,'manual',0,'approved','point',0,1)",
                    (r["id"], r["name"], r["lng"], r["lat"], adcode or None, address or None,
                     r["summary"], old_covers.get(r["id"]), r["hint"], r["difficulty"]))
        conn.commit()
        print(f"  [{ok+1}/{len(STATIONS)}] {r['name']} id={r['id']} adcode={adcode or '-'}")
        ok += 1; time.sleep(0.15)
    if old_theme_cover:
        print("[THEME] 已有封面，跳过")
    else:
        cover = upload_theme_cover()
        if cover:
            cur.execute("UPDATE poi_themes SET cover_url=%s WHERE code='train_stations'", (cover,))
            conn.commit()
    conn.close()
    print(f"\n[DONE] 插入 {ok} 条 POI")


if __name__ == "__main__":
    main()
