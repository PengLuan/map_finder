"""
POI 收集脚本：通过高德地图 POI 搜索 API 批量收集景点坐标

前置条件：
  - 需要「Web服务」类型的 Key（在 https://console.amap.com/dev/key/app 创建）
  - 如果现有 Key 是「Web端(JS API)」类型，需新建一个 Web服务 Key

用法：
  cd backend

  # 按关键词列表收集，输出到 stdout
  python -m scripts.collect_pois

  # 按城市分类收集（每个城市取前 N 个景点）
  python -m scripts.collect_pois --mode city --limit 30

  # 收集并直接写入数据库
  python -m scripts.collect_pois --mode city --limit 30 --db

  # 输出到文件
  python -m scripts.collect_pois --mode city --limit 30 -o collected_pois.py
"""
import argparse
import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import requests
except ImportError:
    print("请先安装 requests: pip install requests")
    sys.exit(1)

# ---- 配置 ----
AMAP_KEY = os.environ.get("AMAP_WEB_KEY", "98b2baa96f7dad370b90f22ec5d3f92a")
BASE_URL = "https://restapi.amap.com/v3/place/text"
REQUEST_INTERVAL = 0.25  # 请求间隔（秒），避免触发 QPS 限制

# 景点分类编码（高德 POI 分类）
# 110000 风景名胜 | 110100 公园广场 | 110200 寺庙 | 110201 教堂
# 110202 清真寺 | 110203 道观 | 110204 神社 | 110205 妈祖庙
# 110206 自然风景 | 110207 海滨浴场 | 110208 植物园 | 110209 动物园
# 110210 水族馆 | 110211 城市广场 | 110212 公园 | 110213 森林公园
# 110214 湿地公园 | 110215 地质公园 | 110216 水上乐园
SCENIC_TYPES = "110000|110206|110212|110213|110214|110215"

