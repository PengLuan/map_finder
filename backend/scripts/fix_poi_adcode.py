"""给 adcode 为空的 POI 从 address 字段解析省市并回填 adcode。

address 格式："XX省 XX市 的 地名" 或 "XX市 的 地名"。
解析后按 regions 表匹配省/市 code，拼成6位 adcode 回填。
省级模式按 adcode 前2位筛选，故至少补到省级即可。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models import POI, Region


def main():
    db = SessionLocal()
    # 预加载省、市
    provinces = {r.name: r for r in db.query(Region).filter(Region.level == 1).all()}
    cities = db.query(Region).filter(Region.level == 2).all()
    # 按名字索引（同省下市名唯一即可）
    city_index: dict[str, list[Region]] = {}
    for c in cities:
        city_index.setdefault(c.name, []).append(c)

    pois = db.query(POI).filter((POI.adcode.is_(None)) | (POI.adcode == "")).all()
    print(f"待补 adcode 的 POI: {len(pois)}")

    fixed = 0
    no_match = 0
    for poi in pois:
        if not poi.address or "的" not in poi.address:
            no_match += 1
            continue
        before_de = poi.address.split("的")[0].strip()
        parts = before_de.split()
        if not parts:
            no_match += 1
            continue

        prov_name = parts[0]
        prov = provinces.get(prov_name)
        if not prov:
            no_match += 1
            continue

        # 默认补到省级（前2位 + 0000）
        adcode = prov.code[:2] + "0000"

        # 尝试匹配市级（前4位 + 00）
        if len(parts) > 1:
            city_name = parts[1]
            cands = city_index.get(city_name, [])
            matched_city = next(
                (c for c in cands if c.code.startswith(prov.code[:2])), None
            )
            if matched_city:
                adcode = matched_city.code[:4] + "00"

        poi.adcode = adcode
        fixed += 1

    db.commit()
    print(f"已补 adcode: {fixed}/{len(pois)}，未匹配: {no_match}")
    db.close()


if __name__ == "__main__":
    main()
