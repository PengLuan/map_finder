from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Double,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 邮箱登录凭证：NULL 表示 PK 匿名用户（仅 nickname），有值表示邮箱注册用户
    email: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    # 全局唯一昵称，大小写敏感（哈哈A ≠ 哈哈a），与 PK 昵称打通
    nickname: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    slogan: Mapped[str | None] = mapped_column(String(100), nullable=True)  # 个性签名（用户主页展示）
    # 公开主页开关：False 时排行榜不可点击、直连主页提示已隐藏（默认公开）
    profile_public: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    total_medals: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    games: Mapped[list["GameRecord"]] = relationship(back_populates="player")

    # 专题模式：用户当前勋章
    medals: Mapped[list["UserMedal"]] = relationship(back_populates="user")


class Region(Base):
    """行政区划表"""
    __tablename__ = "regions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(12), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    level: Mapped[int] = mapped_column(SmallInteger, nullable=False)  # 1=省 2=市 3=区县
    parent_code: Mapped[str | None] = mapped_column(String(12), nullable=True)
    lng: Mapped[float | None] = mapped_column(Double, nullable=True)
    lat: Mapped[float | None] = mapped_column(Double, nullable=True)

    # bbox 反查（玩家当前位置→省/市），为空时回退到 lng/lat 最近匹配
    bbox_w: Mapped[float | None] = mapped_column(Double, nullable=True)
    bbox_s: Mapped[float | None] = mapped_column(Double, nullable=True)
    bbox_e: Mapped[float | None] = mapped_column(Double, nullable=True)
    bbox_n: Mapped[float | None] = mapped_column(Double, nullable=True)


class POI(Base):
    """兴趣点表（目标点素材）"""
    __tablename__ = "pois"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    lng: Mapped[float] = mapped_column(Double, nullable=False)
    lat: Mapped[float] = mapped_column(Double, nullable=False)
    adcode: Mapped[str | None] = mapped_column(String(12), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    hint_text: Mapped[str | None] = mapped_column(Text, nullable=True)  # 一句话线索
    difficulty: Mapped[int] = mapped_column(SmallInteger, default=3)  # 1~5
    source: Mapped[str | None] = mapped_column(String(50), nullable=True)  # 种子来源: manual/mct_5a/mooc_211...
    used_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # 后台审核与 UGC
    verify_status: Mapped[str] = mapped_column(String(20), default="approved")  # approved/pending/rejected
    submitted_by: Mapped[str | None] = mapped_column(String(64), nullable=True)  # 提交者 session_id
    contributor_nickname: Mapped[str | None] = mapped_column(String(32), nullable=True)  # 贡献者署名

    # 区域范围判定
    shape_type: Mapped[str] = mapped_column(String(10), default="point", index=True)  # point/circle/polygon
    radius_km: Mapped[float] = mapped_column(Double, default=0.0)  # circle 半径
    area_geojson: Mapped[str | None] = mapped_column(Text, nullable=True)  # polygon 的 GeoJSON
    area_review: Mapped[int] = mapped_column(SmallInteger, default=0, index=True)  # 0=区域已确认/纯点 1=区域待人工核定半径


class POITheme(Base):
    """POI 主题表（主题挑战的元数据）"""
    __tablename__ = "poi_themes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)  # 与 pois.category 对应
    name: Mapped[str] = mapped_column(String(100), nullable=False)  # 主题名称
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)  # 主题简介
    icon: Mapped[str | None] = mapped_column(String(20), nullable=True)  # emoji 图标
    cover_url: Mapped[str | None] = mapped_column(Text, nullable=True)  # 主题封面图
    group_name: Mapped[str | None] = mapped_column(String(50), nullable=True)  # 分组: 人文教育/自然地理/...
    sort_order: Mapped[int] = mapped_column(Integer, default=0)  # 排序权重
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)  # 是否启用
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class GameRecord(Base):
    """游戏记录表"""
    __tablename__ = "game_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    mode: Mapped[str] = mapped_column(String(20), nullable=False)  # national/provincial/city
    difficulty: Mapped[str] = mapped_column(String(10), default="hard")  # easy/hard
    region_code: Mapped[str | None] = mapped_column(String(12), nullable=True)

    # 目标点（服务端保存，不下发前端）
    target_poi_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("pois.id"), nullable=True
    )
    target_lng: Mapped[float] = mapped_column(Double, nullable=False)
    target_lat: Mapped[float] = mapped_column(Double, nullable=False)

    # 当前视野中心
    view_lng: Mapped[float] = mapped_column(Double, nullable=False)
    view_lat: Mapped[float] = mapped_column(Double, nullable=False)

    # 起点
    start_lng: Mapped[float] = mapped_column(Double, nullable=False)
    start_lat: Mapped[float] = mapped_column(Double, nullable=False)

    # 游戏状态
    status: Mapped[str] = mapped_column(String(20), default="playing")  # playing/won/lost/given_up
    steps: Mapped[int] = mapped_column(Integer, default=0)
    total_distance_km: Mapped[float] = mapped_column(Double, default=0.0)
    hints_used: Mapped[int] = mapped_column(Integer, default=0)
    hint_level: Mapped[int] = mapped_column(Integer, default=0)  # 当前已解锁的提示等级
    score: Mapped[int] = mapped_column(Integer, default=0)
    zoom_penalties: Mapped[int] = mapped_column(Integer, default=0)

    # 提示系统重构：设备类型 + 积分（机会）+ 救济计数
    device: Mapped[str] = mapped_column(String(10), default="pc")  # pc / mobile
    hint_credits: Mapped[int] = mapped_column(Integer, default=100)  # 剩余积分（机会）
    easy_dir_hint_count: Mapped[int] = mapped_column(Integer, default=0)  # 简单模式方向提示次数
    bearing_hint_count: Mapped[int] = mapped_column(Integer, default=0)  # 困难 A 救济次数

    # 困难 A 救济：上次视野中心（用于计算屏幕中心变化方向）
    prev_view_lng: Mapped[float | None] = mapped_column(Double, nullable=True)
    prev_view_lat: Mapped[float | None] = mapped_column(Double, nullable=True)

    # 结果
    hit: Mapped[bool] = mapped_column(Boolean, default=False)
    hit_distance_km: Mapped[float | None] = mapped_column(Double, nullable=True)
    duration_sec: Mapped[int] = mapped_column(Integer, default=0)

    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    player: Mapped["User | None"] = relationship(back_populates="games")
    target_poi: Mapped["POI | None"] = relationship()


