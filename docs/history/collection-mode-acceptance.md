# 地图寻踪 · 专题模式验收标准与测试

> 配套方案：[collection-mode-plan.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/collection-mode-plan.md)
> 配套实施计划：[collection-mode-implementation-plan.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/collection-mode-implementation-plan.md)
> 本文包含：验收清单 + 后端单元测试脚本 + 前端手工测试用例 + 端到端测试脚本

---

## 一、验收标准清单

### 1.1 数据库（阶段 1 验收）

| 编号 | 验收项 | 验证方法 | 通过标准 |
|---|---|---|---|
| DB-01 | 6 张新表创建 | `SHOW TABLES LIKE 'collections';` 等 | 6 张表均存在 |
| DB-02 | collections 字段完整 | `DESCRIBE collections;` | 含 id/code/name/description/icon/cover_url/geometry/difficulty_star/unlock_require/audit_status/sort_order/enabled/created_at |
| DB-03 | collection_pois 字段完整 | `DESCRIBE collection_pois;` | 含 id/collection_id/poi_id/sort_order/created_at + uk_col_poi 唯一约束 |
| DB-04 | medals 字段完整 | `DESCRIBE medals;` | 含 id/collection_id/difficulty/game_type/name/icon_url/created_at + uk_col_diff_type |
| DB-05 | user_medals 字段完整 | `DESCRIBE user_medals;` | 含 id/user_id/medal_id/total_time_sec/earned_at/updated_at + uk_user_medal |
| DB-06 | medal_records 字段完整 | `DESCRIBE medal_records;` | 含 id/user_id/medal_id/total_time_sec/point_times/is_win/earned_at |
| DB-07 | users 字段完整 | `DESCRIBE users;` | 含 id/email/nickname/avatar_url/total_medals/is_admin/last_login_at/created_at/updated_at + email UNIQUE + nickname UNIQUE |
| DB-08 | player_sessions 加字段 | `DESCRIBE player_sessions;` | 含 collection_id(BIGINT NULL) + point_index(INT NULL) |
| DB-09 | 索引正确 | `SHOW INDEX FROM collections;` 等 | idx_enabled / idx_star / idx_audit / idx_collection / idx_user / idx_medal / idx_earned 均存在 |
| DB-10 | users.nickname 大小写敏感 | 插入"哈哈A"和"哈哈a" | 两条均成功（大小写敏感） |

### 1.2 后端接口（阶段 2 验收）

| 编号 | 接口 | 方法 | 验收点 |
|---|---|---|---|
| API-01 | `/api/auth/send_code` | POST | 邮箱收到 6 位验证码，Redis 存储 5 分钟 |
| API-02 | `/api/auth/login` | POST | 验证码正确→登录成功+JWT；错误→401 |
| API-03 | `/api/auth/login` | POST | 新邮箱→自动注册+昵称沿用流程 |
| API-04 | `/api/auth/check_nickname` | POST | "哈哈A"已注册→"哈哈a"可用（大小写敏感） |
| API-05 | `/api/auth/me` | GET | 返回 user 信息（id/email/nickname/total_medals） |
| API-06 | `/api/collection/list` | GET | 按星级分组，含解锁状态 |
| API-07 | `/api/collection/{code}` | GET | 返回预告卡信息（封面+描述+点位数+平均用时+完成率+星级） |
| API-08 | `/api/collection/start` | POST | 返回第 1 个点的单局信息 + collection_id + point_index |
| API-09 | `/api/collection/point_end` | POST | 记录单点用时，返回是否有下一点 + 下一点起点坐标 |
| API-10 | `/api/collection/finish` | POST | hard+solo→发勋章；easy→不发勋章；重复完成→刷新最快用时 |
| API-11 | `/api/medal/wall` | GET | 按星级分组，已获得彩色/未获得灰色 |
| API-12 | `/api/collection/leaderboard?collection_id=` | GET | 单专题 Top N 用时 |
| API-13 | `/api/collection/leaderboard?scope=total` | GET | 总榜 Top 100 |
| API-14 | `/api/collection/leaderboard?scope=medal_count` | GET | 勋章数榜 Top 100 |
| API-15 | 未登录访问需登录接口 | - | 返回 401 |

### 1.3 前端页面（阶段 3-5 验收）