# ---- 关键词列表：全国知名景点 ----
KEYWORDS = [
    # 北京
    "故宫", "天坛", "颐和园", "圆明园", "八达岭长城", "慕田峪长城",
    "明十三陵", "恭王府", "北海公园", "景山公园", "香山公园",
    "鸟巢", "水立方", "南锣鼓巷", "什刹海", "雍和宫",
    # 天津
    "天津之眼", "五大道", "瓷房子", "古文化街",
    # 河北
    "承德避暑山庄", "山海关", "北戴河", "野三坡", "白洋淀",
    "清东陵", "清西陵", "赵州桥", "西柏坡",
    # 山西
    "云冈石窟", "平遥古城", "五台山", "悬空寺", "应县木塔",
    "乔家大院", "王家大院", "壶口瀑布", "雁门关",
    # 内蒙古
    "成吉思汗陵", "响沙湾", "阿尔山国家森林公园", "额济纳胡杨林",
    "满洲里套娃广场", "大召寺",
    # 辽宁
    "沈阳故宫", "张氏帅府", "金石滩", "老虎滩海洋公园", "千山风景区",
    "本溪水洞", "鸭绿江断桥",
    # 吉林
    "长白山", "伪满皇宫", "净月潭", "松花湖", "查干湖",
    # 黑龙江
    "哈尔滨冰雪大世界", "太阳岛", "镜泊湖", "五大连池", "漠河北极村",
    "扎龙自然保护区", "圣索菲亚大教堂",
    # 上海
    "外滩", "东方明珠", "豫园", "迪士尼乐园", "朱家角古镇",
    "上海博物馆", "城隍庙", "静安寺", "玉佛寺",
    # 江苏
    "中山陵", "夫子庙", "拙政园", "留园", "虎丘", "周庄古镇",
    "同里古镇", "瘦西湖", "个园", "何园", "大明寺",
    "花果山", "连岛", "鼋头渚", "灵山大佛", "三国城",
    # 浙江
    "西湖", "灵隐寺", "千岛湖", "普陀山", "雁荡山", "莫干山",
    "乌镇", "西塘古镇", "南浔古镇", "天台山", "神仙居",
    "江郎山", "诸葛八卦村", "双龙洞",
    # 安徽
    "黄山", "九华山", "宏村", "西递", "天柱山", "天堂寨",
    "三河古镇", "包公园", "李鸿章故居", "太极洞",
    # 福建
    "鼓浪屿", "武夷山", "福建土楼", "南普陀寺", "开元寺",
    "清源山", "太姥山", "冠豸山", "泰宁大金湖", "湄洲岛",
    # 江西
    "庐山", "滕王阁", "井冈山", "三清山", "龙虎山", "婺源",
    "景德镇古窑", "鄱阳湖", "龟峰", "瑞金",
    # 山东
    "泰山", "崂山", "趵突泉", "蓬莱阁", "刘公岛", "成山头",
    "台儿庄古城", "微山湖", "沂蒙山", "青州古城", "长岛",
    # 河南
    "少林寺", "龙门石窟", "云台山", "清明上河园", "白马寺",
    "老君山", "白云山", "尧山", "芒砀山", "殷墟",
    "红旗渠", "郭亮村", "鸡公山",
    # 湖北
    "黄鹤楼", "武当山", "三峡大坝", "神农架", "东湖",
    "恩施大峡谷", "腾龙洞", "明显陵", "古隆中", "赤壁",
    # 湖南
    "张家界", "岳阳楼", "衡山", "橘子洲", "凤凰古城",
    "岳麓书院", "韶山", "崀山", "东江湖", "矮寨大桥",
    # 广东
    "广州塔", "丹霞山", "长隆欢乐世界", "白云山", "陈家祠",
    "开平碉楼", "南澳岛", "西樵山", "罗浮山", "惠州西湖",
    # 广西
    "漓江", "德天瀑布", "北海银滩", "涠洲岛", "黄姚古镇",
    "龙脊梯田", "花山岩画", "友谊关", "大明山",
    # 海南
    "天涯海角", "南山寺", "蜈支洲岛", "亚龙湾", "呀诺达",
    "分界洲岛", "博鳌亚洲论坛会址", "东坡书院",
    # 重庆
    "洪崖洞", "大足石刻", "武隆天生三桥", "长江三峡", "磁器口",
    "解放碑", "湖广会馆", "金佛山", "四面山", "酉阳桃花源",
    # 四川
    "都江堰", "乐山大佛", "九寨沟", "峨眉山", "稻城亚丁",
    "青城山", "三星堆", "黄龙风景区", "海螺沟", "蜀南竹海",
    "阆中古城", "剑门关", "四姑娘山", "毕棚沟", "若尔盖花湖",
    # 贵州
    "黄果树瀑布", "荔波小七孔", "西江千户苗寨", "镇远古镇",
    "梵净山", "织金洞", "赤水丹霞", "万峰林", "马岭河峡谷",
    # 云南
    "石林", "洱海", "玉龙雪山", "丽江古城", "大理古城",
    "崇圣寺三塔", "普达措国家公园", "虎跳峡", "元阳梯田",
    "建水古城", "腾冲火山", "和顺古镇", "罗平油菜花",
    "泸沽湖", "香格里拉", "梅里雪山",
    # 西藏
    "布达拉宫", "纳木错", "珠穆朗玛峰", "大昭寺", "羊卓雍错",
    "扎什伦布寺", "雅鲁藏布大峡谷", "南迦巴瓦峰", "冈仁波齐",
    "玛旁雍错", "巴松措", "鲁朗林海",
    # 陕西
    "兵马俑", "华山", "大雁塔", "黄帝陵", "法门寺",
    "乾陵", "茂陵", "壶口瀑布", "太白山", "金丝峡",
    "延安宝塔山", "钟鼓楼", "城墙",
    # 甘肃
    "莫高窟", "鸣沙山月牙泉", "嘉峪关", "张掖丹霞", "崆峒山",
    "麦积山石窟", "官鹅沟", "扎尕那", "拉卜楞寺", "桑科草原",
    # 青海
    "青海湖", "茶卡盐湖", "塔尔寺", "门源油菜花", "年保玉则",
    "水上雅丹", "翡翠湖", "阿尼玛卿雪山",
    # 宁夏
    "沙坡头", "镇北堡西部影城", "西夏王陵", "沙湖", "须弥山石窟",
    # 新疆
    "天山天池", "喀纳斯湖", "火焰山", "那拉提草原", "巴音布鲁克",
    "赛里木湖", "禾木村", "白哈巴", "独库公路", "帕米尔高原",
    "喀什老城", "艾提尕尔清真寺", "葡萄沟", "坎儿井",
    "魔鬼城", "五彩滩", "塔克拉玛干沙漠",
    # 港澳台
    "维多利亚港", "大三巴牌坊", "日月潭", "台北故宫博物院",
    "阿里山", "垦丁", "太鲁阁", "野柳地质公园",
]

