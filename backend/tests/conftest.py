"""pytest 公共 fixture：sqlite in-memory + TestClient。

注意：geometry.py 里有 `from .game import` 的函数级导入，测试时确保 app 包可导入。
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.main as main_module
from app.database import Base, get_db
from app import models  # noqa: F401  确保 models 注册到 Base.metadata

# sqlite in-memory，StaticPool 保证同一连接共享（in-memory db 每连接独立）
TEST_DB_URL = "sqlite://"
test_engine = create_engine(
    TEST_DB_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(bind=test_engine, autocommit=False, autoflush=False)

# 替换 main.lifespan 使用的 engine，避免 lifespan 连接 MySQL
main_module.engine = test_engine


@pytest.fixture()
def db_session():
    """每个测试用例独立的数据库会话（建表→用→清表）。"""
    Base.metadata.create_all(bind=test_engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=test_engine)


@pytest.fixture()
def client(db_session):
    """TestClient，get_db 依赖被替换为测试会话；lifespan 用 sqlite engine 建表。"""

    def _override_get_db():
        try:
            yield db_session
        finally:
            pass

    main_module.app.dependency_overrides[get_db] = _override_get_db
    with TestClient(main_module.app) as c:
        yield c
    main_module.app.dependency_overrides.clear()


# ===== 测试数据工厂 =====


@pytest.fixture()
def make_region(db_session):
    """创建一条 Region 记录。"""
    from app.models import Region

    def _make(code, name, level, parent_code=None, lng=None, lat=None,
              bbox_w=None, bbox_s=None, bbox_e=None, bbox_n=None):
        r = Region(code=code, name=name, level=level, parent_code=parent_code,
                   lng=lng, lat=lat, bbox_w=bbox_w, bbox_s=bbox_s,
                   bbox_e=bbox_e, bbox_n=bbox_n)
        db_session.add(r)
        db_session.commit()
        db_session.refresh(r)
        return r

    return _make


@pytest.fixture()
def make_poi(db_session):
    """创建一条 POI 记录。"""
    from app.models import POI

    def _make(name="测试目标", lng=116.4, lat=39.9, adcode="110000",
              shape_type="point", radius_km=0.0, area_geojson=None,
              cover_url=None, difficulty=3):
        p = POI(name=name, lng=lng, lat=lat, adcode=adcode,
                shape_type=shape_type, radius_km=radius_km,
                area_geojson=area_geojson, cover_url=cover_url,
                difficulty=difficulty, verify_status="approved")
        db_session.add(p)
        db_session.commit()
        db_session.refresh(p)
        return p

    return _make


@pytest.fixture()
def make_game(db_session, make_poi):
    """创建一条进行中的 GameRecord，返回 (game, poi)。"""
    from app.models import GameRecord

    def _make(mode="national", difficulty="hard", device="pc",
              target_lng=116.4, target_lat=39.9, view_lng=116.0, view_lat=39.0,
              hint_credits=100, easy_dir_hint_count=0, bearing_hint_count=0,
              prev_view_lng=None, prev_view_lat=None, poi=None):
        if poi is None:
            poi = make_poi(lng=target_lng, lat=target_lat)
        game = GameRecord(
            mode=mode,
            difficulty=difficulty,
            region_code=None,
            target_poi_id=poi.id,
            target_lng=target_lng,
            target_lat=target_lat,
            view_lng=view_lng,
            view_lat=view_lat,
            start_lng=view_lng,
            start_lat=view_lat,
            status="playing",
            device=device,
            hint_credits=hint_credits,
            easy_dir_hint_count=easy_dir_hint_count,
            bearing_hint_count=bearing_hint_count,
            prev_view_lng=prev_view_lng,
            prev_view_lat=prev_view_lat,
        )
        db_session.add(game)
        db_session.commit()
        db_session.refresh(game)
        return game

    return _make


# ===== 专题模式测试 fixtures =====


@pytest.fixture()
def sample_user(db_session):
    """已注册的登录用户。"""
    from app.models import User

    user = User(email="test@example.com", nickname="测试玩家")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture()
def make_collection(db_session, make_poi):
    """创建一个专题及其 POI/勋章。返回 Collection。"""
    from app.models import Collection, CollectionPoi, Medal

    def _make(code="wuyue", name="五岳归来", star=2, unlock_require=2,
              poi_specs=None, medals_all=True):
        coll = Collection(
            code=code, name=name,
            description=f"{name}测试专题",
            difficulty_star=star, unlock_require=unlock_require,
            audit_status="approved", enabled=1,
        )
        db_session.add(coll)
        db_session.commit()
        db_session.refresh(coll)
        # 默认 5 个 POI
        if poi_specs is None:
            poi_specs = [
                ("泰山", 117.1, 36.27),
                ("华山", 110.09, 34.56),
                ("衡山", 112.73, 27.25),
                ("嵩山", 113.02, 34.51),
                ("恒山", 113.74, 39.74),
            ]
        pois = []
        for i, (pname, lng, lat) in enumerate(poi_specs):
            p = make_poi(name=pname, lng=lng, lat=lat)
            pois.append(p)
            db_session.add(CollectionPoi(
                collection_id=coll.id, poi_id=p.id, sort_order=i,
            ))
        if medals_all:
            for diff in ("easy", "hard"):
                for gt in ("solo", "pk"):
                    db_session.add(Medal(
                        collection_id=coll.id, difficulty=diff, game_type=gt,
                        name=f"{name}·{diff}·{gt}",
                    ))
        db_session.commit()
        db_session.refresh(coll)
        return coll

    return _make


@pytest.fixture()
def sample_collection(db_session, make_collection):
    """五岳归来专题（★2，5 个点，unlock_require=2）。"""
    return make_collection(code="wuyue", name="五岳归来", star=2, unlock_require=2)


@pytest.fixture()
def star1_collection(db_session, make_collection):
    """★1 专题（江南三大名楼，默认开放）。"""
    return make_collection(
        code="jiangnan3", name="江南三大名楼", star=1, unlock_require=0,
        poi_specs=[
            ("黄鹤楼", 114.30, 30.55),
            ("岳阳楼", 113.13, 29.37),
            ("滕王阁", 115.88, 28.68),
        ],
    )


@pytest.fixture()
def seed_mvp(db_session, make_collection):
    """注入 5 个 MVP 专题 + POI + 勋章，供端到端测试使用。"""
    collections = {}
    collections["jiangnan3"] = make_collection(
        code="jiangnan3", name="江南三大名楼", star=1, unlock_require=0,
        poi_specs=[
            ("黄鹤楼", 114.30, 30.55),
            ("岳阳楼", 113.13, 29.37),
            ("滕王阁", 115.88, 28.68),
        ],
    )
    collections["lake5"] = make_collection(
        code="lake5", name="五大淡水湖", star=1, unlock_require=0,
        poi_specs=[
            ("鄱阳湖", 116.27, 28.95),
            ("洞庭湖", 112.80, 28.60),
            ("太湖", 120.25, 31.25),
            ("洪泽湖", 118.85, 33.30),
            ("巢湖", 117.87, 31.60),
        ],
    )
    collections["wuyue"] = make_collection(
        code="wuyue", name="五岳归来", star=2, unlock_require=1,
        poi_specs=[
            ("泰山", 117.10, 36.27),
            ("华山", 110.09, 34.56),
            ("衡山", 112.73, 27.25),
            ("嵩山", 113.02, 34.51),
            ("恒山", 113.74, 39.74),
        ],
    )
    return collections