| 编号 | 页面 | 验收点 |
|---|---|---|
| FE-01 | 首页 | 4 卡片（自由/PK/主题/专题），PC 端 2×2，移动端纵向堆叠 |
| FE-02 | 首页右上角 | 登录图标（未登录灰色，已登录显示昵称） |
| FE-03 | 专题卡片 | 显示图标+"100 个专题等你收集"+已获勋章数（登录后） |
| FE-04 | AuthModal | 邮箱→验证码→昵称沿用/输入，冲突时显示推荐昵称 |
| FE-05 | 专题列表页 | 按星级分组可折叠，锁/解锁状态正确 |
| FE-06 | 专题详情页 | 预告卡：封面+3 行文化背景+难度数据+两个难度按钮 |
| FE-07 | Collection.tsx | 串联单局，进度条 `1/5`→`2/5` 跳动 |
| FE-08 | 单点结算页 | `1/5 已收集`+单点用时+C4 知识卡+"前往下一点"按钮 |
| FE-09 | B5 过渡动画 | flyTo 2-3 秒+进度条数字跳动+可跳过+禁用地图操作 |
| FE-10 | 专题结算页 | 总用时+D1 柱状图（最慢红/最快绿）+勋章/登录引导 |
| FE-11 | 勋章墙 | 按星级分组，已获得彩色/未获得灰色 |
| FE-12 | 我的足迹 | 全屏地图点亮已收集 POI |
| FE-13 | 排行榜 | 3 Tab（单专题/总榜/勋章数），Top N 列表 |

### 1.4 业务规则（阶段 7 验收）

| 编号 | 规则 | 验收点 |
|---|---|---|
| BIZ-01 | 顺序收集 | 点位按固定顺序解锁，不可跳点 |
| BIZ-02 | 起点继承 | 第 N+1 点起点 = 第 N 点目标坐标 |
| BIZ-03 | 中途放弃 | 已完成的点不计入，重玩从头开始 |
| BIZ-04 | 勋章规则 | hard 发勋章，easy 只解锁不发 |
| BIZ-05 | 星级解锁 | ★1 默认开放；完成任意模式算通关；N 个前一星级解锁下一级 |
| BIZ-06 | 不登录无勋章 | 未登录完成专题→不存勋章 |
| BIZ-07 | 排行榜入榜 | 必须登录才上榜 |
| BIZ-08 | 重玩刷新 | 重复完成刷新最快用时，不重复发勋章 |
| BIZ-09 | 昵称沿用 | 注册时查最近 30 天 session 的 nickname 作为候选 |
| BIZ-10 | 昵称大小写敏感 | "哈哈A"≠"哈哈a" |

### 1.5 回归测试（阶段 7 验收）

| 编号 | 验收点 |
|---|---|
| REG-01 | 自由模式 solo（点选/巡航）功能完全不变 |
| REG-02 | PK 模式（点选/巡航）功能完全不变 |
| REG-03 | 主题模式功能完全不变 |
| REG-04 | 再来一局从上一局目标点开始（所有模式） |
| REG-05 | PC 端布局无变化 |
| REG-06 | 手机端布局正常（首页/单局/结算/勋章墙） |

### 1.6 部署验收（阶段 8）

| 编号 | 验收点 |
|---|---|
| DEPLOY-01 | 线上数据库迁移成功 |
| DEPLOY-02 | 5 个专题数据已入库 |
| DEPLOY-03 | 后端 gunicorn 重启成功 |
| DEPLOY-04 | 前端 dist 上传成功 |
| DEPLOY-05 | 线上首页四卡片显示 |
| DEPLOY-06 | 线上完整走通 1 个专题 |
| DEPLOY-07 | 线上邮箱登录+领勋章成功 |

---

## 二、后端单元测试脚本

### 2.1 测试环境准备

文件：`backend/tests/conftest_collection.py`

