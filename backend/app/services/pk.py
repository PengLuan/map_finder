"""PK 对战服务：房间管理 + 地图对战逻辑 + 超时判定"""
import logging
import random
import string
from datetime import datetime

from sqlalchemy.orm import Session

from ..config import settings
from ..models import PKGame, PKRoom, PKUserActivity, POI, POITheme, Region, User
from .game import (
    CHINA_CENTER,
    DIFFICULTIES,
    DIRECTION_ANGLES,
    EASY_CLICK_THRESHOLD_KM,
    MODE_CONFIG,
    _has_valid_cover,
    bearing_degrees,
    bearing_to_chinese,
    bearing_to_offset,
    cover_url_for,
    current_location_text,
    distance_bucket,
    effective_time_limit,
    haversine_km,
    move_point,
)
from . import geometry

logger = logging.getLogger(__name__)

# 超时规则（秒）
WAITING_TIMEOUT = 300   # 等待中房主超时 5 分钟
CLEANUP_TIMEOUT = 600   # 双方都掉线后清理僵尸房间 10 分钟


class PKService:
    # ===== 房间管理 =====

    def create_room(self, db: Session, host_user_id: int, mode: str,
                    region_code: str | None = None,
                    difficulty: str = "hard",
                    category: str | None = None) -> PKRoom:
        if mode not in MODE_CONFIG:
            raise ValueError(f"无效的游戏模式: {mode}")
        if mode in ("provincial", "city") and not region_code:
            raise ValueError("省级/城市模式需要指定 region_code")
        if difficulty not in DIFFICULTIES:
            raise ValueError(f"无效的难度: {difficulty}")
        if category:
            exists = db.query(POITheme.code).filter(
                POITheme.code == category, POITheme.enabled.is_(True)).first()
            if not exists:
                raise ValueError(f"无效的主题: {category}")

        self._check_active_room(db, host_user_id)

        room_code = self._generate_room_code(db)
        room = PKRoom(
            room_code=room_code,
            host_user_id=host_user_id,
            mode=mode,
            region_code=region_code,
            difficulty=difficulty,
            category=category,
        )
        db.add(room)
        db.commit()
        db.refresh(room)
        logger.info(f"PK room created: {room_code} by user {host_user_id}, mode={mode}, difficulty={difficulty}")
        return room

    def join_room(self, db: Session, room_code: str, user_id: int) -> PKRoom:
        self._check_active_room(db, user_id)

        room = db.query(PKRoom).filter(
            PKRoom.room_code == room_code,
            PKRoom.status == "waiting",
        ).first()
        if not room:
            raise ValueError("房间不存在或已开始")
        if room.host_user_id == user_id:
            raise ValueError("不能加入自己的房间")
        if room.guest_user_id is not None:
            raise ValueError("房间已满")

        room.guest_user_id = user_id
        room.version += 1
        db.commit()
        db.refresh(room)
        logger.info(f"User {user_id} joined room {room_code}")
        return room

    def leave_room(self, db: Session, room_id: int, user_id: int) -> dict:
        room = self._get_room(db, room_id)

        is_host = room.host_user_id == user_id
        is_guest = room.guest_user_id == user_id
        if not (is_host or is_guest):
            raise ValueError("你不在此房间中")

        if room.status == "finished":
            # 房间已结束：标记该用户已离开（把心跳时间设为很早，对方轮询会检测到）
            activity = db.query(PKUserActivity).filter(
                PKUserActivity.user_id == user_id,
                PKUserActivity.room_id == room_id,
            ).first()
            if activity:
                activity.last_heartbeat_at = datetime(2000, 1, 1)
                db.commit()
            return {"status": "left", "reason": "room_finished"}

        if room.status == "waiting":
            room.status = "finished"
            room.finished_at = datetime.now()
            room.version += 1
            db.commit()
            return {"status": "finished", "reason": "left_waiting"}

        # 游戏中退出：对方获胜
        game = self._latest_game(db, room_id)
        if game and not self._is_game_finished(game):
            winner_id = room.guest_user_id if is_host else room.host_user_id
            game.winner_user_id = winner_id
            game.win_reason = "opponent_left"
            game.finished_at = datetime.now()
            game.version += 1
            self._finish_room(db, room_id)
            db.commit()

        return {"status": "finished", "reason": "opponent_left"}

    def get_room_status(self, db: Session, room_id: int) -> dict:
        room = self._get_room(db, room_id)

        if room.status in ("waiting", "playing"):
            self._check_timeouts(db, room)

        host = db.query(User).filter(User.id == room.host_user_id).first()
        guest = db.query(User).filter(User.id == room.guest_user_id).first() if room.guest_user_id else None

        players = [{"user_id": host.id, "nickname": host.nickname}]
        if guest:
            players.append({"user_id": guest.id, "nickname": guest.nickname})

        game = self._latest_game(db, room_id)

        return {
            "version": room.version,
            "status": room.status,
            "mode": room.mode,
            "region_code": room.region_code,
            "difficulty": room.difficulty,
            "category": room.category,
            "room_code": room.room_code,
            "players": players,
            "game_id": game.id if game else None,
        }

    def start_game(self, db: Session, room_id: int, user_id: int) -> dict:
        room = self._get_room(db, room_id)
        if room.host_user_id != user_id:
            raise ValueError("只有房主可以开始游戏")
        if room.status != "waiting":
            raise ValueError("房间已开始或已结束")
        if room.guest_user_id is None:
            raise ValueError("对手尚未加入")

        game = self._start_new_round(db, room)
        return {
            "game_id": game.id,
            "mode": room.mode,
            "difficulty": room.difficulty,
            "start_lng": game.player1_view_lng,
            "start_lat": game.player1_view_lat,
            "time_limit": effective_time_limit(room.mode, room.difficulty),
            "hint_text": self._build_hint_text(db, game.target_poi_id),
        }

    def request_rematch(self, db: Session, room_id: int, user_id: int) -> dict:
        room = self._get_room(db, room_id)
        is_host = room.host_user_id == user_id
        is_guest = room.guest_user_id == user_id
        if not (is_host or is_guest):
            raise ValueError("你不在此房间中")
        if room.guest_user_id is None:
            raise ValueError("对手不在房间")

        if is_host:
            room.host_rematch = True
        else:
            room.guest_rematch = True
        room.version += 1

        new_game_id = None
        if room.host_rematch and room.guest_rematch:
            game = self._start_new_round(db, room)
            new_game_id = game.id
            both_ready = True
            opponent_rematch = True
        else:
            db.commit()
            both_ready = False
            opponent_rematch = room.guest_rematch if is_host else room.host_rematch

        return {
            "my_rematch": True,
            "opponent_rematch": opponent_rematch,
            "both_ready": both_ready,
            "new_game_id": new_game_id,
        }

    # ===== 游戏逻辑 =====

    def get_game_state(self, db: Session, game_id: int, user_id: int) -> dict:
        game = db.query(PKGame).filter(PKGame.id == game_id).first()
        if not game:
            raise ValueError("游戏不存在")

        room = self._get_room(db, game.room_id)
        if room.status == "playing":
            self._check_timeouts(db, room)
            db.refresh(game)

        is_player1 = game.player1_user_id == user_id
        is_player2 = game.player2_user_id == user_id
        if not (is_player1 or is_player2):
            raise ValueError("你不在此游戏中")

        if is_player1:
            my_view = (game.player1_view_lng, game.player1_view_lat)
            my_steps = game.player1_steps
            my_distance = game.player1_distance_km
            my_hint = game.player1_hint_level
            my_score = game.player1_score
            my_hit = game.player1_hit
            opp_id = game.player2_user_id
            opp_steps = game.player2_steps
            opp_hit = game.player2_hit
            opp_score = game.player2_score
        else:
            my_view = (game.player2_view_lng, game.player2_view_lat)
            my_steps = game.player2_steps
            my_distance = game.player2_distance_km
            my_hint = game.player2_hint_level
            my_score = game.player2_score
            my_hit = game.player2_hit
            opp_id = game.player1_user_id
            opp_steps = game.player1_steps
            opp_hit = game.player1_hit
            opp_score = game.player1_score

        opp_user = db.query(User).filter(User.id == opp_id).first()
        winner_nickname = None
        if game.winner_user_id:
            w = db.query(User).filter(User.id == game.winner_user_id).first()
            winner_nickname = w.nickname if w else None

        is_finished = self._is_game_finished(game)
        time_limit = effective_time_limit(room.mode, room.difficulty)
        remaining = 0
        if not is_finished:
            elapsed = (datetime.now() - (room.started_at or game.created_at)).total_seconds()
            remaining = max(0, int(time_limit - elapsed))

        hint_text = self._build_hint_text(db, game.target_poi_id)

        # 再来一局状态
        latest = self._latest_game(db, game.room_id)
        rematch_game_id = latest.id if (latest and latest.id != game_id) else None
        my_rematch = (room.host_rematch if is_player1 else room.guest_rematch)
        opponent_rematch = (room.guest_rematch if is_player1 else room.host_rematch)

        # 结束后揭示目标
        target_info = None
        if is_finished:
            poi = db.query(POI).filter(POI.id == game.target_poi_id).first()
            target_info = {
                "name": poi.name if poi else "未知",
                "poi_id": poi.id if poi else None,
                "lng": game.target_lng,
                "lat": game.target_lat,
                "summary": poi.summary if poi else None,
                "cover": cover_url_for(poi),
                "shape": geometry.target_shape_dict(poi) if poi else None,
                "contributor_nickname": poi.contributor_nickname if poi else None,
            }

        # 结束后公布双方当前位置与目标的距离（进行中不泄露）
        my_to_target_km = None
        opponent_to_target_km = None
        if is_finished:
            opp_view = (
                (game.player2_view_lng, game.player2_view_lat) if is_player1
                else (game.player1_view_lng, game.player1_view_lat)
            )
            my_to_target_km = round(
                haversine_km(my_view[0], my_view[1], game.target_lng, game.target_lat), 1)
            opponent_to_target_km = round(
                haversine_km(opp_view[0], opp_view[1], game.target_lng, game.target_lat), 1)

        # 游戏结束后：检测对方是否已离开
        # 原则：刚结束时默认对手未离开，给 30 秒宽限期让心跳稳定，
        # 只有明确调用 leave_room 才立即判定；宽限期过后才检测心跳超时
        opponent_left = False
        if is_finished:
            opp_activity = db.query(PKUserActivity).filter(
                PKUserActivity.user_id == opp_id,
                PKUserActivity.room_id == room.id,
            ).first()
            if opp_activity and opp_activity.last_heartbeat_at.year == 2000:
                # 明确离开（leave_room 把心跳设为 2000 年）：立即判定
                opponent_left = True
            else:
                # 游戏结束 30 秒宽限期后才开始检测心跳超时
                finished_seconds = (datetime.now() - game.finished_at).total_seconds() if game.finished_at else 0
                if finished_seconds > 30:
                    if not opp_activity:
                        # 宽限期内仍无心跳记录：判定离开
                        opponent_left = True
                    elif (datetime.now() - opp_activity.last_heartbeat_at).total_seconds() > 30:
                        # 心跳超时（关闭浏览器等）：30 秒后判定
                        opponent_left = True

        return {
            "version": game.version,
            "mode": room.mode,
            "difficulty": room.difficulty,
            "time_limit": time_limit,
            "hint_text": hint_text,
            "my_view_lng": my_view[0],
            "my_view_lat": my_view[1],
            "my_steps": my_steps,
            "my_distance_km": round(my_distance, 1),
            "my_hint_level": my_hint,
            "my_score": my_score,
            "my_hit": my_hit,
            "opponent_nickname": opp_user.nickname if opp_user else "对手",
            "opponent_steps": opp_steps,
            "opponent_hit": opp_hit,
            "opponent_score": opp_score,
            "is_finished": is_finished,
            "remaining_seconds": remaining,
            "winner": winner_nickname,
            "win_reason": game.win_reason,
            "target": target_info,
            "my_rematch": my_rematch,
            "opponent_rematch": opponent_rematch,
            "rematch_game_id": rematch_game_id,
            "my_to_target_km": my_to_target_km,
            "opponent_to_target_km": opponent_to_target_km,
            "opponent_left": opponent_left,
        }

    def move_view(self, db: Session, game_id: int, user_id: int,
                  direction: str, distance_km: float) -> dict:
        game, is_player1 = self._get_active_game_for_user(db, game_id, user_id)

        if direction not in DIRECTION_ANGLES:
            raise ValueError(f"无效方向: {direction}")
        if not (1 <= distance_km <= 2000):
            raise ValueError("移动距离需在 1~2000 km 之间")

        if is_player1:
            new_lng, new_lat = move_point(game.player1_view_lng, game.player1_view_lat, direction, distance_km)
            game.player1_view_lng = new_lng
            game.player1_view_lat = new_lat
            game.player1_steps += 1
            game.player1_distance_km += distance_km
        else:
            new_lng, new_lat = move_point(game.player2_view_lng, game.player2_view_lat, direction, distance_km)
            game.player2_view_lng = new_lng
            game.player2_view_lat = new_lat
            game.player2_steps += 1
            game.player2_distance_km += distance_km

        game.version += 1
        db.commit()

        return {"view_lng": new_lng, "view_lat": new_lat}

    def update_view(self, db: Session, game_id: int, user_id: int,
                    lng: float, lat: float) -> dict:
        game, is_player1 = self._get_active_game_for_user(db, game_id, user_id)

        if is_player1:
            prev_lng = game.player1_view_lng
            prev_lat = game.player1_view_lat
            game.player1_view_lng = lng
            game.player1_view_lat = lat
            # 累加飞行距离（过滤 <0.05km 抖动，避免原地微调累加）
            if prev_lng is not None and prev_lat is not None:
                moved = haversine_km(prev_lng, prev_lat, lng, lat)
                if moved >= 0.05:
                    game.player1_distance_km += moved
        else:
            prev_lng = game.player2_view_lng
            prev_lat = game.player2_view_lat
            game.player2_view_lng = lng
            game.player2_view_lat = lat
            if prev_lng is not None and prev_lat is not None:
                moved = haversine_km(prev_lng, prev_lat, lng, lat)
                if moved >= 0.05:
                    game.player2_distance_km += moved

        db.commit()
        return {"view_lng": lng, "view_lat": lat}

    def check_view(self, db: Session, game_id: int, user_id: int,
                   west: float, south: float, east: float, north: float) -> dict:
        game, is_player1 = self._get_active_game_for_user(db, game_id, user_id)
        room = self._get_room(db, game.room_id)

        # 简单模式不使用视野框判定
        if room.difficulty == "easy":
            return {"hit": False}

        poi = db.query(POI).filter(POI.id == game.target_poi_id).first()
        hit = geometry.rect_hits_target(west, south, east, north, poi) if poi else False
        if not hit:
            # 未命中：返回视野中心到目标范围边界的距离区间，供前端 B 救济触发
            view_lng = game.player1_view_lng if is_player1 else game.player2_view_lng
            view_lat = game.player1_view_lat if is_player1 else game.player2_view_lat
            edge_dist = (
                geometry.distance_to_target_edge(view_lng, view_lat, poi)
                if poi
                else haversine_km(view_lng, view_lat, game.target_lng, game.target_lat)
            )
            return {"hit": False, "distance_bucket": distance_bucket(edge_dist)}

        return self._handle_hit(db, game, room, is_player1, user_id)

    def click_target(self, db: Session, game_id: int, user_id: int,
                     lng: float, lat: float) -> dict:
        """简单模式：点击地图判定，点击点落入目标范围即胜利"""
        game, is_player1 = self._get_active_game_for_user(db, game_id, user_id)
        room = self._get_room(db, game.room_id)

        if room.difficulty != "easy":
            raise ValueError("仅点选模式支持点击判定")

        poi = db.query(POI).filter(POI.id == game.target_poi_id).first()
        hit = geometry.point_hits_target(lng, lat, poi) if poi else False
        if not hit:
            edge_dist = geometry.distance_to_target_edge(lng, lat, poi) if poi else \
                haversine_km(lng, lat, game.target_lng, game.target_lat)
            return {"hit": False, "distance_hint": distance_bucket(edge_dist)}

        return self._handle_hit(db, game, room, is_player1, user_id,
                                view_lng=lng, view_lat=lat)

    def _handle_hit(self, db: Session, game: PKGame, room: PKRoom,
                    is_player1: bool, user_id: int,
                    view_lng: float | None = None,
                    view_lat: float | None = None) -> dict:
        """命中后的公共逻辑：记分、定胜负、结束房间"""
        time_limit = effective_time_limit(room.mode, room.difficulty)
        elapsed = int((datetime.now() - (room.started_at or game.created_at)).total_seconds())

        if is_player1:
            if view_lng is not None:
                game.player1_view_lng = view_lng
                game.player1_view_lat = view_lat
            game.player1_hit = True
            game.player1_score = self._calc_score(time_limit, elapsed, game.player1_distance_km, game.player1_hint_level)
        else:
            if view_lng is not None:
                game.player2_view_lng = view_lng
                game.player2_view_lat = view_lat
            game.player2_hit = True
            game.player2_score = self._calc_score(time_limit, elapsed, game.player2_distance_km, game.player2_hint_level)

        # 先命中者获胜
        game.winner_user_id = user_id
        game.win_reason = "hit"
        game.finished_at = datetime.now()
        game.version += 1
        self._finish_room(db, game.room_id)
        db.commit()

        poi = db.query(POI).filter(POI.id == game.target_poi_id).first()
        my_score = game.player1_score if is_player1 else game.player2_score
        return {
            "hit": True,
            "score": my_score,
            "target_name": poi.name if poi else "未知",
            "target_poi_id": poi.id if poi else None,
            "target_lng": game.target_lng,
            "target_lat": game.target_lat,
            "target_summary": poi.summary if poi else None,
            "target_cover": cover_url_for(poi),
            "duration_sec": elapsed,
            "target_shape": geometry.target_shape_dict(poi) if poi else None,
            "contributor_nickname": poi.contributor_nickname if poi else None,
        }

    def use_hint(self, db: Session, game_id: int, user_id: int, hint_level: int) -> dict:
        game, is_player1 = self._get_active_game_for_user(db, game_id, user_id)
        room = self._get_room(db, game.room_id)

        # 困难模式 level 2（方位）：可反复调用，不推进 hint_level
        if room.difficulty != "easy" and hint_level == 2:
            view_lng = game.player1_view_lng if is_player1 else game.player2_view_lng
            view_lat = game.player1_view_lat if is_player1 else game.player2_view_lat
            brg = bearing_degrees(view_lng, view_lat, game.target_lng, game.target_lat)
            dist = haversine_km(view_lng, view_lat, game.target_lng, game.target_lat)
            return {
                "hint_level": hint_level,
                "cost": 0,
                "content": f"目标在你当前视野{bearing_to_offset(brg)}，约 {int(dist)} 公里处",
            }

        current_level = game.player1_hint_level if is_player1 else game.player2_hint_level
        if hint_level <= current_level:
            raise ValueError("该提示已解锁")
        if hint_level > 4:
            raise ValueError("无效的提示等级")

        if is_player1:
            game.player1_hint_level = hint_level
        else:
            game.player2_hint_level = hint_level
        game.version += 1
        db.commit()

        # 构建提示内容
        view_lng = game.player1_view_lng if is_player1 else game.player2_view_lng
        view_lat = game.player1_view_lat if is_player1 else game.player2_view_lat

        result = {"hint_level": hint_level, "cost": 0}

        if hint_level == 1:
            # 提示玩家当前所在省市（用视野中心反查 regions bbox），而非目标所在省
            result["content"] = current_location_text(db, view_lng, view_lat)
        elif hint_level == 2:
            brg = bearing_degrees(view_lng, view_lat, game.target_lng, game.target_lat)
            dist = haversine_km(view_lng, view_lat, game.target_lng, game.target_lat)
            result["content"] = f"目标在你当前视野{bearing_to_offset(brg)}，约 {int(dist)} 公里处"
        elif hint_level == 3:
            result["content"] = f"目标坐标约：{game.target_lng:.1f}°E, {game.target_lat:.1f}°N"
            result["cost"] = 20
        elif hint_level == 4:
            offset = 2.0 if room.mode == "national" else 0.5
            result["bounds"] = {
                "west": game.target_lng - offset,
                "east": game.target_lng + offset,
                "south": game.target_lat - offset,
                "north": game.target_lat + offset,
            }
            result["content"] = "已在地图上标出目标所在区域（黄色矩形）"
            result["cost"] = 40

        return result

    def give_up(self, db: Session, game_id: int, user_id: int) -> dict:
        """放弃本局：对方直接判定胜利"""
        game, is_player1 = self._get_active_game_for_user(db, game_id, user_id)
        room = self._get_room(db, game.room_id)

        opponent_id = game.player2_user_id if is_player1 else game.player1_user_id
        game.winner_user_id = opponent_id
        game.win_reason = "opponent_giveup"
        game.finished_at = datetime.now()
        game.version += 1
        self._finish_room(db, game.room_id)
        db.commit()

        return {"success": True}

    # ===== 状态恢复 & 心跳 & 清理 =====

    def get_user_status(self, db: Session, user_id: int) -> dict:
        room = db.query(PKRoom).filter(
            (PKRoom.host_user_id == user_id) | (PKRoom.guest_user_id == user_id),
            PKRoom.status.in_(["waiting", "playing"])
        ).first()

        if not room:
            return {"active_room_id": None}

        game = self._latest_game(db, room.id)
        return {
            "active_room_id": room.id,
            "active_game_id": game.id if game else None,
            "room_status": room.status,
            "is_host": room.host_user_id == user_id,
            "room_code": room.room_code,
        }

    def heartbeat(self, db: Session, user_id: int, room_id: int) -> dict:
        room = self._get_room(db, room_id)
        if room.host_user_id != user_id and room.guest_user_id != user_id:
            raise ValueError("你不在此房间中")

        activity = db.query(PKUserActivity).filter(
            PKUserActivity.user_id == user_id,
            PKUserActivity.room_id == room_id,
        ).first()

        if activity:
            activity.last_heartbeat_at = datetime.now()
        else:
            db.add(PKUserActivity(user_id=user_id, room_id=room_id))

        db.commit()
        return {"ok": True}

    def cleanup_stale_rooms(self, db: Session) -> int:
        now = datetime.now()
        count = 0

        # 清理 playing 状态的僵尸房间
        active_rooms = db.query(PKRoom).filter(PKRoom.status == "playing").all()
        for room in active_rooms:
            game = self._latest_game(db, room.id)
            if not game or self._is_game_finished(game):
                continue

            host_stale = self._is_user_stale(db, room.host_user_id, room.id, now, room.started_at or game.created_at)
            guest_stale = self._is_user_stale(db, room.guest_user_id, room.id, now, room.started_at or game.created_at) if room.guest_user_id else True

            if host_stale and guest_stale:
                self._finish_by_timeout(db, room, game, now)
                count += 1

        # 清理 waiting 状态的僵尸房间
        waiting_rooms = db.query(PKRoom).filter(
            PKRoom.status == "waiting",
            PKRoom.guest_user_id.is_(None),
        ).all()
        for room in waiting_rooms:
            if self._is_user_stale(db, room.host_user_id, room.id, now, room.created_at):
                room.status = "finished"
                room.finished_at = now
                room.version += 1
                count += 1

        if count:
            db.commit()
        return count

    # ===== 内部方法 =====

    def _start_new_round(self, db: Session, room: PKRoom) -> PKGame:
        # 确定起点：优先从上一局目标点开始（再来一局）
        prev_game = db.query(PKGame).filter(
            PKGame.room_id == room.id,
            PKGame.finished_at.is_not(None)
        ).order_by(PKGame.id.desc()).first()
        if prev_game and prev_game.target_lng is not None and prev_game.target_lat is not None:
            start_lng, start_lat = prev_game.target_lng, prev_game.target_lat
        elif room.mode == "national":
            start_lng, start_lat = CHINA_CENTER
        else:
            region = db.query(Region).filter(Region.code == room.region_code).first()
            if not region or region.lng is None:
                raise ValueError(f"未找到区域: {room.region_code}")
            start_lng, start_lat = region.lng, region.lat

        # 随机选目标
        target = self._pick_target(db, room.mode, room.region_code, room.category, room.difficulty)
        if not target:
            raise ValueError("没有可用的目标点")
        target.used_count += 1

        game = PKGame(
            room_id=room.id,
            target_poi_id=target.id,
            target_lng=target.lng,
            target_lat=target.lat,
            player1_user_id=room.host_user_id,
            player2_user_id=room.guest_user_id,
            player1_view_lng=start_lng,
            player1_view_lat=start_lat,
            player2_view_lng=start_lng,
            player2_view_lat=start_lat,
        )
        db.add(game)

        room.status = "playing"
        room.started_at = datetime.now()
        room.finished_at = None
        room.host_rematch = False
        room.guest_rematch = False
        room.version += 1
        db.commit()
        db.refresh(game)

        logger.info(f"PK game {game.id} started in room {room.id}, target: {target.name}")
        return game

    def _pick_target(self, db: Session, mode: str, region_code: str | None,
                     category: str | None = None, difficulty: str = "hard") -> POI | None:
        query = db.query(POI).filter(POI.verify_status == "approved")
        if category:
            query = query.filter(POI.category == category)
        if mode == "provincial" and region_code:
            query = query.filter(POI.adcode.like(f"{region_code[:2]}%"))
        elif mode == "city" and region_code:
            query = query.filter(POI.adcode.like(f"{region_code[:4]}%"))
        # 游戏难度映射：简单模式只出 1-3，困难模式全池 1-5
        if difficulty == "easy":
            query = query.filter(POI.difficulty <= 3)

        candidates = query.all()
        if not candidates:
            return None

        # 优先选有真实封面图的 POI；若无则回退到全部候选
        with_cover = [p for p in candidates if _has_valid_cover(p)]
        pool = with_cover if with_cover else candidates

        min_used = min(p.used_count for p in pool)
        low_used = [p for p in pool if p.used_count <= min_used + 2]
        return random.choice(low_used)

    def _build_hint_text(self, db: Session, target_poi_id: int | None) -> str | None:
        if not target_poi_id:
            return None
        poi = db.query(POI).filter(POI.id == target_poi_id).first()
        if not poi:
            return None
        # 优先用 address（已含完整"某省 某市 的 某地点"，不依赖 regions 反查）
        if poi.address and "的" in poi.address:
            return poi.address
        # 回退：adcode 反查省市（address 为空的 POI，如直辖市）
        province_name, city_name = None, None
        if poi.adcode and len(poi.adcode) >= 4:
            prov = db.query(Region).filter(
                Region.code == poi.adcode[:2] + "0000000000"
            ).first()
            province_name = prov.name if prov else None
            city = db.query(Region).filter(
                Region.code == poi.adcode[:4] + "00000000"
            ).first()
            city_name = city.name if city else None
        if province_name and city_name and province_name != city_name:
            return f"{province_name} {city_name} 的 {poi.name}"
        elif province_name:
            return f"{province_name} 的 {poi.name}"
        elif city_name:
            return f"{city_name} 的 {poi.name}"
        return poi.name

    def _calc_score(self, time_limit: int, elapsed: int, distance_km: float, hint_level: int) -> int:
        score = 100
        time_saved = time_limit - elapsed
        if time_saved > 0:
            score += min((time_saved // 10) * 5, 50)
        score -= int(distance_km / 100) * 2
        return max(score, 10)

    def _get_active_game_for_user(self, db: Session, game_id: int, user_id: int) -> tuple[PKGame, bool]:
        game = db.query(PKGame).filter(PKGame.id == game_id).first()
        if not game:
            raise ValueError("游戏不存在")

        room = self._get_room(db, game.room_id)
        if room.status == "playing":
            self._check_timeouts(db, room)
            db.refresh(game)

        if self._is_game_finished(game):
            raise ValueError("游戏已结束")

        is_player1 = game.player1_user_id == user_id
        is_player2 = game.player2_user_id == user_id
        if not (is_player1 or is_player2):
            raise ValueError("你不在此游戏中")

        return game, is_player1

    def _get_room(self, db: Session, room_id: int) -> PKRoom:
        room = db.query(PKRoom).filter(PKRoom.id == room_id).first()
        if not room:
            raise ValueError("房间不存在")
        return room

    def _latest_game(self, db: Session, room_id: int) -> PKGame | None:
        return (
            db.query(PKGame)
            .filter(PKGame.room_id == room_id)
            .order_by(PKGame.id.desc())
            .first()
        )

    def _is_game_finished(self, game: PKGame) -> bool:
        return game.winner_user_id is not None or game.win_reason in ("draw", "timeout")

    def _finish_room(self, db: Session, room_id: int) -> None:
        room = db.query(PKRoom).filter(PKRoom.id == room_id).first()
        if room:
            room.status = "finished"
            room.finished_at = datetime.now()
            room.version += 1

    def _finish_by_timeout(self, db: Session, room: PKRoom, game: PKGame, now: datetime) -> None:
        # 计算双方到目标的直线距离
        p1_dist = haversine_km(game.player1_view_lng, game.player1_view_lat, game.target_lng, game.target_lat)
        p2_dist = haversine_km(game.player2_view_lng, game.player2_view_lat, game.target_lng, game.target_lat)

        # 超时得分：基于距离（提示不扣分）
        game.player1_score = max(10, 50 - int(p1_dist / 100) * 2)
        game.player2_score = max(10, 50 - int(p2_dist / 100) * 2)

        # 按距离判定胜负：距离近的赢，一样远才平局
        if p1_dist < p2_dist:
            game.winner_user_id = game.player1_user_id
            game.win_reason = "timeout"
        elif p2_dist < p1_dist:
            game.winner_user_id = game.player2_user_id
            game.win_reason = "timeout"
        else:
            game.win_reason = "draw"

        game.version += 1
        game.finished_at = now
        self._finish_room(db, room.id)

    def _generate_room_code(self, db: Session) -> str:
        chars = string.ascii_uppercase + string.digits
        for _ in range(100):
            code = ''.join(random.choices(chars, k=4))
            exists = db.query(PKRoom).filter(
                PKRoom.room_code == code,
                PKRoom.status.in_(["waiting", "playing"]),
            ).first()
            if not exists:
                return code
        raise ValueError("房间号生成失败，请重试")

    def _check_active_room(self, db: Session, user_id: int) -> None:
        room = db.query(PKRoom).filter(
            (PKRoom.host_user_id == user_id) | (PKRoom.guest_user_id == user_id),
            PKRoom.status.in_(["waiting", "playing"]),
        ).first()

        if not room:
            return

        if room.status == "waiting" and room.guest_user_id is None:
            room.status = "finished"
            room.finished_at = datetime.now()
            db.commit()
            return

        if room.status == "playing":
            raise ValueError("你正在进行中的游戏，请先完成或退出")
        raise ValueError("你已有等待中的房间")

    def _check_timeouts(self, db: Session, room: PKRoom) -> None:
        now = datetime.now()

        if room.status == "playing":
            game = self._latest_game(db, room.id)
            if not game or self._is_game_finished(game):
                return

            time_limit = effective_time_limit(room.mode, room.difficulty)
            elapsed = (now - (room.started_at or game.created_at)).total_seconds()
            if elapsed >= time_limit:
                self._finish_by_timeout(db, room, game, now)
                db.commit()
                logger.info(f"PK timeout: room={room.id} game={game.id}")

        elif room.status == "waiting":
            host_hb = db.query(PKUserActivity).filter(
                PKUserActivity.user_id == room.host_user_id,
                PKUserActivity.room_id == room.id,
            ).first()
            if host_hb and (now - host_hb.last_heartbeat_at).total_seconds() > WAITING_TIMEOUT:
                room.status = "finished"
                room.finished_at = now
                room.version += 1

    def _is_user_stale(self, db: Session, user_id: int | None, room_id: int, now: datetime,
                       grace_from: datetime) -> bool:
        if not user_id:
            return True
        hb = db.query(PKUserActivity).filter(
            PKUserActivity.user_id == user_id,
            PKUserActivity.room_id == room_id,
        ).first()
        if not hb:
            # 尚无心跳记录（首条心跳还在路上）：以房间/对局创建时间为基准，
            # 超过清理时限才视为掉线，避免误杀刚创建的房间
            return (now - grace_from).total_seconds() > CLEANUP_TIMEOUT
        return (now - hb.last_heartbeat_at).total_seconds() > CLEANUP_TIMEOUT


pk_service = PKService()
