# -*- coding: utf-8 -*-
"""认证服务：邮箱验证码登录 + 昵称沿用 + JWT。

说明：
- 验证码文件存储（TTL 5 分钟，多 worker 共享，路径 data/auth_codes.json）。
- 测试模式（settings.testing=True）验证码固定 123456，不发邮件，便于端到端测试。
- 昵称全局唯一、大小写敏感（哈哈A ≠ 哈哈a）；DB 列使用 utf8mb4_bin 排序规则。
"""
import json
import os
import random
import re
import smtplib
import string
import threading
import time
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import jwt
from loguru import logger
from sqlalchemy import desc
from sqlalchemy.orm import Session

from ..config import settings
from ..models import PlayerSession, User

# 验证码文件存储（多 worker 共享）：data/auth_codes.json
_CODE_TTL = 300  # 5 分钟
_BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_AUTH_CODE_FILE = os.path.join(_BASE_DIR, "data", "auth_codes.json")
_auth_code_lock = threading.Lock()


def _load_auth_codes() -> dict:
    try:
        with open(_AUTH_CODE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_auth_codes(codes: dict) -> None:
    os.makedirs(os.path.dirname(_AUTH_CODE_FILE), exist_ok=True)
    tmp = _AUTH_CODE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(codes, f)
    os.replace(tmp, _AUTH_CODE_FILE)


def _set_auth_code(email: str, code: str) -> None:
    with _auth_code_lock:
        codes = _load_auth_codes()
        now = time.time()
        # 顺手清理过期项，避免文件无限膨胀
        codes = {k: v for k, v in codes.items() if v.get("expire", 0) > now}
        codes[email] = {"code": code, "expire": now + _CODE_TTL}
        _save_auth_codes(codes)


def _get_auth_code(email: str) -> str | None:
    """读取验证码（不删除）。不存在或已过期返回 None。"""
    with _auth_code_lock:
        codes = _load_auth_codes()
        record = codes.get(email)
        if not record:
            return None
        if time.time() > record.get("expire", 0):
            return None
        return record.get("code")


def _delete_auth_code(email: str) -> None:
    with _auth_code_lock:
        codes = _load_auth_codes()
        codes.pop(email, None)
        _save_auth_codes(codes)

# 昵称校验：长度 2-16
NICKNAME_MIN = 2
NICKNAME_MAX = 16


def _gen_code() -> str:
    return "".join(random.choices(string.digits, k=6))


class AuthService:
    # ===== 验证码 =====

    def send_code(self, email: str) -> dict:
        email = email.strip().lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise ValueError("邮箱格式不正确")

        if settings.testing:
            code = "123456"
            logger.info(f"[AUTH] 测试模式验证码: {email} -> {code}")
            data: dict = {"testing": True, "code": code}
        else:
            code = _gen_code()
            send_res = self._smtp_send(email, code)
            if send_res != '':
                raise ValueError(f"邮件发送失败，请稍后重试,{send_res}")
            data = {}

        _set_auth_code(email, code)
        return data

    def _build_verification_email(self, to_email: str, code: str) -> MIMEMultipart:
        """构建验证码邮件（HTML 格式，参考织章主项目 email_service）"""
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"【地图寻踪】您的验证码：{code}"
        msg["From"] = settings.smtp_from or settings.smtp_user
        msg["To"] = to_email

        html = f"""\
        <div style="max-width:480px;margin:40px auto;font-family:'Segoe UI',Arial,sans-serif;">
          <div style="background:linear-gradient(135deg,#0ea5e9 0%,#6366f1 100%);
                      padding:32px;border-radius:12px 12px 0 0;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:28px;">地图寻踪</h1>
            <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px;">
              地图寻踪 · 邮箱验证码
            </p>
          </div>
          <div style="background:#fff;padding:32px;border:1px solid #e8e8e8;
                      border-top:none;border-radius:0 0 12px 12px;">
            <p style="color:#333;font-size:16px;margin:0 0 24px;">您好，</p>
            <p style="color:#333;font-size:16px;margin:0 0 24px;">
              您正在登录地图寻踪，验证码如下：
            </p>
            <div style="background:#f5f5f5;border-radius:8px;padding:20px;
                        text-align:center;margin:0 0 24px;">
              <span style="font-size:36px;font-weight:bold;letter-spacing:8px;
                           color:#0ea5e9;">{code}</span>
            </div>
            <p style="color:#999;font-size:13px;margin:0;">
              验证码 5 分钟内有效，请勿泄露给他人。
            </p>
          </div>
          <p style="text-align:center;color:#bbb;font-size:12px;margin:16px 0 0;">
            © 2026 地图寻踪 · 此邮件由系统自动发送，请勿直接回复
          </p>
        </div>
        """
        msg.attach(MIMEText(html, "html", "utf-8"))
        return msg

    def _smtp_send(self, to_email: str, code: str) -> str:
        """发送验证码邮件，成功返回 True；未配置或发送失败返回 False。"""
        if not settings.smtp_host or not settings.smtp_user or not settings.smtp_password:

            logger.warning(f"[AUTH] SMTP 未配置（smtp_host/smtp_user/smtp_password），无法发送邮件: {to_email} -> {code}")
            return 'SMTP 未配置（smtp_host/smtp_user/smtp_password'

        try:
            msg = self._build_verification_email(to_email, code)
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10) as s:
                s.login(settings.smtp_user, settings.smtp_password)
                s.sendmail(
                    settings.smtp_from or settings.smtp_user,
                    [to_email],
                    msg.as_string(),
                )
            return ''
        except Exception as e:
            logger.error(f"[AUTH] 邮件发送失败: {to_email} — {e}")
            return f"[AUTH][错误] 邮件发送失败: {to_email} — {e}"

    def _verify_code(self, email: str, code: str) -> bool:
        email = email.strip().lower()
        if settings.testing and code == "123456":
            return True
        stored = _get_auth_code(email)
        if stored is None:
            return False
        if stored != code:
            return False
        _delete_auth_code(email)  # 一次性：校验成功后删除
        return True

    # ===== 登录 / 注册 =====

    def login_with_code(
        self,
        db: Session,
        email: str,
        code: str,
        nickname: str | None = None,
        session_id: str | None = None,
    ) -> dict:
        email = email.strip().lower()
        if not self._verify_code(email, code):
            raise ValueError("验证码错误或已过期")

        user = db.query(User).filter(User.email == email).first()
        is_new = False
        if not user:
            # 新用户注册
            if not nickname:
                # 沿用最近 PK 昵称
                nickname = self._recent_nickname(db, session_id) or self._auto_nickname(db)
            self._validate_nickname(db, nickname)
            user = User(email=email, nickname=nickname, last_login_at=datetime.now())
            db.add(user)
            is_new = True
        else:
            user.last_login_at = datetime.now()

        db.commit()
        db.refresh(user)

        token = self._create_token(user.id)
        return {
            "token": token,
            "user": {
                "id": user.id,
                "email": user.email,
                "nickname": user.nickname,
                "total_medals": user.total_medals,
            },
            "is_new": is_new,
        }

    # ===== 昵称 =====

    def _recent_nickname(self, db: Session, session_id: str | None) -> str | None:
        """查最近 30 天该 session_id 的 player_sessions.nickname（取最新一条非空）"""
        if not session_id:
            return None
        since = datetime.now() - timedelta(days=30)
        row = (
            db.query(PlayerSession.nickname)
            .filter(
                PlayerSession.session_id == session_id,
                PlayerSession.nickname.isnot(None),
                PlayerSession.started_at >= since,
            )
            .order_by(desc(PlayerSession.started_at))
            .first()
        )
        return row[0] if row else None

    def _auto_nickname(self, db: Session) -> str:
        """自动生成未占用昵称"""
        from .nickname import nickname_service
        return nickname_service.recommend(db, 1)[0]

    def _validate_nickname(self, db: Session, nickname: str) -> None:
        nickname = nickname.strip()
        if not (NICKNAME_MIN <= len(nickname) <= NICKNAME_MAX):
            raise ValueError(f"昵称长度需为 {NICKNAME_MIN}-{NICKNAME_MAX} 个字符")
        if not check_nickname_unique(db, nickname):
            raise ValueError("昵称已被占用")

    def check_nickname(self, db: Session, nickname: str) -> bool:
        """校验昵称是否可用（长度 + 全局唯一，大小写敏感）"""
        nickname = nickname.strip()
        if not (NICKNAME_MIN <= len(nickname) <= NICKNAME_MAX):
            return False
        return check_nickname_unique(db, nickname)

    def suggest_nicknames(self, db: Session, base: str) -> list[str]:
        return generate_nickname_suggestions(db, base)

    def update_nickname(self, db: Session, user_id: int, nickname: str) -> dict:
        """修改当前用户昵称（长度 + 全局唯一，大小写敏感）"""
        nickname = nickname.strip()
        if not (NICKNAME_MIN <= len(nickname) <= NICKNAME_MAX):
            raise ValueError(f"昵称长度需为 {NICKNAME_MIN}-{NICKNAME_MAX} 个字符")
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise ValueError("用户不存在")
        # 昵称未变化时跳过唯一性校验（否则会命中自己）
        if user.nickname != nickname and not check_nickname_unique(db, nickname):
            raise ValueError("昵称已被占用")
        user.nickname = nickname
        db.commit()
        db.refresh(user)
        return {
            "id": user.id,
            "email": user.email,
            "nickname": user.nickname,
            "avatar_url": user.avatar_url,
            "total_medals": user.total_medals,
            "is_admin": user.is_admin,
        }

    # ===== JWT =====

    def verify_token(self, token: str) -> int | None:
        try:
            payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
            return payload.get("user_id")
        except jwt.PyJWTError:
            return None

    def get_user(self, db: Session, token: str) -> User | None:
        uid = self.verify_token(token)
        if not uid:
            return None
        return db.query(User).filter(User.id == uid).first()

    def _create_token(self, user_id: int) -> str:
        payload = {
            "user_id": user_id,
            "exp": datetime.utcnow() + timedelta(days=settings.jwt_expire_days),
        }
        return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")

    # ===== 旧 PK 昵称登录（保留兼容） =====

    def login_by_nickname(self, db: Session, nickname: str) -> dict:
        nickname = nickname.strip()
        if not nickname or len(nickname) > 20:
            raise ValueError("昵称需为 1~20 个字符")

        user = db.query(User).filter(User.nickname == nickname).first()
        if not user:
            user = User(nickname=nickname)
            db.add(user)
            db.commit()
            db.refresh(user)

        token = self._create_token(user.id)
        return {
            "token": token,
            "user": {"id": user.id, "nickname": user.nickname},
        }


