# -*- coding: utf-8 -*-
"""专题模式服务：解锁校验、勋章发放、专题流程、勋章墙、排行榜。

每个专题点位本质上是一局 mode=national 的单局（复用 GameRecord），
专题层负责"串联多局 + 记录总用时 + 发勋章"。专题进度通过 player_sessions
（collection_id + point_index）记录，便于未登录玩家按 session_id 聚合。
"""
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import asc, desc, func
from sqlalchemy.orm import Session
from loguru import logger

from ..models import (
    Collection,
    CollectionPoi,
    GameRecord,
    Medal,
    MedalRecord,
    PlayerSession,
    POI,
    User,
    UserMedal,
)
from .game import CHINA_CENTER, cover_url_for, effective_time_limit, game_service

# 星级默认解锁要求（已完成前一星级专题数）
DEFAULT_REQUIRE: dict[int, int] = {
    1: 0,
    2: 2,
    3: 3,
    4: 3,
    5: 4,
    6: 4,
    7: 5,
    8: 5,
}


# ===== 解锁 =====

def is_unlocked(db: Session, user: User | None, collection: Collection,
                session_id: str | None = None) -> bool:
    """星级解锁校验。★1 默认开放；其余需完成 N 个前一星级专题。

    完成计数 = distinct collection_id（user_medals 中的 hard 完成数 ∪
    player_sessions 中该用户/会话的完成数），全部限定在 star-1 星级。
    """
    star = collection.difficulty_star
    if star <= 1:
        return True

    prev_star = star - 1
    prev_collection_ids = [
        r[0] for r in db.query(Collection.id).filter(
            Collection.difficulty_star == prev_star,
            Collection.audit_status == "approved",
        ).all()
    ]
    if not prev_collection_ids:
        return False

    completed: set[int] = set()

    # hard 完成数（仅登录用户）
    if user:
        rows = db.query(UserMedal.medal_id).join(Medal).filter(
            UserMedal.user_id == user.id,
            Medal.collection_id.in_(prev_collection_ids),
        ).all()
        medal_ids = {r[0] for r in rows}
        if medal_ids:
            coll_rows = db.query(Medal.collection_id).filter(
                Medal.id.in_(medal_ids)
            ).distinct().all()
            completed.update(r[0] for r in coll_rows)

    # player_sessions 完成数（登录按 user_id，未登录按 session_id）
    sess_q = db.query(PlayerSession.collection_id).filter(
        PlayerSession.won.is_(True),
        PlayerSession.collection_id.in_(prev_collection_ids),
    )
    if user:
        # 登录用户：按 user_id（若有）或 session_id
        sess_q = sess_q.filter(
            (PlayerSession.nickname == user.nickname)
        )
    elif session_id:
        sess_q = sess_q.filter(PlayerSession.session_id == session_id)
    else:
        return False

    sess_rows = sess_q.distinct().all()
    completed.update(r[0] for r in sess_rows)

    require = collection.unlock_require or DEFAULT_REQUIRE.get(star, 0)
    return len(completed) >= require


# ===== 勋章发放 =====

def award_medal(db: Session, user: User, medal: Medal,
                total_time_sec: int, point_times: list[int] | None,
                is_win: bool = True) -> bool:
    """发放/刷新勋章。点选(easy)与巡航(hard)均可获得。

    - 新获得：写 user_medals + 写流水；user.total_medals += 1。
    - 更快用时：更新 user_medals.total_time_sec + 写流水。
    - 更慢用时：不更新、不写流水。
    返回是否产生新记录（新获得或刷新）。
    """
    um = db.query(UserMedal).filter(
        UserMedal.user_id == user.id, UserMedal.medal_id == medal.id
    ).first()

    if um is None:
        logger.info(
            f"[勋章] 新获得 medal_id={medal.id} collection_id={medal.collection_id} "
            f"difficulty={medal.difficulty} game_type={medal.game_type} "
            f"user_id={user.id} time={total_time_sec}s"
        )
        um = UserMedal(
            user_id=user.id, medal_id=medal.id,
            total_time_sec=total_time_sec,
            earned_at=datetime.now(), updated_at=datetime.now(),
        )
        db.add(um)
        user.total_medals = (user.total_medals or 0) + 1
    elif total_time_sec < um.total_time_sec:
        logger.info(
            f"[勋章] 刷新最佳 medal_id={medal.id} user_id={user.id} "
            f"{um.total_time_sec}s -> {total_time_sec}s"
        )
        um.total_time_sec = total_time_sec
        um.updated_at = datetime.now()
    else:
        logger.info(
            f"[勋章] 更慢不刷新 medal_id={medal.id} user_id={user.id} "
            f"本次{total_time_sec}s >= 已有{um.total_time_sec}s"
        )
        return False  # 更慢，不刷新

    db.add(MedalRecord(
        user_id=user.id, medal_id=medal.id,
        total_time_sec=total_time_sec,
        point_times=point_times, is_win=is_win,
        earned_at=datetime.now(),
    ))
    db.commit()
    db.refresh(user)
    db.refresh(um) if um.id else None
    return True