# ===== PK 对战模型 =====


class PKRoom(Base):
    """PK 房间"""
    __tablename__ = "pk_rooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_code: Mapped[str] = mapped_column(String(4), nullable=False, index=True)
    host_user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    guest_user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    mode: Mapped[str] = mapped_column(String(20), nullable=False)  # national/province
    region_code: Mapped[str | None] = mapped_column(String(12), nullable=True)
    difficulty: Mapped[str] = mapped_column(String(10), default="hard")  # easy/hard
    category: Mapped[str | None] = mapped_column(String(50), nullable=True)  # 主题分类
    status: Mapped[str] = mapped_column(String(20), default="waiting", index=True) # waiting/playing/finished
    version: Mapped[int] = mapped_column(Integer, default=0)
    host_rematch: Mapped[bool] = mapped_column(Boolean, default=False)
    guest_rematch: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PKGame(Base):
    """PK 对局"""
    __tablename__ = "pk_games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[int] = mapped_column(Integer, ForeignKey("pk_rooms.id"), nullable=False)

    # 目标点（双方共同目标）
    target_poi_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("pois.id"), nullable=True)
    target_lng: Mapped[float] = mapped_column(Double, nullable=False)
    target_lat: Mapped[float] = mapped_column(Double, nullable=False)

    # 双方玩家
    player1_user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    player2_user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)

    # 玩家1 状态
    player1_view_lng: Mapped[float] = mapped_column(Double, nullable=False)
    player1_view_lat: Mapped[float] = mapped_column(Double, nullable=False)
    player1_steps: Mapped[int] = mapped_column(Integer, default=0)
    player1_distance_km: Mapped[float] = mapped_column(Double, default=0.0)
    player1_hint_level: Mapped[int] = mapped_column(Integer, default=0)
    player1_score: Mapped[int] = mapped_column(Integer, default=0)
    player1_hit: Mapped[bool] = mapped_column(Boolean, default=False)

    # 玩家2 状态
    player2_view_lng: Mapped[float] = mapped_column(Double, nullable=False)
    player2_view_lat: Mapped[float] = mapped_column(Double, nullable=False)
    player2_steps: Mapped[int] = mapped_column(Integer, default=0)
    player2_distance_km: Mapped[float] = mapped_column(Double, default=0.0)
    player2_hint_level: Mapped[int] = mapped_column(Integer, default=0)
    player2_score: Mapped[int] = mapped_column(Integer, default=0)
    player2_hit: Mapped[bool] = mapped_column(Boolean, default=False)

    # 提示系统重构：双方独立积分 + 设备 + 救济计数 + 上次视野（A救济）
    player1_hint_credits: Mapped[int] = mapped_column(Integer, default=100)
    player2_hint_credits: Mapped[int] = mapped_column(Integer, default=100)
    player1_device: Mapped[str] = mapped_column(String(10), default="pc")
    player2_device: Mapped[str] = mapped_column(String(10), default="pc")
    player1_easy_dir_hint_count: Mapped[int] = mapped_column(Integer, default=0)
    player2_easy_dir_hint_count: Mapped[int] = mapped_column(Integer, default=0)
    player1_bearing_hint_count: Mapped[int] = mapped_column(Integer, default=0)
    player2_bearing_hint_count: Mapped[int] = mapped_column(Integer, default=0)
    player1_prev_view_lng: Mapped[float | None] = mapped_column(Double, nullable=True)
    player1_prev_view_lat: Mapped[float | None] = mapped_column(Double, nullable=True)
    player2_prev_view_lng: Mapped[float | None] = mapped_column(Double, nullable=True)
    player2_prev_view_lat: Mapped[float | None] = mapped_column(Double, nullable=True)

    # 对局状态
    version: Mapped[int] = mapped_column(Integer, default=0)
    winner_user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    win_reason: Mapped[str | None] = mapped_column(String(20), nullable=True)  # hit/timeout/draw/opponent_left
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PKUserActivity(Base):
    """PK 用户心跳"""
    __tablename__ = "pk_user_activity"
    __table_args__ = (UniqueConstraint("user_id", "room_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    room_id: Mapped[int] = mapped_column(Integer, ForeignKey("pk_rooms.id"), nullable=False)
    last_heartbeat_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ===== 后台管理 & UGC =====


class PlayerSession(Base):
    """无登录玩家行为统计"""
    __tablename__ = "player_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    ip: Mapped[str] = mapped_column(String(45), nullable=False, index=True)
    # IP 归属地（省市区文本，由高德 IP 定位查询，离线脚本可回填）
    ip_region: Mapped[str | None] = mapped_column(String(128), nullable=True)
    nickname: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ua: Mapped[str | None] = mapped_column(String(256), nullable=True)
    mode: Mapped[str] = mapped_column(String(20), nullable=False)  # national/provincial/theme
    region_code: Mapped[str | None] = mapped_column(String(12), nullable=True)
    category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    difficulty: Mapped[str] = mapped_column(String(10), nullable=False)  # easy/hard
    game_type: Mapped[str] = mapped_column(String(10), nullable=False)  # solo/pk
    target_poi_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    won: Mapped[bool] = mapped_column(Boolean, default=False)
    score: Mapped[int] = mapped_column(Integer, default=0)
    duration_sec: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # 专题模式：关联专题与第几点（NULL=非专题）
    collection_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    point_index: Mapped[int | None] = mapped_column(Integer, nullable=True)


class POISubmission(Base):
    """前台 UGC 地点投稿"""
    __tablename__ = "poi_submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(64), nullable=False)
    nickname: Mapped[str | None] = mapped_column(String(32), nullable=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    province_code: Mapped[str | None] = mapped_column(String(12), nullable=True)
    category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    lng: Mapped[float] = mapped_column(Double, nullable=False)
    lat: Mapped[float] = mapped_column(Double, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    suggested_shape_type: Mapped[str] = mapped_column(String(10), default="point")
    suggested_radius_km: Mapped[float] = mapped_column(Double, default=0.0)
    suggested_area_geojson: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending/approved/rejected
    reviewer_note: Mapped[str | None] = mapped_column(String(256), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class POICorrection(Base):
    """POI 纠正快照（用户建议修正已有 POI，采纳后才写回）"""
    __tablename__ = "poi_corrections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    poi_id: Mapped[int] = mapped_column(Integer, ForeignKey("pois.id"), nullable=False, index=True)
    session_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    nickname: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # 纠正快照（仅记录用户实际填写的字段，None = 不修改该项）
    name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    lng: Mapped[float | None] = mapped_column(Double, nullable=True)
    lat: Mapped[float | None] = mapped_column(Double, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)  # → poi.summary
    cover_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    suggested_shape_type: Mapped[str | None] = mapped_column(String(10), nullable=True)
    suggested_radius_km: Mapped[float | None] = mapped_column(Double, nullable=True)
    suggested_area_geojson: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending/adopted/rejected
    reviewer_note: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    adopted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Feedback(Base):
    """意见留言"""
    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    image_urls: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON 数组
    contact: Mapped[str | None] = mapped_column(String(100), nullable=True)
    nickname: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ip: Mapped[str] = mapped_column(String(45), nullable=False)
    session_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)  # 提交者设备标识（历史反馈匹配）
    admin_reply: Mapped[str | None] = mapped_column(Text, nullable=True)  # 官方回复
    replied_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    replied_by: Mapped[str | None] = mapped_column(String(50), nullable=True)  # 回复管理员
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


# ===== 专题模式（Collection）=====


class Collection(Base):
    """专题元数据"""
    __tablename__ = "collections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(48), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cover_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    geometry: Mapped[str | None] = mapped_column(String(32), nullable=True)
    difficulty_star: Mapped[int] = mapped_column(SmallInteger, default=1, server_default="1")
    unlock_require: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    audit_status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    pois: Mapped[list["CollectionPoi"]] = relationship(
        back_populates="collection", cascade="all, delete-orphan",
        order_by="CollectionPoi.sort_order",
    )
    medals: Mapped[list["Medal"]] = relationship(back_populates="collection")


class CollectionPoi(Base):
    """专题-POI 关联表（按 sort_order 收集）"""
    __tablename__ = "collection_pois"
    __table_args__ = (UniqueConstraint("collection_id", "poi_id", name="uk_col_poi"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    collection_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("collections.id"), nullable=False, index=True
    )
    poi_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pois.id"), nullable=False, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    collection: Mapped["Collection"] = relationship(back_populates="pois")
    poi: Mapped["POI"] = relationship()


class Medal(Base):
    """勋章表（静态数据：专题×难度×玩法 = 一枚勋章）"""
    __tablename__ = "medals"
    __table_args__ = (
        UniqueConstraint("collection_id", "difficulty", "game_type", name="uk_col_diff_type"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    collection_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("collections.id"), nullable=False, index=True
    )
    difficulty: Mapped[str] = mapped_column(String(10), nullable=False)  # easy/hard
    game_type: Mapped[str] = mapped_column(String(10), nullable=False)  # solo/pk
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    icon_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    collection: Mapped["Collection"] = relationship(back_populates="medals")


class UserMedal(Base):
    """用户当前勋章（只保留最快用时）"""
    __tablename__ = "user_medals"
    __table_args__ = (UniqueConstraint("user_id", "medal_id", name="uk_user_medal"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    medal_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("medals.id"), nullable=False, index=True
    )
    total_time_sec: Mapped[int] = mapped_column(Integer, nullable=False)
    earned_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="medals")
    medal: Mapped["Medal"] = relationship()


class MedalRecord(Base):
    """勋章记录流水（每次获得/刷新记一条）"""
    __tablename__ = "medal_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    medal_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("medals.id"), nullable=False, index=True
    )
    total_time_sec: Mapped[int] = mapped_column(Integer, nullable=False)
    point_times: Mapped[list | None] = mapped_column(JSON, nullable=True)
    is_win: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    earned_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


class DevPlan(Base):
    """开发计划（后台填写即用户可见）"""
    __tablename__ = "dev_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="planning", index=True)  # planning/done/abandoned
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class DevPlanFeedback(Base):
    """开发计划用户评价（点赞/点踩 + 文字 + 图，全员可见，同设备覆盖式一条）"""
    __tablename__ = "dev_plan_feedbacks"
    __table_args__ = (UniqueConstraint("plan_id", "session_id", name="uk_dev_plan_feedback"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_id: Mapped[int] = mapped_column(Integer, ForeignKey("dev_plans.id"), nullable=False, index=True)
    session_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    nickname: Mapped[str | None] = mapped_column(String(50), nullable=True)
    attitude: Mapped[str] = mapped_column(String(10), nullable=False)  # like/dislike
    comment: Mapped[str | None] = mapped_column(String(256), nullable=True)
    images: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON 数组，最多3张
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # 用户撤回（用户端不可见，后台存档）
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class NewsTimeline(Base):
    """新闻时间线（小寻带你看新闻：玩法单元，独立于勋章/专题体系）"""
    __tablename__ = "news_timelines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(48), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    cover_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    medal_icon_url: Mapped[str | None] = mapped_column(Text, nullable=True)  # 完成纪念勋章图标（空则显示默认）
    batch: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)  # 内容批次，如 2026-10
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    audit_status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending", index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    pois: Mapped[list["NewsPoi"]] = relationship(
        back_populates="timeline", cascade="all, delete-orphan",
        order_by="NewsPoi.sort_order",
    )


class NewsPoi(Base):
    """新闻事件点（找点目标，pending=待人工核定）"""
    __tablename__ = "news_pois"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timeline_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("news_timelines.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    event_date: Mapped[str | None] = mapped_column(String(16), nullable=True)  # 如 2026-10-01
    event_text: Mapped[str | None] = mapped_column(Text, nullable=True)  # 事件简介（找齐解锁）
    fact_text: Mapped[str | None] = mapped_column(Text, nullable=True)  # 地理冷知识（找齐解锁）
    hint_text: Mapped[str | None] = mapped_column(Text, nullable=True)  # 不剧透提示（找点阶段可见）
    link_url: Mapped[str | None] = mapped_column(Text, nullable=True)  # 报道外链（P2）
    link_source: Mapped[str | None] = mapped_column(String(64), nullable=True)
    link_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    lng: Mapped[float] = mapped_column(Double, nullable=False)
    lat: Mapped[float] = mapped_column(Double, nullable=False)
    region: Mapped[str | None] = mapped_column(String(100), nullable=True)
    difficulty: Mapped[int] = mapped_column(SmallInteger, default=3, server_default="3")  # 1~5
    cover_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    verified: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")  # 坐标已人工核定
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending", index=True)  # pending/approved/rejected
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    timeline: Mapped["NewsTimeline"] = relationship(back_populates="pois")
    progresses: Mapped[list["NewsProgress"]] = relationship(
        back_populates="poi", cascade="all, delete-orphan"
    )


class NewsProgress(Base):
    """新闻找点进度（游客/用户双轨，按模式 easy/hard 独立）"""
    __tablename__ = "news_progress"
    __table_args__ = (UniqueConstraint("session_id", "mode", "poi_id", name="uk_news_progress_session_mode_poi"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    mode: Mapped[str] = mapped_column(String(8), default="easy", server_default="easy")  # easy/hard
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True, index=True
    )
    timeline_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("news_timelines.id"), nullable=False, index=True
    )
    poi_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("news_pois.id"), nullable=False, index=True
    )
    found_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    found_lng: Mapped[float | None] = mapped_column(Double, nullable=True)
    found_lat: Mapped[float | None] = mapped_column(Double, nullable=True)

    poi: Mapped["NewsPoi"] = relationship(back_populates="progresses")


class NewsMedalRecord(Base):
    """新闻时间线完成勋章（找齐发放，一人一线一模式一枚，仅登录用户）"""
    __tablename__ = "news_medal_records"
    __table_args__ = (UniqueConstraint("user_id", "timeline_id", "mode", name="uk_news_medal_user_timeline_mode"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    timeline_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("news_timelines.id"), nullable=False, index=True
    )
    mode: Mapped[str] = mapped_column(String(8), default="easy", server_default="easy")  # easy/hard
    earned_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    timeline: Mapped["NewsTimeline"] = relationship()


class NewsCorrection(Base):
    """新闻事件纠错反馈（玩家提交，后台处理）"""
    __tablename__ = "news_corrections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    news_poi_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("news_pois.id"), nullable=False, index=True
    )
    session_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    nickname: Mapped[str | None] = mapped_column(String(50), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)  # 反馈内容（500 字内）
    contact: Mapped[str | None] = mapped_column(String(100), nullable=True)  # 联系方式（可选）
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending", index=True)  # pending/handled
    reviewer_note: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    poi: Mapped["NewsPoi"] = relationship()
