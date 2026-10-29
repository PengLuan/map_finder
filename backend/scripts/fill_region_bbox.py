"""回填 regions 表省份 bbox（修复 bug1：省份提示错误）。

问题：regions 表 bbox_* 字段全为 NULL，bbox_lookup 回退到"最近省会"匹配，
省界附近大量误判（如苏州→上海市、酒泉→青海省）。

数据源：前端 src/data/provinceOutlines.ts（阿里 DataV GeoJSON 简化轮廓，
已含每省 minLng/maxLng/minLat/maxLat），按 adcode 前 2 位与 regions.code 匹配。

用法：python scripts/fill_region_bbox.py [--dry-run]
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

OUTLINES_TS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "data" / "provinceOutlines.ts"


def load_outline_bboxes() -> dict[str, tuple[float, float, float, float]]:
    """从 provinceOutlines.ts 解析 {adcode6: (minLng, maxLng, minLat, maxLat)}。"""
    text = OUTLINES_TS.read_text(encoding="utf-8")
    result: dict[str, tuple[float, float, float, float]] = {}
    # 逐个块匹配："110000": { ... "minLng": ..., "maxLng": ..., "minLat": ..., "maxLat": ... }
    block_re = re.compile(r'"(\d{6})":\s*\{', re.S)
    matches = list(block_re.finditer(text))
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        block = text[start:end]

        def field(name: str) -> float:
            fm = re.search(rf'"{name}":\s*([\d.]+)', block)
            return float(fm.group(1)) if fm else float("nan")

        result[m.group(1)] = (field("minLng"), field("maxLng"), field("minLat"), field("maxLat"))
    return result


def main() -> None:
    dry_run = "--dry-run" in sys.argv
    bboxes = load_outline_bboxes()
    print(f"从 provinceOutlines.ts 解析到 {len(bboxes)} 个省级 bbox")

    from sqlalchemy import create_engine, text
    from app.config import settings

    engine = create_engine(settings.mysql_url)
    updated, missing = 0, []
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT code, name FROM regions WHERE level = 1")
        ).fetchall()
        for code, name in rows:
            key = code[:6]
            if key not in bboxes:
                missing.append(f"{name}({code})")
                continue
            w, e, s, n = bboxes[key]
            # RDP 简化轮廓略微内缩，外扩 0.05° 容差避免边界点漏判
            w, e, s, n = w - 0.05, e + 0.05, s - 0.05, n + 0.05
            if not dry_run:
                conn.execute(
                    text(
                        "UPDATE regions SET bbox_w = :w, bbox_e = :e, "
                        "bbox_s = :s, bbox_n = :n WHERE code = :code"
                    ),
                    {"w": w, "e": e, "s": s, "n": n, "code": code},
                )
            updated += 1
    print(f"{'[dry-run] ' if dry_run else ''}已更新 {updated} 个省份 bbox")
    if missing:
        print("未匹配到的省份:", ", ".join(missing))

    # 同步更新 dump 文件（生产导入用）
    if not dry_run and Path("map_game_dump.sql").exists():
        print("提示：map_game_dump.sql 未自动同步，生产库请重新执行本脚本")


if __name__ == "__main__":
    main()