# ===== 模块级工具函数（供测试直接调用） =====

def check_nickname_unique(db: Session, nickname: str) -> bool:
    """昵称是否全局唯一（大小写敏感）。同时校验长度。"""
    nickname = nickname.strip() if isinstance(nickname, str) else nickname
    if not nickname or not (NICKNAME_MIN <= len(nickname) <= NICKNAME_MAX):
        return False
    exists = db.query(User.id).filter(User.nickname == nickname).first()
    return exists is None


def generate_nickname_suggestions(db: Session, base: str) -> list[str]:
    """昵称冲突时生成 3-5 个推荐昵称（基于 base + 后缀，校验未占用）"""
    base = (base or "旅行者").strip()
    suffixes = [
        "2026", "_旅行者", "_探索者", "玩家", "号",
        "_领航员", "_达人", "同学", "队长", "君",
    ]
    suggestions: list[str] = []
    seen = set()
    for suf in suffixes:
        cand = f"{base}{suf}"
        if len(cand) > NICKNAME_MAX:
            cand = cand[:NICKNAME_MAX]
        if cand in seen or cand == base:
            continue
        seen.add(cand)
        if check_nickname_unique(db, cand):
            suggestions.append(cand)
        if len(suggestions) >= 5:
            break

    # 不足则随机数字后缀兜底
    while len(suggestions) < 3:
        cand = f"{base}{random.randint(1000, 9999)}"
        if cand in seen:
            continue
        seen.add(cand)
        if check_nickname_unique(db, cand):
            suggestions.append(cand)

    return suggestions


auth_service = AuthService()
