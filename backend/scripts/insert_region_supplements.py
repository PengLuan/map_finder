"""
补充天津/台湾/香港/澳门不足30条的POI。
运行: cd backend && python -m scripts.insert_region_supplements
"""
import os, sys, time, pymysql, requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.region_supplement_data import SUPPLEMENTS

AMAP_KEY = os.environ.get("AMAP_WEB_KEY", "")


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


def main():
    conn = pymysql.connect(host="localhost", port=3306, user="root", password="123456", database="map_game", charset="utf8mb4")
    cur = conn.cursor()
    # 保留旧封面
    ids = [r["id"] for r in SUPPLEMENTS]
    placeholders = ",".join(["%s"] * len(ids))
    cur.execute(f"SELECT id, cover_url FROM pois WHERE id IN ({placeholders})", ids)
    old_covers = {row[0]: row[1] for row in cur.fetchall() if row[1]}
    # 清理旧数据
    cur.execute(f"DELETE FROM pois WHERE id IN ({placeholders})", ids)
    conn.commit()
    print(f"[CLEAN] 已清理 {len(ids)} 条旧数据（保留 {len(old_covers)} 条封面）")

    ok = 0
    for r in SUPPLEMENTS:
        if r.get("overseas"):
            adcode = r.get("adcode")
            address = r.get("address")
        else:
            adcode, address = regeo(r["lng"], r["lat"])
            time.sleep(0.15)
        cur.execute(
            "INSERT INTO pois (id, name, category, lng, lat, adcode, address, summary, "
            "cover_url, hint_text, difficulty, source, used_count, verify_status, "
            "shape_type, radius_km, area_review) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'manual',0,'approved','point',0,1)",
            (r["id"], r["name"], r["category"], r["lng"], r["lat"], adcode or None,
             address or None, r["summary"], old_covers.get(r["id"]), r["hint"], r["difficulty"]),
        )
        conn.commit()
        ok += 1
        print(f"  [{ok}/{len(SUPPLEMENTS)}] {r['name']} id={r['id']} cat={r['category']} adcode={adcode or '-'}")
    conn.close()
    print(f"\n[DONE] 插入 {ok} 条 POI")


if __name__ == "__main__":
    main()