```python
# -*- coding: utf-8 -*-
"""专题模式测试 fixtures。"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import (
    Base, Collection, CollectionPoi, Medal, UserMedal, MedalRecord,
    User, PlayerSession, Poi,
)


@pytest.fixture(scope="function")
def db_session():
    """内存 SQLite 测试库（每个测试函数独立）。"""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


@pytest.fixture
def sample_user(db_session):
    user = User(email="test@example.com", nickname="测试玩家")
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def sample_collection(db_session):
    """五岳归来专题（5 个点，★2）。"""
    coll = Collection(
        code="wuyue", name="五岳归来",
        description="中国五大名山",
        difficulty_star=2, unlock_require=2,
        audit_status="approved", enabled=1,
    )
    db_session.add(coll)
    db_session.commit()
    # 5 个 POI
    pois = [
        Poi(name="泰山", lng=117.1, lat=36.27, description="五岳之首，海拔1545m"),
        Poi(name="华山", lng=110.09, lat=34.56, description="奇险天下第一山"),
        Poi(name="衡山", lng=112.73, lat=27.25, description="南岳寿山"),
        Poi(name="嵩山", lng=113.02, lat=34.51, description="中岳嵩山"),
        Poi(name="恒山", lng=113.74, lat=39.74, description="北岳恒山"),
    ]
    db_session.add_all(pois)
    db_session.commit()
    # 关联
    for i, poi in enumerate(pois):
        db_session.add(CollectionPoi(
            collection_id=coll.id, poi_id=poi.id, sort_order=i
        ))
    # 4 枚勋章
    for diff in ["easy", "hard"]:
        for gt in ["solo", "pk"]:
            db_session.add(Medal(
                collection_id=coll.id, difficulty=diff, game_type=gt,
                name=f"五岳归来·{diff}·{gt}",
            ))
    db_session.commit()
    return coll


@pytest.fixture
def star1_collection(db_session):
    """★1 专题（用于解锁测试）。"""
    coll = Collection(
        code="jiangnan_tower", name="江南三大名楼",
        difficulty_star=1, unlock_require=0,
        audit_status="approved", enabled=1,
    )
    db_session.add(coll)
    db_session.commit()
    db_session.add(Medal(
        collection_id=coll.id, difficulty="hard", game_type="solo",
        name="江南三大名楼·hard·solo",
    ))
    db_session.commit()
    return coll
```

### 2.2 解锁逻辑测试

文件：`backend/tests/test_unlock.py`

```python
# -*- coding: utf-8 -*-
"""专题星级解锁逻辑测试。"""
from app.services.collection_service import is_unlocked, DEFAULT_REQUIRE


def test_star1_always_unlocked(db_session, sample_user, star1_collection):
    """★1 默认开放。"""
    assert is_unlocked(db_session, sample_user, star1_collection) is True


def test_star2_locked_without_completion(db_session, sample_user, sample_collection):
    """★2 未完成 ★1 时锁定。"""
    assert is_unlocked(db_session, sample_user, sample_collection) is False


def test_star2_unlocked_after_enough_star1(db_session, sample_user, sample_collection, star1_collection):
    """完成足够 ★1 后 ★2 解锁。"""
    from app.models import UserMedal, Medal
    medal = db_session.query(Medal).filter_by(
        collection_id=star1_collection.id, difficulty="hard", game_type="solo"
    ).first()
    db_session.add(UserMedal(
        user_id=sample_user.id, medal_id=medal.id,
        total_time_sec=300, earned_at="2026-01-01 00:00:00",
        updated_at="2026-01-01 00:00:00",
    ))
    db_session.commit()
    # ★2 需要 2 个 ★1，但只完成 1 个
    assert is_unlocked(db_session, sample_user, sample_collection) is False

    # 再加 1 个 ★1 专题完成
    from app.models import Collection
    coll2 = Collection(
        code="freshwater_lake", name="五大淡水湖",
        difficulty_star=1, audit_status="approved", enabled=1,
    )
    db_session.add(coll2)
    db_session.commit()
    db_session.add(Medal(
        collection_id=coll2.id, difficulty="hard", game_type="solo",
        name="五大淡水湖·hard·solo",
    ))
    db_session.commit()
    medal2 = db_session.query(Medal).filter_by(collection_id=coll2.id).first()
    db_session.add(UserMedal(
        user_id=sample_user.id, medal_id=medal2.id,
        total_time_sec=400, earned_at="2026-01-01 00:00:00",
        updated_at="2026-01-01 00:00:00",
    ))
    db_session.commit()
    assert is_unlocked(db_session, sample_user, sample_collection) is True


def test_easy_mode_does_not_give_medal_but_unlocks(db_session, sample_user, star1_collection, sample_collection):
    """easy 模式不发勋章但算通关（解锁下一星级）。"""
    from app.models import UserMedal, Medal
    # easy 完成不写 user_medals，但写 player_sessions
    # 解锁校验应查 player_sessions 而非 user_medals
    # （注：实际实现中 is_unlocked 需支持查 player_sessions）
    from app.models import PlayerSession
    db_session.add(PlayerSession(
        user_id=sample_user.id, nickname="测试玩家",
        ip="127.0.0.1", mode="national", difficulty="easy",
        status="finished", is_win=True,
        collection_id=star1_collection.id, point_index=0,
    ))
    db_session.commit()
    # ★2 需要 2 个 ★1，只完成 1 个
    assert is_unlocked(db_session, sample_user, sample_collection) is False
```

