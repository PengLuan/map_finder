"""区域范围判定几何算法。

支持三种目标形态：
- point：单点（沿用阈值）
- circle：圆形范围
- polygon：多边形范围（GeoJSON Polygon / MultiPolygon）

判定场景：
- 简单模式：点击点是否命中目标范围（point_hits_target）
- 困难模式：视野矩形是否与目标范围相交（rect_hits_target）
"""
import json
import math


# ===== GeoJSON 解析 =====

def _parse_geojson(geojson_str: str | None) -> dict | None:
    if not geojson_str:
        return None
    try:
        return json.loads(geojson_str)
    except (ValueError, TypeError):
        return None


def _outer_rings(geom: dict) -> list[list[tuple[float, float]]]:
    """返回所有外环顶点列表 [(lng, lat), ...]。

    支持 Feature 包装（Leaflet toGeoJSON 输出）：{"type":"Feature","geometry":{...}}
    Polygon: coordinates = [outer, hole1, hole2, ...] → 取 outer
    MultiPolygon: coordinates = [[outer, ...], [outer, ...], ...] → 取每个 polygon 的 outer
    """
    # 解包 Feature
    if geom.get("type") == "Feature" and isinstance(geom.get("geometry"), dict):
        geom = geom["geometry"]
    rings: list[list[tuple[float, float]]] = []
    if geom.get("type") == "Polygon":
        rings.append([(p[0], p[1]) for p in geom["coordinates"][0]])
    elif geom.get("type") == "MultiPolygon":
        for poly in geom["coordinates"]:
            rings.append([(p[0], p[1]) for p in poly[0]])
    return rings


# ===== 点判定 =====

def _point_in_ring(lng: float, lat: float, ring: list[tuple[float, float]]) -> bool:
    """射线法判断点是否在多边形环内（边界视为在内）。"""
    n = len(ring)
    if n < 3:
        return False
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        # 点在顶点上
        if (xi, yi) == (lng, lat) or (xj, yj) == (lng, lat):
            return True
        # 射线穿过边的判定
        if ((yi > lat) != (yj > lat)):
            x_intersect = (xj - xi) * (lat - yi) / (yj - yi + 1e-18) + xi
            if lng < x_intersect:
                inside = not inside
        j = i
    return inside


def point_in_polygon(lng: float, lat: float, geojson_str: str | None) -> bool:
    geom = _parse_geojson(geojson_str)
    if not geom:
        return False
    for ring in _outer_rings(geom):
        if _point_in_ring(lng, lat, ring):
            return True
    return False


def _point_to_segment_km(plng: float, plat: float,
                         a_lng: float, a_lat: float,
                         b_lng: float, b_lat: float) -> float:
    """点到线段的最近距离（km）。

    用 equirectangular 投影找到线段上最近点，再用 haversine 精确计算距离。
    """
    from .game import haversine_km
    cos_lat = math.cos(math.radians(plat))
    px = plng * 111.0 * cos_lat
    py = plat * 111.0
    ax = a_lng * 111.0 * cos_lat
    ay = a_lat * 111.0
    bx = b_lng * 111.0 * cos_lat
    by = b_lat * 111.0

    dx = bx - ax
    dy = by - ay
    seg_len_sq = dx * dx + dy * dy

    if seg_len_sq < 1e-18:
        return haversine_km(plng, plat, a_lng, a_lat)

    t = ((px - ax) * dx + (py - ay) * dy) / seg_len_sq
    t = max(0.0, min(1.0, t))
    proj_lng = a_lng + t * (b_lng - a_lng)
    proj_lat = a_lat + t * (b_lat - a_lat)
    return haversine_km(plng, plat, proj_lng, proj_lat)


def distance_to_polygon_edge_km(lng: float, lat: float, geojson_str: str | None) -> float:
    """点到多边形边界最近边的距离（km）。在多边形内返回 0。"""
    geom = _parse_geojson(geojson_str)
    if not geom:
        return float("inf")
    if point_in_polygon(lng, lat, geojson_str):
        return 0.0
    min_d = float("inf")
    for ring in _outer_rings(geom):
        n = len(ring)
        for i in range(n - 1):
            a_lng, a_lat = ring[i]
            b_lng, b_lat = ring[i + 1]
            d = _point_to_segment_km(lng, lat, a_lng, a_lat, b_lng, b_lat)
            if d < min_d:
                min_d = d
    return min_d


def point_hits_target(lng: float, lat: float, poi) -> bool:
    """简单模式：点击点是否命中目标范围。

    - polygon：点在多边形内，或距边界 ≤ 阈值
    - circle：点距圆心 ≤ 半径 + 阈值（圆内 + 圆外阈值范围都算命中）
    - point：点距目标点 ≤ 阈值
    """
    from .game import EASY_CLICK_THRESHOLD_KM, haversine_km
    shape = getattr(poi, "shape_type", "point") or "point"
    if shape == "polygon":
        geojson = getattr(poi, "area_geojson", None)
        if geojson:
            # 在多边形内 → 命中；否则距边界 ≤ 阈值也算命中
            return (point_in_polygon(lng, lat, geojson) or
                    distance_to_polygon_edge_km(lng, lat, geojson) <= EASY_CLICK_THRESHOLD_KM)
        # geojson 缺失，回退到点判定
    if shape == "circle" and (getattr(poi, "radius_km", 0) or 0) > 0:
        # 圆内（≤ 半径）或圆外阈值范围（≤ 半径 + 阈值）都算命中
        return haversine_km(lng, lat, poi.lng, poi.lat) <= poi.radius_km + EASY_CLICK_THRESHOLD_KM
    # point：沿用 0.5km 阈值
    return haversine_km(lng, lat, poi.lng, poi.lat) <= EASY_CLICK_THRESHOLD_KM


