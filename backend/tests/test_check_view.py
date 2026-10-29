"""check_view 未命中返回 distance_bucket 测试。"""
from app.services.game import game_service


def test_check_view_miss_returns_distance_bucket(make_game, db_session):
    """困难模式未命中返回 distance_bucket。"""
    game = make_game(difficulty="hard", device="pc",
                     target_lng=116.4, target_lat=39.9,
                     view_lng=110.0, view_lat=35.0)
    # 视野框远离目标
    result = game_service.check_view(db_session, game.id, 109.0, 34.0, 111.0, 36.0)
    assert result["hit"] is False
    assert "distance_bucket" in result
    assert isinstance(result["distance_bucket"], str)


def test_check_view_easy_mode_no_distance_bucket(make_game, db_session):
    """简单模式 check_view 不判定，仅返回 hit=False（无 distance_bucket）。"""
    game = make_game(difficulty="easy", device="pc")
    result = game_service.check_view(db_session, game.id, 109.0, 34.0, 111.0, 36.0)
    assert result == {"hit": False}


def test_check_view_distance_bucket_is_coarse(make_game, db_session):
    """distance_bucket 是区间字符串（防三角定位）。"""
    game = make_game(difficulty="hard", device="pc",
                     target_lng=116.4, target_lat=39.9,
                     view_lng=110.0, view_lat=35.0)
    result = game_service.check_view(db_session, game.id, 109.9, 34.9, 110.1, 35.1)
    bucket = result["distance_bucket"]
    # 应为 distance_bucket 的某一档
    assert bucket in ("1km 以内", "1-5km", "5-20km", "20-100km",
                      "100-300km", "300km+")


def test_check_view_circle_target_distance_bucket(make_game, make_poi, db_session):
    """圆形目标未命中返回 distance_bucket。"""
    poi = make_poi(lng=116.4, lat=39.9, shape_type="circle", radius_km=1.0)
    game = make_game(difficulty="hard", device="pc",
                     target_lng=116.4, target_lat=39.9,
                     view_lng=120.0, view_lat=40.0, poi=poi)
    result = game_service.check_view(db_session, game.id, 119.0, 39.5, 121.0, 40.5)
    assert result["hit"] is False
    assert "distance_bucket" in result


def test_pk_check_view_miss_returns_distance_bucket(make_game, db_session):
    """PK check_view 未命中也返回 distance_bucket（间接验证 pk service）。"""
    from app.models import PKGame, PKRoom, User
    from app.services.pk import pk_service

    # 创建用户
    host = User(nickname="host")
    guest = User(nickname="guest")
    db_session.add_all([host, guest])
    db_session.commit()
    db_session.refresh(host)
    db_session.refresh(guest)

    room = PKRoom(room_code="ABCD", host_user_id=host.id, guest_user_id=guest.id,
                  mode="national", difficulty="hard")
    db_session.add(room)
    db_session.commit()
    db_session.refresh(room)

    game = PKGame(
        room_id=room.id,
        target_poi_id=None,
        target_lng=116.4, target_lat=39.9,
        player1_user_id=host.id, player2_user_id=guest.id,
        player1_view_lng=110.0, player1_view_lat=35.0,
        player2_view_lng=110.0, player2_view_lat=35.0,
    )
    db_session.add(game)
    db_session.commit()
    db_session.refresh(game)

    result = pk_service.check_view(db_session, game.id, host.id,
                                   109.0, 34.0, 111.0, 36.0)
    assert result["hit"] is False
    assert "distance_bucket" in result
