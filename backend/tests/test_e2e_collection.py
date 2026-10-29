# -*- coding: utf-8 -*-
"""专题模式端到端测试（后端 API 全流程）。

验收项：
- API-01 ~ API-15 后端接口
- BIZ-01 顺序收集 / BIZ-02 起点继承 / BIZ-03 中途放弃
- BIZ-04 勋章规则 / BIZ-06 不登录无勋章 / BIZ-07 排行榜入榜 / BIZ-08 重玩刷新

使用 ★1 专题（jiangnan3，3 个点）测试完整流程，避免 ★2 解锁依赖。
"""
import pytest

from app.config import settings


@pytest.fixture(autouse=True)
def enable_testing_mode():
    """本模块所有测试启用测试模式（验证码固定 123456，不发邮件）。"""
    old = settings.testing
    settings.testing = True
    yield
    settings.testing = old


def _login(client, email, nickname=None):
    """走 send_code → login 流程，返回 token。"""
    resp = client.post("/api/auth/send_code", json={"email": email})
    assert resp.status_code == 200, resp.text
    payload = {"email": email, "code": "123456"}
    if nickname:
        payload["nickname"] = nickname
    resp = client.post("/api/auth/login", json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


class TestAuthE2E:
    """API-01 ~ API-05 认证接口。"""

    def test_send_code(self, client):
        """API-01 发送验证码。"""
        resp = client.post("/api/auth/send_code", json={"email": "test1@e2e.com"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_login_with_wrong_code(self, client):
        """API-02 验证码错误→401。"""
        client.post("/api/auth/send_code", json={"email": "test2@e2e.com"})
        resp = client.post("/api/auth/login", json={
            "email": "test2@e2e.com", "code": "000000",
        })
        assert resp.status_code == 401

    def test_login_new_user_with_nickname(self, client):
        """API-03 新邮箱→自动注册+昵称沿用流程。"""
        token = _login(client, "test3@e2e.com", nickname="E2E新用户")
        assert token
        # /api/auth/me 返回用户信息
        resp = client.get("/api/auth/me", headers=_headers(token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "test3@e2e.com"
        assert data["nickname"] == "E2E新用户"

    def test_check_nickname_case_sensitive(self, client, db_session):
        """API-04 大小写敏感：已注册"哈哈A"→"哈哈a"可用。"""
        from app.models import User
        db_session.add(User(email="case@e2e.com", nickname="哈哈A"))
        db_session.commit()
        # 已占用：available=False 且返回推荐
        resp = client.post("/api/auth/check_nickname", json={"nickname": "哈哈A"})
        assert resp.json()["available"] is False
        assert "suggestions" in resp.json()
        # 不同大小写：可用
        resp = client.post("/api/auth/check_nickname", json={"nickname": "哈哈a"})
        assert resp.json()["available"] is True

    def test_me_without_token(self, client):
        """API-15 未登录访问需登录接口→401。"""
        resp = client.get("/api/auth/me")
        assert resp.status_code == 401


class TestCollectionE2E:
    """API-06 ~ API-14 专题流程接口。"""

    def test_list_and_detail(self, client, seed_mvp):
        """API-06/API-07 列表+详情。"""
        # 列表
        resp = client.get("/api/collection/list")
        assert resp.status_code == 200
        groups = resp.json()["data"]["groups"]
        # 至少有 ★1 和 ★2 两个分组
        stars = [g["star"] for g in groups]
        assert 1 in stars and 2 in stars
        # jiangnan3 在 ★1 分组且已解锁
        star1_group = next(g for g in groups if g["star"] == 1)
        jiangnan3 = next(
            c for c in star1_group["collections"] if c["code"] == "jiangnan3"
        )
        assert jiangnan3["unlocked"] is True
        assert jiangnan3["point_count"] == 3

        # 详情
        resp = client.get("/api/collection/jiangnan3")
        assert resp.status_code == 200
        detail = resp.json()["data"]
        assert detail["point_count"] == 3
        assert detail["difficulty_star"] == 1
        assert len(detail["points"]) == 3
        assert detail["unlocked"] is True

    def test_start_locked_collection(self, client, seed_mvp):
        """★2 未解锁，start 应返回 400。"""
        resp = client.post("/api/collection/start", json={
            "collection_code": "wuyue", "difficulty": "hard", "game_type": "solo",
        })
        assert resp.status_code == 400
        assert "未解锁" in resp.json()["detail"]

    def test_full_flow_hard_solo(self, client, seed_mvp):
        """完整流程：登录→开始→3 点→完成→领勋章→查排行榜。

        BIZ-01 顺序收集 / BIZ-02 起点继承 / BIZ-04 hard 发勋章
        BIZ-07 排行榜入榜 / BIZ-08 重玩刷新
        """
        token = _login(client, "hard@e2e.com", nickname="Hard测试员")
        headers = _headers(token)

        # 开始 ★1 专题 jiangnan3（3 个点）
        resp = client.post("/api/collection/start", json={
            "collection_code": "jiangnan3", "difficulty": "hard", "game_type": "solo",
        }, headers=headers)
        assert resp.status_code == 200, resp.text
        start = resp.json()["data"]
        collection_id = start["collection_id"]
        assert start["point_index"] == 0
        assert start["point_count"] == 3
        assert start["target_name"] == "黄鹤楼"

        # 完成 3 个点
        point_times = []
        for i in range(3):
            resp = client.post("/api/collection/point_end", json={
                "collection_id": collection_id,
                "point_index": i,
                "time_sec": 100 + i * 20,
                "is_correct": True,
                "difficulty": "hard", "game_type": "solo",
            }, headers=headers)
            assert resp.status_code == 200, resp.text
            data = resp.json()["data"]
            point_times.append(100 + i * 20)
            if i < 2:
                assert data["has_next"] is True
                # BIZ-02 起点继承：下一点起点 = 当前置目标坐标
                assert data["next_start_lng"] is not None
                assert data["next_start_lat"] is not None
                assert data["next_target_name"] in ("岳阳楼", "滕王阁")
            else:
                assert data["has_next"] is False

        # 完成专题 → 发勋章
        resp = client.post("/api/collection/finish", json={
            "collection_id": collection_id,
            "difficulty": "hard", "game_type": "solo",
            "total_time_sec": sum(point_times),
            "point_times": point_times,
        }, headers=headers)
        assert resp.status_code == 200, resp.text
        finish = resp.json()["data"]
        assert finish["medal_awarded"] is True
        assert finish["medal_name"] is not None

        # 查勋章墙
        resp = client.get("/api/medal/wall", headers=headers)
        assert resp.status_code == 200
        medals = resp.json()["data"]
        found = False
        for g in medals:
            for m in g["medals"]:
                if (m["collection_code"] == "jiangnan3"
                        and m["difficulty"] == "hard"
                        and m["game_type"] == "solo"):
                    assert m["earned"] is True
                    found = True
        assert found

        # 查单专题排行榜
        resp = client.get("/api/collection/leaderboard", params={
            "collection_id": collection_id, "difficulty": "hard", "game_type": "solo",
        })
        assert resp.status_code == 200
        board = resp.json()["data"]
        assert len(board) > 0
        assert board[0]["nickname"] == "Hard测试员"

    def test_easy_does_not_award_medal(self, client, seed_mvp):
        """BIZ-04 easy 只解锁不发勋章。"""
        token = _login(client, "easy@e2e.com", nickname="Easy测试员")
        headers = _headers(token)

        resp = client.post("/api/collection/start", json={
            "collection_code": "jiangnan3", "difficulty": "easy", "game_type": "solo",
        }, headers=headers)
        collection_id = resp.json()["data"]["collection_id"]

        for i in range(3):
            client.post("/api/collection/point_end", json={
                "collection_id": collection_id, "point_index": i,
                "time_sec": 80, "is_correct": True,
                "difficulty": "easy", "game_type": "solo",
            }, headers=headers)

        resp = client.post("/api/collection/finish", json={
            "collection_id": collection_id, "difficulty": "easy", "game_type": "solo",
            "total_time_sec": 240, "point_times": [80, 80, 80],
        }, headers=headers)
        assert resp.json()["data"]["medal_awarded"] is False

    def test_anonymous_no_medal(self, client, seed_mvp):
        """BIZ-06 未登录完成专题无勋章。"""
        # 不带 token 开始 ★1 专题
        resp = client.post("/api/collection/start", json={
            "collection_code": "jiangnan3", "difficulty": "hard", "game_type": "solo",
            "session_id": "anon-sess",
        })
        assert resp.status_code == 200, resp.text
        collection_id = resp.json()["data"]["collection_id"]

        for i in range(3):
            client.post("/api/collection/point_end", json={
                "collection_id": collection_id, "point_index": i,
                "time_sec": 90, "is_correct": True,
                "difficulty": "hard", "game_type": "solo",
                "session_id": "anon-sess",
            })

        resp = client.post("/api/collection/finish", json={
            "collection_id": collection_id, "difficulty": "hard", "game_type": "solo",
            "total_time_sec": 270, "point_times": [90, 90, 90],
            "session_id": "anon-sess",
        })
        assert resp.json()["data"]["medal_awarded"] is False

    def test_replay_refreshes_fastest_time(self, client, seed_mvp):
        """BIZ-08 重玩刷新最快用时，不重复发勋章。"""
        token = _login(client, "replay@e2e.com", nickname="Replay测试员")
        headers = _headers(token)

        def run_once(total_sec, point_sec):
            resp = client.post("/api/collection/start", json={
                "collection_code": "jiangnan3", "difficulty": "hard", "game_type": "solo",
            }, headers=headers)
            cid = resp.json()["data"]["collection_id"]
            for i in range(3):
                client.post("/api/collection/point_end", json={
                    "collection_id": cid, "point_index": i,
                    "time_sec": point_sec, "is_correct": True,
                    "difficulty": "hard", "game_type": "solo",
                }, headers=headers)
            resp = client.post("/api/collection/finish", json={
                "collection_id": cid, "difficulty": "hard", "game_type": "solo",
                "total_time_sec": total_sec, "point_times": [point_sec] * 3,
            }, headers=headers)
            return resp.json()["data"]

        # 第一次 300 秒
        run_once(300, 100)
        # 第二次 240 秒（更快）
        run_once(240, 80)
        # 重玩应刷新最快用时
        resp = client.get("/api/medal/wall", headers=headers)
        medals = resp.json()["data"]
        found = False
        for g in medals:
            for m in g["medals"]:
                if (m["collection_code"] == "jiangnan3"
                        and m["difficulty"] == "hard"
                        and m["game_type"] == "solo"):
                    assert m["earned"] is True
                    assert m["total_time_sec"] == 240  # 取更快值
                    found = True
        assert found

    def test_leaderboards(self, client, seed_mvp):
        """API-12/13/14 排行榜三维度。"""
        # 先完成一个专题产生排行数据
        token = _login(client, "board@e2e.com", nickname="Board测试员")
        headers = _headers(token)
        resp = client.post("/api/collection/start", json={
            "collection_code": "jiangnan3", "difficulty": "hard", "game_type": "solo",
        }, headers=headers)
        cid = resp.json()["data"]["collection_id"]
        for i in range(3):
            client.post("/api/collection/point_end", json={
                "collection_id": cid, "point_index": i,
                "time_sec": 100, "is_correct": True,
                "difficulty": "hard", "game_type": "solo",
            }, headers=headers)
        client.post("/api/collection/finish", json={
            "collection_id": cid, "difficulty": "hard", "game_type": "solo",
            "total_time_sec": 300, "point_times": [100, 100, 100],
        }, headers=headers)

        # 单专题排行
        resp = client.get("/api/collection/leaderboard", params={
            "scope": "single", "collection_id": cid,
            "difficulty": "hard", "game_type": "solo",
        })
        assert resp.status_code == 200
        board = resp.json()["data"]
        assert any(r["nickname"] == "Board测试员" for r in board)

        # 总榜
        resp = client.get("/api/collection/leaderboard", params={
            "scope": "total", "limit": 10,
        })
        assert resp.status_code == 200
        total_board = resp.json()["data"]
        assert any(r["nickname"] == "Board测试员" for r in total_board)

        # 勋章数榜
        resp = client.get("/api/collection/leaderboard", params={
            "scope": "medal_count", "limit": 10,
        })
        assert resp.status_code == 200
        medal_board = resp.json()["data"]
        assert any(r["nickname"] == "Board测试员" for r in medal_board)

    def test_star2_unlocked_after_star1(self, client, seed_mvp):
        """BIZ-05 完成任意模式算通关，N 个前一星级解锁下一级。"""
        token = _login(client, "unlock@e2e.com", nickname="Unlock测试员")
        headers = _headers(token)

        # 先确认 wuyue (★2) 锁定
        resp = client.get("/api/collection/wuyue")
        assert resp.json()["data"]["unlocked"] is False

        # 完成 jiangnan3 (★1, unlock_require for wuyue is 1)
        resp = client.post("/api/collection/start", json={
            "collection_code": "jiangnan3", "difficulty": "hard", "game_type": "solo",
        }, headers=headers)
        cid = resp.json()["data"]["collection_id"]
        for i in range(3):
            client.post("/api/collection/point_end", json={
                "collection_id": cid, "point_index": i,
                "time_sec": 100, "is_correct": True,
                "difficulty": "hard", "game_type": "solo",
            }, headers=headers)
        client.post("/api/collection/finish", json={
            "collection_id": cid, "difficulty": "hard", "game_type": "solo",
            "total_time_sec": 300, "point_times": [100, 100, 100],
        }, headers=headers)

        # 现在 wuyue 应解锁
        resp = client.get("/api/collection/wuyue", headers=headers)
        assert resp.json()["data"]["unlocked"] is True

    def test_tracks(self, client, seed_mvp):
        """我的足迹接口。"""
        token = _login(client, "tracks@e2e.com", nickname="Tracks测试员")
        headers = _headers(token)
        # 完成一个专题
        resp = client.post("/api/collection/start", json={
            "collection_code": "jiangnan3", "difficulty": "hard", "game_type": "solo",
        }, headers=headers)
        cid = resp.json()["data"]["collection_id"]
        for i in range(3):
            client.post("/api/collection/point_end", json={
                "collection_id": cid, "point_index": i,
                "time_sec": 100, "is_correct": True,
                "difficulty": "hard", "game_type": "solo",
            }, headers=headers)
        client.post("/api/collection/finish", json={
            "collection_id": cid, "difficulty": "hard", "game_type": "solo",
            "total_time_sec": 300, "point_times": [100, 100, 100],
        }, headers=headers)

        resp = client.get("/api/collection/tracks", headers=headers)
        assert resp.status_code == 200
        points = resp.json()["data"]
        assert len(points) == 3  # jiangnan3 有 3 个 POI
        assert all(p["name"] in ("黄鹤楼", "岳阳楼", "滕王阁") for p in points)

    def test_partial_completion_no_medal(self, client, seed_mvp):
        """BIZ-03 中途放弃/未完成全部点位 → 不发勋章。"""
        token = _login(client, "partial@e2e.com", nickname="Partial测试员")
        headers = _headers(token)

        resp = client.post("/api/collection/start", json={
            "collection_code": "jiangnan3", "difficulty": "hard", "game_type": "solo",
        }, headers=headers)
        cid = resp.json()["data"]["collection_id"]

        # 只完成第 1 个点，其余未完成
        client.post("/api/collection/point_end", json={
            "collection_id": cid, "point_index": 0,
            "time_sec": 100, "is_correct": True,
            "difficulty": "hard", "game_type": "solo",
        }, headers=headers)

        # 未完成全部点位即 finish → 不应发勋章
        resp = client.post("/api/collection/finish", json={
            "collection_id": cid, "difficulty": "hard", "game_type": "solo",
            "total_time_sec": 100, "point_times": [100],
        }, headers=headers)
        assert resp.json()["data"]["medal_awarded"] is False

    def test_point_end_returns_next_start_coords(self, client, seed_mvp):
        """BIZ-02 起点继承：单点结束返回下一点起点坐标=当前点目标坐标。"""
        token = _login(client, "start@e2e.com", nickname="Start测试员")
        headers = _headers(token)
        resp = client.post("/api/collection/start", json={
            "collection_code": "jiangnan3", "difficulty": "hard", "game_type": "solo",
        }, headers=headers)
        cid = resp.json()["data"]["collection_id"]

        # 第 1 点结束 → 下一点起点应 = 黄鹤楼坐标 (114.30, 30.55)
        resp = client.post("/api/collection/point_end", json={
            "collection_id": cid, "point_index": 0,
            "time_sec": 100, "is_correct": True,
            "difficulty": "hard", "game_type": "solo",
        }, headers=headers)
        data = resp.json()["data"]
        assert data["has_next"] is True
        # next_start 应接近黄鹤楼坐标
        assert abs(data["next_start_lng"] - 114.30) < 0.01
        assert abs(data["next_start_lat"] - 30.55) < 0.01
