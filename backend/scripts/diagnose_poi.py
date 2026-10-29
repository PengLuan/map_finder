"""诊断 POI 区域判定问题。

用法：
  python diagnose_poi.py 拙政园            # 按名称查
  python diagnose_poi.py 123              # 按 id 查
  python diagnose_poi.py 拙政园 --bounds 116.30,31.20,116.35,31.25   # 用测试视野 bounds(west,south,east,north) 模拟 rect_hits_target

输出：
  - shape_type / radius_km / area_geojson 是否为空 / 顶点数 / bbox
  - poi.lng, poi.lat（中心点）
  - 若传 --bounds：rect_hits_target 判定结果 + 各 case 命中情况
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models import POI
from app.services import geometry


def main():
    if len(sys.argv) < 2:
        print("用法: python diagnose_poi.py <名称或id> [--bounds w,s,e,n]")
        sys.exit(1)

    key = sys.argv[1]
    bounds_arg = None
    if "--bounds" in sys.argv:
        idx = sys.argv.index("--bounds")
        bounds_arg = sys.argv[idx + 1]

    db = SessionLocal()
    try:
        poi = None
        if key.isdigit():
            poi = db.query(POI).filter(POI.id == int(key)).first()
        else:
            poi = db.query(POI).filter(POI.name.like(f"%{key}%")).first()

        if not poi:
            print(f"未找到 POI: {key}")
            return

        print(f"=== POI #{poi.id} {poi.name} ===")
        print(f"shape_type: {poi.shape_type!r}")
        print(f"radius_km: {poi.radius_km}")
        print(f"lng, lat (中心点): {poi.lng}, {poi.lat}")
        print(f"adcode: {poi.adcode}")
        print(f"area_review: {poi.area_review}")

        geo = poi.area_geojson
        print(f"area_geojson 是否为空: {not geo}")
        if geo:
            print(f"area_geojson 长度: {len(geo)} 字符")
            try:
                geom = geometry._parse_geojson(geo)
                print(f"解析成功: type={geom.get('type')}")
                rings = geometry._outer_rings(geom)
                print(f"外环数: {len(rings)}")
                for i, ring in enumerate(rings):
                    lngs = [p[0] for p in ring]
                    lats = [p[1] for p in ring]
                    print(f"  环{i}: 顶点数={len(ring)}, lng=[{min(lngs):.4f}~{max(lngs):.4f}], lat=[{min(lats):.4f}~{max(lats):.4f}]")
                    # 中心点是否在多边形内
                    inside = geometry._point_in_ring(poi.lng, poi.lat, ring)
                    print(f"  中心点({poi.lng},{poi.lat})是否在此环内: {inside}")
            except Exception as e:
                print(f"解析失败: {e}")

        if bounds_arg:
            parts = [float(x) for x in bounds_arg.split(",")]
            if len(parts) != 4:
                print("--bounds 需要 4 个数: west,south,east,north")
                return
            w, s, e, n = parts
            print(f"\n=== 测试视野 bounds: w={w}, s={s}, e={e}, n={n} ===")
            hit = geometry.rect_hits_target(w, s, e, n, poi)
            print(f"rect_hits_target 结果: {hit}")

            # 分 case 诊断
            shape = getattr(poi, "shape_type", "point") or "point"
            if shape == "polygon" and geo:
                geom = geometry._parse_geojson(geo)
                for i, ring in enumerate(geometry._outer_rings(geom)):
                    case1 = any(geometry._rect_contains_point(w, s, e, n, x, y) for x, y in ring)
                    rect_corners = [(w, s), (e, s), (e, n), (w, n)]
                    case2 = any(geometry._point_in_ring(cx, cy, ring) for cx, cy in rect_corners)
                    ring_edges = [(ring[j], ring[j + 1]) for j in range(len(ring) - 1)]
                    rect_edges = [(rect_corners[k], rect_corners[(k + 1) % 4]) for k in range(4)]
                    case3 = any(geometry._segments_intersect(re1, re2, pe1, pe2) for re1, re2 in rect_edges for pe1, pe2 in ring_edges)
                    in_view = [j for j, (x, y) in enumerate(ring) if geometry._rect_contains_point(w, s, e, n, x, y)]
                    print(f"  环{i}: case1(多边形顶点在矩形内)={case1} (顶点{in_view}), case2(矩形角点在多边形内)={case2}, case3(边相交)={case3}")
            elif shape == "point":
                inside = geometry._rect_contains_point(w, s, e, n, poi.lng, poi.lat)
                print(f"  point 模式: 中心点({poi.lng},{poi.lat})在视野内={inside}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
