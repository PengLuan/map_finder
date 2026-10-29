"""开发计划 + 用户评价（第三期）

计划：后台填写即用户可见，三态 planning/done/abandoned。
评价：👍/👎 + 文字 + 图（全员可见），同设备覆盖式一条；
    用户可撤回（软撤回置 withdrawn_at，用户端不可见、后台存档，重新评价自动恢复）；
    后台可物理删除违规评价。
"""
from __future__ import annotations

import json

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import DevPlan, DevPlanFeedback

PLAN_STATUSES = ("planning", "done", "abandoned")


def _plan_dict(p: DevPlan, like_count: int = 0, dislike_count: int = 0,
               my_attitude: str | None = None, feedback_total: int | None = None) -> dict:
    d = {
        "id": p.id,
        "title": p.title,
        "content": p.content,
        "status": p.status,
        "sort_order": p.sort_order,
        "created_at": p.created_at.strftime("%Y-%m-%d %H:%M") if p.created_at else None,
        "like_count": like_count,
        "dislike_count": dislike_count,
        "my_attitude": my_attitude,
    }
    if feedback_total is not None:
        d["feedback_total"] = feedback_total
    return d


def _fb_dict(f: DevPlanFeedback, include_withdrawn: bool = False) -> dict:
    try:
        images = json.loads(f.images) if f.images else []
    except (ValueError, TypeError):
        images = []
    d = {
        "id": f.id,
        "plan_id": f.plan_id,
        "nickname": f.nickname,
        "attitude": f.attitude,
        "comment": f.comment,
        "images": images,
        "created_at": f.created_at.strftime("%Y-%m-%d %H:%M") if f.created_at else None,
    }
    if include_withdrawn:
        d["withdrawn"] = f.withdrawn_at is not None
        d["withdrawn_at"] = f.withdrawn_at.strftime("%Y-%m-%d %H:%M") if f.withdrawn_at else None
    return d


def _attitude_counts(db: Session) -> dict[int, dict[str, int]]:
    rows = (
        db.query(
            DevPlanFeedback.plan_id,
            DevPlanFeedback.attitude,
            func.count(DevPlanFeedback.id),
        )
        .filter(DevPlanFeedback.withdrawn_at.is_(None))  # 已撤回不计入
        .group_by(DevPlanFeedback.plan_id, DevPlanFeedback.attitude)
        .all()
    )
    counts: dict[int, dict[str, int]] = {}
    for plan_id, attitude, cnt in rows:
        counts.setdefault(plan_id, {"like": 0, "dislike": 0})[attitude] = cnt
    return counts


def list_public(db: Session, session_id: str) -> list[dict]:
    """公开：计划列表（含计数 + 本人态度 + 评价总数）"""
    plans = (
        db.query(DevPlan)
        .order_by(DevPlan.sort_order.desc(), DevPlan.created_at.desc())
        .all()
    )
    counts = _attitude_counts(db)
    totals = dict(
        db.query(DevPlanFeedback.plan_id, func.count(DevPlanFeedback.id))
        .filter(DevPlanFeedback.withdrawn_at.is_(None))
        .group_by(DevPlanFeedback.plan_id)
        .all()
    )
    mine: dict[int, str] = {}
    if session_id:
        rows = (
            db.query(DevPlanFeedback.plan_id, DevPlanFeedback.attitude)
            .filter(
                DevPlanFeedback.session_id == session_id,
                DevPlanFeedback.withdrawn_at.is_(None),
            )
            .all()
        )
        mine = {pid: att for pid, att in rows}
    return [
        _plan_dict(
            p,
            counts.get(p.id, {}).get("like", 0),
            counts.get(p.id, {}).get("dislike", 0),
            mine.get(p.id),
            totals.get(p.id, 0),
        )
        for p in plans
    ]


