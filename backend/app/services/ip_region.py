# -*- coding: utf-8 -*-
"""IP 归属地查询服务：多源免费接口 fallback + 本地 JSON 文件缓存。

数据源（按顺序 fallback，均无需 key）：
1. ip-api.com     国际免费接口，支持中文，HTTP 限速 45/min
2. pconline        国内 IP138，GBK 编码 JSON，稳定
3. opendata.baidu.com 百度开放数据，JSON

缓存文件位于 data/ip_region_cache.json，结构 {ip: region_text}。
同一 IP 只查询一次 API，后续直接走缓存。
"""
import json
import os
import threading
import urllib.parse
import urllib.request
from typing import Optional

from ..config import settings

# 缓存文件路径（与脚本共用，保证服务端写入与脚本回填共用同一份缓存）
_CACHE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data",
)
_CACHE_FILE = os.path.join(_CACHE_DIR, "ip_region_cache.json")

# 内存缓存（进程内），避免高频读取磁盘文件
_MEM_CACHE: dict[str, str] = {}
_MEM_LOADED = False
_LOCK = threading.Lock()


def _load_cache() -> dict[str, str]:
    """加载磁盘缓存到内存（懒加载，线程安全）。"""
    global _MEM_LOADED
    with _LOCK:
        if _MEM_LOADED:
            return _MEM_CACHE
        _MEM_LOADED = True
        try:
            if os.path.exists(_CACHE_FILE):
                with open(_CACHE_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        _MEM_CACHE.update(data)
        except (json.JSONDecodeError, OSError):
            pass
        return _MEM_CACHE


def _persist_cache() -> None:
    """将内存缓存落盘（线程安全）。"""
    with _LOCK:
        try:
            os.makedirs(_CACHE_DIR, exist_ok=True)
            with open(_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(_MEM_CACHE, f, ensure_ascii=False, indent=2)
        except OSError:
            pass


def _normalize_region(province: str, city: str = "", district: str = "") -> Optional[str]:
    """直接拼接各源返回的省/市/区分量，不做任何补全或去重。空值跳过。"""
    province = (province or "").strip()
    city = (city or "").strip()
    district = (district or "").strip()
    parts = [p for p in [province, city, district] if p and p != "X"]
    return "".join(parts) if parts else None


def _query_ip_api_com(ip: str) -> Optional[str]:
    """数据源 1：ip-api.com（HTTP，免费，支持中文，限速 45/min）。"""
    url = f"http://ip-api.com/json/{urllib.parse.quote(ip)}?lang=zh-CN&fields=status,country,regionName,city,query"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "map-game/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("status") != "success":
            return None
        # 只取中国内地的归属地
        if data.get("country") != "中国":
            return None
        # 直接拼接 regionName（省）+ city（市/区）+ district（区）
        return _normalize_region(
            data.get("regionName") or "",
            data.get("city") or "",
            data.get("district") or "",
        )
    except Exception:
        return None


def _query_pconline(ip: str) -> Optional[str]:
    """数据源 2：whois.pconline.com.cn（国内 IP138，GBK 编码 JSON）。"""
    url = f"https://whois.pconline.com.cn/ipJson.jsp?ip={urllib.parse.quote(ip)}&json=true"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "map-game/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            # pconline 默认 GBK 编码
            raw = resp.read()
            try:
                text = raw.decode("gbk")
            except UnicodeDecodeError:
                text = raw.decode("utf-8", errors="ignore")
        data = json.loads(text)
        # pro 已带"省"后缀，city 已带"市"后缀，region 为区县，直接拼接
        province = (data.get("pro") or "").strip()
        city = (data.get("city") or "").strip()
        region = (data.get("region") or "").strip()
        if not province or province == "X":
            return None
        return _normalize_region(province, city, region)
    except Exception:
        return None


def _query_baidu(ip: str) -> Optional[str]:
    """数据源 3：opendata.baidu.com（兜底）。"""
    url = f"https://opendata.baidu.com/api.php?query={urllib.parse.quote(ip)}&co=&resource_id=6006&oe=utf8"
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        })
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("status") != "0":
            return None
        items = data.get("data") or []
        if not items:
            return None
        location = items[0].get("location") or ""
        if not location:
            return None
        # 百度返回 "江苏省南京市 电信" 等格式，去掉运营商部分
        # 取第一个空格前的省市部分
        location = location.split(" ")[0].strip()
        if not location:
            return None
        # 尝试拆解省市（已带后缀）
        # 简单返回原值（已规范）
        return location
    except Exception:
        return None


# ===== 高德作为第 4 个备用（已配置 key 时启用）=====
def _query_amap(ip: str) -> Optional[str]:
    """数据源 4：高德 IP 定位 v3（需 key，已配置时启用）。"""
    key = settings.amap_web_key
    if not key:
        return None
    url = f"https://restapi.amap.com/v3/ip?ip={urllib.parse.quote(ip)}&key={urllib.parse.quote(key)}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "map-game/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("status") != "1":
            return None
        province = data.get("province") or ""
        city = data.get("city") or ""
        if isinstance(province, list):
            province = ""
        if isinstance(city, list):
            city = ""
        district = data.get("district") or ""
        if isinstance(district, list):
            district = ""
        if not province:
            return None
        parts = [p for p in [province, city, district] if p]
        return "".join(parts) if parts else None
    except Exception:
        return None


# 查询源顺序：pconline(国内IP138，对国内IP最准) → ip-api(国际，覆盖广) → 百度(兜底) → 高德(配key时)
_QUERY_SOURCES = (_query_pconline, _query_ip_api_com, _query_baidu, _query_amap)


def _query_region(ip: str) -> Optional[str]:
    """依次尝试多个数据源，返回第一个成功的结果。"""
    for source in _QUERY_SOURCES:
        region = source(ip)
        if region:
            return region
    return None


def get_ip_region(ip: str) -> Optional[str]:
    """查询 IP 归属地：内存缓存 → 磁盘缓存 → 多源 API → 写回缓存。

    本机/内网 IP 直接返回 None，不调用 API。
    """
    if not ip or ip in ("0.0.0.0", "127.0.0.1", "unknown"):
        return None
    # 简单过滤内网/局域网
    if ip.startswith(("10.", "172.16.", "192.168.", "169.254.")) or ip == "localhost":
        return None

    cache = _load_cache()
    # 仅非空缓存才命中（空串表示之前查询失败，换源后应重查）
    cached = cache.get(ip)
    if cached:
        return cached

    region = _query_region(ip)
    # 无论是否查到都写缓存（None 存空串，避免重复请求失败的 IP）
    cache[ip] = region or ""
    _persist_cache()
    return region


def get_ip_region_bulk(ips: list[str]) -> dict[str, Optional[str]]:
    """批量查询 IP 归属地（脚本用）：已缓存的直接返回，未缓存的逐个查询。

    返回 {ip: region_or_None}。
    """
    cache = _load_cache()
    result: dict[str, Optional[str]] = {}
    for ip in ips:
        if not ip:
            continue
        cached = cache.get(ip)
        if cached:
            result[ip] = cached
        else:
            region = _query_region(ip)
            cache[ip] = region or ""
            result[ip] = region
    _persist_cache()
    return result
