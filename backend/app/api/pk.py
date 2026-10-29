"""PK 对战 API：房间管理 + 地图对战"""
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.auth import auth_service
from ..services.pk import pk_service

router = APIRouter(prefix="/api/pk", tags=["pk"])


# ===== 请求模型 =====


class CreateRoomRequest(BaseModel):
    mode: str  # national / provincial / city
    region_code: str | None = None
    difficulty: str = "hard"  # easy / hard
    category: str | None = None  # 主题分类（可选）


class JoinRoomRequest(BaseModel):
    room_code: str


class MoveRequest(BaseModel):
    direction: str  # N/NE/E/SE/S/SW/W/NW
    distance_km: float


class UpdateViewRequest(BaseModel):
    lng: float
    lat: float


class CheckViewRequest(BaseModel):
    west: float
    south: float
    east: float
    north: float


class ClickRequest(BaseModel):
    lng: float
    lat: float


class HintRequest(BaseModel):
    hint_level: int


class HeartbeatRequest(BaseModel):
    room_id: int


# ===== 认证依赖 =====


def get_current_user(authorization: str = Header(...), db: Session = Depends(get_db)):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="无效的认证头")
    token = authorization[7:]
    user_id = auth_service.verify_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Token 无效或已过期")
    from ..models import User
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    return user


# ===== 房间相关 =====


@router.post("/room/create")
def create_room(req: CreateRoomRequest, user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        room = pk_service.create_room(db, user.id, req.mode, req.region_code,
                                      req.difficulty, req.category)
        return {"room_code": room.room_code, "room_id": room.id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/room/join")
def join_room(req: JoinRoomRequest, user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        room = pk_service.join_room(db, req.room_code, user.id)
        return {
            "room_id": room.id,
            "host_user_id": room.host_user_id,
            "mode": room.mode,
            "region_code": room.region_code,
            "difficulty": room.difficulty,
            "category": room.category,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/room/{room_id}/status")
def get_room_status(room_id: int, db: Session = Depends(get_db)):
    try:
        return pk_service.get_room_status(db, room_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/room/{room_id}/leave")
def leave_room(room_id: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return pk_service.leave_room(db, room_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/room/{room_id}/start")
def start_game(room_id: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return pk_service.start_game(db, room_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/room/{room_id}/rematch")
def request_rematch(room_id: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return pk_service.request_rematch(db, room_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ===== 游戏相关 =====


@router.get("/game/{game_id}/state")
def get_game_state(game_id: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return pk_service.get_game_state(db, game_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/game/{game_id}/move")
def move_view(game_id: int, req: MoveRequest, user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return pk_service.move_view(db, game_id, user.id, req.direction, req.distance_km)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/game/{game_id}/update-view")
def update_view(game_id: int, req: UpdateViewRequest, user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return pk_service.update_view(db, game_id, user.id, req.lng, req.lat)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/game/{game_id}/check-view")
def check_view(game_id: int, req: CheckViewRequest, user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return pk_service.check_view(db, game_id, user.id, req.west, req.south, req.east, req.north)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/game/{game_id}/click")
def click_target(game_id: int, req: ClickRequest, user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return pk_service.click_target(db, game_id, user.id, req.lng, req.lat)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/game/{game_id}/hint")
def use_hint(game_id: int, req: HintRequest, user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return pk_service.use_hint(db, game_id, user.id, req.hint_level)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/game/{game_id}/give-up")
def give_up(game_id: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return pk_service.give_up(db, game_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ===== 状态恢复 & 心跳 =====


@router.get("/user/status")
def get_user_status(user=Depends(get_current_user), db: Session = Depends(get_db)):
    return pk_service.get_user_status(db, user.id)


@router.post("/heartbeat")
def send_heartbeat(req: HeartbeatRequest, user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return pk_service.heartbeat(db, user.id, req.room_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/cleanup")
def cleanup_stale_rooms(db: Session = Depends(get_db)):
    count = pk_service.cleanup_stale_rooms(db)
    return {"cleaned": count}
