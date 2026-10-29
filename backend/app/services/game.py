import math
import random
from datetime import datetime
from urllib.parse import quote

from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session

from ..config import settings
from ..models import GameRecord, POI, POITheme, Region
from . import geometry

def _has_valid_cover(poi: POI) -> bool:
    """判断 POI 是否有封面图（OSS 与外链均为真实照片）"""
    return bool(poi.cover_url)

# 初始点：北京天安门
CHINA_CENTER = (116.397, 39.908)

# 方向角度映射（度数，正北为0，顺时针）
DIRECTION_ANGLES = {
    "N": 0,
    "NE": 45,
    "E": 90,
    "SE": 135,
    "S": 180,
    "SW": 225,
    "W": 270,
    "NW": 315,
}

MODE_CONFIG = {
    "national": {
        "tolerance_km": settings.national_tolerance_km,
        "time_limit": settings.national_time_limit,
        "adcode_prefix_len": 0,
    },
    "provincial": {
        "tolerance_km": settings.provincial_tolerance_km,
        "time_limit": settings.provincial_time_limit,
        "adcode_prefix_len": 2,
    },
    "city": {
        "tolerance_km": settings.city_tolerance_km,
        "time_limit": settings.city_time_limit,
        "adcode_prefix_len": 4,
    },
}

# 简单模式：点击地图判定，点击点距目标不超过该距离（km）即胜利
EASY_CLICK_THRESHOLD_KM = 0.5

DIFFICULTIES = ("easy", "hard")

# 有效设备类型
DEVICES = ("pc", "mobile")


class HintForbiddenError(Exception):
    """提示被拒绝（积分不足或配额超限），路由层捕获返回 403。"""


# ===== 提示单次消耗 / 配额（文档 3.5 表，权威） =====
# 按 (difficulty, hint_level) -> {"pc": (cost, quota), "mobile": (cost, quota)}
# 简单模式 level 2/4 合并为"简单方向提示"，配额 PC 3/移动 10，单独由 easy_dir_hint_count 统计

# 单调解锁的提示等级（level 1/3 简单模式、level 1/2/3/4 困难模式）单次消耗
HINT_COST = {
    # level: {"pc": cost, "mobile": cost}
    1: {"pc": 5, "mobile": 3},
    2: {"pc": 10, "mobile": 5},
    3: {"pc": 25, "mobile": 15},
    4: {"pc": 35, "mobile": 25},
}

# 困难模式 level 2（方位）可反复调用，只扣积分不设硬性配额
HINT_COST_LEVEL2_BY_MODE = {
    "national": {"pc": 40, "mobile": 20},
    "provincial": {"pc": 40, "mobile": 20},
    "city": {"pc": 40, "mobile": 20},
}

# 简单模式方向提示（level 2/4 合并）配额与单次消耗
EASY_DIR_HINT = {
    "pc": {"cost": 10, "quota": 3},
    "mobile": {"cost": 5, "quota": 10},
}


def distance_bucket(km: float) -> str:
    """未命中时返回距离范围提示（防三角定位，只给区间不给精确值）"""
    if km < 1:
        return "1km 以内"
    if km < 5:
        return "1-5km"
    if km < 20:
        return "5-20km"
    if km < 100:
        return "20-100km"
    if km < 300:
        return "100-300km"
    return "300km+"


def effective_time_limit(mode: str, difficulty: str) -> int:
    """点选模式(easy)时限减半，巡航模式(hard)使用全时限"""
    limit = MODE_CONFIG[mode]["time_limit"]
    return limit // 2 if difficulty == "easy" else limit


