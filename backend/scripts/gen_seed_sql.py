"""生成 DDL + 种子数据 SQL（带坐标+封面图）

运行: python3 scripts/gen_seed_sql.py
输出: scripts/seed_pois.sql
"""
import urllib.parse
import textwrap

# ===== 种子数据：知名地标（WGS84 坐标 + 封面图） =====
# cover_url 使用 text_to_image API 生成地标专属航拍图
# 坐标为 WGS84 经纬度，adcode 为 6 位行政区划代码

SEEDS = [
    # ---- 5A 名山大川 ----
    ("故宫博物院", "5a_scenic", 116.397, 39.916, "110100", "北京", "世界上现存规模最大、保存最为完整的木质结构古建筑之一", "aerial photograph of the Forbidden City Beijing, ancient Chinese imperial palace, red walls golden roofs, photorealistic", "北京 的 故宫博物院", 1, "manual"),
    ("长城-八达岭", "5a_scenic", 116.024, 40.354, "110100", "北京", "万里长城最具代表性的段落，明代长城精华", "aerial photograph of the Great Wall of China at Badaling, ancient wall winding along mountain ridges, photorealistic", "北京 的 八达岭长城", 1, "manual"),
    ("黄山风景区", "5a_scenic", 118.167, 30.137, "341000", "安徽黄山", "天下第一奇山，松石云海温泉五绝闻名", "aerial photograph of Huangshan Mountains, granite peaks emerging from sea of clouds, pine trees, photorealistic", "安徽 的 黄山", 1, "manual"),
    ("张家界国家森林公园", "5a_scenic", 109.834, 29.326, "430800", "湖南张家界", "石英砂岩峰林地貌，电影阿凡达取景地", "aerial photograph of Zhangjiajie national forest park, towering sandstone pillars, misty valleys, photorealistic", "湖南 的 张家界", 1, "manual"),
    ("九寨沟", "5a_scenic", 103.918, 33.164, "513200", "四川阿坝", "以水景闻名世界的自然保护区，彩色湖泊群", "aerial photograph of Jiuzhaigou valley, turquoise and emerald colored lakes, waterfalls, autumn forest, photorealistic", "四川 的 九寨沟", 1, "manual"),
    ("桂林漓江", "5a_scenic", 110.290, 25.274, "450300", "广西桂林", "桂林山水甲天下，喀斯特地貌精华", "aerial photograph of Guilin Li River, karst limestone peaks along river, traditional boats, photorealistic", "广西 的 桂林漓江", 1, "manual"),
    ("泰山", "5a_scenic", 117.100, 36.266, "370900", "山东泰安", "五岳之首，历代帝王封禅之地", "aerial photograph of Mount Tai, ancient stone steps to summit, temple at peak, sunrise clouds, photorealistic", "山东 的 泰山", 1, "manual"),
    ("华山", "5a_scenic", 110.089, 34.477, "610500", "陕西渭南", "五岳之中最险峻，以奇险著称", "aerial photograph of Mount Hua Huashan, steep granite cliffs, narrow plank path, photorealistic", "陕西 的 华山", 1, "manual"),
    ("峨眉山", "5a_scenic", 103.332, 29.522, "511100", "四川乐山", "佛教四大名山之一，普贤菩萨道场", "aerial photograph of Mount Emei, Buddhist golden temple above clouds, photorealistic", "四川 的 峨眉山", 1, "manual"),
    ("西湖", "5a_scenic", 120.148, 30.242, "330100", "浙江杭州", "欲把西湖比西子，淡妆浓抹总相宜", "aerial photograph of West Lake Hangzhou, Su causeway, Leifeng pagoda, willow trees, photorealistic", "浙江 的 杭州西湖", 1, "manual"),

    # ---- 985/211 院校 ----
    ("清华大学", "university_985", 116.326, 40.003, "110100", "北京", "中国顶尖高等学府，水木清华", "aerial photograph of Tsinghua University campus, classical Chinese gate, photorealistic", "北京 的 清华大学", 2, "manual"),
    ("北京大学", "university_985", 116.305, 39.992, "110100", "北京", "未名湖畔博雅塔下，百年学府", "aerial photograph of Peking University, Weiming Lake and Boya Pagoda, photorealistic", "北京 的 北京大学", 2, "manual"),
    ("复旦大学", "university_985", 121.502, 31.297, "310100", "上海", "日月光华，旦复旦兮", "aerial photograph of Fudan University campus, modern academic buildings, photorealistic", "上海 的 复旦大学", 2, "manual"),
    ("上海交通大学", "university_985", 121.434, 31.025, "310100", "上海", "百年交大，饮水思源", "aerial photograph of Shanghai Jiao Tong University, historic gate, photorealistic", "上海 的 上海交通大学", 2, "manual"),
    ("浙江大学", "university_985", 120.124, 30.264, "330100", "浙江杭州", "求是鹰，紫金港校区", "aerial photograph of Zhejiang University Zijingang campus, photorealistic", "浙江 的 浙江大学", 2, "manual"),
    ("南京大学", "university_985", 118.778, 32.062, "320100", "江苏南京", "诚朴雄伟，励学敦行", "aerial photograph of Nanjing University campus, photorealistic", "江苏 的 南京大学", 2, "manual"),
    ("武汉大学", "university_985", 114.357, 30.539, "420100", "湖北武汉", "珞珈山樱花季，最美大学", "aerial photograph of Wuhan University, cherry blossom along Luojia Hill, photorealistic", "湖北 的 武汉大学", 2, "manual"),
    ("中山大学", "university_985", 113.295, 23.098, "440100", "广东广州", "康乐园红砖建筑，岭南学府", "aerial photograph of Sun Yat-sen University, red brick historic buildings, photorealistic", "广东 的 中山大学", 2, "manual"),
    ("四川大学", "university_985", 104.082, 30.629, "510100", "四川成都", "海纳百川，有容乃大", "aerial photograph of Sichuan University campus, photorealistic", "四川 的 四川大学", 2, "manual"),
    ("厦门大学", "university_985", 118.092, 24.436, "350200", "福建厦门", "依山傍海，最美海岸线大学", "aerial photograph of Xiamen University, seaside campus with mountains, photorealistic", "福建 的 厦门大学", 2, "manual"),

    # ---- 知名山峰 ----
    ("珠穆朗玛峰", "mountain", 86.925, 27.988, "540200", "西藏日喀则", "世界最高峰，海拔8848.86米", "aerial photograph of Mount Everest summit, snow covered peak above clouds, photorealistic", "西藏 的 珠穆朗玛峰", 1, "manual"),
    ("贡嘎山", "mountain", 101.878, 29.590, "513300", "四川甘孜", "蜀山之王，海拔7556米", "aerial photograph of Minya Konka Gongga mountain, glaciated peak, photorealistic", "四川 的 贡嘎山", 1, "manual"),
    ("梅里雪山", "mountain", 98.733, 28.419, "533400", "云南迪庆", "藏区八大神山之首，卡瓦格博峰", "aerial photograph of Meili Snow Mountain Kawagebo, golden sunrise on snow peak, photorealistic", "云南 的 梅里雪山", 1, "manual"),
    ("长白山天池", "mountain", 128.056, 42.009, "220600", "吉林延边", "中朝界湖，火山口湖", "aerial photograph of Changbai Mountain Heaven Lake, crater lake with blue water, photorealistic", "吉林 的 长白山天池", 1, "manual"),
    ("武夷山", "mountain", 117.933, 27.722, "350700", "福建南平", "丹霞地貌，世界文化与自然遗产", "aerial photograph of Wuyi Mountains, red danxia cliffs along river, photorealistic", "福建 的 武夷山", 1, "manual"),

    # ---- 知名湖泊 ----
    ("青海湖", "lake", 100.170, 36.620, "630100", "青海海南", "中国最大内陆咸水湖", "aerial photograph of Qinghai Lake, vast blue lake with rapeseed flower fields, photorealistic", "青海 的 青海湖", 1, "manual"),
    ("纳木错", "lake", 90.610, 30.730, "540100", "西藏拉萨", "世界海拔最高大型湖泊，圣湖", "aerial photograph of Namtso Lake, turquoise lake with snow mountains, photorealistic", "西藏 的 纳木错", 1, "manual"),
    ("鄱阳湖", "lake", 116.350, 29.150, "360400", "江西九江", "中国最大淡水湖", "aerial photograph of Poyang Lake, vast freshwater lake with wetlands, photorealistic", "江西 的 鄱阳湖", 1, "manual"),
    ("洞庭湖", "lake", 112.800, 29.350, "430600", "湖南岳阳", "八百里洞庭，鱼米之乡", "aerial photograph of Dongting Lake, misty vast lake with fishing boats, photorealistic", "湖南 的 洞庭湖", 1, "manual"),
    ("太湖", "lake", 120.220, 31.220, "320500", "江苏苏州", "江南鱼米之乡，跨江浙两省", "aerial photograph of Taihu Lake, vast lake with traditional boats, photorealistic", "江苏 的 太湖", 1, "manual"),

    # ---- 机场 ----
    ("北京首都国际机场", "airport", 116.584, 40.080, "110100", "北京", "中国第一大航空枢纽", "aerial photograph of Beijing Capital International Airport, T3 terminal, photorealistic", "北京 的 首都国际机场", 3, "manual"),
    ("上海浦东国际机场", "airport", 121.808, 31.144, "310100", "上海", "东亚最大航空货运枢纽", "aerial photograph of Shanghai Pudong International Airport, photorealistic", "上海 的 浦东国际机场", 3, "manual"),
    ("广州白云国际机场", "airport", 113.299, 23.392, "440100", "广东广州", "华南最大航空枢纽", "aerial photograph of Guangzhou Baiyun International Airport, photorealistic", "广东 的 白云国际机场", 3, "manual"),
    ("成都天府国际机场", "airport", 104.441, 30.312, "510100", "四川成都", "西部国际航空枢纽", "aerial photograph of Chengdu Tianfu International Airport, photorealistic", "四川 的 天府国际机场", 3, "manual"),
    ("昆明长水国际机场", "airport", 102.929, 25.102, "530100", "云南昆明", "面向东南亚南亚门户枢纽", "aerial photograph of Kunming Changshui International Airport, photorealistic", "云南 的 长水国际机场", 3, "manual"),

    # ---- 博物馆 ----
    ("中国国家博物馆", "museum", 116.404, 39.905, "110100", "北京", "世界上单体建筑面积最大的博物馆", "aerial photograph of National Museum of China, monumental architecture at Tiananmen Square, photorealistic", "北京 的 国家博物馆", 2, "manual"),
    ("陕西历史博物馆", "museum", 108.961, 34.227, "610100", "陕西西安", "华夏宝库，十三朝古都文物荟萃", "aerial photograph of Shaanxi History Museum, Tang dynasty style architecture, photorealistic", "陕西 的 陕西历史博物馆", 2, "manual"),
    ("三星堆博物馆", "museum", 104.201, 31.100, "510600", "四川德阳", "神秘古蜀文明，青铜面具震惊世界", "aerial photograph of Sanxingdui Museum, modern building with bronze mask sculptures, photorealistic", "四川 的 三星堆博物馆", 2, "manual"),
    ("故宫敦煌研究院", "museum", 94.663, 40.043, "620900", "甘肃酒泉", "莫高窟千佛洞，世界艺术宝库", "aerial photograph of Mogao Caves Dunhuang, cliff face with cave entrances, desert landscape, photorealistic", "甘肃 的 莫高窟", 1, "manual"),
    ("南京博物院", "museum", 118.837, 32.043, "320100", "江苏南京", "中国三大博物馆之一", "aerial photograph of Nanjing Museum, photorealistic", "江苏 的 南京博物院", 2, "manual"),

    # ---- 现代地标 ----
    ("东方明珠广播电视塔", "landmark", 121.499, 31.240, "310100", "上海", "上海地标建筑，468米高塔", "aerial photograph of Oriental Pearl Tower Shanghai, iconic pink sphere TV tower, photorealistic", "上海 的 东方明珠", 2, "manual"),
    ("鸟巢国家体育场", "landmark", 116.397, 39.992, "110100", "北京", "2008年北京奥运会主体育场", "aerial photograph of Birds Nest National Stadium Beijing, woven steel structure, photorealistic", "北京 的 鸟巢", 2, "manual"),
    ("广州塔", "landmark", 113.324, 23.106, "440100", "广东广州", "小蛮腰，600米中国第一高塔", "aerial photograph of Canton Tower Guangzhou, twisting hyperboloid structure, photorealistic", "广东 的 广州塔", 2, "manual"),
    ("深圳平安金融中心", "landmark", 114.059, 22.537, "440300", "广东深圳", "华南第一高楼，599米", "aerial photograph of Ping An Finance Centre Shenzhen, tall glass skyscraper, photorealistic", "广东 的 平安金融中心", 2, "manual"),

    # ---- 古城古镇 ----
    ("平遥古城", "ancient_city", 112.176, 37.189, "140700", "山西晋中", "保存最完整的古代县城原型", "aerial photograph of Pingyao Ancient City, Ming dynasty city walls and rooftops, photorealistic", "山西 的 平遥古城", 1, "manual"),
    ("丽江古城", "ancient_city", 100.233, 26.872, "530700", "云南丽江", "纳西族文化中心，世界文化遗产", "aerial photograph of Lijiang Old Town, traditional Naxi architecture, photorealistic", "云南 的 丽江古城", 1, "manual"),
    ("凤凰古城", "ancient_city", 109.599, 27.948, "433100", "湖南湘西", "沱江边的吊脚楼古城", "aerial photograph of Fenghuang Ancient Town, stilt houses along Tuojiang River, photorealistic", "湖南 的 凤凰古城", 1, "manual"),

    # ---- 寺庙古建 ----
    ("布达拉宫", "temple", 91.117, 29.658, "540100", "西藏拉萨", "世界屋脊上的宫殿，藏传佛教圣地", "aerial photograph of Potala Palace Lhasa, white and red palace on hilltop, photorealistic", "西藏 的 布达拉宫", 1, "manual"),
    ("少林寺", "temple", 112.935, 34.508, "410100", "河南郑州", "天下第一名刹，禅宗祖庭", "aerial photograph of Shaolin Temple, ancient Buddhist temple complex, photorealistic", "河南 的 少林寺", 1, "manual"),
    ("乐山大佛", "temple", 103.772, 29.545, "511100", "四川乐山", "世界最大石刻弥勒佛坐像", "aerial photograph of Leshan Giant Buddha, carved stone Buddha statue on cliff, photorealistic", "四川 的 乐山大佛", 1, "manual"),
    ("悬空寺", "temple", 113.716, 39.660, "140200", "山西大同", "悬崖峭壁上的千年古刹", "aerial photograph of Hanging Temple Xuankong Si, temple clinging to cliff face, photorealistic", "山西 的 悬空寺", 1, "manual"),

    # ---- 交通工程 ----
    ("港珠澳大桥", "engineering", 113.820, 22.210, "440400", "广东珠海", "世界最长跨海大桥，55公里", "aerial photograph of Hong Kong-Zhuhai-Macao Bridge, long bridge over sea, photorealistic", "广东 的 港珠澳大桥", 2, "manual"),
    ("三峡大坝", "engineering", 111.003, 30.823, "420500", "湖北宜昌", "世界最大水电站，防洪发电航运", "aerial photograph of Three Gorges Dam, massive hydroelectric dam, photorealistic", "湖北 的 三峡大坝", 2, "manual"),
    ("青藏铁路-那曲段", "engineering", 92.070, 31.480, "540600", "西藏那曲", "世界海拔最高铁路，天路", "aerial photograph of Qinghai-Tibet Railway, train on plateau with snow mountains, photorealistic", "西藏 的 青藏铁路", 2, "manual"),
]


