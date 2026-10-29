"""
新增「江河之源」主题：poi_themes 1 行 + pois 105 条（全部 point、area_review=1 待核定）。

- 幂等：重复执行会先删除 code=river_source / category=river_source 的旧数据再重建，
  重建前会保留已有的 POI 封面 URL 与主题封面 URL
- 国内条目 adcode/address 通过高德逆地理编码按坐标校准；
  境外条目（overseas=True）跳过逆地理，adcode=NULL、address 用数据文件中的手工值
- 主题封面现场爬一张图，上传 OSS covers/themes/river_source.jpg 并回写 cover_url
- POI 封面不在此脚本处理，后续运行 scripts.crawl_river_source_covers + scripts.upload_covers_to_oss

运行: cd backend && python3 -m scripts.insert_river_source_pois
"""
import os
import sys
import time

import pymysql
import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.river_source_extra_data import EXTRA_RIVERS

AMAP_KEY = os.environ.get("AMAP_WEB_KEY", "")

# OSS 配置（与 upload_covers_to_oss.py 保持一致）
OSS_ACCESS_KEY_ID = os.environ.get("OSS_ACCESS_KEY_ID", "")
OSS_ACCESS_KEY_SECRET = os.environ.get("OSS_ACCESS_KEY_SECRET", "")
OSS_ENDPOINT = "https://oss-cn-beijing.aliyuncs.com"
OSS_BUCKET_NAME = "map-find"
OSS_PUBLIC_URL = f"https://{OSS_BUCKET_NAME}.oss-cn-beijing.aliyuncs.com"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEME_COVER_DIR = os.path.join(BASE_DIR, "static", "theme_covers")

THEME = {
    "id": 17,
    "code": "river_source",
    "name": "江河之源",
    "description": "溯源而上，寻找中国主要江河的源头坐标",
    "icon": "💧",
    "group_name": "自然风光",
    "sort_order": 9,
}