def haversine_km(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    """计算两点间球面距离（km）"""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    return R * 2 * math.asin(math.sqrt(a))


def move_point(lng: float, lat: float, direction: str, distance_km: float) -> tuple[float, float]:
    """从 (lng, lat) 沿 direction 方向移动 distance_km 公里，返回新坐标"""
    angle = math.radians(DIRECTION_ANGLES[direction])
    R = 6371.0
    d = distance_km / R

    lat1 = math.radians(lat)
    lng1 = math.radians(lng)

    lat2 = math.asin(
        math.sin(lat1) * math.cos(d) + math.cos(lat1) * math.sin(d) * math.cos(angle)
    )
    lng2 = lng1 + math.atan2(
        math.sin(angle) * math.sin(d) * math.cos(lat1),
        math.cos(d) - math.sin(lat1) * math.sin(lat2),
    )

    return (math.degrees(lng2), math.degrees(lat2))


def bearing_degrees(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    """计算从点1到点2的方位角（度，正北为0）"""
    lat1_r, lat2_r = math.radians(lat1), math.radians(lat2)
    dlng = math.radians(lng2 - lng1)
    x = math.sin(dlng) * math.cos(lat2_r)
    y = math.cos(lat1_r) * math.sin(lat2_r) - math.sin(lat1_r) * math.cos(lat2_r) * math.cos(dlng)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def bearing_to_chinese(degrees: float) -> str:
    """方位角转中文方向（8 方位）"""
    dirs = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]
    idx = round(degrees / 45) % 8
    return dirs[idx]


def bearing_to_offset(degrees: float) -> str:
    """方位角转偏角表达（正北为 0°，顺时针）。

    返回示例：
    - 0° → 正北方向
    - 30° → 北偏东 30度
    - 60° → 东偏北 30度
    - 90° → 正东方向
    - 283° → 西偏北 13度
    - 315° → 西北方向
    """
    d = degrees % 360
    # 4 主方向：(中心角度, 主方向名, 顺时针偏向, 逆时针偏向)
    cardinals = [
        (0, "北", "东", "西"),
        (90, "东", "南", "北"),
        (180, "南", "西", "东"),
        (270, "西", "北", "南"),
    ]
    # 找最近的主方向
    best = min(cardinals, key=lambda c: min(abs(d - c[0]), 360 - abs(d - c[0])))
    ang, main, cw, ccw = best
    diff = d - ang
    if diff > 180:
        diff -= 360
    if diff < -180:
        diff += 360
    ad = abs(diff)
    # 偏角接近 45°（±2°）时，用方位词更简洁（东北/东南/西南/西北）
    if abs(ad - 45) < 2:
        bias = cw if diff > 0 else ccw
        pair = {("北", "东"): "东北", ("东", "北"): "东北",
                ("东", "南"): "东南", ("南", "东"): "东南",
                ("南", "西"): "西南", ("西", "南"): "西南",
                ("西", "北"): "西北", ("北", "西"): "西北"}
        return f"{pair.get((main, bias), main + bias)}方向"
    if ad < 1:
        return f"正{main}方向"
    bias = cw if diff > 0 else ccw
    return f"{main}偏{bias} {int(ad)}度"


def _load_province_outlines() -> dict[str, list[tuple[float, float]]]:
    """加载省级轮廓 {adcode6: [(lng, lat), ...]}，模块级缓存。文件缺失时返回空。"""
    import json
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "data" / "province_outlines.json"
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return {k: [tuple(p) for p in v["ring"]] for k, v in raw.items()}
    except (ValueError, OSError):
        return {}


_PROVINCE_OUTLINES = _load_province_outlines()


def _point_in_ring(lng: float, lat: float, ring: list[tuple[float, float]]) -> bool:
    """射线法判断点是否在环内。"""
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > lat) != (yj > lat)) and \
                lng < (xj - xi) * (lat - yi) / (yj - yi + 1e-18) + xi:
            inside = not inside
        j = i
    return inside


def _bbox_area(r) -> float:
    return max(0.0, r.bbox_e - r.bbox_w) * max(0.0, r.bbox_n - r.bbox_s)


