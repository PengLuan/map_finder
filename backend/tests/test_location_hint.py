"""location-hint bbox 反查测试。"""
import pytest

from app.services.game import game_service


def test_location_hint_bbox_match(make_region, make_game, db_session):
    """view 在某省 bbox 内，current_province 命中。"""
    make_region(code="110000000000", name="北京市", level=1,
                bbox_w=115.0, bbox_s=39.0, bbox_e=117.0, bbox_n=41.0)
    game = make_game(difficulty="hard", device="pc",
                     view_lng=116.4, view_lat=39.9)
    result = game_service.get_location_hint(db_session, game.id, "province")
    assert result["current_province"] == "北京市"


def test_location_hint_in_target_province(make_region, make_poi, make_game, db_session):
    """view 在目标省份，in_target_province=True。"""
    make_region(code="110000000000", name="北京市", level=1,
                bbox_w=115.0, bbox_s=39.0, bbox_e=117.0, bbox_n=41.0)
    poi = make_poi(lng=116.4, lat=39.9, adcode="110000")
    game = make_game(difficulty="hard", device="pc",
                     target_lng=116.4, target_lat=39.9,
                     view_lng=116.4, view_lat=39.9, poi=poi)
    result = game_service.get_location_hint(db_session, game.id, "province")
    assert result["current_province"] == "北京市"
    assert result["in_target_province"] is True


def test_location_hint_not_in_target_province(make_region, make_poi, make_game, db_session):
    """view 不在目标省份，in_target_province=False。"""
    make_region(code="110000000000", name="北京市", level=1,
                bbox_w=115.0, bbox_s=39.0, bbox_e=117.0, bbox_n=41.0)
    make_region(code="320000000000", name="江苏省", level=1,
                bbox_w=116.0, bbox_s=30.0, bbox_e=122.0, bbox_n=35.0)
    poi = make_poi(lng=116.4, lat=39.9, adcode="110000")
    # view 在江苏 bbox 内
    game = make_game(difficulty="hard", device="pc",
                     target_lng=116.4, target_lat=39.9,
                     view_lng=118.0, view_lat=32.0, poi=poi)
    result = game_service.get_location_hint(db_session, game.id, "province")
    assert result["current_province"] == "江苏省"
    assert result["in_target_province"] is False


def test_location_hint_no_bbox_fallback_nearest(make_region, make_game, db_session):
    """bbox 为空时回退到 lng/lat 最近匹配。"""
    make_region(code="110000000000", name="北京市", level=1,
                lng=116.4, lat=39.9)
    make_region(code="320000000000", name="江苏省", level=1,
                lng=118.8, lat=32.0)
    game = make_game(difficulty="hard", device="pc",
                     view_lng=116.5, view_lat=39.8)
    result = game_service.get_location_hint(db_session, game.id, "province")
    assert result["current_province"] == "北京市"


def test_location_hint_city_stage(make_region, make_game, db_session):
    """stage=city 返回 current_city。"""
    make_region(code="110000000000", name="北京市", level=1,
                bbox_w=115.0, bbox_s=39.0, bbox_e=117.0, bbox_n=41.0)
    make_region(code="110100000000", name="北京市辖区", level=2,
                parent_code="110000000000",
                bbox_w=115.5, bbox_s=39.5, bbox_e=116.8, bbox_n=40.5)
    game = make_game(difficulty="hard", device="pc",
                     view_lng=116.4, view_lat=39.9)
    result = game_service.get_location_hint(db_session, game.id, "city")
    assert result["current_province"] == "北京市"
    assert result["current_city"] == "北京市辖区"


def test_location_hint_no_regions_returns_none(make_game, db_session):
    """无 region 数据时 current_province 为 None。"""
    game = make_game(difficulty="hard", device="pc",
                     view_lng=116.4, view_lat=39.9)
    result = game_service.get_location_hint(db_session, game.id, "province")
    assert result["current_province"] is None
    assert result["in_target_province"] is False


def test_location_hint_invalid_stage(make_game, db_session):
    """无效 stage 抛 ValueError。"""
    game = make_game(difficulty="hard", device="pc")
    with pytest.raises(ValueError):
        game_service.get_location_hint(db_session, game.id, "invalid")


def test_location_hint_http_route(client, make_region, make_game, db_session):
    """HTTP 路由 location-hint 正常返回。"""
    make_region(code="110000000000", name="北京市", level=1,
                bbox_w=115.0, bbox_s=39.0, bbox_e=117.0, bbox_n=41.0)
    game = make_game(difficulty="hard", device="pc",
                     view_lng=116.4, view_lat=39.9)
    resp = client.get(f"/api/game/{game.id}/location-hint?stage=province")
    assert resp.status_code == 200
    data = resp.json()
    assert data["current_province"] == "北京市"
