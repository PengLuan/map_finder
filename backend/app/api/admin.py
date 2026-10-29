"""后台管理 API：认证 + 主题/POI 管理 + 玩家会话统计 + UGC 投稿 + 文件上传。"""
import os
import time
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import POICorrection, POISubmission, POITheme
from ..services import dev_plan as dev_plan_service
from ..services.admin import admin_service
from ..services.feedback import feedback_service

router = APIRouter(prefix="/api", tags=["admin"])

_UGC_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "static", "ugc-covers",
)


# ===== 认证依赖 =====

class LoginIn(BaseModel):
    username: str
    password: str


def _valid_admin_tokens() -> set[str]:
    """返回所有合法的管理员 token（密码本身即 token）。"""
    tokens = {settings.admin_password}
    # 兼容旧配置：若单独设置了 admin_token，也接受
    if settings.admin_token:
        tokens.add(settings.admin_token)
    return tokens


def require_admin(authorization: str = Header(...)):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="无效的认证头")
    token = authorization[7:]
    if token not in _valid_admin_tokens():
        raise HTTPException(status_code=401, detail="管理员凭证无效")
    return True


@router.post("/admin/login")
def admin_login(body: LoginIn):
    """管理员登录：校验用户名 + 密码，成功后返回 token（即密码本身）。"""
    if body.username != settings.admin_username or body.password != settings.admin_password:
        # 兼容旧 admin_token：用户名 admin + 旧 token 也可登录
        if not (body.username == settings.admin_username and
                settings.admin_token and body.password == settings.admin_token):
            raise HTTPException(status_code=401, detail="用户名或密码错误")
    return {"token": body.password, "username": body.username}


# ===== 主题管理 =====

class ThemeIn(BaseModel):
    code: str
    name: str
    description: str | None = None
    icon: str | None = None
    cover_url: str | None = None
    group_name: str | None = None
    sort_order: int = 0
    enabled: bool = True


@router.get("/admin/themes")
def list_themes(all: bool = Query(False), db: Session = Depends(get_db),
                _: bool = Depends(require_admin)):
    return admin_service.list_themes(db, include_disabled=all)


@router.post("/admin/themes")
def create_theme(req: ThemeIn, db: Session = Depends(get_db),
                 _: bool = Depends(require_admin)):
    if db.query(POITheme).filter(POITheme.code == req.code).first():
        raise HTTPException(status_code=400, detail="主题 code 已存在")
    t = POITheme(code=req.code, name=req.name, description=req.description,
                 icon=req.icon, cover_url=req.cover_url, group_name=req.group_name,
                 sort_order=req.sort_order, enabled=req.enabled)
    db.add(t)
    db.commit()
    db.refresh(t)
    return {"id": t.id, "code": t.code}


@router.put("/admin/themes/{code}")
def update_theme(code: str, req: ThemeIn, db: Session = Depends(get_db),
                 _: bool = Depends(require_admin)):
    t = db.query(POITheme).filter(POITheme.code == code).first()
    if not t:
        raise HTTPException(status_code=404, detail="主题不存在")
    t.name = req.name
    t.description = req.description
    t.icon = req.icon
    t.cover_url = req.cover_url
    t.group_name = req.group_name
    t.sort_order = req.sort_order
    t.enabled = req.enabled
    db.commit()
    return {"ok": True}


@router.delete("/admin/themes/{code}")
def delete_theme(code: str, db: Session = Depends(get_db),
                 _: bool = Depends(require_admin)):
    t = db.query(POITheme).filter(POITheme.code == code).first()
    if not t:
        raise HTTPException(status_code=404, detail="主题不存在")
    from ..models import POI
    if db.query(POI).filter(POI.category == code).count() > 0:
        raise HTTPException(status_code=400, detail="该主题下仍有 POI，无法删除")
    db.delete(t)
    db.commit()
    return {"ok": True}


# ===== POI 管理 =====

class POIIn(BaseModel):
    name: str
    category: str | None = None
    lng: float
    lat: float
    adcode: str | None = None
    address: str | None = None
    summary: str | None = None
    cover_url: str | None = None
    hint_text: str | None = None
    difficulty: int = 3
    source: str | None = "manual"
    shape_type: str = "point"
    radius_km: float = 0.0
    area_geojson: str | None = None
    contributor_nickname: str | None = None
    verify_status: str = "approved"