# ---- 主要城市 adcode（用于城市分类模式）----
CITY_ADCODES = [
    "110100", "120100", "130100", "130300", "140100", "140200",
    "150100", "150700", "210100", "210200", "220100", "230100",
    "310100", "320100", "320200", "320500", "320700", "330100",
    "330200", "330300", "330600", "330700", "330800", "330900",
    "331000", "331100", "340100", "341000", "350100", "350200",
    "350300", "350500", "350700", "360100", "360200", "360400",
    "361100", "370100", "370200", "370600", "370800", "370900",
    "410100", "410300", "410800", "411300", "411500", "420100",
    "420300", "420500", "422800", "430100", "430600", "430800",
    "431200", "433100", "440100", "440200", "440300", "440400",
    "440700", "441300", "450100", "450300", "450500", "451000",
    "460100", "460200", "500100", "510100", "510700", "511100",
    "511300", "511400", "511500", "511600", "511800", "513200",
    "513300", "513400", "520100", "520300", "520400", "522200",
    "522300", "522600", "522700", "530100", "530300", "530400",
    "530500", "530600", "530700", "530800", "532300", "532500",
    "532600", "532800", "532900", "533100", "533300", "533400",
    "540100", "540200", "540300", "540400", "540500", "540600",
    "542400", "542500", "610100", "610200", "610300", "610400",
    "610500", "610600", "610700", "610800", "610900", "611000",
    "620100", "620200", "620300", "620400", "620500", "620600",
    "620700", "620800", "620900", "621000", "621100", "621200",
    "622900", "623000", "630100", "630200", "632200", "632300",
    "632500", "632600", "632700", "632800", "640100", "640200",
    "640300", "640400", "640500", "650100", "650200", "650400",
    "652100", "652200", "652300", "652700", "652800", "652900",
    "653000", "653100", "653200", "654000", "654200", "654300",
]

# 难度评估：根据城市偏远程度粗略分配
def estimate_difficulty(adcode: str) -> int:
    """根据 adcode 前两位（省份）粗略估计难度"""
    province = adcode[:2]
    # 偏远省份难度较高
    hard = {"54", "65", "63", "62", "15"}  # 西藏、新疆、青海、甘肃、内蒙古
    medium = {"53", "52", "51", "45", "46", "23", "22", "21", "64"}  # 云贵川桂琼、东北、宁夏
    if province in hard:
        return 4
    if province in medium:
        return 3
    return 2


def search_pois(keyword: str = "", city: str = "", types: str = "",
                page: int = 1, offset: int = 25) -> list[dict]:
    """调用高德 POI 搜索 API"""
    params = {
        "key": AMAP_KEY,
        "offset": offset,
        "page": page,
        "extensions": "base",
        "output": "json",
    }
    if keyword:
        params["keywords"] = keyword
    if city:
        params["city"] = city
        params["citylimit"] = "true"
    if types:
        params["types"] = types

    try:
        resp = requests.get(BASE_URL, params=params, timeout=10)
        data = resp.json()
    except Exception as e:
        print(f"  请求失败: {e}", file=sys.stderr)
        return []

    if data.get("status") != "1":
        print(f"  API 错误: {data.get('info', '未知错误')}", file=sys.stderr)
        return []

    return data.get("pois", [])


def poi_to_tuple(poi: dict) -> tuple | None:
    """将高德 POI 转为种子数据格式: (name, category, lng, lat, adcode, difficulty, hint)"""
    name = poi.get("name", "").strip()
    location = poi.get("location", "")
    adcode = poi.get("adcode", "")

    if not name or not location or "," not in location:
        return None

    try:
        lng_str, lat_str = location.split(",")
        lng, lat = float(lng_str), float(lat_str)
    except ValueError:
        return None

    # 过滤无效坐标（中国范围外）
    if not (73.0 <= lng <= 136.0 and 3.0 <= lat <= 54.0):
        return None

    # 类别：从高德 type 提取
    type_name = poi.get("type", "")
    category = "景点"
    if "山" in type_name or "峰" in type_name:
        category = "山峰"
    elif "湖" in type_name or "水库" in type_name:
        category = "湖泊"
    elif "河" in type_name or "江" in type_name or "溪" in type_name:
        category = "河流"
    elif "寺" in type_name or "庙" in type_name or "观" in type_name:
        category = "寺庙"
    elif "塔" in type_name or "楼" in type_name or "馆" in type_name:
        category = "建筑"
    elif "公园" in type_name:
        category = "公园"

    difficulty = estimate_difficulty(adcode)

    # 地址信息：省+市+区
    pname = poi.get("pname", "")
    cityname = poi.get("cityname", "")
    adname = poi.get("adname", "")
    address_parts = [p for p in [pname, cityname, adname] if p]
    address = "".join(address_parts)

    # hint: 省 市 的 名称
    if pname and cityname and pname != cityname:
        hint = f"{pname} {cityname} 的 {name}"
    elif pname:
        hint = f"{pname} 的 {name}"
    elif cityname:
        hint = f"{cityname} 的 {name}"
    else:
        hint = name

    return (name, category, round(lng, 6), round(lat, 6), adcode, difficulty, hint)


