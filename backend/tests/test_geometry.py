"""geometry 三种形态判定与距离提示测试。"""
from types import SimpleNamespace

from app.services import geometry


def _poi(lng=116.4, lat=39.9, shape_type="point", radius_km=0.0, area_geojson=None):
    return SimpleNamespace(lng=lng, lat=lat, shape_type=shape_type,
                           radius_km=radius_km, area_geojson=area_geojson)


# ===== point_hits_target =====

def test_point_hits_target_point_within_threshold():
    poi = _poi(lng=116.40, lat=39.90, shape_type="point")
    # 距离极小，命中
    assert geometry.point_hits_target(116.4001, 39.9001, poi) is True


def test_point_hits_target_point_beyond_threshold():
    poi = _poi(lng=116.40, lat=39.90, shape_type="point")
    # 距离 > 0.5km
    assert geometry.point_hits_target(116.50, 39.90, poi) is False


def test_point_hits_target_circle_inside():
    poi = _poi(lng=116.40, lat=39.90, shape_type="circle", radius_km=10.0)
    assert geometry.point_hits_target(116.41, 39.91, poi) is True


def test_point_hits_target_circle_outside():
    poi = _poi(lng=116.40, lat=39.90, shape_type="circle", radius_km=1.0)
    # 距离约 100km，超出半径
    assert geometry.point_hits_target(117.0, 39.90, poi) is False


def test_point_hits_target_polygon_inside():
    # 简单正方形多边形
    geojson = '{"type":"Polygon","coordinates":[[[116.0,39.0],[117.0,39.0],[117.0,40.0],[116.0,40.0],[116.0,39.0]]]}'
    poi = _poi(lng=116.5, lat=39.5, shape_type="polygon", area_geojson=geojson)
    assert geometry.point_hits_target(116.5, 39.5, poi) is True


def test_point_hits_target_polygon_outside():
    geojson = '{"type":"Polygon","coordinates":[[[116.0,39.0],[117.0,39.0],[117.0,40.0],[116.0,40.0],[116.0,39.0]]]}'
    poi = _poi(lng=116.5, lat=39.5, shape_type="polygon", area_geojson=geojson)
    assert geometry.point_hits_target(118.0, 39.5, poi) is False


# ===== rect_hits_target =====

def test_rect_hits_target_point_inside():
    poi = _poi(lng=116.4, lat=39.9, shape_type="point")
    assert geometry.rect_hits_target(116.0, 39.0, 117.0, 40.0, poi) is True


def test_rect_hits_target_point_outside():
    poi = _poi(lng=116.4, lat=39.9, shape_type="point")
    assert geometry.rect_hits_target(110.0, 30.0, 111.0, 31.0, poi) is False


def test_rect_hits_target_circle_intersect():
    poi = _poi(lng=116.4, lat=39.9, shape_type="circle", radius_km=50.0)
    # 矩形与圆相交
    assert geometry.rect_hits_target(116.0, 39.0, 116.3, 39.5, poi) is True


def test_rect_hits_target_circle_disjoint():
    poi = _poi(lng=116.4, lat=39.9, shape_type="circle", radius_km=1.0)
    assert geometry.rect_hits_target(110.0, 30.0, 111.0, 31.0, poi) is False


def test_rect_hits_target_polygon_intersect():
    geojson = '{"type":"Polygon","coordinates":[[[116.0,39.0],[117.0,39.0],[117.0,40.0],[116.0,40.0],[116.0,39.0]]]}'
    poi = _poi(lng=116.5, lat=39.5, shape_type="polygon", area_geojson=geojson)
    # 矩形与多边形重叠
    assert geometry.rect_hits_target(116.5, 39.5, 116.8, 39.8, poi) is True


