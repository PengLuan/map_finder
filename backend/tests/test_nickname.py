# -*- coding: utf-8 -*-
"""昵称唯一性与大小写敏感测试。

验收项：
- BIZ-09 昵称沿用：注册时查最近 30 天 session 的 nickname 作为候选
- BIZ-10 昵称大小写敏感："哈哈A" ≠ "哈哈a"

注意：SQLite 默认 TEXT 比较是二进制（大小写敏感），与 MySQL utf8mb4_bin 一致，
故这些测试在 SQLite 下能反映大小写敏感行为。
"""
import pytest

from app.models import User
from app.services.auth import (
    check_nickname_unique,
    generate_nickname_suggestions,
)


def test_nickname_case_sensitive(db_session):
    """大小写敏感：哈哈A 与 哈哈a 是两个不同用户。"""
    db_session.add(User(email="a@x.com", nickname="哈哈A"))
    db_session.commit()
    db_session.add(User(email="b@x.com", nickname="哈哈a"))
    db_session.commit()  # 不应报错（大小写敏感）
    assert db_session.query(User).count() == 2


def test_check_nickname_unique_case_sensitive(db_session):
    """check_nickname_unique 大小写敏感。"""
    db_session.add(User(email="a@x.com", nickname="哈哈A"))
    db_session.commit()
    assert check_nickname_unique(db_session, "哈哈A") is False  # 已占用
    assert check_nickname_unique(db_session, "哈哈a") is True   # 可用


def test_generate_suggestions(db_session):
    """昵称冲突时生成 3-5 个推荐昵称，且均未占用。"""
    db_session.add(User(email="a@x.com", nickname="张三"))
    db_session.commit()
    suggestions = generate_nickname_suggestions(db_session, "张三")
    assert len(suggestions) >= 3
    for s in suggestions:
        assert s != "张三"
        assert check_nickname_unique(db_session, s) is True


def test_generate_suggestions_default_base(db_session):
    """base 为空时兜底为"旅行者"。"""
    suggestions = generate_nickname_suggestions(db_session, "")
    assert len(suggestions) >= 1
    for s in suggestions:
        assert check_nickname_unique(db_session, s) is True


def test_nickname_length_validation(db_session):
    """昵称长度校验：2-16 个字符。"""
    assert check_nickname_unique(db_session, "a") is False   # 太短（<2）
    assert check_nickname_unique(db_session, "ab") is True   # 合法
    long_name = "a" * 17
    assert check_nickname_unique(db_session, long_name) is False  # 太长（>16）


def test_unique_constraint_case_sensitive(db_session):
    """User.nickname 唯一约束大小写敏感。"""
    db_session.add(User(email="a@x.com", nickname="TestUser"))
    db_session.commit()
    # 同名（大小写一致）应被唯一约束拒绝
    db_session.add(User(email="b@x.com", nickname="TestUser"))
    with pytest.raises(Exception):
        db_session.commit()
    db_session.rollback()
    # 不同大小写应允许
    db_session.add(User(email="c@x.com", nickname="testuser"))
    db_session.commit()