def bbox_lookup(regions: list[Region], lng: float, lat: float) -> str | None:
    """在 regions 中查找包含 (lng, lat) 的区域。

    1. 轮廓多边形精确判定（省级数据来自 app/data/province_outlines.json）
    2. bbox 包含（多个 bbox 重叠时取面积最小的，不规则形状省份的矩形 bbox 重叠更少误判）
    3. 回退：lng/lat 最近匹配
    """
    # 1. 轮廓多边形判定（仅省级 level=1 调用方会用 34 省数据，按 code 前 6 位匹配）
    if _PROVINCE_OUTLINES:
        for r in regions:
            ring = _PROVINCE_OUTLINES.get(r.code[:6])
            if ring and _point_in_ring(lng, lat, ring):
                return r.name
    # 2. bbox 包含（重叠时取最小 bbox）
    candidates = [
        r for r in regions
        if r.bbox_w is not None and r.bbox_e is not None \
                and r.bbox_s is not None and r.bbox_n is not None
        and r.bbox_w <= lng <= r.bbox_e and r.bbox_s <= lat <= r.bbox_n
    ]
    if candidates:
        return min(candidates, key=_bbox_area).name
    # 3. 回退：lng/lat 最近匹配
    best = None
    best_d = float("inf")
    for r in regions:
        if r.lng is not None and r.lat is not None:
            d = haversine_km(lng, lat, r.lng, r.lat)
            if d < best_d:
                best_d = d
                best = r
    return best.name if best else None


def current_location_text(db: Session, lng: float, lat: float) -> str:
    """反查当前视野中心所在省市，返回"你当前位于 XX省 XX市"文案。

    省或市查不到时省略对应部分；都查不到时返回"你当前位于中国境内"。
    """
    provinces = db.query(Region).filter(Region.level == 1).all()
    province_name = bbox_lookup(provinces, lng, lat)

    city_name = None
    if province_name:
        prov_obj = next((p for p in provinces if p.name == province_name), None)
        if prov_obj:
            cities = db.query(Region).filter(
                Region.level == 2, Region.parent_code == prov_obj.code
            ).all()
            city_name = bbox_lookup(cities, lng, lat)

    if province_name and city_name:
        return f"你当前位于 {province_name} {city_name}"
    if province_name:
        return f"你当前位于 {province_name}"
    return "你当前位于中国境内"


def cover_url_for(poi: POI | None) -> str | None:
    """返回目标封面图：优先使用 POI 自带照片，否则按地名生成景观图"""
    if not poi:
        return None
    if poi.cover_url:
        return poi.cover_url
    prompt = (
        f"aerial landscape photograph of {poi.name} in China, "
        f"famous scenic landmark, photorealistic, golden hour light, "
        f"dramatic natural scenery, high detail"
    )
    return (
        "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image"
        f"?prompt={quote(prompt)}&image_size=landscape_16_9"
    )


