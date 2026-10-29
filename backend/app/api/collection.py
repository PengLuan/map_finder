# -*- coding: utf-8 -*-
"""专题模式 API：列表/详情/开始/单点结束/完成/勋章墙/排行榜/足迹。"""
import json
import urllib.parse
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import POI
from ..services.collection_service import collection_service, is_unlocked
from .auth import get_current_user

router = APIRouter(prefix="/api", tags=["collection"])

medal_router = APIRouter(prefix="/api/medal", tags=["medal"])


# ===== 请求模型 =====

class StartCollectionRequest(BaseModel):
    collection_code: str
    difficulty: str = "hard"  # easy/hard
    game_type: str = "solo"  # solo/pk
    device: str = "pc"  # pc/mobile
    start_lng: float | None = None  # 再来一局：从上一局目标点开始
    start_lat: float | None = None
    session_id: str | None = None


class PointEndRequest(BaseModel):
    collection_id: int
    point_index: int
    time_sec: int
    is_correct: bool = True
    difficulty: str = "hard"
    game_type: str = "solo"
    session_id: str | None = None
    device: str = "pc"  # pc/mobile


class FinishCollectionRequest(BaseModel):
    collection_id: int
    difficulty: str = "hard"
    game_type: str = "solo"
    total_time_sec: int
    point_times: list[int] = []
    is_win: bool = True
    session_id: str | None = None


# ===== 列表 / 详情 =====
# 注意：静态路径（list / leaderboard / tracks）必须在 /collection/{code}
# 之前声明，否则会被 {code} 路径参数捕获。

@router.get("/collection/list")
def list_collections(
    star: int | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
    session_id: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    data = collection_service.list_collections(
        db, user, session_id, star=star, page=page, page_size=page_size,
    )
    return {"data": data}


@router.get("/collection/poi_search")
def search_pois(
    keyword: str = Query(min_length=1, max_length=50),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(POI.id, POI.name, POI.address)
        .filter(POI.name.ilike(f"%{keyword}%"))
        .order_by(POI.name.asc())
        .limit(limit)
        .all()
    )
    return {"data": [{"id": r[0], "name": r[1], "address": r[2]} for r in rows]}


@router.get("/collection/leaderboard")
def leaderboard(
    scope: str = Query(default="poi"),  # poi/medal_count
    collection_id: int | None = None,
    point_index: int | None = None,
    poi_id: int | None = None,
    difficulty: str | None = None,
    game_type: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return {"data": collection_service.leaderboard(
        db, scope=scope, collection_id=collection_id,
        point_index=point_index, poi_id=poi_id,
        difficulty=difficulty, game_type=game_type, limit=limit,
    )}


def _check_profile_public(db: Session, target_user_id: int, current) -> None:
    """隐私校验：目标用户关闭公开主页时，非本人不可查看其勋章/足迹。"""
    if current and current.id == target_user_id:
        return
    from ..models import User
    target = db.query(User).filter(User.id == target_user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    if not target.profile_public:
        raise HTTPException(status_code=403, detail="该用户已隐藏主页")


@router.get("/collection/tracks")
def my_tracks(
    session_id: str | None = None,
    user_id: int | None = None,  # 查看他人主页足迹（需对方公开主页）
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if user_id and (not user or user.id != user_id):
        _check_profile_public(db, user_id, user)
        from ..models import User
        target = db.query(User).filter(User.id == user_id).first()
        return {"data": collection_service.my_tracks(db, target, None)}
    return {"data": collection_service.my_tracks(db, user, session_id)}


@router.get("/collection/{code}")
def get_collection_detail(
    code: str,
    session_id: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    detail = collection_service.get_detail(db, code, user, session_id)
    if not detail:
        raise HTTPException(status_code=404, detail="专题不存在")
    return {"data": detail}


# ===== 专题流程 =====

@router.post("/collection/start")
def start_collection(
    req: StartCollectionRequest,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        return {"data": collection_service.start_collection(
            db, req.collection_code, req.difficulty, req.game_type,
            user, session_id=req.session_id, device=req.device,
            start_lng=req.start_lng, start_lat=req.start_lat,
        )}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/collection/point_end")
def point_end(
    req: PointEndRequest,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ip = request.client.host if request.client else "0.0.0.0"
    nickname = user.nickname if user else None
    try:
        return {"data": collection_service.point_end(
            db, req.collection_id, req.point_index, req.time_sec,
            req.is_correct, user, req.session_id, ip, nickname,
            req.difficulty, req.game_type, device=req.device,
        )}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/collection/finish")
def finish_collection(
    req: FinishCollectionRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        return {"data": collection_service.finish_collection(
            db, req.collection_id, req.difficulty, req.game_type,
            req.total_time_sec, req.point_times, user, is_win=req.is_win,
        )}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ===== 勋章墙 =====

@medal_router.get("/wall")
def medal_wall(
    user_id: int | None = None,
    difficulty: str | None = None,
    session_id: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    # 优先用 token 中的当前用户；也可指定 user_id 查看他人
    target = user
    earned_only = False
    if user_id and (not user or user.id != user_id):
        _check_profile_public(db, user_id, user)
        from ..models import User
        target = db.query(User).filter(User.id == user_id).first()
        earned_only = True  # 他人主页只展示已获得的勋章
    data = collection_service.medal_wall(db, target, difficulty)
    if earned_only:
        for g in data:
            g["medals"] = [m for m in g["medals"] if m["earned"]]
    return {"data": [g for g in data if g["medals"]]}


# ===== 解锁查询（供前端详情页判断）=====

@router.get("/collection/{code}/unlock")
def check_unlock(
    code: str,
    session_id: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    from ..models import Collection
    c = collection_service.get_collection_by_code(db, code)
    if not c:
        raise HTTPException(status_code=404, detail="专题不存在")
    return {"data": {"unlocked": is_unlocked(db, user, c, session_id)}}


# ===== 地理编码（供前端搜索地点定位）=====

_AMAP_GEOCODE_KEY = ""  # 兜底留空，请通过环境变量 AMAP_WEB_KEY 配置


@router.get("/geocode")
def geocode(keyword: str = Query(..., min_length=1)):
    """高德地理编码代理：根据地址关键词查询坐标。"""
    key = settings.amap_web_key or _AMAP_GEOCODE_KEY
    params = urllib.parse.urlencode({"address": keyword, "key": key, "output": "JSON"})
    url = f"https://restapi.amap.com/v3/geocode/geo?{params}"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"高德 API 请求失败: {e}")
    if data.get("status") != "1":
        raise HTTPException(status_code=502, detail=f"高德 API 返回异常: {data.get('info', '未知错误')}")
    geocodes = data.get("geocodes", [])
    if not geocodes:
        return {"items": []}
    items = []
    for g in geocodes:
        loc = g.get("location", "")
        if loc:
            lng_str, lat_str = loc.split(",", 1)
            items.append({
                "address": g.get("formatted_address", ""),
                "lng": float(lng_str),
                "lat": float(lat_str),
            })
    return {"items": items}
