# -*- coding: utf-8 -*-
"""新闻时间线服务（小寻带你看新闻）。

玩法：沿时间线依次找点，找点阶段只下发不剧透提示；命中后解锁该事件的
新闻卡片（简介 + 地理冷知识）；当前模式找齐后解锁完整回顾与报道外链。
进度按 (session_id, mode) 独立记录（登录用户进度按 user_id 聚合，跨会话跟随），
点选/巡航两种玩法各自找齐、各自发纪念勋章（对齐专题模式 easy/hard 双勋章模型）。
"""
from typing import Any

from sqlalchemy.orm import Session

from ..config import settings
from ..models import NewsCorrection, NewsMedalRecord, NewsPoi, NewsProgress, NewsTimeline, User
from .game import (
    CHINA_CENTER,
    EASY_DIR_HINT,
    HINT_COST,
    HINT_COST_LEVEL2_BY_MODE,
    HintForbiddenError,
    bearing_degrees,
    bearing_to_offset,
    current_location_text,
    distance_bucket,
    haversine_km,
    move_point,
)

# 找点容差：随难度放宽（★1→5km … ★5→20km），下限为全国模式容差
def news_tolerance_km(difficulty: int) -> float:
    return max(settings.national_tolerance_km, difficulty * 4)

# 巡航模式有效搜索视野：bbox 最大跨度（度）。超过视为"缩得太远"，不判定命中。
# 巡航 zoom 锁定 15（玩家无法主动缩小），高速档最多临时降 5 级（→10，大屏视野约 5°），
# 故上限取 6°：覆盖所有合法视野，同时防止异常超大视野绕过判定。
NEWS_VIEW_MAX_SPAN_DEG = 6.0

# 每个事件的时限（对齐自由模式 national：点选 150s / 巡航 300s）
NEWS_TIME_LIMIT = {"easy": 150, "hard": 300}

MODES = ("easy", "hard")
MODE_LABEL = {"easy": "点选", "hard": "巡航"}


def _normalize_mode(mode: str | None) -> str:
    return mode if mode in MODES else "easy"


def _progress_poi_ids(db: Session, session_id: str | None, user: User | None,
                      timeline_id: int, mode: str) -> set[int]:
    """当前会话/用户在该时间线该模式下已找到的 poi_id 集合。"""
    if not session_id and not user:
        return set()
    q = db.query(NewsProgress.poi_id).filter(
        NewsProgress.timeline_id == timeline_id,
        NewsProgress.mode == mode,
    )
    if user:
        q = q.filter(NewsProgress.user_id == user.id)
    else:
        q = q.filter(NewsProgress.session_id == session_id)
    return {r[0] for r in q.all()}


def _poi_full(p: NewsPoi, with_link: bool) -> dict[str, Any]:
    data = {
        "id": p.id,
        "name": p.name,
        "event_date": p.event_date,
        "event_text": p.event_text,
        "fact_text": p.fact_text,
        "lng": p.lng,
        "lat": p.lat,
        "region": p.region,
        "difficulty": p.difficulty,
        "cover_url": p.cover_url,
        "sort_order": p.sort_order,
    }
    if with_link:
        data["link_url"] = p.link_url
        data["link_source"] = p.link_source
    return data


def _poi_locked(p: NewsPoi) -> dict[str, Any]:
    """未找到的点：返回定位地名（name 取"｜"前段）+ 地区 + 提示，不返回坐标、事件详情、链接。"""
    location = (p.name.split("｜")[0] or p.name).strip()
    return {
        "id": p.id,
        "location": location,
        "region": p.region,
        "event_date": p.event_date,
        "hint_text": p.hint_text,
        "difficulty": p.difficulty,
        "sort_order": p.sort_order,
        "found": False,
    }