def test_rect_hits_target_polygon_disjoint():
    geojson = '{"type":"Polygon","coordinates":[[[116.0,39.0],[117.0,39.0],[117.0,40.0],[116.0,40.0],[116.0,39.0]]]}'
    poi = _poi(lng=116.5, lat=39.5, shape_type="polygon", area_geojson=geojson)
    assert geometry.rect_hits_target(110.0, 30.0, 111.0, 31.0, poi) is False


def test_rect_hits_target_polygon_feature_wrap():
    """Leaflet toGeoJSON 输出 Feature 包装，应能正确判定。"""
    geojson = ('{"type":"Feature","geometry":{"type":"Polygon",'
               '"coordinates":[[[116.0,39.0],[117.0,39.0],[117.0,40.0],[116.0,40.0],[116.0,39.0]]]},"properties":{}}')
    poi = _poi(lng=116.5, lat=39.5, shape_type="polygon", area_geojson=geojson)
    # 视野完全包含多边形
    assert geometry.rect_hits_target(115.0, 38.0, 118.0, 41.0, poi) is True
    # 视野与多边形交叉
    assert geometry.rect_hits_target(116.5, 39.5, 116.8, 39.8, poi) is True
    # 视野不相交
    assert geometry.rect_hits_target(110.0, 30.0, 111.0, 31.0, poi) is False


# ===== distance_to_target_edge =====

def test_distance_to_target_edge_point():
    poi = _poi(lng=116.40, lat=39.90, shape_type="point")
    d = geometry.distance_to_target_edge(116.50, 39.90, poi)
    # 约 8.7km
    assert 5 < d < 15


def test_distance_to_target_edge_circle_outside():
    poi = _poi(lng=116.40, lat=39.90, shape_type="circle", radius_km=10.0)
    d = geometry.distance_to_target_edge(116.50, 39.90, poi)
    # 到圆心约 8.7km，减去半径 10，应 ≤0（实际返回 0）
    assert d == 0.0


def test_distance_to_target_edge_circle_far():
    poi = _poi(lng=116.40, lat=39.90, shape_type="circle", radius_km=1.0)
    d = geometry.distance_to_target_edge(117.00, 39.90, poi)
    # 到圆心约 52km，减半径 1
    assert 40 < d < 70


def test_distance_to_target_edge_polygon_inside():
    geojson = '{"type":"Polygon","coordinates":[[[116.0,39.0],[117.0,39.0],[117.0,40.0],[116.0,40.0],[116.0,39.0]]]}'
    poi = _poi(lng=116.5, lat=39.5, shape_type="polygon", area_geojson=geojson)
    # 点在多边形内，距离 0
    assert geometry.distance_to_target_edge(116.5, 39.5, poi) == 0.0


def test_distance_to_target_edge_polygon_outside():
    geojson = '{"type":"Polygon","coordinates":[[[116.0,39.0],[117.0,39.0],[117.0,40.0],[116.0,40.0],[116.0,39.0]]]}'
    poi = _poi(lng=116.5, lat=39.5, shape_type="polygon", area_geojson=geojson)
    d = geometry.distance_to_target_edge(118.0, 39.5, poi)
    assert d > 0


def test_target_shape_dict_point():
    poi = _poi(lng=116.4, lat=39.9, shape_type="point")
    info = geometry.target_shape_dict(poi)
    assert info["type"] == "point"
    assert info["lng"] == 116.4
    assert info["lat"] == 39.9


def test_target_shape_dict_circle():
    poi = _poi(lng=116.4, lat=39.9, shape_type="circle", radius_km=5.0)
    info = geometry.target_shape_dict(poi)
    assert info["type"] == "circle"
    assert info["radius_km"] == 5.0


def test_target_shape_dict_polygon():
    geojson = '{"type":"Polygon","coordinates":[[[116.0,39.0],[117.0,39.0],[117.0,40.0],[116.0,40.0],[116.0,39.0]]]}'
    poi = _poi(lng=116.5, lat=39.5, shape_type="polygon", area_geojson=geojson)
    info = geometry.target_shape_dict(poi)
    assert info["type"] == "polygon"
    assert "geojson" in info