# ===== 专题流程 =====

class CollectionService:
    def get_collection_by_code(self, db: Session, code: str) -> Collection | None:
        return db.query(Collection).filter(Collection.code == code).first()

    def get_ordered_pois(self, db: Session, collection_id: int) -> list[POI]:
        rows = (
            db.query(CollectionPoi, POI)
            .join(POI, CollectionPoi.poi_id == POI.id)
            .filter(CollectionPoi.collection_id == collection_id)
            .order_by(asc(CollectionPoi.sort_order))
            .all()
        )
        return [poi for _, poi in rows]

    # ---- 列表 / 详情 ----

    def list_collections(self, db: Session, user: User | None,
                         session_id: str | None = None,
                         star: int | None = None,
                         page: int = 1, page_size: int = 100) -> dict:
        q = db.query(Collection).filter(
            Collection.enabled.is_(True),
            Collection.audit_status == "approved",
        )
        if star:
            q = q.filter(Collection.difficulty_star == star)
        q = q.order_by(asc(Collection.difficulty_star), asc(Collection.sort_order))
        total = q.count()
        collections = q.limit(page_size).offset((page - 1) * page_size).all()

        # 按星级分组
        groups: dict[int, list[dict]] = {}
        for c in collections:
            unlocked = is_unlocked(db, user, c, session_id)
            point_count = db.query(func.count(CollectionPoi.id)).filter(
                CollectionPoi.collection_id == c.id
            ).scalar() or 0
            item = {
                "id": c.id,
                "code": c.code,
                "name": c.name,
                "icon": c.icon,
                "cover_url": c.cover_url,
                "difficulty_star": c.difficulty_star,
                "point_count": point_count,
                "geometry": c.geometry,
                "unlocked": unlocked,
                "unlock_require": c.unlock_require or DEFAULT_REQUIRE.get(c.difficulty_star, 0),
            }
            groups.setdefault(c.difficulty_star, []).append(item)

        # 计算每个星级的已完成数
        result_groups = []
        for s in sorted(groups.keys()):
            if user:
                done = self._count_done_by_star(db, user, None, s)
            elif session_id:
                done = self._count_done_by_star(db, None, session_id, s)
            else:
                done = 0
            result_groups.append({
                "star": s,
                "completed": done,
                "collections": groups[s],
            })

        return {"groups": result_groups, "total": total}

    def _count_done_by_star(self, db: Session, user: User | None,
                            session_id: str | None, star: int) -> int:
        """统计某星级已完成的不重复专题数（user_medals ∪ player_sessions）"""
        coll_ids = [r[0] for r in db.query(Collection.id).filter(
            Collection.difficulty_star == star,
            Collection.audit_status == "approved",
        ).all()]
        if not coll_ids:
            return 0
        done: set[int] = set()
        if user:
            r1 = db.query(Medal.collection_id).join(UserMedal, UserMedal.medal_id == Medal.id).filter(
                UserMedal.user_id == user.id,
                Medal.collection_id.in_(coll_ids),
            ).distinct().all()
            done.update(x[0] for x in r1)
            r2 = db.query(PlayerSession.collection_id).filter(
                PlayerSession.won.is_(True),
                PlayerSession.collection_id.in_(coll_ids),
                PlayerSession.nickname == user.nickname,
            ).distinct().all()
            done.update(x[0] for x in r2)
        elif session_id:
            r2 = db.query(PlayerSession.collection_id).filter(
                PlayerSession.won.is_(True),
                PlayerSession.collection_id.in_(coll_ids),
                PlayerSession.session_id == session_id,
            ).distinct().all()
            done.update(x[0] for x in r2)
        return len(done)

    def get_detail(self, db: Session, code: str, user: User | None,
                   session_id: str | None = None) -> dict | None:
        c = self.get_collection_by_code(db, code)
        if not c:
            return None
        pois = self.get_ordered_pois(db, c.id)
        unlocked = is_unlocked(db, user, c, session_id)

        # 平均用时 + 完成率（基于 user_medals 与 medal_records 聚合）
        avg_time, finish_rate = self._calc_stats(db, c.id, len(pois))

        return {
            "id": c.id,
            "code": c.code,
            "name": c.name,
            "description": c.description,
            "icon": c.icon,
            "cover_url": c.cover_url,
            "geometry": c.geometry,
            "difficulty_star": c.difficulty_star,
            "point_count": len(pois),
            "unlocked": unlocked,
            "unlock_require": c.unlock_require or DEFAULT_REQUIRE.get(c.difficulty_star, 0),
            "avg_time_sec": avg_time,
            "finish_rate": finish_rate,
            "points": [{"name": p.name, "lng": p.lng, "lat": p.lat} for p in pois],
        }

    def _calc_stats(self, db: Session, collection_id: int, point_count: int) -> tuple[int, float]:
        """平均用时 + 完成率（粗略：基于该专题的 medal_records）"""
        if point_count == 0:
            return 0, 0.0
        rows = db.query(MedalRecord.total_time_sec).join(Medal).filter(
            Medal.collection_id == collection_id
        ).all()
        if not rows:
            return 0, 0.0
        avg = sum(r[0] for r in rows) // len(rows)
        # 完成率：完成人数 / (完成人数 + 未完成但开始的人数) —— MVP 简化为完成人数占比
        return avg, float(len(rows)) / max(len(rows), 1) * 100

    # ---- 开始专题 ----

    def start_collection(self, db: Session, code: str, difficulty: str,
                         game_type: str, user: User | None,
                         session_id: str | None = None,
                         device: str = "pc",
                         start_lng: float | None = None,
                         start_lat: float | None = None) -> dict:
        c = self.get_collection_by_code(db, code)
        if not c:
            raise ValueError("专题不存在")
        if not is_unlocked(db, user, c, session_id):
            raise ValueError("专题未解锁")
        if difficulty not in ("easy", "hard"):
            raise ValueError("无效的难度")

        pois = self.get_ordered_pois(db, c.id)
        if not pois:
            raise ValueError("专题没有点位")

        first = pois[0]
        # 起点：外部传入（再来一局）> 默认中国中心
        if start_lng is None or start_lat is None:
            start_lng, start_lat = CHINA_CENTER

        game = self._make_point_game(
            db, target=first, start_lng=start_lng, start_lat=start_lat,
            difficulty=difficulty, device=device, player_id=user.id if user else None,
        )

        return {
            "collection_id": c.id,
            "collection_code": c.code,
            "collection_name": c.name,
            "point_index": 0,
            "point_count": len(pois),
            "game_id": game.id,
            "mode": "national",
            "difficulty": difficulty,
            "game_type": game_type,
            "start_lng": game.start_lng,
            "start_lat": game.start_lat,
            "time_limit": effective_time_limit("national", difficulty),
            "tolerance_km": 5.0,
            "target_cover": cover_url_for(first),
            "target_name": first.name,
            "device": device,
        }

    def _make_point_game(self, db: Session, target: POI, start_lng: float,
                         start_lat: float, difficulty: str, device: str,
                         player_id: int | None) -> GameRecord:
        """创建单点单局（mode=national，目标为指定 POI）"""
        game = GameRecord(
            player_id=player_id,
            mode="national",
            difficulty=difficulty,
            region_code=None,
            target_poi_id=target.id,
            target_lng=target.lng,
            target_lat=target.lat,
            view_lng=start_lng,
            view_lat=start_lat,
            start_lng=start_lng,
            start_lat=start_lat,
            status="playing",
            device=device,
            hint_credits=100,
        )
        target.used_count = (target.used_count or 0) + 1
        db.add(game)
        db.commit()
        db.refresh(game)
        return game

    # ---- 单点结束 ----

    def point_end(self, db: Session, collection_id: int, point_index: int,
                  time_sec: int, is_correct: bool, user: User | None,
                  session_id: str | None, ip: str, nickname: str | None,
                  difficulty: str, game_type: str, device: str = "pc") -> dict:
        c = db.query(Collection).filter(Collection.id == collection_id).first()
        if not c:
            raise ValueError("专题不存在")

        # 记录 player_session（专题进度 + 解锁依据）
        ps = PlayerSession(
            session_id=session_id or "anon",
            ip=ip or "0.0.0.0",
            nickname=nickname or (user.nickname if user else None),
            mode="national",
            difficulty=difficulty,
            game_type=game_type,
            target_poi_id=None,
            won=bool(is_correct),
            score=0,
            duration_sec=int(time_sec),
            collection_id=collection_id,
            point_index=point_index,
        )
        db.add(ps)

        pois = self.get_ordered_pois(db, collection_id)
        total = len(pois)
        has_next = is_correct and point_index < total - 1

        if not has_next:
            db.commit()
            return {
                "has_next": False,
                "point_index": point_index,
                "total": total,
                "next_point_index": None,
            }

        # 起点继承：下一点起点 = 当前置目标坐标
        next_index = point_index + 1
        next_target = pois[next_index]
        # 当前置目标 = pois[point_index]
        prev_target = pois[point_index]
        next_game = self._make_point_game(
            db, target=next_target,
            start_lng=prev_target.lng, start_lat=prev_target.lat,
            difficulty=difficulty, device=device,
            player_id=user.id if user else None,
        )
        db.commit()
        db.refresh(next_game)

        return {
            "has_next": True,
            "point_index": next_index,
            "total": total,
            "next_point_index": next_index,
            "next_game_id": next_game.id,
            "next_start_lng": next_game.start_lng,
            "next_start_lat": next_game.start_lat,
            "next_target_cover": cover_url_for(next_target),
            "next_target_name": next_target.name,
            "next_time_limit": effective_time_limit("national", difficulty),
            "next_tolerance_km": 5.0,
            "next_mode": "national",
        }

    # ---- 专题完成 ----

    def finish_collection(self, db: Session, collection_id: int, difficulty: str,
                          game_type: str, total_time_sec: int,
                          point_times: list[int], user: User | None,
                          is_win: bool = True) -> dict:
        c = db.query(Collection).filter(Collection.id == collection_id).first()
        if not c:
            raise ValueError("专题不存在")

        logger.info(
            f"[勋章][finish] 开始 collection_id={collection_id} difficulty={difficulty} "
            f"game_type={game_type} user_id={user.id if user else None} "
            f"total_time_sec={total_time_sec} point_times={point_times} is_win={is_win}"
        )

        medal_awarded = False
        medal = None
        is_new_best = False

        # 仅当所有点位均完成时才发勋章（防止中途放弃/部分完成刷勋章）
        point_count = len(self.get_ordered_pois(db, collection_id))
        completed_all = point_count > 0 and len(point_times or []) >= point_count
        logger.info(
            f"[勋章][finish] point_count={point_count} 收到 point_times 数={len(point_times or [])} "
            f"completed_all={completed_all}"
        )

        if user is None:
            logger.warning(f"[勋章][finish] 未登录（user=None），不发勋章 collection_id={collection_id}")
        elif not completed_all:
            logger.warning(
                f"[勋章][finish] 点位未全部完成，不发勋章 collection_id={collection_id} "
                f"point_count={point_count} received={len(point_times or [])}"
            )
        else:
            medal = db.query(Medal).filter(
                Medal.collection_id == collection_id,
                Medal.difficulty == difficulty,
                Medal.game_type == game_type,
            ).first()
            if not medal:
                logger.error(
                    f"[勋章][finish] 找不到勋章记录 collection_id={collection_id} "
                    f"difficulty={difficulty} game_type={game_type}，请检查 medals 表"
                )
            else:
                # 是否新最佳
                existing = db.query(UserMedal).filter(
                    UserMedal.user_id == user.id, UserMedal.medal_id == medal.id
                ).first()
                is_new_best = (existing is None) or (total_time_sec < existing.total_time_sec)
                award_medal(db, user, medal, total_time_sec, point_times, is_win=is_win)
                medal_awarded = True
                logger.info(f"[勋章][finish] 已发勋章 medal_id={medal.id} is_new_best={is_new_best}")

        return {
            "collection_id": collection_id,
            "collection_name": c.name,
            "difficulty": difficulty,
            "game_type": game_type,
            "total_time_sec": total_time_sec,
            "point_times": point_times,
            "medal_awarded": medal_awarded,
            "is_new_best": is_new_best,
            "medal_name": medal.name if medal else None,
            "medal_icon_url": medal.icon_url if medal else None,
        }

    # ---- 勋章墙 ----

    def medal_wall(self, db: Session, user: User | None,
                   difficulty: str | None = None) -> list[dict]:
        # 全部勋章（可按点选/巡航过滤）
        q = (
            db.query(Medal, Collection)
            .join(Collection, Medal.collection_id == Collection.id)
            .filter(Collection.enabled.is_(True))
        )
        if difficulty in ("easy", "hard"):
            q = q.filter(Medal.difficulty == difficulty)
        all_medals = (
            q.order_by(asc(Collection.difficulty_star), asc(Medal.difficulty), asc(Medal.game_type))
            .all()
        )

        # 用户已获得
        earned: dict[int, UserMedal] = {}
        if user:
            rows = db.query(UserMedal).filter(UserMedal.user_id == user.id).all()
            earned = {um.medal_id: um for um in rows}

        groups: dict[int, list[dict]] = {}
        for medal, coll in all_medals:
            um = earned.get(medal.id)
            item = {
                "collection_id": coll.id,
                "collection_code": coll.code,
                "collection_name": coll.name,
                "difficulty": medal.difficulty,
                "game_type": medal.game_type,
                "icon_url": medal.icon_url,
                "earned": um is not None,
                "total_time_sec": um.total_time_sec if um else None,
                "earned_at": um.earned_at.strftime("%Y-%m-%d") if um and um.earned_at else None,
            }
            groups.setdefault(coll.difficulty_star, []).append(item)

        result = []
        for star in sorted(groups.keys()):
            result.append({"star": star, "medals": groups[star]})
        return result

    # ---- 排行榜 ----

    def leaderboard(self, db: Session, scope: str = "single",
                    collection_id: int | None = None,
                    point_index: int | None = None,
                    poi_id: int | None = None,
                    difficulty: str | None = None,
                    game_type: str | None = None,
                    limit: int = 50) -> list[dict]:
        if scope == "medal_count":
            # 同一专题+难度的 solo/pk 勋章只计一次
            rows = (
                db.query(User.id, User.nickname, User.profile_public,
                         Medal.collection_id, Medal.difficulty)
                .join(UserMedal, UserMedal.user_id == User.id)
                .join(Medal, Medal.id == UserMedal.medal_id)
                .filter(Medal.difficulty == difficulty if difficulty in ("easy", "hard") else True)
                .all()
            )
            counts: dict[int, dict] = {}
            for uid, nickname, profile_public, collection_id, medal_difficulty in rows:
                user = counts.setdefault(uid, {
                    "user_id": uid, "nickname": nickname,
                    "profile_public": bool(profile_public), "keys": set(),
                })
                user["keys"].add((collection_id, medal_difficulty))
            ranked = sorted(counts.values(), key=lambda x: (-len(x["keys"]), x["user_id"]))
            return [
                {"rank": i + 1, "user_id": row["user_id"], "nickname": row["nickname"],
                 "medal_count": len(row["keys"]), "total_time_sec": None,
                 "profile_public": row["profile_public"]}
                for i, row in enumerate(ranked[:limit])
            ]

        if scope == "total":
            # 兼容旧接口：总时间排行已不在前端展示
            q = (
                db.query(
                    User.id, User.nickname, User.profile_public,
                    func.sum(UserMedal.total_time_sec).label("total"),
                )
                .join(UserMedal, UserMedal.user_id == User.id)
                .join(Medal, Medal.id == UserMedal.medal_id)
            )
            if difficulty in ("easy", "hard"):
                q = q.filter(Medal.difficulty == difficulty)
            rows = (
                q.group_by(User.id, User.nickname)
                .order_by(asc("total"))
                .limit(limit)
                .all()
            )
            return [
                {"rank": i + 1, "user_id": r[0], "nickname": r[1],
                 "total_time_sec": int(r[3]) if r[3] is not None else 0,
                 "medal_count": None, "profile_public": bool(r[2])}
                for i, r in enumerate(rows)
            ]

        if scope == "poi":
            if poi_id is None or not difficulty:
                return []
            rows = (
                db.query(
                    User.id, User.nickname, User.profile_public,
                    MedalRecord.earned_at,
                    MedalRecord.point_times, CollectionPoi.sort_order,
                )
                .join(UserMedal, UserMedal.user_id == User.id)
                .join(Medal, Medal.id == UserMedal.medal_id)
                .join(CollectionPoi, CollectionPoi.collection_id == Medal.collection_id)
                .join(
                    MedalRecord,
                    (MedalRecord.user_id == UserMedal.user_id)
                    & (MedalRecord.medal_id == UserMedal.medal_id),
                )
                .filter(
                    CollectionPoi.poi_id == poi_id,
                    Medal.difficulty == difficulty,
                    MedalRecord.point_times.isnot(None),
                )
                .all()
            )
            best: dict[int, dict] = {}
            for uid, nickname, profile_public, earned_at, point_times, sort_order in rows:
                if not point_times or sort_order >= len(point_times):
                    continue
                poi_time = point_times[sort_order]
                if uid not in best or poi_time < best[uid]["poi_time_sec"]:
                    best[uid] = {
                        "user_id": uid,
                        "nickname": nickname,
                        "profile_public": bool(profile_public),
                        "poi_time_sec": poi_time,
                        "earned_at": earned_at,
                    }
            ranked = sorted(best.values(), key=lambda x: (x["poi_time_sec"], x["earned_at"] or ""))
            return [
                {**row, "rank": i + 1,
                 "earned_at": row["earned_at"].strftime("%Y-%m-%d") if row["earned_at"] else None,
                 "total_time_sec": None, "medal_count": None}
                for i, row in enumerate(ranked[:limit])
            ]

        # 默认：单专题排行（solo/pk 来源统一排名，不分开）
        if not collection_id or not difficulty:
            return []

        # 每个用户在该专题+难度下取最佳（最快用时）一条，来源 game_type 一并保留
        rn = func.row_number().over(
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
            db.query(User.id, User.nickname, User.profile_public,
                     inner.c.total_time_sec,
                     inner.c.earned_at, inner.c.game_type)
            .join(inner, inner.c.uid == User.id)
            .filter(inner.c.rn == 1)
            .order_by(asc(inner.c.total_time_sec), asc(inner.c.earned_at))
            .limit(limit)
            .all()
        )
        return [
            {"rank": i + 1, "user_id": r[0], "nickname": r[1],
             "total_time_sec": r[3],
             "earned_at": r[4].strftime("%Y-%m-%d") if r[4] else None,
             "medal_count": None,
             "game_type": r[5],
             "profile_public": bool(r[2])}
            for i, r in enumerate(rows)
        ]

    # ---- 我的足迹（轻量）----

    def my_tracks(self, db: Session, user: User | None,
                  session_id: str | None = None) -> list[dict]:
        """玩家收集过的 POI：专题模式（player_sessions）+ 非专题模式命中（game_records）。"""
        result: list[dict] = []

        # 1) 专题模式收集的 POI
        if user:
            done_colls = (
                db.query(PlayerSession.collection_id).filter(
                    PlayerSession.won.is_(True),
                    PlayerSession.nickname == user.nickname,
                    PlayerSession.collection_id.isnot(None),
                ).distinct().all()
            )
        elif session_id:
            done_colls = (
                db.query(PlayerSession.collection_id).filter(
                    PlayerSession.won.is_(True),
                    PlayerSession.session_id == session_id,
                    PlayerSession.collection_id.isnot(None),
                ).distinct().all()
            )
        else:
            done_colls = []

        done_ids = {r[0] for r in done_colls}
        if done_ids:
            rows = (
                db.query(
                    Collection.code, Collection.name, CollectionPoi.sort_order,
                    POI.id, POI.name, POI.lng, POI.lat, POI.cover_url, Collection.cover_url, POI.summary
                )
                .join(CollectionPoi, CollectionPoi.collection_id == Collection.id)
                .join(POI, POI.id == CollectionPoi.poi_id)
                .filter(Collection.id.in_(done_ids))
                .order_by(asc(Collection.id), asc(CollectionPoi.sort_order))
                .all()
            )
            for r in rows:
                result.append({
                    "collection_code": r[0], "collection_name": r[1],
                    "point_index": r[2], "poi_id": r[3], "name": r[4], "lng": r[5], "lat": r[6],
                    "cover_url": r[7], "collection_cover_url": r[8], "summary": r[9],
                })

        # 2) 非专题模式（自由/省市/主题）命中的 POI（仅登录用户，匿名无 user 关联）
        if user:
            game_poi_ids = [
                r[0] for r in db.query(GameRecord.target_poi_id).filter(
                    GameRecord.player_id == user.id,
                    GameRecord.hit.is_(True),
                    GameRecord.target_poi_id.isnot(None),
                ).distinct().all()
            ]
            if game_poi_ids:
                pois = db.query(POI).filter(POI.id.in_(game_poi_ids)).all()
                for p in pois:
                    result.append({
                        "collection_code": None,
                        "collection_name": None,
                        "point_index": None,
                        "poi_id": p.id,
                        "name": p.name,
                        "lng": p.lng,
                        "lat": p.lat,
                        "cover_url": p.cover_url,
                        "collection_cover_url": None,
                        "summary": p.summary,
                    })

        return result


collection_service = CollectionService()