# ===== 矩形判定 =====

def _rect_contains_point(w, s, e, n, lng, lat) -> bool:
    return w <= lng <= e and s <= lat <= n


def _segments_intersect(p1, p2, p3, p4) -> bool:
    """两线段 (p1p2) 与 (p3p4) 是否相交。"""
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    d1 = cross(p3, p4, p1)
    d2 = cross(p3, p4, p2)
    d3 = cross(p1, p2, p3)
    d4 = cross(p1, p2, p4)
    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
       ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True
    # 共线/端点情况简化处理：端点落在另一线段上
    def on_seg(a, b, c):
        return min(a[0], b[0]) <= c[0] <= max(a[0], b[0]) and \
               min(a[1], b[1]) <= c[1] <= max(a[1], b[1])
    if d1 == 0 and on_seg(p3, p4, p1):
        return True
    if d2 == 0 and on_seg(p3, p4, p2):
        return True
    if d3 == 0 and on_seg(p1, p2, p3):
        return True
    if d4 == 0 and on_seg(p1, p2, p4):
        return True
    return False


def rect_intersects_polygon(w, s, e, n, geojson_str: str | None) -> bool:
    """视野矩形与多边形是否相交。"""
    geom = _parse_geojson(geojson_str)
    if not geom:
        return False
    rect_corners = [(w, s), (e, s), (e, n), (w, n)]
    rect_edges = [
        (rect_corners[0], rect_corners[1]),
        (rect_corners[1], rect_corners[2]),
        (rect_corners[2], rect_corners[3]),
        (rect_corners[3], rect_corners[0]),
    ]
    for ring in _outer_rings(geom):
        # 1. 多边形顶点在矩形内
        if any(_rect_contains_point(w, s, e, n, x, y) for x, y in ring):
            return True
        # 2. 矩形角点在多边形内
        if any(_point_in_ring(cx, cy, ring) for cx, cy in rect_corners):
            return True
        # 3. 边相交
        ring_edges = [(ring[i], ring[i + 1]) for i in range(len(ring) - 1)]
        for re_pt1, re_pt2 in rect_edges:
            for pe_pt1, pe_pt2 in ring_edges:
                if _segments_intersect(re_pt1, re_pt2, pe_pt1, pe_pt2):
                    return True
    return False


def rect_intersects_circle(w, s, e, n, cx, cy, radius_km) -> bool:
    """视野矩形与圆是否相交。"""
    # 圆心在矩形内
    if _rect_contains_point(w, s, e, n, cx, cy):
        return True
    # 圆心到矩形最近边的距离（经纬度近似转 km）
    # 纬度 1° ≈ 111km，经度 1° ≈ 111 * cos(lat)
    cos_lat = math.cos(math.radians(cy))
    nearest_lng = max(w, min(cx, e))
    nearest_lat = max(s, min(cy, n))
    dlng = (cx - nearest_lng) * 111.0 * cos_lat
    dlat = (cy - nearest_lat) * 111.0
    dist_km = math.sqrt(dlng * dlng + dlat * dlat)
    return dist_km <= radius_km


def rect_hits_target(w, s, e, n, poi) -> bool:
    """困难模式：视野矩形是否命中目标范围（有一部分进入视野即命中）。"""
    shape = getattr(poi, "shape_type", "point") or "point"
    if shape == "polygon":
        geojson = getattr(poi, "area_geojson", None)
        if geojson:
            return rect_intersects_polygon(w, s, e, n, geojson)
        # geojson 缺失，回退到点判定
    if shape == "circle" and (getattr(poi, "radius_km", 0) or 0) > 0:
        return rect_intersects_circle(w, s, e, n, poi.lng, poi.lat, poi.radius_km)
    # point：目标点在视野框内
    return _rect_contains_point(w, s, e, n, poi.lng, poi.lat)


# ===== 距离提示 =====

def distance_to_target_edge(lng: float, lat: float, poi) -> float:
    """点击点到目标范围边界的最近距离（km）。

    - polygon：点到多边形最近边的精确距离（非仅顶点）
    - circle：max(0, 点到圆心距离 - 半径)
    - point：点到目标点距离
    """
    from .game import haversine_km
    shape = getattr(poi, "shape_type", "point") or "point"
    if shape == "polygon":
        geojson = getattr(poi, "area_geojson", None)
        if geojson:
            return distance_to_polygon_edge_km(lng, lat, geojson)
        # geojson 缺失，回退到点距离
    if shape == "circle" and (getattr(poi, "radius_km", 0) or 0) > 0:
        return max(0.0, haversine_km(lng, lat, poi.lng, poi.lat) - poi.radius_km)
    return haversine_km(lng, lat, poi.lng, poi.lat)


# ===== 目标形态序列化（供前端结算展示） =====

def target_shape_dict(poi) -> dict:
    """返回目标形态信息，附加在命中/放弃响应中下发前端。"""
    shape = getattr(poi, "shape_type", "point") or "point"
    info: dict = {
        "type": shape if shape in ("point", "circle", "polygon") else "point",
        "lng": poi.lng,
        "lat": poi.lat,
    }
    if shape == "circle":
        info["radius_km"] = getattr(poi, "radius_km", 0) or 0
    elif shape == "polygon":
        geom = _parse_geojson(getattr(poi, "area_geojson", None))
        if geom:
            info["geojson"] = geom
    return info
