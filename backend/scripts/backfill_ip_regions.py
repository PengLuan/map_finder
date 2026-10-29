# -*- coding: utf-8 -*-
"""回填 player_sessions.ip_region：用多源免费接口查询所有历史 IP 的归属地。

数据源 fallback：ip-api.com → pconline(IP138) → 百度 → 高德(如配 key)

缓存策略：
- 复用 app/services/ip_region.py 的 JSON 文件缓存（data/ip_region_cache.json）
- 已缓存且非空（查询成功）的 IP 直接取缓存值，不重复请求 API
- 未缓存或之前缓存为空串（查询失败）的 IP 重新查询
- 内网/本机 IP 跳过

用法：
    cd /www/wwwroot/zhizhang/map/backend
    python scripts/backfill_ip_regions.py [--batch-id <id>] [--dry-run]

    --dry-run：只查询不写库，用于预检
    --batch-id：可选，仅日志标记

执行后所有 ip_region 为空的会话会被回填。
"""
import argparse
import os
import sys
import time

# 让脚本能 import app 包
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func as sa_func

from app.database import SessionLocal
from app.models import PlayerSession
from app.services.ip_region import (
    _load_cache,
    _query_region,
    _persist_cache,
    _CACHE_FILE,
)


def _is_skip_ip(ip: str) -> bool:
    """内网/本机 IP 跳过（与 ip_region.get_ip_region 判断一致）。"""
    if not ip or ip in ("0.0.0.0", "127.0.0.1", "unknown", "localhost"):
        return True
    if ip.startswith(("10.", "172.16.", "192.168.", "169.254.")):
        return True
    return False


def main():
    parser = argparse.ArgumentParser(description="回填 player_sessions.ip_region")
    parser.add_argument("--batch-id", default=None, help="批次ID（仅日志标记，不存储）")
    parser.add_argument("--dry-run", action="store_true", help="只查询不写库")
    args = parser.parse_args()

    batch_tag = f"[batch={args.batch_id}] " if args.batch_id else ""
    print(f"{batch_tag}缓存文件: {_CACHE_FILE}")

    db = SessionLocal()
    try:
        # 查所有 ip_region 为空的会话的 IP（去重）
        rows = (
            db.query(PlayerSession.ip, sa_func.count(PlayerSession.id))
            .filter(
                (PlayerSession.ip_region.is_(None))
                | (PlayerSession.ip_region == "")
            )
            .group_by(PlayerSession.ip)
            .all()
        )
        all_ips = [ip for ip, _cnt in rows if ip and not _is_skip_ip(ip)]
        print(f"{batch_tag}待回填的去重 IP 数: {len(all_ips)}")

        if not all_ips:
            print(f"{batch_tag}无待回填 IP，退出")
            return

        # 复用缓存：先加载，已缓存且非空的直接用，空串视为未缓存需重查
        cache = _load_cache()
        need_query = [ip for ip in all_ips if not cache.get(ip)]
        print(f"{batch_tag}命中缓存: {len(all_ips) - len(need_query)}，需查询 API: {len(need_query)}")

        # 逐个查询未缓存的 IP（多源 fallback）
        regions: dict[str, str | None] = {}
        api_ok = 0
        api_fail = 0
        for i, ip in enumerate(need_query, 1):
            region = _query_region(ip)
            # 写入缓存（None 存空串，下次可重查）
            cache[ip] = region or ""
            regions[ip] = region
            if region:
                api_ok += 1
            else:
                api_fail += 1
            # 每 10 个落盘一次缓存，避免中断丢失
            if i % 10 == 0:
                _persist_cache()
                print(f"{batch_tag}进度: {i}/{len(need_query)}（命中 {api_ok}，未命中 {api_fail}）")
            # 简单限速：每个请求间隔 300ms，避免触发各接口 QPS 限制
            time.sleep(0.3)

        # 落盘剩余缓存
        _persist_cache()
        print(f"{batch_tag}API 查询完成：命中 {api_ok}，未命中 {api_fail}")

        if args.dry_run:
            print(f"{batch_tag}--dry-run 模式，不写库。预览前 20 条：")
            for ip in all_ips[:20]:
                r = regions.get(ip) or cache.get(ip) or None
                print(f"  {ip} -> {r}")
            return

        # 批量更新：对每个 IP 更新所有 ip_region 为空的会话
        updated_rows = 0
        for ip in all_ips:
            # 优先用本次查询结果，回退缓存（已成功缓存的）
            region = regions.get(ip)
            if region is None and ip in cache:
                region = cache[ip] or None
            if not region:
                continue  # 没查到，跳过不写空值
            # 更新该 IP 下所有 ip_region 为空的会话
            cnt = (
                db.query(PlayerSession)
                .filter(
                    PlayerSession.ip == ip,
                    (PlayerSession.ip_region.is_(None))
                    | (PlayerSession.ip_region == ""),
                )
                .update({PlayerSession.ip_region: region}, synchronize_session=False)
            )
            updated_rows += cnt
        db.commit()
        print(f"{batch_tag}回填完成：更新 {updated_rows} 条会话记录")
    finally:
        db.close()


if __name__ == "__main__":
    main()

