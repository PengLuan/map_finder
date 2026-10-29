from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.game import HintForbiddenError, cover_url_for, game_service
from .auth import get_current_user

router = APIRouter(prefix="/api/game", tags=["game"])


# ---- Request / Response Models ----

class StartRequest(BaseModel):
    mode: str  # national / provincial / city
    region_code: str | None = None
    difficulty: str = "hard"  # easy / hard
    category: str | None = None  # 主题分类（可选）
    device: str = "pc"  # pc / mobile
    start_lng: float | None = None  # 再来一局：从上一局目标点开始
    start_lat: float | None = None


class StartResponse(BaseModel):
    game_id: int
    mode: str
    difficulty: str
    start_lng: float
    start_lat: float
    time_limit: int
    tolerance_km: float
    hint_text: str | None = None
    target_cover: str | None = None


class MoveRequest(BaseModel):
    game_id: int
    direction: str  # N/NE/E/SE/S/SW/W/NW
    distance_km: float


class MoveResponse(BaseModel):
    view_lng: float
    view_lat: float
    steps: int
    total_distance_km: float


class UpdateViewRequest(BaseModel):
    game_id: int
    lng: float
    lat: float


class CheckViewRequest(BaseModel):
    game_id: int
    west: float
    south: float
    east: float
    north: float


class CheckViewResponse(BaseModel):
    hit: bool
    distance_km: float | None = None
    score: int | None = None
    target_name: str | None = None
    target_lng: float | None = None
    target_lat: float | None = None
    target_summary: str | None = None
    target_cover: str | None = None
    duration_sec: int | None = None
    steps: int | None = None
    total_distance_km: float | None = None
    target_shape: dict | None = None
    contributor_nickname: str | None = None
    distance_bucket: str | None = None


class ClickRequest(BaseModel):
    game_id: int
    lng: float
    lat: float


class ClickResponse(BaseModel):
    hit: bool
    distance_hint: str | None = None
    distance_km: float | None = None
    score: int | None = None
    target_name: str | None = None
    target_lng: float | None = None
    target_lat: float | None = None
    target_summary: str | None = None
    target_cover: str | None = None
    duration_sec: int | None = None
    steps: int | None = None
    total_distance_km: float | None = None
    target_shape: dict | None = None
    contributor_nickname: str | None = None


class HintRequest(BaseModel):
    game_id: int
    hint_level: int


class HintResponse(BaseModel):
    hint_level: int
    content: str
    cost: int = 0
    bounds: dict | None = None
    hint_credits: int = 100


class GameStateResponse(BaseModel):
    game_id: int
    mode: str
    status: str
    view_lng: float
    view_lat: float
    steps: int
    total_distance_km: float
    hints_used: int
    hint_level: int
    duration_sec: int
    hint_credits: int = 100
    device: str = "pc"


class GiveUpRequest(BaseModel):
    game_id: int


class LocationHintResponse(BaseModel):
    current_province: str | None = None
    in_target_province: bool = False
    current_city: str | None = None
    in_target_city: bool = False


class RegionResponse(BaseModel):
    code: str
    name: str
    level: int
    lng: float | None = None
    lat: float | None = None


class ThemeResponse(BaseModel):
    code: str
    name: str
    description: str | None = None
    icon: str | None = None
    cover_url: str | None = None
    group_name: str | None = None
    poi_count: int = 0


# ---- Routes ----