# id 从当前 pois 最大 id(4880) 之后开始；adcode 为预估值，运行时用高德逆地理校准
RIVERS = [
    dict(id=4881, name="长江之源", lng=91.05, lat=33.48, adcode="632801", difficulty=5,
         summary="长江正源为沱沱河，发源于唐古拉山脉主峰格拉丹东雪山西南侧的姜根迪如冰川，冰川末端海拔约6500米。格拉丹东海拔6621米，冰川融水汇成万里长江的第一股细流。",
         hint="万里长江的起点，藏在唐古拉山脉的雪山之巅"),
    dict(id=4882, name="黄河之源", lng=96.34, lat=34.49, adcode="632726", difficulty=5,
         summary="1978年科学考察确认卡日曲为黄河正源，发源于巴颜喀拉山北麓各姿各雅峰。黄河水利委员会1985年认定约古宗列盆地为黄河源头并立碑，海拔约4500米。",
         hint="母亲河的源头，在巴颜喀拉山北麓的约古宗列"),
    dict(id=4883, name="澜沧江之源", lng=94.6956, lat=33.7086, adcode="632722", difficulty=5,
         summary="澜沧江（湄公河上游）正源为扎阿曲，发源于唐古拉山脉北麓，位于青海玉树杂多县境内，源头海拔5200米以上。它出境后称湄公河，流经六国注入南海。",
         hint="一条流经六国的国际大河，源头在青海玉树的雪山间"),
    dict(id=4884, name="怒江之源", lng=92.2328, lat=32.73, adcode="540624", difficulty=5,
         summary="怒江发源于唐古拉山脉南麓的桑曲，位于西藏那曲安多县境内，源头海拔约5400米。它南下穿过怒江大峡谷，出境后称萨尔温江，是我国水能最富集的河流之一。",
         hint="南下入东南亚的大河，源头在唐古拉山南麓"),
    dict(id=4885, name="雅鲁藏布江之源", lng=82.0556, lat=30.3683, adcode="540233", difficulty=5,
         summary="雅鲁藏布江发源于喜马拉雅山脉北麓杰马央宗冰川，位于西藏阿里地区仲巴、普兰两县交界一带，源头海拔约5590米，是世界上海拔最高的大河，下游大峡谷为世界最深峡谷。",
         hint="世界海拔最高的大河，源头在喜马拉雅山北麓"),
    dict(id=4886, name="珠江之源", lng=103.986755, lat=25.846871, adcode="530328", difficulty=4,
         summary="珠江正源位于云南曲靖沾益区马雄山，海拔2610米。珠江源景区立有『一水滴三江』碑，一泉之水分为南盘江、北盘江、牛栏江三支，汇成珠江水系。",
         hint="一水滴三江，源头在云南曲靖的马雄山"),
    dict(id=4887, name="松花江之源", lng=128.059214, lat=42.018229, adcode="222426", difficulty=3,
         summary="松花江有南北两源，北源即发源于长白山天池的第二松花江。天池海拔2189米，是我国最大的火山口湖，池水从天豁峰与龙门峰间缺口北流，滋养东北大地。",
         hint="长白山巅的火山口湖，是这条东北大河的起点"),
    dict(id=4888, name="辽河之源", lng=118.413227, lat=41.322091, adcode="130881", difficulty=4,
         summary="辽河东源老哈河发源于河北承德平泉市七老图山脉的光头山，海拔1729米。老哈河与西拉木伦河汇合后始称辽河，南流入渤海，滋养东北平原南部。",
         hint="七老图山脉的溪流，汇成东北平原南部的大河"),
    dict(id=4889, name="汉江之源", lng=106.238907, lat=33.064133, adcode="610726", difficulty=4,
         summary="汉江发源于陕西汉中宁强县嶓冢山南麓，是长江最长的支流。源头有『嶓冢导漾』古迹，《禹贡》所载『嶓冢导漾，东流为汉』即出于此。",
         hint="《禹贡》里『嶓冢导漾』的那座山，是长江最大支流之源"),
    dict(id=4890, name="渭河之源", lng=104.121, lat=35.124, adcode="622923", difficulty=4,
         summary="渭河发源于甘肃定西渭源县鸟鼠山，是黄河最大的支流。《尚书·禹贡》『鸟鼠同穴之山，渭水出焉』，渭河自此东流八百里，哺育了周秦汉唐的关中平原。",
         hint="鸟鼠同穴之山，渭水出焉"),
    dict(id=4891, name="嘉陵江之源", lng=107.029, lat=34.173, adcode="610330", difficulty=4,
         summary="嘉陵江发源于陕西宝鸡凤县代王山，是长江上游流域面积最大的支流。它切穿秦岭、巴山进入四川盆地，在重庆朝天门汇入长江。",
         hint="切穿秦岭入川的大江，源头在凤县"),
    dict(id=4892, name="淮河之源", lng=113.292593, lat=32.404256, adcode="411330", difficulty=3,
         summary="淮河发源于河南南阳桐柏县桐柏山主峰太白顶北麓，海拔1140米。淮河与秦岭一线是我国重要的南北地理分界线，源头立有『淮源』石碑。",
         hint="中国南北分界线的东端起点，源头在桐柏山"),
    dict(id=4893, name="钱塘江之源", lng=117.75146, lat=29.56501, adcode="341022", difficulty=3,
         summary="1983年钱塘江河源考察队确认正源为新安江，源头在安徽休宁县鹤城乡六股尖（海拔1629.8米）东坡。溪流汇成新安江，经千岛湖入浙江称钱塘江，入杭州湾的钱塘潮被誉为天下第一潮。",
         hint="新安江-千岛湖-钱塘江的起点，在皖南休宁六股尖"),
    dict(id=4894, name="闽江之源", lng=116.8167, lat=26.6356, adcode="350430", difficulty=4,
         summary="1991年福建省闽江办科考确定闽江正源，位于福建三明建宁县均口乡台田村严峰山西南坡，源头海拔约950米。台田溪汇入闽江后一路东流，经福州入海。",
         hint="福建母亲河的源头，在三明的严峰山下"),
    dict(id=4895, name="赣江之源", lng=116.3314, lat=26.0226, adcode="360735", difficulty=4,
         summary="2001年科学考察确定赣江正源为江西赣州石城县赣江源镇武夷山南段石寮岽的石寮河1号泉。赣江纵贯江西南北，经鄱阳湖注入长江，是江西的母亲河。",
         hint="江西母亲河的起点，在武夷山南段"),
    dict(id=4896, name="湘江之源", lng=112.066335, lat=25.203552, adcode="431127", difficulty=3,
         summary="2011年第一次全国水利普查认定潇水为湘江正源，源头位于湖南永州蓝山县紫良瑶族乡野狗岭。湘江自南向北纵贯湖南，注入洞庭湖。",
         hint="湖南母亲河的正源，是潇水，源头在蓝山县"),
    dict(id=4897, name="汾河之源", lng=112.10, lat=38.82, adcode="140925", difficulty=3,
         summary="汾河发源于山西忻州宁武县东寨镇雷鸣寺泉，古称『汾源灵沼』，是山西最大的河流。汾河纵贯三晋大地七百余公里，在河津汇入黄河。",
         hint="汾源灵沼，山西最大河流的起点"),
    dict(id=4898, name="沅江之源", lng=107.36, lat=26.33, adcode="522701", difficulty=4,
         summary="沅江正源为摆洗河，发源于贵州都匀斗篷山南麓马鬃岭。斗篷山海拔1961米，是黔中最高峰。沅江下游入湖南称沅水，注入洞庭湖。",
         hint="黔中最高峰斗篷山南麓，是这条入洞庭之河的源头"),
    dict(id=4899, name="乌江之源", lng=104.45, lat=26.98, adcode="520526", difficulty=4,
         summary="乌江正源为三岔河，发源于贵州毕节威宁县盐仓镇香炉山。乌江是长江上游南岸最大支流，纵贯贵州全境，在重庆涪陵注入长江。",
         hint="贵州第一大河的正源，在威宁的香炉山"),
    dict(id=4900, name="岷江之源", lng=103.714179, lat=33.032597, adcode="513224", difficulty=3,
         summary="岷江传统正源为四川阿坝松潘县弓杠岭，海拔约3700米，现为岷江源国家湿地公园核心区。岷江历史上曾被当作长江正源，南流经成都平原，在宜宾汇入长江。",
         hint="历史上曾被当作长江正源，起点在松潘弓杠岭"),
]