class GameService:
    def start_game(self, db: Session, mode: str, region_code: str | None = None,
                   player_id: int | None = None, difficulty: str = "hard",
                   category: str | None = None, device: str = "pc",
                   start_lng: float | None = None, start_lat: float | None = None) -> GameRecord:
        if mode not in MODE_CONFIG:
            raise ValueError(f"无效的游戏模式: {mode}")
        if difficulty not in DIFFICULTIES:
            raise ValueError(f"无效的难度: {difficulty}")
        if device not in DEVICES:
            raise ValueError(f"无效的设备类型: {device}")
        if category:
            exists = db.query(POITheme.code).filter(
                POITheme.code == category, POITheme.enabled.is_(True)).first()
            if not exists:
                raise ValueError(f"无效的主题: {category}")

        # 确定起点：优先使用上一局目标点（再来一局），否则用默认起点
        if start_lng is not None and start_lat is not None:
            start_lng, start_lat = float(start_lng), float(start_lat)
        elif mode == "national":
            start_lng, start_lat = CHINA_CENTER
        elif mode in ("provincial", "city") and region_code:
            region = db.query(Region).filter(Region.code == region_code).first()
            if not region or region.lng is None:
                raise ValueError(f"未找到区域: {region_code}")
            start_lng, start_lat = region.lng, region.lat
        else:
            raise ValueError("省级/城市模式需要指定 region_code")

        # 随机选目标点
        target = self._pick_target(db, mode, region_code, category, difficulty)
        if not target:
            raise ValueError("没有可用的目标点，请先导入 POI 数据")

        target.used_count += 1

        game = GameRecord(
            player_id=player_id,
            mode=mode,
            difficulty=difficulty,
            region_code=region_code,
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
        db.add(game)
        db.commit()
        db.refresh(game)
        return game

    def _pick_target(self, db: Session, mode: str, region_code: str | None,
                     category: str | None = None, difficulty: str = "hard") -> POI | None:
        query = db.query(POI).filter(POI.verify_status == "approved")

        # 按主题筛选
        if category:
            query = query.filter(POI.category == category)

        # 按区域筛选
        if mode == "provincial" and region_code:
            query = query.filter(POI.adcode.like(f"{region_code[:2]}%"))
        elif mode == "city" and region_code:
            query = query.filter(POI.adcode.like(f"{region_code[:4]}%"))

        # 游戏难度映射 POI difficulty：简单模式只出 1-3（知名+中等），困难模式全池 1-5
        if difficulty == "easy":
            query = query.filter(POI.difficulty <= 3)

        candidates = query.all()
        if not candidates:
            return None

        # 优先选有真实封面图的 POI；若无则回退到全部候选
        with_cover = [p for p in candidates if _has_valid_cover(p)]
        pool = with_cover if with_cover else candidates

        # 在候选池中优先选使用次数少的
        min_used = min(p.used_count for p in pool)
        low_used = [p for p in pool if p.used_count <= min_used + 2]
        return random.choice(low_used)

    def move_view(self, db: Session, game_id: int, direction: str,
                  distance_km: float) -> GameRecord:
        game = self._get_playing_game(db, game_id)

        if direction not in DIRECTION_ANGLES:
            raise ValueError(f"无效方向: {direction}")
        if not (1 <= distance_km <= 2000):
            raise ValueError("移动距离需在 1~2000 km 之间")

        new_lng, new_lat = move_point(game.view_lng, game.view_lat, direction, distance_km)
        game.view_lng = new_lng
        game.view_lat = new_lat
        game.steps += 1
        game.total_distance_km += distance_km

        db.commit()
        db.refresh(game)
        return game

    def update_view(self, db: Session, game_id: int, lng: float, lat: float) -> GameRecord:
        """拖拽/巡航后更新视野中心（不消耗步数）。

        同步把旧 view 存入 prev_view_lng/lat，供困难 A 救济计算屏幕中心变化方向。
        困难模式累加本次视野移动距离到 total_distance_km（巡航和拖拽均计入）；
        简单模式不计入（简单模式以点击判定为主，避免拖拽探索被距离惩罚）。
        """
        game = self._get_playing_game(db, game_id)
        # 困难模式累加视野移动距离
        if game.difficulty == "hard" and game.view_lng is not None and game.view_lat is not None:
            moved = haversine_km(game.view_lng, game.view_lat, lng, lat)
            # 过滤极小抖动（< 0.05km），避免拖拽静止时累积噪声
            if moved > 0.05:
                game.total_distance_km += moved
        game.prev_view_lng = game.view_lng
        game.prev_view_lat = game.view_lat
        game.view_lng = lng
        game.view_lat = lat
        db.commit()
        db.refresh(game)
        return game

    def check_view(self, db: Session, game_id: int,
                   west: float, south: float, east: float, north: float) -> dict:
        """视野判定：目标范围与当前视野矩形有交集即胜利（仅困难模式）。

        未命中时返回 distance_bucket（视野中心到目标范围边界的距离区间），
        供前端困难模式 B 救济据此触发方向 toast。
        """
        game = self._get_playing_game(db, game_id)

        # 简单模式不使用视野框判定
        if game.difficulty == "easy":
            return {"hit": False}

        poi = db.query(POI).filter(POI.id == game.target_poi_id).first()
        hit = geometry.rect_hits_target(west, south, east, north, poi) if poi else False
        if not hit:
            edge_dist = (
                geometry.distance_to_target_edge(game.view_lng, game.view_lat, poi)
                if poi
                else haversine_km(game.view_lng, game.view_lat, game.target_lng, game.target_lat)
            )
            return {"hit": False, "distance_bucket": distance_bucket(edge_dist)}

        elapsed = int((datetime.now() - game.started_at).total_seconds())
        dist = haversine_km(game.view_lng, game.view_lat, game.target_lng, game.target_lat)
        game.duration_sec = elapsed
        game.hit_distance_km = dist
        game.status = "won"
        game.hit = True
        game.score = self._calc_score(game, elapsed)
        game.finished_at = datetime.now()
        db.commit()
        db.refresh(game)

        return {
            "hit": True,
            "distance_km": round(dist, 2),
            "score": game.score,
            "target_name": poi.name if poi else "未知",
            "target_poi_id": poi.id if poi else None,
            "target_lng": game.target_lng,
            "target_lat": game.target_lat,
            "target_summary": poi.summary if poi else None,
            "target_cover": cover_url_for(poi),
            "duration_sec": elapsed,
            "steps": game.steps,
            "total_distance_km": round(game.total_distance_km, 1),
            "target_shape": geometry.target_shape_dict(poi) if poi else None,
            "contributor_nickname": poi.contributor_nickname if poi else None,
        }

    def click_target(self, db: Session, game_id: int, lng: float, lat: float) -> dict:
        """简单模式：点击地图判定，点击点落入目标范围即胜利"""
        game = self._get_playing_game(db, game_id)

        if game.difficulty != "easy":
            raise ValueError("仅点选模式支持点击判定")

        poi = db.query(POI).filter(POI.id == game.target_poi_id).first()
        hit = geometry.point_hits_target(lng, lat, poi) if poi else False
        if not hit:
            # 未命中：到范围边界最近距离的区间提示（防三角定位）
            edge_dist = geometry.distance_to_target_edge(lng, lat, poi) if poi else \
                haversine_km(lng, lat, game.target_lng, game.target_lat)
            return {"hit": False, "distance_hint": distance_bucket(edge_dist)}

        elapsed = int((datetime.now() - game.started_at).total_seconds())
        dist = haversine_km(lng, lat, game.target_lng, game.target_lat)
        game.view_lng = lng
        game.view_lat = lat
        game.duration_sec = elapsed
        game.hit_distance_km = dist
        game.status = "won"
        game.hit = True
        game.score = self._calc_score(game, elapsed)
        game.finished_at = datetime.now()
        db.commit()
        db.refresh(game)

        return {
            "hit": True,
            "distance_km": round(dist, 2),
            "score": game.score,
            "target_name": poi.name if poi else "未知",
            "target_poi_id": poi.id if poi else None,
            "target_lng": game.target_lng,
            "target_lat": game.target_lat,
            "target_summary": poi.summary if poi else None,
            "target_cover": cover_url_for(poi),
            "duration_sec": elapsed,
            "steps": game.steps,
            "total_distance_km": round(game.total_distance_km, 1),
            "target_shape": geometry.target_shape_dict(poi) if poi else None,
            "contributor_nickname": poi.contributor_nickname if poi else None,
        }

    def give_up(self, db: Session, game_id: int) -> dict:
        game = self._get_playing_game(db, game_id)
        game.status = "given_up"
        game.finished_at = datetime.now()
        elapsed = int((datetime.now() - game.started_at).total_seconds())
        game.duration_sec = elapsed

        dist = haversine_km(game.view_lng, game.view_lat, game.target_lng, game.target_lat)
        game.hit_distance_km = dist

        db.commit()

        poi = db.query(POI).filter(POI.id == game.target_poi_id).first()
        return {
            "target_name": poi.name if poi else "未知",
            "target_poi_id": poi.id if poi else None,
            "target_lng": game.target_lng,
            "target_lat": game.target_lat,
            "target_summary": poi.summary if poi else None,
            "target_cover": cover_url_for(poi),
            "distance_km": round(dist, 2),
            "total_distance_km": round(game.total_distance_km, 1),
            "target_shape": geometry.target_shape_dict(poi) if poi else None,
        }

    def get_hint(self, db: Session, game_id: int, hint_level: int) -> dict:
        """获取提示（分级）。

        简单模式：
        - level 2/4 合并为"简单方向提示"，不校验单调递增，允许反复调用，
          合并计配额（PC 3/移动 10），单次消耗（PC 10/移动 5），不推进 hint_level。
          level 4 不再返回 bounds，改为返回方向文案（与 level 2 同形态）。
        - level 1/3 保留单调递增校验，推进 hint_level，配额 1/1。

        困难模式：保留 4 级单调递增，level 4 仍返回 bounds。

        所有提示按 device 查消耗表扣 hint_credits，不足抛 HintForbiddenError(403)。
        """
        game = self._get_playing_game(db, game_id)

        if hint_level < 1 or hint_level > 4:
            raise ValueError("无效的提示等级")

        device = game.device or "pc"
        is_easy = game.difficulty == "easy"

        # 简单模式 level 2/4：合并为方向提示，可反复
        if is_easy and hint_level in (2, 4):
            cfg = EASY_DIR_HINT[device]
            if game.easy_dir_hint_count >= cfg["quota"]:
                raise HintForbiddenError("方向提示次数已用完")
            if game.hint_credits < cfg["cost"]:
                raise HintForbiddenError("积分不足")
            game.hint_credits -= cfg["cost"]
            game.easy_dir_hint_count += 1

            brg = bearing_degrees(game.view_lng, game.view_lat, game.target_lng, game.target_lat)
            dist = haversine_km(game.view_lng, game.view_lat, game.target_lng, game.target_lat)
            content = (
                f"目标在你当前视野{bearing_to_offset(brg)}，约 {distance_bucket(dist)}"
            )
            db.commit()
            return {
                "hint_level": hint_level,
                "content": content,
                "cost": cfg["cost"],
                "hint_credits": game.hint_credits,
            }

        # 困难模式 level 2（方位）：可反复调用，只扣积分，不设硬性配额，不推进 hint_level
        if (not is_easy) and hint_level == 2:
            mode_key = game.mode if game.mode in HINT_COST_LEVEL2_BY_MODE else "provincial"
            cost = HINT_COST_LEVEL2_BY_MODE[mode_key][device]
            if game.hint_credits < cost:
                raise HintForbiddenError("积分不足")
            game.hint_credits -= cost
            game.bearing_hint_count += 1
            db.commit()

            brg = bearing_degrees(game.view_lng, game.view_lat, game.target_lng, game.target_lat)
            return {
                "hint_level": hint_level,
                "cost": cost,
                "hint_credits": game.hint_credits,
                "content": f"目标在当前视野{bearing_to_offset(brg)}",
            }

        # level 1/3（简单模式）与 level 1/3/4（困难模式）：单调解锁
        if hint_level <= game.hint_level:
            raise ValueError("该提示已解锁")

        cost = HINT_COST[hint_level][device]
        if game.hint_credits < cost:
            raise HintForbiddenError("积分不足")

        game.hint_credits -= cost
        game.hint_level = hint_level
        if hint_level >= 3:
            game.hints_used += 1
        db.commit()

        result: dict = {"hint_level": hint_level, "cost": cost, "hint_credits": game.hint_credits}

        if hint_level == 1:
            # 提示玩家当前所在省市（用视野中心反查 regions bbox），而非目标所在省
            result["content"] = current_location_text(db, game.view_lng, game.view_lat)
        elif hint_level == 3:
            result["content"] = f"目标坐标约：{game.target_lng:.1f}°E, {game.target_lat:.1f}°N"
        elif hint_level == 4:
            # 困难模式：返回矩形框 bounds
            offset = 2.0 if game.mode == "national" else 0.5
            result["bounds"] = {
                "west": game.target_lng - offset,
                "east": game.target_lng + offset,
                "south": game.target_lat - offset,
                "north": game.target_lat + offset,
            }
            result["content"] = "已在地图上标出目标所在区域（黄色矩形）"

        return result

    def get_game_state(self, db: Session, game_id: int) -> GameRecord:
        return self._get_game(db, game_id)

    def get_regions(self, db: Session, level: int, parent_code: str | None = None) -> list[Region]:
        query = db.query(Region).filter(Region.level == level)
        if parent_code:
            query = query.filter(Region.parent_code == parent_code)
        return query.order_by(Region.code).all()

    def get_themes(self, db: Session) -> list[dict]:
        """返回启用的主题列表，附带各主题的有效 POI 数量"""
        themes = (
            db.query(POITheme)
            .filter(POITheme.enabled.is_(True))
            .order_by(POITheme.sort_order, POITheme.id)
            .all()
        )
        # 一次性统计各 category 的 POI 数
        counts = dict(
            db.query(POI.category, sa_func.count(POI.id))
            .group_by(POI.category)
            .all()
        )
        result = []
        for t in themes:
            result.append({
                "code": t.code,
                "name": t.name,
                "description": t.description,
                "icon": t.icon,
                "cover_url": t.cover_url,
                "group_name": t.group_name,
                "poi_count": counts.get(t.code, 0),
            })
        return result

    def _calc_score(self, game: GameRecord, elapsed: int) -> int:
        score = 100  # 基础分

        # 时间加成：每少用10秒 +5，上限 +50（简单模式按减半后的时限计算）
        time_saved = effective_time_limit(game.mode, game.difficulty) - elapsed
        if time_saved > 0:
            score += min((time_saved // 10) * 5, 50)

        # 移动距离惩罚：每100km -2
        score -= int(game.total_distance_km / 100) * 2

        # 剩余积分加成：移除原 level3 -20 / level4 -40 扣分，改为剩余积分×0.5 加成
        score += int(game.hint_credits * 0.5)

        return max(score, 10)

    # ===== 困难模式 C 救济：当前位置反查（bbox）=====

    def get_location_hint(self, db: Session, game_id: int, stage: str) -> dict:
        """困难 C 救济：取当前视野中心，用 regions 表 bbox 反查所在省/市，
        对比目标 POI 的省/市。stage: province / city。

        bbox 为空时回退用 region.lng/lat 做最近匹配。regions 无数据则返回 None。
        """
        if stage not in ("province", "city"):
            raise ValueError("stage 必须为 province 或 city")

        game = self._get_playing_game(db, game_id)
        lng, lat = game.view_lng, game.view_lat

        provinces = db.query(Region).filter(Region.level == 1).all()
        current_province = self._bbox_lookup(provinces, lng, lat)

        current_city = None
        if stage == "city" and current_province is not None:
            prov_obj = next((p for p in provinces if p.name == current_province), None)
            if prov_obj:
                cities = db.query(Region).filter(
                    Region.level == 2, Region.parent_code == prov_obj.code
                ).all()
                current_city = self._bbox_lookup(cities, lng, lat)

        poi = db.query(POI).filter(POI.id == game.target_poi_id).first()

        in_target_province = False
        in_target_city = False
        if poi and poi.adcode and current_province:
            target_prov = db.query(Region).filter(
                Region.code.like(f"{poi.adcode[:2]}%"), Region.level == 1
            ).first()
            if target_prov and current_province == target_prov.name:
                in_target_province = True
            if stage == "city" and current_city and len(poi.adcode) >= 4:
                target_city = db.query(Region).filter(
                    Region.code == poi.adcode[:4] + "00000000"
                ).first()
                if target_city and current_city == target_city.name:
                    in_target_city = True

        return {
            "current_province": current_province,
            "in_target_province": in_target_province,
            "current_city": current_city,
            "in_target_city": in_target_city,
        }

    def _bbox_lookup(self, regions: list[Region], lng: float, lat: float) -> str | None:
        """在 regions 中按 bbox 查找包含 (lng, lat) 的区域（兼容旧调用，转调模块级函数）。"""
        return bbox_lookup(regions, lng, lat)

    def _get_playing_game(self, db: Session, game_id: int) -> GameRecord:
        game = db.query(GameRecord).filter(GameRecord.id == game_id).first()
        if not game:
            raise ValueError("游戏不存在")
        if game.status != "playing":
            raise ValueError("游戏已结束")
        return game

    def _get_game(self, db: Session, game_id: int) -> GameRecord:
        game = db.query(GameRecord).filter(GameRecord.id == game_id).first()
        if not game:
            raise ValueError("游戏不存在")
        return game


game_service = GameService()