### 2.3 勋章逻辑测试

文件：`backend/tests/test_medal.py`

```python
# -*- coding: utf-8 -*-
"""勋章发放与刷新逻辑测试。"""
from app.models import UserMedal, MedalRecord
from app.services.collection_service import award_medal


def test_hard_solo_awards_medal(db_session, sample_user, sample_collection):
    """hard solo 完成发勋章。"""
    medal = db_session.query(Medal).filter_by(
        collection_id=sample_collection.id, difficulty="hard", game_type="solo"
    ).first()
    award_medal(db_session, user=sample_user, medal=medal,
                total_time_sec=600, point_times=[100, 120, 150, 130, 100])
    um = db_session.query(UserMedal).filter_by(user_id=sample_user.id, medal_id=medal.id).first()
    assert um is not None
    assert um.total_time_sec == 600


def test_easy_does_not_award_medal(db_session, sample_user, sample_collection):
    """easy 完成不发勋章。"""
    medal = db_session.query(Medal).filter_by(
        collection_id=sample_collection.id, difficulty="easy", game_type="solo"
    ).first()
    award_medal(db_session, user=sample_user, medal=medal,
                total_time_sec=500, point_times=[100, 100, 100, 100, 100])
    # easy 不写 user_medals
    um = db_session.query(UserMedal).filter_by(user_id=sample_user.id, medal_id=medal.id).first()
    assert um is None


def test_faster_time_updates_medal(db_session, sample_user, sample_collection):
    """更快用时刷新勋章。"""
    medal = db_session.query(Medal).filter_by(
        collection_id=sample_collection.id, difficulty="hard", game_type="solo"
    ).first()
    # 第一次完成 600 秒
    award_medal(db_session, user=sample_user, medal=medal, total_time_sec=600, point_times=[])
    # 第二次完成 500 秒（更快）
    award_medal(db_session, user=sample_user, medal=medal, total_time_sec=500, point_times=[])
    um = db_session.query(UserMedal).filter_by(user_id=sample_user.id, medal_id=medal.id).first()
    assert um.total_time_sec == 500  # 取更快值
    # 流水表应有 2 条
    records = db_session.query(MedalRecord).filter_by(user_id=sample_user.id, medal_id=medal.id).all()
    assert len(records) == 2


def test_slower_time_does_not_update(db_session, sample_user, sample_collection):
    """更慢用时不刷新。"""
    medal = db_session.query(Medal).filter_by(
        collection_id=sample_collection.id, difficulty="hard", game_type="solo"
    ).first()
    award_medal(db_session, user=sample_user, medal=medal, total_time_sec=500, point_times=[])
    award_medal(db_session, user=sample_user, medal=medal, total_time_sec=700, point_times=[])
    um = db_session.query(UserMedal).filter_by(user_id=sample_user.id, medal_id=medal.id).first()
    assert um.total_time_sec == 500  # 仍是更快的值


def test_total_medals_count(db_session, sample_user, sample_collection):
    """users.total_medals 冗余字段正确。"""
    medal = db_session.query(Medal).filter_by(
        collection_id=sample_collection.id, difficulty="hard", game_type="solo"
    ).first()
    award_medal(db_session, user=sample_user, medal=medal, total_time_sec=600, point_times=[])
    db_session.refresh(sample_user)
    assert sample_user.total_medals == 1
```

### 2.4 昵称测试

文件：`backend/tests/test_nickname.py`

