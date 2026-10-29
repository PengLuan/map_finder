"""意见留言服务"""
import json
from datetime import datetime

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models import Feedback


class FeedbackService:
    def create(
        self,
        db: Session,
        content: str,
        image_urls: list[str] | None,
        contact: str | None,
        nickname: str | None,
        ip: str,
        session_id: str | None = None,
    ) -> Feedback:
        fb = Feedback(
            content=content,
            image_urls=json.dumps(image_urls, ensure_ascii=False) if image_urls else None,
            contact=contact or None,
            nickname=nickname or None,
            ip=ip,
            session_id=session_id or None,
        )
        db.add(fb)
        db.commit()
        db.refresh(fb)
        return fb

    def reply(self, db: Session, feedback_id: int, reply: str, replied_by: str) -> Feedback | None:
        """后台回复留言"""
        fb = db.query(Feedback).filter(Feedback.id == feedback_id).first()
        if not fb:
            return None
        fb.admin_reply = reply
        fb.replied_at = datetime.now()
        fb.replied_by = replied_by
        db.commit()
        db.refresh(fb)
        return fb

    def mine(self, db: Session, session_id: str, page: int = 1, size: int = 50) -> dict:
        """用户端：本人历史反馈与回复"""
        q = (
            db.query(Feedback)
            .filter(Feedback.session_id == session_id)
            .order_by(Feedback.created_at.desc())
        )
        total = q.count()
        items = q.offset((page - 1) * size).limit(size).all()
        return {"total": total, "items": [self._to_dict(f) for f in items]}

    def list(
        self,
        db: Session,
        page: int = 1,
        size: int = 20,
        search: str = "",
        sort: str = "desc",
        replied: str = "",
    ) -> dict:
        q = db.query(Feedback)
        if replied == "yes":
            q = q.filter(Feedback.admin_reply.isnot(None))
        elif replied == "no":
            q = q.filter(Feedback.admin_reply.is_(None))
        if search.strip():
            kw = f"%{search.strip()}%"
            q = q.filter(
                or_(
                    Feedback.content.like(kw),
                    Feedback.nickname.like(kw),
                    Feedback.contact.like(kw),
                    Feedback.ip.like(kw),
                )
            )
        order_col = Feedback.created_at.asc() if sort == "asc" else Feedback.created_at.desc()
        q = q.order_by(order_col)
        total = q.count()
        items = q.offset((page - 1) * size).limit(size).all()
        return {"total": total, "items": [self._to_dict(f) for f in items]}

    def delete(self, db: Session, feedback_id: int) -> bool:
        fb = db.query(Feedback).filter(Feedback.id == feedback_id).first()
        if not fb:
            return False
        db.delete(fb)
        db.commit()
        return True

    def _to_dict(self, fb: Feedback) -> dict:
        return {
            "id": fb.id,
            "content": fb.content,
            "image_urls": json.loads(fb.image_urls) if fb.image_urls else [],
            "contact": fb.contact,
            "nickname": fb.nickname,
            "ip": fb.ip,
            "admin_reply": fb.admin_reply,
            "replied_at": fb.replied_at.strftime("%Y-%m-%d %H:%M:%S") if fb.replied_at else None,
            "created_at": fb.created_at.strftime("%Y-%m-%d %H:%M:%S") if fb.created_at else None,
        }


feedback_service = FeedbackService()
