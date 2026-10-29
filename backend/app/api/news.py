# -*- coding: utf-8 -*-
"""新闻时间线 API：列表/详情/找点/巡航判定/完整回顾/勋章墙。"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..database import get_db
from ..services.game import HintForbiddenError
from ..services.news import news_service
from .auth import get_current_user

router = APIRouter(prefix="/api/news", tags=["news"])


class NewsFoundRequest(BaseModel):
    poi_id: int
    lng: float
    lat: float
    mode: str = "easy"
    session_id: str | None = None


class NewsCheckViewRequest(BaseModel):
    west: float
    south: float
    east: float
    north: float
    mode: str = "easy"
    session_id: str | None = None


@router.get("/timelines")
def list_timelines(
    session_id: str | None = None,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    return {"data": news_service.list_timelines(db, user, session_id)}


@router.get("/timelines/{code}")
def get_timeline_detail(
    code: str,
    mode: str = "easy",
    session_id: str | None = None,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    detail = news_service.get_detail(db, code, user, session_id, mode=mode)
    if not detail:
        raise HTTPException(status_code=404, detail="时间线不存在")
    return {"data": detail}


@router.post("/timelines/{code}/found")
def found_poi(
    code: str,
    req: NewsFoundRequest,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        return {"data": news_service.found(
            db, code, req.poi_id, req.lng, req.lat, user, req.session_id,
            mode=req.mode,
        )}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/timelines/{code}/check-view")
def check_view(
    code: str,
    req: NewsCheckViewRequest,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        return {"data": news_service.check_view(
            db, code, req.west, req.south, req.east, req.north,
            user, req.session_id, mode=req.mode,
        )}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/medals")
def news_medal_wall(
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """新闻勋章墙（仅登录用户；勋章在找齐时间线时按模式发放）"""
    return {"data": news_service.medal_wall(db, user)}


class NewsMoveRequest(BaseModel):
    lng: float
    lat: float
    direction: str
    distance_km: float


class NewsHintRequest(BaseModel):
    lng: float
    lat: float
    hint_level: int
    mode: str = "easy"
    device: str = "pc"
    hint_credits: int = 100
    poi_id: int | None = None


class NewsCorrectionRequest(BaseModel):
    news_poi_id: int
    session_id: str
    content: str
    nickname: str | None = None
    contact: str | None = None


@router.post("/timelines/{code}/move")
def move_view(req: NewsMoveRequest):
    """巡航移动（无状态）：从视野中心沿方向移动指定距离"""
    try:
        return {"data": news_service.move_view(req.lng, req.lat, req.direction, req.distance_km)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/timelines/{code}/hint")
def get_hint(code: str, req: NewsHintRequest, db=Depends(get_db)):
    """新闻提示（对齐自由模式 hint 分级：省市/方向/坐标/区域框）"""
    try:
        return {"data": news_service.get_hint(
            db, code=code, lng=req.lng, lat=req.lat, hint_level=req.hint_level,
            mode=req.mode, device=req.device, hint_credits=req.hint_credits,
            poi_id=req.poi_id,
        )}
    except HintForbiddenError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/correction")
def submit_correction(req: NewsCorrectionRequest, db=Depends(get_db)):
    """新闻事件纠错反馈（对齐其他模式的纠正入口）"""
    try:
        return {"data": news_service.submit_correction(
            db, req.news_poi_id, req.session_id, req.content,
            nickname=req.nickname, contact=req.contact,
        )}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/timelines/{code}/summary")
def timeline_summary(
    code: str,
    mode: str = "easy",
    session_id: str | None = None,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        data = news_service.summary(db, code, user, session_id, mode=mode)
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
    if not data:
        raise HTTPException(status_code=404, detail="时间线不存在")
    return {"data": data}