@router.post("/start", response_model=StartResponse)
def start_game(req: StartRequest, db: Session = Depends(get_db),
               user=Depends(get_current_user)):
    try:
        game = game_service.start_game(db, req.mode, req.region_code,
                                       player_id=user.id if user else None,
                                       difficulty=req.difficulty,
                                       category=req.category,
                                       device=req.device,
                                       start_lng=req.start_lng,
                                       start_lat=req.start_lat)
        from ..services.game import MODE_CONFIG, effective_time_limit
        cfg = MODE_CONFIG[req.mode]

        # 提示格式：某某省 某某市/县 的某某地点
        from ..models import POI, Region
        poi = db.query(POI).filter(POI.id == game.target_poi_id).first()
        hint_text = None
        if poi:
            # 优先用 address（完整"某省 某市 的 某地点"文本，不依赖 regions 反查）
            if poi.address and "的" in poi.address:
                hint_text = poi.address
            else:
                # 回退：adcode 反查省市（address 为空的知名 POI）
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
                # 直辖市省市同名，只显示一次
                if province_name and city_name and province_name != city_name:
                    hint_text = f"{province_name} {city_name} 的 {poi.name}"
                elif province_name:
                    hint_text = f"{province_name} 的 {poi.name}"
                elif city_name:
                    hint_text = f"{city_name} 的 {poi.name}"
                else:
                    hint_text = poi.name

        return StartResponse(
            game_id=game.id,
            mode=game.mode,
            difficulty=game.difficulty,
            start_lng=game.start_lng,
            start_lat=game.start_lat,
            time_limit=effective_time_limit(req.mode, game.difficulty),
            tolerance_km=cfg["tolerance_km"],
            hint_text=hint_text,
            target_cover=cover_url_for(poi),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/move", response_model=MoveResponse)
def move_view(req: MoveRequest, db: Session = Depends(get_db)):
    try:
        game = game_service.move_view(db, req.game_id, req.direction, req.distance_km)
        return MoveResponse(
            view_lng=game.view_lng,
            view_lat=game.view_lat,
            steps=game.steps,
            total_distance_km=round(game.total_distance_km, 1),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/update-view")
def update_view(req: UpdateViewRequest, db: Session = Depends(get_db)):
    try:
        game = game_service.update_view(db, req.game_id, req.lng, req.lat)
        return {
            "view_lng": game.view_lng,
            "view_lat": game.view_lat,
            "total_distance_km": round(game.total_distance_km, 1),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/check-view", response_model=CheckViewResponse)
def check_view(req: CheckViewRequest, db: Session = Depends(get_db)):
    try:
        result = game_service.check_view(
            db, req.game_id, req.west, req.south, req.east, req.north
        )
        return CheckViewResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/click", response_model=ClickResponse)
def click_target(req: ClickRequest, db: Session = Depends(get_db)):
    try:
        result = game_service.click_target(db, req.game_id, req.lng, req.lat)
        return ClickResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/hint", response_model=HintResponse)
def get_hint(req: HintRequest, db: Session = Depends(get_db)):
    try:
        result = game_service.get_hint(db, req.game_id, req.hint_level)
        return HintResponse(**result)
    except HintForbiddenError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/giveup")
def give_up(req: GiveUpRequest, db: Session = Depends(get_db)):
    try:
        return game_service.give_up(db, req.game_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/state/{game_id}", response_model=GameStateResponse)
def get_state(game_id: int, db: Session = Depends(get_db)):
    try:
        game = game_service.get_game_state(db, game_id)
        return GameStateResponse(
            game_id=game.id,
            mode=game.mode,
            status=game.status,
            view_lng=game.view_lng,
            view_lat=game.view_lat,
            steps=game.steps,
            total_distance_km=round(game.total_distance_km, 1),
            hints_used=game.hints_used,
            hint_level=game.hint_level,
            duration_sec=game.duration_sec,
            hint_credits=game.hint_credits,
            device=game.device,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{game_id}/location-hint", response_model=LocationHintResponse)
def get_location_hint(game_id: int, stage: str = "province",
                      db: Session = Depends(get_db)):
    """困难 C 救济：当前视野中心所在省/市，对比目标省/市。"""
    try:
        result = game_service.get_location_hint(db, game_id, stage)
        return LocationHintResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/regions")
def get_regions(level: int = 1, parent_code: str | None = None,
                db: Session = Depends(get_db)):
    regions = game_service.get_regions(db, level, parent_code)
    return [
        RegionResponse(
            code=r.code, name=r.name, level=r.level, lng=r.lng, lat=r.lat
        )
        for r in regions
    ]


@router.get("/themes", response_model=list[ThemeResponse])
def get_themes(db: Session = Depends(get_db)):
    return [ThemeResponse(**t) for t in game_service.get_themes(db)]
