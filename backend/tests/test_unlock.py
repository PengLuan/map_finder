# -*- coding: utf-8 -*-
"""专题星级解锁逻辑测试。

验收项：BIZ-05 星级解锁
- ★1 默认开放
- 其余需完成 N 个前一星级专题（任意模式均算通关）
"""
from datetime import datetime, timedelta

from app.models import (
    Collection,
    CollectionPoi,
    Medal,
    PlayerSession,
    POI,
    UserMedal,
)
from app.services.collection_service import is_unlocked


def test_star1_always_unlocked(db_session, sample_user, star1_collection):
    """★1 默认开放。"""
    assert is_unlocked(db_session, sample_user, star1_collection) is True


def test_star2_locked_without_completion(db_session, sample_user, sample_collection):
    """★2 未完成任何 ★1 时锁定。"""
    assert is_unlocked(db_session, sample_user, sample_collection) is False


def test_star2_unlocked_after_enough_star1(
    db_session, sample_user, sample_collection, star1_collection, make_collection
):
    """完成足够 ★1 后 ★2 解锁（勋章算通关）。"""
    # ★2 需要 2 个 ★1，先完成 1 个（写 user_medal）
    medal = db_session.query(Medal).filter_by(
        collection_id=star1_collection.id, difficulty="hard", game_type="solo"
    ).first()
    db_session.add(UserMedal(
        user_id=sample_user.id, medal_id=medal.id,
        total_time_sec=300,
    ))
    db_session.commit()
    assert is_unlocked(db_session, sample_user, sample_collection) is False

    # 再加 1 个 ★1 专题完成（用 make_collection 建一个新 ★1）
    coll2 = make_collection(
        code="lake5", name="五大淡水湖", star=1, unlock_require=0,
    )
    medal2 = db_session.query(Medal).filter_by(collection_id=coll2.id).first()
    db_session.add(UserMedal(
        user_id=sample_user.id, medal_id=medal2.id,
        total_time_sec=400,
    ))
    db_session.commit()
    assert is_unlocked(db_session, sample_user, sample_collection) is True


def test_easy_completion_counts_via_player_sessions(
    db_session, sample_user, sample_collection, star1_collection, make_collection
):
    """easy 模式不发勋章，但写 player_sessions 后算通关（解锁依据）。

    is_unlocked 同时查 user_medals（hard 完成）和 player_sessions（任意完成）。
    """
    # 用 player_sessions 记录 1 个 ★1 完成（模拟 easy 通关）
    db_session.add(PlayerSession(
        session_id="sess-test", ip="127.0.0.1",
        nickname=sample_user.nickname,
        mode="national", difficulty="easy", game_type="solo",
        won=True, collection_id=star1_collection.id, point_index=0,
    ))
    db_session.commit()
    # ★2 需要 2 个 ★1，只完成 1 个
    assert is_unlocked(db_session, sample_user, sample_collection) is False

    # 再完成第 2 个 ★1（用 make_collection 建一个新 ★1 + player_session）
    coll2 = make_collection(
        code="lake5", name="五大淡水湖", star=1, unlock_require=0,
    )
    db_session.add(PlayerSession(
        session_id="sess-test", ip="127.0.0.1",
        nickname=sample_user.nickname,
        mode="national", difficulty="easy", game_type="solo",
        won=True, collection_id=coll2.id, point_index=0,
    ))
    db_session.commit()
    assert is_unlocked(db_session, sample_user, sample_collection) is True


def test_unlocked_for_anonymous_with_session(
    db_session, sample_collection, star1_collection, make_collection
):
    """未登录用户按 session_id 聚合：完成足够 ★1 后解锁 ★2。"""
    coll2 = make_collection(
        code="lake5", name="五大淡水湖", star=1, unlock_require=0,
    )
    # 用同一 session_id 完成 2 个 ★1
    for cid in (star1_collection.id, coll2.id):
        db_session.add(PlayerSession(
            session_id="anon-sess", ip="127.0.0.1",
            mode="national", difficulty="easy", game_type="solo",
            won=True, collection_id=cid, point_index=0,
        ))
    db_session.commit()
    assert is_unlocked(db_session, None, sample_collection, session_id="anon-sess") is True


def test_unlock_require_field_overrides_default(
    db_session, sample_user, sample_collection, star1_collection, make_collection
):
    """unlock_require 字段优先于 DEFAULT_REQUIRE。"""
    # sample_collection.unlock_require=2，完成 1 个 ★1 仍锁定
    medal = db_session.query(Medal).filter_by(
        collection_id=star1_collection.id, difficulty="hard", game_type="solo"
    ).first()
    db_session.add(UserMedal(
        user_id=sample_user.id, medal_id=medal.id, total_time_sec=300,
    ))
    db_session.commit()
    assert is_unlocked(db_session, sample_user, sample_collection) is False
