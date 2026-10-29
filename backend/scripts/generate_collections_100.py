# -*- coding: utf-8 -*-
"""解析 collection-list.md，生成 100 个专题数据到本地数据库。

- 坐标：pois 表精确匹配 → 高德地理编码 → FALLBACK 坐标表
- 星级：按「点数 + 几何复杂度 + 类别冷门度」打分排序，切分成 ★1~★8（15/18/20/16/12/10/6/3）
- 写入：pois（补录缺失点位）+ collections + collection_pois + medals（幂等）
- 4 个几何图形专题（爱心中国/五角星/八卦方位/中国心）点位在文档里是描述性文本，此处硬编码

用法：
    python scripts/generate_collections_100.py --dry-run   # 只解析+报告
    python scripts/generate_collections_100.py             # 实际写入
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    Collection,
    CollectionPoi,
    Medal,
    MedalRecord,
    POI,
    UserMedal,
)

# 旧 MVP 种子用了与文档不同的 code，生成前清理，避免重复专题
OLD_MVP_CODES = ["gudu6", "foshan4", "lake5", "jiangnan3"]

AMAP_KEY = os.environ.get("AMAP_WEB_KEY", "")
DOC = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "..", "docs", "collection-list.md",
)

# 几何图形专题（点位在文档里为描述性文本，这里硬编码顺序点位）
GEOMETRY_COLLECTIONS = {
    "heart_of_china": ["北京", "天津", "济南", "郑州", "武汉", "长沙", "南昌", "南京"],
    "five_point_star": ["泰山", "华山", "衡山", "嵩山", "恒山"],
    "bagua_directions": ["喀什", "瑞丽", "上海", "厦门", "漠河", "三沙", "抚远", "乌恰"],
    "china_heart": ["北京", "哈尔滨", "乌鲁木齐", "拉萨", "昆明", "广州", "上海"],
}

# 高德地理编码失败时的兜底坐标：name -> (lng, lat, adcode)
FALLBACK: dict[str, tuple[float, float, str]] = {
    "中镇霍山": (111.72, 36.57, "141082"),
    "乔戈里": (76.51, 35.88, "653101"),
    "壶口瀑布": (110.44, 36.15, "141028"),
    "汉魏洛阳城": (112.53, 34.72, "410300"),
    "隋唐洛阳城": (112.47, 34.68, "410300"),
    "邙山古墓群": (112.45, 34.78, "410300"),
    "避暑山庄": (117.94, 40.99, "130800"),
    "唐乾陵": (108.22, 34.57, "610424"),
    "汉长安城": (108.88, 34.34, "610100"),
    "唐大明宫": (108.96, 34.30, "610100"),
    "北洋大学堂": (117.18, 39.11, "120000"),
    "圣约翰大学": (121.40, 31.22, "310000"),
    "恰克图": (106.45, 50.35, ""),
}


def geocode(keyword: str) -> tuple[float, float, str] | None:
    url = (
        "https://restapi.amap.com/v3/geocode/geo?"
        + urllib.parse.urlencode({"address": keyword, "key": AMAP_KEY})
    )
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            data = json.loads(r.read().decode("utf-8"))
        if data.get("status") == "1" and data.get("geocodes"):
            g = data["geocodes"][0]
            lng, lat = g["location"].split(",")
            return float(lng), float(lat), g.get("adcode") or ""
    except Exception:
        pass
    return None


def parse_doc():
    """返回 [(code, name, category, point_count, points, geom_text, is_star)]。

    points 为 [(clean, alias)]；is_star 为几何列是否含 ★（刻意图形）。
    """
    sections = []
    cur_cat = ""
    with open(DOC, encoding="utf-8") as f:
        for line in f:
            sm = re.match(r"^##\s*([A-M])\.\s", line)
            if sm:
                cur_cat = sm.group(1)
                continue
            m = re.match(
                r"^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|",
                line,
            )
            if not m:
                continue
            code = m.group(3).strip()
            name = m.group(2).strip()
            count = int(m.group(4))
            raw_points = [x.strip() for x in m.group(5).split("→") if x.strip()]
            geom_text = m.group(6).strip()
            is_star = "★" in geom_text

            if code in GEOMETRY_COLLECTIONS:
                pts = [(p, "") for p in GEOMETRY_COLLECTIONS[code]]
                count = len(pts)
            else:
                pts = []
                for rp in raw_points:
                    alias = ""
                    clean = rp
                    am = re.search(r"[（(]([^（）()]*)[）)]", rp)
                    if am:
                        alias = am.group(1).strip()
                        clean = re.sub(r"[（(].*?[）)]", "", rp).strip()
                    pts.append((clean, alias))

            sections.append((code, name, cur_cat, count, pts, geom_text, is_star))
    return sections


def difficulty_score(count: int, geom_text: str, is_star: bool, category: str) -> float:
    """难度分（越高越难），用于排序切分星级。"""
    score = count * 10.0
    if is_star:
        score += 8.0  # 刻意图形
    elif "形" in geom_text and "线形" not in geom_text:
        score += 4.0  # 多边形
    if category in ("H", "I", "J", "K", "L"):
        score += 3.0  # 冷门类别
    return score


# 星级切分（累计边界）：★1~★8 数量 = 15/18/20/16/12/10/6/3
_STAR_BOUNDS = [15, 33, 53, 69, 81, 91, 97, 100]


def assign_stars(sections):
    """按难度分排序切分，返回 code -> star。"""
    scored = []
    for code, name, cat, count, pts, geom_text, is_star in sections:
        scored.append((difficulty_score(count, geom_text, is_star, cat), code))
    scored.sort(key=lambda x: (x[0], x[1]))
    star_map = {}
    for rank, (_, code) in enumerate(scored):
        for s, bound in enumerate(_STAR_BOUNDS):
            if rank < bound:
                star_map[code] = s + 1
                break
    return star_map


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    sections = parse_doc()
    star_map = assign_stars(sections)
    print(f"解析到专题数: {len(sections)}")

    star_dist = {}
    for code, *_ in sections:
        s = star_map[code]
        star_dist[s] = star_dist.get(s, 0) + 1
    print(f"星级分布: {dict(sorted(star_dist.items()))}")

    db = SessionLocal()
    try:
        poi_map: dict[str, list] = {}
        for p in db.query(POI).all():
            poi_map.setdefault(p.name, []).append(p)

        resolved = 0
        missing = []
        new_pois = {}

        for code, name, cat, count, pts, geom_text, is_star in sections:
            for idx, (clean, alias) in enumerate(pts):
                if clean in poi_map:
                    resolved += 1
                    continue
                keyword = f"{clean} {alias}".strip() if alias else clean
                geo = geocode(keyword) or (geocode(alias) if alias else None)
                if geo:
                    lng, lat, adcode = geo
                    new_pois[clean] = (lng, lat, adcode)
                    resolved += 1
                    continue
                fb = FALLBACK.get(clean)
                if fb:
                    lng, lat, adcode = fb
                    new_pois[clean] = (lng, lat, adcode)
                    resolved += 1
                    continue
                missing.append((code, name, clean))
                time.sleep(0.02)

        total_pts = sum(len(s[4]) for s in sections)
        print(f"点位总数: {total_pts}，成功解析: {resolved}，失败: {len(missing)}，需补录 POI: {len(new_pois)}")
        if missing:
            print("=== 仍无法解析坐标（需补 FALLBACK）===")
            for code, name, clean in missing:
                print(f"  {code} {name}: {clean}")

        if args.dry_run:
            return

        from datetime import datetime

        # 清理旧 MVP 专题（code 与文档不一致），连同勋章/关联数据
        old_colls = db.query(Collection).filter(Collection.code.in_(OLD_MVP_CODES)).all()
        for oc in old_colls:
            oc_id = oc.id
            medal_ids = [r[0] for r in db.query(Medal.id).filter(Medal.collection_id == oc_id).all()]
            if medal_ids:
                db.query(UserMedal).filter(UserMedal.medal_id.in_(medal_ids)).delete(synchronize_session=False)
                db.query(MedalRecord).filter(MedalRecord.medal_id.in_(medal_ids)).delete(synchronize_session=False)
            db.query(Medal).filter(Medal.collection_id == oc_id).delete(synchronize_session=False)
            db.query(CollectionPoi).filter(CollectionPoi.collection_id == oc_id).delete(synchronize_session=False)
            db.delete(oc)
        if old_colls:
            print(f"已清理旧 MVP 专题 {len(old_colls)} 个: {[c.code for c in old_colls]}")
        db.flush()

        # 补录缺失 POI
        for cname, (lng, lat, adcode) in new_pois.items():
            exists = db.query(POI.id).filter(POI.name == cname).first()
            if exists:
                continue
            db.add(POI(
                name=cname, category="collection", lng=lng, lat=lat,
                adcode=adcode or None, difficulty=2, used_count=0,
                source="collection", verify_status="approved", shape_type="point",
            ))
        db.flush()

        poi_map2: dict[str, list] = {}
        for p in db.query(POI).all():
            poi_map2.setdefault(p.name, []).append(p)

        for code, name, cat, count, pts, geom_text, is_star in sections:
            star = star_map[code]
            coll = db.query(Collection).filter(Collection.code == code).first()
            if not coll:
                coll = Collection(
                    code=code, name=name,
                    description=f"{name}专题（共 {count} 站）",
                    difficulty_star=star, unlock_require=0,
                    audit_status="approved", enabled=1,
                    sort_order=0, created_at=datetime.now(),
                )
                db.add(coll)
                db.flush()
            else:
                coll.name = name
                coll.difficulty_star = star

            for idx, (clean, alias) in enumerate(pts):
                p = poi_map2.get(clean, [None])[0]
                if p is None:
                    continue
                exist_cp = db.query(CollectionPoi.id).filter(
                    CollectionPoi.collection_id == coll.id,
                    CollectionPoi.poi_id == p.id,
                ).first()
                if not exist_cp:
                    db.add(CollectionPoi(
                        collection_id=coll.id, poi_id=p.id,
                        sort_order=idx, created_at=datetime.now(),
                    ))

            for diff in ("easy", "hard"):
                for gt in ("solo", "pk"):
                    exist_m = db.query(Medal.id).filter(
                        Medal.collection_id == coll.id,
                        Medal.difficulty == diff, Medal.game_type == gt,
                    ).first()
                    if not exist_m:
                        db.add(Medal(
                            collection_id=coll.id, difficulty=diff, game_type=gt,
                            name=f"{name}·{'简单' if diff=='easy' else '困难'}·{'单人' if gt=='solo' else '对战'}",
                            created_at=datetime.now(),
                        ))

        db.commit()
        print(f"完成：写入 {len(sections)} 个专题（collections + collection_pois + medals）")
    finally:
        db.close()


if __name__ == "__main__":
    main()