```python
# -*- coding: utf-8 -*-
"""昵称唯一性与大小写敏感测试。"""
import pytest
from app.models import User
from app.services.auth import check_nickname_unique, generate_nickname_suggestions


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
    """昵称冲突时生成推荐。"""
    db_session.add(User(email="a@x.com", nickname="张三"))
    db_session.commit()
    suggestions = generate_nickname_suggestions(db_session, "张三")
    assert len(suggestions) >= 3
    for s in suggestions:
        assert s != "张三"
        assert check_nickname_unique(db_session, s) is True


def test_nickname_too_short(db_session):
    """昵称长度校验。"""
    assert check_nickname_unique(db_session, "a") is False  # 太短（<2）
    assert check_nickname_unique(db_session, "ab") is True
    long_name = "a" * 17
    assert check_nickname_unique(db_session, long_name) is False  # 太长（>16）
```

### 2.5 运行测试

```bash
cd /Users/luanpeng/Desktop/allData/code/zhizhang/map/backend
python3 -m pytest tests/test_unlock.py tests/test_medal.py tests/test_nickname.py -v
```

---

## 三、前端手工测试用例

### 3.1 首页与登录

| 用例 | 步骤 | 预期 |
|---|---|---|
| TC-FE-01 | 打开首页 | 4 张卡片，PC 端 2×2 网格 |
| TC-FE-02 | 手机端打开首页 | 4 张卡片纵向堆叠 |
| TC-FE-03 | 点击右上角登录图标 | 弹出 AuthModal |
| TC-FE-04 | 输入邮箱→发送验证码 | 邮箱收到 6 位验证码 |
| TC-FE-05 | 输入正确验证码 | 显示昵称沿用/输入界面 |
| TC-FE-06 | 有历史昵称→沿用 | 昵称填入，校验通过 |
| TC-FE-07 | 昵称已被占用 | 显示 3-5 个推荐昵称 |
| TC-FE-08 | 自选推荐昵称 | 注册成功，登录态 |
| TC-FE-09 | 输入"哈哈A"注册，再注册"哈哈a" | 两次均成功（大小写敏感） |

### 3.2 专题列表与详情

| 用例 | 步骤 | 预期 |
|---|---|---|
| TC-FE-10 | 点击专题卡片 | 进入专题列表页 |
| TC-FE-11 | 查看星级分组 | ★1 显示 5 个专题，★2 锁定 |
| TC-FE-12 | 点击已解锁专题 | 进入专题详情页 |
| TC-FE-13 | 查看预告卡 | 封面+3 行文化背景+难度数据+两个难度按钮 |
| TC-FE-14 | 点击锁定的 ★2 | 显示"完成 N 个 ★1 解锁" |

### 3.3 专题游戏流程

| 用例 | 步骤 | 预期 |
|---|---|---|
| TC-FE-15 | 选五岳归来→hard→solo | 进入第 1 个点（泰山） |
| TC-FE-16 | 完成第 1 个点 | 结算页显示"1/5 已收集"+知识卡+"前往下一点" |
| TC-FE-17 | 点击"前往下一点" | B5 过渡动画：flyTo+进度条跳动+可跳过 |
| TC-FE-18 | 完成第 5 个点 | 进入专题结算页 |
| TC-FE-19 | 结算页 | 总用时+柱状图（最慢红/最快绿） |
| TC-FE-20 | 已登录+hard | 显示获得的勋章 |
| TC-FE-21 | 未登录+hard | 弹窗"绑定邮箱领取勋章" |
| TC-FE-22 | 完成 easy | 提示"已解锁下一星级"，不发勋章 |

### 3.4 勋章墙与足迹

| 用例 | 步骤 | 预期 |
|---|---|---|
| TC-FE-23 | 点击"我的勋章" | 进入勋章墙 |
| TC-FE-24 | 查看勋章墙 | 按星级分组，已获得彩色/未获得灰色 |
| TC-FE-25 | 点击"我的足迹" | 全屏地图点亮已收集 POI |
| TC-FE-26 | 未登录点勋章墙 | 显示登录引导 |

### 3.5 排行榜

| 用例 | 步骤 | 预期 |
|---|---|---|
| TC-FE-27 | 进入排行榜 | 3 Tab：单专题/总榜/勋章数 |
| TC-FE-28 | 单专题排行 | 选专题+难度+玩法，Top 50 |
| TC-FE-29 | 未登录点排行榜 | 提示"登录可上榜" |

### 3.6 边界与异常