@router.get("/admin/pois")
def list_pois(
    category: str | None = None,
    adcode_prefix: str | None = None,
    difficulty: int | None = None,
    verify_status: str | None = None,
    shape_type: str | None = None,
    area_review: int | None = None,
    keyword: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: bool = Depends(require_admin),
):
    filters = {
        "category": category,
        "adcode_prefix": adcode_prefix,
        "difficulty": difficulty,
        "verify_status": verify_status,
        "shape_type": shape_type,
        "area_review": area_review,
        "keyword": keyword,
    }
    return admin_service.list_pois(db, filters, page, page_size)


@router.get("/admin/pois/{poi_id}")
def get_poi(poi_id: int, db: Session = Depends(get_db),
            _: bool = Depends(require_admin)):
    poi = admin_service.get_poi(db, poi_id)
    if not poi:
        raise HTTPException(status_code=404, detail="POI 不存在")
    return poi


@router.post("/admin/pois")
def create_poi(req: POIIn, db: Session = Depends(get_db),
               _: bool = Depends(require_admin)):
    return admin_service.create_poi(db, req.model_dump())


@router.put("/admin/pois/{poi_id}")
def update_poi(poi_id: int, req: POIIn, db: Session = Depends(get_db),
               _: bool = Depends(require_admin)):
    try:
        return admin_service.update_poi(db, poi_id, req.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/admin/pois/{poi_id}")
def delete_poi(poi_id: int, db: Session = Depends(get_db),
               _: bool = Depends(require_admin)):
    try:
        admin_service.delete_poi(db, poi_id)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/admin/pois/{poi_id}/confirm-area")
def confirm_poi_area(poi_id: int, db: Session = Depends(get_db),
                     _: bool = Depends(require_admin)):
    """手动核定：把待核定的区域/半径标记为已确认。"""
    try:
        return admin_service.confirm_poi_area(db, poi_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ===== 玩家会话统计 =====

class SessionIn(BaseModel):
    session_id: str
    nickname: str | None = None
    mode: str
    region_code: str | None = None
    category: str | None = None
    difficulty: str
    game_type: str
    target_poi_id: int | None = None


class SessionEndIn(BaseModel):
    won: bool = False
    score: int = 0
    duration_sec: int = 0


@router.post("/admin/session")
def report_session(req: SessionIn, request: Request, db: Session = Depends(get_db)):
    """前端上报开局会话（无需管理员认证）。"""
    ip = request.client.host if request.client else "0.0.0.0"
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
    ua = request.headers.get("user-agent")
    return admin_service.create_session(db, req.model_dump(), ip, ua)


@router.post("/admin/session/{session_id}/end")
def end_session(session_id: int, req: SessionEndIn, db: Session = Depends(get_db)):
    """前端上报对局结果（无需管理员认证）。"""
    try:
        return admin_service.end_session(db, session_id, req.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/admin/sessions")
def list_sessions(
    start: str | None = None,
    end: str | None = None,
    ip: str | None = None,
    ip_region: str | None = None,
    nickname: str | None = None,
    mode: str | None = None,
    difficulty: str | None = None,
    game_type: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: bool = Depends(require_admin),
):
    from datetime import datetime as _dt
    filters: dict = {}
    if start:
        try:
            filters["start"] = _dt.fromisoformat(start)
        except ValueError:
            pass
    if end:
        try:
            filters["end"] = _dt.fromisoformat(end)
        except ValueError:
            pass
    if ip:
        filters["ip"] = ip
    if ip_region:
        filters["ip_region"] = ip_region
    if nickname:
        filters["nickname"] = nickname
    if mode:
        filters["mode"] = mode
    if difficulty:
        filters["difficulty"] = difficulty
    if game_type:
        filters["game_type"] = game_type
    return admin_service.list_sessions(db, filters, page, page_size)


@router.get("/admin/overview")
def overview(db: Session = Depends(get_db), _: bool = Depends(require_admin)):
    return admin_service.overview(db)


# ===== UGC 投稿 =====

class ContributeIn(BaseModel):
    session_id: str
    nickname: str | None = None
    name: str
    province_code: str | None = None
    category: str | None = None
    lng: float
    lat: float
    description: str | None = None
    cover_url: str | None = None
    suggested_shape_type: str = "point"
    suggested_radius_km: float = 0.0
    suggested_area_geojson: str | None = None


@router.post("/contribute")
def contribute(req: ContributeIn, db: Session = Depends(get_db)):
    # 坐标必须在中国境内（粗略范围校验）
    if not (73 <= req.lng <= 135 and 18 <= req.lat <= 54):
        raise HTTPException(status_code=400, detail="坐标需在中国境内")
    try:
        return admin_service.create_submission(db, req.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/admin/submissions")
def list_submissions(
    status: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: bool = Depends(require_admin),
):
    return admin_service.list_submissions(db, status, page, page_size)


class ApproveIn(BaseModel):
    name: str | None = None
    category: str | None = None
    lng: float | None = None
    lat: float | None = None
    adcode: str | None = None
    address: str | None = None
    summary: str | None = None
    cover_url: str | None = None
    hint_text: str | None = None
    difficulty: int = 3
    shape_type: str | None = None
    radius_km: float | None = None
    area_geojson: str | None = None
    contributor_nickname: str | None = None


@router.post("/admin/submissions/{sub_id}/approve")
def approve_submission(sub_id: int, req: ApproveIn, db: Session = Depends(get_db),
                       _: bool = Depends(require_admin)):
    try:
        return admin_service.approve_submission(db, sub_id, req.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class RejectIn(BaseModel):
    note: str


@router.post("/admin/submissions/{sub_id}/reject")
def reject_submission(sub_id: int, req: RejectIn, db: Session = Depends(get_db),
                      _: bool = Depends(require_admin)):
    try:
        return admin_service.reject_submission(db, sub_id, req.note)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ===== 文件上传（封面图 → OSS 或本地） =====

@router.post("/upload")
async def upload(file: UploadFile = File(...)):
    # 前台 UGC 上传无需管理员认证；后台编辑封面也复用此接口
    if file.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(status_code=400, detail="仅支持 jpg/png/webp")
    data = await file.read()

    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[file.content_type]
    filename = f"{int(time.time())}_{uuid.uuid4().hex[:8]}.{ext}"

    # 优先 OSS
    if settings.oss_bucket_name and settings.oss_access_key_id:
        try:
            import oss2
            auth = oss2.Auth(settings.oss_access_key_id, settings.oss_access_key_secret)
            bucket = oss2.Bucket(auth, settings.oss_endpoint, settings.oss_bucket_name)
            key = f"{settings.oss_cover_prefix}/{filename}"
            bucket.put_object(key, data)
            url = f"https://{settings.oss_bucket_name}.{settings.oss_endpoint}/{key}"
            return {"url": url}
        except Exception as e:  # noqa: BLE001
            # OSS 配置了但上传失败，返回错误便于排查
            raise HTTPException(status_code=500, detail=f"OSS上传失败: {e}")

    # OSS 未配置，本地存储
    os.makedirs(_UGC_DIR, exist_ok=True)
    filepath = os.path.join(_UGC_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(data)
    return {"url": f"/static/ugc-covers/{filename}"}


# ===== 意见留言 =====


class FeedbackIn(BaseModel):
    content: str
    image_urls: list[str] = []
    contact: str = ""
    nickname: str = ""
    session_id: str = ""


@router.post("/feedback")
def submit_feedback(body: FeedbackIn, request: Request, db: Session = Depends(get_db)):
    """公开接口：提交意见留言"""
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="留言内容不能为空")
    ip = request.client.host if request.client else "unknown"
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
    fb = feedback_service.create(
        db, body.content.strip(), body.image_urls, body.contact, body.nickname, ip,
        body.session_id or None,
    )
    return {"id": fb.id, "message": "感谢您的留言！"}


@router.get("/feedback/mine")
def my_feedback(
    session_id: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """公开接口：本人历史反馈与官方回复（按设备标识匹配）"""
    return feedback_service.mine(db, session_id, page, size)


# ===== 开发计划 + 用户评价 =====


@router.get("/dev-plans")
def list_dev_plans(
    session_id: str = Query("", description="设备标识（用于返回本人评价态度）"),
    db: Session = Depends(get_db),
):
    """公开接口：开发计划列表（含点赞点踩计数 + 本人态度），填写即可见"""
    return {"items": dev_plan_service.list_public(db, session_id)}


@router.get("/dev-plans/{plan_id}/feedbacks")
def list_dev_plan_feedbacks(
    plan_id: int,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """公开接口：某计划下的评价列表（全员可见）"""
    return dev_plan_service.list_feedbacks(db, plan_id, page, size)


class DevPlanFeedbackIn(BaseModel):
    session_id: str
    attitude: str  # like/dislike
    comment: str = ""
    images: list[str] = []
    nickname: str = ""


class DevPlanWithdrawIn(BaseModel):
    session_id: str


@router.post("/dev-plans/{plan_id}/feedback")
def submit_dev_plan_feedback(plan_id: int, body: DevPlanFeedbackIn, db: Session = Depends(get_db)):
    """公开接口：提交/覆盖本人评价（无门槛，同设备一条；撤回后重新提交自动恢复）"""
    if not body.session_id.strip():
        raise HTTPException(status_code=400, detail="缺少设备标识")
    try:
        res = dev_plan_service.upsert_feedback(
            db, plan_id, body.session_id.strip(), body.attitude,
            body.comment, body.images, body.nickname,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return res


@router.post("/dev-plans/{plan_id}/feedback/withdraw")
def withdraw_dev_plan_feedback(plan_id: int, body: DevPlanWithdrawIn, db: Session = Depends(get_db)):
    """公开接口：撤回本人评价（用户端不可见，后台保留存档）"""
    if not body.session_id.strip():
        raise HTTPException(status_code=400, detail="缺少设备标识")
    try:
        return dev_plan_service.withdraw_feedback(db, plan_id, body.session_id.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class DevPlanIn(BaseModel):
    title: str
    content: str
    status: str = "planning"  # planning/done/abandoned
    sort_order: int = 0


@router.get("/admin/dev-plans", dependencies=[Depends(require_admin)])
def admin_list_dev_plans(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """后台：开发计划列表（含计数与评价总数）"""
    return dev_plan_service.list_admin(db, page, size)


@router.post("/admin/dev-plans", dependencies=[Depends(require_admin)])
def admin_create_dev_plan(body: DevPlanIn, db: Session = Depends(get_db)):
    """后台：新增开发计划（保存即用户可见）"""
    if not body.title.strip() or not body.content.strip():
        raise HTTPException(status_code=400, detail="标题和内容不能为空")
    try:
        return dev_plan_service.create_plan(db, body.title, body.content, body.status, body.sort_order)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/admin/dev-plans/{plan_id}", dependencies=[Depends(require_admin)])
def admin_update_dev_plan(plan_id: int, body: DevPlanIn, db: Session = Depends(get_db)):
    """后台：编辑开发计划"""
    if not body.title.strip() or not body.content.strip():
        raise HTTPException(status_code=400, detail="标题和内容不能为空")
    try:
        return dev_plan_service.update_plan(db, plan_id, body.title, body.content, body.status, body.sort_order)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/admin/dev-plans/{plan_id}", dependencies=[Depends(require_admin)])
def admin_delete_dev_plan(plan_id: int, db: Session = Depends(get_db)):
    """后台：删除开发计划（连同其评价）"""
    try:
        dev_plan_service.delete_plan(db, plan_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


@router.get("/admin/dev-plan-feedbacks", dependencies=[Depends(require_admin)])
def admin_list_dev_plan_feedbacks(
    plan_id: int = Query(..., ge=1),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """后台：评价列表（含已撤回存档）"""
    return dev_plan_service.admin_list_feedbacks(db, plan_id, page, size)


@router.delete("/admin/dev-plan-feedbacks/{feedback_id}", dependencies=[Depends(require_admin)])
def admin_delete_dev_plan_feedback(feedback_id: int, db: Session = Depends(get_db)):
    """后台：删除违规评价（物理删除）"""
    try:
        dev_plan_service.admin_delete_feedback(db, feedback_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


@router.get("/contribute/mine")
def my_submissions(
    session_id: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """公开接口：本人投稿 + 纠正记录（按设备标识匹配）"""
    q = (
        db.query(POISubmission)
        .filter(POISubmission.session_id == session_id)
        .order_by(POISubmission.submitted_at.desc())
    )
    total = q.count()
    items = q.offset((page - 1) * size).limit(size).all()

    cq = (
        db.query(POICorrection)
        .filter(POICorrection.session_id == session_id)
        .order_by(POICorrection.created_at.desc())
    )
    ctotal = cq.count()
    citems = cq.offset((page - 1) * size).limit(size).all()
    return {
        "total": total,
        "items": [
            {
                "id": s.id,
                "name": s.name,
                "category": s.category,
                "status": s.status,  # pending/approved/rejected
                "reviewer_note": s.reviewer_note,
                "submitted_at": s.submitted_at.strftime("%Y-%m-%d %H:%M:%S") if s.submitted_at else None,
            }
            for s in items
        ],
        "corrections_total": ctotal,
        "corrections": [
            {
                "id": c.id,
                "poi_id": c.poi_id,
                "name": c.name,  # 可能为 None（未纠正名称）
                "status": c.status,  # pending/adopted/rejected
                "reviewer_note": c.reviewer_note,
                "created_at": c.created_at.strftime("%Y-%m-%d %H:%M:%S") if c.created_at else None,
            }
            for c in citems
        ],
    }


class CorrectionIn(BaseModel):
    poi_id: int
    session_id: str
    nickname: str = ""
    name: str = ""
    category: str = ""
    lng: float | None = None
    lat: float | None = None
    description: str = ""
    cover_url: str = ""
    suggested_shape_type: str = ""
    suggested_radius_km: float | None = None
    suggested_area_geojson: str | None = None


@router.post("/correction")
def submit_correction(body: CorrectionIn, db: Session = Depends(get_db)):
    """公开接口：提交 POI 纠正（不直接修改 POI，审核采纳后写回）"""
    try:
        c = admin_service.create_correction(db, body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"id": c["id"], "message": "感谢纠正！审核采纳后生效。"}


@router.get("/poi/{poi_id}")
def get_poi_public(poi_id: int, db: Session = Depends(get_db)):
    """公开接口：POI 基本信息（纠正表单预填用）"""
    from ..models import POI
    poi = db.query(POI).filter(POI.id == poi_id).first()
    if not poi:
        raise HTTPException(status_code=404, detail="地点不存在")
    return {
        "id": poi.id,
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


@router.get("/admin/corrections", dependencies=[Depends(require_admin)])
def list_corrections(
    status: str = Query("", description="pending/adopted/rejected，空=全部"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """后台：纠正列表（附 POI 原值对照）"""
    return admin_service.list_corrections(db, status or None, page, size)


@router.post("/admin/corrections/{correction_id}/adopt", dependencies=[Depends(require_admin)])
def adopt_correction(correction_id: int, db: Session = Depends(get_db)):
    """后台：采纳纠正（快照写回 POI）"""
    try:
        c = admin_service.adopt_correction(db, correction_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return c


class CorrectionRejectIn(BaseModel):
    note: str = ""


@router.post("/admin/corrections/{correction_id}/reject", dependencies=[Depends(require_admin)])
def reject_correction(correction_id: int, body: CorrectionRejectIn, db: Session = Depends(get_db)):
    """后台：驳回纠正"""
    try:
        c = admin_service.reject_correction(db, correction_id, body.note)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return c


@router.get("/admin/feedback", dependencies=[Depends(require_admin)])
def list_feedback(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    search: str = Query(""),
    sort: str = Query("desc"),
    replied: str = Query("", description="yes=已回复 no=未回复 空=全部"),
    db: Session = Depends(get_db),
):
    """后台：留言列表（支持搜索+排序+回复状态筛选）"""
    return feedback_service.list(db, page, size, search, sort, replied)


class FeedbackReplyIn(BaseModel):
    reply: str


@router.post("/admin/feedback/{feedback_id}/reply", dependencies=[Depends(require_admin)])
def reply_feedback(feedback_id: int, body: FeedbackReplyIn, db: Session = Depends(get_db)):
    """后台：回复留言"""
    if not body.reply.strip():
        raise HTTPException(status_code=400, detail="回复内容不能为空")
    fb = feedback_service.reply(db, feedback_id, body.reply.strip(), "admin")
    if not fb:
        raise HTTPException(status_code=404, detail="留言不存在")
    return {"message": "回复成功", "replied_at": fb.replied_at.strftime("%Y-%m-%d %H:%M:%S")}


@router.delete("/admin/feedback/{feedback_id}", dependencies=[Depends(require_admin)])
def delete_feedback(feedback_id: int, db: Session = Depends(get_db)):
    """后台：删除留言"""
    if not feedback_service.delete(db, feedback_id):
        raise HTTPException(status_code=404, detail="留言不存在")
    return {"message": "已删除"}


# ===== 专题管理 =====

class CollectionIn(BaseModel):
    code: str
    name: str
    description: str | None = None
    icon: str | None = None
    cover_url: str | None = None
    geometry: str | None = None
    difficulty_star: int = 1
    unlock_require: int = 0
    audit_status: str = "pending"
    sort_order: int = 0
    enabled: bool = True


@router.get("/admin/collections")
def list_collections(
    keyword: str | None = None,
    star: int | None = None,
    audit_status: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort_by: str = Query("code"),
    sort_order: str = Query("asc"),
    db: Session = Depends(get_db),
    _: bool = Depends(require_admin),
):
    return admin_service.list_collections(
        db, keyword, star, audit_status, page, page_size, sort_by, sort_order,
    )


@router.post("/admin/collections")
def create_collection(req: CollectionIn, db: Session = Depends(get_db),
                      _: bool = Depends(require_admin)):
    try:
        return admin_service.create_collection(db, req.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/admin/collections/{coll_id}")
def update_collection(coll_id: int, req: CollectionIn, db: Session = Depends(get_db),
                      _: bool = Depends(require_admin)):
    try:
        return admin_service.update_collection(db, coll_id, req.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/admin/collections/{coll_id}")
def delete_collection(coll_id: int, db: Session = Depends(get_db),
                      _: bool = Depends(require_admin)):
    try:
        admin_service.delete_collection(db, coll_id)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


class CollectionPoisIn(BaseModel):
    poi_ids: list[int]


@router.get("/admin/collections/{coll_id}/pois")
def list_collection_pois(coll_id: int, db: Session = Depends(get_db),
                         _: bool = Depends(require_admin)):
    try:
        return admin_service.list_collection_pois(db, coll_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/admin/collections/{coll_id}/pois")
def set_collection_pois(coll_id: int, req: CollectionPoisIn, db: Session = Depends(get_db),
                        _: bool = Depends(require_admin)):
    try:
        return admin_service.set_collection_pois(db, coll_id, req.poi_ids)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ===== 用户管理 =====

class UserUpdateIn(BaseModel):
    is_admin: bool | None = None
    nickname: str | None = None
    total_medals: int | None = None


@router.get("/admin/users")
def list_users(
    keyword: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: bool = Depends(require_admin),
):
    return admin_service.list_users(db, keyword, page, page_size)


@router.put("/admin/users/{user_id}")
def update_user(user_id: int, req: UserUpdateIn, db: Session = Depends(get_db),
                _: bool = Depends(require_admin)):
    try:
        return admin_service.update_user(db, user_id, req.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/admin/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db),
                _: bool = Depends(require_admin)):
    try:
        admin_service.delete_user(db, user_id)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ===== 用户勋章详情 =====

@router.get("/admin/users/{user_id}/medals")
def get_user_medals(user_id: int, db: Session = Depends(get_db),
                    _: bool = Depends(require_admin)):
    return admin_service.get_user_medals(db, user_id)


# ===== 专题用时排行 =====

@router.get("/admin/collections/{coll_id}/leaderboard")
def get_collection_leaderboard(
    coll_id: int,
    difficulty: str = Query(...),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: bool = Depends(require_admin),
):
    return admin_service.get_collection_leaderboard(db, coll_id, difficulty, limit)


# ===== POI 用时排行 =====

@router.get("/admin/pois/{poi_id}/leaderboard")
def get_poi_leaderboard(
    poi_id: int,
    collection_id: int = Query(...),
    difficulty: str = Query(...),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: bool = Depends(require_admin),
):
    try:
        return admin_service.get_poi_leaderboard(db, poi_id, collection_id, difficulty, limit)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ===== 新闻时间线管理 =====

class NewsTimelineIn(BaseModel):
    code: str
    name: str
    description: str | None = None
    color: str | None = None
    cover_url: str | None = None
    medal_icon_url: str | None = None
    batch: str | None = None
    sort_order: int = 0
    audit_status: str = "pending"
    enabled: bool = True


class NewsPoiIn(BaseModel):
    timeline_id: int = 0  # 创建时必填
    name: str
    event_date: str | None = None
    event_text: str | None = None
    fact_text: str | None = None
    hint_text: str | None = None
    link_url: str | None = None
    link_source: str | None = None
    lng: float = 0
    lat: float = 0
    region: str | None = None
    difficulty: int = 3
    cover_url: str | None = None
    sort_order: int = 0
    verified: bool = False
    status: str = "pending"


@router.get("/admin/news/timelines")
def list_news_timelines(
    keyword: str | None = None,
    audit_status: str | None = None,
    db: Session = Depends(get_db),
    _: bool = Depends(require_admin),
):
    return {"items": admin_service.list_news_timelines(db, keyword, audit_status)}


@router.get("/admin/news/stats")
def news_stats(db: Session = Depends(get_db), _: bool = Depends(require_admin)):
    return admin_service.news_stats(db)


@router.post("/admin/news/timelines")
def create_news_timeline(req: NewsTimelineIn, db: Session = Depends(get_db),
                         _: bool = Depends(require_admin)):
    try:
        return admin_service.create_news_timeline(db, req.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/admin/news/timelines/{timeline_id}")
def update_news_timeline(timeline_id: int, req: NewsTimelineIn,
                         db: Session = Depends(get_db), _: bool = Depends(require_admin)):
    try:
        return admin_service.update_news_timeline(db, timeline_id, req.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/admin/news/timelines/{timeline_id}")
def delete_news_timeline(timeline_id: int, db: Session = Depends(get_db),
                         _: bool = Depends(require_admin)):
    try:
        admin_service.delete_news_timeline(db, timeline_id)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/admin/news/timelines/{timeline_id}/pois")
def list_news_pois(timeline_id: int, db: Session = Depends(get_db),
                   _: bool = Depends(require_admin)):
    return {"items": admin_service.list_news_pois(db, timeline_id)}


@router.post("/admin/news/pois")
def create_news_poi(req: NewsPoiIn, db: Session = Depends(get_db),
                    _: bool = Depends(require_admin)):
    try:
        return admin_service.create_news_poi(db, req.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/admin/news/pois/{poi_id}")
def update_news_poi(poi_id: int, req: NewsPoiIn, db: Session = Depends(get_db),
                    _: bool = Depends(require_admin)):
    try:
        return admin_service.update_news_poi(db, poi_id, req.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/admin/news/pois/{poi_id}")
def delete_news_poi(poi_id: int, db: Session = Depends(get_db),
                    _: bool = Depends(require_admin)):
    try:
        admin_service.delete_news_poi(db, poi_id)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ===== 新闻纠错反馈 =====

@router.get("/admin/news/corrections")
def list_news_corrections(
    status: str | None = None,
    db: Session = Depends(get_db),
    _: bool = Depends(require_admin),
):
    from ..services.news import news_service
    return {"items": news_service.list_corrections(db, status)}


class NewsCorrectionHandleIn(BaseModel):
    note: str | None = None


@router.post("/admin/news/corrections/{correction_id}/handle")
def handle_news_correction(correction_id: int, body: NewsCorrectionHandleIn,
                           db: Session = Depends(get_db),
                           _: bool = Depends(require_admin)):
    from ..services.news import news_service
    try:
        return news_service.handle_correction(db, correction_id, body.note)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
