"""从前端 provinceOutlines.ts 生成后端省份轮廓 JSON（供 bbox_lookup 多边形精确判定）。

输出：app/data/province_outlines.json
{ "110000": {"name": "北京市", "ring": [[lng, lat], ...]}, ... }
"""
import json
import re
from pathlib import Path

TS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "data" / "provinceOutlines.ts"
OUT = Path(__file__).resolve().parents[1] / "app" / "data" / "province_outlines.json"


def parse_path(path_d: str) -> list[list[tuple[float, float]]]:
    """解析 SVG path（M/L/Z 段）为多个环 [[(lng,lat),...], ...]，取最长环（主轮廓）。"""
    rings: list[list[tuple[float, float]]] = []
    cur: list[tuple[float, float]] = []
    for cmd, coords in re.findall(r"([MLZ])([0-9.,]*)", path_d):
        if cmd == "M":
            if len(cur) > 2:
                rings.append(cur)
            cur = []
            if coords:
                x, y = coords.split(",")[:2]
                cur.append((float(x), float(y)))
        elif cmd == "L" and coords:
            for pair in coords.rstrip(",").split(","):
                pass
            # L 后坐标形如 x,yLx,yLx,y —— 上面正则把坐标切开了，重新解析：
            cur = cur
    # 更稳妥的直接 token 解析
    rings, cur = [], []
    tokens = re.findall(r"([MLZ])|([0-9]+(?:\.[0-9]+)?),([0-9]+(?:\.[0-9]+)?)", path_d)
    for cmd, x, y in tokens:
        if cmd == "M":
            if len(cur) > 2:
                rings.append(cur)
            cur = []
        elif cmd == "Z":
            continue
        elif x and y:
            cur.append((float(x), float(y)))
    if len(cur) > 2:
        rings.append(cur)
    return max(rings, key=len) if rings else []


def main() -> None:
    text = TS.read_text(encoding="utf-8")
    block_re = re.compile(r'"(\d{6})":\s*\{', re.S)
    matches = list(block_re.finditer(text))
    out: dict[str, dict] = {}
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        block = text[start:end]

        def field(name: str) -> str:
            fm = re.search(rf'"{name}":\s*"([^"]*)"', block)
            return fm.group(1) if fm else ""

        ring = parse_path(field("path"))
        if ring:
            out[m.group(1)] = {"name": field("name"), "ring": ring}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"生成 {OUT}：{len(out)} 个省份，共 {sum(len(v['ring']) for v in out.values())} 个顶点")


if __name__ == "__main__":
    main()