def collect_by_keywords() -> list[tuple]:
    """按关键词列表收集"""
    results = []
    seen_names = set()
    total = len(KEYWORDS)

    for i, kw in enumerate(KEYWORDS, 1):
        print(f"[{i}/{total}] 搜索: {kw}", file=sys.stderr)
        pois = search_pois(keyword=kw)
        time.sleep(REQUEST_INTERVAL)

        if not pois:
            print(f"  无结果", file=sys.stderr)
            continue

        # 取第一个匹配结果（最相关）
        t = poi_to_tuple(pois[0])
        if t and t[0] not in seen_names:
            seen_names.add(t[0])
            results.append(t)
            print(f"  ✓ {t[0]} ({t[2]}, {t[3]})", file=sys.stderr)
        else:
            print(f"  跳过（重复或无效）", file=sys.stderr)

    return results


def collect_by_city(limit_per_city: int = 20) -> list[tuple]:
    """按城市分类收集景点"""
    results = []
    seen_names = set()
    total = len(CITY_ADCODES)

    for i, adcode in enumerate(CITY_ADCODES, 1):
        print(f"[{i}/{total}] 城市 {adcode} 搜索景点...", file=sys.stderr)
        page = 1
        city_count = 0

        while city_count < limit_per_city:
            pois = search_pois(city=adcode, types=SCENIC_TYPES, page=page)
            time.sleep(REQUEST_INTERVAL)

            if not pois:
                break

            for poi in pois:
                if city_count >= limit_per_city:
                    break
                t = poi_to_tuple(poi)
                if t and t[0] not in seen_names:
                    seen_names.add(t[0])
                    results.append(t)
                    city_count += 1

            page += 1
            if page > 10:  # 最多翻10页
                break

        print(f"  收集 {city_count} 个", file=sys.stderr)

    return results


def format_output(pois: list[tuple]) -> str:
    """格式化为 Python 列表字符串"""
    lines = ["COLLECTED_POIS = ["]
    for name, cat, lng, lat, adcode, diff, hint in pois:
        lines.append(f'    ("{name}", "{cat}", {lng}, {lat}, "{adcode}", {diff}, "{hint}"),')
    lines.append("]")
    return "\n".join(lines)


def insert_to_db(pois: list[tuple]):
    """写入数据库（跳过已存在的同名 POI）"""
    from app.database import SessionLocal
    from app.models import POI

    db = SessionLocal()
    inserted = 0
    skipped = 0

    try:
        for name, cat, lng, lat, adcode, diff, hint in pois:
            existing = db.query(POI).filter(POI.name == name).first()
            if existing:
                skipped += 1
                continue

            poi = POI(
                name=name,
                category=cat,
                lng=lng,
                lat=lat,
                adcode=adcode,
                difficulty=diff,
                hint_text=hint,
                address=hint,
            )
            db.add(poi)
            inserted += 1

        db.commit()
        print(f"\n数据库写入完成: 新增 {inserted} 条, 跳过 {skipped} 条（已存在）")
    except Exception as e:
        db.rollback()
        print(f"数据库写入失败: {e}", file=sys.stderr)
        raise
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="高德 POI 收集脚本")
    parser.add_argument("--mode", choices=["keyword", "city"], default="keyword",
                        help="收集模式: keyword=按关键词, city=按城市分类 (默认: keyword)")
    parser.add_argument("--limit", type=int, default=20,
                        help="城市模式下每个城市收集的 POI 数量 (默认: 20)")
    parser.add_argument("--db", action="store_true",
                        help="直接写入数据库")
    parser.add_argument("-o", "--output", type=str, default=None,
                        help="输出文件路径（默认输出到 stdout）")
    args = parser.parse_args()

    print(f"收集模式: {args.mode}", file=sys.stderr)
    print(f"API Key: {AMAP_KEY[:8]}...", file=sys.stderr)

    if args.mode == "keyword":
        pois = collect_by_keywords()
    else:
        pois = collect_by_city(limit_per_city=args.limit)

    print(f"\n共收集 {len(pois)} 个 POI", file=sys.stderr)

    if args.db:
        insert_to_db(pois)
    else:
        output = format_output(pois)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(output + "\n")
            print(f"已写入: {args.output}", file=sys.stderr)
        else:
            print(output)


if __name__ == "__main__":
    main()