def list_admin(db: Session, page: int, page_size: int) -> dict:
    """后台：计划列表（含计数与评价总数）"""
    q = db.query(DevPlan)
    total = q.count()
    rows = (
        q.order_by(DevPlan.sort_order.desc(), DevPlan.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    counts = _attitude_counts(db)
    items = []
    for p in rows:
        c = counts.get(p.id, {})
        fb_total = db.query(DevPlanFeedback).filter(DevPlanFeedback.plan_id == p.id).count()
        d = _plan_dict(p, c.get("like", 0), c.get("dislike", 0))
        d["feedback_total"] = fb_total
        items.append(d)
    return {"total": total, "page": page, "page_size": page_size, "items": items}


def create_plan(db: Session, title: str, content: str, status: str, sort_order: int) -> dict:
    if status not in PLAN_STATUSES:
        raise ValueError("无效的计划状态")
    p = DevPlan(title=title.strip(), content=content.strip(), status=status, sort_order=sort_order)
    db.add(p)
    db.commit()
    db.refresh(p)
    return _plan_dict(p)


def update_plan(db: Session, plan_id: int, title: str, content: str, status: str, sort_order: int) -> dict:
    p = db.query(DevPlan).filter(DevPlan.id == plan_id).first()
    if not p:
        raise ValueError("计划不存在")
    if status not in PLAN_STATUSES:
        raise ValueError("无效的计划状态")
    p.title = title.strip()
    p.content = content.strip()
    p.status = status
    p.sort_order = sort_order
    db.commit()
    db.refresh(p)
    return _plan_dict(p)


def delete_plan(db: Session, plan_id: int) -> None:
    p = db.query(DevPlan).filter(DevPlan.id == plan_id).first()
    if not p:
        raise ValueError("计划不存在")
    db.query(DevPlanFeedback).filter(DevPlanFeedback.plan_id == plan_id).delete()
    db.delete(p)
    db.commit()


def list_feedbacks(db: Session, plan_id: int, page: int, page_size: int) -> dict:
    """公开：某计划下的评价列表（全员可见，时间倒序，不含已撤回）"""
    q = db.query(DevPlanFeedback).filter(
        DevPlanFeedback.plan_id == plan_id,
        DevPlanFeedback.withdrawn_at.is_(None),
    )
    total = q.count()
    rows = (
        q.order_by(DevPlanFeedback.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_fb_dict(f) for f in rows],
    }


def upsert_feedback(
    db: Session, plan_id: int, session_id: str, attitude: str,
    comment: str, images: list[str], nickname: str,
) -> dict:
    """公开：提交/覆盖本人评价（无门槛，同设备一条）"""
    if attitude not in ("like", "dislike"):
        raise ValueError("无效的评价态度")
    if not db.query(DevPlan).filter(DevPlan.id == plan_id).first():
        raise ValueError("计划不存在")
    comment = (comment or "").strip()[:256] or None
    nickname = (nickname or "").strip()[:50] or None
    images_json = json.dumps(images[:3], ensure_ascii=False) if images else None

    fb = (
        db.query(DevPlanFeedback)
        .filter(DevPlanFeedback.plan_id == plan_id, DevPlanFeedback.session_id == session_id)
        .first()
    )
    if fb:
        fb.attitude = attitude
        fb.comment = comment
        fb.images = images_json
        fb.withdrawn_at = None  # 撤回后重新评价自动恢复
        if nickname:
            fb.nickname = nickname
    else:
        fb = DevPlanFeedback(
            plan_id=plan_id,
            session_id=session_id,
            nickname=nickname,
            attitude=attitude,
            comment=comment,
            images=images_json,
        )
        db.add(fb)
    db.commit()
    db.refresh(fb)

    base = db.query(DevPlanFeedback).filter(
        DevPlanFeedback.plan_id == plan_id,
        DevPlanFeedback.withdrawn_at.is_(None),
    )
    like = base.filter(DevPlanFeedback.attitude == "like").count()
    dislike = base.filter(DevPlanFeedback.attitude == "dislike").count()
    return {"feedback": _fb_dict(fb), "like_count": like, "dislike_count": dislike}


def withdraw_feedback(db: Session, plan_id: int, session_id: str) -> dict:
    """公开：撤回本人评价（软撤回，用户端不可见，后台存档）"""
    fb = (
        db.query(DevPlanFeedback)
        .filter(
            DevPlanFeedback.plan_id == plan_id,
            DevPlanFeedback.session_id == session_id,
            DevPlanFeedback.withdrawn_at.is_(None),
        )
        .first()
    )
    if not fb:
        raise ValueError("未找到可撤回的评价")
    fb.withdrawn_at = func.now()
    db.commit()

    base = db.query(DevPlanFeedback).filter(
        DevPlanFeedback.plan_id == plan_id,
        DevPlanFeedback.withdrawn_at.is_(None),
    )
    like = base.filter(DevPlanFeedback.attitude == "like").count()
    dislike = base.filter(DevPlanFeedback.attitude == "dislike").count()
    return {"ok": True, "like_count": like, "dislike_count": dislike}


def admin_list_feedbacks(db: Session, plan_id: int, page: int, page_size: int) -> dict:
    """后台：评价列表（含已撤回存档，时间倒序）"""
    q = db.query(DevPlanFeedback).filter(DevPlanFeedback.plan_id == plan_id)
    total = q.count()
    rows = (
        q.order_by(DevPlanFeedback.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_fb_dict(f, include_withdrawn=True) for f in rows],
    }


def admin_delete_feedback(db: Session, feedback_id: int) -> None:
    """后台：删除违规评价（物理删除）"""
    fb = db.query(DevPlanFeedback).filter(DevPlanFeedback.id == feedback_id).first()
    if not fb:
        raise ValueError("评价不存在")
    db.delete(fb)
    db.commit()