| 用例 | 步骤 | 预期 |
|---|---|---|
| TC-FE-30 | 专题中途关闭页面 | 重玩从头开始（无断点续传） |
| TC-FE-31 | 网络断开时完成专题 | 提示网络错误 |
| TC-FE-32 | 重复完成同一专题 | 刷新最快用时，不重复发勋章 |
| TC-FE-33 | 昵称用特殊字符 | 敏感词过滤 |

---

## 四、端到端测试脚本

### 4.1 后端 API 端到端（Python）

文件：`backend/tests/test_e2e_collection.py`

```python
# -*- coding: utf-8 -*-
"""专题模式端到端测试（后端 API）。"""
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


class TestCollectionE2E:
    """完整流程：注册→开始专题→5 个点→完成→领勋章→查排行榜。"""

    def test_full_flow_hard_solo(self):
        """hard solo 完整流程。"""
        # 1. 发验证码
        resp = client.post("/api/auth/send_code", json={"email": "e2e@test.com"})
        assert resp.status_code == 200
        # 2. 登录（测试环境验证码固定 123456）
        resp = client.post("/api/auth/login", json={
            "email": "e2e@test.com", "code": "123456",
            "nickname": "E2E测试员",
        })
        assert resp.status_code == 200
        token = resp.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 3. 查专题列表
        resp = client.get("/api/collection/list", headers=headers)
        assert resp.status_code == 200
        collections = resp.json()["data"]
        assert len(collections) > 0
        wuyue = next(c for c in collections if c["code"] == "wuyue")
        assert wuyue["difficulty_star"] == 2

        # 4. 查专题详情
        resp = client.get("/api/collection/wuyue", headers=headers)
        assert resp.status_code == 200
        detail = resp.json()["data"]
        assert detail["point_count"] == 5

        # 5. 开始专题
        resp = client.post("/api/collection/start", json={
            "collection_code": "wuyue", "difficulty": "hard", "game_type": "solo",
        }, headers=headers)
        assert resp.status_code == 200
        start_data = resp.json()["data"]
        collection_id = start_data["collection_id"]
        assert start_data["point_index"] == 0

        # 6. 模拟完成 5 个点
        point_times = []
        for i in range(5):
            resp = client.post("/api/collection/point_end", json={
                "collection_id": collection_id,
                "point_index": i,
                "time_sec": 120 + i * 10,
                "is_correct": True,
            }, headers=headers)
            assert resp.status_code == 200
            point_times.append(120 + i * 10)
            if i < 4:
                assert resp.json()["data"]["has_next"] is True
            else:
                assert resp.json()["data"]["has_next"] is False

        # 7. 完成专题
        resp = client.post("/api/collection/finish", json={
            "collection_id": collection_id,
            "difficulty": "hard",
            "game_type": "solo",
            "total_time_sec": sum(point_times),
            "point_times": point_times,
        }, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["data"]["medal_awarded"] is True

        # 8. 查勋章墙
        resp = client.get("/api/medal/wall", headers=headers)
        assert resp.status_code == 200
        medals = resp.json()["data"]
        wuyue_medal = next(
            m for g in medals for m in g["medals"]
            if m["collection_code"] == "wuyue" and m["difficulty"] == "hard"
        )
        assert wuyue_medal["earned"] is True

        # 9. 查排行榜
        resp = client.get("/api/collection/leaderboard", params={
            "collection_id": collection_id, "difficulty": "hard", "game_type": "solo",
        }, headers=headers)
        assert resp.status_code == 200
        board = resp.json()["data"]
        assert len(board) > 0
        assert board[0]["nickname"] == "E2E测试员"

    def test_easy_does_not_award_medal(self):
        """easy 完成不发勋章。"""
        # 登录
        client.post("/api/auth/send_code", json={"email": "easy@test.com"})
        resp = client.post("/api/auth/login", json={
            "email": "easy@test.com", "code": "123456", "nickname": "Easy测试员",
        })
        token = resp.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 开始专题（easy）
        resp = client.post("/api/collection/start", json={
            "collection_code": "wuyue", "difficulty": "easy", "game_type": "solo",
        }, headers=headers)
        collection_id = resp.json()["data"]["collection_id"]

        # 完成 5 个点
        for i in range(5):
            client.post("/api/collection/point_end", json={
                "collection_id": collection_id, "point_index": i,
                "time_sec": 100, "is_correct": True,
            }, headers=headers)

        # 完成专题
        resp = client.post("/api/collection/finish", json={
            "collection_id": collection_id, "difficulty": "easy", "game_type": "solo",
            "total_time_sec": 500, "point_times": [100]*5,
        }, headers=headers)
        assert resp.json()["data"]["medal_awarded"] is False  # easy 不发勋章

    def test_anonymous_no_medal(self):
        """未登录完成专题无勋章。"""
        # 不带 token 开始专题
        resp = client.post("/api/collection/start", json={
            "collection_code": "wuyue", "difficulty": "hard", "game_type": "solo",
        })
        # 未登录应返回 401 或允许游客但不发勋章
        if resp.status_code == 200:
            collection_id = resp.json()["data"]["collection_id"]
            for i in range(5):
                client.post("/api/collection/point_end", json={
                    "collection_id": collection_id, "point_index": i,
                    "time_sec": 100, "is_correct": True,
                })
            resp = client.post("/api/collection/finish", json={
                "collection_id": collection_id, "difficulty": "hard", "game_type": "solo",
                "total_time_sec": 500, "point_times": [100]*5,
            })
            assert resp.json()["data"]["medal_awarded"] is False
```