ALL_RIVERS = RIVERS + EXTRA_RIVERS


def regeo(lng: float, lat: float):
    """高德逆地理编码，返回 (adcode, formatted_address)"""
    try:
        resp = requests.get(
            "https://restapi.amap.com/v3/geocode/regeo",
            params={"location": f"{lng},{lat}", "key": AMAP_KEY, "extensions": "base"},
            timeout=10,
        )
        data = resp.json()
        if data.get("status") == "1":
            comp = data["regeocode"]["addressComponent"]
            addr = data["regeocode"].get("formatted_address") or ""
            if isinstance(addr, list):  # 无人区返回 []
                addr = ""
            return comp.get("adcode") or "", addr
    except Exception as e:
        print(f"    regeo 失败: {e}", file=sys.stderr)
    return "", ""


def upload_theme_cover():
    """为主题爬一张封面图并上传 OSS，返回 OSS URL"""
    from scripts.crawl_images import fetch_cover

    img = None
    for q in ("长江源 格拉丹东雪山", "三江源 雪山 河流"):
        img = fetch_cover(q)
        if img is not None:
            break
    if img is None:
        print("[THEME] 封面爬取失败，cover_url 留空")
        return None

    if img.mode != "RGB":
        img = img.convert("RGB")
    w, h = img.size
    scale = min(1.0, 1280 / max(w, h))
    if scale < 1.0:
        img = img.resize((int(w * scale), int(h * scale)))
    os.makedirs(THEME_COVER_DIR, exist_ok=True)
    local = os.path.join(THEME_COVER_DIR, "river_source.jpg")
    img.save(local, "JPEG", quality=85, optimize=True)

    import oss2
    bucket = oss2.Bucket(oss2.Auth(OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET),
                         OSS_ENDPOINT, OSS_BUCKET_NAME)
    oss_key = "covers/themes/river_source.jpg"
    bucket.put_object_from_file(oss_key, local, headers={"Content-Type": "image/jpeg"})
    url = f"{OSS_PUBLIC_URL}/{oss_key}"
    try:
        status = requests.head(url, timeout=20).status_code
    except Exception:
        status = "?"
    print(f"[THEME] 封面已上传 {url} (HTTP {status})")
    return url


