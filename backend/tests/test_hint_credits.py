"""get_hint 简单模式方向提示、配额、积分扣减、_calc_score 加成测试。"""
import pytest

from app.services.game import HintForbiddenError, game_service


# ===== 简单模式方向提示（level 2/4 合并）=====

def test_easy_direction_hint_repeatable_within_quota(make_game, db_session):
    """简单模式 level 2 可反复调用直到配额（PC 3 次）。"""
    game = make_game(difficulty="easy", device="pc")
    for _ in range(3):
        result = game_service.get_hint(db_session, game.id, 2)
        assert result["hint_level"] == 2
        assert "方向" in result["content"]
        assert "bounds" not in result
    # 第 4 次应超配额
    with pytest.raises(HintForbiddenError):
        game_service.get_hint(db_session, game.id, 2)


def test_easy_direction_hint_level4_no_bounds(make_game, db_session):
    """简单模式 level 4 不返回 bounds，返回方向文案。"""
    game = make_game(difficulty="easy", device="pc")
    result = game_service.get_hint(db_session, game.id, 4)
    assert "bounds" not in result
    assert "方向" in result["content"]


def test_easy_direction_hint_quota_mobile(make_game, db_session):
    """移动端简单方向提示配额 10 次。"""
    game = make_game(difficulty="easy", device="mobile")
    for _ in range(10):
        game_service.get_hint(db_session, game.id, 2)
    with pytest.raises(HintForbiddenError):
        game_service.get_hint(db_session, game.id, 2)


def test_easy_direction_hint_does_not_advance_hint_level(make_game, db_session):
    """简单模式方向提示不推进 hint_level，level 1 仍可解锁。"""
    game = make_game(difficulty="easy", device="pc")
    game_service.get_hint(db_session, game.id, 2)
    db_session.refresh(game)
    assert game.hint_level == 0
    # level 1 仍可解锁
    result = game_service.get_hint(db_session, game.id, 1)
    assert result["hint_level"] == 1


def test_easy_direction_hint_credits_deduction(make_game, db_session):
    """简单模式 PC 每次方向提示扣 10 积分。"""
    game = make_game(difficulty="easy", device="pc")
    game_service.get_hint(db_session, game.id, 2)
    db_session.refresh(game)
    assert game.hint_credits == 90
    assert game.easy_dir_hint_count == 1


def test_easy_direction_hint_mobile_cost(make_game, db_session):
    """移动端简单方向提示每次扣 5。"""
    game = make_game(difficulty="easy", device="mobile")
    game_service.get_hint(db_session, game.id, 2)
    db_session.refresh(game)
    assert game.hint_credits == 95


# ===== 积分不足 =====

def test_hint_credits_insufficient_raises(make_game, db_session):
    """积分不足抛 HintForbiddenError。"""
    game = make_game(difficulty="easy", device="pc", hint_credits=5)
    # 简单方向提示 PC 扣 10，5 < 10
    with pytest.raises(HintForbiddenError):
        game_service.get_hint(db_session, game.id, 2)


def test_hint_credits_zero_raises(make_game, db_session):
    """积分归零后主动提示被拒。"""
    game = make_game(difficulty="hard", device="pc", hint_credits=0)
    with pytest.raises(HintForbiddenError):
        game_service.get_hint(db_session, game.id, 1)


# ===== 困难模式 =====

def test_hard_mode_level4_returns_bounds(make_game, db_session):
    """困难模式 level 4 返回 bounds。"""
    game = make_game(difficulty="hard", device="pc")
    result = game_service.get_hint(db_session, game.id, 4)
    assert "bounds" in result
    assert "west" in result["bounds"]


def test_hard_mode_monotonic_check(make_game, db_session):
    """困难模式保留单调递增校验。"""
    game = make_game(difficulty="hard", device="pc")
    game_service.get_hint(db_session, game.id, 2)
    # 再请求 level 2 应失败
    with pytest.raises(ValueError):
        game_service.get_hint(db_session, game.id, 2)


def test_hard_mode_level1_credits(make_game, db_session):
    """困难模式 level 1 PC 扣 5。"""
    game = make_game(difficulty="hard", device="pc")
    game_service.get_hint(db_session, game.id, 1)
    db_session.refresh(game)
    assert game.hint_credits == 95


def test_response_contains_hint_credits(make_game, db_session):
    """响应包含扣减后剩余 hint_credits。"""
    game = make_game(difficulty="hard", device="pc")
    result = game_service.get_hint(db_session, game.id, 1)
    assert result["hint_credits"] == 95


# ===== _calc_score 剩余积分加成 =====

def test_calc_score_credits_bonus(make_game, db_session):
    """_calc_score 含剩余积分×0.5 加成，移除原 level3/4 扣分。"""
    game = make_game(difficulty="hard", device="pc", hint_credits=100)
    # 触发 level 4（困难模式），原逻辑会 -40，新逻辑不扣分
    game_service.get_hint(db_session, game.id, 4)
    db_session.refresh(game)
    # 剩余积分 = 100 - 35 = 65
    assert game.hint_credits == 65
    elapsed = 10  # 极少用时
    score = game_service._calc_score(game, elapsed)
    # 基础 100 + 时间加成(≤50) + 距离惩罚 0 + 65*0.5=32.5→32
    # 时间加成: national limit 300, saved 290, (290//10)*5=145 → min 50
    assert score == 100 + 50 + 32


def test_calc_score_floor_ten(make_game, db_session):
    """_calc_score 保底 10。"""
    game = make_game(difficulty="hard", device="pc", hint_credits=0)
    # 大量移动距离造成负分
    game.total_distance_km = 100000
    elapsed = 1000
    score = game_service._calc_score(game, elapsed)
    assert score == 10


# ===== HTTP 层 403 验证 =====

def test_hint_quota_exceeded_returns_403(client, make_game, db_session):
    """配额超限通过 HTTP 返回 403。"""
    game = make_game(difficulty="easy", device="pc", easy_dir_hint_count=3)
    resp = client.post("/api/game/hint", json={"game_id": game.id, "hint_level": 2})
    assert resp.status_code == 403


def test_hint_insufficient_credits_returns_403(client, make_game, db_session):
    """积分不足通过 HTTP 返回 403。"""
    game = make_game(difficulty="hard", device="pc", hint_credits=0)
    resp = client.post("/api/game/hint", json={"game_id": game.id, "hint_level": 1})
    assert resp.status_code == 403
