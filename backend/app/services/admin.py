"""后台管理服务：玩家会话统计、概览面板、UGC 投稿审核。"""
from datetime import datetime, timedelta

from sqlalchemy import func as sa_func, or_
from sqlalchemy.orm import Session

from ..models import (
    PKGame,
    POI,
    POICorrection,
    POISubmission,
    POITheme,
    PlayerSession,
    GameRecord,
    Collection,
    CollectionPoi,
    Medal,
    MedalRecord,
    User,
    UserMedal,
    NewsTimeline,
    NewsPoi,
    NewsProgress,
)
from . import ip_region as ip_region_service


def _collections_for_pois(db: Session, poi_ids: list[int]) -> dict[int, list[dict]]:
    """返回每个 POI 所属的专题列表（一个 POI 可属于多个专题）。"""
    if not poi_ids:
        return {}
    rows = (
        db.query(CollectionPoi.poi_id, Collection.id, Collection.code, Collection.name)
        .join(Collection, CollectionPoi.collection_id == Collection.id)
        .filter(CollectionPoi.poi_id.in_(poi_ids))
        .order_by(Collection.sort_order, Collection.id)
        .all()
    )
    result: dict[int, list[dict]] = {}
    for poi_id, cid, code, name in rows:
        result.setdefault(poi_id, []).append({"id": cid, "code": code, "name": name})
    return result


def _poi_to_dict(poi: POI, include_geojson: bool = True, collections: list[dict] | None = None) -> dict:
    """POI 序列化（后台列表/编辑用）。"""
    d = {
        "id": poi.id,
        "name": poi.name,
        "category": poi.category,
        "lng": poi.lng,
        "lat": poi.lat,
        "adcode": poi.adcode,
        "address": poi.address,
        "summary": poi.summary,
        "cover_url": poi.cover_url,
        "hint_text": poi.hint_text,
        "difficulty": poi.difficulty,
        "source": poi.source,
        "used_count": poi.used_count,
        "verify_status": poi.verify_status,
        "contributor_nickname": poi.contributor_nickname,
        "shape_type": poi.shape_type,
        "radius_km": poi.radius_km,
        "area_review": poi.area_review,
        "collections": collections or [],
    }
    if include_geojson:
        d["area_geojson"] = poi.area_geojson
    return d


def _submission_to_dict(sub: POISubmission) -> dict:
    return {
        "id": sub.id,
        "session_id": sub.session_id,
        "nickname": sub.nickname,
        "name": sub.name,
        "province_code": sub.province_code,
        "category": sub.category,
        "lng": sub.lng,
        "lat": sub.lat,
        "description": sub.description,
        "cover_url": sub.cover_url,
        "suggested_shape_type": sub.suggested_shape_type,
        "suggested_radius_km": sub.suggested_radius_km,
        "suggested_area_geojson": sub.suggested_area_geojson,
        "status": sub.status,
        "reviewer_note": sub.reviewer_note,
        "submitted_at": sub.submitted_at.isoformat() if sub.submitted_at else None,
        "reviewed_at": sub.reviewed_at.isoformat() if sub.reviewed_at else None,
    }


def _correction_to_dict(c: POICorrection) -> dict:
    return {
        "id": c.id,
        "poi_id": c.poi_id,
        "session_id": c.session_id,
        "nickname": c.nickname,
        "name": c.name,
        "category": c.category,
        "lng": c.lng,
        "lat": c.lat,
        "description": c.description,
        "cover_url": c.cover_url,
        "suggested_shape_type": c.suggested_shape_type,
        "suggested_radius_km": c.suggested_radius_km,
        "suggested_area_geojson": c.suggested_area_geojson,
        "status": c.status,
        "reviewer_note": c.reviewer_note,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "adopted_at": c.adopted_at.isoformat() if c.adopted_at else None,
    }


