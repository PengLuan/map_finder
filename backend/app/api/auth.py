from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.auth import auth_service
from ..services.nickname import nickname_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


# 依赖：从 Bearer token 解析当前用户（可选，未登录返回 None）
def get_current_user(authorization: str | None = Header(default=None),
                     db: Session = Depends(get_db)):
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:]
    return auth_service.get_user(db, token)


class LoginRequest(BaseModel):
    nickname: str


class LoginResponse(BaseModel):
    token: str
    user: dict


@router.post("/nickname", response_model=LoginResponse)
def login_nickname(req: LoginRequest, db: Session = Depends(get_db)):
    try:
        result = auth_service.login_by_nickname(db, req.nickname)
        return LoginResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/recommend")
def recommend_nicknames(count: int = Query(8, ge=1, le=50), db: Session = Depends(get_db)):
    return {"nicknames": nickname_service.recommend(db, count)}


# ===== 邮箱验证码登录 =====

class SendCodeRequest(BaseModel):
    email: str


class LoginCodeRequest(BaseModel):
    email: str
    code: str
    nickname: str | None = None  # 新用户注册时的昵称，可省略（自动沿用/生成）
    session_id: str | None = None  # 用于查最近昵称、合并匿名进度


class CheckNicknameRequest(BaseModel):
    nickname: str
    base: str | None = None  # 冲突时基于此生成推荐


class UpdateNicknameRequest(BaseModel):
    nickname: str


@router.post("/send_code")
def send_code(req: SendCodeRequest):
    try:
        result = auth_service.send_code(req.email)
        return {"ok": True, "message": "验证码已发送", **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/login")
def login_with_code(req: LoginCodeRequest, db: Session = Depends(get_db)):
    try:
        result = auth_service.login_with_code(
            db, req.email, req.code, req.nickname, req.session_id,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))


@router.post("/check_nickname")
def check_nickname(req: CheckNicknameRequest, db: Session = Depends(get_db)):
    """校验昵称是否可用；不可用时返回推荐列表"""
    ok = auth_service.check_nickname(db, req.nickname)
    data: dict = {"available": ok}
    if not ok:
        base = req.base or req.nickname
        data["suggestions"] = auth_service.suggest_nicknames(db, base)
    return data


@router.post("/update_nickname")
def update_nickname(
    req: UpdateNicknameRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """修改当前登录用户昵称（需 Bearer token）"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="无效的认证头")
    token = authorization[7:]
    user = auth_service.get_user(db, token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已失效")
    try:
        return auth_service.update_nickname(db, user.id, req.nickname)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/me")
def get_me(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="无效的认证头")
    token = authorization[7:]
    user = auth_service.get_user(db, token)
    if not user:
        raise HTTPException(status_code=401, detail="登录已失效")
    return {
        "id": user.id,
        "email": user.email,
        "nickname": user.nickname,
        "avatar_url": user.avatar_url,
        "slogan": user.slogan,
        "profile_public": user.profile_public,
        "total_medals": user.total_medals,
        "is_admin": user.is_admin,
    }


# ===== 用户公开主页（第四期）=====

class UpdateProfileRequest(BaseModel):
    slogan: str | None = None
    profile_public: bool | None = None


@router.get("/user/{user_id}/profile")
def get_user_profile(
    user_id: int,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    """公开接口：他人主页基本信息。隐私关闭时仅本人可见完整信息。"""
    from ..models import User
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    is_self = bool(current and current.id == target.id)
    if not target.profile_public and not is_self:
        return {"hidden": True}
    return {
        "hidden": False,
        "id": target.id,
        "nickname": target.nickname,
        "avatar_url": target.avatar_url,
        "slogan": target.slogan,
        "total_medals": target.total_medals,
        "created_at": target.created_at.strftime("%Y-%m-%d") if target.created_at else None,
        "profile_public": target.profile_public,
        "is_self": is_self,
    }


@router.put("/user/profile")
def update_my_profile(
    req: UpdateProfileRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """本人设置：slogan + 公开主页开关（需登录）"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="无效的认证头")
    user = auth_service.get_user(db, authorization[7:])
    if not user:
        raise HTTPException(status_code=401, detail="登录已失效")
    if req.slogan is not None:
        user.slogan = req.slogan.strip()[:100] or None
    if req.profile_public is not None:
        user.profile_public = req.profile_public
    db.commit()
    db.refresh(user)
    return {
        "id": user.id,
        "nickname": user.nickname,
        "slogan": user.slogan,
        "profile_public": user.profile_public,
    }