def make_cover_url(prompt: str) -> str:
    encoded = urllib.parse.quote(prompt)
    return f"https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt={encoded}&image_size=landscape_16_9"


def sql_escape(s: str) -> str:
    return s.replace("'", "''")


def generate_sql():
    lines = []
    lines.append("-- ============================================================")
    lines.append("-- map 项目 数据结构调整 DDL（线上先执行本文件）")
    lines.append("-- 生成日期: 2026-08-10")
    lines.append("-- 说明: 在线上 MySQL 顺序执行；随后执行 theme_pois_online.sql 导入种子")
    lines.append("-- ============================================================")
    lines.append("")

    # ===== Part 1: DDL =====
    lines.append("-- ===== Part 1: DDL 结构调整 =====")
    lines.append("")

    # pois 表
    lines.append("-- 1.1 pois 表: 新增 source 字段")
    lines.append("ALTER TABLE `pois` ADD COLUMN `source` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '种子来源';")
    lines.append("")
    lines.append("-- 1.2 pois 表: 新增索引（加速选题查询）")
    lines.append("ALTER TABLE `pois` ADD INDEX `idx_pois_category` (`category`);")
    lines.append("ALTER TABLE `pois` ADD INDEX `idx_pois_adcode` (`adcode`);")
    lines.append("ALTER TABLE `pois` ADD INDEX `idx_pois_difficulty` (`difficulty`);")
    lines.append("")

    # pk_rooms 表
    lines.append("-- 1.3 pk_rooms 表: 新增 difficulty 字段")
    lines.append("ALTER TABLE `pk_rooms` ADD COLUMN `difficulty` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'hard' COMMENT 'easy/hard';")
    lines.append("")
    lines.append("-- 1.4 pk_rooms 表: 新增 category 字段")
    lines.append("ALTER TABLE `pk_rooms` ADD COLUMN `category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '主题分类';")
    lines.append("")
    lines.append("-- 1.5 pk_rooms 表: status 索引")
    lines.append("ALTER TABLE `pk_rooms` ADD INDEX `ix_pk_rooms_status` (`status`);")
    lines.append("")

    # 清理 OSS 占位图
    lines.append("-- 1.6 清理 OSS 占位封面图（设为 NULL，让系统按需动态生成）")
    lines.append("UPDATE `pois` SET `cover_url` = NULL")
    lines.append("  WHERE `cover_url` LIKE 'https://map-find.oss-cn-beijing.aliyuncs.com/covers/%';")
    lines.append("")

    # ===== Part 2: 种子数据已拆分到独立文件 =====
    lines.append("-- ===== Part 2: 主题种子数据 =====")
    lines.append("-- 主题种子（751 条，含坐标+封面图）见独立文件: scripts/theme_pois_online.sql")
    lines.append("-- 生成方式: python3 -m scripts.export_theme_pois_sql")
    lines.append("")
    lines.append("-- ===== End =====")

    return "\n".join(lines)


if __name__ == "__main__":
    sql = generate_sql()
    output_path = "/Users/luanpeng/Desktop/allData/code/zhizhang/map/backend/scripts/seed_pois.sql"
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(sql)
    print(f"已生成 DDL: {output_path}")
    print("种子数据请执行: python3 -m scripts.export_theme_pois_sql")