class AdminService:
    # ===== 玩家会话 =====

    def create_session(self, db: Session, data: dict, ip: str, ua: str | None) -> dict:
        # 查询 IP 归属地（走缓存，同 IP 不重复请求 API）
        ip_region = ip_region_service.get_ip_region(ip)
        sess = PlayerSession(
            session_id=data["session_id"],
            ip=ip,
            ip_region=ip_region,
            ua=ua,
            nickname=data.get("nickname"),
            mode=data["mode"],
            region_code=data.get("region_code"),
            category=data.get("category"),
            difficulty=data["difficulty"],
            game_type=data["game_type"],
            target_poi_id=data.get("target_poi_id"),
            started_at=datetime.now(),
        )
        db.add(sess)
        db.commit()
        db.refresh(sess)
        return {"id": sess.id, "session_id": sess.session_id}

    def end_session(self, db: Session, session_id: int, data: dict) -> dict:
        sess = db.query(PlayerSession).filter(PlayerSession.id == session_id).first()
        if not sess:
            raise ValueError("会话不存在")
        sess.won = bool(data.get("won", False))
        sess.score = int(data.get("score", 0))
        sess.duration_sec = int(data.get("duration_sec", 0))
        sess.ended_at = datetime.now()
        db.commit()
        return {"ok": True}

    def list_sessions(self, db: Session, filters: dict, page: int, page_size: int) -> dict:
        q = db.query(PlayerSession)
        if filters.get("start"):
            q = q.filter(PlayerSession.started_at >= filters["start"])
        if filters.get("end"):
            q = q.filter(PlayerSession.started_at <= filters["end"])
        if filters.get("ip"):
            q = q.filter(PlayerSession.ip == filters["ip"])
        if filters.get("nickname"):
            q = q.filter(PlayerSession.nickname.like(f"%{filters['nickname']}%"))
        if filters.get("mode"):
            q = q.filter(PlayerSession.mode == filters["mode"])
        if filters.get("difficulty"):
            q = q.filter(PlayerSession.difficulty == filters["difficulty"])
        if filters.get("game_type"):
            q = q.filter(PlayerSession.game_type == filters["game_type"])
        if filters.get("ip_region"):
            q = q.filter(PlayerSession.ip_region.like(f"%{filters['ip_region']}%"))

        total = q.count()
        rows = (
            q.order_by(PlayerSession.started_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": [
                {
                    "id": r.id,
                    "session_id": r.session_id,
                    "ip": r.ip,
                    "ip_region": r.ip_region,
                    "nickname": r.nickname,
                    "mode": r.mode,
                    "region_code": r.region_code,
                    "category": r.category,
                    "difficulty": r.difficulty,
                    "game_type": r.game_type,
                    "won": r.won,
                    "score": r.score,
                    "duration_sec": r.duration_sec,
                    "started_at": r.started_at.isoformat() if r.started_at else None,
                    "ended_at": r.ended_at.isoformat() if r.ended_at else None,
                }
                for r in rows
            ],
        }

    def overview(self, db: Session) -> dict:
        now = datetime.now()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        today_q = db.query(PlayerSession).filter(PlayerSession.started_at >= today_start)

        today_dau = db.query(PlayerSession.ip).filter(
            PlayerSession.started_at >= today_start
        ).distinct().count()
        today_games = today_q.count()
        avg_duration = db.query(sa_func.avg(PlayerSession.duration_sec)).filter(
            PlayerSession.started_at >= today_start
        ).scalar() or 0

        # 模式分布
        mode_rows = (
            db.query(PlayerSession.mode, sa_func.count(PlayerSession.id))
            .filter(PlayerSession.started_at >= today_start)
            .group_by(PlayerSession.mode)
            .all()
        )
        mode_dist = [{"mode": m, "count": c} for m, c in mode_rows]

        # 近 7 天对局趋势
        trend = []
        for i in range(6, -1, -1):
            day_start = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = day_start + timedelta(days=1)
            cnt = db.query(PlayerSession).filter(
                PlayerSession.started_at >= day_start,
                PlayerSession.started_at < day_end,
            ).count()
            trend.append({"date": day_start.strftime("%m-%d"), "count": cnt})

        # IP 汇总（按总对局数 top）
        ip_rows = (
            db.query(
                PlayerSession.ip,
                sa_func.count(PlayerSession.id),
                sa_func.sum(PlayerSession.duration_sec),
                sa_func.max(PlayerSession.started_at),
            )
            .group_by(PlayerSession.ip)
            .order_by(sa_func.count(PlayerSession.id).desc())
            .limit(20)
            .all()
        )
        ip_summary = [
            {"ip": ip, "games": c, "total_duration": int(t or 0),
             "last_active": la.isoformat() if la else None}
            for ip, c, t, la in ip_rows
        ]

        return {
            "today_dau": today_dau,
            "today_games": today_games,
            "avg_duration": int(avg_duration),
            "mode_dist": mode_dist,
            "trend": trend,
            "ip_summary": ip_summary,
        }

    # ===== 主题管理 =====

    def list_themes(self, db: Session, include_disabled: bool = False) -> list[dict]:
        q = db.query(POITheme)
        if not include_disabled:
            q = q.filter(POITheme.enabled.is_(True))
        themes = q.order_by(POITheme.sort_order, POITheme.id).all()
        counts = dict(
            db.query(POI.category, sa_func.count(POI.id)).group_by(POI.category).all()
        )
        return [
            {
                "id": t.id,
                "code": t.code,
                "name": t.name,
                "description": t.description,
                "icon": t.icon,
                "cover_url": t.cover_url,
                "group_name": t.group_name,
                "sort_order": t.sort_order,
                "enabled": t.enabled,
                "poi_count": counts.get(t.code, 0),
            }
            for t in themes
        ]

    # ===== POI 管理 =====

    def list_pois(self, db: Session, filters: dict, page: int, page_size: int) -> dict:
        q = db.query(POI)
        if filters.get("category"):
            q = q.filter(POI.category == filters["category"])
        if filters.get("adcode_prefix"):
            q = q.filter(POI.adcode.like(f"{filters['adcode_prefix']}%"))
        if filters.get("difficulty") is not None:
            q = q.filter(POI.difficulty <= int(filters["difficulty"]))
        if filters.get("verify_status"):
            q = q.filter(POI.verify_status == filters["verify_status"])
        if filters.get("shape_type"):
            q = q.filter(POI.shape_type == filters["shape_type"])
        if filters.get("area_review") is not None:
            q = q.filter(POI.area_review == int(filters["area_review"]))
        if filters.get("keyword"):
            q = q.filter(POI.name.like(f"%{filters['keyword']}%"))

        total = q.count()
        rows = (
            q.order_by(POI.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        poi_ids = [r.id for r in rows]
        cmap = _collections_for_pois(db, poi_ids)
        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": [_poi_to_dict(r, include_geojson=True, collections=cmap.get(r.id, [])) for r in rows],
        }

    def get_poi(self, db: Session, poi_id: int) -> dict | None:
        poi = db.query(POI).filter(POI.id == poi_id).first()
        if not poi:
            return None
        collections = _collections_for_pois(db, [poi_id]).get(poi_id, [])
        return _poi_to_dict(poi, collections=collections)

    def create_poi(self, db: Session, data: dict) -> dict:
        poi = POI(
            name=data["name"],
            category=data.get("category"),
            lng=data["lng"],
            lat=data["lat"],
            adcode=data.get("adcode"),
            address=data.get("address"),
            summary=data.get("summary"),
            cover_url=data.get("cover_url"),
            hint_text=data.get("hint_text"),
            difficulty=int(data.get("difficulty", 3)),
            source=data.get("source", "manual"),
            shape_type=data.get("shape_type", "point"),
            radius_km=float(data.get("radius_km", 0) or 0),
            area_geojson=data.get("area_geojson"),
            verify_status="approved",
        )
        db.add(poi)
        db.commit()
        db.refresh(poi)
        return _poi_to_dict(poi)

    def update_poi(self, db: Session, poi_id: int, data: dict) -> dict:
        poi = db.query(POI).filter(POI.id == poi_id).first()
        if not poi:
            raise ValueError("POI 不存在")
        for field in ("name", "category", "adcode", "address", "summary", "cover_url",
                      "hint_text", "source", "shape_type", "area_geojson",
                      "contributor_nickname", "verify_status"):
            if field in data:
                setattr(poi, field, data[field])
        if "lng" in data:
            poi.lng = float(data["lng"])
        if "lat" in data:
            poi.lat = float(data["lat"])
        if "difficulty" in data:
            poi.difficulty = int(data["difficulty"])
        if "radius_km" in data:
            poi.radius_km = float(data["radius_km"] or 0)
        # 管理员编辑保存即视为已核定区域/半径
        poi.area_review = 0
        db.commit()
        db.refresh(poi)
        return _poi_to_dict(poi)

    def delete_poi(self, db: Session, poi_id: int) -> None:
        poi = db.query(POI).filter(POI.id == poi_id).first()
        if not poi:
            raise ValueError("POI 不存在")
        # 被引用的 POI 连同引用的游戏记录/PK 对局一起删除，
        # 否则 MySQL 外键约束会拒绝删除（errno 1451）
        db.query(GameRecord).filter(GameRecord.target_poi_id == poi_id).delete(
            synchronize_session=False)
        db.query(PKGame).filter(PKGame.target_poi_id == poi_id).delete(
            synchronize_session=False)
        db.delete(poi)
        db.commit()

    def confirm_poi_area(self, db: Session, poi_id: int) -> dict:
        """手动核定：将待核定的区域/半径标记为已确认。"""
        poi = db.query(POI).filter(POI.id == poi_id).first()
        if not poi:
            raise ValueError("POI 不存在")
        poi.area_review = 0
        db.commit()
        db.refresh(poi)
        return _poi_to_dict(poi)

    # ===== UGC 投稿 =====

    def create_submission(self, db: Session, data: dict) -> dict:
        # 防滥用：同一 session_id 当日 ≤5 条
        today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        today_count = db.query(POISubmission).filter(
            POISubmission.session_id == data["session_id"],
            POISubmission.submitted_at >= today_start,
        ).count()
        if today_count >= 5:
            raise ValueError("今日提交已达上限（5 条），请明天再试")

        sub = POISubmission(
            session_id=data["session_id"],
            nickname=data.get("nickname"),
            name=data["name"],
            province_code=data.get("province_code"),
            category=data.get("category"),
            lng=float(data["lng"]),
            lat=float(data["lat"]),
            description=data.get("description"),
            cover_url=data.get("cover_url"),
            suggested_shape_type=data.get("suggested_shape_type", "point"),
            suggested_radius_km=float(data.get("suggested_radius_km", 0) or 0),
            suggested_area_geojson=data.get("suggested_area_geojson"),
        )
        db.add(sub)
        db.commit()
        db.refresh(sub)
        return _submission_to_dict(sub)

    # ===== POI 纠正 =====

    def create_correction(self, db: Session, data: dict) -> dict:
        """用户提交纠正快照（不直接修改 POI）"""
        poi = db.query(POI).filter(POI.id == data["poi_id"]).first()
        if not poi:
            raise ValueError("要纠正的地点不存在")

        # 防滥用：同一 session_id 当日纠正 ≤5 条
        today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        today_count = db.query(POICorrection).filter(
            POICorrection.session_id == data["session_id"],
            POICorrection.created_at >= today_start,
        ).count()
        if today_count >= 5:
            raise ValueError("今日纠正已达上限（5 条），请明天再试")

        def _opt_str(v: str | None, limit: int | None = None) -> str | None:
            v = (v or "").strip()
            if not v or v == "-":
                return None
            return v[:limit] if limit else v

        lng = data.get("lng")
        lat = data.get("lat")
        c = POICorrection(
            poi_id=poi.id,
            session_id=data["session_id"],
            nickname=_opt_str(data.get("nickname"), 32),
            name=_opt_str(data.get("name"), 128),
            category=_opt_str(data.get("category"), 32),
            lng=float(lng) if lng is not None else None,
            lat=float(lat) if lat is not None else None,
            description=_opt_str(data.get("description")),
            cover_url=_opt_str(data.get("cover_url"), 512),
            suggested_shape_type=_opt_str(data.get("suggested_shape_type"), 10),
            suggested_radius_km=float(data["suggested_radius_km"]) if data.get("suggested_radius_km") is not None else None,
            suggested_area_geojson=data.get("suggested_area_geojson") or None,
        )
        db.add(c)
        db.commit()
        db.refresh(c)
        return _correction_to_dict(c)

    def list_corrections(self, db: Session, status: str | None,
                         page: int, page_size: int) -> dict:
        """后台纠正列表（附原 POI 当前值供对照）"""
        q = db.query(POICorrection)
        if status:
            q = q.filter(POICorrection.status == status)
        total = q.count()
        rows = (
            q.order_by(POICorrection.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        items = []
        for r in rows:
            item = _correction_to_dict(r)
            poi = db.query(POI).filter(POI.id == r.poi_id).first()
            if poi:
                item["poi_current"] = {
                    "name": poi.name,
                    "category": poi.category,
                    "lng": poi.lng,
                    "lat": poi.lat,
                    "summary": poi.summary,
                    "cover_url": poi.cover_url,
                    "shape_type": poi.shape_type,
                    "radius_km": poi.radius_km,
                    "area_geojson": poi.area_geojson,
                }
            items.append(item)
        return {"total": total, "page": page, "page_size": page_size, "items": items}

    def adopt_correction(self, db: Session, correction_id: int) -> dict:
        """采纳：将纠正快照整体写回 POI（仅覆盖用户提交的字段）"""
        c = db.query(POICorrection).filter(POICorrection.id == correction_id).first()
        if not c:
            raise ValueError("纠正记录不存在")
        if c.status != "pending":
            raise ValueError("该纠正已处理")
        poi = db.query(POI).filter(POI.id == c.poi_id).first()
        if not poi:
            raise ValueError("POI 不存在")

        if c.name is not None:
            poi.name = c.name
        if c.category is not None:
            poi.category = c.category
        if c.lng is not None:
            poi.lng = c.lng
        if c.lat is not None:
            poi.lat = c.lat
        if c.description is not None:
            poi.summary = c.description
        if c.cover_url is not None:
            poi.cover_url = c.cover_url
        if c.suggested_shape_type is not None:
            poi.shape_type = c.suggested_shape_type
        if c.suggested_radius_km is not None:
            poi.radius_km = c.suggested_radius_km
        if c.suggested_area_geojson is not None:
            poi.area_geojson = c.suggested_area_geojson

        c.status = "adopted"
        c.adopted_at = datetime.now()
        db.commit()
        db.refresh(c)
        return _correction_to_dict(c)

    def reject_correction(self, db: Session, correction_id: int, note: str | None) -> dict:
        c = db.query(POICorrection).filter(POICorrection.id == correction_id).first()
        if not c:
            raise ValueError("纠正记录不存在")
        if c.status != "pending":
            raise ValueError("该纠正已处理")
        c.status = "rejected"
        c.reviewer_note = (note or "").strip()[:256] or None
        db.commit()
        db.refresh(c)
        return _correction_to_dict(c)

    def list_submissions(self, db: Session, status: str | None,
                         page: int, page_size: int) -> dict:
        q = db.query(POISubmission)
        if status:
            q = q.filter(POISubmission.status == status)
        total = q.count()
        rows = (
            q.order_by(POISubmission.submitted_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": [_submission_to_dict(r) for r in rows],
        }

    def approve_submission(self, db: Session, sub_id: int, data: dict) -> dict:
        sub = db.query(POISubmission).filter(POISubmission.id == sub_id).first()
        if not sub:
            raise ValueError("投稿不存在")
        if sub.status != "pending":
            raise ValueError("该投稿已处理")

        # 创建 POI 入库（允许审核员覆盖字段）
        poi = POI(
            name=data.get("name", sub.name),
            category=data.get("category", sub.category),
            lng=float(data.get("lng", sub.lng)),
            lat=float(data.get("lat", sub.lat)),
            adcode=data.get("adcode") or sub.province_code,
            address=data.get("address"),
            summary=data.get("summary", sub.description),
            cover_url=data.get("cover_url", sub.cover_url),
            hint_text=data.get("hint_text"),
            difficulty=int(data.get("difficulty", 3)),
            source="ugc",
            submitted_by=sub.session_id,
            contributor_nickname=data.get("contributor_nickname", sub.nickname),
            shape_type=data.get("shape_type", sub.suggested_shape_type),
            radius_km=float(data.get("radius_km", sub.suggested_radius_km) or 0),
            area_geojson=data.get("area_geojson", sub.suggested_area_geojson),
            verify_status="approved",
            area_review=0,
        )
        db.add(poi)

        sub.status = "approved"
        sub.reviewed_at = datetime.now()
        db.commit()
        db.refresh(poi)
        return {"ok": True, "poi_id": poi.id}

    def reject_submission(self, db: Session, sub_id: int, note: str) -> dict:
        sub = db.query(POISubmission).filter(POISubmission.id == sub_id).first()
        if not sub:
            raise ValueError("投稿不存在")
        if sub.status != "pending":
            raise ValueError("该投稿已处理")
        sub.status = "rejected"
        sub.reviewer_note = note
        sub.reviewed_at = datetime.now()
        db.commit()
        return {"ok": True}

    # ===== 专题管理 =====

    @staticmethod
    def _collection_to_dict(coll: Collection, point_count: int, medal_count: int) -> dict:
        return {
            "id": coll.id,
            "code": coll.code,
            "name": coll.name,
            "description": coll.description,
            "icon": coll.icon,
            "cover_url": coll.cover_url,
            "geometry": coll.geometry,
            "difficulty_star": coll.difficulty_star,
            "unlock_require": coll.unlock_require,
            "audit_status": coll.audit_status,
            "sort_order": coll.sort_order,
            "enabled": coll.enabled,
            "point_count": point_count,
            "medal_count": medal_count,
            "created_at": coll.created_at.isoformat() if coll.created_at else None,
        }

    def list_collections(self, db: Session, keyword: str | None, star: int | None,
                         audit_status: str | None, page: int, page_size: int,
                         sort_by: str = "code", sort_order: str = "asc") -> dict:
        q = db.query(Collection)
        if keyword:
            like = f"%{keyword}%"
            q = q.filter(or_(Collection.name.like(like), Collection.code.like(like)))
        if star:
            q = q.filter(Collection.difficulty_star == star)
        if audit_status:
            q = q.filter(Collection.audit_status == audit_status)

        point_count = (
            db.query(sa_func.count(CollectionPoi.id))
            .filter(CollectionPoi.collection_id == Collection.id)
            .correlate(Collection)
            .scalar_subquery()
        )
        medal_count = (
            db.query(sa_func.count(Medal.id))
            .filter(Medal.collection_id == Collection.id)
            .correlate(Collection)
            .scalar_subquery()
        )
        sort_columns = {
            "id": Collection.id,
            "code": Collection.code,
            "name": Collection.name,
            "difficulty_star": Collection.difficulty_star,
            "unlock_require": Collection.unlock_require,
            "audit_status": Collection.audit_status,
            "point_count": point_count,
            "medal_count": medal_count,
            "sort_order": Collection.sort_order,
            "enabled": Collection.enabled,
            "created_at": Collection.created_at,
        }
        sort_column = sort_columns.get(sort_by, Collection.code)
        sort_expression = sort_column.desc() if sort_order == "desc" else sort_column.asc()

        total = q.count()
        rows = (
            q.order_by(sort_expression, Collection.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        ids = [c.id for c in rows]
        point_counts = {}
        medal_counts = {}
        if ids:
            point_counts = dict(
                db.query(CollectionPoi.collection_id, sa_func.count(CollectionPoi.id))
                .filter(CollectionPoi.collection_id.in_(ids))
                .group_by(CollectionPoi.collection_id)
                .all()
            )
            medal_counts = dict(
                db.query(Medal.collection_id, sa_func.count(Medal.id))
                .filter(Medal.collection_id.in_(ids))
                .group_by(Medal.collection_id)
                .all()
            )
        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": [
                self._collection_to_dict(c, point_counts.get(c.id, 0), medal_counts.get(c.id, 0))
                for c in rows
            ],
        }

    def create_collection(self, db: Session, data: dict) -> dict:
        if db.query(Collection).filter(Collection.code == data["code"]).first():
            raise ValueError("专题 code 已存在")
        coll = Collection(
            code=data["code"],
            name=data["name"],
            description=data.get("description"),
            icon=data.get("icon"),
            cover_url=data.get("cover_url"),
            geometry=data.get("geometry"),
            difficulty_star=int(data.get("difficulty_star", 1)),
            unlock_require=int(data.get("unlock_require", 0)),
            audit_status=data.get("audit_status", "pending"),
            sort_order=int(data.get("sort_order", 0)),
            enabled=bool(data.get("enabled", True)),
            created_at=datetime.now(),
        )
        db.add(coll)
        db.commit()
        db.refresh(coll)
        return {"id": coll.id, "code": coll.code}

    def update_collection(self, db: Session, coll_id: int, data: dict) -> dict:
        coll = db.query(Collection).filter(Collection.id == coll_id).first()
        if not coll:
            raise ValueError("专题不存在")
        for field in ("name", "description", "icon", "cover_url", "geometry",
                      "audit_status", "code"):
            if field in data:
                setattr(coll, field, data[field])
        if "difficulty_star" in data:
            coll.difficulty_star = int(data["difficulty_star"])
        if "unlock_require" in data:
            coll.unlock_require = int(data["unlock_require"])
        if "sort_order" in data:
            coll.sort_order = int(data["sort_order"])
        if "enabled" in data:
            coll.enabled = bool(data["enabled"])
        db.commit()
        return {"ok": True}

    def delete_collection(self, db: Session, coll_id: int) -> None:
        coll = db.query(Collection).filter(Collection.id == coll_id).first()
        if not coll:
            raise ValueError("专题不存在")
        medal_ids = [r[0] for r in db.query(Medal.id).filter(Medal.collection_id == coll_id).all()]
        if medal_ids:
            db.query(UserMedal).filter(UserMedal.medal_id.in_(medal_ids)).delete(synchronize_session=False)
            db.query(MedalRecord).filter(MedalRecord.medal_id.in_(medal_ids)).delete(synchronize_session=False)
        db.query(Medal).filter(Medal.collection_id == coll_id).delete(synchronize_session=False)
        db.query(CollectionPoi).filter(CollectionPoi.collection_id == coll_id).delete(synchronize_session=False)
        db.delete(coll)
        db.commit()

    def list_collection_pois(self, db: Session, coll_id: int) -> dict:
        coll = db.query(Collection).filter(Collection.id == coll_id).first()
        if not coll:
            raise ValueError("专题不存在")
        rows = (
            db.query(CollectionPoi, POI)
            .join(POI, CollectionPoi.poi_id == POI.id)
            .filter(CollectionPoi.collection_id == coll_id)
            .order_by(CollectionPoi.sort_order)
            .all()
        )
        return {
            "collection_id": coll_id,
            "items": [
                {
                    "poi_id": poi.id,
                    "name": poi.name,
                    "lng": poi.lng,
                    "lat": poi.lat,
                    "cover_url": poi.cover_url,
                    "difficulty": poi.difficulty,
                    "sort_order": cp.sort_order,
                }
                for cp, poi in rows
            ],
        }

    def set_collection_pois(self, db: Session, coll_id: int, poi_ids: list[int]) -> dict:
        coll = db.query(Collection).filter(Collection.id == coll_id).first()
        if not coll:
            raise ValueError("专题不存在")
        # 保序去重
        seen: set[int] = set()
        unique_ids: list[int] = []
        for pid in poi_ids:
            if pid not in seen:
                seen.add(pid)
                unique_ids.append(pid)
        # 校验 POI 都存在
        valid = {r[0] for r in db.query(POI.id).filter(POI.id.in_(unique_ids)).all()}
        if len(valid) != len(unique_ids):
            raise ValueError("存在无效的 POI")
        # 整体替换
        db.query(CollectionPoi).filter(CollectionPoi.collection_id == coll_id).delete(synchronize_session=False)
        for idx, pid in enumerate(unique_ids):
            db.add(CollectionPoi(
                collection_id=coll_id, poi_id=pid, sort_order=idx, created_at=datetime.now(),
            ))
        db.commit()
        return {"ok": True, "count": len(unique_ids)}

    # ===== 用户管理 =====

    @staticmethod
    def _user_to_dict(u: User) -> dict:
        return {
            "id": u.id,
            "email": u.email,
            "nickname": u.nickname,
            "avatar_url": u.avatar_url,
            "total_medals": u.total_medals or 0,
            "is_admin": bool(u.is_admin),
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "updated_at": u.updated_at.isoformat() if u.updated_at else None,
        }

    def list_users(self, db: Session, keyword: str | None,
                   page: int, page_size: int) -> dict:
        q = db.query(User)
        if keyword:
            like = f"%{keyword}%"
            q = q.filter(or_(User.email.like(like), User.nickname.like(like)))
        total = q.count()
        rows = (
            q.order_by(User.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": [self._user_to_dict(u) for u in rows],
        }

    def update_user(self, db: Session, user_id: int, data: dict) -> dict:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise ValueError("用户不存在")
        if "is_admin" in data:
            user.is_admin = bool(data["is_admin"])
        if "nickname" in data and data["nickname"]:
            nick = data["nickname"].strip()
            exists = db.query(User.id).filter(User.nickname == nick, User.id != user_id).first()
            if exists:
                raise ValueError("昵称已被占用")
            user.nickname = nick
        if "total_medals" in data:
            user.total_medals = int(data["total_medals"] or 0)
        db.commit()
        return {"ok": True}

    def delete_user(self, db: Session, user_id: int) -> None:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise ValueError("用户不存在")
        db.query(UserMedal).filter(UserMedal.user_id == user_id).delete(synchronize_session=False)
        db.query(MedalRecord).filter(MedalRecord.user_id == user_id).delete(synchronize_session=False)
        db.delete(user)
        db.commit()

    # ===== 用户勋章详情 =====

    @staticmethod
    def get_user_medals(db: Session, user_id: int) -> list[dict]:
        """返回用户所有勋章，含专题名、勋章名、难度、玩法、最快用时、获取时间。"""
        rows = (
            db.query(
                Medal.name.label("medal_name"),
                Medal.difficulty,
                Medal.game_type,
                Collection.name.label("collection_name"),
                Collection.code.label("collection_code"),
                UserMedal.total_time_sec,
                UserMedal.earned_at,
            )
            .join(Medal, Medal.id == UserMedal.medal_id)
            .join(Collection, Collection.id == Medal.collection_id)
            .filter(UserMedal.user_id == user_id)
            .order_by(UserMedal.earned_at.desc())
            .all()
        )
        return [
            {
                "medal_name": r[0],
                "difficulty": r[1],
                "game_type": r[2],
                "collection_name": r[3],
                "collection_code": r[4],
                "total_time_sec": r[5],
                "earned_at": r[6].strftime("%Y-%m-%d %H:%M") if r[6] else None,
            }
            for r in rows
        ]

    # ===== 专题用时排行 =====

    @staticmethod
    def get_collection_leaderboard(db: Session, collection_id: int, difficulty: str, limit: int = 50) -> list[dict]:
        """专题用时排行（点选/巡航分开），取每个用户最快用时。"""
        from sqlalchemy import func as sa_func
        rn = sa_func.row_number().over(
            partition_by=UserMedal.user_id,
            order_by=(UserMedal.total_time_sec.asc(), UserMedal.earned_at.asc()),
        ).label("rn")
        inner = (
            db.query(
                UserMedal.user_id.label("uid"),
                UserMedal.total_time_sec,
                UserMedal.earned_at,
                Medal.game_type,
                rn,
            )
            .join(Medal, Medal.id == UserMedal.medal_id)
            .filter(
                Medal.collection_id == collection_id,
                Medal.difficulty == difficulty,
            )
            .subquery()
        )
        rows = (
            db.query(User.id, User.nickname, inner.c.total_time_sec,
                     inner.c.earned_at, inner.c.game_type)
            .join(inner, inner.c.uid == User.id)
            .filter(inner.c.rn == 1)
            .order_by(inner.c.total_time_sec.asc(), inner.c.earned_at.asc())
            .limit(limit)
            .all()
        )
        return [
            {"rank": i + 1, "user_id": r[0], "nickname": r[1],
             "total_time_sec": r[2],
             "earned_at": r[3].strftime("%Y-%m-%d") if r[3] else None,
             "game_type": r[4]}
            for i, r in enumerate(rows)
        ]

    # ===== POI 用时排行 =====

    @staticmethod
    def get_poi_leaderboard(db: Session, poi_id: int, collection_id: int,
                            difficulty: str, limit: int = 50) -> list[dict]:
        """POI 用时排行。从该专题的 MedalRecord.point_times 中提取对应 POI 位置的最快用时。"""
        # 1. 找到 POI 在该专题中的位置（sort_order 从 0 开始）
        cp = (
            db.query(CollectionPoi.sort_order)
            .filter(
                CollectionPoi.collection_id == collection_id,
                CollectionPoi.poi_id == poi_id,
            )
            .first()
        )
        if not cp:
            raise ValueError("该 POI 不属于此专题")
        pos = cp[0]  # sort_order 从 0 开始

        # 2. 查询该专题+难度所有 MedalRecord，提取 point_times[pos]
        recs = (
            db.query(
                UserMedal.user_id, User.nickname,
                UserMedal.total_time_sec, UserMedal.earned_at,
                MedalRecord.point_times,
            )
            .join(MedalRecord, MedalRecord.user_id == UserMedal.user_id,
                  MedalRecord.medal_id == UserMedal.medal_id)
            .join(Medal, Medal.id == UserMedal.medal_id)
            .join(User, User.id == UserMedal.user_id)
            .filter(
                Medal.collection_id == collection_id,
                Medal.difficulty == difficulty,
                MedalRecord.point_times.isnot(None),
            )
            .all()
        )

        # 3. Python 侧提取 POI 用时，取每个用户最佳
        best: dict[int, dict] = {}
        for uid, nick, total_sec, earned_at, pt in recs:
            if not pt or pos >= len(pt):
                continue
            poi_time = pt[pos]
            if uid not in best or poi_time < best[uid]["poi_time_sec"]:
                best[uid] = {
                    "user_id": uid, "nickname": nick,
                    "poi_time_sec": poi_time,
                    "total_time_sec": total_sec,
                    "earned_at": earned_at,
                }

        sorted_best = sorted(best.values(), key=lambda x: (x["poi_time_sec"], x["earned_at"] or ""))
        return [
            {"rank": i + 1, "user_id": r["user_id"], "nickname": r["nickname"],
             "poi_time_sec": r["poi_time_sec"],
             "total_time_sec": r["total_time_sec"],
             "earned_at": r["earned_at"].strftime("%Y-%m-%d") if r["earned_at"] else None}
            for i, r in enumerate(sorted_best[:limit])
        ]

    # ===== 新闻时间线管理 =====

    @staticmethod
    def _news_poi_to_dict(p: NewsPoi) -> dict:
        return {
            "id": p.id,
            "timeline_id": p.timeline_id,
            "name": p.name,
            "event_date": p.event_date,
            "event_text": p.event_text,
            "fact_text": p.fact_text,
            "hint_text": p.hint_text,
            "link_url": p.link_url,
            "link_source": p.link_source,
            "lng": p.lng,
            "lat": p.lat,
            "region": p.region,
            "difficulty": p.difficulty,
            "cover_url": p.cover_url,
            "sort_order": p.sort_order,
            "verified": bool(p.verified),
            "status": p.status,
        }

    def list_news_timelines(self, db: Session, keyword: str | None,
                            audit_status: str | None) -> list[dict]:
        q = db.query(NewsTimeline)
        if keyword:
            like = f"%{keyword}%"
            q = q.filter(or_(NewsTimeline.name.like(like), NewsTimeline.code.like(like)))
        if audit_status:
            q = q.filter(NewsTimeline.audit_status == audit_status)
        rows = q.order_by(NewsTimeline.sort_order.asc(), NewsTimeline.id.asc()).all()
        items = []
        for t in rows:
            poi_count = len(t.pois)
            approved_count = sum(1 for p in t.pois if p.status == "approved")
            verified_count = sum(1 for p in t.pois if p.verified)
            items.append({
                "id": t.id, "code": t.code, "name": t.name,
                "description": t.description, "color": t.color,
                "cover_url": t.cover_url,
                "medal_icon_url": t.medal_icon_url,
                "batch": t.batch,
                "sort_order": t.sort_order,
                "audit_status": t.audit_status, "enabled": bool(t.enabled),
                "poi_count": poi_count,
                "approved_count": approved_count,
                "verified_count": verified_count,
            })
        return items

    def create_news_timeline(self, db: Session, data: dict) -> dict:
        if db.query(NewsTimeline).filter(NewsTimeline.code == data["code"]).first():
            raise ValueError("时间线 code 已存在")
        t = NewsTimeline(
            code=data["code"], name=data["name"],
            description=data.get("description"), color=data.get("color"),
            cover_url=data.get("cover_url"),
            medal_icon_url=data.get("medal_icon_url"),
            batch=data.get("batch"),
            sort_order=int(data.get("sort_order", 0)),
            audit_status=data.get("audit_status", "pending"),
            enabled=bool(data.get("enabled", True)),
        )
        db.add(t)
        db.commit()
        db.refresh(t)
        return {"id": t.id, "code": t.code}

    def update_news_timeline(self, db: Session, timeline_id: int, data: dict) -> dict:
        t = db.query(NewsTimeline).filter(NewsTimeline.id == timeline_id).first()
        if not t:
            raise ValueError("时间线不存在")
        if "code" in data and data["code"] != t.code:
            exists = db.query(NewsTimeline).filter(
                NewsTimeline.code == data["code"], NewsTimeline.id != timeline_id
            ).first()
            if exists:
                raise ValueError("时间线 code 已存在")
            t.code = data["code"]
        for field in ("name", "description", "color", "cover_url", "medal_icon_url", "batch", "audit_status"):
            if field in data:
                setattr(t, field, data[field])
        if "sort_order" in data:
            t.sort_order = int(data["sort_order"])
        if "enabled" in data:
            t.enabled = bool(data["enabled"])
        db.commit()
        return {"ok": True}

    def delete_news_timeline(self, db: Session, timeline_id: int) -> None:
        t = db.query(NewsTimeline).filter(NewsTimeline.id == timeline_id).first()
        if not t:
            raise ValueError("时间线不存在")
        db.delete(t)
        db.commit()

    def list_news_pois(self, db: Session, timeline_id: int) -> list[dict]:
        rows = (
            db.query(NewsPoi)
            .filter(NewsPoi.timeline_id == timeline_id)
            .order_by(NewsPoi.sort_order.asc(), NewsPoi.id.asc())
            .all()
        )
        return [self._news_poi_to_dict(p) for p in rows]

    def create_news_poi(self, db: Session, data: dict) -> dict:
        t = db.query(NewsTimeline).filter(NewsTimeline.id == data["timeline_id"]).first()
        if not t:
            raise ValueError("时间线不存在")
        p = NewsPoi(
            timeline_id=data["timeline_id"], name=data["name"],
            event_date=data.get("event_date"), event_text=data.get("event_text"),
            fact_text=data.get("fact_text"), hint_text=data.get("hint_text"),
            link_url=data.get("link_url"), link_source=data.get("link_source"),
            lng=float(data["lng"]), lat=float(data["lat"]),
            region=data.get("region"),
            difficulty=int(data.get("difficulty", 3)),
            cover_url=data.get("cover_url"),
            sort_order=int(data.get("sort_order", 0)),
            verified=bool(data.get("verified", False)),
            status=data.get("status", "pending"),
        )
        db.add(p)
        db.commit()
        db.refresh(p)
        return {"id": p.id}

    def update_news_poi(self, db: Session, poi_id: int, data: dict) -> dict:
        p = db.query(NewsPoi).filter(NewsPoi.id == poi_id).first()
        if not p:
            raise ValueError("新闻点不存在")
        for field in ("name", "event_date", "event_text", "fact_text", "hint_text",
                      "link_url", "link_source", "region", "cover_url", "status"):
            if field in data:
                setattr(p, field, data[field])
        if "lng" in data:
            p.lng = float(data["lng"])
        if "lat" in data:
            p.lat = float(data["lat"])
        if "difficulty" in data:
            p.difficulty = int(data["difficulty"])
        if "sort_order" in data:
            p.sort_order = int(data["sort_order"])
        if "verified" in data:
            p.verified = bool(data["verified"])
        db.commit()
        return {"ok": True}

    def delete_news_poi(self, db: Session, poi_id: int) -> None:
        p = db.query(NewsPoi).filter(NewsPoi.id == poi_id).first()
        if not p:
            raise ValueError("新闻点不存在")
        db.delete(p)
        db.commit()

    def news_stats(self, db: Session) -> dict:
        pending = db.query(sa_func.count(NewsPoi.id)).filter(
            NewsPoi.status == "pending"
        ).scalar() or 0
        unverified = db.query(sa_func.count(NewsPoi.id)).filter(
            NewsPoi.verified.is_(False)
        ).scalar() or 0
        timelines = db.query(sa_func.count(NewsTimeline.id)).scalar() or 0
        pois = db.query(sa_func.count(NewsPoi.id)).scalar() or 0
        plays = db.query(sa_func.count(NewsProgress.id)).scalar() or 0
        return {
            "pending_pois": pending,
            "unverified_pois": unverified,
            "timelines": timelines,
            "pois": pois,
            "found_records": plays,
        }


admin_service = AdminService()