def main():
    conn = pymysql.connect(host="localhost", port=3306, user="root", password="123456",
                           database="map_game", charset="utf8mb4")
    cur = conn.cursor()

    # 幂等：清理前先保留已有封面 URL
    cur.execute("SELECT id, cover_url FROM pois WHERE category='river_source'")
    old_covers = {row[0]: row[1] for row in cur.fetchall() if row[1]}
    cur.execute("SELECT cover_url FROM poi_themes WHERE code='river_source'")
    row = cur.fetchone()
    old_theme_cover = row[0] if row and row[0] else None
    cur.execute("DELETE FROM pois WHERE category='river_source'")
    cur.execute("DELETE FROM poi_themes WHERE code='river_source'")
    conn.commit()
    print(f"[CLEAN] 已清理旧的 river_source 数据（保留 {len(old_covers)} 条 POI 封面、主题封面{'有' if old_theme_cover else '无'}）")

    # 插入主题（封面稍后上传后回写）
    cur.execute(
        "INSERT INTO poi_themes (id, code, name, description, icon, cover_url, group_name, sort_order, enabled) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,1)",
        (THEME["id"], THEME["code"], THEME["name"], THEME["description"],
         THEME["icon"], old_theme_cover, THEME["group_name"], THEME["sort_order"]),
    )
    conn.commit()
    print(f"[THEME] 已插入 poi_themes: {THEME['name']} (id={THEME['id']}, sort_order={THEME['sort_order']})")

    # 插入 POI
    ok = 0
    for r in ALL_RIVERS:
        if r.get("overseas"):
            adcode, address = None, r["address"]
        else:
            adcode, address = regeo(r["lng"], r["lat"])
            if not adcode:
                adcode = r.get("adcode")
                print(f"    {r['name']}: 逆地理失败，使用预估 adcode={adcode}")
        cur.execute(
            "INSERT INTO pois (id, name, category, lng, lat, adcode, address, summary, "
            "cover_url, hint_text, difficulty, source, used_count, verify_status, "
            "shape_type, radius_km, area_review) "
            "VALUES (%s,%s,'river_source',%s,%s,%s,%s,%s,%s,%s,%s,'manual',0,'approved',"
            "'point',0,1)",
            (r["id"], r["name"], r["lng"], r["lat"], adcode, address or None,
             r["summary"], old_covers.get(r["id"]), r["hint"], r["difficulty"]),
        )
        conn.commit()
        print(f"  [{ok+1}/{len(ALL_RIVERS)}] {r['name']} id={r['id']} adcode={adcode or '-'} 地址={address or '-'}")
        ok += 1
        if not r.get("overseas"):
            time.sleep(0.2)

    # 主题封面（已有则跳过）
    if old_theme_cover:
        print(f"[THEME] 已有封面 {old_theme_cover}，跳过上传")
    else:
        cover = upload_theme_cover()
        if cover:
            cur.execute("UPDATE poi_themes SET cover_url=%s WHERE code='river_source'", (cover,))
            conn.commit()

    conn.close()
    print(f"\n[DONE] 插入 {ok} 条 POI（area_review=1 待核定），接下来运行:")
    print("  python3 -m scripts.crawl_river_source_covers  # 爬 POI 封面")
    print("  python3 -m scripts.upload_covers_to_oss       # 上传 OSS 并回写 cover_url")


if __name__ == "__main__":
    main()