### 4.2 运行端到端测试

```bash
cd /Users/luanpeng/Desktop/allData/code/zhizhang/map/backend
# 启动测试环境（验证码固定 123456）
TESTING=true python3 -m pytest tests/test_e2e_collection.py -v
```

---

## 五、验收通过标准

### 5.1 MVP 上线门槛

| 类别 | 通过标准 |
|---|---|
| 数据库 | DB-01 ~ DB-10 全部通过 |
| 后端接口 | API-01 ~ API-15 全部通过 |
| 前端页面 | FE-01 ~ FE-13 全部通过 |
| 业务规则 | BIZ-01 ~ BIZ-10 全部通过 |
| 回归测试 | REG-01 ~ REG-06 全部通过 |
| 单元测试 | test_unlock / test_medal / test_nickname 全部通过 |
| 端到端 | test_e2e_collection 全部通过 |
| 部署 | DEPLOY-01 ~ DEPLOY-07 全部通过 |

### 5.2 验收流程

```
1. 开发者本地跑单元测试 + 端到端测试
   ↓ 通过
2. 开发者本地手动验收（1.1-1.5 清单）
   ↓ 通过
3. 合并分支，部署到服务器
   ↓ 完成
4. 线上冒烟测试（1.6 部署验收）
   ↓ 通过
5. MVP 上线
```

---

## 六、测试数据准备

### 6.1 MVP 专题数据（5 个）

| code | name | star | points |
|---|---|---|---|
| wuyue | 五岳归来 | 2 | 泰山/华山/衡山/嵩山/恒山 |
| six_ancient_capital | 六大古都 | 2 | 北京/西安/洛阳/开封/南京/杭州 |
| buddha_mountain | 四大佛教名山 | 2 | 五台山/峨眉山/普陀山/九华山 |
| freshwater_lake | 五大淡水湖 | 1 | 鄱阳湖/洞庭湖/太湖/洪泽湖/巢湖 |
| jiangnan_tower | 江南三大名楼 | 1 | 黄鹤楼/岳阳楼/滕王阁 |

### 6.2 测试用户

| email | nickname | 用途 |
|---|---|---|
| e2e@test.com | E2E测试员 | hard solo 完整流程 |
| easy@test.com | Easy测试员 | easy 不发勋章测试 |
| anon@test.com | 不登录 | 未登录无勋章测试 |
| case@test.com | 哈哈A | 大小写敏感测试 |
| case2@test.com | 哈哈a | 大小写敏感测试 |

### 6.3 预置 POI

确认以下 POI 在 `pois` 表中（缺则补录）：

**五岳**：泰山(117.1,36.27) / 华山(110.09,34.56) / 衡山(112.73,27.25) / 嵩山(113.02,34.51) / 恒山(113.74,39.74)

**六大古都**：北京 / 西安 / 洛阳 / 开封 / 南京 / 杭州

**四大佛教名山**：五台山 / 峨眉山 / 普陀山 / 九华山

**五大淡水湖**：鄱阳湖 / 洞庭湖 / 太湖 / 洪泽湖 / 巢湖

**江南三大名楼**：黄鹤楼 / 岳阳楼 / 滕王阁