def _timeline_dict(t: NewsTimeline, found_count: int, point_count: int,
                   mode: str | None = None) -> dict[str, Any]:
    data = {
        "id": t.id,
        "code": t.code,
        "name": t.name,
        "description": t.description,
        "color": t.color,
        "cover_url": t.cover_url,
        "medal_icon_url": t.medal_icon_url,
        "batch": t.batch,
        "point_count": point_count,
        "found_count": found_count,
        "completed": point_count > 0 and found_count >= point_count,
    }
    if mode:
        data["mode"] = mode
    return data


class NewsService:
    """新闻时间线玩法"""

    def get_timeline_by_code(self, db: Session, code: str) -> NewsTimeline | None:
        return (
            db.query(NewsTimeline)
            .filter(NewsTimeline.enabled.is_(True))
            .filter(NewsTimeline.code == code)
            .first()
        )

    def list_timelines(self, db: Session, user: User | None,
                       session_id: str | None) -> list[dict[str, Any]]:
        """栏目列表：进度按模式分别返回（found_easy / found_hard）。"""
        timelines = (
            db.query(NewsTimeline)
            .filter(
                NewsTimeline.enabled.is_(True),
                NewsTimeline.audit_status == "approved",
            )
            .order_by(NewsTimeline.sort_order.asc(), NewsTimeline.id.asc())
            .all()
        )
        items = []
        for t in timelines:
            point_count = len(t.pois)
            data = _timeline_dict(t, 0, point_count)
            for m in MODES:
                found = len(_progress_poi_ids(db, session_id, user, t.id, m))
                data[f"found_{m}"] = found
            data["completed"] = bool(point_count) and all(
                data[f"found_{m}"] >= point_count for m in MODES
            )
            items.append(data)
        return items

    def get_detail(self, db: Session, code: str, user: User | None,
                   session_id: str | None, mode: str = "easy") -> dict[str, Any] | None:
        """时间线详情（找点阶段，防剧透），进度按指定模式。"""
        t = self.get_timeline_by_code(db, code)
        if not t:
            return None
        mode = _normalize_mode(mode)
        pois = [p for p in t.pois if p.status == "approved"]
        found_ids = _progress_poi_ids(db, session_id, user, t.id, mode)

        current = None
        points = []
        for p in pois:
            if p.id in found_ids:
                data = _poi_full(p, with_link=False)
                data["found"] = True
                points.append(data)
            else:
                points.append(_poi_locked(p))
                if current is None:
                    current = p

        data = _timeline_dict(t, len(found_ids), len(pois), mode=mode)
        data["medal_earned"] = self._has_medal(db, user, t.id, mode)
        # 游戏引擎开局参数（对齐自由模式：初始中心 + 每事件时限）
        data["start_lng"], data["start_lat"] = CHINA_CENTER
        data["time_limit"] = NEWS_TIME_LIMIT[mode]
        # 另一模式的完成状态（用于模式选择页展示）
        other = "hard" if mode == "easy" else "easy"
        data[f"other_found_{other}"] = len(_progress_poi_ids(db, session_id, user, t.id, other))
        data["current"] = _poi_locked(current) if current else None
        data["points"] = points
        return data

    def _has_medal(self, db: Session, user: User | None, timeline_id: int,
                   mode: str) -> bool:
        if not user:
            return False
        return (
            db.query(NewsMedalRecord.id)
            .filter(
                NewsMedalRecord.user_id == user.id,
                NewsMedalRecord.timeline_id == timeline_id,
                NewsMedalRecord.mode == mode,
            )
            .first()
            is not None
        )

    def _mark_found(self, db: Session, t: NewsTimeline, poi: NewsPoi,
                    lng: float, lat: float, user: User | None,
                    session_id: str | None, found_ids: set[int],
                    pois: list[NewsPoi], mode: str) -> dict[str, Any]:
        """写入找点进度（幂等）并返回命中响应；该模式找齐且已登录则发该模式勋章。"""
        prog = (
            db.query(NewsProgress)
            .filter(
                NewsProgress.session_id == session_id,
                NewsProgress.mode == mode,
                NewsProgress.poi_id == poi.id,
            )
            .first()
        ) if session_id else None
        if not prog:
            prog = NewsProgress(
                session_id=session_id or "",
                mode=mode,
                user_id=user.id if user else None,
                timeline_id=t.id,
                poi_id=poi.id,
                found_lng=lng,
                found_lat=lat,
            )
            db.add(prog)
            db.commit()

        found_ids.add(poi.id)
        next_poi = next((p for p in pois if p.id not in found_ids), None)
        completed = next_poi is None

        # 该模式找齐发勋章：仅登录用户，幂等（一人一线一模式一枚）
        medal_awarded = False
        if completed and user and not self._has_medal(db, user, t.id, mode):
            db.add(NewsMedalRecord(user_id=user.id, timeline_id=t.id, mode=mode))
            db.commit()
            medal_awarded = True

        return {
            "hit": True,
            "poi": _poi_full(poi, with_link=False),
            "next": _poi_locked(next_poi) if next_poi else None,
            "found_count": len(found_ids),
            "point_count": len(pois),
            "completed": completed,
            "medal_awarded": medal_awarded,
            "medal_icon_url": t.medal_icon_url,
            "medal_name": f"{t.name}·{MODE_LABEL[mode]}勋章",
        }

    def _playing_context(self, db: Session, code: str, user: User | None,
                         session_id: str | None,
                         mode: str) -> tuple[NewsTimeline, list[NewsPoi], set[int], NewsPoi]:
        """取时间线与当前目标（该模式按时间线顺序第一个未找到的点）。"""
        if not session_id and not user:
            raise ValueError("缺少会话标识")
        t = self.get_timeline_by_code(db, code)
        if not t:
            raise ValueError("时间线不存在")
        pois = [p for p in t.pois if p.status == "approved"]
        found_ids = _progress_poi_ids(db, session_id, user, t.id, mode)
        current = next((p for p in pois if p.id not in found_ids), None)
        if current is None:
            raise ValueError("该模式下这条时间线已全部找齐")
        return t, pois, found_ids, current

    def found(self, db: Session, code: str, poi_id: int, lng: float, lat: float,
              user: User | None, session_id: str | None,
              mode: str = "easy") -> dict[str, Any]:
        """点选模式找点校验：按时间线顺序推进，命中写入进度并解锁新闻卡片。"""
        mode = _normalize_mode(mode)
        t, pois, found_ids, current = self._playing_context(db, code, user, session_id, mode)
        if poi_id != current.id:
            raise ValueError("请先按时间线顺序找到当前事件")

        distance_km = haversine_km(lng, lat, current.lng, current.lat)
        tolerance = news_tolerance_km(current.difficulty)
        if distance_km > tolerance:
            return {
                "hit": False,
                "distance_km": round(distance_km, 1),
                "tolerance_km": tolerance,
            }
        return self._mark_found(db, t, current, lng, lat, user, session_id,
                                found_ids, pois, mode)

    def check_view(self, db: Session, code: str, west: float, south: float,
                   east: float, north: float, user: User | None,
                   session_id: str | None, mode: str = "easy") -> dict[str, Any]:
        """巡航模式视野判定：目标点落在有效搜索视野内即命中。

        视野跨度过大（缩得太远）不判定，返回 need_zoom 提示玩家放大；
        未命中返回 distance_bucket（视野中心到目标的距离区间）供前端提示。
        """
        mode = _normalize_mode(mode)
        t, pois, found_ids, current = self._playing_context(db, code, user, session_id, mode)

        span = max(abs(east - west), abs(north - south))
        if span > NEWS_VIEW_MAX_SPAN_DEG:
            return {"hit": False, "need_zoom": True}

        if not (west <= current.lng <= east and south <= current.lat <= north):
            center_lng = (west + east) / 2
            center_lat = (south + north) / 2
            d = haversine_km(center_lng, center_lat, current.lng, current.lat)
            return {"hit": False, "distance_bucket": distance_bucket(d)}

        return self._mark_found(db, t, current, current.lng, current.lat,
                                user, session_id, found_ids, pois, mode)

    def summary(self, db: Session, code: str, user: User | None,
                session_id: str | None, mode: str = "easy") -> dict[str, Any] | None:
        """完整时间线回顾（含报道外链），该模式找齐后解锁。"""
        t = self.get_timeline_by_code(db, code)
        if not t:
            return None
        mode = _normalize_mode(mode)
        pois = [p for p in t.pois if p.status == "approved"]
        found_ids = _progress_poi_ids(db, session_id, user, t.id, mode)
        if len(found_ids) < len(pois):
            raise ValueError("找齐全部事件后解锁完整回顾")
        data = _timeline_dict(t, len(found_ids), len(pois), mode=mode)
        data["medal_awarded"] = self._has_medal(db, user, t.id, mode)
        data["points"] = [_poi_full(p, with_link=True) for p in pois]
        return data

    def move_view(self, lng: float, lat: float, direction: str,
                  distance_km: float) -> dict[str, Any]:
        """巡航移动（无状态）：从视野中心沿方向移动，供游戏引擎适配器调用。"""
        if not (1 <= distance_km <= 2000):
            raise ValueError("移动距离需在 1~2000 km 之间")
        new_lng, new_lat = move_point(lng, lat, direction, distance_km)
        return {"view_lng": round(new_lng, 6), "view_lat": round(new_lat, 6)}

    def get_hint(self, db: Session, code: str, lng: float, lat: float,
                 hint_level: int, mode: str, device: str = "pc",
                 hint_credits: int = 100, poi_id: int | None = None) -> dict[str, Any]:
        """新闻提示（无状态，对齐自由模式 hint 分级与消耗）。

        - level 1：当前所在省市（视野中心反查）
        - level 2：方向提示（easy/hard 消耗不同）
        - level 3：目标坐标
        - level 4：目标区域矩形 bounds
        积分由前端传入并在此扣除（新闻进度无服务端积分状态）。
        """
        t = self.get_timeline_by_code(db, code)
        if not t:
            raise ValueError("时间线不存在")
        mode = _normalize_mode(mode)
        pois = [p for p in t.pois if p.status == "approved"]
        current = None
        if poi_id:
            current = next((p for p in pois if p.id == poi_id), None)
        if current is None:
            current = pois[0] if pois else None
        if current is None:
            raise ValueError("该时间线暂无核定事件")
        if hint_level < 1 or hint_level > 4:
            raise ValueError("无效的提示等级")

        is_easy = mode == "easy"
        # 扣积分（无状态：前端传入剩余，返回扣除后剩余）
        if is_easy and hint_level in (2, 4):
            cfg = EASY_DIR_HINT.get(device, EASY_DIR_HINT["pc"])
            if hint_credits < cfg["cost"]:
                raise HintForbiddenError("积分不足")
            hint_credits -= cfg["cost"]
            brg = bearing_degrees(lng, lat, current.lng, current.lat)
            dist = haversine_km(lng, lat, current.lng, current.lat)
            result: dict[str, Any] = {
                "hint_level": hint_level,
                "content": f"目标在你当前视野{bearing_to_offset(brg)}，约 {distance_bucket(dist)}",
                "cost": cfg["cost"],
                "hint_credits": hint_credits,
            }
            return result

        if (not is_easy) and hint_level == 2:
            cost = HINT_COST_LEVEL2_BY_MODE["national"].get(device, 40)
            if hint_credits < cost:
                raise HintForbiddenError("积分不足")
            hint_credits -= cost
            brg = bearing_degrees(lng, lat, current.lng, current.lat)
            return {
                "hint_level": hint_level,
                "cost": cost,
                "hint_credits": hint_credits,
                "content": f"目标在当前视野{bearing_to_offset(brg)}",
            }

        cost = HINT_COST[hint_level].get(device, HINT_COST[hint_level]["pc"])
        if hint_credits < cost:
            raise HintForbiddenError("积分不足")
        hint_credits -= cost

        result = {"hint_level": hint_level, "cost": cost, "hint_credits": hint_credits}
        if hint_level == 1:
            result["content"] = current_location_text(db, lng, lat)
        elif hint_level == 3:
            result["content"] = f"目标坐标约：{current.lng:.1f}°E, {current.lat:.1f}°N"
        elif hint_level == 4:
            offset = 2.0
            result["bounds"] = {
                "west": current.lng - offset,
                "east": current.lng + offset,
                "south": current.lat - offset,
                "north": current.lat + offset,
            }
            result["content"] = "已在地图上标出目标所在区域（黄色矩形）"
        return result

    def medal_wall(self, db: Session, user: User | None) -> list[dict[str, Any]]:
        """新闻勋章墙：每条上线时间线 × 两种模式各一枚（勋章仅登录用户可获得）。"""
        if not user:
            return []
        timelines = (
            db.query(NewsTimeline)
            .filter(
                NewsTimeline.enabled.is_(True),
                NewsTimeline.audit_status == "approved",
            )
            .order_by(NewsTimeline.sort_order.asc(), NewsTimeline.id.asc())
            .all()
        )
        records = {
            (r.timeline_id, r.mode): r.earned_at
            for r in db.query(NewsMedalRecord).filter(NewsMedalRecord.user_id == user.id).all()
        }
        items = []
        for t in timelines:
            for m in MODES:
                earned_at = records.get((t.id, m))
                items.append({
                    "timeline_id": t.id,
                    "code": t.code,
                    "name": t.name,
                    "color": t.color,
                    "icon_url": t.medal_icon_url,
                    "batch": t.batch,
                    "mode": m,
                    "mode_label": MODE_LABEL[m],
                    "earned": earned_at is not None,
                    "earned_at": earned_at.isoformat() if earned_at else None,
                })
        return items

    def submit_correction(self, db: Session, news_poi_id: int, session_id: str,
                          content: str, nickname: str | None = None,
                          contact: str | None = None) -> dict[str, Any]:
        """提交新闻事件纠错反馈（对齐其他模式的纠错入口）。"""
        poi = db.query(NewsPoi).filter(NewsPoi.id == news_poi_id).first()
        if not poi:
            raise ValueError("事件不存在")
        content = (content or "").strip()
        if not content:
            raise ValueError("反馈内容不能为空")
        if len(content) > 500:
            raise ValueError("反馈内容不能超过 500 字")
        c = NewsCorrection(
            news_poi_id=news_poi_id,
            session_id=session_id,
            nickname=nickname,
            content=content,
            contact=(contact or "").strip() or None,
        )
        db.add(c)
        db.commit()
        db.refresh(c)
        return {"id": c.id, "message": "反馈已提交，感谢帮助改进"}

    def list_corrections(self, db: Session, status: str | None = None) -> list[dict[str, Any]]:
        q = db.query(NewsCorrection)
        if status:
            q = q.filter(NewsCorrection.status == status)
        rows = q.order_by(NewsCorrection.created_at.desc()).limit(200).all()
        return [
            {
                "id": c.id,
                "news_poi_id": c.news_poi_id,
                "poi_name": c.poi.name if c.poi else None,
                "poi_name_full": c.poi.timeline.name if c.poi and c.poi.timeline else None,
                "session_id": c.session_id,
                "nickname": c.nickname,
                "content": c.content,
                "contact": c.contact,
                "status": c.status,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in rows
        ]

    def handle_correction(self, db: Session, correction_id: int,
                          note: str | None = None) -> dict[str, Any]:
        c = db.query(NewsCorrection).filter(NewsCorrection.id == correction_id).first()
        if not c:
            raise ValueError("反馈不存在")
        c.status = "handled"
        if note:
            c.reviewer_note = note[:256]
        db.commit()
        return {"ok": True}


news_service = NewsService()
