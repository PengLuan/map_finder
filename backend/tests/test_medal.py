# -*- coding: utf-8 -*-
"""勋章发放与刷新逻辑测试。

验收项：
- BIZ-04 勋章规则：hard 发勋章，easy 只解锁不发
- BIZ-08 重玩刷新：重复完成刷新最快用时，不重复发勋章
"""
from app.models import Medal, MedalRecord, UserMedal
from app.services.collection_service import award_medal


def _get_medal(db_session, collection_id, difficulty="hard", game_type="solo"):
    return db_session.query(Medal).filter_by(
        collection_id=collection_id, difficulty=difficulty, game_type=game_type
    ).first()


def test_hard_solo_awards_medal(db_session, sample_user, sample_collection):
    """hard solo 完成发勋章。"""
    medal = _get_medal(db_session, sample_collection.id, "hard", "solo")
    awarded = award_medal(db_session, user=sample_user, medal=medal,
                         total_time_sec=600, point_times=[100, 120, 150, 130, 100])
    assert awarded is True
    um = db_session.query(UserMedal).filter_by(
        user_id=sample_user.id, medal_id=medal.id
    ).first()
    assert um is not None
    assert um.total_time_sec == 600


def test_easy_does_not_award_medal(db_session, sample_user, sample_collection):
    """easy 完成不发勋章。"""
    medal = _get_medal(db_session, sample_collection.id, "easy", "solo")
    awarded = award_medal(db_session, user=sample_user, medal=medal,
                         total_time_sec=500, point_times=[100, 100, 100, 100, 100])
    assert awarded is False
    um = db_session.query(UserMedal).filter_by(
        user_id=sample_user.id, medal_id=medal.id
    ).first()
    assert um is None


def test_faster_time_updates_medal(db_session, sample_user, sample_collection):
    """更快用时刷新勋章（保留最快）。"""
    medal = _get_medal(db_session, sample_collection.id, "hard", "solo")
    # 第一次 600 秒
    award_medal(db_session, user=sample_user, medal=medal,
                total_time_sec=600, point_times=[])
    # 第二次 500 秒（更快）
    award_medal(db_session, user=sample_user, medal=medal,
                total_time_sec=500, point_times=[])
    um = db_session.query(UserMedal).filter_by(
        user_id=sample_user.id, medal_id=medal.id
    ).first()
    assert um.total_time_sec == 500  # 取更快值
    # 流水表应有 2 条
    records = db_session.query(MedalRecord).filter_by(
        user_id=sample_user.id, medal_id=medal.id
    ).all()
    assert len(records) == 2


def test_slower_time_does_not_update(db_session, sample_user, sample_collection):
    """更慢用时不刷新、不写流水。"""
    medal = _get_medal(db_session, sample_collection.id, "hard", "solo")
    award_medal(db_session, user=sample_user, medal=medal,
                total_time_sec=500, point_times=[])
    award_medal(db_session, user=sample_user, medal=medal,
                total_time_sec=700, point_times=[])
    um = db_session.query(UserMedal).filter_by(
        user_id=sample_user.id, medal_id=medal.id
    ).first()
    assert um.total_time_sec == 500  # 仍是更快的值
    # 流水表只有 1 条（更慢的不写流水）
    records = db_session.query(MedalRecord).filter_by(
        user_id=sample_user.id, medal_id=medal.id
    ).all()
    assert len(records) == 1


def test_total_medals_count_increment(db_session, sample_user, sample_collection):
    """users.total_medals 冗余字段随新勋章递增。"""
    medal = _get_medal(db_session, sample_collection.id, "hard", "solo")
    award_medal(db_session, user=sample_user, medal=medal,
                total_time_sec=600, point_times=[])
    db_session.refresh(sample_user)
    assert sample_user.total_medals == 1
    # 再发一枚不同勋章（hard pk）
    medal_pk = _get_medal(db_session, sample_collection.id, "hard", "pk")
    award_medal(db_session, user=sample_user, medal=medal_pk,
                total_time_sec=700, point_times=[])
    db_session.refresh(sample_user)
    assert sample_user.total_medals == 2


def test_replay_same_medal_no_duplicate(db_session, sample_user, sample_collection):
    """重复完成同一勋章不重复发（user_medals 唯一约束 + 取最快）。"""
    medal = _get_medal(db_session, sample_collection.id, "hard", "solo")
    award_medal(db_session, user=sample_user, medal=medal,
                total_time_sec=600, point_times=[])
    award_medal(db_session, user=sample_user, medal=medal,
                total_time_sec=550, point_times=[])
    # 仍只有 1 条 user_medal
    ums = db_session.query(UserMedal).filter_by(
        user_id=sample_user.id, medal_id=medal.id
    ).all()
    assert len(ums) == 1
    assert ums[0].total_time_sec == 550
    db_session.refresh(sample_user)
    assert sample_user.total_medals == 1  # 不重复计数
